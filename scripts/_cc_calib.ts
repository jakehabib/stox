import { prisma } from '../lib/db';
import { readJson } from '../lib/json';
import { BoxScore } from '../lib/types';
import { gradeLine, playedEnough } from '../lib/performanceScore';

const LEVELS = [1,5,10,25,50,75,90,95,99];
function q(s: number[], p: number) { const i = Math.min(s.length-1, Math.max(0, Math.round((p/100)*(s.length-1)))); return s[i]; }

async function main() {
  const games = await prisma.game.findMany({ where: { played: true }, select: { boxScore: true }, orderBy: { id: 'asc' } });
  const acc = new Map<string, number[]>();
  for (const g of games) {
    const box = readJson<BoxScore>(g.boxScore, null as any);
    if (!box?.lines) continue;
    for (const l of [...(box.lines.home ?? []), ...(box.lines.away ?? [])]) {
      const pos = String(l.position);
      if (!playedEnough(pos, l.stats)) continue;
      const gr = gradeLine(pos, l.stats);
      if (!gr) continue;
      let a = acc.get(pos); if (!a) { a = []; acc.set(pos, a); }
      a.push(gr.score);
    }
  }
  const out: Record<string, number[]> = {};
  for (const [pos, arr] of [...acc.entries()].sort()) {
    const s = arr.sort((a,b)=>a-b);
    out[pos] = LEVELS.map((p)=>Math.round(q(s,p)*10)/10);
    const over72 = s.filter(v=>v>=72).length/s.length;
    console.log(`${pos.padEnd(5)} n=${String(s.length).padStart(7)} ladder=${JSON.stringify(out[pos])}  P(>=72)=${(100*over72).toFixed(1)}%`);
  }
  console.log(JSON.stringify(out));
}
main().then(()=>process.exit(0));
