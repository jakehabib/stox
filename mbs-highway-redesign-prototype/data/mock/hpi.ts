/**
 * DEMO DATA — FHFA House Price Index (purchase-only, seasonally adjusted) snapshot.
 * Values are percent change: q = latest quarter, y1 = 1 year, y5 = 5 years (cumulative),
 * s91 = since 1991 Q1 (cumulative). National and New Jersey quarter / 1-year values match the
 * live session (0.35% / 2.14%, NJ 1.03% / 4.59%); the rest are synthetic but plausible.
 * Swap for the FHFA HPI download (https://www.fhfa.gov/data/hpi) via this adapter.
 */

export type HpiPeriod = 'quarter' | 'year1' | 'year5' | 'since1991';

export interface HpiStats {
  q: number;
  y1: number;
  y5: number;
  s91: number;
}

export type DivisionId = 'NE' | 'MA' | 'ENC' | 'WNC' | 'SA' | 'ESC' | 'WSC' | 'MTN' | 'PAC';

export interface HpiState extends HpiStats {
  code: string;
  name: string;
  division: DivisionId;
}

export interface HpiDivision extends HpiStats {
  id: DivisionId;
  name: string;
}

export const HPI_SOURCE = 'FHFA House Price Index (purchase-only, SA)';
export const HPI_AS_OF = '2026 Q2';

export const HPI_NATIONAL: HpiStats = { q: 0.35, y1: 2.14, y5: 33.4, s91: 312.0 };

/** Label shown next to New Jersey on the live site in BOTH the quarterly and 1-year views — preserved as observed. */
export const NJ_OBSERVED_LABEL = '20% above national avg';

export const HPI_DIVISIONS: HpiDivision[] = [
  { id: 'NE', name: 'New England', q: 0.92, y1: 4.6, y5: 43.8, s91: 291 },
  { id: 'MA', name: 'Middle Atlantic', q: 0.94, y1: 4.62, y5: 42.1, s91: 274 },
  { id: 'ENC', name: 'East North Central', q: 0.92, y1: 4.7, y5: 44.2, s91: 214 },
  { id: 'WNC', name: 'West North Central', q: 0.56, y1: 3.0, y5: 35.2, s91: 251 },
  { id: 'SA', name: 'South Atlantic', q: 0.12, y1: 0.9, y5: 37.4, s91: 302 },
  { id: 'ESC', name: 'East South Central', q: 0.48, y1: 2.6, y5: 41.3, s91: 276 },
  { id: 'WSC', name: 'West South Central', q: 0.06, y1: 0.8, y5: 29.6, s91: 296 },
  { id: 'MTN', name: 'Mountain', q: 0.03, y1: 0.6, y5: 29.9, s91: 421 },
  { id: 'PAC', name: 'Pacific', q: 0.05, y1: 0.8, y5: 22.9, s91: 338 },
];

