import { formatMoney } from '@/lib/cap';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { Panel, Note, NotOnRecord, TableTwin } from './Panel';
import { VIZ, TXT } from './viz';

export interface ProductionMan {
  playerId: string;
  name: string;
  position: string;
  age: number;
  weightLb: number;
  heightIn: number;
  hit: number;
  /** The stat this position is defined by — CAREER_COLUMNS' own `lead: 1`. */
  statKey: string | null;
  statLabel: string | null;
  /** One point per completed regular season on record, oldest first. */
  series: { year: number; age: number | null; team: string; gp: number; value: number }[];
  /** Why he is on the board — the biggest cap hits, plus the best-paid lineman. */
  reason: 'cap' | 'lineman';
}

/**
 * Panel 10 — is the money still climbing?
 *
 * Eight small multiples rather than eight lines on one axis: a quarterback's
 * yardage and an edge rusher's sack count share no scale, and forcing them
 * onto one plot would say something about them that isn't true. Each panel is
 * scaled to its own man — read the shape, not the height.
 *
 * REGULAR SEASON ONLY. The lines come from lib/playerSeasons.ts, whose season
 * rows keep the postseason in a separate bucket, so a Super Bowl run never
 * inflates a career line here.
 *
 * The measure per position is CAREER_COLUMNS' own `lead: 1` column — the
 * number a broadcast graphic leads with at that position — rather than a
 * second opinion written for this screen. Which is also why the offensive line
 * has none: the sim records nothing an offensive lineman does.
 */
export function ProductionPanel({ men, leagueId, teamAccent, teamAbbr, seasonYear, syncedFromTable }: {
  men: ProductionMan[];
  leagueId: string;
  teamAccent: string;
  teamAbbr: string;
  seasonYear: number;
  /** False when the season rows had to be replayed out of the box scores. */
  syncedFromTable: boolean;
}) {
  const years = [...new Set(men.flatMap((m) => m.series.map((s) => s.year)))].sort((a, b) => a - b).slice(-5);
  const noLine = men.filter((m) => m.series.length === 0 || !m.statLabel);
  const linemen = noLine.filter((m) => !m.statLabel);
  const tooNew = noLine.filter((m) => m.statLabel && m.series.length === 0);

  return (
    <Panel
      span={12}
      eyebrow={`Year by year, regular season · ${syncedFromTable ? 'PlayerSeason' : 'replayed from the box scores'}`}
      title="Is The Money Still Climbing?"
      aside="The largest cap hits, plus the best-paid lineman"
      why={<>
        One small chart per man rather than eight lines on one axis. Each is scaled to its own man and its own
        measure, and the line is blue where his last completed season beat his first and red where it did not —
        a first-to-last comparison, not a trend line through the points.
      </>}
    >
      {men.length === 0 ? (
        <p className="text-sm text-muted py-6">No contracts on this roster to chart yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-5 gap-y-3.5">
            {men.map((m) => <ManCard key={m.playerId} man={m} teamAccent={teamAccent} />)}
          </div>

          {noLine.length > 0 && (
            <NotOnRecord>
              {noLine.length === men.length ? `All ${men.length} of these` : `${noLine.length} of these ${men.length}`}
              {' '}have no line at all, and each absence is a different fact.
              {linemen.length > 0 && (
                <> <b className="text-chalk">{linemen.map((m) => m.name).join(', ')}</b>
                  {linemen.length === 1
                    ? ' is an offensive lineman — the box score records nothing he does'
                    : ' are offensive linemen — the box score records nothing they do'}: no snaps, no blocks, no
                  pressures allowed. There is no line to draw.</>
              )}
              {tooNew.length > 0 && (
                <> <b className="text-chalk">{tooNew.map((m) => m.name).join(', ')}</b>
                  {tooNew.length === 1 ? ' has' : ' have'} no completed season on record — arrived too recently, or
                  the seasons played were for a club whose games predate this save.</>
              )}
            </NotOnRecord>
          )}

          <Note>
            A season is attributed to the club he played it for, so a man traded in has the years he spent
            elsewhere on his line and they are labelled with that club, not with {teamAbbr}. The {seasonYear} season is
            not plotted: it is not finished, and half a year on a season axis reads as a collapse.
          </Note>

          <TableTwin
            caption="Table view — production by season, regular season only"
            columns={['Player', 'Pos', 'Cap hit', 'Measure', ...years.map(String)]}
            rows={men.map((m) => [
              m.name, m.position, formatMoney(m.hit), m.statLabel ?? 'not recorded',
              ...years.map((y) => {
                const row = m.series.find((s) => s.year === y);
                return row ? String(row.value) : '—';
              }),
            ])}
          />
        </>
      )}
    </Panel>
  );
}

