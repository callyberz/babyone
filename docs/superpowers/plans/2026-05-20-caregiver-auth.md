# Caregiver Sharing & Authentication — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email/password authentication, server-side sessions, and invite-only signup so two or more caregivers can share a single household instance of babyone.

**Architecture:** Hand-rolled auth over `@node-rs/argon2` + Hono cookie helpers. Sessions stored as opaque IDs in SQLite, set via `HttpOnly` cookie. CSRF defended by `SameSite=Lax` + `Origin` header check. Single household — no `household_id` column. Records gain a `user_id` column populated from the session, never the request body.

**Tech Stack:** Hono (server), better-sqlite3, `@node-rs/argon2`, React + TanStack Query (client), Vitest (newly introduced).

**Source spec:** `docs/superpowers/specs/2026-05-19-caregiver-auth-design.md`

---

## Important context for the implementer

- The codebase **does not have Vitest set up yet** and there are **no existing tests**. Tasks 1–3 introduce Vitest in both workspaces.
- The "shared" workspace mentioned in older docs is **not active**. Root `package.json` only has `server` and `client` in `workspaces`. Do not try to import from `@babyone/shared`.
- `server/src/index.ts` uses raw `as Omit<...>` casts (no Zod). Stay consistent — do not introduce Zod in this plan. Validate JSON bodies manually in auth routes (small, contained).
- `GET /api/baby` is hardcoded (`name: "Clement"`, etc.). No PUT exists. Don't touch baby beyond mounting `requireAuth` on it.
- Server uses `tsx watch --env-file=.env`; new env vars belong in `server/.env`.
- The current dev split is **server on :8787** and **Vite client on :5173** with `app.use("/api/*", cors())`. In production a single origin serves both; in dev cross-origin requests need cookies — set `BABYONE_ORIGIN=http://localhost:5173` and update CORS to allow credentials.
- Do not start implementation on `main`. Create a feature branch (`feat/caregiver-auth`) before Task 1.

---

## File Structure

### Server (new)
- `server/src/auth/passwords.ts` — `hash()`, `verify()`, `dummyVerify()`
- `server/src/auth/sessions.ts` — `createSession()`, `findSession()`, `deleteSession()`, `cleanupExpiredSessions()`
- `server/src/auth/invites.ts` — `createInvite()`, `consumeInvite()`, `cleanupExpiredInvites()`
- `server/src/auth/rateLimit.ts` — `loginRateLimit(email)` in-memory `Map`
- `server/src/auth/middleware.ts` — `originGuard`, `requireAuth`, Hono `Variables` type
- `server/src/auth/routes.ts` — `mountAuthRoutes(app)` registering `/api/auth/*` and `/api/invites`
- `server/src/auth/*.test.ts` — unit + integration tests per primitive
- `server/vitest.config.ts` — Vitest config

### Server (modified)
- `server/src/db.ts` — add `users`, `sessions`, `invites` tables; add `user_id` column on `records`; expose `rowToRecord` to include `user_id`; widen `listRecords()`/`insertRecord()` signatures to include user info & user_id
- `server/src/index.ts` — mount `originGuard`, open routes, then `requireAuth`; switch CORS to credentialed allowlist; `POST /api/records` derives `user_id` from session
- `server/src/seed.ts` — bootstrap admin from env vars; backfill `user_id` on records
- `server/src/types.ts` — add `User`, `Session`, `Invite` types; widen `RoutineRecord` with optional `user`
- `server/package.json` — add `@node-rs/argon2`, `vitest`, test scripts
- `server/tsconfig.json` — exclude test files from `tsc -b` output
- `server/.env.example` — document new env vars

### Client (new)
- `client/src/auth/useAuth.ts` — `useMe()`, `useLogin()`, `useLogout()`, `useSignup()`, `useCreateInvite()`, typed `UnauthenticatedError`
- `client/src/auth/LoginPage.tsx`
- `client/src/auth/SignupPage.tsx`
- `client/src/auth/InvitePanel.tsx`
- `client/src/auth/Splash.tsx` — minimal loading splash
- `client/src/auth/*.test.tsx` — render tests
- `client/vitest.config.ts` — Vitest jsdom config

### Client (modified)
- `client/src/api.ts` — add `credentials: "include"` to every fetch; add `login`, `logout`, `me`, `signup`, `createInvite`; throw typed `UnauthenticatedError` on 401
- `client/src/queries.ts` — add `useMe`; existing queries gain `enabled: !!me.data` and treat 401 as auth-reset trigger via a `QueryClient` `onError`
- `client/src/main.tsx` — wire `onError` handler to invalidate `["me"]` on 401
- `client/src/App.tsx` — `AuthGate` chooses `LoginPage`/`SignupPage` vs `AuthenticatedApp`
- `client/src/components/Sidebar.tsx` — add `InvitePanel` and "Sign out" button
- `client/src/components/RecordModal.tsx` — show "Logged by {displayName}"
- `client/src/types.ts` — add `User` type; widen `RoutineRecord` with optional `user`
- `client/package.json` — add `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `@types/jsdom`, test scripts
- `client/tsconfig.app.json` / `tsconfig.node.json` — include test files appropriately

### Docs
- `README.md` — auth section: env vars, first-run bootstrap, invite flow
- `DEPLOY.md` — `fly secrets` step for `BABYONE_ADMIN_*` and `BABYONE_ORIGIN`; remove "No auth" note from Known Issues

---

# Phase 0 — Branch & Prereqs

### Task 0: Create feature branch

- [ ] **Step 1: Confirm clean working tree, create branch**

```bash
git status
git checkout -b feat/caregiver-auth
```

Expected: switched to a new branch, no uncommitted work pulled along.

---

# Phase 1 — Vitest setup (both workspaces)

### Task 1: Install server test deps + Vitest config

**Files:**
- Modify: `server/package.json`
- Create: `server/vitest.config.ts`
- Modify: `server/tsconfig.json`

- [ ] **Step 1: Add dev deps and scripts**

In `server/package.json`, add to `devDependencies`:
```json
"vitest": "^2.1.8",
"@vitest/coverage-v8": "^2.1.8"
```

And add scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

Run:
```bash
npm install --workspace server
```

Expected: install succeeds.

- [ ] **Step 2: Create Vitest config**

Create `server/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    pool: "forks",
  },
});
```

- [ ] **Step 3: Keep test files out of build output**

In `server/tsconfig.json`, add `exclude`:
```json
"exclude": ["src/**/*.test.ts"]
```

- [ ] **Step 4: Smoke test**

Create `server/src/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
describe("smoke", () => {
  it("runs", () => expect(1 + 1).toBe(2));
});
```

Run: `npm run test --workspace server`
Expected: 1 passing test.

- [ ] **Step 5: Delete the smoke test**

```bash
rm server/src/smoke.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/vitest.config.ts server/tsconfig.json package-lock.json
git commit -m "chore(server): add vitest"
```

---

### Task 2: Install client test deps + Vitest config

**Files:**
- Modify: `client/package.json`
- Create: `client/vitest.config.ts`
- Create: `client/src/test-setup.ts`

- [ ] **Step 1: Add dev deps and scripts**

In `client/package.json` `devDependencies`:
```json
"vitest": "^2.1.8",
"jsdom": "^25.0.1",
"@testing-library/react": "^16.1.0",
"@testing-library/dom": "^10.4.0",
"@testing-library/jest-dom": "^6.6.3",
"@testing-library/user-event": "^14.5.2"
```

Add scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

Run: `npm install --workspace client`
Expected: install succeeds.

- [ ] **Step 2: Create Vitest config**

Create `client/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    globals: false,
  },
});
```

- [ ] **Step 3: Create test setup file**

Create `client/src/test-setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Smoke test**

Create `client/src/smoke.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("renders", () => {
    render(<div>hello</div>);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
```

Run: `npm run test --workspace client`
Expected: 1 passing test.

- [ ] **Step 5: Delete the smoke test**

```bash
rm client/src/smoke.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add client/package.json client/vitest.config.ts client/src/test-setup.ts package-lock.json
git commit -m "chore(client): add vitest + testing-library"
```

---

### Task 3: Add argon2 + env scaffolding

**Files:**
- Modify: `server/package.json`
- Create: `server/.env.example`
- Modify: `server/.env` (local only — do not commit if `.env` is gitignored)

- [ ] **Step 1: Install `@node-rs/argon2`**

```bash
npm install --workspace server @node-rs/argon2@^2.0.2
```

Expected: install succeeds.

- [ ] **Step 2: Document env vars**

Create `server/.env.example`:
```
ANTHROPIC_API_KEY=
BABYONE_DB=

# Auth — required for first run when users table is empty.
# Can be removed from prod secrets after the first deploy boots successfully.
BABYONE_ADMIN_EMAIL=
BABYONE_ADMIN_PASSWORD=
BABYONE_ADMIN_NAME=

# Origin allowed to issue write requests (CSRF defense).
# Dev: http://localhost:5173 . Prod: https://babyone.fly.dev
BABYONE_ORIGIN=
```

- [ ] **Step 3: Add to local `.env`**

Append to `server/.env` (create if missing):
```
BABYONE_ADMIN_EMAIL=you@example.com
BABYONE_ADMIN_PASSWORD=devpassword-please-change
BABYONE_ADMIN_NAME=Dev
BABYONE_ORIGIN=http://localhost:5173
```

