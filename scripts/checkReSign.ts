/**
 * ===========================================================================
 * INV-21 RE-SIGN CHECK — KEEPING HIM MUST NOT BE CHEAPER THAN LOSING HIM
 * ===========================================================================
 * A sibling to checkFranchiseTag, and for the same reason that file gives for
 * being a sibling to checkRestructure rather than a clause inside it: the
 * restructure defect lived in a pure function, so arithmetic catches it. This
 * one never touched the arithmetic. `unamortizedBonus` returned the right
 * figure the whole time `extendContract` was throwing it away — a pure check
 * would assert a formula against itself and pass while testing nothing. So
 * this sweeps real contracts through the real `extendContract` against a real
 * database and reads the ledger back.
 *
 * WHAT WENT WRONG. `extendContract`'s replace branch — the one a walk-year
 * re-sign takes — ran `tx.contract.deleteMany` and booked no CapCharge, so
 * every dollar of signing bonus the club had paid and not yet charged to a
 * cap vanished. Measured, four exits from the SAME expired 3-year deal with
 * two void years and $13.5M of bonus:
 *
 *     walk $5.40M    cut $5.40M    tag $5.40M    RE-SIGN $0
 *
 * Which inverted the one incentive the cap exists to create.
 *
 * THE CLAUSES.
 *
 *   R-1  NOTHING PAID GOES UNCHARGED. Bonus already billed to the seasons he
 *        played, plus what this move books, plus what the new deal still
 *        carries, equals the bonus the club actually paid. The conservation
 *        law, and the clause the exploit failed.
 *
 *   R-2  THE SAME BONUS EVERY OTHER EXIT CHARGES. The figure a re-sign books
 *        is `unamortizedBonus` — the identical number a release accelerates
 *        as dead money, a trade accelerates onto the selling club, and a
 *        franchise tag books. Four ways off a contract, one answer about the
 *        bonus.
 *
 *   R-3  RE-SIGNING NEVER FREES MORE CAP THAN HIS OLD HIT. Stated against the
 *        ledger the Cap page, the advance gate and the AI's cap refusal all
 *        read (teamCapSummary), not against the arithmetic — because that is
 *        where the exploit was visible and where a GM saw it.
 *
 *   R-4  APPENDING IS NOT REPLACING, AND MUST NOT DOUBLE-CHARGE. A deal with
 *        years left on it goes to `signExtension`, which CARRIES the
 *        unamortised bonus into the new row rather than accelerating it.
 *        Booking a charge there too would bill the same money twice. Both
 *        branches are swept, and each is held to its own rule.
 *
 *   R-5  NOTHING IS INVENTED EITHER. A deal with no unamortised bonus left
 *        books no charge at all. A conservation check that only ever ran on
 *        shapes with money in them would pass a path charging a flat fee.
 *
 *   R-6  THE CHARGE FILES AGAINST THE YEAR THE CLUB IS ACTUALLY IN.
 *        `capChargeYear()` answers that and the answer differs either side of
 *        the offseason year roll: filed a year early it sits in a window
 *        where compliance is not enforced and `expireStaleCapCharges` deletes
 *        it unbilled. Both sides are exercised.
 *
 * AND THE HARNESS PROVES IT CAN FAIL, every run. A check that reads a field
 * that is not there compares `undefined` to `undefined` and reports success
 * while testing nothing — a mistake already made in this repo. So `ok()` is
 * fired at a knowingly false statement at the end, the run FAILS if that does
 * not produce a failure, and every figure read off the database goes through
 * `present()` before it is compared.
 * ===========================================================================
 */
import { prisma } from '../lib/db';
import { createLeague } from '../lib/gen/league';
import { extendContract } from '../lib/freeagency';
import {
  capHit, capChargeYear, deadMoneyOnCut, formatMoney, proration, prorationYears,
  unamortizedBonus, buildContract,
} from '../lib/cap';
import { teamCapSummary } from '../lib/cap-summary';
import { CapViolationError } from '../lib/capEnforcement';

