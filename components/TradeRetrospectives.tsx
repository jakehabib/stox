import type { TradeRetrospective, AssetOutcome } from '@/lib/tradeRetro';

function AssetLine({ o }: { o: AssetOutcome }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-chalk">{o.label}{o.position ? ` (${o.position})` : ''}</span>
      <span className="text-muted text-right">{o.note}</span>
    </div>
  );
}

// Trade-value points are an internal abstract score (same units as the trade
// builder's ratio bar) — not a dollar figure — so this shows a rounded score
// and a plain % change, never a $-formatted number.
function ValueDelta({ then, now }: { then: number; now: number | null }) {
  if (now === null) return <span className="font-mono text-muted">Value {Math.round(then)} → pending</span>;
  const pct = then > 0 ? Math.round(((now - then) / then) * 100) : 0;
  const grew = now >= then;
  return (
    <span className="font-mono">
      {Math.round(then)} → {Math.round(now)} <span className={grew ? 'text-accent' : 'text-bad'}>({pct >= 0 ? '+' : ''}{pct}%)</span>
    </span>
  );
}

export function TradeRetrospectives({ myAbbr, retrospectives }: { myAbbr: string; retrospectives: TradeRetrospective[] }) {
  if (retrospectives.length === 0) return null;

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-line">
        <div className="font-semibold text-sm">Trade Retrospectives</div>
        <div className="text-xs text-muted mt-0.5">Every trade you've made, graded by how the return has held up since.</div>
      </div>
      <div className="divide-y divide-line/60">
        {retrospectives.map((r) => {
          const youAreA = r.teamAAbbr === myAbbr;
          const partnerAbbr = youAreA ? r.teamBAbbr : r.teamAAbbr;
          const yourReceived = youAreA ? r.bToA : r.aToB;
          const theirReceived = youAreA ? r.aToB : r.bToA;
          const yourThen = youAreA ? r.aValueThen : r.bValueThen;
          const yourNow = youAreA ? r.aValueNow : r.bValueNow;
          const theirThen = youAreA ? r.bValueThen : r.aValueThen;
          const theirNow = youAreA ? r.bValueNow : r.aValueNow;
          const youWon = r.verdict.startsWith(`${myAbbr} has`);
          const youLost = r.verdict.startsWith(`${partnerAbbr} has`);

          return (
            <div key={r.id} className="px-4 py-3 space-y-2.5">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <div className="text-xs text-muted font-mono">{r.seasonYear} · Wk {r.week} · vs {partnerAbbr}</div>
                <div className={`text-xs font-medium ${youWon ? 'text-accent' : youLost ? 'text-bad' : 'text-muted'}`}>{r.verdict}</div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="stat-tile space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="label-sm">You received</span>
                    <ValueDelta then={yourThen} now={yourNow} />
                  </div>
                  {yourReceived.map((o) => <AssetLine key={o.type + o.id} o={o} />)}
                </div>
                <div className="stat-tile space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="label-sm">{partnerAbbr} received</span>
                    <ValueDelta then={theirThen} now={theirNow} />
                  </div>
                  {theirReceived.map((o) => <AssetLine key={o.type + o.id} o={o} />)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
