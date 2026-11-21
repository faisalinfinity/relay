# Relay

A shared support inbox. Tickets come in from a website form, several agents work the queue at the same
time, every ticket has exactly one owner, and each ticket gets a suggested reply drawn from the help
centre articles.

The product being supported is **Slotwise**, an invented booking and scheduling tool for small studios.
Its help centre (25 articles) lives in [`content/articles`](content/articles).

For reviewers: [DESIGN.md](DESIGN.md) covers scaling to 200 agents and 50,000 articles, and
[PROCESS.md](PROCESS.md) covers how it was built.

## Stack

- TypeScript everywhere, pnpm workspaces
- **API** ([`apps/api`](apps/api)): Node 22, Express 5, Drizzle ORM, Zod, pino, `ws` for WebSockets
- **UI** ([`apps/web`](apps/web)): React 19, Vite, TanStack Query, plain CSS (no component library)
- **Shared contracts** ([`packages/shared`](packages/shared)): Zod schemas and types used by both sides
- **Database:** PostgreSQL 17 with pgvector
- **Models:** Ollama with `nomic-embed-text` (embeddings) and `qwen2.5:3b` (drafting); optionally Claude for drafting
- **Tests:** Vitest against a real Postgres

## Run it (one command)

On a clean machine with only Docker:

```bash
docker compose up --build
```

Then open <http://localhost:8080> in two browser windows and pick a different agent in each. The agent is
remembered per tab, so a reload keeps it.

This starts Postgres (with pgvector), Ollama, and the app: the API serving the built UI on one origin.
On every start the app migrates the database, seeds the demo data if the database is empty (4 agents,
30 tickets, 25 help articles), makes sure the models are downloaded, and embeds any articles that
changed. **The first start downloads about 2.3 GB of models** and takes a few minutes; later starts take
seconds.

- **How fast drafts are:** measured on a MacBook Air (Apple silicon), with the models warm. In Docker,
  where Ollama runs on the CPU: 13–35 s per draft. With Ollama installed on the host (GPU), about 4 s;
  to use it, run `DOCKER_OLLAMA_URL=http://host.docker.internal:11434 docker compose up --build`. With
  Claude, a few seconds. Drafts are cached, so reopening a ticket is instant.
- **Drafting with Claude:** put `ANTHROPIC_API_KEY=...` in a `.env` file next to `docker-compose.yml`.
  Compose passes it to the app, and only the embedding model is downloaded.

### Model keys

**None required.** Embeddings and drafting both run locally on Ollama. Optionally, set
`ANTHROPIC_API_KEY` and Claude (`claude-opus-5-5`) drafts the replies instead, with better judgement
about what the articles do and don't answer. Embeddings stay on Ollama either way, because Anthropic has
no embeddings API.

## Develop

