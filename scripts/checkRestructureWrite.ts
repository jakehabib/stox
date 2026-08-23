/**
 * ===========================================================================
 * PERMANENT CHECK — THE ROW STORED IS THE RESTRUCTURE THAT WAS COMPUTED
 * ===========================================================================
 * The database sibling to scripts/checkRestructure.ts, on exactly the footing
 * scripts/checkFranchiseTag.ts is the database sibling for the tag. That file
 * is pure arithmetic and says so in its own header: 55,683 checks in under a
 * second, and blind by construction to a defect that never touches the
 * arithmetic. This is that defect.
 *
 *   `restructureContract` (lib/freeagency.ts) wrote `years`, `yearsRemaining`,
 *   `signedYear`, `baseSalaries`, `signingBonus` and `voidYears` — and dropped
 *   `guaranteed`, which the pure function had computed correctly all along.
 *   Measured on one contract: stored $45.0M against a computed $28.7M, and
 *   dead-money-on-cut moved from $28.7M to $45.0M. $16.3M invented out of an
 *   accounting move, and demanded back off the club on the player's behalf.
 *
 * It was not live, and that is the interesting part. `restructureContractAction`
 * patched `guaranteed` back in a SECOND write, outside the library's
 * transaction, and was the only caller — so the game was correct and the
 * library was not. Every new caller reintroduced it in full, and a failure
 * between the two writes left a row broken in exactly this way with nothing
 * on any screen to say so. checkRestructure could not see it. A test of the
 * ACTION could not see it either, because the action was the thing hiding it.
 *
 * So the assertion here is deliberately not "guaranteed is right". It is:
 *
 *   W-1  EVERY FIELD THE PURE FUNCTION COMPUTES IS THE FIELD THAT IS STORED.
 *        Field for field, off the row read back out of the database, against
 *        the same call the library made. A check written against the one field
 *        that was dropped would pass the next drop.
 *
 *   W-2  THE CONSEQUENCE, NOT JUST THE FIELD. `guaranteed` is only ever read
 *        by subtracting the bonus back out (guaranteedBaseByYear, lib/cap.ts),
 *        so the figure that actually reaches a GM is the dead money on a cut.
 *        Asserted against the pure function's own answer — this is the number
 *        that moved by $16.3M.
 *
 *   W-3  THE LEDGER THE CAP PAGE READS AGREES WITH THE CONTRACT. teamCapSummary
 *        is what the Cap page, the advance gate and the AI's cap refusal all
 *        run, and a stored row that disagrees with it is a panel quoting a
 *        number the game is not using — a thing this app has shipped before.
 *
 *   W-4  A RESTRUCTURE STILL MOVES MONEY RATHER THAN MAKING IT. The committed
 *        cap falls by exactly the drop in his hit, and by nothing else.
 *
 * AND THE HARNESS PROVES IT CAN FAIL, every run: `ok()` is fired at a
 * knowingly false claim and `present()` at a misspelled field, and the run
 * fails if either stays quiet. `undefined === undefined` compares equal and
 * reports success — that trap silently invalidated a full cap audit in this
 * codebase.
 * ===========================================================================
 */
import { prisma } from '../lib/db';
import { createLeague } from '../lib/gen/league';
import { restructureContract } from '../lib/freeagency';
import {
  buildContract, capHit, deadMoneyOnCut, formatMoney,
  restructureContract as computeRestructure,
} from '../lib/cap';
import { teamCapSummary } from '../lib/cap-summary';
import { CapViolationError } from '../lib/capEnforcement';

const TOL = 5;
const M = formatMoney;
let checks = 0;
let failures = 0;
let skipped = 0;
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

const YEARS = [2, 3, 4, 5, 7];
const BONUS_PCTS = [0, 0.12, 0.28, 0.5];
const VOIDS = [0, 2];
const ADD_VOIDS = [0, 1, 3];
/** Share of this year's base salary the club asks to convert. */
const CONVERT_PCTS = [0.25, 0.6, 0.95];
const playedFor = (years: number) => (years <= 4 ? [0, 1, years - 1] : [0, 2, years - 2]);

