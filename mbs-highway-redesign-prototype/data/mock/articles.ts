/**
 * DEMO DATA — editorial content: Morning Updates, Market Wraps, Mauldin issues,
 * Barry's Insights webinars and today's short articles.
 *
 * ALL TEXT IS ORIGINAL SYNTHETIC COMMENTARY written for the prototype. It summarizes the
 * kind of analysis these products publish; it does not quote or reproduce any real issue.
 * Recent items are hand-written; older archive items are composed deterministically from
 * topic blocks so month filters and pagination have realistic depth.
 * To go live, replace the exported getters with your CMS.
 */
import { hashString, mulberry32 } from '@/lib/random';
import { addDays, isoDate, parseIsoDate } from '@/lib/calculations/markets';
import { getMarketSnapshot } from '@/data/mock/market';
import { BOND_HOLIDAYS, DEMO_NOW, getMbsDaily } from '@/data/mock/markets';

export interface Section {
  heading: string;
  body: string[];
}

export interface DailyUpdate {
  id: string;
  date: string;
  title: string;
  summary: string;
  durationSec: number;
  sections: Section[];
  takeaway: string;
  tags: string[];
}

export interface MarketWrap {
  id: string;
  date: string;
  title: string;
  summary: string;
  mbsClose: number;
  mbsChangeBp: number;
  tenYear: number;
  sections: Section[];
}

export interface MauldinIssue {
  id: string;
  date: string;
  title: string;
  dek: string;
  sections: Section[];
}

export interface Webinar {
  id: string;
  date: string;
  title: string;
  description: string;
  durationSec: number;
  kind: 'Market Outlook' | 'Training' | 'Sales Strategy';
  topics: string[];
  chapters: { at: number; label: string }[];
}

export interface ShortArticle {
  id: string;
  date: string;
  time: string;
  category: 'Rates' | 'Housing' | 'Economy' | 'Strategy';
  title: string;
  summary: string;
  body: string[];
}

/* ================================================================== helpers */

const pick = <T,>(rand: () => number, arr: T[]): T => arr[Math.floor(rand() * arr.length) % arr.length];

function tradingDaysBack(from: string, until: string): string[] {
  const out: string[] = [];
  let d = parseIsoDate(from);
  const stop = parseIsoDate(until);
  const closed = BOND_HOLIDAYS;
  while (d >= stop) {
    const iso = isoDate(d);
    if (d.getDay() !== 0 && d.getDay() !== 6 && !closed.has(iso)) out.push(iso);
    d = addDays(d, -1);
  }
  return out;
}

