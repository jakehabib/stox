import { prisma } from './db';
import { Rng } from './rng';
import { AI, LEAGUE } from './tuning';
import { parseGmProfile, playerValueDetailed, pickValue, teamNeeds, rosterFit, philosophySummary, leagueScarcity, RosterPlayer } from './ai/gm';
import { projectedDraftOrder, imminentDraftYear } from './draft';
import { CapMode } from './types';
import { recordTrade } from './tradeRetro';
import { deadMoneyOnCut, formatMoney } from './cap';
import { teamCapSummary } from './cap-summary';
import { reconcileDepthChart } from './gen/league';
import { assertCapRoom, tradeCapDeltas } from './capEnforcement';

/**
 * ===========================================================================
 * TRADES (design doc section 11)
 * ===========================================================================
 * A trade offer is two lists of assets (players + picks) moving in opposite
 * directions. Value is computed with the SAME playerValue/pickValue functions
 * the AI uses for free agency and the draft, so a team's board is internally
 * consistent across every mode of acquiring talent.
 * ===========================================================================
 */

export interface TradeAsset {
  type: 'PLAYER' | 'PICK';
  id: string; // playerId or draftPickId
}

/**
 * Real NFL trades run all the way through the regular season up to a fixed
 * week (the Tuesday after week 9 in the current CBA), then freeze until the
 * new league year opens back up around free agency. Mapped onto this game's
 * phase machine: closed for the rest of REGULAR once you're past the
 * deadline week, and for PLAYOFFS/OFFSEASON/RESIGN (still the same league
 * year) — reopening the moment FREE_AGENCY starts, since that's this game's
 * equivalent of the new league year beginning.
 */
export function isTradeDeadlinePassed(phase: string, week: number, deadlineWeek: number): boolean {
  if (phase === 'REGULAR') return week > deadlineWeek;
  return phase === 'PLAYOFFS' || phase === 'OFFSEASON' || phase === 'RESIGN';
}

export interface TradeEvaluation {
  accepted: boolean;
  sendValue: number;
  receiveValue: number;
  ratio: number;
  /** The ratio the offer needed to clear to be accepted — lets the UI render a score bar, not just accept/reject text. */
  requiredRatio: number;
  counter?: { message: string };
  /** Why the AI valued things this way — the strongest 1-3 notes across all assets on each side. */
  explanation: { give: string[]; receive: string[] };
  philosophy: ReturnType<typeof philosophySummary>;
  /**
   * Set when the AI's own cap sheet cannot take the deal on, whatever the
   * value. Present so the UI can style a cap refusal differently from a value
   * refusal — `counter.message` already states it in words either way.
   */
  capBlock?: { shortfall: number; added: number; available: number };
}

/**
 * DraftPick.slot only ever reflects real standings for a year that's
 * already been reseeded (right before that year's own draft) — before that
 * it's just the placeholder assigned at generation time, unrelated to
 * performance. For the NEXT draft that hasn't happened yet, use the live
 * "if the season ended today" projection instead, so a 0-5 team's 1st
 * actually prices like a 1st, not whatever arbitrary slot it was created
 * with. Every year after that has no standings to project from at all yet,
 * so it prices at the middle of the round — a neutral assumption rather
 * than a stale, arbitrarily-favorable-or-unfavorable placeholder.
 *
 * "The next draft" is deliberately identified by `imminentYear` (the
 * smallest year with any unused pick), not by comparing `pick.year` to
 * `currentYear` directly — DraftPick.year for the upcoming draft is
 * pre-generated as `seasonYear + 1` and stays that way for the whole
 * season, but RESET_STANDINGS bumps seasonYear to match it partway through
 * the offseason, before that draft actually runs — so which one is "this
 * season's pick" depends on where in the phase machine the league sits.
 */
