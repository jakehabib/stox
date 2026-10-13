# PART 5 — EVERY SCREEN, AND THE DESIGN SYSTEM

This part is the feature inventory. It is what makes "1:1" checkable: **39 routes** and
**159 components**. Completeness matters more than prose here — a reader must be able to
tick every route, every panel and every control off.

Everything below is read from the source at `2b052eb`. Where a figure could not be
verified it says so explicitly rather than guessing.

---

## 1. THE ROUTE MAP

Thirty-nine `page.tsx` files. Three groups: global (outside any league), league-scoped
(inside `/league/[id]`, wrapped by the league shell), and design routes (internal, not
linked from the product nav).

| # | Route | Group | Query params |
|---|---|---|---|
| 1 | `/` | global | `claimed`, `all` |
| 2 | `/new` | global | `team` |
| 3 | `/import` | global | — |
| 4 | `/start/[id]` | global | — |
| 5 | `/sign-in` | global (auth layout) | `next` |
| 6 | `/sign-up` | global (auth layout) | `next` |
| 7 | `/account` | global | — |
| 8 | `/leaderboard` | global | `sort`, `sport` |
| 9 | `/league/[id]` | league | — |
| 10 | `/league/[id]/roster` | league | `sort`, `dir` |
| 11 | `/league/[id]/depth-chart` | league | — |
| 12 | `/league/[id]/resign` | league | `player` |
| 13 | `/league/[id]/cap` | league | `sort`, `dir`, `view` |
| 14 | `/league/[id]/analytics` | league | `view` |
| 15 | `/league/[id]/free-agency` | league | `pos`, `sort`, `dir` |
| 16 | `/league/[id]/trade` | league | `with`, `reviewOffer`, `pos` |
| 17 | `/league/[id]/draft` | league | `pos`, `sort`, `dir`, `shortlist`, `q` |
| 18 | `/league/[id]/draft/broadcast` | league | — (redirect) |
| 19 | `/league/[id]/scouting` | league | `lens` |
| 20 | `/league/[id]/standings` | league | — |
| 21 | `/league/[id]/power-rankings` | league | — |
| 22 | `/league/[id]/schedule` | league | `week` |
| 23 | `/league/[id]/stats` | league | `view`, `scope`, `split` |
| 24 | `/league/[id]/news` | league | `type`, `page` |
| 25 | `/league/[id]/history` | league | `team` |
| 26 | `/league/[id]/gm` | league | — |
| 27 | `/league/[id]/dynasty` | league | — |
| 28 | `/league/[id]/rebuild` | league | — |
| 29 | `/league/[id]/settings` | league | — |
| 30 | `/league/[id]/player/[playerId]` | league | `split`, `view`, `from`, `fq` |
| 31 | `/league/[id]/team/[teamId]` | league | — |
| 32 | `/league/[id]/game/[gameId]` | league | — |
| 33 | `/design-system` | design | — |
| 34 | `/design-system/dashboard` | design | — |
| 35 | `/design-system/player` | design | — |
| 36 | `/design-system/player-card` | design | `split` |
| 37 | `/design-system/draft` | design | — |
| 38 | `/league/[id]/design/negotiate` | design | — |
| 39 | `/league/[id]/design/negotiate/[direction]` | design | `player` |

### The universal query-parameter rules

Every one of these is parsed defensively, because a query string is whatever anyone types.
The rule throughout: **an invalid value falls back to the documented default and nothing
is reported as an error.** No route 500s, no route renders an empty board, and no route
echoes an unvalidated value back into its own copy.

| Param | Validation | Invalid value does |
|---|---|---|
| `sort` (roster) | one of `pos age ovr potential cap years` | falls back to `pos` |
| `sort` (cap) | one of `pos age ovr cap base years savings` | falls back to `cap` |
| `sort` (free agency) | one of `pos age ovr market` | falls back to `ovr` |
| `sort` (draft) | one of `consensus ours pos ovr age potential athletic` | falls back to the phase default |
| `sort` (leaderboard) | one of `LEVEL TITLES PER_SEASON REBUILD` | falls back to `LEVEL` |
| `dir` | `asc` → ascending | anything else → descending |
| `pos` | must be in `POSITIONS` | treated as no filter (the copy must not quote the junk back) |
| `view` | `advanced` (cap, stats, analytics) / `contract` (player) | falls back to basic / stats |
| `week` (schedule) | must be a week that exists in the fixture list | falls back to the league's current week, else the last week that exists, else 1 |
| `type` (news) | must be in the filter list | falls back to `ALL` |
| `page` (news) | `max(0, Number(x) \|\| 0)` | falls back to page 0 |
| `claimed` (home) | positive integer | banner suppressed |
| `all` (home) | `1` shows every save | anything else shows the first 6 |
| `team` (`/new`) | must match a `TEAM_SEEDS.abbr`, uppercased | no pre-selection |
| `team` (history) | falls back to the user's team, then the first team | — |
| `next` (auth) | must start with `/` and not `//` | falls back to `/` |
| `shortlist` (draft) | `1` | anything else → off |
| `q` (draft) | trimmed, **sliced to 40 characters** | — |
| `lens` (scouting) | a known consensus-bias id, or `board` | falls back to `movers` |
| `reviewOffer` (trade) | a real `TradeOffer` id | ignored |
| `with` (trade) | a team id in this league | falls back to the first other team |
| `split`/`scope` (stats, player) | `playoffs` / `myteam` | falls back to regular season / league |
| `player` (negotiate, resign) | a player id in this league | negotiate renders a "No such player" panel with a back link; resign simply opens no row |
| `direction` (negotiate) | `table`, `sheet`, `room` | **404** |

Two further hard rules on route identity, applied in every league route and on
`/start/[id]`:

- **A save you do not own is reported as missing, not as forbidden.** `notFound()`, never
  a 403.
- **An id that arrives in the URL is re-checked against the league.** Proving the viewer
  may see *this league* says nothing about a `teamId`, `gameId` or `playerId` typed into
  the path: `/team/[teamId]` and `/game/[gameId]` both 404 when the row's `leagueId`
  does not match.

---

## 2. THE GLOBAL ROUTES

### 2.1 `/` — the front door

**For:** two different readers, answered by two different layouts chosen on whether this
viewer has any saves at all.

Shell: `SiteHeader`, `max-w-6xl` main, a footer carrying *"Fictional league. No real
teams, players or logos anywhere in this game."* plus links to New dynasty, Import a
league and (signed out) Sign in.

**Claim banner** — only when `?claimed=N` is a positive integer. Accent-bordered, label
"Saves secured", and it names the real number that moved onto the account.

**State A — PitchView (no saves).**

| Panel | Contents |
|---|---|
| Hero | eyebrow "Front Office Simulator"; `Dynasty GM / Football` at `text-5xl sm:text-7xl`; two paragraphs of in-world copy; `Pick your franchise ▸` (primary) and `Import a league` (secondary); a one-line account note whose wording changes on signed-in state. Decoration: yard-line repeating gradient at 0.06, an accent radial, and `CrestDrift` over all 32 seeds |
| "Choose who you run" | eyebrow "32 clubs, one chair", `FranchiseWall` over `TEAM_SEEDS`, every crest linking `/new?team=<abbr>`; action link "See the full board →" |
| Three job cards | The Draft / "Scout all year"; The Cap / "Every deal comes back"; Sunday / "Sixteen games a week" |

**State B — ReturningView (has saves).** The franchises come first; a returning player is
never made to scroll past a pitch to reach Continue.

| Panel | Contents |
|---|---|
| Hero | tinted with the lead save's club primary; crest watermark at 0.07; "Signed in as X" or "Welcome back"; `Your Franchises` in `.text-team`; a count line; `Start another ▸`, `Import a league` |
| Unclaimed-save warning | **only when signed out and at least one save exists.** Warn-bordered: "This browser is the only copy", plus `Save my dynasty` / `Sign in` |
| Save list | one row per save, left-bordered in that club's primary: crest (44px), league **name** first (it is the only thing that tells two saves apart), `CITY NICKNAME` under it, then `year · Week n · phase label · record`. `Continue ▸`, plus a Delete form hidden below `sm` |
| Older saves | `Show N older saves` when more than 6 exist (`VISIBLE_SAVES = 6`) |
| "Take over somebody else" | the same `FranchiseWall` at size 46 |

**Phases:** n/a. **Empty state:** State A *is* the empty state — there is no bare list.

### 2.2 `/new` — team select

**For:** choosing one of 32 franchises and creating the league. Its own route because the
landing page must stay one confident screen, and because a crest clicked there arrives
here as `?team=` so the click that expressed the choice is the click that makes it.

