import { prisma } from './db';
import { readJson, writeJson } from './json';
import { playerValueDetailed, pickValue, leagueScarcity, RosterPlayer } from './ai/gm';
import { projectedDraftOrder, imminentDraftYear } from './draft';
import { CapMode, GmProfile } from './types';
import { TradeAsset } from './trade';

/**
 * ===========================================================================
 * TRADE RETROSPECTIVES
 * ===========================================================================
 * "3 years later, who won this trade" — every completed trade gets a
 * snapshot of exactly what moved and what it was worth the moment it
 * happened (TradeRecord, written from lib/trade.ts's executeTrade). This
 * module re-prices those same assets against where they stand NOW and
 * turns the before/after into a verdict.
 *
 * Valuation here is deliberately team-need-agnostic (a flat 0.5/0.5/0.5
 * NEUTRAL_PROFILE, no teamNeeds) on both ends — a real trade grade compares
 * what an asset is worth in the abstract, not how badly one particular
 * side wanted it that day. Team-specific need is exactly what makes two
 * GMs agree to a trade in the first place; grading it after the fact through
 * that same lens would just reward whichever side's needs happened to
 * shift favorably, not who actually got the better assets.
 * ===========================================================================
 */

export interface TradeAssetSnapshot {
  type: 'PLAYER' | 'PICK';
  id: string; // playerId or draftPickId — the ORIGINAL asset traded
  label: string;
  position?: string;
  value: number;
}

const NEUTRAL_PROFILE: GmProfile = { aggression: 0.5, winNow: 0.5, valuePicks: 0.5, bpaBias: 0.55 };

async function snapshotAssets(
  assets: TradeAsset[],
  currentYear: number,
  capMode: CapMode,
  scarcity: Record<string, number>,
  projectedOrder: Map<string, number>,
  imminentYear: number | null,
): Promise<TradeAssetSnapshot[]> {
  const out: TradeAssetSnapshot[] = [];
  for (const a of assets) {
    if (a.type === 'PLAYER') {
      const p = await prisma.player.findUniqueOrThrow({ where: { id: a.id }, include: { contract: true } });
      const v = playerValueDetailed(p as unknown as RosterPlayer, { profile: NEUTRAL_PROFILE, capMode, scarcity });
      out.push({ type: 'PLAYER', id: p.id, label: `${p.firstName} ${p.lastName}`, position: p.position, value: v.total });
    } else {
      const pick = await prisma.draftPick.findUniqueOrThrow({ where: { id: a.id } });
      const slot = imminentYear !== null && pick.year === imminentYear ? (projectedOrder.get(pick.originalTeamId) ?? pick.slot) : pick.slot;
      const value = pickValue(pick.round, slot, NEUTRAL_PROFILE, pick.year, currentYear);
      out.push({ type: 'PICK', id: pick.id, label: `${pick.year} Round ${pick.round}`, value });
    }
  }
  return out;
}

/** Called from inside executeTrade, before assets change hands, so this captures pre-trade ownership context. */
export async function recordTrade(opts: {
  leagueId: string; seasonYear: number; week: number;
  teamAId: string; teamBId: string; teamAAbbr: string; teamBAbbr: string;
  aToB: TradeAsset[]; bToA: TradeAsset[]; capMode: CapMode;
}) {
  const [allPlayers, projectedOrder, imminentYear] = await Promise.all([
    prisma.player.findMany({ where: { leagueId: opts.leagueId, status: 'ACTIVE' }, select: { position: true, trueOvr: true } }),
    projectedDraftOrder(opts.leagueId),
    imminentDraftYear(opts.leagueId),
  ]);
  const scarcity = leagueScarcity(allPlayers);
  const [aToB, bToA] = await Promise.all([
    snapshotAssets(opts.aToB, opts.seasonYear, opts.capMode, scarcity, projectedOrder, imminentYear),
    snapshotAssets(opts.bToA, opts.seasonYear, opts.capMode, scarcity, projectedOrder, imminentYear),
  ]);

  await prisma.tradeRecord.create({
    data: {
      leagueId: opts.leagueId, seasonYear: opts.seasonYear, week: opts.week,
      teamAId: opts.teamAId, teamBId: opts.teamBId, teamAAbbr: opts.teamAAbbr, teamBAbbr: opts.teamBAbbr,
      aToB: writeJson(aToB), bToA: writeJson(bToA),
    },
  });
}

