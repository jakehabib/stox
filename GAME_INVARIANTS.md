# Game Invariants

Rules about league state that must always hold, in any league, at any point in
its simulated history. These aren't aspirations — every rule below is
mechanically checked. Almost all of them live in `lib/invariants.ts`, and the
harness in `scripts/simHealth.ts` runs that check after every phase transition
across many simulated leagues and seasons. A rule that is a property of the
ARITHMETIC rather than of stored state cannot be read off a snapshot, so it
carries its own standalone harness instead and names it (INV-21, INV-22).

**Any change that touches core simulation logic (season flow, the draft,
trades, free agency, contracts/cap) should run `npm run sim:health` before
committing** — and any change to the stat allocator in `lib/sim/engine.ts`
should also run `npx tsx scripts/checkBoxScore.ts` (INV-22), which `sim:health`
does not cover: it reads league STATE, and a box score that does not add up is
perfectly valid state. A clean build and a passing `tsc` only prove the code compiles —
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
  Being in that state is no longer free, which is what stops it being a
  strategy: `settleClosingYearCapOverage` (`lib/season.ts`) writes whatever a
  club is still over the ceiling by when its season ends into the NEW league
  year as a `CapCharge`, so the escape buys time and never buys the money.
  Measured on 31 generated AI clubs at a season's close, none were over
  (median space $98.8M) — the rule is league-wide and only ever bites a club
  that got there deliberately.
