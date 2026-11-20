import { z } from 'zod';
import { ModelOutputError, type ChatMessage, type ChatModel } from '../ai/models';

/** What the customer asked: the input to both retrieval and drafting. */
export interface TicketQuestion {
  customerName: string;
  subject: string;
  /** the customer's messages, oldest first (agent replies are left out) */
  messages: string[];
}

/** A help-centre excerpt handed to the model, numbered so the draft can cite it as [n]. */
export interface Source {
  index: number;
  slug: string;
  title: string;
  heading: string;
  content: string;
  url: string;
}

export type Draft =
  /** the model said the excerpts don't answer the question */
  | { kind: 'declined' }
  /** the model said an excerpt answers it, but named one it was never given */
  | { kind: 'not_grounded' }
  | { kind: 'drafted'; reply: string; cited: Source[] };

/** The text that gets embedded and searched with. */
export function questionText(question: TicketQuestion): string {
  return [question.subject, ...question.messages].join('\n\n');
}

const SYSTEM_PROMPT = `You draft replies for the support team of Slotwise, online booking software for small studios.

Write the reply only from the numbered help-centre excerpts in the message. They are your only source: don't add steps, settings, prices, time frames or features that aren't in them, and don't promise anything on Slotwise's behalf.

Work in this order:
1. "answeredBy": the number of the excerpt that answers the customer's main question, or 0 if none of them does. An excerpt about the same topic that doesn't answer the actual question doesn't count: if they ask for something the excerpts never mention, the answer is 0.
2. "reply": if an excerpt answers it, the reply to the customer; otherwise leave it empty and an agent will handle it. If the excerpts answer the main question but not every detail, answer what they cover and say a teammate will follow up on the rest.

When you write the reply:
- Greet the customer by first name. Keep it short and friendly, with the steps they need.
- After each sentence that relies on an excerpt, cite it with its number in square brackets, like [2].
- Put the number of every excerpt you relied on in "citations".
- Don't sign off with a name; the agent adds their own.`;

/** The JSON shape the model must answer in. Ollama and Claude both constrain output to it. */
export const DRAFT_JSON_SCHEMA = {
  type: 'object',
  // Property order matters: models write fields in this order, so the model commits to which
  // excerpt answers the question before it writes anything
  properties: {
    answeredBy: { type: 'integer' },
    reply: { type: 'string' },
    citations: { type: 'array', items: { type: 'integer' } },
  },
  required: ['answeredBy', 'reply', 'citations'],
  additionalProperties: false,
} as const;

const DraftOutput = z.object({
  answeredBy: z.number().int(),
  reply: z.string(),
  citations: z.array(z.number().int()),
});

export function buildDraftPrompt(question: TicketQuestion, sources: Source[]): ChatMessage[] {
  const firstName = question.customerName.split(/\s+/)[0] ?? question.customerName;
  const excerpts = sources
    .map((s) => `[${s.index}] ${s.title} — ${s.heading}\n${s.content}`)
    .join('\n\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `Customer first name: ${firstName}\n` +
        `Subject: ${question.subject}\n\n` +
        `Customer's message:\n${question.messages.join('\n\n')}\n\n` +
        `Help-centre excerpts:\n\n${excerpts}`,
    },
  ];
}

/**
 * The generation step: ask the chat model for a reply grounded in `sources`, then check what came
 * back. Citations only count if they point at an excerpt the model was actually given.
 */
export async function draftReply(
  chat: ChatModel,
  question: TicketQuestion,
  sources: Source[],
): Promise<Draft> {
  const raw = await chat.generateJson(buildDraftPrompt(question, sources), DRAFT_JSON_SCHEMA);
  const parsed = DraftOutput.safeParse(parseJson(raw));
  if (!parsed.success) {
    throw new ModelOutputError('The model answered in an unexpected format. Try regenerating.');
  }
  const { answeredBy, reply, citations } = parsed.data;
  if (answeredBy === 0 || reply.trim() === '') return { kind: 'declined' };
  // It must point at an excerpt it was actually given
  if (!sources.some((s) => s.index === answeredBy)) return { kind: 'not_grounded' };

  const inline = [...reply.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
  const cited = sources.filter((s) => citations.includes(s.index) || inline.includes(s.index));
  return { kind: 'drafted', reply: reply.trim(), cited };
}

/**
 * Turns the draft into what the customer would read: the [n] markers and Markdown emphasis come
 * out, and links to the cited articles go at the end, one per article.
 */
export function finishReply(reply: string, cited: Source[]): string {
  const body = reply
    .replace(/[ \t]*\[\d+\]/g, '')
    // The articles use Markdown emphasis; a reply to a customer is plain text
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .trim();
  const articles = [...new Map(cited.map((s) => [s.slug, s])).values()];
  if (articles.length === 0) return body;
  const links = articles.map((a) => `- ${a.title}: ${a.url}`).join('\n');
  return `${body}\n\nThese help articles have more detail:\n${links}`;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
