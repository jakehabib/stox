'use client';

import type { ReactNode } from 'react';
import { TeamLogo } from '../TeamLogo';
import { Tooltip } from '../Tooltip';
import { tip } from '@/lib/glossary';
import { formatMoney } from '@/lib/cap';

export interface TradeVerdictResult {
  accepted: boolean;
  /** The GM's own words, straight from evaluateTrade — never re-worded here. */
  message: string;
  ratio: number;
  requiredRatio: number;
  explanation?: { give: string[]; receive: string[] };
  /** Set when the club's own cap sheet cannot take the deal on, whatever the value. */
  capBlock?: { shortfall: number; added: number; available: number };
}

export interface TradeIntelNumbers {
  unlocked: boolean;
  theirValue: number;
  yourValue: number;
  shortfall: number;
}

/**
 * The AI accepts once (value you're offering) / (value it gives up) clears
 * `requiredRatio`. Normalizing to that threshold ("100" = exactly clears the
 * bar the AI actually applies) is what makes this readable — the raw value
 * points are meaningless to a player with nothing to compare them against,
 * and they stay behind the Trade Intel upgrade in any case.
 */
export function AcceptanceMeter({ ratio, requiredRatio, accepted }: { ratio: number; requiredRatio: number; accepted: boolean }) {
  const pct = Number.isFinite(ratio) ? (ratio / requiredRatio) * 100 : 150;
  const fillPct = Math.max(2, Math.min(150, pct));
  const barColor = accepted ? 'bg-accent' : pct >= 80 ? 'bg-warn' : 'bg-bad';
  const thresholdLeft = (100 / 150) * 100; // requiredRatio always sits at the 100-of-150 mark on this scale

  /*
   * PAST THEIR LINE IS NOT MORE GOOD. IT IS YOUR MONEY.
   *
   * This meter answers "will they say yes", and the ratio behind it is THEIRS:
   * what the club receives over what it gives up. They say yes at their line.
   * Every point past it is value you handed over that you did not have to.
   *
   * Drawn as one filling green bar, that read as a score — the fuller the
   * better — and the app owner played it that way, then found his trade
   * retrospectives (which price both sides on a NEUTRAL market, with none of
   * the buyer's need premium) telling him he had been fleeced on deals whose
   * meter was well past full. Both numbers were right. The bar was the thing
   * that lied, by using the visual language of a score for a measure of the
   * other side's profit.
   *
   * So the overshoot is drawn as its own segment in a different colour and
   * named. The deal is still fine — it is accepted, and sometimes you WANT to
   * overpay for a man you need — but the screen now says which part of the bar
   * is you being generous.
   */
  const OVERPAY_FROM = 108; // a few points of slack: nobody lands exactly on the line
  const overpaying = accepted && pct > OVERPAY_FROM;
  const upToLine = Math.min(fillPct, 100);
  const beyondLine = Math.max(0, fillPct - 100);

  return (
    <div className="min-w-[220px] flex-1">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="label-sm inline-flex items-center gap-1.5">
          Acceptance
          <Tooltip text={tip('tradeAcceptance')} />
        </span>
        <span className={`stat-value text-stat-sm ${accepted ? 'text-accent' : pct >= 80 ? 'text-warn' : 'text-bad'}`}>
          {/* The bar's scale tops out at 150, so a raw "1056%" beside a bar
              that is merely full is the meter disagreeing with itself. Past
              the ceiling the exact figure carries no information anyway —
              every one of them means the same thing. */}
          {pct > 150 ? '150%+' : `${Math.round(pct)}%`}
        </span>
      </div>
      <div className="relative h-3 rounded-full bg-ink/70 border border-line/70 overflow-hidden flex">
        <div className={`h-full ${barColor} transition-[width] duration-[var(--dur-state)]`} style={{ width: `${(upToLine / 150) * 100}%` }} />
        {beyondLine > 0 && (
          <div className="h-full bg-warn/55 transition-[width] duration-[var(--dur-state)]" style={{ width: `${(beyondLine / 150) * 100}%` }} />
        )}
        <div className="absolute top-0 bottom-0 w-[2px] bg-chalk/70" style={{ left: `${thresholdLeft}%` }} />
      </div>
      <div className="relative h-3 mt-0.5">
        <span className="absolute -translate-x-1/2 text-[9px] uppercase tracking-wider text-muted whitespace-nowrap" style={{ left: `${thresholdLeft}%` }}>
          their line
        </span>
        {overpaying && (
          <span className="absolute right-0 text-[9px] uppercase tracking-wider text-warn whitespace-nowrap">
            they&apos;d take less
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Reasons arrive as "Firstname Lastname: why" (see assetValues in lib/trade.ts),
 * split so the man can lead his own line instead of being buried mid-sentence.
 * Only a short prefix counts as a name, so a reason that happens to contain a
 * colon renders whole rather than being chopped in half.
 */
function splitReason(reason: string): { who: string | null; text: string } {
  const i = reason.indexOf(': ');
  if (i > 0 && i <= 32) return { who: reason.slice(0, i), text: reason.slice(i + 2) };
  return { who: null, text: reason };
}

function ReasonColumn({ heading, reasons }: { heading: string; reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="label-sm border-b border-line/60 pb-1.5">{heading}</div>
      {reasons.map((r, i) => {
        const { who, text } = splitReason(r);
        return (
          <p key={i} className="text-xs leading-relaxed text-muted">
            {who && <span className="text-chalk font-semibold">{who} — </span>}
            {text}
          </p>
        );
      })}
    </div>
  );
}

function CapBlockTiles({ block }: { block: { shortfall: number; added: number; available: number } }) {
  const tiles: { label: string; value: string; color: string }[] = [
    { label: 'Lands on their cap', value: formatMoney(block.added), color: 'text-chalk' },
    { label: 'Room they have', value: formatMoney(block.available), color: 'text-chalk' },
    { label: 'Short by', value: formatMoney(block.shortfall), color: 'text-bad' },
  ];
  return (
    <div className="grid grid-cols-3 divide-x divide-line/50 rounded-md border border-warn/30 bg-warn/5 overflow-hidden">
      {tiles.map((t) => (
        <div key={t.label} className="px-3 py-2">
          <div className="label-sm text-[10px]">{t.label}</div>
          <div className={`stat-value text-stat-sm mt-1 ${t.color}`}>{t.value}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * The payoff of the trade screen: what the other front office said, how far
 * off the deal is, and — the part that used to be three grey bullet points at
 * the bottom — which of these assets actually moved them and why.
 *
 * A cap refusal is drawn as its own state rather than as another red "no".
 * Those two rejections are fixed by completely different moves: one wants
 * more value, the other wants a contract sent back the other way, and the
 * numbers behind it come from `capBlock` exactly as the evaluator reported
 * them.
 */
export function TradeVerdict({ result, intel, partner, children }: {
  result: TradeVerdictResult;
  intel: TradeIntelNumbers | null;
  partner: { id: string; abbr: string; name: string };
  /** Trailing controls that belong to the caller — the Insider row. */
  children?: ReactNode;
}) {
  const state = result.capBlock ? 'CAP' : result.accepted ? 'YES' : 'NO';
  const chrome = {
    YES: { border: 'border-accent/50', wash: 'bg-accent/[0.06]', text: 'text-accent', label: 'Deal accepted', note: 'Confirm to execute.' },
    CAP: { border: 'border-warn/50', wash: 'bg-warn/[0.06]', text: 'text-warn', label: 'Cap blocked', note: 'Their books, not their board.' },
    NO: { border: 'border-bad/40', wash: 'bg-bad/[0.05]', text: 'text-bad', label: 'Turned down', note: null as string | null },
  }[state];

  return (
    <div className={`panel ${chrome.border} ${chrome.wash} p-4 space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-3 min-w-0">
          <TeamLogo seed={partner.id} abbr={partner.abbr} size={38} />
          <div className="min-w-0">
            <div className={`font-display font-extrabold uppercase tracking-wide text-xl leading-none ${chrome.text}`}>
              {chrome.label}
            </div>
            <div className="text-[11px] text-muted mt-1">
              {partner.name}
              {chrome.note ? ` · ${chrome.note}` : ''}
            </div>
          </div>
        </div>
        <AcceptanceMeter ratio={result.ratio} requiredRatio={result.requiredRatio} accepted={result.accepted} />
      </div>

      {/* Their answer in their own voice — the sentence lib/trade.ts wrote,
          given the width to be read rather than run in as a status line. A yes
          carries no such sentence, and the headline above has already said it. */}
      {result.message && <p className="text-sm leading-relaxed text-chalk border-l-2 border-line pl-3">{result.message}</p>}

      {result.capBlock && <CapBlockTiles block={result.capBlock} />}

      {(result.explanation?.give.length || result.explanation?.receive.length) ? (
        <div className="grid md:grid-cols-2 gap-x-6 gap-y-4 pt-1">
          <ReasonColumn heading="What we'd be getting" reasons={result.explanation.give} />
          <ReasonColumn heading="What we'd be giving up" reasons={result.explanation.receive} />
        </div>
      ) : null}

      {intel?.unlocked && (
        <div className="rounded-md border border-accent2/25 bg-accent2/[0.06] px-3 py-2">
          <div className="label-sm text-accent2 inline-flex items-center gap-1.5">
            Trade Intel
            <Tooltip text={tip('tradeValue')} />
          </div>
          <div className="text-xs text-muted mt-1.5 flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <span>
              They price what you&apos;re asking for at <span className="font-mono text-chalk">{intel.theirValue.toLocaleString()}</span>
            </span>
            <span>
              and your offer at <span className="font-mono text-chalk">{intel.yourValue.toLocaleString()}</span>
            </span>
            {intel.shortfall > 0
              ? <span>Short by <span className="font-mono text-bad">{intel.shortfall.toLocaleString()}</span></span>
              : <span className="text-accent">That clears their bar.</span>}
          </div>
        </div>
      )}

      {children}
    </div>
  );
}
