/** DEMO DATA — report kit options for the Prequalified Buyer Campaign. */

export interface CampaignReport {
  id: string;
  name: string;
  description: string;
  /** Default email subject; {first} = client first name, {city} = location city. */
  subject: string;
  toolHref?: string;
}

/** The 9 reports selected by default, in the default order. */
export const DEFAULT_REPORT_IDS = ['cost-of-waiting', 'buy-vs-rent', 'rerc', 'appreciation', 'supply-demand', 'amortization', 'equity-gained', 'national-hpi', 'values-resilient'];

export const CAMPAIGN_REPORTS: CampaignReport[] = [
  { id: 'cost-of-waiting', name: 'Cost of Waiting', description: 'What waiting 12 months could cost in price and payment.', subject: '{first}, here’s what waiting a year could cost', toolHref: '/members/cost-of-waiting' },
  { id: 'buy-vs-rent', name: 'Buy vs Rent', description: 'Wealth built by owning vs. continuing to rent.', subject: 'Renting vs. owning in {city}: the 10-year picture', toolHref: '/members/buy-vs-rent' },
  { id: 'rerc', name: 'RERC', description: 'Real Estate Report Card — the local market snapshot.', subject: 'Your {city} market report card', toolHref: '/members/rerc' },
  { id: 'appreciation', name: 'Appreciation', description: 'Estimate future home value.', subject: 'What your future home could be worth', toolHref: '/members/appreciation' },
  { id: 'supply-demand', name: 'Housing Supply and Demand', description: 'Why limited inventory supports prices.', subject: 'Why there still aren’t enough homes' },
  { id: 'amortization', name: 'Amortization', description: 'How each payment builds equity over time.', subject: '{first}, see how your payment builds equity', toolHref: '/members/payment' },
  { id: 'equity-gained', name: 'Equity Gained', description: 'Equity from appreciation + principal paydown.', subject: 'The equity you could build in 5 years', toolHref: '/members/equity-gained' },
  { id: 'national-hpi', name: 'National House Price Index', description: 'Price trends across the country.', subject: 'Home prices across the country this month', toolHref: '/members/house-price-index' },
  { id: 'values-resilient', name: 'Home Values Remain Resilient', description: 'Why values have held up through rate cycles.', subject: 'Home values keep proving resilient' },
  { id: 'affordability', name: 'Affordability', description: 'How much home an income supports.', subject: '{first}, here’s how much home you can afford', toolHref: '/members/affordability' },
  { id: 'buying-power', name: 'Buying Power', description: 'How rate moves change your price range.', subject: 'How rates change your buying power', toolHref: '/members/buying-power' },
  { id: 'bid-over-ask', name: 'Bid Over Ask', description: 'When appreciation covers an over-ask offer.', subject: 'Should you offer over asking?', toolHref: '/members/bid-over-ask' },
  { id: 'loan-compare', name: 'Loan Comparison', description: 'True cost of your loan options side by side.', subject: 'Your loan options, side by side', toolHref: '/members/loan-compare' },
];

export const CADENCE_OPTIONS = [1, 2, 3, 5, 7] as const;
