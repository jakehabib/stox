/**
 * ===========================================================================
 * PERMANENT CHECK — A FIFTH-YEAR OPTION BUYS A YEAR AND MOVES NO OTHER MONEY
 * ===========================================================================
 * INV-21, clause two, on the newest path that rewrites a contract:
 * `exerciseFifthYearOption` appends a fifth season to a four-year rookie deal.
 * That is a one-line write with a trap under it, and the trap is the same one
 * this codebase has now paid for three times.
 *
 * `prorationYears()` is DERIVED FROM `years`. Push a 4-year deal to 5 and the
 * signing bonus silently re-spreads over five seasons — but three of them have
 * already been played and already been billed at a quarter of the bonus each.
 * Measured on pick 1.01's real rookie deal ($15.2M bonus): the seasons played
 * charged $11.4M, years four and five would then charge $3.04M apiece, and the
 * league would have charged $17.5M of cap against $15.2M of cash. $2.28M
 * invented out of a decision that is supposed to buy a year of football.
 *
 * That is exactly the shape of the franchise tag hole (eb7d87b) and the re-sign
 * hole — money conjured or destroyed by a rewrite — arriving through the
 * divisor instead of through a deleted row. So the option year is held OUTSIDE
 * the proration window (`Contract.fifthYearOption`, read by `prorationYears`),
 * which is also the real rule: no new signing bonus is paid for an option year,
 * so it charges its salary and nothing else.
 *
 *   npx tsx scripts/checkFifthYearOption.ts
 *
 * Exits non-zero on any failure. It is a DATABASE harness rather than a clause
 * inside scripts/checkRestructure.ts for the reason checkFranchiseTag.ts is:
 * half of what has to be true here is not a property of the arithmetic at all.
 * "The option year is fully guaranteed" is a claim about what a WRITE stores in
 * `guaranteed`, and `guaranteed` is read by subtracting the bonus back out and
 * filling the years earliest-first — so a write that simply added the option
 * salary to the stored figure would spread it across the seasons he has already
 * played and leave the option year itself holding nothing. A pure check would
 * assert the formula against itself and pass.
 *
 * THE CLAUSES:
 *
 *   O-1  CONSERVATION. Bonus billed to the seasons already played, plus what
 *        still prorates on the row after the option is exercised, equals the
 *        signing bonus actually handed over. INV-21 clause two, about this path.
 *
 *   O-2  THE SEASON IN FRONT OF HIM DOES NOT MOVE. Exercising changes his
 *        fourth-year cap hit by exactly zero. This is the clause the naive
 *        write fails, and it is also why the path calls no `assertCapRoom`:
 *        there is nothing added to the year the ceiling is enforced against.
 *
 *   O-3  THE OPTION YEAR COSTS THE OPTION SALARY, AND NOTHING ELSE. No bonus
 *        proration reaches it, because none was paid for it.
 *
 *   O-4  IT IS A REAL PREMIUM. The option always costs strictly more than his
 *        fourth year. An option priced at or under the season it sits on top of
 *        is a free year, and a free decision is not one.
 *
 *   O-5  ONCE EXERCISED, IT IS GUARANTEED, AND A RELEASE PAYS FOR IT. Driven
 *        through the real `cutPlayer` and read back off the `CapCharge` ledger,
 *        in the fourth year and again inside the option year.
 *
 *   O-6  DECLINING MOVES NOTHING AT ALL. Same hit, same schedule, same dead
 *        money, same every stored field but the answer itself. This is the
 *        cheap-to-state clause, and it is the one that catches a decline path
 *        that quietly rewrites something.
 *
 *   O-7  IT IS ANSWERED ONCE. A second answer, in either direction, is refused
 *        rather than appending a sixth year.
 *
 *   O-8  ROUND ONE ONLY, ENFORCED BY THE WRITE PATH AND NOT ONLY BY THE UI.
 *
 * AND THE HARNESS PROVES IT CAN FAIL, every run: `ok()` is fired at a knowingly
 * false statement and `present()` at a deliberately misspelled field, and the
 * run FAILS if either stays quiet. `undefined === undefined` compares equal and
 * reports success while testing nothing — that trap has already invalidated a
 * cap audit in this repo.
 * ===========================================================================
 */
