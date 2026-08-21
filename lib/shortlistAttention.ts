import { prisma } from './db';
import { Rng, clamp } from './rng';
import { readJson, writeJson } from './json';
import { observe, scoutNote } from './scouting';
import { DYNASTY, loadScoutMods } from './dynasty';
import { POSITION_GROUP, SCOUTING, SHORTLIST_ATTENTION } from './tuning';
import type { Position } from './tuning';
import type { AttrMap } from './ratings';

/**
 * ===========================================================================
 * SHORTLIST ATTENTION — the only ongoing scouting input there is
 * ===========================================================================
 * There is no button here and there is nothing to spend. Your staff works the
 * players you have starred, every week, for free, forever. The single decision
 * the system asks for is HOW MANY players to star.
 *
 * A fixed weekly pool of attention is split across the shortlist. Star five
 * prospects and each of them gets a fifth of everything your department can
 * do; star sixty and you learn a little about a lot. That trade-off is the
 * gameplay. Nothing is deducted, nothing runs out, and advancing a week
 * without opening a screen never costs you anything — which is exactly what
 * the focus-point economy this replaces got wrong.
 *
 * TWO KINDS OF DIMINISHING RETURNS, both deliberate:
 *
 *   1. Within a week, each pass closes a FRACTION of what is still unknown.
 *      Week two on the same prospect therefore teaches less than week one did,
 *      with no separate decay term needed — there is simply less left.
 *   2. A hard ceiling below 100. A prospect starred from week one all season
 *      converges toward CONFIDENCE_CEILING and stops. He never becomes a
 *      certainty, because certainty is what a private workout and the Dynasty
 *      Full Scout charge are for, and those are scarce on purpose.
 *
 * This does NOT build a second reveal path. It writes the same ScoutingReport
 * columns everything else reads and re-samples observations through
 * lib/scouting.ts's observe(), so a shortlisted prospect's numbers drift
 * toward truth through the exact machinery that has always moved them.
 *
 * TUNING lives in lib/tuning.ts's SHORTLIST_ATTENTION block, with every other
 * balance number in the game — including the measured star-count/confidence
 * table that IS this system's design.
 * ===========================================================================
 */

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export interface AttentionScout {
  accuracy: number;
  speed: number;
  specialty: string;
}

/**
 * What the department can actually cover in a week, as a multiplier on the
 * pool. Headcount is discounted geometrically for the same reason the old
 * economy discounted it — a fifth area scout is real coverage, but not a
 * fifth of a department's worth.
 */
export function staffThroughput(scouts: AttentionScout[]): number {
  if (scouts.length === 0) return SHORTLIST_ATTENTION.STAFF_MIN;
  const contributions = scouts
    .map((s) => clamp(s.speed, 0, 100) / 100)
    .sort((a, b) => b - a);
  const total = contributions.reduce(
    (acc, c, i) => acc + c * Math.pow(SHORTLIST_ATTENTION.STAFF_HEADCOUNT_DECAY, i),
    0,
  );
  return Math.max(SHORTLIST_ATTENTION.STAFF_MIN, total);
}

/**
 * Best available accuracy in the building, on observe()'s 0-100 scale. A team
 * with no scouts at all reads as 40, the same stand-in the old economy used
 * for an empty department — the GM watches tape himself and is not very good
 * at it.
 */
export function bestAccuracy(scouts: AttentionScout[]): number {
  if (scouts.length === 0) return 40;
  return scouts.reduce((m, s) => Math.max(m, clamp(s.accuracy, 0, 100)), 0);
}

/** Best available accuracy in the building, as a throughput multiplier. */
export function staffQuality(scouts: AttentionScout[]): number {
  const [lo, hi] = SHORTLIST_ATTENTION.STAFF_QUALITY_RANGE;
  return lo + (hi - lo) * (bestAccuracy(scouts) / 100);
}

