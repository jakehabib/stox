# Game Invariants

Rules about league state that must always hold, in any league, at any point in
its simulated history. These aren't aspirations — every rule below is
mechanically checked. Almost all of them live in `lib/invariants.ts`, and the
harness in `scripts/simHealth.ts` runs that check after every phase transition
across many simulated leagues and seasons. A rule that is a property of the
ARITHMETIC rather than of stored state cannot be read off a snapshot, so it
carries its own standalone harness instead and names it (INV-21).

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
- **INV-07** — An `isDraftee` player should never fall more than one game-year
  behind the league's current `seasonYear`. A freshly generated class always
  carries `draftYear === seasonYear - 1` for a long stretch (it's generated a
  full game-year before its own draft actually runs, since `RESET_STANDINGS`
  bumps `seasonYear` forward well before that class reaches its `DRAFT`
  phase) — that's expected, not a violation. Anything older than that is a
  prospect nothing ever drafted, still sitting in limbo.
- **INV-08** — A team's active roster (`status: 'ACTIVE'` players with that
  `teamId`) should not exceed `settings.rosterMax` (default 53). See **Known
  violations** — nothing currently enforces this.
- **INV-20** *(warning)* — Outside the offseason window in which contracts
  expire and free agency has not yet opened, no team's active roster falls
  below the roster minimum for the league's configured ceiling
  (`rosterMinFor(settings.rosterMax)` in `lib/tuning.ts`, 46 of 53 by
  default). A team below it is fielding an illegal roster.
  Warning rather than error, and skipped during `OFFSEASON`/`RESIGN`, because
  a legal short roster genuinely exists there: every expiring contract has
  been released and free agency has not opened yet. AI teams refill at the
  first `fillTeamsToRosterMinimum` pass; a USER team below the line is the
  user's own call to make and the game never signs on his behalf, so this
  check reports it rather than acting on it.

## Draft picks

- **INV-09** — `DraftPick.used === true` implies `playerId != null`.
- **INV-10** — `DraftPick.used === false` implies `playerId == null`.
- **INV-11** — No two `DraftPick` rows share the same
  `(leagueId, year, round, slot, originalTeamId)`. A duplicate means pick
  generation ran twice for the same slot.
- **INV-12** — Any `DraftPick` from a season year strictly before the
  league's current `seasonYear` is `used === true`. A pick's `year` only ever
  equals the `seasonYear` at the moment its draft actually runs, so once the
  league has moved past that year, that draft has definitely already
  happened — every pick from it must have been consumed. (Deliberately not
  keyed off `DraftState.complete` — that flag has no year of its own and
  stays stale-true long after the season it belonged to has passed, which is
  exactly what made the original version of this check, keyed off the
  *current* `seasonYear`, a false positive against next year's not-yet-run
  draft — see **Known violations**.)

## Contracts & cap

- **INV-13** — `0 <= Contract.yearsRemaining <= Contract.years`.
- **INV-14** — `capHit()` for every active player's contract is `>= 0` under
  every cap mode. (This is exactly the class of bug a bad restructure preset
  produced earlier — a $3.6M offer read back as a $360M cap hit.)
- **INV-19** *(warning)* — When `capMode` is not `OFF`, no team's committed
  cap (active salary + dead money) exceeds that season's ceiling. Every
  acquisition path — signing, extension, franchise tag, restructure, trade,
  rookie deal — is gated by `assertCapRoom()` in `lib/capEnforcement.ts`, so
  a team over the ceiling means a path slipped the gate.
  Warning rather than error because one legal shape reaches it without any
  rule being broken: dead money already booked from cuts and trades can
  exceed what a roster is able to shed. That is the same case the
  advancement compliance block treats as unfixable and lets through, rather
  than trapping the user forever.
