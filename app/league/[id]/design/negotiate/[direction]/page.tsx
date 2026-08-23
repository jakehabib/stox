import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { resolveNegotiationSession } from '@/lib/freeagency';
import { capHit } from '@/lib/cap';
import { teamCapSummary } from '@/lib/cap-summary';
import type { NegotiationMode } from '@/lib/negotiation';
import { DesignNegotiationScreen, type DirectionKey } from '@/components/negotiate/DesignNegotiationScreen';
import type { NegotiationSubject } from '@/components/negotiate/frame';
import { DIRECTIONS } from './directions';

/**
 * One direction, one man, one table — at a URL, on real data.
 *
 * WHICH TABLE THIS IS, IS READ OFF HIM AND NEVER OFF A QUERY STRING. An
 * outside free agent is free agency's negotiation, your own man with a season
 * or less left is the re-sign window's, and a man with real years still
 * running is an extension. Those are the same three cases the live app splits
 * on, and each of the Server Actions this screen submits to re-checks its own
 * case anyway — so a hand-typed URL cannot route a negotiation into the wrong
 * one of them.
 */
export default async function NegotiationDesignPage({ params, searchParams }: {
  params: { id: string; direction: string };
  searchParams?: { player?: string };
}) {
  const direction = DIRECTIONS.find((d) => d.key === params.direction);
  if (!direction) notFound();

  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;
  const playerId = searchParams?.player;
  if (!playerId) {
    return <Missing leagueId={league.id} message="No player named. Pick one from the index." />;
  }

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { contract: true },
  });
  if (!player || player.leagueId !== league.id) {
    return <Missing leagueId={league.id} message="No such player in this save." />;
  }

  const yearsRemaining = player.contract?.yearsRemaining ?? 0;
  let mode: NegotiationMode;
  if (player.status === 'FREE_AGENT' && player.teamId === null) {
    mode = 'FREE_AGENT';
  } else if (player.teamId === team.id) {
    mode = yearsRemaining >= 2 ? 'EXTENSION' : 'RESIGN';
  } else {
    return <Missing leagueId={league.id} message="He is under contract to another club. Trade for him, or wait." />;
  }

  const session = await resolveNegotiationSession({
    leagueId: league.id,
    playerId,
    teamId: team.id,
    seasonYear: league.seasonYear,
    settings,
    incumbent: mode !== 'FREE_AGENT',
    mode,
  });

  const subject: NegotiationSubject = {
    playerId,
    name: `${player.firstName} ${player.lastName}`,
    position: player.position,
    age: player.age,
    // Scouting fog is draft prospects only, so this is the figure every other
    // screen shows for a free agent or a man on your roster.
    ovr: player.trueOvr,
    weightLb: player.weightLb,
    heightIn: player.heightIn,
    currentCapHit: player.contract ? capHit(player.contract, settings.capMode) : null,
    // The room the page header is showing, so the panel and the header cannot
    // quote two different figures for the same club on the same screen.
    capSpaceNow: settings.capMode === 'OFF'
      ? null
      : (await teamCapSummary(team.id, league.seasonYear, settings.capMode)).capSpace,
    team: { id: team.id, abbr: team.abbr, city: team.city, nickname: team.nickname },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Link href={`/league/${league.id}/design/negotiate`} className="btn-ghost text-xs">← All three directions</Link>
        <div className="flex gap-1.5">
          {DIRECTIONS.map((d) => (
            <Link
              key={d.key}
              href={`/league/${league.id}/design/negotiate/${d.key}?player=${playerId}`}
              className={d.key === direction.key ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
            >
              {d.name}
            </Link>
          ))}
        </div>
        <span className="text-xs text-muted">{direction.pitch}</span>
      </div>

      <DesignNegotiationScreen
        leagueId={league.id}
        direction={direction.key as DirectionKey}
        session={session}
        subject={subject}
        capMode={settings.capMode}
        returnTo={{ href: `/league/${league.id}/design/negotiate`, label: 'the design index' }}
      />
    </div>
  );
}

function Missing({ leagueId, message }: { leagueId: string; message: string }) {
  return (
    <div className="panel p-5 space-y-3">
      <p className="text-sm text-muted">{message}</p>
      <Link href={`/league/${leagueId}/design/negotiate`} className="btn-secondary text-sm">Back to the index</Link>
    </div>
  );
}
