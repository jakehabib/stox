/**
 * DEMO DATA — Social Studio video scripts, intro/outro frame templates and the recorded
 * video library. All copy is original synthetic text written for the prototype.
 * Scripts are first-person; `{name}`, `{company}` and `{phone}` are filled from the LO's
 * co-branding at render time, so edits to co-branding flow into every script.
 */

export const SCRIPT_CATEGORIES = [
  'Featured',
  'Custom',
  'Benefits of Homeownership',
  'Breaking News',
  'Homebuyer',
  'Homeowner',
  'ListReports',
  'Location Specific',
  'Moving',
  'Refinance',
  'Seasonal Home Tips',
] as const;
export type ScriptCategory = (typeof SCRIPT_CATEGORIES)[number];

export interface VideoScript {
  id: string;
  title: string;
  category: Exclude<ScriptCategory, 'Featured'>;
  featured?: boolean;
  /** ISO date. */
  published: string;
  tags: string[];
  body: string;
}

/** Categories a script belongs to (its own + Featured when flagged). */
export function scriptCategories(s: VideoScript): string[] {
  return s.featured ? [s.category, 'Featured'] : [s.category];
}

type Seed = [title: string, published: string, tags: string[], body: string, featured?: boolean];

const group = (category: VideoScript['category'], prefix: string, seeds: Seed[]): VideoScript[] =>
  seeds.map(([title, published, tags, body, featured], i) => ({ id: `${prefix}-${i + 1}`, title, category, featured, published, tags, body }));

