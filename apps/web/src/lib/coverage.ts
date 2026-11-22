import type { Suggestion } from '@relay/shared';

type NoCoverage = Extract<Suggestion, { status: 'no_coverage' }>;

const NO_COVERAGE: Record<NoCoverage['reason'], string> = {
  no_relevant_articles:
    'Nothing in the help centre is close enough to this question, so no draft was written.',
  model_declined: "The closest articles are about something similar, but they don't answer this.",
  not_grounded:
    "A draft was written, but it wasn't backed by the articles it was given, so it was discarded.",
  not_in_help_centre:
    'A draft was written, but no article mentions what the customer asked about, so it was discarded.',
};

/** Why the panel shows "No help article covers this", in words an agent can act on. */
export function noCoverageHint(suggestion: NoCoverage): string {
  const missing = suggestion.missing ?? [];
  if (suggestion.reason !== 'not_in_help_centre' || missing.length === 0) {
    return NO_COVERAGE[suggestion.reason];
  }
  const terms = missing.map((term) => `“${term}”`).join(' or ');
  return `No article mentions ${terms}, so the draft the model wrote was discarded.`;
}
