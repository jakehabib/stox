/**
 * ===========================================================================
 * PERMANENT CHECK — A RESTRUCTURE MOVES MONEY, IT NEVER CREATES OR DESTROYS IT
 * ===========================================================================
 * Not a unit-test-framework suite (this project has none) — a standalone
 * script, in the shape of scripts/benchmarkTradeValue.ts, asserting the money
 * invariants of `restructureContract` and `buildExtension` across the whole
 * space of contract shapes the game can produce. Run with:
 *
 *   npx tsx scripts/checkRestructure.ts
 *
 * Exits non-zero if any invariant fails, so it gates a change the way a real
 * test suite would. Re-run it after touching anything in lib/cap.ts that
 * rebases a contract onto the years that are left.
 *
 * IT IS HALF OF INV-21, AND DELIBERATELY SO. This file is pure arithmetic —
 * lib/cap.ts and lib/tuning.ts, no database — which is the right shape for a
 * defect that lives in a pure function, and the wrong shape for one that lives
 * in a write path. `applyFranchiseTag` deleted a contract and booked no
 * CapCharge for the bonus still owed on it, and every function in here
 * returned the correct figure the whole time it was being discarded; nothing
 * a sweep of this kind could assert would have noticed. Its sibling
 * `scripts/checkFranchiseTag.ts` drives the real function against a real
 * database for that clause. Keep them apart: folding a database round-trip
 * into this sweep would cost the 55k checks that make it worth running.
 *
 * The invariants, and why these and not others:
 *
 *   R-1  A ZERO-DOLLAR RESTRUCTURE IS A NO-OP. Convert nothing and this
 *        year's cap hit, every remaining year's cap hit, and the dead money
 *        on a cut are all unchanged. This is the single strongest property
 *        available here: it needs no expected values, it holds for every
 *        shape, and it is the one the bug this file was written for failed —
 *        carrying the FULL original signing bonus onto a schedule covering
 *        only the years left re-charged every dollar already amortised, so a
 *        no-op conversion raised a 5-year deal's hit from $15.0M to $18.3M.
 *
 *   R-2  TOTAL CHARGED EQUALS MONEY PAID. Every dollar of proration billed
 *        over a deal's whole life — the seasons played on the original deal
 *        plus the whole restructured remainder — equals the signing bonus
 *        actually handed over, plus whatever base salary was converted into
 *        it. Holds however many times, and however late, a deal is
 *        restructured.
 *
 *   R-3  A ZERO-DOLLAR RESTRUCTURE MOVES NO MONEY BETWEEN YEARS EITHER: the
 *        sum of the remaining years' cap hits is unchanged. Weaker than R-1
 *        per-year, and it is what R-1 degrades to on the one shape R-1
 *        cannot hold (see below).
 *
 *   R-4  THE GUARANTEE STAYS IN THE SAME FRAME AS THE BONUS. `guaranteed` is
 *        stored bonus-inclusive and is only ever read by subtracting the
 *        bonus back out, so `guaranteed - signingBonus` after a restructure
 *        must still be the guaranteed base salary the club owes for the years
 *        that are left, less anything the conversion turned into cash.
 *
 *   R-5  `converted` REPORTS WHAT WAS ACTUALLY CONVERTED. No year may pay
 *        below the league minimum, so a request is clamped; the caller has to
 *        be able to tell a real conversion from one the floor ate, because
 *        the signing bonus moving is no longer evidence of one.
 *
 *   R-6  AN EXTENSION CARRIES THE UNAMORTISED BONUS TOO. `buildExtension`
 *        rebases the same way and had the same defect in a different
 *        disguise (`proration x yearsRemaining`, which is bonus years left
 *        only while the deal fits inside the proration window).
 *
 * THE ONE DOCUMENTED EXCEPTION, and it is asserted rather than ignored: a
 * deal longer than CAP.MAX_PRORATION_YEARS stops amortising its bonus in year
 * five while the contract runs on, so partway through it has more years left
 * than bonus years left. A rebased contract's window is `min(years + void, 5)`
 * counted from year zero, so a window SHORTER than the years left cannot be
 * expressed, and the carried money spreads over five years instead of three.
 * R-2 and R-3 still hold exactly — the total is right and no money leaves the
 * deal — but the per-year shape shifts a little of it later, so R-1 is checked
 * as R-3 on those shapes. Do not "fix" that by carrying enough bonus to hold
 * the per-year figure steady: that is exactly the double-charge R-2 catches.
 * ===========================================================================
 */
