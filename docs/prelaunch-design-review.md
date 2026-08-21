# Pre-Launch Design Review — Dynasty GM Football

**Date:** 2026-08-21 · **Method:** live browsing of the running app at `localhost:3001` (Playwright, 1440px and 390px), direct Postgres inspection, source reading, and web research on the genre.
**Read first:** `docs/playtest-audit.md`. This document does not repeat its findings as new — §8 says which of them are now fixed, which remain, and where I disagree.

> **Screenshot paths.** Captures live in a session scratchpad at
> `/tmp/claude-0/-home-user-stox/a7c0946e-4eaa-5dc1-9280-99e0da3b1580/scratchpad/shots/`
> and will not survive the session. Every finding below is written so it stands without the image; the filenames are given so you can re-shoot the same views.
>
> **Caveat on coverage.** The shared dev server went down three times during this review (another agent's rebuilds corrupted `.next`, then the process exited entirely for ~25 minutes). I was told not to restart it and the sandbox blocked me from doing so. Everything marked **[observed]** I saw rendered. Everything marked **[source]** I read in the code but could not photograph. Nothing here is guessed.

---

## Verdict

**Not ready for public testing, and the blocker is not a design problem — it is that the product has no concept of a user.** `app/page.tsx` does `prisma.league.findMany()` with no filter and renders every league in the database with a **Continue** and a **Delete** button; `deleteLeagueAction` in `app/actions/league.ts` performs an unconfirmed cascade delete with no ownership check. There is no auth, no session, no cookie, no owner column — I grepped for all of them. The moment two strangers are on the same URL they are sharing one save file, browsing each other's franchises, and one mis-click from destroying eight seasons of someone else's work. Everything else in this document is a quality problem that a tester will forgive; this one makes the test itself impossible to interpret, because you will not know whose save produced which piece of feedback. Below that line, the product is in much better shape than the playtest audit left it — the schedule bug is fixed, the wire is ranked, the playoff bracket landed, contracts have an acceptance model, and the scouting economy page is the best-taught screen I have seen in an indie sim. What is left is a first-five-minutes problem and a trust problem, and both are cheap.

---

## The top 10 changes before launch

Ranked by impact per unit of effort. **S** ≈ hours · **M** ≈ days · **L** ≈ a week+.

### 1. Give a save an owner, and confirm the delete — **S/M · BLOCKER**

**What.** Add `ownerKey String?` to `League`, set it from an httpOnly cookie minted on first visit, filter the home list to `ownerKey = mine`, and reject `deleteLeagueAction` for a league you don't own. Add a confirm step to Delete.

**Why.** `app/page.tsx:13` — `prisma.league.findMany({ orderBy: { createdAt: 'desc' } })`, unfiltered, unpaginated. `app/actions/league.ts:26–29` — `prisma.league.delete()` on a bare id, no check, `<button className="btn-ghost text-xs">Delete</button>` with no dialog. **[observed]** The home page currently renders 50 franchises and is 5,995px tall (`home-d.png`); the create-league form is ~5,100px below the fold, reachable only via the hero's anchor link. A stranger's first screen is other people's test saves named `HISTORY VERIFY fin-f`.

**Done looks like.** A visitor sees only their own saves. The list is capped and paginated. Delete asks "Delete *Founders League* (2029, week 6)? This cannot be undone." Optional but cheap: a "share this save" read-only link, since some testers will want to show you a state.

---

### 2. Say what the game is, above the fold — **S**

**What.** Replace the hero's single line of copy with a real value proposition, one screenshot, and a "what your first 10 minutes look like" strip.

**Why. [observed, `home-top.png`]** The entire pitch is: eyebrow "FRONT OFFICE SIMULATOR", wordmark "DYNASTY GM FOOTBALL", one line — *"Run the franchise. Build the dynasty."* — and a button. The right 60% of the hero panel is an empty yard-line texture. Nothing says it is American football, nothing says it is free, nothing says it is single-player and needs no account, nothing shows a screen, nothing says a season takes 25 seconds to sim. The header repeats "FRONT OFFICE SIMULATOR" a second time 130px above the eyebrow that already says it. For a public test the landing page *is* the funnel; right now it asks a stranger to commit to a 32-team league generation on the strength of a tagline.

**Done looks like.** Hero carries one sentence a non-fan understands ("You are the general manager. Sign, draft, trade and cut your way to a dynasty — 32 teams, a real salary cap, and nobody plays the games but the simulation"), one 1440px screenshot of the dashboard or the free-agency bidding screen, and three chips: *free · no account · a season in about a minute*. The product has genuinely photogenic screens (the cap sheet, the scouting department, the playoff bracket) and shows none of them.

---

### 3. Move the setup explanations under the setup toggles — **S**

**What.** Lift the two `tip=` strings at `app/league/[id]/settings/page.tsx:21` and `:26` into shared copy and render them as helper text under the Salary Cap and Difficulty controls in `components/CreateLeagueForm.tsx`. Write one for Starting Situation.

**Why. [observed, `home-create.png`; source confirmed]** `CreateLeagueForm`'s `Field` component (lines 112–125) renders a `label` and a `Segmented` control and nothing else — no `title`, no helper text, no `aria-describedby`, no `Tooltip`, on any of the three. The player is asked to choose between *Off / Simplified / Realistic* and *Rookie / Pro / All-Pro / Legend* with zero information. The excellent copy that explains both already exists, verbatim, on a page that is unreachable until after you have committed:

> *"Realistic: cap hit is base salary plus prorated signing bonus, and cutting a player leaves dead money behind. Simplified: a flat cap hit every year with no proration or dead money — cuts are free. Off: cap checks are skipped entirely, sign whoever you want."*

This is the playtest audit's finding, unchanged, and it is still the cheapest fix in the product.

**Done looks like.** Two sentences under each control. Difficulty's copy also needs to become true — see §5 on the difficulty/trade mismatch.

---

### 4. Give the week's result a screen — **M**

**What.** Replace the post-Advance toast with a takeover panel: your score large, the recap paragraph as the centrepiece, injuries, the other 15 results, and a link into the box score.

**Why. [source]** `components/AdvanceWeekButton.tsx:133` is `showToast(result.summary)`, rendered at line 228 as `absolute right-0 top-full mt-2 w-80 card card-pad text-sm` — a **320px-wide text card tucked under a button in the top-right corner.** That is the entire payoff of the game's main verb. Forty lines lower in the same file, the cap-compliance block renders a 352px panel with a headline number, a summary, a **"Fastest route back"** list of named players with exact savings, and a CTA. **The template is in the same component.** The playtest audit called this its single highest-return item and it has not moved.

**Done looks like.** Advance → the page is owned by the result. The recap prose (which is genuinely good — see §7) is the hero, not a toast. The score links to `/game/[id]`. Multi-week advances stream results rather than counting.

---

### 5. Fix the storyline milestone spam — **S, root-caused**

**What.** In `lib/storyline.ts:275–320`: raise `MILESTONE_STEP.defInt` from 3 and `sacks` from 5, and stop ranking candidates by raw `gap`.

**Why. [observed + source]** The mid-season dashboard shows four storylines and they are these (`mid-dash-d.png`, `m-dash-m.png`):

> MILESTONE — *Lorenzo Granger is 1 interception from 3 this season*
> MILESTONE — *Devante Prescott-Hale is 1 interception from 3 this season*
> MILESTONE — *Micah Ellington is 1 sack from 5 this season*
> MILESTONE — *Sage Fontenot is 1 sack from 5 this season*

The cause is exact. `MILESTONE_STEP` sets `defInt: 3, sacks: 5` and `MILESTONE_WINDOW` sets both to `1`, so **every player in the league on 2 interceptions or 4 sacks generates a storyline**, and it persists week after week because most of them never get the third. Then `milestoneStorylines` does `candidates.sort((a,b) => a.gap - b.gap).slice(0, MILESTONE_SLOTS)` with `MILESTONE_SLOTS = 4` — sorting by *raw* gap means gap-of-1 defensive counters always beat "33 receiving yards from 500," so the four slots are permanently occupied by the least interesting category in the game. On the playoffs save the same mechanism yields four *tackle* milestones during the postseason, when regular-season tackles can no longer move (`playoff-dash-d.png`).

**Done looks like.** Rank by `gap / step` (proximity as a fraction of the threshold) or by a per-category notability weight, cap MILESTONE at 1–2 of the 4 slots so STREAK/RIVALRY/RECORD_CHASE get room, retire a storyline that hasn't progressed in 3 weeks, and set thresholds a fan would notice (10 sacks, 5 INT, 1,000 yards).

---

### 6. Stop one player winning three awards with the same stat line — **S**

**What.** In `lib/awards.ts:118–125`, exclude the MVP from the OPOY pool (or don't render OPOY when it equals MVP), and apply the same rule to ROTY.

**Why. [observed + source]** `computeSeasonAwards` returns `mvp: byOverall[0]`, `opoy: byOff[0]`, `roty: rookies[0]` with **no exclusion between categories**. Because the best player overall is usually an offensive player, MVP and OPOY are the same person most seasons. The History page prints them as adjacent rows (`long-hist-d.png`):

> 2026 · **MVP** · Ajani Ashford (RB) · DAL · 2519 rush yds, 35 TD
> 2026 · **Offensive Player of the Year** · Ajani Ashford (RB) · DAL · 2519 rush yds, 35 TD
> 2029 · **MVP / OPOY / Rookie of the Year** · Vidal Wilhoite (RB) · MIL · 122 rush yds, 3 TD *(all three, identical line)*

A tester reads that and concludes the award engine is broken, which poisons every other number on the page. Same file, same trip: `2,519` rushing yards is 20% above the real single-season record and the season pass-TD record reads `57`.

**Done looks like.** Four distinct names in a normal season. Separately (M, not launch-blocking): the volume constants need a pass — see §6.4.

---

### 7. Add `error.tsx`, `not-found.tsx` and `loading.tsx` — **S**

**What.** Three files. A branded error boundary at `app/error.tsx` (or per-segment), a branded 404, and a skeleton at `app/league/[id]/loading.tsx`.

**Why. [source]** `find app -name "error.tsx" -o -name "loading.tsx" -o -name "not-found.tsx" -o -name "global-error.tsx"` returns **nothing**. Three call sites use `notFound()` (`layout.tsx:21`, `player/[playerId]/page.tsx:61`, `game/[gameId]/page.tsx:11`) and all three land on Next's stock page. Any server-component throw in production becomes *"Application error: a server-side exception has occurred"* plus a digest hash — which is exactly what a tester reports as "the game is broken" with no information you can act on. And with no `loading.tsx`, every navigation blocks on the full server render with zero feedback: I measured 850ms–3.8s per page against a **local** Postgres (`mid-trade` 2,798ms, `new-settings` 3,793ms, `long-stats` 2,968ms). Over the network to a Neon free tier those become the numbers a stranger experiences on a dead-looking page.

**Done looks like.** A themed error page with "Something broke on our side" and a link home. A 404 that says "That league no longer exists" and offers the franchise list. A skeleton so nav feels instant.

---

### 8. Stop the app reserving space to say nothing — **S per page, M for all**

The three worst, all on a brand-new save, all inside a stranger's first two minutes:

- **Standings** (`new-standings-d.png`) — at 0-0 in preseason the headline tile reads **"PLAYOFF POSITION: #1 seed / Leading the division"** in green, and the NFC playoff picture ranks 16 identical 0-0 teams with "First-round bye", "Wild card", and a CUT LINE. The explanatory line ("Projected from today's records…") is honest, but a green "#1 SEED" before a snap has been played is the game inventing a fact about you. **Hide seeding and the picture until week 2.**
- **Stats** (`new-stats-d.png`) — "No stats recorded yet this season — check back after Week 1," followed immediately by 32 rows of `0-0 / 0 / 0 / +0 / 0`. 1,300px of zeros. The design audit predicted this exactly (A9a) and it is unchanged. **Collapse the table in the empty state.**
- **Trade Center** (`new-trade-d.png`) — 86 player rows across both panels, every one reading *"No stats recorded yet."* On the screen whose whole job is comparing players. **Fall back to last season's line, or drop the row.**

Also here: **Schedule's** *"REMAINING SOS .000 — a soft run in"* at week 1, which is an assertion, not a placeholder.

---

### 9. Confirm Fill Roster, and show the roster count against the minimum — **S**

**Why. [observed + source]** `components/FillRosterButton.tsx` has no dialog, no preview, no undo — `run()` calls the server action directly. It sits top-right of the Roster hero with no label explaining it (`new-roster-d.png`, and it is the most prominent control on the page at 390px, `m-roster-m.png`). Meanwhile `LEAGUE.ROSTER_MIN` is 46 (`lib/tuning.ts:27`) and **league generation ships you 42** — I counted 1,377 rostered players across 32 teams in a fresh league, 43.0 average. The roster header says *"ROSTER SIZE 42 / all healthy"* and never mentions 46 or 53. The depth chart correctly says *"UNMANNED 1 · FB"* and *"NO BACKUP 5 · LT, RG, RT, K, P"* — so the game knows, and only the roster page doesn't say. Settings still ships a checkbox literally labelled **"Confirm risky moves (stored only)"** which is read by nothing (grep: 0 usages outside the settings page and the action that writes it).

**Done looks like.** `42 / 53 · minimum 46` on the roster strip, and Fill Roster shows who and for how much before it commits. Either raise generation to 46+, or make the shortfall the new player's first task with a prompt.

---

### 10. Two "the game is lying to me" fixes — **S each**

- **GM Career shows 17 seasons under a heading that says 1** (`new-gm-d.png`). On a brand-new league: header *"On the job since 2026 — **1 season and counting**"*, section label *"SEASON LOG · **1 SEASON**"*, and a table of **17 rows, 2010–2026**, including *"2024 · 15-5 · 🏆 Champion"*. Two tiles above it say `RECORD 0-0 / No games yet` and `CHAMPIONSHIPS 0`. The commit that added the backstory is titled *"…keep GM Career to the GM's own tenure"* — the intent is right, the page still shows the franchise's pre-history in the GM's log. Also: those seeded rows carry playoff results in W/L (15-5, 12-8, 10-9, 9-9 in a 17-game league — arithmetic checked across six rows), which is the exact contamination the changelog claims was fixed for live play, reintroduced in the history generator.
- **The Draft tab is empty for the whole first session** (`new-draft-d.png`). A brand-new league has **zero** draft prospects (DB-verified: `groupBy` on `isDraftee` returns `[]` for two fresh leagues; a mid-season league has 400). `lib/gen/league.ts` never seeds a class; the class is created by the PRESEASON step in `lib/season.ts:178`, whose own comment says *"League creation already seeds year 1's class"* — **the comment is wrong.** So one of seven top-level nav items shows a headline reading "2027 DRAFT CLASS", "PROSPECTS **0** in the class", a big board with column headers and no rows, and no empty state. The README promises the opposite: *"the incoming class exists from week 1 and is fully browsable."* One line to fix.

---

## Research: what the good ones do, and what it implies here

**The genre's own consensus is that its interfaces are its weakness, not its depth.** Reviews of Out of the Park Baseball — the deepest, most-respected sim in this space — land on the same sentence for twenty years: expansive but *"seriously intimidating,"* hours spent navigating menus, *"a stats guy's dream, a newcomer's nightmare"* ([Review Fix on OOTP 20](https://reviewfix.com/2019/05/out-of-the-park-20-review-a-stats-guys-dream-a-newcomers-nightmare/), [GameGrin on OOTP 18](https://www.gamegrin.com/reviews/out-of-the-park-baseball-18-review/)). Football Manager 26's UI rebuild was reviewed as *"floundering in an interface labyrinth"* — an attempt at clarity that made important information disappear ([Galaxus](https://www.galaxus.at/en/page/football-manager-26-is-floundering-in-an-interface-labyrinth-40507), [TechRadar](https://www.techradar.com/gaming/football-manager-26-review)). The nearest direct competitor, Wolverine's **Draft Day Sports: Pro Football**, draws two complaints that Dynasty GM shares almost word for word: screens that are *"a little obtuse"* — free agency in particular, where the contract offer lives on a separate, less obvious screen than the player card — and **"too much dead space"** on many screens ([Operation Sports, DDSPF 22](https://www.operationsports.com/draft-day-sports-pro-football-22-review-another-solid-entry-in-the-series/), [gmgames.org, DDSPF 2020](https://gmgames.org/draft-day-sports-pro-football-2020/review/)).

That matters here because Dynasty GM has both. Free agency's negotiate flow is a separate screen from the row you clicked; and the dead space is measurable — the Settings panel is 770px wide in a 1440px viewport, the game-detail page 900px, the re-sign list 1,000px, and the new-league dashboard leaves ~400px of black below the Front Office brief while the right rail keeps going.

**The first-session literature is unanimous on one thing: remove, don't add.** Get the player into the core loop inside about a minute; defer settings, accounts and permissions until after first play; make anything tutorial-shaped skippable ([Playio, onboarding & FTUE metrics](https://blog.playio.co/mobile-game-onboarding-retention)). Dynasty GM's setup is already close to this — three toggles and a Start button — but it currently defers *explanation* rather than *decisions*, which is the wrong half. The fix is not a tutorial; it is two sentences of helper text and a one-line verdict on each of the 32 franchises so the first decision has content.

**Football Manager's answer to "how does a deep sim teach itself" is the inbox and the assistant manager.** The staff sends you pre-match analysis, squad feedback, and periodic backroom-advice meetings; the game teaches by pushing a specific, dated, dismissible recommendation into a feed rather than by gating you behind a wall ([Passion4FM on staff responsibilities & backroom advice](https://www.passion4fm.com/football-manager-staff-responsibilities-backroom-advices-explained/), [FMInside](https://fminside.net/guides/staff-guides/58-assistant-managers-in-football-manager)). **Dynasty GM already has this component and it is good.** The Front Office brief on the new-league dashboard reads:

> Roster — *"RT is your thinnest position. Worth addressing before it costs you a game."* → **Browse Free Agents**
> Contracts — *"Jamar Hovland's contract expires soon. Market rate is around $19.2M/yr — get ahead of it before he hits the open market."* → **Open Extension**
> Trade Market — *"Houston is short at C. A position you're deep at — worth a call."* → **Explore Trade**

Three reactive items with reasons and deep links. That is the assistant-manager pattern, correctly built, and it is the biggest single improvement since the playtest audit. It needs one thing: it currently never *blocks*, and it is blind to the calendar (see §5).

**FM Touch is the proof that cutting works.** SI shipped it because data showed a real audience wanted something lighter than full FM but deeper than mobile, and the thing it cut was time-to-season, not depth ([SI on FM22 Touch](https://www.footballmanager.com/news/major-changes-fm22-touch-and-beyond), [fmshot comparison](https://www.fmshot.com/football-manager-touch-vs-mobile/)). Dynasty GM's speed is already its Touch-shaped advantage — the playtest audit measured a full 17-week season in ~25 seconds and no tester ever complained about waiting. **Protect that. It is the most defensible thing about this product on the open web,** where a stranger will not install anything and will not give you thirty minutes.

**On why people leave franchise modes:** the consistent read is that they are too easy and nothing has consequences — *"the single biggest thing that can be done to make franchise modes harder is make ratings matter more"* ([Operation Sports, "Franchise Modes Are Too Easy"](https://www.operationsports.com/franchise-modes-are-too-easy-thats-a-problem/)). This is the same diagnosis the playtest audit reached independently, and the trade-valuation exploit (§8, E1–E3) is still the live instance of it here.

**On dense data for non-experts,** the applicable rule is progressive disclosure: 3–5 metrics read first, everything else behind a click, grouped and labelled ([UXPin dashboard principles](https://www.uxpin.com/studio/blog/dashboard-design-principles/), [Dev3lop on progressive disclosure](https://dev3lop.com/blog/progressive-disclosure-in-complex-visualization-interfaces/)). And the broadcast-graphics framing is the more useful one for this product: designers of modern scorebugs describe the job as knowing *"not only what information exists but what information matters to the fan at a specific moment"* — a casual viewer and a diehard need different amounts of context off the same feed ([SVG, "Designing the Modern Scorebug"](https://www.sportsvideo.org/2026/06/09/designing-the-modern-scorebug-how-broadcast-graphics-teams-are-rethinking-the-most-important-element-on-screen/)). Dynasty GM's masthead stat strips are exactly this pattern and mostly get it right; the failure mode is that they print a number in every slot whether or not the number means anything yet (`#1 SEED` at 0-0, `SOS .000`, `CLASS SIZE 0`, `DRAFT HIT RATE 100%`).

---

## By area

### 1. The first five minutes

**[observed — `home-top.png`, `home-create.png`, `new-dash-d.png`, `new-draft-d.png`, `new-standings-d.png`, `new-stats-d.png`]**

The path is: land → (currently) scroll past 50 strangers' saves → pick 1 of 32 identical franchise rows → three unexplained toggles → Start Dynasty → dashboard in about a second.

Where a stranger bounces, in order of likelihood:

1. **The hero.** One tagline, no screenshot, no genre signal beyond the word "Football". (§2 above.)
2. **The franchise picker.** Still 32 rows of `CITY / NICKNAME / DIVISION` with nothing to choose on — the playtest audit's finding, unchanged. This is the most consequential decision in the game and it is a coin flip. The data to fix it already exists and is *already computed elsewhere*: the roster page renders `72 TEAM OVERALL · 20th of 32 · 11th in the NFC · 2nd in the East` plus a per-unit strength/weakness read, and the cap page renders cap space. One line per row — *"20th overall · $47.1M of room · thin at RT, strong at QB"* — would turn a coin flip into the first real decision, at S effort.
3. **The Offseason Roadmap.** Still renders on a brand-new PRESEASON league with **all four earlier stages filled green** and "New Season · Back to football" highlighted. The first widget a new player sees tells them they missed four phases of content that never existed. (Playtest audit finding, unchanged.)
4. **The Draft tab.** Empty, with a headline promising a class. (§10.)
5. **The League Wire ticker.** On a fresh league the always-on ticker across every page is thirteen rotating variants of *"AWARD — The Milwaukee Loggers are your 2011 champions!"* — present tense, about a team that isn't yours, from fifteen years before you existed. Cause is in `app/league/[id]/layout.tsx:55–78`: the ticker round-robins across *categories*, and on a new league the only categories with rows are AWARD (from the seeded backstory) and one SIGNING ("league founded"). It is the first moving thing on screen and it is announcing someone else's history as breaking news.

**What is good in the first five minutes and should not be touched:** league generation is genuinely fast; the Front Office brief's three deep-linked items; the matchup strip's win-probability explanation (*"61% Win · +6% your offense vs their defense — 74 against 66 · +6% home field — Playing at home"*), which is the single best piece of teaching in the product; the roster page's TEAM OVERALL + ROSTER CONSTRUCTION strip; and the Scouting Department's price list.

---

### 2. Legibility and density

**Where it's too dense.** Free agency is 100 near-identical rows over 4,998px with a `Negotiate` button on each and no sort beyond position pills (`new-fa-d.png`). The mid-season Draft board is **11,381px** of 400 prospects. Re-sign is 14 flat rows with no starter badge, no snap counts, no production and no recommendation — six of the fourteen are ~$1.15M replacement-level players who need no decision at all (`mid-resign-d.png`). All three want the same thing: a triage layer on top (three that matter, everything else collapsed), not fewer rows.

**Where it's too sparse.** Content columns are consistently narrower than the viewport with nothing beside them: Settings 770px of 1440, game detail 900px, re-sign 1,000px, and roughly 400px of empty left column below the new-league dashboard's brief. This is precisely the "too much dead space" complaint that dogs DDSPF. It also produces a specific bad outcome: the game-detail page — the emotional payoff of the whole loop — is a narrow strip with 440px of black to its right.

**Numbers shown without saying why they matter:**

- `POTENTIAL 85–85, Confidence: HIGH` on your own players (`player-card-d.png`), rendered through a *range* widget with a dot in the middle. Every own-roster row on the Scouting page shows `OVR 66–66 / POTENTIAL 76–76 / Confidence: HIGH`. A zero-width range makes the range component look broken and tells the reader nothing.
- `21 PICKS OWNED` — 21 of what, over how many years?
- `DRAFT HIT RATE 100% · 28/28 picks hit` (`long-gm-d.png`) — "hit" is never defined, and a 100% rate including four separate round-7 picks reads as either flattery or a bug. The badge below says *"Draft Whiz — 100% of your picks turned into legitimate contributors."*
- `CAP MANAGEMENT / Average dead money per season / $0` with a "Cap Wizard" badge — congratulating a GM who has released nobody.
- Attribute colours on the player card: 92/88/88 amber, 73/74/76 blue, 67/61/38 white. Three bands, no legend, and amber-for-good conflicts with green-for-good everywhere else in the palette.
- `Status: Active` on all 42 roster rows — a full column carrying zero bits.

**Where it teaches well and should be copied:** the Scouting Department page (`new-scouting-d.png`) is the model. A visible wallet (`FOCUS LEFT 102 of 102 this period`), a literal **price list** with a "what it buys" column, three explicitly named lanes with a stated trade-off (*"Every point spent here is a point not spent on the class"*), and the carryover rule spelled out (*"Up to 51 unspent focus carries into the next period — anything above that is lost"*). Nothing else in the product explains its own economy this well. The Standings page's one-liner — *"Division winners are seeded above every wild card, so a division lead is worth more than a better record"* — is the same instinct.

---

### 3. The core loop

**Advancing a week still feels like nothing.** [source, `AdvanceWeekButton.tsx`] The outcome is a 320px text card in the corner. See §4 of the top-10.

**The week still asks for nothing.** The one exception remains the cap-compliance gate, and it is still the best moment in the product. Everything else — depth chart, trades, free agency, scouting — is available and never demanded. The Front Office brief is now reactive, which is a real improvement, but it never blocks and it is blind to the phase: at `PLAYOFFS 2026 · Wk 1` it still offers **"Browse Free Agents"**, **"Open Extension"** and **"Explore Trade"** (`playoff-dash-d.png`) — two of which are closed and one of which passed at week 9.

**The playoffs have no moment on the dashboard.** [observed] A 10-7 division winner reaches the postseason and the dashboard shows: no bracket, no seed, no opponent, no next-game card (the matchup strip simply stops rendering), and a brief headed **"THIS WEEK'S BRIEF — WEEK 1."** The header reads `PLAYOFFS 2026 · Wk 1` through every round — the audit's "stuck on Wk 1" is unfixed, and I confirmed it while the bracket itself said "Championship in progress."

**Reasons to come back tomorrow** currently: the trade retrospectives, the GM Career ledger, and the Ring of Honor / Dynasty Score. All three exist and all three are pointed at data that is not yet trustworthy enough to carry them (§4). Fix the trust layer and these become the retention story; leave it and they are the thing that ends the run.

---

### 4. Trust — the section I would read twice

Ranked by how fast a tester finds them.

**4.1 The box score does not explain the scoreline.** `game-detail-d.png`: DEN 16, BOS 38. Total yards **438 vs 441**. Pass 263 vs 265. Rush 175 vs 176. Turnovers **1–1**. Sacks allowed 2–1. Penalties 6–6. A 22-point margin with statistically identical teams and no field-position, red-zone, scoring-drive or special-teams line anywhere on the page. A tester who opens the best screen in the app to find out *why* they lost, finds nothing, and concludes the simulation is arbitrary. Adding scoring drives / red-zone trips / starting field position to this page is S effort and closes the loop the recap opens.

**4.2 The awards sweep.** §6 above. MVP and OPOY are the same player with an identical stat line in most seasons, printed adjacently.

**4.3 Records that are 20% above real-world all-time bests, in year one.** `long-hist-d.png`: single-season Rush Yds **2,519** (real record 2,105), Pass TD **57** (55), Pass Yds **5,521** (5,477), a rookie QB at **5,138 yards / 49 TD**. Meanwhile career Sacks record = **11**, identical to the season record, and career Pass Yds = season Pass Yds — a tell that only one season of real football ever happened in that save. Both halves of that page undermine each other.

**4.4 Playoff scores that don't look like football.** `playoff-standings-d.png`: Minneapolis 57 – San Francisco 7, Nashville 47 – Boston 6, New Orleans 43 – Minneapolis 17, all in the same postseason, alongside a 16-1 team and an 0-17 team at −459 point differential. The playtest audit reported *player-level* stat compression alongside inflation; at the *team* level the spread reads far too wide. Worth one measurement pass before strangers see it.

**4.5 The Dynasty Score column that says the same thing 17 times.** Ranks 16–32 all read `Draft hit rate · Cap management · Winning percentage`, byte-identical, with scores clustered 17–30 (`long-hist-d.png`). The column exists to differentiate and it doesn't.

**4.6 The re-sign page asserts the wrong phase.** `mid-resign-d.png`: the app header says `REGULAR SEASON 2026 · Wk 16` and the page masthead one inch below says **"2026 OFFSEASON — RE-SIGN WINDOW"**, with a tile reading `DECISIONS 14 · contracts on the clock`. There is no clock. The audit's "`/resign` is playable before its phase opens" is unchanged, and the masthead now actively contradicts the shell.

**4.7 A live Accept button behind a "deadline passed" banner.** `m-trade-m.png`: the Trade Center correctly shows `DEADLINE: Passed`, an amber explainer, and a disabled **"Deadline Passed"** submit — genuinely well done. Two inches above it, the pending-offer card still renders a green **Accept**. Same page, opposite claims.

**4.8 A season log with a 0-1 record and "Lost Wild Card."** `long-gm-d.png`, DB-verified. In a 5-season save: 2027 is `0-0-0, 0 PF, 0 PA, Missed Playoffs`; 2028 and 2029 are `0-1, 10 PF, 45 PA, Lost Wild Card`. The database confirms those years generated **4 wildcard games and zero regular-season games**. This save straddles the schedule fix — 2030 has a full 272-game schedule, so **the bug itself is fixed** — but two things follow that do matter: (a) any save created before 2026-08-21 is permanently corrupt and there is no repair path, and (b) **nothing anywhere refuses to write or display a `TeamSeasonRecord` with fewer than 17 games.** That absent guard is precisely how the original bug survived undetected for the life of the project. If you launch from a fresh database (a) is moot; (b) should still be added, cheaply, as an invariant.

**4.9 Three settings labelled "(stored only)".** `Show advanced stats (stored only)`, `Auto-advance weeks (stored only)`, `Confirm risky moves (stored only)` — all three are read by nothing (grep confirms zero usages). Dev jargon in player-facing copy, on three dead controls, on a page whose subtitle also says *"Full control surface from the design doc."*

**4.10 Two cheat switches presented as ordinary settings.** `Reveal true ratings everywhere (debug)` sits two rows below `Scouting enabled` as a normal checkbox, and `Salary Cap Mode` is a plain select that can be flipped to Off mid-save with no confirmation and no "this save has been modified" marker. The playtest audit's E7 is unchanged. For a public test where you will be reading people's feedback about balance, an unmarked one-click difficulty nullifier is a data-quality problem as much as a design one.

---

### 5. Visual design — opinionated

**It does read as one product**, and that is a real achievement of the redesign. Shared masthead, shared stat-tile strip, one display face for numbers, one body face, a consistent near-black ground with a single green accent. The rating chip, the notched corners, the team-colour ribbon, the broadcast-caps labels — the identity is legible and it isn't generic dark-dashboard.

Four things I would change, in order:

**5.1 The player portraits are the weakest element in the product.** Flat cartoon avatar faces — the kind you'd get from a Notion or Slack avatar generator — appear at 110px on the player card, at ~28px in every roster row, every depth-chart slot, every trade panel row, every re-sign row. On the player card the avatar is the single largest object on the screen. Nothing else in the app reads less like a front office. They are inconsistent with the editorial typography, the muted palette, and the stated design-system rule against emoji and decorative glyphs. **My recommendation: remove them entirely before launch.** A position chip and a name in the display face is more credible than a cartoon, costs nothing, and buys back ~28px per row on 100-row tables. If you want an identity mark, use the team logo the app already generates.

**5.2 The emoji are still there.** `long-gm-d.png` shows 🔨 🔍 🧮 🤐 as GM badge icons and 🏆 in every History award row — the only saturated multicolour objects on screen, next to "Cap Wizard" and "Quiet Front Office". `components/ds/icons.tsx` opens with a written rule forbidding exactly this. The cheap fix the design audit already identified (drop the glyph, lead with the title) closes 80% of it in ten minutes.

**5.3 The nav names are invented categories.** `HOME · TEAM · MARKET · DRAFT · LEAGUE · GM CAREER · SYSTEM`. "SYSTEM" is Settings; nobody looking for Settings will click SYSTEM. "MARKET" holds Free Agency and Trade. Seven top-level buckets is the right number, but at least two of the labels are the product's private vocabulary rather than the player's.

**5.4 The design system has drifted ahead of the app.** `/design-system` is a public route with no nav link and no auth. **12 of the 33 `components/ds/` components are used only there and never in production**: `BottomNav`, `CapDecisionPanel`, `ContractSummary`, `OnTheClock`, `PickTradeOffer`, `PlayerHero`, `PlayerRowMobile`, `ProspectRow`, `RecentPicksFeed`, `ScoutsRoom`, `Timeline`, `TradeOfferPreview`. Three of those are direct fixes for open playtest findings — `OnTheClock` is the broadcast draft clock ("you are on the clock with no clock"), `RecentPicksFeed` is the post-pick feedback ("the page appears to have done nothing"), `PlayerRowMobile` is the mobile roster row. **Wiring `OnTheClock` into the real draft is probably a one-hour fix for a top-tier complaint.** The page also annotates behaviour that does not exist ("the real roster page swaps this for the mobile row below a breakpoint") and — separately — renders **real NFL team names and marks**: "NEW YORK GIANTS", "NYG", "Miami", and a mock wire item about the Dolphins. The product's whole framing is *no real NFL data anywhere*. On a public URL that is a page I would not leave reachable.

---

### 6. Web-readiness

**6.1 Ownership.** §1. Blocker.

**6.2 Error surfaces.** §7. No boundaries of any kind.

**6.3 Cold-start and timeouts — [inference, but well-grounded].** `createLeague` performs ~10 sequential chunked `createMany` round trips (teams, staff, scouts, ~1,500 players, contracts, 272 games, depth slots, scouting reports) and now also seeds 16–24 years of league history. That is 1.2–1.7s against a local Postgres on the same machine; against a Neon free instance over the network it is a different number, and **no route or action in the codebase declares `export const maxDuration`**, so it runs on the platform default. This is the single highest-consequence deploy risk, because the very first thing every tester does is create a league. **Measure it against the real deployed database before you invite anyone.** Related: `lib/db.ts` instantiates a plain `PrismaClient` with no pooled-connection handling — on serverless each concurrent invocation opens its own pool, which Neon's free tier will not tolerate at even modest concurrency. Use the pooler connection string.

**6.4 Page weight and query cost.** Every page load runs the layout's three parallel queries *plus* a 120-row transaction scan for the ticker, before the page's own queries. Measured locally: `/trade` 2.8s, `/settings` 3.8s, `/stats` 3.0s, `/draft` 2.4s. Pages are also very tall — draft 11,381px, free agency 6,525px at mobile width, news 4,700px — which is server-rendered HTML on the wire every time.

**6.5 New save vs. long save.** Both render. The new save's problems are dead states and the empty draft class (§1, §8). The 5-season save's problems are trust (§4.8): a corrupt season log, a "Best Season" of 0-1, and a career record derived from it. An 8-season save I inspected before it was deleted had a clean 276-games-per-year record for 2026–2033, which is the schedule fix working correctly — so the long-save experience should be fine on a fresh database.

**6.6 Mobile at 390px** — ranked as the owner would rank it: **below everything above.** It is also not the catastrophe you might expect.

- **Dashboard** (`m-dash-m.png`): stacks into one clean column, no page-level overflow, header collapses to logo + phase + Advance. Genuinely readable. Cap space and scouting balance are hidden by design (`hidden lg:block` in the layout), but cap space still appears in the team hero.
- **Roster / Free Agency / Cap / Standings**: no *page* overflow, because the tables sit in `overflow-x-auto`. But that means the columns that matter are silently off-screen with no affordance: the mobile roster shows `POS · PLAYER · AGE` and hides OVR, potential, cap hit and years (`m-roster-m.png`); mobile free agency shows `POS · NAME · AGE · SCOUTED` and hides the market value **and the Negotiate button** (`m-fa-m.png`). You can browse but not act.
- **Trade** is the one true break: measured `document.scrollWidth` **636px against a 390px viewport** — the whole page scrolls sideways, header and nav clipped (`m-trade-m.png`).
- The nav row scrolls horizontally with no fade or chevron, so `SYSTEM` is undiscoverable on a phone.
- Across the whole app there are **75 responsive class prefixes total**, and eight page files have zero.

If you want a cheap mobile floor without a project: fix the trade page's overflow, add a scroll affordance to the nav, and add a `<caption>`-style "scroll for ratings and contracts →" hint above the two wide tables. Half a day. The full answer is the `PlayerRowMobile` / `BottomNav` pair already sitting in `components/ds/`.

---

## What is already good — do not break this

Several of these are strong enough that a redesign pass could damage them without anyone noticing.

1. **The Scouting Department page.** Wallet, price list with a "what it buys" column, three named lanes with a stated opportunity cost, carryover rules in plain English. The best-taught screen in the product and the template the rest of it should follow.
2. **The prose.** Scouting reports (*"The file is basically closed on this safety — grades out right around 82. What jumps off the tape is zone coverage: elite, full stop. The hole in the profile is man coverage."*) and game recaps (*"It came down to the last possession… Injury report: Jalen Nwosu left the game and is expected to miss 4 weeks."*) both have real voice and vary by situation. This is the product's biggest asset and it is currently delivered in a 320px toast and a wire row.
3. **The cap system, and the cap-compliance wall.** The math is exact, the release/restructure previews are shown before committing, and the wall is the only thing in the game that stops the player — with a reason and a named escape route. It is the pattern for every future gate.
4. **The win-probability explanation on the matchup strip.** *"61% Win · +6% your offense vs their defense — 74 against 66 · +6% home field."* A probability that shows its work. Nothing else in the genre does this as plainly.
5. **The playoff bracket** (`playoff-standings-d.png`). Four columns, seeds, scores, greyed-out losers, "Championship in progress" / "Not yet played". This fully closes an audit finding and it looks right.
6. **The League Wire ranking layer** (`lib/wireRank.ts`). Relevance scoring, a per-type diversity cap with a written rationale, stranger-injury collapse, and an explicit rule that the ticker carries only things you don't need to act on. Thoughtfully built and thoroughly commented.
7. **Team overall + Roster Construction.** `72 TEAM OVERALL · 20th of 32 · 11th in the NFC · 2nd in the East` over eight unit ratings with league ranks and deltas. A complete read of your team in one glance.
8. **The depth chart's diagnostic strip.** `UNMANNED 1 · FB` / `NO BACKUP 5 · LT, RG, RT, K, P` / `OUT OF ORDER 0 · best man starts everywhere`. Exactly the right sentences.
9. **The Trade Center's presentation layer** — personality tags with `?` explanations, cap-space-after, deadline state, "no free lunches". The audit said the UI is right and only the numbers are wrong; that is still true. Do not touch this screen while retuning valuation.
10. **The Standings page**, playoff picture, cut line, streak strips, and its explanatory one-liner.
11. **Speed.** League generation in ~1.5s, a week in under a second, a season in ~25s. On the open web this is a competitive advantage. Do not spend it.
12. **The schedule rebuild.** Your 17 games on top, the league one week at a time below, with week tabs. The 16,000px wall is gone.

---

## What I would deliberately NOT do before launch

**Do not rebuild the trade valuation.** E1–E3 are still open — a future first still buys more than it should, and `lib/trade.ts` documents symmetry as an invariant that evidently doesn't hold. But it is an *M-to-L* investigation into a system whose UI is already right, and the exploit requires a player to go looking for it. A public test will produce better information about where the valuation is wrong than another blind retune will. Ship the trust fixes, watch what testers actually do, then fix it with their saves in hand. (Do, cheaply, make Difficulty actually scale trade acceptance so the tooltip stops lying — that's S.)

**Do not build in-season blocking events.** The playtest audit's Tier 3 "the week must ask for something" is correct and it is the right *next* milestone. It is also an L-sized design job on a loop whose *result screen* doesn't exist yet. Build the result moment first (§4 of the top-10). An event system that fires into a corner toast is wasted.

**Do not redesign the dense screens.** Free agency, the draft board and re-sign are all "too many rows", not "wrong rows". A triage layer on top is S; a redesign is M and risks the parts four independent playtesters named as the best in the game.

**Do not do the mobile project.** Fix the trade-page overflow and the nav affordance and stop. Full mobile is a real information-architecture decision — `/design-system` says so itself — and it should not be made under launch pressure.

**Do not retune the sim's stat volume yet**, beyond checking the team-score spread (§4.4). The record book and awards read wrong for two reasons — inflated volume *and* the award-exclusion bug — and only one of those is cheap. Fix the exclusion, then see whether the record book still looks silly.

**Do not delete the backstory seeding.** It is doing real work — a league with 16 years of champions, a Ring of Honor and a Dynasty Score feels like a world rather than a spreadsheet. It just needs to stop leaking into the GM's own season log (§10) and stop being the ticker's only content on day one (§1.5).

---

## Appendix: screenshot index

All under `…/scratchpad/shots/`. `-d` = 1440px, `-m` = 390px.

| File | View |
|---|---|
| `home-d.png`, `home-top.png`, `home-create.png` | Landing page: full, hero, create form |
| `new-dash-d.png` … `new-settings-d.png` | Brand-new league (PRESEASON wk1), every route |
| `mid-dash-d.png`, `mid-resign-d.png`, `mid-trade-d.png`, `mid-draft-d.png` | 2026 week 13–16, 3-9 record |
| `playoff-dash-d.png`, `playoff-standings-d.png` | Postseason: dashboard and bracket |
| `long-gm-d.png`, `long-hist-d.png`, `long-dash-d.png` | 5-season save (2030) |
| `player-card-d.png`, `game-detail-d.png` | Player card, game detail |
| `m-dash-m.png`, `m-roster-m.png`, `m-fa-m.png`, `m-trade-m.png` | 390px |
| `designsystem-d.png` | `/design-system` |
