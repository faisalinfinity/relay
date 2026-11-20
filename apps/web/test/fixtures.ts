import type { TicketSummary } from '@relay/shared';

let counter = 0;

export const ASHA = { id: '00000000-0000-4000-8000-00000000000a', name: 'Asha Rao' };
export const BEN = { id: '00000000-0000-4000-8000-00000000000b', name: 'Ben Okafor' };

export function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
  counter++;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    number: 1000 + counter,
    subject: `Ticket ${counter}`,
    status: 'open',
    owner: null,
    customer: { name: 'Priya Shah', email: 'priya@example.com' },
    claimedAt: null,
    closedAt: null,
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
    version: 1,
    ...overrides,
  };
}
