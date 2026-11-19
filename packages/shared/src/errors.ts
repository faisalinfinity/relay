import { z } from 'zod';

/**
 * Every error the API returns uses one of these codes. The HTTP status is fixed per code,
 * so a client can branch on `code` alone.
 */
export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  INVALID_JSON: 400,
  AGENT_REQUIRED: 401,
  UNKNOWN_AGENT: 401,
  INVALID_SIGNATURE: 401,
  NOT_TICKET_OWNER: 403,
  TICKET_NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  TICKET_ALREADY_CLAIMED: 409,
  TICKET_NOT_CLAIMED: 409,
  TICKET_CLOSED: 409,
  TICKET_BUSY: 409,
  SUBMISSION_CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

/** `details` for VALIDATION_FAILED: one entry per invalid field. */
export const FieldIssue = z.object({ path: z.string(), message: z.string() });
export type FieldIssue = z.infer<typeof FieldIssue>;
