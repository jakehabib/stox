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