function specialtyMatch(scouts: AttentionScout[], position: string): boolean {
  const group = POSITION_GROUP[position as Position];
  return scouts.some((s) => s.specialty === 'ALL' || s.specialty === group);
}

/**
 * Dynasty scouting-branch throughput bonus, derived from the SAME published
 * mods lib/scouting.ts consumes (scoutingModsFor) rather than from a second
 * reading of the skill tree — the band multipliers stay the one interface
 * between Dynasty and scouting. A fully-invested branch works a shortlist
 * modestly faster on top of quoting tighter ranges.
 *
 * Normalised against the tree's OWN maximum tightening rather than against 1,
 * so DYNASTY_MAX_GAIN is the gain a maxed branch actually gets. Reading the
 * raw multipliers instead would top out around +5% while the constant claimed
 * +14%, which is exactly the kind of number that stops meaning what it says.
 */
export function dynastyThroughput(mods: { attrBandMult: number; potBandMult: number }): number {
  const tightening = (m: number[]) => 1 - (m[m.length - 1] ?? 1);
  const ceiling = (tightening(DYNASTY.ATTR_BAND_MULT) + tightening(DYNASTY.POT_BAND_MULT)) / 2;
  if (ceiling <= 0) return 1;
  const invested = clamp((((1 - mods.attrBandMult) + (1 - mods.potBandMult)) / 2) / ceiling, 0, 1);
  return 1 + invested * SHORTLIST_ATTENTION.DYNASTY_MAX_GAIN;
}

// ---------------------------------------------------------------------------
// The split — one implementation, shared by the weekly pass and the screen
// ---------------------------------------------------------------------------

/**
 * How a week of attention divides, for one team, right now.
 *
 * THIS EXISTS SO THE NUMBER ON SCREEN IS THE NUMBER THAT GETS APPLIED. The
 * scouting page has to quote the per-player share BEFORE a week is advanced,
 * and the weekly pass has to apply it during one. Two implementations of the
 * same division is exactly the lying-metric shape this codebase keeps having
 * to fix, so there is one: `applyShortlistAttention` builds a plan and works
 * off it, and any screen quoting a share builds the same plan from the same
 * inputs and reads the same fields.
 */
export interface AttentionPlan {
  /** Draft prospects currently starred. The divisor, and the whole decision. */
  shortlisted: number;
  /** Staff headcount x staff quality x Dynasty branch, as a multiplier on the pool. */
  throughput: number;
  /** WEEKLY_POOL / shortlisted x throughput. The even split, before any specialty bonus. */
  unitsEach: number;
  scouts: AttentionScout[];
}

export function attentionPlan(
  scouts: AttentionScout[],
  mods: { attrBandMult: number; potBandMult: number },
  shortlisted: number,
): AttentionPlan {
  const throughput = staffThroughput(scouts) * staffQuality(scouts) * dynastyThroughput(mods);
  return {
    shortlisted,
    throughput,
    unitsEach: shortlisted > 0 ? (SHORTLIST_ATTENTION.WEEKLY_POOL / shortlisted) * throughput : 0,
    scouts,
  };
}

/**
 * What ONE prospect gets out of that split: the even share times his own
 * specialty bonus. Two starred players can differ here and the difference is
 * real — it is the number that produces his confidence move.
 */
export function unitsFor(plan: AttentionPlan, position: string): { units: number; specialtyCovered: boolean } {
  const covered = specialtyMatch(plan.scouts, position);
  return {
    units: plan.unitsEach * (covered ? SHORTLIST_ATTENTION.SPECIALTY_BONUS : 1),
    specialtyCovered: covered,
  };
}

/** Share of the REMAINING gap one week of `units` closes. */
export function weeklyClose(units: number): number {
  return clamp(units * SHORTLIST_ATTENTION.CLOSE_PER_UNIT, 0, SHORTLIST_ATTENTION.MAX_WEEKLY_CLOSE);
}