import {
  buildContract, buildExtension, capHit, capHitSchedule, deadMoneyOnCut,
  guaranteedSalaryOwed, proration, prorationYears, restructureContract,
  unamortizedBonus, formatMoney, type ContractLike,
} from '../lib/cap';
import { CAP } from '../lib/tuning';

/** Integer cents-free arithmetic still rounds per year; a few dollars is not a defect. */
const TOL = 5;

let failures = 0;
let checks = 0;
const shown = new Map<string, number>();

function ok(rule: string, pass: boolean, detail: string) {
  checks++;
  if (pass) return;
  failures++;
  const n = (shown.get(rule) ?? 0) + 1;
  shown.set(rule, n);
  if (n <= 4) console.log(`  FAIL ${rule}  ${detail}`);
}

const M = formatMoney;
const shape = (n: { baseSalaries: number[] }): ContractLike =>
  ({ ...n, baseSalaries: JSON.stringify(n.baseSalaries) } as ContractLike);

/** A contract as it sits `played` seasons into its life. */
function aged(c: { years: number; baseSalaries: number[]; signingBonus: number; guaranteed: number; voidYears: number; signedYear: number }, played: number): ContractLike {
  return { ...c, baseSalaries: JSON.stringify(c.baseSalaries), yearsRemaining: c.years - played };
}

/** Proration already billed to the seasons this deal has played. */
function chargedSoFar(c: ContractLike): number {
  const yearIdx = c.years - c.yearsRemaining;
  return proration(c) * Math.min(yearIdx, prorationYears(c));
}

