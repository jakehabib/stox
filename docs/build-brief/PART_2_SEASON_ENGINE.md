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
particular form is a flat per-player roll; see §11 for the honest note on it.

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
