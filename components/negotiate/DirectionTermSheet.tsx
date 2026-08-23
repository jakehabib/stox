'use client';

import { useMemo } from 'react';
import {
  PERSONALITY_BLURB, PERSONALITY_LABEL, type DealStructure, type NegotiationSession,
} from '@/lib/negotiation';
import { formatMoney } from '@/lib/cap';
import { CapMode } from '@/lib/types';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { tip } from '@/lib/glossary';
import { PlayerAvatar } from '../PlayerAvatar';
import { TeamLogo } from '../TeamLogo';
import { ActionButton } from '../ds/ActionButton';
import { SigningConfirmation } from '../ds/SigningConfirmation';
import { DealStructureControls } from '../DealStructureControls';
import { Tooltip } from '../Tooltip';
import {
  INTEGER_FIELD, LeverageClock, MILLIONS_FIELD, NumberEntry, PatiencePips,
  PERCENT_FIELD, THRESHOLDS, VERDICT_STYLE,
} from './parts';
import { priceDeal } from './pricing';
import type { NegotiationFrame, NegotiationSubject } from './frame';
import type { NegotiationView } from './useNegotiation';

/**
 * ===========================================================================
 * DIRECTION B — THE TERM SHEET
 * ===========================================================================
 * The shipped panel is a stack of six controls with a ledger underneath it,
 * and the question the app owner asked is whether that reads as a contract
 * taking shape or as a control panel. This direction answers it by making the
 * thing being built the ONLY object on screen: a term sheet, with the deal
 * written out in sentences a GM would actually say, and the controls set into
 * those sentences at the words they change.
 *
 * Two consequences follow, and both are the point:
 *
 *   THE NUMBERS MULTIPLY OUT. "$14.0M a year for four years — $56.0M, of
 *   which $28.0M is guaranteed" cannot be read as anything but a contract,
 *   and if the arithmetic looked wrong it would be obvious in the sentence
 *   rather than buried across three sliders.
 *
 *   SCHEDULE A IS THE CAP CONSEQUENCE, and it is part of the document rather
 *   than a panel beside it. Every season, what he is paid, what last year's
 *   bonus is still charging you, and what that costs against the cap — the
 *   same table the cap sheet would show you next March, before you sign
 *   rather than after.
 *
 * The agent lives in the margin: his read, his notes and the meter as a gauge
 * running up the edge of the page, the way a reviewer marks up a draft. The
 * drag is still a drag — every clause carries the slider, unhidden, because
 * the slider is the minigame.
 * ===========================================================================
 */
