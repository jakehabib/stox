# Year-by-year player stats (`PlayerSeason`)

> Owner's ask: *"Also the player stats should show the year by year stat lines
> like real nfl shows by season."*

The player page now carries the table every football reference site carries —
one row per season, with the year, the club he played for **that year**, his
age, his games, and the numbers that matter at his position, then a career
total across the bottom.

This document is the schema delta and the reasoning behind it. It is written
separately because `prisma/schema.prisma` and `prisma/migrations/` were locked
by another agent's data migration while the rest of this was built.

---

## 1. What already existed, and why none of it could answer the question

| Where | What it holds | Why it can't produce a season row |
|---|---|---|
| `Player.seasonStats` | The season in progress, merged | No team on it. Cleared every year. |
| `Player.careerStats` | Everything before this year, merged | No season on it, no team on it. |
| `Player.playoffStats` / `careerPlayoffStats` | The same pair for postseason games | Added later — see §6. |
| `TeamSeasonRecord` | Per-club, per-year W/L | Team-level. Says nothing about a player. |
| `LeagueRecord` | Single-season and career highs | One row per category, holder only. |

There was no per-season decomposition anywhere in the database.

**But the seasons the league actually played were never lost — only
un-indexed.** Every played `Game` keeps its full `BoxScore` JSON, and a box
score files each player's stat line under the home or away side.
`Game.seasonYear` gives the year; `homeTeamId`/`awayTeamId` give the club.
Nothing in the codebase ever deletes a `Game`. So the true decomposition —
year, club, games, stats — is *reconstructable by replay*, and it is
reconstructable for existing saves too.

That reconstruction (`buildSeasonLines` in `lib/playerSeasons.ts`) is the only
source this feature accepts for a season row. Verified against a four-season
save: the sum of the replayed seasons equals `Player.careerStats` **exactly**,
for all 1,114 players in that league with a career on file, with no key over
and no key under.

---

## 2. The schema delta

New table only. Nothing is added to an existing table, so the "anything added
to an existing table must be nullable or defaulted" rule is satisfied
vacuously — there is no backfill of an existing row anywhere in this
migration, and `migrate deploy` against a live database only creates.

```prisma
/// One player's production in one season for ONE club.
///
/// Keyed on (player, year, TEAM) rather than (player, year) on purpose: a
/// player traded mid-season gets one row per club, because "which club did he
/// produce for" is the question a year-by-year table exists to answer, and a
/// single row averaged across two jerseys answers it wrongly while looking
/// authoritative. The display re-combines them into a "2TM" summary line
/// above the pair, the way every real football reference does.
///
/// Written by rollSeasonStatsIntoCareer() in lib/season.ts, reconstructed
/// from played box scores — see lib/playerSeasons.ts for what is and isn't
/// knowable, and why nothing here is ever invented.
model PlayerSeason {
  id       String @id @default(cuid())
  leagueId String
  league   League @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  playerId String
  player   Player @relation(fields: [playerId], references: [id], onDelete: Cascade)

  seasonYear Int

  /// The club he played for THAT year — the entire point of the row. Nullable
  /// only because a Team row could be deleted out from under it; teamAbbr is
  /// denormalized alongside so the crest and the label survive that.
  teamId   String?
  team     Team?   @relation(fields: [teamId], references: [id], onDelete: SetNull)
  teamAbbr String

  /// His age that season. Nullable, and null is a real answer: see
  /// ageInSeason() in lib/playerSeasons.ts. A dash is honest where the
  /// arithmetic can't be trusted; a fabricated 24 is not.
  age Int?

  gp Int @default(0)

  /// JSON string, SeasonStats (lib/types.ts) — the same shape and the same
  /// keys the box score wrote.
  stats String @default("{}")

  /// The query this table exists to serve is "every season for one player,
  /// oldest first", which this unique index serves as a prefix scan. It is
  /// also the idempotency key: re-running a rollover cannot double a season.
  @@unique([playerId, seasonYear, teamAbbr])
  /// For the per-league sweep: which years already have rows, and the
  /// delete-and-rewrite of a single year.
  @@index([leagueId, seasonYear])
}
```

