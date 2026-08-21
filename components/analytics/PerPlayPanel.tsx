import Link from 'next/link';
import { RateBoard } from '@/lib/analytics';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { Panel, Legend, Note, NotOnRecord, TableTwin } from './Panel';
import { VIZ, clamp, ordinal } from './viz';

/**
 * The war room's second board — what happens on a play, rather than over a game.
 *
 * Every number here is a rate the box score already contains: yards divided by
 * attempts, catches divided by targets, the published NFL passer-rating
 * formula. None of it is modelled and none of it is weighted by anything
 * invented on this screen.
 *
 * A rate needs a volume qualifier or the leaderboard fills with a receiver who
 * caught his only target, so each measure states what qualifies. The qualifier
 * scales with how much of the season has been played — week four does not need
 * a full year's attempts.
 */
export function PerPlayPanel({ boards, leagueId, teamAbbr, gamesPlayed, missingPositions, headline }: {
  boards: RateBoard[];
  leagueId: string;
  teamAbbr: string;
  gamesPlayed: number;
  /** Measures where this club has nobody past the qualifier — a real fact, stated. */
  missingPositions: string[];
  headline: React.ReactNode;
}) {
  const withAny = boards.filter((b) => b.league.length > 0);

  return (
    <Panel
      span={12}
      eyebrow={`Per-play rates against every qualifying player · ${gamesPlayed} games in`}
      title="The Efficiency Room"
      aside="Regular season only"
      why={<>
        Rates, not totals: a back with 1,200 yards on 340 carries and one with 1,000 on 200 are not the same
        player, and only the second column says so. Each strip is every qualifying player in the league, with
        this club&apos;s men marked and named on it.
      </>}
    >
      {withAny.length === 0 ? (
        <p className="text-sm text-muted py-6">
          Nobody in the league has enough attempts yet for a rate to mean anything. This board fills in once a
          few games have been played.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5">
            {withAny.map((b) => <RateStrip key={b.key} b={b} leagueId={leagueId} teamAbbr={teamAbbr} />)}
          </div>

          <Legend
            keys={[
              { color: VIZ.chalk, label: `${teamAbbr} — named on the strip`, shape: 'block' },
              { color: VIZ.muted, label: 'Every other qualifying player', shape: 'line' },
            ]}
            note="The hairline is the mean of the qualifiers"
          />

          <Note>{headline}</Note>

          {missingPositions.length > 0 && (
            <NotOnRecord>
              {teamAbbr} has nobody past the volume qualifier at {missingPositions.join(', ')}. That is a real
              fact about the club — a committee backfield or a spread-out target share — and the strip is left
              without a marker rather than being filled with a player whose sample cannot carry a rate.
            </NotOnRecord>
          )}
          <NotOnRecord>
            Only rostered players appear. A man cut or traded out of the league mid-season keeps his box-score
            lines but loses the roster row that says what position he plays, so he cannot be placed on a
            positional strip and is left off rather than guessed at.
          </NotOnRecord>

          <TableTwin
            caption="Table view — per-play rates"
            columns={['Measure', 'Qualifies', 'Qualifiers', 'League mean', 'League best', `${teamAbbr} best`, 'Rank']}
            rows={withAny.map((b) => [
              b.label,
              b.scope,
              b.league.length,
              `${b.leagueMean.toFixed(b.decimals)}${b.unit}`,
              b.leader ? `${b.leader.name} ${b.leader.value.toFixed(b.decimals)}${b.unit}` : '—',
              b.mine.length ? `${b.mine[0].name} ${b.mine[0].value.toFixed(b.decimals)}${b.unit}` : '—',
              b.mine.length ? `${ordinal(b.mine[0].rank)} of ${b.mine[0].qualified}` : '—',
            ])}
          />
        </>
      )}
    </Panel>
  );
}

function RateStrip({ b, leagueId, teamAbbr }: { b: RateBoard; leagueId: string; teamAbbr: string }) {
  const lo = Math.min(...b.league);
  const hi = Math.max(...b.league);
  const pos = (v: number) => clamp(((v - lo) / (hi - lo || 1)) * 100, 0, 100);
  const best = b.mine[0];
  const good = best && best.rank <= Math.ceil(b.league.length / 4);
  const poor = best && best.rank > b.league.length - Math.ceil(b.league.length / 4);

  return (
    <div>
      <div className="flex justify-between items-baseline text-xs gap-3">
        <span className="min-w-0">
          {b.label}
          <i className="not-italic text-muted text-[10px] ml-1.5">{b.scope}</i>
        </span>
        {best ? (
          <b className={`stat-value text-[17px] shrink-0 ${good ? 'text-accent' : poor ? 'text-bad' : ''}`}>
            {best.value.toFixed(b.decimals)}<i className="not-italic text-[10px] text-muted ml-0.5">{b.unit}</i>
          </b>
        ) : (
          <b className="stat-value text-[17px] text-muted shrink-0">—</b>
        )}
      </div>

      <div className="relative h-5 my-1 rounded bg-raised/65" title={b.definition}>
        {b.league.map((v, i) => (
          <span key={i} className="absolute top-1.5 w-0.5 h-2 -translate-x-px bg-muted/40" style={{ left: `${pos(v)}%` }} />
        ))}
        <span className="absolute top-0.5 bottom-0.5 w-px -translate-x-1/2 bg-muted" style={{ left: `${pos(b.leagueMean)}%` }} />
        {b.mine.map((p) => (
          <span
            key={p.playerId}
            className="absolute top-[3px] w-2.5 h-3.5 rounded-sm -translate-x-1/2 border-2 border-card bg-chalk"
            style={{ left: `${pos(p.value)}%` }}
            title={`${p.name} (${p.position}) · ${p.value.toFixed(b.decimals)}${b.unit} on ${p.volume} · ${ordinal(p.rank)} of ${p.qualified} · ${p.gp} games`}
          />
        ))}
      </div>

      <div className="flex justify-between items-baseline text-[9.5px] text-muted uppercase tracking-[0.06em] gap-2">
        <span className="truncate">
          {b.mine.length === 0 ? (
            <span>{teamAbbr} has nobody qualified</span>
          ) : (
            b.mine.slice(0, 3).map((p, i) => (
              <span key={p.playerId}>
                {i > 0 && ' · '}
                <Link href={`/league/${leagueId}/player/${p.playerId}`} className="text-chalk normal-case tracking-normal hover:underline">
                  {p.name}
                </Link>
                <em className={`not-italic ml-1 ${positionBadgeClass(p.position)} border-0`}>{p.position}</em>
                {' '}{p.value.toFixed(b.decimals)}
              </span>
            ))
          )}
        </span>
        <span className={`shrink-0 font-bold ${good ? 'text-accent' : poor ? 'text-bad' : ''}`}>
          {best ? `${ordinal(best.rank)} of ${best.qualified}` : `${b.league.length} qualified`}
        </span>
      </div>
    </div>
  );
}
