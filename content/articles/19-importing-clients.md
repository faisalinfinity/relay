---
title: Importing clients from a spreadsheet
category: Clients
---

# Importing clients from a spreadsheet

Moving from another tool or a spreadsheet? Import your client list as a CSV file.

## Prepare the file

The first row must contain column headers. Slotwise recognises these:

| Header       | Required                            |
| ------------ | ----------------------------------- |
| `first_name` | yes                                 |
| `last_name`  | no                                  |
| `email`      | one of email or phone               |
| `phone`      | one of email or phone               |
| `notes`      | no                                  |
| `tags`       | no (separate several tags with `;`) |

Phone numbers should include the country code (`+1 415 555 0100`). Otherwise SMS reminders will fail
later (see [SMS not delivered](16-sms-not-delivered.md)).

Save the file as **CSV UTF-8**. In Excel that is _File → Save As → CSV UTF-8 (Comma delimited)_. Other
encodings garble accented names.

## Import

Go to **Clients → Import**, choose the file, check the preview of the first rows, and click **Import**.
Clients whose email already exists in Slotwise are **updated**, not duplicated.

## Limits

One file can hold up to **10,000 rows** and **5 MB**. Split bigger lists into several files.

## Errors

- **SW-5001 (header not recognised)**: one of the column headers doesn't match the list above. The error
  names the column. Rename it, for example `First Name` → `first_name`, or delete the column.
- **SW-5002 (file too large)**: more than 10,000 rows or 5 MB. Split the file.
- **Rows skipped**: a row with no first name, or with neither email nor phone, is skipped. After import you
  can download a CSV of skipped rows with the reason for each.
