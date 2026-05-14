# TODO: Migrate schema validation to Zod (FE + BE)

## Motivation

Validation logic is currently hand-rolled and duplicated between server and client. This was acceptable for the baby profile (single endpoint, ~6 fields) but will not scale. Records, chat payloads, and baby profile all have similar shape constraints that drift independently — a real bug already shipped where the server used UTC comparison while the client used local time.

Goal: a single source of truth for every payload schema, shared between server and client, with runtime validation on the wire and inferred TypeScript types at the boundaries.

## Current state (what to replace)

- **Server hand-rolled validation:** `server/src/index.ts` — `validateBaby`, `isValidIsoDate`. Anything similar that gets added to record / message endpoints.
- **Client hand-rolled validation:** `client/src/components/BabyProfileModal.tsx` — `validate`, `isValidCalendarDate` (duplicates server).
- **Type definitions:** `server/src/types.ts` and `client/src/types.ts` define `Baby`, `RoutineRecord`, `RecordMeta`, `ChatMessage`, `ParseResult` as TS interfaces — no runtime check that an incoming payload actually matches.
- **`as`-casts at I/O boundaries:** every `await c.req.json() as Partial<Baby>` and `(await r.json()) as Baby` is an unchecked claim about untrusted data.

## Proposed approach

1. **Add a shared package.** Either a workspace `shared` package or a `shared/` folder symlinked / re-exported by both sides. Houses Zod schemas + inferred types.
2. **Define one schema per payload.** Start with: `BabySchema`, `RoutineRecordSchema`, `RecordMetaSchema`, `ChatMessageSchema`, request/response envelopes. Mirror the existing TS interfaces.
3. **Replace TS interfaces with `z.infer<typeof Schema>`** so the schema is the source of truth.
4. **Server:** validate every JSON body on entry (Hono middleware that calls `schema.safeParse` and returns 400 on failure). Replace `validateBaby` and `isValidIsoDate`. Use `.refine` for cross-field checks (e.g. birthdate not in the future, calendar-valid date).
5. **Client:** `safeParse` form drafts before allowing Save; map field-level errors to inline UI messages. Replace `validate` in `BabyProfileModal`. Schema runs the same `.refine` rules as the server, eliminating the FE/BE drift class.
6. **Wire formats vs storage formats.** Where the server stores something differently from what it accepts (e.g. trimming `name`), introduce a separate `BabyInputSchema` (accepts untrimmed) and `BabySchema` (canonical stored shape) with `.transform`.

## Concrete migration steps

- [x] Workspace layout: new `@babyone/shared` npm workspace, single `src/index.ts`, `main`/`types` point at the TS source — tsx, vite, tsc (Bundler resolution), and Node 22+ type-stripping all resolve it with no separate build step.
- [x] `zod` added to the shared workspace; server and client depend on it transitively via `@babyone/shared`.
- [x] Port `Baby` — `BabyInputSchema` (wire) + `BabySchema` (canonical with trim). Both server and client compile against `z.infer<typeof BabySchema>`; `Baby` re-exported from each `types.ts`.
- [x] Validation helper `validateBody(c, schema)` returns `{ok, data}` or `{ok: false, response}` with `{ error, details: error.flatten() }` envelope. Applied to `PUT /api/baby`, `POST /api/records`, `PUT /api/records/:id`, `POST /api/chat`. (Helper, not Hono middleware — keeps handler-local typing simple; revisit if more endpoints arrive.)
- [x] Replace `BabyProfileModal`'s `validate` with `BabyInputSchema.safeParse(draft)`.
- [x] Port `RoutineRecord` + `RecordMeta`. `RecordMetaSchema` uses `.passthrough()` to preserve LLM/MCP-injected extra keys (matches the previous `[k: string]: unknown`). Free-form `type` (min length 1) preserved. `at` validated as ISO 8601 datetime. Applied at `POST /api/records` and `PUT /api/records/:id`.
- [x] Port `ChatMessage` + `ChatRequestSchema`. `POST /api/chat` validates `{text: string}` body.
- [x] `ParseResultSchema` defined in shared (so the type is consistent across server/client). Not validated at runtime: it is constructed server-side from records that were already validated at write time (and from tool calls validated by the MCP tool input schemas). Validating it again would catch no real failure.
- [x] Hand-rolled validators deleted: `validateBaby`, `isValidIsoDate`, `isValidCalendarDate`. No record/chat validators existed to remove.

## Resolved decisions

- **Error format:** `{ error: string, details: ZodFlattenedError }` on 400. `error` is the first issue's message for simple consumers; `details` carries the full flatten() output for field-level UI mapping.
- **Bundle size:** client gzipped JS went from ~50 kB to ~67 kB (+17 kB gzipped) for zod. Acceptable. Re-check if it grows further.
- **Dates:** kept as ISO strings (`YYYY-MM-DD` for birthdate, full ISO 8601 for `at`) and validated with regex + `.refine` / `z.string().datetime()`. SQLite JSON blob shape unchanged.

## Out of scope (do NOT bundle into this migration)

- Switching the database layer / ORM.
- Schema versioning / migrations (the SQLite schema itself doesn't change).
- Form-library swap (no react-hook-form etc. unless a clear need emerges).
