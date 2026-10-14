/**
 * Refi Risk of Waiting ("Refi COW Express"): refinance now vs wait for a hypothetical lower rate.
 *
 * - Cost of delaying = (existing P&I − refi-now P&I) × waiting months.
 * - Break-even = ceil(cost of delaying ÷ (refi-now P&I − future P&I)) months AFTER the future
 *   refinance closes (the waiting period is excluded, as on the live site).
 * - If the future rate is not lower than today's, waiting never breaks even.
 */
import { monthlyPayment } from './core';

export interface RefiRiskInput {
  existingAmount: number;
  existingTermYears: number;
  existingRate: number;
  refiAmount: number;
  refiTermYears: number;
  currentRate: number;
  futureRate: number;
  waitMonths: number;
}

export const REFI_DEFAULTS: RefiRiskInput = {
  existingAmount: 400000,
  existingTermYears: 30,
  existingRate: 7.5,
  refiAmount: 400000,
  refiTermYears: 30,
  currentRate: 6.5,
  futureRate: 6.0,
  waitMonths: 10,
};

export interface RefiPoint {
  month: number;
  refiNow: number;
  waitThenRefi: number;
}

export interface RefiRiskResult {
  existingPayment: number;
  refiNowPayment: number;
  futurePayment: number;
  refiNowSavings: number;
  futureSavings: number;
  costOfDelay: number;
  /** Months after the future refi to recover the cost of delay; null = never. */
  breakEvenMonths: number | null;
  /** breakEvenMonths + waitMonths (months from today); null = never. */
  breakEvenFromToday: number | null;
  waitMonths: number;
  series: RefiPoint[];
}

const fin = (n: number) => (Number.isFinite(n) ? n : 0);

export function refiRisk(raw: RefiRiskInput): RefiRiskResult {
  const wait = Math.max(0, Math.min(360, Math.round(fin(raw.waitMonths))));
  const exTerm = Math.max(1, Math.round(fin(raw.existingTermYears) || 30)) * 12;
  const refiTerm = Math.max(1, Math.round(fin(raw.refiTermYears) || 30)) * 12;
  const existingPayment = monthlyPayment(Math.max(0, fin(raw.existingAmount)), Math.max(0, fin(raw.existingRate)), exTerm);
  const refiNowPayment = monthlyPayment(Math.max(0, fin(raw.refiAmount)), Math.max(0, fin(raw.currentRate)), refiTerm);
  const futurePayment = monthlyPayment(Math.max(0, fin(raw.refiAmount)), Math.max(0, fin(raw.futureRate)), refiTerm);
  const refiNowSavings = existingPayment - refiNowPayment;
  const futureSavings = existingPayment - futurePayment;
  const costOfDelay = Math.max(0, refiNowSavings) * wait;
  const monthlyEdge = refiNowPayment - futurePayment;
  let breakEvenMonths: number | null;
  if (costOfDelay <= 0) breakEvenMonths = 0;
  else if (monthlyEdge <= 0) breakEvenMonths = null;
  else breakEvenMonths = Math.ceil(costOfDelay / monthlyEdge - 1e-9);

  const horizon = Math.min(360, Math.max(36, wait + (breakEvenMonths ?? 24) * 2));
  const series: RefiPoint[] = [];
  for (let m = 0; m <= horizon; m++) {
    series.push({
      month: m,
      refiNow: refiNowSavings * m,
      waitThenRefi: m <= wait ? 0 : futureSavings * (m - wait),
    });
  }
  return {
    existingPayment,
    refiNowPayment,
    futurePayment,
    refiNowSavings,
    futureSavings,
    costOfDelay,
    breakEvenMonths,
    breakEvenFromToday: breakEvenMonths === null ? null : breakEvenMonths + wait,
    waitMonths: wait,
    series,
  };
}
