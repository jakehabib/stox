import { prisma } from './db';
import { Rng, clamp } from './rng';
import { readJson, writeJson } from './json';
import { buildContract, rookieScaleApy, marketValue, suggestedYears, capHit } from './cap';
import { parseGmProfile, playerValue, teamNeeds, RosterPlayer, defaultGmProfile } from './ai/gm';
import { AI, CAP, CONSENSUS, LEAGUE, Position } from './tuning';
// Type only. The runtime import stays dynamic, inside the two functions that
// need it, exactly as draftPlayer does it — capEnforcement pulls the whole cap
// sheet in behind it and this module is imported by every draft screen.
import type { ReliefOption } from './capEnforcement';
import { consensusBoardMap, CONSENSUS_EVAL, type ConsensusRead } from './consensus';
import type { CapMode, GmProfile } from './types';
import { reconcileDepthChart, rosterCapTarget } from './gen/league';
import { runAiPositionConversions } from './ai/positionChange';

/**
 * ===========================================================================
 * DRAFT SYSTEM (design doc section 12)
 * ===========================================================================
 * Works for both the annual rookie draft and the league-start fantasy draft
 * off the same DraftState row + a snake/linear pick order. The AI GM picks by
 * blending best-player-available with positional need, using the same
 * profile-driven bias as free agency and trades, plus a small "reach" chance
 * for variance.
 *
 * WHAT "BEST PLAYER AVAILABLE" MEANS HERE. For a rookie it is the best player
 * the club BELIEVES is available — its own read of the public consensus board,
 * never `trueOvr`. See AI CLUBS DRAFT OFF A READ below, which is where the
 * whole rookie-pick path lives. A veteran in a fantasy draft is a different
 * problem and is still valued on the truth: he has years of tape, and the fog
 * this game models is a fog about twenty-two-year-olds.
 *
 * BOTH DRAFTS PUT THE MAN ON A CONTRACT, and they are not the same contract:
 * a rookie signs the scale for the slot he went at, a fantasy pick signs a
 * veteran deal at his own market price. See WHAT A FANTASY PICK IS PAID below.
 * ===========================================================================
 */

export async function currentPick(leagueId: string) {
  const state = await prisma.draftState.findUnique({ where: { leagueId } });
  if (!state || state.complete) return null;

  if (state.kind === 'FANTASY') {
    // The fantasy draft has no DraftPick rows to consult — it's a plain
    // snake of team turns, so the stored order is the whole story.
    const order = readJson<string[]>(state.order, []);
    if (order.length === 0) return null;
    const teamId = order[state.pickIndex % order.length];
    if (!teamId) return null;
    return { state, teamId, pick: null as null };
  }

  // Rookie draft: resolve the pick on the clock from LIVE DraftPick
  // ownership every time, instead of a turn-order array computed once at
  // draft start. That array was always built from round 1's pick ownership
  // and then reused verbatim for every later round (see reseedDraftOrder),
  // so it silently ignored any trade involving a round-2+ pick: the team
  // that traded that pick away still got a turn (and, since it owned no
  // unused pick that round, drafted the player for free — no contract, no
  // pick consumed), while the team that acquired it never got an extra turn
  // to use it. Querying the actual DraftPick row for this exact
  // (round, slot) is both simpler and correct for every round, since
  // reseedDraftOrder already reseeds every round's slot from standings, not
  // just round 1's.
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const roundSize = LEAGUE.TEAM_COUNT;
  const round = Math.floor(state.pickIndex / roundSize) + 1;
  const slot = (state.pickIndex % roundSize) + 1;
  const pick = await prisma.draftPick.findFirst({ where: { leagueId, year: league.seasonYear, round, slot } });
  if (!pick) return null;
  return { state, teamId: pick.ownerTeamId, pick };
}

