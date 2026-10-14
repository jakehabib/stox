/**
 * MBEstimate — address validation + deterministic mock AVM.
 * A valuation needs a street address (house number + street). Town / ZIP-level input such as
 * "Marlboro, NJ 07746" returns the "unable to provide a valuation" state, as on the live site.
 * The AVM is a stand-in: values are hashed from the normalized address so they are stable.
 */
import { AVM_FALLBACK_MARKET, AVM_MARKETS, COMP_STREETS, type AvmMarket } from '@/data/mock/avm';
import { hashString, mulberry32 } from '@/lib/random';

export const UNABLE_MESSAGE = "We're unable to provide a valuation for this location. Enter a full street address.";

const STREET_SUFFIX = /\b(st|street|rd|road|ave|avenue|av|ln|lane|dr|drive|ct|court|blvd|boulevard|way|pl|place|ter|terrace|cir|circle|pkwy|parkway|hwy|highway|trl|trail|sq|square|loop|run|pike|row|path|walk|xing|crossing|aly|alley|cv|cove|pt|point)\b\.?/i;
const STATE = /^(A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])$/i;

export interface ParsedAddress {
  number: string;
  street: string;
  rest: string; // city/state/zip text after the street, if any
  zip?: string;
  normalized: string;
}

export type AddressCheck = { ok: true; address: ParsedAddress } | { ok: false; reason: 'empty' | 'not-street' };

export function validateAddress(input: string): AddressCheck {
  const raw = (input ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return { ok: false, reason: 'empty' };
  const [first, ...restParts] = raw.split(',').map((x) => x.trim());
  const m = first.match(/^(\d{1,6}(?:-\d{1,4})?[A-Za-z]?)\s+(.+)$/);
  if (!m) return { ok: false, reason: 'not-street' };
  const [, number, street] = m;
  if (!/[A-Za-z]{2,}/.test(street)) return { ok: false, reason: 'not-street' };
  const words = street.split(' ');
  // "07746 Marlboro" / "07746 NJ" — a ZIP followed by a place name, not a house number.
  if (/^\d{5}$/.test(number) && !STREET_SUFFIX.test(street)) return { ok: false, reason: 'not-street' };
  if (words.length === 1 && STATE.test(words[0])) return { ok: false, reason: 'not-street' };
  const rest = restParts.join(', ');
  const zip = raw.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1];
  const normalized = `${number} ${street}${rest ? `, ${rest}` : ''}`.toLowerCase().replace(/[.#]/g, '').replace(/\s+/g, ' ');
  return { ok: true, address: { number, street, rest, zip, normalized } };
}

/** Match the address to a demo market by ZIP, then city name. */
export function marketFor(a: ParsedAddress): AvmMarket {
  const text = `${a.rest} ${a.zip ?? ''}`.toLowerCase();
  const byZip = a.zip ? AVM_MARKETS.find((m) => m.label.endsWith(a.zip!)) : undefined;
  if (byZip) return byZip;
  const byCity = AVM_MARKETS.find((m) => text.includes(m.label.split(',')[0].toLowerCase()));
  return byCity ?? AVM_FALLBACK_MARKET;
}

export interface Comparable {
  address: string;
  soldDate: string; // ISO
  price: number;
  sqft: number;
  beds: number;
  baths: number;
  distanceMi: number;
  pricePerSqft: number;
}

export interface Valuation {
  address: ParsedAddress;
  market: AvmMarket;
  estimate: number;
  low: number;
  high: number;
  confidence: number; // 0–100
  confidenceLabel: 'High' | 'Medium' | 'Low';
  beds: number;
  baths: number;
  sqft: number;
  yearBuilt: number;
  lotAcres: number;
  pricePerSqft: number;
  comps: Comparable[];
  /** Monthly value history, 24 months back to today (last = estimate). */
  trend: { month: string; value: number }[];
  asOf: string;
}

const round = (v: number, step: number) => Math.round(v / step) * step;

/** Deterministic mock AVM. `asOf` fixes "today" so output is stable in tests. */
export function estimateValue(a: ParsedAddress, asOf = '2026-10-14'): Valuation {
  const rand = mulberry32(hashString(a.normalized));
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const market = marketFor(a);
  const beds = Math.round(between(2, 5.4));
  const baths = Math.round(between(Math.max(1, beds - 1.5), beds) * 2) / 2;
  const sqft = round(market.medianSqft * between(0.68, 1.42), 10);
  const yearBuilt = Math.round(between(1952, 2021));
  const lotAcres = Math.round(between(0.12, 1.1) * 100) / 100;
  const marketPpsf = market.medianPrice / market.medianSqft;
  const ppsf = marketPpsf * between(0.9, 1.1) * (yearBuilt > 2000 ? 1.04 : 1);
  const estimate = round(ppsf * sqft, 1000);
  const confidence = Math.round(between(74, 96));
  const spread = ((100 - confidence) / 100) * 0.55 + 0.025; // ±3.9% at 96 … ±16.8% at 70
  const low = round(estimate * (1 - spread), 1000);
  const high = round(estimate * (1 + spread), 1000);

  const today = new Date(`${asOf}T12:00:00Z`);
  const comps: Comparable[] = Array.from({ length: 5 }, (_, i) => {
    const cs = round(sqft * between(0.82, 1.18), 10);
    const cp = ppsf * between(0.93, 1.07);
    const days = Math.round(between(12, 175));
    const d = new Date(today.getTime() - days * 86400000);
    const street = COMP_STREETS[Math.floor(rand() * COMP_STREETS.length)];
    return {
      address: `${Math.round(between(3, 240))} ${i === 0 ? a.street : street}`,
      soldDate: d.toISOString().slice(0, 10),
      price: round(cp * cs, 500),
      sqft: cs,
      beds: Math.max(1, beds + Math.round(between(-1, 1))),
      baths: Math.max(1, baths + Math.round(between(-1, 1)) * 0.5),
      distanceMi: Math.round(between(0.05, 1.2) * 100) / 100,
      pricePerSqft: 0,
    };
  })
    .map((c) => ({ ...c, pricePerSqft: Math.round(c.price / c.sqft) }))
    .sort((x, y) => x.distanceMi - y.distanceMi);

  const monthly = Math.pow(1 + market.annualGrowthPct / 100, 1 / 12);
  const trend = Array.from({ length: 25 }, (_, i) => {
    const back = 24 - i;
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
    const noise = back === 0 ? 1 : 1 + Math.sin(i * 1.3 + (hashString(a.normalized) % 7)) * 0.006;
    return { month: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }), value: round((estimate / Math.pow(monthly, back)) * noise, 100) };
  });
  trend[trend.length - 1].value = estimate;

  return {
    address: a,
    market,
    estimate,
    low,
    high,
    confidence,
    confidenceLabel: confidence >= 88 ? 'High' : confidence >= 80 ? 'Medium' : 'Low',
    beds,
    baths,
    sqft,
    yearBuilt,
    lotAcres,
    pricePerSqft: Math.round(estimate / sqft),
    comps,
    trend,
    asOf,
  };
}