export const VIDEO_SCRIPTS: VideoScript[] = [
  ...group('Benefits of Homeownership', 'boh', [
    [
      'The Forced Savings Account Nobody Talks About',
      '2026-10-06',
      ['equity', 'wealth', 'principal'],
      `Hi, I’m {name} with {company}. Here’s something people forget about owning a home: every mortgage payment has a little savings account built right in.\n\nPart of each payment goes to principal — and that part is yours. On a typical loan, you’re building thousands of dollars of equity in the first few years without ever logging into a brokerage account.\n\nRent pays for this month. A mortgage pays for this month and your future. If you want to see exactly how much equity your payment could build, reach out — I’ll show you the numbers in five minutes.`,
      true,
    ],
    [
      'Owning vs. Renting: The Ten-Year Picture',
      '2026-09-22',
      ['buy vs rent', 'wealth', 'appreciation'],
      `{name} here. Let’s zoom out ten years.\n\nIf you rent, you’ll likely see your rent go up most of those years, and at the end you’ll have a stack of receipts. If you buy, your principal and interest payment stays the same on a fixed-rate loan, your home has a chance to appreciate, and you’ve been paying down your balance the whole time.\n\nThat combination — fixed costs, appreciation and principal paydown — is why homeowners tend to build far more net worth than renters. Want me to run your own ten-year picture? Send me a message.`,
    ],
    [
      'Your Payment, Locked In',
      '2026-08-18',
      ['fixed rate', 'inflation', 'budget'],
      `Hi everyone, it’s {name}. Quick thought on inflation.\n\nGroceries go up. Gas goes up. Rent goes up. But with a fixed-rate mortgage, your principal and interest payment is the one big bill that doesn’t move for thirty years.\n\nThat means every year you own, your housing cost actually shrinks relative to your income and everything else you buy. That’s real peace of mind — and a real advantage. If you want to talk about locking in your housing cost, I’m here.`,
    ],
    [
      'Tax Benefits Worth Asking About',
      '2026-07-14',
      ['taxes', 'deductions'],
      `{name} with {company}. I’m not a tax advisor, but I can tell you this is a question worth asking yours.\n\nDepending on your situation, mortgage interest and property taxes may be deductible, and when you eventually sell your primary residence, a large portion of the gain may be excluded from tax.\n\nRenters don’t get those conversations. Talk to your tax pro, and when you’re ready to see what owning looks like for you, give me a call.`,
    ],
    [
      'Stability for Your Family',
      '2026-06-09',
      ['family', 'schools', 'community'],
      `Hi, it’s {name}. Owning a home isn’t only about money.\n\nIt’s knowing your kids can stay in the same school. It’s painting the walls whatever color you want. It’s not getting a letter that your lease won’t be renewed.\n\nStability has real value, and homeownership is one of the best ways to get it. If you’ve been thinking about putting down roots, let’s talk about what it would take — you might be closer than you think.`,
    ],
  ]),
  ...group('Breaking News', 'news', [
    [
      'Fed Minutes: What They Really Mean for Rates',
      '2026-10-08',
      ['fed', 'rates', 'market update'],
      `{name} here with a quick market update. The Fed released its meeting minutes this week, and the headlines were loud.\n\nHere’s what matters: the Fed doesn’t set mortgage rates directly. Mortgage rates follow mortgage bonds, and bonds react to inflation and the economy. The minutes showed a Fed that’s watching inflation closely but is in no hurry to surprise anyone.\n\nTranslation: expect some day-to-day volatility, not a cliff. If you’re in the middle of a purchase, let’s talk about your lock strategy today.`,
      true,
    ],
    [
      'Jobs Report Day: Why Your Rate Moved',
      '2026-10-03',
      ['jobs report', 'bonds', 'volatility'],
      `Hi, it’s {name}. If you noticed rates move today, blame the jobs report.\n\nA stronger-than-expected report usually pushes rates up, because it hints at more inflation ahead. A softer report tends to help rates come down.\n\nThe key is not to panic over one day. I watch the bond market every morning so you don’t have to. If you’re shopping for a home or thinking about refinancing, send me a message and I’ll tell you what today’s move means for you.`,
    ],
    [
      'Inflation Cooled — Here’s Why That Matters',
      '2026-09-15',
      ['cpi', 'inflation', 'rates'],
      `{name} with {company}. This morning’s inflation numbers came in cooler than expected, and that’s good news for mortgage rates.\n\nInflation is the enemy of bonds, and mortgage rates are tied to bonds. When inflation cools, bonds tend to improve and rates can follow.\n\nThis doesn’t mean rates fall in a straight line, but it’s a step in the right direction. If you’ve been waiting for a better moment, now’s a great time to get pre-approved so you’re ready to move.`,
    ],
    [
      'Home Prices Hit Another Record',
      '2026-08-26',
      ['home prices', 'appreciation', 'hpi'],
      `Hi everyone, {name} here. The latest home price index shows prices at a new high again.\n\nWhy? Inventory is still tight, and demand hasn’t gone away. Every month someone waits, the price of the home they want may keep rising.\n\nThe good news: if you already own, your equity just grew. If you’re still renting, let’s look at what buying sooner versus later could cost you. I have a tool that shows exactly that — just reach out.`,
    ],
    [
      'Rates Dipped This Week — Should You Act?',
      '2026-07-30',
      ['rates', 'refinance', 'lock'],
      `{name} here. Rates dipped this week, and my phone has been busy.\n\nIf you bought in the last couple of years at a higher rate, this could be worth a look — even a half-point difference can mean real monthly savings. And if you’re shopping, lower rates mean more buying power.\n\nRates move every day, so the best plan is to have your numbers ready. Message me and I’ll run a free side-by-side so you can decide with confidence.`,
    ],
  ]),
  ...group('Homebuyer', 'buyer', [
    [
      'You Might Not Need 20% Down',
      '2026-10-01',
      ['down payment', 'first-time buyer', 'programs'],
      `Hi, I’m {name}. One of the biggest myths I hear is that you need twenty percent down to buy a home.\n\nThe truth is, many buyers put down far less. There are programs with three to three-and-a-half percent down, and some with even less for qualifying buyers.\n\nYes, a smaller down payment can mean mortgage insurance, but that’s often a small price for getting into a home years sooner. Let’s look at your options — you may be closer to owning than you think.`,
      true,
    ],
    [
      'Pre-Qualified vs. Pre-Approved',
      '2026-09-17',
      ['pre-approval', 'first-time buyer', 'offers'],
      `{name} with {company} here. Let’s clear up two terms that sound the same but aren’t.\n\nA pre-qualification is a quick estimate based on what you tell me. A pre-approval means I’ve actually reviewed your income, assets and credit.\n\nWhen you make an offer, sellers take a pre-approval much more seriously. In a competitive market, that can be the difference between winning the house and losing it. Want to get pre-approved the right way? Let’s start today.`,
    ],
    [
      'What Really Goes Into Your Payment',
      '2026-09-02',
      ['piti', 'payment', 'budget'],
      `Hi, it’s {name}. When people ask about a mortgage payment, they usually think about the rate. But your payment has four main pieces.\n\nPrincipal and interest pay back the loan. Property taxes go to your local government. Homeowners insurance protects the house. And if you put less than twenty percent down, there may be mortgage insurance.\n\nKnowing all four keeps surprises off the table. Send me a home you love, and I’ll break down the full payment for you.`,
    ],
    [
      'Three Credit Moves Before You Apply',
      '2026-08-05',
      ['credit', 'fico', 'tips'],
      `{name} here with three quick credit tips before you apply for a mortgage.\n\nOne: pay down credit card balances — lower utilization can lift your score fast. Two: don’t open new accounts or finance furniture right before or during your loan. Three: keep paying everything on time, even small bills.\n\nA few points on your score can mean a better rate and lower mortgage insurance. If you want, I can review your credit and show you which moves matter most.`,
    ],
    [
      'Closing Costs, Explained in 60 Seconds',
      '2026-07-08',
      ['closing costs', 'cash to close'],
      `Hi everyone, it’s {name}. Let’s talk closing costs.\n\nOn top of your down payment, you’ll have costs like the appraisal, title insurance, lender fees and prepaid items such as taxes and insurance. Together they often land in the range of a few percent of the price.\n\nThe good news: sellers can sometimes contribute, and there are ways to structure your offer to reduce cash at closing. Before you shop, let’s map out exactly how much cash you’ll need.`,
    ],
    [
      'Should You Wait for Rates to Fall?',
      '2026-06-23',
      ['cost of waiting', 'timing', 'rates'],
      `{name} with {company}. The question I hear most: should I wait for rates to drop?\n\nHere’s the trade-off. If rates fall, more buyers jump in and prices often rise. You might save on rate but pay more for the house. And you can always refinance later if rates drop — but you can’t go back and buy at last year’s price.\n\nI have a cost-of-waiting analysis that puts real numbers on this. Message me and let’s run yours.`,
    ],
  ]),
  ...group('Homeowner', 'owner', [
    [
      'How Much Equity Do You Have?',
      '2026-10-07',
      ['equity', 'home value'],
      `Hi, I’m {name}. Quick question: do you know how much equity you have in your home?\n\nBetween appreciation and the principal you’ve paid down, a lot of homeowners are sitting on more wealth than they realize.\n\nThat equity can open doors — a move-up home, paying off high-interest debt, or simply knowing your financial position. Send me your address and I’ll put together a free equity snapshot for you.`,
    ],
    [
      'Using Equity to Knock Out High-Interest Debt',
      '2026-09-09',
      ['debt consolidation', 'cash out', 'credit cards'],
      `{name} here. If you’re carrying credit card balances at twenty-plus percent, listen up.\n\nFor some homeowners, rolling that debt into a mortgage can cut total monthly payments significantly. It’s not right for everyone — you’re turning short-term debt into long-term debt — but the monthly savings can be dramatic.\n\nI have a debt consolidation tool that shows the before and after side by side. If you want an honest look at whether it makes sense, reach out.`,
    ],
    [
      'Your Annual Mortgage Check-Up',
      '2026-08-12',
      ['review', 'pmi', 'refinance'],
      `Hi everyone, it’s {name}. You get a check-up for your health and your car — why not your mortgage?\n\nOnce a year, it’s worth asking: has my home value gone up enough to remove mortgage insurance? Has my rate become uncompetitive? Has my plan changed?\n\nA quick review can uncover real savings. I do these for my clients for free. Just send me a message and we’ll schedule fifteen minutes.`,
    ],
    [
      'Remove PMI Sooner Than You Think',
      '2026-07-21',
      ['pmi', 'mortgage insurance', 'equity'],
      `{name} with {company}. If you’re paying mortgage insurance, here’s some good news.\n\nOnce you have enough equity — through payments, appreciation or both — you may be able to request that it be removed. With the way values have moved, some homeowners qualify years earlier than scheduled.\n\nThat could put a meaningful amount back in your pocket each month. Want me to check where you stand? Send me a quick message.`,
    ],
    [
      'Protecting Your Biggest Asset',
      '2026-06-16',
      ['insurance', 'protection'],
      `Hi, it’s {name}. Your home is likely your biggest asset, so let’s make sure it’s protected.\n\nReview your homeowners policy every year — replacement costs change, and many homeowners are under-insured without knowing it. Keep a simple video inventory of your belongings, and know your deductible.\n\nIt’s not the most exciting topic, but a little attention now can save a lot of stress later. Questions? I’m always happy to help.`,
    ],
  ]),
  ...group('ListReports', 'lr', [
    [
      'Just Listed: Walk Through the Numbers',
      '2026-09-30',
      ['listing', 'just listed', 'payment'],
      `Hi, I’m {name} with {company}. This beautiful home just hit the market, and I want to show you what it could actually cost to own.\n\nInstead of just a price, let’s talk payment. With a few different down payment options, you can see how this home fits your monthly budget.\n\nThe full breakdown is in the link. If you’d like a personalized version with your own numbers, send me a message — I can have it to you today.`,
    ],
    [
      'Open House This Weekend',
      '2026-09-04',
      ['open house', 'listing', 'flyer'],
      `{name} here. I’ll be at the open house this weekend with payment scenarios for every buyer who walks in.\n\nStop by, take a look around, and grab a flyer that shows what this home costs per month with three, five and twenty percent down.\n\nAnd if you’re not pre-approved yet, I can get you started right there. See you this weekend!`,
    ],
    [
      'Price Improved — Here’s What It Means',
      '2026-08-20',
      ['price reduction', 'listing', 'payment'],
      `Hi everyone, it’s {name}. This listing just had a price improvement, and I want to translate that into something real.\n\nA lower price doesn’t just change the sticker — it lowers your loan amount, your down payment and your monthly payment.\n\nI ran the numbers, and the difference is worth a look. If this home was just out of reach before, it might not be now. Message me for the details.`,
    ],
  ]),
  ...group('Location Specific', 'loc', [
    [
      'Dallas Market Snapshot',
      '2026-10-02',
      ['dallas', 'texas', 'market report'],
      `Hi, it’s {name}, and here’s your quick Dallas market snapshot.\n\nHomes are still selling steadily, inventory has improved a bit from last year, and buyers have a little more room to negotiate than they did before.\n\nThat’s a great combination if you’ve been waiting on the sidelines. Want the full local report card for your ZIP code? Send me a message and I’ll send it over.`,
    ],
    [
      'Why Buyers Are Moving to Monmouth County',
      '2026-09-11',
      ['new jersey', 'monmouth county', 'relocation'],
      `{name} with {company}. More and more buyers are looking at Monmouth County, and it’s easy to see why.\n\nGreat schools, access to the shore, and a commute that works for a lot of people. Demand has stayed strong, which has helped home values hold up well.\n\nIf you’re considering a move here, I can show you what neighborhoods fit your budget and what your payment would look like. Let’s talk.`,
    ],
    [
      'Your ZIP Code’s Report Card',
      '2026-08-07',
      ['rerc', 'report card', 'local market'],
      `Hi, I’m {name}. National headlines are interesting, but real estate is local.\n\nI can send you a report card for your exact ZIP code — inventory, days on market, price trends and the forecast — so you know what’s really happening where you live.\n\nIt’s free, and it takes me about a minute. Just reply with your ZIP code.`,
    ],
    [
      'Property Taxes in Your County',
      '2026-07-01',
      ['property tax', 'county', 'budget'],
      `{name} here. When you compare homes in different towns, don’t forget property taxes.\n\nTwo homes at the same price can have very different monthly payments because tax rates vary by county and even by town.\n\nBefore you fall in love with a listing, let me show you the full payment including taxes. It’s one of the easiest ways to avoid surprises.`,
    ],
  ]),
  ...group('Moving', 'move', [
    [
      'Buying and Selling at the Same Time',
      '2026-09-24',
      ['move-up', 'bridge', 'timing'],
      `Hi, it’s {name}. One of the most stressful parts of moving is timing: do you buy first or sell first?\n\nThere are strategies for both — from contingent offers to using the equity in your current home before it sells.\n\nThe right answer depends on your equity, your income and your market. Let’s sit down and map out a plan so your move feels organized instead of overwhelming.`,
    ],
    [
      'Your Moving-Day Checklist',
      '2026-08-28',
      ['checklist', 'moving tips'],
      `{name} with {company} here with a quick moving checklist.\n\nTwo weeks out: confirm movers and transfer utilities. One week out: change your address and pack an essentials box. Moving day: do a final walk-through and take meter photos.\n\nAnd don’t forget to celebrate — you earned it! Congrats to everyone moving this month.`,
    ],
    [
      'Relocating for Work? Start Here',
      '2026-07-17',
      ['relocation', 'job', 'new city'],
      `Hi everyone, {name} here. Relocating for a new job is exciting — and a lot to juggle.\n\nGet pre-approved early so you know your budget before you visit. Research property taxes and insurance in the new area. And find a local agent who knows the neighborhoods.\n\nI can help with the financing and connect you with great agents. Send me a message and let’s make your move easier.`,
    ],
    [
      'Is It Time to Size Up — or Down?',
      '2026-06-02',
      ['downsizing', 'move-up', 'equity'],
      `{name} here. Life changes, and sometimes your home should too.\n\nGrowing families often need more space. Empty nesters may want less to maintain. Either way, the equity you’ve built can make the next move much easier than you expect.\n\nLet’s look at what your current home is worth and what your next one could cost. You might be surprised at your options.`,
    ],
  ]),
  ...group('Refinance', 'refi', [
    [
      'Is Now the Time to Refinance?',
      '2026-10-09',
      ['refinance', 'rates', 'break-even'],
      `Hi, I’m {name} with {company}. If you’ve been wondering whether to refinance, here’s the simple test.\n\nCompare your monthly savings to your costs and find the break-even point. If you’ll stay in the home longer than that, it may be worth it.\n\nI run these numbers for free — current loan versus new loan, side by side, with the break-even clearly shown. Send me a message and I’ll have your analysis ready today.`,
      true,
    ],
    [
      'The Cost of Waiting to Refinance',
      '2026-09-18',
      ['refi', 'cost of waiting', 'savings'],
      `{name} here. Waiting for rates to drop just a little more? Let’s put a number on that.\n\nEvery month you wait is a month of savings you don’t get. If waiting costs you a few hundred dollars a month, a small extra drop in rate later may never make that back.\n\nMy refi risk-of-waiting tool shows exactly how long it would take. Let’s run it together.`,
    ],
    [
      'Cash-Out Refinance: Smart Uses',
      '2026-08-14',
      ['cash out', 'equity', 'renovation'],
      `Hi, it’s {name}. A cash-out refinance lets you tap your home equity — but how you use it matters.\n\nSmart uses often include paying off high-interest debt, adding value through renovations, or building an emergency fund. Less smart: funding a lifestyle you can’t sustain.\n\nIf you’re considering it, let’s talk through the numbers and make sure it strengthens your financial position.`,
    ],
    [
      'Shortening Your Term',
      '2026-07-24',
      ['15-year', 'term', 'interest savings'],
      `{name} with {company}. Here’s a refinance strategy that doesn’t get enough attention: shortening your term.\n\nMoving from thirty years to twenty or fifteen can save a huge amount of interest over the life of the loan, and some homeowners can do it without a big jump in payment.\n\nWant to see the difference for your loan? Message me and I’ll put it side by side.`,
    ],
    [
      'Removing a Co-Borrower',
      '2026-06-12',
      ['co-borrower', 'life changes'],
      `Hi, I’m {name}. Life changes — and sometimes the names on your mortgage need to change too.\n\nWhether it’s after a divorce or a family member who co-signed years ago, refinancing can remove a co-borrower and put the loan in one name.\n\nIt’s a sensitive conversation, and I handle it with care. If this applies to you, reach out privately and we’ll walk through your options.`,
    ],
  ]),
  ...group('Seasonal Home Tips', 'season', [
    [
      'Fall Maintenance in Five Minutes',
      '2026-10-05',
      ['fall', 'maintenance', 'checklist'],
      `Hi everyone, it’s {name} with five quick fall home tips.\n\nClean your gutters. Service your heating system. Seal gaps around windows and doors. Test your smoke and carbon monoxide detectors. And disconnect outdoor hoses before the first freeze.\n\nA little maintenance now protects your biggest investment. Save this video and check them off this weekend!`,
      true,
    ],
    [
      'Winter-Proof Your Home',
      '2026-09-28',
      ['winter', 'pipes', 'energy'],
      `{name} here. Winter’s coming, so let’s protect your home.\n\nInsulate exposed pipes, keep your thermostat steady when you travel, and know where your main water shut-off is. A smart thermostat can also trim your energy bill.\n\nFrozen pipes are one of the most common — and expensive — winter repairs. Ten minutes of prep can save you thousands.`,
    ],
    [
      'Spring Curb Appeal on a Budget',
      '2026-03-16',
      ['spring', 'curb appeal', 'selling'],
      `Hi, it’s {name}. Thinking about selling this spring? First impressions matter.\n\nFresh mulch, a power-washed walkway, a painted front door and a couple of planters can make a big difference for very little money.\n\nBuyers decide how they feel about a home before they walk in. Make that first moment count — and if you’re planning a move, let’s talk financing for your next home.`,
    ],
    [
      'Summer Energy Savings',
      '2026-06-05',
      ['summer', 'energy', 'savings'],
      `{name} with {company} here. Summer bills can sneak up on you.\n\nReplace your AC filter, close blinds during the hottest hours, use ceiling fans to feel cooler at a higher thermostat setting, and check your attic insulation.\n\nSmall changes add up over a whole season. Enjoy the summer, and as always, I’m here if you have any questions about your home or mortgage.`,
    ],
  ]),
  ...group('Custom', 'custom', [
    [
      'My Client Promise',
      '2026-09-01',
      ['about me', 'trust', 'intro'],
      `Hi, I’m {name} with {company}. I want to tell you what working with me looks like.\n\nYou’ll always know where your loan stands. You’ll get straight answers, even when they’re not what you hoped to hear. And you’ll have my cell — {phone} — because buying a home doesn’t happen only between nine and five.\n\nIf that sounds like the kind of lender you want in your corner, let’s talk.`,
    ],
    [
      'Thank You to My Agent Partners',
      '2026-08-01',
      ['agents', 'partners', 'thank you'],
      `{name} here, and this one is for the real estate agents I work with.\n\nThank you. Every closing is a team effort, and I’m grateful for partners who care about their clients as much as I do.\n\nIf you’re an agent looking for a lender who communicates, closes on time and makes you look great, give me a call. I’d love to work together.`,
    ],
  ]),
];

