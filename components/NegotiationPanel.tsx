'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  evaluateOffer, PERSONALITY_BLURB, PERSONALITY_LABEL,
  type NegotiationContext, type Offer,
} from '@/lib/negotiation';
import { formatMoney } from '@/lib/cap';
import { InterestMeter } from './ds/InterestMeter';

/**
 * The negotiation minigame.
 *
 * Every control is a slider and the meter re-reads on every drag, with no
 * server round trip — that is only possible because `evaluateOffer` is pure
 * and the context (including every random draw) was resolved server-side and
 * handed down. A version that posted each change to the server would lag by a
 * request per pixel and the whole feel would be lost.
 *
 * What the user cannot see is the number he will sign for. They get the
 * meter, his agent's mood, and a list of demands, and have to work it out.
 * Patience is what stops them binary-searching the hidden number: each
 * formally submitted offer that he rejects costs one, and a genuine lowball
 * costs an extra one. Dragging sliders is free; *submitting* is not.
 */
export function NegotiationPanel({
  ctx, capSpace, minSalary, maxYears, onSign, disabled, disabledReason,
}: {
  ctx: NegotiationContext;
  /** Room available. The offer cannot exceed it; the slider is clamped. */
  capSpace: number;
  minSalary: number;
  maxYears: number;
  /** Executes the signing. Server re-validates — the client's verdict is never trusted. */
  onSign: (offer: Offer) => Promise<{ ok: boolean; message: string }>;
  disabled?: boolean;
  disabledReason?: string;
}) {
  // Open at market rate rather than at zero: a slider that starts at the
  // bottom reads as "make a lowball", and the first thing every user did was
  // drag it up anyway.
  const openingApy = Math.min(Math.max(ctx.marketApy, minSalary), Math.max(minSalary, capSpace));
  const [apy, setApy] = useState(openingApy);
  const [years, setYears] = useState(Math.min(ctx.desiredYears, maxYears));
  const [guaranteePct, setGuaranteePct] = useState(0.5);

  const [patienceLeft, setPatienceLeft] = useState(ctx.patience);
  const [history, setHistory] = useState<{ apy: number; years: number; verdict: string }[]>([]);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const offer: Offer = { apy, years, guaranteePct };
  // useMemo purely to avoid recomputing on unrelated re-renders; the call is
  // cheap enough that correctness never depends on it.
  const evaluation = useMemo(() => evaluateOffer(ctx, offer), [ctx, apy, years, guaranteePct]);

  const walkedAway = patienceLeft <= 0;
  const overCap = apy > capSpace;
  const canSubmit = !disabled && !walkedAway && !pending && !overCap && !result?.ok;

  // A ceiling of 2.5x market gives room to overpay a holdout without the
  // slider's useful range collapsing into a few pixels at the bottom.
  const apyCeiling = Math.max(minSalary * 2, Math.round(ctx.marketApy * 2.5));
  const apyStep = 100_000;

  const submit = () => {
    startTransition(async () => {
      const res = await onSign(offer);
      setResult(res);
      setHistory((h) => [...h, { apy, years, verdict: evaluation.verdict }]);
      if (!res.ok) {
        // Rejection costs patience; an outright insult costs an extra one.
        setPatienceLeft((p) => Math.max(0, p - (evaluation.insulting ? 2 : 1)));
      }
    });
  };

  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-line/70 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="label-sm">Contract Talks</div>
          <div className="text-sm mt-0.5">
            <span className="font-semibold">{PERSONALITY_LABEL[ctx.personality]}</span>
            <span className="text-muted"> · {ctx.position} · age {ctx.age}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="label-sm">Patience</div>
          <div className="flex items-center gap-1 mt-1 justify-end">
            {Array.from({ length: ctx.patience }).map((_, i) => (
              <span key={i} className={`w-2 h-2 rounded-full ${i < patienceLeft ? 'bg-accent' : 'bg-line'}`} />
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-line/60">
        <p className="text-xs text-muted">{PERSONALITY_BLURB[ctx.personality]}</p>
      </div>

      <div className="px-4 py-4 space-y-4">
        <InterestMeter interest={evaluation.interest} verdict={evaluation.verdict} headline={evaluation.headline} />

        <div className="space-y-3.5">
          <Slider
            label="Salary"
            value={formatMoney(apy) + '/yr'}
            hint={`Market estimate ${formatMoney(ctx.marketApy)}/yr`}
            min={minSalary}
            max={apyCeiling}
            step={apyStep}
            raw={apy}
            onChange={setApy}
            disabled={walkedAway || disabled}
            warn={overCap ? `Over your cap room by ${formatMoney(apy - capSpace)}` : undefined}
          />
          <Slider
            label="Years"
            value={`${years} year${years === 1 ? '' : 's'}`}
            hint={`Total ${formatMoney(apy * years)}`}
            min={1}
            max={maxYears}
            step={1}
            raw={years}
            onChange={setYears}
            disabled={walkedAway || disabled}
          />
          <Slider
            label="Guaranteed"
            value={`${Math.round(guaranteePct * 100)}%`}
            hint={`${formatMoney(Math.round(apy * years * guaranteePct))} locked in`}
            min={0}
            max={100}
            step={5}
            raw={Math.round(guaranteePct * 100)}
            onChange={(v) => setGuaranteePct(v / 100)}
            disabled={walkedAway || disabled}
          />
        </div>

        {evaluation.demands.length > 0 && !walkedAway && (
          <ul className="space-y-1">
            {evaluation.demands.map((d) => (
              <li key={d} className="text-xs text-muted flex gap-2">
                <span className="text-warn shrink-0">▸</span>{d}
              </li>
            ))}
          </ul>
        )}

        {history.length > 0 && (
          <div className="text-[11px] text-muted border-t border-line/50 pt-2.5">
            <span className="label-sm text-[10px]">Offers made</span>
            <div className="mt-1 space-y-0.5">
              {history.map((h, i) => (
                <div key={i} className="font-mono">
                  {formatMoney(h.apy)}/yr × {h.years}yr — turned down
                </div>
              ))}
            </div>
          </div>
        )}

        {walkedAway && (
          <p className="text-sm text-bad">
            His agent has stopped returning calls. {ctx.incumbent ? 'He will test the market.' : 'He is signing somewhere else.'}
          </p>
        )}
        {result && (
          <p className={`text-sm ${result.ok ? 'text-accent' : 'text-bad'}`}>{result.message}</p>
        )}
        {disabled && disabledReason && <p className="text-sm text-muted">{disabledReason}</p>}

        <button className="btn-primary w-full" onClick={submit} disabled={!canSubmit}>
          {pending ? 'Sending…' : overCap ? 'Not enough cap room' : 'Make this offer'}
        </button>
      </div>
    </div>
  );
}

function Slider({ label, value, hint, min, max, step, raw, onChange, disabled, warn }: {
  label: string; value: string; hint?: string;
  min: number; max: number; step: number; raw: number;
  onChange: (v: number) => void; disabled?: boolean; warn?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="label-sm">{label}</span>
        <span className="stat-value text-stat-sm">{value}</span>
      </div>
      <input
        type="range"
        className="slider mt-2"
        min={min} max={max} step={step} value={raw}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
      <div className="flex items-baseline justify-between gap-3 mt-1">
        <span className="text-[11px] text-muted">{hint}</span>
        {warn && <span className="text-[11px] text-bad">{warn}</span>}
      </div>
    </div>
  );
}
