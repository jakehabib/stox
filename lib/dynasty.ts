import { prisma } from './db';
import { Rng, clamp } from './rng';
import { readJson, writeJson } from './json';
import { resolveStartYear } from './leagueYear';
import { AGE_CURVE, DEV_TRAIT_MULT, POSITION_AGE_PROFILE, DEFAULT_AGE_PROFILE, Position } from './tuning';

/**
 * ===========================================================================
 * DYNASTY LEVEL / GM PROGRESSION
 * ===========================================================================
 * A GM career track laid over normal franchise play. Two halves:
 *
 *   XP + LEVEL are DERIVED, never stored. Everything the system rewards is
 *   already in the database — TeamSeasonRecord (wins, playoff depth),
 *   Transaction rows of type CHAMPION / AWARD_* , and DraftPick joined to
 *   the player taken — so `computeDynastyXp` is a pure function of history
 *   recomputed on every read. Three consequences, all of them the point:
 *     * lib/season.ts needs no hook at all, so nothing about the season
 *       machine changes;
 *     * an existing save lands at whatever level its real history earns the
 *       instant this ships, with no migration;
 *     * XP is unfarmable. There is no "+5 XP for clicking Scout" to grind,
 *       because XP is not an event stream — it is a re-derivation of the
 *       franchise's record.
 *
 *   SPENT SKILL POINTS and LIMITED-USE CHARGES are the only persisted state
 *   (DynastyProfile). Those genuinely cannot be derived from anything else.
 *
 * WHAT SKILLS MAY DO — THE RULE CHANGED, 2026-08. READ THIS BEFORE ADDING ONE.
 *
 * The old rule was "informational and quality-of-life only": nothing here
 * could touch a development roll or a sim result, on the grounds that a
 * level-50 GM and a level-1 GM had to play the same football universe or no
 * franchise record in the save would be comparable.
 *
 * The app owner overruled it, in his own words: *"development tree should be
 * +5% exp gained to players, 10% and 15% maxed out"* and *"the negotiating
 * tree should be about signings. Each point up to the 3 abilities narrows the
 * uncertainty band"*. Both of those are mechanical edges, not information. So
 * the rule is now:
 *
 *   A skill MAY change a rate the GM's own front office plausibly controls —
 *   how fast his players develop, how precisely his cap staff can read a
 *   negotiation, how many prospects his scouts can work out. It MAY NOT
 *   change a player's ratings directly, a game result, or what an AI team
 *   will accept in a trade. Coaching is a front-office job; the scoreboard
 *   is not.
 *
 * The comparability concern is real and is handled by SIZE rather than by
 * prohibition: the biggest effect in the tree is +15% on a development roll
 * whose mean is already a fraction of an OVR point per checkpoint. It is a
 * thumb on the scale, not a cheat code. If a future skill cannot be justified
 * at that size, it does not belong here.
 *
 * THE TREE IS A TREE. Within a branch, `requires` chains each skill to the
 * one before it: the cheapest, weakest ability must be bought before the next
 * unlocks (app/actions/dynasty.ts enforces it server-side; the Dynasty page
 * renders a locked node with what unlocks it). This is the owner's rule —
 * *"No matter what, it should be a TREE, so the weakest ability needs to be
 * purchased first"* — and it is modelled explicitly rather than by array
 * position, so reordering DYNASTY_SKILLS cannot silently reorder the tree.
 *
 * WHERE THE NUMBERS LIVE. All of them are in DYNASTY below, marked [TUNE].
 * Nothing outside this file hardcodes a Dynasty balance value.
 * ===========================================================================
 */

// ---------------------------------------------------------------------------
// TUNING — every Dynasty balance value in the game [TUNE]
// ---------------------------------------------------------------------------

