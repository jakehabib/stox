# Analytics Department — data inventory

What the database can answer today, what it cannot, and the specific schema
additions that would unlock the best of what it cannot.

Checked against `prisma/schema.prisma` at `claude/football-gm-simulator-ixeatl`
and against a real four-and-a-half-season league (`ANALYTICS DEPT`,
`cmt3gsd7n0000zggejtmdkm10`, 1,696 rostered players, 176 played games this
season, 3,924 `PlayerSeason` rows).

---

## Part 1 — Answerable today, with nothing new

Everything in the mockup is in this list. Nothing on that page needs a migration.

| Question | Where it comes from | Cost |
|---|---|---|
| Did we win more or fewer games than our scoring deserved, this season and every season on record? | `Team.pointsFor/pointsAgnst` (live) and `TeamSeasonRecord` (history) → `pythagorean()` | 2 indexed queries |
| How does that compare to the other 31 clubs? | 32 `Team` rows → `buildPythagoreanTable()` | 1 query |
| How good is each of our nine units, and where does it rank league-wide? | `buildLeagueRatings()` over `Player.trueOvr` + `positionGroup()` + `STARTERS_AT_GROUP` | 2 queries, in-memory |
| How much cap is committed to each unit, by us and by the league? | `Player` ⋈ `Contract` → `capHit()`, grouped by `positionGroup()` | 1 query, ~1,700 rows |
| Who is on a bargain and who is an anchor? | `marketValue()` − `capHit()` → `classifyContractValue()` | already loaded with the roster |
| How old is the roster, and how old is the *money*? | `Player.age` + `capHit()` → `buildCapHealth()` (`capWeightedAge`) | free |
| Who falls off a cliff in two years, and what do they hold today? | `Player.age` + `Contract.yearsRemaining` | free |
| How much of next season is already committed? | `capHitSchedule()` / `Contract` + `capForYear(year+1, startYear)` | free |
| How was each game actually decided — comeback, collapse, see-saw, blowout? | `Game.boxScore.drives` → `computeGameShape()` | 1 query per club-season |
| One-score and blowout record; leads of 10+ surrendered | same, via `ONE_SCORE_MARGIN` / `BLOWOUT_MARGIN` | free once the box scores are loaded |
| Strength of schedule played | `Game` + `Team` records → `strengthOfSchedule()` | 1 query |
| Win chance in each remaining fixture, with its factor breakdown | `estimateGameWinChance()` | free |
| What did each round of the draft return? | `DraftPick(used, ownerTeamId)` ⋈ `Player.trueOvr` | 1 query |
| Yards, turnovers, third downs, sacks, penalties, first downs, time of possession — ours and the league's | `Game.boxScore.teamStats` | **expensive, see below** |
| A player's production season by season, with the club and age attached | `PlayerSeason` | 1 `IN` query |
| Drive-level efficiency: points per drive, three-and-out rate, drives ending in a turnover | `Game.boxScore.drives` (`result`, `points`, `plays`, `yards`) | same read as the box-score profile |
| Opponent-adjusted margin (SRS), résumé strength, weekly power index | `buildPowerRankings()` | already built |
| Trade retrospectives | `TradeRecord` → `lib/tradeRetro.ts` | already built |
| Games missed to injury, reconstructed | `Game.boxScore.injuries[]` events across a season | expensive, same read |

**The one real cost in that list.** Every team-level game statistic lives inside
`Game.boxScore`, a JSON string column. Ranking the club against the league on
"yards allowed per game" therefore means selecting and `JSON.parse`-ing **every
played game in the league-season** — 176 rows at week 12, 272 by the end, and
~2,200 if a panel ever wanted four seasons. It works (the mockup does it), but it
must be cached per league-week rather than recomputed on every render. See
"Cheap wins" below for the fix that removes the parse entirely.

---

## Part 2 — Not answerable today

These are the panels I wanted and did not build. Each is followed by the specific
schema change that would unlock it.

### 2.1 Unit strength over time — **the biggest hole**

The brief asked for "unit strength over time and against the league". *Against
the league* is on the page. *Over time* is not, and cannot be, because **the
database stores no historical rating of any kind at unit granularity.**

- `buildLeagueRatings()` is computed live from `Player.trueOvr` **as the roster
  stands right now**. There is no snapshot.
- `PowerRankingSnapshot` stores `rating` — but that is the single team overall,
  not the nine units; and it is only written for weeks in which the Power
  Rankings page was actually rendered (`ensurePowerSnapshot`), so coverage is
  patchy by construction. In the league I built, which was simmed by script and
  never rendered a page, there are **zero** snapshot rows.
- Nothing else retains a past rating. `TeamSeasonRecord` holds results, not
  talent.

This is not recoverable by cleverness. Player ratings drift every offseason
through `progressPlayer()`, players are traded and released, and there is no
event log of `trueOvr` changes. **A rating in the past is simply not in the
database.**

**Fix — a new table.**

