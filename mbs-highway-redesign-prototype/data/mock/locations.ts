/**
 * DEMO DATA — location defaults (property tax, insurance, appreciation).
 * In production these come from county tax tables + the forecast provider.
 * Swap `searchLocations` / `getLocation` for a real geocoder + data API.
 */

export interface Location {
  id: string;
  label: string; // "Dallas, TX 75201"
  city: string;
  state: string;
  stateName: string;
  zip: string;
  county: string;
  /** County-average property tax, percent of value per year. */
  taxRatePct: number;
  /** Default monthly homeowners insurance. */
  insuranceMonthly: number;
  /** Forecast appreciation shown on forms (long-run average of the forecast curve). */
  forecastDisplayPct: number;
  /** Historical appreciation shown on property forms. */
  historicalPct: number;
  /** Bid Over Ask model inputs. */
  forecast1yrPct: number;
  forecast5yrAvgPct: number;
  historical63yrPct: number;
  /**
   * Year-by-year forecast index (year 0 = 1). Used by Appreciation, Equity Gained,
   * Loan Comparison and Bid Over Ask so they all agree on the same curve.
   */
  forecastIndex: number[];
}

/** Build a forecast index from a near-term rate path that decays to a long-run rate. */
function buildIndex(path: number[], longRunPct: number, years = 40): number[] {
  const idx = [1];
  for (let y = 1; y <= years; y++) {
    const r = path[y - 1] ?? longRunPct;
    idx.push(idx[y - 1] * (1 + r / 100));
  }
  return idx;
}

// Dallas forecast curve, as observed on the live site for a $500,000 property.
// Known points: Y1..Y10, Y12, Y15. Y11, Y13, Y14 are geometric interpolations.
const DALLAS_VALUES: Record<number, number> = {
  0: 500000,
  1: 522351,
  2: 541664,
  3: 561846,
  4: 582853,
  5: 589480,
  6: 596940,
  7: 604686,
  8: 611772,
  9: 622058,
  10: 634338,
  12: 665342,
  15: 722153,
};
function dallasIndex(): number[] {
  const v = { ...DALLAS_VALUES };
  v[11] = Math.sqrt(v[10] * v[12]);
  const step = Math.pow(v[15] / v[12], 1 / 3);
  v[13] = v[12] * step;
  v[14] = v[13] * step;
  const idx: number[] = [];
  for (let y = 0; y <= 15; y++) idx.push(v[y] / 500000);
  for (let y = 16; y <= 40; y++) idx.push(idx[y - 1] * 1.0296);
  return idx;
}

