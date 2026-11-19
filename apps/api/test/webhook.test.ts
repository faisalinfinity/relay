import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { messages, tickets } from '../src/db/schema';
import { SIGNATURE_HEADER, signPayload } from '../src/webhooks/signature';
import { call, resetDb, startTestServer, WEBHOOK_SECRET, type TestServer } from './helpers';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await resetDb(server.db);
});

function submission(overrides: Record<string, unknown> = {}) {
  return {
    submissionId: randomUUID(),
    name: 'Priya Shah',
    email: 'priya@lotusyoga.example',
    subject: 'Google Calendar stopped syncing',
    message: 'Since yesterday new bookings are not showing in my Google Calendar. I see SW-1042.',
    ...overrides,
  };
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function send(rawBody: string, signature: string | null, contentType = 'application/json') {
  const headers: Record<string, string> = { 'content-type': contentType };
  if (signature !== null) headers[SIGNATURE_HEADER] = signature;
  return call(server, 'POST', '/webhooks/tickets', { rawBody, headers });
}

const sendSigned = (rawBody: string, timestamp = nowSeconds()) =>
  send(rawBody, signPayload(WEBHOOK_SECRET, rawBody, timestamp));

async function ticketCount() {
  return (await server.db.select({ id: tickets.id }).from(tickets)).length;
}

describe('POST /webhooks/tickets', () => {
  it('creates a ticket with the customer message as its first message', async () => {
    const payload = submission();
    const res = await sendSigned(JSON.stringify(payload));

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ number: 1001, duplicate: false });

    const detail = await call(server, 'GET', `/api/tickets/${res.body.data.ticketId}`);
    expect(detail.body.data).toMatchObject({
      subject: payload.subject,
      status: 'open',
      owner: null,
      customer: { name: payload.name, email: payload.email },
    });
    expect(detail.body.data.messages).toMatchObject([
      { authorType: 'customer', agent: null, body: payload.message },
    ]);
  });

  it('treats a resend of the same submission as the same ticket', async () => {
    const body = JSON.stringify(submission());
    const first = await sendSigned(body, nowSeconds() - 5);
    // The form backend retries later, so the retry carries a fresh timestamp and signature
    const retry = await sendSigned(body, nowSeconds());

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.data).toEqual({ ...first.body.data, duplicate: true });
    expect(await ticketCount()).toBe(1);
  });

  it('still creates one ticket when copies of a submission arrive at the same moment', async () => {
    const body = JSON.stringify(submission());
    const results = await Promise.all(Array.from({ length: 5 }, () => sendSigned(body)));

    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body.data.ticketId)).size).toBe(1);
    expect(await ticketCount()).toBe(1);
    expect(await server.db.select().from(messages)).toHaveLength(1);
  });

  it('rejects the same submissionId arriving with different content', async () => {
    const payload = submission();
    await sendSigned(JSON.stringify(payload));
    const res = await sendSigned(
      JSON.stringify({ ...payload, message: 'Something else entirely' }),
    );

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SUBMISSION_CONFLICT');
    expect(await ticketCount()).toBe(1);
  });

  it('accepts a different submission with identical text as a new ticket', async () => {
    const payload = submission();
    await sendSigned(JSON.stringify(payload));
    const res = await sendSigned(JSON.stringify({ ...payload, submissionId: randomUUID() }));

    expect(res.status).toBe(201);
    expect(await ticketCount()).toBe(2);
  });

  describe('signature checks', () => {
    const body = JSON.stringify(submission());

    it.each([
      ['no signature header', () => send(body, null), /Missing the X-Relay-Signature header/],
      ['a garbled header', () => send(body, 'sha256=abc'), /must look like t=/],
      [
        'the wrong secret',
        () => send(body, signPayload('not-the-shared-secret', body)),
        /does not match/,
      ],
      [
        'a body changed after signing',
        () => send(body.replace('Priya', 'Mallory'), signPayload(WEBHOOK_SECRET, body)),
        /does not match/,
      ],
      ['a timestamp older than the window', () => sendSigned(body, nowSeconds() - 301), /300s/],
      ['a timestamp too far in the future', () => sendSigned(body, nowSeconds() + 301), /300s/],
    ])('rejects %s with 401 and creates nothing', async (_label, request, message) => {
      const res = await request();

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
      expect(res.body.error.message).toMatch(message);
      expect(await ticketCount()).toBe(0);
    });
  });

  it('validates the payload after the signature, listing each bad field', async () => {
    const res = await sendSigned(
      JSON.stringify(submission({ email: 'not-an-email', subject: '' })),
    );

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'email',
      'subject',
    ]);
  });

  it('rejects a signed body that is not JSON', async () => {
    const res = await sendSigned('{"submissionId": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('rejects a non-JSON content type', async () => {
    const body = 'name=Priya';
    const res = await send(
      body,
      signPayload(WEBHOOK_SECRET, body),
      'application/x-www-form-urlencoded',
    );
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('stores the submission id so the ticket can be traced back to the form', async () => {
    const payload = submission();
    await sendSigned(JSON.stringify(payload));
    const [row] = await server.db
      .select()
      .from(tickets)
      .where(eq(tickets.externalId, payload.submissionId));
    expect(row).toMatchObject({ source: 'web_form', externalId: payload.submissionId });
  });
});
