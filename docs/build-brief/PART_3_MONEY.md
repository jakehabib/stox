# PART 3 — MONEY: BUILD THE CAP, CONTRACTS, FREE AGENCY, NEGOTIATION AND TRADES

Build this system before you build the screens that read it, and build the
invariant suite in §8 before you build this system. Every money defect in the
reference implementation was silent, enforced and permanent: a wrong cap figure
is a number nobody can check, printed beside a number derived a second way,
backing a gate that refuses moves the screen said were legal — and it corrupts
a save somebody has put twenty seasons into.

Read §0 first. Those are the arithmetic shapes you will reach for unless you
know not to.

---

## 0. Do not reintroduce these seven bugs

All seven shipped in the reference implementation and were found by measurement,
not review. Treat each as a test case you must be able to pass on day one.

**1. Never subtract a flat year of proration from a cap hit that may not
contain one.** `tradeCapEffect` did, to find the base salary an acquiring club
inherits. Inside the five-year bonus window that is the same statement; past it
it is not. Measured on a 7-year deal in its 7th season with $15.7M of bonus:
the acquiring club's cap actually moved **$7.90M** while the function told the
cap gate, the trade screen and the AI's refusal it was taking on **$4.76M**. On
a $27.9M bonus the same shape reported **minus $80K** — acquiring a $5.50M
contract read as *freeing* money. The same function backs the cap gate, so this
was not merely drawn wrong, it was **enforced**: a club with $4M of room could
be handed a $7.9M contract and land over the ceiling with nothing refusing it.
Derive "bonus charged this season" exactly once (§2.6) and have both callers
read it.

**2. Never let a mutation delete a contract row without accounting for the
bonus still prorating on it.** The franchise tag did. A 3yr+2-void deal fully
played, $12.0M bonus ($2.40M/yr over five): tagging at $17.1M moved committed
cap **$5.70M** where it should have moved **$10.5M**, and $4.80M was never
charged to anybody, ever. On a 5yr deal two years in with a $25.0M bonus,
tagging a $25.0M cap hit at $11.5M did not cost $1.50M — it **freed $13.5M**.
The tag became the cheapest way in the game to make a bad contract disappear,
which is the exact opposite of what a tag is.

**3. Make every exit from a contract charge the same stranded void money.** The
re-sign was the one that did not. Four exits from the same expired 3yr+2-void
deal, $13.5M bonus, three seasons played: walk **$5.40M**, cut **$5.40M**, tag
**$5.40M**, **re-sign $0**. That opens a loop: restructure a walk year with
three void years added (hit $28.2M → $7.79M, $20.4M freed this season), then
re-sign the man and nobody ever repays the $20.4M. Keeping a player became
strictly cheaper than losing him.

**4. Date every cap charge by the book year, never by the clock.** Dead money
filed under the season that was ending sat in a window where compliance is
deliberately not enforced, then got hard-deleted before anyone paid it. Cutting
a player cost full price in PRESEASON week 1 and **exactly nothing** in
OFFSEASON week 1 — a timing trick, not a decision, invisible in the UI. The
mirror-image error, from reading an un-aged contract: a release at OFFSEASON
wk1 booked **$13.32M** where the identical cut two steps later booked
**$8.88M**. §9 is the whole rule.

**5. An extension must be able to lower this season's cap hit.** Appending
years and a new bonus on top of untouched base salaries can only make this
season dearer. Measured over 400 real contracts (78+ ovr), +3 years at market
with 40% bonus: current-year hit went **UP on 387, DOWN on 13**, median
**+$1.58M**. A tester: *"he extended one of his players, and it actually
increased the player's cap hit in the current season, whereas in many
instances, it should actually lower the cap hit."* The missing half is
converting owed base salary into bonus (§4.3).

**6. Dead money is the unamortised bonus PLUS the guaranteed base still
owed.** Shipping only the bonus made the guarantee slider move a figure the
club was never held to, and it was wrong in both directions. Measured on a 93
free agent, four years at market: at a 100% guarantee the club walked away from
**$16.6M** it had told the player was locked in; at 0% the panel said nothing
was guaranteed while **$4.6M** still bound, because the deal shape pays a 12%
signing bonus even at a zero guarantee. Separately, never spell "bonus not yet
charged" as `proration × yearsRemaining` — on a 3+2-void deal one year in that
carries 2 years where 4 are owed and writes off money that would still
accelerate.