/** Where a file sits after one week of `units`, on the general read. */
export function confidenceAfterWeek(before: number, units: number): number {
  const ceiling = SHORTLIST_ATTENTION.CONFIDENCE_CEILING;
  if (before >= ceiling) return before;
  return before + (ceiling - before) * weeklyClose(units);
}

/**
 * Read the plan a screen should quote: the team's real staff, the real
 * Dynasty mods, and the real count of STARRED DRAFT PROSPECTS — the same
 * filter the weekly pass applies, so a stale star on a player drafted last
 * spring is excluded from the divisor here exactly as it is there.
 */
export async function loadAttentionPlan(leagueId: string, teamId: string): Promise<AttentionPlan> {
  const [scouts, mods, entries] = await Promise.all([
    prisma.scout.findMany({ where: { teamId }, select: { accuracy: true, speed: true, specialty: true } }),
    loadScoutMods(leagueId),
    prisma.shortlistEntry.findMany({
      where: { teamId },
      select: { player: { select: { isDraftee: true, leagueId: true } } },
    }),
  ]);
  const shortlisted = entries.filter((e) => e.player && e.player.leagueId === leagueId && e.player.isDraftee).length;
  return attentionPlan(scouts, mods, shortlisted);
}

// ---------------------------------------------------------------------------
// The weekly pass
// ---------------------------------------------------------------------------

export interface AttentionShare {
  playerId: string;
  name: string;
  position: string;
  /**
   * Attention units this player actually received this week — the even split
   * times his own specialty bonus, NOT the raw split. Two starred players can
   * differ here, and the difference is real: this is the number that produced
   * the confidence move on the same row, so it is the one a screen may quote.
   */
  units: number;
  /** True when a scout whose specialty covers his position group worked him. */
  specialtyCovered: boolean;
  confidenceBefore: number;
  confidenceAfter: number;
  /** True once he is within a point of the ceiling — his file is as good as watching alone gets. */
  atCeiling: boolean;
}

export interface AttentionSummary {
  teamId: string | null;
  shortlisted: number;
  /**
   * The even split: pool / shortlist size, after staff and Dynasty scaling and
   * before any per-player specialty bonus. This is the number that expresses
   * the trade-off ("star more, learn less each"); `AttentionShare.units` is
   * what an individual player actually got.
   */
  unitsEach: number;
  shares: AttentionShare[];
}

const EMPTY: AttentionSummary = { teamId: null, shortlisted: 0, unitsEach: 0, shares: [] };

/**
 * Run one week of shortlist attention for the user's team.
 *
 * USER TEAM ONLY. AI front offices draft off true ratings (lib/draft.ts), so
 * giving them scouting reports would cost a query per team per week and change
 * nothing about a single pick they make.
 *
 * Idempotent enough to be safe on a replayed week: attention closes a fraction
 * of a remaining gap that has already shrunk, so running it twice is worth
 * less than running it once, never more, and it can never push past the
 * ceiling.
 */
