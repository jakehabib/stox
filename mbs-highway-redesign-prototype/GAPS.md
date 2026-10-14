# GAPS — where the prototype differs from the live site

The acceptance test was the Alex Rivera walkthrough of the live site. This file lists every place the prototype does **not** reproduce what was observed, every live-site quirk kept on purpose, and every behaviour that had to be inferred because the live session never showed it.

Scope exclusions (by rule, not gaps): admin areas, Optimal Blue / pricing engine, conversational Ask Miles, Get Help (links out), Learning Center (links out to becomecma.com).

## 1. Spec numbers the prototype does not reproduce

| Tool | Live / spec value | Prototype | Why |
|---|---|---|---|
| ARM vs Fixed | 30-yr "Paid": fixed $697,728, ARM $943,092 | $910,178 / $1,133,914 (true totals = interest + $400k principal) | $697,728 = $2,528 × 276 months, i.e. paid-to-date at **Year 23**, so the walkthrough most likely read the totals with the year slider at Yr23. $943,092 could not be traced. The 30-yr **interest** figures ($510,178 / $733,914) match exactly. |
| Bid Over Ask | "Value exceeds bid in 18.3 months" | 13.7 months | The live site's own chart puts $525,000 between Yr1 ($522,351) and Yr2 ($541,664), so 18.3 contradicts it. The prototype reads the crossing off the same curve it draws. (3.35% compounded = 17.8 mo; 2.96% = 20.1 mo; 18.3 needs a flat ~3.25%.) |
| Appreciation | ROI +126%, +13%/yr "on $108k invested" | +124%, +12%/yr | $134,338 ÷ $108,000 (down + closing) = 124.4%, which is what the label promises. The live 126% reproduces as (appreciation − closing) ÷ down payment = $126,338 ÷ $100,000; that formula is kept and tested (`roiNetOfClosingOnDownPct`) but not shown. |

Every other example number in BUILD_PROMPT.md is asserted in a unit test and reproduces to the displayed precision.

## 2. Live-site quirks preserved on purpose

