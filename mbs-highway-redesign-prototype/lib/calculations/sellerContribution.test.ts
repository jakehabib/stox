import { describe, it, expect } from 'vitest';
import {
  ALEX_SELLER_DEFAULTS as A,
  boughtDownRate,
  buydown21Cost,
  compareSellerContribution,
  cumulativeOutOfPocket,
  evaluateOption,
  financing,
  maxConcessionPct,
  pointsFromDollars,
} from './sellerContribution';

describe('buydown21Cost', () => {
  it('$400k @ 6.5%: yr1 at 4.5% + yr2 at 5.5% = $9,103.76', () => {
    // 12 × (2,528.27 − 2,026.74) = 6,018.37 ; 12 × (2,528.27 − 2,271.16) = 3,085.39
    expect(buydown21Cost(400000, 6.5, 360)).toBeCloseTo(9103.76, 2);
  });
  it('$300k @ 7% = $6,992.38', () => {
    expect(buydown21Cost(300000, 7, 360)).toBeCloseTo(6992.38, 2);
  });
  it('zero loan costs nothing; low rates floor at 0%', () => {
    expect(buydown21Cost(0, 6.5)).toBe(0);
    expect(Number.isFinite(buydown21Cost(100000, 1))).toBe(true);
  });
});

describe('points', () => {
  it('$10k on a $400k loan = 2.5 points → 0.625% lower at 0.25%/pt', () => {
    expect(pointsFromDollars(10000, 400000)).toBeCloseTo(2.5, 10);
    expect(boughtDownRate(6.5, 2.5, 0.25)).toBeCloseTo(5.875, 10);
  });
  it('ratio is an input; rate never goes below 0', () => {
    expect(boughtDownRate(6.5, 2, 0.375)).toBeCloseTo(5.75, 10);
    expect(boughtDownRate(1, 10, 0.5)).toBe(0);
    expect(pointsFromDollars(5000, 0)).toBe(0);
  });
});

describe('financing', () => {
  it('20% down → $400k first, no second', () => {
    expect(financing(500000, 20, false, 80)).toMatchObject({ downPayment: 100000, firstLoan: 400000, secondLoan: 0, ltv: 80 });
  });
  it('80/10/10 piggyback', () => {
    const f = financing(500000, 10, true, 80);
    expect(f.firstLoan).toBe(400000);
    expect(f.secondLoan).toBe(50000);
    expect(f.cltv).toBe(90);
  });
});

describe('maxConcessionPct (conventional IPC limits)', () => {
  it('by LTV', () => {
    expect(maxConcessionPct(97)).toBe(3);
    expect(maxConcessionPct(80)).toBe(6);
    expect(maxConcessionPct(70)).toBe(9);
  });
});