export function DirectionTermSheet({ view, frame, subject, session, capMode, structure, onStructure, onCancel }: {
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
  const priced = useMemo(
    () => priceDeal(ctx, offer, structure, gate.capMode, decision),
    [ctx, offer, structure, gate.capMode, decision],
  );

  if (view.signedDeal && !view.hasMoment) {
    return <div className="panel p-5"><SigningConfirmation deal={view.signedDeal} answeredAt={view.answeredAt} onDismiss={() => {}} /></div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_19rem] gap-4 items-start">
      {/* ============================ THE SHEET ============================ */}
      <article
        className="rounded-lg border-2 bg-card shadow-elevated overflow-hidden"
        style={{ ['--team-accent' as never]: accent, borderColor: 'var(--team-accent)' }}
      >
        <header
          className="relative px-6 pt-5 pb-4 border-b-2 border-line"
          style={{ background: 'radial-gradient(ellipse 120% 150% at 100% 0%, color-mix(in srgb, var(--team-accent) 16%, transparent), transparent 70%)' }}
        >
          <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
            <TeamLogo seed={subject.team.id} abbr={subject.team.abbr} nickname={subject.team.nickname} size={180} className="watermark-logo opacity-[0.06] -right-10 -top-12" />
          </div>
          <div className="relative flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="label-sm">{subject.team.city} {subject.team.nickname}</div>
              <h1 className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none mt-1.5">
                Terms of a proposed contract
              </h1>
              <p className="text-sm text-muted mt-2">
                Between the club and <span className="text-chalk font-semibold">{subject.name}</span>,{' '}
                {subject.position}, age {subject.age} — for the {ctx.seasonYear} league year.
              </p>
            </div>
            {/* The state, stamped. One design, three states: the sheet is the
                same document either way and this is what tells them apart. */}
            <div className={`shrink-0 rounded-md border-2 px-3 py-2 text-center ${frame.openToOthers ? 'border-bad/60' : 'border-accent/50'}`}>
              <div className={`font-display font-bold uppercase tracking-widest text-sm ${frame.openToOthers ? 'text-bad' : 'text-accent'}`}>
                {frame.title}
              </div>
              <div className="text-[10px] text-muted mt-0.5">
                {frame.openToOthers ? 'anyone may sign him' : 'exclusive to this club'}
              </div>
            </div>
          </div>
        </header>

        <div className="px-6 py-5 space-y-5">
          <Clause n={1} title="Compensation">
            <p className="text-sm leading-relaxed">
              The club shall pay{' '}
              <NumberEntry label={frame.moneyLabel} field={MILLIONS_FIELD} value={offer.apy}
                min={gate.minSalary} max={gate.maxSalary} disabled={over} onCommit={view.setApy}
                className="mx-1 align-middle" />
              {' '}per year{appending ? ' on the years added below' : ''} — a total of{' '}
              <strong className="text-chalk">{formatMoney(appending ? decision.newMoneyValue : decision.totalValue)}</strong>
              {appending ? ' in new money' : ''}.
            </p>
            <input type="range" className="slider mt-3" min={gate.minSalary} max={gate.maxSalary} step={100_000}
              value={offer.apy} disabled={over} onChange={(e) => view.setApy(Number(e.target.value))} aria-label={frame.moneyLabel} />
            <ClauseNote>
              {frame.askLine}.{' '}
              {decision.blocked === 'CAP'
                ? <span className="text-bad">This is {formatMoney(decision.year1CapHit - gate.capSpace)} more than you have room for.</span>
                : 'What he will actually take is his own business, and he is not saying.'}
            </ClauseNote>
          </Clause>

          <Clause n={2} title={appending ? 'Term — years added' : 'Term'}>
            <p className="text-sm leading-relaxed">
              {appending ? 'The club shall add ' : 'This contract shall run '}
              <NumberEntry label={frame.termLabel} field={INTEGER_FIELD} value={offer.years}
                min={1} max={gate.maxYears} disabled={over || gate.maxYears <= 1} onCommit={view.setYears}
                className="mx-1 align-middle" />
              {' '}{offer.years === 1 ? 'year' : 'years'}
              {appending
                ? <> to the {ctx.controlYears === 1 ? 'season' : `${ctx.controlYears} seasons`} already owed, keeping their salaries — <strong className="text-chalk">{totalTerm} years</strong> in all, worth <strong className="text-chalk">{formatMoney(decision.totalValue)}</strong>.</>
                : <>, through the {ctx.seasonYear + totalTerm - 1} season, when he will be {subject.age + totalTerm}.</>}
            </p>
            <input type="range" className="slider mt-3" min={1} max={gate.maxYears} step={1}
              value={offer.years} disabled={over || gate.maxYears <= 1} onChange={(e) => view.setYears(Number(e.target.value))} aria-label={frame.termLabel} />
            {view.termCapped && (
              <ClauseNote bad={decision.blocked === 'WILLING'}>{view.willingLine}</ClauseNote>
            )}
          </Clause>

          <Clause n={3} title="Guarantees">
            <p className="text-sm leading-relaxed">
              <NumberEntry label="Guaranteed" field={PERCENT_FIELD} value={Math.round(offer.guaranteePct * 100)}
                min={0} max={100} disabled={over} onCommit={(v) => view.setGuaranteePct(v / 100)}
                className="mr-1 align-middle" />
              {' '}of it — <strong className="text-chalk">{formatMoney(decision.guaranteedMoney)}</strong> — is owed to him
              whether he is on the roster or not.
            </p>
            <input type="range" className="slider mt-3" min={0} max={100} step={5}
              value={Math.round(offer.guaranteePct * 100)} disabled={over}
              onChange={(e) => view.setGuaranteePct(Number(e.target.value) / 100)} aria-label="Guaranteed" />
            <ClauseNote bad={decision.evaluation.underGuaranteed}>
              {decision.evaluation.underGuaranteed
                ? 'A man of his standing does not sign for this little locked in. No salary fixes it — guarantee more of it.'
                : capOn
                  ? <>Release him after year one and <strong className="text-bad">{formatMoney(decision.deadMoneyIfCut)}</strong> stays on your cap for nothing.</>
                  : 'Money promised is money paid, whatever happens to him.'}
            </ClauseNote>
          </Clause>

          {capOn && (
            <Clause n={4} title="Structure">
              <DealStructureControls capMode={capMode} contractYears={totalTerm} structure={structure} onChange={onStructure} disabled={over} />
            </Clause>
          )}

          {/* ===================== SCHEDULE A ===================== */}
          {capOn && (
            <section>
              <div className="section-head">
                <span className="section-title">Schedule A — what it charges the cap</span>
                <span className="label-sm">{ctx.seasonYear}–{ctx.seasonYear + priced.years.length - 1}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="table-clean mt-1">
                  <thead>
                    <tr>
                      <th>Season</th>
                      {priced.trusted && <th className="text-right">Base salary</th>}
                      {priced.trusted && <th className="text-right">Bonus charged</th>}
                      <th className="text-right">Cap hit</th>
                      <th className="text-right">Room if signed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priced.years.map((y) => (
                      <tr key={y.index}>
                        <td className="font-mono">
                          {ctx.seasonYear + y.index - 1}
                          {y.owed && <span className="ml-2 pill border-line text-muted text-[10px]">already owed</span>}
                        </td>
                        {priced.trusted && <td className="text-right font-mono text-muted">{formatMoney(y.baseSalary)}</td>}
                        {priced.trusted && <td className="text-right font-mono text-muted">{formatMoney(y.bonus)}</td>}
                        <td className={`text-right font-mono ${y.index === 1 && decision.blocked === 'CAP' ? 'text-bad' : 'text-chalk'}`}>
                          {formatMoney(y.capHit)}
                        </td>
                        <td className="text-right font-mono">
                          {y.index === 1
                            ? <span className={view.spaceAfter < 0 ? 'text-bad' : 'text-accent'}>{formatMoney(view.spaceAfter)}</span>
                            : <span className="text-muted">—</span>}
                        </td>
                      </tr>
                    ))}
                    {decision.strandedVoidMoney > 0 && (
                      <tr>
                        <td className="text-warn">{ctx.seasonYear + priced.years.length} — after it ends</td>
                        {priced.trusted && <td className="text-right font-mono text-muted">—</td>}
                        {priced.trusted && <td className="text-right font-mono text-warn">{formatMoney(decision.strandedVoidMoney)}</td>}
                        <td className="text-right font-mono text-warn">{formatMoney(decision.strandedVoidMoney)}</td>
                        <td className="text-right font-mono text-muted">—</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted mt-2">
                Room is this season&apos;s: {formatMoney(subject.capSpaceNow ?? gate.capSpace)} today,{' '}
                {formatMoney(view.spaceAfter)} the moment he signs
                {appending && subject.currentCapHit ? ` — his current ${formatMoney(subject.currentCapHit)} charge comes off as this contract goes on` : ''}. Later seasons depend on who else is on the books by then.
                {decision.strandedVoidMoney > 0 && ' The last line is void-year money — dead the season after the deal ends, with no player attached to it.'}
                {!priced.trusted && ' The base/bonus split is withheld here — this sheet could not reproduce the priced contract exactly, and a split that might describe a different deal is worse than none.'}
              </p>
            </section>
          )}
        </div>

        {/* ===================== EXECUTION ===================== */}
        <footer className="border-t-2 border-line px-6 py-4 bg-ink/40 space-y-2.5">
          {view.result && (
            <p className={`text-sm ${view.result.ok ? 'text-accent' : view.result.lostTo ? 'text-bad' : 'text-accent2'}`}>{view.result.message}</p>
          )}
          {!view.result && decision.reason && (decision.blocked !== null || decision.signBand !== 'YES') && (
            <p className={`text-xs ${decision.blocked || decision.outbid ? 'text-bad' : 'text-muted'}`}>{decision.reason}</p>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[18rem]">
              <ActionButton
                className={`w-full ${decision.blocked ? 'btn-secondary' : decision.outbid ? 'btn-danger' : 'btn-primary'}`}
                disabled={!view.canSubmit}
                idleLabel={view.buttonLabel}
                workingLabel="On the phone…"
                doneLabel="Signed"
                onAction={view.submit}
              />
            </div>
            {!over && <button type="button" onClick={view.resetTerms} className="btn-secondary text-sm">Reset terms</button>}
            {onCancel && <button type="button" onClick={onCancel} className="btn-ghost text-sm">Leave the table</button>}
          </div>
          <p className="text-xs text-muted">
            Nothing on this page is agreed until it is sent. Sending it is what costs you: he remembers every
            offer he has turned down.
          </p>
        </footer>
      </article>

      {/* ============================ THE MARGIN ============================ */}
      <aside className="lg:sticky lg:top-4 space-y-3">
        <div className="panel px-4 py-3.5">
          <div className="flex items-start gap-3">
            <PlayerAvatar seed={subject.playerId} age={subject.age} size={46} teamColor={accent}
              weightLb={subject.weightLb} heightIn={subject.heightIn} position={subject.position} />
            <div className="min-w-0">
              <div className="label-sm">His agent</div>
              <div className="text-sm font-semibold">{PERSONALITY_LABEL[ctx.personality]}</div>
            </div>
          </div>
          <p className="text-xs text-muted mt-2.5">{PERSONALITY_BLURB[ctx.personality]}</p>
        </div>

        {/* THE GAUGE. Same rules as every other meter in the game — the "might
            sign" stretch is drawn, the rival sits on the same scale, and what
            the hidden draw did is never shown. Vertical because it lives in a
            margin, not because it means anything different. */}
        <div className="panel px-4 py-3.5">
          <div className="label-sm inline-flex items-center gap-1.5">
            His read on this
            <Tooltip align="start" text={tip('interestMeter')} />
          </div>
          <div className="flex gap-3 mt-2.5">
            <div className="relative w-7 h-40 rounded bg-ink/70 border border-line overflow-hidden shrink-0">
              {view.band && (
                <div className="absolute inset-x-0 z-[15] border-y border-accent2/70 bg-accent2/20"
                  style={{ bottom: `${view.band.lo}%`, height: `${view.band.hi - view.band.lo}%` }} />
              )}
              {THRESHOLDS.map((t) => (
                <div key={t} className="absolute inset-x-0 z-10 h-px bg-line" style={{ bottom: `${t}%` }} />
              ))}
              {view.rivalMark && (
                <div className="absolute inset-x-0 z-20 h-0.5 bg-chalk"
                  style={{ bottom: `${Math.max(0, Math.min(100, view.rivalMark.interest))}%` }} />
              )}
              <div className={`absolute inset-x-0 bottom-0 z-[5] ${style.bar}`}
                style={{ height: `${Math.max(2, view.talksDead ? 0 : decision.evaluation.interest)}%`, transition: 'height var(--dur-state) var(--ease-out)' }} />
            </div>
            <div className="min-w-0 flex-1">
              <div className={`stat-value text-stat-md ${style.text}`} data-testid="interest-value">
                {view.talksDead ? 0 : decision.evaluation.interest}
              </div>
              <div className={`label-sm ${style.text}`}>{style.label}</div>
              <p className={`text-xs mt-2 ${style.text}`}>{view.shownHeadline}</p>
              {view.rivalMark && (
                <p className="text-[11px] text-muted mt-2">
                  The white line is {view.rivalMark.label} at {view.rivalMark.interest} — the same scale, their whole package. Clear it and he is yours.
                </p>
              )}
            </div>
          </div>
          {decision.evaluation.demands.length > 0 && !over && (
            <ul className="space-y-1 mt-3 border-t border-line/60 pt-2.5">
              {decision.evaluation.demands.map((d) => (
                <li key={d} className="text-xs text-muted flex gap-2"><span className="text-warn shrink-0">▸</span>{d}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel px-4 py-3.5">
          <div className="label-sm mb-2">Where he stands</div>
          <LeverageClock frame={frame} session={session} />
        </div>

        <div className="panel px-4 py-3.5">
          <div className="label-sm inline-flex items-center gap-1.5">
            Patience
            <Tooltip align="start" text={tip('patience')} />
          </div>
          <div className="mt-2"><PatiencePips patience={ctx.patience} spent={view.patienceSpent} /></div>
          <p className="text-[11px] text-muted mt-2">
            {ctx.patience - view.patienceSpent === 0
              ? 'He has stopped taking your calls.'
              : `${ctx.patience - view.patienceSpent} more refusals and he stops taking your calls this year.`}
          </p>
          {view.history.length > 0 && (
            <div className="mt-2.5 border-t border-line/60 pt-2 space-y-0.5">
              {view.history.map((h, i) => (
                <div key={i} className="text-[11px] font-mono text-muted">
                  {formatMoney(h.apy)}/yr × {h.years}yr — {h.outcome}
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Clause({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="border-l-2 border-line pl-4">
      <div className="flex items-baseline gap-2">
        <span className="stat-value text-sm text-muted">{n}.</span>
        <span className="section-title">{title}</span>
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ClauseNote({ children, bad }: { children: React.ReactNode; bad?: boolean }) {
  return <p className={`text-xs mt-2.5 ${bad ? 'text-bad' : 'text-muted'}`}>{children}</p>;
}