export const DYNASTY = {
  /**
   * [TUNE] XP awards. Sized so that a championship is worth roughly seventy
   * regular-season wins: the whole design collapses if grinding 9-8 seasons
   * out-earns actually winning something. Nothing here is awarded per ACTION
   * (a trade, a scouting pass, a signing) — only per RESULT, which is what
   * makes the ledger unfarmable.
   */
  XP: {
    REGULAR_SEASON_WIN: 10,
    /**
     * Season-end playoff depth, by TeamSeasonRecord.playoffResult. These are
     * TOTALS, not increments: a CHAMPION season pays CHAMPION and nothing
     * else from this table. Depth rather than "games won" deliberately — a
     * first-round bye means a team can reach the conference round having won
     * nothing, and playoffResult records where you were eliminated, which is
     * the honest measure either way.
     */
    PLAYOFF_RESULT: {
      MISSED: 0,
      WILDCARD: 60,
      DIVISIONAL: 110,
      CONFERENCE: 170,
      RUNNER_UP: 260,
      CHAMPION: 560,
    } as Record<string, number>,
    /** Per major individual award won by a player on your roster. */
    MAJOR_AWARD: 60,
    /** A pick that turned into a real contributor (round-scaled bar below). */
    DRAFT_HIT: 25,
    /** Additional, on top of DRAFT_HIT, for a pick who became a genuine star. */
    DRAFT_STAR: 50,
    DRAFT_STAR_OVR: 85,

    /** One-time franchise milestones. Each pays once, ever. */
    FIRST_PLAYOFF_BERTH: 100,
    FIRST_CHAMPIONSHIP: 300,
    /** Tenure and career-win ladders. Each rung pays once. */
    TENURE_LADDER: [
      { seasons: 5, xp: 100 },
      { seasons: 10, xp: 200 },
      { seasons: 20, xp: 400 },
    ],
    WIN_LADDER: [
      { wins: 50, xp: 100 },
      { wins: 100, xp: 200 },
      { wins: 200, xp: 400 },
    ],
  },

  /**
   * [TUNE] Level curve. XP to go from level L to L+1 is
   * round(LEVEL_BASE * L^LEVEL_EXPONENT), so the first level costs 80 (about
   * one good half-season) and level 20 costs ~4,000 (about three titles).
   */
  LEVEL_BASE: 80,
  LEVEL_EXPONENT: 1.35,
  MAX_LEVEL: 50,

  /**
   * [TUNE] Skill points are NOT one per level. These are the levels that
   * grant one; past the end of the list, one every SKILL_POINT_EVERY_AFTER
   * levels. Ten points by level 30 against twenty points to buy every rank
   * in the tree, so specialising is forced rather than encouraged.
   */
  SKILL_POINT_LEVELS: [2, 4, 6, 9, 12, 15, 18, 22, 26, 30],
  SKILL_POINT_EVERY_AFTER: 5,

  /**
   * [TUNE] FULL SCOUT — the per-season allowance of perfect evaluations.
   *
   * This is a BASELINE entitlement, not a skill-tree unlock: every GM gets
   * FULL_SCOUT_BASE_USES of them from day one of every league year, including
   * on a brand-new save with zero Dynasty levels. The Scouting branch's
   * SCOUTING_NETWORK upgrade adds FULL_SCOUT_PER_RANK more per rank, so a
   * fully-invested GM carries 4 rather than 2.
   *
   * Scarcity is the entire mechanic. Two is deliberately not enough to cover
   * a draft class, which is what makes "do I burn one on this quarterback?"
   * a real question. Raising the base is the single most dangerous knob in
   * this file — at 5+ the fog of war stops mattering for anyone the GM cares
   * about.
   */
  FULL_SCOUT_BASE_USES: 2,
  FULL_SCOUT_PER_RANK: 1,

  /** [TUNE] Negotiation's scarce ability. Resets when League.seasonYear moves. */
  INSIDER_USES_PER_SEASON: 2,

  /**
   * [TUNE] SCOUTING effects. Multipliers on the half-width of the range
   * lib/scouting.ts already computes — the existing confidence model is
   * untouched, its output is simply tightened. Index 0 is rank 0 (no skill),
   * so an unupgraded GM multiplies by exactly 1 and sees today's numbers.
   *
   * Worked example at the spec's reference point: a potential range of
   * 76-91 (half-width 7.5) becomes 76+7.5*(1-0.60) .. rounded => 79-88 at
   * rank 2. That is the intended feel — narrower, never exact.
   */
  ATTR_BAND_MULT: [1, 0.85, 0.72],
  POT_BAND_MULT: [1, 0.78, 0.60],
  /**
   * [TUNE] Film Room. An EXTRA multiplier, stacked on ATTR_BAND_MULT, applied
   * only to attributes whose scoutDifficulty clears HARD_ATTR_DIFFICULTY —
   * the mental/instinct traits the base model deliberately leaves foggiest
   * (see lib/ratings.ts scoutDifficulty). Better Evaluations tightens
   * everything a little; Film Room tightens the genuinely hard reads a lot.
   * They are different levers on purpose, so the branch has a real choice in
   * it rather than one dominant line.
   */
  HARD_ATTR_BAND_MULT: [1, 0.82, 0.68],
  HARD_ATTR_DIFFICULTY: 0.7,
  /**
   * Absolute floor on a displayed half-width, applied AFTER the multiplier.
   * This is what guarantees a range stays a range: at 1.0 a rounded band is
   * still at least center-1 .. center+1. Dropping this to 0 would let a
   * maxed scouting GM read true ratings for free, which is exactly what
   * Full Scout's scarcity exists to prevent.
   */
  MIN_BAND_HALF_WIDTH: 1.0,

  /**
   * [TUNE] DEVELOPMENT effects. Half-width, in OVR points, of the projected
   * rating band shown for a player N years out. Index 0 (rank 0) is null:
   * with no Development Insight the projection is not shown at all, so the
   * skill only ever ADDS information — it never makes the base game foggier.
   */
  DEV_PROJECTION_BAND: [null, 6, 3.5] as (number | null)[],
  /** How many seasons ahead the development projection looks. */
  DEV_PROJECTION_YEARS: 3,
  /** Half-width, in years, of the decline-onset estimate Aging Insight buys. */
  AGING_BAND_YEARS: 1.5,
  /** Breakout Watch: how many young players it will flag at once, and the age/experience window it looks at. */
  BREAKOUT_MAX_FLAGS: 4,
  BREAKOUT_MAX_AGE: 25,
  /** Only flag a player whose modelled improvement odds clear this bar. */
  BREAKOUT_MIN_SCORE: 0.55,

  /**
   * [TUNE] NEGOTIATION effects. Half-width of the estimated "what he will
   * actually sign for" band, as a FRACTION of the estimate. Rank 0 is null —
   * no skill, no estimate shown, same as today.
   */
  MARKET_BAND_PCT: [null, 0.14, 0.07] as (number | null)[],

  /**
   * [TUNE] NEGOTIATION — the "he might sign" band. The owner's brief:
   * *"the negotiating tree should be about signings. Each point up to the 3
   * abilities narrows the uncertainty band."*
   *
   * Indexed by TOTAL RANKS bought anywhere in the Negotiation branch (0..5),
   * so it is literally "each point narrows it", not "one node owns it". The
   * value multiplies lib/negotiation.ts's bandHalfWidthFor() output.
   *
   * WHY THIS BRANCH NEEDED A NEW JOB. bandHalfWidthFor reads scout
   * confidence, and fog is now scoped to draft prospects (lib/scouting.ts), so
   * every free agent negotiates at confidence 100 and the raw band is a
   * constant 12 points below ACCEPT_INTEREST. Constant is the right answer for
   * a man you can fully evaluate — but it left the mechanic with no source of
   * variation at all. Skill is a better source than fog was: it varies by
   * something the GM chose, and it never pretends not to know a rating it can
   * plainly see.
   *
   * At 5 ranks the band is 12 * 0.55 = 6.6 -> 7 points, i.e. 83-90 instead of
   * 78-90. Floored well above zero on purpose: a band that collapses to a
   * point would turn negotiation into a solved equation.
   */
  SIGN_BAND_MULT: [1, 0.92, 0.84, 0.76, 0.66, 0.55],
  /** Absolute floor, in interest points, on the narrowed band. Never zero — see above. */
  SIGN_BAND_MIN: 5,

  /**
   * [TUNE] DEVELOPMENT — how much faster your players get better.
   *
   * The owner asked for "+5% / +10% / +15% exp gained". There is no XP
   * quantity in this game and none was invented: lib/progression.ts models
   * development as an age curve x dev trait x performance roll against the
   * player's potential ceiling, and `speedMult` is a first-class parameter
   * already threaded into the growth mean. These ARE that multiplier, so
   * "+15%" means the growth mean is literally 1.15x. Index 0 is rank 0.
   */
  DEV_SPEED_MULT: [1, 1.05, 1.10, 1.15],

  /**
   * [TUNE] Development Focus charges granted per league year at the capstone
   * rank of Coaching Staff. See Player.devFocus — a per-player growth
   * multiplier that already existed, already fired, and had no way to be
   * granted since the scouting focus-point economy it belonged to was cut.
   * Three is deliberately fewer than a roster: the point is choosing which
   * young player gets the coaching hours.
   */
  DEV_FOCUS_USES_PER_SEASON: 3,
  /** Round-scaled bar a drafted player must clear to count as a hit. Matches lib/gmCareer.ts so two screens never disagree about the same pick. */
  DRAFT_HIT_THRESHOLD: (round: number): number => (round === 1 ? 78 : round <= 3 ? 73 : round <= 5 ? 68 : 64),
};

