import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { readJson } from '@/lib/json';
import { BoxScore } from '@/lib/types';
import { TeamLogo } from '@/components/TeamLogo';
import { computeGameShape, marginPhrase, wentToOvertime } from '@/lib/gameShape';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { GameShapePath, ArchetypeTag, QuarterAxis } from '@/components/ds/GameShapePath';
import { QuarterLinescore } from '@/components/ds/QuarterLinescore';

export default async function GamePage({ params }: { params: { id: string; gameId: string } }) {
  const { league, userTeam } = await getLeagueContext(params.id);
  const game = await prisma.game.findUnique({ where: { id: params.gameId }, include: { homeTeam: true, awayTeam: true } });
  if (!game || game.leagueId !== league.id || !game.played) notFound();

  const box = readJson<BoxScore>(game.boxScore, null as any);

  // The silhouette is drawn from whichever side the reader has a stake in —
  // their own club when they played in this game, the home team otherwise.
  // Comeback and Collapse are the same game seen from opposite benches, so
  // the perspective has to be chosen rather than assumed.
  const perspective: 'home' | 'away' = userTeam && game.awayTeamId === userTeam.id ? 'away' : 'home';
  const shape = computeGameShape(box, perspective);
  const perspectiveTeam = perspective === 'home' ? game.homeTeam : game.awayTeam;
  const shapeColor = generateTeamLogoParams(perspectiveTeam.abbr).primary;
  const overtime = wentToOvertime(box);
  const margin = Math.abs(game.homeScore - game.awayScore);

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
          <TeamScore id={game.awayTeam.id} name={`${game.awayTeam.city} ${game.awayTeam.nickname}`} abbr={game.awayTeam.abbr} score={game.awayScore} won={game.awayScore > game.homeScore} />
          <div className="text-center px-3 shrink-0">
            {shape && <ArchetypeTag shape={shape} />}
            <div className="text-muted text-sm mt-1">Week {game.week} · {game.kind}</div>
            <div className="font-mono text-[11px] text-muted mt-0.5">
              {margin === 0 ? 'tied' : marginPhrase(margin)}
              {overtime && <span className="text-accent2"> · OT</span>}
            </div>
          </div>
          <TeamScore id={game.homeTeam.id} name={`${game.homeTeam.city} ${game.homeTeam.nickname}`} abbr={game.homeTeam.abbr} score={game.homeScore} won={game.homeScore > game.awayScore} align="right" />
        </div>
      </div>

      {shape && (
        <div className="card card-pad" style={{ ['--team-accent' as never]: shapeColor }}>
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <h2 className="font-semibold">How it happened</h2>
            <span className="label-sm">
              {perspectiveTeam.abbr} score differential · {shape.points.length - 1} drives
            </span>
          </div>
          <GameShapePath shape={shape} color={shapeColor} width={640} height={150} variant="full" />
          <QuarterAxis shape={shape} width={640} />
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 pt-3 border-t border-line/60">
            <ShapeFact label="Shape" value={shape.archetype} />
            <ShapeFact label="Lead changes" value={String(shape.leadChanges)} />
            <ShapeFact label="Biggest lead" value={shape.largestLead > 0 ? `${perspectiveTeam.abbr} +${shape.largestLead}` : 'never led'} />
            <ShapeFact label="Biggest deficit" value={shape.largestDeficit > 0 ? `${perspectiveTeam.abbr} -${shape.largestDeficit}` : 'never trailed'} />
            <ShapeFact
              label="Swing index"
              value={`${shape.drama}`}
              hint="Sum of every score swing, weighted by how late it came and how close the game was — a curiosity, not a rating."
            />
          </div>
        </div>
      )}

      {box?.quarters && (
        <div className="card card-pad">
          <QuarterLinescore
            away={{ teamId: game.awayTeam.id, abbr: game.awayTeam.abbr, score: game.awayScore }}
            home={{ teamId: game.homeTeam.id, abbr: game.homeTeam.abbr, score: game.homeScore }}
            quarters={box.quarters}
            overtime={overtime}
          />
        </div>
      )}

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
          <BoxLines leagueId={league.id} title={`${game.awayTeam.abbr} Leaders`} lines={box.lines.away} />
          <BoxLines leagueId={league.id} title={`${game.homeTeam.abbr} Leaders`} lines={box.lines.home} />
        </div>
      )}
    </div>
  );
}

function ShapeFact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div title={hint}>
      <div className="label-sm">{label}</div>
      <div className="font-display font-bold text-sm mt-0.5">{value}</div>
    </div>
  );
}

function TeamScore({ id, name, abbr, score, won, align = 'left' }: { id: string; name: string; abbr: string; score: number; won: boolean; align?: 'left' | 'right' }) {
  return (
    <div className={`flex items-center gap-3 ${align === 'right' ? 'text-right flex-row-reverse' : ''}`}>
      <TeamLogo seed={id} abbr={abbr} size={44} />
      <div>
        <div className="text-xs text-muted">{abbr}</div>
        <div className={`text-3xl font-mono font-bold ${won ? 'text-accent' : 'text-chalk'}`}>{score}</div>
        <div className="text-xs text-muted">{name}</div>
      </div>
    </div>
  );
}

/**
 * THE NAME IS A DOOR — see DepthChartGroup, which had this same hole and had
 * it fixed. The box score was the last screen in the game where you could read
 * what a man did on Sunday and not be able to look at him: `playerId` was
 * already here, spent on the React key and nothing else, while the whole page
 * carried no link of any kind. It is also the screen where the reason to open
 * a player card is strongest — you have just watched him have the game.
 */
function BoxLines({ leagueId, title, lines }: { leagueId: string; title: string; lines: BoxScore['lines']['home'] }) {
  const notable = lines.filter((l) => Object.values(l.stats).some((v) => (v ?? 0) > 0)).slice(0, 8);
  return (
    <div className="card card-pad">
      <h3 className="font-semibold mb-2 text-sm">{title}</h3>
      <div className="space-y-1.5 text-sm">
        {notable.map((l) => (
          <div key={l.playerId} className="flex justify-between gap-2">
            {/* Stats, not contract: you arrived here from a result, and what
                you want is the rest of his season. */}
            <Link href={`/league/${leagueId}/player/${l.playerId}`} className="truncate hover:text-accent2">
              {l.name} <span className="text-muted text-xs">{l.position}</span>
            </Link>
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
