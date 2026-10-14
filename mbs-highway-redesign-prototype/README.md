# MBS Highway — Redesign Prototype

A functional, pitch-ready rebuild of every user-facing MBS Highway tool. Each calculator really calculates, and every chart, table, export, share link and edit modal works. All data is synthetic and labeled **Demo Data** in the UI.

> Standalone app, isolated from the rest of this repository (the root `tsconfig.json` excludes this folder). Admin areas and Optimal Blue are out of scope and were never touched.

## Run it

```bash
cd mbs-highway-redesign-prototype
npm install
npm run dev          # http://localhost:3100  → redirects to /members/homepage
npm test             # vitest — all calculation unit tests
npm run typecheck    # tsc --noEmit
npm run build        # production build
```

Node 18.17+ (built on Node 22).

## Two-minute demo path

Every tool is reachable from the dashboard in one or two clicks: the sidebar, the **Switch tool…** combobox above every page, or global search (⌘-free: just click *Search for tools & resources…*). Every calculator opens pre-filled with the shared **Alex Rivera** scenario, so results show immediately:

1. **Start the day:** Dashboard → Markets → Economic Calendar → Morning Update → Strike Rate
2. **Client meeting:** Real Estate Report Card → Purchase Analysis / Buy vs Rent → Loan Comparison → Cost of Waiting → Appreciation → Equity Gained → Debt Consolidation
3. **Follow-up:** Social Studio → Newsletter → Social Share → Prequalified Buyer Campaign → Presentation Expressway

Each result has a collapsible **LO talk track** (not printed) built from the live numbers on screen.

### Shared test scenario

Alex Rivera · alex.rivera.test@example.com · (555) 555-0142 — $500,000 home, 20% down ($100,000), $400,000 loan at 6.5% 30-yr fixed, tax $8,400/yr, insurance $150/mo (Dallas default $146 in Loan Comparison, preserved as observed), HOA $0. Location defaults to Dallas, TX 75201; RERC defaults to Marlboro, NJ 07746. Reports are co-branded for Jake Habib, NMLS# 12345 (edit from any report footer).

## Route map

ROUTE_MAP_PLACEHOLDER

Section hubs: `/members/market-analysis`, `/members/clients`, `/members/loan-comparison-tools`, `/members/real-estate`, `/members/calculators`, `/members/marketing`.

**Not built as separate tools (by design):** Email Campaigns (= Newsletter + Prequalified Buyer Campaign + per-report Email), Daily Sharable Social Content (= Social Share / Social Studio), Property Comparison (= Loan Comparison), Community Report (= RERC), Home Appreciation Map (= House Price Index), Learning Center (= *Become a CMA* card linking out to becomecma.com). **Get Help** links out to the external help center. **Ask Miles** is a placeholder button.

## What's real vs. mock

| Layer | Status |
|---|---|
| Mortgage math (`lib/calculations/`) | **Real.** Pure, unit-tested functions; components contain no math. |
| Clients, saved scenarios, co-branding | Prototype store (`lib/store.tsx`) persisted to `localStorage`. 101 synthetic clients. |
| Market ticker, MBS chart, quotes, treasury curve | **Mock adapter** — `data/mock/market.ts`, `data/mock/markets.ts`. Deterministic random walk; never hard-coded "current" values. |
| Locations, tax rates, insurance, appreciation forecasts | **Mock** — `data/mock/locations.ts` (Dallas forecast curve reproduces the observed live outputs). |
| RERC market data, HPI, AVM (MBEstimate), MI tables | **Mock** — `data/mock/*.ts`. |
| Articles, newsletters, scripts, presentations, videos | **Synthetic** original text; video players are UI-only. |
| Email / share / campaign / meeting | **Never sent.** Email opens a preview (copy or open in your mail app); Share copies a URL that encodes the scenario; campaigns and meetings are display-only. |

## Plugging in real APIs

Each data source sits behind a small module with a typed return shape, so production wiring is a body swap:

- **Market data** — replace `getMarketSnapshot()` / `getMbsIntraday()` in `data/mock/market.ts` (and the series generators in `data/mock/markets.ts`) with your feed; keep the `MarketSnapshot` / `IntradayPoint` shapes. The top bar polls every 30 s.
- **Geocoding + county defaults** — replace `searchLocations()` / `getLocation()` in `data/mock/locations.ts`. A location needs tax rate, default insurance, and a yearly `forecastIndex` from the appreciation provider.
- **Real estate (RERC / HPI / AVM)** — swap the exports in `data/mock/rerc.ts`, `data/mock/hpi.ts`, `data/mock/avm.ts` for API calls (FHFA HPI is public).
- **Clients & scenarios** — every mutation goes through `useStore()` (`addClient`, `updateClient`, `saveScenario`, `setCobranding`); point those at your backend.
- **Email** — `EmailModal` in `components/calc/ResultsHeader.tsx` is the single send point.

## Project layout

```
app/members/<tool>/page.tsx      route (server: metadata) → components/tools/<tool>/…
components/ui.tsx                design-system primitives
components/calc/                 CalculatorShell, ResultsHeader, ReportFooter, PropertyEditor,
                                 ClientPicker, ChartCard, ComparisonTable, Stepper, TalkTrack
components/shell/AppShell.tsx    top bar (ticker, search, notifications), sidebar, tool switcher
lib/calculations/                all math + *.test.ts
lib/format.ts                    currency / percent / date formatting
lib/tools.ts                     tool registry (sidebar, search, switcher, hubs)
data/mock/                       every demo dataset
```

See **GAPS.md** for everything that differs from the live site and why.
