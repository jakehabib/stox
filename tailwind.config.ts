import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // STADIUM NIGHT. The neutral graphite this replaced read as "dark
        // SaaS"; every step below carries a blue cast, because a stadium at
        // night is lit blue-white and photographs blue-black, not grey. The
        // ramp is also deliberately DEEPER than the graphite one — ink is
        // near-black so the field grid and the club rail have somewhere to
        // sit — which buys contrast headroom on every light-on-dark pair.
        ink: '#070a0f',
        surface: '#0c111a',
        card: '#111925',
        raised: '#1b2634',
        // `line` is markedly lighter than the graphite #2d2d32 it replaces.
        // Stadium Night is a FLAT skin — the shadows that used to separate
        // one plate from the next are gone (see .card/.panel in globals.css),
        // so the border is doing that work alone and has to be visible at 1px.
        line: '#2e3d51',
        // muted/chalk are both lifted. Every text pair in the app is
        // light-on-dark, so raising the light end and dropping the dark end
        // moves in the same direction: `muted` on `card` measures 8.35:1 here
        // against 5.52:1 before, which is what pays for the denser type scale.
        muted: '#a3b4c8',
        chalk: '#eef4fb',
        accent: '#3ddc84',
        accent2: '#63cbff',
        warn: '#ffc043',
        bad: '#ff8383',
        gold: '#ffd24a',
        // Text colours for the two bright fills that carry DARK type — the
        // warn/gold chip and the accent2 chip (components/ds/ResultWeight).
        // These were arbitrary `text-[#04202e]` classes sitting outside the
        // token layer, so a palette change reached the fill and not the ink
        // on top of it. Named, so the pair moves together.
        onAccent2: '#04202e',
        onGold: '#1a1200',
        // Analytics categorical palette, re-keyed for Stadium Night: the
        // graphite-era steps were mixed for a #18181b plate and go muddy on
        // the deeper #111925 one. Same hue order — identity, not value-rank,
        // drives the colour per the dataviz skill's categorical rule — lifted
        // in lightness and chroma so eight fills stay separable on the darker
        // card. Fixed order, never cycled/reassigned per chart.
        viz1: '#5fa8f5', viz2: '#f0793f', viz3: '#37c48f', viz4: '#e3a92b',
        viz5: '#f078a4', viz6: '#39b859', viz7: '#a89cff', viz8: '#ff8f8f',
        // A ninth step, for the one categorical scale that needs nine: the
        // cap page's nine position groups. It used to reach past the palette
        // for a raw hex; this is that slot, mixed in the same key as the rest.
        viz9: '#b48ce0',
        vizGood: '#5fa8f5', vizBad: '#ff8f8f',
      },
      fontFamily: {
        // IBM Plex Sans for body and IBM Plex Mono for figures — see
        // app/layout.tsx. Plex is a grotesque drawn for dense technical
        // reading; the system stack it replaces varied by platform, which is
        // the one thing a 13px table cannot afford. Both keep the full system
        // fallback so a blocked font request degrades rather than breaks.
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        // Oswald: a narrower, flatter-shouldered condensed than the Barlow
        // Condensed it replaces, which is what makes an uppercase nav item
        // and a stat number read as stadium signage rather than as a webfont.
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      // Stadium Night is a hard-edged skin: 2px everywhere a plate meets the
      // page, so the club rail and the notched corner (globals.css) have a
      // square enough corner to sit against. `full` is untouched — pills,
      // crests and the slider thumb are still circles.
      borderRadius: { md: '2px', lg: '2px', xl: '3px', '2xl': '4px' },
      boxShadow: {
        // Flat plates. The old card shadow was a 16px drop that made every
        // panel hover above the page; here separation is the border plus the
        // club rail, and the only remaining shadow is a 1px top highlight
        // that reads as a bevel under stadium light.
        card: '0 1px 0 0 rgba(255,255,255,0.05) inset',
        // Genuinely elevated surfaces only — open menus/popovers, the "on
        // the clock" draft state — not every panel. Reach for `card` first.
        // Kept deep, and now much darker than the plate, because on a
        // near-black page a soft grey shadow is invisible.
        elevated: '0 18px 44px -22px #000, 0 1px 0 0 rgba(255,255,255,0.08) inset',
      },
      // The container is wider than the 80rem `7xl` default. Stadium Night is
      // a dense skin — smaller type, tighter table rows — and at 80rem the
      // roster and cap boards had gone from full to half-empty. 90rem is what
      // keeps a 20-column board reading as a board on a 1440 screen.
      maxWidth: { '7xl': '90rem' },
      // Stat-number scale — big sports numbers (OVR, records, cap space)
      // get sizes distinct from the body type scale. Always pair with the
      // .stat-value class (globals.css) for the display face + tabular figures.
      // Every step is LARGER than the graphite scale even though the body
      // type shrank: that widening gap is the skin's whole hierarchy, and
      // Oswald is narrow enough to spend it. stat-xl and text-3xl are clamps
      // rather than fixed rems because at their fixed sizes a long club name
      // was what pushed the 390px handset sideways.
      fontSize: {
        xs: ['11.5px', { lineHeight: '1.35' }],
        sm: ['12.5px', { lineHeight: '1.4' }],
        base: ['13.5px', { lineHeight: '1.4' }],
        '3xl': ['clamp(1.6rem, 5.4vw, 2.35rem)', { lineHeight: '0.95' }],
        'stat-sm': ['1.5rem', { lineHeight: '0.95', letterSpacing: '0' }],
        'stat-md': ['2.15rem', { lineHeight: '0.92', letterSpacing: '0' }],
        'stat-lg': ['2.75rem', { lineHeight: '0.9', letterSpacing: '-0.005em' }],
        'stat-xl': ['clamp(2.9rem, 11vw, 4.6rem)', { lineHeight: '0.85', letterSpacing: '-0.01em' }],
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
