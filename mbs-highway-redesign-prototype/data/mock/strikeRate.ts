/**
 * DEMO DATA — Strike Rate.
 * Today's estimated fixed market rates (adapter: replace `getEstimatedMarketRates` with a live
 * rate feed) and a watchlist of synthetic existing loans attached to the demo clients.
 * Market rates sit just under the dashboard's "Locked-In Rates" averages (data/mock/content.ts).
 */
import { buildDemoClients } from '@/data/mock/clients';
import { addMonths, type MarketProduct, type WatchLoan } from '@/lib/calculations/strikeRate';

export interface MarketRateCard {
  product: MarketProduct;
  label: string;
  rate: number;
  /** Change vs yesterday, percentage points. */
  change: number;
}

export const PRODUCT_LABELS: Record<MarketProduct, string> = {
  '30yr': '30-Yr Fixed',
  fha: 'FHA 30-Yr',
  va: 'VA 30-Yr',
  jumbo: 'Jumbo 30-Yr',
  '15yr': '15-Yr Fixed',
};

/** Adapter — swap for a live pricing/market feed. Values are estimates, not a lock. */
export function getEstimatedMarketRates(): MarketRateCard[] {
  return [
    { product: '30yr', label: PRODUCT_LABELS['30yr'], rate: 7.125, change: -0.125 },
    { product: 'fha', label: PRODUCT_LABELS.fha, rate: 6.625, change: -0.125 },
    { product: 'va', label: PRODUCT_LABELS.va, rate: 6.375, change: -0.125 },
    { product: 'jumbo', label: PRODUCT_LABELS.jumbo, rate: 7.5, change: 0 },
    { product: '15yr', label: PRODUCT_LABELS['15yr'], rate: 6.375, change: -0.125 },
  ];
}

export function marketRateMap(cards: MarketRateCard[] = getEstimatedMarketRates()): Record<MarketProduct, number> {
  return Object.fromEntries(cards.map((c) => [c.product, c.rate])) as Record<MarketProduct, number>;
}

interface Seed {
  balance: number;
  ratePct: number;
  product: MarketProduct;
  closedMonthsAgo: number;
  extraDays?: number;
  termMonths?: number;
}

/** Existing loans for demo clients #1–#14 (Alex Rivera is a purchase prospect, so not on the list). */
const SEEDS: Seed[] = [
  { balance: 412_500, ratePct: 7.99, product: '30yr', closedMonthsAgo: 13 },
  { balance: 298_000, ratePct: 7.875, product: '30yr', closedMonthsAgo: 10, extraDays: 4 },
  { balance: 265_000, ratePct: 7.5, product: 'fha', closedMonthsAgo: 8, extraDays: 11 },
  { balance: 540_000, ratePct: 7.75, product: '30yr', closedMonthsAgo: 3, extraDays: 9 },
  { balance: 880_000, ratePct: 7.99, product: 'jumbo', closedMonthsAgo: 2, extraDays: 2 },
  { balance: 925_000, ratePct: 7.75, product: 'jumbo', closedMonthsAgo: 14 },
  { balance: 455_000, ratePct: 7.5, product: '30yr', closedMonthsAgo: 20, extraDays: 6 },
  { balance: 330_000, ratePct: 6.99, product: 'va', closedMonthsAgo: 11, extraDays: 3 },
  { balance: 615_000, ratePct: 7.25, product: '30yr', closedMonthsAgo: 7, extraDays: 15 },
  { balance: 210_000, ratePct: 6.875, product: '15yr', closedMonthsAgo: 16, termMonths: 180 },
  { balance: 350_000, ratePct: 7.625, product: '30yr', closedMonthsAgo: 5, extraDays: 12 },
  { balance: 806_500, ratePct: 7.375, product: '30yr', closedMonthsAgo: 9 },
  { balance: 175_000, ratePct: 6.875, product: 'fha', closedMonthsAgo: 24, extraDays: 8 },
  { balance: 690_000, ratePct: 6.99, product: '30yr', closedMonthsAgo: 30 },
];

/** Builds the watchlist relative to `today` so the demo mix (in-EPO vs eligible) stays stable. */
export function getStrikeWatchlist(today: Date = new Date()): WatchLoan[] {
  const clients = buildDemoClients();
  return SEEDS.map((s, i) => {
    const close = addMonths(today, -s.closedMonthsAgo);
    close.setDate(close.getDate() - (s.extraDays ?? 0));
    return {
      clientId: clients[i + 1].id,
      balance: s.balance,
      ratePct: s.ratePct,
      product: s.product,
      closeDate: close,
      termMonths: s.termMonths ?? 360,
    };
  });
}

export const STRIKE_GUIDE_STEPS = [
  { title: 'Connect your NMLS ID', body: 'Strike Rate matches your closed loans by NMLS ID. Add it to your co-branding profile so alerts are attributed to you.' },
  { title: 'Check today’s estimated market rates', body: 'Rates refresh each morning from the market feed. They are estimates for comparison — not a lock or a quote.' },
  { title: 'Review the target hits', body: 'Each client’s strike rate is their current note rate minus the required drop for their balance tier. When today’s rate reaches it, the loan is a target hit.' },
  { title: 'Respect the early payoff period', body: 'Loans can’t be refinanced inside the 6-month early payoff period. Hits inside the window are queued until the eligible date.' },
  { title: 'Reach out', body: 'Use “Draft alert” to preview a client email with the live numbers, or open Refi Risk of Waiting to show the cost of delay.' },
];

export const STRIKE_TUTORIAL = {
  title: 'Strike Rate — 3 minute walkthrough',
  durationSec: 194,
  chapters: [
    { at: 0, label: 'What a strike rate is' },
    { at: 48, label: 'Balance tiers and thresholds' },
    { at: 102, label: 'Early payoff period' },
    { at: 151, label: 'Turning a hit into a conversation' },
  ],
};
