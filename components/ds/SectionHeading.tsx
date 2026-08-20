/**
 * The default way to introduce a block of content — a heading + divider,
 * not another rounded card. Reach for a card only when what follows is a
 * genuinely distinct object (see /design-system "Surfaces" section).
 */
export function SectionHeading({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="section-head">
      <div>
        {eyebrow && <div className="section-eyebrow">{eyebrow}</div>}
        <h2 className="section-title">{title}</h2>
      </div>
      {action}
    </div>
  );
}
