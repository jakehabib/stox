import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        // Brand: MBS Highway purple, deep navy chrome.
        brand: {
          50: '#f4f2ff',
          100: '#ebe7ff',
          200: '#d9d1ff',
          300: '#bcadff',
          400: '#9b7eff',
          500: '#7c4dff',
          600: '#6a2ff2',
          700: '#5a21d6',
          800: '#4b1db0',
          900: '#3e1a8f',
          950: '#26105c',
        },
        ink: {
          950: '#0b1020',
          900: '#111833',
          800: '#1a2347',
          700: '#27325c',
        },
        gain: '#0f9d6b',
        loss: '#d93a3a',
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)',
        lift: '0 8px 24px -8px rgba(16,24,40,.18)',
      },
    },
  },
  safelist: ['text-left', 'text-right', 'text-center'],
  plugins: [],
};
export default config;