**7. Never convert a season's whole salary into bonus without a control on
screen.** A walk-year re-sign routes through the append path, and the
negotiated default converts **all** convertible base. The extension screen had
the slider; the re-sign screen did not, so the GM moved a whole season's salary
into a bonus — and therefore into dead money on any future cut — unasked and
untold. And do not hand that instrument to an AI budgeter that prices year one
only: doing so took "club over the cap" violations from **12 hits/124 rows to
50/251** and "roster under minimum" from **22/66 to 74/218** across three
simulated seasons on identical seeds.

Two more, documented where they belong: the restructure that re-charged an
already-billed bonus (§4.5 — a **zero-dollar** restructure raised the cap hit
from $15.0M to $18.3M) and the meter/server gate that disagreed by **$7.2M**
(§5.7).

---

## 1. THE ONE RULE — obey it everywhere in this part

> **If two places need the same figure, extract one function. Both read it.**

This is not style advice. Every bug above except #4 is one number derived
twice. The reference implementation shipped a meter and a server gate
disagreeing by $7.2M; a trade screen's "space after" that was not the figure
the gate enforced; a cap page labelling next year's sheet with this year's
date; an interest meter whose tick marks were four literals in one file and a
copy of the threshold in another; and a stranded-void-year figure with **five
different spellings**, two as `bonus − proration × years`, one as
`proration × (window − years)` — agreeing to within a rounding dollar, with
nothing keeping them agreeing tomorrow.

Export each of these once. Make every caller — server action, browser panel, AI
wave, invariant script, probe — read the export:

| the figure | the single function |
|---|---|
| this year's cap hit | `capHit(contract, mode)` |
| bonus charged *this* season | `prorationThisYear(contract, mode)` |
| seasons the bonus amortises over | `prorationYears(contract)` |
| bonus paid but not yet charged | `unamortizedBonus(contract, mode)` |
| guaranteed base still owed | `guaranteedSalaryOwed(contract, mode)` |
| what a release costs | `deadMoneyOnCut(contract, mode)` |
| bonus a void year stranded | `strandedVoidBonus(contract)` |
| what a trade does to both sheets | `tradeCapEffect(contract, mode)` |
| what a restructure produces | `restructureContract(c, amount, opts)` |
| what an extension produces | `buildExtension(opts)` |
| convertible base salary | `convertibleBase(contract)` |
| which league year a charge belongs to | `capChargeYear({phase, week, seasonYear})` |
| a position's salary-band average | `positionSalaryBand(salaries, from, to)` |
| what a free agent will take today | `askingPrice(opts)` |
| will he sign this | `decideOffer(ctx, offer, gate, structure)` |
| the least he will sign for | `leastAcceptableApy(ctx, years, gtd)` |
| rounding slack on any cap comparison | `CAP_GATE_TOLERANCE` = **1 dollar** |

Put the pure arithmetic in a module importable by **both** browser and server:
the negotiation panel runs the full decision on every slider drag and the
Server Action runs the identical function on submit. That module must not
import the database client. Put the gate that needs a live cap sheet in a
separate server-only module. Do not put shared cap arithmetic in a
client-marked module — in the reference implementation that produced a 500 on
the player page the moment the panel had a man to price, because every export
of a client module reaches a Server Component as a client *reference*, not as
the function, and neither the type-checker nor the production build catches it
(every league page is force-dynamic, so nothing renders at build time).

Set `CAP_GATE_TOLERANCE` to one dollar and share it between the writing gate
and the drawing gate. Proration and salary escalation both round, so the two
sides can legitimately land a dollar apart on the same contract; a private copy
in each is a second definition of the rule waiting to drift.

---

## 2. The salary cap

### 2.1 Implement three cap modes, and never enforce past the user's setting

`CapMode = 'REALISTIC' | 'SIMPLIFIED' | 'OFF'`. Make it a league setting.

- **REALISTIC** — base salary plus prorated signing bonus. Cuts leave dead
  money. Full transaction enforcement, plus the advance-compliance block.
- **SIMPLIFIED** — a flat APY every year (`(sum of base salaries + signing
  bonus) / years`), no proration, no dead money, cuts always clear the whole
  hit. Still enforce transactions: a flat-APY cap is still a cap.
