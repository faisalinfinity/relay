import type { Agent } from '@relay/shared';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { isPlainKey, isTypingTarget } from '../lib/keys';
import { useLive } from '../live/LiveProvider';
import { useQueue } from '../live/hooks';
import { VIEWS, type QueueView } from '../live/views';
import { Queue } from './Queue';
import { ConnectionBanner, ConnectionPill, EmptyState, Toasts } from './Status';
import { TicketView } from './TicketView';

const focusRow = (ticketId: string | undefined) => {
  if (!ticketId) return;
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-ticket-id="${ticketId}"]`)?.focus();
  });
};

export function Inbox({
  agents,
  onSwitchAgent,
}: {
  agents: Agent[];
  onSwitchAgent: (id: string) => void;
}) {
  const { me } = useLive();
  const [view, setView] = useState<QueueView>('open');
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('ticket'),
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const { query, tickets } = useQueue(view);

  // Keep the open ticket in the URL, so a reload comes back to it
  useEffect(() => {
    const url = new URL(location.href);
    if (selectedId) url.searchParams.set('ticket', selectedId);
    else url.searchParams.delete('ticket');
    history.replaceState(null, '', url);
  }, [selectedId]);

  const move = (step: 1 | -1) => {
    if (tickets.length === 0) return;
    const index = tickets.findIndex((t) => t.id === selectedId);
    const next = index === -1 ? 0 : Math.min(tickets.length - 1, Math.max(0, index + step));
    setSelectedId(tickets[next]!.id);
    focusRow(tickets[next]!.id);
  };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (helpOpen) return; // the dialog handles its own keys
    if (event.key === 'Escape') {
      if (event.target instanceof HTMLElement) event.target.blur();
      focusRow(selectedId ?? tickets[0]?.id);
      return;
    }
    if (isTypingTarget(event.target) || !isPlainKey(event)) return;
    const shortcutView = VIEWS.find((v) => v.shortcut === event.key);
    if (event.key === 'j' || event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'k' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (shortcutView) {
      setView(shortcutView.id);
    } else if (event.key === '?') {
      setHelpOpen(true);
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  return (
    <div className="app">
      <a className="skip-link" href="#ticket-pane">
        Skip to the open ticket
      </a>
      <header className="topbar">
        <p className="brand">
          Relay <span>Slotwise support</span>
        </p>
        <ConnectionPill />
        <label className="agent-switch">
          Working as
          <select value={me.id} onChange={(event) => onSwitchAgent(event.target.value)}>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button button-ghost"
          aria-keyshortcuts="?"
          onClick={() => setHelpOpen(true)}
        >
          Shortcuts <kbd>?</kbd>
        </button>
      </header>
      <ConnectionBanner />

      <div className="layout">
        <Queue
          view={view}
          onViewChange={setView}
          tickets={tickets}
          query={query}
          selectedId={selectedId}
          onOpen={setSelectedId}
        />
        <main id="ticket-pane" className="detail" tabIndex={-1}>
          {selectedId ? (
            <TicketView key={selectedId} ticketId={selectedId} />
          ) : (
            <EmptyState title="No ticket open">
              <p>
                Pick a ticket from the queue, or press <kbd>J</kbd> to open the first one.
              </p>
            </EmptyState>
          )}
        </main>
      </div>

      <Toasts />
      <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ['J / ↓', 'Next ticket'],
  ['K / ↑', 'Previous ticket'],
  ['Enter', 'Open the focused ticket'],
  ['C', 'Claim the open ticket'],
  ['R', 'Write a reply'],
  ['I', 'Insert the suggested reply'],
  ['Ctrl/⌘ + Enter', 'Send the reply'],
  ['Esc', 'Back to the queue'],
  ['1 – 4', 'All open · Unassigned · Mine · Closed'],
  ['?', 'This list'],
];

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="shortcuts-title">
      <h2 id="shortcuts-title">Keyboard shortcuts</h2>
      <dl className="shortcuts">
        {SHORTCUTS.map(([keys, label]) => (
          <div key={keys}>
            <dt>
              <kbd>{keys}</kbd>
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
      <form method="dialog">
        <button type="submit" className="button" autoFocus>
          Close
        </button>
      </form>
    </dialog>
  );
}
