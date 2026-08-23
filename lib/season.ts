import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { Rng, clamp } from './rng';
import { CAP, CONTRACT, FREE_AGENCY, LEAGUE, Position, PROGRESSION, RESIGN, ROSTER_TARGETS, SCOUTING, GENERATION, rosterMinFor } from './tuning';
import { parseSettings, LeagueSettings } from './settings';
import { readJson, writeJson } from './json';
import { simulateGame, SimTeamInput } from './sim/engine';
import { generateRecap } from './sim/recap';
import { SimPlayer, SimStaff } from './sim/units';
import { retirementChance, bumpForMilestone } from './progression';
import { AttrMap } from './ratings';
import { applyInSeasonProgression, progressFreeAgents } from './development';
import { proration, deadMoneyOnCut } from './cap';
import { runAiFreeAgencyWave, fillTeamsToRosterMinimum, runInSeasonSignings } from './freeagency';
import { maybeGenerateAiTradeOffer, isTradeDeadlinePassed } from './trade';
import { mergeStats } from './stats';
import { SeasonStats } from './types';
import { gameHeadlines } from './news';
import { COACH_FIRST, COACH_LAST } from './gen/names';
import { generateDraftClass, toPlayerCreate } from './gen/players';
import { NameRegistry } from './gen/names';
import { classStrengthSummary } from './gen/prospectProfile';
import { checkAndUpdateRecords, recordBreakHeadline } from './records';
import { syncPlayerSeasons } from './playerSeasons';
import { reseedDraftOrder, startRookieDraft } from './draft';
import { ensureSeasonSchedule } from './scheduleSeason';
import { autoDepthChartAll, generateFringeFreeAgents, fringeShortfall } from './gen/league';
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

/**
 * ---------------------------------------------------------------------------
 * ONE STEP OF THE PHASE MACHINE, AND THE CLOCK THE UNSIGNED ARE STANDING ON
 * ---------------------------------------------------------------------------
 * Everything below the wrapper is the phase machine itself. The wrapper exists
 * for one thing: a free agent has been unsigned for another week, and
 * something has to say so.
 *
 * Player.weeksUnsigned is what an asking price falls on (see askingPrice in
 * lib/cap.ts), so it has to move when — and only when — league time moves. Not
 * every click does: a re-sign warning, a draft still on the clock and a roster
 * over the limit all return without advancing anything, and ticking on those
 * would let a GM age the whole market by pressing a button that told him no.
 * So the test is the league's own clock, read before and after: if the phase,
 * the week or the season year changed, a week happened.
 *
 * ONE RACE OVER-COUNTS AND IT IS THE RIGHT WAY ROUND. Two concurrent advances
 * of the same regular-season week both observe the week move — one of them did
 * it — so the pool ages twice for one week of football. The alternative
 * (claiming the tick per step) would trade that for a tick silently SKIPPED
 * when a step is retried, and a market clock that runs slow is a market that
 * never clears, which is the bug this whole mechanism exists to fix. One week
 * of extra discount on a double click is invisible; a stuck clock is what the
 * app owner was looking at.
 */
async function advanceWeekStep(leagueId: string) {
  const before = await prisma.league.findUniqueOrThrow({
    where: { id: leagueId }, select: { phase: true, week: true, seasonYear: true },
  });
  const result = await runPhaseStep(leagueId);
  const after = await prisma.league.findUnique({
    where: { id: leagueId }, select: { phase: true, week: true, seasonYear: true },
  });
  const timeMoved = !!after
    && (after.phase !== before.phase || after.week !== before.week || after.seasonYear !== before.seasonYear);
  if (timeMoved) {
    // Every phase counts, not just the season. A man released in April is
    // unsigned through the draft and through camp just as surely as he is
    // unsigned in November, and his price should know it. One statement for
    // the whole pool — this runs on every advance in the game.
    await prisma.player.updateMany({
      where: { leagueId, status: 'FREE_AGENT', teamId: null, isDraftee: false },
      data: { weeksUnsigned: { increment: 1 } },
    });
  }
  return result;
}