- **OFF** — every cap function returns 0 and every gate is a no-op. Return
  immediately from the gate when the mode is OFF. The user switched the rule
  off; nothing may override that.

One exception to "OFF returns 0", and get it right or the CPU teams stop
signing anybody: make `capSpace` in OFF mode **positive infinity**, not 0. The
AI's offer sizing budgets against it. Because `formatMoney(Infinity)` prints
`$InfinityM`, carry a `capEnabled` boolean on the summary and make every screen
branch on that flag before rendering any figure from it.

Restructuring applies in REALISTIC only — with a flat-APY cap there is no
proration to reshape. Refuse it in the other two modes with that sentence.

### 2.2 The ceiling, and the growth rungs

```
capForYear(seasonYear, leagueStartYear, growthPerYear)
  = round(BASE_CAP * (1 + growthPerYear) ^ max(0, seasonYear - leagueStartYear))
```

`BASE_CAP = 255_000_000`. The second argument is the **founding** season, not
the current one. (The reference implementation passed the season, making
`elapsed` always 0 and pinning every league at `BASE_CAP` for its whole life —
the growth constant was dead code.)

Make growth a per-league setting with three rungs:

| rung | rate | what it means |
|---|---|---|
| FLAT | 0 | the ceiling never moves; no regretted contract ever inflates off the books |
| SLOW (default) | **0.01** | drifts up the way a television deal does |
| FAST | 0.07 | a boom league; the ceiling nearly doubles inside a decade |

Have the SLOW rung *be* the tuning constant rather than a second copy of it, so
the fallback curve and the rung a player picks cannot drift apart.

The default walked down 7% → 2% → 1.5% → 1% for one reason, and it is the
reason to keep it at 1%: compounded, growth is not drift, it is a different
game. `1.07^10 = 1.97`, so season eleven plays under nearly double the opening
ceiling while the market-value curve still answers in year-one dollars.
Measured over 20 league years against 32 generated clubs priced at market, 7%
leaves a median club at **24%** of its own ceiling by year 20 and 1% leaves it
at **73%** — still a squeeze, still a choice. The year a full roster at market
can *also* afford the best quarterback in football — the year keeping everyone
good stops being a choice — arrives in season 3 at 7%, season 8 at 2%, season
10 at 1.5% and season 14 at 1%. Only the last is past where a dynasty usually
runs.

Resolve the founding year and the rate **together**, through one server
function that reads the League row, and make every ceiling in the game come
from it. Do not let call sites reach the raw curve with two arguments: that
means "the default rung's curve" and is a wrong reading of any league not on
that rung. In the reference implementation six call sites still did, and a FLAT
league read $265.3M on the gate while its own cap page read $255.0M.

Derive the founding year for saves that predate the column, in this order, and
persist it once: (1) the stored `startYear`; (2) `MIN(Game.seasonYear)`; (3)
`MIN(Transaction.seasonYear)`; (4) `MIN(TeamSeasonRecord.year)`; (5)
`League.seasonYear`. Prefer games over transactions if you seed fictional
franchise backstory, because backstory writes historical records and award
transactions dated decades early — the reference implementation seeded up to 24
years of it and would have compounded every ceiling over phantom seasons. Never
derive it from `MIN(Contract.signedYear)` (league generation backdates
contracts by up to `years − 1` to stagger expiries, so it reads up to four
years early) or from `MIN(DraftPick.year)` (generation seeds picks at
`seasonYear + 1..3`, so it reads a year late).

Rejected, and do not revisit: reading the rate from request-scoped async
context so no call site changes (the arithmetic module is imported by client
components and `node:async_hooks` cannot go in a browser bundle); a
module-global "rate of the league resolved last" (correct only where the
resolve and the call share one uninterrupted continuation, and the cap page
hoists the start year above a dozen awaits); folding the rate into the founding
year (arithmetically impossible — no start year makes a compounding curve
flat).

### 2.3 Compute cap space in exactly one place

```
activeSalary = Σ capHit(contract, mode) over ACTIVE players on the roster
deadMoney    = Σ CapCharge.amount where teamId = club AND year = bookYear
capUsed      = activeSalary + deadMoney
capSpace     = capTotal − capUsed          (OFF: +Infinity)
```

