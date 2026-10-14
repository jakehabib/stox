/**
 * Reinvestment: lump sum + periodic contributions at an assumed annual rate, compounded once per
 * contribution period (monthly / quarterly / yearly), contributions at the end of each period.
 *
 * Timing convention. The live MBS Highway result ($100k + $269/mo @ 6% for 10 yr = $226,933)
 * is reproduced exactly when the lump sum earns ONE extra period of interest (it is invested a
 * period before the contribution schedule starts): FV = L(1+r)^(n+1) + P·((1+r)^n − 1)/r.
 * That is the default (`timing: 'live'`). `timing: 'standard'` is the textbook FV with the lump
 * sum and contributions on the same schedule: FV = L(1+r)^n + P·((1+r)^n − 1)/r ($226,023).
 */

export type ReinvestFrequency = 'monthly' | 'quarterly' | 'yearly';
export type ReinvestTiming = 'live' | 'standard';

export interface ReinvestInput {
  lumpSum: number;
  periodPayment: number;
  frequency: ReinvestFrequency;
  ratePct: number;
  length: number;
  lengthUnit: 'years' | 'months';
  timing: ReinvestTiming;
}

export const REINVEST_DEFAULTS: ReinvestInput = {
  lumpSum: 100000,
  periodPayment: 269,
  frequency: 'monthly',
  ratePct: 6,
  length: 10,
  lengthUnit: 'years',
  timing: 'live',
};

export const PERIODS_PER_YEAR: Record<ReinvestFrequency, number> = { monthly: 12, quarterly: 4, yearly: 1 };

export interface ReinvestPoint {
  /** Elapsed months at this point. */
  month: number;
  label: string;
  balance: number;
  contributions: number;
  interest: number;
}

export interface ReinvestResult {
  periods: number;
  months: number;
  endingBalance: number;
  contributions: number;
  interest: number;
  /** One point per year end (plus the final partial year, plus t=0). */
  yearly: ReinvestPoint[];
}

const fin = (n: number) => (Number.isFinite(n) ? n : 0);

/** Balance after k contribution periods. */
function balanceAt(lump: number, pmt: number, r: number, k: number, timing: ReinvestTiming): number {
  const lumpPeriods = timing === 'live' && k > 0 ? k + 1 : k;
  const g = Math.pow(1 + r, k);
  const annuity = r === 0 ? pmt * k : (pmt * (g - 1)) / r;
  return lump * Math.pow(1 + r, lumpPeriods) + annuity;
}

export function reinvest(raw: ReinvestInput): ReinvestResult {
  const lump = Math.max(0, fin(raw.lumpSum));
  const pmt = Math.max(0, fin(raw.periodPayment));
  const ppy = PERIODS_PER_YEAR[raw.frequency] ?? 12;
  const r = Math.min(100, Math.max(-50, fin(raw.ratePct))) / 100 / ppy;
  const totalMonths = Math.min(1200, Math.max(0, Math.round(raw.lengthUnit === 'months' ? fin(raw.length) : fin(raw.length) * 12)));
  const monthsPerPeriod = 12 / ppy;
  const periods = Math.floor(totalMonths / monthsPerPeriod);
  const timing = raw.timing ?? 'live';

  const point = (k: number, month: number, label: string): ReinvestPoint => {
    const balance = balanceAt(lump, pmt, r, k, timing);
    const contributions = lump + pmt * k;
    return { month, label, balance, contributions, interest: balance - contributions };
  };

  const yearly: ReinvestPoint[] = [point(0, 0, 'Start')];
  const fullYears = Math.floor(totalMonths / 12);
  for (let y = 1; y <= fullYears; y++) yearly.push(point(Math.floor((y * 12) / monthsPerPeriod), y * 12, `Yr ${y}`));
  if (totalMonths % 12 !== 0) yearly.push(point(periods, totalMonths, `Mo ${totalMonths}`));

  const end = point(periods, totalMonths, '');
  return { periods, months: totalMonths, endingBalance: end.balance, contributions: end.contributions, interest: end.interest, yearly };
}
