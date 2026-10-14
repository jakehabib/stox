import { describe, expect, it } from 'vitest';
import {
  addWeeks,
  clock,
  curveChangesBp,
  curveShape,
  curveSpreadBp,
  filterByMonth,
  formatEt,
  isPast,
  isoDate,
  monthLabel,
  monthsOf,
  nthWeekday,
  paginate,
  parseIsoDate,
  priceToBp,
  rangeStats,
  readingMinutes,
  relativeTime,
  reportSurprise,
  sessionsFor,
  weekDays,
  weekLabel,
  weekStart,
  weeksBetween,
  windowOf,
  type CurvePoint,
} from './markets';

const pts = (prices: number[]) => prices.map((price, i) => ({ t: String(i), price }));

describe('rangeStats', () => {
  it('reproduces the observed spec day: low 100.19 / high 100.56 / prev close 100.33 / current 100.48 / +0.15', () => {
    const s = rangeStats(pts([100.33, 100.29, 100.19, 100.27, 100.41, 100.56, 100.52, 100.48]), 100.33);
    expect(s.low).toBe(100.19);
    expect(s.high).toBe(100.56);
    expect(s.prevClose).toBe(100.33);
    expect(s.current).toBe(100.48);
    expect(s.change).toBe(0.15);
    expect(priceToBp(s.change)).toBe(15);
  });
  it('down day: 100.00 → 99.62', () => {
    const s = rangeStats(pts([99.95, 99.7, 99.8, 99.62]), 100);
    expect(s).toMatchObject({ low: 99.62, high: 99.95, current: 99.62, change: -0.38 });
    expect(s.changePct).toBe(-0.38);
  });
  it('empty series falls back to the reference close (no NaN)', () => {
    expect(rangeStats([], 100.33)).toEqual({ low: 100.33, high: 100.33, prevClose: 100.33, current: 100.33, change: 0, changePct: 0 });
  });
});

describe('windowOf / sessionsFor', () => {
  const daily = pts([100, 101, 102, 103, 104, 105]);
  it('takes the last N bars and the close before them', () => {
    const w = windowOf(daily, 3);
    expect(w.points.map((p) => p.price)).toEqual([103, 104, 105]);
    expect(w.prevClose).toBe(102);
  });
  it('window larger than series uses first bar as reference', () => {
    const w = windowOf(daily, 50);
    expect(w.points).toHaveLength(6);
    expect(w.prevClose).toBe(100);
  });
  it('sessions per timeframe', () => {
    expect(sessionsFor('5D')).toBe(5);
    expect(sessionsFor('1Y')).toBe(252);
  });
});

const curve: CurvePoint[] = [
  { tenor: '3M', years: 0.25, today: 3.92, monthAgo: 4.05 },
  { tenor: '2Y', years: 2, today: 3.58, monthAgo: 3.66 },
  { tenor: '10Y', years: 10, today: 4.11, monthAgo: 4.02 },
];

describe('treasury curve', () => {
  it('2s10s spread today = +53bp, a month ago = +36bp', () => {
    expect(curveSpreadBp(curve, '2Y', '10Y')).toBe(53);
    expect(curveSpreadBp(curve, '2Y', '10Y', 'monthAgo')).toBe(36);
  });
  it('3m10y = +19bp; unknown tenor → 0', () => {
    expect(curveSpreadBp(curve, '3M', '10Y')).toBe(19);
    expect(curveSpreadBp(curve, '1M', '10Y')).toBe(0);
  });
  it('per-tenor changes', () => {
    expect(curveChangesBp(curve)).toEqual([
      { tenor: '3M', bp: -13 },
      { tenor: '2Y', bp: -8 },
      { tenor: '10Y', bp: 9 },
    ]);
  });
  it('shape labels', () => {
    expect(curveShape(53)).toBe('Normal (upward sloping)');
    expect(curveShape(-40)).toBe('Inverted');
    expect(curveShape(5)).toBe('Flat');
  });
});

