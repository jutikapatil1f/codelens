# CodeLens — Developer Notes

> A refresher for understanding the backend after time away. Covers the architecture,
> how a request flows through the system, and the key concepts (written as the
> questions that come up while reading the code). File links point at the real source.

---

## 1. What CodeLens is

An AI-assisted code analysis app. A user submits a snippet of code; the backend runs it
through a local AI model (Ollama / llama3.2) and stores a written review they can read back.

**Stack:** NestJS 11 + TypeScript · PostgreSQL (Neon, cloud) via TypeORM · Redis + Bull
(job queue) · Ollama (local LLM) · JWT auth. Frontend is a Next.js scaffold (not yet wired).

---

## 2. The big picture — how an analysis flows

The core design is **asynchronous**: the HTTP request returns immediately, and the slow
AI work happens later in a background worker. The two halves are decoupled through Redis.

```
            SYNCHRONOUS (the HTTP request — returns in milliseconds)
 ┌──────────────────────────────────────────────────────────────────────┐
 │ POST /analyses {code, language}  + Bearer token                        │
 │   → JwtAuthGuard      verifies token, attaches request.user            │
 │   → ValidationPipe    validates the DTO (CreateAnalysisDto)            │
 │   → AnalysisController.create()                                        │
 │   → AnalysisService.create()                                          │
 │         • saves a row to Neon         (status: 'pending')             │
 │         • queue.add('analyze', {id})  → writes a job into Redis        │
 │         • returns the row             → HTTP 201, request DONE         │
 └──────────────────────────────────────────────────────────────────────┘
                                  │  (job now sits in Redis)
                                  ▼
            ASYNCHRONOUS (background worker — seconds to minutes later)
 ┌──────────────────────────────────────────────────────────────────────┐
 │ Bull hands the job to AnalysisProcessor.handleAnalyze()                │
 │   • status → 'processing'                                             │
 │   • AiService.analyzeCode()  → HTTP call to Ollama (the slow part)     │
 │   • status → 'completed' + result   (or 'failed' + error)             │
 └──────────────────────────────────────────────────────────────────────┘

 Client learns it's done by POLLING:  GET /analyses/:id  until status == 'completed'
 (No WebSocket push yet — see section 6.)
```

**Run order of the three core files:** `analysis.service` → `analysis.processor` → `ai.service`.
Each calls the next; none knows about the one before it. The service and processor are
**not continuous** — the request finishes before the processor starts; Redis sits between them.

---

## 3. File map

| File | Role |
|------|------|
| [backend/src/main.ts](backend/src/main.ts) | App bootstrap; registers global `ValidationPipe` + CORS |
| [backend/src/app.module.ts](backend/src/app.module.ts) | Wires TypeORM (Neon), Bull (Redis), and feature modules |
| **Auth** | |
| [backend/src/auth/auth.service.ts](backend/src/auth/auth.service.ts) | register/login: bcrypt hashing + JWT signing |
| [backend/src/auth/jwt.strategy.ts](backend/src/auth/jwt.strategy.ts) | Verifies incoming tokens, loads the user |
| [backend/src/auth/jwt-auth.guard.ts](backend/src/auth/jwt-auth.guard.ts) | The guard you put on protected routes |
| [backend/src/auth/current-user.decorator.ts](backend/src/auth/current-user.decorator.ts) | `@CurrentUser()` — pulls `request.user` into a param |
| [backend/src/users/users.service.ts](backend/src/users/users.service.ts) | User DB access |
| **Analysis** | |
| [backend/src/analysis/analysis.service.ts](backend/src/analysis/analysis.service.ts) | Saves row + enqueues job (the producer) |
| [backend/src/analysis/analysis.processor.ts](backend/src/analysis/analysis.processor.ts) | Background worker (the consumer) |
| [backend/src/analysis/ai.service.ts](backend/src/analysis/ai.service.ts) | Wraps the Ollama call |
| [backend/src/analysis/analysis.entity.ts](backend/src/analysis/analysis.entity.ts) | DB table shape for an analysis |

---

## 4. Concepts (the questions worth re-reading)

### Where do secrets / the DB string go?
In **`backend/.env`** — never the frontend. Anything in `frontend/.env` with a
`NEXT_PUBLIC_` prefix is bundled into the browser and publicly visible. `.env` is gitignored.

