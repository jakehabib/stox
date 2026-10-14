import { describe, expect, it } from 'vitest';
import { REFI_DEFAULTS, refiRisk } from './refiRisk';

describe('refiRisk', () => {
  const r = refiRisk(REFI_DEFAULTS);
  it('payments: existing $2,797, refi now $2,528 (save $269), future $2,398 (save $399)', () => {
    expect(Math.round(r.existingPayment)).toBe(2797);
    expect(Math.round(r.refiNowPayment)).toBe(2528);
    expect(Math.round(r.refiNowSavings)).toBe(269);
    expect(Math.round(r.futurePayment)).toBe(2398);
    expect(Math.round(r.futureSavings)).toBe(399);
  });
  it('cost of delaying $2,686; break-even 21 months (excl. waiting)', () => {
    expect(Math.round(r.costOfDelay)).toBe(2686);
    expect(r.breakEvenMonths).toBe(21);
    expect(r.breakEvenFromToday).toBe(31);
  });
  it('chart: wait-then-refi overtakes refi-now at month 31', () => {
    const cross = r.series.find((p) => p.month > r.waitMonths && p.waitThenRefi >= p.refiNow);
    expect(cross?.month).toBe(31);
  });
  it('future rate ≥ current → never breaks even', () => {
    expect(refiRisk({ ...REFI_DEFAULTS, futureRate: 6.5 }).breakEvenMonths).toBeNull();
    expect(refiRisk({ ...REFI_DEFAULTS, futureRate: 7 }).breakEvenMonths).toBeNull();
  });
  it('wait 6 months to 5.5%: cost $1,612, break-even 7 months', () => {
    const x = refiRisk({ ...REFI_DEFAULTS, futureRate: 5.5, waitMonths: 6 });
    expect(Math.round(x.costOfDelay)).toBe(1612);
    expect(x.breakEvenMonths).toBe(Math.ceil(x.costOfDelay / (x.refiNowPayment - x.futurePayment)));
    expect(x.breakEvenMonths).toBe(7);
  });
  it('zero wait or garbage inputs stay finite', () => {
    expect(refiRisk({ ...REFI_DEFAULTS, waitMonths: 0 }).costOfDelay).toBe(0);
    const g = refiRisk({ ...REFI_DEFAULTS, existingAmount: NaN, waitMonths: NaN, futureRate: NaN });
    expect(Number.isFinite(g.costOfDelay)).toBe(true);
  });
});
