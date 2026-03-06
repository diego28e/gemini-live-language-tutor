# Devpost Write-up: Next-Gen Multimodal AI Language Tutor

## Inspiration
At my academy, Idiomas OCW, I primarily teach sequential group English lessons. However, forming a successful group class requires aligning three incredibly difficult factors: students must have the same proficiency level, the same intensity preference, and the same schedule availability. This logistical bottleneck makes it hard for students to maintain a consistent, personalized learning pace.

To solve this, I designed the Next-Gen Multimodal AI Language Tutor. I wanted to give my students on-demand, 15-minute private conversational lessons to supplement their human-led group classes. Instead of a rigid, text-based app, I needed an AI tutor that feels truly alive — one that hears your pronunciation, responds in real time, and handles interruptions gracefully, letting students progress at their own pace.

## What it does
The Next-Gen Multimodal AI Language Tutor provides structured 15-minute language lessons driven by the **Gemini 2.5 Live API**.

Users log in anonymously via Firebase and pick a lesson from a curated curriculum (e.g., "Ordering Food in a Restaurant" or "Job Interview Practice"), organized by CEFR level. Upon joining the classroom, LiveKit connects the user to a dedicated Node.js Gemini agent that follows a three-moment pedagogical structure: presentation, guided practice, and free roleplay.

The user speaks naturally. If the agent is mid-sentence and the user interrupts, the agent stops instantly and listens — a barge-in capability made possible by LiveKit's WebRTC integration. The agent gives immediate feedback on grammar and pronunciation, transitions between lesson moments without pausing, and always ends each turn with a question or prompt to keep the student engaged.

The user can also toggle their camera on at any point. When active, the agent receives a 1fps video feed and can see whatever the student holds up — a physical object, a handwritten word, a page from a textbook — and incorporate it naturally into the conversation.

## How we built it
- **Frontend (React + Vite + Tailwind):** Built with `@livekit/components-react` for the classroom UI, handling WebRTC audio, agent state visualization (speaking/listening), and a 15-minute countdown timer. Firebase Auth issues anonymous JWTs.
- **Backend (Node.js + PostgreSQL):** Hosted on Google Cloud Run. Validates Firebase JWTs, queries a Cloud SQL PostgreSQL database for lesson prompts, issues LiveKit tokens, and tracks session metrics.
- **The Agent (LiveKit Agents + Gemini):** Uses `@livekit/agents-plugin-google` for Node.js to instantiate the Gemini 2.5 Flash native audio model with structured system prompts pulled from the database, giving the AI deep context about the current lesson's pedagogical goals.
- **Infrastructure:** GCP resources (Cloud SQL, Cloud Run, Secret Manager) provisioned with Terraform.

## Challenges we ran into
- **The 1008 crash.** The biggest technical hurdle was a recurring unrecoverable WebSocket disconnect mid-conversation. The error — `APIStatusError: Operation is not implemented, or supported, or enabled, code 1008` — turned out to be a known bug in the December 2025 preview of the Gemini 2.5 Live model, which crashes when the model attempts internal tool/function calls. Since the September preview doesn't exhibit this behavior, switching the model string to `gemini-2.5-flash-native-audio-preview-09-2025` resolved it completely.
- **Vision support required bypassing the plugin entirely.** The `@livekit/agents-plugin-google` package has a `pushVideo()` method on `RealtimeSession`, but it's a stub — the implementation is literally a `// TODO` comment. Since the plugin doesn't forward video frames, we had to go one level deeper: subscribe to the user's video track directly via `VideoStream` from `@livekit/rtc-node`, throttle to 1fps, convert each frame from raw RGBA to JPEG using `sharp`, and send it to Gemini by calling `sendRealtimeInput` on the underlying `@google/genai` session object (accessed via a private field cast). No function calling involved — Gemini's Live API accepts image frames as native multimodal `realtimeInput` over the same WebSocket as audio.
- **ReadableStream contention.** An early attempt to stream live captions by listening on the `generation_created` event and iterating `messageStream` caused the agent's internal audio forwarding task to fail with `ReadableStream is locked`. The LiveKit agents framework owns those streams exclusively — tapping into them from outside breaks audio playback. The fix was to use the `ConversationItemAdded` event instead, which fires post-turn with no stream access.
- **Secure token flow.** Ensuring only authenticated users could receive LiveKit tokens required careful orchestration: Firebase anonymous auth on the frontend, JWT verification on the backend, and an upsert pattern to handle users who had never been seen before.

## Accomplishments that we're proud of
- Genuine conversational latency under 500ms. The tutor feels present, not robotic.
- Barge-in works flawlessly. You can interrupt mid-sentence and the agent responds immediately, which makes the conversation feel human rather than transactional.
- The three-moment lesson structure (presentation → practice → roleplay) runs entirely from database-driven prompts, making it trivial to add new lessons without touching agent code.

## What we learned
Working directly with a preview API means the ground shifts under you. The 1008 bug cost significant debugging time and wasn't a code problem at all — it was a server-side crash in a model that hadn't been fully stabilized. Reading raw WebSocket logs and cross-referencing community reports was the only way to diagnose it. Similarly, the vision feature looked straightforward on paper but required bypassing an unimplemented plugin method entirely and working directly with the underlying SDK.

## What's next
- Expanding the curriculum to 50+ language pairs.
- A post-lesson summary dashboard generated by Gemini, returning a score based on grammatical accuracy and stored in the `Metrics` table.

**Links:**
- 📹 [Demo Video](#)
- 👨‍💻 [GitHub Repository](#)
- 🏗️ [Architecture Diagrams](link-to-repo-docs)
