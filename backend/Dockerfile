# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@10.26.0 --activate

# Install all deps (including devDeps for tsc)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Compile TypeScript → dist/
COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm build

# ─── Production stage ─────────────────────────────────────────────────────────
FROM node:22-slim AS production

WORKDIR /app

# node:22-slim strips the system CA bundle; @livekit/rtc-node's Rust TLS stack
# requires it to make HTTPS calls (Node's built-in CA store is not enough).
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.26.0 --activate

# Production dependencies only (includes native binaries for sharp & rtc-node)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Copy compiled output from build stage
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=8080

# Default entry point: HTTP API server
# The agent Cloud Run service overrides this with ["node", "dist/agent.js"]
CMD ["node", "dist/index.js"]
