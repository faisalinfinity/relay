# Relay

A shared support inbox. Tickets come in from a website form, several agents work the queue at the same
time, every ticket has exactly one owner, and each ticket gets a suggested reply drawn from the help
centre articles.

The product being supported is **Slotwise**, an invented booking and scheduling tool for small studios.
Its help centre (25 articles) lives in [`content/articles`](content/articles).

> **Status:** the API, claim rule, intake webhook, seed data, tests and CI are done. The live React inbox,
> suggested replies and the one-command Docker setup are next.

## Stack

- TypeScript everywhere, pnpm workspaces
- **API** ([`apps/api`](apps/api)): Node 22, Express 5, Drizzle ORM, Zod, pino
- **Shared contracts** ([`packages/shared`](packages/shared)): Zod schemas and types used by the API and, later, the UI
- **Database:** PostgreSQL 17 with pgvector, via Docker Compose
- **Tests:** Vitest against a real Postgres

## Running it

You need Node 22, pnpm 9 (`corepack enable` gives you the right version) and Docker.

```bash
docker compose up -d db   # Postgres on localhost:5433
pnpm install
pnpm db:migrate
pnpm db:seed              # 4 agents, 30 tickets, 25 help articles
pnpm dev                  # API on http://localhost:4000
```

No `.env` file is needed for local development: every setting has a development default. See
[`.env.example`](.env.example) to override them. Running `pnpm db:seed` again resets the tickets and agents.

**Model keys:** none needed yet.

## Tests

```bash
docker compose up -d db
pnpm test
```

The tests create and migrate their own `relay_test` database on the same server, so they never touch your
dev data. `pnpm typecheck`, `pnpm lint` and `pnpm format:check` run the other CI steps.

The CI pipeline is [`.github/workflows/ci.yml`](.github/workflows/ci.yml). It runs the same commands on
every push, against a pgvector Postgres service container.

## Sending a test ticket

With the API running:

```bash
pnpm send:ticket                   # a new signed ticket → 201
pnpm send:ticket --twice           # same submission sent twice → 201, then 200 with duplicate: true
pnpm send:ticket --bad-signature   # wrong secret → 401
pnpm send:ticket --subject "SW-1042 again" --message "Calendar stopped syncing"
```

The script signs the body with the same `WEBHOOK_SECRET` the API uses. See
[`apps/api/scripts/send-test-ticket.ts`](apps/api/scripts/send-test-ticket.ts).

## API

There is no login. The acting agent is named by an `X-Agent-Id` header (an agent id from
`GET /api/agents`). Reads work without it; every write needs it.

| Method | Path                       | What it does                                                                                                                       |
| ------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/agents`              | All agents, for the agent picker                                                                                                   |
| `GET`  | `/api/tickets`             | List tickets, newest first. Query: `status=open\|closed`, `owner=unassigned\|me\|<agentId>`, `limit=1..100` (default 25), `cursor` |
| `GET`  | `/api/tickets/:id`         | One ticket with its owner and messages                                                                                             |
| `POST` | `/api/tickets/:id/claim`   | Become the owner                                                                                                                   |
| `POST` | `/api/tickets/:id/release` | Owner gives the ticket back to the queue                                                                                           |
| `POST` | `/api/tickets/:id/reply`   | Owner replies. Body: `{ "body": "..." }`                                                                                           |
| `POST` | `/api/tickets/:id/close`   | Owner closes the ticket                                                                                                            |
| `POST` | `/webhooks/tickets`        | Signed intake from the website form                                                                                                |
| `GET`  | `/health`                  | Liveness, including a database round trip                                                                                          |

Lists return `{ "data": [...], "nextCursor": "1017" | null }`. Pass `nextCursor` back as `cursor` for the
next page. Pagination is keyset on the ticket number rather than OFFSET, so tickets arriving while you page
don't shift or repeat rows.

### One error shape

Every error, from validation to a crash, looks like this:

```json
{
  "error": {
    "code": "TICKET_ALREADY_CLAIMED",
    "message": "Ben Okafor claimed ticket #1030 just now. Pick another ticket, or ask Ben to release it.",
    "details": { "ticketId": "…", "owner": { "id": "…", "name": "Ben Okafor" }, "claimedAt": "…" },
    "requestId": "294f8e2c-…"
  }
}
```

`code` maps to exactly one HTTP status ([`packages/shared/src/errors.ts`](packages/shared/src/errors.ts)).
Validation errors put one `{ path, message }` per bad field in `details`. `requestId` matches the
`X-Request-Id` response header and the API log line.

### The claim rule

A ticket has one owner. Claiming is a single conditional update
([`claimTicket`](apps/api/src/tickets/service.ts)):

```sql
UPDATE tickets SET owner_id = $agent, claimed_at = now(), version = version + 1
WHERE id = $id AND status = 'open' AND owner_id IS NULL
RETURNING *
```

When two claims arrive together, Postgres row-locks the ticket for the first UPDATE. The second waits on
that lock, then re-checks its `WHERE` against the committed row, finds `owner_id` set, and updates nothing.
That claim gets a **409 `TICKET_ALREADY_CLAIMED`** naming the winner, so the losing UI can show the real owner
straight away. The rule lives in the database, so it holds with any number of API instances.

[`claim-race.test.ts`](apps/api/test/claim-race.test.ts) proves it with real concurrency. The test holds the
ticket's row lock from a separate connection and fires the claims over HTTP. It waits until Postgres reports
every claim blocked inside its UPDATE, then releases them together: 2 agents, then 20. A same-agent double
click returns 200 both times. Removing `owner_id IS NULL` from the query makes all of these tests fail.

Replies, releases and closes are owner-only. A reply locks the ticket row (`SELECT … FOR UPDATE`) for the
length of its transaction, so the owner can't change between the check and the insert.

### Intake webhook

`POST /webhooks/tickets` takes:

```json
{ "submissionId": "…", "name": "…", "email": "…", "subject": "…", "message": "…" }
```

- **Signature:** `X-Relay-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.
  The HMAC is checked over the raw request bytes, before any JSON parsing, using a constant-time compare.
  Timestamps more than 5 minutes from server time are rejected, so a captured request can't be replayed later.
- **Resends create one ticket:** `submissionId` is the idempotency key, enforced by a unique index on
  `(source, external_id)` and `INSERT … ON CONFLICT DO NOTHING`. The first delivery returns **201**. A resend
  returns **200** with the same ticket and `duplicate: true`, even when several copies arrive at once.
  Reusing a `submissionId` with different content returns **409 `SUBMISSION_CONFLICT`**, so a sender bug
  can't silently drop a customer's message.

## Assumptions

- The website's form backend generates `submissionId` once per form submission and reuses it on retries.
- Only the owner can reply to, release or close a ticket. To act on someone else's ticket, ask them to
  release it.
- Ticket status is `open` or `closed`. "Claimed" is not a status; it is an open ticket with an owner.
  Closed tickets keep their owner, which records who closed them.
- A double click on claim by the current owner is a success, not a conflict.

## Layout

```
apps/api/src
  app.ts              Express app (createApp is shared by the server and the tests)
  tickets/            list / read / claim / release / reply / close
  webhooks/           signature check and idempotent intake
  articles/sync.ts    loads content/articles into the database, changed files only
  db/                 Drizzle schema and client; SQL migrations in apps/api/drizzle
  http/               error shape, validation, X-Agent-Id
apps/api/seed         seed agents and tickets
apps/api/scripts      migrate, seed, send-test-ticket
apps/api/test         Vitest suites (real HTTP, real Postgres)
packages/shared       request/response schemas and error codes
content/articles      the Slotwise help centre
```
