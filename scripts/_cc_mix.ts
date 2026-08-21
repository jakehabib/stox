import { prisma } from '../lib/db';
import { readJson } from '../lib/json';
import { BoxScore } from '../lib/types';
import { gradeLine, playedEnough, statLine, UNIT_OF, UNIT_ORDER, MENTION_BAR, UnitKey } from '../lib/performanceScore';

async function main() {
  const teams = await prisma.team.findMany({ where: { isUser: true }, select: { id: true, leagueId: true, abbr: true } });
  const mix: Record<string, number> = {};
  const unitMix: Record<string, number> = {};
  let weeks = 0, empty = 0;
  const perLeague: string[] = [];
  for (const t of teams) {
    const league = await prisma.league.findUnique({ where: { id: t.leagueId } });
    if (!league) continue;
    const games = await prisma.game.findMany({
      where: { leagueId: t.leagueId, played: true, kind: 'REGULAR', OR: [{ homeTeamId: t.id }, { awayTeamId: t.id }] },
      orderBy: [{ seasonYear: 'asc' }, { week: 'asc' }],
    });
    if (games.length < 4) continue;
    const lmix: Record<string, number> = {};
    for (const g of games) {
      const box = readJson<BoxScore>(g.boxScore, null as any);
      if (!box?.lines) continue;
      weeks++;
      const lines = g.homeTeamId === t.id ? box.lines.home : box.lines.away;
      const best = new Map<UnitKey, { pos: string; score: number }>();
      for (const l of lines) {
        const pos = String(l.position);
        if (!playedEnough(pos, l.stats)) continue;
        const gr = gradeLine(pos, l.stats);
        if (!gr) continue;
        const u = UNIT_OF[pos]; if (!u) continue;
        const cur = best.get(u);
        if (!cur || gr.score > cur.score) best.set(u, { pos, score: gr.score });
      }
      const picks = UNIT_ORDER.map((u) => best.get(u)).filter((x): x is { pos: string; score: number } => !!x && x.score >= MENTION_BAR).slice(0, 5);
      if (picks.length === 0) empty++;
      for (const p of picks) { mix[p.pos] = (mix[p.pos] ?? 0) + 1; lmix[p.pos] = (lmix[p.pos]??0)+1; unitMix[UNIT_OF[p.pos]] = (unitMix[UNIT_OF[p.pos]] ?? 0) + 1; }
    }
    perLeague.push(`${t.abbr} ${games.length}g ${JSON.stringify(lmix)}`);
  }
  console.log('weeks sampled', weeks, 'weeks with no mention', empty, `(${(100*empty/weeks).toFixed(1)}%)`);
  const total = Object.values(mix).reduce((a,b)=>a+b,0);
  console.log('mentions', total, 'avg per week', (total/weeks).toFixed(2));
  console.log('POSITION MIX:', Object.entries(mix).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${v} (${(100*v/total).toFixed(1)}%)`).join(', '));
  console.log('UNIT MIX   :', Object.entries(unitMix).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${v} (${(100*v/total).toFixed(1)}%)`).join(', '));
  console.log(perLeague.slice(0, 12).join('\n'));
}
main().then(()=>process.exit(0));
