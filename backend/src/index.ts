import express from 'express';
import cors from 'cors';
import { AccessToken, WebhookReceiver } from 'livekit-server-sdk';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { pool } from './db.js';

dotenv.config();

// Use Application Default Credentials (ADC):
// - Locally:      reads ~/.config/gcloud/application_default_credentials.json (gcloud auth application-default login)
// - Cloud Run:    automatically uses the attached service account (same GCP project as Firebase)
// GOOGLE_CLOUD_PROJECT must be set in .env (the Firebase/GCP project ID).
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) {
    console.warn('[firebase] GOOGLE_CLOUD_PROJECT is not set. Firebase token verification will fail locally.');
}
admin.initializeApp({ projectId });

const app = express();
app.use(cors());

// Raw body needed for LiveKit webhook signature verification
app.use('/api/livekit-webhook', express.raw({ type: 'application/webhook+json' }));
app.use(express.json());

const SILENCE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

// ---------------------------------------------------------------------------
// Helper: verify Firebase ID token and return uid
// ---------------------------------------------------------------------------
async function verifyToken(req: express.Request): Promise<string | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return null;
    try {
        const decoded = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
        return decoded.uid;
    } catch (e) {
        console.warn('[auth] Token verification failed:', (e as Error).message);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Helper: reset credits if the monthly reset date has passed
// ---------------------------------------------------------------------------
async function ensureCreditsReset(userId: string) {
    await pool.query(`
        UPDATE Users
        SET credits_remaining = CASE plan WHEN 'plus' THEN 12 ELSE 8 END,
            credits_reset_at = date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month'
        WHERE id = $1 AND credits_reset_at <= CURRENT_TIMESTAMP
    `, [userId]);
}

// ---------------------------------------------------------------------------
// POST /api/onboard
// Called once after Firebase sign-in to persist the user and their native language.
// Body: { nativeLanguage: string }
// Returns: { id, firebase_uid, native_language, credits_remaining }
// ---------------------------------------------------------------------------
app.post('/api/onboard', async (req: express.Request, res: express.Response): Promise<any> => {
    const firebaseUid = await verifyToken(req);
    if (!firebaseUid) return res.status(401).json({ error: 'Unauthorized' });

    const { nativeLanguage } = req.body;
    if (!nativeLanguage) return res.status(400).json({ error: 'nativeLanguage is required' });

    if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'Database not configured' });

    try {
        let email: string | null = null;
        try {
            email = (await admin.auth().getUser(firebaseUid)).email ?? null;
        } catch (_) { }

        const result = await pool.query(`
            INSERT INTO Users (firebase_uid, email, native_language)
            VALUES ($1, $2, $3)
            ON CONFLICT (firebase_uid) DO UPDATE
                SET native_language = EXCLUDED.native_language,
                    email = COALESCE(EXCLUDED.email, Users.email)
            RETURNING id, firebase_uid, native_language, credits_remaining
        `, [firebaseUid, email, nativeLanguage]);

        res.json(result.rows[0]);
    } catch (e: any) {
        console.error('[onboard] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/user
// Returns the current user's profile from the DB.
// Returns 404 if the user has not been onboarded yet (native_language is null).
// ---------------------------------------------------------------------------
app.get('/api/user', async (req: express.Request, res: express.Response): Promise<any> => {
    const firebaseUid = await verifyToken(req);
    if (!firebaseUid) return res.status(401).json({ error: 'Unauthorized' });

    if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'Database not configured' });

    try {
        const result = await pool.query(
            'SELECT id, firebase_uid, native_language, credits_remaining, plan FROM Users WHERE firebase_uid = $1',
            [firebaseUid]
        );

        if (result.rows.length === 0 || !result.rows[0].native_language) {
            // User exists but hasn't completed onboarding, or doesn't exist yet
            return res.status(404).json({ error: 'User not onboarded' });
        }

        res.json(result.rows[0]);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/token
// Issues a LiveKit room token. Upserts user and deducts a credit.
// ---------------------------------------------------------------------------
app.post('/api/token', async (req: express.Request, res: express.Response): Promise<any> => {
    try {
        const firebaseUid = await verifyToken(req);

        const { lessonId } = req.body;
        if (!lessonId) return res.status(400).json({ error: 'lessonId is required' });

        const apiKey = process.env.LIVEKIT_API_KEY;
        const apiSecret = process.env.LIVEKIT_API_SECRET;
        if (!apiKey || !apiSecret) return res.status(500).json({ error: 'LiveKit credentials missing' });

        let userId = 'anonymous-' + uuidv4().substring(0, 8);
        let dbUserId: string | null = null;
        let nativeLanguage: string | null = null;

        if (firebaseUid && process.env.DATABASE_URL) {
            let email: string | null = null;
            try {
                email = (await admin.auth().getUser(firebaseUid)).email ?? null;
            } catch (_) { }

            const upsertResult = await pool.query(`
                INSERT INTO Users (firebase_uid, email)
                VALUES ($1, $2)
                ON CONFLICT (firebase_uid) DO UPDATE SET email = COALESCE(EXCLUDED.email, Users.email)
                RETURNING id, credits_remaining, credits_reset_at, native_language
            `, [firebaseUid, email]);

            const user = upsertResult.rows[0];
            dbUserId = user.id;
            userId = firebaseUid;
            nativeLanguage = user.native_language;

            await ensureCreditsReset(user.id);

            const fresh = await pool.query('SELECT credits_remaining FROM Users WHERE id = $1', [user.id]);
            if (fresh.rows[0].credits_remaining <= 0) {
                return res.status(403).json({ error: 'No credits remaining. Credits reset on the 1st of each month.' });
            }

            await pool.query('UPDATE Users SET credits_remaining = credits_remaining - 1 WHERE id = $1', [user.id]);
        }

        const roomName = `l-${lessonId}-${uuidv4().substring(0, 8)}`;

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

        // Return nativeLanguage so Classroom can use it for translation without an extra round-trip
        res.json({ token, roomName, userId, lessonId, nativeLanguage });
    } catch (err: any) {
        console.error('Error generating token:', err);
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/lessons
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// POST /api/livekit-webhook
// ---------------------------------------------------------------------------
app.post('/api/livekit-webhook', async (req: express.Request, res: express.Response): Promise<any> => {
    const apiKey = process.env.LIVEKIT_API_KEY!;
    const apiSecret = process.env.LIVEKIT_API_SECRET!;

    try {
        const receiver = new WebhookReceiver(apiKey, apiSecret);
        const event = await receiver.receive(req.body.toString(), req.headers['authorization'] as string);

        const roomName = event.room?.name;
        if (!roomName || !process.env.DATABASE_URL) return res.sendStatus(200);

        if (event.event === 'participant_left') {
            setTimeout(async () => {
                try {
                    await pool.query(
                        `UPDATE Sessions SET status = 'timeout', ended_at = CURRENT_TIMESTAMP,
                         duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - created_at))::INTEGER
                         WHERE livekit_room_name = $1 AND status = 'started'
                         AND last_activity_at < CURRENT_TIMESTAMP - INTERVAL '2 minutes'`,
                        [roomName]
                    );
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

// ---------------------------------------------------------------------------
// POST /api/translate
// Proxies to Azure Translator API. Never exposes the Azure key to the client.
// Body: { text: string, fromLang: string, toLang: string }  (BCP-47 codes, e.g. "en", "es")
// Returns: { translation: string } or { same: true } when fromLang === toLang
// ---------------------------------------------------------------------------
app.post('/api/translate', async (req: express.Request, res: express.Response): Promise<any> => {
    const { text, fromLang, toLang } = req.body;

    if (!text || !fromLang || !toLang) {
        return res.status(400).json({ error: 'text, fromLang, and toLang are required' });
    }

    // Same language — nothing to translate
    if (fromLang === toLang) {
        return res.json({ same: true });
    }

    const key = process.env.AZURE_TRANSLATE_KEY;
    const endpoint = process.env.AZURE_TRANSLATE_ENDPOINT;
    const region = process.env.AZURE_TRANSLATE_REGION;

    if (!key || !endpoint || !region) {
        return res.status(503).json({ error: 'Translation service not configured' });
    }

    try {
        // Azure Translator v3 URL format:
        // POST {endpoint}/translate?api-version=3.0&from={from}&to={to}
        const url = `${endpoint}/translate?api-version=3.0&from=${fromLang}&to=${toLang}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': key,
                'Ocp-Apim-Subscription-Region': region,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify([{ text }]),
        });

        if (!response.ok) {
            const errBody = await response.text();
            console.error('[translate] Azure error:', errBody);
            return res.status(502).json({ error: 'Translation service error' });
        }

        const data = await response.json();
        const translation = data[0]?.translations?.[0]?.text ?? '';
        res.json({ translation });
    } catch (e: any) {
        console.error('[translate] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`Backend API listening on port ${port}`);
});
