# Moments and Motion — proposals

Nine proposals, ranked. Read `findings.md` first; the numbered findings (§1.1,
§2.10, …) referenced below live there.

**Ranking criterion.** Emotional return per unit of risk, where risk means both
build cost and the chance the thing becomes noise. I have been honest about
which ones are weaker — proposals 7-9 are real but I would not build them first,
and I say why.

**Constraints every proposal below respects, without restating them each time:**
nothing is removed; no avatars, logos, colour or row heights are cut; all
graphics are CSS/inline SVG built from data; anything random uses `Rng` from
`lib/rng.ts` seeded from stable ids (the pattern `lib/storyline.ts` already
uses); no external assets.

---

## Ranked summary

| # | Proposal | Screen | New schema? | Work | Risk of noise |
|---|---|---|---|---|---|
| 1 | **The Week Report** | post-Advance, anywhere | No | L | Medium — mitigated by Tier-1 rules |
| 2 | **Game Shape** (drive path + archetype) | Game page, + sparkline elsewhere | No | M | Very low |
| 3 | **Result weight** (margin drives type) | Schedule, Wire, Standings, Dashboard | No | S | Very low |
| 4 | **The Trophy Moment** | Full-screen, once per season | No | M | Very low (by budget) |
| 5 | **Season Arc** (rank/odds over time) | Standings | No | M | Low |
| 6 | **Live records + one Game Ball a week** | In-sim + Week Report + player page | No | M–L | Medium |
| 7 | **News as a weekly edition** | `/news` | No | S–M | Low |
| 8 | **Circle It** (rivalry stakes pre-game) | Schedule, Dashboard hero | No | S | Medium |
| 9 | **Franchise Timeline** | History / GM Career | No | M | Low |

Six of nine need no schema change and no sim-engine change.

---

## 1. The Week Report — replace the 7-second toast with the moment

**Rank 1. This is the proposal. If only one thing is built, build this.**

### What it is

Pressing **Advance ▸** currently produces `"Week 8 complete: 16 games played."` in
a 320px card that vanishes after seven seconds (§1.1). It does not contain your
score. Replace it with a full-width report panel that renders *what the week did
to you*, in five bands:

1. **Your result, at broadcast scale.** Both logos, both scores as `stat-xl`
   figures, the winner's score in `--team-accent`, the margin stated as a phrase
   ("by 1", "by 28"), the venue (`vs`/`@`), and one sentence pulled straight out
   of the existing `Game.recap` — the recap engine already picks its frame from
   the margin (`lib/sim/recap.ts`), so the sentence is already correct, it is
   just never shown at the moment it lands. Alongside it, the **game-shape path**
   from Proposal 2.
2. **What it changed.** Your record before → after, division rank before → after
   (`lib/standingsTrend.ts` already computes exactly this), games back, and — when
   it flips — the clinch/elimination line from `lib/clinchScenario.ts`, which is
   the loudest line the report can ever print.
3. **Game ball.** One player. Best line in your box score by `statScore()` from
   `lib/news.ts` (already written), with avatar, position badge, and their line.
   Exactly one, every week, no exceptions — see "what it costs".
4. **The room.** Your injuries from this game only (`box.injuries` carries name,
   weeks and type), plus at most two league headlines ranked by
   `lib/wireRank.ts`. Not sixteen injury rows; `rankWire` already collapses those.
5. **What's next.** The next opponent, their record, the existing
   `lib/winProbability.ts` estimate, and a rivalry/stakes line from
   `generateStorylines` if one clears the threshold.

Then one button: **Continue**. And critically, the whole panel is also
dismissible by clicking anywhere, pressing Escape, or navigating — a player who
already knows can leave in the same gesture they use today.

### Where it lives

Rendered by `AdvanceWeekButton` in place of the current toast, over a dimmed
backdrop, on whatever page you were on. Not a route — you should land back where
you were.

### Data it needs — all of it exists