- **At the limit** (`MAX_LEAGUES_PER_OWNER`, default **8**): the whole screen is replaced
  by a panel — "Save slots full", "You already have N dynasties", the limit stated, "Delete
  one from your franchise list and the slot comes straight back", and `Back to my
  franchises`. The count is taken exactly the way the server-side guard counts it, never
  off the visible list, because a pre-check that disagrees with the real check is worse
  than no pre-check.
- **Guest note** (signed out only): "Playing as a guest — this dynasty will live in this
  browser only", with `Create account` / `Sign in` carrying `?next=/new`.
- **`CreateLeagueForm`** over `TEAM_SEEDS`, pre-selected from `initialAbbr`.

`maxDuration = 60` on both this route and `/`: league creation runs ~236 database round
trips and the ownership stamp happens *after* generation, so a 10-second timeout would
leave an unowned, undeletable league.

### 2.3 `/import` — custom leagues

**For:** import a league file, or export one of your own. Both halves live on one route
because they are one loop, and because a rejection needs room to be explained in full
(e.g. `teams[7].players[3].age is 900; it must be between 18 and 45`) rather than in a
truncated toast.

Sections: hero ("Import a League" + what a league file is) → **Import** (`LeagueImportForm`)
→ **Export one of yours** → **What a file may contain**, printed from `FILE_LIMITS`:

| Rule | Value |
|---|---|
| Teams | exactly 32, as 2 conferences × 4 divisions × 4 teams |
| Players per team | up to `ROSTER_MAX`; omit them and a roster is generated |
| Free agents | up to 400; omitted means a generated pool |
| File size | up to 4MB |
| Ratings | 1–99 |
| Ages | 18–45 |
| Contracts | $0.5M–$100M per year, 1–7 years |
| Names | up to 24 characters, letters and ordinary punctuation |

Closing note on names being visible to anyone you send the file to, and that nothing
imported is published anywhere.

**Empty state:** no leagues to export → a centred panel, *"No leagues to export yet.
Start one from the home page, then come back."*

### 2.4 `/start/[id]` — the handover

**For:** the first time the player sees the club as it actually is. This is the earliest
moment a *real* team rating exists, which is the honest answer to "put a rating on the
create screen" — rosters do not exist until generation runs, so before this point every
franchise is statistically identical and any strength figure would be invented.

- `robots: { index: false }`. 404 on a save you cannot view. If no team is flagged
  `isUser`, redirect straight into the league rather than render a broken celebration.
- **Hero:** club-tinted, 2px border in the club primary, `shadow-elevated`, hash texture
  at 0.06, crest at 132px with `motion-safe:animate-fadeUp`; "You are now the general
  manager of the"; `CITY` / `NICKNAME` at `text-4xl sm:text-6xl` in `.text-team`; league
  name · year · conference division.
- **Fact strip (4):** Team overall (+ "Nth of 32"), Offense, Defense, Special teams — each
  rank computed from the same ratings map that produced the number it sits under.
- **"The roster you inherit"** — best unit and weakest unit by rank, with rating and
  "Nth of 32", and a footnote stating that overall is the weighted starter rating across
  all nine units, the same number the dashboard shows and the same one the sim uses.
- **Division panel** — the three divisional rivals, crest, city/nickname, overall and
  ordinal rank. Rendered whether or not a rating exists.
- `Enter the front office ▸`, `Back to my franchises`.
- Signed-out footer note offering an account.

**Fantasy-draft leagues skip the rating entirely.** Every roster is empty, so
`buildLeagueRatings` would score all 32 clubs at replacement level — a real number that
means nothing, which is worse than no number. In its place: a panel headed "Fantasy
draft" — *"Every roster in the league is empty. There is no team rating yet because
there is no team yet — you build one, pick by pick, starting now."* The division panel
still renders, because the division is the only real thing about the club yet.

### 2.5 `/sign-in`, `/sign-up`

Shared `(auth)` layout: `SiteHeader` with its right-hand slot replaced by the label
"Front Office Simulator" (offering "Sign in" on the sign-in page is noise), `max-w-md`.
Both `noindex, follow`. Both redirect to `/` if already signed in.

- **Sign in:** hero with yard-line texture, "Welcome / Back", `AuthForm mode="signin"`,
  `CrestRibbon` over seeds 0–7, then two notes: a guest escape hatch, and *"Forgotten your
  password? There is no reset — we never asked for an email address."*
- **Sign up:** "Keep Your / Dynasty". Its subtitle **states the real number** of saves on
  this browser that signing up would attach (`countClaimableLeagues`), because "you won't
  lose your saves" is the entire pitch and a vague version of it is not persuasive.
  `CrestRibbon` over seeds 16–23. The escape hatch points back at `next` (validated), so
  somebody who came from team select returns to team select.

### 2.6 `/account`

**For:** who you are on this deployment, what the public board shows, and the password.
Redirects to `/sign-in?next=/account` when there is no session.

Masthead facts (3): **Saves** (franchises on this account), **Public board**
(`Listed`/`Private`, with the rank or "Nobody can see you"), **Member since**.

| Section | Contents |
|---|---|
| Privacy → Public leaderboard | A paragraph stating the board is public to anyone with the link and that listing is off by default and turning it off *deletes* rows rather than hiding them. Then **the exact row a stranger would see** — crest, username, franchise, seasons, record, titles, level, XP — labelled "What people currently see" / "What people would see". **Consent to publish something you have not been shown is not consent.** Then the rank line ("Publishing now would put you at about #N"), the one-GM-one-row note when several saves are eligible, and a statement that only the username and record are published. Then the **Rebuild board** block, rendered only when this account has something to say about it. Then a plain `<form>` posting a Server Action, with the state on the **button** (`name="listed" value="on"/"off"`) rather than in a checkbox — an unchecked checkbox submits nothing, so the action would have to read "no field" as "off" |
| Security → Change password | `ChangePasswordForm` with `MIN_PASSWORD_LENGTH`; when the account has no password hash, a sentence saying so instead of a form whose current-password field can never be satisfied |
| Session → Sign out | "Ends this session on the server, not just in this browser." |

**Empty state:** no eligible franchise → *"Nothing yet — you have no franchise on this
account with a team in it. Start a league and play a week; your best save is the one that
would be published."*

### 2.7 `/leaderboard`

**For:** public GM progression, readable with no account. The whole point is that it can
be pasted into a group chat.

`refreshFootballRanks()` runs **in this request, before the board is read** — a stored XP
total is only trustworthy if nothing could have changed since it was derived, and the only
moment that holds is now.

Masthead facts: **GMs Listed**, **Top Level**, **Championships** ("won by listed GMs"),
**Seasons Played** ("the denominator"), plus **Fastest Rebuild** on the Rebuild sort only.

| Panel | Contents |
|---|---|
| "What this board is" | `LEADERBOARD_CAVEAT`, warn-bordered, **above** the table and not in a tooltip: someone who reads only the first thing on this page should still come away knowing what the numbers are. On the Rebuild sort, `REBUILD_SORT_BLURB` is appended below a rule |
| Sort tabs | **Dynasty Level** (career XP — "rewards everything a franchise has ever done, which also means it rewards time"), **Championships** ("rings first, then level — the only line on the board that a losing season cannot pad"), **Per Season** (XP per completed season, minimum seasons — "Simming a decade of .500 football moves you DOWN this one"), **The Rebuild**. The active sort's blurb prints under the tabs — except on Rebuild, where it is already at full weight in the panel above and printing it twice would be duplication rather than emphasis |
| Sport tabs | **only once a second sport has published a row.** Offering a "Baseball" tab before baseball exists is its own kind of lying metric |
| The board | one row per GM: rank (gold at display scale for the top three), crest, monogram, username, a **You** pill for the viewer, franchise, then **the denominator on every breakpoint** — seasons, record, titles. Right-hand metric swaps with the sort |
| "How a GM gets listed" | three variants — signed out (you can read this all day, you cannot appear on it, and why: a save made signed out belongs to a cookie and there is no durable identity to attach a rank to), signed in and listed, signed in and not listed |
| Multi-sport promise | rendered only when one sport is playing |

**Empty states — three different sentences, because they are three different facts:**
- Per Season: *"This board needs N completed seasons before a per-season rate means
  anything. Nobody has qualified yet."*
- Rebuild: *"Nobody has taken a club off the bottom of the league and won a championship
  with it yet. A run only appears here once the title is on the books."* — not "nobody has
  played one", because runs may well be under way.
- Otherwise: *"The board is empty because it is opt-in and brand new. Be the first
  franchise on it."*

---

## 3. THE LEAGUE SHELL

Every league route is wrapped by `app/league/[id]/layout.tsx`. It 404s when the league or
the user team is missing. Top to bottom:

1. **`LeagueWireTicker`** (§6.6).
2. **Sticky header** (`.app-header`, `z-20`, `backdrop-blur`): the `D` mark + "Dynasty GM"
   wordmark (text hidden below `sm`), a compact `AccountBadge` (hidden below `md`), the
   club crest at 32px and `CITY NICKNAME` + `record · conference division` (hidden below
   `md`), then up to four tiles and the advance control.
3. **`LeagueNav`** — categories and sub-row (§6.2).
4. **`LineupGapBanner`** when there are gaps (§6.8).
5. **`CapAlertBanner`** when non-compliant.
6. **`main.max-w-7xl.px-6.py-8`** wrapping the page inside `SigningMomentProvider`.

### The header tiles

| Tile | Shown when | Contents |
|---|---|---|
| **Cap Space** | `capMode !== 'OFF'`, `lg` and up | `formatMoney(capSpace)`, accent when ≥ 0 and `bad` when negative. A **link** to `/cap`, because the number names a budget and that is where it is spent. Native `title` carrying `tip('capSpace')` rather than a `<Tooltip>` — a bubble here would open over the Advance button. Two conditional sub-lines: **`<year> books`**, drawn only when the cap year and the league year disagree (the offseason window either side of the year roll); and **the pending change on the next Advance**, with its own nested native `title` naming the cause. The pending line exists on exactly two advances a league year — the final, and the press that shuts the re-sign window — because those are the only two whose cap effect is entirely determined by the ledger as it stands. A predicted figure that does not arrive would be worse than none |
| **Workouts** | `scoutingEnabled !== false`, `lg` and up | `remaining/max`; muted when the window is shut, `bad` at zero, else `accent2`. Links `/scouting`. `title` is the window label *and* `tip('privateWorkout')` |
| **Phase** | always | the phase label, then `<year> · Wk <n>` |
| **Advance** | always | `AdvanceWeekButton` (§6.3) |

### What the shell computes

- `capComplianceReport` — one call covering both the header figure and the banner; it
  wraps `teamCapSummary` and short-circuits the extra roster scan when compliant.
- `pendingCapChange`, `loadWorkoutSlots`.
- **Ticker transactions:** types `TRADE SIGN RESIGN CUT TAG OPTION POSITION DRAFT FIRE
  CHAMPION ALL_STAR_ROSTER` + every award type, `seasonYear >= league.seasonYear - 1`,
  `take: 120`. `INJURY` is deliberately excluded (one row per game per week — sixteen a
  week — so it would spend the whole window on other clubs' training rooms) and so are the
  ~76 individual `ALL_STAR` selection rows. The `seasonYear` floor is **not** an
  optimisation: league creation seeds two decades of fictional backstory, all written at
  creation time, so `orderBy createdAt desc` put every one of them ahead of anything that
  has happened in the save. Only the league year the event belongs to can fix that.
- `powerRankingWireItems` — the week's movers, read from stored snapshots only, capped at
  two, degrading to nothing on failure so a ranking error cannot 500 every league page.
- `ensurePowerSnapshot` — writes this week's ranking down the first time any league page
  is opened in a new week. Movement **cannot** be recomputed later: a team rating moves
  with the roster, so a club that signed a free agent on Tuesday would retroactively
  rewrite what it was ranked on Sunday.
- `lineupGaps`, but **only in `REGULAR`, `PLAYOFFS` and `PRESEASON`.** It is deliberately
  not extended through the building phases: `releaseUnresignedExpiringContracts` empties
  every walk-year deal the moment free agency opens, so a normal club is missing several
  starters *by design* there, and a standing alarm that is on for almost the whole period
  is one a GM learns to read past. The building phases get doors instead of an alarm — the
  depth chart's "Unmanned" rows and its masthead tiles open `/free-agency?pos=`.
- **Two nav badge counts** (§6.2).

### The ticker's selection algorithm

`isBreakingNews` filters, then rows are bucketed by `transactionCategory` and taken
**round-robin across categories**, at most 4 per category per round, to at most **14**
items. Last season's title and awards stay eligible through `week <= 4` of the new year.
The strip is **capped and never padded**: four things happened, the wire carries four; if
nothing has, the component returns `null` and the strip does not render at all.

---

## 4. THE LEAGUE ROUTES

### 4.1 `/league/[id]` — the dashboard

**For:** everything waiting on the GM this week, in one read.

**Conditional banners, in order:**

| Block | Shown when |
|---|---|
| `SeasonAnnouncement` | `reviewYear !== null` and a `CHAMPION` row exists for it. The ring plus the six trophies. Carries the club, the user's finished record (read from `TeamSeasonRecord`, because `Team.wins` is back to 0-0 the moment `RESET_STANDINGS` has run), the playoff result, the awards, and `rebuildSeasons` only when the title being announced *is* the one that ended the rebuild |
| `SeasonReview` | same window — narrative reads on your own players' years |
| `AllStarHonorRoll` | always rendered; takes `honors` and a frozen `nearMiss`. The near-miss is **read, never re-ranked** |
| `OffseasonRoadmap` | always; suppresses itself on the first preseason of a save |
| Re-sign window card | `phase === 'RESIGN'`. Warn-bordered; names the count, or *"No expiring contracts this offseason."* |

**`reviewYear`** is the single most load-bearing derivation on the page.
`League.seasonYear` increments *inside* the offseason (at `RESET_STANDINGS`, offseason
week 2), so through weeks 1–2 it still names the season that finished and from week 3 on
it names the one about to start. `reviewYear = phase === 'OFFSEASON' ? (week <= 2 ?
seasonYear : seasonYear - 1) : null`. Everything meaning "the season just played" reads
this. Keyed on `League.seasonYear` the announcement arrived at week 1 and was gone by
week 4.

**`TeamHeader`** (club-tinted via `--team-accent`): crest, record, `Nth · CONF DIV`,
tenure label ("Your first season" / "Year N of your tenure"), clinch `scenarioTag`
(`REGULAR` only), three stats (Cap Space or `Off`; Roster with `(N inj)`; Power Rank — gold
at #1, accent in the top 5, accent2 in the top 10, ordinary ink outside, because colouring
all 32 would make the colour mean nothing; its label carries the week-over-week move,
`Power Rank ▲3`, read from the stored snapshot and never recomputed), four ratings (Team
Overall, Offense, Defense, Special Teams, each with its rank out of the league size —
the two composites are ranked **here**, off the same map that produced the number, because
if you display a rank it must be the rank of the grade you displayed), and the next game
with a display-only win probability plus the two biggest factors behind it.

**Two-column body.**

Left (`lg:col-span-2`): `FrontOfficeBrief` (rendered only when non-empty), `Storylines`
(`StorylineFeed`, limit 5, rendered only when non-empty).

Right rail:
- **Roster Needs** — top 5 needs over 0.1, each with a severity word *and* a bodies-vs-
  starters detail (`N rostered · M start`), because measured on a live dashboard all five
  rows read "Moderate". Each row links `/free-agency?pos=`. Empty: *"No glaring holes
  right now — nice work."*
- **`CONF DIV` standings** — division sorted by win pct, with a real last-five form guide
  and rank deltas.
- **Injury Report** — up to 6, starters first then weeks then rating, flagged `isStarter`.
- **Season Leaders** — one name per phase of the game (Passing, Rushing, Receiving, Pass
  Rush). **A category nobody has produced in yet is omitted rather than shown as a zero:
  an empty leader board reads as broken, a shorter one does not.**

**League Wire** (full width, because stacking it under the brief left the right half of
the page blank): up to 7 rows, your own game results first then transactions in
**relevance** order from `rankWire` — never re-sorted by week, which would undo the
ranking. Collapsed injuries become one row: *"N injury reports around the league / Your own
injuries are in the Injury Report on the right; these belong to other clubs."* Empty:
*"No news yet."*

### 4.2 `/league/[id]/roster`

**Facts (5):** Roster Size (`N injured` / "all healthy", warn when injured), Average
`<ovrLabel>`, Average Age, **Expiring** (warn, linking `/resign` when > 0 — counting them
here and making the GM find that screen from the nav was the whole dead end), Cap Space
(linking `/cap`). Action: `FillRosterButton`.

`RosterShapePanel` under the masthead, then one `.table-clean` grouped by position group
with `RosterGroupHeader` rows carrying the group's average OVR, cap hit, and a `thin` flag.

Columns: Pos, Player, Age, OVR/Scouted, Pot., Status, Cap Hit, Years Left — every one but
Player and Status sortable via `?sort=&dir=`. The OVR header's tooltip carries
`tip('overall')` **plus `tip('ratingColours')`**, because every rating in the game is drawn
in its tier's ink and until that landed nothing anywhere told the player so. It is gated
on `fogged`: when the cell shows a range the ink comes from the fogged centre point, and
calling that "the tier he falls in" would promise a read the fog exists to withhold.

Every tooltip on this page opens **downward** — the table sits inside `panel
overflow-hidden` *and* an `overflow-x-auto` scroller, the exact pair that once rendered a
tooltip perfectly and clipped it out of existence.

### 4.3 `/league/[id]/depth-chart`

**For:** setting who starts. Subtitle states the real constants: *"The sim engine uses
this order every game — 11 on offense, 11 on defense, highlighted below."* Action:
`AutoSortButton`.

**Facts (6):**

| Fact | Detail | Link |
|---|---|---|
| Position Groups | "with at least one player" | — |
| Open Starting Slots | the short positions, or "every starting slot filled"; `bad`/`accent` | `/free-agency?pos=<first>` — an empty slot is not fixed by reordering, there is nobody to reorder |
| Starter OVR | "across all N starters". **The colour legend lands here**, because this page is cards not tables and has no OVR column header anywhere to hang it on; the alternative was printing the same bubble sixteen times down one screen | — |
| No Backup | the thin positions, or "depth everywhere" | `/free-agency?pos=<first>` |
| Injured Starters | "backups start automatically" / "none". **Reports and stops.** `computeUnits` filters the group through `isAvailable` *before* applying the depth chart, so reordering by hand changes nothing — and obeying an instruction to reorder was worse than ignoring it, because the demote was permanent and nothing prompts a GM to undo it when the man heals | — |
| Out Of Order | the misordered positions, or "best man starts everywhere" | — |

Body: CSS **columns** (`columns-1 lg:columns-2 xl:columns-3`), not a grid — a grid row is
as tall as its tallest cell, so a two-deep QB card sat in a box sized for the seven-deep WR
card and the page ran close to half empty. One `DepthChartGroup` per non-empty position,
each row carrying name, OVR, age, injured flag, body, and `capHit()` — the same function
the cap page, the player card and the trade board run — `null` and not zero when there is
no contract row.

`openStarterSlots` counts `max(0, startersAt(pos) - startersAtPosition(pos).length)`;
`starterAvgOvr` averages across all starters, each counted once per slot he fills, so a
three-deep receiver group weighs what it does on the field. `misordered` excludes injured
players: benching someone who is hurt is exactly right.

### 4.4 `/league/[id]/cap`

Two views via `?view=advanced`, switched by Basic/Advanced pills in the masthead action.

The masthead eyebrow is **`summary.capYear`, not `league.seasonYear`** — through offseason
weeks 1–2 the ledger has rolled onto the new league year and the League row has not, so
labelling off the League row is how this page came to head next year's salaries with last
year's date.

**Facts (5):** Cap Space (+ "N% of the cap used"), Cap Limit, Committed (+ "N contracts"),
Dead Money ("already spent, unrecoverable" / "none on the books"), Mode
(Realistic/Simplified).

**Non-compliance panel** (`bad`-bordered, shown when not compliant): the shortfall at
`text-stat-lg`, then one of four sentences — and each one **names the price**:

- Offseason roll: every team's books run heavy; the new league year starts whether or not
  you are under; how much comes off by itself when the re-sign window shuts; and *"whatever
  you are still over by when it does is carried into the next league year as dead money."*
- Realistic + fixable: *"The week will not advance until you are back under the ceiling."*
- Fixable: signings, extensions, tags and trades are all blocked while you are over.
- Not fixable: cutting everybody still would not clear it; a trade is the only route; the
  week is allowed to advance so you are never stuck — *"That is a reprieve, not a pardon"*,
  and it will appear here under "Cap overage carried".

Then **Fastest route** (N releases, each a link to `?view=contract&from=cap` so the release
lands back on this sheet — the panel is a *sequence* of releases) and **restructure
candidates** with the warning that a restructure raises the dead money if you cut him
afterwards.

**Cap Usage bar** — accent under 85%, warn over 85, `bad` over 96; caption carries active
salary and dead money.

**Advanced only, in this order:** `MultiYearOutlookPanel` (first thing on the tab — the
usage bar told forward in time) → `MetricTiles` (Top-5 Concentration, Cap-Weighted Age,
Committed Next Year, League Spend Rank) → Best/Worst Value Contracts → Cap Allocation by
Position (`HorizontalBarChart`) + Spend vs League Average + Cap Hit vs Overall Rating
(`ScatterChart`) → `DeadMoneyRunwayPanel` (moved to the foot, above Contracts).

**Contracts table** (both views, closing the page): Player, Pos, Age, OVR, Cap Hit, Base,
Yrs Left, **Cut: Net Saving / Dead** — the savings/dead pair is what turns the table from
a statement into a decision.

**Empty state:** a value list with no qualifying rows prints *"Nothing qualifies yet."*
rather than an empty box.

### 4.5 `/league/[id]/analytics`

**For:** what the numbers say about this football team. Two views via `?view=advanced`
(pills labelled **Simple** / **Advanced**).

The subtitle is deliberately **in-world**: it points at the cap sheet and the stats page
rather than explaining that the screen is "read-only arithmetic over what this save already
produced". README principle 0 — nothing breaks immersion faster than the game explaining
its own implementation.

**Facts (6):** Record (+ division position and games played), **The scoring says**
(Pythagorean expected record, the luck delta and the unluckiest rank — `—` with "no games
played yet this season" before kickoff), Roster rating (+ rank, off, def), Committed (or
`—` "cap mode is off in this league"), Cap-weighted age, Projected finish.

`AnalyticsShell` with `showEra` and `showUnits` on advanced; `HeadlineRead` first.

| Panel (`PanelBoundary` title) | Span | View |
|---|---|---|
| Are You Paying For What You're Getting? | 12 | both |
| How These Games Are Actually Being Decided | 7 / 12 | both |
| What Is Left | 5 | advanced |
| Who Outperforms The Deal, Who Is An Anchor | 7 / 12 | both |
| The Cliff, Two Years Out | 5 | advanced |
| The Luck Ledger | 12 | both |
| The Drive Board | 12 | advanced |
| The Efficiency Room | 12 | advanced |
| Draft Return By Round | 12 | advanced |
| Is The Money Still Climbing? | 12 | advanced |

Closing, advanced only: **"What we don't measure"** — three sentences, in-world. No snap
counts, so a lineman's week leaves no trace; no play-by-play, so drives are the smallest
unit kept; no archive of past unit ratings, so every rating on the screen is today's.
Honesty is kept because the alternative is a screen that quietly omits what it cannot
compute; it is just said the way a person would say it.

**Empty states:** every rate read falls through to *"Nobody here has the attempts yet to be
judged on a rate."*; `PanelBoundary` isolates a panel failure so one broken read cannot
take the page.

### 4.6 `/league/[id]/stats`

Two axes of state: `?scope=myteam` (tab) × `?split=playoffs` (scope toggle) ×
`?view=advanced` (pills, **League tab, regular season only** — the advanced blocks are
regular-season constructs).

The eyebrow is `year · phaseLabel · Week n`. `league.week` restarts at 1 in every phase, so
a masthead printing it bare said "2028 · Week 1" in the first week of the regular season
**and again** in the first week of the playoffs.

**Facts — My Team:** Stat Lines (`N of M` "men with production"), Games Played ("none
played yet" when zero, else "deepest postseason run" / "longest season on the books"),
Ranked Against. **Facts — League:** Players Ranked, Clubs, Games Played.

`StatsTabs`: **League** (`N clubs`) and **My Team** (the club abbr), the second only when
there is a user team.

**My Team pane:** `PositionVerdictStrip` with a footnote stating the qualifier
(`Minimum N games played to qualify`, or in the postseason *"Every man who has played in
the bracket qualifies."*), then **one table per row** per position section — two-up fitted
the short defensive tables and clipped everything else; a quarterback's Advanced line is
eleven columns. Each table header names how many men and *which number is painted*
("league standing on X" / "not ranked, this game deals the numbers"). Closing note: no
table for the offensive line, because the box score records no individual line for a
lineman and there is no honest stat row to draw.

**League pane:** `PositionVerdictStrip`, then advanced-only Luck Table (actual vs expected,
sorted by how far a record sits above what the scoring earned), Passer Rating bars
(`maxValue={158.3}`), Offense vs Defense quadrant scatter with league-average dashed lines;
then the category leader boards (top 10 each) using **competition ranking** — two men on 27
touchdowns are both 3rd, prefixed `T`, because printing the array index gave one of them
4th purely from where the sort dropped him; then Team Stats.

**Empty states — four distinct ones:**
- My Team, postseason, club did not play one: *"… did not play a postseason game in YYYY,
  so there is nothing to show here rather than a table of zeroes. The Regular Season split
  has the full year."*
- My Team, no lines: *"No stats recorded for this roster yet in YYYY — this fills in as the
  games are played."*
- League, postseason: *"No postseason games have been played in YYYY yet — this fills in
  once the bracket starts."*
- League, regular: *"No stats recorded yet this season — check back after Week 1."*
- Per-table: *"No qualifying players yet."*, *"No qualifying passers yet."*, *"No postseason
  games played yet."*

### 4.7 `/league/[id]/standings`

Subtitle states the seeding rule and the real constants: *"Division winners are seeded
above every wild card… Top 6 per conference make the field; the top two get a bye."*

**Facts (5, user team only):** Your Record (+ pct and week), Playoff Position (`#N seed` /
`Outside`, with "Leading the division" / "Wild card" / "N games back"), Point Diff,
Division record, Streak.

