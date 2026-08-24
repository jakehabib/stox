/**
 * ===========================================================================
 * BOX SCORE CONSERVATION HARNESS
 * ===========================================================================
 * `npx tsx scripts/checkBoxScore.ts [leagues] [seasons]`
 *
 * A football box score is an accounting document before it is anything else.
 * Every yard a quarterback threw was caught by somebody; every sack a defence
 * recorded was taken by the other side's line; every interception thrown was
 * intercepted BY someone. Those are not tuning targets that can be a bit off —
 * they are identities, and a box score that breaks one is simply wrong, no
 * matter how plausible its numbers look.
 *
 * They were all broken. Measured over 240 replayed league-seasons on the
 * engine as it stood before this file existed:
 *
 *   receiving yards exceeded passing yards by 8.5%   (backs were handed
 *                                                     rng.int(0, 40) on top
 *                                                     of the receivers' full
 *                                                     share of the throw)
 *   the team pass-yard line missed the passer by 5%  (it was a flat 60/40
 *                                                     split of total yards,
 *                                                     unrelated to the lines)
 *   19.6% of sacks reached no defender               (one coin flip per man,
 *                                                     one sack maximum)
 *   4.7% of interceptions were thrown by nobody      (the passer and the
 *                                                     secondary rolled the
 *                                                     same event separately)
 *   30.6% of passing touchdowns were caught by nobody
 *
 * None of that is visible from a single game — a 23-yard gap between what the
 * passer threw and what the receivers caught reads as rounding. It is only
 * visible in aggregate, which is why it survived so long, and why this is a
 * harness rather than a snapshot rule in lib/invariants.ts. Nothing here
 * touches the database.
 *
 * Exits non-zero on any violation, so it is CI-friendly.
 * ===========================================================================
 */
import { generateRoster } from '../lib/gen/players';
import { simulateGame, SimTeamInput } from '../lib/sim/engine';
import { SimPlayer, SimStaff } from '../lib/sim/units';
import { buildSchedule } from '../lib/schedule';
import { Rng } from '../lib/rng';
import { writeJson } from '../lib/json';
import { parseSettings } from '../lib/settings';

const LEAGUES = Number(process.argv[2] ?? 2);
const SEASONS = Number(process.argv[3] ?? 4);
const WEEKS = 17;

/**
 * Tolerances, per team-game, and why each is not zero.
 *
 * Yardage is shared out by multiplying a total by a weight vector and rounding
 * each share, so a handful of yards can go missing to rounding across ten
 * receivers. Counting stats have no such excuse: `allocateCounts` deals out
 * whole events one at a time and every one of them lands on somebody, so an
 * interception or a sack that does not reconcile is a defect and the bar is
 * exactly zero.
 *
 * The total-yards clause is the loose one on purpose. `allocateStats` floors a
 * team at 120 yards before splitting it, so on the rare afternoon a club gains
 * less than that the box score honestly reports more than the drive chart; and
 * overtime pushes a drive with 55 yards on it into the drive list without ever
 * adding those yards to the team's total. Neither is this file's to fix, and
 * both are small enough in aggregate to sit under a 4-yard mean.
 */
const TOL = {
  passVsRec: 3,      // yards per team-game
  teamLineVsQb: 0,   // the team line now sums the player lines; no slack at all
  totalVsDrives: 4,  // yards per team-game — see the note above
  sacks: 0,          // whole events
  ints: 0,           // whole events
  passTdVsRecTd: 0,  // whole events
};

// ---------------------------------------------------------------------------
// CANARY. Both of these MUST report FAIL. A conservation check compares two
// numbers, and `undefined === undefined` compares equal — so a harness that
// only ever reads correctly-spelled fields would report a perfect score
// against two fields that do not exist. That trap invalidated a full cap audit
// in this codebase, so it is checked before any real number is trusted.
// ---------------------------------------------------------------------------
function canary(): void {
  const line: Record<string, unknown> = { passYds: 300, sacks: 2 };
  const out: string[] = [];

  const falseClaim = (line.passYds as number) === 999;
  out.push(`CANARY-A (assert passYds === 999, expect FAIL): ${falseClaim ? 'PASS *** CANARY BROKEN ***' : 'FAIL (correct)'}`);

  const typo = line['pasYds'];
  const typoUsable = typo !== undefined && typo === line['passYds'];
  out.push(`CANARY-B (read 'pasYds', expect FAIL/undefined): ${typoUsable ? 'PASS *** CANARY BROKEN ***' : `FAIL (correct: got ${String(typo)})`}`);

  const typo2 = line['passYardz'];
  out.push(`CANARY-C (two misspellings compare equal — the trap itself): ${typo === typo2 ? 'TRUE, so equality alone proves nothing' : 'unexpected'}`);

  const zeroGapIsViolation = Math.abs(7 - 7) > 0;
  out.push(`CANARY-D (assert 7 !== 7 in the comparison this file runs, expect FAIL): ${zeroGapIsViolation ? 'PASS *** CANARY BROKEN ***' : 'FAIL (correct)'}`);

  console.log(out.map((r) => '  ' + r).join('\n'));
  if (falseClaim || typoUsable || zeroGapIsViolation) {
    console.error('CANARY BROKEN — nothing below this line can be trusted.');
    process.exit(2);
  }
}

