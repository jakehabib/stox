/** Agent Feed — payment math for co-branded listing flyers and rate-move alerts. Pure functions. */
import { monthlyPayment } from './core';

export interface FlyerPaymentInput {
  price: number;
  downPct: number; // 20 = 20%
  ratePct: number;
  termMonths?: number;
  taxMonthly?: number;
  insuranceMonthly?: number;
  hoaMonthly?: number;
}

/** Estimated PITI for a listing flyer. */
export function flyerPayment(i: FlyerPaymentInput) {
  const price = Math.max(0, Number.isFinite(i.price) ? i.price : 0);
  const downPct = Math.min(100, Math.max(0, Number.isFinite(i.downPct) ? i.downPct : 0));
  const down = (price * downPct) / 100;
  const loan = price - down;
  const pi = monthlyPayment(loan, Math.max(0, i.ratePct || 0), i.termMonths ?? 360);
  const tax = Math.max(0, i.taxMonthly ?? 0);
  const ins = Math.max(0, i.insuranceMonthly ?? 0);
  const hoa = Math.max(0, i.hoaMonthly ?? 0);
  return { down, loan, pi, tax, ins, hoa, total: pi + tax + ins + hoa };
}

/** Monthly P&I change on a loan when the rate moves from `fromPct` to `toPct` (positive = savings). */
export function rateMoveSavings(loan: number, fromPct: number, toPct: number, termMonths = 360): number {
  return monthlyPayment(loan, Math.max(0, fromPct || 0), termMonths) - monthlyPayment(loan, Math.max(0, toPct || 0), termMonths);
}