// ---------------------------------------------------------------------------
// Skill tree
// ---------------------------------------------------------------------------

/**
 * SCOUTING was renamed DRAFT when fog of war was scoped to draft prospects
 * (lib/scouting.ts). The branch's subject did not change — it was always
 * about the board — but "Scouting" now names a room that only matters in the
 * run-up to a draft, and the branch label has to say so.
 */
export type DynastyBranch = 'DRAFT' | 'DEVELOPMENT' | 'NEGOTIATION';

export type DynastySkillId =
  | 'EVALUATIONS'
  | 'POTENTIAL_PROJECTION'
  | 'FILM_ROOM'
  | 'SCOUTING_NETWORK'
  | 'MARKET_KNOWLEDGE'
  | 'TRADE_INTEL'
  | 'INSIDER'
  | 'DEV_INSIGHT'
  | 'AGING_INSIGHT'
  | 'BREAKOUT_WATCH';

export interface DynastySkillDef {
  id: DynastySkillId;
  branch: DynastyBranch;
  name: string;
  /** One line: what it is. */
  blurb: string;
  /** Per-rank cost in skill points and the concrete effect at that rank. */
  ranks: { cost: number; effect: string }[];
}

export const BRANCH_LABEL: Record<DynastyBranch, string> = {
  DRAFT: 'Draft',
  DEVELOPMENT: 'Development',
  NEGOTIATION: 'Negotiation',
};

export const BRANCH_BLURB: Record<DynastyBranch, string> = {
  DRAFT: 'The only men in this league you cannot simply watch on tape. Every upgrade tightens what your staff can tell you about a prospect, and the last one buys more of the visits and evaluations that settle it.',
  DEVELOPMENT: 'Your coaching staff. First the ability to see where a player is headed, then the ability to change it — faster development across the roster, and the hours to put into one man in particular.',
  NEGOTIATION: 'Read the other side of the table. Every point you spend here narrows the window between "he might sign this" and "he will", so you stop overpaying for certainty.',
};

/**
 * Branch render order. Also the order the tree is meant to be READ in, which
 * is why it is declared here rather than left to whatever order a page happens
 * to list.
 */
export const BRANCH_ORDER: DynastyBranch[] = ['DRAFT', 'DEVELOPMENT', 'NEGOTIATION'];

