---
title: API keys and webhooks
category: Developers
---

# API keys and webhooks

The Slotwise API lets you connect bookings to other software. It's available on the **Pro** plan.

## API keys

Create a key under **Settings → Developers → API keys**. Keys are shown once, so store them in a password
manager or secret store. Send the key as a bearer token:

```
curl https://api.slotwise.app/v1/bookings -H "Authorization: Bearer sk_live_..."
```

Revoke a key from the same page at any time. Requests with a revoked or mistyped key get **401** with error
**SW-6401**.

## Rate limits

Each key can make **120 requests per minute**. Over that, the API answers **429 Too Many Requests** with error
**SW-6029** and a `Retry-After` header saying how many seconds to wait. If you need to sync a lot of data,
use webhooks instead of polling, or page through results with `limit=100`.

## Webhooks

Instead of polling, let Slotwise tell you when something happens. Add an endpoint URL under
**Settings → Developers → Webhooks** and choose events:

- `booking.created`, `booking.updated`, `booking.cancelled`
- `client.created`, `client.updated`
- `payment.succeeded`, `payment.refunded`

Each delivery is signed with a `Slotwise-Signature` header, an HMAC-SHA256 of the body using your endpoint's
signing secret. Check it before trusting the payload. Your endpoint should answer with a 2xx status within
10 seconds. Failed deliveries are retried up to 8 times over 24 hours, and each delivery has an `id` you can
use to ignore duplicates.
