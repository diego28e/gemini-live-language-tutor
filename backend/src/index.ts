import express from 'express';
import cors from 'cors';
import { AccessToken, WebhookReceiver } from 'livekit-server-sdk';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { pool } from './db.js';

dotenv.config();

if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (e) {
        console.error("Failed to initialize Firebase Admin:", e);
    }
} else {
    console.warn("No FIREBASE_SERVICE_ACCOUNT_KEY found. Firebase auth validation will be skipped.");
}

const app = express();
app.use(cors());

// Raw body needed for LiveKit webhook signature verification
app.use('/api/livekit-webhook', express.raw({ type: 'application/webhook+json' }));
app.use(express.json());

const SILENCE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const PLAN_CREDITS: Record<string, number> = { basic: 8, plus: 12 };

// Reset credits if the reset date has passed
async function ensureCreditsReset(userId: string) {
    await pool.query(`
        UPDATE Users
        SET credits_remaining = CASE plan WHEN 'plus' THEN 12 ELSE 8 END,
            credits_reset_at = date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month'
        WHERE id = $1 AND credits_reset_at <= CURRENT_TIMESTAMP
    `, [userId]);
}

app.post('/api/token', async (req: express.Request, res: express.Response): Promise<any> => {
    try {
        const authHeader = req.headers.authorization;
        let firebaseUid: string | null = null;

        if (authHeader?.startsWith('Bearer ') && admin.apps.length > 0) {
            const decoded = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
            firebaseUid = decoded.uid;
        }

        const { lessonId } = req.body;
        if (!lessonId) return res.status(400).json({ error: 'lessonId is required' });

        const apiKey = process.env.LIVEKIT_API_KEY;
        const apiSecret = process.env.LIVEKIT_API_SECRET;
        if (!apiKey || !apiSecret) return res.status(500).json({ error: 'LiveKit credentials missing' });

        let userId = 'anonymous-' + uuidv4().substring(0, 8);
        let dbUserId: string | null = null;

        // Upsert user and check credits for authenticated users
        if (firebaseUid && process.env.DATABASE_URL) {
            const email = (admin.apps.length > 0)
                ? (await admin.auth().getUser(firebaseUid)).email ?? null
                : null;

            // Upsert: create user if not exists, return id either way
            const upsertResult = await pool.query(`
                INSERT INTO Users (firebase_uid, email)
                VALUES ($1, $2)
                ON CONFLICT (firebase_uid) DO UPDATE SET email = COALESCE(EXCLUDED.email, Users.email)
                RETURNING id, credits_remaining, credits_reset_at
            `, [firebaseUid, email]);

            const user = upsertResult.rows[0];
            dbUserId = user.id;
            userId = firebaseUid;

            await ensureCreditsReset(user.id);

            const fresh = await pool.query('SELECT credits_remaining FROM Users WHERE id = $1', [user.id]);
            if (fresh.rows[0].credits_remaining <= 0) {
                return res.status(403).json({ error: 'No credits remaining. Credits reset on the 1st of each month.' });
            }

            await pool.query('UPDATE Users SET credits_remaining = credits_remaining - 1 WHERE id = $1', [user.id]);
        }

        const roomName = `l-${lessonId}-${uuidv4().substring(0, 8)}`;

        // Always create a session record when we have a DB
        if (process.env.DATABASE_URL) {
            await pool.query(
                'INSERT INTO Sessions (user_id, lesson_id, livekit_room_name, status) VALUES ($1, $2, $3, $4)',
                [dbUserId, lessonId, roomName, 'started']
            );
        }

        const at = new AccessToken(apiKey, apiSecret, {
            identity: userId,
            name: `User ${userId.substring(0, 5)}`,
        });
        at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
        const token = await at.toJwt();

        res.json({ token, roomName, userId, lessonId });
    } catch (err: any) {
        console.error("Error generating token:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/lessons', async (req: express.Request, res: express.Response): Promise<any> => {
    try {
        if (!process.env.DATABASE_URL) {
            return res.json([{ id: 'mock-1', title: 'Mock Ordering Food', cefr_level: 'A2', language: 'English' }]);
        }
        const result = await pool.query('SELECT id, title, cefr_level, grammar_focus, language FROM Lessons');
        res.json(result.rows);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// LiveKit webhook — handles silence timeout and session completion
app.post('/api/livekit-webhook', async (req: express.Request, res: express.Response): Promise<any> => {
    const apiKey = process.env.LIVEKIT_API_KEY!;
    const apiSecret = process.env.LIVEKIT_API_SECRET!;

    try {
        const receiver = new WebhookReceiver(apiKey, apiSecret);
        const event = await receiver.receive(req.body.toString(), req.headers['authorization'] as string);

        const roomName = event.room?.name;
        if (!roomName || !process.env.DATABASE_URL) return res.sendStatus(200);

        if (event.event === 'participant_left' || event.event === 'room_finished') {
            // Mark session completed
            await pool.query(`
                UPDATE Sessions SET status = 'completed', ended_at = CURRENT_TIMESTAMP,
                    duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - created_at))::INTEGER
                WHERE livekit_room_name = $1 AND status = 'started'
            `, [roomName]);
        }

        if (event.event === 'participant_left') {
            // Schedule silence timeout check — if room still active after 2 min, terminate
            setTimeout(async () => {
                try {
                    const result = await pool.query(
                        `SELECT id FROM Sessions WHERE livekit_room_name = $1 AND status = 'started'
                         AND last_activity_at < CURRENT_TIMESTAMP - INTERVAL '2 minutes'`,
                        [roomName]
                    );
                    if (result.rows.length > 0) {
                        await pool.query(
                            `UPDATE Sessions SET status = 'timeout', ended_at = CURRENT_TIMESTAMP,
                             duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - created_at))::INTEGER
                             WHERE livekit_room_name = $1 AND status = 'started'`,
                            [roomName]
                        );
                        console.log(`[webhook] Session timed out due to silence: ${roomName}`);
                    }
                } catch (e) {
                    console.error('[webhook] Silence timeout check error:', e);
                }
            }, SILENCE_TIMEOUT_MS);
        }

        res.sendStatus(200);
    } catch (e: any) {
        console.error('[webhook] Error processing event:', e.message);
        res.sendStatus(400);
    }
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`Backend API listening on port ${port}`);
});
