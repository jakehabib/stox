import { DEFAULT_LOCATION_ID } from '@/data/mock/locations';
import { defaultRepairsMonthly, type BuyVsRentInput, type FilingStatus } from '@/lib/calculations/buyVsRent';

export type BvrMode = 'price' | 'payment' | 'bah';

export interface BvrState extends BuyVsRentInput {
  step: 'input' | 'results';
  mode: BvrMode;
  clientId: string | null;
  useAppraised: boolean;
  appraisedValue: number;
  desiredPayment: number;
  bahMonthly: number;
  program: 'Conventional' | 'FHA' | 'VA' | 'Jumbo';
  aprPct: number;
  filingStatus: FilingStatus;
  taxableIncome: number;
  year: number;
}

/** Demo scenario = the spec FINAL EXAMPLE (Alex Rivera, $500k Dallas, rent $2,800). */
export const BVR_DEFAULTS: BvrState = {
  step: 'input',
  mode: 'price',
  clientId: 'c-alex-rivera',
  locationId: DEFAULT_LOCATION_ID,
  price: 500000,
  useAppraised: false,
  appraisedValue: 500000,
  desiredPayment: 3586,
  bahMonthly: 2511,
  loanAmount: 400000,
  ratePct: 6.5,
  aprPct: 6.605,
  termYears: 30,
  program: 'Conventional',
  miMonthly: 0,
  closingCosts: 10000,
  pointsPct: 0,
  taxAnnual: 8400,
  taxIncreasePct: 2,
  insuranceMonthly: 150,
  hoaMonthly: 0,
  repairsMonthly: defaultRepairsMonthly(500000),
  costToSellPct: 4,
  appreciation: { mode: 'custom', customPct: 4 },
  rentMonthly: 2800,
  rentersInsuranceMonthly: 55,
  rentIncreasePct: 3,
  filingStatus: 'mfj',
  taxableIncome: 150000,
  federalPct: 22,
  statePct: 0,
  standardDeduction: 32200,
  includeTaxBenefit: true,
  year: 9,
};
