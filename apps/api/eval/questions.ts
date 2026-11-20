/**
 * Retrieval evaluation set. Written the way customers write, not copied from the articles, so a
 * hit means the search understood the question rather than matched a phrase.
 *
 * `expect` is the one article that answers it. Some questions also brush against other articles
 * (an error code is always listed in the error-code reference too). That's deliberate: the right
 * article has to beat a plausible neighbour.
 */
export interface CoveredQuestion {
  subject: string;
  message: string;
  expect: string;
}

export const covered: CoveredQuestion[] = [
  {
    subject: 'Nothing is syncing',
    message:
      'I changed my Google password yesterday and now new bookings do not show up in my calendar. There is a red banner that says SW-1042.',
    expect: 'calendar-sync-troubleshooting',
  },
  {
    subject: 'Calendar connect blocked',
    message:
      'Our clinic uses Microsoft 365. When I try to connect my calendar it says an administrator has to approve it. I am not the admin.',
    expect: 'connecting-outlook-calendar',
  },
  {
    subject: 'Refund timing',
    message:
      'I refunded a client on Monday and she says the money is still not on her card. How long does it usually take?',
    expect: 'refunding-a-client',
  },
  {
    subject: 'Booking on my own website',
    message: 'My website is built with Wix. Where exactly do I paste the Slotwise booking code?',
    expect: 'embedding-the-booking-widget',
  },
  {
    subject: 'Stopping my subscription',
    message:
      'If I stop paying for Slotwise at the end of the month, what happens to my client list and booking history?',
    expect: 'changing-or-cancelling-your-plan',
  },
  {
    subject: 'Receptionist access',
    message:
      'Our receptionist needs to book appointments for all the stylists, but she should not see revenue reports or give refunds. Which access level?',
    expect: 'staff-accounts-and-roles',
  },
  {
    subject: 'API errors',
    message:
      'Our nightly script that copies bookings into our member system keeps failing with HTTP 429 and SW-6029. What is the limit?',
    expect: 'api-keys-and-webhooks',
  },
  {
    subject: 'Texts failing',
    message:
      'Some customers never get the reminder text. In the booking it shows SW-4004. They are all customers I imported from a spreadsheet.',
    expect: 'sms-not-delivered',
  },
  {
    subject: 'Pay in advance',
    message:
      'For bridal packages I want customers to pay the whole price when they book, not just a deposit. Can I do that for one service only?',
    expect: 'taking-deposits-and-payments',
  },
  {
    subject: 'Wrong hour in reminders',
    message:
      'I teach online from Lisbon and my students in New York say the reminder email shows my time, not theirs. Can it show their time?',
    expect: 'time-zones',
  },
  {
    subject: 'Going on holiday',
    message:
      'I am away for two weeks in August. How do I stop people booking during that time without deleting my normal opening hours?',
    expect: 'business-hours-and-time-off',
  },
  {
    subject: 'Spreadsheet upload fails',
    message:
      'Uploading my client list from Excel fails straight away. It complains about the column called "First Name".',
    expect: 'importing-clients',
  },
];

/** Things no article covers. The right answer is "no article covers this". */
export const uncovered: Array<{ subject: string; message: string }> = [
  {
    subject: 'Zoom links',
    message: 'Can Slotwise create a Zoom meeting link automatically for my online sessions?',
  },
  { subject: 'Gift cards', message: 'Can I sell gift cards for massages through my booking page?' },
  {
    subject: 'HIPAA',
    message: 'Will you sign a HIPAA business associate agreement for my therapy practice?',
  },
  { subject: 'Crypto', message: 'Can my clients pay their deposit in Bitcoin?' },
  {
    subject: 'Waitlist',
    message: 'When a class is full, can people join a waitlist and get notified if a spot opens?',
  },
  {
    subject: 'Data location',
    message: 'Where are your servers? We need our client data stored inside the EU.',
  },
];
