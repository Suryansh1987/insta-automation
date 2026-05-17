# InstaFlow — Instagram DM Automation SaaS

Electron desktop app + Node.js API backend for plan-gated, AI-personalized Instagram DM automation.

---

## Architecture

```
Electron Desktop App  →  Backend API (Express + Prisma)  →  Neon DB (PostgreSQL)
         ↓
  Playwright Worker (child process per IG account, stdin/stdout IPC)
```

---

## Prerequisites

- Node.js 18+
- A [Neon](https://neon.tech) PostgreSQL database
- (Optional) Azure OpenAI endpoint for AI-personalized messages

---

## Setup

### 1. Clone & install

```bash
cd insta-saas
npm install
```

### 2. Configure the server

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:

```env
DATABASE_URL=postgresql://...@ep-xxx.neon.tech/instasaas?sslmode=require
JWT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
ENCRYPTION_KEY=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
PORT=3001
NODE_ENV=development
```

### 3. Run database migrations

```bash
npm run db:migrate
```

This creates all tables (`users`, `ig_accounts`, `automation_jobs`, `job_logs`).

### 4. Start development

In three separate terminals:

```bash
# Terminal 1 — API server
npm run dev:server

# Terminal 2 — Electron desktop app (starts Vite + Electron)
npm run dev:desktop
```

The worker starts automatically when an automation job is triggered from the UI.

---

## Subscription Plans

| Plan     | IG Accounts | Price   |
|----------|-------------|---------|
| Free     | 1           | $0/mo   |
| Pro      | 2           | $29/mo  |
| Business | 5           | $79/mo  |

Plan limits are enforced server-side only. The `POST /accounts/connect` route uses `enforcePlanLimit` middleware.

---

## API Routes

| Method | Route                     | Auth | Plan Guard |
|--------|---------------------------|------|------------|
| POST   | /auth/signup              | No   | No         |
| POST   | /auth/login               | No   | No         |
| GET    | /auth/me                  | Yes  | No         |
| GET    | /accounts                 | Yes  | No         |
| POST   | /accounts/connect         | Yes  | Yes        |
| DELETE | /accounts/:id             | Yes  | No         |
| GET    | /accounts/:id/session     | Yes  | No         |
| GET    | /plans                    | Yes  | No         |
| POST   | /plans/upgrade            | Yes  | No         |
| POST   | /automation/start         | Yes  | No         |
| POST   | /automation/stop/:jobId   | Yes  | No         |
| GET    | /automation/status/:jobId | Yes  | No         |

---

## Worker IPC Protocol

The Electron main process spawns one worker child process per IG account.

**Commands (main → worker, via stdin, newline-delimited JSON):**

```json
{ "cmd": "start", "accountId": "...", "jobId": "...", "username": "...", "password": "...", "sessionDir": "./sessions/...", "targets": [...], "defaultMessage": "...", "minDelayMs": 20000, "maxDelayMs": 60000, "azureOpenAiEndpoint": "...", "azureOpenAiKey": "...", "azureOpenAiDeployment": "gpt-4o-mini" }
{ "cmd": "stop" }
```

**Messages (worker → main, via stdout, newline-delimited JSON):**

```json
{ "type": "log",      "accountId": "...", "jobId": "...", "level": "info|warn|error", "message": "..." }
{ "type": "progress", "accountId": "...", "jobId": "...", "sent": 3, "failed": 1 }
{ "type": "status",   "accountId": "...", "jobId": "...", "status": "running|done|stopped|error", "sent": 3, "failed": 1 }
```

---

## Environment Variables

### `server/.env`

| Variable         | Description                                   |
|------------------|-----------------------------------------------|
| `DATABASE_URL`   | Neon PostgreSQL connection string             |
| `JWT_SECRET`     | 64-char hex string for JWT signing            |
| `ENCRYPTION_KEY` | 64-char hex string for AES-256-GCM sessions   |
| `PORT`           | API port (default: 3001)                      |
| `NODE_ENV`       | `development` or `production`                 |

### Azure OpenAI (in-app via UI)

Configured per-session in the Automation page. Stored in `localStorage` for convenience.

---

## Security

- Passwords hashed with bcrypt (cost 12)
- JWT tokens expire after 7 days
- Instagram passwords stored AES-256-GCM encrypted in DB
- Plan limits enforced server-side only
- Electron uses `contextIsolation: true`, `nodeIntegration: false`
- Workers receive credentials via IPC only — no direct DB access
