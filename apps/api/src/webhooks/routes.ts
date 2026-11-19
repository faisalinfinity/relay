import { IntakeTicketPayload, type DataResponse, type IntakeResult } from '@relay/shared';
import express, { Router } from 'express';
import type { Db } from '../db/client';
import { AppError } from '../http/errors';
import { parse } from '../http/validate';
import { ingestSubmission } from './intake';
import { SIGNATURE_HEADER, verifySignature, type SignatureFailure } from './signature';

export interface WebhookOptions {
  secret: string;
  toleranceSeconds: number;
}

const FAILURE_MESSAGES: Record<SignatureFailure, (toleranceSeconds: number) => string> = {
  missing: () => `Missing the ${SIGNATURE_HEADER} header.`,
  malformed: () => `${SIGNATURE_HEADER} must look like t=<unix seconds>,v1=<hex HMAC-SHA256>.`,
  expired: (tolerance) =>
    `The signature timestamp is more than ${tolerance}s away from server time. Sign the request again.`,
  mismatch: () => 'The signature does not match the request body.',
};

export function webhooksRouter(db: Db, options: WebhookOptions): Router {
  const router = Router();

  // express.raw keeps the body as the exact bytes that were signed. Parsing to JSON first and
  // re-serialising would change whitespace or key order and break the HMAC.
  router.post(
    '/tickets',
    express.raw({ type: 'application/json', limit: '64kb' }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body)) {
        throw new AppError(
          'UNSUPPORTED_MEDIA_TYPE',
          'Send the form submission as application/json.',
        );
      }
      const rawBody = req.body;

      const verified = verifySignature({
        secret: options.secret,
        header: req.get(SIGNATURE_HEADER),
        rawBody,
        toleranceSeconds: options.toleranceSeconds,
      });
      if (!verified.ok) {
        throw new AppError(
          'INVALID_SIGNATURE',
          FAILURE_MESSAGES[verified.reason](options.toleranceSeconds),
        );
      }

      // Only parse after the signature checks out, so unsigned bytes never reach the parser
      let json: unknown;
      try {
        json = JSON.parse(rawBody.toString('utf8'));
      } catch {
        throw new AppError('INVALID_JSON', 'The request body is not valid JSON.');
      }
      const payload = parse(IntakeTicketPayload, json);

      const result = await ingestSubmission(db, payload);
      const body: DataResponse<IntakeResult> = { data: result };
      res.status(result.duplicate ? 200 : 201).json(body);
    },
  );

  return router;
}
