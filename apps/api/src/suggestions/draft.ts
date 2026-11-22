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
  /** asksAbout: what the model says the customer asks about, for the help-centre check */
  | { kind: 'drafted'; reply: string; cited: Source[]; asksAbout: string[] };

/** The text that gets embedded and searched with. */
export function questionText(question: TicketQuestion): string {
  return [question.subject, ...question.messages].join('\n\n');
}

const SYSTEM_PROMPT = `You draft replies for the support team of Slotwise, online booking software for small studios.

Write the reply only from the numbered help-centre excerpts in the message. They are your only source: don't add steps, settings, prices, time frames or features that aren't in them, and don't promise anything on Slotwise's behalf.

Work in this order:
1. "asksAbout": the specific things the customer asks about, as 1 to 3 short terms in their own words: the feature, product, payment method, integration or service they name (for example "Outlook calendar", "deposits" or "custom domain"). Leave out people, job titles and general words like booking, account or settings.
2. "answeredBy": the number of the excerpt that answers the customer's main question, or 0 if none of them does. An excerpt about the same topic that doesn't answer the actual question doesn't count: if they ask for something the excerpts never mention, the answer is 0.
3. "reply": if an excerpt answers it, the reply to the customer; otherwise leave it empty and an agent will handle it. If the excerpts answer the main question but not every detail, answer what they cover and say a teammate will follow up on the rest.

When you write the reply:
- Greet the customer by first name. Keep it short and friendly, with the steps they need.
- After each sentence that relies on an excerpt, cite it with its number in square brackets, like [2].
- Put the number of every excerpt you relied on in "citations".
- Don't sign off with a name; the agent adds their own.`;

/** The JSON shape the model must answer in. Ollama and Claude both constrain output to it. */
export const DRAFT_JSON_SCHEMA = {
  type: 'object',
  // Property order matters: models write fields in this order, so the model names what was asked
  // and commits to which excerpt answers it before it writes anything
  properties: {
    asksAbout: { type: 'array', items: { type: 'string' } },
    answeredBy: { type: 'integer' },
    reply: { type: 'string' },
    citations: { type: 'array', items: { type: 'integer' } },
  },
  required: ['asksAbout', 'answeredBy', 'reply', 'citations'],
  additionalProperties: false,
} as const;

const DraftOutput = z.object({
  asksAbout: z.array(z.string()).default([]),
  answeredBy: z.number().int(),
  reply: z.string(),
  citations: z.array(z.number().int()),
});

/**
 * Small models sometimes run past the end of their turn inside the JSON string: a stray "}" or a
 * chat-template token, then "user" or "assistant", then text nobody asked for. Seen with
 * qwen2.5:3b as "}user" and "assistant", each followed by combining marks, then "Guam, thank you…".
 */
const LEAKED_TURN =
  /<\|[a-z_]{2,20}\|>|\}\s*(?:user|assistant|system)\b|\b(?:user|assistant|system)[\u0300-\u036f\ufe0f]/i;

/** Drops everything from the first sign of a leaked turn. */
export function cutAtLeakedTurn(reply: string): string {
  const at = reply.search(LEAKED_TURN);
  return (at === -1 ? reply : reply.slice(0, at)).trim();
}

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
  const { asksAbout, answeredBy, citations } = parsed.data;
  const reply = cutAtLeakedTurn(parsed.data.reply);
  if (answeredBy === 0 || reply === '') return { kind: 'declined' };
  // It must point at an excerpt it was actually given
  if (!sources.some((s) => s.index === answeredBy)) return { kind: 'not_grounded' };

  const inline = [...reply.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
  const cited = sources.filter((s) => citations.includes(s.index) || inline.includes(s.index));
  return { kind: 'drafted', reply, cited, asksAbout };
}

/**
 * A marker right after one of these words finishes the sentence ("as described in [1]", "see [2]"),
 * so taking it out would leave the sentence hanging.
 */
const ENDS_WANTING_A_NAME = /\b(?:in|see|to|from|per|under|on|at|of|via)$/i;

/**
 * Turns the draft into what the customer would read: the [n] markers and Markdown emphasis come
 * out, and links to the cited articles go at the end, one per article. A marker that finishes a
 * sentence is replaced with the article's title instead.
 */
export function finishReply(reply: string, cited: Source[]): string {
  const titles = new Map(cited.map((s) => [s.index, s.title]));
  const body = reply
    .replace(
      /[ \t]*((?:\[\d+\])+)/g,
      (_match: string, run: string, offset: number, all: string) => {
        if (!ENDS_WANTING_A_NAME.test(all.slice(0, offset))) return '';
        const named = new Set(
          [...run.matchAll(/\d+/g)].flatMap((m) => titles.get(Number(m[0])) ?? []),
        );
        return named.size === 0 ? '' : ` ${[...named].map((title) => `"${title}"`).join(' and ')}`;
      },
    )
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