export const DYNASTY_SKILLS: DynastySkillDef[] = [
  // --- SCOUTING ------------------------------------------------------------
  {
    id: 'EVALUATIONS',
    branch: 'SCOUTING',
    name: 'Better Evaluations',
    blurb: 'Your area scouts quote tighter numbers on what a player is right now.',
    ranks: [
      { cost: 1, effect: 'Current-rating ranges narrow by 15%.' },
      { cost: 2, effect: 'Current-rating ranges narrow by 28%.' },
    ],
  },
  {
    id: 'POTENTIAL_PROJECTION',
    branch: 'SCOUTING',
    name: 'Potential Projection',
    blurb: 'Better projection of a ceiling — the hardest read in the building.',
    ranks: [
      { cost: 1, effect: 'Potential ranges narrow by 22%.' },
      { cost: 2, effect: 'Potential ranges narrow by 40%.' },
    ],
  },
  {
    id: 'FILM_ROOM',
    branch: 'SCOUTING',
    name: 'Film Room',
    blurb: 'More hours on tape, on the traits tape is the only way to judge — instincts, awareness, decision making.',
    ranks: [
      { cost: 1, effect: 'Ranges on hard-to-scout mental traits narrow by a further 18%.' },
      { cost: 2, effect: 'Ranges on hard-to-scout mental traits narrow by a further 32%.' },
    ],
  },
  {
    id: 'SCOUTING_NETWORK',
    branch: 'SCOUTING',
    name: 'Scouting Network',
    blurb: `More contacts, more Full Scouts. Every GM starts each league year with ${DYNASTY.FULL_SCOUT_BASE_USES} perfect evaluations; this buys more.`,
    ranks: [
      { cost: 2, effect: `+${DYNASTY.FULL_SCOUT_PER_RANK} Full Scout per season (${DYNASTY.FULL_SCOUT_BASE_USES + DYNASTY.FULL_SCOUT_PER_RANK} total).` },
      { cost: 2, effect: `+${DYNASTY.FULL_SCOUT_PER_RANK * 2} Full Scouts per season (${DYNASTY.FULL_SCOUT_BASE_USES + DYNASTY.FULL_SCOUT_PER_RANK * 2} total).` },
    ],
  },

  // --- NEGOTIATION ---------------------------------------------------------
  {
    id: 'MARKET_KNOWLEDGE',
    branch: 'NEGOTIATION',
    name: 'Market Knowledge',
    blurb: 'Your cap staff estimates what a free agent will actually sign for — not the public market rate you can already see.',
    ranks: [
      { cost: 1, effect: 'Shows an estimated signing band before you make an offer, accurate to about ±14%.' },
      { cost: 2, effect: 'Estimated signing band tightens to about ±7%.' },
    ],
  },
  {
    id: 'TRADE_INTEL',
    branch: 'NEGOTIATION',
    name: 'Trade Intel',
    blurb: 'Your capologist puts real numbers on how a rival values a deal, instead of a bar and a shrug.',
    ranks: [
      { cost: 1, effect: 'Trade evaluations show what the other side values each side of the deal at, and exactly how far short you are. Does NOT change what the AI accepts.' },
    ],
  },
  {
    id: 'INSIDER',
    branch: 'NEGOTIATION',
    name: 'Insider',
    blurb: 'A contact who will tell you what a specific deal would really take.',
    ranks: [
      { cost: 2, effect: `${DYNASTY.INSIDER_USES_PER_SEASON} uses per season. Reveals the asking price on one trade target. Resets each new league year.` },
    ],
  },

  // --- DEVELOPMENT ---------------------------------------------------------
  {
    id: 'DEV_INSIGHT',
    branch: 'DEVELOPMENT',
    name: 'Development Insight',
    blurb: `Where a player on your roster projects in ${DYNASTY.DEV_PROJECTION_YEARS} seasons.`,
    ranks: [
      { cost: 1, effect: `Shows a ${DYNASTY.DEV_PROJECTION_YEARS}-year projected rating, ±${DYNASTY.DEV_PROJECTION_BAND[1]}.` },
      { cost: 2, effect: `Projection tightens to ±${DYNASTY.DEV_PROJECTION_BAND[2]}.` },
    ],
  },
  {
    id: 'AGING_INSIGHT',
    branch: 'DEVELOPMENT',
    name: 'Aging Insight',
    blurb: 'A read on when a veteran starts sliding, before the tape shows it.',
    ranks: [
      { cost: 1, effect: `Estimates the age decline begins, ±${DYNASTY.AGING_BAND_YEARS} years.` },
    ],
  },
  {
    id: 'BREAKOUT_WATCH',
    branch: 'DEVELOPMENT',
    name: 'Breakout Watch',
    blurb: 'Your staff flags young players they think are about to jump.',
    ranks: [
      { cost: 1, effect: `Flags up to ${DYNASTY.BREAKOUT_MAX_FLAGS} players on your roster who look ready to improve. A flag is an opinion, not a promise.` },
    ],
  },
];

export const SKILL_BY_ID: Record<DynastySkillId, DynastySkillDef> = Object.fromEntries(
  DYNASTY_SKILLS.map((s) => [s.id, s]),
) as Record<DynastySkillId, DynastySkillDef>;

export type SkillRanks = Partial<Record<DynastySkillId, number>>;

export function rankOf(skills: SkillRanks, id: DynastySkillId): number {
  const def = SKILL_BY_ID[id];
  return clamp(Math.floor(skills[id] ?? 0), 0, def ? def.ranks.length : 0);
}

/** Total points a set of purchased ranks cost. Used to reconcile spend against grants. */
export function pointsSpent(skills: SkillRanks): number {
  let total = 0;
  for (const def of DYNASTY_SKILLS) {
    const r = rankOf(skills, def.id);
    for (let i = 0; i < r; i++) total += def.ranks[i].cost;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Level curve
// ---------------------------------------------------------------------------

/** XP required to go from `level` to `level + 1`. */
export function xpToNextLevel(level: number): number {
  if (level >= DYNASTY.MAX_LEVEL) return Infinity;
  return Math.round(DYNASTY.LEVEL_BASE * Math.pow(Math.max(1, level), DYNASTY.LEVEL_EXPONENT));
}

/** Cumulative XP required to BE at `level`. Level 1 is 0. */
export function xpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < Math.min(level, DYNASTY.MAX_LEVEL); l++) total += xpToNextLevel(l);
  return total;
}

export interface LevelProgress {
  level: number;
  xp: number;
  /** XP accumulated inside the current level. */
  xpIntoLevel: number;
  /** XP the current level costs in total. Infinity at MAX_LEVEL. */
  xpForThisLevel: number;
  /** 0..1 for the progress bar. 1 at MAX_LEVEL. */
  progress: number;
  atMax: boolean;
}

