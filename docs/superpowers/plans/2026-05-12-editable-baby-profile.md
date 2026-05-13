# Editable Baby Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user edit the baby's name, birthdate, and weight from a modal opened by clicking the sidebar baby card, persisting to SQLite.

**Architecture:** Single Baby singleton stored as a JSON blob in the existing `kv` table. Server exposes `GET /api/baby` (reads from db) and `PUT /api/baby` (validates and writes). Client adds a modal opened from the sidebar baby card, with the displayed age derived from `birthdate`.

**Tech Stack:** Hono + better-sqlite3 (server), React 18 + Vite (client), TypeScript end-to-end. No test framework — verification is manual via `npm run build`, `curl`, and the browser.

**Spec:** `docs/superpowers/specs/2026-05-12-editable-baby-profile-design.md`

## File Map

**Server:**
- Modify `server/src/types.ts` — add `Baby` interface
- Modify `server/src/db.ts` — add `getBaby` / `setBaby` helpers
- Modify `server/src/seed.ts` — seed default Baby if absent
- Modify `server/src/index.ts` — replace hardcoded `GET /api/baby`; add `PUT /api/baby`

**Client:**
- Modify `client/src/types.ts` — replace `Baby` interface shape
- Modify `client/src/utils.ts` — add `formatBabyAge` and `formatBabyWeight`
- Modify `client/src/api.ts` — add `updateBaby`
- Modify `client/src/App.tsx` — wire up edit modal + handler
- Modify `client/src/components/Sidebar.tsx` — make baby card clickable, use new derived display
- Modify `client/src/components/icons.tsx` — add a pencil icon
- Create `client/src/components/BabyProfileModal.tsx` — new modal component
- Modify `client/src/styles.css` — hover/focus affordance on baby card

---

## Task 1: Add `Baby` type on the server

**Files:**
- Modify: `server/src/types.ts`

- [ ] **Step 1: Add the `Baby` interface to `server/src/types.ts`**

Append after the existing `ParseResult` interface (after line 45):

```ts
export interface Baby {
  name: string;
  birthdate: string;   // ISO date "YYYY-MM-DD"
  weightValue: number; // > 0, finite
  weightUnit: "lb" | "kg";
}
```

- [ ] **Step 2: Verify typecheck**

Run:
```bash
npm --workspace server run build
```
Expected: exits 0, no TS errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/types.ts
git commit -m "feat(server): add Baby type"
```

---

## Task 2: Add `getBaby` / `setBaby` db helpers

**Files:**
- Modify: `server/src/db.ts`

- [ ] **Step 1: Import `Baby` type**

In `server/src/db.ts` change the type import at the top (currently lines 4–9) to include `Baby`:

```ts
import type {
  Baby,
  ChatMessage,
  RoutineRecord,
  RecordMeta,
  RecordType,
} from "./types.js";
```

- [ ] **Step 2: Add `getBaby` and `setBaby` at the end of `server/src/db.ts`**

Append after the `markSeeded` function:

```ts
export const getBaby = (): Baby | null => {
  const row = db.prepare("SELECT v FROM kv WHERE k=?").get("baby") as
    | { v: string }
    | undefined;
  return row ? (JSON.parse(row.v) as Baby) : null;
};

export const setBaby = (b: Baby): Baby => {
  db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)").run(
    "baby",
    JSON.stringify(b),
  );
  return b;
};
```

- [ ] **Step 3: Verify typecheck**

```bash
npm --workspace server run build
```
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add server/src/db.ts
git commit -m "feat(server): add getBaby/setBaby kv helpers"
```

---

## Task 3: Seed default baby on first run

**Files:**
- Modify: `server/src/seed.ts`

- [ ] **Step 1: Import the new helpers and `Baby` type**

Replace the first two lines of `server/src/seed.ts`:

```ts
import {
  getBaby,
  insertMessage,
  insertRecord,
  isSeeded,
  markSeeded,
  setBaby,
} from "./db.js";
import type { Baby, RoutineRecord } from "./types.js";
```

- [ ] **Step 2: Seed the default Baby**

At the very top of the `seedIfEmpty` function body — i.e. before the `if (isSeeded()) return;` line — insert:

```ts
  if (!getBaby()) {
    const today = new Date();
    const birth = new Date(today);
    birth.setDate(birth.getDate() - 18);
    const birthdate = birth.toISOString().slice(0, 10);
    const defaultBaby: Baby = {
      name: "Clement",
      birthdate,
      weightValue: 7.4,
      weightUnit: "lb",
    };
    setBaby(defaultBaby);
  }
```

