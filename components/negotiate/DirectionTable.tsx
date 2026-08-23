'use client';

import { PERSONALITY_BLURB, PERSONALITY_LABEL, type DealStructure, type NegotiationSession } from '@/lib/negotiation';
import { formatMoney } from '@/lib/cap';
import { CapMode } from '@/lib/types';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { tip } from '@/lib/glossary';
import { PlayerAvatar } from '../PlayerAvatar';
import { TeamLogo } from '../TeamLogo';
import { RatingBadge } from '../ds/RatingBadge';
import { SuitorRumour } from '../ds/SuitorRumour';
import { ActionButton } from '../ds/ActionButton';
import { SigningConfirmation } from '../ds/SigningConfirmation';
import { DealStructureControls } from '../DealStructureControls';
import { Tooltip } from '../Tooltip';
import {
  CapWall, DealTerm, INTEGER_FIELD, LeverageClock, MeterTrack, MILLIONS_FIELD,
  PatiencePips, PERCENT_FIELD, RoomLine, THRESHOLDS, VERDICT_STYLE,
} from './parts';
import type { NegotiationFrame, NegotiationSubject } from './frame';
import type { NegotiationView } from './useNegotiation';

/**
 * ===========================================================================
 * DIRECTION A — THE TABLE
 * ===========================================================================
 * Two people and a contract between them, laid out as exactly that: HIS SIDE
 * on the left, THE DEAL down the middle, YOUR BOOKS on the right, and one
 * commit bar under all three.
 *
 * The argument is that a negotiation has two parties and the shipped panel
 * only draws one column, so everything queues up in a single scroll: the
 * meter at the top, the sliders in the middle, the cap ledger at the bottom,
 * and a GM dragging salary watches the meter while the number that decides
 * whether he can afford it sits off screen. Here the drag is in the middle
 * and both of the things it changes — what he thinks, what it costs — are
 * beside it at the same eye level.
 *
 * WHAT IS DELIBERATELY NOT DIFFERENT: the meter is still a bar, the controls
 * are still sliders you drag, and the panel still opens on a number he would
 * refuse. The slider drag IS the minigame — a playtest said so and the header
 * of the live panel says so — so nothing here streamlines it into a stepper
 * or hides it behind a summary.
 * ===========================================================================
 */