Verify `.env` is in `.gitignore` (it should be) by running `git check-ignore server/.env` — expected: prints the path (gitignored).

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/.env.example package-lock.json
git commit -m "chore(server): add argon2 + env scaffolding for auth"
```

---

# Phase 2 — Server auth primitives (TDD)

### Task 4: `passwords.ts` — hash + verify

**Files:**
- Create: `server/src/auth/passwords.ts`
- Test: `server/src/auth/passwords.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/src/auth/passwords.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, dummyVerify } from "./passwords.js";

describe("passwords", () => {
  it("round-trips a hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("alpha");
    expect(await verifyPassword(hash, "beta")).toBe(false);
  });

  it("dummyVerify resolves to false and does not throw", async () => {
    await expect(dummyVerify("anything")).resolves.toBe(false);
  });

  it("verify against junk does not throw", async () => {
    await expect(verifyPassword("not-a-real-hash", "x")).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm fail**

Run: `npm run test --workspace server -- passwords`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `server/src/auth/passwords.ts`:
```ts
import { hash, verify } from "@node-rs/argon2";

const ARGON2_OPTS = {
  // argon2id defaults from OWASP cheat sheet (m=19 MiB, t=2, p=1).
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$ZHVtbXlzYWx0ZHVtbXlzYWx0$" +
  "ZHVtbXloYXNoZHVtbXloYXNoZHVtbXloYXNoZHVtbXloYXNoZHVtbXk";

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTS);
}

export async function verifyPassword(
  storedHash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}

// Constant-time-ish stand-in for the "unknown email" path so login timing
// doesn't leak account existence.
export async function dummyVerify(plain: string): Promise<boolean> {
  return verifyPassword(DUMMY_HASH, plain);
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm run test --workspace server -- passwords`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/passwords.ts server/src/auth/passwords.test.ts
git commit -m "feat(server): argon2 password hash & verify"
```

---

### Task 5: DB schema migration — users, sessions, invites, records.user_id

**Files:**
- Modify: `server/src/db.ts`
- Test: `server/src/db.migration.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/src/db.migration.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyAuthSchema } from "./db.js";

describe("applyAuthSchema", () => {
  it("creates users, sessions, invites tables idempotently", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT, at TEXT, title TEXT, detail TEXT, meta TEXT
      );
    `);
    applyAuthSchema(db);
    applyAuthSchema(db); // second run is a no-op

    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining(["users", "sessions", "invites"]),
    );

    const cols = db.prepare("PRAGMA table_info(records)").all() as {
      name: string;
    }[];
    expect(cols.some((c) => c.name === "user_id")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

Run: `npm run test --workspace server -- db.migration`
Expected: FAIL (`applyAuthSchema` not exported).

- [ ] **Step 3: Implement schema migration**

In `server/src/db.ts`, add **near the top, exported, before the existing top-level `db.exec(...)` block**:

```ts
import type DatabaseT from "better-sqlite3";

export function applyAuthSchema(d: DatabaseT.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      user_agent TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS invites (
      code        TEXT PRIMARY KEY,
      created_by  INTEGER NOT NULL REFERENCES users(id),
      created_at  TEXT NOT NULL,
      expires_at  TEXT NOT NULL,
      consumed_by INTEGER REFERENCES users(id),
      consumed_at TEXT
    );
  `);

  const cols = d.prepare("PRAGMA table_info(records)").all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === "user_id")) {
    d.exec(
      "ALTER TABLE records ADD COLUMN user_id INTEGER REFERENCES users(id)",
    );
  }
}
```

Then **immediately after the existing top-level `db.exec(...)` schema block** in `db.ts`, call it:
```ts
applyAuthSchema(db);
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm run test --workspace server -- db.migration`
Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/db.ts server/src/db.migration.test.ts
git commit -m "feat(server): users/sessions/invites schema + records.user_id"
```

---

### Task 6: `sessions.ts` — create / lookup / delete / cleanup

**Files:**
- Create: `server/src/auth/sessions.ts`
- Test: `server/src/auth/sessions.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/src/auth/sessions.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyAuthSchema } from "../db.js";
import {
  createSession,
  findSession,
  deleteSession,
  cleanupExpiredSessions,
  SESSION_TTL_MS,
} from "./sessions.js";

let db: Database.Database;
let userId: number;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT, at TEXT, title TEXT, detail TEXT, meta TEXT
    );
  `);
  applyAuthSchema(db);
  const info = db
    .prepare(
      "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
    )
    .run("a@b.c", "x", "A", new Date().toISOString());
  userId = Number(info.lastInsertRowid);
});

describe("sessions", () => {
  it("creates and finds a session", () => {
    const sid = createSession(db, userId, "");
    expect(sid).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const row = findSession(db, sid);
    expect(row).toMatchObject({ userId, email: "a@b.c", displayName: "A" });
  });

  it("returns null for unknown session", () => {
    expect(findSession(db, "nope")).toBeNull();
  });

  it("ignores expired sessions", () => {
    const sid = "sid-expired";
    db.prepare(
      "INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')",
    ).run(sid, userId, new Date(0).toISOString(), new Date(0).toISOString());
    expect(findSession(db, sid)).toBeNull();
  });

  it("deleteSession removes the row", () => {
    const sid = createSession(db, userId, "");
    deleteSession(db, sid);
    expect(findSession(db, sid)).toBeNull();
  });

  it("cleanupExpiredSessions deletes only expired", () => {
    const goodSid = createSession(db, userId, "");
    db.prepare(
      "INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES ('old', ?, ?, ?, '')",
    ).run(userId, new Date(0).toISOString(), new Date(0).toISOString());
    cleanupExpiredSessions(db);
    expect(findSession(db, goodSid)).not.toBeNull();
    expect(findSession(db, "old")).toBeNull();
  });

  it("SESSION_TTL_MS is 30 days", () => {
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

Run: `npm run test --workspace server -- sessions`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `server/src/auth/sessions.ts`:
```ts
import { randomBytes } from "node:crypto";
import type DatabaseT from "better-sqlite3";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionLookup {
  sessionId: string;
  userId: number;
  email: string;
  displayName: string;
  expiresAt: string;
}

function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

export function createSession(
  db: DatabaseT.Database,
  userId: number,
  userAgent: string,
): string {
  const id = newSessionId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  db.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)",
  ).run(id, userId, now.toISOString(), expiresAt.toISOString(), userAgent);
  return id;
}

export function findSession(
  db: DatabaseT.Database,
  sid: string,
): SessionLookup | null {
  const row = db
    .prepare(
      `SELECT s.id AS sid, s.user_id AS uid, s.expires_at AS exp,
              u.email AS email, u.display_name AS name
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .get(sid) as
    | { sid: string; uid: number; exp: string; email: string; name: string }
    | undefined;
  if (!row) return null;
  if (row.exp < new Date().toISOString()) return null;
  return {
    sessionId: row.sid,
    userId: row.uid,
    email: row.email,
    displayName: row.name,
    expiresAt: row.exp,
  };
}

export function deleteSession(db: DatabaseT.Database, sid: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
}

export function cleanupExpiredSessions(db: DatabaseT.Database): void {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(
    new Date().toISOString(),
  );
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm run test --workspace server -- sessions`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/sessions.ts server/src/auth/sessions.test.ts
git commit -m "feat(server): SQLite-backed session store"
```

---

### Task 7: `invites.ts` — create / consume / cleanup

**Files:**
- Create: `server/src/auth/invites.ts`
- Test: `server/src/auth/invites.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/src/auth/invites.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyAuthSchema } from "../db.js";
import {
  createInvite,
  consumeInvite,
  cleanupExpiredInvites,
  INVITE_TTL_MS,
} from "./invites.js";

let db: Database.Database;
let userId: number;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT, at TEXT, title TEXT, detail TEXT, meta TEXT
    );
  `);
  applyAuthSchema(db);
  userId = Number(
    db
      .prepare(
        "INSERT INTO users (email, password_hash, display_name, created_at) VALUES ('a@b.c', 'x', 'A', ?)",
      )
      .run(new Date().toISOString()).lastInsertRowid,
  );
});

describe("invites", () => {
  it("creates a unique 32-char base64url code with 24h TTL", () => {
    const inv = createInvite(db, userId);
    expect(inv.code).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(new Date(inv.expiresAt).getTime() - Date.now()).toBeGreaterThan(
      INVITE_TTL_MS - 5000,
    );
  });

  it("generates unique codes", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 500; i++) codes.add(createInvite(db, userId).code);
    expect(codes.size).toBe(500);
  });

  it("consumes a valid invite once", () => {
    const inv = createInvite(db, userId);
    expect(consumeInvite(db, inv.code, userId)).toBe(true);
    expect(consumeInvite(db, inv.code, userId)).toBe(false);
  });

  it("rejects expired invite", () => {
    const code = "expired-code";
    db.prepare(
      "INSERT INTO invites (code, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ).run(code, userId, new Date(0).toISOString(), new Date(0).toISOString());
    expect(consumeInvite(db, code, userId)).toBe(false);
  });

  it("rejects unknown invite", () => {
    expect(consumeInvite(db, "nope", userId)).toBe(false);
  });

  it("cleanup removes expired unconsumed invites", () => {
    createInvite(db, userId); // good
    db.prepare(
      "INSERT INTO invites (code, created_by, created_at, expires_at) VALUES ('old', ?, ?, ?)",
    ).run(userId, new Date(0).toISOString(), new Date(0).toISOString());
    cleanupExpiredInvites(db);
    expect(
      db.prepare("SELECT COUNT(*) AS c FROM invites").get() as { c: number },
    ).toEqual({ c: 1 });
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

Run: `npm run test --workspace server -- invites`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `server/src/auth/invites.ts`:
```ts
import { randomBytes } from "node:crypto";
import type DatabaseT from "better-sqlite3";

export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export interface Invite {
  code: string;
  createdBy: number;
  expiresAt: string;
}

function newCode(): string {
  return randomBytes(24).toString("base64url");
}

export function createInvite(db: DatabaseT.Database, createdBy: number): Invite {
  const code = newCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  db.prepare(
    "INSERT INTO invites (code, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(code, createdBy, now.toISOString(), expiresAt.toISOString());
  return { code, createdBy, expiresAt: expiresAt.toISOString() };
}

// Returns true if the invite was valid and is now marked consumed by `userId`.
export function consumeInvite(
  db: DatabaseT.Database,
  code: string,
  userId: number,
): boolean {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `UPDATE invites
       SET consumed_by = ?, consumed_at = ?
       WHERE code = ? AND consumed_by IS NULL AND expires_at > ?`,
    )
    .run(userId, now, code, now);
  return info.changes === 1;
}

export function cleanupExpiredInvites(db: DatabaseT.Database): void {
  db.prepare(
    "DELETE FROM invites WHERE consumed_by IS NULL AND expires_at < ?",
  ).run(new Date().toISOString());
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm run test --workspace server -- invites`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/invites.ts server/src/auth/invites.test.ts
git commit -m "feat(server): one-time invite codes"
```

---

### Task 8: `rateLimit.ts` — login attempt limiter

**Files:**
- Create: `server/src/auth/rateLimit.ts`
- Test: `server/src/auth/rateLimit.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/src/auth/rateLimit.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { LoginRateLimiter } from "./rateLimit.js";

describe("LoginRateLimiter", () => {
  beforeEach(() => vi.useFakeTimers());

  it("allows the first 10 attempts then blocks the 11th", () => {
    const rl = new LoginRateLimiter({ maxAttempts: 10, windowMs: 15 * 60_000 });
    for (let i = 0; i < 10; i++) expect(rl.check("a@b.c")).toBe(true);
    expect(rl.check("a@b.c")).toBe(false);
  });

  it("resets after the window passes", () => {
    const rl = new LoginRateLimiter({ maxAttempts: 2, windowMs: 1000 });
    expect(rl.check("a@b.c")).toBe(true);
    expect(rl.check("a@b.c")).toBe(true);
    expect(rl.check("a@b.c")).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(rl.check("a@b.c")).toBe(true);
  });

  it("tracks emails independently and is case-insensitive", () => {
    const rl = new LoginRateLimiter({ maxAttempts: 1, windowMs: 1000 });
    expect(rl.check("A@B.c")).toBe(true);
    expect(rl.check("a@b.C")).toBe(false);
    expect(rl.check("other@x.y")).toBe(true);
  });

  it("reset(email) clears the counter", () => {
    const rl = new LoginRateLimiter({ maxAttempts: 1, windowMs: 1000 });
    rl.check("a@b.c");
    rl.reset("a@b.c");
    expect(rl.check("a@b.c")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

Run: `npm run test --workspace server -- rateLimit`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `server/src/auth/rateLimit.ts`:
```ts
interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOpts {
  maxAttempts: number;
  windowMs: number;
}

export class LoginRateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private opts: RateLimitOpts) {}

  // Returns true if the attempt is allowed; false if currently blocked.
  // Increments the counter on every call (success or failure — callers may
  // optionally reset() on successful login to be lenient).
  check(emailRaw: string): boolean {
    const email = emailRaw.toLowerCase();
    const now = Date.now();
    const b = this.buckets.get(email);
    if (!b || b.resetAt <= now) {
      this.buckets.set(email, {
        count: 1,
        resetAt: now + this.opts.windowMs,
      });
      return true;
    }
    if (b.count >= this.opts.maxAttempts) return false;
    b.count++;
    return true;
  }

  reset(emailRaw: string): void {
    this.buckets.delete(emailRaw.toLowerCase());
  }
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm run test --workspace server -- rateLimit`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/rateLimit.ts server/src/auth/rateLimit.test.ts
git commit -m "feat(server): in-memory per-email login rate limiter"
```

---

# Phase 3 — Middleware

### Task 9: `originGuard` middleware

**Files:**
- Create: `server/src/auth/middleware.ts` (split across this task and the next)
- Test: `server/src/auth/middleware.originGuard.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/src/auth/middleware.originGuard.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { originGuard } from "./middleware.js";

let app: Hono;
beforeEach(() => {
  process.env.BABYONE_ORIGIN = "http://localhost:5173";
  app = new Hono();
  app.use("/api/*", originGuard);
  app.get("/api/x", (c) => c.json({ ok: true }));
  app.post("/api/x", (c) => c.json({ ok: true }));
});

describe("originGuard", () => {
  it("allows GET with no Origin", async () => {
    const res = await app.request("/api/x");
    expect(res.status).toBe(200);
  });

  it("rejects POST with missing Origin", async () => {
    const res = await app.request("/api/x", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("rejects POST with wrong Origin", async () => {
    const res = await app.request("/api/x", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("allows POST with matching Origin", async () => {
    const res = await app.request("/api/x", {
      method: "POST",
      headers: { Origin: "http://localhost:5173" },
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

Run: `npm run test --workspace server -- middleware.originGuard`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `server/src/auth/middleware.ts`:
```ts
import type { MiddlewareHandler } from "hono";

const WRITE_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

export const originGuard: MiddlewareHandler = async (c, next) => {
  if (WRITE_METHODS.has(c.req.method)) {
    const allowed = process.env.BABYONE_ORIGIN;
    const origin = c.req.header("Origin");
    if (!allowed || !origin || origin !== allowed) {
      return c.json({ error: "bad_origin" }, 403);
    }
  }
  await next();
};
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm run test --workspace server -- middleware.originGuard`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/middleware.ts server/src/auth/middleware.originGuard.test.ts
git commit -m "feat(server): originGuard CSRF middleware"
```

---

### Task 10: `requireAuth` middleware + Hono Variables typing

**Files:**
- Modify: `server/src/auth/middleware.ts`
- Test: `server/src/auth/middleware.requireAuth.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/src/auth/middleware.requireAuth.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { applyAuthSchema } from "../db.js";
import { createSession } from "./sessions.js";
import { makeRequireAuth, type AuthEnv } from "./middleware.js";

let db: Database.Database;
let app: Hono<AuthEnv>;
let userId: number;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT, at TEXT, title TEXT, detail TEXT, meta TEXT
    );
  `);
  applyAuthSchema(db);
  userId = Number(
    db
      .prepare(
        "INSERT INTO users (email, password_hash, display_name, created_at) VALUES ('a@b.c','x','A',?)",
      )
      .run(new Date().toISOString()).lastInsertRowid,
  );
  app = new Hono<AuthEnv>();
  app.use("/api/secret", makeRequireAuth(db));
  app.get("/api/secret", (c) => c.json({ user: c.get("user") }));
});

