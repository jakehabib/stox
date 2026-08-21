# Scouting pivot — focus points out, consensus board in

> **STATUS: landed.** The UI half of this document has been applied. The
> Scouting Department page, the draft board's ranking, the header tile and the
> player-page affordance all run on the consensus board / shortlist attention /
> private workouts model described below. `lib/scoutingEconomy.ts`,
> `SCOUT_ECONOMY`, `SCOUT_TIERS`, `components/ScoutButton.tsx`,
> `components/ScoutSpendRow.tsx`, the deprecated actions in
> `app/actions/scouting.ts` and the `replenishLeagueScoutingBudgets` call in
> `lib/season.ts` are all deleted. The tuning blocks named in §6.1 now live in
> `lib/tuning.ts` and `BASE_40` is exported from `lib/gen/prospectProfile.ts`.
>
> **Still open**, deliberately: the four `Team.scout*` columns are dead but not
> dropped (no reader left; dropping them needs a `db push` and a dev-server
> restart), `bigBoardScore` in `lib/gen/prospectProfile.ts` is dead but not
> deleted, §6.2's `SCOUTING_NETWORK` blurb reword is not done, and §6.3
> (`Player.devFocus`) is untouched pending the owner's decision.
>
> Two things in §5 were wrong when applied; see the notes marked
> **[correction]** in §5.2 and §5.4.

Handoff notes for the scouting rework. Written by the systems workstream while
the UI workstream held `components/**`, `app/league/**`, `app/globals.css`,
`app/page.tsx`, `app/layout.tsx` and `lib/ratings.ts`. Nothing in those paths
was touched. Everything below marked **HANDOFF** is a change someone else has
to apply.

---

## 1. What the new system is

Three pieces, replacing one.

| | Cost | Cadence | What it gives you |
|---|---|---|---|
| **Consensus board** (`lib/consensus.ts`) | Free | Always | A public grade, rank, band and *reason* for every prospect |
| **Shortlist attention** (`lib/shortlistAttention.ts`) | Free | Every regular-season week | Passive convergence on whoever you starred |
| **Private workouts** (`lib/workouts.ts`) | 5 slots/season | Pre-draft window only | One big discrete reveal on one prospect |

The focus-point currency (`lib/scoutingEconomy.ts`, `SCOUT_TIERS`,
`Team.scoutPoints`) is retired. It still compiles and still runs — see §5.

### Why the shape is what it is

The GM's edge is no longer *having* information. Every team sees the same
board from day one, for nothing. The edge is knowing where that board is
**wrong**, and the board is wrong in named, publicly-signalled ways rather
than randomly, so finding a steal is a read rather than a dice roll.

---

## 2. `lib/consensus.ts`

Pure, deterministic, DB-free. Seeded off the player id only (`Rng`, never
`Math.random`), so a prospect grades identically on every render and in every
process for the life of the save.

**Grade** = `0.62 × trueOvr + 0.38 × potential`, plus a small noise term
(sd 2.4), plus five biases. The biases dominate the noise on purpose.

| Bias id | Direction | Public signal that causes it |
|---|---|---|
| `TESTING_DARLING` / `TESTING_FADED` | ±up to 9 | Combine/pro-day numbers vs. how good he actually is. This is what finally makes the generator's `WARRIOR` / `BAD_TESTER` archetypes matter. |
| `BLUE_BLOOD` / `SMALL_SCHOOL` | +4 / −4 | `CollegeProfile.competitionGrade` A vs F |
| `DEVELOPMENTAL_DISCOUNT` | −up to 6 | `potential − trueOvr` above 16. The room grades what it can see today. |
| `MEDICAL_DISCOUNT` | −6.5 | A public medical flag. Correlated with true `durability` but *loosely* — a flagged prospect whose shoulder is fine is the exploitable case. |
| positional value (`positionPull`) | +4 (QB) / −5.6 (P) | `AI.DRAFT_POSITION_VALUE`. Moves his **board slot**, never his grade. |

Every bias is returned as data — `{ id, label, direction, delta, because, counter }`
— so a row can render "the board is high on him because he tested well", and
`counter` is a scouting report's *disagreement in words*.

