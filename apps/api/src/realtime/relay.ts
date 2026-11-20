import type { TicketEvent } from '@relay/shared';
import pg from 'pg';
import type { Logger } from 'pino';
import type { Db } from '../db/client';
import { EVENTS_CHANNEL, eventRange, readEventsSince } from './events';

const BATCH = 500;

type Subscriber = (event: TicketEvent) => void;

/**
 * Delivers every committed ticket event to this API instance, in seq order.
 *
 * Each instance LISTENs on a Postgres channel. A NOTIFY only means "there is something new";
 * the relay then reads the log itself from the last seq it delivered. That way a dropped
 * listener connection or a burst of notifications can't lose or reorder events: the next
 * read simply picks up from where the last one stopped.
 */
export class EventRelay {
  private lastSeq = 0;
  private listener: pg.Client | null = null;
  private reading: Promise<void> = Promise.resolve();
  private readQueued = false;
  private retryTimer: NodeJS.Timeout | undefined;
  private stopped = false;
  private readonly subscribers = new Set<Subscriber>();

  constructor(
    private readonly db: Db,
    private readonly databaseUrl: string,
    private readonly log: Logger,
  ) {}

  async start(): Promise<void> {
    this.lastSeq = (await eventRange(this.db)).head ?? 0;
    await this.listen();
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    await this.listener?.end().catch(() => undefined);
    await this.reading;
  }

  private async listen(): Promise<void> {
    const client = new pg.Client({ connectionString: this.databaseUrl });
    client.on('notification', () => this.readNew());
    client.on('error', (err) => {
      this.log.error({ err }, 'event listener connection failed, reconnecting');
      this.reconnectSoon(client);
    });
    try {
      await client.connect();
      await client.query(`listen ${EVENTS_CHANNEL}`);
    } catch (err) {
      this.log.error({ err }, 'could not listen for events, retrying');
      this.reconnectSoon(client);
      return;
    }
    this.listener = client;
    this.readNew(); // pick up anything committed while we were not listening
  }

  private reconnectSoon(client: pg.Client) {
    if (this.listener === client) this.listener = null;
    void client.end().catch(() => undefined);
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.listen();
    }, 1000);
  }

  /** Reads and delivers everything after lastSeq. Reads never overlap; a burst becomes one read. */
  private readNew() {
    if (this.readQueued) return;
    this.readQueued = true;
    this.reading = this.reading
      .then(async () => {
        this.readQueued = false;
        for (;;) {
          const events = await readEventsSince(this.db, this.lastSeq, BATCH);
          for (const event of events) {
            this.lastSeq = event.seq;
            for (const subscriber of this.subscribers) subscriber(event);
          }
          if (events.length < BATCH) return;
        }
      })
      .catch((err: unknown) => {
        this.log.error({ err }, 'reading new events failed');
      });
  }
}