async function main() {
  let leagueId: string | null = null;
  let teamIds: string[] = [];
  try {
    leagueId = await createLeague({
      name: 'INV-21 restructure write check', userTeamAbbr: 'ZZZ', seed: 'check-restructure-write',
      settings: { capMode: 'REALISTIC' },
    });
    const teams = await prisma.team.findMany({ where: { leagueId }, select: { id: true, abbr: true } });
    teamIds = teams.map((t) => t.id);
    const league = await prisma.league.update({ where: { id: leagueId }, data: { phase: 'REGULAR', week: 4 } });

    /**
     * One man per club, overwritten each round rather than added to, so the
     * club's active salary starts each round where it started the last one.
     * Not the best player on the roster — a restructure that raises the hit
     * (a bonus-heavy deal late in its life does) has to fit under the ceiling
     * or the sweep spends itself on cap refusals.
     */
    const subject = new Map<string, string>();
    for (const t of teams) {
      const men = await prisma.player.findMany({
        where: { teamId: t.id, status: 'ACTIVE' }, orderBy: { trueOvr: 'desc' }, select: { id: true }, take: 30,
      });
      subject.set(t.id, (men[20] ?? men[men.length - 1]).id);
    }
    console.log(`league ${leagueId} — ${teams.length} clubs, phase ${league.phase} week 4, season ${league.seasonYear}\n`);

    const SY = league.seasonYear;
    for (const years of YEARS) {
      for (const bonusPct of BONUS_PCTS) {
        for (const voidYears of VOIDS) {
          for (const played of playedFor(years)) {
            for (const addVoidYears of ADD_VOIDS) {
              for (const convertPct of CONVERT_PCTS) {
                const team = teams[rounds % teams.length];
                rounds++;
                const playerId = subject.get(team.id)!;

                const fresh = buildContract({ apy: 9_000_000, years, signedYear: SY - played, bonusPct, voidYears });
                const row = {
                  teamId: team.id,
                  years: fresh.years, yearsRemaining: fresh.years - played, signedYear: SY - played,
                  baseSalaries: JSON.stringify(fresh.baseSalaries), signingBonus: fresh.signingBonus,
                  guaranteed: fresh.guaranteed, voidYears: fresh.voidYears,
                  isRookieDeal: false, isFranchiseTag: false,
                };
                await prisma.contract.upsert({ where: { playerId }, update: row, create: { playerId, ...row } });

                const before = await prisma.contract.findUniqueOrThrow({ where: { playerId } });
                const bases: number[] = JSON.parse(before.baseSalaries as string);
                const yearIdx = Math.max(0, before.years - before.yearsRemaining);
                const ask = Math.round((bases[yearIdx] ?? 0) * convertPct);
                const label = `${team.abbr} ${years}yr+${voidYears}v bonus ${M(fresh.signingBonus)} played ${played}`
                  + ` +${addVoidYears}v convert ${M(ask)}`;

                // THE SAME CALL, ON THE SAME ROW, WITH THE SAME ARGUMENTS the
                // library is about to make — so what is asserted and what is
                // stored cannot be two different restructures.
                const want = computeRestructure(before, ask, { addVoidYears, nowYear: SY });
                if (want.converted <= 0 || want.signingBonus === before.signingBonus) { skipped++; continue; }

                const hitBefore = capHit(before, 'REALISTIC');
                const usedBefore = (await teamCapSummary(team.id, SY, 'REALISTIC')).capUsed;
                try {
                  await restructureContract({
                    leagueId, playerId, convertAmount: ask, addVoidYears,
                    seasonYear: SY, capMode: 'REALISTIC', week: 4,
                  });
                } catch (err) {
                  if (err instanceof CapViolationError) { skipped++; continue; }
                  throw err;
                }

                const after = await prisma.contract.findUniqueOrThrow({ where: { playerId } });
                present(`${label} contract.guaranteed`, after.guaranteed);
                present(`${label} contract.signingBonus`, after.signingBonus);
                present(`${label} contract.voidYears`, after.voidYears);
                present(`${label} contract.baseSalaries`, after.baseSalaries);

                // W-1 — field for field.
                ok('W-1 stored years', after.years === want.years, `${label}: ${after.years} vs ${want.years}`);
                ok('W-1 stored yearsRemaining', after.yearsRemaining === want.yearsRemaining,
                  `${label}: ${after.yearsRemaining} vs ${want.yearsRemaining}`);
                ok('W-1 stored signedYear', after.signedYear === want.signedYear,
                  `${label}: ${after.signedYear} vs ${want.signedYear}`);
                ok('W-1 stored baseSalaries', after.baseSalaries === JSON.stringify(want.baseSalaries),
                  `${label}: ${after.baseSalaries} vs ${JSON.stringify(want.baseSalaries)}`);
                ok('W-1 stored signingBonus', Math.abs(after.signingBonus - want.signingBonus) <= TOL,
                  `${label}: ${M(after.signingBonus)} vs ${M(want.signingBonus)}`);
                ok('W-1 stored voidYears', (after.voidYears ?? 0) === want.voidYears,
                  `${label}: ${after.voidYears} vs ${want.voidYears}`);
                ok('W-1 stored guaranteed', Math.abs(after.guaranteed - want.guaranteed) <= TOL,
                  `${label}: stored ${M(after.guaranteed)} against a computed ${M(want.guaranteed)}`);

                // W-2 — the consequence a GM actually reads.
                const wantDead = deadMoneyOnCut(
                  { ...want, baseSalaries: JSON.stringify(want.baseSalaries), isRookieDeal: false }, 'REALISTIC');
                const gotDead = deadMoneyOnCut(after, 'REALISTIC');
                present(`${label} deadMoneyOnCut`, gotDead);
                ok('W-2 dead money on a cut is what the restructure computed',
                  Math.abs(gotDead - wantDead) <= TOL,
                  `${label}: cutting him would cost ${M(gotDead)}, the restructure said ${M(wantDead)}`
                  + ` — ${M(gotDead - wantDead)} invented`);

                // W-3 / W-4 — the ledger the Cap page reads.
                const hitAfter = capHit(after, 'REALISTIC');
                const usedAfter = (await teamCapSummary(team.id, SY, 'REALISTIC')).capUsed;
                present(`${label} ledger.capUsed`, usedAfter);
                ok('W-3 the ledger agrees with the stored contract',
                  Math.abs((usedAfter - usedBefore) - (hitAfter - hitBefore)) <= TOL,
                  `${label}: ledger moved ${M(usedAfter - usedBefore)}, his hit moved ${M(hitAfter - hitBefore)}`);
                // W-4 — the row is internally coherent, whatever the figures.
                // `guaranteed` is stored bonus-INCLUSIVE and is only ever read
                // by subtracting the bonus back out (guaranteedBaseByYear,
                // lib/cap.ts), so a guarantee smaller than its own bonus is a
                // negative promise: the exact shape a rebased bonus stored
                // beside an un-rebased guarantee produces.
                ok('W-4 the guarantee is not smaller than the bonus inside it',
                  after.guaranteed >= after.signingBonus - TOL,
                  `${label}: guaranteed ${M(after.guaranteed)} against a bonus of ${M(after.signingBonus)}`
                  + ` — ${M(after.signingBonus - after.guaranteed)} of negative guaranteed base`);
                void hitBefore; void hitAfter;
              }
            }
          }
        }
      }
    }

    console.log(`  swept ${rounds} shapes — ${skipped} skipped (floor hit or cap-blocked)`);
    ok('the sweep actually restructured something', rounds - skipped >= rounds / 3,
      `${rounds - skipped} of ${rounds} rounds produced a restructure — the sweep is measuring too little to gate anything`);

    // -----------------------------------------------------------------------
    // SELF-TEST — can this file report a failure at all?
    // -----------------------------------------------------------------------
    const before = failures;
    // Through variables, not literals: tsc rejects `1_000_000 === 2_000_000`
    // outright, and a check the compiler can fold is not a check.
    const oneMillion: number = 1_000_000;
    const twoMillion: number = 2_000_000;
    ok('SELF-TEST', oneMillion === twoMillion, 'a knowingly false claim — this line must appear');
    const row = { guaranteed: 1 } as { guaranteed: number; guarenteed?: number };
    // The trap, demonstrated: `undefined === undefined` reports a pass and
    // tests nothing. Only present() catches it.
    ok('SELF-TEST undefined vs undefined', row.guarenteed === (undefined as never), 'reads a field that does not exist and passes');
    present('SELF-TEST Contract.guarenteed (misspelled on purpose)', row.guarenteed);
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

  console.log('');
  console.log(`${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.log(`${failures} FAILED. Rules hit: ${[...shown.entries()].map(([r, n]) => `${r} x${n}`).join(', ')}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
