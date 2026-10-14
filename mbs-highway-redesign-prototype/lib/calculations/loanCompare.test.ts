import { describe, expect, it } from 'vitest';
import { alexProperty, defaultProperty } from './property';
import {
  alexLoanOptions,
  amortizationByYear,
  bestIndices,
  cashToClose,
  compareLoans,
  computeOption,
  downPctFromLoan,
  futureValueMonthly,
  loanAmountOf,
  newLoanOption,
  reinvestment,
  summaryFacts,
  yearlySeries,
} from './loanCompare';

const R = Math.round;
const prop = alexProperty();
const [opt1, opt2] = alexLoanOptions();

describe('Loan Comparison — spec example (Alex Rivera, 7-yr hold)', () => {
  const c = compareLoans(prop, [opt1, opt2], 7);
  const [a, b] = c.options;

  it('Option 1 monthly view: P&I 2,528 · principal 566 · interest 1,962 · ins 146 · taxes 700 · total 3,374', () => {
    expect(a.pi).toBeCloseTo(2528.27, 2);
    expect(R(a.principalPart)).toBe(566);
    expect(R(a.interestPart)).toBe(1962);
    expect(R(a.insurance + a.hoa)).toBe(146);
    expect(R(a.taxes)).toBe(700);
    expect(R(a.totalMonthly)).toBe(3374);
  });
  it('Option 2 monthly view: P&I 2,430 · principal 593 · interest 1,837 · total 3,276 (saves 98/mo)', () => {
    expect(b.pi).toBeCloseTo(2430.44, 2);
    expect(R(b.principalPart)).toBe(593);
    expect(R(b.interestPart)).toBe(1837);
    expect(R(b.totalMonthly)).toBe(3276);
    expect(c.spread.monthly).toBe(98);
  });
  it('Detailed: purchase 500k, loan 400k, APR 6.5 / 6.124, cash to close 100,000 each', () => {
    expect(a.price).toBe(500000);
    expect(a.loanAmount).toBe(400000);
    expect(b.loanAmount).toBe(400000);
    expect(a.aprPct).toBe(6.5);
    expect(b.aprPct).toBe(6.124);
    expect(a.cashToClose).toBe(100000);
    expect(b.cashToClose).toBe(100000);
  });
  it('Total Cost tab: interest 174,040 / 163,509, total = interest, diff 10,531', () => {
    expect(R(a.interestPaid)).toBe(174040);
    expect(R(a.totalCost)).toBe(174040);
    expect(R(b.interestPaid)).toBe(163509);
    expect(R(b.totalCost)).toBe(163509);
    expect(c.spread.cost).toBe(10531);
  });
  it('Equity Impact tab: principal, appreciation, down, equity, balance', () => {
    expect(R(a.principalPaid)).toBe(38335);
    expect(R(a.appreciation)).toBe(104686);
    expect(a.downPayment).toBe(100000);
    expect(R(a.totalEquity)).toBe(243021);
    expect(R(a.balance)).toBe(361665);
    expect(R(b.principalPaid)).toBe(40648);
    expect(R(b.principalPaid) - R(a.principalPaid)).toBe(2313);
    // Spec prints 245,335 (+2,314), but its own components sum to 40,648 + 104,686 + 100,000 = 245,334.
    // Reported as a $1 rounding discrepancy of the live site.
    expect(R(b.totalEquity)).toBe(245334);
    expect(c.spread.equity).toBe(2313);
    expect(R(b.balance)).toBe(359352);
  });
  it('Projected value Yr10 $634,338 (+$134,338)', () => {
    expect(R(c.projectedValue10)).toBe(634338);
    expect(R(c.projectedValue10 - 500000)).toBe(134338);
  });
  it('badges: Option 2 lowest monthly & lowest cost; cash to close tied → both', () => {
    expect(c.winners.monthly).toEqual([1]);
    expect(c.winners.cost).toEqual([1]);
    expect(c.winners.equity).toEqual([1]);
    expect(c.winners.cash).toEqual([0, 1]);
    const f = summaryFacts(c)!;
    expect(f.sweep).toBe(true);
    expect(f.sameCash).toBe(true);
    expect(f.anyPoints).toBe(false);
  });
});

