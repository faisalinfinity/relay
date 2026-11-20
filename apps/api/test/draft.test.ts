import { describe, expect, it } from 'vitest';
import { ModelOutputError } from '../src/ai/models';
import {
  buildDraftPrompt,
  draftReply,
  finishReply,
  questionText,
  type Source,
  type TicketQuestion,
} from '../src/suggestions/draft';
import { answer, decline, FakeChat } from './fakes';

const question: TicketQuestion = {
  customerName: 'Maya Lindqvist',
  subject: 'Google calendar not syncing - SW-1042',
  messages: ['Since this morning nothing syncs.', 'Also, I changed my password yesterday.'],
};

const source = (index: number, slug: string, title: string): Source => ({
  index,
  slug,
  title,
  heading: 'Section',
  content: `Content of ${title}`,
  url: `https://help.test/articles/${slug}`,
});
const sources = [
  source(1, 'calendar-sync-troubleshooting', 'Calendar sync troubleshooting'),
  source(2, 'connecting-google-calendar', 'Connecting Google Calendar'),
];

describe('questionText', () => {
  it('is the subject plus every customer message', () => {
    expect(questionText(question)).toBe(
      'Google calendar not syncing - SW-1042\n\nSince this morning nothing syncs.\n\nAlso, I changed my password yesterday.',
    );
  });
});

describe('buildDraftPrompt', () => {
  it('numbers each excerpt and passes the first name and the whole message', () => {
    const [system, user] = buildDraftPrompt(question, sources);

    expect(system!.role).toBe('system');
    expect(system!.content).toContain('answeredBy');
    expect(user!.content).toContain('Customer first name: Maya');
    expect(user!.content).toContain('I changed my password yesterday');
    expect(user!.content).toContain('[1] Calendar sync troubleshooting — Section');
    expect(user!.content).toContain('[2] Connecting Google Calendar — Section');
  });
});

describe('draftReply', () => {
  it('keeps the excerpts the model cited, listed or inline', async () => {
    const chat = new FakeChat(() => answer('Hi Maya! Click Reconnect [1].', [2]));
    const draft = await draftReply(chat, question, sources);

    expect(draft).toEqual({
      kind: 'drafted',
      reply: 'Hi Maya! Click Reconnect [1].',
      cited: sources,
    });
  });

  it('ignores citations of excerpts it was never given', async () => {
    const chat = new FakeChat(() => answer('Hi Maya! [1] [7]', [1, 9]));
    const draft = await draftReply(chat, question, sources);

    expect(draft.kind === 'drafted' && draft.cited.map((s) => s.index)).toEqual([1]);
  });

  it('reports a decline when the model says the excerpts do not answer it', async () => {
    expect(await draftReply(new FakeChat(decline), question, sources)).toEqual({
      kind: 'declined',
    });
  });

  it('discards a draft that names an excerpt it was never given', async () => {
    const chat = new FakeChat(() => answer('Hi Maya! [3]', [3], 3));
    expect(await draftReply(chat, question, sources)).toEqual({ kind: 'not_grounded' });
  });

  it('treats an empty reply as a decline', async () => {
    const chat = new FakeChat(() => answer('   ', [1]));
    expect(await draftReply(chat, question, sources)).toEqual({ kind: 'declined' });
  });

  it('rejects output that is not the agreed JSON', async () => {
    const chat = new FakeChat(() => 'Sure! Here is a reply.');
    await expect(draftReply(chat, question, sources)).rejects.toBeInstanceOf(ModelOutputError);
  });
});

describe('finishReply', () => {
  it('replaces [n] markers with one link per cited article at the end', () => {
    const reply = finishReply('Hi Maya! Click Reconnect [1]. It syncs again [1][2].', sources);

    expect(reply).toBe(
      'Hi Maya! Click Reconnect. It syncs again.\n\n' +
        'These help articles have more detail:\n' +
        '- Calendar sync troubleshooting: https://help.test/articles/calendar-sync-troubleshooting\n' +
        '- Connecting Google Calendar: https://help.test/articles/connecting-google-calendar',
    );
  });

  it('takes out Markdown emphasis copied from the articles', () => {
    expect(finishReply('Go to **Settings → Calendar** and click __Reconnect__ [1].', [])).toBe(
      'Go to Settings → Calendar and click Reconnect.',
    );
  });

  it('adds no footer when nothing was cited', () => {
    expect(finishReply('Hi Maya!', [])).toBe('Hi Maya!');
  });
});