```prisma
// One row per club per league-week: what each unit rated at the time.
// Written by the same tick that already advances the week, not by a page render,
// so coverage does not depend on which screens the user happened to open.
model TeamRatingSnapshot {
  id       String @id @default(cuid())
  leagueId String
  league   League @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  teamId   String
  team     Team   @relation(fields: [teamId], references: [id], onDelete: Cascade)

  seasonYear Int
  week       Int      // as PowerRankingSnapshot: playoffs collapse to seasonLength + 1
  phase      String   // PRESEASON | REGULAR | ... — an offseason snapshot is the interesting one

  overall      Int
  offense      Int
  defense      Int
  specialTeams Int
  // Nine unit ratings and their 1-32 league ranks. JSON rather than 18 columns:
  // POSITION_GROUPS is allowed to change (TE was folded into WR until recently,
  // and the fullback was removed), and a schema that has to migrate every time
  // the group list moves is a schema that will silently stop being written.
  units String @default("{}")   // { QB: { rating, rank }, ... }

  @@unique([leagueId, seasonYear, week, teamId])
  @@index([leagueId, teamId, seasonYear])
}
```

- **Write point:** `advanceWeekStep()` in `lib/season.ts`, one `createMany({
  skipDuplicates: true })` of 32 rows per week — the same idempotent pattern
  `ensurePowerSnapshot()` already uses.
- **Backfill:** **impossible for existing saves, and the panel must say so.** The
  chart should start at the week the column shipped and carry an explicit "on
  record since week N" caption, not a line that quietly begins mid-season as
  though nothing were missing. Faking history here would be exactly the lying
  metric the README's design principles forbid.
- **Size:** 32 rows × ~22 weeks × seasons. A ten-season save is ~7,000 rows —
  trivial next to the ~1,700 `Player` rows already carried per league.
- **Unlocks:** unit strength over time; "your defensive line has been
  bottom-ten for four straight seasons"; rating trajectory against the league;
  a genuine before/after on every trade and every draft.

### 2.2 Cap allocation over time

Panel 3 answers "are you paying for what you're getting" **today**. It cannot
answer "have you been over-invested in the secondary for three years", because a
`Contract` only holds its *current* state — `yearsRemaining` counts down in place
and past cap hits are not retained. `CapCharge` records dead money by year and
nothing else.

**Fix.** Either (a) extend `TeamRatingSnapshot` above with a `capByGroup String`
column carrying the same nine-key JSON of dollars — one extra column, written at
the same moment, and it makes the flagship panel a time series for free; or (b)
a `TeamCapSnapshot` written once per league-year at rollover, which is cheaper
but only gives one point per season. **(a) is the better trade**: the write is
already happening.

### 2.3 Anything below the drive — EPA, success rate, red zone, third-and-long

`DriveResult` stores `{ team, result, points, plays, yards }`. There is no down,
no distance, no field position, and no play-by-play. So:

- **Available:** points per drive, three-and-out rate, drives ending in a
  turnover, yards per drive, scoring rate. All genuinely useful, all free with
  the box score already being read.
- **Not available:** expected points added, success rate, red-zone efficiency,
  third-and-long conversion, explosive-play rate, field-position value.

**Fix.** Extend `DriveResult` with `startYard: number`, `endYard: number`,
`startClock: number` (seconds remaining) and a `plays: PlayResult[]` array
carrying `{ down, distance, yardLine, type, gain }`. This is a **JSON shape
change inside `Game.boxScore`, not a schema migration** — `lib/types.ts` and
`lib/sim/*` change, Prisma does not. Old games keep their current shape, so every
reader must treat the new fields as optional and every panel built on them must
be scoped to "games since the change".

Cost: this is the largest item here — it touches the sim engine, roughly doubles
box-score size (a JSON `String` column with ~150 plays per game instead of ~22
drives), and needs `lib/gameShape.ts` to stay backward-compatible. **Do not do
this for the analytics screen alone.** Do it if and when the sim itself wants
down-and-distance.

### 2.4 Snap counts and usage

Nothing records who was on the field. `BoxLine` only exists for players who
recorded a statistic, so a snap share, a rotation, or "your third receiver is
taking starter snaps" cannot be computed — and, critically, **an offensive
lineman produces no row at all**. Panel 10 in the mockup says this out loud: the
best-paid lineman on the roster has never had anything recorded about him.

**Fix — the cheapest high-value change on this page.** Add a snaps map to the
box score:

```ts
// lib/types.ts — inside BoxScore
snaps: { home: Record<string /* playerId */, number>, away: Record<string, number> };
```

Written by the sim where it already resolves the lineup through `lib/lineup.ts`.
No migration; `Game.boxScore` grows by ~50 integers per side. Unlocks: snap
share by player, a real "who actually plays" depth chart, participation-weighted
age, and — most importantly — **a row in the production panel for every lineman
on the roster**.

