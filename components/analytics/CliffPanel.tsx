import { AgeBandRow, AgeCliff, CapHealth, UnitSpendRow } from '@/lib/analytics';
import { formatMoney } from '@/lib/cap';
import { Panel, Legend, Note, Tiles, Tile, SubHead, TableTwin } from './Panel';
import { VIZ, TXT, SIDE_COLOR, pct1 } from './viz';

/**
 * Panel 7 — the age curve and the deals that expire against it.
 *
 * Deliberately TWO charts sharing one x, not one chart with two y-axes.
 * Bodies and dollars are different units; a single pair of axes would invent a
 * relationship this roster does not have. It costs a little width and it is
 * the right trade.
 */
export function CliffPanel({ bands, cliff, capHealth, groups, seasonYear, nextYearCap, activeSalary, contractCount, expiringCount, capEnabled }: {
  bands: AgeBandRow[];
  cliff: AgeCliff;
  capHealth: CapHealth;
  groups: UnitSpendRow[];
  seasonYear: number;
  nextYearCap: number;
  activeSalary: number;
  contractCount: number;
  expiringCount: number;
  capEnabled: boolean;
}) {
  const anyBodies = bands.some((b) => b.players > 0);

  return (
    <Panel
      span={5}
      eyebrow="Bodies and dollars, by age"
      title="The Cliff, Two Years Out"
      aside={`${cliff.starterCount} first-teamers`}
      why={<>
        Bodies on the left, dollars on the right, both by age. First team is the eleven, eleven and two who take
        the field, filled at each position in rating order — so the blue block is what you actually put out there.
      </>}
    >
      {!anyBodies ? (
        <p className="text-sm text-muted py-6">No players on this roster yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="label-sm text-[9.5px] mb-0.5">Players</div>
              <AgeChart bands={bands} kind="players" activeSalary={activeSalary} />
            </div>
            <div>
              <div className="label-sm text-[9.5px] mb-0.5">Cap dollars</div>
              <AgeChart bands={bands} kind="spend" activeSalary={activeSalary} />
            </div>
          </div>
          <Legend
            keys={[{ color: VIZ.seriesA, label: 'First team', shape: 'block' }, { color: VIZ.depth, label: 'Depth', shape: 'block' }]}
            note="Dollar labels in $M"
          />

          <Tiles cols={3}>
            <Tile label="Starters 30+ now" value={String(cliff.startersOver30)} detail={`of ${cliff.starterCount} first-teamers`} />
            <Tile
              label={`Starters 30+ in ${seasonYear + 2}`}
              value={String(cliff.startersOver30InTwo)}
              detail={capEnabled ? `holding ${formatMoney(cliff.starterSpendOver30InTwo)} today` : 'cap mode is off'}
              tone={cliff.startersOver30InTwo > cliff.starterCount / 3 ? 'warn' : undefined}
            />
            <Tile
              label={`Signed through ${seasonYear + 2}`}
              value={String(cliff.startersSignedPastTwo)}
              detail={`first-teamers, ${cliff.rosterSignedPastTwo} in all`}
            />
          </Tiles>

          <Note>
            Cap-weighted age <b>{capHealth.capWeightedAge.toFixed(1)}</b> against a roster mean of
            {' '}{capHealth.rosterAvgAge.toFixed(1)} — the money is older than the team, which is the normal shape and
            only worrying when the gap widens.
            {capEnabled && <> {pct1(capHealth.nextYearCommittedShare)} of next season&apos;s {formatMoney(nextYearCap)} ceiling is already spoken for.</>}
          </Note>

          <SubHead
            eyebrow={`Decisions waiting in the ${seasonYear} offseason`}
            title="Deals In Their Final Year"
            aside={`${expiringCount} of ${contractCount} contracts`}
          />
          <div className="grid grid-cols-9 gap-1.5 mt-2.5">
            {groups.map((g) => (
              <div
                key={g.group}
                data-side={g.side}
                className="stat-tile px-1 py-1.5 text-center
                           group-data-[units=OFF]/an:data-[side=DEF]:opacity-25 group-data-[units=OFF]/an:data-[side=ST]:opacity-25
                           group-data-[units=DEF]/an:data-[side=OFF]:opacity-25 group-data-[units=DEF]/an:data-[side=ST]:opacity-25
                           transition-opacity"
                title={`${g.group}: ${g.expiring} of ${g.count} deals in a final year · unit rates ${g.rating}, ${g.rank} of 32`}
              >
                <span className="block w-2 h-2 rounded-sm mx-auto mb-1" style={{ background: SIDE_COLOR[g.side] }} />
                <b className="block text-[10.5px] tracking-wider text-muted font-semibold">{g.group}</b>
                <i className={`block not-italic stat-value text-[16px] mt-0.5 ${g.expiring >= 3 ? 'text-warn' : ''}`}>
                  {g.expiring}<em className="not-italic text-[10px] text-muted font-semibold">/{g.count}</em>
                </i>
              </div>
            ))}
          </div>

          <TableTwin
            caption="Age bands, in numbers"
            columns={['Band', 'Players', 'First team', 'Cap $', 'Share of salary', 'Mean rating']}
            rows={bands.map((b) => [
              b.band, b.players, b.starters, formatMoney(b.spend),
              activeSalary > 0 ? pct1(b.spend / activeSalary) : '—',
              b.avgOvr ? b.avgOvr.toFixed(1) : '—',
            ])}
          />
        </>
      )}
    </Panel>
  );
}

