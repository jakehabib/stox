# Build checklist

Every tool in the inventory, its route, status, and one verified calculation (example input → output). Each verified number is asserted in a unit test under `lib/calculations/`. **417 tests pass** (`npm test`).

Verification run on the production build (`npm run build && npm start`):
- 45 routes (all 38 tool pages, 6 section hubs and search) × 2 widths (1440 px and 390 px) = **90 page views**, each clicked through to its results screen. Every one returned 200 with no page errors, no NaN / Infinity / undefined in the rendered text, and no horizontal scroll.
- **19 calculators** had an input changed (+10%) and re-run. The output changed every time, with no invalid values.

Status key: **Built** = works to spec. **Reimagined** = clean rebuild of a legacy iframe. **Inferred** = partly not observable on the live site (see GAPS.md). **Display only** = intentionally inert per spec.

| Tool | Route | Status | Verified calculation |
|---|---|---|---|
| Dashboard | `/members/homepage` | Built | Locked-In Rates 30-Yr 7.25 / 15-Yr 6.5 / FHA 6.75 / VA 6.5 / Jumbo 7.75; 11 recent reports |
| Markets Overview | `/members/markets` | Built | Observed day [100.33 … 100.48] → Low 100.19, High 100.56, Prev 100.33, Current 100.48, Change +0.15 (15bp) |
| Economic Calendar | `/members/econ-calendar` | Built | Week of Oct 12 2026 → Mon Bond Market Closed; Tue Existing Home Sales / ADP; Wed Beige Book / CPI; Thu Retail Sales / Jobless Claims; Fri Capacity Utilization / Industrial Production |
| Morning Update | `/members/morning-update` | Built | 94 past updates, 8 per page; August filter → 21 |
| Market Wrap | `/members/market-wrap` | Built | Download → `market-wrap-2026-10-13.md` ("UMBS 30YR 6.5% close: 100.33 (+4bp)") |
| Mauldin: Thoughts from the Frontline | `/members/mauldin` | Built | 8 issues, Aug–Oct month filter, reading time |
| Barry's Insights | `/members/barrys-insights` | Built | 14 webinars, search + type + month filters |
| Strike Rate | `/members/strike-rate` | Built (Save display-only) | $350,000 → 0.75 · $350,001 / $806,499 → 0.5 · $806,500 → 0.375; 6-month EPO |
| Client Manager | `/members/client-manager` | Built | 101 clients → 7 pages ("1–15 of 101"); Add Client → "1–15 of 102" |
| Meet | `/members/meet` | Display only | "Highway Meeting"; Host disabled, creates nothing |
| Recordings | `/members/recordings` | Built | General 2 · Buy vs Rent 1 · Loan Comparison 2 · Markets Overview 1 · RERC 11 |
| Loan Comparison | `/members/loan-compare` | Built | $400k 6.5% vs 6.125%, 7 yr → $3,374 vs $3,276/mo (P&I $2,528 / $2,430; principal $566 / $593, interest $1,962 / $1,837); interest $174,040 vs $163,509 (−$10,531); equity $243,021 vs $245,335; balance $361,665 vs $359,352; Yr10 value $634,338 |
| Purchase Analysis | `/members/purchase-analysis` | Built | $500k Dallas → tax auto $9,206/yr (1.84%), ins $146; manual $8,400 → 1.68%; forecast 2.481%, historical 2.963%; no client → "Client name is required" |
| Cost of Waiting | `/members/cost-of-waiting` | Built | 12-mo wait, falling rates → benefit $16,336 = $20,000 + $336 − $4,000; total monthly 3,374 / 3,450 / 3,402; 1-yr rate 7.0% → benefit $23,216 (+$268/mo, $3,642/mo) |
| Buy vs Rent | `/members/buy-vs-rent` | Built | $500k, rent $2,800 +3%, custom 4% → Yr9 net gain $183,193 (appreciation $211,656, tax benefit $2,708, principal $52,883, cashflow −$45,588, cost to sell −$28,466); renting $348,060 vs buying $393,648; break-even Year 2 |
| Real Estate Report Card | `/members/rerc` | Built | Marlboro 07746 → median $940,915, DOM 82, forecast +4.67%/yr = $219,774 (23.36%), listings 71 (+122% Y/Y), income $128,386, index 90 |
| Appreciation | `/members/appreciation` | Built | $500k Dallas, 10 yr → $634,338 (+$134,338, +$13,434/yr); chart 541,664 / 582,853 / 596,940 / 611,772 / 634,338 |
| Equity Gained & Appreciation | `/members/equity-gained` | Built | $500k / $400k / 6.5%, 15 yr → equity $431,917 = $222,153 + $109,763 + $100,000; forecast 2.48% |
| Bid Over Ask | `/members/bid-over-ask` | Built | $500k ask + $25k → bid $525,000 (5%); 5-yr value $589,480, gain $64,480 (+12.28%); Yr0–5 −4.76% / −0.5% / +3.17% / +7.02% / +11.02% / +12.28% |
| House Price Index | `/members/house-price-index` | Built | National 0.35% qtr / 2.14% 1-yr; NJ 1.03% / 4.59% |
| Investment Property Analyzer | `/members/investment-property-analyzer` | Inferred (Step 2+) | $500k, 25% down at 7%, rent $4,200 → NOI $27,704, cap 5.54%, DSCR 0.93, 10-yr IRR 7.77% |
| MBEstimate | `/members/mbestimate` | Built | "Marlboro, NJ 07746" → unable to provide valuation; street address → estimate + range + comps |
| Debt Consolidation | `/members/debt-consolidation` | Built (no live results to compare) | Card $8k / $250 + auto $15k / $350 → refi loan $384,418 (76.9% LTV), $3,960 → $3,280/mo (−$681), DTI 31.7% → 26.2% |
| Payment Calculator | `/members/payment` | Built | $400k / 6.5% / 30 yr → $2,528.27; + $700 tax + $150 ins → $3,378.27; Yr9 paid $273,024, interest $220,170, principal $52,883, balance $347,117; Yr30 paid $910,080, interest $510,178 |
| ARM vs Fixed | `/members/arm-vs-fixed` | Built | $400k, 6.5% fixed vs 5.5% 7/1 worst case → $2,528 vs $2,271 (−$257); Yr7 $27,999 = $21,598 + $6,401; break-even 9y 1m (reinvest: $32,673, 10y 0m); Yr8 10.5%, $3,417 |
| Blended Rate | `/members/blended-rate` | Built | $400k @ 6.5 + $8k @ 22 + $15k @ 8 → $423,000 at 6.846% (6.5 → 6.804 → 6.846) |
| Refi Risk of Waiting | `/members/refi-cow-express` | Built | $400k 7.5% → 6.5% now vs 6.0% in 10 mo → delay costs $2,686; break-even 21 months |
| Reinvestment | `/members/reinvestment` | Built | $100k + $269/mo, 6%, 10 yr → $226,933; interest $94,653; contributions $132,280 |
| Affordability | `/members/affordability` | Built | $65k, $20k down, 7.5% → $204,298 (DTI 36%, $1,450/mo, cash to close $32,258); $150k → $518,760 ($4,000/mo, MI $362, cash to close $51,126) |
| Buying Power | `/members/buying-power` | Built | $400k @ 6.5% = $2,528 → $371k @ 7.25%, $380k @ 7%, $390k @ 6.75%, $395k @ 6.625%; 0% → $1,111/mo |
| Social Studio | `/members/social-studio` | Built | 43 scripts → 43 "View More"; Seasonal + Moving filter → 8 |
| Newsletter | `/members/newsletter` | Built | Oct 5 2026 "Fed Minutes, Home Prices and Market Volatility"; August → 3 issues |
| Social Share | `/members/social-share` | Built | 24 cards; Refinance chip → 3 |
| Prequalified Buyer Campaign | `/members/prequalified-buyer-campaign` | Built | 9/9 reports by default (10th disabled); every 3 days from Oct 15 → last on Nov 8 |
| Presentation Expressway | `/members/presentation-expressway` | Built | 9 presentations; "bid over ask" search → 1 |
| Open House Flyers | `/members/open-house-flyers` | Reimagined | $500k, 20% down @ 6.5% → $2,528.27 P&I, $3,378.27 total; 5% down → $4,113.57 with MI $261.25 |
| Seller Contribution | `/members/seller-contribution` | Reimagined | 2-1 buydown on $400k @ 6.5% → $6,018.37 + $3,085.39 = $9,103.76; $10k price cut → loan $392,000, P&I $2,477.71 |
| Agent Feed | `/members/agent-feed` | Inferred | $500k, 20% down, 7.125% → P&I $2,694.87, total $3,544.87 |
| Get Help | external | Link out only | Opens the help center in a new tab |
| Ask Miles | top bar / floating button | Placeholder | "Ask Miles — coming soon in prototype" |
