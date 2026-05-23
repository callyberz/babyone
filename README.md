# babyone — Baby Routines

A calm, sage-toned app for tracking a newborn's daily routines via an LLM chat. The chat assistant takes the voice of a professional, experienced caregiver and writes records on the parent's behalf through MCP tools.

## Stack

- **Client**: Vite + React 18 + TypeScript
- **Server**: Hono on Node
- **Storage**: SQLite (better-sqlite3)
- **LLM**: Anthropic Claude (Sonnet) for natural-language intake — falls back to a deterministic rule-based parser when `ANTHROPIC_API_KEY` is not set
- **MCP**: Server-side Model Context Protocol integration for tool-driven record entry

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

Additional caregivers join via one-time invite links generated in the sidebar
("Invite caregiver"). Invites expire after 24h.

**Password recovery:** there is no self-service reset. To recover a forgotten
password, an existing caregiver: (1) deletes the row from the `users` table
(`DELETE FROM users WHERE email = ?`) — sessions cascade-delete — (2) generates
a fresh invite for that caregiver to sign up again with the same email.

## Deployment

Containerized via `Dockerfile` and deployed to Fly.io (`fly.toml`). See [`DEPLOY.md`](./DEPLOY.md) for details.

## Project layout

```
server/                  Hono + SQLite + LLM proxy
  src/index.ts           Routes (health, auth, baby, records, messages, chat)
  src/auth/              Passwords, sessions, invites, middleware, auth routes
  src/db.ts              SQLite schema + kv helpers
  src/seed.ts            Default baby seed
  src/llm.ts             Claude-backed parser (rule-based fallback)
  src/parser.ts          Rule-based fallback parser
  src/prompts/           System prompt(s) for the chat assistant
  src/types.ts           Shared server types
  src/mcp/               MCP server + client wiring
client/                  Vite + React + TS
  src/App.tsx
  src/components/        Screens (Chat, Today, Dashboard, Trends, Calendar, Modal)
  src/styles.css         Ported from the design prototype
Dockerfile, fly.toml     Container + Fly.io deploy config
DEPLOY.md                Deployment runbook
docs/                    Specs and implementation plans
```
