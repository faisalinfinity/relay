import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ModelUnavailableError } from '../src/ai/models';
import type { ArticleFile } from '../src/articles/sync';
import type { TicketRow } from '../src/db/schema';
import { ingestArticles } from '../src/retrieval/ingest';
import { answer, decline, FakeChat, FakeEmbedder } from './fakes';
import { call, createTicket, resetDb, startTestServer, type TestServer } from './helpers';

let server: TestServer;
let ticket: TicketRow;
const embedder = new FakeEmbedder();
const chat = new FakeChat(() => answer('Hi Priya! Open Settings and click Reconnect [1].', [1]));
let embedderDown = false;

const article: ArticleFile = {
  slug: 'calendar-sync-troubleshooting',
  title: 'Calendar sync troubleshooting',
  category: 'Calendar sync',
  body: '## Error SW-1042: calendar connection expired\n\nYour Google calendar connection expired after a password change. Open Settings, Calendar and click Reconnect. Bookings sync again.',
  contentHash: createHash('sha256').update('v1').digest('hex'),
};

beforeAll(async () => {
  server = await startTestServer(
    {},
    {},
    {
      embedder: {
        model: embedder.model,
        embedDocuments: (texts) => embedder.embedDocuments(texts),
        embedQuery: (text) => {
          if (embedderDown)
            return Promise.reject(new ModelUnavailableError('Ollama is not running'));
          return embedder.embedQuery(text);
        },
      },
      chat,
      minSimilarity: 0.3,
    },
  );
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  embedderDown = false;
  chat.calls.length = 0;
  chat.respond = () => answer('Hi Priya! Open Settings and click Reconnect [1].', [1]);
  await resetDb(server.db);
  await ingestArticles(server.db, embedder, [article]);
  ticket = await createTicket(server.db, { subject: 'Google calendar connection expired SW-1042' });
});

const suggest = (id = ticket.id, query = '') =>
  call(server, 'GET', `/api/tickets/${id}/suggestion${query}`);

describe('GET /api/tickets/:id/suggestion', () => {
  it('drafts a reply from the matching article and links it', async () => {
    const res = await suggest();

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'drafted',
      sources: [
        {
          slug: 'calendar-sync-troubleshooting',
          title: 'Calendar sync troubleshooting',
          url: 'https://help.test/articles/calendar-sync-troubleshooting',
        },
      ],
      models: { embedding: 'fake-embed', chat: 'fake-chat' },
    });
    expect(res.body.data.reply).toBe(
      'Hi Priya! Open Settings and click Reconnect.\n\n' +
        'These help articles have more detail:\n' +
        '- Calendar sync troubleshooting: https://help.test/articles/calendar-sync-troubleshooting',
    );
    expect(res.body.data.retrieved[0]).toMatchObject({
      slug: 'calendar-sync-troubleshooting',
      used: true,
    });
    // The model saw the ticket and the excerpt
    expect(chat.calls[0]![1]!.content).toContain('Google calendar connection expired SW-1042');
    expect(chat.calls[0]![1]!.content).toContain('[1] Calendar sync troubleshooting');
  });

  it('says no article covers it, without asking the model, when nothing clears the cut-off', async () => {
    const offTopic = await createTicket(server.db, {
      subject: 'Do you sell gift vouchers for massages',
    });

    const res = await suggest(offTopic.id);

    expect(res.body.data).toMatchObject({ status: 'no_coverage', reason: 'no_relevant_articles' });
    expect(res.body.data.retrieved.every((r: { used: boolean }) => !r.used)).toBe(true);
    expect(chat.calls).toHaveLength(0);
  });

  it('says no article covers it when the model finds the excerpts do not answer it', async () => {
    chat.respond = decline;
    const res = await suggest();
    expect(res.body.data).toMatchObject({ status: 'no_coverage', reason: 'model_declined' });
  });

  it('reuses the last draft until asked to regenerate', async () => {
    const first = await suggest();
    const second = await suggest();
    chat.respond = () => answer('A fresh take [1].', [1]);
    const regenerated = await suggest(ticket.id, '?refresh=true');

    expect(second.body.data).toEqual(first.body.data);
    expect(regenerated.body.data.reply).toMatch(/^A fresh take\./);
    expect(chat.calls).toHaveLength(2);
  });

  it('drafts once when two agents open the ticket at the same moment', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    chat.respond = async () => {
      await gate;
      return answer('Hi! [1]', [1]);
    };

    const both = Promise.all([suggest(), suggest()]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    const [a, b] = await both;

    expect(a.body.data).toEqual(b.body.data);
    expect(chat.calls).toHaveLength(1);
  });

  it('answers 503 with a clear message when the model server is down', async () => {
    embedderDown = true;
    const res = await suggest();
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({
      code: 'SUGGESTIONS_UNAVAILABLE',
      message: 'Ollama is not running',
    });
  });

  it('answers 502 when the model replies with something unusable', async () => {
    chat.respond = () => 'not json';
    const res = await suggest();
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('SUGGESTION_FAILED');
  });

  it('404s for an unknown ticket', async () => {
    const res = await suggest(randomUUID());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TICKET_NOT_FOUND');
  });
});
