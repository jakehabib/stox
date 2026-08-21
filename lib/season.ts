import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { Rng, clamp } from './rng';
import { CAP, CONTRACT, LEAGUE, Position, PROGRESSION, RESIGN, ROSTER_TARGETS, SCOUTING, GENERATION, rosterMinFor } from './tuning';
import { parseSettings, LeagueSettings } from './settings';
import { readJson, writeJson } from './json';
import { simulateGame, SimTeamInput } from './sim/engine';
import { generateRecap } from './sim/recap';
import { SimPlayer, SimStaff } from './sim/units';
import { retirementChance, bumpForMilestone } from './progression';
import { AttrMap } from './ratings';
import { applyInSeasonProgression, progressFreeAgents } from './development';
import { proration, deadMoneyOnCut } from './cap';
import { runAiFreeAgencyWave, fillTeamsToRosterMinimum } from './freeagency';
import { maybeGenerateAiTradeOffer, isTradeDeadlinePassed } from './trade';
import { mergeStats } from './stats';
import { SeasonStats } from './types';
import { gameHeadlines } from './news';
import { COACH_FIRST, COACH_LAST } from './gen/names';
import { generateDraftClass, toPlayerCreate } from './gen/players';
import { NameRegistry } from './gen/names';
import { classStrengthSummary } from './gen/prospectProfile';
import { checkAndUpdateRecords, recordBreakHeadline } from './records';
import { reseedDraftOrder, startRookieDraft } from './draft';
import { ensureSeasonSchedule } from './scheduleSeason';
import { autoDepthChartAll } from './gen/league';
import { observe } from './scouting';
import { applyShortlistAttention } from './shortlistAttention';
import { resetWorkoutSlots } from './workouts';
import { standingsCompare } from './standingsOrder';
import {
  snapshotBeforeAdvance, buildWeekReport, buildTrophyMoment,
  PreAdvanceSnapshot, WeekReport, TrophyMoment,
} from './weekReport';

/**
 * ===========================================================================
 * SEASON / OFFSEASON FLOW (design doc section 13)
 * ===========================================================================
 * Phase machine: PRESEASON -> REGULAR -> PLAYOFFS -> OFFSEASON -> RESIGN ->
 * FREE_AGENCY -> DRAFT -> back to PRESEASON.
 * (FANTASY_DRAFT is a one-time pre-PRESEASON phase used only at league start.)
 *
 * `advanceWeek` is the single entrypoint the UI calls to move time forward.
 * It does exactly one week's worth of work and returns a summary of what
 * happened, so the UI can show "what changed" rather than a wall of silence.
 * ===========================================================================
 */

/**
 * Public entrypoint. Wraps the phase machine and nothing else — there is no
 * per-period scouting allowance to top up any more. The scouting that happens
 * when time moves is applyShortlistAttention, on the regular-season week tick
 * below: free, automatic, and impossible to forget to spend.
 */
export async function advanceWeek(leagueId: string): Promise<AdvanceResult> {
  const before = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const blocked = await capComplianceBlock(leagueId, parseSettings(before.settings), before.phase);
  if (blocked) return blocked; // time does not move while the user is over the cap

  return advanceWeekStep(leagueId);
}

/**
 * Phases where a team is legitimately over the cap through no fault of its
 * own, so compliance is NOT demanded yet.
 *
 * The books are mid-roll here: ageContractsForYear() has already stepped every
 * deal onto its next (escalating) base-salary year, but
 * releaseUnresignedExpiringContracts() — which drops every expiring contract
 * off the ledger — doesn't run until the END of RESIGN. A sim-health trace
 * across four seasons shows this window is exactly where teams go negative and
 * where they come back on their own: over-cap teams appear at OFFSEASON wk1
 * and clear the moment FREE_AGENCY opens, every year, league-wide. (They used
 * to appear at wk4 instead; the ledger now ages when the season ends rather
 * than at the wk3 step, so the same teams show up three steps earlier in the
 * same window. Nothing about the window's boundaries changed.)
 *
 * Blocking there would fire on almost everyone every single offseason for a
 * condition that resolves itself one step later — a rule that reads as a bug.
 * Compliance is instead demanded from the new league year onward, which in
 * this phase machine begins at FREE_AGENCY (the same boundary lib/trade.ts
 * uses to reopen trading).
 */
const CAP_ROLLOVER_PHASES = new Set(['OFFSEASON', 'RESIGN']);

/**
 * Is salary-cap compliance actually due right now? False through the
 * offseason roll (see CAP_ROLLOVER_PHASES). Exported so the standing
 * over-cap banner promises the same thing the advance gate enforces
 * instead of threatening a block that won't happen.
 */
export function capComplianceDueNow(phase: string): boolean {
  return !CAP_ROLLOVER_PHASES.has(phase);
}

/**
 * What `advanceWeek` hands back. `blocked` means time did NOT move — the
 * summary explains why, and `capBlock` carries the specific way out, so the
 * UI can render an explanation and a route instead of a dead button.
 */
export interface AdvanceResult {
  summary: string;
  blocked?: boolean;
  /**
   * The structured week report — what the week actually did to the user's
   * team. `summary` stays exactly what it was and is still the fallback the
   * UI shows when there is no report (an offseason step, a preseason roll, a
   * league with no user team), so nothing that reads `summary` today breaks.
   *
   * Same precedent as `capBlock` and `block` below: a structured payload
   * travelling alongside the sentence, so the UI can render a screen instead
   * of a string. See lib/weekReport.ts.
   */
  report?: WeekReport | null;
  /**
   * Tier 0. Set only when the user's own season just ended in the
   * postseason — they won the title, or they lost the game that knocked them
   * out. At most twice in a season, usually once, usually never.
   */
  trophy?: TrophyMoment | null;
  capBlock?: {
    teamAbbr: string;
    shortfall: number;
    /** Cuts that, taken together, clear the shortfall — biggest saver first. */
    path: { playerId: string; name: string; position: string; frees: number; deadMoney: number }[];
  };
  /**
   * A refusal that ISN'T about the salary cap — cut-down day finding the
   * user's roster over the limit, for instance. Same contract as `capBlock`:
   * time did not move, `summary` says why, and this says what to call it and
   * where the user fixes it. Without it every block rendered under the cap
   * panel's hard-coded "Over the salary cap" heading.
   */
  block?: {
    title: string;
    /** Path within the league, e.g. `roster` — the caller prefixes the league id. */
    href: string;
    linkLabel: string;
  };
}

/**
 * League-year compliance gate. Real teams cannot roll into the next week
 * over the salary cap, and neither can the user — being over has to cost
 * something or the ceiling is decoration.
 *
 * Deliberately narrow:
 *   - REALISTIC only. SIMPLIFIED still enforces transactions but has no
 *     dead money, so a team can always cut straight back under and a hard
 *     stop adds nothing; OFF means the user switched the rule off entirely
 *     and nothing here may override that.
 *   - The USER's team only. AI teams are enforced at transaction time, and
 *     halting the user's clock over a CPU team's books would be unfixable.
 *   - Only while a way out still exists. If cutting every player who frees
 *     anything still leaves the team over (dead money alone can exceed the
 *     ceiling), blocking would be a permanent soft-lock, so the week
 *     advances and the standing over-cap warning carries it instead.
 *   - Not during OFFSEASON/RESIGN — see CAP_ROLLOVER_PHASES.
 */
async function capComplianceBlock(leagueId: string, settings: LeagueSettings, phase: string): Promise<AdvanceResult | null> {
  if (settings.capMode !== 'REALISTIC') return null;
  if (CAP_ROLLOVER_PHASES.has(phase)) return null;
  const userTeam = await prisma.team.findFirst({ where: { leagueId, isUser: true }, select: { id: true } });
  if (!userTeam) return null;

  const { capComplianceReport } = await import('./capEnforcement');
  const { formatMoney } = await import('./cap');
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { seasonYear: true } });
  const report = await capComplianceReport(userTeam.id, league.seasonYear, settings.capMode);
  if (report.compliant || !report.fixable) return null;

  const steps = report.path
    .map((c) => `cut ${c.name} (${c.position}) to free ${formatMoney(c.frees)}`)
    .join(', then ');
  return {
    summary: `Can't advance — ${report.teamName} is ${formatMoney(report.shortfall)} over the salary cap `
      + `(${formatMoney(report.capUsed)} committed against a ${formatMoney(report.capTotal)} ceiling`
      + `${report.deadMoney > 0 ? `, ${formatMoney(report.deadMoney)} of it dead money` : ''}). `
      + `Get back under it and the week will advance. `
      + (steps ? `Fastest route: ${steps}. ` : '')
      + `A restructure or a trade that sends salary out works too — the Cap page lists every option.`,
    blocked: true,
    capBlock: { teamAbbr: report.teamAbbr, shortfall: report.shortfall, path: report.path },
  };
}

