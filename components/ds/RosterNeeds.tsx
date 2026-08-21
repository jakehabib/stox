interface Need {
  position: string;
  /** 0..1 raw need score — same scale as lib/ai/gm.ts teamNeeds(). Orders the list. */
  value: number;
  /** Severity label + color, e.g. from lib/ai/gm.ts needSeverity(). */
  label: string;
  className: string;
  /**
   * Why this position is a need, in the roster's own terms — "none rostered",
   * "1 deep · best 65". This is the part that actually varies.
   */
  detail?: string;
}

const RULE_COLOR: Record<string, string> = {
  'text-bad': 'bg-bad', 'text-warn': 'bg-warn', 'text-accent2': 'bg-accent2', 'text-muted': 'bg-line',
};

/**
 * Ranked roster holes.
 *
 * This used to render one full-width, fully-saturated red bar per row, each
 * labelled "Urgent" — and because teamNeeds() pegs at 1.0 for any position
 * with nobody rostered, five of them were routinely identical. A meter at
 * 100% on every row carries zero bits, and it made the least informative
 * block on the dashboard the loudest one.
 *
 * What varies is *why*, so that is what the row leads with. Severity survives
 * as a hairline rule plus the word itself — colour and text, never colour
 * alone — and rank is carried by order and by the top row's extra weight.
 */
export function RosterNeeds({ needs }: { needs: Need[] }) {
  return (
    <div className="divide-y divide-line/40">
      {needs.map((n, i) => (
        <div key={n.position} className="flex items-center gap-2.5 py-1.5 first:pt-0 last:pb-0">
          <span className={`w-[3px] self-stretch rounded-full shrink-0 ${RULE_COLOR[n.className] ?? 'bg-line'}`} />
          <span className="font-display font-bold text-sm w-9 shrink-0 text-muted">{n.position}</span>
          <span className={`text-xs truncate ${i === 0 ? 'text-chalk font-medium' : 'text-muted'}`}>
            {n.detail ?? '—'}
          </span>
          <span className={`ml-auto text-[10px] uppercase tracking-wider font-semibold shrink-0 ${n.className}`}>
            {n.label}
          </span>
        </div>
      ))}
    </div>
  );
}
