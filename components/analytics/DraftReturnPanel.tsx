import { DraftPickRow, DraftRoundBand } from '@/lib/analytics';
import { Panel, Legend, Note, NotOnRecord, TableTwin, ChartBox } from './Panel';
import { VIZ, TXT } from './viz';

/**
 * Panel 8 — what each round of this front office's board has actually returned.
 *
 * One dot per pick, placed at what that player rates TODAY. It is the only
 * feedback loop on scouting the game currently offers, and it is a weak one:
 * `ScoutingReport` is mutated in place as confidence rises, so what the
 * department believed at the moment the card went in is no longer in the
 * database. This chart therefore grades the ROUND, not the scout — see the
 * note under it.
 */
export function DraftReturnPanel({ bands, picks, leagueMeanOvr, years }: {
  bands: DraftRoundBand[];
  picks: DraftPickRow[];
  /** Mean trueOvr across every rostered player in the league — the reference rule. */
  leagueMeanOvr: number;
  years: { first: number; last: number } | null;
}) {
  const gone = picks.filter((p) => !p.stillHere);
  const withPicks = bands.filter((b) => b.picks.length > 0);
  const firstBand = withPicks[0];
  const lastBand = withPicks[withPicks.length - 1];
  const drop = firstBand && lastBand && firstBand !== lastBand && firstBand.meanOvr !== null && lastBand.meanOvr !== null
    ? firstBand.meanOvr - lastBand.meanOvr
    : null;
  const monotonic = withPicks.length > 1 && withPicks.every((b, i) =>
    i === 0 || (withPicks[i - 1].meanOvr ?? 0) >= (b.meanOvr ?? 0));

  return (
    <Panel
      span={12}
      eyebrow={years ? `Every pick you have made, ${years.first}–${years.last}` : 'Every pick you have made'}
      title="Draft Return By Round"
      aside={picks.length ? `${picks.length} picks · ${picks.filter((p) => p.starter).length} now first-team` : undefined}
      why={<>
        One dot per pick, placed at what that player rates today. The chalk rule is the round&apos;s mean and the
        grey rule is the league-wide mean rating, so a round that beats it is returning starters rather than
        bodies. If the board is worth anything, the rounds separate.
      </>}
    >
      {picks.length === 0 ? (
        <p className="text-sm text-muted py-6">
          This front office has not made a pick yet. The panel fills in after your first draft.
        </p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-7 items-start">
          <div className="min-w-0">
            <ChartBox><DotPlot bands={bands} leagueMeanOvr={leagueMeanOvr} /></ChartBox>
            <Legend
              keys={[
                { color: VIZ.seriesA, label: 'First team now' },
                { label: 'On the roster, not starting', shape: 'ring', ringColor: VIZ.seriesA },
                { color: VIZ.muted, label: 'No longer on this roster', shape: 'dot' },
                { color: VIZ.chalk, label: 'Round mean', shape: 'line' },
              ]}
            />
          </div>

          <div className="min-w-0 overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-xs">
              <thead>
                <tr>
                  {['Round', 'Picks', 'Mean rating now', 'First team', 'Still here', 'Best pick'].map((c, i) => (
                    <th key={c} className={`label-sm text-[9.5px] px-1.5 pb-1.5 border-b border-line ${i ? 'text-right' : 'text-left'}`}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bands.map((b) => {
                  const best = [...b.picks].sort((x, y) => y.ovr - x.ovr)[0];
                  return (
                    <tr key={b.round} className={b.picks.length === 0 ? 'opacity-45' : ''}>
                      <td className="px-1.5 py-1 border-b border-line/55">R{b.round}</td>
                      <td className="px-1.5 py-1 border-b border-line/55 text-right tabular-nums">{b.picks.length || '—'}</td>
                      <td className="px-1.5 py-1 border-b border-line/55 text-right tabular-nums">{b.meanOvr === null ? '—' : b.meanOvr.toFixed(1)}</td>
                      <td className="px-1.5 py-1 border-b border-line/55 text-right tabular-nums">{b.picks.length ? `${b.starters}/${b.picks.length}` : '—'}</td>
                      <td className="px-1.5 py-1 border-b border-line/55 text-right tabular-nums text-muted">
                        {b.picks.length ? `${b.picks.filter((p) => p.stillHere).length}/${b.picks.length}` : '—'}
                      </td>
                      <td className="px-1.5 py-1 border-b border-line/55 text-right text-muted truncate">
                        {best ? `${best.name} · ${best.ovr}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <Note>
              {drop !== null ? (
                <>
                  Round {firstBand.round} to round {lastBand.round} is a <b>{drop.toFixed(1)}-point</b> drop in current
                  rating{monotonic ? ', and it is monotonic across every round in between' : ', though it is not monotonic — one round out of order is a small sample, not a broken board'}.
                </>
              ) : (
                <>Too few rounds have been picked in to compare them yet.</>
              )}
              {' '}Rating today is not draft grade: a fifth-rounder who developed is filed under the round he was
              taken in, which is exactly the point of the chart.
            </Note>

            <NotOnRecord>
              What the scouting department <em>said</em> a prospect would be is not recoverable. `ScoutingReport` is
              re-centred in place as confidence rises, so by the time a pick has been on the roster a year his
              report describes the player he became rather than the projection that was made. This panel can show
              the return on a round; it cannot show a scouting miss.
            </NotOnRecord>
            {gone.length === 0 && (
              <NotOnRecord>
                Every one of these {picks.length} picks is still on the roster, so the &ldquo;released or traded
                away&rdquo; class this chart can carry is empty — honestly empty, not hidden.
              </NotOnRecord>
            )}
          </div>
        </div>
      )}

      <TableTwin
        caption="Table view — every pick"
        columns={['Year', 'Rd', 'Slot', 'Player', 'Pos', 'Rating now', 'Age', 'First team', 'Still here']}
        rows={picks.map((p) => [
          p.year, p.round, p.slot, p.name, p.position, p.ovr, p.age, p.starter ? 'yes' : 'no', p.stillHere ? 'yes' : 'no',
        ])}
      />
    </Panel>
  );
}

function DotPlot({ bands, leagueMeanOvr }: { bands: DraftRoundBand[]; leagueMeanOvr: number }) {
  const W = 700, H = 300, L = 42, R = 76, TOP = 26, BOT = 38;
  const pw = W - L - R, ph = H - TOP - BOT;

  const all = bands.flatMap((b) => b.picks.map((p) => p.ovr));
  const lo = Math.min(58, ...all) - 2;
  const hi = Math.max(96, ...all) + 2;
  const x = (v: number) => L + (pw * (v - lo)) / (hi - lo);
  const ry = (r: number) => TOP + (ph * (r - 0.5)) / bands.length;

  const ticks: number[] = [];
  for (let v = Math.ceil(lo / 10) * 10; v <= hi; v += 10) ticks.push(v);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block overflow-visible min-w-[440px]" role="img"
      aria-label="Current rating of every pick this front office has made, grouped by round">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={x(v)} x2={x(v)} y1={TOP} y2={TOP + ph} stroke={VIZ.line} strokeWidth={1} />
          <text x={x(v)} y={TOP + ph + 16} textAnchor="middle" className={TXT.ax}>{v}</text>
        </g>
      ))}
      <line x1={x(leagueMeanOvr)} x2={x(leagueMeanOvr)} y1={TOP - 4} y2={TOP + ph + 2} stroke={VIZ.muted} strokeWidth={1} />
      <text x={x(leagueMeanOvr)} y={TOP - 8} textAnchor="middle" className={TXT.ax}>League mean {leagueMeanOvr.toFixed(0)}</text>

      {bands.map((b) => (
        <g key={b.round}>
          <text x={L - 8} y={ry(b.round) + 4} textAnchor="end" className={TXT.ax}>R{b.round}</text>
          {b.meanOvr !== null && (
            <line x1={x(b.meanOvr)} x2={x(b.meanOvr)} y1={ry(b.round) - 13} y2={ry(b.round) + 13} stroke={VIZ.chalk} strokeWidth={2} opacity={0.8} />
          )}
          {b.picks.map((p, i) => (
            <g key={p.playerId}>
              <title>
                {`${p.name} (${p.position}) · ${p.year} round ${p.round}, pick ${p.slot} · now ${p.ovr} ovr at ${p.age}${p.starter ? ' · first-team' : p.stillHere ? ' · on the roster' : ' · no longer here'}`}
              </title>
              {/* A little vertical jitter so two picks at the same rating stay
                  two dots rather than one darker one. */}
              <circle
                cx={x(p.ovr)}
                cy={ry(b.round) + (i % 2 ? 1 : -1) * (i < 2 ? 0 : 4.5)}
                r={5}
                fill={!p.stillHere ? 'none' : p.starter ? VIZ.seriesA : 'none'}
                stroke={!p.stillHere ? VIZ.muted : p.starter ? VIZ.card : VIZ.seriesA}
                strokeWidth={2}
              />
            </g>
          ))}
          <text x={W - R + 6} y={ry(b.round) + 1} className={TXT.lbl}>{b.meanOvr === null ? '—' : b.meanOvr.toFixed(1)}</text>
          <text x={W - R + 6} y={ry(b.round) + 13} className={TXT.ax}>
            {b.picks.length ? `${b.starters}/${b.picks.length} start` : 'no picks'}
          </text>
        </g>
      ))}
      <text x={L + pw / 2} y={H - 4} textAnchor="middle" className={TXT.axt}>Current true rating</text>
    </svg>
  );
}
