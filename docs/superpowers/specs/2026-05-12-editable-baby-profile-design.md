# Editable Baby Profile — Design

Date: 2026-05-12

## Problem

The baby profile (`name`, `age`, `weight`) is hardcoded in `server/src/index.ts`. There is no persistence and no UI affordance to edit it. We want the user to update the baby's name, birthdate, and weight from within the app.

## Goals

- Persist the baby profile in the existing SQLite database.
- Let the user edit name, birthdate, and weight from a modal opened by clicking the sidebar baby card.
- Derive the displayed age from `birthdate` so it stays accurate over time without manual edits.
- Preserve the current displayed values (Clement, ~18 days, 7.4 lb) on first run for existing installs.

## Non-goals

- Multiple babies.
- Weight history / growth trends (a future feature, possibly via the existing records system).
- Photo or avatar upload.
- Automatic value conversion when toggling lb ↔ kg (user re-enters the number in the chosen unit).
- LLM-driven profile updates via chat.

## Data model

The baby profile is a singleton. Reuse the existing `kv` table (already used for the `seeded` flag) and store the profile as a JSON blob under key `baby`.

```ts
// shared shape (server + client)
interface Baby {
  name: string;
  birthdate: string;        // ISO date "YYYY-MM-DD"
  weightValue: number;      // > 0, finite
  weightUnit: "lb" | "kg";
}
```

### Seeding

`seedIfEmpty()` is extended: if no `baby` key exists in `kv`, insert a default of

```json
{ "name": "Clement", "birthdate": "<today minus 18 days, ISO date>", "weightValue": 7.4, "weightUnit": "lb" }
```

The 18-day offset matches the current hardcoded `"18 days"` so existing users see no visible change.

## Server changes

### `server/src/types.ts`
- Add `Baby` interface as defined above.

### `server/src/db.ts`
- Add `getBaby(): Baby` — reads from `kv` where `k='baby'`, parses JSON. Throws if missing (callers should ensure seeding ran).
- Add `setBaby(b: Baby): Baby` — `INSERT OR REPLACE INTO kv (k, v) VALUES ('baby', ?)`.

### `server/src/seed.ts`
- In `seedIfEmpty()` (or alongside it), if `kv` has no `baby` row, insert the default Baby JSON.

### `server/src/index.ts`
- `GET /api/baby` → `c.json(getBaby())` (replace hardcoded literal).
- `PUT /api/baby` → validate body, persist via `setBaby`, return saved Baby.

### Validation (server, `PUT /api/baby`)

Body must satisfy:
- `name`: non-empty string after trim, length ≤ 60.
- `birthdate`: matches `/^\d{4}-\d{2}-\d{2}$/`, parses to a valid date, not in the future (compared against server's `new Date()`).
- `weightValue`: finite number, `> 0`, `< 1000` (sanity bound).
- `weightUnit`: exactly `"lb"` or `"kg"`.

On failure: respond `400` with `{ error: <field>: <message> }`. On success: `200` with the saved Baby.

## Client changes

### `client/src/types.ts`
- Replace existing `Baby` interface with the new shape.

### `client/src/utils.ts`
- Add `formatBabyAge(birthdate: string, now?: Date): string`:
  - Computes whole-day diff between `now` (default `new Date()`) and `birthdate` parsed as a local-midnight date.
  - 0 days → `"newborn"`.
  - 1–29 days → `"<n> day(s)"`.
  - 30–364 days → `"<n> week(s)"` (using `Math.floor(days / 7)`); if weeks ≥ 9 switch to `"<m> month(s)"` (using `Math.floor(days / 30.44)`).
  - ≥ 365 days → `"<y> year(s) <m> month(s)"` (months omitted if 0).
- Add `formatBabyWeight(b: Pick<Baby, 'weightValue' | 'weightUnit'>): string`:
  - Returns `"<value, up to 2 dp> <unit>"`, e.g. `"7.4 lb"`. Trailing zeros after the decimal trimmed.

### `client/src/api.ts`
- Add `updateBaby(b: Baby): Promise<Baby>` → `PUT /api/baby`.

### `client/src/App.tsx`
- Add `updateBaby` handler: call `api.updateBaby`, set `baby` state with result.
- Pass `onEditBaby` (which opens the modal) and `baby` to `Sidebar`.
- Render a new `BabyProfileModal` when an `editingBaby` state flag is true.

### `client/src/components/Sidebar.tsx`
- Wrap the `.baby-card` contents in a `<button>` with class `baby-card baby-card-button` (or similar) that calls `onEditBaby`. Keep mobile-friendly tap target.
- Show derived age via `formatBabyAge(baby.birthdate)` and weight via `formatBabyWeight(baby)`.
- Add a small pencil icon on the right edge of the card (use `Icon.plus` placeholder or add a new `Icon.pencil`).

### `client/src/components/BabyProfileModal.tsx` (new)
- Props: `{ baby: Baby; onClose(): void; onSave(b: Baby): Promise<void> }`.
- Fields:
  - **Name** — text input.
  - **Birthdate** — `<input type="date">`.
  - **Weight** — number input + select for unit (`lb` / `kg`).
- Save button disabled until form is valid (same rules as server-side validation, applied client-side).
- On save: call `onSave`, close on success; show inline error on failure.
- Cancel button closes without saving.
- Styling mirrors `RecordModal` so it picks up existing modal CSS.

### Styling
- Reuse existing modal styles. Add minor CSS for `.baby-card-button` hover/focus affordance (cursor pointer, subtle background change, pencil icon visible on hover/focus). Edit `client/src/styles.css`.

## Error handling

- Network/validation errors from `PUT /api/baby` surface as an inline error string at the bottom of the modal. Modal stays open so the user can correct and retry.
- `GET /api/baby` already has app-level error handling in `App.tsx` (`loadErr` banner) — no change.

## Testing strategy

This codebase has no automated test setup today. Verification will be manual:

1. `npm run build` (server + client) — type-check passes.
2. Start the server with a fresh `BABYONE_DB=/tmp/baby-test.db`, hit `GET /api/baby` → returns the seeded default.
3. From the UI: click the sidebar baby card, edit each field, save → values persist after a hard refresh.
4. Edge cases manually exercised: empty name (rejected), future birthdate (rejected), weight = 0 (rejected), unit toggle round-trips.
5. With an existing populated db (no `baby` key), confirm seeding inserts the default without disturbing records.

## Migration

Existing deployed instances will have no `baby` row in `kv`. The updated `seedIfEmpty()` inserts the default on next server start, so users see the same name/age/weight they saw before. No destructive migration.

## Risk / open questions

- **Birthdate timezone:** `formatBabyAge` treats the stored ISO date as a calendar date in the user's local timezone. Acceptable since babies' ages are coarse.
- **Weight unit independence:** Switching unit without converting the number means the displayed weight changes meaning. Acceptable: form requires the user to enter a number in the chosen unit, and that's the saved value. Documented in non-goals.