(This runs every server start, but is idempotent: only seeds when `baby` row is absent. It must run independently of `isSeeded()` so that existing deployments — which already have `seeded=1` but no `baby` row — get the default on next start.)

- [ ] **Step 3: Verify build**

```bash
npm --workspace server run build
```
Expected: exits 0.

- [ ] **Step 4: Verify seeding behavior end-to-end**

```bash
rm -f /tmp/baby-test.db
BABYONE_DB=/tmp/baby-test.db PORT=8788 npm --workspace server run start &
sleep 2
curl -s http://localhost:8788/api/baby
kill %1 2>/dev/null
```

Expected JSON output (birthdate ≈ today minus 18 days):
```
{"name":"Clement","birthdate":"YYYY-MM-DD","weightValue":7.4,"weightUnit":"lb"}
```

- [ ] **Step 5: Commit**

```bash
git add server/src/seed.ts
git commit -m "feat(server): seed default baby profile"
```

---

## Task 4: Update `GET /api/baby` and add `PUT /api/baby`

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Update imports**

Change the `./db.js` import block (currently lines 5–12) to:

```ts
import {
  deleteRecord,
  getBaby,
  insertMessage,
  insertRecord,
  listMessages,
  listRecords,
  setBaby,
  updateRecord,
} from "./db.js";
```

Change the type import (currently line 15) to:

```ts
import type { Baby, RoutineRecord } from "./types.js";
```

- [ ] **Step 2: Replace the hardcoded `GET /api/baby` handler**

Replace lines 24–30 (the current `app.get("/api/baby", ...)` block) with:

```ts
app.get("/api/baby", (c) => {
  const b = getBaby();
  if (!b) return c.json({ error: "baby not seeded" }, 500);
  return c.json(b);
});
```

- [ ] **Step 3: Add `PUT /api/baby` with validation**

Insert immediately after the new `GET /api/baby` handler:

```ts
const isValidIsoDate = (s: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());

const validateBaby = (b: Partial<Baby>): string | null => {
  if (typeof b.name !== "string" || !b.name.trim()) return "name required";
  if (b.name.trim().length > 60) return "name too long";
  if (typeof b.birthdate !== "string" || !isValidIsoDate(b.birthdate))
    return "birthdate must be YYYY-MM-DD";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (new Date(b.birthdate).getTime() > today.getTime())
    return "birthdate cannot be in the future";
  if (
    typeof b.weightValue !== "number" ||
    !Number.isFinite(b.weightValue) ||
    b.weightValue <= 0 ||
    b.weightValue >= 1000
  )
    return "weightValue must be a positive number under 1000";
  if (b.weightUnit !== "lb" && b.weightUnit !== "kg")
    return "weightUnit must be 'lb' or 'kg'";
  return null;
};

app.put("/api/baby", async (c) => {
  const body = (await c.req.json()) as Partial<Baby>;
  const err = validateBaby(body);
  if (err) return c.json({ error: err }, 400);
  const saved = setBaby({
    name: body.name!.trim(),
    birthdate: body.birthdate!,
    weightValue: body.weightValue!,
    weightUnit: body.weightUnit!,
  });
  return c.json(saved);
});
```

- [ ] **Step 4: Verify build**

```bash
npm --workspace server run build
```
Expected: exits 0.

- [ ] **Step 5: Verify endpoints**

```bash
rm -f /tmp/baby-test.db
BABYONE_DB=/tmp/baby-test.db PORT=8788 npm --workspace server run start &
sleep 2

# Read
curl -s http://localhost:8788/api/baby

# Valid update
curl -s -X PUT http://localhost:8788/api/baby \
  -H 'content-type: application/json' \
  -d '{"name":"Clem","birthdate":"2026-04-20","weightValue":8.1,"weightUnit":"lb"}'

# Re-read to confirm persisted
curl -s http://localhost:8788/api/baby

# Invalid: empty name
curl -si -X PUT http://localhost:8788/api/baby \
  -H 'content-type: application/json' \
  -d '{"name":"","birthdate":"2026-04-20","weightValue":8.1,"weightUnit":"lb"}' | head -n 1

# Invalid: future birthdate
curl -si -X PUT http://localhost:8788/api/baby \
  -H 'content-type: application/json' \
  -d '{"name":"x","birthdate":"2099-01-01","weightValue":8,"weightUnit":"lb"}' | head -n 1

# Invalid: weight 0
curl -si -X PUT http://localhost:8788/api/baby \
  -H 'content-type: application/json' \
  -d '{"name":"x","birthdate":"2026-04-20","weightValue":0,"weightUnit":"lb"}' | head -n 1

# Invalid: bad unit
curl -si -X PUT http://localhost:8788/api/baby \
  -H 'content-type: application/json' \
  -d '{"name":"x","birthdate":"2026-04-20","weightValue":8,"weightUnit":"oz"}' | head -n 1

kill %1 2>/dev/null
```

