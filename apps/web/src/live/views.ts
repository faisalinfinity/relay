import type { TicketSummary } from '@relay/shared';

export type QueueView = 'open' | 'unassigned' | 'mine' | 'closed';

export const VIEWS: Array<{ id: QueueView; label: string; shortcut: string; empty: string }> = [
  {
    id: 'open',
    label: 'All open',
    shortcut: '1',
    empty: 'No open tickets. New ones will appear here as they arrive.',
  },
  { id: 'unassigned', label: 'Unassigned', shortcut: '2', empty: 'Nothing waiting for an owner.' },
  {
    id: 'mine',
    label: 'Mine',
    shortcut: '3',
    empty: "You don't own any open tickets. Claim one from the queue.",
  },
  { id: 'closed', label: 'Closed', shortcut: '4', empty: 'No closed tickets yet.' },
];

/** The API filter behind each view */
export const VIEW_QUERY: Record<QueueView, Record<string, string>> = {
  open: { status: 'open' },
  unassigned: { status: 'open', owner: 'unassigned' },
  mine: { status: 'open', owner: 'me' },
  closed: { status: 'closed' },
};

/** The same filter, applied in the browser to tickets that changed live. */
export function matchesView(view: QueueView, ticket: TicketSummary, meId: string): boolean {
  switch (view) {
    case 'open':
      return ticket.status === 'open';
    case 'unassigned':
      return ticket.status === 'open' && ticket.owner === null;
    case 'mine':
      return ticket.status === 'open' && ticket.owner?.id === meId;
    case 'closed':
      return ticket.status === 'closed';
  }
}

/**
 * What a queue shows: every known ticket that matches the view, newest first, down to the
 * oldest ticket this view has loaded so far (or everything, once there are no more pages).
 *
 * Deriving the list from the shared ticket store, instead of from the pages the server sent,
 * is what makes live updates fall into place: a new ticket matches and appears, a claimed one
 * stops matching "Unassigned" and disappears, a closed one leaves "All open".
 */
export function visibleTickets(
  known: readonly TicketSummary[],
  view: QueueView,
  meId: string,
  loaded: { numbers: number[]; hasMore: boolean },
): TicketSummary[] {
  const oldestLoaded = loaded.hasMore ? Math.min(...loaded.numbers) : -Infinity;
  return known
    .filter((ticket) => matchesView(view, ticket, meId) && ticket.number >= oldestLoaded)
    .sort((a, b) => b.number - a.number);
}
