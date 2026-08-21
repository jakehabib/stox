# AI re-sign wave: measured failure

Date: 2026-08-21. Measured against league `cmt1kszlw0000ev4xfigg0ysg`
("Stats Verify"), 2027, phase RESIGN — i.e. *after* `runAiResignWave` has
already run for that league year. `capMode = REALISTIC`.

## What the numbers say

```
AI rostered players (31 teams):                     1,318

yearsRemaining distribution
  0 yr   533        <-- already expired
  1 yr   513
  2 yr   173
  3 yr    64
  4 yr    29
  5 yr     6

expiring (<= 1 yr):                                 1,046   (79% of the league)
  clearing the AI's own floor (trueOvr >= 62):        564
  clearly worth keeping    (trueOvr >= 74):           155
contracts actually signed in 2027:                     44   (7.8% of eligible)

AI STARTERS on expiring deals:                        320   (10.3 per team)
teams over the cap after the wave:                    0/32
```

So on entering the re-sign window, **every AI team is about to lose around ten
starters and thirty-four players**, and the wave rescues roughly one and a half
players per team. The user would arrive in free agency to find 31 gutted
rosters and a market flooded with other teams' starters — which is both
unrealistic and trivially exploitable.

## Two separate causes

**1. Structurally, half the league expires every year.** `suggestedYears()` in
`lib/cap.ts` returns 2 years for anyone under 66 overall, which is most of a
roster:

```
age >= 33            -> 1
age >= 31            -> 2
ovr >= 82, age <= 28 -> 5
ovr >= 74            -> 4
ovr >= 66            -> 3
otherwise            -> 2
```

League generation *does* stagger how far into each deal a player starts
(`elapsed = rng.int(0, years - 1)` in `lib/gen/league.ts`), but with a 2-year
deal that only produces `yearsRemaining` of 1 or 2 — so half of every
sub-66 player is expiring in year one, and the whole cohort re-expires two
years later. `isRookieDeal` is set on a coin flip without granting rookie-deal
length, so young players don't provide the long contracts that would smooth
this out either.

**2. The wave itself keeps almost nobody.** In `resignDecisionsForTeam`
(`lib/season.ts:863`):

- `willingness = 0.35 + winNow * 0.3 + need * 0.35` — a coin flip at best, and
  it is rolled *before* any value check, so a 90-overall starter is dropped on
  a die roll.
- Players are iterated in roster order, not by value. A team spends its cap
  space on whoever appears first and then fails the `usable < apy` test for
  everyone after — including its stars.
- `teamCapSummary` is recomputed inside the loop, so the pass is also
  O(teams x expiring) database round trips (~1,050 summaries per wave).
- Nothing logs a RESIGN transaction, so the league news wire shows none of
  this happening. (Extensions land as `SIGN`; 52 were recorded league-wide.)

## What a fix has to achieve

- Contract lengths spread so that a normal year expires a plausible slice of a
  roster, not most of it. Rookie deals should actually be long.
- The wave should sort by value and keep what it can afford, starting with
  starters, rather than spending in arbitrary roster order.
- Willingness should modulate *how hard a team tries* (price, years), not
  whether it bothers to look.
- Teams must still finish cap-compliant — 0/32 over the cap is the one thing
  the current wave gets right and must not regress.
- The wire should show re-signings, since from the user's side an AI team
  keeping its franchise quarterback is news.

---

## Correction to the causes above (measured after the fact)

Two numbers in this document were misread, and it matters because they point
at the wrong clause:

1. **564 is not "the players who clear the AI's floor."** `worthKeeping` was
   `trueOvr >= 62 && (trueOvr >= 74 || need[pos] > 0.3)`. 564 clears only the
   first half of that conjunction; 386 of those 564 are 62-73 OVR at a
   position scoring `need <= 0.3` and are dropped with no die roll and no
   price check. Only **178 of 1,046** ever reach a price check, so the
   effective floor was 74, not 62 — and the need gate cost ~386 players a
   year where the willingness roll cost ~76. The gate was also circular:
   `teamNeeds()` ran over the full roster, which still contained every
   expiring player, so a team about to lose its starting corner read
   `need[CB]` as ~0 *because that corner was still on the books*.
2. **"52 extensions"** is 49 rows headlined `Extended …` plus 3 ordinary free
   agent `Signed …` rows — 52 `SIGN` rows in total, not 52 extensions.

Everything else in this document reproduces exactly.

## Resolution

Fixed in the contract-economy repair:

- `suggestedYears()` no longer bottoms out at 2 years; league generation puts
  every player with `experience <= CAP.ROOKIE_EXPERIENCE_MAX` on a real
  `CAP.ROOKIE_DEAL_YEARS` contract, staggered by his actual experience rather
  than a coin flip. Measured over 32 generated rosters, mean contract length
  goes 2.63 -> 3.65 years and steady-state expiry 38% -> 27.4%/yr.
- `resignDecisionsForTeam()` was rewritten: one cap summary per team with a
  running local budget, candidates in value order (would-actually-walk first),
  needs computed on the roster *minus* the expiring class, no willingness die
  roll — willingness now sets price, term and how far down the roster a GM
  will go — and a depth comparison in place of the need gate.
- Re-signings write a `RESIGN` transaction with a `Re-signed …` headline. Both
  consumers (the news-wire type filter and `lib/newsCategory.ts`) already
  handled the type; nothing had ever produced one.
- The salary cap now actually grows (see `lib/leagueYear.ts`).

Measured over a five-season all-AI run, before -> after: AI re-sign retention
3-18% -> 46-64%, players hitting free agency per year ~450 -> ~170, mean roster
size at the annual post-release trough 24-29 -> 37-48, teams over the cap
0/32 -> 0/32.
