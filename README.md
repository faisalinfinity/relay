# Relay

A shared support inbox. Tickets come in from a website form, several agents work the queue at the same
time, every ticket has exactly one owner, and each ticket gets a suggested reply drawn from the help
centre articles.

The product being supported is **Slotwise**, an invented booking and scheduling tool for small studios.
Its help centre lives in `content/articles`.

## Stack

- TypeScript everywhere, pnpm workspaces
- API: Node 22 + Express 5, Drizzle ORM, Zod
- Database: PostgreSQL 17 with pgvector, via Docker Compose
- UI: React (coming in a later step)

## Status

Work in progress. Setup instructions will be filled in as the pieces land.

```bash
docker compose up -d db
pnpm install
```
