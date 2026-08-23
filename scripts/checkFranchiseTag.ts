/**
 * ===========================================================================
 * PERMANENT CHECK — A FRANCHISE TAG DOES NOT RETIRE THE OLD DEAL'S BILL
 * ===========================================================================
 * INV-21, clause two: TOTAL CHARGED EQUALS MONEY PAID. Every dollar of signing
 * bonus a club has handed over is charged to some cap, in some year, exactly
 * once — however the contract is later rewritten. `scripts/checkRestructure.ts`
 * gates that clause for `restructureContract` and `buildExtension`.
 * `applyFranchiseTag` breaks it in a way that harness structurally cannot see,
 * which is why this is a sibling rather than another block in that file:
 *
 *   checkRestructure.ts is PURE ARITHMETIC. It imports lib/cap.ts and
 *   lib/tuning.ts and nothing else, never opens a database, and sweeps 55k
 *   contract shapes in under a second. That is the right shape for a defect
 *   that lives in the arithmetic — the restructure bug was `signingBonus`
 *   where `unamortizedBonus` belonged, one wrong line in a pure function.
 *
 *   The tag defect was never in the arithmetic. `unamortizedBonus()` returned
 *   the correct figure the whole time. `applyFranchiseTag` simply deleted the
 *   contract row and wrote no CapCharge, so the money the arithmetic had
 *   correctly identified was never charged to anybody. A pure-arithmetic
 *   clause could not have caught that and cannot catch it coming back: it
 *   would assert a formula against itself and pass while testing nothing.
 *
 * So this one drives the REAL `applyFranchiseTag`, against a REAL database, on
 * a league it builds and then destroys, and reads the CapCharge rows back off
 * the ledger. Run with:
 *
 *   npx tsx scripts/checkFranchiseTag.ts
 *
 * Exits non-zero on any failure, so it gates a change the way a real test
 * suite would. Shape of the file follows scripts/checkNegotiationAgreement.ts,
 * which is this project's other database-backed permanent check.
 *
 * WHAT WAS MEASURED BEFORE THE FIX, in the Re-sign window, cap REALISTIC:
 *
 *   3yr + 2 void, fully played, $12.0M bonus. $7.20M billed to the seasons he
 *   played, $4.80M still owed. Tagged at $17.1M: committed cap moved $5.70M
 *   instead of $10.5M, no CapCharge row was written, and $4.80M of paid bonus
 *   was never charged to anyone.
 *
 *   5yr, two played, $25.0M bonus, a $25.0M cap hit. Tagged at $11.5M the
 *   club's committed cap FELL by $13.5M. The tag was cap RELIEF.
 *
 * The clauses:
 *
 *   F-1  CONSERVATION. Bonus billed to the seasons already played, plus what
 *        the tag books as dead money, plus whatever still prorates on the row
 *        that replaced it, equals the signing bonus actually handed over. This
 *        is INV-21 clause two, stated about the tag.
 *
 *   F-2  THE TAG COSTS THE TAG VALUE, and no more. `franchiseTagValue()` is an
 *        average of the top-N `capHit()`s at the position, so a tag row
 *        carrying a legacy bonus inside its own hit would price the next tag
 *        at that position off it — the tag would inflate itself. The
 *        acceleration belongs in the dead-money column, not in his cap hit.
 *
 *   F-3  THE LEDGER MOVES BY EXACTLY tagValue + accelerated - oldHit. Read off
 *        `teamCapSummary`, which is what the Cap page and every cap gate read,
 *        rather than recomputed. This is the clause the exploit failed: it is
 *        what says tagging a bonus-heavy deal is not a way to shed it.
 *
 *   F-4  THE SAME BONUS A CUT WOULD ACCELERATE. The figure the tag books is
 *        `unamortizedBonus`, the identical number `deadMoneyOnCut` and
 *        `tradeCapEffect` accelerate. Three ways off a contract, one answer
 *        about the bonus — the asymmetry between them is deliberate and is
 *        about GUARANTEED SALARY, never about the bonus.
 *
 *   F-5  NOTHING IS INVENTED EITHER. A deal with no unamortised bonus left —
 *        which is most of them — books no charge at all. A conservation check
 *        that only ever runs on shapes with money in them would pass a path
 *        that charged every tag a fixed fee.
 *
 *   F-6  THE CHARGE FILES AGAINST THE YEAR THE CLUB IS ACTUALLY IN.
 *        `capChargeYear()` (lib/cap.ts) answers that, and the answer differs
 *        either side of the offseason year roll. A tag is a RESIGN-window
 *        move, after the roll, so it files against the league year just
 *        opened; the same call made in the pre-roll OFFSEASON window has to
 *        file a year forward or `expireStaleCapCharges` deletes it two steps
 *        later without anybody ever being charged. Both are exercised.
 *
 * AND THE HARNESS PROVES IT CAN FAIL, every run. A check that reads a field
 * that is not there compares `undefined` to `undefined` and reports success
 * while testing nothing — a mistake already made in this repo. So `ok()` is
 * fired at a knowingly false statement at the end, and the run FAILS if that
 * does not produce a failure, plus every figure read off the database goes
 * through `present()` before it is compared.
 * ===========================================================================
 */
