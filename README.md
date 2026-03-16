# Next-Gen Multimodal AI Language Tutor 🗣️

Built for the **Gemini Live Agents Hackathon**, this project is a real-time conversational AI language teacher powered by the Gemini 2.5 Live API and LiveKit.

## Core Features
- **Low-Latency Conversations:** Real-time audio interaction with < 500ms latency.
- **Natural Interruptions (Barge-in):** Speak while the AI is talking to instantly interrupt and redirect the conversation.
- **Vision Integration:** Toggle the "Show Teacher" video feed (1fps) to hold up objects or writing for the AI to analyze in real-time.
- **Structured Pedagogy:** 6 built-in lessons (English & Spanish) grounded in the CEFR framework.
- **Session Evaluation:** AI-generated feedback with grammar corrections, vocabulary notes, and next steps after every lesson.
- **Word Translation:** Select any word in the live captions to instantly translate it to your native language.

## Architecture

- **Frontend:** React + TypeScript + Vite + Tailwind CSS (Firebase Hosting)
- **Backend API:** Node.js Express on Cloud Run (scales to 0)
- **Agent Worker:** LiveKit Node.js Agent on Google Compute Engine VM (runs 24/7 — required for persistent WebSocket connections)
- **Database:** PostgreSQL on Cloud SQL
- **Real-time Engine:** LiveKit Cloud
- **Auth:** Firebase Anonymous Auth
- **Secrets:** Google Secret Manager

*See `architecture_logical.md` and `architecture_deployment.md` for Mermaid diagrams.*

---

## Part 1 — Running Locally

### Prerequisites

Make sure the following tools are installed and available in your terminal before starting:

| Tool | Purpose | Install |
|---|---|---|
| Node.js v18+ | Runtime for backend and frontend | https://nodejs.org |
| pnpm | Package manager | `npm install -g pnpm` |
| Docker Desktop | Local PostgreSQL database | https://www.docker.com/products/docker-desktop |
| Google Cloud CLI (`gcloud`) | Auth and project management | https://cloud.google.com/sdk/docs/install |
| Firebase CLI | Frontend deployment | `npm install -g firebase-tools` |
| Terraform | Infrastructure provisioning | https://developer.hashicorp.com/terraform/install |
| Cloud SQL Auth Proxy | Tunnel to Cloud SQL for remote schema migrations | https://cloud.google.com/sql/docs/postgres/sql-proxy |

> The Cloud SQL Auth Proxy binary (`cloud-sql-proxy`) is used in Part 2 to apply the database schema to the remote Cloud SQL instance. Download it and place it somewhere on your `PATH`.

---

### Step 1 — Start the Local Database

The project ships with a `docker-compose.yml` that spins up a PostgreSQL 18 container on port **5435** and automatically applies `database/schema.sql` on first boot (including all seed lessons).

From the project root:

```bash
docker compose up -d
```

Verify it is running:

```bash
docker compose ps
```

You should see `ai_tutor_db_local` with status `Up`. The schema and seed data are applied automatically on first start via the `docker-entrypoint-initdb.d` mount.

> Optional: pgAdmin is also available at http://localhost:5050 (email: `admin@admin.com`, password: `admin`). Connect to host `db`, port `5432`, user `postgres`, password `local_password`.

---

### Step 2 — Configure the Backend

```bash
cd backend
pnpm install
```

Create `backend/.env` (already exists if you cloned the repo — verify the values match):

```env
DATABASE_URL=postgresql://postgres:local_password@localhost:5435/ai-tutor-db
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_CLOUD_PROJECT=your_firebase_project_id

# Azure Translator (optional — translation feature will return an error if omitted)
AZURE_TRANSLATE_KEY=your_azure_key
AZURE_TRANSLATE_ENDPOINT=https://api.cognitive.microsofttranslator.com/
AZURE_TRANSLATE_REGION=southcentralus
```

---

### Step 3 — Run the Backend API Server

```bash
cd backend
pnpm run dev
```

The API server starts on **http://localhost:8080**. You should see:

```
Backend API listening on port 8080
```

---

### Step 4 — Run the LiveKit Agent

Open a **second terminal**:

```bash
cd backend
pnpm run agent
```

The agent process registers itself with LiveKit Cloud and waits for rooms to be created. You should see:

```
[agent] Health check server listening on port 8080
registered worker
```

> Both the API server and the agent must be running simultaneously for a full local session.

---

### Step 5 — Configure the Frontend

```bash
cd frontend
pnpm install
```

Create `frontend/.env` (already exists if you cloned — verify):