/* ------------------------------------------------------------------ intro/outro frames */

export interface FrameTemplate {
  id: string;
  name: string;
  description: string;
  /** Background gradient stops. */
  from: string;
  to: string;
  accent: string;
  text: string;
  layout: 'center' | 'left' | 'split' | 'lower-third';
}

export const FRAME_TEMPLATES: FrameTemplate[] = [
  { id: 'classic', name: 'Classic Purple', description: 'Centered name card on brand purple', from: '#3e1a8f', to: '#6a2ff2', accent: '#bcadff', text: '#ffffff', layout: 'center' },
  { id: 'midnight', name: 'Midnight', description: 'Deep navy with a bright accent rule', from: '#0b1020', to: '#27325c', accent: '#1baf7a', text: '#ffffff', layout: 'left' },
  { id: 'daylight', name: 'Daylight', description: 'Light and clean for bright videos', from: '#f8fafc', to: '#ebe7ff', accent: '#6a2ff2', text: '#111833', layout: 'center' },
  { id: 'split', name: 'Split Panel', description: 'Color panel with contact details', from: '#111833', to: '#4b1db0', accent: '#eda100', text: '#ffffff', layout: 'split' },
  { id: 'lower-third', name: 'Lower Third', description: 'Name bar over your footage', from: '#1a2347', to: '#2a78d6', accent: '#ffffff', text: '#ffffff', layout: 'lower-third' },
  { id: 'sunset', name: 'Sunset', description: 'Warm gradient, friendly feel', from: '#eb6834', to: '#e87ba4', accent: '#fff3e0', text: '#ffffff', layout: 'left' },
];