describe('week helpers', () => {
  it('Wed Oct 14 2026 → week starts Mon Oct 12', () => {
    expect(isoDate(weekStart(new Date(2026, 9, 14)))).toBe('2026-10-12');
  });
  it('Sunday rolls back to the previous Monday', () => {
    expect(isoDate(weekStart(new Date(2026, 9, 18)))).toBe('2026-10-12');
    expect(isoDate(weekStart(new Date(2026, 9, 12)))).toBe('2026-10-12');
  });
  it('weekDays Mon–Fri and labels', () => {
    const m = new Date(2026, 9, 12);
    expect(weekDays(m).map(isoDate)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
    expect(weekLabel(m)).toBe('Oct 12 – 16, 2026');
    expect(weekLabel(new Date(2026, 8, 28))).toBe('Sep 28 – Oct 2, 2026');
  });
  it('addWeeks / weeksBetween', () => {
    expect(isoDate(addWeeks(new Date(2026, 9, 12), 1))).toBe('2026-10-19');
    expect(isoDate(addWeeks(new Date(2026, 9, 12), -2))).toBe('2026-09-28');
    expect(weeksBetween(new Date(2026, 9, 12), new Date(2026, 9, 28))).toBe(2);
  });
  it('nthWeekday: Columbus Day 2026 = Oct 12; first Friday of Nov 2026 = Nov 6', () => {
    expect(isoDate(nthWeekday(2026, 9, 1, 2))).toBe('2026-10-12');
    expect(isoDate(nthWeekday(2026, 10, 5, 1))).toBe('2026-11-06');
  });
  it('parseIsoDate is local', () => {
    expect(parseIsoDate('2026-10-14').getDate()).toBe(14);
  });
});

describe('isPast / formatEt', () => {
  const now = new Date(2026, 9, 14, 10, 0);
  it('CPI Wed 8:30 is past at 10:00; Beige Book 2:00 PM is not', () => {
    expect(isPast('2026-10-14', '8:30', now)).toBe(true);
    expect(isPast('2026-10-14', '14:00', now)).toBe(false);
  });
  it('Tuesday events past, Thursday events future', () => {
    expect(isPast('2026-10-13', '10:00', now)).toBe(true);
    expect(isPast('2026-10-15', '8:30', now)).toBe(false);
  });
  it('formats ET times', () => {
    expect(formatEt('8:30')).toBe('8:30 AM');
    expect(formatEt('14:00')).toBe('2:00 PM');
    expect(formatEt('12:00')).toBe('12:00 PM');
  });
});

describe('reportSurprise', () => {
  it('CPI hotter than forecast is negative for bonds', () => {
    const s = reportSurprise(0.4, 0.3, 'hot-bad');
    expect(s.label).toBe('Hotter than expected');
    expect(s.forBonds).toMatch(/Negative/);
    expect(s.diff).toBe(0.1);
  });
  it('Jobless claims higher than forecast (hot-good) is positive for bonds', () => {
    expect(reportSurprise(232, 225, 'hot-good').forBonds).toMatch(/Positive/);
  });
  it('in line within tolerance, and pending when no actual', () => {
    expect(reportSurprise(3.0, 3.0, 'hot-bad').label).toBe('In line');
    expect(reportSurprise(null, 3.0, 'hot-bad').label).toBe('Pending');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-10-14T14:00:00Z');
  it('minutes and hours', () => {
    expect(relativeTime('2026-10-14T13:52:00Z', now)).toBe('8 min ago');
    expect(relativeTime('2026-10-14T11:55:00Z', now)).toBe('2 hr ago');
  });
  it('yesterday / days / just now', () => {
    expect(relativeTime('2026-10-13T12:00:00Z', now)).toBe('Yesterday');
    expect(relativeTime('2026-10-10T12:00:00Z', now)).toBe('4 days ago');
    expect(relativeTime('2026-10-14T14:00:00Z', now)).toBe('Just now');
  });
});

describe('paginate / month filters', () => {
  const items = Array.from({ length: 23 }, (_, i) => ({ date: `2026-${i < 10 ? '09' : '10'}-${String((i % 10) + 1).padStart(2, '0')}` }));
  it('View more pages of 8', () => {
    expect(paginate(items, 1, 8)).toMatchObject({ shown: 8, hasMore: true, total: 23 });
    expect(paginate(items, 3, 8)).toMatchObject({ shown: 23, hasMore: false });
  });
  it('months newest first and filtering', () => {
    expect(monthsOf(items)).toEqual(['2026-10', '2026-09']);
    expect(filterByMonth(items, '2026-09')).toHaveLength(10);
    expect(filterByMonth(items, 'all')[0].date >= filterByMonth(items, 'all')[22].date).toBe(true);
    expect(monthLabel('2026-10')).toBe('October 2026');
  });
});

describe('readingMinutes / clock', () => {
  it('reading time at 230 wpm', () => {
    expect(readingMinutes('word '.repeat(460))).toBe(2);
    expect(readingMinutes('short')).toBe(1);
  });
  it('clock', () => {
    expect(clock(75)).toBe('1:15');
    expect(clock(3725)).toBe('1:02:05');
    expect(clock(NaN)).toBe('0:00');
  });
});
