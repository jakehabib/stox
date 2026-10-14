/**
 * Bid Over Ask (/members/bid-over-ask): how long until the home's projected value catches up
 * with an over-asking bid, and what the bid looks like after 5 years.
 *
 * Forecast mode follows the location forecast curve (same curve as Appreciation / Equity, so
 * Dallas Yr1 = $522,351 … Yr5 = $589,480). Historical compounds the location's 63-yr rate,
 * Custom compounds the user's rate.
 */
import { getLocation, type Location } from '@/data/mock/locations';
import { valueAtYear, type AppreciationMode } from './appreciation';

const fin = (n: number) => (Number.isFinite(n) ? n : 0);
/** Search horizon for the crossing point. */
export const CROSSING_HORIZON_YEARS = 40;

export interface BidInput {
  askingPrice: number;
  bidAbove: number;
  currentValue: number;
  locationId: string;
  mode: AppreciationMode;
  customPct: number;
}

/** The rates the form shows next to each radio. */
export function bidFormRates(loc: Location | string) {
  const l = typeof loc === 'string' ? getLocation(loc) : loc;
  return { forecast1yrPct: l.forecast1yrPct, forecast5yrAvgPct: l.forecast5yrAvgPct, historical63yrPct: l.historical63yrPct };
}

/** Projected value at (fractional) year t. */
export function bidValueAt(i: Pick<BidInput, 'currentValue' | 'locationId' | 'mode' | 'customPct'>, t: number): number {
  const v = Math.max(0, fin(i.currentValue));
  const y = Math.max(0, fin(t));
  const l = getLocation(i.locationId);
  if (i.mode === 'forecast') return fin(valueAtYear(v, l, { mode: 'forecast' }, y));
  const r = i.mode === 'historical' ? l.historical63yrPct : fin(i.customPct);
  return fin(v * Math.pow(1 + r / 100, y));
}

/**
 * Months until projected value first reaches the bid, on the same curve the chart shows
 * (geometric interpolation inside a year). 0 if the bid doesn't exceed value; null if it
 * never catches up within the horizon.
 */
export function monthsToExceedBid(i: BidInput): number | null {
  const bid = totalBid(i);
  if (bidValueAt(i, 0) >= bid) return 0;
  let prev = 0;
  for (let y = 1; y <= CROSSING_HORIZON_YEARS; y++) {
    if (bidValueAt(i, y) >= bid) {
      let lo = prev;
      let hi = y;
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        if (bidValueAt(i, mid) >= bid) hi = mid;
        else lo = mid;
      }
      return hi * 12;
    }
    prev = y;
  }
  return null;
}

/** Months to grow `pctOver` percent at a flat annual rate (compounded). Reference model only. */
export function monthsAtFlatRate(pctOver: number, ratePct: number): number | null {
  if (pctOver <= 0) return 0;
  if (!(ratePct > 0)) return null;
  return (Math.log(1 + pctOver / 100) / Math.log(1 + ratePct / 100)) * 12;
}

export function totalBid(i: Pick<BidInput, 'askingPrice' | 'bidAbove'>): number {
  return Math.max(0, fin(i.askingPrice)) + Math.max(0, fin(i.bidAbove));
}

export interface BidYear {
  year: number;
  value: number;
  /** (value − bid) ÷ bid, percent. */
  pctVsBid: number;
  /** value − bid, dollars. */
  vsBid: number;
}

export interface BidResult {
  totalBid: number;
  /** (bid − current value) ÷ current value, percent. */
  pctOverValue: number;
  dollarsOverValue: number;
  monthsToExceed: number | null;
  years: BidYear[];
  value5: number;
  gain5: number;
  gain5PctOfBid: number;
}

export function bidOverAsk(i: BidInput, horizon = 5): BidResult {
  const bid = totalBid(i);
  const v0 = Math.max(0, fin(i.currentValue));
  const years = Array.from({ length: horizon + 1 }, (_, y) => {
    const value = bidValueAt(i, y);
    return { year: y, value, vsBid: value - bid, pctVsBid: bid > 0 ? ((value - bid) / bid) * 100 : 0 };
  });
  const value5 = years[horizon].value;
  return {
    totalBid: bid,
    pctOverValue: v0 > 0 ? ((bid - v0) / v0) * 100 : 0,
    dollarsOverValue: bid - v0,
    monthsToExceed: monthsToExceedBid(i),
    years,
    value5,
    gain5: value5 - bid,
    gain5PctOfBid: bid > 0 ? ((value5 - bid) / bid) * 100 : 0,
  };
}

export type BidErrors = Partial<Record<'client' | 'askingPrice' | 'bidAbove' | 'currentValue' | 'customPct', string>>;

export function validateBid(f: { clientId: string | null } & BidInput): BidErrors {
  const e: BidErrors = {};
  if (!f.clientId) e.client = 'Client name is required';
  if (!(f.askingPrice > 0)) e.askingPrice = 'Enter an asking price greater than $0';
  if (!(f.bidAbove >= 0)) e.bidAbove = 'Bid above asking can’t be negative';
  if (!(f.currentValue > 0)) e.currentValue = 'Enter an estimated current value greater than $0';
  if (f.mode === 'custom' && !(Number.isFinite(f.customPct) && f.customPct > -20 && f.customPct <= 25)) e.customPct = 'Custom rate must be between -20% and 25%';
  return e;
}
