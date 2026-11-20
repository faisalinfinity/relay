import type { Agent, ServerMessage, TicketDetail, TicketEvent, Viewer } from '@relay/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createApi, type Api } from '../api/client';
import { LiveSocket, type LinkState } from './socket';
import { TicketStore, withMessage } from './store';

export interface Announcement {
  id: number;
  text: string;
}

interface LiveContextValue {
  me: Agent;
  api: Api;
  store: TicketStore;
  link: LinkState;
  /** true until the screen is known to be current: on first load and after every reconnect */
  syncing: boolean;
  presence: Record<string, Viewer[]>;
  announcements: Announcement[];
  setViewing: (ticketId: string | null) => void;
  setTyping: (ticketId: string, typing: boolean) => void;
}

const LiveContext = createContext<LiveContextValue | null>(null);

export function useLive(): LiveContextValue {
  const value = useContext(LiveContext);
  if (!value) throw new Error('useLive() needs a <LiveProvider>');
  return value;
}

export const ticketKey = (id: string) => ['ticket', id] as const;

/**
 * Owns the live connection for one agent and feeds everything it hears into the ticket store
 * and the query cache. Mounted with key={agent.id}, so switching agent starts from scratch.
 */
export function LiveProvider({
  me,
  onRejected,
  children,
}: {
  me: Agent;
  onRejected: () => void;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [store] = useState(() => new TicketStore());
  const api = useMemo(() => createApi(me.id), [me.id]);
  const [link, setLink] = useState<LinkState>('connecting');
  const [syncing, setSyncing] = useState(true);
  const [presence, setPresence] = useState<Record<string, Viewer[]>>({});
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const socketRef = useRef<LiveSocket | null>(null);
  const handleRejected = useEffectEvent(onRejected);

  useEffect(() => {
    let lastSeq: number | null = null;
    let nextAnnouncement = 0;

    const announce = (text: string) => {
      const id = ++nextAnnouncement;
      setAnnouncements((list) => [...list.slice(-2), { id, text }]);
      setTimeout(() => setAnnouncements((list) => list.filter((a) => a.id !== id)), 6_000);
    };

    const applyEvent = (event: TicketEvent) => {
      store.upsert(event.ticket);
      if (event.message) {
        const message = event.message;
        queryClient.setQueryData<TicketDetail>(ticketKey(event.ticket.id), (detail) =>
          withMessage(detail, message),
        );
      }
      lastSeq = Math.max(lastSeq ?? 0, event.seq);
      if (event.actor?.id !== me.id) announce(describe(event));
    };

    /** The server couldn't replay what we missed: refetch everything on screen. */
    const resync = async () => {
      setSyncing(true);
      store.beginResync();
      await queryClient.invalidateQueries(); // resolves once every query on screen has refetched
      const failed = queryClient
        .getQueryCache()
        .findAll({ type: 'active' })
        .some((q) => q.state.status === 'error');
      store.endResync({ sweep: !failed }); // after a failed refetch, stale beats empty
      setSyncing(false);
    };

    const onMessage = (message: ServerMessage) => {
      switch (message.type) {
        case 'event':
          applyEvent(message.event);
          break;
        case 'ready':
          if (message.mode === 'resumed') {
            lastSeq = Math.max(lastSeq ?? 0, message.seq);
            setSyncing(false);
          } else {
            lastSeq = message.seq;
            void resync();
          }
          break;
        case 'presence':
          setPresence((current) => ({ ...current, [message.ticketId]: message.viewers }));
          break;
        case 'presence.snapshot':
          setPresence(message.tickets);
          break;
        case 'heartbeat':
        case 'error':
          break;
      }
    };

    const socket = new LiveSocket({
      url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
      agentId: me.id,
      lastSeq: () => lastSeq,
      onMessage,
      onState: (state) => {
        setLink(state);
        if (state === 'rejected') handleRejected();
        if (state !== 'live') {
          setSyncing(true);
          setPresence({}); // we can't know who is where while disconnected
        }
      },
    });
    socketRef.current = socket;
    socket.start();
    return () => {
      socket.stop();
      socketRef.current = null;
    };
  }, [me.id, queryClient, store]);

  // Stable identities: components use these in effect dependencies
  const setViewing = useCallback((ticketId: string | null) => {
    socketRef.current?.setViewing(ticketId);
  }, []);
  const setTyping = useCallback((ticketId: string, typing: boolean) => {
    socketRef.current?.setTyping(ticketId, typing);
  }, []);

  const value = useMemo<LiveContextValue>(
    () => ({ me, api, store, link, syncing, presence, announcements, setViewing, setTyping }),
    [me, api, store, link, syncing, presence, announcements, setViewing, setTyping],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

function describe(event: TicketEvent): string {
  const ref = `#${event.ticket.number}`;
  const who = event.actor?.name ?? 'Someone';
  switch (event.kind) {
    case 'ticket.created':
      return `New ticket ${ref}: ${event.ticket.subject}`;
    case 'ticket.claimed':
      return `${who} claimed ${ref}`;
    case 'ticket.released':
      return `${who} released ${ref}`;
    case 'ticket.replied':
      return `${who} replied to ${ref}`;
    case 'ticket.closed':
      return `${who} closed ${ref}`;
  }
}