type Row = [string, string, DivisionId, number, number, number, number];
const ROWS: Row[] = [
  ['AL', 'Alabama', 'ESC', 0.62, 3.1, 38.5, 265],
  ['AK', 'Alaska', 'PAC', 0.41, 2.4, 27.8, 221],
  ['AZ', 'Arizona', 'MTN', -0.18, 0.4, 33.6, 352],
  ['AR', 'Arkansas', 'WSC', 0.55, 3.0, 37.9, 228],
  ['CA', 'California', 'PAC', 0.05, 0.9, 22.4, 312],
  ['CO', 'Colorado', 'MTN', -0.12, 0.2, 24.1, 498],
  ['CT', 'Connecticut', 'NE', 1.12, 5.6, 48.9, 162],
  ['DE', 'Delaware', 'SA', 0.71, 3.6, 40.2, 238],
  ['DC', 'District of Columbia', 'SA', -0.21, -0.6, 8.9, 402],
  ['FL', 'Florida', 'SA', -0.42, -1.8, 36.2, 341],
  ['GA', 'Georgia', 'SA', 0.31, 1.7, 39.8, 282],
  ['HI', 'Hawaii', 'PAC', 0.18, 1.2, 26.5, 268],
  ['ID', 'Idaho', 'MTN', 0.08, 0.7, 25.9, 455],
  ['IL', 'Illinois', 'ENC', 0.98, 5.1, 40.7, 178],
  ['IN', 'Indiana', 'ENC', 0.84, 4.4, 47.1, 236],
  ['IA', 'Iowa', 'WNC', 0.66, 3.5, 34.8, 231],
  ['KS', 'Kansas', 'WNC', 0.59, 3.3, 37.2, 226],
  ['KY', 'Kentucky', 'ESC', 0.73, 3.9, 41.6, 241],
  ['LA', 'Louisiana', 'WSC', 0.11, 0.6, 22.3, 214],
  ['ME', 'Maine', 'NE', 0.88, 4.2, 52.6, 279],
  ['MD', 'Maryland', 'SA', 0.52, 2.8, 31.4, 214],
  ['MA', 'Massachusetts', 'NE', 0.79, 4.0, 38.9, 344],
  ['MI', 'Michigan', 'ENC', 0.91, 4.6, 45.3, 238],
  ['MN', 'Minnesota', 'WNC', 0.47, 2.5, 28.7, 252],
  ['MS', 'Mississippi', 'ESC', 0.49, 2.7, 34.1, 212],
  ['MO', 'Missouri', 'WNC', 0.68, 3.6, 40.4, 247],
  ['MT', 'Montana', 'MTN', 0.21, 1.3, 36.8, 486],
  ['NE', 'Nebraska', 'WNC', 0.63, 3.4, 38.6, 262],
  ['NV', 'Nevada', 'MTN', 0.15, 1.0, 34.9, 296],
  ['NH', 'New Hampshire', 'NE', 0.86, 4.3, 49.5, 271],
  ['NJ', 'New Jersey', 'MA', 1.03, 4.59, 46.8, 318],
  ['NM', 'New Mexico', 'MTN', 0.33, 1.9, 39.1, 276],
  ['NY', 'New York', 'MA', 0.95, 4.8, 39.6, 286],
  ['NC', 'North Carolina', 'SA', 0.36, 2.0, 43.7, 287],
  ['ND', 'North Dakota', 'WNC', 0.39, 2.2, 21.6, 274],
  ['OH', 'Ohio', 'ENC', 0.92, 4.7, 46.2, 207],
  ['OK', 'Oklahoma', 'WSC', 0.51, 2.9, 38.3, 236],
  ['OR', 'Oregon', 'PAC', 0.02, 0.5, 21.8, 438],
  ['PA', 'Pennsylvania', 'MA', 0.81, 4.1, 42.5, 248],
  ['RI', 'Rhode Island', 'NE', 1.08, 5.4, 49.8, 268],
  ['SC', 'South Carolina', 'SA', 0.29, 1.8, 46.4, 311],
  ['SD', 'South Dakota', 'WNC', 0.44, 2.6, 41.2, 318],
  ['TN', 'Tennessee', 'ESC', 0.27, 1.6, 44.9, 368],
  ['TX', 'Texas', 'WSC', -0.08, 0.3, 27.4, 324],
  ['UT', 'Utah', 'MTN', 0.12, 0.9, 30.1, 512],
  ['VT', 'Vermont', 'NE', 0.83, 4.0, 47.7, 281],
  ['VA', 'Virginia', 'SA', 0.58, 3.2, 35.6, 252],
  ['WA', 'Washington', 'PAC', 0.09, 0.8, 23.7, 451],
  ['WV', 'West Virginia', 'SA', 0.76, 3.8, 45.9, 189],
  ['WI', 'Wisconsin', 'ENC', 0.89, 4.5, 44.8, 274],
  ['WY', 'Wyoming', 'MTN', 0.26, 1.5, 33.9, 362],
];

export const HPI_STATES: HpiState[] = ROWS.map(([code, name, division, q, y1, y5, s91]) => ({ code, name, division, q, y1, y5, s91 }));

export const getHpiState = (code: string) => HPI_STATES.find((s) => s.code === code) ?? HPI_STATES.find((s) => s.code === 'NJ')!;
export const getHpiDivision = (id: string) => HPI_DIVISIONS.find((d) => d.id === id) ?? HPI_DIVISIONS[1];