Return `{ capTotal, activeSalary, deadMoney, capUsed, capSpace, rosterSize,
capEnabled, capYear }` from one async function and make the cap page, the
compliance gate, the negotiation gate, the AI's budgeting, the trade evaluation
and the invariant scripts all call it. `capYear` is the **book year** the other
figures are measured in (§9) and is the only year any caller may print beside
them; the reference implementation had the cap page label these figures from
its own read of `League.seasonYear`, which is a second derivation of a year
this function had already decided.

A player with no contract row charges nothing. Carry `null` rather than 0 for
him in any row shape that feeds a sum: `null` means "no deal on file", 0 is a
claim about a deal.

### 2.4 The roster floor and the roster ceiling

`ROSTER_MAX = 53`, `ROSTER_MIN = 46`, `DRAFT_ROUNDS = 7`,
`TEAM_COUNT = 32`. No practice squad.

Make the maximum a league setting, and scale the minimum with it:

```
rosterMinFor(rosterMax) = clamp(round(rosterMax * 46 / 53), 1, min(46, rosterMax))
```

Do not hard-code 46 anywhere downstream. A league configured with a 40-man
limit must not be told its minimum is 46, or every keep-or-cut screen reads
"short of the minimum" permanently.

Reserve `MIN_SALARY` per open slot below the floor in every AI budget, so a
club cannot spend itself out of a legal roster. When projecting future cap
years, print the open slots and what they cost at the league minimum beside the
room: measured across 6,976 clubs, a club carries a median of 44 men under
contract this year, 30 next, 18 the year after and 8 in the fourth — so a raw
"$180M of room in 2043" is a lie by omission. It is room to sign 38 men with,
not money spare. Do not attempt an estimate of what those men will really cost;
that number does not exist in the game and inventing it is the lying metric
wearing a helpful face.

### 2.5 What being over the cap actually blocks

Route **every** player-initiated transaction that adds current-season money
through one gate: sign, re-sign, extend, restructure, franchise tag, rookie
deal out of the draft, trade. The gate takes a verb for the message, the season
year, the cap mode and a list of per-team charges, and throws a structured
error.

Gate rules, in order, and each one earned:

1. **Return immediately in OFF mode.**
2. **Fold repeated entries for the same team into one net position.** A trade
   can move several players in both directions.
3. **State each charge as a DIFFERENCE, never as a gross hit with a credit
   alongside it.** The gate's first act is `if (delta <= 0) continue` — the
   escape for a move that frees room or is neutral. A delta stated as a whole
   new cap hit can never be ≤ 0, so the escape is unreachable and a club
   already over the ceiling is refused moves that make it *less* over.
   Measured: a club at −$10.0M extending a man from a $20.0M hit down to
   $12.0M was refused, because the gate asked whether $12.0M fitted inside
   $10.0M rather than whether −$8.0M did. The same defect in the browser gate:
   on 20 clubs put $12.0M over, **3,803 of 3,990** offers that lower or hold
   the club's commitment were blocked. That is a user report verbatim —
   *"trying to extend someone and it not allowing it. Even tho the game says it
   will reduce his cap hit."*
4. **Check every team the move touches.** A trade can be comfortably legal for
   the side shedding salary and illegal for the side taking it on.
5. **Allow `CAP_GATE_TOLERANCE` of slack** on the comparison.
6. **Name the shortfall and the way out.** Throw an error carrying, per club,
   the dollars added, the dollars available and the shortfall — plus up to
   three concrete relief moves. Build the relief list from the same
   cut-savings and restructure-relief arithmetic the rest of the game uses, and
   **interleave cuts and restructures** so the list is not three variations of
   one idea: a restructure keeps the player, a cut does not, and the GM wants
   both shapes. When nothing on the roster clears enough alone, say so: "a
   trade that sends salary out is the way back."

Separately, block the **advance** for a user club over the cap, and keep that
block deliberately narrow:

- REALISTIC only (SIMPLIFIED has no dead money, so a club can always cut
  straight back under; OFF means the rule is off).
- The user's club only — AI clubs are enforced at transaction time, and halting
  the user's clock over a CPU club's books is unfixable.
- Only while a way out still exists. If cutting every player who frees anything
  still leaves the club over (dead money alone can exceed the ceiling),
  advance anyway and carry the standing warning, or you soft-lock the save.
- Not during the offseason roll phases (§9.3).