export async function draftPlayer(opts: {
  leagueId: string; playerId: string; teamId: string; seasonYear: number;
}) {
  const pickInfo = await currentPick(opts.leagueId);
  if (!pickInfo) throw new Error('Draft is not active.');
  // The war-room gate, enforced where every pick in the game passes through
  // rather than only in the UI that hides the button. Both callers are covered
  // by one line: the user's own selection and draftOneAiPick's.
  if (!draftIsStarted(pickInfo.state)) throw new Error('The draft has not been opened yet.');
  if (pickInfo.teamId !== opts.teamId) throw new Error('It is not this team\'s pick.');

  const isFantasy = pickInfo.state.kind === 'FANTASY';

  // A fantasy pick signs a real veteran contract, and it is priced BEFORE the
  // write for the same reason the rookie cap check below runs there: fitting
  // the deal to the club's books reads the whole league (the club's payroll,
  // the men still on the board) and none of that belongs inside the
  // transaction that moves one player. See WHAT A FANTASY PICK IS PAID.
  const fantasyDeal = isFantasy
    ? await priceFantasyPick({
        leagueId: opts.leagueId, teamId: opts.teamId, playerId: opts.playerId,
        seasonYear: opts.seasonYear, state: pickInfo.state,
      })
    : null;

  /**
   * A rookie deal is real cap money, and this path used to hand it out with no
   * cap check at all. It's also the one transaction a team can't decline, so
   * the two sides are handled differently WITHOUT giving either an exemption:
   *   - the user is blocked, with the same specific CapViolationError every
   *     other move throws, and has to clear room before picking;
   *   - an AI team clears its own room first (autoClearCapRoom releases the
   *     least valuable veterans that cover the bill) — the same price a real
   *     front office pays to fit its rookie pool — rather than stalling the
   *     draft for everyone. "Fewest" used to be the principle here and it is
   *     not any more: paid by count, a club settled a $990k bill by waiving
   *     its 24-year-old 95, which is where the elite men in the post-draft
   *     free-agent pool were coming from.
   */
  if (!isFantasy && pickInfo.pick) {
    const { parseSettings } = await import('./settings');
    const leagueRow = await prisma.league.findUniqueOrThrow({ where: { id: opts.leagueId } });
    const capMode = parseSettings(leagueRow.settings).capMode;
    if (capMode !== 'OFF') {
      const { assertCapRoom, autoClearCapRoom } = await import('./capEnforcement');
      const { teamCapSummary } = await import('./cap-summary');
      const hit = rookieCapHitForPick(pickInfo.pick, opts.seasonYear, capMode);
      const team = await prisma.team.findUniqueOrThrow({ where: { id: opts.teamId }, select: { isUser: true } });

      if (team.isUser) {
        // The draft is the one transaction a team cannot decline, and DRAFT is
        // the one phase where "advance the week" is not an action the user can
        // take (advanceWeek answers "make your picks, then advance" and moves
        // nothing). So a user whose dead money alone exceeds the ceiling used
        // to be deadlocked on the clock with no exit at all: the pick was
        // blocked, the week would not move, and there is no pass/forfeit
        // action. The same escape valve lib/season.ts's compliance block
        // already uses applies here — block only while a way out still
        // exists; if no combination of cuts can cover the bill, the pick goes
        // through and the standing over-cap warning carries it, exactly like
        // the AI's autoClearCapRoom fallback below.
        const { capComplianceReport } = await import('./capEnforcement');
        const summary = await teamCapSummary(opts.teamId, opts.seasonYear, capMode);
        const shortfall = hit - summary.capSpace;
        if (shortfall > 0) {
          const report = await capComplianceReport(opts.teamId, opts.seasonYear, capMode, { alwaysRelief: true });
          if (report.maxCutRelief >= shortfall) {
            await assertCapRoom({ action: 'Rookie deal', seasonYear: opts.seasonYear, capMode, charges: [{ teamId: opts.teamId, delta: hit }] });
          }
        }
      } else {
        const summary = await teamCapSummary(opts.teamId, opts.seasonYear, capMode);
        const shortfall = hit - summary.capSpace;
        // Still short after cutting everyone who frees anything? Then no
        // legal roster exists and blocking would deadlock the draft — the
        // pick goes through, exactly like the user's escape valve in
        // lib/season.ts's compliance block.
        if (shortfall > 0) {
          await autoClearCapRoom({
            leagueId: opts.leagueId, teamId: opts.teamId, needed: shortfall,
            seasonYear: opts.seasonYear, capMode, week: leagueRow.week,
          });
        }
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.player.update({
      where: { id: opts.playerId },
      data: { teamId: opts.teamId, status: 'ACTIVE', isDraftee: false },
    });

    if (!isFantasy && pickInfo.pick) {
      // Consume the exact pick currentPick() resolved as on the clock —
      // there's only ever one candidate now, not "any unused pick this team
      // happens to own this round" (which could silently be a different
      // pick than the one actually on the clock once trades are involved).
      const pick = pickInfo.pick;
      const player = await tx.player.findUniqueOrThrow({ where: { id: opts.playerId } });
      const overall = overallPickNumber(pick);
      const contract = rookieDealForPick(pick, opts.seasonYear);
      await tx.draftPick.update({ where: { id: pick.id }, data: { used: true, playerId: opts.playerId } });
      await tx.contract.deleteMany({ where: { playerId: opts.playerId } });
      await tx.contract.create({
        data: {
          playerId: opts.playerId, teamId: opts.teamId, years: contract.years, yearsRemaining: contract.years,
          signedYear: contract.signedYear, baseSalaries: writeJson(contract.baseSalaries),
          signingBonus: contract.signingBonus, guaranteed: contract.guaranteed, isRookieDeal: true,
        },
      });
      await tx.player.update({ where: { id: opts.playerId }, data: { draftYear: opts.seasonYear, draftRound: pick.round, draftPickNo: overall } });
      await tx.transaction.create({
        data: { leagueId: opts.leagueId, seasonYear: opts.seasonYear, week: 0, type: 'DRAFT', teamId: opts.teamId,
          playerId: opts.playerId,
          headline: `Round ${pick.round}, Pick ${pick.slot}: ${player.firstName} ${player.lastName} (${player.position})` },
      });
    } else if (fantasyDeal) {
      // `fantasyDeal` is non-null exactly when this is a fantasy pick, so the
      // deal that was priced and the deal that gets written are one decision —
      // there is no arrangement of these two flags that records the pick and
      // forgets the contract, which is the shape the old bug had.
      const player = await tx.player.findUniqueOrThrow({ where: { id: opts.playerId } });
      const c = fantasyDeal.contract;
      // The same defensive clear the rookie branch does. Nothing in the
      // league-start pool is under contract, but "he is on the deal he just
      // signed and no other" is the invariant, not "the pool happens to be
      // clean".
      await tx.contract.deleteMany({ where: { playerId: opts.playerId } });
      await tx.contract.create({
        data: {
          playerId: opts.playerId, teamId: opts.teamId, years: c.years, yearsRemaining: c.years,
          signedYear: c.signedYear, baseSalaries: writeJson(c.baseSalaries),
          signingBonus: c.signingBonus, guaranteed: c.guaranteed, isRookieDeal: false,
        },
      });
      await tx.transaction.create({
        data: { leagueId: opts.leagueId, seasonYear: opts.seasonYear, week: 0, type: 'DRAFT', teamId: opts.teamId,
          playerId: opts.playerId,
          headline: `Fantasy draft, pick ${pickInfo.state.pickIndex + 1}: ${player.firstName} ${player.lastName} (${player.position})`,
          detail: `${c.years}-yr deal, ~$${(fantasyDeal.apy / 1_000_000).toFixed(1)}M/yr` },
      });
    }

    const league = await tx.league.findUniqueOrThrow({ where: { id: opts.leagueId } });
    const { parseSettings } = await import('./settings');
    const rounds = parseSettings(league.settings).draftRounds;
    await advancePick(tx as any, opts.leagueId, pickInfo.state, isFantasy, rounds);
  });

  /**
   * The rookie takes a slot on merit — behind the last man on the chart who
   * out-rates him — instead of the whole chart being rebuilt by rating, which
   * is what `autoDepthChart` did here and which threw away the user's hand-set
   * order on every single pick they made.
   */
  await reconcileDepthChart(opts.teamId);
}

/**
 * ===========================================================================
 * WHAT A ROOKIE COSTS — ONE FUNCTION, EVERY CALLER
 * ===========================================================================
 * The slot price was written out twice inside draftPlayer: once to price the
 * cap check, once to build the contract that actually gets written. Two copies
 * ten lines apart is survivable. It stopped being survivable when the war room
 * started quoting the same figure to a GM BEFORE he opens the draft (see
 * rookieCapOutlook below) — the recurring bug in this codebase is a displayed
 * number that is not the number the system used, and a warning that prices his
 * class off a second formula is worse than no warning at all, because he will
 * trust it and be blocked at the podium anyway.
 *
 * THE SCALE IS STRETCHED ACROSS SEVEN ROUNDS, NOT ACROSS settings.draftRounds,
 * and that was already true of both copies — it is preserved here rather than
 * "fixed". The denominator is what makes pick 100 cost the same money in a
 * five-round league as in a seven-round one; feeding it the league's own round
 * count would instead re-price the whole board every time that setting moved,
 * so a club's last pick was always dead-last money whatever round it fell in.
 */
const ROOKIE_SCALE_ROUNDS = 7;

/** Overall selection number for a stored pick. The draft's own arithmetic. */
export function overallPickNumber(pick: { round: number; slot: number }): number {
  return (pick.round - 1) * LEAGUE.TEAM_COUNT + pick.slot;
}

/** The deal the man taken at this pick signs, before it is written anywhere. */
export function rookieDealForPick(pick: { round: number; slot: number }, seasonYear: number) {
  return buildContract({
    apy: rookieScaleApy(overallPickNumber(pick), LEAGUE.TEAM_COUNT * ROOKIE_SCALE_ROUNDS),
    years: 4, signedYear: seasonYear, isRookieDeal: true, bonusPct: 0.4,
  });
}

/** What that deal charges THIS season — the figure assertCapRoom is handed. */
export function rookieCapHitForPick(
  pick: { round: number; slot: number }, seasonYear: number, capMode: CapMode,
): number {
  const c = rookieDealForPick(pick, seasonYear);
  return capHit({ ...c, baseSalaries: writeJson(c.baseSalaries) }, capMode);
}

/**
 * ===========================================================================
 * CAN HE AFFORD HIS OWN DRAFT?  [TUNE]
 * ===========================================================================
 * A rookie deal is real cap money and draftPlayer above BLOCKS the user on it:
 * he is on the clock, the short clock is running, and that is when he finds
 * out he cannot pay the man he just picked. An AI club never has that moment —
 * it quietly releases veterans to fit its own pool and the room moves on. So
 * the asymmetry is not "the user is treated worse", it is "the user has to be
 * TOLD FIRST", and the only place that can happen is the war room, before he
 * sends the first card.
 *
 * THE WALK IS THE POINT, NOT THE TOTAL. draftPlayer charges one pick at a
 * time against the room left at that moment, so the honest question is not
 * "does the class fit" but "which card is the one that stops". Seven picks of
 * dead-last money is still ~$7M, and the gate fires on the last of them as
 * readily as the first. Walking the picks in selection order and decrementing
 * reproduces exactly the sequence of checks the draft will run.
 *
 * WHAT THIS DELIBERATELY DOES NOT KNOW. Cap space is read tonight. He may cut,
 * restructure or trade before the podium; an AI club may hand him a deal. That
 * is why every figure here is "as the roster stands" and none of it is a
 * verdict — see the copy on the draft page. It also cannot see the rookies it
 * has not signed yet becoming cuttable themselves, which is the one direction
 * this errs pessimistic in, and the smaller error of the two.
 */

/** One held selection, priced at the slot it will actually be made from. */
export interface RookiePoolPick {
  round: number;
  slot: number;
  overall: number;
  /** This season's cap charge for the man taken here. */
  hit: number;
}

export interface RookieCapOutlook {
  /** The draft these picks belong to. */
  year: number;
  /** Unused picks he holds, in selection order. */
  picks: RookiePoolPick[];
  /** All of them added up: the whole class on this season's books. */
  pool: number;
  /** Room under the ceiling as the roster stands right now. */
  capSpace: number;
  /** What is left once the class is signed. Negative means it does not fit. */
  cushion: number;
  /**
   * The first pick the books cannot cover, walking them in order — the exact
   * selection draftPlayer would throw on. Null when every card is payable.
   */
  stopsAt: RookiePoolPick | null;
  /** Dollars short at that pick. 0 when nothing stops. */
  shortfall: number;
  /**
   * Whether cuts alone could still cover that shortfall. draftPlayer only
   * blocks while this is true: a club with no way out at all is let through
   * rather than deadlocked on the clock, so a warning that promised a block
   * here would be describing a rule the code does not follow.
   */
  clearable: boolean;
  /** Cuts and restructures that would cover it, best first. */
  relief: ReliefOption[];
}

/**
 * [TUNE] How thin a club has to be left before the war room says anything.
 *
 * A warning that fires every year is furniture and a GM stops reading
 * furniture, so the loud case is not "mind the cap" — it is the walk above
 * finding a card he cannot pay for, which is a fact and needs no threshold at
 * all. This constant only governs the quiet case: the class fits, and leaves
 * him this thin. One league-minimum contract, because below that he cannot add
 * a single body after the draft — an undrafted free agent, a week-two
 * replacement — without cutting somebody, and the last deal on the rookie
 * scale is itself about a minimum salary, so a club inside this band is one
 * slot-price step from being stopped at the podium.
 *
 * MEASURED across every save in the dev database (scripts/_draftcap.ts): of
 * the 42 user clubs sitting in or approaching a draft with picks to spend and
 * the cap switched on, ONE trips this warning — a club $23.9M over the ceiling
 * on $56.0M of dead money, stopped at its own first pick. The next tightest
 * club in the league finishes its draft with $26.9M still standing. So every
 * cushion between $0 and $26.9M gives the identical answer on real data, and
 * the smallest value with a meaning in the game is the honest choice: a bigger
 * one buys nothing today and is an arbitrary number waiting to start firing on
 * clubs that are fine.
 */
const ROOKIE_POOL_WARN_CUSHION = CAP.MIN_SALARY;

/**
 * Prices the picks a club actually holds in the imminent draft against the
 * room it actually has. Null when there is nothing to price — no picks, or a
 * league with the cap switched off, where none of this is a constraint.
 */
export async function rookieCapOutlook(opts: {
  leagueId: string; teamId: string; seasonYear: number; capMode: CapMode;
}): Promise<RookieCapOutlook | null> {
  if (opts.capMode === 'OFF') return null;

  // The same rows currentPick() resolves the clock from, filtered to the ones
  // he still has to spend. Reading DraftPick directly rather than taking the
  // page's capital list means the warning is priced off pick ownership as the
  // draft will read it, not off a projection built for a different panel.
  const rows = await prisma.draftPick.findMany({
    where: { leagueId: opts.leagueId, ownerTeamId: opts.teamId, year: opts.seasonYear, used: false },
    select: { round: true, slot: true },
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
  });
  if (rows.length === 0) return null;

  const picks: RookiePoolPick[] = rows.map((r) => ({
    round: r.round,
    slot: r.slot,
    overall: overallPickNumber(r),
    hit: rookieCapHitForPick(r, opts.seasonYear, opts.capMode),
  }));
  const pool = picks.reduce((sum, p) => sum + p.hit, 0);

  const { teamCapSummary } = await import('./cap-summary');
  const summary = await teamCapSummary(opts.teamId, opts.seasonYear, opts.capMode);
  const capSpace = summary.capSpace;
  const cushion = capSpace - pool;

  // One pick at a time against the room left at that moment — draftPlayer's
  // own check, run forward.
  let room = capSpace;
  let stopsAt: RookiePoolPick | null = null;
  let shortfall = 0;
  for (const p of picks) {
    if (p.hit > room) { stopsAt = p; shortfall = p.hit - room; break; }
    room -= p.hit;
  }

  // Nothing to say is said by returning nothing: there is no "warn: false"
  // outlook for a caller to render by accident.
  if (stopsAt === null && cushion >= ROOKIE_POOL_WARN_CUSHION) return null;

  // Only scanned once the warning is going to be shown — a compliant club with
  // room to spare has nothing to suggest and this is a whole-roster read.
  const { capComplianceReport } = await import('./capEnforcement');
  const report = await capComplianceReport(opts.teamId, opts.seasonYear, opts.capMode, { alwaysRelief: true });

  return {
    year: opts.seasonYear,
    picks,
    pool,
    capSpace,
    cushion,
    stopsAt,
    shortfall,
    clearable: report.maxCutRelief >= shortfall,
    relief: report.relief,
  };
}

/**
 * ===========================================================================
 * WHAT A FANTASY PICK IS PAID  [TUNE]
 * ===========================================================================
 * A fantasy draft REDISTRIBUTES THE LEAGUE'S VETERANS. Every man in that pool
 * is a finished football player with an age and a market — a 29-year-old 91
 * is not a prospect and the rookie scale has nothing to say about him — so he
 * signs the deal a veteran signs: `marketValue` for the money, the
 * `suggestedYears` ladder for the term. Those are the same two functions
 * lib/gen/league.ts prices a randomized league's 1,700 contracts with, which
 * is deliberate. Two ways of pricing a roster is how the cap page and the
 * trade block end up disagreeing about what a player costs.
 *
 * THIS BRANCH USED TO WRITE NO CONTRACT AT ALL — a DRAFT transaction and
 * nothing else. Measured across the whole dev database, the only 32 clubs
 * carrying nobody on a contract were the 32 clubs of one fantasy league, each
 * with 53 players at 0.0% of a $255M cap. The salary cap is half of this game
 * and it was inert for one of the two ways the README says to start a league:
 * no cap space, no cap-constrained trade, no meaningful extension, and a free
 * agency where every club could outbid everyone forever.
 *
 * HOW A WHOLE ROSTER FITS UNDER THE CEILING. lib/gen/league.ts has already
 * solved this for a randomized league: price every man at market, then scale
 * the club's contracts down uniformly until the payroll hits the share of the
 * cap its GM profile is built to spend (`rosterCapTarget`, exported from there
 * so both paths read one band). It can do that in one pass because it knows
 * the whole roster at once. A draft does not — the roster arrives one man at a
 * time — so the same scale is recomputed at every pick from what the club has
 * already committed and what the men it still has picks for are worth:
 *
 *     scale = (target - committed) / (this man + what my remaining picks cost)
 *
 * capped at 1, because like the generator this only ever scales DOWN: a club
 * with room to spare pays market and does not invent a raise to hit a number.
 * The estimate of "what my remaining picks cost" is the board itself — the
 * undrafted pool sorted by market value, sampled every TEAM_COUNT names down,
 * which is the slice a club actually gets in a snake. It is an estimate and it
 * does not have to be a good one: it is re-derived at the club's next pick
 * against what it really spent, so an early over- or under-shoot is corrected
 * by the rest of the draft rather than compounding.
 *
 * NOTHING IS REMEMBERED BETWEEN PICKS. Every input is read from the database
 * at the pick — the club's payroll, its remaining turns in the stored snake,
 * the men still on the board — so a draft resumed tomorrow in a fresh process,
 * or run half by the user and half by the AI ticker, prices identically to one
 * run start to finish in a single call.
 *
 * MEASURED (scripts/_fantasyE2E.ts), a full 32-club fantasy draft — 1,696
 * picks, every one of them made by the AI — against a freshly generated
 * randomized league, payroll as a share of the cap:
 *
 *                        min    p25    med    p75    max   over cap
 *   randomized (fresh)   41%    63%    79%    83%    92%      0/32
 *   fantasy draft        69%    77%    82%    87%    93%      0/32
 *
 * and it keeps the shape of a draft, because the curve it scales is the
 * board's own: across three drafts the median year-one cap hit runs about
 * $12M in round one, $5-6M in round eight, $2M in round forty and within a
 * rounding step of the league minimum in the last rounds — an early pick costs
 * a club roughly ten times what a late one does. Three seasons on, with the AI
 * re-signing and shopping at full market the whole way, the same league sits
 * at a 90% median with nobody over the ceiling and a clean invariant sheet.
 *
 * WHY EVERY DEAL IN A FANTASY LEAGUE LANDS AT ABOUT HALF OF MARKET, and why
 * that is a fact about the POOL rather than about this function. The pool a
 * fantasy draft hands out is far richer than the league it fills: 1,956 men at
 * a median 77 OVR, where the same generator's 32 randomized rosters run a
 * median 73 with a real camp-body tail. Priced at market the 1,696 men who get
 * drafted are worth 167% of a 32-club salary cap; the 1,516 on randomized
 * rosters are worth 99% of it. So the uniform scale above sits near 0.5 for
 * every club, and a fantasy league's best quarterback signs for $23.8M where a
 * randomized league's signs for $37.8M. That compression is the pool being a
 * league and a half of talent, and the place to fix it is lib/gen/league.ts's
 * fantasy branch — give the pool the roster shape `generateRoster` produces
 * instead of 1,956 undifferentiated starters — NOT a second, cleverer pricing
 * curve here. Bending this one to flatter the top of the board would put the
 * two roster-pricing paths permanently out of step for a problem neither of
 * them causes.
 * ===========================================================================
 */
async function priceFantasyPick(opts: {
  leagueId: string;
  teamId: string;
  playerId: string;
  seasonYear: number;
  state: { pickIndex: number; order: string };
}) {
  const player = await prisma.player.findUniqueOrThrow({
    where: { id: opts.playerId },
    select: { trueOvr: true, position: true, age: true, potential: true },
  });
  const nominal = marketValue({
    ovr: player.trueOvr, position: player.position as Position, age: player.age, potential: player.potential,
  });
  // Age gates first, so a 33-year-old signs two years and a 35-year-old signs
  // one however good he is — the same ladder every other veteran deal in the
  // game is written on.
  const years = suggestedYears(player.trueOvr, player.age);
  // A fresh signing, not a contract dropped into a random mid-deal year, so
  // this takes buildContract's defaults: an escalating base and a real signing
  // bonus, exactly like a free-agent deal signed the same week.
  const build = (apy: number) => buildContract({ apy, years, signedYear: opts.seasonYear });

  const { parseSettings } = await import('./settings');
  const league = await prisma.league.findUniqueOrThrow({ where: { id: opts.leagueId } });
  const capMode = parseSettings(league.settings).capMode;
  // With the cap off there is no budget to fit and nothing to scale against:
  // everyone signs for what he is worth, which is what "no salary cap" means.
  if (capMode === 'OFF') return { contract: build(nominal), apy: nominal };

  const { teamCapSummary } = await import('./cap-summary');
  const summary = await teamCapSummary(opts.teamId, opts.seasonYear, capMode);
  const team = await prisma.team.findUniqueOrThrow({ where: { id: opts.teamId }, select: { gmProfile: true } });
  const target = summary.capTotal * rosterCapTarget(parseGmProfile(team.gmProfile).winNow);

  // How many turns this club has LEFT in the snake, counted off the stored
  // order rather than off its roster size, so a club that is somehow short a
  // man does not silently budget for picks it will never take.
  const order = readJson<string[]>(opts.state.order, []);
  let picksLeft = 0;
  for (let i = opts.state.pickIndex + 1; i < order.length; i++) {
    if (order[i] === opts.teamId) picksLeft += 1;
  }

  // The budget is kept in CAP HIT, not in APY, because the cap page, the trade
  // gate and free agency all spend cap hits — and a fresh escalating deal
  // charges about 89% of its APY in year one. Budgeting the APY instead would
  // land all thirty-two clubs a tenth of a cap below where they were aimed.
  const atMarket = build(nominal);
  const hitAtMarket = capHit({ ...atMarket, baseSalaries: writeJson(atMarket.baseSalaries) }, capMode);
  const hitPerApy = hitAtMarket / Math.max(1, nominal);

  const remaining = await remainingBoardValue(opts.leagueId, picksLeft);
  const budget = Math.max(0, target - summary.capUsed);
  const scale = Math.min(1, budget / Math.max(1, hitPerApy * (nominal + remaining)));

  let apy = Math.round((nominal * scale) / 100_000) * 100_000;
  /*
   * THE ONE HARD LINE, and it is a different thing from the target above. The
   * target is what a club MEANS to spend and a club is allowed to miss it. The
   * ceiling is the salary cap itself, and a draft nobody can decline must not
   * be able to push a club through it: hold back the league minimum for every
   * man this club still has to pick, and whatever is left is the most this one
   * can be paid. Without it a club whose scale ran hot early would arrive at
   * its last rounds with a roster it could not legally field.
   */
  const ceiling = (summary.capTotal - summary.capUsed - CAP.MIN_SALARY * picksLeft) / Math.max(0.01, hitPerApy);
  apy = Math.max(CAP.MIN_SALARY, Math.min(apy, Math.round(ceiling / 100_000) * 100_000));
  return { contract: build(apy), apy };
}

/**
 * What the picks a club still holds are likely to cost it at market — the
 * undrafted pool priced and sorted, sampled every TEAM_COUNT names down from
 * the top, which is the slice one club takes out of a snake.
 *
 * Read fresh at every pick on purpose. It is the same query the board itself
 * is, it shrinks by one name per pick, and caching it would be a second copy
 * of "who is still available" for the one part of the draft that is allowed to
 * be approximate anyway.
 */
async function remainingBoardValue(leagueId: string, picksLeft: number): Promise<number> {
  if (picksLeft <= 0) return 0;
  const pool = await prisma.player.findMany({
    where: { leagueId, teamId: null, status: 'FREE_AGENT', isDraftee: true },
    select: { trueOvr: true, position: true, age: true, potential: true },
  });
  if (pool.length === 0) return 0;
  const values = pool
    .map((p) => marketValue({ ovr: p.trueOvr, position: p.position as Position, age: p.age, potential: p.potential }))
    .sort((a, b) => b - a);
  let total = 0;
  for (let j = 1; j <= picksLeft; j++) {
    // The man on the clock is still in this pool at index ~0, so the club's
    // NEXT pick is a full round further down the board, and the one after that
    // two rounds down.
    total += values[Math.min(j * LEAGUE.TEAM_COUNT, values.length - 1)];
  }
  return total;
}

async function advancePick(tx: typeof prisma, leagueId: string, state: { pickIndex: number; round: number; order: string }, isFantasy: boolean, rounds: number) {
  const nextIndex = state.pickIndex + 1;

  if (isFantasy) {
    const order = readJson<string[]>(state.order, []);
    const done = nextIndex >= order.length;
    await tx.draftState.update({
      where: { leagueId },
      data: { pickIndex: nextIndex, complete: done },
    });
    return;
  }

  const roundSize = LEAGUE.TEAM_COUNT;
  const nextRound = Math.floor(nextIndex / roundSize) + 1;
  const done = nextRound > rounds;
  await tx.draftState.update({
    where: { leagueId },
    data: { pickIndex: nextIndex, round: Math.min(nextRound, rounds), complete: done },
  });
}

/**
 * Run every consecutive AI pick until it's the user's turn again (or the
 * draft ends). Safe to call repeatedly — it's a no-op once it hits the user.
 */
export async function runAiPicksUntilUser(leagueId: string, userTeamId: string, rng: Rng, seasonYear: number) {
  let picksMade = 0;
  let draftComplete = false;
  for (let i = 0; i < 500; i++) {
    const pickInfo = await currentPick(leagueId);
    if (!pickInfo) { draftComplete = true; break; }
    if (pickInfo.teamId === userTeamId) break;

    const player = await pickBestAvailable(leagueId, pickInfo.teamId, rng, pickInfo.state.kind);
    if (!player) { draftComplete = true; break; }
    await draftPlayer({ leagueId, playerId: player.id, teamId: pickInfo.teamId, seasonYear });
    picksMade += 1;
  }

  /**
   * THE MOMENT A CLUB RESHAPES ITS LINE. The board is empty, every roster has
   * just taken on a class, and this is the point in the year a real front
   * office looks at three tackles and one guard and slides somebody inside —
   * so it is where the AI's position-conversion sweep runs (lib/ai/gm.ts
   * `planPositionConversions`, applied by lib/ai/positionChange.ts).
   *
   * The user's club is deliberately exempt. His roster is his to shape, and a
   * CPU moving his left tackle inside overnight would be the most infuriating
   * thing this game could do; the same sweep is available to him one player at
   * a time on the player card, which is where the decision belongs.
   *
   * Safe to reach more than once — each accepted move strictly increases the
   * club's starting-lineup sum, so a second sweep over an already-optimised
   * roster finds nothing and writes nothing.
   *
   * THIS IS NOT THE ONLY MOMENT IT SHOULD RUN. Free agency and the cut-down
   * churn rosters too, and the natural home for a league-wide sweep is the
   * offseason step in lib/season.ts beside `autoDepthChartAll`. That file is
   * held elsewhere tonight; the draft is the one churn point this module owns.
   */
  if (draftComplete) {
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { week: true } });
    await runAiPositionConversions(leagueId, { seasonYear, week: league?.week ?? 0, skipTeamId: userTeamId });
  }

  return picksMade;
}

