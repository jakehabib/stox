# Weekly power rankings

Two screens' worth of one idea: the standings say **who is winning**, the power
ranking says **who is actually good**, and the distance between them is the
interesting part. If the ordering here were monotonic in win percentage it
would be a second standings table and it would deserve to be deleted.

- `lib/powerRankings.ts` — the model, the weekly snapshot, and the ticker items.
- `app/league/[id]/power-rankings/page.tsx` — the published table, all 32.
- `app/league/[id]/standings/page.tsx` — OVR + PWR columns on every division
  row, plus the top-five capsule above the tables.
- `app/league/[id]/layout.tsx` — the League Wire item, and the once-a-week
  snapshot write.

## The ordering

Four components. Each is turned into a z-score across the 32 clubs before it is
weighted, because they are measured in different units (a win share, a point
margin, a 0-99 rating) and mixing them raw would quietly let point differential
decide everything.

| Component | Weight | What it is | What it argues with |
|---|---|---|---|
| Résumé | 28% | Per game, `result − expected(opponent strength)`. A win over a +10 side banks ~0.75; a win over a −10 side banks ~0.25; a loss to that +10 side costs ~0.25. | The record, when the record was built on nobody. |
| Adjusted margin (SRS) | 28% | Mean scoring margin plus the mean rating of everyone played, solved by iteration. Single-game margins capped at ±21 (three scores). | Everything. This is the component that promotes the club that keeps winning big. |
| Roster rating | 24% | `buildLeagueRatings().overall` — the same number the dashboard hero, the roster page and the handover screen show. Never recomputed here. | The results, when a good roster has been unlucky. |
| Recent form | 20% | Last four games, weights `1 / 0.7 / 0.5 / 0.35`, each game scored `0.4·result + 0.6·(capped margin / 21)`. | The season-long numbers, which is what makes this worth republishing weekly. |

Early season: the three result-based components are scaled by
`min(1, gamesPlayed / 6)` and the roster rating absorbs whatever they give up.
At zero games played this is a pure talent ranking, which is what a preseason
power ranking is. Ties break on roster rating, then abbreviation — never on
query order.

The published index is `50 + 8 × (weighted z sum)`, so league average is 50.

Nothing is random. `Rng` is used once, seeded `power:<leagueId>:<year>:<week>`,
and only to choose between equally-true phrasings of a note. It never touches
an ordering.

### Why résumé is not measured against opponents' win percentage

The first draft credited results against the opponents' combined win rate. In a
test league at week 7 **every** 5-1 team had an opponents' win rate of exactly
.389, every 4-2 exactly .444, every 3-3 exactly .500 — schedule strength was a
pure function of your own record, so 34% of the weight was being spent
re-asserting the record column. Opponent quality has to come from something the
schedule cannot pin to your own record; SRS is that something.

## Movement needs a stored snapshot

Movement cannot be recomputed. A team rating depends on the roster **as it is
now**, so a club that signed a free agent on Tuesday would retroactively rewrite
what it was ranked on Sunday. Last week's ranking has to have been written down
last week.

`lib/powerRankings.ts` still checks for the model at runtime (`snapshotStore()`)
rather than assuming it — the delegate is fully typed, but a process running an
older generated client (a dev server between the migration and its restart, a
deploy mid-roll) does not have the property, and 500ing every league page over
it would be worse than saying nothing. When it is missing, every row's `move`
stays `null`, the MOV column is not rendered at all, and the ticker emits
nothing. No zeroes, no invented deltas — a page with no prior week on record
says so in one line and shows no arrows.

### The table (migration `20260821203436_power_ranking_snapshots`)

```prisma
model PowerRankingSnapshot {
  id       String @id @default(cuid())
  leagueId String
  league   League @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  teamId   String
  team     Team   @relation(fields: [teamId], references: [id], onDelete: Cascade)

  seasonYear Int
  // The week these rankings were published FOR — i.e. entering this week.
  // The postseason resets League.week to 1 for four rounds, so everything
  // from the playoffs on maps to one terminal week: seasonLength + 1, the
  // final regular-season ranking, which stops moving because nothing behind
  // it moves. Offseason phases are never snapshotted (they reuse week
  // numbers across five phases and records are 0-0 anyway).
  week       Int
  rank       Int   // 1-32 in the ordering that was actually displayed
  powerIndex Float // the published index, league average 50
  rating     Int   // buildLeagueRatings().overall at the time
  wins       Int
  losses     Int
  ties       Int
  netPerGame Float

  createdAt DateTime @default(now())

  // One row per club per league-week. This is what makes the write idempotent:
  // ensurePowerSnapshot() uses createMany({ skipDuplicates: true }), so two
  // concurrent renders cannot produce two versions of the same week and a week
  // already on record is never rewritten. The whole point of a snapshot is that
  // it says what we thought THEN.
  @@unique([leagueId, seasonYear, week, teamId])
  @@index([leagueId, seasonYear, week])
}
```

Plus the two back-relations: `powerSnapshots PowerRankingSnapshot[]` on `League`
and on `Team`.

Landed with `prisma migrate dev` as its own migration — this repo has real
migration history and the build runs `migrate deploy`, so never a bare
`db push`. Any process holding an older client needs a restart before
`snapshotStore()` returns the delegate; movement then appears from the
following week onward, never retroactively, because there is nothing truthful
to backfill with.

### Where the write should live

`ensurePowerSnapshot()` is called from the league layout, so the first page
opened in a new week records that week. It is one indexed `findMany(take: 1)`
on a hit and a 32-row `createMany` once a week on a miss.

The better home is the regular-season week tick in `lib/season.ts`
(`simulateWeek`, right after the standings are updated) — that is the moment
time actually moves. It was not put there because that file was owned by
another change when this was written. Both can coexist: the function is
idempotent, so whichever runs first wins and the other is a no-op.

## Ticker

`powerRankingWireItems()` reads snapshots only — no ranking is computed on a
layout that renders on every league page. It obeys the strip's three standing
rules:

- **Current league year only.** Both the current and prior snapshot are
  filtered to `league.seasonYear`. This is the same failure mode as the seeded
  championships that used to fill the wire: an old row is not news.
- **Never padded.** Nothing moved `NEWSWORTHY_MOVE` (3) places → empty array →
  the strip is shorter this week. It also returns nothing until the current
  week's snapshot exists and a prior week is on record.
- **Capped.** At most two items, in their own round-robin bucket, so they take
  at most one slot per round and cannot crowd out a trade or a firing.

Headline shape: `ATLANTA UP 4 TO #6 IN THE WEEK 9 POWER RANKINGS`.
