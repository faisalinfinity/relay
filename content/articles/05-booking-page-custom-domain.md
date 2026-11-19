---
title: Using your own domain for the booking page
category: Booking page
---

# Using your own domain for the booking page

On the **Pro** plan your booking page can live on your own domain, for example `book.yourstudio.com`,
instead of `book.slotwise.app/your-studio`.

## Set it up

1. In **Settings → Booking page → Custom domain**, enter the domain you want to use. It must be a
   subdomain (`book.yourstudio.com`), not the bare domain (`yourstudio.com`).
2. At your DNS provider, add a **CNAME** record pointing that subdomain to `domains.slotwise.app`.
3. Back in Slotwise, click **Verify**.

DNS changes usually show up within an hour. Once the domain is verified we issue an SSL certificate
automatically, which can take up to 24 hours.

## Errors

- **SW-3101 (domain not verified)**: we can't see the CNAME record yet. Check for typos, make sure the
  record is a CNAME and not an A record, and wait an hour before trying again.
- **SW-3102 (certificate pending)**: the domain is verified but the SSL certificate isn't ready. This clears
  on its own within 24 hours. Visitors see a browser warning until then.

## Cloudflare

If your DNS is on Cloudflare, set the record to **DNS only** (grey cloud), not **Proxied**. With the proxy
on, we can't issue the certificate and the domain stays stuck on SW-3102.
