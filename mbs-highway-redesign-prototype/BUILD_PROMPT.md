# MBS Highway — Full Redesign Prototype (Pitch Build)

Rebuild a FUNCTIONAL version of EVERY user-facing tool in MBS Highway as a modern, pitch-ready prototype. Demoable end-to-end. Not mockups.

## HARD RULES — NON-NEGOTIABLE

1. **NEVER TOUCH ANYTHING ADMIN. NEVER.**
   Admin = /admin, /manage, /internal, user management, billing, enterprise/company admin, permissions/roles, CMS admin, API keys, or any page labeled Admin / Manage Users / Manage Company. If unsure, treat as admin: SKIP, do NOT open, log as `Skipped - suspected admin`.
   Do NOT escalate privileges, bypass auth, or access data a normal LO wouldn't see. Read-only on live site. Never write/edit/delete on production.
2. **SKIP Optimal Blue entirely.** No pricing-engine pages, no Optimal Blue integrations, no details. Out of scope, same as admin.
3. **Build ONLY in `./mbs-highway-redesign-prototype/`** — do not modify existing repo. Use ONLY synthetic/mock data. No real borrower/client data. No real API keys.
   If a tool needs live data (MBS prices, rates, real estate), build a clean `data/` adapter with realistic mock data clearly labeled "Demo Data" in UI, so real APIs can plug in later.
4. **No placeholders.** Every tool must actually work. Inputs must calculate, filter, chart, export. A pretty shell = failure.
5. **Do NOT replicate bugs.** Tooltips covering inputs, Points field obscured, Next lagging, etc. were live-site quirks — rebuild with clean UX.

## CONSISTENT TEST SCENARIO — USE FOR ALL CALCULATORS

Fake client: Alex Rivera, alex.rivera.test@example.com, (555) 555-0142
Home: $500,000, Down 20% ($100,000), Loan $400,000, 6.5% fixed 30-yr
Tax $8,400/yr ($700/mo), Insurance $1,800/yr ($150/mo), HOA $0
Cost of Waiting: 4% appreciation, wait 12mo, future rate 7.0%
Buy vs Rent: rent $2,800/mo, rent inflation 3%
Debt Consolidation example: $8,000 card at 22% ($250/mo) + $15,000 auto at 8% ($350/mo)
Co-branding on all reports: Jake Habib, NMLS# 12345, MBS Highway, Cell (732) 865-6551, Direct (732) 526-7900, jake@mbshighway.com, 960 Holmdel Road, Holmdel, NJ 07733

DISCREPANCIES TO PRESERVE AS-IS (do not reconcile):
- Loan Comparison auto-set insurance to $146/mo (Dallas default) vs $150/mo in Buy vs Rent final edit
- Appreciation forecast shown as 2.481% in forms, 2.41% in Appreciation results, Bid Over Ask uses different model (1-yr 4.47%)
- Most calculators default location Dallas, TX 75201; RERC used Marlboro, NJ 07746
- Market ticker moves — do NOT hardcode ticker values as current. Use mock/live adapter.

## GLOBAL APP STRUCTURE TO REBUILD

Base pattern: `/members/<tool>`

Top bar (all pages): UMBS 30YR 6.5% price + bp change, 10Y UST yield + bp change, global Search combobox "Search for tools & resources…", Help, Notifications, Ask Miles AI (bottom-right, do NOT build conversational AI — just a button placeholder that says "Ask Miles — coming soon in prototype")

Left sidebar: Home, Market Analysis, Clients, Strike Rate, Loan Comparison, Real Estate, Calculators, Marketing, Agent Feed, Get Help

Top tool-switcher combobox above main content switches tools (Loan Comparison, Purchase Analysis, Reinvestment, Prequalified Buyer Campaign, Client Manager, etc.)

Shared property editor (Loan Comparison / Purchase Analysis / Cost of Waiting / Buy vs Rent / Appreciation / Equity): Location combobox, Price, Appraised Value switch, Property Tax Monthly/Annual + Fee/Percentage toggle + Reset to county average, Monthly Home Insurance + Reset to default, Monthly Association Fee, Appreciation Forecast/Historical/Custom radios, Add alternate price, Add new location, Next / stepper.