describe("requireAuth", () => {
  it("401s when no cookie", async () => {
    const res = await app.request("/api/secret");
    expect(res.status).toBe(401);
  });

  it("401s when cookie unknown", async () => {
    const res = await app.request("/api/secret", {
      headers: { Cookie: "bo_sid=nope" },
    });
    expect(res.status).toBe(401);
  });

  it("attaches the user when cookie is valid", async () => {
    const sid = createSession(db, userId, "");
    const res = await app.request("/api/secret", {
      headers: { Cookie: `bo_sid=${sid}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: userId, email: "a@b.c", displayName: "A" },
    });
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

Run: `npm run test --workspace server -- middleware.requireAuth`
Expected: FAIL.

- [ ] **Step 3: Extend middleware**

Edit `server/src/auth/middleware.ts` to add the imports and exports at the bottom:
```ts
import { getCookie } from "hono/cookie";
import type DatabaseT from "better-sqlite3";
import { findSession } from "./sessions.js";

export interface AuthUser {
  id: number;
  email: string;
  displayName: string;
}

export type AuthEnv = { Variables: { user: AuthUser } };

export function makeRequireAuth(db: DatabaseT.Database): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const sid = getCookie(c, "bo_sid");
    if (!sid) return c.json({ error: "unauthenticated" }, 401);
    const row = findSession(db, sid);
    if (!row) return c.json({ error: "unauthenticated" }, 401);
    c.set("user", {
      id: row.userId,
      email: row.email,
      displayName: row.displayName,
    });
    await next();
  };
}
```

(Make sure the existing `import type { MiddlewareHandler } from "hono";` line at the top stays — and that `originGuard` keeps its existing implementation untouched.)

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm run test --workspace server -- middleware.requireAuth`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/middleware.ts server/src/auth/middleware.requireAuth.test.ts
git commit -m "feat(server): requireAuth session middleware"
```

---

# Phase 4 — Auth routes

### Task 11: `routes.ts` — login + logout + me

**Files:**
- Create: `server/src/auth/routes.ts`
- Test: `server/src/auth/routes.auth.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/src/auth/routes.auth.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { applyAuthSchema } from "../db.js";
import { hashPassword } from "./passwords.js";
import { mountAuthRoutes } from "./routes.js";
import type { AuthEnv } from "./middleware.js";

let db: Database.Database;
let app: Hono<AuthEnv>;

const ORIGIN = "http://localhost:5173";

beforeEach(async () => {
  process.env.BABYONE_ORIGIN = ORIGIN;
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT, at TEXT, title TEXT, detail TEXT, meta TEXT
    );
  `);
  applyAuthSchema(db);
  const hash = await hashPassword("hunter22");
  db.prepare(
    "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
  ).run("alice@example.com", hash, "Alice", new Date().toISOString());

  app = new Hono<AuthEnv>();
  mountAuthRoutes(app, db);
});

const post = (path: string, body: unknown, cookie?: string) =>
  app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: ORIGIN,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });

describe("POST /api/auth/login", () => {
  it("returns the user and sets a cookie on success", async () => {
    const res = await post("/api/auth/login", {
      email: "alice@example.com",
      password: "hunter22",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: 1, email: "alice@example.com", displayName: "Alice" },
    });
    expect(res.headers.get("set-cookie")).toMatch(/bo_sid=/);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(res.headers.get("set-cookie")).toMatch(/SameSite=Lax/i);
  });

  it("is case-insensitive on email", async () => {
    const res = await post("/api/auth/login", {
      email: "ALICE@example.com",
      password: "hunter22",
    });
    expect(res.status).toBe(200);
  });

  it("401s on wrong password (same shape as unknown email)", async () => {
    const a = await post("/api/auth/login", {
      email: "alice@example.com",
      password: "wrong",
    });
    const b = await post("/api/auth/login", {
      email: "nobody@example.com",
      password: "wrong",
    });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.json()).toEqual({ error: "invalid_credentials" });
    expect(await b.json()).toEqual({ error: "invalid_credentials" });
  });

  it("429s after 10 failed attempts", async () => {
    for (let i = 0; i < 10; i++)
      await post("/api/auth/login", { email: "alice@example.com", password: "x" });
    const res = await post("/api/auth/login", {
      email: "alice@example.com",
      password: "hunter22",
    });
    expect(res.status).toBe(429);
  });

  it("400 on missing fields", async () => {
    const res = await post("/api/auth/login", { email: "alice@example.com" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/auth/me", () => {
  it("401 without cookie", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("200 with valid cookie", async () => {
    const login = await post("/api/auth/login", {
      email: "alice@example.com",
      password: "hunter22",
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const res = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: 1, email: "alice@example.com", displayName: "Alice" },
    });
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the cookie and deletes the session", async () => {
    const login = await post("/api/auth/login", {
      email: "alice@example.com",
      password: "hunter22",
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const out = await post("/api/auth/logout", {}, cookie);
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toMatch(/bo_sid=;/);

    const me = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
    expect(me.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

Run: `npm run test --workspace server -- routes.auth`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `server/src/auth/routes.ts`:
```ts
import type { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import type DatabaseT from "better-sqlite3";
import {
  hashPassword,
  verifyPassword,
  dummyVerify,
} from "./passwords.js";
import {
  createSession,
  deleteSession,
  findSession,
  SESSION_TTL_MS,
} from "./sessions.js";
import { createInvite, consumeInvite } from "./invites.js";
import { LoginRateLimiter } from "./rateLimit.js";
import type { AuthEnv } from "./middleware.js";

const COOKIE = "bo_sid";

const cookieOpts = (maxAgeMs: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "Lax" as const,
  path: "/",
  maxAge: Math.floor(maxAgeMs / 1000),
});

const loginRl = new LoginRateLimiter({
  maxAttempts: 10,
  windowMs: 15 * 60_000,
});

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function mountAuthRoutes(app: Hono<AuthEnv>, db: DatabaseT.Database): void {
  app.post("/api/auth/login", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = asString(body.email)?.toLowerCase();
    const password = asString(body.password);
    if (!email || !password) {
      return c.json({ error: "bad_request" }, 400);
    }

    if (!loginRl.check(email)) {
      return c.json({ error: "too_many_attempts" }, 429);
    }

    const row = db
      .prepare(
        "SELECT id, password_hash, display_name FROM users WHERE email = ?",
      )
      .get(email) as
      | { id: number; password_hash: string; display_name: string }
      | undefined;

    const ok = row
      ? await verifyPassword(row.password_hash, password)
      : (await dummyVerify(password), false);

    if (!row || !ok) {
      return c.json({ error: "invalid_credentials" }, 401);
    }

    loginRl.reset(email);
    const sid = createSession(db, row.id, c.req.header("User-Agent") ?? "");
    setCookie(c, COOKIE, sid, cookieOpts(SESSION_TTL_MS));
    return c.json({
      user: { id: row.id, email, displayName: row.display_name },
    });
  });

  app.post("/api/auth/signup", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const code = asString(body.code);
    const email = asString(body.email)?.toLowerCase();
    const password = asString(body.password);
    const displayName = asString(body.displayName);
    if (!code || !email || !password || !displayName) {
      return c.json({ error: "bad_request" }, 400);
    }
    if (password.length < 8) {
      return c.json({ error: "weak_password" }, 400);
    }

    const hash = await hashPassword(password);
    const now = new Date().toISOString();

    try {
      const tx = db.transaction(() => {
        const info = db
          .prepare(
            "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
          )
          .run(email, hash, displayName, now);
        const userId = Number(info.lastInsertRowid);
        const consumed = consumeInvite(db, code, userId);
        if (!consumed) throw new Error("invalid_invite");
        return userId;
      });
      const userId = tx();
      const sid = createSession(db, userId, c.req.header("User-Agent") ?? "");
      setCookie(c, COOKIE, sid, cookieOpts(SESSION_TTL_MS));
      return c.json({
        user: { id: userId, email, displayName },
      });
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? "";
      if (msg.includes("UNIQUE")) {
        return c.json({ error: "email_taken" }, 400);
      }
      if (msg === "invalid_invite") {
        return c.json({ error: "invalid_invite" }, 400);
      }
      throw err;
    }
  });

  app.post("/api/auth/logout", (c) => {
    const sid = getCookie(c, COOKIE);
    if (sid) deleteSession(db, sid);
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/auth/me", (c) => {
    const sid = getCookie(c, COOKIE);
    if (!sid) return c.json({ error: "unauthenticated" }, 401);
    const row = findSession(db, sid);
    if (!row) return c.json({ error: "unauthenticated" }, 401);
    return c.json({
      user: { id: row.userId, email: row.email, displayName: row.displayName },
    });
  });

}

// Registered separately so it can be mounted AFTER requireAuth in index.ts.
export function mountInviteRoutes(app: Hono<AuthEnv>, db: DatabaseT.Database): void {
  app.post("/api/invites", (c) => {
    const user = c.get("user");
    const inv = createInvite(db, user.id);
    const origin = process.env.BABYONE_ORIGIN ?? "";
    return c.json({
      code: inv.code,
      expiresAt: inv.expiresAt,
      url: `${origin}/signup?code=${inv.code}`,
    });
  });
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm run test --workspace server -- routes.auth`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/routes.ts server/src/auth/routes.auth.test.ts
git commit -m "feat(server): /api/auth/{login,signup,logout,me} + /api/invites"
```

---

### Task 12: Signup and invite integration tests

**Files:**
- Test: `server/src/auth/routes.signup.test.ts`

- [ ] **Step 1: Write tests**

Create `server/src/auth/routes.signup.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { applyAuthSchema } from "../db.js";
import { hashPassword } from "./passwords.js";
import { createInvite } from "./invites.js";
import { mountAuthRoutes, mountInviteRoutes } from "./routes.js";
import { makeRequireAuth, type AuthEnv } from "./middleware.js";

const ORIGIN = "http://localhost:5173";
let db: Database.Database;
let app: Hono<AuthEnv>;
let adminId: number;

beforeEach(async () => {
  process.env.BABYONE_ORIGIN = ORIGIN;
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT, at TEXT, title TEXT, detail TEXT, meta TEXT
    );
  `);
  applyAuthSchema(db);
  const hash = await hashPassword("hunter22");
  adminId = Number(
    db
      .prepare(
        "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
      )
      .run("admin@example.com", hash, "Admin", new Date().toISOString())
      .lastInsertRowid,
  );

  app = new Hono<AuthEnv>();
  mountAuthRoutes(app, db);
  // mirror index.ts: gate /api/invites behind requireAuth
  app.use("/api/invites", makeRequireAuth(db));
  mountInviteRoutes(app, db);
});

const post = (path: string, body: unknown, cookie?: string) =>
  app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: ORIGIN,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });

