import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signPayload, verifySignature } from '../src/webhooks/signature';

const secret = 'shared-secret-for-tests';
const rawBody = Buffer.from('{"submissionId":"abc12345","subject":"Hi"}');
const t = 1_763_500_000;

const verify = (header: string | undefined, nowSeconds = t, body = rawBody) =>
  verifySignature({ secret, header, rawBody: body, toleranceSeconds: 300, nowSeconds });

describe('webhook signatures', () => {
  it('signs "<timestamp>.<body>" with HMAC-SHA256', () => {
    const expected = createHmac('sha256', secret)
      .update(`${t}.${rawBody.toString()}`)
      .digest('hex');
    expect(signPayload(secret, rawBody, t)).toBe(`t=${t},v1=${expected}`);
  });

  it('accepts its own signature, inside the tolerance window on either side', () => {
    const header = signPayload(secret, rawBody, t);
    expect(verify(header)).toEqual({ ok: true, timestamp: t });
    expect(verify(header, t + 300).ok).toBe(true);
    expect(verify(header, t - 300).ok).toBe(true);
  });

  it('rejects a timestamp outside the window', () => {
    const header = signPayload(secret, rawBody, t);
    expect(verify(header, t + 301)).toEqual({ ok: false, reason: 'expired' });
    expect(verify(header, t - 301)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a one-byte change to the body', () => {
    const header = signPayload(secret, rawBody, t);
    const tampered = Buffer.from(rawBody.toString().replace('Hi', 'Ho'));
    expect(verify(header, t, tampered)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a moved timestamp, because the timestamp is part of what is signed', () => {
    const v1 = signPayload(secret, rawBody, t).split('v1=')[1];
    expect(verify(`t=${t + 10},v1=${v1}`)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it.each([
    ['missing', undefined],
    ['missing', ''],
    ['malformed', 'v1=abc'],
    ['malformed', `t=${t}`],
    ['malformed', `t=soon,v1=${'a'.repeat(64)}`],
    ['malformed', `t=${t},v1=${'z'.repeat(64)}`],
    ['malformed', `t=${t},v1=${'a'.repeat(63)}`],
  ])('reports %s for header %j', (reason, header) => {
    expect(verify(header)).toEqual({ ok: false, reason });
  });

  it('ignores spacing and field order in the header', () => {
    const [tPart, vPart] = signPayload(secret, rawBody, t).split(',');
    expect(verify(` ${vPart} , ${tPart} `).ok).toBe(true);
  });
});
