import { prisma } from './db';
import { CapMode } from './types';
import { ContractLike, capHit, formatMoney, proration } from './cap';
import { teamCapSummary } from './cap-summary';
import { capForLeague, type LeagueCapFields } from './leagueYear';

/**
 * ===========================================================================
 * WHAT THE NEXT ADVANCE DOES TO YOUR CAP SPACE, AND WHY
 * ===========================================================================
 * The app owner watched one number move four times across the end of a season
 * and could not explain any of it:
 *
 *     $918K    PLAYOFFS  wk1
 *     $9.07M   OFFSEASON 2028 wk1
 *     $27.0M   OFFSEASON 2029 wk4
 *     $43.3M   FREE_AGENCY 2029 wk1
 *
 * Every one of those figures is correct. Contracts age the instant the final
 * whistle blows, the ceiling grows a rung with the league year, retirements
 * clear a roster, and the men nobody re-signed take their salaries with them.
 * Four real causes, four eight-figure moves, and nothing on any screen naming
 * one of them. His ask, in his words: *"it should say under that cap space
 * number whatever the pending change is on the next Advance and why"*.
 *
 * FORWARD, NOT BACKWARD. A receipt for money that has already moved is a
 * consolation; this is a GM tool. It says what the press he is about to make
 * will cost or free, while he can still act on it.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS MODULE IS WRITTEN UNDER
 * ---------------------------------------------------------------------------
 * A PREDICTED NUMBER THAT DOES NOT ARRIVE IS WORSE THAN NO NUMBER AT ALL. A
 * caption reading "+$20.9M" over an advance that delivers +$18.4M is the
 * lying-metric defect this codebase spends most of its comments removing, with
 * a delay fuse on it: the reader cannot catch it until it is too late to
 * matter. So this predicts ONLY the advances whose cap effects are fully
 * determined by the ledger as it stands, and returns null for the rest.
 *
 * WHAT IS PREDICTED, and it is the two largest jumps in the sequence above:
 *
 *   SEASON_END            the advance that plays the final. `ageContractsForYear`
 *                         steps every contract onto the new league year inside
 *                         that step, `settleClosingYearCapOverage` runs with it,
 *                         and the phase lands on OFFSEASON wk1 — where
 *                         `bookYearFor` reads the ledger a year ahead of
 *                         `League.seasonYear`. Ceiling, salaries and dead money
 *                         all move on one press, and all three are arithmetic.
 *   RESIGN_WINDOW_CLOSES  the advance out of RESIGN. Everyone still at zero
 *                         years remaining walks (`releaseUnresignedExpiringContracts`)
 *                         and any void-year bonus they stranded is booked
 *                         against this same league year.
 *
 * WHAT IS DELIBERATELY NOT PREDICTED, and why each one is left alone:
 *
 *   OFFSEASON   the press runs PROGRESS, and PROGRESS is a RETIREMENT ROLL —
 *               `rng.bool(retirementChance(...))` per man over 32, with the
 *               contract row deleted outright for everyone it takes. The seed
 *               is deterministic, so it is *reproducible*; it is not
 *               *derivable* without re-walking `progressAllPlayers`'s exact
 *               draw order, which would be a second copy of a loop that is
 *               free to change. This is the biggest single jump in the app
 *               owner's sequence ($9.07M -> $27.0M) and it is the one we are
 *               not allowed to quote. The `{capYear} books` caption beside
 *               this line is what that window gets instead.
 *   FREE_AGENCY `runAiFreeAgencyWave` and `fillTeamsToRosterMinimum` both
 *               filter `isUser: false` (lib/freeagency.ts), so the user's own
 *               books do not move at all — the change is zero and nothing is
 *               drawn.
 *   DRAFT       rookie deals land on the user's club, and who he takes has not
 *               happened yet.
 *   PRESEASON / REGULAR / PLAYOFFS before the final
 *               nothing on the user's cap sheet moves.
 *
 * ---------------------------------------------------------------------------
 * SERVER-SIDE ONLY, deliberately — it reads the database. Same split, and the
 * same reason, as lib/leagueYear.ts and lib/capEnforcement.ts: importing a
 * `'use client'` export into a Server Component has shipped a 500 from this
 * app before (see `capCommitted` in lib/cap.ts), and tsc cannot see it.
 * ===========================================================================
 */

