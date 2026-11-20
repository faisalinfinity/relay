import { describe, expect, it } from 'vitest';
import { visibleTickets } from '../src/live/views';
import { ASHA, BEN, ticket } from './fixtures';

const numbers = (list: Array<{ number: number }>) => list.map((t) => t.number);

describe('visibleTickets', () => {
  const unassigned = ticket({ number: 1001 });
  const bens = ticket({ number: 1002, owner: BEN });
  const mine = ticket({ number: 1003, owner: ASHA });
  const closed = ticket({ number: 1004, status: 'closed', owner: BEN });
  const all = [unassigned, bens, mine, closed];
  const everythingLoaded = { numbers: [1001, 1002, 1003, 1004], hasMore: false };

  it('filters each view the same way the API does, newest first', () => {
    const show = (view: Parameters<typeof visibleTickets>[1]) =>
      numbers(visibleTickets(all, view, ASHA.id, everythingLoaded));

    expect(show('open')).toEqual([1003, 1002, 1001]);
    expect(show('unassigned')).toEqual([1001]);
    expect(show('mine')).toEqual([1003]);
    expect(show('closed')).toEqual([1004]);
  });

  it('shows a ticket that just arrived at the top', () => {
    const arrived = ticket({ number: 1050 });
    expect(numbers(visibleTickets([...all, arrived], 'open', ASHA.id, everythingLoaded))[0]).toBe(
      1050,
    );
  });

  it('drops a ticket from Unassigned the moment someone claims it', () => {
    const claimed = { ...unassigned, owner: BEN, version: 2 };
    expect(visibleTickets([claimed], 'unassigned', ASHA.id, everythingLoaded)).toEqual([]);
  });

  it('drops a closed ticket from All open', () => {
    const nowClosed = { ...mine, status: 'closed' as const, version: 2 };
    expect(
      numbers(visibleTickets([unassigned, nowClosed], 'open', ASHA.id, everythingLoaded)),
    ).toEqual([1001]);
  });

  it('does not show tickets below the oldest loaded one while older pages remain', () => {
    const loadedTwo = { numbers: [1004, 1003], hasMore: true };
    expect(numbers(visibleTickets(all, 'open', ASHA.id, loadedTwo))).toEqual([1003]);
  });
});
