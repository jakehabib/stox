/**
 * DEMO DATA — Economic calendar.
 *
 * The week of Oct 12–16 2026 is fixed to the observed schedule. Every other week is
 * generated deterministically from a realistic release cadence (weekly reports, monthly
 * reports by approximate day-of-month, FOMC meetings, bond-market holidays).
 * Values are synthetic. To go live, replace `getWeekEvents` with your calendar feed.
 */
import { hashString, mulberry32 } from '@/lib/random';
import { addDays, isPast, isoDate, nthWeekday, parseIsoDate, weekDays, weekStart, type RateBias } from '@/lib/calculations/markets';

export type Importance = 'high' | 'medium' | 'low';
export type Unit = '%' | 'K' | 'M' | 'level' | 'none';

export interface EconEvent {
  id: string;
  date: string; // yyyy-mm-dd
  time: string; // "8:30" ET, 24h; "" = all day
  name: string;
  period?: string; // "Sep"
  importance: Importance;
  unit: Unit;
  digits: number;
  prior: number | null;
  forecast: number | null;
  actual: number | null;
  bias: RateBias;
  tolerance: number;
  holiday?: boolean;
  secondary?: string;
  about: string;
  ratesImpact: string;
}

interface ReportDef {
  name: string;
  time: string;
  importance: Importance;
  unit: Unit;
  digits: number;
  base: number;
  vol: number;
  bias: RateBias;
  tolerance?: number;
  about: string;
  ratesImpact: string;
}

