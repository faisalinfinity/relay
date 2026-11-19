/**
 * Sends a signed test ticket to the intake webhook, the way the website's form backend would.
 *
 *   pnpm send:ticket                         one new ticket
 *   pnpm send:ticket --twice                 the same submission twice: 201, then 200 duplicate
 *   pnpm send:ticket --bad-signature         signed with the wrong secret: 401
 *   pnpm send:ticket --subject "..." --message "..." --name "..." --email "..."
 *   pnpm send:ticket --id <submissionId>     reuse a submission id
 *   pnpm send:ticket --url http://host/webhooks/tickets
 */
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config';
import { SIGNATURE_HEADER, signPayload } from '../src/webhooks/signature';

const config = loadConfig();

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: `http://localhost:${config.port}/webhooks/tickets` },
    id: { type: 'string' },
    name: { type: 'string', default: 'Jordan Ellis' },
    email: { type: 'string', default: 'jordan@ellisyoga.example' },
    subject: { type: 'string', default: 'Reminder emails show the wrong time' },
    message: {
      type: 'string',
      default:
        'Hi! A client in New York got a reminder saying 3pm for a class that is at 3pm London time. ' +
        'Can the reminder show her own time instead?',
    },
    twice: { type: 'boolean', default: false },
    'bad-signature': { type: 'boolean', default: false },
  },
});

const body = JSON.stringify({
  submissionId: args.id ?? randomUUID(),
  name: args.name,
  email: args.email,
  subject: args.subject,
  message: args.message,
});
const secret = args['bad-signature'] ? 'definitely-not-the-shared-secret' : config.webhook.secret;

async function send(label: string) {
  const response = await fetch(args.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: signPayload(secret, body) },
    body,
  });
  console.log(`${label}: HTTP ${response.status}`);
  console.log(JSON.stringify(await response.json(), null, 2));
}

try {
  await send('Sent');
  if (args.twice) {
    // A real retry comes later and is signed again, so wait for the timestamp to move on
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await send('Resent the same submission');
  }
} catch (error) {
  console.error(`Could not reach ${args.url}. Is the API running (pnpm dev)?`);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