describe("POST /api/auth/signup", () => {
  it("creates a user with a valid invite and sets cookie", async () => {
    const inv = createInvite(db, adminId);
    const res = await post("/api/auth/signup", {
      code: inv.code,
      email: "bob@example.com",
      password: "longenough",
      displayName: "Bob",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/bo_sid=/);
    const consumed = db
      .prepare("SELECT consumed_by FROM invites WHERE code = ?")
      .get(inv.code) as { consumed_by: number };
    expect(consumed.consumed_by).toBeGreaterThan(0);
  });

  it("400s on missing fields", async () => {
    const res = await post("/api/auth/signup", { code: "x", email: "x@x.x" });
    expect(res.status).toBe(400);
  });

  it("400s on weak password", async () => {
    const inv = createInvite(db, adminId);
    const res = await post("/api/auth/signup", {
      code: inv.code,
      email: "bob@example.com",
      password: "short",
      displayName: "Bob",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "weak_password" });
  });

  it("400s on consumed invite (and does not create the user)", async () => {
    const inv = createInvite(db, adminId);
    await post("/api/auth/signup", {
      code: inv.code,
      email: "first@example.com",
      password: "longenough",
      displayName: "First",
    });
    const res = await post("/api/auth/signup", {
      code: inv.code,
      email: "second@example.com",
      password: "longenough",
      displayName: "Second",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_invite" });
    const u = db
      .prepare("SELECT COUNT(*) AS c FROM users WHERE email = ?")
      .get("second@example.com") as { c: number };
    expect(u.c).toBe(0);
  });

  it("400s on duplicate email", async () => {
    const inv = createInvite(db, adminId);
    const res = await post("/api/auth/signup", {
      code: inv.code,
      email: "admin@example.com",
      password: "longenough",
      displayName: "Dup",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "email_taken" });
  });
});

describe("POST /api/invites", () => {
  it("401 without session", async () => {
    const res = await post("/api/invites", {});
    expect(res.status).toBe(401);
  });

  it("returns code + url when authed", async () => {
    const login = await post("/api/auth/login", {
      email: "admin@example.com",
      password: "hunter22",
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const res = await post("/api/invites", {}, cookie);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      code: string;
      url: string;
      expiresAt: string;
    };
    expect(json.url).toBe(`${ORIGIN}/signup?code=${json.code}`);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm run test --workspace server -- routes.signup`
Expected: all passing (uses code already written in Task 11).

- [ ] **Step 3: Commit**

```bash
git add server/src/auth/routes.signup.test.ts
git commit -m "test(server): signup + invite integration"
```

---

# Phase 5 — Wire into the server

### Task 13: Mount middleware and routes in `index.ts`

**Files:**
- Modify: `server/src/index.ts`
- Modify: `server/src/db.ts` (export `db` already — verify; add `getUserById` helper)

- [ ] **Step 1: Add helper to db.ts**

In `server/src/db.ts`, after `markSeeded`, append:
```ts
export interface UserRow {
  id: number;
  email: string;
  display_name: string;
}

export const countUsers = (): number =>
  (db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
```

- [ ] **Step 2: Replace `index.ts` setup block**

Edit `server/src/index.ts`. Replace lines 1–32 (imports + `seedIfEmpty()` + `app = new Hono()` + `app.use("/api/*", cors())` + `/api/health`) with:

```ts
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  db,
  deleteRecord,
  findRecords,
  getKv,
  hasBriefInRange,
  insertMessage,
  insertRecord,
  listMessages,
  listRecords,
  setKv,
  updateRecord,
} from "./db.js";
import { seedIfEmpty } from "./seed.js";
import { llmEnabled, llmParse } from "./llm.js";
import {
  aggregateBaseline,
  aggregateDay,
  computeBriefWindow,
  generateBriefText,
} from "./brief.js";
import type { RoutineRecord } from "./types.js";
import { originGuard, makeRequireAuth, type AuthEnv } from "./auth/middleware.js";
import { mountAuthRoutes, mountInviteRoutes } from "./auth/routes.js";
import { cleanupExpiredSessions } from "./auth/sessions.js";
import { cleanupExpiredInvites } from "./auth/invites.js";

seedIfEmpty();
cleanupExpiredSessions(db);
cleanupExpiredInvites(db);

const app = new Hono<AuthEnv>();

const origin = process.env.BABYONE_ORIGIN ?? "http://localhost:5173";
app.use(
  "/api/*",
  cors({
    origin,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowHeaders: ["Content-Type"],
  }),
);

app.use("/api/*", originGuard);

// Open routes (mounted BEFORE requireAuth so they pass through).
app.get("/api/health", (c) => c.json({ ok: true, llm: llmEnabled }));
mountAuthRoutes(app, db);

// Everything else under /api/* requires a valid session.
const requireAuth = makeRequireAuth(db);
app.use("/api/*", requireAuth);

// Gated auth-adjacent routes (must come AFTER requireAuth).
mountInviteRoutes(app, db);
```

Then **change `app.post("/api/records", ...)`** to derive `user_id` from session:
```ts
app.post("/api/records", async (c) => {
  const body = (await c.req.json()) as Omit<RoutineRecord, "id" | "user">;
  const user = c.get("user");
  return c.json(insertRecord({ ...body, userId: user.id }));
});
```

- [ ] **Step 3: Confirm `index.ts` still has unchanged sections**

The remaining records/messages/chat/brief endpoints and static-file serving should be untouched.

- [ ] **Step 4: Update `insertRecord` to accept and persist `userId`**

In `server/src/db.ts`, change `insertRecord`:
```ts
export const insertRecord = (
  r: Omit<RoutineRecord, "id"> & { userId?: number | null },
): RoutineRecord => {
  const info = db
    .prepare(
      "INSERT INTO records (type, at, title, detail, meta, user_id) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      r.type,
      r.at,
      r.title,
      r.detail ?? "",
      JSON.stringify(r.meta ?? {}),
      r.userId ?? null,
    );
  return { ...r, id: Number(info.lastInsertRowid) };
};
```

Update `rowToRecord` and `RecordRow` to include user info via JOIN:

```ts
interface RecordRow {
  id: number;
  type: string;
  at: string;
  title: string;
  detail: string;
  meta: string;
  user_id: number | null;
  user_display_name: string | null;
}

const rowToRecord = (r: RecordRow): RoutineRecord => ({
  id: r.id,
  type: r.type as RecordType,
  at: r.at,
  title: r.title,
  detail: r.detail,
  meta: JSON.parse(r.meta) as RecordMeta,
  user:
    r.user_id !== null && r.user_display_name !== null
      ? { id: r.user_id, displayName: r.user_display_name }
      : null,
});
```

And change the two SELECTs in `listRecords` and `findRecords` to:
```ts
const BASE_SELECT =
  "SELECT r.*, u.display_name AS user_display_name FROM records r " +
  "LEFT JOIN users u ON u.id = r.user_id";

export const listRecords = (): RoutineRecord[] =>
  (
    db.prepare(`${BASE_SELECT} ORDER BY r.at DESC`).all() as RecordRow[]
  ).map(rowToRecord);

export const findRecords = (opts: {
  since?: string;
  until?: string;
  type?: string;
  limit?: number;
}): RoutineRecord[] => {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.since) {
    where.push("r.at >= ?");
    params.push(opts.since);
  }
  if (opts.until) {
    where.push("r.at <= ?");
    params.push(opts.until);
  }
  if (opts.type) {
    where.push("r.type = ?");
    params.push(opts.type);
  }
  const sql =
    `${BASE_SELECT}` +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY r.at DESC LIMIT ?";
  params.push(opts.limit ?? 20);
  return (db.prepare(sql).all(...params) as RecordRow[]).map(rowToRecord);
};
```

(Adjust `getRecord` similarly:)
```ts
export const getRecord = (id: number): RoutineRecord | null => {
  const row = db
    .prepare(`${BASE_SELECT} WHERE r.id = ?`)
    .get(id) as RecordRow | undefined;
  return row ? rowToRecord(row) : null;
};
```

And `updateRecord` — preserve existing `user_id` (don't overwrite from body):
```ts
export const updateRecord = (r: RoutineRecord): RoutineRecord => {
  db.prepare(
    "UPDATE records SET type=?, at=?, title=?, detail=?, meta=? WHERE id=?",
  ).run(
    r.type,
    r.at,
    r.title,
    r.detail ?? "",
    JSON.stringify(r.meta ?? {}),
    r.id,
  );
  return r;
};
```

- [ ] **Step 5: Extend `RoutineRecord` in `types.ts`**

In `server/src/types.ts`, add to `RoutineRecord`:
```ts
export interface RoutineRecord {
  id: number;
  type: RecordType;
  at: string;
  title: string;
  detail: string;
  meta: RecordMeta;
  user?: { id: number; displayName: string } | null;
}
```

- [ ] **Step 6: Verify the build**

Run: `npm run build --workspace server`
Expected: clean tsc.

- [ ] **Step 7: Verify the test suite**

Run: `npm run test --workspace server`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add server/src/index.ts server/src/db.ts server/src/types.ts
git commit -m "feat(server): mount auth middleware and propagate user_id on records"
```

---

### Task 14: Bootstrap admin + backfill in `seed.ts`

**Files:**
- Modify: `server/src/seed.ts`
- Test: `server/src/auth/bootstrap.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/src/auth/bootstrap.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { applyAuthSchema } from "../db.js";
import { bootstrapAdmin, backfillRecordsUser } from "../seed.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT, at TEXT, title TEXT, detail TEXT, meta TEXT
    );
    INSERT INTO records (type, at, title, detail, meta) VALUES
      ('feed', '2026-01-01T00:00:00Z', 'feed', '', '{}'),
      ('sleep', '2026-01-02T00:00:00Z', 'sleep', '', '{}');
  `);
  applyAuthSchema(db);
});

describe("bootstrapAdmin", () => {
  it("creates the admin if users is empty and env vars are set", async () => {
    const id = await bootstrapAdmin(db, {
      email: "admin@example.com",
      password: "longenough",
      displayName: "Admin",
    });
    expect(id).toBeGreaterThan(0);
    const u = db.prepare("SELECT email FROM users WHERE id = ?").get(id);
    expect(u).toEqual({ email: "admin@example.com" });
  });

  it("returns null and does nothing when users already exist", async () => {
    await bootstrapAdmin(db, {
      email: "first@example.com",
      password: "longenough",
      displayName: "First",
    });
    const id2 = await bootstrapAdmin(db, {
      email: "second@example.com",
      password: "longenough",
      displayName: "Second",
    });
    expect(id2).toBeNull();
    const c = db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
    expect(c.c).toBe(1);
  });

  it("exits when users empty and creds missing", async () => {
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(((_: number) => undefined) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await bootstrapAdmin(db, null);
    expect(exit).toHaveBeenCalledWith(1);
    expect(err).toHaveBeenCalled();
    exit.mockRestore();
    err.mockRestore();
  });
});

describe("backfillRecordsUser", () => {
  it("assigns user_id to records that have none", () => {
    backfillRecordsUser(db, 99);
    const rows = db
      .prepare("SELECT user_id FROM records")
      .all() as { user_id: number }[];
    expect(rows.every((r) => r.user_id === 99)).toBe(true);
  });

  it("does not overwrite existing user_id", () => {
    db.prepare("UPDATE records SET user_id = 7 WHERE id = 1").run();
    backfillRecordsUser(db, 99);
    const rows = db.prepare("SELECT id, user_id FROM records").all() as {
      id: number;
      user_id: number;
    }[];
    expect(rows.find((r) => r.id === 1)?.user_id).toBe(7);
    expect(rows.find((r) => r.id === 2)?.user_id).toBe(99);
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

Run: `npm run test --workspace server -- bootstrap`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `server/src/seed.ts`, add at the top:
```ts
import type DatabaseT from "better-sqlite3";
import { db as defaultDb } from "./db.js";
import { hashPassword } from "./auth/passwords.js";

export interface AdminCreds {
  email: string;
  password: string;
  displayName: string;
}

export function readAdminCredsFromEnv(): AdminCreds | null {
  const email = process.env.BABYONE_ADMIN_EMAIL;
  const password = process.env.BABYONE_ADMIN_PASSWORD;
  const displayName = process.env.BABYONE_ADMIN_NAME;
  if (!email || !password || !displayName) return null;
  return { email: email.toLowerCase(), password, displayName };
}

export async function bootstrapAdmin(
  db: DatabaseT.Database,
  creds: AdminCreds | null,
): Promise<number | null> {
  const existing = (
    db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }
  ).c;
  if (existing > 0) return null;

  if (!creds) {
    console.error(
      "[babyone] No users in DB and BABYONE_ADMIN_* env vars not set. " +
        "Set BABYONE_ADMIN_EMAIL, BABYONE_ADMIN_PASSWORD, and BABYONE_ADMIN_NAME, then restart.",
    );
    process.exit(1);
    return null;
  }

  const hash = await hashPassword(creds.password);
  const info = db
    .prepare(
      "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(creds.email, hash, creds.displayName, new Date().toISOString());
  const id = Number(info.lastInsertRowid);
  console.log(
    `[babyone] Created admin user ${creds.email}. ` +
      "You can unset BABYONE_ADMIN_* env vars now.",
  );
  return id;
}

export function backfillRecordsUser(db: DatabaseT.Database, adminId: number): void {
  db.prepare("UPDATE records SET user_id = ? WHERE user_id IS NULL").run(adminId);
}

export async function bootstrapAuth(): Promise<void> {
  const creds = readAdminCredsFromEnv();
  const id = await bootstrapAdmin(defaultDb, creds);
  if (id !== null) backfillRecordsUser(defaultDb, id);
  else {
    // Even if admin was created earlier, ensure no orphan records (no-op after first run).
    const first = defaultDb
      .prepare("SELECT id FROM users ORDER BY id LIMIT 1")
      .get() as { id: number } | undefined;
    if (first) backfillRecordsUser(defaultDb, first.id);
  }
}
```

- [ ] **Step 4: Call `bootstrapAuth()` from `index.ts`**

In `server/src/index.ts`, change:
```ts
seedIfEmpty();
cleanupExpiredSessions(db);
cleanupExpiredInvites(db);
```
to:
```ts
import { bootstrapAuth } from "./seed.js";

await bootstrapAuth();
seedIfEmpty();
cleanupExpiredSessions(db);
cleanupExpiredInvites(db);
```

(Place the new `import { bootstrapAuth }` near the other `./seed.js` import, and verify `"module": "ESNext"` + Node 22 already permits top-level `await`; the existing dev script `tsx watch --env-file=.env` honors this.)

- [ ] **Step 5: Run tests + build**

```bash
npm run test --workspace server
npm run build --workspace server
```
Expected: all green, clean build.

- [ ] **Step 6: Manual smoke test**

```bash
rm -f server/data.db
npm run dev:server
```
Expected: log `Created admin user you@example.com.` then `[babyone] server listening on ...`.

Stop the server (Ctrl-C) and try with creds missing:
```bash
rm -f server/data.db
env -u BABYONE_ADMIN_EMAIL npm run dev:server
```
Expected: log `No users in DB and BABYONE_ADMIN_* env vars not set.` and exit code 1.

- [ ] **Step 7: Commit**

```bash
git add server/src/seed.ts server/src/index.ts server/src/auth/bootstrap.test.ts
git commit -m "feat(server): bootstrap admin from env + backfill records.user_id"
```

---

# Phase 6 — Client auth

### Task 15: API client + UnauthenticatedError + cookie credentials

**Files:**
- Modify: `client/src/api.ts`
- Modify: `client/src/types.ts`

- [ ] **Step 1: Add `User` type**

In `client/src/types.ts`, after the `Baby` interface, add:
```ts
export interface User {
  id: number;
  email: string;
  displayName: string;
}
```

And widen `RoutineRecord`:
```ts
export interface RoutineRecord {
  id: number;
  type: RecordType;
  at: string;
  title: string;
  detail: string;
  meta: RecordMeta;
  user?: { id: number; displayName: string } | null;
}
```

- [ ] **Step 2: Replace `api.ts`**

Replace the contents of `client/src/api.ts` with:
```ts
import type { Baby, ChatMessage, RoutineRecord, User } from "./types";

export class UnauthenticatedError extends Error {
  constructor() {
    super("unauthenticated");
    this.name = "UnauthenticatedError";
  }
}

const json = async <T>(r: Response): Promise<T> => {
  if (r.status === 401) throw new UnauthenticatedError();
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()) as T;
};

const req = (path: string, init?: RequestInit): Promise<Response> =>
  fetch(path, { credentials: "include", ...init });

const post = (path: string, body: unknown): Promise<Response> =>
  req(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const api = {
  baby: () => req("/api/baby").then((r) => json<Baby>(r)),
  listRecords: () => req("/api/records").then((r) => json<RoutineRecord[]>(r)),
  updateRecord: (rec: RoutineRecord) =>
    req(`/api/records/${rec.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rec),
    }).then((r) => json<RoutineRecord>(r)),
  deleteRecord: (id: number) =>
    req(`/api/records/${id}`, { method: "DELETE" }).then((r) =>
      json<{ ok: boolean }>(r),
    ),
  listMessages: () =>
    req("/api/messages").then((r) => json<ChatMessage[]>(r)),
  brief: () =>
    post("/api/brief/today", {
      localDate: new Date().toLocaleDateString("en-CA"),
      tzOffsetMin: new Date().getTimezoneOffset(),
    }).then((r) => json<{ message: ChatMessage | null }>(r)),
  chat: (text: string) =>
    post("/api/chat", { text }).then((r) =>
      json<{
        userMsg: ChatMessage;
        botMsg: ChatMessage;
        created: RoutineRecord[];
        updated: RoutineRecord[];
        deleted: number[];
      }>(r),
    ),

  // Auth
  me: () => req("/api/auth/me").then((r) => json<{ user: User }>(r)),
  login: (email: string, password: string) =>
    post("/api/auth/login", { email, password }).then((r) =>
      json<{ user: User }>(r),
    ),
  signup: (input: {
    code: string;
    email: string;
    password: string;
    displayName: string;
  }) => post("/api/auth/signup", input).then((r) => json<{ user: User }>(r)),
  logout: () => post("/api/auth/logout", {}).then((r) => json<{ ok: boolean }>(r)),
  createInvite: () =>
    post("/api/invites", {}).then((r) =>
      json<{ code: string; expiresAt: string; url: string }>(r),
    ),
};
```

- [ ] **Step 3: Commit**

```bash
git add client/src/api.ts client/src/types.ts
git commit -m "feat(client): credentialed API client + UnauthenticatedError"
```

---

### Task 16: `useMe` + global 401 handling

**Files:**
- Create: `client/src/auth/useAuth.ts`
- Modify: `client/src/queries.ts`
- Modify: `client/src/main.tsx`

- [ ] **Step 1: Create `useAuth.ts`**

Create `client/src/auth/useAuth.ts`:
```ts
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, UnauthenticatedError } from "../api";

export const meKey = ["me"] as const;

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: () => api.me().then((r) => r.user),
    retry: false,
    staleTime: Infinity,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      api.login(email, password),
    onSuccess: (r) => qc.setQueryData(meKey, r.user),
  });
}

export function useSignup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.signup,
    onSuccess: (r) => qc.setQueryData(meKey, r.user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => qc.clear(),
  });
}

