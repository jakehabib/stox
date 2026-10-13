# PART 3 — MONEY: BUILD THE CAP, CONTRACTS, FREE AGENCY, NEGOTIATION AND TRADES

Build this system before you build the screens that read it, and build the
invariant suite in §7 before you build this system. Every money defect in the
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

---

## 4. Dead money, and every mutation

### 4.1 Dead money, and the `CapCharge` ledger

```
deadMoneyOnCut(c, mode) = mode !== 'REALISTIC' ? 0
  : unamortizedBonus(c, mode) + guaranteedSalaryOwed(c, mode)
```

Those are two different kinds of money and that is why one function adds them:
the bonus is cash already paid whose cap charge accelerates, the guaranteed
salary is cash the club has yet to pay and now must. Both land on the cut
year's cap.

**A trade is not a release.** Export `unamortizedBonus` separately, because
when a player is dealt only the bonus accelerates onto the club giving him up —
his guaranteed salary travels with the contract and is the acquiring club's
problem. Charging it to both sides invents money out of a trade.

Store dead money in its own table, not on the contract:

```
CapCharge { id, teamId -> Team (onDelete: Cascade), year: Int, amount: Int, label: String }
index (teamId, year)
```

Cascade from **Team**, not from Contract or Player. Dead money is meant to
outlive the deal that created it — that is the whole point of it — so a charge
must die only when the club it is charged to dies, which happens only when a
save is deleted. The reference implementation carried a bare `teamId` string
with no foreign key, and deleting a league left the charges behind pointing at
ids that no longer resolved: **18,247 orphans out of 22,203 rows** on the dev
database, five of every six cap charges in it, with two separate agents working
around it and one deleting rows by hand before every teardown.

Give each cause its **own label** (`Dead money — Name`, `Franchise tag — Name's
old deal`, `Re-signed Name — old deal's bonus`, `Traded away — Name`, `Void
years — Name`, `Cap overage carried from <year>`). The trade recap and the cap
page match charges by exact label, so causes stay distinguishable, and a GM
reading the sheet can tell a re-sign's legacy bonus from a release.

Write **one row per charge**, landing entirely on one season. This game has no
post-June-1 designation, so do not split a charge across two years; measure it
rather than assume it, and say so on the panel.

### 4.2 The dead-money runway: two kinds of bill, never summed into one

Give the GM a four-year itemised runway, carrying two kinds separately:

- **BOOKED** — a `CapCharge` row that exists. Already dated, already charged,
  already inside this year's dead-money figure. No decision left in it.
- **SCHEDULED** — a void-year bill that has **not** been written yet, because
  the contract that owes it is still on the roster. It lands the league year
  after the real deal runs out (`ledgerYear + yearsRemaining`, since
  `yearsRemaining` counts the season he is in). It is the one future
  dead-money charge the game can name honestly, because nothing about it
  depends on a decision the GM has not made.

Adding those into one number is the lying metric: one is on the ledger, the
other is a consequence of a contract that could still be cut, traded or
extended before it lands. Carry, sum and colour them separately the whole way
through, and label the scheduled item with the **exact** label the ledger will
carry next year, so the line the GM reads here is the line he finds on the
sheet.

Do **not** roll "what it would cost to release everyone" into the runway. That
is a menu, not a bill, and putting it there puts a figure on the panel the club
does not owe and may never owe.

Count the window from the **book year** (§9) for both halves, filter booked
rows to `year >= bookYear`, and carry anything past the last column as a named
`beyondWindow` total rather than silently cropping it — cropping turns "the
books are clean after 2029" into a lie.

Use four columns, on evidence: across 318,249 live contracts the share still
charging the cap N years out is +0 94.85%, +1 64.73%, +2 39.72%, +3 18.78%, +4
4.53%, +5 0.46%. A fifth column is a **median of zero men per club** — a blank
column reading "$255M of room" at more than half of all clubs.

Render the multi-year outlook and the runway from **one** computation, so the
summary is arithmetically the sum of the detail. The reference implementation
had two four-column charts on one screen — one drawing the future cap with dead
money taken out, the other drawing dead money with the future cap taken out —
dated off *different years*, with nothing reconciling them, and the only way to
get the number a GM plans against was to read a bar off a grey line in one and
subtract a column from the other by eye.

### 4.3 Stranded void-year bonus — one spelling

```
strandedVoidBonus(c) = (!c.voidYears || c.voidYears <= 0) ? 0
  : max(0, c.signingBonus − proration(c) * c.years)
```

Charged so far is `proration × the REAL years`, the seasons somebody actually
played; whatever is left of the bonus was borrowed against years that are not
seasons at all, and it accelerates in one lump the moment the deal ends.

**Do not gate this on cap mode**, deliberately: neither is the write, and a
save switched over from REALISTIC still owes what its old deals stranded.

Five places need this figure — the runway itemises it a year early, the
negotiation panel prices it into a deal being built, the contract ledger draws
it as its own line, the pending-cap chip warns about it, and the season write
books it. In the reference implementation all five had their own copy, two
spelled `bonus − proration × years` and one `proration × (window − years)`,
agreeing to within a rounding dollar with nothing keeping them agreeing. A
panel quoting a stranded figure the ledger beside it disagrees with is this
codebase's most persistent defect, and a void-year bill is precisely the sort
of money a GM plans a whole offseason around.

### 4.4 Sign a free agent

```
contract = buildContract({ apy, years, signedYear: seasonYear, escalation, bonusPct, guaranteedPct, voidYears })
hit      = capHit(contract, capMode)        // priced with void years IN the shape
gate:      assertCapRoom({ action: 'Signing', charges: [{ teamId, delta: hit }] })
```

Read `voidYears` **back off the built contract** when you write the row. A
separate local spliced in at both the pricing and the write works only until
something clamps: the builder drops void years a deal of this length cannot
use, and a local copy goes on writing the un-clamped number — a row claiming
void years the cap arithmetic has already discarded.

In one transaction:

1. **Claim him atomically.** Update by `{ id, leagueId, status: 'FREE_AGENT',
   teamId: null, isDraftee: false }` and fail when nothing matched, naming
   whoever signed him. Do **not** update by id alone: the reference
   implementation did, and the very next line deleted his existing contract, so
   pointed at a man on another club's roster it took him for nothing — no dead
   money, no CUT row, nothing on the wire, the old club simply lost him.
   Measured: 3 of 3 rostered players taken that way, and aimed at your own club
   it wrote two SIGN rows for one man, the second tearing up the deal from
   seconds earlier. A negotiation fingerprint is not a guard against this — it
   refuses once and hands back a fresh session, which the panel adopts, so the
   second click goes through.
2. Delete any existing contract row; delete the persisted negotiation patience
   row (signing ends every negotiation about him, including ones he is not
   party to).
3. Create the contract.
4. Zero **both** unsigned clocks (`yearsUnsigned`, `weeksUnsigned`). Both count
   consecutive time on the street only: a man cut again next year starts a
   fresh stint at a fresh price, and his old discount is not a property he
   carries around.
5. Write a `SIGN` transaction **carrying `playerId`**, so the wire, his page
   and the GM's career can link back to him instead of matching a string.
6. **Reconcile the depth chart.** A roster spot is not a place on the field.
   This is the single funnel for every signing in the game and in the reference
   implementation none of it touched a depth chart, so a man signed in week 8
   took no snaps for the rest of the season.

### 4.5 Restructure — move money, never create any

```
restructureContract(c, convertAmount, { addVoidYears = 0, nowYear }):
  yearIdx       = max(0, c.years − c.yearsRemaining)
  converted     = clamp(round(convertAmount), 0, convertibleBase(c))
  remainingBases = bases.slice(yearIdx);  remainingBases[0] -= converted
  carriedBonus  = unamortizedBonus(c, 'REALISTIC')      // NOT c.signingBonus
  ->
  years, yearsRemaining = c.yearsRemaining
  signedYear            = nowYear
  baseSalaries          = remainingBases
  signingBonus          = carriedBonus + converted
  voidYears             = usableVoidYears(c.yearsRemaining, (c.voidYears ?? 0) + max(0, addVoidYears))
  guaranteed            = carriedBonus + converted
                          + max(0, guaranteedSalaryOwed(c) − min(converted, guaranteedBaseByYear(c)[yearIdx] ?? 0))
  converted                                              // report it
```

```
convertibleBase(c) = max(0, bases[yearIndex(c)] − MIN_SALARY)
```

Convert everything above the league minimum and not a dollar more. No year of
any contract may pay under `MIN_SALARY`, and real deals leave a man a small
base rather than zeroing him out. Export the ceiling so the panel can say
"there is nothing here to convert" **before** the GM commits — a man in the
last year of a minimum deal is the one shape where an extension raises his cap
hit and cannot lower it. Rejected: converting the whole base; it is expressible
and nothing in the ledger breaks, but it writes a contract year paying $0
against a league minimum the rest of the game enforces, and it lets a club park
a man on a zero-salary season while the money sits in a bonus prorating past
the end of his deal.

**Carry the unamortised bonus across the rebase, never the whole original
cheque.** The proof is a conversion of zero dollars, which must by definition
change nothing:

```
5yr deal, $25.0M bonus ($5.00M/yr), 2 years played, 3 remaining
BEFORE    proration $5.00M/yr   unamortised $15.0M   capHit $15.0M
WRONG     $25.0M over 3yr    -> $8.33M/yr            capHit $18.3M
RIGHT     $15.0M over 3yr    -> $5.00M/yr            capHit $15.0M
```

Charged over that deal's life: $5.00M + $5.00M in the seasons played, then
$8.33M × 3 = $35.0M against a $25.0M bonus — **$10.0M billed twice**, and worse
the further into the deal you are. A move whose entire purpose is relief
quietly inflated every year it touched.

**ADD void years, never assign them.** Assigning silently deletes void years a
deal already carries: restructuring a 3+2 deal with the slider at zero
shortened its proration window from five years to three and *raised* the very
cap hit the restructure was performed to lower.

**Restate the guarantee in the rebased frame** (§3.3). Carrying the old figure
verbatim resurrects guarantees the player has already collected — a man three
years into a deal comes out of a restructure owed his year-one guarantee all
over again. The formula above has the consequence you want: a conversion out of
already-guaranteed salary leaves dead money untouched, and a conversion out of
salary the club could have walked away from raises dead money by exactly the
amount converted. That is the trap the panel must warn about, priced.

**Report `converted`** and have callers gate on it. A caller cannot infer it by
comparing signing bonuses any more, because the rebase changes `signingBonus`
on its own — a zero-dollar restructure drops it to the unamortised figure.

The write path:

```
refuse if capMode !== 'REALISTIC'
refuse if yearsRemaining < 1          ("nothing left on this deal to restructure")
refuse if next.converted === 0        ("too small to change anything — the base salary floor was already hit")
gate:  delta = capHit(next) − capHit(current)
```

Gate it like every other move, because a restructure does not always free room:
rebasing re-prorates the whole (old + newly converted) bonus over just the
years left, so restructuring a bonus-heavy deal late in its life can raise this
year's hit. In the common relief direction the delta is ≤ 0 and the gate's
escape fires.

Write every field the pure function returned — `years`, `yearsRemaining`,
`signedYear`, `baseSalaries`, `signingBonus`, `guaranteed`, `voidYears` — in
**one** update inside one transaction.

**The one shape that cannot hold both, stated plainly because it is real:** a
deal longer than five years. Its bonus stops amortising in year five while the
contract runs on, so partway through it has more years left than window left (a
7-year deal two seasons in has 5 years to run and 3 of window). A rebased
contract's window is `min(years + void, 5)` counted from year 0, so a window
*shorter* than the years left is not expressible, and the carried money spreads
over 5 years instead of 3. The total stays exactly right; the shape shifts a
little money later. Err on this side: conservation must not bend, and carrying
extra bonus to hold the per-year figure steady is precisely the double-charge
above. Real accounting keeps the old bonus on its own schedule and prorates
only the converted money afresh; one `signingBonus` column cannot express two
schedules. **If you give the contract row a list of bonus tranches instead of
one column, this simplification disappears — consider it, and if you do, keep
conservation as the thing you test.**

### 4.6 Extend — append, and convert

```
buildExtension({ current, newMoneyApy, addYears, signedYear, escalation,
                 bonusPct, guaranteedPct, voidYears, convertPct = 0 }):

  rebased        = restructureContract(current,
                     round(convertibleBase(current) * clamp(convertPct, 0, 1)),
                     { nowYear: signedYear })
  remainingBases = rebased.baseSalaries, padded up to current.yearsRemaining
  carriedBonus   = rebased.signingBonus
  fresh          = buildContract({ apy: newMoneyApy, years: max(1, round(addYears)),
                                   signedYear, escalation, bonusPct, guaranteedPct })
  baseSalaries   = [...remainingBases, ...fresh.baseSalaries]
  years = yearsRemaining = baseSalaries.length
  signingBonus   = carriedBonus + fresh.signingBonus
  guaranteed     = carriedBonus + fresh.guaranteed
  voidYears      = usableVoidYears(years, voidYears)       // clamped against the FULL appended length
  newMoneyTotal  = Σ fresh.baseSalaries + fresh.signingBonus
  oldMoneyRemaining = Σ remainingBases + carriedBonus
  firstNewYearIndex = remainingBases.length
  converted      = rebased.converted
  convertibleBase = convertibleBase(current)
```

**An extension adds years. It does not replace the deal.** The owner's ruling:
*"it should add a year on top, as it does it real life."* A man with 3 years
left who signs a 4-year extension is under contract for **seven**. The 3
existing years keep the money he was already promised; the 4 new years are
appended; a new signing bonus is paid now and prorates from now, still capped
at five years.

"The money he was promised" — not "the base salaries exactly as they were".
**This season's** base salary may be paid to him as bonus instead: same
dollars, handed over sooner, charged to the cap differently. Every later year
keeps its salary untouched, and `oldMoneyRemaining` must be **identical at
every setting of `convertPct`**. That identity is the conservation proof in one
line: the dollar leaves `remainingBases[0]` and arrives in `carriedBonus` in
the same breath. A conversion changes **when** the cap is charged, never how
much.

**Do the conversion by calling the restructure function**, not by writing the
mechanic out again. It already rebases onto the years that are left, moves the
salary, clamps at the league-minimum floor and restates the guarantee in the
rebased frame. At `convertPct: 0` it returns the remaining base salaries
untouched and `signingBonus === unamortizedBonus(current)`, which is exactly
the no-conversion behaviour. Read the carried bonus **off the rebased row**
rather than re-deriving it, so the two cannot drift and the figure is not
rounded through `proration` twice.

Do not spell the carried bonus as `proration × yearsRemaining`. That is bonus
years left only while the deal fits inside the window: a 7-year deal two
seasons in has 5 years to run and 3 of window, so that form carries 5 years of
proration off a bonus with 3 left and charges the difference twice; a 3+2-void
deal one year in fails the other way, carrying 2 where 4 are owed and writing
off bonus that would still accelerate on a cut.

Rebase `years`/`yearsRemaining` onto the appended length so `years −
yearsRemaining` is 0 right now and `capHit` reads index 0 for the current
season, then walks forward a year at a time as the ledger ages. Getting this
wrong is silent and expensive.

Do **not** carry `rebased.guaranteed` into the extension. That figure restates
the *old* deal's guarantee; the extension's rule is `carriedBonus +
fresh.guaranteed`, which already holds both halves the conversion touched — the
converted salary is inside `carriedBonus` because it is cash paid now, which is
why dead money rises by exactly what was converted and by nothing else. The old
deal's guarantee described money some of which has already been paid out, so it
is not carried whole.

Report **both** money figures and never quote one as the other. A "4 year,
$120M extension" is $30M/yr on the **new** years; the APY across all seven
years is a different and lower figure. Report `converted` and `convertibleBase`
too, so the screen can say which of "this lowered his hit" and "this raised it"
happened — it cannot infer that from the bonus moving, because the bonus moves
on every extension.

**Split the `convertPct` default deliberately: 0 in the builder, 1 at the
negotiating table.** This was decided by measurement, not taste.

With the conversion at the negotiated default, over the same 400 real contracts:

```
current-year cap hit UP on 21, DOWN on 379, unchanged on 0
delta  p5 −$12.6M  |  p50 −$4.63M  |  p95 +$80K
```

The 21 that still rise are honest: 20 are men whose current season was already
a cheap year of a back-loaded deal, and one had nothing convertible at all.

But default it ON in the builder and you hand the instrument to a caller that
is not a GM looking at a screen. The AI's re-sign wave prices a re-sign on its
**year-one** cap hit and budgets against that alone — it has no model of the
later years — so an instrument that borrows from those years is a blank cheque
it cannot read. Measured on identical seeds over three seasons: over-cap
violations 12 hits/124 rows → **50/251**, under-minimum rosters 22/66 →
**74/218**, 34 warnings → **124**. Clubs re-signed men they could afford this
season, the bill arrived the next one, and by the season after they could not
afford a 46th body.

So: the builder's default is 0 — a caller that has not thought about the later
years does not borrow from them — and one exported constant
`DEFAULT_CONVERT_PCT = 1` is read in exactly two places, the meter and the
write, so a screen that has never heard of the field cannot draw one contract
and sign another. Make declining a real control, not a hidden constant:
converted salary becomes bonus, and bonus is dead money if he is ever cut.

Make `convertPct` a **share, not a dollar figure**, because the control sits on
a screen where the term and the guarantee are still moving underneath it: a GM
who set "$6.0M converted" and then dragged the years would silently be
converting a different fraction of a different salary.

**The documented simplification:** real accounting keeps the old bonus
prorating on its own original schedule while the new one prorates separately; a
single `signingBonus` column cannot, so the old bonus's unamortised remainder
is carried into the combined bonus and re-prorated across what is now left.
Total dead money stays right — every unamortised dollar is still on the books
and still accelerates on a cut — and the old bonus does **not** vanish: after
an extension the dead money is the sum of both bonuses, which is precisely why
extending early is a commitment rather than a freebie.

### 4.7 Re-sign: branch on the CONTRACT, not on the screen

One entry point handles "keep a player already on the roster", and it decides
append-vs-replace from his contract row:

- **`yearsRemaining > 0` — APPEND.** He is owed a season at a salary the club
  already promised him. Route to the extension path: that season keeps its base
  salary, the unamortised bonus is carried and re-prorated, a new bonus is paid
  now. Gate on `newHit − oldHit`.
- **`yearsRemaining === 0` — REPLACE.** The deal has expired, there is nothing
  to append to, so write a fresh contract. **Book the stranded bonus** and gate
  on `newHit + stranded − oldHit`.

Put the branch in the shared function, not as a second route in the session
resolver, because the user's re-sign panel and the AI's own re-sign wave both
come through it and must produce the same contract for the same player.

A live tester found the hole: *"I'm re-signing guys that still have one year
left on their deal, and it's lowering my Space for the current year."* Replacing
a walk-year deal did two things it had no right to do. Both measured, re-signing
a 93 OVR QB in the final year of his rookie deal at $6.60M base with $15.10M of
bonus ($3.77M unamortised), at $30.91M/yr × 4:

- **It erased the old signing bonus.** The delete took the row and with it the
  proration still owed, and nothing booked a dollar of dead money. Cut him the
  moment the ink dried: **$42.63M** of dead money before, **$46.41M** after —
  the difference being precisely the bonus that used to evaporate.
- **It overwrote a salary the club had already promised.** His $6.60M became
  the new deal's year-1 base of $16.90M, so this year's cap hit was **$27.56M**
  and his space fell **$17.18M**. Appended, this year is his own $6.60M with
  the new bonus prorating on top: **$15.88M**, and $5.51M off his space. The
  other **$11.67M** was the club being charged this year for years it had not
  reached yet.

On the replace branch, book the stranded bonus as a `CapCharge` dated by
`capChargeYear`, in the same transaction, with its own label, and **price it
into the gate** — it is part of what re-signing him *adds*, not a saving
against it. Charge the **bonus**, not the full cut figure: guaranteed salary is
not escaped here, it is replaced by the new deal and charged in full on the new
row.

Write `RESIGN` on the wire when the deal being replaced or appended to is
actually expiring, and `SIGN`/"Extended" when it is not — "Re-signed" over a man
with three years left is a small lie in the news feed. Default the flag to
"is the current deal expiring" so the user's re-signs read the same way as the
AI's without every call site remembering to say so. Put the accelerated figure
in the wire detail: a re-sign that accelerates a stranded bonus costs more than
its APY says, and the wire is where a GM goes back to ask what a move cost him.

Clear `isRookieDeal` and clear `fifthYearOption` on any append. An extended
deal is not a rookie deal whatever it started as — the option and the
rookie-scale rules stop applying the moment new money goes on top — and the
append rebases the whole deal, so there is no longer a trailing year that
bought no bonus; leaving `'EXERCISED'` on the row holds the proration window a
year short of the window the contract actually has.

### 4.8 Franchise tag

```
tagValue = positionSalaryBand(positionCapHits, 1, FRANCHISE_TAG_TOP_N)   // FRANCHISE_TAG_TOP_N = 5
```

```
positionSalaryBand(salaries, from, to):          // 1-based, inclusive
  sorted = salaries.sort(desc)
  band   = sorted.slice(max(0, from − 1), max(0, to))
  if band is empty: return MIN_SALARY * 5
  return round(mean(band))
```

Average the top five **current cap hits** at the position, league-wide, over
ACTIVE players with a contract. Clamp both ends of the band to what the
position actually has, so a league year where only nine men at a position are
under contract returns the average of nine rather than dividing by twenty and
quoting a price nobody pays. Fall back to five league minimums when there is no
market to average — the game has to name a number and there is no evidence.

Write the tag as: `years: 1`, `yearsRemaining: 1`, `signedYear: seasonYear`,
`baseSalaries: [tagValue]`, `signingBonus: 0`, `guaranteed: tagValue`,
`isFranchiseTag: true`, `isRookieDeal: false`.

**Book the old deal's unamortised bonus as dead money, dated by
`capChargeYear`, and gate on `tagValue + accelerated − oldHit`.** Nothing else
in the game lets paid bonus evaporate, and the acceleration is part of what the
tag *adds*: left out, a club with room for the tag alone is waved through and
lands over the ceiling the moment the charge is written.

Charge it as **dead money**, not as a bonus carried onto the tag year, and the
reasons are worth keeping because the other rewrites *do* carry:

- A one-year contract's proration window is one year, so "carry it forward" and
  "charge it now" are the same number in the same league year; the only
  question is which column it is filed in.
- The tag price averages the top-N **cap hits** at the position, so a tag row
  carrying a legacy bonus would price the *next* tag at that position off it —
  the tag would inflate itself. Keeping the row at exactly `tagValue` keeps
  that input clean.