describe('computeOption', () => {
  it('holding period changes the monthly split (1yr → payment 12)', () => {
    const r = computeOption(prop, opt1, 1);
    expect(R(r.interestPart)).toBe(2145);
    expect(R(r.principalPart)).toBe(384); // matches Buy vs Rent Yr1 384 + 2,145
    expect(r.holdingMonths).toBe(12);
  });
  it('holding clamps to 1..30 years and never NaN on zero price', () => {
    const r = computeOption({ ...prop, price: 0 }, opt1, 0);
    expect(r.holdingMonths).toBe(12);
    for (const v of Object.values(r)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    const r2 = computeOption(prop, newLoanOption({ ratePct: 0, termYears: 15 }), 30);
    expect(r2.holdingMonths).toBe(180);
    expect(R(r2.balance)).toBe(0);
  });
  it('points + closing + prepaid − credits flow into cash to close and total cost', () => {
    const o = newLoanOption({ pointsPct: 1, closingCosts: 6000, prepaid: 2500, credits: 1000 });
    expect(cashToClose(500000, o)).toBe(100000 + 4000 + 6000 + 2500 - 1000);
    const r = computeOption(prop, o, 7);
    expect(R(r.totalCost)).toBe(174040 + 4000 + 6000 - 1000);
  });
});

describe('loan amount helpers', () => {
  it('20% of 500k → 400k; loan → down pct round-trips', () => {
    expect(loanAmountOf(500000, { downPct: 20 })).toBe(400000);
    expect(downPctFromLoan(500000, 450000)).toBe(10);
    expect(downPctFromLoan(0, 1)).toBe(0);
  });
});

describe('bestIndices', () => {
  it('ties return all tied indices; single option has no winner', () => {
    expect(bestIndices([100000, 100000], 'low')).toEqual([0, 1]);
    expect(bestIndices([3, 1, 2], 'low')).toEqual([1]);
    expect(bestIndices([3, 1, 2], 'high')).toEqual([0]);
    expect(bestIndices([5], 'low')).toEqual([]);
  });
});

describe('reinvestment', () => {
  it('future value of $100/mo at 6% for 10 yrs = $16,388', () => expect(R(futureValueMonthly(100, 6, 120))).toBe(16388));
  it('0% rate = contributions; zero months = 0', () => {
    expect(futureValueMonthly(98, 0, 84)).toBe(98 * 84);
    expect(futureValueMonthly(98, 6, 0)).toBe(0);
  });
  it('Option 2 invests its $97.83/mo savings vs Option 1 for 7 yrs at 6%', () => {
    const c = compareLoans(prop, [opt1, opt2], 7);
    const [ra, rb] = reinvestment(c.options, 6);
    expect(ra.futureValue).toBe(0);
    expect(rb.monthlySavings).toBeCloseTo(97.83, 2);
    expect(R(rb.contributions)).toBe(8218);
    expect(R(rb.futureValue)).toBe(10182);
  });
});

describe('series & amortization', () => {
  it('yearly series year 7 equals the 7-yr results', () => {
    const s = yearlySeries(prop, opt1, 7);
    expect(s).toHaveLength(8);
    expect(s[0].equity).toBe(100000);
    expect(R(s[7].equity)).toBe(243021);
    expect(R(s[7].cost)).toBe(174040);
  });
  it('amortization by year: 30 rows, yr 9 balance 347,117, pays off', () => {
    const a = amortizationByYear(500000, opt1);
    expect(a).toHaveLength(30);
    expect(R(a[8].balance)).toBe(347117);
    expect(a[29].balance).toBeLessThan(1);
    expect(amortizationByYear(500000, newLoanOption({ downPct: 100 }))).toEqual([]);
  });
  it('Purchase Analysis default property (auto tax $9,206) → Option 1 total $3,441', () => {
    const p = defaultProperty('dallas-tx-75201', 500000);
    expect(p.taxAnnual).toBe(9206);
    expect(R(computeOption(p, opt1, 7).totalMonthly)).toBe(3441);
  });
});

describe('property variants & APR estimate', () => {
  it('alternate price scales tax; extra location uses county tax + default insurance', async () => {
    const { propertyVariants } = await import('./loanCompare');
    const v = propertyVariants({ ...prop, alternatePrices: [475000], extraLocationIds: ['marlboro-nj-07746'] });
    expect(v).toHaveLength(3);
    expect(v[0].property.taxAnnual).toBe(8400);
    expect(v[1].property.price).toBe(475000);
    expect(v[1].property.taxAnnual).toBe(7980);
    expect(v[2].property.locationId).toBe('marlboro-nj-07746');
  });
  it('APR equals rate with no fees, rises with points', async () => {
    const { estimateApr } = await import('./loanCompare');
    expect(estimateApr(500000, opt1)).toBe(6.5);
    expect(estimateApr(500000, newLoanOption({ pointsPct: 1, closingCosts: 4000 }))).toBeGreaterThan(6.6);
  });
});
