import { prisma } from './db';
import { CapMode } from './types';
import { capChargeYear, capHit, capHitSchedule, deadMoneyOnCut, proration } from './cap';
import { CAP, rosterMinFor } from './tuning';
import { capForLeague, type LeagueCapFields } from './leagueYear';
import { parseSettings } from './settings';

export interface CapSummary {
  capTotal: number;
  activeSalary: number;
  deadMoney: number;
  capUsed: number;
  /**
   * Room left under the ceiling. In OFF mode this is deliberately
   * `Number.POSITIVE_INFINITY`, NOT 0 — the AI's offer sizing (maxOffer,
   * runAiFreeAgencyWave, fillRosterForTeam) budgets against it, and a 0
   * would silently stop every CPU team from signing anyone in a league
   * with the cap switched off.
   *
   * That makes it unsafe to render directly: formatMoney(Infinity) prints
   * "$InfinityM". Branch on `capEnabled` before displaying any figure from
   * this summary.
   */
  capSpace: number;
  rosterSize: number;
  /** False only when capMode is OFF. The single flag UI should branch on. */
  capEnabled: boolean;
  /**
   * THE LEAGUE YEAR EVERY FIGURE ABOVE IS MEASURED IN, and the only year any
   * caller may print beside them. It is `League.seasonYear` everywhere except
   * OFFSEASON weeks 1-2, where the contract ledger has already rolled and
   * `seasonYear` has not — see the header on `bookYearFor` below.
   *
   * It exists because the Cap page used to label these figures
   * `${league.seasonYear}` off its own read of the League row, which is a
   * second derivation of a year this function had already decided. Print this.
   */
  capYear: number;
}

/**
 * ===========================================================================
 * THE YEAR A CLUB'S BOOKS ARE CURRENTLY WRITTEN IN
 * ===========================================================================
 * Not the same question as "what season is it", and confusing the two is the
 * bug this whole header exists to stop.
 *
 * `ageContractsForYear` steps every contract onto the next league year THE
 * INSTANT THE SEASON ENDS — inside the playoffs' final step, before the phase
 * even flips to OFFSEASON (lib/season.ts). `League.seasonYear` does not move
 * until the RESET_STANDINGS step, which is the second step of the first
 * offseason Advance. So through OFFSEASON weeks 1-2 there is a window where
 * `capHit()` returns NEXT year's number for every man in the league while
 * `League.seasonYear` still names the season just played.
 *
 * THIS FUNCTION USED TO READ `seasonYear` AND IT PRODUCED A FIGURE THAT
 * DESCRIBED NO LEAGUE YEAR AT ALL. Measured on a scratch league driven four
 * seasons by `advanceWeek` (scripts/_offcap_probe.ts), the NYA at OFFSEASON
 * week 1 were shown:
 *
 *     ceiling      $262.7M   the 2029 ceiling — the season just PLAYED
 *     salaries     $274.1M   2030 terms — the ledger had already rolled
 *     dead money     $3.7M   2029 charges — a closed season's bill
 *     ------------------------------------------------------------------
 *     on screen    -$15.1M   three years stitched into one number
 *
 * One Advance later, with no transaction of any kind, the same club read
 * -$8.8M: the ceiling moved onto 2030 (+$2.6M) and the 2029 dead money stopped
 * being counted (+$3.7M). That $6.4M was never real. The 2029 bill had already
 * been paid out of the 2029 books — `settleClosingYearCapOverage` reads the
 * closing year's position before the ledger steps and carries forward anything
 * that year could NOT fund, so what `expireStaleCapCharges` later sweeps is a
 * bill that was genuinely settled. Charging it a second time on top of next
 * year's salaries is a double count.
 *
 * AND IT RAN THE OTHER WAY TOO, which is the dangerous half. `cutPlayer` dates
 * its dead money with `capChargeYear()` — deliberately the NEW year in this
 * window, because the new year is the one that will pay it — so a release
 * booked a charge this function was not reading. Measured
 * (scripts/_offcap_cut.ts): releasing an $80.6M-dead-money contract at
 * OFFSEASON week 1 moved the club from -$6.8M to +$39.2M on screen and in the
 * cap gate, for a move that actually left it $34.6M worse off. One Advance
 * later the same club read -$35.0M. A GM cutting his way out of a bad number
 * in this window was being shown a windfall for a catastrophe.
 *
 * SO THE READER FOLLOWS THE LEDGER. `capChargeYear` already names this exact
 * boundary and is what the write paths (cuts, tags, trades, void-year bills)
 * are dated by, so reading against it is what puts the sheet and the ledger in
 * the same year — which is all the fix is.
 *
 * ONLY THE CURRENT LEAGUE YEAR IS SHIFTED. A caller naming any other year
 * means that year literally, and there is exactly one:
 * `settleClosingYearCapOverage` asks for the CLOSING year while the league row
 * has already been stepped onto the new one, and it must get the closing year
 * unshifted or the settlement restates itself off the wrong season.
 * (At its main call site the league is still standing in PLAYOFFS, where
 * `capChargeYear` is the identity anyway; the guard is what makes the
 * AGE_CONTRACTS catch-up path safe too.)
 *
 * REJECTED: moving `League.seasonYear` forward at the end of the playoffs so
 * the two never disagree. It is the honest shape and it is not surgery — the
 * RESET_STANDINGS step closes the season's stats, awards and standings against
 * that same field, PROGRESS's summary calls it "the season just played", and
 * every offseason transaction is stamped with it. One seam would close and
 * five would open.
 * REJECTED: leaving the arithmetic and explaining the jump in words. The
 * number is not merely unexplained — it is a closed season's bill added to a
 * new season's salaries under an old season's ceiling. There is no honest
 * sentence for that.
 * ===========================================================================
 */
