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
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Inter', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        // Bold condensed display face for headings/nav — see app/layout.tsx.
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 6px 16px -10px rgba(0,0,0,0.7)',
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