```env
VITE_API_URL=http://localhost:8080
VITE_LIVEKIT_URL=wss://your-project.livekit.cloud
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_firebase_project_id
```

---

### Step 6 — Run the Frontend

```bash
cd frontend
pnpm run dev
```

Navigate to **http://localhost:5173**. Click **Start Practice** on any lesson, grant microphone permissions, and the AI tutor will connect within a few seconds.

---

### Stopping Local Services

```bash
# Stop the database
docker compose down

# Stop the API server and agent with Ctrl+C in their respective terminals
```

To wipe the local database volume entirely (fresh start):

```bash
docker compose down -v
```

---

## Part 2 — Deploying to Production (GCP + Firebase)

### Prerequisites (Production)

In addition to the local tools above, you need:

- A **GCP project** with billing enabled. This guide uses project ID `ai-tutor-490117`.
- A **Firebase project** linked to the same GCP project (Firebase Console → Add project → use existing GCP project).
- A **LiveKit Cloud** account with an API Key, Secret, and WebSocket URL.
- A **Gemini API Key** (Google AI Studio or Vertex AI).
- A **Firebase Hosting** site initialized in the `frontend/` directory.
- Docker Desktop running (for building the backend image).

---

### Step 1 — Authenticate All CLI Tools

```bash
# Authenticate gcloud with your Google account
gcloud auth login

# Set Application Default Credentials (used by Terraform and the backend locally)
gcloud auth application-default login

# Set your new project as the active project
gcloud config set project ai-tutor-490117

# Authenticate Firebase CLI
firebase login
```

---

### Step 2 — Enable Billing and Core APIs

Terraform will enable most APIs automatically, but billing must be enabled manually first in the GCP Console:

1. Go to https://console.cloud.google.com/billing and link a billing account to `ai-tutor-490117`.
2. Then enable the base IAM API (required before Terraform can enable others):

```bash
gcloud services enable iam.googleapis.com --project=ai-tutor-490117
```

---

### Step 3 — Configure Terraform Variables

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Open `terraform/terraform.tfvars` and fill in your values:

```hcl
project_id    = "ai-tutor-490117"
region        = "us-east1"
backend_image = "us-east1-docker.pkg.dev/ai-tutor-490117/ai-tutor/backend:latest"
agent_image   = "us-east1-docker.pkg.dev/ai-tutor-490117/ai-tutor/backend:latest"
db_password   = "your_strong_password_here"
```

> Both `backend_image` and `agent_image` point to the same Docker image — the same binary serves both roles, just with a different startup command.

---

### Step 4 — Bootstrap the Artifact Registry (Chicken-and-Egg Fix)

Terraform needs your Docker image to deploy Cloud Run, but Docker needs the Artifact Registry to exist first. Solve this by creating only the registry first:

```bash
cd terraform
terraform init
terraform apply -target="google_artifact_registry_repository.main" -target="google_project_service.artifactregistry"
```

Type `yes` when prompted. This takes about 1 minute.

---

### Step 5 — Build and Push the Docker Image

```bash
# Authenticate Docker to push to Artifact Registry
gcloud auth configure-docker us-east1-docker.pkg.dev

# Build the image (run from the backend/ directory)
cd ../backend
docker build -t us-east1-docker.pkg.dev/ai-tutor-490117/ai-tutor/backend:latest .

# Push to Artifact Registry
docker push us-east1-docker.pkg.dev/ai-tutor-490117/ai-tutor/backend:latest
```

> The build compiles TypeScript and installs production dependencies. It takes 2–4 minutes on first build.

---

### Step 6 — Deploy All Infrastructure with Terraform

```bash
cd ../terraform
terraform apply
```

Type `yes` when prompted. This provisions:
- VPC network with private peering
- Cloud SQL PostgreSQL 15 instance (`db-f1-micro`)
- Secret Manager secrets (with placeholder values)
- Cloud Run service (Backend API)
- Compute Engine VM (LiveKit Agent Worker)
- Artifact Registry repository
- Service accounts and IAM bindings

**Wait 8–12 minutes** for Cloud SQL and the VM to fully initialize.

When complete, note the outputs:

```
backend_url              = "https://ai-tutor-backend-xxxx-ue.a.run.app"
agent_vm_ip              = "34.x.x.x"
database_connection_name = "ai-tutor-490117:us-east1:ai-tutor-db-xxxxxxxx"
database_public_ip       = "34.x.x.x"
artifact_registry_hostname = "us-east1-docker.pkg.dev/ai-tutor-490117/ai-tutor"
```

Save these — you will need them in the following steps.

---

