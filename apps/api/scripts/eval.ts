/**
 * Retrieval evaluation: does the search find the right article, and where should the
 * "no article covers this" cut-off sit?
 *
 *   pnpm eval              retrieval only (fast, needs Ollama for embeddings)
 *   pnpm eval --generate   also drafts a reply for every question with the configured chat model
 *
 * Needs the articles ingested first: pnpm ingest
 */
import { parseArgs } from 'node:util';
import { count } from 'drizzle-orm';
import { covered, uncovered } from '../eval/questions';
import { createModels } from '../src/ai';
import { loadConfig } from '../src/config';
import { createDb } from '../src/db/client';
import { articleChunks } from '../src/db/schema';
import { retrieve, type ChunkHit } from '../src/retrieval/search';
import {
  draftReply,
  questionText,
  type Source,
  type TicketQuestion,
} from '../src/suggestions/draft';

const { values: args } = parseArgs({ options: { generate: { type: 'boolean', default: false } } });
const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
const { embedder, chat } = createModels(config.ai);
const cutoff = config.ai.minSimilarity;

const asQuestion = (q: { subject: string; message: string }): TicketQuestion => ({
  customerName: 'Sam Rivera',
  subject: q.subject,
  messages: [q.message],
});

/** Article slugs in the order the search ranked their best chunk. */
const articleOrder = (hits: ChunkHit[]) => [...new Set(hits.map((h) => h.slug))];
const pad = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);

try {
  const [{ chunks } = { chunks: 0 }] = await db.select({ chunks: count() }).from(articleChunks);
  if (chunks === 0) throw new Error('No article chunks found. Run: pnpm ingest');
  console.log(`Embeddings: ${embedder.model} · ${chunks} chunks · cut-off ${cutoff}\n`);

  // ---------- retrieval ----------
  console.log(`${pad('Question', 34)} ${pad('Expected article', 32)} rank  best   top article`);
  const results = [];
  for (const q of covered) {
    const { hits } = await retrieve(db, embedder, questionText(asQuestion(q)), {
      limit: 10,
      minSimilarity: 0,
    });
    const order = articleOrder(hits);
    const rank = order.indexOf(q.expect) + 1; // 0 = not in the top 10 chunks
    const best = hits[0]?.similarity ?? 0;
    results.push({ q, hits, rank, best });
    console.log(
      `${pad(q.subject, 34)} ${pad(q.expect, 32)} ${String(rank || '-').padStart(4)}  ${best.toFixed(3)}  ${order[0]}`,
    );
  }

  const top1 = results.filter((r) => r.rank === 1).length;
  const top3 = results.filter((r) => r.rank >= 1 && r.rank <= 3).length;
  const mrr = results.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0) / results.length;
  console.log(
    `\nHit rate (expected article in top 3): ${top3}/${results.length} = ${Math.round((top3 / results.length) * 100)}%`,
  );
  console.log(`Top-1: ${top1}/${results.length} · MRR: ${mrr.toFixed(2)}`);

  // ---------- cut-off ----------
  const offTopic = [];
  for (const q of uncovered) {
    const { hits } = await retrieve(db, embedder, questionText(asQuestion(q)), {
      limit: 1,
      minSimilarity: 0,
    });
    offTopic.push({ q, best: hits[0]?.similarity ?? 0, nearest: hits[0]?.slug ?? '-' });
  }

  const coveredScores = results.map((r) => r.best).sort((a, b) => a - b);
  const uncoveredScores = offTopic.map((r) => r.best).sort((a, b) => a - b);
  console.log('\nBest similarity per question');
  console.log(`  covered:   ${coveredScores.map((s) => s.toFixed(3)).join(' ')}`);
  console.log(`  uncovered: ${uncoveredScores.map((s) => s.toFixed(3)).join(' ')}`);
  for (const r of offTopic) {
    console.log(`    ${pad(r.q.subject, 14)} ${r.best.toFixed(3)} nearest: ${r.nearest}`);
  }

  const lowestCovered = coveredScores[0]!;
  const highestUncovered = uncoveredScores.at(-1)!;
  if (lowestCovered > highestUncovered) {
    console.log(
      `  The groups separate: any cut-off between ${highestUncovered.toFixed(3)} and ${lowestCovered.toFixed(3)} sorts all 18 correctly.`,
    );
  } else {
    console.log(
      `  The groups overlap (${lowestCovered.toFixed(3)} ≤ ${highestUncovered.toFixed(3)}): no cut-off sorts all 18.`,
    );
  }
  const answered = coveredScores.filter((s) => s >= cutoff).length;
  const refused = uncoveredScores.filter((s) => s < cutoff).length;
  console.log(
    `  At the configured cut-off ${cutoff}: ${answered}/${covered.length} covered questions get a draft, ` +
      `${refused}/${uncovered.length} uncovered ones get "no article covers this".`,
  );

  // ---------- generation ----------
  if (args.generate) {
    console.log(`\nDrafting with ${chat.model}…`);
    const all = [
      ...covered.map((q) => ({ q, expect: q.expect })),
      ...uncovered.map((q) => ({ q, expect: null })),
    ];
    let right = 0;
    for (const { q, expect } of all) {
      const question = asQuestion(q);
      const { relevant } = await retrieve(db, embedder, questionText(question), {
        limit: 6,
        minSimilarity: cutoff,
      });
      const sources: Source[] = relevant.slice(0, 4).map((hit, i) => ({
        index: i + 1,
        slug: hit.slug,
        title: hit.title,
        heading: hit.heading,
        content: hit.content,
        url: `${config.ai.helpCenterUrl}/${hit.slug}`,
      }));
      let outcome: string;
      let ok: boolean;
      if (sources.length === 0) {
        outcome = 'no article (cut-off)';
        ok = expect === null;
      } else {
        const draft = await draftReply(chat, question, sources);
        if (draft.kind === 'declined' || draft.kind === 'not_grounded') {
          outcome =
            draft.kind === 'declined'
              ? 'no article (model declined)'
              : 'no article (draft discarded: named an excerpt it was not given)';
          ok = expect === null;
        } else {
          const cited = [...new Set(draft.cited.map((s) => s.slug))];
          outcome = `drafted, cites ${cited.join(', ') || 'nothing'}`;
          ok = expect !== null && cited.includes(expect);
        }
      }
      if (ok) right++;
      console.log(`  ${ok ? '✓' : '✗'} ${pad(q.subject, 30)} ${outcome}`);
    }
    console.log(
      `\nEnd to end: ${right}/${all.length} right (covered: drafted and cites the expected article; uncovered: said no article covers it)`,
    );
  }
} finally {
  await pool.end();
}