function effectiveSlot(pick: { year: number; slot: number; originalTeamId: string }, imminentYear: number | null, projectedOrder: Map<string, number>): number {
  if (imminentYear !== null && pick.year === imminentYear) return projectedOrder.get(pick.originalTeamId) ?? pick.slot;
  if (imminentYear !== null && pick.year > imminentYear) return Math.ceil(LEAGUE.TEAM_COUNT / 2);
  return pick.slot;
}

async function assetValues(
  assets: TradeAsset[],
  forTeamId: string,
  profile: ReturnType<typeof parseGmProfile>,
  needs: Record<string, number>,
  currentYear: number,
  /** Seed prefix for per-asset valuation noise — see the block in evaluateTrade. */
  noisePrefix: string,
  projectedOrder: Map<string, number>,
  imminentYear: number | null,
  capMode: CapMode,
  scarcity: Record<string, number>,
  /** The AI club's roster and live cap space — what turns "how good is he" into "what does he do to US". */
  club: { roster: RosterPlayer[]; capSpace?: number },
): Promise<{ total: number; reasons: string[] }> {
  let total = 0;
  const weighted: { text: string; weight: number }[] = [];
  for (const a of assets) {
    if (a.type === 'PLAYER') {
      const p = await prisma.player.findUniqueOrThrow({ where: { id: a.id }, include: { contract: true } });
      const v = playerValueDetailed(p as unknown as RosterPlayer, {
        profile, needs, rng: new Rng(`${noisePrefix}-${a.type}:${a.id}`), capMode, scarcity,
        roster: club.roster, capSpace: club.capSpace,
      });
      total += v.total;
      for (const r of v.reasons) weighted.push({ text: `${p.firstName} ${p.lastName}: ${r.text}`, weight: r.weight });
    } else {
      const pick = await prisma.draftPick.findUniqueOrThrow({ where: { id: a.id } });
      total += pickValue(pick.round, effectiveSlot(pick, imminentYear, projectedOrder), profile, pick.year, currentYear);
    }
  }
  // Sort ACROSS every asset on this side of the deal, not just within one —
  // otherwise a minor note about asset #1 could outrank the actual dominant
  // factor on asset #2 just by having been evaluated first.
  const reasons = weighted.sort((a, b) => b.weight - a.weight).map((r) => r.text);
  return { total, reasons };
}

/**
 * Evaluate a proposed trade. IMPORTANT — `give`/`get` are from the CALLER's
 * (non-AI side's) perspective, matching how the Trade screen's "You send" /
 * "You receive" panels populate them: `give` = assets the other side is
 * sending to the AI (so the AI RECEIVES these), `get` = assets the other
 * side would receive FROM the AI (so the AI SENDS these away). Getting this
 * backwards silently inverts every accept/reject decision — which is exactly
 * what happened here before this fix, so don't rename `give`/`get` without
 * also re-deriving which one feeds `sendValue` vs `receiveValue` below.
 */