| Panel | Shown when |
|---|---|
| `PlayoffBracket` | playoff games exist. **Once the bracket exists it replaces the projection** — a projected field is only interesting while the field is undecided |
| `PlayoffPicture` | no bracket yet and the user's conference has a field or a hunt. Seeds in order with the bye line and the cut line drawn in, a three-swatch legend (Bye gold / Division accent / Wild card accent2), then the clubs still in the hunt under a **Cut line** strap, dimmed to **80%** (not 70%: at 70 a losing streak in `bad` measured 4.23:1, the last rendered text on the page under the floor; at 80 it is 5.15:1 and the row is still visibly quieter) |
| `PowerRankingsCapsule` | always |
| Division tables | always — one `.table-clean` per division, two-up from `md` |

Division columns: seed chip (accent when division leader, accent2 when wild card, `—`
otherwise, with a native `title` saying which), Team + a rank-delta arrow, W, L, T, PCT,
DIFF, STRK, OVR (hidden below `sm`, with a native `title` because a nine-column table
cannot carry a `?`).

**Empty state:** before kickoff there is no bracket and no hunt, so neither playoff panel
renders and the division tables show 0-0 rows — which is what the standings of an unplayed
season *are*.

### 4.8 `/league/[id]/power-rankings`

Its own screen rather than a block on the standings, for the reason a real league publishes
it as its own thing: the standings are a record of what happened and this is an argument
about what it meant.

**Facts (up to 5):** Your Ranking (+ the move, or the record and rating when there is no
move), Against The Record (the gap between the power rank and a record-only rank), Biggest
Riser, Biggest Faller, Furthest From Its Record. Every one is omitted when it has nothing
true to say.

**No-movement panel — three sentences, and which one you get is the information:**
- Not storable (out of season): *"Out of season this is a roster ranking: nobody has a
  record, so there is nothing to be above or below and no week-over-week movement to
  report. The weekly editions resume when the season does."*
- First snapshot: *"First ranking on record for this season, so there is no movement to show
  yet. Next week every row carries its change against this one."*
- No earlier week: *"No movement is being shown, because no earlier week is available to
  compare against — and last week's order cannot be recomputed after the fact, since a club
  that signed a free agent on Tuesday would rewrite its own history. Nothing is claimed
  rather than a zero that would imply nobody moved."*

`PowerRankingsTable`, then **"How this is worked out"** — the four components with their
real weights printed from `POWER_WEIGHTS`: Résumé (results credited against the quality of
who produced them), Adjusted margin (schedule-corrected, single games capped at three
scores), Roster rating, Recent form (last four games, most recent weighted most). Closing:
early in a season the three result-based components are scaled down and the roster rating
takes up the slack, because six weeks of football is a small sample; the index is centred
so the league average is 50.

### 4.9 `/league/[id]/schedule`

**For:** your own season on one line per game, and the league's slate for one chosen week.
Rendering all 17 weeks produced a page roughly sixteen thousand pixels tall that nobody
scrolled.

`activeWeek` defaults to the week being played, falling back to the last week that exists.
Postseason `Game` rows are numbered 1–4, which collides with regular weeks 1–4, so the
user's own games are ordered by **round first** (`REGULAR WILDCARD DIVISIONAL CONFERENCE
FINAL`) and labelled by round.

**`scheduleDrawn` is the load-bearing binding.** `ensureSeasonSchedule` runs in `PRESEASON`,
so from the final whistle until the new season opens — the whole of `OFFSEASON`, `RESIGN`,
`FREE_AGENCY` and `DRAFT`, four phases and most of what a new save walks through in its
first hour — the league year has rolled and there are no fixtures in it. Every tile used to
fall through to its end-of-season branch: **"season complete", "none", "nothing left", under
a masthead reading "2027 · Re-sign Window"** — while the body underneath said the true
thing. The two states are told apart by whether there is a schedule at all.

**Facts (4):** Your Record (`—` / "no football played yet"), Next Up (`—`; detail "season
complete" only when the schedule *is* drawn, else "fixtures not out"), Games Left (`—` /
"nothing drawn"), Remaining SOS (`—`; "a hard run in" over .550 in `bad`, "a soft run in"
under .450 in accent, else "about average"; "nothing left" vs "no opponents yet").

Panels: your own season (one row per game, club-tinted) → **Around The League** — a week
pill bar (active in accent, the live league week outlined in accent, rest muted; a
postseason week shows its round's first four letters), then `MatchupCard`s two-up, played
games linking `/game/[gameId]` and unplayed ones at 70% with pointer events off. Under each
played card: a `MarginTag` plus one word, and **the word only appears when it says
something** — `tie`, `one score` (≤8), `decisive` (≥28); a neutral result shows only its
margin.

**Empty state:** *"Nothing drawn yet — The YYYY slate goes up when the new season opens in
preseason camp. Until then the offseason is the calendar — the re-sign window, free agency
and the draft all come first."*

### 4.10 `/league/[id]/news`

**Facts (3):** Filter (the label, "every category" / "one category"), Stories ("matching
this filter"), Showing (`a–b`, "page N of M").

Filter pills: `ALL NEWS TRADE SIGN RESIGN CUT POSITION DRAFT INJURY CHAMPION FIRE
DEV_MILESTONE DEV_PROJECTION`. Awards use their **short** codes here — these are chips in a
dense feed, the one place a full "Offensive Rookie of the Year" will not fit.

Rows are grouped under `YYYY · Week N` headings. `PAGE = 60`. `TYPE_WEIGHT` gives a story
its treatment: weight ≥ 2 gets `py-4`, a `raised/25` backing, a 32px crest and a `text-base`
headline; everything else `py-2.5`, 24px, `text-sm`. Championship and MVP are 3; the other
trophies, firings, trades and draft picks 2; signings, re-signs, tags, cuts, position
changes and revised projections 1; stat-leader news, injuries and development milestones 0.

Each row: crest (or a grey disc), a category kicker in that category's ink, the headline —
**a link to the player when the row carries a `playerId`**, plain text otherwise — and the
detail. Pager: `← Newer` / `Older →` with `a–b of N`.

Colour note: a position change and a revised projection both wear **chalk**, not the
signing green — a reshuffled line is not business the club did on the market, and a revised
ceiling is neither good news nor bad news league-wide.

**Empty state:** *"Nothing here yet."*

### 4.11 `/league/[id]/history` — Ring of Honor

**Facts (4):** Champions Crowned ("seasons completed" / **"no title decided yet"**, gold
when > 0), Records On The Books (+ the season/career split), Awards Handed Out,
Franchises.

| Panel | Shown when | Contents |
|---|---|---|
| Franchise Dynasty Score | always | every club ranked on its whole book — championships, playoff depth, win rate, draft hits, cap discipline, awards, league records — including silverware won long before the current front office. Columns: Rank, Team, Since, Score, Driven By. The user's row also prints **his own** tenure line, from `buildGmCareerSummary` bounded to the hire year, so he cannot read the club's trophy count as his |
| The finals roll | titles exist | per year: champion, runner-up, and the Championship MVP as a link when the row carries a `playerId` |
| Single-Season Records / Career Records | `leagueRecords.length > 0` | Category, Record, Player + team, Year / As Of |
| Award Winners | awards exist | Year, Award (gold, 🏆), Player, Team, Stat Line |
| Franchise History (`#franchise`) | always | a `HistoryTeamSelect`, a club-tinted hero with the crest at 56px over a 220px watermark, championship pills, and the season table: Year, W, L, T, PF, PA, Result — champion rows backed in `gold/5` |

**Empty state:** *"No completed seasons yet — finish a full season to start the history
book."* The Dynasty Score row's "Driven By" cell falls back to *"Nothing on the board
yet"*. `champCount === 0` prints "no title decided yet" rather than "0 seasons completed".

### 4.12 `/league/[id]/dynasty`

**For:** your record as a GM turned into a career track. Subtitle states the whole rule: XP
comes from what the club achieves with you in the chair — never from repeating an action,
and never from a season decided before you were hired; every level banks one skill point.

**Facts (5):** Dynasty Level (+ "Level N+1 at X more XP" / "Maximum level"), Total XP
(+ "Since YYYY"), Skill Points (+ "N spent · M earned", accent when unspent), Record
(+ completed seasons), Next Point ("Every level banks one").

Panels: **Level progress** (a bar plus "X / Y XP toward level N+1 · Z to go", and an accent
line when points are unspent) → **the tree**, three branches from `BRANCH_ORDER`, each a
column of `DynastySkillCard`s; `SCOUTING_NETWORK` shows **both** counters it buys (Full
Scouts and Private workouts), because a card that promises workouts and then only counts
evaluations is the kind of half-truth that makes a skill feel fake → **Perfect Evaluations**
(`FullScoutPanel`) → **Front Office Intel** (three panels: Breakout Watch, N-Year
Projections, Aging Curve Read) → **XP Ledger** (Source, Detail, XP, with a Total row).

Closing note: *"XP is recomputed from franchise history every time this page loads — there
is no ledger to farm and nothing to lose. Only your spent skill points and your remaining
limited-use charges are stored."*

**Empty states — one per block, and each says which of the three things is true:**
- No Development upgrades at all: *"Nothing to report. Buy an upgrade in the Development
  branch and your staff's forward-looking work on the roster shows up here."*
- Node not bought: *"Locked."*
- Bought but nothing to say: *"Nobody young on the roster is standing out to the staff right
  now."* / *"No young players on the roster to project."* / *"No veterans on the roster to
  read."*
- No XP: *"No XP yet. You took the job in YYYY — win some games and this fills up. Franchise
  history from before you were hired does not count toward your career."*

### 4.13 `/league/[id]/gm` — GM Career

Hero: club-tinted, "GM Career", `CITY NICKNAME` in `.text-team`, *"On the job since YYYY —
N seasons and counting."* Right: a one-line description of the artefact (*"N seasons on one
card, sized for a screenshot."*) and `GmCardReveal` wrapping `GmCard`. The card is a second
**view** of this page's summary, never a second source for it.

Then `GmCareerTabs` with three panes, each carrying its own hint:

**Career** (`N seasons · W-L`): badge grid (`s.badges`), then five stat tiles — Record (+
win rate / "No games yet"), Championships (+ playoff trips, gold when > 0), **In January**
(playoff record, kept apart from the autumn one at the source), **In the Division**,
**All-Star Players** (distinct players in the headline, selections underneath, so the two
can never be read as each other) — then the **Season Log**. The best season is **named on
the header** and its row is lit, rather than given a panel beside the table that would print
the same three figures. The season in progress is synthesised when it has no
`TeamSeasonRecord` row yet, and stands down once it has one.

**Draft** (`N picks · M hit` / **"No picks called yet"**): `GmDraftRounds`, `GmDraftTable`.

