import type { Viewer } from '@relay/shared';
import type { ReactNode } from 'react';
import { initials } from '../lib/keys';
import { useLive } from '../live/LiveProvider';

export function Spinner({ label }: { label: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-dot" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state state-error" role="alert">
      <p className="state-title">{title}</p>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <p className="state-title">{title}</p>
      {children}
    </div>
  );
}

const LINK_LABELS = {
  connecting: 'Connecting',
  'catching-up': 'Catching up',
  live: 'Live',
  offline: 'Reconnecting',
  rejected: 'Signed out',
} as const;

/** The small dot in the header. */
export function ConnectionPill() {
  const { link, syncing } = useLive();
  const label = link === 'live' && syncing ? 'Catching up' : LINK_LABELS[link];
  return (
    <span className={`pill pill-${link === 'live' && !syncing ? 'live' : 'waiting'}`}>
      <span className="pill-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Says out loud when what's on screen may be out of date. */
export function ConnectionBanner() {
  const { link, syncing } = useLive();
  if (link === 'live' && !syncing) return null;
  const text =
    link === 'offline'
      ? 'Connection lost. Reconnecting… Owners on screen may be out of date until we are back.'
      : 'Catching up on changes…';
  return (
    <div className={`banner ${link === 'offline' ? 'banner-warn' : ''}`} role="status">
      {text}
    </div>
  );
}

/** Live activity from other agents, shown briefly and read out by screen readers. */
export function Toasts() {
  const { announcements } = useLive();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {announcements.map((a) => (
        <div key={a.id} className="toast">
          {a.text}
        </div>
      ))}
    </div>
  );
}

export function Avatars({ viewers }: { viewers: Viewer[] }) {
  if (viewers.length === 0) return null;
  return (
    <span className="avatars" aria-label={`Open by ${viewers.map((v) => v.agent.name).join(', ')}`}>
      {viewers.map((v) => (
        <span
          key={v.agent.id}
          className={`avatar ${v.typing ? 'avatar-typing' : ''}`}
          title={`${v.agent.name}${v.typing ? ' is typing' : ' has this open'}`}
          aria-hidden="true"
        >
          {initials(v.agent.name)}
        </span>
      ))}
    </span>
  );
}