/** Integer arithmetic rounds per year; a few dollars is not a defect. */
const TOL = 5;

const M = formatMoney;
let checks = 0;
let failures = 0;
let blocked = 0;
let rounds = 0;
const shown = new Map<string, number>();

function ok(rule: string, pass: boolean, detail: string) {
  checks++;
  if (pass) return;
  failures++;
  const n = (shown.get(rule) ?? 0) + 1;
  shown.set(rule, n);
  if (n <= 4) console.log(`  FAIL ${rule}  ${detail}`);
}

/** A figure read out of the database is only evidence if it is actually there. */
function present(label: string, v: unknown): boolean {
  if (v !== undefined && v !== null) return true;
  checks++;
  failures++;
  console.log(`  FAIL read  ${label} came back ${String(v)} — that comparison would have tested nothing`);
  return false;
}

// The same axes checkFranchiseTag sweeps, deliberately: the two paths are the
// same move made two ways, and a shape that breaks one is the shape to point
// at the other.
const YEARS = [1, 2, 3, 4, 5, 7];
const BONUS_PCTS = [0, 0.12, 0.28, 0.5];
const VOIDS = [0, 1, 2, 3];
/** Seasons already played, INCLUDING the one that ends with the deal run out. */
const playedFor = (years: number) =>
  years <= 4 ? Array.from({ length: years + 1 }, (_, i) => i) : [0, 2, years];

/** The deal he is re-signed to. Same magnitude as the old one, so the gate is
 *  exercised without the sweep spending itself on cap refusals. */
const NEW_APY = 9_000_000;
const NEW_YEARS = 3;

