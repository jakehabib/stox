/**
 * DEMO DATA — Markets Overview datasets (daily MBS history, quote tables, treasury curve,
 * news headlines). Everything is deterministic so the demo is stable between reloads.
 *
 * Live quotes ("current" UMBS / 10Y) always come from the ticker adapter in
 * `data/mock/market.ts` (getMarketSnapshot / getMbsIntraday). This file only builds
 * history and secondary tables around that snapshot. To go live, swap these
 * generators for your market-data provider; the return shapes are the contract.
 */
import { hashString, mulberry32 } from '@/lib/random';
import { addDays, isoDate, type CurvePoint, type PricePoint } from '@/lib/calculations/markets';
import type { MarketSnapshot } from '@/data/mock/market';

/** The demo's "today": Wednesday Oct 14 2026, 10:00 AM ET (used for calendar/content dating). */
export const DEMO_NOW = new Date(2026, 9, 14, 10, 0, 0);
export const DEMO_TODAY = '2026-10-14';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Previous close implied by a snapshot (last − change). */
export function prevCloseOf(snap: MarketSnapshot): number {
  return r2(snap.umbs.last - snap.umbs.change);
}

/** SIFMA bond-market closures in the history window (no MBS close on these days). */
export const BOND_HOLIDAYS = new Set(['2025-10-13', '2025-11-11', '2025-11-27', '2025-12-25', '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-10-12']);

/** Closes published in the recent Market Wraps, so the chart and the wraps agree. */
const CLOSE_ANCHORS: Record<string, number> = { '2026-10-06': 100.16, '2026-10-07': 100.14, '2026-10-08': 100.2, '2026-10-09': 100.29 };

/**
 * Daily closes for the UMBS 30YR 6.5 coupon: `days` trading sessions ending YESTERDAY at the
 * snapshot's previous close, followed by today's live price. Deterministic random walk
 * generated backwards with a gentle drift (MBS have rallied over the past year).
 */
export function getMbsDaily(snap: MarketSnapshot, today: Date = DEMO_NOW, days = 260): PricePoint[] {
  const rand = mulberry32(hashString('mbs-daily-v1'));
  const dates: Date[] = [];
  let d = addDays(today, -1);
  while (dates.length < days) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6 && !BOND_HOLIDAYS.has(isoDate(d))) dates.unshift(d);
    d = addDays(d, -1);
  }
  const prices: number[] = new Array(days);
  let p = prevCloseOf(snap);
  for (let i = days - 1; i >= 0; i--) {
    const anchor = CLOSE_ANCHORS[isoDate(dates[i])];
    if (anchor !== undefined && i < days - 1) p = anchor;
    prices[i] = r2(p);
    const shock = (rand() - 0.5) * 0.34;
    p = Math.max(97.2, Math.min(102.6, p - 0.0068 + shock));
  }
  const out: PricePoint[] = dates.map((x, i) => ({ t: isoDate(x), price: prices[i] }));
  out.push({ t: isoDate(today), price: snap.umbs.last });
  return out;
}

/* ------------------------------------------------------------------ quote tables */

export interface TableQuote {
  name: string;
  symbol: string;
  last: number;
  change: number;
  changePct: number;
  /** How to display `last`. */
  kind: 'yield' | 'price' | 'index' | 'fx' | 'usd';
  /** For yields, a rise is bad for mortgage rates. */
  note?: string;
}

function q(rand: () => number, name: string, symbol: string, base: number, vol: number, kind: TableQuote['kind'], digits = 2): TableQuote {
  const change = Math.round((rand() - 0.5) * 2 * vol * 10 ** digits) / 10 ** digits;
  const last = Math.round((base + change) * 10 ** digits) / 10 ** digits;
  return { name, symbol, last, change, changePct: Math.round((change / (last - change)) * 10000) / 100, kind };
}

export interface QuoteTables {
  bonds: TableQuote[];
  stocks: TableQuote[];
  commodities: TableQuote[];
  currencies: TableQuote[];
}