Three back-references are added to existing models (relation fields only — no
columns, no migration effect):

```prisma
model League { /* ... */ playerSeasons PlayerSeason[] }
model Player { /* ... */ seasons       PlayerSeason[] }
model Team   { /* ... */ playerSeasons PlayerSeason[] }
```

### Migration SQL

`prisma/migrations/<timestamp>_player_seasons/migration.sql`:

```sql
CREATE TABLE "PlayerSeason" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "seasonYear" INTEGER NOT NULL,
    "teamId" TEXT,
    "teamAbbr" TEXT NOT NULL,
    "age" INTEGER,
    "gp" INTEGER NOT NULL DEFAULT 0,
    "stats" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "PlayerSeason_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlayerSeason_playerId_seasonYear_teamAbbr_key"
    ON "PlayerSeason"("playerId", "seasonYear", "teamAbbr");
CREATE INDEX "PlayerSeason_leagueId_seasonYear_idx"
    ON "PlayerSeason"("leagueId", "seasonYear");

ALTER TABLE "PlayerSeason" ADD CONSTRAINT "PlayerSeason_leagueId_fkey"
    FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerSeason" ADD CONSTRAINT "PlayerSeason_playerId_fkey"
    FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerSeason" ADD CONSTRAINT "PlayerSeason_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

`prisma/migrations/migration_lock.toml` is deliberately not part of this
change.

---

## 3. Where it gets written

`rollSeasonStatsIntoCareer()` in `lib/season.ts` — the one place that already
has the player, the finished season line, the season year and the club in
hand. It gains one call:

```ts
await syncPlayerSeasons(leagueId, seasonYear, seasonYear + 1);
```

`syncPlayerSeasons` (in `lib/playerSeasons.ts`):

1. asks which season years already have rows (`@@index([leagueId, seasonYear])`);
2. replays the box scores for **only the missing years** — so the ordinary
   case is one season's ~285 games, and an old save pays a one-off sweep of
   its whole history the first time it advances after the migration;
3. writes them with chunked `createMany` — one statement per 500 rows, about
   five statements for a full league-season, in the same bulk-write style as
   `bulkSetText` beside it. It never adds a per-player round trip.

The third argument is the **age basis year**: the league year `Player.age` is
currently stated in. The rollover is the single step in the whole phase
machine where that is not `League.seasonYear` — the offseason `PROGRESS` step
runs immediately before it and has already aged everyone for the season about
to start. `ageBasisYear()` encodes that so no call site has to remember it.

Idempotent: a year that already has rows is skipped, and the unique key means
a forced re-run replaces rather than doubles.

---

## 4. Undecomposable history — the honesty problem

Two kinds of career cannot be replayed:

1. **Seeded veteran careers.** `lib/gen/leagueHistory.ts` gives every veteran
   on a roster the career he "would have had", walking backward one fictional
   season at a time — and then persists **only the merged total**. The
   per-season walk is gone the moment generation returns; the `Rng` stream is
   not stored. That module's own comment says it outright: *"Nothing in the
   schema records where a generated veteran was in 2019."* The team-that-year
   — the entire point of this table — was never decided by anything, for any
   of those seasons.
2. **Anything else `careerStats` carries that the box scores don't account
   for.** Measured as exactly zero on the saves checked, but the arithmetic
   handles it rather than assuming.

Splitting either into plausible-looking yearly rows would be inventing
history: a *different* fiction from the one that produced the total, forced to
sum to it, hung on clubs picked out of the air. It is refused.

Instead, `residualBeforeRow()` computes `careerStats − Σ(replayed seasons)`
and, if anything is left, emits **one** row:

```
Before 2026    —     —    65   1205   2096  12524   101   51   596   0
```

It carries the true merged remainder, wears no crest (there is no club to
name), and the table's own footnote says what it is. The seasons behind it are
not shown because they are not known.

The career total row is summed from **the visible rows**, not read back from
`careerStats`. By construction they are the same number — the "before" row is
defined as the difference — but summing what is on screen means the bottom
line is always the total of the table above it. (README §"Design principles",
rule 6: *no lying metrics*.)

### What the seeded franchise backstory does and does not imply

`lib/gen/leagueHistory.ts` seeds 16–24 prior seasons of `TeamSeasonRecord`,
championships, award winners and league records at league creation. Those are
persisted as league canon and stay exactly as they are. They imply that
players existed and had seasons — but they never say *which* players: the
synthetic legends who won those awards are **not `Player` rows at all**, they
exist only as denormalized names on `Transaction` and `LeagueRecord`. There is
no player page for them and nothing in that data can produce a player-season.

So, stated plainly:

- **Real**: every `PlayerSeason` row. Every one is a replay of games the sim
  actually played, filed under the club the game was actually played for.
- **Real**: the "Before *year*" total. It is the number the rest of the game
  has always used for that player's career.
- **Fiction, and labelled as such by being collapsed into one row**: the
  season-by-season *shape* of a career that predates the league. Not shown,
  because it was never recorded.
- **Fiction, unchanged, and out of scope here**: the seeded franchise
  backstory. It is team history, not player history.

---

## 5. Mid-season trades

**Two rows, plus a combined one.** A back traded in week 9 gets a row for each
club — that split is free, because the box scores already file each game under
the club he played it for — and the display puts a `2TM` summary line above
the pair carrying the season total, exactly the convention Pro Football
Reference uses. The per-club rows sit under it indented and dimmed, so they
read as a breakdown of the row above rather than as two extra seasons.

One row would have been cheaper and would have been a lying metric: it would
have shown the whole year's production against whichever jersey he happened to
be wearing when the season ended.

The **season currently in progress** is the one case that cannot come from
`PlayerSeason` (its rows aren't written until the rollover). The player page
reconstructs it live from that season's box scores instead, so it splits a
trade correctly too, and it is marked `LIVE` in the table.

---

## 6. Reading it back

`app/league/[id]/player/[playerId]/page.tsx` →
`components/ds/CareerStatTable.tsx`.

Columns come from `CAREER_COLUMNS` in `lib/statLabels.ts`, which is the single
per-position mapping for the whole app: the table renders the full list, the
player-page hero renders `headlineColumns()` — a derived subset — so the hero
and the table can never disagree about what defines a position. The lists are
exactly the keys `lib/sim/engine.ts` can actually write for that position, so
no column is a permanent zero. An offensive lineman gets no box line from the
sim at all and is told so in words rather than given a table of noughts.

Until a league has been through a rollover with `PlayerSeason` in place, the
page falls back to `reconstructPlayerSeasons()` — the same replay, filtered to
one player with a `LIKE` on the box-score text. That returns only the ~17
games a year he actually appeared in and measures at 9–21 ms on a four-season
save. It stays after the table lands, because a save that hasn't advanced
since the migration should show a correct table rather than an empty one.

---

## 6. Regular season and postseason are two buckets

> Owner's ask: *"playoff stats and regular season stats were being counted in
> the same bucket... We should have a toggle so you can switch between the two
> because they are different."*

### The bug

`simulateAndSaveGame` gated only the **standings** on `kind === 'REGULAR'`.
The stat write had no gate at all, so postseason production accumulated into
`Player.seasonStats` alongside the regular season, rolled into
`Player.careerStats` at the offseason, and was replayed into `PlayerSeason.stats`
by `buildSeasonLines`. `gp` was combined too, so a 17-game regular season plus a
playoff run reported 18.

Measured on `RD DRIFT BEFORE-B` (`cmt3h2ar20000biuvvdcpgt3s`), season 2034:

| Player | Regular | Playoff | Row said |
|---|---|---|---|
| Osiris Braddock (QB) | 3,722 pass yds, 16 G | 266, 1 G | 3,988, 17 G |
| Micah Vandermark (RB) | 2,418 rush yds, 17 G | 251, 1 G | 2,669, 18 G |
| Quill Hidalgo (QB) | 4,294 pass yds, 14 G | 245, 1 G | 4,539, 15 G |

It is worse than cosmetic. Only twelve of thirty-two clubs get the extra games,
so league leaders systematically rewarded reaching the postseason rather than
playing well, and career totals inherited it.

### The shape

Two columns beside each existing one, rather than a `kind` discriminator on a
new row or a nested JSON object:

| Table | Regular season | Postseason |
|---|---|---|
| `Player` | `seasonStats`, `careerStats` | `playoffStats`, `careerPlayoffStats` |
| `PlayerSeason` | `stats`, `gp` | `playoffStats`, `playoffGp` |

The existing columns **narrow** to mean regular season only — they are not
renamed. That is what makes the change safe: every reader in the codebase that
was implicitly asking for regular-season numbers (awards, league records,
All-Star selection, development checkpoints, storylines, the roster production
line) keeps reading the same column and silently becomes correct, with no call
site left to forget. A `kind` column on `PlayerSeason` would have doubled the
row count and turned every existing read into a filter that could be omitted;
a nested object would have broken `mergeStats`, which is the one function that
sums stat lines everywhere.

`PlayerSeason.playoffGp` mirrors `playoffStats.gp` for the same reason `gp`
mirrors `stats.gp`: it is a sortable, indexable column and the table already
had the precedent.

### Backfill

`Game.kind` has always been stored and nothing deletes a `Game`, so every
historical playoff line is recoverable. `scripts/backfillPlayoffStats.ts`:

1. Replays `PlayerSeason` from box scores for every completed year
   (`syncPlayerSeasons(..., { rebuild: true })`).
2. Subtracts the playoff share of the **rolled-over** years out of
   `careerStats` into `careerPlayoffStats`. Subtraction, not a rebuild, so a
   seeded pre-league career (§4) survives untouched on the regular-season side.
3. Does the same to `seasonStats`/`playoffStats` for a save sitting *inside*
   its playoffs, where the live accumulator is already polluted.

Measured: 42 leagues touched, 91,448 `PlayerSeason` rows rebuilt, 17,998
careers split, 1,738 live accumulators split, 973 stale live-year rows dropped.
The script is idempotent — a second run reports 0 splits.

Verification that it restores the *pristine* pre-playoff state: `DC USER`
(`cmt3gxh4u0000hdiyi8z87s2t`) is a save inside its playoffs with stored
All-Star transactions. Re-running `selectAllStars()` against its polluted
`seasonStats` produced a roster differing from the stored one in six places.
After the backfill it recomputes byte-identical.

### What cannot be split, and is not

A career seeded at league creation has no box scores at all, so it has no
derivable postseason share. It stays **wholly on the regular-season side** as
the existing "Before &lt;year&gt;" row, and the postseason view says so in
words rather than inventing a fraction of it
(`CareerTable.hasPreLeagueCareer`).

### The toggle

`?split=playoffs` on the stats page and the player page — a URL param, so a
reload and a shared link keep it, matching how free agency carries its sort and
position filters. Regular season is the default **by absence**: the regular
href carries no param at all. `components/ds/StatScopeToggle.tsx` owns the
param name and the parse.

An empty postseason is a real state and reads as one — "No postseason games" —
never a table of zeroes and never a blank panel.

The stats page's Advanced view is hidden in the postseason split: Pythagorean
expectation, strength of schedule and the scoring trend are all built from
`Team.wins`/`pointsFor` and the regular-season schedule, which by design count
regular-season games only. Team records in the postseason table are derived
from the bracket's own `Game` rows instead of borrowed from the standings.

### All-Star timing

`lib/allStars.ts` runs at the end of the regular season. That used to be
load-bearing for correctness *because* of this bug. It no longer is — the
totals it reads are regular season whenever it runs — but the timing stays,
because January is when the real thing is named. The comment now says it is a
choice rather than a workaround.
