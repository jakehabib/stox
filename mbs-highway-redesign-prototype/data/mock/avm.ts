/**
 * DEMO DATA — inputs for the mock automated valuation model (MBEstimate).
 * Market medians per demo location plus street names used to generate comparable sales.
 * Replace `lib/calculations/mbestimate.ts#estimateValue` with a real AVM provider call.
 */

export interface AvmMarket {
  locationId: string | null;
  label: string;
  medianPrice: number;
  medianSqft: number;
  /** Recent annual price growth used for the value-trend chart, percent. */
  annualGrowthPct: number;
}

export const AVM_MARKETS: AvmMarket[] = [
  { locationId: 'marlboro-nj-07746', label: 'Marlboro, NJ 07746', medianPrice: 940915, medianSqft: 2850, annualGrowthPct: 4.59 },
  { locationId: 'holmdel-nj-07733', label: 'Holmdel, NJ 07733', medianPrice: 1124900, medianSqft: 3100, annualGrowthPct: 4.4 },
  { locationId: 'dallas-tx-75201', label: 'Dallas, TX 75201', medianPrice: 412500, medianSqft: 1900, annualGrowthPct: 0.3 },
  { locationId: 'austin-tx-78701', label: 'Austin, TX 78701', medianPrice: 548000, medianSqft: 1850, annualGrowthPct: -0.6 },
  { locationId: 'phoenix-az-85004', label: 'Phoenix, AZ 85004', medianPrice: 431750, medianSqft: 1750, annualGrowthPct: 0.4 },
  { locationId: 'miami-fl-33131', label: 'Miami, FL 33131', medianPrice: 662000, medianSqft: 1450, annualGrowthPct: -1.8 },
  { locationId: 'denver-co-80202', label: 'Denver, CO 80202', medianPrice: 598500, medianSqft: 1800, annualGrowthPct: 0.2 },
  { locationId: 'charlotte-nc-28202', label: 'Charlotte, NC 28202', medianPrice: 428900, medianSqft: 2000, annualGrowthPct: 2.0 },
  { locationId: 'columbus-oh-43215', label: 'Columbus, OH 43215', medianPrice: 289900, medianSqft: 1700, annualGrowthPct: 4.7 },
  { locationId: 'san-diego-ca-92101', label: 'San Diego, CA 92101', medianPrice: 948000, medianSqft: 1600, annualGrowthPct: 0.9 },
  { locationId: 'nashville-tn-37203', label: 'Nashville, TN 37203', medianPrice: 476500, medianSqft: 1900, annualGrowthPct: 1.6 },
  { locationId: 'atlanta-ga-30303', label: 'Atlanta, GA 30303', medianPrice: 402000, medianSqft: 1950, annualGrowthPct: 1.7 },
];

/** Used when the address is outside the demo markets. */
export const AVM_FALLBACK_MARKET: AvmMarket = { locationId: null, label: 'U.S. (national model)', medianPrice: 425000, medianSqft: 1900, annualGrowthPct: 2.14 };

export const COMP_STREETS = [
  'Pine Brook Rd', 'Oak Hollow Dr', 'Maple Ave', 'Willow Ct', 'Cedar Ln', 'Birchwood Way', 'Highland Ter', 'Meadow Ridge Rd', 'Stonegate Dr', 'Orchard Pl',
  'Fox Run', 'Laurel Cir', 'Harbor View Dr', 'Sycamore St', 'Brookside Ave', 'Ridgecrest Rd', 'Juniper Ln', 'Chestnut Hill Rd',
];

/** Demo addresses offered as one-click examples (synthetic — not real listings). */
export const AVM_EXAMPLES = ['18 Pine Brook Rd, Marlboro, NJ 07746', '1418 Elm Hollow Dr, Dallas, TX 75201'];
export const AVM_TOWN_ONLY_EXAMPLE = 'Marlboro, NJ 07746';
