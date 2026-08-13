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
- SQLite runs in WAL mode. Never treat a raw copy of `/data/data.db` as a
  backup: committed data may still be in `/data/data.db-wal`.

## Secrets

- `ANTHROPIC_API_KEY` set via `fly secrets set ANTHROPIC_API_KEY=...`.
- `BABYONE_ORIGIN` set via `fly secrets set BABYONE_ORIGIN=https://babyone.fly.dev`.
- For the *first* deploy against an empty DB, also set
  `BABYONE_ADMIN_EMAIL`, `BABYONE_ADMIN_PASSWORD`, `BABYONE_ADMIN_NAME`.
  After the machine boots once and logs "Created admin user …", run
  `fly secrets unset BABYONE_ADMIN_EMAIL BABYONE_ADMIN_PASSWORD BABYONE_ADMIN_NAME`.
  The administrator role is stored in SQLite, so removing these bootstrap
  secrets does not change permissions.
- Do not set `BABYONE_SEED_DEMO` in production. Fresh production databases are
  intentionally free of demo records and messages.

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

# Destroy app (irreversible — deletes volume + data)
fly apps destroy babyone

# Re-deploy after code changes
fly deploy
```

## Database backup and recovery verification

The supported backup command uses SQLite's online backup API while the app is
running. It then converts the snapshot to a self-contained, single-file
journal, runs `PRAGMA integrity_check`, verifies the required schema, and prints
key table counts. It refuses to overwrite an existing destination.

Choose a unique UTC-stamped name and run:

```bash
# 1. Create and validate the snapshot on the persistent Fly volume.
fly ssh console -a babyone -C "node dist/ops/databaseBackup.js backup --source /data/data.db --output /data/backups/babyone-2026-08-13T1900Z.db"

# 2. Download the verified artifact to the operator recovery directory.
mkdir -p ./backups
fly ssh sftp get /data/backups/babyone-2026-08-13T1900Z.db ./backups/babyone-2026-08-13T1900Z.db -a babyone

# 3. Verify restoration from a disposable local copy. This never opens the
#    configured BABYONE_DB and does not mutate the downloaded artifact.
npm run build
npm --workspace server run db:verify-restore -- --file ./backups/babyone-2026-08-13T1900Z.db
```

The local recovery location is `./backups/` (database files are gitignored).
Move verified backups to encrypted, access-controlled storage according to the
household's retention policy. The Fly copy under `/data/backups/` is useful for
quick recovery but is on the same unreplicated volume and is not an off-site
backup.

For a local or one-off database, the equivalent command is:

```bash
npm run build
npm --workspace server run db:backup -- --source ./server/data.db --output ./backups/babyone-local.db
```

Important recovery cautions:

- `db:verify-restore` verifies a disposable copy; it deliberately does not
  replace production data.
- Never upload over `/data/data.db`, rename database files, or remove `-wal` /
  `-shm` files while the application machine is running.
- Before a production replacement, retain both the downloaded verified backup
  and a fresh pre-restore online backup. Stop all writers, perform the swap in a
  maintenance window, and start only one machine against the volume.
- After replacement, confirm `/api/health`, sign-in, baby profile, record and
  message counts before removing the pre-restore copy. If those checks fail,
  keep the machine stopped and roll back to the pre-restore snapshot.
- Do not use `fly ssh sftp get /data/data.db`; copying only the live WAL-mode
  main file is not a recoverable backup procedure.

## First-time setup (for reference)

```bash
brew install flyctl
fly auth login
fly launch --no-deploy --copy-config --name babyone --region yyz
fly volumes create babyone_data --region yyz --size 1
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
fly deploy
```

## LLM status

`/api/health` reports `llm.state` as `healthy`, `degraded`, or `unavailable`.
Both degraded and unavailable operation stay inside the deterministic
rule-based fallback boundary; prompts and tool payloads are not logged.