async function advanceWeekStep(leagueId: string) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const rng = new Rng(`${settings.simSeed || league.id}-${league.phase}-${league.week}`);

  switch (league.phase) {
    case 'PRESEASON': {
      // Next draft class goes in at week 1, not buried in the offseason —
      // so there's a full season to scout it before it's actually drafted.
      // League creation already seeds year 1's class; guard so a re-run of
      // this step (or that initial seed) never doubles it up.
      const alreadySeeded = await prisma.player.count({ where: { leagueId, isDraftee: true, draftYear: league.seasonYear } });
      if (alreadySeeded === 0) await addDraftClass(leagueId, league.seasonYear, rng);

      // Build this year's schedule if it doesn't exist yet. buildSchedule()
      // used to be called from exactly one place — createLeague() — and
      // nothing in the offseason pipeline ever made another one, so every
      // season after the first played no football at all: weeks advanced,
      // the toast read "0 games played", and nothing told the user anything
      // was wrong. Preseason is the right gate because it is the last phase
      // before REGULAR on every path into a new league year, and
      // ensureSeasonSchedule is idempotent so running it here on a
      // freshly-created league (which already has one) is a no-op.
      const scheduled = await ensureSeasonSchedule(leagueId, league.seasonYear, rng, settings.seasonLength);

      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'REGULAR', week: 1 } });
      return {
        summary: scheduled > 0
          ? `Preseason complete. The ${league.seasonYear} schedule is out — ${scheduled} games across ${settings.seasonLength} weeks. Week 1 is set, and next year's draft class is on the board.`
          : 'Preseason complete. Week 1 is set — next year\'s draft class is on the board.',
      };
    }

    case 'REGULAR':
      return simulateWeek(leagueId, league.week, settings, rng);

    case 'PLAYOFFS':
      return simulatePlayoffRound(leagueId, settings, rng);

    case 'OFFSEASON':
      return runOffseasonStep(leagueId, rng);

    case 'RESIGN': {
      // Whoever the user (or an AI team) didn't extend by now walks.
      const releasedBefore = await prisma.contract.count({ where: { yearsRemaining: 0, player: { leagueId, status: 'ACTIVE' } } });

      // A roster does not lose two thirds of itself in one click without the
      // user being told first. Saves whose RESIGN step ran under the old AI
      // wave reach this point with almost the whole roster expiring — one
      // measured save went from 37 active players to 14 in a single step, with
      // nothing on screen beforehand. The warning stops time exactly ONCE per
      // league year (League.resignWarnedYear): letting a class walk is a real
      // decision a GM is allowed to make, being ambushed by it is not.
      const rosterMin = rosterMinFor(settings.rosterMax || LEAGUE.ROSTER_MAX);
      const userTeam = await prisma.team.findFirst({ where: { leagueId, isUser: true }, select: { id: true, abbr: true } });
      if (userTeam && league.resignWarnedYear !== league.seasonYear) {
        const [active, walking] = await Promise.all([
          prisma.player.count({ where: { teamId: userTeam.id, status: 'ACTIVE' } }),
          prisma.contract.count({ where: { teamId: userTeam.id, yearsRemaining: 0, player: { status: 'ACTIVE' } } }),
        ]);
        const after = active - walking;
        if (walking > 0 && after < rosterMin) {
          await prisma.league.update({ where: { id: leagueId }, data: { resignWarnedYear: league.seasonYear } });
          return {
            summary: `Hold on — advancing now lets ${walking} of your ${active} players walk, leaving the `
              + `${userTeam.abbr} with ${after} under contract against a ${rosterMin}-man minimum. `
              + `Re-sign whoever you mean to keep first; anyone you don't will be available in free agency, `
              + `where you can also sign replacements. Advance again to let them go.`,
            blocked: true,
            block: { title: 'Your roster is about to collapse', href: 'resign', linkLabel: 'Open Re-sign Window' },
          };
        }
      }

      await releaseUnresignedExpiringContracts(leagueId, league.seasonYear);
      // Every AI team that came out of that below a legal roster fills back up
      // immediately, at the league minimum, from the players who just hit the
      // market. Without this a team that had a bad re-sign year stayed 20
      // bodies short for the rest of its existence — measured on 19 of 22
      // pre-existing saves, min roster 27 and median 33.
      const refilled = await fillTeamsToRosterMinimum(leagueId, league.seasonYear, 1, settings, rng);
      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'FREE_AGENCY', week: 1 } });
      return {
        summary: [
          releasedBefore > 0 ? `${releasedBefore} unsigned player(s) hit free agency.` : null,
          refilled > 0 ? `${refilled} minimum-salary signing(s) got short-handed rosters back to a legal size.` : null,
          'Free agency is open.',
        ].filter(Boolean).join(' '),
      };
    }

    case 'FREE_AGENCY': {
      // Short-handed teams get back to a legal roster before the bidding, so
      // the wave isn't the only path back and a team that had a bad re-sign
      // year doesn't spend the season 20 bodies light.
      await fillTeamsToRosterMinimum(leagueId, league.seasonYear, league.week, settings, rng);
      const { signings, displaced } = await runAiFreeAgencyWave(leagueId, league.seasonYear, league.week, settings, rng);
      const displacedNote = displaced > 0 ? ` ${displaced} veteran(s) released to make room.` : '';
      const nextWeek = league.week + 1;
      if (nextWeek > 4) {
        await reseedDraftOrder(leagueId, league.seasonYear);
        await startRookieDraft(leagueId, league.seasonYear, rng);
        return { summary: `Free agency closed. ${signings} signing(s) this week.${displacedNote} The draft is on the clock.` };
      }
      await prisma.league.update({ where: { id: leagueId }, data: { week: nextWeek } });
      return { summary: `Free agency, week ${league.week}: ${signings} AI signing(s) league-wide.${displacedNote}` };
    }

    case 'DRAFT': {
      // Nothing else in the app ever moved the league out of DRAFT once the
      // last pick was made — draftPlayer()/advancePick() mark DraftState
      // complete, but no code path read that flag to advance League.phase,
      // so every league dead-ended here permanently after its first draft.
      const state = await prisma.draftState.findUnique({ where: { leagueId } });
      if (!state?.complete) return { summary: 'Draft is in progress — make your picks, then advance.' };

      // Whoever this class's draft left undrafted was never converted back
      // into an ordinary free agent — isDraftee only ever got cleared inside
      // draftPlayer() for players actually selected. Left unfixed, a stale
      // prospect stays isDraftee:true forever: permanently excluded from
      // normal free agency (which explicitly filters isDraftee out), never
      // aged (progression only runs on status: 'ACTIVE'), and kept
      // resurfacing in every future year's draft pool mixed in with the
      // real new class, since the pool query has no year filter of its own.
      const undrafted = await prisma.player.updateMany({
        where: { leagueId, isDraftee: true, draftYear: { lt: league.seasonYear } },
        data: { isDraftee: false },
      });

      // Final cuts. Free agency and the draft both add bodies and neither
      // has ever read LEAGUE.ROSTER_MAX, so a team could roll into the season
      // carrying 57 players (INV-08). Nobody notices while the re-sign wave
      // is leaking 400 players a year into free agency; once rosters actually
      // recover, cut-down day has to exist.
      const { trimmed, userOverflow } = await trimRostersToLimit(leagueId, league.seasonYear, settings);
      if (userOverflow) {
        return {
          summary: `Can't advance — the ${userOverflow.abbr} are carrying ${userOverflow.rosterSize} players `
            + `against a ${settings.rosterMax}-man limit. Release ${userOverflow.over} `
            + `player${userOverflow.over === 1 ? '' : 's'} and the new league year opens. `
            + `Every other roster in the league has already made its final cuts.`,
          blocked: true,
          block: { title: 'Over the roster limit', href: 'roster', linkLabel: 'Open Roster' },
        };
      }

      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'PRESEASON', week: 1 } });
      return {
        summary: [
          'The draft is complete.',
          undrafted.count > 0 ? `${undrafted.count} undrafted prospect(s) entered free agency.` : null,
          trimmed > 0 ? `${trimmed} player(s) released in final cuts to get every roster to ${settings.rosterMax}.` : null,
          'On to the new league year.',
        ].filter(Boolean).join(' '),
      };
    }

    case 'FANTASY_DRAFT': {
      const state = await prisma.draftState.findUnique({ where: { leagueId } });
      if (!state?.complete) return { summary: 'Fantasy draft is in progress — make your picks, then advance.' };
      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'PRESEASON', week: 1 } });
      return { summary: 'Fantasy draft complete. Setting up your inaugural season.' };
    }

    default:
      return { summary: `Unhandled phase: ${league.phase}` };
  }
}

async function simulateWeek(leagueId: string, week: number, settings: ReturnType<typeof parseSettings>, rng: Rng) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const games = await prisma.game.findMany({
    where: { leagueId, week, seasonYear: league.seasonYear, played: false, kind: 'REGULAR' },
  });

  // What the standings looked like BEFORE kickoff, and the win chance the
  // user was actually shown for their own game. Both have to be read here:
  // once the week is simulated the pre-game record is gone, and recomputing
  // a "pre-game" estimate afterwards against a record that already contains
  // the result is the lying-metric failure this codebase keeps writing down.
  const before = await snapshotBeforeAdvance(leagueId, week, 'REGULAR');

  // Every game in a week touches disjoint teams/players, so they're safe to
  // run concurrently — this was previously a sequential `for` loop awaiting
  // one game at a time, which serialized 16 games' worth of DB round trips
  // for no reason and was the single biggest contributor to slow sim speed.
  const gameRngs = games.map((game) => new Rng(`${rng.next()}-${game.id}`));
  await Promise.all(games.map((game, i) => simulateAndSaveGame(leagueId, game.id, settings, gameRngs[i])));
  const played = games.length;

  // Recover fatigue league-wide between weeks.
  await recoverFatigueAndInjuries(leagueId);
  await applyInSeasonProgression(leagueId, league.seasonYear, week, settings.seasonLength, rng, settings.progressionSpeed);
  // Your staff spent the week on the players you starred. This is the ONLY
  // ongoing scouting input in the game and it runs whether or not the user
  // ever opened a scouting screen — advancing a week is not supposed to be
  // something you can do wrong (lib/shortlistAttention.ts).
  await applyShortlistAttention(leagueId, league.seasonYear, week, settings.simSeed || leagueId);
  await maybeMakeAiTradeOffer(leagueId, league.seasonYear, week, settings, rng);

  const nextWeek = week + 1;
  const seasonOver = nextWeek > settings.seasonLength;
  if (seasonOver) {
    await seedPlayoffs(leagueId);
  } else {
    await prisma.league.update({ where: { id: leagueId }, data: { week: nextWeek } });
  }

  const summary = seasonOver
    ? `Week ${week} complete (${played} games). Regular season is over — playoffs are set.`
    : `Week ${week} complete: ${played} games played.`;

  const report = await buildWeekReport(leagueId, {
    before,
    weekLabel: `Week ${week}`,
    phaseLabel: 'Regular Season',
    gamesPlayed: played,
    summary,
    trackStandings: true,
    wireWeek: week,
    wireScope: 'WEEK',
  });
  return { summary, report };
}