/**
 * Make exactly ONE AI pick (a no-op if the user is already on the clock),
 * for a live, paced draft-day feed — one visible pick at a time instead of
 * a single opaque batch — rather than fast-forwarding an entire batch of
 * turns silently. Returns null when there's nothing to do right now.
 */
export async function draftOneAiPick(leagueId: string, userTeamId: string, rng: Rng, seasonYear: number) {
  const pickInfo = await currentPick(leagueId);
  if (!pickInfo || pickInfo.teamId === userTeamId) return null;

  const player = await pickBestAvailable(leagueId, pickInfo.teamId, rng, pickInfo.state.kind);
  if (!player) return null;

  const team = await prisma.team.findUniqueOrThrow({ where: { id: pickInfo.teamId } });
  await draftPlayer({ leagueId, playerId: player.id, teamId: pickInfo.teamId, seasonYear });
  return {
    teamName: `${team.city} ${team.nickname}`,
    playerName: `${player.firstName} ${player.lastName}`,
    position: player.position,
    round: pickInfo.pick?.round ?? pickInfo.state.round,
  };
}

/**
 * ===========================================================================
 * AI CLUBS DRAFT OFF A READ, NOT THE TRUTH  [TUNE]
 * ===========================================================================
 * This used to pull the top 60 prospects `orderBy: { trueOvr: 'desc' }` and
 * value them with playerValue(), which reads `trueOvr`/`potential` straight
 * off the row it is handed. Thirty-one omniscient front offices, and this
 * file's own header said so out loud: "the league office doesn't have fog of
 * war".
 *
 * That was survivable while the public board was near-perfect. It stopped
 * being survivable the day lib/consensus.ts turned the board into a fallible
 * READ on purpose — three regimes at SD 7/21/28, the room missing by 25+
 * points on ~6% of a class, board-to-truth correlation deliberately cut from
 * -0.865 to -0.700. Two individually sound changes, jointly incoherent: the
 * user was shown a board that predicted nothing about the order players
 * actually came off it. From the owner's own draft, round one: board #242 at
 * pick 3, #195 at 7, #85 at 10, #70 at 12 — and board #1 lasting until pick 9.
 * A consensus board that predicts nothing is not a board.
 *
 * So a club now drafts the way it scouts. Three parts, and the first is most
 * of the fix:
 *
 *   THE WINDOW   the candidate set is the top DRAFT_BOARD_WINDOW names still
 *                on the PUBLIC BOARD. A perfectly fogged valuation applied to
 *                a truth-sorted shortlist still drafts the truth, because the
 *                shortlist already did the cheating.
 *   THE READ     each club carries its own file on each prospect — the public
 *                grade plus a private lean, seeded per (club, player) so a
 *                club that likes a man likes him at every pick of the draft
 *                instead of re-rolling an opinion per evaluation. Same
 *                discipline the trade AI adopted after `Date.now()` in a seed
 *                let users re-roll verdicts by resubmitting.
 *   THE VALUE    playerValue() is untouched and still reads `trueOvr` /
 *                `potential` off the object it is given — so it is given a
 *                SHADOW carrying the club's read in those two fields. Team
 *                needs, the GM profile, DRAFT_POSITION_VALUE and the reach
 *                all keep working, on top of the read instead of the truth.
 *
 * MEASURED (scripts/_dr_replay.ts): the same 100 generated classes, 224 picks
 * each, drafted by the same 32 clubs off the same rosters, GM profiles and
 * pick order — once by the old engine (copied verbatim into the harness) and
 * once by clubDraftPick() below, which is the code that actually ships —
 *
 *                                            before        after
 *   Spearman(board rank, pick order)          0.595         0.924
 *   round one, median board rank taken           34            19
 *   round one, worst board rank taken     254 (max 398)  67 (max 91)
 *   consensus #1 goes at pick, median            12             3
 *   |board rank - pick|  median/p90/max   46/140/391     18/48/100
 *   ... round one only                    20/98/391        8/27/63
 *   picks spent on board #150+, per draft   91.7          77.2
 *   ... earliest such pick                  pick 1        pick 90
 *   the actual 1.01's mean board rank          29.7           9.3
 *   the actual 1.01: hit(85+) / bust(<78)  100% / 0%    59% / 15%
 *
 * The last line is the whole point of the change: a 1.01 could not miss while
 * the club picking it could see the answer, so lib/consensus.ts's busts were
 * a story the user could read on the board and never actually live through.
 *
 * IT IS NOT A SCRIPT EITHER, which is the failure mode on the other side. Half
 * of round one still moves 8+ places from where the board put it, one pick in
 * ten moves 27+, and 7.6 names a draft slide 50 places or more. What stopped
 * is board #242 going third overall.
 *
 * WHAT IT COST THE USER'S EDGE. A board-order drafter against a
 * perfect-information drafter at slot 16, career peak: +14.6 before, +10.3
 * after (72.1 -> 86.7 becomes 80.0 -> 90.3). The edge narrows because rivals
 * stopped cheating, not because scouting stopped paying: the man who follows
 * the board went from 72.1 to 80.0, and perfect information is still worth
 * ten points of peak and 6.3 Star-or-better players a draft against 2.6.
 * ===========================================================================
 */

