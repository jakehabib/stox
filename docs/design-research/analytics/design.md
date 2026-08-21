# Analytics Department — design

**Where it lives:** `Team ▸ Analytics`, a fifth sub-tab beside Roster / Depth Chart /
Re-sign / Cap (`components/LeagueNav.tsx`, the `team` category). Route
`/league/[id]/analytics`.

**What it is:** a read-only derivation layer over data the game has already
produced. Nothing on this screen feeds the sim, the AI, or a stored value — the
same contract `lib/analytics.ts` already documents for the Cap and Stats
"Advanced" views. A real front office's analytics department works off the box
score; it does not change what happened on the field.

---

## The league and club the mockup is drawn from

| | |
|---|---|
| League | **ANALYTICS DEPT** — `cmt3gsd7n0000zggejtmdkm10` on the dev Postgres |
| Club | **Atlanta Blaze (ATL)**, NFC South, the user's team |
| State | **2030, regular season, week 12** — 5-6, 11 of 17 played |
| History behind it | four completed seasons under this GM (2026–2029) plus twenty generated pre-history seasons (2006–2025) |
| Cap mode | REALISTIC |

The league was built by running the **real season loop** — `createLeague` →
`advanceWeek` → `runAiPicksUntilUser`/`draftPlayer` → `resignDecisionsForTeam` →
`fillRosterForTeam` — for four and a half seasons, so every contract, draft pick,
box score and `PlayerSeason` row was produced exactly the way the game produces
them. No figure on the page was typed by hand: `scripts/_an_pull.tsx` extracts
everything through the app's own modules and `scripts/_an_render.mjs` renders the
HTML from that JSON. (Both are `scripts/_*`, gitignored.)

The club turned out to be a gift: **the best-rated roster in the league at 5-6**,
2-4 in one-score games, with three leads of ten or more surrendered. Every panel
below has something real to say about it.

---

## Panels, in the order they appear

Each entry gives: what it shows · why a GM cares · exact data source · whether it
is computable today · rough build cost · screen cost at 1440px.

### 1. The Luck Ledger — wins vs Pythagorean expected wins, every season on record
*7 of 12 columns · ~430px tall*

Two lines on one axis (both are wins, so one axis is correct, not a compromise):
actual wins and the wins the scoring deserved, across all 24 seasons the
franchise has on record, with a rule and a tint marking where the user took over.
Endpoint labels only; playoff results as pips along the baseline.

- **Why a GM cares.** It is the single best answer to "was last year real?" ATL
  banked **+2.9 wins** of luck in 2027 and missed the playoffs anyway; across the
  whole tenure the ledger is **+1.9**. It is also the one chart on the page that
  frames a rebuild honestly.
- **Source.** `TeamSeasonRecord` (`wins/losses/ties/pointsFor/pointsAgnst/playoffResult`)
  → `pythagorean()` in `lib/analytics.ts` (exponent 2.37).
- **Computable today: yes.** One indexed query (`teamId`), ~30 rows.
- **Build cost:** ~2h. The maths already exists and is already tested.
- **Note.** The current, partial season is deliberately *not* plotted here — a
  part-season on a wins axis reads as a collapse. It sits in panel 2 instead.

### 2. Who Is Being Paid By The Scoreboard — this season's luck, all 32 clubs
*5 of 12 · ~430px*

A beeswarm on one axis: every club's wins above/below its own Pythagorean
expectation. Diverging fill (blue over-rewarded ↔ neutral grey ↔ red
under-rewarded), a chalk ring on the user, and exactly three direct labels — the
extremes and you.

- **Why a GM cares.** Rank without spread is a lying metric. ATL's −0.84 sounds
  bad until you see the whole league sits inside ±2.2.
- **Source.** `buildPythagoreanTable()` over the 32 `Team` rows.
- **Computable today: yes.** One query.
- **Build cost:** ~3h (the beeswarm packing is the only new code).

### 3. Are You Paying For What You're Getting? — cap share vs unit rating
*Full width · ~520px*  **← the flagship**

A scatter of the nine position groups. x = this club's share of active salary at
that unit **minus the league mean share**; y = the unit's rating **minus the
league mean rating**. Bubble area = the share of team quality that unit carries
(`UNIT_WEIGHT` in `lib/teamRating.ts`). Four named quadrants. Beside it, the same
nine rows as a permanent table — cap, share, ±league, rating, rank, ±league, age.

