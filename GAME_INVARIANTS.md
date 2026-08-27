# Game Invariants

Rules about league state that must always hold, in any league, at any point in
its simulated history. These aren't aspirations — every rule below is
mechanically checked. Almost all of them live in `lib/invariants.ts`, and the
harness in `scripts/simHealth.ts` runs that check after every phase transition
across many simulated leagues and seasons. A rule that is a property of the
ARITHMETIC rather than of stored state cannot be read off a snapshot, so it
carries its own standalone harness instead and names it (INV-21, INV-22). And a
rule the SCHEMA enforces is not checked at all, because it cannot be violated:
a foreign key or a unique index makes the bad state unwritable rather than
detectable, and those rules say which migration is doing the work (INV-23,
INV-24).

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
- **INV-25** — Outside that same window, every club has at least one `ACTIVE`
  player at **every position its lineup actually fields** — every key of
  `STARTERS_AT_POSITION` in `lib/lineup.ts` with a non-zero count, kicker and
  punter included.

  INV-08 and INV-20 count a roster and cannot see the shape of one, and a
  roster of the right size with nobody at a position is exactly as unplayable
  as one nine men short. This codebase has lost the specialists more than
  once — cut-down day used to release a club's only kicker because the
  production score it ranked men by could not read a field goal (`6511cc3`) —
  and a head count is blind to that by construction.

  One man is the bar rather than the full starter count: a club with two of the
  three receivers it fields is thin, which is a football problem, and a club
  with none is broken, which is this document's problem. Checked against
  `STARTERS_AT_POSITION` rather than against a list written out here, so a
  position added to the lineup is covered the day it is added.

  Exempt in `OFFSEASON`, `RESIGN` and `FANTASY_DRAFT` for the same reason
  INV-20 is. The fantasy window is the extreme case: a league that opens with a
  fantasy draft has thirty-two EMPTY rosters by construction and fills them one
  pick at a time, so mid-draft this rule reported all thirty-two clubs missing
  all sixteen positions — a hundred per cent false-positive rate on a state the
  game creates deliberately. The rule that matters through that phase is
  INV-18, and it is exempt from nothing.

## Draft picks

- **INV-09** — `DraftPick.used === true` implies `playerId != null`.
- **INV-10** — `DraftPick.used === false` implies `playerId == null`.
- **INV-11** — No two `DraftPick` rows share the same
  `(leagueId, year, round, slot)`. A duplicate means two picks are pointing at
  one selection.

  This key used to carry `originalTeamId` as well, here and in
  `lib/invariants.ts`, which made the rule strictly weaker than it reads: two
  picks on the SAME slot with different origins satisfied it. The original team
  is provenance — which club's pick this once was, so a traded pick can say
  where it came from — and two picks may absolutely share an origin. No two may
  share a selection, because `currentPick()` resolves the clock with a
  `findFirst` on `(round, slot)`: of two picks sharing slot 26, one comes up
  and is paid slot 26's price and the other never comes up at all. Measured
  across 220 leagues and 177,408 pick rows, the old key found **zero**
  violations and the corrected key finds **six** — all real, all in one save,
  no false positives. Six clubs there never select, six rookie contracts are
  never written, and the draft ends short with nothing on screen saying why.
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
- **INV-29** — A player taken with a `DraftPick` whose `year` is the league's
  current `seasonYear`, who is still `ACTIVE` on the club that drafted him, is
  on a rookie deal: `isRookieDeal === true`, `years === CAP.ROOKIE_DEAL_YEARS`,
  and an APY between the league minimum and `CAP.ROOKIE_SCALE_R1_PICK1` plus a
  quarter.

  The bug this is shaped around actually shipped: the fantasy branch of
  `draftPlayer` handed out 1,696 players and wrote not one contract. INV-04
  caught THAT one, because those men were `ACTIVE` with nothing on file. It
  would not catch a contract written at the wrong SCALE, which is the other half
  of the same seam and the half a $360M preset came through.

  Only the current year's picks, and only men still on the club that drafted
  them: a rookie since cut, traded or extended is no longer on the deal the
  draft wrote, and holding him to it would flag ordinary roster management.

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
  - `scripts/checkFifthYearOption.ts`
    (`npx tsx scripts/checkFifthYearOption.ts`) — the same rule on the path that
    ADDS a year rather than replacing one. `exerciseFifthYearOption` appends a
    fifth season to a first-rounder's four-year rookie deal, and
    `prorationYears()` is derived from `years` — so pushing a 4-year deal to 5
    silently re-spreads a signing bonus that three already-played seasons have
    already been billed against. On pick 1.01's real rookie deal ($15.2M bonus)
    that is $17.5M of cap charged against $15.2M of cash, $2.28M invented by a
    move that is supposed to buy a year of football. The option year is
    therefore held OUTSIDE the proration window
    (`Contract.fifthYearOption`, read by `prorationYears`), which is also the
    real rule: no new signing bonus is paid for an option year.
    A database harness rather than a clause in `checkRestructure.ts` for the
    reason the tag's is: half of what must hold is not arithmetic. "The option
    year is fully guaranteed" is a claim about what a WRITE stores in
    `guaranteed`, which is read bonus-inclusive and filled EARLIEST YEAR FIRST —
    so adding the option salary to the stored figure spreads it over seasons he
    has already played and leaves the option year itself holding nothing, and
    dead money on a cut inside that year reads $0 against a fully guaranteed
    salary. Sweeps 56 shapes through the real functions against a real database,
    drives a release through `cutPlayer` and reads the charge back off the
    ledger, and holds nine clauses: conservation, the fourth-year hit unmoved to
    the dollar, the option year charging its salary and no proration, a real
    premium over the fourth year, the guarantee, a decline moving nothing at
    all, one answer per option, round one only enforced by the write path, and
    the three tier bands being the real CBA's.
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