### What does `sslmode=require` do? (in `DATABASE_URL`)
Forces an **encrypted** connection to the DB and refuses to connect if SSL isn't available.
It encrypts traffic but does **not** verify the server's identity (that's `verify-full`).
Neon is a remote cloud DB, so encryption is essential. In code, `ssl: { rejectUnauthorized: false }`
in [app.module.ts](backend/src/app.module.ts) mirrors this (encrypt, don't reject on unverified cert).

### What does `bcrypt.compare(plaintext, hash)` do?
Login password check. You never store the real password — only a one-way bcrypt **hash**.
`compare` re-hashes the typed password with the salt baked into the stored hash and checks
if they match. Returns `true`/`false`. Used in [auth.service.ts](backend/src/auth/auth.service.ts).

### What does `signToken()` do?
Creates the JWT after a successful register/login. Builds a payload `{ sub: userId, email }`,
signs it with `JWT_SECRET`, returns `{ accessToken }`. The token is **signed, not encrypted** —
anyone can read the payload (don't put secrets in it); the signature only prevents tampering.
See [auth.service.ts](backend/src/auth/auth.service.ts).

### What is a DTO?
**Data Transfer Object** — a class defining the expected shape of a request body, with
`class-validator` decorators. The global `ValidationPipe` validates it and rejects bad input
with a `400` before your controller runs. It also strips unknown fields. The DTO is the API
*request* shape; the **entity** is the DB *table* shape — kept separate on purpose (e.g. clients
send `code` but never `status`/`userId`). See [create-analysis.dto.ts](backend/src/analysis/dto/create-analysis.dto.ts).

### What is the request lifecycle / order of execution?
`Middleware (CORS) → Guards → Pipes → Controller → Service → (Interceptors after) → response`.
Both gates can stop the request early:
- **Guard** (`JwtAuthGuard`) — authentication: "are you allowed in?" → `401` if not.
- **Pipe** (`ValidationPipe`) — input shape: "is your data valid?" → `400` if not.
Public routes (like `POST /auth/login`) have **no guard**; protected routes (`/analyses`) do.
Each layer lets the next one trust more.

### Where are the interceptors?
**There are none.** The "interceptors (after)" step in the lifecycle is NestJS's *default*
JSON serialization — that slot is empty in this codebase. An interceptor wraps the handler and
can transform input/output (logging, response envelopes, hiding fields). `@CurrentUser` is **not**
an interceptor — it's a param decorator that just extracts `request.user`.

### What is `@Injectable()`?
Marks a class as a **provider** that NestJS's dependency-injection system can create and inject
into others. It's why constructors can just *ask* for `ConfigService`, `UsersService`, etc. —
Nest builds and supplies them (as shared singletons). A class gets `@Injectable()` if it has
dependencies or is one. Example: [jwt.strategy.ts](backend/src/auth/jwt.strategy.ts).

### What does the processor do?
It's the **background worker** — the consumer side of the Bull queue. Bull hands it each
`analyze` job; it loads the row, sets `processing`, calls `AiService`, then writes `completed`
(or `failed`). It exists separately from the request so the slow AI call doesn't block the HTTP
response and survives restarts (jobs live in Redis). See [analysis.processor.ts](backend/src/analysis/analysis.processor.ts).
Re-throwing on error is deliberate — it tells Bull the job failed (so it can retry).

### How is Redis used exactly?
Redis is the **backing store for the Bull job queue** — you write zero Redis code; Bull does it.
- Configured once in [app.module.ts](backend/src/app.module.ts) (`BullModule.forRootAsync` reads `REDIS_URL`).
- `queue.add()` (producer) → Bull writes the job into Redis (a hash `bull:analysis:<id>` + a wait list).
- The worker (consumer) blocks on Redis waiting for jobs, pops one, runs the processor.
- Bull tracks waiting/active/completed/failed jobs, retries, and stall detection — all as Redis keys.
- Only the row **id** travels through the queue; the full record stays in Postgres.
Mental model: **Bull = the queue library; Redis = the database the queue lives in.**

### What is `forRootAsync` (vs `forRoot`)?
`forRoot({...})` = configure with values you already have. `forRootAsync({...})` = "I need to
look something up first" — used when config depends on `ConfigService` (reading `.env`).
`inject: [ConfigService]` + `useFactory: (config) => ({...})`: Nest builds `ConfigService` first,
hands it to your factory, and you return the finished config (DB url, Redis host, etc.).

---

## 5. How to run & verify

```bash
# 1. Infra (Redis + Ollama as Docker containers; Postgres is Neon/cloud, not here)
docker compose up -d redis ollama
docker exec codelens-redis-1 redis-cli ping            # → PONG
curl -s http://localhost:11434/api/tags                # → should list llama3.2
# (first time only) docker exec codelens-ollama-1 ollama pull llama3.2

# 2. Backend
cd backend && npm run start:dev                        # wait for "Nest application successfully started"
curl http://localhost:8080/health/db                   # → {"status":"ok","database":"up"}

# 3. Full flow
TOKEN=$(curl -s -X POST http://localhost:8080/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"me@example.com","password":"supersecret123"}' | jq -r .accessToken)

ID=$(curl -s -X POST http://localhost:8080/analyses \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"language":"javascript","code":"function add(a,b){return a-b}"}' | jq -r .id)

curl -s http://localhost:8080/analyses/$ID -H "Authorization: Bearer $TOKEN"  # poll until completed
```

**Endpoints:** `POST /auth/register`, `POST /auth/login`, `GET /auth/me` (protected) ·
`POST /analyses`, `GET /analyses`, `GET /analyses/:id` (all protected, scoped to the owner) ·
`GET /health`, `GET /health/db`.

**Note on local AI speed:** Ollama runs CPU-only here (no GPU), so each analysis takes
30–90s and pegs the CPU, which can briefly starve the API. That's an environment limitation,
not a bug — and exactly why the queue/worker design exists. In production you'd run Ollama on a
GPU or swap to the Gemini provider (`AI_PROVIDER` / `GEMINI_API_KEY` are already in `.env`).

---

## 6. Current state & what's NOT built yet

**Done & verified:** auth (register/login/JWT) · async analysis pipeline (queue → worker → Ollama)
· per-user persistence in Neon · health checks.

**Not built yet:**
- **WebSocket push** — *planned only.* No gateway, no deps installed. The README mentions it and
  `frontend/.env` has a `NEXT_PUBLIC_WS_URL` placeholder, but nothing is wired. Today the client
  must **poll** for results.
- **Frontend** — still the Next.js scaffold (`@monaco-editor/react` is installed; nothing wired).
- **Hardening** — `synchronize: true` is on (dev-only; switch to migrations before prod);
  `JWT_SECRET` is still a placeholder; no rate-limiting or Bull retry/backoff config yet.

---

*Reading order to re-learn the flow:* `analysis.service.ts` → `analysis.processor.ts` →
`ai.service.ts`, then `auth.service.ts` + `jwt.strategy.ts` for how requests get authenticated.