import { prisma } from '../lib/db';
import { createLeague } from '../lib/gen/league';
import {
  exerciseFifthYearOption, declineFifthYearOption, fifthYearOptionQuote, cutPlayer,
} from '../lib/freeagency';
import {
  buildContract, capHit, capHitSchedule, deadMoneyOnCut, formatMoney, proration, prorationYears,
  unamortizedBonus, positionSalaryBand,
} from '../lib/cap';
import { fifthYearOptionValue, FIFTH_YEAR_OPTION_TIERS } from '../lib/fifthYearOption';
import { CAP } from '../lib/tuning';

/** Integer arithmetic rounds per year; a few dollars is not a defect. */
const TOL = 5;

const M = formatMoney;
let checks = 0;
let failures = 0;
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
 * `row.gaurantee === row.gaurantee` is true, costs nothing to write, and tests
 * nothing at all; every comparison below goes through here first.
 */
function present(label: string, v: unknown): boolean {
  if (v !== undefined && v !== null) return true;
  checks++;
  failures++;
  console.log(`  FAIL read  ${label} came back ${String(v)} — that comparison would have tested nothing`);
  return false;
}

/** The rookie shapes a real draft actually produces, top of round one to bottom. */
const ROOKIE_APYS = [9_500_000, 7_200_000, 6_000_000, 5_000_000, 4_500_000, 4_000_000, 3_500_000];
/**
 * 0.40 is what `rookieDealForPick` actually pays. The rest are here because a
 * conservation check that only ever runs on one bonus shape proves the arithmetic
 * for one bonus shape — and 0 is the case where there is no bonus to conserve at
 * all, which is where a path that charges a fixed fee would hide.
 */
const BONUS_PCTS = [0.4, 0.28, 0.15, 0];

