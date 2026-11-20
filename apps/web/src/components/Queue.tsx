import type { TicketPage, TicketSummary } from '@relay/shared';
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { shortAgo } from '../lib/time';
import { useLive } from '../live/LiveProvider';
import { VIEWS, type QueueView } from '../live/views';
import { Avatars, EmptyState, ErrorState } from './Status';

interface QueueProps {
  view: QueueView;
  onViewChange: (view: QueueView) => void;
  tickets: TicketSummary[];
  query: UseInfiniteQueryResult<InfiniteData<TicketPage>>;
  selectedId: string | null;
  onOpen: (ticketId: string) => void;
}

export function Queue({ view, onViewChange, tickets, query, selectedId, onOpen }: QueueProps) {
  const { syncing } = useLive();
  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <nav className="queue" aria-label="Ticket queue">
      <div className="tabs" role="group" aria-label="Queues">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className="tab"
            aria-pressed={v.id === view}
            aria-keyshortcuts={v.shortcut}
            onClick={() => onViewChange(v.id)}
          >
            {v.label}
            <kbd>{v.shortcut}</kbd>
          </button>
        ))}
      </div>

      <div className={`queue-body ${syncing ? 'is-syncing' : ''}`} aria-busy={syncing}>
        {query.isPending ? (
          <SkeletonRows />
        ) : query.isError && tickets.length === 0 ? (
          <ErrorState
            title="Couldn't load tickets"
            message={query.error.message}
            onRetry={() => void query.refetch()}
          />
        ) : tickets.length === 0 ? (
          <EmptyState title="All clear">
            <p>{current.empty}</p>
          </EmptyState>
        ) : (
          <>
            <ol className="rows" aria-label={`${current.label} tickets`}>
              {tickets.map((ticket) => (
                <li key={ticket.id}>
                  <Row ticket={ticket} selected={ticket.id === selectedId} onOpen={onOpen} />
                </li>
              ))}
            </ol>
            {query.hasNextPage && (
              <button
                type="button"
                className="button button-ghost load-more"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? 'Loading…' : 'Load older tickets'}
              </button>
            )}
            {query.isFetchNextPageError && (
              <p className="inline-error" role="alert">
                Couldn't load older tickets: {query.error?.message}
              </p>
            )}
          </>
        )}
      </div>
    </nav>
  );
}

function Row({
  ticket,
  selected,
  onOpen,
}: {
  ticket: TicketSummary;
  selected: boolean;
  onOpen: (ticketId: string) => void;
}) {
  const { me, presence } = useLive();
  const others = (presence[ticket.id] ?? []).filter((v) => v.agent.id !== me.id);
  const owner =
    ticket.owner === null ? 'Unassigned' : ticket.owner.id === me.id ? 'You' : ticket.owner.name;

  return (
    <button
      type="button"
      className="row"
      data-ticket-id={ticket.id}
      aria-current={selected ? 'true' : undefined}
      aria-label={`#${ticket.number} ${ticket.subject}, from ${ticket.customer.name}, ${
        ticket.status === 'closed'
          ? 'closed'
          : owner === 'Unassigned'
            ? 'unassigned'
            : `owned by ${owner}`
      }`}
      onClick={() => onOpen(ticket.id)}
    >
      <span className="row-line">
        <span className="row-number">#{ticket.number}</span>
        <span className="row-subject">{ticket.subject}</span>
        <time className="row-time" dateTime={ticket.createdAt}>
          {shortAgo(ticket.createdAt)}
        </time>
      </span>
      <span className="row-line row-meta">
        <span className="row-customer">{ticket.customer.name}</span>
        <Avatars viewers={others} />
        <span
          className={`owner ${ticket.owner === null ? 'owner-none' : ''} ${owner === 'You' ? 'owner-me' : ''}`}
        >
          {owner}
        </span>
      </span>
    </button>
  );
}

function SkeletonRows() {
  return (
    <div role="status" aria-label="Loading tickets">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="skeleton-row" aria-hidden="true" />
      ))}
    </div>
  );
}
