import { describe, expect, it } from 'vitest';
import { alexCowInput, benefitByPeriod, benefitOfBuyingNow, futurePrice, periodLabel, todayColumn, waitColumns, type CowInput } from './costOfWaiting';

const R = Math.round;
const base = alexCowInput();

describe('Cost of Waiting — table Today vs 6mo vs 1yr (spec)', () => {
  const now = todayColumn(base);
  const [m6, y1, y15, y2] = waitColumns(base);

  it('property 500,000 / 509,902 (+1.98%) / 520,000', () => {
    expect(now.price).toBe(500000);
    expect(R(m6.price)).toBe(509902);
    expect(m6.priceChangePct.toFixed(2)).toBe('1.98');
    expect(R(y1.price)).toBe(520000);
  });
  it('loan presets 400,000 / 407,922 / 416,000 / 424,238 / 432,640', () => {
    expect(now.loan).toBe(400000);
    expect(R(m6.loan)).toBe(407922);
    expect(R(y1.loan)).toBe(416000);
    expect(R(y15.loan)).toBe(424238);
    expect(R(y2.loan)).toBe(432640);
    expect(R(y2.price)).toBe(540800);
  });
  it('down 100,000 / 101,980 / 104,000 and cash to close the same', () => {
    expect(now.down).toBe(100000);
    expect(R(m6.down)).toBe(101980);
    expect(R(y1.down)).toBe(104000);
    expect(now.cashToClose).toBe(100000);
    expect(R(m6.cashToClose)).toBe(101980);
    expect(R(y1.cashToClose)).toBe(104000);
  });
  it('rate 6.5 / 6.25 / 6.125; APR 6.5 / 6.269 / 6.124; MI 0 / 78 / 0', () => {
    expect([now.ratePct, m6.ratePct, y1.ratePct]).toEqual([6.5, 6.25, 6.125]);
    expect([now.aprPct, m6.aprPct, y1.aprPct]).toEqual([6.5, 6.269, 6.124]);
    expect([now.mi, m6.mi, y1.mi]).toEqual([0, 78, 0]);
  });
  it('annual P&I 30,339 / 30,140 / 30,332; monthly P&I 2,528 / 2,512 / 2,528', () => {
    expect(R(now.annualPI)).toBe(30339);
    expect(R(m6.annualPI)).toBe(30140);
    expect(R(y1.annualPI)).toBe(30332);
    expect([R(now.pi), R(m6.pi), R(y1.pi)]).toEqual([2528, 2512, 2528]);
  });
  it('taxes scale with price: 700 / 714 / 728; insurance fixed 146', () => {
    expect([now.taxes, m6.taxes, y1.taxes]).toEqual([700, 714, 728]);
    expect(m6.insurance).toBe(146);
  });
  it('total monthly 3,374 / 3,450 / 3,402; total annual 40,491 / 41,396 / 40,820', () => {
    expect([R(now.totalMonthly), R(m6.totalMonthly), R(y1.totalMonthly)]).toEqual([3374, 3450, 3402]);
    expect([R(now.totalAnnual), R(m6.totalAnnual), R(y1.totalAnnual)]).toEqual([40491, 41396, 40820]);
  });
});

describe('Benefit of Buying Now', () => {
  it('default falling rates, 12-mo wait: 20,000 + 336 − 4,000 = 16,336', () => {
    const b = benefitOfBuyingNow(base, 12);
    expect(b.appreciation).toBe(20000);
    expect(b.monthlyDiff).toBe(28);
    expect(b.cumulativeDiff).toBe(336);
    expect(b.refinanceApplies).toBe(true);
    expect(b.refinanceCost).toBe(4000);
    expect(b.benefit).toBe(16336);
  });
  it('after editing 1-yr rate to 7.0%: 20,000 + 3,216 = 23,216, no refi', () => {
    const edited: CowInput = { ...base, waits: base.waits.map((w) => (w.months === 12 ? { ...w, ratePct: 7, aprPct: 7 } : w)) };
    const b = benefitOfBuyingNow(edited, 12);
    expect(b.wait.pi).toBeCloseTo(2767.66, 2);
    expect(R(b.wait.pi)).toBe(2768);
    expect(R(b.wait.annualPI)).toBe(33212);
    expect(R(b.wait.totalMonthly)).toBe(3642);
    expect(R(b.wait.totalAnnual)).toBe(43700);
    expect(b.monthlyDiff).toBe(268);
    expect(b.cumulativeDiff).toBe(3216);
    expect(b.refinanceCost).toBe(0);
    expect(b.benefit).toBe(23216);
  });
  it('6-mo wait: 9,902 + 76×6 − 4,000', () => {
    const b = benefitOfBuyingNow(base, 6);
    expect(b.appreciation).toBe(9902);
    expect(b.monthlyDiff).toBe(76);
    expect(b.benefit).toBe(9902 + 456 - 4000);
  });
  it('refi cost % is editable and every period computes', () => {
    expect(benefitOfBuyingNow({ ...base, refiCostPct: 2 }, 12).refinanceCost).toBe(8000);
    const all = benefitByPeriod(base);
    expect(all.map((b) => b.months)).toEqual([6, 12, 18, 24]);
    all.forEach((b) => expect(Number.isFinite(b.benefit)).toBe(true));
  });
});

describe('edge cases', () => {
  it('price override from Edit Waiting modal replaces appreciation', () => {
    const w = { ...base.waits[1], priceOverride: 530000 };
    expect(futurePrice(base, w)).toBe(530000);
    expect(R(waitColumns({ ...base, waits: [w] })[0].loan)).toBe(424000);
  });
  it('zero price / zero rate never produces NaN', () => {
    const z: CowInput = { ...base, price: 0, ratePct: 0, termYears: 0, waits: base.waits.map((w) => ({ ...w, ratePct: 0 })) };
    const b = benefitOfBuyingNow(z, 12);
    for (const v of [b.benefit, b.now.totalMonthly, b.wait.totalAnnual, b.wait.taxes]) expect(Number.isFinite(v)).toBe(true);
  });
  it('period labels', () => {
    expect([periodLabel(0), periodLabel(6), periodLabel(12), periodLabel(18), periodLabel(24)]).toEqual(['Today', '6 months', '1 year', '1.5 years', '2 years']);
  });
});
