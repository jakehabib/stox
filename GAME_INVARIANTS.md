# Game Invariants

Rules about league state that must always hold, in any league, at any point in
its simulated history. These aren't aspirations — every rule below is
mechanically checked by `lib/invariants.ts`, and the harness in
`scripts/simHealth.ts` runs that check after every phase transition across
many simulated leagues and seasons.

**Any change that touches core simulation logic (season flow, the draft,
trades, free agency, contracts/cap) should run `npm run sim:health` before
committing.** A clean build and a passing `tsc` only prove the code compiles —
they say nothing about whether a player can end up rostered with no contract,
or a draft pick can vanish. Only running the league forward and checking its
state catches that class of bug, which is exactly the class of bug that kept
turning up this project's most serious fixes (inverted trade AI, the draft
breaking past pick 32, RESIGN silently releasing everyone, a $360M contract
preset, AI free agency signing undrafted rookies).

Each rule has an ID so the doc and the checker code stay traceable to each
other — `lib/invariants.ts` reports violations by ID.

## Player status & roster membership

- **INV-01** — `status === 'ACTIVE'` implies `teamId != null`. An active
  player is always on some team's roster.
- **INV-02** — `status === 'FREE_AGENT'` or `status === 'RETIRED'` implies
  `teamId == null`. A player not on a roster is never still attached to a
  team.
- **INV-03** — `status` is always one of `ACTIVE | FREE_AGENT | RETIRED` in
  practice. The schema comment on `Player.status` also lists `INJURED` and
  `ROOKIE_POOL`, but no code path in this repo ever assigns them — injuries
  live on `injuryWeeks`/`injuryType` while `status` stays `ACTIVE`, and the
  rookie/draft pool is just `FREE_AGENT` + `isDraftee: true`. If either value
  ever shows up in a real league it means something wrote a status the rest
  of the code doesn't know how to handle.
- **INV-04** — `status === 'ACTIVE'` implies exactly one `Contract` row
  exists for the player, and `Contract.teamId === Player.teamId`. Being
  rostered without a contract means the player draws no cap hit and can't be
  cut, extended, or shown correctly anywhere that reads `player.contract`.
- **INV-05** — `status !== 'ACTIVE'` implies no `Contract` row exists for the
  player. A contract with nobody rostered to honor it is dead data at best,
  a phantom cap hit at worst.
- **INV-06** — `isDraftee === true` implies `teamId == null`. A draft-eligible
  prospect is never simultaneously on an active roster.
- **INV-07** — A player is draft-eligible only for the draft in the same
  `seasonYear` as its own `draftYear`. Once a league's `seasonYear` moves past
  a player's `draftYear` while that player is still `isDraftee: true`, it's a
  prospect nothing ever drafted, and nothing currently converts it back into
  an ordinary free agent — see **Known violations** below.
- **INV-08** — A team's active roster (`status: 'ACTIVE'` players with that
  `teamId`) should not exceed `settings.rosterMax` (default 53). See **Known
  violations** — nothing currently enforces this.

## Draft picks

- **INV-09** — `DraftPick.used === true` implies `playerId != null`.
- **INV-10** — `DraftPick.used === false` implies `playerId == null`.
- **INV-11** — No two `DraftPick` rows share the same
  `(leagueId, year, round, slot, originalTeamId)`. A duplicate means pick
  generation ran twice for the same slot.
- **INV-12** — Once a rookie draft's `DraftState.complete` is `true`, every
  `DraftPick` for that draft's year is `used === true`. A draft can't finish
  with picks still on the board.

## Contracts & cap

- **INV-13** — `0 <= Contract.yearsRemaining <= Contract.years`.
- **INV-14** — `capHit()` for every active player's contract is `>= 0` under
  every cap mode. (This is exactly the class of bug a bad restructure preset
  produced earlier — a $3.6M offer read back as a $360M cap hit.)

## Games

- **INV-15** — A `Game` with `played === true` has `homeScore >= 0`,
  `awayScore >= 0`, and a `boxScore` that parses to a non-empty object.

## Season / phase flow

- **INV-16** — `League.phase` is always one of the declared phase-machine
  values (`PRESEASON | REGULAR | PLAYOFFS | OFFSEASON | RESIGN | FREE_AGENCY
  | DRAFT | FANTASY_DRAFT`).