export function levelFromXp(xp: number): LevelProgress {
  const safeXp = Math.max(0, Math.floor(xp));
  let level = 1;
  let consumed = 0;
  while (level < DYNASTY.MAX_LEVEL) {
    const need = xpToNextLevel(level);
    if (safeXp - consumed < need) break;
    consumed += need;
    level++;
  }
  const atMax = level >= DYNASTY.MAX_LEVEL;
  const xpForThisLevel = atMax ? Infinity : xpToNextLevel(level);
  const xpIntoLevel = safeXp - consumed;
  return {
    level,
    xp: safeXp,
    xpIntoLevel,
    xpForThisLevel,
    progress: atMax ? 1 : clamp(xpIntoLevel / xpForThisLevel, 0, 1),
    atMax,
  };
}

/** Total skill points granted by reaching `level`. */
export function skillPointsAtLevel(level: number): number {
  let points = 0;
  for (const l of DYNASTY.SKILL_POINT_LEVELS) if (level >= l) points++;
  const last = DYNASTY.SKILL_POINT_LEVELS[DYNASTY.SKILL_POINT_LEVELS.length - 1] ?? 0;
  if (level > last) points += Math.floor((level - last) / DYNASTY.SKILL_POINT_EVERY_AFTER);
  return points;
}

/** The next level that grants a skill point, or null past the ladder's practical end. */
export function nextSkillPointLevel(level: number): number | null {
  for (const l of DYNASTY.SKILL_POINT_LEVELS) if (l > level) return l;
  const last = DYNASTY.SKILL_POINT_LEVELS[DYNASTY.SKILL_POINT_LEVELS.length - 1] ?? 0;
  const steps = Math.floor((level - last) / DYNASTY.SKILL_POINT_EVERY_AFTER) + 1;
  const next = last + steps * DYNASTY.SKILL_POINT_EVERY_AFTER;
  return next <= DYNASTY.MAX_LEVEL ? next : null;
}

// ---------------------------------------------------------------------------
// XP — derived from franchise history
// ---------------------------------------------------------------------------

export interface XpLine {
  label: string;
  detail: string;
  xp: number;
}

export interface DynastyXpBreakdown {
  total: number;
  lines: XpLine[];
  /** Completed seasons the GM has actually been on the job for. */
  seasons: number;
  wins: number;
  losses: number;
}

/**
 * Exported so lib/leaderboard.ts counts the SAME awards this file does. The
 * board recomputes XP in a batch rather than per league, and a second copy of
 * this list is exactly how a leaderboard number and a Dynasty screen number
 * start disagreeing about the same franchise.
 */
export const AWARD_TYPES = ['AWARD_MVP', 'AWARD_OPOY', 'AWARD_DPOY', 'AWARD_ROTY', 'AWARD_SBMVP'];

interface XpInputs {
  /** One row per completed season the user was GM for. */
  seasons: { year: number; wins: number; losses: number; ties: number; playoffResult: string }[];
  /** Games already banked in a season that has no TeamSeasonRecord row yet. */
  inProgress: { wins: number; losses: number } | null;
  awards: number;
  picks: { round: number; trueOvr: number }[];
}

/**
 * The whole XP model, as a pure function. Kept separate from the query layer
 * so it can be unit-tested and so the exact same arithmetic can be replayed
 * against synthetic history.
 */
