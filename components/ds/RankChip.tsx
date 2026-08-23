import { ordinalRank, rankHighlight, type RankHighlight, type StatRank } from '@/lib/statRanks';

/**
 * WHERE HE STANDS, IN TWO COLOURS AND A STAR.
 *
 * The app owner's rule, in his words: *"Instead of all the colors everywhere,
 * lets just highlight blue if they are top 10, or gold with a star if they are
 * a league leader."* The five-step percentile ramp this replaces — and the
 * receiver it called BELOW on a 1,328-yard season — is written up in
 * lib/statRanks.ts, which owns the rule so the cards and the tables cannot
 * paint the same standing two different ways.
 *
 * Gold #eab308 and blue #38bdf8 are the app's own `gold` and `accent2`, not new
 * colours. The measurements that let two colours carry a scale at all are in
 * lib/statRanks.ts's block: the star is a second channel on the only step that
 * needs one, and the ordinal is always printed.
 *
 * The pool size rides along, because 6th of 12 and 6th of 64 are opposite
 * answers to the same question and a bare "6th" is neither.
 */
const PAINT: Record<RankHighlight, { hex: string | null; star: boolean }> = {
  leader: { hex: '#eab308', star: true },
  topTen: { hex: '#38bdf8', star: false },
  field: { hex: null, star: false },
};

/** The paint for a standing — one definition, read by the chip and by the tables. */
export function rankPaint(rank: StatRank | null): { hex: string | null; star: boolean } {
  return rank ? PAINT[rankHighlight(rank)] : PAINT.field;
}

/** "9th of 159 at the position" — the hover text every painted number carries. */
export function rankTitle(rank: StatRank): string {
  return `${ordinalRank(rank)} of ${rank.of}${rank.qualified ? ' qualified' : ''} at the position`;
}

/**
 * `rank` of null is a real state and gets a real mark: an em dash in the same
 * slot, the same width. Ranks are withheld on purpose in three cases — too few
 * games played for a standing to mean anything, a rate on too small a sample,
 * and a stat this engine deals as dice — and a chip that simply vanished would
 * let the row above and the row below drift out of line for a reason nobody
 * could see.
 */
export function RankChip({ rank, size = 'sm' }: { rank: StatRank | null; size?: 'sm' | 'md' }) {
  const pad = size === 'md' ? 'px-2 py-1 text-xs' : 'px-1.5 py-0.5 text-[11px]';
  if (!rank) {
    return (
      <span className={`inline-flex items-center justify-center rounded border border-line/60 text-muted/70 font-mono ${pad}`}>
        —
      </span>
    );
  }
  const { hex, star } = rankPaint(rank);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border font-mono whitespace-nowrap ${pad} ${
        // THE FIELD IS NOT A COLOUR. Ranks 11 and 140 are both "not top ten",
        // and tinting them at all is the thing he asked to stop — so the
        // unhighlighted chip wears the same line and muted ink as every other
        // quiet figure on the page.
        hex ? '' : 'border-line/60 text-muted'
      }`}
      style={hex ? {
        color: hex,
        borderColor: `color-mix(in srgb, ${hex} 45%, transparent)`,
        background: `color-mix(in srgb, ${hex} 12%, transparent)`,
      } : undefined}
      title={rankTitle(rank)}
    >
      {star && <span aria-hidden className="text-[0.85em] leading-none">★</span>}
      <span className="font-semibold">{ordinalRank(rank)}</span>
      <span className="opacity-60">/{rank.of}</span>
    </span>
  );
}