function bookYearFor(
  league: { phase: string; week: number; seasonYear: number },
  askedFor: number,
): number {
  if (askedFor !== league.seasonYear) return askedFor;
  return capChargeYear({ phase: league.phase, week: league.week, seasonYear: askedFor });
}

export async function teamCapSummary(teamId: string, seasonYear: number, mode: CapMode): Promise<CapSummary> {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { leagueId: true } });
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: team.leagueId },
    select: { id: true, seasonYear: true, startYear: true, settings: true, phase: true, week: true },
  });

  // The year this club's books are actually written in right now. See the
  // header above — through OFFSEASON weeks 1-2 it is a year ahead of
  // `League.seasonYear`, because the contract ledger already is.
  const capYear = bookYearFor(league, seasonYear);

  const players = await prisma.player.findMany({
    where: { teamId, status: 'ACTIVE' },
    include: { contract: true },
  });
  const deadRows = await prisma.capCharge.findMany({ where: { teamId, year: capYear } });

  // capForLeague resolves the founding year AND the league's own growth rung
  // together, which is why this reads it rather than capForYear directly.
  //
  // Two separate bugs have lived on this one line. The first: the second
  // argument is the FOUNDING year, not the current one, and passing the season
  // made `elapsed` zero every time — the ceiling was pinned at BASE_CAP for
  // the life of every league. The second: once growth became a setting, the
  // two-argument form kept computing the tuning default's curve, so a FLAT
  // league read $265.3M here two years in while its own cap page read
  // $255.0M. THIS function is the one every cap gate and every over-cap
  // warning runs on, so of the six call sites it was the one that decided
  // what the game was actually played under.
  const capTotal = mode === 'OFF' ? 0 : await capForLeague(league, capYear);
  const activeSalary = players.reduce((sum, p) => sum + capHit(p.contract, mode), 0);
  const deadMoney = mode === 'OFF' ? 0 : deadRows.reduce((s, r) => s + r.amount, 0);
  const capUsed = activeSalary + deadMoney;

  return {
    capTotal,
    activeSalary,
    deadMoney,
    capUsed,
    capSpace: mode === 'OFF' ? Number.POSITIVE_INFINITY : capTotal - capUsed,
    rosterSize: players.length,
    capEnabled: mode !== 'OFF',
    capYear,
  };
}

