import { WorkerOptions, cli, JobContext, voice, defineAgent, llm } from '@livekit/agents';
import * as dotenv from 'dotenv';
import { pool } from './db.js';
import * as google from '@livekit/agents-plugin-google';
import { fileURLToPath } from 'node:url';
import { VideoStream, VideoBufferType, TrackKind } from '@livekit/rtc-node';
import type { Track } from '@livekit/rtc-node';
import sharp from 'sharp';

dotenv.config();

const SESSION_LIMIT_MS = 15 * 60 * 1000; // 15 minutes hard stop

export default defineAgent({
    entry: async (ctx: JobContext) => {
        console.log(`[agent] Starting for room: ${ctx.room?.name || 'unknown'}`);
        await ctx.connect();

        const roomName = ctx.room?.name || 'unknown';
        console.log(`[agent] Connected to ${roomName}`);

        let systemPrompt = "You are a helpful language tutor. Keep your answers concise.";
        let agentVoice = "Aoede";

        const parts = roomName.split('-');
        if (parts.length >= 7 && parts[0] === 'l') {
            const dbLessonId = `${parts[1]}-${parts[2]}-${parts[3]}-${parts[4]}-${parts[5]}`;
            try {
                if (process.env.DATABASE_URL) {
                    console.log(`[agent] Fetching instructions for lesson ID: ${dbLessonId}`);
                    const result = await pool.query(
                        'SELECT title, prompt_presentation, prompt_practice, prompt_roleplay, language, cefr_level FROM Lessons WHERE id = $1',
                        [dbLessonId]
                    );
                    if (result.rows.length > 0) {
                        const { title, prompt_presentation, prompt_practice, prompt_roleplay, language, cefr_level } = result.rows[0];
                        console.log(`[agent] Loaded lesson: ${title} (${language})`);

                        // Build composite prompt with all 3 moments
                        systemPrompt = `You are an expert ${language} tutor running a 12-minute lesson called "${title}" at CEFR level ${cefr_level}. This is a voice session — speak naturally at all times.

The lesson has three moments. Move through them in order without announcing transitions.

MOMENT 1 — PRESENTATION (2 minutes):
${prompt_presentation}

MOMENT 2 — GUIDED PRACTICE (5 minutes):
${prompt_practice}

MOMENT 3 — CONVERSATION OR ROLEPLAY (3 minutes):
${prompt_roleplay}

BEHAVIORAL RULES:

Interaction: In Moment 1, deliver only one step at a time. After every elicitation, stop and wait for the student to speak before continuing. Always end your turn with a question or a clear invitation to respond. Never end on a statement.

Correction in Moments 1 and 2: Correct grammar and pronunciation errors immediately. Never accept incomplete use of the target structure. Say the correct form naturally and ask the student to try again. Wait for them to repeat it before moving on.

Correction in Moment 3: Never interrupt the flow to correct. Instead, recast — use the correct form naturally in your next response without drawing attention to the error.

Tone: Warm, encouraging, and concise. Never lecture. One sentence of feedback maximum.

Pacing: When Moment 3 feels complete, deliver a short spoken debrief — one thing they did well, one correction with the correct form, and one vocabulary or fluency tip. If Moment 3 was a roleplay, step out of character before the debrief.`;
                    }
                }
            } catch (e) {
                console.error("DB Error in Agent:", e);
            }
        }

        try {
            const realtimeModel = new google.beta.realtime.RealtimeModel({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                instructions: systemPrompt,
                voice: agentVoice,
                // Enable Gemini's own output transcription so we can forward it word-by-word
                outputAudioTranscription: {}
            });

            const agent = new voice.Agent({
                instructions: systemPrompt,
                llm: realtimeModel
            });

            const session = new voice.AgentSession({ llm: realtimeModel });
            await session.start({ agent, room: ctx.room! });
            session.generateReply();

            console.log("[agent] Agent started successfully.");

            // ── Real-time Closed Captions ──────────────────────────────────────────
            // The underlying RealtimeSession emits 'generation_created' for every response turn.
            // Each generation exposes a textStream where outputTranscription chunks land word-by-word.
            // We read that stream and publish each chunk via LiveKit's built-in transcription data channel
            // so the frontend can pick them up with useTranscriptions().
            const realtimeSession = (realtimeModel as any)._session as (llm.RealtimeSession | undefined);
            const room = ctx.room!;
            const localParticipant = room.localParticipant!;
            if (realtimeSession) {
                realtimeSession.on('generation_created', (event: llm.GenerationCreatedEvent) => {
                    if (!localParticipant) return;
                    (async () => {
                        try {
                            const reader = event.messageStream.getReader();
                            while (true) {
                                const { done: msgDone, value: msg } = await reader.read();
                                if (msgDone || !msg) break;
                                // Each msg is a MessageGeneration with its own textStream
                                const { messageId, textStream } = msg;
                                const textReader = textStream.getReader();
                                let segmentId = messageId;
                                let accumulator = '';
                                while (true) {
                                    const { done: textDone, value: chunk } = await textReader.read();
                                    if (textDone) break;
                                    if (!chunk) continue;
                                    const text = typeof chunk === 'string' ? chunk : (chunk as any).text ?? '';
                                    if (!text) continue;
                                    accumulator += text;
                                    // Publish each word chunk as a non-final segment so the frontend
                                    // shows it immediately while the agent is speaking
                                    localParticipant.publishTranscription({
                                        participantIdentity: localParticipant.identity,
                                        trackSid: '',
                                        segments: [{
                                            id: segmentId,
                                            text: accumulator,
                                            final: false,
                                            language: '',
                                            startTime: BigInt(0),
                                            endTime: BigInt(0)
                                        }]
                                    });
                                }
                                // Mark the last segment as final when the turn ends
                                if (accumulator) {
                                    localParticipant.publishTranscription({
                                        participantIdentity: localParticipant.identity,
                                        trackSid: '',
                                        segments: [{
                                            id: segmentId,
                                            text: accumulator,
                                            final: true,
                                            language: '',
                                            startTime: BigInt(0),
                                            endTime: BigInt(0)
                                        }]
                                    });
                                }
                            }
                        } catch (e) {
                            // Silently ignore — stream may close on barge-in
                        }
                    })();
                });
            } else {
                console.warn('[agent] Could not access RealtimeSession for captions. The agent session may be structured differently.');
            }
            // ──────────────────────────────────────────────────────────────────────

            // Vision: stream user camera at 1fps to Gemini via realtimeInput
            const startVideoStream = (track: Track) => {
                const videoStream = new VideoStream(track);
                let lastFrameTime = 0;
                (async () => {
                    try {
                        for await (const { frame } of videoStream) {
                            const now = Date.now();
                            if (now - lastFrameTime < 1000) continue; // 1fps throttle
                            lastFrameTime = now;
                            const rgba = frame.convert(VideoBufferType.RGBA);
                            const jpegBuf = await sharp(Buffer.from(rgba.data), {
                                raw: { width: rgba.width, height: rgba.height, channels: 4 }
                            }).jpeg({ quality: 75 }).toBuffer();
                            const realtimeSession = (session as any).activity?.realtimeLLMSession;
                            const activeSession = realtimeSession ? (realtimeSession as any).activeSession : null;
                            if (activeSession) {
                                await activeSession.sendRealtimeInput({
                                    media: { mimeType: 'image/jpeg', data: jpegBuf.toString('base64') }
                                });
                            }
                        }
                    } catch (_) { }
                })();
            };

            ctx.room!.on('trackSubscribed', (track, _pub, _participant) => {
                if (track.kind === TrackKind.KIND_VIDEO) startVideoStream(track);
            });
            // Handle camera already published before agent joined
            for (const participant of ctx.room!.remoteParticipants.values()) {
                for (const pub of participant.trackPublications.values()) {
                    if (pub.track && pub.track.kind === TrackKind.KIND_VIDEO) {
                        startVideoStream(pub.track as Track);
                    }
                }
            }

            // 15-minute hard stop
            const hardStopTimer = setTimeout(async () => {
                console.log(`[agent] 15-minute session limit reached for room: ${roomName}`);
                try {
                    session.say("We've reached the end of our 15-minute session! Great work today. Keep practicing and see you next time!");
                } catch (_) { }
                setTimeout(() => session.close(), 5000);
            }, SESSION_LIMIT_MS);

            session.on(voice.AgentSessionEventTypes.Close, async () => {
                clearTimeout(hardStopTimer);
                // Finalize session and write metrics
                if (process.env.DATABASE_URL) {
                    try {
                        const sessionResult = await pool.query(
                            `UPDATE Sessions SET status = 'completed', ended_at = CURRENT_TIMESTAMP,
                             duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - created_at))::INTEGER
                             WHERE livekit_room_name = $1 AND status = 'started' RETURNING id`,
                            [roomName]
                        );
                        if (sessionResult.rows.length > 0) {
                            const sessionId = sessionResult.rows[0].id;
                            await pool.query(
                                'INSERT INTO Metrics (session_id) VALUES ($1)',
                                [sessionId]
                            );
                        }
                    } catch (e) {
                        console.error('[agent] Error writing session/metrics:', e);
                    }
                }
            });

        } catch (e) {
            console.error("Failed to start agent.", e);
        }

        ctx.room?.on('disconnected', () => {
            console.log(`[agent] Disconnected from ${roomName}`);
        });
    }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
}
