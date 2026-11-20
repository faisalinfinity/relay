import type { Message, TicketDetail, TicketSummary } from '@relay/shared';

/**
 * The browser's single copy of every ticket it knows about.
 *
 * REST responses, live events, replayed events and the user's own actions all write here, and
 * the rule is always the same: keep the higher `version`. The server bumps `version` on every
 * change, so whatever order these arrive in, the screen ends up on the newest state. A slow REST
 * response can never put back an owner that a live event already replaced.
 */
export class TicketStore {
  private readonly tickets = new Map<string, TicketSummary>();
  private readonly listeners = new Set<() => void>();
  private allCache: TicketSummary[] | null = null;
  /** ids written since a resync started; null when no resync is running */
  private touched: Set<string> | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get = (id: string): TicketSummary | undefined => this.tickets.get(id);

  /** Same array until something changes, as useSyncExternalStore needs. */
  all = (): TicketSummary[] => (this.allCache ??= [...this.tickets.values()]);

  upsert(ticket: TicketSummary) {
    this.upsertMany([ticket]);
  }

  upsertMany(tickets: TicketSummary[]) {
    let changed = false;
    for (const ticket of tickets) {
      this.touched?.add(ticket.id);
      const current = this.tickets.get(ticket.id);
      if (current && current.version >= ticket.version) continue;
      this.tickets.set(ticket.id, ticket);
      changed = true;
    }
    if (changed) this.emit();
  }

  /**
   * Shows a change before the server confirms it. It keeps the old version number, so the
   * server's answer (one version higher) replaces it either way.
   */
  setOptimistic(ticket: TicketSummary) {
    this.tickets.set(ticket.id, ticket);
    this.emit();
  }

  /** Replaces an optimistic copy, but only if nothing newer has arrived in the meantime. */
  rollback(optimistic: TicketSummary, replacement: TicketSummary) {
    if (this.tickets.get(optimistic.id) !== optimistic) return;
    this.tickets.set(replacement.id, replacement);
    this.emit();
  }

  /**
   * Around a full refetch (after a reconnect that couldn't be replayed): tickets that no
   * refetched query returned and no event mentioned are dropped, because the store has no way
   * to know whether they are still current.
   */
  beginResync() {
    this.touched = new Set();
  }

  endResync({ sweep }: { sweep: boolean }) {
    const touched = this.touched;
    this.touched = null;
    if (!touched || !sweep) return;
    let changed = false;
    for (const id of this.tickets.keys()) {
      if (!touched.has(id)) {
        this.tickets.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  private emit() {
    this.allCache = null;
    for (const listener of this.listeners) listener();
  }
}

/** Adds a message to a cached ticket thread once, in time order. */
export function withMessage(detail: TicketDetail | undefined, message: Message) {
  if (!detail || detail.messages.some((m) => m.id === message.id)) return detail;
  const messages = [...detail.messages, message].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  return { ...detail, messages };
}