/**
 * ===========================================================================
 * THE DEAD-MONEY RUNWAY — WHAT IS ON THE BILL, AND WHEN IT ENDS
 * ===========================================================================
 * `teamCapSummary` above answers "what am I carrying THIS year" and nothing
 * else: it reads `CapCharge` at `year: seasonYear` and stops. So does INV-19
 * in lib/invariants.ts. Neither is wrong — that is the year the ceiling is
 * enforced against — but it means neither of them has ever looked past the
 * season in front of it, and a GM cannot tell a bill that ends in March from
 * one that follows him for four years.
 *
 * TWO KINDS OF MONEY, AND THEY ARE NOT THE SAME BILL.
 *
 *   BOOKED    a `CapCharge` row that exists. Already dated, already charged,
 *             already inside `summary.deadMoney` for the year it names. There
 *             is no decision left in it.
 *   SCHEDULED a void-year bill that has NOT been written yet, because the
 *             contract that owes it is still on the roster.
 *             `releaseUnresignedExpiringContracts` (lib/season.ts) books
 *             `signingBonus - proration x years` the league year the real deal
 *             runs out, and until that day arrives there is no row anywhere to
 *             read. It is the one future dead-money charge this game can name
 *             honestly, because nothing about it depends on a decision the GM
 *             has not made yet.
 *
 * Adding those two into one number would be the lying metric: one of them is
 * on the ledger and the other is a consequence of a contract that could still
 * be cut, traded or extended before it lands. They are carried, summed and
 * coloured separately the whole way through.
 *
 * WHAT IS DELIBERATELY NOT IN HERE. `deadMoneyOnCut` over the roster — what it
 * WOULD cost to release everyone — is not a bill, it is a menu, and the
 * contract table on the Cap page already prices it per man. Rolling it in
 * would put a figure on this panel that the club does not owe and may never
 * owe.
 *
 * WHY A CUT DOES NOT ALREADY SPREAD ITSELF ACROSS THESE YEARS. Measured, not
 * assumed (scripts/_dm_probe.ts): `cutPlayer` writes exactly ONE row for the
 * whole charge — real football splits an accelerated bonus over two league
 * years with a post-June-1 designation and this game has no such move, so
 * every release lands entire on one season. Which is why the booked half of
 * this runway is nearly always one column tall: dead money here is a bill that
 * arrives whole and is gone at the roll.
 * ===========================================================================
 */

/** One line on the bill — a row that exists, or a void-year charge that will. */
export interface DeadMoneyItem {
  kind: 'BOOKED' | 'SCHEDULED';
  /** The league year this lands on. */
  year: number;
  amount: number;
  /** The ledger label. For a scheduled charge, the exact label it will be written with. */
  label: string;
  /** Set on SCHEDULED items only — the man whose deal owes it. */
  playerId?: string;
}

export interface DeadMoneyYear {
  year: number;
  booked: number;
  scheduled: number;
  total: number;
  /** Everything landing on this year, heaviest first. */
  items: DeadMoneyItem[];
}

export interface DeadMoneyRunway {
  /** One entry per year in the window, starting at the year the ledger is written in. */
  years: DeadMoneyYear[];
  /**
   * Everything dated to the ledger year, booked and scheduled.
   * `years[0].booked` — NOT this — is the figure `CapSummary.deadMoney` holds
   * and the masthead tile shows, and the two are now the same year in every
   * window; they differ only inside RESIGN, where a void-year deal at zero
   * years remaining is about to be charged to this same season and belongs in
   * the column with it.
   */
  thisYear: number;
  /** Every dollar on the bill, including anything dated past the window. */
  total: number;
  /** Charged past the last column — the runway is longer than the panel is wide. */
  beyondWindow: number;
  /** Those same charges, by name. A total with no names on it is not actionable. */
  beyondItems: DeadMoneyItem[];
  /** Last league year carrying anything at all. Null when the books are clean. */
  lastYear: number | null;
  /** Heaviest single charge on the whole bill. */
  largest: DeadMoneyItem | null;
}