- **INV-17** — During `REGULAR`, `1 <= League.week <= settings.seasonLength`.
- **INV-18** — If `DraftState.complete === true`, `League.phase` is not
  `'DRAFT'` or `'FANTASY_DRAFT'` — regression guard for the stuck-at-DRAFT
  bug below. (Checked after the harness calls `advanceWeek` once more to let
  the transition actually run; a completed draft still showing `DRAFT` right
  before that call is expected, not a violation.)

## Transition invariants (checked across a step, not from one snapshot)

These can't be checked from a single point-in-time read — the harness checks
them by comparing state immediately before and after the relevant
`advanceWeek` call.

- **INV-T1 (stats roll-up)** — When a season's stats roll into career totals
  (`RESET_STANDINGS`), the league-wide sum of every counting stat
  (`passYds`, `rushYds`, etc.) moves entirely from `seasonStats` into
  `careerStats` — nothing is lost or double-counted.
- **INV-T2 (draft turn order)** — Every `draftPlayer()` call consumes exactly
  one `DraftPick` owned by the team taking the turn, for the round currently
  on the clock. See **Known violations** — this one currently does not hold
  past round 1.

## Known violations

Grounding these invariants in the actual code — not just the schema comments
— surfaced real bugs. They're recorded here so the harness has something
real to confirm on its first run, and so none of them get lost.

### Fixed while writing this document

**A completed rookie draft never transitioned the league out of `DRAFT`.**
`draftPlayer()`/`advancePick()` correctly marked `DraftState.complete: true`
once every pick was made, but nothing anywhere ever read that flag —
`advanceWeek`'s `case 'DRAFT'` unconditionally returned "Draft is in
progress" forever, and `'PRESEASON'` was never written as a phase value
except at league creation. Every league in the game was permanently stuck
after its first draft, with no way to ever reach a second season — the
"dynasty" this project is named for was unreachable. Fixed in `lib/season.ts`
by checking `draftState.complete` in both the `DRAFT` and `FANTASY_DRAFT`
cases and transitioning to `PRESEASON` when true. Verified with a scripted
run that auto-drafted every pick and confirmed a league now cycles through
five consecutive season years without stalling.

### Still open, not yet fixed

1. **Draft turn order ignores trades past round 1 (INV-T2).**
   `startRookieDraft` builds the pick-order array from round 1's actual pick
   ownership (correct — trades on round 1 picks are respected), but
   `currentPick()` reuses that exact same array for every later round via
   `order[pickIndex % order.length]`. Rounds 2+ therefore always hand the
   turn to whichever team held that *slot in round 1's order*, regardless of
   who actually owns that round's pick. Worse, `draftPlayer()` rosters
   whoever's on the clock unconditionally — if the team on the clock doesn't
   own an unused pick in the current round (e.g. they traded it away), it
   still gets the player, ACTIVE, with **no contract created and no pick
   consumed** (violating INV-04 the moment this happens). Meanwhile a team
   that *acquired* extra picks in a later round never gets an extra turn to
   use them — those picks just sit `used: false` forever, which INV-12 will
   catch once a draft with a multi-round pick trade in it runs to
   completion.
2. **Undrafted prospects never leave the draft pool (INV-07).** Nothing ever
   converts a player who goes undrafted back into an ordinary free agent —
   `isDraftee` is only ever set to `false` inside `draftPlayer()`. The draft
   pool query in `pickBestAvailable` also doesn't filter by `draftYear`, so
   a prospect who goes undrafted in year 1 stays eligible — and keeps
   showing up mixed in with genuinely new rookies — in every future year's
   draft board, never ages (progression only runs on `status: 'ACTIVE'`
   players), and is permanently excluded from normal free agency (which
   explicitly filters out `isDraftee: true`).
3. **No roster-size ceiling is enforced anywhere (INV-08).**
   `LEAGUE.ROSTER_MAX` / `settings.rosterMax` exist and default to 53, but
   they're only ever read at league generation time. Nothing in free agency,
   the draft, or trades checks a team's active roster count before adding to
   it, so a team's roster can grow without bound over a long-running league.

None of these are fixed yet — they're logged here as the harness's first
real findings, to be triaged and fixed as their own follow-up work.
