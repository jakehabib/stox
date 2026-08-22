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
 *
 * WHEN THERE IS ALMOST NOTHING TO PLOT. This used to render a card per man
 * whatever the man had, so a first-season league showed seven cards all reading
 * "No completed regular season on record yet" and then a paragraph naming all
 * seven again to explain why — a lot of screen saying nothing twice, and the
 * thing the owner flagged. Now a card is drawn only where there is a line to
 * draw, the men left off are named ONCE in a single sentence under the board,
 * and when nobody has anything the panel stands down to that one sentence with
 * no cards at all. Nobody is hidden: the table twin still carries every man on
 * the board, with the measure we do not have for him spelled out.
 */
export function ProductionPanel({ men, leagueId, teamAccent, teamAbbr, seasonYear }: {
  men: ProductionMan[];
  leagueId: string;
  teamAccent: string;
  teamAbbr: string;
  seasonYear: number;
}) {
  const years = [...new Set(men.flatMap((m) => m.series.map((s) => s.year)))].sort((a, b) => a - b).slice(-5);
  const plotted = men.filter((m) => m.statLabel && m.series.length > 0);
  const linemen = men.filter((m) => !m.statLabel);
  const tooNew = men.filter((m) => m.statLabel && m.series.length === 0);

  return (
    <Panel
      span={12}
      eyebrow="Year by year · regular season"
      title="Is The Money Still Climbing?"
      aside="The largest cap hits, plus the best-paid lineman"
      why={<>
        One chart per man, each scaled to his own measure — read the shape, not the height. Blue where his last
        full season beat his first, red where it did not. What you are looking for is a line flattening while the
        cap hit above it climbs.
      </>}
    >
      {men.length === 0 ? (
        <p className="text-sm text-muted py-6">No contracts on this roster to chart yet.</p>
      ) : plotted.length === 0 ? (
        /* Nothing to draw for anybody — one sentence, no cards. */
        <p className="text-sm text-muted py-6 max-w-[62ch]">
          None of your biggest cap hits has a full season behind him yet, so there is nothing to chart. It fills in
          as they get through a year.
          {linemen.length > 0 && ' Linemen never appear here — line play doesn\'t produce a stat line to chart.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-5 gap-y-3.5">
            {plotted.map((m) => <ManCard key={m.playerId} man={m} teamAccent={teamAccent} />)}
          </div>

          {(linemen.length > 0 || tooNew.length > 0) && (
            <NotOnRecord>
              {linemen.length > 0 && (
                <>No line for <b className="text-chalk">{linemen.map((m) => m.name).join(', ')}</b> — line play
                  doesn&apos;t produce a stat line, so there is nothing to plot.{' '}</>
              )}
              {tooNew.length > 0 && (
                <><b className="text-chalk">{tooNew.map((m) => m.name).join(', ')}</b>
                  {tooNew.length === 1 ? ' has' : ' have'} no full season behind
                  {tooNew.length === 1 ? ' him' : ' them'} yet.</>
              )}
            </NotOnRecord>
          )}

          <Note>
            Years a man spent elsewhere are on his line, marked with the club he played them for rather than
            with {teamAbbr}. {seasonYear} is not on here — it is not finished.
          </Note>

          <TableTwin
            caption="Season by season, in numbers"
            columns={['Player', 'Pos', 'Cap hit', 'Measure', ...years.map(String)]}
            rows={men.map((m) => [
              m.name, m.position, formatMoney(m.hit), m.statLabel ?? 'not tracked',
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
          We do not track linemen&apos;s snaps, so there is nothing to plot.
        </p>
      ) : pts.length === 0 ? (
        <p className="text-[11px] text-muted leading-relaxed pt-2 border-t border-line/55">
          No full season behind him yet.
        </p>
      ) : pts.length === 1 ? (
        <p className="text-[11px] text-muted leading-relaxed pt-2 border-t border-line/55">
          One season so far: <span className="text-chalk font-semibold">{pts[0].value} {man.statLabel}</span> in {pts[0].year}
          {' '}for {pts[0].team}. One point is not a shape.
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
