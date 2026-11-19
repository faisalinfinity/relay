# Process notes

Kept as I go. Cleaned up at the end, but the log stays as written.

## How I broke it down

Plan, in the order I'm building it:

1. **Repo and tooling.** pnpm workspace, strict TypeScript, ESLint + Prettier, Postgres (pgvector image)
   in Docker Compose.
2. **API and the claim rule.** Schema, list/read/claim/release/reply/close, one error shape, the signed
   intake webhook, seed data, a test that really races two claims. CI goes in here too rather than at
   the end, so every push after this point is checked.
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

## Time log

| Part  | Time | Notes |
| ----- | ---- | ----- |
| Setup |      |       |
