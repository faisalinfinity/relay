---
title: When payouts reach your bank
category: Payments
---

# When payouts reach your bank

Payments from clients go to your Stripe account, and **Stripe** pays them out to your bank. Slotwise doesn't
hold or delay your money, so payout timing is set by Stripe.

## Your first payout

Stripe holds the very first payout on a new account for **7 to 14 days** while it finishes its checks. This is
normal and only happens once. Bookings and payments carry on as usual in the meantime.

## After that

Stripe pays out on a rolling schedule. In the US that is usually **2 business days** after the payment; in
the UK and EU it is usually **3 business days**. Weekends and bank holidays add to this.

## Changing the schedule

You can switch to weekly or monthly payouts, or change the bank account, in your **Stripe dashboard →
Settings → Payouts**. These settings aren't in Slotwise because they belong to your Stripe account.

## Seeing what was paid out

**Reports → Payments** lists every client payment with its Stripe payout date. The amount that lands in your
bank is the payment minus Stripe's fee and the Slotwise platform fee (see
[Taking deposits and payments](10-taking-deposits-and-payments.md)).

## A payout is late or missing

Check the Stripe dashboard first: Stripe shows the reason there, most often missing verification details.
If Stripe has _restricted_ your account, Slotwise shows error **SW-2230**. See
[Payment errors](13-payment-errors.md).
