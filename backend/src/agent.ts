import { WorkerOptions, cli, JobContext, voice, defineAgent } from '@livekit/agents';
import * as dotenv from 'dotenv';
import { pool } from './db.js';
import * as google from '@livekit/agents-plugin-google';
import { fileURLToPath } from 'node:url';

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
                        'SELECT title, prompt_presentation, prompt_practice, prompt_roleplay, language FROM Lessons WHERE id = $1',
                        [dbLessonId]
                    );
                    if (result.rows.length > 0) {
                        const { title, prompt_presentation, prompt_practice, prompt_roleplay, language } = result.rows[0];
                        console.log(`[agent] Loaded lesson: ${title} (${language})`);

                        // Build composite prompt with all 3 moments
                        systemPrompt = `You are an expert ${language} language tutor conducting a 15-minute structured lesson titled "${title}".

The session has THREE moments. Move through them in order:

## MOMENT 1 — PRESENTATION (approx. 3 minutes)
${prompt_presentation}

## MOMENT 2 — GUIDED PRACTICE (approx. 5 minutes)
${prompt_practice}

## MOMENT 3 — ROLEPLAY / CONVERSATION (approx. 7 minutes)
${prompt_roleplay}

IMPORTANT RULES:
- Transition naturally between moments WITHOUT pausing. When you finish one moment, immediately begin the next — do not wait for the student to prompt you.
- Always end every single turn with either a direct question to the student, a prompt to respond, or an explicit instruction like "Your turn!". Never end a turn with a statement that doesn't invite a response.
- Always give immediate, specific feedback on pronunciation, vocabulary, and grammar errors.
- Keep energy warm, encouraging, and professional.
- When you are approaching the end of the session (around 13 minutes), wrap up the roleplay and give the student a brief overall summary of what they practiced and one key thing to remember.`;
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
                voice: agentVoice
            });

            const agent = new voice.Agent({
                instructions: systemPrompt,
                llm: realtimeModel
            });

            const session = new voice.AgentSession({ llm: realtimeModel });
            await session.start({ agent, room: ctx.room! });
            session.generateReply();

            console.log("[agent] Agent started successfully.");

            // 15-minute hard stop
            const hardStopTimer = setTimeout(async () => {
                console.log(`[agent] 15-minute session limit reached for room: ${roomName}`);
                try {
                    session.say("We've reached the end of our 15-minute session! Great work today. Keep practicing and see you next time!");
                } catch (_) {}
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