You need Node 22, pnpm 9 (`corepack enable` gives you the right version), Docker, and
[Ollama](https://ollama.com) installed on the host.

```bash
docker compose up -d db   # Postgres on localhost:5433
pnpm install
pnpm db:migrate
pnpm db:seed              # 4 agents, 30 tickets, 25 help articles
pnpm models:pull          # nomic-embed-text + qwen2.5:3b into Ollama (~2.3 GB, first time only)
pnpm ingest               # chunk and embed the help articles into pgvector
pnpm dev                  # UI on http://localhost:5173 (hot reload), API on http://localhost:4000
```

No `.env` file is needed for development: every setting has a default. See
[`.env.example`](.env.example) to override them. `pnpm db:seed` resets the tickets and agents.

## Tests

```bash
docker compose up -d db   # the tests need Postgres
pnpm install
pnpm test
```

The tests create and migrate their own `relay_test` database on the same server, so they never touch your
data. API tests run over real HTTP and real WebSockets against Postgres, with fake models, so no Ollama
or key is needed. UI tests cover the logic the live screen depends on (the ticket store, queue
filtering, reconnect behaviour) without a browser. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`
and `pnpm build` run the other checks.

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all of those on every push against a
pgvector Postgres service container, and builds the Docker image.

## Sending a test ticket

Against the Docker setup (the script runs inside the app container, with its webhook secret):

```bash
docker compose exec app pnpm send:ticket                   # a new signed ticket → 201
docker compose exec app pnpm send:ticket --twice           # same submission twice → 201, then 200 duplicate
docker compose exec app pnpm send:ticket --bad-signature   # wrong secret → 401
docker compose exec app pnpm send:ticket --subject "SW-1042 again" --message "Calendar stopped syncing"
```

Against `pnpm dev`, run the same commands without `docker compose exec app`.

The script signs the body with the same `WEBHOOK_SECRET` the API uses. See
[`apps/api/scripts/send-test-ticket.ts`](apps/api/scripts/send-test-ticket.ts).

## The live inbox

### WebSocket, not server-sent events

Both would carry server-to-browser updates. I picked WebSocket because presence needs the browser to talk
back: "I have ticket #1030 open", "I'm typing". With SSE those would be separate POST requests, and the
server would have to tie a POST to a stream to know whose presence ended when a tab closed. With one
socket, the socket _is_ the presence. When it closes (tab closed, network gone, missed ping) that agent's
presence clears. SSE's built-in reconnect with `Last-Event-ID` is nice, but resuming is a few lines either
way (below).

### How a change reaches every browser

1. Every change (new ticket, claim, release, reply, close) writes a row to `ticket_events` **in the same
   transaction** as the change itself, then calls `pg_notify`. The event exists only if the change
   committed. Each event carries a global `seq` and the full ticket after the change.
2. Each API instance `LISTEN`s, reads the new rows in `seq` order and pushes them to its sockets
   ([`realtime/relay.ts`](apps/api/src/realtime/relay.ts),
   [`realtime/hub.ts`](apps/api/src/realtime/hub.ts)). Going through Postgres rather than an in-process
   emitter means this already works with several API instances.
3. The browser keeps one copy of each ticket and always keeps the **higher `version`**
   ([`live/store.ts`](apps/web/src/live/store.ts)). REST responses, live events, replays and optimistic
   updates all go through that rule, so arrival order doesn't matter. A slow REST response can't put back
   an owner that a live event already replaced. Queues are derived from that store, so a new ticket
   appears, a claimed one shows its owner (and leaves _Unassigned_), and a closed one leaves _All open_.

### Reconnecting after the laptop sleeps

- **Noticing.** A sleeping laptop's socket can look open for minutes. The browser runs a 5-second watchdog.
  If a tick arrives much later than scheduled, the machine was asleep. If no heartbeat has come for 40s
  (the server sends one every 15s), the link is dead. Either way it reconnects at once, and it also
  reconnects on the browser's `online` event. Otherwise it retries with jittered exponential backoff. The
  server pings every 15s and drops sockets that don't answer, which clears their presence.
- **Catching up.** The browser remembers the last `seq` it applied and sends it in its `hello`. If every
  event after that is still in the log, the server replays exactly those, in order, then says
  `ready: resumed`. Live events that arrive during the replay are held back and de-duplicated, so nothing
  is lost or shown twice. If the gap can't be replayed (events older than 24h are pruned, or there are
  more than 1,000), the server says `ready: snapshot` and the browser refetches what's on screen.
- **No stale owners.** Until the server says `ready`, a banner says the screen is catching up and owner
  badges are dimmed. A replayed claim carries the new owner and a higher version, so it replaces the old
  one. A snapshot refetch also drops tickets it no longer returns.
- **Event order.** Sequence numbers are handed out at INSERT time, not commit time, so two transactions
  could commit out of `seq` order and a resuming browser could skip one. Event writes take a transaction
  advisory lock, which makes `seq` order equal commit order
  ([`realtime/events.ts`](apps/api/src/realtime/events.ts)).

### Presence and typing

Opening a ticket sends `viewing`. Typing sends `typing: true` at most every 2 seconds and `false` after 3
seconds of quiet. The server clears typing on its own after 6 seconds, in case the "stop" never arrives.
Agents see avatars on queue rows and a line on the ticket ("Ben Okafor is typing a reply…"). An agent with
two tabs open shows once. Presence lives in each API instance's memory; DESIGN.md covers several instances.

### Claim is optimistic

Clicking **Claim** shows you as owner immediately. On a **409** the UI rolls back to the owner the API names
in the error, not to "unassigned", and shows the API's message ("Ben Okafor claimed ticket #1030 just now…").
If the other agent's claim event already arrived, the rollback leaves it alone.

### States and keyboard

Every view has loading, empty and error states (with retry). The connection state is always visible in the
header. Errors from actions show the API's message inline.

| Key                  | Does                               |
| -------------------- | ---------------------------------- |
| `J` / `↓`, `K` / `↑` | Next / previous ticket             |
| `Enter`              | Open the focused ticket            |
| `C`                  | Claim the open ticket              |
| `R`                  | Write a reply                      |
| `Ctrl`/`⌘` + `Enter` | Send the reply                     |
| `Esc`                | Back to the queue                  |
| `1`–`4`              | All open, Unassigned, Mine, Closed |
| `?`                  | Show shortcuts                     |

Everything is also reachable with Tab, with visible focus rings and a skip link.

## Suggested replies

When an agent opens a ticket, the panel under the conversation shows a draft reply and the articles it
came from. **Insert into reply** (or `I`) puts it in the reply box, where the agent can edit it. Nothing
reaches the customer until they press Send. Only the ticket's owner can insert, because only the owner
can reply.

### Pipeline

1. **Ingest** (`pnpm ingest`, [`retrieval/ingest.ts`](apps/api/src/retrieval/ingest.ts)). Each article
   is split into one chunk per `##` section, and each chunk is embedded with its article title and
   heading in front ("Calendar sync troubleshooting / Error SW-1042 / …"). The vectors go into pgvector
   with an HNSW index. A chunk is identified by a hash of exactly what was embedded plus the model name.
   Re-running after editing one section embeds only that chunk; a new embedding model re-embeds
   everything. The 25 articles make 122 chunks, embedded in about 3 seconds.
2. **Embedding step** ([`retrieve`](apps/api/src/retrieval/search.ts)). The ticket's subject and customer
   messages are embedded, and the 6 nearest chunks are fetched by cosine distance. Chunks with similarity
   below the cut-off are dropped.
3. **Generation step** ([`draftReply`](apps/api/src/suggestions/draft.ts)). Up to 4 relevant chunks go
   to the chat model as numbered excerpts. The model must answer in a JSON schema: `answeredBy` (the
   excerpt that answers the main question, or 0), `reply`, and `citations`. The code checks the answer.
   `answeredBy` must name an excerpt the model was actually given, and citations of excerpts it wasn't
   given are dropped. The `[n]` markers are then replaced with links to the cited articles at the end of
   the reply.

The two steps are separate functions with separate tests, and both run on fakes in CI (no model server).
Drafts are cached per ticket until the question, the retrieved chunks or the models change. Regenerate
asks for a new one.

### When no article covers it

The panel says "No help article covers this" in three cases, and shows which:

- **Nothing clears the similarity cut-off.** The chat model is never asked.
- **The model says none of the excerpts answers the question** (`answeredBy: 0`).
- **The model names an excerpt it wasn't given.** The draft is discarded.

Every suggestion also lists the chunks the search found, with their similarity, and whether each was used.

### How I chose the cut-off

I ran [`pnpm eval`](apps/api/scripts/eval.ts) over 12 answerable questions and 6 that no article covers
([`eval/questions.ts`](apps/api/eval/questions.ts)), and looked at the best similarity each one gets:

|                 | lowest | highest |
| --------------- | ------ | ------- |
| answerable (12) | 0.692  | 0.862   |
| not covered (6) | 0.594  | 0.737   |

The ranges overlap. "Can clients pay deposits in Bitcoin?" scores 0.724 against the deposits article: it
**is** about deposits, the article just doesn't answer it. No similarity cut-off can tell "on topic" from
"answered". I also tried measuring how far the best chunk stands out from the average chunk, and that
overlaps too. So the cut-off has one job: drop clearly unrelated tickets without losing any answerable
one. **0.65** is the highest round value below the lowest answerable score (0.692), and it rules out the
HIPAA question outright. Deciding whether an on-topic excerpt actually answers the question is left to
the model, which reads it.

### Evaluation

`pnpm eval` prints a table and the hit rate. `pnpm eval --generate` also drafts a reply for all 18
questions with the configured chat model.

- **Retrieval:** the expected article is in the top 3 for **12/12 (100%)**, first for 10/12, MRR 0.90.
  Both misses are near-misses. "Receptionist access" ranked the refunds article first, because the
  question mentions refunds. "SW-6029" ranked the error-code reference first, because it lists every
  code.
- **End to end with qwen2.5:3b:** **15/18**. All 12 answerable questions get a draft citing the expected
  article. 3 of the 6 uncovered questions correctly get "no article covers this"; Zoom links, gift
  cards and crypto still got drafts.

**The change I made because of the number:** the first end-to-end run scored **9/18**. The 3B model
declined 7 of the 12 answerable questions, even when the excerpt in front of it stated the answer.
It was asked for `answerable: true/false` first, a snap judgement made before reading closely.
Asking it first to name the excerpt that answers the question (`answeredBy`) raised that to 15–16/18.
I also tried making it quote the answering sentence word for word, so code could verify the quote
against the excerpt. The 3B model wrote the excerpt number instead of a quote every time, and scored
6/18. That check is worth having with a stronger model; see PROCESS.md.

With 18 questions, one question is 5–6 points, so treat these as directions rather than precise scores.
I wrote the questions myself, after the articles, so they are easier than real tickets.

## API

There is no login. The acting agent is named by an `X-Agent-Id` header (an agent id from
`GET /api/agents`). Reads work without it; every write needs it.

| Method | Path                          | What it does                                                                                                                       |
| ------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/agents`                 | All agents, for the agent picker                                                                                                   |
| `GET`  | `/api/tickets`                | List tickets, newest first. Query: `status=open\|closed`, `owner=unassigned\|me\|<agentId>`, `limit=1..100` (default 25), `cursor` |
| `GET`  | `/api/tickets/:id`            | One ticket with its owner and messages                                                                                             |
| `POST` | `/api/tickets/:id/claim`      | Become the owner                                                                                                                   |
| `POST` | `/api/tickets/:id/release`    | Owner gives the ticket back to the queue                                                                                           |
| `POST` | `/api/tickets/:id/reply`      | Owner replies. Body: `{ "body": "..." }`                                                                                           |
| `POST` | `/api/tickets/:id/close`      | Owner closes the ticket                                                                                                            |
| `POST` | `/webhooks/tickets`           | Signed intake from the website form                                                                                                |
| `GET`  | `/health`                     | Liveness, including a database round trip                                                                                          |
| `GET`  | `/api/tickets/:id/suggestion` | Suggested reply (`?refresh=true` drafts a new one). 503 if the model server is down                                                |
| `GET`  | `/ws`                         | WebSocket for live events and presence (protocol in [`packages/shared/src/realtime.ts`](packages/shared/src/realtime.ts))          |

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
- Every agent can see every ticket, so live events go to every connected agent.
- Sending a reply stores it on the ticket. Delivering it to the customer by email is out of scope.
- If you re-seed while the app is open, reload the page: a re-seed rewrites the data underneath the
  event log rather than through it.

## Layout

```
apps/api/src
  app.ts              Express app (createApp is shared by the server and the tests)
  tickets/            list / read / claim / release / reply / close
  realtime/           event log, LISTEN/NOTIFY relay, WebSocket hub (live events, catch-up, presence)
  ai/                 Embedder and ChatModel interfaces; Ollama and Claude implementations
  retrieval/          chunking, incremental ingest, nearest-chunk search
  suggestions/        prompt, drafting and its checks, caching, the suggestion endpoint
  webhooks/           signature check and idempotent intake
  articles/sync.ts    loads content/articles into the database, changed files only
  db/                 Drizzle schema and client; SQL migrations in apps/api/drizzle
  http/               error shape, validation, X-Agent-Id
apps/api/seed         seed agents and tickets
apps/api/scripts      migrate, seed, send-test-ticket
apps/api/eval         the 18 evaluation questions (pnpm eval)
apps/api/test         Vitest suites (real HTTP, real WebSockets, real Postgres; fake models)
apps/web/src
  live/               socket (reconnects), ticket store (newest version wins), queue views, hooks
  components/         inbox layout, queue, ticket view, composer, status pieces
apps/web/test         unit tests for the store, queue filtering and reconnect logic
packages/shared       request/response schemas, WebSocket protocol, error codes
content/articles      the Slotwise help centre
docs/decision-log.md  every decision and surprise, as it happened
Dockerfile            one image: the API serving the built UI
```
