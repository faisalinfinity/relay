---
title: Taking deposits and payments
category: Payments
---

# Taking deposits and payments

Slotwise takes card payments through **Stripe**. Money goes straight to your own Stripe account. We never
hold it.

## Connect Stripe

Go to **Settings → Payments → Connect Stripe**. You can create a new Stripe account or connect an
existing one. Stripe asks for business and bank details to verify you. Bookings can't take payments until
Stripe has finished verification.

## Choose what clients pay when booking

Per service, under **Services → (service) → Payment**:

- **No payment**: the client pays at the studio.
- **Deposit**: a fixed amount (say $20) or a percentage of the price (say 25%). The rest is paid at the
  appointment.
- **Full payment**: the whole price is charged when booking.

You can also require a card on file without charging it. That's useful for
[late cancellation fees](06-cancellation-and-rescheduling-policy.md).

## Fees

Stripe charges its normal card processing fees. Slotwise adds a platform fee on each payment:
**1% on Solo, 0.5% on Studio, and none on Pro**.

## Taking the balance at the appointment

Open the booking and click **Take payment** to charge the remaining balance to the saved card, or mark it
as paid in cash.

Problems with a payment? See [Payment errors](13-payment-errors.md).
