import type { Message, TicketDetail } from '@relay/shared';
import { describe, expect, it, vi } from 'vitest';
import { TicketStore, withMessage } from '../src/live/store';
import { ASHA, BEN, ticket } from './fixtures';

describe('TicketStore', () => {
  it('keeps the newest version, whatever order copies arrive in', () => {
    const store = new TicketStore();
    const v1 = ticket();
    const v2 = { ...v1, owner: BEN, version: 2 };

    store.upsert(v2); // the live event got here first
    store.upsert(v1); // then a slow REST response with the old owner

    expect(store.get(v1.id)).toBe(v2);
  });

  it('notifies subscribers only when something actually changed', () => {
    const store = new TicketStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const t = ticket();

    store.upsert(t);
    store.upsert(t);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('returns the same array from all() until something changes', () => {
    const store = new TicketStore();
    store.upsert(ticket());
    const first = store.all();
    expect(store.all()).toBe(first);
    store.upsert(ticket());
    expect(store.all()).not.toBe(first);
  });

  describe('optimistic claim', () => {
    it('is replaced by the server copy, which is one version higher', () => {
      const store = new TicketStore();
      const before = ticket();
      store.upsert(before);

      store.setOptimistic({ ...before, owner: ASHA });
      store.upsert({ ...before, owner: ASHA, version: 2 });

      expect(store.get(before.id)).toMatchObject({ owner: ASHA, version: 2 });
    });

    it('survives a stale REST copy at the same version', () => {
      const store = new TicketStore();
      const before = ticket();
      store.upsert(before);
      const optimistic = { ...before, owner: ASHA };
      store.setOptimistic(optimistic);

      store.upsert(before); // an old list response comes back mid-claim

      expect(store.get(before.id)).toBe(optimistic);
    });

    it('rolls back to the real owner after losing the race', () => {
      const store = new TicketStore();
      const before = ticket();
      store.upsert(before);
      const optimistic = { ...before, owner: ASHA };
      store.setOptimistic(optimistic);

      store.rollback(optimistic, { ...before, owner: BEN });

      expect(store.get(before.id)?.owner).toEqual(BEN);
    });

    it('does not roll back over something newer that already arrived', () => {
      const store = new TicketStore();
      const before = ticket();
      store.upsert(before);
      const optimistic = { ...before, owner: ASHA };
      store.setOptimistic(optimistic);
      const fromServer = { ...before, owner: BEN, version: 2 };
      store.upsert(fromServer); // Ben's claim event beat our 409

      store.rollback(optimistic, before);

      expect(store.get(before.id)).toBe(fromServer);
    });
  });

  describe('resync', () => {
    it('forgets tickets the refetch did not mention', () => {
      const store = new TicketStore();
      const kept = ticket();
      const gone = ticket();
      store.upsertMany([kept, gone]);

      store.beginResync();
      store.upsert(kept); // returned by the refetch, even at the same version
      store.endResync({ sweep: true });

      expect(store.get(kept.id)).toBe(kept);
      expect(store.get(gone.id)).toBeUndefined();
    });

    it('keeps everything when the refetch failed', () => {
      const store = new TicketStore();
      const t = ticket();
      store.upsert(t);

      store.beginResync();
      store.endResync({ sweep: false });

      expect(store.get(t.id)).toBe(t);
    });
  });
});

describe('withMessage', () => {
  const message = (id: string, createdAt: string): Message => ({
    id,
    ticketId: 't',
    authorType: 'agent',
    agent: ASHA,
    body: 'Hi',
    createdAt,
  });
  const detail: TicketDetail = { ...ticket(), messages: [message('a', '2026-11-20T10:00:00Z')] };

  it('adds a message once, in time order', () => {
    const late = message('c', '2026-11-20T12:00:00Z');
    const early = message('b', '2026-11-20T11:00:00Z');
    const once = withMessage(withMessage(detail, late), early)!;
    const twice = withMessage(once, late)!;

    expect(twice.messages.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(twice).toBe(once);
  });

  it('leaves an uncached thread alone', () => {
    expect(withMessage(undefined, message('x', '2026-11-20T10:00:00Z'))).toBeUndefined();
  });
});
