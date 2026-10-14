import { describe, expect, it } from 'vitest';
import { blendedRate } from './blendedRate';

const mortgage = { name: 'Mortgage', balance: 400000, ratePct: 6.5, payment: 0 };
const card = { name: 'Credit card', balance: 8000, ratePct: 22, payment: 0 };
const auto = { name: 'Auto loan', balance: 15000, ratePct: 8, payment: 0 };

describe('blendedRate', () => {
  it('spec example: total $423,000, blended 6.846%, total monthly $0', () => {
    const r = blendedRate([mortgage, card, auto]);
    expect(r.totalBalance).toBe(423000);
    expect(r.blendedRatePct.toFixed(3)).toBe('6.846');
    expect(r.totalPayment).toBe(0);
  });
  it('intermediates 6.5% → 6.804% → 6.846%', () => {
    const r = blendedRate([mortgage, card, auto]);
    expect(r.running.map((x) => x.toFixed(3))).toEqual(['6.500', '6.804', '6.846']);
    expect(blendedRate([mortgage]).blendedRatePct).toBe(6.5);
    expect(blendedRate([mortgage, card]).blendedRatePct.toFixed(3)).toBe('6.804');
  });
  it('sums entered payments only', () => {
    const r = blendedRate([{ ...mortgage, payment: 2528 }, { ...card, payment: 250 }, { ...auto, payment: 350 }]);
    expect(r.totalPayment).toBe(3128);
  });
  it('shares of balance and interest add to 1', () => {
    const r = blendedRate([mortgage, card, auto]);
    expect(r.contributions.reduce((s, c) => s + c.balanceShare, 0)).toBeCloseTo(1, 9);
    expect(r.contributions.reduce((s, c) => s + c.interestShare, 0)).toBeCloseTo(1, 9);
    expect(r.contributions[1].interestShare).toBeCloseTo(1760 / 28960, 9);
  });
  it('caps at 3 debts and handles empty / zero balances', () => {
    expect(blendedRate([mortgage, card, auto, auto]).totalBalance).toBe(423000);
    expect(blendedRate([]).blendedRatePct).toBe(0);
    expect(blendedRate([{ name: '', balance: 0, ratePct: 5, payment: NaN }]).blendedRatePct).toBe(0);
  });
});