export async function evaluateTrade(opts: {
  aiTeamId: string;
  give: TradeAsset[];
  get: TradeAsset[];
  currentYear: number;
  settings: { aiAcceptsLopsided: boolean };
}): Promise<TradeEvaluation> {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: opts.aiTeamId } });
  const league = await prisma.league.findUniqueOrThrow({ where: { id: team.leagueId } });
  const capMode: CapMode = JSON.parse(league.settings).capMode ?? 'REALISTIC';

  /**
   * ==========================================================================
   * THE VERDICT IS A JUDGEMENT, NOT A DRAW
   * ==========================================================================
   * The seed was `trade-${aiTeamId}-${Date.now()}`, so every submission of the
   * SAME offer re-rolled the ~9%-per-asset valuation noise. A user who kept
   * hitting Propose was rolling dice until the variance fell his way, and a
   * borderline "no" was only ever a few clicks from a "yes" — the whole value
   * model defeated by a button. Same bug class as the negotiation panel's,
   * fixed the same way: lib/negotiation.ts seeds its `acceptanceRoll` on the
   * player, the league year and the offer and on nothing else, so re-offering
   * an identical deal gives an identical answer.
   *
   * SEEDED PER ASSET, not per deal. Both kill the re-roll, but the finer grain
   * is strictly better and the difference is measurable. A deal-level
   * fingerprint re-rolls EVERY asset the moment any one of them changes, so
   * adding a seventh-round pick to an offer moved a measured deal from 1.058
   * to 0.951 — the sweetener made the AI want it 10% LESS, because the fresh
   * draw swamped the pick. Seeded per asset, a club's read on a given player
   * is a property of that player (as it should be: it is that club's scouting
   * being imperfect, not its mood), so adding to an offer can only ever add,
   * and negotiating behaves the way the screen implies it does.
   *
   * The three things in the seed are the three that may legitimately change
   * the answer:
   *
   *   the club   — a different front office may read the same player
   *                differently, and does
   *   the year   — a package refused this season can be revisited next
   *                season; a "no" that never expires is its own bug
   *   the asset  — a genuinely different piece is a genuinely different offer
   *
   * What is deliberately NOT in it: the clock, the order the Trade screen's
   * Set happened to iterate in, and the rest of the package.
   * ==========================================================================
   */
  const noisePrefix = `trade-${opts.aiTeamId}-${league.seasonYear}`;

  /**
   * A GM's character belongs to the franchise, not to the proposal in front
   * of him. This used to draw from the shared evaluation rng, which meant a
   * club whose stored profile was missing or partial was handed a brand new
   * personality on every submission — and, even with a complete profile, the
   * four draws it consumed shifted the noise stream underneath the
   * valuations. Seeded per club per season, so a Rebuilding conservative GM
   * is still one on the tenth proposal.
   */
  const profile = parseGmProfile(team.gmProfile, new Rng(`gm-${opts.aiTeamId}-${league.seasonYear}`));

  const [roster, allPlayers, projectedOrder, imminentYear, capSummary] = await Promise.all([
    prisma.player.findMany({
      where: { teamId: opts.aiTeamId },
      select: { id: true, position: true, trueOvr: true, age: true, potential: true },
    }),
    // One league-wide fetch reused for scarcity across every asset in this
    // trade, not queried per player — see leagueScarcity()'s cost note.
    prisma.player.findMany({ where: { leagueId: team.leagueId, status: 'ACTIVE' }, select: { position: true, trueOvr: true } }),
    projectedDraftOrder(team.leagueId),
    imminentDraftYear(team.leagueId),
    capMode === 'OFF' ? Promise.resolve(null) : teamCapSummary(opts.aiTeamId, league.seasonYear, capMode),
  ]);
  const needs = teamNeeds(roster as RosterPlayer[]);
  const scarcity = leagueScarcity(allPlayers);
  // Fetched once and shared by every asset on both sides, like `needs` and
  // `scarcity` — the club's roster and its books are facts about the club,
  // not about the asset being priced.
  const club = { roster: roster as RosterPlayer[], capSpace: capSummary?.capSpace };

  // opts.give flows TO the AI => that's what the AI receives.
  // opts.get flows FROM the AI => that's what the AI sends away.
  const receive = await assetValues(opts.give, opts.aiTeamId, profile, needs, opts.currentYear, noisePrefix, projectedOrder, imminentYear, capMode, scarcity, club);
  const send = await assetValues(opts.get, opts.aiTeamId, profile, needs, opts.currentYear, noisePrefix, projectedOrder, imminentYear, capMode, scarcity, club);
  const sendValue = send.total;
  const receiveValue = receive.total;
  const philosophy = philosophySummary(profile);
  // "give" reasons describe the assets flowing to the AI (why it wants/
  // discounts them); "receive" reasons describe what the AI would give up.
  const explanation = { give: receive.reasons.slice(0, 3), receive: send.reasons.slice(0, 3) };

  const requiredRatio = opts.settings.aiAcceptsLopsided ? 0.9 : AI.TRADE_ACCEPT_RATIO;
  const ratio = sendValue === 0 ? Infinity : receiveValue / sendValue;

  /**
   * A deal the club has no room for is not a deal, however good the value.
   * `assertCapRoom` will refuse to write it at Confirm — so without this the
   * screen said "Deal accepted! Click confirm to execute", and then the
   * Confirm died on the cap. Checking the same numbers here, with the same
   * `tradeCapDeltas` the executor uses, turns a bait-and-switch into a
   * sentence a GM can act on. Only the AI's own side is judged; the user's
   * cap is his own business and is still reported at execution.
   */
  const capBlock = capSummary ? await aiCapShortfall(opts, capSummary.capSpace, capMode) : null;
  if (capBlock) {
    const valueAlso = ratio < requiredRatio
      ? ` The value is short too — we'd want about ${Math.round((requiredRatio / Math.max(ratio, 0.01) - 1) * 100)}% more coming back.`
      : ` We like the deal otherwise.`;
    return {
      accepted: false, sendValue, receiveValue, ratio, requiredRatio, explanation, philosophy, capBlock,
      counter: {
        message: `We can't fit this on our cap — it adds ${formatMoney(capBlock.added)} against ${formatMoney(capBlock.available)} of room, ${formatMoney(capBlock.shortfall)} more than we have. Take a contract back the other way and we'll talk.${valueAlso}`,
      },
    };
  }

  if (ratio >= requiredRatio) {
    return { accepted: true, sendValue, receiveValue, ratio, requiredRatio, explanation, philosophy };
  }
  if (ratio >= requiredRatio - AI.TRADE_COUNTER_WINDOW) {
    return {
      accepted: false, sendValue, receiveValue, ratio, requiredRatio, explanation, philosophy,
      counter: { message: `Close, but we need a bit more. Try sweetening the offer — we're about ${Math.round((requiredRatio - ratio) * 100)}% short on value.` },
    };
  }
  return {
    accepted: false, sendValue, receiveValue, ratio, requiredRatio, explanation, philosophy,
    counter: { message: `Not enough here for us to consider it.` },
  };
}

