import express from 'express';
import cors from 'cors';
import { AccessToken } from 'livekit-server-sdk';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { pool } from './db.js';

dotenv.config();

// Initialize Firebase Admin
if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (e) {
        console.error("Failed to initialize Firebase Admin:", e);
    }
} else {
    console.warn("No FIREBASE_SERVICE_ACCOUNT_KEY found. Firebase auth validation will be skipped or mock.");
}

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/token', async (req: express.Request, res: express.Response): Promise<any> => {
    try {
        const authHeader = req.headers.authorization;
        let userId = 'anonymous-' + uuidv4().substring(0, 8);

        // Validate JWT
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split('Bearer ')[1];
            if (admin.apps.length > 0) {
                const decodedToken = await admin.auth().verifyIdToken(token);
                userId = decodedToken.uid;
            }
        }

        const { lessonId } = req.body;
        if (!lessonId) {
            return res.status(400).json({ error: 'lessonId is required' });
        }

        // Generate room name
        const roomName = `lesson-${lessonId.substring(0, 8)}-${uuidv4().substring(0, 8)}`;

        // Generate LiveKit token
        const apiKey = process.env.LIVEKIT_API_KEY;
        const apiSecret = process.env.LIVEKIT_API_SECRET;

        if (!apiKey || !apiSecret) {
            return res.status(500).json({ error: 'LiveKit credentials missing' });
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
            // Mock data if no DB
            return res.json([
                { id: 'mock-1', title: 'Mock Ordering Food', cefr_level: 'A2', language: 'English' }
            ]);
        }
        const result = await pool.query('SELECT * FROM Lessons');
        res.json(result.rows);
    } catch (e: any) {
        console.error("DB Error fetching lessons:", e);
        res.status(500).json({ error: e.message });
    }
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`Backend API listening on port ${port}`);
});
