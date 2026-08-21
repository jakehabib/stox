'use client';

import { useEffect, useRef, useState } from 'react';
import type { Verdict } from '@/lib/negotiation';

const VERDICT_STYLE: Record<Verdict, { label: string; text: string; bar: string }> = {
  ACCEPT:      { label: 'Will sign',   text: 'text-accent', bar: 'bg-accent' },
  CLOSE:       { label: 'Close',       text: 'text-gold',   bar: 'bg-gold' },
  CONSIDERING: { label: 'Considering', text: 'text-warn',   bar: 'bg-warn' },
  COLD:        { label: 'Cold',        text: 'text-muted',  bar: 'bg-muted' },
  INSULTED:    { label: 'Insulted',    text: 'text-bad',    bar: 'bg-bad' },
};

/** CONSIDERING, CLOSE and ACCEPT, in the order they are crossed. */
const THRESHOLDS = [45, 68, 82];

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
export function InterestMeter({ interest, verdict, headline }: {
  interest: number;
  verdict: Verdict;
  headline: string;
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
        <span className="label-sm">Interest</span>
        <span className={`label-sm ${style.text}`}>{style.label}</span>
      </div>

      <div className="relative h-2.5 mt-1.5 rounded-full bg-raised overflow-hidden">
        {THRESHOLDS.map((t) => (
          <div
            key={t}
            className={`absolute inset-y-0 z-10 ${flare === t ? 'w-0.5 bg-chalk' : 'w-px bg-line/80'}`}
            style={{ left: `${t}%`, transition: 'background-color var(--dur-tick) var(--ease-out)' }}
          />
        ))}
        <div
          className={`h-full ${style.bar}`}
          style={{
            width: `${Math.max(2, interest)}%`,
            transition: 'width var(--dur-state) var(--ease-out), background-color var(--dur-state) var(--ease-out)',
          }}
        />
      </div>

      <div className="flex items-baseline justify-between gap-3 mt-1.5">
        <span className={`text-sm ${style.text}`}>{headline}</span>
        <span className={`stat-value text-stat-sm ${style.text}`} data-testid="interest-value">{interest}</span>
      </div>
    </div>
  );
}