const MAX_PENDING_OFFERS = 3;

/**
 * Unsolicited AI trade offers — the CPU approaching the user, not just the
 * reverse. Capped so the user's inbox doesn't flood; expires stale ones so
 * the list stays current.
 */
async function maybeMakeAiTradeOffer(leagueId: string, seasonYear: number, week: number, settings: ReturnType<typeof parseSettings>, rng: Rng) {
  if (!settings.tradesEnabled) return;
  if (settings.tradeDeadlineEnabled && isTradeDeadlinePassed('REGULAR', week, settings.tradeDeadlineWeek)) return;
  const userTeam = await prisma.team.findFirst({ where: { leagueId, isUser: true } });
  if (!userTeam) return;

  // Offers expire after 1 week unanswered — visible the week they arrive
  // and the week after, then gone.
  await prisma.tradeOffer.updateMany({
    where: { leagueId, toTeamId: userTeam.id, status: 'PENDING', week: { lt: week - 1 } },
    data: { status: 'EXPIRED' },
  });

  const pendingCount = await prisma.tradeOffer.count({ where: { leagueId, toTeamId: userTeam.id, status: 'PENDING' } });
  if (pendingCount >= MAX_PENDING_OFFERS) return;

  const offer = await maybeGenerateAiTradeOffer(leagueId, userTeam.id, rng, settings.aiTradeFrequency);
  if (!offer) return;

  await prisma.tradeOffer.create({
    data: {
      leagueId, fromTeamId: offer.fromTeamId, toTeamId: userTeam.id,
      give: writeJson(offer.offer.give), request: writeJson(offer.offer.get),
      blurb: offer.blurb, seasonYear, week,
    },
  });
}

export async function simulateAndSaveGame(leagueId: string, gameId: string, settings: ReturnType<typeof parseSettings>, rng: Rng) {
  const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId } });
  const [home, away] = await Promise.all([loadSimTeam(game.homeTeamId), loadSimTeam(game.awayTeamId)]);

  const result = simulateGame(home, away, settings, rng, { allowTie: true });
  const recap = generateRecap(result.boxScore, settings, rng);

  await prisma.$transaction(async (tx) => {
    await tx.game.update({
      where: { id: gameId },
      data: {
        played: true, homeScore: result.homeScore, awayScore: result.awayScore,
        boxScore: writeJson(result.boxScore), recap,
      },
    });

    // Regular season only. This used to run for every game including the
    // postseason, so a champion's four playoff wins were added straight into
    // team.wins — and TeamSeasonRecord is built from team.wins, which is how
    // a 17-game season produced "2026 Champions (19-1)", 20-game division
    // tables, and a title-winning team displayed third in its own division.
    // Playoff results are already carried by the Game rows themselves and by
    // TeamSeasonRecord.playoffResult; nothing needs them in the standings.
    if (game.kind === 'REGULAR') {
      await updateStandings(tx as any, game.homeTeamId, game.awayTeamId, result.homeScore, result.awayScore);
    }

    // Every per-player effect below used to be one awaited UPDATE per row —
    // for a 53-man-ish box score that's a hundred-plus sequential round
    // trips per game, times 16 games a week. Collapse each into a single
    // bulk statement instead.
    await bulkSetInt(tx, 'injuryWeeks', Object.entries(fatigueMapToInjuries(result)));
    await bulkSetText(tx, 'injuryType', result.injuries.map((i): [string, string] => [i.playerId, i.type]));
    await bulkIncrementInt(tx, 'fatigue', Object.entries(result.fatigue));

    const newsRows: { leagueId: string; seasonYear: number; week: number; type: string; teamId?: string; headline: string; detail: string }[] = [];
    if (result.injuries.length > 0) {
      newsRows.push({
        leagueId, seasonYear: game.seasonYear, week: game.week, type: 'INJURY',
        headline: `${result.injuries.length} injury report(s) from ${home.abbr} @ ${away.abbr}`,
        detail: result.boxScore.injuries.map((i) => `${i.name} (${i.weeks}w)`).join(', '),
      });
    }
    for (const item of gameHeadlines(result.boxScore, game.homeTeamId, game.awayTeamId)) {
      newsRows.push({ leagueId, seasonYear: game.seasonYear, week: game.week, type: 'NEWS', teamId: item.teamId, headline: item.headline, detail: item.detail });
    }
    if (newsRows.length > 0) await tx.transaction.createMany({ data: newsRows });

    const allLines = [...result.boxScore.lines.home, ...result.boxScore.lines.away];
    const existing = await tx.player.findMany({ where: { id: { in: allLines.map((l) => l.playerId) } }, select: { id: true, seasonStats: true } });
    const existingById = new Map(existing.map((p) => [p.id, p.seasonStats]));
    const statUpdates: [string, string][] = allLines.map((line) => {
      const current = readJson<SeasonStats>(existingById.get(line.playerId), {});
      return [line.playerId, writeJson(mergeStats(current, line.stats))];
    });
    await bulkSetText(tx, 'seasonStats', statUpdates);
  });

  return result;
}

/**
 * Bulk per-row writes via `UPDATE ... FROM (VALUES ...)`. Postgres can do
 * hundreds of independent row updates in one round trip this way — the
 * naive alternative (one `prisma.player.update` per player, awaited in a
 * loop) was the dominant cost of simulating a week, especially against a
 * hosted DB where every round trip pays real network latency.
 */
async function bulkSetInt(tx: Prisma.TransactionClient, column: 'injuryWeeks', entries: [string, number][]) {
  if (entries.length === 0) return;
  const values = Prisma.join(entries.map(([id, v]) => Prisma.sql`(${id}::text, ${v}::int)`));
  await tx.$executeRaw`UPDATE "Player" AS p SET "${Prisma.raw(column)}" = v.val FROM (VALUES ${values}) AS v(id, val) WHERE p.id = v.id`;
}

async function bulkIncrementInt(tx: Prisma.TransactionClient, column: 'fatigue', entries: [string, number][]) {
  if (entries.length === 0) return;
  const values = Prisma.join(entries.map(([id, v]) => Prisma.sql`(${id}::text, ${v}::int)`));
  await tx.$executeRaw`UPDATE "Player" AS p SET "${Prisma.raw(column)}" = p."${Prisma.raw(column)}" + v.val FROM (VALUES ${values}) AS v(id, val) WHERE p.id = v.id`;
}

async function bulkSetText(tx: Prisma.TransactionClient, column: 'seasonStats' | 'careerStats' | 'injuryType', entries: [string, string][]) {
  if (entries.length === 0) return;
  const values = Prisma.join(entries.map(([id, v]) => Prisma.sql`(${id}::text, ${v}::text)`));
  await tx.$executeRaw`UPDATE "Player" AS p SET "${Prisma.raw(column)}" = v.val FROM (VALUES ${values}) AS v(id, val) WHERE p.id = v.id`;
}

function fatigueMapToInjuries(result: Awaited<ReturnType<typeof simulateGame>>) {
  const map: Record<string, number> = {};
  for (const i of result.injuries) map[i.playerId] = i.weeks;
  return map;
}

async function loadSimTeam(teamId: string): Promise<SimTeamInput> {
  const [team, players, staff, depthSlots] = await Promise.all([
    prisma.team.findUniqueOrThrow({ where: { id: teamId } }),
    prisma.player.findMany({ where: { teamId, status: 'ACTIVE' } }),
    prisma.staff.findMany({ where: { teamId } }),
    prisma.depthChartSlot.findMany({ where: { teamId }, orderBy: { rank: 'asc' } }),
  ]);

  const depthOrder: Record<string, string[]> = {};
  for (const slot of depthSlots) (depthOrder[slot.position] ??= []).push(slot.playerId);

  return {
    id: team.id, abbr: team.abbr, name: `${team.city} ${team.nickname}`, isUser: team.isUser,
    offScheme: team.offScheme, defScheme: team.defScheme,
    players: players.map((p): SimPlayer => ({
      id: p.id, firstName: p.firstName, lastName: p.lastName, position: p.position,
      trueOvr: p.trueOvr, trueAttrs: p.trueAttrs, status: p.status, injuryWeeks: p.injuryWeeks, fatigue: p.fatigue,
    })),
    staff: staff.map((s): SimStaff => ({ role: s.role, playCalling: s.playCalling, rating: s.rating, scheme: s.scheme })),
    depthOrder,
  };
}

