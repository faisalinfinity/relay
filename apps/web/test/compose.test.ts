import { describe, expect, it } from 'vitest';
import { withSuggestion } from '../src/lib/compose';

describe('withSuggestion', () => {
  it('fills an empty reply box', () => {
    expect(withSuggestion('', 'Hi Maya!')).toBe('Hi Maya!');
    expect(withSuggestion('  \n', 'Hi Maya!')).toBe('Hi Maya!');
  });

  it('keeps what the agent already typed and adds the suggestion below', () => {
    expect(withSuggestion('Thanks for waiting.  ', 'Hi Maya!')).toBe(
      'Thanks for waiting.\n\nHi Maya!',
    );
  });
});