### Step 7 — Populate Secret Manager with Real Values

Terraform created the secret containers with placeholder values. Now replace them with your real credentials:

```bash
# Set your project for convenience
export PROJECT=ai-tutor-490117

# LiveKit
echo -n "wss://your-project.livekit.cloud" | gcloud secrets versions add livekit-url --data-file=- --project=$PROJECT
echo -n "your_livekit_api_key"             | gcloud secrets versions add livekit-api-key --data-file=- --project=$PROJECT
echo -n "your_livekit_api_secret"          | gcloud secrets versions add livekit-api-secret --data-file=- --project=$PROJECT

# Gemini
echo -n "your_gemini_api_key" | gcloud secrets versions add gemini-api-key --data-file=- --project=$PROJECT

# Azure Translator (if you have it — otherwise use placeholder values to avoid errors)
echo -n "your_azure_translate_key"                        | gcloud secrets versions add azure-translate-key --data-file=- --project=$PROJECT
echo -n "https://api.cognitive.microsofttranslator.com/" | gcloud secrets versions add azure-translate-endpoint --data-file=- --project=$PROJECT
echo -n "southcentralus"                                  | gcloud secrets versions add azure-translate-region --data-file=- --project=$PROJECT
```

---

### Step 8 — Restart Services to Load the Real Secrets

Cloud Run and the VM were deployed with placeholder secrets. Force them to reload:

**Restart Cloud Run (Backend API):**

```bash
gcloud run services update ai-tutor-backend \
  --region us-east1 \
  --project ai-tutor-490117
```

**Reboot the VM (Agent Worker):**

```bash
gcloud compute instances reset ai-tutor-vm \
  --zone us-east1-b \
  --project ai-tutor-490117
```

> The VM zone is `us-east1-b` by default (first available zone in `us-east1`). Confirm the exact zone from the Terraform output or GCP Console if the command fails.

The VM startup script will re-run on reboot, pull the Docker image, fetch all secrets from Secret Manager, and start the agent container automatically. Allow **2–3 minutes** for the VM to fully boot.

---

### Step 9 — Apply the Database Schema (Cloud SQL Auth Proxy)

The Cloud SQL instance is brand new and empty. You need to apply `database/schema.sql` remotely using the **Cloud SQL Auth Proxy**.

**9a. Download the Cloud SQL Auth Proxy** (if not already on your PATH):

```bash
# macOS (Apple Silicon)
curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.1/cloud-sql-proxy.darwin.arm64
chmod +x cloud-sql-proxy

# macOS (Intel)
curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.1/cloud-sql-proxy.darwin.amd64
chmod +x cloud-sql-proxy

# Linux (amd64)
curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.1/cloud-sql-proxy.linux.amd64
chmod +x cloud-sql-proxy

# Windows (PowerShell)
Invoke-WebRequest -Uri "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.1/cloud-sql-proxy.windows.amd64.exe" -OutFile "cloud-sql-proxy.exe"
```

**9b. Start the proxy** in a dedicated terminal, using the `database_connection_name` from the Terraform output:

```bash
./cloud-sql-proxy "ai-tutor-490117:us-east1:ai-tutor-db-xxxxxxxx" --port 5436
```

You should see:

```
Listening on 127.0.0.1:5436
```

**9c. Apply the schema** in a second terminal (keep the proxy running):

```bash
psql "host=127.0.0.1 port=5436 dbname=ai-tutor-db user=postgres password=your_strong_password_here" \
  -f database/schema.sql
```

You should see a series of `CREATE TABLE` and `INSERT` confirmations. The schema creates the `Users`, `Lessons`, `Sessions`, and `Session_Evaluations` tables and seeds all 6 lessons.

**9d. Stop the proxy** with `Ctrl+C` once the schema is applied.

---

### Step 10 — Configure Firebase Hosting

**10a. Link the Firebase project to the frontend directory:**

```bash
cd frontend
firebase use ai-tutor-490117
```

If this is a brand new Firebase project, initialize hosting first:

```bash
firebase init hosting
```

When prompted:
- Use an existing project → select `ai-tutor-490117`
- Public directory → `dist`
- Configure as single-page app → `Yes`
- Set up automatic builds with GitHub → `No`

This will update `frontend/.firebaserc` with your project ID.

**10b. Enable Anonymous Authentication in Firebase Console:**

1. Go to https://console.firebase.google.com → select `ai-tutor-490117`
2. Build → Authentication → Get started
3. Sign-in method → Anonymous → Enable → Save

---

### Step 11 — Build and Deploy the Frontend