async function updateStandings(tx: typeof prisma, homeId: string, awayId: string, homeScore: number, awayScore: number) {
  const [home, away] = await Promise.all([
    tx.team.findUniqueOrThrow({ where: { id: homeId } }),
    tx.team.findUniqueOrThrow({ where: { id: awayId } }),
  ]);
  const sameDiv = home.division === away.division && home.conference === away.conference;
  const sameConf = home.conference === away.conference;

  const apply = async (teamId: string, pf: number, pa: number, won: boolean, tied: boolean, divRelevant: boolean, confRelevant: boolean) => {
    await tx.team.update({
      where: { id: teamId },
      data: {
        pointsFor: { increment: pf },
        pointsAgnst: { increment: pa },
        wins: { increment: won && !tied ? 1 : 0 },
        losses: { increment: !won && !tied ? 1 : 0 },
        ties: { increment: tied ? 1 : 0 },
        divWins: { increment: divRelevant && won && !tied ? 1 : 0 },
        divLosses: { increment: divRelevant && !won && !tied ? 1 : 0 },
        confWins: { increment: confRelevant && won && !tied ? 1 : 0 },
        confLosses: { increment: confRelevant && !won && !tied ? 1 : 0 },
      },
    });
  };

  const tied = homeScore === awayScore;
  await apply(homeId, homeScore, awayScore, homeScore > awayScore, tied, sameDiv, sameConf);
  await apply(awayId, awayScore, homeScore, awayScore > homeScore, tied, sameDiv, sameConf);
}

async function recoverFatigueAndInjuries(leagueId: string) {
  const { SIM } = await import('./tuning');
  // Was one findMany + one sequential awaited UPDATE per active player in the
  // whole league (~1,700 round trips for a 32-team league) every single
  // week. A single bulk statement does the same work in one round trip.
  await prisma.$executeRaw`
    UPDATE "Player"
    SET "fatigue" = GREATEST("fatigue" - ${SIM.FATIGUE_RECOVERY}, 0),
        "injuryWeeks" = GREATEST("injuryWeeks" - 1, 0),
        "injuryType" = CASE WHEN GREATEST("injuryWeeks" - 1, 0) = 0 THEN NULL ELSE "injuryType" END
    WHERE "leagueId" = ${leagueId} AND "status" = 'ACTIVE' AND ("fatigue" > 0 OR "injuryWeeks" > 0)
  `;
}

// ---------------------------------------------------------------------------
// Playoffs
// ---------------------------------------------------------------------------

async function seedPlayoffs(leagueId: string) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const teams = await prisma.team.findMany({ where: { leagueId } });

  for (const conf of ['AFC', 'NFC'] as const) {
    const confTeams = teams.filter((t) => t.conference === conf);
    const divisions = Array.from(new Set(confTeams.map((t) => t.division)));
    const divWinners = divisions
      .map((div) => confTeams.filter((t) => t.division === div).sort(byStanding)[0])
      .sort(byStanding);
    const others = confTeams.filter((t) => !divWinners.includes(t)).sort(byStanding);
    const wildcards = others.slice(0, Math.max(0, LEAGUE.PLAYOFF_TEAMS_PER_CONF - divWinners.length));
    const seeded = [...divWinners, ...wildcards].slice(0, LEAGUE.PLAYOFF_TEAMS_PER_CONF);
    for (let i = 0; i < seeded.length; i++) {
      await prisma.team.update({ where: { id: seeded[i].id }, data: { playoffSeed: i + 1 } });
    }
    for (const t of confTeams) {
      if (!seeded.find((s) => s.id === t.id)) await prisma.team.update({ where: { id: t.id }, data: { eliminated: true } });
    }
  }

  await createWildcardRound(leagueId, league.seasonYear);
  await prisma.league.update({ where: { id: leagueId }, data: { phase: 'PLAYOFFS', week: 1 } });
}

/**
 * The order teams stand in. Formula unchanged — it now delegates to
 * lib/standingsOrder.ts so that anything DISPLAYING a rank ("3rd -> 1st in
 * the division" in the week report) is sorted by the same function that
 * seeds the actual bracket, rather than by a lookalike that could drift.
 */
function byStanding(a: { id?: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgnst: number }, b: typeof a) {
  return standingsCompare({ id: a.id ?? '', ...a }, { id: b.id ?? '', ...b });
}

async function createWildcardRound(leagueId: string, seasonYear: number) {
  for (const conf of ['AFC', 'NFC'] as const) {
    const seeded = await prisma.team.findMany({ where: { leagueId, conference: conf, playoffSeed: { not: null } }, orderBy: { playoffSeed: 'asc' } });
    // [TUNE] 6-seed bracket: 1 & 2 bye. 3v6, 4v5.
    const pairs: [number, number][] = [[3, 6], [4, 5]];
    for (const [hi, lo] of pairs) {
      const home = seeded.find((t) => t.playoffSeed === hi);
      const away = seeded.find((t) => t.playoffSeed === lo);
      if (home && away) {
        await prisma.game.create({
          data: { leagueId, seasonYear, week: 1, kind: 'WILDCARD', homeTeamId: home.id, awayTeamId: away.id },
        });
      }
    }
  }
}

async function simulatePlayoffRound(leagueId: string, settings: ReturnType<typeof parseSettings>, rng: Rng) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const pending = await prisma.game.findMany({ where: { leagueId, played: false, kind: { not: 'REGULAR' } } });

  // Same snapshot rule as the regular season: the pre-game win chance for the
  // user's own postseason game only exists before it is played.
  const before = await snapshotBeforeAdvance(leagueId, league.week, 'PLAYOFF');
  const roundKind = pending[0]?.kind ?? 'FINAL';

  for (const game of pending) {
    await simulateAndSaveGame(leagueId, game.id, settings, new Rng(`${rng.next()}-${game.id}`));
  }

  const kindsPlayed = new Set((await prisma.game.findMany({ where: { leagueId, kind: { not: 'REGULAR' } } })).map((g) => g.kind));

  // Playoff standings are deliberately NOT tracked here — postseason results
  // never touch Team.wins (see simulateAndSaveGame), so a "record went from
  // X to Y" band would be printing an unchanged number as if it moved.
  const roundReport = async (summary: string) => buildWeekReport(leagueId, {
    before,
    weekLabel: PLAYOFF_ROUND_LABEL[roundKind] ?? 'Playoffs',
    phaseLabel: 'Playoffs',
    gamesPlayed: pending.length,
    summary,
    trackStandings: false,
    wireWeek: pending[0]?.week ?? league.week,
    wireScope: 'LATEST',
  });

  if (kindsPlayed.has('WILDCARD') && !kindsPlayed.has('DIVISIONAL')) {
    await createNextPlayoffRound(leagueId, league.seasonYear, 'WILDCARD', 'DIVISIONAL');
    const summary = 'Wild card round complete. Divisional round is set.';
    return { summary, report: await roundReport(summary), trophy: await buildTrophyMoment(leagueId, league.seasonYear, roundKind) };
  }
  if (kindsPlayed.has('DIVISIONAL') && !kindsPlayed.has('CONFERENCE')) {
    await createNextPlayoffRound(leagueId, league.seasonYear, 'DIVISIONAL', 'CONFERENCE');
    const summary = 'Divisional round complete. Conference championships are set.';
    return { summary, report: await roundReport(summary), trophy: await buildTrophyMoment(leagueId, league.seasonYear, roundKind) };
  }
  if (kindsPlayed.has('CONFERENCE') && !kindsPlayed.has('FINAL')) {
    await createFinal(leagueId, league.seasonYear);
    const summary = 'Conference championships complete. The final is set.';
    return { summary, report: await roundReport(summary), trophy: await buildTrophyMoment(leagueId, league.seasonYear, roundKind) };
  }
  if (kindsPlayed.has('FINAL')) {
    await snapshotSeasonHistory(leagueId, league.seasonYear);
    await recordSeasonAwards(leagueId, league.seasonYear, league.week);
    await fireStrugglingCoordinators(leagueId, league.seasonYear, rng);
    // The contract ledger steps onto the NEXT league year here, the instant
    // the season is over — not three offseason steps later. See
    // ageContractsForYear() for why the old timing made an early cut cost
    // more than an identical late one.
    await ageContractsForYear(leagueId, league.seasonYear + 1);
    // Built BEFORE the phase flips to OFFSEASON so the season being described
    // is still the season the league is standing in.
    const summary = 'The championship game is complete! Welcome to the offseason.';
    const trophy = await buildTrophyMoment(leagueId, league.seasonYear, roundKind);
    const report = await roundReport(summary);
    await prisma.league.update({ where: { id: leagueId }, data: { phase: 'OFFSEASON', week: 1 } });
    return { summary, report, trophy };
  }
  return { summary: 'Playoffs advanced.' };
}

/** Round names, for the report's header. */
const PLAYOFF_ROUND_LABEL: Record<string, string> = {
  WILDCARD: 'Wild Card Round',
  DIVISIONAL: 'Divisional Round',
  CONFERENCE: 'Conference Championships',
  FINAL: 'The Final',
};

/**
 * Freeze this year's final standings + playoff result into TeamSeasonRecord.
 * Team.wins/losses/etc. get wiped by RESET_STANDINGS a few offseason steps
 * from now — this snapshot is the only place that history survives.
 */