async function runPhaseStep(leagueId: string) {
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

      // Camp signings. The wire does not close when free agency does — a club
      // that comes out of the offseason with a hole fills it in August, and
      // the men still unsigned in August are cheaper than they were in April.
      // See runInSeasonSignings: one or two clubs, when they have a real hole.
      const camp = await runInSeasonSignings({
        leagueId, seasonYear: league.seasonYear, week: league.week, phase: 'PRESEASON', settings,
      });

      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'REGULAR', week: 1 } });
      const campNote = camp.signings > 0
        ? ` ${camp.signings} club${camp.signings === 1 ? '' : 's'} went to the wire for help before the opener.`
        : '';
      return {
        summary: (scheduled > 0
          ? `Preseason complete. The ${league.seasonYear} schedule is out — ${scheduled} games across ${settings.seasonLength} weeks. Week 1 is set, and next year's draft class is on the board.`
          : 'Preseason complete. Week 1 is set — next year\'s draft class is on the board.') + campNote,
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
        // AND THE MEN HE SET ASIDE. The re-sign list grew a "not now" control
        // (NegotiationTalks.dismissedAt, app/actions/resign.ts) so a twenty-deep
        // list can be triaged — which opens exactly one trap: park twelve men,
        // advance, and they all walk having done what the button implied was
        // safe. So the SAME warning is widened rather than duplicated, because
        // it is the same "you are about to lose people" moment and two blocking
        // messages competing for one Advance would be worse than none: it now
        // also fires when anybody parked is one step from free agency, and it
        // NAMES them. Nothing here writes to a negotiation — this is a read.
        const setAside = await prisma.negotiationTalks.findMany({
          where: {
            teamId: userTeam.id, seasonYear: league.seasonYear, dismissedAt: { not: null },
            player: { status: 'ACTIVE', teamId: userTeam.id, contract: { yearsRemaining: 0 } },
          },
          select: { player: { select: { id: true, firstName: true, lastName: true, position: true, trueOvr: true } } },
        });
        const parked = setAside.map((r) => r.player).sort((a, b) => b.trueOvr - a.trueOvr);
        // "Starter" is the depth chart's own answer (rank 0), not a rating
        // guess — the same table the Depth Chart screen renders.
        const starters = parked.length === 0 ? 0 : await prisma.depthChartSlot.count({
          where: { teamId: userTeam.id, rank: 0, playerId: { in: parked.map((p) => p.id) } },
        });
        if (walking > 0 && (after < rosterMin || parked.length > 0)) {
          await prisma.league.update({ where: { id: leagueId }, data: { resignWarnedYear: league.seasonYear } });
          const named = parked.slice(0, 3).map((p) => `${p.firstName} ${p.lastName} (${p.position}, ${p.trueOvr})`).join(', ');
          const asideLine = parked.length === 0 ? '' : (
            `${parked.length === 1 ? 'One of them is a man' : `${parked.length} of them are men`} you set aside`
            + `${starters > 0 ? `, including ${starters} ${starters === 1 ? 'starter' : 'starters'}` : ''}`
            + ` — ${named}${parked.length > 3 ? ` and ${parked.length - 3} more` : ''}. `
            + `"Not now" was never "let him go", and this is the last screen where that is still true. `
          );
          return {
            summary: after < rosterMin
              ? `Hold on — advancing now lets ${walking} of your ${active} players walk, leaving the `
                + `${userTeam.abbr} with ${after} under contract against a ${rosterMin}-man minimum. `
                + asideLine
                + `Re-sign whoever you mean to keep first; anyone you don't will be available in free agency, `
                + `where you can also sign replacements. Advance again to let them go.`
              : `Hold on — advancing now lets ${walking} of your ${active} players walk. `
                + asideLine
                + `Bring back anyone you still mean to keep, or re-sign him now. Advance again to let them go.`,
            blocked: true,
            block: {
              title: after < rosterMin ? 'Your roster is about to collapse' : 'The players you set aside are about to walk',
              href: 'resign',
              linkLabel: 'Open Re-sign Window',
            },
          };
        }
      }

      /**
       * =====================================================================
       * THE WAY OUT OF RESIGN IS CLAIMED BEFORE IT RUNS
       * =====================================================================
       * It wasn't, and it was the last transition in the phase machine that
       * both moved time and did non-idempotent work with nothing guarding it.
       * A regular-season week claims itself; a playoff round takes a lock; every
       * offseason step claims itself before it runs, for the reasons written out
       * above runOffseasonStepClaimed. This one just did the work and set the
       * phase at the end.
       *
       * The button in front of it does not hold the door. `runSingle` in
       * components/AdvanceWeekButton.tsx wraps the call in
       * `startTransition(async () => …)`, and on React 18 `isPending` goes false
       * at the first `await` — so the button re-enables while the advance is
       * still running and the second half of a double click reaches this block
       * alongside the first.
       *
       * WHAT THAT LOOKED LIKE, and it is why the stack trace was so misleading:
       * a P2025 out of `contract.delete` on an id read five lines earlier, in
       * releaseUnresignedExpiringContracts. The row had not vanished — the other
       * advance had already released the same man. Reproduced by driving two
       * concurrent advances out of RESIGN on a scratch league: one returns a
       * normal summary, the other throws exactly that.
       *
       * The throw was the visible half. The silent half is worse and would have
       * outlived it: `addFringeFreeAgents` sizes its batch off a pool count, so
       * two runners read the same shortfall and each mint the whole of it, and
       * `fillTeamsToRosterMinimum` signs two rounds of minimum deals into the
       * same holes. Making the delete idempotent on its own would have hidden
       * the crash and kept both of those.
       *
       * So the PHASE is the claim, compare-and-set, exactly as the offseason
       * does it: a second advance arriving anywhere inside this block finds a
       * league that is no longer in RESIGN and does nothing at all. Rolled back
       * if the work throws, so a failed advance leaves the window open and the
       * press repeatable rather than stranding the league one phase on with the
       * release half done.
       */
      const claimedResign = await prisma.league.updateMany({
        where: { id: leagueId, phase: 'RESIGN' },
        data: { phase: 'FREE_AGENCY', week: 1 },
      });
      if (claimedResign.count === 0) return { summary: 'Free agency is already open.' };

      try {
        await releaseUnresignedExpiringContracts(leagueId, league.seasonYear);
        // The wire, before anybody shops it. This league's own expiring
        // contracts are the market's real names; the fringe population is the
        // several hundred camp bodies underneath them that a real offseason
        // always has and this one never did. Runs BEFORE the roster-filling
        // below on purpose — that is what the short clubs are meant to sign.
        const minted = await addFringeFreeAgents(leagueId, rng);
        // Every AI team that came out of that below a legal roster fills back up
        // immediately, at the league minimum, from the players who just hit the
        // market. Without this a team that had a bad re-sign year stayed 20
        // bodies short for the rest of its existence — measured on 19 of 22
        // pre-existing saves, min roster 27 and median 33.
        const refilled = await fillTeamsToRosterMinimum(leagueId, league.seasonYear, 1, settings, rng);
        return {
          summary: [
            releasedBefore > 0 ? `${releasedBefore} unsigned player(s) hit free agency.` : null,
            minted > 0 ? `${minted} veteran(s) and camp bodies worked out for clubs and are on the wire.` : null,
            refilled > 0 ? `${refilled} minimum-salary signing(s) got short-handed rosters back to a legal size.` : null,
            'Free agency is open.',
          ].filter(Boolean).join(' '),
        };
      } catch (err) {
        // Back to exactly the week the claim took it from, and only from the
        // value the claim wrote — if anything else has moved the league on
        // since, this is no longer ours to put back.
        await prisma.league.updateMany({
          where: { id: leagueId, phase: 'FREE_AGENCY', week: 1 },
          data: { phase: 'RESIGN', week: league.week },
        });
        throw err;
      }
    }

    case 'FREE_AGENCY': {
      // Short-handed teams get back to a legal roster before the bidding, so
      // the wave isn't the only path back and a team that had a bad re-sign
      // year doesn't spend the season 20 bodies light.
      await fillTeamsToRosterMinimum(leagueId, league.seasonYear, league.week, settings, rng);
      const { signings, displaced } = await runAiFreeAgencyWave(leagueId, league.seasonYear, league.week, settings);
      const displacedNote = displaced > 0 ? ` ${displaced} veteran(s) released to make room.` : '';
      // FREE_AGENCY.WEEKS, not a literal, because the roadmap draws a bar with
      // one segment per week of this window and the two must not disagree
      // about how long it is.
      const nextWeek = league.week + 1;
      if (nextWeek > FREE_AGENCY.WEEKS) {
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

      // ---------------------------------------------------------------
      // THE UNDRAFTED SIGN THE WEEK THE DRAFT ENDS
      // ---------------------------------------------------------------
      // Whoever this class's draft left undrafted was never converted back
      // into an ordinary free agent — isDraftee only ever got cleared inside
      // draftPlayer() for players actually selected. Left unfixed, a stale
      // prospect stays isDraftee:true forever: permanently excluded from
      // normal free agency (which explicitly filters isDraftee out), never
      // aged (progression only runs on status: 'ACTIVE'), and kept
      // resurfacing in every future year's draft pool mixed in with the
      // real new class, since the pool query has no year filter of its own.
      //
      // The first fix for that was `draftYear: { lt: seasonYear }`, which is
      // a YEAR LATE and had two consequences, both bad and both invisible:
      //
      //   UNSIGNABLE. This year's undrafted class stays flagged until NEXT
      //   year's draft completes — which is after next year's free agency has
      //   already closed. So an undrafted rookie first reached an open market
      //   two offseasons after his draft. In the real sport he signs within
      //   days of the seventh round ending.
      //
      //   UNCLEARABLE. `progressFreeAgents` (lib/development.ts) selects
      //   `isDraftee: false`, so the very cohort its attrition curve was
      //   written for — its comment says so in as many words, "most of the
      //   ~400 players who enter the pool every year are 22-year-old
      //   undrafted rookies" — was excluded from it. They neither signed nor
      //   left, which is the pile-up the churn rule exists to prevent.
      //
      // One broken conversion caused both halves. The draft is over and
      // DraftState says so, so ANYBODY still carrying the flag went
      // undrafted: no year filter is needed, and dropping it is also what
      // frees the fantasy-draft leftovers, which are written with a null
      // draftYear and could never match a `lt` comparison at all.
      const undrafted = await prisma.player.updateMany({
        where: { leagueId, isDraftee: true },
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
      // Everyone nobody took is a free agent now, exactly as at the end of a
      // rookie draft. Without this a fantasy league's leftovers were stranded
      // as prospects forever — written with a NULL draftYear, so the old
      // `draftYear: { lt: seasonYear }` conversion in the DRAFT case could
      // never match them either. Measured: a fantasy league's free-agency
      // screen read ZERO available in every week of every season of its
      // existence, while 130 unsigned players sat invisible behind it.
      const leftovers = await prisma.player.updateMany({
        where: { leagueId, isDraftee: true },
        data: { isDraftee: false },
      });
      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'PRESEASON', week: 1 } });
      return {
        summary: leftovers.count > 0
          ? `Fantasy draft complete. ${leftovers.count} undrafted player(s) are on the free agent wire. Setting up your inaugural season.`
          : 'Fantasy draft complete. Setting up your inaugural season.',
      };
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
  const saved = await Promise.all(games.map((game, i) => simulateAndSaveGame(leagueId, game.id, settings, gameRngs[i])));

  /**
   * ===========================================================================
   * ONE WEEK, ONE SET OF LEAGUE-WIDE EFFECTS
   * ===========================================================================
   * The games above are now safe on their own — each one is claimed inside the
   * transaction that saves it, so no box score is ever written twice. What is
   * NOT safe by itself is everything below this comment: fatigue recovery,
   * progression, shortlist attention and the AI trade tick are league-wide
   * statements with no per-row guard, and running them twice heals every
   * injury two weeks in one and develops every player twice.
   *
   * So the week itself is claimed, with the same compare-and-set shape: move
   * `week` forward only if it is still the week this call read. Exactly one of
   * two concurrent advances matches, and the other returns here having written
   * nothing.
   *
   * WHY THE CLAIM IS HERE AND NOT AT THE TOP OF THE ADVANCE. Claiming the week
   * before the games would make a timed-out request skip a week outright — the
   * week would be marked done with sixteen games never played and nothing to
   * pick them up. Claiming it after means a killed function leaves the week
   * un-advanced and the next click finishes the unplayed games, which is how
   * this path already recovers today. The cost is that a duplicate click
   * simulates games in memory it then discards; that is CPU, not data.
   */
  if (games.length > 0 && saved.every((r) => r === null)) {
    return { summary: `Week ${week} has already been played.`, report: null };
  }
  const claimedWeek = await prisma.league.updateMany({
    where: { id: leagueId, phase: 'REGULAR', week },
    data: { week: week + 1 },
  });
  if (claimedWeek.count === 0) {
    return { summary: `Week ${week} has already been played.`, report: null };
  }

  // Counted off the rows rather than off this call's own share of them: in a
  // race the two callers can split the sixteen games between them, and the
  // number on screen should be how many games the week actually has.
  const played = await prisma.game.count({
    where: { leagueId, week, seasonYear: league.seasonYear, kind: 'REGULAR', played: true },
  });

  // Recover fatigue and tick injury clocks league-wide, between weeks. The
  // postseason runs the same week between its own rounds — inside
  // withRoundLock, which is where its exactly-once guarantee lives.
  await recoverFatigueAndInjuries(leagueId);
  await applyInSeasonProgression(leagueId, league.seasonYear, week, settings.seasonLength, rng, settings.progressionSpeed);
  // Your staff spent the week on the players you starred. This is the ONLY
  // ongoing scouting input in the game and it runs whether or not the user
  // ever opened a scouting screen — advancing a week is not supposed to be
  // something you can do wrong (lib/shortlistAttention.ts).
  await applyShortlistAttention(leagueId, league.seasonYear, week, settings.simSeed || leagueId);
  await maybeMakeAiTradeOffer(leagueId, league.seasonYear, week, settings, rng);
  // Somebody's starter went down on Sunday, and the man who can replace him is
  // on the wire at a fraction of what he wanted in the spring. Runs AFTER the
  // week is claimed, so it happens exactly once per week however many times
  // Advance is clicked, and it is deliberately quiet — see runInSeasonSignings
  // for what stops it emptying the board the GM is reading.
  const wire = await runInSeasonSignings({
    leagueId, seasonYear: league.seasonYear, week, phase: 'REGULAR', settings,
  });

  const nextWeek = week + 1;
  const seasonOver = nextWeek > settings.seasonLength;
  if (seasonOver) {
    // All-Stars are selected HERE, at the end of the regular season, which is
    // when the real thing is named. This USED to be load-bearing for
    // correctness — seasonStats accumulated straight through the postseason,
    // so selecting after the final folded playoff games into the totals of
    // the twelve clubs that got there and none of the twenty that didn't.
    // seasonStats is now regular season only (see Player.seasonStats in the
    // schema), so the timing is a choice about when an honour is awarded
    // rather than a workaround. It stays where it is. See lib/allStars.ts.
    // Dynamic import to match recordSeasonAwards below.
    const { recordAllStars } = await import('./allStars');
    await recordAllStars(leagueId, league.seasonYear, week, settings.seasonLength);
    await seedPlayoffs(leagueId);
  } else {
    await prisma.league.update({ where: { id: leagueId }, data: { week: nextWeek } });
  }

  const wireNote = wire.signings > 0
    ? ` ${wire.signings} free agent${wire.signings === 1 ? '' : 's'} signed off the wire.`
    : '';
  const summary = (seasonOver
    ? `Week ${week} complete (${played} games). Regular season is over — playoffs are set.`
    : `Week ${week} complete: ${played} games played.`) + wireNote;

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

  // Set false by the claim below when another advance got to this game first.
  let claimed = true;

  await prisma.$transaction(async (tx) => {
    /**
     * THE CLAIM, and it is the first statement in the transaction on purpose.
     *
     * `updateMany` with `played: false` in the WHERE is an atomic
     * compare-and-set. Two concurrent advances of the same week both read the
     * same `played: false` list in simulateWeek and both arrive here for the
     * same game; exactly one of them matches a row and writes it. The loser
     * matches zero rows and returns before touching standings, the wire, or
     * any player's season line — which is what stops one week of football
     * being counted twice (measured: 488 passing yards a game became 955).
     *
     * INSIDE the transaction, rather than as a cheaper check before it,
     * because that is what makes a killed function safe. Every write in here
     * commits or rolls back together, so a serverless timeout mid-game leaves
     * the row `played: false` and the next advance simply plays it. Claiming
     * outside the transaction — or advancing the league's week up front —
     * would trade this bug for a silently skipped week, which is the same
     * class of failure with a worse shape.
     */
    const won = await tx.game.updateMany({
      where: { id: gameId, played: false },
      data: {
        played: true, homeScore: result.homeScore, awayScore: result.awayScore,
        boxScore: writeJson(result.boxScore), recap,
      },
    });
    if (won.count === 0) {
      claimed = false;
      return;
    }

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

    const newsRows: { leagueId: string; seasonYear: number; week: number; type: string; teamId?: string; playerId?: string; headline: string; detail: string }[] = [];
    if (result.injuries.length > 0) {
      newsRows.push({
        // No `playerId`: this is the whole game's training room in one line,
        // "3 injury report(s) from LAX @ SDG". It is about a match, not a man,
        // and the per-player detail lives on the players' own rows.
        leagueId, seasonYear: game.seasonYear, week: game.week, type: 'INJURY',
        headline: `${result.injuries.length} injury report(s) from ${home.abbr} @ ${away.abbr}`,
        detail: result.boxScore.injuries.map((i) => `${i.name} (${i.weeks}w)`).join(', '),
      });
    }
    for (const item of gameHeadlines(result.boxScore, game.homeTeamId, game.awayTeamId)) {
      // A game headline names one player and describes his afternoon, so it
      // carries him. `gameHeadlines` reads the id off the box line it is
      // written from — it was always there, it was just never passed on.
      newsRows.push({ leagueId, seasonYear: game.seasonYear, week: game.week, type: 'NEWS', teamId: item.teamId, playerId: item.playerId, headline: item.headline, detail: item.detail });
    }
    if (newsRows.length > 0) await tx.transaction.createMany({ data: newsRows });

    // Which bucket this game's production lands in. The standings gate three
    // statements up has always been `kind === 'REGULAR'`; the stat gate used
    // to be missing entirely, which is how a Super Bowl run added four games
    // of yardage AND four games of `gp` to a season line that the leaderboard
    // then ranked against a seventeen-game one. Two columns, one meaning
    // each — see Player.seasonStats in the schema.
    const statColumn = game.kind === 'REGULAR' ? 'seasonStats' : 'playoffStats';
    const allLines = [...result.boxScore.lines.home, ...result.boxScore.lines.away];
    const existing = await tx.player.findMany({
      where: { id: { in: allLines.map((l) => l.playerId) } },
      select: { id: true, seasonStats: true, playoffStats: true },
    });
    const existingById = new Map(existing.map((p) => [p.id, p[statColumn]]));
    const statUpdates: [string, string][] = allLines.map((line) => {
      const current = readJson<SeasonStats>(existingById.get(line.playerId), {});
      return [line.playerId, writeJson(mergeStats(current, line.stats))];
    });
    await bulkSetText(tx, statColumn, statUpdates);
  });

  // Null means "another advance saved this one" — both callers ignore the
  // value, and simulateWeek counts the nulls to tell a duplicate click apart
  // from a real week.
  if (!claimed) return null;
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

async function bulkSetText(tx: Prisma.TransactionClient, column: 'seasonStats' | 'playoffStats' | 'careerStats' | 'careerPlayoffStats' | 'injuryType', entries: [string, string][]) {
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

/**
 * A week off the treatment table: fatigue comes down, every injury clock ticks
 * one week, and a clock that reaches zero clears the injury outright.
 *
 * `client` is the ordinary prisma client for the regular season and a
 * transaction client in the postseason, where this runs inside the same
 * exactly-once lock that builds the next round — see withRoundLock. It has no
 * guard of its own and never has had: run twice, everyone in the league heals
 * twice as fast, and nothing on any screen says so.
 */
async function recoverFatigueAndInjuries(leagueId: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
  const { SIM } = await import('./tuning');
  // Was one findMany + one sequential awaited UPDATE per active player in the
  // whole league (~1,700 round trips for a 32-team league) every single
  // week. A single bulk statement does the same work in one round trip.
  await client.$executeRaw`
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
  const pending = await prisma.game.findMany({ where: { leagueId, seasonYear: league.seasonYear, played: false, kind: { not: 'REGULAR' } } });

  // Same snapshot rule as the regular season: the pre-game win chance for the
  // user's own postseason game only exists before it is played.
  const before = await snapshotBeforeAdvance(leagueId, league.week, 'PLAYOFF');
  const roundKind = pending[0]?.kind ?? 'FINAL';

  for (const game of pending) {
    await simulateAndSaveGame(leagueId, game.id, settings, new Rng(`${rng.next()}-${game.id}`));
  }

  // WHICH ROUNDS THIS SEASON HAS PLAYED. Both filters are load-bearing.
  //
  // Without `seasonYear`, last year's FINAL is still in the set, so the
  // wild-card branch's `!kindsPlayed.has('DIVISIONAL')` is false on the very
  // first postseason game of year two and control falls through to
  // `kindsPlayed.has('FINAL')` — a champion crowned straight out of the wild
  // card round, for every season after the first, forever. Measured across
  // the dev database: RD DRIFT BEFORE-B played a full bracket in 2026 and
  // then WILDCARD-only in 2027 through 2034, eight seasons of one-round
  // playoffs and eight fake champions.
  //
  // Without `played`, `createNextPlayoffRound` has already written the NEXT
  // round's unplayed rows by the time the following advance reads this, so
  // the set would report a round complete before it kicked off.
  const kindsPlayed = new Set(
    (await prisma.game.findMany({
      where: { leagueId, seasonYear: league.seasonYear, played: true, kind: { not: 'REGULAR' } },
      select: { kind: true },
    })).map((g) => g.kind),
  );

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
    // Two rookie trophies, one per side of the ball, exactly as real football
    // hands them out. The retired single 'AWARD_ROTY' is deliberately absent:
    // it is read-only history now — thousands of rows in already-played saves
    // still carry it, and every reader still spells it "Rookie of the Year".
    // See lib/awardTypes.ts.
    ['AWARD_OROTY', awards.oroty],
    ['AWARD_DROTY', awards.droty],
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
        // The man who won it. An award row is as player-shaped as a signing,
        // and without this the trophy screen, his own page's honours list and
        // the GM's career page all had to find him back by matching the
        // headline as a string — see the doc on Transaction.playerId in
        // prisma/schema.prisma. It is the same id `applyAwardDevelopmentBump`
        // two lines down already has in its hand.
        playerId: winner.playerId,
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

/**
 * ===========================================================================
 * BUILDING THE NEXT ROUND EXACTLY ONCE — AND THE WEEK BETWEEN THE ROUNDS
 * ===========================================================================
 * Both round builders below called `game.create` unconditionally. The games
 * themselves are safe — simulateAndSaveGame claims each one — but BUILDING the
 * bracket was not: two concurrent playoff advances each play the pending
 * games, each then read the same set of completed rounds, and each create a
 * full divisional round. The postseason comes out with two brackets in it.
 *
 * There is no week to compare-and-set here, because the playoff branch does
 * not move `league.week` between rounds — it only moves it at the very end,
 * into the offseason. So the mutex is the league row itself.
 *
 * `UPDATE league SET ... WHERE id = ?` takes an exclusive row lock in Postgres
 * that is held until the transaction commits. A second advance arriving here
 * BLOCKS on that update rather than racing past it, and by the time it gets
 * through, the first has committed and its `count` sees the round already
 * built. Writing a column to the value it already holds is deliberate: the
 * write exists for the lock, not for the data.
 *
 * A unique index on (leagueId, seasonYear, kind, homeTeamId, awayTeamId)
 * would be the stronger guarantee, and it is the wrong tool here: the
 * migration would FAIL to apply against any live save that already carries a
 * duplicated bracket from this very bug, which is precisely the population it
 * would be protecting.
 *
 * THE OTHER THING THAT HAPPENS BETWEEN TWO PLAYOFF ROUNDS IS A WEEK PASSING,
 * and until now nothing in the postseason knew that. recoverFatigueAndInjuries
 * was called from exactly one place, simulateWeek, on the REGULAR path — so an
 * injury clock stopped dead the moment the regular season ended. The app owner:
 * *"i just had an injury occur at week 17, i simmed 2 weeks while on that
 * player's card and the injury remained until round 2 of playoffs"*, and then
 * *"simmed again, still 2 weeks"*. He was reading it correctly: the number
 * never moved, so a man hurt in December was out for the whole run however
 * short his injury was, and the postseason was the one part of the game where
 * injury LENGTH meant nothing at all. Fatigue was the quieter half of the same
 * omission — four rounds of football with no recovery, accumulating hardest on
 * the club that keeps winning.
 *
 * So the recovery rides along INSIDE this lock, which is the only
 * exactly-once-per-round guarantee the postseason has. It is league-wide,
 * unguarded and unwitnessed — nothing on any screen would show it having run
 * twice — and the round-builder's own `already > 0` test is exactly the answer:
 * whichever advance actually builds the next round is the one that ran the
 * week, and a second click that finds the bracket already there heals nobody.
 *
 * AFTER THE ROUND'S GAMES, NOT BEFORE, which is where the regular season puts
 * it too (see simulateWeek) and is the football answer as well as the
 * mechanical one: a man carried off in the wild-card round has the following
 * week to get right, exactly as he would in November, and a one-week injury
 * sustained in January costs him one January game rather than the season. It
 * does NOT run after the final, and that is deliberate — there is no next round
 * to be fit for, and the PROGRESS step a click later zeroes fatigue and injury
 * clocks outright for everyone who comes back next year.
 * ===========================================================================
 */
async function withRoundLock(leagueId: string, kind: string, seasonYear: number, build: (tx: Prisma.TransactionClient) => Promise<void>) {
  await prisma.$transaction(async (tx) => {
    const league = await tx.league.findUniqueOrThrow({ where: { id: leagueId }, select: { week: true } });
    // The lock. Same value in, same value out.
    await tx.league.update({ where: { id: leagueId }, data: { week: league.week } });
    const already = await tx.game.count({ where: { leagueId, seasonYear, kind } });
    if (already > 0) return;
    // The week between the round just played and the one being built.
    await recoverFatigueAndInjuries(leagueId, tx);
    await build(tx);
  });
}

async function createNextPlayoffRound(leagueId: string, seasonYear: number, fromKind: string, toKind: string) {
  // THIS SEASON's winners. Unbounded, year two collected 2026's wild-card
  // winners alongside 2027's and built a divisional round out of both: a
  // measured 2027 postseason came out WILDCARD 4, DIVISIONAL 6, CONFERENCE 4.
  const games = await prisma.game.findMany({ where: { leagueId, seasonYear, kind: fromKind, played: true } });
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
  await withRoundLock(leagueId, toKind, seasonYear, async (tx) => {
    for (const conf of ['AFC', 'NFC'] as const) {
      const confWinners = winners.filter((w) => w.conference === conf).sort((a, b) => a.seed - b.seed);
      for (let i = 0; i < confWinners.length; i += 2) {
        if (confWinners[i + 1]) {
          await tx.game.create({
            data: { leagueId, seasonYear, week: 2, kind: toKind, homeTeamId: confWinners[i].id, awayTeamId: confWinners[i + 1].id },
          });
        }
      }
    }
  });
}

async function createFinal(leagueId: string, seasonYear: number) {
  // Same year bound, and here the missing one was silently fatal rather than
  // merely wrong: by year two this returned four conference games, the
  // `length === 2` guard failed, and NO FINAL WAS EVER CREATED.
  const games = await prisma.game.findMany({ where: { leagueId, seasonYear, kind: 'CONFERENCE', played: true } });
  const winners = games.map((g) => (g.homeScore >= g.awayScore ? g.homeTeamId : g.awayTeamId));
  if (winners.length === 2) {
    await withRoundLock(leagueId, 'FINAL', seasonYear, async (tx) => {
      await tx.game.create({
        data: { leagueId, seasonYear, week: 4, kind: 'FINAL', homeTeamId: winners[0], awayTeamId: winners[1] },
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Offseason
// ---------------------------------------------------------------------------

/**
 * ===========================================================================
 * THE OFFSEASON, IN THE ADVANCES A GM ACTUALLY PRESSES
 * ===========================================================================
 * Five steps, TWO advances. The steps below are unchanged and still run in
 * this order — what changed is how many of them one press of Advance carries.
 *
 * It used to be one step per press, which put SIX presses between the final
 * whistle and free agency, and four of them asked the user nothing: rosters
 * age, the standings reset, contracts roll a year, the pick horizon extends.
 * Every one of those was bookkeeping he clicked through to reach the one
 * screen that actually asks him a question. The app owner: *"thats so many
 * advances, we need to combine some of these"*, and then *"ideally i'd like
 * post super bowl to free agency to be 3 advances"* — so the bookkeeping is
 * GROUPED rather than deleted, and the group boundary is where the reading
 * changes:
 *
 *   Advance 1  PROGRESS, RESET_STANDINGS, AGE_CONTRACTS — the season just
 *              played is settled and the new league year opens.
 *   Advance 2  ADD_DRAFT_CLASS, RESIGN — the incoming class is on the board
 *              and his own expiring men become a decision (phase -> RESIGN).
 *   Advance 3  out of RESIGN: whoever wasn't kept walks, free agency opens.
 *
 * Both of the first two have something worth reading in the summary, which is
 * the point of splitting there rather than running all four at once: an
 * advance that reports nothing is an advance that reads as broken.
 *
 * LEAGUE.WEEK STILL COUNTS STEPS, NOT PRESSES, and that is deliberate rather
 * than lazy. A week is still "the next step in OFFSEASON_STEPS", so:
 *
 *   - CAP.OFFSEASON_YEAR_ROLL_WEEK keeps both its meaning and its value —
 *     RESET_STANDINGS is still the step at week 2, so capChargeYear() files
 *     dead money against the same league year it did before (see there).
 *   - a save left mid-offseason by the old one-step-per-press build resumes
 *     at exactly the step it stopped on and is grouped from there.
 *   - a step that throws leaves the week ON THE STEP THAT FAILED, so the
 *     steps already done are not re-run. See runOffseasonStep.
 *
 * One press moves the week by however many steps it ran, so a league that
 * starts its offseason under this build reads week 1 -> week 4 -> RESIGN. The
 * weeks in between are still real and still mean what they always did; they
 * are simply passed through rather than stopped on, unless a step throws and
 * leaves the league standing on the one that failed.
 * ===========================================================================
 */
const OFFSEASON_ADVANCES = [
  ['PROGRESS', 'RESET_STANDINGS', 'AGE_CONTRACTS'],
  ['ADD_DRAFT_CLASS', 'RESIGN'],
] as const;

/** Every offseason step in order. League.week is a 1-based index into this. */
const OFFSEASON_STEPS = OFFSEASON_ADVANCES.flat();

type OffseasonStep = (typeof OFFSEASON_ADVANCES)[number][number];

/**
 * What one press of Advance runs, starting from the step League.week points
 * at: the remainder of the advance that step belongs to. Clamped exactly as
 * the old index arithmetic was, so a save that somehow ran past the end of
 * the list re-runs the last step rather than reading off the end of it.
 */
function offseasonAdvanceFrom(week: number): OffseasonStep[] {
  const idx = Math.min(Math.max(week, 1) - 1, OFFSEASON_STEPS.length - 1);
  let start = 0;
  for (const advance of OFFSEASON_ADVANCES) {
    if (idx < start + advance.length) return advance.slice(idx - start);
    start += advance.length;
  }
  return [OFFSEASON_STEPS[OFFSEASON_STEPS.length - 1]];
}

async function runOffseasonStep(leagueId: string, rng: Rng) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const steps = offseasonAdvanceFrom(league.week);

  /**
   * ===========================================================================
   * ONE CLICK, ONE OFFSEASON ADVANCE
   * ===========================================================================
   * Same bug as the regular season's duplicate advance (see ONE WEEK, ONE SET
   * OF LEAGUE-WIDE EFFECTS), and worse here, because none of these steps has a
   * per-row guard to fall back on. The week is the only thing standing between
   * a double click and the work being done twice, so two concurrent clicks
   * would both read the same week, both do the whole thing, and both leave it
   * on the same number — the league looks fine and the damage is invisible:
   *
   *   PROGRESS         every player ages twice, develops twice, and gets two
   *                    retirement rolls in one offseason.
   *   RESET_STANDINGS  rollSeasonStatsIntoCareer runs twice, so every career
   *                    total in the league is permanently doubled.
   *   ADD_DRAFT_CLASS  a second set of future picks.
   *
   * (AGE_CONTRACTS is already immune — it stamps League.contractsAgedYear.)
   *
   * THE CLAIM IS AT THE TOP HERE, WHICH IS THE OPPOSITE OF THE REGULAR SEASON,
   * and the difference is deliberate. A week's sixteen games are individually
   * claimed, so claiming the week late costs a duplicate click some wasted CPU
   * and nothing else. An offseason step has no such inner guard: by the time
   * the work is done it is already done twice. So the work is claimed before
   * it runs, and rolled back if it throws.
   *
   * ONE CLAIM COVERS THE WHOLE ADVANCE, however many steps it carries: the
   * week jumps straight to the far side of the group, so a second click
   * arriving anywhere inside a running advance finds a week it cannot match
   * and does nothing. That is the only way to say it once — claiming per step
   * inside the loop would leave a duplicate click free to race in through the
   * gap between two steps and run the rest of the group alongside the first.
   *
   * AND A THROW PARTWAY THROUGH GIVES BACK ONLY WHAT IT DID NOT DO. The week
   * is put back to the step that FAILED, not to the start of the advance, so
   * the steps that already committed are never re-run — re-running PROGRESS or
   * RESET_STANDINGS is exactly the silent doubling above. The next press picks
   * up at the failed step and finishes the group, which costs the user one
   * extra click in a case that should not happen and nothing else. This is why
   * League.week still counts steps rather than presses.
   *
   * The residual risk is a HARD kill — a serverless timeout, not an
   * exception — between the claim and the rollback, which would skip the rest
   * of the advance outright. That is the trade being made, and it is the right
   * way round: these steps are bulk updates measured in hundreds of
   * milliseconds, where a week is sixteen simulated games, and a skipped step
   * is visible and re-runnable while doubled career stats are silent and
   * permanent.
   */
  const claimed = await prisma.league.updateMany({
    where: { id: leagueId, phase: 'OFFSEASON', week: league.week },
    data: { week: league.week + steps.length },
  });
  if (claimed.count === 0) {
    return { summary: 'That offseason step has already been taken.' };
  }

  let done = 0;
  try {
    const parts: string[] = [];
    for (const step of steps) {
      // THE LEAGUE IS RE-READ BETWEEN STEPS, because one of them moves the
      // league year underneath the others: RESET_STANDINGS increments
      // seasonYear, and AGE_CONTRACTS, ADD_DRAFT_CLASS and RESIGN all take it
      // as an argument and mean the NEW one. When each step was its own
      // request that came for free. `week` is overridden with the step's own
      // index rather than the claimed one so every step still sees the week it
      // saw when it was a press of its own — it is what the RESIGN wave stamps
      // its transactions with.
      const current = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
      const view = { ...current, week: league.week + done };
      const { summary } = await runOffseasonStepClaimed(leagueId, view, settings, step, rng);
      parts.push(summary);
      done++;
    }
    // One report, not a stack of receipts: the steps write their sentences to
    // be read in sequence (see each case), so this is a join rather than a
    // list. It is the only record the user gets that any of this happened.
    return { summary: parts.join(' ') };
  } catch (err) {
    await prisma.league.updateMany({
      where: { id: leagueId, phase: 'OFFSEASON', week: league.week + steps.length },
      data: { week: league.week + done },
    });
    throw err;
  }
}

async function runOffseasonStepClaimed(
  leagueId: string,
  league: Awaited<ReturnType<typeof prisma.league.findUniqueOrThrow>>,
  settings: ReturnType<typeof parseSettings>,
  step: OffseasonStep,
  rng: Rng,
) {
  /*
   * THE SUMMARIES ARE WRITTEN TO BE READ IN SEQUENCE. Several of these steps
   * now share one press of Advance (see OFFSEASON_ADVANCES) and their
   * sentences are joined into a single paragraph, which is the only record the
   * user gets that any of it happened. So each one states its own fact plainly
   * and does not repeat the ones before it — read on their own they are still
   * whole sentences, read together they are a report rather than four receipts.
   *
   * None of them writes League.week any more: the claim in runOffseasonStep
   * owns the week for the whole advance. Writing it here as well would put the
   * week a step further on than the work actually got.
   */
  switch (step) {
    case 'PROGRESS': {
      const retired = await progressAllPlayers(leagueId, rng, settings.retirementEnabled);
      // Free agents age on the same schedule. Skipping them is what turned the
      // unsigned pool into a permanent sink — see progressFreeAgents().
      const fa = await progressFreeAgents(leagueId, rng, {
        retirementEnabled: settings.retirementEnabled,
        progressionSpeed: settings.progressionSpeed,
      });
      // The league year has not rolled yet at this step, so seasonYear still
      // names the season that was just played — which is the one being closed.
      const walked = retired > 0
        ? `${retired} player${retired === 1 ? '' : 's'} retired, and everyone still playing is a year older`
        : 'nobody retired, and every roster is a year older';
      return {
        summary: `The ${league.seasonYear} season is in the books — ${walked}.`
          + (fa.retired > 0 ? ` ${fa.retired} unsigned player${fa.retired === 1 ? ' is' : 's are'} out of football.` : ''),
      };
    }
    case 'RESET_STANDINGS': {
      await rollSeasonStatsIntoCareer(leagueId, league.seasonYear);
      await prisma.team.updateMany({
        where: { leagueId },
        data: { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgnst: 0, divWins: 0, divLosses: 0, confWins: 0, confLosses: 0, playoffSeed: null, eliminated: false },
      });
      await prisma.league.update({ where: { id: leagueId }, data: { seasonYear: league.seasonYear + 1 } });
      // This is the one line in the phase machine where seasonYear actually
      // moves, so it is where a per-season allowance turns over. Private
      // workout slots are stamped with the year they belong to and would read
      // as zero-used anyway; zeroing them here means the count on screen
      // changes with the calendar rather than on the next spend.
      await resetWorkoutSlots(leagueId, league.seasonYear + 1);
      return { summary: `Standings are wiped and the ${league.seasonYear + 1} league year is open.` };
    }
    case 'AGE_CONTRACTS': {
      // Normally a no-op now: the ledger already stepped onto this league year
      // when the season ended. It still runs for any save created before
      // League.contractsAgedYear existed, which reached this point with its
      // contracts un-aged — that is the whole point of making the call
      // idempotent rather than moving it outright.
      const aged = await ageContractsForYear(leagueId, league.seasonYear);
      await expireStaleCapCharges(leagueId, league.seasonYear);
      return {
        summary: aged
          ? 'Every contract has advanced a year, and expiring deals are up for renegotiation.'
          : 'Expiring deals are up for renegotiation.',
      };
    }
    case 'ADD_DRAFT_CLASS': {
      // The class itself was added back at week 1 of the season that just
      // ended, so it could be scouted all year — this step only extends the
      // rolling future-picks horizon for pick trading. It is still where the
      // GM is told the board is there, because this is the advance that puts
      // the draft in front of him.
      await addFutureDraftPicks(leagueId, league.seasonYear);
      const onTheBoard = await prisma.player.count({ where: { leagueId, isDraftee: true } });
      return {
        summary: (onTheBoard > 0
          ? `The incoming draft class is on the board — ${onTheBoard} prospects, scouted all season.`
          : 'The incoming draft class is on the board.')
          + ` Future picks now run out to ${league.seasonYear + 3} for trading.`,
      };
    }
    case 'RESIGN':
    default: {
      // AI teams make their own keep-or-let-walk calls before the user
      // lands on the re-sign screen, same as a real front office already
      // having a plan by the time the window opens.
      const kept = await runAiResignWave(leagueId, league.seasonYear, league.week, settings.capMode, rng);
      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'RESIGN', week: 1 } });
      return {
        summary: (kept > 0 ? `Around the league, clubs have already re-signed ${kept} of their own expiring players. ` : '')
          + 'Re-sign yours, then advance to open free agency.',
      };
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
 *
 * The postseason pair rolls on exactly the same schedule and never mixes with
 * the regular-season pair. LeagueRecord is fed the REGULAR line only, which is
 * what "single-season record" means everywhere the phrase is used — a 4,300-
 * yard year and a 4,300-yard year plus a playoff run are not the same
 * achievement and the record book must not treat them as one.
 */
async function rollSeasonStatsIntoCareer(leagueId: string, seasonYear: number) {
  const players = await prisma.player.findMany({
    where: { leagueId, NOT: { seasonStats: '{}', playoffStats: '{}' } },
    select: {
      id: true, firstName: true, lastName: true, seasonStats: true, careerStats: true,
      playoffStats: true, careerPlayoffStats: true, team: { select: { abbr: true } },
    },
  });
  const recordInputs: Parameters<typeof checkAndUpdateRecords>[2] = [];
  for (const p of players) {
    const season = readJson<SeasonStats>(p.seasonStats, {});
    const playoff = readJson<SeasonStats>(p.playoffStats, {});
    if (Object.keys(season).length === 0 && Object.keys(playoff).length === 0) continue;
    const career = mergeStats(readJson<SeasonStats>(p.careerStats, {}), season);
    const careerPlayoff = mergeStats(readJson<SeasonStats>(p.careerPlayoffStats, {}), playoff);
    await prisma.player.update({
      where: { id: p.id },
      data: {
        careerStats: writeJson(career), seasonStats: '{}',
        careerPlayoffStats: writeJson(careerPlayoff), playoffStats: '{}',
      },
    });
    if (Object.keys(season).length === 0) continue;
    recordInputs.push({ id: p.id, firstName: p.firstName, lastName: p.lastName, teamAbbr: p.team?.abbr ?? 'FA', seasonFinal: season, careerFinal: career });
  }

  // Year-by-year stat lines. The merge above is lossy by design — careerStats
  // comes out with no season and no team on it — so the per-season rows are
  // rebuilt from this season's played box scores, which are the only place the
  // club-he-played-for-that-year exists. One sweep, chunked writes, no
  // per-player round trip; a save that predates PlayerSeason gets its whole
  // played history caught up here the first time it advances. `seasonYear + 1`
  // is the age basis: PROGRESS is the step immediately before this one — the
  // same press of Advance, since the two share one (see OFFSEASON_ADVANCES) —
  // and has already aged everyone for the season about to start. See
  // lib/playerSeasons.ts and docs/player-seasons.md.
  await syncPlayerSeasons(leagueId, seasonYear, seasonYear + 1);

  const breaks = await checkAndUpdateRecords(leagueId, seasonYear, recordInputs);
  for (const b of breaks) {
    await prisma.transaction.create({
      // Typed NEWS and always has been (the wire scores it off the headline,
      // see baseWeight in lib/wireRank.ts), but it is a row about ONE MAN
      // setting a record, so it carries him like every other player-shaped
      // row. `RecordBreak` has had his id on it since lib/records.ts was
      // written; nothing was passing it on.
      data: { leagueId, seasonYear, week: 1, type: 'NEWS', teamId: null, playerId: b.playerId, headline: 'League Record', detail: recordBreakHeadline(b) },
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
 *
 * Returns how many careers ended. That number used to go nowhere and the step
 * said only that "some" were over; it now shares one advance with the rest of
 * the offseason bookkeeping, so the summary is the only place a GM learns his
 * league lost anyone at all and it had better say how many.
 */
async function progressAllPlayers(leagueId: string, rng: Rng, retirementEnabled: boolean): Promise<number> {
  const players = await prisma.player.findMany({
    where: { leagueId, status: 'ACTIVE' },
    select: { id: true, age: true, trueOvr: true, position: true },
  });
  if (players.length === 0) return 0;

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
      // `injuryType: null` alongside the zeroed clock, because the two are one
      // fact and were being cleared separately. This wrote injuryWeeks: 0 and
      // left the label behind, so a man who ended the season with a torn
      // hamstring carried "Hamstring" into the new one with nothing counting
      // down. Nothing rendered it — every reader gates on injuryWeeks > 0 —
      // which is precisely why it survived: a dangling label is invisible
      // right up until the day something reads the label first.
      // recoverFatigueAndInjuries clears both together; so does this now.
      data: { age: { increment: 1 }, experience: { increment: 1 }, fatigue: 0, injuryWeeks: 0, injuryType: null },
    });
  }
  return retiringIds.length;
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
 *
 * THE DELETE IS THE CLAIM, and the order of these three writes is the reason.
 * This was the one `contract.delete({ where: { id } })` in the codebase — every
 * other release in the game uses `deleteMany` or deletes by `playerId`, the
 * forms that shrug at a row already gone — and it threw P2025 on ids the
 * findMany above had just returned, which reads as impossible until you notice
 * a second advance in the same window releasing the same men (see the claim in
 * the RESIGN case, which is where that is actually fixed).
 *
 * It could have been left as a shrug. It is not, because the cap charge was
 * written FIRST: two runners both booked the void-year bill before either
 * deleted anything, so the club paid the same stranded proration twice and only
 * the crash said so. Deleting first turns the row into the token — exactly one
 * runner can take a given man off the books, and only that runner charges his
 * club and puts him on the street. Anyone who arrives second finds nothing to
 * take and moves on.
 */
async function releaseUnresignedExpiringContracts(leagueId: string, seasonYear: number) {
  const expired = await prisma.contract.findMany({
    where: { yearsRemaining: 0, player: { leagueId, status: 'ACTIVE' } },
    include: { player: true },
  });
  for (const c of expired) {
    const claimed = await prisma.contract.deleteMany({ where: { id: c.id } });
    if (claimed.count === 0) continue;
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
 * On AI teams the worst players go, weighed against what releasing each of
 * them costs — see CUT_DEAD_MONEY_PER_OVR below. Their dead money is booked
 * like any other cut, because over-signing has to cost something, and since
 * dead money became the unamortised bonus PLUS guaranteed salary still owed
 * (lib/cap.ts) the bill at the bottom of a roster is no longer negligible: a
 * man signed this offseason costs a real share of his deal to walk away from,
 * whatever his rating. That is what the exchange rate below is for. One
 * transaction per team rather than one per player: 100+ individual CUT rows a
 * year would bury the wire.
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
/**
 * [TUNE] What a dollar of dead money is worth, in rating points, when a club
 * decides who to waive. $1.5M ~ one point: a 61 who costs $3.0M to release is
 * treated as a 63, so an equally-rated man on a minimum deal goes first.
 *
 * Calibrated to be decisive without being absolute — it stops a club torching
 * cap space over a one-point difference, and still lets it cut a genuinely
 * expensive player who is genuinely bad.
 */
const CUT_DEAD_MONEY_PER_OVR = 1_500_000;

async function trimRostersToLimit(
  leagueId: string, seasonYear: number, settings: LeagueSettings,
): Promise<{ trimmed: number; userOverflow: { abbr: string; over: number; rosterSize: number } | null }> {
  const limit = settings.rosterMax || LEAGUE.ROSTER_MAX;
  const teams = await prisma.team.findMany({ where: { leagueId }, select: { id: true, abbr: true, isUser: true } });
  let total = 0;
  let userOverflow: { abbr: string; over: number; rosterSize: number } | null = null;

  /**
   * One roster-limit release: the dead money booked, the contract torn up,
   * the man on the street. The cap-driven releases below go through
   * `cutPlayer` instead (via autoClearCapRoom), which does the same three
   * things plus its own wire entry and depth-chart repair.
   */
  const release = async (p: {
    id: string; firstName: string; lastName: string; teamId: string | null;
    contract: Parameters<typeof deadMoneyOnCut>[0];
  }) => {
    const dead = deadMoneyOnCut(p.contract, settings.capMode);
    if (dead > 0 && p.teamId) {
      await prisma.capCharge.create({
        data: { teamId: p.teamId, year: seasonYear, amount: dead, label: `Dead money — ${p.firstName} ${p.lastName}` },
      });
    }
    if (p.contract) await prisma.contract.delete({ where: { playerId: p.id } });
    await prisma.player.update({ where: { id: p.id }, data: { teamId: null, status: 'FREE_AGENT' } });
  };

  for (const team of teams) {
    const roster = await prisma.player.findMany({
      where: { teamId: team.id, status: 'ACTIVE' },
      include: { contract: true },
      orderBy: [{ trueOvr: 'asc' }, { id: 'asc' }],
    });
    const overflow = roster.length - limit;
    // The user's roster is his own to decide; the advance is blocked instead.
    // His cap sheet is likewise his own problem, and the compliance gate
    // already stops the clock over it — so he is out of this loop entirely.
    if (team.isUser) {
      if (overflow > 0) userOverflow = { abbr: team.abbr, over: overflow, rosterSize: roster.length };
      continue;
    }

    /*
     * FINAL CUTS WEIGH WHAT A RELEASE COSTS, NOT JUST THE RATING.
     *
     * This cut strictly by lowest trueOvr, so a club would eat a large
     * guaranteed hit to waive a 61 while a 63 on a minimum deal — free to
     * release — sat next to him. No front office does that; the whole point of
     * cut-down day is that money is part of the decision.
     *
     * It survived because AI clubs used to draft on true ratings, so their own
     * picks were never the worst men on the roster and the expensive-to-cut
     * players were never in the firing line. Once clubs started drafting off a
     * fallible board (see AI CLUBS DRAFT OFF A READ in lib/draft.ts), late
     * picks could genuinely be bad — and measured, clubs began waiving men they
     * had drafted days earlier, writing the rookie bonus off as dead money and
     * going over the cap on cut-down day. sim:health INV-19 rose from 6 hits to
     * 28-50, and nothing re-checks AI compliance between the draft and week 1,
     * so a club that went over STAYED over for all seventeen weeks.
     *
     * Dead money is converted into rating points rather than compared against
     * them directly, because the two are not otherwise commensurable and a
     * ratio would need its own scale anyway. CUT_DEAD_MONEY_PER_OVR is that
     * exchange rate: a player costing this much to release is as hard to cut as
     * a man one rating point better.
     */
    const cutScore = (p: (typeof roster)[number]) =>
      p.trueOvr + deadMoneyOnCut(p.contract, settings.capMode) / CUT_DEAD_MONEY_PER_OVR;
    const cuts = overflow > 0
      ? [...roster]
        .sort((a, b) => cutScore(a) - cutScore(b) || a.trueOvr - b.trueOvr || a.id.localeCompare(b.id))
        .slice(0, overflow)
      : [];
    for (const p of cuts) await release(p);

    /*
     * AND THE CLUB MAY NOT WALK INTO THE SEASON OVER THE CEILING.
     *
     * The trim above is the last roster event before week 1, and nothing
     * re-checks an AI club's cap between here and the following offseason —
     * so a club that ends cut-down day over the ceiling stays over for the
     * whole season, which is what INV-19 reports every week of it.
     *
     * It could always happen: the cuts above BOOK dead money, so a trim can
     * spend a club's last room rather than free room. It got materially more
     * likely when dead money became the unamortised bonus PLUS guaranteed
     * salary still owed (lib/cap.ts). Measured across 6 leagues x 2 seasons,
     * counting only over-cap readings OUTSIDE the offseason's own tolerated
     * window (CAP_ROLLOVER_PHASES above), where being over is legitimate:
     *
     *   44 team-readings before the dead-money change
     *  110 after it
     *    0 after it, with this block
     *
     * Almost all of that middle figure was clubs that crossed here by a
     * million or two and then sat over the ceiling until March, because
     * nothing looks again until the offseason.
     *
     * So the club pays the shortfall down through `autoClearCapRoom`
     * (lib/capEnforcement.ts) rather than a second selection rule written
     * next door: that function is already the game's one answer to "an AI
     * club has to find room", it picks by what the club loses in FOOTBALL
     * rather than by the biggest cap number, and it stops honestly when no
     * combination of releases can cover the bill — at which point the
     * standing over-cap machinery carries it, exactly as it does for a user
     * whose remaining moves all cost money.
     */
    let capCuts: { name: string; freed: number }[] = [];
    if (settings.capMode === 'REALISTIC') {
      const { teamCapSummary } = await import('./cap-summary');
      const { autoClearCapRoom } = await import('./capEnforcement');
      const space = (await teamCapSummary(team.id, seasonYear, settings.capMode)).capSpace;
      if (space < 0) {
        capCuts = await autoClearCapRoom({
          leagueId, teamId: team.id, needed: -space, seasonYear, capMode: settings.capMode, week: 1,
        });
      }
    }

    // `autoClearCapRoom` writes its own CUT row per man it releases, so this
    // one describes the roster trim only — otherwise the wire would carry the
    // same release twice under two different headlines.
    if (cuts.length > 0) {
      const name = (p: (typeof roster)[number]) => `${p.firstName} ${p.lastName} (${p.position})`;
      await prisma.transaction.create({
        data: {
          // NO `playerId`, and that is the honest answer rather than an
          // oversight: this row is one club's whole cut-down day, a dozen men
          // in a single sentence. Naming one of them as "the man this row is
          // about" would be a worse claim than naming none. The individual
          // releases the wire can link are the ones `cutPlayer` writes.
          leagueId, seasonYear, week: 1, type: 'CUT', teamId: team.id,
          headline: `Final cuts — ${cuts.length} released`,
          detail: `${cuts.map(name).join(', ')} waived to reach the ${limit}-man limit.`
            + (capCuts.length ? ` ${capCuts.length} more followed to get back under the salary cap.` : ''),
        },
      });
    }
    total += cuts.length + capCuts.length;
  }
  return { trimmed: total, userOverflow };
}

/**
 * What the front office settled on for ONE man on the re-sign list — one of
 * these per player the page lists, whether or not a deal got written.
 */
export type ResignDecision = {
  playerId: string;
  name: string;
  position: string;
  /**
   * RESIGNED — expiring deal replaced with a new one.
   * EXTENDED — walk-year man handed years early.
   * WALKING  — his deal is already up and was not renewed; he reaches free
   *            agency when the re-sign window closes.
   * HELD     — walk-year man left on the deal he is already on. He is not
   *            released and nothing happens to him this offseason.
   */
  outcome: 'RESIGNED' | 'EXTENDED' | 'WALKING' | 'HELD';
  /** Terms, when a deal was actually written. */
  years?: number;
  apy?: number;
  /** Why not, in the words the screen shows. */
  note?: string;
};

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
 * only ever counts those. He still gets an entry in `decisions` (as HELD),
 * because a front office that looked at a man and chose to do nothing has
 * decided about him, and the screen that delegated the work has to be able to
 * say so.
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
  const { marketValue, suggestedYears, maxYearsForAge, buildContract, buildExtension, capHit } = await import('./cap');
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
  if (pending.length === 0) return { kept: 0, released: 0, decisions: [] as ResignDecision[] };

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
  /*
   * ONE ENTRY PER MAN ON THE LIST.
   *
   * `kept` and `released` between them only ever counted signings and expired
   * players let go, so a walk-year player the front office weighed and left
   * alone landed in neither — and the delegate button on the re-sign page
   * reports those two numbers. Measured on a live save: the page listed 11
   * men, the button answered "kept 4, let 0 walk" and said nothing whatsoever
   * about the other 7, which reads as a button that quit a third of the way
   * down the list. It had not: it decided on all 11 and could only describe 4.
   *
   * So every branch below records its man before it continues, and the count
   * of decisions is the count of pending players by construction.
   */
  const decisions: ResignDecision[] = [];
  const record = (
    player: (typeof pending)[number],
    outcome: ResignDecision['outcome'],
    extra: { note?: string; years?: number; apy?: number } = {},
  ) => {
    decisions.push({
      playerId: player.id,
      name: `${player.firstName} ${player.lastName}`,
      position: player.position,
      outcome,
      ...extra,
    });
  };

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
      // The football reason, in the order the tests above actually weigh it.
      const note = !worthKeeping
        ? (p.trueOvr < bar ? 'not worth what a new deal would cost' : 'covered at the position')
        : !worthExtendingEarly
          ? 'under contract for the coming season, no need to move early'
          : 'no room on the roster for him';
      record(p, expired ? 'WALKING' : 'HELD', { note });
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

    // Budget against the DELTA, not the gross: the old hit stops being charged
    // on its own the instant the new deal is signed, which is exactly what
    // extendContract's assertCapRoom credits back.
    const oldHit = capHit(p.contract, capMode);
    // AND MEASURE IT THE WAY IT WILL BE SIGNED. `extendContract` APPENDS when
    // he is still under contract — his walk-year salary survives and the new
    // bonus prorates on top of it — so a budget priced off a fresh
    // `buildContract` would be budgeting for a contract this wave can no
    // longer produce, and the two disagree in both directions: the appended
    // year-1 hit is the salary he was already promised plus new proration,
    // which is larger than a fresh deal's year-1 base on a walk-year veteran
    // and smaller on a man whose old salary was tiny. Either way the wave
    // would be spending against a number it had made up.
    const preview = p.contract!.yearsRemaining > 0
      ? buildExtension({ current: p.contract!, newMoneyApy: apy, addYears: years, signedYear: seasonYear })
      : buildContract({ apy, years, signedYear: seasonYear });
    const newHit = capHit({ ...preview, baseSalaries: writeJson(preview.baseSalaries) }, capMode);
    // Hold back money for free agency and the draft class, plus the league
    // minimum for every roster slot still short of a legal roster.
    const openSlots = Math.max(0, rosterMin - projected);
    const reserve = capMode === 'OFF' ? 0 : RESIGN.CAP_RESERVE + openSlots * CAP.MIN_SALARY;
    if (newHit - oldHit > capSpace - reserve) {
      record(p, expired ? 'WALKING' : 'HELD', { note: 'no cap room for the deal he would want' });
      if (expired) released++;
      continue;
    }

    const ok = await extendContract({ leagueId, playerId: p.id, apy, years, seasonYear, capMode, week, reSign: true })
      .then(() => true)
      .catch(() => false);
    if (ok) {
      record(p, expired ? 'RESIGNED' : 'EXTENDED', { years, apy });
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
    } else {
      // The cap gate above budgets; extendContract's own assertCapRoom is the
      // authority, and when it refuses the man is in exactly the position the
      // budget check would have left him in.
      record(p, expired ? 'WALKING' : 'HELD', { note: 'no cap room for the deal he would want' });
      if (expired) released++;
    }
  }
  return { kept, released, decisions };
}

/**
 * AI-only offseason wave — every non-user team decides on its own pending
 * re-sign class before the user ever lands on the re-sign screen. Without
 * this, no CPU team ever extends anyone: every expiring contract league-wide
 * would hit release at the end of RESIGN and dump the entire AI side of the
 * league into free agency every single year.
 *
 * Returns how many men the league kept, which is the one fact about this wave
 * a GM can act on: it is the size of the market that is NOT about to open.
 */
async function runAiResignWave(leagueId: string, seasonYear: number, week: number, capMode: LeagueSettings['capMode'], rng: Rng): Promise<number> {
  const teams = await prisma.team.findMany({ where: { leagueId, isUser: false } });
  let kept = 0;
  for (const team of teams) {
    const decisions = await resignDecisionsForTeam(leagueId, team.id, seasonYear, week, capMode, rng);
    kept += decisions.kept;
  }
  return kept;
}

/**
 * ---------------------------------------------------------------------------
 * THE WIRE — topping the unsigned pool back up to a market
 * ---------------------------------------------------------------------------
 * A beta tester reported no free agents after year one and he was right: the
 * league minted 140 spare players at creation, nothing ever replenished them,
 * and year one's contracts were written fresh with multi-year terms so almost
 * nothing expired into the first offseason. Measured, the 2027 free-agency
 * screen showed 15 players for four straight weeks with a 57 OVR at the top of
 * it — the screen a GM has waited a whole season for, blank.
 *
 * So the market has a floor under it. This is a TOP-UP, not an injection: it
 * counts what is really on the wire after the re-sign window has emptied and
 * mints only the difference, which from the second offseason on is zero — the
 * league's own expired contracts and undrafted rookies carry the pool to
 * 300-470 on their own and `fringeShortfall` returns nothing.
 *
 * What it mints is fringe by construction, not by hope — see
 * generateFringeFreeAgents in lib/gen/league.ts and GENERATION.FRINGE_OVR_MEAN
 * for the caps. Nobody here is a hidden star, and none of them displaces the
 * real story of the market, which is still whose contract ran out.
 */
async function addFringeFreeAgents(leagueId: string, rng: Rng): Promise<number> {
  const pool = await prisma.player.count({
    where: { leagueId, status: 'FREE_AGENT', teamId: null, isDraftee: false },
  });
  const count = fringeShortfall(pool);
  if (count <= 0) return 0;

  // Seed the ledger from everyone already in the league, exactly as
  // addDraftClass does, so a camp body can't be handed a sitting starter's
  // name. Names are unique league-wide by construction everywhere else and
  // this is the only way an in-memory batch can know that.
  const existing = await prisma.player.findMany({
    where: { leagueId },
    select: { firstName: true, lastName: true },
  });
  const names = new NameRegistry(existing.map((p) => `${p.firstName} ${p.lastName}`));
  const rows = generateFringeFreeAgents(rng, count, names)
    .map((p) => toPlayerCreate(p, leagueId, { status: 'FREE_AGENT', teamId: null }));
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) await prisma.player.createMany({ data: rows.slice(i, i + CHUNK) });
  return rows.length;
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
  /*
   * THREE TRADEABLE FUTURE YEARS, COUNTED AFTER THE DRAFT TAKES ONE.
   *
   * This topped up to seasonYear + 2, which reads as a three-year horizon and
   * is not one: the imminent draft then consumes its own year and the trade
   * hub is left showing two. Rebuilding is the fantasy this game is for, and
   * a rebuild is paid for in future picks — two years is a thin market to
   * sell into, and the third year is the one that lets a teardown actually
   * price a veteran.
   *
   * Written as "ensure every year through seasonYear + 3 exists" rather than
   * "add one year", so a save that was created under the old horizon — or
   * one that skipped an offseason step — repairs itself on the next advance
   * instead of staying one year short forever.
   */
  const rows: any[] = [];
  for (let year = seasonYear + 1; year <= seasonYear + 3; year++) {
    const existing = await prisma.draftPick.count({ where: { leagueId, year } });
    if (existing > 0) continue;
    for (let round = 1; round <= settings.draftRounds; round++) {
      teams.forEach((team, i) => {
        rows.push({ leagueId, year, round, slot: i + 1, originalTeamId: team.id, ownerTeamId: team.id });
      });
    }
  }
  if (rows.length === 0) return;
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
