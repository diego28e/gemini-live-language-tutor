# Next-Gen Multimodal AI Language Tutor 🗣️

Built for the **Gemini Live Agents Hackathon**, this project is a real-time conversational AI language teacher powered by the Gemini 2.5 Live API and LiveKit.

## Core Features
- **Low-Latency Conversations:** Real-time audio interaction with < 500ms latency.
- **Natural Interruptions (Barge-in):** Speak while the AI is talking to instantly interrupt and redirect the conversation.
- **Vision Integration:** Toggle the "Show Teacher" video feed (1fps) to hold up objects or writing for the AI to analyze in real-time.
- **Structured Pedagogy:** 6 built-in lessons (English & Spanish) grounded in the CEFR framework.

## Architecture

- **Frontend:** React + TypeScript + Vite + Tailwind CSS (Hosted on Firebase)
- **Backend API:** Node.js Express (Cloud Run)
- **Agent Server:** LiveKit built-in Node.js Agent using `@livekit/agents-plugin-google`
- **Database:** PostgreSQL (Cloud SQL)
- **Real-time Engine:** LiveKit Cloud

*See `architecture_logical.md` and `architecture_deployment.md` for Mermaid diagrams.*

## Running Locally

### Prerequisites
- Node.js (v18+)
- pnpm
- LiveKit Cloud account (API Key & Secret)
- Full Google Gemini API Key
- Firebase Project configured for Anonymous Auth
- PostgreSQL database

### 1. Database Setup
Execute the SQL in `database/schema.sql` against your PostgreSQL database to create the schema and seed the initial 6 lessons.

### 2. Backend Setup
```bash
cd backend
pnpm install
```
Create a `.env` file in `backend/`:
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/aitutor
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret
GEMINI_API_KEY=your_gemini_key
```
Run the API server:
```bash
pnpm run dev
```
Run the LiveKit Agent process (in a separate terminal):
```bash
pnpm run agent
```

### 3. Frontend Setup
```bash
cd frontend
pnpm install
```
Create a `.env` file in `frontend/`:
```env
VITE_API_URL=http://localhost:8080
VITE_LIVEKIT_URL=wss://your-project.livekit.cloud
VITE_FIREBASE_API_KEY=your_key
VITE_FIREBASE_AUTH_DOMAIN=your_domain
VITE_FIREBASE_PROJECT_ID=your_id
```
Start the frontend:
```bash
pnpm run dev
```

Navigate to `http://localhost:5173`. Click "Start Practice", grant microphone/camera permissions, and start learning!

## Infrastructure (Bonus)
The `terraform/` directory contains the IaC definitions for deploying the Cloud Run service and Cloud SQL instances. All secrets are managed via Google Secret Manager.