export interface AssetOutcome extends TradeAssetSnapshot {
  currentValue: number | null; // null = pick still unused, can't grade yet
  note: string;
}

export interface TradeRetrospective {
  id: string;
  seasonYear: number;
  week: number;
  teamAAbbr: string;
  teamBAbbr: string;
  aToB: AssetOutcome[]; // what A sent B
  bToA: AssetOutcome[]; // what B sent A
  aValueThen: number;
  bValueThen: number;
  aValueNow: number | null; // null if any asset on this side is still pending
  bValueNow: number | null;
  pending: boolean;
  /**
   * How much MORE A's return has grown than B's, as a share of what each was
   * worth on the day. Null while the trade is pending. This is the exact
   * figure `verdict` is written from — anything RANKING trades by who did
   * better (the GM career page's best/worst deal) must read this rather than
   * recompute a growth comparison of its own, or a panel headed "best deal"
   * can end up sitting over a verdict that names the other club.
   */
  growthGap: number | null;
  verdict: string;
}

async function priceOutcome(snap: TradeAssetSnapshot, capMode: CapMode, scarcity: Record<string, number>, currentYear: number): Promise<AssetOutcome> {
  if (snap.type === 'PLAYER') {
    const p = await prisma.player.findUnique({ where: { id: snap.id }, include: { contract: true } });
    if (!p) return { ...snap, currentValue: 0, note: 'No longer in the league.' };
    if (p.status === 'RETIRED') return { ...snap, currentValue: 0, note: 'Retired since the trade.' };
    const v = playerValueDetailed(p as unknown as RosterPlayer, { profile: NEUTRAL_PROFILE, capMode, scarcity });
    const delta = v.total - snap.value;
    const note = p.status === 'FREE_AGENT'
      ? `Now a free agent, ${p.trueOvr} OVR.`
      : delta >= snap.value * 0.15
        ? `Blossomed into a ${p.trueOvr} OVR player.`
        : delta <= -snap.value * 0.15
          ? `Has fallen off — now ${p.trueOvr} OVR.`
          : `Still producing at ${p.trueOvr} OVR.`;
    return { ...snap, currentValue: v.total, note };
  }
  const pick = await prisma.draftPick.findUnique({ where: { id: snap.id }, include: { player: true } });
  if (!pick) return { ...snap, currentValue: 0, note: 'Pick no longer exists.' };
  if (!pick.used || !pick.player) return { ...snap, currentValue: null, note: 'Still on the board — not used yet.' };
  const player = pick.player;
  const v = playerValueDetailed(player as unknown as RosterPlayer, { profile: NEUTRAL_PROFILE, capMode, scarcity });
  return { ...snap, currentValue: v.total, note: `Became ${player.firstName} ${player.lastName} (${player.position}), now ${player.trueOvr} OVR.` };
}

function sideValue(outcomes: AssetOutcome[]): number | null {
  if (outcomes.some((o) => o.currentValue === null)) return null;
  return outcomes.reduce((s, o) => s + (o.currentValue ?? 0), 0);
}

/** Inside this band the two returns are called even rather than graded. */
const EVEN_BAND = 0.08;
/** Past this the edge is called lopsided rather than an edge. */
const LOPSIDED_BAND = 0.35;

/**
 * Grade by how each side's return GREW relative to what it was worth at the
 * time, not just who has more total value now (a side that took on a straight
 * star already "won" the day of the trade — this highlights whether that lead
 * grew, shrank, or flipped since).
 *
 * Positive favours A, negative favours B. Null while either side still holds
 * an unused pick, which is the one state that cannot be graded at all.
 */
function computeGrowthGap(r: Pick<TradeRetrospective, 'aValueThen' | 'bValueThen' | 'aValueNow' | 'bValueNow'>): number | null {
  if (r.aValueNow === null || r.bValueNow === null) return null;
  const aGrowth = r.aValueThen > 0 ? (r.aValueNow - r.aValueThen) / r.aValueThen : 0;
  const bGrowth = r.bValueThen > 0 ? (r.bValueNow - r.bValueThen) / r.bValueThen : 0;
  return aGrowth - bGrowth;
}