- **INV-21 — a restructure moves money, it never creates or destroys any.**
  Not a snapshot rule, so it is not in `lib/invariants.ts`: it is a property
  of the arithmetic, checked by its own permanent harness,
  `scripts/checkRestructure.ts` (`npx tsx scripts/checkRestructure.ts`, exits
  non-zero on failure), swept across contract lengths 1-7, every year of each
  deal already played, four bonus sizes, void years 0-3 and every conversion
  amount from zero to past the league-minimum floor. Four clauses:
  - **A ZERO-DOLLAR RESTRUCTURE IS A NO-OP.** Convert nothing and this year's
    cap hit, every remaining year's cap hit, and the dead money on a cut are
    all unchanged. Cheap to state, needs no expected values, and it is the
    clause that failed: `restructureContract` rebased a deal onto the years
    LEFT while carrying the FULL original signing bonus, so every dollar
    already amortised was charged a second time — a 5-year, $25.0M-bonus deal
    two seasons in went from $15.0M to $18.3M on a conversion of nothing, and
    $35.0M of cap was charged against a $25.0M bonus.
  - **TOTAL CHARGED EQUALS MONEY PAID.** Proration billed across a deal's
    whole life — the seasons played on the original plus the whole
    restructured remainder — equals the signing bonus actually handed over
    plus whatever base salary was converted into it. Holds however many times
    a deal is restructured: kicking the can every March on a 7-year deal used
    to charge $291.2M against $130.8M paid.
  - **WHAT THIS YEAR FREES, THE LATER YEARS REPAY, EXACTLY** — void years
    included, since bonus prorated across them is charged in one lump when
    the real deal ends. This is the sentence the restructure panel prints, so
    it is a promise to the user and not only to the ledger.
  - **THE GUARANTEE STAYS IN THE SAME FRAME AS THE BONUS.** `guaranteed` is
    stored bonus-inclusive and is only ever read by subtracting the bonus back
    out (`guaranteedBaseByYear`), so any path that rewrites one must rewrite
    the other in the same transaction. `signExtension` and `executeTrade` do;
    the restructure write did not, which left `guaranteed - signingBonus`
    re-reading as salary still owed and put a measured $10.3M of invented dead
    money on a 5-year deal.

  **The one documented exception, asserted rather than ignored.** A deal
  longer than `CAP.MAX_PRORATION_YEARS` stops amortising its bonus in year
  five while the contract runs on, so partway through it has more years left
  than bonus years left. A rebased contract's proration window is
  `min(years + void, 5)` counted from year zero, so a window SHORTER than the
  years left cannot be expressed and the carried money spreads over five years
  instead of three. Total and payback still hold exactly; only the per-year
  shape drifts, and only past the window. Do not "fix" that by carrying enough
  bonus to hold the per-year figure steady — that is exactly the double-charge
  above.

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
  on the clock — checked indirectly by INV-12: if any round's trade were
  still being ignored, some pick from a finished draft would be left unused.

## Known violations

Grounding these invariants in the actual code — not just the schema comments
— surfaced real bugs, and running the harness for real surfaced more,
including two in the checker itself. Recorded here so none of it gets lost.

### Fixed

1. **A completed rookie draft never transitioned the league out of `DRAFT`.**
   `draftPlayer()`/`advancePick()` correctly marked `DraftState.complete:
   true` once every pick was made, but nothing anywhere ever read that flag —
   `advanceWeek`'s `case 'DRAFT'` unconditionally returned "Draft is in
   progress" forever, and `'PRESEASON'` was never written as a phase value
   except at league creation. Every league was permanently stuck after its
   first draft, with no way to ever reach a second season — the "dynasty"
   this project is named for was unreachable. Fixed in `lib/season.ts` by
   checking `draftState.complete` in the `DRAFT`/`FANTASY_DRAFT` cases and
   transitioning to `PRESEASON` when true.
2. **Retirement never deleted the retiring player's `Contract` row.** Every
   other path off an active roster (cut, trade-away-then-cut, an unresigned
   expiring deal) deletes the contract; the offseason retirement roll never
   did. Fixed in `progressAllPlayers`.
3. **Draft turn order ignored trades past round 1 (INV-T2/INV-12).**
   `startRookieDraft` built a turn-order array from round 1's pick ownership
   and then reused that exact same array for every later round via
   `order[pickIndex % order.length]`. Rounds 2+ therefore always handed the
   turn to whichever team held that *slot in round 1's order*, regardless of
   who actually owned that round's pick — and `draftPlayer()` rostered
   whoever was on the clock unconditionally, so a team with no owned pick
   left in the round (having traded it away) still got the player for free,
   no contract, no pick consumed, while the team that acquired that pick
   never got an extra turn to use it. Fixed by having `currentPick()` resolve
   the exact `DraftPick` on the clock from live ownership for the current
   `(round, slot)` every time, and having `draftPlayer()` consume that exact
   row instead of independently re-searching for "any pick this team owns
   this round."
4. **Undrafted prospects never left the draft pool (INV-07).** Nothing ever
   converted a player who went undrafted back into an ordinary free agent —
   `isDraftee` was only ever cleared inside `draftPlayer()` for players
   actually selected, and the pool query in `pickBestAvailable` has no year
   filter of its own, so a leftover prospect kept resurfacing in every future
   year's draft board mixed in with the real new class, never aging (offseason
   progression only touches `status: 'ACTIVE'` players) and permanently
   excluded from normal free agency (which explicitly filters `isDraftee`
   out). Fixed by converting every remaining `isDraftee` player from the
   class that just finished drafting back into an ordinary free agent the
   moment `DRAFT` transitions to `PRESEASON`.
