/**
 * Marketing-tool helpers (Social Studio, Newsletter, Social Share, Prequalified Buyer
 * Campaign, Presentation Expressway): search + category filtering, template filling,
 * deterministic custom-script assembly, report selection/reorder and the campaign
 * send schedule. Pure functions, no UI.
 */

/* ------------------------------------------------------------------ search / filter */

export function normalize(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9%$]+/g, ' ')
    .trim();
}

/** Every whitespace-separated term in `query` must appear somewhere in `haystack` (AND search). */
export function matchesQuery(haystack: string | string[], query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const h = normalize(Array.isArray(haystack) ? haystack.join(' ') : haystack);
  return q.split(' ').every((t) => h.includes(t));
}

/**
 * Generic filter: free-text query AND (any of the selected categories). An empty category
 * selection means "all".
 */
export function filterItems<T>(items: T[], opts: { query?: string; categories?: string[]; text: (t: T) => string | string[]; cats: (t: T) => string[] }): T[] {
  const sel = (opts.categories ?? []).filter(Boolean);
  return items.filter((it) => {
    if (sel.length && !opts.cats(it).some((c) => sel.includes(c))) return false;
    return matchesQuery(opts.text(it), opts.query ?? '');
  });
}

/** Item count per category (an item in several categories counts in each). */
export function countByCategory<T>(items: T[], cats: (t: T) => string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) for (const c of cats(it)) out[c] = (out[c] ?? 0) + 1;
  return out;
}

/** Toggle a value in a multi-select list. */
export function toggleInList<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/* ------------------------------------------------------------------ templates */

/** Replace {key} tokens. Unknown tokens are left as-is so they're visible while editing. */
export function fillTemplate(tpl: string, vars: Record<string, string | number | undefined>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined && vars[k] !== '' ? String(vars[k]) : m));
}