/* ------------------------------------------------------------------ recorded videos */

export interface RecordedVideo {
  id: string;
  title: string;
  scriptId?: string;
  durationSec: number;
  recorded: string;
  views: number;
  status: 'Published' | 'Draft';
  frameId: string;
}

export const RECORDED_VIDEOS: RecordedVideo[] = [
  { id: 'v1', title: 'Fed Minutes: What They Really Mean for Rates', scriptId: 'news-1', durationSec: 74, recorded: '2026-10-08', views: 412, status: 'Published', frameId: 'classic' },
  { id: 'v2', title: 'You Might Not Need 20% Down', scriptId: 'buyer-1', durationSec: 62, recorded: '2026-10-02', views: 1290, status: 'Published', frameId: 'daylight' },
  { id: 'v3', title: 'Is Now the Time to Refinance?', scriptId: 'refi-1', durationSec: 58, recorded: '2026-10-09', views: 233, status: 'Published', frameId: 'midnight' },
  { id: 'v4', title: 'Fall Maintenance in Five Minutes', scriptId: 'season-1', durationSec: 45, recorded: '2026-10-05', views: 877, status: 'Published', frameId: 'sunset' },
  { id: 'v5', title: 'Dallas Market Snapshot', scriptId: 'loc-1', durationSec: 51, recorded: '2026-10-03', views: 158, status: 'Published', frameId: 'lower-third' },
  { id: 'v6', title: 'My Client Promise', scriptId: 'custom-1', durationSec: 49, recorded: '2026-09-02', views: 2104, status: 'Published', frameId: 'split' },
  { id: 'v7', title: 'How Much Equity Do You Have?', scriptId: 'owner-1', durationSec: 47, recorded: '2026-10-10', views: 0, status: 'Draft', frameId: 'classic' },
  { id: 'v8', title: 'Open House This Weekend', scriptId: 'lr-2', durationSec: 38, recorded: '2026-09-05', views: 566, status: 'Published', frameId: 'daylight' },
];

/** Topic suggestions for the custom script builder. */
export const CUSTOM_TOPIC_SUGGESTIONS = [
  'today’s mortgage rates',
  'buying your first home',
  'refinancing this year',
  'using your home equity',
  'the cost of waiting to buy',
  'down payment assistance',
  'buying before spring',
  'what the Fed decision means',
];
