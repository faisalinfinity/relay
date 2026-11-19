---
title: Payment errors and what they mean
category: Payments
---

# Payment errors and what they mean

## SW-2210: deposit declined

The client's bank declined the charge. Slotwise can't see the bank's exact reason. The most common ones
are insufficient funds, a card that has expired, or the bank's fraud checks.

What to tell the client: try again with a different card, or call their bank to approve the payment. Their
booking is held for **15 minutes** while they retry; after that the slot is released.

## SW-2215: card needs authentication

The client's bank asked for extra verification (3D Secure, usually a code by text or in the banking app),
and it wasn't completed. This often happens when the client closes the pop-up or the banking app times out.
Ask the client to book again and finish the verification step. Nothing was charged.

## SW-2230: Stripe account restricted

Stripe has paused payments or payouts on **your** account, usually because it needs more verification
information. Until it's fixed, services that require payment can't be booked. Log in to your **Stripe
dashboard**, where Stripe lists exactly what it needs. Once Stripe lifts the restriction, Slotwise picks it
up within a few minutes.

## "Payments not set up" on the booking page

The service requires a deposit or full payment but no Stripe account is connected. Connect one under
**Settings → Payments**, or set the service to _No payment_.

## A client was charged twice

Check **Reports → Payments**. Usually the client made two bookings, for example once on the widget and once by
phone, and both took a deposit. Cancel the extra booking and [refund it](12-refunding-a-client.md). If you
really see two charges for one booking, contact us with the booking reference.
