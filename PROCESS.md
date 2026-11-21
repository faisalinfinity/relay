# Process notes

The full working log, one entry per decision or surprise, is in
[docs/decision-log.md](docs/decision-log.md). This page is the summary.

## How I broke it down

In the order I built it, one branch per part:

1. **Repo and tooling.** pnpm workspace, strict TypeScript, lint, Postgres with pgvector in Docker.
2. **API and the claim rule.** I built this first because everything else depends on ticket ownership
   being right. CI went in here rather than at the end, so every later push was checked.
3. **Live inbox.** The event log and WebSocket hub first, then the React UI on top of them.
4. **Suggested replies.** Ingest, retrieval and drafting as separate functions, then the evaluation,
   then the panel.
5. **Write-up and one-command setup.**

## Decisions I went back and forth on

- **How to enforce one owner.** I chose one conditional `UPDATE … WHERE owner_id IS NULL` over
  read-then-write or an advisory lock. The database's row lock is the mutex, and the rule holds across
  any number of API instances.
- **WebSocket or SSE.** I went with WebSocket because presence needs the browser to talk back, and a
  closed socket is itself the "they left" signal.
- **How the browser merges updates.** I started by patching each cached list on every event. I switched
  to one store where the highest ticket `version` wins and queues are derived from it. A slow response
  can no longer bring back an old owner.
- **One similarity cut-off, or two gates.** I expected one threshold to separate answerable questions
  from the rest. The evaluation showed the ranges overlap, so the cut-off only removes clearly unrelated
  tickets, and the model judges whether the excerpts actually answer.
- **Local model or Claude.** Local keeps the answer to "which keys do we need" at none. Claude is
  optional, behind the same interface.

## Three prompts I used

_To fill in: three prompts copied exactly as written, each with one line on why._

## Where the AI was wrong

While building the live inbox, the AI wrote a test meant to show that events committed _while_ a
reconnecting browser is catching up are neither lost nor duplicated. It passed, and it still passed
when the code it was meant to protect was deleted. The "concurrent" events always finished after the
replay, so the test never exercised the window it claimed to. That check (break the code, see whether
the test notices) is how it was caught. The fix made the test deterministic by injecting the replay
read, so it commits events just before and just after it. It now fails for each of three ways of
breaking that code. The claim-race test got the same check: remove `owner_id IS NULL` and every race
test fails.

## In my own words

**What an embedding model does that a chat model does not:** _to write._

**Why I chose this chunk size:** _to write._

**Why vector search alone would miss a ticket that quotes an exact error code:** _to write._

## Time and what I skipped

| Part                         | Time |
| ---------------------------- | ---- |
| Setup                        |      |
| 1 API and the claim rule     |      |
| 2 Live inbox                 |      |
| 3 Suggested replies          |      |
| 4 Pipeline, Docker, write-up |      |

Skipped, roughly in the order I'd pick them up:

- Shared presence across API instances (Redis), and drafting in a background job when a ticket arrives
  (see DESIGN.md).
- Keyword search alongside vectors for exact error codes.
- Browser tests in CI. The two-agent flows were checked with Playwright scripts kept outside the repo.
- Real login, sending replies by email, reopening closed tickets, rate limiting on the webhook.
- A compiled production build; the container runs the TypeScript with `tsx`.
