# PART 2 — The Season, the Simulation, and Player Development

This part specifies the clock, the football, and the way players get better and
worse. It is a behavioural specification: every constant below is read out of
the live implementation, every number carries the reason it is that number, and
where the reason was a measured failure the measurement is reproduced so you do
not have to rediscover it.

Read §1 and §10 before writing any code. §1 contains two rules that this
codebase broke eleven times between them; §10 is the quality gate that catches
the rest, and it has to exist before the engine does, not after.

---

## 1. Two standing rules, and the order to build in

### Rule 1 — never fix a distribution with a hard `clamp`

Truncating a random draw does not cap its tail. It **piles** the tail onto one
value, which makes the most extreme outcome the most *common* outcome at that
end. Seven instances of this were found and removed from this codebase. The
seventh is the one to keep in mind because it is the smallest:

A receiver's per-game catch rate is drawn `N(0.62, 0.08)` and was truncated to
`[0.35, 0.85]`. Measured over four million draws:

| bucket | share of draws |
|---|---|
| 0.83 | 0.172% |
| 0.84 | 0.153% |
| 0.85 | **0.249%** |

A clean monotone decline, then a step back **up** at the wall. The most extreme
catch rate in the game was also the most frequent one.

The replacement is a **soft bound**, and you must implement it as a shared
helper so the eighth instance is caught by reading rather than by rediscovery:

```
softBound(v, mean, sd, lo, hi, core = 2):
    if sd <= 0: return clamp(v, lo, hi)
    z = (v - mean) / sd
    if |z| <= core: return v                 # untouched core
    dir  = sign(z)
    edge = mean + dir * core * sd
    room = |(dir > 0 ? hi : lo) - edge|
    if room <= 0: return clamp(edge, lo, hi)
    return edge + dir * room * tanh(((|z| - core) * sd) / room)
```

Properties that matter and must hold in your implementation:

- `core = 2` leaves **95.4%** of draws bit-identical to the raw normal.
- The taper is C-1 continuous at the join: `tanh`'s slope there is exactly the
  slope of the untouched line, so there is no visible kink.
- The bound is **approached and never reached**. Each further sigma buys
  strictly less movement than the one before.
- It consumes **no randomness of its own** — it transforms a value already
  drawn. When this shipped, every score across 3,264 simulated games hashed
  identically before and after (same SHA-256, same 148,179 points); only the
  extreme tail thinned, highest catch rate seen 0.900 → 0.889.
- Do **not** widen `core`. At 2.5 sigma the leftover headroom is too thin to
  absorb the tail and the pile-up simply reappears one bucket inside the bound
  (measured: 0.84 back above 0.83).

A hard `clamp` is still correct where it is a **safety rail rather than a
shaping device** — a bound that must not be crossed for structural reasons and
that the distribution never approaches in play. The play-call pass rate's
`[0.25, 0.85]` rail is the example: the realised draw has sd 0.0466 about
0.5725, so the rails sit past six standard deviations and over 20,000 draws
nothing came within 0.10 of either. They exist so a pathological value can
never produce negative rush attempts. State in a comment, at every clamp you
keep, which of the two it is.

### Rule 2 — never sort a mixed-position pool by overall

A kicker's overall is computed from kicking attributes against a scale every
other position outscores; specialists additionally carry a flat −5 generation
penalty. **A kicker is low by construction**, so he sits near the bottom of any
league-wide rating sort.

The incident: a fantasy draft board was built as
`orderBy: { trueOvr: 'desc' }, take: 60`. In a 1,956-man pool the best kicker
was **141st** and never appeared on any board. Clubs opened the season unable to
field a lineup — *DEN has nobody at K/P. DAL has nobody at QB/K/P. CHI has
nobody at K.* — **638 club-readings** of a missing position across one season in
one league, 775 in another. It is not only specialists: over twelve real pools,
seven were missing at least one whole position from their top sixty, one of them
**quarterback**. The fix is a board that is a column per position (best twelve
at each), plus a last-picks rule that spends a club's final selections on
positions it has nobody at. Same seed, same league, one season: **638 before,
22 after**.

The same defect has a second home: cut-down day sorts the roster by a
rating-and-dead-money score to decide releases. Blind to position by design —
a sixth quarterback surviving over a thin room is a bloat problem, not that
function's — **except** that a one-man job has no second body to absorb the
loss. 113 clubs in the dev database were carrying fifty or more men and no
kicker. Protect the **last man at a one-man job** by sorting protected ids last,
and still cut him when there is nobody else left to cut.

Generalise both: any time you rank a pool that spans positions, the ranking has
to be **within position** or **per-position quota**, never a single global sort
on a cross-position quantity.

### Build order

1. **The invariant checker and the soak harness first (§10).** This is not
   advice. Four of this project's most serious defects — an inverted trade AI,
   a draft that broke past pick 32, a `RESIGN` step that silently released
   every player in the league, a $360M contract preset — were found only by
   running leagues forward and checking state. A clean `tsc` proves nothing
   about whether a player can end up rostered with no contract.
2. The game engine (§3) and the box-score balance harness (§10, INV-22).
3. The phase machine (§2) with its concurrency claims (§2.6).
4. Statistics, standings, playoffs, the draft order (§4, §5).
5. Awards (§6) and progression (§7).

---

## 2. The phase machine

### 2.1 The states

```
FANTASY_DRAFT ──┐                           (one-time, league start only)
                ▼
             PRESEASON ──► REGULAR ──► PLAYOFFS ──► OFFSEASON ──► RESIGN
                 ▲                                                   │
                 └──────── DRAFT ◄──── FREE_AGENCY ◄─────────────────┘
```