export function DirectionTable({ view, frame, subject, session, capMode, structure, onStructure, onCancel }: {
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
    return (
      <div className="panel p-5">
        {/* Only reachable off the league layout, where there is no
            SigningMomentProvider to raise the card into. There is nothing to
            do on dismissal here: this route has no list to collapse. */}
        <SigningConfirmation deal={view.signedDeal} answeredAt={view.answeredAt} onDismiss={() => {}} />
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border-2 overflow-hidden shadow-elevated bg-card"
      style={{ ['--team-accent' as never]: accent, borderColor: 'var(--team-accent)' }}
    >
      {/* The band. Who is at the table, which table it is, and how much of his
          patience is left — the three things that never stop being true. */}
      <div
        className="relative flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 border-b border-line/60"
        style={{ background: 'radial-gradient(ellipse 110% 160% at 0% 50%, color-mix(in srgb, var(--team-accent) 20%, transparent), transparent 70%)' }}
      >
        <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'repeating-linear-gradient(115deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 14px)', color: accent }} />
        </div>
        <div className="relative flex items-center gap-3 min-w-0">
          <TeamLogo seed={subject.team.id} abbr={subject.team.abbr} nickname={subject.team.nickname} size={38} />
          <div className="min-w-0">
            <div className="label-sm">{subject.team.city} {subject.team.nickname} · Contract talks</div>
            <h1 className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none mt-1 text-team">
              {frame.title}
            </h1>
          </div>
        </div>
        <div className="relative text-right">
          <div className="label-sm inline-flex items-center gap-1.5 justify-end">
            Patience
            <Tooltip placement="bottom" align="end" text={tip('patience')} />
          </div>
          <div className="mt-1.5"><PatiencePips patience={ctx.patience} spent={view.patienceSpent} align="end" /></div>
          <div className="text-[11px] text-muted mt-1.5">
            {ctx.patience - view.patienceSpent === 0
              ? 'his agent has stopped taking calls'
              : `${ctx.patience - view.patienceSpent} refusals left before he stops taking calls`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[20rem_minmax(0,1fr)_21rem]">
        {/* ================= HIS SIDE ================= */}
        <aside className="px-5 py-4 space-y-4 border-b xl:border-b-0 xl:border-r border-line/60 bg-ink/25">
          <div className="flex items-center gap-3">
            <PlayerAvatar
              seed={subject.playerId} age={subject.age} size={64} teamColor={accent}
              weightLb={subject.weightLb} heightIn={subject.heightIn} position={subject.position}
            />
            <div className="min-w-0 flex-1">
              <div className="font-display font-bold text-lg leading-tight truncate">{subject.name}</div>
              <div className="text-xs text-muted mt-0.5">{subject.position} · age {subject.age}</div>
              <div className="text-xs text-muted mt-1">{frame.askLine}</div>
            </div>
            <RatingBadge value={subject.ovr} size="sm" />
          </div>

          <div className="rounded-md border border-line/70 bg-ink/40 px-3 py-2.5">
            <div className="label-sm">His agent</div>
            <div className="text-sm font-semibold mt-0.5">{PERSONALITY_LABEL[ctx.personality]}</div>
            <p className="text-xs text-muted mt-1">{PERSONALITY_BLURB[ctx.personality]}</p>
          </div>

          <div>
            <div className="label-sm mb-2">Where he stands</div>
            <LeverageClock frame={frame} session={session} />
          </div>

          <SuitorRumour session={session} />

          {view.decision.evaluation.demands.length > 0 && !over && (
            <div>
              <div className="label-sm mb-1.5">What they are saying</div>
              <ul className="space-y-1">
                {view.decision.evaluation.demands.map((d) => (
                  <li key={d} className="text-xs text-muted flex gap-2">
                    <span className="text-warn shrink-0">▸</span>{d}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {view.history.length > 0 && (
            <div className="border-t border-line/50 pt-3">
              <div className="label-sm">Offers made</div>
              <div className="mt-1 space-y-0.5">
                {view.history.map((h, i) => (
                  <div key={i} className="text-[11px] font-mono text-muted">
                    {formatMoney(h.apy)}/yr × {h.years}yr — {h.outcome}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* ================= THE DEAL ================= */}
        <section className="px-5 py-4 space-y-4 min-w-0">
          {/* THE METER, at the top of the column the sliders are in, so the
              thing that answers the drag is never off the axis of the drag. */}
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="label-sm inline-flex items-center gap-1.5">
                His interest
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
          </div>

          {/* THE DEAL AS A DEAL. One sentence a GM would actually say out
              loud, before any control. On a deal that appends it says both
              numbers under their own names, because quoting either as the
              other is the easiest lying metric in this flow. */}
          <div className="rounded-md border border-line bg-ink/50 px-4 py-3">
            <div className="label-sm">On the table</div>
            <div className="flex items-baseline gap-3 flex-wrap mt-1">
              <span className="stat-value text-stat-lg">
                {appending ? `+${offer.years}` : offer.years} yr{offer.years === 1 ? '' : 's'}
              </span>
              <span className="stat-value text-stat-lg text-team">
                {formatMoney(appending ? decision.newMoneyValue : decision.totalValue)}
              </span>
              <span className="text-sm text-muted">
                {formatMoney(offer.apy)}/yr · {formatMoney(decision.guaranteedMoney)} guaranteed
              </span>
            </div>
            <p className="text-xs text-muted mt-1.5">
              {appending
                ? `${offer.years} new year${offer.years === 1 ? '' : 's'} on top of the ${ctx.controlYears === 1 ? 'season' : `${ctx.controlYears} seasons`} he is already owed — ${totalTerm} years and ${formatMoney(decision.totalValue)} in all.`
                : `A ${totalTerm}-year contract worth ${formatMoney(decision.totalValue)}.`}
            </p>
          </div>

          <DealTerm
            label={frame.moneyLabel}
            tipText={appending ? tip('newMoney') : tip('apy')}
            value={`${formatMoney(offer.apy)}/yr`}
            buys={appending
              ? `${formatMoney(decision.newMoneyValue)} of new money`
              : `${formatMoney(decision.totalValue)} over ${totalTerm} year${totalTerm === 1 ? '' : 's'}`}
            warn={decision.blocked === 'CAP' ? `Over your room by ${formatMoney(decision.year1CapHit - gate.capSpace)}` : undefined}
            min={gate.minSalary} max={gate.maxSalary} step={100_000}
            raw={offer.apy} onChange={view.setApy} disabled={over} field={MILLIONS_FIELD}
          />

          {view.beat && !over && (
            <div className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2.5 space-y-1.5">
              <div className="label-sm text-[10px] text-bad">
                {gate.rival ? `Beating ${gate.rival.teamName}` : 'Beating their offer'} — any one of these closes it
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {view.beat.apy !== null && (
                  <button type="button" onClick={() => view.setApy(view.beat!.apy!)}
                    className={`pill hover:bg-bad/10 ${view.beat.cheapest === 'APY' ? 'border-bad text-bad' : 'border-line text-muted'}`}>
                    Salary → {formatMoney(view.beat.apy)}/yr
                  </button>
                )}
                {view.beat.guaranteePct !== null && (
                  <button type="button" onClick={() => view.setGuaranteePct(view.beat!.guaranteePct!)}
                    className={`pill hover:bg-bad/10 ${view.beat.cheapest === 'GUARANTEE' ? 'border-bad text-bad' : 'border-line text-muted'}`}>
                    Guarantee → {Math.round(view.beat.guaranteePct * 100)}%
                  </button>
                )}
                {view.beat.years !== null && (
                  <button type="button" onClick={() => view.setYears(view.beat!.years!)}
                    className={`pill hover:bg-bad/10 ${view.beat.cheapest === 'YEARS' ? 'border-bad text-bad' : 'border-line text-muted'}`}>
                    Term → {view.beat.years} year{view.beat.years === 1 ? '' : 's'}
                  </button>
                )}
              </div>
              {view.beat.apy === null && view.beat.guaranteePct === null && view.beat.years === null ? (
                <p className="text-[11px] text-muted">Nothing you can move on its own gets there. It will take more than one of them together.</p>
              ) : view.beat.cheapest === 'GUARANTEE' ? (
                <p className="text-[11px] text-muted">
                  Guaranteeing more commits no extra cash — it becomes signing bonus, which prorates, so it is dead
                  money if you ever cut him. Cheapest today, not free later.
                </p>
              ) : null}
            </div>
          )}

          <DealTerm
            label={frame.termLabel}
            value={appending ? `+${offer.years} → ${totalTerm} yrs` : `${offer.years} year${offer.years === 1 ? '' : 's'}`}
            buys={appending
              ? `${totalTerm} years under contract in all`
              : `he is ${subject.age + offer.years} in the last year of it`}
            warn={decision.blocked === 'WILLING' ? `He will not sign for ${offer.years}` : undefined}
            min={1} max={gate.maxYears} step={1}
            raw={offer.years} onChange={view.setYears} disabled={over || gate.maxYears <= 1} field={INTEGER_FIELD}
          >
            {view.termCapped && (
              <p className={`text-xs mt-2 ${decision.blocked === 'WILLING' ? 'text-bad' : 'text-muted'}`}>{view.willingLine}</p>
            )}
          </DealTerm>

          <DealTerm
            label="Guaranteed"
            tipText={tip('guaranteedMoney')}
            value={`${Math.round(offer.guaranteePct * 100)}%`}
            buys={`${formatMoney(decision.guaranteedMoney)} he is owed whatever happens`}
            warn={capOn && decision.deadMoneyIfCut > 0 ? `${formatMoney(decision.deadMoneyIfCut)} dead if you cut him` : undefined}
            min={0} max={100} step={5}
            raw={Math.round(offer.guaranteePct * 100)}
            onChange={(v) => view.setGuaranteePct(v / 100)}
            disabled={over} field={PERCENT_FIELD}
          >
            {ctx.guaranteeFloor > 0 && !over && (
              <p className={`text-xs mt-2 inline-flex items-start gap-1.5 ${decision.evaluation.underGuaranteed ? 'text-bad' : 'text-muted'}`}>
                <Tooltip className="mt-0.5" align="start" text={tip('guaranteeFloor')} />
                {decision.evaluation.underGuaranteed
                  ? 'A man of his standing does not sign for this little locked in. No salary fixes it — guarantee more of it.'
                  : 'A player of his standing expects a real share of it guaranteed, and this clears that.'}
              </p>
            )}
          </DealTerm>

          <DealStructureControls capMode={capMode} contractYears={totalTerm} structure={structure} onChange={onStructure} disabled={over} />
        </section>

        {/* ================= YOUR BOOKS ================= */}
        <aside className="px-5 py-4 space-y-4 border-t xl:border-t-0 xl:border-l border-line/60 bg-ink/25">
          <div className="label-sm">What it costs you</div>

          {capOn ? (
            <>
              <div>
                <div className="label-sm">This season&apos;s cap hit</div>
                <div className={`stat-value text-stat-lg mt-1 ${decision.blocked === 'CAP' ? 'text-bad' : ''}`}>
                  {formatMoney(decision.year1CapHit)}
                </div>
              </div>

              {/* The club's real room, not the gate's — see NegotiationSubject. */}
              <RoomLine capSpace={subject.capSpaceNow ?? gate.capSpace} spaceAfter={view.spaceAfter} blocked={decision.blocked === 'CAP'} />
              {appending && subject.currentCapHit ? (
                <p className="text-[11px] text-muted -mt-2">
                  His current deal is already charging {formatMoney(subject.currentCapHit)} of that this season; the
                  figure on the right is what is left once this one replaces it.
                </p>
              ) : null}

              <div>
                <div className="label-sm mb-2">And after that</div>
                <CapWall
                  decision={decision}
                  controlYears={ctx.controlYears}
                  appending={appending}
                  headroomHint
                />
              </div>

              <div className="border-t border-line/60 pt-3 space-y-1.5 text-sm">
                <Row label="Total value" value={formatMoney(decision.totalValue)} />
                {appending && <Row label="Of that, new money" value={formatMoney(decision.newMoneyValue)} />}
                <Row label="Guaranteed" value={formatMoney(decision.guaranteedMoney)} />
                <Row
                  label="Dead money if you cut him"
                  tipText={tip('deadMoney')}
                  value={formatMoney(decision.deadMoneyIfCut)}
                  bad={decision.deadMoneyIfCut > gate.capSpace}
                />
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">
              The cap is off in this league. What he signs for is what he is paid, and nothing here charges a
              season you have not reached.
            </p>
          )}
        </aside>
      </div>

      {/* ================= THE COMMIT BAR ================= */}
      <div className="border-t border-line/60 bg-ink/50 px-5 py-3.5 space-y-2.5">
        {view.result && (
          <p className={`text-sm ${view.result.ok ? 'text-accent' : view.result.lostTo ? 'text-bad' : 'text-accent2'}`}>{view.result.message}</p>
        )}
        {!view.result && decision.reason && (decision.blocked !== null || decision.signBand !== 'YES') && (
          <p className={`text-xs ${decision.blocked || decision.outbid ? 'text-bad' : 'text-muted'}`}>{decision.reason}</p>
        )}
        {view.walkedAway && !view.signed && !view.gone && (
          <p className="text-sm text-bad">
            His agent has stopped returning calls. {ctx.incumbent ? 'He will test the market.' : 'He is signing somewhere else.'}
          </p>
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
          {!over && (
            <button type="button" onClick={view.resetTerms} className="btn-secondary text-sm">Reset terms</button>
          )}
          {onCancel && <button type="button" onClick={onCancel} className="btn-ghost text-sm">Leave the table</button>}
        </div>
        <p className="text-xs text-muted">
          Dragging is free. Putting an offer in front of him is not: he remembers every one he turns down, and
          leaving the table gives none of it back.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, tipText, bad }: { label: string; value: string; tipText?: string; bad?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted inline-flex items-center gap-1.5 text-xs">
        {label}
        {tipText && <Tooltip align="start" text={tipText} />}
      </span>
      <span className={`font-mono ${bad ? 'text-bad' : ''}`}>{value}</span>
    </div>
  );
}