- **INV-23 — every `CapCharge` belongs to a club that still exists.**
  Structural rather than checked: `CapCharge.teamId` is a foreign key with
  `onDelete: Cascade` (migration `20260823124600_cap_charge_team_cascade`), so
  a charge whose team is gone can no longer be written or left behind. It used
  to be a bare string with no key to anything, and deleting a league orphaned
  every dead-money row it held — 18,247 out of 22,203 on the dev database, five
  of every six charges in it. This is deliberately NOT a rule in
  `lib/invariants.ts`: that file checks one league at a time, and an orphan is
  by definition unreachable from any league. `scripts/pruneOrphanCapCharges.ts`
  cleared the rows that predated the constraint and re-running it is the
  assertion that nothing is producing new ones.

  **The cascade hangs off `Team`, not off `Contract` or `Player`, and that is
  the whole decision.** Dead money is *meant* to outlive the deal that created
  it — `cutPlayer` deletes the contract and books the charge in the same
  transaction — so a cascade from either of those would delete the bill along
  with the reason for it. A club's charges die only when the club does, and
  nothing in this game deletes a single team; only a whole league, which
  cascades into `Team` already. Expiry is unchanged and stays where it was:
  `expireStaleCapCharges` deletes by YEAR, once
  `settleClosingYearCapOverage` has rewritten whatever the closing year could
  not fund, and remains the only thing entitled to decide a charge has been
  paid.

## Championships

