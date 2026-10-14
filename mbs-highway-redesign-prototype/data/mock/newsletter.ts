/**
 * DEMO DATA — weekly client newsletter issues. Original synthetic copy written for the
 * prototype; market commentary is illustrative, not real reporting.
 */

export interface NewsletterIssue {
  id: string;
  /** Week-of date, ISO. */
  date: string;
  title: string;
  preheader: string;
  lead: { heading: string; paragraphs: string[] };
  quickHits: { title: string; body: string }[];
  familyHack: { title: string; body: string; steps?: string[] };
  whatToWatch: { day: string; event: string; why: string }[];
}

export const NEWSLETTER_ISSUES: NewsletterIssue[] = [
  {
    id: '2026-10-05',
    date: '2026-10-05',
    title: 'Fed Minutes, Home Prices and Market Volatility',
    preheader: 'What the Fed’s notes reveal, why home prices keep climbing, and how to think about a choppy week.',
    lead: {
      heading: 'Fed Minutes',
      paragraphs: [
        'The minutes from the Federal Reserve’s latest meeting landed this week, and the takeaway was patience. Policymakers acknowledged that inflation has cooled from its peak but said they want to see several more months of steady progress before changing course.',
        'Remember that the Fed does not set mortgage rates directly. Mortgage rates follow mortgage-backed securities, which react to inflation data and economic surprises. The minutes did not contain a major surprise, so the bond market took them largely in stride.',
        'The practical message for buyers and homeowners: expect normal day-to-day swings rather than a dramatic move in either direction. Having your financing plan ready lets you act on the good days.',
      ],
    },
    quickHits: [
      { title: 'Home prices set another record', body: 'The latest national index showed prices up again year over year, extending a long streak of gains as inventory remains below pre-pandemic norms.' },
      { title: 'Inventory is slowly improving', body: 'Active listings are higher than a year ago in most metro areas, giving buyers a bit more choice and a little more negotiating room.' },
      { title: 'Bond market volatility picked up', body: 'Mixed economic data pushed yields around mid-week. Mortgage rates moved within a modest range, but day-to-day pricing changed several times.' },
      { title: 'Builders are offering incentives', body: 'Many new-construction builders are using rate buydowns and closing-cost credits to keep sales moving — worth asking about if you are shopping new homes.' },
    ],
    familyHack: {
      title: 'The 10-minute fall money reset',
      body: 'Before the holidays arrive, take ten minutes as a family to set yourselves up for a calmer season.',
      steps: ['Cancel one subscription nobody has used in 60 days.', 'Set a firm holiday gift budget and write it on the fridge.', 'Move a small automatic transfer into savings the day after each payday.', 'Pull your free credit reports and check for anything unfamiliar.'],
    },
    whatToWatch: [
      { day: 'Tue', event: 'Consumer inflation (CPI)', why: 'The biggest number of the week for mortgage rates — a cool reading tends to help.' },
      { day: 'Wed', event: 'Producer prices (PPI)', why: 'Wholesale inflation can foreshadow what consumers pay later.' },
      { day: 'Thu', event: 'Retail sales + jobless claims', why: 'Shows how strong the consumer is heading into the holidays.' },
      { day: 'Fri', event: 'Consumer sentiment', why: 'Includes inflation expectations, which the Fed watches closely.' },
    ],
  },
  {
    id: '2026-09-28',
    date: '2026-09-28',
    title: 'Jobs Data, Rate Dips and the Fall Buying Window',
    preheader: 'A softer labor picture helped rates, and fall may be the quietest time to buy.',
    lead: {
      heading: 'Labor Market Check-In',
      paragraphs: [
        'Hiring slowed a bit last month while wage growth held steady — a combination bond investors liked. Mortgage rates dipped modestly in response.',
        'A gradually cooling job market without a sharp rise in layoffs is the kind of “soft landing” that can let inflation keep easing.',
      ],
    },
    quickHits: [
      { title: 'Fall can favor buyers', body: 'Fewer buyers shop after school starts, which can mean less competition and more motivated sellers.' },
      { title: 'Pending sales ticked up', body: 'Contract signings improved as rates eased, a sign that buyers respond quickly to small rate moves.' },
      { title: 'Refinance applications rose', body: 'Homeowners who bought at the highest rates are watching closely for opportunities.' },
    ],
    familyHack: { title: 'Create a “house fund” sinking account', body: 'Set aside 1% of your home’s value each year for maintenance. Splitting it into a monthly transfer keeps big repairs from becoming emergencies.' },
    whatToWatch: [
      { day: 'Mon', event: 'Manufacturing survey', why: 'An early read on business activity.' },
      { day: 'Wed', event: 'Private payrolls', why: 'A preview of Friday’s jobs report.' },
      { day: 'Fri', event: 'Monthly jobs report', why: 'Often the most market-moving release of the month.' },
    ],
  },
  {
    id: '2026-09-21',
    date: '2026-09-21',
    title: 'Fed Decision Recap and What It Means for You',
    preheader: 'The Fed held steady. Here’s why mortgage rates didn’t move the way headlines suggested.',
    lead: {
      heading: 'The Fed Held Steady',
      paragraphs: [
        'As expected, the Fed left its policy rate unchanged. The statement noted continued progress on inflation and a labor market that is “gradually rebalancing.”',
        'Mortgage rates had already priced in this outcome, which is why the decision itself barely moved them. The forward guidance matters more than the decision.',
      ],
    },
    quickHits: [
      { title: 'Rates vs. the Fed', body: 'A Fed cut doesn’t guarantee lower mortgage rates — inflation expectations matter more.' },
      { title: 'Existing-home sales steady', body: 'Sales held near last month’s pace while the median price stayed near record territory.' },
      { title: 'Rents are flattening', body: 'Rent growth has slowed in many markets, but the long-run trend still favors owners on a fixed payment.' },
    ],
    familyHack: { title: 'Teach kids the “three jars” method', body: 'Spend, save and share jars make money visible for younger kids. Match a portion of the save jar to show how saving grows.' },
    whatToWatch: [
      { day: 'Tue', event: 'Home price index', why: 'Shows how much equity homeowners gained.' },
      { day: 'Thu', event: 'GDP (final read)', why: 'A backward look at economic growth.' },
      { day: 'Fri', event: 'PCE inflation', why: 'The Fed’s preferred inflation gauge.' },
    ],
  },
  {
    id: '2026-09-14',
    date: '2026-09-14',
    title: 'Inflation Cools, Bonds Rally',
    preheader: 'A cooler inflation report gave mortgage bonds a lift.',
    lead: {
      heading: 'A Welcome Inflation Report',
      paragraphs: [
        'Consumer inflation came in a touch cooler than forecasts, with shelter costs continuing their slow decline. Bonds rallied and mortgage rates improved.',
        'One report doesn’t make a trend, but the direction is encouraging for anyone planning to buy or refinance in the months ahead.',
      ],
    },
    quickHits: [
      { title: 'Shelter inflation easing', body: 'Housing costs in the inflation data lag real-world rents, so further cooling is likely.' },
      { title: 'Builder confidence improved', body: 'Lower rates and steady demand lifted homebuilder sentiment for the first time in months.' },
      { title: 'Buying power got a boost', body: 'Every quarter-point drop in rate adds meaningful buying power for the same monthly payment.' },
    ],
    familyHack: { title: 'Batch-cook Sundays', body: 'Cooking two big meals on Sunday can cut weeknight takeout — and the savings can go straight to your down payment fund.' },
    whatToWatch: [
      { day: 'Tue', event: 'Retail sales', why: 'Consumer spending drives most of the economy.' },
      { day: 'Wed', event: 'Housing starts', why: 'New supply is key to cooling home prices.' },
      { day: 'Thu', event: 'Jobless claims', why: 'A weekly pulse on layoffs.' },
    ],
  },
  {
    id: '2026-09-07',
    date: '2026-09-07',
    title: 'Back-to-School Market Update',
    preheader: 'Summer’s over — here’s where the housing market stands.',
    lead: {
      heading: 'Summer in Review',
      paragraphs: [
        'The summer market was steady rather than spectacular. Prices held firm, inventory improved and rates moved within a fairly narrow range.',
        'Heading into fall, buyers who are pre-approved and ready will have the best shot at the homes that fit them.',
      ],
    },
    quickHits: [
      { title: 'Days on market rose slightly', body: 'Homes are taking a few more days to sell, giving buyers more time to decide.' },
      { title: 'Price cuts are more common', body: 'More sellers adjusted asking prices over the summer — a sign of a more balanced market.' },
      { title: 'Equity remains near record', body: 'Homeowners still hold historically high equity, which supports a stable market.' },
    ],
    familyHack: { title: 'The school-year command center', body: 'A single wall calendar with bills, practices and due dates reduces late fees and last-minute stress.' },
    whatToWatch: [
      { day: 'Wed', event: 'Fed Beige Book', why: 'Regional color on the economy.' },
      { day: 'Fri', event: 'Consumer credit', why: 'How much households are borrowing.' },
    ],
  },
  {
    id: '2026-08-31',
    date: '2026-08-31',
    title: 'Equity Is Your Hidden Asset',
    preheader: 'Homeowners are sitting on more wealth than ever. Here’s how to think about it.',
    lead: {
      heading: 'Record Home Equity',
      paragraphs: [
        'Thanks to years of appreciation, the typical homeowner has more equity than at almost any time in history.',
        'That equity can support a move-up purchase, consolidate higher-interest debt or simply provide a cushion. The key is using it intentionally.',
      ],
    },
    quickHits: [
      { title: 'PMI removal opportunity', body: 'Rising values mean many homeowners can request mortgage insurance removal sooner than scheduled.' },
      { title: 'Second homes cooling', body: 'Demand for vacation homes has eased from its peak.' },
      { title: 'Credit card rates still high', body: 'Average card rates remain above 20%, making debt consolidation worth reviewing.' },
    ],
    familyHack: { title: 'Annual “home value” check', body: 'Look up your home’s estimated value once a year and compare it to your loan balance. Knowing your equity helps with every big decision.' },
    whatToWatch: [
      { day: 'Tue', event: 'Job openings (JOLTS)', why: 'Labor demand signal.' },
      { day: 'Fri', event: 'Monthly jobs report', why: 'Sets the tone for rates into September.' },
    ],
  },
  {
    id: '2026-08-24',
    date: '2026-08-24',
    title: 'Why Waiting Can Cost More Than You Think',
    preheader: 'Higher prices can outweigh a lower rate. Here’s the math in plain English.',
    lead: {
      heading: 'The Cost of Waiting',
      paragraphs: [
        'Many buyers are waiting for lower rates. But if prices keep rising while you wait, the home can cost more even if the rate improves.',
        'You can refinance a rate later. You can’t renegotiate last year’s price. That asymmetry is worth considering.',
      ],
    },
    quickHits: [
      { title: 'New-home sales up', body: 'Builders continue to win buyers with incentives.' },
      { title: 'Mortgage applications steady', body: 'Purchase demand held up despite rate swings.' },
      { title: 'Insurance costs rising', body: 'Shop your homeowners policy at renewal — premiums vary widely.' },
    ],
    familyHack: { title: 'Round-up savings', body: 'Turn on round-up savings in your bank app. Spare change from everyday purchases adds up surprisingly fast.' },
    whatToWatch: [
      { day: 'Tue', event: 'Durable goods', why: 'Business investment trend.' },
      { day: 'Fri', event: 'PCE inflation', why: 'The Fed’s preferred gauge.' },
    ],
  },
  {
    id: '2026-08-17',
    date: '2026-08-17',
    title: 'Mid-Summer Rate Watch',
    preheader: 'Rates drifted lower — here’s what drove it.',
    lead: {
      heading: 'Rates Drift Lower',
      paragraphs: ['A run of softer economic data helped mortgage rates drift lower through mid-August.', 'If you have been on the fence, this is a good moment to refresh your pre-approval and see your updated buying power.'],
    },
    quickHits: [
      { title: 'Buying power improved', body: 'Lower rates translate directly into a higher price range for the same payment.' },
      { title: 'Listings up year over year', body: 'More homes for sale means more choice.' },
      { title: 'Refi break-evens shrinking', body: 'Recent buyers may already be near a worthwhile refinance.' },
    ],
    familyHack: { title: 'Plan a no-spend weekend', body: 'Pick one weekend a month to enjoy free local activities. It’s a fun challenge and a real savings boost.' },
    whatToWatch: [
      { day: 'Tue', event: 'Housing starts', why: 'Future supply.' },
      { day: 'Thu', event: 'Existing-home sales', why: 'Current market pace.' },
    ],
  },
  {
    id: '2026-07-27',
    date: '2026-07-27',
    title: 'Halfway Through the Year: Housing Check-Up',
    preheader: 'A mid-year look at prices, rates and inventory.',
    lead: {
      heading: 'Mid-Year Check-Up',
      paragraphs: ['The first half of the year delivered steady price gains, gradually improving inventory and rates that bounced within a range.', 'The second half will likely hinge on inflation progress — and how quickly bonds respond.'],
    },
    quickHits: [
      { title: 'Prices still rising', body: 'Most markets posted gains, led by the Northeast and Midwest.' },
      { title: 'First-time buyers returning', body: 'Low down payment programs remain a key path to ownership.' },
      { title: 'Condo market mixed', body: 'Some condo markets are softer as fees and insurance rise.' },
    ],
    familyHack: { title: 'Mid-year budget review', body: 'Compare what you planned to spend in January with what you actually spent. Adjust one category for the rest of the year.' },
    whatToWatch: [
      { day: 'Wed', event: 'Fed decision', why: 'Watch the press conference tone.' },
      { day: 'Fri', event: 'Jobs report', why: 'Labor strength sets rate direction.' },
    ],
  },
];

export const CURRENT_ISSUE_ID = '2026-10-05';
