/**
 * ===========================================================================
 * ICON LANGUAGE
 * ===========================================================================
 * One consistent line-icon style, hand-drawn as inline SVG — no icon font or
 * emoji. 24x24 viewBox, 1.75 stroke, round caps/joins, currentColor so an
 * icon can sit in team-accent, muted, or active nav color without a variant
 * per color. Add new icons here rather than reaching for an emoji anywhere
 * in the product.
 * ===========================================================================
 */
interface IconProps { className?: string; size?: number }

const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function IconHome({ className, size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9h12v-9" />
      <path d="M10 19v-5h4v5" />
    </svg>
  );
}

export function IconShield({ className, size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 3.5 19 6v6c0 5-3 8.2-7 9.5-4-1.3-7-4.5-7-9.5V6Z" />
    </svg>
  );
}

export function IconTrophy({ className, size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 5.5H4v1.5a3.5 3.5 0 0 0 3.5 3.5" />
      <path d="M17 5.5h3v1.5a3.5 3.5 0 0 1-3.5 3.5" />
      <path d="M12 14v3" />
      <path d="M8.5 20.5h7" />
      <path d="M9.5 17.5h5l.5 3h-6l.5-3Z" />
    </svg>
  );
}

export function IconSwap({ className, size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 8h13" />
      <path d="M14 4.5 17.5 8 14 11.5" />
      <path d="M20 16H7" />
      <path d="M10 12.5 6.5 16 10 19.5" />
    </svg>
  );
}

export function IconMore({ className, size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base} strokeWidth={0}>
      <circle cx={5} cy={12} r={1.6} fill="currentColor" />
      <circle cx={12} cy={12} r={1.6} fill="currentColor" />
      <circle cx={19} cy={12} r={1.6} fill="currentColor" />
    </svg>
  );
}

export function IconStar({ className, size = 20, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base} fill={filled ? 'currentColor' : 'none'}>
      <path d="m12 4 2.4 5.1 5.6.7-4.1 3.9 1 5.6-4.9-2.7-4.9 2.7 1-5.6-4.1-3.9 5.6-.7Z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconClock({ className, size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx={12} cy={12} r={8.25} />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function IconChevronRight({ className, size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}