**Ranking, and the no-lying-metrics rule.** `rank` is the index in the
`boardScore` ordering, and `boardScore` is returned on every row. Nothing sorts
by a number the caller cannot see. `boardScore = unrounded grade + positionPull`,
so two prospects showing the same rounded grade can sit a dozen slots apart —
and `positionNote` on the row says exactly why. Ranks are unique, 1..N.

**Bands are derived from rank, not from the grade**, scaled to the league's
actual draft (`bandCutoffs({ teams, rounds })`), because "first-round grade"
should mean "the room expects him inside round one" in a 4-round league too.
Measured on a live 400-prospect class in a 32×7 draft: 5 blue chips, 32 through
first round, 96 through Day 2, 224 drafted, then late fliers and priority FAs.

Bias frequency on that same class (of 400): `BLUE_BLOOD` 70, `SMALL_SCHOOL` 74,
`TESTING_DARLING` 51, `DEVELOPMENTAL_DISCOUNT` 50, `MEDICAL_DISCOUNT` 36,
`TESTING_FADED` 21. Consensus error against the underlying blend: mean −0.7,
sd 4.7, range −17 to +11.

**It never leaks truth.** The consensus reads true ratings — an opinion has to
be an opinion *about* something — but returns only its own grade. No scouted
range is narrowed, no `ScoutingReport` is written, `buildScoutedView()` is
still the only thing that decides what the user may see, and potential still
always comes back from there as a range.

### `disagreementNote(read, ownRead)` — read this before wiring it up

Comparing a consensus grade to a raw `scoutedOvr` **would be a lying metric**.
The grade blends current and ceiling; `scoutedOvr` is current only, and every
prospect's ceiling is above his current rating — so a raw subtraction would
report the user as "below the consensus" on literally every player in the
class. `ownGradeFor(view)` puts the user's own file on the consensus's scale
first, using the midpoint of *his own scouted potential range* (never a true
potential). Use `ownGradeFor` anywhere you want to show "our grade" next to
"the board".

---

## 3. `lib/shortlistAttention.ts`

Runs once per regular-season week from `simulateWeek()`. No button, no cost,
nothing to spend.

- Reads the existing `ShortlistEntry` store (`toggleShortlistAction` in
  `app/actions/draft.ts` — note: **draft.ts**, not scouting.ts). No second store.
- **User team only.** AI front offices draft off true ratings (`lib/draft.ts`),
  so giving them reports would cost a query per team per week and change no pick.
- Filters to `isDraftee` prospects, so a stale star on a player drafted last
  spring does not silently eat a slice of the pool.
- `WEEKLY_POOL` (80 units) ÷ shortlist size × staff throughput × staff quality
  × Dynasty branch bonus = `unitsEach`, the even split. A player whose position
  group is covered by a specialist scout then gets `unitsEach × 1.12`, returned
  per row as `AttentionShare.units`. **Quote `units` on a player row and
  `unitsEach` when expressing the trade-off** — those are the two numbers the
  model actually used; do not recompute either.
- Reveal goes through `observe()` and the existing `ScoutingReport` columns.
  No parallel reveal path.

**The trade-off, measured.** Confidence after 17 weeks from a cold 8, before
staff scaling:

| Starred | End-of-season confidence |
|---|---|
| 5 | 81 |
| 10 | 72 |
| 20 | 54 |
| 40 | 36 |
| 60 | 28 |

Diminishing returns twice over: each week closes a *fraction of what is still
unknown* (so week two teaches less than week one with no separate decay term),
and a hard `CONFIDENCE_CEILING` of 82 that attention approaches and never
reaches. Potential has its own, lower ceiling of 62 — watching a player play
does not tell you what he becomes.

Staff scaling uses `Scout.speed` (headcount, geometrically discounted),
`Scout.accuracy` (quality), and `Scout.specialty` vs the prospect's position
group. Dynasty scaling comes from `loadScoutMods` / `scoutingModsFor` — see
§6.2 for a concern about that.

---

## 4. `lib/workouts.ts`