- **INV-24 — a title the save actually played names the men who won it, and a
  ring is read off that list rather than guessed at.**
  Structural rather than checked, for the same reason as INV-23 and one more:
  `ChampionRoster` (migration `20260823140000_champion_roster`) holds one row
  per man on the champion's roster at the instant the final ends, written by
  `snapshotSeasonHistory` in `lib/season.ts`. `@@unique([playerId,
  seasonYear])` is the rule and the idempotency key at once — a man is on one
  roster at a time, so he holds at most one trophy in a season — and the write
  uses `skipDuplicates`, so a re-entered offseason step cannot double a roster.
  All three foreign keys cascade: unlike a `CapCharge`, a championship roster
  leaves no bill behind when the league, the club or the man is deleted.

  **Written at the trophy because that is the last moment the roster exists.**
  Free agency, the retirement roll and the draft begin rewriting it three
  advances later, and nothing else in the database records who was standing on
  the field. 53 rows in 7ms on a measured league, once a league year, for the
  one club that wins it. `sim:health` produced one club a year and 47-53 rows
  apiece across its leagues, which is the shape.

  **This is deliberately NOT a rule in `lib/invariants.ts`, and the reason is
  the population it would fire on.** A title won before this table existed has
  no rows and never will; a checker demanding a roster for every `CHAMPION`
  season would report a violation on every existing save, for a season that was
  played correctly. Coverage is therefore asked per club-year, and `resolveRingYears`
  (`lib/gen/leagueHistory.ts`) is built on exactly that: a title year with rows
  is answered by them and by nothing else — no row means he did not win it —
  and a title year with no rows at all falls through to the `PlayerSeason` +
  ledger inference that predates the table, unchanged. Measured on one league
  driven to a real title by the game's own `advanceWeek`, read at the trophy, at
  the re-sign screen, and a full league year on after free agency, retirements
  and a draft — each window read twice, once with the rows and once with them
  deleted out from under the resolver, which is exactly the state of a save that
  won its titles before this table existed:

  |  | at the trophy | at Re-sign | a league year on |
  |---|---|---|---|
  | with the rows | 49/49 | 49/49 | **49/49** |
  | the inference alone | 49/49 | 49/49 | 46/49 |

  COVERAGE IS PER CLUB-YEAR, not per year, and that is one line of care rather
  than none: a year counts as covered only if every club the standings call
  champion that year has a roster written down. Normally one club wins it and
  the distinction is invisible. The state where it is not — two clubs carrying
  `CHAMPION` in one season, which a duplicated playoff bracket produced before
  `withRoundLock` closed it — is exactly the state where half a year of rows
  would tell a real champion's whole roster it had never won anything. Half
  covered falls through to the inference, which reads both clubs alike.

  0 false rings anywhere in either row. The men the inference loses are the ones
  it always said it could not reach: no counting stat in the title year AND
  since departed, so nothing places them on that roster and nothing contradicts
  it either (three here — a left tackle, a left guard and a back; d797a3a
  measured four on its own league). It is the last column that is the point — the ring stops decaying as the roster
  churns, because it stopped being inferred.

  **`PlayerSeason` could not have served, which is why there is a new table.**
  It is written from box-score lines, and a box score names the quarterback,
  three backs, six receivers, fourteen defenders and two specialists
  (`allocateStats`, `lib/sim/engine.ts`). Measured on the champion above: the
  box score named 32 of its 49 men and 17 had no row at all, including all ten
  offensive linemen — 0 of 10 — and every one of those seventeen is shown the
  ring from the table. d797a3a measured the same thing on its own champion: 31
  of 49 with a row, 0 of 10 linemen. REJECTED: writing zero-stat `PlayerSeason` rows
  for whole rosters instead. That is ~1,700 rows a league year against ~50, and
  it breaks that table's stated contract — *"which club did he PRODUCE for"* —
  which `buildGmTenureMen` (`lib/gmTenure.ts`) counts a GM's tenure off and the
  player page renders one row per. Every lineman in the league would collect an
  empty stat line every season.

## Numbers

- **INV-26** — No stored number in a league is non-finite, negative where it
  cannot be, or outside its legal band. Player age 15..60, experience `>= 0`,
  `trueOvr` and `potential` and every value in `trueAttrs` 0..99,
  `injuryWeeks >= 0`, `lastSeasonOvr` 0..99 when set; contract `years`,
  `signingBonus`, `guaranteed`, `voidYears` and every base salary `>= 0` and
  finite; team `wins`, `losses`, `ties`, `pointsFor`, `pointsAgnst` `>= 0`.

  **NaN and Infinity are the point, and they are harder to catch than they
  look.** An `Int` column rejects them at the driver, so they cannot be stored
  directly — but every rating in this game lives inside a JSON blob
  (`Player.trueAttrs`) and every salary schedule inside another
  (`Contract.baseSalaries`), and JSON has no NaN: `JSON.stringify(NaN)` is the
  string `"null"`. So a rating that went non-finite reaches the database as a
  null inside an otherwise valid attribute map, reads back as `undefined`, and
  turns every average computed from it into NaN with nothing on disk looking
  wrong. That is why the `Number.isFinite` tests are applied to the PARSED
  contents rather than to the columns.

- **INV-30** — Nothing in the database points at a league, club or player that
  no longer exists. Checked **database-wide rather than per league**, because
  that is what an orphan is: a row whose parent has been deleted is by
  definition not in a league any more, so no league-scoped query can ever see
  it. That is exactly how 18,247 orphaned `CapCharge` rows accumulated
  unnoticed — five of every six cap charges on the dev database — while every
  other rule here ran clean on every league in it.

  Most of these columns are foreign keys now and they are still checked: a rule
  the schema enforces cannot be violated by application code, but it can be
  violated by a migration that ships without its constraint, by a hand edit in
  psql, and by a `deleteMany` in a script that reaches a table the cascade does
  not. Four columns have no foreign key at all today — `Contract.teamId`,
  `TradeRecord.teamAId`/`teamBId`, `Transaction.teamId` — so for those this is
  the only check there is.

  `LeagueRecord.playerId` is deliberately excluded, and it is the one edge in
  the schema where a dangling id is correct: a seeded backstory's all-time
  record holders are LEGENDS who never played a down in the save and have no
  `Player` row by design, the column is not nullable, and `playerName` /
  `teamAbbr` are denormalised onto the row precisely so it still displays.
  Measured: 1,784 of 2,994 `LeagueRecord` rows, an even fourteen per league,
  which is every league on the dev database and a leak in none of them.

  In a shared database the reading that means anything is a DIFFERENCE.
  `npm run sim:health` takes the count before and after its run and reports only
  what its own leagues added.

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
- **INV-27** — For every season the save actually played, each club's stored
  `TeamSeasonRecord` satisfies `wins + losses + ties === ` the number of
  `played`, `kind: 'REGULAR'` games that club appears in for that year.

  `TeamSeasonRecord` is the only surviving copy of a finished season's
  standings — `RESET_STANDINGS` wipes `Team.wins` a few offseason steps later —
  so a record that does not add up is a standings table that will be wrong
  forever, on the History page and in every dynasty number derived from it.
  Regular-season games only: postseason results deliberately never touch
  `Team.wins` (see `simulatePlayoffRound` in `lib/season.ts`).

  Scoped to years at or after `League.startYear`. Every league is generated with
  a seeded backstory (`lib/gen/leagueHistory.ts`) that writes real
  `TeamSeasonRecord` rows for years BEFORE the league opened and no `Game` rows
  at all. That history is invented rather than simulated, and holding it to this
  rule would flag every league in the game on its very first step.
