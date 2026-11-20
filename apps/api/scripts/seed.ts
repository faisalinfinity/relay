import { sql } from 'drizzle-orm';
import { seedAgents, seedTickets, type AgentKey } from '../seed/data';
import { loadArticleFiles, syncArticles } from '../src/articles/sync';
import { loadConfig } from '../src/config';
import { createDb } from '../src/db/client';
import { agents, messages, tickets } from '../src/db/schema';

const HOUR = 3_600_000;

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);

try {
  const now = Date.now();

  await db.transaction(async (tx) => {
    // Ticket numbers restart at 1001. The event seq keeps counting, so a running API's relay
    // (which remembers the last seq it delivered) carries on delivering new events.
    await tx.execute(sql`truncate table ticket_events, messages, tickets, agents`);
    await tx.execute(sql`alter table tickets alter column number restart with 1001`);

    const agentRows = await tx
      .insert(agents)
      .values(seedAgents.map(({ name, email }) => ({ name, email })))
      .returning();
    const agentIds = new Map<AgentKey, string>(
      seedAgents.map((seed) => [seed.key, agentRows.find((row) => row.email === seed.email)!.id]),
    );

    // Oldest first, so ticket numbers go up with time like they would in real life
    const ordered = [...seedTickets].sort((a, b) => b.hoursAgo - a.hoursAgo);

    for (const [index, seed] of ordered.entries()) {
      const createdAt = new Date(now - seed.hoursAgo * HOUR);
      const thread = [
        { by: 'customer' as const, at: createdAt, body: seed.message },
        ...(seed.followUps ?? []).map((followUp) => ({
          by: followUp.by,
          at: new Date(createdAt.getTime() + followUp.hoursLater * HOUR),
          body: followUp.body,
        })),
      ];
      const lastActivity = thread[thread.length - 1]!.at;
      const ownerId = seed.owner ? agentIds.get(seed.owner)! : null;
      const closedAt = seed.closed ? new Date(lastActivity.getTime() + 0.1 * HOUR) : null;

      const [ticket] = await tx
        .insert(tickets)
        .values({
          subject: seed.subject,
          customerName: seed.name,
          customerEmail: seed.email,
          externalId: `seed-${String(index + 1).padStart(3, '0')}`,
          ownerId,
          claimedAt: ownerId ? new Date(createdAt.getTime() + 0.25 * HOUR) : null,
          status: seed.closed ? 'closed' : 'open',
          closedAt,
          createdAt,
          updatedAt: closedAt ?? lastActivity,
        })
        .returning({ id: tickets.id });

      await tx.insert(messages).values(
        thread.map((message) => ({
          ticketId: ticket!.id,
          authorType: message.by === 'customer' ? ('customer' as const) : ('agent' as const),
          agentId: message.by === 'customer' ? null : agentIds.get(message.by)!,
          body: message.body,
          createdAt: message.at,
        })),
      );
    }
  });

  const report = await syncArticles(db, await loadArticleFiles());

  console.log(`Seeded ${seedAgents.length} agents and ${seedTickets.length} tickets.`);
  console.log(
    `Articles: ${report.added.length} added, ${report.updated.length} updated, ` +
      `${report.removed.length} removed, ${report.unchanged} unchanged.`,
  );
} finally {
  await pool.end();
}