const R: Record<string, ReportDef> = {
  cpi: {
    name: 'Consumer Price Index (CPI)', time: '8:30', importance: 'high', unit: '%', digits: 1, base: 0.3, vol: 0.1, bias: 'hot-bad',
    about: 'Monthly change in prices paid by consumers for a basket of goods and services. The core reading strips out food and energy.',
    ratesImpact: 'Inflation is the arch-enemy of bonds. A hotter-than-expected CPI erodes the value of fixed coupons, so MBS prices fall and mortgage rates rise. A cooler print, especially in core and shelter, is one of the most reliable catalysts for lower rates.',
  },
  ppi: {
    name: 'Producer Price Index (PPI)', time: '8:30', importance: 'medium', unit: '%', digits: 1, base: 0.2, vol: 0.15, bias: 'hot-bad',
    about: 'Wholesale inflation — prices received by domestic producers. Often a lead indicator for consumer prices.',
    ratesImpact: 'Pipeline inflation pressure. Hot readings can foreshadow a hotter CPI and weigh on bonds; tame readings support MBS.',
  },
  retail: {
    name: 'Retail Sales', time: '8:30', importance: 'high', unit: '%', digits: 1, base: 0.3, vol: 0.3, bias: 'hot-bad',
    about: 'Monthly change in sales at retailers and food services — a direct read on consumer spending, roughly two-thirds of GDP.',
    ratesImpact: 'Strong spending signals a resilient economy that can keep inflation sticky — negative for bonds. A soft report argues for lower rates.',
  },
  claims: {
    name: 'Initial Jobless Claims', time: '8:30', importance: 'medium', unit: 'K', digits: 0, base: 228, vol: 9, bias: 'hot-good', tolerance: 2,
    about: 'Number of people filing for unemployment benefits for the first time last week — the most timely labor-market gauge.',
    ratesImpact: 'Rising claims point to a cooling job market, which tends to help bonds and lower mortgage rates. Falling claims signal labor strength and can pressure rates higher.',
  },
  adp: {
    name: 'ADP Employment (weekly)', time: '8:15', importance: 'low', unit: 'K', digits: 1, base: 14, vol: 4, bias: 'hot-bad',
    about: 'Weekly preliminary estimate of private payroll growth (four-week average) from ADP payroll data.',
    ratesImpact: 'A timely, noisy read on hiring. Stronger hiring is mildly negative for bonds; weaker hiring is mildly positive. Markets usually wait for the BLS report.',
  },
  ehs: {
    name: 'Existing Home Sales', time: '10:00', importance: 'medium', unit: 'M', digits: 2, base: 4.05, vol: 0.08, bias: 'hot-bad', tolerance: 0.01,
    about: 'Closed sales of previously owned homes at a seasonally adjusted annual rate, plus median price and inventory.',
    ratesImpact: 'Housing data rarely moves bonds much on its own, but it frames the purchase market for your clients: inventory, days on market and median price trends.',
  },
  nhs: {
    name: 'New Home Sales', time: '10:00', importance: 'medium', unit: 'K', digits: 0, base: 680, vol: 35, bias: 'hot-bad', tolerance: 5,
    about: 'Contract signings on newly built single-family homes at a seasonally adjusted annual rate.',
    ratesImpact: 'Limited direct rate impact; signals builder momentum and the supply pipeline buyers will see.',
  },
  starts: {
    name: 'Housing Starts', time: '8:30', importance: 'medium', unit: 'M', digits: 2, base: 1.34, vol: 0.06, bias: 'hot-bad', tolerance: 0.01,
    about: 'New residential construction begun during the month, with building permits as a forward-looking companion.',
    ratesImpact: 'Mostly a supply story. More starts today means more inventory in 6–12 months, which helps affordability.',
  },
  pending: {
    name: 'Pending Home Sales', time: '10:00', importance: 'low', unit: '%', digits: 1, base: 0.5, vol: 1.8, bias: 'neutral',
    about: 'Index of signed contracts on existing homes — leads existing home sales by one to two months.',
    ratesImpact: 'Little bond-market impact. Useful for the purchase-market narrative with agents.',
  },
  ip: {
    name: 'Industrial Production', time: '9:15', importance: 'medium', unit: '%', digits: 1, base: 0.1, vol: 0.2, bias: 'hot-bad',
    about: 'Monthly change in output from factories, mines and utilities.',
    ratesImpact: 'A secondary growth gauge. Strength is mildly negative for bonds, weakness mildly positive.',
  },
  capu: {
    name: 'Capacity Utilization', time: '9:15', importance: 'low', unit: '%', digits: 1, base: 77.4, vol: 0.3, bias: 'hot-bad',
    about: 'Share of industrial capacity in use. Readings near or above 80% can signal inflationary bottlenecks.',
    ratesImpact: 'Higher utilization hints at future price pressure — modestly negative for bonds. Current levels are well below the danger zone.',
  },
  ism: {
    name: 'ISM Manufacturing Index', time: '10:00', importance: 'high', unit: 'level', digits: 1, base: 49.2, vol: 1.1, bias: 'hot-bad',
    about: 'Survey of purchasing managers. Above 50 indicates expansion; the Prices Paid component tracks input inflation.',
    ratesImpact: 'A jump above 50 or a hot Prices Paid reading tends to pressure bonds; contraction readings help rates.',
  },
  isms: {
    name: 'ISM Services Index', time: '10:00', importance: 'high', unit: 'level', digits: 1, base: 51.6, vol: 1.2, bias: 'hot-bad',
    about: 'Purchasing managers survey for the services sector — the bulk of the U.S. economy.',
    ratesImpact: 'Services inflation is the stickiest part of the inflation picture. Strong readings are negative for bonds.',
  },
  jolts: {
    name: 'JOLTS Job Openings', time: '10:00', importance: 'medium', unit: 'M', digits: 2, base: 7.2, vol: 0.25, bias: 'hot-bad', tolerance: 0.02,
    about: 'Job openings, hires and quits — a measure of labor demand.',
    ratesImpact: 'Fewer openings mean less wage pressure — supportive for bonds and lower rates.',
  },
  jobs: {
    name: 'Jobs Report (Nonfarm Payrolls)', time: '8:30', importance: 'high', unit: 'K', digits: 0, base: 95, vol: 45, bias: 'hot-bad', tolerance: 5,
    about: 'Monthly change in nonfarm payrolls, the unemployment rate and average hourly earnings from the BLS.',
    ratesImpact: 'The single most market-moving report of the month. A strong report can push mortgage rates up an eighth or more in a day; a weak one can do the opposite.',
  },
  confidence: {
    name: 'Consumer Confidence', time: '10:00', importance: 'medium', unit: 'level', digits: 1, base: 95, vol: 3, bias: 'hot-bad',
    about: 'Conference Board survey of consumer attitudes about business conditions, jobs and income.',
    ratesImpact: 'Sentiment data moves bonds modestly. Watch the labor-differential detail for job-market clues.',
  },
  sentiment: {
    name: 'Consumer Sentiment (UMich)', time: '10:00', importance: 'medium', unit: 'level', digits: 1, base: 56, vol: 2, bias: 'hot-bad',
    about: 'University of Michigan survey, including closely watched 1-year and 5-year inflation expectations.',
    ratesImpact: 'The Fed watches inflation expectations closely. Rising expectations are negative for bonds.',
  },
  durable: {
    name: 'Durable Goods Orders', time: '8:30', importance: 'medium', unit: '%', digits: 1, base: 0.4, vol: 1.6, bias: 'hot-bad',
    about: 'New orders for long-lasting manufactured goods. Core capital goods orders proxy business investment.',
    ratesImpact: 'Volatile month to month; strong core orders are mildly negative for bonds.',
  },
  gdp: {
    name: 'GDP (Q/Q annualized)', time: '8:30', importance: 'high', unit: '%', digits: 1, base: 1.9, vol: 0.5, bias: 'hot-bad',
    about: 'Total output of the U.S. economy, released as advance, second and third estimates.',
    ratesImpact: 'Faster growth tends to lift yields. Watch the inflation (price index) component as closely as the headline.',
  },
  pce: {
    name: 'PCE Inflation', time: '8:30', importance: 'high', unit: '%', digits: 1, base: 0.2, vol: 0.1, bias: 'hot-bad',
    about: 'Personal Consumption Expenditures price index — the Fed’s preferred inflation gauge.',
    ratesImpact: 'This is the inflation number the Fed targets at 2%. Cool core PCE readings strengthen the case for cuts and help MBS.',
  },
  caseshiller: {
    name: 'Case-Shiller Home Price Index (Y/Y)', time: '9:00', importance: 'low', unit: '%', digits: 1, base: 1.8, vol: 0.4, bias: 'neutral',
    about: 'Repeat-sales home price index for 20 major metros, reported with a two-month lag.',
    ratesImpact: 'No real rate impact — but a great talking point: home values are still appreciating.',
  },
  fhfa: {
    name: 'FHFA House Price Index', time: '9:00', importance: 'low', unit: '%', digits: 1, base: 0.2, vol: 0.3, bias: 'neutral',
    about: 'Monthly change in prices of homes financed with conforming mortgages.',
    ratesImpact: 'No real rate impact. Pairs well with the House Price Index tool for client conversations.',
  },
  mba: {
    name: 'MBA Mortgage Applications', time: '7:00', importance: 'low', unit: '%', digits: 1, base: 1.2, vol: 4, bias: 'neutral',
    about: 'Weekly change in mortgage application volume, split into purchase and refinance indexes.',
    ratesImpact: 'Does not move bonds — but it is a real-time read on purchase demand and the refi window.',
  },
  auction10: {
    name: '10-Year Note Auction', time: '13:00', importance: 'medium', unit: '%', digits: 3, base: 4.12, vol: 0.05, bias: 'hot-bad', tolerance: 0.004,
    about: 'Treasury sells new 10-year notes. Demand is judged by the high yield versus the when-issued yield and the bid-to-cover ratio.',
    ratesImpact: 'A weak auction (higher yield than expected, “tailing”) can push all long rates up, including mortgages. Strong demand helps.',
  },
  auction30: {
    name: '30-Year Bond Auction', time: '13:00', importance: 'medium', unit: '%', digits: 3, base: 4.66, vol: 0.05, bias: 'hot-bad', tolerance: 0.004,
    about: 'Treasury sells new 30-year bonds.',
    ratesImpact: 'Sloppy demand at the long end can spill over into MBS pricing in the afternoon.',
  },
  beige: {
    name: 'Fed Beige Book', time: '14:00', importance: 'medium', unit: 'none', digits: 0, base: 0, vol: 0, bias: 'neutral',
    about: 'Anecdotal summary of economic conditions across the 12 Federal Reserve districts, released two weeks before each FOMC meeting.',
    ratesImpact: 'No numbers, but the tone matters: mentions of softer hiring and easing price pressure support the case for lower rates.',
  },
  fomc: {
    name: 'FOMC Rate Decision', time: '14:00', importance: 'high', unit: '%', digits: 2, base: 3.75, vol: 0, bias: 'hot-bad',
    about: 'The Federal Reserve announces its target for the Fed Funds rate (upper bound shown), followed by the Chair’s press conference at 2:30 PM.',
    ratesImpact: 'The Fed sets short-term rates, not mortgage rates. Mortgage rates react to the statement, projections and press conference tone about future inflation.',
  },
  minutes: {
    name: 'FOMC Minutes', time: '14:00', importance: 'medium', unit: 'none', digits: 0, base: 0, vol: 0, bias: 'neutral',
    about: 'Detailed record of the previous Fed meeting, released three weeks after the decision.',
    ratesImpact: 'Can move rates if the minutes show a different balance of views than the press conference suggested.',
  },
};

