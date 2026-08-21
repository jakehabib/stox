import type { Verdict } from '@/lib/negotiation';

const VERDICT_STYLE: Record<Verdict, { label: string; text: string; bar: string }> = {
  ACCEPT:      { label: 'Will sign',   text: 'text-accent', bar: 'bg-accent' },
  CLOSE:       { label: 'Close',       text: 'text-gold',   bar: 'bg-gold' },
  CONSIDERING: { label: 'Considering', text: 'text-warn',   bar: 'bg-warn' },
  COLD:        { label: 'Cold',        text: 'text-muted',  bar: 'bg-muted' },
  INSULTED:    { label: 'Insulted',    text: 'text-bad',    bar: 'bg-bad' },
};

/**
 * The live read on how an offer is landing.
 *
 * The threshold marks are drawn on the track deliberately. The player's
 * reservation price stays hidden — that is what makes this a negotiation
 * rather than arithmetic — but hiding the *rules* as well would just be
 * unfair, so the user can always see how close to "will sign" they are even
 * though they cannot see the number that gets them there.
 */
export function InterestMeter({ interest, verdict, headline }: {
  interest: number;
  verdict: Verdict;
  headline: string;
}) {
  const style = VERDICT_STYLE[verdict];
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="label-sm">Interest</span>
        <span className={`label-sm ${style.text}`}>{style.label}</span>
      </div>

      <div className="relative h-2.5 mt-1.5 rounded-full bg-raised overflow-hidden">
        {/* Threshold marks at CONSIDERING (45), CLOSE (68) and ACCEPT (82). */}
        {[45, 68, 82].map((t) => (
          <div key={t} className="absolute inset-y-0 w-px bg-line/80 z-10" style={{ left: `${t}%` }} />
        ))}
        <div
          className={`h-full ${style.bar} transition-[width] duration-200 ease-out`}
          style={{ width: `${Math.max(2, interest)}%` }}
        />
      </div>

      <div className="flex items-baseline justify-between gap-3 mt-1.5">
        <span className={`text-sm ${style.text}`}>{headline}</span>
        <span className={`stat-value text-stat-sm ${style.text}`}>{interest}</span>
      </div>
    </div>
  );
}
