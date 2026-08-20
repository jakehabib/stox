/**
 * Permanent benchmark suite for the trade/asset valuation system
 * (lib/ai/gm.ts playerValueDetailed + pickValue). Not a unit-test-framework
 * suite (this project has none) — a standalone script asserting VALUE
 * RANGES for representative scenarios, run with:
 *
 *   npx tsx scripts/benchmarkTradeValue.ts
 *
 * Exits non-zero if any benchmark fails, so it can gate a change the same
 * way a real test suite would. Re-run this after touching TRADE_VALUE,
 * TRADE_VALUE_TIER, or playerValueDetailed's formula.
 */
import { playerValueDetailed, pickValue, RosterPlayer } from '../lib/ai/gm';
import { GmProfile } from '../lib/types';
import { ContractLike } from '../lib/cap';
import { Position } from '../lib/tuning';

const NEUTRAL_PROFILE: GmProfile = { aggression: 0.5, winNow: 0.5, valuePicks: 0.5, bpaBias: 0.55 };
const REBUILD_PROFILE: GmProfile = { aggression: 0.5, winNow: 0.1, valuePicks: 0.5, bpaBias: 0.55 };

function contract(apy: number, years: number, yearsRemaining: number, opts: { isRookieDeal?: boolean } = {}): ContractLike {
  const base = Array.from({ length: years }, () => apy);
  return { years, yearsRemaining, signedYear: 2024, baseSalaries: JSON.stringify(base), signingBonus: 0, guaranteed: 0, isRookieDeal: opts.isRookieDeal };
}

function player(position: Position, ovr: number, age: number, opts: { potential?: number; contract?: ContractLike } = {}): RosterPlayer {
  return { id: `${position}-${ovr}-${age}`, position, trueOvr: ovr, age, potential: opts.potential ?? ovr, contract: opts.contract };
}

function value(p: RosterPlayer, profile: GmProfile = NEUTRAL_PROFILE, needs: Record<string, number> = {}): number {
  return playerValueDetailed(p, { profile, needs, capMode: 'REALISTIC' }).total;
}

// Reference pick values (neutral profile, current year) — the scale every
// player benchmark is calibrated against.
const pick = (overallRound: number, overallSlot: number) => pickValue(overallRound, overallSlot, NEUTRAL_PROFILE, 2026, 2026);
const PICK_1_1 = pick(1, 1);
const PICK_1_32 = pick(1, 32);
const PICK_2_1 = pick(2, 1);
const PICK_2_32 = pick(2, 32);
const PICK_4_1 = pick(4, 1);
const PICK_5_1 = pick(5, 1);
const PICK_6_1 = pick(6, 1);
const PICK_7_32 = pick(7, 32);

let failures = 0;
let count = 0;

function check(label: string, actual: number, min: number, max: number) {
  count++;
  const pass = actual >= min && actual <= max;
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}: ${actual.toFixed(1)}  (expected ${min.toFixed(1)}-${max.toFixed(1)})`);
}

function checkLess(label: string, a: number, b: number, note: string) {
  count++;
  const pass = a < b;
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}: ${a.toFixed(1)} < ${b.toFixed(1)}  (${note})`);
}

console.log('=== Reference pick values (neutral profile) ===');
console.log(`Pick 1.01=${PICK_1_1.toFixed(1)}  1.32=${PICK_1_32.toFixed(1)}  2.01=${PICK_2_1.toFixed(1)}  2.32=${PICK_2_32.toFixed(1)}  4.01=${PICK_4_1.toFixed(1)}  5.01=${PICK_5_1.toFixed(1)}  6.01=${PICK_6_1.toFixed(1)}  7.32=${PICK_7_32.toFixed(1)}`);

console.log('\n=== Special teams ===');
{
  const p = value(player('P', 99, 25, { contract: contract(1_200_000, 4, 4) }));
  check('99 OVR P, age 25, cheap 4yr deal — ~4th-5th round', p, PICK_5_1 * 0.5, PICK_4_1 * 1.6);
  checkLess('99 OVR P must NOT approach a 2nd-rounder', p, PICK_2_32, 'must stay well under the cheapest 2nd-round pick');
  checkLess('99 OVR P must NOT approach a 1st-rounder', p, PICK_1_32, 'must stay well under the cheapest 1st-round pick');
}
{
  const p = value(player('P', 85, 29, { contract: contract(3_500_000, 3, 1) }));
  check('85 OVR P, age 29, normal contract — late-round/negligible', p, 0, PICK_6_1);
}
{
  const k = value(player('K', 95, 27, { contract: contract(1_000_000, 3, 3) }));
  check('95 OVR K, age 27, cheap contract — modest Day 3 asset', k, PICK_6_1 * 0.5, PICK_4_1 * 1.6);
}