`League` carries `phase`, `week`, `seasonYear`, plus the bookkeeping columns
`contractsAgedYear`, `resignWarnedYear`, `startYear`, `advanceStartedAt`,
`userTeamId`. `week` is a 1-based counter whose meaning depends on the phase:
regular-season week, playoff round, free-agency week, or **index into the
offseason step list**.

`advanceWeek(leagueId)` is the single entry point that moves time. It performs
**exactly one phase step** and returns a summary of what happened. Never write
a server-side loop over weeks (§2.5).

### 2.2 What each phase does

#### PRESEASON — one step, then straight to `REGULAR` week 1

On entry (i.e. when the step runs), in order:

1. **Seed next year's draft class** if one does not already exist for
   `seasonYear` (guard on a count of draftees with `draftYear === seasonYear`,
   because league creation already seeds year one's class). The class is added
   **a full game-year before its own draft** so it can be scouted all season.
   This is why a draftee legitimately carries `draftYear === seasonYear - 1`
   for long stretches — see INV-07.
2. **Reset private workout slots** for `seasonYear`. Deliberately here and not
   at the league-year roll: workouts are budgeted against a *college class*,
   and the class on the board at the roll was assembled last September and will
   not be drafted until the offseason is over. Refilling at the roll would hand
   a GM ten workouts against one class. Idempotent.
3. **Build this season's schedule** if absent (`ensureSeasonSchedule`,
   idempotent). Preseason is the right gate because it is the last phase before
   `REGULAR` on every path into a new league year. The original implementation
   built a schedule only at league creation, so **every season after the first
   played no football at all**: weeks advanced, the toast read "0 games played",
   and nothing said anything was wrong.
4. **Camp signings** — one in-season signing pass, phase `PRESEASON`. The wire
   does not close when free agency does; a club with a hole fills it in August,
   and the men still unsigned in August are cheaper than they were in April.
   One or two clubs, only when they have a real hole.
5. **Auto-sort every AI club's depth chart.** Here and not at the offseason
   `PROGRESS` step: `PROGRESS` is where ratings move, which looks like the
   natural home, but four more offseason steps of roster churn happen after it
   and the chart would be stale by the opener. Cost: once a league year,
   92–159ms on a nine-season league. **The user's chart is never touched.**
6. **Drop orphan depth-chart rows** for every club including the user's — rows
   naming men who retired, whose contracts expired, or who went in final cuts.
   Those three are the only roster moves in the game that do not run the
   per-player chart reconciliation, because they move a hundred players at
   once. Delete-only, therefore safe on a hand-set order.
7. Set `phase = REGULAR, week = 1`.

User obligation: none. This step asks nothing.

#### REGULAR — one step per week, `week` 1..`settings.seasonLength` (default 17)

See §2.4 for the week's full ordering. User obligation: none required; the
screens he *may* use are the depth chart, trades, in-season free agency, and
the shortlist.

On the step where `week + 1 > seasonLength`:

- **Select and record All-Stars** (§6.5), then
- **Seed the playoffs** (§5.2) and set `phase = PLAYOFFS, week = 1`.

Note the week counter is **not** advanced into `seasonLength + 1`; the playoff
seeding writes the phase and week itself.

#### PLAYOFFS — one step per round

Each step plays every unplayed non-`REGULAR` game for `seasonYear`, then
determines which round just completed and builds the next one. Round kinds in
order: `WILDCARD` → `DIVISIONAL` → `CONFERENCE` → `FINAL`. The round-completion
test reads the set of **played** non-regular games **for this season year**.
Both filters are load-bearing:

- Without `seasonYear`, last year's `FINAL` is still in the set, the
  wild-card branch's "divisional not yet played" test is false on the very
  first postseason game of year two, and control falls through to "final
  played" — **a champion crowned straight out of the wild-card round, for
  every season after the first, forever.** Measured on the dev database: one
  save played a full bracket in 2026 and then wild-card-only in 2027 through
  2034 — eight seasons of one-round playoffs and eight fake champions.
- Without `played`, the next round's unplayed rows already exist by the time
  the following advance reads this, so the set reports a round complete before
  it kicked off.

Postseason results **never touch** `Team.wins/losses/ties/pointsFor/
pointsAgnst`. They used to, which produced "2026 Champions (19-1)", 20-game
division tables, and a title-winning team displayed third in its own division.
Playoff results live on the `Game` rows and on `TeamSeasonRecord.playoffResult`.

After the `FINAL` is played, the final step does, in this exact order:

1. `snapshotSeasonHistory` — freeze `TeamSeasonRecord` for every club, write
   the `CHAMPION` news row, and write one `ChampionRoster` row per man on the
   winning roster (§5.4).
2. `recordSeasonAwards` — compute and persist the six trophies, and apply each
   winner's rating bump (§6).
3. `stampLastSeasonOvr` — write every player's current `trueOvr` into his
   season row. **This is the last instant `trueOvr` still means "what he was
   this season"**: the awards have just paid their bumps, and nothing has aged,
   retired or rolled offseason development onto anybody yet. One UPDATE for the
   whole league, everyone included whether or not a box score ever named him —
   which is what lets the player card's year-over-year chip work at every
   position instead of only the ~26 a club that turn up in one.
4. `fireStrugglingCoordinators` — AI clubs only (§2.7).
5. **`ageContractsForYear(seasonYear + 1)`** — the contract ledger steps onto
   the next league year **here, at the final whistle**. §2.3 is about this.
6. Build the week report and trophy payload (while the league is still standing
   in the season being described), then set `phase = OFFSEASON, week = 1`.

#### OFFSEASON — five steps, **one** press of Advance

