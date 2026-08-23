import Link from 'next/link';

interface Need {
  position: string;
  /** 0..1 raw need score — same scale as lib/ai/gm.ts teamNeeds(), drives the bar width directly. */
  value: number;
  /** Severity label + color, e.g. from lib/ai/gm.ts needSeverity(). */
  label: string;
  className: string;
  /**
   * WHY THIS POSITION IS ON THE LIST, in bodies — "2 rostered · 3 start".
   *
   * The severity word used to be the only text on the row, and measured on a
   * live dashboard all five rows read "Moderate": `needSeverity`'s middle band
   * runs 0.15 to 0.35 and the dashboard already filters to scores above 0.10,
   * so a normal roster puts every one of its top five needs inside one band.
   * The bars were doing the ranking and the word was cancelling it out.
   *
   * The word is gone rather than re-banded, because re-banding would be this
   * component holding a second opinion about severity — the exact defect this
   * codebase keeps having to fix. The severity still shows, as the colour of
   * the bar, straight off the same `className`; what the row says in words is
   * now the fact underneath the score, and it is different on every line.
   *
   * Counted by the caller from the roster it already has and from
   * `startersAt` in lib/lineup.ts — THE definition of the starting eleven — so
   * this is never a second opinion about who starts either.
   */
  detail?: string;
  /** The market, filtered to this position. Omit and the row is plain, as it was. */
  href?: string;
}

const BAR_COLOR: Record<string, string> = {
  'text-bad': 'bg-bad', 'text-warn': 'bg-warn', 'text-accent2': 'bg-accent2', 'text-muted': 'bg-line',
};

export function RosterNeeds({ needs }: { needs: Need[] }) {
  return (
    <div className="space-y-2.5">
      {needs.map((n) => {
        const body = (
          <>
            <span className="label-sm w-10 shrink-0">{n.position}</span>
            <div className="flex-1 h-1.5 rounded-full bg-raised overflow-hidden">
              <div className={`h-full rounded-full ${BAR_COLOR[n.className] ?? 'bg-line'}`} style={{ width: `${Math.round(n.value * 100)}%` }} />
            </div>
            <span className={`text-xs w-24 text-right tabular-nums ${n.detail ? 'text-muted' : `font-medium ${n.className}`}`}>
              {n.detail ?? n.label}
            </span>
          </>
        );
        // The panel exists to tell a first-timer where to start, and every row
        // named a position you could not click. The market, already filtered.
        return n.href ? (
          <Link
            key={n.position}
            href={n.href}
            title={`${n.label} need at ${n.position}`}
            className="flex items-center gap-3 rounded-md -mx-1 px-1 py-0.5 hover:bg-raised transition-colors"
          >
            {body}
          </Link>
        ) : (
          <div key={n.position} className="flex items-center gap-3" title={`${n.label} need at ${n.position}`}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