/**
 * ONE NAMED PIECE OF THE MOVE. `amount` is signed in dollars, positive when it
 * FREES room, so the pieces add to the change in cap space with no sign
 * juggling at the call site.
 */
export interface PendingCapCause {
  id:
    | 'CEILING'
    /** Contracts stepping a year: proration falling off the back of expiring deals, base salary escalating. */
    | 'AGING'
    /** `CapCharge` rows dated to the closing year, which the new year does not read. */
    | 'DEAD_EXPIRING'
    /** What the closing year could not fund, rewritten into the new one. */
    | 'OVERAGE_CARRY'
    /** Expiring men reaching free agency, and their salary with them. */
    | 'EXPIRING_WALK'
    /** Void-year bonus that was never charged to anybody, arriving as the deal ends. */
    | 'VOID_ACCELERATION'
    /** Anything the named causes above do not account for. Never folded into a named one. */
    | 'OTHER';
  amount: number;
  /** One clause, money already formatted, for the hover note. */
  clause: string;
}

export interface PendingCapChange {
  event: 'SEASON_END' | 'RESIGN_WINDOW_CLOSES';
  /** Cap space as it reads right now, straight off `teamCapSummary`. */
  before: number;
  /** What it will read once the advance has run. */
  after: number;
  /** `after - before`. Positive frees room. */
  delta: number;
  /** Every named piece, largest first. Sums to `delta` with `OTHER` included. */
  causes: PendingCapCause[];
  /** The caption that goes under the cap figure. */
  label: string;
  /** The hover on that caption. */
  note: string;
}

/**
 * WHAT A COHORT OF DEALS STILL OCCUPIES — the one derivation, for the two
 * screens that quote it.
 *
 * The re-sign window's "On The Books — these deals, comes off if they walk"
 * tile is this sum over the men on its list, and the header caption is this
 * sum over the men who are actually one advance from the street. They are the
 * same question asked of two cohorts, and they were about to become two
 * reduces over `capHit` written a screen apart. `capHit` is the same function
 * `teamCapSummary` sums, which is what keeps this figure and the cap space it
 * is quoted against in one arithmetic.
 */
export function expiringCapCommitment(
  rows: readonly { contract: ContractLike | null }[],
  mode: CapMode,
): number {
  if (mode === 'OFF') return 0;
  return rows.reduce((sum, r) => sum + capHit(r.contract, mode), 0);
}

/**
 * THE BONUS A VOID YEAR PUSHED PAST THE END OF THE DEAL, which lands as a real
 * charge the day the contract runs out.
 *
 * Charged so far is `proration x the real years actually played`; whatever is
 * left of the signing bonus was never billed to anybody, and void years are
 * borrowing against exactly that. `releaseUnresignedExpiringContracts`
 * (lib/season.ts) is what WRITES it — this is the same arithmetic read a press
 * early so the header can say the release is not free. Deliberately not gated
 * on `CapMode`: neither is the write, and a save switched over from REALISTIC
 * still owes what its old deals stranded.
 */
export function strandedVoidBonus(c: ContractLike | null | undefined): number {
  if (!c || !c.voidYears || c.voidYears <= 0) return 0;
  return Math.max(0, c.signingBonus - proration(c) * c.years);
}

/** Money in a sentence: "$9.1M", never "-$9.1M" — the clause carries the direction. */
const money = (n: number) => formatMoney(Math.abs(n));

/**
 * Will the next press of Advance play the final and end the season?
 *
 * `simulatePlayoffRound` crowns a champion on the branch where the set of
 * played postseason rounds contains FINAL — measured AFTER this press's own
 * games are saved. So the question is whether FINAL is in the union of what
 * has been played and what is pending, and the earlier branches cannot steal
 * the press: the bracket only ever reaches a FINAL through CONFERENCE, so if
 * FINAL is in that union every guard above it is already satisfied.
 */
async function nextPressEndsSeason(leagueId: string, seasonYear: number): Promise<boolean> {
  const rounds = await prisma.game.findMany({
    where: { leagueId, seasonYear, kind: { not: 'REGULAR' } },
    select: { kind: true },
  });
  return rounds.some((g) => g.kind === 'FINAL');
}

/** The label `settleClosingYearCapOverage` writes its carry under. Must match lib/season.ts exactly. */
const overageCarryLabel = (closingYear: number) => `Cap overage carried from ${closingYear}`;