async function snapshotSeasonHistory(leagueId: string, seasonYear: number) {
  const teams = await prisma.team.findMany({ where: { leagueId } });
  const playoffGames = await prisma.game.findMany({ where: { leagueId, seasonYear, kind: { not: 'REGULAR' }, played: true } });

  const ROUND_EXIT: Record<string, string> = { WILDCARD: 'WILDCARD', DIVISIONAL: 'DIVISIONAL', CONFERENCE: 'CONFERENCE', FINAL: 'RUNNER_UP' };
  const resultByTeam = new Map<string, string>();
  for (const g of playoffGames) {
    const loserId = g.homeScore >= g.awayScore ? g.awayTeamId : g.homeTeamId;
    resultByTeam.set(loserId, ROUND_EXIT[g.kind] ?? g.kind);
    if (g.kind === 'FINAL') {
      const winnerId = g.homeScore >= g.awayScore ? g.homeTeamId : g.awayTeamId;
      resultByTeam.set(winnerId, 'CHAMPION');
    }
  }

  for (const t of teams) {
    const playoffResult = resultByTeam.get(t.id) ?? 'MISSED';
    await prisma.teamSeasonRecord.upsert({
      where: { teamId_year: { teamId: t.id, year: seasonYear } },
      create: { leagueId, teamId: t.id, year: seasonYear, wins: t.wins, losses: t.losses, ties: t.ties, pointsFor: t.pointsFor, pointsAgnst: t.pointsAgnst, playoffResult },
      update: { wins: t.wins, losses: t.losses, ties: t.ties, pointsFor: t.pointsFor, pointsAgnst: t.pointsAgnst, playoffResult },
    });
  }

  const championId = [...resultByTeam.entries()].find(([, r]) => r === 'CHAMPION')?.[0];
  const champ = teams.find((t) => t.id === championId);
  if (champ) {
    await prisma.transaction.create({
      data: {
        leagueId, seasonYear, week: 4, type: 'CHAMPION', teamId: champ.id,
        headline: `The ${champ.city} ${champ.nickname} are your ${seasonYear} champions!`,
        detail: `Finished ${champ.wins}-${champ.losses}${champ.ties ? `-${champ.ties}` : ''}, ${champ.pointsFor} points for.`,
      },
    });
  }
}

/**
 * League awards, computed from this season's final stat lines and recorded
 * as Transaction rows (type AWARD) so they persist in the news feed and can
 * drive the end-of-season dashboard announcement — same durability pattern
 * as the CHAMPION transaction right above this call.
 */
async function recordSeasonAwards(leagueId: string, seasonYear: number, week: number) {
  const { computeSeasonAwards } = await import('./awards');
  const awards = await computeSeasonAwards(leagueId, seasonYear);
  const entries: [string, typeof awards.mvp][] = [
    ['AWARD_MVP', awards.mvp],
    ['AWARD_OPOY', awards.opoy],
    ['AWARD_DPOY', awards.dpoy],
    ['AWARD_ROTY', awards.roty],
    ['AWARD_SBMVP', awards.sbmvp],
  ];
  for (const [type, winner] of entries) {
    if (!winner) continue;
    // headline/detail carry only the player's own info (not the award name —
    // that's derived from `type` by every reader) so nothing here needs
    // parsing back apart later.
    await prisma.transaction.create({
      data: {
        leagueId, seasonYear, week, type, teamId: winner.teamId,
        headline: `${winner.name} (${winner.position})`,
        detail: winner.statLine,
      },
    });
    await applyAwardDevelopmentBump(winner.playerId);
  }
}

/**
 * A season award is a real, deliberate jump to both current rating and
 * potential ceiling — bigger than an in-season stat-leader milestone (see
 * lib/development.ts), since it's earned across a full year of production
 * (or, for Super Bowl MVP, a defining performance on the biggest stage)
 * rather than a mid-season snapshot.
 */
async function applyAwardDevelopmentBump(playerId: string) {
  const player = await prisma.player.findUnique({ where: { id: playerId }, select: { trueAttrs: true, position: true, potential: true } });
  if (!player) return;
  const attrs = readJson<AttrMap>(player.trueAttrs, {});
  const bumped = bumpForMilestone(player.position as Position, attrs, player.potential, PROGRESSION.AWARD_OVR_BUMP, PROGRESSION.AWARD_POTENTIAL_BUMP);
  await prisma.player.update({
    where: { id: playerId },
    data: { trueAttrs: writeJson(bumped.attrs), trueOvr: bumped.ovr, potential: bumped.potential },
  });
}

async function createNextPlayoffRound(leagueId: string, seasonYear: number, fromKind: string, toKind: string) {
  const games = await prisma.game.findMany({ where: { leagueId, kind: fromKind, played: true } });
  const winners: { id: string; conference: string; seed: number }[] = [];
  for (const g of games) {
    const winnerId = g.homeScore >= g.awayScore ? g.homeTeamId : g.awayTeamId;
    const t = await prisma.team.findUniqueOrThrow({ where: { id: winnerId } });
    winners.push({ id: t.id, conference: t.conference, seed: t.playoffSeed ?? 99 });
  }
  // Byes advance automatically into the divisional round.
  if (fromKind === 'WILDCARD') {
    const byes = await prisma.team.findMany({ where: { leagueId, playoffSeed: { in: [1, 2] } } });
    winners.push(...byes.map((t) => ({ id: t.id, conference: t.conference, seed: t.playoffSeed! })));
  }
  for (const conf of ['AFC', 'NFC'] as const) {
    const confWinners = winners.filter((w) => w.conference === conf).sort((a, b) => a.seed - b.seed);
    for (let i = 0; i < confWinners.length; i += 2) {
      if (confWinners[i + 1]) {
        await prisma.game.create({
          data: { leagueId, seasonYear, week: 2, kind: toKind, homeTeamId: confWinners[i].id, awayTeamId: confWinners[i + 1].id },
        });
      }
    }
  }
}

async function createFinal(leagueId: string, seasonYear: number) {
  const games = await prisma.game.findMany({ where: { leagueId, kind: 'CONFERENCE', played: true } });
  const winners = games.map((g) => (g.homeScore >= g.awayScore ? g.homeTeamId : g.awayTeamId));
  if (winners.length === 2) {
    await prisma.game.create({
      data: { leagueId, seasonYear, week: 4, kind: 'FINAL', homeTeamId: winners[0], awayTeamId: winners[1] },
    });
  }
}

// ---------------------------------------------------------------------------
// Offseason
// ---------------------------------------------------------------------------

const OFFSEASON_STEPS = ['PROGRESS', 'RESET_STANDINGS', 'AGE_CONTRACTS', 'ADD_DRAFT_CLASS', 'RESIGN'] as const;

async function runOffseasonStep(leagueId: string, rng: Rng) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const step = OFFSEASON_STEPS[Math.min(league.week - 1, OFFSEASON_STEPS.length - 1)];

  switch (step) {
    case 'PROGRESS': {
      await progressAllPlayers(leagueId, rng, settings.retirementEnabled);
      // Free agents age on the same schedule. Skipping them is what turned the
      // unsigned pool into a permanent sink — see progressFreeAgents().
      const fa = await progressFreeAgents(leagueId, rng, {
        retirementEnabled: settings.retirementEnabled,
        progressionSpeed: settings.progressionSpeed,
      });
      await prisma.league.update({ where: { id: leagueId }, data: { week: league.week + 1 } });
      return {
        summary: 'Rosters have aged a year — some careers are over, the rest are a year further along.'
          + (fa.retired > 0 ? ` ${fa.retired} unsigned player(s) are out of football.` : ''),
      };
    }
    case 'RESET_STANDINGS': {
      await rollSeasonStatsIntoCareer(leagueId, league.seasonYear);
      await prisma.team.updateMany({
        where: { leagueId },
        data: { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgnst: 0, divWins: 0, divLosses: 0, confWins: 0, confLosses: 0, playoffSeed: null, eliminated: false },
      });
      await prisma.league.update({ where: { id: leagueId }, data: { week: league.week + 1, seasonYear: league.seasonYear + 1 } });
      // This is the one line in the phase machine where seasonYear actually
      // moves, so it is where a per-season allowance turns over. Private
      // workout slots are stamped with the year they belong to and would read
      // as zero-used anyway; zeroing them here means the count on screen
      // changes with the calendar rather than on the next spend.
      await resetWorkoutSlots(leagueId, league.seasonYear + 1);
      return { summary: 'Standings reset for the new league year.' };
    }
    case 'AGE_CONTRACTS': {
      // Normally a no-op now: the ledger already stepped onto this league year
      // when the season ended. It still runs for any save created before
      // League.contractsAgedYear existed, which reached this point with its
      // contracts un-aged — that is the whole point of making the call
      // idempotent rather than moving it outright.
      const aged = await ageContractsForYear(leagueId, league.seasonYear);
      await expireStaleCapCharges(leagueId, league.seasonYear);
      await prisma.league.update({ where: { id: leagueId }, data: { week: league.week + 1 } });
      return {
        summary: aged
          ? 'Contracts advanced a year — expiring deals are up for renegotiation.'
          : 'Expiring deals are up for renegotiation.',
      };
    }
    case 'ADD_DRAFT_CLASS': {
      // This year's class was already added back at week 1 of the season
      // that just ended, so it could be scouted all year — this step now
      // only extends the rolling future-picks horizon for pick trading.
      await addFutureDraftPicks(leagueId, league.seasonYear);
      await prisma.league.update({ where: { id: leagueId }, data: { week: league.week + 1 } });
      return { summary: 'Future draft pick slots extended.' };
    }
    case 'RESIGN':
    default: {
      // AI teams make their own keep-or-let-walk calls before the user
      // lands on the re-sign screen, same as a real front office already
      // having a plan by the time the window opens.
      await runAiResignWave(leagueId, league.seasonYear, league.week, settings.capMode, rng);
      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'RESIGN', week: 1 } });
      return { summary: 'Re-sign your own expiring players, then advance to open free agency.' };
    }
  }
}

