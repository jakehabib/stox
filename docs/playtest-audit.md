# Playtest Audit — Dynasty GM Football

**Synthesis of five independent playtest lanes** (first-session, weekly-loop, offseason, depth-and-exploits, long-game).
Focus: **fun and flow**. Not visuals, not code quality.

---

## The verdict in one paragraph

This game's *parts* are better than its *loop*. Four of five playtesters independently named the same three screens as excellent — the free-agency bidding page, the contract builder, and the prose recaps — and all five said they would not start a fifth season. That combination is diagnostic: the failure is not depth, it's **delivery, routing, and the AI's refusal to ever say no**. Most of the fix list below is plumbing between systems that already work. But four things are genuinely broken at the foundation, and no amount of polish survives them: seasons after the first play zero football, the draft can permanently deadlock, the AI trades away its roster for late picks, and no contract offer is ever refused.

**Sequencing note.** The ranking in §1 is by damage. The cheapest high-yield work is actually items 1, 2, and 5 — ship those first. Item 3 (trade valuation) is medium effort and urgent because it destroys motivation on discovery. Item 4 (the week asking for something) is the deepest and largest job, and it should be designed while the others ship.

---

## Convergence map

Convergence is the strongest evidence available. Where several lanes hit the same wall without talking to each other, severity is not a judgement call.

