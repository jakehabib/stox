import { describe, expect, it } from 'vitest';
import {
  addMonths,
  epoStatus,
  evaluateLoan,
  isHit,
  monthlySavings,
  monthsBetween,
  requiredDrop,
  summarize,
  targetRate,
  tierFor,
  type MarketProduct,
  type WatchLoan,
} from './strikeRate';

const MARKET: Record<MarketProduct, number> = { '30yr': 7.125, fha: 6.625, va: 6.375, jumbo: 7.5, '15yr': 6.375 };

describe('tierFor / requiredDrop — tier boundaries', () => {
  it('Below $350k → 0.75 (inclusive of 350,000)', () => {
    expect(requiredDrop(0)).toBe(0.75);
    expect(requiredDrop(200_000)).toBe(0.75);
    expect(requiredDrop(350_000)).toBe(0.75);
    expect(tierFor(350_000).id).toBe('low');
  });
  it('$350,001 – $806,499 → 0.5', () => {
    expect(requiredDrop(350_001)).toBe(0.5);
    expect(requiredDrop(500_000)).toBe(0.5);
    expect(requiredDrop(806_499)).toBe(0.5);
    expect(tierFor(806_499).id).toBe('mid');
  });
  it('$806,500 and above → 0.375', () => {
    expect(requiredDrop(806_500)).toBe(0.375);
    expect(requiredDrop(806_501)).toBe(0.375);
    expect(requiredDrop(2_000_000)).toBe(0.375);
    expect(tierFor(806_500).id).toBe('high');
  });
  it('guards bad input', () => {
    expect(requiredDrop(NaN)).toBe(0.75);
    expect(requiredDrop(-5)).toBe(0.75);
  });
});

describe('targetRate', () => {
  it('current rate minus the tier drop', () => {
    expect(targetRate(7.875, 300_000)).toBe(7.125); // 7.875 − 0.75
    expect(targetRate(7.875, 400_000)).toBe(7.375); // 7.875 − 0.5
    expect(targetRate(7.75, 900_000)).toBe(7.375); // 7.75 − 0.375
  });
  it('at each boundary', () => {
    expect(targetRate(8, 350_000)).toBe(7.25);
    expect(targetRate(8, 350_001)).toBe(7.5);
    expect(targetRate(8, 806_499)).toBe(7.5);
    expect(targetRate(8, 806_500)).toBe(7.625);
    expect(targetRate(8, 806_501)).toBe(7.625);
  });
  it('never negative / NaN', () => {
    expect(targetRate(0.25, 100_000)).toBe(0);
    expect(targetRate(NaN, 100_000)).toBe(0);
  });
});

describe('isHit', () => {
  it('hit when market ≤ target', () => {
    expect(isHit(7.125, 7.125)).toBe(true);
    expect(isHit(7.0, 7.125)).toBe(true);
  });
  it('not hit when market above target', () => {
    expect(isHit(7.25, 7.125)).toBe(false);
    expect(isHit(7.126, 7.125)).toBe(false);
  });
});

describe('monthsBetween / addMonths', () => {
  it('counts whole months', () => {
    expect(monthsBetween(new Date(2026, 3, 14), new Date(2026, 9, 14))).toBe(6);
    expect(monthsBetween(new Date(2026, 3, 15), new Date(2026, 9, 14))).toBe(5);
    expect(monthsBetween(new Date(2026, 9, 20), new Date(2026, 9, 14))).toBe(0);
  });
  it('clamps month-end', () => {
    expect(addMonths(new Date(2026, 0, 31), 1).getDate()).toBe(28);
    expect(addMonths(new Date(2026, 3, 14), 6).getMonth()).toBe(9);
  });
});

