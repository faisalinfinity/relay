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

### Part 2: the live inbox

- **WebSocket over SSE**, because presence is browser-to-server and the socket closing _is_ the "they left"
  signal. With SSE, typing would be extra POSTs, and I'd need to tie them back to a stream.
- **Events in the same transaction as the change**, plus `pg_notify`, instead of emitting from the request
  handler. An event exists if and only if the change committed, and LISTEN works across API instances
  without adding Redis.
- **Ordering the log.** A sequence hands out numbers at INSERT time, not commit time. Two transactions can
  commit out of order, and a client resuming "after 11" would miss 10 forever. An advisory lock around the
  event write makes seq order equal commit order. It serialises event writes, which is the trade-off for
  DESIGN.md.
- **Version, not arrival order, decides what the screen shows.** I first thought about patching each
  cached list on every event. I went with one store of tickets where the highest `version` wins, and
  queues derived from it. A slow REST response arriving after a live event can't bring back an old owner.
- **Bug found by mutation testing:** my first "events arrive during catch-up" test passed even with the
  catch-up buffer deleted. The concurrent submissions just happened to finish after the replay. I made it
  deterministic by injecting the replay read, so events are committed right before and right after it.
  The test now fails for each of three ways of breaking the buffer.
- **Second bug, also from a test:** after `resetDb`, the event log is empty and reports head 0, and the
  next event has a high seq, so a reconnect looked like a pruned gap and forced a full refetch. Production
  would hit the same after pruning a quiet log. Pruning now always keeps the newest event.
- **Sleep detection** uses a timer that notices it fired late, plus a server heartbeat. A sleeping
  laptop's socket can look open for minutes otherwise.

## Time log

| Part         | Time | Notes |
| ------------ | ---- | ----- |
| Setup        |      |       |
| 1 API        |      |       |
| 2 Live inbox |      |       |
