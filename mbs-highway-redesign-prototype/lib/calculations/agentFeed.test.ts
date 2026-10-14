import { describe, expect, it } from 'vitest';
import { flyerPayment, rateMoveSavings } from './agentFeed';

describe('flyerPayment', () => {
  it('test scenario: $500k, 20% down, 6.5%, tax $700, ins $150 → P&I $2,528.27, PITI $3,378.27', () => {
    const p = flyerPayment({ price: 500_000, downPct: 20, ratePct: 6.5, taxMonthly: 700, insuranceMonthly: 150 });
    expect(p.loan).toBe(400_000);
    expect(p.pi).toBeCloseTo(2528.27, 2);
    expect(p.total).toBeCloseTo(3378.27, 2);
  });
  it('$500k, 20% down at today’s 7.125% estimate → P&I $2,694.87, PITI $3,544.87', () => {
    const p = flyerPayment({ price: 500_000, downPct: 20, ratePct: 7.125, taxMonthly: 700, insuranceMonthly: 150 });
    expect(p.pi).toBeCloseTo(2694.87, 2);
    expect(p.total).toBeCloseTo(3544.87, 2);
  });
  it('guards zero / bad input', () => {
    expect(flyerPayment({ price: 0, downPct: 20, ratePct: 7 }).total).toBe(0);
    expect(Number.isFinite(flyerPayment({ price: NaN, downPct: NaN, ratePct: NaN }).total)).toBe(true);
    expect(flyerPayment({ price: 300_000, downPct: 150, ratePct: 7 }).loan).toBe(0);
  });
});

describe('rateMoveSavings', () => {
  it('$400k: 7.25% → 7.125% saves $33.83/mo', () => {
    expect(rateMoveSavings(400_000, 7.25, 7.125)).toBeCloseTo(33.83, 2);
  });
  it('no move → 0; rate up → negative', () => {
    expect(rateMoveSavings(400_000, 7, 7)).toBe(0);
    expect(rateMoveSavings(400_000, 7, 7.25)).toBeLessThan(0);
  });
});
