import { LuckSeasonRow } from '@/lib/analytics';
import { Panel, Legend, Note, Tiles, Tile, TableTwin, ChartBox } from './Panel';
import { VIZ, TXT, signed, ordinal } from './viz';

/**
 * Panel 1 — wins against the wins the scoring deserved, every season on record.
 *
 * Two lines on ONE axis, because both series are wins. That is the only case
 * where two lines share a plot on this screen; everywhere else two units meant
 * two charts.
 *
 * The season in progress is not on here. A part-season on a wins axis reads as
 * a collapse — eleven games plotted against a 17-win scale looks like a
 * franchise falling off a cliff. The masthead carries the live figure as a
 * rate instead.
 */
export function LuckLedgerPanel({ rows, tenureStartYear, seasonYear, seasonLength, teamAbbr, hasPreHistory, thisSeason }: {
  rows: LuckSeasonRow[];
  tenureStartYear: number;
  seasonYear: number;
  seasonLength: number;
  teamAbbr: string;
  hasPreHistory: boolean;
  /** The live season, for the tile that replaces the league-wide luck swarm. */
  thisSeason: { wins: number; losses: number; ties: number; expectedWins: number; luck: number; unluckRank: number; clubs: number; played: number } | null;
}) {
  const tenure = rows.filter((r) => r.tenure);
  const tenureLuck = tenure.reduce((a, r) => a + r.luck, 0);
  const banked = [...rows].sort((a, b) => b.luck - a.luck)[0];
  const robbed = [...rows].sort((a, b) => a.luck - b.luck)[0];

  return (
    <Panel
      span={12}
      eyebrow="Wins earned vs wins banked"
      title="The Luck Ledger"
      flag={rows.length === 0 ? undefined : {
        text: `${signed(tenureLuck)} wins across your tenure`,
        tone: tenureLuck > 0.5 ? 'good' : tenureLuck < -0.5 ? 'bad' : 'warn',
      }}
      why={<>
        Pythagorean expectation turns points scored and allowed into the record that scoring deserved
        (exponent 2.37, the football fit). Where the blue line sits above the orange one, the club banked
        wins its scoring did not earn — and a gap like that is the first thing that stops repeating.
        No trend line is drawn through either series: the sim makes no such claim and neither should this.
      </>}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted py-6">
          No completed season on record for {teamAbbr} yet. This panel plots finished seasons only, so it
          fills in the first time this franchise gets through a year.
        </p>
      ) : (
        <>
          <div className={hasPreHistory ? 'group-data-[era=tenure]/an:hidden' : ''}>
            <ChartBox><LedgerChart rows={rows} tenureStartYear={tenureStartYear} /></ChartBox>
          </div>
          {hasPreHistory && (
            <div className="hidden group-data-[era=tenure]/an:block">
              <ChartBox><LedgerChart rows={tenure} tenureStartYear={tenureStartYear} /></ChartBox>
            </div>
          )}

          <Legend
            keys={[
              { color: VIZ.seriesA, label: 'Wins', shape: 'line' },
              { color: VIZ.seriesB, label: 'Expected wins', shape: 'line' },
              { color: VIZ.gold, label: 'Title', shape: 'dot' },
              { color: VIZ.muted, label: 'Playoff berth', shape: 'dot' },
            ]}
          />

          <Tiles cols={4}>
            <Tile
              label="Across your tenure"
              value={signed(tenureLuck)}
              detail={tenure.length ? `${tenure.length} completed season${tenure.length === 1 ? '' : 's'} since ${tenureStartYear}` : 'no completed season yet'}
              tone={tenureLuck > 0.5 ? 'good' : tenureLuck < -0.5 ? 'bad' : undefined}
            />
            <Tile
              label="Most wins banked"
              value={`${banked.year}`}
              detail={`${banked.wins}-${banked.losses} on ${banked.expectedWins.toFixed(1)} deserved · ${signed(banked.luck)}`}
              tone={banked.luck > 0.5 ? 'good' : undefined}
            />
            <Tile
              label="Most wins robbed"
              value={`${robbed.year}`}
              detail={`${robbed.wins}-${robbed.losses} on ${robbed.expectedWins.toFixed(1)} deserved · ${signed(robbed.luck)}`}
              tone={robbed.luck < -0.5 ? 'bad' : undefined}
            />
            {thisSeason ? (
              <Tile
                label={`${seasonYear}, in progress`}
                value={signed(thisSeason.luck, 2)}
                detail={`${thisSeason.wins}-${thisSeason.losses} against ${thisSeason.expectedWins.toFixed(1)} deserved · ${ordinal(thisSeason.unluckRank)}-unluckiest of ${thisSeason.clubs}`}
                tone={thisSeason.luck < -0.5 ? 'bad' : thisSeason.luck > 0.5 ? 'good' : undefined}
              />
            ) : (
              <Tile label={`${seasonYear}, in progress`} value="—" detail="no games played yet this season" />
            )}
          </Tiles>

          <Note>
            {tenure.length > 0 ? (
              <>
                Your completed seasons: <b>{tenure.map((t) => `${t.year} ${t.wins}-${t.losses} (${signed(t.luck)})`).join(', ')}</b>.
                {' '}{seasonYear} is still running — a part-season on a wins axis reads as a collapse, so it sits in the tile above rather than on the line.
              </>
            ) : (
              <>Every season on this chart predates your appointment. It is the franchise you inherited, not a record of your work — the tenure view above filters it out once you have a finished season of your own.</>
            )}
            {' '}Expected wins run over the games each season actually played, so a strike-shortened or in-progress year is never compared against a full one.
          </Note>

          <TableTwin
            caption="Table view — every completed season on record"
            columns={['Season', 'W', 'L', 'T', 'PF', 'PA', 'Expected W', 'Luck', 'Result', 'Era']}
            rows={[...rows].reverse().map((r) => [
              r.year, r.wins, r.losses, r.ties, r.pointsFor, r.pointsAgainst,
              r.expectedWins.toFixed(1), signed(r.luck), r.playoffResult.replace('_', ' ').toLowerCase(),
              r.tenure ? 'you' : 'before you',
            ])}
          />
        </>
      )}
      {seasonLength > 0 && rows.some((r) => r.played !== seasonLength) && rows.length > 0 && (
        <p className="text-[11px] text-muted mt-2">
          Seasons of different lengths appear on this chart. Each one&apos;s expected wins are scaled to the games it played.
        </p>
      )}
    </Panel>
  );
}