Client combobox required on most calculators. If selecting existing client triggers conflict dialog, offer "Keep what I entered" vs "Use saved data".

Common result header on all calculator results: Back / Print / Email / Save / Share + Client (Edit) + Property (Edit) + Loan (Edit) + Co-branding block + "Current as of [date]. Disclaimer goes here" + standard disclaimer.

## LO WORKFLOW — BUILD IN THIS ORDER

An LO starts the day on Dashboard/Markets, then runs the client meeting in this order, then does marketing follow-up. Your nav and demo flow must support this:

1. Dashboard → Markets → Economic Calendar → Morning Update → Strike Rate
2. Real Estate Report Card → Purchase Analysis / Buy vs Rent → Loan Comparison → Cost of Waiting → Appreciation → Equity Gained → Debt Consolidation
3. Other calculators as needed → Marketing follow-up (Social Studio, Newsletter, Social Share, Prequalified Buyer Campaign, Presentation Expressway)

## PHASE 1 — INVENTORY (verify, do not trust blindly)

Build ALL of these. If a name below doesn't exist in live site, mark Not Found. If you find extra tools, ADD them.

Dashboard, Markets Overview, Economic Calendar, Morning Update, Market Wrap, Mauldin: Thoughts from the Frontline, Barry's Insights, Client Manager, Meet (show "Highway Meeting" only, do NOT create meeting), Recordings, Strike Rate, Loan Comparison, Purchase Analysis, Cost of Waiting, Buy vs Rent, Real Estate Report Card, Appreciation, Equity Gained & Appreciation, Bid Over Ask, House Price Index, Investment Property Analyzer, MBEstimate, Debt Consolidation, Payment Calculator, ARM vs Fixed, Blended Rate, Refi Risk of Waiting, Reinvestment, Affordability, Buying Power, Social Studio, Newsletter, Social Share, Prequalified Buyer Campaign, Presentation Expressway, Open House Flyers, Seller Contribution

NOT separate tools (do NOT build as separate): Email Campaigns (= Newsletter + Prequalified Campaign + per-report Email), Daily Sharable Social Content (= Social Share / Social Studio), Property Comparison (= Loan Comparison), Community Report (= RERC), Home Appreciation Map (= House Price Index), Learning Center in-app (= external becomecma.com link from Dashboard "Become a CMA" card — link out only, do NOT build enrollment/purchase).

## TOOL SPECS — EXACT INPUTS / OUTPUTS / EXAMPLE NUMBERS

