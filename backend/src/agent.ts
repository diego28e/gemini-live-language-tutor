import { WorkerOptions, cli, JobContext } from '@livekit/agents';
import * as dotenv from 'dotenv';
import { pool } from './db.js';

dotenv.config();

// Note: Ensure GEMINI_API_KEY is defined in your environment
// import { MultimodalAgent } from '@livekit/agents-plugin-google';

export default cli.runApp(new WorkerOptions({
    agent: async (ctx: JobContext) => {
        console.log(`[agent] Starting for room: ${ctx.room.name}`);
        await ctx.connect();

        console.log(`[agent] Connected to ${ctx.room.name}`);

        let systemPrompt = "You are a helpful language tutor.";

        // Extract lesson ID from room name (e.g. lesson-1234abcd-...)
        const parts = ctx.room.name.split('-');
        if (parts.length >= 2 && parts[0] === 'lesson') {
            const dbLessonId = parts[1];
            try {
                if (process.env.DATABASE_URL) {
                    // You might need to adjust the query if dealing with sliced UUIDs 
                    // (Consider passing the full UUID in metadata during Room creation in index.ts)
                    console.log(`[agent] Attempting to fetch system instructions for lesson ID starting with ${dbLessonId}`);
                }
            } catch (e) {
                console.error("DB Error in Agent:", e);
            }
        }

        /// IMPLEMENTATION ///
        // const agent = new MultimodalAgent({
        //   model: 'gemini-2.5-flash',
        //   instructions: systemPrompt,
        // });
        // await agent.start(ctx.room);
        /// ================ ///

        ctx.room.on('disconnected', () => {
            console.log(`[agent] Disconnected from ${ctx.room.name}`);
        });
    }
}));
