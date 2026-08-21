import { DriveAgg, LeagueMetric } from '@/lib/analytics';
import { Panel, Legend, Note, NotOnRecord, SubHead, TableTwin } from './Panel';
import { VIZ, clamp, ordinal } from './viz';

/**
 * The four outcomes a stored drive can have, once the two flavours of "gave the
 * ball back" are folded together (a punt and a turnover on downs are the same
 * event from the scoreboard's point of view, and the sim distinguishes them
 * only by which way the fourth down went).
 *
 * Four fixed hues from the app's own slots, validated all-pairs against the
 * card surface with the dataviz checker (worst pair ΔE 6.9 protan, which is
 * legal in the 6–8 band ONLY with secondary encoding — hence the direct value
 * label on every segment wide enough to hold one, the 2px gaps between
 * segments, and the table twin under the chart).
 */
const OUTCOMES = [
  { key: 'tds', label: 'Touchdown', color: '#3987e5' },
  { key: 'fgs', label: 'Field goal', color: '#008300' },
  { key: 'puntsOrDowns', label: 'Punt or downs', color: '#c98500' },
  { key: 'turnovers', label: 'Turnover', color: '#d55181' },
] as const;

/**
 * The war room's first board — every drive this club has run and faced.
 *
 * A drive is the unit a front office actually argues about: it is the only
 * grain the sim stores below the game, and points per drive is the closest
 * this data comes to a single honest measure of an offence.
 */
export function DriveBoardPanel({ metrics, offense, defense, teamAbbr, gamesPlayed, headline }: {
  metrics: LeagueMetric[];
  offense: DriveAgg;
  defense: DriveAgg;
  teamAbbr: string;
  gamesPlayed: number;
  /** A sentence naming what the board found, written from the numbers. */
  headline: React.ReactNode;
}) {
  const ppd = metrics.find((m) => m.key === 'ppd');
  const ppdAllowed = metrics.find((m) => m.key === 'ppdAllowed');

  return (
    <Panel
      span={12}
      eyebrow={`Every drive run and faced · ${gamesPlayed} regular-season games`}
      title="The Drive Board"
      aside={ppd ? `${ppd.value.toFixed(2)} points a drive · ${ordinal(ppd.rank)} of ${ppd.clubs}` : undefined}
      why={<>
        Read straight off the drive log inside every stored box score. A drive is the smallest thing this sim
        records below the game, so this is as fine-grained as an honest number here can be — and every measure
        is shown against the whole league, because a rank with no spread behind it hides how tight the
        competition is.
      </>}
    >
      {metrics.length === 0 || offense.drives === 0 ? (
        <p className="text-sm text-muted py-6">
          No drives on record for {teamAbbr} this season yet. The board fills in from the first game played.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4">
            {metrics.map((m) => <Strip key={m.key} m={m} />)}
          </div>

          <Legend
            keys={[
              { color: VIZ.chalk, label: `${teamAbbr}`, shape: 'block' },
              { color: VIZ.muted, label: 'The other clubs', shape: 'line' },
            ]}
            note="The hairline is the league mean"
          />

          <SubHead
            eyebrow="How every possession ended"
            title="Drive Outcomes, Yours And Theirs"
            aside={`${offense.drives} run · ${defense.drives} faced`}
          />
          <div className="mt-3 space-y-3">
            <OutcomeBar label={`${teamAbbr} offence`} agg={offense} />
            <OutcomeBar label={`${teamAbbr} defence faced`} agg={defense} />
          </div>
          <Legend keys={OUTCOMES.map((o) => ({ color: o.color, label: o.label, shape: 'block' }))} />

          <Note>{headline}</Note>

          {(offense.clockOuts > 0 || defense.clockOuts > 0) && (
            <NotOnRecord>
              {offense.clockOuts + defense.clockOuts} drive{offense.clockOuts + defense.clockOuts === 1 ? '' : 's'} ended
              because the half did, and {offense.clockOuts + defense.clockOuts === 1 ? 'it is' : 'they are'} left out of
              every rate above. A possession the clock took away never had the chance to score, and counting it would
              drag every club&apos;s scoring rate down by an artefact of the clock.
            </NotOnRecord>
          )}
          <NotOnRecord>
            A stored drive carries its result, points, plays and yards — and no down, distance or field position.
            So expected points added, success rate, red-zone efficiency and third-and-long conversion are not
            computable here, and nothing above is named after them. Drive yards are what the drive gained, not
            where it started, so scoring rate by starting field position is not computable either.
          </NotOnRecord>

          <TableTwin
            caption="Table view — drive efficiency against the league"
            columns={['Measure', `${teamAbbr}`, 'Rank', 'League mean', 'League low', 'League high', 'Direction']}
            rows={metrics.map((m) => [
              m.label,
              `${m.value.toFixed(m.decimals)}${m.unit}`,
              `${ordinal(m.rank)} of ${m.clubs}`,
              m.leagueMean.toFixed(m.decimals),
              m.leagueMin.toFixed(m.decimals),
              m.leagueMax.toFixed(m.decimals),
              m.better === 'high' ? 'higher better' : 'lower better',
            ])}
          />
        </>
      )}
    </Panel>
  );
}

