/**
 * DEMO DATA — borrower-paid monthly mortgage insurance (conventional) by FICO band × LTV.
 * Annual premium as a percent of the loan amount. In production this comes from the MI
 * provider's rate card (MI Worksheet); swap `conventionalMiRatePct` for that lookup.
 *
 * The 720–739 column reproduces the live Affordability tool: LTV > 95% → 0.87%,
 * > 90% → 0.66%, > 85% → 0.44%, > 80% → 0.28%.
 */
import type { FicoBand } from './clients';

/** Upper LTV bound of each bucket (inclusive), lowest first. LTV ≤ 80% has no MI. */
export const MI_LTV_BUCKETS = [85, 90, 95, 97] as const;
export const MI_LTV_LABELS = ['80.01–85%', '85.01–90%', '90.01–95%', '95.01–97%'] as const;

/** Annual MI rate (%) per FICO band for each LTV bucket in MI_LTV_BUCKETS order. */
export const MI_TABLE: Record<FicoBand, [number, number, number, number]> = {
  '760+': [0.17, 0.26, 0.38, 0.55],
  '740–759': [0.21, 0.33, 0.49, 0.7],
  '720–739': [0.28, 0.44, 0.66, 0.87],
  '700–719': [0.37, 0.56, 0.81, 1.05],
  '680–699': [0.47, 0.71, 1.0, 1.28],
  '660–679': [0.62, 0.92, 1.22, 1.52],
  '640–659': [0.78, 1.13, 1.45, 1.78],
  '620–639': [0.95, 1.36, 1.7, 2.05],
};

/** Conventional MI annual rate (%) for an LTV (percent) and FICO band. 0 at or below 80% LTV. */
export function conventionalMiRatePct(ltvPct: number, fico: FicoBand = '720–739'): number {
  if (!(ltvPct > 80)) return 0;
  const row = MI_TABLE[fico] ?? MI_TABLE['720–739'];
  if (ltvPct > 95) return row[3];
  if (ltvPct > 90) return row[2];
  if (ltvPct > 85) return row[1];
  return row[0];
}

/**
 * FHA: 1.75% upfront MIP (financed) + annual MIP. Demo simplification of the HUD table
 * for loans ≤ $726,200: > 95% LTV → 0.55%, otherwise 0.50%.
 */
export const FHA_UFMIP_PCT = 1.75;
export function fhaAnnualMipPct(ltvPct: number): number {
  return ltvPct > 95 ? 0.55 : 0.5;
}

/** VA funding fee (first use, financed). No monthly MI. */
export function vaFundingFeePct(downPct: number): number {
  if (downPct >= 10) return 1.25;
  if (downPct >= 5) return 1.5;
  return 2.15;
}