The step list, in order, with `League.week` as a 1-based index into it:

| week | step | what it does |
|---|---|---|
| 1 | `PROGRESS` | age/develop/retire every rostered player; age/develop/retire every unsigned player |
| 2 | `RESET_STANDINGS` | recompute AI competitive windows; roll season stats into career; check league records; wipe standings; **`seasonYear += 1`** |
| 3 | `AGE_CONTRACTS` | idempotent catch-up call to `ageContractsForYear`; expire stale cap charges |
| 4 | `ADD_DRAFT_CLASS` | extend the rolling future-pick horizon to `seasonYear + 3` |
| 5 | `RESIGN` | AI re-sign wave + franchise tags; AI fifth-year option decisions; `phase = RESIGN, week = 1` |

All five are grouped into **one advance**. It used to be one step per press,
which put six presses between the final whistle and free agency, four of them
asking the user nothing. The owner: *"thats so many advances, we need to combine
some of these"*, then *"ideally i'd like post super bowl to free agency to be 3
advances"*, then *"I also think housekeeping only needs to be 1 stage."*

`League.week` still counts **steps, not presses**, and that is deliberate:

- the cap system's "which league year does a charge belong to" boundary is
  defined as "the offseason week whose step rolls `seasonYear`", i.e. week 2,
  and keeps both its meaning and its value;
- a save left mid-offseason by an older one-step-per-press build resumes at
  exactly the step it stopped on and is grouped from there;
- a step that throws leaves the week **on the step that failed**, so steps
  already committed are never re-run.

So a league under this build reads week 1 → week 4 → `RESIGN`. Weeks 2 and 3
are real and are passed through rather than stopped on.

One press runs "the remainder of the advance the current step belongs to",
clamped so a save somehow past the end of the list re-runs the last step rather
than reading off the end.

**The league row is re-read between steps**, because `RESET_STANDINGS` moves
`seasonYear` underneath the three steps after it, all of which take it as an
argument and mean the new one. `week` is overridden with the step's own index
rather than the claimed one, so each step sees the week it would have seen as a
press of its own — that is what the `RESIGN` wave stamps its transactions with.

The five step summaries are **joined into one paragraph**. Each states its own
fact plainly and does not repeat the ones before it: read alone they are whole
sentences, read together they are a report rather than five receipts. This is
the only record the user gets that any of it happened.

User obligation: none.

#### RESIGN — the user's window

Entry condition on the step: before anything else, a **once-per-league-year
warning** that stops time. A roster must not lose two thirds of itself in one
click without the user being told first — one measured save went from 37 active
players to 14 in a single step with nothing on screen beforehand.

The warning fires when players are walking (`yearsRemaining === 0`) **and**
either:

- the roster after they walk falls below `rosterMinFor(settings.rosterMax)`
  (46 of 53 by default), or
- **anybody the user explicitly set aside** in the negotiation list is one step
  from free agency.

The second clause exists because the re-sign list grew a "not now" control so a
twenty-deep list could be triaged, which opened exactly one trap: park twelve
men, advance, and they all walk having done what the button implied was safe.
The **same** warning is widened rather than duplicated — two blocking messages
competing for one Advance would be worse than none — and it **names** the parked
men (top three by rating, "and N more"), says how many of them are starters
(depth-chart rank 0, the table the screen renders, not a rating guess), and says
*"'Not now' was never 'let him go', and this is the last screen where that is
still true."*

The warning is stamped into `League.resignWarnedYear` so it fires **exactly
once per league year**. Letting a class walk is a real decision a GM is allowed
to make; being ambushed by it is not.

The second press claims the transition (§2.6) and then:

1. Price what comes off the **user's** books before the men are gone — read
   first, because afterwards there is no contract left to price. An expiring man
   is charged his final year's number until this window shuts, and the moment it
   does that charge is gone. This was the largest single move in the user's cap
   position and **nothing said so**; measured, this step took one club from
   −$8.8M to +$2.5M, four men, $11.3M, while the summary talked only about the
   league-wide pool. A number that improves by eight figures unannounced reads
   as a bug whether or not it is one.
2. Release every expiring contract that was not re-signed.
3. **Mint fringe free agents** — the several hundred camp bodies a real
   offseason always has. Runs *before* the roster fill below on purpose: that is
   what the short clubs are meant to sign.
4. **Fill every AI club back to the roster minimum** at the league minimum
   salary. Without this, a club that had a bad re-sign year stayed twenty bodies
   short for the rest of its existence — measured on 19 of 22 pre-existing
   saves, minimum roster 27 and median 33.
5. Set `phase = FREE_AGENCY, week = 1` (done by the claim, up front).

#### FREE_AGENCY — one step per week, `FREE_AGENCY.WEEKS` = 3

Each week: fill short clubs to the roster minimum, then run one AI bidding
wave. On week 1 only, also run the AI-to-AI veteran-for-picks trade market
(the new league year opens trading).

Window length is read from the constant, not written as a literal, because the
offseason roadmap draws a bar with one segment per week and the two must not
disagree about how long it is. It was four weeks and is three: the owner —
*"then free agency itself is only 3 advances from 4"* — and the measurement
behind it: driven twice from the same saved league, four waves and three waves
signed the **same 23 of the top 25** unsigned players and the **same 38 of the
top 40**, differing only at the bottom of the top 60 (57/60 against 55/60), with
the best man left unsigned an 88 either way.

When the next week would exceed the window: reseed the draft order (§5.5),
start the rookie draft, run the draft-window AI trade market (order seeded,
every pick still unused, so a club moving up really is buying the selection the
board is about to call), and leave the league in `DRAFT`.