const HOLIDAYS: Record<string, string> = {
  '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day (observed)',
  '2026-09-07': 'Labor Day',
  '2026-10-12': 'Columbus Day',
  '2026-11-11': 'Veterans Day',
  '2026-11-26': 'Thanksgiving Day',
  '2026-12-25': 'Christmas Day',
  '2027-01-01': 'New Year’s Day',
  '2027-01-18': 'Martin Luther King Jr. Day',
  '2027-02-15': 'Presidents’ Day',
};

/** FOMC decision dates (second day of each meeting). */
export const FOMC_DECISIONS = ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09', '2027-01-27', '2027-03-17'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function makeEvent(key: string, date: string, now: Date, extra: Partial<EconEvent> = {}): EconEvent {
  const def = R[key];
  const d = parseIsoDate(date);
  const rand = mulberry32(hashString(`${key}:${date}`));
  const round = (n: number) => Math.round(n * 10 ** def.digits) / 10 ** def.digits;
  const numeric = def.unit !== 'none';
  const prior = numeric ? round(def.base + (rand() - 0.5) * 2 * def.vol) : null;
  const forecast = numeric ? round(def.base + (rand() - 0.5) * def.vol) : null;
  const surprise = (rand() - 0.5) * 2 * def.vol * 0.8;
  const base: EconEvent = {
    id: `${key}-${date}`,
    date,
    time: def.time,
    name: def.name,
    period: MONTHS[(d.getMonth() + 11) % 12],
    importance: def.importance,
    unit: def.unit,
    digits: def.digits,
    prior,
    forecast,
    actual: null,
    bias: def.bias,
    tolerance: def.tolerance ?? 0,
    about: def.about,
    ratesImpact: def.ratesImpact,
    ...extra,
  };
  if (base.forecast !== null && base.actual === null && isPast(date, base.time, now) && !extra.hasOwnProperty('actual')) {
    base.actual = round(base.forecast + surprise);
  }
  if (base.actual !== null && !isPast(date, base.time, now)) base.actual = null; // never show the future
  return base;
}