export function useCreateInvite() {
  return useMutation({ mutationFn: api.createInvite });
}

export { UnauthenticatedError };
```

- [ ] **Step 2: Gate existing queries on `me`**

Edit `client/src/queries.ts`. Add at the top:
```ts
import { useMe } from "./auth/useAuth";
```

Then change `useRecords`, `useMessages`, `useBaby` to:
```ts
export function useRecords() {
  const me = useMe();
  return useQuery({
    queryKey: recordsKey,
    queryFn: api.listRecords,
    select: sortRecords,
    enabled: !!me.data,
  });
}

export function useMessages() {
  const me = useMe();
  return useQuery({
    queryKey: messagesKey,
    queryFn: api.listMessages,
    enabled: !!me.data,
  });
}

export function useBaby() {
  const me = useMe();
  return useQuery({
    queryKey: babyKey,
    queryFn: api.baby,
    enabled: !!me.data,
  });
}
```

And in `useBrief`:
```ts
export function useBrief() {
  const me = useMe();
  return useQuery({
    queryKey: ["brief", new Date().toLocaleDateString("en-CA")],
    queryFn: api.brief,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: !!me.data,
  });
}
```

- [ ] **Step 3: Wire global 401 → reset me**

Replace `client/src/main.tsx` with:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { App } from "./App";
import { UnauthenticatedError } from "./api";
import { meKey } from "./auth/useAuth";
import "./styles.css";

const onAuthError = (err: unknown) => {
  if (err instanceof UnauthenticatedError) {
    queryClient.setQueryData(meKey, null);
  }
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  queryCache: new QueryCache({ onError: onAuthError }),
  mutationCache: new MutationCache({ onError: onAuthError }),
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 4: Verify the client typechecks**

Run: `npm run typecheck --workspace client`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/auth/useAuth.ts client/src/queries.ts client/src/main.tsx
git commit -m "feat(client): useMe + global 401 invalidation"
```

