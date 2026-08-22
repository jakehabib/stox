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
          {tip && <Tooltip text={tip} />}
        </h2>
      </div>
      {action}
    </div>
  );
}
