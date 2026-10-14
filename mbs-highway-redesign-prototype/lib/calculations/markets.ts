/**
 * Market-analysis math: price-range stats, treasury curve spreads, calendar week helpers,
 * economic-report surprise logic, relative time, pagination and reading time.
 * Pure functions only — the UI never computes these inline.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
const finite = (n: number, fallback = 0) => (Number.isFinite(n) ? n : fallback);

/* ------------------------------------------------------------------ price stats */

export interface PricePoint {
  t: string;
  price: number;
}

export interface RangeStats {
  low: number;
  high: number;
  prevClose: number;
  current: number;
  change: number;
  changePct: number;
}

/**
 * Low / high / prior close / current / change for a price series.
 * `prevClose` is the reference close BEFORE the window (yesterday's close for 1D,
 * the close before the first bar for multi-day windows). Values rounded to 0.01.
 */
export function rangeStats(series: PricePoint[], prevClose: number): RangeStats {
  const prices = series.map((p) => p.price).filter((p) => Number.isFinite(p));
  const ref = finite(prevClose, prices[0] ?? 0);
  if (!prices.length) return { low: r2(ref), high: r2(ref), prevClose: r2(ref), current: r2(ref), change: 0, changePct: 0 };
  const current = prices[prices.length - 1];
  const change = r2(current - ref);
  return {
    low: r2(Math.min(...prices)),
    high: r2(Math.max(...prices)),
    prevClose: r2(ref),
    current: r2(current),
    change,
    changePct: ref ? Math.round(((current - ref) / ref) * 10000) / 100 : 0,
  };
}

export type Timeframe = '1D' | '5D' | '1M' | '3M' | '6M' | '1Y';
export const TIMEFRAMES: Timeframe[] = ['1D', '5D', '1M', '3M', '6M', '1Y'];

/** Trading sessions per timeframe (1D = intraday). */
export function sessionsFor(tf: Timeframe): number {
  return { '1D': 1, '5D': 5, '1M': 21, '3M': 63, '6M': 126, '1Y': 252 }[tf];
}

/**
 * Slice the last `sessions` bars of a daily series; returns the window and the
 * reference close (the bar immediately before the window, or the first bar).
 */
export function windowOf(daily: PricePoint[], sessions: number): { points: PricePoint[]; prevClose: number } {
  const n = Math.max(1, Math.min(daily.length, Math.floor(finite(sessions, 1))));
  const points = daily.slice(-n);
  const before = daily[daily.length - n - 1];
  return { points, prevClose: before ? before.price : points[0]?.price ?? 0 };
}

/** MBS price change expressed in basis points (0.15 → 15). */
export function priceToBp(change: number): number {
  return Math.round(finite(change) * 100);
}

/* ------------------------------------------------------------------ treasury curve */

export interface CurvePoint {
  tenor: string;
  years: number;
  today: number;
  monthAgo: number;
}

/** Spread in basis points between two tenors on the same curve (long − short). */
export function curveSpreadBp(curve: CurvePoint[], shortTenor: string, longTenor: string, which: 'today' | 'monthAgo' = 'today'): number {
  const s = curve.find((c) => c.tenor === shortTenor);
  const l = curve.find((c) => c.tenor === longTenor);
  if (!s || !l) return 0;
  return Math.round((l[which] - s[which]) * 100);
}

/** Per-tenor change in bp (today − 1 month ago). */
export function curveChangesBp(curve: CurvePoint[]): { tenor: string; bp: number }[] {
  return curve.map((c) => ({ tenor: c.tenor, bp: Math.round((c.today - c.monthAgo) * 100) }));
}

/** Plain-English label for a curve spread. */
export function curveShape(spreadBp: number): 'Inverted' | 'Flat' | 'Normal (upward sloping)' {
  if (spreadBp < -10) return 'Inverted';
  if (spreadBp <= 10) return 'Flat';
  return 'Normal (upward sloping)';
}

/* ------------------------------------------------------------------ dates / weeks */

/** ISO yyyy-mm-dd for a local date. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse yyyy-mm-dd as a LOCAL date (no UTC shift). */
export function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Monday of the week containing `d` (Sat/Sun roll back to the Monday before). */
export function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay(); // 0 Sun … 6 Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + diff);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

export function addWeeks(d: Date, n: number): Date {
  return addDays(d, n * 7);
}

