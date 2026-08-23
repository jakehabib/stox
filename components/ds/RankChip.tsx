import { ordinalRank, rankTier, type RankTier, type StatRank } from '@/lib/statRanks';

/**
 * WHERE HE STANDS, READ BEFORE THE DIGITS ARE READ.
 *
 * The app owner's ask for the stats page was *"WE want to see if our QB is
 * doing good or bad vs the league"* — so a standing has to answer good-or-bad
 * across the room, and only then let you read the place. This chip is that
 * answer wherever a rank appears: on a verdict card, in a roster table's rank
 * column, down the side of a leader board.
 *
 * THREE CHANNELS, NEVER ONE (README design principle 4). Colour is the
 * fastest, so it is here — but every step also carries its own SHAPE, and the
 * ordinal itself is always printed. A reader who cannot separate the orange
 * from the red still has ▼ against ✕, and still has "27th of 34" in words.
 * The shapes are deliberately five different silhouettes rather than a size
 * ramp of one, because a ramp is a colour channel wearing a second coat.
 *
 * THE COLOURS WERE MEASURED, NOT PICKED. Run through the dataviz skill's
 * `validate_palette.js` against this app's card surface (#18181b, dark), the
 * five steps pass CVD separation, the normal-vision floor and 3:1 contrast on
 * every ADJACENT pair — which is the pair a reader of an ordinal scale
 * actually compares, and what principle 4 demands.
 *
 * The first version of this ramp used the app's `warn` amber (#fbbf24) for
 * "below". It measured at ΔE 4.2 against the gold above it WITH FULL COLOUR
 * VISION — an elite card and a below-average card were the same colour at a
 * glance, which is the exact failure the check exists to catch and is not
 * something eyeballing would have found. Burnt orange (#c2410c) clears gold by
 * ΔE 17.5 and the red below it by 16.5.
 *
 * The pool size rides along, because 6th of 12 and 6th of 64 are opposite
 * answers to the same question and a bare "6th" is neither.
 */
const TIER: Record<RankTier, { glyph: string; hex: string; label: string }> = {
  elite:   { glyph: '★', hex: '#eab308', label: 'Elite' },
  strong:  { glyph: '▲', hex: '#4ade80', label: 'Strong' },
  average: { glyph: '●', hex: '#38bdf8', label: 'Average' },
  below:   { glyph: '▼', hex: '#c2410c', label: 'Below' },
  bottom:  { glyph: '✕', hex: '#f87171', label: 'Bottom' },
};

export function rankTierLabel(rank: StatRank): string {
  return TIER[rankTier(rank)].label;
}

export function rankTierGlyph(rank: StatRank): string {
  return TIER[rankTier(rank)].glyph;
}

/** The literal colour, for the places that cannot use a class — the card's corner flag. */
export function rankTierHex(rank: StatRank): string {
  return TIER[rankTier(rank)].hex;
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
  const t = TIER[rankTier(rank)];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border font-mono whitespace-nowrap ${pad}`}
      style={{
        color: t.hex,
        borderColor: `color-mix(in srgb, ${t.hex} 45%, transparent)`,
        background: `color-mix(in srgb, ${t.hex} 12%, transparent)`,
      }}
      title={`${ordinalRank(rank)} of ${rank.of}${rank.qualified ? ' qualified' : ''} at the position`}
    >
      <span aria-hidden className="text-[0.85em] leading-none">{t.glyph}</span>
      <span className="font-semibold">{ordinalRank(rank)}</span>
      <span className="opacity-60">/{rank.of}</span>
    </span>
  );
}