const FIRE_WIN_PCT_THRESHOLD = 0.3; // [TUNE] roughly 5 wins or fewer in a 17-game season

/**
 * AI-only: a bad enough season gets a coordinator fired, replaced with a
 * freshly generated coach — the same generation used at league creation.
 * User teams are never auto-fired; coaching is the user's call.
 */
async function fireStrugglingCoordinators(leagueId: string, seasonYear: number, rng: Rng) {
  const teams = await prisma.team.findMany({ where: { leagueId, isUser: false } });
  for (const t of teams) {
    const gp = t.wins + t.losses + t.ties;
    if (gp === 0 || t.wins / gp >= FIRE_WIN_PCT_THRESHOLD) continue;

    const coords = await prisma.staff.findMany({ where: { teamId: t.id, role: { in: ['OC', 'DC'] } } });
    if (coords.length === 0) continue;
    const fired = coords.sort((a, b) => a.rating - b.rating)[0];

    const rating = rng.normalClamped(55, 12, 25, 95);
    await prisma.staff.update({
      where: { id: fired.id },
      data: {
        name: `${rng.pick(COACH_FIRST)} ${rng.pick(COACH_LAST)}`,
        rating,
        playCalling: rng.normalClamped(rating, 8, 20, 99),
        development: rng.normalClamped(rating, 10, 20, 99),
        contractYears: rng.int(2, 5),
      },
    });
    await prisma.transaction.create({
      data: {
        leagueId, seasonYear, week: 4, type: 'FIRE', teamId: t.id,
        headline: `${t.city} fires ${fired.role} after a ${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''} season`,
        detail: `${fired.name} is out. The team has promoted a replacement from within.`,
      },
    });
  }
}

/**
 * Fold this year's accumulated seasonStats into careerStats, then clear
 * seasonStats for the new year. Runs for every player who's ever had a stat
 * line, active or not, so a player cut mid-season still keeps what he earned.
 * Also checks the just-finalized season/career lines against LeagueRecord
 * while both are in hand — see lib/records.ts.
 */
async function rollSeasonStatsIntoCareer(leagueId: string, seasonYear: number) {
  const players = await prisma.player.findMany({
    where: { leagueId, NOT: { seasonStats: '{}' } },
    select: { id: true, firstName: true, lastName: true, seasonStats: true, careerStats: true, team: { select: { abbr: true } } },
  });
  const recordInputs: Parameters<typeof checkAndUpdateRecords>[2] = [];
  for (const p of players) {
    const season = readJson<SeasonStats>(p.seasonStats, {});
    if (Object.keys(season).length === 0) continue;
    const career = mergeStats(readJson<SeasonStats>(p.careerStats, {}), season);
    await prisma.player.update({ where: { id: p.id }, data: { careerStats: writeJson(career), seasonStats: '{}' } });
    recordInputs.push({ id: p.id, firstName: p.firstName, lastName: p.lastName, teamAbbr: p.team?.abbr ?? 'FA', seasonFinal: season, careerFinal: career });
  }

  const breaks = await checkAndUpdateRecords(leagueId, seasonYear, recordInputs);
  for (const b of breaks) {
    await prisma.transaction.create({
      data: { leagueId, seasonYear, week: 1, type: 'NEWS', teamId: null, headline: 'League Record', detail: recordBreakHeadline(b) },
    });
  }
}

/**
 * Yearly aging for ROSTERED players: age +1, a completed season of experience,
 * and (past 32) a retirement roll. Unsigned players are handled by
 * progressFreeAgents() in lib/development.ts — this deliberately narrow
 * `status: 'ACTIVE'` filter used to be the ONLY aging in the game, which is
 * why a free agent never aged, never developed and never retired. Attribute growth itself no longer happens here — it's
 * spread across in-season checkpoints all year (see lib/development.ts) so
 * it's visible well before the offseason, not delivered as one lump. Batched
 * into two updateMany calls instead of one round trip per player, matching
 * the bulk-write pattern used everywhere else a whole league gets touched.
 */
async function progressAllPlayers(leagueId: string, rng: Rng, retirementEnabled: boolean) {
  const players = await prisma.player.findMany({
    where: { leagueId, status: 'ACTIVE' },
    select: { id: true, age: true, trueOvr: true, position: true },
  });
  if (players.length === 0) return;

  const retiringIds: string[] = [];
  const survivorIds: string[] = [];
  for (const p of players) {
    if (retirementEnabled && p.age >= 32 && rng.bool(retirementChance(p.age, p.trueOvr, p.position as any))) {
      retiringIds.push(p.id);
    } else {
      survivorIds.push(p.id);
    }
  }

  if (retiringIds.length > 0) {
    // Retirement never deleted the player's Contract row (a longstanding
    // bug — every other path off an active roster does), leaving a stale
    // contract attached to a player nobody could ever cut or extend again.
    await prisma.contract.deleteMany({ where: { playerId: { in: retiringIds } } });
    await prisma.player.updateMany({ where: { id: { in: retiringIds } }, data: { status: 'RETIRED', teamId: null } });
  }
  if (survivorIds.length > 0) {
    await prisma.player.updateMany({
      where: { id: { in: survivorIds } },
      data: { age: { increment: 1 }, experience: { increment: 1 }, fatigue: 0, injuryWeeks: 0 },
    });
  }
}

/**
 * Step every contract onto `targetYear`. A deal that hits 0 remaining years is
 * NOT released here — that used to happen automatically, which meant
 * every "expiring" player vanished to free agency before the RESIGN phase
 * (where the user is supposed to get a chance to extend them) ever ran.
 * They now sit at 0 years remaining — still rostered, flagged as pending
 * free agents — until releaseUnresignedExpiringContracts() actually lets
 * whichever ones weren't re-signed go, once RESIGN is over.
 *
 * WHEN this runs is a cap-correctness question, not a cosmetic one. It used
 * to be the OFFSEASON week-3 step, two steps after capChargeYear() starts
 * filing dead money against the NEXT league year — so a cut made in OFFSEASON
 * week 1 computed its dead money off an un-aged `yearsRemaining` and charged
 * the result to a year the contract had already spent one season of. Measured:
 * a 4-year deal with $17.76M of bonus ($4.44M/yr of proration) and 3 years
 * remaining booked $13.32M against 2027 when cut at OFFSEASON wk1, and $8.88M
 * against the same 2027 when cut two steps later — $4.44M of dead money
 * created by nothing but timing, and always in the direction that punished
 * acting early.
 *
 * Aging the ledger the moment the season ends closes that window at the
 * source instead of asking every reader of a contract to correct for it:
 * deadMoneyOnCut(), capHit(), capSavingsOnCut(), the Cap page's savings and
 * dead-money columns and capComplianceReport's escape path all describe the
 * same league year a charge booked right now would land in, with no extra
 * argument to remember to pass.
 *
 * Idempotent, keyed on League.contractsAgedYear, because it is now called
 * from two places: the end of the playoffs (for the year being entered) and
 * the offseason AGE_CONTRACTS step (a catch-up for saves that predate the
 * column, which would otherwise never age again). Returns whether it did
 * anything.
 */
async function ageContractsForYear(leagueId: string, targetYear: number): Promise<boolean> {
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: leagueId }, select: { contractsAgedYear: true },
  });
  if (league.contractsAgedYear != null && league.contractsAgedYear >= targetYear) return false;

  await prisma.contract.updateMany({
    where: { player: { leagueId, status: 'ACTIVE' }, yearsRemaining: { gt: 0 } },
    data: { yearsRemaining: { decrement: 1 } },
  });
  await prisma.league.update({ where: { id: leagueId }, data: { contractsAgedYear: targetYear } });
  return true;
}

/** Dead money charges only apply to the year they were incurred. */
async function expireStaleCapCharges(leagueId: string, seasonYear: number) {
  const teams = await prisma.team.findMany({ where: { leagueId }, select: { id: true } });
  await prisma.capCharge.deleteMany({
    where: { year: { lt: seasonYear }, teamId: { in: teams.map((t) => t.id) } },
  });
}

/**
 * Free agents that walk: anyone still sitting at 0 years remaining once
 * RESIGN is over — the user (or AI) had their chance to extend and didn't.
 *
 * Void years settle here. They're cap-only trailing years: they widen the
 * proration divisor to shrink the hit during the real years, which strands
 * part of the signing bonus that was never charged to anyone. In real
 * football that stranded proration accelerates onto the cap the moment the
 * real deal ends — void years are borrowing against the future, and this is
 * where the bill arrives. Without this the slider was free money, since a
 * cap charge was only ever raised by cutting a player early.
 */
