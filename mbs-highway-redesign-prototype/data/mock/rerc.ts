/**
 * DEMO DATA — Real Estate Report Card (community report) by location.
 * Marlboro Township, NJ 07746 reproduces the values observed on the live site exactly.
 * Other demo locations are generated deterministically (seeded by location id) so they stay
 * stable between reloads. Swap `getRercData` for the real market-data provider.
 */
import { getLocation, LOCATIONS, type Location } from '@/data/mock/locations';
import { hashString, mulberry32 } from '@/lib/random';

export interface ListingStats {
  total: number;
  momPct: number;
  yoyPct: number;
  newLast5Days: number;
}

export interface RercData {
  locationId: string;
  areaName: string;
  zip: string;
  county: string; // "Monmouth"
  asOf: string; // ISO date of the market snapshot
  medianPrice: number;
  medianDaysOnMarket: number;
  /** Forecast home values for years 0..5 at the median price (year 0 = median). */
  forecastValues: number[];
  /** Historical average annual appreciation, percent. */
  historical: { y5: number; y10: number; y63: number };
  homesBuiltPerYear: number;
  listings: { zip: ListingStats; county: ListingStats };
  /** Active listings, last 13 months (oldest first; last = current). */
  listingsSeries: { month: string; zip: number; county: number }[];
  /** County population by age, thousands. */
  ageBuckets: { label: string; value: number }[];
  /** Thousands of people (county). */
  renters: number;
  rentersCanAfford: number;
  homeowners: number;
  medianIncome: number;
  nationalMedianIncome: number;
  affordabilityIndex: number;
}

const MONTHS = ["Oct '25", "Nov '25", "Dec '25", "Jan '26", "Feb '26", "Mar '26", "Apr '26", "May '26", "Jun '26", "Jul '26", "Aug '26", "Sep '26", "Oct '26"];
export const NATIONAL_MEDIAN_INCOME = 80630;
const AS_OF = '2026-10-14';

export const MARLBORO_RERC: RercData = {
  locationId: 'marlboro-nj-07746',
  areaName: 'Marlboro Township, NJ 07746',
  zip: '07746',
  county: 'Monmouth',
  asOf: AS_OF,
  medianPrice: 940915,
  medianDaysOnMarket: 82,
  // +$219,774 (23.36%) over 5 years → 4.67% avg/yr (simple average of the cumulative).
  forecastValues: [940915, 991724, 1037343, 1079874, 1121989, 1160689],
  historical: { y5: 6.02, y10: 4.52, y63: 4.2 },
  homesBuiltPerYear: 1973,
  listings: {
    zip: { total: 71, momPct: 54, yoyPct: 122, newLast5Days: 3 },
    county: { total: 2765, momPct: 69, yoyPct: 94, newLast5Days: 150 },
  },
  listingsSeries: MONTHS.map((month, i) => ({
    month,
    zip: [32, 30, 27, 24, 26, 33, 41, 48, 52, 50, 47, 46, 71][i],
    county: [1425, 1352, 1190, 1046, 1088, 1290, 1534, 1745, 1832, 1790, 1702, 1636, 2765][i],
  })),
  ageBuckets: [
    { label: 'Under 18', value: 137.2 },
    { label: '18–24', value: 52.1 },
    { label: '25–34', value: 69.8 },
    { label: '35–44', value: 74.6 },
    { label: '45–54', value: 85.3 },
    { label: '55–64', value: 99.4 },
    { label: '65+', value: 132.1 },
  ],
  renters: 141.3,
  rentersCanAfford: 35.6,
  homeowners: 509.2,
  medianIncome: 128386,
  nationalMedianIncome: NATIONAL_MEDIAN_INCOME,
  affordabilityIndex: 90,
};

/** Typical median sale price per demo market (generated locations). */
const MEDIANS: Record<string, number> = {
  'dallas-tx-75201': 412500,
  'holmdel-nj-07733': 1124900,
  'austin-tx-78701': 548000,
  'phoenix-az-85004': 431750,
  'miami-fl-33131': 662000,
  'denver-co-80202': 598500,
  'charlotte-nc-28202': 428900,
  'columbus-oh-43215': 289900,
  'san-diego-ca-92101': 948000,
  'nashville-tn-37203': 476500,
  'atlanta-ga-30303': 402000,
};
/** County population (thousands) for the generated demographics. */
const COUNTY_POP: Record<string, number> = {
  'dallas-tx-75201': 2613.5,
  'holmdel-nj-07733': 650.5,
  'austin-tx-78701': 1326.4,
  'phoenix-az-85004': 4585.9,
  'miami-fl-33131': 2686.9,
  'denver-co-80202': 716.6,
  'charlotte-nc-28202': 1163.7,
  'columbus-oh-43215': 1336.3,
  'san-diego-ca-92101': 3269.8,
  'nashville-tn-37203': 708.1,
  'atlanta-ga-30303': 1079.1,
};
const AGE_SHAPE = [0.214, 0.087, 0.142, 0.138, 0.126, 0.129, 0.164];

