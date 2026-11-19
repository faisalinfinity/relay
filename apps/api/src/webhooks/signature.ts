import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Header format: `t=<unix seconds>,v1=<hex HMAC-SHA256>`
 * The HMAC covers `<t>.<raw body>`. Putting the timestamp inside the signed bytes means an
 * attacker can't take an old captured request and just change the timestamp.
 */
export const SIGNATURE_HEADER = 'X-Relay-Signature';

export function computeSignature(
  secret: string,
  timestamp: number,
  rawBody: Buffer | string,
): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

export function signPayload(
  secret: string,
  rawBody: Buffer | string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, rawBody)}`;
}

export type SignatureFailure = 'missing' | 'malformed' | 'expired' | 'mismatch';

export type VerifyResult =
  { ok: true; timestamp: number } | { ok: false; reason: SignatureFailure };

export interface VerifyInput {
  secret: string;
  header: string | undefined;
  rawBody: Buffer;
  toleranceSeconds: number;
  nowSeconds?: number;
}

export function verifySignature({
  secret,
  header,
  rawBody,
  toleranceSeconds,
  nowSeconds = Math.floor(Date.now() / 1000),
}: VerifyInput): VerifyResult {
  if (!header) return { ok: false, reason: 'missing' };

  const fields = new Map<string, string>();
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) fields.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  const t = fields.get('t');
  const v1 = fields.get('v1');
  if (!t || !/^\d{1,12}$/.test(t) || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) {
    return { ok: false, reason: 'malformed' };
  }

  // Reject anything outside the window so a captured request can't be replayed later
  const timestamp = Number(t);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return { ok: false, reason: 'expired' };

  const expected = Buffer.from(computeSignature(secret, timestamp, rawBody), 'hex');
  const received = Buffer.from(v1, 'hex');
  // Constant-time compare so response timing doesn't leak how many bytes matched.
  // Both are 32 bytes (the regex above guarantees it), which timingSafeEqual requires.
  if (!timingSafeEqual(expected, received)) return { ok: false, reason: 'mismatch' };

  return { ok: true, timestamp };
}
