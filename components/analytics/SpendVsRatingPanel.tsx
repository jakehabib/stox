import { UnitSpendRow } from '@/lib/analytics';
import { formatMoney } from '@/lib/cap';
import { Panel, Legend, Note, TableTwin, ChartBox } from './Panel';
import { VIZ, TXT, SIDE_COLOR, signed, pct1, ordinal } from './viz';

/**
 * Panel 3 — the flagship. Cap share against unit rating, both as differences
 * from the league.
 *
 * Both axes are differences on purpose. "14.5% of the cap at offensive line"
 * and "82 at offensive line" are unreadable alone: the second only means
 * something once you know the league-wide rating spread in this sim is about
 * seven points, and the first only once you know what the other 31 clubs
 * spend there.
 *
 * Nine groups is one above the categorical ceiling, and a scatter is judged on
 * ALL pairs rather than adjacent ones, which caps a validated set at three. So
 * colour carries the side of the ball — three slots, all-pairs validated — and
 * identity is carried by a direct label on every bubble. Nine hues would have
 * been the wrong answer even if the palette had them.
 */
export function SpendVsRatingPanel({ rows, capEnabled }: { rows: UnitSpendRow[]; capEnabled: boolean }) {
  // The finding, computed rather than written: the unit furthest below the
  // league's spending share, and whether it is also below the league's rating.
  const underspent = [...rows].sort((a, b) => a.shareDelta - b.shareDelta)[0];
  const overspent = [...rows].sort((a, b) => b.shareDelta - a.shareDelta)[0];
  const belowMean = rows.filter((r) => r.ratingDelta < 0);

  return (
    <Panel
      span={12}
      eyebrow="Cap allocation against on-field rating · nine position groups"
      title="Are You Paying For What You're Getting?"
      aside="Bubble size = share of team quality that unit carries"
      why={<>
        Right of the centre line you are spending more of your own cap at that unit than the league does;
        above it you are fielding a better one than the league fields. The rating and the rank are
        <span className="text-chalk"> buildLeagueRatings()</span>&apos; own numbers — the same ones the dashboard,
        the schedule screen and the win estimate all read — not a second opinion computed here.
      </>}
    >
      {!capEnabled ? (
        <p className="text-sm text-muted py-4">
          Cap mode is <strong className="text-chalk">off</strong> in this league, so there is no salary share to
          plot against the ratings. The unit table below still stands.
        </p>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-7 items-start">
        <div className="min-w-0">
          {capEnabled && (
            <>
              <ChartBox><Scatter rows={rows} /></ChartBox>
              <Legend
                keys={[
                  { color: VIZ.off, label: 'Offense' },
                  { color: VIZ.def, label: 'Defense' },
                  { color: VIZ.st, label: 'Special teams' },
                ]}
              />
            </>
          )}
        </div>

        <div className="min-w-0 overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                {['Unit', 'Cap', 'Share', 'vs Lg', 'Rate', 'Rank', 'vs Lg', 'Age'].map((c, i) => (
                  <th key={c} className={`label-sm text-[9.5px] px-1.5 pb-1.5 border-b border-line ${i ? 'text-right' : 'text-left'}`}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr
                  key={g.group}
                  data-side={g.side}
                  className="group-data-[units=OFF]/an:data-[side=DEF]:opacity-25 group-data-[units=OFF]/an:data-[side=ST]:opacity-25
                             group-data-[units=DEF]/an:data-[side=OFF]:opacity-25 group-data-[units=DEF]/an:data-[side=ST]:opacity-25
                             transition-opacity"
                  title={`${g.group}: ${g.count} on the roster, ${g.starterSlots} on the field. Best is ${g.topName} at ${g.topOvr}. ${g.expiring} deal${g.expiring === 1 ? '' : 's'} in a final year.`}
                >
                  <td className="px-1.5 py-1 border-b border-line/55">
                    <span className="inline-block w-2 h-2 rounded-sm mr-2 align-[1px]" style={{ background: SIDE_COLOR[g.side] }} />
                    {g.group}
                  </td>
                  <td className="px-1.5 py-1 border-b border-line/55 text-right tabular-nums">{formatMoney(g.spend)}</td>
                  <td className="px-1.5 py-1 border-b border-line/55 text-right tabular-nums">{pct1(g.share)}</td>
                  <td className={`px-1.5 py-1 border-b border-line/55 text-right tabular-nums ${Math.abs(g.shareDelta) > 0.04 ? 'text-warn' : 'text-muted'}`}>
                    {signed(g.shareDelta * 100)}pp
                  </td>
                  <td className="px-1.5 py-1 border-b border-line/55 text-right tabular-nums">{g.rating}</td>
                  <td className={`px-1.5 py-1 border-b border-line/55 text-right tabular-nums ${g.rank <= 5 ? 'text-accent' : g.rank >= 24 ? 'text-bad' : ''}`}>{g.rank}</td>
                  <td className={`px-1.5 py-1 border-b border-line/55 text-right tabular-nums ${g.ratingDelta >= 0 ? 'text-accent' : 'text-bad'}`}>{signed(g.ratingDelta)}</td>
                  <td className="px-1.5 py-1 border-b border-line/55 text-right tabular-nums text-muted">{g.avgAge ? g.avgAge.toFixed(1) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {capEnabled && (
            <Note>
              <b>{underspent.group} is the biggest underspend.</b> {pct1(underspent.share)} of active salary against a
              league average of {pct1(underspent.leagueMeanShare)} — {signed(underspent.shareDelta * 100)} points —
              and it rates {underspent.rating} against a league mean of {underspent.leagueMeanRating.toFixed(1)},
              {' '}{ordinal(underspent.rank)} of 32.
              <br /><br />
              <b>{overspent.group} is the other end.</b> {pct1(overspent.share)} of the money,
              {' '}{signed(overspent.shareDelta * 100)} points above the league, for a unit rated {overspent.rating}
              {' '}({ordinal(overspent.rank)}). Paying up and getting it is not a mistake; paying up while
              {belowMean.length === 0
                ? ' every other unit already clears the league mean might be.'
                : ` ${belowMean.map((r) => r.group).join(', ')} rate${belowMean.length === 1 ? 's' : ''} below the league mean might be.`}
            </Note>
          )}
        </div>
      </div>

      <TableTwin
        caption="Table view — this panel's chart, in full"
        columns={['Unit', 'Side', 'Cap $', 'Share %', 'League share %', 'Diff pp', 'Rating', 'League mean', 'Diff', 'Rank', 'Bodies', 'On field', 'Weight %']}
        rows={rows.map((g) => [
          g.group, g.side, formatMoney(g.spend), (100 * g.share).toFixed(1), (100 * g.leagueMeanShare).toFixed(1),
          signed(g.shareDelta * 100), g.rating, g.leagueMeanRating.toFixed(1), signed(g.ratingDelta), g.rank,
          g.count, g.starterSlots, (100 * g.weight).toFixed(1),
        ])}
      />
    </Panel>
  );
}

interface Seat { x: number; y: number; sx: number; sy: number }

function Scatter({ rows }: { rows: UnitSpendRow[] }) {
  const W = 660, H = 430, L = 56, R = 28, TOP = 30, BOT = 48;
  const pw = W - L - R, ph = H - TOP - BOT;

  const xlim = Math.max(2, ...rows.map((d) => Math.abs(d.shareDelta * 100))) * 1.3;
  const ylo = Math.min(-2, ...rows.map((d) => d.ratingDelta)) - 1.2;
  const yhi = Math.max(2, ...rows.map((d) => d.ratingDelta)) + 1.6;
  const x = (v: number) => L + pw * ((v + xlim) / (2 * xlim));
  const y = (v: number) => TOP + ph - (ph * (v - ylo)) / (yhi - ylo);
  // Area, not radius, carries the weight — a unit that decides twice as much
  // of the team's quality gets twice the ink, not four times.
  const rOf = (w: number) => 8 + Math.sqrt(w) * 22;

  const pts = rows.map((d) => ({ d, cx: x(d.shareDelta * 100), cy: y(d.ratingDelta), r: rOf(d.weight) }));

  // Labels ride outside the bubble. Eight candidate seats per point; take the
  // one furthest from every other bubble and every label already seated. This
  // is the pass that stops WR/TE/LB stacking their names on top of each other
  // when three units land in the same corner.
  const SEATS = [[0, -1], [0.71, -0.71], [1, 0], [0.71, 0.71], [0, 1], [-0.71, 0.71], [-1, 0], [-0.71, -0.71]];
  const taken: Seat[] = [];
  const seated = pts.map((p) => {
    let best: (Seat & { cost: number }) | null = null;
    for (const [sx, sy] of SEATS) {
      const lx = p.cx + sx * (p.r + 13);
      const ly = p.cy + sy * (p.r + 13);
      if (lx < L + 14 || lx > W - R - 14 || ly < TOP + 8 || ly > TOP + ph - 6) continue;
      let cost = 0;
      for (const q of pts) if (q !== p) cost += Math.max(0, 46 - Math.hypot(lx - q.cx, ly - q.cy));
      for (const t of taken) cost += Math.max(0, 34 - Math.hypot(lx - t.x, ly - t.y));
      if (!best || cost < best.cost) best = { x: lx, y: ly, sx, sy, cost };
    }
    const seat: Seat = best ?? { x: p.cx, y: p.cy - p.r - 8, sx: 0, sy: -1 };
    taken.push(seat);
    return { ...p, seat };
  });

  const xticks = [-12, -8, -4, 0, 4, 8, 12].filter((v) => Math.abs(v) < xlim);
  const yticks = [-8, -4, 0, 4, 8, 12].filter((v) => v > ylo && v < yhi);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block overflow-visible min-w-[420px]" role="img"
      aria-label="Cap share against unit rating, both measured against the league average, for all nine position groups">
      {yticks.map((v) => (
        <g key={`y${v}`}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v === 0 ? VIZ.line : 'rgba(45,45,50,.5)'} strokeWidth={1} />
          <text x={L - 9} y={y(v) + 3.5} textAnchor="end" className={TXT.ax}>{v > 0 ? `+${v}` : v}</text>
        </g>
      ))}
      {xticks.map((v) => (
        <g key={`x${v}`}>
          <line x1={x(v)} x2={x(v)} y1={TOP} y2={TOP + ph} stroke={v === 0 ? VIZ.line : 'rgba(45,45,50,.5)'} strokeWidth={1} />
          <text x={x(v)} y={TOP + ph + 17} textAnchor="middle" className={TXT.ax}>{v > 0 ? `+${v}` : v}pp</text>
        </g>
      ))}

      <text x={x(0) - 9} y={TOP + 13} textAnchor="end" className={TXT.quad}>Getting it cheap</text>
      <text x={x(0) + 9} y={TOP + 13} className={TXT.quad}>Paying up, getting it</text>
      <text x={x(0) - 9} y={TOP + ph - 8} textAnchor="end" className={TXT.quad}>Cheap and thin</text>
      <text x={x(0) + 9} y={TOP + ph - 8} className={TXT.quad}>Paying up, not getting it</text>

      {seated.map((p) => (
        <g
          key={p.d.group}
          data-side={p.d.side}
          className="group-data-[units=OFF]/an:data-[side=DEF]:opacity-20 group-data-[units=OFF]/an:data-[side=ST]:opacity-20
                     group-data-[units=DEF]/an:data-[side=OFF]:opacity-20 group-data-[units=DEF]/an:data-[side=ST]:opacity-20
                     transition-opacity"
        >
          <title>
            {`${p.d.group} · ${formatMoney(p.d.spend)} (${pct1(p.d.share)} of active salary, league ${pct1(p.d.leagueMeanShare)}) · unit ${p.d.rating}, ${ordinal(p.d.rank)} of 32, league mean ${p.d.leagueMeanRating.toFixed(1)} · ${p.d.count} on the roster, ${p.d.starterSlots} on the field · carries ${pct1(p.d.weight)} of team quality`}
          </title>
          <line
            x1={p.cx + p.seat.sx * p.r} y1={p.cy + p.seat.sy * p.r}
            x2={p.seat.x - p.seat.sx * 9} y2={p.seat.y - p.seat.sy * 1}
            stroke={VIZ.muted} strokeWidth={1} opacity={0.55}
          />
          {/* 2px surface ring, so two bubbles that overlap stay two bubbles. */}
          <circle cx={p.cx} cy={p.cy} r={p.r} fill={SIDE_COLOR[p.d.side]} fillOpacity={0.78} stroke={VIZ.card} strokeWidth={2} />
          <text x={p.seat.x} y={p.seat.y + 4} textAnchor="middle" className={TXT.onMark}>{p.d.group}</text>
        </g>
      ))}

      <text x={L + pw / 2} y={H - 6} textAnchor="middle" className={TXT.axt}>Share of active salary vs league average</text>
      <text transform={`translate(14,${TOP + ph / 2}) rotate(-90)`} textAnchor="middle" className={TXT.axt}>Unit rating vs league average</text>
    </svg>
  );
}
