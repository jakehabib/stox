import { describe, it, expect } from 'vitest';
import {
  addDaysIso,
  assembleCustomScript,
  availableMonths,
  campaignSchedule,
  countByCategory,
  fillTemplate,
  filterItems,
  fitToLimit,
  formatDuration,
  inMonth,
  matchesQuery,
  monthKey,
  monthLabel,
  moveItem,
  normalize,
  readSeconds,
  toggleInList,
  toggleReport,
  wordCount,
} from './marketingFilters';

const items = [
  { t: 'Rates just dropped — what it means', c: ['Breaking News', 'Featured'], tags: ['rates'] },
  { t: 'Five spring maintenance tips', c: ['Seasonal Home Tips'], tags: ['spring', 'maintenance'] },
  { t: 'Should you refinance now?', c: ['Refinance'], tags: ['rates', 'refi'] },
];
const opts = { text: (i: (typeof items)[number]) => [i.t, ...i.tags], cats: (i: (typeof items)[number]) => i.c };

describe('search', () => {
  it('normalize strips punctuation, case and apostrophes', () => {
    expect(normalize('  What’s NEW?! ')).toBe('whats new');
  });
  it('matchesQuery is an AND over terms', () => {
    expect(matchesQuery('Should you refinance now?', 'refinance now')).toBe(true);
    expect(matchesQuery('Should you refinance now?', 'refinance spring')).toBe(false);
    expect(matchesQuery('anything', '')).toBe(true);
  });
  it('filterItems combines query and categories', () => {
    expect(filterItems(items, { ...opts, query: 'rates' })).toHaveLength(2);
    expect(filterItems(items, { ...opts, query: 'rates', categories: ['Refinance'] })).toHaveLength(1);
    expect(filterItems(items, { ...opts, categories: ['Featured', 'Seasonal Home Tips'] })).toHaveLength(2);
    expect(filterItems(items, { ...opts })).toHaveLength(3);
  });
  it('countByCategory', () => {
    expect(countByCategory(items, opts.cats)).toEqual({ 'Breaking News': 1, Featured: 1, 'Seasonal Home Tips': 1, Refinance: 1 });
  });
  it('toggleInList', () => {
    expect(toggleInList(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleInList(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('templates', () => {
  it('fillTemplate fills known tokens, keeps unknown', () => {
    expect(fillTemplate('Hi, I’m {name} at {company} {x}', { name: 'Jake Habib', company: 'MBS Highway' })).toBe('Hi, I’m Jake Habib at MBS Highway {x}');
  });
  it('word count and read time at 150 wpm', () => {
    expect(wordCount('one two  three\nfour')).toBe(4);
    expect(wordCount('   ')).toBe(0);
    expect(readSeconds(Array(150).fill('w').join(' '))).toBe(60);
    expect(readSeconds(Array(75).fill('w').join(' '))).toBe(30);
  });
  it('formatDuration', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(NaN)).toBe('0:00');
  });
  it('fitToLimit trims to the X limit with an ellipsis', () => {
    const long = 'word '.repeat(100).trim();
    const r = fitToLimit(long, 280);
    expect(r.truncated).toBe(true);
    expect(r.length).toBeLessThanOrEqual(280);
    expect(r.text.endsWith('…')).toBe(true);
    expect(fitToLimit('short', 280)).toEqual({ text: 'short', truncated: false, length: 5 });
  });
});

describe('assembleCustomScript', () => {
  const base = { topic: 'buying before spring', audience: 'first-time-buyers' as const, tone: 'friendly' as const, length: 60 as const, name: 'Jake Habib', company: 'MBS Highway', phone: '(732) 865-6551' };
  it('is deterministic', () => {
    expect(assembleCustomScript(base)).toBe(assembleCustomScript({ ...base }));
  });
  it('uses the LO name, topic, audience framing and CTA', () => {
    const s = assembleCustomScript(base);
    expect(s).toContain('Jake Habib');
    expect(s).toContain('buying before spring');
    expect(s).toContain('renting today');
    expect(s).toContain('(732) 865-6551');
  });
  it('length controls the number of talking points (30s=1, 60s=3, 90s=5)', () => {
    const paras = (l: 30 | 60 | 90) => assembleCustomScript({ ...base, length: l }).split('\n\n').length;
    expect(paras(30)).toBe(4); // hook + audience + 1 point + CTA
    expect(paras(60)).toBe(6);
    expect(paras(90)).toBe(9); // + 5 points + bottom line
  });
  it('own key points come first', () => {
    const s = assembleCustomScript({ ...base, keyPoints: ['Down payment help exists in Dallas'] });
    expect(s.split('\n\n')[2]).toBe('Down payment help exists in Dallas.');
  });
  it('tone changes the hook', () => {
    expect(assembleCustomScript({ ...base, tone: 'energetic' })).toMatch(/^Stop scrolling/);
    expect(assembleCustomScript({ ...base, tone: 'professional' })).toMatch(/^Hi, I’m Jake Habib with MBS Highway/);
  });
});

describe('report selection', () => {
  const nine = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  it('blocks a 10th report', () => {
    const r = toggleReport(nine, 'j');
    expect(r.selected).toHaveLength(9);
    expect(r.error).toMatch(/up to 9/);
  });
  it('deselect then select works', () => {
    const r1 = toggleReport(nine, 'c');
    expect(r1.selected).toHaveLength(8);
    const r2 = toggleReport(r1.selected, 'j');
    expect(r2.selected[8]).toBe('j');
    expect(r2.error).toBeNull();
  });
  it('moveItem reorders (drag/drop + up/down)', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('campaign schedule', () => {
  it('9 reports every 3 days from Oct 15 2026', () => {
    const s = campaignSchedule('2026-10-15', 3, 9);
    expect(s.map((x) => x.date)).toEqual(['2026-10-15', '2026-10-18', '2026-10-21', '2026-10-24', '2026-10-27', '2026-10-30', '2026-11-02', '2026-11-05', '2026-11-08']);
    expect(s[8].day).toBe(25);
  });
  it('skip weekends pushes to Monday', () => {
    const s = campaignSchedule('2026-10-15', 3, 3, true); // Thu, Sun→Mon, Wed
    expect(s.map((x) => x.date)).toEqual(['2026-10-15', '2026-10-19', '2026-10-21']);
  });
  it('guards bad cadence / date', () => {
    expect(campaignSchedule('bad', 0, 2).map((x) => x.date)).toEqual(['2026-10-15', '2026-10-16']);
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('newsletter months', () => {
  it('month keys, labels and filter', () => {
    expect(monthKey('2026-10-05')).toBe('2026-10');
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(availableMonths(['2026-09-28', '2026-10-05', '2026-09-21', '2026-08-31'])).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(inMonth('2026-09-28', '2026-09')).toBe(true);
    expect(inMonth('2026-09-28', '2026-10')).toBe(false);
    expect(inMonth('2026-09-28', 'all')).toBe(true);
  });
});

/* ---------------------------------------------------------------- demo content integrity */
import { SCRIPT_CATEGORIES, VIDEO_SCRIPTS, scriptCategories } from '@/data/mock/socialStudio';
import { NEWSLETTER_ISSUES, CURRENT_ISSUE_ID } from '@/data/mock/newsletter';
import { CAMPAIGN_REPORTS, DEFAULT_REPORT_IDS } from '@/data/mock/prequalCampaign';
import { PRESENTATIONS } from '@/data/mock/presentations';
import { SHARE_CARDS } from '@/data/mock/socialShare';

describe('marketing demo content', () => {
  it('Social Studio has 43 scripts (43 View More buttons) across every category', () => {
    expect(VIDEO_SCRIPTS).toHaveLength(43);
    expect(new Set(VIDEO_SCRIPTS.map((s) => s.id)).size).toBe(43);
    const counts = countByCategory(VIDEO_SCRIPTS, scriptCategories);
    SCRIPT_CATEGORIES.forEach((c) => expect(counts[c] ?? 0).toBeGreaterThan(0));
    VIDEO_SCRIPTS.forEach((s) => expect(s.body).toContain('{name}'));
  });
  it('Newsletter current issue is Oct 5 2026', () => {
    const cur = NEWSLETTER_ISSUES.find((i) => i.id === CURRENT_ISSUE_ID)!;
    expect(cur.date).toBe('2026-10-05');
    expect(cur.title).toBe('Fed Minutes, Home Prices and Market Volatility');
    expect(cur.lead.heading).toBe('Fed Minutes');
  });
  it('Prequalified campaign defaults to the 9 reports in spec order, with extras available', () => {
    const names = DEFAULT_REPORT_IDS.map((id) => CAMPAIGN_REPORTS.find((r) => r.id === id)!.name);
    expect(names).toEqual(['Cost of Waiting', 'Buy vs Rent', 'RERC', 'Appreciation', 'Housing Supply and Demand', 'Amortization', 'Equity Gained', 'National House Price Index', 'Home Values Remain Resilient']);
    expect(CAMPAIGN_REPORTS.find((r) => r.id === 'appreciation')!.description).toBe('Estimate future home value.');
    expect(CAMPAIGN_REPORTS.length).toBeGreaterThan(9);
  });
  it('Presentation Expressway has the 9 spec items with 4–6 slides each', () => {
    expect(PRESENTATIONS.map((p) => p.title)).toEqual(['The Power of Leverage', '2026 Forecast', 'Seasonal Buying Strategies', 'Demographics Drive Demand', 'Is This a Housing Bubble?', 'Move-Up with Debt Consolidation', 'Bid Over Ask', 'The Cost of Waiting', 'How Higher Rates Can Benefit Buyers']);
    PRESENTATIONS.forEach((p) => {
      expect(p.slides.length).toBeGreaterThanOrEqual(4);
      expect(p.slides.length).toBeLessThanOrEqual(6);
    });
    expect(PRESENTATIONS.find((p) => p.id === 'bid-over-ask')!.related!.href).toBe('/members/bid-over-ask');
  });
  it('Social Share cards have unique ids and captions', () => {
    expect(new Set(SHARE_CARDS.map((c) => c.id)).size).toBe(SHARE_CARDS.length);
    SHARE_CARDS.forEach((c) => expect(c.caption.length).toBeGreaterThan(20));
  });
});