That escape was, for a while, the most profitable move in the game: going
*further* over the cap switched the gate off, and every charge was swept at the
roll. Measured — $50.8M over, blocked; ten releases later at **$844.0M** over
with max cut relief of $53.3M, the identical call ran the week and the club
carried nothing into the new year. Keep the escape, because a user must never
be soft-locked, and close the hole with the overage carry in §9.4: the player
may stand still, but not for free.

Make the compliance report, the standing over-cap banner and the advance block
all read one function, so all three promise the same thing. Compute the
escape path and the total cut relief over the **whole** roster, not over the
truncated suggestion list — they decide whether the block is escapable at all.
And when no combination of cuts clears the shortfall, return an **empty** path
rather than the whole roster: the reference implementation handed back a route
that does not arrive, and callers presented it as one, telling a permanently
stuck user to make a cut that cannot fix anything.

### 2.6 The proration window — the rule that makes most of this work

```
prorationYears(c) = max(1, min(c.years − optionYears(c) + (c.voidYears ?? 0), 5))
proration(c)      = round(c.signingBonus / prorationYears(c))
yearIndex(c)      = max(0, c.years − c.yearsRemaining)       // 0 = year signed
```

`MAX_PRORATION_YEARS = 5`: a bonus amortises over at most five seasons from
signing, whatever the length of the deal.

**State and obey the rule that proration only applies while the bonus is still
amortising.**

```
prorationThisYear(c, mode) =
  mode !== 'REALISTIC' ? 0
  : yearIndex(c) < prorationYears(c) ? proration(c) : 0
```

```
capHit(c, 'REALISTIC')  = base[yearIndex] + prorationThisYear(c, 'REALISTIC')
capHit(c, 'SIMPLIFIED') = round((Σ base + signingBonus) / max(1, years))
capHit(c, 'OFF')        = 0
```

Years six onward of a long deal are **pure base salary**, which is also why a
long deal gets cheap to escape near the end. While no deal could exceed five
years, "divide by at most five" and "add that to every year" were the same
statement and nothing surfaced the difference. They stopped being the same
statement when the term ceiling went to twelve years: a seven-year deal was
charging its bonus seven times over — on the worked example **$58.8M** of cap
charges against a **$42.0M** bonus, with dead money to match. A 4+3-void deal
had the same hole.

Have `unamortizedBonus` count remaining *window* years, never remaining
contract years:

```
unamortizedBonus(c, mode) = mode !== 'REALISTIC' ? 0
  : proration(c) * max(0, prorationYears(c) − yearIndex(c))
```

Fall back to the last base salary (then to `MIN_SALARY`) when the stored array
is short, in `capHit`, in the schedule builder and in the extension builder
alike. A well-formed row has one base salary per year and the fallback does
nothing; a row that has lost an entry must not silently shorten a deal or
render a schedule shorter than the "3 of 5 years remaining" printed above it.

### 2.7 Void years: clamp the request, and clamp the control

```
usableVoidYears(years, requested) = clamp(round(requested), 0, max(0, 5 − max(1, round(years))))
```

Void years work only by widening the proration divisor, and that divisor stops
at five. A five-year deal already amortises over five, so a void year on it
changes nothing — not the cap hit, not the dead money. That is the real rule
and it is why real front offices hang void years off **short** deals.

Clamp in the contract builders, and give the slider the same ceiling so the
user is never offered inert travel. Unclamped, this is the bug a tester hit as
*"void years aren't altering cap hits"* — the slider ran 0–3 on every deal and
produced, on a $20.00M year-1 hit:

```
3yr:  +0 $20.00M   +1 $18.00M   +2 $16.80M   +3 $16.80M
4yr:  +0 $20.00M   +1 $18.40M   +2 $18.40M   +3 $18.40M
5yr:  +0 $20.00M   +1 $20.00M   +2 $20.00M   +3 $20.00M   <- all inert
```

The control moved, the ledger did not, and the contract card went on printing
"+3 void years" over a deal where they bought precisely nothing.

---

## 3. Contracts

### 3.1 Store exactly these fields, one row per player