function generate(loc: Location): RercData {
  const rand = mulberry32(hashString(loc.id));
  const between = (a: number, b: number) => a + rand() * (b - a);
  const median = MEDIANS[loc.id] ?? Math.round(between(300000, 700000) / 100) * 100;
  const forecastValues = loc.forecastIndex.slice(0, 6).map((f) => Math.round(median * f));
  const pop = COUNTY_POP[loc.id] ?? Math.round(between(400, 1500) * 10) / 10;
  const ageRaw = AGE_SHAPE.map((w) => w * (1 + between(-0.08, 0.08)));
  const ageSum = ageRaw.reduce((a, b) => a + b, 0);
  const ages = ageRaw.map((w) => Math.round(((w / ageSum) * pop) * 10) / 10);
  ages[ages.length - 1] = Math.round((pop - ages.slice(0, -1).reduce((a, b) => a + b, 0)) * 10) / 10;
  const ownerShare = between(0.56, 0.7);
  const homeowners = Math.round(pop * ownerShare * 10) / 10;
  const renters = Math.round((pop - homeowners) * 10) / 10;
  const rentersCanAfford = Math.round(renters * between(0.15, 0.3) * 10) / 10;
  const income = Math.round(between(62000, 118000));
  const zipNow = Math.round(between(40, 160));
  const countyNow = Math.round(between(1800, 9000));
  const zipYoy = Math.round(between(-10, 60));
  const countyYoy = Math.round(between(-5, 45));
  const shape = [1, 0.95, 0.84, 0.74, 0.77, 0.9, 1.05, 1.18, 1.24, 1.21, 1.15, 1.1];
  const zipBase = zipNow / (1 + zipYoy / 100);
  const cBase = countyNow / (1 + countyYoy / 100);
  const series = MONTHS.map((month, i) => ({
    month,
    zip: i === 12 ? zipNow : Math.max(1, Math.round(zipBase * shape[i] * (1 + between(-0.04, 0.04)))),
    county: i === 12 ? countyNow : Math.round(cBase * shape[i] * (1 + between(-0.03, 0.03))),
  }));
  series[0].zip = Math.round(zipBase);
  series[0].county = Math.round(cBase);
  const chg = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : 0);
  // Generated affordability: income vs. income needed for the median home (20% down, 28% front-end).
  const needed = ((median * 0.8 * 0.0063207 + (median * loc.taxRatePct) / 100 / 12 + loc.insuranceMonthly) * 12) / 0.28;
  const countyName = loc.county.replace(/ County$/, '');
  return {
    locationId: loc.id,
    areaName: loc.label,
    zip: loc.zip,
    county: countyName,
    asOf: AS_OF,
    medianPrice: median,
    medianDaysOnMarket: Math.round(between(28, 75)),
    forecastValues,
    historical: { y5: Math.round(between(4.2, 7.4) * 100) / 100, y10: Math.round(between(3.6, 6.2) * 100) / 100, y63: loc.historical63yrPct },
    homesBuiltPerYear: Math.round(pop * between(1.8, 6.5)),
    listings: {
      zip: { total: zipNow, momPct: chg(zipNow, series[11].zip), yoyPct: chg(zipNow, series[0].zip), newLast5Days: Math.max(1, Math.round(zipNow * between(0.04, 0.09))) },
      county: { total: countyNow, momPct: chg(countyNow, series[11].county), yoyPct: chg(countyNow, series[0].county), newLast5Days: Math.round(countyNow * between(0.04, 0.07)) },
    },
    listingsSeries: series,
    ageBuckets: AGE_SHAPE.map((_, i) => ({ label: MARLBORO_RERC.ageBuckets[i].label, value: ages[i] })),
    renters,
    rentersCanAfford,
    homeowners,
    medianIncome: income,
    nationalMedianIncome: NATIONAL_MEDIAN_INCOME,
    affordabilityIndex: Math.round((100 * income) / needed),
  };
}

const CACHE = new Map<string, RercData>();

/** Market snapshot for a location (mock adapter). */
export function getRercData(locationId: string): RercData {
  const loc = getLocation(locationId);
  if (loc.id === MARLBORO_RERC.locationId) return MARLBORO_RERC;
  let d = CACHE.get(loc.id);
  if (!d) {
    d = generate(loc);
    CACHE.set(loc.id, d);
  }
  return d;
}

export const RERC_LOCATION_IDS = LOCATIONS.map((l) => l.id);

/** Mock geocoder result for the Step 1 location search. */
export function geocode(locationId: string) {
  const loc = getLocation(locationId);
  const rand = mulberry32(hashString(`geo-${loc.id}`));
  const known: Record<string, [number, number]> = {
    'marlboro-nj-07746': [40.3154, -74.2463],
    'dallas-tx-75201': [32.7876, -96.7994],
  };
  const [lat, lng] = known[loc.id] ?? [30 + rand() * 15, -120 + rand() * 45];
  return { label: loc.id === MARLBORO_RERC.locationId ? MARLBORO_RERC.areaName : loc.label, county: loc.county, lat, lng };
}
