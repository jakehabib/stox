/** Cost of Waiting scenario state (URL-shareable) + helpers to open it pre-filled from other tools. */
import { defaultWaits, type CowInput, type WaitColumn } from '@/lib/calculations/costOfWaiting';
import { alexProperty, type PropertyInput } from '@/lib/calculations/property';

export interface CowLoan {
  downPct: number;
  termYears: number;
  ratePct: number;
  aprPct: number;
  miMonthly: number;
  closingCosts: number;
}

export interface CowState {
  step: 0 | 1 | 2;
  clientId: string | null;
  property: PropertyInput;
  loan: CowLoan;
  waits: WaitColumn[];
  waitMonths: number;
  refiCostPct: number;
  partnerIdx: number | null;
}

export const COW_DEFAULTS: CowState = {
  step: 0,
  clientId: 'c-alex-rivera',
  property: { ...alexProperty(), appreciation: { mode: 'custom', customPct: 4 } },
  loan: { downPct: 20, termYears: 30, ratePct: 6.5, aprPct: 6.5, miMonthly: 0, closingCosts: 0 },
  waits: defaultWaits(),
  waitMonths: 12,
  refiCostPct: 1,
  partnerIdx: null,
};

export function toCowInput(s: Pick<CowState, 'property' | 'loan' | 'waits' | 'refiCostPct'>): CowInput {
  const p = s.property;
  return {
    locationId: p.locationId,
    price: p.price,
    taxAnnual: p.taxAnnual,
    insuranceMonthly: p.insuranceMonthly,
    hoaMonthly: p.hoaMonthly,
    appreciation: p.appreciation,
    ...s.loan,
    refiCostPct: s.refiCostPct,
    waits: s.waits,
  };
}

function encode(state: unknown) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(state))));
}

/** Link that opens the standalone Cost of Waiting with a property + loan pre-filled. */
export function costOfWaitingHref(partial: Partial<CowState>): string {
  return `/members/cost-of-waiting?s=${encodeURIComponent(encode({ ...COW_DEFAULTS, ...partial }))}`;
}