function LedgerChart({ rows, tenureStartYear }: { rows: LuckSeasonRow[]; tenureStartYear: number }) {
  const W = 1140, H = 300, L = 40, R = 96, TOP = 22, BOT = 34;
  const pw = W - L - R, ph = H - TOP - BOT;

  // The axis runs to the longest season on record rather than a fixed 17, so a
  // league playing a shorter schedule is not drawn against a ceiling it can
  // never reach.
  const maxWins = Math.max(8, ...rows.map((r) => Math.max(r.actualWins, r.expectedWins)));
  const top = Math.ceil(maxWins / 4) * 4;
  const x = (i: number) => (rows.length === 1 ? L + pw / 2 : L + (pw * i) / (rows.length - 1));
  const y = (v: number) => TOP + ph - (ph * v) / top;
  const path = (get: (r: LuckSeasonRow) => number) =>
    rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(get(r)).toFixed(1)}`).join(' ');

  const ticks: number[] = [];
  for (let v = 0; v <= top; v += top / 4) ticks.push(v);

  const takeoverIdx = rows.findIndex((r) => r.tenure);
  const tx = takeoverIdx > 0 ? x(takeoverIdx) : null;
  const last = rows[rows.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block overflow-visible min-w-[560px]" role="img"
      aria-label={`Actual wins against Pythagorean expected wins, ${rows[0].year} to ${last.year}`}>
      {tx !== null && (
        <>
          <rect x={tx} y={TOP} width={W - R - tx} height={ph} fill={VIZ.accent} opacity={0.045} />
          <line x1={tx} x2={tx} y1={TOP} y2={TOP + ph} stroke={VIZ.accent} strokeWidth={1} opacity={0.5} />
          <text x={tx + 6} y={TOP + 12} className={TXT.ax} fill={VIZ.accent}>You take over · {tenureStartYear}</text>
        </>
      )}

      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={VIZ.line} strokeWidth={1} />
          <text x={L - 7} y={y(v) + 3.5} textAnchor="end" className={TXT.ax}>{v}</text>
        </g>
      ))}

      {rows.length > 1 && (
        <>
          <path d={path((r) => r.expectedWins)} fill="none" stroke={VIZ.seriesB} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={path((r) => r.actualWins)} fill="none" stroke={VIZ.seriesA} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        </>
      )}

      {rows.map((r, i) => (
        <g key={r.year}>
          <title>
            {`${r.year} · ${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''} · ${r.pointsFor} for / ${r.pointsAgainst} against · deserved ${r.expectedWins.toFixed(1)} · ${signed(r.luck)} · ${r.playoffResult.replace('_', ' ').toLowerCase()}`}
          </title>
          <rect x={x(i) - 9} y={TOP} width={18} height={ph} fill="transparent" />
          {/* A 2px surface ring on every marker, so overlapping seasons stay two dots. */}
          <circle cx={x(i)} cy={y(r.expectedWins)} r={3.2} fill={VIZ.seriesB} stroke={VIZ.card} strokeWidth={2} />
          <circle cx={x(i)} cy={y(r.actualWins)} r={3.6} fill={VIZ.seriesA} stroke={VIZ.card} strokeWidth={2} />
          {r.playoffResult !== 'MISSED' && (
            <circle cx={x(i)} cy={H - BOT + 8} r={2.6} fill={r.playoffResult === 'CHAMPION' ? VIZ.gold : VIZ.muted} />
          )}
          {(rows.length <= 12 || r.year % 4 === 2 || i === rows.length - 1 || i === 0) && (
            <text x={x(i)} y={H - 8} textAnchor="middle" className={TXT.ax}>{String(r.year).slice(2)}</text>
          )}
        </g>
      ))}

      {/* Endpoint labels only — a number on every point is chaos and goes unread.
          Nudged apart when the two series finish within a few pixels of each
          other, which is exactly the season where both labels matter most. */}
      {(() => {
        const yA = y(last.actualWins), yB = y(last.expectedWins);
        const mid = (yA + yB) / 2;
        const [lyA, lyB] = Math.abs(yA - yB) < 13
          ? (yA <= yB ? [mid - 6.5, mid + 6.5] : [mid + 6.5, mid - 6.5])
          : [yA, yB];
        return (
          <>
            <text x={x(rows.length - 1) + 9} y={lyA + 3} className={TXT.lbl}>{last.actualWins} won</text>
            <text x={x(rows.length - 1) + 9} y={lyB + 3} className={TXT.lbl} fill={VIZ.muted}>{last.expectedWins.toFixed(1)} earned</text>
          </>
        );
      })()}
    </svg>
  );
}
