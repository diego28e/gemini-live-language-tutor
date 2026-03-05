import { WorkerOptions, cli, JobContext, voice, defineAgent } from '@livekit/agents';
import * as dotenv from 'dotenv';
import { pool } from './db.js';
import * as google from '@livekit/agents-plugin-google';
import { fileURLToPath } from 'node:url';

dotenv.config();

export default defineAgent({
    entry: async (ctx: JobContext) => {
        console.log(`[agent] Starting for room: ${ctx.room?.name || 'unknown'}`);
        await ctx.connect();

        const roomName = ctx.room?.name || 'unknown';
        console.log(`[agent] Connected to ${roomName}`);

        let systemPrompt = "You are a helpful language tutor. Keep your answers concise.";
        let agentVoice = "Aoede"; // Default voice for Gemini

        // Extract lesson ID from room name (e.g. l-1234abcd-...-1234abcd)
        const parts = roomName.split('-');
        if (parts.length >= 7 && parts[0] === 'l') { // l-{uuid5parts}-suffix
            const dbLessonId = `${parts[1]}-${parts[2]}-${parts[3]}-${parts[4]}-${parts[5]}`;
            try {
                if (process.env.DATABASE_URL) {
                    console.log(`[agent] Fetching instructions for lesson ID: ${dbLessonId}`);
                    const result = await pool.query('SELECT system_prompt, language FROM Lessons WHERE id = $1', [dbLessonId]);
                    if (result.rows.length > 0) {
                        systemPrompt = result.rows[0].system_prompt;
                        const lang = result.rows[0].language;
                        console.log(`[agent] Loaded prompt for language: ${lang}`);
                    }
                }
            } catch (e) {
                console.error("DB Error in Agent:", e);
            }
        }

        try {
            const realtimeModel = new google.beta.realtime.RealtimeModel({
                model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                instructions: systemPrompt,
                voice: agentVoice
            });

            const agent = new voice.Agent({
                instructions: systemPrompt,
                llm: realtimeModel
            });

            const session = new voice.AgentSession({ llm: realtimeModel });
            await session.start({ agent, room: ctx.room! });
            session.say("Let's begin! " + systemPrompt.split('.')[0] + '.');

            console.log("[agent] Gemini 2.0 Multimodal Agent started successfully.");
        } catch (e) {
            console.error("Failed to start MultimodalAgent.", e);
        }

        ctx.room?.on('disconnected', () => {
            console.log(`[agent] Disconnected from ${roomName}`);
        });
    }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
}