/**
 * [TUNE] How deep into the public board a club will look at any one pick.
 *
 * This is the single number that decides how unrealistic the draft can get,
 * because it is a hard ceiling on a reach: nobody can be taken more than this
 * many names below the best man left on the board. Two rounds' worth of the
 * board is what a front office actually has "in play" at a pick — the men it
 * expects to be gone by the time it is up again.
 *
 * SWEPT, 40 classes each, reading round-one |board rank - pick| as
 * median/p90/max, the deepest board rank round one took, and how many names a
 * draft slid 50+ places:
 *
 *      24    8/20/26   deepest R1 #55    2.9 slides   the board as a script
 *      32    9/24/31   deepest R1 #62    4.2 slides
 *      64    9/30/63   deepest R1 #91    7.4 slides   <- shipped
 *      96    9/31/91   deepest R1 #118   8.2 slides
 *     128    9/31/91   deepest R1 #118   8.4 slides   saturated
 *
 * It saturates above ~96 because the valuation stops reaching that far on its
 * own, so the choice is really between "tight" and "loose" rather than a
 * runaway. 64 keeps round one honest (10-30 place reaches routine, worst case
 * around #90) while leaving a genuine sleeper reachable: the deepest name
 * taken runs #91 in round one out to #285 in round seven, so the fifth-round
 * steal lib/consensus.ts exists to create can still actually be taken.
 *
 * WHERE THIS SHOULD LIVE: lib/tuning.ts's AI block, beside DRAFT_REACH_CHANCE
 * and DRAFT_POSITION_VALUE. It is defined here because that file is held by
 * another workstream tonight; the move is a cut-and-paste and an `AI.` prefix.
 */