- **5 slots per league year**, `+1` per rank of the Dynasty `SCOUTING_NETWORK`
  skill. Mirrors `fullScoutMax()` exactly rather than inventing a pattern.
- **Window: `RESIGN` and `FREE_AGENCY`.** Stated choice. `DRAFT` is
  deliberately excluded even though `lib/scoutingEconomy.ts` called it "the
  pre-draft window" — by the time `League.phase` is `DRAFT` the draft is
  actually running and teams are on the clock.
- **The reveal**: locks the combine-measurable attributes
  (`scoutDifficulty ≤ 0.25` — speed, acceleration, agility, strength, arm
  strength, kick power) to their true values; confidence to 90; potential
  confidence to 88, which takes the displayed potential half-width from ±24
  cold (±8.5 for a season-long shortlist) down to ±4.6; surfaces the dev trait
  as the intangibles read.
- **It does not set `revealed`/`fullyRevealed`.** Mental traits — awareness,
  decision making, football IQ, pocket presence — stay ranges, because those
  are the traits that bust a pick and a workout genuinely cannot settle them.
  Full Scout stays the one sanctioned hole in the fog.
- Per-prospect one-shot: `ScoutingReport.workoutYear` blocks a second workout
  on the same player in the same year, so a scarce slot cannot be wasted.

Full Scout vs workout, in one line each: **Full Scout answers "what is he",
on anybody in the league, in any phase, twice a year. A workout answers "how
high is the ceiling and what is he like", on a prospect, before the draft,
five times a year.**

---

## 5. HANDOFF — call sites to delete

> Line numbers below are approximate and were taken before the UI workstream's
> own edits landed on these files. Match on the quoted code, not the number.

I left `lib/scoutingEconomy.ts` intact and marked deprecated at the top rather
than gutting it, because two pages still call it and gutting it would 500 them.
Apply these once the UI lands. **After all of them are applied, delete
`lib/scoutingEconomy.ts`, the `SCOUT_ECONOMY` and `SCOUT_TIERS` blocks in
`lib/tuning.ts`, and the four `Team.scout*` columns in `prisma/schema.prisma`.**

### 5.1 `app/league/[id]/layout.tsx` — header tile

**Delete** the import (≈ line 10):
```ts
import { syncScoutingBudget } from '@/lib/scoutingEconomy';
```

**Delete** the `scouting` entry from the `Promise.all` (≈ lines 36–43):
```ts
    ctx.settings.scoutingEnabled === false
      ? Promise.resolve(null)
      : syncScoutingBudget(userTeam.id, league, ctx.settings).catch(() => null),
```
…and drop `scouting` from the `const [compliance, scouting, tickerTx] = await Promise.all([` destructuring.

**Delete** the whole `{scouting && ( … )}` block (the `Scouting {points}/{grant}`
header tile, ≈ lines 107–120).

**Replace it with** a workout-slot tile, which is the only scarce scouting
number left worth a permanent slot. Add the import:
```ts
import { loadWorkoutSlots } from '@/lib/workouts';
```
add to the `Promise.all`:
```ts
    ctx.settings.scoutingEnabled === false
      ? Promise.resolve(null)
      : loadWorkoutSlots(league.id).catch(() => null),
```
and render:
```tsx
{workouts && (
  <Link
    href={`/league/${league.id}/scouting`}
    className="hidden lg:block text-right px-4 hover:text-chalk transition-colors"
    title={workouts.windowLabel}
  >
    <div className="section-eyebrow leading-none">Workouts</div>
    <div className={`stat-value text-sm leading-none mt-1 ${
      !workouts.open ? 'text-muted' : workouts.remaining === 0 ? 'text-bad' : 'text-chalk'
    }`}>
      {workouts.remaining}<span className="text-muted">/{workouts.max}</span>
    </div>
  </Link>
)}
```

### 5.2 `app/league/[id]/scouting/page.tsx` — the whole page

This page's subject is the focus economy, so it needs rewriting rather than
patching. **Delete** the two imports:
```ts
import { syncScoutingBudget, scoutCost, periodKey, weeklyScoutingBudget } from '@/lib/scoutingEconomy';
import { SCOUT_TIERS, SCOUT_ECONOMY, LEAGUE, PROGRESSION, type ScoutTierKey } from '@/lib/tuning';
```
(keep `LEAGUE`/`PROGRESSION` if still used elsewhere on the page)