function AgeChart({ bands, kind, activeSalary }: { bands: AgeBandRow[]; kind: 'players' | 'spend'; activeSalary: number }) {
  const W = 330, H = 182, L = 8, R = 8, TOP = 24, BOT = 40;
  const pw = W - L - R, ph = H - TOP - BOT;
  const isCount = kind === 'players';
  const total = (d: AgeBandRow) => (isCount ? d.players : d.spend);
  const max = Math.max(1, ...bands.map(total)) * 1.18;
  const bw = 26;
  const cx = (i: number) => L + (pw * (i + 0.5)) / bands.length;
  const hOf = (v: number) => (ph * v) / max;
  const label = (v: number) => (isCount ? String(v) : (v / 1e6).toFixed(1));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block overflow-visible" role="img"
      aria-label={isCount ? 'Roster count by age band, first team and depth' : 'Cap dollars by age band'}>
      <line x1={L} x2={W - R} y1={TOP + ph} y2={TOP + ph} stroke={VIZ.line} strokeWidth={1} />
      {bands.map((d, i) => {
        const tot = total(d);
        const st = isCount ? d.starters : 0;
        const hTot = hOf(tot), hSt = hOf(st);
        const hDepth = Math.max(0, hTot - hSt);
        const x0 = cx(i) - bw / 2;
        const yTop = TOP + ph - hTot;
        return (
          <g key={d.band}>
            <title>
              {isCount
                ? `${d.band} · ${d.players} on the roster, ${d.starters} of them first-team${d.avgOvr ? ` · mean rating ${d.avgOvr.toFixed(1)}` : ''}`
                : `${d.band} · ${formatMoney(d.spend)} of cap${activeSalary > 0 ? `, ${pct1(d.spend / activeSalary)} of active salary` : ''}, across ${d.players} player${d.players === 1 ? '' : 's'}`}
            </title>
            <rect x={x0 - 8} y={TOP - 14} width={bw + 16} height={ph + 14} fill="transparent" />
            {/* First team sits on the baseline; depth stacks above it with a
                2px surface gap so the two segments never read as one block. */}
            {isCount ? (
              <>
                {hSt > 0 && <rect x={x0} y={TOP + ph - hSt} width={bw} height={hSt} fill={VIZ.seriesA} />}
                {hDepth > 2 && <rect x={x0} y={yTop} width={bw} height={hDepth - 2} rx={3} fill={VIZ.depth} />}
              </>
            ) : (
              hTot > 0 && <rect x={x0} y={yTop} width={bw} height={hTot} rx={3} fill={VIZ.seriesA} />
            )}
            {tot > 0 && <text x={cx(i)} y={yTop - 6} textAnchor="middle" className={TXT.lbl}>{label(tot)}</text>}
            <text x={cx(i)} y={TOP + ph + 15} textAnchor="middle" className={TXT.ax}>{d.band}</text>
          </g>
        );
      })}
      <text x={L + pw / 2} y={H - 5} textAnchor="middle" className={TXT.axt}>Age{isCount ? '' : ' · $M'}</text>
    </svg>
  );
}