import { prisma } from '../lib/db';
import { createLeague } from '../lib/gen/league';
import { applyFranchiseTag } from '../lib/freeagency';
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

/**
 * A figure read out of the database is only evidence if it is actually there.
 * `row.ammount === row.ammount` is true, costs nothing to write, and tests
 * nothing at all; every comparison below goes through here first.
 */
function present(label: string, v: unknown): boolean {
  if (v !== undefined && v !== null) return true;
  checks++;
  failures++;
  console.log(`  FAIL read  ${label} came back ${String(v)} — that comparison would have tested nothing`);
  return false;
}

const YEARS = [1, 2, 3, 4, 5, 7];
const BONUS_PCTS = [0, 0.12, 0.28, 0.5];
const VOIDS = [0, 1, 2, 3];
/** Seasons already played, INCLUDING the one that ends with the deal run out. */
const playedFor = (years: number) =>
  years <= 4 ? Array.from({ length: years + 1 }, (_, i) => i) : [0, 2, years];

async function main() {
  let leagueId: string | null = null;
  let teamIds: string[] = [];
  try {
    leagueId = await createLeague({
      name: 'INV-21 franchise tag check', userTeamAbbr: 'ZZZ', seed: 'check-franchise-tag',
      settings: { capMode: 'REALISTIC', franchiseTagEnabled: true },
    });
    const teams = await prisma.team.findMany({ where: { leagueId }, select: { id: true, abbr: true } });
    teamIds = teams.map((t) => t.id);
    // The tag is a Re-sign window move (applyFranchiseTagAction refuses in any
    // other phase), so the sweep runs where the game runs it.
    const league = await prisma.league.update({ where: { id: leagueId }, data: { phase: 'RESIGN', week: 1 } });

    /**
     * One man per club, reused across the sweep. Reusing him means his contract
     * is OVERWRITTEN each round rather than a new deal being added, so the
     * club's active salary stays where it started and each measurement begins
     * from the same place. Not the best player on the roster: the tag is an
     * average of the top five hits at his position, and tagging a club's
     * franchise quarterback every round runs the cap out of room, which would
     * turn this into a harness that skips everything it means to test.
     */
    const subject = new Map<string, { id: string; name: string; position: string }>();
    for (const t of teams) {
      const men = await prisma.player.findMany({
        where: { teamId: t.id, status: 'ACTIVE' }, orderBy: { trueOvr: 'desc' },
        select: { id: true, firstName: true, lastName: true, position: true }, take: 30,
      });
      const man = men[20] ?? men[men.length - 1];
      subject.set(t.id, { id: man.id, name: `${man.firstName} ${man.lastName}`, position: man.position });
    }

    console.log(`league ${leagueId} — ${teams.length} clubs, phase ${league.phase} week 1, season ${league.seasonYear}\n`);

    let withMoney = 0;
    let withoutMoney = 0;

    for (const years of YEARS) {
      for (const bonusPct of BONUS_PCTS) {
        for (const voidYears of VOIDS) {
          for (const played of playedFor(years)) {
            const team = teams[rounds % teams.length];
            // A fresh league YEAR every time the clubs come back round: one tag
            // per club per year is the rule the path enforces, and working
            // around it by clearing the flag would be testing a state the game
            // cannot produce.
            const seasonYear = league.seasonYear + Math.floor(rounds / teams.length);
            rounds++;

            const man = subject.get(team.id)!;
            const fresh = buildContract({ apy: 9_000_000, years, signedYear: seasonYear - played, bonusPct, voidYears });
            await prisma.contract.upsert({
              where: { playerId: man.id },
              update: {
                teamId: team.id,
                years: fresh.years, yearsRemaining: fresh.years - played, signedYear: seasonYear - played,
                baseSalaries: JSON.stringify(fresh.baseSalaries), signingBonus: fresh.signingBonus,
                guaranteed: fresh.guaranteed, voidYears: fresh.voidYears,
                isRookieDeal: false, isFranchiseTag: false,
              },
              create: {
                playerId: man.id, teamId: team.id,
                years: fresh.years, yearsRemaining: fresh.years - played, signedYear: seasonYear - played,
                baseSalaries: JSON.stringify(fresh.baseSalaries), signingBonus: fresh.signingBonus,
                guaranteed: fresh.guaranteed, voidYears: fresh.voidYears,
                isRookieDeal: false, isFranchiseTag: false,
              },
            });

            const before = await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } });
            const label = `${team.abbr} ${years}yr+${fresh.voidYears}v bonus ${M(fresh.signingBonus)} played ${played}`;
            const paid = fresh.signingBonus;
            const billedToPlayedSeasons = proration(before) * Math.min(before.years - before.yearsRemaining, prorationYears(before));
            const owed = unamortizedBonus(before, 'REALISTIC');
            const oldHit = capHit(before, 'REALISTIC');

            const ledgerBefore = await teamCapSummary(team.id, seasonYear, 'REALISTIC');
            const chargeIdsBefore = new Set(
              (await prisma.capCharge.findMany({ where: { teamId: team.id, year: seasonYear }, select: { id: true } })).map((c) => c.id),
            );

            let tagValue: number;
            let deadMoney: number;
            try {
              ({ tagValue, deadMoney } = await applyFranchiseTag({
                leagueId, playerId: man.id, seasonYear, capMode: 'REALISTIC', week: 1,
              }));
            } catch (err) {
              // A club that genuinely cannot afford the tag is a legal outcome,
              // not a failure — but a run that skips most of its sweep is
              // testing nothing, so the count is asserted at the end.
              if (err instanceof CapViolationError) { blocked++; continue; }
              throw err;
            }

            const after = await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } });
            const ledgerAfter = await teamCapSummary(team.id, seasonYear, 'REALISTIC');
            const booked = (await prisma.capCharge.findMany({ where: { teamId: team.id, year: seasonYear } }))
              .filter((c) => !chargeIdsBefore.has(c.id));
            const bookedTotal = booked.reduce((a, c) => a + c.amount, 0);

            for (const c of booked) { present(`${label} CapCharge.amount`, c.amount); present(`${label} CapCharge.year`, c.year); }
            present(`${label} contract.signingBonus`, after.signingBonus);
            present(`${label} ledger.capUsed`, ledgerAfter.capUsed);

            if (owed > 0) withMoney++; else withoutMoney++;

            // F-1 — nothing paid goes uncharged, and nothing is charged twice.
            const everCharged = billedToPlayedSeasons + bookedTotal + unamortizedBonus(after, 'REALISTIC');
            ok('F-1 total charged equals bonus paid', Math.abs(everCharged - paid) <= TOL * (years + 1),
              `${label}: charged ${M(everCharged)} against ${M(paid)} paid`);

            // F-2 — the tag row is the tag, and nothing else.
            ok('F-2 tag row costs the tag value', Math.abs(capHit(after, 'REALISTIC') - tagValue) <= TOL,
              `${label}: hit ${M(capHit(after, 'REALISTIC'))} vs tag ${M(tagValue)}`);
            ok('F-2 tag row carries no bonus', after.signingBonus === 0,
              `${label}: tag row bonus ${M(after.signingBonus)}`);

            // F-3 — the ledger the Cap page reads moved by exactly the right amount.
            ok('F-3 ledger moves by tag + accelerated - old hit',
              Math.abs((ledgerAfter.capUsed - ledgerBefore.capUsed) - (tagValue + owed - oldHit)) <= TOL,
              `${label}: moved ${M(ledgerAfter.capUsed - ledgerBefore.capUsed)}, expected ${M(tagValue + owed - oldHit)}`);
            ok('F-3 tagging never frees more than his old hit',
              ledgerBefore.capUsed - ledgerAfter.capUsed <= oldHit + TOL,
              `${label}: freed ${M(ledgerBefore.capUsed - ledgerAfter.capUsed)} against an old hit of ${M(oldHit)}`);

            // F-4 — the same bonus a release or a trade would accelerate.
            ok('F-4 books the bonus a cut would accelerate', Math.abs(deadMoney - owed) <= TOL,
              `${label}: booked ${M(deadMoney)} vs unamortised ${M(owed)}`);
            ok('F-4 never more than a cut would cost', deadMoney <= deadMoneyOnCut(before, 'REALISTIC') + TOL,
              `${label}: tag ${M(deadMoney)} vs cut ${M(deadMoneyOnCut(before, 'REALISTIC'))}`);
            ok('F-4 the row on the ledger is the figure reported',
              Math.abs(bookedTotal - deadMoney) <= TOL,
              `${label}: ledger ${M(bookedTotal)}, reported ${M(deadMoney)}`);

            // F-5 — and nothing is invented on a deal with nothing left owing.
            ok('F-5 no charge when nothing is unamortised', owed > 0 || booked.length === 0,
              `${label}: ${booked.length} charge(s) worth ${M(bookedTotal)} against ${M(owed)} owed`);

            // F-6 — filed against the year the club is actually in.
            for (const c of booked) {
              ok('F-6 charge files against the current league year',
                c.year === capChargeYear({ phase: 'RESIGN', week: 1, seasonYear }),
                `${label}: filed ${c.year}, expected ${capChargeYear({ phase: 'RESIGN', week: 1, seasonYear })}`);
            }
          }
        }
      }
    }

    console.log(`  swept ${rounds} shapes — ${withMoney} carrying unamortised bonus, ${withoutMoney} carrying none, ${blocked} cap-blocked`);

    // -----------------------------------------------------------------------
    // F-6, the other side of the year roll.
    //
    // `applyFranchiseTagAction` only lets a tag through in RESIGN, which is
    // after RESET_STANDINGS, so the sweep above never exercises the pre-roll
    // window. The library takes no view on phase and the boundary is a real
    // one: a charge filed a year early sits in a window where compliance is
    // deliberately not enforced and is then hard-deleted by
    // expireStaleCapCharges without ever being charged to anybody. That is
    // exactly how cuts came to be free, so the tag is pinned to the same
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
      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'OFFSEASON', week: 1 } });
      const { deadMoney } = await applyFranchiseTag({ leagueId, playerId: man.id, seasonYear, capMode: 'REALISTIC', week: 1 });
      const want = capChargeYear({ phase: 'OFFSEASON', week: 1, seasonYear });
      const rows = await prisma.capCharge.findMany({ where: { teamId: team.id, year: want } });
      ok('F-6 pre-roll charge files a year forward', deadMoney > 0 && rows.some((r) => Math.abs(r.amount - deadMoney) <= TOL),
        `OFFSEASON wk1: booked ${M(deadMoney)}, looked for it in ${want} and found [${rows.map((r) => M(r.amount)).join(', ')}]`);
      ok('F-6 pre-roll charge is NOT in the year that is ending',
        (await prisma.capCharge.count({ where: { teamId: team.id, year: seasonYear } })) === 0,
        `OFFSEASON wk1: a charge was filed against ${seasonYear}, which expireStaleCapCharges deletes unbilled`);
      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'RESIGN', week: 1 } });
    }

    // -----------------------------------------------------------------------
    // SELF-TEST — can this file report a failure at all?
    //
    // A harness whose assertions cannot fire is worse than no harness: it is a
    // green tick over untested code. `ok()` is pointed at a statement that is
    // false, and `present()` at a field that does not exist, and the run fails
    // if either of them stays quiet.
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
      shown.delete('SELF-TEST'); // it did its job; it is not a rule this run broke
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
    `${blocked} of ${rounds} tags were cap-blocked — the sweep is measuring too little to gate anything`);

  console.log('');
  console.log(`${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.log(`${failures} FAILED. Rules hit: ${[...shown.entries()].map(([r, n]) => `${r} x${n}`).join(', ')}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