**Delete** `const budget = await syncScoutingBudget(...)`, `const period =
periodKey(league)`, the `SHORT` / `SCOUT_TIER_KEYS` consts,
`depthAlreadyBought`, `TIER_DEPTH`, `buildOptions`, the "Price list" section,
and every `<ScoutSpendRow>`.

**Replace with** three sections:
1. **The consensus board** — `buildConsensusBoard(prospects, { teams, rounds })`,
   showing rank, grade, band and the strongest bias chip per row.
   **[correction]** A row must ALSO show `positionPull`, or the page contradicts
   itself: `rank` orders by `boardScore`, so a grade-98 edge rusher sits above a
   grade-99 guard and the sort reads as broken. The shipped row carries a
   `▲ +2.0 slot (EDGE)` term next to the grade for exactly that reason.
2. **Your shortlist** — the starred players, `unitsEach` from the last
   attention pass, and each one's current confidence.
3. **Private workouts** — `loadWorkoutSlots(league.id)` for the count and
   window, and a target picker over the shortlist.

### 5.3 `components/ScoutButton.tsx` and `components/ScoutSpendRow.tsx`

Both exist only to spend focus. **Delete both files** and every usage. Replace
the player-page affordance with a shortlist star (already exists:
`components/ShortlistStar.tsx`) plus, in the workout window, a workout button
calling `runWorkoutAction(leagueId, teamId, playerId)` from
`app/actions/scouting.ts`.

### 5.4 `app/league/[id]/draft/page.tsx` — sort by the consensus

Currently sorts by `bigBoardScore(view.scoutedOvr, …)` (≈ lines 158–159), which
is a *team-specific* board dressed as a public one — two teams see different
"rank" numbers for the same prospect. **Replace** with the consensus rank:

```ts
import { consensusBoardMap } from '@/lib/consensus';

const consensus = consensusBoardMap(
  await prisma.player.findMany({
    where: { leagueId: league.id, draftYear: classYear },
    select: {
      id: true, position: true, trueOvr: true, potential: true,
      trueAttrs: true, collegeStats: true, combineTesting: true, injuryWeeks: true,
    },
  }),
  { teams: teamCount, rounds: settings.draftRounds },
);
// …then sort rows by consensus.get(p.id)!.rank ascending.
```
Query the class by `draftYear` **including already-drafted prospects**, so a
rank never changes because somebody else came off the board.

**[correction]** `classYear` is undefined in the snippet above, and the obvious
guess is wrong: `Player.draftYear` is stamped with the season the class was
GENERATED in, while the draft those men are selected in is the year after
(`imminentDraftYear`). Both shipped pages resolve the class by querying the
newest `draftYear` present and label the screen with `imminentDraftYear`.

`bigBoardScore` in `lib/gen/prospectProfile.ts` can then be deleted, along with
its `testingPercentileById` plumbing on that page.

### 5.5 `lib/season.ts` — the deprecated replenish (mine to remove, do it last)

`advanceWeek()` still calls `replenishLeagueScoutingBudgets`. It only exists to
keep the header tile in §5.1 coherent. Delete the call and the import once §5.1
lands. Marked with a `DEPRECATED CALL` comment in place.

### 5.6 `app/actions/scouting.ts`

`getScoutPanelAction`, `scoutPlayerAction`, `getScoutingBudgetAction` and the
`ScoutOption` / `ScoutPanel` / `ScoutResult` types are all `@deprecated` and
exist only to keep §5.1–5.3 compiling. Delete them with those call sites.

Note the `DEVELOP` tier went with them. Development Focus was the only thing
writing `Player.devFocus`, which `lib/development.ts` reads. Either drop the
`devFocus` multiplier from `lib/development.ts` or re-home the charge somewhere
that is not a focus-point purchase — **this is an open decision, see §6.3.**

---

## 6. HANDOFF — other follow-ups