/** Proration still to be billed across every remaining year of a deal. */
function chargedAhead(c: ContractLike): number {
  return unamortizedBonus(c, 'REALISTIC');
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------
const YEARS = [1, 2, 3, 4, 5, 6, 7];
const APYS = [1_000_000, 4_000_000, 12_000_000, 30_000_000];
const BONUS_PCTS = [0, 0.12, 0.28, 0.5];
const VOIDS = [0, 1, 2, 3];

let longDeals = 0;

for (const years of YEARS) {
  for (const apy of APYS) {
    for (const bonusPct of BONUS_PCTS) {
      for (const voidYears of VOIDS) {
        const fresh = buildContract({ apy, years, signedYear: 2030, bonusPct, voidYears });
        for (let played = 0; played < years; played++) {
          const before = aged(fresh, played);
          const label = `${years}yr+${fresh.voidYears}v ${M(apy)}/yr bonus ${M(fresh.signingBonus)} played ${played}`;
          // A deal past the proration window cannot express "fewer bonus years
          // left than contract years left" once rebased — see the header.
          const windowLeft = prorationYears(before) - (before.years - before.yearsRemaining);
          const structural = before.yearsRemaining > windowLeft;
          if (structural) longDeals++;

          // ---- R-1 / R-3: the zero-dollar no-op ----------------------------
          const noop = restructureContract(before, 0, { nowYear: 2030 + played });
          const after = shape(noop);
          const schedBefore = capHitSchedule(before, 'REALISTIC');
          const schedAfter = capHitSchedule(after, 'REALISTIC');
          const sumBefore = schedBefore.reduce((a, b) => a + b, 0);
          const sumAfter = schedAfter.reduce((a, b) => a + b, 0);

          ok('R-3 remaining total', Math.abs(sumBefore - sumAfter) <= TOL * years,
            `${label}: ${M(sumBefore)} -> ${M(sumAfter)}`);
          ok('R-1 dead money', Math.abs(deadMoneyOnCut(before, 'REALISTIC') - deadMoneyOnCut(after, 'REALISTIC')) <= TOL,
            `${label}: ${M(deadMoneyOnCut(before, 'REALISTIC'))} -> ${M(deadMoneyOnCut(after, 'REALISTIC'))}`);

          if (!structural) {
            ok('R-1 cap hit', Math.abs(capHit(before, 'REALISTIC') - capHit(after, 'REALISTIC')) <= TOL,
              `${label}: ${M(capHit(before, 'REALISTIC'))} -> ${M(capHit(after, 'REALISTIC'))}`);
            ok('R-1 schedule',
              schedBefore.length === schedAfter.length && schedBefore.every((v, i) => Math.abs(v - schedAfter[i]) <= TOL),
              `${label}: [${schedBefore.map(M).join(', ')}] -> [${schedAfter.map(M).join(', ')}]`);
          }

          // ---- R-4: guarantee and bonus in the same frame ------------------
          ok('R-4 guarantee frame',
            Math.abs((noop.guaranteed - noop.signingBonus) - guaranteedSalaryOwed(before, 'REALISTIC')) <= TOL,
            `${label}: ${M(noop.guaranteed - noop.signingBonus)} vs owed ${M(guaranteedSalaryOwed(before, 'REALISTIC'))}`);
          ok('R-4 guarantee >= bonus', noop.guaranteed >= noop.signingBonus,
            `${label}: guaranteed ${M(noop.guaranteed)} < bonus ${M(noop.signingBonus)}`);

          // ---- R-2 / R-5: every conversion amount --------------------------
          const currentBase = fresh.baseSalaries[played] ?? 0;
          const room = Math.max(0, currentBase - CAP.MIN_SALARY);
          for (const want of [0, 1, Math.round(room / 2), room, room + 50_000_000]) {
            const next = restructureContract(before, want, { nowYear: 2030 + played });
            const nextC = shape(next);
            const total = chargedSoFar(before) + chargedAhead(nextC);
            ok('R-2 total charged', Math.abs(total - (fresh.signingBonus + next.converted)) <= TOL * (years + 1),
              `${label} convert ${M(want)}: charged ${M(total)} vs paid ${M(fresh.signingBonus + next.converted)}`);
            ok('R-5 converted clamped', next.converted === Math.min(Math.max(0, Math.round(want)), room),
              `${label} convert ${M(want)}: reported ${M(next.converted)}, room ${M(room)}`);

            // ---- R-7: what this year frees, the later years repay ----------
            // The sentence the restructure panel prints — "borrowing X from
            // this season and paying back X across the later years" — is an
            // arithmetic identity, not an estimate, and it is only an identity
            // because the rebase carries the unamortised bonus. Carry the
            // whole one and the deal grows by the amount already amortised:
            // the panel then borrowed $1.03M and repaid $7.18M, on a measured
            // 4-year QB deal two seasons in, which is money invented by an
            // accounting move.
            //
            // Void years are part of "later" and the panel has to count them:
            // they carry proration that no playing season ever charges, and it
            // lands in one lump as dead money the moment the real deal ends.
            // Leave them out and a restructure that adds void years reads as
            // borrowing more than it repays.
            const oldSched = capHitSchedule(before, 'REALISTIC');
            const newSched = capHitSchedule(nextC, 'REALISTIC');
            const onVoid = (x: ContractLike) => proration(x) * Math.max(0, prorationYears(x) - x.years);
            const freed = capHit(before, 'REALISTIC') - capHit(nextC, 'REALISTIC');
            const repaid = newSched.slice(1).reduce((a, b) => a + b, 0) - oldSched.slice(1).reduce((a, b) => a + b, 0)
              + (onVoid(nextC) - onVoid(before));
            ok('R-7 freed equals repaid', Math.abs(freed - repaid) <= TOL * years,
              `${label} convert ${M(want)}: freed ${M(freed)}, repaid ${M(repaid)}`);
            ok('R-7 a restructure never costs cap', freed >= -TOL,
              `${label} convert ${M(want)}: freed ${M(freed)}`);
            // Converting salary the club had already guaranteed changes
            // nothing it owes; converting salary it could have walked away
            // from turns that much into cash and raises the bill by exactly
            // as much. Anything else is money invented by an accounting move.
            const guaranteedThisYear = guaranteedSalaryOwed(before, 'REALISTIC')
              - guaranteedSalaryOwed({ ...before, yearsRemaining: before.yearsRemaining - 1 }, 'REALISTIC');
            const deadDelta = deadMoneyOnCut(nextC, 'REALISTIC') - deadMoneyOnCut(before, 'REALISTIC');
            ok('R-4 dead money moves only by unguaranteed cash',
              Math.abs(deadDelta - Math.max(0, next.converted - guaranteedThisYear)) <= TOL,
              `${label} convert ${M(want)}: dead moved ${M(deadDelta)}, expected ${M(Math.max(0, next.converted - guaranteedThisYear))}`);
          }

          // ---- R-6: an extension carries the unamortised bonus -------------
          const ext = buildExtension({ current: before, newMoneyApy: apy, addYears: 3, signedYear: 2030 + played });
          const extC = shape(ext);
          const extTotal = chargedSoFar(before) + chargedAhead(extC);
          ok('R-6 extension total', Math.abs(extTotal - (fresh.signingBonus + ext.signingBonus - unamortizedBonus(before, 'REALISTIC'))) <= TOL * (years + 4),
            `${label}: charged ${M(extTotal)} across old+new bonus`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// R-2 under REPEATED restructures — the shape a user actually reaches by
// kicking the same can down the road every March.
// ---------------------------------------------------------------------------
for (const shapeSpec of [
  { apy: 25_000_000, years: 5, bonusPct: 0.28, voidYears: 0 },
  { apy: 12_000_000, years: 3, bonusPct: 0.5, voidYears: 2 },
  { apy: 30_000_000, years: 7, bonusPct: 0.28, voidYears: 0 },
]) {
  const fresh = buildContract({ ...shapeSpec, signedYear: 2030 });
  let c: ContractLike = aged(fresh, 0);
  let bonusCharged = 0;
  let paid = fresh.signingBonus;

  for (let season = 0; season < fresh.years; season++) {
    // Kick the can: convert half of whatever this year's base still allows,
    // every single March, which is the habit the move exists to enable.
    const bases: number[] = JSON.parse(c.baseSalaries);
    const idx = c.years - c.yearsRemaining;
    const room = Math.max(0, (bases[idx] ?? 0) - CAP.MIN_SALARY);
    const next = restructureContract(c, Math.round(room / 2), { nowYear: 2030 + season });
    paid += next.converted;
    c = { ...shape(next), yearsRemaining: next.yearsRemaining };

    // This season is now billed off the restructured deal, then the ledger ages.
    bonusCharged += proration(c) * ((c.years - c.yearsRemaining) < prorationYears(c) ? 1 : 0);
    c = { ...c, yearsRemaining: c.yearsRemaining - 1 };
  }
  // Whatever the void years still hold accelerates the moment the deal ends.
  bonusCharged += unamortizedBonus(c, 'REALISTIC');

  ok('R-2 repeated restructures', Math.abs(bonusCharged - paid) <= TOL * (fresh.years + 2),
    `${shapeSpec.years}yr+${fresh.voidYears}v restructured every season: charged ${M(bonusCharged)} against ${M(paid)} paid`);
}

// ---------------------------------------------------------------------------
// The worked example from the bug report, printed so a reader can see the
// numbers rather than take the pass on trust.
// ---------------------------------------------------------------------------
{
  const c: ContractLike = {
    years: 5, yearsRemaining: 3, signedYear: 2030,
    baseSalaries: JSON.stringify([20_000_000, 20_000_000, 20_000_000, 20_000_000, 20_000_000]),
    signingBonus: 25_000_000, guaranteed: 25_000_000, voidYears: 0,
  };
  const n = shape(restructureContract(c, 0, { nowYear: 2032 }));
  console.log('');
  console.log('  5yr deal, $25.0M bonus ($5.00M/yr), 2 years played, 3 remaining');
  console.log(`  BEFORE  proration ${M(proration(c))}/yr   unamortised ${M(unamortizedBonus(c, 'REALISTIC'))}   capHit ${M(capHit(c, 'REALISTIC'))}   dead ${M(deadMoneyOnCut(c, 'REALISTIC'))}`);
  console.log(`  AFTER   bonus ${M(n.signingBonus)} over ${n.years}yr -> ${M(proration(n))}/yr   capHit ${M(capHit(n, 'REALISTIC'))}   dead ${M(deadMoneyOnCut(n, 'REALISTIC'))}`);
}

console.log('');
console.log(`${checks - failures}/${checks} checks passed`
  + ` (${longDeals} shapes past the ${CAP.MAX_PRORATION_YEARS}-year proration window, held to R-2/R-3 — see header).`);
if (failures > 0) {
  console.log(`${failures} FAILED. Rules hit: ${[...shown.entries()].map(([r, n]) => `${r} x${n}`).join(', ')}`);
  process.exit(1);
}