/** Secondary market tables. Bond rows are anchored to the live snapshot so they agree with the ticker. */
export function getQuoteTables(snap: MarketSnapshot, now: Date = new Date()): QuoteTables {
  const rand = mulberry32(hashString('tables:' + isoDate(now)));
  const ten = snap.tenYear;
  const tenCh = ten.change; // percent units
  const mbsCh = snap.umbs.change;
  const y = (name: string, symbol: string, spread: number, beta: number): TableQuote => {
    const change = r3(tenCh * beta);
    const last = r3(ten.last + spread + change - tenCh);
    return { name, symbol, last, change, changePct: Math.round((change / (last - change)) * 10000) / 100, kind: 'yield' };
  };
  const mbs = (name: string, symbol: string, offset: number, beta: number): TableQuote => {
    const change = r2(mbsCh * beta);
    const last = r2(snap.umbs.last + offset + change - mbsCh);
    return { name, symbol, last, change, changePct: Math.round((change / (last - change)) * 10000) / 100, kind: 'price' };
  };
  return {
    bonds: [
      mbs('UMBS 30YR 6.5%', 'UMBS30 6.5', 0, 1),
      mbs('UMBS 30YR 6.0%', 'UMBS30 6.0', -1.84, 1.12),
      mbs('UMBS 30YR 5.5%', 'UMBS30 5.5', -3.91, 1.25),
      mbs('GNMA 30YR 6.5%', 'GNMA30 6.5', 0.42, 0.95),
      y('US 2-Year', 'US2Y', -0.53, 0.8),
      y('US 5-Year', 'US5Y', -0.33, 0.92),
      { ...ten, name: 'US 10-Year', symbol: 'US10Y', kind: 'yield' },
      y('US 30-Year', 'US30Y', 0.52, 0.9),
    ],
    stocks: [
      q(rand, 'Dow Jones Industrial Avg', 'DJIA', 46820, 260, 'index'),
      q(rand, 'S&P 500', 'SPX', 6712, 42, 'index'),
      q(rand, 'Nasdaq Composite', 'COMP', 22940, 170, 'index'),
      q(rand, 'Russell 2000', 'RUT', 2468, 24, 'index'),
      q(rand, 'Homebuilders ETF', 'XHB', 108.4, 1.6, 'usd'),
      q(rand, 'VIX Volatility', 'VIX', 17.2, 1.1, 'index'),
    ],
    commodities: [
      q(rand, 'WTI Crude Oil', 'CL', 62.4, 1.2, 'usd'),
      q(rand, 'Brent Crude', 'BZ', 65.9, 1.1, 'usd'),
      q(rand, 'Gold', 'GC', 3985, 32, 'usd'),
      q(rand, 'Silver', 'SI', 47.3, 0.7, 'usd'),
      q(rand, 'Copper', 'HG', 4.92, 0.06, 'usd'),
      q(rand, 'Natural Gas', 'NG', 3.18, 0.09, 'usd'),
    ],
    currencies: [
      q(rand, 'Euro / US Dollar', 'EUR/USD', 1.1642, 0.004, 'fx', 4),
      q(rand, 'US Dollar / Japanese Yen', 'USD/JPY', 151.82, 0.6, 'fx'),
      q(rand, 'British Pound / US Dollar', 'GBP/USD', 1.3368, 0.004, 'fx', 4),
      q(rand, 'US Dollar / Canadian Dollar', 'USD/CAD', 1.3974, 0.004, 'fx', 4),
      q(rand, 'US Dollar Index', 'DXY', 98.94, 0.35, 'index'),
    ],
  };
}

/* ------------------------------------------------------------------ treasury curve */

const CURVE_SHAPE: { tenor: string; years: number; offToday: number; offMonth: number }[] = [
  { tenor: '1M', years: 1 / 12, offToday: -0.07, offMonth: 0.13 },
  { tenor: '3M', years: 0.25, offToday: -0.15, offMonth: 0.04 },
  { tenor: '6M', years: 0.5, offToday: -0.29, offMonth: -0.1 },
  { tenor: '1Y', years: 1, offToday: -0.46, offMonth: -0.28 },
  { tenor: '2Y', years: 2, offToday: -0.53, offMonth: -0.4 },
  { tenor: '3Y', years: 3, offToday: -0.52, offMonth: -0.4 },
  { tenor: '5Y', years: 5, offToday: -0.39, offMonth: -0.29 },
  { tenor: '7Y', years: 7, offToday: -0.2, offMonth: -0.12 },
  { tenor: '10Y', years: 10, offToday: 0, offMonth: 0.06 },
  { tenor: '20Y', years: 20, offToday: 0.47, offMonth: 0.53 },
  { tenor: '30Y', years: 30, offToday: 0.52, offMonth: 0.58 },
];

/** Treasury curve today (anchored to the live 10Y) vs one month ago. */
export function getTreasuryCurve(snap: MarketSnapshot): CurvePoint[] {
  const ten = snap.tenYear.last;
  return CURVE_SHAPE.map((c) => ({ tenor: c.tenor, years: c.years, today: r3(ten + c.offToday), monthAgo: r3(4.118 + c.offMonth) }));
}

/* ------------------------------------------------------------------ news ticker */

export interface NewsHeadline {
  id: string;
  time: string;
  headline: string;
  tag: 'Rates' | 'Housing' | 'Economy' | 'Fed' | 'Markets';
}

/** Synthetic headlines for the dashboard Market News ticker (original text). */
export const MARKET_NEWS: NewsHeadline[] = [
  { id: 'n1', time: '9:52 AM', tag: 'Rates', headline: 'MBS hold early gains after September CPI core reading cools to 0.2%' },
  { id: 'n2', time: '9:31 AM', tag: 'Markets', headline: 'Stocks open mixed as investors weigh softer inflation against bank earnings' },
  { id: 'n3', time: '9:05 AM', tag: 'Fed', headline: 'Fed officials signal patience; futures price a modest chance of a December cut' },
  { id: 'n4', time: '8:46 AM', tag: 'Rates', headline: '10-year Treasury yield slips toward 4.1% after inflation data' },
  { id: 'n5', time: '8:31 AM', tag: 'Economy', headline: 'Headline CPI rises 0.3% in September; shelter inflation continues to ease' },
  { id: 'n6', time: '8:02 AM', tag: 'Housing', headline: 'Purchase applications up for a third straight week as affordability improves' },
  { id: 'n7', time: '7:40 AM', tag: 'Housing', headline: 'Existing home sales edge higher; inventory reaches its best level since 2020' },
  { id: 'n8', time: '7:15 AM', tag: 'Economy', headline: 'Beige Book due at 2:00 PM ET — watch for comments on hiring and price pressure' },
  { id: 'n9', time: '6:58 AM', tag: 'Markets', headline: 'Oil eases below $63 as supply outlook improves, a tailwind for inflation' },
];
