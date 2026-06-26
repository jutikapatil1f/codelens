# Deploying CodeLens

This guide covers everything needed to run CodeLens in development and to deploy
it to production. CodeLens is split into two deployable units plus three backing
services.

## Architecture at a glance

```
                 ┌─────────────────┐      REST + WebSocket      ┌──────────────────┐
   Browser  ───► │  Frontend       │ ─────────────────────────►│  Backend         │
                 │  Next.js 16     │                            │  NestJS (8080)   │
                 │  (Vercel/Node)  │ ◄───────────────────────── │                  │
                 └─────────────────┘                            └────────┬─────────┘
                                                                         │
                                              ┌──────────────┬───────────┼───────────────┐
                                              ▼              ▼           ▼                ▼
                                        ┌──────────┐  ┌───────────┐  ┌────────┐   ┌──────────────┐
                                        │ Postgres │  │  Redis    │  │  Bull  │   │ AI provider  │
                                        │ (TypeORM)│  │ (queue)   │  │ worker │   │ Ollama/Gemini│
                                        └──────────┘  └───────────┘  └────────┘   └──────────────┘
```

| Unit | Tech | Default port | Notes |
|------|------|--------------|-------|
| **Backend** | NestJS 11 | `8080` | REST API + Socket.IO presence gateway. Runs the Bull queue producer **and** the consumer in-process. |
| **Frontend** | Next.js 16 (App Router, React 19) | `3000` | Static + SSR; talks to the backend over HTTP and WS. **Not** in `docker-compose.yml` — deploy separately. |
| **Postgres** | 16 | `5432` | Persists users, analyses, chat messages, snippet shares. |
| **Redis** | 7 | `6379` | Backs the Bull job queue that offloads slow AI analysis off the HTTP path. |
| **AI provider** | Ollama (self-host) **or** Google Gemini | `11434` (Ollama) | Selected via `AI_PROVIDER`. |

---

## Environment variables

### Backend (`backend/.env`)

| Variable | Required | Example | Purpose |
|----------|----------|---------|---------|
| `DATABASE_URL` | ✅ | `postgresql://user:pass@host/db?sslmode=require` | Postgres connection string (TypeORM). |
| `REDIS_URL` | ✅ | `redis://localhost:6379` | Redis used by the Bull queue. |
| `JWT_SECRET` | ✅ | _long random string_ | Signs/verifies auth JWTs. **Must** be changed for production. |
| `PORT` | — | `8080` | HTTP/WS listen port. |
| `AI_PROVIDER` | ✅ | `ollama` or `gemini` | Which model backend to use. |
| `OLLAMA_URL` | if ollama | `http://localhost:11434` | Ollama server URL. |
| `OLLAMA_MODEL` | if ollama | `qwen2.5-coder:7b` | Model tag to pull/run. |
| `GEMINI_API_KEY` | if gemini | `AIza...` | Google AI Studio key. |

### Frontend (`frontend/.env.local`)

| Variable | Required | Example | Purpose |
|----------|----------|---------|---------|
| `NEXT_PUBLIC_API_URL` | ✅ | `https://api.codelens.example.com` | Backend base URL for REST calls. |
| `NEXT_PUBLIC_WS_URL` | ✅ | `wss://api.codelens.example.com` | Backend URL for the presence WebSocket. |

> `NEXT_PUBLIC_*` values are **baked into the build** at `next build` time, so they
> must be set before building the frontend — not just at runtime.

---

## Option A — Local stack with Docker Compose (fastest)