console.log('\n=== QB ===');
let qb83young: number, qb90prime: number, qb90old: number;
{
  qb83young = value(player('QB', 83, 23, { potential: 92, contract: contract(1_500_000, 4, 4, { isRookieDeal: true }) }));
  check('83 OVR QB, 23yo, cheap rookie deal — extremely valuable', qb83young, PICK_1_32, PICK_1_1 * 3.5);
}
{
  qb90prime = value(player('QB', 90, 25, { contract: contract(35_000_000, 4, 4) }));
  check('90 OVR QB, 25yo, fair contract — multiple premium assets', qb90prime, PICK_1_1 * 1.3, PICK_1_1 * 4);
}
{
  qb90old = value(player('QB', 90, 36, { contract: contract(55_000_000, 2, 1) }));
  check('90 OVR QB, 36yo, expensive — still meaningful but discounted', qb90old, PICK_2_1 * 0.5, PICK_1_1 * 1.3);
  checkLess('90 OVR QB at 36 (expensive) < same QB at 25 (fair deal)', qb90old, qb90prime, 'age+contract should separate these clearly');
}

console.log('\n=== Premium non-QB positions ===');
{
  const edge = value(player('EDGE', 92, 25, { contract: contract(8_000_000, 4, 4, { isRookieDeal: true }) }));
  check('92 OVR EDGE, 25yo, cheap — first-round-plus', edge, PICK_1_32, PICK_1_1 * 2.5);
}
{
  const wr = value(player('WR', 91, 26, { contract: contract(18_000_000, 4, 3) }));
  check('91 OVR WR, 26yo, fair contract — ~first-round territory', wr, PICK_1_32 * 0.6, PICK_1_1 * 2);
}
{
  const lt = value(player('LT', 90, 26, { contract: contract(9_000_000, 4, 4, { isRookieDeal: true }) }));
  check('90 OVR LT, 26yo, cheap — premium asset', lt, PICK_1_32, PICK_1_1 * 2.2);
}

console.log('\n=== Lower-value positions ===');
let rbOld: number, rbYoung: number;
{
  rbOld = value(player('RB', 89, 29, { contract: contract(14_000_000, 3, 1) }));
  check('89 OVR RB, 29yo, expensive — well below similar WR/EDGE/LT', rbOld, 0, PICK_2_32 * 1.4);
}
{
  rbYoung = value(player('RB', 92, 23, { contract: contract(2_500_000, 4, 4, { isRookieDeal: true }) }));
  check('92 OVR RB, 23yo, cheap rookie deal — meaningful but capped', rbYoung, PICK_2_32 * 0.5, PICK_2_1 * 1.15);
}

console.log('\n=== Contract comparison (identical 88 OVR WR) ===');
{
  const playerA = value(player('WR', 88, 25, { contract: contract(9_000_000, 4, 3) }));
  const playerB = value(player('WR', 88, 30, { contract: contract(30_000_000, 1, 1) }));
  check('WR A (25yo, $9M/yr, 3yrs left) — materially more valuable', playerA, playerB * 1.3, Infinity);
  console.log(`   A=${playerA.toFixed(1)}  B=${playerB.toFixed(1)}`);
}

console.log('\n=== Cross-position sanity ===');
{
  const p99 = value(player('P', 99, 25, { contract: contract(1_200_000, 4, 4) }));
  const qbStarter = value(player('QB', 85, 27, { contract: contract(28_000_000, 3, 2) }));
  checkLess('99 OVR P < 85 OVR starting QB', p99, qbStarter, 'position economics must dominate raw OVR');
}
{
  const k95 = value(player('K', 95, 27, { contract: contract(1_000_000, 3, 3) }));
  const edge90 = value(player('EDGE', 90, 26, { contract: contract(15_000_000, 4, 3) }));
  checkLess('95 OVR K < 90 OVR EDGE', k95, edge90, 'position economics must dominate raw OVR');
}
{
  const rb92 = value(player('RB', 92, 23, { contract: contract(2_500_000, 4, 4, { isRookieDeal: true }) }));
  const wr85 = value(player('WR', 85, 26, { contract: contract(12_000_000, 3, 2) }));
  checkLess('92 OVR RB does not outrank 85 OVR premium-position WR purely on OVR', rb92, wr85, 'RB ceiling must stay capped even at elite rating');
}
{
  checkLess('Young good QB (83 OVR, cheap) > older higher-OVR RB (89 OVR, expensive)', rbOld, qb83young, 'position+age+contract can outweigh raw OVR gap');
}
{
  const needs0: Record<string, number> = { P: 0 };
  const needs1: Record<string, number> = { P: 1 };
  const pNoNeed = value(player('P', 99, 25, { contract: contract(1_200_000, 4, 4) }), NEUTRAL_PROFILE, needs0);
  const pMaxNeed = value(player('P', 99, 25, { contract: contract(1_200_000, 4, 4) }), NEUTRAL_PROFILE, needs1);
  checkLess('Team need moves P value but cannot cross into premium-pick territory', pMaxNeed, PICK_1_32, 'even a "desperate" need for a punter stays capped');
  console.log(`   no-need=${pNoNeed.toFixed(1)}  desperate-need=${pMaxNeed.toFixed(1)}`);
}

console.log(`\n${count - failures}/${count} benchmarks passed.`);
if (failures > 0) {
  console.error(`${failures} benchmark(s) FAILED.`);
  process.exit(1);
}
