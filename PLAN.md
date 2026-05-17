# Instagram SaaS — Implementation Plan

> Last updated: 2026-05-17 — All tasks complete ✅

---

## Architecture

```
Electron Desktop App
  ├── Main Process    (window, IPC, worker spawner)
  ├── Preload         (contextBridge API to renderer)
  └── Renderer        (React + Vite UI)
        │
        │  HTTPS REST API (JWT Bearer token)
        ▼
Backend API Server    (Node.js + Express + TypeScript)
  ├── Auth routes
  ├── Accounts routes (plan-gated)
  ├── Plans routes
  └── Automation routes
        │
        │  Prisma ORM
        ▼
Neon DB (PostgreSQL)
  ├── users
  ├── ig_accounts     (session encrypted AES-256-GCM)
  ├── automation_jobs
  └── job_logs

Playwright Worker     (child_process per IG account)
  └── stdin/stdout JSON-line IPC with Electron main
```

---

## Subscription Plan Limits (enforced server-side only)

| Plan     | Max IG Accounts | Price   |
|----------|-----------------|---------|
| Free     | 1               | $0/mo   |
| Pro      | 2               | $29/mo  |
| Business | 5               | $79/mo  |

---

## Folder Structure

```
insta-saas/
├── package.json                  ✅ workspace root
├── tsconfig.base.json            ✅
├── .gitignore                    ✅
├── PLAN.md                       ✅ (this file)
│
├── packages/
│   └── shared/                   ✅
│       └── src/
│           ├── index.ts          ✅
│           └── types/
│               ├── plans.ts      ✅  PLAN_LIMITS, PLAN_FEATURES, Plan type
│               └── api.ts        ✅  all request/response types + WorkerMessage types
│
├── server/
│   ├── package.json              ✅
│   ├── tsconfig.json             ✅
│   ├── .env.example              ✅
│   ├── prisma/
│   │   └── schema.prisma         ✅  users, ig_accounts, automation_jobs, job_logs
│   └── src/
│       ├── index.ts              ✅  Express app entry, CORS, helmet, routes mounted
│       ├── db/
│       │   └── prisma.ts         ✅  singleton PrismaClient
│       ├── middleware/
│       │   ├── auth.ts           ✅  requireAuth (JWT verify → attach userId + plan)
│       │   ├── planGuard.ts      ✅  enforcePlanLimit (plan limit check)
│       │   └── error.ts          ✅  ZodError + generic error handler
│       ├── services/
│       │   └── crypto.ts         ✅  AES-256-GCM encryptSession / decryptSession
│       └── routes/
│           ├── auth.ts           ✅  POST /signup, POST /login, GET /me
│           ├── accounts.ts       ✅  GET /, POST /connect, DELETE /:id, GET /:id/session
│           ├── plans.ts          ✅  GET /plan, POST /upgrade
│           └── automation.ts     ✅  POST /start, POST /stop/:jobId, GET /status/:jobId
│
├── apps/
│   ├── worker/
│   │   ├── package.json          ✅
│   │   ├── tsconfig.json         ✅
│   │   └── src/
│   │       ├── worker.ts         ✅  stdin/stdout IPC handler, orchestrates automation
│   │       ├── instagram/
│   │       │   ├── client.ts     ✅  refactored from x-automation (multi-account config)
│   │       │   └── scraper.ts    ✅  copied from x-automation
│   │       ├── llm/
│   │       │   └── personalizer.ts ✅ migrated from x-automation
│   │       └── services/
│   │           └── delay.ts      ✅  copied from x-automation
│   │
│   └── desktop/
│       ├── package.json          ✅
│       ├── tsconfig.json         ✅
│       ├── tsconfig.electron.json ✅
│       ├── vite.config.ts        ✅
│       ├── index.html            ✅
│       ├── electron/
│       │   ├── main.ts           ✅  BrowserWindow, IPC handlers, worker spawner
│       │   └── preload.ts        ✅  contextBridge (worker namespace)
│       └── src/
│           ├── main.tsx          ✅  React root
│           ├── App.tsx           ✅  Router + protected route wrapper
│           ├── index.css         ✅
│           ├── api/
│           │   └── client.ts     ✅  axios + JWT interceptor + 401 redirect
│           ├── components/
│           │   └── Layout.tsx    ✅  nav sidebar + Outlet
│           ├── store/
│           │   └── auth.ts       ✅  Zustand: user, token, login(), logout()
│           └── pages/
│               ├── Login.tsx     ✅  email/password form → POST /auth/login
│               ├── Dashboard.tsx ✅  account summary cards, plan badge
│               ├── Accounts.tsx  ✅  list accounts, add modal, delete, plan gate UI
│               ├── Automation.tsx ✅ start/stop per account, target input
│               ├── Logs.tsx      ✅  live log stream from worker IPC messages
│               └── Plans.tsx     ✅  plan comparison table, upgrade CTA
│
└── README.md                     ✅  setup guide (Neon, env vars, dev commands)
```

