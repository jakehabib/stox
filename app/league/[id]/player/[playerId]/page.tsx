import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { readJson } from '@/lib/json';
import { buildScoutedView } from '@/lib/scouting';
import { ratingColor, ratingTier } from '@/lib/ratings';
import { formatMoney, capHit, remainingValue } from '@/lib/cap';
import { teamCapSummary } from '@/lib/cap-summary';
import { sortStatEntries, statLabel } from '@/lib/statLabels';
import { CutButton } from '@/components/CutButton';
import { ContractActions } from '@/components/ContractActions';
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
    position: player.position as any, trueAttrs: readJson(player.trueAttrs, {}), trueOvr: player.trueOvr, potential: player.potential,
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

  // Your team's current depth at this player's position — the point is
  // answering "do I need a replacement here" without leaving the card,
  // whether you're looking at your own player, a free agent, or a trade
  // target on another roster.
  const depthChart = userTeam
    ? await prisma.depthChartSlot.findMany({
        where: { teamId: userTeam.id, position: player.position },
        orderBy: { rank: 'asc' },
        include: { player: true },
      })
    : [];

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
          {userTeam && (
            <ScoutButton
              leagueId={league.id} teamId={userTeam.id} playerId={player.id}
              alreadyScoutedThisWeek={report?.lastWeek === league.seasonYear * 100 + league.week}
            />
          )}
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

      <div className="grid sm:grid-cols-2 gap-6">
        <div className="card card-pad">
          <h2 className="font-semibold mb-3">Season Stats</h2>
          {Object.keys(seasonStats).length === 0 ? (
            <p className="text-sm text-muted">No stats recorded yet this season.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 text-sm">
              {sortStatEntries(seasonStats).map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-line/50 py-1">
                  <span className="text-muted">{statLabel(k)}</span><span className="font-mono">{v}</span>
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
              {sortStatEntries(careerStats).map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-line/50 py-1">
                  <span className="text-muted">{statLabel(k)}</span><span className="font-mono">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {userTeam && (
          <div className="card card-pad">
            <h2 className="font-semibold mb-3">Your Depth at {player.position}</h2>
            {depthChart.length === 0 ? (
              <p className="text-sm text-muted">Nobody rostered at {player.position} right now — a clear need.</p>
            ) : (
              <div className="space-y-1">
                {depthChart.map((slot) => {
                  const isThisPlayer = slot.playerId === player.id;
                  return (
                    <Link
                      key={slot.id}
                      href={`/league/${league.id}/player/${slot.playerId}`}
                      className={`flex items-center gap-3 px-2 py-1.5 -mx-2 rounded-lg text-sm ${isThisPlayer ? 'bg-accent/10 border border-accent/30' : 'hover:bg-raised'}`}
                    >
                      <span className="label-sm w-5 shrink-0">{slot.rank === 0 ? '1' : slot.rank + 1}</span>
                      <PlayerAvatar seed={slot.playerId} age={slot.player.age} size={22} />
                      <span className={`flex-1 truncate ${isThisPlayer ? 'font-semibold' : ''}`}>{slot.player.firstName} {slot.player.lastName}{isThisPlayer ? ' (this player)' : ''}</span>
                      <span className={`font-mono text-xs ${ratingColor(slot.player.trueOvr)}`}>{slot.player.trueOvr}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="card card-pad">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-semibold">Contract</h2>
            {player.contract?.isRookieDeal && <span className="pill border-accent2/30 text-accent2 bg-accent2/10">Rookie Deal</span>}
            {player.contract?.isFranchiseTag && <span className="pill border-warn/30 text-warn bg-warn/10">Franchise Tag</span>}
          </div>
          {player.contract ? (
            <div className="space-y-4">
              <div>
                <div className="text-3xl font-mono font-bold">{formatMoney(hit)}</div>
                <div className="text-xs text-muted">Cap hit this year</div>
              </div>

              <div>
                <div className="flex gap-1">
                  {Array.from({ length: player.contract.years }, (_, i) => (
                    <div
                      key={i}
                      className={`h-1.5 flex-1 rounded-full ${i < player.contract!.years - player.contract!.yearsRemaining ? 'bg-line' : 'bg-accent'}`}
                    />
                  ))}
                </div>
                <div className="text-xs text-muted mt-1">
                  {player.contract.yearsRemaining} yr{player.contract.yearsRemaining === 1 ? '' : 's'} remaining of {player.contract.years}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm pt-3 border-t border-line/60">
                <div>
                  <div className="label-sm mb-0.5">Remaining Value</div>
                  <div className="font-mono">{formatMoney(remaining)}</div>
                </div>
                <div>
                  <div className="label-sm mb-0.5">Guaranteed</div>
                  <div className="font-mono">{formatMoney(player.contract.guaranteed)}</div>
                </div>
                {player.contract.voidYears > 0 && (
                  <div>
                    <div className="label-sm mb-0.5">Void Years</div>
                    <div className="font-mono text-warn">+{player.contract.voidYears}</div>
                  </div>
                )}
              </div>

              {isOwnRoster && userTeam && (
                <div className="pt-3 space-y-3 border-t border-line/60">
                  <ContractActions
                    leagueId={league.id} playerId={player.id} ovr={view.scoutedOvr} position={player.position} age={player.age}
                    contract={{
                      years: player.contract.years, yearsRemaining: player.contract.yearsRemaining, signedYear: player.contract.signedYear,
                      baseSalaries: player.contract.baseSalaries, signingBonus: player.contract.signingBonus,
                      guaranteed: player.contract.guaranteed, voidYears: player.contract.voidYears,
                    }}
                    availableSpaceForExtension={capSpace + hit} capSpace={capSpace} capMode={settings.capMode}
                  />
                  <CutButton leagueId={league.id} playerId={player.id} />
                </div>
              )}
            </div>
          ) : player.status === 'FREE_AGENT' && !player.isDraftee && userTeam ? (
            <SignOfferForm leagueId={league.id} teamId={userTeam.id} playerId={player.id} ovr={view.scoutedOvr} position={player.position} age={player.age} capSpace={capSpace} capMode={settings.capMode} />
          ) : player.isDraftee ? (
            <p className="text-sm text-muted">This prospect is in the draft pool — he can only be acquired through the rookie draft, not signed as a free agent.</p>
          ) : (
            <p className="text-sm text-muted">No contract on file.</p>
          )}
        </div>
      </div>
    </div>
  );
}