export function wordCount(text: string): number {
  const t = (text ?? '').trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Spoken length at `wpm` words per minute (150 = natural on-camera pace), in seconds. */
export function readSeconds(text: string, wpm = 150): number {
  if (!(wpm > 0)) return 0;
  return Math.round((wordCount(text) / wpm) * 60);
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Fit a caption to a platform limit (X = 280), ending with an ellipsis when cut. */
export function fitToLimit(text: string, limit: number): { text: string; truncated: boolean; length: number } {
  const t = text ?? '';
  if (!(limit > 0) || t.length <= limit) return { text: t, truncated: false, length: t.length };
  const cut = t.slice(0, Math.max(0, limit - 1)).replace(/\s+\S*$/, '');
  const out = `${cut}…`;
  return { text: out, truncated: true, length: out.length };
}

/* ------------------------------------------------------------------ custom script builder */

export type ScriptTone = 'friendly' | 'professional' | 'energetic' | 'reassuring';
export type ScriptAudience = 'first-time-buyers' | 'move-up-buyers' | 'homeowners' | 'agents' | 'investors';
export type ScriptLength = 30 | 60 | 90;

export interface CustomScriptInput {
  topic: string;
  audience: ScriptAudience;
  tone: ScriptTone;
  length: ScriptLength;
  name: string;
  company: string;
  phone?: string;
  /** Up to 3 optional key points the LO wants included. */
  keyPoints?: string[];
}

export const AUDIENCE_LABEL: Record<ScriptAudience, string> = {
  'first-time-buyers': 'First-time buyers',
  'move-up-buyers': 'Move-up buyers',
  homeowners: 'Homeowners',
  agents: 'Real estate agents',
  investors: 'Investors',
};

export const TONE_LABEL: Record<ScriptTone, string> = { friendly: 'Friendly', professional: 'Professional', energetic: 'Energetic', reassuring: 'Calm & reassuring' };

const HOOKS: Record<ScriptTone, string> = {
  friendly: 'Hey everyone, {name} here, and today I want to talk about {topic}.',
  professional: 'Hi, I’m {name} with {company}. Let’s take a clear look at {topic}.',
  energetic: 'Stop scrolling — this is {name}, and {topic} is something you need to hear about right now!',
  reassuring: 'Hi, it’s {name}. If {topic} has been on your mind lately, take a breath — let’s walk through it together.',
};

const AUDIENCE_FRAME: Record<ScriptAudience, string> = {
  'first-time-buyers': 'If you’re renting today and wondering whether owning is realistic, this one’s for you.',
  'move-up-buyers': 'If your home is feeling a little small and you’ve built up some equity, this matters for your next move.',
  homeowners: 'If you already own a home, this is about protecting and growing what you’ve built.',
  agents: 'For my agent partners: this is a conversation your buyers are already having, so let’s get ahead of it.',
  investors: 'If you’re looking at real estate as an investment, the numbers here can change your strategy.',
};

const GENERIC_POINTS = [
  'The headlines rarely tell the whole story — what matters is how the numbers work for your situation.',
  'Small changes add up: a quarter point in rate or a few thousand dollars in price can move your payment more than you think.',
  'Having a plan before you need it means you can act quickly when the right opportunity shows up.',
  'Your home is one of the few purchases that can build wealth while you live in it.',
  'There are more programs and options out there than most people realise — including some with very low down payments.',
  'Timing the market perfectly is nearly impossible; being prepared is completely doable.',
];

const CTAS: Record<ScriptTone, string> = {
  friendly: 'Got questions? Send me a message or call {phone} — I’m always happy to run the numbers with you.',
  professional: 'To see how this applies to you, contact me at {phone} for a personalised analysis.',
  energetic: 'Don’t wait on this — DM me or call {phone} today and let’s map out your game plan!',
  reassuring: 'Whenever you’re ready, reach out at {phone}. No pressure — just clear answers.',
};

const POINTS_BY_LENGTH: Record<ScriptLength, number> = { 30: 1, 60: 3, 90: 5 };

/**
 * Deterministic script builder (no AI): hook by tone → audience framing → N talking points
 * (the LO's own key points first, then a stable rotation of generic points chosen by the
 * topic) → call to action. Same inputs always produce the same script.
 */
export function assembleCustomScript(input: CustomScriptInput): string {
  const topic = (input.topic ?? '').trim() || 'today’s housing market';
  const vars = { name: input.name || 'your loan officer', company: input.company || 'our team', topic, phone: input.phone || 'the number on screen' };
  const n = POINTS_BY_LENGTH[input.length] ?? 3;
  const own = (input.keyPoints ?? []).map((p) => p.trim()).filter(Boolean).map((p) => (/[.!?]$/.test(p) ? p : `${p}.`));
  const start = hashTopic(topic) % GENERIC_POINTS.length;
  const generic: string[] = [];
  for (let i = 0; generic.length < Math.max(0, n - own.length) && i < GENERIC_POINTS.length; i++) generic.push(GENERIC_POINTS[(start + i) % GENERIC_POINTS.length]);
  const points = [...own.slice(0, n), ...generic].slice(0, n);
  const parts = [fillTemplate(HOOKS[input.tone] ?? HOOKS.friendly, vars), AUDIENCE_FRAME[input.audience] ?? '', ...points, fillTemplate(CTAS[input.tone] ?? CTAS.friendly, vars)];
  if (input.length === 90) parts.splice(parts.length - 1, 0, `Bottom line: when it comes to ${topic}, the right information beats the loudest headline every time.`);
  return parts.filter(Boolean).join('\n\n');
}

function hashTopic(s: string): number {
  let h = 0;
  for (const ch of normalize(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/* ------------------------------------------------------------------ report selection (campaign) */

export const MAX_REPORTS = 9;

/** Toggle a report in the ordered selection, enforcing the max. Returns an error message when blocked. */
export function toggleReport(selected: string[], id: string, max = MAX_REPORTS): { selected: string[]; error: string | null } {
  if (selected.includes(id)) return { selected: selected.filter((x) => x !== id), error: null };
  if (selected.length >= max) return { selected, error: `You can select up to ${max} reports. Remove one first.` };
  return { selected: [...selected, id], error: null };
}

/** Move an item from index `from` to index `to` (clamped). Returns a new array. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list.slice();
  const t = Math.max(0, Math.min(list.length - 1, to));
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(t, 0, x);
  return out;
}

/* ------------------------------------------------------------------ campaign schedule */

export interface ScheduledSend {
  index: number;
  day: number;
  /** ISO date (YYYY-MM-DD). */
  date: string;
}

/** Parse YYYY-MM-DD as a UTC date (falls back to `fallback` when invalid). */
export function parseIsoDate(s: string, fallback = '2026-10-15'): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date(NaN);
  return Number.isFinite(d.getTime()) ? d : parseIsoDate(fallback, '2026-10-15');
}

export function addDaysIso(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + Math.round(Number.isFinite(days) ? days : 0));
  return d.toISOString().slice(0, 10);
}

/** One send per report: the first on the start date, then every `cadenceDays`. Optionally skip weekends (pushes to Monday). */
export function campaignSchedule(startIso: string, cadenceDays: number, count: number, skipWeekends = false): ScheduledSend[] {
  const cad = Math.max(1, Math.round(Number.isFinite(cadenceDays) ? cadenceDays : 1));
  const out: ScheduledSend[] = [];
  for (let i = 0; i < Math.max(0, Math.floor(count)); i++) {
    let date = addDaysIso(startIso, i * cad);
    if (skipWeekends) {
      const dow = parseIsoDate(date).getUTCDay();
      if (dow === 6) date = addDaysIso(date, 2);
      if (dow === 0) date = addDaysIso(date, 1);
    }
    const day = Math.round((parseIsoDate(date).getTime() - parseIsoDate(startIso).getTime()) / 86400000) + 1;
    out.push({ index: i, day, date });
  }
  return out;
}

/** "Thu, Oct 15" */
export function shortDate(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/* ------------------------------------------------------------------ newsletter archive */

/** "2026-10" from an ISO date. */
export function monthKey(iso: string): string {
  return (iso ?? '').slice(0, 7);
}

export function monthLabel(key: string): string {
  const d = parseIsoDate(`${key}-01`);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Distinct months, newest first. */
export function availableMonths(dates: string[]): string[] {
  return Array.from(new Set(dates.map(monthKey))).sort().reverse();
}

export function inMonth(iso: string, month: string | 'all'): boolean {
  return month === 'all' || monthKey(iso) === month;
}