export function computeDynastyXp(input: XpInputs): DynastyXpBreakdown {
  const lines: XpLine[] = [];
  const push = (label: string, detail: string, xp: number) => {
    if (xp <= 0) return;
    lines.push({ label, detail, xp: Math.round(xp) });
  };

  const completedWins = input.seasons.reduce((a, s) => a + s.wins, 0);
  const completedLosses = input.seasons.reduce((a, s) => a + s.losses, 0);
  const wins = completedWins + (input.inProgress?.wins ?? 0);
  const losses = completedLosses + (input.inProgress?.losses ?? 0);

  push('Regular season wins', `${wins} win${wins === 1 ? '' : 's'} at ${DYNASTY.XP.REGULAR_SEASON_WIN} XP each`, wins * DYNASTY.XP.REGULAR_SEASON_WIN);

  // Playoff depth, one payout per completed season.
  const byResult = new Map<string, number>();
  for (const s of input.seasons) byResult.set(s.playoffResult, (byResult.get(s.playoffResult) ?? 0) + 1);
  const RESULT_LABEL: Record<string, string> = {
    WILDCARD: 'Playoff berths (lost wild card)',
    DIVISIONAL: 'Divisional round runs',
    CONFERENCE: 'Conference championship runs',
    RUNNER_UP: 'Championship game appearances',
    CHAMPION: 'CHAMPIONSHIPS',
  };
  for (const key of ['CHAMPION', 'RUNNER_UP', 'CONFERENCE', 'DIVISIONAL', 'WILDCARD']) {
    const n = byResult.get(key) ?? 0;
    if (n === 0) continue;
    const each = DYNASTY.XP.PLAYOFF_RESULT[key] ?? 0;
    push(RESULT_LABEL[key], `${n} × ${each} XP`, n * each);
  }

  push('Major awards', `${input.awards} won by your players × ${DYNASTY.XP.MAJOR_AWARD} XP`, input.awards * DYNASTY.XP.MAJOR_AWARD);

  let hits = 0;
  let stars = 0;
  for (const p of input.picks) {
    if (p.trueOvr >= DYNASTY.DRAFT_HIT_THRESHOLD(p.round)) hits++;
    if (p.trueOvr >= DYNASTY.XP.DRAFT_STAR_OVR) stars++;
  }
  push('Draft hits', `${hits} of ${input.picks.length} picks became contributors`, hits * DYNASTY.XP.DRAFT_HIT);
  push('Draft stars', `${stars} pick${stars === 1 ? '' : 's'} became a ${DYNASTY.XP.DRAFT_STAR_OVR}+ player`, stars * DYNASTY.XP.DRAFT_STAR);

  // One-time milestones.
  const madePlayoffs = input.seasons.some((s) => s.playoffResult !== 'MISSED');
  const wonTitle = input.seasons.some((s) => s.playoffResult === 'CHAMPION');
  if (madePlayoffs) push('Milestone', 'First playoff berth', DYNASTY.XP.FIRST_PLAYOFF_BERTH);
  if (wonTitle) push('Milestone', 'First championship', DYNASTY.XP.FIRST_CHAMPIONSHIP);

  const seasons = input.seasons.length;
  for (const rung of DYNASTY.XP.TENURE_LADDER) {
    if (seasons >= rung.seasons) push('Milestone', `${rung.seasons} seasons on the job`, rung.xp);
  }
  for (const rung of DYNASTY.XP.WIN_LADDER) {
    if (wins >= rung.wins) push('Milestone', `${rung.wins} career wins`, rung.xp);
  }

  const total = lines.reduce((a, l) => a + l.xp, 0);
  return { total, lines, seasons, wins, losses };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface DynastyProfileRow {
  id: string;
  skills: string;
  fullScoutYear: number;
  fullScoutUsed: number;
  insiderYear: number;
  insiderUsed: number;
}

/**
 * Get-or-create the league's profile row. The (ownerKind, ownerKey) pair is
 * the real key — leagueId is a convenience relation — so moving to
 * account-wide progression later means changing this resolver and nothing
 * else. Every read path goes through here, so an old save gets its row the
 * first time it opens the Dynasty screen, with zero spent points.
 */
export async function loadDynastyProfile(leagueId: string): Promise<DynastyProfileRow> {
  const existing = await prisma.dynastyProfile.findUnique({ where: { leagueId } });
  if (existing) return existing;
  // A concurrent first render can race here; the unique constraint decides
  // the winner and the loser just re-reads. If the write is impossible
  // altogether (a read-only replica, a build-time prerender) fall back to an
  // in-memory default rather than blowing up a page: a GM with no profile row
  // has no skills and no charges spent, which is exactly what this describes.
  try {
    return await prisma.dynastyProfile.create({
      data: { ownerKind: 'LEAGUE', ownerKey: leagueId, leagueId },
    });
  } catch {
    const raced = await prisma.dynastyProfile.findUnique({ where: { leagueId } }).catch(() => null);
    return raced ?? { id: '', skills: '{}', fullScoutYear: 0, fullScoutUsed: 0, insiderYear: 0, insiderUsed: 0 };
  }
}

export function parseSkills(raw: string | null | undefined): SkillRanks {
  const obj = readJson<Record<string, unknown>>(raw ?? null, {});
  const out: SkillRanks = {};
  for (const def of DYNASTY_SKILLS) {
    const v = obj[def.id];
    if (typeof v === 'number' && v > 0) out[def.id] = clamp(Math.floor(v), 0, def.ranks.length);
  }
  return out;
}

export function serializeSkills(skills: SkillRanks): string {
  return writeJson(skills);
}

// ---------------------------------------------------------------------------
// The state every Dynasty-aware surface reads
// ---------------------------------------------------------------------------

export interface LimitedUse {
  unlocked: boolean;
  max: number;
  used: number;
  remaining: number;
}

export interface DynastyState {
  leagueId: string;
  seasonYear: number;
  level: LevelProgress;
  breakdown: DynastyXpBreakdown;
  skills: SkillRanks;
  pointsEarned: number;
  pointsSpent: number;
  pointsAvailable: number;
  nextPointAtLevel: number | null;
  /** Perfect evaluations left this league year. Baseline 2, plus Scouting Network. */
  fullScout: LimitedUse;
  insider: LimitedUse;
  /** The league year XP is being counted from — the season the GM took the job. */
  tenureStartYear: number;
}

function limitedUse(unlocked: boolean, max: number, storedYear: number, storedUsed: number, seasonYear: number): LimitedUse {
  // A stored counter from a previous league year is stale by definition —
  // treated as zero on read, and overwritten on the next spend. This is what
  // makes "resets on a new season" work with no season hook.
  const used = storedYear === seasonYear ? clamp(storedUsed, 0, max) : 0;
  return { unlocked, max, used, remaining: unlocked ? Math.max(0, max - used) : 0 };
}

/**
 * Everything about the GM's progression, derived fresh. One call, a handful
 * of queries. Safe to call from any server component.
 */
export async function buildDynastyState(leagueId: string): Promise<DynastyState> {
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: leagueId },
    select: { id: true, seasonYear: true, startYear: true, userTeamId: true },
  });
  const tenureStartYear = await resolveStartYear(league);
  const profile = await loadDynastyProfile(leagueId);
  const skills = parseSkills(profile.skills);

  let breakdown: DynastyXpBreakdown = { total: 0, lines: [], seasons: 0, wins: 0, losses: 0 };

  if (league.userTeamId) {
    const teamId = league.userTeamId;
    const [team, seasons, awards, picks] = await Promise.all([
      prisma.team.findUnique({ where: { id: teamId }, select: { wins: true, losses: true } }),
      // `year >= tenureStartYear` is load-bearing. A new league is seeded with
      // up to two decades of invented backstory (lib/gen/leagueHistory.ts)
      // whose TeamSeasonRecord rows sit BEFORE the founding year. Counting
      // those would hand a brand-new save a dozen levels for titles the user
      // did not win.
      prisma.teamSeasonRecord.findMany({
        where: { teamId, year: { gte: tenureStartYear } },
        select: { year: true, wins: true, losses: true, ties: true, playoffResult: true },
        orderBy: { year: 'asc' },
      }),
      prisma.transaction.count({
        where: { leagueId, teamId, type: { in: AWARD_TYPES }, seasonYear: { gte: tenureStartYear } },
      }),
      prisma.draftPick.findMany({
        where: { leagueId, ownerTeamId: teamId, used: true, playerId: { not: null }, year: { gte: tenureStartYear } },
        select: { round: true, player: { select: { trueOvr: true } } },
      }),
    ]);

    const hasCurrentRow = seasons.some((s) => s.year === league.seasonYear);
    const played = (team?.wins ?? 0) + (team?.losses ?? 0);
    breakdown = computeDynastyXp({
      seasons,
      inProgress: !hasCurrentRow && played > 0 ? { wins: team!.wins, losses: team!.losses } : null,
      awards,
      picks: picks.filter((p) => p.player).map((p) => ({ round: p.round, trueOvr: p.player!.trueOvr })),
    });
  }

  const level = levelFromXp(breakdown.total);
  const earned = skillPointsAtLevel(level.level);
  const spent = pointsSpent(skills);

  return {
    leagueId,
    seasonYear: league.seasonYear,
    level,
    breakdown,
    skills,
    pointsEarned: earned,
    pointsSpent: spent,
    // Draft-hit XP is measured off a player's CURRENT rating, so a total can
    // in principle drift down (a drafted star ages out of the hit threshold).
    // Purchased ranks are never revoked for that; the available pool simply
    // floors at zero.
    pointsAvailable: Math.max(0, earned - spent),
    nextPointAtLevel: nextSkillPointLevel(level.level),
    fullScout: limitedUse(
      // Always unlocked — this is an entitlement every GM has, not a purchase.
      true,
      fullScoutMax(skills),
      profile.fullScoutYear, profile.fullScoutUsed, league.seasonYear,
    ),
    insider: limitedUse(
      rankOf(skills, 'INSIDER') > 0,
      DYNASTY.INSIDER_USES_PER_SEASON,
      profile.insiderYear, profile.insiderUsed, league.seasonYear,
    ),
    tenureStartYear,
  };
}

