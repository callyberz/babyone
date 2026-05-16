# TanStack Query Migration — Design

## Goal

Replace the hand-rolled server-state management in the client with TanStack
Query (v5). Today all server state lives in `App.tsx` `useState` and is
hydrated by a single `Promise.all` in a `useEffect`; mutations manually patch
local state. This migration delivers:

- Automatic caching and background refetching for records, messages, baby.
- Mutation hooks with cache updates instead of manual `setRecords` patching.
- Standardized loading/error states across queries.

## Scope

Full migration of all client server-state in one pass. Six endpoints, three
queries and three mutations. The `api.ts` fetch layer is unchanged.

## Architecture

### Dependency & provider

- Add `@tanstack/react-query` (v5) to `client/package.json`.
- In `client/src/main.tsx`, create a shared `QueryClient` and wrap `<App>` in
  `<QueryClientProvider>`.

### Query hooks — new file `client/src/queries.ts`

`api.ts` stays as the thin fetch layer. New hooks:

- `useRecords()` — key `['records']`, `queryFn: api.listRecords`. Sorting moves
  into a `select` that applies the existing `sortRecords` logic (newest first).
- `useMessages()` — key `['messages']`, `queryFn: api.listMessages`.
- `useBaby()` — key `['baby']`, `queryFn: api.baby`.

### Mutation hooks — same file

- `useUpdateRecord()` — on success, `setQueryData(['records'], ...)` replacing
  the saved record by id.
- `useDeleteRecord()` — on success, `setQueryData(['records'], ...)` removing
  the record by id.
- `useChat()` — on success: `setQueryData(['messages'], ...)` appending
  `userMsg` and `botMsg`, then `invalidateQueries(['records'])` so the records
  list refetches and reflects the created/updated/deleted diff.

## Component changes

### `App.tsx`

- Remove `records`, `chat`, `baby`, `loadErr` state and the `Promise.all`
  effect.
- Read data from `useRecords()`, `useMessages()`, `useBaby()`.
- Keep `view`, `theme`, `editing` as local UI state (not server state).
- `sortRecords` helper is removed from `App.tsx` (folded into `useRecords`
  `select`).
- `applyChatResult` / `updateRecord` / `deleteRecord` handlers are replaced by
  mutation hooks.
- The "Server offline" topbar message is derived from the queries'
  `isError` / `error` instead of the `loadErr` state.

### `ChatScreen.tsx`

- Currently receives `chat` / `setChat` / `onChatResult` props and optimistically
  appends the user message. It will instead call `useMessages()` and
  `useChat()` directly.
- The optimistic pending user message is handled via the mutation's `onMutate`
  / pending state rather than the prop-drilled `setChat`.

### Other screens

`TodayScreen`, `DashScreen`, `TrendsScreen`, `CalendarScreen` continue to
receive `records` as a prop from `App.tsx`. No internal changes needed beyond
App passing the query's data.

## Loading & error handling

All three queries fire at mount. `App.tsx` shows the existing top-level
"Server offline" banner driven by `isError` / `error` across the queries.
A combined `isLoading` can gate initial render if desired, but the current
behavior (render screens with empty data until loaded) is preserved by
defaulting query data to `[]` / `null`.

## Out of scope

- React Query Devtools (can be added later).
- Optimistic surgical cache updates for the chat diff — explicitly chosen
  invalidate-and-refetch for simplicity.
- Server-side changes.

## Testing

- `npm run typecheck` and `npm run build` in `client` pass.
- Manual smoke test: load app, send a chat message, edit a record, delete a
  record, confirm UI reflects each without a manual refresh.