/** Mon–Fri dates for the week starting `monday`. */
export function weekDays(monday: Date): Date[] {
  return [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Oct 12 – 16, 2026" / "Sep 28 – Oct 2, 2026" / "Dec 28, 2026 – Jan 1, 2027" */
export function weekLabel(monday: Date): string {
  const fri = addDays(monday, 4);
  const mo = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' });
  if (monday.getFullYear() !== fri.getFullYear()) return `${mo(monday)} ${monday.getDate()}, ${monday.getFullYear()} – ${mo(fri)} ${fri.getDate()}, ${fri.getFullYear()}`;
  if (monday.getMonth() !== fri.getMonth()) return `${mo(monday)} ${monday.getDate()} – ${mo(fri)} ${fri.getDate()}, ${fri.getFullYear()}`;
  return `${mo(monday)} ${monday.getDate()} – ${fri.getDate()}, ${fri.getFullYear()}`;
}

/** Whole weeks between two Mondays (b − a). */
export function weeksBetween(a: Date, b: Date): number {
  return Math.round((weekStart(b).getTime() - weekStart(a).getTime()) / (7 * 864e5));
}

/** Nth weekday of a month (weekday 0=Sun … 6=Sat; n=1 first). */
export function nthWeekday(year: number, month0: number, weekday: number, n: number): Date {
  const first = new Date(year, month0, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month0, 1 + offset + (n - 1) * 7);
}

/**
 * Has an event at `date` (yyyy-mm-dd) + `time` ("8:30", ET, 24h) already happened at `now`?
 * Demo times are treated as wall-clock ET; `now` is compared on the same wall clock.
 */
export function isPast(date: string, time: string, now: Date): boolean {
  const d = parseIsoDate(date);
  const [h, m] = (time || '0:00').split(':').map(Number);
  d.setHours(finite(h), finite(m), 0, 0);
  return d.getTime() <= now.getTime();
}

/** "8:30 AM" from "8:30" (24h). */
export function formatEt(time: string): string {
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h)) return 'All day';
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(finite(m)).padStart(2, '0')} ${ap}`;
}

/* ------------------------------------------------------------------ econ report surprise */

/** How a report's direction maps to bonds: 'hot-bad' = higher-than-expected is bad for bonds (e.g. CPI). */
export type RateBias = 'hot-bad' | 'hot-good' | 'neutral';

export interface Surprise {
  diff: number;
  label: 'Hotter than expected' | 'Cooler than expected' | 'In line' | 'Pending';
  forBonds: 'Negative for bonds (rates pressured higher)' | 'Positive for bonds (rates pressured lower)' | 'Little rate impact' | 'Awaiting release';
}

/**
 * Compare an actual print to the forecast. A difference within `tolerance` is "In line".
 * "Hot" economic news (stronger growth / inflation) usually pushes yields up and MBS prices down.
 */
export function reportSurprise(actual: number | null | undefined, forecast: number | null | undefined, bias: RateBias, tolerance = 0): Surprise {
  if (actual === null || actual === undefined || forecast === null || forecast === undefined || !Number.isFinite(actual) || !Number.isFinite(forecast)) {
    return { diff: 0, label: 'Pending', forBonds: 'Awaiting release' };
  }
  const diff = Math.round((actual - forecast) * 1000) / 1000;
  if (Math.abs(diff) <= tolerance + 1e-9) return { diff, label: 'In line', forBonds: 'Little rate impact' };
  const hot = diff > 0;
  const label = hot ? 'Hotter than expected' : 'Cooler than expected';
  if (bias === 'neutral') return { diff, label, forBonds: 'Little rate impact' };
  const bad = bias === 'hot-bad' ? hot : !hot;
  return { diff, label, forBonds: bad ? 'Negative for bonds (rates pressured higher)' : 'Positive for bonds (rates pressured lower)' };
}

/* ------------------------------------------------------------------ misc helpers */

/** "Just now", "12 min ago", "3 hr ago", "Yesterday", "4 days ago", or a date. */
export function relativeTime(iso: string, now: Date): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, now.getTime() - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** First `page * perPage` items, plus whether more remain ("View more" pagination). */
export function paginate<T>(items: T[], page: number, perPage: number): { items: T[]; hasMore: boolean; shown: number; total: number } {
  const n = Math.max(0, Math.floor(finite(page, 1))) * Math.max(1, Math.floor(finite(perPage, 1)));
  const shown = Math.min(items.length, n);
  return { items: items.slice(0, shown), hasMore: shown < items.length, shown, total: items.length };
}

/** "2026-10" from a yyyy-mm-dd string. */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** "October 2026" from "2026-10". */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Distinct months (newest first) present in a list of dated items. */
export function monthsOf(items: { date: string }[]): string[] {
  return Array.from(new Set(items.map((i) => monthKey(i.date)))).sort().reverse();
}

/** Items in a month ('all' passes everything through), newest first. */
export function filterByMonth<T extends { date: string }>(items: T[], key: string | 'all'): T[] {
  const list = key === 'all' ? items : items.filter((i) => monthKey(i.date) === key);
  return [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Reading time in whole minutes at 230 wpm (min 1). */
export function readingMinutes(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

/** "mm:ss" (or "h:mm:ss") from seconds. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(finite(seconds)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
