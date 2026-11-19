import type { FieldIssue } from '@relay/shared';
import type { z } from 'zod';
import { AppError } from './errors';

/** Parses `input` with `schema` or throws a 400 VALIDATION_FAILED listing every bad field. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const issues: FieldIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  const first = issues[0];
  const summary = first ? `${first.path || 'body'}: ${first.message}` : 'Invalid request';
  throw new AppError('VALIDATION_FAILED', summary, issues);
}