const DRAFT_BOARD_WINDOW = 64;

/**
 * [TUNE] How far a club's own file sits from the public grade, in grade
 * points, one draw per (club, prospect).
 *
 * THE LEVER THAT SETS HOW LOOSELY THE DRAFT TRACKS THE BOARD, and the one to
 * reach for before the window. scripts/_bust_rivals.ts prototyped this exact
 * mechanic at +/-4; swept here over 40 classes (Spearman(board rank, pick
 * order); round-one |rank-pick| median/p90; where the consensus #1 goes,
 * median; names sliding 50+ places per draft):
 *
 *      2    0.940    7/22    pick 2    3.9
 *      4    0.923    9/30    pick 3    7.4   <- shipped
 *      7    0.884   12/43    pick 4   15.4
 *     10    0.842   17/53    pick 6   21.9
 *
 * By 7 the consensus #1 is a top-five pick only 60% of the time and fifteen
 * names a draft slide half a round or more, which is a board nobody would
 * publish. 4 is also deliberately far smaller than the room's OWN error
 * (CONSENSUS_EVAL.EVAL_SD 7, before the misfile and blindspot multipliers):
 * clubs mostly agree with the consensus, which is why it IS the consensus, and
 * the prospect who is genuinely misread is misread by everybody — that error
 * already lives in the grade this leans off.
 */
const DRAFT_READ_LEAN_SD = 4;

/**
 * [TUNE] Spread on a club's own view of how much room a prospect has left, in
 * points, on top of the standard twenty-two-year-old allowance
 * (CONSENSUS_EVAL.CEILING_ANCHOR). It exists because the read has to be a
 * coherent pair of numbers for playerValue to grade — a club that is high on a
 * man is high on his present or on his future, and those are different clubs.
 *
 * IT IS A WEAK LEVER AND THAT IS NOT A BUG TO TUNE AROUND, exactly as
 * lib/consensus.ts says of its own two ceiling knobs. Swept 0 -> 3 -> 8 over
 * 40 classes it moves Spearman(board rank, pick order) by 0.001 and not one
 * distribution number outside noise, because it only reaches playerValue's
 * upside term, which a contender weights at AI.CONTENDER_POTENTIAL_WEIGHT
 * 0.18. If someone wants clubs to disagree MORE, the knob is
 * DRAFT_READ_LEAN_SD above, not this.
 */
const DRAFT_READ_GAP_SD = 3;

/** What a club knows about a prospect before it picks: the public board, and nothing else. */
export interface BoardCandidate {
  id: string;
  position: string;
  age: number;
  /** The public football grade, unrounded — consensus boardScore minus its positional pull. */
  publicGrade: number;
  /** What the public board SORTS by (grade plus positional value). Higher = earlier. */
  boardScore: number;
}

/** One club's private file on one prospect, on the same scale trueOvr/potential use. */
export interface ClubRead {
  /** What this club thinks he is today. */
  now: number;
  /** What this club thinks he becomes. */
  ceiling: number;
}

/**
 * A club's own file on a prospect, built from the public grade and NEVER from
 * the truth.
 *
 * The pair has to be coherent, because playerValue() reads it as a rating AND
 * a ceiling and weights them differently. Blended back on the board's own
 * weights it returns exactly this club's opinion of him — CURRENT_WEIGHT * now
 * + POTENTIAL_WEIGHT * ceiling === publicGrade + lean — so where a club ranks
 * a prospect is what it thinks of him, not an artefact of how his grade got
 * split into a present and a future.
 *
 * DETERMINISM. Seeded off (team, player), so the opinion is fixed for the life
 * of the save: a club that likes a prospect likes him identically at pick 3
 * and pick 103, in every process. Two named streams rather than one shared
 * one, the same discipline lib/consensus.ts uses, so adding a third draw later
 * cannot reshuffle the two that already exist in players' saves.
 */
