/**
 * DEMO DATA — Agent Feed. INFERRED: the live Agent Feed could not be accessed during the
 * observation session, so these cards are a designed take on "content an LO shares with
 * realtor partners". Addresses, listings and posts are synthetic.
 */

export type FeedKind = 'market' | 'listing' | 'rate-alert' | 'post';

export const FEED_KIND_LABELS: Record<FeedKind, string> = {
  market: 'Market snapshot',
  listing: 'Listing flyer',
  'rate-alert': 'Rate-move alert',
  post: 'Shareable post',
};

interface Base {
  id: string;
  kind: FeedKind;
  title: string;
  postedAt: string; // ISO
  tags: string[];
}

export interface MarketItem extends Base {
  kind: 'market';
  /** 'live' cards read the market ticker adapter; 'static' cards carry their own stats. */
  source: 'live' | 'static';
  stats?: { label: string; value: string; tone?: 'gain' | 'loss' }[];
  body: string;
}

export interface ListingItem extends Base {
  kind: 'listing';
  address: string;
  city: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  downPct: number;
  ratePct: number;
  product: string;
  taxMonthly: number;
  insuranceMonthly: number;
  hoaMonthly?: number;
  agentIndex: number;
  palette: 'brand' | 'emerald' | 'sky';
}

export interface RateAlertItem extends Base {
  kind: 'rate-alert';
  product: string;
  fromPct: number;
  toPct: number;
  exampleLoan: number;
  body: string;
}

export interface PostItem extends Base {
  kind: 'post';
  body: string;
  hashtags: string[];
}

export type FeedItem = MarketItem | ListingItem | RateAlertItem | PostItem;

const d = (s: string) => new Date(s).toISOString();

export const AGENT_FEED: FeedItem[] = [
  {
    id: 'f-1',
    kind: 'market',
    source: 'live',
    title: 'Today’s bond market in one glance',
    postedAt: d('2026-10-14T13:30:00Z'),
    tags: ['Daily', 'Rates'],
    body: 'Mortgage bonds set the direction for rates. Here’s where they stand this morning — forward to buyers who are rate-watching.',
  },
  {
    id: 'f-2',
    kind: 'rate-alert',
    title: '30-yr fixed estimate eases to 7.125%',
    product: '30-Yr Fixed',
    fromPct: 7.25,
    toPct: 7.125,
    exampleLoan: 400_000,
    postedAt: d('2026-10-14T12:10:00Z'),
    tags: ['Rates', 'Buyers'],
    body: 'An eighth of a point lower than the locked-in average. Good moment to nudge buyers who were waiting on the sidelines.',
  },
  {
    id: 'f-3',
    kind: 'listing',
    title: 'Co-branded flyer: 2100 Ross Ave #1204',
    address: '2100 Ross Ave #1204',
    city: 'Dallas, TX 75201',
    price: 500_000,
    beds: 2,
    baths: 2,
    sqft: 1420,
    downPct: 20,
    ratePct: 7.125,
    product: '30-yr fixed',
    taxMonthly: 700,
    insuranceMonthly: 150,
    agentIndex: 1,
    palette: 'brand',
    postedAt: d('2026-10-13T20:00:00Z'),
    tags: ['Listing', 'Dallas'],
  },
  {
    id: 'f-4',
    kind: 'market',
    source: 'static',
    title: 'Marlboro, NJ 07746 — October snapshot',
    postedAt: d('2026-10-13T14:00:00Z'),
    tags: ['Local', 'New Jersey'],
    stats: [
      { label: 'Median sale price', value: '$812K' },
      { label: 'Days on market', value: '21', tone: 'gain' },
      { label: 'Months of supply', value: '1.9' },
    ],
    body: 'Still a seller’s market: under two months of supply and homes going under contract in about three weeks.',
  },
  {
    id: 'f-5',
    kind: 'post',
    title: 'Renting vs. owning — the $2,800 question',
    postedAt: d('2026-10-12T15:00:00Z'),
    tags: ['Buyers', 'Education'],
    body: 'Paying $2,800/month in rent? That’s $33,600 a year building someone else’s equity. With rents rising ~3% a year, the gap between renting and owning widens every lease renewal. Ask me for a free Buy vs Rent breakdown for your budget.',
    hashtags: ['#homebuying', '#rentvsbuy', '#realestate'],
  },
  {
    id: 'f-6',
    kind: 'listing',
    title: 'Co-branded flyer: 18 Juniper Ct',
    address: '18 Juniper Ct',
    city: 'Marlboro, NJ 07746',
    price: 652_500,
    beds: 4,
    baths: 2.5,
    sqft: 2380,
    downPct: 3.5,
    ratePct: 6.625,
    product: 'FHA 30-yr',
    taxMonthly: 1_190,
    insuranceMonthly: 140,
    agentIndex: 0,
    palette: 'emerald',
    postedAt: d('2026-10-11T18:30:00Z'),
    tags: ['Listing', 'New Jersey', 'FHA'],
  },
  {
    id: 'f-7',
    kind: 'rate-alert',
    title: 'VA rates dip to 6.375%',
    product: 'VA 30-Yr',
    fromPct: 6.5,
    toPct: 6.375,
    exampleLoan: 450_000,
    postedAt: d('2026-10-10T12:00:00Z'),
    tags: ['Rates', 'VA'],
    body: 'Veteran buyers: zero down and one of the lowest rates on the board. Share with agents who work with military families.',
  },
  {
    id: 'f-8',
    kind: 'post',
    title: 'Why a strong pre-approval wins offers',
    postedAt: d('2026-10-09T16:00:00Z'),
    tags: ['Sellers’ market', 'Education'],
    body: 'In a multiple-offer situation, the strongest offer isn’t always the highest — it’s the one most likely to close. A fully underwritten pre-approval tells the listing agent your financing is already done. Let’s get you there before you fall in love with a house.',
    hashtags: ['#preapproval', '#homebuyers'],
  },
  {
    id: 'f-9',
    kind: 'listing',
    title: 'Co-branded flyer: 4417 Travis St',
    address: '4417 Travis St',
    city: 'Dallas, TX 75205',
    price: 725_000,
    beds: 3,
    baths: 3,
    sqft: 2150,
    downPct: 20,
    ratePct: 7.125,
    product: '30-yr fixed',
    taxMonthly: 1_210,
    insuranceMonthly: 210,
    hoaMonthly: 85,
    agentIndex: 1,
    palette: 'sky',
    postedAt: d('2026-10-08T19:00:00Z'),
    tags: ['Listing', 'Dallas'],
  },
  {
    id: 'f-10',
    kind: 'post',
    title: 'Open house weekend: know your number',
    postedAt: d('2026-10-07T14:00:00Z'),
    tags: ['Open house', 'Buyers'],
    body: 'Touring open houses this weekend? Know your monthly payment before you walk in. Text me the list price and I’ll send back the full payment — principal, interest, taxes and insurance — in minutes.',
    hashtags: ['#openhouse', '#weekend'],
  },
];
