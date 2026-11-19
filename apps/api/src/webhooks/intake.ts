import { createHash } from 'node:crypto';
import type { IntakeResult, IntakeTicketPayload } from '@relay/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { messages, tickets } from '../db/schema';
import { AppError } from '../http/errors';

const SOURCE = 'web_form';

/**
 * Creates a ticket from a website form submission, at most once per submissionId.
 *
 * The unique index on (source, external_id) does the work: the INSERT ... ON CONFLICT DO NOTHING
 * either creates the row or finds that this submission already exists. Two copies of the same
 * submission arriving at the same moment are safe too, because the second insert waits for the
 * first transaction and then hits the conflict.
 */
export async function ingestSubmission(
  db: Db,
  payload: IntakeTicketPayload,
): Promise<IntakeResult> {
  const intakeHash = hashSubmission(payload);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(tickets)
      .values({
        subject: payload.subject,
        customerName: payload.name,
        customerEmail: payload.email,
        source: SOURCE,
        externalId: payload.submissionId,
        intakeHash,
      })
      .onConflictDoNothing({ target: [tickets.source, tickets.externalId] })
      .returning({ id: tickets.id, number: tickets.number });

    if (created) {
      await tx
        .insert(messages)
        .values({ ticketId: created.id, authorType: 'customer', body: payload.message });
      return { ticketId: created.id, number: created.number, duplicate: false };
    }

    const [existing] = await tx
      .select({ id: tickets.id, number: tickets.number, intakeHash: tickets.intakeHash })
      .from(tickets)
      .where(and(eq(tickets.source, SOURCE), eq(tickets.externalId, payload.submissionId)));
    if (!existing)
      throw new Error(`submission ${payload.submissionId} conflicted but was not found`);

    // Same id but different content is a bug on the sender's side, not a resend. Say so loudly
    // rather than silently dropping a customer's message.
    if (existing.intakeHash !== intakeHash) {
      throw new AppError(
        'SUBMISSION_CONFLICT',
        `Submission ${payload.submissionId} was already received with different content. ` +
          'Use a new submissionId for a new form submission.',
      );
    }
    return { ticketId: existing.id, number: existing.number, duplicate: true };
  });
}

function hashSubmission(payload: IntakeTicketPayload): string {
  const normalized = [payload.name, payload.email.toLowerCase(), payload.subject, payload.message];
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