export function clubReadOf(teamId: string, prospect: { id: string; publicGrade: number }): ClubRead {
  const opinion = prospect.publicGrade + new Rng(`draft-read-${teamId}-${prospect.id}`).normal(0, DRAFT_READ_LEAN_SD);
  const gap = Math.max(0, CONSENSUS_EVAL.CEILING_ANCHOR + new Rng(`draft-gap-${teamId}-${prospect.id}`).normal(0, DRAFT_READ_GAP_SD));
  const now = clamp(opinion - CONSENSUS.POTENTIAL_WEIGHT * gap, 20, 99);
  return { now, ceiling: clamp(now + gap, now, 99) };
}

/**
 * Who this club takes, given what is left on the public board. Pure — no
 * database, no truth — so the draft it produces can be measured over hundreds
 * of classes offline (scripts/_dr_replay.ts) against exactly the code that
 * ships.
 */
export function clubDraftPick<T extends BoardCandidate>(
  available: T[],
  opts: { teamId: string; profile: GmProfile; needs: Record<string, number>; rng: Rng },
): { prospect: T; read: ClubRead; reached: boolean } | null {
  if (available.length === 0) return null;
  const { teamId, profile, needs, rng } = opts;

  // The window is drawn on the PUBLIC board, before this club has an opinion —
  // a club looks down the board it shares with everyone else and decides among
  // the names still on it.
  const window = [...available].sort((a, b) => b.boardScore - a.boardScore).slice(0, DRAFT_BOARD_WINDOW);

  const board = window
    .map((p) => {
      const read = clubReadOf(teamId, p);
      // The shadow is the whole trick: playerValue() reads `trueOvr` and
      // `potential` off whatever it is handed, so hand it the club's read in
      // those fields and every term below it — age curve, tier curve, need,
      // upside — grades the opinion instead of the answer. The valuation is
      // not touched.
      const shadow: RosterPlayer = { id: p.id, position: p.position, age: p.age, trueOvr: read.now, potential: read.ceiling };
      const posValue = AI.DRAFT_POSITION_VALUE[p.position as Position] ?? 1;
      // playerValue's own noise term is seeded per (club, prospect) rather
      // than off the shared draft stream for the same reason the lean is: on
      // the shared stream a club's valuation of the same man changed by ~9%
      // every time it came back on the clock, which is not an opinion.
      const valueRng = new Rng(`draft-value-${teamId}-${p.id}`);
      const base = playerValue(shadow, { profile, needs, rng: valueRng }) * (1 - profile.bpaBias * 0.15)
        + read.now * profile.bpaBias * 0.6;
      return { prospect: p, read, value: base * posValue };
    })
    .sort((a, b) => b.value - a.value);

  // Occasionally reach rather than always taking the top of its own list.
  // Now that the list is anchored to the public board this is legible as what
  // it is — a reach AGAINST THE BOARD, the thing a room gets second-guessed
  // for — instead of noise on a ranking nobody could see.
  if (rng.bool(AI.DRAFT_REACH_CHANCE) && board.length > AI.DRAFT_REACH_DEPTH) {
    const idx = rng.int(1, Math.min(AI.DRAFT_REACH_DEPTH, board.length - 1));
    return { prospect: board[idx].prospect, read: board[idx].read, reached: true };
  }
  return { prospect: board[0].prospect, read: board[0].read, reached: false };
}

/**
 * THIS DRAFT'S PUBLIC BOARD, memoised for the length of the draft.
 *
 * It is the same board the user is shown (app/league/[id]/draft/page.tsx):
 * the whole class, everyone still on it PLUS everyone this draft has already
 * taken. It has to be the whole class, because lib/consensus.ts's positional
 * scarcity decays a position's premium down the position GROUP — grade a
 * shrinking pool and every remaining quarterback would silently be re-ranked
 * each time one came off the board, so the AI would be drafting off a
 * different board from the one on screen.
 *
 * MEMOISED because that is a 400-row read with three JSON columns on every
 * pick, ~224 times a draft, and the answer cannot change while a draft is
 * running: the class set is fixed the moment it is generated, and grades are
 * pure functions of the row (seeded off player id). Keyed by league and
 * validated by membership — see classBoard() — so next year's class rebuilds
 * rather than reading a stale board, and nothing has to remember to bust it.
 */
const classBoardCache = new Map<string, Map<string, ConsensusRead>>();

async function classBoard(leagueId: string, needIds: string[]): Promise<Map<string, ConsensusRead>> {
  // Membership IS the validity check, and it is checked before anything is
  // queried: every prospect on the clock has to be on the board we are about
  // to hand out. Next year's class shares no ids with this one, so a stale
  // entry can never satisfy it — while a board that has simply had players
  // drafted out of it still does, which is the case worth being fast.
  const cached = classBoardCache.get(leagueId);
  if (cached && needIds.every((id) => cached.has(id))) return cached;

  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { seasonYear: true } });
  // The class year is the year the class was GENERATED under, which is one
  // below the year it is drafted in (see the same derivation on the draft
  // page). Prospects taken in this draft have already had draftYear bumped to
  // the draft's own year, which is why they need the second clause.
  const classYearRow = await prisma.player.findFirst({
    where: { leagueId, isDraftee: true }, orderBy: { draftYear: 'desc' }, select: { draftYear: true },
  });
  const classYear = classYearRow?.draftYear ?? league.seasonYear;

  const classRows = await prisma.player.findMany({
    where: {
      leagueId,
      OR: [
        { isDraftee: true, draftYear: classYear },
        { draftYear: league.seasonYear, draftRound: { not: null } },
      ],
    },
    select: {
      id: true, position: true, trueOvr: true, potential: true,
      trueAttrs: true, collegeStats: true, combineTesting: true, injuryWeeks: true,
    },
  });
  // No BoardShape passed: shape only picks the band LABELS (blue chip / day
  // two / ...), and nothing on this path reads a band — the ordering, which is
  // all a club uses, is shape-independent.
  const board = consensusBoardMap(classRows);
  // One entry per league; a long-lived server would otherwise accumulate one
  // board per league it has ever run a draft for.
  if (classBoardCache.size > 8) classBoardCache.clear();
  classBoardCache.set(leagueId, board);
  return board;
}

async function pickBestAvailable(leagueId: string, teamId: string, rng: Rng, kind: string) {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  const roster = await prisma.player.findMany({ where: { teamId }, select: { id: true, position: true, trueOvr: true, age: true, potential: true } });
  const profile = parseGmProfile(team.gmProfile, rng);
  const needs = teamNeeds(roster as RosterPlayer[]);

  // THE ROOKIE PATH. Deliberately does not select `trueOvr` or `potential`:
  // there is no way for the truth to reach a pick from here, rather than a
  // convention that it must not be read.
  //
  // GATED ON THE DRAFT KIND, not on "are there any isDraftee players", because
  // the league-start fantasy pool is written isDraftee too (lib/gen/league.ts
  // marks all ~1,950 of them, with a null draftYear, so lib/season.ts's
  // FANTASY_DRAFT case can hand the leftovers to free agency). Those are
  // generated veterans with no college profile and no combine — there is no
  // consensus board for them and no fog to model. Left ungated this path did
  // still fall through to the veteran branch below, but only by accident, by
  // building an empty board from scratch on every one of ~500 fantasy picks.
  const draftees = kind === 'ROOKIE' ? await prisma.player.findMany({
    where: { leagueId, teamId: null, status: 'FREE_AGENT', isDraftee: true },
    select: { id: true, firstName: true, lastName: true, position: true, age: true },
  }) : [];
  if (draftees.length > 0) {
    const board = await classBoard(leagueId, draftees.map((p) => p.id));
    const candidates = draftees.flatMap((p) => {
      const read = board.get(p.id);
      // A draftee who is not on this class's board is a leftover from an
      // older class that never re-entered free agency (INV-07 flags exactly
      // that). He is not in this draft; the veteran fallback below can still
      // reach him, so nobody becomes permanently un-draftable.
      if (!read) return [];
      return [{ ...p, publicGrade: read.boardScore - read.positionPull, boardScore: read.boardScore }];
    });
    const choice = clubDraftPick(candidates, { teamId, profile, needs, rng });
    if (choice) return choice.prospect;
  }

  // THE VETERAN FALLBACK — the league-start fantasy draft, and the safety net
  // for a rookie draft that has somehow run its class dry. Valued on the true
  // rating on purpose: these are established players with years of tape, and
  // the fog this game models is a fog about twenty-two-year-olds, not a
  // general amnesia. There is no consensus board for them to read.
  const veterans = await prisma.player.findMany({
    where: { leagueId, teamId: null, status: 'FREE_AGENT' }, orderBy: { trueOvr: 'desc' }, take: 60,
  });
  if (veterans.length === 0) return null;

  const board = veterans
    .map((p) => {
      const posValue = AI.DRAFT_POSITION_VALUE[p.position as Position] ?? 1;
      const base = playerValue(p as unknown as RosterPlayer, { profile, needs, rng }) * (1 - profile.bpaBias * 0.15) + p.trueOvr * profile.bpaBias * 0.6;
      return { p, value: base * posValue };
    })
    .sort((a, b) => b.value - a.value);

  if (rng.bool(AI.DRAFT_REACH_CHANCE) && board.length > AI.DRAFT_REACH_DEPTH) {
    const idx = rng.int(1, Math.min(AI.DRAFT_REACH_DEPTH, board.length - 1));
    return board[idx].p;
  }
  return board[0].p;
}