### Dashboard / Home — /members/homepage
View-only. Daily Mortgage Market Update video + article, Market News ticker, Quick-access cards (Loan Comparison, Cost of Waiting, RERC, Buy vs Rent, Appreciation, Refinance, Investment Property Analyzer, House Price Index, Calculators), Recently Used Reports (11 entries), Recommended Content, Upcoming Payments (0), Recent Activity (none), Resources (Training Webinars, Become a CMA card → becomecma.com, MBS Highway Articles), Locked-In Rates panel (example observed: 30-Yr 7.25%, 15-Yr 6.5%, FHA 6.75%, VA 6.5%, Jumbo 7.75% — label as Locked-In Rates, NOT the client's rate).

### Markets Overview — /members/markets
Inputs: Timeframe buttons 1D 5D 1M 3M 6M 1Y; Create New.
Outputs: MBS intraday chart (example: low 100.19, high 100.56, close 100.33, current 100.48, Change 0.15), UMBS/10Y quotes, Bonds/Stocks/Commodities/Currencies tables, Treasury Curve, Economic Reports Today/This Week, Upcoming Events, Today's Articles, My Market Insights, Recent Morning Updates, Recent Market Wraps.
LO script: "Bonds are [ticker at meeting time]. Locked-in rates this morning were around 7.25% for 30-yr fixed — your 6.5% example is favorable for comparison."

### Economic Calendar — /members/econ-calendar
Week Mon-Fri grid, prev/next buttons. Week Oct 12-16 2026 example: Mon Bond Market Closed; Tue Existing Home Sales / ADP; Wed Beige Book / CPI; Thu Retail Sales / Jobless Claims; Fri Capacity Utilization / Industrial Production.

### Morning Update / Market Wrap / Mauldin / Barry's Insights
Morning Update: video player, article, Past Daily Update list, month combobox, View more. Market Wrap: article + Download. Mauldin: long-form newsletter, month filter. Barry's Insights: video webinar archive, month filter. Summarize content only, no long quotes.

### Strike Rate — /members/strike-rate (lock-alert / refi-opportunity tool)
Missing NMLS ID warning. Today's Estimated Fixed Market Rates (30yr/FHA/VA/Jumbo/15yr). Strike Rate Target Hits: Early Payoff Period 6 months; thresholds Below $350k 0.75, $350,001–806,499 0.5, Above $806,500 0.375. Save button (do NOT make functional in prototype — display only), Notifications toggle disabled, Tutorial Video, Guide. LO does NOT change thresholds.

### Client Manager — /members/client-manager
Client name search combobox, Add Client, pagination 15/page, 101 rows / 7 pages. Table: Client / Updated / Last Sent / Last Client Activity. Add Client form: Name (required), Primary Email, Secondary Email, FICO combobox default 720–739, Monthly Qualifying Income, Debt-to-Income, Cancel, Add.

### Loan Comparison — /members/loan-compare
**This is the core tool. Build fully.**
Inputs: Property editor → Loan Options step → Results. Results: Edit client, LOCATIONS accordion, LOAN OPTIONS accordion (Edit/Duplicate/Delete per loan, Add loan, Drag to reorder), REINVESTMENT STRATEGY Add, CO-BRANDING Add, CUSTOM MESSAGE Add, holding slider "How long does your client plan on owning their home?" (note: per NAR avg residency is 10 years), Financial Snapshot tabs Monthly Payment / Total Cost / Equity Impact, Detailed Comparison table (View Amortization, Add Reinvestment per loan), View all.
Add New Loan form (MANUAL entry, NO pricing engine): Down Payment, Fee/Percentage toggle, Term, Program Conventional, Loan Type Fixed, Rate, APR, Points, Monthly MI, Total Loan Amount, Edit Closing Costs / Credits / Prepaid / Points Buydown, Edit/Cancel/Add.
EXAMPLE — Build these 2 options and verify these exact numbers:
Option 1: 30-yr Fixed 6.5%, 0 Pts, $400k. Holding 7yr Monthly view: Principal $566, Interest $1,962, HOA/Ins $146, Taxes $700, Total $3,374/mo. P&I $2,528. Detailed: Purchase $500k, Loan $400k, APR 6.5, Total Monthly $3,374, Cash to Close $100,000.
Option 2: 30-yr Fixed 6.125%, 0 Pts, $400k. Holding 7yr: Principal $593, Interest $1,837, Ins $146, Taxes $700, Total $3,276/mo (saves $98/mo). P&I $2,430, APR 6.124%, Cash to Close $100,000.
Total Cost tab (7yr): Option 1 Interest $174,040 Total $174,040; Option 2 Interest $163,509 Total $163,509 Diff $10,531 savings.
Equity Impact tab (7yr, Projected Value Yr10 $634,338 +$134,338): Option 1 Principal Paid $38,335, Appreciation $104,686, Down $100k, Total Equity $243,021, Balance $361,665. Option 2 Principal $40,648 (+$2,313), Total Equity $245,335 (+$2,314), Balance $359,352.
Header: "Hi, Alex Rivera! Here is your True Cost Comparison." + badges LOWEST MONTHLY PAYMENT / LOWEST TOTAL CASH TO CLOSE / LOWEST COST LOAN.
LO script: "6.125% wins on payment, total cost, and equity with same cash to close. Tradeoff: lower rate usually comes with points or different lock — if you move/refi in under ~5yr, higher-rate/no-cost can win. In this example both show 0 points, so treat Option 2 as a lower-rate quote to verify."

### Purchase Analysis — /members/purchase-analysis (wizard)
Wizard steps: PROPERTY INFO > LOAN OPTIONS > COST OF WAITING > CO-BRAND (stepper-back / stepper-next-step). Same $500k / $400k / 6.5% Option 1. Property editor: Price $500k → Insurance auto $146/mo, Tax auto $9,206/yr (1.84% Dallas); allow manual Tax to $8,400/yr (1.68%). Forecast appreciation 2.481% (Dallas), Historical 2.963%. Client required; Next shows "Client name is required" if missing. Wizard COST OF WAITING step is ONLY "Select loan to compare" radio OPTION1, no numbers — do NOT confuse with standalone COW tool. CO-BRANDING step: Add/Edit co-branding, Save.

### Cost of Waiting (standalone) — /members/cost-of-waiting
Inputs: Property, Loan Options, Edit Waiting modal (Price, Rate, Closing).
CRITICAL: Tool defaults to FALLING future rates: 6.25% at 6mo, 6.125% at 1yr. Preserve this behavior but allow editing.
Default curve, 12mo wait: Benefit of Buying Now $16,336 = Appreciation $20,000 + Cumulative payment diff $336 − Refinance $4,000. Property in 1yr $520,000 (+4%). Payment diff Monthly +$28, Cumulative $336 (Now $3,374/mo vs Waiting $3,402/mo). Table Today vs 6mo vs 1yr: Property 500k / 509,902 (+1.98%) / 520k; Loan 400k / 407,922 / 416k; Down 100k / 101,980 / 104k; Rate 6.5% / 6.25% / 6.125%; APR 6.5 / 6.269 / 6.124; MI 0 / $78 / 0; Annual P&I 30,339 / 30,140 / 30,332; Monthly P&I 2528 / 2512 / 2528; Total Monthly 3374 / 3450 / 3402; Total Annual 40,491 / 41,396 / 40,820; Cash to Close 100k / 101,980 / 104k. Waiting presets: 6mo $407,922, 1yr $416,000, 1.5yr $424,238, 2yr $432,640.
After editing Waiting 1yr Rate to 7.0%: Benefit $23,216 = Appreciation $20,000 + Cumulative $3,216. Monthly diff +$268, Cumulative $3,216, Waiting P&I $2,768/mo, Annual $33,212, Total Monthly $3,642, Total Annual $43,700.
LO script: "Even if rates FALL to 6.125%, waiting costs $16,336 — house gets $20k more expensive. If rates rise to 7%, waiting costs $23,216."

### Buy vs Rent — /members/buy-vs-rent
**Must hit Calculate / Next to see results. No separate Calculate on Step 1 — Next auto-calculates.**
Inputs: Step 1 Mode buttons Purchase Price / Desired Monthly Payment / Military BAH (BAH shows Monthly Allowance / Find allowance), Client (required), Location, Purchase Value, Next. Results header: Back / Print / Email / Save / Share; Client Alex Rivera (Edit); Property $500k Dallas TX 75201 (Edit); RENTING $2,800/mo (Edit); LOAN $400k 30yr (Edit); TAX $32,200 (Edit); "Scenario auto-saved".
Edit modals: Property Edit (Purchase Price, Appraised Value, Tax Annual auto $9,206 / 1.84% Dallas, Annual increase 2%, Insurance Monthly auto $146, Association 0, Repairs $208/mo, Cost to Sell 4%, Appreciation Forecast/Historical/Custom, Add co-branding). Loan Edit (Loan Amount, Program Conventional, Term 30yr, Rate, APR, Closing, Points, MI). Renting Edit (Monthly Rent, Renters Insurance, Annual Rent Increase). Tax Edit (Filing Status Married filing jointly, Taxable Income, Federal, State, Tax Benefit).
FINAL EXAMPLE — After Loan $400k / 6.5% (APR 6.605), Rent $2,800 / 3% increase, Property Tax $8,400/yr, Insurance $150/mo, Custom Appreciation 4%:
Year 9 Net Gain $183,193; Appreciation Gain $211,656, Custom 4%/yr, Est Value $711,656 (500k × 1.04^9); Purchase Closing -$10,000, Tax Benefit $2,708, Amortization $52,883, Remaining $347,117, Cashflow Diff -$45,588, Cost to Sell 4% -$28,466; Total Renting $348,060, Total Buying $393,648. Chart: Yr1 -14,646, Yr2 2,610, Yr3 21,828, Yr4 43,106, Yr5 66,505, Yr6 92,130, Yr7 120,050, Yr8 150,371, Yr9 183,193. Break-even during Year 2. Table: Yr1 Buying 3586 = Principal 384 + Interest 2145 + TaxInsMaint 1058 (700+150+208) vs Rent 2855 (2800+55); Yr5 Buying 3644 (497+2031+1116) vs Rent 3213 (3151+62); Yr9 Buying 3706 (645+1884+1178) vs Rent 3617 (3547+70). Slider max 9 years — NO 10-year toggle.
LO script: "Year 1 buying costs more monthly, but by Year 2 you break even — by Year 9 you're $183,193 ahead, mostly appreciation + principal. Renting 9yr costs $348,060 with nothing to show."

### Real Estate Report Card — /members/rerc
Inputs: Step 1 ONLY: Client (Optional), Location search, ONE purple Next (stays disabled until location geocoded) → Results. No $500k price input — uses median. No further Next on Results. Results: Create New, Share, Add (CO-BRANDING), MARKET DATA Edit (Price $940,915, Appreciation Forecasted), LOCATION Edit, CLIENT Add.
Outputs for Marlboro Township, NJ 07746: Median Price $940,915; Median Days on Market 82; Forecasted Appreciation Cumulative 5-yr +4.67% avg/yr, $219,774 (23.36%); Historical 5yr 6.02%, 10yr 4.52%, 63yr 4.2%; Supply & Demographics; Affordability in Monmouth; Homes Being Built Monmouth 1,973/yr; Active Listings ZIP 07746 Total 71, 54% M/M, 122% Y/Y, New (last 5 days) 3; County Monmouth 2765, 69% M/M, 94% Y/Y, New 150; Demographics by Age total 650.5k; Homeowners & Renters: Renters 141.3K (16%), Renters who can afford to purchase 35.6K (5%), Homeowners 509.2K (78%); Median Household Income $128,386 (National $80,630); Affordability Index 90 (at 100, median income affords median home with 20% down).
LO script: "Marlboro median is $940,915 — well above your $500k target, so your price point is below median. Inventory up 122% Y/Y, 5-yr forecast +4.67%/yr. Affordability 90 means median household is just short — your 20% down puts you stronger."

### Appreciation — /members/appreciation
Inputs: Client (required), Location, Price, Appreciation checkboxes (Forecast/Historical/Custom, "Select up to 2"), Down Payment Fee/Percentage, Closing Costs (Use worksheet / 0 invalid), Calculate. Example: $500k, Down $100k, Closing $8k, Dallas, Alex Rivera. Custom checkbox did NOT toggle in live session — results use Forecast 2.41% (form showed 2.481% — preserve both as observed).
Outputs (slider 10yr): Est Home Value $634,338, Appreciation +$134,338, +$13,434 avg/yr, ROI +126%, +13% avg/yr (on $108k invested). Chart: $500k, $541,664, $582,853, $596,940, $611,772, $634,338.
LO script: "On $108k invested, tool projects $134,338 appreciation in 10yr at forecast — 126% return on cash."

### Equity Gained & Appreciation — /members/equity-gained
Inputs: Client, Location, Price, Appreciation Forecast/Historical/Custom, Loan Amount, Term 30, Program Conventional, Loan Type Fixed, Rate, Calculate. Example $500k, Loan $400k, 6.5%, Dallas, Forecast 2.481%.
Outputs (slider 15yr): Equity After 15yr $431,917 (includes $100k down), Appreciation Gained $222,153, Amortization $109,763, Total Equity Gained $331,917, Forecasted 2.48%. Chart: Home Value $500k → $561,846 → $596,940 → $622,058 → $665,342 → $722,153; Loan Balance $399,638 → $385,230 → $367,728 → $346,469 → $320,646 → $289,280.
LO script: "In 15yr ~$431,917 equity — $222,153 appreciation + $109,763 principal + $100k down."

### Bid Over Ask — /members/bid-over-ask
Inputs: Client (required — Calculate blocked by "Client name is required" until selected), Location Dallas, Current Asking Price $500k, Bid Above Asking $25k, Estimated Current Value $500k (auto-filled), Appreciation Forecast/Historical/Custom radios (Forecast default; form showed Forecasted 4.47% 1-yr, 3.35% 5-yr avg, Historical 2.96% 63-yr), Calculate.
Outputs: "When home value is forecasted to exceed the bid" 18.3 months; Total Bid $525,000 (5% over value); 5-yr Projected Value $589,480; 5-yr Forecast Gain $64,480 (+12.28% over $525k bid); chart Yr0 $500k -4.76%, Yr1 $522,351 -0.5%, Yr2 $541,664 +3.17%, Yr3 $561,846 +7.02%, Yr4 $582,853 +11.02%, Yr5 $589,480 +12.28%. Buttons Back/Print/Email/Save/Share; Edit client/property.
LO script: "Bid $525k, value catches up in ~18mo — by Yr5 worth $589,480. Not overpaying forever."

### House Price Index — /members/house-price-index
Inputs: National/Regional/State buttons; Quarter / 1 Year / 5 Year / Since 1991 radios; Download. Outputs: US map with state values; National Quarterly Avg 0.35%; State view NJ 1.03% quarterly, labeled "20% above national avg" (preserve label as shown); 1-Year: National 2.14%, NJ 4.59%, same "20% above" label. Source FHFA. LO script: "NJ prices +4.59% last year per FHFA vs national 2.14%."

### Investment Property Analyzer — /members/investment-property-analyzer
PARTIAL in live session — Step 1 Location, Price only. Build Step 1 faithfully + a standard Step 2+ (rental income, expenses, cap rate, cash-on-cash) and mark Step 2+ as "Inferred — not fully observed" in README.

### MBEstimate — /members/mbestimate
Inputs: Location (Enter address), Co-brand Agent Optional, Display Left/Right, Get value, Download (disabled). Town-level "Marlboro, NJ 07746" → "unable to provide valuation" — needs street address. Build with that validation: require street address, show unable-to-value state for town-only input.

### Debt Consolidation — /members/debt-consolidation
Tabs Refinance / Move-Up Purchase; Steps DEBTS > EXISTING > PROPERTY/LOAN > PROPOSED LOAN; Inputs: Client (required), Monthly Qualifying Income, Debt name/Type (Installment/Revolving/Other)/Balance/Monthly payment, Add new debt, Clear form. EXISTING step: Location, Original Purchase Price, Property Tax, Home Insurance, Association, Purchase Date, Estimated Home Value, Existing Loan Amount, Term, Program, Type, Rate, MI, Monthly Payment, Remaining Balance, Total Equity.
Example attempt: Client Alex, Income $12,500/mo ($150k/yr), Debt 1 Credit Card Revolving $8,000 / $250. GAP: "Add new debt" did NOT create Debt 2 in live session — auto loan ($15k / 8% / $350) was NOT entered, Proposed Loan not reached, savings NOT obtained. BUILD the full flow correctly (allow N debts, calculate savings) and note in README that live session could not complete Debt 2 due to UI bug — do NOT claim live results.

### Payment Calculator — /members/payment
Inputs: Loan Amount, Term, Loan Type Fixed combobox, Rate, Monthly Payment output, View Schedule. $400k / 6.5% / 30yr = $2,528.27/mo P&I. Plus tax $700 + ins $150 = $3,378.27 PITI (tool shows P&I only). Schedule: Yr9 cumulative Paid $273,024, Interest $220,170, Principal $52,883, Balance $347,117. Yr30 total Paid $910,080, Interest $510,178, Principal $400k.

### ARM vs Fixed — /members/arm-vs-fixed
Inputs: Client, Loan Amount, Term 30, Fixed Rate, APR, ARM Term 7/1, Adj Frequency 1yr, Scenario Worst Case, Caps Initial 5 Annual 2 Lifetime 5, ARM Rate, Continue. Example $400k, Fixed 6.5%, ARM 5.5%, 7/1 Worst Case.
Outputs: Fixed $2,528 vs ARM $2,271, savings $257/mo Yr1-7. Cash-in-hand: Total savings worst-case Yr7 $27,999 = Cashflow 21,598 + Principal gained 6,401, Break-even 9y1m. Reinvest-to-principal toggle: $32,673 total, Break-even 10y0m. Yr8 worst-case: ARM jumps to 10.5% (+5%), P&I $3,417 (+$1,146), Total savings Yr8 $14,181, Balances Fixed 354,627 vs ARM 351,377. Yr9 ARM 347,062 vs Fixed 347,117 (+$55), Yr10 ARM surpasses Fixed (342,271 vs 339,105). 30yr totals: Fixed Paid $697,728 Interest $510,178; ARM Paid $943,092 Interest $733,914 worst-case.
LO script: "ARM saves $257/mo for 7yr — but worst-case Yr8 payment jumps $1,146 and advantage evaporates by Yr9-10. ARM only wins if you move/refi before Yr9."

### Blended Rate — /members/blended-rate
Inputs: Up to 3 debts: Debt name / Balance / Rate / Monthly Payment; Total amount; Total monthly payment; Reset; Add debt. Example (Mortgage $400k 6.5% + CC $8k 22% + Auto $15k 8%): Total $423,000, Blended 6.846% = (400k×6.5 + 8k×22 + 15k×8)/423k. Payment fields left 0 → Total monthly $0 (payment is optional input, not computed). Intermediate: single debt 6.5%; +CC 6.804%; +Auto 6.846%.

### Refi Risk of Waiting — /members/refi-cow-express
Inputs: Existing Loan Original Amount, Term 30, Rate; Refinance Refi Amount, Current Available Rate, Hypothetical Future Rate, Waiting Period months 10, Calculate. Example Existing $400k / 7.5%, Refi $400k / Current 6.5% / Future 6.0% / Wait 10mo. Results: Cost of Delaying $2,686 (≈ $269/mo × 10mo), Break Even 21 Months (excludes waiting). Table: Existing 7.5% $2,797, Refi Now 6.5% $2,528 saving $269, Future 6% $2,398 saving $399.

### Reinvestment — /members/reinvestment
Inputs: Client, Lump Sum, Period Payment, Monthly/Quarterly/Yearly, Assumed Rate, Length Years/Months, Calculate. Example Lump $100k, Period $269/mo (refi savings), Rate 6%, 10yr. Results: Ending Balance $226,933, Interest Gained $94,653, Contributions $132,280 (=100k + 269×120). Balance/Contributions checkboxes toggle chart.

### Affordability — /members/affordability
Inputs: Mode Income / Payment, Location, Annual Income, Down Payment, Term 30, Conventional, Rate, APR, Closing, Prepaid, MI, Advanced optional, Co-branding. Output live. Default: Income $65k, Down $20k, Rate 7.5%, APR 7.634, Closing $6,129 (3%), Prepaid $6,129, MI $101 (0.66% FICO 720–739) → afford $204,298 Comfortable, DTI 36%, Total Monthly $1,450 (P&I 1289 + TaxIns 161), Cash to Close $32,258 (Down 20k 9.79% + Closing 6129 + Prepaid 6129). With Income $150k (Down $20k, Rate 7.5%): afford $518,760 Comfortable, DTI 36%, Total Monthly $4,000 (P&I 3487 + TaxIns 513), Cash to Close $51,126 (Down 20k 3.86% + Closing 15,563 + Prepaid 15,563), MI $362 (0.87%) because down <20%.

### Buying Power — /members/buying-power
Inputs: Loan Amount, Rate, APR, APR Costs 1000, Agent None, Display Left/Right, You table + Buying Power table with rate columns, Show all values switch disabled. Example $400k / 6.5% = $2,528/mo. Table: to keep $2,528 at 7.25% need $371k loan (-$29k), at 7% $380k, 6.75% $390k, 6.625% $395k. At 0% shows $1,111/mo (400k/360).

### Marketing — follow-up (NOTHING sent in live session)
Social Studio: Tabs Scripts / Intro/Outro Frames / Videos / Create Custom Script; Search for topic; Filter; Tutorial; Guide. 43 View More buttons. Categories: Featured, Custom, Benefits of Homeownership, Breaking News, Homebuyer, Homeowner, ListReports, Location Specific, Moving, Refinance, Seasonal Home Tips. Scripts first-person as Jake Habib. View More expands in place: Edit, Cancel, Published date, Tags.
Newsletter: Copy all, Preview link, Share, Ask Miles, month filter. Current week Oct 5 2026 "Fed Minutes, Home Prices and Market Volatility"; sections: Fed Minutes, Quick Market Hits, Family Hack, What to Watch Ahead, Recent Newsletters.
Social Share: "Browse shareable content", Keywords search, Filter, Tutorial, Guide, category chips (Benefits of Homeownership, Buy vs Rent, First-Time Buyers, etc.). Content cards below — build with mock cards.
Prequalified Buyer Campaign: Welcome modal, Customize your kit; Steps REPORT SELECTION / SCENARIO SPECIFICS / CAMPAIGN SETTINGS; Select up to 9 reports, drag-drop reorder; 9/9 selected by default: Cost of Waiting, Buy vs Rent, RERC, Appreciation ("Estimate future home value"), Housing Supply and Demand, Amortization, Equity Gained, National House Price Index, Home Values Remain Resilient.
Presentation Expressway: "Proven presentations by Barry Habib. Watch the video, use the slides…"; Search for topic/tool. Items: Featured Power of Leverage, 2026 Forecast, Seasonal, Demographics, Housing Bubble, Move-Up Debt Consolidation, Bid Over Ask, Cost of Waiting, Higher Rates Benefit, Download slides, View more.
Open House Flyers: Legacy iframe — top bar Create New / Load / Location #MLS or Address, MI Worksheet, Save Scenario, Migrate, Export, Save & Share, Retire, Payment, Invest, Quick Tools, Help, Return. Build a clean modern version, not iframe clone, and note as "Reimagined — legacy iframe in original".
Seller Contribution: Legacy iframe — Create New / Load / Demo, location search, MI Worksheet, Second Loan, Save Scenario, Migrate, Export, Co-Brand. Same: rebuild clean, note as reimagined.

### Other
Meet: "Highway Meeting", Host button — display only, do NOT create meeting.
Recordings: Folders General 2, Buy vs Rent 1, Loan Comparison 2, Markets Overview 1, RERC 11.
Agent Feed: Could not access content in live session — build with mock feed cards and mark as inferred.
Get Help: External Zendesk — link out only, do NOT build.
Ask Miles AI: Do NOT build conversational AI — button placeholder only.

## TECH

Next.js App Router + TypeScript + Tailwind. Charts: Recharts. State: hooks + URL state for shareable scenarios. Forms: React Hook Form + Zod. PDF/Print: print styles + export.
`lib/calculations/` — pure, unit-tested math for ALL calculators (P&I, amortization, APR, break-even, appreciation, buy vs rent wealth, debt consolidation, cost of waiting, etc.). No math in components.
`lib/format.ts` — currency, percent, date.
`data/mock/` — all demo datasets.
`components/` — CalculatorShell, ResultsPanel, ChartCard, ComparisonTable, Share/PrintBar.

## QA & DELIVERABLE

1. Unit tests for every calculation with at least 2 known cases each (e.g. $400k, 6.5%, 30yr = $2,528.27 P&I; $400k, 6.5%, 30yr, 9yr → Balance $347,117).
2. Test every tool: change input → output changes, no NaN/blank, mobile doesn't break.
3. README.md: how to run, route map (every tool + URL), what is mock vs real, how to plug in real APIs.
4. GAPS.md — anything not rebuilt faithfully and why.
5. Final: `npm run dev` starts app where I can demo EVERY tool in under 2 minutes from dashboard.
6. After building, give checklist: Tool | Route | Status | Verified calculation (example input → output).