/**
 * Net current-season cap this trade puts on the AI club, against the room it
 * actually has. Built from `tradeCapDeltas` — the same function
 * `executeTrade` runs before it writes — rather than a second derivation of
 * the "bonus stays behind, base salary travels" rule, because two copies of
 * that rule is how a screen ends up promising a deal the executor refuses.
 *
 * Returns null when there is room (the overwhelmingly common case).
 */
async function aiCapShortfall(
  opts: { aiTeamId: string; give: TradeAsset[]; get: TradeAsset[] },
  capSpace: number,
  capMode: CapMode,
): Promise<{ shortfall: number; added: number; available: number } | null> {
  if (capMode === 'OFF') return null;
  // The user's team id isn't known here and isn't needed: only the AI-side
  // rows are read, and those depend on which assets move, not on who the
  // counterparty is. A stable placeholder keeps the other side's rows
  // distinguishable.
  const OTHER = `${opts.aiTeamId}-counterparty`;
  const deltas = [
    ...(await tradeCapDeltas(opts.give, OTHER, opts.aiTeamId, capMode)),
    ...(await tradeCapDeltas(opts.get, opts.aiTeamId, OTHER, capMode)),
  ];
  const added = deltas.filter((d) => d.teamId === opts.aiTeamId).reduce((sum, d) => sum + d.delta, 0);
  // Mirrors assertCapRoom exactly, including both of its escapes: a move that
  // frees room (or is cap-neutral, e.g. picks only) is never blocked even for
  // a club already over the ceiling, and the same 1-dollar rounding slack
  // applies. Any divergence here would either promise a deal the executor
  // refuses or refuse one it would have written.
  if (added <= 0) return null;
  if (added <= capSpace + 1) return null;
  return { shortfall: added - capSpace, added, available: capSpace };
}