**11a. Set production environment variables:**

Open `frontend/.env.production` and fill in the values from the Terraform outputs and your accounts:

```env
VITE_API_URL=https://ai-tutor-backend-xxxx-ue.a.run.app
VITE_LIVEKIT_URL=wss://your-project.livekit.cloud
VITE_FIREBASE_API_KEY=your_firebase_web_api_key
VITE_FIREBASE_AUTH_DOMAIN=ai-tutor-490117.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=ai-tutor-490117
```

> Find your Firebase Web API Key at: Firebase Console → Project Settings → General → Your apps → Web app config.

**11b. Build and deploy:**

```bash
cd frontend
pnpm run build
firebase deploy
```

Firebase will output a Hosting URL like:

```
Hosting URL: https://ai-tutor-490117.web.app
```

Open that URL — the app is live.

---

### Step 12 — Verify Everything is Working

1. Open the Firebase Hosting URL in your browser.
2. Click **Start Practice** on any lesson.
3. Grant microphone permissions.
4. The connecting animation should appear, then transition to the tutor visualization within ~5–10 seconds.
5. Speak — the tutor should respond in real time.
6. The countdown timer starts only after the tutor connects.
7. After the session, return to the dashboard and wait ~30 seconds — a **View last feedback** button should appear on the lesson card.

**Checking VM agent logs** (if the agent doesn't connect):

```bash
gcloud compute ssh ai-tutor-vm --zone us-east1-b --project ai-tutor-490117
sudo cat /var/log/agent-startup.log
sudo docker logs agent-worker --tail 50
```

**Checking Cloud Run logs** (if the API returns errors):

```bash
gcloud run services logs read ai-tutor-backend --region us-east1 --project ai-tutor-490117 --limit 50
```

---

## Part 3 — Redeploying After Code Changes

### Backend changes (API or Agent)

Rebuild and push the Docker image, then force Cloud Run to redeploy and reboot the VM:

```bash
cd backend
docker build -t us-east1-docker.pkg.dev/ai-tutor-490117/ai-tutor/backend:latest .
docker push us-east1-docker.pkg.dev/ai-tutor-490117/ai-tutor/backend:latest

# Redeploy Cloud Run
gcloud run services update ai-tutor-backend --region us-east1 --project ai-tutor-490117

# Reboot VM to pull the new image
gcloud compute instances reset ai-tutor-vm --zone us-east1-b --project ai-tutor-490117
```

### Frontend changes only

```bash
cd frontend
pnpm run build
firebase deploy
```

---

## Part 4 — Tearing Down (terraform destroy)

When you want to remove all cloud resources and stop all billing:

```bash
cd terraform
terraform destroy
```

Type `yes` when prompted. This permanently deletes:
- The Cloud Run service
- The Compute Engine VM
- The Cloud SQL instance and all data
- The VPC network
- All Secret Manager secrets
- The Artifact Registry and all Docker images
- All service accounts and IAM bindings

> Firebase Hosting is **not** managed by Terraform. To remove it, go to Firebase Console → Hosting → and delete the site manually. The Firebase project itself can be deleted from GCP Console → IAM & Admin → Settings → Shut down project.

> **Warning:** `terraform destroy` is irreversible. All database data will be permanently lost.

---

## Environment Variable Reference

### `backend/.env` (local development)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `LIVEKIT_URL` | LiveKit Cloud WebSocket URL |
| `LIVEKIT_API_KEY` | LiveKit API key |
| `LIVEKIT_API_SECRET` | LiveKit API secret |
| `GEMINI_API_KEY` | Google Gemini API key |
| `GOOGLE_CLOUD_PROJECT` | Firebase/GCP project ID (for Firebase Admin SDK) |
| `AZURE_TRANSLATE_KEY` | Azure Cognitive Services Translator key |
| `AZURE_TRANSLATE_ENDPOINT` | Azure Translator endpoint URL |
| `AZURE_TRANSLATE_REGION` | Azure Translator region |

### `frontend/.env` (local) / `frontend/.env.production` (production)

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend API base URL |
| `VITE_LIVEKIT_URL` | LiveKit Cloud WebSocket URL |
| `VITE_FIREBASE_API_KEY` | Firebase Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |

### `terraform/terraform.tfvars`

| Variable | Description |
|---|---|
| `project_id` | GCP project ID |
| `region` | GCP region (default: `us-east1`) |
| `backend_image` | Full Artifact Registry image URI for Cloud Run |
| `agent_image` | Full Artifact Registry image URI for the VM agent |
| `db_password` | PostgreSQL password for Cloud SQL |
