'use client';

import clsx from 'clsx';
import { Download } from 'lucide-react';
import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { ChartCard, ChartTooltip } from '@/components/calc/ChartCard';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { Badge, Button, Card, CardHeader, RadioGroup, Segmented, Select } from '@/components/ui';
import { getHpiDivision, getHpiState, HPI_AS_OF, HPI_DIVISIONS, HPI_NATIONAL, HPI_SOURCE, HPI_STATES, type DivisionId, type HpiPeriod } from '@/data/mock/hpi';
import { comparisonLabel, indexSeries, PERIOD_LABELS, PERIOD_PHRASE, PERIOD_WINDOW, periodValue, quarterLabel, rankOf, SERIES_LENGTH, windowRebased } from '@/lib/calculations/hpi';
import { axisProps, gridProps, SERIES } from '@/lib/chartTheme';
import { downloadCsv } from '@/lib/exportCsv';
import { pct } from '@/lib/format';
import { useUrlState } from '@/lib/useUrlState';
import { TileMap } from './TileMap';

type View = 'national' | 'regional' | 'state';
interface HpiState {
  view: View;
  period: HpiPeriod;
  state: string;
  division: DivisionId;
}
const DEFAULTS: HpiState = { view: 'national', period: 'quarter', state: 'NJ', division: 'MA' };
const TOOL = 'house-price-index';

