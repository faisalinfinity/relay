---
title: SMS reminders not being delivered
category: Reminders
---

# SMS reminders not being delivered

Open the booking and look at **Messages**. Each SMS shows its delivery status and, if it failed, an error
code.

## SW-4004: invalid number

The phone number isn't a valid mobile number. The usual cause is a missing country code: numbers need to be
stored in international format, such as `+44 7700 900123` rather than `07700 900123`. Edit the client's number
and the next reminder will go through. Landlines can't receive SMS.

## SW-4010: client opted out

The client replied **STOP** to an earlier message, and we're legally required to stop texting them. Only the
client can undo this, by texting **START** to the same number. They'll still get email reminders.

## Delivered, but the client says they didn't get it

- **Carrier filtering.** Mobile carriers sometimes block messages that look like spam. Messages with URL
  shorteners (bit.ly and similar) or ALL CAPS are the most likely to be filtered. Use the
  `{reschedule_link}` placeholder rather than your own short links.
- **Country rules.** Some countries don't allow a custom sender name. Messages there arrive from a number
  instead of your studio name, and clients sometimes miss them.
- **The phone is off or out of signal.** Carriers retry for up to 48 hours.

## No SMS sent at all

- You may have run out of credits. In that case reminders fall back to email (see
  [SMS and email reminders](14-sms-and-email-reminders.md)).
- The client's number may be in a country we don't send SMS to.
- Check that an SMS reminder is actually switched on under **Settings → Notifications → Reminders**.