/**
 * ONE YEAR, AND IT IS THE LEDGER'S.
 *
 * The WINDOW starts at `capChargeYear(league)` — the year the contract ledger
 * is currently expressed in — and so does every figure on the Cap page, now
 * that `teamCapSummary` reads the same year (see `bookYearFor` above). The
 * masthead's ceiling, the compliance gate, `summary.deadMoney` and column 0
 * here are therefore all in one league year, which is what makes this panel
 * reconcilable against the tile above it.
 *
 * IT USED TO BE TWO. The window was labelled from `league.seasonYear` while
 * the SCHEDULED bills were dated off `capChargeYear()`, and through OFFSEASON
 * weeks 1-2 those are different years — so a void bill sat one column out of
 * step with the ledger position it was computed from. Both halves now count
 * from the same place, so the skew has nowhere left to live.
 *
 * AND THE BOOKED FILTER MOVED WITH IT. A row dated before the ledger year
 * belongs to a season that has closed: whatever it could not fund has already
 * been rewritten into the new year by `settleClosingYearCapOverage`, and
 * `expireStaleCapCharges` deletes it at the AGE_CONTRACTS step. Between the
 * ledger rolling (end of the playoffs) and that sweep those settled rows are
 * still sitting on the table, and counting them would bill the club twice for
 * one season for the length of the whole pre-roll window.
 */