Expected:
- Read returns the seeded default.
- Valid update returns `{"name":"Clem","birthdate":"2026-04-20","weightValue":8.1,"weightUnit":"lb"}`.
- Re-read returns the same updated values.
- All four invalid requests return `HTTP/1.1 400 Bad Request`.

- [ ] **Step 6: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): read/update baby profile endpoints"
```

---

## Task 5: Update client `Baby` type

**Files:**
- Modify: `client/src/types.ts`

- [ ] **Step 1: Replace the `Baby` interface**

Replace lines 42–46 of `client/src/types.ts`:

```ts
export interface Baby {
  name: string;
  birthdate: string;   // ISO date "YYYY-MM-DD"
  weightValue: number;
  weightUnit: "lb" | "kg";
}
```

- [ ] **Step 2: Verify typecheck (will fail at consumers — fixed in next tasks)**

```bash
npm --workspace client run typecheck
```
Expected: errors in `Sidebar.tsx` referencing `baby.age` and `baby.weight`. This is fine — those will be fixed in Task 8.

- [ ] **Step 3: Do not commit yet** — the type change leaves the client uncompilable until Task 8. Wait until the full client side is updated.

---

## Task 6: Add `formatBabyAge` and `formatBabyWeight` helpers

**Files:**
- Modify: `client/src/utils.ts`

- [ ] **Step 1: Append helpers to `client/src/utils.ts`**

Append at end of file:

```ts
export const formatBabyAge = (birthdate: string, now: Date = new Date()): string => {
  const birth = new Date(`${birthdate}T00:00:00`);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  birth.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.round((today.getTime() - birth.getTime()) / 86400000));

  if (days === 0) return "newborn";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"}`;

  if (days < 365) {
    const weeks = Math.floor(days / 7);
    if (weeks < 9) return `${weeks} week${weeks === 1 ? "" : "s"}`;
    const months = Math.floor(days / 30.44);
    return `${months} month${months === 1 ? "" : "s"}`;
  }

  const years = Math.floor(days / 365.25);
  const remainingDays = days - Math.floor(years * 365.25);
  const months = Math.floor(remainingDays / 30.44);
  if (months === 0) return `${years} year${years === 1 ? "" : "s"}`;
  return `${years} year${years === 1 ? "" : "s"} ${months} month${months === 1 ? "" : "s"}`;
};

export const formatBabyWeight = (b: { weightValue: number; weightUnit: "lb" | "kg" }): string => {
  const v = Number(b.weightValue.toFixed(2));
  return `${v} ${b.weightUnit}`;
};
```

- [ ] **Step 2: Verify typecheck**

```bash
npm --workspace client run typecheck
```
Expected: still the pre-existing `Sidebar.tsx` errors from Task 5, but no new errors from `utils.ts`.

- [ ] **Step 3: Do not commit yet** — bundle with the rest of the client changes.

---

## Task 7: Add `updateBaby` API call

**Files:**
- Modify: `client/src/api.ts`

- [ ] **Step 1: Add the `updateBaby` method**

Inside the `api` object in `client/src/api.ts`, add (right after the existing `baby` method):

```ts
  updateBaby: (b: Baby) =>
    fetch("/api/baby", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(b),
    }).then((r) => json<Baby>(r)),
```

- [ ] **Step 2: Verify typecheck**

```bash
npm --workspace client run typecheck
```
Expected: still the pre-existing `Sidebar.tsx` errors only.

- [ ] **Step 3: Do not commit yet.**

---

## Task 8: Add pencil icon

**Files:**
- Modify: `client/src/components/icons.tsx`

- [ ] **Step 1: Inspect existing icon style**

```bash
head -n 40 client/src/components/icons.tsx
```
Confirm icons are exported as keys on an `Icon` object (e.g. `Icon.plus`) and are simple SVG functional components.

- [ ] **Step 2: Add the pencil icon**

Add a new entry in the `Icon` object following the existing pattern. Example shape (adapt to the file's exact style — match indentation and the prop type used by neighbours):

```tsx
pencil: (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" width="16" height="16" {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
),
```

- [ ] **Step 3: Verify typecheck**

```bash
npm --workspace client run typecheck
```
Expected: still the pre-existing `Sidebar.tsx` errors only — no new errors.

- [ ] **Step 4: Do not commit yet.**

---

## Task 9: Create `BabyProfileModal` component

**Files:**
- Create: `client/src/components/BabyProfileModal.tsx`

- [ ] **Step 1: Write the modal**

Create `client/src/components/BabyProfileModal.tsx`:

```tsx
import { useState } from "react";
import type { Baby } from "../types";
import { Icon } from "./icons";