async function releaseUnresignedExpiringContracts(leagueId: string, seasonYear: number) {
  const expired = await prisma.contract.findMany({
    where: { yearsRemaining: 0, player: { leagueId, status: 'ACTIVE' } },
    include: { player: true },
  });
  for (const c of expired) {
    // Charged so far = proration × the real years actually played. Anything
    // left of the bonus is what the void years pushed past the deal's end.
    const stranded = c.voidYears > 0
      ? Math.max(0, c.signingBonus - proration(c) * c.years)
      : 0;
    if (stranded > 0 && c.teamId) {
      await prisma.capCharge.create({
        data: {
          teamId: c.teamId,
          year: seasonYear,
          amount: stranded,
          label: `Void years — ${c.player.firstName} ${c.player.lastName}`,
        },
      });
    }
    await prisma.contract.delete({ where: { id: c.id } });
    await prisma.player.update({ where: { id: c.playerId }, data: { status: 'FREE_AGENT', teamId: null } });
  }
}

/**
 * Cut-down day. Free agency and the rookie draft both add players and
 * neither checks LEAGUE.ROSTER_MAX / settings.rosterMax — that limit was
 * only ever read at league generation, which is exactly what INV-08 flags.
 * Run once, when the draft closes, so every roster enters the new league
 * year legal.
 *
 * On AI teams the worst players go, by true rating. Their dead money is booked
 * like any other cut, because over-signing has to cost something — but the
 * players at the bottom of a 57-man roster are on small deals, so the bill is
 * small. One transaction per team rather than one per player: 100+ individual
 * CUT rows a year would bury the wire.
 *
 * The USER's team is never trimmed. This used to run `findMany({ where: {
 * leagueId } })` with no isUser filter, sort the human's roster by `trueOvr`
 * ascending and waive the overflow — releasing players the user chose, booking
 * dead money against him, and picking the victims by a rating the fog-of-war
 * settings mean he cannot even see. Deciding who to cut is the single most
 * characteristic decision in the genre; the game does not get to make it. When
 * the user is over the limit the advance is blocked instead, the same shape the
 * cap-compliance gate already uses, and he cuts whoever he wants to cut.
 */
async function trimRostersToLimit(
  leagueId: string, seasonYear: number, settings: LeagueSettings,
): Promise<{ trimmed: number; userOverflow: { abbr: string; over: number; rosterSize: number } | null }> {
  const limit = settings.rosterMax || LEAGUE.ROSTER_MAX;
  const teams = await prisma.team.findMany({ where: { leagueId }, select: { id: true, abbr: true, isUser: true } });
  let total = 0;
  let userOverflow: { abbr: string; over: number; rosterSize: number } | null = null;

  for (const team of teams) {
    const roster = await prisma.player.findMany({
      where: { teamId: team.id, status: 'ACTIVE' },
      include: { contract: true },
      orderBy: [{ trueOvr: 'asc' }, { id: 'asc' }],
    });
    const overflow = roster.length - limit;
    if (overflow <= 0) continue;
    if (team.isUser) {
      userOverflow = { abbr: team.abbr, over: overflow, rosterSize: roster.length };
      continue;
    }

    const cuts = roster.slice(0, overflow);
    for (const p of cuts) {
      const dead = deadMoneyOnCut(p.contract, settings.capMode);
      if (dead > 0) {
        await prisma.capCharge.create({
          data: { teamId: team.id, year: seasonYear, amount: dead, label: `Dead money — ${p.firstName} ${p.lastName}` },
        });
      }
      if (p.contract) await prisma.contract.delete({ where: { playerId: p.id } });
      await prisma.player.update({ where: { id: p.id }, data: { teamId: null, status: 'FREE_AGENT' } });
    }
    await prisma.transaction.create({
      data: {
        leagueId, seasonYear, week: 1, type: 'CUT', teamId: team.id,
        headline: `Final cuts — ${cuts.length} released`,
        detail: `${cuts.map((p) => `${p.firstName} ${p.lastName} (${p.position})`).join(', ')} waived to reach the ${limit}-man limit.`,
      },
    });
    total += cuts.length;
  }
  return { trimmed: total, userOverflow };
}

/**
 * Decide re-sign outcomes for one team's pending players — both the
 * truly-expired (0-years-remaining) and the walk-year (1-remaining, this is
 * their contract's last season) ones. Shared between the AI-only offseason
 * wave and the user-facing "Let the AI pick" delegate button on the re-sign
 * page, so both cover every decision the re-sign page actually shows, not
 * just the subset that's already hit free agency's doorstep.
 *
 * A walk-year player who isn't judged worth an early extension isn't
 * "released" — nothing happens, since he's still under contract for this
 * season. Only an un-kept ALREADY-expired player actually walks; `released`
 * only ever counts those.
 *
 * The shape of the pass, and why (measured against live saves — the old
 * version kept 1.5-3.2 players per AI team per year, which is why AI rosters
 * shrank every single offseason until they sat 20 bodies under the minimum):
 *
 *   1. ONE cap summary per team, then a running local budget. It used to be
 *      one per pending player, computed BEFORE the test that threw ~83% of
 *      them away.
 *   2. Candidates in value order (would-actually-walk first, then by market
 *      value). The roster query has no orderBy, so "roster order" was random.
 *   3. Needs computed on the roster MINUS the expiring class, so a departing
 *      starter registers as the hole he is.
 *   4. No willingness die roll. Willingness now sets the offer's price and
 *      term, and how far down the roster a GM is willing to go — a rebuilding
 *      team lowballs and lets fringe players walk, a win-now team overpays.
 *   5. The keep test is a depth comparison, not a need score: keep him if
 *      he's a genuine starter, or if the players who'd replace him are worse,
 *      or if the roster is still short of a legal minimum.
 */