5. **Two false positives in the checker itself (INV-07, INV-12).** Both
   originally compared a stored year against the league's *current*
   `seasonYear` directly. That's wrong for anything whose year field is set
   *before* the game-year in which it's actually resolved (a class's
   `draftYear`, a `DraftPick.year`) — `RESET_STANDINGS` bumps `seasonYear`
   forward well before that cycle's own `DRAFT` phase runs, so for a long
   stretch every season both checks flagged the *current*, not-yet-processed
   cycle as if it were already-stale leftover data. Both now compare against
   a year that's unambiguously in the past instead (see each rule's text
   above for the exact reasoning) — a reminder that the verification tooling
   needs the same scrutiny as the systems it's checking.

Verified together with a `sim:health` run across several leagues, several
seasons deep each, landing at **0 violations**.

### Still open, not yet fixed

1. **No roster-size ceiling is enforced anywhere (INV-08).**
   `LEAGUE.ROSTER_MAX` / `settings.rosterMax` exist and default to 53, but
   they're only ever read at league generation time. Nothing in free agency,
   the draft, or trades checks a team's active roster count before adding to
   it, so a team's roster can grow without bound over a long-running league.
   The harness hasn't actually triggered this yet in a short run — flagged
   here as a gap to watch as `sim:health` gets run for longer stretches.
2. **The `FANTASY_DRAFT` completion condition looks suspect.**
   `advancePick`'s fantasy branch marks the draft complete once
   `pickIndex >= order.length` — i.e. after one single pass through all 32
   teams' turns — but a fantasy draft is meant to fill every team's entire
   roster from a shared blank-slate pool
   (`LEAGUE.TEAM_COUNT * LEAGUE.ROSTER_MAX + 120` players are generated for
   it), which needs far more than one turn per team. Not yet investigated or
   fixed — `FANTASY_DRAFT` is an opt-in alternate league-start mode
   (`RANDOM_ROSTERS` is the default), so it hasn't been exercised by the
   `sim:health` harness, which always starts leagues with `RANDOM_ROSTERS`.
3. ~~**The salary cap never actually grows, so contracts outrun it
   (INV-19).**~~ **FIXED.** `League.startYear` now records the founding
   season (nullable in the schema so `prisma db push` can add it to an
   existing database without a force-reset), and everything reads it through
   `resolveStartYear()` in `lib/leagueYear.ts`, which derives and persists a
   value for saves created before the column existed — from
   `MIN(Transaction.seasonYear)`, since `createLeague` writes a week-0
   "founded" transaction and nothing ever deletes transactions. Both call
   sites (`lib/cap-summary.ts` and this file's INV-19 check) now pass it, so
   the ceiling actually compounds at 7%/yr and the two can never disagree.
4. **Nothing enforces the roster *floor* either (the mirror of item 1).**
   `LEAGUE.ROSTER_MIN` (46) is read by no signing, cut, draft or advance
   path. The contract-economy repair got AI rosters from a measured ~25
   players back to ~48 at their annual low point, but a handful of teams
   still sit under 46 at the trough, and nothing in the game says so. A
   phase-aware invariant (only meaningful once free agency has run) and an
   AI "sign minimum-salary bodies up to the floor" pass are the two obvious
   next steps.
5. **Undrafted prospects accumulate in the free agent pool forever.**
   Each draft class adds `DRAFT_CLASS_SIZE + DRAFT_CLASS_EXTRA_UDFA` players
   and only ~224 are drafted; the remainder have `isDraftee` cleared at the
   end of DRAFT and become ordinary free agents. `progressAllPlayers` only
   ages `status: 'ACTIVE'` players, so they never age, never retire and never
   leave. A nine-season measured run ends with ~2,500 free agents. This is a
   progression/aging gap rather than a contract one, so it was left alone
   here, but it is what makes the free agent list unreadable late in a
   dynasty.
6. **The franchise tag deletes a contract without booking its unamortised
   bonus (INV-21, second clause).** `applyFranchiseTag` in `lib/freeagency.ts`
   runs `contract.deleteMany` and writes a fresh one-year row; nothing books a
   `CapCharge` for the bonus the old deal had not finished amortising. The
   re-sign screen offers the tag at `yearsRemaining <= 1`, and a man with one
   year left still carries a year of proration — so tagging him makes it
   vanish, where cutting him would charge it and trading him would accelerate
   it onto the club. Every other path off a contract answers for that money;
   this one hands out free cap relief. The replace branch of `extendContract`
   has a smaller version of the same hole: it only runs at
   `yearsRemaining === 0`, where all that is left to lose is whatever the void
   years still hold.
7. **The restructure wire entry quotes the amount REQUESTED, not the amount
   converted.** `restructureContract`'s transaction detail is built from
   `opts.convertAmount`; the pure function clamps that against the
   league-minimum floor. A probe asking to convert $999,999,999 left
   "Converted $1000.0M of base salary to bonus" on the league wire against a
   conversion of a few million. The same rows carry `playerId: null`, so
   nothing on the wire links a restructure back to the man it happened to.
