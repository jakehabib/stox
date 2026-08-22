/**
 * A small "?" info icon that reveals explanatory text on hover/focus. Pure
 * CSS (Tailwind's group-hover/group-focus-within) — no client JS, so this
 * renders fine directly inside Server Components. Keyboard-reachable via
 * the button's own tab stop, not just mouse hover.
 */
export function Tooltip({ text, className = '', placement = 'top', align = 'center' }: {
  text: string;
  className?: string;
  /**
   * Which edge the bubble lines up with. Centred by default, which is right
   * almost everywhere — but a trigger sitting near the edge of a clipping box
   * (the first or last cell of a panel, the last column of a table) puts half
   * a 18rem bubble outside it, and the same overflow rule that eats a badly
   * placed bubble vertically eats it sideways. `start` pins the bubble's left
   * edge to the trigger, `end` its right edge, so it opens INWARD.
   */
  align?: 'center' | 'start' | 'end';
  /**
   * Which side the bubble opens on. Defaults to 'top', but a trigger inside a
   * scroll container — a sticky table header being the usual case — must open
   * DOWNWARD or it is clipped and appears not to work at all.
   */
  placement?: 'top' | 'bottom';
}) {
  return (
    <span className={`relative inline-flex group ${className}`}>
      <button
        type="button"
        className="w-3.5 h-3.5 rounded-full border border-line text-muted text-[10px] leading-none flex items-center justify-center
                   hover:text-chalk hover:border-muted transition-colors
                   focus:outline-none focus-visible:ring-1 focus-visible:ring-accent2"
        aria-label="More info"
      >
        ?
      </button>
      {/* Width is not cosmetic either. A glossary entry is a definition plus,
          usually, a sentence on what good and bad look like — at 14rem that
          wrapped to a dozen lines and the bubble grew taller than the card it
          was opening inside, which is a clipping bug wearing a copy costume.
          18rem keeps a two-sentence tip to five or six lines. */}
      {/* Placement is not cosmetic. This bubble is absolutely positioned, so any
          ancestor with a clipping overflow cuts it off — and `overflow-x: auto`
          counts, because CSS computes the other axis to `auto` the moment one
          axis stops being `visible`. The Cap page's contract table sits inside
          `panel overflow-hidden` AND an `overflow-x-auto` scroller, so a
          tooltip on its sticky header opened upward into two clipping boxes:
          it rendered perfectly and was completely invisible. Opening downward
          keeps it inside the scroller, where there is always table body under
          it. */}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 w-72 rounded-md border border-line
                   bg-surface px-2.5 py-1.5 text-xs leading-snug text-chalk shadow-card opacity-0 scale-95 transition-all duration-100
                   group-hover:opacity-100 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:scale-100
                   ${placement === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'}
                   ${align === 'start' ? 'left-0' : align === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}
      >
        {text}
      </span>
    </span>
  );
}

/** Label text with a tooltip glued on — the common case, one import instead of two. */
export function LabelWithTip({ label, tip, className = '', placement }: { label: React.ReactNode; tip: string; className?: string; placement?: 'top' | 'bottom' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {label}
      <Tooltip text={tip} placement={placement} />
    </span>
  );
}