export async function pendingCapChange(
  teamId: string,
  league: LeagueCapFields & { phase: string; week: number },
  mode: CapMode,
): Promise<PendingCapChange | null> {
  // No ceiling means no room to move; the header chip is not drawn at all in
  // this mode (see the layout), so there is nothing to caption.
  if (mode === 'OFF') return null;
  if (league.phase !== 'PLAYOFFS' && league.phase !== 'RESIGN') return null;
  if (league.phase === 'PLAYOFFS' && !(await nextPressEndsSeason(league.id, league.seasonYear))) return null;

  const before = await teamCapSummary(teamId, league.seasonYear, mode);
  if (!before.capEnabled) return null;

  const causes: PendingCapCause[] = [];
  let after: number;
  let event: PendingCapChange['event'];
  let opening: string;

  if (league.phase === 'RESIGN') {
    event = 'RESIGN_WINDOW_CLOSES';
    // Exactly the cohort `releaseUnresignedExpiringContracts` takes: still
    // rostered, still charged, and out of years. Nothing else on the user's
    // sheet moves on this press — the wire minting and the roster refill that
    // share it are both `isUser: false`.
    const walking = await prisma.player.findMany({
      where: { teamId, status: 'ACTIVE', contract: { yearsRemaining: 0 } },
      select: { contract: true },
    });
    const comesOff = expiringCapCommitment(walking, mode);
    const stranded = walking.reduce((s, p) => s + strandedVoidBonus(p.contract), 0);

    after = before.capTotal - (before.activeSalary - comesOff) - (before.deadMoney + stranded);
    opening = 'Your next Advance shuts the re-sign window:';
    if (comesOff !== 0) {
      causes.push({
        id: 'EXPIRING_WALK',
        amount: comesOff,
        clause: `${walking.length} expiring ${walking.length === 1 ? 'deal' : 'deals'} worth ${money(comesOff)} `
          + `${walking.length === 1 ? 'comes' : 'come'} off your books as ${walking.length === 1 ? 'he reaches' : 'those men reach'} free agency`,
      });
    }
    if (stranded !== 0) {
      causes.push({
        id: 'VOID_ACCELERATION',
        amount: -stranded,
        clause: `${money(stranded)} of void-year bonus accelerates onto this year's cap`,
      });
    }
  } else {
    event = 'SEASON_END';
    const newYear = league.seasonYear + 1;
    // `ageContractsForYear` is idempotent on League.contractsAgedYear, so a
    // save that reaches the final already stepped forward ages nothing and
    // settles nothing — but the phase still lands on OFFSEASON wk1, where
    // `bookYearFor` reads the new year's ceiling and the new year's charges.
    // The ceiling and dead-money legs move either way; only the salary leg is
    // conditional.
    const row = await prisma.league.findUniqueOrThrow({
      where: { id: league.id }, select: { contractsAgedYear: true },
    });
    const willAge = row.contractsAgedYear == null || row.contractsAgedYear < newYear;
    const willSettle = willAge && mode === 'REALISTIC';

    // The ceiling NOW is the one already on screen — `before.capTotal`, which
    // teamCapSummary resolved through the same `capForLeague`. Reading it a
    // second time here would be a second derivation of a figure this function
    // is holding, and the growth clause has to be the difference between what
    // the GM can see and what he is about to get.
    const ceilingNext = await capForLeague(league, newYear);
    const ceilingGrowth = ceilingNext - before.capTotal;

    const roster = await prisma.player.findMany({
      where: { teamId, status: 'ACTIVE' },
      select: { contract: true },
    });
    // The ledger a press from now, contract by contract: `yearsRemaining`
    // decrements for everyone still owing a season, exactly as the updateMany
    // in `ageContractsForYear` writes it. A deal already at zero is left where
    // it is by that query and is left where it is here.
    const salaryAfter = roster.reduce((s, p) => {
      const c = p.contract;
      if (!c) return s;
      const aged = willAge && c.yearsRemaining > 0 ? { ...c, yearsRemaining: c.yearsRemaining - 1 } : c;
      return s + capHit(aged, mode);
    }, 0);
    const agingRelief = before.activeSalary - salaryAfter;

    // Charges are read at the year the books are written in, so the closing
    // year's rows simply stop being counted the moment the phase lands on
    // OFFSEASON wk1. They are not deleted until the AGE_CONTRACTS sweep, and
    // that does not matter to the figure.
    const carry = overageCarryLabel(league.seasonYear);
    const nextRows = await prisma.capCharge.findMany({
      where: { teamId, year: newYear }, select: { amount: true, label: true },
    });
    // The settlement deletes its own previous row for this year before it
    // rewrites one, so a re-run restates rather than compounds — which means a
    // carry row already sitting there is about to be replaced, not added to.
    const standingNext = nextRows
      .filter((r) => !(willSettle && r.label === carry))
      .reduce((s, r) => s + r.amount, 0);
    // What the closing year could not fund. `settleClosingYearCapOverage` runs
    // from inside `ageContractsForYear`, BEFORE the decrement and while the
    // league still stands in PLAYOFFS — where `capChargeYear` is the identity
    // — so the position it reads is precisely the one on screen right now.
    const overage = willSettle ? Math.max(0, -before.capSpace) : 0;
    const deadAfter = standingNext + overage;

    after = ceilingNext - salaryAfter - deadAfter;
    opening = `Your next Advance plays the final, and the books roll to ${newYear}:`;
    if (agingRelief !== 0) {
      causes.push({
        id: 'AGING',
        amount: agingRelief,
        clause: agingRelief > 0
          ? `${money(agingRelief)} comes off as contracts age a year and expiring deals stop carrying their bonus`
          : `${money(agingRelief)} goes on as contracts age into their next year's salary`,
      });
    }
    if (ceilingGrowth !== 0) {
      causes.push({
        id: 'CEILING',
        amount: ceilingGrowth,
        clause: `the ceiling ${ceilingGrowth > 0 ? 'rises' : 'falls'} ${money(ceilingGrowth)} to ${formatMoney(ceilingNext)}`,
      });
    }
    const deadExpiring = before.deadMoney - standingNext;
    if (deadExpiring !== 0) {
      causes.push({
        id: 'DEAD_EXPIRING',
        amount: deadExpiring,
        clause: deadExpiring > 0
          ? `${money(deadExpiring)} of ${league.seasonYear} dead money goes with the season`
          : `${money(deadExpiring)} of dead money already dated to ${newYear} starts being charged`,
      });
    }
    if (overage !== 0) {
      causes.push({
        id: 'OVERAGE_CARRY',
        amount: -overage,
        clause: `${money(overage)} you finished ${league.seasonYear} over the ceiling is carried into the new year`,
      });
    }
  }

  const delta = after - before.capSpace;
  // THE NAMED CAUSES ARE CHECKED AGAINST THE PREDICTION, not derived from it.
  // `after` is built by re-computing the whole sheet a press from now; the
  // clauses above are built one at a time from the things that moved. If the
  // two ever disagree the difference is shown under its own name rather than
  // quietly rolled into whichever cause happens to be listed first — a
  // decomposition that always adds up because the last line absorbs the error
  // is not a decomposition.
  const named = causes.reduce((s, c) => s + c.amount, 0);
  const residual = delta - named;
  if (Math.abs(residual) >= 1) {
    causes.push({
      id: 'OTHER',
      amount: residual,
      clause: `${money(residual)} ${residual > 0 ? 'frees' : 'goes on'} for reasons this note cannot name`,
    });
  }
  causes.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  // Sub-dollar movement is rounding dust on proration, not news. Nothing is
  // clamped — the figure is either worth a line or there is no line.
  if (Math.round(delta) === 0) return null;

  const clauses = causes.map((c) => c.clause);
  const body = clauses.length <= 1
    ? clauses.join('')
    : `${clauses.slice(0, -1).join(', ')}${clauses.length > 2 ? ',' : ''} and ${clauses[clauses.length - 1]}`;

  return {
    event,
    before: before.capSpace,
    after,
    delta,
    causes,
    /*
     * THE CAPTION IS THE MONEY AND ONE WORD, and the word is load-bearing in
     * both directions. A bare figure under Cap Space could be read as another
     * total; "next advance" spelled out is 20 characters of 10px mono, and
     * measured at the lg breakpoint where this chip first appears (1024px,
     * scripts/_pend_shot.mjs) that pushed the page 14px wider than it already
     * was. "pending" costs nothing — the tile is still sized by its own label
     * — and the rest of the sentence is one hover away, which is exactly the
     * shape the app owner asked for: *"show the old cap space number with a
     * (+15M) underneath it. and when you hover over the (15M) it says from
     * contracts rolling off"*.
     */
    label: `${delta > 0 ? '+' : '-'}${money(delta)} pending`,
    note: `${opening} ${body}.`,
  };
}
