---
title: Calendar sync troubleshooting
category: Calendar sync
---

# Calendar sync troubleshooting

## Error SW-1042: calendar connection expired

The calendar provider has stopped accepting our access. This happens after you change your Google or
Microsoft password, revoke Slotwise's access in your account's security settings, or (for Google Workspace)
when your admin changes app policies.

**Fix:** go to **Settings → Calendar**, click **Reconnect**, and sign in again. Sync resumes immediately and
catches up on anything missed while it was disconnected. You don't lose any bookings: they are stored in
Slotwise and are written to your calendar again on reconnect.

## Error SW-1043: calendar not found

The calendar Slotwise writes to has been deleted, or you no longer have edit access to it (common with
shared calendars). Choose a different calendar under **Settings → Calendar → Write bookings to**, or ask
the calendar's owner to restore your access.

## Bookings appear twice

Duplicates almost always mean the same calendar is receiving Slotwise bookings twice:

- Two staff members have both connected the **same** Google or Outlook calendar. Each should connect their
  own.
- You also subscribed to the Slotwise **iCal feed** in the same calendar app. Remove the iCal subscription
  once two-way sync is on.

After fixing the cause, click **Settings → Calendar → Clean up duplicates** to remove the extra copies.

## Busy times aren't blocking my booking page

Check that the calendar holding those events is ticked under **Check for busy times**. All-day events and
events marked _Free_ (rather than _Busy_) in Google or Outlook never block time.

## Changes take a while to appear

Sync runs about every two minutes. If nothing has changed after ten minutes, reconnect as described for
SW-1042.
