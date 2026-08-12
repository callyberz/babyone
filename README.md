# babyone — Baby Routines

A calm app for tracking a newborn's daily routines through chat and a shared caregiver timeline.

## Stack

- **Client**: Vite + React 18 + TypeScript
- **Server**: Hono on Node
- **Storage**: SQLite (better-sqlite3)
- **LLM**: Anthropic Claude (Sonnet) for natural-language intake, with an explicit rule-based fallback
- **Record tools**: In-process validated handlers; an optional MCP adapter exposes the same handlers to external consumers

## Running

```bash
npm install
# optional: export ANTHROPIC_API_KEY=sk-...
npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:8787

The client proxies `/api/*` to the server.

## Build & start (production)

```bash
npm run build
npm run start
```

The server serves the built client from its static root in production.

## Authentication

babyone is single-household but multi-caregiver. The first time the server boots
against an empty database it provisions an admin user from environment variables:

```
BABYONE_ADMIN_EMAIL=you@example.com
BABYONE_ADMIN_PASSWORD=<long random string>
BABYONE_ADMIN_NAME=Calvin
BABYONE_ORIGIN=https://babyone.fly.dev
```

(In dev, use `BABYONE_ORIGIN=http://localhost:5173`.)

After the first successful boot you can unset the `BABYONE_ADMIN_*` vars.
Administrator status is persisted in SQLite and no longer depends on those
bootstrap variables remaining in the environment.

Additional caregivers join via one-time invite links generated in the sidebar
("Invite caregiver"). Invites expire after 24h.

Production initialization creates schema and the bootstrap account only; it
does not create routine records or chat history. Demo data is opt-in for local
development with `BABYONE_SEED_DEMO=1`.

`GET /api/health` reports the LLM as `healthy`, `degraded`, or `unavailable`,
along with the active safe fallback mode.

**Password recovery:** there is no self-service reset. To recover a forgotten
password, an existing caregiver: (1) deletes the row from the `users` table
(`DELETE FROM users WHERE email = ?`) — sessions cascade-delete — (2) generates
a fresh invite for that caregiver to sign up again with the same email.

## Deployment

Containerized via `Dockerfile` and deployed to Fly.io (`fly.toml`). See [`DEPLOY.md`](./DEPLOY.md) for details.

## Project layout

```
packages/contracts/      Shared record contracts, validation, aggregation
server/                  Hono + SQLite + LLM integration
  src/index.ts           Routes (health, auth, baby, records, messages, chat)
  src/auth/              Passwords, sessions, invites, middleware, auth routes
  src/db.ts              SQLite schema + kv helpers
  src/seed.ts            Opt-in demo seed + first-admin bootstrap
  src/llm.ts             Claude-backed parser (rule-based fallback)
  src/parser.ts          Rule-based fallback parser
  src/prompts/           System prompt(s) for the chat assistant
  src/records/           In-process record tool service
  src/mcp/               Optional MCP adapter
client/                  Vite + React + TS
  src/App.tsx
  src/components/        Screens (Chat, Today, Dashboard, Trends, Calendar, Modal)
  src/styles.css         Ported from the design prototype
Dockerfile, fly.toml     Container + Fly.io deploy config
DEPLOY.md                Deployment runbook
docs/                    Specs and implementation plans
```
