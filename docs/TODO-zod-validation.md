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

- [ ] Decide on workspace layout for shared schemas (recommend: new `shared/` workspace, `"shared/*"` glob, both server and client depend on it).
- [ ] Add `zod` to the shared workspace.
- [ ] Port `Baby` first as the smallest, fully-typed case. Verify both server and client compile against `z.infer<typeof BabySchema>`.
- [ ] Add a Hono validation middleware. Apply to `PUT /api/baby` first; confirm 400 responses include a useful error payload (consider `error.flatten()`).
- [ ] Replace `BabyProfileModal`'s `validate` with `BabySchema.safeParse(draft)`.
- [ ] Port `RoutineRecord` + `RecordMeta` (server `POST /api/records`, `PUT /api/records/:id`; client `RecordModal`).
- [ ] Port `ChatMessage` request body (`/api/chat`).
- [ ] Decide if/how to validate LLM-derived `ParseResult` (it's machine-generated; runtime validation actually has high value here).
- [ ] Delete the leftover hand-rolled validators (`validateBaby`, `isValidIsoDate`, `isValidCalendarDate`, etc.).

## Open questions

- Do we want a single error format across endpoints? (Recommend `{ error: string, details?: ZodFlattenedError }`.)
- Where should Zod live for the client's bundle size? Tree-shaking should make it fine; verify the dist size doesn't regress meaningfully.
- For dates: store as ISO date string and let Zod parse with `.refine`, or move to `z.coerce.date()` + ISO serialisation on write? (Probably the former, to keep the SQLite JSON blob shape unchanged.)

## Out of scope (do NOT bundle into this migration)

- Switching the database layer / ORM.
- Schema versioning / migrations (the SQLite schema itself doesn't change).
- Form-library swap (no react-hook-form etc. unless a clear need emerges).