| Band | Source | Verified |
|---|---|---|
| Your result | `Game` (scores, week, kind), `Game.recap` | `season.ts:415-430` writes both |
| Shape path | `Game.boxScore` → `drives[]`, `quarters` | `lib/types.ts:32-50`, §1.3 |
| Record/rank delta | `Team.wins/losses/ties`, `computeRankDeltas` | `lib/standingsTrend.ts` |
| Clinch flip | `computeClinchStatus` / `clinchScenarioTag` | `lib/clinchScenario.ts` |
| Game ball | `box.lines`, `statScore()` | `lib/news.ts:78` |
| Injuries | `box.injuries[]` (name, weeks, type) | `lib/types.ts:49` |
| League headlines | `Transaction` + `rankWire()` | `lib/wireRank.ts:76` |
| Next up | next unplayed `Game`, `lib/winProbability.ts` | already on the dashboard hero |
| Stakes line | `generateStorylines(leagueId, teamId, {limit:1})` | `lib/storyline.ts:389` |

**The only real code change** is to `AdvanceResult` (`lib/season.ts:109`), which
today carries `summary: string` and needs to carry a structured `report` object.
That interface already has precedent for structured payloads — `capBlock` and
`block` are exactly this shape. `lib/storyline.ts`'s own header comment names
`advanceWeek`'s REGULAR/PLAYOFFS branches as an intended integration point (§1.8),
so this is the wiring its author anticipated.

### Work

**Large.** Roughly: extend `AdvanceResult` and populate it in the REGULAR and
PLAYOFFS branches (~150 lines of assembly, no new math); one new `ds` component
of ~250 lines; rewire `AdvanceWeekButton`'s toast path. Two to three days of
careful work, most of it presentational.

### What it costs

- **Screen space:** takes the viewport while open. Mitigated by being dismissible
  four different ways.
- **Click count:** *zero net new clicks* if Escape/click-outside dismiss are
  wired, because today's toast already sits in front of what you were doing and
  today's player already has to navigate to find their score. Get this wrong —
  make Continue the only exit — and it becomes a mandatory click 17 times a
  season, which is the single most likely way this proposal fails.
- **Noise risk — medium, and this is the honest weak point.** A report that
  fires every single Advance and always looks the same becomes wallpaper.
  Mitigations, in priority order: (a) **the report must visibly differ by
  outcome** — a one-point win and a 30-point loss must not produce the same
  layout, which is exactly what Proposals 2 and 3 provide; (b) **exactly one
  game ball, never zero and never three**, so the section is predictable rather
  than a lottery; (c) **multi-advance shows one report for the whole span**, not
  one per week (§Part 3); (d) a Settings toggle to fall back to the toast, in the
  same spirit as the existing `recapVerbosity` setting.
- **Interruption tier:** 1. Justified because pressing Advance *is* a request to
  be told what happened.

### Why it is ranked first

It is the only proposal that fixes the *core loop*. Every other item on this list
makes a screen better; this one makes the thing you do 17 times a season feel
like something happening to you rather than a page refresh. Madden shipped
precisely this (Weekly Recap 2.0, §2.5) after years of franchise-mode complaints,
and its section list — Player of the Week, injuries, stat leaders, MVP race,
playoff hunt, transactions — is almost exactly the five bands above.

---

## 2. Game Shape — draw the drive path, name the archetype

**Rank 2. The best ratio of drama-per-line-of-code in this document.**

### What it is

Two linked pieces, both computed from `box.drives` (§1.3, §2.10):