const longDate = (iso: string) => parseIsoDate(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

/* ================================================================== morning updates */

const RECENT_UPDATES: Omit<DailyUpdate, 'id'>[] = [
  {
    date: '2026-10-14',
    title: 'CPI Day: Core Inflation Cools and MBS Hold Their Ground',
    summary: 'September CPI came in line on the headline and a tenth cooler on core. Shelter keeps decelerating, and bonds are trading near the top of their recent range. Beige Book at 2:00 PM ET.',
    durationSec: 412,
    tags: ['CPI', 'Inflation', 'Beige Book'],
    sections: [
      {
        heading: 'What happened this morning',
        body: [
          'The September Consumer Price Index rose 0.3% month over month, matching expectations, while the core reading (ex-food and energy) rose 0.2% against a 0.3% forecast. On an annual basis headline inflation is running near 2.9%, and the three-month annualized pace of core is the softest it has been since spring.',
          'Mortgage-backed securities opened modestly higher on the release and have held most of that improvement through the first hour of trading. The 10-year Treasury yield is hovering just above 4.1%.',
        ],
      },
      {
        heading: 'Why shelter matters most',
        body: [
          'Shelter is roughly a third of the CPI basket and it lags real-time rents by about a year. Market rent indexes have been flat to slightly negative for months, so the official shelter component has room to keep cooling into 2027. That is the single biggest reason we expect inflation to continue drifting lower even if goods prices stay firm.',
        ],
      },
      {
        heading: 'What to watch the rest of the day',
        body: [
          'The Fed’s Beige Book is released at 2:00 PM ET. Listen for language about softer hiring and easing price pressure — that tone would reinforce today’s data. Tomorrow brings Retail Sales and weekly Jobless Claims, both at 8:30 AM ET.',
          'Technically, MBS are sitting just beneath a ceiling that has capped prices twice this month. A close above that level would open the door to another leg of improvement in rate sheets; a rejection would likely mean a few days of consolidation.',
        ],
      },
      {
        heading: 'How to talk about it with clients',
        body: [
          'Clients hear “inflation” and assume rates must go up. Today is a good example of the opposite: cooler inflation is exactly what allows mortgage rates to improve. For buyers on the fence, the bigger risk remains home prices — values are still appreciating, so waiting for a slightly lower rate can cost more than it saves.',
        ],
      },
    ],
    takeaway: 'Floating is reasonable for clients closing 30+ days out while MBS test resistance; lock anything closing within two weeks.',
  },
  {
    date: '2026-10-13',
    title: 'Back From the Holiday: Housing Data and the Run-Up to CPI',
    summary: 'Bond markets reopened after Columbus Day with light volume. Existing Home Sales firmed and inventory climbed to its best level in years, while traders positioned cautiously ahead of CPI.',
    durationSec: 365,
    tags: ['Existing Home Sales', 'ADP', 'Inventory'],
    sections: [
      {
        heading: 'Quiet reopening',
        body: [
          'With the bond market closed Monday, Tuesday’s session was about catching up. Mortgage-backed securities traded in a narrow range, and lenders largely carried over Friday’s pricing with minor adjustments.',
          'The weekly ADP estimate showed private employers adding jobs at a modest pace — enough to keep recession fears in check, not enough to reignite wage pressure.',
        ],
      },
      {
        heading: 'Housing: more choices for buyers',
        body: [
          'Existing Home Sales ticked up to a seasonally adjusted annual pace a bit above 4.1 million. More important for your buyers, inventory continues to rebuild and months’ supply is approaching levels that feel balanced in many markets. Median prices are still higher than a year ago, but the pace of gains has moderated.',
        ],
      },
      {
        heading: 'Positioning for CPI',
        body: [
          'Wednesday’s inflation report is the week’s main event. A cooler core reading would support the recent improvement in rates; a hot one could undo it quickly. Expect lenders to price conservatively into the release.',
        ],
      },
    ],
    takeaway: 'Use rising inventory as a negotiating tool for buyers — sellers are more willing to offer concessions and credits.',
  },
  {
    date: '2026-10-09',
    title: 'Friday Check-In: Sentiment, Fed Speakers and a Constructive Week for Bonds',
    summary: 'Consumer sentiment slipped and inflation expectations eased, capping a week in which MBS gained ground. Fed officials sounded patient but open to further cuts.',
    durationSec: 338,
    tags: ['Consumer Sentiment', 'Fed'],
    sections: [
      {
        heading: 'The week in one sentence',
        body: [
          'Bonds had a constructive week as labor data cooled at the margin and inflation expectations eased — mortgage rates finish the week modestly better than they started.',
        ],
      },
      {
        heading: 'Inflation expectations matter',
        body: [
          'The University of Michigan survey showed one-year inflation expectations easing for the third straight month. The Fed watches these closely because expectations can become self-fulfilling. Lower expectations give policymakers room to keep easing gradually.',
        ],
      },
      {
        heading: 'Next week',
        body: [
          'Monday is Columbus Day and the bond market is closed. The heavy lifting comes Wednesday with CPI and the Beige Book, followed by Retail Sales and Jobless Claims on Thursday.',
        ],
      },
    ],
    takeaway: 'With the bond market closed Monday, lock decisions for early-week closings should be made today.',
  },
  {
    date: '2026-10-08',
    title: 'Treasury Auctions and the Long End: Why the Afternoon Matters',
    summary: 'A solid 10-year note auction helped long-term rates hold their gains. We explain how auction demand flows through to mortgage pricing.',
    durationSec: 391,
    tags: ['Auctions', 'Treasuries'],
    sections: [
      {
        heading: 'Auction recap',
        body: [
          'The Treasury sold new 10-year notes at a yield slightly below where they traded just before the deadline — a sign of healthy demand. Indirect bidders, a proxy for foreign buyers, took a larger-than-average share.',
        ],
      },
      {
        heading: 'Why LOs should care',
        body: [
          'Mortgage-backed securities compete with Treasuries for the same investor dollars. When auctions go poorly, yields must rise to attract buyers and MBS often weaken in sympathy, which can trigger afternoon reprices. A strong auction removes that risk for the day.',
        ],
      },
    ],
    takeaway: 'Watch the 1:00 PM ET auction results on auction days before promising a client that pricing will hold all afternoon.',
  },
  {
    date: '2026-10-07',
    title: 'Mortgage Applications Rise as Buyers Respond to Better Affordability',
    summary: 'Purchase applications climbed again while refinance activity stayed elevated for borrowers with rates above 7%. Bonds were little changed.',
    durationSec: 356,
    tags: ['MBA Applications', 'Refinance'],
    sections: [
      {
        heading: 'Demand is responding',
        body: [
          'Weekly purchase applications rose for the third time in four weeks and are running ahead of last year’s pace. Lower rates and more inventory are a powerful combination, especially for first-time buyers who were priced out last year.',
        ],
      },
      {
        heading: 'The refi pocket',
        body: [
          'Borrowers who locked between 7% and 8% are now in the money. Even a modest rate improvement creates meaningful savings on larger balances. Use Strike Rate and the Refi Risk of Waiting tool to identify and prioritize these clients before rates move.',
        ],
      },
    ],
    takeaway: 'Pull your 2023–2024 closings above 7% this week — they are your warmest refinance conversations.',
  },
  {
    date: '2026-10-06',
    title: 'Services Sector Steady, Prices Paid Cooling',
    summary: 'The ISM Services index remained in expansion, but the prices-paid component eased — a welcome sign for the inflation outlook and for bonds.',
    durationSec: 347,
    tags: ['ISM Services'],
    sections: [
      {
        heading: 'Growth without heat',
        body: [
          'Services activity, the bulk of the U.S. economy, kept expanding at a moderate pace. The more important detail for rates was the prices-paid component, which cooled for a second month and suggests less pass-through to consumer prices ahead.',
        ],
      },
      {
        heading: 'Market reaction',
        body: [
          'MBS improved modestly after the release and held most of the gain into the close. The 10-year yield dipped toward the low end of its recent range.',
        ],
      },
    ],
    takeaway: 'A “goldilocks” pattern — steady growth, cooling prices — is the friendliest backdrop for gradually lower mortgage rates.',
  },
  {
    date: '2026-10-05',
    title: 'Jobs Report Hangover: Reading the Revisions',
    summary: 'Friday’s payroll gain looked solid on the surface, but downward revisions and slower wage growth tell a softer story. Bonds recovered early losses.',
    durationSec: 402,
    tags: ['Jobs Report', 'Wages'],
    sections: [
      {
        heading: 'Headline versus detail',
        body: [
          'The headline payroll number beat expectations, briefly pushing yields higher. But the prior two months were revised lower, and average hourly earnings grew at the slowest pace in years. Once markets digested the full report, bonds recovered.',
        ],
      },
      {
        heading: 'Why revisions matter',
        body: [
          'The first estimate is based on incomplete survey responses. Consistent downward revisions often signal a labor market cooling faster than headlines suggest — which ultimately supports lower rates.',
        ],
      },
    ],
    takeaway: 'Do not react to the first five minutes after a jobs report; the detail usually tells the real story by mid-morning.',
  },
];

interface UpdateTopic {
  titles: string[];
  tag: string;
  body: string[];
  client: string;
}

const UPDATE_TOPICS: UpdateTopic[] = [
  {
    titles: ['Inflation Watch: What the Latest Prices Data Means for Rates', 'Prices Cooling at the Margin — and Why Bonds Noticed'],
    tag: 'Inflation',
    body: [
      'Inflation remains the primary driver of long-term rates. The trend in core services and shelter continues to soften, even as some goods categories firm up because of tariffs and supply costs.',
      'For mortgage rates, the direction of inflation matters more than any single month. A steady glide path lower gives bond investors confidence to accept lower yields.',
    ],
    client: 'Remind clients that lower inflation, not Fed headlines, is what ultimately brings mortgage rates down.',
  },
  {
    titles: ['Labor Market Check: Hiring Slows, Layoffs Stay Low', 'Jobless Claims and the Slow Cooling of the Job Market'],
    tag: 'Jobs',
    body: [
      'Hiring has slowed from its post-pandemic pace, but layoffs remain historically low. That “low hire, low fire” environment keeps wage growth moderating without a sharp rise in unemployment.',
      'Bonds tend to rally when labor data softens. The market is watching continuing claims in particular, which show how long it takes job seekers to find new work.',
    ],
    client: 'A stable job market supports buyer confidence — this is still a good environment to qualify and close.',
  },
  {
    titles: ['Housing Inventory Rebuilds: A Better Market for Buyers', 'More Listings, More Leverage for Buyers'],
    tag: 'Housing',
    body: [
      'Active listings continue to climb in most metros, and days on market are lengthening. Buyers have more choice and more negotiating power than at any time in the past several years.',
      'National home prices are still rising, just at a slower pace. Appreciation remains positive because demand from household formation continues to outstrip new construction over the long run.',
    ],
    client: 'Encourage buyers to ask for seller credits or rate buydowns — the leverage has shifted in their favor.',
  },
  {
    titles: ['Fed Speak and the Path of Policy', 'What Fed Officials Are Signaling About the Next Meeting'],
    tag: 'Fed',
    body: [
      'Several Fed officials spoke this week, broadly signaling patience. The committee appears comfortable with gradual easing as long as inflation keeps moving toward target.',
      'Remember that the Fed controls short-term rates. Mortgage rates follow the 10-year Treasury and MBS pricing, which respond to inflation expectations more than to the Fed Funds rate itself.',
    ],
    client: 'If a client asks “should I wait for the Fed to cut?”, explain that markets usually price cuts in long before they happen.',
  },
  {
    titles: ['Technical Picture: MBS Testing Resistance', 'Charts Matter: Where MBS Could Find Support'],
    tag: 'Technicals',
    body: [
      'Mortgage-backed securities are trading near a key ceiling defined by recent highs. Breaking above it would likely bring a further improvement in rate sheets; failing would suggest a period of consolidation.',
      'We use these technical levels to frame lock-versus-float decisions. Fundamentals tell us the direction; technicals help with timing.',
    ],
    client: 'Use the Markets Overview chart in client meetings to show why you recommend locking or floating today.',
  },
  {
    titles: ['Consumer Spending Holds Up — What That Means for Bonds', 'Retail Spending and the Resilient Consumer'],
    tag: 'Spending',
    body: [
      'Consumer spending continues to grow modestly, supported by real wage gains and household balance sheets that remain healthy overall. Lower-income households show more strain, with higher credit-card balances and delinquencies.',
      'Strong spending is a mild headwind for bonds because it keeps growth and inflation firm. Mixed data like this tends to keep rates range-bound.',
    ],
    client: 'Clients with high-rate card balances are prime candidates for a Debt Consolidation conversation.',
  },
  {
    titles: ['Global Bond Markets and U.S. Mortgage Rates', 'Why Overseas Yields Can Move Your Rate Sheet'],
    tag: 'Global',
    body: [
      'Yields in Europe and Japan influence U.S. Treasuries because global investors compare returns across countries. Rising yields abroad can pull U.S. yields higher even without domestic news.',
      'This morning’s overnight session was calm overseas, which removes one potential source of pressure on MBS.',
    ],
    client: 'Not every rate move is about U.S. data — set expectations that pricing can change on global news.',
  },
  {
    titles: ['Builder Confidence and the New-Construction Opportunity', 'New Homes: Incentives Are the Story'],
    tag: 'New Construction',
    body: [
      'Homebuilders are leaning on incentives — rate buydowns, closing-cost credits and price reductions — to keep sales moving. In many markets, new construction now competes directly with resale homes on monthly payment.',
      'Builder buydowns can make a payment comparison look dramatically different. Model them with Loan Comparison so clients see the true cost over their expected holding period.',
    ],
    client: 'Show clients a buydown versus a price reduction side by side — the better choice depends on how long they keep the loan.',
  },
];

function generatedUpdates(): Omit<DailyUpdate, 'id'>[] {
  const recent = new Set(RECENT_UPDATES.map((u) => u.date));
  const daily = getMbsDaily(getMarketSnapshot(DEMO_NOW));
  const idx = new Map(daily.map((p, i) => [p.t, i]));
  return tradingDaysBack('2026-10-02', '2026-06-01')
    .filter((d) => !recent.has(d))
    .map((date) => {
      const rand = mulberry32(hashString('update:' + date));
      const topic = pick(rand, UPDATE_TOPICS);
      const i = idx.get(date);
      // Direction of the day's move, consistent with the Markets chart / Market Wrap for that date.
      const move = i ? Math.round((daily[i].price - daily[i - 1].price) * 100) : 0;
      const dir = move > 2 ? 'improved' : move < -2 ? 'weakened' : 'were little changed';
      const opening = `Mortgage-backed securities ${dir}${Math.abs(move) > 2 ? ` by about ${Math.abs(move)} basis points` : ''} in early trading on ${longDate(date)}. ${
        move > 2 ? 'Rate sheets should be slightly better than yesterday.' : move < -2 ? 'Some lenders may reprice for the worse if losses extend.' : 'Expect pricing similar to yesterday’s.'
      }`;
      return {
        date,
        title: pick(rand, topic.titles),
        summary: `${opening} ${topic.body[0]}`.slice(0, 220).replace(/\s\S*$/, '') + '…',
        durationSec: 300 + Math.floor(rand() * 150),
        tags: [topic.tag],
        sections: [
          { heading: 'Market open', body: [opening] },
          { heading: topic.tag === 'Technicals' ? 'The chart' : 'The big picture', body: topic.body },
          { heading: 'How to talk about it with clients', body: [topic.client] },
        ],
        takeaway: move < -2 ? 'Lean toward locking loans closing in the next 15 days.' : 'Floating remains reasonable for loans closing 30+ days out — stay alert to reprices.',
      };
    });
}

let _updates: DailyUpdate[] | null = null;
/** All morning updates, newest first. */
export function getMorningUpdates(): DailyUpdate[] {
  if (!_updates) _updates = [...RECENT_UPDATES, ...generatedUpdates()].map((u) => ({ ...u, id: `mu-${u.date}` })).sort((a, b) => b.date.localeCompare(a.date));
  return _updates;
}

/* ================================================================== market wraps */

const RECENT_WRAPS: Omit<MarketWrap, 'id'>[] = [
  {
    date: '2026-10-13',
    title: 'Holiday Hangover: Quiet Session as Markets Await CPI',
    summary: 'MBS finished slightly better on light volume after the Columbus Day closure. Existing Home Sales firmed; all eyes now turn to Wednesday’s inflation report.',
    mbsClose: 100.33,
    mbsChangeBp: 4,
    tenYear: 4.118,
    sections: [
      { heading: 'Bonds', body: ['The UMBS 30-year 6.5% coupon closed at 100.33, up 4 basis points on the day. Trading volume ran well below average as many participants extended the holiday weekend. The 10-year Treasury yield ended near 4.12%.'] },
      { heading: 'Economic data', body: ['Existing Home Sales rose to a 4.11 million annualized pace, slightly ahead of expectations. Inventory improved again, and the median existing-home price was up modestly year over year. The weekly ADP estimate pointed to steady but unspectacular private hiring.'] },
      { heading: 'Stocks and commodities', body: ['Equities edged higher led by financials ahead of bank earnings. Oil slipped on expectations of ample supply, which helps the inflation outlook at the margin.'] },
      { heading: 'Looking ahead', body: ['Wednesday: CPI at 8:30 AM ET and the Beige Book at 2:00 PM ET. Thursday: Retail Sales and Jobless Claims. Friday: Industrial Production and Capacity Utilization.'] },
    ],
  },
  {
    date: '2026-10-09',
    title: 'Bonds Close Out a Solid Week',
    summary: 'MBS added to weekly gains as inflation expectations eased. Rates finish the week near their best levels of the month heading into a long weekend.',
    mbsClose: 100.29,
    mbsChangeBp: 9,
    tenYear: 4.132,
    sections: [
      { heading: 'Bonds', body: ['MBS gained 9 basis points on the session and roughly 25 basis points on the week. The 10-year yield ended the week near 4.13%, down from about 4.22% a week earlier.'] },
      { heading: 'Economic data', body: ['Consumer sentiment eased slightly, and one-year inflation expectations moved lower for a third month — the most bond-friendly detail of the day.'] },
      { heading: 'Looking ahead', body: ['The bond market is closed Monday for Columbus Day. CPI on Wednesday is the main event next week.'] },
    ],
  },
  {
    date: '2026-10-08',
    title: 'Strong Auction Keeps Afternoon Calm',
    summary: 'A well-received 10-year note auction allowed MBS to hold early gains. Rate sheets were stable throughout the afternoon.',
    mbsClose: 100.2,
    mbsChangeBp: 6,
    tenYear: 4.158,
    sections: [
      { heading: 'Bonds', body: ['MBS ended 6 basis points higher. The 10-year note auction stopped through the when-issued yield with solid foreign participation, removing the usual afternoon reprice risk.'] },
      { heading: 'Fed', body: ['Minutes from the September meeting showed broad agreement that policy can ease gradually, with a few members concerned about sticky services inflation.'] },
    ],
  },
  {
    date: '2026-10-07',
    title: 'Range-Bound Trading as Applications Climb',
    summary: 'MBS traded in a narrow range while mortgage applications rose again. Purchase demand continues to respond to improved affordability.',
    mbsClose: 100.14,
    mbsChangeBp: -2,
    tenYear: 4.176,
    sections: [
      { heading: 'Bonds', body: ['MBS slipped 2 basis points in light trading. There was little economic data to move markets, and investors held positions ahead of the Treasury auctions later in the week.'] },
      { heading: 'Housing', body: ['Weekly purchase applications increased for the third time in four weeks. Refinance activity remained concentrated among borrowers with rates above 7%.'] },
    ],
  },
];

const WRAP_THEMES = [
  { t: 'Data-Light Session Leaves Bonds Range-Bound', s: 'With little on the calendar, MBS traded in a narrow band and lenders held pricing steady.' },
  { t: 'Inflation Data Drives the Day', s: 'Price data set the tone for bonds, with the core reading drawing most of the attention.' },
  { t: 'Labor Numbers in Focus', s: 'Jobs data moved yields as traders reassessed the pace of labor-market cooling.' },
  { t: 'Stocks Rally, Bonds Take a Breather', s: 'Strength in equities pulled money away from bonds, nudging yields higher into the close.' },
  { t: 'Flight to Quality Helps MBS', s: 'Global uncertainty sent investors toward Treasuries and MBS, improving rate sheets.' },
  { t: 'Housing Reports Show Steady Demand', s: 'Home sales and builder data pointed to a slowly healing housing market as inventory rebuilds.' },
  { t: 'Fed Speakers Keep Markets Guessing', s: 'Mixed messages from Fed officials kept bonds choppy throughout the session.' },
  { t: 'Afternoon Reprice Risk After Weak Auction', s: 'Soft demand at a Treasury auction weighed on long-term rates late in the day.' },
];

function generatedWraps(): Omit<MarketWrap, 'id'>[] {
  const recent = new Set(RECENT_WRAPS.map((w) => w.date));
  // Closes come from the same deterministic daily series the Markets chart uses.
  const daily = getMbsDaily(getMarketSnapshot(DEMO_NOW));
  const idx = new Map(daily.map((p, i) => [p.t, i]));
  return tradingDaysBack('2026-10-06', '2026-06-01')
    .filter((d) => !recent.has(d) && idx.has(d))
    .map((date) => {
      const rand = mulberry32(hashString('wrap:' + date));
      const i = idx.get(date)!;
      const close = daily[i].price;
      const bp = Math.round((close - (daily[i - 1]?.price ?? close)) * 100);
      const theme = pick(rand, WRAP_THEMES);
      const ten = Math.round((4.118 + (100.33 - close) * 0.35 + (rand() - 0.5) * 0.02) * 1000) / 1000;
      return {
        date,
        title: theme.t,
        summary: `${theme.s} MBS closed ${bp === 0 ? 'unchanged' : `${bp > 0 ? 'up' : 'down'} ${Math.abs(bp)} basis points`}.`,
        mbsClose: close,
        mbsChangeBp: bp,
        tenYear: ten,
        sections: [
          { heading: 'Bonds', body: [`The UMBS 30-year 6.5% coupon closed at ${close.toFixed(2)}, ${bp === 0 ? 'unchanged' : `${bp > 0 ? 'up' : 'down'} ${Math.abs(bp)} basis points`}. The 10-year Treasury yield ended near ${ten.toFixed(2)}%.`] },
          { heading: 'What drove the market', body: [theme.s, 'Trading volume was near average, and lenders made only minor intraday pricing adjustments.'] },
          { heading: 'Looking ahead', body: ['Check the Economic Calendar for tomorrow’s releases and times. Lock decisions for near-term closings should account for any high-importance reports before 10:00 AM ET.'] },
        ],
      };
    });
}

let _wraps: MarketWrap[] | null = null;
export function getMarketWraps(): MarketWrap[] {
  if (!_wraps) _wraps = [...RECENT_WRAPS, ...generatedWraps()].map((w) => ({ ...w, id: `mw-${w.date}` })).sort((a, b) => b.date.localeCompare(a.date));
  return _wraps;
}

/** Plain-text / Markdown export of a wrap for the Download button. */
export function wrapToMarkdown(w: MarketWrap): string {
  const lines = [
    `# Market Wrap — ${parseIsoDate(w.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`,
    '',
    `## ${w.title}`,
    '',
    w.summary,
    '',
    `- UMBS 30YR 6.5% close: ${w.mbsClose.toFixed(2)} (${w.mbsChangeBp >= 0 ? '+' : ''}${w.mbsChangeBp}bp)`,
    `- 10-Year Treasury: ${w.tenYear.toFixed(3)}%`,
    '',
  ];
  for (const s of w.sections) {
    lines.push(`### ${s.heading}`, '', ...s.body.flatMap((p) => [p, '']));
  }
  lines.push('---', 'Demo content generated for the MBS Highway redesign prototype. Not investment advice.');
  return lines.join('\n');
}

/* ================================================================== Mauldin */

export const MAULDIN_ISSUES: MauldinIssue[] = [
  {
    id: 'tf-2026-10-10',
    date: '2026-10-10',
    title: 'The Shelter Lag and the Long Road to 2%',
    dek: 'Why the slowest-moving piece of the inflation basket may be the most important for the next year of interest rates.',
    sections: [
      {
        heading: 'A number that looks backward',
        body: [
          'Every month, investors parse the consumer price index as if it were a live feed of the economy. It is not. The largest single component — the cost of shelter — is built from rents that were signed months ago and an imputed “owners’ equivalent rent” that moves even more slowly. In practice, the official shelter figure tells us what the rental market looked like roughly a year earlier.',
          'That lag is not a flaw so much as a feature of how rents work. Leases reset once a year, so the average rent paid across the country adjusts gradually even when asking rents change quickly. The upshot is that inflation statistics can look stubborn long after the underlying pressure has faded.',
        ],
      },
      {
        heading: 'What real-time rents are saying',
        body: [
          'Private indexes of new leases have been flat to slightly lower for well over a year in many large metros, reflecting a wave of apartment completions. If the official series follows the private ones with its customary delay, shelter inflation should keep decelerating through 2027.',
          'Shelter carries roughly a third of the weight in CPI and an even larger share of core. A steady decline there could subtract meaningfully from headline inflation even if goods prices remain firm because of tariffs and supply-chain costs.',
        ],
      },
      {
        heading: 'The counterweight: goods and services ex-housing',
        body: [
          'It would be a mistake to assume a straight line to target. Goods prices, which deflated after the pandemic supply shock healed, have been edging up. Services excluding housing — insurance, healthcare, repairs — are tied closely to wages, and wage growth, while moderating, is still above the pace consistent with 2% inflation.',
          'So the likely path is a tug-of-war: shelter pulling inflation down, parts of goods and services pushing it up. The net is probably gradual disinflation, not a collapse in prices.',
        ],
      },
      {
        heading: 'Implications for long-term rates',
        body: [
          'For the bond market, the direction of travel matters more than the destination. If investors gain confidence that inflation is sustainably drifting lower, they will accept lower yields on long-dated debt. That is the mechanism by which mortgage rates fall — not through the Fed’s overnight rate directly, but through the term premium investors demand for lending for decades.',
          'Fiscal deficits remain the wild card. Heavy Treasury issuance requires buyers, and buyers want compensation. That tension is why I expect long rates to decline more slowly than short rates over the next year.',
        ],
      },
      {
        heading: 'What I am watching',
        body: [
          'Three things: the monthly change in owners’ equivalent rent, the breadth of price increases across the core basket, and Treasury auction demand at the long end. If the first two keep softening and the third stays healthy, the path to lower mortgage rates remains intact.',
        ],
      },
    ],
  },
  {
    id: 'tf-2026-10-03',
    date: '2026-10-03',
    title: 'Low Hire, Low Fire: An Unusual Labor Market',
    dek: 'Companies have stopped hiring aggressively but are not laying people off. How long can that equilibrium last?',
    sections: [
      {
        heading: 'A strange kind of cooling',
        body: [
          'In most cycles, a slowing labor market announces itself through layoffs. This time, the adjustment has come almost entirely through fewer new hires. Job openings have fallen steadily, quit rates are back to pre-pandemic levels, and yet initial unemployment claims remain low by historical standards.',
          'Employers who struggled to staff up in 2021 and 2022 appear reluctant to let workers go. That “labor hoarding” has kept unemployment contained even as hiring slows.',
        ],
      },
      {
        heading: 'Why it matters for inflation',
        body: [
          'Fewer job switchers means less wage pressure. Workers who change jobs typically command larger raises than those who stay put; as quits decline, aggregate wage growth cools. That is helping services inflation ease without the pain of mass layoffs.',
        ],
      },
      {
        heading: 'The risk in the equilibrium',
        body: [
          'The danger is that a low-hiring economy leaves little cushion. If demand weakens, companies that have been holding onto workers could cut quickly, and job seekers would find few openings. Continuing claims — people who remain on benefits — have been creeping higher, a subtle sign that finding work is getting harder.',
        ],
      },
      {
        heading: 'What it means for rates and housing',
        body: [
          'A gently cooling labor market is close to ideal for bonds: it lowers inflation risk without triggering a demand collapse. For housing, stable employment keeps buyers confident and default rates low. A sudden turn would bring rates down faster but would hurt demand. The base case remains gradual.',
        ],
      },
    ],
  },
  {
    id: 'tf-2026-09-26',
    date: '2026-09-26',
    title: 'Deficits, Duration and the Term Premium',
    dek: 'The bond market is asking for more compensation to lend long. Here is why, and what could change it.',
    sections: [
      {
        heading: 'The price of lending for ten years',
        body: [
          'The “term premium” is the extra yield investors demand to hold a long-term bond rather than rolling short-term bills. For much of the last decade it was negligible or even negative. It has since returned, and that explains why long-term rates have not fallen as much as the Fed’s policy rate.',
        ],
      },
      {
        heading: 'Supply is the story',
        body: [
          'Large federal deficits require steady issuance of Treasuries. At the same time, some traditional buyers — the Fed itself, certain foreign central banks — have stepped back. More supply and fewer price-insensitive buyers mean the remaining investors set the price, and they want to be paid for duration risk.',
        ],
      },
      {
        heading: 'Mortgage spreads are a second lever',
        body: [
          'Mortgage rates sit on top of Treasury yields plus a spread. That spread widened sharply in 2022 and 2023 as rate volatility rose and banks pulled back from buying MBS. It has narrowed since but remains above its long-run average. If volatility keeps calming, spreads can tighten further — lowering mortgage rates even if Treasury yields barely move.',
        ],
      },
      {
        heading: 'Bottom line',
        body: [
          'I do not expect a return to 3% mortgages. But a combination of gradual disinflation, calmer volatility and narrower spreads can deliver meaningfully better rates than the peaks of the last few years.',
        ],
      },
    ],
  },
  {
    id: 'tf-2026-09-19',
    date: '2026-09-19',
    title: 'After the Cut: Reading the Fed’s New Projections',
    dek: 'The September meeting delivered the expected move. The more interesting signal was in the dot plot.',
    sections: [
      {
        heading: 'The decision',
        body: [
          'The Federal Reserve lowered its policy rate by a quarter point, as markets had anticipated. The statement acknowledged slower job gains and inflation that remains somewhat elevated.',
        ],
      },
      {
        heading: 'The dots',
        body: [
          'Committee members’ projections showed a wide dispersion of views on how far rates should fall over the next year. The median implied a gradual path, but several participants preferred a pause. That divergence tells us the Fed is genuinely data-dependent rather than on autopilot.',
        ],
      },
      {
        heading: 'Why mortgage rates did not plunge',
        body: [
          'Markets had priced the cut weeks in advance. Long-term rates respond to expectations about the entire future path of policy and inflation, not to the decision itself. That is why the most common client question — “Should I wait until the Fed cuts?” — usually has the answer “It already happened in the market.”',
        ],
      },
    ],
  },
  {
    id: 'tf-2026-09-12',
    date: '2026-09-12',
    title: 'The Housing Shortage Has Not Gone Away',
    dek: 'Inventory is rising, but the structural deficit of homes built over the past fifteen years still shapes prices.',
    sections: [
      {
        heading: 'Two stories at once',
        body: [
          'Listings are up sharply from their lows, days on market are longer, and buyers are negotiating again. Yet national home prices are still rising. Both can be true because the inventory recovery started from an extraordinarily low base.',
        ],
      },
      {
        heading: 'The construction gap',
        body: [
          'For roughly a decade after the 2008 crisis, the country built fewer homes than it formed households. Estimates of the cumulative shortfall vary, but nearly all of them are measured in millions of units. Builders have closed part of the gap, especially in the Sun Belt, but not all of it.',
        ],
      },
      {
        heading: 'The lock-in effect is fading',
        body: [
          'Owners with sub-4% mortgages were reluctant to sell. Each year, more of them move anyway — for jobs, family, or space — and the share of outstanding loans with rates above 6% keeps growing. That slow thaw adds supply without collapsing prices.',
        ],
      },
      {
        heading: 'What it means for buyers',
        body: [
          'A more balanced market is good news for buyers who can now negotiate. But a persistent structural shortage means appreciation is likely to remain positive. Waiting for prices to fall meaningfully is a bet against the long-term math.',
        ],
      },
    ],
  },
  {
    id: 'tf-2026-09-05',
    date: '2026-09-05',
    title: 'Tariffs and the Price Level: A One-Time Shift or a Trend?',
    dek: 'Higher import costs show up in goods prices. Whether they become persistent inflation depends on wages and expectations.',
    sections: [
      {
        heading: 'Level versus rate',
        body: [
          'Economists distinguish between a one-time increase in the price level and an ongoing increase in the rate of inflation. Tariffs typically cause the former: prices step up once as costs pass through, then stabilize.',
        ],
      },
      {
        heading: 'When a step becomes a staircase',
        body: [
          'The risk is that higher prices feed into wage demands and inflation expectations, turning a one-time step into a staircase. So far, expectations surveys have remained anchored and wage growth continues to moderate, which argues for the benign interpretation.',
        ],
      },
      {
        heading: 'Market implications',
        body: [
          'Bond markets have largely looked through tariff-driven goods inflation, focusing instead on services and shelter. As long as that remains the case, the impact on mortgage rates should be limited.',
        ],
      },
    ],
  },
  {
    id: 'tf-2026-08-29',
    date: '2026-08-29',
    title: 'Notes From the Mountains: Productivity and Patience',
    dek: 'Reflections on whether new technology can lift productivity enough to square strong growth with lower inflation.',
    sections: [
      {
        heading: 'The productivity question',
        body: [
          'Productivity growth determines how fast an economy can grow without generating inflation. After a weak decade, measured productivity has improved, and there is a lively debate about whether new technologies will sustain the gains.',
        ],
      },
      {
        heading: 'Why it matters for rates',
        body: [
          'Higher productivity allows wages to rise without pushing up prices. If the improvement proves durable, the economy can grow at a healthy clip while inflation continues to cool — the best of both worlds for bond investors and borrowers.',
        ],
      },
      {
        heading: 'A note of caution',
        body: [
          'Productivity statistics are noisy and frequently revised. I would want to see several more years of data before declaring a new era. In the meantime, the investment boom itself adds to demand and can keep rates firmer in the short run.',
        ],
      },
    ],
  },
  {
    id: 'tf-2026-08-22',
    date: '2026-08-22',
    title: 'Jackson Hole Preview: The Framework and the Moment',
    dek: 'What to listen for when central bankers gather to talk about the long run.',
    sections: [
      {
        heading: 'Why this conference matters',
        body: [
          'The annual symposium is less about the next meeting than about how the Fed thinks. Speeches here have historically signaled shifts in strategy that played out over years.',
        ],
      },
      {
        heading: 'What I will listen for',
        body: [
          'First, how the Chair characterizes the balance of risks between inflation and employment. Second, any discussion of the neutral rate — the level at which policy neither stimulates nor restrains. A higher estimate of neutral implies fewer cuts ahead.',
        ],
      },
      {
        heading: 'For mortgage markets',
        body: [
          'Long rates will respond to signals about the destination for policy, not just the next step. A message of patience could keep mortgage rates range-bound; a clear acknowledgment of labor-market softening would likely help bonds.',
        ],
      },
    ],
  },
];

/* ================================================================== Barry's Insights */

export const WEBINARS: Webinar[] = [
  {
    id: 'w-2026-10-08', date: '2026-10-08', title: 'Q4 Market Outlook: Rates, Inventory and the Spring Setup', kind: 'Market Outlook', durationSec: 3480,
    description: 'Where we see mortgage rates heading through year-end, why inventory gains are a buyer opportunity, and how to position your pipeline now for a strong spring.',
    topics: ['Rates outlook', 'Inventory', 'Pipeline'],
    chapters: [{ at: 0, label: 'Welcome & agenda' }, { at: 420, label: 'Inflation and the bond market' }, { at: 1500, label: 'Housing supply and prices' }, { at: 2460, label: 'Pipeline strategy' }, { at: 3120, label: 'Q&A' }],
  },
  {
    id: 'w-2026-10-01', date: '2026-10-01', title: 'Running the Client Meeting: From Report Card to Loan Comparison', kind: 'Training', durationSec: 2700,
    description: 'A start-to-finish walkthrough of the client meeting flow: Real Estate Report Card, Buy vs Rent, Loan Comparison, Cost of Waiting and Appreciation — with talk tracks for each.',
    topics: ['RERC', 'Loan Comparison', 'Talk tracks'],
    chapters: [{ at: 0, label: 'Why the order matters' }, { at: 360, label: 'Report Card' }, { at: 900, label: 'Buy vs Rent' }, { at: 1500, label: 'Loan Comparison' }, { at: 2100, label: 'Cost of Waiting & Appreciation' }],
  },
  {
    id: 'w-2026-09-24', date: '2026-09-24', title: 'Refi Season Playbook: Finding the Clients Who Are In the Money', kind: 'Sales Strategy', durationSec: 2520,
    description: 'How to use Strike Rate and Refi Risk of Waiting to prioritize past clients, structure the conversation, and avoid over-promising on timing.',
    topics: ['Strike Rate', 'Refinance', 'Database'],
    chapters: [{ at: 0, label: 'The refi window' }, { at: 540, label: 'Setting Strike Rate targets' }, { at: 1320, label: 'Cost of delaying a refi' }, { at: 1980, label: 'Scripts & follow-up' }],
  },
  {
    id: 'w-2026-09-17', date: '2026-09-17', title: 'Fed Decision Live Breakdown', kind: 'Market Outlook', durationSec: 2100,
    description: 'Same-day analysis of the September FOMC decision, the new projections, and what it means — and does not mean — for mortgage rates.',
    topics: ['Fed', 'FOMC', 'Rates'],
    chapters: [{ at: 0, label: 'The decision' }, { at: 480, label: 'Dot plot' }, { at: 1140, label: 'Mortgage-rate impact' }, { at: 1680, label: 'Client messaging' }],
  },
  {
    id: 'w-2026-09-10', date: '2026-09-10', title: 'Buydowns vs Price Cuts: Showing the True Cost', kind: 'Training', durationSec: 2340,
    description: 'Model seller concessions, temporary buydowns and permanent buydowns side by side, and explain the break-even point in plain English.',
    topics: ['Seller Contribution', 'Buydowns', 'Loan Comparison'],
    chapters: [{ at: 0, label: 'The concession landscape' }, { at: 600, label: 'Temporary buydowns' }, { at: 1260, label: 'Permanent buydowns' }, { at: 1800, label: 'Break-even talk track' }],
  },
  {
    id: 'w-2026-09-03', date: '2026-09-03', title: 'Working With Agents in a Balanced Market', kind: 'Sales Strategy', durationSec: 2580,
    description: 'What listing and buyer agents need from their lender right now, and how to use co-branded reports to become their go-to partner.',
    topics: ['Agents', 'Co-branding', 'Marketing'],
    chapters: [{ at: 0, label: 'What changed for agents' }, { at: 720, label: 'Co-branded reports' }, { at: 1500, label: 'Open house strategy' }, { at: 2100, label: 'Q&A' }],
  },
  {
    id: 'w-2026-08-27', date: '2026-08-27', title: 'Jackson Hole Takeaways', kind: 'Market Outlook', durationSec: 1980,
    description: 'Key messages from the central bank symposium and how they shape the rate outlook for the fall.',
    topics: ['Fed', 'Neutral rate'],
    chapters: [{ at: 0, label: 'The speech' }, { at: 600, label: 'Neutral rate debate' }, { at: 1260, label: 'What it means for MBS' }],
  },
  {
    id: 'w-2026-08-20', date: '2026-08-20', title: 'Mastering the Markets Overview Screen', kind: 'Training', durationSec: 1860,
    description: 'Read the MBS chart, the treasury curve and the economic calendar like a pro — and turn them into a lock-or-float recommendation.',
    topics: ['Markets', 'Lock vs float', 'Technicals'],
    chapters: [{ at: 0, label: 'The MBS chart' }, { at: 540, label: 'Support & resistance' }, { at: 1080, label: 'Economic calendar' }, { at: 1500, label: 'Lock-or-float framework' }],
  },
  {
    id: 'w-2026-08-13', date: '2026-08-13', title: 'Debt Consolidation Conversations That Help Clients', kind: 'Sales Strategy', durationSec: 2220,
    description: 'Identify clients carrying high-rate revolving debt and show the monthly cash-flow impact of consolidating into a refinance or move-up purchase.',
    topics: ['Debt Consolidation', 'Cash flow'],
    chapters: [{ at: 0, label: 'Spotting the opportunity' }, { at: 660, label: 'Running the numbers' }, { at: 1440, label: 'Presenting responsibly' }],
  },
  {
    id: 'w-2026-08-06', date: '2026-08-06', title: 'August Market Update: Jobs, Inflation and the Summer Rally', kind: 'Market Outlook', durationSec: 2880,
    description: 'Breaking down the July jobs report and inflation data, and why MBS have rallied over the summer.',
    topics: ['Jobs', 'Inflation', 'MBS'],
    chapters: [{ at: 0, label: 'Jobs report' }, { at: 900, label: 'Inflation' }, { at: 1800, label: 'MBS technicals' }, { at: 2400, label: 'Q&A' }],
  },
  {
    id: 'w-2026-07-23', date: '2026-07-23', title: 'Social Studio Workshop: Video That Converts', kind: 'Training', durationSec: 2040,
    description: 'Record short, compliant market videos with Social Studio scripts, and build a consistent posting rhythm.',
    topics: ['Social Studio', 'Video', 'Marketing'],
    chapters: [{ at: 0, label: 'Why video works' }, { at: 540, label: 'Using scripts' }, { at: 1200, label: 'Recording tips' }, { at: 1680, label: 'Posting cadence' }],
  },
  {
    id: 'w-2026-07-09', date: '2026-07-09', title: 'Mid-Year Housing Forecast', kind: 'Market Outlook', durationSec: 3240,
    description: 'Home price expectations by region, the outlook for inventory and what the second half of the year could bring for rates.',
    topics: ['Home prices', 'Forecast'],
    chapters: [{ at: 0, label: 'First-half review' }, { at: 900, label: 'Regional prices' }, { at: 1980, label: 'Second-half outlook' }, { at: 2760, label: 'Q&A' }],
  },
  {
    id: 'w-2026-06-25', date: '2026-06-25', title: 'Cost of Waiting: Overcoming “Let’s Wait for Rates to Drop”', kind: 'Sales Strategy', durationSec: 1920,
    description: 'Use appreciation and payment math to show buyers what waiting really costs — even when rates fall.',
    topics: ['Cost of Waiting', 'Objection handling'],
    chapters: [{ at: 0, label: 'The objection' }, { at: 480, label: 'Running the scenario' }, { at: 1140, label: 'Talk track' }],
  },
  {
    id: 'w-2026-06-11', date: '2026-06-11', title: 'Building Your Weekly Newsletter Habit', kind: 'Training', durationSec: 1680,
    description: 'Set up the weekly client newsletter, personalize it, and measure what your database responds to.',
    topics: ['Newsletter', 'Database'],
    chapters: [{ at: 0, label: 'Setup' }, { at: 600, label: 'Personalization' }, { at: 1140, label: 'Measuring results' }],
  },
];

/* ================================================================== today's articles */

export const TODAYS_ARTICLES: ShortArticle[] = [
  {
    id: 'a-cpi', date: '2026-10-14', time: '8:41 AM', category: 'Economy',
    title: 'September CPI: Core Cools to 0.2% as Shelter Eases',
    summary: 'Headline consumer prices matched expectations while the core reading came in a tenth below forecast — a constructive result for bonds.',
    body: [
      'Consumer prices rose 0.3% in September, in line with forecasts, while core prices excluding food and energy rose 0.2% versus expectations of 0.3%.',
      'Shelter inflation continued to decelerate, rising at its slowest monthly pace in several years. Goods prices were mixed, with some tariff-exposed categories firming.',
      'For mortgage rates, the softer core reading supports the recent improvement in MBS. One report does not make a trend, but the three-month pace of core inflation is now running close to the Fed’s comfort zone.',
    ],
  },
  {
    id: 'a-lock', date: '2026-10-14', time: '9:15 AM', category: 'Strategy',
    title: 'Lock or Float Into the Beige Book?',
    summary: 'With MBS testing overhead resistance, here is a simple framework for today’s lock decisions by closing date.',
    body: [
      'Closing within 15 days: lock. The upside of floating is limited while MBS sit just under resistance, and an afternoon reprice would erase it.',
      'Closing in 15–45 days: floating is reasonable with a defined trigger — if MBS lose roughly 20 basis points from this morning’s level, lock.',
      'Closing beyond 45 days: consider a float-down option if your secondary desk offers one at a reasonable cost.',
    ],
  },
  {
    id: 'a-inventory', date: '2026-10-14', time: '7:30 AM', category: 'Housing',
    title: 'Inventory Watch: Buyers Have the Most Choice Since 2020',
    summary: 'Active listings continue to rise and months’ supply is approaching balance in many markets. What it means for your purchase pipeline.',
    body: [
      'Active listings are up meaningfully from a year ago, and new listings are outpacing pending sales in many metros. Months’ supply is approaching the four-to-five month range many consider balanced.',
      'Buyers have more negotiating leverage: seller credits toward closing costs or rate buydowns are increasingly common. Use Seller Contribution and Loan Comparison to show the true cost of each option.',
    ],
  },
  {
    id: 'a-refi', date: '2026-10-14', time: '7:05 AM', category: 'Rates',
    title: 'The Refi Pocket: Who Benefits at Today’s Rates',
    summary: 'Borrowers who locked above 7% in 2023–2024 are increasingly in the money. A quick guide to finding them.',
    body: [
      'A half-point rate improvement on a $400,000 loan saves roughly $130 per month; a full point saves more than $260. For clients who closed at 7.5% or higher, today’s market already offers a meaningful benefit.',
      'Use Strike Rate to monitor targets automatically and Refi Risk of Waiting to show clients the cost of delaying once they are in the money.',
    ],
  },
];