function holidayEvent(date: string, name: string): EconEvent {
  return {
    id: `holiday-${date}`,
    date,
    time: '',
    name: `Bond Market Closed — ${name}`,
    importance: 'medium',
    unit: 'none',
    digits: 0,
    prior: null,
    forecast: null,
    actual: null,
    bias: 'neutral',
    tolerance: 0,
    holiday: true,
    about: `U.S. bond markets (SIFMA) are closed for ${name}. Stock markets may be open; banks and the Federal Reserve are closed.`,
    ratesImpact: 'No MBS trading means no new rate sheets from most lenders, or rate sheets carried over from the prior session. Locks are typically unavailable until the next session.',
  };
}

/** The observed week: Oct 12–16 2026. Actuals appear only once released relative to `now`. */
function fixedWeek(now: Date): EconEvent[] {
  const ev = (key: string, date: string, v: Partial<EconEvent> & { actualIfPast?: number | null }) => {
    const { actualIfPast, ...rest } = v;
    const e = makeEvent(key, date, now, { ...rest, actual: null });
    if (actualIfPast !== undefined && actualIfPast !== null && isPast(date, e.time, now)) e.actual = actualIfPast;
    return e;
  };
  return [
    holidayEvent('2026-10-12', 'Columbus Day'),
    ev('adp', '2026-10-13', { period: 'Wk of Sep 26', prior: 14.3, forecast: 15.0, actualIfPast: 18.5 }),
    ev('ehs', '2026-10-13', { period: 'Sep', prior: 4.0, forecast: 4.05, actualIfPast: 4.11, secondary: 'Median price $412,400 (+1.6% Y/Y) · Inventory 1.55M (4.5 months’ supply)' }),
    ev('cpi', '2026-10-14', { period: 'Sep', prior: 0.4, forecast: 0.3, actualIfPast: 0.3, secondary: 'Core CPI 0.2% M/M vs 0.3% forecast · Headline 2.9% Y/Y · Shelter +0.2%' }),
    ev('beige', '2026-10-14', { prior: null, forecast: null }),
    ev('retail', '2026-10-15', { period: 'Sep', prior: 0.6, forecast: 0.4 }),
    ev('claims', '2026-10-15', { period: 'Wk of Oct 10', prior: 228, forecast: 230 }),
    ev('capu', '2026-10-16', { period: 'Sep', prior: 77.4, forecast: 77.3 }),
    ev('ip', '2026-10-16', { period: 'Sep', prior: 0.1, forecast: 0.0 }),
  ];
}

