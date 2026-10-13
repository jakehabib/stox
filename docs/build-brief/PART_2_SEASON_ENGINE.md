# PART 2 — Build the season, the simulation, and player development

Build the clock, the football, and the way players get better and worse. Every
constant below is read out of a working implementation; every number carries the
reason it is that number, and where the reason was a measured failure, the
measurement is here so you do not have to rediscover it. Do not change a number
without reproducing the measurement that set it.

Read §1 and §10 before you write any code. §1 holds two rules this
implementation broke eleven times between them. §10 is the quality gate that
catches the rest — build it first, not last.

---

## 1. Obey these two rules everywhere, and build in this order

### Rule 1 — never fix a distribution with a hard `clamp`

Truncating a random draw does not cap its tail. It **piles** the tail onto one
value, which makes the most extreme outcome the most *common* outcome at that
end. Seven instances were found and removed from this codebase. The smallest one
is the one to keep in your head: a receiver's per-game catch rate drawn
`N(0.62, 0.08)` and truncated to `[0.35, 0.85]`, measured over four million
draws —

| bucket | share of draws |
|---|---|
| 0.83 | 0.172% |
| 0.84 | 0.153% |
| 0.85 | **0.249%** |

A clean monotone decline, then a step back **up** at the wall. The most extreme
catch rate in the game was also the most frequent one.

Write one shared soft-bound helper and route every bounded draw through it, so
the eighth instance is caught by reading rather than by rediscovery:

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

Preserve these properties:

- `core = 2` leaves **95.4%** of draws bit-identical to the raw normal.
- The taper is C-1 continuous at the join — `tanh`'s slope there equals the
  slope of the untouched line — so there is no visible kink.
- The bound is **approached and never reached**, and each further sigma buys
  strictly less movement than the one before.
- It consumes **no randomness of its own**; it transforms a value already drawn.
  When this shipped, every score across 3,264 simulated games hashed identically
  before and after (same SHA-256, same 148,179 points). Only the extreme tail
  thinned: highest catch rate seen 0.900 → 0.889.
- **Do not widen `core`.** At 2.5 sigma the leftover headroom is too thin to
  absorb the tail and the pile-up reappears one bucket inside the bound
  (measured: 0.84 back above 0.83).

Keep a hard `clamp` only where it is a **safety rail, not a shaping device** — a
bound that must not be crossed for structural reasons and that the distribution
never approaches in play. The play-call pass rate's `[0.25, 0.85]` rail is the
model: the realised draw has sd 0.0466 about 0.5725, so the rails sit past six
standard deviations and over 20,000 draws nothing came within 0.10 of either.
They exist only so a pathological value can never produce negative rush
attempts. At every clamp you keep, state in a comment which of the two it is.

### Rule 2 — never sort a mixed-position pool by overall

A kicker's overall is computed from kicking attributes against a scale every
other position outscores, and specialists additionally carry a flat −5
generation penalty. **A kicker is low by construction.** He sits near the bottom
of any league-wide rating sort.

What that cost: a fantasy draft board built as `order by trueOvr desc, take 60`.
In a 1,956-man pool the best kicker was **141st** and appeared on no board.
Clubs opened the season unable to field a lineup — *DEN has nobody at K/P. DAL
has nobody at QB/K/P. CHI has nobody at K.* — **638 club-readings** of a missing
position across one season in one league, 775 in another. It is not only
specialists: over twelve real pools, seven were missing at least one whole
position from their top sixty, one of them **quarterback**.

So: build any draft board as **a column per position** (best twelve at each),
and spend a club's final picks on positions it has nobody at once its remaining
picks equal its empty positions — nobody takes a kicker on value, which is
correct valuation rather than a bug. Same seed, same league, one season: **638
before, 22 after**.

Apply the rule again at final cuts. Rank the roster for release by a
rating-plus-dead-money score that is blind to position — a sixth quarterback
surviving over a thin room is a bloat problem, not that function's — **except**
that you must protect the **last man at a one-man job** (K, P) by sorting
protected ids last, and still cut him when there is nobody else left to cut.
Measured before that protection: 113 clubs in the dev database carrying fifty or
more men and no kicker.

Generalise: whenever you rank a pool spanning positions, rank **within
position** or by **per-position quota**. Never a single global sort on a
cross-position quantity.

### Build in this order

1. **The invariant checker and the soak harness (§10).** Not advice. Four of
   this project's most serious defects — an inverted trade AI, a draft that
   broke past pick 32, a `RESIGN` step that silently released every player in
   the league, a $360M contract preset — were found only by running leagues
   forward and checking state. A clean typecheck proves nothing about whether a
   player can end up rostered with no contract.
2. The game engine (§3) and the box-score balance harness (§10, INV-22).
3. The phase machine (§2), including its concurrency claims (§2.6).
4. Statistics, standings, playoffs, draft order (§4, §5).
5. Awards (§6) and progression (§7).

---

## 2. Build the phase machine

### 2.1 States and columns

```
FANTASY_DRAFT ──┐                           (one-time, league start only)
                ▼
             PRESEASON ──► REGULAR ──► PLAYOFFS ──► OFFSEASON ──► RESIGN
                 ▲                                                   │
                 └──────── DRAFT ◄──── FREE_AGENCY ◄─────────────────┘
```

Put `phase`, `week`, `seasonYear` on the League row, plus the bookkeeping
columns `contractsAgedYear`, `resignWarnedYear`, `startYear`,
`advanceStartedAt`, `userTeamId`. Let `week` mean a different thing per phase:
regular-season week, playoff round, free-agency week, or **1-based index into
the offseason step list**.

Expose exactly one entry point that moves time: `advanceWeek(leagueId)`. Make it
perform **exactly one phase step** and return a summary of what happened — the
UI must be able to show "what changed" rather than a wall of silence. Never
write a server-side loop over weeks (§2.5).

### 2.2 Implement each phase

#### PRESEASON — one step, then straight to `REGULAR` week 1

Run these in order:

