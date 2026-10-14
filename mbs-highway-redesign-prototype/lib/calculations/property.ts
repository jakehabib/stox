import { getLocation } from '@/data/mock/locations';
import type { AppreciationSetting } from './appreciation';

/** Shared property shape used by the property editor and the property-based calculators. */
export interface PropertyInput {
  locationId: string;
  price: number;
  useAppraised: boolean;
  appraisedValue: number;
  /** Annual property tax in dollars (source of truth). */
  taxAnnual: number;
  insuranceMonthly: number;
  hoaMonthly: number;
  appreciation: AppreciationSetting;
  alternatePrices: number[];
  extraLocationIds: string[];
}

export function countyTaxAnnual(locationId: string, price: number): number {
  return Math.round((price * getLocation(locationId).taxRatePct) / 100);
}

export function defaultProperty(locationId: string, price = 500000): PropertyInput {
  const loc = getLocation(locationId);
  return {
    locationId: loc.id,
    price,
    useAppraised: false,
    appraisedValue: price,
    taxAnnual: countyTaxAnnual(loc.id, price),
    insuranceMonthly: loc.insuranceMonthly,
    hoaMonthly: 0,
    appreciation: { mode: 'forecast' },
    alternatePrices: [],
    extraLocationIds: [],
  };
}

/** The shared Alex Rivera scenario as entered in Loan Comparison / Purchase Analysis (tax edited to $8,400). */
export function alexProperty(): PropertyInput {
  return { ...defaultProperty('dallas-tx-75201', 500000), taxAnnual: 8400 };
}

export const taxRatePct = (p: PropertyInput) => (p.price > 0 ? (p.taxAnnual / p.price) * 100 : 0);
export const valueBasis = (p: PropertyInput) => (p.useAppraised ? p.appraisedValue : p.price);