export const LOCATIONS: Location[] = [
  {
    id: 'dallas-tx-75201', label: 'Dallas, TX 75201', city: 'Dallas', state: 'TX', stateName: 'Texas', zip: '75201', county: 'Dallas County',
    taxRatePct: 1.8412, insuranceMonthly: 146, forecastDisplayPct: 2.481, historicalPct: 2.963,
    forecast1yrPct: 4.47, forecast5yrAvgPct: 3.35, historical63yrPct: 2.96, forecastIndex: dallasIndex(),
  },
  {
    id: 'marlboro-nj-07746', label: 'Marlboro, NJ 07746', city: 'Marlboro', state: 'NJ', stateName: 'New Jersey', zip: '07746', county: 'Monmouth County',
    taxRatePct: 2.21, insuranceMonthly: 168, forecastDisplayPct: 4.67, historicalPct: 4.2,
    forecast1yrPct: 5.1, forecast5yrAvgPct: 4.67, historical63yrPct: 4.2,
    forecastIndex: buildIndex([5.1, 4.8, 4.6, 4.5, 4.36], 3.9),
  },
  {
    id: 'holmdel-nj-07733', label: 'Holmdel, NJ 07733', city: 'Holmdel', state: 'NJ', stateName: 'New Jersey', zip: '07733', county: 'Monmouth County',
    taxRatePct: 2.06, insuranceMonthly: 172, forecastDisplayPct: 4.31, historicalPct: 4.05,
    forecast1yrPct: 4.9, forecast5yrAvgPct: 4.41, historical63yrPct: 4.05,
    forecastIndex: buildIndex([4.9, 4.5, 4.3, 4.2, 4.15], 3.8),
  },
  {
    id: 'austin-tx-78701', label: 'Austin, TX 78701', city: 'Austin', state: 'TX', stateName: 'Texas', zip: '78701', county: 'Travis County',
    taxRatePct: 1.79, insuranceMonthly: 152, forecastDisplayPct: 2.12, historicalPct: 4.41,
    forecast1yrPct: 1.2, forecast5yrAvgPct: 2.05, historical63yrPct: 4.41,
    forecastIndex: buildIndex([1.2, 1.8, 2.3, 2.4, 2.55], 2.6),
  },
  {
    id: 'phoenix-az-85004', label: 'Phoenix, AZ 85004', city: 'Phoenix', state: 'AZ', stateName: 'Arizona', zip: '85004', county: 'Maricopa County',
    taxRatePct: 0.62, insuranceMonthly: 118, forecastDisplayPct: 2.88, historicalPct: 4.12,
    forecast1yrPct: 2.4, forecast5yrAvgPct: 2.9, historical63yrPct: 4.12,
    forecastIndex: buildIndex([2.4, 2.8, 3.0, 3.1, 3.2], 3.0),
  },
  {
    id: 'miami-fl-33131', label: 'Miami, FL 33131', city: 'Miami', state: 'FL', stateName: 'Florida', zip: '33131', county: 'Miami-Dade County',
    taxRatePct: 1.97, insuranceMonthly: 395, forecastDisplayPct: 3.42, historicalPct: 5.02,
    forecast1yrPct: 2.9, forecast5yrAvgPct: 3.4, historical63yrPct: 5.02,
    forecastIndex: buildIndex([2.9, 3.3, 3.5, 3.6, 3.7], 3.5),
  },
  {
    id: 'denver-co-80202', label: 'Denver, CO 80202', city: 'Denver', state: 'CO', stateName: 'Colorado', zip: '80202', county: 'Denver County',
    taxRatePct: 0.55, insuranceMonthly: 205, forecastDisplayPct: 3.05, historicalPct: 5.31,
    forecast1yrPct: 2.6, forecast5yrAvgPct: 3.0, historical63yrPct: 5.31,
    forecastIndex: buildIndex([2.6, 2.9, 3.1, 3.2, 3.3], 3.1),
  },
  {
    id: 'charlotte-nc-28202', label: 'Charlotte, NC 28202', city: 'Charlotte', state: 'NC', stateName: 'North Carolina', zip: '28202', county: 'Mecklenburg County',
    taxRatePct: 0.98, insuranceMonthly: 131, forecastDisplayPct: 3.86, historicalPct: 4.47,
    forecast1yrPct: 4.1, forecast5yrAvgPct: 3.9, historical63yrPct: 4.47,
    forecastIndex: buildIndex([4.1, 3.9, 3.8, 3.8, 3.8], 3.7),
  },
  {
    id: 'columbus-oh-43215', label: 'Columbus, OH 43215', city: 'Columbus', state: 'OH', stateName: 'Ohio', zip: '43215', county: 'Franklin County',
    taxRatePct: 1.62, insuranceMonthly: 104, forecastDisplayPct: 4.12, historicalPct: 3.87,
    forecast1yrPct: 4.6, forecast5yrAvgPct: 4.2, historical63yrPct: 3.87,
    forecastIndex: buildIndex([4.6, 4.2, 4.1, 4.0, 4.0], 3.8),
  },
  {
    id: 'san-diego-ca-92101', label: 'San Diego, CA 92101', city: 'San Diego', state: 'CA', stateName: 'California', zip: '92101', county: 'San Diego County',
    taxRatePct: 1.16, insuranceMonthly: 141, forecastDisplayPct: 3.71, historicalPct: 6.08,
    forecast1yrPct: 3.2, forecast5yrAvgPct: 3.7, historical63yrPct: 6.08,
    forecastIndex: buildIndex([3.2, 3.6, 3.8, 3.9, 4.0], 3.8),
  },
  {
    id: 'nashville-tn-37203', label: 'Nashville, TN 37203', city: 'Nashville', state: 'TN', stateName: 'Tennessee', zip: '37203', county: 'Davidson County',
    taxRatePct: 0.71, insuranceMonthly: 128, forecastDisplayPct: 3.94, historicalPct: 4.85,
    forecast1yrPct: 3.8, forecast5yrAvgPct: 3.95, historical63yrPct: 4.85,
    forecastIndex: buildIndex([3.8, 3.9, 4.0, 4.0, 4.05], 3.8),
  },
  {
    id: 'atlanta-ga-30303', label: 'Atlanta, GA 30303', city: 'Atlanta', state: 'GA', stateName: 'Georgia', zip: '30303', county: 'Fulton County',
    taxRatePct: 1.03, insuranceMonthly: 139, forecastDisplayPct: 3.58, historicalPct: 4.39,
    forecast1yrPct: 3.1, forecast5yrAvgPct: 3.5, historical63yrPct: 4.39,
    forecastIndex: buildIndex([3.1, 3.4, 3.6, 3.7, 3.7], 3.6),
  },
];

export const DEFAULT_LOCATION_ID = 'dallas-tx-75201';
export const RERC_DEFAULT_LOCATION_ID = 'marlboro-nj-07746';

export function getLocation(id: string | undefined | null): Location {
  return LOCATIONS.find((l) => l.id === id) ?? LOCATIONS[0];
}

/** Mock geocoder. Matches city, state, zip or label text. */
export function searchLocations(query: string): Location[] {
  const q = query.trim().toLowerCase();
  if (!q) return LOCATIONS;
  return LOCATIONS.filter((l) =>
    [l.label, l.city, l.state, l.stateName, l.zip, l.county].some((s) => s.toLowerCase().includes(q)),
  );
}
