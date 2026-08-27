import { Tooltip } from '../Tooltip';

/**
 * The default way to introduce a block of content — a heading + divider,
 * not another rounded card. Reach for a card only when what follows is a
 * genuinely distinct object (see /design-system "Surfaces" section).
 */
export function SectionHeading({ eyebrow, title, action, tip }: {
  eyebrow?: string; title: string; action?: React.ReactNode;
  /**
   * Glossary text for the section's own subject — pass `tip('consensusBoard')`.
   * A heading is the right home for a term the block below uses in every row:
   * one bubble instead of thirty, and it does not touch the table's layout.
   */
  tip?: string;
}) {
  return (
    <div className="section-head">
      <div>
        {eyebrow && <div className="section-eyebrow">{eyebrow}</div>}
        <h2 className="section-title inline-flex items-center gap-2">
          {title}
          {/* OPENS FROM ITS LEFT EDGE. A section heading is by definition the
              first thing on its row, so its trigger sits against the left
              margin of the page — and a centred 18rem bubble puts half of
              itself to the left of that. Measured at 1440, where the page
              gutter is 80px: the Draft board's headings started 15px and 22px
              off the screen, the Dynasty tree's 55px and the Trade Center's
              60px, which is a fifth of the bubble's width cut off every line
              of the sentence. `start` pins the bubble's left edge to the
              trigger, so it opens rightward into the page. */}
          {tip && <Tooltip text={tip} align="start" />}
        </h2>
      </div>
      {action}
    </div>
  );
}