export async function executeTrade(opts: {
  leagueId: string; teamA: string; teamB: string; aToB: TradeAsset[]; bToA: TradeAsset[]; seasonYear: number; week: number;
}) {
  const [league, teamAInfo, teamBInfo] = await Promise.all([
    prisma.league.findUniqueOrThrow({ where: { id: opts.leagueId } }),
    prisma.team.findUniqueOrThrow({ where: { id: opts.teamA } }),
    prisma.team.findUniqueOrThrow({ where: { id: opts.teamB } }),
  ]);
  const capMode: CapMode = JSON.parse(league.settings).capMode ?? 'REALISTIC';

  /**
   * A trade can be comfortably legal for the side shedding salary and
   * illegal for the side taking it on, so BOTH teams are checked — one net
   * position per team across both directions, since a two-way deal can have
   * a team sending and receiving contracts at the same time. Deltas come
   * from tradeCapDeltas(), which mirrors exactly what the move() below
   * writes (bonus accelerates onto the seller, base salary travels).
   */
  const deltas = [
    ...(await tradeCapDeltas(opts.aToB, opts.teamA, opts.teamB, capMode)),
    ...(await tradeCapDeltas(opts.bToA, opts.teamB, opts.teamA, capMode)),
  ];
  await assertCapRoom({ action: 'Trade', seasonYear: opts.seasonYear, capMode, charges: deltas });

  // Snapshot what's being traded (and what it's worth right now) BEFORE
  // ownership changes — this is the only record of asset identity a trade
  // retrospective (lib/tradeRetro.ts) can grade later; the Transaction row
  // below only ever logs asset counts, not who/what.
  await recordTrade({
    leagueId: opts.leagueId, seasonYear: opts.seasonYear, week: opts.week,
    teamAId: opts.teamA, teamBId: opts.teamB, teamAAbbr: teamAInfo.abbr, teamBAbbr: teamBInfo.abbr,
    aToB: opts.aToB, bToA: opts.bToA, capMode,
  });

  await prisma.$transaction(async (tx) => {
    /**
     * Trading a player away does NOT hand his signing-bonus proration to the
     * team acquiring him — in real football the whole remaining bonus (void
     * years included) accelerates onto the cap of the team giving him up, and
     * the new team inherits base salary only. Without this, dumping a
     * bonus-heavy contract was a way to escape it entirely.
     */
    const move = async (assets: TradeAsset[], fromTeam: string, toTeam: string) => {
      for (const a of assets) {
        if (a.type === 'PLAYER') {
          const contract = await tx.contract.findUnique({ where: { playerId: a.id } });
          if (contract && capMode === 'REALISTIC') {
            const accelerated = deadMoneyOnCut(contract, capMode);
            if (accelerated > 0) {
              const p = await tx.player.findUniqueOrThrow({ where: { id: a.id } });
              await tx.capCharge.create({
                data: {
                  teamId: fromTeam,
                  year: opts.seasonYear,
                  amount: accelerated,
                  label: `Traded away — ${p.firstName} ${p.lastName}`,
                },
              });
            }
          }
          await tx.player.update({ where: { id: a.id }, data: { teamId: toTeam } });
          // Bonus stays behind with the old team as the charge above, so the
          // contract that travels carries base salary and nothing else.
          await tx.contract.updateMany({
            where: { playerId: a.id },
            data: capMode === 'REALISTIC'
              ? { teamId: toTeam, signingBonus: 0, voidYears: 0 }
              : { teamId: toTeam },
          });
        } else {
          await tx.draftPick.update({ where: { id: a.id }, data: { ownerTeamId: toTeam } });
        }
      }
    };
    await move(opts.aToB, opts.teamA, opts.teamB);
    await move(opts.bToA, opts.teamB, opts.teamA);

    /**
     * Moving the roster spot is only half of arriving. Nothing here used to
     * touch either club's depth chart, and lib/sim/units.ts ranks a player his
     * chart doesn't name behind every player it does — so the man you traded
     * for lined up behind the entire position group and took no snaps at all
     * for the rest of the season, while the man you traded away kept a rank on
     * the chart he had left. Both sides are reconciled, in the same
     * transaction as the move, so a trade can never half-land.
     */
    await reconcileDepthChart(opts.teamA, tx);
    await reconcileDepthChart(opts.teamB, tx);

    await tx.transaction.create({
      data: {
        leagueId: opts.leagueId, seasonYear: opts.seasonYear, week: opts.week, type: 'TRADE',
        headline: `Trade: ${teamAInfo.abbr} <-> ${teamBInfo.abbr}`,
        detail: `${teamAInfo.abbr} sends ${opts.aToB.length} asset(s), receives ${opts.bToA.length} asset(s).`,
      },
    });
  });
}