If a persistent, queryable version is wanted rather than a JSON blob, add
`snaps Int @default(0)` to `PlayerSeason` and accumulate it at rollover. One
nullable-safe column, backfillable as 0 (and 0 must render as "—", never as
"played no snaps").

### 2.5 Scouting error — what we thought a prospect was, versus what he became

Panel 8 shows what each pick rates today. It cannot show what the scouting
department *said* he would be, because `ScoutingReport` is **mutated in place**:
`observed`, `scoutedOvr`, `ovrLow`/`ovrHigh` are resampled and re-centred as
confidence rises, so by the time a player has been on the roster three years the
report reads like a description of the player he is, not the projection that was
made. There is no snapshot at the moment of the pick.

**Fix — the single cheapest change in this document.** Four columns on
`DraftPick`, written once, at `draftPlayer()`:

```prisma
model DraftPick {
  // ... existing fields
  // What we believed at the moment the card went in. Written once by
  // draftPlayer(); never updated. Nullable so `prisma db push` can add it to a
  // database with live rows, and so a pick made before this existed reads as
  // "not on record" rather than as a scouting miss of zero.
  scoutedOvrAtPick Int?
  scoutedLowAtPick Int?
  scoutedHighAtPick Int?
  trueOvrAtPick    Int?
}
```

- **Backfill:** none possible, and none should be attempted — a pick made before
  the columns existed has no recorded belief, and the honest render is a dash.
- **Unlocks:** "your board beat the consensus by 4.1 points a pick"; bust and
  steal rates against your own grade rather than against round; whether spending
  scouting focus actually narrows the error. That last one is the only way to
  tell a player whether the scouting economy is worth playing.

### 2.6 Injury cost

`Player.injuryWeeks` is the *current* injury only. Injury *events* are recorded
in `Game.boxScore.injuries[]`, so games-lost-by-a-starter is reconstructable by
replaying every box score of a season — expensive and awkward, and it cannot
distinguish "missed the game injured" from "was healthy and benched", because
there is no participation record (see 2.4).

**Fix.** The `snaps` map in 2.4 solves this too: a starter with zero snaps in a
game he was on the roster for is an availability fact, recorded once, with no
replay. Alternatively `gamesMissed Int @default(0)` on `PlayerSeason`,
accumulated at rollover.

### 2.7 Coaching and scheme

`Team.offScheme` / `defScheme` and the `Staff` table exist, but nothing joins a
scheme to an outcome and nothing records a scheme *change*. "Are we better since
we switched" is unanswerable. A `TeamSchemeChange` log (team, year, week, from,
to) would be about twenty lines and would make the coaching staff mean something
— but it is a gameplay feature first and an analytics one second, so it is out of
scope for this screen.

---

## Part 3 — Cheap wins, ordered by value per hour

1. **`snaps` in the box score** (2.4). No migration. Fixes the biggest visible
   hole on the mockup — the linemen with no line — and gives the depth chart a
   truth check.
2. **Four `scoutedOvrAtPick` columns on `DraftPick`** (2.5). One write in one
   function. Turns the draft panel from a description into a grade.
3. **`TeamRatingSnapshot`, with `capByGroup` folded in** (2.1 + 2.2). One new
   table, one write inside a function that already runs every week. Turns the
   flagship panel and the whole "unit strength" question into time series. Cannot
   be backfilled, so **the sooner it lands the more history it has** — this is
   the one item whose value strictly decreases with delay.
4. **Denormalise the four or five team stats a rank actually needs** out of the
   `boxScore` JSON and onto a small `TeamGameStat` row (team, gameId, yards,
   yardsAllowed, turnovers, turnoversForced, thirdDownConv, thirdDownAtt,
   penaltyYards, timeOfPossession). Backfillable in one pass over existing games,
   and it removes the only expensive read on the screen.
5. **Play-level detail** (2.3). Large, engine-touching, and only worth doing for
   the sim's own sake.

---

## Things the mockup revealed about the data itself

Two observations that are not schema gaps but are worth someone's attention,
because both were invisible until a chart was pointed at them.

- **The league-wide team-rating spread is 7 points.** In this save,
  `buildLeagueRatings()` puts the 32 clubs between 78 and 85. A "1st of 32"
  rating badge therefore means far less than it sounds like — which is precisely
  why panel 3 plots *differences from the league mean* rather than raw ratings,
  and why the unit ranks in its table matter more than the numbers beside them.
  It is also consistent with the rating drift the `Drift BEFORE/AFTER` test
  leagues were built to measure.
- **The 2030 schedule is not home/away balanced.** ATL play **5 home and 12
  away** in a 17-game season, and so do MIN (5/12) and CHI (6/11), while most
  clubs sit at 7/10 or 8/9. Nothing in the analytics screen caused this; the
  schedule generator did, and the "all six remaining games are on the road" flag
  in panel 5 is a true statement about a schedule that looks wrong. Worth a
  separate look at `lib/schedule.ts` / `lib/scheduleSeason.ts`.
