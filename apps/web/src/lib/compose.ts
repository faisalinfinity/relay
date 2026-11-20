/**
 * Puts a suggested reply into the reply box. Anything the agent already typed is kept and the
 * suggestion goes below it, so inserting can never throw away their work.
 */
export function withSuggestion(current: string, suggestion: string): string {
  return current.trim() === '' ? suggestion : `${current.trimEnd()}\n\n${suggestion}`;
}