/**
 * A league built the way `createLeague`'s RANDOM_ROSTERS branch builds one,
 * minus the database: same team-strength roll, same `generateRoster`, same
 * staff roll. No depth chart is written, which is what the engine sees for a
 * club whose chart is empty — it sorts on merit. No pass rate is supplied
 * either, so the engine falls back to `passTendency(team.id)` — the club's
 * centre with no season attached, which is exactly what this harness wants:
 * conservation is a property of the arithmetic, not of any one rate.
 *
 * `trueAttrs` MUST be serialized on the way in, exactly as lib/gen/players.ts
 * does when it writes a real row. `generateRoster` hands back an `AttrMap`
 * object and `SimPlayer.trueAttrs` is the JSON string that comes back out of
 * the database; pass the object straight through and `readJson` parses
 * "[object Object]", throws, and silently returns its fallback — so every
 * player in the league quietly runs on default durability and a flat scheme
 * fit, and nothing anywhere says so. A probe that lies this quietly is worse
 * than no probe.
 */
function synthLeague(seed: string): SimTeamInput[] {
  const rng = new Rng(seed);
  const CONF = ['AFC', 'NFC'], DIV = ['East', 'North', 'South', 'West'];
  const out: SimTeamInput[] = [];
  for (let c = 0; c < 2; c++) for (let d = 0; d < 4; d++) for (let k = 0; k < 4; k++) {
    const idx = out.length;
    const strength = rng.normal(0, 4);
    const roster = generateRoster(rng, strength);
    const staff: SimStaff[] = [{ role: 'HC' }, { role: 'OC' }, { role: 'DC' }, { role: 'ST' }].map((r) => {
      const rating = rng.normalClamped(55, 12, 25, 95);
      return { role: r.role, rating, playCalling: rng.normalClamped(rating, 8, 20, 99) };
    });
    out.push({
      id: `T${idx}`, abbr: `T${idx}`, name: `Team ${idx}`, isUser: false, staff,
      players: roster.map((p, i): SimPlayer => ({
        id: `T${idx}-${i}`, firstName: p.firstName, lastName: p.lastName, position: p.position,
        trueOvr: p.trueOvr, trueAttrs: writeJson(p.trueAttrs), status: 'ACTIVE', injuryWeeks: 0, fatigue: 0,
      })),
      depthOrder: {},
      ...({ conference: CONF[c], division: DIV[d] } as object),
    } as SimTeamInput);
  }
  return out;
}

interface Clause {
  label: string;
  /** Real-world statement of the identity, for the failure message. */
  rule: string;
  tol: number;
  absSum: number;
  signedSum: number;
  worst: number;
  n: number;
}