/** Worst record first, tie-broken by point differential — the real draft-order rule, used to reseed the order for real and to project it (see projectionFor) from whichever standings exist. */
function standingsOrder<T extends { id: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgnst: number }>(teams: T[]): T[] {
  return [...teams].sort((a, b) => {
    const pctA = a.wins / Math.max(1, a.wins + a.losses + a.ties);
    const pctB = b.wins / Math.max(1, b.wins + b.losses + b.ties);
    if (pctA !== pctB) return pctA - pctB;
    return a.pointsFor - a.pointsAgnst - (b.pointsFor - b.pointsAgnst);
  });
}

/**
 * The 1-based draft slot a club would hold if the season ended on the rows
 * handed in — the same worst-first rule reseedDraftOrder runs for real.
 *
 * Exported as a PURE function, deliberately. The caller that needs it (the
 * week report's "what it changed" band) is already holding the standings from
 * BOTH sides of the week it is describing and wants the delta between them.
 * draftOrderProjection can only answer for "now", and a second database read
 * cannot recover a snapshot the caller has in hand.
 */
export function draftSlotAmong<T extends { id: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgnst: number }>(
  teamId: string,
  teams: T[],
): number {
  return standingsOrder(teams).findIndex((t) => t.id === teamId) + 1;
}

/**
 * Reseed every round's pick slots from the finished season's standings, worst
 * first.
 *
 * THE STANDINGS THIS READS ARE NOT ON THE TEAM ROW, and reading them there was
 * a real bug that made the draft order arbitrary. `Team.wins/losses/pointsFor/
 * pointsAgnst` are ZEROED by the offseason's RESET_STANDINGS step, which runs
 * several advances BEFORE this does (this is called at the end of free agency,
 * on the way to the draft). So by the time the order was seeded every club was
 * 0-0-0 with a zero differential, every comparison in `standingsOrder`
 * returned 0, and Array.sort left the clubs in whatever order the database
 * handed back — effectively creation order.
 *
 * Measured on five saves before the fix: pick #1 went to the worst club in
 * NONE of them. Clubs that finished 1-16 did not pick first; the app owner,
 * who had just been handed the top selection, put it plainly — *"im not sure
 * how i got #1 overall"*. He got it because his row came back first.
 *
 * TeamSeasonRecord is the season's permanent record and is written before the
 * wipe, so it still says what actually happened. That is what decides the
 * order. The draft for year N follows the season played in year N-1 — the
 * seasonYear bump also lives in RESET_STANDINGS, which is why the draft's own
 * year is one ahead of the standings that set it.
 *
 * The fallback matters: a league's very first draft can precede any completed
 * season, and a fantasy-start league may have no record at all. With nothing
 * on file the live team rows are all this can use, and it says so rather than
 * silently producing a fabricated order.
 */
export async function reseedDraftOrder(leagueId: string, seasonYear: number) {
  const teams = await prisma.team.findMany({ where: { leagueId } });
  const records = await prisma.teamSeasonRecord.findMany({
    where: { leagueId, year: seasonYear - 1 },
    select: { teamId: true, wins: true, losses: true, ties: true, pointsFor: true, pointsAgnst: true },
  });
  const byTeam = new Map(records.map((r) => [r.teamId, r]));
  // Every club must be present or the sort compares a real record against a
  // wiped row, which is the bug wearing a smaller hat.
  const haveEveryRecord = teams.length > 0 && teams.every((t) => byTeam.has(t.id));
  const order = haveEveryRecord
    ? standingsOrder(teams.map((t) => ({ ...t, ...byTeam.get(t.id)! })))
    : standingsOrder(teams);
  const picks = await prisma.draftPick.findMany({ where: { leagueId, year: seasonYear } });
  for (const pick of picks) {
    const slot = order.findIndex((t) => t.id === pick.originalTeamId) + 1;
    if (slot > 0) await prisma.draftPick.update({ where: { id: pick.id }, data: { slot } });
  }
}

/**
 * WHERE EACH CLUB WOULD PICK, AND WHAT THAT NUMBER IS ACTUALLY MADE OF.
 *
 * `order` maps a club id to its place in round one (1 = first overall), which
 * is also its place in every other round — the same worst-first rule
 * reseedDraftOrder applies for real. `season` names the season the ranking
 * came from and `live` says whether that season is still being played, and
 * both exist because a screen that prints the number has to be able to say
 * where it came from without guessing.
 */
export interface DraftOrderProjection {
  order: Map<string, number>;
  /** The season whose results this ranking is. */
  season: number;
  /** True while that season is still under way — "if the season ended today". */
  live: boolean;
}

/**
 * The projection, from whichever standings actually exist right now.
 *
 * THE LIVE TEAM ROWS ARE ONLY HALF THE CALENDAR. `Team.wins/losses/pointsFor/
 * pointsAgnst` are the season in progress, and RESET_STANDINGS zeroes all four
 * partway through the offseason (see lib/season.ts) — every club sits at
 * 0-0-0 from there until week 1 kicks off again. Ranking 32 identical records
 * returns 0 from every comparison in `standingsOrder` and leaves Array.sort
 * holding database row order, which is exactly the bug commit c6cad32 found in
 * the real draft order and the same one that put "#1" on every chip of the
 * trade screen months later.
 *
 * So once the rows are wiped this reads TeamSeasonRecord for the season that
 * was actually played — the identical source, for the identical year, that
 * reseedDraftOrder itself uses. That is worth stating plainly: between the
 * final whistle and the reseed at the end of free agency, this is not a guess
 * at all. It is the same computation over the same frozen rows, so the number
 * a GM reads in the re-sign window is the number the draft will run on.
 *
 * Null means there is genuinely nothing to say: a brand-new league before its
 * first kickoff, or a save whose season records are incomplete. Every club
 * must be present or the sort compares a real record against a missing one,
 * which is the bug wearing a smaller hat (reseedDraftOrder takes the same
 * precaution for the same reason).
 */
async function projectionFor(leagueId: string, seasonYear: number): Promise<DraftOrderProjection | null> {
  const teams = await prisma.team.findMany({ where: { leagueId } });
  if (teams.length === 0) return null;
  const rank = (sorted: { id: string }[]) => new Map(sorted.map((t, i) => [t.id, i + 1]));

  if (teams.some((t) => t.wins + t.losses + t.ties > 0)) {
    return { order: rank(standingsOrder(teams)), season: seasonYear, live: true };
  }

  // Rows wiped: the season that was played is the one before the league year
  // that just opened, because the seasonYear bump lives in RESET_STANDINGS
  // alongside the wipe.
  const played = seasonYear - 1;
  const records = await prisma.teamSeasonRecord.findMany({
    where: { leagueId, year: played },
    select: { teamId: true, wins: true, losses: true, ties: true, pointsFor: true, pointsAgnst: true },
  });
  const byTeam = new Map(records.map((r) => [r.teamId, r]));
  if (!teams.every((t) => byTeam.has(t.id))) return null;
  return { order: rank(standingsOrder(teams.map((t) => ({ ...t, ...byTeam.get(t.id)! })))), season: played, live: false };
}

/** The projection on its own, for a caller that already knows which league it is asking about. */
export async function draftOrderProjection(leagueId: string): Promise<DraftOrderProjection | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { seasonYear: true } });
  if (!league) return null;
  return projectionFor(leagueId, league.seasonYear);
}

/**
 * The projected order as a bare map, for callers that only need the ranking
 * and already know which season they are asking about — the end-of-season
 * report, which writes "you pick 7th" on the night the last game is played.
 * Anything that has to LABEL the number wants draftOrderProjection, which also
 * says which season it came from and whether that season is still running.
 */
export async function projectedDraftOrder(leagueId: string): Promise<Map<string, number>> {
  return (await draftOrderProjection(leagueId))?.order ?? new Map();
}

/**
 * The next draft that hasn't happened yet — the smallest DraftPick.year
 * with any unused pick. Deliberately NOT "league.seasonYear" or
 * "seasonYear + 1": which one actually matches depends on where in the
 * phase machine the league currently sits (DraftPick.year for the upcoming
 * draft is pre-generated as seasonYear + 1 and stays that way all the way
 * through the season, but RESET_STANDINGS bumps seasonYear to match it
 * partway through the offseason, before that draft actually runs) — so
 * comparing against seasonYear directly is only right some of the time.
 * "Smallest unused year" is well-defined everywhere in between.
 */