export async function applyShortlistAttention(
  leagueId: string,
  seasonYear: number,
  week: number,
  seed: string,
): Promise<AttentionSummary> {
  const team = await prisma.team.findFirst({
    where: { leagueId, isUser: true },
    select: { id: true },
  });
  if (!team) return EMPTY;

  const entries = await prisma.shortlistEntry.findMany({
    where: { teamId: team.id },
    select: {
      playerId: true,
      player: {
        select: {
          id: true, firstName: true, lastName: true, position: true,
          trueAttrs: true, potential: true, isDraftee: true, leagueId: true,
        },
      },
    },
  });

  // Only prospects. A star left on a player who was drafted last spring is a
  // stale row, and letting it hold a slice of the pool would quietly tax the
  // user for never tidying his board.
  const targets = entries
    .map((e) => e.player)
    .filter((p) => p && p.leagueId === leagueId && p.isDraftee);
  if (targets.length === 0) return { ...EMPTY, teamId: team.id };

  const [scouts, mods, reports] = await Promise.all([
    prisma.scout.findMany({ where: { teamId: team.id }, select: { accuracy: true, speed: true, specialty: true } }),
    loadScoutMods(leagueId),
    prisma.scoutingReport.findMany({
      where: { teamId: team.id, playerId: { in: targets.map((p) => p!.id) } },
    }),
  ]);
  const reportByPlayer = new Map(reports.map((r) => [r.playerId, r]));

  // The split is the mechanic, so it is computed ONCE — by the same
  // attentionPlan() the scouting screen calls to quote it — and applied
  // verbatim. The figure a screen shows next to a starred player is this
  // number and not a prettied-up version of it.
  const plan = attentionPlan(scouts, mods, targets.length);
  const { unitsEach } = plan;

  const shares: AttentionShare[] = [];
  const writes: Promise<unknown>[] = [];

  for (const p of targets) {
    if (!p) continue;
    const report = reportByPlayer.get(p.id);
    // A finished file cannot be improved and a Full Scout must never be
    // walked back by a passive tick.
    if (report?.fullyRevealed) continue;

    const before = report?.confidence ?? SCOUTING.ROOKIE_BASE_CONFIDENCE;
    const { units, specialtyCovered: matched } = unitsFor(plan, p.position);
    const close = weeklyClose(units);

    const ceiling = SHORTLIST_ATTENTION.CONFIDENCE_CEILING;
    const after = confidenceAfterWeek(before, units);

    const potCeiling = SHORTLIST_ATTENTION.POT_CONFIDENCE_CEILING;
    const potBefore = Math.max(report?.potConfidence ?? 0, 0);
    const potAfter = potBefore >= potCeiling
      ? potBefore
      : potBefore + (potCeiling - potBefore) * close * SHORTLIST_ATTENTION.POT_CLOSE_SHARE;

    const confidence = Math.round(after);
    const potConfidence = Math.round(potAfter);

    shares.push({
      playerId: p.id,
      name: `${p.firstName} ${p.lastName}`,
      position: p.position,
      units,
      specialtyCovered: matched,
      confidenceBefore: Math.round(before),
      confidenceAfter: confidence,
      atCeiling: confidence >= ceiling - 1,
    });

    // Nothing changed worth a write — a shortlist deep enough to round to zero
    // still teaches something eventually, but not this week.
    if (confidence <= Math.round(before) && potConfidence <= Math.round(potBefore)) continue;

    // Re-sampled through the same observe() every other reveal path uses, so
    // the center drifts toward truth as the range tightens instead of a
    // stale low-confidence observation sitting under a high-confidence band.
    const rng = new Rng(`shortlist-${seed}-${team.id}-${p.id}-${seasonYear}-${week}`);
    const observed = observe(
      rng,
      p.position as Position,
      readJson<AttrMap>(p.trueAttrs, {}),
      confidence,
      bestAccuracy(scouts),
      matched ? SCOUTING.SPECIALTY_BONUS : 0,
      p.potential,
    );

    const payload = {
      confidence,
      potConfidence,
      observed: writeJson(observed),
      notes: shortlistNote(confidence, ceiling),
    };
    writes.push(prisma.scoutingReport.upsert({
      where: { playerId_teamId: { playerId: p.id, teamId: team.id } },
      update: payload,
      create: { playerId: p.id, teamId: team.id, ...payload },
    }));
  }

  await Promise.all(writes);
  return { teamId: team.id, shortlisted: targets.length, unitsEach, shares };
}

/**
 * The tiered language in lib/scouting.ts tops out at "very little left to
 * learn", which would be a lie for a player attention alone can never finish.
 * At the ceiling this says so instead, and names what would finish him.
 */
export function shortlistNote(confidence: number, ceiling: number): string {
  if (confidence >= ceiling - 1) {
    return 'Our people have watched him all year. This is as much as tape and phone calls can tell us — '
      + 'a private workout or a full evaluation is the only thing left that would move it.';
  }
  return scoutNote(confidence);
}
