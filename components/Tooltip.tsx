/**
 * A small "?" info icon that reveals explanatory text on hover/focus. Pure
 * CSS (Tailwind's group-hover/group-focus-within) — no client JS, so this
 * renders fine directly inside Server Components. Keyboard-reachable via
 * the button's own tab stop, not just mouse hover.
 */
export function Tooltip({ text, className = '' }: { text: string; className?: string }) {
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
      <span
        role="tooltip"
        className="pointer-events-none absolute z-50 left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-56 rounded-md border border-line
                   bg-surface px-2.5 py-1.5 text-xs leading-snug text-chalk shadow-card opacity-0 scale-95 transition-all duration-100
                   group-hover:opacity-100 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:scale-100"
      >
        {text}
      </span>
    </span>
  );
}

/** Label text with a tooltip glued on — the common case, one import instead of two. */
export function LabelWithTip({ label, tip, className = '' }: { label: React.ReactNode; tip: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {label}
      <Tooltip text={tip} />
    </span>
  );
}