- **INV-21 — rewriting a contract moves money, it never creates or destroys
  any.** Not a snapshot rule, so it is not in `lib/invariants.ts`: it is a
  property of the ARITHMETIC and of the WRITE PATHS, checked by two permanent
  harnesses, both of which exit non-zero on failure.
  - `scripts/checkRestructure.ts` (`npx tsx scripts/checkRestructure.ts`) —
    pure arithmetic, no database, swept across contract lengths 1-7, every
    year of each deal already played, four bonus sizes, void years 0-3 and
    every conversion amount from zero to past the league-minimum floor.
    Gates `restructureContract` and `buildExtension`.
  - `scripts/checkFranchiseTag.ts` (`npx tsx scripts/checkFranchiseTag.ts`) —
    the same conservation rule where it is not an arithmetic property at all.
    `applyFranchiseTag` deletes the old contract row, so the money it must
    answer for lives in a `CapCharge` the write path either books or does not;
    `unamortizedBonus()` returned the right figure the entire time it was
    being thrown away. So this one builds a throwaway league, sweeps 320
    contract shapes through the real function against a real database, reads
    the ledger back off `teamCapSummary`, and destroys the league after. A
    pure-arithmetic clause could not have caught that defect and could not
    catch its return — it would assert a formula against itself.
  - `scripts/checkReSign.ts` (`npx tsx scripts/checkReSign.ts`) — the same
    rule on the other path that deletes a contract row. `extendContract`
    replaces an expired deal outright, so what it strands is a `CapCharge` the
    write path either books or does not. Sweeps the same 320 shapes through
    the real function against a real database and holds each branch to its own
    rule: a REPLACE accelerates the unamortised bonus, an APPEND carries it
    into the new row and must therefore book nothing, and billing both would
    charge the same money twice. Reports 118 failures against the old
    behaviour.
  - `scripts/checkRestructureWrite.ts`
    (`npx tsx scripts/checkRestructureWrite.ts`) — the database sibling to
    `checkRestructure.ts`, for the half of the restructure that is not
    arithmetic. Sweeps 1,080 shapes and compares the row read back out of the
    database to the pure function's answer FIELD FOR FIELD, then to the
    consequence a GM actually sees (`deadMoneyOnCut`) and to the ledger
    `teamCapSummary` reports. Field-for-field on purpose: a check aimed at the
    one field that was dropped would pass the next drop. Reports 1,656
    failures against the old behaviour.

  Four clauses:
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
    to charge $291.2M against $130.8M paid. It holds through every OTHER
    rewrite too, and the franchise tag was the one that broke it: it deleted
    the contract and booked nothing, so a 3yr+2v deal that had paid a $12.0M
    bonus and billed only $7.20M of it charged the remaining $4.80M to
    nobody, ever, and tagging a $25.0M cap hit at $11.5M FREED the club
    $13.5M. Cutting the same man charges that bonus (`deadMoneyOnCut`) and
    trading him accelerates it onto the club giving him up (`tradeCapEffect`)
    — the tag was the only way in the game to make a bad deal evaporate. It
    now books the same `unamortizedBonus` as a `CapCharge`, dated by
    `capChargeYear()`, and the tag row itself still costs exactly the tag
    value: `franchiseTagValue()` averages the top-N `capHit()`s at the
    position, so a legacy bonus folded into that hit would price the next tag
    at that position off it.
    The re-sign was the other half of the same hole and is closed the same
    way. `extendContract`'s replace branch — the branch a walk-year re-sign
    takes — ran `contract.deleteMany` and booked nothing, so RE-SIGNING a man
    was the one exit from a contract that did not answer for the bonus already
    paid to him. Measured, four exits from the SAME expired 3yr+2v deal with a
    $13.5M bonus: walk $5.40M, cut $5.40M, tag $5.40M, **re-sign $0**. Which
    inverted the incentive the cap exists to create — keeping a man became
    strictly cheaper than losing him, and a void year became free money
    provided you remembered to re-sign the player it was borrowed against.
    Measured on that loop: a walk-year hit restructured from $33.2M to $9.04M
    with three void years added freed $24.1M and repaid none of it. It books
    the same `unamortizedBonus`, dated by `capChargeYear()`, priced into
    `assertCapRoom`, and named on the wire.
  - **WHAT THIS YEAR FREES, THE LATER YEARS REPAY, EXACTLY** — void years
    included, since bonus prorated across them is charged in one lump when
    the real deal ends. This is the sentence the restructure panel prints, so
    it is a promise to the user and not only to the ledger.
    A DYING LEAGUE YEAR CANNOT ABSORB THAT LUMP FOR FREE, which is the
    calendar half of the same clause and was the largest hole in it. Dead
    money is a one-year charge: `cutPlayer` files it against the year of the
    release and `expireStaleCapCharges` sweeps it at the roll — right for a
    club that HAD the room, since spending real cap space on a mistake is what
    paying for it means, and catastrophic for one that did not. Measured on a
    real league driven through the real roll, the same $74.6M albatross
    released on four clubs: PRESEASON wk1 $39.7M vanished, REGULAR wk4 $43.1M,
    PLAYOFFS wk19 $50.6M, and only the OFFSEASON wk1 case (already filed a
    year forward by `capChargeYear`) paid in full. The loop: restructure
    twelve men into bonus, bank the relief, release all twelve in the
    playoffs, and every dollar of proration owed to later years accelerated
    into a charge that midnight deleted.
    `settleClosingYearCapOverage` (`lib/season.ts`) closes it without touching
    the sweep: every dollar a club is over the ceiling when its season ends is
    written into the new league year as a real `CapCharge`. The OVERAGE and
    not the charge, deliberately — re-dating the dead money itself would bill
    a club with $80M of genuine space exactly as hard as one with none, and
    make a release in the last week of a comfortable season worse than the
    same release in the first. Uncapped, deliberately: a ceiling on the carry
    is a hole the exact size of the ceiling, it cannot be reached by accident
    (the advance gate already refuses a club that could cut its way back
    under), and it liquidates itself — any year a club spends less than the
    ceiling, the debt shrinks by the difference. It runs inside
    `ageContractsForYear`, which is the last moment the closing year's books
    can be read at all: one step later every cap hit has been rewritten into
    next year's terms.
  - **THE GUARANTEE STAYS IN THE SAME FRAME AS THE BONUS.** `guaranteed` is
    stored bonus-inclusive and is only ever read by subtracting the bonus back
    out (`guaranteedBaseByYear`), so any path that rewrites one must rewrite
    the other in the same transaction. `signExtension` and `executeTrade` do;
    the restructure write did not, which left `guaranteed - signingBonus`
    re-reading as salary still owed and put a measured $10.3M of invented dead
    money on a 5-year deal.
    `restructureContract` writes it inside its own transaction now. It was
    latent rather than live — `restructureContractAction` patched the figure
    back in a SECOND write, outside the library's transaction, and was the
    only caller — which is a worse state than a plain bug: the game was
    correct, the library was not, every new caller reintroduced it in full,
    and a failure between the two writes left a broken row with nothing on any
    screen to say so. Measured on one contract: stored $45.0M against a
    computed $28.7M, and dead money on a cut of $28.7M reading back as $45.0M.
    The patch in the action is gone.

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
- **INV-22 — a box score is an accounting document, and it balances.** Not a
  snapshot rule, so it is not in `lib/invariants.ts`: it is a property of
  `allocateStats` and `toTeamStats` in `lib/sim/engine.ts`, checked by a
  permanent harness that builds no league and touches no database —
  `npx tsx scripts/checkBoxScore.ts [leagues] [seasons]`, non-zero on failure.
  Six clauses, each an identity rather than a tuning target:

  - **Every yard thrown was caught by somebody.** League receiving yards equal
    league passing yards.
  - **The team column is the player column added up.** `teamStats.passYards`
    equals the passers' yards on that side, exactly — zero tolerance, because
    it is now literally the same sum.
  - **The yards in the box score are the yards the drives gained.**
  - **Every sack a defence recorded was taken by the other side's line.**
  - **Every interception thrown was caught by somebody.**
  - **Every touchdown pass was caught by somebody.**

  ALL SIX FAILED, and none of them was visible in one game. Over 240 replayed
  league-seasons before the fix: receiving yards ran 8.5% ahead of passing
  yards, because the backs were handed `rng.int(0, 40)` on top of the
  receivers' full share of the throw; the team pass-yard line missed the
  passer by 5%, because it was a flat 60/40 split of total yards unrelated to
  anything the players did; 19.6% of sacks, 4.7% of interceptions and 30.6% of
  touchdown passes reached no player at all, because those were dealt out by
  walking the roster flipping a coin at each name with a hard cap of one
  apiece. A 23-yard gap between what a passer threw and what his receivers
  caught reads as rounding on a Sunday; it is only a defect in aggregate, and
  that is why a harness and not a rule.

  Two clauses carry a deliberate tolerance and the file says why. Yardage is
  shared out by rounding each man's slice of a total, so a few yards a game go
  missing to rounding — the counting stats have no such excuse and are held to
  exactly zero. And the total-yards clause allows four yards a team-game
  against two known, separate warts left in place: `allocateStats` floors a
  team at 120 yards before splitting it, and an overtime drive is pushed into
  the drive list with 55 yards on it that are never added to the team's total.
  Both show up as the worst single reading the harness prints.

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