User obligation: bid on free agents. Optional.

#### DRAFT — blocks until the board is complete

If the draft state is not complete, the step returns *"Draft is in progress —
make your picks, then advance"* and moves nothing. **Something must read that
completion flag.** Originally nothing did: the draft correctly marked itself
complete and no code path ever advanced the phase, so **every league was
permanently stuck after its first draft** and the dynasty the game is named for
was unreachable.

When complete:

1. **Clear `isDraftee` on everybody still carrying it.** No year filter. The
   draft is over and the state says so, so anybody still flagged went
   undrafted. The first fix for this was `draftYear < seasonYear`, which is a
   year late and had two invisible consequences: an undrafted rookie first
   reached an open market **two offseasons after his draft** (in the real sport
   he signs within days of the seventh round), and the free-agent attrition
   curve written for exactly that cohort selects `isDraftee: false` and so
   excluded them — they neither signed nor left, which is the pile-up the churn
   rule exists to prevent. Dropping the filter is also what frees fantasy-draft
   leftovers, which are written with a null draft year and could never match a
   `<` comparison at all.
2. **Delete every shortlist entry in the league.** A shortlist is a draft's
   paperwork, not a club's: the rows carry a player and a team and nothing else
   — no year, no league, no draft — and nothing had ever deleted one, so a star
   placed on a prospect in 2027 was still on the books in 2029. The owner opened
   his second draft to "4 players watched" against a board he had not touched.
3. **Final cuts** — trim every roster to `settings.rosterMax`. Free agency and
   the draft both add bodies and neither reads the ceiling, so a club could roll
   into the season carrying 57 players (INV-08). If the **user's** roster is
   over, the advance is **blocked** with a structured block pointing at the
   roster screen; every other roster in the league has already made its cuts.
4. Set `phase = PRESEASON, week = 1`.

User obligation: make his picks; clear his own roster overflow.

#### FANTASY_DRAFT — one-time, pre-`PRESEASON`, league start only

Same shape as `DRAFT`: blocks until complete, then clears `isDraftee` on
everybody left, deletes every shortlist entry, and goes to `PRESEASON` week 1.
Without the leftover conversion a fantasy league's unsigned pool was stranded
as prospects forever — measured, a fantasy league's free-agency screen read
**zero available** in every week of every season of its existence while 130
unsigned players sat invisible behind it.

### 2.3 The book year — the subtlety that has caused repeated bugs

**`ageContractsForYear` runs at the final whistle. `League.seasonYear` does not
move until `RESET_STANDINGS`, the second offseason step.**

So through **OFFSEASON weeks 1–2** there is a window where every contract in the
league already holds *next* year's base salary and proration while
`League.seasonYear` still names the season just played. The ledger and the
league clock disagree by a year.

Define one function and make every consumer read it:

```
capChargeYear(phase, week, seasonYear):
    beforeYearRoll = (phase == 'OFFSEASON' && week <= OFFSEASON_YEAR_ROLL_WEEK)   # == 2
    return beforeYearRoll ? seasonYear + 1 : seasonYear

bookYearFor(league, askedFor):
    if askedFor != league.seasonYear: return askedFor      # a caller naming another year means it
    return capChargeYear(league.phase, league.week, askedFor)
```

**Why `ageContractsForYear` is at the whistle and not three steps later.** It
used to be the offseason week-3 step, two steps *after* charges start being
filed against the new league year — so a cut made in OFFSEASON week 1 computed
its dead money off an un-aged `yearsRemaining` and charged the result to a year
the contract had already spent a season of. Measured: a 4-year deal with $17.76M
of bonus ($4.44M/yr of proration) and 3 years remaining booked **$13.32M**
against 2027 when cut at OFFSEASON wk1, and **$8.88M** against the same 2027
when cut two steps later. $4.44M of dead money created by nothing but timing,
and always in the direction that punished acting early.

**What reading `seasonYear` instead of the book year produced.** The cap summary
for one club at OFFSEASON week 1:

| line | figure | which year it was actually from |
|---|---|---|
| ceiling | $262.7M | 2029 — the season just **played** |
| salaries | $274.1M | 2030 terms — the ledger had already rolled |
| dead money | $3.7M | 2029 charges — a closed season's bill |
| **on screen** | **−$15.1M** | three years stitched into one number |

One Advance later, with no transaction of any kind, the same club read −$8.8M:
the ceiling moved onto 2030 (+$2.6M) and the 2029 dead money stopped being
counted (+$3.7M). That $6.4M was never real.

**And it ran the other way too, which is the dangerous half.** A cut dates its
dead money with `capChargeYear` — deliberately the *new* year in this window,
because the new year is the one that will pay it — so a release booked a charge
the reader was not reading. Measured: releasing an $80.6M-dead-money contract at
OFFSEASON week 1 moved the club from −$6.8M to **+$39.2M** on screen *and in the
cap gate*, for a move that actually left it $34.6M worse off. One Advance later
the same club read −$35.0M. **A GM cutting his way out of a bad number in this
window was being shown a windfall for a catastrophe.**

Rules for your implementation:

- Every reader of a cap figure asks for the **book year**, never
  `League.seasonYear`.
- Every reader that **prints** a year beside those figures prints the book year
  the summary decided, not its own second derivation off the League row. The
  cap page used to label the figures with its own read of `seasonYear`.
- `bookYearFor` shifts **only the current league year**. A caller naming any
  other year means that year literally, and there is exactly one such caller:
  the closing-year overage settlement, which asks for the *closing* year while
  the league row may already have stepped onto the new one and must get it
  unshifted.
