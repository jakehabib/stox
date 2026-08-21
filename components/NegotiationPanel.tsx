'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  decideOffer, sessionFingerprint, PERSONALITY_BLURB, PERSONALITY_LABEL,
  DEFAULT_STRUCTURE,
  type DealStructure, type NegotiationOutcome, type NegotiationSession, type Offer,
} from '@/lib/negotiation';
import { formatMoney } from '@/lib/cap';
import { InterestMeter } from './ds/InterestMeter';
import { ActionButton } from './ds/ActionButton';

/**
 * The negotiation minigame — the one surface in this game the app owner asked
 * for by name: *"the contract negotiations for re-sign and free agency need to
 * be more of a minigame instead of them accepting everything. A live updating
 * interest meter might work"*, and then *"the salary should just be a slider
 * too"*.
 *
 * Every control is a slider and the meter re-reads on every drag with no
 * server round trip. That is only possible because `decideOffer` is pure and
 * the session — including every random draw and the hidden reservation price
 * — was resolved server-side and handed down whole. A version that posted
 * each change to the server would lag a request behind the user's thumb and
 * the entire feel would be gone.
 *
 * THE SAME FUNCTION DECIDES. `decideOffer` is what draws this meter and it is
 * what the Server Action runs on submit, against a session it re-resolves
 * from the database. The client's answer is never trusted — it is computed
 * here only so the bar can move — but it can never disagree either, which is
 * the property that makes the meter worth looking at. (README design
 * principle 6: no lying metrics.)
 *
 * What the user cannot see is the number he will sign for. They get the
 * meter, his agent's mood and a list of demands, and have to work it out.
 * Patience is what stops them binary-searching the hidden number: each
 * formally submitted offer he rejects costs one, and a genuine lowball costs
 * two. Dragging sliders is free; *submitting* is not.
 *
 * Which is why the patience pips DRAIN rather than flipping colour between
 * renders. The cost of pressing the button is the mechanic this whole panel
 * is built around, and a dot quietly changing colour on the next paint was
 * the weakest possible statement of it. The fill empties over --dur-reveal;
 * under reduced motion it empties instantly, and the pip is just as empty
 * either way. Nothing is added to the submit path — the drain starts once the
 * server has already answered.
 */