function main(): void {
  console.log('=== CANARY ===');
  canary();

  const clauses: Record<keyof typeof TOL, Clause> = {
    passVsRec: { label: 'receiving yards vs passing yards', rule: 'every yard thrown was caught by somebody', tol: TOL.passVsRec, absSum: 0, signedSum: 0, worst: 0, n: 0 },
    teamLineVsQb: { label: 'team pass-yard line vs passer', rule: 'the team column is the player column added up', tol: TOL.teamLineVsQb, absSum: 0, signedSum: 0, worst: 0, n: 0 },
    totalVsDrives: { label: 'team total-yard line vs drives', rule: 'the yards in the box score are the yards the drives gained', tol: TOL.totalVsDrives, absSum: 0, signedSum: 0, worst: 0, n: 0 },
    sacks: { label: 'sacks credited vs sacks allowed', rule: 'every sack a defence recorded was taken by the other side', tol: TOL.sacks, absSum: 0, signedSum: 0, worst: 0, n: 0 },
    ints: { label: 'interceptions caught vs thrown', rule: 'every interception thrown was caught by somebody', tol: TOL.ints, absSum: 0, signedSum: 0, worst: 0, n: 0 },
    passTdVsRecTd: { label: 'receiving TDs vs passing TDs', rule: 'every touchdown pass was caught by somebody', tol: TOL.passTdVsRecTd, absSum: 0, signedSum: 0, worst: 0, n: 0 },
  };
  const note = (k: keyof typeof TOL, diff: number) => {
    const c = clauses[k];
    c.absSum += Math.abs(diff); c.signedSum += diff; c.n += 1;
    if (Math.abs(diff) > Math.abs(c.worst)) c.worst = diff;
  };

  const settings = parseSettings('{}');
  for (let i = 0; i < LEAGUES; i++) {
    const teams = synthLeague(`boxcheck-${i}`);
    const sched = buildSchedule(
      teams.map((t, idx) => ({ idx, conference: (t as any).conference, division: (t as any).division })),
      new Rng(`boxcheck-${i}-sched`), WEEKS,
    );
    for (let s = 0; s < SEASONS; s++) {
      const rng = new Rng(`boxcheck-${i}-${s}`);
      const live = teams.map((t) => ({ ...t, players: t.players.map((p) => ({ ...p, injuryWeeks: 0, fatigue: 0 })) }));
      for (let week = 1; week <= WEEKS; week++) {
        for (const g of sched.filter((x) => x.week === week)) {
          const box = simulateGame(live[g.homeIdx], live[g.awayIdx], settings, rng, { allowTie: true }).boxScore;
          for (const side of ['home', 'away'] as const) {
            const other = side === 'home' ? 'away' : 'home';
            let passYds = 0, recYds = 0, rushYds = 0, intThrown = 0, passTd = 0, recTd = 0, sacksBy = 0;
            for (const l of box.lines[side]) {
              passYds += l.stats.passYds ?? 0;
              recYds += l.stats.recYds ?? 0;
              rushYds += l.stats.rushYds ?? 0;
              intThrown += l.stats.int ?? 0;
              passTd += l.stats.passTd ?? 0;
              recTd += l.stats.recTd ?? 0;
              sacksBy += l.stats.sacks ?? 0;
            }
            let intCaught = 0;
            for (const l of box.lines[other]) intCaught += l.stats.defInt ?? 0;
            const driveYds = box.drives.filter((d) => d.team === side).reduce((a, d) => a + d.yards, 0);

            note('passVsRec', recYds - passYds);
            note('teamLineVsQb', box.teamStats[side].passYards - passYds);
            note('totalVsDrives', box.teamStats[side].totalYards - driveYds);
            // `teamStats[side].sacks` is what this side's DEFENCE recorded, so
            // it reconciles against the sacks its own named defenders were
            // credited with — not against the other column.
            note('sacks', sacksBy - box.teamStats[side].sacks);
            note('ints', intCaught - intThrown);
            note('passTdVsRecTd', recTd - passTd);
          }
        }
      }
    }
    process.stdout.write('.');
  }
  console.log(`\n\n${LEAGUES} league(s) x ${SEASONS} season(s) = ${clauses.ints.n} team-games.\n`);

  let failed = 0;
  console.log(`  ${'clause'.padEnd(34)} ${'mean |gap|'.padStart(11)} ${'mean gap'.padStart(10)} ${'worst'.padStart(8)} ${'tol'.padStart(5)}`);
  for (const c of Object.values(clauses)) {
    const mean = c.absSum / Math.max(1, c.n);
    const ok = mean <= c.tol;
    if (!ok) failed++;
    console.log(`  ${c.label.padEnd(34)} ${mean.toFixed(3).padStart(11)} ${(c.signedSum / Math.max(1, c.n)).toFixed(3).padStart(10)} ${String(c.worst).padStart(8)} ${String(c.tol).padStart(5)}  ${ok ? 'ok' : 'VIOLATION'}`);
    if (!ok) console.log(`      ${c.rule} — and here it did not.`);
  }

  console.log('');
  if (failed > 0) {
    console.error(`${failed} conservation clause(s) violated.`);
    process.exit(1);
  }
  console.log('Box score conserves on every clause.');
}

main();
