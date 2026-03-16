import { ServerOptions, cli, JobContext, voice, defineAgent, llm } from '@livekit/agents';
import * as dotenv from 'dotenv';
import { pool } from './db.js';
import { appendFileSync } from 'node:fs';
const log = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    process.stderr.write(line);
    try { appendFileSync('/tmp/agent-debug.log', line); } catch (_) {}
};
import * as google from '@livekit/agents-plugin-google';
import { fileURLToPath } from 'node:url';
import { VideoStream, VideoBufferType, TrackKind } from '@livekit/rtc-node';
import type { Track } from '@livekit/rtc-node';
import sharp from 'sharp';
import { runEvaluation } from './evaluator.js';
import http from 'node:http';

dotenv.config();

// ─── Cloud Run health check server ───────────────────────────────────────────
// Cloud Run requires every Service container to bind to PORT=8080.
// LiveKit spawns worker child processes that will also parse this file.
// We catch EADDRINUSE so only the supervisor binds the port successfully,
// and the child processes safely ignore the port collision.
const healthPort = Number(process.env.PORT ?? 8080);
const server = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
});
server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`[agent] Port ${healthPort} in use. Safely ignoring in child worker.`);
    } else {
        console.error(`[agent] Health check server error:`, err);
    }
});
server.listen(healthPort, () => {
    console.log(`[agent] Health check server listening on port ${healthPort}`);
});
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_LIMIT_MS = 5 * 60 * 1000; // 5 minutes hard stop