describe('evaluateOption — Alex ($500k, 20% down, 6.5%, $10k concession, $12k closing)', () => {
  it('baseline', () => {
    const o = evaluateOption(A, 'none');
    expect(o.firstLoan).toBe(400000);
    expect(o.piFirst).toBeCloseTo(2528.27, 2);
    expect(o.monthly).toBeCloseTo(3378.27, 2);
    expect(o.cashToClose).toBe(112000);
  });
  it('(a) price reduction of $10k at 20% down lowers the loan by $8k', () => {
    const o = evaluateOption(A, 'price');
    expect(o.price).toBe(490000);
    expect(o.firstLoan).toBe(392000);
    expect(400000 - o.firstLoan).toBe(8000);
    expect(o.piFirst).toBeCloseTo(2477.71, 2);
    expect(o.downPayment).toBe(98000);
    expect(o.cashToClose).toBe(110000);
  });
  it('(b) closing cost credit lowers cash to close by $10k, payment unchanged', () => {
    const o = evaluateOption(A, 'credit');
    expect(o.piFirst).toBeCloseTo(2528.27, 2);
    expect(o.cashToClose).toBe(102000);
    expect(o.unused).toBe(0);
    const big = evaluateOption({ ...A, concession: 15000 }, 'credit');
    expect(big.creditApplied).toBe(12000);
    expect(big.unused).toBe(3000);
  });
  it('(c) permanent buydown: 2.5 pts → 5.875% → P&I $2,366.15', () => {
    const o = evaluateOption(A, 'permanent');
    expect(o.points).toBeCloseTo(2.5, 10);
    expect(o.noteRate).toBeCloseTo(5.875, 10);
    expect(o.piFirst).toBeCloseTo(2366.15, 2);
    expect(o.cashToClose).toBe(112000);
  });
  it('(d) 2-1 buydown: costs $9,103.76, leftover $896.24 becomes a closing credit', () => {
    const o = evaluateOption(A, 'temporary');
    expect(o.buydownCost).toBeCloseTo(9103.76, 2);
    expect(o.year1Rate).toBe(4.5);
    expect(o.year2Rate).toBe(5.5);
    expect(o.monthlyYear1 - o.escrow).toBeCloseTo(2026.74, 2);
    expect(o.monthlyYear2 - o.escrow).toBeCloseTo(2271.16, 2);
    expect(o.piFirst).toBeCloseTo(2528.27, 2);
    expect(o.creditApplied).toBeCloseTo(896.24, 2);
    expect(o.cashToClose).toBeCloseTo(111103.76, 2);
  });
  it('(d) shortfall when the concession is smaller than the buydown cost', () => {
    const o = evaluateOption({ ...A, concession: 5000 }, 'temporary');
    expect(o.shortfall).toBeCloseTo(4103.76, 2);
    expect(o.cashToClose).toBeCloseTo(116103.76, 2);
  });
  it('MI applies under 20% down; piggyback removes it', () => {
    const conv = evaluateOption({ ...A, downPct: 10 }, 'none');
    expect(conv.mi).toBeCloseTo((450000 * 0.0044) / 12, 4);
    const pig = evaluateOption({ ...A, downPct: 10, secondLoan: true }, 'none');
    expect(pig.mi).toBe(0);
    expect(pig.secondLoan).toBe(50000);
    expect(pig.piSecond).toBeGreaterThan(0);
  });
});

describe('compareSellerContribution', () => {
  it('Alex: permanent buydown wins long-term payment, credit wins cash, 2-1 wins year 1', () => {
    const c = compareSellerContribution(A);
    expect(c.best.payment).toBe('permanent');
    expect(c.best.cash).toBe('credit');
    expect(c.best.year1).toBe('temporary');
    expect(c.concessionPct).toBe(2);
    expect(c.maxConcessionPct).toBe(6);
    expect(c.overLimit).toBe(false);
  });
  it('total cost = cash to close + payments + balance at hold', () => {
    const c = compareSellerContribution(A);
    c.options.forEach((o) => expect(o.totalCost).toBeCloseTo(o.cashToClose + o.paymentsOverHold + o.balanceAtHold, 6));
    expect(['permanent', 'price']).toContain(c.best.total);
  });
  it('flags concessions over the IPC limit', () => {
    expect(compareSellerContribution({ ...A, downPct: 5, concession: 20000 }).overLimit).toBe(true);
  });
  it('no NaN on garbage input', () => {
    const c = compareSellerContribution({ ...A, price: NaN, downPct: -4, ratePct: NaN, termYears: 0, holdingYears: NaN, concession: -1 });
    [c.baseline, ...c.options].forEach((o) => Object.values(o).forEach((v) => typeof v === 'number' && expect(Number.isFinite(v)).toBe(true)));
  });
});

describe('cumulativeOutOfPocket', () => {
  it('starts at cash to close + 12 payments and grows each year', () => {
    const s = cumulativeOutOfPocket(A, 'none', 3);
    expect(s).toHaveLength(3);
    expect(s[0]).toBeCloseTo(112000 + 12 * 2528.272094, 2);
    expect(s[2] - s[1]).toBeCloseTo(12 * 2528.272094, 2);
  });
  it('2-1 buydown is cheaper in year 1', () => {
    expect(cumulativeOutOfPocket(A, 'temporary', 1)[0]).toBeLessThan(cumulativeOutOfPocket(A, 'none', 1)[0]);
  });
});
