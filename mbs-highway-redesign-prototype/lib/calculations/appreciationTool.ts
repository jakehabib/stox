/**
 * Appreciation tool (/members/appreciation): future home value and return on cash invested.
 * Pure functions. Values follow the location forecast curve (forecast mode) or compound a
 * flat rate (historical / custom) via lib/calculations/appreciation.ts.
 */
import { getLocation } from '@/data/mock/locations';
import { displayedRate, valueAtYear, type AppreciationMode } from './appreciation';
import { cagr } from './core';

export const MAX_APPRECIATION_MODES = 2;
export const APPRECIATION_MODE_ORDER: AppreciationMode[] = ['forecast', 'historical', 'custom'];
export const APPRECIATION_MODE_LABEL: Record<AppreciationMode, string> = {
  forecast: 'Forecast',
  historical: 'Historical',
  custom: 'Custom',
};

const fin = (n: number) => (Number.isFinite(n) ? n : 0);

/** Toggle a mode in the "Select up to 2" checkbox group. Adding beyond the max is a no-op. Result keeps canonical order. */
export function toggleAppreciationMode(selected: AppreciationMode[], mode: AppreciationMode, on: boolean): AppreciationMode[] {
  const set = new Set(selected);
  if (on) {
    if (!set.has(mode) && set.size >= MAX_APPRECIATION_MODES) return selected;
    set.add(mode);
  } else set.delete(mode);
  return APPRECIATION_MODE_ORDER.filter((m) => set.has(m));
}

/** Down payment in dollars from a $ fee or a % of price. */
export function downPaymentDollars(price: number, value: number, unit: 'fee' | 'pct'): number {
  const p = Math.max(0, fin(price));
  const v = Math.max(0, fin(value));
  return unit === 'pct' ? (p * v) / 100 : v;
}

/** Convert the down payment value when the $ / % toggle flips. */
export function convertDownUnit(price: number, value: number, from: 'fee' | 'pct', to: 'fee' | 'pct'): number {
  if (from === to) return value;
  const p = fin(price);
  if (to === 'pct') return p > 0 ? Math.round((fin(value) / p) * 100 * 1000) / 1000 : 0;
  return Math.round((p * fin(value)) / 100);
}

/** Rate shown on the form next to each checkbox (forecast = location long-run display rate, e.g. Dallas 2.481%). */
export function formRatePct(locationId: string, mode: AppreciationMode, customPct: number): number {
  return displayedRate(getLocation(locationId), { mode, customPct });
}

export function homeValueAt(price: number, locationId: string, mode: AppreciationMode, customPct: number, year: number): number {
  return fin(valueAtYear(Math.max(0, fin(price)), getLocation(locationId), { mode, customPct: fin(customPct) }, Math.max(0, fin(year))));
}

/** Values for years 0..years. */
export function homeValueSeries(price: number, locationId: string, mode: AppreciationMode, customPct: number, years: number): number[] {
  const n = Math.max(0, Math.round(fin(years)));
  return Array.from({ length: n + 1 }, (_, y) => homeValueAt(price, locationId, mode, customPct, y));
}

export interface AppreciationToolInput {
  price: number;
  locationId: string;
  mode: AppreciationMode;
  customPct: number;
  downPayment: number; // dollars
  closingCosts: number; // dollars
  years: number;
}

export interface AppreciationToolResult {
  mode: AppreciationMode;
  years: number;
  homeValue: number;
  appreciation: number;
  appreciationAvgPerYear: number;
  cashInvested: number;
  /** Appreciation ÷ cash invested (down + closing), percent. */
  roiPct: number;
  /** roiPct ÷ years (simple average), percent. */
  roiAvgPerYearPct: number;
  /** Effective annualized rate over the horizon (Dallas forecast, 10yr → 2.41%). */
  effectiveRatePct: number;
  /** Rate shown on the input form (Dallas forecast → 2.481%). */
  formRatePct: number;
  /**
   * Alternative ROI basis that reproduces the live site's 126%: (appreciation − closing costs) ÷ down payment.
   * Kept for reference / reporting only.
   */
  roiNetOfClosingOnDownPct: number;
}

export function appreciationResult(i: AppreciationToolInput): AppreciationToolResult {
  const price = Math.max(0, fin(i.price));
  const years = Math.max(0, Math.round(fin(i.years)));
  const down = Math.max(0, fin(i.downPayment));
  const closing = Math.max(0, fin(i.closingCosts));
  const homeValue = homeValueAt(price, i.locationId, i.mode, i.customPct, years);
  const appreciation = homeValue - price;
  const cashInvested = down + closing;
  const roiPct = cashInvested > 0 ? (appreciation / cashInvested) * 100 : 0;
  return {
    mode: i.mode,
    years,
    homeValue,
    appreciation,
    appreciationAvgPerYear: years > 0 ? appreciation / years : 0,
    cashInvested,
    roiPct,
    roiAvgPerYearPct: years > 0 ? roiPct / years : 0,
    effectiveRatePct: fin(cagr(price, homeValue, years)),
    formRatePct: fin(formRatePct(i.locationId, i.mode, i.customPct)),
    roiNetOfClosingOnDownPct: down > 0 ? ((appreciation - closing) / down) * 100 : 0,
  };
}

/* ------------------------------------------------------------------ closing cost worksheet */

export interface ClosingCostItem {
  id: string;
  label: string;
  amount: number;
}

/** Itemized defaults that total the $8,000 example. */
export const DEFAULT_CLOSING_WORKSHEET: ClosingCostItem[] = [
  { id: 'origination', label: 'Lender origination / underwriting', amount: 1995 },
  { id: 'appraisal', label: 'Appraisal', amount: 650 },
  { id: 'credit', label: 'Credit report', amount: 55 },
  { id: 'title', label: 'Title insurance & settlement', amount: 3250 },
  { id: 'recording', label: 'Recording & government fees', amount: 450 },
  { id: 'inspection', label: 'Inspection & survey', amount: 600 },
  { id: 'prepaid', label: 'Prepaid interest & escrow deposit', amount: 1000 },
];

export function sumWorksheet(items: ClosingCostItem[]): number {
  return items.reduce((s, it) => s + Math.max(0, fin(it.amount)), 0);
}

/* ------------------------------------------------------------------ validation */

export interface AppreciationFormInput {
  clientId: string | null;
  price: number;
  modes: AppreciationMode[];
  customPct: number;
  downPayment: number; // dollars
  closingCosts: number;
}

export type AppreciationErrors = Partial<Record<'client' | 'price' | 'modes' | 'customPct' | 'downPayment' | 'closingCosts', string>>;

export function validateAppreciation(f: AppreciationFormInput): AppreciationErrors {
  const e: AppreciationErrors = {};
  if (!f.clientId) e.client = 'Client name is required';
  if (!(f.price > 0)) e.price = 'Enter a price greater than $0';
  if (f.modes.length === 0) e.modes = 'Select at least one appreciation type';
  if (f.modes.length > MAX_APPRECIATION_MODES) e.modes = 'Select up to 2';
  if (f.modes.includes('custom') && !(Number.isFinite(f.customPct) && f.customPct > -20 && f.customPct <= 25)) e.customPct = 'Custom rate must be between -20% and 25%';
  if (!(f.downPayment >= 0)) e.downPayment = 'Down payment can’t be negative';
  else if (f.price > 0 && f.downPayment > f.price) e.downPayment = 'Down payment can’t exceed the price';
  if (!(f.closingCosts > 0)) e.closingCosts = 'Closing costs must be greater than $0';
  return e;
}
