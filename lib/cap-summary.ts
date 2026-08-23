import { prisma } from './db';
import { CapMode } from './types';
import { capChargeYear, capForYear, capHit, proration } from './cap';
import { CAP } from './tuning';
import { capForLeague, resolveStartYear } from './leagueYear';

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
}

export async function teamCapSummary(teamId: string, seasonYear: number, mode: CapMode): Promise<CapSummary> {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { leagueId: true } });
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: team.leagueId },
    select: { id: true, seasonYear: true, startYear: true, settings: true },
  });

  const players = await prisma.player.findMany({
    where: { teamId, status: 'ACTIVE' },
    include: { contract: true },
  });
  const deadRows = await prisma.capCharge.findMany({ where: { teamId, year: seasonYear } });

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
  const capTotal = mode === 'OFF' ? 0 : await capForLeague(league, seasonYear);
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
  /** One entry per year in the window, starting at the league's current season. */
  years: DeadMoneyYear[];
  /**
   * Everything dated to the current league year, booked and scheduled.
   * `years[0].booked` — NOT this — is the figure `CapSummary.deadMoney` holds
   * and the masthead tile shows; the two differ only inside the RESIGN window,
   * where a void-year deal at zero years remaining is about to be charged to
   * this same season and belongs in the column with it.
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
 * TWO DIFFERENT YEARS, AND MIXING THEM UP IS THE BUG THIS COMMENT EXISTS TO
 * PREVENT.
 *
 * The WINDOW starts at `league.seasonYear`, because that is the year the whole
 * Cap page is written in — the masthead's ceiling, the compliance gate and
 * `summary.deadMoney` are all measured against it, and a runway whose first
 * column disagreed with the tile above it would be two dead-money figures on
 * one screen.
 *
 * The SCHEDULED bills are dated off `capChargeYear()` instead, which is the
 * year the CONTRACT LEDGER is currently expressed in. Those two are the same
 * year everywhere except OFFSEASON weeks 1-2, where the season has not rolled
 * but `ageContractsForYear` already has: `yearsRemaining` is written in next
 * year's terms there, so counting it forward from `seasonYear` would date
 * every void bill a year early. In that window a release booked right now
 * lands in the SECOND column, not the first, and this panel is the only thing
 * on the page that says so — `teamCapSummary` reads `year: seasonYear` and
 * cannot see it at all.
 */
export async function deadMoneyRunway(
  teamId: string,
  league: { phase: string; week: number; seasonYear: number },
  mode: CapMode,
  windowYears = 4,
): Promise<DeadMoneyRunway> {
  const empty: DeadMoneyRunway = {
    years: Array.from({ length: windowYears }, (_, i) => ({
      year: league.seasonYear + i, booked: 0, scheduled: 0, total: 0, items: [],
    })),
    thisYear: 0, total: 0, beyondWindow: 0, beyondItems: [], lastYear: null, largest: null,
  };
  // Same narrowing teamCapSummary makes: with the cap off there is no dead
  // money to carry and no ceiling for it to eat into. SIMPLIFIED is NOT
  // narrowed out — cuts leave nothing there, but a save switched over from
  // REALISTIC still has real rows on its ledger, and the write path that books
  // a void-year bill takes no view of the mode either.
  if (mode === 'OFF') return empty;

  const ledgerYear = capChargeYear(league);

  const [rows, deals] = await Promise.all([
    // `gte: seasonYear` and not the whole table. A row dated before the current
    // league year belongs to a season that has closed: whatever it could not
    // fund has already been rewritten into this year by
    // settleClosingYearCapOverage, and expireStaleCapCharges deletes it at the
    // AGE_CONTRACTS step. Between the year roll (OFFSEASON week 2) and that
    // sweep (week 3) those paid rows are still sitting there, and counting
    // them would bill the club twice for one season for exactly one week.
    prisma.capCharge.findMany({
      where: { teamId, year: { gte: league.seasonYear } },
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
    const year = league.seasonYear + i;
    const mine = items.filter((it) => it.year === year).sort((a, b) => b.amount - a.amount);
    const booked = mine.filter((it) => it.kind === 'BOOKED').reduce((s, it) => s + it.amount, 0);
    const scheduled = mine.filter((it) => it.kind === 'SCHEDULED').reduce((s, it) => s + it.amount, 0);
    return { year, booked, scheduled, total: booked + scheduled, items: mine };
  });

  const lastWindowYear = league.seasonYear + windowYears - 1;
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