describe('epoStatus — 6-month early payoff period', () => {
  const today = new Date(2026, 9, 14, 12);
  it('closed 6 months ago → eligible', () => {
    const s = epoStatus(new Date(2026, 3, 14, 9), today);
    expect(s.eligible).toBe(true);
    expect(s.monthsSinceClose).toBe(6);
    expect(s.monthsRemaining).toBe(0);
  });
  it('closed 4 months ago → not eligible, 2 months remaining', () => {
    const s = epoStatus(new Date(2026, 5, 14, 9), today);
    expect(s.eligible).toBe(false);
    expect(s.monthsSinceClose).toBe(4);
    expect(s.monthsRemaining).toBe(2);
    expect(s.eligibleOn.getMonth()).toBe(11);
  });
  it('closed 5 months 30 days ago → still in EPO', () => {
    const s = epoStatus(new Date(2026, 3, 15, 9), today);
    expect(s.eligible).toBe(false);
    expect(s.daysRemaining).toBe(1);
  });
});

describe('monthlySavings', () => {
  it('$400k 6.5% 30yr payment = $2,528.27 (sanity)', () => {
    expect(monthlySavings(400_000, 6.5, 6.5, 360).currentPayment).toBeCloseTo(2528.27, 2);
  });
  it('$400k 7.875% → 7.125% over 360 mo saves $205.40/mo', () => {
    const s = monthlySavings(400_000, 7.875, 7.125, 360);
    expect(s.currentPayment).toBeCloseTo(2900.28, 2);
    expect(s.newPayment).toBeCloseTo(2694.87, 2);
    expect(s.savings).toBeCloseTo(205.4, 1);
  });
  it('$300k 7.5% → 6.75% over 354 mo', () => {
    const s = monthlySavings(300_000, 7.5, 6.75, 354);
    expect(s.currentPayment).toBeCloseTo(2107.17, 2);
    expect(s.newPayment).toBeCloseTo(1956.04, 2);
  });
  it('no NaN on zero / empty input', () => {
    const s = monthlySavings(0, 0, 0, 0);
    expect(s.savings).toBe(0);
    expect(Number.isFinite(monthlySavings(NaN, NaN, NaN, NaN).savings)).toBe(true);
  });
});

describe('evaluateLoan', () => {
  const today = new Date(2026, 9, 14, 12);
  const loan = (p: Partial<WatchLoan>): WatchLoan => ({ clientId: 'x', balance: 400_000, ratePct: 7.875, product: '30yr', closeDate: new Date(2025, 9, 14), termMonths: 360, ...p });

  it('strike: target hit and past EPO', () => {
    const r = evaluateLoan(loan({}), MARKET, today);
    expect(r.target).toBe(7.375);
    expect(r.marketRate).toBe(7.125);
    expect(r.hit).toBe(true);
    expect(r.status).toBe('strike');
    expect(r.remainingMonths).toBe(348);
    expect(r.savings).toBeGreaterThan(0);
  });
  it('hit but still inside EPO', () => {
    const r = evaluateLoan(loan({ closeDate: new Date(2026, 6, 1) }), MARKET, today);
    expect(r.hit).toBe(true);
    expect(r.status).toBe('hit-epo');
  });
  it('watching with gap', () => {
    const r = evaluateLoan(loan({ ratePct: 7.25 }), MARKET, today);
    expect(r.target).toBe(6.75);
    expect(r.hit).toBe(false);
    expect(r.gap).toBe(0.375);
    expect(r.status).toBe('watching');
  });
  it('market shift simulation', () => {
    const r = evaluateLoan(loan({ ratePct: 7.25 }), MARKET, today, -0.375);
    expect(r.marketRate).toBe(6.75);
    expect(r.hit).toBe(true);
  });
  it('summarize', () => {
    const rs = [evaluateLoan(loan({}), MARKET, today), evaluateLoan(loan({ ratePct: 7.25 }), MARKET, today)];
    const s = summarize(rs);
    expect(s.total).toBe(2);
    expect(s.strike).toBe(1);
    expect(s.watching).toBe(1);
  });
});
