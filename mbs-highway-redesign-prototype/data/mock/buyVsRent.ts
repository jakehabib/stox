/**
 * DEMO DATA — Buy vs Rent reference tables.
 * - BAH: synthetic Basic Allowance for Housing rates by military housing area and pay grade.
 *   In production, plug in the DoD BAH rate lookup (by duty ZIP + grade + dependency status).
 * - State income tax: simplified top-of-typical-bracket marginal rates used as a default only.
 */

export const BAH_GRADES = ['E-4', 'E-5', 'E-6', 'E-7', 'E-8', 'W-2', 'O-1', 'O-2', 'O-3', 'O-4', 'O-5'] as const;
export type BahGrade = (typeof BAH_GRADES)[number];

export interface BahArea {
  id: string;
  label: string; // Military housing area
  installation: string;
  /** Monthly allowance WITH dependents, by grade. Without dependents ≈ 82% (rounded to $3). */
  withDependents: Record<BahGrade, number>;
}

function area(id: string, label: string, installation: string, base: number): BahArea {
  // Grade multipliers relative to E-5 with dependents (shape of a typical BAH table).
  const mult: Record<BahGrade, number> = {
    'E-4': 0.93, 'E-5': 1, 'E-6': 1.09, 'E-7': 1.14, 'E-8': 1.2, 'W-2': 1.16,
    'O-1': 1.04, 'O-2': 1.12, 'O-3': 1.26, 'O-4': 1.39, 'O-5': 1.48,
  };
  const withDependents = Object.fromEntries(BAH_GRADES.map((g) => [g, Math.round((base * mult[g]) / 3) * 3])) as Record<BahGrade, number>;
  return { id, label, installation, withDependents };
}

export const BAH_AREAS: BahArea[] = [
  area('dallas-tx', 'Dallas, TX', 'NAS JRB Fort Worth', 2511),
  area('killeen-tx', 'Fort Cavazos / Killeen, TX', 'Fort Cavazos', 1812),
  area('san-antonio-tx', 'San Antonio, TX', 'JB San Antonio', 2283),
  area('san-diego-ca', 'San Diego, CA', 'Naval Base San Diego', 4269),
  area('norfolk-va', 'Norfolk / Portsmouth, VA', 'Naval Station Norfolk', 2427),
  area('fayetteville-nc', 'Fayetteville, NC', 'Fort Liberty', 1866),
  area('colorado-springs-co', 'Colorado Springs, CO', 'Fort Carson', 2499),
  area('mcguire-nj', 'Trenton / Fort Dix, NJ', 'JB McGuire-Dix-Lakehurst', 2742),
  area('monmouth-nj', 'Monmouth County, NJ', 'Naval Weapons Station Earle', 3348),
  area('jacksonville-fl', 'Jacksonville, FL', 'NAS Jacksonville', 2328),
];

export function bahAllowance(areaId: string, grade: BahGrade, dependents: boolean): number {
  const a = BAH_AREAS.find((x) => x.id === areaId) ?? BAH_AREAS[0];
  const w = a.withDependents[grade] ?? 0;
  return dependents ? w : Math.round((w * 0.82) / 3) * 3;
}

/** Default state income tax rate (percent) used to pre-fill the Tax edit. TX/FL/TN = 0. */
export const STATE_INCOME_TAX_PCT: Record<string, number> = {
  TX: 0, FL: 0, TN: 0, NV: 0, WA: 0, NJ: 6.37, NY: 6.85, CA: 9.3, AZ: 2.5, CO: 4.4, NC: 4.25, OH: 2.75, GA: 5.39,
};
export const stateIncomeTaxPct = (state: string) => STATE_INCOME_TAX_PCT[state] ?? 4.5;