| field | type | meaning |
|---|---|---|
| `playerId` | unique | one live contract per player |
| `teamId` | nullable | the club carrying it |
| `years` | int | full original length |
| `yearsRemaining` | int | seasons still owed, **including the one being played** |
| `signedYear` | int | league year the current shape was written |
| `baseSalaries` | JSON `number[]` | per-year base, **index 0 = the year signed** |
| `signingBonus` | int | amortised over `min(years + voidYears, 5)` |
| `guaranteed` | int | **bonus-inclusive** share of total value |
| `isRookieDeal` | bool | drives rookie-scale and option rules |
| `isFranchiseTag` | bool | one tag per club per league year |
| `fifthYearOption` | string? | `'EXERCISED'` / `'DECLINED'` / null |
| `voidYears` | int | cap-only trailing years |

Index `baseSalaries` **from signing**, never from "now", and read the current
year back out of it with `yearIndex`. The array must always hold the full
original schedule, because `capHit` reads elapsed-seasons-so-far out of it. A
builder that returns only the remaining years, called on a partway-elapsed
contract without slicing, hands back already-elapsed past years glued onto the
front of "the remaining schedule."

Make `null` on `fifthYearOption` load-bearing in two directions: it is the
state of a save written before the column existed *and* the state of an open
decision, and those must read the same way, so an existing four-year rookie
deal keeps exactly the deal it has.

### 3.2 Build a contract like this

```
buildContract({ apy, years, signedYear, bonusPct = 0.28, guaranteedPct = 0.45,
                escalation = 1.12, voidYears = 0, isRookieDeal = false }):

  years         = max(1, round(years))
  total         = max(round(apy * years), MIN_SALARY * years)
  nominalBonus  = round(total * bonusPct)
  baseTotal     = total − nominalBonus
  weights[i]    = escalation ^ i            for i in 0..years-1
  baseSalaries  = weights.map(w => max(MIN_SALARY,
                     round(baseTotal * w / Σweights / 100_000) * 100_000))
  signingBonus  = max(0, nominalBonus − (Σ baseSalaries − baseTotal))
  guaranteed    = max(signingBonus, round((Σ baseSalaries + signingBonus) * guaranteedPct))
  voidYears     = usableVoidYears(years, voidYears)
  yearsRemaining = years
```

`MIN_SALARY = 1_000_000`. Escalate base salary ~12% a year so a fresh signing
is cap-friendly in year one; pass `escalation ≈ 1.0` (flat) for contracts you
will immediately age into a random later year at league generation, or
staggering lands players in the single most expensive year of a back-loaded
deal with none of the cheap early years ever having applied, wildly inflating
that club's cap hit.

Decide the minimum-salary floor **once, on the total**, as above — and take
whatever the floor and the $100K rounding added to the base schedule back *out
of the signing bonus*. The reference implementation floored the base salaries
while computing the bonus off the un-floored nominal total, so every
league-minimum deal quietly cost 28–39% more than the APY it was written for:
`{apy: $1.00M, years: 3}` produced a **$1.28M** year-1 cap hit, and
`{apy: $0.90M, years: 4}` produced **$5.01M** of contract against a **$3.60M**
nominal. Every budget priced off `apy` — the re-sign reserve most of all — was
short by exactly that much. At a true league-minimum deal the correction drives
the bonus to 0, which is what a minimum contract looks like anyway.

Take `voidYears` as a **parameter of the builder**, not something each caller
splices on afterwards. Its absence was a bug, not a missing convenience: every
caller that wanted void years had to remember to re-attach the field before
pricing, and the re-sign path wrote `voidYears` to the database while gating
the signing on a cap hit computed without them — so the game demanded $20.00M
of room for a deal that would only ever cost $18.40M and refused re-signs it
should have allowed.

### 3.3 Keep the guarantee in the same frame as the bonus

`guaranteed` is a share of the deal's **total** value with the signing bonus
**inside** it, never on top. Therefore:

```
guaranteedMoney(c)        = max(c.guaranteed, c.signingBonus)
guaranteedBase            = guaranteedMoney(c) − c.signingBonus
guaranteedBaseByYear(c)   = fill guaranteedBase across baseSchedule(c), EARLIEST YEAR FIRST
guaranteedSalaryOwed(c)   = Σ guaranteedBaseByYear(c) from yearIndex(c) onward   (REALISTIC only)
```

Floor `guaranteedMoney` at the bonus. The bonus is guaranteed by having been
paid, and legacy rows can carry a `guaranteed` below it; without the floor a
0%-guarantee offer stored `guaranteed: 0` over a contract that still handed the
player a signing bonus, and the card printed "$0 guaranteed" over money the
club could not get back.