- The row says `signingBonus: 0`, `guaranteed: tagValue`, and the wire says
  "fully guaranteed at $X". Carrying would make all three false, and the
  guarantee would have to be restated in the same breath or the gap re-reads as
  salary still owed and lands on the cap a second time.

Charge the **bonus** and not the full cut figure, for the §4.1 split: a cut
owes both because the club walks away owing him the rest; a tag owes only the
bonus, because the salary obligation is replaced by the tag, which is itself
fully guaranteed and charged in full on the new row. Billing both charges the
club two salaries for one player-season. On the only shape that reaches the
function the two are equal anyway (his deal is up, so guaranteed salary owed is
already 0) — price it correctly regardless, for any caller ever handed a
mid-deal case.

Refuse, in this order, and write the refusal **once** in a leaf module that
both the client control and the server action read, so a greyed button never
names a reason the server does not hold:

1. tags switched off in this league → "the commissioner can turn them back on";
2. phase is not the re-sign window → "The tag goes on during the re-sign
   window, once the season is over. Right now: <phase>.";
3. `yearsRemaining !== 0` → "The tag is for a man whose deal is up. His has a
   season left on it — nobody can sign him before that.";
4. this club already holds a tag this league year (a contract on this team with
   `isFranchiseTag` and this `signedYear`) → "Your tag is already on <POS>
   <Name> this year — one club, one tag, one league year."

Refuse the mid-deal case one level up, in the action: a tag replaces a deal that
is up, and an action only the re-sign row's own gate stopped was a way to walk
out of a long contract.

The owner went looking for this control three times and did not find it —
*"is the franchise tag available for users? I haven't seen it yet"*, *"I don't
see any way to franchise tag someone"*, *"it should be a large option players
can notice"*. Part of that is layout. The other part is that outside the window
there was no control anywhere and nothing said why, so the game read as broken
rather than as having a rule. Render the greyed control with its reason.

Simplifications to carry, and say them in your README: one tag per club per
season, no exclusive/non-exclusive split, no escalating value for a second
consecutive tag on the same player (that needs contract history this schema
does not keep once a contract is replaced).

### 4.9 Fifth-year option

**Who gets one:** round-one picks on their rookie deal, and nobody else. Read
it off the contract (`draftRound === 1 && isRookieDeal`), which makes the option
travel with the deal — a first-rounder traded in year two carries it to his new
club, which is the real rule and falls out of reading the contract rather than
his draft club. Return "no option at all" *before* any block reason, so there is
no control to grey on a seventh-rounder's card: "you cannot exercise an option
he was never given" is not a rule worth teaching on every player page.

Rejected: extending it to round two (the real CBA does not, and it would delete
the distinction the feature exists to create — the draft-value chart prices
round one over round two on talent alone, while in the real sport a
first-rounder is also a year of extra control). Rejected: making it a league
setting the way the tag is — the tag is a discretionary power a club may be
given; the option is a **term of the contract** a first-round pick signs, so
switching it off would change what a first-round pick *is* and leave the
draft-value chart and the AI's pick pricing describing a contract that league
does not use.

**When it is answered: the whole offseason, not one phase of it.** The owner:
*"5th year options should be available not just in the re-sign window of that
season."* Allow `OFFSEASON`, `RESIGN`, `FREE_AGENCY`, `DRAFT`. Refuse
`PRESEASON`, `REGULAR`, `PLAYOFFS` and any inaugural-setup phase. The two real
constraints: not before his third season is complete (the club is buying a
fifth year on three years of evidence), and not after his fourth season begins
(an option picked up in November is a club buying a season it is already
watching). The real deadline falls in early May — after free agency, around the
draft, before camp — which is what that phase list maps onto.

**`yearsRemaining` does not pin the year on its own**, which is why the phase
list is load-bearing rather than decoration: the ledger ages once a league
year, so a first-rounder sits at `yearsRemaining === 1` continuously from the
end of his third season until the end of his fourth — through the whole
offseason *and* through all of the fourth season. The count says "three played,
one to go"; the phase says which of those two halves the league is standing in.
Together they name exactly one offseason in a rookie deal's life. Have neither
test read `League.seasonYear`: through the pre-roll window the ledger is a year
ahead of that clock, and a window mixing the two lets a club answer on one side
of the roll and be refused on the other.

**The price — three tiers, each a band into the same shared band function:**

| tier | band | earned by |
|---|---|---|
| ALL_STAR | top **5** cap hits (identical to the tag) | named an All-Star inside his first three seasons |
| STARTER | top **10** | he has started for you |
| BASE | **3rd through 20th** | neither |

```
optionSalary = max(MIN_SALARY,
                   positionSalaryBand(positionCapHits, tier.from, tier.to),
                   round(fourthYearHit * FIFTH_YEAR_OPTION_MIN_PREMIUM))     // 1.60
```

Those bands are the real CBA's (the tag, the transition tag and the option's own
base tier are literally averages of the 5, 10 and 3rd–20th biggest salaries at a
position), so make the tiers **ranks into one shared function** rather than a
second pricing model beside the first. An All-Star's option year costing exactly
what tagging him would is the real rule and keeps the game from having two
answers to "what does the best man at this position cost for one season".

**The floor is not decoration.** The base tier reaches down into backup money at
a position this league happens to be paying nobody, and an option priced at or
under what the man already costs is not a decision, it is a free year — the whole
feature stops being a bet. Use a multiple of his own fourth year, not a flat
dollar floor: a $3.0M fourth year and a $12.0M fourth year need different floors
under them, and a constant stops mattering the moment the cap grows. Measured at
league year 4, the floor binds only on the base tier and only at the shallowest
positions.

**Translate the real tier tests honestly, and say what you substituted.**

- *ALL_STAR* — use your own post-season honours roster (one selection rather
  than the real rule's two Pro Bowls, because the window is three seasons long
  and this roster is a tighter honour — the top 12.5% of starters at every
  position by construction). Bound the count to the seasons of **this**
  contract: a veteran who was an All-Star at 29 is not on a rookie deal, and
  the bound only ever matters for a man traded onto one, but a rule that reads
  a whole career prices an option off seasons the option has nothing to do
  with.