// ---------------------------------------------------------------------------
// Effect accessors — the ONLY interface other systems use
// ---------------------------------------------------------------------------

/**
 * What lib/scouting.ts's buildScoutedView accepts. Deliberately dumb: two
 * multipliers and a floor, so a caller that knows nothing about the Dynasty
 * system can be handed `undefined` and behave exactly as it does today.
 */
export interface DynastyScoutMods {
  attrBandMult: number;
  potBandMult: number;
  /** Extra multiplier for attributes at/above `hardAttrDifficulty`. */
  hardAttrBandMult: number;
  hardAttrDifficulty: number;
  minHalfWidth: number;
}

export function scoutingModsFor(skills: SkillRanks): DynastyScoutMods {
  return {
    attrBandMult: DYNASTY.ATTR_BAND_MULT[rankOf(skills, 'EVALUATIONS')] ?? 1,
    potBandMult: DYNASTY.POT_BAND_MULT[rankOf(skills, 'POTENTIAL_PROJECTION')] ?? 1,
    hardAttrBandMult: DYNASTY.HARD_ATTR_BAND_MULT[rankOf(skills, 'FILM_ROOM')] ?? 1,
    hardAttrDifficulty: DYNASTY.HARD_ATTR_DIFFICULTY,
    minHalfWidth: DYNASTY.MIN_BAND_HALF_WIDTH,
  };
}

/**
 * Full Scouts available in a league year: the baseline entitlement every GM
 * has plus whatever Scouting Network adds. Single source of truth — the
 * server action re-derives the cap from this, so a client cannot ask for a
 * charge it does not have.
 */
export function fullScoutMax(skills: SkillRanks): number {
  return DYNASTY.FULL_SCOUT_BASE_USES + rankOf(skills, 'SCOUTING_NETWORK') * DYNASTY.FULL_SCOUT_PER_RANK;
}

/** Convenience for a server component that just wants the mods. */
export async function loadScoutMods(leagueId: string): Promise<DynastyScoutMods> {
  const profile = await loadDynastyProfile(leagueId);
  return scoutingModsFor(parseSkills(profile.skills));
}

/**
 * Market Knowledge: half-width, in dollars, of the "he'll sign for about
 * this" band around an estimate. Returns null when the skill is not owned,
 * which is the signal to render nothing at all.
 */
export function marketBandFor(skills: SkillRanks, estimate: number): number | null {
  const pct = DYNASTY.MARKET_BAND_PCT[rankOf(skills, 'MARKET_KNOWLEDGE')];
  if (pct == null) return null;
  return Math.round(estimate * pct);
}

export function hasTradeIntel(skills: SkillRanks): boolean {
  return rankOf(skills, 'TRADE_INTEL') > 0;
}


// ---------------------------------------------------------------------------
// Development branch — projections
// ---------------------------------------------------------------------------