- **Why a GM cares.** This is the whole brief in one picture. ATL spends
  **10.9%** on the defensive line against a league average of **20.1%** — the
  biggest underspend on the board — and it is the only unit on the roster rated
  below the league mean (82 vs 82.3, 17th of 32). The secondary is the mirror
  image: **30.1%** of the money, +9.5pp above the league, for the best unit in
  the competition.
- **Source.** Cap: `capHit()` per player over `Player` + `Contract` for all 32
  clubs, grouped by `positionGroup()`. Rating and rank: `buildLeagueRatings()`.
  Starter counts: `STARTERS_AT_GROUP` from `lib/lineup.ts`.
- **Computable today: yes.** Two queries (32 teams, ~1,700 players with
  contracts) plus the ratings pass the dashboard already runs.
- **Build cost:** ~6h — the label-seating pass (eight candidate seats per point,
  scored against every other bubble) is the fiddly part, and it is what stops
  WR/TE/LB stacking their names on top of each other.
- **Colour note.** Nine groups is one above the categorical ceiling, and this is
  a scatter, where the all-pairs floor caps a validated set at **three**. So
  colour carries the *side of the ball* (three slots, all-pairs validated) and
  identity is carried by the direct label on every bubble. Nine hues here would
  have been the wrong answer even if the palette had them.

### 4. How These Games Are Actually Being Decided — margin by game
*7 of 12 · ~640px*

A diverging column per played game, signed margin, with hairline rules at ±8
(one score) and ±28 (blowout); tiles for the one-score record, blowout record,
average margin and leads of 10+ lost; then a breakdown of `computeGameShape()`
archetypes with a win/loss split per archetype.

- **Why a GM cares.** For this club it is the finding. Six losses, **four of them
  by five points or fewer**, three of them after leading by ten or more —
  Comeback, Collapse ×3, See-saw ×2, Wire to wire ×2, One score ×2, Never led.
  A roster that rates 1st going 2-4 in one-score games points at the fourth
  quarter, not the talent.
- **Source.** `Game.boxScore` → `computeGameShape()` (`lib/gameShape.ts`),
  thresholds `ONE_SCORE_MARGIN` / `BLOWOUT_MARGIN`.
- **Computable today: yes.** One query for the club's games; the drive log is
  already inside each stored box score.
- **Build cost:** ~4h.
- **Honest empty category.** The blowout tile reads **0-0**. Nothing has been
  decided early all year. That is a true zero, and the chart shows the ±28 rules
  with no bars near them rather than hiding a category that happens to be empty.

### 5. What Is Left — schedule strength, played and remaining
*5 of 12 · ~640px*

Opponent win rate played vs remaining, projected finish, then the six remaining
fixtures with crest, opponent rating and rank, and a win-chance meter; the
division table underneath.

- **Why a GM cares.** The projection is the sum of six per-game win chances —
  **3.45 more wins, an 8.4-8.6 finish** — and it is the only forecast on the
  page. It also surfaces the thing nothing else would: **all six remaining games
  are on the road** (ATL play 5 home and 12 away this season; see the schedule
  note in the report).
- **Source.** `strengthOfSchedule()` (`lib/analytics.ts`) for the played half;
  `estimateGameWinChance()` (`lib/teamRating.ts`) per remaining fixture, with its
  factor breakdown in the tooltip.
- **Computable today: yes.** One `Game` query plus the ratings map.
- **Build cost:** ~3h.

### 6. Who Outperforms The Deal, Who Is An Anchor — contract value
*7 of 12 · ~640px*

Twelve rows, diverging bars centred on zero: six bargains up, six anchors down,
each with the real `PlayerAvatar` portrait, the position badge, age, rating, cap
hit and surplus.

- **Why a GM cares.** It is the only directly actionable board on the screen.
  **Maverick Gatlin, $20.01M against an $11.50M market at 30.** Against him, four
  of the six bargains are 20–23 and on rookie deals.