/**
 * One measure as a range strip: every other club as a faint tick, the league
 * mean as a hairline, this club as a chalk marker with its rank spelled out.
 * The rank is in text under the strip, so the position of the marker is never
 * the only way to read it.
 */
function Strip({ m }: { m: LeagueMetric }) {
  const lo = Math.min(m.leagueMin, m.value);
  const hi = Math.max(m.leagueMax, m.value);
  const pos = (v: number) => clamp(((v - lo) / (hi - lo || 1)) * 100, 0, 100);
  const good = m.rank <= Math.ceil(m.clubs / 3);
  const poor = m.rank >= m.clubs - Math.ceil(m.clubs / 3) + 1;

  return (
    <div title={`${m.label}: ${m.definition}`}>
      <div className="flex justify-between items-baseline text-xs">
        <span>{m.label}</span>
        <b className={`stat-value text-[17px] ${good ? 'text-accent' : poor ? 'text-bad' : ''}`}>
          {m.value.toFixed(m.decimals)}<i className="not-italic text-[10px] text-muted ml-0.5">{m.unit}</i>
        </b>
      </div>
      <div className="relative h-5 my-1 rounded bg-raised/65">
        {m.all.map((v, i) => (
          <span key={i} className="absolute top-1.5 w-0.5 h-2 -translate-x-px bg-muted/45" style={{ left: `${pos(v)}%` }} />
        ))}
        <span className="absolute top-0.5 bottom-0.5 w-px -translate-x-1/2 bg-muted" style={{ left: `${pos(m.leagueMean)}%` }} />
        <span
          className="absolute top-[3px] w-2.5 h-3.5 rounded-sm -translate-x-1/2 border-2 border-card bg-chalk"
          style={{ left: `${pos(m.value)}%` }}
        />
      </div>
      <div className="flex justify-between text-[9.5px] text-muted uppercase tracking-[0.06em]">
        <span>{m.better === 'high' ? 'worst' : 'best'} {m.leagueMin.toFixed(m.decimals)}</span>
        <span className={`font-bold ${good ? 'text-accent' : poor ? 'text-bad' : ''}`}>{ordinal(m.rank)} of {m.clubs}</span>
        <span>{m.leagueMax.toFixed(m.decimals)}</span>
      </div>
    </div>
  );
}

/** One club's drives as a part-to-whole bar, with the count written on every segment that can hold it. */
function OutcomeBar({ label, agg }: { label: string; agg: DriveAgg }) {
  if (agg.drives === 0) return null;
  return (
    <div>
      <div className="flex justify-between items-baseline text-[11px] text-muted mb-1">
        <span>{label}</span>
        <span className="tabular-nums">{agg.drives} drives · {agg.points} points · {(agg.points / agg.drives).toFixed(2)} a drive</span>
      </div>
      <div className="flex h-7 gap-[2px]">
        {OUTCOMES.map((o) => {
          const n = agg[o.key];
          if (n === 0) return null;
          const pct = (100 * n) / agg.drives;
          return (
            <div
              key={o.key}
              className="relative flex items-center justify-center rounded-sm overflow-hidden"
              style={{ width: `${pct}%`, background: o.color }}
              title={`${o.label}: ${n} of ${agg.drives} drives (${pct.toFixed(1)}%)`}
            >
              {/* Direct labels are the secondary encoding the palette check
                  requires, and they only render where they actually fit. */}
              {pct >= 9 && <span className="text-[10.5px] font-bold text-white tabular-nums px-1 truncate">{pct.toFixed(0)}%</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
