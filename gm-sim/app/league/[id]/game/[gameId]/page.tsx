import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { readJson } from '@/lib/json';
import { BoxScore } from '@/lib/types';

export default async function GamePage({ params }: { params: { id: string; gameId: string } }) {
  const { league } = await getLeagueContext(params.id);
  const game = await prisma.game.findUnique({ where: { id: params.gameId }, include: { homeTeam: true, awayTeam: true } });
  if (!game || game.leagueId !== league.id || !game.played) notFound();

  const box = readJson<BoxScore>(game.boxScore, null as any);

  const StatRow = ({ label, home, away }: { label: string; home: string | number; away: string | number }) => (
    <div className="grid grid-cols-3 text-sm py-1.5 border-b border-line/50">
      <span className="font-mono">{away}</span>
      <span className="text-muted text-center">{label}</span>
      <span className="font-mono text-right">{home}</span>
    </div>
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="card card-pad">
        <div className="flex items-center justify-between">
          <TeamScore name={`${game.awayTeam.city} ${game.awayTeam.nickname}`} abbr={game.awayTeam.abbr} score={game.awayScore} won={game.awayScore > game.homeScore} />
          <div className="text-muted text-sm px-4">Week {game.week} · {game.kind}</div>
          <TeamScore name={`${game.homeTeam.city} ${game.homeTeam.nickname}`} abbr={game.homeTeam.abbr} score={game.homeScore} won={game.homeScore > game.awayScore} align="right" />
        </div>
      </div>

      <div className="card card-pad">
        <h2 className="font-semibold mb-2">Recap</h2>
        <p className="text-sm leading-relaxed text-chalk/90">{game.recap}</p>
      </div>

      {box && (
        <div className="card card-pad">
          <h2 className="font-semibold mb-2">Team Stats</h2>
          <div className="grid grid-cols-3 text-xs text-muted pb-1">
            <span>{game.awayTeam.abbr}</span><span className="text-center"> </span><span className="text-right">{game.homeTeam.abbr}</span>
          </div>
          <StatRow label="Total Yards" away={box.teamStats.away.totalYards} home={box.teamStats.home.totalYards} />
          <StatRow label="Pass Yards" away={box.teamStats.away.passYards} home={box.teamStats.home.passYards} />
          <StatRow label="Rush Yards" away={box.teamStats.away.rushYards} home={box.teamStats.home.rushYards} />
          <StatRow label="Turnovers" away={box.teamStats.away.turnovers} home={box.teamStats.home.turnovers} />
          <StatRow label="Sacks Allowed" away={box.teamStats.away.sacks} home={box.teamStats.home.sacks} />
          <StatRow label="Penalties" away={box.teamStats.away.penalties} home={box.teamStats.home.penalties} />
        </div>
      )}

      {box && (
        <div className="grid md:grid-cols-2 gap-4">
          <BoxLines title={`${game.awayTeam.abbr} Leaders`} lines={box.lines.away} />
          <BoxLines title={`${game.homeTeam.abbr} Leaders`} lines={box.lines.home} />
        </div>
      )}
    </div>
  );
}

function TeamScore({ name, abbr, score, won, align = 'left' }: { name: string; abbr: string; score: number; won: boolean; align?: 'left' | 'right' }) {
  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <div className="text-xs text-muted">{abbr}</div>
      <div className={`text-3xl font-mono font-bold ${won ? 'text-accent' : 'text-chalk'}`}>{score}</div>
      <div className="text-xs text-muted">{name}</div>
    </div>
  );
}

function BoxLines({ title, lines }: { title: string; lines: BoxScore['lines']['home'] }) {
  const notable = lines.filter((l) => Object.values(l.stats).some((v) => (v ?? 0) > 0)).slice(0, 8);
  return (
    <div className="card card-pad">
      <h3 className="font-semibold mb-2 text-sm">{title}</h3>
      <div className="space-y-1.5 text-sm">
        {notable.map((l) => (
          <div key={l.playerId} className="flex justify-between gap-2">
            <span className="truncate">{l.name} <span className="text-muted text-xs">{l.position}</span></span>
            <span className="text-muted text-xs text-right shrink-0">{summarizeLine(l.stats)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function summarizeLine(s: BoxScore['lines']['home'][number]['stats']): string {
  const parts: string[] = [];
  if (s.passAtt) parts.push(`${s.passCmp}/${s.passAtt}, ${s.passYds}yd, ${s.passTd}TD`);
  if ((s.rushAtt ?? 0) > 2) parts.push(`${s.rushAtt}car, ${s.rushYds}yd`);
  if ((s.rec ?? 0) > 0) parts.push(`${s.rec}rec, ${s.recYds}yd`);
  if ((s.tackles ?? 0) > 0) parts.push(`${s.tackles}tkl`);
  if ((s.sacks ?? 0) > 0) parts.push(`${s.sacks}sk`);
  if ((s.defInt ?? 0) > 0) parts.push(`${s.defInt}int`);
  if ((s.fgm ?? 0) > 0) parts.push(`${s.fgm}/${s.fga} FG`);
  return parts.join(' · ');
}
