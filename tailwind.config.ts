import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Neutral graphite instead of the previous blue-black — reads like a
        // stadium at night rather than a crypto-dashboard gradient.
        ink: '#0a0a0b',
        surface: '#111113',
        card: '#18181b',
        raised: '#202024',
        line: '#2d2d32',
        muted: '#93939c',
        chalk: '#f3f2ec',
        accent: '#4ade80',
        accent2: '#38bdf8',
        warn: '#fbbf24',
        bad: '#f87171',
        gold: '#eab308',
        // Analytics categorical palette (dark-mode steps), validated against
        // this app's card surface with the dataviz skill's CVD checker —
        // fixed order, never cycled/reassigned per chart. viz-good/viz-bad
        // are the diverging pair for over/underpaid-style value scales.
        viz1: '#3987e5', viz2: '#d95926', viz3: '#199e70', viz4: '#c98500',
        viz5: '#d55181', viz6: '#008300', viz7: '#9085e9', viz8: '#e66767',
        vizGood: '#3987e5', vizBad: '#e66767',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Inter', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        // Bold condensed display face for headings/nav — see app/layout.tsx.
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 6px 16px -10px rgba(0,0,0,0.7)',
        // Genuinely elevated surfaces only — open menus/popovers, the "on
        // the clock" draft state — not every panel. Reach for `card` first.
        elevated: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 16px 40px -12px rgba(0,0,0,0.75)',
      },
      // Stat-number scale — big sports numbers (OVR, records, cap space)
      // get sizes distinct from the body type scale. Always pair with the
      // .stat-value class (globals.css) for the display face + tabular figures.
      fontSize: {
        'stat-sm': ['1.25rem', { lineHeight: '1', letterSpacing: '-0.01em' }],
        'stat-md': ['1.75rem', { lineHeight: '0.95', letterSpacing: '-0.01em' }],
        'stat-lg': ['2.75rem', { lineHeight: '0.9', letterSpacing: '-0.015em' }],
        'stat-xl': ['4rem', { lineHeight: '0.88', letterSpacing: '-0.02em' }],
      },
      keyframes: {
        fadeUp: { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: { fadeUp: 'fadeUp .25s ease-out both' },
    },
  },
  plugins: [],
};
export default config;
