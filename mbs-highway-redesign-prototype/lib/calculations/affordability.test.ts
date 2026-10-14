import { describe, expect, it } from 'vitest';
import { conventionalMiRatePct, MI_TABLE } from '@/data/mock/mi';
import { AFFORDABILITY_DEFAULTS as D, calcAffordability, dtiZone, housingBudget, paymentAtPrice, priceByDti, zoneScenarios } from './affordability';

const r = Math.round;

describe('MI rate card (FICO 720–739 column as observed)', () => {
  it('LTV tiers', () => {
    expect(conventionalMiRatePct(96.1)).toBe(0.87);
    expect(conventionalMiRatePct(90.2)).toBe(0.66);
    expect(conventionalMiRatePct(88)).toBe(0.44);
    expect(conventionalMiRatePct(82)).toBe(0.28);
    expect(conventionalMiRatePct(80)).toBe(0);
  });
  it('better credit pays less MI', () => expect(MI_TABLE['760+'][2]).toBeLessThan(MI_TABLE['720–739'][2]));
});

describe('budget', () => {
  it('36% × $65k/12 − $500 debts = $1,450', () => expect(housingBudget(D)).toBeCloseTo(1450, 6));
  it('36% × $150k/12 − $500 debts = $4,000', () => expect(housingBudget({ ...D, annualIncome: 150000 })).toBeCloseTo(4000, 6));
  it('payment mode uses the target payment', () => expect(housingBudget({ ...D, mode: 'payment', targetPayment: 2000 })).toBe(2000));
});

describe('spec example — $65k income, $20k down, 7.5%', () => {
  const a = calcAffordability(D);
  it('afford $204,298, Comfortable, DTI 36%', () => {
    expect(a.price).toBe(204298);
    expect(a.zone).toBe('Comfortable');
    expect(r(a.dtiPct)).toBe(36);
  });
  it('total monthly $1,450 = P&I $1,289 + TaxIns $161 (MI $101 at 0.66%)', () => {
    expect(r(a.total)).toBe(1450);
    expect(r(a.pi)).toBe(1289);
    expect(r(a.taxInsMi)).toBe(161);
    expect(r(a.mi)).toBe(101);
    expect(a.miRatePct).toBe(0.66);
    expect(r(a.taxIns)).toBe(60);
  });
  it('closing $6,129, prepaid $6,129, cash to close $32,258, down 9.79%', () => {
    expect(r(a.closing)).toBe(6129);
    expect(r(a.prepaid)).toBe(6129);
    expect(r(a.cashToClose)).toBe(32258);
    expect(a.downPct.toFixed(2)).toBe('9.79');
  });
});

describe('spec example — $150k income', () => {
  const a = calcAffordability({ ...D, annualIncome: 150000 });
  it('afford $518,760, Comfortable, DTI 36%', () => {
    expect(a.price).toBe(518760);
    expect(a.zone).toBe('Comfortable');
    expect(r(a.dtiPct)).toBe(36);
  });
  it('total $4,000 = P&I $3,487 + TaxIns $513 (MI $362 at 0.87%)', () => {
    expect(r(a.total)).toBe(4000);
    expect(r(a.pi)).toBe(3487);
    expect(r(a.taxInsMi)).toBe(513);
    expect(r(a.mi)).toBe(362);
    expect(a.miRatePct).toBe(0.87);
  });
  it('closing $15,563, prepaid $15,563, cash to close $51,126, down 3.86%', () => {
    expect(r(a.closing)).toBe(15563);
    expect(r(a.prepaid)).toBe(15563);
    expect(r(a.cashToClose)).toBe(51126);
    expect(a.downPct.toFixed(2)).toBe('3.86');
  });
});

describe('payment mode, programs and guards', () => {
  it('payment mode: $1,450 target reproduces the $65k income price', () => expect(calcAffordability({ ...D, mode: 'payment', targetPayment: 1450 }).price).toBe(204298));
  it('higher DTI → higher price, lower → lower', () => {
    const s = zoneScenarios(D);
    expect(s[0].price).toBe(204298);
    expect(s[1].price).toBeGreaterThan(s[0].price);
    expect(s[2].price).toBeGreaterThan(s[1].price);
    const curve = priceByDti(D, 30, 40);
    expect(curve[0].price).toBeLessThan(curve[curve.length - 1].price);
  });
  it('dti zones', () => {
    expect(dtiZone(36)).toBe('Comfortable');
    expect(dtiZone(40)).toBe('Stretch');
    expect(dtiZone(43)).toBe('Stretch');
    expect(dtiZone(45)).toBe('Aggressive');
  });
  it('FHA finances 1.75% UFMIP and charges 0.55% annual MIP above 95% LTV', () => {
    const b = paymentAtPrice({ ...D, program: 'FHA' }, 500000);
    expect(b.upfrontFee).toBeCloseTo(480000 * 0.0175, 6);
    expect(b.miRatePct).toBe(0.55);
  });
  it('VA has no monthly MI and a 2.15% funding fee under 5% down', () => {
    const b = paymentAtPrice({ ...D, program: 'VA' }, 500000);
    expect(b.mi).toBe(0);
    expect(b.upfrontFeePct).toBe(2.15);
  });
  it('no NaN on zero / empty inputs', () => {
    const z = calcAffordability({ ...D, annualIncome: 0, downPayment: 0, ratePct: 0, termYears: 0 });
    for (const v of [z.price, z.total, z.dtiPct, z.cashToClose, z.pi, z.mi]) expect(Number.isFinite(v)).toBe(true);
    const h = calcAffordability({ ...D, annualIncome: 1e9 });
    expect(Number.isFinite(h.price)).toBe(true);
  });
  it('conventional price is capped at 3% minimum down', () => {
    const a = calcAffordability({ ...D, annualIncome: 1_000_000 });
    expect(a.price).toBe(Math.round(20000 / 0.03));
    expect(a.limitedByDown).toBe(true);
  });
});