export default defineAgent({
    entry: async (ctx: JobContext) => {
        // Redacted for security, just checking existence
        log(`[agent] entry function called. DATABASE_URL present: ${!!process.env.DATABASE_URL}`);
        
        // Extract room name securely from the matched job, before WebRTC resolves
        const roomName = ctx.job?.room?.name || ctx.room?.name || 'unknown';
        log(`[agent] Starting for room: ${roomName}`);

        let systemPrompt = "You are a helpful language tutor. Keep your answers concise.";
        let agentVoice = "Aoede";

        // Lesson context stored for use in the evaluator
        let lessonContext: {
            language: string;
            grammar_focus: string;
            vocab_focus: string | null;
            cefr_level: string;
        } | null = null;

        // Parse lesson ID from room name immediately so DB + WebRTC connect can run in parallel
        const parts = roomName.split('-');
        log(`[agent] roomName="${roomName}" parts=${JSON.stringify(parts)} parts[0]="${parts[0]}" DATABASE_URL=${!!process.env.DATABASE_URL}`);

        const lessonFetchPromise: Promise<void> = (async () => {
            // Check if it starts with 'l-' followed by at least one part
            if (parts[0] === 'l' && parts.length >= 2 && process.env.DATABASE_URL) {
                // Lesson ID should be the middle parts before the random suffix
                // If it's a UUID, it will have 5 parts: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
                // roomName: l-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx-random
                const dbLessonId = parts.slice(1, parts.length - 1).join('-');
                try {
                    log(`[agent] Fetching lesson: ${dbLessonId}`);
                    const result = await pool.query(
                        `SELECT title, grammar_focus, vocab_focus, cefr_level, language,
                                moment_1_presentation, moment_2_practice, moment_3_conversation
                         FROM Lessons WHERE id = $1`,
                        [dbLessonId]
                    );
                    if (result.rows.length > 0) {
                        const { title, grammar_focus, vocab_focus, cefr_level, language,
                            moment_1_presentation, moment_2_practice, moment_3_conversation } = result.rows[0];
                        lessonContext = { language, grammar_focus, vocab_focus, cefr_level };
                    log(`[agent] Loaded lesson: ${title} (${language})`);
                        systemPrompt = `You are an expert ${language} tutor running a 5-minute lesson called "${title}" at CEFR level ${cefr_level}. This is a voice session — speak naturally at all times.

The lesson has three moments. Move through them in order without announcing transitions.

MOMENT 1 — PRESENTATION (1 minute):
${moment_1_presentation}

MOMENT 2 — GUIDED PRACTICE (2 minutes):
${moment_2_practice}

MOMENT 3 — CONVERSATION OR ROLEPLAY (2 minutes):
${moment_3_conversation}

TARGET LANGUAGE FOCUS:
- Grammar: ${grammar_focus}
${vocab_focus ? `- Key vocabulary: ${vocab_focus}` : ''}

BEHAVIORAL RULES:

Interaction: In Moment 1, deliver only one step at a time. After every elicitation, stop and wait for the student to speak before continuing. Always end your turn with a question or a clear invitation to respond. Never end on a statement.

Correction in Moments 1 and 2: Correct grammar and pronunciation errors immediately. Never accept incomplete use of the target structure. Say the correct form naturally and ask the student to try again. Wait for them to repeat it before moving on.

Correction in Moment 3: Never interrupt the flow to correct. Instead, recast — use the correct form naturally in your next response without drawing attention to the error.

Tone: Warm, encouraging, and concise. Never lecture. One sentence of feedback maximum.

Pacing: When Moment 3 feels complete, deliver a short spoken debrief — one thing they did well, one correction with the correct form, and one vocabulary or fluency tip. If Moment 3 was a roleplay, step out of character before the debrief.`;
                    } else {
                    log(`[agent] DB returned 0 rows for lesson ID: ${dbLessonId}. Using fallback prompt.`);
                    }
                } catch (e) {
                    log(`[agent] DB Error for ${dbLessonId}: ${e}`);
                }
            } else {
                log(`[agent] Room name unrecognized or DATABASE_URL not set — using fallback prompt.`);
            }
        })();

        try {
            log(`[agent] Connecting to room and fetching lesson in parallel...`);
            const [connResult] = await Promise.allSettled([
                ctx.connect(),
                lessonFetchPromise,
            ]);
            if (connResult.status === 'rejected') {
                log(`[agent] WebRTC ctx.connect() failed: ${connResult.reason}`);
                return;
            }
            log(`[agent] Connected to ${roomName}, lesson data ready.`);
        } catch (connErr) {
            log(`[agent] Unexpected connect error: ${connErr}`);
            return;
        }

        // systemPrompt is fully resolved — construct model with final instructions
        const realtimeModel = new google.beta.realtime.RealtimeModel({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            voice: agentVoice,
            outputAudioTranscription: {},
            inputAudioTranscription: {},
            instructions: systemPrompt,
        });

        try {
            const agent = new voice.Agent({
                instructions: systemPrompt,
                llm: realtimeModel,
            });

            const session = new voice.AgentSession({ llm: realtimeModel });
            try {
                log(`[agent] Starting voice AgentSession...`);
                await session.start({ agent, room: ctx.room! });
                session.generateReply({ instructions: systemPrompt });
                log(`[agent] AgentSession started and generateReply triggered.`);
            } catch (sessionErr) {
                log(`[agent] Session start failed: ${sessionErr}`);
                return;
            }
            // Key: segmentId (one per agent turn). Updated on EVERY word chunk so
            // that if the stream is aborted (hard-stop), we already have the text
            // accumulated up to that point — no data loss on abrupt closes.
            const agentTurns = new Map<string, string>();

            // ── Real-time Closed Captions + Agent transcript ───────────────────────
            // The underlying RealtimeSession emits 'generation_created' for every response turn.
            // Each generation exposes a textStream where outputTranscription chunks land word-by-word.
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
                                const { messageId, textStream } = msg;
                                const textReader = textStream.getReader();
                                const segmentId = messageId;
                                let accumulator = '';
                                while (true) {
                                    const { done: textDone, value: chunk } = await textReader.read();
                                    if (textDone) break;
                                    if (!chunk) continue;
                                    const text = typeof chunk === 'string' ? chunk : (chunk as any).text ?? '';
                                    if (!text) continue;
                                    accumulator += text;
                                    // ↓ Update Map on EVERY word — captured even if stream is aborted
                                    agentTurns.set(segmentId, accumulator);
                                    // Publish non-final caption for real-time display
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
                                // Publish final caption when the turn ends cleanly
                                if (accumulator) {
                                    agentTurns.set(segmentId, accumulator);
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
                        } catch (_) {
                            // Stream closed on barge-in or hard-stop — Map already holds the text
                        }
                    })();
                });

            } else {
                console.warn('[agent] Could not access RealtimeSession for captions/transcript.');
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
            for (const participant of ctx.room!.remoteParticipants.values()) {
                for (const pub of participant.trackPublications.values()) {
                    if (pub.track && pub.track.kind === TrackKind.KIND_VIDEO) {
                        startVideoStream(pub.track as Track);
                    }
                }
            }

            // 5-minute hard stop
            const hardStopTimer = setTimeout(async () => {
                log(`[agent] 5-minute session limit reached for room: ${roomName}`);
                try {
                    session.say("We've reached the end of our 5-minute session! Great work today. Keep practicing and see you next time!");
                } catch (_) { }

                setTimeout(async () => {
                    // Signal the frontend to navigate away immediately (before the participant
                    // fully disconnects, which can take ~30s through the LiveKit process shutdown)
                    try {
                        const lp = ctx.room!.localParticipant;
                        if (lp) {
                            await lp.publishData(
                                Buffer.from(JSON.stringify({ type: 'session_ended' })),
                                { reliable: true }
                            );
                            log(`[agent] session_ended data message sent to frontend`);
                        }
                    } catch (_) { }

                    session.close();
                }, 5000);
            }, SESSION_LIMIT_MS);

            session.on(voice.AgentSessionEventTypes.Close, async () => {
                clearTimeout(hardStopTimer);
                log(`[agent] Session closed for room: ${roomName}`);

                if (!process.env.DATABASE_URL) {
                    console.warn('[agent] DATABASE_URL not set — skipping session finalization');
                    return;
                }

                try {
                    // Mark session completed. The frontend submits the transcript and
                    // triggers the evaluator via POST /api/sessions/:id/transcript.
                    const sessionResult = await pool.query(
                        `UPDATE Sessions
                         SET status = 'completed',
                             ended_at = CURRENT_TIMESTAMP,
                             duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - created_at))::INTEGER
                         WHERE livekit_room_name = $1 AND status = 'started'
                         RETURNING id`,
                        [roomName]
                    );
                    log(`[agent] Sessions UPDATE matched ${sessionResult.rows.length} row(s)`);
                } catch (e) {
                    log(`[agent] Error finalizing session: ${e}`);
                }
            });

        } catch (e) {
            log(`[agent] Failed to start agent: ${e}`);
        }

        ctx.room?.on('disconnected', () => {
            log(`[agent] Disconnected from ${roomName}`);
        });
    }
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: 'ai-tutor-agent' }));
