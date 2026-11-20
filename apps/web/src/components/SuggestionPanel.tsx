import type { Suggestion } from '@relay/shared';
import { useEffect, useEffectEvent, useId } from 'react';
import { ApiError } from '../api/client';
import { isPlainKey, isTypingTarget } from '../lib/keys';
import { useSuggestion } from '../live/hooks';
import { Spinner } from './Status';

const NO_COVERAGE: Record<Extract<Suggestion, { status: 'no_coverage' }>['reason'], string> = {
  no_relevant_articles:
    'Nothing in the help centre is close enough to this question, so no draft was written.',
  model_declined: "The closest articles are about something similar, but they don't answer this.",
  not_grounded:
    "A draft was written, but it wasn't backed by the articles it was given, so it was discarded.",
};

/**
 * A reply drafted from the help centre, with the articles it came from. Inserting it only fills
 * the reply box: the agent edits it, and nothing reaches the customer until they press Send.
 */
export function SuggestionPanel({
  ticketId,
  canInsert,
  onInsert,
}: {
  ticketId: string;
  /** only the owner can reply, so only the owner can use the draft */
  canInsert: boolean;
  onInsert: (text: string) => void;
}) {
  const { query, regenerate } = useSuggestion(ticketId);
  const headingId = useId();
  const suggestion = query.data;
  const busy = query.isFetching || regenerate.isPending;
  const error = regenerate.error ?? query.error;

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (isTypingTarget(event.target) || !isPlainKey(event)) return;
    if (event.key === 'i' && canInsert && suggestion?.status === 'drafted') {
      event.preventDefault();
      onInsert(suggestion.reply);
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  return (
    <section className="suggestion" aria-labelledby={headingId} aria-busy={busy}>
      <header className="suggestion-header">
        <h3 id={headingId}>Suggested reply</h3>
        {suggestion && (
          <button
            type="button"
            className="button button-ghost"
            onClick={() => regenerate.mutate()}
            disabled={busy}
          >
            {regenerate.isPending ? 'Drafting…' : 'Regenerate'}
          </button>
        )}
      </header>

      {regenerate.isPending || (query.isPending && !error) ? (
        <Spinner label="Reading the help centre and drafting a reply…" />
      ) : error ? (
        <div className="suggestion-error" role="alert">
          <p>
            {error instanceof ApiError && error.code === 'SUGGESTIONS_UNAVAILABLE'
              ? `Suggestions are unavailable: ${error.message}`
              : `Couldn't draft a suggestion: ${error.message}`}
          </p>
          <button
            type="button"
            className="button"
            onClick={() => (regenerate.error ? regenerate.mutate() : void query.refetch())}
          >
            Try again
          </button>
        </div>
      ) : suggestion?.status === 'drafted' ? (
        <>
          <p className="suggestion-text">{suggestion.reply}</p>
          <p className="suggestion-sources">
            From:{' '}
            {suggestion.sources.map((source, i) => (
              <span key={source.slug}>
                {i > 0 && ', '}
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
              </span>
            ))}
          </p>
          <div className="suggestion-actions">
            <button
              type="button"
              className="button button-primary"
              aria-keyshortcuts="i"
              disabled={!canInsert}
              onClick={() => onInsert(suggestion.reply)}
            >
              Insert into reply <kbd>I</kbd>
            </button>
            <span className="hint">
              {canInsert
                ? 'You can edit it before sending. Nothing is sent until you press Send.'
                : 'Claim the ticket to use this draft.'}
            </span>
          </div>
          <Retrieved suggestion={suggestion} />
        </>
      ) : suggestion ? (
        <>
          <p className="suggestion-none">No help article covers this.</p>
          <p className="hint">{NO_COVERAGE[suggestion.reason]}</p>
          <Retrieved suggestion={suggestion} />
        </>
      ) : null}
    </section>
  );
}

/** What the search found and which excerpts the draft was allowed to use. */
function Retrieved({ suggestion }: { suggestion: Suggestion }) {
  if (suggestion.retrieved.length === 0) return null;
  return (
    <details className="retrieved">
      <summary>
        How this was chosen ({suggestion.models.embedding} → {suggestion.models.chat})
      </summary>
      <ol>
        {suggestion.retrieved.map((chunk) => (
          <li key={`${chunk.slug}-${chunk.heading}`}>
            <span className={chunk.used ? 'used' : 'unused'}>
              {chunk.used ? 'used' : 'not used'}
            </span>{' '}
            {chunk.title} — {chunk.heading}{' '}
            <span className="score">{chunk.similarity.toFixed(2)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
