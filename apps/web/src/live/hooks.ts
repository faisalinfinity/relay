import { ClaimConflictDetails, type TicketDetail, type TicketSummary } from '@relay/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';
import { ApiError } from '../api/client';
import { ticketKey, useLive } from './LiveProvider';
import { withMessage } from './store';
import { visibleTickets, type QueueView } from './views';

/** One queue view: pages come from the API, rows are derived live from the ticket store. */
export function useQueue(view: QueueView) {
  const { api, store, me } = useLive();
  const query = useInfiniteQuery({
    queryKey: ['tickets', view],
    queryFn: async ({ pageParam }) => {
      const page = await api.listTickets(view, pageParam);
      store.upsertMany(page.data);
      return page;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const known = useSyncExternalStore(store.subscribe, store.all);

  const tickets = useMemo(() => {
    if (!query.data) return [];
    const numbers = query.data.pages.flatMap((page) => page.data.map((t) => t.number));
    return visibleTickets(known, view, me.id, { numbers, hasMore: query.hasNextPage });
  }, [known, query.data, query.hasNextPage, view, me.id]);

  return { query, tickets };
}

/** The open ticket: its live summary from the store, its thread from the query cache. */
export function useTicket(ticketId: string) {
  const { api, store } = useLive();
  const query = useQuery({
    queryKey: ticketKey(ticketId),
    queryFn: async () => {
      const detail = await api.getTicket(ticketId);
      store.upsert(detail);
      return detail;
    },
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
  const ticket = useSyncExternalStore(store.subscribe, () => store.get(ticketId));
  return { query, ticket, messages: query.data?.messages ?? [] };
}

type Action = 'claim' | 'release' | 'close';

interface ClaimContext {
  optimistic?: TicketSummary;
  before?: TicketSummary;
}

/**
 * Claim, release and close. Claim is optimistic: the ticket shows you as owner at once.
 * On a 409 it rolls back to the real owner named in the error, not to "unassigned".
 */
export function useTicketAction(ticketId: string) {
  const { api, store, me } = useLive();

  return useMutation<TicketSummary, Error, Action, ClaimContext>({
    mutationFn: (action) => api[action](ticketId),
    onMutate: (action) => {
      const before = store.get(ticketId);
      if (action !== 'claim' || !before || before.owner) return {};
      const optimistic: TicketSummary = {
        ...before,
        owner: { id: me.id, name: me.name },
        claimedAt: new Date().toISOString(),
      };
      store.setOptimistic(optimistic);
      return { before, optimistic };
    },
    onSuccess: (ticket) => store.upsert(ticket),
    onError: (error, _action, context) => {
      const { before, optimistic } = context ?? {};
      if (!before || !optimistic) return;
      const conflict =
        error instanceof ApiError && error.code === 'TICKET_ALREADY_CLAIMED'
          ? ClaimConflictDetails.safeParse(error.details)
          : null;
      store.rollback(
        optimistic,
        conflict?.success
          ? { ...before, owner: conflict.data.owner, claimedAt: conflict.data.claimedAt }
          : before,
      );
    },
  });
}

export function useReply(ticketId: string) {
  const { api, store } = useLive();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.reply(ticketId, body),
    onSuccess: ({ ticket, message }) => {
      store.upsert(ticket);
      queryClient.setQueryData<TicketDetail>(ticketKey(ticketId), (detail) =>
        withMessage(detail, message),
      );
    },
  });
}
