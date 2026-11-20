import { useCallback, useEffect, useId, useRef, useState, type Ref } from 'react';
import { useLive } from '../live/LiveProvider';
import { useReply } from '../live/hooks';

/** Sends "typing" while the agent types, at most every 2s, and "stopped" after 3s of quiet. */
function useTypingSignal(ticketId: string) {
  const { setTyping } = useLive();
  const active = useRef(false);
  const lastSent = useRef(0);
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);

  const stop = useCallback(() => {
    clearTimeout(idle.current);
    if (!active.current) return;
    active.current = false;
    setTyping(ticketId, false);
  }, [setTyping, ticketId]);

  const ping = useCallback(() => {
    const now = Date.now();
    // The server clears "typing" after 6s without a refresh, so refresh every 2s while typing
    if (!active.current || now - lastSent.current > 2_000) {
      active.current = true;
      lastSent.current = now;
      setTyping(ticketId, true);
    }
    clearTimeout(idle.current);
    idle.current = setTimeout(stop, 3_000);
  }, [setTyping, stop, ticketId]);

  useEffect(() => stop, [stop]);
  return { ping, stop };
}

export function Composer({
  ticketId,
  customerName,
  ref,
}: {
  ticketId: string;
  customerName: string;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  const [text, setText] = useState('');
  const reply = useReply(ticketId);
  const typing = useTypingSignal(ticketId);
  const inputId = useId();
  const hintId = useId();

  const submit = () => {
    if (!text.trim() || reply.isPending) return;
    typing.stop();
    reply.mutate(text, { onSuccess: () => setText('') });
  };

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor={inputId} className="composer-label">
        Reply to {customerName}
      </label>
      <textarea
        id={inputId}
        ref={ref}
        className="composer-input"
        rows={5}
        value={text}
        aria-describedby={hintId}
        onChange={(event) => {
          setText(event.target.value);
          typing.ping();
        }}
        onBlur={typing.stop}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
      />
      {reply.error && (
        <p className="inline-error" role="alert">
          Not sent: {reply.error.message}
        </p>
      )}
      <div className="composer-actions">
        <span id={hintId} className="hint">
          <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> to send · <kbd>Esc</kbd> back to the queue
        </span>
        <button
          type="submit"
          className="button button-primary"
          disabled={!text.trim() || reply.isPending}
        >
          {reply.isPending ? 'Sending…' : 'Send reply'}
        </button>
      </div>
    </form>
  );
}
