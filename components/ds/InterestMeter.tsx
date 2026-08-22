'use client';

import { useEffect, useRef, useState } from 'react';
import type { Verdict } from '@/lib/negotiation';
import { Tooltip } from '../Tooltip';
import { tip } from '@/lib/glossary';

const VERDICT_STYLE: Record<Verdict, { label: string; text: string; bar: string }> = {
  ACCEPT:      { label: 'Will sign',   text: 'text-accent',  bar: 'bg-accent' },
  // Inside the band. Deliberately its own colour rather than a shade of
  // "Will sign": the difference between "he signs this" and "he might" is the
  // whole of the mechanic, and two greens would have buried it.
  MAYBE:       { label: 'Might sign',  text: 'text-accent2', bar: 'bg-accent2' },
  CLOSE:       { label: 'Close',       text: 'text-gold',    bar: 'bg-gold' },
  // He likes your package; somebody else's reads better to him. Its own state
  // rather than a shade of Cold, because nothing is wrong with the offer —
  // the offer is losing, which is a different thing to fix and fixable in
  // three different dimensions. See THE CONTEST in lib/negotiation.ts.
  OUTBID:      { label: 'Losing out',  text: 'text-bad',     bar: 'bg-bad' },
  CONSIDERING: { label: 'Considering', text: 'text-warn',    bar: 'bg-warn' },
  COLD:        { label: 'Cold',        text: 'text-muted',   bar: 'bg-muted' },
  INSULTED:    { label: 'Insulted',    text: 'text-bad',     bar: 'bg-bad' },
};

/** CONSIDERING, CLOSE and ACCEPT, in the order they are crossed. */
// Tick marks, aligned to the verdict boundaries in lib/negotiation.ts
// (CONSIDERING 45, CLOSE 72, certain yes at ACCEPT_INTEREST 90). A second
// copy of a threshold is how a meter comes to disagree with the decision it
// is drawing; these are the same numbers, and they move together.
const THRESHOLDS = [45, 72, 90];

/**
 * The live read on how an offer is landing.
 *
 * The threshold marks are drawn on the track deliberately. The player's
 * reservation price stays hidden — that is what makes this a negotiation
 * rather than arithmetic — but hiding the *rules* as well would just be
 * unfair, so the user can always see how close to "will sign" they are even
 * though they cannot see the number that gets them there.
 *
 * Crossing one of those marks FLARES it. Moving from Considering into Close
 * is a mechanical event — the same drag either side of that line means
 * different things — and it used to pass with nothing but a bar being a few
 * pixels longer. The flare is decoration over information that is already on
 * screen: the width, the number and the verdict label are all correct at
 * frame one whether the flare runs or not, and under reduced motion the
 * duration tokens collapse to 1ms so it simply does not happen. Nothing here
 * gates input; there is no input to gate.
 */
export function InterestMeter({ interest, verdict, headline, maybeBand, rival }: {
  interest: number;
  verdict: Verdict;
  headline: string;
  /**
   * The stretch of the track where he MIGHT sign, in interest points. Drawn
   * as a hatched region rather than left invisible for the same reason the
   * threshold marks are drawn: the player's number stays hidden, but the
   * RULES do not get to be. You are allowed to see that there is a gamble
   * there and roughly how wide it is — which, since the width comes off how
   * well he is scouted, is itself a readable statement about what your
   * scouting department has bought you.
   */
  maybeBand?: { lo: number; hi: number } | null;
  /**
   * Where the rival's package sits ON THE SAME TRACK, because it is the same
   * scale — `decideOffer` scores their offer with the same evaluation it
   * scores yours with (lib/negotiation.ts, THE CONTEST).
   *
   * Drawn rather than described for the reason the threshold marks are drawn:
   * the player's hidden number stays hidden, but the CONTEST is not hidden,
   * and a bar the user has to clear is enormously easier to read as a line on
   * the track than as a sentence underneath. It also makes the fix visible in
   * whichever dimension the user reaches for — drag guarantee and your bar
   * moves past their mark exactly as it would if you had dragged salary.
   */
  rival?: { interest: number; label: string } | null;
}) {
  const style = VERDICT_STYLE[verdict];
  const [flare, setFlare] = useState<number | null>(null);
  const previous = useRef(interest);

  useEffect(() => {
    const from = previous.current;
    previous.current = interest;
    const crossed = THRESHOLDS.find((t) => (from < t && interest >= t) || (from >= t && interest < t));
    if (crossed === undefined) return;
    setFlare(crossed);
    const timer = setTimeout(() => setFlare(null), 260);
    return () => clearTimeout(timer);
  }, [interest]);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="label-sm inline-flex items-center gap-1.5">
          Interest
          {/* Flush against the panel's left padding — opens rightward. */}
          <Tooltip align="start" text={tip('interestMeter')} />
        </span>
        <span className={`label-sm ${style.text}`}>{style.label}</span>
      </div>

      <div className="relative h-2.5 mt-1.5 rounded-full bg-raised overflow-hidden">
        {maybeBand && (
          <div
            className="absolute inset-y-0 z-0 border-x border-accent2/50 bg-accent2/15"
            style={{
              left: `${Math.max(0, maybeBand.lo)}%`,
              width: `${Math.max(0, Math.min(100, maybeBand.hi) - Math.max(0, maybeBand.lo))}%`,
            }}
            // The hatched band is a shape rather than a label, so it carries the
            // glossary text as a native title — same words as every other
            // explanation of it, without a "?" floating inside a 2.5px track.
            title={`${tip('maybeBand')} Submitting inside it spends patience either way.`}
          />
        )}
        {THRESHOLDS.map((t) => (
          <div
            key={t}
            className={`absolute inset-y-0 z-10 ${flare === t ? 'w-0.5 bg-chalk' : 'w-px bg-line/80'}`}
            style={{ left: `${t}%`, transition: 'background-color var(--dur-tick) var(--ease-out)' }}
          />
        ))}
        {rival && (
          <div
            className="absolute inset-y-0 z-20 w-0.5 bg-chalk"
            style={{ left: `${Math.max(0, Math.min(100, rival.interest))}%` }}
            title={`${rival.label} — how their package reads to him on this same scale. Clear this and he is yours.`}
          />
        )}
        <div
          className={`h-full ${style.bar}`}
          style={{
            width: `${Math.max(2, interest)}%`,
            transition: 'width var(--dur-state) var(--ease-out), background-color var(--dur-state) var(--ease-out)',
          }}
        />
      </div>

      {rival && (
        <div className="mt-1 text-[10px] label-sm text-muted" style={{ paddingLeft: `${Math.max(0, Math.min(88, rival.interest))}%` }}>
          {rival.label} · {rival.interest}
        </div>
      )}

      <div className="flex items-baseline justify-between gap-3 mt-1.5">
        <span className={`text-sm ${style.text}`}>{headline}</span>
        <span className={`stat-value text-stat-sm ${style.text}`} data-testid="interest-value">{interest}</span>
      </div>
    </div>
  );
}