- *STARTER* — there are no snap counts in this game, so transcribe the
  playing-time leg as "he holds a starting slot", read off the **lineup**
  function (the best men at each position, which is what the sim fields), on
  true ratings. **Rejected:** reading his rank on the depth chart — that is a
  free click, since a GM could demote his own first-rounder in the re-sign
  window, exercise a cheaper tier and move him back before a snap was played.
  **Rejected:** games played — box scores name no offensive linemen at all (0
  of 10 on a measured champion's roster), so that test puts every first-round
  tackle in the cheapest tier by construction and calls it performance.

**Exercising:** append one contract year at `optionSalary`, bump `years` and
`yearsRemaining` by 1, set `fifthYearOption: 'EXERCISED'`, and **guarantee the
whole rest of the deal**:

```
guaranteedAfterExercise(c, optionSalary) =
  max(c.guaranteed, c.signingBonus + Σ c.baseSalaries + optionSalary)
```

Fill the frame completely rather than adding the option salary to what is
stored. `guaranteed` is bonus-inclusive and is only ever read by subtracting the
bonus and filling years **earliest first**, so adding $20.0M to a stored $17.1M
on pick 1.01's deal spreads earliest-first across bases of
`[4.8, 5.3, 6.0, 6.7, 20.0]` and leaves the **fifth** year holding nothing —
dead money on a cut in the option year would read **$0** against a fully
guaranteed **$20.0M** salary. Rejected: the real two-stage
injury-then-full guarantee — this game has no concept of releasing an injured
man, so the first stage would be a rule with no way to observe it, and a
guarantee that depends on something the GM cannot see is worse than a harsher
one he can.

**The option year carries NO signing-bonus proration.** Make `prorationYears`
subtract one when `fifthYearOption === 'EXERCISED'`, and read that field there
and nowhere else in the arithmetic. The bonus was paid once, at the draft, and
prorates over the four years he signed for; the option adds a fifth year at a
salary decided three seasons later with no new bonus, so it charges its salary
and nothing else. That is the real rule and it is also the only arrangement
that conserves: `prorationYears` is derived from `years`, so pushing a 4-year
deal to 5 re-spreads a bonus three seasons have already been billed against —
on a $15.2M bonus (pick 1.01) the seasons played charged 3 × $3.80M = $11.4M,
and years four and five would then charge $3.04M each, **$17.5M of cap against
$15.2M of cash, $2.28M invented**. That is the identical hole the franchise tag
and the re-sign both had, arriving through the divisor instead of through a
deleted row.

Rejected: rewriting `signingBonus` down to 0.625 of itself so the five-year
divisor bills the right remainder — it conserves, but the number the card
prints under "Signing bonus" is then not the cheque the club wrote, and
`guaranteed` is stored bonus-inclusive so it would have to be restated in the
same breath or the gap re-reads as salary still owed. Rejected: rebasing the
deal onto its last two years the way a restructure does — it conserves too, and
it quietly moves $1.90M of proration out of year four into year five, so
exercising an option would be a free restructure and `signedYear` would stop
naming the year he was drafted.

**Run no cap gate for this season, and check that rather than asserting it.**
Exercising changes nothing about the season in front of him — his fourth-year
hit is unchanged to the dollar — so the gate has nothing to refuse. The bill
lands a league year later, where the ceiling is not enforced yet and where a
club has a whole offseason of cuts, trades and restructures to answer it.
Refusing the option today on next year's books would refuse a move real clubs
make every April and enforce a ceiling the game enforces against nothing else.
Instead **show** him: read the option year out of the same multi-year cap sheet
the cap page renders, and make the AI budget against the same figure before it
commits.

Make both writes **conditional on the row still being undecided**
(`where: { playerId, fifthYearOption: null }`) and fail when nothing matched
("That option has already been answered."). Two clicks, or a click racing the
AI wave, would otherwise both read null, both append a year, and leave a
six-year rookie deal with two option salaries on it and nothing on any screen
saying so.

**Declining** changes nothing about the deal — that is what declining *is* — so
the only write is the answer itself plus the wire row. Store it rather than
inferring it from silence: once the window shuts the two are the same outcome,
but inside it they are not, and without a row the control comes straight back
after he has pressed it and the front-office brief puts a decision he has
already made back on his desk next week.

Take the year the wire sentence quotes from the **quote**, which counts from the
ledger, not from `League.seasonYear` which the row is stamped with: answering in
the offseason is allowed, and through the pre-roll window the clock is a year
behind the ledger, so the wire would tell a GM his man reaches free agency a
year before he does.

Keep the option through a restructure, deliberately. The rebase preserves
`yearsRemaining`, so the calendar test still lands on the same offseason, and
taking the option away because a GM moved money around would be a rule with
nothing behind it and nothing on screen to warn him.

Rejected: a dedicated offseason step for this. A press with no decision in it is
a worse game, and it would be a decision for the two or three clubs with a
first-rounder coming due and an Advance for the other twenty-nine. Rejected:
putting these men on the re-sign **list** — that list is deliberately pinned to
`yearsRemaining === 0` during the offseason, because showing a man with a season
still to run beside men who walk in three clicks cost the owner a contract:
*"i just gave a huge extension to someone thinking they needed it but really i
had 1 more year after to decide."* Put the decision on the player's own card,
where the rest of his contract is, and let the front-office brief tell the GM it
is waiting.

Return a complete quote from one server function and have the preview, the card's
standing state and the AI wave all read it: tier, what earned it, what the band
*is* in words, the option salary, the **cap hits the band was averaged over**
(what it is made of), his fourth-year hit, the option year's committed cap,
ceiling, room before and room after, whether it leaves the club over then, what
releasing him afterwards would cost, the block reason, and the stored decision.
Price "what a release costs after" on the contract the write actually produces —
and only synthesise that contract while the answer is still open, or on a deal
whose option is already exercised you price a sixth season nobody can buy.

### 4.10 Release

```
dead = deadMoneyOnCut(contract, capMode)       // REALISTIC only
```

In one transaction: book `dead` as a `CapCharge` dated by `capChargeYear`
(label `Dead money — Name`); delete the contract; set the player to
`FREE_AGENT` with `teamId: null` and **zero `weeksUnsigned`**; write a `CUT`
transaction carrying `playerId`; reconcile the depth chart so the slot he left
does not hold a rank forever against a man who is gone.

Read the phase inside the function rather than making every caller pass it —
which league year the dead money lands in depends on where in the offseason
roll the cut happens, and getting that wrong made cuts free (§0 bug 4).

Zero the week clock on the way **out** as well as on the way in, so "weeks
unsigned" always means weeks since *this* release: a man cut, signed and cut
again starts at his full price the second time rather than inheriting the
discount his last spell on the street earned.

**Pre- vs post-deadline:** this game has no post-June-1 designation and no
split-year acceleration. A release costs the same whenever it happens inside a
league year, and the only calendar boundary that matters is the book year (§9).
Say that in your README as a known simplification rather than implying a split
exists. The trade deadline does not change what a cut costs; it closes trading
(§6.9).

**AI clubs that must make room** need two ordered rules, and both were measured
into shape:

*Clearing cap room for a transaction it cannot decline* (a rookie contract out
of the draft, where refusing to sign the pick is not an option the way passing
on a free agent is): release the least valuable men until the bill is covered,
where "valuable" is **open-market worth**, not cap number.

- If somebody covers the bill alone, release the man of **least worth** who
  does; break ties toward the **smaller saving** (no reason to torch $12M of
  room to clear $1M of bill).
- If nobody does, order by **cap relief per dollar of worth** — the worst
  contracts first, which is the decision a real front office makes when it has
  to clear real money: the overpaid go before the underpaid.
- Deterministic: worth, then saving, then id. No RNG.

The first version of that rule was "biggest cap saving first, fewest releases",
which is a sentence about arithmetic and in football means *waive your best
player*. Measured on one simulated draft, all four clubs that hit this path did
exactly that — bills of $0.73M, $0.99M, $1.28M and $2.57M paid by releasing a
92 WR ($12.7M freed), a 24-year-old 95 DT ($12.6M), an 83 QB ($14.7M) and an 82
QB ($8.6M). And nobody ever reconsiders: the draft is the last step before the
new league year, free agency has closed, and no wave will run on the men it
dumps — across three pre-fix leagues the post-draft pool held nine free agents
rated 90+, including a 97 LT, a 97 EDGE and a 97 QB, none of whom had reached
the market by any route a GM could name. After the fix, clubs in cap trouble
waived an 87 LG, an 86 RB and an 85 P, and **no club released a 90+ player to
fit a rookie deal** across five leagues.

*Shedding bodies to fit a roster limit:* rank worst-first on
`trueOvr + deadMoneyOnCut / CUT_DEAD_MONEY_PER_OVR`, with
`CUT_DEAD_MONEY_PER_OVR = 1_500_000` — $1.5M ≈ one rating point, so a 61 who
costs $3.0M to release is treated as a 63 and an equally-rated man on a minimum
deal goes first. Dead money is the reason a good contract survives a cut-down
and a bad one does not, so put it **in** the ranking rather than beside it. Use
**one** implementation of this ordering for both the trade path and cut-down
day, or a club sheds one man in a trade and a different one in September.

Protect the **last** man at a one-man job (kicker, punter) by sorting him
behind every unprotected man — not by making him untouchable, so a club with
more overflow than other bodies still loses him, and a club carrying two
kickers may still cut one. Counted across the dev database, **213 clubs carried
no kicker at all and 218 no punter**, and 113 of the kicker-less ones were
carrying fifty or more men — a full roster with nobody to kick. Replaying the
unprotected ordering over 6,373 real rosters, an overflow of five takes a club's
only kicker **3.67%** of the time and its only punter **4.14%**; the median
club's kicker sits 26th in the queue but the 5th-percentile club's sits 6th. And
nothing puts him back, because roster-minimum filling only runs for a club
*under* the minimum and cut-down day is the last roster event before week 1.
What it costs is measured: swapping one club's kicker across the rating range on
identical rosters and seeds moves that club's scoring by **0.666 points a season
per rating point**, so a median 73 kicker becoming an empty slot (48) is about
**sixteen points a season** — a fifth of the gap between a good offence and a
bad one, paid by a club that never decided to pay it.

**Never trim the user's roster for him.** Block the advance instead and let him
cut whoever he wants. The reference implementation ran the trim with no
is-user filter, sorted the human's roster by true rating ascending and waived
the overflow — releasing players the user chose, booking dead money against
him, and picking the victims by a rating the fog-of-war settings mean he cannot
even see. Deciding who to cut is the single most characteristic decision in the
genre; the game does not get to make it.

---

## 5. Free agency and negotiation

### 5.1 Market value, and the ask that falls

```
marketValue({ ovr, position, age }):
  steepness = ovr >= PIVOT ? STEEPNESS : STEEPNESS_LOW
  base      = exp((ovr − PIVOT) * steepness) * SCALE
  posMult   = POSITION_MULT[position] * (position === 'QB' ? qbJobShare(ovr) : 1)
  ageMult   = 1
            − (age > 28 ? (age − 28) * 0.07 : 0)
            + (age < 26 ? (26 − age) * 0.03 : 0),  clamped to [0.35, 1.35]
  return max(MIN_SALARY, round(base * posMult * ageMult / 100_000) * 100_000)
```

`PIVOT = 77`, `STEEPNESS = 0.058`, `STEEPNESS_LOW = 0.14`, `SCALE = 7_000_000`.

| QB | RB | WR | TE | LT | LG | C | RG | RT | EDGE | DT | LB | CB | S | K | P |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1.85 | 0.54 | 1.27 | 0.79 | 1.29 | 0.85 | 0.79 | 0.85 | 1.09 | 1.47 | 1.11 | 0.73 | 1.24 | 0.77 | 0.32 | 0.22 |

Keep the pivot locked to your rating distribution's mean overall: `ovr` enters
only as `(ovr − PIVOT)`, so shifting the rating curve and the pivot together
cancels exactly and nobody's price changes. Use `SCALE` to move the whole
economy and the position table to decide how money is **split** — never how
much of it there is. Re-solve the non-QB vector's normalising constant whenever
you edit that table, or the roster-affordability calibration quietly rots.

Decay faster **below** the pivot than you grow above it. One symmetric
exponential cannot compress the bottom of the roster toward the minimum without
re-inflating the ceiling: a whole 53-man roster of below-average depth priced
like fringe starters blows through the cap before a single good player is
signed. Calibrate `SCALE` so a generated roster at market lands near the
ceiling and keeping everyone good is a real choice. Measured in the reference
implementation: a club actually carries 47.4 men costing **99%** of `BASE_CAP`
at market (median 94%), and only the generator's own scale-down to a payroll
target keeps books opening legal (0 of 160 clubs over the cap, mean payroll
78%). The cap is **tighter** than comfortable, not looser.

**Price the quarterback on a curve, not on a constant.** Every other position
plays several men, so quality and pay fall off together and one exponential
describes the lot. A quarterback room does not work that way: one man plays
every offensive snap and the others play none, so there are thirty-two jobs in
the league and the price of a quarterback is overwhelmingly the price of
holding one.

```
qbJobShare(ovr) = BACKUP + (STARTER − BACKUP) / (1 + exp((PIVOT + STARTABLE_ABOVE_PIVOT − ovr) / WIDTH))
BACKUP = 0.29, STARTER = 1.38, STARTABLE_ABOVE_PIVOT = 1, WIDTH = 2.6
```

Applied flat, the multiplier pays a man for being *a* quarterback rather than
for being *the* quarterback: measured across two freshly generated leagues it
produced a starter averaging **$14.4M** against a backup averaging **$8.1M** —
a 1.79x gap where real football runs closer to 10x ($40–55M against $2–5M). The
league's third-most expensive contract was somebody's backup. Set the crossover
where the thirty-two jobs run out (sorting every quarterback in a 32-club
league, the thirty-second grades right around `PIVOT + 1`), and make it
**cap-neutral**: over 320 generated quarterback rooms a club's total spend on
quarterbacks is **$27.2M flat and $27.2M on the curve**. The money is not new;
it is taken off the two men who do not play and handed to the one who does. At
age 27 that buys: a 72 goes $6.4M → $2.5M, a 76 $11.3M → $7.2M, an 80 $15.4M →
$15.9M, an 85 $20.6M → $27.0M, a 90 $27.5M → $37.7M, a 95 $36.8M → $50.7M.

Do **not** key the job share on his own depth chart. A 93 stuck behind a 95 is
still worth starter money to the other thirty-one clubs, and that is exactly
why a club in that position trades him rather than banking a discount.
Depth-blindness here is the model being right.

**Make the ask fall while nobody calls.** `marketValue` is what a man is worth
on the open market, which is a fact about the player. What he will actually
**sign** for is a fact about the player *and the calendar*:

```
unsignedAskMultiplier(weeks):
  logistic(w) = 1 / (1 + exp((w − 11) / 3.5))
  return 0.35 + 0.65 * logistic(max(0, weeks)) / logistic(0)

askingPrice(opts) = max(MIN_SALARY,
                        round(marketValue(opts) * unsignedAskMultiplier(opts.weeksUnsigned) / 100_000) * 100_000)
```

`MIDPOINT_WEEKS = 11`, `WIDTH_WEEKS = 3.5`, `FLOOR = 0.35`. Normalise so it is
exactly **1.0** on the day he is released, which is what lets every screen
quote `marketValue` as "what he wanted" and this as "what he will take" without
the two disagreeing at week zero.

Use a logistic rather than a straight line because that is how the market
treats him: early on nothing has been learned — clubs are working through their
own re-signs and the draft, and his agent has no reason to blink — so the price
barely moves; once it is clear nobody is coming it falls fast; then it flattens,
because a genuinely good player is still good and there is a price below which
he would rather wait for next spring.

Without this, a 98 quarterback released in the spring was still asking $60M in
December — unsignable, and therefore still there. The owner, deep into a season:
*"those same really high overall 95, 96, 97, 98 overall players are still on the
free agent list. Those players should gradually drop their salary demand. So
that way, they get picked up."*

Measure how many ticks of this clock a league year is in **your** calendar and
calibrate the midpoint against it. In the reference implementation a league year
is **26** ticks, not the 30 presses the year takes, because the first three
playoff rounds do not move `League.week` and so do not age the wire. On that
clock a man released when free agency opens is at 99% when the window opens,
95% when the draft goes on the clock, ~90% on opening day, ~74% by week 5, ~55%
by week 9 and ~43% by week 13.

**Use `askingPrice` for every free-agent price in the game** — the AI's
sealed-bid wave, its in-season shopping, its budgeting, the reservation price
behind the user's negotiation panel, and the free-agency board itself. Use
`marketValue` for anybody under contract (where `weeksUnsigned` is 0 and the two
are identical anyway) and as "what he was worth before nobody called". A screen
that quotes market value for a man the engine would sign at the discounted price
is the lying metric.

### 5.2 Have exactly ONE acceptance model, for everybody

The reference implementation shipped two, twice, and the second time the
comment claiming there was one was sitting in a file that carried two.

The first copy was four lines in the free-agency module:

```
const ratio = apy / market;
if (ratio >= 0.9) return { accepted: true, ... };
```

— no personality, no term, no guarantee, no patience, no rival. That was the
function the server used, while the full model sat unimported. The user's path
was fixed; the same four lines had moved a few hundred lines down the file and
taken a name:

```
export const MARKET_FLOOR = 0.85;
if (best.offer < market * MARKET_FLOOR) continue;
```

— the identical salary-only ratio deciding the identical question for every
club that is not the user's. It also meant the board could not tell the truth:
the board advertised the asking price, a CPU club signed at 0.85 of it, and the
user's own model wanted a median of 1.04 and as much as 1.44 — two different
answers to "what does this man sign for", both about the same printed number.
Measured across sixty free agents, offering exactly the advertised price closed
**13** of them.

So:

- **The user** goes through `decideOffer`, called by the browser on every drag
  and by the Server Action on submit.
- **The AI** goes through `leastAcceptableApy` — the bottom of the same band,
  off the same curve, about the same man — and a bid under it is not a bid.

Retrospective proof the constant was never a CPU discount: the model puts a
neutral free agent's floor at a median **0.89** of his ask, spread **0.73 to
1.00** by personality, term and guarantee. The old flat 0.85 sat inside that
spread. It was the band bottom, hard-coded, against a price that meant "what he
asks" rather than "what he takes".

### 5.3 Build the negotiation context once, on the server

The client must never assemble one: the reservation price is derived from
ratings the user is not allowed to see. Ship context + gate to the browser
whole.

**Personality**, drawn from a seeded weighted pick:

| personality | weight | money | years | guarantee |
|---|---|---|---|---|
| MERCENARY | 34 | 0.72 | 0.10 | 0.18 |
| LOYAL | 30 if incumbent else 18 | 0.50 | 0.30 | 0.20 |
| WINNER | 22 | 0.48 | 0.22 | 0.30 |
| PROVE_IT | 22 if age ≤ 27 else 12 | 0.62 | 0.26 | 0.12 |

Make each row's weights sum to 1 so interest stays on 0–100 whatever the
personality.

**The price multiplier**, assembled in this order:

```
loyaltyDiscount = incumbent
  ? (min(0.10, 0.03 + yearsWithTeam * 0.015) + (LOYAL ? 0.06 : 0))
      * (mode === 'EXTENSION' ? 1 : LOYALTY_WINDOW[resignWindow])
  : 0
controlDiscount = mode === 'EXTENSION' ? min(0.10, max(0, controlYears − 1) * 0.035) : 0
winnerAdjust    = WINNER ? (teamStrength − 0.5) * 0.20 : 0
clubDiscount    = loyaltyDiscount + controlDiscount + winnerAdjust
multiplier      = 1 − clubDiscount
                + (PROVE_IT ? 0.10 : 0)
                + (mode !== 'FREE_AGENT' ? competition * 0.12 : 0)
multiplier     *= 1 + rng.float(−0.05, 0.05)
reservationApy  = max(MIN_SALARY, round(trueMarketApy * multiplier / ASK_CLOSES_AT))
```

`LOYALTY_WINDOW = { WALK_YEAR: 1, FINAL_CALL: 0.45 }`.

Sum the club-specific terms into **one** `clubDiscount` field on the context
rather than applying them one at a time, because the rival has to be priced
*without* them (§5.6) and subtracting them separately makes "what would he
charge somebody else" a number nothing can reconstruct.

Keep `FINAL_CALL` non-zero on purpose: he would still rather stay than move his
family; what he will no longer do is fund the difference himself. And decay the
discount at all, because a flat re-sign discount makes "when do I do this" a
question with no answer — the offer you could make in week 1 of his walk year
was the identical offer you could make on the last screen before free agency,
so there was nothing to be early for and nothing to be late about.

**Add the rival premium only where the rival cannot be a bid at the table.** On
the open market a contested free agent already faces a whole rival package he
scores (§5.6); adding 12% to his asking price on top charges the same rival
once in the price and again in the auction, and it is the single biggest reason
the board could print a number that did not sign anybody — a man with three
clubs calling wanted 12% over the figure on screen *and* could still be outbid
at it. On the two incumbent screens nobody may sign a man under contract, so the
price is the only place a suitor can register; keep it there, scaled by
`RESIGN_LEVERAGE = { WALK_YEAR: 0.4, FINAL_CALL: 0.85 }` or, for an extension,
by `extensionLeverage(controlYears) = 0.4 / max(1, controlYears)`.

**Anchor the reservation price to the number on screen.** This is the promise,
and enforce it rather than hoping for it:

> Pay the advertised asking price, on a deal he has no other complaint about,
> and he signs. Every free agent, every personality, every draw.

```
ASK_HEADROOM  = (1 + max(PROVE_IT_PREMIUM, WINNER_SWING / 2)) * (1 + PRICE_WOBBLE)
              = (1 + 0.10) * 1.05
ASK_CLOSES_AT = ASK_HEADROOM * askRatioForInterest(ACCEPT_INTEREST)
```

Derive the headroom from the constants rather than typing it in, so raising any
of them keeps the promise true instead of quietly making it false. Both factors
have to be there: the headroom so the **dearest** draw closes at the printed
figure rather than the median one, and the accept ratio because meeting his
reservation price exactly is not a certain yes (the accept line is 90, not 100,
and the money curve says that is 96.2% of what he is asking).

Before this anchoring, measured over sixty free agents: offering exactly the
advertised asking price signed **13 of 60** on the deal an AI club would write,
and **43 of 60** even when handed his own preferred term and the guarantee he
wanted. The median man wanted **1.04x** the printed figure and the dearest
**1.44x**. A board that quotes a price you cannot buy at is a lying metric.

Where is the haggle, then? Below the ask, and it is real money: a neutral free
agent's certain yes lands around **0.87** of the printed figure and the bottom
of his band around **0.82**, so the stretch from about four fifths of the ask up
to the ask is a genuine gamble. Do that by moving the **anchor**, not by bolting
a "close enough" band onto the acceptance test — the latter is a second rule
about the same question, and this module already carries the scar of two.

**Patience:** `max(2, round(5 − competition * 2 − (ovr >= 85 ? 1 : 0) + (LOYAL ? 1 : 0)))`.
This is the resource that stops a user probing for the hidden number by
spamming lowballs until something sticks.

**Desired guarantee:** MERCENARY 0.6, PROVE_IT 0.35, others 0.5.

**Guarantee floor** — the share below which no salary signs him:

```
quality = clamp((ovr − 72) / (85 − 72), 0, 1)
floor   = min(0.5, round(quality * 0.45 * PERSONALITY_MULT * 100) / 100)
PERSONALITY_MULT: MERCENARY 1.15, LOYAL 0.9, WINNER 1, PROVE_IT 0.55
```

Round to whole percent, because the guarantee control is whole percent on both
the slider and the typed field and a floor of 0.3162 is a boundary no control in
the game can sit on. Start it at the same rating your AI calls "an acceptable
starter" (72) rather than at a number invented here, so a 67 depth guard has no
floor at all and a 90 wants half the deal in writing.

The owner: *"guaranteed money seems to not really impact player favor which it
does in real life. It's fine if it's lower or higher for some but it should have
sooome impact."* It already moved the meter 18–30 points across a 0→100% sweep;
the problem was the **baseline**. Measured at his exact asking price with term
matched and **nothing** guaranteed, four personalities read **70, 80, 82 and
88** — comfortably signable. Guaranteeing nothing was the optimal play and the
slider was decoration, which is backwards from the sport.

So cap interest below the band when the offer is under his floor
(`UNDER_GUARANTEED_CAP = 62`), report it as a refusal of the **structure**
rather than an insult, charge it **one** pip rather than two, and keep the
counterweight: more guarantee means more signing bonus, which prorates, which
is real dead money on a cut. Guarantee mattering more to him while costing more
to you is the tension a real contract has.

**Desired term — four inputs, and none of them a ceiling.** The owner: *"almost
every player's interest declines when you offer a deal over 5 years. That
shouldn't be the case. I get some players want a short term deal but others want
long."* The measurement was worse than the report: with an age ladder topping
out at five, five was the **longest term any player in the game wanted**. Swept
over 2,400 real players in fourteen saves, offering each man his own advertised
ask across terms one to eight: **0 of 2,400** peaked above five, and all 76
twenty-four-year-old business-first players peaked at exactly five — one answer,
seventy-six men. After the change, 18.0% peak above five, that same cell spreads
across two to seven years, and no term inside a man's own horizon is refused at
any price.

```
base = 3.3 + 3.0 * clamp((ovr − 55) / (88 − 55), 0, 1)       // a fringe player thinks in 3s, a star in 6s
     + 0.15 * peakShift(position)                            // a gentle direct nudge
     − 0.6 * max(0, (age − peakShift(position)) − 27)        // measured on his EFFECTIVE age
     + PERSONALITY_TERM[personality]                          // MERCENARY +0.2, LOYAL +0.7, WINNER −0.45
     ... PROVE_IT applies as a multiplier instead (he wants a short deal and a big number)
     + seeded taste, drawn as the MEAN OF THREE ROLLS
desiredYears = clamp(result, 1, willingnessHorizon.years)
```

Measure age against the **effective** age his position's career arc gives him,
reading the same arc table the progression curve and the retirement model
already use — a back peaks two years early and a quarterback three years late,
so the same 29-year-old is 31 in one body and 26 in the other. Reusing the sim's
own table rather than inventing a second one is the point: what he says he wants
and what the simulation will do to him come from one place. Draw taste as the
average of three rolls so it piles up near the middle and the crazy answers get
less likely the further out they go — and truncate nothing: a seven-year man is
rare, not forbidden. Clamp to his own horizon so the panel cannot say he wants
six years while `decideOffer` refuses anything past his horizon.

### 5.4 Evaluate an offer

```
committedTerm(ctx, offer) = offer.years + (mode === 'EXTENSION' ? ctx.controlYears : 0)

askApy      = ctx.reservationApy * termPremium(ctx, committedTerm)
moneyRatio  = offer.apy / askApy
moneyScore  = satisfaction(moneyRatio, MONEY_TOLERANCE)
yearsRatio  = committedTerm / ctx.desiredYears
termFit     = yearsRatio <= 1 ? yearsRatio : max(0, 2 − yearsRatio)
yearsScore  = max(TERM_SCORE_FLOOR, satisfaction(termFit, TERM_TOLERANCE))     // floor 0.62
gtdScore    = satisfaction(offer.guaranteePct / ctx.desiredGuarantee, GUARANTEE_TOLERANCE)
raw         = moneyScore * w.money + yearsScore * w.years + gtdScore * w.guarantee

satisfaction(ratio, tol) = ratio >= 1
  ? min(OVERSHOOT_MAX, 1 + (ratio − 1) * OVERSHOOT_CREDIT)
  : max(0, ratio) ^ (1 + 0.6 / tol)

MONEY_TOLERANCE = 0.35, TERM_TOLERANCE = 0.55, GUARANTEE_TOLERANCE = 0.7
OVERSHOOT_CREDIT = 0.25, OVERSHOOT_MAX = 1.2, TERM_SCORE_FLOOR = 0.62

insulting       = moneyRatio < 0.7
underGuaranteed = offer.guaranteePct < ctx.guaranteeFloor
interest = min(insulting ? 44 : underGuaranteed ? 62 : 100,
               round(clamp(raw * 100, 0, 100)))
```

**Judge an extension on the TOTAL.** `offer.years` there is the size of the
add-on — the number he negotiates — but what he is agreeing to is the add-on
plus everything already on his deal. A 33-year-old with two years left taking
four more is committing through 39, and it is that figure he has an opinion
about.

**Make term a preference with a price, not a rule.** It was a rule and the rule
was unsignable: a prove-it player's term score was `1 − extraYears * 0.28`,
which hits **zero** four years past what he wants, so his interest was capped by
a component no amount of money could move. Measured on a real save, a 97 OVR
receiver asking $31.1M over 2 years, offered the slider maximum of **$51.0M over
12 years with 100% guaranteed**, came out at interest **74** and **refused**,
while the same money over his own 2 years read **100** — and only **5.2%** of
the whole slider grid closed him. That is the owner's report exactly: *"I offered
a maxed out contract to someone and they still wouldn't say yes or no"*, and his
diagnosis is the fix: *"These should be player preferences and not rules."*

So move the preference into the **price**:

```
termPremium(ctx, committedYears):
  off = committedYears − ctx.desiredYears
  if off === 0: return 1
  perYear = off > 0 ? 0.055 * (PROVE_IT ? 1.6 : 1) : 0.045
  return 1 + min(0.28, perYear * sqrt(abs(off)))
```

Both directions, because both are real: asking a man who wants a short prove-it
deal to lock in five years costs a premium (he is selling the upside of hitting
the market again), and asking a man who wants five to take two costs a premium
too (he is giving up security). The owner's own figure: *"if a player wants a
short term deal you might need to pay 5-10% more for a longer term and vice
versa."* Taper with a square root — the first year away costs the most, and a
man does not ask for six times the money to go from two years to eight.

Leave the term component as **flavour with a floor**. A flavour component that
can zero out is a rule wearing a preference's clothes. And make it
**symmetric**: scoring `satisfaction(min(ratio, 1.15))` returns a *bonus* on the
overshoot branch, so a man who wanted two years and was handed twelve scored
**1.0375** on term — fractionally happier about being locked up for a decade
than about getting the deal he asked for — and it made the "too long" demand
line unreachable, because that line gates on `yearsScore < 0.85` and the score
could never fall below 1 above his own term. The one direction the owner
reported on was the one direction the model scored as a small positive and the
panel never mentioned.

**Cap an insult at 44, whatever the other sliders say.** Without it, seven years
and a 100% guarantee drag a 60%-of-asking offer up to a gold "Close" — with "his
agent stopped listening" printed directly underneath and a two-pip price on the
button. Term and guarantee may not buy their way past the money being an insult,
and the cap gives the salary slider a real edge to find: the bar jumps the
moment his agent starts listening again. Use the guarantee floor the same way,
one step milder.

**Verdicts** (tie them to the same constants the meter's ticks read — never a
second copy): `INSULTED` when insulting; else `ACCEPT` at ≥ 90, `CLOSE` at ≥ 72,
`CONSIDERING` at ≥ 45, else `COLD`. Export `INTEREST_TICKS = [45, 72, 90]` and
have the meter import it. The reference implementation wrote `>= 72` and
`>= 45` as literals in the model and `const THRESHOLDS = [45, 72, 90]` in the
meter under a comment claiming "these are the same numbers, and they move
together". They were four literals and a copy. Move the close line to 70 and the
tick stays at 72: the bar changes colour a pixel and a half from where the mark
says it will — this project's recurring bug drawn at 1.5px.

**Demands: non-numeric, actionable, and about the reason the model actually
used.**

- money: `< 0.7` "The money is not close. His agent stopped listening."; `< 0.88`
  "He wants noticeably more per year."; else "He is looking for a little more per
  year."
- term, when `yearsScore < 0.85`, in **both** directions — too short: "He wants a
  longer commitment than this. The years he does get have to be worth more."; too
  long, prove-it: "He is betting on himself and wants back on the market. Tying
  him up this long costs a good deal more per year."; too long, otherwise: "That
  is more seasons than he asked to be tied up for. He will do it — the years past
  what he wanted have to be paid for."
- guarantee, **only when not under his floor**: "He wants more of it
  guaranteed."
- competition over 0.5 and not yet certain: "Other teams are calling. This will
  not sit on the table long."
- nothing else to say and not yet certain: "He is close. Something small is still
  missing."

For a whole release the only feedback for a too-long deal was the **money** line
— "he wants noticeably more per year" — over an offer whose salary he had not
complained about. Measured on a 25-year-old receiver at exactly his reservation
price: five years read **100** with no demands, twelve read **86** with "He
wants noticeably more per year" and **not one word about the term that caused
it**. Do not add a third copy of the under-guarantee refusal to the demand list;
the headline and the control's own caption already say it, and the demand list
is for things he wants *more* of.

### 5.5 "He might sign here" — make the band real

The meter must not be an oracle. The reference implementation flipped
`accepted` at exactly 82 interest, so the optimal play was to binary-search that
number and pay it, every time, forever. The owner named it: *"The breakpoints on
the contract interest meter are great, but around the breakpoint to sign lets
have some mystery like 'he might sign here' so that way players can't always just
pay the bare minimum."*

Three regions, and the middle one genuinely uncertain:

```
ACCEPT_INTEREST = 90
bandHalfWidthFor(conf) = round(25 − (25 − 12) * clamp(conf,0,100)/100)
bandHalfWidth = max(5, round(bandHalfWidthFor(scoutConfidence) * signBandMult))

signBandFor(ctx, interest) = interest >= 90 ? 'YES'
                           : interest >= 90 − bandHalfWidth ? 'MAYBE' : 'NO'
maybeChance(ctx, interest) = clamp((interest − (90 − bandHalfWidth)) / max(1, bandHalfWidth), 0, 1)
wouldSign = band === 'YES' || (band === 'MAYBE' && acceptanceRoll(ctx, offer) < maybeChance(...))
```

Make the regions **asymmetric** and make certainty expensive. The owner asked
for the shape directly — *"maybe we make the 'might sign' from, for example, a
score of 65-85 on the meter?"*, then *"or maybe 65-90?"* — and gave the reason:
*"i want the user to have to pay a bit of a tax for getting the guaranteed yes."*

**Seed the hidden draw on the player, the league year and the EXACT offer, and
on nothing else.** Three consequences, all deliberate:

- Submitting the identical offer twice gives the identical answer. There is no
  refuse-resubmit-hope strategy, which would be a worse calculator than the one
  this replaces. He said no and he means it: the same money will not sign him
  again this league year, and no wording in the panel may imply waiting might
  change that.
- Moving the offer at all — a hundred thousand dollars, one point of guarantee —
  draws a fresh hidden value. Exploration is possible but never free: every
  different offer he turns down costs a pip.
- **Patience spent is NOT in the seed.** It can legitimately differ between the
  session the client holds and the row the server reads, and anything that can
  drift may not decide acceptance, or the meter and the server disagree for
  reasons neither can show the user.

It survives a reload and a walk-out for free, because there is nothing to
survive: the answer is a pure function of facts already in the database.

Floor the band width at 5. A band that can shrink to nothing is a solved
equation — at zero width the meter flips cleanly at 90 again and the binary
search is back. A skill tree may buy a tighter read; it may not buy the answer.

Vary the band from something the player **chose**, and write down what it
actually varies with rather than leaving it to be inferred. In the reference
implementation scouting fog became draft-prospects-only, so every free agent and
every incumbent arrives at confidence 100 and the function returns a flat 78–90
for the entire league forever; the variation comes from a dynasty skill branch
instead (0 ranks 78–90, 1 rank 79–90, … 5 ranks 83–90). A comment still
describing the old mechanism is exactly the defect that hid a twelve-man defence
in that codebase for months.

**Open the salary control below his certain yes**, and derive the opening
position only from things the user can see:

```
openingBidApy(ctx) = round(ctx.marketApy * 0.9 / ASK_HEADROOM)
```

It may **not** be built from `reservationApy` however convenient — the slider's
starting position is on screen, and a starting position derived from the hidden
number hands the hidden number over. Measured: nine tenths of the *public*
estimate was a certain YES for **62 of 140** free agents on a fresh league (62
certain yes, 61 in the band, 17 short) — a rubber stamp wearing a slider. Nine
tenths of the *anchored* price is 0.78x the ask: **0 certain yes, 31 in the band,
109 short** — not a lowball (the insult line is well below) and never a free
signing.

**Report the band and the bottom of it as closed forms, not searches, where you
can:**

```
askRatioForInterest(interest) = (clamp(interest,0,100)/100) ^ (MONEY_TOLERANCE / (MONEY_TOLERANCE + 0.6))
```

This is the inverse of the money curve on a deal he has no other complaint
about, and it exists because two things must agree about what a price *means*:
the reservation anchor and the least he will sign for. Both are this function at
a different interest level, so moving the accept line or the money tolerance
moves both together — the property that was missing when the wave carried its
own hard-coded 0.85.

```
minimumAcceptableApy(ctx, years, gtd)  // cheapest CERTAIN yes, or null
leastAcceptableApy(ctx, years, gtd)    // bottom of the band, or null
```

Bisect both (40 iterations over `[0, reservationApy * 3]`; monotonic in salary,
so bisection is sound) and **return null when no amount of money closes it** —
a real answer, not an edge case: a deal under his guarantee floor is capped
below the band, so a club offering it is not underbidding, it is offering a
structure he has refused. The reference implementation bisected regardless and
returned three times his asking price as if that would do it, which is a number
nobody should ever be quoted. A caller that treats null as "free" has the AI
signing men on terms the user's own panel calls unsignable.

### 5.6 The contest — one comparison, one scale

The owner, looking at a live panel showing a red *"Washington Sentinels is in
the mix at ~$12.7M/yr — you have to beat that"*, a *"Beat Sentinels — $13.1M/yr"*
chip, and directly underneath both an interest meter reading **95 · WILL SIGN ·
"Dante Boone will sign this."**:

> *"this also contradicts itself as a bug. it says he WILL SIGN for X amount,
> but because another team is bidding, he wont. that should talk with each
> other, maybe instead of a set $ amount, another team has a higher trade score.
> but you can overcome that score with more guaranteed money/years/salary. so
> it's not just raw salary"*

The old line was `const outbid = !blocked && gate.competingApy > offer.apy` — a
raw dollar comparison computed entirely independently of the meter.

Replace it with: a rival's bid is a **package the player scores**, on the same
0–100 scale as yours.

1. Build the rival's `Offer` — apy, years, guaranteePct — out of the same wave
   logic that would actually sign him. Never invent it in the panel.
2. Score it through the **same** evaluation function.
3. You keep him when your interest clears his by `CONTEST_MARGIN = 2`:
   `winsContest(yours, theirs) = yours >= 100 || yours >= theirs + 2`.

**Score the rival against a NEUTRAL price, not against yours.**
`ctx.reservationApy` is his price *for you* — it already carries the hometown
discount, the years of control you hold and a ring-chaser's read on your roster.
Handing the rival that price hands the rival your hometown discount, which is
the one thing a hometown discount cannot be. So derive the rival's view by
dividing out `clubDiscount` (the exact inverse of the subtraction that built it,
clamped because a denominator near zero produces a number that is not a
contract), and let the incumbent's edge in the contest be nothing more than the
discount already on the context. **One loyalty concept in the whole module.**

A dead heat is not a win: the rival holds the tie. Tossing a coin would be
re-rollable variance the user could re-run by nudging a slider and coming back.
Keep the margin small, though — the substantive incumbent edge is already in the
price, and a second invisible loyalty bonus makes the contest unlosable for
reasons the panel cannot state. Around the accept line a point of interest is
worth roughly **0.6%** of his asking price, so two points is a fraction of a
percent of salary.

**Keep the contest deterministic and out of the acceptance seed.** A rival that
entered the seed would make the hidden draw re-rollable by waiting for the market
to move.

**Let his own refusal outrank the auction.** Only report "outbid" when your
package is in the band at all (`band !== 'NO'`) and not blocked: if yours is an
insult, or under his guarantee floor, or simply not enough, then losing an
auction is not what is wrong with it, and saying so pushes the user at the
rival's number when the answer is that he has refused the deal itself.

**Order the band: BLOCKED > LOSING > YES/MAYBE/NO.** Both overrides earned
themselves. Without LOSING the band read YES · "he will sign this" over a screen
also saying he was signing elsewhere. Without BLOCKED the band read YES over a
screen whose own button said "Not enough cap room" — big green meter, "he will
sign this", a ledger showing cap space after of **−$84.2M**, and the one sentence
naming the shortfall suppressed because the panel hides the reason on a YES.

**Say what would beat them, in each dimension separately.** Return the minimum
move in salary, in guarantee and in term that **both** wins the contest and
closes the deal outright (a certain yes, not a coin flip) — and null in any
dimension that cannot do it alone, printing nothing for a null rather than a
chip that would not work. The old chip put `competingApy * 1.03` in the salary
box because salary was the only thing the comparison looked at; now three
different moves can win and they cost completely different things. Which is
cheapest depends on the man: a business-first player weights guarantee at 0.18
and a ring-chaser at 0.30, so the same $1M of locked-in money is worth nearly
twice as much interest to one as the other, and finding that is the front-office
decision the panel was flattening into a salary bump.

Bisect salary on the **$100K grid** the slider and typed field both snap to (a
suggestion the controls cannot express is not a suggestion); scan guarantee in
whole percent for the same reason; **scan** term rather than bisecting, because
term is not monotonic in either direction — moving toward his preferred term
lowers his asking price and moving away raises it, so both a longer and a shorter
deal can be the answer. Pick the term that wins with the smallest change to what
is on the table.

Rank the three by cash committed over the deal, ties toward the move that commits
none. Guarantee usually wins that test, and it is not a free lunch — it becomes
signing bonus, which prorates, which is real dead money on a cut. **Print the
dead money beside the chip.**

Answer for the **player**, not for your cap sheet: whether you can afford the
suggestion is the ledger's question and the panel already answers it twice the
moment a chip is pressed. Keep this out of the main decision function and call it
from a memo keyed on the offer — it costs on the order of a hundred evaluations,
and the decision function runs once per animation frame.

### 5.7 The meter and the server are ONE gate

This is the most expensive single lesson in this part. Build the gate as a
**three-term** object and make the browser decision subtract exactly what the
server gate adds:

```
gate = {
  capMode,
  capSpace,                   // the club's room, off the SAME summary function. NEGATIVE when over.
  capCreditBack,              // the hit on the deal this one replaces or absorbs. 0 on the open market.
  capAcceleratesOnReplace,    // the stranded bonus the old deal leaves IF this replaces it. See below.
  minSalary, maxSalary, maxYears,
  rival,                      // a whole RivalBid { teamName, offer } or null
}

capDelta = year1CapHit − gate.capCreditBack + gate.capAcceleratesOnReplace
blocked  = capMode !== 'OFF' && capDelta > 0 && capDelta > gate.capSpace + CAP_GATE_TOLERANCE
```

and on the server, for the same offer:

```
append  branch:  delta = newHit − oldHit
replace branch:  delta = newHit + stranded − oldHit
```

Those are the same inequality by construction. Three ways the reference
implementation broke it:

**Keep `capSpace` and `capCreditBack` as two numbers.** Folded into one, the
**sign** of the change is invisible at the place that has to test it, and the
sign is what decides: over the cap `room` is negative, so an extension that
*lowered* a man's hit by $9.56M still failed `−9.56M > −12.0M` and was refused —
with the panel beside it printing the saving. Measured on 20 clubs put $12.0M
over: **3,803 of 3,990** offers that lower or hold the club's commitment were
blocked.

**Carry `capAcceleratesOnReplace`, and set it on exactly one shape.** Zero on
the open market, zero on an extension, zero on any deal that appends — all of
those either have no old contract or carry the unamortised bonus forward. It is
non-zero only on a **walk-year re-sign**, where the deal has run out, the
re-sign takes its replace branch, and the bonus no season ever billed
accelerates as a `CapCharge` the instant the new deal is signed. Measured on a
3-year deal with two void years and $18.0M of bonus, fully played:

```
the meter said the re-sign added   $833K
the server charged                 $8.03M
the difference                     $7.20M — the whole stranded bonus
```

With the club's room squeezed between the two, the panel showed **no cap block
at all** and the submit came back *"Re-signing blocked by the salary cap — adds
$7.97M against $4.43M of room"*: **a refusal quoting a figure the screen beside
it had never shown.** That is the lying metric in the one place it costs a save
— a GM planning his re-signs against a number the game does not charge.

**Carry `capDelta` on the decision; never let a screen reassemble it.** A panel
drew "Cap space after" as `gate.capSpace − year1CapHit`, which was right only
while `capSpace` had the incumbent's hit folded in — and stopped being right the
day the credit was split out. After that it charged the club the whole new hit
against room that no longer contained the old one. Measured, on a man carrying a
$22.8M hit with two years left, extended at $24.0M/yr for three more, at a club
with $72.7M of room:

```
"Cap space after" on the panel      $61.2M
the ledger, after actually signing  $84.0M
wrong by                            $22.8M   — his whole cap hit
```

and wrong in the direction that stops a GM making the move: the extension
**frees $11.3M** and the panel showed it costing $11.5M.

**Build the contract the offer actually produces, keyed on his CONTRACT and not
on the screen.** When he is still under contract that is the existing deal with
years appended — remaining salaries untouched, unamortised bonus carried — not a
hypothetical fresh contract. A flag keyed on "is this the extension screen"
quotes a year-1 hit of a contract the signing does not write. Both halves
measured on a man with one season left at $7.70M: the fresh-deal preview reads
**$5.73M** and the appended row that actually lands is **$9.76M**.

**Read `voidYears` back off the built contract, never off the raw slider.** Both
builders clamp the request down to what the deal can amortise, and pricing the
panel off the slider position puts a number on screen the contract written
moments later does not carry.

**Quote the stranded void figure from the shared function.** This line has been
pulled back onto one function twice: first it was the five-year ceiling written
out again in a second file against the raw slider, then it was the whole
stranded-bonus formula written out again beside it.

**Clamp the offer with one pure function, on both sides.** Typed number fields
can hold things a slider cannot — empty, negative, `1e9`, `NaN`, letters — and
the two sides must agree about what such a thing *means*, not merely both
refuse it:

```
clampOffer(offer, gate) = {
  apy: round(clamp(finite(offer.apy) ?? gate.minSalary, gate.minSalary, gate.maxSalary)),
  years: round(clamp(finite(offer.years) ?? 1, 1, gate.maxYears)),
  guaranteePct: clamp(finite(offer.guaranteePct) ?? 0, 0, 1),
}
```

The owner asked for the typed fields: *"on the contracts, allow us to type in
the numbers in case the sliders aren't granular enough."* Export the clamp so
the invariant sweep can generate the widened state space typing opens up and
check the clamp is closed under it.

**Turn the guarantee slider into a real contract shape, in one place:**

```
contractShapeFor(offer) = { bonusPct: min(0.57, 0.12 + guaranteePct * 0.45), guaranteedPct: guaranteePct }
```

The bonus floor is 12% at a zero guarantee, so even the meanest offer hands over
cash the club cannot claw back — store that as the guarantee rather than letting
the panel print "$0 guaranteed" over it.

**Keep the structure controls out of the evaluation entirely.** Escalation, void
years and the conversion share change what the deal does to your books, not what
it pays him. The player does not judge them.

**Refuse in this order, and make each refusal name its own owner:**

1. `FLOOR` — under the league minimum. Ledger's refusal; costs nothing.
2. `TERM` — outside `[1, gate.maxYears]`. The **rulebook's** refusal. On an
   append, `maxYears` is already the league ceiling minus the years he is owed,
   so say so: "He is already signed for N years, and no contract may run past
   12 — M more is the most you may add."
3. `WILLING` — `committedTerm > ctx.willingYears`. **His** refusal, absolute, and
   on screen beside the term control before anybody drags it. Money does not
   move this. Key the sentence on the **mode**, not on "is this appending": the
   test folds in owed years only on an extension, so a re-sign sentence that
   counted his walk year states a limit the block does not enforce.
4. `CAP` — the three-term test above. Ask the two questions in the gate's order:
   does this add money at all, and if so does it fit. A club already over the cap
   may still sign anything that costs it nothing more — that is how a save that
   has gone wrong is dug out of the hole, and refusing it is what trapped one.

Word the cap refusal off what it **adds**, not what it costs, and say where the
club stands: "This adds $X to this season" when there is a credit, else "Year 1
costs $X"; then "against $Y of room" or "and you are already $Y over the cap"
("−$8.2M of room" is not a sentence anybody reads twice). Then name the ways
out, and only the ones that exist: at the league minimum there is nothing left to
lower, so the only route is room; on a deal that appends, say so when there is
still convertible salary left — "clear space, lower the deal, or push more of the
$Z he is still owed this season into the bonus" — because that control is on the
same screen and moves year one without changing a dollar of what he is offered.
An offer already converting 100% has no third option and being told it had one is
worse than the shorter sentence.

**Charge patience only for refusals the PLAYER made.** A deal that busts the cap
or breaks the term limit never reached him and costs nothing. Being outbid is his
refusal — his agent still had to take your offer to him to find out — and is
charged like one. An insult costs **2** pips, any other player refusal **1**.
Carry both `patienceCost` and `maxPatienceCost` on the decision, because the
button label states the price and the server charges it, and inside the band the
label must print the **max** or it leaks the hidden draw.

**Write the reason line without consulting `wouldSign`.** The reason is rendered,
so it may only depend on things the user may know; writing it only when the offer
will be refused leaks the draw straight onto the panel — the band says "he might"
while the presence of a sentence underneath quietly tells you the answer. Make it
null only when he is a certainty, which the meter already says out loud. Inside
the band say: "His agent will not say either way at this number. It might get
done — and finding out costs a pip if it does not."

### 5.8 Persist patience on the server, and nowhere else

Three rules, in one place, so they can be checked against each other:

- **READ** is free and creates nothing. Opening the panel writes no row.
- **CHARGE** upserts, and only on a refusal the player made.
- **PRUNE** runs on every charge and drops this league's rows from earlier
  league years. A new league year is a new negotiation — new asking price, new
  market, fresh pips — so those rows can never be read again and leaving them
  grows the table forever.

Never take the count from the client. The reference implementation accepted a
`patienceSpent` argument from the browser; a reload sent zero and zero was
indistinguishable from an honest zero, so the loss condition and the entire cost
of a lowball were **defeated by F5**.

Clear the patience row whenever his name goes on a deal (sign, re-sign, extend)
and when the league year rolls over. If he is later cut and comes back onto the
market, that is a genuinely new negotiation and it starts with a full set of
pips.

Add a fourth write if you have a "set aside / not now" control on the re-sign
list: set or clear a `dismissedAt` and touch **nothing** else. It is not a
negotiation event — it costs no pips, it does not reach the player, and the
decision function has never heard of the column. Let it expire with the league
year and name whoever is still parked when the window closes in the advance
warning.

### 5.9 Fingerprint the session, and refuse rather than re-price

The client decides against the session it was handed at page load; the server
re-resolves from the database at submit. Usually identical — but an AI wave can
move a rival's cap space, or a trade can move yours, in between. When that
happens, **refuse, hand back the fresh session, and let the meter say so**.
Quietly applying the new terms means the user acted on a meter describing a
different negotiation.

Fingerprint: player id, personality, reservation price, desired years, desired
guarantee, guarantee floor, patience ceiling, re-sign window, mode, season year,
control years, willing years, intended final age, band width, the deal being
extended (`years/yearsRemaining/signingBonus/baseSalaries`), **all three** cap
gate terms, min salary, max years, the **whole** rival package
(`name/apy/years/guaranteePct`), `clubDiscount`, and the suitor's id and number.

Do **not** fingerprint `patienceSpent`. It is a ledger, not a term: it never
changes the answer and it necessarily differs between the session the client
holds and the one the server resolves the instant an offer is charged. In the
fingerprint it makes every second offer refuse itself as "the terms moved".

Include the whole rival package rather than its headline, because the player
scores it now — a rival who dropped a year or moved his guarantee has changed
the contest the meter was describing every bit as much as one who raised his
bid. Include `clubDiscount`, because it is what the rival is priced against.

### 5.10 Confirm from the row that landed

Read the signed deal **back off the contract row that now exists**, priced with
the same functions the cap page prices it with. Never confirm the staged
figures. The client's offer went through a clamp, a contract builder, a bonus
split and possibly an append onto an existing deal, and the server may have
applied a structure the panel never saw — confirming what was staged is the
easiest lying metric in the game to ship and the hardest to notice, because it
only differs in the cases nobody checks.

The owner asked for the moment: *"once a contract is signed - free agent, re
sign or extension - we need some sort of visual feedback that the signing is
done."*

Carry on the confirmation: the contract's **own** length, its total value off
the stored bases and bonus, the **new-money** value, **how many of those years
were just bought**, the APY he agreed to, the guarantee, this season's charge,
and cap room before and after (both from the same summary function, measured
before the write). Without the bought-years count the card printed
**$6.43M/yr** and **$34.82M over 5 yrs** side by side under "Per year" and
"Total value" — figures that do not multiply out, because 4 years were bought
and the fifth was already owed. Mode cannot stand in for it: a walk-year
re-sign appends and is not an EXTENSION.

Report "you beat somebody" only when somebody was bidding **and the man chose
you over them** — i.e. the contest's own `outbid` is false. The old test was
`offer.apy > competingApy`, so a deal won on guaranteed money reported no rival
beaten at all.

### 5.11 Run the last-second contest on the write path too

Between resolving the session and writing the deal an AI club can move, and if
it has, the player leaves with them. That is the drama of an open market and the
user's click may not override it. Run the same contest — the same context, the
same scoring — not a second, blunter one: the reference implementation had
`competing.apy > opts.apy` on the signing path, so a deal the meter had
legitimately won on guaranteed money reached the signing path and was thrown out
at the door for paying less per year. The identical contradiction, one screen
further on, and far harder to see because it fires only on the offers the new
model exists to allow.

When the rival wins, **sign the player to the package the panel quoted** — the
term and guaranteed share the rumour was built from — not a fresh guess at it.
Changing what a club offers must change both, or the club that beat you signs a
contract the user was never shown. If the rival cannot actually close it (its own
cap refuses), swallow that and leave the player on the market.

Charge a losing submit like any other refusal rather than ending the negotiation
outright. Offering a dollar under the rival's number and losing him on the spot
read as brutal and, worse, made patience meaningless for exactly the players
patience is for: with a rival at the table every negotiation was a single shot.
His agent takes your offer, shops it and comes back; you lose him when the pips
run out, which the panel has been counting down in front of you the whole time.
When patience runs out on the open market, hand him to the leading rival **for
real**.

### 5.12 The AI's own bidding

Run one sealed-bid wave per free-agency week (`FREE_AGENCY.WEEKS = 3`), and keep
the market open all year (§5.13).

**Price what each man will take once per pass, not once per club.** The wave
asks the same question up to thirty-one times per free agent and the answer does
not depend on who is asking, so build a book:

```
marketContextFor(fa, seasonYear):   // the man as the MARKET sees him
  ask = askingPrice(fa)
  build the context with: marketApy = trueMarketApy = ask, incumbent: false,
    teamStrength: 0.5, yearsWithTeam: 0, competition: 0, mode: 'FREE_AGENT',
    rng = Rng(`nego-${fa.id}-${seasonYear}`)

aiDealFor(fa, seasonYear, term?):
  years        = max(1, min(term ?? suggestedYears(fa.trueOvr, fa.age), ctx.willingYears))
  guaranteePct = max(AI_GUARANTEE_PCT, ctx.guaranteeFloor)        // AI_GUARANTEE_PCT = 0.45
  floor        = max(MIN_SALARY, round(leastAcceptableApy(ctx, years, guaranteePct) ?? ctx.reservationApy))
  -> { years, guaranteePct, floor }
```

Seed the context on the **player and the league year only** — not the club. His
personality, the years he wants and the wobble on his price are facts about
*him*: a floor the wave enforces and a meter the user's panel draws cannot be
about two different men and still be one acceptance model. Everything a club
changes is already priced separately in `clubDiscount`.

Set `teamStrength` to the league average here, for the same reason the rival view
uses a neutral price: the wave is thirty-one clubs, not one, and the honest
default for a club nobody is being shown is the middle. Set `competition` to 0 —
the auction **is** the competition and it is settled by the highest bid, so
charging him a premium for it as well is the double-count §5.3 forbids.

**Raise the guarantee to his floor.** The floor caps interest below the band for a
deal with less locked in than he will accept, so an elite man offered a flat 45%
has refused the **structure** and no salary closes him. A club that wrote him
that contract anyway — which is what every AI signing did — was signing a deal
the user's own panel says is unsignable. State the `?? reservationApy` fallback
rather than asserting non-null, so a future change to the interest caps cannot
turn into free players.

Make `AI_GUARANTEE_PCT` the contract builder's own default rather than a knob
invented for the panel, and export it: a rival's guarantee is a term the player
**scores**, so what a rival locks in decides contests, and a constant the panel
invented would be a lying metric. It must be checkable against the contract the
wave actually writes.

**Budget, separately from acceptance:**

```
maxOffer(p, { profile, needs, capSpace, rng }):
  market  = askingPrice(p)                       // not marketValue
  need    = needs[p.position] ?? 0
  overpay = 1 + (FA_MAX_OVERPAY − 1) * (profile.aggression * 0.6 + need * 0.4)    // FA_MAX_OVERPAY = 1.22
  noise   = 1 + rng.normal(0, 0.08)
  return min(market * overpay * noise, max(0, capSpace − AI.CAP_RESERVE))         // CAP_RESERVE = 4_000_000
```

This is a **budget**, not an acceptance test. The two used to be tangled — the
wave compared a bid against its own `market * 0.85` — and untangling them is why
a club can now bid its whole budget on a man and still be told he would not sign
it. Price it off the discounted ask, or the AI volunteers money nobody is asking
for and the board's number drifts from what the AI pays.

**One implementation of the walk down a club's board.** Two things ask the same
question and may never answer it differently: what a club actually bids this
week, and whether the club a negotiation panel names as chasing a player would
in fact get to him. Share the whole walk and differ **only in the seed** —
the wave draws from the wave's own rng, the rumour from a stable
`fa-bid-<player>-<team>` seed, so a panel re-read on every keystroke returns the
same club at the same number while a wave rolled twice in one offseason does not.

```
bidderState({ roster(worst-first), needs, capSpace, capMode, rosterMax, rookieReserve, maxDisplace }):
  budget           = max(0, capSpace − AI.CAP_RESERVE)
  openSlots        = max(0, rosterMax − roster.length − rookieReserve)
  displacesLeft    = maxDisplace ?? MAX_DISPLACE_PER_TEAM_PER_WAVE        // 2
  worstAtPosition  = first hit per position, with frees = capSavingsOnCut(his contract)
  countAtPosition, alreadyDisplaced

planTeamBids(board, state, price, deals):
  rank board by needs[position] desc, then trueOvr desc
  for each man:
    stop if (openSlots <= 0 && displacesLeft <= 0) or budget <= 0
    if openSlots <= 0:
       worst = worstAtPosition[position]; skip if none or already displaced
       skip if fa.trueOvr − worst.trueOvr < MIN_UPGRADE_DELTA                    // 5
       skip if countAtPosition[position] <= ROSTER_TARGETS[position].min
       displace = worst
    else if needs[position] <= 0.15: skip                                        // no need, no upgrade case
    offer = price(fa, budget + (displace?.frees ?? 0))
    skip if offer < MIN_SALARY
    skip if offer < deals[fa.id].floor
    commit: budget -= offer − freed; spend a slot or a displacement
```

**Let a club at a full roster still bid, on an upgrade.** Skipping every club
with no open slot reads reasonable and is a permanent sink: at a steady-state
roster of 50–52 essentially every club is excluded every week, so nobody bids on
anybody. Measured over 13 simulated seasons the unsigned pool grew **140 →
4,411** and ended holding **593 players rated 80+ and 151 rated 90+** — including
97s — in a 32-club league, while league-wide signings fell to single digits a
year. A real front office at a full roster does not stop reading the wire; it
signs the better player and releases the man he beats. Run the displaced man's
release through the ordinary cut path, dead money and all, and the signing
through the ordinary gate.

Make "who may be displaced" **structural**, not a rating threshold: only the
worst man at the position, and only while that position still carries more
bodies than the roster spec asks for. An absolute "never displace anyone rated
above 74" stopped working the moment league-wide ratings moved — every roster
spot sat above the line, so no upgrade was ever legal.

**Apply the signing floor before committing budget.** The price is capped at
what the club can afford and the resolution throws out anything the player would
refuse, so a club facing an unaffordable free agent bid its **entire** remaining
budget on him, had it rejected, and then broke on an exhausted budget without
signing anyone. Because the board is sorted best-first once needs flatten,
every club in the league did this to the same unaffordable player every week:
measured, **17 signings league-wide** in the final year of a 13-season run while
**350 free agents rated 80+** sat unsigned.

**Reserve roster spots for a draft class only when one is coming.** During free
agency the draft lands immediately after, so filling to the maximum just means
cutting the same players again on cut-down day; reserve
`ceil(draftRounds * ROOKIE_ROSTER_HIT_RATE)` with `ROOKIE_ROSTER_HIT_RATE = 0.5`.
A club shopping in October has no class to hold spots for and passes 0 — make
that the caller's number, not a constant read inside. Reserving a **full** class
leaves an effective ceiling of exactly 46, which is the roster minimum, so every
club at or above the legal minimum skips free agency entirely and the market
shuts down league-wide the moment roster sizes recover.

**Make a bid a pure function of the matchup and the board, with no RNG in the
wave.** The reference implementation drew the wave's bids from one rng while the
rumour drew the same club's bid for the same man from a stable seed — two draws
from one distribution are still two different numbers, so the panel's "nobody is
circling" was a forecast of a **different roll** than the one the wave would
make, and wrong in the one direction that claim may never be wrong in. Measured:
two of the top forty free agents reported as uncircled, **signed by the very next
wave**.

**Answering "is anybody bidding" needs three gates, all of them the wave's
own** — and the honest answer is often no. The reference implementation scanned
all 31 clubs and returned the best offer from any whose need at the position
cleared 0.15; across 31 rosters somebody always scores over 0.15 somewhere.
Measured: of the top 40 free agents in a real league, **38 carried a competing
bid**, and both exceptions were punters. Every position that still exists had a
guaranteed rival, in every league, in every week. A market is crowded at the top
and thin underneath, and it thins further as the window runs and clubs spend
their room and their roster spots. So:

1. **He is on the board.** The wave only looks at the top
   `WAVE_BOARD_SIZE = 140`. A man below that line is genuinely never bid on, and
   saying "nobody is circling" about him is a fact rather than a threshold.
   (Insert an incumbent as the hypothetical entrant he is — the re-sign rumour
   has always been "if he reached the market".)
2. **They reach him.** Walk each club's own board in its own order, spending its
   real slots and real budget on the men it wants **more**, priced at what that
   club would really bid at the stable seed. If it runs out of either before it
   gets to him, it is not chasing him whatever its need score says. This is what
   makes an elite player universally wanted and a 67-overall backup guard,
   sitting behind eleven better guards on everybody's board, ignored.
3. **Their number is a real bid** — it clears his floor from the same deal book.
   A club named at a number the wave would discard is a rumour about nothing.

Price the men **ahead** of him at what the club would really pay, not at the
cheapest bid that could possibly count. "Err toward yes, they would be there" is
half right and the missing half is **roster slots**: a club priced cheaply
affords more of the men above him, spends its openings on them, and never
reaches him — so generous pricing produces false **negatives**. Measured: a
71-overall receiver the panel reported as uncircled was signed by the very next
wave.

Put **no need pre-filter** outside the board walk. It was subtly wrong in both
directions: over 0.15 it let through clubs that would never have reached him;
under it, it excluded the club that would have signed him anyway, because a club
with no open slot bids on an **upgrade** regardless of need. Measured on a fresh
league, the wave signed **seven of the top forty** free agents the need test had
ruled out entirely. Apply the need test inside the board walk, exactly where and
only where the wave applies it.

**Attach the evidence to the rumour.** A club is only ever named out of one of
those gates, and the two figures beside its name must be the two its own AI bid
on: the room it really has (off the same cap summary) and the need it really has
(off the same needs function). That is what stops "Chicago is interested" from
being decoration — you can go and look at Chicago. Carry the **term** and the
**guaranteed share** off the signing path too, not chosen for the panel, because
the player scores the whole package.

Exclude this year's draft class (`isDraftee`) from the wave. Without that, AI
clubs signed undrafted prospects off the board before the draft ever happened,
quietly draining the draft pool.

### 5.13 Keep the market open all year

`runAiFreeAgencyWave` called from one place means that from the moment a league
reaches preseason nothing in the game can sign a free agent to an AI roster until
the next offseason — a player released in April is unreachable for a full
calendar year no matter how far his price has fallen. That is half of why elite
players pile up; the other half is the price never falling, and fixing either one
alone changes nothing.

Run the same machinery much more quietly in-season:
`WEEK_CHANCE = 0.5`, `MAX_CLUBS_PER_WEEK = 2`, `MAX_SIGNINGS_PER_CLUB = 1`,
`NEED_FLOOR = 0.35`, `BOARD_SIZE = 60`, `MAX_DISPLACE = 1`, and one-year deals
(price the floor for the term actually offered — a year is not free). Most weeks
nobody signs anybody, and the clubs that do are the ones with the worst holes. A
bargain veteran is exactly the sort of thing the GM should get a shot at, so make
the AI deliberately slow. Know what the need floor actually excludes: measured on
a save at a season's end, **29 of 31** AI clubs cleared 0.35, because injuries
push somebody below a positional minimum on nearly every roster. What keeps the
in-season market small is the clubs-per-week cap; the floor is the sanity check
underneath it.

**Top the pool up to a floor, and know that it mints nobody after year one.**
`POOL_FLOOR = 260` at league creation and at the top of every offseason's free
agency — sized against 32 × 53 = 1,696 roster spots plus roughly a sixth again
unsigned. From the second offseason on, the league's own expiring contracts and
undrafted rookies carry the pool well past it (measured 300–470), so the top-up
does nothing.

**Drain the pool, or it grows without bound.** Roll attrition on a player who
spent a whole league year unsigned: `UNSIGNED_ATTRITION_BASE = 0.42`, plus
`0.18` per further year, capped at `0.85`. Ordinary retirement cannot do this
job, since it does not start until 32 and most of the annual inflow is
22-year-old undrafted rookies. Give unsigned players half a year's development
roll (`UNSIGNED_PROGRESSION_SCALE = 0.5`) — still training, no coaching staff, no
scheme, no snaps.

**State the quality shield RELATIVE to the league's own mean active rating**,
not as an absolute: shield fully at `mean + 8`, scale linearly to full strength
at `mean − 10`. Fixed at 78/55 the shield stopped meaning "star" the moment
league-wide ratings drifted — by season 13 of a measured run the mean rostered
player was 80, so every unsigned player worth anything was permanently immune
and the pool accumulated **459 unsigned players rated 80+**, the exact symptom
attrition exists to prevent. A threshold on a drifting scale is not a threshold.

**Cap what a roster-minimum fill can buy.** The path that fills a short-handed
club is the one signing path that never asks whether the man would accept, so a
short-handed club could buy the best free agent in football for the league
minimum — and did: the market went **91 players to 15 in a single step**, top man
**85 OVR to 57**, before the user ever saw the screen. Admit only men whose
`askingPrice` is at or under `FILL_MAX_MARKET_MULT = 1.5 × MIN_SALARY`, and fall
back to the cheapest man available rather than leaving a club illegal. Use the
**same** constant for the user's "fill roster" button so a human cannot buy a
body a CPU club could not; the two may differ in what they pay inside the tier
(the AI's recovery fill offers a flat minimum, the user's button pays each man
his own ask) but not in what they can reach. Use 1.5x rather than 1.0x because
the market floor and the $100K rounding make an exact-minimum filter admit only
the men the curve has bottomed out on — a thin, arbitrary slice that empties the
moment a couple of clubs fill. Measured, 1.5x admitted bodies up to about 70 OVR
at RB and 68 at LB, and nothing any club would field as a starter.

---

## 6. Trades

### 6.1 Quote everything in one currency, and make it a currency a football person can check

Price players and picks on **one scale**, and make that scale the draft-pick
chart's own points, so "this man is worth 420" means "this man is worth pick
48". Transcribe the Jimmy Johnson chart as a **literal 224-row table** (32
clubs × 7 rounds maps one-to-one with no rescaling), not as a fitted curve.
The owner named it: *"this is a chart of draft picks value as used by the NFL."*

