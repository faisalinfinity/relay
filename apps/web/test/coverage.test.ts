import type { Suggestion } from '@relay/shared';
import { describe, expect, it } from 'vitest';
import { noCoverageHint } from '../src/lib/coverage';

const none = (
  reason: Extract<Suggestion, { status: 'no_coverage' }>['reason'],
  missing?: string[],
): Extract<Suggestion, { status: 'no_coverage' }> => ({
  status: 'no_coverage',
  reason,
  ...(missing ? { missing } : {}),
  retrieved: [],
  models: { embedding: 'e', chat: 'c' },
  createdAt: '2026-11-22T00:00:00Z',
});

describe('noCoverageHint', () => {
  it('names what no article mentions, so the agent knows what to look up', () => {
    expect(noCoverageHint(none('not_in_help_centre', ['QuickBooks', 'Xero']))).toBe(
      'No article mentions “QuickBooks” or “Xero”, so the draft the model wrote was discarded.',
    );
  });

  it('explains each other reason in plain words', () => {
    expect(noCoverageHint(none('no_relevant_articles'))).toContain('close enough');
    expect(noCoverageHint(none('model_declined'))).toContain("don't answer this");
    expect(noCoverageHint(none('not_grounded'))).toContain('discarded');
  });
});
