# Clement — Baby Routines

A calm, sage-toned app for tracking a newborn's daily routines via an LLM chat.

## Stack

- **Client**: Vite + React 18 + TypeScript
- **Server**: Hono on Node
- **Storage**: SQLite (better-sqlite3)
- **LLM**: Anthropic Claude (Sonnet) for natural-language intake — falls back to a deterministic rule-based parser when `ANTHROPIC_API_KEY` is not set

## Running

```bash
npm install
# optional: export ANTHROPIC_API_KEY=sk-...
npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:8787

The client proxies `/api/*` to the server.

## Project layout

```
server/                  Hono + SQLite + LLM proxy
  src/index.ts           Routes
  src/db.ts              SQLite schema + seed
  src/llm.ts             Claude-backed parser (rule-based fallback)
client/                  Vite + React + TS
  src/App.tsx
  src/components/        Screens (Chat, Today, Dashboard, Trends, Calendar, Modal)
  src/styles.css         Ported from the design prototype
```