export function HousePriceIndex() {
  const [s, setS] = useUrlState<HpiState>(DEFAULTS);
  const set = (patch: Partial<HpiState>) => setS((p) => ({ ...p, ...patch }));
  const p = s.period;
  const nat = periodValue(HPI_NATIONAL, p);
  const st = getHpiState(s.state);
  const div = getHpiDivision(s.division);
  const stVal = periodValue(st, p);
  const divVal = periodValue(div, p);

  const mapValues = useMemo(() => {
    const out: Record<string, number> = {};
    for (const x of HPI_STATES) out[x.code] = s.view === 'regional' ? periodValue(getHpiDivision(x.division), p) : periodValue(x, p);
    return out;
  }, [s.view, p]);

  // Chart: national vs selected geography, rebased to 100 at the window start.
  const focus = s.view === 'regional' ? { label: div.name, stats: div } : s.view === 'state' ? { label: st.name, stats: st } : null;
  const chart = useMemo(() => {
    const w = PERIOD_WINDOW[p];
    const n = windowRebased(indexSeries(HPI_NATIONAL), w);
    const f = focus ? windowRebased(indexSeries(focus.stats), w) : null;
    const start = SERIES_LENGTH - 1 - w;
    return n.map((v, i) => ({ name: quarterLabel(start + i), national: Math.round(v * 100) / 100, focus: f ? Math.round(f[i] * 100) / 100 : undefined }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, focus?.label]);

  const sorted = [...HPI_STATES].sort((a, b) => periodValue(b, p) - periodValue(a, p));
  const fmt = (v: number) => pct(v, 2, { sign: true, trim: false });

  const download = () =>
    downloadCsv(`fhfa-hpi-${HPI_AS_OF.replace(' ', '')}-demo.csv`, [
      ['Geography', 'Type', 'Division', 'Quarter %', '1 Year %', '5 Year %', 'Since 1991 %'],
      ['United States', 'National', '', HPI_NATIONAL.q, HPI_NATIONAL.y1, HPI_NATIONAL.y5, HPI_NATIONAL.s91],
      ...HPI_DIVISIONS.map((d) => [d.name, 'Census division', '', d.q, d.y1, d.y5, d.s91]),
      ...HPI_STATES.map((x) => [x.name, 'State', getHpiDivision(x.division).name, x.q, x.y1, x.y5, x.s91]),
      [],
      [`Source: ${HPI_SOURCE} — Demo Data, ${HPI_AS_OF}`],
    ]);

  const tooltip = (code: string) => {
    const x = getHpiState(code);
    if (s.view === 'regional') {
      const d = getHpiDivision(x.division);
      return `${d.name} (${x.code}): ${fmt(periodValue(d, p))}`;
    }
    return `${x.name}: ${fmt(periodValue(x, p))}`;
  };

  const selectOnMap = (code: string) => {
    const x = getHpiState(code);
    if (s.view === 'regional') set({ division: x.division, state: code });
    else set({ view: 'state', state: code });
  };

  const talkGeo = s.view === 'regional' ? div.name : st.code === 'NJ' ? 'NJ' : st.name;
  const talkVal = s.view === 'regional' ? divVal : stVal;

  return (
    <CalculatorShell
      toolId={TOOL}
      demo
      subtitle="FHFA house price changes by state, census division and nationally."
      actions={
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={download}>
          Download
        </Button>
      }
    >
      <Card className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <Segmented<View>
          ariaLabel="Geography"
          value={s.view}
          onChange={(view) => set({ view })}
          options={[
            { value: 'national', label: 'National' },
            { value: 'regional', label: 'Regional' },
            { value: 'state', label: 'State' },
          ]}
        />
        <RadioGroup<HpiPeriod> value={p} onChange={(period) => set({ period })} options={(Object.keys(PERIOD_LABELS) as HpiPeriod[]).map((k) => ({ value: k, label: PERIOD_LABELS[k] }))} />
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader
            title={s.view === 'regional' ? 'Census divisions' : 'States'}
            subtitle={`${PERIOD_LABELS[p]} change · ${HPI_AS_OF} · Click a ${s.view === 'regional' ? 'division' : 'state'} to select it`}
          />
          <TileMap values={mapValues} selected={s.view === 'national' ? null : s.view === 'state' ? s.state : null} highlightGroup={s.view === 'regional' ? HPI_STATES.filter((x) => x.division === s.division).map((x) => x.code) : undefined} onSelect={selectOnMap} tooltip={tooltip} />
        </Card>

        <div className="min-w-0 space-y-6">
          {s.view === 'national' && (
            <Card>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">National · {PERIOD_LABELS[p]}{p === 'quarter' ? 'ly avg' : ''}</div>
              <div className="mt-1 text-5xl font-bold tabular-nums tracking-tight text-slate-900">{pct(nat, 2, { trim: false })}</div>
              <p className="mt-1 text-sm text-slate-500">
                U.S. house prices {PERIOD_PHRASE[p]} · {HPI_AS_OF}
              </p>
              <div className="mt-5 grid grid-cols-2 gap-4">
                <RankList title="Strongest" rows={sorted.slice(0, 5)} p={p} onPick={(c) => set({ view: 'state', state: c })} />
                <RankList title="Weakest" rows={sorted.slice(-5).reverse()} p={p} onPick={(c) => set({ view: 'state', state: c })} />
              </div>
            </Card>
          )}

          {s.view === 'state' && (
            <Card>
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">State · {PERIOD_LABELS[p]}</div>
                <div className="w-44">
                  <Select ariaLabel="State" value={s.state} onChange={(state) => set({ state })} options={[...HPI_STATES].sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ value: x.code, label: x.name }))} />
                </div>
              </div>
              <div className="mt-2 text-lg font-semibold text-slate-900">{st.name}</div>
              <div className="mt-1 text-5xl font-bold tabular-nums tracking-tight text-slate-900">{pct(stVal, 2, { trim: false })}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={stVal >= nat ? 'green' : 'amber'}>{comparisonLabel(st.code, stVal, nat, p)}</Badge>
                <span className="text-xs text-slate-500">
                  National {pct(nat, 2, { trim: false })} · Rank #{rankOf(HPI_STATES, st.code, p)} of 51
                </span>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                {(Object.keys(PERIOD_LABELS) as HpiPeriod[]).map((k) => (
                  <div key={k} className={clsx('rounded-lg border px-3 py-2', k === p ? 'border-brand-200 bg-brand-50/60' : 'border-slate-200')}>
                    <dt className="text-xs text-slate-500">{PERIOD_LABELS[k]}</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">{fmt(periodValue(st, k))}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          {s.view === 'regional' && (
            <Card>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Census divisions · {PERIOD_LABELS[p]}</div>
              <ul className="mt-3 space-y-1">
                {[...HPI_DIVISIONS]
                  .sort((a, b) => periodValue(b, p) - periodValue(a, p))
                  .map((d) => {
                    const v = periodValue(d, p);
                    const max = Math.max(...HPI_DIVISIONS.map((x) => Math.abs(periodValue(x, p))), 0.01);
                    return (
                      <li key={d.id}>
                        <button type="button" onClick={() => set({ division: d.id })} className={clsx('w-full rounded-lg px-2 py-1.5 text-left transition-colors', d.id === s.division ? 'bg-brand-50' : 'hover:bg-slate-50')}>
                          <div className="flex items-center justify-between text-sm">
                            <span className={clsx('font-medium', d.id === s.division ? 'text-brand-800' : 'text-slate-700')}>{d.name}</span>
                            <span className="font-semibold tabular-nums text-slate-900">{fmt(v)}</span>
                          </div>
                          <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                            <div className="h-1.5 rounded-full" style={{ width: `${(Math.max(0, v) / max) * 100}%`, background: SERIES[0] }} />
                          </div>
                        </button>
                      </li>
                    );
                  })}
              </ul>
              <p className="mt-3 text-xs text-slate-500">
                {div.name}: {fmt(divVal)} vs national {fmt(nat)} · {HPI_STATES.filter((x) => x.division === div.id).map((x) => x.code).join(', ')}
              </p>
            </Card>
          )}
        </div>
      </div>

      <ChartCard
        title={focus ? `${focus.label} vs national` : 'National house price index'}
        subtitle={`Index rebased to 100 at ${chart[0]?.name} · ${PERIOD_LABELS[p]} window`}
        height={280}
        legend={focus ? [{ label: 'National', color: SERIES[0] }, { label: focus.label, color: SERIES[1] }] : undefined}
        table={{ head: ['Quarter', 'National', ...(focus ? [focus.label] : [])], rows: chart.map((r) => [r.name, r.national.toFixed(2), ...(focus ? [r.focus?.toFixed(2) ?? ''] : [])]) }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="name" {...axisProps} minTickGap={24} />
            <YAxis {...axisProps} width={44} domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(0)} />
            <Tooltip content={<ChartTooltip format={(v) => v.toFixed(2)} />} />
            <Line type="monotone" dataKey="national" name="National" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            {focus && <Line type="monotone" dataKey="focus" name={focus.label} stroke={SERIES[1]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <TalkTrack>
        {s.view === 'national'
          ? `“U.S. home prices are ${nat >= 0 ? 'up' : 'down'} ${pct(Math.abs(nat), 2)} ${PERIOD_PHRASE[p]} per FHFA — ${sorted[0].name} leads at ${fmt(periodValue(sorted[0], p))}.”`
          : `“${talkGeo} prices ${fmt(talkVal)} ${PERIOD_PHRASE[p]} per FHFA vs national ${pct(nat, 2)}.”`}
      </TalkTrack>

      <p className="text-xs text-slate-500">
        Source: {HPI_SOURCE}, {HPI_AS_OF}. Demo Data — values for illustration; plug in the FHFA HPI release via data/mock/hpi.ts.
      </p>
    </CalculatorShell>
  );
}

function RankList({ title, rows, p, onPick }: { title: string; rows: { code: string; name: string; q: number; y1: number; y5: number; s91: number }[]; p: HpiPeriod; onPick: (code: string) => void }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-medium text-slate-500">{title}</div>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.code}>
            <button type="button" onClick={() => onPick(r.code)} className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-slate-50">
              <span className="truncate text-slate-700">{r.name}</span>
              <span className="font-semibold tabular-nums text-slate-900">{pct(periodValue(r, p), 2, { sign: true, trim: false })}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