1. **Seed next year's draft class** unless one already exists for `seasonYear`
   (guard on a count of draftees whose `draftYear === seasonYear`, because
   league creation already seeds year one's class). Add the class **a full
   game-year before its own draft** so it can be scouted all season. This is
   why a draftee legitimately carries `draftYear === seasonYear - 1` for long
   stretches — build INV-07 to tolerate exactly one year of that and no more.
2. **Reset private workout slots** for `seasonYear`. Do this here and **not** at
   the league-year roll: workouts are budgeted against a *college class*, and
   the class on the board at the roll was assembled last September and is not
   drafted until the offseason ends. Refilling at the roll hands a GM ten
   workouts against one class. Make it idempotent so a save whose class was
   seeded at league creation lands on the same counter.
3. **Build this season's schedule** if absent; make the builder idempotent.
   Preseason is the right gate because it is the last phase before `REGULAR` on
   every path into a new league year. The original build created a schedule only
   at league creation, so **every season after the first played no football at
   all**: weeks advanced, the toast read "0 games played", and nothing said
   anything was wrong.
4. **Run one camp signing pass** (phase `PRESEASON`). The wire does not close
   when free agency does — a club with a hole fills it in August, and the men
   still unsigned in August are cheaper than they were in April. Keep it to one
   or two clubs, only when they have a real hole.
5. **Auto-sort every AI club's depth chart.** Do it here, not at the offseason
   `PROGRESS` step. `PROGRESS` is where ratings move so it looks like the
   natural home, but four more offseason steps of roster churn happen after it
   and the chart would be stale by the opener. Cost: once a league year,
   92–159ms on a nine-season league. **Never touch the user's chart.**
6. **Drop orphan depth-chart rows** for every club including the user's — rows
   naming men who retired, whose contracts expired, or who went in final cuts.
   Those three are the only roster moves in the game that do not run per-player
   chart reconciliation, because they move a hundred players at once. Keep this
   delete-only, which is what makes it safe on a hand-set order.
7. Set `phase = REGULAR, week = 1`.

Ask the user for nothing in this phase.

#### REGULAR — one step per week, `week` 1..`settings.seasonLength` (default 17)

Implement the week exactly as §2.4 orders it. Require nothing of the user; the
screens he *may* use are the depth chart, trades, in-season free agency and the
shortlist.

On the step where `week + 1 > seasonLength`, instead of advancing the week:
**select and record All-Stars** (§6.5), then **seed the playoffs** (§5.2), which
writes `phase = PLAYOFFS, week = 1` itself.

#### PLAYOFFS — one step per round

Each step: play every unplayed non-`REGULAR` game for `seasonYear`, then work
out which round just completed and build the next. Round kinds in order:
`WILDCARD` → `DIVISIONAL` → `CONFERENCE` → `FINAL`.

Determine completion from the set of **played** non-regular games **for this
season year**. Both filters are load-bearing:

- Drop `seasonYear` and last year's `FINAL` is still in the set, so the
  wild-card branch's "divisional not yet played" test is false on the very
  first postseason game of year two and control falls through to "final played"
  — **a champion crowned straight out of the wild-card round, every season
  after the first, forever.** Measured on the dev database: one save played a
  full bracket in 2026 and then wild-card-only in 2027 through 2034 — eight
  seasons of one-round playoffs and eight fake champions.
- Drop `played` and the next round's unplayed rows already exist by the time the
  following advance reads this, so the set reports a round complete before it
  kicked off.

**Never let postseason results touch `Team.wins/losses/ties/pointsFor/
pointsAgnst`.** They used to, which produced "2026 Champions (19-1)", 20-game
division tables, and a title-winning team displayed third in its own division.
Carry playoff results on the `Game` rows and on `TeamSeasonRecord.playoffResult`.

After the `FINAL` is played, run exactly this order:

1. **Snapshot season history** — freeze `TeamSeasonRecord` for every club, write
   the `CHAMPION` news row, and write one `ChampionRoster` row per man on the
   winning roster (§5.4).
2. **Record season awards** — compute and persist the six trophies and apply
   each winner's rating bump (§6).
3. **Stamp last-season overall** — write every player's current `trueOvr` into
   his season row. **This is the last instant `trueOvr` still means "what he was
   this season"**: the awards have just paid their bumps and nothing has aged,
   retired or rolled offseason development onto anybody yet. Do it as one UPDATE
   for the whole league, everyone included whether or not a box score ever named
   him — that is what makes the player card's year-over-year chip work at every
   position instead of only the ~26 a club that turn up in a box score.
4. **Fire struggling coordinators** — AI clubs only (§2.7).
5. **Age the contract ledger onto `seasonYear + 1`** — here, at the final
   whistle. §2.3 is entirely about this; read it before you place this call.
6. Build the week report and trophy payload **before** flipping the phase, so
   the season being described is still the season the league is standing in,
   then set `phase = OFFSEASON, week = 1`.

#### OFFSEASON — five steps, **one** press of Advance

| week | step | do this |
|---|---|---|
| 1 | `PROGRESS` | age/develop/retire every rostered player; age/develop/retire every unsigned player |
| 2 | `RESET_STANDINGS` | recompute AI competitive windows; roll season stats into career; check league records; wipe standings; **`seasonYear += 1`** |
| 3 | `AGE_CONTRACTS` | idempotent catch-up call to the ledger ager; expire stale cap charges |
| 4 | `ADD_DRAFT_CLASS` | extend the rolling future-pick horizon to `seasonYear + 3` |
| 5 | `RESIGN` | AI re-sign wave + franchise tags; AI fifth-year option decisions; `phase = RESIGN, week = 1` |

Group all five into **one advance**. It used to be one step per press, which put
six presses between the final whistle and free agency, four of them asking the
user nothing. The owner: *"thats so many advances, we need to combine some of
these"*, then *"ideally i'd like post super bowl to free agency to be 3
advances"*, then *"I also think housekeeping only needs to be 1 stage."*

Keep `League.week` counting **steps, not presses**:

- the cap system's "which league year does a charge belong to" boundary is
  defined as "the offseason week whose step rolls `seasonYear`" — week 2 — and
  keeps both its meaning and its value;
- a save left mid-offseason by an older one-step-per-press build resumes at
  exactly the step it stopped on and is grouped from there;
- a step that throws leaves the week **on the step that failed**, so steps
  already committed are never re-run.

A league under this build therefore reads week 1 → week 4 → `RESIGN`. Weeks 2
and 3 are real and are passed through rather than stopped on.

Make one press run "the remainder of the advance the current step belongs to",
clamped so a save somehow past the end of the list re-runs the last step rather
than reading off the end of it.

**Re-read the League row between steps.** `RESET_STANDINGS` moves `seasonYear`
underneath the three steps after it, all of which take it as an argument and
mean the new one. Override `week` with the step's own index rather than the
claimed one, so each step sees the week it would have seen as a press of its own
— that is what the `RESIGN` wave stamps its transactions with.

**Join the five step summaries into one paragraph.** Write each to state its own
fact plainly without repeating the ones before it: read alone they are whole
sentences, read together they are a report rather than five receipts. This is
the only record the user gets that any of it happened.

Ask the user for nothing in this phase.

#### RESIGN — the user's window

Before anything else, implement a **once-per-league-year warning that stops
time**. A roster must not lose two thirds of itself in one click without the
user being told first: one measured save went from 37 active players to 14 in a
single step with nothing on screen beforehand.

Fire the warning when players are walking (`yearsRemaining === 0`) **and**
either:

- the roster after they walk falls below `rosterMinFor(settings.rosterMax)`
  (46 of 53 by default), or
- **anybody the user explicitly set aside** in the negotiation list is one step
  from free agency.

Build the second clause as a widening of the **same** warning, not a second
warning. The re-sign list carries a "not now" control so a twenty-deep list can
be triaged, and that opens exactly one trap: park twelve men, advance, and they
all walk having done what the button implied was safe. Two blocking messages
competing for one Advance would be worse than none. **Name** the parked men (top
three by rating, "and N more"), say how many are starters — read depth-chart
rank 0, the same table the depth-chart screen renders, never a rating guess —
and say *"'Not now' was never 'let him go', and this is the last screen where
that is still true."* Write nothing to any negotiation here; this is a read.

Stamp `League.resignWarnedYear` so the warning fires **exactly once per league
year**. Letting a class walk is a real decision a GM is allowed to make; being
ambushed by it is not.

On the second press, claim the transition (§2.6) and then:

1. **Price what comes off the user's books before the men are gone.** Read it
   first — afterwards there is no contract left to price. An expiring man is
   charged his final year's number until this window shuts, and the moment it
   does that charge is gone. This was the largest single move in the user's cap
   position and **nothing said so**; measured, this step took one club from
   −$8.8M to +$2.5M, four men, $11.3M, while the summary talked only about the
   league-wide pool. A number that improves by eight figures unannounced reads
   as a bug whether or not it is one. Count the user's club only; the
   league-wide line already carries the market.
2. **Release every expiring contract that was not re-signed.**
3. **Mint fringe free agents** — the several hundred camp bodies a real
   offseason always has and this one never did. Run this *before* the roster
   fill below: that is what the short clubs are meant to sign.
4. **Fill every AI club back to the roster minimum** at the league minimum.
   Without it, a club that had a bad re-sign year stayed twenty bodies short for
   the rest of its existence — measured on 19 of 22 pre-existing saves, minimum
   roster 27 and median 33.

Have the claim write `phase = FREE_AGENCY, week = 1` up front, and roll it back
if the work throws, so a failed advance leaves the window open and the press
repeatable rather than stranding the league one phase on with the release half
done.

#### FREE_AGENCY — one step per week, window length 3

Each week: fill short clubs to the roster minimum, then run one AI bidding wave.
On week 1 only, also run the AI-to-AI veteran-for-picks trade market — the new
league year opens trading, once at the top of the window rather than every week
of it.

Read the window length from a constant, never a literal: the offseason roadmap
draws a bar with one segment per week and the two must not disagree about how
long it is. Set it to **3**, not 4. The owner: *"then free agency itself is only
3 advances from 4"*, and the measurement behind it — driven twice from the same
saved league, four waves and three waves signed the **same 23 of the top 25**
unsigned players and the **same 38 of the top 40**, differing only at the bottom
of the top 60 (57/60 against 55/60), with the best man left unsigned an 88
either way.

When the next week would exceed the window: reseed the draft order (§5.5), start
the rookie draft, run the draft-window AI trade market (order seeded, every pick
still unused, so a club moving up really is buying the selection the board is
about to call), and leave the league in `DRAFT`.

#### DRAFT — block until the board is complete

If the draft state is not complete, return *"Draft is in progress — make your
picks, then advance"* and move nothing.

**Make something read that completion flag.** Originally nothing did: the draft
correctly marked itself complete and no code path ever advanced the phase, so
**every league was permanently stuck after its first draft** and the dynasty the
game is named for was unreachable.

When complete:

1. **Clear `isDraftee` on everybody still carrying it. Use no year filter.** The
   draft is over and the state says so, so anybody still flagged went undrafted.
   The first fix for this was `draftYear < seasonYear`, which is a year late and
   had two invisible consequences: an undrafted rookie first reached an open
   market **two offseasons after his draft** (in the real sport he signs within
   days of the seventh round), and the free-agent attrition curve written for
   exactly that cohort selects `isDraftee: false` and so excluded them — they
   neither signed nor left, which is the pile-up the churn rule exists to
   prevent. Dropping the filter is also what frees fantasy-draft leftovers,
   which are written with a null draft year and could never match a `<`
   comparison at all.
2. **Delete every shortlist entry in the league.** A shortlist is a draft's
   paperwork, not a club's: the rows carry a player and a team and nothing else
   — no year, no league, no draft — and nothing had ever deleted one, so a star
   placed on a prospect in 2027 was still on the books in 2029. The owner opened
   his second draft to "4 players watched" against a board he had not touched.
3. **Run final cuts** — trim every roster to `settings.rosterMax`. Free agency
   and the draft both add bodies and neither reads the ceiling, so a club could
   roll into the season carrying 57 players (INV-08). If the **user's** roster is
   over, **block** the advance with a structured block pointing at the roster
   screen, and say that every other roster in the league has already made its
   cuts.
4. Set `phase = PRESEASON, week = 1`.

#### FANTASY_DRAFT — one-time, pre-`PRESEASON`, league start only

Same shape as `DRAFT`: block until complete, then clear `isDraftee` on everybody
left, delete every shortlist entry in the league, and go to `PRESEASON` week 1.
Without the leftover conversion a fantasy league's unsigned pool is stranded as
prospects forever — measured, a fantasy league's free-agency screen read **zero
available** in every week of every season of its existence while 130 unsigned
players sat invisible behind it.

### 2.3 The book year — specify this before you write any cap reader

**Age the contract ledger at the final whistle. Do not move `League.seasonYear`
until `RESET_STANDINGS`, the second offseason step.**

That means through **OFFSEASON weeks 1–2** every contract in the league already
holds *next* year's base salary and proration while `League.seasonYear` still
names the season just played. The ledger and the league clock disagree by a
year. **Make every consumer read the book year.**

```
capChargeYear(phase, week, seasonYear):
    beforeYearRoll = (phase == 'OFFSEASON' && week <= OFFSEASON_YEAR_ROLL_WEEK)   # == 2
    return beforeYearRoll ? seasonYear + 1 : seasonYear

bookYearFor(league, askedFor):
    if askedFor != league.seasonYear: return askedFor      # a caller naming another year means it
    return capChargeYear(league.phase, league.week, askedFor)
```

**Why age at the whistle rather than three steps later.** It used to be the
offseason week-3 step, two steps *after* charges start being filed against the
new league year — so a cut made in OFFSEASON week 1 computed its dead money off
an un-aged `yearsRemaining` and charged the result to a year the contract had
already spent a season of. Measured: a 4-year deal with $17.76M of bonus
($4.44M/yr of proration) and 3 years remaining booked **$13.32M** against 2027
when cut at OFFSEASON wk1, and **$8.88M** against the same 2027 when cut two
steps later. $4.44M of dead money created by nothing but timing, and always in
the direction that punished acting early.

**What reading `seasonYear` instead of the book year produced.** One club's cap
summary at OFFSEASON week 1:

| line | figure | which year it was actually from |
|---|---|---|
| ceiling | $262.7M | 2029 — the season just **played** |
| salaries | $274.1M | 2030 terms — the ledger had already rolled |
| dead money | $3.7M | 2029 charges — a closed season's bill |
| **on screen** | **−$15.1M** | three years stitched into one number |

One Advance later, with no transaction of any kind, the same club read −$8.8M:
the ceiling moved onto 2030 (+$2.6M) and the 2029 dead money stopped being
counted (+$3.7M). That $6.4M was never real.

**And it ran the other way, which is the dangerous half.** A cut dates its dead
money with `capChargeYear` — deliberately the *new* year in this window, because
the new year is the one that will pay it — so a release booked a charge the
reader was not reading. Measured: releasing an $80.6M-dead-money contract at
OFFSEASON week 1 moved the club from −$6.8M to **+$39.2M** on screen *and in the
cap gate*, for a move that actually left it $34.6M worse off. One Advance later
the same club read −$35.0M. **A GM cutting his way out of a bad number in this
window was being shown a windfall for a catastrophe.**

Hold yourself to all of these:

- Every reader of a cap figure asks for the **book year**, never
  `League.seasonYear`.
- Every reader that **prints** a year beside those figures prints the book year
  the summary decided, not its own second derivation off the League row. The cap
  page used to label the figures from its own read of `seasonYear`.
- `bookYearFor` shifts **only the current league year**. A caller naming any
  other year means it literally, and there is exactly one such caller: the
  closing-year overage settlement, which asks for the *closing* year while the
  league row may already have stepped onto the new one and must get it
  unshifted.
- Make the ledger ager **idempotent**, keyed on `League.contractsAgedYear`,
  because two places call it: the end of the playoffs (for the year being
  entered) and the `AGE_CONTRACTS` step (a catch-up for saves that predate the
  column, which would otherwise never age again).
- **Make the mark the claim**, taken *before* the work, as a compare-and-set on
  the value just read. A plain read is not enough: both runners pass it, and
  neither half is idempotent — aged twice, every contract loses two years for
  one season of football. Roll the mark back on failure, because the alternative
  failure mode is the one the phase machine cannot survive: marked but un-aged
  means **no contract in the league ever expires again**, and nothing on screen
  would say so.
- **Do not release a contract that reaches 0 years remaining here.** It used to,
  which meant every expiring player vanished to free agency before the `RESIGN`
  phase — where the user is supposed to get a chance to extend him — ever ran.
  Leave him at 0 years remaining, still rostered, flagged as a pending free
  agent, until the end of `RESIGN`.
- **Do not demand cap compliance during `OFFSEASON` or `RESIGN`** (§2.8), for
  this exact reason: the books are mid-roll.

**Rejected — do not move `League.seasonYear` forward at the final whistle so the
two never disagree.** It is the honest shape and it is not surgery, but
`RESET_STANDINGS` closes the season's stats, awards and standings against
`seasonYear` and every one of those would have to move with it. The reader
following the ledger is the smaller change, and the figure it replaces was not
merely unexplained — it was a closed season's bill added to a new season's
salaries under an old season's ceiling. There is no honest sentence for that.

### 2.4 Run one regular-season week in this order

```
1.  read the unplayed REGULAR games for (seasonYear, week)
2.  snapshot pre-kickoff state: standings, streaks, and the win chance the
    user was actually shown for his own game
3.  simulate all games CONCURRENTLY (disjoint teams/players)
4.  if every game came back "already claimed" -> return "already played"
5.  CLAIM THE WEEK: compare-and-set week -> week + 1
6.  count played games off the rows, not off this call's own share
7.  recover fatigue and tick injury clocks, league-wide
8.  run the in-season development checkpoint (no-op on a non-checkpoint week)
9.  if the checkpoint fired, re-sort AI depth charts
10. apply shortlist attention (the only ongoing scouting input in the game)
11. tick the AI-to-AI trade market
12. maybe generate one unsolicited AI trade offer to the user
13. run in-season wire signings
14. if week + 1 > seasonLength: select All-Stars, then seed the playoffs
15. build the week report
```

Take step 2 as a real snapshot. Once the week is simulated the pre-game record
is gone, and recomputing a "pre-game" estimate afterwards against a record that
already contains the result is a lying metric.

Run step 3 concurrently. Every game in a week touches disjoint teams and
players; a sequential loop awaiting one game at a time serialises sixteen games'
worth of round trips and was the single biggest contributor to slow sim speed.

**Put the week's claim at step 5, after the games, not before.** Claiming up
front would make a timed-out request skip a week outright — marked done with
sixteen games never played and nothing to pick them up. Claiming after means a
killed function leaves the week un-advanced and the next click finishes the
unplayed games. The cost is that a duplicate click simulates games in memory it
then discards: CPU, not data.

Steps 7–13 are **league-wide statements with no per-row guard**. Run twice,
every injury heals two weeks in one and every player develops twice. The week's
claim is the only thing standing between a double click and that: exactly one of
two concurrent advances matches, and the other returns here having written
nothing.

Count step 6 off the rows rather than off this call's own share: in a race the
two callers can split the sixteen games between them, and the number on screen
should be how many games the week actually has.

**Gate step 9 on the same function that decides whether the checkpoint ran**, not
on `week % INTERVAL === 0` written out a second time. Two copies of that rule is
how a sweep ends up running on weeks nothing changed, or missing the week
everything did. It matters because development is a bulk rating update that
touches no depth chart, so a club's chart goes on ranking men by what they were
worth in week 1 — and the stat allocator hands the passing line, the targets and
the carries to the chart's order. Measured across 1,216 real clubs, **5.9% were
about to credit the wrong quarterback and 15.1% the wrong WR1**. Rejected:
sweeping every week — not for the 15–21ms, but because on the fourteen weeks
between checkpoints no rating has moved, so it is fourteen reads of every roster
in the league to write nothing.

Run step 13 after the week is claimed, so it happens exactly once per week
however many times Advance is clicked, and keep it quiet: somebody's starter
went down on Sunday and the man who can replace him is on the wire at a fraction
of what he wanted in the spring, but it must not empty the board the GM is
reading.

**Write each game in one transaction whose first statement is the claim:**

```
UPDATE game SET played = true, homeScore, awayScore, boxScore, recap
  WHERE id = ? AND played = false
if rows affected == 0: return null        # another advance got this game
```

Two concurrent advances of the same week both read the same unplayed list and
both arrive for the same game; exactly one matches a row. The loser matches zero
rows and returns before touching standings, the wire, or any player's season
line. This is what stops one week of football being counted twice — **measured,
488 passing yards a game became 955.** Put the claim *inside* the transaction
rather than as a cheaper check before it: that is what makes a killed function
safe, because everything commits or rolls back together, so a timeout mid-game
leaves the row unplayed and the next advance simply plays it.

Inside that transaction, after the claim:

- update standings, **regular season only**;
- set injury weeks and injury type for the injured; increment fatigue for
  everyone who played;
- write news rows: one injury-report row per game carrying **no** player id (it
  is about a match, not a man — "3 injury report(s) from LAX @ SDG"), plus
  per-player game headlines that **do** carry the player id, read off the box
  line they are written from;
- merge each box line into `seasonStats` **or** `playoffStats` by
  `kind === 'REGULAR'`. The stat gate used to be missing entirely, which is how
  a championship run added four games of yardage **and four games of `gp`** to a
  season line the leaderboard then ranked against a seventeen-game one.

Write every per-player effect as **one bulk statement**
(`UPDATE ... FROM (VALUES ...)`), not one awaited UPDATE per row. A 53-man-ish
box score is a hundred-plus sequential round trips per game, times sixteen games
a week.

Implement recovery as one statement:

```
fatigue      = max(fatigue - FATIGUE_RECOVERY, 0)        # 22
injuryWeeks  = max(injuryWeeks - 1, 0)
injuryType   = (new injuryWeeks == 0) ? null : injuryType
   where leagueId = ? and status = 'ACTIVE' and (fatigue > 0 or injuryWeeks > 0)
```

Clear the label and the clock **together** — they are one fact. Clearing them
separately left a man who ended the season with a torn hamstring carrying
"Hamstring" into the new one with nothing counting down. Nothing rendered it,
because every reader gates on `injuryWeeks > 0`, which is precisely why it
survived: a dangling label is invisible right up until something reads the label
first.

**Run the same recovery week between playoff rounds.** Until this was noticed it
ran on the regular-season path only, so an injury clock stopped dead the moment
the regular season ended. The owner: *"i just had an injury occur at week 17, i
simmed 2 weeks while on that player's card and the injury remained until round 2
of playoffs"*, then *"simmed again, still 2 weeks"*. A man hurt in December was
out for the whole run however short his injury was, and the postseason was the
one part of the game where injury **length** meant nothing. Fatigue was the
quieter half — four rounds of football with no recovery, accumulating hardest on
the club that keeps winning.

Put postseason recovery **inside the round-building lock** (§2.6), the only
exactly-once-per-round guarantee the postseason has: whichever advance actually
builds the next round is the one that ran the week, and a second click that
finds the bracket already there heals nobody. Run it **after** the round's games,
as the regular season does — a man carried off in the wild-card round has the
following week to get right, exactly as he would in November. Do **not** run it
after the final: there is no next round to be fit for, and the `PROGRESS` step a
click later zeroes fatigue and injury clocks outright.

### 2.5 Drive multi-week advance from the client, one call per week

Build the options from the phase actually on screen:

| phase | options |
|---|---|
| PRESEASON / REGULAR | 1 week, 3 weeks, to midseason, to playoffs, to offseason |
| PLAYOFFS | 1 round, to offseason |
| OFFSEASON | 1 step, to re-sign window |
| FREE_AGENCY | 1 week, to draft |
| RESIGN / DRAFT / FANTASY_DRAFT | **none** — resolve this stage first |

They used to be the same five regardless of phase, and once past the regular
season those targets either did nothing or silently collapsed to a one-step
advance, which read as broken. Midseason means `ceil(seasonLength / 2)`. Do not
offer "3 weeks" in free agency: the window is three weeks long, so it would be a
second button doing exactly what "to draft" does.

Loop in the client:

```
initial = getLeaguePhase(leagueId)
if stopBefore(initial.phase, initial.week, mode): toast "nothing to advance"; return
reports = []; trophy = null; calledOff = false; iterations = 0
while iterations < MAX_ITERATIONS:            # 60, a backstop not a target
    show "Working through <phase noun> <week>…"
    result = advanceWeek(leagueId)
    if result.blocked: show the refusal; return      # do not spin on a closed door
    if result.report: reports.push(result.report)
    if result.trophy and not trophy: trophy = result.trophy   # a season ends once
    phase, week = result.phase, result.week
    iterations += 1
    if stopAfter(phase, week, mode, startPhase, iterations): break   # the MODE'S target first
    if stopRequested: calledOff = true; break                       # user stop, between weeks only
```

**Build it as a client loop, not a server loop,** for three reasons:

1. **Visible progress.** One opaque server-side loop is a single static spinner
   label for however long the batch takes. Driving it a week at a time is what
   makes *"Working through week 3…"* possible.
2. **A stop is only possible if there is a seam.** Read the flag between weeks,
   where the week just written is whole and the next one has not been asked for.
   A server loop has no seam the user can reach.
3. **Serverless duration.** Each advance is one request inside the platform's
   duration limit; a seventeen-week loop in one request is not.

**Evaluate `stopAfter` before the stop flag.** If this week was the one the mode
was driving at — the playoffs arrived, a gate phase needs the user — the run
finished, and a stop pressed while it was in flight has nothing left to stop. It
must not relabel a completed run as a called-off one, and it must not swallow
the message a gate phase produces.

**Report only what happened.** Count `iterations` and `reports` from advances
that *returned*, and read the week it landed on off the last report rather than
restating it from the mode, so a run called off at week 8 cannot report having
reached the playoffs. A report reading "Weeks 3–17" after a stop at week 8 is a
fabricated figure, and that is the one failure this panel exists to avoid.

**Show one report for a multi-week advance, never one per week.** Collect every
intermediate report and fold it into a span strip (real per-week results, the
record at both ends, total games); render the **last** week in the panel, which
is where the league now stands. *"A player who asked to skip to the playoffs has
explicitly asked not to be stopped"* — and "not to be stopped" means not stopped
**by the app**; the user stopping his own run is the opposite thing, which is why
the stop flag travels with the span and the strip says so.

Allow exactly one full-screen interruption in the game — the trophy moment, at
most once per season. When the same press carries both a long span and a season
ending, make them **one** artifact (a season-end card), not two in a row: the
rule is that the trophy moment supersedes both and only ever one is on screen,
and two artifacts in a row is that rule with the corner filed off. The defect
this fixed: the player who missed the playoffs and pressed "Advance to
Offseason" got the whole span strip, and the player who **won the title** on the
same press got the ring and lost all twenty-two weeks behind it. The season you
would most want the record of was the one that threw it away.

### 2.6 Implement two layers of concurrency control

**Layer 1 — claim every transition before it does work:**

| transition | claim |
|---|---|
| a regular-season week | compare-and-set `week` (plus each game's `played` flag) |
| out of `RESIGN` | compare-and-set `phase` |
| an offseason advance | compare-and-set `week` to the far side of the whole group |
| a playoff round build | an exclusive row lock on the League row |
| contract aging | compare-and-set `contractsAgedYear` |

These guarantee **"this advance runs once."** They do **not** guarantee **"only
one advance is running."** A claim writes the new week at the very top of the
work, so a second press arriving a few milliseconds later reads the week the
first already moved, matches the claim for the **next** advance, and runs it
alongside the first.

Measured on a clone of a save taken at OFFSEASON week 1, so control and subject
started byte-identical: press one claimed at **+6ms** and ran until
**+2,628ms**; press two was made at **+7ms** and ran `ADD_DRAFT_CLASS` and
`RESIGN` through to **+5,853ms**, on top of a league whose players were still
being aged and retired underneath it. One click's worth of intent, two league
years' worth of bookkeeping, overlapping for two and a half seconds. The league
came out at `RESIGN` week 1 where one clean press leaves it at OFFSEASON week 4;
115 retirements became 102 and 663 transactions became 968.

**Layer 2 — take a lease on the league and hold it for the whole advance.**
Refuse a press that finds it held.

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

Preserve each of these decisions:

- **Use a lease, not a flag.** A boolean "advancing" column is one hard kill
  away from a save nobody can ever advance again: the request dies between the
  claim and the release, the flag stays true forever, and no move inside the
  game clears it. **The failure mode of a mutex must never be worse than the
  race it prevents.** A timestamp says both "held" and "since when", so the
  lease expires on its own and the league heals with no intervention.
- **Make the lease longer than any advance that can finish.** 90s against a
  longest serverless `maxDuration` of 60s, so a request still alive at 90 has
  already been killed by the platform; the heaviest measured single advance is
  under two seconds. A lease is only ever stolen from a request that is already
  dead — and on the day that reasoning is wrong, the per-transition claims are
  still there. **The lease is a door; they are the lock.**
- **Release only if it is still yours.** If this advance ran long enough for its
  lease to expire and another press took it, that press owns the column, and
  clearing it would hand a third press the door while two advances are running.
- **Do not use a pg advisory lock.** A session-level one lives on a pooled
  connection nobody owns for the length of a request, and a transaction-level
  one would mean holding a transaction open across the entire advance —
  including the playoff round lock, which opens its own.
- Treat the client button's own double-click guard as **an optimisation, not the
  guarantee**: the client cannot speak for a second tab, a phone, or a stale
  page. (On React 18, `isPending` goes false at the first `await`, so a naive
  transition re-enables the button while the advance is still running.)

**Put the offseason claim at the top of the work and the regular season's at the
bottom.** A week's sixteen games are individually claimed, so claiming the week
late costs a duplicate click some wasted CPU. An offseason step has no inner
guard: by the time the work is done it is already done twice, silently —

| step | run twice |
|---|---|
| `PROGRESS` | every player ages twice, develops twice, two retirement rolls |
| `RESET_STANDINGS` | every career total in the league **permanently doubled** |
| `ADD_DRAFT_CLASS` | a second set of future picks |

(Contract aging is already immune via its mark.) **Let one claim cover the whole
group**, however many steps it carries — jump the week straight to the far side,
so a second click arriving anywhere inside a running advance finds a week it
cannot match. Claiming per step inside the loop would leave a duplicate click
free to race in through the gap between two steps.

**On a throw partway, give back only what you did not do.** Put the week back to
the step that **failed**, not to the start of the advance, so committed steps are
never re-run. The residual risk is a hard kill between the claim and the
rollback, which skips the rest of the advance outright. Accept that trade: a
skipped step is visible and re-runnable, doubled career stats are silent and
permanent.

**Claim the way out of `RESIGN` with the phase.** This was the last transition
that both moved time and did non-idempotent work unguarded, and the symptom was
a misleading stack trace — a not-found error out of a contract delete on an id
read five lines earlier. The row had not vanished; the *other* advance had
already released the same man. The silent half is worse and would have outlived
it: the fringe-free-agent mint sizes its batch off a pool count, so two runners
read the same shortfall and each mint the whole of it, and the roster fill signs
two rounds of minimum deals into the same holes. Making the delete idempotent on
its own would have hidden the crash and kept both.

**Lock the playoff round builder on the League row itself.** There is no week to
compare-and-set, because the playoff branch does not move `week` between rounds.
`UPDATE league SET week = <the value it already holds>` takes an exclusive row
lock held until commit, so a second advance **blocks** on it rather than racing
past, and by the time it gets through the first has committed and its
"already built" count sees the round. Writing a column to the value it already
holds is deliberate — **the write exists for the lock, not for the data.** Both
round builders used to call create unconditionally: the games themselves are
safe, but *building* the bracket was not, and the postseason came out with two
brackets in it. Do **not** reach for a unique index on
`(leagueId, seasonYear, kind, homeTeamId, awayTeamId)` instead: the migration
would fail to apply against any live save already carrying a duplicated bracket
from this very bug, which is precisely the population it would protect.

### 2.7 Side systems the clock drives

**AI trade offers to the user** (regular season only, and off once the trade
deadline has passed): expire pending offers older than one week — visible the
week they arrive and the week after, then gone — cap the inbox at **3** pending,
then maybe generate one at `settings.aiTradeFrequency`.

**Coordinator firings** (AI clubs only, at the final whistle): fire the
lower-rated of OC/DC at any club whose win percentage is below **0.30** (roughly
five wins or fewer in a 17-game season) and replace him with a freshly generated
coach — `rating = normalClamped(55, 12, 25, 95)`,
`playCalling = normalClamped(rating, 8, 20, 99)`,
`development = normalClamped(rating, 10, 20, 99)`, `contractYears = int(2, 5)` —
then write a `FIRE` news row. **Never auto-fire a user team's staff; coaching is
the user's call.**

**AI competitive windows**, recomputed once a year at the **top of
`RESET_STANDINGS`**, the only step where all three inputs are readable at once:
`PROGRESS` has already aged and retired every roster (so the ages read are the
ones the club will **play**), the standings below are about to be wiped (so this
is the last moment the season just played is on the Team row), and the ledger
rolled at the whistle (so the books already describe the league year being
entered). Read the **men the club actually fields, in the order it plays them** —
averaging the whole 53 would have a club's window moved by its practice squad,
and averaging the best men at each position would read a lineup the club has
chosen not to field. Ask for the cap summary of `closingYear + 1` **by name**,
because the offseason claim has already moved `week` to the far side of the
advance and asking for `seasonYear` would take the post-roll branch of
`capChargeYear` and pair the old ceiling with contracts that have already
stepped. **Never touch the user's club** — his window is whatever he decides to
do. Note the defect this fixed: the recompute function had existed since the AI
was written and its own header said it ran every offseason. **Nothing called
it.** The profile was written once at league generation and never touched again,
so a club could go 3-14 four years running and still shop like a contender.

**The free-agent asking-price clock.** Wrap the phase step and read the league's
clock **before and after**: if `phase`, `week` or `seasonYear` changed, a week
happened, so increment every unsigned non-draftee's `weeksUnsigned` in one
statement. Not every click moves time — a re-sign warning, a draft on the clock
and a roster over the limit all return without advancing — and ticking on those
would let a GM age the whole market by pressing a button that told him no. Count
every phase, not just the season: a man released in April is unsigned through
the draft and through camp just as surely as he is unsigned in November.
**One race over-counts and that is the right way round:** two concurrent
advances of the same week both observe the week move, so the pool ages twice for
one week of football. Claiming the tick per step would trade that for a tick
silently **skipped** when a step is retried, and a market clock that runs slow is
a market that never clears.

### 2.8 Three refusals, and no more

Return `{ summary, blocked?, report?, trophy?, capBlock?, block? }` from
`advanceWeek`. Let `blocked` mean **time did not move**; put the reason in
`summary` and the route to a fix in the structured payload. Without a generic
`block` shape, every refusal renders under the cap panel's hard-coded "Over the
salary cap" heading, which for a roster-limit refusal is a lie.

| refusal | when | payload |
|---|---|---|
| **Advance in progress** | the lease is held | none — a busy signal, not a decision. There is nothing to fix and nowhere to send him, so show it as a toast that gets out of the way. |
| **Over the salary cap** | before any phase work | `capBlock`: shortfall plus a cut path, biggest saver first |
| **Over the roster limit** | final cuts, user club only | `block`: a title and a route to the roster screen |

Keep the cap gate narrow:

- **`REALISTIC` cap mode only.** `SIMPLIFIED` has no dead money, so a club can
  always cut straight back under and a hard stop adds nothing; `OFF` means the
  user switched the rule off and nothing may override that.
- **The user's club only.** AI clubs are enforced at transaction time, and
  halting the user's clock over a CPU club's books would be unfixable.
- **Never during `OFFSEASON`/`RESIGN`** — §2.3. The books are mid-roll:
  contracts have aged onto their next (escalating) base salary but expiring
  deals do not come off the ledger until the end of `RESIGN`. A four-season
  trace shows this window is exactly where clubs go negative **and where they
  come back on their own**, league-wide, every year. Blocking there would fire
  on almost everyone every single offseason for a condition that resolves itself
  one step later — a rule that reads as a bug. Export the "is compliance due
  now" predicate so the standing over-cap banner promises the same thing the
  gate enforces instead of threatening a block that will not happen.
- **Only while a way out still exists.** If cutting every player who frees
  anything still leaves the club over (dead money alone can exceed the
  ceiling), blocking would be a permanent soft-lock, so advance the week and let
  the standing warning carry it.

That last escape was, for a while, **the most profitable move in the game**:
going *further* over the cap switched the gate off, and every charge was swept at
the roll. Measured — $50.8M over, blocked; ten releases later at $844.0M over
with $53.3M of maximum cut relief, the identical call ran the week and the club
carried nothing into the new year. Reproduced at $978.6M over, carrying $0.
**Keep the escape** — a user must never be soft-locked — and make it cost: write
whatever a club is still over by when its season ends into the next league year
as a real charge, and say so on the cap page, the over-cap banner and the
front-office brief. **You may stand still. You may not stand still for free.**
Three sentences that said only "the week is still allowed to advance" were true
and read as *"and nothing happens"*.

---

## 3. Build the game simulation

### 3.1 Contract

```
simulateGame(home, away, settings, rng, opts) -> GameResult

SimTeamInput:
  id, abbr, name, isUser
  passRate?        # share of play calls this club passes on, THIS SEASON.
                   # Supplied by the caller because it depends on the league
                   # year, which the engine has no other way to know.
  players: SimPlayer[]
  staff:   SimStaff[]        # { role: 'HC'|'OC'|'DC'|…, playCalling, rating }
  depthOrder?: Record<position, playerId[]>     # the user-set depth chart

SimPlayer:
  id, firstName, lastName, position,
  trueOvr, trueAttrs (JSON attribute map), status, injuryWeeks, fatigue

opts: { neutralSite?: boolean, allowTie?: boolean }

GameResult:
  homeScore, awayScore
  boxScore: BoxScore
  injuries: { playerId, weeks, type }[]
  fatigue:  Record<playerId, delta>      # to ADD to each player's fatigue
```

Make the engine a **pure function of its inputs and the `Rng` handed to it** —
no database, no clock, no league lookup. Give it a seeded RNG
(`new Rng(seed-string)`; seed a week as `${simSeed || leagueId}-${phase}-${week}`
and each game as `${rng.next()}-${gameId}`) so a save replays bit-for-bit.

`BoxScore` must carry: both teams' identity, `quarters: {home:number[4],
away:number[4]}`, `finalHome`, `finalAway`, `teamStats: {home, away}`,
`lines: {home: BoxLine[], away: BoxLine[]}`, `drives: DriveResult[]`,
`units: {home:{off,def}, away:{off,def}}` rounded to 1dp (so the recap can
explain itself), and `injuries` with names and teams resolved.

`DriveResult` is `{ team: 'home'|'away', result, points, plays, yards }` with
`result` in `TD | FG | PUNT | TURNOVER | DOWNS | END_HALF`. **Declare `END_HALF`
and never produce one** — see `DRIVES_PER_TEAM` in §3.4 for why the kneel-down
drive is removed from the count instead of simulated. Write `drives` even
though the engine does not read it back: a downstream display derives the
score-differential-over-time silhouette from it, and for a long time it was
written and never read, so a 31-30 last-possession thriller and a 45-3 walkover
rendered at identical weight while the stored recap sentence correctly said "it
came down to the last possession". **The drama was already in the database; it
was being discarded at the render boundary.**

### 3.2 Compute unit ratings from the depth chart

```
isAvailable(p)       = p.status != 'RETIRED' && p.injuryWeeks <= 0
effectiveRating(p)   = max(20, p.trueOvr - (p.fatigue / 100) * 4)
REPLACEMENT_LEVEL    = 48
```

Fatigue costs up to ~4 rating points at 100. Export `REPLACEMENT_LEVEL` and have
the AI's roster valuation read **the same constant**: it has to answer the same
question when it prices a player — "what happens at right tackle if nobody is
behind him" — and the honest answer is whatever the sim would actually field
there. A second constant would let the AI price a league the engine does not
play.

```
computeUnits(players, staff, depthOrder?) -> UnitRatings

1. available = players.filter(isAvailable)          # BEFORE the chart is applied
2. group available by position
3. per position: if depthOrder[pos] is non-empty -> mergeUnnamed(group, override)
                 else                            -> sort by effectiveRating desc
4. byPosition[pos] = positionUnitRating(depth[pos] ?? [], pos)
                     for every key of OFFENSE_UNIT_WEIGHTS, DEFENSE_UNIT_WEIGHTS, K, P
5. coordBonus(s) = ((s.playCalling - 50) / 10) * COORD_WEIGHT
   hcBonus       = ((hc.rating    - 50) / 10) * COORD_WEIGHT * 0.5
6. off     = weightedSum(OFFENSE_UNIT_WEIGHTS) + coordBonus(OC) + hcBonus + OFFENSE_BASELINE
   def     = weightedSum(DEFENSE_UNIT_WEIGHTS) + coordBonus(DC) + hcBonus
   special = byPosition.K * 0.6 + byPosition.P * 0.4
```

`weightedSum(w) = Σ (byPosition[pos] ?? REPLACEMENT_LEVEL) * w[pos] / Σ w[pos]`.

```
positionUnitRating(players, position):
    weights = UNIT_DEPTH_WEIGHTS[position] ?? [1]
    sum = Σ over i of (players[i] ? effectiveRating(players[i]) : REPLACEMENT_LEVEL) * weights[i]
    return sum / Σ weights
```

An empty slot scores `REPLACEMENT_LEVEL`, so **a roster hole actually hurts**.

**The man at index 0 is the man the chart named. Do not re-derive the order from
rating.** This function once opened with
`const sorted = [...players].sort((a,b) => effectiveRating(b) - effectiveRating(a))`
and that one line was the whole of the depth chart's dishonesty. The named order
was built from chart rows, handed through the engine, and applied by
`mergeUnnamed` — three layers of machinery carrying a GM's decision all the way
to this function, which then threw it away. A GM who started his 74-overall
quarterback ahead of his 89 got the box score he asked for (the stat allocator
walks the chart order) while **every unit-weighted term the scoreboard is
computed from went on being powered by the 89**. The screen said "Set who
starts. The sim engine uses this order every game" and the engine did not. That
is this codebase's recurring defect exactly: a displayed number that is not the
number the system used.

Measured over all 8,576 clubs in 271 real saves before the sort came out
(id-ordered walk of every club, no rating-ordered sample): **50.6% of clubs'
engine rating moves** once the order is honoured, mean −0.065 rating points, p05
−0.292, worst −3.010. AI clubs move −0.0650 and user clubs −0.0718 — same
direction, same size, so honouring the chart hands the human no edge over the
thirty-one clubs he plays. Of the 33 clubs carrying no chart at all, **zero**
changed rating.

The contract `positionUnitRating` now has: **`players` must already be in the
order the club intends to play them.** `computeUnits` is the only production
caller and orders every group before calling it — through `mergeUnnamed` when a
chart exists, by rating when one does not — so an unset or empty chart still
falls back cleanly to best-available.

**Handle injuries by filtering, and add no machinery for them.** Because
`isAvailable` runs **before** the chart is applied, an injured starter is simply
not in the array, the next healthy man is at index 0 for as long as he is out,
and the chart — untouched on disk — puts the starter back the week he returns.
Verified on 74,440 (club, weighted position) cases across 8,832 clubs: promoted
74,440/74,440, slot restored on return 74,440/74,440, chart mutated 0. **Do not
add an "auto-promote" mechanism** — that would be two mechanisms for one rule.

```
mergeUnnamed(players, override):
    rank    = map(override id -> index)
    named   = players with a rank, sorted by rank
    unnamed = players without a rank, sorted by effectiveRating desc
    for p in unnamed:
        at = 0
        for i in 0..named.length-1:
            if effectiveRating(order[i]) > effectiveRating(p): at = i + 1
        order.splice(at, 0, p)
    return order
```

**An unnamed player goes immediately behind the last named player who out-rates
him, and ahead of everyone he out-rates.** This used to be "behind all of them"
via a rank of `1000 + (99 - rating)`, which was a silent failure mode rather
than a policy: a depth chart is written only by league creation and an explicit
auto-sort, and for a long time nothing wrote one when a player **arrived**. So a
player acquired by trade was on the roster, absent from the chart, and therefore
ranked behind every man at his position — **a 97-overall receiver lined up behind
a 57 and recorded nothing at all for his new club**, with no error and nothing in
the UI to show for it. Fix the arrival paths at source *and* keep this rule:
"unlisted means worst on the roster" is not a safe default to leave under a sim
that plays every game in the league. An omission is an absence of information,
not a demotion, and the only information available about an unlisted player is
his rating.

**Do not let this re-sort the named players or let an unlisted player leapfrog
one.** A GM who ranks a 74-overall rookie ahead of a 78-overall veteran means
it, and an unlisted 76 arriving does not overrule him: that 76 lands behind the
veteran, because the veteran is the last named man who out-rates him. Explicit
intent beats rating every time; rating only decides what intent never spoke to.
Have your chart-repair routine write charts using **this same rule**, so
repairing the data can never change who the sim was already going to play.

**Weights** (marked `[FRAGILE]` — do not retune casually):

| offense | w | | defense | w |
|---|---|---|---|---|
| QB | 0.34 | | EDGE | 0.26 |
| WR | 0.18 | | CB | 0.27 |
| RB | 0.07 | | DT | 0.16 |
| TE | 0.07 | | LB | 0.16 |
| LT | 0.07 | | S | 0.15 |
| RT | 0.065 | | | |
| LG / C / RG | 0.055 each | | | |

Depth weights per position:

| pos | weights |
|---|---|
| QB, LT, LG, C, RG, RT, K, P | `[1.0]` |
| RB | `[0.62, 0.28, 0.10]` |
| WR | `[0.42, 0.31, 0.19, 0.08]` |
| TE | `[0.7, 0.3]` |
| EDGE | `[0.38, 0.32, 0.18, 0.12]` |
| DT | `[0.4, 0.33, 0.17, 0.10]` |
| LB | `[0.45, 0.33, 0.22]` |
| CB | `[0.4, 0.32, 0.19, 0.09]` |
| S | `[0.55, 0.35, 0.10]` |

**Do not implement a scheme-fit term.** One existed: `schemeFit` returned 0..1
for how well a roster matched one of five named schemes, paid out as
`(fit - 0.5) * 2 * SCHEME_FIT_MAX` on **both** sides of the ball, with a
docstring claiming "Balanced schemes are never a bad fit". Measured over 96
clubs, the rating points it actually added: Air Raid **+1.04**, West Coast
**+1.34**, Balanced **0.00**, Spread Option **+1.13**, Power Run **+1.28**. A
Balanced club was not "never a bad fit" — it was **1.2 rating points behind the
field, every week**, because 0.5 is only neutral on the 0..1 scale and a typical
75-rated starter scores about 0.7. Four fifths of the league drew an
unconditional bonus and the other fifth paid for it. The owner's ruling was to
delete rather than repair: *"I don't like the bonus points for scheme fits."*
How often a club throws it now lives in the play-call rate (§3.3), where it is a
rate and not a rating bonus.

**But keep `OFFENSE_BASELINE = 0.40`.** The drive loop only reads `off - def`,
so a term on both sides mostly cancelled; what did not cancel is that the
offensive emphasis lists happened to score higher than the defensive ones —
**+1.01 mean against +0.64**, a net **+0.37** rating points of offensive edge
baked into the calibration. Deleting the term without replacing that constant
moved league scoring **−0.34 points** and total yards **−2.31 a game**,
consistently on all three seed-sets. The sweep that chose 0.40 (three seed-sets
× 8 seasons, identical rosters and seeds):

| baseline | points/g | total yds/g | verdict |
|---|---|---|---|
| +0.00 | 22.06 (−0.34) | 342.88 (−2.31) | consistent shift on all 3 seeds |
| +0.25 | 22.32 (−0.08) | 344.80 (−0.39) | no consistent shift |
| +0.30 | 22.25 (−0.14) | 344.45 (−0.74) | no consistent shift |
| +0.35 | 22.28 (−0.12) | 344.56 (−0.63) | no consistent shift |
| **+0.40** | **22.40 (+0.00)** | **345.23 (+0.04)** | lands on base to 3dp |

Base was 22.396 and 345.19. Treat it as **calibration residue made explicit, not
a mechanic**: the same number for every club in every game.

**Keep a separate on-screen team rating function, and keep it honest.** Field
the same men in the same order through the shared availability and merge
functions, so neither side owns a second opinion about who plays, but
deliberately do **not** reproduce this arithmetic: rate the starting eleven on
the 0-99 scale the player ratings beside it use, where the engine pays depth
weights out over four receivers and four edge rushers and then adds coordinator
bonuses and the offensive baseline on top. They are different scopes and cannot
be equal. What must hold is that **they never move against each other**:
measured over every club in the database, 3,026 sign agreements out of 3,027
where both respond (n=10,080), the single exception being two quarterbacks tied
on `trueOvr` and separated only by fatigue, which the engine reads and a roster
figure deliberately does not. On 13.2% of clubs the engine moves on a slot below
the starting eleven — a fourth receiver, a third linebacker — and the screen
figure stays flat, because it rates the eleven. If you change what the engine
counts, keep that pair honest.

### 3.3 Decide how often each club throws it, and to whom

Derive both from the club id and the season year rather than storing them: every
club that already exists has an id, so every club already has a tendency, with
no migration and no new column, and it is deterministic so replaying a season
reproduces it exactly.

```
PASS_TENDENCY = { LEAGUE_MEAN: 0.5725, CLUB_SD: 0.0236, SEASON_SD: 0.0403,
                  RAIL_LO: 0.25, RAIL_HI: 0.85 }

passTendency(teamId, seasonYear?):
    centre = LEAGUE_MEAN + Rng(`offTendencyCentre:${teamId}`).normal(0, CLUB_SD)
    rate   = seasonYear === undefined
               ? centre
               : centre + Rng(`offTendencySeason:${seasonYear}:${teamId}`).normal(0, SEASON_SD)
    return clamp(rate, RAIL_LO, RAIL_HI)      # a safety rail; see Rule 1
```

**Make every club a balanced offense, none balanced in exactly the same way, and
none the same balanced offense two years running.** The owner: *"Lets just have
everyone balanced, no indications needed to the player it's just background. And
it shouldn't be exactly the same across the league, there should be variance."*
Render it nowhere; let no GM choose it; use no scheme name anywhere in the game.

What this replaced and why it had to go. Five named schemes picked at league
creation and never changed, carrying pass rates from 0.46 to 0.68. Measured
across 192 real team-seasons (2019 and 2021-2025; 2020 excluded as the
empty-stadium year) the real play-call pass rate runs **mean 0.573, sd 0.0464,
min 0.438, max 0.670** — and **not one** of those 192 reached 0.68, while only
2.1% sat at or below 0.46. The game put a fifth of its clubs at each. League
spread was sd 0.0714, **1.54× the real one**, and an Air Raid club ran the ball
19.1 times a game where the most pass-happy real season on record ran 21.1. That
is what made a 90-overall back read as broken: his club's lead back took 154
carries for 684 yards against a real lead back's 217.

The shape of the real thing, by one-way ANOVA over 32 franchises × 6 seasons:

| quantity | sd |
|---|---|
| total (all team-seasons) | 0.0466 |
| within-club (this season) | 0.0403 |
| between-club (club identity) | 0.0236 |
| reconstructed `sqrt(0.0236² + 0.0403²)` | 0.0467 |

**25% of the spread is a club being what it is and 75% is the season it is
having.** Baltimore averaged 0.493 over six years and Cincinnati 0.627, but
Atlanta's own year-to-year sd was 0.076 while Denver's was 0.013.

Three designs were built and measured over three seed-sets × 12 seasons:

| design | league sd | club year-to-year sd |
|---|---|---|
| A drawn once per club, fixed | 0.0504 | **0.0000** |
| B drawn fresh every season | 0.0479 | 0.0681 |
| **C centre + seasonal drift** | **0.0486** | **0.0589** |
| REAL | 0.0466 | 0.0570 |

Reject A: year-to-year 0.0000 against a real 0.0570 is the "frozen at creation"
property, and it is the **larger** of the two real components — a club that never
varies is less like football than one with no identity at all. Reject B: 0.0681
is 1.19× too volatile **and** it throws away the quarter of the spread that is
persistent identity, so Baltimore and Cincinnati become the same franchise with
different dice. Ship C: 1.04× on league spread, 1.03× on year-to-year, the only
one right about both halves because it is the only one that has both halves.
(All three read ~1.04× rather than 1.00× because 96 clubs is a small sample of
centres and this one came out 8% wide; at 40 seasons the generator lands 1.036×
with a centre sd of 0.0255 against the 0.0236 asked for, and over 20,000 draws
the generator itself lands 1.002×. That is sampling, not bias.)

**Use separate seed namespaces for the two draws.** The obvious form —
`tend:<id>` and `tend:<id>:<year>` — shares a prefix, and a shared prefix
through a string hash is exactly the kind of thing that produces correlated
draws and therefore a league whose spread is wider than the constants ask for.
Measured over 20,000 ids the shared-prefix form is in fact clean (r = −0.015),
but the namespaced form is equally cheap and does not depend on a property of
the hash that nothing else guarantees.

Then decide **who** gets the ball:

```
ROLE_TENDENCY = { BACKFIELD_SIGMA: 0.50, TE_SIGMA: 0.32 }

roleTendency(teamId, seasonKey):
    draw(axis, sigma) = exp(Rng(`role${axis}:${seasonKey}:${teamId}`).normal(0, sigma))
    return { carryFocus: draw('Backfield', BACKFIELD_SIGMA),      # EXPONENT on the carry prior
             teEmphasis: draw('TightEnd',  TE_SIGMA) }            # MULTIPLIER on the TE slice
```

Use **lognormal** so the exponent stays positive: at 0 the prior flattens to an
even committee, which is a real offence; below 0 it would invert the depth
chart, which is not. This shapes rather than clamps, per Rule 1.

What it fixes. Targets and carries were shared out from one league-wide vector
tilted only by rating, so every club fed its lead back the same share of its
carries and its number-one receiver the same share of its targets. Measured over
24 replayed league-seasons:

| leader | median | p90 | max | real NFL |
|---|---|---|---|---|
| rush attempts | 260 | 266 | 272 | 300-380 |
| rushing yards | 1,373 | 1,505 | 1,515 | 1,700-2,000 |
| receptions | 126 | 128 | 130 | 110-135 |
| TE receiving yards | 749 | 823 | 824 | 1,000-1,200 |

**Look at the spread, not the level.** Twelve yards separate the median
league-year's leading rusher from the best of twenty-four. Real leader boards
have long tails because real clubs choose very different offences with the same
personnel: in 2022 Josh Jacobs carried 340 times for 1,653 yards, **82%** of his
club's rushing yardage, and the flat vector's best case is a back on 57% of his
own backfield's carries. **The level cannot be fixed without the spread** —
raising the league-wide share far enough to reach an 82% workhorse would make
every club in the league one and delete the second and third backs from the box
score.

Sigmas are fitted to real shares, one per axis: a lead back's share of his
backfield's carries runs about 0.40 to 0.88 with sd ~0.13, and sigma 0.50 puts
the league's leading rusher on **379 carries for 1,668 yards** against a real
300-380 and 1,700-2,000; a club's tight ends' share of its targets runs 0.12 to
0.30 about a mean of 0.21, and sigma 0.32 puts the leading tight end on
**1,022** receiving yards against a real 1,000-1,200, up from 749.

**Do not add a third axis for the number one receiver.** It was built and swept
alongside these two over 12 replayed league-seasons:

| sigma | leader receptions | leader receiving yards |
|---|---|---|
| 0.00 | 133 | 1,727 |
| 0.05 | 137 | 1,722 |
| 0.10 | 145 | 1,782 |
| 0.12 | 147 | 1,807 |
| 0.30 | 199 | 2,280 |

(real: 110-135 catches, 1,700-1,900 yards.) Rejected at every non-zero value,
because the number it moves is the one number on the receiving line that was
already right: the engine's WR1 takes 30% of his club's targets before any of
this, which is already the top of the real range — CeeDee Lamb led the NFL in
2023 on 30.7% — so the club-to-club spread has nowhere to go but past it, and at
three sigma over 384 club-seasons it produces a 199-catch season. **The
receiving record book needed yards per catch, not more catches** (§3.6).

`seasonKey` is a compromise worth stating plainly: the engine does not know what
year it is, and the one season-varying number already in its hands is the pass
rate, which is a club centre plus a seasonal draw and therefore a fingerprint of
the pair. Hash it to get a role draw that moves with the season and is
statistically independent of the rate's **value**, because the hash destroys the
ordering. If you plumb a season year into the engine's input, pass it here
instead; nothing else has to change. **What must not change is that the key
varies by season**, or every club is frozen into one role forever — design A,
rejected above.

### 3.4 Resolve the game: drive-based, not play-based

Randomness enters at exactly three levels, and that is what keeps results
football-shaped rather than deterministic:

1. **Game form** — one roll per team per game ("they came out flat").
2. **Drive noise** — per-possession variance.
3. **Event rolls** — turnovers, TD-vs-FG, kick success, injuries.

`settings.simVariance` scales **1 and 2 together**. At 0 the better team wins
almost every time; at 2 the league is chaos. Default 1.0.

```
variance = max(0, settings.simVariance)
diff     = DIFFICULTY_MODS[settings.difficulty]
aiTilt(t)= t.isUser ? 0 : diff.aiUnitBonus         # difficulty tilts every AI team, never the user's

homeUnits = computeUnits(home...)   awayUnits = computeUnits(away...)

homeForm = rng.normal(0, GAME_FORM_SD * variance)      # GAME_FORM_SD = 2.4
awayForm = rng.normal(0, GAME_FORM_SD * variance)
hfa      = (settings.homeFieldAdvantage && !opts.neutralSite) ? HOME_FIELD_EDGE : 0    # 2.0

homeOff = homeUnits.off + homeForm + hfa       + aiTilt(home)
homeDef = homeUnits.def + homeForm + hfa * 0.5 + aiTilt(home)
awayOff = awayUnits.off + awayForm             + aiTilt(away)
awayDef = awayUnits.def + awayForm             + aiTilt(away)
```

Home advantage is **2.0 rating points on the home offense and half that on the
home defense**. Difficulty bonuses: `EASY −1.5`, `NORMAL 0`, `HARD +2.25` (also
carrying `aiSharpness` 0.75 / 0.90 / 1.05 and `userScoutPenalty` −3 / 0 / +3,
which the engine does not read). HARD sits between the old All-Pro and Legend
rather than at either: Legend's 3.0 unit bonus was a bigger edge than the gap
between a playoff team and a bad one, which read as unfair rather than hard.

Then run `DRIVES_PER_TEAM = 10` iterations, and inside each, **away first then
home** — the away team receives the opening kickoff by convention:

```
for d in 0..drivesPerTeam-1:
    quarter = clamp(floor((d / drivesPerTeam) * 4), 0, 3)
    runDrive('away', awayOff, homeDef, quarter)
    runDrive('home', homeOff, awayDef, quarter)
```

**`DRIVES_PER_TEAM` is 10, not the 11 a real team takes the field for.** A real
team gets about 11.2 possessions, but roughly **1.4** of them are the drive that
ends a half or the game — a kneel-down, or two snaps and the clock — and this sim
has no such outcome. Real football's **~9.8 live drives** is what this constant
governs. That gap was the last irreducible part of a yardage surplus: with
per-drive yardage corrected to real drive lengths, the engine still floored at
~381 total yards a team-game at 11 drives against a real ~330, because 26% of
its drives end in a touchdown (2.86 a game against a real 2.2) and **a touchdown
drive is 66 yards by geometry — you cannot shorten it without moving the end
zone.** Removing the drive real football spends kneeling is the honest way to
remove those yards. It takes scoring from 24.4 to 22.2 a team-game, which reads
like a step past the real ~22.5 and is not: every point this sim scores is
scored by an offence, where about 1.8 of a real team's 21.8 come from returns,
defensive scores and safeties this engine does not simulate. Against real
**offensive** scoring of ~20 a game, 22.2 is still a little hot. If you mirror
this value anywhere as a literal (an overtime detector needs it), move both
together.

### 3.5 One drive

```
runDrive(side, off, def, quarter):
    edge  = off - def
    noise = rng.normal(0, DRIVE_NOISE_SD * variance)          # DRIVE_NOISE_SD = 1.15
    pin   = pinned[side]; pinned[side] = 0                    # see punting below

    scoreProb = clamp(SCORING_DRIVE_BASE + edge * EDGE_TO_SCORE_PROB
                        + noise * 0.05 - pin,  0.04, 0.86)    # 0.38, 0.012
    toProb    = clamp(TURNOVER_RATE_BASE - edge * 0.0025, 0.02, 0.28)   # 0.11

    roll = rng.next()
    if roll < toProb:                                  # TURNOVER
        yards = round(rng.normal(24, 16));  plays = rng.int(3, 6);  turnovers += 1
    else if roll < toProb + scoreProb:                 # a scoring drive
        tdShare = clamp(TD_SHARE_BASE + edge * EDGE_TO_TD_SHARE, 0.22, 0.82)   # 0.55, 0.008
        if rng.bool(tdShare):                          # TD
            points = 6; yards = round(rng.normal(66, 18)); plays = rng.int(5, 10); td += 1
            k = byPosition.K ?? 55
            xpa += 1
            if rng.bool(clamp(0.90 + (k - 60) * 0.0025, 0.85, 0.995)): points += 1; xpm += 1
        else:                                          # FG attempt
            yards = round(rng.normal(45, 16)); plays = rng.int(4, 9); fga += 1
            k = byPosition.K ?? 55
            if rng.bool(clamp(0.72 + (k - 60) * 0.006, 0.55, 0.96)): points = 3; fgm += 1
            else: result = 'DOWNS'
    else if rng.bool(0.12):                            # DOWNS
        yards = round(rng.normal(34, 18)); plays = rng.int(5, 10)
    else:                                              # PUNT
        yards = round(rng.normal(12, 14)); plays = rng.int(3, 7); punts += 1
        punter    = byPosition.P ?? REPLACEMENT_LEVEL
        receiving = (side == 'home') ? 'away' : 'home'
        pinned[receiving] = (punter - PUNTER_BASELINE) * PUNT_PIN_PER_RATING

    yards = max(-8, yards)
    accumulate yards, plays, points;  quarters[side][quarter] += points
    drives.push({ team: side, result, points, plays, yards })
```

**There is no field position in this engine at all.** A drive is a number of
yards and a number of points, never a place on a field, so "he pinned them on
their own 8" has nowhere to land. Do not add geometry; write down what the
geometry is **for** — a good punter makes the other team's next possession less
likely to end in points.

The yardage and play-count constants are calibrated against real per-drive
figures (a pass took total yards from 408.8 to 344.6 against a real ~330). **The
checkable figure is the total, not any one branch.** An NFL team runs about 62
offensive plays a game, of which ~2.3 are sacks this engine counts separately
and never puts in the play count — so `plays`, which is exactly
`passAtt + rushAtt`, should come to about **60**. It was 75, and the surplus was
spread across all five branches. Reasoning per branch:

- **Turnover**: plays was `int(3, 7)` (mean 5). A drive that ends in a giveaway
  is cut short *by* the giveaway — the pick or the strip is what ends it, not a
  long grind — so it runs under the 5.6-play average rather than over it. The
  24-yard mean is right against a real ~26 and is untouched.
- **TD**: plays was `int(6, 13)` (mean 9.5) on a drive that really runs about
  seven snaps. The 66-yard mean beside it was already right and is untouched —
  a drive starting at your own 28 has to cover that ground.
- **FG**: plays was `int(5, 11)` (mean 8). Same apportionment: a field-goal
  drive stops short of the end zone by definition, so it is shorter in yards
  and a little shorter in snaps. 6.5 against the touchdown branch's 7.5.
- **Punt**: yards was `normal(19, 15)`, and this is the branch the engine had
  badly wrong — it is **41% of all drives** so it carried the surplus on its
  own. An NFL team gains ~330 net yards over ~11.2 drives; subtract what its
  ~2.2 touchdown drives (68 yards each) and ~1.6 field-goal drives (44) took,
  and the ~4.5 drives it punts on are left with a little over a first down's
  worth of ground apiece — **about 13 yards**. Use 12 rather than 13 because
  `max(-8, yards)` clips the negative tail and lifts the realised mean by
  roughly 0.7.

**Punting: write the pin against the receiving side and read it off the punting
side's own punter.** Write it long-hand rather than as a ternary inside the
index, because a sign or side error here balances out league-wide (every club
both punts and receives) and would never show up in an aggregate — it would only
reverse who benefits.

Apply the pin to **scoring probability and nothing else**, for two reasons, one
about football and one about this file. Drive yardage here is measured from the
line of scrimmage, and being backed up does not shorten what you gain; if
anything a team starting on its own 8 has *more* room to gain yards before it
punts. Field position is a fact about how far you must go to score, which is
what scoring probability is. And the five yardage-and-plays constants above had
just been calibrated when this was written, so reaching into them for a
special-teams nudge would re-open that with no way to tell the two effects
apart. **Outcome mix moves; the shape of each outcome does not.** Measured
after: total yards 344.6 → 344.7.

**Clear the pin on read**, so an unconsumed pin — the last punt of the game,
whose receiving team never takes the field again — expires instead of leaking
into a later possession. That costs the **home** punter about a tenth of his
effect and is left alone: the loop runs away-then-home, so the home side's
tenth-drive punt is the only one with no possession behind it. Measured over
150,000 paired games, a 99 punter is worth **0.300 points a game at home and
0.337 away**, and 0.300/0.337 = 0.89 — nine tenths, the artifact stating itself.
Real football does the same thing for the same reason: the last punt of an
afternoon is usually followed by a kneel.

**Overtime.** If tied after regulation:

```
if homeScore == awayScore:
    if !(opts.allowTie ?? true) || !rng.bool(OVERTIME_TIE_CHANCE):      # 0.06
        guard = 0
        while homeScore == awayScore && guard++ < 6:
            homeOtValue = homeOff - awayDef + rng.normal(0, 6 * max(0.2, variance))
            awayOtValue = awayOff - homeDef + rng.normal(0, 6 * max(0.2, variance))
            if |homeOtValue - awayOtValue| < 0.5: continue
            winner = higher value;  pts = rng.bool(0.55) ? 3 : 7
            add pts to winner's score and to quarters[winner][3]
            drives.push({ team: winner, result: pts==7?'TD':'FG', points: pts, plays: 8, yards: 55 })
```

Note that those 55 yards are pushed into the drive list and **never added to the
team's total**. That is one of two known, deliberate warts the box-score harness
allows a tolerance for (§10) — leave it, and leave the harness's tolerance
documenting it, rather than silently papering over either.

### 3.6 Derive the rest of the team line

```
sacksTaken(home) = max(0, round(rng.normal(SACKS_PER_GAME + (awayUnits.EDGE - homeUnits.LT) * 0.04, 1.3)))
sacksTaken(away) = max(0, round(rng.normal(SACKS_PER_GAME + (homeUnits.EDGE - awayUnits.RT) * 0.04, 1.3)))
intsThrown(side) = round(turnovers(side) * clamp(INT_SHARE_OF_TURNOVERS + rng.normal(0, 0.12), 0, 1))
```

`SACKS_PER_GAME = 2.3`, `INT_SHARE_OF_TURNOVERS = 0.62`.

**2.3, not 2.6.** A note once raised it to 2.6 claiming that was "the real league
average" and 2.3 was low. It is the other way round: the NFL has run between
1,240 and 1,300 sacks a season for a decade, which over 32 clubs and 17 games is
**2.28 to 2.39** a team a game, and the `max(0, round(...))` lifts the realised
mean a touch above whatever is set. What was actually starving the record book
was the allocator underneath it, which walked the defenders rolling a coin and
could credit no man more than one sack in a game — so a fifth of the sacks the
team line claimed reached nobody, and no season could build a tail. Fixing the
allocator and raising this double-counted the same complaint and put
2.6 × 17 = 44 sacks on a team that should record about 39.

**Roll the interception share of turnovers ONCE, here.** Two different places
used to guess it separately: the quarterback's line rolled `turnovers * ~0.62`
and the opposing secondary was handed `turnovers - round(turnovers * 0.35)` —
two rolls of the same event, so the box score could say a passer threw three and
the defence that faced him caught two. One number, read by both sides.

**Injuries** (only when `settings.injuriesEnabled`), for every available player
on both teams:

```
durability = trueAttrs.durability ?? 60
rate       = INJURY_RATE_PER_GAME * (1 + (60 - durability) / 200)      # 0.032
if rng.bool(rate):
    weeks = max(1, round(rng.normal(INJURY_WEEKS_MEAN, 1.8) * settings.injurySeverity))   # 2.6
    type  = rng.pick(weeks <= 2 ? SHORT : weeks <= 5 ? MEDIUM : LONG)
```

Bucket the flavour text by how long it actually keeps someone out: short
(`Bruised ribs`, `Ankle sprain`, `Concussion protocol`, `Shoulder stinger`,
`Deep bruise`), medium (`Hamstring strain`, `Groin strain`, `High ankle sprain`,
`Fractured hand`, `MCL sprain`), long (`Torn ACL`, `Achilles rupture`,
`Fractured fibula`, `Torn labrum`, `Broken collarbone`). Durability is a real
attribute — a brittle player gets hurt more.

**Fatigue**, for every available player on both teams:

```
fatigue[p.id] = round(FATIGUE_PER_GAME * (0.5 + rng.float(0, 0.8)))    # 18
```

Starters wear down more than the end of the bench in expectation, though this
particular form is a flat per-player roll; see §9 item 11 for the honest note on it.

### 3.7 Measured specialist effect sizes

Every position was swapped between a **99 and a 40** in the sim on identical
rosters and seeds, and the difference scored as the points a club gains plus the
points it denies, per game, over 40,000-150,000 paired games each:

| position | points/game swing, 40 → 99 |
|---|---|
| starting CB | 5.24 (whole group 13.11 × 0.40 weight) |
| starting S | 4.00 (whole group 7.27 × 0.55) |
| **K** | **2.21** (1.68 field goals a game vs 1.06) |
| **P** | **0.32** |

Over a 17-game season that is **≈37.6 points for the kicker across the 59-point
rating swing — about 0.64 points per season per rating point** — and **≈5.4
points for the punter, about 0.09 per season per rating point**. Hold your
implementation to the per-game figures above, which are the ones actually
measured; treat the per-season-per-rating-point restatement as arithmetic on
them, not as an independent measurement. (The punter figure is corroborated
separately: 0.300 pts/game at home and 0.337 away for a 99 punter against the
72-rated baseline, measured over 150,000 paired games.)

Use those figures to set how badly a club wants to upgrade a mediocre starter —
against a starting safety at 1.00, **the kicker is 0.55 and the punter 0.08**.
Both were 0.25 on the note that a below-average kicker or punter is "real but
nowhere near as urgent… since these positions touch the game far less and are
trivially replaceable off the street". Two things were wrong with that: it gave
K and P the same number when they are not remotely the same size, and **0.25 does
not mean "less urgent", it means never** — with a need term of
`clamp((72 - starter)/18, 0, 1) * weight` landing at 0.75× and free agency
bidding above 0.15, the ceiling of the whole term at 0.25 is 0.1875, so a club
shopped for a kicker only if its own rated 57 or worse, one point above the
generator's roster floor. Measured over 4,000 generated clubs: **1.8% of them**.
That is a closed specialist market expressed as a constant — the owner: *"there
is no kicker or punter available for trade in the trade hub"*. At 0.55 a club
shops for a kicker when its own rates below 66, which is **17.8%** of generated
starters, roughly six clubs in a league of 32. At 0.08 a club never upgrades a
punter at all, and that is the honest answer for a third of a point a game: he
is worth having and he is not worth a roster move. Keep an **empty** punter slot
an emergency — that is the count-based need term's job and this weight must not
touch it.

**A kicker is not "trivially replaceable".** He is worth more than half a
starting safety, because his rating swings field goals from 60% to 95% and the
club takes 1.8 of them a game.

### 3.8 Punting constants, and why each is sized the way it is

The owner, on finding that a punter's average was `punts * rng.int(40, 50)`:
*"Wait a punter is not actually based on their rating? That's not good… Special
teams has a smaller, but measurable impact on a teams success."* And on the fix:
*"I think the punter should matter. it should be slight, but it should impact
things."* **Slight is the binding word; size everything below to it.**

| constant | value | why |
|---|---|---|
| `PUNTER_BASELINE` | 72 | **Measured, not assumed:** 2,000 generated rosters put the best punter on the roster at mean **72.1**, sd 6.7, p5 61, p95 83. Do **not** reuse the engine's `UNIT_BASELINE` of 60 here — that constant is nothing like the middle of anything (measured, a team's offensive unit score means 80.1 and its defensive 76.2) and it gets away with being wrong because the only thing that reads it is a **difference**, where a shared offset cancels. The two terms below are absolute: they turn one man's rating into yards and into a probability, with nothing to cancel against. Centred at 60, every punter in the league would come out above average and the whole league would punt like a Pro Bowler. This is a fact about your player generator — if that changes, re-measure it. |
| `PUNT_GROSS_BASE` | 45.5 | The NFL's league-wide gross punting average has sat between **45.3 and 46.0** every year for a decade (45.6 in 2023). 45.5 is the middle of that band. |
| `PUNT_GROSS_PER_RATING` | 0.16 | **The checkable figure is the shape of the league, not this number.** Real qualifying punters run roughly 42.5 to 50 gross — the whole league inside about eight yards — and the best season ever punted is 50.4 (2022). At 0.16 a 99 means 49.8 (the best season in a typical league, with an all-time year needing luck on top of him rather than being his baseline), a p5 starter (61) means 43.7, a p95 (83) means 47.3, and per-punt noise widens the realised league to about 42-49 across 32 clubs. Deliberately gentle: a steeper slope would fit the observed spread a shade better and hand a 99 punter a 52-yard average, which no one has ever done over a season. |
| `PUNT_GROSS_SD` | 9.5 | Real gross punt distance has sd near 9-10 yards — **a shank and a 60-yarder are both ordinary** — and that is what makes a punter's season average settle only over a full season rather than over an afternoon. Over ~68 punts a season this is worth about 1.15 yards of noise on the average, which is real and is **not to be tuned away.** |
| `PUNT_PIN_PER_RATING` | 0.00026 | **Sized against a checkable figure.** In real football the gap between the best and worst net-punting teams is worth on the order of a third of a point a game. This engine punts about 4.0 times a team-game and a scoring drive is worth about 4.9 points, so the swing between a 99 punter (+27 over baseline) and a 40 (−32) is `4.0 × 59 × PUNT_PIN_PER_RATING × 4.9` points a game — **0.30 at 0.00026, the target.** Anything measuring above about half a point a game across that same 59-point spread is too strong, and this is the number to turn down. |

Draw **each punt on its own**, around a mean the punter's rating sets:

```
gross = PUNT_GROSS_BASE + (effectiveRating(punter) - PUNTER_BASELINE) * PUNT_GROSS_PER_RATING
puntYds = Σ over own.punts of round(rng.normalClamped(gross, PUNT_GROSS_SD, 15, 75))
```

Two things were wrong with `punts * rng.int(40, 50)` and only one of them was
the rating. The other is that **a season of it never converged**: every punt a
man hit in a given game travelled the same distance, so his season average was
an average of seventeen numbers rather than of sixty-eight, and his career line
stayed noisy forever — while `puntAvg` is a column on his player page and the
only merit stat he is scored on. It was measuring nothing. The `[15, 75]` clamp
here is a safety rail that almost never fires: what it rules out is a negative
punt, which is not a thing.

Read **his** effective rating rather than the unit figure, even though they are
the same number today (P's depth weight is `[1.0]`): this is his line and it
should follow the man who kicked them if that weighting ever changes. But fall
back to `REPLACEMENT_LEVEL`, not to the kicker's 55 default, when there is no
punter — a club with no punter fields the guy off the street, and that is what
the rest of the engine already prices him at.

### 3.9 Constants that exist and are never read — delete or wire them

`UNIT_BASELINE: 60`, `BASE_POINTS_PER_DRIVE: 1.85` and `RATING_TO_PPD: 0.028`
are declared in the tuning table with docstrings implying the drive loop uses
them. **Nothing reads any of the three.** The live drive loop is probability-
based (`SCORING_DRIVE_BASE`, `EDGE_TO_SCORE_PROB`, `TD_SHARE_BASE`,
`EDGE_TO_TD_SHARE`), not points-per-drive-based. Either delete them or build a
points-per-drive model that actually uses them, but do not ship a constant whose
docstring describes behaviour the engine does not have — that is the same class
of defect as a displayed number the system did not use.

---

## 4. Build statistics: allocation, accumulation, and the specialist formulas

### 4.1 The stat shape

One optional-numeric bag, used for a game, a season, a postseason and a career
alike, so the merge is a single field-by-field sum:

```
SeasonStats = {
  gp?
  passAtt? passCmp? passYds? passTd? int?          # passing
  rushAtt? rushYds? rushTd? fum?                   # rushing
  targets? rec? recYds? recTd?                     # receiving
  tackles? sacks? defInt? pd? ff?                  # defense
  fgm? fga? xpm? xpa? punts? puntYds?              # kicking / punting
}

mergeStats(a, b) = { ...a } with every numeric key of b added into it
```

Store four JSON columns on the player: `seasonStats`, `playoffStats`,
`careerStats`, `careerPlayoffStats`. **`seasonStats` and `careerStats` are
regular season only; the postseason has its own pair.** A 4,300-yard year and a
4,300-yard year plus a playoff run are not the same achievement, and nothing in
the game may treat them as one.

`fum` is declared and no engine path ever writes it. Either produce fumbles
lost or drop the key; do not leave a column the UI can read as zero-meaning-none
when it actually means never-recorded.

### 4.2 Which positions get a line at all

The allocator writes a line for: **the quarterback (1), three backs, four
receivers, two tight ends, fourteen defenders (LB 3, S 2, CB 3, EDGE 3, DT 3),
the kicker and the punter.** It writes **nothing for the offensive line, ever.**

That is a decision with consequences you must carry through the whole system:

- A lineman has no production to rank, so he is **not** All-Star eligible and
  the roster does not pretend otherwise. The alternative is picking linemen by
  rating, which is exactly the lie the feature exists to delete. **A missing
  lineman is honest; a lineman named All-Star because his overall is 88 is
  not.**
- A lineman's playing-time role reads **`null`, not zero** (§7.5). Scoring it 0
  would tell the model every starting left tackle in the league is a healthy
  scratch.
- A lineman never carries a stamped end-of-season rating, so his year-over-year
  chip never renders. Measured on one champion's 49 men: 31 had a stat row and
  **0 of 10 linemen did**. That is why a champion's roster needs its own table
  (§5.4) rather than being inferred from stat rows.

### 4.3 Allocate individual lines top-down from team totals

Work **top-down**: the team's yards are already decided by the drive sim, so the
box score can never disagree with the score — and once counts are drawn rather
than coin-flipped, neither can its touchdowns, sacks or interceptions disagree
with the team line above them.

```
allocateStats(rng, team, units, own, opp) -> BoxLine[]

passRate   = team.passRate ?? passTendency(team.id)
totalYards = max(120, own.yards)                     # the floor; see §10 INV-22
passYardShare = (passRate * 6.3) / (passRate * 6.3 + (1 - passRate) * 4.3)
passYards  = round(totalYards * clamp(passYardShare + rng.normal(0, 0.06), 0.35, 0.86))
rushYards  = totalYards - passYards

passAtt    = max(12, round(own.plays * passRate + rng.normal(0, 3)))
rushAtt    = max(8,  own.plays - passAtt)
```

**Split yards by yards-per-attempt, not by the play-call rate.** Yards used to
be split on `passRate` directly — the rate at which a team **calls** a pass —
which silently assumes a run gains as much as a pass. It does not: across the
NFL a pass attempt nets about **6.3** yards and a carry about **4.3**. Calling
57% passes therefore produces about **67%** of the yardage through the air, not
57%.

Measured over 3,000 saved games the league ran 240 passing and 185 rushing yards
a team a game — a 57/43 split where real football is 66/34 — and the consequence
landed on the trophy shelf: across 107 saved league-years the leading rusher
gained **2,208** yards against the leading receiver's **1,435**, where in the
NFL those two are level at about 1,700 each. A back who outgains every receiver
by half then adds six points a touchdown cannot be beaten to an offensive award,
and he never was.

```
LEAGUE_PASS_YARD_SHARE = passYardShareFor(PASS_TENDENCY.LEAGUE_MEAN)   # 0.6624

passTdShare = clamp(PASS_TD_SHARE + TD_SPLIT_SCHEME_SLOPE
                      * (passYards / totalYards - LEAGUE_PASS_YARD_SHARE), 0.2, 0.9)
passTd      = round(own.td * clamp(passTdShare + rng.normal(0, 0.12), 0.2, 0.9))
rushTd      = max(0, own.td - passTd)
```

`PASS_TD_SHARE = 0.62`, `TD_SPLIT_SCHEME_SLOPE = 0.8`.

**Derive the league-wide air share from the league mean pass rate rather than
writing it down**, so retuning the play-call rate cannot silently move the
pass/run touchdown split off `PASS_TD_SHARE`. (Anchoring on the league mean
gives 0.6624; averaging the function over a spread of rates gave 0.6602, and
computed exactly over the tendency distribution it would be 0.6617 — Jensen's
inequality, since the share function is concave. The 0.0007 gap is immaterial
against a per-game noise term of sd 0.06 and is not worth an integral in a hot
path.)

**Make the touchdown split slide with the realised yardage split**, read off the
game's **actual** yards rather than off the season rate: a game a team happened
to run the ball in is a game it happened to score on the ground in, and using
the flat season rate throws that coupling away for nothing.

Why the slope exists. The split used to be a flat constant for every club while
the **yardage** split ten lines above it already moved with how often the club
threw — two halves of one box score disagreeing about whether a team runs the
ball. Measured over 120 league-seasons (labelled with the five since-deleted
scheme names; read them as five points on the play-call-rate axis):

| pass rate | team rush att/g | his rush yds | his rush TD | yds per TD |
|---|---|---|---|---|
| 0.46 | 32.3 | 1,349 | 8.3 | 163 |
| 0.55 | 27.1 | 1,072 | 8.5 | 126 |
| 0.57 | 25.7 | 990 | 8.1 | 122 |
| 0.60 | 24.0 | 926 | 8.6 | 108 |
| 0.68 | 19.3 | 689 | 8.6 | 80 |

The yardage column **doubles** and the touchdown column does not move at all, so
the yards-per-touchdown column runs **backwards**: the club that ran it 32 times
a game needed twice as many yards per score as the one that ran it 19 times.
Real football is emphatically not like that — in 2023 the most run-heavy NFL club
scored 24 rushing touchdowns and the most pass-heavy 10, a 2.4× spread at team
level and about 1.9× once the quarterbacks are taken out. This engine's spread
was **0.97×**. The visible symptom is a back who scores fourteen times on 653
yards, one every 47: each number individually defensible, the pair reading as
broken.

The sweep that chose 0.8 (same 120 league-seasons; the two TD columns are the
most run-heavy and most pass-heavy rates above; last column counts lead-back
seasons pairing ≥13 rushing TD with <700 rushing yards, out of 3,840):

| slope | run-hvy TD | pass-hvy TD | ratio | rush TD leader | pass TD leader | 13TD & <700yd |
|---|---|---|---|---|---|---|
| 0.0 | 8.3 | 8.6 | 0.97× | 15.4 | 42.5 | 17 |
| 0.4 | 9.3 | 7.7 | 1.21× | 15.7 | 42.8 | 3 |
| 0.6 | 9.8 | 7.3 | 1.34× | 16.0 | 43.2 | 1 |
| **0.8** | **10.4** | **6.7** | **1.55×** | **16.4** | **43.7** | **0** |
| 1.0 | 10.9 | 6.3 | 1.73× | 16.8 | 44.7 | 0 |
| 1.5 | 12.0 | 5.2 | 2.31× | 18.2 | 46.3 | 0 |

The pathological pairing is gone by 0.8 **without a cap being placed on either
number** — the arithmetic simply stops producing it often. Reject 1.0 and above
**on the passing side, not the rushing one**: a league-year's leading passer
already throws 42.5 touchdowns here against a real 38-40, and at 1.0 the best of
120 league-seasons reaches 60 and at 1.5 it reaches 63 — past the real all-time
55, and past the top of the record band a brand-new league is seeded with
(53-58), which would make the seeded record beatable in year one. At 0.8 the
best of 120 is 58, exactly where the unchanged engine's own tail already sits on
a second seed-set. Reject 0.4 and 0.6 from the other end: they leave the spread
at 1.21-1.34× against a real ~1.9× and still leave the
13-touchdown-on-650-yards season on the table. 0.8's 1.55× is deliberately short
of the real ~1.9× — that last stretch costs more in the passing record book than
it buys in the rushing one, and the two cannot be bought separately because
**they are the same touchdown.**

Note what this does and does not do: it moves touchdowns between the run and the
pass **within** a club; it creates and destroys none; and a club's **points** are
decided upstream in the drive loop and never see it. Measured across 120
league-seasons on identical seeds, the league's share of touchdowns through the
air is 62.7 / 62.8 / 62.8% before and 62.8 / 62.5 / 62.8% after, on three
seed-sets.

### 4.4 Share work out multiplicatively, never additively

```
TALENT_TILT = 0.9

shareWeights(ratings, prior):
    mean = mean(ratings)
    raw  = for each i:  (prior[i] ?? last prior ?? 0.1) * max(0.3, 1 + TALENT_TILT * (ratings[i]/mean - 1))
    return raw normalised to sum 1
```

**Multiply the prior by the talent tilt. Do not blend them additively.** This
used to return `prior * 0.65 + (rating / ratingSum) * 0.35`. The second term is
very nearly uniform — everyone at a position rates within a few points of
everyone else, so `rating / ratingSum` sits close to `1/n` for all of them — and
adding a flat 35% to every name pulls the whole vector towards an even split.
**The longer the list, the harder it pulls**: over the fourteen defenders it
turned a 1.60-to-0.55 spread of positional priors into a **7.3%-to-7.1%** spread
of actual tackles. The prior was written and then thrown away, and the docstring
above it went on describing the intent for as long as it took somebody to
measure the box score.

Multiplying preserves the prior's shape exactly when a group's ratings are level
and tilts it when they are not, which is what "the depth chart matters more than
raw rating" was always supposed to mean. At `TALENT_TILT = 0` the chart decides
everything; at 1 a man rated a tenth above his group's mean sees about a tenth
more of the work. Floor the tilt at **0.3** so a replacement-level fill-in still
takes some of the snaps he is on the field for rather than vanishing from the
box score.

Two shaping helpers:

```
shapePrior(prior, focus) = prior.map(w => pow(max(0, w), focus))   # the role exponent
concentrate(w, power)    = w.map(x => pow(max(0, x), power))       # sharpen toward leaders
SCORING_CONCENTRATION = 1.2
```

`SCORING_CONCENTRATION` is how much more concentrated scoring is than yardage —
red-zone looks go to the men you trust, so a lead receiver's or lead back's
share of his team's touchdowns runs above his share of its yards. Apply it as an
**exponent on the yardage weights**, so it sharpens an ordering that already
exists rather than inventing a second one. It was tuned **down** from 1.5, which
put the league's leading receiver on 23 touchdowns against a real leader's 15.

### 4.5 Deal whole events out to names — never flip a coin per player

```
allocateCounts(total, weights, rng):
    out = zeros
    if total <= 0 or weights empty: return out
    sum = Σ weights;  if sum <= 0: out[0] = total; return out
    for n in 0..total-1:
        roll = rng.float(0, sum);  i = 0
        while i < weights.length - 1 and (roll -= weights[i]) > 0: i++
        out[i] += 1
    return out
```

**This is the fix at the centre of everything else.** Touchdowns, sacks and
interceptions used to be dealt by walking the list and rolling a coin at each
name — `sacks = 1` if it came up heads and the pool was not empty, and **never
more than one, ever.** Two things fell out of that:

1. **The box score did not add up.** Measured over 3,000 saved games, **23% of
   passing touchdowns thrown were caught by nobody** and **22% of the sacks the
   team line printed were credited to nobody.**
2. **No tail could form.** No player could ever have a three-touchdown afternoon
   or a three-sack one, so season leaders were pinned near one-a-game: **13
   receiving touchdowns and 11 sacks** where the NFL's leaders reach 17 and 22.
   A tail that cannot happen in a game cannot happen in a season, and an award
   that needs one cannot be won.

Use `allocateCounts` for every whole-event stat: receiving touchdowns, ground
touchdowns, sacks, interceptions, passes defensed, forced fumbles.

### 4.6 The passing game

```
rbs       = depth.RB.slice(0, 3)
targets   = depth.WR.slice(0, 4) ++ depth.TE.slice(0, 2)
receivers = targets ++ rbs                                # backs LAST, matching the prior
roles     = roleTendency(team.id, passRate)

recPrior  = TARGET_SHARE.WR[0..nWr] ++ (TARGET_SHARE.TE[0..nTe] * roles.teEmphasis)
                                    ++ TARGET_SHARE.RB[0..rbs.length]
recWeights = shareWeights(receivers.map(p => effectiveRating(p) * (p.position=='TE' ? 0.85 : 1)),
                          recPrior)
recTds     = allocateCounts(passTd, concentrate(recWeights, SCORING_CONCENTRATION), rng)
```

```
TARGET_SHARE = { WR: [0.27, 0.19, 0.12, 0.05], TE: [0.16, 0.05], RB: [0.11, 0.04, 0.01] }
```

**Put the backs in the same pie as the receivers, because they are sharing one
quarterback's yardage.** They used to be handed `rng.int(0, 40)` receiving yards
*on top of* the receivers' full share of the passing total, which is why saved
box scores credit 260 receiving yards against 240 thrown. **Yards a quarterback
did not throw cannot be caught.**

Put the tight end's discount on the **talent tilt** (×0.85), not on the depth
prior: the prior already says how many balls the job gets.

**Draw receptions first, then derive yards from them** — a man's receiving total
is his catches times what a catch is worth to **him**, not a second independent
slice of the same pie:

```
recCounts[i]:
    tgt  = round(passAtt * recWeights[i])
    rate = softBound(0.62 + rng.normal(0, 0.08), 0.62, 0.08, 0.35, 0.85)   # Rule 1
    rec  = round(tgt * rate)

REC_YPC_PRIOR = { WR: 1.00, TE: 0.90, RB: 0.59 }
REC_YPC_TILT  = 0.5

recYpcMean  = Σ effectiveRating(p) * rec(p)  /  max(1, Σ rec)      # reception-weighted
recYardRaw[i] = rec[i] * (REC_YPC_PRIOR[pos] ?? 1)
                       * max(0.45, 1 + REC_YPC_TILT * (effectiveRating(p)/recYpcMean - 1))
recYds[i]   = round(passYards * recYardRaw[i] / Σ recYardRaw)      # renormalised: total conserved
```

**Yards per catch is a fact about the receiver.** A receiver's yards were
`passYards * recWeights[i]` and his catches were
`passAtt * recWeights[i] * catchRate` — **one weight vector for both** — so every
man on a club averaged the same yards per reception, to the hundredth. Measured
over 12 replayed league-seasons, per-game means:

| slot | rec/g | recYds/g | yards per catch |
|---|---|---|---|
| WR1 | 6.37 | 68.9 | 10.81 |
| WR2 | 4.16 | 45.0 | 10.80 |
| WR3 | 2.47 | 26.7 | 10.80 |
| TE1 | 3.12 | 33.7 | 10.79 |
| RB1 | 2.54 | 27.4 | 10.78 |

**A checkdown to the third-down back was worth the same as a go route.** Real
receivers run about 12.9 yards a catch, tight ends 10.8 and running backs 7.6 —
the prior above is those three figures as ratios. That flat column is also what
capped the receiving record book: the leading receiver's total is his catches
times this number, so with volume already right at 120 catches there was nowhere
for 1,700 yards to come from.

Keep `REC_YPC_TILT` at 0.5 — deliberately gentler than the backfield's 0.9,
because the positional spread is doing most of the separating here where the
backfield has no positional axis at all and rating is the only thing available.
Floor it at 0.45 for the same reason the share tilt is floored: **a
replacement-level fill-in gains less per catch, he does not go backwards.**

**A man who caught nothing gained nothing.** The old form sliced the club's
passing yards by **target** share, so the third back's 0.01 of the targets
rounded to no catches and still rounded to two yards, every game.

### 4.7 The quarterback and the ground game

```
rushTdWeights = shareWeights(rbs.map(effectiveRating),
                             shapePrior(CARRY_SHARE[0..rbs.length], roles.carryFocus))
CARRY_SHARE   = [0.55, 0.31, 0.14]
QB_RUSH_TD_SHARE = 0.18

goalLine        = concentrate(rushTdWeights, SCORING_CONCENTRATION) normalised
groundTdWeights = goalLine * (1 - QB_RUSH_TD_SHARE)  ++  [qb ? QB_RUSH_TD_SHARE : 0]
groundTds       = allocateCounts(rushTd, groundTdWeights, rng)

qbRushAtt  = qb ? max(0, min(rushAtt - 3, rng.int(1, 5))) : 0
qbRushYds  = round(rushYards * (qbRushAtt / max(1, rushAtt)))
backRushAtt = rushAtt - qbRushAtt
backRushYds = rushYards - qbRushYds

cmpRate = clamp(0.58 + (effectiveRating(qb) - 65) * 0.004 + rng.normal(0, 0.03), 0.42, 0.76)
qb line: { gp:1, passAtt, passCmp: round(passAtt*cmpRate), passYds: passYards,
           passTd, int: own.intsThrown, rushAtt: qbRushAtt, rushYds: qbRushYds,
           rushTd: groundTds[last] }
```

**Give the quarterback goal-line carries.** He used to be structurally incapable
of scoring on the ground, which handed the lead back every rushing touchdown his
team scored and left him with **28 a season against a real leader's 18**.

**Take the quarterback's carries out of the team's rushing total.** They used to
be conjured beside it — `rushAtt: rng.int(1, 5)` for `rushYds: rng.normal(10,
12)` — yards the drive sim never gained and which nobody else's line was reduced
by. **Ten a game is 340 a club a season and about 11,000 a league-year**, and it
is why the team rushing line and the rushing lines beneath it could not both be
right. He still scrambles for about the same; it is now the backs who gained
that much less, which is what actually happened.

`CARRY_SHARE` has three entries against a roster target of `{min 3, ideal 4, max
5}` backs, and the allocator slices the depth chart to three before applying it,
so nothing renormalises across a variable count and a **fourth back takes no
carries at all**. That is a defensible way to describe a gameday scratch; leave
it deliberately, because a fourth slot here would also land him a share of the
receiving prior, which he should not have, and that is a separate change with
its own measurement to do.

`CARRY_SHARE` is **the league's prior and no longer every club's.** It used to be
both, and the lead back's realised share of his backfield's carries was 57.3%
for every club in the league, give or take how good he was. Real clubs run
anywhere from a 40% committee to an 88% workhorse; the role exponent is what
puts that spread back, and the league-wide mean is unchanged.

```
RB_YPC_TILT = 0.9

carryMeanRating = Σ effectiveRating(rb[i]) * rushTdWeights[i]        # carry-weighted
rbYardRaw[i]    = rushTdWeights[i] * max(0.45, 1 + RB_YPC_TILT * (effectiveRating(rb[i])/carryMeanRating - 1))
rbYardWeights   = rbYardRaw normalised

rb line: { gp:1, rushAtt: round(backRushAtt * rushTdWeights[i]),
                 rushYds: round(backRushYds * rbYardWeights[i]),
                 rushTd:  groundTds[i], ...his receiving line }
```

**Yards per carry is a fact about the back.** His carries and his rushing yards
used to come off one weight vector (`const rbWeights = rushTdWeights; // carries
and rushing yards share one prior`), and the arithmetic consequence is that every
back on a club averages the **same** yards per carry, exactly, every afternoon.
Measured over 120 league-seasons the first, second and third backs in the league
all averaged **4.52, to the hundredth**, and a back's rating against his own
yards per carry ran **r = 0.233** with a top-quartile-over-bottom-quartile ratio
of **1.069×**. What little correlation there was came from team quality — good
clubs gain more on the ground and their backs are better — and **none at all from
the back.** A 90 OVR starter and the 58 OVR third-stringer behind him produced
identical efficiency; only volume separated them. That is the same defect the
linebacker's tackle count had (r = 0.082, fixed to 0.659) and the punter's
average had (r = −0.027, fixed to 0.672), in the one column a player page prints
as a back's headline efficiency stat.

**This is a redistribution and cannot be anything else.** The team's rushing
yardage is decided upstream, so a good back can only gain more than the men
behind him, never more than his club gained — and his club already gained more
for having him, because the backfield feeds the offensive unit rating. Normalise
the multiplier against the **carry-weighted** mean rating of the same three
backs, which makes the weighted multiplier exactly 1 and the total exactly
conserved.

The sweep that chose 0.9 (120 league-seasons, identical rosters and seeds;
spread over qualifying seasons of ≥100 carries):

| tilt | RB1 / RB2 / RB3 ypc | sd | r | top-q/bot-q | league leader |
|---|---|---|---|---|---|
| 0.0 | 4.52 / 4.52 / 4.52 | 0.460 | 0.233 | 1.069× | 1,574 |
| 0.5 | 4.62 / 4.43 / 4.28 | 0.471 | 0.363 | 1.107× | 1,615 |
| **0.9** | **4.69 / 4.35 / 4.09** | **0.499** | **0.445** | **1.138×** | **1,649** |
| 1.4 | 4.79 / 4.26 / 3.85 | 0.555 | 0.516 | 1.178× | 1,691 |

Reject 1.4 even though it lands the league-wide spread nearest a real qualifying
field's: it buys that spread by putting **0.94 yards a carry** between a starter
and his club's third back, where real depth charts run about half to two-thirds
of that. 0.9 puts 0.60 between them and still lands the spread at sd 0.499
against a real field's ~0.48-0.55, which is the number that chose it. Reject 0.5
as too timid to be worth the change — it moves the correlation less than half as
far for a third of the separation.

**r = 0.445 is the honest ceiling here and is not the 0.659 the linebacker pass
reached.** Two reasons, both real: the club's rushing total is fixed upstream so
a back can only out-gain his own teammates, never his own offensive line; and
yards per carry is the noisiest, most line-and-scheme-dependent number in
football, which is why real backs' averages swing a full yard year to year on
unchanged ability. **A rating that explained most of it would be the lie in the
other direction.** The league's leading rusher moving 1,574 → 1,649 against a
real ~1,700 is a side-effect and not a target: not one extra yard is rushed for
anywhere, the best back in a league-year simply keeps more of what his club
already gained.

### 4.8 Defensive counting stats

```
DEF_SLOTS = [LB 3, S 2, CB 3, EDGE 3, DT 3]        # who is on the field enough to record

DEF_PRIORS (unnormalised; weights only need to be right relative to each other):
  tackles: LB [1.60, 1.13, 0.73]  S [1.27, 0.93]  CB [0.87, 0.73, 0.51]  EDGE [0.60, 0.45, 0.29]  DT [0.53, 0.43, 0.29]
  sacks:   EDGE [1.00, 0.72, 0.40]  DT [0.52, 0.38, 0.22]  LB [0.16, 0.10, 0.06]  S [0.05, 0.03]  CB [0.03, 0.02, 0.01]
  defInt:  CB [1.00, 0.85, 0.55]  S [0.90, 0.60]  LB [0.35, 0.25, 0.15]  EDGE [0.04, 0.03, 0.02]  DT [0.02, 0.02, 0.01]
  pd:      CB [1.00, 0.80, 0.50]  S [0.55, 0.40]  LB [0.30, 0.20, 0.12]  EDGE [0.18, 0.12, 0.07]  DT [0.08, 0.06, 0.04]
  ff:      EDGE [1.00, 0.70, 0.40]  DT [0.45, 0.32, 0.20]  LB [0.55, 0.38, 0.22]  S [0.45, 0.30]  CB [0.40, 0.30, 0.20]

DEFENDER_TACKLES_PER_GAME = 46
PASSES_DEFENSED_PER_GAME  = 3.6
FORCED_FUMBLES_PER_GAME   = 0.55

weightsFor(stat) = shareWeights(ratings, defenders.map(d => DEF_PRIORS[stat][d.pos]?.[d.slot] ?? 0.01))

totalTackles = round(rng.normal(DEFENDER_TACKLES_PER_GAME, 5))
tackles[i]   = max(0, round(totalTackles * weightsFor('tackles')[i]))
sacks        = allocateCounts(opp.sacksTaken, weightsFor('sacks'),  rng)
ints         = allocateCounts(opp.intsThrown, weightsFor('defInt'), rng)
pds          = allocateCounts(max(0, round(rng.normal(PASSES_DEFENSED_PER_GAME, 1.4))), weightsFor('pd'), rng)
ffs          = allocateCounts(max(0, round(rng.normal(FORCED_FUMBLES_PER_GAME, 0.7))),  weightsFor('ff'), rng)
```

**One table per stat, keyed by position then by depth.** This replaces a single
`tacklePositionBias` whose docstring said "linebackers and safeties rack up
tackles; corners and interior less so" and whose numbers never reached the box
score, because the additive blend that consumed it added a near-uniform 35% to
everybody (§4.4). Measured across 107 saved league-years: the league's leading
linebacker finished with **84** tackles, its leading safety **83** and its
leading edge rusher **81** — a four per cent spread, in a sport where those
numbers run about **170, 125 and 60**. Every defender in the league recorded the
same season, so the only thing left to separate them was the interception and
the pass breakup, which only a defensive back could get. **That is the whole
reason a safety won Defensive Player of the Year in 95% of saved seasons and an
edge rusher never once did.**

Derive the tackle row from real per-season counts **for a starter** at each slot,
divided by 75 — about 120 for a MIKE linebacker, 95 for a strong safety, 65 for a
corner, 45 for an edge rusher and 40 inside, with the second and third men at
each spot scaled off their own snap counts. **Starters, not leaders:** the
league's leading tackler is the best of thirty-two and lands a third above the
average starter on his own, which is where the real leader values (about
170 / 125 / 90 / 60 / 55) come back.

`DEFENDER_TACKLES_PER_GAME` is **46, not 62.** 62 is roughly a real team's whole
combined total — but a real team spreads that over its nickel backs, rotational
linemen and coverage teams, none of whom appear in a box line here. Handing all
62 to fourteen men inflated every one of them; **the same fourteen slots in the
NFL record about 46 a game.** `PASSES_DEFENSED_PER_GAME` is 3.6 by the same
argument against a real team's ~4.4: at 4.4 the league's leading corner finished
on 25 against a real leader's 20.

Two ordering decisions that are load-bearing:

- **Put off-ball linebackers on the sack list, small.** A sack is the pass
  rush's stat, but off-ball linebackers get a few — Ray Lewis had two the year
  he won it — so they are on the list rather than structurally shut out of it.
- **Corners first on interceptions, with no ordering privilege for safeties.**
  The old allocator walked the defenders in the order LB, S, CB, … handing each
  cover man in turn a 40% roll at the next available interception, so the
  safeties always got first refusal and **out-picked the corners 8 to 5 a
  season.** Real interception leaders are corners about as often as safeties.
- **Draw forced fumbles rather than coin-flipping them**, for the same reason as
  everything else here: a defence that strips the ball twice in an afternoon is
  a thing that happens, and a hard cap of one would quietly delete it from the
  record.

### 4.9 Specialist lines

```
kicker: { gp:1, fgm: own.fgm, fga: own.fga, xpm: own.xpm, xpa: own.xpa }
punter: { gp:1, punts: own.punts, puntYds }        # per-punt draw, §3.8
```

### 4.10 Sum the team column from the player column

```
toTeamStats(own, opp, lines):
    passYards = Σ lines[].stats.passYds
    rushYards = Σ lines[].stats.rushYds
    return {
      totalYards: passYards + rushYards,
      passYards, rushYards,
      firstDowns:      round(own.yards / 15),
      turnovers:       own.turnovers,
      sacks:           opp.sacksTaken,
      timeOfPossession: round(own.plays / max(1, own.plays + opp.plays) * 3600),
      thirdDownConv:   `${round(own.plays/6)}/${round(own.plays/4)}`,
      penalties:       round(own.plays / 12),
      penaltyYards:    round(own.plays / 12) * 9,
    }
```

**Add the team column up from the player column. Do not guess it beside them.**
`passYards` and `rushYards` here used to be a flat 60/40 split of the team's
total — a constant, unrelated to anything the men underneath it did. The game
screen prints both on one page (team "Pass Yards" and the passer's own line four
rows below it) **and they disagreed**: measured over 240 league-seasons the gap
ran **31 yards a team a game** before the allocator changed and **35 after**,
because the split the lines are built on moved and this constant did not. Nobody
had to notice, because two other parts of the codebase had already given up on
it and started summing the lines themselves. Now it reads them, so the only way
for the team column to disagree with the lines is for the lines to disagree with
themselves.

Note that `totalYards` is therefore the **floored** figure (`max(120, …)`), not
the raw drive total, on the rare afternoon a club gains less than that. **A team
column that does not equal the players in it is a worse lie than a floor.**

First downs, time of possession, third downs, penalties and penalty yards are
frank derivations with no engine behind them. Keep them as derivations or build
real ones, but do not present them as simulated outcomes.

### 4.11 Roll season into career, once a year

At the `RESET_STANDINGS` step, for every player who has ever recorded a stat
(active or not, so a player cut mid-season keeps what he earned):

```
career        = mergeStats(career,        season)
careerPlayoff = mergeStats(careerPlayoff, playoff)
season = {}   playoff = {}
```

Roll the postseason pair on exactly the same schedule and **never mix it with the
regular-season pair.** Feed the record book the **regular** line only, which is
what "single-season record" means everywhere the phrase is used.

Then rebuild the per-season rows. The career merge is **lossy by design** — it
comes out with no season and no team on it — so rebuild the year-by-year lines
from this season's played box scores, which are the only place "the club he
played for that year" exists. One sweep, chunked writes, no per-player round
trip; a save that predates the per-season table gets its whole played history
caught up the first time it advances.

Per-season row shape: `(leagueId, playerId, seasonYear, teamId, teamAbbr, age,
gp, firstSeen, stats, playoffStats, playoffGp, lastSeasonOvr)`.

- `teamAbbr` is denormalised so a deleted club cannot take the crest and label
  with it.
- `age` is **nullable, and null is a real answer** rather than a missing one — a
  dash is honest where the arithmetic cannot be trusted; a fabricated 24 is not.
  Use `seasonYear + 1` as the age basis at this step, because `PROGRESS` is the
  step immediately before (same press of Advance) and has already aged everyone
  for the season about to start.
- `gp` counts regular-season games; `playoffGp` counts postseason ones
  **separately**, because a column headed "G" next to regular-season yardage has
  to count the games those yards came from.
- `firstSeen` is where his **first** game for this club fell, as a sortable
  position with playoff weeks offset past the regular season. It only matters
  for a player traded mid-year: without it the two rows of a split season come
  back in whatever order the database feels like and the table says he played
  for the new club first. Ordering by insertion or by id would work by accident
  of how ids are generated; **this works on purpose.** Default it rather than
  making it nullable so the sort key is never null.
- `lastSeasonOvr` is **the only rating history there is** — the current rating is
  overwritten at every development checkpoint with nothing keeping the old one,
  so "how much better did he get this year" is unanswerable without it. Make it
  nullable and treat null as *nobody wrote his rating down that year*, rendering
  **no chip at all** rather than a wrong one. Three ways to get a null, all the
  same fact: rows written before the column existed (that rating is genuinely
  gone, and a backfill would have to invent it); seasons a catch-up sweep
  replays out of old box scores (stamp the current rating **only** on the season
  being closed, never on years backfilled underneath it); and a man with no row
  for the year at all, because the table is written from box-score lines.

### 4.12 Records and leaders

League records: one row per `(scope, category)` — the current holder, not a full
history — over `SEASON` and `CAREER` scopes for the categories
`passYds, passTd, rushYds, recYds, tackles, sacks, defInt`. Check them inside
the same rollover, while this season's final line and the freshly updated career
total are both in hand for every player. When several players beat the same
still-unset record in one batch (year one, everyone's total is technically a
record), keep only the best per `(scope, category)` before writing. **Announce
only a genuine break** — an existing record actually surpassed — because the
first time a category gets any value at all is not breaking a record, and
announcing every category in a league's first season would flood the wire.

For league leader boards, rank per category over the stat column directly.
Exclude **opportunity columns** from any merit ranking — `gp`, `passAtt`,
`rushAtt`, `targets`, `fga`, `xpa`, `xpm`, `punts`, `puntYds` — and exclude
columns where a bigger number is worse and the honest rate is elsewhere (`int`,
`fum`). Attempts are opportunity, not production, and the converted column is
already counted: a kicker's merit is the field goals he made, not the ones he
lined up for; a quarterback's is the yards, not the drop-backs. Scoring both
double-counts volume and answers "who got the most work" when the question was
"who was best". Keep attempts in the stat **table** — a table should show
attempts — and let them earn nothing in a ranking.

### 4.13 Three production scores, one dispatcher

Write **one** definition of "who is playing well" and dispatch it by position,
so development, the season review, the storyline engine and the trophies all
grade on the same formulas.

```
offensiveScore(s) = passYds*0.04 + passTd*4 - int*2
                  + rushYds*0.1  + rushTd*6
                  + recYds*0.1   + recTd*6

defensiveScore(s) = tackles*0.8 + sacks*6.5 + defInt*10 + pd*3 + ff*8

specialistScore(s) = (fgm*3 + xpm - (fga-fgm)*3 - (xpa-xpm))      # points scored minus points left
                   + (puntYds - punts * PUNT_GROSS_BASE)          # yards above a league-average leg

productionScore(pos, s) = DEFENSIVE.has(pos)  ? defensiveScore(s)
                        : SPECIALIST.has(pos) ? specialistScore(s)
                        : offensiveScore(s)
```

`DEFENSIVE = {EDGE, DT, LB, CB, S}`, `SPECIALIST = {K, P}`.

**Leave `offensiveScore` alone.** It is a fantasy-points-style blend and stays
one: fed real MVP and Offensive Player of the Year seasons it already reproduces
the ordering real voting has — quarterbacks 407, backs 318, receivers 265, which
is real football's own ordering. Nothing was ever wrong with it.

**`defensiveScore` is different: an IDP blend cannot pick a Defensive Player of
the Year.** The weights used to be `1 / 3 / 6 / 2 / 4`, an ordinary IDP
fantasy-points blend — a fine way to run a fantasy league and a bad way to hand
out this award. IDP scoring pays for **volume**, and the volume stat on defence
is the tackle, which is recorded on a play the offence has already gained on.
The plays that decide games are the ones the defence **took away**: the sack, the
interception, the ball on the ground, the throw knocked down.

Measured on **real football, not on this sim**: feed the old weights ten real AP
Defensive Player of the Year seasons — men who each beat every other defender in
the league that year, so a model that agrees with the voters should rank them
close together — and it spreads them over a **2.16×** range, putting Ray Lewis
2003 at 225 against Myles Garrett 2023 at 104. Averaged by position it reads
**LB 216, CB 160, S 145, DT 142, EDGE 130**: it ranks edge rushers **last**
among the men who won the award, and edge rushers are the largest single group of
winners it has (15 of 53 listed as defensive ends, plus the edge-rushing outside
linebackers — Taylor, Harrison, Suggs, T.J. Watt — counted among the 17
linebackers). **That is the model disagreeing with real voting on real inputs,
which is a defect in the model and not in whatever feeds it.**

The same ten seasons under `0.8 / 6.5 / 10 / 3 / 8` sit inside **1.65×** and read
**LB 224, DT 222, CB 209, EDGE 203, S 182** — no position systematically
excluded, and the single highest score of the ten is T.J. Watt's 2021.

How those five numbers were chosen, and why it is not hand-tuning the award:
**nine candidate weight vectors were run against a hundred simulated
league-years and against the ten real seasons at the same time**, and the one
kept is the one whose DPOY mix lands closest to the AP award's own record — 40%
edge rushers, 21% off-ball linebackers, 19% interior, 11% corners, 9% safeties
over 53 winners. That is a **distribution target, not an outcome rule**: this is
still a pure function of a stat line, a great safety season still beats a poor
edge season, and no branch anywhere knows what position it is looking at.

The shape is a disruption-weighted blend, roughly ordered by what a play is
worth in expected points: a sack costs an offence about 1.6, an interception
about 4, a forced fumble about 2 once you discount for who recovers it, a
broken-up pass under 1 — and **a tackle is not a defensive win at all, it is the
end of a play the offence chose.** It is not a literal expected-points model:
interceptions are held to 10 rather than the ~16 that ratio implies, because at
16 the ball-hawking corner outscores everyone and corners are 6 of the 53
winners rather than the plurality.

**Use one score everywhere rather than layering an award-only valuation over
it.** That was considered and rejected: the defect above is visible without any
trophy in the room, and a second opinion would make the trophy disagree with the
production numbers on the same screen. What the change costs the other callers
was measured rather than assumed — within a position group, which is the only
comparison the development and review paths ever make, Spearman's rho between
the old and new ranking is **0.980 to 0.991** at every defensive position,
keeping 86-89% of each group's top-15% "breakout" tier and 88-94% of its
bottom-15% "slump" tier. The one caller that ranks across positions was checked
separately: **0 of 24** slots changed hands, because a quarterback scores 20 a
game against a defender's 3 to 6 and nothing in these five numbers closes a gap
that size.

**Specialists scored a flat zero before `specialistScore` existed.**
`offensiveScore` reads passing, rushing and receiving; a kicker and a punter
accumulate none of the three. Measured over **6,442** live season lines with real
work in them (field goals attempted, or punts), `offensiveScore` was non-zero on
**exactly 0** of them. What that cost:

- **The performance tier.** The development checkpoint ranks a position group by
  score and hands the top 15% a growth bonus and the bottom a penalty, filtering
  out men whose rate is zero first — so every kicker and punter fell out of his
  own group and none was ever ranked.
- **The ceiling revision.** The revision fits production against rating and
  skips a position whose fit is too weak. A column of zeroes has no spread at
  all, so over **3,222** working kickers it produced **0** z-scores. **A
  kicker's projection was written once at generation and never revised again —
  he could not bust and he could not break out, whatever he kicked.**

Both formulas are **measured, not chosen for looking reasonable.** Each
candidate was scored against the one property it has to have — correlating with
the man's rating well enough to clear the revision's minimum of r = 0.1, below
which the model has no credible expectation to hold him to. Measured over 640
season lines replayed through **today's** engine (20 seasons of a real 32-club
league; per game, which is the rate both callers divide to):

| position | candidate | r |
|---|---|---|
| KICKER | `fgm` only | 0.26 |
| | `fgm*3 + xpm` (the points he put up) | 0.34 |
| | **points scored minus points left on the field** | **0.46** ← ship |
| PUNTER | `punts` (volume) | **−0.24** |
| | `puntYds` (gross volume) | −0.04 |
| | **`puntYds - punts * PUNT_GROSS_BASE`** | **0.68** ← ship |

**Both volume figures are negative, and that is the whole argument against the
obvious formula.** A punter's punt count is a fact about how often his offence
stalled, so the better his club the less he punts — grading him on it grades him
on somebody else's failure, backwards. Subtracting a league-average leg from
every kick leaves **yards above that leg**, which is his and only his, and
`PUNT_GROSS_BASE` is exactly the mean the engine draws a 72-rated punter around.
The kicker's version does the same job: charging a miss the points it cost turns
a volume stat into an accuracy one without dropping the volume entirely, which
is why it beats both the raw points blend and a bare make count.

**Do not measure this against a database of old rows.** Specialist lines written
by an older engine had a punter's gross as `punts * rng.int(40, 50)` with no
input from his rating at all; run the same candidates over those rows and the
punting formula reads **r = 0.04** and looks worthless. **Replay seasons through
the current engine instead.**

**Sum the two terms rather than branching on position.** A kicker's punting term
is zero and a punter's kicking term is zero, and on the short roster where one
man does both jobs the honest score is the sum of the two afternoons rather than
half of one.

**`specialistScore` is not an awards score.** Keep MVP and OPOY on
`offensiveScore` so a kicker cannot win them — which is both what real voting
does and a balance change nobody asked for. This exists so the **development**
path can see a specialist's season, and that is all it does.

### 4.14 A fourth score, for ranking across positions

The three above answer "how good was that, among men at this position". They
cannot answer "was 96 receiving yards a better afternoon than 7 tackles and a
sack", because **passing yards are simply a bigger number than any other
statistic in the sport**, so a formula that puts them on one scale with
everything else hands the quarterback the trophy by arithmetic rather than by
merit. Measured, it gave the game ball to a quarterback in **four weeks out of
six**.

There is no set of coefficients that fixes this. The question only has an answer
in **distribution**: how unusual was each of those, for a player at that
position?

```
positionRelativeScore(position, stats, dist):
    for each scored stat of this position:
        z = dist.sd[key] > 1e-9 ? (value - dist.mean[key]) / dist.sd[key] : 0
        weighted += z * weight;  totalWeight += weight
    return totalWeight > 0 ? weighted / totalWeight : 0
```

- Take **which** stats count from the same table that already answers "which
  numbers define this position", and the **weights** from that table's lead
  ranks, which already answer "which of them does a broadcast graphic lead
  with": lead 1 → weight 3, lead 2 → 2, lead 3 → 1, unranked context → 0.5.
  Nothing about what matters at a position gets written down in two places.
- Negate stats where a bigger number is worse (`int`, `fum`) before scoring, so
  a quarterback's interceptions cut against him exactly as far as their lead
  rank says they should.
- Drop the opportunity keys listed in §4.12 — including a punter's **volume and
  his gross yardage both**, because punt yards are punts times average and the
  average is the only half he controls. Scoring the total put a 46.2-yard punter
  with 91 kicks ahead of a 46.5-yard punter with 69, which rewards playing
  behind the worse team.
- Add the **rate** stats the raw columns cannot express, per position: kicker
  `fgPct = fgm/fga` at weight 2, punter `puntAvg = puntYds/punts` at weight 3.
  Guarding the sample size is the **caller's** job, not this function's — it
  does not know how big a sample it is looking at, which is the same reason the
  distribution is a parameter.
- A column where nobody's number varies carries no signal and a zero standard
  deviation would divide by zero: contribute a z of 0, never an infinity.
- Return **0** for a position the sim records nothing about (the offensive line
  has no columns at all), and require callers to treat that as
  **"unmeasurable", never as "average"**.

**Make the distribution a parameter.** A season and a single game are not the
same population, and a function that quietly assumed one would lie to the other:
4,800 passing yards is an extraordinary season and an impossible afternoon; 280
is a fine afternoon and a catastrophic season. Let the caller build the
distribution from the population it actually means — season totals for All-Star
selection, this week's box lines for the week report — and pass it in. The
scoring is identical either way; only the yardstick changes. The output is
unitless (standard deviations), so a season score and a week score are directly
readable against each other as "how exceptional", which is what both callers
want and neither could get from raw totals.

---

## 5. Build standings, the bracket, the champion, and the draft order

### 5.1 One canonical standings comparator

```
winPct(t) = (t.wins + t.ties * 0.5) / max(1, t.wins + t.losses + t.ties)

standingsCompare(a, b):
    if winPct(b) != winPct(a): return winPct(b) - winPct(a)
    return (b.pointsFor - b.pointsAgnst) - (a.pointsFor - a.pointsAgnst)
```

**Write this once and have everything read it** — the bracket seeder, anything
that *displays* a rank, and the clinch projection. A displayed rank that
disagrees with the bracket the sim actually seeds is the lying-metric class of
bug this project keeps paying for. The "3rd → 1st in the division" line in a
week report must be computed by the same function that decides who plays in
January.

**Known simplification, inherited and deliberate: head-to-head is not modelled.
The tiebreak after win percentage is point differential.** If you implement real
NFL tiebreakers, implement them in this one function so every reader moves
together.

Update standings inside the game transaction, **regular season only**:

```
sameDiv  = home.division == away.division && home.conference == away.conference
sameConf = home.conference == away.conference
tied     = homeScore == awayScore

per team: pointsFor += own, pointsAgnst += opp,
          wins/losses/ties += 1 as appropriate,
          divWins/divLosses += 1 if sameDiv and not tied,
          confWins/confLosses += 1 if sameConf and not tied
```

Also provide, off the same comparator:

- `rankAmong(teamId, rows)` — 1-based position in standings order.
- `conferenceSeedOrder(confTeams)` — division winners first (each division's
  best, then those sorted against each other), then everyone else sorted. Return
  it **in full, not truncated to the playoff field**, so a team on the outside
  has a real position rather than "not in the picture".
- `gamesBackOfCutLine(teamId, confTeams)` — half-game convention,
  `((cut.wins - me.wins) + (me.losses - cut.losses)) / 2`, floored at 0. Return
  **null** for a team already inside the field: the honest answer there is a
  seed, not a deficit.
- `ordinal(n)` and `recordString(t)` ("7-2", "7-2-1").

### 5.2 Seed the bracket

`PLAYOFF_TEAMS_PER_CONF = 6` (so two byes per conference), `TEAM_COUNT = 32`,
two conferences × four divisions.

```
per conference:
    divWinners = each division's best by standingsCompare, then sorted by standingsCompare
    others     = everyone else, sorted by standingsCompare
    wildcards  = others.slice(0, max(0, PLAYOFF_TEAMS_PER_CONF - divWinners.length))
    seeded     = [...divWinners, ...wildcards].slice(0, PLAYOFF_TEAMS_PER_CONF)
    write playoffSeed = i + 1 for each
    write eliminated = true for every conference team not seeded
then create the wild-card round and set phase = PLAYOFFS, week = 1
```

**Division winners outrank every wild card**, however bad their record. Derive
the division list from the data rather than hard-coding four, so a different
league shape still seeds.

Rounds:

| round | week | pairings |
|---|---|---|
| `WILDCARD` | 1 | 3v6 and 4v5 per conference, higher seed at home; seeds 1 and 2 bye |
| `DIVISIONAL` | 2 | winners plus the two byes, per conference, sorted by seed, paired `i` vs `i+1` |
| `CONFERENCE` | 2 | same pairing rule over the divisional winners |
| `FINAL` | 4 | the two conference winners, neutral-site semantics via `opts` |

Resolve a winner as `homeScore >= awayScore ? home : away` consistently
everywhere, so the one case the engine can still produce a tie in resolves the
same way in every reader.

**Bound every round query by `seasonYear`.** Without it, year two collected
2026's wild-card winners alongside 2027's and built a divisional round out of
both: a measured 2027 postseason came out WILDCARD 4, DIVISIONAL 6, CONFERENCE
4. In the final builder the missing bound was **silently fatal** rather than
merely wrong: by year two it returned four conference games, the `length === 2`
guard failed, and **no final was ever created.**

Build each round inside the round lock (§2.6) and skip the build if any game of
that kind already exists for the season.

### 5.3 Freeze the season

At the final whistle, write one `TeamSeasonRecord` per club per year
(`wins, losses, ties, pointsFor, pointsAgnst, playoffResult`), upserted so the
step is re-enterable. **This snapshot is the only place a finished season's
standings survive**, because `RESET_STANDINGS` wipes the Team row a few steps
later.

`playoffResult` is the round a club went out in, mapped from the game it lost:
`WILDCARD | DIVISIONAL | CONFERENCE | RUNNER_UP` (the final's loser), `CHAMPION`
(the final's winner), and `MISSED` as the default for everyone else. Make
`MISSED` the column's default **and** the reading for any value a consumer does
not recognise — "nothing on file says this club played a playoff game" is the
only honest reading.

Also write a `CHAMPION` news row naming the club and its record.

### 5.4 Write the champion's roster down

Write **one row per man on the winning roster** at the instant the final ends:
`(leagueId, seasonYear, teamId, playerId)` with `@@unique(playerId,
seasonYear)` and a skip-duplicates insert. ~50 rows a league year, measured at
53 rows in 7ms.

**Write it at the trophy, because that is the last moment the roster exists.**
Free agency, the retirement roll and the draft begin rewriting it three advances
later, and nothing else in the database records who was standing on the field.

**It is not a convenience.** Per-season stat rows are written from box-score
lines, and a box score names about twenty-six men a club — measured on a real
champion's 49 men, **31 had a row and every offensive lineman on the club had
none (0 of 10).** Inference off the club's own ledger can recover most of the
rest, but **only for a man who is still there**; one who took no counting stat in
the title year and has since left is unreachable by any inference at all. Four of
one champion's 49 were exactly that, a league year on.

Measured on one league driven to a real title by the game's own advance, read at
the trophy, at the re-sign screen, and a full league year on after free agency,
retirements and a draft — each window read twice, once with the rows and once
with them deleted out from under the resolver (which is exactly the state of a
save that won its titles before this table existed):

| | at the trophy | at Re-sign | a league year on |
|---|---|---|---|
| with the rows | 49/49 | 49/49 | **49/49** |
| the inference alone | 49/49 | 49/49 | 46/49 |

**0 false rings anywhere in either row.** The last column is the point: the ring
stops decaying as the roster churns, because it stopped being inferred.

Resolve a ring per **club-year**: a title year that has rows is answered by them
and by nothing else — **no row means he did not win it** — and a title year with
no rows at all falls through to the older inference, unchanged, so a save that
predates the table still displays. Count a year as covered **only if every club
the standings call champion that year has a roster written down.** Normally one
club wins it and the distinction is invisible; the state where it is not — two
clubs carrying `CHAMPION` in one season, which a duplicated bracket produced
before the round lock closed it — is exactly the state where half a year of rows
would tell a real champion's whole roster it had never won anything.

**Rejected: writing zero-stat per-season rows for whole rosters instead.** That
is ~1,700 rows a league year against ~50, and it breaks that table's stated
contract — *"which club did he produce for"* — which the GM tenure page counts
off and the player page renders one row per. Every lineman in the league would
collect an empty stat line every season.

Cascade all three foreign keys: unlike a cap charge, a championship roster
leaves no bill behind when the league, the club or the man is deleted.

### 5.5 Seed the draft order from playoff exit first, record second

```
PLAYOFF_EXIT_ORDER = ['MISSED','WILDCARD','DIVISIONAL','CONFERENCE','RUNNER_UP','CHAMPION']
exitRank(result)   = indexOf(result ?? 'MISSED'), or 0 if unknown

draftStandingsOrder(teams) = sort by:
    1. exitRank ascending                       # everyone who missed January first
    2. win percentage ascending                 # worst record first INSIDE the group
    3. point differential ascending
```

Note the win-percentage form here is `wins / max(1, wins+losses+ties)` —
**ties are in the denominator and not worth half a win**, unlike the standings
comparator. Decide whether you want that asymmetry; the reference implementation
has it, and nothing measured it either way.

**Record alone used to be the whole rule**, and it produced exactly what the
owner reported: *"i was knocked out in the first round yet got pick #32. it
shouldn't operate that way."* He was right. **Pick 32 belongs to the club that
won the title**; the 15-2 side that lost its wild-card game belongs at the top of
the playoff block, not at the bottom of the board. A club's record decides where
it sits **inside** its group and nothing more — which is why the best record in
football can pick 19th and why the 8-9 club that snuck in cannot pick 3rd.

**Hard-code no group size anywhere.** The standard bracket happens to hand out
6/4/2/1/1, but league size and playoff format are settings, so the groups are
whatever the stored `playoffResult` values actually say. Sizes that do not add up
to a familiar shape simply produce a different split of the same complete order.
Keep it a **single sort over a single array** for the same reason: a sort of N
clubs is N clubs, so ranking by position gives 1..N with every slot used exactly
once and none twice, whatever the groups look like.

Export the pure function as `draftSlotAmong(teamId, teams)` so a caller already
holding standings from **both** sides of a week can compute the delta. A
database-backed "where would each club pick now" projection cannot answer for a
snapshot the caller has in hand. Rows carrying no `playoffResult` — mid-season
standings — all read `MISSED`, which collapses the rule to the worst-record-first
board the week report is asking about.

**Read the finished season's standings off `TeamSeasonRecord`, never off the Team
row.** The draft order is reseeded at the end of free agency, several advances
**after** `RESET_STANDINGS` zeroed the Team row — so by the time the order was
seeded every club was 0-0-0 with a zero differential, every comparison returned
0, and the sort left the clubs in whatever order the database handed back:
effectively creation order. **Measured on five saves before the fix: pick #1 went
to the worst club in NONE of them.** Clubs that finished 1-16 did not pick first;
the owner, who had just been handed the top selection, put it plainly — *"im not
sure how i got #1 overall"*. He got it because his row came back first.

The draft for year N follows the season played in year N−1, so read records for
`seasonYear - 1`. (The season-year bump also lives in `RESET_STANDINGS`, which
is why the draft's own year is one ahead of the standings that set it.)

**Require every club to have a record, or fall back wholesale.** Comparing a real
record against a wiped row is the same bug wearing a smaller hat. With nothing on
file — a league's very first draft can precede any completed season, and a
fantasy-start league may have no record at all — hand in the live Team rows,
which carry no `playoffResult`, so every club reads `MISSED` and a first draft
still comes out a complete 1..N with nothing shared and nothing missing. Say in
the code that this is what happened rather than silently producing a fabricated
order.

**Move all slots in one transaction, or none.** This was a bare loop of 224
separate awaited updates, so any interruption partway — a restart, a request
abort, a step further up the advance throwing — committed the rows it had reached
and left the rest on their generation-time placeholders. **The two sets then
collide, because a placeholder and a standings rank are both drawn from 1..32.**
Found in the dev database: one save sitting in exactly that state — **25 of its
32 round-one picks reseeded, 7 still on placeholders, six slots held by two picks
each and six slots held by none.** The clock resolves the club on the clock with a
first-match on `(round, slot)`: of two picks sharing slot 26, one comes up and is
paid slot 26's price and the other **never comes up at all** — so six clubs never
select, six rookie contracts are never written, and the draft ends six men short
with nothing on any screen saying why.

So: batch the writes as one array transaction (a single round trip with no
interactive timeout to run out of on 224 rows), and **abort the whole year if any
club cannot be ranked.** Skipping that pick and carrying on is the same mixed
state arrived at deliberately. There is no useful half-order — leaving the year
entirely on placeholders is honest, because every pick then wears a consistent
placeholder and the collision cannot happen — so throw, and let the advance that
called it say so rather than handing the draft a board it cannot run.

**Reseed every round's slot from the standings, not just round one's**, and
resolve the pick on the clock from live ownership for the current `(round, slot)`
every time. The original built a turn-order array from round one's ownership and
reused it for every later round, so **a club that had traded a round-2 pick away
still got a turn** — and, owning no unused pick that round, drafted the player
for free with no contract and no pick consumed — while the club that acquired
that pick never got an extra turn to use it.

**Price a future draft's rookie deals as `null`, not as a number.** Slots carry
generation-time placeholders until the reseed rewrites them, so every figure
computed off a future year is a real number derived from a fake selection:
measured, a club created first (placeholder slot 1) that actually finished best
(real slot 32) would be quoted **$28.5M** for a seven-pick class that will really
charge it **$21.1M** — 35% wrong, and wrong in the direction that fires a warning
at a club with room to spare. Check that the year asked for is the year actually
seeded and return null otherwise. **Rejected: taking the seeded year as an
argument so the caller asserts it** — the caller passing the wrong year is the
bug, so it cannot also be the check.

---

## 6. Build the awards

### 6.1 Six trophies, their timing, and their field

Compute all six **once, at the moment the championship game finishes**, from
that season's accumulated regular-season stat lines — before those numbers are
rolled into career totals and reset.

| award | field | ranked on |
|---|---|---|
| MVP | the whole league | `max(off, def)` |
| OPOY | non-defensive players | `off` |
| DPOY | defensive players | `def` |
| OROTY | non-defensive players with `experience == 0` | `off` |
| DROTY | defensive players with `experience == 0` | `def` |
| Championship MVP | the winning roster of the final, only | that **one game's** box line |

Because the season bucket is regular-season only, the five season-long trophies
are decided on **regular-season production even though they are announced after
the final** — which is both what the real awards do and what stops a run to the
title from outvoting a better year. Championship MVP is the deliberate
exception.

**Keep the field on `offensiveScore` / `defensiveScore` and do not let the
dispatcher (§4.13) into this file.** MVP and OPOY stay on `offensiveScore` so a
kicker is not suddenly in the MVP race.

Build the candidate list as a pure, database-free shape so the ranking can be
replayed over historical stat lines and A/B'd against a rule change without
simulating anything, and so a seeded fictional backstory obeys the same rule:

```
AwardCandidate = { playerId, name, position, teamId, teamAbbr,
                   off, def, isDefensive, experience, statLine }
```

**One idea, five awards.** Every trophy ranks its own field on that field's own
number. **Nothing is ranked on a number from the other side of the ball**, and
the only interaction between awards is the sweep test below.

Split the two rookie awards by the **same** `isDefensive` partition that decides
OPOY and DPOY, and rank each side on **its own** score rather than on
`max(off, def)`. A rookie corner with a pick-six has a non-zero offensive score,
and ranking him on the better of his two numbers would let a defender's
receiving line decide an offensive trophy. **One partition, two awards, no
crossover.**

### 6.2 The sweep margin — who can win two trophies in one year

```
AWARD_SWEEP_MARGIN = 0.20

sweptTheField(leaderScore, runnerUpScore):
    if runnerUpScore <= 0: return true        # no contest at all; he keeps both
    return leaderScore >= runnerUpScore * (1 + AWARD_SWEEP_MARGIN)

playerOfTheYear(ranked, score):
    leader = ranked[0]
    if leader is not the MVP: return leader
    runnerUp = ranked[1]
    if no runnerUp: return leader             # nobody else played that side all year
    return sweptTheField(score(leader), score(runnerUp)) ? leader : runnerUp
```

This exists because for a long time it did not, and **the awards panel printed
the same man twice.** MVP was `max(off, def)` over the whole league and OPOY was
the best `off` among offensive players, which are the same row every time the
league's best season belongs to an offensive player. Replaying 158 live
league-years out of 82 saves, that was **158 of 158**: OPOY never once named
anyone the MVP box had not already named. **It was not a trophy, it was a second
printing of one.**

**Do not fix it by redefining MVP as "best offensive player"** — that quietly
deletes the defensive MVP the game still allows. **And do not use a flat "OPOY is
the best offensive player who isn't the MVP".** That flat runner-up reading is a
real convention with a real failure mode: in the season where one man laps the
field it hands Offensive Player of the Year to someone the numbers say was
plainly second best, and the panel prints both stat lines side by side where a
user can see the smaller one.

So the runner-up only inherits **when the race was actually close**, which is
exactly when he has a case. If the leader finished a fifth clear of the field he
keeps both, because real football does hand one man both — Terrell Davis 1998,
Marshall Faulk 2000, Tom Brady 2007 and 2010, Peyton Manning 2013, Patrick
Mahomes 2018 — and a rule that makes it impossible is its own small lie.

**Why 20%, and why not the number that matches real football's rate.** Measured
over those same 158 league-years, the leader's margin over the next man on his
own side of the ball is **5% at the median, 9% at p75 and 17% at p90.** At 20%
the sweep fires on **5.7%** of seasons — call it once in a long dynasty. Real
voters double-honour roughly one year in five, and a threshold near **11%** would
reproduce that rate, but their 1-in-5 comes from judgment we cannot model and
ours comes from raw margin. Tuned to the real **rate**, the duplicate starts
landing in seasons where the two stat lines are close enough that the repeat
looks arbitrary to the man reading them. Tuned where it is, **every duplicate a
GM ever sees is legible from the numbers already on his screen.** Rarity is the
side effect; legibility is the target.

**Exempt the two rookie awards from this, deliberately.** They answer a
different question. MVP and OPOY compete for the same title — best in the
league, best on this side of it — so naming one man both needs to be earned.
"Best first-year man" is its own question, and **Lawrence Taylor won Defensive
Rookie of the Year and Defensive Player of the Year in the same 1981 season.** A
rule that forbade that would delete one of the most famous years the sport has.
**Exclusion applies between awards that argue over the same title, not between
awards that ask different things.** Championship MVP sits outside it for the same
reason and one more: it is decided on one game's box line from one roster, so a
man holding it alongside the MVP is not a repeated verdict, it is two different
questions with the same answer — which is how Patrick Mahomes came to hold both
in 2022.

### 6.3 Championship MVP

Score **only the winning roster's** box lines from the final — real Super Bowl
MVPs are drawn almost exclusively from the winning side, so unlike the
season-long awards do not consider the loser at all. Score on that single game's
line, not season totals: a big final can hand the trophy to someone who was not
otherwise having a huge year. Use `defensiveScore` for defensive positions and
`offensiveScore` otherwise, take the top man, and return nothing if his score is
`<= 0`.

### 6.4 Persist and bump

Write one news row per award, typed `AWARD_MVP | AWARD_OPOY | AWARD_DPOY |
AWARD_OROTY | AWARD_DROTY | AWARD_SBMVP`, each carrying:

- `teamId` and **`playerId`** — an award row is as player-shaped as a signing,
  and without the id the trophy screen, his own page's honours list and the GM's
  career page all had to find him back by **matching the headline as a string**;
- `headline` = `"${name} (${position})"` — and **not the award's name**, which
  every reader derives from the row's type;
- `detail` = the stat line, so nothing needs parsing back apart later.

Keep a retired single-rookie-award type readable but never written: thousands of
rows in already-played saves carry it and every reader still spells it "Rookie
of the Year".

Then **bump the winner**:

```
AWARD_OVR_BUMP = 3,  AWARD_POTENTIAL_BUMP = 2

bumpForMilestone(position, attrs, potential, ovrDelta, potentialDelta):
    newPotential = clamp(potential + potentialDelta, potential, 99)      # never downward
    for each key in POSITION_WEIGHTS[position]:
        attrs[key] = clamp(round(attrs[key] + ovrDelta), 20, 99)
    return { attrs, ovr: computeOverall(position, attrs), potential: newPotential }
```

**Make it a flat, deliberate jump rather than a random roll** — these are meant
to read as a clear step, not blend into normal noisy progression. Raising every
overall-weighted attribute by `ovrDelta` raises the computed overall by almost
exactly that amount, since the overall is a weighted average over those same
keys. **Raise potential first**, so the new attributes always have room to
actually land there.

The award bump is deliberately bigger than the in-season stat-leader milestone
(§7.6, which is 1 and 1), since an award is earned across a full year of
production — or, for championship MVP, a defining performance on the biggest
stage — rather than a mid-season snapshot.

### 6.5 All-Stars

Select at the **end of the regular season**, which is when the real thing is
named, and from what players actually **did**. **Read no rating anywhere in this
module.** A rating is a scouting opinion about how good a player is; an All-Star
selection is a fact about a season that happened, and the app must not say one
when it means the other. (The specific lie this deletes: a rating tier that
printed "Pro Bowl" next to anyone whose overall was high enough, asserting an
honour nobody awarded.)

The timing used to be load-bearing for correctness as well — stats accumulated
straight through the postseason, so selecting after the final folded playoff
games into the totals of the twelve clubs that got there and none of the twenty
that did not. With separate regular and postseason buckets it is now a **choice
about the calendar**, and it stays where it is: an All-Star is named in January,
and the stat line printed under a selection has to be the stat line that earned
it.

**Derive the roster shape; do not invent it.**

```
ALL_STAR_DEPTH = 2
ALL_STAR_SLOTS[pos] = isRankablePosition(pos) ? STARTERS_AT_POSITION[pos] * ALL_STAR_DEPTH : 0
```

`STARTERS_AT_POSITION` is the single shared definition of the starting lineup:
QB 1, RB 1, WR 3, TE 1, LT/LG/C/RG/RT 1 each, EDGE 2, DT 2, LB 2, CB 3, S 2,
K 1, P 1. Offensive line positions are **not rankable** (no stat columns), so
they get **0 slots** — see §4.2. That yields **38 selections per conference, 76
league-wide.**

Deriving it rather than typing a table has a property worth stating out loud:

```
  slots(pos)            DEPTH x starters(pos)         2 x DEPTH
------------------  =  -------------------------  =  -------------
starters in a conf     (teams/2) x starters(pos)         teams
```

The `starters(pos)` term cancels. **Every position is therefore the same
percentile of its own starters** — the top 12.5% in a 32-team league, at
quarterback and at safety alike. No position is a soft touch and none is a
lottery, and that falls out of the arithmetic instead of out of a hand-tuned
table.

```
MIN_APPEARANCE_SHARE = 0.5     # minGames = max(1, ceil(gamesInSeason * 0.5)) = 9 at 17
MIN_SELECTION_SCORE  = 0
```

**You have to have been out there.** One rule applied to everyone: a selection is
an honour for a season, and half a season is the floor for having had one. It
doubles as the sample guard for the rate stats in §4.14 — it is what stops a
kicker who went 4-for-4 in two September games from leading the league in
field-goal percentage.

**The floor under a selection is an ordinary season at his own position**, and
since the score is in standard deviations, zero **is** the positional average.
This almost never binds — slots are the top 12.5% of a position's starters and
the pool includes every backup who played, so a genuine All-Star sits one to
three standard deviations clear. It binds exactly when it should: a position so
thin in a conference that filling every slot would mean handing the honour to a
below-average season. **Then the slot goes empty and the roster says so, because
an All-Star nobody could justify from a stat line is worse than an All-Star who
isn't there.**

Selection procedure:

```
rows = active players with a non-empty season line and a club, at a rankable position
dists = buildPositionDistributions(rows with gp > 0)        # THE WHOLE LEAGUE, both conferences
candidates = rows with gp >= minGames, scored by positionRelativeScore
per (conference, position):
    ranked    = candidates in that conference at that position,
                sorted by score desc, then playerId ascending
    qualified = ranked with score >= MIN_SELECTION_SCORE
    selected  = qualified.slice(0, slots)
    nearMiss  = qualified[slots] ?? null
    unfilled  = slots - selected.length
```

**Build the yardstick from the whole league, both conferences; make only the
roster per-conference.** Otherwise the two conferences mark to different curves
and a selection means two different things.

**Make it deterministic by construction and take no RNG.** Every input is a
number already in the database and every comparison is a total order — score,
then player id, so two identical seasons always break the same way. A re-render
or a re-read cannot move a selection, and selecting the same season twice
selects the same men.

**Keep the first man out** rather than throwing him away: a near-miss is a story
in its own right. A crowded position produces one with a monstrous line; a
position that did not fill its slots produces none.

Persist: one row per selection (typed `ALL_STAR`, headline
`"${name} (${position})"` so the player page can match a man's honours by that
prefix, detail = the stat line), **plus exactly one** league-wide announcement
row (typed `ALL_STAR_ROSTER`). Both, because they do different jobs: seventy-odd
individual rows are the record but they would bury a week's wire, and one summary
row is the occasion but it cannot tell a player card that he made it in 2029.
Weight them accordingly in the wire — the announcement is a headline, an
individual selection is quiet, until it is one of **your** players, at which
point the user-team bonus lifts it clear of everything else on the page. Finding
out your guy made it is the whole point of the feature. Make the write
idempotent: delete that season's rows of all three types and rewrite them, so
the announcement appears once.

Record the user club's best near-miss as a third type (`ALL_STAR_SNUB`), **and
only when he had nobody selected at all.** Write it down rather than recomputing
it on demand, and that is not an optimisation: season stats are cleared at the
rollover and the candidate roster churns, so asking "who just missed?" a year
later gets a different answer — **the near-miss has to be frozen at the same
instant the selection was, or a page quietly changes its mind about who was
snubbed.** Only the user's club gets one: "somebody in the league just missed" is
not a story, and seventy-six of them would be a directory. And only on a
shut-out roster, because a footnote that is a news row does not stay a footnote
— every generic reader picks rows up by type and lifts the user's own to the
top, so a GM with six All-Stars got "and this one just missed" ranked above his
selections.

Print the stat line the way that position's numbers are read, built from the
same column table, so an edge rusher gets sacks and forced fumbles and a corner
gets interceptions and passes defended rather than everyone getting the same
three columns. **Two positions are earned on a rate, and the line has to show
the number that did the work:** a kicker as `"28/31 FG (90%), 44 XP"` and a
punter as `"46.2 yds/punt on 68 punts"`. Printing only the counting columns shows
a stat line that does not contain the reason he was picked — a punter's 3,531
yards is a fact about how often his offence went three-and-out, and a kicker
chosen over a bigger-volume rival was chosen for the misses he didn't have.

**All-Star selection carries no rating bump.** Only the six season awards (§6.4)
and the in-season stat-leader milestone (§7.6) move a rating. If you want
All-Stars to carry one, that is a new balance decision: 76 selections a year
against 6 awards is more than twelve times the rating injected into the league
annually, and nothing here has measured what that does to league-wide rating
drift. Measure it before you ship it.

### 6.6 Open issue — flag this and decide what you want

**MVP has never been a receiver and DPOY has never been an edge rusher**, in any
measured save. Two halves, and the blame splits:

- **The offence was the simulation's fault, not the score's.** Fed real MVP and
  OPOY seasons, `offensiveScore` ranks quarterbacks 407, backs 318, receivers
  265 — real football's own ordering. The simulation was not producing those
  seasons: it split yards on the rate a club **called** passes, so its leading
  rusher gained 2,208 yards against its leading receiver's 1,435 where the NFL
  has them level, and it handed the lead back every rushing touchdown his club
  scored, 28 a year against a real leader's 18. Both are fixed (§4.3, §4.7).
  `offensiveScore` is unchanged, because nothing was wrong with it. **MVP has
  still never gone to a receiver in a measured save.** Build the fixed engine
  first, then re-measure the award distribution over at least 100 league-years
  before you touch the score — and if a receiver still cannot win it, the next
  place to look is the reception volume and yards-per-catch tail, not the
  weights.
- **The defence was both.** The simulation flattened tackles until the league's
  leading linebacker, safety and edge rusher all finished within four per cent
  of each other, and capped every man at one sack and one interception a game so
  no tail could form (§4.5, §4.8); **and** `defensiveScore` was an IDP blend
  that, on real award-winning lines, ranked edge rushers last of the five
  positions that win the award (§4.13).

With both fixed, re-measured over 120 replayed league-seasons:

| position | share of DPOY | AP's own record |
|---|---|---|
| EDGE | 32.5% | 40% |
| S | 25.0% | 9% |
| LB | 22.5% | 21% |
| CB | 20.0% | 11% |
| DT | 0% | 19% |

Against **safety 97.5% / corner 2.5% / EDGE never**, on the same rosters and the
same seeds through the old engine and the old weights. The edge rusher goes from
structurally unable to win it to winning it more often than anybody else.
**Safeties and corners still come out about twice as often as the voters pick
them, and an interior lineman still never does.**

The interior gap is a gap in the **sim's tail, not in the score**: three of the
AP's ten interior winners are Aaron Donald, whose 20-sack seasons are a kind of
interior year this simulation does not produce — its best defensive tackle gets
12, which is what a normal interior leader gets. **Leave it rather than papering
over it**, and if you want to close it, widen the interior sack tail in the
allocator and re-measure, rather than re-weighting the score.

(Disregard any older note quoting "EDGE 52%, LB 20%, S 15%, CB 13%". That is the
same shape on a smaller sample, taken before sacks per game went back to the 2.3
the NFL actually runs and before the measuring probe was fixed to serialise
attributes — without which every club in it played to the same scheme fit.
Scheme fit has since been deleted outright, §3.2.)

---

## 7. Build progression, aging and attrition

### 7.1 The age curve and position profiles

```
AGE_CURVE (first bucket whose maxAge >= effectiveAge wins):
    <= 23  ->  +3.2
    <= 25  ->  +2.0
    <= 27  ->  +0.9
    <= 29  ->   0.0
    <= 31  ->  -1.6
    <= 33  ->  -3.0
    else   ->  -5.0

growthMean(age, position):
    profile = POSITION_AGE_PROFILE[position] ?? { peakShift: 0, declineMult: 1 }
    effectiveAge = age - profile.peakShift
    growth = bucket lookup on effectiveAge
    return growth < 0 ? growth * profile.declineMult : growth
```

| position | peakShift | declineMult |
|---|---|---|
| RB | −2 | 1.35 |
| WR | −1 | 1.15 |
| CB | −1 | 1.15 |
| S | −1 | 1.10 |
| QB | +3 | 0.60 |
| LT / LG / C / RG / RT | +2 | 0.75 |
| K / P | +4 | 0.50 |
| everyone else | 0 | 1.00 |

Real careers do not all bend the same way: backs and defensive backs lean on
speed and burst, peak earliest, and fall off a cliff; quarterbacks, offensive
line and specialists lean on technique and lean bodies that hold up, so they
both develop and decline later and slower. `peakShift` moves a position along
the **shared** curve (positive = ages like someone younger); `declineMult`
scales **only the negative half**, so it never changes how fast a young player
develops — only how hard the downslope bites once it starts.

Note the budget this gives: `3.2 + 3.2 + 2.0 + 2.0 + 0.9 + 0.9 = 12.2` units of
growth across ages 22-27 and nothing after 29. Everything in §7.3 is sized
against that 12.2.

### 7.2 Dev traits and the potential-tier ladder

```
DEV_TRAIT_MULT = { Slow: 0.6, Normal: 1.0, Star: 1.5, Superstar: 2.1 }
generation weights: { Slow: 0.25, Normal: 0.55, Star: 0.15, Superstar: 0.05 }   # must sum to 1
```

```
POTENTIAL_TIER_GROWTH (keyed on POTENTIAL, read off the SAME rating bands the
                       player's own card is labelled from):
    ceiling 99     GENERATIONAL  1.45
    ceiling 95-98  FRANCHISE     1.30
    ceiling 90-94  ALL_STAR      1.18
    ceiling 85-89  STAR          1.08
    everyone else  BASE          1.00
```

**This is the piece that lets entry ratings come down.** The owner's design, in
his words: *"If a player is star - they get a small multiplier added to their
growth, all star is a bit higher, franchise is a bit higher, and generational is
the fastest."*

Rookie entry overalls were too high — a first-rounder arrived at roughly the
league's 78th percentile before he took a snap — and the obvious fix, generating
everyone lower, was **measured and refused**: it flattened the draft, cut the
seventh round's star-or-better count 1.55 → 0.85, and walked the whole league
down, because nothing replaced what was taken away. **This replaces it. Lower the
door and let the talented climb through it**: the stars separate themselves over
five seasons instead of arriving pre-separated on day one, which is both better
football and the arc the owner had been asking for. It also attacks the
realisation defect head on — **four of every five drafted men never got within
three points of the ceiling printed on their own card, and the men furthest from
theirs were the ones with the highest ceilings**, exactly the players this speeds
up.

**Key it on the bands the player can see**, so the tier his card names is the
tier that develops him and the two cannot drift apart. A step at a band edge is
safe here in a way a clamp never is: potential is a fixed property of one man, so
this shifts **individuals between ladders** rather than piling a distribution up
against a wall.

**It is a bonus, never a tax** — everybody below the Star band develops at
exactly the rate they always did.

### 7.3 The growth roll

```
progressPlayer(rng, position, attrs, age, potential, devTrait, speedMult, scale = 1, playerId?):

    arc      = playerId === undefined ? 1 : developmentArc(playerId)      # ARC FIRST
    ageMean  = growthMean(age, position) * arc
    tierMult = ageMean > 0 ? potentialTierGrowthMult(potential) : 1       # THE SIGN GUARD
    mean     = ageMean * (DEV_TRAIT_MULT[devTrait] ?? 1) * speedMult * scale * tierMult
    noiseSd  = 2.4 * sqrt(max(0.05, scale))

    for each attribute key of this position:
        current    = attrs[key] ?? 50
        roomFactor = GROWTH_ROOM_MAX * tanh((potential - current) / GROWTH_ROOM_SCALE)   # 1.5, 9
        delta      = rng.normal(mean * (mean >= 0 ? roomFactor : 1), noiseSd)
        attrs[key] = clamp(round(current + delta), 20, 99)

    return { attrs, ovr: computeOverall(position, attrs) }
```

**Apply the tier ladder to growth only. Multiplying a decline by it is a sign
error, and this codebase has shipped that same sign error in four separate
guises.** `growthMean` goes negative past a man's peak, and a 1.45× on a fall
would make the best players in the league fall apart fastest. Past the peak the
tier multiplier is exactly 1 and a generational man ages like anybody else.

**Compute the arc before the guard, and gate the guard on the arc-adjusted
drift.** A man on a failing arc has a **negative** drift even at 22, and the
ladder must not be applied to that. Reading the sign of the raw age curve alone
would hand a failing 22-year-old generational prospect a 1.45× on his slide.

**Replace the room clamp with a soft knee, and do not reinstate the floor.** The
room factor was a bare `/ 30` inside a hard `clamp(…, -1, 1.2)` with the factor
floored at 0.1, and the three together were the reason no prospect ever became
what he was projected to be. Two separate failures:

1. **The 0.1 floor meant `potential` capped nothing at all.** A growing player
   kept a positive expected gain no matter how far past his ceiling he already
   was. On its own the drift is small; combined with the roll's own per-attribute
   noise and with rosters that keep whoever drifted **up** and release whoever
   drifted down, it is **a ratchet with no counterweight** — and it was the main
   engine behind measured league-wide rating inflation: **mean active overall 65
   → 81 across 13 simulated seasons, with 27% of active players sitting at or
   above their own stated ceiling.**
2. **`/ 30` plus the clamp made the ceiling unreachable from below.** At `/ 30` a
   first-rounder entering at 74 with an 88 ceiling has a room factor of 0.47 and
   falling, so he spends about **40%** of that 12.2-unit budget and peaks near
   **79 — nine points short, every time, on the mean.** Star and Superstar traits
   reach 81 and 83. Measured over 12,890 season-over-season deltas: a rostered
   under-24 gained a **median of +1**, **17% of them declined**, and a **+5
   season happened once in 516 player-seasons league-wide.** There were no
   breakout years because there was no arithmetic that could produce one. And the
   hard clamp piled every wide-gap player onto one growth rate.

`MAX * tanh(gap / SCALE)` is zero **at** the ceiling, **negative above it** (the
pull back down that stops rating inflation, and harder now than the old −1
bound), and saturates smoothly toward MAX instead of hitting a wall — so no band
of players shares one growth rate because they all landed on the same clamp.
`SCALE = 9` is the gap at which a player grows at 76% of the maximum.

**This changes the young half of the curve only.** The room factor applies to
positive growth alone (`mean >= 0 ? roomFactor : 1`), so ages 30+ decline exactly
as hard as they did before — the teeth measured at **−1.80 for 30-31** and
**−5.22 for 34+** are untouched.

### 7.4 The hidden development arc

```
DEV_ARC_SD        = 0.3
DEV_ARC_BUST_ODDS = 0.16
DEV_ARC_BUST_MEAN = -0.9
DEV_ARC_BUST_SD   = 0.55

developmentArc(playerId):
    r = new Rng(`dev-arc-${playerId}`)                 # ITS OWN SEEDED STREAM
    return r.float(0, 1) < DEV_ARC_BUST_ODDS
             ? r.normal(DEV_ARC_BUST_MEAN, DEV_ARC_BUST_SD)
             : r.normal(1, DEV_ARC_SD)
```

**Everything else in the development model is a rate the game can see coming:
age, position, dev trait, ceiling tier, playing time, production. Two players
with the same row of those numbers developed identically**, so a prospect who
arrived good stayed good and a first pick could not fail.

That was measurable and it was measured. The consensus board's number one peaked
below 78 in **10%** of drafts — but **only** because the board sometimes crowned
a man who could not play. Sweeping the board's own ceiling-trust knob across its
entire range (0.95 down to 0.45) moved his mean peak by **0.0** and his bust rate
by **0.0%**. **Every bust in the game was a scouting accident.** Fix the board and
the busts vanish with it, which is exactly what happened when the fix was tried:
10% → 0%.

So the arc is **the part nobody can see.** Drawn once from a man's own id and
never redrawn, it is how much of his development he actually converts — the work,
the injuries that do not show up as an injury, the scheme that never fit, the
league solving him in year two. Most players land near 1. **16% of them are on a
failing arc whose mean is negative: they do not merely stall, they slide**, which
is the only way a man who arrives at 83 can finish under 78 and the only honest
way a first pick busts once the board stops handing out frauds.

Hold yourself to these properties:

- **It is a roll, not a label.** Store nothing, render nothing, let no scout buy
  it, and keep it out of the schema. A pure function of the player id means a
  save replays identically and the same man is the same story every time it is
  opened. **A bust you could look up would be a tax; a bust you can only find
  out about by watching him play is a football season.**
- **Give it its own seeded stream**, keyed on the player id and nothing else, so
  adding another roll to the progression module later cannot reshuffle the arcs
  already in people's leagues.
- **Return exactly 1 when no player id is supplied.** Every caller that does not
  know who it is holding develops a man at his stated rate, which is what every
  caller did before the arc existed.
- **It must not accelerate decline for a high-ceiling man** — that is the sign
  guard in §7.3, gated on the arc-adjusted drift and not the raw age curve.

### 7.5 Playing time

```
positionOpportunity(position, s):      # VOLUME, not production
    QB:  passAtt + rushAtt
    RB:  rushAtt + targets
    WR:  targets
    TE:  targets
    EDGE/DT/LB/CB/S:  tackles + pd + sacks + defInt + ff
    K:   fga + xpa
    P:   punts
    anything else (the offensive line): null
```

**There are no snap counts in this simulation, so the honest proxy is the volume
a position is credited with, out of what his own club spent there.** Use
opportunity, not production, so a man who plays badly and a man who plays well
have the same role and only the ceiling pass can tell them apart.

**Positions the box score does not name get `null`, not zero.** Scoring an
offensive lineman's opportunity at 0 would tell the model every starting left
tackle in the league is a healthy scratch. `null` means **no growth penalty and
no ceiling revision in either direction**, which is the correct answer for a
position the sim records nothing about.

```
roleIndex(own, teamTotal, teammates):
    if teamTotal <= 0 or teammates <= 0: return null
    return (own / teamTotal) * teammates
```

**Normalise by the group size**, so 1.0 is an even split of the job whatever the
position's shape, a full-time starter is comfortably above it, and a healthy
scratch is 0. That is what makes a quarterback (one job, three men) and a
receiver (four jobs, six men) readable on one scale.

```
PLAYTIME_GROWTH_PENALTY        = 0.45
PLAYTIME_GROWTH_PENALTY_ROOKIE = 0.30
PLAYTIME_GROWTH_SCALE          = 0.55

playtimeGrowthMult(role, experience):
    if role is null: return 1                      # neutral, not penalised
    penalty = experience <= 0 ? PLAYTIME_GROWTH_PENALTY_ROOKIE : PLAYTIME_GROWTH_PENALTY
    return 1 - penalty * exp(-max(0, role) / PLAYTIME_GROWTH_SCALE)
```

The ladder this produces, and **it cannot invert**:

| case | multiplier |
|---|---|
| full-time starter | 1.00 |
| rookie who never plays | 0.70 |
| second-year-plus who never plays | 0.55 |
| unknown role (offensive line) | 1.00 |

**The rookie year is the exception, and the owner named it:** *"idle players,
especially in their rookie year can still develop (like a backup QB sitting
behind a veteran)"*, and on how big the gap should be, *"i still think its fine
to have a gap, play time shoudl equal faster results"*, *"Maybe for first year
rookies thats 70% before going down to 55%?"*. A first-round quarterback who
spends a season holding a clipboard behind a starter is a real football path, and
before this the game charged him the same rate it charged a 29-year-old career
backup. `experience` is **completed professional seasons**, so 0 is his first
year — whatever round he came from or whether he was drafted at all, since an
undrafted rookie learning behind a starter is the same story.

Both figures are **floors under the same taper**, and the taper only ever climbs
toward 1 as the role grows, so **no rookie who sits can ever out-develop the same
rookie who plays.** The rookie floor closes part of the gap; it can never close
it. At one scale-length of role, 63% of the penalty is already gone.

**This slows growth and does nothing else. It can never move a ceiling.** Not
playing is an absence of evidence, not a failure to produce.

### 7.6 In-season checkpoints

```
CHECKPOINT_INTERVAL     = 4
CHECKPOINT_GROWTH_SHARE = 0.25

checkpointShare(week, seasonLength):
    isCheckpoint = (week % 4 == 0) or (week == seasonLength)
    if not isCheckpoint: return 0
    weeksInWindow = week - floor((week - 1) / 4) * 4
    return (weeksInWindow / 4) * 0.25
```

Spread growth across the season instead of landing it in one lump at the
offseason step. The old single roll was realistic for a career arc but
**invisible week to week**; this makes improvement and decline something you can
watch happen a few games at a time. Fire at every interval **plus the final
regular-season week itself**, however many weeks that leftover window covers, so
no games go uncredited just because the season length is not a clean multiple of
the interval.

At `seasonLength = 17` the shares are 0.25 at weeks 4, 8, 12 and 16, then
**0.0625** at week 17 — a total of **1.0625** of a year's growth. That overshoot
is a consequence of the "plus the final week" rule and nobody measured whether
1.0625 or 1.0 is wanted. **Decide it deliberately:** either accept it and say so,
or make the final-week window share the remainder rather than add to it.

Each checkpoint, in order:

1. **Read every active player, ordered by id.** The ordering is part of the
   seed, not a tidiness choice: a single RNG is consumed player by player in
   this loop's order, so without an explicit order the database may hand back
   the same rows in a different sequence on two runs and the "deterministic"
   checkpoint produces different football. **Found by running the same seed
   twice and getting two answers.**
2. Load the GM's coaching-staff development multiplier **once per checkpoint,
   not per player** (one indexed read), and apply it only to the **user's own
   roster** — a skill that sped up all 32 clubs would be a no-op dressed as an
   upgrade. Default 1.0 with no ranks, so a save that has never opened that
   screen rolls exactly what it rolled before.
3. **Performance tier.** Per position, rank men by `productionScore / week`,
   drop anyone whose rate is exactly 0, and skip the position entirely if fewer
   than **4** remain (sample too small for rank to mean anything). Top **15%**
   get `BREAKOUT_GROWTH_MULT = 1.6`; bottom **15%** get
   `SLUMP_GROWTH_MULT = 0.6`, **but only if `trueOvr >= 72`** — a slump
   multiplier is for an established starter producing at the bottom of his
   group, not for a backup who was never going to.
4. **Stat-leader milestone.** Flag whoever currently tops the league in
   `passYds, passTd, rushYds, recYds, tackles, sacks, defInt` — once per player
   even if he leads several — and hand him
   `bumpForMilestone(…, STAT_LEADER_OVR_BUMP = 1, STAT_LEADER_POTENTIAL_BUMP = 1)`
   **applied on top of the rolled attributes**, plus a `DEV_MILESTONE` news row
   naming the categories.
5. **Role**, per §7.5, computed every checkpoint because it feeds the growth
   roll.
6. **Once a year only**, at the last regular-season checkpoint, revise the
   ceiling (§7.7). Do the revision **before** the growth roll, so the same
   checkpoint that lowers a projection also grows him toward the **revised** one
   rather than spending a year chasing a number the club has already given up
   on.
7. Roll growth:
   `progressPlayer(rng, position, attrs, age, revisedPotential, devTrait,
   speed * coachingMult, share * perfMult * focusMult * playtimeMult, playerId)`.
8. Write back in **one bulk statement** — this can touch 1,500+ players.

There is a per-player "development focus" multiplier (`1.5`) that is **currently
unreachable**: charges were bought with a scouting currency that was removed, so
nothing grants one, the column is 0 for every player in every save, the
multiplier is always exactly 1, and the decrement matches zero rows every
checkpoint. The owner asked twice what it does; **the honest answer is nothing.**
If you wire it up, **re-tune it first** — 1.5 is far too large next to the
coaching-staff skill, whose maximum is 1.15.

### 7.7 The ceiling is a projection, and it moves both ways

**`potential` used to be write-once-upward**: the generator set it, a milestone
or award bump could raise it, and **there was no line of code anywhere that
could lower it.** A 99-ceiling prospect who played four full seasons and produced
nothing was still a 99-ceiling prospect — behind schedule, never re-projected.
**That is the mechanical reason this game had no busts.**

**Judge him against what he is, never against his ceiling.** This is the whole
design and it is easy to get backwards. A generational prospect enters the league
rated 77. He produces like a 77, **because he is a 77.** Measure that against his
99 ceiling and he fails every week of his rookie contract and erodes his own
projection for the crime of being young — which would make a high ceiling a
**handicap** and hand better careers to the players nobody projected. So the
yardstick is his **current overall**: producing like a 77 while rated 77 is
exactly neutral and nothing moves.

**Fit the expectation from the league itself every year** rather than writing it
down as a constant, because the answer moves with the rules, the sim and the
position:

```
deliveryZScores(rows of { id, ovr, perGame }):
    if rows.length < CEILING_MIN_GROUP (10): return {}
    compute means mx, my; population sds sx, sy; if either <= 0: return {}
    corr = cov / (n * sx * sy)
    if corr < CEILING_MIN_R (0.1): return {}            # rating did not predict production here
    rr     = min(corr, CEILING_MAX_R (0.9))
    spread = sqrt(1 - rr^2)
    per row: z = (((perGame - my) / sy) - rr * ((ovr - mx) / sx)) / spread
```

**Least squares in standardised units.** With `r` the correlation between rating
and production-per-game at this position this season, a man rated `zx` standard
deviations above his position's mean is **expected** to produce `r * zx` above
it, and the residual is divided by the spread that is left, `sqrt(1 - r²)`.
**That last step is the one that matters.** Comparing raw percentile ranks — or
assuming `r = 1` — makes the highest-rated player at every position
**structurally incapable of beating expectation**, so the best men in the league
would erode every year for being the best. Regressing on rating is unbiased at
every point of the rating range, which is the only property this has to have.

Cap `r` below 1 because rating never predicts production perfectly, and an
uncapped correlation divides by a vanishing spread and **turns rounding into
evidence**. Below `CEILING_MIN_R` the fit says rating did not predict production
at this position this year, so no expectation is credible and the position is
skipped entirely.

**Fit over the men who actually had a job.** A league-wide fit including every
healthy scratch would describe the production of not playing, and every starter
would beat it. Require `gp > 0` and a non-zero evidence sample.

```
CEILING_DELIVERY_DEADBAND = 0.5
CEILING_DELIVERY_SPREAD   = 1.3
CEILING_AGE_MIDPOINT      = 26.0
CEILING_AGE_WIDTH         = 2.1
CEILING_EROSION_RATE      = 0.18
CEILING_RISE_RATE         = 0.055
CEILING_RESIDUAL_ROOM     = 4
CEILING_ROLE_FLOOR = 0.4   CEILING_ROLE_FULL = 1.0
CEILING_GP_FLOOR   = 5     CEILING_GP_FULL   = 12
CEILING_NEWS_MIN   = 2

deliveryDrive(z):                                   # odd, dead-banded, saturating
    past = |z| - CEILING_DELIVERY_DEADBAND
    return past <= 0 ? 0 : sign(z) * tanh(past / CEILING_DELIVERY_SPREAD)

ceilingAgePace(effectiveAge):                       # ONE logistic, read from both ends
    return 1 / (1 + exp(-(effectiveAge - CEILING_AGE_MIDPOINT) / CEILING_AGE_WIDTH))

ceilingRevision({ deliveryZ, age, position, potential, ovr, sample }):
    if sample <= 0: return 0
    drive = deliveryDrive(deliveryZ);  if drive == 0: return 0
    pace  = ceilingAgePace(age - POSITION_AGE_PROFILE[position].peakShift)
    if drive < 0:
        room = max(0, potential - ovr) + CEILING_RESIDUAL_ROOM
        return drive * pace * room * CEILING_EROSION_RATE * sample
    room = max(0, 99 - potential)
    return drive * (1 - pace) * room * CEILING_RISE_RATE * sample

evidenceSample(role, gp):
    if role is null: return 0
    return ramp(role, ROLE_FLOOR, ROLE_FULL) * ramp(gp, GP_FLOOR, GP_FULL)
```

**One function with a sign**, so up and down are the same mechanism read in
opposite directions and cannot drift apart:

- **drive** — odd, dead-banded, saturating in the evidence. An ordinary season
  moves nothing, and a four-sigma season is not four times a one-sigma one: the
  standing outlier rule applied to evidence. The deadband is where most of the
  league lives.
- **pace** — one age logistic, read from both ends. Young: the projection is
  still credible and a big year raises it. Old: the projection is no longer
  credible and a bad year lowers it. *"especially with age"*, in one number, at
  the position-adjusted age — the same yardstick retirement uses.
- **room** — what is left in the direction being moved. Down, the **unrealised**
  part of the projection plus the residual; up, the space below 99. Both shrink
  as the ceiling moves, so a revision **decays toward the player** rather than
  stopping at a wall, and nothing piles up at a floor because there is no floor.
- **sample** — how much of a real look he got, as two ramps rather than two
  gates: a man in a thin role and a man who missed eleven weeks have each shown
  you a fraction of a season, and a fraction is what their season is worth.
  **Zero for a man who did not play, which makes not playing worth exactly
  nothing in both directions. Absence of evidence is not evidence of failure.**

**Why a generational prospect does not collapse — and it is not because a floor
stops him.** It is the feedback loop, and it closes itself: erosion lowers the
ceiling; the growth room factor then pulls his **rating** down after it; a man
rated lower is expected to produce less; his delivery z climbs back toward zero,
and the erosion stops. **A club revises until the projection matches the player
and then stops revising**, which is what a front office actually does.

The residual room was not always there — erosion used to be strictly
proportional to `potential - trueOvr`, which made the ceiling **unreachable from
below by construction**. That was a clean guarantee and it stopped being
available the moment growth was made to actually converge (§7.3): with most
players now catching their own ceiling, the old room term went to nothing and
**switched the whole mechanism off for exactly the population it was written
for.** The residual is the points of projection a club never regards as banked.

The pathological bound: a 99-ceiling man in a full-time role producing a season
and a half light **every year from 22 to 32**, with his rating pinned so the
feedback cannot act, ends on a ceiling of **82**. That is eleven consecutive
disasters and a starter's ceiling at the end of them.

**`CEILING_EROSION_RATE` is 0.18, and the walk to it is the reasoning.** At
**0.155** the mechanism was real but **invisible**: over a 10-season league only
**14.7%** of career starters ever saw their ceiling move down at all, **2%** of
drafted careers lost 2 or more points of it, **0.4%** lost 6 or more, and the
mean drift across all drafted careers was **+0.10** — the rise half outweighed
it. **A bust mechanism nobody can see in a career histogram has not shipped.**
Then **0.30** against a rise rate of 0.055 made a ceiling **five and a half times
readier to fall than to climb**, and the whole shape of the game's development
came out of that ratio: a −5 season was **15 times** more common than a +5, and a
breakout was a **1-in-516** event. The owner, on seeing it: *"lets maybe tone
down the erosion a bit then"* — after asking for the other half, *"if a below
star has an amazing year maybe he jumps to star, or all star etc."* **Those are
one request.** A promotion ladder nobody climbs is not a ladder. **0.18** keeps
busts real and visible (well above the 0.155 that measured as invisible) and
still lets erosion outrun rise better than three to one, so missing on a prospect
remains easier than breaking out, which is true to football. What it stops being
is the dominant force in every career.

Keep `CEILING_RISE_RATE` deliberately smaller: the stat-leader and award bumps
already pay the upside in whole points, and this is the slow half of it.

**No discrete bust event exists. Build none.** Nothing fires once, flags a
player, or takes a step. There is no threshold to be on the wrong side of.

**The revision is a float, deliberately** — one season is meant to be worth a
fraction of a point, so the ceiling is an average of a career's evidence rather
than a verdict on one year. Quantise it **without throwing the fraction away**:

```
quantizeRevision(rng, delta):
    whole = floor(delta)
    frac  = delta - whole
    return (frac > 0 and rng.float(0,1) < frac) ? whole + 1 : whole
```

Rounding a −0.4 season to zero every year would make a slow slide impossible and
leave only the cliffs; always rounding away from zero would make one ordinary
year cost a whole point. Spending the fraction as the probability of the extra
point makes this an **unbiased quantiser**: the expected value of what lands in
the column is exactly the float the evidence produced. **It is not a dice roll
about whether a player busts** — size and sign are decided entirely by his
production, his role, his age and how much of his projection is unproven. The
only thing left to chance is which side of a whole point a fractional answer
falls on, and over a career those average out to the number itself.

Clamp the stored ceiling to `[1, 99]`, which is the column's documented range
and **not a policy floor**: erosion is proportional to the unproven gap, so it
approaches a player's current rating without reaching it, which is what keeps a
man who reached 88 of a 99 projection an 88 player. **Nothing accumulates at
either end of that clamp.**

**Say it out loud when a ceiling moves.** A revision of `>= CEILING_NEWS_MIN`
whole points earns a news row. A number that is on his player page and in his
season review, that falls with nothing explaining it, has handed the GM a random
decrement. Give it **its own news type**, not the stat-leader type: the season
review reads every stat-leader row for a player and renders it as "he led the
league in X", recovering the category off the headline with a regex whose
fallback is "a marquee category" — so filing a ceiling **drop** under that type
would make the season review **congratulate a man on leading the league in
nothing**, which is exactly the class of defect (a rendered sentence that is not
the thing the system did) this project keeps fixing. **Keep ratings out of the
copy**: the true rating is hidden unless the league has reveal-true-ratings on,
and a wire item is read by a GM about all 32 clubs' players, so the text says
what happened and never the numbers.

### 7.8 The offseason roll for rostered players

At the `PROGRESS` step, for every `status === 'ACTIVE'` player:

```
if retirementEnabled and age >= 32 and rng.bool(retirementChance(age, trueOvr, position)):
    retire him
else:
    age += 1; experience += 1; fatigue = 0; injuryWeeks = 0; injuryType = null
```

**Do not grow attributes here.** Attribute growth is spread across the in-season
checkpoints so it is visible well before the offseason rather than delivered as
one lump. Batch both branches into two bulk updates rather than one round trip
per player.

**Delete the retiring player's contract row.** Retirement never did, which left a
stale contract attached to a player nobody could ever cut or extend again — a
longstanding bug, and the only path off an active roster that had it.

**Clear the injury label alongside the zeroed clock**, for the reason in §2.4:
the two are one fact.

**Return how many careers ended** and say it in the step summary. That number
used to go nowhere and the step said only that "some" were over; it now shares
one advance with the rest of the offseason bookkeeping, so the summary is the
only place a GM learns his league lost anyone at all.

```
retirementChance(age, trueOvr, position):
    effectiveAge = age - POSITION_AGE_PROFILE[position].peakShift
    if effectiveAge < 32: return 0
    ageFactor   = clamp((effectiveAge - 32) / 8, 0, 1)
    skillFactor = clamp((70 - trueOvr) / 40, 0, 0.5)        # bad old players retire faster
    return clamp(ageFactor * 0.35 + skillFactor, 0, 0.9)
```

**Note the asymmetry and decide whether you want it:** the caller gates on raw
`age >= 32` while the function gates on the **position-adjusted** age. A
quarterback (peakShift +3) at 33 passes the caller's gate and then returns 0, so
no quarterback retires before 35 — which is defensible — while a running back
(peakShift −2) at 32 is already at effectiveAge 34 and carries real odds. The
reference implementation has this; nothing measured it either way.

### 7.9 The offseason roll for unsigned players

**Age, develop and retire free agents on the same schedule.** Until this existed
at all, progression, aging and retirement all filtered on `status === 'ACTIVE'`,
so **a free agent was frozen in time forever.** That is the mechanical reason the
pool could only grow — measured **140 → 4,411** unsigned players over 13
simulated seasons, holding **593 players rated 80+** — and a large part of why
mean active rating climbed without bound: the only players who ever left the
active pool were the ones who declined, and nothing ever came back. (A longer run
measured 140 → 4,740 holding 798 rated 80+, 201 of them 90+ and five of them 97,
in a 32-team league.)

For every `status === 'FREE_AGENT'`, `isDraftee === false` player:

```
unsignedYears = yearsUnsigned + 1
odds = max(retirementChance(age, trueOvr, position),
           unsignedAttritionChance(unsignedYears, trueOvr, leagueMeanOvr))
if retirementEnabled and rng.bool(odds): retire him; next
progressPlayer(rng, …, potential, devTrait, progressionSpeed,
               UNSIGNED_PROGRESSION_SCALE (0.5), playerId)
age += 1;  yearsUnsigned += 1
```

```
UNSIGNED_ATTRITION_BASE              = 0.42
UNSIGNED_ATTRITION_PER_YEAR          = 0.18
UNSIGNED_ATTRITION_SHIELD_ABOVE_MEAN = 8
UNSIGNED_ATTRITION_FLOOR_BELOW_MEAN  = 10
UNSIGNED_ATTRITION_MAX               = 0.85

unsignedAttritionChance(yearsUnsigned, trueOvr, leagueMeanOvr):
    years    = max(1, yearsUnsigned)
    base     = BASE + (years - 1) * PER_YEAR
    shield   = leagueMeanOvr + SHIELD_ABOVE_MEAN
    floor    = leagueMeanOvr - FLOOR_BELOW_MEAN
    exposure = clamp((shield - trueOvr) / max(1, shield - floor), 0, 1)
    return clamp(base * exposure, 0, MAX)
```

**Ordinary retirement cannot be the only way off the free-agent list:** it does
not start until 32, and most of the ~400 players who enter the pool every year
are 22-year-old undrafted rookies who would otherwise sit there for a decade.
**Quality shields a player almost completely** — somebody always calls a genuinely
good player, and with upgrade-and-displace in the AI wave somebody now actually
does.

**Measure the shield against the league's own mean rostered rating, read once per
call, not against a fixed number.** A fixed number stops meaning the same thing
as the league drifts.

**Keep two separate unsigned clocks and do not merge them.** `yearsUnsigned` is
this roll's own counter. `weeksUnsigned` — ticked on every advance (§2.7) — is
what an asking price falls on, and must be left untouched here: a yearly counter
moving in one lump would drop the price of a man released in the playoffs off a
cliff four weeks later, for a reason that has nothing to do with him.

**Exclude draftees.** They are the class waiting for a draft that has not
happened yet, not free agents, and aging them here would hand every rookie an
extra year before he was ever picked.

Develop them at **half** a full year: a rostered player earns his growth in
weekly checkpoints with a coaching staff and real snaps, and a man training on
his own gets less — but a 22-year-old on the street should not be frozen at
22-year-old ratings either.

Clear any contract row defensively when one of these retires. A free agent has
no contract by construction, but retirement is the one status change that
historically left rows behind.

Chunk the write-back (500 rows at a time).

### 7.10 Known open gap

**Undrafted prospects still accumulate in the free-agent pool.** Each class adds
more players than the ~224 drafted; the remainder become ordinary free agents.
A nine-season measured run ends with **~2,500 free agents**, which is what makes
the free-agent list unreadable late in a dynasty. §7.9's attrition is the
mechanism that is supposed to drain it — **verify it actually does over a
ten-season soak run and report the terminal pool size.** If it does not, the
attrition base is the number to raise, and the thing to watch is that raising it
does not start deleting genuinely good unsigned players, which the shield exists
to prevent.

---

## 8. Build the week report and the season artifacts

**Assemble these from rows the simulation already wrote. Add no new schema, no
new math, and no RNG of their own.** Every figure is either read straight off a
game, team or news row, or computed by **the exact function the rest of the game
uses for that number** — the standings comparator that seeds the real bracket,
the real clinch math, the same win-chance estimate the dashboard shows. That is
the rule these modules exist to obey.

### 8.1 The week report (fires once per Advance)

Return it alongside the summary sentence, and keep the sentence as the
accessible fallback for cases with no report — an offseason step, a preseason
roll, a league with no user team.

| field | what it must be |
|---|---|
| `seasonYear`, `weekLabel`, `phaseLabel`, `gamesPlayed` | "Week 8" / "Wild Card Round" / "The Final"; "Regular Season" / "Playoffs" |
| `teamId`, `teamAbbr`, `teamColor` | the user's club, or null |
| `result` | both sides with score, record **after** this game, curated primary colour, won flag; `userIsHome`; outcome W/L/T; margin **signed from the user's view**; overtime; the stored recap; the game-shape silhouette; the quarter linescore |
| `result.winChancePre` | **the estimate shown before kickoff**, never recomputed afterwards against a record that already includes the result |
| `result.upset` | true only when the user won a game the same estimate had him losing badly (below **35**) |
| `changed` | record before/after, division label and rank before/after, **conference seed** before/after off the real seeding order, games back of the cut line (null when inside), streak before/after, point differential before/after, clinch label + tone + a `clinchFlipped` flag so the line only shouts on the week it flips, `playoffsOut`, and `draftSlotBefore`/`draftSlotAfter` |
| `gameBall` | the week's best individual outing, ranked by the cross-position score of §4.14 built from **this week's box lines** |
| `coach` | raw material for a collapsed comments section |
| `injuries`, `otherInjuryCount` | the user's training room in full; everyone else's collapsed |
| `headlines`, `next`, `nextNote` | the wire, the next fixture, or "Season over" / "Playoffs are set" |
| `summary` | the plain sentence this replaces |

**`playoffsOut` is a flag, not just a label**, and it has to be, because once it
is true *"Playoff position: 12th → 12th · 4.0 GB"* is not a quiet week — it is a
row describing a race that has finished. Replace it with the draft board, which
is the number still moving. Compute the draft slots **always** and render them
**only** once `playoffsOut`: a club still in the race does not want to be told it
is climbing the draft board; a club that is out has nothing else that moved. Use
the real worst-first rule (§5.5), never a reordering of the standings table.

**Do not track standings changes in the postseason.** Playoff results never touch
the Team row (§2.2), so a "record went from X to Y" band would be printing an
unchanged number as if it moved.

Take the pre-advance snapshot as a **real** snapshot rather than reconstructing
it afterwards by subtracting the result back out.

### 8.2 The trophy moment (Tier 0, at most once per season)

Fire it only when the user's own season just ended in the postseason — he won
the title, or he lost the game that knocked him out. At most twice in a season,
usually once, usually never.

Carry: `kind: 'CHAMPION' | 'SEASON_OVER'`, the club's identity and colour, the
round it ended in, the final score with the opponent, the **road** (one leg per
postseason game), a `bye` flag set **only when the bracket actually gave them
one** (a top-two seed with no wild-card game), rounds won, record, seed, point
differential, the final's own linescore and silhouette, the championship MVP
resolved **back to a man** with the stat line stored for him verbatim, the men
who produced across the **whole run** rather than just the last game, and —
for `SEASON_OVER` only, and only when the draft order actually exists yet — the
next pick.

**Count the franchise's history on two clocks and never mix them.** The season
records table holds every season the club has on the books **including the two
decades of seeded backstory**, while the GM was hired in a specific year — *a
title won in 2011 is the franchise's, not his.* Print both, each under its own
label: franchise titles, the most recent title **before** this season (or null),
seasons on record (so "first ever" can say how long a wait it was), titles since
the GM was hired, the year he was hired, seasons served.

Build the payload **before** the phase flips, so the season being described is
still the season the league is standing in.

### 8.3 The season-end card (the intersection)

When one press carries both a long span and a season ending, render **one**
artifact, not two in a row (§2.5). Make it a **pure** fold over the week reports
the client is already holding — no RNG, no database, no new numbers — and have
the card render the trophy half straight off the Tier-0 payload rather than
taking it as an input.

Fold: the regular-season weeks of the stretch oldest first (label, short label,
outcome, scores, opponent, home/away, the **pre-kickoff** win chance, and the
game id so the one week worth reopening can be reopened), the number of advances
covered, the postseason rounds inside the stretch, the injuries with the week
each man went down in and a flag for "during the run", and **the one week the
year swung on**:

- **Prefer the streak.** A run of wins is what a season is actually remembered
  by, so take the **first win of the longest winning streak** — but only if the
  streak is **at least three** long (two is a fortnight, not a run) and only if
  it did not start on the **first game of the stretch**, because the opening
  game of a span is where it began, not where it turned.
- **Otherwise the single most improbable win** — the one the club's own pre-game
  estimate had them losing.
- **Otherwise null, and print nothing.** When neither is true there is no honest
  answer.
- **Only regular-season weeks are candidates.** Every postseason game is already
  printed in full on the card's road strip, so promoting one here would be the
  same game twice on one screen.

### 8.4 The season review

Build a per-player, per-season narrative off the same production scores (§4.13),
the same per-position percentile machinery, and the stored news rows. Two
constraints carry over from elsewhere and must hold:

- The stat-leader news type is rendered as *"he led the league in X"* with the
  category recovered off the headline. **Nothing else may be filed under that
  type** (§7.7).
- Grade a man against **his own position group**, using the dispatcher, so a
  punter is not graded on a formula written for a receiver.

---

## 9. Flag these open issues; decide each deliberately

1. **MVP has never been a receiver; DPOY has never been an edge rusher.** §6.6
   has the full measurement, the two halves of the cause, and what to re-measure
   before touching anything. The engine fixes are in; the award distribution has
   not been re-measured on a clean build.
2. **An interior defensive lineman never wins DPOY** (0% against the AP's 19%),
   because the sim's best defensive tackle gets 12 sacks where the real tail
   reaches 20. That is a gap in the allocator's tail, not in the score.
3. **Undrafted prospects pile up in the free-agent pool** — ~2,500 after nine
   seasons. §7.10.
4. **No roster-size ceiling is enforced outside final cuts** (INV-08). The
   ceiling exists and defaults to 53 but is read only at generation and at
   cut-down day; nothing in free agency, the draft or trades checks a club's
   active count before adding to it. Either gate every acquisition path or
   accept that cut-down day is the only enforcement and say so.
5. **Nothing enforces the roster floor either — and after measuring it, nothing
   should.** The minimum is read by no signing, cut, draft or advance path, and
   the AI roster fill deliberately skips the user, so a user can carry 23 men
   through a whole offseason roll and bank the salary. **The sim already punishes
   that, hard.** Two leagues off the same seed, same schedule, same opponents,
   with the user's club stripped to its best 24 men and the players removed
   without going through the cut path so the only variable is football: offense
   **83.7 → 79.7**, defense **83.9 → 77.6**, a **12-5 season turned into 7-10**,
   and a point differential of **+114 turned into −55.** About five wins — a
   playoff team turned into a spectator. Empty depth slots score at replacement
   level and an injury on a short roster has nobody behind it. So **do not add an
   advance gate**: it would only take away a decision the engine is already
   pricing correctly. What was missing was that nothing **told** anyone — the
   invariant warning is a developer's screen a GM never opens, and the front
   office brief said only that his safeties looked thin. **Name the shortfall in
   the brief**, silent through `OFFSEASON` and `RESIGN` where every club is
   briefly under the line by design. Still genuinely open: an AI
   "sign minimum-salary bodies up to the floor" pass for the handful of CPU
   clubs that sit under the floor at their annual trough.
6. **The fantasy-draft completion condition is suspect.** It marks the draft
   complete once the pick index passes the turn-order length — one single pass
   through all 32 clubs' turns — but a fantasy draft is meant to fill every
   club's **entire** roster from a shared pool, which needs far more than one
   turn each. Not investigated. If you ship a fantasy start, drive it through the
   soak harness first (the matrix in §10.3 does).
7. **Three tuning constants are declared and never read** — §3.9.
8. **`fum` is declared in the stat shape and never written** — §4.1.
9. **The checkpoint growth shares sum to 1.0625, not 1.0** — §7.6.
10. **Retirement's caller gates on raw age and the function gates on
    position-adjusted age** — §7.8.
11. **Fatigue is rolled per player as a flat draw**, so "starters wear down more
    than the end of the bench" is true only through the availability filter and
    not through playing time. If you want snap-weighted fatigue, the depth
    weights are already in hand; nothing has measured what it does to injury
    rates or to the rating spread.
12. **A restructure's wire entry quotes the amount requested, not the amount
    converted**, and those rows carry no player id so nothing links a
    restructure back to the man it happened to. A probe asking to convert
    $999,999,999 left *"Converted $1000.0M of base salary to bonus"* on the wire
    against a conversion of a few million.

---

## 10. Build the invariants and the soak test first

### 10.1 Why this is step one

A clean build and a passing typecheck prove the code compiles. **They say
nothing about whether a player can end up rostered with no contract, or a draft
pick can vanish.** Only running the league forward and checking its state catches
that class of bug, and that is exactly the class that produced this project's
most serious fixes: an inverted trade AI, a draft that broke past pick 32, a
`RESIGN` step that silently released everyone, a $360M contract preset, AI free
agency signing undrafted rookies.

Write the rules down in a document with stable ids, have the checker report
violations **by id**, and keep the two traceable to each other. **Any change
touching season flow, the draft, trades, free agency or contracts runs the soak
test before it is committed.**

Three kinds of rule, and each belongs in a different place:

- **Snapshot rules** — readable off a point-in-time read of one league. These go
  in the checker.
- **Arithmetic / write-path rules** — properties of a function or of a write,
  not of stored state. These get their own standalone harness, named in the
  document, each exiting non-zero on failure. A box score that does not add up
  is perfectly valid **state**.
- **Schema-enforced rules** — a foreign key or unique index makes the bad state
  **unwritable** rather than detectable. Do not check these at all; name the
  migration doing the work.

### 10.2 The rules

**Player status and roster membership**

- **INV-01** `status === 'ACTIVE'` ⇒ `teamId != null`.
- **INV-02** `FREE_AGENT` or `RETIRED` ⇒ `teamId == null`.
- **INV-03** `status` is always one of `ACTIVE | FREE_AGENT | RETIRED`. Injuries
  live on `injuryWeeks`/`injuryType` while status stays `ACTIVE`, and the
  rookie pool is `FREE_AGENT` + `isDraftee`. If any other value shows up,
  something wrote a status the rest of the code does not know how to handle.
- **INV-04** `ACTIVE` ⇒ exactly one contract row exists and its `teamId`
  matches the player's. Rostered without a contract means he draws no cap hit
  and cannot be cut, extended, or shown correctly anywhere.
- **INV-05** not `ACTIVE` ⇒ no contract row. A contract with nobody rostered to
  honour it is dead data at best, a phantom cap hit at worst.
- **INV-06** `isDraftee` ⇒ `teamId == null`.
- **INV-07** an `isDraftee` player is never more than **one** game-year behind
  the league's `seasonYear`. One year behind is expected (§2.2); older than that
  is a prospect nothing ever drafted, sitting in limbo.
- **INV-08** *(warning)* a club's active roster does not exceed
  `settings.rosterMax`. See open issue 4.
- **INV-20** *(warning)* outside the offseason window, no club's active roster
  falls below `rosterMinFor(settings.rosterMax)`. **Warning, and skipped during
  `OFFSEASON`/`RESIGN`**, because a legal short roster genuinely exists there:
  every expiring contract has been released and free agency has not opened. AI
  clubs refill at the first fill pass; a **user** club below the line is the
  user's own call and the game never signs on his behalf, so report it rather
  than acting.
- **INV-25** outside that same window, every club has at least one `ACTIVE`
  player at **every position its lineup actually fields** — every non-zero key of
  the starters table, kicker and punter included. INV-08 and INV-20 count a
  roster and **cannot see the shape of one**, and a roster of the right size with
  nobody at a position is exactly as unplayable as one nine men short. This
  codebase has lost the specialists more than once. Check against the starters
  table rather than a list written out in the document, so a position added to
  the lineup is covered the day it is added. **One man is the bar**, not the full
  starter count: a club with two of three receivers is thin, which is a football
  problem; a club with none is broken, which is this document's problem. Exempt
  `OFFSEASON`, `RESIGN` and `FANTASY_DRAFT` — the fantasy window is the extreme
  case, since a league that opens with one has **thirty-two empty rosters by
  construction** and fills them one pick at a time, so mid-draft this rule
  reported all 32 clubs missing all 16 positions: **a hundred per cent
  false-positive rate on a state the game creates deliberately.**

**Draft picks**

- **INV-09** / **INV-10** `used` ⇔ `playerId != null`.
- **INV-11** no two picks share `(leagueId, year, round, slot)`. Do **not** add
  `originalTeamId` to that key — it makes the rule strictly weaker than it
  reads, since two picks on the same slot with different origins would satisfy
  it. The original team is **provenance**, and two picks may absolutely share
  one; **no two may share a selection**, because the clock resolves with a
  first-match on `(round, slot)` (§5.5). Measured across 220 leagues and 177,408
  pick rows: the old key found **zero** violations and the corrected key finds
  **six** — all real, all in one save, no false positives.
- **INV-12** any pick from a year strictly before the league's `seasonYear` is
  `used`. Key it off the year, **not** off the draft-complete flag, which has no
  year of its own and stays stale-true long after the season it belonged to.
- **INV-29** a player taken with a pick from the **current** `seasonYear`, still
  `ACTIVE` on the club that drafted him, is on a rookie deal: the rookie flag
  set, `years === ROOKIE_DEAL_YEARS`, and an APY between the league minimum and
  the top-pick scale plus a quarter. The bug this is shaped around shipped: the
  fantasy branch handed out **1,696 players and wrote not one contract** —
  INV-04 caught *that* because those men were active with nothing on file, and
  it would **not** catch a contract written at the wrong **scale**, which is the
  other half of the same seam and the half a $360M preset came through. Only
  current-year picks and only men still on the drafting club: a rookie since cut,
  traded or extended is no longer on the deal the draft wrote.

**Contracts and cap**

- **INV-13** `0 <= yearsRemaining <= years`.
- **INV-14** every active contract's cap hit is `>= 0` under every cap mode.
  (This is exactly the class a bad restructure preset produced: a $3.6M offer
  read back as a $360M cap hit.)
- **INV-19** *(warning)* with the cap on, no club's committed cap exceeds that
  season's ceiling. Every acquisition path is gated, so a club over the ceiling
  means a path slipped the gate. **Warning**, because one legal shape reaches it
  with no rule broken: dead money already booked can exceed what a roster can
  shed — the same case the advance gate treats as unfixable. Measured on 31
  generated AI clubs at a season's close, **none** were over (median space
  $98.8M), so this is league-wide and only bites a club that got there
  deliberately.
- **INV-21** rewriting a contract **moves** money; it never creates or destroys
  any. Not a snapshot rule — it is a property of the arithmetic and of the write
  paths, and it needs **both** a pure harness and database harnesses, because
  half of what must hold is not arithmetic. Four clauses: a zero-dollar
  restructure is a no-op; total charged equals money paid; what this year frees
  the later years repay exactly (void years included, and a dying league year
  cannot absorb the lump for free); and the guarantee stays in the same frame as
  the bonus. **Part 3 owns the cap; build its harnesses there.** What matters
  here is that the season engine's own timing is implicated in the third clause
  — dead money is a one-year charge filed by the book year and swept at the
  roll, which is right for a club that had the room and catastrophic for one
  that did not (§2.8).
- **INV-23** every cap charge belongs to a club that still exists. **Structural,
  not checked** — a foreign key with cascade. It used to be a bare string with
  no key to anything, and deleting a league orphaned every dead-money row it
  held: **18,247 of 22,203 on the dev database, five of every six charges in
  it.** Deliberately not a per-league rule, because an orphan is by definition
  unreachable from any league. **Hang the cascade off the club, not off the
  contract or the player**: dead money is *meant* to outlive the deal that
  created it, so a cascade from either would delete the bill along with the
  reason for it.

**Championships**

- **INV-24** a title the save actually played names the men who won it, and a
  ring is read off that list rather than guessed at. **Structural** — see §5.4
  for the table, the uniqueness key that doubles as the idempotency key, and the
  measurement. **Do not make it a checker rule**, because of the population it
  would fire on: a title won before the table existed has no rows and never
  will, so a checker demanding a roster for every champion season would report a
  violation on every existing save, for a season that was played correctly. Ask
  for coverage **per club-year** instead.

**Numbers**

- **INV-26** no stored number is non-finite, negative where it cannot be, or
  outside its legal band: age 15..60, experience `>= 0`, overall and potential
  and every attribute value 0..99, `injuryWeeks >= 0`, last-season overall 0..99
  when set; contract years, signing bonus, guaranteed, void years and every base
  salary `>= 0` and finite; team wins, losses, ties, points for and against
  `>= 0`.

  **NaN and Infinity are the point, and they are harder to catch than they
  look.** An integer column rejects them at the driver so they cannot be stored
  directly — but every rating lives inside a JSON blob and every salary schedule
  inside another, and **JSON has no NaN:** stringifying it produces the string
  `"null"`. So a rating that went non-finite reaches the database as a **null
  inside an otherwise valid attribute map**, reads back as undefined, and turns
  every average computed from it into NaN **with nothing on disk looking wrong.**
  Apply the finiteness tests to the **parsed contents**, not to the columns.
- **INV-30** nothing points at a league, club or player that no longer exists.
  Check this **database-wide, not per league** — that is what an orphan is, and
  no league-scoped query can ever see one. That is exactly how those 18,247
  orphaned charges accumulated unnoticed while every other rule ran clean on
  every league in the database. Check the foreign-keyed columns too: a rule the
  schema enforces cannot be violated by application code, but it **can** be
  violated by a migration that ships without its constraint, by a hand edit, and
  by a bulk delete that reaches a table the cascade does not. Exclude the
  all-time record holders' player ids deliberately — **that is the one edge
  where a dangling id is correct**: a seeded backstory's record holders are
  legends who never played a down in the save and have no player row by design,
  the column is not nullable, and the name and club abbreviation are
  denormalised onto the row precisely so it still displays. Measured: 1,784 of
  2,994 such rows, an even fourteen per league, every league on the dev
  database, and a leak in none of them. **In a shared database the only reading
  that means anything is a difference** — take the count before and after the
  run and report only what this run's own leagues added.

**Games**

- **INV-15** a played game has non-negative scores and a box score that parses
  to a non-empty object.
- **INV-22** **a box score is an accounting document, and it balances.** Its own
  harness, building no league and touching no database. Six clauses, each an
  identity rather than a tuning target:

  1. Every yard thrown was caught by somebody — league receiving yards equal
     league passing yards.
  2. The team column is the player column added up — team pass yards equal the
     passers' yards on that side, **exactly, zero tolerance**, because it is now
     literally the same sum.
  3. The yards in the box score are the yards the drives gained.
  4. Every sack a defence recorded was taken by the other side's line.
  5. Every interception thrown was caught by somebody.
  6. Every touchdown pass was caught by somebody.

  **All six failed, and none of them was visible in one game.** Over 240 replayed
  league-seasons before the fix: receiving yards ran **8.5% ahead** of passing
  yards (the backs were handed `rng.int(0,40)` on top of the receivers' full
  share); the team pass-yard line missed the passer by **5%** (a flat 60/40
  split unrelated to anything the players did); and **19.6% of sacks, 4.7% of
  interceptions and 30.6% of touchdown passes reached no player at all** (dealt
  out by walking the roster flipping a coin with a hard cap of one apiece). A
  23-yard gap between what a passer threw and what his receivers caught reads as
  rounding on a Sunday. **It is only a defect in aggregate, and that is why a
  harness and not a rule.**

  Two clauses carry a deliberate tolerance and the harness must say why. Yardage
  is shared out by rounding each man's slice of a total, so a few yards a game go
  missing to rounding — **the counting stats have no such excuse and are held to
  exactly zero.** And the total-yards clause allows **four yards a team-game**
  against two known, separate warts left in place: the 120-yard floor (§4.3) and
  the overtime drive pushed into the list with 55 yards never added to the team's
  total (§3.5). Both show up as the worst single reading the harness prints.

**Season / phase flow**

- **INV-16** `phase` is one of the declared values.
- **INV-17** during `REGULAR`, `1 <= week <= settings.seasonLength`.
- **INV-18** if the draft is complete, `phase` is not `DRAFT` or
  `FANTASY_DRAFT` — the regression guard for the stuck-at-DRAFT bug. Check it
  **after** the harness calls advance once more to let the transition run; a
  completed draft still showing `DRAFT` right before that call is expected.
- **INV-27** for every season the save actually played, each club's stored
  season record satisfies `wins + losses + ties ===` the number of **played,
  regular-kind** games that club appears in for that year. That record is the
  only surviving copy of a finished season's standings, so a record that does
  not add up is a standings table that will be wrong forever. **Scope it to
  years at or after the league's start year**: every league is generated with a
  seeded backstory that writes real season records for years **before** the
  league opened and no game rows at all, and holding invented history to this
  rule would flag every league in the game on its very first step.
- **INV-28** for every season that was played **and finished** (one that has a
  champion row), there is exactly one champion row, exactly one row of each
  award type, and at least one All-Star row. **Both directions matter and the
  second is the more dangerous.** A season whose award pass threw, or whose field
  came back empty, leaves a year with no MVP and nothing anywhere saying so —
  the trophy screen simply has a gap and nobody notices until someone scrolls
  back six seasons. And the award pass has **no per-row guard**, so anything that
  runs it twice writes a second MVP for the same year and every count of a
  player's or a GM's honours silently doubles. A year with no champion at all is
  a season still being played, not a broken one — skip it. A year carrying the
  retired single-rookie award is a year played before the award was split in two
  — do not hold it to the two new types: **3,670** such rows sit in saves across
  189 leagues, and without that clause this rule reported **118 of 141** played
  league-seasons as missing both rookie trophies, a phantom bug measured and
  discarded.

**Transition rules** (checked by comparing state immediately before and after
one advance, not from a single read)

- **INV-T1** when a season's stats roll into career totals, the league-wide sum
  of every counting stat moves **entirely** from the season bucket into the
  career bucket — nothing lost, nothing double-counted. Snapshot it at the
  advance that carries `RESET_STANDINGS`, which under the grouped offseason is
  the **first** offseason advance, so take the snapshot at **week 1**. Left at
  week 2 this check would simply never fire again, because a league on this
  build goes 1 → 4 and never sits on 2.
- **INV-T2** every draft selection consumes exactly one pick owned by the club
  taking the turn, for the round on the clock — checked indirectly by INV-12,
  since if any round's trade were still being ignored, some pick from a finished
  draft would be left unused.

### 10.3 The soak harness

```
npm run sim:health -- [leagues] [seasons] [flags]
  6 10                  # 6 leagues, 10 seasons each
  6 10 --shard=0/3      # this process runs 1 of 3
  6 10 --out=run0.json  # dump the census as JSON
  --merge=./census      # print the combined report
```

Generate N leagues **across a settings matrix**, advance each M seasons deep, and
run the full invariant check **after every step**. Report every violation grouped
by rule. **Exit non-zero** if any error-severity violation was found **or** if any
league failed to finish, so it is CI-friendly.

**Support sharding**, because that is how a deep run finishes: one league-season
costs roughly ninety seconds of wall clock, almost all of it inside the game, so
a 6 × 10 run is about ninety minutes in one process and about thirty across
three. `--shard=i/n` takes every league whose index is `≡ i (mod n)`, so the n
processes together cover exactly the same set one process would, with the same
seeds and therefore the same leagues.

**Play on the rungs a player can actually choose.** Every league the harness used
to build was the default settings with one bit flipped, and **the cells nobody
visits are exactly where the bugs live** — the fantasy branch handed out 1,696
players and wrote not one contract, and INV-04 would have caught it on day one
had any harness league ever taken that branch. Six configurations, chosen to
cover every rung of every setting that **changes what the simulation does** at
least once rather than to enumerate a product nobody would pick:

| cell | settings |
|---|---|
| `default` | all defaults |
| `cap-off-easy-fantasy` | cap OFF, growth FLAT, EASY, fantasy start, 5 draft rounds |
| `simplified-hard-short` | cap SIMPLIFIED, growth FAST, HARD, 12-week season, 3 rounds, roster max 46 |
| `ironman` | the ironman league start, and **nothing else** |
| `no-injuries-no-retirement` | injuries off, retirement off, trades off, growth FLAT, HARD |
| `long-season-fantasy` | fantasy start, 20-week season, 7 rounds, cap REALISTIC, growth SLOW, EASY, progression speed 1.5 |

Across the six: all three cap modes, all three growth rungs, all three
difficulties, all three league starts, three season lengths, three draft-round
counts, the default roster ceiling and a smaller one (which moves the roster
**minimum** with it and therefore moves what INV-20 and INV-25 check against),
and injuries / retirement / trades each switched off in one cell — because "off"
is a code path too, and the retirement one governs the age curve the run is
measuring. **Take a league's configuration from its index**, so sharding splits a
run without splitting the coverage unevenly. Six cells rather than five
specifically so three shards each get two whole configurations.

**The ironman cell asks for nothing else on purpose.** That start applies its own
pins — fixed difficulty, no forced trades, a flat ceiling, realistic cap — over
whatever is asked for, so anything else this cell requested would be silently
overwritten, and **a matrix cell that lies about what it is testing is worse than
no cell.**

**Make the harness leagues headless: clear the user flag off all 32 clubs and
clear the league's user-team id.** The generator always flags one club as the
human's, and this harness's own header claimed for a long time that it left that
club to the AI "exactly like any other franchise". **That was never true.** Six
league-wide passes read that flag and deliberately skip it, every one for a good
reason:

| pass | what it skips for the user |
|---|---|
| AI re-sign wave | his expiring class walks in full, every year |
| AI free agency | he never signs anybody |
| roster-minimum fill | he is never brought back to a legal roster |
| final cuts | he is never cut to the limit — the **advance is blocked** instead |
| cap compliance | over the cap, the clock stops until he fixes it |
| the re-sign warning | stops the clock once a year to warn him |

So the harness's "user" club only ever **added** players (it drafts, because the
pick drainer is handed a sentinel id no club can match) and only ever **lost**
them — and between them those two halves were **every violation the run
reported.**

- **In a randomised league it bled out.** Its expiring class walked with nobody
  re-signing and nobody replacing them: **32 men against a 46-man minimum by the
  first free agency**, and it never came back. **108 INV-20 warnings** across the
  run, with exactly one club named on every single one.
- **In a fantasy league it jammed.** A fantasy draft fills every roster to
  exactly the ceiling, so this club came out on 53 and was still on 53 a year
  later — then seven rookie picks made it 60 against a 53-man limit. Cut-down
  day refuses to cut for a human, so the advance answered *"Can't advance — the
  ATL are carrying 60 players against a 53-man limit…"* for the remaining **56
  steps** of the budget: 56 INV-08 warnings, 56 INV-18 errors, the same one club
  read 56 times, and the stall.

**The fix is not for the harness to play GM.** Re-signing, free agency, roster
filling and cut-down day are four AI subsystems, and a harness that reimplements
them is checking its own policy against the game's. It is for the league to have
no human in it at all, which is what a headless league **is**. What that gives up
— offers addressed to the user, the coached-development bonus, and the three
human-gated blocks — **cannot move a player or a dollar without a human answering
it, so none of it can violate a rule**, whereas leaving one club of 32 unmanaged
corrupts the standings, the draft order and the cap sheet of every league built.

**Set a step budget and do not raise it to make the file pass.** Measured: a
randomised league spends **24 steps on its first season and 30 on each one
after** (54 for two seasons), and a fantasy league spends **29 on its first** and
30 after — the five extra are all at league creation and all real work, because
the pick drainer makes at most 500 picks per call and a fantasy draft is
`TEAM_COUNT × ROSTER_MAX = 1,696` of them, so it takes four passes
(500/500/500/196) plus the advance out of the phase. A rookie draft is 224 picks
and drains in one. **45 per season** is roughly a 50% margin over the worst start
type, and a league that runs out of it is **stuck, not slow.** That was worth
writing down, because raising the number was the tempting way to make a stall go
green and **it would have converted a dead league into a slow one.** The matrix
does not move it: a 20-week season is 33 steps rather than 30, still a third
clear. **A cell that needed the budget raised would be a cell whose season does
not end**, which is the thing the number exists to catch.

**Treat the answer `advanceWeek` gives back as part of the test.** The harness
used to discard it, and a refusal thrown away is **indistinguishable from a week
that happened** — which is how a league being told "Can't advance" on 56
consecutive steps reported nothing except a step budget quietly running out.
Count consecutive refusals and call it **stuck after two**: a refusal can
legitimately happen once and then proceed (the re-sign warning is exactly that
shape, and clears itself), but two in a row with nothing in between to answer
them is a league that will never move. That threshold is **diagnostic, not a
budget** — the run fails either way; it only decides whether the failure is named
on step 30 or on step 90, and a stall named where it happens is worth 60 steps of
nothing. **Since every block in the game is gated on a human and the harness has
removed the human, nothing here should ever refuse.** If something does, it is
either a new block or a bug, and the run says which and stops.

**Name the stall in a sentence somebody can act on.** It used to read, in full,
*"At least one league did not reach the target season count within its step
budget"* — naming neither the league, nor its start type, nor the phase, nor the
week, nor, when the answer was a draft, which pick the clock was sitting on.
**Finding that out cost a whole session.** Report the league index and its
configuration name, the phase/year/week, and for a draft: round, pick N of
total, the complete and started flags, and **the club on the clock resolved
through the same function the draft itself uses** — including "nobody", which is
itself the answer on a draft whose `(round, slot)` has no pick row.

Distinguish two failure sentences: a refusal loop, and "spent the whole budget
and reached K of N seasons — **it was still moving, just not fast enough**".
Those are different problems.

**Clean up in a `finally`, by id, never by name.** Capture created league ids
through a creation callback rather than the return value, so a league that throws
**part way through generation** is still cleaned up. Delete by id because the
database is shared — two runs at once both build a league called "SimHealth 0",
and deleting by name prefix would have each run tearing down the other's league
mid-simulation. Use a delete-many rather than a delete, because a missing row is
the normal case for a half-built league rather than a second failure to report on
top of the first.

### 10.4 The census — what a clean run still has to be looked at for

**An invariant answers yes or no. Most of what goes wrong with a simulation over
ten seasons answers neither: the league does not break, it drifts** — every
rating creeps up, or every trophy goes to the same position, or the average age
walks off a cliff because retirement and the draft class are not in balance.
Nothing is violated and the game is still wrong.

So count things too. Nothing here fails a build; print it so a human can see the
shape and say whether it is football.

Per season per league: the **starter** overall mean and sd and count, active age
mean and sd, retired total, free agents, active players. Across the run: every
trophy by position.

**Sample blind.** Compute every number from a read of an **entire** league and
narrow it in memory. **Not one of them may be "order by rating desc, take N"**,
which answers a question about the top of a distribution and then gets quoted as
a fact about the distribution.

**Define a starter as the best man his club has at his position, as many of him
as the lineup fields** — resolved per club and per position, in memory, from
every active player. That is a different question from "the best players in the
league", **and the difference is the whole point: the league's ninety-ninth
percentile can hold steady while every club's third receiver rots, and only one
of those two numbers would notice.**

Take the census **once a season, standing in the regular season at week 1**,
where every roster has been filled, cut to the limit and settled. Taking it in
the offseason would measure a league mid-teardown.

**Read trophies off the news row's own headline**, which is written as
`"${name} (${position})"` and which every reader in the app already parses the
same way. Joining back to the player's current position answers a different
question: a man who won it at receiver and has since been listed elsewhere would
be counted at the position he holds **today**, not the one he won it at.

### 10.5 Canaries — prove the harness measures anything at all

**A probe in this repo once read `l.stats.receptions`, where the field is called
`rec`, and reported 28,534 samples of 0.0000. It ran, it printed a number, it was
believed, and it was measuring nothing.** Every number the harness prints has the
same failure mode available to it.

So open the run by proving three things about itself, and **refuse to run if any
of them comes out wrong**:

- **A** an assertion at a claim known to be **false** must fail;
- **B** a read of a deliberately **misspelled** field must come back undefined;
- **C** a read that is real must pass.

Run these against a throwaway in-memory shape rather than the database, on
purpose: they are checking that the **assertion machinery** is wired up, and **a
canary that needs a working database to fail is a canary that goes quiet exactly
when the database is the problem.**

Compute the verdict from **the same three values that were printed**, not by a
second function repeating the same three tests — that shape goes wrong exactly
once, silently, when somebody edits one copy. **A canary whose printed result and
whose gate can disagree is not a canary.**

### 10.6 Verification bar

Hold the build to this before calling the season engine done:

1. `sim:health` across the full six-cell matrix, at least 6 leagues × 10
   seasons, **0 error-severity violations and 0 stalls.**
2. The box-score harness clean, with the counting-stat clauses at **exactly
   zero** and the two tolerated clauses printing their worst reading.
3. A census a human has read: starter overall mean and sd not drifting season
   over season (the historical failure was 65 → 81 over 13 seasons), active age
   mean stable, free-agent pool not growing without bound.
4. The award-by-position table printed and compared against §6.6's figures.
5. A replay check: the same seed twice produces **bit-identical** scores across
   a full season. If it does not, something is iterating an unordered read
   (§7.6, step 1).

**And remember that the verification tooling needs the same scrutiny as the
systems it checks.** Two of these rules shipped as false positives in the checker
itself — both compared a stored year against the league's **current** season year
directly, which is wrong for anything whose year field is set *before* the
game-year in which it is resolved (a class's draft year, a pick's year), because
the season-year bump runs well before that cycle's own draft phase. For a long
stretch of every season both checks flagged the current, not-yet-processed cycle
as if it were stale leftover data.