export interface TradePartnerSuggestion {
  teamId: string;
  teamName: string;
  teamAbbr: string;
  /**
   * 0..1 interest at the shopped position. With `ovr` supplied this is the
   * same blended roster-fit the valuation uses — hole OR upgrade — so a club
   * that is set at the position but would still be improved by THIS player
   * appears. Without it, it degrades to the raw hole-need.
   */
  need: number;
  needLabel: 'Severe' | 'High' | 'Moderate' | 'Low';
  philosophy: ReturnType<typeof philosophySummary>;
}

/**
 * "Best trade partners" for a position you're shopping — the QoL feature the
 * brief specifically calls out: instead of the user opening all 31 rosters
 * and cap sheets by hand, the game just tells them who's actually interested.
 *
 * `ovr` is how good the man you're shopping actually is, and it matters
 * enormously: ranked on hole-need alone, a club starting an 84 right tackle
 * reads 0.00 and never appears, even though it would obviously take a 91.
 * That is the same "do I have a hole?" / "is he better than what I have?"
 * confusion that made the AI discount the player in the first place, showing
 * up a second time in the list that is supposed to tell the user WHO TO CALL.
 * Optional so existing callers keep the old hole-only behaviour rather than
 * silently changing meaning.
 */
export async function rankTradePartners(leagueId: string, position: string, excludeTeamId: string, ovr?: number): Promise<TradePartnerSuggestion[]> {
  const teams = await prisma.team.findMany({ where: { leagueId, id: { not: excludeTeamId }, isUser: false } });
  const rosters = await prisma.player.findMany({
    where: { leagueId, teamId: { in: teams.map((t) => t.id) } },
    select: { id: true, teamId: true, position: true, trueOvr: true, age: true, potential: true },
  });
  const byTeam = new Map<string, typeof rosters>();
  for (const p of rosters) {
    if (!p.teamId) continue;
    if (!byTeam.has(p.teamId)) byTeam.set(p.teamId, []);
    byTeam.get(p.teamId)!.push(p);
  }

  const needLabel = (n: number): TradePartnerSuggestion['needLabel'] =>
    n >= 0.65 ? 'Severe' : n >= 0.4 ? 'High' : n >= 0.2 ? 'Moderate' : 'Low';

  const suggestions: TradePartnerSuggestion[] = teams.map((t) => {
    const teamRoster = (byTeam.get(t.id) ?? []) as RosterPlayer[];
    const needs = teamNeeds(teamRoster);
    // Same blend, same order of arguments, as playerValueDetailed's fit term
    // — the list and the valuation must not disagree about who wants him.
    const fit = ovr === undefined
      ? 0
      : rosterFit({ id: '__shopped__', position, trueOvr: ovr, age: 26, potential: ovr }, teamRoster).score;
    const need = Math.max(needs[position] ?? 0, fit);
    return {
      teamId: t.id,
      teamName: `${t.city} ${t.nickname}`,
      teamAbbr: t.abbr,
      need,
      needLabel: needLabel(need),
      philosophy: philosophySummary(parseGmProfile(t.gmProfile)),
    };
  });

  return suggestions.filter((s) => s.need >= 0.2).sort((a, b) => b.need - a.need).slice(0, 6);
}