function ManCard({ man, teamAccent }: { man: ProductionMan; teamAccent: string }) {
  const pts = man.series;
  const rising = pts.length > 1 ? pts[pts.length - 1].value >= pts[0].value : true;
  const color = rising ? VIZ.good : VIZ.bad;

  return (
    <div className="bg-raised/55 border border-line/70 rounded-md px-3 py-2.5">
      <div className="flex items-center gap-2.5 mb-1.5">
        <PlayerAvatar seed={man.playerId} age={man.age} size={30} teamColor={teamAccent} weightLb={man.weightLb} heightIn={man.heightIn} position={man.position} />
        <div className="min-w-0">
          <span className="block text-[12.5px] font-semibold truncate">{man.name}</span>
          <span className="block text-[10.5px] text-muted mt-px tabular-nums">
            <em className={`not-italic pill text-[9px] px-1 py-0 leading-4 mr-1 ${positionBadgeClass(man.position)}`}>{man.position}</em>
            {man.age}y · {formatMoney(man.hit)}
          </span>
        </div>
      </div>

      {!man.statLabel ? (
        <p className="text-[11px] text-muted leading-relaxed pt-2 border-t border-line/55">
          The box score records nothing an offensive lineman does — no snaps, no blocks, no pressures allowed.
          There is no line to draw.
        </p>
      ) : pts.length === 0 ? (
        <p className="text-[11px] text-muted leading-relaxed pt-2 border-t border-line/55">
          No completed regular season on record yet.
        </p>
      ) : pts.length === 1 ? (
        <p className="text-[11px] text-muted leading-relaxed pt-2 border-t border-line/55">
          One season on record: <span className="text-chalk font-semibold">{pts[0].value} {man.statLabel}</span> in {pts[0].year}
          {' '}for {pts[0].team}. A single point is not a shape.
        </p>
      ) : (
        <>
          <Spark points={pts} color={color} label={man.statLabel} name={man.name} />
          <div className="flex justify-between items-baseline text-[10.5px] text-muted tabular-nums mt-0.5">
            <span>{pts[0].year}: {pts[0].value}</span>
            <b className="font-bold" style={{ color }}>
              {pts[pts.length - 1].year}: {pts[pts.length - 1].value} {man.statLabel}
            </b>
          </div>
        </>
      )}
    </div>
  );
}

function Spark({ points, color, label, name }: {
  points: { year: number; age: number | null; team: string; gp: number; value: number }[];
  color: string; label: string; name: string;
}) {
  const W = 172, H = 56, PAD = 5;
  const max = Math.max(1, ...points.map((p) => p.value)) * 1.12;
  const x = (i: number) => PAD + ((W - PAD * 2) * i) / (points.length - 1);
  const y = (v: number) => H - PAD - ((H - PAD * 2) * v) / max;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block overflow-visible" role="img"
      aria-label={`${name}: ${label} by season, ${points.map((p) => `${p.year} ${p.value}`).join(', ')}`}>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={p.year}>
          <title>{`${p.year}${p.age !== null ? ` at ${p.age}` : ''} for ${p.team} · ${p.gp} games · ${p.value} ${label}`}</title>
          <rect x={x(i) - 12} y={0} width={24} height={H} fill="transparent" />
          <circle cx={x(i)} cy={y(p.value)} r={3.2} fill={color} stroke={VIZ.card} strokeWidth={2} />
        </g>
      ))}
    </svg>
  );
}