Fill **earliest year first**, because that is how guarantees are written and
consumed: a man three years into a four-year deal has already collected the
guaranteed part of years one to three, so nothing about those years binds the
club any more. Carrying the whole figure to the end of the deal instead would
make a veteran on an old contract permanently untradeable and uncuttable, which
is the opposite of how a deal ages.

Count the year the club is **in** as still owed. The cap charges that season
whole, so a release during it must answer for the whole of it, or cutting a man
in December would quietly cost less than cutting him in August.

The frame rule, and break it and you invent money: whenever you write a rebased
or reduced `signingBonus`, restate `guaranteed` **in the same write**. Every
reader finds the guaranteed base by subtracting the bonus back out, so pairing
a rebased bonus with an old guarantee makes the gap between them re-read as
salary still owed — which lands on the cap as dead money. Measured on one
restructure: stored $45.0M against a computed $28.7M, and dead-money-on-cut
went from **$28.7M to $45.0M** — $16.3M invented out of an accounting move.
(In the reference implementation the pure function computed the right figure
the whole time and the write simply dropped it, with a *second* write outside
the transaction patching it back. That made the defect latent rather than
fixed: any other caller reintroduced it in full, and a failure between the two
writes left a row broken in exactly this way with nothing to say so. One write,
one transaction, one row that is never briefly wrong.)

### 3.4 Per-year cap-hit schedule

```
capHitSchedule(c, mode):
  startIdx = yearIndex(c)
  bases[i] = all[startIdx + i] ?? all[last] ?? MIN_SALARY   for i in 0..yearsRemaining-1
  OFF        -> bases.map(() => 0)
  SIMPLIFIED -> flat = round((Σ all + signingBonus) / max(1, years)); bases.map(() => flat)
  REALISTIC  -> bases.map((b, i) => b + (startIdx + i < prorationYears(c) ? proration(c) : 0))
```

Emit exactly one row per remaining year, always.

Handle the expiring man explicitly wherever you project future years. A
contract at `yearsRemaining === 0` returns an **empty** schedule, but `capHit`
still charges him (the last base salary plus any proration still inside the
window), the cap summary sums `capHit`, and the gate runs on the summary. He is
on the roster and on the books until the re-sign window closes. Every contract
in the league sits at zero remaining through the whole offseason roll, because
the ledger ages the instant the season ends. Measured on a league driven to
OFFSEASON week 1: a multi-year chart that summed the schedule read **$117.2M**
of committed cap where the gate read **$202.6M** — hiding **$85.4M**, 42% of
the club's real commitment, in the one window where a GM is actually making
cuts. So pin column zero to `capHit` and give a man at zero remaining a
one-column schedule. Do not drop him from the sheet to make the panel match a
chart that was wrong.

```
remainingValue(c, mode) = Σ base[yearIndex..] + (REALISTIC ? proration(c) * max(0, prorationYears(c) − yearIndex(c)) : 0)
capSavingsOnCut(c, mode) = capHit(c, mode) − deadMoneyOnCut(c, mode)
```

### 3.5 Rookie scale by pick

```
rookieScaleApy(overallPick, totalPicks):
  t   = clamp((overallPick − 1) / max(1, totalPicks − 1), 0, 1)
  apy = R1_PICK1 * (R7_LAST / R1_PICK1) ^ (t ^ SHAPE)
  return max(MIN_SALARY, round(apy / 50_000) * 50_000)
```

`ROOKIE_SCALE_R1_PICK1 = 9_500_000`, `ROOKIE_SCALE_R7_LAST = 1_050_000`,
`ROOKIE_SCALE_SHAPE = 0.40`, `totalPicks = TEAM_COUNT × 7 = 224`.

Bend the middle with the exponent; do not use a flat exponential. A flat
exponential got both ends right and the middle badly wrong, and both anchors
are fixed points of the exponent so pick 1.01 and the last pick are unmoved by
construction. Swept against the real 2024 scale:

| shape | #1 | #16 | #32 | #64 | #224 | class picking 16th | league pool |
|---|---|---|---|---|---|---|---|
| 1.00 | $9.50M | $8.20M | $7.00M | $5.10M | $1.05M | $24.8M | 9.73% |
| **0.40** | $9.50M | $4.50M | $3.50M | $2.50M | $1.05M | $14.9M | **5.99%** |
| 0.35 | $9.50M | $4.05M | $3.15M | $2.30M | $1.05M | $14.1M | 5.66% |
| real | $9.88M | $5.30M | $3.17M | $1.55M | $1.03M | ~$12M | ~3.5% |