`docker-compose.yml` brings up the backend, Postgres, Redis, and Ollama together.
The frontend runs separately (it's a dev server during local work).

1. **Bring up the backing stack + backend:**
   ```bash
   docker compose up --build
   ```
   This builds the backend image (`backend/Dockerfile`), starts Postgres, Redis,
   and Ollama, and waits on health checks. The backend is then on
   `http://localhost:8080`.

2. **Pull the AI model into Ollama** (one time — the container starts empty):
   ```bash
   docker compose exec ollama ollama pull qwen2.5-coder:7b
   ```

3. **Run the frontend** (separate terminal):
   ```bash
   cd frontend
   npm install
   npm run dev          # http://localhost:3000
   ```

4. Open `http://localhost:3000`, register an account, and analyze a snippet.

> ⚠️ The committed `docker-compose.yml` points `DATABASE_URL` at a hosted Neon
> database and uses `JWT_SECRET: dev_secret_change_in_production`. For a fully
> local DB, change `DATABASE_URL` to `postgresql://dev:dev@postgres:5432/codelens`
> (matches the bundled `postgres` service) and rotate the secret. **Do not ship
> these committed credentials to production.**

### Running pieces individually (no Docker)

```bash
# Backend
cd backend && npm install && npm run start:dev      # nest watch mode on :8080

# Frontend
cd frontend && npm install && npm run dev           # next dev on :3000
```
You'll need a reachable Postgres, Redis, and AI provider per the env vars above.

---

## Option B — Production deployment

Deploy the four pieces to managed services. Any host that runs a Docker image or a
Node process works; concrete provider names below are examples.

### 1. Postgres
- Use a managed Postgres (Neon, RDS, Supabase, Railway). Copy its connection
  string into `DATABASE_URL`.
- The backend currently connects with `ssl: { rejectUnauthorized: false }`
  (see [app.module.ts](../backend/src/app.module.ts#L24)) — fine for Neon. Tighten
  this if your provider supplies a CA cert.
- **Schema:** the app runs with TypeORM `synchronize: true`, which auto-creates
  tables on boot. This is convenient but **not safe for production** — see the
  hardening checklist below before going live with real data.

### 2. Redis
- Provision a managed Redis (Upstash, ElastiCache, Railway) and set `REDIS_URL`.
  The queue producer and worker both run inside the single backend process, so one
  backend instance is enough to start. If you scale to multiple instances, they
  will share the queue correctly via Redis.

### 3. AI provider
Choose one and set `AI_PROVIDER` accordingly:
- **Gemini (simplest for prod):** set `AI_PROVIDER=gemini` and `GEMINI_API_KEY`.
  No self-hosting, no GPU.
- **Ollama (self-hosted/private):** run an Ollama server (ideally GPU-backed),
  set `AI_PROVIDER=ollama`, `OLLAMA_URL`, `OLLAMA_MODEL`, and pre-pull the model.

### 4. Backend
The backend ships with a multi-stage [Dockerfile](../backend/Dockerfile) that builds
and runs `node dist/main` on port `8080`.

```bash
cd backend
docker build -t codelens-backend .
docker run -p 8080:8080 --env-file .env codelens-backend
```

Deploy that image to Render / Fly.io / Railway / ECS / Cloud Run, injecting the
backend env vars as secrets. Health check endpoint for the platform:

```
GET /health      →  200 when the app (and DB probe) is up
```

(see [app.controller.ts](../backend/src/app.controller.ts)). Point the platform's
health check at `/health`.

> The Socket.IO presence gateway shares the same port. Ensure your load balancer /
> ingress allows **WebSocket upgrades** and uses sticky sessions (or a single
> instance) so socket connections stay pinned.

### 5. Frontend
Easiest target is **Vercel** (native Next.js host):
1. Set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` to your **public backend
   URLs** (use `https`/`wss`) in the project's environment settings.
2. Deploy — Vercel runs `next build` and hosts it.

Self-hosted alternative:
```bash
cd frontend
npm ci
npm run build
npm run start        # serves the production build on :3000
```
Put it behind a reverse proxy (Nginx/Caddy) for TLS, or containerize it.

### 6. CORS
The backend currently calls `app.enableCors()` with no origin restriction
(see [main.ts](../backend/src/main.ts)). Before production, lock CORS down to your
frontend's origin.

---

## Production hardening checklist

Run through this before exposing CodeLens publicly:

- [ ] **Stop using `synchronize: true`.** Generate TypeORM migrations, set
      `synchronize: false`, and run migrations as a deploy step. Auto-sync can
      drop/alter columns and lose data on schema drift.
- [ ] **Rotate `JWT_SECRET`** to a long random value, stored as a platform secret
      (never committed). Tokens currently expire after 1 day.
- [ ] **Remove committed credentials** from `docker-compose.yml` and `.env`; the
      Neon URL and dev secret in the repo must not be used in prod.
- [ ] **Restrict CORS** to the real frontend origin.
- [ ] **Enforce TLS** end to end (`https` REST, `wss` sockets).
- [ ] **WebSocket-aware ingress** with sticky sessions for the presence gateway.
- [ ] **Managed, backed-up Postgres and Redis**; confirm SSL settings match the
      provider.
- [ ] **Right-size the AI provider** — Ollama needs a GPU host for reasonable
      latency; Gemini needs a funded API key and rate-limit headroom.
- [ ] **Health checks + restart policy** wired to `/health`.

---

## Smoke test after deploy

1. `GET https://<backend>/health` → `200`.
2. Load the frontend; register a user (exercises Postgres + JWT).
3. Submit a snippet for analysis; confirm it moves from *pending* → *completed*
   (exercises Redis/Bull + the AI provider).
4. Open the same snippet in a second browser/session and confirm presence avatars
   and the edit lock appear (exercises the WebSocket gateway).
5. Share a snippet via the Share dialog and open it as the invited user.
