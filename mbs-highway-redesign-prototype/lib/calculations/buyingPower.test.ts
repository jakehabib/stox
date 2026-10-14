import { describe, expect, it } from 'vitest';
import { BUYING_POWER_DEFAULTS as D, buyingPowerCurve, calcBuyingPower, dollarsPerEighth, roundToThousand } from './buyingPower';

const res = calcBuyingPower(D);
const col = (r: number) => res.columns.find((c) => c.ratePct === r)!;

describe('Buying Power — spec example $400k @ 6.5%', () => {
  it('base payment $2,528/mo', () => expect(Math.round(res.basePayment)).toBe(2528));
  it('keep $2,528 at 7.25% → $371k loan (−$29k)', () => {
    expect(col(7.25).supportedLoanRounded).toBe(371000);
    expect(col(7.25).loanDiff).toBe(-29000);
  });
  it('7% → $380k, 6.75% → $390k, 6.625% → $395k', () => {
    expect(col(7).supportedLoanRounded).toBe(380000);
    expect(col(6.75).supportedLoanRounded).toBe(390000);
    expect(col(6.625).supportedLoanRounded).toBe(395000);
  });
  it('base column supports exactly the loan', () => {
    expect(col(6.5).supportedLoanRounded).toBe(400000);
    expect(col(6.5).isBase).toBe(true);
  });
  it('0% column: payment row $1,111/mo (400k / 360)', () => expect(Math.round(col(0).payment)).toBe(1111));
  it('lower rates raise buying power: 6% → $422k, 6.25% → $411k', () => {
    expect(col(6).supportedLoanRounded).toBe(422000);
    expect(col(6.25).supportedLoanRounded).toBe(411000);
  });
});

describe('APR and guards', () => {
  it('APR with $1,000 costs is a bit above the note rate', () => {
    expect(res.baseApr).toBeGreaterThan(6.5);
    expect(res.baseApr.toFixed(3)).toBe('6.524');
  });
  it('manual APR is used when auto is off', () => expect(calcBuyingPower({ ...D, aprAuto: false, aprPct: 6.605 }).baseApr).toBe(6.605));
  it('1/8 point ≈ $5k of loan at $400k', () => expect(Math.round(dollarsPerEighth(D) / 1000)).toBe(5));
  it('curve is decreasing in rate', () => {
    const c = buyingPowerCurve(D);
    expect(c[0].loan).toBeGreaterThan(c[c.length - 1].loan);
  });
  it('no NaN with empty inputs', () => {
    const z = calcBuyingPower({ ...D, loanAmount: 0, ratePct: NaN, termYears: 0, rates: [NaN, 0, 7] });
    for (const c of z.columns) for (const v of [c.payment, c.supportedLoan, c.apr, c.loanDiff]) expect(Number.isFinite(v)).toBe(true);
    expect(roundToThousand(-5)).toBe(0);
  });
});