**Moves** (`N trades · M signings`): five tiles — Trades Made (+ `won · lost · even ·
still playing out`, or **"None graded yet"**), Signings, **Re-signed** ("your own men,
kept"), Released, Franchise Tags — then `TradeRetrospectives` titled "Every Deal You Have
Made" with Best of N / Worst of N labels, `GmDeadMoneyPanel`, and **Your Latest Moves**.
There is deliberately no "Drafted" tile: the draft tab counts the same picks off the pick
table, and two counters for one number is how they come to disagree.

**Empty state:** *"No moves yet — the ledger starts with your first signing or release."*
The "Your Latest Moves" sub-head only says "the trades are graded above" when a graded
panel is actually rendered.

### 4.14 `/league/[id]/scouting` — Scouting Department

Subtitle: *"The board is free and everybody has it. Your edge is knowing where it's wrong
— and paying attention to the right handful of names for long enough to find out."*

**Facts — class in (up to 5):** Class (links `/draft`), Shortlisted (gold when > 0, else
warn "star anyone to start"), **File By Draft** (dropped entirely once `weeksLeft === 0` —
a projection over weeks that will not happen), Workouts (`remaining/max` + the window tag
written by the same function the panel quotes in full), **We Disagree** (not "Board Leader",
which was row one of the table 200px below rendered a second time).

**Facts — no class (2 only):** Class (`—`, "the YYYY class lands in week 1") and Workouts
("to spend once the season is over"). With no class in, three of the five would be an em
dash, and a strip of placeholders reads as a broken page rather than an early one.

**No-class state** replaces the whole body: a section headed **"The Class Isn't In"** with
two paragraphs (next spring's class lands the week the season kicks off, graded for every
team at once; advance into week 1 and this page fills up) plus a `ScoutsRoom` quote —
*"Nothing to look at yet. Get me to the season and I'll have names for you by the first
bye."* — attributed to the Director of College Scouting.

**Class-in body, three numbered sections:**

1. **The Consensus Board** (eyebrow "Free · public · identical for every team"; action
   "Whole class, sortable →"). A two-sentence statement that the room is wrong in six ways
   it will tell you about *and* wrong again in ways nobody can name — which is why the first
   pick busts and the fifth-rounder plays a decade. Then `ConsensusBiasFilter`, then the
   rows (`BoardRow`), then a footer that **says what the rows are and what they were
   truncated from**, plus a right-aligned legend (slot pull, Board grade, Band) — every
   bubble in it anchored `end`, because which item is rightmost moves with the viewport and
   a centred bubble on whichever one lands there is horizontal page scroll.
2. **Who Your Staff Is Watching** (eyebrow "Free · every week · the only ongoing input").
   Action carries the per-man attention split and the weeks left, or — once there are no
   weeks left — *"The watching is done for this class"*, because a per-week split quoted
   when there are no weeks left is a rate for work that will not happen.
3. **Private Workouts** (eyebrow "Scarce · one class"). Shut: **one line** — the window
   label and "N of M still in hand". Open: the window label, a paragraph on what a workout
   does *and does not* tell you (*"It will not tell you how he reads a defense — that is the
   read that busts picks, and one day in a facility cannot settle it."*), then up to nine
   cards from the shortlist.

**Empty states:**
- Filtered board with no hits: *"No prospect <pool> carries the <Bias> tag this year"* with
  a link back to the board.
- Class picked clean: *"Nobody left on this board — the class has been picked clean."*
- No named bias on anybody left: *"Nobody left on this board carries a named bias. Whatever
  the room has wrong about the men still here, it cannot tell you what it is."*
- Nothing starred: *"Nobody starred. Your staff is watching the class the way everybody else
  is — from the same public board. Star a prospect on any row above… and they start working
  him this week, at no cost, for the rest of the season."*
- Nothing starred, workouts open: *"Star the men you are considering first. A workout is the
  last question you ask about a prospect, not the first."*

### 4.15 `/league/[id]/draft`

The largest route in the app. It has **six states**, and which one it is in decides whether
the two-pane toggle exists at all.

| State | Condition | Toggle |
|---|---|---|
| Pre-draft scouting | no draft running | none — the page is a masthead, your picks and the class; it is all board already |
| The War Room | board set, clock stopped | none — nothing can be taken yet; the panel that starts the draft **is** the page, and a "watch the broadcast" view of a draft that has not begun would be an empty room |
| Live rookie draft | `DraftState`, `kind !== 'FANTASY'`, `phase === 'DRAFT'`, started | **The Board** (default) / **The Room** |
| Live fantasy draft | `kind === 'FANTASY'` | none — no `DraftPick` rows, so no broadcast and no order to run out |
| Finished (`draftClosed`) | state complete | **The Class** (default) / **What's Left** |
| After the phase moves on | class flags cleared | none |

`DraftViewToggle` carries an `id` for the pane's **job** and a `label` for its **name**:
`board` is always the men, `room` is always the draft as an event. Nothing is dropped —
every panel on the page is in exactly one of the two, and **the clock stands above both,
always**, because a GM must never be unable to see whose pick it is.

The default is the **page's** call, not the component's: a live draft opens on the board
(it is also the leading tab, and a leading tab that is not the open one is a screen
disagreeing with itself); a finished one opens on the recap. `urgent` is read only for
scoping — on the clock, or one name away, with the note *"You are on the clock."* /
*"One name to go."* A finished draft is never urgent and cannot become urgent.

**Masthead** (suppressed while a club is on the clock, because the hero takes its place):
eyebrow `Rookie Draft · Round N` / `Fantasy Draft` / `Rookie Draft` / `Scouting Hub`; title
`Pick N of M` / `YYYY Draft Complete` / `YYYY Draft Class`. The class is named for the
**draft** these prospects are selected in, not the season being played. Subtitle, three
branches:
- `classSize === 0`: *"No names on the board yet. The class is not put together until the
  season kicks off — from week one it is yours to scout, right through to the draft, which
  opens after free agency."* **This branch is not cosmetic** — the class is seeded by the
  `PRESEASON` phase step and a league is created sitting *in* preseason, so a first-timer
  clicking here after free agency was handed an instruction, followed it, and got an empty
  screen with no way to tell whether it was broken, early, or his fault.
- Class graded and the draft year has arrived: *"The season is in the books and the class is
  graded — your selections and where they land are below. The draft opens when free agency
  closes."*
- Otherwise: *"The incoming class is browsable all season — scout them now, the draft opens
  after free agency."*

**Facts (4):** Prospects / **Undrafted** (detail names the active filter and search, or
*"nobody called their name"*), Shortlisted, Your Picks, Well Scouted (warn at zero).

**The War Room panel:** club-tinted, 2px border, `shadow-elevated`, hash texture, a 240px
crest watermark. Crest at 56px, `YYYY Rookie Draft · N rounds · M selections`, **THE WAR
ROOM** in `.text-team`. A paragraph: the class is graded and the order is set, who is first
to the podium, how many selections you hold and where the first lands — or *"You hold no
selections in this draft — you can still watch it, and the board comes to you if a deal
happens."* — closing *"Nothing goes on the clock until you send it."* Four tiles (Your
Picks, On the Board, Shortlisted, Well Scouted). Then, when they apply: an unused-workout
warning in warn (*"the window closes when this draft opens"*) and `RookieCapWarning` —
above the button, never inside its confirm, because it is the state of the books and is
true whether he clicks anything or not. Then `StartDraftButton`, then a closing line about
pausing and fast-forwarding.

**Board pane** (`#big-board`): `SectionHeading` titled **Big Board** / **Still On The
Board** / **Undrafted** — "still on the board" is a thing you say while there is a board;
once the seventh round is over these men are simply the undrafted. Action row: `ProspectSearch`
(carrying the position pill and shortlist with it, so typing narrows what is already on
screen instead of quietly resetting it), an `All` pill, a pill per position, and a
`★ Shortlist (N)` pill. Then the workout ledger line — **not** in the war room (which is
already speaking about unspent workouts in its own words) and **not** once the draft is
over (a budget nobody can spend on men nobody can fly in). Then the table, capped at
`max-h-[44rem]` and scrolled, with a sticky head: the scouting hub shows three hundred men
and ran to twenty-one thousand pixels of one table. Columns include a sortable **Ours**
(this club's own grade, only for men we have a real file on) alongside consensus, position,
OVR, age, potential and athletic rank.

Every board link is `scroll={false} prefetch={false}` — a plain `<a>` reloads the document
and a reload throws away the view the GM is standing in.

**Room pane:** `BroadcastHero` (round and pick, "You Are On The Clock" / "<City> On The
Clock", the club, your next pick and `UPCOMING_SLOTS = 20` clubs of selection order, with
`LiveDraftTicker` as the clock), `SelectionFeed`, `TheSelection`, `BoardDepletion`,
`RunWatch` (`RUN_WINDOW = 12`), `BestAvailable`.

Non-broadcast states close with **Recent Picks** (transaction headlines). It is suppressed
during the broadcast, where the feed says all of this *and* what each pick meant — the two
together would be the same list twice.

**Empty states:** board with no rows prints a `boardEmptyState` row that names which filter
emptied it (e.g. *"Nothing on your shortlist is a <POS> still on the board."*) with undo
links. Recent Picks: *"No picks yet."*

### 4.16 `/league/[id]/draft/broadcast`

A permanent `redirect` to `/league/[id]/draft`. The broadcast was built here first as a
route the owner could open beside the old board and judge; he judged it, and it is now the
draft page itself. The route stays only so a saved link still lands somewhere real.

### 4.17 `/league/[id]/free-agency`

Title is the live count: `N Available`. The subtitle is the longest in the app and is the
whole minigame stated plainly: the asking price is a number that gets it done; most men
will take something under it and the interest meter is how you find out how much; salary,
term and guarantee are yours to set; every refusal costs patience; rival teams are bidding;
and the longer a man goes unsigned the less he will take.

**Facts (up to 4):** Cap Space (links `/cap`), On The Market (+ the pool total when
filtered), Best Available (an exact OVR when revealed or confidence ≥ 90, else the range —
and the tile **links to his contract face**, because on free agency the reason to look at a
man is his price), Within Budget (warn at zero).

Panels: **Top Available** strip (avatar, position, name, age, `Asking $X/yr` with "down
from $Y" in accent when he has decayed, a slot verdict badge, a `RatingBadge` or a
`ScoutingRange`, and `Negotiate`) → position pills → `DepthCompare` for the focused row →
the table.

Table columns: Pos, Name, Age, **OVR / Scouted**, and the market and action columns.
Sortable: `pos age ovr market`.

**Empty state — three different reasons, three different sentences, and only one of them
carries a button:**
- `FANTASY_DRAFT`: *"Every professional in this league is in the fantasy pool, waiting to be
  picked. There is no free agency until the draft has run — whoever is left on the board
  when it ends lands here, and that is when this screen has something on it."* +
  `Go to the fantasy draft ▸`.
- A position filter with no hits: *"No unsigned <POS> anywhere in the league right now."*
  plus the pool count at other positions, and `Show the whole market ▸` when there is one.
- Genuinely nobody: *"Every man in the league is under contract. Nothing opens up until
  somebody is released or a deal runs out at the end of the season — the wire fills again
  when the offseason does."*

There was no branch for this at all before: an empty pool drew the masthead over a table
with a header row and no rows. It is not a rare state — it is what a fantasy league looks
like from creation until its draft is over.

### 4.18 `/league/[id]/resign`

**The masthead has to know what month it is.** This page is reachable in every phase and it
said "2027 Offseason · Re-sign Window" over a league in week 5 of the regular season, with
a subtitle promising that undecided players are released when this phase ends — false in
`REGULAR`, `PLAYOFFS` and `DRAFT` alike.

- Eyebrow: `YYYY Offseason` in the window, `YYYY Season` outside it.
- Title: **Re-sign Window** in the window, **Contracts Running Out** outside it.
- Subtitle: the hometown-discount rule (biggest while a contract still has a season to run,
  mostly spent by the offseason his deal is up), then **in the window** *"Whoever you leave
  undecided is released to free agency when this window shuts"*, and **outside it** *"The
  window itself opens in the offseason — that is when a decision becomes a deadline. Until
  then this is a list, and getting ahead of it is up to you."* Plus a clause naming the
  cohort: in the offseason cycle only men whose deals have actually run out; in-season only
  men whose deals end when the season does.

**Facts:** Decisions (+ "N more set aside"), **Franchise Tag** (in the window: `Used` /
`1 left` with the tagged man named; outside it: `1 a year`, "usable once the window opens")
— the tag is one per league year, works only inside this window, and its control is a small
pill inside a row you have to open first, so a GM could play a whole career without learning
he had it; this tile is the sign on the door — **Expiring This Offseason** (warn; *not*
"Already expired", in red, about men still on the roster: nothing is lost, nobody may sign
them, and they only walk if the window shuts undecided), Cap Space (links `/cap`), On The
Books. Action: `LetAiResignButton`.

The two count tiles **reconcile out loud**, by one rule applied across every surface: a
count that *prompts* you about a man drops the ones you have set aside; a count of what will
*happen* keeps them, because "not now" was never "he stays".

Body: one `ResignRow` per man, opened automatically when `?player=` matches. Each row takes
the current cap hit, the space available (current space plus his own hit back), the years
remaining, a tag state, the depth at his position, and `marketApy` — **a band, deliberately
not his real number**, because printing it would end the minigame.

Then **Set aside · N**, with a line that states the cost: *"Not released — but N of them
is/are out of contract and walks/walk when this phase ends."* / *"Not released. Their deals
still have a season to run."*

**Empty states:** *"Nobody's contract is expiring soon — nothing to do here. Advance
whenever you're ready."* and, when every row is parked, *"Every expiring contract is set
aside. They are below, and none of them has been released — bring anyone back before you
advance."*

### 4.19 `/league/[id]/trade` — Trade Center

**Facts (5):** Pending Offers ("waiting on you" / "nothing incoming", accent2 when > 0),
Tradeable Picks, Cap Space ("before any deal", links `/cap`), **Deadline** (`Week N` /
`Passed` ("reopens in free agency") / `None` ("trade year-round")), Trades Made ("graded on
your GM page", linking `/gm` — the tile says where the history moved to rather than pointing
at something that is no longer here).

Eyebrow swaps to `YYYY · Deadline Passed` when it has.

Panels: `PendingTradeOffers` → `TradeBuilder` (my team, partner selector over all other
clubs each carrying a one-line philosophy summary, both rosters, both pick sets, the initial
give/get from `?reviewOffer=`, both clubs' cap space, the cap mode, the deadline state,
`forceTradeEnabled`, the draft rounds, and the last trade's recap) → `TradeRetrospectives`
for this partner, **rendered only when there is a shared history**, because an empty panel
headed "your deals with CLE" over nothing is worse than no panel.

`?with=` picks the partner; `?reviewOffer=` loads an offer and derives the partner from it;
`?pos=` pre-filters the partner's roster. Every figure on the recap card is the one the
system used: the depth-chart consequence is `rosterFit` (the same function that prices a
trade for the AI) and the dead money is the `CapCharge` row the executor actually wrote.

### 4.20 `/league/[id]/player/[playerId]` — the player card

One card, two faces. `PlayerCardTabs` takes a hero, a summary band, a stats pane and a
contract pane; what sits under the card is the context you read it against.

`?view=contract` opens on the money (set by every negotiation entrance); anything else
lands on stats. `?from=fa|cap` plus `?fq=` builds the return link, and `from=cap` also makes
a release return to the cap sheet — that release is one step of a sequence, and a hard-coded
push to `/roster` made the GM navigate back between every cut.

**Hero:** jersey-coloured, the name lockup, honour pills (`N× All-Star`, award pills naming
the two biggest and counting the rest), and then **one of three stat bands**: a prospect's
college line ("College — through week N of M"), a pro's season line (labelled `YYYY` /
**"Regular season"**, said out loud rather than assumed, because an unlabelled total that
quietly means one of two things is this codebase's most repeated bug), or nothing.

Right of the hero, the rating block — and it follows one rule: **a certain number is said
plainly and only a real range gets the band widget.**
- Revealed: `RatingBadge size="lg" filled` plus an `OvrChangeChip` when a previous season's
  overall exists (absent, not empty, when nobody has written it down).
- Not revealed: `ScoutingRange` labelled "Scouted OVR".
- Potential revealed: a plain number in its tier's ink.
- Overall revealed but potential not (an established pro on somebody else's books): the
  `low–high` pair plus *"You would have to coach him to know exactly."* — **not** a
  `ScoutingRange`, which would put "Confidence: HIGH" under it and invite the reader to
  think the band narrows with work. It does not, ever.

**Summary band — a prospect:** Draft Class (+ college), Projection, 40-Yard (+ Combine /
Pro Day), Competition (`N-tier`), Measurables. **A pro:** `Cap Hit YYYY` (+ "N% of cap") —
or, with the cap off or no contract, `Asking` ("down from $X") or `Market Value` ("what the
rating is worth") — and Years Left (+ "expires after YYYY" / "no contract").

**Stats pane:** Career Record (with a regular/postseason `StatScopeToggle`; end-of-season
overall shown only under the same fog gate the hero uses) → College Profile with a combine
testing band and a competition grade → scouting affordances and `FullScoutButton` →
**Scouting Report** (confidence in the action slot; the prose's hedging is driven by each
attribute's own *displayed* band width, so it can never assert more precision than the fog
is showing) → **Attributes**, two columns read down then across, with each row as a bar, a
value (an exact number when revealed or individually locked, else `low-high`) and its weight
share. The attributes block is wrapped in `MomentReveal` on `workout:<id>` and
`fullscout:<id>` — nothing happens on a page load; it reacts only when the spend comes back
and the new values are on screen.

**Contract pane** (absent entirely for a draftee — he cannot be signed, so rather than a tab
onto an empty box he has no tab): heading with `Rookie Deal`, `Franchise Tagged` and
`Option Exercised` pills — **all past tense, because they are states and not offers** (the
offers are buttons in the box below; this reading is exactly why the owner reported seeing
"the option in the contract tab, but no option to use it") — and `N years · through YYYY`.
Then the deal as signed (Total value, Signing bonus with its per-year proration, Market
value, coloured only on a deviation big enough to matter), then **the decisions above the
evidence**: `ContractActions` (extend, tag, option, restructure), a restructure note, and
`CutButton` — then `ContractLedger`. The release button sat at the very bottom under a
ledger tall enough to push it off the screen.

- Free agent: `SignOfferForm`.
- Neither: *"No contract on file."*

**Under the card, two-up from `lg`:** Your Depth at `<POS>` (the same `DepthList` the
re-sign window draws, from the same component, with the money column simply not drawn when
the cap is off rather than filled with `$0.0M`) and **Position** (`PositionChangeCard`),
placed directly under the depth panel because that list is the evidence the decision is made
against.

`contractShortcuts` on the stats face are offered **only where the move actually exists** —
extend needs years left, tag needs an unblocked untagged state, the option needs an open
undecided window, restructure needs money to push. Naming a button the contract face then
declines to draw would be the same broken promise one screen earlier.

**Empty state:** *"Nobody rostered at <POS> right now — a clear need."*

### 4.21 `/league/[id]/team/[teamId]` — another club

Your own club short-circuits: a masthead with `facts={[]}`, subtitle *"This is your club."*,
and `Open your roster ▸`.

Another club: eyebrow `YYYY · W-L`, subtitle *"Another club's roster, as your scouts have
it. Nothing here is yours to move."* **Facts (4):** Roster Size (+ "N scouted"), Average
Rating, Cap Space ("over the ceiling" / "room to take salary on"), Expiring.

Two buttons: `Open a trade with them ▸` and `Franchise history` (which deep-links
`/history?team=<id>#franchise`). Then the roster, grouped and position-split (OL into
LT/LG/C/RG/RT, DL into EDGE/DT, DB into CB/S), each row read through `buildScoutedView`
with `isOwnRoster: false` — without that the page would be a list of true ratings for a
club you have never looked at.

### 4.22 `/league/[id]/game/[gameId]`

404 unless the game exists, belongs to this league **and has been played**.

The silhouette is drawn from the side the reader has a stake in — their own club when they
played in it, the home team otherwise — because Comeback and Collapse are the same game seen
from opposite benches.

| Panel | Contents |
|---|---|
| Scoreline | both clubs with crest, name and score, the winner marked; centre: an `ArchetypeTag`, `Week N · KIND`, the margin phrase, and `· OT` in accent2 when it went to overtime |
| How it happened | `GameShapePath` (640×150) + `QuarterAxis`, captioned `<ABBR> score differential · N drives`. Five facts: Shape, Lead changes, Biggest lead ("never led"), Biggest deficit ("never trailed"), **Swing index** with the hint *"Sum of every score swing, weighted by how late it came and how close the game was — a curiosity, not a rating."* |
| Linescore | `QuarterLinescore` when `box.quarters` exists |
| Recap | `game.recap` |
| Team Stats | Total Yards, Pass Yards, Rush Yards, Turnovers, Sacks Allowed, Penalties — away / label / home |
| Leaders | `BoxLines` per club, two-up from `md` |

**Empty state:** none needed — an unplayed game is a 404, not an empty page.

### 4.23 `/league/[id]/rebuild`

**The one editorial screen in the app** — the exception that the rest of the game's quiet
exists to make room for. A GM took the worst roster in football, was refused every setting
that could have made it easier, and won a championship anyway.

**404 unless the run was actually won under the rules.** Not an empty state, not a teaser:
there is nothing honest for this page to show a run that has not finished, and a save that
ended its ironman rules did not do the thing this page celebrates.

It is the **record** of the run, permanently reachable — not a moment that fires once.
`TrophyMoment` already owns the full-screen interruption at a budget of exactly one per
season, and this deliberately does not spend a second one. The championship advance routes
here, and so does the Settings screen.

| Panel | Contents |
|---|---|
| Banner | club-tinted, 2px border, hash at 0.07, a 340px crest watermark. `The Rebuild · YYYY–YYYY`, `CITY NICKNAME` / **Champions** in gold at `text-4xl sm:text-6xl`, then the hero number — seasons to the title at `4.5rem/5.5rem` in gold — beside Record over the run and The final (gold, "over the <opponent>"). Then `GmCardReveal` → `RebuildCard`, the one thing on this page that leaves the game |
| Day one — "What you were handed" | the roster as inherited |
| Season by season — "The climb" | one line per season, bars scaled to `maxWins` |
| Rounds one and two — "The men you found" | the picks |
| Every trade you made — "The deals" | the trades |

Every figure comes from `lib/rebuildRun.ts` and nothing is computed on the page: the page
and the pop-out card print the same object, which matters more than usual because the card
is the half that leaves the game.

**Empty states:** the picks and trades sections each carry their own "none" line; the page
itself has none, by design.

### 4.24 `/league/[id]/settings`

Two whole-screen states.

**Ironman (a live Rebuild run):** the entire screen is replaced. *"This league is The
Rebuild. Its rules were set the day you took the job."* A warn-bordered **Locked** panel: a
paragraph on what you agreed to, then four bullets — difficulty is Normal and stays Normal;
forced trades are off and the other club always gets a vote; the cap does not move from
season to season; nothing else on this screen can be changed either. Then the seasons-played
line (*"Season one is not on the books yet."* when zero), `RebuildLock` (the abandon
control), and `ShareLeague`. **Dead controls with no explanation read as a broken page; a
page that says why reads as a rule.**

**Ordinary:** a note that changes take effect from the next advance and nothing already on
the books is rewritten; then, when they apply, a **"The rebuild is over"** panel (with
`See the whole climb →`) or a **"The rebuild was ended"** panel (which states exactly what
is and is not kept). Then `SettingsForm` in six sections:

| Section | Controls |
|---|---|
| Core Rules | Salary Cap Mode, **Cap Growth** (one tooltip carrying all three rungs with their real rates, because the choice is only meaningful as a comparison — plus the warning that lowering it mid-dynasty moves the ceiling under deals already on the books and can leave clubs, including yours, over the cap the next morning), Difficulty |
| Scouting / Fog of War | Scouting enabled, Reveal true ratings everywhere (debug), Fog applies to your own roster too, Scouting focus/week (0–10000) |
| Progression & Injuries | Progression speed (0–5, step 0.1), Injuries enabled, Injury severity (0–5), Retirement enabled |
| Transactions | Trades enabled, AI trade frequency (0–1, step 0.05), Trade deadline enabled, Trade deadline week (1–`seasonLength`), Franchise tag enabled, AI accepts lopsided trades, Allow forced trades |
| Simulation | Sim variance (0–5), Home field advantage |
| Presentation | Recap verbosity (Short / Normal / Detailed) |

Every `NumberField`'s `min`/`max` are **the same bounds the Server Action clamps to**, so
the stepper stops where the rule stops. The server clamp remains the authority and is not
to be removed — a form POST is a POST — but without the bounds on the input the screen came
back rendering a different number from the one the GM entered, with nothing said: a control
quietly lying about what it did.

Every tooltip on this page is `align="start"`, because the form is left-aligned and a
centred bubble opened 17–33px off the left edge at 1440.

`ShareLeague` (outside the form, because it is a download and an outbound link, not a
setting): the export button, the generated filename, and `Import a league file →`, with a
paragraph stating it is a starting point and not a save game — teams, players and contracts,
not your schedule, standings, scouting book or history.

---

## 5. THE DESIGN ROUTES

These exist so a proposal can be opened **beside** the screen it would replace and judged
against it rather than against a description. None is linked from the product nav.

### 5.1 `/design-system`

Internal — Stage 1. `max-w-5xl`, `space-y-16`. Three token sections then fifteen numbered
component specimens.

**Tokens:** Color (11 swatches — ink/card/raised/line/chalk/muted/accent/bad/warn/gold/
accent2 — plus a `--team-accent` swatch set per page/section, with a closing note that text
hierarchy is opacity-based on `chalk` rather than separate colours), Typography (the stat
scale, each step labelled with where it is used), Surfaces/Radii/Shadows.

**Specimens, in order:** 1 Team Header · 2 Player Hero · 3 Player Row — Desktop Table ·
4 Player Row — Mobile · 5 Rating Presentation · 6 Scouting Range · 7 Draft Prospect Row ·
8 Contract Summary · 9 Cap Decision Panel · 10 Trade Offer · 11 News / League Wire ·
12 Matchup Card · 13 Draft — On The Clock · 14 Buttons · 15 Navigation — Mobile Concept
(`BottomNav`).

All demo data; nothing reads the database.

### 5.2–5.4 `/design-system/dashboard`, `/player`, `/draft`

Full-page compositions assembled from those components with mock data — "Dashboard
Composition" (Stage 2 rework), "Player Page Composition" (Stage 3 rework, a signed veteran
and a prospect variant), "Live Draft Composition" (Stage 5 rework, the draft-day event view
as distinct from browsing the scouting hub).

### 5.5 `/design-system/player-card`

The one design route that is a **fixture rather than a mockup**: it runs the real
`lib/careerRecord.ts`, `lib/cap.ts` and `mergeCareerRecord`, because a page that renders the
shape by hand stops being a specimen the moment the assembly changes. It takes
`?split=playoffs`. The specimen is chosen for its awkward cases: a year with an event and no
season line still gets a row, and a quiet season shows an empty column rather than a gap.

### 5.6 `/league/[id]/design/negotiate` — three directions

**Nothing here is a sketch.** Every session is resolved by `resolveNegotiationSession` —
the same function free agency, the re-sign window and the extension form all call — the
meter is drawn by `decideOffer` on every drag, and the button submits to the same Server
Action against the same database. A negotiation mockup with invented salary figures would
answer nothing, because the whole question is whether the real numbers read well.

Eyebrow: *"Design route — not linked from anywhere"*. **Facts (3):** Phase (+ week/year),
Your room, On the market.

"What each direction is trying" — three cards:

| Key | Name | Pitch |
|---|---|---|
| `table` | The Table | Him on one side, your books on the other, the deal down the middle |
| `sheet` | The Term Sheet | The deal as a document that rewrites itself as you move it |
| `room` | The Room | The negotiation as the series of calls it actually is — the only one of the three that works on a phone |

Then three groups of up to six real players each — **An outside free agent** ("Somebody else
can sign him today, and the meter has to be honest about losing him"), **Your own expiring
man** ("Nobody else may sign him — yet. The hometown discount is real and it is shrinking"),
**An extension** ("Years still running are leverage a re-sign does not give you") — every
row carrying three buttons, one per direction.

**Empty state:** *"Nobody on this save is in that state right now."*

### 5.7 `/league/[id]/design/negotiate/[direction]`

`direction` must be `table`, `sheet` or `room`, else **404**. The mode is derived rather
than taken from the URL: free agent → `FREE_AGENT`; your own man with ≥ 2 years →
`EXTENSION`, else `RESIGN`; another club's man → a refusal panel. Header: a back link, three
direction buttons with the active one primary, and the direction's pitch. Then
`DesignNegotiationScreen`.

The subject's `capSpaceNow` is read from `teamCapSummary` so the panel and the page header
cannot quote two different figures for the same club on the same screen.

**Missing-player states:** *"No player named. Pick one from the index."* /
*"No such player in this save."* / *"He is under contract to another club. Trade for him, or
wait."* — each with `Back to the index`.

---

## 6. CROSS-CUTTING UI SYSTEMS

### 6.1 `PageMasthead` and its fact tiles

Every front-office screen opens with the same component, so every screen introduces itself
the same way. The pattern was built ad hoc on Cap, Depth Chart and Free Agency first and
then duplicated; pulling it into one component is what makes the Team, Market and Draft tabs
feel like one product.

**Structure:** `.masthead relative rounded-lg border-2 shadow-elevated`, tinted with
`--team-accent` (resolved from the **abbreviation**, never the row id) and a radial gradient
at 16%. Inside it an absolutely-positioned clip layer carries the 115° hash texture at 0.05
and the 220px crest watermark at 0.06. **The clip lives on the decorations, not on the
card** — `overflow-hidden` on the card itself also cut the fact strip's tooltips, which open
upward out of a band with only ~100px of masthead above it.

Then `eyebrow` (`.label-sm`) / `title` (`font-display font-extrabold text-3xl uppercase
tracking-wide`, in `.text-team` when a club is in scope) / `subtitle` (`text-muted text-sm
max-w-2xl`) / `action` (right, `shrink-0`).

**The fact strip:** `grid-cols-2 sm:grid-cols-3`, and at `lg` **sized to the number of
facts** (1–6, from a lookup because Tailwind needs whole class names to survive its scan).
The Depth Chart passes six, which stranded the last one alone on a second row beside four
empty cells. Each tile: a `.label-sm` label, an optional `?`, the value at `.stat-value
text-stat-sm` with an optional colour, and an optional `[11px] text-muted` detail.

Three rules bind every tile:
- **`tip` must be `tip('<key>')`, never a hand-written string** — or the same term ends up
  explained two ways on two screens.
- **`href` only when the destination is somewhere else.** A tile that links to the page it
  is sitting on is worse than an inert one: it promises a move and delivers a reload. With
  an `href` the tile becomes a `Link` with a hover tint; without one it is a plain `div`,
  identical in every other respect.
- **Tooltips open upward** (the band is inside `overflow-hidden`), and the **end tiles open
  inward** — `align="start"` on the first, `end` on the last, `center` between. The strip
  spans the full page width, and a centred 18rem bubble on an end tile hangs half of itself
  off the viewport; because the bubble is laid out whether or not anyone hovers it, the
  overhang gave the page a *permanent* horizontal scrollbar — measured at 1440: 106px of
  document overflow on Scouting, 13 on Analytics, and a left-edge bubble on the Cap sheet
  starting 22px off the screen.

### 6.2 Navigation

**Outside a league:** `SiteHeader` — one copy, where there were three slightly different
ones. The `D` mark, "Dynasty GM" (hidden below `sm`, because at 390px a full wordmark plus
the right-hand group broke "Sign in" across two lines), and either a caller-supplied `right`
slot or `AccountBadge`.

**Inside a league:** `LeagueNav`, two rows.

| Category | Items |
|---|---|
| Home | Dashboard |
| Team | Roster, Depth Chart, Re-sign, Cap, Analytics |
| Market | Free Agency, Trade |
| Draft | Draft Board, Scouting Dept |
| League | Standings, Power Rankings, Schedule, Stats, News, History |
| GM Career | GM Career |
| Dynasty | Dynasty, **Leaderboard** (absolute — not a page of this league) |
| System | Settings |

The sub-row shows the **active** category's items — or, on hover or focus of any multi-item
category, **that** category's items, swapped in place rather than opened as a floating menu:
the row is already there, it is already the right shape, and a panel that overlays the page
would have to be dismissed. Single-item categories never take the row, because emptying it
would move the whole page up under the cursor. `onFocus` as well as `onMouseEnter`, so
tabbing along the bar walks the same preview; `onBlur` checks `relatedTarget` so the row
stays open while a keyboard user tabs *into* it.

An absolute item is never "active" from inside a league. Routes that live outside every
category — a player card, a game — leave the whole nav unhighlighted rather than guessing a
parent.

**Badges.** Measured across a full league year: twenty-nine presses of Advance, and the
button posed a question the GM could have answered differently *once*. Every real decision
is something he has to go looking for, across twenty-three destinations with no indicator of
any kind. Two counts qualify:

- `/trade` — pending inbound offers, **the same query the dashboard brief counts from**. A
  nav badge reading 3 above a trade page listing 2 would be this codebase's signature defect
  in a new place.
- `/resign` — men who walk at the end of this league year, **and only while the window is
  open**. Deliberately zero in every other phase: in-season the same idea would count every
  walk-year man on the roster, non-zero essentially always, on a decision with a
  twelve-month clock.
- `/depth-chart` — `gaps.length`, reused from the same `lineupGaps` call the banner reads,
  so the badge and the banner can never disagree.

Two rules: **every count must be off most of the time** (a badge that is always lit is
furniture, and the second one becomes furniture it stops working for the times it mattered —
which is why free agency carries none; the size of the pool is non-zero every week), and
**every count must be the number the system uses** (the nav counts nothing itself). Zero and
absent are the same thing to the nav. A category wears the **sum** of what is waiting inside
it, because the item that owns the number is invisible until the row is open.

### 6.3 The advance control

A split button — `Advance ▸` and a bare `▾`. The caret **stays a bare caret on purpose**: it
briefly carried a "Jump ahead" label, but watching a season go past one week at a time *is*
the game, and a word on that control advertises the skip next to the button whose whole job
is not to be skipped. It keeps its accessible name (`aria-label="More advance options"`) and
`aria-expanded`; what it does not get is a poster.

**The menu is built from the phase actually on screen**, because it used to show the same
five options regardless, and once you were past the regular season those targets either did
nothing or silently collapsed to a one-step advance, which read as broken.

| Phase | Options |
|---|---|
| `RESIGN`, `DRAFT`, `FANTASY_DRAFT` | **none** — resolve this stage first |
| `OFFSEASON` | Advance 1 Step · Advance to Re-sign Window |
| `FREE_AGENCY` | Advance 1 Week · Advance to Draft |
| `PLAYOFFS` | Advance 1 Round · Advance to Offseason |
| `PRESEASON` / `REGULAR` | Advance 1 Week · Advance 3 Weeks · Advance to Midseason · Advance to Playoffs · Advance to Offseason |

Free agency has no "Advance 3 Weeks": the phase is three weeks long, so it was a second
button doing exactly what "Advance to Draft" does — two ways to spell one jump.

**The multi-week run.** Driven **one week at a time from the client**, deliberately, rather
than as one opaque server-side loop. That is what makes real progress visible — *"Working
through week 3…"* instead of a static spinner for the whole batch — and it is the whole
reason a stop is possible: there is a seam between every week, and the flag is read there.
`MAX_ITERATIONS = 60` is a safety backstop, not a target.

**The progress popover** opens below the button: a spinner and the live sentence. The
sentence lives here and not on the button — held for a whole batch it grew the button to the
width of "Working through week 14…", which overflows the header at 390px and shoves the
popover, and the stop control on it, off the right of the screen.

**The stop** lives on the popover, not beside Advance: the popover is the only thing on
screen that is moving, so it is where the eye already is — and the Advance button is disabled
for the whole batch, which a control meant to interrupt the batch obviously cannot be. It is
rendered **only for a multi-week run**; a single advance is one round trip that is already
over by the time a hand reaches it, and a stop that could not stop anything would be a lie
in button form. Label: `Stop after this <week|playoff round|offseason step>`, swapping on the
press itself to `Stopping — finishing this <noun>…`. **The label swaps on the press, not at
the end of anything** — the motion rules say animation never gates input, and this is the
control that rule was written for. `Escape` also requests the stop. `min-h-[40px]`,
`aria-live="polite"`.

**The stop flag is a ref, not state**, read fresh on every pass, and read **only between
weeks**: the week just written is whole, and the next one has not been asked for. The week
in flight is finished either way, and the label says so.

**And then it reports what actually happened, not what was asked for.** `iterations` and the
collected reports are counted from advances that *returned*, and the week it landed on is
read back off the **last report** rather than restated from the mode — so a run called off
at week 8 cannot report having reached the playoffs:

- Called off: `Stopped at <landed> — N advances taken. <last summary>`
- Finished, multi: `Advanced N weeks. <last summary>`
- Finished, single: the summary alone

The mode's own stop conditions are checked **before** the user's flag, and the order is the
point: if this week was the one the mode was driving at, the run *finished*, and a stop
pressed while it was in flight has nothing left to stop. It must not relabel a completed run
as a called-off one, and it must not swallow the message a gate phase produces.

**Reports.** Seventeen reports for one click would be intolerable, and a player who asked to
skip to the playoffs has explicitly asked not to be stopped. So every intermediate report is
collected and **none** are shown as they arrive: `foldSpan` builds one span strip — real
per-week results, the record at both ends — and the panel renders the **last** week, which
is where the league now stands. A span folded after a stop is folded from the weeks that were
*actually played*; "Weeks 3-17" after a stop at week 8 would be a fabricated figure.

A season can only end once, so the **first** Tier-0 trophy in a span is the one shown: a run
that passes through a title game and keeps going into the offseason still shows exactly one.

**Refusals, two shapes, and the difference is whether there is anything to DO:**
- The cap gate and the roster-limit gate are standing conditions with a screen behind them,
  so they get a **sticky panel**: a dismissible card with the block's own title (it travels
  with the block — cut-down day refuses too, and a roster-limit block reading "Over the
  salary cap" would be a lie), the shortfall at `stat-stat-md` in `bad`, the summary, a
  "Fastest route back" list of cuts with what each frees, and a link whose label and target
  also travel with the block.
- "The last advance is still being played out" is a busy signal that clears itself with
  nowhere to send anybody, so it gets a **toast**. Rendering it in the block panel would put
  a red heading and an "Open Cap Sheet" button on a league with nothing wrong with it.

### 6.4 Toasts and week reports

Toasts are a `w-80 card card-pad animate-fadeUp shadow-lg` popover under the advance button,
shown only when not busy.

`WeekReportPanel` is a modal with **four ways out, none of them mandatory**: `Escape`, a
backdrop `mousedown` on the backdrop itself, the `✕`, and Close. Header: the week label (or
the span label) with `is in the books` / `are behind you` in muted, then `YYYY · phaseLabel`
(hidden below `sm`).

For a multi-advance it carries the **span strip**: `N advances`, a `Stopped` chip in accent2
when the run was called off, one chip per week (outcome, score, opponent, or `—` for a week
with no game of yours), and `recordFrom → recordTo`. Then the week's own result, the **Game
ball**, **The room** (coach reactions), and the league's other injury count. Its footer
carries `onAdvance` — the same handler the header button runs — because the panel covers that
button while it is open, so the loop has to be able to continue from inside it.

`TrophyMoment` and `SeasonEndCard` take precedence over the week report when both would
fire, and only one trophy fires per season.

### 6.5 The moments / animation system

`app/moments.css` — 333 lines, one stylesheet, no library, nothing on any path the simulation
runs. Every moment is a keyframe plus a class, and **every class is additive**: no existing
rule is redefined.

**A moment earns its animation by being RARE or by being a DECISION.** Scouting a man costs
a charge. Drafting him is the only pick you get at that slot. Losing a shortlisted prospect
to a rival happens once or twice a draft. **Advancing a week is neither rare nor a decision,
and nothing in this file is wired to it** — nor to a page load, a table sort, or a tab
switch. The effect depends on most of the game staying still.

Four things hold throughout:
1. **Nothing fires on a failed action.** Every class is applied on the success path — the
   star fills when the write comes back, not when the button goes down.
2. **Nothing is gated behind a frame.** Final values are in the DOM at frame one; only
   decoration moves, and every control accepts the next click the instant the server answers.
3. **Durations are the tokens in `globals.css` and nothing else.** `prefers-reduced-motion`
   collapses all of them up there, so it is handled once for the whole file.
4. **Reduced motion loses the movement, never the information.** Every animation uses
   `both`/`forwards` so a 1ms run lands on its **end state** rather than on nothing, and any
   moment whose meaning lived only in the movement carries a second static channel: the steal
   keeps its gold ring, the sniped prospect keeps his strike-through.

**Keyframes:** `moment-bar`, `moment-clock`, `moment-confidence`, `moment-flash`,
`moment-flash-lost`, `moment-flip`, `moment-fog`, `moment-pop`, `moment-rise`,
`moment-stamp`, `moment-star`, `moment-steal`, `moment-strike`.

**Classes:** `.moment-called`, `.moment-clock-tick`, `.moment-confidence`, `.moment-figure`,
`.moment-fogged`, `.moment-landed`, `.moment-lost`, `.moment-pick-badge`,
`.moment-pick-card`, `.moment-pick-name`, `.moment-released`, `.moment-sequence`,
`.moment-signed`, `.moment-sniped`, `.moment-star`, `.moment-steal`.

**How they fire.** Mostly with no JavaScript at all: a CSS animation runs when a node
carrying it is **inserted**, so a feed row for a new pick animates once by existing — and
the same node re-rendered by `router.refresh()` does not animate again, which is exactly the
wanted behaviour. Where a moment must fire on a node that was already there,
`components/ds/Moments.tsx` remounts it with a fresh `key`. *Putting the class back on a live
node does nothing*, and the remove-on-`animationend` dance turns into a two-render cycle that
misfires whenever a re-render lands between the two; remounting is the same intent expressed
in the framework's own terms.

`Moments.tsx` exports `motionReduced()` (a single function so there is one answer in the app
rather than two), `useMomentBurst()` (returns a key and a `fire()` to call **on the success
path, never on the click**), and a module-level **signal** bus: `signalMoment(name)` plus a
`MomentReveal` listener. A success in one control sometimes lands somewhere else on the
page — a workout is the case: the button is in the scouting band and the information arrives
in the Attributes panel two sections down, which is server-rendered and knows nothing about
the click. `router.refresh()` re-renders the server tree in place without unmounting the
client components inside it, so a listener mounted around that panel is still there when the
new attributes arrive.

The `fadeUp` entrance (`tailwind.config.ts`) reads `--dur-state` and `--ease-out` with
`both`. It is deliberately **still a rise and not the rise-plus-scale** the mockups showed:
half its consumers are `fixed inset-0` modal backdrops (`SigningMoment`, `DraftMoment`), and
scaling one of those from `.96` opens a bar of bare page along all four edges for the length
of the animation.

The **League Wire ticker** scrolls on `ticker-scroll` (45s linear infinite), **pauses on
hover** so a headline can actually be read, and holds still entirely under reduced motion —
where `overflow-y` is pinned explicitly, because setting only `overflow-x` makes the other
axis compute to `auto` and puts a vertical scrollbar on a single-line ticker.

### 6.6 The League Wire ticker

Ambient, passive flavour only — a scrolling strip of things that already happened, **not a
place for anything the player needs to act on or reliably see**. If it scrolled past unread,
nothing important was missed; anything that matters stays in static UI (the Front Office
Brief, the roster alerts, cap space in the header).

Returns `null` on an empty list. Items are duplicated once so the marquee loops seamlessly
at `-50%`. A fixed `League Wire` label on `raised` in accent2 with a `border-r-2`, stacked
`z-10` above the track (without an explicit z-index the headlines paint over it as they exit
left), and an 8px gradient at `z-[9]` so items **arrive and leave** instead of being chopped
mid-word at a hard edge.

Each item: the crest (14px, `aria-hidden` — the abbreviation is the very next node, so
without it a screen reader says "TAM TAM"), the abbreviation, the category kicker in that
category's ink, and the headline. *"The crest is identity"*: the strip read "SIGNING Signed
Stellan Millsap" — a name and a verb with no club anywhere. Rows that genuinely belong to no
club (the All-Star announcement, a power-rankings note) start at the kicker.

### 6.7 Tooltips and the glossary

`<Tooltip text placement align />` is a `?` button plus an absolutely-positioned
`role="tooltip"` bubble, revealed by `group-hover` and `group-focus-within`. **Pure CSS, no
client JS**, so it renders inside Server Components; keyboard-reachable via the button's own
tab stop, not just mouse hover. `LabelWithTip` is the common case in one import.

Three things about it are load-bearing, not cosmetic:
- **The typography reset.** Triggers hang off `.label-sm` (uppercase, letter-spaced) and
  `.section-title` (bold condensed display), and a bubble nested in one inherits the lot. Six
  lines of letter-spaced condensed capitals is not a sentence anybody reads. Hence
  `font-sans normal-case tracking-normal font-normal text-left`.
- **The width.** `w-72` (18rem). A glossary entry is a definition plus a sentence on what good
  and bad look like; at 14rem that wrapped to a dozen lines and the bubble grew taller than
  the card it opened inside — a clipping bug wearing a copy costume.
- **The placement.** The bubble is absolutely positioned, so **any** ancestor with a clipping
  overflow cuts it off — and `overflow-x: auto` counts, because CSS computes the other axis to
  `auto` the moment one axis stops being `visible`. The Cap page's contract table sits inside
  `panel overflow-hidden` **and** an `overflow-x-auto` scroller, so a tooltip on its sticky
  header opened upward into two clipping boxes: it rendered perfectly and was completely
  invisible. `placement="bottom"` keeps it inside the scroller, where there is always table
  body under it.

**The glossary** (`lib/glossary.ts`, ~900 lines, **138 keyed terms**) is the single definition
per term for the whole game. This codebase's most persistent defect is two places describing
the same thing and drifting apart; "dead money" is now explained in exactly the same words on
the cap sheet, the player card, the re-sign window and the trade builder, and a rewrite lands
on all four at once.

Shape: `definition` is what the thing **is**, in football language; `why` is the optional
second beat — why a GM should care, or what counts as good, bad and normal. It is optional
because forcing one produces padding, and a padded tooltip is worse than a short one. `tip()`
glues them, so a call site never decides how to present a term and two call sites can never
present the same term differently. Keyed camelCase, so `tip('deadMoney')` greps back in one
hop and `GlossaryKey` makes a misspelling a **compile error** rather than an empty bubble in
production. Where a layout genuinely cannot carry a `?` — a nine-column standings table — the
same string goes into a native `title`, so the voice is one even where the affordance changes.

**The writing standard, which is the hard part:**
- Useful and informative, never an explainer that breaks immersion. A tooltip explains the
  **football** concept. It never mentions the database, a box score, a stat line, this save,
  the sim, or how a number is computed internally. *"Signing bonus you already paid,
  accelerated onto the books the year you cut him"* — not *"Contract.signingBonus / proration
  years"*.
- Give a sense of scale wherever it can be supported honestly: what is good, what is bad,
  what is normal. That is what a new GM actually lacks.
- Every threshold comes either from this game's own tuning or from a real-sport fact — never
  from a number invented to sound authoritative.
- **And where the two disagree, this league wins.** Quoting a real-world figure beside a table
  that never produces it is the lying-metric failure in its purest form: a tooltip telling a GM
  his best quarterback is bad at a number no quarterback in this league has ever reached. Every
  benchmark describes *this* league's landscape — and the bands were re-measured when the sim
  was recalibrated, rather than left standing.

### 6.8 The lineup-gap banner

A starting spot with nobody healthy for it. It sits beside `CapAlertBanner` in the league
header for the same reason that one does: it is a standing condition, it costs you every week
it goes unfixed, and it is invisible on most screens. The sim fills an empty slot at
replacement level — a man off the street — so losing your only quarterback is worth roughly
forty rating points at the position that decides games, and until this existed the only place
it showed was the depth chart, which counts bodies rather than healthy ones.

**Deliberately not a block.** Real clubs play short-handed all the time; the game's job is to
tell you, not to refuse to run the week.

Headline: `No healthy <names>` when a position is empty, else `Short at <names>`. Names are
written the way a person says them — one name, "X and Y", or "X, Y and N more" — not
"No healthy QB or TE or K", which reads like a list a machine made. Body: either *"Nobody on
the roster can line up at <POS> this week. Whoever the coaches put there plays like a man
signed off the street, and it will show in the result."* or *"You are N short of a full
lineup across those spots. The empty slots get filled by whoever is left."* Controls:
`Sign someone` → `/free-agency`, `Depth chart`, and a `×`.

**The dismissal is scoped to the hole he actually saw**, and that is the whole design. It is
keyed on the exact set of positions and counts in front of him (`QB:1!,K:1`), stored in
`localStorage` under `dgm:lineup-gap-dismissed:<leagueId>`, so waving away "no healthy K"
cannot also hide "no healthy QB" next week — a new hole has a different key and comes back
loud, and losing a second kicker changes the count so that returns too. He is silencing one
known fact, not turning the warning off.

It starts hidden and is revealed once the browser's answer is read: the other order flashes
the banner on every page load for a GM who already dismissed it, which is worse than
appearing a frame late. Blocked storage fails to **always showing** — the safe direction for
this particular control. Client-side and per-browser on purpose: this is a preference about
being told something, not a fact about the league, and it has no business in a save file an
export would carry to somebody else.

### 6.9 Team logos and colours

`generateTeamLogoParams(seed)` returns `{ primary, accent, shape, pattern }` from a seeded
RNG over **20 curated colour pairs** (crimson/gold, navy/silver, forest/gold, purple/silver,
teal/bone, rust/amber, charcoal/scarlet, steel blue/amber, maroon/gold, olive drab/silver,
slate teal/burnt orange, violet/cyan, pine/mustard, oxblood/silver, cobalt/tangerine,
olive/cream, wine/rose, deep teal/ice, saddle brown/silver, midnight/cyan), **4 shapes**
(shield, circle, hexagon, diamond) and **5 patterns** (plain, stripe, chevron, split, ring).

**It is seeded off the ABBREVIATION, not the team row's id.** A franchise has colours; it
does not re-roll them every time somebody starts a new save. The id is a cuid minted inside
league generation, so the same club came out crimson in one league and olive in the next —
and, worse, no screen that exists *before* a league is generated could show the crest.

`TeamLogo` renders the shape as a clipped SVG path with the pattern inside it. Below
`MARK_MIN_SIZE = 40` it renders only the abbreviation in a dark plate, dead centre — **not a
compromise but the point**: at 20px a drawing is mud and the three letters are the only thing
that reads, and every dense table in the app sits under that line. The mark is an addition at
header and watermark sizes, never a replacement. Per-shape geometry (`cy`, `scale`,
`plateY`, `plateW`) places the mark and the nameplate, because a diamond's usable area is its
inscribed square: one scale for every shape chops the corners off a diamond, and one fixed
plate height leaves the abbreviation sticking out of the bottom of one.

### 6.10 Player avatars

`PlayerAvatar` renders the face described by `lib/gen/avatar.ts` as layered SVG — a **pure
function of (seed, age, body)**, with nothing stored. Styled as a **portrait, not a sticker**:
the bust sits in a tinted frame with shoulder pads filling the base, the head is proportioned
closer to life than to a bobblehead, and the face carries real shading (jaw, brow, neck
shadow) instead of reading flat. Detail is deliberately bold — it is drawn at 20px in roster
tables as often as at 128px on a player card, so the silhouette has to survive when the fine
strokes vanish.

Which is why weight and age are spent on the **silhouette** and nothing else. A 330 lb nose
tackle and a 178 lb kicker used to get the same neck, shoulders and jaw while the line of
text beside them said otherwise. Shoulder span, neck width and jaw width now all scale off
mass, so the heavy man reads heavy in the first ten pixels — before a single facial feature
resolves. Everything above the jaw (eyes, brows, nose, mouth, hair, beard, skin) is untouched
and stays at fixed coordinates: **the same seed gets the same face it always got,
re-proportioned.** A call site that passes no body lands exactly on the neutral build
(`d === 0` reproduces the original geometry to the pixel).

Note, recorded honestly: an internal design review named the portraits as the product's one
real art-direction error at table sizes. They are still in use at 13 call sites. The brief
documents what ships.

---

## 7. THE DESIGN SYSTEM — "STADIUM NIGHT"

Two files are the whole system: `tailwind.config.ts` (the single source of truth for every
colour) and `app/globals.css` (the component classes, the motion tokens, and a set of `--c-*`
custom properties that read the **same** config values back out through `theme()` — not a
second copy of them, because plain CSS, a pseudo-element gradient, a `color-mix()` and
`moments.css` cannot spell `bg-card`, and before that existed those places carried raw hexes,
which is exactly how a re-skin reaches nine tenths of an app and leaves the reactions painted
in the previous palette).

### 7.1 The twelve semantic colours

| Token | Hex | Role |
|---|---|---|
| `ink` | `#070a0f` | page background (and the mobile browser's `themeColor`) |
| `surface` | `#0c111a` | header / tooltip surface |
| `card` | `#111925` | primary plate |
| `raised` | `#1b2634` | secondary surface — inputs, table heads, stat tiles |
| `line` | `#2e3d51` | borders and dividers |
| `muted` | `#a3b4c8` | muted text |
| `chalk` | `#eef4fb` | primary text |
| `accent` | `#3ddc84` | positive |
| `accent2` | `#63cbff` | info / house blue |
| `warn` | `#ffc043` | warning |
| `bad` | `#ff8383` | negative |
| `gold` | `#ffd24a` | elite / gold tier |

Plus two **paired ink** tokens, which exist because a bright fill and the dark type on top of
it are a *pair* and half of that pair used to sit outside the system as arbitrary
`text-[#04202e]` classes — so a palette change reached the fill and not the ink on it:

| Token | Hex | On |
|---|---|---|
| `onAccent2` | `#04202e` | the accent2 chip |
| `onGold` | `#1a1200` | the warn/gold chip |

And the **analytics categorical ramp**, re-keyed for Stadium Night because the graphite-era
steps were mixed for a `#18181b` plate and go muddy on the deeper `#111925` one. Same hue
order — **identity, not value-rank, drives the colour per the categorical rule** — lifted in
lightness and chroma so eight fills stay separable on the darker card, in **fixed order, never
cycled or reassigned per chart**:

`viz1 #5fa8f5` · `viz2 #f0793f` · `viz3 #37c48f` · `viz4 #e3a92b` · `viz5 #f078a4` ·
`viz6 #39b859` · `viz7 #a89cff` · `viz8 #ff8f8f` · `viz9 #b48ce0` (the ninth step exists for
the one categorical scale that needs nine — the cap page's nine position groups, which used
to reach past the palette for a raw hex) · `vizGood #5fa8f5` · `vizBad #ff8f8f`.

**Why the ramp is blue-black and not neutral.** The graphite it replaced read as "dark SaaS";
every step now carries a blue cast, because a stadium at night is lit blue-white and
photographs blue-black, not grey. The ramp is also deliberately **deeper** — ink is
near-black, so the field grid and the club rail have somewhere to sit — which buys contrast
headroom on every light-on-dark pair. `muted` on `card` measures **8.35:1** here against
**5.52:1** before, and that headroom is exactly what pays for the denser type scale: the type
got smaller and every pair on the page got *more* legible, not less.

`line` is markedly lighter than the graphite `#2d2d32` it replaced, because Stadium Night is a
**flat** skin — the shadows that used to separate one plate from the next are gone — so the
border does that work alone and has to be visible at 1px.

### 7.2 `--team-accent`, the club rail, and `.text-team`

```css
:root { --team-accent: #38bdf8; }                                   /* house blue fallback */
--rail: color-mix(in srgb, var(--team-accent) 62%, #7fe9e0 38%);
.text-team { color: color-mix(in srgb, var(--team-accent) 45%, theme('colors.chalk') 55%); }
```

A page or section sets `--team-accent` via an inline style once it knows which club it is
showing (`style={{ '--team-accent': hex }}`), and everything downstream reads
`var(--team-accent)` instead of hardcoding a colour — so recolouring one wrapper recolours
every accent use inside it.

**Team-coloured TEXT does not get its own custom property, and this is the single most
important mechanical note in the system.** A `var()` inside a custom property is substituted
at computed-value time **on the element where that property is declared** — so a `--team-text`
declared on `:root` bakes in `:root`'s own `--team-accent` (the house blue) and inherits that
*fixed* colour down, ignoring every per-team `--team-accent` set further in. `.text-team` does
the `color-mix` in a **real property**, which resolves against the nearest `--team-accent` at
use time. `--team-accent` itself is still the right token for fills, borders and watermarks.

**The lightening is not cosmetic.** Several curated club primaries (oxblood `#5c0f1a`,
midnight `#1e1e2e`, forest `#1e5f3a`) sit around **1.6:1** against the near-black background
and are unreadable as small text raw. The mix was 50% club into pure **white**, measured
against the graphite palette, where 60/40 left six of the twenty primaries short of 4.5:1 —
bottoming out at **4.04:1** on midnight over `raised`. Stadium Night changes both halves: the
light end is `chalk`, not raw white, because a club colour mixed into `#ffffff` on this page is
brighter than the headings around it and reads as a highlight rather than as a name; and the
three surfaces underneath all got darker. Re-measured across the same twenty primaries on the
same surfaces, **45/55 into chalk puts the worst case at 5.31:1** — better than the old 50/50
managed — so the club keeps **more** of its own colour than before and every team still clears
the floor. That is why it is 45 and not 50.

**The club rail** is Stadium Night's one structural device: a 3px bar of the club's own colour
down the left edge of every plate, a band across the masthead, a rule under the nav, the
underline on the live tab, the rule under a table head, and the mark on a hovered row. It is
**not the raw primary** — several curated primaries sit near 1.6:1 on this page and a 3px bar
of them reads as a smudge rather than as a colour — so it is lifted 62/38 toward a cold
stadium-light teal, which makes every club legible as structure while still being
unmistakably that club's.

### 7.3 Typefaces

Three faces, all through `next/font` so each is **self-hosted, preloaded and size-adjusted
against its fallback** — a raw `@import` would cost a render-blocking round trip to a third
party and a visible reflow on every navigation.

| Variable | Face | Weights | Used for |
|---|---|---|---|
| `--font-display` | **Oswald** | 500, 600, 700 | headings, nav, buttons, pills, every stat number |
| `--font-sans` | **IBM Plex Sans** | 400–700 | body copy, tables |
| `--font-mono` | **IBM Plex Mono** | 400–700 | money, ratings, every aligned figure |

Wired on `<html className={...}>` and read through `theme('fontFamily.*')`, with the full
system fallback kept on every family so a blocked font request degrades rather than breaks.

- **Oswald** replaces Barlow Condensed: narrower and flatter-shouldered, which is what makes
  an uppercase nav item and a stat number read as stadium signage rather than as a webfont. It
  tops out at **700**, and `.stat-value` sets 700 rather than 800 deliberately: Oswald is
  condensed enough that its heaviest weight closes the counters of 6, 8 and 9 at fact-tile
  sizes, and a cap figure that cannot be read is worse than one a shade lighter. Its tracking
  goes from negative to **slightly positive** (`0.005em`) for the same reason — Barlow needed
  pulling in; pulling Oswald in further ran the digits of a nine-figure cap number into each
  other. Headings take `letter-spacing: 0.02em` because a condensed face needs *more* tracking
  than Barlow did to stop a long uppercase heading closing into a block.
- **IBM Plex Sans** replaces the system sans stack, which was a different typeface on every
  platform — the one thing a 13px table of twenty columns cannot afford. Plex is a grotesque
  drawn for dense technical reading: open apertures, unambiguous 1/l/I.
- **IBM Plex Mono** shares that skeleton, so a cap number in mono beside a label in sans reads
  as one voice rather than two.

**Body:** `bg-ink text-chalk antialiased`, **13px / 1.4**. 13px against the 14px before is the
single change that buys the most — a roster row, a cap table and a fact strip all get shorter
at once. It is only affordable because the palette moved with it in the same pass. Line-height
comes down with it because Plex's x-height is large enough to carry the tighter setting.

### 7.4 Scales

**Radius.** A hard-edged skin: 2px everywhere a plate meets the page, so the club rail and the
notched corner have a square enough corner to sit against. `full` is untouched — pills, crests
and the slider thumb are still circles.

| Step | Value |
|---|---|
| `md` | 2px |
| `lg` | 2px |
| `xl` | 3px |
| `2xl` | 4px |

**Shadow.** Flat plates. The old card shadow was a 16px drop that made every panel hover above
the page; on a near-black page a 16px blur under every card read as fog, and fog over a yard
grid reads as a rendering fault.

| Step | Value | Use |
|---|---|---|
| `card` | `0 1px 0 0 rgba(255,255,255,0.05) inset` | the only remaining shadow — a 1px top highlight reading as a bevel under stadium light |
| `elevated` | `0 18px 44px -22px #000, 0 1px 0 0 rgba(255,255,255,0.08) inset` | **genuinely elevated surfaces only** — open menus and popovers, the masthead, the on-the-clock draft state. Not every panel; reach for `card` first. Kept deep and much darker than the plate, because on a near-black page a soft grey shadow is invisible |

**Container.** `maxWidth['7xl'] = 90rem`, wider than Tailwind's 80rem default. Stadium Night is
dense — smaller type, tighter rows — and at 80rem the roster and cap boards had gone from full
to half-empty. 90rem is what keeps a 20-column board reading as a board on a 1440 screen.

**Body type.** `xs 11.5px/1.35` · `sm 12.5px/1.4` · `base 13.5px/1.4`.

**The stat-number scale.** Big sports numbers get sizes distinct from the body scale, always
paired with `.stat-value`. Every step is **larger** than the graphite scale even though the body
type shrank: that widening gap is the skin's whole hierarchy, and Oswald is narrow enough to
spend it.

| Step | Size | Line height |
|---|---|---|
| `3xl` | `clamp(1.6rem, 5.4vw, 2.35rem)` | 0.95 |
| `stat-sm` | `clamp(1.2rem, 4.4vw, 1.5rem)` | 0.95 |
| `stat-md` | `clamp(1.5rem, 5.6vw, 2.15rem)` | 0.92 |
| `stat-lg` | `2.75rem` | 0.9 |
| `stat-xl` | `clamp(2.9rem, 11vw, 4.6rem)` | 0.85 |

**Every step above `sm` is a clamp, and that is a fix rather than a flourish.** These sizes land
in fact tiles and metric tiles that sit two abreast at 390px — a track about 180px wide — and a
figure set at a fixed `2.15rem` does not fit one. It cannot wrap either, so it pushed the whole
document sideways instead: the cap page's four metric tiles were measurably the largest
remaining source of horizontal scroll on a handset. The floors are the sizes that fit that
track; the ceilings are the sizes the skin wants, and every viewport past ~615px gets them.

### 7.5 The body texture — the yard grid

```css
body::before {
  content: ''; position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background:
    repeating-linear-gradient(90deg, rgba(255,255,255,0.026) 0 1px, transparent 1px 120px),
    repeating-linear-gradient(0deg,  rgba(255,255,255,0.016) 0 1px, transparent 1px 120px),
    radial-gradient(ellipse 90% 45% at 50% -8%,
      color-mix(in srgb, var(--rail) 16%, transparent), transparent 70%);
}
body > div.min-h-screen { position: relative; z-index: 1; }
```

**Why a fixed pseudo-element and not a background-image on `body`.** It was
`background-attachment: fixed` on `body`, which paints the texture into the body box — so the
grid stopped at the end of the content and a short page showed bare ink below the fold. As a
`position: fixed` layer it covers the viewport whatever the document height, and it costs the
compositor one layer instead of re-rasterising a fixed background on every scroll frame.

**Both axes, not just horizontals:** a field has yard lines *and* hash marks, and the
cross-hatch is what stops a 90rem-wide dark page reading as a void. The wash at the top is the
stadium light itself, and it is tinted with the **club rail** rather than plain white — the one
place the club's colour reaches the whole page. `inset: 0` with `pointer-events: none` and
`z-index: 0`, so it cannot take a click and cannot enter layout; the app shell is raised above
it by the `.min-h-screen` rule, without which the fixed layer paints over the page instead of
under it.

`::selection` is `color-mix(in srgb, var(--c-accent) 25%, transparent)`.

### 7.6 The component classes

**`.card` — a flat plate.** `bg-card border border-line rounded-lg shadow-card`. Separation is
a border and a colour step, never a drop shadow. Unlike `.panel`, **`.card` carries no club
rail**: the rail marks a *section of the front office*, and `.card` marks *one object inside
it* — a player, a trade offer, a matchup. `.card-pad` is `p-5`.

**`.panel` — the plate with the club rail.** The app's section container: a table, a chart, a
block of controls. `bg-card border border-line rounded-md`, `position: relative` (load-bearing
for all three decorations), `box-shadow: none`. **Opaque now rather than `bg-card/60`: the yard
grid behind the page shows through a 60% plate as a moiré over every table.** Three decorations,
every one an absolutely-positioned pseudo-element so **none of them can enter layout, take a
click, or change what is on the page**:

| Part | What |
|---|---|
| `::before` | the 3px club rail down the left edge, `opacity: .85`, `z-index: 3` |
| `::after` | a notched top-right corner — **painted, not clipped**: a `clip-path` corner would also cut any tooltip opening near it, and these panels are full of them, so it is a 13px triangle in the page's own `ink` laid over the corner instead. `z-index: 4` |
| `> header` | a panel's own header row becomes a lit band — a `raised` gradient with the club rail bleeding out of its left edge. **Matched structurally** (`> div:first-child[class*="border-b"]`) — the first child that draws a bottom border *is* the header — rather than asking every panel in the app to adopt a class it does not need |

Usage discipline, from `globals.css` itself: section-based layout (heading + divider) is the
default; reach for `.card` only when the content represents a genuinely distinct object.
Measured across the tree: `.panel` **122×**, `.section` **86×**, `.card` **10×**.

**`.stat-tile`.** `bg-raised border border-line rounded-md`, padding `0.3rem 0.6rem`. The
densest thing in the header strip — five or six abreast — so it sheds most of its padding while
the figure inside got *bigger* in the same pass. Shrinking the box and growing the number is
what makes a tile read as a scoreboard cell rather than a form field.

**`.btn` and variants.** `inline-flex items-center justify-center gap-1.5 rounded-md text-sm
font-display font-semibold uppercase`, padding `0.36rem 0.8rem`, `letter-spacing: 0.06em`,
`disabled:opacity-40 disabled:pointer-events-none`. **Buttons speak in the display face**:
uppercase Oswald with real tracking is the difference between a control that looks like stadium
signage and one that looks like a link with a background — and the tighter box is what lets a
button sit inside a 12px table row without setting the row height.

| Variant | Definition |
|---|---|
| `.btn-primary` | `bg-accent text-ink hover:bg-accent/90` |
| `.btn-secondary` | `bg-raised text-chalk border border-line hover:bg-line` |
| `.btn-danger` | `bg-bad/15 text-bad border border-bad/30 hover:bg-bad/25` |
| `.btn-ghost` | `text-muted hover:text-chalk hover:bg-raised` |
| `.btn-tertiary` | `text-accent2 hover:underline px-1.5` |
| `.btn-icon` | `w-8 h-8 p-0 text-muted hover:text-chalk hover:bg-raised` |

**Physicality on press:** `.btn:active:not(:disabled) { transform: translateY(1px) }`. Nothing
in this application depressed when it was clicked — `.btn` was `transition-colors` and nothing
else, so every control felt like a link rather than a button. One pixel, 140ms, sub-perceptual,
and it is the whole difference. The transition property list is written out **in full** rather
than replaced, so no button loses a transition it had: an icon button's fill still eases exactly
as before.

**`.pill`.** `inline-flex items-center text-xs font-bold border`, radius 2px, padding
`0.02rem 0.42rem`, `letter-spacing: 0.04em`. **Square, not round**, and tight enough to sit
inline in a table cell: a pill-shaped chip is a SaaS tag; a hard-cornered one with heavy
tracking is a jersey patch, which is what these actually label.

**`.input`.** `bg-raised border border-line rounded-md px-3 py-2 text-sm text-chalk
placeholder:text-muted focus:ring-1 focus:ring-accent2/60 focus:border-accent2/60`. The
placeholder sits at **full `muted`, not `muted/60`**: on this control's own surface
`muted/60` composites to **2.81:1**, and a placeholder is text — often the only statement of
what a field wants — so that is below the floor. Full `muted` measures **5.33:1** there and is
still plainly dimmer than the value the user types, which is `text-chalk` at **14.5:1**.

**`.label-sm`.** `uppercase text-muted font-display font-semibold`, **10px**,
`letter-spacing: 0.18em`. Every small-caps label in the app. On the display face at 10px with
wide tracking it reads as a broadcast strap rather than shrunken body copy, and Oswald's narrow
set means it fits the same tracking in less width than the body face could. Colour is **full
`muted`**, which on this palette is a long way clear of the floor on every surface it lands on.

**`.nav-link`.** `relative text-sm font-display font-semibold uppercase text-muted
hover:text-chalk`, padding `0.5rem 0.7rem`, `letter-spacing: 0.11em`. A **broadcast lower-third
tab**, not a rounded pill. `::after` is the bar: 3px, no radius, **inset to the item's own
padding** (`left/right: 0.7rem`) so it measures the word, not the gap. `:hover::after` is
`bg-line`. `.nav-link-active` adds `text-chalk`, a `linear-gradient(180deg, transparent,
color-mix(in srgb, var(--rail) 22%, transparent))` wash, and an `::after` painted in
`var(--rail)` — **the live tab is marked in the CLUB's colour, not the house green**, because
the rail is the same device that runs down every panel and the point of it is that the whole
front office is that club's.

**`.section`, `.section-head`, `.section-title`, `.section-eyebrow`, `.divider`.**
`.section` is `space-y-3`; `.section-head` is `flex items-center justify-between gap-3 pb-2
border-b border-line/70`; `.section-title` is `font-display font-bold uppercase text-chalk`,
**14px**, `letter-spacing: 0.09em`; `.section-eyebrow` is `.label-sm` at `letter-spacing:
0.2em` — **wider than `.label-sm`'s own tracking**, because an eyebrow sits directly above a
title in the same face and opening it further is what keeps the two from reading as one block
of caps. `.divider` is `border-t border-line/60`.

**`.stat-value`.** `font-family: var(--font-display)`, `font-weight: 700`,
`font-variant-numeric: tabular-nums`, `letter-spacing: 0.005em`, `line-height: 0.95`. Big
sports numbers — OVR, records, cap space. Always the display face, bold, tabular so digits
don't jiggle across a row. Pair with the `stat-*` scale or an explicit size.

**`.table-clean` — THE BOARD.** The densest surface in the app and the one that changed most: a
roster, a cap sheet and a draft board are all twenty-odd columns of figures, and the graphite
skin set them as a *list* — one padding, one rule, no vertical structure. Four things make it
read as a board instead:

1. **A banded header** on `raised` with a 2px club rail under it, so the head is a strap rather
   than a row that happens to be bold.
2. **Zebra striping at 4.2% white** — enough to track a row across twenty columns, far too
   little to read as a colour.
3. **Column rules between cells.** *This is the one that does the work*: a grid of figures with
   no verticals is a wall of numbers.
4. **The hovered row is marked in the club colour** and gains a 3px rail on its first cell, the
   same device as the panel edge.

```
.table-clean  w-full border-separate border-spacing-0 text-left; 12px; tabular-nums
.table-clean th   .label-sm, sticky top-0, text-chalk, bg-raised, border-b-2 in var(--rail),
                  padding .34rem .6rem, 9.5px, tracking .1em, nowrap
.table-clean td   padding .28rem .6rem, border-bottom 1px of line@55%
```

Two specificity notes recorded in the file because both shipped as live bugs:
- **`text-left` lives on the table, not on `th`.** `.table-clean th` is specificity (0,1,1), so a
  plain `text-right` utility on a header — (0,1,0) — silently lost to it, and **every numeric
  column in the app was rendering a left-aligned header over right-aligned figures.** Inherited
  from the table, any explicit alignment on a cell wins.
- **Tabular figures on the table, not on the cells that happen to remember.** Every one of these
  tables stacks digits in a column; the ones carrying money or a rating already opted in
  individually, the plain cells did not — so `Age` rendered proportional on the roster, cap,
  draft and free-agency boards while the OVR column right beside it rendered tabular. The same
  role, two treatments, on four of the busiest pages. Digits only, so no label or name shifts.

Row height is set by the **row portrait**, not the padding — a crest holds a row open however
tight the cells are — so the dense skin scales it (`td a > svg` → 22px) rather than pretending
padding alone did the work. `.table-clean .btn` gets `nowrap` and tighter padding.

**Other utilities.** `.watermark-logo` (`absolute pointer-events-none opacity-[0.07] -z-0`;
the wrapper controls clipping). `.rating-chip` / `.rating-chip-flag` (the proprietary rating
shape — a notched top corner echoing the shield/hexagon crest language, with the notch filled
by a separate tier-coloured flag). `.scoreboard-digits` (Draft Day's clock: each MM/SS pair in
its own dark well so it reads like a stadium game clock, not a plain number in text).
`.scroll-shadow-y` (a pure-CSS, no-listener scroll affordance: two `local` opaque covers that
scroll *with* the content plus two `scroll` radial shadows pinned to the container, auto-hiding
top and bottom independently; `--scroll-bg` tracks `theme('colors.card')` because a stale
literal here is a seam that survives a whole re-skin). `.slider` (the negotiator's range input,
drawn explicitly for WebKit and Gecko, with a deliberately large thumb because this is a
control the user drags repeatedly while watching a meter). `.ticker-track`.

**The feedback layer.** These answer one gap: the app told you what a number **is** and never
what it **changed by**. A cut takes cap space from $21.1M to $22.1M and the screen had never
once said `+$1.04M`.

| Class | What |
|---|---|
| `.delta-chip` + `.delta-chip-in` | **sits beside a value, never replaces it**, and states the change in the user's own units. Rounded, bold, tabular, `pointer-events: none`, rises 4px over `--dur-state` |
| `.delta-up` / `.delta-down` / `.delta-info` | accent / bad / accent2 |
| `.delta-tint` + `-up` / `-down` | **the tint channel — the half that still fires under reduced motion**, which is why polarity is never carried by the rise alone |
| `.spinner-ring` | in-flight ring for the three-state action button, in `currentColor` so it works on primary, secondary and danger without a variant each. **It runs only while a request is actually open** — it is not ambient motion — and it stops dead under reduced motion, where the verb label carries it |
| `.range-sweep` | the scouting reveal: the band's edges sweep to the new low/high. **The numeric label is already the new range at frame one** — this animates the transition *to* the answer, never the arrival *of* it. Opt-in, because the same component draws rows on list surfaces that must stay dead still |
| `.pip-well` / `.pip-fill` / `.pip-spent` | a patience pip that **drains** rather than just greying. Dragging a slider is free; submitting an offer is not, and the cost should be felt |
| `.rank-pip` | a purchased upgrade locking in — the pip *fills* rather than simply being filled on the next render |
| `.commit-flash` | a one-shot confirmation on a surface that just changed. **Colour only — nothing moves**, so it is identical under reduced motion (where it is switched off entirely anyway, because the delta chip beside it already carries the fact). Painted as an inset shadow rather than a `background-color` so it can overlay any surface without briefly erasing that surface's own background |

**The micro-interaction layer.** The skin is flat and dense, which takes away the two things
that used to tell a reader a surface was live — the drop shadow and the hover glow. Two rules
put that back as movement: a `.table-clean tbody tr:hover` lifts **1px**, and an
`a.stat-tile:hover` does the same. Both sit on **shared component classes, so no page had to be
edited to get them**, and both animate **`transform` only** — never a width, a height or an
offset — so neither can reflow a neighbour or move a figure. Durations come from the same four
tokens, so all of it collapses to 1ms under reduced motion without a rule of its own, and none
of it gates a click: these are hover and press states, so the pointer is already where the user
put it.

---

## 8. THE RULES THAT ARE NOT NEGOTIABLE

### 8.1 The motion rules, verbatim from `app/globals.css`

> 1. Animation never gates input. Buttons re-enable when the server answers, not when an
>    animation ends.
> 2. Animation never delays information. Final values render at frame one; only decoration
>    moves. **There are no count-ups anywhere.**
> 3. Reduced motion loses the movement, never the information. Every effect has a
>    colour/opacity channel that fires regardless.

And, from the token block:

> These describe DECORATION only. No number in this app is ever gated behind one: final values
> are in the DOM at frame one and every button accepts the next click the instant the server
> responds.

**Rule 2 was enforced retroactively.** `ConfidenceFigure` animated a scouting-confidence number
upward from zero, and it was defended as a receipt for a purchase. It broke *"final values
render at frame one"* and *"there are no count-ups anywhere"*, and the cost fell exactly where
it hurt most: **the one number on the page the reader was looking at was the one the screen
would not yet say.** It was removed as a rule violation corrected, not a feature removed — the
digits are the answer immediately and the reveal moved off them onto the decoration around
them. The DOM shape, the accessible name and the rendered characters are all exactly what they
were.

### 8.2 The four motion tokens

```css
:root {
  --dur-tick:   140ms;   /* press, hover, pip */
  --dur-state:  220ms;   /* a value or bar changing */
  --dur-reveal: 450ms;   /* the two or three earned moments */
  --ease-out:   cubic-bezier(.2,.7,.3,1);
}
@media (prefers-reduced-motion: reduce) {
  :root { --dur-tick: 1ms; --dur-state: 1ms; --dur-reveal: 1ms; --ease-out: linear; }
}
```

**Four numbers, and every timed effect in the app reads them.** Honouring
`prefers-reduced-motion` is therefore **one override rather than a rule per animation.**
`--dur-state` and `--dur-reveal` sit inside the 200–500ms interface band; `--dur-tick` is under
the 100ms direct-manipulation threshold.

The two animations that cannot collapse through a token — the spinner ring and
`.commit-flash` — each carry their own `prefers-reduced-motion` block: the ring stops and holds
a static two-tone border, the flash is switched off entirely.

Verification standard: **`prefers-reduced-motion` emulated across all ten pages, with element
count, rendered text and interactive-control count identical to the normal-motion run on every
one.** The movement is lost and no information is.

### 8.3 Legibility

**Every piece of text must clear 4.5:1 against the surface it *actually* sits on — computed
through every alpha layer and every ancestor `opacity`, not against its nominal token.**

This is the rule because every failure found was a *composite* failure, not a token failure.
Four worked examples, all of which shipped:

- A `text-muted` caption at 60% opacity measured **2.99:1** — the last rendered text in the
  application under the floor, on a page that had already been through a legibility pass. There
  was no reason for the fade: it is the same colour and the same role as the captions beside
  it, and the words already said the thing the dimming was there to say.
- The standings' "somebody else's club" rows dimmed to 70%, which put a losing streak in `bad`
  at **4.23:1**. They dim to 80% now — **5.15:1**, and the row is still visibly quieter.
- An `.input` placeholder at `muted/60` composited to **2.81:1** on `bg-raised`.
- `.text-team` at 60/40 into white left six of twenty club primaries short, bottoming out at
  **4.04:1**.

In every one of those, the *token* was fine. On `card`: chalk 15.8:1, accent 10.2:1, warn
10.6:1, accent2 8.3:1, gold 9.2:1, bad 6.4:1, muted 5.8:1 — every base token clears AA and
most clear AAA. **A sweep that checks tokens finds nothing.**

So: **the sweep must be automatic, and it must compute the background actually composited
behind each element** — walking up through every ancestor's `background-color`, every alpha,
and every `opacity` — at **1440 and 390**, across every route.

**And the sweep must itself be validated by deliberately breaking a token and confirming it
reports failures.** A contrast checker that silently passes everything is indistinguishable
from a contrast checker that works, and it is the more likely of the two. Break one colour,
watch the sweep go red, put it back.

The standard to ship against, measured after the Stadium Night pass: **zero rendered text below
4.5:1 across ten pages at both widths, worst pair 5.15:1.**

### 8.4 Mobile

**Everything works at 390px. No horizontal page scroll. 40px+ hit targets.**

Four mechanical causes of sideways scroll were found and each is fixed **where it starts**,
never masked at the root:

1. **`grid lg:grid-cols-2` with no `grid-cols-1` base.** Tailwind's `grid-cols-N` is
   `repeat(N, minmax(0, 1fr))`, and below the breakpoint that leaves **one implicit column** —
   and an implicit track is sized to its content's `min-width: auto`, its max-content. Eleven
   call sites had this. The player card's depth chart held such a track open at **607px inside
   a 390px viewport.**
2. **Fixed-width popovers.** The help bubble is a fixed 18rem — 288px inside 390px — and it
   opens from wherever its trigger happens to sit. It was the largest single source of
   horizontal scroll in the app. Clamped to the viewport at every size and pinned inside it
   below 520px, matched on `[role='tooltip']` so both popovers and any future one are covered
   without either having to know the rule exists. Hiding the bubbles was measured as taking the
   dashboard from 410px of document width to exactly 390.
3. **Fixed-rem stat sizes in tiles that sit two abreast at 390px** — now clamps with floors
   that fit that ~180px track.
4. **A centred bubble on the last pill of the widest row**, which pushed the league home page
   85px sideways *at 1440*. Anchored to its own right edge at the call site.

The handset popover pin, and the one line in it that is the whole repair:

```css
[role='tooltip'] { max-width: calc(100vw - 1.5rem); }
@media (max-width: 520px) {
  [role='tooltip'] {
    position: fixed !important;          /* ← the repair */
    left: .75rem !important; right: .75rem !important;
    top: auto !important; bottom: 1rem !important;
    width: auto !important; max-width: none !important;
    transform: none !important; margin: 0 !important;
  }
}
```

**`!important` on the position, and that is the whole repair.** This rule lives in
`@layer components`; `absolute` on the bubble is a Tailwind **utility**, and the utilities layer
is emitted after this one. So `position: fixed` lost, every other line won, and **the result was
worse than doing nothing**: `left: 12px` and `right: 12px` resolved against the 14px trigger
instead of the screen, `width: auto` then shrank to fit what was left, and every help bubble in
the game rendered on a handset as a **22px sliver of wrapped text**. Measured on the live DOM at
390px, where the computed position read `absolute`.

The vertical pin exists for the same reason. Placement comes from `bottom-full` / `top-full` —
100% of the *containing block*, which is the trigger while the bubble is absolute and the whole
viewport once it is fixed. Left alone, the corrected `position: fixed` would have put every
bubble exactly one screen above, or one screen below, the screen. Pinned to the foot of the
viewport it is a **sheet**: full width, no word lost, never clipped by an ancestor, and — because
a fixed box is out of flow against the viewport — it can no longer push the document sideways.

Hit targets: the advance control's stop button carries `min-h-[40px]` explicitly. Measured
result after the pass: zero horizontal scroll at 1440 on nine of ten pages, and at 390 the four
worst offenders — roster, both player-card views and free agency — go to zero; what remains is
2–34px on five pages, every one better than before. **The target is zero; the brief records the
measured state honestly rather than claiming it.**

### 8.5 Copy

**Useful and informative but never immersion-breaking — a front-office voice, not a tutorial
one. No "click here". No exclamation marks.**

Concretely, as enforced across the app:
- **A screen never explains its own implementation.** The analytics subtitle said *"Everything
  below is read-only arithmetic over what this save already produced — no projection the sim
  does not make… Nothing on this screen feeds the simulation back"*: an engineer reassuring
  another engineer, on the screen a player opens to feel like a front office. It now says what
  the room is for. The six-paragraph "What the department cannot tell you, and why" became three
  sentences of **"What we don't measure"** — *a real analytics department says "we don't track
  that" and moves on; it does not apologise for its schema.*
- **Honesty is kept, because the alternative is a screen that quietly omits what it cannot
  compute.** It is just said the way a person would say it.
- **No instruction and no verb aimed at the reader.** The GM-card line describes the artefact
  (*"N seasons on one card, sized for a screenshot."*) and what he does with it is his.
- **The words are the owner's where he supplied them.** "Already expired", in red, about men
  still on the roster became **"Expiring This Offseason"** after he said *"the term 'expired' on
  re-sign makes it feel like the contract is lost"* — twice is the words being wrong, not the
  reader.
- **A sentence that names a consequence must name the price.** The cap panel's four branches each
  end on what it costs, because *"the week advances anyway"* was true and was read, correctly, as
  *"and nothing happens"*.
- **A control's label says what it does at every stage.** `Stop after this week` →
  `Stopping — finishing this week…`.
- **An empty state states a fact about the league, not a failure.** Which of the three sentences
  you get *is* the information.

### 8.6 Decluttered

**Length is not clutter; duplication is. The same figure must not appear twice on one screen.**

What gets cut: **a second reading of a fact already on the screen**, **a panel that reports
nothing**, and **anything with no job on the page it is on**. The worked example is the
draft-complete pass: it cut a selection feed that was a *third* rendering of the same 224 picks,
a "Best Available" panel that was the first eight rows of the table directly beneath it
re-laid-out, a war-room ledger reading all zeros by definition once the board was empty, and a
private-workout line offering a budget nobody could spend. **4,971px to 2,771px, and nothing a
GM would go looking for was lost.**

What does **not** get cut is depth. The owner, on the GM career page: *"I would rather have a lot
of really cool data on GM career across 2 or 3 tabs rather than minimal on one tab to save
room."* A long panel with one job, a clear hierarchy and room to breathe is good; a short one
where four things fight is not.

The rule's live consequences, each of which is a real edit:
- The "Best Season" panel became **a clause on the Season Log's header plus a lit row** — all
  three of its figures were already in the row below it, verbatim.
- GM Career's draft and trade **tiles moved to the tops of the tabs that carry their evidence**,
  because each was a headline with its evidence three screens away.
- The Rebuild blurb prints **once** at full weight on the leaderboard, not again under the tabs.
- Scouting's "Board Leader" tile became **"We Disagree"** — the old one was row one of the table
  200px below, rendered a second time.
- The draft board's athletic tooltip was deleted: it explained a denominator the cell already
  printed.
- The player mockup lost a duplicated OVR/Potential panel — the hero already shows it.
- There is no "Drafted" tile on the Moves tab: the Draft tab counts the same picks off the pick
  table, and **two counters for one number is how they come to disagree.**
- A category nobody has produced in yet is **omitted, not shown as a zero**: an empty leader
  board reads as broken, a shorter one does not.
- An `—` tile is a tile saying nothing: Scouting drops **three of five** facts before the class
  lands rather than printing placeholders.

---

## 9. THE DESIGN HISTORY, BRIEFLY

**Nine rounds of design exploration were explored and rejected before one was accepted.** The
accepted skin — "Stadium Night" — was picked out of those nine and confirmed twice.

The pattern across the rejected rounds is the lesson, and it is worth one paragraph because it
will save the next team a month: **every rejected round changed layout, structure or workflow,
and the verdict each time was that functionality and playability got worse.** The rounds that
proposed collapsing the dashboard's panels, compressing the mastheads, restructuring the nav,
removing the portraits, reordering the draft page — all of them were defensible as *design* and
all of them cost something a GM used.

What was finally accepted was a **re-skin**: same bones, new look. The commits are explicit
about the contract, and this is the thing to carry forward:

- *"No page was touched and no markup moved; three files gain one class name each."*
- *"Every decoration below is an absolutely-positioned pseudo-element so none of it can enter
  layout, take a click, or change what is on the page."*
- Where a figure was re-measured rather than carried over (`.text-team`, the `line` step, the
  `muted`/`chalk` ends), it was re-measured **so the same element could keep doing the same job
  more legibly** — never so it could do a different one.
- The motion layer shipped **with** the skin rather than as a static repaint, because
  `moments.css` and eight animated components carried the old palette as raw literals and would
  otherwise have flashed a draft pick in the previous app's green over the new plates.
- The verification was a *diff of behaviour, not of pixels*: element count, rendered text and
  interactive-control count identical to the pre-change run on every page.

So the guarantee the accepted round made, and the one a reimplementation should hold itself to:
**no element changed order, presence, wording or count.** Only colour, type, radius, shadow,
density and texture changed.

**Treat layout as expensive and skin as cheap.** A palette, a typeface, a radius scale and a set
of pseudo-element decorations can be swapped in a few commits and verified mechanically. Moving
a panel, merging two tiles, or re-ordering a page cannot be verified mechanically at all — it has
to be played — and nine rounds of this project's history say that is where the losses are.

---

## 10. VERIFICATION CHECKLIST FOR THIS PART

A reimplementation is 1:1 on this part when all of the following hold.

**Routes.** All 39 routes exist at the exact URL patterns in §1. Every query parameter accepts
the listed values and falls back as listed on anything else. `/league/[id]/draft/broadcast`
redirects. `/league/[id]/design/negotiate/[direction]` 404s on an unknown direction.
`/league/[id]/rebuild` 404s unless the run was won. A save you do not own 404s. A `teamId`,
`gameId` or `playerId` from another league 404s. `/game/[gameId]` 404s on an unplayed game.

**Panels and facts.** Every masthead carries the same eyebrow/title/subtitle logic and the same
fact tiles in the same order, with the same colour rules, the same `tip()` keys and the same
`href`s — and **no tile links to the page it is on**.

**Empty states.** Every state listed in §2–§5 renders its own sentence. In particular: a
brand-new league shows a pitch and not a bare save list; a drawn-but-unplayed schedule never
says "season complete"; an undrawn schedule says so in all four tiles *and* the body; free
agency with nobody on the wire gives one of three reasons; the scouting department with no class
in drops three of five facts and replaces the body; the power rankings say which of three
movement states is true; the leaderboard's Rebuild board says "none has finished", not "nobody
has played one".

**Cross-cutting.** The nav has the eight categories with the listed items, the hover/focus
sub-row preview, and exactly three badges. The advance control builds its menu from the live
phase, shows a progress popover with a stop for multi-week runs only, halts at a week boundary,
and reports the week it actually landed on. The ticker returns nothing on an empty list and is
never padded. The lineup-gap banner is dismissible, scoped by signature, and absent in the
building phases. Tooltips reset their typography, are 18rem, open downward inside scrollers, and
pin to the viewport foot below 520px.

**Design system.** Every token in §7 matches to the hex. `.text-team` is 45/55 into `chalk`.
`--rail` is 62/38. Every `.panel` decoration is a pseudo-element. The table has all four board
devices. Radius is 2px, the only plate shadow is a 1px inset highlight, the container is 90rem,
body is 13px/1.4, and every stat step above `sm` is a clamp.

**The non-negotiables.** The four motion tokens exist and collapse to 1ms/linear under
`prefers-reduced-motion`. **There is not one count-up anywhere.** An automatic contrast sweep
computes through every alpha and ancestor opacity at 1440 and 390 and reports zero text below
4.5:1 — and the sweep has been validated by breaking a token. Zero horizontal page scroll at
390px. No "click here" and no exclamation marks in product copy. No figure appears twice on one
screen.