export async function resignDecisionsForTeam(
  leagueId: string,
  teamId: string,
  seasonYear: number,
  week: number,
  capMode: LeagueSettings['capMode'],
  rng: Rng,
) {
  const { parseGmProfile, teamNeeds } = await import('./ai/gm');
  const { marketValue, suggestedYears, maxYearsForAge, buildContract, capHit } = await import('./cap');
  const { extendContract } = await import('./freeagency');
  const { teamCapSummary } = await import('./cap-summary');

  // Roster limits come from the league's own settings, like every other
  // roster-limit site in the codebase (trimRostersToLimit, runAiFreeAgencyWave,
  // fillRosterForTeam, INV-08). This function alone read the LEAGUE.* defaults,
  // so a league configured with a 40- or 60-man roster had its re-sign wave
  // budgeting against 46/53 regardless — either refusing to keep players it had
  // room for, or keeping players it would have to waive on cut-down day.
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { settings: true } });
  const settings = parseSettings(league.settings);
  const rosterMax = settings.rosterMax || LEAGUE.ROSTER_MAX;
  const rosterMin = rosterMinFor(rosterMax);

  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  const roster = await prisma.player.findMany({ where: { teamId, status: 'ACTIVE' }, include: { contract: true } });
  const pending = roster.filter((p) => p.contract && p.contract.yearsRemaining <= 1);
  if (pending.length === 0) return { kept: 0, released: 0 };

  const pendingIds = new Set(pending.map((p) => p.id));
  // Needs are computed on the roster MINUS the expiring class. Computed over
  // the FULL roster (as it used to be), a team about to lose its starting
  // corner reads need[CB] as ~0 precisely BECAUSE that corner is still on the
  // books — need was structurally anti-correlated with the decision it fed.
  const core = roster.filter((p) => !pendingIds.has(p.id));
  const needs = teamNeeds(core.map((p) => ({ id: p.id, position: p.position, trueOvr: p.trueOvr, age: p.age, potential: p.potential })));
  const profile = parseGmProfile(team.gmProfile, rng);

  // ONE cap read for the whole team, then a running local budget. This used
  // to be a teamCapSummary() (4 queries) per PENDING PLAYER, ahead of a test
  // that discarded ~83% of them — ~4,200 round trips per league-wide wave for
  // ~50 signings. extendContract's own assertCapRoom() is still the authority
  // on whether a deal actually fits; `capSpace` here is only a budget.
  const summary = await teamCapSummary(teamId, seasonYear, capMode);
  let capSpace = summary.capSpace;

  // Who the team already has at each position, best first, not counting
  // anyone who is himself expiring — i.e. the depth that would actually
  // replace this player if he walked.
  const depthByPos = new Map<string, number[]>();
  for (const p of core) {
    const list = depthByPos.get(p.position) ?? [];
    list.push(p.trueOvr);
    depthByPos.set(p.position, list);
  }
  for (const list of depthByPos.values()) list.sort((a, b) => b - a);

  // How many players are guaranteed to still be here after RESIGN: everyone
  // under contract past this year, plus the walk-year players (who have a
  // season left either way). Every re-signed expiring player adds one.
  let projected = core.length + pending.filter((p) => p.contract!.yearsRemaining === 1).length;

  // Value order, not roster order — the roster query has no orderBy, so the
  // old loop spent the cap in whatever sequence Postgres happened to return
  // (measured 51.5% inverted, i.e. indistinguishable from random). Players
  // who would actually WALK come before walk-year players, who are a luxury.
  const priced = pending
    .map((p) => ({
      p,
      market: marketValue({ ovr: p.trueOvr, position: p.position as Position, age: p.age, potential: p.potential }),
      expired: p.contract!.yearsRemaining === 0,
    }))
    .sort((a, b) => Number(b.expired) - Number(a.expired) || b.market - a.market || b.p.trueOvr - a.p.trueOvr);

  let kept = 0;
  let released = 0;

  for (const { p, market, expired } of priced) {
    const need = needs[p.position] ?? 0;
    // Same expression as before, but it is no longer a veto. It decides how
    // hard this front office competes: what it offers, for how long, and how
    // low down the roster it is willing to go.
    const willingness = clamp(0.35 + profile.winNow * 0.3 + need * 0.35, 0, 1);

    const depth = depthByPos.get(p.position) ?? [];
    const ideal = ROSTER_TARGETS[p.position as Position]?.ideal ?? 2;
    // The man who'd take the last roster spot the position spec wants. If
    // the team can't even fill that many bodies without him, it's a hole.
    const replacement = depth[ideal - 1] ?? 0;
    const bar = RESIGN.FLOOR_OVR + (1 - willingness) * RESIGN.REBUILD_BAR_SPAN;
    const shortOfMinimum = projected < rosterMin;

    const worthKeeping = p.trueOvr >= bar && (
      p.trueOvr >= RESIGN.PREMIUM_OVR
      || p.trueOvr + RESIGN.INCUMBENT_EDGE >= replacement
      || shortOfMinimum
    );
    // A player with a year still to run isn't going anywhere — extending him
    // early is a luxury that competes for the same dollars as the players who
    // would actually walk, so it takes both a star and an eager GM.
    const worthExtendingEarly = expired
      || (p.trueOvr >= RESIGN.PREMIUM_OVR && willingness >= RESIGN.EARLY_EXTENSION_WILLINGNESS);
    // Don't re-sign past a legal roster — free agency and the draft still
    // have to fit, and anyone over the limit gets waived on cut-down day.
    const roomOnRoster = !expired || projected < rosterMax;

    if (!worthKeeping || !worthExtendingEarly || !roomOnRoster) {
      if (expired) released++;
      continue;
    }

    // Willingness as price and term. A win-now GM pays over market and adds a
    // year; a rebuilding one lowballs and shortens — and then finds himself
    // with room left for somebody else.
    const priceMult = RESIGN.OFFER_FLOOR_MULT + willingness * RESIGN.OFFER_WILLINGNESS_SPAN;
    const apy = Math.max(CAP.MIN_SALARY, Math.round(market * priceMult * (1 + rng.float(-RESIGN.OFFER_NOISE, RESIGN.OFFER_NOISE))));
    const termNudge = willingness >= RESIGN.LENGTH_BONUS_ABOVE ? 1 : willingness <= RESIGN.LENGTH_PENALTY_BELOW ? -1 : 0;
    // The nudge may shorten a deal freely, but it may NOT reach past the age
    // ceiling. CONTRACT (lib/tuning.ts) documents that ceiling as absolute —
    // "a 34-year-old gets one year no matter how good he is, which is what
    // keeps an aging star from being handed a five-year deal the team can
    // never escape" — and clamping only against MAX_DEAL_YEARS quietly broke
    // it: measured, ovr 76 age 34 was nudged from 1 year to 2, and ovr 62
    // age 40 from 1 to 2 as well.
    const termCeiling = Math.min(CONTRACT.MAX_DEAL_YEARS, maxYearsForAge(p.age));
    const years = clamp(suggestedYears(p.trueOvr, p.age) + termNudge, 1, termCeiling);

    // Budget against the DELTA, not the gross: the old deal is torn up the
    // instant the new one is signed, which is exactly what extendContract's
    // assertCapRoom credits back.
    const oldHit = capHit(p.contract, capMode);
    const preview = buildContract({ apy, years, signedYear: seasonYear });
    const newHit = capHit({ ...preview, baseSalaries: writeJson(preview.baseSalaries) }, capMode);
    // Hold back money for free agency and the draft class, plus the league
    // minimum for every roster slot still short of a legal roster.
    const openSlots = Math.max(0, rosterMin - projected);
    const reserve = capMode === 'OFF' ? 0 : RESIGN.CAP_RESERVE + openSlots * CAP.MIN_SALARY;
    if (newHit - oldHit > capSpace - reserve) {
      if (expired) released++;
      continue;
    }

    const ok = await extendContract({ leagueId, playerId: p.id, apy, years, seasonYear, capMode, week, reSign: true })
      .then(() => true)
      .catch(() => false);
    if (ok) {
      kept++;
      capSpace -= newHit - oldHit;
      if (expired) {
        projected++;
        // He is no longer the hole he was — later players at his position are
        // now measured against him.
        const list = depthByPos.get(p.position) ?? [];
        list.push(p.trueOvr);
        list.sort((a, b) => b - a);
        depthByPos.set(p.position, list);
      }
    } else if (expired) {
      released++;
    }
  }
  return { kept, released };
}

/**
 * AI-only offseason wave — every non-user team decides on its own pending
 * re-sign class before the user ever lands on the re-sign screen. Without
 * this, no CPU team ever extends anyone: every expiring contract league-wide
 * would hit release at the end of RESIGN and dump the entire AI side of the
 * league into free agency every single year.
 */
async function runAiResignWave(leagueId: string, seasonYear: number, week: number, capMode: LeagueSettings['capMode'], rng: Rng) {
  const teams = await prisma.team.findMany({ where: { leagueId, isUser: false } });
  for (const team of teams) {
    await resignDecisionsForTeam(leagueId, team.id, seasonYear, week, capMode, rng);
  }
}

async function addDraftClass(leagueId: string, seasonYear: number, rng: Rng) {
  const size = GENERATION.DRAFT_CLASS_SIZE + GENERATION.DRAFT_CLASS_EXTRA_UDFA;
  // Seed the ledger from everyone already in the league so this year's class
  // can't hand a rookie the name of a sitting starter. Generation is a pure
  // in-memory batch, so this one query is the only way it can know.
  const existing = await prisma.player.findMany({
    where: { leagueId },
    select: { firstName: true, lastName: true },
  });
  const names = new NameRegistry(existing.map((p) => `${p.firstName} ${p.lastName}`));
  const { players, strengthByGroup } = generateDraftClass(rng, size, names);
  const rows = players.map((p) => toPlayerCreate(p, leagueId, { status: 'FREE_AGENT', isDraftee: true, draftYear: seasonYear }));
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) await prisma.player.createMany({ data: rows.slice(i, i + CHUNK) });

  await prisma.transaction.create({
    data: {
      leagueId, seasonYear, week: 1, type: 'NEWS', teamId: null,
      headline: `${seasonYear} Draft Class Outlook`,
      detail: classStrengthSummary(strengthByGroup),
    },
  });

  // Give the user team a baseline scouting book on this class immediately —
  // without it every prospect's fogged view falls back to the same flat
  // "no observation yet" center (see scouting.ts buildScoutedView), which
  // makes the draft board's OVR/potential sort a no-op until someone is
  // individually scouted. seedScoutingReports() does the same thing for the
  // initial class at league creation; new classes need it too.
  const userTeam = await prisma.team.findFirst({ where: { leagueId, isUser: true } });
  if (userTeam) {
    const created = await prisma.player.findMany({
      where: { leagueId, isDraftee: true, draftYear: seasonYear },
      select: { id: true, position: true, trueAttrs: true, potential: true },
    });
    const reportRows = created.map((p) => {
      const trueAttrs = readJson<AttrMap>(p.trueAttrs, {});
      // truePotential MUST be passed — without it observe() never sets the
      // synthetic potential-observation key, so buildScoutedView's fallback
      // (`observed[POTENTIAL_OBS_KEY] ?? SCOUTING.POTENTIAL_DEFAULT_CENTER`)
      // collapses every unscouted rookie to the exact same flat 75 center,
      // which is why every prospect read as "Starter Prospect" — identical
      // to the scoutedOvr flat-62 bug fixed above, just for potential.
      const observed = observe(rng, p.position as Position, trueAttrs, SCOUTING.ROOKIE_BASE_CONFIDENCE, 50, 0, p.potential);
      return {
        playerId: p.id,
        teamId: userTeam.id,
        confidence: Math.round(SCOUTING.ROOKIE_BASE_CONFIDENCE),
        observed: writeJson(observed),
        lastWeek: 0,
      };
    });
    for (let i = 0; i < reportRows.length; i += CHUNK) {
      await prisma.scoutingReport.createMany({ data: reportRows.slice(i, i + CHUNK) });
    }
  }
}

async function addFutureDraftPicks(leagueId: string, seasonYear: number) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const teams = await prisma.team.findMany({ where: { leagueId } });
  const targetYear = seasonYear + 2; // keep a rolling 3-year pick horizon
  const existing = await prisma.draftPick.count({ where: { leagueId, year: targetYear } });
  if (existing > 0) return;
  const rows: any[] = [];
  for (let round = 1; round <= settings.draftRounds; round++) {
    teams.forEach((team, i) => {
      rows.push({ leagueId, year: targetYear, round, slot: i + 1, originalTeamId: team.id, ownerTeamId: team.id });
    });
  }
  await prisma.draftPick.createMany({ data: rows });
}

export const PHASE_LABELS: Record<string, string> = {
  PRESEASON: 'Preseason',
  REGULAR: 'Regular Season',
  PLAYOFFS: 'Playoffs',
  OFFSEASON: 'Offseason',
  RESIGN: 'Re-sign Window',
  FREE_AGENCY: 'Free Agency',
  DRAFT: 'Rookie Draft',
  FANTASY_DRAFT: 'Fantasy Draft',
};
