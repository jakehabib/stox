/**
 * "+1 this year" — how his overall has moved since the last season closed.
 *
 * ONE CHIP, AND NOTHING ELSE. No sparkline, no ceiling, no "from 77 as a
 * 22-year-old", no career section. The app owner cut a four-part career-arc
 * display down to this twice: *"LEts just do A on the hero card. nothign
 * else"*, then *"I like just a simple +1 this year, -2 this year... etc. we
 * dont need the other text just the boxes on the player card"*. It sits beside
 * a 52px overall number and must not compete with it — small type, a thin
 * border, colour carried by the text rather than a filled block.
 *
 * IT IS ONLY EVER RENDERED WHEN THERE IS A REAL NUMBER TO PRINT. The decision
 * is upstream in yearOverYearOvr() (lib/playerSeasons.ts), which returns null —
 * and gets nothing drawn at all — for a man with no stored rating for last
 * season. This component has no empty state on purpose; giving it one is how
 * "+0" and greyed placeholder boxes get onto every card in the league.
 *
 * A GENUINE ZERO IS STILL A CHIP. He was 80 at the end of last season and he
 * is 80 now: that is an answer, and it is muted rather than coloured because
 * it is not news. Only the sign chooses the colour — up is `accent`, down is
 * `bad`, the same two tokens every other up/down reading on this app uses.
 *
 * Not a client component and must not become one. The player card is a Server
 * Component and `tsc` does not catch importing a `'use client'` module into
 * one; that shipped a 500 to production here once already.
 */
export function OvrChangeChip({ delta }: {
  /** Current overall minus his overall at the end of last season. Zero is allowed. */
  delta: number;
}) {
  // `+3` / `-2` / `±0`. The sign is the whole message, so it is never dropped:
  // a bare "3" beside an overall of 84 reads as a rating, not a change.
  const label = delta === 0 ? '±0' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`;
  const tone = delta > 0
    ? 'border-accent/40 text-accent bg-accent/10'
    : delta < 0
      ? 'border-bad/40 text-bad bg-bad/10'
      : 'border-line text-muted';
  return (
    <span className={`pill text-[11px] tabular-nums ${tone}`}>
      {label}&nbsp;this year
    </span>
  );
}
