import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#07090d',
        surface: '#0e1117',
        card: '#141922',
        raised: '#1b212c',
        line: '#242c39',
        muted: '#8b96a8',
        chalk: '#e8edf5',
        accent: '#4ade80',
        accent2: '#38bdf8',
        warn: '#fbbf24',
        bad: '#f87171',
        gold: '#eab308',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Inter', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 24px -12px rgba(0,0,0,0.8)',
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