- `ageContractsForYear` is **idempotent**, keyed on `League.contractsAgedYear`,
  because it is called from two places: the end of the playoffs (for the year
  being entered) and the `AGE_CONTRACTS` step (a catch-up for saves that
  predate the column, which would otherwise never age again).
- The **mark is the claim**, taken *before* the work, as a compare-and-set on
  the value just read. The read alone is not enough: both runners pass it, and
  neither half is idempotent. Aged twice, every contract loses two years for
  one season of football. Rolled back on failure, because the alternative
  failure mode is the one the phase machine cannot survive — marked but
  un-aged means **no contract in the league ever expires again**, and nothing on
  screen would say so.
- A contract that reaches 0 years remaining is **not released here**. It used to
  be, which meant every expiring player vanished to free agency before the
  `RESIGN` phase — where the user is supposed to get a chance to extend him —
  ever ran. He sits at 0 years remaining, still rostered, flagged as a pending
  free agent, until the end of `RESIGN`.
- Cap compliance is **not demanded** during `OFFSEASON` or `RESIGN` (§2.8), for
  this exact reason: the books are mid-roll.

**Rejected:** moving `League.seasonYear` forward at the end of the playoffs so
the two never disagree. It is the honest shape and it is not surgery, but
`RESET_STANDINGS` closes the season's stats, awards and standings against
`seasonYear` and every one of those would have to move with it. The reader
following the ledger is the smaller change, and the figure it replaces was not
merely unexplained — it was a closed season's bill added to a new season's
salaries under an old season's ceiling. There is no honest sentence for that.

### 2.4 One regular-season week, in order

```
1.  read the unplayed REGULAR games for (seasonYear, week)
2.  snapshot pre-kickoff state: standings, streaks, and the win chance the
    user was actually shown for his own game
3.  simulate all games CONCURRENTLY (disjoint teams/players)
4.  if every game came back "already claimed" -> return "already played"
5.  CLAIM THE WEEK: compare-and-set week -> week + 1
6.  count played games off the rows, not off this call's own share
7.  recover fatigue and tick injury clocks, league-wide
8.  in-season development checkpoint (no-op on a non-checkpoint week)
9.  if the checkpoint fired, re-sort AI depth charts
10. shortlist attention (the only ongoing scouting input in the game)
11. AI-to-AI trade market tick
12. maybe generate one unsolicited AI trade offer to the user
13. in-season wire signings
14. if week + 1 > seasonLength: select All-Stars, seed the playoffs
    else: week = week + 1   ... (see note)
15. build the week report
```

Notes on the ordering, each of which is load-bearing:

- **Step 5 is after the games, not before.** Claiming the week up front would
  make a timed-out request skip a week outright — marked done with sixteen games
  never played and nothing to pick them up. Claiming after means a killed
  function leaves the week un-advanced and the next click finishes the unplayed
  games. The cost is that a duplicate click simulates games in memory it then
  discards: CPU, not data.
- **Steps 7–13 are league-wide statements with no per-row guard.** Run twice,
  every injury heals two weeks in one and every player develops twice. The
  week's claim at step 5 is the only thing standing between a double click and
  that; exactly one of two concurrent advances matches, and the other returns
  here having written nothing.
- **Step 9 is gated on the same function that decides whether the checkpoint
  ran**, not on `week % INTERVAL === 0` written out a second time. Two copies of
  that rule is how a sweep ends up running on weeks nothing changed, or missing
  the week everything did. It matters because development is a bulk rating
  update that touches no depth chart, so a club's chart went on ranking men by
  what they were worth in week 1 — and the stat allocator hands the passing
  line, the targets and the carries to the chart's order. Measured across 1,216
  real clubs, **5.9% were about to credit the wrong quarterback and 15.1% the
  wrong WR1**. Rejected: sweeping every week — not for the 15–21ms, but because
  on the fourteen weeks between checkpoints no rating has moved, so it is
  fourteen reads of every roster in the league to write nothing.
- **Step 13 runs after the week is claimed**, so it happens exactly once per
  week however many times Advance is clicked.
- **Step 14's else-branch is a second week write.** The claim at step 5 already
  moved the week; the branch at 14 is what the original code shape left behind.
  Specify it as: the claim advances the week, the season-end branch overwrites
  phase/week when seeding the playoffs. Do not advance twice.

**Per-game save.** Each game's write is one transaction whose **first
statement** is the claim: `UPDATE game SET played=true, scores, boxScore, recap
WHERE id = ? AND played = false`. Two concurrent advances of the same week both
read the same unplayed list and both arrive for the same game; exactly one
matches a row. The loser matches zero rows and returns before touching
standings, the wire, or any player's season line. This is what stops one week of
football being counted twice — **measured, 488 passing yards a game became
955.** The claim is *inside* the transaction rather than as a cheaper check
before it, because that is what makes a killed function safe: everything commits
or rolls back together, so a timeout mid-game leaves the row unplayed and the
next advance simply plays it.

Inside that transaction, after the claim:

- standings update, **regular season only**;
- set injury weeks and injury type for the injured; increment fatigue for
  everyone who played;
- write news rows: one injury-report row per game (no player id — it is about a
  match, not a man), plus per-player game headlines (which **do** carry the
  player id, read off the box line they are written from);
- merge each box line into `seasonStats` **or** `playoffStats` by
  `kind === 'REGULAR'`. The stat gate used to be missing entirely, which is how
  a championship run added four games of yardage **and four games of `gp`** to a
  season line the leaderboard then ranked against a seventeen-game one.

Every per-player effect is **one bulk statement**, not one awaited UPDATE per
row. A 53-man-ish box score is a hundred-plus sequential round trips per game,
times sixteen games a week; `UPDATE ... FROM (VALUES ...)` does the same work in
one trip and was the single biggest contributor to slow sim speed.