- **INV-28** — For every season the save actually played and finished (one that
  has a `CHAMPION` transaction), there is exactly one `CHAMPION` row, exactly
  one row of each type in `AWARDED_TYPES`, and at least one `ALL_STAR` row.

  Both directions matter and the second is the more dangerous. A season whose
  award pass threw, or whose field came back empty, leaves a year with no MVP
  and nothing anywhere saying so — the trophy screen simply has a gap in it and
  nobody notices until someone scrolls back six seasons. And
  `recordSeasonAwards` has no per-row guard, so anything that runs it twice
  writes a SECOND MVP for the same year and every count of a player's or a GM's
  honours silently doubles.

  A year with no champion at all is a season still being played, not a broken
  one, and is skipped. A year carrying the retired `AWARD_ROTY` is a year played
  before the rookie award was split in two, and is not held to `AWARD_OROTY` /
  `AWARD_DROTY`: 3,670 of those rows sit in saves on the dev database across 189
  leagues, and without that clause this rule reported 118 of 141 played
  league-seasons as missing both rookie trophies — a phantom bug, measured and
  discarded.

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
   **Since fixed, in the trade workstream:** `executeTrade` (`lib/trade.ts`)
   used to hard-code `year: opts.seasonYear` and never call `capChargeYear()`,
   so a trade made in the pre-roll OFFSEASON window filed against the year that
   was ending and was deleted unbilled. It now asks the function — the same
   call `cutPlayer` makes — so a change to how charges are dated needs no edit
   at that call site. Verified at OFFSEASON week 1 of 2026: the charge files
   against 2027, and the `CapCharge` table and `teamCapSummary` agree to the
   dollar.
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
8. **Two presses of Advance could run two CONSECUTIVE advances at once.**
   Every transition claims itself before it works — the offseason advance
   compare-and-sets `League.week`, the way out of `RESIGN` compare-and-sets
   `League.phase`, a playoff round takes `withRoundLock` — and all of that is
   correct. It guarantees *this advance runs once*; it never guaranteed *only
   one advance is running*. A claim writes the new week at the top of the
   work, so a second press arriving milliseconds later read the week the first
   had already moved, matched the claim for the NEXT advance, and ran it
   alongside. Reproduced on a clone of a save taken at `OFFSEASON` week 1 (so
   control and subject started byte-identical): press one claimed at +6ms and
   ran to +2,628ms, press two was made at +7ms and ran `ADD_DRAFT_CLASS` and
   `RESIGN` through to +5,853ms on top of a league whose players were still
   being aged and retired underneath it. The league came out at `RESIGN` week
   1 where one clean press leaves it at `OFFSEASON` week 4; 115 retirements
   became 102, and 663 transactions became 968. Not a regression from
   collapsing the offseason — before the collapse the same door was open four
   times instead of once.
   `advanceWeek` now takes a LEASE on the league for the whole advance
   (`League.advanceStartedAt`, migration
   `20260823124500_advance_in_progress_marker`) and a press that finds it held
   is refused. A timestamp rather than a boolean because the failure mode of a
   mutex must never be worse than the race: a flag left set by a request that
   was killed mid-advance is a save nobody can ever advance again, with no move
   inside the game that clears it. The lease is 90s — longer than any advance
   that can finish, since nothing here asks for a `maxDuration` above 60 and
   the heaviest measured single advance is under two seconds — so it is only
   ever stolen from a request that is already dead, and the per-step claims
   remain underneath it as the real lock. Re-measured after the fix: the second
   press is refused at +13ms, and the end state matches one clean press on
   every field.

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
