import { ERROR_STATUS, type ApiErrorBody, type ErrorCode } from '@relay/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = ERROR_STATUS[code];
  }
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError('ROUTE_NOT_FOUND', `There is no ${req.method} ${req.path} endpoint.`));
};

/** The only place an error turns into a response, so every error has the same shape. */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const appError = toAppError(err);
  if (appError.status >= 500) req.log.error({ err }, 'request failed');

  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details === undefined ? {} : { details: appError.details }),
      // genReqId in app.ts always produces a string
      requestId: typeof req.id === 'string' ? req.id : undefined,
    },
  };
  res.status(appError.status).json(body);
};

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  // Errors thrown by express.json() / express.raw() carry a `type`
  const type = typeof err === 'object' && err !== null && 'type' in err ? err.type : undefined;
  if (type === 'entity.parse.failed') {
    return new AppError('INVALID_JSON', 'The request body is not valid JSON.');
  }
  if (type === 'entity.too.large') {
    return new AppError('PAYLOAD_TOO_LARGE', 'The request body is too large.');
  }
  return new AppError(
    'INTERNAL',
    'Something went wrong on our side. Try again, and check the API logs if it keeps happening.',
  );
}