### 6.1 Tuning constants are in the wrong file
`SHORTLIST_ATTENTION` (top of `lib/shortlistAttention.ts`), `WORKOUTS` (top of
`lib/workouts.ts`) and `CONSENSUS` (top of `lib/consensus.ts`) belong in
`lib/tuning.ts` with every other `[TUNE]` block. They are not there only
because `lib/tuning.ts` was owned by another workstream. Straight cut-and-paste.

Likewise `BASE_40` in `lib/consensus.ts` is duplicated from
`generateCombineTesting` in `lib/gen/prospectProfile.ts`, which keeps its copy
private. `publicAthleticism()` inverts that generator's formulas exactly, so
the two tables drifting apart would silently make the board misread testing.
Fix: `export const BASE_40` from `lib/gen/prospectProfile.ts` and import it.

### 6.2 The Dynasty scouting branch now has two effects
`dynastyThroughput()` derives a small (max +14%) shortlist-attention speed
bonus from `attrBandMult`/`potBandMult`. That branch already narrows displayed
ranges, so this is a second buff off one purchase. It is deliberately small and
it uses the published mods rather than re-reading the skill tree, but if the
branch turns out over-strong in playtest, **this is the first thing to cut** —
delete `dynastyThroughput` and its call site and nothing else changes.

The `SCOUTING_NETWORK` skill now also grants workout slots, but its blurb in
`lib/dynasty.ts` (the `SCOUTING_NETWORK` entry in `DYNASTY_SKILLS`) still only
mentions Full Scouts. Reword to:
> `More contacts, more access. Every GM starts each league year with 2 perfect evaluations and 5 private workouts; this buys more of both.`

…and add the workout count to its per-rank `effect` strings. `lib/dynasty.ts`
was not mine to edit.

### 6.3 `Player.devFocus` is orphaned
See §5.6. `lib/development.ts` (the `devFocus` branch, ≈ line 128) multiplies a development checkpoint
for a player carrying a `devFocus` charge, and the only thing that ever granted
one was the `DEVELOP` focus tier. Nothing in the new design grants it. Decide
between dropping the mechanic or re-homing it (a coaching-staff decision on the
roster screen would fit the "no currency" direction better than a scouting one).

### 6.4 Scouting your own roster / free agents no longer has a path
The old economy covered draft prospects, other teams' players and your own
roster from one pool. The shortlist only holds prospects. This is not a
regression the user asked to fix, but it is a hole: `SCOUTING.OWN_ROSTER_CONFIDENCE`
and `LEAGUE_VETERAN_CONFIDENCE` still give sensible defaults, so nothing breaks
— there is simply no longer a way to *improve* a read on a veteran short of a
Full Scout. Flagging it rather than inventing a mechanic nobody approved.

---

## 7. Schema

Two additions, both applied with `npx prisma db push --skip-generate && npx prisma generate`
against the dev database with no data loss.

```prisma
model ScoutingReport {
  workoutYear Int?          // nullable — genuinely absent on pre-existing rows
}

model DynastyProfile {
  workoutYear Int @default(0)
  workoutUsed Int @default(0)
}
```

`ScoutingReport.workoutYear` is nullable per the rule in the `startYear`
comment. The two `DynastyProfile` columns are non-null **with defaults**, which
`db push` adds to a populated table without complaint — that is the same shape
`fullScoutYear`/`insiderYear` already use, and the failure mode the `startYear`
comment describes is a required column *without* a default.

**The running dev server caches its `PrismaClient` on `globalThis` and needs a
restart to see these columns.**

---

## 8. Season hooks added

`lib/season.ts`, two lines:

1. `simulateWeek()` — `applyShortlistAttention(leagueId, seasonYear, week, seed)`
   after in-season progression, before the AI trade offer. Runs whether or not
   the user ever opened a scouting screen; advancing a week is not something
   you can do wrong.
2. `runOffseasonStep()` / `RESET_STANDINGS` — `resetWorkoutSlots(leagueId, seasonYear + 1)`.
   This is the one line in the phase machine where `seasonYear` actually moves.
   Strictly redundant (the year-stamped counter already reads as zero once the
   year turns) but it makes the number on screen turn over with the calendar
   instead of on the next spend.