A smooth curve cannot do this job: the real chart puts pick 1 at **5.1x** pick
32 and **68x** pick 128, while `3000 * exp(−0.0255 * (pick − 1))` puts them at
**2.2x** and **15x**, and its ratio to the table drifts (0.55 at pick 16, 0.69
at pick 112, 2.0x too generous at pick 176). That is why the first overall pick
used to trade for barely more than a mid-first.

Delete any flat conversion factor between players and picks. The reference
implementation had `pickValue = chart * 0.30`, marked `[FRAGILE PLACEHOLDER]` —
a factor nobody could state in football terms, sitting between the two halves of
every trade.

Row one of the table, for reference: `3000, 2600, 2200, 1800, 1700, 1600, 1500,
1400, 1350, 1300, 1250, 1200, 1150, 1100, 1050, 1000, 950, 900, 875, 850, 800,
780, 760, 740, 720, 700, 680, 660, 640, 620, 600, 590`; the last pick of the
chart is 2. Clamp the index rather than returning undefined — a league with more
teams than the chart has rows would otherwise price its last round at NaN, and
the honest answer for a pick past the end is what the last pick on it is worth.

### 6.2 Bend the top of round one onto the player curve — the anchor

**The climb of round one is an auction price, not a player price.** The table is
what one pick costs in **other picks**. Using it for both is what lets a single
high first outbid the best receiver in the league.

