import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { readJson } from '@/lib/json';
import { buildScoutedView } from '@/lib/scouting';
import { ratingColor, ratingTier } from '@/lib/ratings';
import { formatMoney, capHit, remainingValue } from '@/lib/cap';
import { teamCapSummary } from '@/lib/cap-summary';
import { CutButton } from '@/components/CutButton';
import { ScoutButton } from '@/components/ScoutButton';
import { SignOfferForm } from '@/components/SignOfferForm';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { TeamLogo } from '@/components/TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

export default async function PlayerPage({ params }: { params: { id: string; playerId: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const player = await prisma.player.findUnique({ where: { id: params.playerId }, include: { contract: true, team: true } });
  if (!player || player.leagueId !== league.id) notFound();

  const report = userTeam
    ? await prisma.scoutingReport.findUnique({ where: { playerId_teamId: { playerId: player.id, teamId: userTeam.id } } })
    : null;

  const isOwnRoster = player.teamId === userTeam?.id;
  const view = buildScoutedView({
    position: player.position as any, trueAttrs: readJson(player.trueAttrs, {}), trueOvr: player.trueOvr,
    report, settings, isOwnRoster, isUserView: true,
  });

  const seasonStats = readJson<Record<string, number>>(player.seasonStats, {});
  const careerStats = readJson<Record<string, number>>(player.careerStats, {});
  const hit = capHit(player.contract, settings.capMode);
  const remaining = player.contract ? remainingValue(player.contract, settings.capMode) : 0;
  const capSpace = userTeam && settings.capMode !== 'OFF'
    ? (await teamCapSummary(userTeam.id, league.seasonYear, settings.capMode)).capSpace
    : Number.MAX_SAFE_INTEGER;

  const jerseyColor = player.team ? generateTeamLogoParams(player.team.id).primary : undefined;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <PlayerAvatar seed={player.id} age={player.age} size={88} teamColor={jerseyColor} />
          <div>
            <div className="text-xs text-muted mb-1 flex items-center gap-1.5">
              {player.position} ·
              {player.team ? (
                <span className="flex items-center gap-1.5"><TeamLogo seed={player.team.id} abbr={player.team.abbr} size={16} /> {player.team.city} {player.team.nickname}</span>
              ) : player.status === 'FREE_AGENT' ? 'Free Agent' : player.status}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{player.firstName} {player.lastName}</h1>
            <p className="text-muted text-sm mt-1">
              Age {player.age} · {Math.floor(player.heightIn / 12)}'{player.heightIn % 12}" · {player.weightLb} lb · {player.college}
              {player.experience > 0 ? ` · Yr ${player.experience}` : ' · Rookie'}
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-4xl font-mono font-bold ${ratingColor(view.scoutedOvr)}`}>
            {view.revealed ? view.scoutedOvr : `${view.ovrLow}-${view.ovrHigh}`}
          </div>
          <div className={`text-xs ${ratingTier(view.scoutedOvr).className}`}>{ratingTier(view.scoutedOvr).label}</div>
        </div>
      </div>

      {!view.revealed && (
        <div className="card card-pad flex items-center justify-between gap-4 bg-raised/40">
          <div>
            <div className="text-sm font-medium">Scouting confidence: {Math.round(view.confidence)}%</div>
            <p className="text-xs text-muted mt-1 max-w-lg">{view.notes}</p>
          </div>
          {userTeam && <ScoutButton leagueId={league.id} teamId={userTeam.id} playerId={player.id} />}
        </div>
      )}

      <div className="card card-pad">
        <h2 className="font-semibold mb-4">Attributes {view.revealed ? '' : <span className="text-xs text-muted font-normal ml-1">(scouted range shown — true values hidden)</span>}</h2>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
          {view.attrs.map((a) => (
            <div key={a.key} className="flex items-center gap-3">
              <span className="text-sm text-muted w-36 shrink-0">{a.label}</span>
              <div className="flex-1 h-2 bg-raised rounded-full overflow-hidden relative">
                <div
                  className="absolute h-full bg-line rounded-full"
                  style={{ left: `${a.low}%`, width: `${Math.max(2, a.high - a.low)}%` }}
                />
                <div className="absolute h-full w-0.5 bg-accent2" style={{ left: `${a.observed}%` }} />
              </div>
              <span className={`text-sm font-mono w-14 text-right ${ratingColor(a.observed)}`}>
                {view.revealed ? a.actual : `${a.low}-${a.high}`}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="card card-pad">
          <h2 className="font-semibold mb-3">Season Stats</h2>
          {Object.keys(seasonStats).length === 0 ? (
            <p className="text-sm text-muted">No stats recorded yet this season.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 text-sm">
              {Object.entries(seasonStats).map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-line/50 py-1">
                  <span className="text-muted">{k}</span><span className="font-mono">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card card-pad">
          <h2 className="font-semibold mb-3">Career Stats</h2>
          {Object.keys(careerStats).length === 0 ? (
            <p className="text-sm text-muted">No career stats on file yet — these accumulate as full seasons complete.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 text-sm">
              {Object.entries(careerStats).map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-line/50 py-1">
                  <span className="text-muted">{k}</span><span className="font-mono">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card card-pad">
          <h2 className="font-semibold mb-3">Contract</h2>
          {player.contract ? (
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted">Cap hit (this yr)</span><span className="font-mono">{formatMoney(hit)}</span></div>
              <div className="flex justify-between"><span className="text-muted">Years remaining</span><span className="font-mono">{player.contract.yearsRemaining}</span></div>
              <div className="flex justify-between"><span className="text-muted">Remaining value</span><span className="font-mono">{formatMoney(remaining)}</span></div>
              <div className="flex justify-between"><span className="text-muted">Guaranteed</span><span className="font-mono">{formatMoney(player.contract.guaranteed)}</span></div>
              {isOwnRoster && userTeam && (
                <div className="pt-3">
                  <CutButton leagueId={league.id} playerId={player.id} />
                </div>
              )}
            </div>
          ) : player.status === 'FREE_AGENT' && userTeam ? (
            <SignOfferForm leagueId={league.id} teamId={userTeam.id} playerId={player.id} ovr={view.scoutedOvr} position={player.position} age={player.age} capSpace={capSpace} capMode={settings.capMode} />
          ) : (
            <p className="text-sm text-muted">No contract on file.</p>
          )}
        </div>
      </div>
    </div>
  );
}