export async function imminentDraftYear(leagueId: string): Promise<number | null> {
  const next = await prisma.draftPick.findFirst({ where: { leagueId, used: false }, orderBy: { year: 'asc' }, select: { year: true } });
  return next?.year ?? null;
}

/**
 * THE ONE DRAFT YEAR WHOSE `DraftPick.slot` IS A REAL SELECTION NUMBER.
 *
 * Every pick row is created with a placeholder slot (the club's index in the
 * generation loop) and keeps it until reseedDraftOrder rewrites the whole year
 * from the finished season's records. That reseed runs in exactly one place:
 * the advance out of the last week of free agency, immediately before
 * startRookieDraft flips the league into the DRAFT phase (lib/season.ts). Two
 * statements, one line apart, with nothing between them a page can render.
 *
 * So `phase === 'DRAFT'` is the test, and `league.seasonYear` is the year it
 * applies to. Walking the phase machine:
 *
 *   PRESEASON..PLAYOFFS   The upcoming draft is seasonYear + 1 and its slots
 *                         are placeholders. Not DRAFT: null. Correct.
 *   OFFSEASON, RESIGN,    RESET_STANDINGS has bumped seasonYear so the
 *   FREE_AGENCY           upcoming draft now WEARS this year's number, but the
 *                         reseed has still not run. Not DRAFT: null. This is
 *                         the case a "year === seasonYear" test alone gets
 *                         wrong, and the reason the answer is the phase.
 *   DRAFT                 reseedDraftOrder(leagueId, seasonYear) has just run
 *                         over every round of that year. Real, and it stays
 *                         real for the whole draft — a pick does not stop
 *                         being #32 because the clock reached #31.
 *   PRESEASON after it    The draft is over; the imminent draft is next year's
 *                         placeholders again. Not DRAFT: null. Correct.
 *   FANTASY_DRAFT         A blank-roster draft of veterans with no DraftPick
 *                         rows at all. Not DRAFT: null. Correct.
 *
 * Deliberately NOT keyed off DraftState: that row lingers, complete, from last
 * year's draft for most of the following season (see the draft page), so its
 * existence says nothing about whether any slot is real.
 */
export function seededDraftYear(league: { phase: string; seasonYear: number }): number | null {
  return league.phase === 'DRAFT' ? league.seasonYear : null;
}

/** Everything a screen needs to put an honest number on a pick, read once. */
export interface DraftOrderContext {
  /** The next draft that will actually run. */
  imminentYear: number | null;
  /** The draft year whose stored slots are the real running order, or null. */
  seededYear: number | null;
  /** Where each club would pick, and what that is made of. Null when nothing has been played. */
  projection: DraftOrderProjection | null;
  /** Picks per round — the "of 32" in a slot, and the multiplier behind an overall number. */
  roundSize: number;
}

export async function draftOrderContext(leagueId: string): Promise<DraftOrderContext> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { seasonYear: true, phase: true } });
  const [imminentYear, projection] = await Promise.all([
    imminentDraftYear(leagueId),
    league ? projectionFor(leagueId, league.seasonYear) : Promise.resolve(null),
  ]);
  return {
    imminentYear,
    seededYear: league ? seededDraftYear(league) : null,
    projection,
    roundSize: LEAGUE.TEAM_COUNT,
  };
}

/**
 * The numbers one pick is allowed to wear, and the single place that decision
 * is made.
 *
 * A SELECTION NUMBER IS EITHER REAL OR PROJECTED, NEVER BOTH, AND NEVER THE
 * CLUB'S RANK STAMPED ON EVERY ROUND. The trade screen used to hand every pick
 * a club owned the club's own standings rank — so a rebuild's R1, R4, R5 and
 * R7 all printed "#1", and during a live draft (records wiped, sort degenerate)
 * "#1" meant nothing but "first row back from the database". The app owner,
 * holding the 32nd selection of the draft: *"it is pick 32 but counting as #1
 * overall because its the current pick. these should be locked to their value"*.
 *
 * Once the order is seeded the pick's OWN slot is what the draft runs on —
 * currentPick() resolves the club on the clock by (round, slot) — so that is
 * what gets shown, per round, and no projection is offered beside it. Before
 * the reseed there is no real number to show and the projection is the honest
 * read; it is applied per pick off the ORIGINAL club, whose record is what
 * decides where that pick lands. A year further out gets neither, because
 * there are no standings behind it to project from.
 *
 * `overall` is derived here, from the same slot the chip shows, so a chip
 * reading "#32" can never sit over a tooltip reading "#1 overall".
 */
export interface PickNumbers {
  /** Real in-round selection number. Only when that draft's order is seeded. */
  slot?: number;
  /** Real overall selection number, from the same slot. */
  overall?: number;
  /** Projected in-round slot. Only for the imminent draft, before it is seeded. */
  projectedSlot?: number;
  /** Projected overall, from the same projected slot. */
  projectedOverall?: number;
  /** Where the projection came from, for anything that has to say so in words. */
  projectedFrom?: { season: number; live: boolean };
  roundSize: number;
}

export function pickNumbers(
  pick: { year: number; round: number; slot: number; originalTeamId: string },
  ctx: DraftOrderContext,
): PickNumbers {
  const overallOf = (slot: number) => (pick.round - 1) * ctx.roundSize + slot;
  if (ctx.seededYear !== null && pick.year === ctx.seededYear) {
    return { slot: pick.slot, overall: overallOf(pick.slot), roundSize: ctx.roundSize };
  }
  if (projectionAppliesTo(pick.year, ctx) && ctx.projection) {
    const slot = ctx.projection.order.get(pick.originalTeamId);
    if (slot !== undefined) {
      return {
        projectedSlot: slot,
        projectedOverall: overallOf(slot),
        projectedFrom: { season: ctx.projection.season, live: ctx.projection.live },
        roundSize: ctx.roundSize,
      };
    }
  }
  return { roundSize: ctx.roundSize };
}

/**
 * Does the projection on hand actually describe this draft?
 *
 * A PROJECTION HAS TO BE OFF THE SEASON THAT WILL ACTUALLY SEED THAT DRAFT.
 * Draft year Y is seeded by the season played in Y - 1 (reseedDraftOrder reads
 * exactly that), so the ranking on hand only describes this draft when its
 * season is Y - 1. It usually is — during the season, for next spring's draft,
 * and off the finished season all through the offseason — but between a draft
 * ending and the next kickoff the imminent draft has jumped a year ahead of the
 * last season on file, and pinning a two-year-old finish to it would be a
 * number with nothing behind it. Those picks print no number at all, and the
 * panel says the order lands after the season that sets it.
 *
 * Exported so the year heading and the chips under it are answering the same
 * question: a year labelled with a projection whose picks all print blank is
 * the same disagreement in a different place.
 */
export function projectionAppliesTo(year: number, ctx: DraftOrderContext): boolean {
  return ctx.projection !== null
    && ctx.imminentYear !== null
    && year === ctx.imminentYear
    && ctx.projection.season === year - 1;
}

/**
 * Is the clock actually running on this draft?
 *
 * THE GATE IS FOR THE ROOKIE DRAFT AND NOTHING ELSE, and this predicate is the
 * only place that decision lives — read it instead of `state.started`.
 *
 * The rookie draft arrives as a side effect of advancing a week: free agency
 * closes, the phase flips to DRAFT, and the board was already burning picks by
 * the time the owner opened the page. That is what the gate is for.
 *
 * A fantasy draft is the opposite case. It exists because the user ticked the
 * box on the league he was creating one screen earlier, it is the only thing
 * that happens in the FANTASY_DRAFT phase, and there is no season around it to
 * be surprised by. Asking him to confirm the thing he just asked for is a door
 * with nothing behind it, so FANTASY is always live.
 */
export function draftIsStarted(state: { kind: string; started: boolean }) {
  return state.kind !== 'ROOKIE' || state.started;
}

export async function startRookieDraft(leagueId: string, seasonYear: number, rng: Rng) {
  // `order` is unused for ROOKIE drafts — currentPick() resolves the team on
  // the clock from live DraftPick ownership every round instead (see there
  // for why a fixed turn-order array doesn't work once picks get traded).
  //
  // `started: false` is what makes this "the board is set" rather than "the
  // draft is under way". This runs from lib/season.ts the moment the last week
  // of free agency is advanced past, which is not a moment the GM chose — the
  // clock does not move until he presses the button on the draft page
  // (beginRookieDraftAction).
  await prisma.draftState.deleteMany({ where: { leagueId } });
  await prisma.draftState.create({
    data: { leagueId, kind: 'ROOKIE', round: 1, pickIndex: 0, order: writeJson([]), complete: false, started: false },
  });
  await prisma.league.update({ where: { id: leagueId }, data: { phase: 'DRAFT' } });
}
