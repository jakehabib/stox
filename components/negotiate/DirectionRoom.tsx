'use client';

import {
  PERSONALITY_BLURB, PERSONALITY_LABEL, type DealStructure, type NegotiationSession,
} from '@/lib/negotiation';
import { formatMoney } from '@/lib/cap';
import { CapMode } from '@/lib/types';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { tip } from '@/lib/glossary';
import { PlayerAvatar } from '../PlayerAvatar';
import { TeamLogo } from '../TeamLogo';
import { RatingBadge } from '../ds/RatingBadge';
import { ActionButton } from '../ds/ActionButton';
import { SigningConfirmation } from '../ds/SigningConfirmation';
import { DealStructureControls } from '../DealStructureControls';
import { Tooltip } from '../Tooltip';
import {
  INTEGER_FIELD, LeverageClock, MeterTrack, MILLIONS_FIELD, NumberEntry,
  PatiencePips, PERCENT_FIELD, THRESHOLDS, VERDICT_STYLE,
} from './parts';
import type { NegotiationFrame, NegotiationSubject } from './frame';
import type { NegotiationView } from './useNegotiation';

/**
 * ===========================================================================
 * DIRECTION C — THE ROOM
 * ===========================================================================
 * The negotiation is a series of calls, and this direction is the only one
 * that draws it that way. The shipped panel keeps a record of what you have
 * offered — four lines of grey monospace under the ledger, easy to miss and
 * impossible to read a negotiation out of. Here that record IS the screen: his
 * agent opens, you make an offer, he answers, and the whole exchange stacks up
 * so a GM can see what he has already tried and what it cost him.
 *
 * That reframes patience. In the other two directions it is a row of pips in a
 * corner; here every spent pip has a line of dialogue attached to it, which is
 * what makes the resource feel like a resource rather than a counter.
 *
 * The live offer sits at the bottom, where the next thing you say goes. It
 * carries three compact controls, the meter directly above the button that
 * commits it — you can watch the answer move while your thumb is on the
 * control — and the cost to your cap stated on the same line, permanently,
 * because you should never be one press from a contract without seeing what it
 * does to your books.
 *
 * The narrowest of the three by design: one column, one job, and it is the
 * only one of the three that would work unchanged on a phone.
 * ===========================================================================
 */
