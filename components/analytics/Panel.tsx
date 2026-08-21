/**
 * The chrome every panel on the Analytics Department shares.
 *
 * One shape — eyebrow, title, an optional flag carrying the panel's single
 * finding, a sentence of why, the chart, a legend, a prose note, and the table
 * twin — so that eight panels read as one department rather than eight
 * dashboards. It is `.card` from globals.css with the app's `.section-head`
 * anatomy inside it; nothing new is styled here.
 */
export function Panel({ span, eyebrow, title, flag, aside, why, children }: {
  /** Columns of the 12-wide grid. */
  span: 5 | 6 | 7 | 12;
  eyebrow: string;
  title: string;
  flag?: { text: string; tone: 'good' | 'bad' | 'warn' };
  /** A quiet right-hand caption, for a panel whose finding is not a flag. */
  aside?: string;
  why: React.ReactNode;
  children: React.ReactNode;
}) {
  // Whole class names, because Tailwind scans source text and cannot see a
  // template literal — the same reason PageMasthead looks its grid up.
  const SPAN: Record<number, string> = {
    5: 'lg:col-span-5', 6: 'lg:col-span-6', 7: 'lg:col-span-7', 12: 'lg:col-span-12',
  };
  return (
    <section className={`card card-pad col-span-12 ${SPAN[span]} min-w-0`}>
      <div className="section-head items-end">
        <div className="min-w-0">
          <div className="label-sm text-[10px] tracking-[0.1em]">{eyebrow}</div>
          <h2 className="section-title text-[15px] mt-0.5">{title}</h2>
        </div>
        {flag && <Flag tone={flag.tone}>{flag.text}</Flag>}
        {!flag && aside && <span className="label-sm text-[10px] shrink-0 text-right">{aside}</span>}
      </div>
      <p className="text-xs text-muted leading-relaxed mt-2.5 mb-3">{why}</p>
      {children}
    </section>
  );
}

export function Flag({ tone, children }: { tone: 'good' | 'bad' | 'warn'; children: React.ReactNode }) {
  const TONE = {
    good: 'text-accent border-accent/35 bg-accent/10',
    bad: 'text-bad border-bad/35 bg-bad/10',
    warn: 'text-warn border-warn/35 bg-warn/10',
  } as const;
  return <span className={`pill shrink-0 font-semibold ${TONE[tone]}`}>{children}</span>;
}

/**
 * A sub-heading inside a panel, for the second thing a panel says (the game
 * shapes under the margins, the division table under the schedule).
 */
export function SubHead({ eyebrow, title, aside }: { eyebrow: string; title: string; aside?: string }) {
  return (
    <div className="section-head items-end mt-5">
      <div className="min-w-0">
        <div className="label-sm text-[10px] tracking-[0.1em]">{eyebrow}</div>
        <h3 className="section-title text-[13px] mt-0.5">{title}</h3>
      </div>
      {aside && <span className="label-sm text-[10px] shrink-0">{aside}</span>}
    </div>
  );
}

export type LegendKey = { color?: string; label: string; shape?: 'dot' | 'line' | 'ring' | 'block'; ringColor?: string };

/**
 * A legend is present for every chart carrying two or more classes — the
 * dataviz rule, and the reason no encoding on this screen is colour-alone.
 */
export function Legend({ keys, note }: { keys: LegendKey[]; note?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[11.5px] text-muted mt-2.5">
      {keys.map((k) => (
        <span key={k.label} className="inline-flex items-center gap-1.5">
          <i
            className="inline-block shrink-0"
            style={
              k.shape === 'line' ? { width: 16, height: 3, borderRadius: 2, background: k.color }
                : k.shape === 'ring' ? { width: 11, height: 11, borderRadius: '50%', border: `2px solid ${k.ringColor ?? k.color}` }
                  : k.shape === 'block' ? { width: 12, height: 12, borderRadius: 3, background: k.color }
                    : { width: 11, height: 11, borderRadius: '50%', background: k.color }
            }
          />
          {k.label}
        </span>
      ))}
      {note && <span>{note}</span>}
    </div>
  );
}

/** The prose finding under a chart. Bold marks the number the sentence is about. */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11.5px] text-muted leading-relaxed mt-3 pl-3 border-l-2 border-line [&_b]:text-chalk [&_b]:font-semibold">
      {children}
    </div>
  );
}

/**
 * The honest-absence line. A panel that cannot compute something says so here,
 * in one plain sentence, rather than drawing an empty axis or quietly dropping
 * the category. See docs/design-research/analytics/data-inventory.md — the
 * things this screen cannot know are a fact about the database, and hiding
 * them would be the one failure mode this page is not allowed to have.
 */
export function NotOnRecord({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11.5px] text-muted leading-relaxed mt-3 pl-3 border-l-2 border-warn/40">
      {children}
    </p>
  );
}

export function Tiles({ cols, children }: { cols: 3 | 4; children: React.ReactNode }) {
  return (
    <div className={`grid gap-2.5 mt-3.5 ${cols === 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}>
      {children}
    </div>
  );
}

export function Tile({ label, value, detail, tone }: {
  label: string; value: string; detail?: string; tone?: 'good' | 'bad' | 'warn';
}) {
  const TONE = { good: 'text-accent', bad: 'text-bad', warn: 'text-warn' } as const;
  return (
    <div className="stat-tile">
      <div className="label-sm text-[9.5px]">{label}</div>
      <div className={`stat-value text-[21px] mt-1 ${tone ? TONE[tone] : ''}`}>{value}</div>
      {detail && <div className="text-[10.5px] text-muted mt-1 leading-snug">{detail}</div>}
    </div>
  );
}

/**
 * Every chart's table twin — the WCAG-clean equivalent, revealed by the one
 * switch in the filter row. A value a hover carries is never the only way to
 * read it. Hidden by default because eight of these open at once is a wall;
 * the toggle lives above everything it scopes, not per card.
 *
 * `overflow-x-auto` is on the wrapper, so a wide table scrolls inside its own
 * box and the page body never scrolls sideways.
 */
export function TableTwin({ caption, columns, rows }: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  return (
    <div className="hidden group-data-[numbers=on]/an:block mt-3.5 overflow-x-auto">
      <div className="label-sm text-[10px] mb-1.5">{caption}</div>
      <table className="w-full border-separate border-spacing-0 text-[11.5px]">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={c}
                className={`label-sm text-[9.5px] px-2 pb-1.5 border-b border-line whitespace-nowrap ${i ? 'text-right' : 'text-left'}`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((v, i) => (
                <td
                  key={i}
                  className={`px-2 py-1 border-b border-line/45 tabular-nums whitespace-nowrap ${i ? 'text-right' : 'text-left'}`}
                >
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A chart's own scroll box. Wide content scrolls here, never on the page body. */
export function ChartBox({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}