---

### Task 17: `LoginPage` and `SignupPage`

**Files:**
- Create: `client/src/auth/LoginPage.tsx`
- Create: `client/src/auth/SignupPage.tsx`
- Create: `client/src/auth/Splash.tsx`
- Test: `client/src/auth/LoginPage.test.tsx`

- [ ] **Step 1: Create `Splash.tsx`**

Create `client/src/auth/Splash.tsx`:
```tsx
export function Splash() {
  return (
    <div className="splash">
      <div className="logo-mark">c</div>
    </div>
  );
}
```

- [ ] **Step 2: Create `LoginPage.tsx`**

Create `client/src/auth/LoginPage.tsx`:
```tsx
import { useState } from "react";
import { useLogin } from "./useAuth";

export function LoginPage() {
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const errMsg =
    login.error instanceof Error
      ? login.error.message === "401 Unauthorized"
        ? "Wrong email or password."
        : login.error.message
      : null;

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Sign in</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate({ email, password });
          }}
        >
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {errMsg && <div className="auth-error">{errMsg}</div>}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={login.isPending}
          >
            {login.isPending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `SignupPage.tsx`**

Create `client/src/auth/SignupPage.tsx`:
```tsx
import { useState } from "react";
import { useSignup } from "./useAuth";

function readInviteCode(): string {
  const m = window.location.search.match(/[?&]code=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export function SignupPage() {
  const signup = useSignup();
  const [code] = useState(readInviteCode);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const errMsg = signup.error instanceof Error ? signup.error.message : null;

  if (!code) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1>Need an invite link</h1>
          <p>
            Ask the person who already uses babyone to send you a fresh
            invite link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Create your account</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            signup.mutate({ code, email, password, displayName });
          }}
        >
          <label>
            Display name
            <input
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password (8+ chars)
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {errMsg && <div className="auth-error">{errMsg}</div>}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={signup.isPending}
          >
            {signup.isPending ? "Creating…" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Render test for LoginPage**

Create `client/src/auth/LoginPage.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";
import { LoginPage } from "./LoginPage";

function Wrap({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("LoginPage", () => {
  it("renders email and password fields", () => {
    render(
      <Wrap>
        <LoginPage />
      </Wrap>,
    );
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run client tests**

Run: `npm run test --workspace client`
Expected: 1 new test passes.

- [ ] **Step 6: Commit**

```bash
git add client/src/auth/LoginPage.tsx client/src/auth/SignupPage.tsx client/src/auth/Splash.tsx client/src/auth/LoginPage.test.tsx
git commit -m "feat(client): login + signup screens"
```

---

### Task 18: `AuthGate` in `App.tsx`

**Files:**
- Modify: `client/src/App.tsx`
- Test: `client/src/App.test.tsx`

- [ ] **Step 1: Refactor `App.tsx`**

Split the existing app body out so we can show/hide based on `useMe`. Replace `client/src/App.tsx` with:

```tsx
import { useEffect, useState } from "react";
import type { RoutineRecord, User } from "./types";
import { CalendarScreen } from "./components/CalendarScreen";
import { ChatScreen } from "./components/ChatScreen";
import { DashScreen } from "./components/DashScreen";
import { Icon } from "./components/icons";
import { RecordModal } from "./components/RecordModal";
import { Sidebar, TabBar } from "./components/Sidebar";
import { TodayScreen } from "./components/TodayScreen";
import { TrendsScreen } from "./components/TrendsScreen";
import type { View } from "./components/views";
import {
  useBaby,
  useDeleteRecord,
  useRecords,
  useUpdateRecord,
} from "./queries";
import { useMe } from "./auth/useAuth";
import { LoginPage } from "./auth/LoginPage";
import { SignupPage } from "./auth/SignupPage";
import { Splash } from "./auth/Splash";

const titles: Record<View, { t: string; s: string }> = {
  chat: {
    t: "Chat with Clement",
    s: "Tell me what just happened — I'll log it.",
  },
  today: { t: "Today's timeline", s: "Everything that happened, in order." },
  dash: { t: "Dashboard", s: "Today at a glance." },
  trends: { t: "Trends", s: "Patterns over the last week or two." },
  calendar: { t: "Calendar", s: "Browse history by day." },
};

const readView = (): View => {
  const v = localStorage.getItem("clement.view");
  return (["chat", "today", "dash", "trends", "calendar"] as View[]).includes(
    v as View,
  )
    ? (v as View)
    : "chat";
};
const readTheme = (): "light" | "dark" =>
  localStorage.getItem("clement.theme") === "dark" ? "dark" : "light";

export function App() {
  const me = useMe();
  if (me.isLoading) return <Splash />;
  if (!me.data) {
    if (window.location.pathname === "/signup") return <SignupPage />;
    return <LoginPage />;
  }
  return <AuthenticatedApp user={me.data} />;
}

function AuthenticatedApp({ user }: { user: User }) {
  const [view, setView] = useState<View>(readView);
  const [theme, setTheme] = useState<"light" | "dark">(readTheme);
  const [editing, setEditing] = useState<RoutineRecord | null>(null);

  const recordsQuery = useRecords();
  const babyQuery = useBaby();
  const updateRecordMut = useUpdateRecord();
  const deleteRecordMut = useDeleteRecord();

  const records = recordsQuery.data ?? [];
  const baby = babyQuery.data ?? null;
  const loadError = recordsQuery.error ?? babyQuery.error;
  const loadErr = loadError instanceof Error ? loadError.message : null;

  useEffect(() => {
    localStorage.setItem("clement.view", view);
  }, [view]);
  useEffect(() => {
    localStorage.setItem("clement.theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const updateRecord = (r: RoutineRecord) => updateRecordMut.mutate(r);
  const deleteRecord = (id: number) =>
    deleteRecordMut.mutate(id, { onSuccess: () => setEditing(null) });

  return (
    <div className="app">
      <Sidebar
        view={view}
        setView={setView}
        theme={theme}
        setTheme={setTheme}
        baby={baby}
        user={user}
      />
      <main className="main">
        <header className="topbar">
          <div>
            <h1>{titles[view].t}</h1>
            <div className="topbar-sub">
              {loadErr ? `Server offline: ${loadErr}` : titles[view].s}
            </div>
          </div>
          <div className="topbar-actions">
            {view !== "chat" && (
              <button
                className="btn btn-primary"
                onClick={() => setView("chat")}
              >
                <Icon.plus /> Log via chat
              </button>
            )}
          </div>
        </header>
        <div className="screen">
          {view === "chat" && <ChatScreen records={records} />}
          {view === "today" && (
            <TodayScreen records={records} openRecord={setEditing} />
          )}
          {view === "dash" && (
            <DashScreen records={records} setView={setView} />
          )}
          {view === "trends" && <TrendsScreen records={records} />}
          {view === "calendar" && (
            <CalendarScreen records={records} openRecord={setEditing} />
          )}
        </div>
      </main>
      <TabBar view={view} setView={setView} />
      {editing && (
        <RecordModal
          record={editing}
          onClose={() => setEditing(null)}
          onSave={updateRecord}
          onDelete={deleteRecord}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render test for `AuthGate`**

Create `client/src/App.test.tsx`:
```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { App } from "./App";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function Wrap({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("AuthGate", () => {
  it("shows LoginPage when /api/auth/me returns 401", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("", { status: 401 }) as Response,
    );
    render(
      <Wrap>
        <App />
      </Wrap>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 3: Run client tests**

Run: `npm run test --workspace client`
Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx client/src/App.test.tsx
git commit -m "feat(client): AuthGate routes unauthenticated users to login/signup"
```

---

### Task 19: Sidebar — invite panel, logout, current user

**Files:**
- Modify: `client/src/components/Sidebar.tsx`
- Create: `client/src/auth/InvitePanel.tsx`
- Modify: `client/src/styles.css` (small additions only)

- [ ] **Step 1: Create `InvitePanel.tsx`**

Create `client/src/auth/InvitePanel.tsx`:
```tsx
import { useState } from "react";
import { useCreateInvite } from "./useAuth";

export function InvitePanel() {
  const create = useCreateInvite();
  const [copied, setCopied] = useState(false);
  const url = create.data?.url;

  return (
    <div className="invite-panel">
      <button
        className="btn"
        onClick={() => {
          setCopied(false);
          create.mutate();
        }}
        disabled={create.isPending}
      >
        {create.isPending ? "Generating…" : "Invite caregiver"}
      </button>
      {url && (
        <div className="invite-result">
          <code>{url}</code>
          <button
            className="btn btn-small"
            onClick={() => {
              void navigator.clipboard.writeText(url);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <div className="invite-hint">Expires in 24h</div>
        </div>
      )}
      {create.error && (
        <div className="auth-error">{(create.error as Error).message}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update `Sidebar.tsx`**

Replace `client/src/components/Sidebar.tsx` with the same code, but:
- Add prop `user: User`
- Render the user's `displayName` somewhere
- Append `InvitePanel` + "Sign out" button in `sidebar-footer`

Edit the props block and the footer:

```tsx
import type { Baby, User } from "../types";
import { Icon } from "./icons";
import type { View } from "./views";
import { InvitePanel } from "../auth/InvitePanel";
import { useLogout } from "../auth/useAuth";
```

In the `Sidebar` props:
```tsx
export function Sidebar({
  view,
  setView,
  theme,
  setTheme,
  baby,
  user,
}: {
  view: View;
  setView: (v: View) => void;
  theme: "light" | "dark";
  setTheme: (t: "light" | "dark") => void;
  baby: Baby | null;
  user: User;
}) {
  const logout = useLogout();
  ...
```

And replace the `sidebar-footer` div with:
```tsx
<div className="sidebar-footer">
  <div className="me-card">
    Signed in as <strong>{user.displayName}</strong>
  </div>
  <InvitePanel />
  <button
    className="theme-toggle"
    onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
  >
    <span>{theme === "dark" ? "Dark mode" : "Light mode"}</span>
    <div className={`toggle-switch ${theme === "dark" ? "on" : ""}`} />
  </button>
  <button
    className="btn btn-small"
    onClick={() => logout.mutate()}
    disabled={logout.isPending}
  >
    Sign out
  </button>
</div>
```

- [ ] **Step 3: Add minimal CSS**

Append to `client/src/styles.css`:
```css
.auth-screen {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: var(--bg, #f6f7f9);
}
.auth-card {
  width: min(360px, 92vw);
  padding: 32px;
  background: var(--card, white);
  border-radius: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}
.auth-card h1 { margin: 0 0 16px; font-size: 20px; }
.auth-card form { display: grid; gap: 12px; }
.auth-card label { display: grid; gap: 4px; font-size: 12px; color: #64748b; }
.auth-card input {
  padding: 8px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font: inherit;
}
.auth-error { color: #b91c1c; font-size: 13px; }
.invite-panel { display: grid; gap: 8px; padding: 8px 0; }
.invite-result { display: grid; gap: 4px; font-size: 12px; }
.invite-result code { word-break: break-all; }
.invite-hint { color: #94a3b8; }
.me-card { font-size: 12px; color: #64748b; padding: 4px 0; }
.btn-small { padding: 4px 8px; font-size: 12px; }
.splash { min-height: 100vh; display: grid; place-items: center; }
```

- [ ] **Step 4: Typecheck and run**

Run: `npm run typecheck --workspace client`
Expected: clean.

Run: `npm run test --workspace client`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Sidebar.tsx client/src/auth/InvitePanel.tsx client/src/styles.css
git commit -m "feat(client): sidebar invite panel + logout"
```

---

### Task 20: Show "Logged by X" in RecordModal

**Files:**
- Modify: `client/src/components/RecordModal.tsx`

- [ ] **Step 1: Locate the timestamp render in `RecordModal.tsx`**

Open the file and find the area that renders the timestamp / metadata for the record being edited.

- [ ] **Step 2: Insert a "Logged by …" line**

Where the record's `at` timestamp is shown, add:
```tsx
{record.user?.displayName && (
  <div className="logged-by">Logged by {record.user.displayName}</div>
)}
```

- [ ] **Step 3: Add the CSS**

Append to `client/src/styles.css`:
```css
.logged-by { font-size: 12px; color: #94a3b8; margin-top: 4px; }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck --workspace client`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/RecordModal.tsx client/src/styles.css
git commit -m "feat(client): show 'Logged by X' on record details"
```

---

# Phase 7 — End-to-end smoke + docs

### Task 21: Manual smoke test

- [ ] **Step 1: Remove any stale dev DB**

```bash
rm -f server/data.db
```

- [ ] **Step 2: Start both servers**

```bash
npm run dev
```
Expected: server logs "Created admin user …" and "server listening", Vite logs http://localhost:5173.

- [ ] **Step 3: Verify gating**

```bash
curl -i http://localhost:8787/api/records
```
Expected: `HTTP/1.1 401` + `{"error":"unauthenticated"}`.

- [ ] **Step 4: Log in via the UI**

Open http://localhost:5173. Expected: LoginPage. Enter the admin email/password from `server/.env`. Expected: app shell loads with sidebar "Signed in as Dev".

- [ ] **Step 5: Generate an invite**

Click "Invite caregiver". Expected: a URL of the form `http://localhost:5173/signup?code=…`. Open it in a private window. Sign up with a second email/password. Expected: app shell loads, signed in as the new user.

- [ ] **Step 6: Confirm "Logged by"**

In the second account, log a record via chat. Open it from "Today". Expected: "Logged by Bob" under timestamp.

- [ ] **Step 7: Sign out**

Click "Sign out". Expected: returns to LoginPage. Refresh — still on LoginPage (cookie gone).

- [ ] **Step 8: Origin check**

```bash
curl -i -X POST http://localhost:8787/api/auth/login \
  -H 'content-type: application/json' \
  -H 'Origin: https://evil.example' \
  -d '{"email":"x","password":"x"}'
```
Expected: `HTTP/1.1 403` + `{"error":"bad_origin"}`.

If any step fails, debug and fix before continuing.

---

### Task 22: Update README + DEPLOY

**Files:**
- Modify: `README.md`
- Modify: `DEPLOY.md`

- [ ] **Step 1: README — add an Auth section**

Insert before "Deployment" or at an appropriate spot in `README.md`:

```md
## Authentication

babyone is single-household but multi-caregiver. The first time the server boots
against an empty database it provisions an admin user from environment variables:

```
BABYONE_ADMIN_EMAIL=you@example.com
BABYONE_ADMIN_PASSWORD=<long random string>
BABYONE_ADMIN_NAME=Calvin
BABYONE_ORIGIN=https://babyone.fly.dev
```

After the first successful boot you can unset the `BABYONE_ADMIN_*` vars.

Additional caregivers join via one-time invite links generated in the sidebar
("Invite caregiver"). Invites expire after 24h.

**Password recovery:** there is no self-service reset. To recover a forgotten
password, an existing caregiver: (1) deletes the row from the `users` table
(`DELETE FROM users WHERE email = ?`) — sessions cascade-delete — (2) generates
a fresh invite for that caregiver to sign up again with the same email.
```

- [ ] **Step 2: DEPLOY.md — add secrets + remove "No auth"**

In `DEPLOY.md` "Secrets" section, append:
```md
- `BABYONE_ORIGIN` set via `fly secrets set BABYONE_ORIGIN=https://babyone.fly.dev`.
- For the *first* deploy against an empty DB, also set
  `BABYONE_ADMIN_EMAIL`, `BABYONE_ADMIN_PASSWORD`, `BABYONE_ADMIN_NAME`.
  After the machine boots once and logs "Created admin user …", run
  `fly secrets unset BABYONE_ADMIN_EMAIL BABYONE_ADMIN_PASSWORD BABYONE_ADMIN_NAME`.
```

In "Known issues", **delete the "No auth." bullet** entirely.

- [ ] **Step 3: Commit**

```bash
git add README.md DEPLOY.md
git commit -m "docs: caregiver auth env vars + first-run bootstrap"
```

---

# Phase 8 — Wrap-up

### Task 23: Final verification

- [ ] **Step 1: Server tests + build**

```bash
npm run test --workspace server
npm run build --workspace server
```
Expected: all tests pass, build clean.

- [ ] **Step 2: Client tests + build**

```bash
npm run test --workspace client
npm run build --workspace client
```
Expected: all tests pass, build clean.

- [ ] **Step 3: Branch state**

```bash
git status
git log --oneline main..HEAD
```
Expected: clean working tree, ~17 commits on `feat/caregiver-auth`.

- [ ] **Step 4: Finish-branch**

Invoke `superpowers:finishing-a-development-branch` and follow it to open a PR.

---

# Self-review notes (for the implementer)

- **Order matters in `index.ts`:** `originGuard` before everything; open routes (`/api/health`, `/api/auth/login`, `/api/auth/signup`, `/api/auth/me`) before `requireAuth`; `requireAuth` before all other `/api/*`. The mounting order in Task 13 follows this.
- **`/api/auth/me` is intentionally open** (returns 401 if no cookie). The client uses it to detect "are we signed in?" — gating it with `requireAuth` would still 401, but with an additional middleware round-trip.
- **`/api/invites` is gated.** Hono runs middleware in registration order and stops at the first matching handler that returns a response. So `requireAuth` only protects routes registered **after** it. `/api/invites` is therefore split into `mountInviteRoutes()` and mounted in `index.ts` *after* `requireAuth`. `routes.signup.test.ts` mirrors this by mounting the guard then `mountInviteRoutes()`.
- **`PUT /api/records/:id`** is also gated. We deliberately do **not** rewrite `user_id` on update — the original logger keeps attribution.
- **CORS in dev:** the spec assumes single-origin in prod (server serves SPA). In dev, Vite runs on :5173 and proxies to :8787. The credentialed CORS in Task 13 is needed for cookies to cross origins in dev. Vite proxy config is not required for this plan to work.
- **No Zod.** All body parsing is `as Record<string, unknown>` plus `asString()`. Keep it that way — introducing Zod is out of scope.
- **No data migration framework.** All schema changes go through `applyAuthSchema()` (idempotent) called from `db.ts` top-level.