**(a) The shape path.** A small inline-SVG line of the score *differential* across
the game's 22+ drives — above zero when you lead, below when you trail, with the
zero line drawn. It is not a chart with axes; it is a silhouette, ~120×36px in a
list and ~600×140px on the game page. Quarter boundaries as faint vertical
rules (derivable exactly: drive index `d` sits in quarter `floor(d/11*4)`, the
engine's own expression at `engine.ts:102`).

**(b) The archetype tag.** A single computed word above the score, from the same
path. Four archetypes, and the rules that produce them are plain arithmetic:

| Tag | Rule |
|---|---|
| **Wire to wire** | differential never crosses zero after the first score |
| **Comeback** | winner trailed by ≥10 at any point |
| **See-saw** | ≥4 lead changes |
| **Never in doubt** | final margin ≥21 and lead ≥14 by the end of Q3 |
| **One score** | final margin ≤8 (default when none of the above fires) |

Plus a derived **drama number** in the spirit of the Excitement Index — the sum
of absolute differential swings across drives, normalised. Show it as a small
0-100 figure only on the game page, never in a list; it is a curiosity, not a
headline.

These make a 31-30 last-possession thriller and a 45-3 walkover *look different
in a list*, which today they do not.

### Where it lives

- **Game page** (`app/league/[id]/game/[gameId]/page.tsx`) — large path plus a
  real four-quarter linescore table from `box.quarters`, both of which that page
  currently ignores entirely. Also the archetype tag beside the final score.
- **Schedule rows** — the 120px sparkline in the score column.
- **Week Report** band 1 (Proposal 1).
- **Dashboard League Wire** — on the featured game story only.

### Data it needs

`Game.boxScore.drives[]` and `.quarters` — persisted for every played game
already (`season.ts:426`). **Nothing new.** All derivation is a pure function;
put it in a new `lib/gameShape.ts` alongside `lib/analytics.ts`, whose header
already establishes the "display-only derivation, never feeds the sim" precedent.

One caveat to check during build: games simulated before this ships already have
`drives[]` (it has always been written), so there is no backfill problem — but a
defensive `drives?.length ? … : null` is needed for any `{}` box score.

### Work

**Medium.** ~120 lines for `lib/gameShape.ts` + tests, ~80 lines for an SVG
component, ~40 lines of game-page layout. One day.

### What it costs

- **Screen space:** 36px of row height on schedule rows it is added to — the one
  place this proposal does spend space. It is a *graphic*, which is the direction
  principle 1 points, not against it.
- **Click count:** zero.
- **Noise risk — very low.** It replaces nothing and adds no words. The archetype
  tag is the only thing that could annoy, and it is one word.
- **The honest weakness:** the sim allocates a fixed 11 drives per team with
  drives alternating strictly, so the path is a little more regular than a real
  game's. It will still correctly distinguish the four archetypes — the scoring
  pattern is what varies — but it will not produce the wild irregularity of a
  real ESPN win-probability chart. This is fine and arguably better: it is honest
  about what the sim actually did (principle 6, no lying metrics).

---

## 3. Result weight — make a one-point loss look different from a 40-point loss

**Rank 3. The cheapest thing here, and it fixes the most-repeated visual lie.**

### What it is

Everywhere a final score is listed, drive the visual weight off the margin, which
is already sitting in the row (§1.4). Concretely:

- **Score typography scales with margin.** A ≤3-point game gets the score at full
  `stat-md` with a thin `--team-accent` rule under it; a ≥21-point game gets the
  loser's score dropped to `text-muted` and the winner's carried at full weight —
  the visual equivalent of "this was over".
- **A margin phrase in the row**, tiny, monospace, next to the score: `+1`, `+28`,
  `OT`. Never a sentence.
- **A `bad`-toned left rule** on your own losses by ≥21 and an `accent`-toned one
  on your own wins by ≥21, so a season's shape reads down the schedule column as
  a pattern of good and bad weeks, not a column of digits.
- **Upsets marked.** `lib/winProbability.ts` already produces a display-only
  pre-game estimate; a win where you were below ~35% gets a small **UPSET** kicker
  in the same editorial-kicker vocabulary the News rows already use.

This is *not* the greyscale-flattening the reverted pass did. It adds a channel
where there is currently none; it removes nothing, and per principle 4 every
colour step is paired with a non-colour channel (the margin figure itself, and
type weight).

### Where it lives

`schedule/page.tsx` (via `MatchupCard`), the dashboard League Wire's game rows,
`standings` last-five form guide, and the Week Report.

### Data it needs

`Game.homeScore` / `awayScore` — present on every row already being rendered.
`lib/winProbability.ts` for the upset flag. Nothing new.

### Work

**Small.** Half a day. Mostly `MatchupCard` and two list renderers.

### What it costs

- **Screen space:** none. Same rows, same heights.
- **Click count:** zero.
- **Noise risk — very low**, with one caveat: if the ≥21 rule fires often (and in
  a high-variance sim it might), the coloured rules stop meaning anything. Check
  the actual margin distribution in a real save before fixing the threshold, and
  tune it so roughly the top and bottom deciles of games get marked — put the
  constant in `lib/tuning.ts` with a `[TUNE]` tag like everything else.

---

## 4. The Trophy Moment — the one full-screen interruption in the game

**Rank 4. Small blast radius, enormous payoff, fires once per season at most.**

### What it is

Winning the championship currently produces `'The championship game is complete!
Welcome to the offseason.'` in the same 320px toast as "Week 3 complete" (§1.2).
Replace it, for the user's team only, with the game's single Tier-0 screen:

- Full viewport, near-black, the team's crest rendered large via the existing
  `generateTeamLogoParams` / watermark treatment, a radial team-accent glow (the
  same "stadium lights" device Draft Day and the Cap hero already use).
- **CHAMPIONS** and the year in the display face at `stat-xl`, in `--team-text`.
- The final score of the title game and the opponent.
- Your **road there**: the four playoff results as one line of scores — those
  `Game` rows exist with `kind` WILDCARD/DIVISIONAL/CONFERENCE/FINAL.
- The season line: record, points for/against, and where you were seeded.
- The championship MVP — `recordSeasonAwards` already computes `AWARD_SBMVP`
  (`season.ts:712-724`).
- One button: **Raise the banner** → the History page.

And the mirror, at lower intensity: **losing a playoff game ends your season**,
and that also gets a full-screen treatment — same layout, `bad`-toned, headed
"SEASON OVER", showing the round you fell in, your final record, and one forward
line ("You pick 24th"). It is a genuine moment and it is currently a sentence
that does not name your team.

### Where it lives

Rendered by `AdvanceWeekButton` when the advance result flags it. Nowhere else.

### Data it needs

`TeamSeasonRecord.playoffResult` (`CHAMPION` / `RUNNER_UP` / round exits — written
by `snapshotSeasonHistory`, `season.ts:669`), the playoff `Game` rows, and the
`AWARD_SBMVP` transaction. All persisted. The only change is `AdvanceResult`
carrying a flag, which Proposal 1 introduces anyway.

### Work

**Medium.** ~200 lines of one component. One day. It shares the report plumbing
with Proposal 1, so building 1 first makes this nearly free.

### What it costs

- **Screen space:** all of it, once.
- **Click count:** one dismissal, once or twice per season.
- **Noise risk — very low, by construction.** The budget is the design: it fires
  only on a season-ending playoff outcome. If it ever fires more than twice in a
  season, something is wrong.
- **Real risk:** it must not fire for AI-team championships. Guard on
  `Team.isUser`. Another team winning it all is a Tier-3 wire story (which
  `wireRank` already weights at 100, correctly).

---

## 5. Season Arc — the season as a line, not a snapshot

**Rank 5. Turns 17 independent weeks into one story with a turning point.**

### What it is

A single line chart on the Standings page: **your position in the conference
playoff picture, week by week, from week 1 to now**, with the six-seed cut line
drawn across it — the same "CUT LINE" the standings page already renders
horizontally, now as an axis you can cross. Above the line you are in; below, out.
Mark the week you clinched or were eliminated (§2.11, FanGraphs).

Optionally overlay the division rivals' lines in their team colours, faintly, so
the race reads as several lines converging and separating.

### Where it lives

`app/league/[id]/standings/page.tsx`, above the existing NFC/AFC playoff picture
blocks, sized like the existing Advanced-view charts.

### Data it needs — derivable, but this one takes real computation

There is **no historical standings snapshot** — the README says so explicitly. But
it does not need one: every `Game` row for the season carries `week`, `homeScore`
and `awayScore`, so week-by-week standings for all 32 teams can be *replayed*
from ~272 rows, and `seedConference()` (already inside `lib/clinchScenario.ts`)
re-run at each week to get each team's seed position. Deterministic, no RNG, no
schema.

Cost is one `Game.findMany` for the season plus 17 × 16 comparisons — cheap, but
it is the most computation of anything in this document. Belongs in a new
`lib/seasonArc.ts` following `lib/analytics.ts`'s display-only convention, and
should reuse `clinchScenario.ts`'s `byStanding`/`seedConference` rather than
duplicating them a third time (that file already documents one deliberate
duplicate of `season.ts`'s comparator; a third copy would be a maintenance trap).

### Work

**Medium.** ~150 lines of replay logic + a chart from the existing
`components/charts/` kit. One day, plus care getting the tiebreakers to agree
with `seedPlayoffs` — a divergence here would be a principle-6 violation (a rank
that isn't the real rank).

### What it costs

- **Screen space:** one chart block on one page.
- **Click count:** zero — Standings is already a destination.
- **Noise risk — low.** It is opt-in by navigation.
- **The honest weakness:** for the first 3-4 weeks of a season the line is noise
  (everyone is 2-1). Suppress it until week 5, and say so rather than drawing a
  meaningless scribble.

---

## 6. Live records, and one Game Ball a week

**Rank 6. High emotional value; the highest logic cost on this list.**

### What it is

Two related changes:

**(a) Move record checking in-season.** Today `checkAndUpdateRecords` runs once
per year at the offseason rollover (§1.5), so a single-season record broken in
week 14 is announced in the offseason. Run the SEASON-scope check weekly inside
`simulateWeek`, after stats are merged. When one falls: a `Transaction` row (which
`wireRank` already scores at 80 and `isBreakingNews` already admits to the
ticker), the top line of that week's report, and a **permanent** marker on the
player's card and the game page for the game it happened in.

**(b) One Game Ball per week, and it persists.** Whatever the report names as the
week's best line (Proposal 1 band 3) becomes a small, permanent badge on that
player's row and card: "Game Ball, Wk 8." Three of them is a real season; a
rookie collecting his first is exactly the XCOM promotion beat (§2.7) — a named
individual, a threshold, permanence.

### Where it lives

`lib/season.ts` `simulateWeek` (the check), the Week Report (the announcement),
the player page and roster rows (the persistence), the game page (the banner).

### Data it needs

`LeagueRecord` rows and `Player.seasonStats` — both already updated inside
`simulateAndSaveGame`'s transaction. The CAREER-scope check should stay at the
offseason rollover, because `careerStats` only folds in the current season then
(`lib/storyline.ts` documents this exact trap) — running career checks weekly
would compare against a stale total and produce a wrong record. **Get this wrong
and you ship a lying metric.**

Game Ball persistence is the one place that may want new storage. Two options:
derive it on read (re-scan the week's box scores, cheap and schema-free) or
write a typed `Transaction` row per week and read those back. Prefer the
`Transaction` row — it costs nothing, it is the pattern already used for
`DEV_MILESTONE`, and it makes the badge queryable from the player page without
loading box scores.

### Work

**Medium-to-large.** The record-timing change touches simulation-adjacent code,
which is the highest-risk area in this document. Two days, and it needs
`scripts/simHealth.ts` coverage.

### What it costs

- **Screen space:** a badge on some player rows.
- **Click count:** zero.
- **Noise risk — medium, and it needs discipline.** Seven record categories × two
  scopes means a young league can break several records early and often, exactly
  the "first data point isn't a record" problem `records.ts` already solved for
  announcements. Keep that guard. And **cap it at one record announcement per
  week** in the report — if two fall, the second is a wire line.
- **The honest weakness:** this is the only proposal that changes when game logic
  runs, and the codebase is (rightly) conservative about that. If the appetite for
  sim-adjacent change is low, ship (b) alone — the Game Ball is schema-light and
  carries most of the emotional payload.

---

## 7. News as a weekly edition

**Rank 7. Real, obvious, but the smallest emotional delta of the top seven.**

### What it is

`/news` is 2,815 rows newest-first, of which six consecutive visible rows share a
byte-identical detail sentence (§1.6). Meanwhile `lib/wireRank.ts` already solves
this and is not pointed at this page. Two changes:

1. **Run the page's rows through `rankWire`** per week bucket, with its existing
   `PER_TYPE_CAP` and injury collapsing, so a week reads like an edition rather
   than a log.
2. **Give each week a masthead** — "2030 · Week 8 · 35 stories" as a real dateline
   with the week's single biggest story rendered as a lead (the `featured`
   treatment the dashboard wire already has), and everything else beneath it.

Keep an "All stories, unfiltered" toggle. The raw log is genuinely useful for a
player who wants receipts, and removing it would be the reverted pass's mistake
in a new hat.

### Where it lives

`app/league/[id]/news/page.tsx`.

### Data it needs

Existing `Transaction` rows; `rankWire` unchanged.

### Work

**Small-to-medium.** Half a day plus pagination care (ranking within a week
bucket has to happen before slicing, or page 2 is wrong).

### What it costs

- **Screen space:** none.
- **Click count:** zero.
- **Noise risk:** negative — it *removes* noise.
- **Why only rank 7:** the News page is a destination the player chooses to
  visit. Fixing it makes a good page better; it does not change how the season
  feels. It is high-value-per-hour and low-value-per-outcome.

---

## 8. Circle It — stakes before the game, not just after

**Rank 8. Genuinely good idea; the one I am least sure lands.**

### What it is

`lib/rivalry.ts` computes a 0-100 intensity score with a transparent breakdown,
and its only visible output is whether a sentence gets printed (§1.9). Use the
score:

- On the **schedule**, an upcoming game against a high-intensity opponent gets a
  marker — a small ring or bracket around the row, the head-to-head record
  (`4-7 all-time`), and a one-line reason (`Lost 3 straight to them`).
- On the **dashboard hero's next-up strip**, the same, as a stakes line under the
  win-probability pill: "Revenge game — they've beaten you three in a row."
- Late in the season, a game whose outcome flips your clinch status gets a
  different marker: **WIN AND IN**, computed by running `computeClinchStatus`
  twice — once projecting this game as a win, once as a loss. That is a genuinely
  dramatic, genuinely true statement, and the math to produce it already exists.

### Where it lives

`schedule/page.tsx` and the dashboard `TeamHeader`.

### Data it needs

`computeRivalry` (exists, no schema — derived from `Game` history), and two extra
`computeClinchStatus` calls for the win-and-in flag. Both pure functions.

### Work

**Small.** `computeRivalry` is the expensive part and it is already written; this
is mostly presentation. Half a day.

### What it costs

- **Screen space:** a line on some schedule rows.
- **Click count:** zero.
- **Noise risk — medium, and this is why it is ranked 8th.** In a 32-team
  fictional league with no real-world history, "rivalry" is a statistical
  pattern, not a remembered grudge — `lib/rivalry.ts` says exactly this in its own
  header. Division opponents get a 30-point baseline just for being division
  opponents, which means six of your seventeen games could get marked in year
  one, and a marker on a third of the schedule is not a marker. **Raise the
  threshold well above `RIVALRY_NARRATIVE_THRESHOLD` for this visual use, and
  consider limiting it to at most two games per season.**
- The **WIN AND IN** half of this proposal is much stronger than the rivalry half
  and could ship alone. If I had to cut half of one proposal, I would cut the
  rivalry markers and keep the clinch-swing flag.

---

## 9. Franchise Timeline — the retellable object

**Rank 9. The one with the longest payoff horizon, which is exactly why it is last.**

### What it is

FM's Dynamic Manager Timeline (§2.2) renders a save as a chronological list of
milestones so the player has something to *retell*. Build the same here: a
vertical timeline of the franchise under your tenure — one entry per season
(record + playoff result), plus every championship, every league record set by
one of your players, every award won, and your three or four largest trades.

`components/ds/Timeline.tsx` already exists and is used only in a design-system
mockup.

### Where it lives

The History page's selected-franchise block, or GM Career. Not a new route.

### Data it needs

`TeamSeasonRecord` (year, record, `playoffResult`), `LeagueRecord` (holder +
`seasonYear`), award and `CHAMPION` `Transaction` rows, `TradeRecord`. All
persisted, all queryable by season. Nothing new.

### Work

**Medium.** ~200 lines of aggregation and layout. One day.

### What it costs

- **Screen space:** one block on an existing page.
- **Click count:** zero.
- **Noise risk — low.**
- **Why last:** it is empty in season one, thin in season two, and only becomes
  the best screen in the game around season five. Everything above it pays off on
  the very next Advance. This is the right thing to build once the loop feels
  alive, not before.

---

## What I would build, in order

1. **Proposal 3** (half a day) — ship the cheapest fix first so a result stops
   looking like every other result while the bigger work lands.
2. **Proposal 2** (one day) — the shape path; it is also band 1 of the report.
3. **Proposal 1** (two to three days) — the Week Report, using 2 and 3.
4. **Proposal 4** (one day) — nearly free once 1 exists.

That is roughly a week, and it converts the core loop. Proposals 5-9 are all
worth doing and none of them are urgent.

## What I would not do

- Confetti, particles, screen shake, or any celebration not attached to a
  specific true fact.
- A modal on a good win. See findings §Part 3.
- Animating the game. §2.4 is the argument, and the app is right to have never
  tried.
- Removing the raw news log, the ticker, or any table, in service of any of the
  above.