export function DirectionRoom({ view, frame, subject, session, capMode, structure, onStructure, onCancel }: {
  view: NegotiationView;
  frame: NegotiationFrame;
  subject: NegotiationSubject;
  session: NegotiationSession;
  capMode: CapMode;
  structure: DealStructure;
  onStructure: (s: DealStructure) => void;
  onCancel?: () => void;
}) {
  const { ctx, gate } = session;
  const { offer, decision, appending, totalTerm, capOn, over } = view;
  const style = VERDICT_STYLE[view.shownVerdict];
  const accent = generateTeamLogoParams(subject.team.abbr).primary;

  if (view.signedDeal && !view.hasMoment) {
    return <div className="panel p-5"><SigningConfirmation deal={view.signedDeal} answeredAt={view.answeredAt} onDismiss={() => {}} /></div>;
  }

  return (
    <div
      className="max-w-3xl mx-auto rounded-lg border-2 bg-card shadow-elevated overflow-hidden"
      style={{ ['--team-accent' as never]: accent, borderColor: 'var(--team-accent)' }}
    >
      {/* ============================ THE LINE ============================ */}
      <header
        className="relative flex items-center gap-3 px-5 py-3.5 border-b border-line/60"
        style={{ background: 'radial-gradient(ellipse 110% 160% at 0% 50%, color-mix(in srgb, var(--team-accent) 18%, transparent), transparent 70%)' }}
      >
        <PlayerAvatar seed={subject.playerId} age={subject.age} size={52} teamColor={accent}
          weightLb={subject.weightLb} heightIn={subject.heightIn} position={subject.position} />
        <div className="min-w-0 flex-1">
          <div className="label-sm">{frame.title} · {subject.team.abbr}</div>
          <div className="font-display font-bold text-xl leading-tight truncate">{subject.name}</div>
          <div className="text-xs text-muted">{subject.position} · age {subject.age} · {frame.askLine}</div>
        </div>
        <RatingBadge value={subject.ovr} size="sm" />
        <TeamLogo seed={subject.team.id} abbr={subject.team.abbr} nickname={subject.team.nickname} size={34} className="shrink-0" />
      </header>

      {/* ============================ THE CALL LOG ============================ */}
      <div className="px-5 py-4 space-y-3">
        {/* HIS AGENT OPENS. Everything in here is on the session — his read of
            himself, what he is after, and who else is in the picture. */}
        <Turn side="them" who={`${PERSONALITY_LABEL[ctx.personality]} · his agent`}>
          <p>{PERSONALITY_BLURB[ctx.personality]}</p>
          <p className="mt-2">
            He is after {ctx.desiredYears === 1 ? 'a one-year deal' : `about ${ctx.desiredYears} years`}, and{' '}
            {frame.askLine.charAt(0).toLowerCase() + frame.askLine.slice(1)}.
          </p>
          <p className="mt-2 text-muted">{frame.exclusivity}</p>
          {ctx.incumbent && (
            <p className="mt-2 text-muted">
              <span className="text-chalk">{frame.discount}</span>{frame.discountClock ? ` ${frame.discountClock}` : ''}
            </p>
          )}
          <div className="mt-3"><LeverageClock frame={frame} session={session} compact /></div>
        </Turn>

        {view.history.map((h, i) => (
          <div key={i} className="space-y-2">
            <Turn side="you" who={`Your offer${view.history.length > 1 ? ` — ${ordinal(i + 1)}` : ''}`}>
              <p className="font-mono text-sm">
                {formatMoney(h.apy)}/yr × {h.years} {h.years === 1 ? 'year' : 'years'} · {Math.round(h.guaranteePct * 100)}% guaranteed
              </p>
            </Turn>
            <Turn side="them" who="They came back">
              <p>{h.message}</p>
            </Turn>
          </div>
        ))}

        {view.result && !view.history.some((h) => h.message === view.result?.message) && (
          <Turn side="them" who="They came back">
            <p className={view.result.ok ? 'text-accent' : 'text-bad'}>{view.result.message}</p>
          </Turn>
        )}

        {!over && decision.evaluation.demands.length > 0 && (
          <Turn side="them" who="What they want changed" quiet>
            <ul className="space-y-1">
              {decision.evaluation.demands.map((d) => (
                <li key={d} className="flex gap-2"><span className="text-warn shrink-0">▸</span>{d}</li>
              ))}
            </ul>
          </Turn>
        )}
      </div>

      {/* ============================ WHAT YOU SAY NEXT ============================ */}
      <div className="border-t border-line bg-ink/50 px-5 py-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="label-sm">On the table now</div>
          <div className="flex items-center gap-2">
            <span className="label-sm">Patience</span>
            <PatiencePips patience={ctx.patience} spent={view.patienceSpent} />
            <Tooltip placement="bottom" align="end" text={tip('patience')} />
          </div>
        </div>

        {/* THE DEAL, in one line, as it would be reported. */}
        <div className="flex items-baseline gap-2.5 flex-wrap">
          <span className="stat-value text-stat-md">
            {appending ? `+${offer.years}` : offer.years} {offer.years === 1 ? 'yr' : 'yrs'}
          </span>
          <span className="stat-value text-stat-md text-team">
            {formatMoney(appending ? decision.newMoneyValue : decision.totalValue)}
          </span>
          <span className="text-sm text-muted">
            {formatMoney(offer.apy)}/yr · {formatMoney(decision.guaranteedMoney)} guaranteed
            {appending ? ` · ${totalTerm} years under contract in all` : ''}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Dial label={frame.moneyLabel} display={`${formatMoney(offer.apy)}/yr`}
            min={gate.minSalary} max={gate.maxSalary} step={100_000} value={offer.apy}
            onChange={view.setApy} disabled={over}
            entry={<NumberEntry label={frame.moneyLabel} field={MILLIONS_FIELD} value={offer.apy}
              min={gate.minSalary} max={gate.maxSalary} disabled={over} onCommit={view.setApy} />}
            warn={decision.blocked === 'CAP' ? `${formatMoney(decision.year1CapHit - gate.capSpace)} over your room` : undefined} />
          <Dial label={frame.termLabel} display={appending ? `+${offer.years} → ${totalTerm}` : `${offer.years} ${offer.years === 1 ? 'year' : 'years'}`}
            min={1} max={gate.maxYears} step={1} value={offer.years}
            onChange={view.setYears} disabled={over || gate.maxYears <= 1}
            entry={<NumberEntry label={frame.termLabel} field={INTEGER_FIELD} value={offer.years}
              min={1} max={gate.maxYears} disabled={over || gate.maxYears <= 1} onCommit={view.setYears} />}
            warn={decision.blocked === 'WILLING' ? view.willingLine : undefined} />
          <Dial label="Guaranteed" display={`${Math.round(offer.guaranteePct * 100)}%`}
            min={0} max={100} step={5} value={Math.round(offer.guaranteePct * 100)}
            onChange={(v) => view.setGuaranteePct(v / 100)} disabled={over}
            entry={<NumberEntry label="Guaranteed" field={PERCENT_FIELD} value={Math.round(offer.guaranteePct * 100)}
              min={0} max={100} disabled={over} onCommit={(v) => view.setGuaranteePct(v / 100)} />}
            warn={decision.evaluation.underGuaranteed ? 'Under what he will sign for — no salary fixes it' : undefined} />
        </div>

        {view.beat && !over && (
          <div className="flex gap-1.5 flex-wrap items-center">
            <span className="label-sm text-[10px] text-bad">
              {gate.rival ? `Beats ${gate.rival.teamName}` : 'Beats their offer'}:
            </span>
            {view.beat.apy !== null && (
              <button type="button" onClick={() => view.setApy(view.beat!.apy!)}
                className={`pill ${view.beat.cheapest === 'APY' ? 'border-bad text-bad' : 'border-line text-muted'}`}>
                Salary → {formatMoney(view.beat.apy)}/yr
              </button>
            )}
            {view.beat.guaranteePct !== null && (
              <button type="button" onClick={() => view.setGuaranteePct(view.beat!.guaranteePct!)}
                className={`pill ${view.beat.cheapest === 'GUARANTEE' ? 'border-bad text-bad' : 'border-line text-muted'}`}>
                Guarantee → {Math.round(view.beat.guaranteePct * 100)}%
              </button>
            )}
            {view.beat.years !== null && (
              <button type="button" onClick={() => view.setYears(view.beat!.years!)}
                className={`pill ${view.beat.cheapest === 'YEARS' ? 'border-bad text-bad' : 'border-line text-muted'}`}>
                Term → {view.beat.years} yrs
              </button>
            )}
          </div>
        )}

        <details className="rounded-md border border-line/70 bg-ink/40 px-3 py-2">
          <summary className="text-xs cursor-pointer select-none text-muted">
            Deal shape — front-load, back-load, void years. Your books, not his decision.
          </summary>
          <div className="pt-3">
            <DealStructureControls capMode={capMode} contractYears={totalTerm} structure={structure} onChange={onStructure} disabled={over} />
          </div>
        </details>

        {/* WHAT IT COSTS, ON THE SAME SCREEN AS THE BUTTON. Never behind a
            disclosure: no GM should be one press from a contract without the
            cap number in front of him. */}
        {capOn && (
          <div className="grid grid-cols-3 gap-2">
            <Cost label="This season" value={formatMoney(decision.year1CapHit)} bad={decision.blocked === 'CAP'} />
            <Cost label="Room after" value={formatMoney(view.spaceAfter)} bad={view.spaceAfter < 0}
              detail={`from ${formatMoney(subject.capSpaceNow ?? gate.capSpace)}`} />
            <Cost label="Dead if cut" value={formatMoney(decision.deadMoneyIfCut)}
              detail={decision.strandedVoidMoney > 0 ? `+ ${formatMoney(decision.strandedVoidMoney)} void` : `over ${totalTerm} yr${totalTerm === 1 ? '' : 's'}`} />
          </div>
        )}

        {/* THE METER, immediately above the button it describes. */}
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="label-sm inline-flex items-center gap-1.5">
              How it is landing
              <Tooltip align="start" text={tip('interestMeter')} />
            </span>
            <span className={`label-sm ${style.text}`}>
              {style.label} · <span className="stat-value text-stat-sm align-baseline" data-testid="interest-value">{view.talksDead ? 0 : decision.evaluation.interest}</span>
            </span>
          </div>
          <div className="mt-1.5">
            <MeterTrack
              interest={view.talksDead ? 0 : decision.evaluation.interest}
              verdict={view.shownVerdict}
              band={view.band}
              rival={view.rivalMark}
              height="h-2.5"
            />
          </div>
          <div className="relative h-3 mt-1">
            {THRESHOLDS.map((t, i) => (
              <span key={t} className="absolute text-[10px] text-muted/70 -translate-x-1/2" style={{ left: `${t}%` }}>
                {['considering', 'close', 'signs'][i]}
              </span>
            ))}
          </div>
          <p className={`text-sm mt-2 ${style.text}`}>{view.shownHeadline}</p>
          {!view.result && decision.reason && (decision.blocked !== null || decision.signBand !== 'YES') && (
            <p className={`text-xs mt-1 ${decision.blocked || decision.outbid ? 'text-bad' : 'text-muted'}`}>{decision.reason}</p>
          )}
        </div>

        <ActionButton
          className={`w-full ${decision.blocked ? 'btn-secondary' : decision.outbid ? 'btn-danger' : 'btn-primary'}`}
          disabled={!view.canSubmit}
          idleLabel={view.buttonLabel}
          workingLabel="On the phone…"
          doneLabel="Signed"
          onAction={view.submit}
        />
        <div className="flex items-center gap-3 flex-wrap">
          {!over && <button type="button" onClick={view.resetTerms} className="btn-ghost text-sm">Reset terms</button>}
          {onCancel && <button type="button" onClick={onCancel} className="btn-ghost text-sm">Leave the table</button>}
          <p className="text-xs text-muted flex-1 min-w-[14rem]">
            Moving these costs nothing. Making the call costs a pip if he says no — and hanging up gives none of
            them back.
          </p>
        </div>
      </div>
    </div>
  );
}