async function main() {
  let leagueId: string | null = null;
  let teamIds: string[] = [];
  try {
    leagueId = await createLeague({
      name: 'INV-21 re-sign check', userTeamAbbr: 'ZZZ', seed: 'check-resign',
      settings: { capMode: 'REALISTIC', franchiseTagEnabled: true },
    });
    const teams = await prisma.team.findMany({ where: { leagueId }, select: { id: true, abbr: true } });
    teamIds = teams.map((t) => t.id);
    // A re-sign is a RESIGN-window move, after the year roll, so the sweep
    // runs where the game runs it.
    const league = await prisma.league.update({ where: { id: leagueId }, data: { phase: 'RESIGN', week: 1 } });

    /**
     * One man per club, reused across the sweep, so his contract is
     * OVERWRITTEN each round rather than a new deal being added and the
     * club's active salary stays where it started. Not the best player on the
     * roster: re-signing a club's franchise quarterback every round runs the
     * cap out of room, which would turn this into a harness that skips
     * everything it means to test.
     */
    const subject = new Map<string, { id: string; name: string }>();
    for (const t of teams) {
      const men = await prisma.player.findMany({
        where: { teamId: t.id, status: 'ACTIVE' }, orderBy: { trueOvr: 'desc' },
        select: { id: true, firstName: true, lastName: true }, take: 30,
      });
      const man = men[20] ?? men[men.length - 1];
      subject.set(t.id, { id: man.id, name: `${man.firstName} ${man.lastName}` });
    }

    console.log(`league ${leagueId} — ${teams.length} clubs, phase ${league.phase} week 1, season ${league.seasonYear}\n`);

    let replaced = 0;
    let appended = 0;
    let withMoney = 0;
    let withoutMoney = 0;

    for (const years of YEARS) {
      for (const bonusPct of BONUS_PCTS) {
        for (const voidYears of VOIDS) {
          for (const played of playedFor(years)) {
            const team = teams[rounds % teams.length];
            // A fresh league YEAR every time the clubs come back round, so
            // each round reads a ledger carrying only its own charges rather
            // than nine earlier rounds' worth.
            const seasonYear = league.seasonYear + Math.floor(rounds / teams.length);
            rounds++;

            const man = subject.get(team.id)!;
            const fresh = buildContract({ apy: 9_000_000, years, signedYear: seasonYear - played, bonusPct, voidYears });
            const row = {
              teamId: team.id,
              years: fresh.years, yearsRemaining: fresh.years - played, signedYear: seasonYear - played,
              baseSalaries: JSON.stringify(fresh.baseSalaries), signingBonus: fresh.signingBonus,
              guaranteed: fresh.guaranteed, voidYears: fresh.voidYears,
              isRookieDeal: false, isFranchiseTag: false,
            };
            await prisma.contract.upsert({
              where: { playerId: man.id }, update: row, create: { playerId: man.id, ...row },
            });

            const before = await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } });
            // WHICH BRANCH THIS SHAPE TAKES, read off the row rather than
            // assumed: `extendContract` appends when years remain and
            // replaces when they do not, and the two owe different things.
            const isReplace = before.yearsRemaining <= 0;
            const label = `${team.abbr} ${years}yr+${fresh.voidYears}v bonus ${M(fresh.signingBonus)} played ${played}`
              + ` [${isReplace ? 'replace' : 'append'}]`;
            const paid = fresh.signingBonus;
            const billedToPlayedSeasons = proration(before) * Math.min(before.years - before.yearsRemaining, prorationYears(before));
            const owed = unamortizedBonus(before, 'REALISTIC');
            const oldHit = capHit(before, 'REALISTIC');

            const ledgerBefore = await teamCapSummary(team.id, seasonYear, 'REALISTIC');
            const chargeIdsBefore = new Set(
              (await prisma.capCharge.findMany({ where: { teamId: team.id, year: seasonYear }, select: { id: true } })).map((c) => c.id),
            );

            try {
              await extendContract({
                leagueId, playerId: man.id, apy: NEW_APY, years: NEW_YEARS,
                seasonYear, capMode: 'REALISTIC', week: 1,
              });
            } catch (err) {
              // A club that genuinely cannot afford the deal is a legal
              // outcome, not a failure — but a run that skips most of its
              // sweep is testing nothing, so the count is asserted at the end.
              if (err instanceof CapViolationError) { blocked++; continue; }
              throw err;
            }

            if (isReplace) replaced++; else appended++;
            const after = await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } });
            const ledgerAfter = await teamCapSummary(team.id, seasonYear, 'REALISTIC');
            const booked = (await prisma.capCharge.findMany({ where: { teamId: team.id, year: seasonYear } }))
              .filter((c) => !chargeIdsBefore.has(c.id));
            const bookedTotal = booked.reduce((a, c) => a + c.amount, 0);

            for (const c of booked) { present(`${label} CapCharge.amount`, c.amount); present(`${label} CapCharge.year`, c.year); }
            present(`${label} contract.signingBonus`, after.signingBonus);
            present(`${label} ledger.capUsed`, ledgerAfter.capUsed);
            present(`${label} ledger.deadMoney`, ledgerAfter.deadMoney);

            if (owed > 0) withMoney++; else withoutMoney++;

            // R-1 — nothing paid goes uncharged, and nothing is charged twice.
            //
            // The new deal pays its OWN bonus, so what the old one still owes
            // has to be separated out of `after.signingBonus`. The replace
            // branch strands nothing in the new row (it builds a fresh
            // contract), so its whole share is the charge; the append branch
            // carries it, so its share is the part of the new row's
            // unamortised bonus that is not new money.
            const newBonusPaid = isReplace ? after.signingBonus : after.signingBonus - owed;
            const stillCarried = isReplace
              ? 0
              : Math.max(0, unamortizedBonus(after, 'REALISTIC') - newBonusPaid);
            const everCharged = billedToPlayedSeasons + bookedTotal + stillCarried;
            ok('R-1 the old bonus is fully accounted for',
              Math.abs(everCharged - paid) <= TOL * (years + 4),
              `${label}: ${M(billedToPlayedSeasons)} billed + ${M(bookedTotal)} booked + ${M(stillCarried)} carried`
              + ` = ${M(everCharged)} against ${M(paid)} paid`);

            // R-2 — the same bonus every other exit charges.
            if (isReplace) {
              ok('R-2 a re-sign books the bonus a release would accelerate',
                Math.abs(bookedTotal - owed) <= TOL,
                `${label}: booked ${M(bookedTotal)} against ${M(owed)} unamortised`);
              ok('R-2 never more than a release would cost',
                bookedTotal <= deadMoneyOnCut(before, 'REALISTIC') + TOL,
                `${label}: booked ${M(bookedTotal)} vs a cut's ${M(deadMoneyOnCut(before, 'REALISTIC'))}`);
            }

            // R-3 — the ledger the Cap page actually reads.
            ok('R-3 re-signing never frees more cap than his old hit',
              ledgerBefore.capUsed - ledgerAfter.capUsed <= oldHit + TOL,
              `${label}: freed ${M(ledgerBefore.capUsed - ledgerAfter.capUsed)} against an old hit of ${M(oldHit)}`);
            ok('R-3 the ledger moves by exactly new hit + accelerated - old hit',
              Math.abs((ledgerAfter.capUsed - ledgerBefore.capUsed)
                - (capHit(after, 'REALISTIC') + (isReplace ? owed : 0) - oldHit)) <= TOL,
              `${label}: moved ${M(ledgerAfter.capUsed - ledgerBefore.capUsed)},`
              + ` expected ${M(capHit(after, 'REALISTIC') + (isReplace ? owed : 0) - oldHit)}`);

            // R-4 — appending carries, it does not accelerate.
            if (!isReplace) {
              ok('R-4 an append books no cap charge — it carries the bonus instead',
                booked.length === 0,
                `${label}: ${booked.length} charge(s) worth ${M(bookedTotal)} on a path that also carries the bonus`);
              ok('R-4 an append really does carry it',
                unamortizedBonus(after, 'REALISTIC') >= owed - TOL,
                `${label}: new row carries ${M(unamortizedBonus(after, 'REALISTIC'))} against ${M(owed)} owed`);
            }

            // R-5 — and nothing is invented on a deal with nothing left owing.
            ok('R-5 no charge when nothing is unamortised',
              owed > 0 || booked.length === 0,
              `${label}: ${booked.length} charge(s) worth ${M(bookedTotal)} against ${M(owed)} owed`);

            // R-6 — filed against the year the club is actually in.
            for (const c of booked) {
              ok('R-6 charge files against the current league year',
                c.year === capChargeYear({ phase: 'RESIGN', week: 1, seasonYear }),
                `${label}: filed ${c.year}, expected ${capChargeYear({ phase: 'RESIGN', week: 1, seasonYear })}`);
            }
          }
        }
      }
    }

    console.log(`  swept ${rounds} shapes — ${replaced} through the replace branch, ${appended} through the append branch,`
      + ` ${withMoney} carrying unamortised bonus, ${withoutMoney} carrying none, ${blocked} cap-blocked`);
    ok('the sweep exercised the branch the exploit lived in', replaced >= 40,
      `only ${replaced} of ${rounds} rounds reached the replace branch — an expired deal is what a walk-year re-sign IS`);

    // -----------------------------------------------------------------------
    // R-6, the other side of the year roll.
    //
    // The RESIGN phase is after RESET_STANDINGS, so the sweep above never
    // exercises the pre-roll window. The library takes no view on phase and
    // the boundary is a real one: a charge filed a year early sits where cap
    // compliance is deliberately not enforced and is then hard-deleted by
    // expireStaleCapCharges without ever being billed to anybody. That is
    // exactly how cuts came to be free, so this is pinned to the same
    // function rather than to a literal.
    // -----------------------------------------------------------------------
    {
      const team = teams[0];
      const seasonYear = league.seasonYear + 100; // a year no round above touched
      const man = subject.get(team.id)!;
      const fresh = buildContract({ apy: 9_000_000, years: 3, signedYear: seasonYear - 3, bonusPct: 0.5, voidYears: 2 });
      await prisma.contract.update({
        where: { playerId: man.id },
        data: {
          years: 3, yearsRemaining: 0, signedYear: seasonYear - 3,
          baseSalaries: JSON.stringify(fresh.baseSalaries), signingBonus: fresh.signingBonus,
          guaranteed: fresh.guaranteed, voidYears: fresh.voidYears, isRookieDeal: false, isFranchiseTag: false,
        },
      });
      const owed = unamortizedBonus(
        await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } }), 'REALISTIC');
      present('R-6 pre-roll unamortised bonus', owed);
      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'OFFSEASON', week: 1 } });
      await extendContract({
        leagueId, playerId: man.id, apy: NEW_APY, years: NEW_YEARS,
        seasonYear, capMode: 'REALISTIC', week: 1,
      });
      const want = capChargeYear({ phase: 'OFFSEASON', week: 1, seasonYear });
      const rows = await prisma.capCharge.findMany({ where: { teamId: team.id, year: want } });
      ok('R-6 pre-roll charge files a year forward',
        owed > 0 && rows.some((r) => Math.abs(r.amount - owed) <= TOL),
        `OFFSEASON wk1: ${M(owed)} owed, looked for it in ${want} and found [${rows.map((r) => M(r.amount)).join(', ')}]`);
      ok('R-6 pre-roll charge is NOT in the year that is ending',
        (await prisma.capCharge.count({ where: { teamId: team.id, year: seasonYear } })) === 0,
        `OFFSEASON wk1: a charge was filed against ${seasonYear}, which expireStaleCapCharges deletes unbilled`);
      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'RESIGN', week: 1 } });
    }

    // -----------------------------------------------------------------------
    // SELF-TEST — can this file report a failure at all?
    // -----------------------------------------------------------------------
    const before = failures;
    // Through variables, not literals: tsc rejects `1_000_000 === 2_000_000`
    // outright, and a check the compiler can fold is not a check.
    const oneMillion: number = 1_000_000;
    const twoMillion: number = 2_000_000;
    ok('SELF-TEST', oneMillion === twoMillion, 'a knowingly false claim — this line must appear');
    const row = { amount: 1 } as { amount: number; ammount?: number };
    // The trap, demonstrated: this comparison is `undefined === undefined`,
    // reports a pass, and tests nothing. Only present() catches it.
    ok('SELF-TEST undefined vs undefined', row.ammount === (undefined as never), 'reads a field that does not exist and passes');
    present('SELF-TEST CapCharge.ammount (misspelled on purpose)', row.ammount);
    const selfTestFailures = failures - before;
    if (selfTestFailures !== 2) {
      console.log(`  FAIL SELF-TEST  the harness produced ${selfTestFailures} failures on two deliberately broken checks — its assertions do not fire`);
      failures = before + 99;
    } else {
      console.log(`  SELF-TEST: two deliberately broken checks reported ${selfTestFailures} failures, as they must.`);
      failures = before;
      checks -= 3;
      shown.delete('SELF-TEST');
    }
  } finally {
    if (leagueId) {
      // CapCharge carries no foreign key (see prisma/schema.prisma), so
      // deleting the league would leave its dead money behind as orphan rows.
      await prisma.capCharge.deleteMany({ where: { teamId: { in: teamIds } } });
      await prisma.league.delete({ where: { id: leagueId } });
      const leftovers = await prisma.capCharge.count({ where: { teamId: { in: teamIds } } })
        + await prisma.player.count({ where: { leagueId } })
        + await prisma.league.count({ where: { id: leagueId } });
      console.log(`  cleanup: ${leftovers} rows left behind by this run.`);
      if (leftovers > 0) failures++;
    }
    await prisma.$disconnect();
  }

  // A sweep that skipped most of itself is a pass that means nothing.
  ok('cap blocks did not eat the sweep', blocked <= rounds / 10,
    `${blocked} of ${rounds} re-signs were cap-blocked — the sweep is measuring too little to gate anything`);

  console.log('');
  console.log(`${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.log(`${failures} FAILED. Rules hit: ${[...shown.entries()].map(([r, n]) => `${r} x${n}`).join(', ')}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