const FIXED_WEEK = '2026-10-12';
const FIXED_KEYS = new Set(['adp', 'ehs', 'cpi', 'beige', 'retail', 'claims', 'capu', 'ip']);

/** Monthly releases by approximate day-of-month. */
const MONTHLY: { key: string; dom: number; label?: string }[] = [
  { key: 'ism', dom: 1 },
  { key: 'jolts', dom: 4 },
  { key: 'isms', dom: 5 },
  { key: 'sentiment', dom: 10, label: 'prelim' },
  { key: 'auction10', dom: 10 },
  { key: 'auction30', dom: 11 },
  { key: 'cpi', dom: 13 },
  { key: 'ppi', dom: 14 },
  { key: 'retail', dom: 15 },
  { key: 'ip', dom: 16 },
  { key: 'capu', dom: 16 },
  { key: 'starts', dom: 18 },
  { key: 'ehs', dom: 21 },
  { key: 'nhs', dom: 24 },
  { key: 'sentiment', dom: 24, label: 'final' },
  { key: 'durable', dom: 26 },
  { key: 'caseshiller', dom: 27 },
  { key: 'fhfa', dom: 27 },
  { key: 'confidence', dom: 28 },
  { key: 'pending', dom: 28 },
  { key: 'gdp', dom: 29 },
  { key: 'pce', dom: 30 },
];

/** Move weekends / bond holidays forward to the next business day. */
function nextBusinessDay(d: Date): Date {
  let x = d;
  while (x.getDay() === 0 || x.getDay() === 6 || HOLIDAYS[isoDate(x)]) x = addDays(x, 1);
  return x;
}

const SORT = (a: EconEvent, b: EconEvent) => (a.date + (a.time || '00:00').padStart(5, '0')).localeCompare(b.date + (b.time || '00:00').padStart(5, '0'));

