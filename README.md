# ClaudeStocks

An AI-powered stock research and portfolio tracking app built with Next.js 14, Tailwind, Polygon.io, the Anthropic Claude API, and Supabase.

## Features

- **Ticker tape** scrolling across the top of every page
- **Claude Portfolio** — 8 stocks Claude picked, with live returns
- **Stock Scanner** — ticker + focus-area picker → Claude-generated analysis
- **Earnings Feed** — recent reports with on-demand AI analysis

## Setup

1. `cp .env.example .env.local` and fill in:
   - `POLYGON_API_KEY` (and `NEXT_PUBLIC_POLYGON_API_KEY` mirror)
   - `ANTHROPIC_API_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` (optional — the app falls back to a seed portfolio if Supabase isn't configured)

2. Install dependencies:

   ```sh
   npm install
   ```

3. (Optional) Apply the Supabase schema in `supabase/schema.sql` and the seed in `supabase/seed.sql` against your project.

4. Run the dev server:

   ```sh
   npm run dev
   ```

## File map

- `app/layout.tsx` — root layout, ticker tape, top nav
- `app/page.tsx` — dashboard
- `app/portfolio/page.tsx` — portfolio view
- `app/scanner/page.tsx` — Claude-powered scanner
- `app/earnings/page.tsx` — earnings feed
- `app/api/ticker-prices/route.ts` — live snapshots for the ticker tape
- `app/api/portfolio/route.ts` — portfolio + enriched live prices
- `app/api/scan/route.ts` — Claude analysis on a real Polygon quote
- `app/api/earnings/route.ts` — earnings list (cached AI analysis when available)
- `app/api/earnings/analyze/route.ts` — generate + cache AI analysis for one report
- `lib/polygon.ts` — Polygon.io helpers
- `lib/claude.ts` — Anthropic SDK wrapper with structured prompts
- `lib/supabase.ts` — Supabase client + seed portfolio fallback