- **Loan Comparison** insurance defaults to **$146/mo** (Dallas default) while Buy vs Rent uses **$150/mo**.
- **Appreciation** forms show the forecast as **2.481%**; Appreciation results show the effective 10-yr rate **2.41%**; Bid Over Ask uses its own 1-yr **4.47%** / 5-yr **3.35%** inputs.
- **Cost of Waiting** defaults to *falling* future rates (6.25% at 6 mo, 6.125% at 1 yr), editable.
- **Cost of Waiting** charges **$78/mo MI** in the 6-month column even though that loan is exactly 80% LTV (the live site appears to round past 80%). Kept as an editable default.
- **Equity Gained** chart samples the loan balance **one payment into each year** (after payment 12y+1: $399,638 … $289,280). The headline amortization uses the true year-end figure ($109,763).
- **Payment** schedule "Paid" column = whole-dollar payment × months (Yr30 $910,080 vs exact $910,178); footnoted under the table.
- **Reinvestment** credits the lump sum with **one extra period** of interest: FV = L(1+r)^(n+1) + P·((1+r)^n − 1)/r. This reproduces $226,933 to the cent. Labelled "MBS Highway convention"; the textbook result ($226,023) is one click away under *Calculation method → Standard*.
- **Buy vs Rent** monthly table splits principal/interest using the **last payment of each year** (payments 12, 60, 108), not the yearly average. That is what reproduces 384 / 2,145.
- **RERC**: the "+4.67%/yr" forecast is a *simple* average (23.36% ÷ 5); compounding 4.67% would give +$241,205. "Renters 141.3K (16%)" — 16% matches renters who *can't* afford to buy (105.7K / 650.5K); all renters are 21.7%. Affordability Index 90 is shown as data (the standard 20%-down formula gives ≈56 for Marlboro). All kept as shown.
- **House Price Index**: NJ is labelled **"20% above national avg"** in both views, as observed. The data says otherwise (1.03% vs 0.35% quarterly; 4.59% vs 2.14% one-year). Other states show the gap in percentage points.
- **Affordability** taxes + insurance ≈ **0.35% of price per year** (implied by the live outputs; far below Dallas's 1.84% county average). It is the default; Advanced offers "Location average" and "Custom $".
- **Buying Power** "Show all values" switch is disabled, as observed.
- **Dallas forecast curve**: two stored points are kept unrounded (Yr7 $604,686.4, Yr15 $722,153.45) so the equity totals land on the observed $245,335 and $431,917. Displayed values are unchanged.

## 3. Not observed live — built to spec or inferred

| Tool | What was missing live | What the prototype does |
|---|---|---|
| Debt Consolidation | "Add new debt" never created Debt 2; Proposed Loan and results were never reached, so **no live savings numbers exist**. | Full flow with N debts, Refinance and Move-Up tabs, LTV check, monthly before/after, DTI, the lifetime-interest tradeoff and savings reinvested. The existing home is labelled demo data (bought 2023-06-15 for $460k, $368k at 7.25%, now $500k). The remaining balance is computed from today's date. |
| Investment Property Analyzer | Only Step 1 (location, price) was seen. | Step 1 is faithful. Step 2+ (financing, rent, expenses, NOI, cap rate, cash-on-cash, DSCR, GRM, 1% rule, IRR) uses standard definitions and carries an "Inferred" badge. |
| MBEstimate | Town-level input returned "unable to provide valuation". | Same validation. A street address gets a deterministic mock AVM (estimate, range, confidence, comps, trend). |
| Agent Feed | Could not be loaded. | Mock feed cards with share-to-clipboard; badged "Inferred". |
| Open House Flyers / Seller Contribution | Legacy iframes. | Rebuilt clean and badged "Reimagined". Legacy menu items with no modern equivalent (Migrate, Retire) are disabled with a tooltip. |
| Strike Rate | Thresholds observed; savings logic not. | Tier boundaries were ambiguous in the spec: $350,000 is put in the 0.75 tier, $806,500 in the 0.375 tier. Savings = P&I on the current balance over the remaining term, closing costs excluded. Watchlist loans are mock. Save and Notifications are display-only, and the Missing NMLS ID warning always shows. |
| Cost of Waiting | Only the 12-month case was confirmed. | Cumulative payment difference = rounded monthly difference × months for 6/18/24 months too. 1.5-yr and 2-yr default rates are 6.0%. Refinance cost is an editable % (default 1%), applied only when the waiting rate is lower. Always uses custom 4% appreciation, including when opened from Purchase Analysis. |
| Loan Comparison | Reinvestment / co-branding "Add" panels not explored. | Reinvestment = each option's monthly savings vs the costliest option, invested at an editable return. Co-branding Add attaches a demo partner agent. Loan type is Fixed only. |
| ARM vs Fixed | Only worst case observed. | Best case floors at a 2.75% margin. Custom path = fully indexed rate moving toward index + margin within caps. 6-month adjustments apply the annual cap per adjustment. APR is display-only. Client is required. |
| Reinvestment | Only monthly frequency observed. | Quarterly and yearly compound once per contribution period. |
| Refi Risk of Waiting | No refi term field seen. | Refi term fixed at 30 years. |
| Buy vs Rent | BAH lookup and tax tables not observed. | BAH rates, state income-tax defaults and 2026 brackets are demo values. Tax benefit = 22% × (interest + property tax − $32,200 standard deduction), which reproduces $2,708. APR is display-only. |
| Equity Gained | — | "Program" is a label only (no MI modelled). Loan type is Fixed only. |
| Client Manager | — | Delete is disabled (destructive). Quick actions open each tool with the default Alex Rivera scenario; tools don't read a `?client=` parameter yet. |
| Meet / Recordings | Host not used. | Host is display-only and creates no meeting. Recordings have no media; rename and move are saved only in this browser. |
| Markets / content | — | All quotes, curves, indicators and articles are synthetic. Calendar and content use a fixed demo clock (Wed Oct 14 2026, 10:00 ET). The top-bar ticker uses the real clock via the market adapter. |
| Marketing | Nothing was sent in the live session. | All content is original synthetic text. Every send, post or launch is a preview, copy or download, labelled "Prototype — nothing was sent". |

## 4. Prototype-wide limitations

- State lives in `localStorage` (clients, saved scenarios, co-branding). Clearing site data resets to the 101 demo clients.
- Video players are UI-only ("Demo video — playback not included").
- Print uses the browser's print dialog with print styles; there is no server-rendered PDF.
- The market ticker, MBS chart and every real-estate figure come from `data/mock/` adapters (see README → *Plugging in real APIs*).
