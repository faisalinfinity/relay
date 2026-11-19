---
title: Error code reference
category: Reference
---

# Error code reference

Slotwise errors have a code like **SW-1042**. Find yours below, then follow the link for the fix.

## Calendar (SW-1xxx)

| Code    | Meaning                                               | Article                                                              |
| ------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| SW-1042 | Calendar connection expired. Reconnect your calendar. | [Calendar sync troubleshooting](09-calendar-sync-troubleshooting.md) |
| SW-1043 | Calendar not found, or edit access removed            | [Calendar sync troubleshooting](09-calendar-sync-troubleshooting.md) |

## Payments (SW-2xxx)

| Code    | Meaning                                       | Article                                |
| ------- | --------------------------------------------- | -------------------------------------- |
| SW-2210 | Client's bank declined the deposit or payment | [Payment errors](13-payment-errors.md) |
| SW-2215 | Card verification (3D Secure) not completed   | [Payment errors](13-payment-errors.md) |
| SW-2230 | Your Stripe account is restricted             | [Payment errors](13-payment-errors.md) |

## Booking page (SW-3xxx)

| Code    | Meaning                                    | Article                                           |
| ------- | ------------------------------------------ | ------------------------------------------------- |
| SW-3101 | Custom domain not verified (CNAME missing) | [Custom domain](05-booking-page-custom-domain.md) |
| SW-3102 | SSL certificate for custom domain pending  | [Custom domain](05-booking-page-custom-domain.md) |

## Messages (SW-4xxx)

| Code    | Meaning                                | Article                                      |
| ------- | -------------------------------------- | -------------------------------------------- |
| SW-4004 | Phone number invalid for SMS           | [SMS not delivered](16-sms-not-delivered.md) |
| SW-4010 | Client opted out of SMS (replied STOP) | [SMS not delivered](16-sms-not-delivered.md) |

## Imports (SW-5xxx)

| Code    | Meaning                          | Article                                      |
| ------- | -------------------------------- | -------------------------------------------- |
| SW-5001 | CSV column header not recognised | [Importing clients](19-importing-clients.md) |
| SW-5002 | CSV file too large               | [Importing clients](19-importing-clients.md) |

## API (SW-6xxx)

| Code    | Meaning                    | Article                                              |
| ------- | -------------------------- | ---------------------------------------------------- |
| SW-6029 | API rate limit exceeded    | [API keys and webhooks](24-api-keys-and-webhooks.md) |
| SW-6401 | API key invalid or revoked | [API keys and webhooks](24-api-keys-and-webhooks.md) |

Not listed here? Send us the full code and what you were doing when it appeared.