6. **A release or a trade made in-season was free (INV-21, third clause).**
   `capChargeYear()` files a charge against the current league year in every
   phase except OFFSEASON weeks 1-2, and `expireStaleCapCharges` hard-deletes
   every charge dated before the new year two steps after `RESET_STANDINGS`
   bumps it. So dead money raised in PRESEASON, REGULAR or PLAYOFFS could only
   ever be paid out of whatever space the club actually had, and the rest ran
   out of calendar. Measured on a real league driven through the real roll,
   the same $74.6M albatross released on four clubs: $39.7M, $43.1M and
   $50.6M vanished, and only the OFFSEASON wk1 case paid in full. The loop —
   restructure twelve men into bonus, bank the relief, release all twelve in
   the playoffs — laundered every dollar owed to later years into a charge
   midnight deleted. `settleClosingYearCapOverage` now carries the whole
   overage into the new league year; the same four cuts carry $17.1M, $20.5M
   and $28.0M forward and the loop erases $0.
   **Not fixed here:** `executeTrade` (`lib/trade.ts`) hard-codes
   `year: opts.seasonYear` and never calls `capChargeYear()` at all, so a
   trade made in the pre-roll OFFSEASON window still files against the year
   that is ending and is deleted unbilled. The carry-over covers the club that
   was over the ceiling; it does not cover the club that was not. One line,
   in a file another workstream owns.
