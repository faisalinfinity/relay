import { useEffect, useEffectEvent, useRef } from 'react';
import { ApiError } from '../api/client';
import { isPlainKey, isTypingTarget } from '../lib/keys';
import { fullDate } from '../lib/time';
import { useLive } from '../live/LiveProvider';
import { useTicket, useTicketAction } from '../live/hooks';
import { Composer } from './Composer';
import { Avatars, ErrorState, Spinner } from './Status';

export function TicketView({ ticketId }: { ticketId: string }) {
  const { me, presence, setViewing } = useLive();
  const { query, ticket, messages } = useTicket(ticketId);
  const action = useTicketAction(ticketId);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Tell the other agents this ticket is open here. Leaving it (or closing the tab) clears it.
  useEffect(() => {
    setViewing(ticketId);
    return () => setViewing(null);
  }, [ticketId, setViewing]);

  const canClaim = ticket?.status === 'open' && ticket.owner === null;
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (isTypingTarget(event.target) || !isPlainKey(event)) return;
    if (event.key === 'c' && canClaim && !action.isPending) action.mutate('claim');
    if (event.key === 'r' && composerRef.current) {
      event.preventDefault(); // don't type the "r" into the box
      composerRef.current.focus();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  if (!ticket) {
    if (query.isError) {
      const gone = query.error instanceof ApiError && query.error.status === 404;
      return (
        <ErrorState
          title={gone ? 'Ticket not found' : "Couldn't load this ticket"}
          message={gone ? 'It may have been removed.' : query.error.message}
          onRetry={gone ? undefined : () => void query.refetch()}
        />
      );
    }
    return <Spinner label="Loading ticket…" />;
  }

  const mine = ticket.owner?.id === me.id;
  const claiming = action.isPending && action.variables === 'claim';
  const others = (presence[ticketId] ?? []).filter((v) => v.agent.id !== me.id);

  return (
    <article className="ticket" aria-labelledby={`ticket-${ticket.id}`}>
      <header className="ticket-header">
        <p className="ticket-number">
          #{ticket.number} · {ticket.status === 'open' ? 'Open' : 'Closed'}
        </p>
        <h2 id={`ticket-${ticket.id}`}>{ticket.subject}</h2>
        <p className="ticket-customer">
          {ticket.customer.name} &lt;{ticket.customer.email}&gt;
        </p>

        <div className="ownership">
          {ticket.status === 'closed' ? (
            <span>
              Closed {ticket.closedAt ? fullDate(ticket.closedAt) : ''}
              {ticket.owner ? ` by ${ticket.owner.id === me.id ? 'you' : ticket.owner.name}` : ''}
            </span>
          ) : ticket.owner === null ? (
            <>
              <span className="owner owner-none">Unassigned</span>
              <button
                type="button"
                className="button button-primary"
                aria-keyshortcuts="c"
                onClick={() => action.mutate('claim')}
                disabled={action.isPending}
              >
                Claim <kbd>C</kbd>
              </button>
            </>
          ) : mine ? (
            <>
              <span className="owner owner-me">{claiming ? 'Claiming…' : 'Yours'}</span>
              <button
                type="button"
                className="button"
                onClick={() => action.mutate('release')}
                disabled={action.isPending}
              >
                {action.isPending && action.variables === 'release' ? 'Releasing…' : 'Release'}
              </button>
              <button
                type="button"
                className="button"
                onClick={() => action.mutate('close')}
                disabled={action.isPending}
              >
                {action.isPending && action.variables === 'close' ? 'Closing…' : 'Close ticket'}
              </button>
            </>
          ) : (
            <span className="owner">Owned by {ticket.owner.name}</span>
          )}
        </div>

        {action.error && (
          <p className="inline-error" role="alert">
            {action.error.message}
          </p>
        )}

        {others.length > 0 && (
          <p className="presence">
            <Avatars viewers={others} />
            {others
              .map((v) => `${v.agent.name} ${v.typing ? 'is typing a reply…' : 'has this open'}`)
              .join(' · ')}
          </p>
        )}
      </header>

      <section className="thread" aria-label="Conversation">
        {query.isPending ? (
          <Spinner label="Loading conversation…" />
        ) : query.isError ? (
          <ErrorState
            title="Couldn't load the conversation"
            message={query.error.message}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <ol className="messages">
            {messages.map((message) => (
              <li key={message.id} className={`message message-${message.authorType}`}>
                <p className="message-meta">
                  <strong>
                    {message.authorType === 'customer'
                      ? ticket.customer.name
                      : (message.agent?.name ?? 'Agent')}
                  </strong>
                  <time dateTime={message.createdAt}>{fullDate(message.createdAt)}</time>
                </p>
                <p className="message-body">{message.body}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {ticket.status === 'closed' ? (
        <p className="composer-note">This ticket is closed.</p>
      ) : mine && !claiming ? (
        <Composer ticketId={ticket.id} customerName={ticket.customer.name} ref={composerRef} />
      ) : (
        <p className="composer-note">
          {ticket.owner === null || claiming
            ? 'Claim this ticket to reply, so nobody else answers it at the same time.'
            : `${ticket.owner.name} is handling this ticket.`}
        </p>
      )}
    </article>
  );
}