| Finding | Lanes | Read |
|---|---|---|
| The Front Office brief never updates | first-session, weekly-loop, offseason, long-game | **4/5 — settled.** Not a tuning issue; the one "what should I do" surface is furniture by week 6 |
| League Wire is injury spam that buries results | all five | **5/5 — settled.** Highest-convergence finding in the whole audit |
| Repeated storyline/news copy ("Sustained production like that…") | first-session, weekly-loop, long-game | **3/5.** Counted 28x in one DB, 35 stories in another |
| Negotiation is a rubber stamp on re-sign/extend | first-session, offseason, long-game | **3/5 — and code-confirmed** (see §4 E4) |
| The FA bidding page is the best screen in the game | first-session, offseason, depth-exploits, long-game | **4/5 — protect it, and copy it** |
| Team select at league creation gives you nothing to choose on | first-session, weekly-loop, long-game | 3/5 |
| Undefeated teams render `.000` | first-session, weekly-loop, long-game | 3/5 — **root cause found**, one line |
| Playoff results contaminate regular-season records | weekly-loop, long-game | 2/5, both with DB evidence — **code-confirmed** |
| No playoff bracket; header stuck on "Wk 1" all four rounds | weekly-loop, long-game | 2/5 (only two lanes reached the playoffs) |
| Rosters never approach 53; no minimum is enforced | offseason, depth-exploits, long-game | 3/5 |
| AI gives away starters for late picks | depth-exploits, long-game, weekly-loop (unrecognised) | 3/5 |
| First Advance (Preseason → Wk 1) plays no games | first-session, weekly-loop | 2/5 |
| Ticker label renders on top of itself | first-session, weekly-loop, offseason, depth-exploits | 4/5 (cosmetic, but it's the first thing on every page) |

### The distinction that governs this whole document

Roughly **two-thirds of the complaints in these reports are about things that already exist.** Treating them as missing features would mean rebuilding working systems and shipping nothing that fixes the actual experience. Three categories, three completely different fixes:

- **MISSING** — the thing does not exist. Build it. (Season-2 schedule; roster minimums; any acceptance model on extensions.)
- **INVISIBLE** — it exists and works, and the player never found it. Route to it. (The box score. The cap-mode explainer copy. The scouting economy.)
- **UNCLEAR** — the player found it, and read it wrong. Rewrite it. (ROSTER NEEDS; the depth chart's "UNMANNED 0".)

The ledger in §A assigns every major complaint to one of these three.

---

## 1. The five things hurting this game most

### 1. Seasons after the first play zero football — and the record book quietly lies about it
**Lane:** long-game (single lane — but the strongest evidence in the entire audit, and I confirmed the root cause in the code).

Two independent leagues, DB-verified: 2026 played 283/283 games; 2027 played 4; 2028 scheduled 4 playoff games and played 0. Advancing week by week does not help — the toast reads *"Week 1 complete: 0 games played,"* *"Week 2 complete: 0 games played,"* and the Advance button stays green. The player is never told anything is wrong. The only tell on the dashboard is an absence: the next-opponent strip simply stops rendering.

**Code confirms it.** `buildSchedule()` in `lib/schedule.ts` is called from exactly one place — `lib/gen/league.ts:239`, at league creation. The offseason pipeline in `lib/season.ts` is `OFFSEASON_STEPS = ['PROGRESS','RESET_STANDINGS','AGE_CONTRACTS','ADD_DRAFT_CLASS','RESIGN']`. There is no schedule-generation step anywhere in it. A league is born with 272 games in the table and never gets another one.

**Merge warning for the backlog:** long-game reports this as four separate HIGH items — "franchise history is a graveyard," "awards become jokes" (2028 MVP with 179 rush yards), "nothing accumulates," "career stats stop growing." **These are one bug, not four.** Do not open four tickets. But do not discount it either: this single defect deletes the entire premise of a dynasty game, and every long-arc feature the team has already built — GM Career, Ring of Honor, records, retrospectives — is currently pointed at an empty room.

**Downstream and separately real:** playoff W/L is written into `team.wins/losses` with no phase guard (`lib/season.ts` `updateStandings`), and `TeamSeasonRecord` is then created straight from `t.wins` — hence "2026 Champions (19-1)" on a 17-game season, 20-game division tables, and a champion displayed 3rd in its own division. That one needs its own fix and is small.

---

### 2. The draft deadlocks silently, and the run ends there
**Lane:** offseason (single lane, but it is a hard stop and it recurs every round).

Player makes their round-1 pick, comes back on the clock at 34, clicks Draft. Nothing. No toast, no red text, no disabled button. Eight prospects, eight page loads, all with live-looking green Draft buttons. The draft sits at 33 of 224 forever.

The server knows exactly what's wrong and says so beautifully:

> *"Rookie deal blocked by the salary cap — Cleveland Gales would be $2.95M over (adds $6.14M against $3.19M of room). Ways out: cut Carter Broussard (QB) to free $17.6M; restructure Quinton Ramsey (EDGE) to free $13.3M"*

**It is thrown as an unhandled 500 and the player sees zero characters of it.** The tester only found it by attaching a console listener.

This is the purest example of the audit's central theme: the good work is done and it is invisible. It also hits precisely the players who engaged most — anyone who spent their cap in free agency. A normal player closes the tab and does not come back. Note the secondary flaw: the suggested escape is sorted by raw savings, so at $2.95M over it tells you to cut your 93-OVR franchise QB. It should propose the *smallest sufficient* move, not the largest.

---

### 3. The AI never says no in a way that costs you anything
**Lanes:** depth-and-exploits (quantified), offseason, long-game, first-session. **4/5.**

Three separate systems, one root failure: nothing on the other side of the table has a reservation price.

- **Trades.** 12 minutes, no games played, no money spent: roster power 72.7 (17th of 32) → 82.8 (3rd), five 93+ players. One 2027 first bought Atlanta's five best starters at *228% of the acceptance line*. On **LEGEND difficulty with "AI accepts lopsided trades" off, 6 of 6 partners accepted** the same one-first-for-your-best-player offer — Rookie only accepted 4 of 6. Difficulty is scaling the wrong thing.
- **Extensions / re-signs.** $900K offered against a $9.60M market est. — signed, 4 years, instantly. Repeated on a 76 OVR RB at $800K against $7.50M — signed, and **cap space went up**. `extendContract()` in `lib/freeagency.ts:128` calls `assertCapRoom` and nothing else. There is no acceptance model in the code at all. This isn't mistuned; it doesn't exist.
- **Free agency** does it right, two clicks away, on the same data. That's the proof the fix is cheap.

**Why this outranks almost everything else:** a GM sim is a series of "can I get this, and what does it cost me." When the answer is always yes, every other system stops mattering. The depth-exploits tester's line is the one to keep: *"I stopped playing the game and started operating it."*

Two aggravating factors, both cheap: trade-acquired contracts carry **$0 dead money** (so the algorithm-optimal move after fleecing the league is to shred your own homegrown players and keep every stolen star — exactly backwards), and at preseason week 1 all of the user's picks are labelled "(proj. #1)" while the AI's read "(proj. #27)", so firsts are worth ~1.83x their true value before a single game is played.

---

### 4. The week asks you for nothing, and there is a Skip button next to it
**Lanes:** weekly-loop (hard numbers), first-session, long-game. **3/5, plus depth-exploits found the one exception.**

A full 17-week season, measured: **one prompted decision.** One trade offer all year. Zero injuries that forced a depth-chart change. Zero waiver claims. Zero holdouts. Zero ultimatums. **Nothing ever blocked an Advance.** Weeks 5–17 the brief was byte-identical week over week — the only character that changed in 13 weeks was one market rate. The week-9 deadline came and went without a "last call" beat.

And the game hands you the exit: **Advance → ▾ → Advance to Playoffs = 3 clicks, 8.4 seconds, 17 weeks gone**, including an unanswered trade offer that the skip did not pause for.

The league around you is also inert, and it's arithmetic rather than vibes. Full-season transaction counts for 32 teams: `INJURY 235 | NEWS 152 | DEV_MILESTONE 28 | TRADE 1 | SIGN 1`. **The only trade in the entire league all season was the player's own.** Zero AI-to-AI trades, zero signings, zero cuts, zero in-season firings.

**The pattern already exists and it works.** The cap-compliance wall — a red banner, *"The week will not advance until you are compliant,"* a "Fix the Cap" deep link, and a "FASTEST ROUTE BACK" list of named players with exact savings — is the only thing in the game that stops the player, and the adversarial tester called it *"the one moment in the whole session where I felt a consequence I'd actually earned."* Every in-season event should be built on that template: a gate, a reason, and a helping hand.

---

### 5. Everything that happens is delivered as spam, or not delivered at all
**Lanes:** all five. **5/5 — the highest-convergence finding in the audit, and the cheapest fix on this list.**

The writing in this game is genuinely good. It arrives buried:

- Advance a week and the wire returns **1 game recap followed by 11 cards of "N injury report(s) from LAX @ SDG"** — hamstrings belonging to teams the player has no relationship with. Not one of the other 15 scores. In week 17 the top ticker on every page was 14 items, all of them injury reports for strangers. Signal-to-noise on the "living league" feed is roughly 1:11, and inverted.
- The single most repeated string in one league's news DB is *"Sustained production like that is starting to show up in his game"* — **28 identical instances.** Five of six wire items on a typical week were that sentence with a different name.
- Storylines gets 2 of 4 things right ("dropped 3 straight" stung; "27 passing yards from 1,000" made a tester want to advance) and then runs *"Trey Vasquez is 1 interception from 3 this season"* verbatim across **weeks 7–17 and all four playoff rounds.** He finished with 2. Fifteen consecutive screens of a stuck counter about a backup safety's third interception.
- The result of the thing you are playing for has **no moment.** Click Advance, 3.7 seconds, the header changes 0-0 → 0-1, and the hero card has already flipped to next week's opponent before you've read that you lost.
- **The box score is not missing.** One tester called the game detail page *"the best screen in the app — I clicked into games I wasn't even part of."* Another spent 30 minutes concluding it doesn't exist. It is linked from **exactly one place in the entire codebase**: `app/league/[id]/schedule/page.tsx`. Nothing on the dashboard, in the wire, or in standings links to a game.

This is the best return per hour of work anywhere in this document. The content is written, the box score is built, the recap engine has real voice. It needs a result screen and a wire that ranks by relevance.

---

## 2. Flow breaks

Specific places a player stalls, gets lost, or doesn't know what to do next.

**Before the first snap**
- **League creation asks for three decisions it refuses to explain.** Cap Mode (Off/Simplified/Realistic), Difficulty (Rookie→Legend), Starting Situation — zero tooltips, zero `title`, zero `aria-label`. The excellent explanatory copy *already exists* on the SYSTEM page, readable only after committing to a save. This is an INVISIBLE problem, not a MISSING one: move the copy, don't write it.
- **"CHOOSE YOUR FRANCHISE" is 32 identical rows** of city/nickname/division. Three lanes flagged it independently. The most consequential decision in the game is a coin flip; one tester picked on the strength of the nickname, another went 4-13 with an "Urgent" hole they had no way to see.
- **The Offseason Roadmap renders all-green with "New Season" highlighted on a brand-new league.** The first thing a new player sees says they missed four phases of content. It then vanishes permanently after one Advance.
- **The first Advance plays no football.** Preseason Wk1 → Regular Season Wk1: 4.7 seconds, a label change, no game. The game's main verb produces nothing on its first use.

**In-season**
- **Home → ROSTER NEEDS → "Browse →" is a dead end.** It drops you on unfiltered Free Agency without preselecting the position it just named. In one league the named position (LT) had zero players in the pool — and the position tabs are derived from the pool's contents, so there was no LT tab either. The player follows the game's own advice into a blank wall.
- **All 32 team names on the Standings page link to your own roster.** Thirty-two affordances that look like scouting and silently aren't. There is no path anywhere to view an opponent's roster.
- **Standings opens on NFC North regardless of your division.**
- **The matchup card is a terminus.** "AT Cleveland · 32% Win" is a genuine anticipation hook and it is not a link. You cannot click through to see *why* you're a 32% dog.
- **Schedule is a ~16,000px wall** of all 272 league games with no week filter and no emphasis on your own games — which is also the only place the (excellent) box score is reachable from.
- **The depth chart tells you to fix something you cannot fix.** With the only center injured: "UNMANNED 0 — every spot covered", "STARTER OVR 69.0" (unchanged), "INJURED STARTERS 3 — reorder before kickoff." The C card has one row and it's the injured player. No stated consequence for Sunday. The `INJ` badge doesn't say how many weeks — the tester opened three player pages to assemble their own injury report.
- **Scouting spends a currency with no visible wallet.** Buttons read "Assign Scout (40 pts)" / "Focus Report (100 pts)". The balance appears on no page the player visits. Clicking Assign Scout a second time produces byte-identical output with no message and no disabled state.
- **Losing a free-agent bid looks exactly like winning.** The offer form is replaced by a contract summary with green progress bars and a cap hit. The only tell is the rival's name in a header line. One tester had to query the database to learn they'd lost.
- **Post-deadline trade offers still show live Accept buttons** that fail after the click.

**Playoffs**
- **The header reads "PLAYOFFS 2026 · Wk 1" for all four rounds.** You cannot tell which round you're in.
- **There is no bracket anywhere.** Seeds appear as "#1"–"#6" tags in standings and that is the entire postseason UI. A player has less information about their own conference championship than about a week 3 game.
- **The brief is blind to the season ending** — at Playoffs Wk1, having missed the playoffs, it still offered "Browse Free Agents" and "1 trade offer waiting" (trades closed in week 9).
- **The season-complete + awards card is visible for exactly one Advance click, then unreachable forever.** One tester blew past two of their three championships.

**Offseason**
- **Five consecutive "Housekeeping" advances** (`PROGRESS`, `RESET_STANDINGS`, `AGE_CONTRACTS`, `ADD_DRAFT_CLASS`, `RESIGN`). Each returns a summary line — but as a transient toast over a page that doesn't visibly change, so the tester's read was "nothing happened, five times." UNCLEAR, not missing.
- **The roadmap doesn't track where you are.** It sat on "Housekeeping" for four advances while the year silently rolled 2026 → 2027, and still showed "Rookie Draft" as active after the draft finished 224/224. None of its five stages is clickable; Re-sign lives three levels deep under TEAM.
- **`/resign` and `/free-agency` are fully playable before their phases open.** One tester completed the entire re-sign window and signed a free agent away from Miami — then the game announced "RE-SIGN WINDOW OPEN" and handed them the list again.
- **Losing nine players is announced as `484 unsigned player(s) hit free agency.`** No names, no count of *yours*, no list. The roster counter quietly went 42 → 33.
- **The draft starts without you.** No Draft Day screen, no "Begin Draft," no lobby — pick 1 fires while you're still reading the page.
- **You are "on the clock" with no clock.** AI picks get a 1-second countdown with Pause / Fast Forward; the human gets nothing. One tester sat on the clock for 13+ seconds, crashed a page, came back, re-filtered the board, and the draft waited patiently.
- **After you pick, the page appears to have done nothing.** It reloads and still reads "PICK 2 OF 224 — YOU ARE ON THE CLOCK" with Recent Picks unchanged. One tester learned they had landed a 94 OVR / 99 potential receiver *by querying the database.*
- **"Fast Forward to My Pick" took 60.7 seconds** to cover nine AI picks — then the next 31 resolved instantly after the human's pick. The wait is demonstrably avoidable.
- **The draft ends and the page immediately becomes "2028 DRAFT CLASS."** No "Your 2027 Draft Class," no grade, no summary of the seven players you just took.
- **24 contracts expire at once** with no sort, no filter, no starter badge, no snap counts, no production, and no recommendation. That's data entry, not a decision. Randomized rosters hand everyone matching contract lengths; staggering them would produce 3–5 sharp choices a year instead of 24 identical form submissions.

---

## 3. Missing fun

### Data with no decision
- **Storylines** is a read-only ticker. Every row is a fact; none is a lever. "Reggie Mercer is 27 passing yards from 1,000" is a genuinely good hook attached to nothing you can do.
- **ROSTER NEEDS** names a hole and its only action is a broken link.
- **The League Wire's dominant content** — injury reports for teams in another conference — is data with neither decision nor interest.
- **Standings, stats, and the matchup card** present the league and offer no path into it. You cannot open an opponent's roster from anywhere.
- **`devTrait` exists in the database and never appears on screen.** The game is tracking Star / Superstar / Slow developers and telling the player nothing. That is a whole layer of attachment sitting unused.
- **Player development is invisible.** A R2 QB went 71 → 76 and a R6 CB 62 → 64 across an offseason. Nothing anywhere mentioned it; the tester found out by reading the DB.

### Decision with no consequence
- **Any re-sign or extension price.** 85%, market, 115%, 130%, or $1 — all sign. The four preset buttons are decorative; one tester compared all four and a $1M offer and found the UI byte-identical apart from the cap math.
- **Void years +2 and +3 produce identical numbers to +1** — a lever the game explicitly explains in body copy and then ignores.
- **Scouting a free agent.** Signing instantly reveals the true rating at 100% confidence (57–66 MEDIUM → "61, we know what this player is"). The optimal play is never to scout, just sign and read the answer. There is no possible post-signing regret — which is the emotion the whole system exists to produce.
- **Scouting a draft prospect for OVR.** The free, unspent "SCOUTED" midpoint correlates **0.833** with true OVR at ±3.6; the prominent free consensus rank correlates 0.52. One click on the column header produces a near-perfect board.
- **Difficulty.** Legend accepted *more* lopsided trades than Rookie (6/6 vs 4/6) despite a tooltip promising the opposite.
- **A second Assign Scout click.** Identical output, no message.
- **Cutting your only QB, K, and P.** The sim shrugged and played on — 230 passing yards with nobody on the roster who can throw, and a 7-0 team went 7-2. Total cost of having no quarterback: about two losses. The dashboard's comment was *"QB is your thinnest position."* It was empty.
- **Depth chart management,** because "Auto-Sort by Rating" is a one-click solve for every situation the game ever creates.

### Consequence with no feedback
- **Nine of your players walk** → `484 unsigned player(s) hit free agency.`
- **Four weeks of free agency** → three integers (`26 / 38 / 45 AI signing(s) league-wide`). Behind them the market genuinely worked: best available fell from a 93 LT to a 71 FB and the pool went 624 → 474. **The top 40 players in football changed teams and the player got three numbers.** An entire news cycle thrown away.
- **Accepting your only trade of the season** → no toast, no "Welcome to Pittsburgh," no roster highlight. Cap and pick counts quietly changed.
- **Making the #2 overall pick** → a page that looks like it did nothing.
- **Waiting on a contract cost real money** — Quarles's ask rose $6.30M → $6.90M — and the game never says so. "His price went up $600K since Week 1" turns a repeated nag into a lesson.
- **Coach firings all fire simultaneously after the Super Bowl.** In-season the league never reacts to anything.
- **The trade deadline passes with no beat at all.**

---

## 4. Exploits / broken systems

Ordered by how fast a normal player finds them. The first two are found in hour one.

**E1 — One future first buys a starting core.** *(depth-and-exploits, quantified; corroborated by long-game and, unrecognised, by weekly-loop)*
1. New league → Trade Center → partner Atlanta.
2. In *You receive*, click their top 5 by OVR. In *You send*, click 2027 R1. Propose.
3. **Accepted at 228% of the acceptance line.** Confirm & Execute.

Repeatable across partners: 2028 R1 → a 95 C + 94 RB + 94 DT (127%); 2027 R3 → a 73 DT (1465%); nine junk R5–R7 picks → a 94 OVR age-23 safety (124%). Roster power 72.7 (17th) → 82.8 (3rd) in ~12 minutes, still in preseason week 1. **Clean repro on LEGEND with "AI accepts lopsided trades" off: 6 of 6 partners accepted.**

**E2 — The exchange rate is one-directional (~7–8x), so the player can never be made whole.** Same partner, back to back: my 2029 R1 → their 81 OVR starting QB = 161% **accepted**; my 90 OVR S → their 2029 R1 = 13% **rejected**; my 90 OVR S → their 2029 **R4** = 161% **accepted**. There's no farmable loop, but the broken direction always favours the human. Note that `lib/trade.ts` documents symmetry as an invariant ("Value is computed with the SAME playerValue/pickValue functions in both directions") — so the defect is in calibration or in the projected-slot input, not an obvious directional multiplier. Worth finding before retuning blind.

**E3 — Sell your firsts in preseason, when they're priced as #1 overall.** At 0-0 all seven of the user's 2027 picks were labelled "(proj. #1)" while a partner's read "(proj. #27)" — despite that partner having the 31st-best roster and the user the 17th. Straight-up R1-for-R1 evaluated at 183%. By week 6 at 5-0 the labels corrected to "(proj. #31)", so the projection is dynamic — it's simply meaningless before any games are played. A timing exploit stacked on top of E1.

**E4 — Re-sign anyone for scraps, and gain cap space doing it.**
1. Re-sign window → open any row. Panel reads "Market est. ~$9.60M/yr."
2. Type **$900,000**. Click Sign Extension once.
3. Signed, 4 years, no confirmation, no agent reaction, no rejection risk.

Reproduced on a 76 OVR RB at $800K against a $7.50M market — and **cap space rose $8.53M → $10.8M** because the new deal undercut the old one. The optimal play for the entire re-sign window is "open every row, type 1, sign." You keep your whole roster *and* get richer. Meanwhile the AI delegate paid full freight for an identical player. **Code-confirmed:** `extendContract()` performs a cap check and nothing else — there is no acceptance model to tune.

**E5 — Sign-then-see beats scouting.** Sign any free agent and his true OVR is revealed at 100% confidence immediately. Never scout a free agent.

**E6 — Sort the draft board by the free column.** The unspent "SCOUTED" midpoint (r = 0.833, mean error ±3.6, unbiased) is one click from being the board. Its top 7 rows were true 95, 95, 94, 90, 91, 88, 87 — players the visible consensus ranked #2, #16, #30, #27, #15, #29, #34. *Credit where due: potential is genuinely fogged (r = 0.516), and that is the half of scouting worth paying for.* The fix is to widen or noise the OVR range, or drop the midpoint and show only the noisy consensus — not to rebuild scouting.

**E7 — Turn the cap off for three clicks.** SYSTEM → League Settings → Salary Cap Mode → Off → Save (no confirmation, no warning, no "this modifies your save"). Free Agency → the disabled `Not Enough Cap Space` button becomes `Offer Contract`. Sign the #1 free agent at $138.1M/5yr **while $142M over the cap**. Sign four more. Flip back to Realistic — the contracts stay. The same page carries **"Reveal true ratings everywhere (debug)"** as an ordinary checkbox two rows from Difficulty, which deletes the entire fog-of-war system in one click.

**E8 — Skip the game you're playing.** Advance → ▾ → Advance to Playoffs: 3 clicks, 8.4 seconds, 17 weeks, zero results seen — and it advances straight past an unanswered trade offer.

**E9 — Play with 22 men and no quarterback.** After cap-forced cuts a roster of `{RB:2, WR:3, TE:3, LT:2, LG:1, C:1, RG:1, EDGE:1, DT:3, LB:1, CB:1, S:3}` — no QB, no K, no P — simulated four more weeks and cost roughly two losses. **No roster minimum is enforced anywhere.** League-wide after one offseason: rosters ran 26–43 against a 53 requirement, with 1,641 free agents against 1,060 rostered players (61% of the league unemployed) and only 32 retirements in two offseasons.

**E10 — Trade-acquired contracts carry $0 dead money.** Every fleeced star is cut-at-will; every homegrown player carries $7M+ of dead money. When the cap wall finally bites, the optimal move is to shred the players you drafted and keep the ones you stole.

**Not an exploit but a first-30-minutes trap: "Fill Roster."** An unlabelled top-right button with no tooltip. One click, 3.0 seconds, no dialog, no preview, no undo: roster 46 → 51, **cap space $39.6M → $8.09M**, five multi-year contracts the player never chose. `components/FillRosterButton.tsx` has no confirmation step. And SYSTEM contains a checked setting called **"Confirm risky moves (stored only)"** — the confirmation that would have saved this player exists as a checkbox explicitly wired to nothing.

---

## 5. What already works

Named precisely so it doesn't get redesigned. These are not compliments; they're constraints on the fix list.

1. **The free-agency bidding moment.** Named rival, exact figure (*"New Jersey Highlanders is in the mix at ~$3.84M/yr — you need to beat that"*), a **"Beat Highlanders's Offer"** preset, and a submit button that relabels itself **"Offer Contract (Currently Losing)"** in red. **Four of five lanes named this independently as the best decision UI in the product.** It is the template every other negotiation screen should be rebuilt against. One tester lost a player they genuinely couldn't afford and called it fair — which is the emotional proof that the rest of the offseason *could* feel that way.
2. **The cap-compliance wall.** The only thing in the game that stops the player: a red banner, *"The week will not advance until you are compliant,"* a "Fix the Cap" deep link, and a "FASTEST ROUTE BACK" popover listing 18 named players with exact savings plus *"A restructure or a trade that sends salary out works too."* The adversarial tester spent ~27 cuts and $23.2M in dead money getting back to compliance and called it the one earned consequence of the session. **This is the working prototype for every in-season event gate the game needs.**
3. **The cap math is exact.** Verified to the dollar: restructure with 3 void years moved a hit $18.7M → $6.79M and a release cost $14.0M → $46.3M, both shown *before* committing; the subsequent cut moved committed money +$39.5M and dead money to $46.3M. $46.3M − $6.79M = $39.5M. The simulation underneath is honest.
4. **The contract builder.** Length, front-load↔back-load, void years, total value, guaranteed, live cap-space-after, and a per-year cap-hit strip with a plain-English warning about void-year acceleration. Back-loading a deal from $13.8M to $9.99M in year 1 to squeeze a player under the cap — at the cost of $16.6M in year 4 and $3.09M of dead money — was named **"the single best moment of my run."** That is a real GM trade-off with a real future bill.
5. **The game detail page.** Full box score, team stats, pass/rush split, turnovers, sacks allowed, penalties, both sides' leaders, and a written recap. *"The best screen in the app — I clicked into games I wasn't even part of."* It needs links, not work.
6. **Recap prose has genuine voice** and varies by game shape (blowout / one-score / turnover-driven). *"It came down to the last possession. The New York Aviators survived 17-13. Turnovers told the story… Injury report: Micah Alvarado left the game and is expected to miss 5 weeks."* A loss, a reason, a villain, and a consequence in one paragraph.
7. **Scouting reports read like a person wrote them, and they change as confidence rises.** *"The standout tool is tackling — elite, full stop; the soft spot is straight-line speed."* Per-attribute *ranges* rather than fake precision, combine numbers with class percentiles ("40-YARD 4.54s, 5th of 25"), and an honest *"Essentially unscouted. Anything we say right now is a guess."*
8. **The Trade Center's presentation layer.** AI personality tags that are *explained* ("Rebuilding / Aggressive trader / Hoards picks," each with a `?` describing what it changes), "no free lunches" in the header, deadline shown, cap-space-after preview, and a Trade Score bar normalised so 100% = the acceptance line, with reason bullets. The adversarial tester's own words: *"which is exactly why I was able to break it so fast."* **The UI is right; only the numbers are wrong.** Do not touch this screen while fixing E1–E3.
9. **Team philosophy creates real variance.** A conservative contender rejected everything (15% on a 2029 R1 for their two best linemen) while a retooling team handed over its roster; one partner said no at 71%, another at 99%. That's the correct *shape* of a trade market.
10. **Trade retrospectives.** *"2026 · Wk 5 · vs DEN — Too early to call. YOU RECEIVED: 118 → 126 (+7%)… DEN RECEIVED: 2029 Round 3, still on the board."* Grading a decision against how it aged is exactly the long-tail hook a dynasty game needs.
11. **GM Career + the "YOUR MOVES" ledger** with identity badges (*"Quiet Front Office — just 1 trade in 3 seasons, you draft and develop, not deal"*). Two lanes named it as a reason to come back.
12. **The Standings page** (as distinct from the dashboard widget): conference playoff picture with seeds, bye/division/wild-card banding, an explicit CUT LINE row, games-back, and a five-game colour streak strip.
13. **The depth chart's summary line** — *"NO BACKUP 7 — one injury from a hole."* Exactly the right sentence. It's on the wrong page.
14. **The roster page** — grouped by unit with "5 players · avg 56.2 OVR · $9.48M" headers, STARTER tags, cap hit, years left, and inline season stats once games are played. One tester found their best player in eight seconds.
15. **The draft board** — consensus tiers, colleges, sortable columns, position chips that collapse to your shortlist's positions, live shortlist count. It looks and feels like a war room.
16. **The over-cap error on re-sign:** *"Year 1's cap hit exceeds your available space — lower the salary, front-load less, or clear room elsewhere."* Names the problem and three fixes. The draft has an equally good message and throws it into a console.
17. **ROSTER NEEDS genuinely reacts to events** — bland "Moderate" bars in preseason became RB Urgent / QB Urgent / WR High / CB High after losing nine players.
18. **The AI free-agent market actually clears** — 624 → 474 with the entire top of the board gone in four weeks. The simulation is doing the right thing; only the presentation fails it.
19. **Speed.** League creation 1.2–1.7s, a week ~600ms–2s, a full 17-week season in ~25s, a 300-prospect board instant. **No tester ever complained about waiting** — except for "Fast Forward to My Pick," which is artificial. This is the right speed for a dynasty game; protect it.

---

## A. Invisible, not missing — the ledger

Getting this wrong means rebuilding something that already works and shipping nothing that helps.

| Complaint | Status | The actual fix |
|---|---|---|
| "There's no box score anywhere" | **INVISIBLE** — built, called the best screen in the app, linked only from `/schedule` | Link it from the result card, the wire, standings, and the matchup card |
| "Setup never explains cap mode or difficulty" | **INVISIBLE** — the copy is written and excellent, on the SYSTEM page | Move the paragraphs under the toggles |
| "Scouting is unreachable / a 500" | **INVISIBLE / ENVIRONMENTAL** — `Team.scoutPoints`, `scoutPeriod`, `scoutPeriodGrant`, `scoutSpentSeason` all exist in `prisma/schema.prisma` with a documented economy in `lib/scoutingEconomy.ts`; `npm run build` runs `prisma db push` | Verify the deploy before designing anything. `Unknown field 'scoutPoints'` is a stale client / un-pushed dev DB. **Do not rebuild scouting.** One lane also caveated a shared dev server |
| "Scouting points have no wallet" | **INVISIBLE** — the economy tracks the grant ("x of y") | Surface the balance in the header and on every card with a spend button |
| "Housekeeping does nothing, five times" | **INVISIBLE** — all five steps return a summary line | Make the page state change, not just a toast |
| "ROSTER NEEDS said my best unit was my problem" | **UNCLEAR** — it means "no backup here," not "you're bad here" | Steal the depth chart's wording: "one injury from a hole" |
| "UNMANNED 0 while my only C is injured" | **UNCLEAR** — the metric counts bodies, not available bodies | Count injured players as unmanned; state Sunday's consequence |
| "Undefeated teams show .000" | **UNCLEAR (bug)** — `components/ds/StandingsTable.tsx:29` uses `.toFixed(3).slice(1)`; the standings *page* correctly uses `.replace(/^0/,'')`, which is why one tester saw both | One line in one shared component |
| "The AI never contacts me" | **TUNING + DELIVERY**, not missing — offers exist at roughly 0.35/wk and one lane got two waiting at once | Raise the rate, and make an offer *arrive* rather than sit in a box |
| "No LT exists in free agency" | **PARTLY REAL** — `LT` is in the canonical position list; the FA tabs are derived from the pool's actual contents, so that pool truly had none | Fix pool composition; deep-link "Browse →" to the named position; say "no LTs available" instead of showing an unfiltered list |
| "Seasons after the first don't play" | **MISSING** — `buildSchedule` is called only at league creation | Add a schedule step to the offseason pipeline |
| "The re-sign window can't tell me no" | **MISSING** — `extendContract` has no acceptance model | Build one; copy the FA competition model |
| "Rosters are never legal" | **MISSING** — no minimum is enforced anywhere | Add a cutdown/fill-to-minimum gate on the cap-wall pattern |
| "There's no playoff bracket" | **MISSING** | Build it; also increment the round counter |

---

## B. Where the reports are wrong or overstated

Aggregating these uncritically would waste real effort.

1. **"No box score anywhere" (first-session) is false as stated.** It exists, it's excellent, and it's linked from `/schedule`. The tester's actual experience — never finding it in 30 minutes — is a serious routing failure, and it's the *right* complaint filed under the wrong heading. If this goes into the backlog as written, someone builds a second box score.
2. **long-game's four HIGH items are one bug.** "History is a graveyard," "awards are jokes," "nothing accumulates," "career stats stop growing" all follow from zero games being scheduled after season 1. One fix, not four. Their 2027/2028 award anomalies (a DPOY with 4 tackles) are symptoms and will vanish on their own — don't retune the awards engine chasing them.
3. **weekly-loop and long-game disagree about the sim, and both are right.** weekly-loop reports *inflation* (1,059 pass attempts, 186 receptions, 20 QBs with 30+ TD); long-game reports *compression* (tackle leaders reading 41, 40, 39, 39, 39, 39, 39, 39, 39, 39). These are not contradictory — the distribution has high volume and almost no variance. The correct fix is one job: widen per-player variance and cut passing volume. **Do not "fix the recap writer."** A recap saying a team "leaned on the run" about a QB who threw 64 times is correct logic reading absurd inputs.
4. **weekly-loop's "one decision in 17 weeks" slightly overstates the design flaw.** Depth chart, trade center, and free agency were all open and, as depth-and-exploits proved, extremely consequential. The real defect is narrower and more actionable: nothing is ever *demanded* or *time-boxed*. Framing it as "the game has no decisions" invites building new systems when the existing ones just need to be routed to.
5. **depth-and-exploits' scouting 500s should not be designed around.** They caveated it themselves ("shared dev server"), first-session used Assign Scout successfully, and the schema is fully present. Reproduce on a clean build before anyone touches the scouting economy.
6. **offseason's "the escape hatch tells you to cut your franchise QB" and depth-exploits' praise for "FASTEST ROUTE BACK" are the same feature, judged oppositely — and both are right.** Sorting by raw savings is correct when you're $170M over and absurd when you're $2.95M over. This only becomes visible by merging the two reports. Fix: propose the smallest sufficient set of moves, not the largest.
7. **"3rd · AFC East at 0-0 is fake precision" (first-session) is overstated.** A standings table has to print something before week 1. Hide the rank until a game is played, or label it as a tiebreak order. Low priority.
8. **long-game's "'Not Re-sign' does nothing — I clicked it 45 times"** used odd methodology (45 separate page loads) and the count did move once. But offseason independently found the same class of failure in "Let the AI Pick" (returning "kept 0, let 0 walk" with 9 players pending, and the button vanishing until a manual reload). Treat as one confirmed defect — re-sign decisions don't persist or acknowledge — rather than two.
9. **The ticker overlap is a rendering bug, not a design problem.** Four lanes flagged it, which will read as a top-tier finding in any naive tally. It is a small CSS/duplicate-render defect. It's on the fix list only because it's the first thing on every page.
10. **first-session's "the depth chart gives me no way to fix an injured lone center" conflates two things.** The reorder UI works fine; what's missing is out-of-position emergency fill and a stated consequence for Sunday. Building a better reorder control would fix nothing.

---

## 6. Prioritised fix list

Ranked by experience gained per unit of effort. Effort: **S** ≈ hours, **M** ≈ days, **L** ≈ a week-plus of design and build.

### Tier 0 — the game cannot be played without these

| Fix | Why it matters | Effort |
|---|---|---|
| Generate a schedule at season rollover | Seasons 2+ play zero games. Every long-arc feature already built points at an empty room. Nothing else on this list matters until this ships | **S** |
| Surface the draft's cap-block error instead of throwing a 500 | Run-ending deadlock that hits exactly the players who engaged most. The message is already written and excellent — it just needs to reach the screen | **S** |
| Exclude playoff games from `team.wins/losses` and `TeamSeasonRecord` | "2026 Champions (19-1)" tells the player the history page is untrustworthy, which poisons every number on it | **S** |
| Enforce roster minimums with a cutdown gate | You can play with 22 men and no quarterback; no team in the league ever reaches 53 | **M** |

### Tier 1 — highest fun per hour

| Fix | Why it matters | Effort |
|---|---|---|
| Give the result a moment: a post-Advance screen owning the page, recap prose as centrepiece, score, injuries, clickable box score | 5/5 lanes. The single most-repeated complaint, and every ingredient already exists | **M** |
| Rank the League Wire by relevance to *your* team; collapse other teams' injuries into one digest line; put the other 15 scores in | Signal-to-noise is 1:11 and inverted. Cheapest possible restoration of "living league" | **S** |
| Link the game detail page from the result card, the wire, standings, and the matchup card | The best screen in the app is reachable from one place. Zero new build | **S** |
| Make the Front Office brief react to this week's events (injured starter with no backup, expiring deal whose price just rose, deadline is Friday) | 4/5 lanes. The one "what should I do" surface becomes furniture by week 6; a reactive brief is the cheapest heartbeat available | **M** |
| Kill duplicated storyline/news copy; raise milestone thresholds to things a fan would notice; clear a storyline once it stops progressing | "1 interception from 3" ran for 15 consecutive screens. 28 identical sentences in one DB | **S** |
| Add a confirm sheet to "Fill Roster" listing who and for how much, and show "46 / 53" on the roster strip | One curiosity click deletes 80% of a new player's cap in 3 seconds with no undo. The confirm setting already exists as a checkbox wired to nothing | **S** |
| Move the SYSTEM page's cap-mode and difficulty explanations under the setup toggles | Three explained decisions the player currently makes blind. The copy is written | **S** |
| Fix `.toFixed(3).slice(1)` in `components/ds/StandingsTable.tsx` | The best team in the league renders as winless on the dashboard, in week 1, on the home page | **S** |
| One-line verdict per team on the franchise picker ("Aging roster, $41M of room, no franchise QB") | 3/5 lanes. The most consequential decision in the game is currently a coin flip | **S** |
| Playoff round names in the header + a bracket | Four rounds are indistinguishable from each other and from a regular week; the header reads "Wk 1" throughout | **M** |
| Persist the season-complete/awards card somewhere reachable | The best moment in 17 weeks is visible for exactly one click; testers blew past their own championships | **S** |

### Tier 2 — stop the game from playing itself

| Fix | Why it matters | Effort |
|---|---|---|
| Fix AI pick↔player valuation symmetry; cap starters sent per deal | A 2027 first buys five starters, on Legend, 6/6 partners. Once found, no other system matters. Note `lib/trade.ts` documents symmetry as an invariant — find why it doesn't hold before retuning | **M** |
| Add an acceptance model to `extendContract` (demand, insult threshold, rejection risk, rival interest) | Type $900K against a $9.60M market and he signs — and your cap space goes *up*. Copy the FA screen's competition model wholesale | **M** |
| Give trade-acquired contracts real guarantees | $0 dead money on every fleeced star makes shredding your homegrown roster the optimal move | **S** |
| Don't price picks off a preseason projection; freeze or widen it until games are played | All user picks read "(proj. #1)" at 0-0 — a timing exploit stacked on the valuation exploit | **S** |
| Widen or noise the free "SCOUTED" OVR range (or drop the midpoint) | Its midpoint correlates 0.833 with truth and is one column-click from being the board. Leave potential alone — it's genuinely fogged and it's the good half | **S** |
| Don't reveal true OVR on signing a free agent | Removes the entire point of scouting the FA pool, and makes post-signing regret impossible | **S** |
| Gate cap-mode and "Reveal true ratings (debug)" behind a confirmation and a modified-save marker; remove "(stored only)" dev copy from the player-facing UI | Three clicks turn the cap off mid-season and the signings persist after turning it back on | **S** |
| Make "Advance to Playoffs" stop on pending decisions | The skip button currently skips the one decision the game generated | **S** |
| Make difficulty actually scale trade valuation | Legend accepted *more* lopsided offers than Rookie, against its own tooltip | **S** |

### Tier 3 — make the week worth playing

| Fix | Why it matters | Effort |
|---|---|---|
| In-season events that block Advance, built on the cap-wall pattern (starter injured with no backup; a 74-OVR CB on waivers with three teams bidding; deadline Friday with two live offers) | 3/5 lanes. Turns Advance from a spacebar into a heartbeat, and gives the existing excellent screens a reason to be opened. The gate pattern is already built and testers called it fair | **L** |
| Make AI teams transact in-season (trades, signings, cuts, firings) | 417 of 419 wire items were injury reports and stat filler. The only trade in the league all season was the player's own | **M** |
| Widen per-player stat variance; cut passing volume toward NFL norms | Nobody ever has a season worth remembering; ten defenders tie on tackles; the recap writer is fed absurd inputs and produces incoherent prose | **M** |
| Tie draft order to record | The three worst teams picked 6th, 16th and 23rd. Deletes tanking, rebuilding, and any pull toward parity — the strategic spine of a dynasty | **S** |
| Announce your own roster changes by name (who walked, who signed, who you drafted) | Nine players left and the game said "484 unsigned player(s) hit free agency" | **S** |
| Make losing an FA bid look like losing | The losing state is visually identical to winning; a tester needed the database to find out | **S** |
| Draft: "You are on the clock" with a real timer, a visible "You selected X," and a post-draft class recap | The most emotional beat in the genre currently looks like a page that did nothing | **M** |
| Stagger contract lengths at league generation | 24 simultaneous expirations is data entry; 3–5 a year is a decision | **S** |
| Surface development and `devTrait` | The game already tracks Star/Superstar/Slow and player growth and shows the player none of it. Pure win — the data exists | **S** |
| Add a week filter and highlight your own games on the Schedule page | A 16,000px wall, and it's the only route to the box score | **S** |

### Tier 4 — worth doing, low leverage

| Fix | Why it matters | Effort |
|---|---|---|
| Point Standings team links at that team's roster; open on the user's division | 32 affordances that look like scouting and silently aren't | **S** |
| Make the matchup card a link into opponent scouting | The one anticipation hook in the week terminates in a number | **S** |
| Deep-link "Browse →" to the named position; say "no LTs available" rather than showing everything | The game sends you down its own path into a blank wall | **S** |
| Reword ROSTER NEEDS to the depth chart's "one injury from a hole" | Actively misled a tester's first strategic read of their own roster | **S** |
| Count injured players as unmanned; show injury weeks on the badge; state the Sunday consequence of an empty slot | "UNMANNED 0" while the only center is out for 5 weeks | **S** |
| Show the scouting balance wherever a spend button appears; disable a repeat scout with a reason | A currency with no wallet, and a button that silently does nothing on the second click | **S** |
| Roadmap: track the actual phase, make stages clickable, don't render it complete on a new league | The first thing a new player sees says they missed four phases of content | **S** |
| Lock `/resign` and `/free-agency` until their phases open | A tester completed the whole re-sign window before it opened, then was handed it again | **S** |
| Fix "Let the AI Pick" (kept 0, let 0 walk; button disappears until reload) and persist per-player re-sign decisions visibly | The delegate meant to skip the tedium neither delegates nor reports | **M** |
| Make void years +2/+3 do something | A lever the game explains in body copy and then ignores | **S** |
| Sort the cap-relief suggestions by smallest sufficient move | At $2.95M over, it tells you to cut your 93-OVR franchise QB | **S** |
| Play games on the first Advance, or don't present Preseason Wk1 as an advanceable week | 2/5 lanes. The main verb's first use produces nothing | **S** |
| Fix the ticker rendering on top of itself | Cosmetic, but it's the first thing on every page and 4/5 lanes noticed | **S** |
| Expand the name pool | 439 exact duplicate full names in one league; two Reggie Hollises three rows apart on the same depth chart | **S** |
| Show multi-week advance progress as streaming results, not a counter | "Simulating week 3…" over a page frozen on week 1 | **S** |
| Disable post-deadline Accept buttons instead of failing after the click | — | **S** |
| Fix "Fast Forward to My Pick" (60.7s for 9 picks; 31 picks resolved instantly afterwards) | The only place in the game where a tester waited | **S** |
| Retune rookie OVR (classes arriving at 94/95) and retirement (32 in two offseasons) | Draft classes outclass every veteran, which is a large part of why keeping your own players feels pointless | **M** |
| Fix home/away notation flipping between wire item types; sort the wire; replace the "Week result." placeholder subtitle | Small credibility leaks in the feature that's supposed to sell the living league | **S** |

---

## The one-sentence brief for the next milestone

Ship Tier 0 so the game has a second season, then Tier 1 so a week has an ending — because right now the fastest way to enjoy Dynasty GM Football is to click "Advance to Playoffs," and the parts of it that are genuinely excellent are all on screens the player has no reason to open.