export type ValuationResult = { ok: true; valuation: Valuation } | { ok: false; message: string };

/** Full "Get value" flow: validate, then value. */
export function getValue(input: string, asOf?: string): ValuationResult {
  const v = validateAddress(input);
  if (!v.ok) return { ok: false, message: v.reason === 'empty' ? 'Enter an address to get a value.' : UNABLE_MESSAGE };
  return { ok: true, valuation: estimateValue(v.address, asOf) };
}

/** Download rows (CSV) for a valuation. */
export function valuationCsv(v: Valuation, agentName?: string): (string | number)[][] {
  return [
    ['MBEstimate', `${v.address.number} ${v.address.street}${v.address.rest ? `, ${v.address.rest}` : ''}`],
    ['As of', v.asOf],
    ['Estimated value', v.estimate],
    ['Low', v.low],
    ['High', v.high],
    ['Confidence score', v.confidence],
    ['Beds', v.beds],
    ['Baths', v.baths],
    ['Sq ft', v.sqft],
    ['Year built', v.yearBuilt],
    ['Market', v.market.label],
    ...(agentName ? [['Co-branded agent', agentName]] : []),
    [],
    ['Comparable', 'Sold', 'Price', 'Sq ft', 'Beds', 'Baths', '$/sq ft', 'Distance (mi)'],
    ...v.comps.map((c) => [c.address, c.soldDate, c.price, c.sqft, c.beds, c.baths, c.pricePerSqft, c.distanceMi]),
    [],
    ['Demo Data — mock AVM for the prototype. Not an appraisal.'],
  ];
}