Measure it rather than asserting it. A pick is a right to add one player, so the
yardstick is: what is the man it turns into worth, priced by the same curve that
prices everyone else? Generate 400 draft classes, rank each on the public board,
take the prospect who actually sits at slot *n*, develop him all the way to his
own potential, stand him at 26 in the last year of his rookie deal — his **best
case**, bust risk spent and fog gone — and price him:

| pick | 1 | 2 | 3 | 5 | 8 | 12 | 16 | 20 | 24 | 28 | 32 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| chart | 3000 | 2600 | 2200 | 1700 | 1400 | 1200 | 1000 | 850 | 740 | 660 | 590 |
| best case | 1829 | 1638 | 1508 | 1332 | 1117 | 972 | 855 | 830 | 711 | 662 | 605 |
| ratio | 1.64 | 1.59 | 1.46 | 1.28 | 1.25 | 1.23 | 1.17 | 1.02 | 1.04 | 1.00 | 0.98 |

and in rounds 2–4: **0.98, 0.96, 0.89, 0.89, 0.88** at picks 36/40/48/56/64.

From the bottom of round one down the chart sits at essentially **1.00** of the
most a pick can ever deliver — which is why every player-for-pick anchor comes
out right. Climb the round and it pulls away monotonically until the first
overall pick is priced **64% above the best outcome it has**. Whatever bias the
best-case yardstick carries, it carries **equally at every slot**, so the flat
1.00 tail is the calibration and the climb away from it is the defect.

**The anchor, in one sentence a football person can check: the first overall
pick is worth the best proven non-quarterback in the league, and never more.** A
top pick is a 22-year-old a board likes; a 96 receiver is that man already, with
the fog gone. What the pick buys over him is five cheap years; what he buys over
the pick is certainty; at the very top those roughly cancel.

```
PICK_SCALE.KNEE = 600                                   // the 31st pick
PICK_VALUE_CHART(overallPick):
  raw = table[clamp(round(overallPick), 1, 224) − 1]
  if raw <= KNEE: return raw
  span = TIER_CURVE.PREMIUM.ceiling − KNEE
  return KNEE + span * (1 − exp(−(raw − KNEE) / span))
```

Read the asymptote **off the premium tier's own ceiling** rather than typing it
again — one opinion about where the top of this economy is, not two. The first
overall pick lands at **1797**, which is what a neutral 96 at a premium position
is worth.

Make it a **bend, not a cap, and not a rescaling**. Below the knee the table is
returned bit for bit: picks 31 through 224 — the whole of the chart real trades
have tested — are untouched to the point. Above it the excess is compressed onto
the gap to the asymptote, continuously, with gradient exactly 1 at the join,
strictly increasing everywhere and never reaching the bound. The #1 pick still
out-prices the #2 and always will; it just stops out-pricing the league.

Set the knee at the highest point where the measured ratio is still flat (picks
28–32 read 0.98–1.04): bending a region that is already calibrated invents a
defect to fix.

Leave everything below round one alone, and say so rather than half-fixing it.
The measurement has an opinion there too — the chart runs **under** the best case
from pick 48 on (0.88x) and far under it in round seven — but that is a different
claim needing different evidence, no real trade tests it, and it has no bearing
on the bug this bend exists to fix.

### 6.3 Price a player: tiers, arcs, contract, fit, window, cap, scarcity

```
base  = min-free: (exp(max(0, ovr − replacementLevel) * steepness) − 1) * scale
total = (base + upside) * ageMult * contractMult * fitMult * scarcityMult * capMult
total = total * noiseMult
total = softCeiling(total, ceiling)
total = total − contractBurden          // LAST, outside the ceiling and outside the noise
```

**Tiers** (`TIER_CURVE`):

| tier | replacement | steepness | scale | ceiling | positions |
|---|---|---|---|---|---|
| QB | 58 | 0.150 | 12.70 | 5000 | QB |
| PREMIUM | 60 | 0.147 | 9.90 | 2100 | WR, LT, LG, C, RG, RT, EDGE, DT, CB, S |
| MID | 62 | 0.147 | 7.00 | 1500 | TE, LB |
| LOW | 64 | 0.147 | 5.44 | 750 | RB |
| MINIMAL | 68 | 0.135 | 0.494 | 40 | K, P |

Calibrate against **real trades**, and write each anchor as a sentence you can
read aloud:

- **QB** 94 ≈ 2799 (half again the first overall pick), 96 ≈ 3796, 98+ clips the
  ceiling at five mid-firsts and more. The owner's anchor: *"Josh Allen in the
  real nfl would go for at least 4 or 5 first round pick equivalents."* 91 ≈ 1783
  is the Stafford package (two firsts and a third); 85 ≈ 716 a late first.
- **PREMIUM** 94 ≈ 1457 (pick 4), 96 ≈ 1957 — above any pick there is, which is
  the point of the bend. Mack cost two firsts and a third against a second coming
  back (~1765); Tunsil two firsts and a second; Hill a first, a second and three
  later picks (~1205); Ramsey at 24 two firsts and a fourth (~1640). 88 ≈ 597 is
  a late first — what a Pro-Bowl receiver, tackle or corner actually fetches;
  82 ≈ 241 a third; 78 ≈ 130 a late third.
- **MID** 94 ≈ 766 (pick 22), 88 ≈ 313 (a late second). Hockenson cost a second
  and a third, Waller pick 100, Roquan Smith a second and a fifth.
- **LOW** 94 ≈ 442 (a mid second), ceiling 750 = the McCaffrey package itself (a
  second, third, fourth and fifth ≈ 713). 90 ≈ 243, a third.
- **MINIMAL** 99 ≈ 32 (a fifth), 94 ≈ 16 (a sixth). Never zero, never a real
  asset.

**Share one steepness across PREMIUM/MID/LOW (0.147)**, and put the economics in
`replacementLevel` and `scale`. Curves with their own steepness made the gap
between tiers swing with rating — an older pass had PREMIUM at 5.5x MID at 78 and
2.4x at 94 — so the same relabel was worth wildly different amounts depending on
who you did it to. One steepness makes the positional gap a stable multiple. Keep
QB steeper (0.150), because quarterback scarcity genuinely compounds at the top,
and MINIMAL flatter (0.135), because the best kicker alive is still a kicker. The
ordering QB > PREMIUM > MID > LOW > MINIMAL must hold at **every** rating from 60
to 99: in the reference implementation that is about 1.9x PREMIUM and 3.6x MID at
equal rating, widening to 2.4x / 3.3x at the very top — a clear margin for the
most valuable job in the sport, and nothing like the **18.3x** the old table
charged at rating 88.

**Tier by CONVERSION COMPONENT, not by position, and check it mechanically.** If
your game lets a player change position for free (or for a rating cost the model
charges), then any two positions a man can move between must take the **same**
tier, or relabelling him is free money. Resolve the offensive line **up** (centre
is paid 0.79 and sits at PREMIUM because it travels with left tackle at 1.29) and
resolve the secondary **up with it** (corner is paid 1.24, third-highest in the
game behind only EDGE 1.47 and LT 1.29, above DT 1.11 and RT 1.09 which are both
PREMIUM). The reference implementation filed the secondary at MID because corner
travels with safety at 0.77, and the owner's screenshot caught the result: a
rebuilding club with $63.2M of room and a severe hole at corner refused a
92-rated 25-year-old with six years of control for one projected top-ten pick. At
MID a 92 corner based at **569** against a 92 receiver's **1083** — 0.53x for a
position the game's own pay scale rates at 0.98x of the receiver. Against real
trades the gap is the same size: a 94 at MID priced 766 while Ramsey cost about
1640. Safety rides up with corner exactly as centre rides up with left tackle,
and S at 0.77 is a shade under C at 0.79, so it is the same claim applied
consistently. The football agrees: Fitzpatrick went for pick 18 and Adams for two
firsts and a third, and at MID neither trade was purchasable at any rating.