**Fatigue and injury recovery** is one statement:

```
fatigue      = max(fatigue - FATIGUE_RECOVERY, 0)        # 22
injuryWeeks  = max(injuryWeeks - 1, 0)
injuryType   = (new injuryWeeks == 0) ? null : injuryType
   where status = 'ACTIVE' and (fatigue > 0 or injuryWeeks > 0)
```

The label and the clock are **one fact** and must be cleared together.

**The postseason runs the same recovery week between its rounds**, and until
this was noticed it did not: recovery was called from the regular-season path
only, so an injury clock stopped dead the moment the regular season ended. The
owner: *"i just had an injury occur at week 17, i simmed 2 weeks while on that
player's card and the injury remained until round 2 of playoffs"*, then
*"simmed again, still 2 weeks"*. A man hurt in December was out for the whole
run however short his injury was, and the postseason was the one part of the
game where injury **length** meant nothing at all. Fatigue was the quieter half
— four rounds of football with no recovery, accumulating hardest on the club
that keeps winning.

So recovery rides **inside the round-building lock** (§2.6), which is the only
exactly-once-per-round guarantee the postseason has: whichever advance actually
builds the next round is the one that ran the week, and a second click that
finds the bracket already there heals nobody. It runs **after** the round's
games, as the regular season does, which is the football answer too — a man
carried off in the wild-card round has the following week to get right. It does
**not** run after the final: there is no next round to be fit for, and the
`PROGRESS` step a click later zeroes fatigue and injury clocks outright.

### 2.5 Multi-week advance is a client loop

The UI offers, per phase:

| phase | options |
|---|---|
| PRESEASON / REGULAR | 1 week, 3 weeks, to midseason, to playoffs, to offseason |
| PLAYOFFS | 1 round, to offseason |
| OFFSEASON | 1 step, to re-sign window |
| FREE_AGENCY | 1 week, to draft |
| RESIGN / DRAFT / FANTASY_DRAFT | **none** — resolve this stage first |

Options are built from the phase actually on screen. They used to be the same
five regardless, and once past the regular season those targets either did
nothing or silently collapsed to a one-step advance, which read as broken.

The loop lives **in the client**, one server call per step:

```
initial = getLeaguePhase(leagueId)
if stopBefore(initial.phase, initial.week, mode): toast "nothing to advance"; return
reports = []; trophy = null; calledOff = false; iterations = 0
while iterations < MAX_ITERATIONS:            # 60, a backstop not a target
    show "Working through <phase noun> <week>…"
    result = advanceWeek(leagueId)
    if result.blocked: show the refusal; return      # do not spin on a closed door
    if result.report: reports.push(result.report)
    if result.trophy and not trophy: trophy = result.trophy
    phase, week = result.phase, result.week
    iterations += 1
    if stopAfter(phase, week, mode, startPhase, iterations): break   # mode's own target FIRST
    if stopRequested: calledOff = true; break                        # user stop, between weeks only
```

**Why a client loop and not a server loop.** Three reasons, all of them real:

1. **Visible progress.** One opaque server-side loop is a single static spinner
   label for however long the whole batch takes. Driving it a week at a time
   from the client is what makes *"Working through week 3…"* possible.
2. **A stop is only possible if there is a seam.** The flag is read between
   weeks, where the week just written is whole and the next one has not been
   asked for. A server loop has no seam a user can reach.
3. **Serverless duration.** Each advance is one request inside the platform's
   duration limit; a seventeen-week loop in one request is not.

`stopAfter` is evaluated **before** the stop flag, and the order is the point.
If this week was the one the mode was driving at — the playoffs arrived, a gate
phase needs the user — then the run finished, and a stop pressed while it was in
flight has nothing left to stop. It must not relabel a completed run as a
called-off one, and it must not swallow the message a gate phase produces.

**The user-driven stop halts at a week boundary and reports only what happened.**
`iterations` and `reports` are counted from advances that *returned*, and the
week it landed on is read back off the last report rather than restated from the
mode — so a run called off at week 8 cannot report having reached the playoffs.
A report reading "Weeks 3–17" after a stop at week 8 would be a fabricated
figure, which is the one failure the panel exists to avoid.

**Interruption budget.** A multi-week advance shows **one** report, never one
per week: every intermediate report is collected and folded into a span strip
(real per-week results, the record at both ends), while the panel renders the
**last** week, which is where the league now stands. *"A player who asked to
skip to the playoffs has explicitly asked not to be stopped"* — and "not to be
stopped" means not stopped **by the app**; the user stopping his own run is the
opposite thing, which is why a stop travels with the span and the strip says so.

The one full-screen interruption in the game is the trophy moment, at most once
per season. When the same press carries both a long span and a season ending,
they are **one** artifact (the season-end card), not two in a row: the rule is
that the trophy moment supersedes both and only ever one is on screen at a time,
and two artifacts in a row is that rule with the corner filed off. The defect
this fixed: the player who missed the playoffs and pressed "Advance to
Offseason" got the whole span strip, and the player who **won the title** on the
same press got the ring and lost all twenty-two weeks behind it. The season you
would most want the record of was the one that threw it away.

### 2.6 Concurrency: the lease and the claims

Two layers, and you need both.

**Layer 1 — per-transition claims.** Every transition claims itself before it
does work:

| transition | claim |
|---|---|
| a regular-season week | compare-and-set `week` (and each game's `played` flag) |
| out of `RESIGN` | compare-and-set `phase` |
| an offseason advance | compare-and-set `week` to the far side of the whole group |
| a playoff round build | an exclusive row lock on the League row |
| contract aging | compare-and-set `contractsAgedYear` |

These guarantee **"this advance runs once."** They do **not** guarantee **"only
one advance is running."** A claim writes the new week at the very top of the
work, so a second press arriving a few milliseconds later reads the week the
first one already moved, matches the claim for the **next** advance, and runs it
alongside the first.

Measured, on a clone of a save taken at OFFSEASON week 1 so control and subject
started byte-identical: press one claimed at **+6ms** and ran until **+2,628ms**;
press two was made at **+7ms** and ran `ADD_DRAFT_CLASS` and `RESIGN` through to
**+5,853ms**, on top of a league whose players were still being aged and retired
underneath it. One click's worth of intent, two league years' worth of
bookkeeping, overlapping for two and a half seconds. The league came out at
`RESIGN` week 1 where one clean press leaves it at OFFSEASON week 4; 115
retirements became 102 and 663 transactions became 968.

**Layer 2 — a lease on the league, held for the whole advance.** A press that
finds the lease held is refused.

```
heldSince = now
expired   = now - ADVANCE_LEASE_MS                 # 90_000
took = UPDATE league SET advanceStartedAt = heldSince
       WHERE id = ? AND (advanceStartedAt IS NULL OR advanceStartedAt < expired)
if took == 0:
    # "no row matched" answers BOTH "somebody holds it" and "no such league",
    # and those are not the same answer. Telling a caller with a bad id to wait
    # for an advance that will never finish is a worse lie than a not-found
    # error, so re-read the league and throw if it is missing.
    assert league exists
    return { blocked: true, summary: ADVANCE_IN_PROGRESS }
try:
    ... the advance ...
finally:
    UPDATE league SET advanceStartedAt = NULL
      WHERE id = ? AND advanceStartedAt = heldSince        # ONLY IF STILL OURS
```

Design points you must preserve:

- **A lease, not a flag.** A boolean "advancing" column is one hard kill away
  from a save nobody can ever advance again: the request dies between the claim
  and the release, the flag stays true forever, and there is no move inside the
  game that clears it. **The failure mode of a mutex must never be worse than
  the race it prevents.** A timestamp says both "held" and "since when", so the
  lease expires on its own and the league heals with no intervention.
- **90 seconds is deliberately longer than any advance that can finish.** The
  longest serverless `maxDuration` anything asks for is 60s, so a request still
  alive at 90 has already been killed by the platform; the heaviest measured
  single advance is under two seconds. A lease is only ever stolen from a
  request that is already dead — and on the day that reasoning is wrong, the
  per-transition claims are still there. **The lease is a door; they are the
  lock.**
- **Release only if still ours.** If this advance ran long enough for its lease
  to expire and another press took it, that press owns the column and clearing
  it would hand a third press the door while two advances are running.
- **Not a pg advisory lock.** A session-level one lives on a pooled connection
  nobody owns for the length of a request, and a transaction-level one would
  mean holding a transaction open across the entire advance — including the
  playoff round lock, which opens its own.
- The client button refusing to fire twice is **an optimisation, not the
  guarantee**: the client cannot speak for a second tab, a phone, or a stale
  page. (And on React 18, `isPending` goes false at the first `await`, so a
  naive transition re-enables the button while the advance is still running.)

**Why the offseason claim is at the top and the regular season's is at the
bottom.** A week's sixteen games are individually claimed, so claiming the week
late costs a duplicate click some wasted CPU. An offseason step has no inner
guard: by the time the work is done it is already done twice, silently —

| step | run twice |
|---|---|
| `PROGRESS` | every player ages twice, develops twice, two retirement rolls |
| `RESET_STANDINGS` | every career total in the league **permanently doubled** |
| `ADD_DRAFT_CLASS` | a second set of future picks |

(`AGE_CONTRACTS` is already immune via its mark.) **One claim covers the whole
group**, however many steps it carries — the week jumps straight to the far
side, so a second click arriving anywhere inside a running advance finds a week
it cannot match. Claiming per step inside the loop would leave a duplicate click
free to race in through the gap between two steps.

**A throw partway gives back only what it did not do.** The week is put back to
the step that **failed**, not to the start of the advance, so committed steps
are never re-run. The residual risk is a hard kill between the claim and the
rollback, which skips the rest of the advance outright. That is the trade, and
it is the right way round: a skipped step is visible and re-runnable; doubled
career stats are silent and permanent.

**The way out of `RESIGN`** was the last transition that both moved time and did
non-idempotent work unguarded. What that looked like was a misleading stack
trace: a not-found error out of a contract delete on an id read five lines
earlier — the row had not vanished, the *other* advance had already released the
same man. The silent half is worse and would have outlived it: the fringe-free-
agent mint sizes its batch off a pool count, so two runners read the same
shortfall and each mint the whole of it, and the roster fill signs two rounds of
minimum deals into the same holes. Making the delete idempotent on its own would
have hidden the crash and kept both. So the **phase** is the claim, rolled back
if the work throws, leaving the window open and the press repeatable.

**The playoff round builder** has no week to compare-and-set, because the
playoff branch does not move `week` between rounds. The mutex is the League row
itself: `UPDATE league SET week = <the value it already holds>` takes an
exclusive row lock held until commit, so a second advance **blocks** on it
rather than racing past, and by the time it gets through the first has committed
and its "already built" count sees the round. Writing a column to the value it
already holds is deliberate — **the write exists for the lock, not for the
data.** Both round builders used to call create unconditionally: the games
themselves are safe, but *building* the bracket was not, and the postseason came
out with two brackets in it. A unique index on
`(leagueId, seasonYear, kind, homeTeamId, awayTeamId)` would be the stronger
guarantee and is the wrong tool: the migration would fail to apply against any
live save already carrying a duplicated bracket from this very bug — precisely
the population it would protect.

### 2.7 Side systems the clock drives

**AI trade offers to the user** (regular season only, respecting the trade
deadline setting): expire pending offers older than one week (visible the week
they arrive and the week after, then gone), cap the inbox at **3** pending, then
maybe generate one at `settings.aiTradeFrequency`.

**Coordinator firings** (AI clubs only, at the final whistle): a club whose win
percentage is below **0.30** (roughly five wins or fewer in a 17-game season)
fires its lower-rated of OC/DC and replaces him with a freshly generated coach
— `rating = normalClamped(55, 12, 25, 95)`, `playCalling = normalClamped(rating,
8, 20, 99)`, `development = normalClamped(rating, 10, 20, 99)`,
`contractYears = int(2, 5)` — and writes a `FIRE` news row. **User teams are
never auto-fired; coaching is the user's call.**

**AI competitive windows**, recomputed once a year at the **top of
`RESET_STANDINGS`**, which is the only step where all three inputs are readable
at once: `PROGRESS` has already aged and retired every roster (so the ages read
are the ones the club will **play**), the standings below are about to be wiped
(so this is the last moment the season just played is on the Team row), and the
contract ledger rolled at the whistle (so the books already describe the league
year being entered). The input is the **men the club actually fields, in the
order it plays them** — averaging the whole 53 would have a club's window moved
by its practice squad, and averaging the best men at each position would read a
lineup the club has chosen not to field. The cap summary is asked for
`closingYear + 1` **by name**, because the offseason claim has already moved
`week` to the far side of the advance and asking for `seasonYear` would take the
post-roll branch of `capChargeYear` and pair the old ceiling with contracts that
have already stepped. **The user's club is never touched** — his window is
whatever he decides to do. Note the defect this fixed: the recompute function had
existed since the AI was written and its own header said it ran every offseason.
**Nothing called it.** The profile was written once at league generation and
never touched again, so a club could go 3-14 four years running and still shop
like a contender.

**The free-agent asking-price clock.** A wrapper around the phase step reads the
league's clock **before and after**: if `phase`, `week` or `seasonYear` changed,
a week happened, and every unsigned non-draftee's `weeksUnsigned` is incremented
in one statement. Not every click moves time — a re-sign warning, a draft on the
clock and a roster over the limit all return without advancing — and ticking on
those would let a GM age the whole market by pressing a button that told him no.
Every phase counts, not just the season: a man released in April is unsigned
through the draft and through camp just as surely as he is unsigned in November.
**One race over-counts and it is the right way round:** two concurrent advances
of the same week both observe the week move, so the pool ages twice for one week
of football. Claiming the tick per step would trade that for a tick silently
**skipped** when a step is retried, and a market clock that runs slow is a
market that never clears.

### 2.8 Blocks — when the clock refuses

`advanceWeek` returns `{ summary, blocked?, report?, trophy?, capBlock?, block? }`.
`blocked` means **time did not move**; `summary` says why, and the structured
payload says what to call it and where the user fixes it. Without the generic
`block` shape, every refusal rendered under the cap panel's hard-coded "Over the
salary cap" heading, which for a roster-limit refusal is a lie.

The three refusals:

| refusal | when | payload |
|---|---|---|
| **Advance in progress** | the lease is held | none — a busy signal, not a decision. There is nothing to fix and nowhere to send him, so the button shows it as a toast that gets out of the way. |
| **Over the salary cap** | before any phase work | `capBlock` with the shortfall and a cut path, biggest saver first |
| **Over the roster limit** | final cuts, user club only | `block` with a title and a route to the roster screen |

The cap gate is deliberately narrow:

- **`REALISTIC` cap mode only.** `SIMPLIFIED` has no dead money, so a club can
  always cut straight back under and a hard stop adds nothing; `OFF` means the
  user switched the rule off and nothing may override that.
- **The user's club only.** AI clubs are enforced at transaction time, and
  halting the user's clock over a CPU club's books would be unfixable.
- **Not during `OFFSEASON`/`RESIGN`** — §2.3. The books are mid-roll: contracts
  have aged onto their next (escalating) base salary but expiring deals do not
  come off the ledger until the end of `RESIGN`. A four-season trace shows this
  window is exactly where clubs go negative **and where they come back on their
  own**, league-wide, every year. Blocking there would fire on almost everyone
  every single offseason for a condition that resolves itself one step later —
  a rule that reads as a bug. Export the "is compliance due now" predicate so
  the standing over-cap banner promises the same thing the gate enforces
  instead of threatening a block that will not happen.
- **Only while a way out still exists.** If cutting every player who frees
  anything still leaves the club over (dead money alone can exceed the
  ceiling), blocking would be a permanent soft-lock, so the week advances and
  the standing warning carries it.

That last escape was, for a while, **the most profitable move in the game**:
going *further* over the cap switched the gate off, and every charge was swept at
the roll. Measured — $50.8M over, blocked; ten releases later at $844.0M over
with $53.3M of maximum cut relief, the identical call ran the week and the club
carried nothing into the new year. Reproduced at $978.6M over, carrying $0. The
escape **stays**, because a user must never be soft-locked. What changed is that
it is no longer free: the closing-year overage settlement writes whatever a club
is still over by when its season ends into the next league year as a real
charge, and the cap page, the over-cap banner and the front-office brief all say
so. **You may stand still. You may not stand still for free.** Three sentences
that said only "the week is still allowed to advance" were true and read as
*"and nothing happens"*.
