import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

// Export a configured pool
export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});