**Age arcs are a separate table from trade tiers**, and must *also* be constant
across a conversion component (an age multiplier is part of a man's price, so
keying arcs per-position reopens the arbitrage in the age dimension — measured, an
old left tackle relabelled a guard priced at 1.10x mean and **2.49x** at worst,
purely by escaping the receivers' decline curve):

| arc | declineStart | per year | youth under | youth per year | positions |
|---|---|---|---|---|---|
| QB | 34 | 0.035 | 26 | 0.025 | QB |
| SPEED | 29 | 0.075 | 25 | 0.035 | WR, CB, S |
| STURDY | 30 | 0.06 | 25 | 0.03 | LT, LG, C, RG, RT, EDGE, DT, LB, TE |
| BACK | 26 | 0.12 | 24 | 0.05 | RB |
| SPECIALIST | 33 | 0.02 | 26 | 0.012 | K, P |

Bound the final age multiplier to `[0.2, 1.4]`. The three cases the tier-keyed
lookup split down the middle, where the constraint and the football agree: the
whole line is STURDY (left tackle ages **best** in football, not like a
receiver); the whole EDGE/DT/LB front is STURDY; both defensive backs are SPEED
(corner is the most speed-dependent job after running back, and the component
takes the corner's arc).

**Contract: a surplus MULTIPLIER and a burden SUBTRACTION. They are not the same
number.**

```
expectedApy   = marketValue(p)
yearsLeft     = max(1, yearsRemaining)
actualAnnual  = remainingValue(contract, mode) / yearsLeft
controlFactor = clamp(yearsLeft / CONTRACT_CONTROL_YEARS_FULL, 0.25, 1)        // FULL = 4
surplusFrac   = clamp((expectedApy − actualAnnual) / max(expectedApy, 1), 0, 1.5)
contractMult  = clamp(1 + surplusFrac * controlFactor * 0.55, 1, 1.30)         // WEIGHT 0.55, MAX 1.30
overMarket    = max(0, actualAnnual − expectedApy − 2_000_000) * yearsLeft     // FAIR_BAND per year
burden        = (overMarket / BASE_CAP) * 900                                  // BURDEN_PER_CAP_YEAR
```

A multiplier can never price a bad contract, and this is why: `base` is surplus
over **replacement level**, so a replacement-level man is worth exactly zero
before any multiplier runs, and zero times a negative is still zero. The measured
case: a 62 corner owed **$135.4M over five years** priced at **1.0 point** (a
`max(1, total)` floor) and **thirty of the league's thirty-one clubs took him for
nothing, and thanked you for it**. No stack of multipliers could have said
otherwise, because there was nothing to multiply.

So subtract the deficit **in dollars**. What an overpay costs a club is the cap it
can no longer spend, and that is the same money whoever is being overpaid — $60M
above market on a franchise quarterback and $60M above market on a special-teamer
are the same $60M hole. It does not scale with the man, so it is not a multiplier
on him. Keep the surplus side multiplicative, because a cheap deal genuinely **is**
worth more on a better player: a rookie contract on a star is the most valuable
asset in the sport and the same discount on a backup is worth nothing.

The exchange rate, anchored in one checkable sentence: **burning a full season's
cap on a man who gives you nothing costs about what a cornerstone is worth.** A
cornerstone is 800 points, so 900 per cap-year — a shade dearer, because a cap
year is spent and a cornerstone is still on your roster afterwards. Read against
real trades: $22M above market ≈ 0.09 cap-years ≈ **78 pts**, a fourth-rounder,
which is roughly what clubs have really paid to have a bad contract absorbed;
$60M ≈ **212 pts**, a third; $130M ≈ **459 pts**, a second — so the $135.4M
albatross now costs a real pick to be rid of instead of being a gift. Keep it
linear and no steeper: the bar is "a liability must cost something", and an AI
that refuses every trade is worse than one that accepts too many, because the
market is most of this game.

Take a **flat-dollar fair band** off first, not a percentage. The market-value
estimate is a fragile placeholder that rounds to $100K, and no front office looks
at a man a million and a half over the estimate and calls him an albatross.
Without a band the burden charged that noise: an 85-overall punter at $3.5M
against a $2.3M market — an ordinary deal, one year left — came out a **negative
asset**, because his entire trade value is about four points and $1.2M is worth
four. A 20% band would forgive $1.2M on the punter and $8M a year on a
quarterback, which is forgiveness that grows precisely where the money is; the
mispricing this absorbs is the estimator's, and the estimator's error is roughly
a fixed number of dollars. State the band against the base cap like the rate —
about 0.8% of a cap.

**Need and fit are one bounded multiplier, blended by taking the larger of
"needs sees holes" and "rosterFit sees upgrades"** (a club with nobody at a spot
registers on both):

```
fitVal   = max(needs[position] ?? 0, rosterFit(p, roster)?.score ?? 0)
fitBase  = NEED_MULT_MIN + fitVal * (NEED_MULT_MAX − NEED_MULT_MIN)       // 0.85 .. 1.40
fitMult  = clamp(fitBase * windowMult, FIT_WINDOW_MIN, FIT_WINDOW_MAX)    // 0.72 .. 1.36
```

Width is a tax on every player-for-player trade, because this multiplier applies
to **both** sides and they pull opposite ways: a club prices its own starter at
the top of the band (losing him drops its depth chart) and prices an incoming man
at the bottom (it already has one). Compounded with the accept ratio:
`0.72/1.28 → 1.78x, 1.88x` versus `0.85/1.20 → 1.41x, 1.47x`. At the old width a
club would not swap two genuinely comparable starters unless one side sent nearly
twice the value — the "sending far more than you get is still refused" report,
and an artefact of charging the same preference twice rather than a judgement
about football.

Then widen the **top** back out to 1.40, because a desperate club has to be able
to act desperate. The owner's case: a win-now club with $108M of room and a 68 at
quarterback refused a legitimate starter, and at a +20% ceiling it could not have
done otherwise — even a club with **nothing** at the position could only bid a
fifth more than one that was set there. Real football is not that flat: Denver
sent Seattle two firsts, two seconds, two thirds and three players for a
quarterback; the Rams sent two firsts and a third for one. 0.85–1.40 is a 1.65x
span, still inside the 1.78x measured as too punishing.

**Fold the club's competitive WINDOW into the same bounded multiplier**, clamped
once against `FIT_WINDOW_*`, so there is exactly one roster-preference number in
the formula and no path applies the preference twice. Measured, the product
reaches the bounds only at the extremes and sits inside 0.85–1.25 for 95% of
club/player pairs.

The window is **not a discount on the man being sold**; it is a change in what
the club thinks every asset is worth, applied wherever that asset appears. The
owner's case, in his words: a bad club *"might sell a 1000 point asset for [a]
915 point draft pick"* — and the clarification is the whole mechanism. It is not
that rebuilding clubs are cheap, it is that they want a **different kind** of
asset back. Picks are what a rebuild is for. So to a rebuilder a future pick
really is worth more than the chart says and a 30-year-old starter really is
worth less, and the 915 falls out of it: 915 neutral points of picks clears his
price and 915 neutral points of veteran does not. Pricing it this way also stops
it double-counting with the roster-fit term, which answers a different question
(does he improve our lineup, not do we want him now or later).

```
WINDOW_SWING = 0.13, WINDOW_PIVOT_AGE = 27, WINDOW_AGE_SPAN = 6
FUTURE_DISCOUNT_BASE = 0.85, FUTURE_DISCOUNT_SWING = 0.22
perYearPickDiscount = clamp(0.85 + (0.5 − winNow) * 0.22, 0.6, 0.98)
```

0.13 is set against the owner's own number: a fully rebuilding club prices a
31-year-old starter at about **0.91** of neutral, so 915 points of draft capital
clears a 1000-point veteran — 31 is four years past the pivot over a six-year
span = 0.67 of the full reading, and `1 − 0.67 × 0.13 = 0.913`.

**Cap fit: ask whether THIS club can live with the contract**, which is a
different question from whether the contract is good value and has a different
answer for every club — a $20M salary is a bargain to a club with $60M of room
and an impossibility to one with $3M, at identical market value. For an incoming
man charge **base salary only** (the bonus accelerates onto the club giving him
up, so using the raw hit overstates the bill on every bonus-heavy contract in the
league) and scale the strain by his share of the club's room; for a man already
on the roster the cap he frees is a reason to trade him, **but only for a club
actually under pressure** — a club with room has no reason to shed salary, so
leave the term inert there rather than quietly marking down every expensive
player in the league.

**League scarcity** nudges value and may never be the reason a punter prices like
a premium asset: `SCARCITY_MULT_MIN = 0.9`, `MAX = 1.15`, computed once per trade
evaluation from one league-wide fetch and passed in as a plain number map.

**Noise last of the multipliers**: `1 + rng.normal(0, 0.09 * (2 − sharpness))`.
Lower sharpness (easier difficulty) means a noisier AI.

**Soften the ceiling; never clamp it.**

```
CEILING_SOFTENING = { KNEE: 0.60, LIMIT: 1.20 }
softCeiling(total, ceiling):
  knee = ceiling * 0.60
  if total <= knee: return total
  span = ceiling * (1.20 − 0.60)
  return knee + span * (1 − exp(−(total − knee) / span))
```

A hard `Math.min(total, ceiling)` is the one shape ruled out for outliers.
Measured before softening: a 94, a 96, a 98 and a 99 receiver at a club that
needed one all priced at **exactly 2100** — one number for four different
players, so the game could not tell the best receiver alive from a merely
excellent one, and the trade screen quoted a figure the football model had not
produced.

Put the knee at 0.60 of the ceiling, not at the ceiling. A knee at the bound
leaves the whole run-up uncompressed, and the run-up is where the men who cost
real draft capital live. Measured as the ask a buyer has to beat, against the
largest real deal of its kind (Ramsey 1640, Mack 1765 net, Tunsil ~2350, three
mid-firsts for a franchise quarterback):

| knee | top of market (92+ and QB) | everyone else |
|---|---|---|
| 1.00 | 1.18x | 0.99x |
| 0.80 | 1.13x | 0.98x |
| 0.70 | 1.11x | 0.98x |
| **0.60** | **1.07x** | **0.97x** |
| 0.50 | 1.04x | 0.96x |
| 0.40 | 1.00x | 0.96x |

0.60 takes about 60% of the excess off the top and leaves the rest of the league
where it was: on a blind sweep of **8,275** rostered players, **97.4%** of
valuations come back bit-for-bit identical and nothing at or below a 92 moves by
more than 0.3%. And it makes the top **less** flat, not more, which is the
opposite of what a clamp does: compressing earlier spreads the same headroom over
a wider range of raw inputs, so the gap between a 96 receiver and a 99 goes from
**72** points to **114**.

Pick `LIMIT` by measurement. The pre-softening product runs to **1.82x** the
ceiling on a 99 at a club with a hole, so the whole top of the market must fit
inside the headroom:

| limit | a 94 receiver .. a 99 receiver |
|---|---|
| 1.10 | 2293 .. 2310 — 17 points apart; the clamp again wearing a curve |
| **1.20** | **2401 .. 2513 — 112 points**, about a fourth-rounder between an excellent receiver and the best one alive |
| 1.25 | 2434 .. 2605 — 171 points, and PREMIUM's bound passes Tunsil |

1.20 puts PREMIUM's hard bound at **2520** (under Tunsil's ~2400 plus a buyer's
premium), QB's at **6000** — the owner's "four or five first-round pick
equivalents" with the fifth intact rather than clipped — and MINIMAL's at **48**,
a late fourth. Export the limit so nothing keeps a second copy of the bound: a
probe that hard-coded 1.25 beside the code went on printing the old number and
the old football sentence after the headroom was retuned to 1.20 — **a lying
metric produced by the very measurement meant to catch one.** And remember the
bound is on `total`, not on what a buyer pays: the poach premium applies after
this, so the ask for a man at the bound is up to 18% above it on HARD (measured,
the dearest receiver in a generated league asked **2614** against a stated bound
of 2520).

**Subtract the burden LAST — after the ceiling, and outside the noise.** After
the ceiling, because the ceiling says how much a position can be worth **on the
field** and has nothing to say about money owed: subtracted before it, a club's
best quarterback pinned at 5000 would have his contract forgiven entirely by the
clamp, and the bill would vanish into the rounding on precisely the biggest deals
in the game. Outside the noise, because every other term is a scouting judgement
and the noise is what makes clubs disagree about one — a contract is a public
document and there is nothing to disagree about. Thirty-two front offices read
the same player differently and the same bill identically, which is also how it
works.

**No floor on the finished value.** `Math.max(1, total)` is one of the two floors
that made a liability impossible. A man must be able to come out a **cost**,
which is the only honest answer for a man whose paper is worth more than he is.

### 6.4 Price a pick, and name the right selection

```
pickValue(round, slot, profile, year, currentYear, imminentYear):
  overall = (round − 1) * TEAM_COUNT + slot
  chart   = PICK_VALUE_CHART(overall)
  bias    = 1 + (profile.valuePicks − 0.5) * 0.5 + (0.5 − profile.winNow) * 0.35
  perYear = clamp(0.85 + (0.5 − profile.winNow) * 0.22, 0.6, 0.98)
  return chart * bias * perYear ^ (years beyond the imminent draft)
```

**Centre the GM bias on 1.0.** The old form `0.75 + valuePicks * 0.5 + (1 −
winNow) * 0.35` handed a perfectly neutral GM a **1.175x** multiplier — harmless
while the chart was being rescaled by an arbitrary constant anyway, and a lie now
that the chart's numbers are the game's units. Keep the coefficients and the
league-wide spread (roughly 0.62x–1.38x); move only the middle, so a neutral club
prices pick 48 at **420** and "this player is worth a mid-second" is checkable.

**Do not discount the imminent draft at all**, and count the discount from it
rather than from the season. Picks for the upcoming draft are typically
pre-generated as `seasonYear + 1` and stay that way all season, so without this a
pick in the draft five months away was marked down 12% for being "a year out".

**Resolve which selection the pick actually is, in this order of precedence:**

1. **The seeded order wins over every projection.** Once the draft order has been
   reseeded for that year, the stored slot *is* the running order the room is
   being conducted by, per round. Pricing a projection against it is not merely
   stale but backwards: during a live draft the standings have already been
   wiped, so the projection collapses to database row order and the club holding
   the **32nd** selection was charged for the **1st** — a gap of **1797** points
   against **590** on the exact same pick the board was calling #32.
2. **Before the reseed, project from the club's record.** The stored slot is only
   a generation-time placeholder unrelated to performance, so a 0–5 club's first
   should price like a first.
3. **Regress further-out picks toward the middle of the round**, at
   `FUTURE_SLOT_REGRESSION = 0.65` per year beyond the next draft:
   `slot = clamp(round(middle + (projected − middle) * 0.65^yearsBeyond), 1, TEAM_COUNT)`.

That regression exists because **a further-out pick must never be worth more
than a nearer one from the same club.** The "everything past the next draft is a
mid-rounder" rule got that badly wrong: measured, one club's first in the next
draft priced at **495** and its first the year after at **713** — the
further-away pick worth **44% more**, because a club projected to pick 32nd had
its future firsts revalued as if it picked 16th and a 15%-per-year time discount
cannot cover a 1.6x jump in slot. Two more clubs: 693 against 950, and 570
against 808. That inversion is the mechanism behind the owner's screenshot — a
future first from a good club charged for as a mid-first. Full regression to the
middle is not honest either: clubs regress, but not instantly and not
completely, and a front office plainly does not treat a contender's future first
the way it treats a bad club's. At 0.65 the worst residual inversion across the
league is **under 1%**, inside the valuation noise, and the ordering everywhere
else is strict.

Identify "the next draft" by **the smallest year with any unused pick**, not by
comparing the pick's year to the season, because the year-roll happens partway
through the offseason **before** that draft actually runs — so which pick is
"this season's" depends on where in the phase machine the league sits.

A valuation cannot refuse to produce a number the way a screen can: where the
screen goes quiet (the gap between a draft ending and the next kickoff, where the
imminent draft has jumped a year ahead of the last season on file) lean on the
most recent finish — a stale read of a club, but a far better one than a
generation-time placeholder. The two must agree exactly wherever a number is
shown at all.

### 6.5 Build the club-and-season context once, and seed the verdict

Hold everything that is a fact about the **club and the season** in one object —
GM profile, needs, league scarcity, draft order context, the difficulty spread,
the noise prefix, the roster and the club's books — and build **one** per
evaluation, shared by every asset on both sides. If a field you want to add
varies with the offer, it does not belong there.

That is also what lets the gap-closer try a dozen candidate packages against the
same club without re-reading its roster, its books and the draft order a dozen
times, while every candidate still goes through the whole real evaluation.

**The verdict is a judgement, not a draw.** Seed the valuation noise
`trade-${aiTeamId}-${seasonYear}` plus the **asset id** — and nothing else. The
reference implementation seeded `trade-${aiTeamId}-${Date.now()}`, so every
submission of the same offer re-rolled the ~9%-per-asset noise: a user who kept
hitting Propose was rolling dice until the variance fell his way, and a
borderline "no" was a few clicks from a "yes". The whole value model defeated by
a button.

Seed **per asset**, not per deal. Both kill the re-roll, and the finer grain is
strictly better by measurement: a deal-level fingerprint re-rolls every asset the
moment any one changes, so adding a seventh-round pick to an offer moved a
measured deal from **1.058 to 0.951** — the sweetener made the AI want it 10%
**less**. Per asset, a club's read on a given player is a property of that player
(as it should be: it is that club's scouting being imperfect, not its mood), so
adding to an offer can only ever add.

The three things in the seed are the three that may legitimately change the
answer: the club (a different front office may read the same player
differently), the year (a package refused this season can be revisited next
season; a "no" that never expires is its own bug), and the asset. Deliberately
**not** in it: the clock, the iteration order of the offer, and the rest of the
package.

Seed the GM profile per club per season too (`gm-${aiTeamId}-${seasonYear}`). The
reference implementation drew it from the shared evaluation rng, so a club whose
stored profile was missing or partial was handed a **brand new personality on
every submission** — and even with a complete profile, the four draws it consumed
shifted the noise stream underneath the valuations.

### 6.6 The bid/ask spread — difficulty changes the DIRECTION of a trade

A club does not have one price for a player. It has two:

```
ASK (prying one of ITS players loose) = talent * (1 + poach) + owed
BID (taking one of YOURS in)          = talent * (1 − haircut) + owed − burden * badContractTax
```

| difficulty | poach premium | dump haircut | bad-contract tax |
|---|---|---|---|
| EASY | 0.03 | 0.03 | 0.1 |
| NORMAL | 0.07 | 0.07 | 0.25 |
| HARD | 0.18 | 0.18 | 0.6 |

**Exempt picks from the spread.** A spread applied to everything is
algebraically identical to raising the acceptance threshold. Applied to players
only, it prices the thing it is actually about — prying a man off a roster and
out of a building — and leaves pick-for-pick trades at chart value, where a chart
belongs. This is the point: on HARD the skill is finding a club that **wants what
you have** rather than finding more points. A difficulty setting that only makes
every deal need more value is a known failure mode.

**Apply the spread to the TALENT, and let money owed ride through at face value
on both sides.** A finished valuation can be negative, and multiplying a negative
by `(1 − haircut)` marks the burden **down** — a club handing itself a discount
on a debt it is about to be handed. The other direction is just as wrong: a poach
premium on a liability says prising an albatross loose costs **more** than he is
worth. So split: `talent = max(0, total)`, `owed = min(0, total)`.

Charge the bad-contract tax **only on the receive side** — a burden a club is
handing away is a saving, not a bill it can be charged for — and multiply the
**contract deficit the valuation already found**, so it is silent on a fair deal
and bites hard on a toxic one with no separate judgement about what a bad
contract is. The owner's specific ask: on the hardest setting, dumping a burden
should cost real compensation, because the club taking it on is doing you a
favour. Put **no floor** on the result.

### 6.7 Package quality: four quarters are not a dollar

Judge a trade on what the piles **contain**, not only on what they add up to.
Without this the arithmetic says six backups equal one star, and every trade
economy that has shipped without it has broken the same way: aggregate junk until
the sum clears the threshold.

**Concentration** — discount the tail of a pile, on both sides:

```
CONCENTRATION = [1, 0.95, 0.85, 0.7], CONCENTRATION_TAIL = 0.55
total = Σ over positive-value assets, ranked desc, of value * weight[i]
      + Σ over liabilities (value <= 0) of value          // UNWEIGHTED
```

A roster fields eleven men at a time and holds 53, so the fifth piece of a
package is worth genuinely less to the club receiving it than its price tag says.
**Weight only the assets.** A liability is not made smaller by standing in a
crowd: none of that reasoning survives being pointed at a contract, and left on
the same footing an albatross sorted to the back of a five-man pile had **45% of
its bill weighted away** — a fresh way to launder the same exploit, one asset
removed.

**Weight both sides identically.** If a bundle were discounted only when
received, the same assets would be worth different amounts depending on which way
they were travelling, and a user could trade a pile for a star and the star back
for the pile, manufacturing value on every lap. Judging both piles by one rule
makes a round trip exactly neutral **by construction** — and test that.

**The headline rule: a cornerstone may not be bought with depth.**

```
HEADLINE_THRESHOLD = 800        // about a mid-first: an 89-90 at a premium
                                // position, a 92 corner, a genuine franchise QB
HEADLINE_SHARE = 0.4
HEADLINE_PREMIUM_COUNT = 2
premiumLine = PICK_VALUE_CHART(TEAM_COUNT)      // the LAST pick of round one

headlineShortfall(receive, send):
  pillar = send.best;  if (!pillar || pillar.value < 800) return null
  wanted = pillar.value * 0.4
  if (receive.best?.value ?? 0) >= wanted: return null
  if receive.premiumCount >= 2 && receive.premiumTotal >= wanted: return null
  return { wanted, best, name, isPlayer }
```

Size it as 35–50% of the man being moved (40% here). What the seller is short of
afterwards is not points, it is a player nobody else has.

**The second clause is not a count.** "First-round quality" read off the chart is
a fixed line (590) tested against a man of any size, so a bare count got easier
the bigger the cornerstone: two late firsts are **47%** of a 2500-point pillar —
roughly what the share asks for, and the real trade this clause exists to permit
— and **24%** of a 5000-point one, which is not a trade anyone has made. Make the
second clause clear the **same** bar, spread over more than one piece. Two firsts
for a franchise quarterback has a headline asset worth only about a quarter of
him, and the Rams, the Bears and the Texans all made that trade; real two-first
packages clear the added bar comfortably. What stops passing is a pair of picks
that are first-round quality only by the letter of a threshold.

Read "first-round quality" off the chart itself rather than writing the number
down, so it stays true if the league ever changes size.

**Gate the headline rule to offers that have NOT cleared the bar, and let it
explain a refusal rather than cause one.** As a hard veto it produced a meter
reading **102%** — over the club's own line — above the words **TURNED DOWN**,
which is the same defect as a green "he will sign this" over a dead button. A
number the game shows as the answer cannot be overruled by a rule the number
knows nothing about. And the veto was very nearly redundant: concentration
already discounts a pile and the total is computed **after** that weighting, so
the junk-pile case is already refused on value — the canonical "four quarters for
a dollar" probe (five starters plus a 2nd, 3rd and 4th for a 99 receiver) scores
**0.52**, less than half the bar, before this test runs at all. What was left was
a second penalty on top of the first, and the only offers it could change were
ones that had already cleared the line — which is exactly the frustrating case,
and it lands hardest on a rebuilder trying to turn real players into picks.

### 6.8 The verdict

```
requiredRatio = aiAcceptsLopsided ? 0.9 : TRADE_ACCEPT_RATIO       // 1.04
netBar  = sendValue > 0 ? sendValue * requiredRatio : sendValue
clears  = receiveValue >= netBar
shortfallPoints = max(0, netBar − receiveValue)
```

**When their side is empty the question is not a ratio.** The reference
implementation wrote `sendValue === 0 ? Infinity : receiveValue / sendValue`, and
that Infinity was the worst exploit in the game: a club being asked to give up
nothing cleared any threshold ever set, so the pile coming **at** it was never
priced at all — the $135.4M corner went to thirty of thirty-one clubs for
nothing. A ratio needs a denominator; with nothing going out there isn't one, and
the honest question is "is what we are being handed worth more than nothing?"

**A negative ask is not a typo.** `sendValue` can come out below zero, and it
should: a club asked to hand over an albatross is being done a favour, and the
deal it will accept is correspondingly cheaper. Note the bar is **not**
`sendValue × requiredRatio` there — multiplying a negative by 1.04 moves the bar
the wrong way and has the club demanding **less** the more toxic the contract it
is shedding.

Do **not** change the gift case. An offer of a 91 receiver for nothing is one the
AI genuinely accepts and should; `receiveValue >= 0` is true of every real asset
and false only of a liability, which is the whole distinction the Infinity could
not draw.

**Refuse nothing-for-nothing explicitly.** Both piles empty prices 0 against a
bar of 0, which clears — the old Infinity accepted it too. The screen refuses to
submit it, but a server action is a public endpoint and this one would have
written a transaction row and a retrospective for a deal in which nothing moved.

**Keep `ratio` one number with one meaning on every path**, because consumers
divide it by the required ratio to get "how far to yes". Where a ratio exists,
use it. Where it does not, map the gap to the bar onto the same scale against the
size of what is actually on the table, floored at a cornerstone's worth so a
trivial offer of nothing much for nothing much cannot read as a landslide either
way:

```
netScale = max(abs(receiveValue), abs(netBar), 800)
ratio    = sendValue > 0 ? receiveValue / sendValue
         : requiredRatio * clamp(1 + (receiveValue − netBar) / netScale, 0, 1.5)
```

**Derive "how much more" ONCE, and derive it so that doing it actually closes the
deal.** There were two of these and they disagreed: the cap-blocked message
divided (`requiredRatio / ratio − 1`), which is the real answer, and the plain
value refusal subtracted (`requiredRatio − ratio`), which is not a percentage of
anything. At a ratio of 0.70 against a required 1.04 the subtraction says "34%
short" when the offer has to grow by **49%** — so a user who added exactly what
he was told was still refused, and the screen looked like it was moving the
goalposts. Floor it at 1%, because every branch that prints it is a refusal and a
gap under half a percent rounded to a flat "we're about 0% short on value" — a
club turning down a deal while saying it needs nothing more.

Only quote a percentage when the ask is positive. A percentage of what the club
is giving up is not a number when it is giving up nothing; say the shortfall in
points and dollars instead.

**Set the accept ratio at 1.04 and know what it compounds with.** The need band
already charges an incoming player the bottom and an outgoing one the top, and
the spread charges the direction on top of that. Do not write the compounded
figure down from the algebra — **measure it**: pricing the same man in both
directions through the whole evaluation, the round trip costs **1.34x** on
average (n=6, range 1.14–1.42x), well under the algebraic worst case because the
fit/window clamp binds and real depth charts do not sit at either end of the
band. (The reference implementation's comment claimed 1.47x while the arithmetic
it quoted had become 1.71x and the note under the need band in the *same file*
said 1.65x — two numbers for one product, in one file.) 4% keeps a visible thumb
on the scale without a football-literate offer reading as lopsided, and it sits
inside the ~9% per-asset noise, so a genuinely fair offer is answered differently
by different clubs — which is what shopping a player around should feel like.

`TRADE_COUNTER_WINDOW = 0.35` decides only how a refusal is **worded** ("close,
but we need a bit more" rather than "not enough here"). With players and picks on
one scale a near-miss is usually one mid-round pick from closing, and a deal that
close should say so.

**Order the refusals, and give each its own instruction.** Check the AI's **cap**
first (§6.9), then the headline rule (gated to non-clearing offers), then the
nothing-for-nothing case, then accept, then the salary-dump case, then the
counter window, then a flat refusal.

For the **salary dump** (`receiveValue < 0`) there is no percentage to quote and
"we're about 12% short" sends the user off to add another backup, so name the
actual obstacle — the contract, by name and by dollar — and what closing it would
take: *"It isn't <Name> we have a problem with, it's his contract — it runs $X
past a fair price for a player at his level, and you're asking us to carry that.
We'd need real compensation to do you that favour: <value phrase> on top, or take
some of that money back the other way."*

For the **headline** refusal, say what each percentage is counting. The owner's
screenshot had the meter reading **68%** and the sentence reading *"91% of what
that would take"* — both true, measuring different things (the meter is the whole
offer against the club's bar; the sentence is the best single piece against the
cornerstone bar), with nothing saying so, and a "whatever the totals say" clause
actively implying the totals were fine when they were 32% short. Say which it is,
say the value is short too, and do not say "we're not moving **him**" about a
2027 first-round pick.

### 6.9 The cap gate on a trade, and the two-sided rules

```
tradeCapEffect(c, mode):
  if (!c || mode === 'OFF') return { frees: 0, takesOn: 0, dead: 0 }
  hit  = capHit(c, mode)
  dead = unamortizedBonus(c, mode)              // 0 outside REALISTIC
  return { frees: hit − dead, takesOn: hit − prorationThisYear(c, mode), dead }
```

**The two sides of a trade are not mirror images, and this is the single place
that says so.** In REALISTIC the signing bonus does not travel: the club giving
him up eats the whole remaining proration immediately, and the club acquiring him
inherits **base salary only**. In SIMPLIFIED the flat-APY contract travels intact
and nothing accelerates.

Make `takesOn` subtract `prorationThisYear`, never a flat `proration`. That is
bug #1 in §0, and it was **enforced** because the gate runs on this function.

Derive the trade's cap deltas from this one function, summed over the assets:

```
tradeCapDeltas(assets, fromTeam, toTeam, mode):
  for each PLAYER asset with a contract:
    push { teamId: fromTeam, delta: −effect.frees }
    push { teamId: toTeam,   delta:  effect.takesOn }
  picks carry no cap weight
```

and have the **cap gate**, the **executor**, the trade builder's live "space
after" readout, the AI's own cap refusal and the gap-closer all run that same
call. Two derivations of one figure is exactly how this app has repeatedly
shipped a panel quoting a number it was not using.

**Check the AI's own books before the value**, and mirror the gate's escapes
exactly — a move that frees room or is cap-neutral (picks only) is never blocked
even for a club already over the ceiling, and the same one-dollar slack applies.
Without this the screen said "Deal accepted! Click confirm to execute" and the
Confirm died on the cap: a bait-and-switch instead of a sentence a GM can act on.
Judge only the AI's side here; the user's cap is his own business and is reported
at execution.

**Make the cap instruction and the value instruction agree.** Three stages of
this went wrong in the reference implementation:

1. *"Take a contract back the other way and we'll talk"* plus, when value was
   also short, *"we'd want about N% more coming back"* — **opposite**
   instructions. Taking a contract back means *we* send another player, which
   fixes our cap and simultaneously widens the value gap we just asked him to
   close. The owner's words: it *"requires more value from the player."*
2. The fix for that said picks *"do both at once"*, which is true only of the
   value half. The cap figure is a pure salary number and picks contribute
   nothing to it, so **adding** picks cannot move it by a cent. Measured: piling
   on one, two, four, eight and sixteen first-round picks left the same "adds
   $39.4M against $29.4M of room" sentence on screen every time, because the cap
   gate returns before value is considered. A user following that advice could
   add the entire draft and never get past it.
3. "We like the deal otherwise" is a sentence about a deal the club would take if
   it had the room, and a **lie about a salary dump** — those fail the cap *and*
   the value.

So give each of the three cases its own instruction: cap-only → *"Take a contract
back the other way, or send someone cheaper, and we'll talk — we like the deal
otherwise."*; cap **and** value with a positive ask → *"The value is short too,
by about N%. Adding picks won't move the cap number — only less salary coming at
us will. Swap an expensive man for picks and you fix both at once."*; cap and a
zero-or-negative ask → *"And the room isn't the only problem — you're asking us
to take a contract on and hand nothing back, which we wouldn't do at any cap
number."*

**The trade deadline:** closed for the rest of the regular season once past the
deadline week (default `tradeDeadlineWeek = 9`, matching the real Tuesday-after-
week-9), and closed through the playoffs, the offseason and the re-sign window —
reopening the moment free agency starts, which is this game's equivalent of the
new league year opening. Make it a league setting (`tradeDeadlineEnabled`).

### 6.10 Execute a trade

Order the work exactly like this, and treat the ordering as load-bearing:

1. **Resolve the charge year through `capChargeYear`,** never hard-code the
   season. In the reference implementation this was right only by accident — the
   deadline rule happens to close trading through the pre-roll window — but the
   deadline is a league **setting**, and a league with it switched off can
   execute a trade in OFFSEASON week 1 today. An accident of one rule is not a
   guard.
2. **Refuse an impossible trade before anything is recorded.** For every asset:
   the same asset may not appear twice (on one side or on both — it would be
   moved twice and land wherever the last write put it, which for a both-sides
   listing means a club "trades" a player and keeps him); a player must be in
   this league, not retired, and **on the roster of the club offering him**; a
   pick must be in this league, unused, and owned by the club offering it. Name
   each refusal in words a GM can act on.

   This is not hypothetical defensiveness. The reference implementation's
   executor moved whatever ids it was handed and checked only the salary cap, so
   an offer naming a player on a third club's roster, a spent pick, a free agent
   or a retired player moved him anyway — and one of those was reachable in
   ordinary play with no tampering: an AI offer sits on the table for a week, the
   club cuts the player it had offered, and accepting the stale offer hands the
   user a free agent with no contract — **a permanent, free roster spot**.
   Trading a retired player manufactured an error-level invariant violation.
3. **Gate both clubs**, one net position per club across both directions, using
   the deltas above.
4. **Enforce the roster limit, and only block the user.** Nothing on the trade
   path had ever read the roster maximum, so a club could take on twelve players
   for nothing and carry **58** into week one — measured. The limit did get
   enforced, but not until the following offseason's final cuts, which means the
   overflow survives a whole season and is then resolved by the game waiving five
   men on the user's behalf: worse than being told no. Count on the same
   `ACTIVE` status cut-down day counts, or the screen refuses trades cut-down day
   would have allowed.

   Block the **user** with an action he can take ("release N before making this
   deal"). For an AI club, **make room** the way it makes cap room — shed its
   least valuable man first, on the same ranking cut-down day uses (§4.10). The
   reference implementation threw for whichever club was over, which killed a
   five-for-one on *"Charlotte Pumas would carry 54 players against a 53-man
   limit. Release 1 before making this deal."* — an instruction the user cannot
   follow, since he cannot release another club's player. The owner proposed the
   fix himself: *"maybe the AI logic drops their lowest ovr player?"* Trim the
   AI club to `rosterLimit − incoming + outgoing`, since none of the deal has
   happened yet.
5. **Snapshot what is moving, and what it is worth, BEFORE ownership changes.**
   This is the only record of asset identity a retrospective can grade later, and
   the only thing the wire can read to name the deal. **Hand the same snapshot to
   both readers** rather than re-deriving it — re-deriving is a second reading of
   one trade, priced by a second call to the valuation a few milliseconds later.
6. **Inside one transaction, per asset, in this order:**
   - **Claim it atomically first.** Update by `{ id, leagueId, teamId: fromTeam }`
     (and `used: false` for a pick) and throw when nothing matched. A read in
     step 2 cannot enforce ownership: at READ COMMITTED two confirms of the same
     trade both read a valid roster and both proceed, and the second update
     simply sets `teamId` to a value it already had. Matching on the current
     owner means exactly one writes a row; the loser matches zero and throws,
     rolling the whole thing back. That is what stops a double-clicked Confirm
     filing the accelerated bonus twice (measured: **two `CapCharge` rows for one
     player**), and it is why the charge is written **after** the claim.
   - **Book the accelerated bonus on the selling club**, `unamortizedBonus`, dated
     `chargeYear`, labelled `Traded away — Name`. The **bonus**, not what a
     release would cost: his guaranteed salary is not escaped by trading him, it
     travels with the contract and becomes the acquiring club's bill.
   - **Move the contract with the bonus zeroed, the void years zeroed, and
     `guaranteed` restated in the same write:**
     `guaranteed = max(0, old.guaranteed − old.signingBonus)`. `guaranteed` is
     stored bonus-inclusive, and the bonus has just been zeroed out of this row —
     left alone, every dollar of bonus guarantee re-reads as guaranteed **base**
     salary and the acquiring club inherits a dead-money bill for money the
     selling club has already been charged for.
7. **Reconcile both depth charts, in the same transaction as the move.** Moving
   the roster spot is only half of arriving: a ranking function ranks a player his
   chart does not name behind every player it does, so the man you traded for
   lined up behind the entire position group and **took no snaps at all for the
   rest of the season**, while the man you traded away kept a rank on the chart he
   had left. A trade must never half-land.
8. **Write ONE transaction row per deal, carrying the headline player's id.** A
   four-man swap is one event; four rows read as four trades on the wire. Measured
   across the whole transaction table: **25 TRADE rows in 272 leagues and ZERO of
   them carrying a player**, while every other kind of move was attributable
   (DRAFT 42,917 of 43,528; RESIGN 39,724 of 51,778) — so a trade was the one
   thing that could happen to a career and leave no trace on it. One row is safe
   only because the snapshot record carries the complete per-player ledger of both
   directions, each entry keyed by real player id with the club abbreviations and
   the league year on the row: "2031 — Traded to New York" is answerable for the
   second, third or fourth piece as readily as for the headline. This row is the
   announcement; that row is the ledger.
9. **Return the wire line to the caller** rather than making a background pass
   re-read "the most recent TRADE row for this league and week" — a query that
   returns a different deal the moment two land in one tick.

**Write the wire sentence from the snapshot, and make "blockbuster" mean one
checkable thing.** Lead with the most valuable **man** moving in either
direction, never a pick ("Chicago acquires a 2029 1st" is not a sentence a wire
leads with; word the pick-only case separately as a swap). Fire the
"BLOCKBUSTER" prefix at the same cornerstone threshold the headline rule uses,
so the word means what the trade screen's own idea of a pillar means. Put the
whole ledger, both directions, in the detail. The reference implementation's row
read `Trade: ATL <-> BUF` over `ATL sends 2 asset(s), receives 2 asset(s).`

**The force override, if you build one.** Suspend only the two refusals that are
**policy** — the salary cap and the roster limit — and nothing else. Keep every
rule that protects the integrity of the save: a club still cannot trade a player
it does not own, a retired man, a spent pick or the same asset twice, and the
money is still booked exactly as for an ordinary trade (bonus accelerates onto
the seller, base salary travels, the charge dated by `capChargeYear`). Skipping a
rule leaves a legal save in an illegal **state the player asked for and can
see**; skipping an ownership claim leaves a save with contracts pointing at
nobody, which is not an override, it is corruption. Do not skip the AI's roster
trim either — the alternative is silently handing another club an illegal roster
the player never sees.

Why an override at all, rather than a looser accept ratio: the save it was
written for could not be fixed by a lower bar at any value, because the problem
was never price — an AI club had drafted a sixth quarterback and nobody in the
league wants a fifth, so the deal that unbreaks the roster is one no club accepts
at any ratio.

### 6.11 The explainable factor breakdown

Return **why**, not just a number, from the valuation: a list of
`{ text, weight }` reasons where the weight is the value swing that factor
caused. Then:

- **Sort across every asset on a side, not within one.** Otherwise a minor note
  about asset #1 outranks the actual dominant factor on asset #2 just by having
  been evaluated first.
- Show the strongest three per side, and label them correctly: the reasons for
  the pile flowing **to** the AI explain why it wants or discounts them; the
  reasons for the pile it would **give up** explain what it is losing.
- **State a factor only when it is actually moving the number.** Every reason
  carries its own value swing and the screen shows the top three, so a 2% nudge
  that announces itself pushes a real driver off the list. Use real thresholds:
  mention the contract burden only above ~15 points (about a sixth-round pick),
  the window only above a 4% swing, cap strain only below 0.94, surplus only
  above 1.12.
- **Write them in the club's own first person** — "He starts for us at LT",
  "We're rebuilding" — and have the panel attribute them to the club rather than
  narrating them.
- **Make them read correctly from both sides of a deal.** The same number is the
  price of acquiring him and the price of prising him loose, so a screen that
  says "he'd start for us" about a man who already does is explaining someone
  else's roster. Branch on whether he is on this club's roster, and state the
  gap in **rating points over the man he displaces** — "10 points better than the
  man he'd replace" is a sentence a GM can check against the depth chart in front
  of him, and "15.2" is not.
- Say the honest thing about an empty slot: "He'd walk into an empty LT slot for
  us — we're playing nobody there."
- A spread the user cannot see reads as the AI being arbitrary, which is worse
  than no spread.

### 6.12 The gap-closer: name what would close a declined deal, and NEVER print a value

**Owner requirement, explicit: the club's value points stay behind the intel
screen. No suggestion may carry a numeric asset value.** A panel that said "add
280 more" hands the GM the price list the AI is running on.

So the numbers in this component do two jobs and neither of them is display:
they **narrow** the candidate set before anything expensive runs, and they
**order** the survivors cheapest first. What reaches the screen is an action, a
football reason, and a **qualitative band**.

**Verify every suggestion against the real evaluation.** Nothing here may
estimate, interpolate or reason about what the engine "would probably" say. If a
suggestion is on screen, the engine has already said yes to it.

```
EVALUATION_BUDGET = 24        // real evaluations one press of Propose may spend
SHOWN = 3                     // three actions is a decision; ten is a list
CHEAP_SHARE = 0.6             // of the budget, the share spent on the cheapest qualifiers
NARROW_SLACK = 1 + CAP_GATE_TOLERANCE
```

**Re-ask the refusal; do not take it from the screen.** A verdict travelling over
the wire is a claim about a package rather than the package itself, and this
component's entire promise is that every suggestion was checked against the live
engine. Start by re-evaluating the offer you were handed.

**For a VALUE refusal**, offer two moves: add one of yours, or drop one of your
asks.

Narrowing an addition is an **exact necessary condition**, not a guess. Adding an
asset to your side can move the club's receive total by at most the asset's own
priced value: every piece is weighted by concentration (the first at 1.0, falling
from there), and a newcomer both takes a weighted slot and pushes everything below
it onto a smaller weight, so the gain is at most `value × 1.0` and never more. The
club's bar does not move when you add to your own side (it is priced off what *it*
gives up, which is untouched), so the gain has to cover the shortfall exactly.
Therefore `value >= shortfall` skips nothing that could have worked. Assets above
the line may still fail — on the weighting, on the cornerstone rule, or on either
club's cap — which is what the verification pass is for.

Price each candidate with the **same** pricing function the evaluation runs, on
the same context, with the same per-asset noise seed, so the number you filter on
is the number that will be used.

**Split the budget.** Cheapest-first is what a GM wants, but a refusal can also be
the cornerstone rule — "no quantity of depth buys this man" — where the only thing
that works is a big piece. Spend `CHEAP_SHARE` of the budget on the cheapest
qualifying assets and spread the rest evenly across the range **up to and
including the largest**, which keeps the big-piece answer reachable on a deep
roster.

Only offer "drop your ask" when there is more than one asset on their side:
dropping the only thing you asked for does not make a cheaper trade, it makes a
donation.

**For a CAP refusal the closers are money moves, and there are exactly two.**
What lands on the club's cap is the base salary travelling with the men it
receives, less what it frees by sending its own out — and **picks weigh nothing**,
so no amount of draft capital can move it. So: ask for one of their contracts to
come back the other way (filter on `tradeCapEffect(...).frees >= shortfall`), or
take one of yours off your side (filter on `takesOn >= shortfall`). Use the same
`frees`/`takesOn` the gate itself uses; the threshold is exact, since a move that
covers less than the shortfall cannot clear it alone. Order least-disruption
first: the smallest money move that actually clears it.

**Run the user-side gates the executor runs and the evaluation does not** — his
cap and his roster limit — and only for the candidates about to be shown. A
suggestion the Confirm button would refuse is worse than no suggestion. (The AI's
own books are already settled, because a candidate only reaches here having come
back accepted and the evaluation refuses on the club's cap before value.)

**Band the verified package qualitatively**, off the evaluation that accepted it:

```
pct = (ev.ratio / ev.requiredRatio) * 100
pct < 108  -> 'ONLY_JUST'
pct <= 125 -> 'COMFORTABLY'
else       -> 'ROOM_TO_SPARE'
```

Use the acceptance meter's own overpay mark (108) and say "room to spare" in the
same words the meter uses, not in points — past 125 the club is being handed
materially more than it asked for, and a GM should be told before he clicks.

Report `examined` and a `truncated` flag. Let `truncated` change only the
**wording of the empty state** — never a claim that something works.

Return the complete selection each suggestion produces (`give` + `get`), so a
one-click apply sets it exactly.

### 6.13 Trade retrospectives

Snapshot, at execution: `{ type, id, label, position?, ovr?, value }` per asset,
both directions, with the club abbreviations and the league year. Carry `ovr`
so the wire can say "91 OVR EDGE Marcus Lane" without re-reading a row that has
since moved, and so a retrospective years later can show what the club thought
it was buying rather than what he became — and make it **optional**, because
records written before the field existed have no answer and a career page must
not print a confident 0 for a man nobody measured.

**Grade with a NEUTRAL profile on both ends** (a flat 0.5/0.5/0.5, no team
needs). A real trade grade compares what an asset is worth in the abstract, not
how badly one side wanted it that day. Team-specific need is exactly what makes
two GMs agree to a trade in the first place; grading through that lens rewards
whichever side's needs happened to shift favourably, not who got the better
assets.

Price the snapshot's picks in the same order of precedence the live valuation
uses (seeded slot, else projection, else stored placeholder) — a snapshot of a
deal made mid-draft has to say what the selection **was**.

Re-price now, per asset:

- player missing from the league → 0, "No longer in the league."
- retired → 0, "Retired since the trade."
- else re-value, and note the direction: ≥ +15% "Blossomed into a N OVR
  player."; ≤ −15% "Has fallen off — now N OVR."; else "Still producing at N
  OVR."; free agent → "Now a free agent, N OVR."
- pick gone → 0; **pick unused → `null`**, "Still on the board — not used yet."
- pick used → value the player it became, "Became <Name> (<POS>), now N OVR."

**`null` means ungradable, and it must propagate.** A side holding any unused
pick has no "now" value, the whole trade is `pending`, and the verdict is "Too
early to call — at least one future pick from this trade hasn't been used yet."

**Grade on GROWTH relative to what each side's return was worth at the time**,
not on who has more value now — a side that took a straight star already "won"
the day of the trade, and the interesting question is whether that lead grew,
shrank or flipped:

```
aGrowth   = aValueThen > 0 ? (aValueNow − aValueThen) / aValueThen : 0
growthGap = aGrowth − bGrowth          // positive favours A
EVEN_BAND = 0.08, LOPSIDED_BAND = 0.35
```

**A's return is what A RECEIVED.** Use the same side for each club in "then" and
"now", or the before/after comparison silently compares the wrong assets.

Export `growthGap` and make anything that **ranks** trades (a GM career page's
best and worst deal) read that field rather than recomputing a growth comparison
of its own, or a panel headed "best deal" ends up sitting over a verdict that
names the other club. Export the per-club edge (`+growthGap` for A, `−` for B)
and the same three-way call as a value (`WON` / `LOST` / `EVEN` / `PENDING`) off
the same gap and the same bands, so a surface that wants to **claim** a trade
cannot boast about a deal the verdict beneath it calls fair.

**Filter on the query, not on the result.** Grading is not cheap: each record
re-prices every asset with its own read, on top of a league-wide scarcity scan.
Have the trade screen ask only about the club the GM is sitting across from, and
leave the full history to the one screen where reading it is the reason you came.

### 6.14 The AI's unsolicited offers, and the league that trades without you

**One unsolicited offer, on a dice roll, from a club with real depth.** Pick a
club, read its needs, and shop a man from a position where need is near zero
(< 0.15) who is **not** a core starter (rating 67–89; fall back to 65–83 on the
whole roster). Price him **with the club's own roster in hand**, so the ask
reflects that he is surplus — without it the AI priced its fourth receiver as
though he were about to start somewhere. Then find the **cheapest** pick of the
user's (by this club's own pick scale) that still covers ~0.8x the ask, rather
than reaching for his best future first every time.

**Refuse to shop a man the club would have to pay someone to take.** A finished
value can be negative, and unguarded the ask goes looking for the cheapest pick
worth at least 0.8x a **negative** number, matches the user's last seventh, and
puts an albatross on his desk described only by rating and position — and if the
response path executes an accepted offer without re-evaluating it, nothing
downstream catches it. Shopping surplus and dumping salary are different moves;
this function is the first one.

**If you build a background trade market — and you should — put no second
acceptance model in it.** Until the reference implementation had one, the league
re-signed, signed, cut and drafted on its own and never traded: **25 TRADE rows
across 272 leagues**, about one deal per nine leagues ever. Every other market
ran whether the player was watching or not; the trade market only existed while
he had the screen open. So there was no trade market — there was a trade screen.

What it buys is what the standings, the cap sheets, the draft board and a man's
career page all sit downstream of: a contender that got stronger in week 9
without asking, a rebuild that turned a 31-year-old into two picks, a target that
is gone by the time you go looking for him.

The rule, in one line: **nothing in that module may decide a trade is good
enough. It may only decide a trade is worth asking about.** A search heuristic is
a different thing from an adjudicator — asking the real evaluation about every
pair of clubs and every asset is 496 pairs times a roster, and one call measures
**30.8ms** — so let the heuristic pick plausible pairs and assemble a plausible
package, and let it be **wrong**: when it is wrong the adjudicator says no and
the tick moves on. A candidate generator that gets it wrong is slow. A second
acceptance model that gets it wrong is a lie.

Screen hopeless pairings in memory with a bar you **derive** rather than guess.
Both sides must accept and each is charged twice: the club giving a man up wants
its own valuation plus the poach premium plus the accept ratio; the club taking
him on writes him down by the dump haircut and wants the accept ratio on top.
Write both bars out, cancel the package, and what is left is a condition on the
two clubs alone:

```
(buyer's price for the man / seller's price for the man)
  × (seller's price for a pick / buyer's price for a pick)   >=  1.04 × 1.07 / 0.93  =  1.20
```

Use **1.24** rather than the bare 1.20 — a small margin for the fit and scarcity
terms the screen cannot see — and treat it as a floor on **asking**, never a
verdict: clearing it buys a candidate the right to be put to both clubs, twice,
and nothing else.

Write the deals through the ordinary executor with the override **unset**, so the
gate holds for both clubs, the roster limit holds, proration accelerates onto the
seller, the charge is dated correctly, picks genuinely change owner, both depth
charts reconcile, and the deadline closes this market on exactly the week it
closes the player's.

Guard rails, all measurable, and all of them about not stripping the user's
board before he can act: `MAX_EVAL_CALLS_PER_TICK = 60` (about 1.8s worst case),
`ATTEMPTS_PER_DEAL = 12`, `SWEETENER_TRIES = 1` (if the seller is short but
inside its counter window, add the next pick and ask once more — that is a phone
call; more rounds is a search, and a search belongs to the player),
`CLUB_SEASON_CAP = 3` (a rebuilding club selling a 91 for picks is the point; a
rebuilding club selling its whole roster is a bug), `PAIR_COOLDOWN_WEEKS = 4`
(stops the market undoing last week's trade, which is the shape churn takes when
both sides sit near the line), `PLAYER_COOLDOWN_SEASONS = 1` (nobody bounces
between clubs inside a season), `ELITE_OVR = 88` with
`ELITE_MOVES_PER_SEASON = 3`, `MIN_KEPT_AT_POSITION = 1` (trading the only man at
a spot is not a rebuild, it is a hole nobody chose), and
`MIN_ASSET_ROUND = 3` — read the minimum off the chart as the value of the **last
pick of round three** (116 points, about a 78 overall at a premium position: a
rotation player, not a body) rather than writing a point total down.

Report diagnostics counts (candidates, refused by seller, by buyer, by both,
cap-or-roster blocked) and spend them on tuning only. A market that quietly
produces nothing is indistinguishable from a market that is switched off, and the
difference matters: a shortlist that never finds a pairing is a different defect
from one whose packages the buyer always refuses. Store no verdict and let nothing
read these counts to decide anything.

---

## 7. The invariants — build this suite BEFORE the systems it checks

Two commands, and make them gate a release the way a real test suite would
(non-zero exit on any failure):

```
check:money   money conservation, 8,969 assertions across composed mutation sequences
check:cap     the whole contract-rules family, in order:
              restructure (pure) -> restructure (write) -> franchise tag
              -> re-sign -> fifth-year option -> money conservation
```

In the reference implementation **every one of these found defects that code
review did not.** Write them first. The single-mutation checks are cheap and
each one paid for itself; the composed one is the only thing that catches the
class of bug that actually destroys saves.

### 7.1 Conservation is the spine

> **Over a contract's whole life, plus any dead money it leaves behind, what is
> charged equals what is owed. Nothing appears, nothing evaporates.**

Concretely, for every bonus dollar ever paid on a man — original, converted, or
newly signed — assert that it is charged to **some** club's cap in **some** year
**exactly once** by the end of the chain.

### 7.2 Check sequences, not single mutations

This is the point of the suite. **Every defect in this area's history was found
in a single mutation examined on its own; a save is destroyed by the SECOND one**,
because that is where a figure written in one frame is read back in another.

Drive, two and three deep, and hold the whole chain to one sum at the end:

- restructure × 2
- restructure → extend
- tag → extend
- extend → trade
- trade a man **mid-restructure-year**
- then release him

Drive them through the **real write paths** against a real database, not through
the arithmetic — the arithmetic was never the half that broke.

### 7.3 The clauses to assert

**Money conservation (`check:money`):**

| id | claim |
|---|---|
| M-1 | **A trade conserves the bonus.** Bonus billed to the seasons already played + what the trade books onto the selling club + what still prorates on the row that travels = the bonus the club actually handed over. |
| M-2 | **Both ledgers move by exactly `tradeCapEffect`**, read off the live cap-summary function the cap page and every refusal run on — not recomputed. This is the clause bug #1 failed, and it failed it on the **buyer's** side, which is the side a cap gate has to protect. |
| M-3 | **The gate quotes the figure the executor writes.** Sum the gate's deltas per club and hold them against the movement the ledger actually recorded. |
| M-4 | **A release costs `deadMoneyOnCut`, exactly, once**, driven through the real cut path and read back off the `CapCharge` ledger. |
| M-5 | **A sequence conserves** — the compositions in §7.2. |
| M-6 | **The ledger and the summary agree.** Multi-year sheet column zero against the cap summary: same year, same ceiling, same active salary, same booked dead money. The masthead tile and the outlook chart are exactly that pair. |
| M-7 | **No impossible money**, over every contract in the league after the whole sweep: no NaN, no Infinity, no negative cap hit, no negative dead money, no negative years, no proration over a window of zero, no guarantee below the bonus already handed over. |
| M-8 | **Every charge files in the book year**, exercising **both sides of the roll**, for the cut path and the trade path alike (§9). |
| M-9 | **The meter and the write are one gate, and the room it promises is the room the ledger gives.** Ask it **behaviourally** rather than by re-deriving the server's figure: squeeze the club's room to exactly what the panel says the deal adds, then actually write the deal. |

**Restructure, pure arithmetic (55k shapes):**

| id | claim |
|---|---|
| R-1 | A **zero-dollar** restructure is a no-op: same cap hit this year, same figure in every remaining year, same dead money. |
| R-2 | Total proration charged across a deal's whole life equals the bonus actually paid, **however many times it is restructured**. |
| R-3 | A zero-dollar restructure moves no money between years either. |
| R-4 | The guarantee stays in the same frame as the bonus. |
| R-5 | `converted` reports what was actually converted, and no year pays under the league minimum. |
| R-6 | An extension carries the unamortised bonus too, and the life-of-deal total is conserved. |

**Restructure, the write:**

| id | claim |
|---|---|
| W-1 | Every field the pure function computes is the field that is stored. |
| W-2 | The **consequence**, not just the field: dead money after the write is what the restated guarantee implies. |
| W-3 | The ledger the cap page reads agrees with the contract. |
| W-4 | A restructure still moves money rather than making it. |
| W-5 | After an extension, dead money rises by exactly what was converted and by nothing else. |

**Franchise tag:** F-1 conservation; F-2 the tag costs the tag value and no more;
F-3 the ledger moves by exactly `tagValue + accelerated − oldHit`, read off the
summary; F-4 the figure the tag books is the same bonus a cut would accelerate;
F-5 nothing is invented either (a deal with no unamortised bonus left books
nothing); F-6 the charge files against the year the club is actually in.

**Re-sign:** R-1 nothing paid goes uncharged; R-2 the same bonus every other exit
charges; R-3 re-signing never frees more cap than his old hit; R-4 appending is
not replacing and must not double-charge; R-5 nothing is invented either; R-6 the
charge files against the year the club is actually in.

**Fifth-year option:** O-1 conservation; O-2 **the season in front of him does
not move** (his fourth-year hit is unchanged to the dollar); O-3 the option year
costs the option salary and nothing else (no bonus proration on it); O-4 it is a
real premium (strictly more than his own fourth year); O-5 once exercised it is
guaranteed and a release pays for it, driven through the real cut; O-6 declining
moves nothing at all; O-7 it is answered once (a second answer in either
direction is refused); O-8 round one only, enforced by the **write path** and not
only by the UI.

**Negotiation agreement:** sweep the widened state space typed entry opens up and
assert the clamp is closed under it; assert the browser decision and the server
decision reach the same verdict, the same band, the same patience cost and the
same cap delta for the same offer; assert the AI's written contract matches the
package its floor was priced for.

### 7.4 Make the harness prove it can fail, every run

A check that reads a field which is not there compares `undefined` to
`undefined`, reports a pass and tests nothing. The reference implementation made
this mistake and paid for it: one probe read `stats.receptions` where the field
was `rec` and cheerfully reported **28,534 samples of 0.0000**.

So every run must fire:

- **(A)** an assertion of a knowingly **false** claim — it must **fail**;
- **(B)** the `undefined`-vs-`undefined` trap — it must **fail**;
- **(C)** a field-presence check on a deliberately **misspelled** column — it
  must come back undefined.

If those do not produce **exactly** the expected failures, fail the whole run
outright, because its assertions do not work.

### 7.5 Harness hygiene

- **Build your own league and destroy it.** Never read, write or delete a league
  the harness did not create, and tear down **by collected id**. Sweep the cap
  charges explicitly and count the leftovers even when they cascade — a check
  that leaks rows into a shared database is a check nobody will run twice.
- **Sample blind.** Take subjects in `id` order, never
  `orderBy: { rating: 'desc' }, take: N` — a sweep that only ever looks at the
  best players measures the best players.
- Run the money check **last** before sharing a build. Every defect it is built
  around silently corrupted a save somebody had already put seasons into.

---

## 8. Known simplifications — write these down in your README

State each of these where a player can read it, rather than letting a GM infer a
rule the game does not have:

- No post-June-1 designation: a release lands entirely on one season.
- No exclusive/non-exclusive franchise tag split, and no escalator for a second
  consecutive tag on the same man (that needs contract history the schema does
  not keep once a contract is replaced).
- One tag per club per league year.
- One `signingBonus` column, so an extension or a restructure re-prorates the old
  bonus's unamortised remainder alongside the new one instead of keeping two
  schedules. Conservation holds; the shape shifts a little money later on deals
  past the proration window (§4.5). **If you give the row a list of bonus
  tranches instead, this simplification disappears — and keep conservation as the
  thing you test.**
- The fifth-year option is guaranteed in full on exercise, not in the real
  two-stage injury-then-full form.
- No cap carryover between years other than the overage carry in §9.4, and no
  cap penalties beyond it.

---

## 9. The year-skew trap — get this right or two bugs are latent for months

### 9.1 The trap

Age the contract ledger **at the final whistle**, inside the playoffs' last step,
before the phase even flips to the offseason. But `League.seasonYear` does not
move until the standings-reset step, which is the **second** step of the first
offseason advance.

So through **OFFSEASON weeks 1–2** there is a window where `capHit` returns
**next** year's number for every man in the league while `League.seasonYear`
still names the season just played. **The ledger and the clock disagree by a
year.**

### 9.2 The rule: write and read every money figure in the BOOK year

```
capChargeYear({ phase, week, seasonYear }):
  beforeYearRoll = phase === 'OFFSEASON' && week <= OFFSEASON_YEAR_ROLL_WEEK    // 2
  return beforeYearRoll ? seasonYear + 1 : seasonYear
```

Real football has the same boundary and answers it the same way: a player
released after the season ends but before the new league year opens counts
against the **new** year.

Date every write by this: cuts, the tag's acceleration, the re-sign's stranded
bonus, the trade's acceleration, the void-year bill. And **read against it too**:

```
bookYearFor(league, askedFor) =
  askedFor !== league.seasonYear ? askedFor
  : capChargeYear({ phase: league.phase, week: league.week, seasonYear: askedFor })
```

Shift **only** the current league year. A caller naming any other year means that
year literally — and there is exactly one such caller, the closing-year
settlement (§9.4), which asks for the **closing** year while the league row has
already stepped onto the new one and must get it unshifted or the settlement
restates itself off the wrong season.

Keep the week constant as an index into the **step list**, not a count of
advances. In the reference implementation collapsing the offseason into two
presses meant one press carries three steps, so a league goes from week 1 to week
4 and the pre-roll window is a single observable week rather than two — but the
step at week 2 is still the standings reset, so the boundary is unmoved and a
save stranded mid-roll by an older build still reads right. **Move this constant
only if the roll step moves within the step list, not if the steps are regrouped
into different presses.**

### 9.3 The two bugs this closes, both measured

**Reading the clock when the ledger had moved** produced a figure that described
no league year at all. Measured on a scratch league driven four seasons, one club
at OFFSEASON week 1 was shown:

```
ceiling      $262.7M   the 2029 ceiling — the season just PLAYED
salaries     $274.1M   2030 terms — the ledger had already rolled
dead money     $3.7M   2029 charges — a closed season's bill
----------------------------------------------------------------
on screen    −$15.1M   three years stitched into one number
```

One advance later, with **no transaction of any kind**, the same club read
**−$8.8M**: the ceiling moved onto 2030 (+$2.6M) and the 2029 dead money stopped
being counted (+$3.7M). That **$6.4M was never real** — the 2029 bill had already
been paid out of the 2029 books, so charging it again on top of next year's
salaries is a double count. The owner watched his room go **$918K → $9.07M →
$27.0M** across a playoff exit and an offseason and asked where the money came
from. Every figure was right; what was wrong was the **label** — next year's cap
sheet under this year's date, with nothing on screen saying so.

**And it ran the other way, which is the dangerous half.** The cut path dated its
dead money by the **new** year (correctly — the new year is the one that will pay
it), so a release booked a charge the reader was not reading. Measured: releasing
an **$80.6M** dead-money contract at OFFSEASON week 1 moved the club from −$6.8M
to **+$39.2M** on screen *and in the cap gate*, for a move that actually left it
**$34.6M worse off**. One advance later the same club read **−$35.0M**. A GM
cutting his way out of a bad number in that window was being shown a windfall for
a catastrophe.

**Make the reader follow the ledger**, because the write paths already do. Also
filter booked rows to `year >= bookYear`: between the ledger rolling and the
stale-charge sweep, a settled row is still sitting on the table and counting it
bills the club twice for one season for the length of the whole pre-roll window.

Rejected, and do not revisit: **moving `League.seasonYear` forward at the end of
the playoffs** so the two never disagree. It is the honest shape and it is not
surgery — the standings-reset step closes the season's stats, awards and
standings against that same field, the progression summary calls it "the season
just played", and every offseason transaction is stamped with it. One seam would
close and five would open. Rejected: **leaving the arithmetic and explaining the
jump in words** — the number is a closed season's bill added to a new season's
salaries under an old season's ceiling, and there is no honest sentence for that.

**Carry a `preRoll` flag and say it on screen.** Through those weeks the league
clock in the header reads one year while the cap sheet reads the next, and the
panel must say so.

**Do not enforce compliance during the roll.** The books are legitimately mid-roll
there: every deal has been stepped onto its next (escalating) base-salary year,
but expiring contracts do not drop off the ledger until the re-sign window closes.
A sim-health trace across four seasons shows this window is exactly where clubs go
negative and where they come back on their own — over-cap clubs appear at
OFFSEASON wk1 and clear the moment free agency opens, every year, league-wide.
Blocking there fires on almost everyone every single offseason for a condition
that resolves itself one step later: a rule that reads as a bug. Demand compliance
from the new league year onward, which begins at free agency — the same boundary
that reopens trading. Export that predicate so the standing banner promises
exactly what the gate enforces instead of threatening a block that will not
happen.

### 9.4 Close the roll honestly: settle, then sweep

**Order these three, and the order is the whole fix.**

1. **Settle the closing year's overage, from inside the aging step**, before the
   ledger steps. That is the last moment the closing year's cap position can be
   read at all, because aging rewrites every cap hit into next year's terms.
   For every club: delete this settlement's own previous row for the year (so a
   re-run restates rather than compounds), read the closing year's position
   **unshifted**, and write `max(0, −capSpace)` into the **new** year as a real
   `CapCharge` labelled `Cap overage carried from <closingYear>`.
2. **Age the ledger**: decrement `yearsRemaining` for every ACTIVE player's
   contract above 0.
3. **Sweep charges dated before the new year.**

Why the settlement must exist at all: dead money here is a one-year charge, and
the sweep is the right shape for a club that **had** the room — spending real cap
space on a mistake is what paying for it means. It was catastrophically wrong for
a club that did not. Measured, the same **$74.6M** albatross released on four
clubs:

```
PRESEASON wk1  $34.9M of real space  ->  $39.7M vanished at the roll
REGULAR   wk4  $31.5M of real space  ->  $43.1M vanished
PLAYOFFS  wk19 $24.0M of real space  ->  $50.6M vanished
OFFSEASON wk1  filed against the new year — paid in full, correctly
```

And the loop it opened: restructure twelve men to convert base into bonus,
banking the relief this year, then release all twelve in the playoffs. Every
dollar of proration those restructures owed to later years accelerated into a
charge that midnight deleted.

**Carry the OVERAGE, not the charge.** Re-dating the dead money itself would bill
a club that had $80M of genuine space exactly as hard as one that had none, and
would make releasing a man in the last week of a season you were comfortably
under strictly **worse** than releasing him in the first. The overage is the part
that was never funded, which is precisely the part that has to survive the
calendar.

**Do not cap the carry.** A ceiling on it is a hole the exact size of the
ceiling, and the invariant it restores says "exactly". It cannot be reached by
accident, because the advance gate already refuses to advance a club that could
cut its way back under — the only way to end a year over is to be past the point
where cuts help, which takes a deliberate teardown. And it liquidates itself: any
year the club spends less than the ceiling, the debt shrinks by the difference.

**Apply it to every club, not just the user.** It is a salary cap. Measured
across a full generated league at a season's close, **0 of 31** AI clubs were
over it (median space $98.8M) — they are gated at transaction time and simply do
not get there, so applying the rule league-wide costs nothing and means the
ledger says the same thing about everybody.

Narrow it to REALISTIC: simplified has no dead money and off has no ceiling, so
neither has an overage to carry.

**Make the aging step idempotent and claim it with a compare-and-set**, keyed on
a stored "contracts aged through year" column. A plain read-then-write is not
enough: two advances landing together both pass the read, and this step is not
idempotent in either half — aged twice, every contract loses two years for one
season of football; settled twice, the loser reads a ledger the winner has
already stepped forward and restates the closing year's overage off next year's
hits. Roll the mark back on failure, because the alternative failure mode is the
one the phase machine cannot survive: **marked but un-aged means no contract in
the league ever expires again, and nothing on screen would say so.**

### 9.5 Release the expiring class, and make the delete the claim

When the re-sign window closes, release everyone still at `yearsRemaining === 0`.
Void years settle here.

**Order the three writes: delete, then charge, then free-agent him.** This is the
one place to resist a `delete` by primary key that throws on a missing row. The
reference implementation had exactly that, and it threw on ids the query had just
returned — which reads as impossible until you notice a second advance in the same
window releasing the same men. It could have been left as a shrug; it must not be,
because the cap charge was written **first**, so two runners both booked the
void-year bill before either deleted anything, the club paid the same stranded
proration **twice**, and only the crash said so. Deleting first turns the row into
the token: exactly one runner can take a given man off the books, and only that
runner charges his club and puts him on the street. Anyone arriving second finds
nothing to take and moves on.

Charge `strandedVoidBonus` via the shared function, labelled `Void years —
<Name>`, dated to the league year the deal ran out in — the same label and the
same figure the runway promised a year earlier. Without this the void-years slider
is free money, because a cap charge would only ever be raised by cutting a player
early.

### 9.6 Tell the user what just left the books

When the expiring class walks, quote what it was costing with the **same**
`capHit` the cap summary sums, so the figure in the advance summary is exactly the
figure that leaves the committed tile one moment later. Deriving it any other way
is how this app has repeatedly shipped a sentence quoting a number it was not
using.

---

## 10. Where to deviate, and what to measure if you do

These are the places the reference implementation is least confident. Decide them
yourself, but keep the measurement discipline.

- **`MARKET.SCALE` and the whole price level.** Tagged a fragile placeholder.
  Moving it reprices every contract in the game, and the reference implementation
  left a measured discrepancy in place rather than retune: a generated club
  actually carries **47.4 men costing 99% of the base cap at market** (median
  94%), where the calibration comment claimed 92% of a 53-man roster. Re-measure
  against **your** roster generator's output before you trust either number.
- **The position multipliers are one scalar per position, so they cannot say
  "top-heavy".** The real receiver market is far more top-heavy than 1.27 says: a
  genuine WR1 is worth more and a fifth receiver less. Fixing that needs a
  per-position **curve shape**, not a bigger multiplier, which would just overpay
  the depth.
- **The MID trade tier's ceiling (1500) is headroom, not an anchor.** No tight end
  or linebacker has ever fetched a first and a high second, and the curve does not
  reach it below 99. If you want MID anchored, find a real trade for it.
- **Nothing below round one of the pick chart is bent**, even though the
  measurement says the chart runs under the best case from pick 48 on (0.88x) and
  far under it in round seven. That is a different claim needing different
  evidence; if you bend it, measure the same best-case yardstick at every slot
  first.
- **Parking tuning constants beside their function instead of in the tuning
  module** is a smell the reference implementation carries deliberately in one
  place (the term constants). Put yours in one place.
- **The re-sign reserve (`CAP_RESERVE = 10_000_000`) and the tag reserve
  (`TAG_CAP_RESERVE = 2_000_000`)** are a football statement, not an arithmetic
  one: a club that tags its best player has decided that man **is** its
  offseason, so it holds back far less than the re-sign wave does. Roster
  **legality** is reserved separately, per open slot, and is not negotiable.
  Re-derive both against your own AI budgeter rather than copying them.
- **The AI's tolerance constants are the two you should measure against your own
  league**, because both were set by sweeping real outcomes:
  `FIFTH_YEAR_OPTION_TOLERANCE = 1.75` (what an AI club will pay for an option as
  a multiple of the man's market APY — measured on 52 first-round options over
  two scratch leagues: ratio p10 1.13, p25 1.30, p50 1.90, p75 2.58, p90 4.50,
  and candidate ceilings exercising 4% at 1.00, 29% at 1.50, 44% at 1.75, 56% at
  2.00, 75% at 2.50; the real sport picks up about half, and erring low makes the
  AI a tougher grader rather than a rubber stamp — a club that declines an option
  it should have taken loses a player, a club that takes one it should not is
  stuck with the salary, which is the worse of the two to make thirty-two times a
  year) and `TAG_PRICE_TOLERANCE = 1.20` with `TAG_MIN_OVR = 88`.

  The tag pair is worth copying the reasoning for. Measured on the dev database
  before it existed: **2 TAG rows across 270 leagues**, against 52,047 re-signs,
  40,346 signings and 13,968 cuts — so an elite man whose club could not reach
  terms reached free agency **every single time**, however much room that club was
  sitting on (a 99 quarterback walking from a club holding $50.9M). Test the
  **price**, not the rating, because the tag costs the top-five average at the
  position and so has nothing to do with the man being tagged: measured over
  66,203 rostered players in 46 leagues, the median tag is $32.9M at QB (12.9% of
  a $255M cap), $22.5M at EDGE, $20.3M at CB, $12.2M at LB, $8.4M at RB and
  $3.0M at K. A rating bar alone means something completely different at
  quarterback than at safety. The honest comparison is tag price against market
  value, which already knows position, age and ceiling — median ratio by overall:

  | ovr | 99 | 96 | 93 | 91 | 90 | 88 | 86 | 84 | 82 | 80 | 76 |
  |---|---|---|---|---|---|---|---|---|---|---|---|
  | × | 0.61 | 0.75 | 0.89 | 1.02 | 1.04 | 1.14 | 1.29 | 1.43 | 1.60 | 1.80 | 2.48 |

  It crosses 1.00 at **91**: at that quality and above the tag is *cheaper* than
  what the open market would pay, and a club that lets him walk has turned down a
  discount. Keep the tolerance above 1 because the tag is not the same good as a
  contract — one fully guaranteed season, no bonus, no dead-money tail, no bidding
  war, and he cannot leave. Keep it far **tighter** than the option tolerance for
  two reasons that are both scarcity, not taste: a club answers every
  first-rounder's option but has exactly **one** tag a year, so paying it on the
  wrong man costs the right man as well; and the option buys an ascending
  24-year-old while the tag buys a veteran at the top of his market who is more
  likely to be leaving his best football behind him. 1.20 lands the bar at roughly
  overall 87 in a prime-age man and pulls it up sharply for an older one — an 88
  at 27 is tagged, an 88 at 33 is not, and no constant had to know that. Keep the
  rating floor as a **floor, not the test**: without it the price test alone tags
  a kicker whose $3.0M tag happens to sit at his market — cheap, defensible on the
  spreadsheet, and a waste of the one tag a club gets.