function Turn({ side, who, children, quiet }: {
  side: 'you' | 'them'; who: string; children: React.ReactNode; quiet?: boolean;
}) {
  const mine = side === 'you';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-lg border px-3.5 py-2.5 ${
        mine ? 'border-accent2/40 bg-accent2/10' : quiet ? 'border-line/60 bg-ink/30' : 'border-line bg-raised/50'
      }`}>
        <div className="label-sm text-[10px] mb-1">{who}</div>
        <div className="text-sm text-chalk/90 leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function Dial({ label, display, min, max, step, value, onChange, disabled, entry, warn }: {
  label: string; display: string; min: number; max: number; step: number; value: number;
  onChange: (v: number) => void; disabled?: boolean; entry: React.ReactNode; warn?: string;
}) {
  return (
    <div className="rounded-md border border-line/70 bg-ink/40 px-3 py-2">
      <div className="label-sm text-[10px]">{label}</div>
      <div className="stat-value text-stat-sm mt-1">{display}</div>
      <input type="range" className="slider mt-2" min={min} max={max} step={step} value={value}
        disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <div className="mt-2">{entry}</div>
      {warn && <div className="text-[11px] text-bad mt-1.5">{warn}</div>}
    </div>
  );
}

function Cost({ label, value, detail, bad }: { label: string; value: string; detail?: string; bad?: boolean }) {
  return (
    <div className="rounded-md border border-line/70 bg-ink/40 px-3 py-2">
      <div className="label-sm text-[10px]">{label}</div>
      <div className={`stat-value text-stat-sm mt-1 ${bad ? 'text-bad' : ''}`}>{value}</div>
      {detail && <div className="text-[10px] text-muted mt-1">{detail}</div>}
    </div>
  );
}

function ordinal(n: number): string {
  const names = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
  return names[n - 1] ?? `${n}th`;
}
