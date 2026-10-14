/**
 * DEMO DATA — Presentation Expressway. Original synthetic outlines and slide copy written
 * for the prototype (the live site hosts Barry Habib's own decks and videos).
 */

export interface Slide {
  title: string;
  /** Optional big number / statement. */
  stat?: string;
  statLabel?: string;
  bullets: string[];
}

export interface Presentation {
  id: string;
  title: string;
  featured?: boolean;
  topic: string;
  summary: string;
  durationSec: number;
  talkingPoints: string[];
  related?: { label: string; href: string };
  slides: Slide[];
  keywords: string[];
}

export const PRESENTATIONS: Presentation[] = [
  {
    id: 'power-of-leverage',
    title: 'The Power of Leverage',
    featured: true,
    topic: 'Homeownership',
    summary: 'How a modest down payment controls a large appreciating asset — and why that makes real estate one of the best wealth builders available to everyday families.',
    durationSec: 612,
    keywords: ['leverage', 'roi', 'down payment', 'wealth', 'appreciation', 'equity'],
    talkingPoints: [
      'A 20% down payment controls 100% of the home’s appreciation.',
      'On $500,000 with $100,000 down, a 4% gain in value is $20,000 — a 20% return on the cash invested.',
      'Add principal paydown and the return on cash grows further every year.',
      'Leverage works both ways: a long horizon and a fixed payment are what make it safe.',
      'Close by tying the numbers back to the client’s own price range.',
    ],
    related: { label: 'Appreciation', href: '/members/appreciation' },
    slides: [
      { title: 'The Power of Leverage', bullets: ['Why a home is the most accessible leveraged investment', 'Real numbers, real families'] },
      { title: 'Small cash, big asset', stat: '5×', statLabel: '$100K down controls a $500K home', bullets: ['You own all of the appreciation', 'The lender owns none of it'] },
      { title: 'Return on cash', stat: '20%', statLabel: '4% appreciation ÷ 20% down', bullets: ['$500K × 4% = $20K gain', '$20K ÷ $100K invested = 20% return'] },
      { title: 'Plus principal paydown', bullets: ['Every payment builds equity', 'Equity + appreciation compound together', 'Year 9: $52,883 principal paid on $400K at 6.5%'] },
      { title: 'Managing the risk', bullets: ['Fixed-rate payment protects cash flow', 'Long holding periods smooth out cycles', 'Buy what you can comfortably afford'] },
      { title: 'Let’s run your numbers', bullets: ['Your price range, your down payment', 'Your local appreciation forecast'] },
    ],
  },
  {
    id: 'forecast-2026',
    title: '2026 Forecast',
    topic: 'Market Outlook',
    summary: 'Where rates, home prices and inventory are likely headed — and what it means for buyers, sellers and homeowners this year.',
    durationSec: 845,
    keywords: ['forecast', 'outlook', 'rates', 'home prices', '2026', 'inventory'],
    talkingPoints: ['Inflation trend is the single biggest driver of mortgage rates.', 'Home prices are forecast to keep rising, at a slower pace.', 'Inventory improves but remains below historical norms.', 'Buyers who wait for “perfect” often face higher prices.'],
    related: { label: 'House Price Index', href: '/members/house-price-index' },
    slides: [
      { title: '2026 Forecast', bullets: ['Rates · Prices · Inventory · Opportunity'] },
      { title: 'Rates: follow inflation', bullets: ['Mortgage rates track mortgage bonds', 'Cooling inflation = room for improvement', 'Expect volatility, not a straight line'] },
      { title: 'Home prices', stat: '+3–5%', statLabel: 'forecast range (demo)', bullets: ['Gains continue, but moderate', 'Local markets will vary widely'] },
      { title: 'Inventory', bullets: ['More listings than last year', 'Still short of a balanced market', 'New construction filling the gap'] },
      { title: 'What it means for you', bullets: ['Buyers: prepare now, act on good days', 'Owners: equity remains near record highs'] },
    ],
  },
  {
    id: 'seasonal',
    title: 'Seasonal Buying Strategies',
    topic: 'Timing',
    summary: 'How the calendar affects competition, prices and negotiating power — and how to use each season to your client’s advantage.',
    durationSec: 498,
    keywords: ['seasonal', 'spring', 'fall', 'winter', 'timing', 'negotiation'],
    talkingPoints: ['Spring brings the most listings and the most competition.', 'Fall and winter buyers often face less competition and more motivated sellers.', 'Pre-approval lets buyers move quickly in any season.'],
    related: { label: 'Cost of Waiting', href: '/members/cost-of-waiting' },
    slides: [
      { title: 'Seasonal Buying Strategies', bullets: ['Use the calendar to your advantage'] },
      { title: 'Spring', bullets: ['Most inventory', 'Most competition', 'Bidding wars more common'] },
      { title: 'Summer', bullets: ['Families move before school', 'Steady but busy market'] },
      { title: 'Fall & Winter', bullets: ['Fewer buyers', 'Motivated sellers', 'More room to negotiate'] },
      { title: 'Be ready year-round', bullets: ['Get pre-approved', 'Know your payment range'] },
    ],
  },
  {
    id: 'demographics',
    title: 'Demographics Drive Demand',
    topic: 'Market Outlook',
    summary: 'Why the largest generations entering their peak home-buying years keep long-term housing demand strong.',
    durationSec: 560,
    keywords: ['demographics', 'millennials', 'gen z', 'demand', 'household formation'],
    talkingPoints: ['Peak first-time buying age is the early-to-mid thirties.', 'A large population cohort is moving through those years now.', 'Household formation outpaces new construction.', 'Sustained demand supports long-run price stability.'],
    related: { label: 'Real Estate Report Card', href: '/members/rerc' },
    slides: [
      { title: 'Demographics Drive Demand', bullets: ['The generational wave behind housing'] },
      { title: 'Peak buying age', stat: '33–35', statLabel: 'typical first-time buyer age range (demo)', bullets: ['Careers established', 'Families growing'] },
      { title: 'Household formation', bullets: ['More new households each year', 'Construction hasn’t kept up'] },
      { title: 'What it means', bullets: ['Demand stays firm', 'Supports long-run appreciation'] },
    ],
  },
  {
    id: 'housing-bubble',
    title: 'Is This a Housing Bubble?',
    topic: 'Market Outlook',
    summary: 'A calm, data-driven answer to the question clients ask most — comparing today’s market to the mid-2000s.',
    durationSec: 702,
    keywords: ['bubble', 'crash', 'risk', '2008', 'lending standards', 'equity'],
    talkingPoints: ['Lending standards today are far stricter than in the mid-2000s.', 'Most owners have substantial equity and fixed-rate loans.', 'Inventory is tight, not flooded.', 'Prices can slow or dip locally without a systemic crash.'],
    related: { label: 'Equity Gained & Appreciation', href: '/members/equity-gained' },
    slides: [
      { title: 'Is This a Housing Bubble?', bullets: ['Then vs. now'] },
      { title: 'Lending standards', bullets: ['Documented income', 'Strong credit profiles', 'Fewer risky loan types'] },
      { title: 'Owner equity', stat: 'Record', statLabel: 'homeowner equity levels (demo)', bullets: ['Cushion against price dips', 'Few forced sellers'] },
      { title: 'Supply', bullets: ['2006: too many homes', 'Today: too few homes'] },
      { title: 'The takeaway', bullets: ['Local slowdowns ≠ a crash', 'Buy for the long term'] },
    ],
  },
  {
    id: 'move-up-debt',
    title: 'Move-Up with Debt Consolidation',
    topic: 'Move-Up',
    summary: 'Help move-up buyers use their equity to buy the next home and pay off high-interest debt in the same transaction.',
    durationSec: 655,
    keywords: ['move-up', 'debt consolidation', 'equity', 'credit cards', 'auto loan'],
    talkingPoints: ['Start with the client’s total monthly outflow, not just the mortgage.', 'Show debts rolled into the new purchase and the net monthly change.', 'Example debts: $8,000 card at 22% ($250/mo) + $15,000 auto at 8% ($350/mo).', 'Discuss discipline: don’t rebuild the paid-off balances.'],
    related: { label: 'Debt Consolidation', href: '/members/debt-consolidation' },
    slides: [
      { title: 'Move-Up with Debt Consolidation', bullets: ['Bigger home, simpler finances'] },
      { title: 'Today’s outflow', stat: '$600/mo', statLabel: 'card $250 + auto $350', bullets: ['$8K card at 22%', '$15K auto at 8%'] },
      { title: 'Use your equity', bullets: ['Sale proceeds fund the down payment', 'Pay off debts at closing'] },
      { title: 'The new picture', bullets: ['One payment', 'Lower blended rate', 'Improved cash flow'] },
      { title: 'Next step', bullets: ['Run your move-up scenario'] },
    ],
  },
  {
    id: 'bid-over-ask',
    title: 'Bid Over Ask',
    topic: 'Offers',
    summary: 'Show buyers how quickly forecast appreciation can cover an above-asking offer — and what it really costs per month.',
    durationSec: 540,
    keywords: ['bid over ask', 'offer', 'over asking', 'competition', 'appreciation'],
    talkingPoints: ['Translate the over-ask amount into a monthly payment difference.', 'Show how long forecast appreciation takes to cover the premium.', 'Losing the house often costs more than the premium.'],
    related: { label: 'Bid Over Ask', href: '/members/bid-over-ask' },
    slides: [
      { title: 'Bid Over Ask', bullets: ['Winning the home without overpaying'] },
      { title: 'The real cost', stat: '≈ $158/mo', statLabel: '$25K over ask, financed at 6.5% (P&I)', bullets: ['Think monthly, not sticker'] },
      { title: 'Appreciation catches up', bullets: ['Forecast growth covers the premium', 'Often within a year or two'] },
      { title: 'The cost of losing', bullets: ['Rents keep rising', 'Next home may cost more'] },
    ],
  },
  {
    id: 'cost-of-waiting',
    title: 'The Cost of Waiting',
    topic: 'Timing',
    summary: 'What waiting a year to buy really costs when prices rise — even if rates improve.',
    durationSec: 590,
    keywords: ['cost of waiting', 'timing', 'rates', 'prices', 'wait'],
    talkingPoints: ['Compare buying today vs. in 12 months at 4% appreciation.', 'A $500,000 home becomes $520,000 — a $16,000 bigger loan at 20% down.', 'Even a lower future rate may not offset the higher price.', 'You can refinance a rate; you can’t refinance a price.'],
    related: { label: 'Cost of Waiting', href: '/members/cost-of-waiting' },
    slides: [
      { title: 'The Cost of Waiting', bullets: ['Today vs. 12 months from now'] },
      { title: 'Prices keep moving', stat: '+$20,000', statLabel: '$500K at 4% appreciation, 1 year', bullets: ['Bigger price, bigger loan'] },
      { title: 'Rates are a coin flip', bullets: ['Lower rates bring more buyers', 'More buyers push prices higher'] },
      { title: 'Asymmetry', bullets: ['You can refinance a rate', 'You can’t refinance a price'] },
      { title: 'Run your scenario', bullets: ['Your price, your wait, your rates'] },
    ],
  },
  {
    id: 'higher-rates-benefit',
    title: 'How Higher Rates Can Benefit Buyers',
    topic: 'Rates',
    summary: 'Why buying in a higher-rate environment can mean less competition, better negotiation and a refinance opportunity later.',
    durationSec: 575,
    keywords: ['higher rates', 'negotiation', 'refinance', 'buydown', 'seller concessions'],
    talkingPoints: ['Higher rates thin out the competition.', 'Sellers are more open to concessions and buydowns.', 'If rates fall, you can refinance — and you already own the home.', 'Use seller credits to buy down the rate.'],
    related: { label: 'Seller Contribution', href: '/members/seller-contribution' },
    slides: [
      { title: 'How Higher Rates Can Benefit Buyers', bullets: ['Turning a headwind into leverage'] },
      { title: 'Less competition', bullets: ['Fewer bidding wars', 'More time to decide'] },
      { title: 'More negotiating power', stat: '2-1', statLabel: 'seller-paid temporary buydown', bullets: ['Price cuts · credits · buydowns'] },
      { title: 'Refinance optionality', bullets: ['Rates fall → refinance', 'Rates rise → you locked in'] },
      { title: 'Let’s structure your offer', bullets: ['Compare concession options side by side'] },
    ],
  },
];
