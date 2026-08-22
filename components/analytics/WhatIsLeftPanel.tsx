import { TeamLogo } from '@/components/TeamLogo';
import { tip } from '@/lib/glossary';
import { Panel, Note, NotOnRecord, Tiles, Tile, SubHead, TableTwin } from './Panel';
import { rate3, signed } from './viz';

export interface RemainingGame {
  week: number;
  home: boolean;
  oppId: string;
  oppAbbr: string;
  oppName: string;
  oppNickname: string;
  oppWins: number;
  oppLosses: number;
  oppTies: number;
  oppRating: number;
  oppRank: number;
  winPct: number;
  factors: { label: string; points: number; detail: string }[];
}

/**
 * Panel 5 — what is left, and what the club's own win estimator makes of it.
 *
 * The projection is the sum of estimateGameWinChance() over the remaining
 * fixtures — the identical call the schedule screen makes, factor for factor.
 * It is the only forecast on this page, and it is a sum of the game's own
 * numbers rather than a model built here.
 */
export function WhatIsLeftPanel({ remaining, sosPlayed, remainingOppWinRate, record, seasonLength, division, divisionLabel, teamId }: {
  remaining: RemainingGame[];
  sosPlayed: { sos: number; opponents: number };
  remainingOppWinRate: number | null;
  record: { wins: number; losses: number; ties: number };
  seasonLength: number;
  division: { teamId: string; abbr: string; name: string; wins: number; losses: number; ties: number; pct: number; isUser: boolean }[];
  divisionLabel: string;
  teamId: string;
}) {
  const projectedExtra = remaining.reduce((a, r) => a + r.winPct / 100, 0);
  const projWins = record.wins + record.ties * 0.5 + projectedExtra;
  const projLosses = seasonLength - projWins;
  const allAway = remaining.length > 0 && remaining.every((r) => !r.home);
  const allHome = remaining.length > 0 && remaining.every((r) => r.home);

  return (
    <Panel
      span={5}
      eyebrow="Played and remaining"
      title="What Is Left"
      flag={allAway ? { text: `All ${remaining.length} on the road`, tone: 'warn' }
        : allHome ? { text: `All ${remaining.length} at home`, tone: 'good' } : undefined}
      aside={remaining.length ? `${remaining.length} to play` : undefined}
      why={<>
        Win chance per game is the same estimate the schedule screen shows, factor for factor — roster gap,
        unit matchup, form, home field. Summed, it is the only forecast on this page.
      </>}
    >
      <Tiles cols={3}>
        <Tile
          label="Opponents played"
          value={sosPlayed.opponents ? rate3(sosPlayed.sos) : '—'}
          detail={sosPlayed.opponents ? `combined win rate, ${sosPlayed.opponents} games` : 'no games played yet'}
          tip={tip('strengthOfSchedule')}
          tipAlign="start"
        />
        <Tile
          label="Opponents left"
          value={remainingOppWinRate === null ? '—' : rate3(remainingOppWinRate)}
          detail={remainingOppWinRate === null || !sosPlayed.opponents
            ? 'nothing to compare it against yet'
            : `${remainingOppWinRate >= sosPlayed.sos ? 'harder' : 'easier'} by ${Math.abs((remainingOppWinRate - sosPlayed.sos) * 1000).toFixed(0)} points`}
          tone={remainingOppWinRate !== null && sosPlayed.opponents > 0 && remainingOppWinRate > sosPlayed.sos ? 'warn' : undefined}
          tip={tip('scheduleAhead')}
        />
        <Tile
          label="Projected finish"
          value={remaining.length ? `${projWins.toFixed(1)}-${projLosses.toFixed(1)}` : `${record.wins}-${record.losses}`}
          detail={remaining.length ? `${projectedExtra.toFixed(2)} more wins` : 'the schedule is complete'}
          tip={tip('projectedFinish')}
          tipAlign="end"
        />
      </Tiles>

      {remaining.length === 0 ? (
        <NotOnRecord>
          Nothing left on the regular-season schedule, so there is nothing to forecast. The projected finish above
          is simply the record.
        </NotOnRecord>
      ) : (
        <div className="flex flex-col gap-0.5 mt-3">
          {remaining.map((r) => (
            <div
              key={`${r.week}-${r.oppAbbr}`}
              className="grid grid-cols-[24px_26px_minmax(0,1fr)_auto_72px_38px] items-center gap-2 py-1 border-b border-line/45 text-xs hover:bg-raised/45"
              title={r.factors.map((f) => `${f.label} ${signed(f.points)}pts (${f.detail})`).join(' · ')}
            >
              <span className="text-muted text-[10.5px] tabular-nums">W{r.week}</span>
              <TeamLogo seed={r.oppId} abbr={r.oppAbbr} nickname={r.oppNickname} size={24} />
              <span className="font-semibold truncate">{r.home ? '' : '@ '}{r.oppName}</span>
              <span className="text-muted text-[10.5px] tabular-nums text-right whitespace-nowrap">
                {r.oppWins}-{r.oppLosses} · {r.oppRating} ovr #{r.oppRank}
              </span>
              <span className="relative h-2 rounded-full bg-raised overflow-hidden">
                <i className="absolute inset-y-0 left-0 rounded-full bg-viz1" style={{ width: `${r.winPct}%` }} />
              </span>
              <span className="text-right tabular-nums font-semibold">{r.winPct}%</span>
            </div>
          ))}
        </div>
      )}

      <Note>
        Strength of schedule is the combined win rate of the clubs you actually faced, taken over their full
        seasons — so it says who you played, not when you caught them.
        {allAway && ' Every fixture left is away from home; the estimator charges each of them the road penalty.'}
      </Note>

      <SubHead eyebrow="Who you are chasing" title={divisionLabel} tip={tip('gamesBehind')} />
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-xs mt-1">
          <thead>
            <tr>
              {/* Four rows in a scroll box is not enough height for a bubble to
                  open into, either way up, so this table's one derived column
                  is explained on the heading above it instead — outside the
                  scroller, where nothing clips it. */}
              {['Club', 'W-L', 'Win rate', 'Games back'].map((c, i) => (
                <th key={c} className={`label-sm text-[9.5px] px-1.5 pb-1.5 border-b border-line ${i ? 'text-right' : 'text-left'}`}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {division.map((r, i) => (
              <tr key={r.teamId} className={r.teamId === teamId ? 'bg-[color-mix(in_srgb,var(--team-accent)_14%,transparent)]' : ''}>
                <td className="px-1.5 py-1 border-b border-line/55">{i + 1}. {r.name}</td>
                <td className="px-1.5 py-1 border-b border-line/55 text-right tabular-nums">{r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''}</td>
                <td className="px-1.5 py-1 border-b border-line/55 text-right tabular-nums text-muted">{rate3(r.pct)}</td>
                <td className="px-1.5 py-1 border-b border-line/55 text-right tabular-nums text-muted">
                  {i === 0 ? '—' : ((division[0].wins - r.wins) + (r.losses - division[0].losses)) / 2}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TableTwin
        caption="What is left, in numbers"
        columns={['Wk', 'Opponent', 'H/A', 'Record', 'Rating', 'Rank', 'Win chance']}
        tips={{ Rating: tip('teamOverall'), 'Win chance': tip('winProbability') }}
        rows={remaining.map((r) => [
          r.week, r.oppName, r.home ? 'H' : 'A', `${r.oppWins}-${r.oppLosses}`, r.oppRating, r.oppRank, `${r.winPct}%`,
        ])}
      />
    </Panel>
  );
}
