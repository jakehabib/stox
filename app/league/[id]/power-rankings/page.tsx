import { getLeagueContext } from '@/lib/league-data';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { PowerRankingsTable } from '@/components/ds/PowerRankingsTable';
import { buildPowerRankings, ensurePowerSnapshot, POWER_WEIGHTS } from '@/lib/powerRankings';

export const dynamic = 'force-dynamic';

/**
 * The weekly power ranking gets its own screen rather than a block on the
 * standings, for the reason a real league publishes it as its own thing: the
 * standings are a record of what happened and this is an argument about what
 * it meant. Thirty-two rows, each carrying a rating, a margin, a form guide
 * and — for the ones worth talking about — a sentence, is a page, not a
 * panel. The standings screen carries the capsule and the strength column,
 * which is what a reader wants while looking at a table of records.
 */
export default async function PowerRankingsPage({ params }: { params: { id: string } }) {
  const { league, phaseLabel } = await getLeagueContext(params.id);
  const board = await buildPowerRankings(league.id);
  // Written after the board is built, so this week's ranking is compared with
  // the last week ON RECORD rather than with itself.
  await ensurePowerSnapshot(league.id, { board, league }).catch(() => {});

  const user = board.rows.find((r) => r.isUser);
  const movers = board.rows.filter((r) => r.move && r.move.delta !== 0);
  const riser = [...movers].sort((a, b) => b.move!.delta - a.move!.delta)[0];
  const faller = [...movers].sort((a, b) => a.move!.delta - b.move!.delta)[0];
  // Before kickoff nobody has a record rank, so there is no gap to report.
  const swingOf = (r: (typeof board.rows)[number]) => (r.recordRank === null ? 0 : r.recordRank - r.rank);
  const biggestSwing = [...board.rows].sort((a, b) => Math.abs(swingOf(b)) - Math.abs(swingOf(a)))[0];

  const facts = [
    ...(user
      ? [{
          label: 'Your Ranking',
          value: `#${user.rank}`,
          detail: user.move
            ? user.move.delta === 0
              ? `Held #${user.move.fromRank} from week ${user.move.fromWeek}`
              : `${user.move.delta > 0 ? 'Up' : 'Down'} ${Math.abs(user.move.delta)} from #${user.move.fromRank}`
            : `${user.wins}-${user.losses}${user.ties ? `-${user.ties}` : ''} · ${user.rating} ovr`,
          color: user.rank <= 8 ? 'text-accent' : user.rank >= 25 ? 'text-bad' : undefined,
        }]
      : []),
    ...(user && user.recordRank !== null
      ? [{
          label: 'Against The Record',
          value: swingOf(user) === 0 ? 'Level' : `${swingOf(user) > 0 ? '+' : ''}${swingOf(user)}`,
          detail: `Record alone has them ${user.recordRank}${user.recordRank === 1 ? 'st' : user.recordRank === 2 ? 'nd' : user.recordRank === 3 ? 'rd' : 'th'}`,
        }]
      : []),
    ...(riser && riser.move!.delta > 0
      ? [{ label: 'Biggest Riser', value: riser.abbr, detail: `Up ${riser.move!.delta} to #${riser.rank}`, color: 'text-accent' }]
      : []),
    ...(faller && faller.move!.delta < 0
      ? [{ label: 'Biggest Faller', value: faller.abbr, detail: `Down ${Math.abs(faller.move!.delta)} to #${faller.rank}`, color: 'text-bad' }]
      : []),
    ...(biggestSwing && biggestSwing.recordRank !== null && biggestSwing.recordRank !== biggestSwing.rank
      ? [{
          label: 'Furthest From Its Record',
          value: biggestSwing.abbr,
          detail: `${biggestSwing.recordRank} on record, ${biggestSwing.rank} here`,
        }]
      : []),
  ];

  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <div className="space-y-6">
      <PageMasthead
        teamId={user?.teamId}
        teamAbbr={user?.abbr}
        eyebrow={`${league.seasonYear} · ${phaseLabel}`}
        title="Power Rankings"
        subtitle={
          <>
            {board.weekLabel}. Not the standings re-sorted — a 5-2 club that has escaped three times against bad
            teams will sit below a 4-3 club that has been battering people, and the Δ column says by how much.
          </>
        }
        facts={facts}
      />

      {!board.hasMovement && (
        <div className="panel px-4 py-3 text-xs text-muted">
          {!board.storable
            ? 'Out of season this is a roster ranking: nobody has a record, so there is nothing to be above or below and no week-over-week movement to report. The weekly editions resume when the season does.'
            : board.snapshotsAvailable
              ? 'First ranking on record for this season, so there is no movement to show yet. Next week every row carries its change against this one.'
              : 'No movement is being shown, because no earlier week is available to compare against — and last week’s order cannot be recomputed after the fact, since a club that signed a free agent on Tuesday would rewrite its own history. Nothing is claimed rather than a zero that would imply nobody moved.'}
        </div>
      )}

      <div className="section">
        <SectionHeading
          eyebrow={`${board.rows.length} clubs`}
          title={`${board.weekLabel} Rankings`}
          action={
            board.priorWeek !== null
              ? <span className="label-sm">Movement vs week {board.priorWeek}</span>
              : undefined
          }
        />
        <PowerRankingsTable leagueId={league.id} board={board} />
      </div>

      <div className="section">
        <SectionHeading eyebrow="Method" title="How this is worked out" />
        <div className="panel px-4 py-3 text-xs text-muted space-y-2 leading-relaxed">
          <p>
            Four components, each measured against the rest of the league and then weighted.
            Everything they are built from is on the row, so a ranking you disagree with is one you can check.
          </p>
          <ul className="space-y-1">
            <li>
              <span className="text-chalk font-semibold">Résumé ({pct(POWER_WEIGHTS.resume)})</span> — results credited
              against the quality of who produced them. Beating a good team banks more than beating a bad one; losing to
              a good team costs less than losing to a bad one.
            </li>
            <li>
              <span className="text-chalk font-semibold">Adjusted margin ({pct(POWER_WEIGHTS.srs)})</span> — scoring
              margin corrected for the strength of the schedule that produced it. Single games count for at most three
              scores, so one blowout cannot carry a season.
            </li>
            <li>
              <span className="text-chalk font-semibold">Roster rating ({pct(POWER_WEIGHTS.rating)})</span> — the team
              OVR from the roster itself, the same figure the dashboard and the handover screen show.
            </li>
            <li>
              <span className="text-chalk font-semibold">Recent form ({pct(POWER_WEIGHTS.form)})</span> — the last four
              games, the most recent counting the most.
            </li>
          </ul>
          <p>
            Early in a season the three result-based components are scaled down and the roster rating takes up the
            slack, because six weeks of football is a small sample and pretending otherwise is how a table ends up
            claiming more than it knows. The index is centred so the league average is 50.
          </p>
        </div>
      </div>
    </div>
  );
}
