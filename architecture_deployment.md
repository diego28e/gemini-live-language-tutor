# Deployment Architecture

```mermaid
graph TD
    subgraph Client
        UI["React + Vite App\n(Firebase Hosting)"]
    end

    subgraph Google Cloud Platform
        API["Node.js Express API\n(Cloud Run)"]
        Agent["LiveKit Node Agent\n(Cloud Run / Compute)"]
        DB[("PostgreSQL\n(Cloud SQL)")]
        SM["Secret Manager\n(API Keys)"]
    end

    subgraph LiveKit Cloud
        SFU["WebRTC SFU\n(Rooms & Routing)"]
    end

    subgraph Google Gemini
        AI["Gemini 2.5 Live API"]
    end

    UI <-->|HTTPS/JWT| API
    UI <-->|WebRTC (Audio/Video)| SFU
    API -->|Read/Write| DB
    API -->|Generate Tokens| SFU
    API -.->|Reads| SM
    Agent -.->|Reads| SM
    Agent <-->|WebRTC (Audio/Video)| SFU
    Agent <-->|WebSocket| AI
```
