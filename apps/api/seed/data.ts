export const seedAgents = [
  { key: 'asha', name: 'Asha Rao', email: 'asha@slotwise.example' },
  { key: 'ben', name: 'Ben Okafor', email: 'ben@slotwise.example' },
  { key: 'carmen', name: 'Carmen Diaz', email: 'carmen@slotwise.example' },
  { key: 'dev', name: 'Dev Malhotra', email: 'dev@slotwise.example' },
] as const;

export type AgentKey = (typeof seedAgents)[number]['key'];

export interface SeedTicket {
  subject: string;
  name: string;
  email: string;
  /** when the customer wrote in */
  hoursAgo: number;
  message: string;
  owner?: AgentKey;
  closed?: boolean;
  /** later messages in the thread, by the customer or an agent */
  followUps?: Array<{ by: 'customer' | AgentKey; hoursLater: number; body: string }>;
}

/**
 * 30 tickets for Slotwise. The first 24 are answered somewhere in content/articles.
 * The last 6 (marked) ask about things no article covers, to test that suggested
 * replies say so instead of inventing an answer.
 */
export const seedTickets: SeedTicket[] = [
  {
    subject: 'Google calendar not syncing anymore - SW-1042',
    name: 'Maya Lindqvist',
    email: 'maya@lotusflowyoga.example',
    hoursAgo: 2,
    message:
      "Hi, since this morning none of my new bookings are showing up in Google Calendar and there's a red banner in Slotwise saying SW-1042. I changed my Google password yesterday if that matters. I have 6 classes booked tomorrow, please help!",
  },
  {
    subject: 'Outlook says I need admin approval',
    name: 'Tom Becker',
    email: 'tom@beckerphysio.example',
    hoursAgo: 5,
    message:
      'Trying to connect my work Outlook calendar (we use Microsoft 365 at the clinic). After I log in it shows "Need admin approval" and I can\'t go any further. I\'m not the IT person. What do I do?',
  },
  {
    subject: 'Client keeps getting SW-2210 when paying deposit',
    name: 'Aisha Bello',
    email: 'aisha@glowbeautybar.example',
    hoursAgo: 1,
    owner: 'ben',
    message:
      'One of my regulars has tried to book a facial three times tonight and every time the deposit fails with SW-2210. She says her card works everywhere else. Is something wrong on your side?',
  },
  {
    subject: 'When do I actually get paid??',
    name: 'Lucas Moreau',
    email: 'lucas@moreaututoring.example',
    hoursAgo: 26,
    owner: 'carmen',
    closed: true,
    message:
      'I connected Stripe last week and clients have paid for 9 lessons already but nothing has arrived in my bank account. Where is my money?',
    followUps: [
      {
        by: 'carmen',
        hoursLater: 1,
        body: "Hi Lucas, your money is safe in your Stripe account. Stripe holds the very first payout on a new account for 7 to 14 days while it finishes its checks. After that, payouts arrive on a rolling schedule, usually a couple of business days after each payment. You can see the expected date in your Stripe dashboard under Payouts. Let me know if it hasn't arrived by the end of next week!",
      },
      { by: 'customer', hoursLater: 3, body: 'Ah ok that makes sense, thanks Carmen.' },
    ],
  },
  {
    subject: 'How do I refund someone',
    name: 'Hannah Kim',
    email: 'hannah@kimnails.example',
    hoursAgo: 8,
    message:
      "A client cancelled because she's moving away and I'd like to give her deposit back. I cancelled the booking but she says she hasn't got anything back. How do I do the refund?",
  },
  {
    subject: 'Booking widget not showing on Squarespace',
    name: 'Olivia Grant',
    email: 'olivia@grantpilates.example',
    hoursAgo: 30,
    owner: 'asha',
    message:
      "I pasted the embed code into a Code block on my Squarespace site and the page is just blank where the widget should be. I'm on the Squarespace Personal plan if that matters. Screenshot attached (well, I tried to attach it).",
  },
  {
    subject: 'Custom domain stuck on SW-3101',
    name: 'Rafael Souza',
    email: 'rafael@souzabarber.example',
    hoursAgo: 50,
    message:
      'Set up book.souzabarber.com yesterday, added the DNS record at GoDaddy, but Slotwise still says SW-3101 domain not verified. I added an A record pointing to the IP I got from pinging domains.slotwise.app. What am I missing?',
  },
  {
    subject: 'Clients see the wrong time',
    name: 'Inês Carvalho',
    email: 'ines@lisbonlanguagelab.example',
    hoursAgo: 12,
    message:
      "I teach Portuguese online from Lisbon and most of my students are in the UK and the US. Some of them say the time in the reminder email is different from what they booked. Which time zone do the emails use? Can I make them show the student's own time?",
  },
  {
    subject: 'SMS reminders not arriving for some clients',
    name: "Grace O'Neill",
    email: 'grace@oneillstudio.example',
    hoursAgo: 20,
    message:
      'About a third of my clients say they never get the text reminder. When I look at their bookings some messages say SW-4004. Most of my clients are in Dublin and I imported them from my old spreadsheet.',
  },
  {
    subject: 'Add parking info to the reminder email',
    name: 'Daniel Weiss',
    email: 'dan@weissmassage.example',
    hoursAgo: 72,
    owner: 'asha',
    closed: true,
    message:
      'New clients keep getting lost looking for parking. Can I add parking instructions to the confirmation or reminder email? Only for my city centre location, the other one is fine.',
    followUps: [
      {
        by: 'asha',
        hoursLater: 2,
        body: "Hi Daniel! The easiest way to show it for one location only is the Booking instructions field on each service (Services → your service → Booking instructions). Whatever you put there is added to the confirmation email for that service. If you'd rather it went in every email, edit the template under Settings → Notifications → Templates.",
      },
    ],
  },
  {
    subject: 'New stylist should only see her own clients',
    name: 'Priya Nair',
    email: 'priya@nairhairco.example',
    hoursAgo: 4,
    message:
      "I'm adding a new stylist who starts Monday. She should see her own appointments and her own clients but not everyone else's, and definitely not our revenue. How do I set that up?",
  },
  {
    subject: 'URGENT locked out, lost my phone',
    name: 'Marcus Hale',
    email: 'marcus@halefitness.example',
    hoursAgo: 0.5,
    message:
      "My phone got stolen at the gym and the authenticator app was on it. I'm the owner of the account and I never saved those backup codes. I can't log in and I have a full day of PT sessions tomorrow. Can you just turn off the 2FA for me please??",
  },
  {
    subject: 'Import fails with SW-5001',
    name: 'Sofia Rossi',
    email: 'sofia@rossiwellness.example',
    hoursAgo: 15,
    owner: 'dev',
    message:
      'Trying to import my 2,000 clients from Excel and it fails straight away with SW-5001. The file opens fine in Excel.',
    followUps: [
      {
        by: 'dev',
        hoursLater: 1,
        body: "Hi Sofia, SW-5001 means one of the column headers isn't one we recognise. Could you send me the exact first row of the file?",
      },
      {
        by: 'customer',
        hoursLater: 2,
        body: 'Sure: First Name, Last Name, Email, Mobile, Notes',
      },
    ],
  },
  {
    subject: 'Need all my payment data for my accountant',
    name: 'Ethan Brooks',
    email: 'ethan@brookstutors.example',
    hoursAgo: 40,
    message:
      'Tax season. My accountant wants every payment and refund from last year, plus what fees I paid. Is there a way to get that out of Slotwise in one go?',
  },
  {
    subject: 'Studio vs Pro?',
    name: 'Chloé Martin',
    email: 'chloe@martindance.example',
    hoursAgo: 60,
    owner: 'ben',
    closed: true,
    message:
      "We're a dance school with 6 teachers. Trying to decide between Studio and Pro. What do we actually get for the extra $50?",
    followUps: [
      {
        by: 'ben',
        hoursLater: 4,
        body: 'Hi Chloé! With 6 teachers both plans fit. Pro adds a custom domain for your booking page, API access and webhooks, a custom email sender name, priority support and no platform fee on payments (Studio has 0.5%). If you take a lot of payments online, the fee saving can cover the difference on its own. Happy to run the numbers with you.',
      },
    ],
  },
  {
    subject: 'If I downgrade do I lose my data',
    name: 'Noah Fischer',
    email: 'noah@fischerclimbing.example',
    hoursAgo: 18,
    message:
      'Winter is quiet for us so I want to drop from Pro to Studio. Will I lose my clients or booking history? And what happens to my custom domain?',
  },
  {
    subject: 'Invoice with VAT number',
    name: 'Emma Janssen',
    email: 'emma@janssenyoga.example',
    hoursAgo: 33,
    message:
      'Hello, I need my Slotwise invoices for this year to show my company name and Dutch VAT number, otherwise my bookkeeper cannot use them. Can you resend them?',
  },
  {
    subject: 'API returning 429 SW-6029',
    name: 'Kenji Watanabe',
    email: 'kenji@watanabe-dojo.example',
    hoursAgo: 6,
    message:
      'I wrote a small script that pulls all our bookings into our member database every few minutes. Since we passed ~3,000 bookings it fails with HTTP 429 and SW-6029. Can you raise our limit?',
  },
  {
    subject: 'Can I charge clients who cancel last minute?',
    name: 'Zara Ahmed',
    email: 'zara@zarabrows.example',
    hoursAgo: 22,
    message:
      "I've had 4 people cancel less than an hour before this week. Is there a way to charge a fee for late cancellations? I don't take deposits at the moment.",
  },
  {
    subject: 'Block off two weeks for holiday',
    name: 'Liam Murphy',
    email: 'liam@murphyguitar.example',
    hoursAgo: 9,
    message:
      "I'm away 1-14 August. How do I stop people booking lessons during that time without deleting my normal hours?",
  },
  {
    subject: 'Gap between massage appointments',
    name: 'Ana Petrova',
    email: 'ana@petrovaspa.example',
    hoursAgo: 45,
    owner: 'dev',
    closed: true,
    message:
      "I need 15 minutes between massages to change the sheets but I don't want clients to see 75 minute appointments. Possible?",
    followUps: [
      {
        by: 'dev',
        hoursLater: 1,
        body: 'Yes! Open the service under Services and set a 15-minute buffer after it. Clients still see a 60-minute massage, but the calendar keeps the 15 minutes after each one free.',
      },
    ],
  },
  {
    subject: 'Every booking shows up twice in Google Calendar',
    name: 'Jake Turner',
    email: 'jake@turnerphotostudio.example',
    hoursAgo: 14,
    message:
      'Since last week every Slotwise booking appears twice in my Google Calendar. A while back I added the Slotwise calendar feed link to Google, and last week I turned on the new Google sync. Related?',
  },
  {
    subject: 'Take full payment when booking',
    name: 'Fatima Zahra',
    email: 'fatima@henna-house.example',
    hoursAgo: 28,
    message:
      'Right now clients pay a 20% deposit. For bridal henna I want the full amount paid upfront when they book. Can I do that for just that one service?',
  },
  {
    subject: "Personal events aren't blocking my booking page",
    name: 'Samuel Carter',
    email: 'sam@cartercoaching.example',
    hoursAgo: 3,
    owner: 'carmen',
    message:
      "I connected Google Calendar and Slotwise bookings show up there fine. But a client just booked over my kid's school play, which is in my Family calendar. Why didn't it block that time?",
  },

  // ---- Not covered by any help article ----
  {
    subject: 'Do you sign a HIPAA BAA?',
    name: 'Rachel Stein',
    email: 'rachel@steincounseling.example',
    hoursAgo: 7,
    message:
      'I run a small counselling practice in Oregon. Before I put client names and session notes into Slotwise I need a signed Business Associate Agreement under HIPAA. Do you offer one, and on which plan?',
  },
  {
    subject: 'Can clients pay with crypto?',
    name: 'Viktor Novak',
    email: 'viktor@novaktattoo.example',
    hoursAgo: 11,
    message:
      'A lot of my tattoo clients ask to pay deposits in Bitcoin or USDC. Can Slotwise accept crypto, or connect to something like Coinbase Commerce?',
  },
  {
    subject: 'Android app that works offline?',
    name: 'Meera Iyer',
    email: 'meera@iyermusic.example',
    hoursAgo: 19,
    message:
      "Our music school is in a basement with almost no signal. Is there an Android app for teachers that shows the day's schedule offline and syncs later?",
  },
  {
    subject: 'Moving from Mindbody - future appointments and memberships',
    name: 'Claire Dubois',
    email: 'claire@duboisbarre.example',
    hoursAgo: 36,
    message:
      "We're switching from Mindbody. Can you bring over our future class bookings and our members' remaining class credits, not just the client list? We have about 400 active members.",
  },
  {
    subject: 'Selling class packs',
    name: 'Tariq Hassan',
    email: 'tariq@hassanboxing.example',
    hoursAgo: 52,
    owner: 'asha',
    message:
      'Can I sell a 10-class pack that clients pay for once and then use for bookings over 3 months? Or a monthly unlimited membership?',
  },
  {
    subject: 'QuickBooks or Xero integration?',
    name: 'Lena Schmidt',
    email: 'lena@schmidtphysio.example',
    hoursAgo: 80,
    owner: 'carmen',
    closed: true,
    message: 'Does Slotwise sync payments into Xero automatically? Or QuickBooks?',
    followUps: [
      {
        by: 'carmen',
        hoursLater: 5,
        body: "Hi Lena, there's no direct Xero or QuickBooks integration today. Many studios export Reports → Payments as CSV each month and import that. I've passed your request on to the product team.",
      },
    ],
  },
];