- **Source.** `marketValue()` (`lib/cap.ts`) − `capHit()`, classified by
  `classifyContractValue()` and ranked by `rankContractValue()` — the same
  12%-of-value **and** $1M-floor test the app already uses, so a $15K miss on a
  $30M quarterback never reaches the board.
- **Computable today: yes.** Already loaded with the roster.
- **Build cost:** ~3h.

### 7. The Cliff, Two Years Out — age curve and expiring deals
*5 of 12 · ~640px*

Two small multiples sharing one x (age band): bodies, stacked first-team/depth,
and cap dollars. Then three tiles (starters 30+ now, starters 30+ in two years
and what they hold today, contracts running past 2032) and a nine-cell strip of
deals in their final year, by unit.

- **Why a GM cares.** **Six of 24 first-teamers are 30+ by 2032, holding $77.7M
  today**, and 76.7% of next season's $357.7M ceiling is already committed.
- **Source.** `Player.age` + `Contract.yearsRemaining` + `capHit()`;
  `buildCapHealth()` for the cap-weighted age (26.6 against a roster mean of
  25.9).
- **Computable today: yes.**
- **Build cost:** ~3h.
- **Form note.** Deliberately two charts, not one. Bodies and dollars are
  different units; one pair of axes would invent a relationship the roster does
  not have.

### 8. Draft Return By Round
*6 of 12 · ~560px*

One dot per pick this front office has made, placed at what that player rates
today, grouped into seven round bands, with the round mean as a chalk rule and a
league-mean reference line. Filled dot = first-team now, ring = on the roster but
not starting.

- **Why a GM cares.** It is the only feedback loop on scouting the game offers.
  Round 1 → round 7 is a **14.8-point** drop in current rating and it is
  monotonic across all seven rounds: the board is working.
- **Source.** `DraftPick(used, ownerTeamId)` joined to `Player.trueOvr`.
- **Computable today: yes.** One query.
- **Build cost:** ~3h.
- **Honest empty category.** Every one of the 28 picks is still on the roster, so
  the "released/traded away" class this chart could carry has nothing in it. The
  chart says so in prose rather than drawing an empty legend entry.

### 9. The Box-Score Profile — eight per-game measures against all 32
*6 of 12 · ~560px*

Eight range strips. Each shows where the other 31 clubs sit as faint ticks, the
league mean as a hairline, and this club as a chalk marker, with the rank spelled
out in text under it.

- **Why a GM cares.** It corroborates panel 3 from a completely different part of
  the database: **423 yards allowed per game, 25th of 32**, behind a line that
  rates 17th. Also flags 29th in penalty yards.
- **Source.** `Game.boxScore.teamStats` — `totalYards`, `turnovers`,
  `thirdDownConv`, `sacks`, `penaltyYards`, `firstDowns`, `timeOfPossession`.