/** Annual OVR drift for a player of this age/position/dev trait, from the same curve the real engine uses. */
function annualDrift(age: number, position: string, devTrait: string): number {
  const profile = POSITION_AGE_PROFILE[position as Position] ?? DEFAULT_AGE_PROFILE;
  const shifted = age - profile.peakShift;
  const band = AGE_CURVE.find((b) => shifted <= b.maxAge) ?? AGE_CURVE[AGE_CURVE.length - 1];
  const raw = band.growth;
  if (raw >= 0) return raw * (DEV_TRAIT_MULT[devTrait] ?? 1);
  return raw * profile.declineMult;
}

/** First age at which this player's modelled drift turns negative. */
export function declineOnsetAge(position: string, devTrait: string, fromAge: number): number {
  for (let age = Math.max(fromAge, 21); age <= 40; age++) {
    if (annualDrift(age, position, devTrait) < 0) return age;
  }
  return 40;
}

export interface DevProjection {
  /** Center of the projected rating in DYNASTY.DEV_PROJECTION_YEARS seasons. */
  center: number;
  low: number;
  high: number;
  years: number;
}

/**
 * A DELIBERATELY IMPERFECT forward projection. The center is the age curve
 * applied to the player's scouted rating (not his true one) plus a seeded
 * wobble, and it is always returned as a band. A GM with rank 2 gets a
 * tighter band, never a correct answer — the same principle as scouting.
 */
export function projectDevelopment(args: {
  skills: SkillRanks;
  seed: string;
  /** The rating the GM can actually see, not trueOvr. */
  scoutedOvr: number;
  age: number;
  position: string;
  /** Only pass a revealed trait. Pass 'Normal' when the trait is still hidden. */
  devTrait: string;
  potentialCeiling: number;
}): DevProjection | null {
  const band = DYNASTY.DEV_PROJECTION_BAND[rankOf(args.skills, 'DEV_INSIGHT')];
  if (band == null) return null;

  const rng = new Rng(`${args.seed}:devproj`);
  const years = DYNASTY.DEV_PROJECTION_YEARS;
  let ovr = args.scoutedOvr;
  for (let i = 0; i < years; i++) {
    const drift = annualDrift(args.age + i, args.position, args.devTrait);
    ovr = Math.min(args.potentialCeiling, ovr + drift);
  }
  // The staff's read is off-center by up to about half the quoted band —
  // an "informed but not omniscient" projection.
  const center = clamp(Math.round(ovr + rng.normal(0, band * 0.5)), 20, 99);
  return {
    center,
    low: clamp(Math.round(center - band), 20, 99),
    high: clamp(Math.round(center + band), 20, 99),
    years,
  };
}

export interface AgingRead {
  centerAge: number;
  lowAge: number;
  highAge: number;
}

export function readAging(args: {
  skills: SkillRanks;
  seed: string;
  age: number;
  position: string;
  devTrait: string;
}): AgingRead | null {
  if (rankOf(args.skills, 'AGING_INSIGHT') === 0) return null;
  const rng = new Rng(`${args.seed}:aging`);
  const onset = declineOnsetAge(args.position, args.devTrait, 21);
  const centerAge = clamp(Math.round(onset + rng.normal(0, DYNASTY.AGING_BAND_YEARS * 0.6)), 22, 40);
  return {
    centerAge,
    lowAge: Math.round(centerAge - DYNASTY.AGING_BAND_YEARS),
    highAge: Math.round(centerAge + DYNASTY.AGING_BAND_YEARS),
  };
}

export interface BreakoutFlag {
  playerId: string;
  name: string;
  position: string;
  age: number;
  /** 0..1 — the staff's confidence in the call, shown as a word, not a number. */
  score: number;
  note: string;
}

/**
 * Breakout Watch. Seeded on (leagueId, seasonYear, playerId) so the same
 * flags come back on every reload of the same week — a watchlist that
 * reshuffled on refresh would be worthless — and so nothing here is farmable
 * by reloading.
 *
 * Reads headroom (scouted rating vs scouted ceiling) and age, never trueOvr.
 * It is an opinion: BREAKOUT_MIN_SCORE is set so some flagged players will
 * not improve and some unflagged ones will.
 */
export function flagBreakouts(args: {
  skills: SkillRanks;
  leagueId: string;
  seasonYear: number;
  roster: {
    id: string; name: string; position: string; age: number;
    scoutedOvr: number; potHigh: number; devTraitRevealed: string | null;
  }[];
}): BreakoutFlag[] {
  if (rankOf(args.skills, 'BREAKOUT_WATCH') === 0) return [];
  const out: BreakoutFlag[] = [];
  for (const p of args.roster) {
    if (p.age > DYNASTY.BREAKOUT_MAX_AGE) continue;
    const headroom = clamp((p.potHigh - p.scoutedOvr) / 20, 0, 1);
    const youth = clamp((DYNASTY.BREAKOUT_MAX_AGE + 1 - p.age) / 5, 0, 1);
    const traitBoost = p.devTraitRevealed ? clamp(((DEV_TRAIT_MULT[p.devTraitRevealed] ?? 1) - 1) / 1.1, 0, 1) : 0;
    const rng = new Rng(`${args.leagueId}:${args.seasonYear}:breakout:${p.id}`);
    const score = clamp(0.55 * headroom + 0.25 * youth + 0.2 * traitBoost + rng.normal(0, 0.12), 0, 1);
    if (score < DYNASTY.BREAKOUT_MIN_SCORE) continue;
    out.push({
      playerId: p.id,
      name: p.name,
      position: p.position,
      age: p.age,
      score,
      note: score >= 0.75
        ? 'Staff is adamant he takes a jump this year.'
        : 'A few people in the building like him to step forward.',
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, DYNASTY.BREAKOUT_MAX_FLAGS);
}
