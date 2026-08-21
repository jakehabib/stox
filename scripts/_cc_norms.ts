import { prisma } from '../lib/db';
import { readJson } from '../lib/json';
import { BoxScore } from '../lib/types';

const LEVELS = [1, 5, 10, 25, 50, 75, 90, 95, 99];

const WANT: Record<string, string[]> = {
  QB: ['passYds','passTd','int','rushYds'],
  RB: ['rushYds','rushTd','rec','recYds'],
  WR: ['recYds','rec','recTd','targets'],
  TE: ['recYds','rec','recTd','targets'],
  EDGE: ['tackles','sacks','ff'],
  DT: ['tackles','sacks','ff'],
  LB: ['tackles','ff'],
  CB: ['tackles','defInt','pd','ff'],
  S: ['tackles','defInt','pd','ff'],
  K: ['fgm','xpm'],
};
// efficiency: [name, num, den, gateDen]
const EFF: Record<string, [string, string, string, number][]> = {
  QB: [['cmpPct','passCmp','passAtt',15], ['ypa','passYds','passAtt',15]],
  RB: [['ypc','rushYds','rushAtt',8]],
  WR: [['catchRate','rec','targets',4]],
  TE: [['catchRate','rec','targets',4]],
  K: [['fgPct','fgm','fga',2]],
};

function q(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

async function main() {
  const games = await prisma.game.findMany({ where: { played: true }, select: { boxScore: true }, orderBy: { id: 'asc' } });
  const acc = new Map<string, Map<string, number[]>>();
  let lines = 0;
  for (const g of games) {
    const box = readJson<BoxScore>(g.boxScore, null as any);
    if (!box?.lines) continue;
    for (const l of [...(box.lines.home ?? []), ...(box.lines.away ?? [])]) {
      const pos = String(l.position);
      const want = WANT[pos];
      if (!want) continue;
      lines++;
      let m = acc.get(pos); if (!m) { m = new Map(); acc.set(pos, m); }
      for (const k of want) {
        let a = m.get(k); if (!a) { a = []; m.set(k, a); }
        a.push(((l.stats as any)[k] ?? 0) as number);
      }
      for (const [name, num, den, gate] of EFF[pos] ?? []) {
        const d = ((l.stats as any)[den] ?? 0) as number;
        if (d < gate) continue;
        const n = ((l.stats as any)[num] ?? 0) as number;
        let a = m.get(name); if (!a) { a = []; m.set(name, a); }
        a.push(n / d);
      }
    }
  }
  console.log(`// games=${games.length} lines=${lines}`);
  const out: Record<string, Record<string, number[]>> = {};
  for (const [pos, m] of [...acc.entries()].sort()) {
    out[pos] = {};
    for (const [k, arr] of m.entries()) {
      const s = [...arr].sort((a, b) => a - b);
      const isRate = k === 'cmpPct' || k === 'ypa' || k === 'catchRate' || k === 'fgPct' || k === 'ypc';
      out[pos][k] = LEVELS.map((p) => isRate ? Math.round(q(s, p) * 1000) / 1000 : q(s, p));
      console.log(`  ${pos} ${k.padEnd(10)} n=${s.length} -> ${JSON.stringify(out[pos][k])}`);
    }
  }
  console.log('\nJSON:\n' + JSON.stringify(out));
}
main().then(() => process.exit(0));
