# CodeLens

CodeLens is an early-stage full-stack project intended to provide AI-assisted code
analysis through a web application. The repository currently contains a Next.js
frontend scaffold, a NestJS backend API scaffold, and a Docker Compose definition
for the application and its supporting services.

> **Project status:** Initial scaffold. The frontend and backend can be run
> locally. The backend currently exposes a health endpoint; product features and
> persistence have not been implemented yet.

## Planned stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Code editor | Monaco Editor |
| Backend | NestJS 11, TypeScript |
| Database | PostgreSQL 16 |
| Cache / queue | Redis 7 |
| Realtime transport | Planned NestJS WebSocket gateway |
| Authentication | JWT |
| AI providers | Ollama for local models; Gemini configuration is also present |
| Local orchestration | Docker Compose |

## Repository structure

```text
codelens/
├── backend/              # NestJS API and local backend environment file
│   ├── src/              # Application modules, controllers, and services
│   ├── test/             # End-to-end tests
│   ├── Dockerfile
│   └── package.json
├── frontend/             # Next.js App Router application
└── docker-compose.yml    # PostgreSQL, Redis, Ollama, and planned backend
```

## Prerequisites

- Node.js 20 or later
- npm
- Docker with Docker Compose
- An Ollama model or an API key for the configured hosted AI provider

## Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The current page is the
default Next.js starter screen.

Useful frontend commands:

```bash
npm run lint     # Run ESLint
npm run build    # Create a production build
npm run start    # Serve the production build
```

## Run the backend

```bash
cd backend
npm install
npm run start:dev
```

The API runs at [http://localhost:8080](http://localhost:8080). Verify it with:

```bash
curl http://localhost:8080/health
```

The response is:

```json
{"status":"ok"}
```

Useful backend commands:

```bash
npm run lint       # Run ESLint
npm test           # Run unit tests
npm run test:e2e   # Run end-to-end tests
npm run build      # Compile the production application
npm run start:prod # Run the compiled application
```

## Backend configuration

Backend configuration is read from environment variables. Create
`backend/.env` locally and keep it out of version control. The repository's
`.gitignore` already excludes this file.

```dotenv
DATABASE_URL=postgres://dev:dev@localhost:5432/codelens
REDIS_URL=redis://localhost:6379
AI_PROVIDER=ollama
OLLAMA_URL=http://localhost:11434
GEMINI_API_KEY=
JWT_SECRET=replace_with_a_long_random_secret
PORT=8080
```

Never commit real API keys, database credentials, or production JWT secrets.

### Environment variables

| Variable | Purpose | Local example |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://dev:dev@localhost:5432/codelens` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `AI_PROVIDER` | Selects the AI integration | `ollama` |
| `OLLAMA_URL` | Ollama server address | `http://localhost:11434` |
| `GEMINI_API_KEY` | Credential for Gemini, when used | Leave empty for Ollama |
| `JWT_SECRET` | Secret used to sign authentication tokens | A long random value |
| `PORT` | Backend HTTP port | `8080` |

## Supporting services

The Compose file defines the NestJS backend, PostgreSQL, Redis, and Ollama. Start
the full backend stack with:

```bash
docker compose up --build
```

Their default local ports are:

| Service | Port |
| --- | --- |
| PostgreSQL | `5432` |
| Redis | `6379` |
| Ollama | `11434` |
| Backend API | `8080` |
| Frontend development server | `3000` |

The Compose configuration uses named volumes for PostgreSQL and Ollama data.
Stop the services with:

```bash
docker compose down
```

## Current limitations

- Only the backend health route is currently implemented.
- No product API routes, database schema, or API contract are implemented.
- The frontend is not connected to a backend API yet.
- Continuous integration is not configured.

Document new API endpoints and database migrations here as those interfaces are
implemented.