Use 0.40 rather than 0.35 because the real #16 is $5.30M and 0.35 undershoots
it by more than 0.40 overshoots #64 — the top of round one is where a GM's
money actually goes.

Write every drafted player a real contract: `ROOKIE_DEAL_YEARS = 4` at
`bonusPct = 0.40`, `isRookieDeal: true`. In the reference implementation league
generation flagged `isRookieDeal` on a coin flip without ever granting the
length, so young players contributed no long contracts at all; treat
`ROOKIE_EXPERIENCE_MAX = 3` years of experience as "still on a rookie deal" at
generation and give those men the real four-year shape.

Price the rookie deal through the same `capHit` the gate reads, and gate the
draft signing on it like any other acquisition.

### 3.6 Terms: separate the rulebook's limit from the player's willingness

Keep two answers to "how long a deal":

- **The rulebook.** `MAX_CONTRACT_YEARS = 12`, flat for everybody. It knows
  nothing about the player.
- **The player.** `willingnessHorizon(playerId, age, trueOvr, position)` — how
  many more seasons *this man* will commit to, refused in his own voice.

The owner's instruction was explicit: *"We should remove the max ages for the
contracts. Just set it to a 12 year max and if the player is old they can say
'the player doesn't want to play that long' but lets assume that's for
35-40year olds at random depending on the player."*

Derive the horizon from the retirement model you already roll every offseason —
do not invent a second curve. Accumulate survival probability forward from
`ANCHOR_AGE = 32` and stop where it falls through a per-player floor drawn in
`[0.22, 0.48]`, then clamp the final age into `[35, 40]`:

```
floor    = rng(`willing-${playerId}`).float(0.22, 0.48)
survival = 1; finalAge = 32
for age = 33 .. 48:
    survival *= 1 − retirementChance(age, trueOvr, position)
    if survival < floor: break
    finalAge = age
notBeforeNow = min(max(35, round(currentAge)), 40)
finalAge = clamp(round(finalAge), notBeforeNow, 40)
years    = clamp(finalAge − currentAge + 1, 1, 12)
```

Anchor at 32 rather than at his current age so the horizon is a property of the
man — the last season he means to play — rather than of when you ask him; a
41-year-old still going does not thereby acquire three more years of intent.
Floor the clamp at his **current** age, not at a constant: clamped to a flat
35, a 38-year-old was told he "does not intend to play past 35", a sentence
about a season he has already played, and it lands on the oldest free agent in
the pool, which is the first name anyone sees sorting by age.

Seed off the **player id alone** so the browser, the Server Action and any
script all give the same man the same answer. This is called on both sides of
the negotiation and the two may never disagree. Position comes along free,
because the retirement model is already position-adjusted — a 34-year-old
quarterback genuinely outlasts a 34-year-old running back and nothing here had
to be told so.

If the panel says a man does not intend to play past 38 and the sim then has
him playing at 41, that is a lying metric. Use the same function for both.

### 3.7 What a club offers, which is a different ladder

```
suggestedYears(ovr, age):
  age >= 34 -> 1
  age >= 32 -> 2
  age >= 30 -> 3
  ovr >= 85 && age <= 28 -> 5
  ovr >= 68 -> 4
  else -> 3
```

This is what league generation, the draft, the AI re-sign wave and every AI
free-agent signing write their terms from, calibrated so roughly 27% of players
(about 4 nominal starters per club) expire per season — close to the real
25–27%. Expiry rate is `1 / mean contract length`, so a league of two-year
deals turns half its rosters over annually and no dynasty ever compounds. (The
reference implementation bottomed out at 2 for anyone under the standard
threshold — the modal roster player — so half of every generated league sat on
two-year deals and hit free agency on the same cycle forever.)

Keep the age gates first and absolute: a 34-year-old gets one year however good
he is, which is what stops an ageing star being handed a deal the club can
never escape.

Do not let this ladder bound what a man *wants* (§5.3). The gap between the two
is a real lever: 18% of players want a term longer than any AI club will ever
write.