/** Events for the Mon–Fri week containing `anyDay`. */
export function getWeekEvents(anyDay: Date, now: Date): EconEvent[] {
  const monday = weekStart(anyDay);
  const mondayIso = isoDate(monday);
  const days = weekDays(monday).map(isoDate);
  const inWeek = new Set(days);
  const events: EconEvent[] = [];
  const fixed = mondayIso === FIXED_WEEK;
  if (fixed) events.push(...fixedWeek(now));

  for (const date of days) {
    if (fixed) break;
    const d = parseIsoDate(date);
    if (HOLIDAYS[date]) {
      events.push(holidayEvent(date, HOLIDAYS[date]));
      continue;
    }
    const dow = d.getDay();
    if (dow === 2) events.push(makeEvent('adp', date, now, { period: 'Weekly' }));
    if (dow === 3) events.push(makeEvent('mba', date, now, { period: 'Weekly' }));
    if (dow === 4) events.push(makeEvent('claims', date, now, { period: 'Weekly' }));
    if (FOMC_DECISIONS.includes(date)) events.push(makeEvent('fomc', date, now, { prior: 3.75, forecast: 3.75, period: undefined }));
    // Beige Book: Wednesday two weeks before a decision. Minutes: three weeks after.
    if (FOMC_DECISIONS.some((f) => isoDate(addDays(parseIsoDate(f), -14)) === date)) events.push(makeEvent('beige', date, now, { period: undefined }));
    if (FOMC_DECISIONS.some((f) => isoDate(addDays(parseIsoDate(f), 21)) === date)) events.push(makeEvent('minutes', date, now, { period: undefined }));
  }

  if (!fixed) {
    // Jobs report: first Friday of the month (moved if a holiday).
    const months = new Set(days.map((x) => x.slice(0, 7)));
    for (const m of Array.from(months)) {
      const [y, mo] = m.split('-').map(Number);
      const jobs = isoDate(nextBusinessDay(nthWeekday(y, mo - 1, 5, 1)));
      if (inWeek.has(jobs)) events.push(makeEvent('jobs', jobs, now));
      for (const rel of MONTHLY) {
        if (m === '2026-10' && FIXED_KEYS.has(rel.key)) continue; // already in the observed week
        const target = isoDate(nextBusinessDay(new Date(y, mo - 1, Math.min(rel.dom, new Date(y, mo, 0).getDate()))));
        if (!inWeek.has(target)) continue;
        const e = makeEvent(rel.key, target, now);
        if (rel.label) {
          e.id += `-${rel.label}`;
          e.name = `${e.name} — ${rel.label}`;
        }
        if (rel.key === 'gdp') {
          const q = ['Advance', 'Second', 'Third'][(mo + 2) % 3];
          e.name = `GDP ${q} Estimate (Q/Q ann.)`;
        }
        events.push(e);
      }
    }
  }
  return events.filter((e) => inWeek.has(e.date)).sort(SORT);
}

/** High-importance events and market closures after `now`, beyond the current week. */
export function getUpcomingEvents(now: Date, count = 6): EconEvent[] {
  const out: EconEvent[] = [];
  for (let w = 1; w <= 10 && out.length < count; w++) {
    const evs = getWeekEvents(addDays(weekStart(now), w * 7), now).filter((e) => e.importance === 'high' || e.holiday);
    for (const e of evs) if (out.length < count) out.push(e);
  }
  return out;
}

/** Format a value with its unit (0.3 → "0.3%", 228 → "228K"). */
export function formatEventValue(v: number | null, e: Pick<EconEvent, 'unit' | 'digits'>): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const s = v.toLocaleString('en-US', { minimumFractionDigits: e.digits, maximumFractionDigits: e.digits });
  if (e.unit === '%') return `${s}%`;
  if (e.unit === 'K') return `${s}K`;
  if (e.unit === 'M') return `${s}M`;
  return s;
}

export function holidayName(date: string): string | undefined {
  return HOLIDAYS[date];
}
