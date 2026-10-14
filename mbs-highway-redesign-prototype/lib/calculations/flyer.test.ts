import { describe, it, expect } from 'vitest';
import { flyerScenario, incomeNeeded, ltvPct, miLtvBandIndex, miRatePct, monthlyMi, pricePerSqft, type FlyerScenarioInput } from './flyer';

const base: FlyerScenarioInput = { price: 500000, downPct: 20, program: 'conventional', ratePct: 6.5, termYears: 30, taxAnnual: 8400, insuranceMonthly: 150, hoaMonthly: 0, fico: '720–739' };

describe('ltvPct / MI bands', () => {
  it('computes LTV', () => {
    expect(ltvPct(400000, 500000)).toBe(80);
    expect(ltvPct(475000, 500000)).toBe(95);
    expect(ltvPct(1, 0)).toBe(0);
  });
  it('maps LTV to bands (≤80 = no MI)', () => {
    expect(miLtvBandIndex(80)).toBe(-1);
    expect(miLtvBandIndex(80.5)).toBe(0);
    expect(miLtvBandIndex(90)).toBe(1);
    expect(miLtvBandIndex(95)).toBe(2);
    expect(miLtvBandIndex(97)).toBe(3);
    expect(miLtvBandIndex(99)).toBe(3);
  });
  it('MI rate by LTV/FICO matches the worksheet', () => {
    expect(miRatePct(80, '720–739')).toBe(0);
    expect(miRatePct(95, '720–739')).toBe(0.66);
    expect(miRatePct(96.14, '720–739')).toBe(0.87);
    expect(miRatePct(85, '760+')).toBe(0.17);
  });
  it('monthly MI dollars', () => {
    expect(monthlyMi(475000, 500000, '720–739')).toBeCloseTo(261.25, 2);
    expect(monthlyMi(400000, 500000, '720–739')).toBe(0);
  });
});

describe('flyerScenario', () => {
  it('Alex: $500k, 20% down, 6.5% → P&I $2,528.27, PITI $3,378.27, no MI', () => {
    const r = flyerScenario(base);
    expect(r.downPayment).toBe(100000);
    expect(r.loan).toBe(400000);
    expect(r.pi).toBeCloseTo(2528.27, 2);
    expect(r.mi).toBe(0);
    expect(r.tax).toBe(700);
    expect(r.total).toBeCloseTo(3378.27, 2);
  });
  it('5% down conventional adds MI (0.66% at 95% LTV)', () => {
    const r = flyerScenario({ ...base, downPct: 5 });
    expect(r.loan).toBe(475000);
    expect(r.pi).toBeCloseTo(3002.32, 2);
    expect(r.mi).toBeCloseTo(261.25, 2);
    expect(r.total).toBeCloseTo(4113.57, 2);
  });
  it('3% down conventional uses the 95–97% band (0.87%)', () => {
    const r = flyerScenario({ ...base, downPct: 3 });
    expect(r.loan).toBe(485000);
    expect(r.pi).toBeCloseTo(3065.53, 2);
    expect(r.mi).toBeCloseTo(351.63, 2);
    expect(r.total).toBeCloseTo(4267.15, 2);
  });
  it('FHA 3.5% finances 1.75% UFMIP and charges 0.55% annual MIP', () => {
    const r = flyerScenario({ ...base, downPct: 3.5, program: 'fha', ratePct: 6.25 });
    expect(r.baseLoan).toBe(482500);
    expect(r.upfrontMip).toBeCloseTo(8443.75, 2);
    expect(r.loan).toBeCloseTo(490943.75, 2);
    expect(r.pi).toBeCloseTo(3022.83, 2);
    expect(r.mi).toBeCloseTo(221.15, 2);
  });
  it('never returns NaN on empty / extreme input', () => {
    const r = flyerScenario({ ...base, price: NaN, downPct: 200, ratePct: -5, termYears: 0, taxAnnual: NaN });
    Object.values(r).forEach((v) => expect(Number.isFinite(v)).toBe(true));
    const z = flyerScenario({ ...base, price: 0 });
    expect(z.total).toBeCloseTo(850, 5); // tax $700 + ins $150 still apply
  });
});

describe('helpers', () => {
  it('price per sqft', () => {
    expect(pricePerSqft(500000, 2500)).toBe(200);
    expect(pricePerSqft(500000, 0)).toBe(0);
  });
  it('income needed at 28% front-end', () => {
    expect(incomeNeeded(2800, 28)).toBeCloseTo(10000, 6);
    expect(incomeNeeded(3378.27, 28)).toBeCloseTo(12065.25, 2);
    expect(incomeNeeded(1000, 0)).toBe(0);
  });
});