/**
 * Occasionally an AI team proposes a trade to the user. Value-fair (it won't
 * lowball an ask you'd never accept, since it's using the same pickValue the
 * AI itself is judged by) and targeted: it offers from a position it's
 * genuinely deep at, in exchange for a pick or player at a position it
 * genuinely needs, so the offer is coherent rather than a random pairing.
 */
export async function maybeGenerateAiTradeOffer(leagueId: string, userTeamId: string, rng: Rng, frequency: number) {
  if (!rng.bool(frequency)) return null;
  const aiTeams = await prisma.team.findMany({ where: { leagueId, isUser: false } });
  if (aiTeams.length === 0) return null;
  const aiTeam = rng.pick(aiTeams);

  const roster = await prisma.player.findMany({ where: { teamId: aiTeam.id }, include: { contract: true } });
  if (roster.length < 4) return null;
  const needs = teamNeeds(roster as RosterPlayer[]);
  const profile = parseGmProfile(aiTeam.gmProfile, rng);
  const philosophy = philosophySummary(profile);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const capMode: CapMode = JSON.parse(league.settings).capMode ?? 'REALISTIC';

  // Offer from a position with real depth (need near 0) and a player who
  // isn't a core starter — the AI's own logic wouldn't shop its best guy.
  const depthPositions = Object.entries(needs).filter(([, n]) => n < 0.15).map(([pos]) => pos);
  const candidates = roster.filter((p) => depthPositions.includes(p.position) && p.trueOvr >= 67 && p.trueOvr <= 89);
  const surplus = candidates.length > 0 ? rng.pick(candidates) : rng.pick(roster.filter((p) => p.trueOvr >= 65 && p.trueOvr <= 83));
  if (!surplus) return null;

  // `roster` matters here even though he's the club's own man: it's what
  // makes the ask reflect that he is SURPLUS. Without it the AI priced its
  // fourth receiver as though he were about to start somewhere.
  const askValue = playerValueDetailed(surplus as unknown as RosterPlayer, { profile, needs, rng, capMode, roster: roster as RosterPlayer[] }).total;

  const userPicks = await prisma.draftPick.findMany({ where: { ownerTeamId: userTeamId, used: false }, orderBy: [{ year: 'asc' }, { round: 'asc' }] });
  // Find the cheapest pick (by this team's own pick-value scale) that still
  // roughly covers what it's asking — keeps the ask honest rather than
  // reaching for the user's best future first-rounder every time.
  const currentYear = league.seasonYear;
  const [projectedOrder, imminentYear] = await Promise.all([projectedDraftOrder(leagueId), imminentDraftYear(leagueId)]);
  const priced = userPicks
    .map((p) => ({ pick: p, value: pickValue(p.round, effectiveSlot(p, imminentYear, projectedOrder), profile, p.year, currentYear) }))
    .filter((x) => x.value >= askValue * 0.8)
    .sort((a, b) => a.value - b.value);
  const askPick = priced[0]?.pick ?? userPicks[userPicks.length - 1];
  if (!askPick) return null;

  return {
    fromTeamId: aiTeam.id,
    fromTeamName: `${aiTeam.city} ${aiTeam.nickname}`,
    philosophy,
    offer: { give: [{ type: 'PLAYER' as const, id: surplus.id }], get: [{ type: 'PICK' as const, id: askPick.id }] },
    blurb: `${aiTeam.city} (${philosophy.windowLabel.toLowerCase()}) is offering ${surplus.firstName} ${surplus.lastName} (${surplus.position}, ${surplus.trueOvr} OVR) for your ${askPick.year} Round ${askPick.round} pick.`,
  };
}
