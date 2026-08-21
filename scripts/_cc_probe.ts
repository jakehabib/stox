import { prisma } from '../lib/db';
import { readJson } from '../lib/json';
import { BoxScore } from '../lib/types';
import { gradeLine, playedEnough, statLine, findConcerns, UNIT_OF, UNIT_ORDER, MENTION_BAR, UnitKey } from '../lib/performanceScore';

async function main() {
  const arg = process.argv[2];
  let leagueId = arg;
  if (!leagueId) {
    const cands = await prisma.team.findMany({ where: { isUser: true }, select: { id: true, leagueId: true, abbr: true } });
    for (const c of cands) {
      const n = await prisma.game.count({ where: { leagueId: c.leagueId, played: true, kind: 'REGULAR', OR: [{ homeTeamId: c.id }, { awayTeamId: c.id }] } });
      if (n >= 8) { console.log('league', c.leagueId, c.abbr, 'user games', n); leagueId = c.leagueId; break; }
    }
  }
  const team = await prisma.team.findFirst({ where: { leagueId, isUser: true } });
  if (!team) { console.log('no user team'); return; }
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId! } });
  const games = await prisma.game.findMany({
    where: { leagueId, played: true, kind: 'REGULAR', seasonYear: league.seasonYear, OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }] },
    orderBy: { week: 'asc' },
  });
  console.log(`\n### ${team.city} ${team.nickname} (${team.abbr}) — ${league.seasonYear}, ${games.length} games`);
  const mix: Record<string, number> = {};
  for (const g of games) {
    const box = readJson<BoxScore>(g.boxScore, null as any);
    if (!box?.lines) continue;
    const isHome = g.homeTeamId === team.id;
    const lines = isHome ? box.lines.home : box.lines.away;
    const mine = isHome ? g.homeScore : g.awayScore;
    const theirs = isHome ? g.awayScore : g.homeScore;
    const graded = lines.map((l) => {
      const pos = String(l.position);
      const gr = gradeLine(pos, l.stats);
      return { l, pos, gr, ok: playedEnough(pos, l.stats) };
    }).filter((x) => x.gr && x.ok);
    const best = new Map<UnitKey, typeof graded[number]>();
    for (const x of graded) {
      const u = UNIT_OF[x.pos]; if (!u) continue;
      const cur = best.get(u);
      if (!cur || x.gr!.score > cur.gr!.score) best.set(u, x);
    }
    const picks = UNIT_ORDER.map((u) => best.get(u)).filter((x): x is typeof graded[number] => !!x && x.gr!.score >= MENTION_BAR).slice(0, 5);
    console.log(`\nWeek ${g.week}  ${mine}-${theirs} ${mine > theirs ? 'W' : 'L'}`);
    for (const p of picks) {
      mix[p.pos] = (mix[p.pos] ?? 0) + 1;
      console.log(`   + ${p.pos.padEnd(4)} ${p.l.name.padEnd(22)} ${p.gr!.score.toFixed(0).padStart(3)}  ${statLine(p.pos, p.l.stats)}   [hl ${p.gr!.headline?.key ?? '-'} ${p.gr!.headline?.pct.toFixed(0) ?? ''}]`);
    }
    const concerns = graded.flatMap((x) => findConcerns(x.pos, x.l.stats).map((c) => ({ ...c, name: x.l.name, pos: x.pos })))
      .sort((a, b) => b.severity - a.severity).slice(0, 3);
    for (const c of concerns) console.log(`   - ${c.pos.padEnd(4)} ${c.name.padEnd(22)} ${c.kind}: ${c.fact} (sev ${c.severity.toFixed(0)})`);
  }
  console.log('\nPOSITION MIX:', JSON.stringify(mix));
}
main().then(() => process.exit(0));
