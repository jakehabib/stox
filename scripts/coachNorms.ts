/**
 * Measure the population of SINGLE-GAME outings this sim actually
 * produces, so lib/coachRoom.ts can hand lib/performanceScore.ts a real
 * yardstick without a query on the report path.
 *
 * Pass 1  mean/sd of every scored stat, per position, over gated box lines.
 * Pass 2  the percentile ladder of the finished composite, per position.
 *
 * Run:  npx tsx scripts/coachNorms.ts
 */
import { PrismaClient } from '@prisma/client';
import { scoredStats, positionRelativeScore, isRankablePosition, PositionDistribution } from '../lib/performanceScore';
import { playedEnough } from '../lib/coachRoom';
import { canonicalPosition } from '../lib/tuning';
import type { BoxScore, SeasonStats } from '../lib/types';

const prisma = new PrismaClient();
const CHUNK = 400;
const LEVELS = [1, 2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 98, 99];

type Acc = { n: number; sum: number; sq: number };

async function* lines(): AsyncGenerator<{ pos: string; stats: SeasonStats }> {
  let cursor: string | undefined;
  let games = 0;
  for (;;) {
    const rows = await prisma.game.findMany({
      where: { played: true },
      select: { id: true, boxScore: true },
      orderBy: { id: 'asc' },
      take: CHUNK,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    for (const r of rows) {
      let box: BoxScore;
      try { box = JSON.parse(r.boxScore) as BoxScore; } catch { continue; }
      for (const side of [box.lines?.home ?? [], box.lines?.away ?? []]) {
        for (const l of side) {
          const pos = canonicalPosition(String(l.position));
          if (!isRankablePosition(pos)) continue;
          if (!playedEnough(pos, l.stats)) continue;
          yield { pos, stats: l.stats };
        }
      }
      games++;
    }
    if (games % 4000 < CHUNK) process.stderr.write(`  ${games} games\n`);
  }
}

function pct(sorted: number[], p: number): number {
  const i = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

async function main() {
  // --- Pass 1 -------------------------------------------------------------
  const acc = new Map<string, Map<string, Acc>>();
  const rates = new Map<string, number[]>();
  const defEvent = new Map<string, { with: number; all: number }>();
  const rate = (k: string, v: number) => { const a = rates.get(k) ?? []; a.push(v); rates.set(k, a); };
  let n = 0;
  for await (const { pos, stats } of lines()) {
    let m = acc.get(pos);
    if (!m) { m = new Map(); acc.set(pos, m); }
    for (const st of scoredStats(pos, stats)) {
      const a = m.get(st.key) ?? { n: 0, sum: 0, sq: 0 };
      a.n++; a.sum += st.value; a.sq += st.value * st.value;
      m.set(st.key, a);
    }
    // The rate thresholds behind findConcerns, each measured over exactly the
    // population its rule gates on.
    const s = stats;
    if (pos === 'QB' && (s.passAtt ?? 0) >= 25) {
      rate('QB cmpPct @25att', (s.passCmp ?? 0) / (s.passAtt ?? 1));
      rate('QB ypa @25att', (s.passYds ?? 0) / (s.passAtt ?? 1));
    }
    if (pos === 'RB' && (s.rushAtt ?? 0) >= 12) rate('RB ypc @12car', (s.rushYds ?? 0) / (s.rushAtt ?? 1));
    if ((pos === 'WR' || pos === 'TE') && (s.targets ?? 0) >= 7) rate(`${pos} catch @7tgt`, (s.rec ?? 0) / (s.targets ?? 1));
    if (['EDGE', 'DT', 'LB', 'CB', 'S'].includes(pos)) {
      const d = defEvent.get(pos) ?? { with: 0, all: 0 };
      d.all++;
      if ((s.sacks ?? 0) > 0 || (s.defInt ?? 0) > 0 || (s.ff ?? 0) > 0 || (s.pd ?? 0) >= 2) d.with++;
      defEvent.set(pos, d);
    }
    n++;
  }
  console.error(`pass 1: ${n} gated box lines`);
  const shareBelow = (arr: number[], v: number) => 100 * arr.filter((x) => x < v).length / arr.length;
  for (const [k, arr] of rates) {
    arr.sort((a, b) => a - b);
    console.error(`  ${k}: p10=${round(pct(arr, 10))} p25=${round(pct(arr, 25))} p50=${round(pct(arr, 50))} (n=${arr.length})`);
  }
  console.error(`  WR strictly under 0.500 catch rate @7tgt: ${shareBelow(rates.get('WR catch @7tgt') ?? [], 0.5).toFixed(1)}%`);
  console.error(`  TE strictly under 0.500 catch rate @7tgt: ${shareBelow(rates.get('TE catch @7tgt') ?? [], 0.5).toFixed(1)}%`);
  console.error(`  QB at or under 0.575 cmp @25att: ${(100 - shareBelow(rates.get('QB cmpPct @25att') ?? [], 0.5751)).toFixed(1)}% above`);
  for (const [k, d] of defEvent) {
    console.error(`  ${k}: ${(100 * d.with / d.all).toFixed(1)}% of games carry a sack/INT/FF/2+PD (n=${d.all})`);
  }

  const dists = new Map<string, PositionDistribution>();
  for (const [pos, m] of acc) {
    const mean: Record<string, number> = {};
    const sd: Record<string, number> = {};
    let count = 0;
    for (const [k, a] of m) {
      const mu = a.sum / a.n;
      mean[k] = mu;
      sd[k] = Math.sqrt(Math.max(0, a.sq / a.n - mu * mu));
      count = Math.max(count, a.n);
    }
    for (const k of Object.keys(mean)) { mean[k] = round(mean[k]); sd[k] = round(sd[k]); }
    dists.set(pos, { position: pos, n: count, mean, sd });
  }

  // --- Pass 2 -------------------------------------------------------------
  const composites = new Map<string, number[]>();
  for await (const { pos, stats } of lines()) {
    const d = dists.get(pos);
    if (!d) continue;
    const arr = composites.get(pos) ?? [];
    arr.push(positionRelativeScore(pos, stats, d));
    composites.set(pos, arr);
  }

  const order = ['QB', 'RB', 'WR', 'TE', 'EDGE', 'DT', 'LB', 'CB', 'S', 'K'];
  const out: string[] = [];
  out.push('const NORMS: Record<string, PositionDistribution> = {');
  for (const pos of order) {
    const d = dists.get(pos);
    if (!d) continue;
    out.push(`  ${pos}: {`);
    out.push(`    position: '${pos}', n: ${d.n},`);
    out.push(`    mean: { ${Object.entries(d.mean).map(([k, v]) => `${k}: ${round(v)}`).join(', ')} },`);
    out.push(`    sd:   { ${Object.entries(d.sd).map(([k, v]) => `${k}: ${round(v)}`).join(', ')} },`);
    out.push('  },');
  }
  out.push('};');
  out.push('');
  out.push('const COMPOSITE_LADDER: Record<string, number[]> = {');
  for (const pos of order) {
    const arr = composites.get(pos);
    if (!arr) continue;
    arr.sort((a, b) => a - b);
    // NOT rounded. A rounded ladder entry no longer equals the composite the
    // shipped constants produce at runtime, the flat-run rule stops firing on
    // the plateaus it exists for, and every defender who lands on one is
    // reported a tier better than he was. JS prints the shortest string that
    // round-trips to the same double, so these literals are exact.
    out.push(`  ${pos}: [${LEVELS.map((p) => String(pct(arr, p))).join(', ')}], // n=${arr.length}`);
  }
  out.push('};');
  console.log(out.join('\n'));
  await prisma.$disconnect();
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

main().catch((e) => { console.error(e); process.exit(1); });
