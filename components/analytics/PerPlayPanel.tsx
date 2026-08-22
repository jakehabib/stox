import Link from 'next/link';
import { RateBoard } from '@/lib/analytics';
import { GlossaryKey, tip } from '@/lib/glossary';
import { Tooltip } from '@/components/Tooltip';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { Panel, Legend, Note, NotOnRecord, TableTwin } from './Panel';
import { VIZ, clamp, ordinal } from './viz';

/**
 * Each rate on this board to the term the rest of the app already uses for it.
 * Every one of these ten is a stat the player page, the stats screen and the
 * career table also print, so not one of them gets a second definition written
 * here — "yards per attempt" means the same thing in this room as it does on
 * a player's card, and a rewrite of that sentence lands on both.
 */
const RATE_TERM: Record<string, GlossaryKey> = {
  ya: 'yardsPerAttempt',
  cmpPct: 'completionPct',
  rating: 'passerRating',
  tdPct: 'tdRate',
  intPct: 'intRate',
  ypc: 'yardsPerCarry',
  ypt: 'yardsPerTouch',
  catchRate: 'catchRate',
  ypr: 'yardsPerReception',
  ypTgt: 'yardsPerTarget',
};

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
      tip={tip('rateQualifier')}
      aside="Regular season only"
      why={<>
        Rates, not totals: a back with 1,200 yards on 340 carries and one with 1,000 on 200 are not the same
        player, and only the second column says so. Each strip is every qualifying player in the league, with
        this club&apos;s men marked and named on it.
      </>}
    >
      {withAny.length === 0 ? (
        <p className="text-sm text-muted py-6">
          Nobody in the league has the attempts yet for a rate to mean anything. This board fills in once a few
          games have been played.
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
            tip={tip('leagueSpread')}
          />

          <Note>{headline}</Note>

          {missingPositions.length > 0 && (
            <NotOnRecord>
              {teamAbbr} has nobody with the volume to qualify at {missingPositions.join(', ')} — usually a
              committee backfield or a target share spread too thin. The strip stays unmarked rather than naming a
              man off a handful of touches.
            </NotOnRecord>
          )}
          <NotOnRecord>
            Only men still in the league appear. Once a player is gone we lose the position that puts him on the
            right strip, so his season drops off these boards.
          </NotOnRecord>

          <TableTwin
            caption="Per-play rates, in numbers"
            columns={['Measure', 'Qualifies', 'Qualifiers', 'League mean', 'League best', `${teamAbbr} best`, 'Rank']}
            tips={{ Qualifies: tip('rateQualifier'), Rank: tip('leagueSpread') }}
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
  const term = RATE_TERM[b.key];
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
          {/* Downward, and pinned to its own left edge: these strips sit two to
              a row with another strip directly above, and the distribution bar
              below is always there to open into. */}
          {term && <Tooltip text={tip(term)} placement="bottom" align="start" className="ml-1.5 align-[1px]" />}
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
