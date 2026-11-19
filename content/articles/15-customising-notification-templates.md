---
title: Customising notification templates
category: Reminders
---

# Customising notification templates

Every email and SMS Slotwise sends for you can be edited under **Settings → Notifications → Templates**.

## Placeholders

Templates use placeholders in curly braces that are filled in for each booking:

| Placeholder           | Becomes                               |
| --------------------- | ------------------------------------- |
| `{client_first_name}` | The client's first name               |
| `{service_name}`      | The booked service                    |
| `{start_time}`        | Date and time of the appointment      |
| `{staff_name}`        | Who the appointment is with           |
| `{studio_name}`       | Your studio name                      |
| `{studio_address}`    | The address from Settings → Studio    |
| `{reschedule_link}`   | Link the client can use to reschedule |
| `{cancel_link}`       | Link the client can use to cancel     |

## Adding your own information

Write it straight into the template. Parking instructions, door codes, "please arrive 10 minutes early" or
what to bring all belong here. To show it for one service only, add it to that service's
**Booking instructions** field instead. It's included in the confirmation email for that service.

## SMS length

SMS templates are limited to **320 characters** after placeholders are filled in. Anything over 160
characters uses two SMS credits per message. The editor shows a live count using sample data.

## Branding

Emails use your studio logo and colour from **Settings → Studio → Branding**. On Pro you can also set
a custom _From_ name and a reply-to address.

## Preview and test

Click **Send test** to receive the message yourself before saving.