const validate = (b: Baby): string | null => {
  if (!b.name.trim()) return "Name is required";
  if (b.name.trim().length > 60) return "Name is too long";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.birthdate)) return "Birthdate must be a date";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (new Date(`${b.birthdate}T00:00:00`).getTime() > today.getTime())
    return "Birthdate cannot be in the future";
  if (!Number.isFinite(b.weightValue) || b.weightValue <= 0 || b.weightValue >= 1000)
    return "Weight must be a positive number under 1000";
  if (b.weightUnit !== "lb" && b.weightUnit !== "kg")
    return "Weight unit must be lb or kg";
  return null;
};

export function BabyProfileModal({
  baby,
  onClose,
  onSave,
}: {
  baby: Baby;
  onClose: () => void;
  onSave: (b: Baby) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Baby>({ ...baby });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setField = <K extends keyof Baby>(k: K, v: Baby[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const onSubmit = async () => {
    const v = validate(draft);
    if (v) {
      setErr(v);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await onSave({ ...draft, name: draft.name.trim() });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <h2>Edit baby</h2>
          <button className="modal-close" onClick={onClose}>
            <Icon.close />
          </button>
        </div>

        <div className="modal-field">
          <label>Name</label>
          <input
            value={draft.name}
            onChange={(e) => setField("name", e.target.value)}
            maxLength={60}
          />
        </div>

        <div className="modal-field">
          <label>Birthdate</label>
          <input
            type="date"
            value={draft.birthdate}
            onChange={(e) => setField("birthdate", e.target.value)}
          />
        </div>

        <div className="modal-field">
          <label>Weight</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              step="0.1"
              min="0"
              value={Number.isFinite(draft.weightValue) ? draft.weightValue : ""}
              onChange={(e) =>
                setField("weightValue", parseFloat(e.target.value))
              }
              style={{ flex: 1 }}
            />
            <select
              value={draft.weightUnit}
              onChange={(e) =>
                setField("weightUnit", e.target.value as "lb" | "kg")
              }
            >
              <option value="lb">lb</option>
              <option value="kg">kg</option>
            </select>
          </div>
        </div>

        {err && (
          <div className="modal-field" style={{ color: "var(--warn)" }}>
            {err}
          </div>
        )}

        <div className="modal-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={onSubmit}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm --workspace client run typecheck
```
Expected: still only the pre-existing `Sidebar.tsx` errors from Task 5.

- [ ] **Step 3: Do not commit yet.**

---

## Task 10: Wire modal into `App.tsx` and update `Sidebar`

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/Sidebar.tsx`

- [ ] **Step 1: Update `App.tsx` imports**

In `client/src/App.tsx`, change the components import block (lines 4–11) to additionally include `BabyProfileModal`:

```tsx
import { BabyProfileModal } from "./components/BabyProfileModal";
```

(Add this import alongside the existing ones — alphabetical order keeps `BabyProfileModal` near the top of the components imports.)

- [ ] **Step 2: Add edit state and handler to `App.tsx`**

Inside the `App` function, after the existing `const [editing, setEditing] = useState<RoutineRecord | null>(null);` line (around line 45), add:

```tsx
  const [editingBaby, setEditingBaby] = useState(false);
```

Then below the `deleteRecord` function (around line 92), add:

```tsx
  const updateBaby = async (b: Baby) => {
    const saved = await api.updateBaby(b);
    setBaby(saved);
  };
```

- [ ] **Step 3: Pass `onEditBaby` to `Sidebar` and render the modal**

In the `Sidebar` JSX (currently lines 96–102 of `App.tsx`), add `onEditBaby={() => setEditingBaby(true)}`:

```tsx
      <Sidebar
        view={view}
        setView={setView}
        theme={theme}
        setTheme={setTheme}
        baby={baby}
        onEditBaby={() => setEditingBaby(true)}
      />
```

Just before the closing `</div>` of `.app` (after the `{editing && <RecordModal ... />}` block, around line 152), add:

```tsx
      {editingBaby && baby && (
        <BabyProfileModal
          baby={baby}
          onClose={() => setEditingBaby(false)}
          onSave={updateBaby}
        />
      )}
```

- [ ] **Step 4: Update `Sidebar.tsx` props and baby card**

In `client/src/components/Sidebar.tsx`, change the `Sidebar` component's props type (lines 22–29) to add `onEditBaby`:

```tsx
}: {
  view: View;
  setView: (v: View) => void;
  theme: "light" | "dark";
  setTheme: (t: "light" | "dark") => void;
  baby: Baby | null;
  onEditBaby: () => void;
}) {
```

Add a utils import at the top of `Sidebar.tsx`:

```tsx
import { formatBabyAge, formatBabyWeight } from "../utils";
```

Replace the existing baby card block (lines 40–48) with:

```tsx
      <button
        type="button"
        className="baby-card baby-card-button"
        onClick={onEditBaby}
        aria-label="Edit baby profile"
      >
        <div className="baby-avatar">{baby?.name?.[0] ?? "C"}</div>
        <div className="baby-card-text">
          <div className="baby-name">{baby?.name ?? "Clement"}</div>
          <div className="baby-age">
            {baby ? `${formatBabyAge(baby.birthdate)} old · ${formatBabyWeight(baby)}` : "—"}
          </div>
        </div>
        <Icon.pencil className="baby-card-edit" />
      </button>
```

- [ ] **Step 5: Verify typecheck**

```bash
npm --workspace client run typecheck
```
Expected: exits 0 with no errors.

- [ ] **Step 6: Build the client**

```bash
npm --workspace client run build
```
Expected: exits 0.

- [ ] **Step 7: Do not commit yet — bundle with styling in next task.**

---

## Task 11: Style the clickable baby card

**Files:**
- Modify: `client/src/styles.css`

- [ ] **Step 1: Inspect existing `.baby-card` styles**

```bash
grep -n "baby-card\|baby-avatar\|baby-name\|baby-age" client/src/styles.css
```
Note the existing rules — the new rules must layer on without breaking layout.

- [ ] **Step 2: Append styling for the button variant**

Append to `client/src/styles.css`:

```css
.baby-card-button {
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  position: relative;
  font: inherit;
  color: inherit;
}

.baby-card-button:hover,
.baby-card-button:focus-visible {
  background: var(--surface-hover, rgba(127, 127, 127, 0.08));
  border-radius: 12px;
  outline: none;
}

.baby-card-text {
  flex: 1;
  min-width: 0;
}

.baby-card-edit {
  opacity: 0;
  transition: opacity 120ms ease;
  color: var(--muted, #94a3b8);
}

.baby-card-button:hover .baby-card-edit,
.baby-card-button:focus-visible .baby-card-edit {
  opacity: 1;
}
```

- [ ] **Step 3: Build the client**

```bash
npm --workspace client run build
```
Expected: exits 0.

- [ ] **Step 4: Manual UI verification**

Run both dev servers:

```bash
npm run dev
```

In the browser:
1. Sidebar baby card shows derived age (e.g. "18 days old · 7.4 lb").
2. Hovering the card shows a pencil icon at the right; cursor becomes pointer.
3. Click → modal opens with current values populated.
4. Change name to "Clem", weight to 8.1, change birthdate, click Save → modal closes; sidebar reflects new values.
5. Hard refresh → values persist (server reads from db).
6. Edge cases: clear the name and click Save → modal stays open with "Name is required". Set birthdate to a future date and click Save → "Birthdate cannot be in the future". Set weight to 0 → "Weight must be a positive number under 1000".

Confirm all six pass before continuing.

- [ ] **Step 5: Commit all client changes together**

```bash
git add client/src/types.ts \
        client/src/utils.ts \
        client/src/api.ts \
        client/src/App.tsx \
        client/src/components/Sidebar.tsx \
        client/src/components/icons.tsx \
        client/src/components/BabyProfileModal.tsx \
        client/src/styles.css
git commit -m "feat(client): editable baby profile modal"
```

---

## Self-Review Notes

- **Spec coverage:** Storage (kv blob): Tasks 2 + 3. Server endpoints + validation: Task 4. Client type: Task 5. Derived age + weight formatting: Task 6. API client: Task 7. Pencil icon: Task 8. Modal: Task 9. Sidebar + App wiring: Task 10. CSS affordance: Task 11. Seed preservation: Task 3 (runs even when `isSeeded()` is true, so existing deployments get the default).
- **Type consistency:** `Baby` shape (`name`, `birthdate`, `weightValue`, `weightUnit`) is identical on server (Task 1) and client (Task 5), and used the same way in Tasks 4, 7, 9, 10.
- **No placeholders.** All steps contain the exact code or command.
- **Commit granularity:** Server changes commit per-task (Tasks 1–4). Client changes commit as one (Task 11) because Task 5 leaves the client uncompilable on its own.
