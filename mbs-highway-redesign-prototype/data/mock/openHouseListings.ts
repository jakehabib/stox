/** DEMO DATA — synthetic listings for the Open House Flyer "Location (#MLS or Address)" lookup. */

export interface DemoListing {
  mls: string;
  address: string;
  cityLine: string;
  locationId: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  taxAnnual: number;
  insuranceMonthly: number;
  hoaMonthly: number;
  description: string;
}

export const DEMO_LISTINGS: DemoListing[] = [
  { mls: '20481234', address: '4127 Maple Ridge Dr', cityLine: 'Dallas, TX 75201', locationId: 'dallas-tx-75201', price: 500000, beds: 4, baths: 3, sqft: 2450, taxAnnual: 8400, insuranceMonthly: 150, hoaMonthly: 0, description: 'Light-filled two-story with an open kitchen, quartz counters, a flex room for working from home and a shaded backyard made for weekend cookouts.' },
  { mls: '20487710', address: '88 Bayberry Ln', cityLine: 'Marlboro, NJ 07746', locationId: 'marlboro-nj-07746', price: 685000, beds: 4, baths: 2.5, sqft: 2780, taxAnnual: 14200, insuranceMonthly: 140, hoaMonthly: 0, description: 'Updated colonial on a quiet cul-de-sac with a finished basement, new roof and a deck overlooking a fenced yard. Award-winning schools.' },
  { mls: '20490055', address: '1502 Ross Ave #1408', cityLine: 'Dallas, TX 75201', locationId: 'dallas-tx-75201', price: 365000, beds: 2, baths: 2, sqft: 1180, taxAnnual: 7300, insuranceMonthly: 75, hoaMonthly: 420, description: 'High-floor downtown condo with skyline views, floor-to-ceiling windows, resort-style pool and concierge.' },
  { mls: '20493321', address: '26 Crawfords Corner Rd', cityLine: 'Holmdel, NJ 07733', locationId: 'holmdel-nj-07733', price: 925000, beds: 5, baths: 3.5, sqft: 3650, taxAnnual: 17800, insuranceMonthly: 185, hoaMonthly: 0, description: 'Elegant center-hall colonial on an acre with a chef’s kitchen, first-floor guest suite and a three-car garage.' },
  { mls: '20495588', address: '710 Larkspur Way', cityLine: 'Austin, TX 78701', locationId: 'austin-tx-78701', price: 449000, beds: 3, baths: 2, sqft: 1720, taxAnnual: 8040, insuranceMonthly: 152, hoaMonthly: 45, description: 'Single-story charmer with a renovated kitchen, vaulted living room and a covered patio — minutes from downtown.' },
];

export function findListing(query: string): DemoListing | undefined {
  const q = (query ?? '').trim().toLowerCase().replace(/^#/, '').replace(/^mls\s*#?\s*/, '');
  if (!q) return undefined;
  return DEMO_LISTINGS.find((l) => l.mls === q) ?? DEMO_LISTINGS.find((l) => `${l.address} ${l.cityLine}`.toLowerCase().includes(q));
}
