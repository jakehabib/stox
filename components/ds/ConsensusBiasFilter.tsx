import Link from 'next/link';
import { CONSENSUS_BIASES, type ConsensusBiasId } from '@/lib/consensus';

/**
 * ===========================================================================
 * THE BOARD'S OWN ERROR, AS A CONTROL
 * ===========================================================================
 * This replaces a row of decorative `<span>` pills that read
 *
 *     Small school 270 · Testing darling 192 · Called a project 87 · …
 *
 * and did nothing. Three separate things were wrong with that, and they are
 * worth writing down because the shape recurs:
 *
 *   1. THE NUMBER HAD NO POOL. "Small school 270" reads as a statistic about
 *      one prospect. It is a count of the men in the class carrying that tag,
 *      and nothing on screen said so — nor, worse, said 270 OF WHAT. The old
 *      legend counted every prospect stamped with the class's draft year,
 *      drafted men included, while the panel's own header counted only the
 *      ones still available. On a save mid-draft those are different numbers
 *      by a couple of hundred (README principle 6). Here the count and the
 *      rows it filters to are the same set, by construction: `total` is the
 *      length of the list the click produces.
 *
 *   2. IT LOOKED LIKE A CONTROL AND WAS NOT. Bordered, tinted, pill-shaped —
 *      pixel-for-pixel the position filters on the draft board, which do
 *      filter. A control-shaped thing that does nothing is worse than no
 *      control, so these became the control they were already dressed as.
 *
 *   3. COLOUR CARRIED THE MEANING ALONE, and carried it inconsistently: the
 *      four markdowns were painted amber, sky, sky and red, and the two
 *      premiums green and green. Nothing separated a discount from a premium
 *      except a hue, and not reliably. README principle 4. Now direction is
 *      carried by the group heading, by an arrow glyph, and by the signed
 *      average delta — with colour as the fourth channel rather than the only
 *      one.
 *
 * WHY SPLIT DISCOUNT FROM PREMIUM. They are opposite kinds of information. A
 * markdown is where a steal is (the room took points off for something public
 * — if you disagree, he falls to you). A premium is where a bust is (the room
 * ADDED points, so the grade in front of you is inflated). Which is which is
 * read off lib/consensus.ts's CONSENSUS_BIASES, never re-declared here.
 * ===========================================================================
 */
export interface BiasFacet {
  id: ConsensusBiasId;
  /** Men in the pool carrying this bias — the exact size of the list this filters to. */
  total: number;
  /** Mean grade points the bias moved them, signed. The number the model added. */
  meanDelta: number;
}

/**
 * The two lenses that are not a single bias.
 *
 * `movers` is the DEFAULT, and that is a deliberate change of what this panel
 * is. It used to open on the top fourteen by board rank — which is the draft
 * board's first fourteen rows, rendered a second time on a second page, and
 * measured over 854 of them it is a slice where 64% of the men carry the same
 * "▲ Big program" tag and 55% grade an identical 99. That is not a fact about
 * the UI, it is a fact about the model: a +4 programme bump is a large part of
 * what puts a man at the top of a board, so the top of a board is blue-blood
 * heavy by construction and no per-row rendering of it can stop repeating.
 *
 * The men worth a page called The Scouting Department are the ones the room's
 * OWN named error moved furthest, in either direction, wherever they sit. That
 * list is not available anywhere else in the game, it varies row to row, and it
 * is the literal answer to "who is the room wrong about". `board` keeps the
 * ranked view one click away for anyone who wants it.
 */
export type ConsensusLens = ConsensusBiasId | 'movers' | 'board';

export function ConsensusBiasFilter({ facets, active, hrefFor, poolSize, poolLabel }: {
  facets: BiasFacet[];
  active: ConsensusLens;
  hrefFor: (lens: ConsensusLens) => string;
  poolSize: number;
  /** What poolSize counts — "still on the board", "in the class". Stated, never assumed. */
  poolLabel: string;
}) {
  const byId = new Map(facets.map((f) => [f.id, f]));
  const groups: { direction: 'DOWN' | 'UP'; heading: string; glyph: string; tone: string }[] = [
    { direction: 'DOWN', heading: 'Marked down by the room', glyph: '▼', tone: 'accent2' },
    { direction: 'UP', heading: 'Reached for by the room', glyph: '▲', tone: 'warn' },
  ];

  const lensPill = (lens: 'movers' | 'board', label: string, title: string) => (
    <Link
      href={hrefFor(lens)}
      scroll={false}
      prefetch={false}
      title={title}
      className={`pill text-[11px] transition-colors ${
        active === lens ? 'border-chalk text-chalk bg-chalk/10' : 'border-line text-muted hover:text-chalk hover:border-chalk/40'
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
      <div className="min-w-0">
        <div className="label-sm mb-1.5">Show me</div>
        <div className="flex flex-wrap gap-1.5">
          {lensPill('movers', 'Biggest misreads', 'The men the room’s own named biases moved furthest, up or down, wherever they sit on the board.')}
          {lensPill('board', 'Top of the board', 'The consensus order, highest graded first.')}
        </div>
      </div>
      {groups.map((g) => {
        const items = CONSENSUS_BIASES.filter((b) => b.direction === g.direction);
        return (
          <div key={g.direction} className="min-w-0">
            <div className="label-sm mb-1.5 flex items-center gap-1.5">
              <span className={g.tone === 'warn' ? 'text-warn' : 'text-accent2'}>{g.glyph}</span>
              {g.heading}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {items.map((b) => {
                const f = byId.get(b.id);
                const n = f?.total ?? 0;
                const on = active === b.id;
                // A tag nobody in this class carries is not a filter, it is a
                // dead end with a zero on it. Rendered flat and unclickable
                // rather than offered and then apologised for.
                if (n === 0) {
                  return (
                    <span key={b.id} className="pill text-[11px] gap-1.5 border-line/60 text-muted/50" title={`Nobody ${poolLabel} carries this tag.`}>
                      {g.glyph} {b.label}<span className="font-mono ml-1">0</span>
                    </span>
                  );
                }
                return (
                  <Link
                    key={b.id}
                    href={hrefFor(on ? 'movers' : b.id)}
                    scroll={false}
                    prefetch={false}
                    title={`${n} of the ${poolSize} ${poolLabel} — ${b.soWhat}. `
                      + `Average ${f && f.meanDelta > 0 ? '+' : ''}${(f?.meanDelta ?? 0).toFixed(1)} grade points.`}
                    className={`pill text-[11px] gap-1.5 transition-colors ${
                      on
                        ? g.tone === 'warn'
                          ? 'border-warn text-warn bg-warn/10'
                          : 'border-accent2 text-accent2 bg-accent2/10'
                        : 'border-line text-muted hover:text-chalk hover:border-chalk/40'
                    }`}
                  >
                    {g.glyph} {b.label}
                    <span className="font-mono ml-1 opacity-80">{n}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
