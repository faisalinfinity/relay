# Relay at 200 agents, 50,000 articles, three API instances

```
 200 browsers ── WebSocket /ws + REST ──► load balancer (WebSocket upgrade, no stickiness)
                                          │            │            │
                                        api-1        api-2        api-3     Express + WS hub + relay
                                          └── LISTEN relay_events ──┘
                                                       │
                       Postgres: tickets, ticket_events (log, seq), article_chunks (pgvector)
```

## How live events reach the right browsers

1. A change (claim, reply, close, new ticket) writes a `ticket_events` row **in the same transaction**
   as the change and calls `pg_notify`. The event exists if and only if the change committed.
2. Every instance `LISTEN`s. A notification only means "something new"; each instance reads the log
   from the last `seq` it delivered and pushes those events to **its own** sockets. A missed or
   coalesced notification loses nothing: the next read catches up.
3. "The right browsers" is every agent today, because every agent sees the whole queue. Events carry the
   full ticket and a `version`; browsers keep the highest version, so the order events arrive in doesn't
   matter.
4. Reconnecting works on **any** instance: the browser sends its last `seq` and gets the gap replayed
   from the shared log. So the load balancer needs WebSocket support and an idle timeout above the 15 s
   heartbeat, but no sticky sessions. A rolling deploy drops sockets, and browsers come back with
   jittered backoff and resume.

## What breaks first

| #   | What                         | Why                                                                                                                                                                                                                                                                      | When                                                        |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 1   | **Presence**                 | Who's viewing and typing lives in each instance's memory. With three instances, agents only see the people connected to the same instance.                                                                                                                               | Immediately: a correctness bug, not load.                   |
| 2   | **Drafting**                 | Drafts are made on demand. qwen2.5:3b takes ~4 s on a laptop GPU and much longer on CPU, and Ollama serves a model mostly one request at a time. 200 agents opening tickets build a queue.                                                                               | As soon as a few agents open tickets together.              |
| 3   | **Presence fan-out**         | Every presence change goes to every socket. 30 agents typing (one refresh every 2 s) × 200 sockets ≈ 3,000 messages/s.                                                                                                                                                   | Well before ticket events matter. 10k events/day is ~0.1/s. |
| 4   | **Ingest and vector memory** | 50,000 articles ≈ 250,000 chunks. At the ~36 chunks/s we measured on a laptop GPU, a full embed takes ~2 h, and bootstrap runs ingest at startup, re-chunking every article. The vectors alone are ~770 MB of float32, plus the HNSW graph, and they need to sit in RAM. | The first deploy with the real corpus.                      |
| 5   | **Retrieval quality**        | More near-duplicate articles, and identifiers that embeddings blur (`SW-1042` vs `SW-1043`). At 25 articles, codes in headings rescued us; at 50,000 they won't.                                                                                                         | Grows with the corpus.                                      |
| 6   | **Event write ordering**     | An advisory lock makes `seq` order equal commit order, so event writes are serialised (~1–2 ms each), and NOTIFY also takes a lock at commit.                                                                                                                            | Hundreds of writes/s, far beyond 200 agents.                |

Connections are fine: 3 × (pool of 10 + 1 LISTEN). One gotcha: `LISTEN` needs a direct connection, not
PgBouncer in transaction mode.

## What I would change, in order

1. **Shared presence in Redis**: a key per (ticket, agent) with a short TTL, refreshed by heartbeats,
   plus pub/sub for changes. Expiry handles crashed instances for free. Ticket events stay in Postgres,
   where the log gives replay and ordering.
2. **Send presence only to whoever needs it**: full presence to sockets viewing that ticket, and a
   throttled "who's on what" summary for the queue. Send message bodies only to viewers; the queue only
   needs the ticket summary.
3. **Draft when the ticket arrives**, in a background job (e.g. pg-boss on the same Postgres), so the
   draft is ready before anyone opens it. Use a hosted model or a GPU box. The cache already reuses a
   draft until its inputs change.
4. **Ingest as a job, never at startup**: process only articles whose file hash changed (the hash is
   already stored), in batches, with progress.
5. **Hybrid retrieval**: Postgres full-text or trigram search alongside the vector search, merged with
   reciprocal-rank fusion, plus an exact-match boost for error codes. Store vectors as `halfvec` to halve
   memory. Add filters (product area, locale) as the corpus grows.
6. **Measure before scaling further**: socket count per instance, event lag (commit to delivery), draft
   latency and queue depth, and the hit rate from `pnpm eval` on every retrieval change.

What I'd keep: the Postgres event log as the source of truth, the conditional UPDATE for claims, and
version-wins merging in the browser. None of them depend on how many instances there are.
