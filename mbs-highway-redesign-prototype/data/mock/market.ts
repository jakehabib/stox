/**
 * DEMO DATA — market ticker adapter.
 *
 * The UI never imports hard-coded "current" quotes. It calls `getMarketSnapshot(now)`,
 * which here synthesizes a deterministic intraday random walk for the given moment.
 * To go live, replace the body of `getMarketSnapshot` / `getMbsIntraday` with calls
 * to your market data feed — the return shapes are the contract.
 */
import { hashString, mulberry32 } from '@/lib/random';

export interface Quote {
  symbol: string;
  name: string;
  last: number;
  change: number; // absolute
  changePct: number;
  unit?: 'price' | 'yield' | 'fx';
}

export interface MarketSnapshot {
  asOf: string;
  umbs: Quote; // UMBS 30YR 6.5 coupon price
  tenYear: Quote; // 10Y UST yield (percent)
  isDemo: true;
}

export interface IntradayPoint {
  t: string; // HH:MM
  price: number;
}

const PREV_CLOSE = 100.33;
const TEN_YR_PREV = 4.118;

/** Trading minutes since 8:00 ET (clamped to session 8:00–17:00). */
function sessionMinute(now: Date): number {
  const m = now.getHours() * 60 + now.getMinutes() - 8 * 60;
  return Math.max(0, Math.min(9 * 60, m));
}

function dayKey(now: Date) {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/** Five-minute bars for the trading day up to `now`. Deterministic per day. */
export function getMbsIntraday(now: Date = new Date()): IntradayPoint[] {
  const rand = mulberry32(hashString('mbs:' + dayKey(now)));
  const last = sessionMinute(now);
  const pts: IntradayPoint[] = [];
  let p = PREV_CLOSE;
  // Drift chosen so a typical day ranges ~100.2 – 100.6.
  for (let m = 0; m <= 9 * 60; m += 5) {
    const shock = (rand() - 0.47) * 0.035;
    p = Math.max(99.6, Math.min(101.2, p + shock));
    if (m <= Math.max(last, 5)) {
      const h = 8 + Math.floor(m / 60);
      pts.push({ t: `${h}:${String(m % 60).padStart(2, '0')}`, price: Math.round(p * 100) / 100 });
    }
  }
  return pts;
}

export function getMarketSnapshot(now: Date = new Date()): MarketSnapshot {
  const intraday = getMbsIntraday(now);
  const last = intraday[intraday.length - 1]?.price ?? PREV_CLOSE;
  const ch = Math.round((last - PREV_CLOSE) * 100) / 100;
  // 10Y moves inversely with MBS: roughly 3.5bp of yield per 0.10 of MBS price.
  const tenYear = Math.round((TEN_YR_PREV - ch * 0.35) * 1000) / 1000;
  return {
    asOf: now.toISOString(),
    isDemo: true,
    umbs: { symbol: 'UMBS30 6.5', name: 'UMBS 30YR 6.5%', last, change: ch, changePct: (ch / PREV_CLOSE) * 100, unit: 'price' },
    tenYear: {
      symbol: 'US10Y',
      name: '10Y UST',
      last: tenYear,
      change: Math.round((tenYear - TEN_YR_PREV) * 1000) / 1000,
      changePct: ((tenYear - TEN_YR_PREV) / TEN_YR_PREV) * 100,
      unit: 'yield',
    },
  };
}

/** MBS price change in "basis points" the way LOs read it (0.15 price = 15bp). */
export function priceChangeBp(change: number): string {
  const v = Math.round(change * 100);
  return `${v > 0 ? '+' : ''}${v}bp`;
}