export function NegotiationPanel({
  initialSession, structure = DEFAULT_STRUCTURE, structureSlot, banner,
  onOffer, onSigned, disabled, disabledReason, title = 'Contract Talks',
}: {
  /** Resolved server-side. Replaced by whatever the server hands back on every submit. */
  initialSession: NegotiationSession;
  /** Cap accounting the user controls; the player does not judge it. */
  structure?: DealStructure;
  /** Front/back-loading and void-year controls, rendered inside the panel. */
  structureSlot?: ReactNode;
  /** Rival-bid line, Market Knowledge line — whatever the screen wants above the meter. */
  banner?: ReactNode;
  /** Executes the offer. The server re-decides; this component never signs anything. */
  onOffer: (
    offer: Offer, structure: DealStructure, patienceSpent: number, fingerprint: string,
  ) => Promise<NegotiationOutcome>;
  onSigned?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  title?: string;
}) {
  const [session, setSession] = useState(initialSession);
  const { ctx, gate } = session;

  // Open at his market estimate rather than at zero: a slider that starts at
  // the bottom reads as "make a lowball", and the first thing every user did
  // was drag it up anyway.
  const [apy, setApy] = useState(() =>
    clampStep(Math.max(gate.minSalary, Math.min(ctx.marketApy, gate.maxSalary)), gate.minSalary, gate.maxSalary),
  );
  const [years, setYears] = useState(() => Math.min(ctx.desiredYears, gate.maxYears));
  const [guaranteePct, setGuaranteePct] = useState(0.5);

  const [patienceSpent, setPatienceSpent] = useState(0);
  const [history, setHistory] = useState<{ apy: number; years: number; outcome: string }[]>([]);
  const [result, setResult] = useState<NegotiationOutcome | null>(null);

  const offer: Offer = { apy, years, guaranteePct };
  // useMemo purely to avoid recomputing on unrelated re-renders; the call is
  // cheap enough that correctness never depends on it.
  const decision = useMemo(
    () => decideOffer(ctx, offer, gate, structure),
    [ctx, gate, apy, years, guaranteePct, structure],
  );
  const ev = decision.evaluation;

  const signed = result?.ok === true;
  const gone = !!result?.lostTo;
  const walkedAway = patienceSpent >= ctx.patience || !!result?.walkedAway;
  const over = signed || gone || walkedAway || !!disabled;
  const canSubmit = !over && decision.blocked === null;

  const submit = async () => {
    const res = await onOffer(offer, structure, patienceSpent, sessionFingerprint(session));
    setResult(res);
    setSession(res.session);
    setPatienceSpent(res.patienceSpent);
    if (res.ok) { onSigned?.(); return 'Signed'; }
    setHistory((h) => [...h, {
      apy, years,
      outcome: res.lostTo ? `lost to ${res.lostTo.teamName}` : res.decision.evaluation.verdict.toLowerCase(),
    }]);
    // A refusal is not an achievement and must not be dressed as one — the
    // done beat is suppressed and the message below carries the answer.
    return false as const;
  };

  const capOn = gate.capMode !== 'OFF';
  const spaceAfter = gate.capSpace - decision.year1CapHit;

  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-line/70 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="label-sm">{title}</div>
          <div className="text-sm mt-0.5">
            <span className="font-semibold">{PERSONALITY_LABEL[ctx.personality]}</span>
            <span className="text-muted"> · {ctx.position} · age {ctx.age}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="label-sm">Patience</div>
          <div className="flex items-center gap-1 mt-1 justify-end">
            {Array.from({ length: ctx.patience }).map((_, i) => (
              <span key={i} className={`pip-well w-2 h-2 ${i < ctx.patience - patienceSpent ? '' : 'pip-spent'}`}>
                <span className="pip-fill" />
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-line/60">
        <p className="text-xs text-muted">{PERSONALITY_BLURB[ctx.personality]}</p>
      </div>

      {banner && <div className="px-4 pt-3 space-y-2">{banner}</div>}

      <div className="px-4 py-4 space-y-4">
        <InterestMeter interest={ev.interest} verdict={ev.verdict} headline={ev.headline} />

        <div className="space-y-3.5">
          <Slider
            label="Salary"
            value={`${formatMoney(apy)}/yr`}
            hint={`Market estimate ${formatMoney(ctx.marketApy)}/yr`}
            min={gate.minSalary}
            max={gate.maxSalary}
            step={100_000}
            raw={apy}
            onChange={setApy}
            disabled={over}
            warn={decision.blocked === 'CAP' ? `Over your room by ${formatMoney(decision.year1CapHit - gate.capSpace)}` : undefined}
          />
          <Slider
            label="Years"
            value={`${years} year${years === 1 ? '' : 's'}`}
            hint={`Total ${formatMoney(decision.totalValue)}`}
            min={1}
            max={gate.maxYears}
            step={1}
            raw={years}
            onChange={setYears}
            disabled={over || gate.maxYears <= 1}
            warn={gate.maxYears <= 1 ? `At ${ctx.age} nobody may be given more than one year` : undefined}
          />
          <Slider
            label="Guaranteed"
            value={`${Math.round(guaranteePct * 100)}%`}
            hint={`${formatMoney(decision.guaranteedMoney)} locked in`}
            min={0}
            max={100}
            step={5}
            raw={Math.round(guaranteePct * 100)}
            onChange={(v) => setGuaranteePct(v / 100)}
            disabled={over}
            warn={capOn && decision.deadMoneyIfCut > 0 ? `${formatMoney(decision.deadMoneyIfCut)} dead if you cut him` : undefined}
          />
        </div>

        {structureSlot}

        {ev.demands.length > 0 && !over && (
          <ul className="space-y-1">
            {ev.demands.map((d) => (
              <li key={d} className="text-xs text-muted flex gap-2">
                <span className="text-warn shrink-0">▸</span>{d}
              </li>
            ))}
          </ul>
        )}

        {/* The ledger. Same figures the old offer form showed, in the same
            shape — but read off the SAME decision object that drew the meter,
            so the cap number the panel refuses on is the cap number on
            screen. */}
        <div className="panel p-3 space-y-1.5 text-sm">
          <div className="flex justify-between"><span className="text-muted">Total value</span><span className="font-mono">{formatMoney(decision.totalValue)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Guaranteed</span><span className="font-mono">{formatMoney(decision.guaranteedMoney)}</span></div>
          {capOn && (
            <>
              <div className="flex justify-between"><span className="text-muted">Dead money if cut</span><span className="font-mono">{formatMoney(decision.deadMoneyIfCut)}</span></div>
              <div className="flex justify-between pt-2 border-t border-line/60">
                <span className="text-muted">Cap space after</span>
                <span className={`stat-value text-stat-sm ${spaceAfter < 0 ? 'text-bad' : 'text-accent'}`}>{formatMoney(spaceAfter)}</span>
              </div>
              <div>
                <div className="text-xs text-muted mb-1">Cap hit by year</div>
                <div className="flex flex-wrap gap-2">
                  {decision.capHitSchedule.map((hit, i) => (
                    <div key={i} className={`pill ${i === 0 && decision.blocked === 'CAP' ? 'border-bad/40 text-bad' : 'border-line text-chalk'}`}>
                      Yr{i + 1}: {formatMoney(hit)}
                    </div>
                  ))}
                  {decision.strandedVoidMoney > 0 && (
                    <div className="pill border-warn/40 text-warn" title="Bonus proration pushed past the end of the deal by void years — charged as dead money the season it expires.">
                      Void: {formatMoney(decision.strandedVoidMoney)}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {history.length > 0 && (
          <div className="text-[11px] text-muted border-t border-line/50 pt-2.5">
            <span className="label-sm text-[10px]">Offers made</span>
            <div className="mt-1 space-y-0.5">
              {history.map((h, i) => (
                <div key={i} className="font-mono">
                  {formatMoney(h.apy)}/yr × {h.years}yr — {h.outcome}
                </div>
              ))}
            </div>
          </div>
        )}

        {walkedAway && !signed && !gone && (
          <p className="text-sm text-bad">
            His agent has stopped returning calls. {ctx.incumbent ? 'He will test the market.' : 'He is signing somewhere else.'}
          </p>
        )}
        {result && <p className={`text-sm ${result.ok ? 'text-accent' : result.lostTo ? 'text-bad' : 'text-accent2'}`}>{result.message}</p>}
        {!result && decision.reason && !decision.accepted && (
          <p className={`text-xs ${decision.blocked || decision.outbid ? 'text-bad' : 'text-muted'}`}>{decision.reason}</p>
        )}
        {disabled && disabledReason && <p className="text-sm text-muted">{disabledReason}</p>}

        <ActionButton
          className={`w-full ${decision.outbid ? 'btn-danger' : 'btn-primary'}`}
          disabled={!canSubmit}
          idleLabel={
            signed ? 'Signed'
              : gone ? 'He signed elsewhere'
              : walkedAway ? 'Talks are over'
              : decision.blocked === 'CAP' ? 'Not enough cap room'
              : decision.blocked ? 'Cannot offer this'
              : decision.outbid ? `Offer anyway — ${gate.competingTeam ?? 'a rival'} is higher`
              : decision.accepted ? 'Offer this deal — he signs'
              : `Offer this deal — costs ${ev.insulting ? '2 patience' : '1 patience'}`
          }
          workingLabel="On the phone…"
          doneLabel="Signed"
          onAction={submit}
        />
      </div>
    </div>
  );
}

function clampStep(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(v / 100_000) * 100_000));
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
