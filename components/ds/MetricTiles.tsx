import Link from 'next/link';
import { Tooltip } from '../Tooltip';

export interface Metric {
  label: string;
  value: string;
  /** Short qualifier under the number — a baseline, a rank, a count. */
  detail?: string;
  /** Explains what the metric means and how to read it. */
  tip?: string;
  /** Tailwind text color for the value. Omit for default ink. */
  color?: string;
  /**
   * Where this number is acted on — see MastheadFact.href, same rule. Set it
   * only when the destination is another screen; a tile that links to the page
   * it sits on promises a move and delivers a reload. Undefined renders the
   * plain, unclickable tile these have always been.
   */
  href?: string;
}

/**
 * A row of derived analytics figures — the "what does this roster actually
 * look like" numbers that sit above the charts in an Advanced view. Each
 * tile is one number plus the context needed to read it, never a bare stat.
 */
export function MetricTiles({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {metrics.map((m) => {
        const body = (
          <>
            <div className="label-sm inline-flex items-center gap-1.5">
              {m.label}
              {m.tip && <Tooltip text={m.tip} />}
            </div>
            <div className={`stat-value text-stat-md leading-none mt-1.5 ${m.color ?? ''}`}>{m.value}</div>
            {m.detail && <div className="text-xs text-muted mt-1">{m.detail}</div>}
          </>
        );
        return m.href ? (
          <Link key={m.label} href={m.href} className="panel p-3.5 block hover:border-accent/40 transition-colors">
            {body}
          </Link>
        ) : (
          <div key={m.label} className="panel p-3.5">{body}</div>
        );
      })}
    </div>
  );
}
