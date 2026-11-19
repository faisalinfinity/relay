# Process notes

Kept as I go. Cleaned up at the end, but the log stays as written.

## How I broke it down

Plan, in the order I'm building it:

1. **Repo and tooling.** pnpm workspace, strict TypeScript, ESLint + Prettier, Postgres (pgvector image)
   in Docker Compose.
2. **API and the claim rule.** Schema, list/read/claim/release/reply/close, one error shape, the signed
   intake webhook, seed data (25 articles, 30 tickets, 6 of them on purpose not covered by any article),
   a test that really races two claims. CI goes in here too rather than at the end, so every push after
   this point is checked.
3. **Live inbox.** React UI, WebSocket events, presence and typing, optimistic claim with rollback,
   catch-up after a reconnect.
4. **Suggested replies.** Ingest articles into pgvector, retrieval with a cut-off, generation with
   citations, a small evaluation.
5. **Write-up.** This file, DESIGN.md, final README.

## Decisions I went back and forth on

_TBD_

## Prompts

_TBD_

## Where the AI was wrong

_TBD_

## Embeddings, chunk size, exact error codes

_TBD_

## Log

### Part 1: API and the claim rule

- **Claim as one conditional UPDATE** (`WHERE owner_id IS NULL`), not read-then-write and not an
  advisory lock. The row lock Postgres already takes for the UPDATE is the mutex. The losing request
  then reads the row to explain _why_ it lost (closed, yours already, or someone else's), and that
  becomes the 409 message.
- **Making the race test actually race.** `Promise.all` over two fetches usually overlaps but proves
  nothing. The test holds the ticket's row lock from another connection, waits until `pg_stat_activity`
  shows every claim blocked on it, then lets them all go at once. To check the test itself, I removed
  `owner_id IS NULL` and confirmed every race test fails.
- **Bug found on the way:** the first version polled `pg_stat_activity` from inside the gate's own
  transaction and timed out. Postgres snapshots `pg_stat_activity` once per transaction, so the poll
  kept seeing the first (empty) answer. Polling moved to a separate autocommit connection.
- **Keyset pagination on ticket number** instead of OFFSET: new tickets land at the top of a live
  queue, and OFFSET would shift every later page. There's a test that inserts a ticket mid-walk.
- **Webhook idempotency key = `submissionId` from the form**, enforced by a unique index, rather than a
  hash of the body. Two genuinely separate submissions with the same text are still two tickets. The
  body hash is kept only to catch the same id arriving with different content (409).
- **Raw body for HMAC.** The webhook router is mounted before `express.json()` and uses `express.raw()`,
  so the signature is checked over the exact bytes received.
- **TypeScript pinned to 6.0.** TS 7 is `latest` on npm, but typescript-eslint supports `<6.1`.

## Time log

| Part  | Time | Notes |
| ----- | ---- | ----- |
| Setup |      |       |
| 1 API |      |       |