async function main() {
  let leagueId: string | null = null;
  let teamIds: string[] = [];
  try {
    leagueId = await createLeague({
      name: 'INV-21 fifth-year option check', userTeamAbbr: 'ZZZ', seed: 'check-fifth-year-option',
      settings: { capMode: 'REALISTIC' },
    });
    const teams = await prisma.team.findMany({ where: { leagueId }, select: { id: true, abbr: true } });
    teamIds = teams.map((t) => t.id);
    // The option is a RESIGN-window move (the block rule refuses in any other
    // phase), so the sweep runs where the game runs it.
    const league = await prisma.league.update({ where: { id: leagueId }, data: { phase: 'RESIGN', week: 1 } });
    const seasonYear = league.seasonYear;

    /**
     * One man per club, reused across the sweep — his contract is OVERWRITTEN
     * each round rather than a new deal being added, so the club's active
     * salary starts every measurement in the same place. Not the best man on
     * the roster: an option is priced off the position's own market, and
     * repeatedly optioning a club's franchise quarterback runs the cap out of
     * room, which would turn this into a harness that skips what it means to
     * test.
     */
    const subject = new Map<string, { id: string; name: string; position: string }>();
    for (const t of teams) {
      const men = await prisma.player.findMany({
        where: { teamId: t.id, status: 'ACTIVE' }, orderBy: { trueOvr: 'desc' },
        select: { id: true, firstName: true, lastName: true, position: true }, take: 30,
      });
      const man = men[18] ?? men[men.length - 1];
      subject.set(t.id, { id: man.id, name: `${man.firstName} ${man.lastName}`, position: man.position });
    }

    console.log(`league ${leagueId} — ${teams.length} clubs, phase ${league.phase} week 1, season ${seasonYear}\n`);

    /** Put a man back on a fresh, three-seasons-played first-round rookie deal. */
    const seat = async (
      teamId: string, playerId: string, apy: number, bonusPct: number, round = 1,
    ) => {
      const fresh = buildContract({
        apy, years: CAP.ROOKIE_DEAL_YEARS, signedYear: seasonYear - 3, isRookieDeal: true, bonusPct,
      });
      await prisma.player.update({ where: { id: playerId }, data: { draftRound: round, draftPickNo: 5 } });
      await prisma.contract.upsert({
        where: { playerId },
        update: {
          teamId, years: fresh.years, yearsRemaining: 1, signedYear: seasonYear - 3,
          baseSalaries: JSON.stringify(fresh.baseSalaries), signingBonus: fresh.signingBonus,
          guaranteed: fresh.guaranteed, voidYears: 0, isRookieDeal: true, isFranchiseTag: false,
          fifthYearOption: null,
        },
        create: {
          playerId, teamId, years: fresh.years, yearsRemaining: 1, signedYear: seasonYear - 3,
          baseSalaries: JSON.stringify(fresh.baseSalaries), signingBonus: fresh.signingBonus,
          guaranteed: fresh.guaranteed, voidYears: 0, isRookieDeal: true, isFranchiseTag: false,
          fifthYearOption: null,
        },
      });
      return fresh;
    };

    let exercised = 0;
    let declinedRounds = 0;
    const tiersSeen = new Map<string, number>();

    for (const apy of ROOKIE_APYS) {
      for (const bonusPct of BONUS_PCTS) {
        for (const decline of [false, true]) {
          const team = teams[rounds % teams.length];
          rounds++;
          const man = subject.get(team.id)!;
          const fresh = await seat(team.id, man.id, apy, bonusPct);

          const before = await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } });
          present(`${team.abbr} contract.signingBonus`, before.signingBonus);
          present(`${team.abbr} contract.guaranteed`, before.guaranteed);
          present(`${team.abbr} contract.fifthYearOption`, before.fifthYearOption ?? 'null-is-a-value');

          const paid = fresh.signingBonus;
          const billedToPlayed = proration(before) * Math.min(before.years - before.yearsRemaining, prorationYears(before));
          const hitBefore = capHit(before, 'REALISTIC');
          const scheduleBefore = capHitSchedule(before, 'REALISTIC');
          const deadBefore = deadMoneyOnCut(before, 'REALISTIC');

          const quote = await fifthYearOptionQuote({ leagueId, playerId: man.id });
          const label = `${team.abbr} ${M(apy)}/yr bonus ${M(paid)} ${decline ? 'decline' : 'exercise'}`;
          if (!quote) { ok('O-0 a first-rounder on his rookie deal has an option', false, `${label}: quote came back null`); continue; }
          present(`${label} quote.optionSalary`, quote.optionSalary);
          ok('O-0 the option is live in the re-sign window', quote.blocked === null,
            `${label}: blocked with "${quote.blocked}"`);
          tiersSeen.set(quote.tier, (tiersSeen.get(quote.tier) ?? 0) + 1);

          // O-4 — a real premium over the year it sits on top of, or the
          // decision is free. Checked BEFORE the write, on the figure the
          // preview shows and the write charges.
          ok('O-4 the option costs more than his fourth year',
            quote.optionSalary > hitBefore,
            `${label}: option ${M(quote.optionSalary)} against a fourth year of ${M(hitBefore)}`);
          ok('O-4 the option clears the stated floor',
            quote.optionSalary >= Math.round(hitBefore * CAP.FIFTH_YEAR_OPTION_MIN_PREMIUM) - TOL,
            `${label}: option ${M(quote.optionSalary)} against a floor of ${M(Math.round(hitBefore * CAP.FIFTH_YEAR_OPTION_MIN_PREMIUM))}`);

          if (decline) {
            await declineFifthYearOption({ leagueId, playerId: man.id, seasonYear, week: 1 });
            declinedRounds++;
            const after = await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } });
            present(`${label} after.years`, after.years);

            // O-6 — nothing moves. Field for field, deliberately: a check aimed
            // at the one field a bad write would touch would pass the next one.
            ok('O-6 declining changes no contract field but the answer',
              after.years === before.years
              && after.yearsRemaining === before.yearsRemaining
              && after.signedYear === before.signedYear
              && after.baseSalaries === before.baseSalaries
              && after.signingBonus === before.signingBonus
              && after.guaranteed === before.guaranteed
              && after.voidYears === before.voidYears
              && after.isRookieDeal === before.isRookieDeal,
              `${label}: ${JSON.stringify({ years: after.years, rem: after.yearsRemaining, bonus: after.signingBonus, gtd: after.guaranteed })}`);
            ok('O-6 declining records the answer', after.fifthYearOption === 'DECLINED',
              `${label}: stored ${String(after.fifthYearOption)}`);
            ok('O-6 declining changes no cap figure',
              capHit(after, 'REALISTIC') === hitBefore
              && deadMoneyOnCut(after, 'REALISTIC') === deadBefore
              && JSON.stringify(capHitSchedule(after, 'REALISTIC')) === JSON.stringify(scheduleBefore),
              `${label}: hit ${M(capHit(after, 'REALISTIC'))} vs ${M(hitBefore)}, dead ${M(deadMoneyOnCut(after, 'REALISTIC'))} vs ${M(deadBefore)}`);

            // O-7 — and it is answered. Both directions refused.
            const second = await exerciseFifthYearOption({ leagueId, playerId: man.id, seasonYear, capMode: 'REALISTIC', week: 1 })
              .then(() => 'accepted').catch(() => 'refused');
            ok('O-7 an answered option is refused a second answer', second === 'refused',
              `${label}: exercising after a decline was ${second}`);
            continue;
          }

          const result = await exerciseFifthYearOption({ leagueId, playerId: man.id, seasonYear, capMode: 'REALISTIC', week: 1 });
          exercised++;
          const after = await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } });
          present(`${label} after.baseSalaries`, after.baseSalaries);
          present(`${label} after.guaranteed`, after.guaranteed);

          ok('O-0 the write charges the price the quote showed',
            Math.abs(result.optionSalary - quote.optionSalary) <= TOL,
            `${label}: wrote ${M(result.optionSalary)}, quoted ${M(quote.optionSalary)}`);

          // O-1 — nothing paid goes uncharged, and nothing is charged twice.
          const everCharged = billedToPlayed + unamortizedBonus(after, 'REALISTIC');
          ok('O-1 total charged equals bonus paid', Math.abs(everCharged - paid) <= TOL * 5,
            `${label}: charged ${M(everCharged)} against ${M(paid)} paid`);
          ok('O-1 the option adds no signing bonus', after.signingBonus === before.signingBonus,
            `${label}: bonus ${M(after.signingBonus)} was ${M(before.signingBonus)}`);
          ok('O-1 the proration window does not widen',
            prorationYears(after) === prorationYears(before),
            `${label}: window ${prorationYears(after)} was ${prorationYears(before)}`);

          // O-2 — the season the cap gate is actually enforcing does not move.
          const hitAfter = capHit(after, 'REALISTIC');
          ok('O-2 his fourth-year cap hit is unchanged to the dollar', hitAfter === hitBefore,
            `${label}: ${M(hitAfter)} was ${M(hitBefore)}`);

          // O-3 — and the year it bought costs exactly what it was sold for.
          const scheduleAfter = capHitSchedule(after, 'REALISTIC');
          ok('O-3 the schedule grows by exactly one year', scheduleAfter.length === scheduleBefore.length + 1,
            `${label}: ${scheduleBefore.length} -> ${scheduleAfter.length} years`);
          ok('O-3 the option year costs the option salary and no proration',
            Math.abs(scheduleAfter[scheduleAfter.length - 1] - result.optionSalary) <= TOL,
            `${label}: option year charges ${M(scheduleAfter[scheduleAfter.length - 1])} against a salary of ${M(result.optionSalary)}`);

          // O-5 — the year is guaranteed, and a release pays for it. Through the
          // real cut path, read back off the ledger the Cap page renders.
          const deadFourth = deadMoneyOnCut(after, 'REALISTIC');
          ok('O-5 releasing him now owes the option year in full',
            deadFourth >= result.optionSalary - TOL,
            `${label}: dead ${M(deadFourth)} against a guaranteed option year of ${M(result.optionSalary)}`);
          ok('O-5 and it owes more than declining would have',
            deadFourth > deadBefore,
            `${label}: dead ${M(deadFourth)} after, ${M(deadBefore)} before`);

          // Inside the option year itself: age the ledger one season the way
          // the offseason roll does, and the bonus is gone but the salary is not.
          await prisma.contract.update({ where: { playerId: man.id }, data: { yearsRemaining: 1 } });
          const inOptionYear = await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } });
          ok('O-5 in the option year the bonus is fully amortised',
            unamortizedBonus(inOptionYear, 'REALISTIC') === 0,
            `${label}: ${M(unamortizedBonus(inOptionYear, 'REALISTIC'))} still prorating`);
          const deadInOption = deadMoneyOnCut(inOptionYear, 'REALISTIC');
          ok('O-5 in the option year a release owes exactly the option salary',
            Math.abs(deadInOption - result.optionSalary) <= TOL,
            `${label}: dead ${M(deadInOption)} against ${M(result.optionSalary)}`);

          const chargesBefore = new Set(
            (await prisma.capCharge.findMany({ where: { teamId: team.id }, select: { id: true } })).map((c) => c.id),
          );
          await cutPlayer({ leagueId, playerId: man.id, capMode: 'REALISTIC', seasonYear, week: 1 });
          const booked = (await prisma.capCharge.findMany({ where: { teamId: team.id } }))
            .filter((c) => !chargesBefore.has(c.id));
          for (const c of booked) present(`${label} CapCharge.amount`, c.amount);
          const bookedTotal = booked.reduce((a, c) => a + c.amount, 0);
          ok('O-5 the ledger is charged what the release costs',
            Math.abs(bookedTotal - deadInOption) <= TOL,
            `${label}: ledger ${M(bookedTotal)}, expected ${M(deadInOption)}`);

          // Put him back for the next round — he has just been released.
          await prisma.player.update({ where: { id: man.id }, data: { teamId: team.id, status: 'ACTIVE' } });
        }
      }
    }

    console.log(`  swept ${rounds} shapes — ${exercised} exercised, ${declinedRounds} declined`);
    console.log(`  tiers reached: ${[...tiersSeen.entries()].map(([t, n]) => `${t} x${n}`).join(', ') || 'none'}`);

    // -----------------------------------------------------------------------
    // O-10 — THE ALL-STAR TIER IS REACHABLE, AND IT IS THE TAG NUMBER.
    //
    // The sweep above never reaches it: a generated league's subjects have no
    // All-Star rows inside their rookie years, so every one of them prices as a
    // starter or below. A tier that is only ever proved by its own arithmetic
    // (O-9) is a tier nothing has shown the RESOLVER can select — so this writes
    // the honour the way lib/allStars.ts writes it and asks the real quote.
    //
    // IT HUNTS FOR A CLUB WHOSE PRICE IS SET BY THE BAND rather than taking the
    // first one. At a thin position both tiers clamp to the same floor
    // (CAP.FIFTH_YEAR_OPTION_MIN_PREMIUM), so "the honour costs more" is not
    // true there and asserting it on whichever club came first made this clause
    // pass or fail on which position a generated roster's 19th man happened to
    // play — measured, it failed on exactly that. A harness that cannot find a
    // band-priced club FAILS rather than skipping, so this cannot go quiet.
    // -----------------------------------------------------------------------
    {
      let found: { team: (typeof teams)[number]; man: { id: string; name: string; position: string }; plain: number } | null = null;
      for (const team of teams) {
        const man = subject.get(team.id)!;
        await seat(team.id, man.id, 9_500_000, 0.4);
        const plain = await fifthYearOptionQuote({ leagueId, playerId: man.id });
        if (!plain) continue;
        const floor = Math.round(plain.fourthYearHit * CAP.FIFTH_YEAR_OPTION_MIN_PREMIUM);
        // Band-priced AND not already decorated by the league's own history,
        // which would leave nothing for the honour below to change.
        if (plain.optionSalary > floor && plain.tier !== 'ALL_STAR') {
          found = { team, man, plain: plain.optionSalary };
          break;
        }
      }
      ok('O-10 a band-priced club exists to test the honour on', found !== null,
        'every club priced off the floor — this clause would have proved nothing');
      if (found) {
        await prisma.transaction.create({
          data: {
            leagueId, seasonYear: seasonYear - 2, week: 18, type: 'ALL_STAR', teamId: found.team.id,
            playerId: found.man.id, headline: `${found.man.name} (${found.man.position})`, detail: 'a season that earned it',
          },
        });
        const starred = await fifthYearOptionQuote({ leagueId, playerId: found.man.id });
        present('O-10 quote.tier', starred?.tier);
        ok('O-10 an All-Star inside his rookie years reaches the top tier',
          starred?.tier === 'ALL_STAR', `tier came back ${String(starred?.tier)}`);
        ok('O-10 and it costs strictly more than it did without the honour',
          (starred?.optionSalary ?? 0) > found.plain,
          `${M(starred?.optionSalary ?? 0)} with the selection, ${M(found.plain)} without`);

        // ...and an honour won OUTSIDE the deal does not price it. A veteran
        // traded onto a rookie contract must not carry an All-Star season from
        // five years and another club ago into this option.
        await prisma.transaction.updateMany({
          where: { leagueId, playerId: found.man.id, type: 'ALL_STAR' },
          data: { seasonYear: seasonYear - 10 },
        });
        const outside = await fifthYearOptionQuote({ leagueId, playerId: found.man.id });
        ok('O-10 an honour won outside this contract does not price it',
          outside?.tier !== 'ALL_STAR' && (outside?.optionSalary ?? 0) === found.plain,
          `tier ${String(outside?.tier)} at ${M(outside?.optionSalary ?? 0)}, against ${M(found.plain)}`);
        await prisma.transaction.deleteMany({ where: { leagueId, playerId: found.man.id, type: 'ALL_STAR' } });
      }
    }

    // -----------------------------------------------------------------------
    // O-11 — A RESTRUCTURED ROOKIE DEAL STILL CONSERVES.
    //
    // A GM may restructure a rookie contract, which REBASES it onto the years
    // that are left and rewrites the signing bonus to the unamortised figure.
    // That is a second rewrite stacked on the one this file exists for, and the
    // two have to compose: the option year still buys no bonus, and the money
    // already handed over is still charged exactly once.
    // -----------------------------------------------------------------------
    {
      const { restructureContract } = await import('../lib/freeagency');
      const team = teams[2];
      const man = subject.get(team.id)!;
      // Two years left rather than one, because a restructure needs a future to
      // push money into — this is the shape a real GM would actually produce.
      const fresh = await seat(team.id, man.id, 9_500_000, 0.4);
      await prisma.contract.update({ where: { playerId: man.id }, data: { yearsRemaining: 2 } });
      const paid = fresh.signingBonus;
      const beforeR = await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } });
      const billedBeforeR = proration(beforeR) * Math.min(beforeR.years - beforeR.yearsRemaining, prorationYears(beforeR));
      await restructureContract({
        leagueId, playerId: man.id, convertAmount: 1_000_000,
        seasonYear, capMode: 'REALISTIC', week: 1,
      });
      // Age it into the option window the way the offseason roll does.
      await prisma.contract.update({ where: { playerId: man.id }, data: { yearsRemaining: 1 } });
      const rebased = await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } });
      present('O-11 rebased.signingBonus', rebased.signingBonus);
      const billedRebased = proration(rebased) * Math.min(rebased.years - rebased.yearsRemaining, prorationYears(rebased));
      const q = await fifthYearOptionQuote({ leagueId, playerId: man.id });
      ok('O-11 a restructured rookie deal still carries its option', q !== null && q.blocked === null,
        `quote ${q ? `blocked "${q.blocked}"` : 'came back null'}`);
      const hitBeforeR = capHit(rebased, 'REALISTIC');
      await exerciseFifthYearOption({ leagueId, playerId: man.id, seasonYear, capMode: 'REALISTIC', week: 1 });
      const afterR = await prisma.contract.findUniqueOrThrow({ where: { playerId: man.id } });
      ok('O-11 the restructured deal\'s fourth year is unchanged by the option',
        capHit(afterR, 'REALISTIC') === hitBeforeR,
        `${M(capHit(afterR, 'REALISTIC'))} was ${M(hitBeforeR)}`);
      // The bonus paid, billed in three places: the seasons played on the
      // ORIGINAL deal, the seasons played on the rebased one, and what is still
      // prorating now. The conversion is cash the club also handed over, so it
      // joins what was paid.
      const converted = rebased.signingBonus - unamortizedBonus(beforeR, 'REALISTIC');
      const everCharged = billedBeforeR + billedRebased + unamortizedBonus(afterR, 'REALISTIC');
      ok('O-11 total charged still equals money paid',
        Math.abs(everCharged - (paid + converted)) <= TOL * 6,
        `charged ${M(everCharged)} against ${M(paid + converted)} paid`);
    }

    // -----------------------------------------------------------------------
    // O-8 — ROUND ONE ONLY, AND THE WRITE PATH SAYS SO.
    //
    // The card never draws a control for a second-rounder, but a Server Action
    // is a POST endpoint whether or not a button points at it, and this one
    // appends a guaranteed year to a contract. A rule only the UI holds is not
    // a rule.
    // -----------------------------------------------------------------------
    {
      const team = teams[0];
      const man = subject.get(team.id)!;
      await seat(team.id, man.id, 4_000_000, 0.28, 2);
      const quote = await fifthYearOptionQuote({ leagueId, playerId: man.id });
      ok('O-8 a second-round pick has no option at all', quote === null,
        `a round-2 pick came back with ${quote ? `a ${M(quote.optionSalary)} option` : 'null'}`);
      const attempt = await exerciseFifthYearOption({ leagueId, playerId: man.id, seasonYear, capMode: 'REALISTIC', week: 1 })
        .then(() => 'accepted').catch(() => 'refused');
      ok('O-8 and the write path refuses him', attempt === 'refused',
        `exercising a round-2 pick's option was ${attempt}`);
    }

    // -----------------------------------------------------------------------
    // O-9 — THE TIERS ARE ORDERED, AND THEY ARE THE REAL CBA'S BANDS.
    //
    // Pure arithmetic, so it does not need the database — but it belongs here
    // rather than in checkRestructure.ts, because it is about THIS feature's
    // price and a reader chasing a wrong option number should find every clause
    // about it in one file.
    // -----------------------------------------------------------------------
    {
      const market = Array.from({ length: 40 }, (_, i) => 30_000_000 - i * 700_000);
      const priced = (tier: 'ALL_STAR' | 'STARTER' | 'BASE') =>
        fifthYearOptionValue({ positionSalaries: market, tier, fourthYearHit: 1_000_000 });
      ok('O-9 an All-Star option costs at least a starter\'s', priced('ALL_STAR') >= priced('STARTER'),
        `all-star ${M(priced('ALL_STAR'))} vs starter ${M(priced('STARTER'))}`);
      ok('O-9 a starter\'s option costs at least the base tier\'s', priced('STARTER') >= priced('BASE'),
        `starter ${M(priced('STARTER'))} vs base ${M(priced('BASE'))}`);
      ok('O-9 the All-Star tier IS the franchise tag band',
        priced('ALL_STAR') === positionSalaryBand(market, 1, CAP.FRANCHISE_TAG_TOP_N),
        `${M(priced('ALL_STAR'))} vs tag ${M(positionSalaryBand(market, 1, CAP.FRANCHISE_TAG_TOP_N))}`);
      ok('O-9 the base tier is the 3rd-through-20th band',
        FIFTH_YEAR_OPTION_TIERS.BASE.from === 3 && FIFTH_YEAR_OPTION_TIERS.BASE.to === 20,
        `base band is ${FIFTH_YEAR_OPTION_TIERS.BASE.from}-${FIFTH_YEAR_OPTION_TIERS.BASE.to}`);
      // The floor, exercised on its own so it cannot pass by never binding.
      const thin = [2_000_000, 1_800_000, 1_500_000];
      ok('O-9 the floor binds where the position pays nothing',
        fifthYearOptionValue({ positionSalaries: thin, tier: 'BASE', fourthYearHit: 8_000_000 })
          === Math.round(8_000_000 * CAP.FIFTH_YEAR_OPTION_MIN_PREMIUM),
        `thin position priced at ${M(fifthYearOptionValue({ positionSalaries: thin, tier: 'BASE', fourthYearHit: 8_000_000 }))}`);
    }

    // -----------------------------------------------------------------------
    // SELF-TEST — can this file report a failure at all?
    //
    // A harness whose assertions cannot fire is worse than no harness: it is a
    // green tick over untested code.
    // -----------------------------------------------------------------------
    const before = failures;
    // Through variables, not literals: tsc rejects `1_000_000 === 2_000_000`
    // outright, and a check the compiler can fold is not a check.
    const oneMillion: number = 1_000_000;
    const twoMillion: number = 2_000_000;
    ok('SELF-TEST', oneMillion === twoMillion, 'a knowingly false claim — this line must appear');
    const row = { guaranteed: 1 } as { guaranteed: number; gaurantee?: number };
    // The trap, demonstrated: this comparison is `undefined === undefined`,
    // reports a pass, and tests nothing. Only present() catches it.
    ok('SELF-TEST undefined vs undefined', row.gaurantee === (undefined as never), 'reads a field that does not exist and passes');
    present('SELF-TEST Contract.gaurantee (misspelled on purpose)', row.gaurantee);
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
      // CapCharge cascades from Team, and deleting the league cascades into
      // Team — but the charges are deleted explicitly anyway, so a run against
      // a database whose constraint predates 20260823124600 still cleans up.
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

  console.log('');
  console.log(`${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.log(`${failures} FAILED. Rules hit: ${[...shown.entries()].map(([r, n]) => `${r} x${n}`).join(', ')}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