export async function deadMoneyRunway(
  teamId: string,
  league: { phase: string; week: number; seasonYear: number },
  mode: CapMode,
  windowYears = 4,
): Promise<DeadMoneyRunway> {
  const ledgerYear = capChargeYear(league);
  const empty: DeadMoneyRunway = {
    years: Array.from({ length: windowYears }, (_, i) => ({
      year: ledgerYear + i, booked: 0, scheduled: 0, total: 0, items: [],
    })),
    thisYear: 0, total: 0, beyondWindow: 0, beyondItems: [], lastYear: null, largest: null,
  };
  // Same narrowing teamCapSummary makes: with the cap off there is no dead
  // money to carry and no ceiling for it to eat into. SIMPLIFIED is NOT
  // narrowed out — cuts leave nothing there, but a save switched over from
  // REALISTIC still has real rows on its ledger, and the write path that books
  // a void-year bill takes no view of the mode either.
  if (mode === 'OFF') return empty;

  const [rows, deals] = await Promise.all([
    // `gte: ledgerYear` and not the whole table — see the note above on why a
    // row dated before the ledger year is a bill that has already been settled.
    prisma.capCharge.findMany({
      where: { teamId, year: { gte: ledgerYear } },
      select: { year: true, amount: true, label: true },
    }),
    prisma.contract.findMany({
      where: { teamId, voidYears: { gt: 0 }, player: { status: 'ACTIVE' } },
      select: {
        playerId: true, years: true, yearsRemaining: true, signedYear: true,
        baseSalaries: true, signingBonus: true, guaranteed: true, voidYears: true,
        player: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const items: DeadMoneyItem[] = rows.map((r) => ({
    kind: 'BOOKED' as const, year: r.year, amount: r.amount, label: r.label,
  }));

  for (const c of deals) {
    // The arithmetic is releaseUnresignedExpiringContracts's own, character for
    // character: charged so far is proration x the REAL years, and whatever is
    // left of the bonus is what the void years pushed past the end of the deal.
    // Deriving it a second way here is how a panel ends up quoting a figure the
    // game does not use.
    const stranded = Math.max(0, c.signingBonus - proration(c) * c.years);
    if (stranded <= 0) continue;
    items.push({
      kind: 'SCHEDULED',
      // `yearsRemaining` counts the season he is IN, so a man in his final year
      // reads 1 and his deal runs out at the end of THIS ledger year — the bill
      // lands the next one, when RESIGN closes and he walks.
      year: ledgerYear + c.yearsRemaining,
      amount: stranded,
      // The label the ledger will actually carry when this is written, so the
      // line a GM reads here is the line he finds on the sheet next year.
      label: `Void years — ${c.player.firstName} ${c.player.lastName}`,
      playerId: c.playerId,
    });
  }

  const years: DeadMoneyYear[] = Array.from({ length: windowYears }, (_, i) => {
    const year = ledgerYear + i;
    const mine = items.filter((it) => it.year === year).sort((a, b) => b.amount - a.amount);
    const booked = mine.filter((it) => it.kind === 'BOOKED').reduce((s, it) => s + it.amount, 0);
    const scheduled = mine.filter((it) => it.kind === 'SCHEDULED').reduce((s, it) => s + it.amount, 0);
    return { year, booked, scheduled, total: booked + scheduled, items: mine };
  });

  const lastWindowYear = ledgerYear + windowYears - 1;
  const beyond = items
    .filter((it) => it.year > lastWindowYear)
    .sort((a, b) => a.year - b.year || b.amount - a.amount);
  return {
    years,
    thisYear: years[0]?.total ?? 0,
    total: items.reduce((s, it) => s + it.amount, 0),
    // A long deal with void years on it can strand money further out than four
    // columns. The panel says so in words rather than silently cropping the
    // runway, which would turn "the books are clean after 2029" into a lie.
    beyondWindow: beyond.reduce((s, it) => s + it.amount, 0),
    beyondItems: beyond,
    lastYear: items.length > 0 ? Math.max(...items.map((it) => it.year)) : null,
    largest: items.reduce<DeadMoneyItem | null>((best, it) => (best && best.amount >= it.amount ? best : it), null),
  };
}

/**
 * ===========================================================================
 * THE MULTI-YEAR CAP SHEET — ONE COMPUTATION, TWO PANELS
 * ===========================================================================
 * The Advanced tab used to carry two four-year charts of the same future cap,
 * and neither could answer the question on its own:
 *
 *   MULTI-YEAR CAP OUTLOOK  four years of ACTIVE contract charges against the
 *                           ceiling. Its own tooltip said "dead money and new
 *                           signings aren't included".
 *   THE DEAD MONEY RUNWAY   four years of ONLY dead money, with names.
 *
 * One drew the future cap with the dead money taken out; the other drew the
 * dead money with the future cap taken out. Both were four columns wide, both
 * were on one screen, and the only way to get the number a GM plans against —
 * room — was to read a bar off a grey line in one panel and subtract a column
 * from the other by eye. Worse, they were dated off DIFFERENT YEARS (the
 * outlook counted forward from `league.seasonYear`, the runway dated its void
 * bills off `capChargeYear`) and nothing reconciled them.
 *
 * THE FIX IS NOT ONE PANEL. The app owner set the layout himself — *"lets move
 * the dead money towards the bottom of the advanced cap tab, and multi year
 * outlook as a bar graph to the top so its easy to look at"* — so there are
 * still two panels, at opposite ends of the tab. What changes is that they are
 * now SUMMARY AND DETAIL rather than two halves of one answer, and they are
 * both rendered from THIS ONE FUNCTION:
 *
 *   TOP     MultiYearOutlookPanel  — every dollar charged in each year,
 *           active contracts AND dead money, stacked against that year's
 *           ceiling. Room is the headline. It is the COMPLETE picture, which
 *           is exactly what the old outlook was not.
 *   BOTTOM  DeadMoneyRunwayPanel   — the itemisation of one segment of those
 *           bars: which deals, which years, what clears when.
 *
 * Because the top bar is a SUM of what the bottom panel LISTS — the same
 * `deadMoneyRunway` result, carried on `CapSheet.dead`, feeds both — the two
 * cannot disagree. That is what makes this split legitimate where the old one
 * was not. Two independent charts each showing half the future is the defect;
 * a summary whose components are itemised further down is not.
 *
 * REJECTED: folding both into a single panel (which is what the first pass
 * built). It reads well and it fixes the arithmetic, but it buries the one
 * number the owner wants at a glance under a 20-line ledger, and he asked for
 * the opposite.
 * REJECTED: leaving the outlook excluding dead money and simply reordering the
 * two panels. The reordering is cosmetic; the two-halves-of-one-answer defect
 * survives it untouched.
 *
 * WHAT ROOM MEANS HERE, exactly: `capTotal - activeSalary - deadMoney`, the
 * same three quantities `teamCapSummary` computes for the current season, one
 * year at a time. Column 0 is that function's arithmetic reproduced — see the
 * year-alignment note below for why it has to be, and what that costs in one
 * window of the calendar.
 *
 * WHAT IS DELIBERATELY NOT IN IT, and this is the honesty problem
 * `rookieCapOutlook` (lib/draft.ts) solves the same way. A future year has no
 * rookies drafted, no free agents signed, and — the one that actually
 * misleads — an INCOMPLETE ROSTER. Measured across all 6,976 clubs in the dev
 * database, a club carries a median of 44 men under contract this year, 30
 * next year, 18 the year after and 8 in the fourth column. So a raw "$180M of
 * room in 2043" is a lie by omission: it is room to sign 38 men with, not
 * money spare. Every column therefore carries `menSigned` and `floorCost` —
 * what it would cost, at the league minimum, just to reach the roster floor
 * this league plays to — and the top panel prints both. No estimate of what
 * those men will really cost is attempted: that number does not exist in the
 * game, and inventing one is the lying metric wearing a helpful face.
 *
 * THE WINDOW IS FOUR COLUMNS, AND IT WAS MEASURED RATHER THAN ROUNDED. The
 * app owner asked for "four or five". Across all 318,249 live contracts in the
 * dev database, the share still charging the cap N years out is:
 *
 *     +0  94.85%      +2  39.72%      +4   4.53%
 *     +1  64.73%      +3  18.78%      +5   0.46%
 *
 * A fifth column is 4.53% of contracts and a MEDIAN OF ZERO men per club — at
 * more than half of all clubs it is a blank column reading "$255M of room",
 * which is the exact lie the paragraph above is about, printed at its loudest.
 * Four columns is where the data stops being about the roster and starts being
 * about a handful of outliers. Nothing past the window is dropped, though:
 * `beyondActive` and `beyondActiveMen` carry the long contracts out, and
 * `dead.beyondWindow` / `dead.beyondItems` carry the stranded void bills out
 * by name — the discipline `deadMoneyRunway` already applied.
 *
 * YEAR ALIGNMENT, AND THE SKEW THAT USED TO LIVE HERE.
 * Column i is labelled `capChargeYear(league) + i` and is fed by
 * `capHitSchedule(contract)[i]`, and those are now the same year by
 * construction: the ledger year is exactly the year `capHitSchedule`'s first
 * entry is written in.
 *
 * It used to be `league.seasonYear + i`, which agrees with the schedule
 * everywhere EXCEPT OFFSEASON weeks 1-2 — `ageContractsForYear` steps the
 * ledger the moment the season ends, `RESET_STANDINGS` moves `seasonYear` two
 * steps later, and in between index 0 was really next year's charge under this
 * year's heading. Column 0 was deliberately pinned to reproduce that, because
 * `teamCapSummary` had the same skew and a first column disagreeing with the
 * gate the game enforces would have been the lying metric pointed the other
 * way. `teamCapSummary` now reads the ledger year too (see `bookYearFor`), so
 * the pinning is kept — the year it is pinned TO is simply the true one, and
 * column 0 still reconciles against the masthead tile line for line.
 *
 * `preRoll` survives that fix and still means something: through those two
 * weeks the league CLOCK in the header reads one year while this sheet reads
 * the next, and the top panel says so.
 * ===========================================================================
 */

/** Columns. See the window measurement in the header — this is 4 on evidence, not on roundness. */
export const CAP_SHEET_YEARS = 4;

export interface CapSheetYear {
  year: number;
  /** This league's own ceiling that season — its founding year AND its growth rung. */
  capTotal: number;
  activeSalary: number;
  deadBooked: number;
  deadScheduled: number;
  deadTotal: number;
  /** activeSalary + deadTotal. */
  committed: number;
  /** capTotal - committed. THE number a GM plans against. Negative is over. */
  room: number;
  /** Men under contract in this year. Column 0 is the roster; column 3 rarely is. */
  menSigned: number;
  /** Slots between `menSigned` and the roster floor this league plays to. */
  openSlots: number;
  /** Those slots at the league minimum — the floor under what the year still costs. */
  floorCost: number;
}

export interface CapSheet {
  years: CapSheetYear[];
  /**
   * The dead-money half, EXACTLY as `deadMoneyRunway` returns it, carried
   * rather than flattened. The bottom panel renders this object unchanged —
   * it is the same panel that shipped in b5a91c1, taking the same prop — while
   * `years[i].deadBooked + deadScheduled` above is the segment the top panel
   * stacks. One value, two readings, so the summary is arithmetically the sum
   * of the detail and the two panels cannot drift apart.
   */
  dead: DeadMoneyRunway;
  /** Active contract dollars charged past the last column, and to how many men. */
  beyondActive: number;
  beyondActiveMen: number;
  /** Last league year carrying any commitment at all, active or dead. */
  lastYear: number | null;
  /** The roster floor this league plays to (`rosterMinFor`, 46 of 53 by default). */
  rosterFloor: number;
  /** OFFSEASON weeks 1-2: the ledger has rolled and `seasonYear` has not. */
  preRoll: boolean;
  /** The league year the contract ledger is currently written in. */
  ledgerYear: number;
}

/**
 * The whole future cap for one club, in one call.
 *
 * It fetches its own roster rather than taking the Cap page's `players` array
 * so that a probe — and the next caller — gets the same answer without having
 * to know which query to run first. One extra player read on a view that
 * already runs four is the price, and it is what makes column 0 reconcilable
 * against `teamCapSummary` line for line.
 *
 * Dead money is NOT re-derived here: it is `deadMoneyRunway` above, called
 * with this window, so the booked/scheduled split, the void-year arithmetic
 * and the beyond-window accounting all have exactly one implementation. Two
 * derivations of one figure is how this app has repeatedly shipped a panel
 * quoting a number it was not using.
 */
export async function capSheet(
  teamId: string,
  league: LeagueCapFields & { phase: string; week: number },
  mode: CapMode,
  windowYears: number = CAP_SHEET_YEARS,
): Promise<CapSheet | null> {
  // The Cap page renders a different screen entirely with the cap off, and
  // every figure below would be zero or meaningless. Null rather than an empty
  // sheet, so a caller cannot render a panel of noughts by accident.
  if (mode === 'OFF') return null;

  const settings = parseSettings(league.settings);
  const rosterFloor = rosterMinFor(settings.rosterMax);
  // The league year the contract ledger — and therefore `capHitSchedule`'s
  // first entry, and `teamCapSummary` — is currently written in.
  const ledgerYear = capChargeYear(league);

  const [players, runway, ...ceilings] = await Promise.all([
    prisma.player.findMany({
      where: { teamId, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, position: true, contract: true },
    }),
    deadMoneyRunway(teamId, league, mode, windowYears),
    ...Array.from({ length: windowYears }, (_, i) => capForLeague(league, ledgerYear + i)),
  ]);

  const lastWindowYear = ledgerYear + windowYears - 1;
  /** Active cap charges per league year, and the men behind them. */
  const activeByYear = new Map<number, number>();
  const menByYear = new Map<number, number>();
  let beyondActive = 0;
  const beyondMen = new Set<string>();
  let lastActiveYear: number | null = null;

  for (const p of players) {
    if (!p.contract) continue;
    /**
     * THE EXPIRING MAN, AND THE BUG THE OLD OUTLOOK CHART SHIPPED WITH.
     *
     * `capHitSchedule` returns one entry per REMAINING year, so a contract at
     * `yearsRemaining: 0` returns an EMPTY array — and the Multi-Year Cap
     * Outlook this panel replaces summed exactly that. But `capHit` still
     * charges such a man (it reads the last base salary plus any proration
     * still inside the window), `teamCapSummary` sums `capHit`, and the cap
     * gate runs on `teamCapSummary`. He is on the roster and on the books
     * until `releaseUnresignedExpiringContracts` drops him at the end of
     * RESIGN.
     *
     * Every contract sits at zero remaining through the whole offseason roll,
     * because `ageContractsForYear` steps the ledger the moment the season
     * ends. MEASURED on a scratch league driven to OFFSEASON week 1
     * (scripts/_mc_probe.ts): the old chart's first column read $117.2M of
     * committed cap where the gate read $202.6M — it was hiding $85.4M, 42% of
     * the club's real commitment, in the one window where a GM is actually
     * making cuts. That is the lying metric, and it is why column zero here is
     * pinned to `capHit` rather than to the schedule's first entry.
     *
     * A man at zero remaining is charged THIS year and never again, so his
     * schedule is exactly one column long. REJECTED: dropping him from the
     * sheet entirely to match the old chart — it reproduces the understatement
     * and puts the panel back at odds with the masthead tile above it.
     */
    const schedule = p.contract.yearsRemaining >= 1
      ? capHitSchedule(p.contract, mode)
      : [capHit(p.contract, mode)];
    for (let i = 0; i < schedule.length; i++) {
      const year = ledgerYear + i;
      lastActiveYear = Math.max(lastActiveYear ?? year, year);
      if (year > lastWindowYear) {
        beyondActive += schedule[i];
        beyondMen.add(p.id);
        continue;
      }
      activeByYear.set(year, (activeByYear.get(year) ?? 0) + schedule[i]);
      menByYear.set(year, (menByYear.get(year) ?? 0) + 1);
    }
  }

  const years: CapSheetYear[] = Array.from({ length: windowYears }, (_, i) => {
    const year = ledgerYear + i;
    const activeSalary = activeByYear.get(year) ?? 0;
    const dead = runway.years[i];
    const deadBooked = dead?.booked ?? 0;
    const deadScheduled = dead?.scheduled ?? 0;
    const deadTotal = deadBooked + deadScheduled;
    const committed = activeSalary + deadTotal;
    const menSigned = menByYear.get(year) ?? 0;
    const openSlots = Math.max(0, rosterFloor - menSigned);
    return {
      year,
      capTotal: ceilings[i],
      activeSalary,
      deadBooked,
      deadScheduled,
      deadTotal,
      committed,
      room: ceilings[i] - committed,
      menSigned,
      openSlots,
      floorCost: openSlots * CAP.MIN_SALARY,
    };
  });

  const lastDeadYear = runway.lastYear;
  return {
    years,
    dead: runway,
    beyondActive,
    beyondActiveMen: beyondMen.size,
    lastYear: lastActiveYear === null ? lastDeadYear
      : lastDeadYear === null ? lastActiveYear
        : Math.max(lastActiveYear, lastDeadYear),
    rosterFloor,
    preRoll: ledgerYear !== league.seasonYear,
    ledgerYear,
  };
}
