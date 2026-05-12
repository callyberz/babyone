# Deploy — Fly.io

## App

- **Name**: `babyone`
- **Hostname**: `babyone.fly.dev`
- **Region**: `yyz` (primary)
- **VM**: shared-cpu, 1 cpu, 512 MB
- **Image**: built from root `Dockerfile` (multi-stage, `node:22-slim`)
- **Config**: `fly.toml`, `Dockerfile`, `.dockerignore` at repo root

## Runtime layout

- Runtime `WORKDIR` is `/app/server`; entry is `node dist/index.js`.
- npm workspaces hoist deps to `/app/node_modules` — there is **no** `/app/server/node_modules`. Do not `COPY` it in the Dockerfile.
- The Hono server serves both the API and the SPA from one process:
  - `/api/*` — JSON endpoints (registered first, so they win).
  - `/assets/*` and `*` fallback → `client/dist/index.html`. Single origin, no CORS needed in practice.

## Ports & idle behavior

- Container listens on `8080` (`PORT` env).
- `fly.toml` → `http_service.internal_port = 8080`, `force_https = true`.
- `auto_stop_machines = "stop"`, `auto_start_machines = true`, `min_machines_running = 0` — machine sleeps when idle and cold-starts on first request.

## Persistence

- Volume `babyone_data` mounted at `/data`. Single machine, **not replicated**.
- SQLite at `/data/data.db` via `BABYONE_DB` env.

## Secrets

- `ANTHROPIC_API_KEY` set via `fly secrets set ANTHROPIC_API_KEY=...`.

## Build prerequisite

`npm run build` must pass `tsc -b` (strict, `noUnusedLocals`). If the client build fails on an unused symbol, drop it rather than prefixing with `_`.

## Common operations

```bash
# Status
fly status -a babyone
fly logs -a babyone
fly secrets list -a babyone

# Pause (reversible, keeps volume + data)
fly scale count 0 -a babyone
fly scale count 1 -a babyone   # resume

# Take offline but keep running (release public IPs)
fly ips list -a babyone
fly ips release <ip-v4> -a babyone
fly ips release <ip-v6> -a babyone

# Back up the SQLite DB
fly ssh sftp get /data/data.db ./babyone-backup.db -a babyone

# Destroy app (irreversible — deletes volume + data)
fly apps destroy babyone

# Re-deploy after code changes
fly deploy
```

## First-time setup (for reference)

```bash
brew install flyctl
fly auth login
fly launch --no-deploy --copy-config --name babyone --region yyz
fly volumes create babyone_data --region yyz --size 1
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
fly deploy
```

## Known issues

- **LLM endpoint silently falls back to rule-based parser.** `/api/health` returns `{ok:true, llm:true}` (Anthropic client constructed), but `/api/chat` round-trips in ~170 ms and returns the canned wording from `server/src/parser.ts:182`. The Claude tool-use call is throwing and `llmParse`'s `catch` block routes through `fallbackPath` without surfacing the error to the response. To debug: pull `fly logs -a babyone` and look for `[llm] tool-use loop failed`.
- **No auth.** Anyone with the URL can write records and burn API credits. Options: app-level IP allowlist via `Fly-Client-IP` header, shared-secret cookie, or release public IPs and reach the app over `fly proxy` / WireGuard.