7. **Going further over the cap switched the advance gate off, for free.**
   `capComplianceBlock` returns `null` — advance — when `!report.fixable`, and
   that escape is correct: a club whose dead money alone exceeds the ceiling
   must never be soft-locked. What was wrong is that it cost nothing.
   Measured: $50.8M over, blocked; ten releases later at $844.0M over with
   `maxCutRelief` $53.3M, the identical `advanceWeek` call ran the week, and
   the charges were swept at the roll. Reproduced at $978.6M over, carrying
   $0. The escape is unchanged and the price is new: the overage is settled
   into the next league year, so the same run now carries $978.6M forward. The
   Cap page, the standing over-cap banner and the front office brief all said
   "the week is still allowed to advance" and stopped there — three sentences
   that were true and read as *"and nothing happens"*. All three name the
   price now.

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
4. **Nothing enforces the roster *floor* either (the mirror of item 1) — and
   after measuring it, nothing should.** `LEAGUE.ROSTER_MIN` (46) is read by
   no signing, cut, draft or advance path, and `fillTeamsToRosterMinimum`
   filters `isUser: false` by design, so a user can carry 23 men through a
   whole offseason roll and bank the salary. The open question was whether the
   sim punishes that. It does, hard. Two leagues off the same seed, same
   schedule, same opponents, with the user's club stripped to its best 24 men
   and the players removed WITHOUT `cutPlayer` so the only variable is
   football: offense 83.7 -> 79.7, defense 83.9 -> 77.6, a 12-5 season turned
   into 7-10, and a point differential of +114 turned into -55. About five
   wins — a playoff team turned into a spectator. `positionUnitRating`
   (`lib/sim/units.ts`) fills every empty depth slot at `REPLACEMENT_LEVEL`,
   and an injury on a short roster has nobody behind it.
   So the game already charges for this, and an advance gate would only take
   away a decision it is already pricing correctly. What it did not do was
   TELL anyone: INV-20 is a developer's warning on a screen a GM never opens,
   and the front office brief said only that his safeties looked thin. It
   names the shortfall now — silent through OFFSEASON and RESIGN, where every
   club in the league is briefly under the line by design. Still genuinely
   open: an AI "sign minimum-salary bodies up to the floor" pass, for the
   handful of CPU clubs that sit under 46 at their annual trough.
5. **Undrafted prospects accumulate in the free agent pool forever.**
   Each draft class adds `DRAFT_CLASS_SIZE + DRAFT_CLASS_EXTRA_UDFA` players
   and only ~224 are drafted; the remainder have `isDraftee` cleared at the
   end of DRAFT and become ordinary free agents. `progressAllPlayers` only
   ages `status: 'ACTIVE'` players, so they never age, never retire and never
   leave. A nine-season measured run ends with ~2,500 free agents. This is a
   progression/aging gap rather than a contract one, so it was left alone
   here, but it is what makes the free agent list unreadable late in a
   dynasty.
6. ~~**The franchise tag deletes a contract without booking its unamortised
   bonus (INV-21, second clause).**~~ **FIXED.** `applyFranchiseTag` ran
   `contract.deleteMany` and wrote a fresh one-year row while nothing booked a
   `CapCharge` for the bonus the old deal had not finished amortising, so
   tagging a man made that money vanish where cutting him would charge it and
   trading him would accelerate it onto the club. Measured on a throwaway
   league before the fix: a 3yr+2v deal with a $12.0M bonus lost $4.80M, and
   tagging a $25.0M cap hit at $11.5M did not cost $1.50M, it FREED $13.5M.
   The tag now books `unamortizedBonus` as a `CapCharge` — the bonus only, the
   same split `tradeCapEffect` makes, because the guaranteed base salary is not
   escaped but REPLACED by the tag, which is itself fully guaranteed and
   charged in full on the new row — dated with `capChargeYear()`, priced into
   `assertCapRoom` so the gate sees it, and named on the wire and on the
   Re-sign screen before the button is pressed. Gated by
   `scripts/checkFranchiseTag.ts`, which reports 691 failures against the old
   behaviour.

   ~~**Still open, same family:** the replace branch of `extendContract` has a
   smaller version of the same hole.~~ **ALSO FIXED**, and it was not smaller.
   It runs at `yearsRemaining === 0`, where what is left to lose is whatever
   the void years still hold — and a void year is a slider a GM can move.
   Measured on the same expired deal, four exits: walk $5.40M, cut $5.40M, tag
   $5.40M, re-sign $0; and on the loop it opened, a walk-year restructure with
   three void years added freed $24.1M and repaid none of it. Booked now,
   dated by `capChargeYear()`, priced into `assertCapRoom`, named on the wire.
   Gated by `scripts/checkReSign.ts`, which reports 118 failures against the
   old behaviour.
7. **The restructure wire entry quotes the amount REQUESTED, not the amount
   converted.** `restructureContract`'s transaction detail is built from
   `opts.convertAmount`; the pure function clamps that against the
   league-minimum floor. A probe asking to convert $999,999,999 left
   "Converted $1000.0M of base salary to bonus" on the league wire against a
   conversion of a few million. The same rows carry `playerId: null`, so
   nothing on the wire links a restructure back to the man it happened to.