- **Computable today: yes, but this is the expensive one.** The stats live inside
  a JSON blob, so a league rank means reading and parsing every played game in
  the season (176 rows at week 12, 272 at season's end). Fine on this page;
  it should be cached per league-week rather than recomputed per render.
- **Build cost:** ~4h including the caching.

### 10. Is The Money Still Climbing? — production by season, biggest cap hits
*Full width · ~420px*

Eight small multiples, one per man: the seven largest cap hits plus the
best-paid offensive lineman. Each is a four-point sparkline of that player's
primary measure by season, scaled to himself, with the first and last values
labelled.

- **Why a GM cares.** It closes the loop on panel 6. **Osiris Danziger's sacks go
  7 → 8 → 7 → 3 as he ages 28 → 31**, and he is on the overpay board at $10.99M.
  Two panels, two data sources, one conclusion.
- **Source.** `PlayerSeason` (year, age, club, stats JSON) — the table that made
  this possible at all.
- **Computable today: yes.** One `IN` query on `(leagueId, playerId)`.
- **Build cost:** ~4h, most of it choosing a defensible primary measure per
  position.
- **What it cannot do, on the page.** Four of the eight have no line, and each
  absence is a different fact, stated in the panel: **Bo Ashford** is the
  best-paid lineman on the roster and the box score has never recorded anything
  he did; two others arrived too recently to have a completed season here. That
  gap is the strongest argument in `data-inventory.md`.

---

## Ranking — what I would ship, and what I would cut

### Ship these four first

1. **Panel 3 — Are You Paying For What You're Getting?** It is the only panel
   that answers a question the GM cannot answer any other way, it uses the cap
   sheet and the roster together, and it produced the sharpest finding in the
   league I tested (DL at half the league's spend and the only below-average
   unit). Everything else on the screen is a good report; this one is a decision.
2. **Panel 4 — How These Games Are Actually Being Decided.** Cheap to build,
   entirely from data already stored, and for a team like this one it is the
   explanation. "Best roster in the league, 2-4 in one-score games" is a sentence
   a player will remember.
3. **Panel 6 — Who Outperforms The Deal, Who Is An Anchor.** The most actionable
   board, and the classification logic is already written and already used
   elsewhere, so the build is mostly layout.
4. **Panel 1 — The Luck Ledger.** The dynasty-length view the game currently
   lacks, two hours of work, and it makes every other season on the History page
   mean something.

### Then

5. Panel 7 (cliff) — high value, but overlaps the Cap page's advanced view.
6. Panel 5 (what's left) — useful weekly, but the Schedule screen already carries
   most of it; here it earns its place mainly through the projected finish.
7. Panel 8 (draft return) — lovely, but only becomes interesting in year three.
8. Panel 10 (production) — the newest capability, and the one with the most
   holes; ship it once more of the roster has box-score lines.

### Cut, or do not build

- **Panel 2 (league-wide luck beeswarm)** is the one I would cut if the screen
  had to lose something. It is beautiful and it is 5 columns of screen to say
  what a single number in the masthead already says ("−0.8 wins, 7th-unluckiest
  of 32"). Keep the number, drop the swarm, give panel 1 the full width.
- **Panel 9 (box-score profile)** is the second cut candidate: the most expensive
  panel to compute and the one whose findings all duplicate something else on the
  page. If it stays, it should be cached, not live.
- **A "team rating over time" line.** The obvious ninth idea, and the one I
  refused to draw — see `data-inventory.md`. There is no historical unit rating in
  the database, so any such chart today would be invented.
- **Anything with a trend line or a regression through it.** The sim makes no
  such claim and neither should the screen.

---

## Design decisions worth arguing about

**No dual axes anywhere.** Twice this cost a chart: cap dollars and roster
headcount by age became two small multiples (panel 7), and eight players'
production became eight sparklines rather than one plot (panel 10). Both are
better as a result, and neither invents a correlation.

**Colour follows the entity, never the rank.** The side-of-the-ball colours in
panel 3 are fixed; filtering to "Defense" in the header would grey the offence,
not repaint the survivors.

**Diverging scales use blue ↔ red with a neutral grey midpoint** — the
`vizGood`/`vizBad` pair already declared in `tailwind.config.ts`. The app's status
green (`accent`) and red (`bad`) stay reserved for status: the W/L chips, the
delta chips, the flag pills. A surplus is a polarity, not a status.

**Every chart has a table twin.** One switch in the filter row ("Show the numbers
behind every chart") reveals a real `<table>` under each panel — the value a
tooltip carries is never the only way to read it.

**One filter row, above everything it scopes.** Not per-card filters.

**It matches the app rather than refining it.** The masthead is `PageMasthead`'s
exact anatomy (team-tinted band, hash texture, crest watermark, fact strip),
`.panel`/`.card`/`.stat-tile`/`.label-sm` are the app's own classes, crests come
from `TeamLogo` and portraits from `PlayerAvatar` — both rendered through
`renderToStaticMarkup` so the mockup contains the real artwork, not a redrawing
of it. Barlow Condensed is embedded as base64 so the display face is the app's,
with no external request.

**Screen budget.** ~7,200px tall at 1440. That is long, and it is the point: this
is a department, not a widget. The masthead fact strip is designed so a GM who
scrolls no further still leaves with the six numbers that matter.

---

## Colour validation (dataviz skill, `scripts/validate_palette.js`)

Every categorical set on the page was run against the app's card surface
`#18181b`. Verbatim output for all six sets is in **`palette-validation.txt`**
next to this file. Summary: **all six sets pass every check**, including the
three-slot scatter set under `--pairs all` (worst all-pairs CVD ΔE 9.4,
normal-vision ΔE 20.9).