---

## Task Progress

### Phase 1 — Monorepo Foundation
- [x] **Task 1** — Initialize monorepo root (`package.json`, `tsconfig.base.json`, `.gitignore`)
- [x] **Task 2** — Create shared types package (`Plan`, `PLAN_LIMITS`, all API + Worker IPC types)

### Phase 2 — Database
- [x] **Task 3** — Prisma schema (`users`, `ig_accounts`, `automation_jobs`, `job_logs`) + server `package.json` + `.env.example`

### Phase 3 — Backend API
- [x] **Task 4** — Backend core: `server/src/index.ts`, `db/prisma.ts`, `middleware/error.ts`
- [x] **Task 5** — Auth routes (`/signup`, `/login`, `/me`) + `requireAuth` JWT middleware
- [x] **Task 6** — Accounts routes + `enforcePlanLimit` middleware + AES-256-GCM crypto service
- [x] **Task 7** — Plans routes + Automation routes (`/start`, `/stop`, `/status`)

### Phase 4 — Playwright Worker
- [x] **Task 8** — Refactor `x-automation` code into `apps/worker/` with stdin/stdout IPC protocol

### Phase 5 — Electron Desktop App
- [x] **Task 9** — Electron main process + preload (contextBridge)
- [x] **Task 10** — React renderer: axios client, Zustand auth store, Router + protected routes
- [x] **Task 11** — All 6 React pages: Login, Dashboard, Accounts, Automation, Logs, Plans

### Phase 6 — Docs
- [x] **Task 12** — README: Neon DB setup, env vars, `npm install`, `prisma migrate dev`, dev run commands

---

## API Routes Reference

| Method | Route                       | Auth | Plan Guard | Description                        |
|--------|-----------------------------|------|------------|------------------------------------|
| POST   | /auth/signup                | No   | No         | Create account, returns JWT        |
| POST   | /auth/login                 | No   | No         | Login, returns JWT                 |
| GET    | /auth/me                    | Yes  | No         | Get current user profile           |
| GET    | /accounts                   | Yes  | No         | List linked IG accounts            |
| POST   | /accounts/connect           | Yes  | **Yes**    | Add new IG account (plan-gated)    |
| DELETE | /accounts/:id               | Yes  | No         | Remove IG account                  |
| GET    | /accounts/:id/session       | Yes  | No         | Get decrypted session for worker   |
| GET    | /plans                      | Yes  | No         | Get current plan + limits          |
| POST   | /plans/upgrade              | Yes  | No         | Upgrade plan (stub for Stripe)     |
| POST   | /automation/start           | Yes  | No         | Create & start automation job      |
| POST   | /automation/stop/:jobId     | Yes  | No         | Stop running job                   |
| GET    | /automation/status/:jobId   | Yes  | No         | Get job status + recent logs       |

---

## Security Notes

| Concern              | Solution                                              |
|----------------------|-------------------------------------------------------|
| Passwords            | bcrypt with cost factor 12                            |
| Auth tokens          | JWT, 7-day expiry, verified on every request          |
| Session data at rest | AES-256-GCM encrypted in DB, key only in server `.env`|
| Plan enforcement     | **Only on backend** in `enforcePlanLimit` middleware  |
| Electron token store | `electron-store` with app-level encryption key        |
| No DB in Electron    | Electron calls backend API only — never touches DB    |
| Worker isolation     | Child process, receives credentials via IPC only      |
| Context isolation    | `contextIsolation: true`, `nodeIntegration: false`    |

---

## Environment Variables

### server/.env
```
DATABASE_URL=postgresql://...@ep-xxx.neon.tech/instasaas?sslmode=require
JWT_SECRET=<64-char hex>
ENCRYPTION_KEY=<64-char hex>
PORT=3001
NODE_ENV=development
```

### apps/worker/.env (or passed via IPC)
```
AZURE_OPENAI_ENDPOINT=...
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI=gpt-4o-mini
AZURE_OPENAI_API_VERSION=2025-03-01-preview
PLAYWRIGHT_HEADLESS=true
```