function buildVerdict(r: Pick<TradeRetrospective, 'teamAAbbr' | 'teamBAbbr'>, gap: number | null): string {
  if (gap === null) {
    return 'Too early to call — at least one future pick from this trade hasn\'t been used yet.';
  }
  if (Math.abs(gap) < EVEN_BAND) return 'A fair trade — both returns have held up about the same since.';
  const winner = gap > 0 ? r.teamAAbbr : r.teamBAbbr;
  const loser = gap > 0 ? r.teamBAbbr : r.teamAAbbr;
  const magnitude = Math.abs(gap) >= LOPSIDED_BAND ? 'lopsided win' : 'edge';
  return `${winner} has the ${magnitude} here — their return has outgained ${loser}'s since the deal.`;
}

/**
 * The grading gap from ONE team's point of view: positive means that club's
 * return has outgrown what it gave up, negative means it hasn't. Null while
 * the deal is ungradable. Sort a career's trades on this and the top and
 * bottom of the list are, by construction, the deals the verdicts already
 * call his best and his worst.
 */
export function retroEdgeFor(r: Pick<TradeRetrospective, 'teamAAbbr' | 'growthGap'>, abbr: string): number | null {
  if (r.growthGap === null) return null;
  return r.teamAAbbr === abbr ? r.growthGap : -r.growthGap;
}

/**
 * The same three-way call the verdict sentence makes, off the same gap and
 * the same band, for a club that wants it as a value rather than as prose.
 * A surface that wants to CLAIM a trade — the GM card's best deal — must gate
 * on this, or it can end up boasting about a deal the verdict beneath it
 * calls fair.
 */
export function retroOutcomeFor(
  r: Pick<TradeRetrospective, 'teamAAbbr' | 'growthGap'>,
  abbr: string,
): 'WON' | 'LOST' | 'EVEN' | 'PENDING' {
  const edge = retroEdgeFor(r, abbr);
  if (edge === null) return 'PENDING';
  if (Math.abs(edge) < EVEN_BAND) return 'EVEN';
  return edge > 0 ? 'WON' : 'LOST';
}

export async function buildTradeRetrospectives(leagueId: string, teamId: string, capMode: CapMode, currentYear: number): Promise<TradeRetrospective[]> {
  const records = await prisma.tradeRecord.findMany({
    where: { leagueId, OR: [{ teamAId: teamId }, { teamBId: teamId }] },
    orderBy: { createdAt: 'desc' },
  });
  if (records.length === 0) return [];

  const allPlayers = await prisma.player.findMany({ where: { leagueId, status: 'ACTIVE' }, select: { position: true, trueOvr: true } });
  const scarcity = leagueScarcity(allPlayers);

  const out: TradeRetrospective[] = [];
  for (const rec of records) {
    const aSnaps = readJson<TradeAssetSnapshot[]>(rec.aToB, []);
    const bSnaps = readJson<TradeAssetSnapshot[]>(rec.bToA, []);
    const [aToB, bToA] = await Promise.all([
      Promise.all(aSnaps.map((s) => priceOutcome(s, capMode, scarcity, currentYear))),
      Promise.all(bSnaps.map((s) => priceOutcome(s, capMode, scarcity, currentYear))),
    ]);
    // A's RETURN is what it received — bToA (moved from B to A). B's return
    // is aToB. "Then" and "now" must use the SAME side for each team, or
    // the before/after comparison silently compares the wrong assets.
    const aValueThen = bSnaps.reduce((s, a) => s + a.value, 0);
    const bValueThen = aSnaps.reduce((s, a) => s + a.value, 0);
    const aValueNow = sideValue(bToA);
    const bValueNow = sideValue(aToB);
    const pending = aValueNow === null || bValueNow === null;
    const growthGap = computeGrowthGap({ aValueThen, bValueThen, aValueNow, bValueNow });
    const verdict = buildVerdict({ teamAAbbr: rec.teamAAbbr, teamBAbbr: rec.teamBAbbr }, growthGap);
    out.push({
      id: rec.id, seasonYear: rec.seasonYear, week: rec.week, teamAAbbr: rec.teamAAbbr, teamBAbbr: rec.teamBAbbr,
      aToB, bToA, aValueThen, bValueThen, aValueNow, bValueNow, pending, growthGap, verdict,
    });
  }
  return out;
}
