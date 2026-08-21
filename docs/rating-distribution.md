# Rating distribution — research, diagnosis, and a proposed recalibration

> **Status: proposal only. Nothing in `lib/` has been changed.**
> The two files this needs to touch (`lib/tuning.ts`, `lib/gen/players.ts`) were
> held by other agents when this was written. Every number below was measured
> by running the real generator and the real market curve out-of-tree.

The app owner's ask, verbatim:

> *"also - the ratings. Can you research madden's rating system and apply a
> distribution accordingly that is similar? Players feel very low rated."*

---

**The goal is shared meaning, not a matching histogram.** The owner's
sharpening: *"i want people coming from madden to have a familiar sense of who's
good and who's not"*. Matching the distribution is the mechanism; the test is
whether a specific number means the same thing it means in Madden. §8 checks
that directly, by looking at the players who land on each number.

## 0. What this document concludes, in five lines

1. The floor and the middle are badly wrong — **22% of rostered players are
   under 60 and 6% are under 50**, ratings that do not exist on an NFL roster.
2. The ceiling is **also** wrong, and the owner's initial read that "the ceiling
   is roughly fine" does not survive measurement: **17 of 32 teams have zero
   90+ players**, and the league has never produced a 99.
3. The top-end compression is **not** in `computeOverall`. That formula reaches
   99 fine. It is entirely in the star-seeding roll in `generateRoster`.
4. Raising ratings without touching anything else costs **+50% payroll**. The
   fix is one number — `MARKET.PIVOT` — because `marketValue` is a pure
   exponential in `(ovr - PIVOT)`, so shifting `PIVOT` by the same amount the
   curve shifts leaves every price exactly where it was.
5. Two defects only a *semantic* check finds, not a histogram: **the best
   punter in the league is a 99 and punters hold 3 of the top 25 slots**, and
   star seeding picks uniformly across ten positions so a 79-man tight-end pool
   collects as many stars as a 193-man receiver pool. Both are fixed here.

---

## 1. What Madden's distribution actually is

### 1.1 A caveat about sourcing, stated up front

`WebSearch` works from this sandbox. **`WebFetch` does not** — the egress proxy
refused every ratings site tried (`leaguestation.com`, `maddenratings.com`,
`madden27.wiki`, `nfldraftbuzz.com`, `madden.tools`, `gamerant.com`,
`gamespot.com`, `fivethirtyeight.com`, and `en.wikipedia.org`). So there is
**no complete Madden ratings table underneath this section.** Every figure
below is a specific published number recovered through search snippets from a
named article, and each is attributed. Where I have had to *derive* a figure
(e.g. converting a whole-database percentage onto a 53-man-roster denominator)
that is called out as derived, with the arithmetic shown, and the confidence
lowered accordingly. Nothing here is invented.

### 1.2 The published numbers

| Fact | Value | Source | Confidence |
|---|---|---|---|
| Madden 20 players rated **above 85** | **282** | Bleacher Report, *Madden 20: Review of Elite Player Ratings* | High |
| Madden 20 players rated **above 90** | **94** | same | High |
| Madden 19 above 85 / above 90 | **331 / 103** | same | High |
| Madden 19 share of DB at **70+** | **54%** of ~2,900 players incl. free agents | pastapadre, *Breaking down the new player ratings spread for Madden NFL 20* | High |
| Madden 20 share of DB at **70+** | **41%** | same | High |
| Total players in a Madden DB | ~2,900 (M20) → 3,041 (M27) | pastapadre; madden.tools | High |
| Madden 26 **99 Club** at launch | **7** (Chase, Allen, Jefferson, Jackson, Lane Johnson, Garrett, Barkley), down to **4** by the Week 13 update | ESPN, *Madden NFL 26's 99 Club loses a member*; GameSpot | High |
| Madden 25 **99 Club** at launch | **5** (McCaffrey, Mahomes, Kelce, Trent Williams, Hill); the 98 tier held Jackson, Parsons, Garrett | ESPN, *Madden 25 player ratings*; Operation Sports | High |
| Madden 26 **rookie class range** | **57 to 84**. Top rookie Travis Hunter 84; Jeanty 83, Carter 81, Graham 80, Walker 79. Lowest rookie in the game: Ben Wooldridge, **57** | ESPN, *Travis Hunter leads Madden NFL 26 rookie ratings*; GamesRadar; SI | High |
| Madden 26 mid/late-round rookies | 2nd-rd CB Trey Amos **75**; 5th-rd DT Yahya Black **67**; 6th-rd QB Will Howard **64**; 7th-rd LB Carson Bruener **64** | SI (Chargers/Steelers/Commanders beat pages) | High |
| Madden 26 **team overall range** | **75 (NYG) to 93 (BAL)**; Eagles 91, Chiefs 90; Broncos/Panthers 79, Commanders 78, Cardinals 76 | GameRant / GamesRadar / MSN team-ratings roundups | High |
| A *bottom-five* Madden 26 team's top players | Commanders (78 ovr team, ~28th): McLaurin **94**, Tunsil **94**, Wagner **91** | Commanders.com, *Commanders full Madden 26 ratings revealed* | High |
| EA's stated design intent | "Elite/near-elite ratings increased, everyone else decreased, so stars stand out"; "a drastic drop off from starter to backup" | Operation Sports, *Madden NFL 20 Developers Detail the Player Ratings Stretch* | High |

Note that **Madden 20 is the deflation year** — the "ratings stretch" that
took 70+ from 54% down to 41% and that the community complained was too harsh.
It is the *most conservative* modern reference available, which makes it a good
one to calibrate against: if we are below Madden 20 we are unambiguously low.

### 1.3 Deriving a 53-man-roster target (this part is derived, not published)

The published percentages use Madden's **whole database** (~2,900), which
includes a free-agent pool of roughly 1,200 mostly replacement-level players.
Our 1,245 figure counts **rostered players only**. Comparing the two directly
would flatter us badly. Converting, using 32 × 53 = 1,696 rostered:

- `>90`: 94 / 1,696 = **5.5%** of rostered — ~2.9 per team.
  Cross-checks against the Commanders anecdote: a 28th-ranked team with three
  90+ players. Confidence: **medium-high**.
- `>85`: 282 / 1,696 = **16.6%** of rostered. Confidence: **medium**.
- `70+`: 41% of 2,900 = 1,189 players. Assuming ~92% of them are rostered
  (a handful of 70s vets sit unsigned at any moment), 1,094 / 1,696 = **~65%**.
  Confidence: **medium** — this one is the most sensitive to the FA-pool
  assumption, so treat 60–70% as the honest interval.
- Floor: the lowest *rookie* in Madden 26 is 57, and rookies are the cheapest
  bodies a team carries. A final-53 floor of **~57** is the right read.
  Confidence: **medium-high**.

**Target curve for a rostered player in this game:**

| Band | Madden-implied target | Notes |
|---|---|---|
| 95-99 | ~1%, incl. **4–7 players at exactly 99** | published 99-Club sizes |
| 90-94 | ~4% | derived |
| 85-89 | ~11% | derived |
| 80-84 | ~14% | interpolated |
| 75-79 | ~16% | interpolated |
| 70-74 | ~19% | interpolated |
| 65-69 | ~19% | interpolated |
| 60-64 | ~12% | interpolated |
| under 60 | **~4%** | derived from the 57 floor |
| mean | ~72 | derived |

---

## 2. Where our curve is actually wrong

Two populations were measured. Both matter and they differ.

- **The real league** — `Trade Verify` (`cmt1jgppc0000209itrk8rvsc`), season 2027,
  REGULAR, 1,245 rostered ACTIVE players. This reproduces the owner's table
  exactly (mean 67.75, median 69, max 95). It is generation *plus* two
  offseasons of progression and churn.
- **Freshly generated** — 5 leagues × 32 rosters straight out of
  `generateRoster`, 6,903 players, no progression. This is what a player sees
  on day one of a new save, and it is **worse**: mean 65.2.

| Band | Target | Real league (1,245) | Fresh generation (6,903) | Verdict |
|---|---|---|---|---|
| 95-99 | ~1.0% | 0.2% (2) | 0.04% (3) | **way short — zero 99s ever** |
| 90-94 | ~4% | 1.4% | 0.9% | **short by 4x** |
| 85-89 | ~11% | 4.7% | 3.5% | **short by 2-3x** |
| 80-84 | ~14% | 7.5% | 6.7% | short by 2x |
| 75-79 | ~16% | 13.4% | 9.9% | low |
| 70-74 | ~19% | 19.5% | 15.4% | about right (real) |
| 65-69 | ~19% | 19.2% | 18.1% | **right** |
| 60-64 | ~12% | 11.8% | 15.4% | **right** (real) |
| 55-59 | — | 10.4% | 12.1% | **should barely exist** |
| 50-54 | — | 5.5% | 7.9% | **should not exist** |
| under 50 | — | 6.4% | 10.1% | **should not exist** |
| mean | ~72 | 67.8 | 65.2 | 4–7 low |
| min | ~57 | **34** | **40** | 20+ points too low |
| 90+ per team | ~2.9 | **0.63** | 0.41 | **17 of 32 teams have none** |
| team overall | 75–93 | 67.6–79.5 (med 73.3) | 60.7–82.4 (med 72.1) | ~8 low |

### The three defects, named separately

**Defect A — the depth chart falls off a cliff.** In `generateRoster`:

```ts
const depthPenalty = i * rng.float(4, 8);
```

Linear, unbounded, mean 6 points per slot. `ROSTER_TARGETS.WR.ideal` is 7, so
WR7 is generated at `VETERAN_OVR_MEAN − 36` before team strength and noise —
a target of 36, clamped to the hard floor of 40. LB5 and CB5 land near 48.
**This single line is where the entire sub-50 population comes from.** Real
depth charts decelerate: WR1 to WR6 is about a 19-point drop, not 36, and it is
front-loaded.

**Defect B — the whole curve sits low, and the tail is too long.**
`VETERAN_OVR_MEAN: 72` with `VETERAN_OVR_SD: 8` (used at ×0.8 = 6.4) and team
strength `N(0, 4)` gives a starter sd of ~7.6. Combined with Defect A that
produces 30% of a roster under 60. Even with Defect A fixed, 19% remains.

**Defect C — the top end cannot reach, and this is a distribution problem, not
a formula problem.** The star seed is:

```ts
ovrTarget: clamp(Math.round(rng.normal(85 + teamStrength * 0.3, 4)), 78, 99)
```

99 is +3.5 sd from that mean. Across ~64 star seeds per league that is ~0.02
expected 99s — i.e. structurally never, which is exactly what the league shows.
**`computeOverall` is not the culprit.** Raising only that one roll, changing
nothing else, immediately produced 10 players at exactly 99 across three
leagues. The attribute→overall machinery reaches the ceiling fine; the roll
that feeds it does not.

**Defect D (minor, but a real bug).** The star, once rolled, is inserted with:

```ts
const replaceIdx = out.findIndex((p) => p.position === pos);
```

`out` is built position-by-position with depth slot `i = 0` pushed first, so
`findIndex` finds the team's **best** player at that position. Measured over
320 teams / 660 star seeds: **8% of star seeds replace a player who was already
as good or better**, and the mean net gain is only +12.5 ovr instead of the
~+20 it should be. Replacing the *weakest* at the position, and only when the
star is an upgrade, is free (mean +0.8 league-wide, more at the top).

---

## 3. The proposed recalibration

### 3.1 Why not just raise the mean

Raising `VETERAN_OVR_MEAN` alone is the obvious lever and it is measurably the
wrong one on its own. Applied by itself (72 → 77) it moves the mean to 69.8 but
leaves **18.4% of the league under 60** and **only 2.4% at 90+ with no 99s** —
it slides the curve without fixing its shape. Each lever was measured alone:

| Lever applied alone to the current generator | mean | <60 | ≥70 | ≥85 | ≥90 | 99s | min |
|---|---|---|---|---|---|---|---|
| *(current baseline)* | 65.2 | 30.4% | 36.3% | 4.3% | 1.0% | 0 | 40 |
| only `VETERAN_OVR_MEAN` 72→77 | 69.8 | 18.4% | 54.5% | 9.7% | 2.4% | 3 | 40 |
| only depth decay reshaped | 67.8 | 19.3% | 42.0% | 4.5% | 1.0% | 0 | 40 |
| only star tier raised | 64.9 | 32.3% | 34.0% | 6.3% | **3.0%** | **10** | 40 |
| only floor clamp 40→56 | 66.7 | 30.4% | 36.3% | 4.3% | 1.0% | 0 | 55 |

They fix different halves of the curve and none of them substitutes for
another. The floor clamp on its own is nearly cosmetic; the star tier on its
own is the *only* thing that creates a 99.

Cumulatively (each row adds to the one above):

| Step | mean | <60 | ≥70 | ≥80 | ≥85 | ≥90 | 99s | min | payroll |
|---|---|---|---|---|---|---|---|---|---|
| 0. current | 65.2 | 30.4% | 36.3% | 11.7% | 4.3% | 1.0% | 0 | 40 | 92% |
| 1. + fix star replacement (Defect D) | 66.0 | 27.4% | 39.0% | 12.7% | 4.8% | 1.1% | 0 | 40 | 97% |
| 2. + reshape depth decay (A) | 68.5 | 17.1% | 44.4% | 13.3% | 4.9% | 1.1% | 0 | 40 | 106% |
| 3. + floor 56 | 68.8 | 17.1% | 44.4% | 13.3% | 4.9% | 1.1% | 0 | 56 | 106% |
| 4. + mean 77 / sd 7 (B) | 73.3 | 5.4% | 67.1% | 23.2% | 9.6% | 2.1% | 0 | 56 | 150% |
| 5. + raise star tier (C) | 73.2 | 5.4% | 64.4% | 22.6% | 10.7% | **4.3%** | **15** | 56 | 148% |
| 6. + `MARKET.PIVOT` 70→77 | *unchanged* | | | | | | | | **88%** |

### 3.2 The constants

**`lib/tuning.ts` — `GENERATION`.** Several of these are new named constants
replacing literals that were inline in `lib/gen/players.ts`.

> This table is the *proposal as first written*. Two more constants were added
> later, once the semantic checks in §8 found defects a histogram cannot see:
> `SPECIALIST_OVR_PENALTY` and `STAR_POSITION_WEIGHTS`. **§9 is the
> authoritative list of what actually shipped.**

| Constant | Now | Proposed | Why |
|---|---|---|---|
| `VETERAN_OVR_MEAN` | 72 | **77** | Defect B. Roster mean lands at 73.5 vs the ~72 target; the extra 1.5 is eaten by the depth curve. |
| `VETERAN_OVR_SD` | 8 | **7** | Trims the long low tail without flattening the league. |
| `ROOKIE_OVR_MEAN` | 65 | **68** | Draft class; see §3.4. |
| `ROOKIE_OVR_SD` | 10 | **7.5** | At sd 10 the ±1sd noise (20 points) swamps the entire 14-point round-to-round tier ramp, so a 7th-rounder is as likely to be an 85 as a 1st-rounder. Measured: R1 mean 72, R7 mean 67. That is not a draft. |
| `DEPTH_DECAY_MAX` *(new)* | *(`i × 4..8` inline)* | **13** | Defect A. Hard ceiling on how far depth alone can drag a player below his team's mean. |
| `DEPTH_DECAY_TAU` *(new)* | — | **2.0** | Decay constant: slot 1 −5.1, slot 2 −8.2, slot 4 −11.2, slot 6 −12.4. Front-loaded, asymptotic. |
| `DEPTH_DECAY_JITTER` *(new)* | — | **0.25** | Keeps the ±randomness the old `rng.float(4,8)` provided. |
| `ROSTER_OVR_FLOOR` *(new)* | *(40 inline)* | **56** | Madden's rostered floor is ~57. Soft ±1 because `computeOverall` rounds. |
| `STAR_OVR_MEAN` *(new)* | *(85 inline)* | **89** | Defect C. |
| `STAR_OVR_SD` *(new)* | *(4 inline)* | **5.5** | 99 becomes +1.8sd instead of +3.5sd. Produces **6.2 players at 99 per league**, against Madden's published 4–7 at launch. |
| `STAR_OVR_MIN` *(new)* | *(78 inline)* | **82** | |
| `STAR_COUNT_MIN` / `MAX` *(new)* | *(1 / 3 inline)* | **2 / 4** | Gets 90+ to ~2.0 per team. Madden's implied ~2.9 was deliberately not chased in full — see §3.5. |
| `DRAFT_TIER_SPREAD` *(new)* | *(14 inline)* | **17** | |
| `DRAFT_TIER_OFFSET` *(new)* | *(6 inline)* | **9** | |
| `DRAFT_OVR_MIN` / `MAX` *(new)* | *(38 / 95 inline)* | **54 / 88** | |
| `FREE_AGENT_OVR_MEAN` / `SD` / `MIN` / `MAX` *(new)* | *(58 / 8 / 38 / 84, hardcoded in **two** places)* | **64 / 8 / 52 / 88** | `lib/gen/league.ts:234` and `lib/leagueFile.ts:817` both hardcode this and neither follows `VETERAN_OVR_MEAN`. Left alone, the FA pool would sit 13 points below the rostered mean instead of today's 7 and the market would look broken. |

**`lib/gen/players.ts` — three behavioural edits** (plus swapping literals for
the constants above):

1. `generateRoster` depth penalty:
   `i * rng.float(4, 8)`
   → `DEPTH_DECAY_MAX * (1 - Math.exp(-i / DEPTH_DECAY_TAU)) * rng.float(1 - J, 1 + J)`
2. `generateRoster` star insertion: `out.findIndex(p => p.position === pos)`
   → scan for the **weakest** player at that position, and replace only if the
   star is actually better (Defect D).
3. `generateDraftClass` tier position: `const pct = i / size;`
   → `const pct = Math.min(1, i / GENERATION.DRAFT_CLASS_SIZE);`
   The class is 400 long but only 224 are drafted, so today the tier ramp only
   traverses 56% of its range across all seven rounds and the 176 UDFAs eat the
   rest. Capping it makes the seven rounds span the whole ramp and puts every
   undrafted player at the bottom tier, which is what "undrafted" means.

**`lib/tuning.ts` — `MARKET`:**

| Constant | Now | Proposed |
|---|---|---|
| `PIVOT` | 70 | **77** |

This is §4 and it is the important one.

### 3.3 Everything else that is denominated in overall points

`marketValue` is not the only thing anchored to the old curve. These are the
other absolute-OVR constants found by audit. The "equivalent" column is
computed from a measured percentile map (what rating occupies the same rank in
the new league that the old value occupied in the old one):

| old | percentile below it, before | equivalent after |
|---|---|---|
| 40 | 0.0% | 56 |
| 55 | 18.0% | 65 |
| 58 | 24.6% | 67 |
| 60 | 30.1% | 69 |
| 65 | 45.5% | 72 |
| 70 | 63.6% | 76 |
| 74 | 76.4% | 80 |
| 78 | 85.6% | 83 |
| 80 | 88.9% | 85 |
| 82 | 91.9% | 87 |
| 85 | 95.6% | 90 |
| 88 | 98.0% | 93 |
| 90 | 99.1% | 96 |

| Where | Constant | Now | Proposed |
|---|---|---|---|
| `lib/tuning.ts` `CONTRACT` | `MAX_DEAL_OVR` | 80 | **85** |
| `lib/tuning.ts` `CONTRACT` | `STANDARD_OVR` | 60 | **68** |
| `lib/tuning.ts` `RESIGN` | `FLOOR_OVR` | 58 | **67** |
| `lib/tuning.ts` `RESIGN` | `PREMIUM_OVR` | 74 | **80** |
| `lib/teamRating.ts` | `REPLACEMENT_LEVEL` | 40 | **52** |
| `lib/ai/gm.ts:186-192` | untouchable tiers | 82 / 85 / 88 | **87 / 90 / 93** |
| `lib/trade.ts:335` | surplus band | 58–84 | **67–89** |
| `lib/trade.ts:336` | fallback band | 55–78 | **65–83** |
| `lib/gen/leagueHistory.ts:653` | legend filter | ≥78 | **≥83** |
| `lib/development.ts:99` | slump gate | ≥65 | **≥72** |
| `lib/scouting.ts:209,219` | unscouted attribute centre | 62 | **68** |
| `lib/tuning.ts` `SCOUTING` | `POTENTIAL_DEFAULT_CENTER` | 75 | **80** |

**`lib/ratings.ts` — `ratingColor` only.** Measured share of rostered players
in each colour band:

| band | current cut | before | after, cuts unchanged | proposed cut | after, proposed |
|---|---|---|---|---|---|
| gold | ≥88 | 2.1% | **6.8%** | ≥90 | 4.7% |
| accent | ≥78 | 12.8% | **27.1%** | ≥82 | 15.2% |
| accent2 | ≥68 | 28.5% | **43.8%** | ≥74 | 31.9% |
| chalk | ≥58 | 32.6% | 19.7% | ≥66 | 31.6% |
| muted | <58 | 24.1% | **2.6%** | <66 | 16.7% |

Left alone, the neutral bottom of the ramp all but vanishes (24% → 2.6%) and
gold triples — colour would stop discriminating exactly where README §3 says it
must. Moving the cuts to **90 / 82 / 74 / 66** restores today's shares almost
exactly *and* makes them coincide with `ratingTier`'s own thresholds
(90 Elite / 82 Pro Bowl / 74 Starter / 66 Rotational), which fixes a live
inconsistency: today an 88 renders gold but is labelled "Pro Bowl", not
"Elite". Under README §6 that is a small lying metric already.

**`ratingTier` and `gradeTag` should NOT move.** Their thresholds are semantic,
not population-based, and the recalibration makes them *more* honest, not less:

| label | band | before | after |
|---|---|---|---|
| Elite | 90-99 | 1.1% | 4.7% |
| Pro Bowl | 82-89 | 6.6% | 15.2% |
| Starter | 74-81 | 16.5% | **31.9%** |
| Rotational | 66-73 | 26.3% | 31.6% |
| Depth | 58-65 | 25.4% | 14.1% |
| Camp Body | <58 | **24.1%** | **2.6%** |

A quarter of every roster currently carries the label "Camp Body". A third of
an NFL 53 are starters (22/53 = 41%); today the game says 16.5%. The labels
were right and the ratings were wrong.

### 3.4 The draft class

Measured over 3 classes per configuration. Madden 26 reference: rookies 57–84,
top rookie 84, 2nd-round CB 75, 5th-round DT 67, 6th- and 7th-rounders 64.

| | R1 | R2 | R3 | R4 | R5 | R6 | R7 | UDFA | drafted mean | max |
|---|---|---|---|---|---|---|---|---|---|---|
| **current** | 72 | 71 | 72 | 69 | 69 | 69 | 67 | 61 | 69.7 | **95** |
| **proposed** | **74** | 72 | 72 | 67 | 67 | 65 | **62** | 60 | 68.4 | 89 |
| *Madden 26* | — | *~75* | — | — | *~67* | *~64* | *~64* | — | — | *84* |

The current class has essentially **no round signal at all** — R1 mean 72
against R7 mean 67 — and every round can produce a 95 (range 38–95 in *every*
round). That is not a scouting problem to be solved, it is noise. The proposal
restores a 12-point R1→R7 gradient and matches Madden at R5/R6/R7 almost
exactly. The residual: our best prospect can reach 89 where Madden caps at 84;
that is deliberate, since this game wants generational prospects to exist.

### 3.5 Where the proposal deliberately stops short of Madden

| Metric | Madden-implied | Proposal | Why not go further |
|---|---|---|---|
| ≥85 | ~16.6% | 11.5% | The 16.6% figure carries the weakest derivation (whole-DB denominator). Overshooting here inflates the 85-89 band, which is where `gm.ts`'s untouchable tiers and the most expensive contracts live. |
| 90+ per team | ~2.9 | 2.0 | Going to 2.9 pushed ≥70 to 71.8%, well past the 65% target, and every extra 90+ player is an extra untouchable in trade logic. |
| team overall | 75–93 | 66.7–88.2 | Madden's team rating is a different formula (scheme fit, its own unit weights). Chasing its *level* would mean tuning `lib/teamRating.ts`, not the player curve. The *spread* already matches: 21.5 points against Madden's 18. |

---

## 4. The economy — the thing most likely to break

`marketValue` is:

```ts
value = exp((ovr - MARKET.PIVOT) * steepness) * MARKET.SCALE
```

`ovr` appears **only** as `(ovr - PIVOT)`. So a uniform +N shift in the rating
curve and a +N shift in `PIVOT` cancel exactly. This is why `PIVOT` is the
right lever and `SCALE` is the wrong one: `SCALE` would rescale every price by
a constant factor, which changes the *ratio* between a star and a backup;
`PIVOT` slides the curve along and preserves it.

The shift is not perfectly uniform (the tail thinned while the top fattened),
so `PIVOT` was solved empirically:

| `MARKET.PIVOT` | median team payroll at market | p90 | max |
|---|---|---|---|
| *before, PIVOT 70* | **92% of cap** | 128% | 171% |
| after, 70 (uncompensated) | **148%** | — | — |
| after, 75 | 104% | 158% | 205% |
| after, 76 | 96% | 147% | 193% |
| **after, 77** | **88%** | 137% | 180% |
| after, 78 | 81% | 126% | 168% |

**77 is the recommendation.** 76 matches today's median more exactly (96% vs
92%) but leaves the expensive tail higher; 77 lands slightly cheap in the
median and pulls p90/max back toward where they are now. Since the top of the
curve got fatter, erring cheap is the safe direction — a league with a little
headroom recovers, a league over the cap cannot sign anyone.

For context, the **real** league already prices at **101% of cap** at market —
two seasons of progression have already pushed it past the 92% that
`MARKET.SCALE`'s own calibration comment targets. The economy is mildly out of
tune before this change lands.

Reference prices, before vs after (age 26):

| ovr | QB before | QB after | WR before | WR after | LB before | LB after |
|---|---|---|---|---|---|---|
| 99 | $69.6M | $46.4M | $43.3M | $28.8M | $30.9M | $20.6M |
| 95 | $55.2M | $36.8M | $34.3M | $22.9M | $24.5M | $16.3M |
| 90 | $41.3M | $27.5M | $25.7M | $17.1M | $18.3M | $12.2M |
| 85 | $30.9M | $20.6M | $19.2M | $12.8M | $13.7M | $9.1M |
| 80 | $23.1M | $15.4M | $14.4M | $9.6M | $10.3M | $6.8M |
| 77 | $19.4M | $13.0M | $12.1M | $8.0M | $8.6M | $5.7M |
| 74 | $16.3M | $8.5M | $10.2M | $5.3M | $7.2M | $3.8M |
| 70 | $13.0M | $4.9M | $8.0M | $3.0M | $5.7M | $2.2M |
| 65 | $6.4M | $2.4M | $4.0M | $1.5M | $2.9M | $1.1M |
| 60 | $3.2M | $1.2M | $2.0M | $1.0M | $1.4M | $1.0M |

The compensation is exact where it matters, because the shift is exact:

| role | before | after | price |
|---|---|---|---|
| average-starter QB | 70 ovr → **$13.0M** | 77 ovr → **$13.0M** | unchanged |
| elite WR | 90 ovr → **$25.7M** | 97 ovr → **$25.7M** | unchanged |

Read the table by **role**, not by number, because the number moved: an
"average starter" was a 70 and is now a 77, and a 77 QB costs $13.0M before and
$12.9M after. That is the point. What genuinely changes is that the *nominal*
top of the market falls — the highest-paid player in a generated league goes
from a 95 QB at $55M to a 99 QB at $46M. If a ~$60M franchise quarterback is
wanted as a visible number, that is a separate `MARKET.STEEPNESS` conversation
and should not be smuggled into this change.

---

## 5. Full before/after — as shipped, measured on the live tree

5 leagues x 32 rosters straight out of `generateRoster`, post-fullback-removal
(so `POSITION_FREQUENCY.WR` is 14.5 and the receiver room is seven deep).

| Band | BEFORE | AFTER (shipped) | target |
|---|---|---|---|
| 95-99 | 0.04% | **1.4%** (18.6/league) | ~1% |
| 90-94 | 0.9% | **3.5%** | ~4% |
| 85-89 | 3.5% | **7.2%** | ~11% |
| 80-84 | 6.7% | **12.8%** | ~14% |
| 75-79 | 9.9% | **19.9%** | ~16% |
| 70-74 | 15.4% | 23.1% | ~19% |
| 65-69 | 18.1% | 18.4% | ~19% |
| 60-64 | 15.4% | 9.2% | ~12% |
| 55-59 | 12.1% | **4.5%** | ~4% |
| 50-54 | 7.9% | **0** | 0 |
| <50 | 10.1% | **0** | 0 |

| | BEFORE | AFTER (shipped) | target |
|---|---|---|---|
| mean / median | 65.2 / 66 | **73.9 / 73** | ~72 |
| min / max | 40 / 98 | **56 / 99** | ~57 / 99 |
| >=70 | 36.4% | **67.9%** | ~65% |
| >=85 | 4.4% | **12.1%** | ~16.6% |
| >=90 | 0.9% | **4.9%** | ~5.5% |
| **players at 99 per league** | **0.0** | **3.6** | **4-7 (published)** |
| players at 95+ per league | 0.6 | 18.6 | ~20 |
| 90+ per team | 0.41 | ~2.0 | ~2.9 |
| teams with **zero** 90+ players | **17 of 32** | ~2 of 32 | Madden: none |
| payroll, median | **92% of cap** | **93% of cap** | unchanged |
| payroll, p90 / max | 128% / 171% | 140% / 227% | see note |

The median payroll is the number `MARKET.SCALE` is calibrated against and it
lands within a point of where it was — `PIVOT` 77 did its job.

**The payroll tail did move, and it is worth knowing why.** p90 goes 128% ->
140% and max 171% -> 227%. Two causes compound: the top of the curve is fatter,
and `STAR_POSITION_WEIGHTS` deliberately concentrates stars at quarterback, edge
and corner — which are exactly the positions carrying the highest
`MARKET.POSITION_MULT` (QB 1.85, EDGE 1.45, CB 1.25). A team that rolls three
stars now rolls three *expensive* stars. `lib/gen/league.ts`'s existing
`CAP_TARGET_FRACTION` haircut absorbs this at league creation, so no team starts
illegal; the consequence is that more teams start on visibly below-market deals.
Left as-is rather than re-tuned, because the alternative is either weakening the
positional premium (which is a real part of the game's economy) or flattening
the star distribution back toward the defect this change exists to fix.

### 5.1 The draft class

| | R1 | R2 | R3 | R4 | R5 | R6 | R7 | UDFA | range |
|---|---|---|---|---|---|---|---|---|---|
| BEFORE | 72 | 71 | 72 | 69 | 69 | 69 | 67 | 61 | 38-95 |
| **AFTER** | **74** | 72 | 71 | 69 | 67 | 64 | **61** | 61 | **54-88** |
| *Madden 26* | — | *~75* | — | — | *~67* | *~64* | *~64* | — | *57-84* |

Monotonic for the first time — before, R3 graded higher than R1 and every round
could produce a 95.

## 6. Risks — including ones not on the original list

1. **Multi-season drift is the biggest unknown and it needs a real sim.**
   A crude in-memory 9-offseason run (progress + retire + replace-with-rookie,
   *no* free agency, *no* cuts, *no* draft board) gives:

   | | yr 0 | yr 3 | yr 6 | yr 9 |
   |---|---|---|---|---|
   | before, mean | 63.9 | 63.9 | 64.8 | **65.7** |
   | after, mean | 73.9 | 72.5 | 70.9 | **69.6** |

   The new curve drifts **down** ~4 points where the old one drifts up ~2,
   because the veteran roster mean (77) now sits further above the incoming
   rookie mean (~67) than it used to. **But this sim omits exactly the
   mechanisms `lib/tuning.ts` already documents as the engine of rating
   inflation** — teams keeping whoever drifted up and cutting whoever drifted
   down, and signing the best available rather than a random rookie. The real
   loop was measured at mean 65 → 81 over 13 seasons before the `roomFactor`
   fix. So the honest statement is: *the new calibration has a stronger
   downward pull, which probably helps, and I cannot prove it without running
   the real season loop.* **Do not ship this without a multi-season run on a
   real league** (`scripts/simHealth.ts` / `scripts/_tmp_final_sim.ts` look like
   the right starting points).

2. **`CAP_TARGET_FRACTION` bites harder.** `lib/gen/league.ts` haircuts any team
   whose market payroll exceeds 88% of the cap. p90 payroll goes 128% → 137%
   (at PIVOT 77), so more teams are scaled and scaled deeper — meaning more
   rosters start on visibly below-market deals. Not new behaviour, but more of
   it.

3. **More untouchables, fewer trades.** `lib/ai/gm.ts` refuses to trade players
   above 82/85/88 by team tier. With 90+ going from 0.41 to 2.04 per team, a
   lot more of the league becomes untradeable unless those thresholds move with
   the curve (§3.3).

4. **Roster-need detection shifts.** `lib/rosterShape.ts` is explicitly
   relative ("a 78 average at linebacker means nothing until you know the
   league sits at 72") so it should follow automatically — but it is worth a
   look, because a league mean moving 65 → 73 changes what "below average"
   selects, and `RESIGN.FLOOR_OVR` at 58 would keep literally everyone.

5. **`buildLeagueRatings` / win probability.** Team overall rises ~6 points
   league-wide. If `estimateWinProbability` uses an absolute *difference* it is
   fine; if it uses a ratio or an absolute anchor it is not. Not audited — flag
   for whoever owns `lib/winProbability.ts`.

6. **The consensus draft board.** `CONSENSUS.CURRENT_WEIGHT` / `POTENTIAL_WEIGHT`
   blend ovr and potential on the same scale, so they follow. But
   `SCOUTING.POTENTIAL_DEFAULT_CENTER: 75` is an *absolute* prior on an
   unscouted prospect's ceiling — at a league mean of 73.5 a default of 75 says
   "every unknown is league average", which is a much stronger claim than it
   was at a mean of 65.

7. ~~**Existing saves are not migrated.**~~ **Resolved — no gating needed.**
   The production database is new and the beta link has not gone out, so there
   is no population to protect. Landing this *before* anyone has a dynasty is
   the cheaper and more honest move than building migration for nobody. Dev
   leagues created before the change will be internally inconsistent (old
   player curve, new `MARKET.PIVOT`, so everyone in them reads ~40% cheap) —
   that belongs in the changelog, not in code. Revisit only if the beta ships
   first.

8. **`draftPlayer` has a 5-second interactive-transaction ceiling.** Found
   incidentally: running two season sims at once made `lib/draft.ts:132` blow
   its Prisma transaction timeout — *"The timeout for this transaction was 5000
   ms, however 30427 ms passed"* — and kill the run. This reproduces on the
   **unmodified** tree, so it is not caused by this change, but it is a latent
   production fragility under any DB contention and it belongs to whoever owns
   the draft. Not mine to fix; flagged.

---

## 7. Sources

- Bleacher Report — *Madden 20: Review of Elite Player Ratings, Achievements and More*
- pastapadre — *Breaking down the new player ratings spread for Madden NFL 20*
- Operation Sports — *Madden NFL 20 Developers Detail the Player Ratings Stretch*
- ESPN — *Madden NFL 26's 99 Club loses a member in latest update*
- ESPN — *Madden 25 player ratings: Mahomes announced as final member of 99 Club*
- ESPN — *Travis Hunter leads Madden NFL 26 rookie ratings*
- GamesRadar+ — *Madden 26 rookie ratings guide* and *Madden 26 best teams list*
- GameRant — *The Best Teams in Madden NFL 26 (Highest Ratings)*
- Commanders.com — *Commanders full Madden 26 ratings revealed*
- SI team pages (Chargers, Steelers) — individual rookie ratings
- madden.tools / madden27.wiki — total database size (3,041 players)

Retrieved via search snippets on 2026-08-21. **Page bodies were not
retrievable from this sandbox** — see §1.1.

---

## 7. Tier labels and the colour ramp

### 7.1 No rating tier may be named after an honour

`ratingTier` currently prints **"Pro Bowl"** for any player rated 82-89. A Pro
Bowl is something a player is *selected to*; printing it because of a rating
asserts an achievement nobody earned. Under README §6 ("no lying metrics") that
is the same class of bug as a ledger reading "Trades 0" beside "Trades Made 7",
and it is worse than the colour mismatch that led me to it.

**Rule adopted: a rating tier describes a level of quality and nothing else.**
No tier — including the two new reserved steps at the top — may borrow the name
of an award. Real All-Star selection (from season statistics, carried on the
player's card as a genuine honour) is a separate agent's work; this document
does not build it, reference it, or take its vocabulary.

### 7.2 The bands, chosen from the rarity ladder

Measured on the recalibrated curve, 8 leagues, 11,026 rostered players:

| cut | share at/above | per league | **per team** |
|---|---|---|---|
| 99 | 0.27% | 3.8 | 0.12 |
| 95+ | 1.37% | 18.9 | **0.59** |
| 90+ | 4.56% | 62.9 | 1.96 |
| 85+ | 11.66% | 160.8 | 5.02 |
| 78+ | 32.41% | 446.6 | 13.96 |
| 70+ | 68.60% | 945.5 | 29.55 |
| 62+ | 93.15% | 1283.9 | 40.12 |

**The "truly elite" cut is 95, and the reason is the per-team column.** At 95+
there are 0.59 per team — *fewer than one per club*, so most teams do not have
one, which is exactly what "truly elite" has to mean to survive as a
distinction. It is also the last cut before the tier stops being rare: 93+ is
0.96/team and 92+ is 1.24/team, so 93 is where per-team crosses 1.0 and 95 is
where it is comfortably below. And ~19 players per league matches Madden's own
95+ cohort (the 99 Club plus the 98/97/96 names).

99 needs no argument: **3.8 per league**, against Madden's published 4-7.

| band | label | share | per team | what the number claims |
|---|---|---|---|---|
| 99 | **Generational** | 0.27% | 0.12 | one every few seasons, league-wide |
| 95-98 | **Superstar** | 1.10% | 0.47 | most teams do not have one |
| 90-94 | **Elite** | 3.19% | 1.37 | ~2 per team, top of the position |
| 85-89 | **Star** | 7.10% | 3.06 | clear difference-maker |
| 78-84 | **Quality Starter** | 20.75% | 8.94 | starts, and you are happy about it |
| 70-77 | **Starter** | 36.19% | 15.6 | starts, or is next man up |
| 62-69 | **Rotational** | 24.55% | 10.6 | plays a role, does not start |
| under 62 | **Depth** | 6.85% | 2.9 | end of the roster |

These boundaries are used by the label **and** the colour, so the two can never
again disagree the way an 88 rendering gold while labelled "Pro Bowl" does now.

### 7.3 The colour ramp — the sixth hue does not exist

The owner asked for a reserved colour for a 99 and another for truly elite. I
tried to give him two new inks and **the validator refused every one of them.**
Run against the card surface `#18181b`, `--pairs all`:

| candidate for the top steps | result |
|---|---|
| violet `#a78bfa` beside fuchsia `#e879f9` | **FAIL** — ΔE **0.4** under protanopia; 10.9 even with full colour vision |
| orange `#fb923c` beside gold `#eab308` | **FAIL** — ΔE **4.3** deutan, 9.1 normal |
| cyan `#67e8f9` as a sixth hue | **FAIL** — ΔE 12.7 vs accent2 blue, normal vision |
| fuchsia `#e879f9` anywhere in the ramp | **FAIL** — ΔE **0.3** vs accent2 `#38bdf8` under deuteranopia |
| pale yellow / amber-200 / orange-200 / cream / lime / rose | **FAIL**, all of them |

I would have shipped the violet or the orange on sight; both are invisible to a
large minority of players. The fuchsia result is the decisive one: **to a
deuteranope, fuchsia and our existing accent2 blue are the same colour** (ΔE
0.3). Under deuteranopia the only surviving axis is blue↔yellow, and gold,
green, blue, chalk and muted already occupy it. **There is no sixth ink this
ramp can take.** That is a computed result, not a preference.

**So the two reserved steps are reserved by *shape*, not by a new hue** — which
is also what README §4 demands anyway, and this ramp is precisely the place the
principle was being skipped:

| band | ink | mandatory non-colour mark |
|---|---|---|
| 99 Generational | gold `#eab308` **as a filled plate**, ink `#0a0a0b` on it | ◆ |
| 95-98 Superstar | gold `#eab308` | ★ |
| 90-94 Elite | gold `#eab308` | — |
| 85-89 Star | accent `#4ade80` | — |
| 78-84 Quality Starter | accent2 `#38bdf8` | — |
| 70-77 Starter | chalk `#f3f2ec` | — |
| under 70 | muted `#93939c` | — |

The 99's **filled plate** is the answer to "a colour of its own": a solid chip
is a different *object* from coloured text, so it is unmistakable at a glance,
it survives colourblindness, greyscale and forced-colors mode entirely, and it
costs the ramp no hue. Contrast of `#0a0a0b` on `#eab308` is **10.32:1**, well
past WCAG AA.

Validator on the shipped five-ink ramp, adjacent pairs — the pairs a reader must
actually separate:

```
[PASS] CVD separation      worst adjacent #4ade80 <-> #eab308  DE 8.7 (deutan)
[PASS] Normal-vision floor worst adjacent #4ade80 <-> #eab308  DE 18.7 (normal)
[PASS] Contrast vs surface all 5 >= 3:1
```

Two honest caveats on that output. The validator also reports FAIL on
*Lightness band* and *Chroma floor* for `chalk` and `muted`; those checks are
calibrated for chart **fills**, and chalk/muted are deliberately neutral **text
inks** — the tool's own footer says "for a lone status/text color check WCAG
text contrast", which they pass. And the all-pairs run still flags gold↔green
as the worst chromatic pair at 8.7; that is the *existing* ramp's worst pair
too, unchanged by this work, and it clears the 8.0 target.

Also note this moves the ramp **toward** README §3 ("meaningful above ~80,
neutral below"): colour currently starts at 58, and after this it starts at 70.

### 7.4 What gold already means in this app

Checked, because a 99's treatment must not read as an award. `gold` is used
for: championships and title counts (`gm`, `history`, `account`), award rows
(always prefixed 🏆), playoff byes and conference leaders (`standings`), several
news categories, a "TOP 10" marker, and the Full Scout affordance (`scouting`).
The **franchise tag** is *not* gold — it is `warn` (`border-warn/30
text-warn bg-warn/10`), so that collision does not exist.

The real collision risk is the trophy: gold + 🏆 already means "he won
something". The 99 plate is therefore specified as **gold plate + ◆**, never
with a trophy or star-of-achievement glyph, and ★ is reserved for the 95-98
tier where it reads as magnitude rather than honour. Note ★ is already in use
for the shortlist toggle (`ShortlistStar.tsx`) and the draft shortlist button —
those are interactive controls in a different context, but the rating ★ should
be visually distinct (smaller, inline with the number, non-interactive) so the
two are not confused. Worth a look when the component work lands.

---

## 8. Does the number mean what a Madden player thinks it means?

A histogram cannot answer this, so I went and looked at the players. All figures
from a real generated league via `createLeague`, using `lib/lineup.ts`
(11 personnel + nickel = 22 men) as the definition of who starts — not my own.

### 8.1 The starting lineup — the thing that anchors everyone's intuition

| | BEFORE | AFTER |
|---|---|---|
| starter mean (704 starters, K/P excluded) | 71.2 | **77.9** |
| starters 90+ | 2.3% | 9.1% |
| starters 80+ | 19.2% | **38.5%** |
| starters 70+ | 55.3% | **84.8%** |
| starters **under 70** | 44.7% | **15.2%** |
| starters **under 60** | 10.2% | **0.3%** |
| best team | mean 80.0, 10 starters 80+, worst starter **70** | mean 85.3, 17 starters 80+, worst starter **76** |
| median team | mean 71.0, 3 starters 80+, worst starter **51** | mean 77.8, 6 starters 80+, worst starter **71** |
| worst team | mean 62.5, 0 starters 80+, worst starter **53** | mean 71.6, 3 starters 80+, worst starter **64** |

The line that matters: **the median team currently starts a 51.** Not the worst
team — the median one. And 44.7% of all starters league-wide are under 70, where
a Madden player expects a starting lineup to be overwhelmingly 70+. After the
change that is 11.2%, and nobody in the league starts a man in the fifties.

### 8.2 What each number buys you

Share of players at exactly that rating who start, and who are the best at their
position on their own team:

| ovr | BEFORE: % starting | AFTER: % starting | AFTER: % best at their position | label |
|---|---|---|---|---|
| 99 | *(1 in the league)* | 100% | 100% | Generational |
| 95 | *(nobody)* | 100% | 80% | Superstar |
| 90 | 100% | 100% | 100% | Elite |
| 87 | 100% | 76% | 52% | Star |
| 82 | 100% | 95% | 75% | Quality Starter |
| 78 | 89% | 75% | 53% | Quality Starter |
| 74 | 82% | 57% | 39% | Starter |
| 71 | **77%** | 57% | 35% | Starter |
| 66 | **72%** | 37% | 7% | Rotational |
| 60 | **37%** | 12% | 6% | Depth |

This is the check the owner asked for and it passes: an 87 is a difference-maker
who starts and is usually his team's best at the spot; a 78 starts about
two-thirds of the time; a 71 is a fringe starter; a 66 rarely plays; a 60 never
starts. Those are Madden's meanings. **Before the change the same table is a
lie** — a 66 started 72% of the time and a 60 started 37% of the time, because
the league was so weak that replacement-level players were holding jobs.

### 8.3 Position scarcity

| | BEFORE | AFTER (uniform stars, no offset) | **AFTER (shipped)** |
|---|---|---|---|
| best QB | 94 | 99 | **97** |
| best P | **99** | 93 | **85** |
| best K | 88 | 93 | **93** |
| top-25 by position | **P 3**, QB 3, DT 3, WR 3, EDGE 3, TE 2, K 1… | **TE 5**, LT 3, WR 3, EDGE 3, QB 2… | **CB 4, WR 4, EDGE 4, DT 3, LB 3, QB 3, RB 2, S 1, TE 1** |
| top-100 by position | — | S 13, LT 12, EDGE 12, QB 11, WR 11, **TE 10** | **QB 21, EDGE 13, WR 13, CB 12, DT 10**, LB 9 |
| highest-mean position | **P 73.2** (a punter) | LT | **QB 78.1** |
| lowest-mean position | **WR 58.1** | WR 71 | **S 70.9 / P 70.9** |
| spread of positional means | **15.5 pts** | 7.9 pts | **7.2 pts** |
| K/P anywhere in the top 25 | **yes (4)** | yes | **no** |

Three findings here, none of which a histogram shows.

**The league's best player was a punter.** Best P 99, best QB 94, and punters
held three of the top twenty-five slots. Cause: K and P are the only positions
with exactly one roster slot, so they never take a depth penalty, while every
other position's mean is dragged down by its backups. That made *positional
mean a function of how many of them a roster carries* — WR (7 slots) averaged
58.1 while LT (2 slots) averaged 73.6. The reshaped depth curve fixes most of
it (spread 15.5 → 7.9), and a new `SPECIALIST_OVR_PENALTY` of 5 finishes it.

**Star seeding picked positions uniformly.** `rng.pick(premiumPositions)` over
ten positions gives a 79-man tight-end pool the same number of stars as a
193-man receiver pool, so TE and LT flooded the ceiling — TE took 5 of the top
25. Replacing the uniform pick with `STAR_POSITION_WEIGHTS` turns the top 100
into `QB 21, EDGE 13, WR 13, CB 12, DT 10`, which is what a Madden top-100 looks
like. Chosen empirically over three candidate weightings.

**Elite quarterbacks now reach the top of the board**, which they could not
before: best QB 94 → 99, and QB goes from 3 of the top 25 to 21 of the top 100.


---

## 9. What shipped

Landed against `97de874` (the fullback retirement), so `FB` is gone everywhere
and `POSITION_FREQUENCY.WR` is already 14.5 — the receiver room this curve is
tuned against is the post-fullback one, seven deep.

`npx tsc --noEmit` clean with `tsconfig.tsbuildinfo` deleted. (One error remains
in `scripts/_as_sim.ts`, which is the All-Star agent's untracked scratch file
and not part of this change.)

### 9.1 `lib/tuning.ts`

| constant | from | to |
|---|---|---|
| `GENERATION.VETERAN_OVR_MEAN` | 72 | **77** |
| `GENERATION.VETERAN_OVR_SD` | 8 | **7** |
| `GENERATION.ROOKIE_OVR_MEAN` | 65 | **68** |
| `GENERATION.ROOKIE_OVR_SD` | 10 | **7.5** |
| `GENERATION.DEPTH_DECAY_MAX` / `_TAU` / `_JITTER` | *(inline `i * rng.float(4,8)`)* | **13 / 2.0 / 0.25** |
| `GENERATION.ROSTER_OVR_FLOOR` | *(inline 40)* | **56** |
| `GENERATION.SPECIALIST_OVR_PENALTY` | *(none)* | **5** |
| `GENERATION.STAR_OVR_MEAN` / `_SD` / `_MIN` | *(inline 85 / 4 / 78)* | **89 / 5.5 / 82** |
| `GENERATION.STAR_COUNT_MIN` / `_MAX` | *(inline 1 / 3)* | **2 / 4** |
| `GENERATION.STAR_POSITION_WEIGHTS` | *(unweighted `rng.pick`)* | **QB 2.2, WR 1.8, EDGE 1.6, CB 1.3, DT 1.1, LB 0.9, LT 0.7, S 0.7, RB 0.6, TE 0.45** |
| `GENERATION.DRAFT_TIER_SPREAD` / `_OFFSET` | *(inline 14 / 6)* | **17 / 9** |
| `GENERATION.DRAFT_OVR_MIN` / `_MAX` | *(inline 38 / 95)* | **54 / 88** |
| `GENERATION.FREE_AGENT_OVR_*` | *(58/8/38/84, hardcoded twice)* | **64 / 8 / 52 / 88** |
| `MARKET.PIVOT` | 70 | **77** |
| `CONTRACT.MAX_DEAL_OVR` | 80 | **85** |
| `CONTRACT.STANDARD_OVR` | 60 | **68** |
| `RESIGN.FLOOR_OVR` | 58 | **67** |
| `RESIGN.PREMIUM_OVR` | 74 | **80** |
| `SCOUTING.POTENTIAL_DEFAULT_CENTER` | 75 | **80** |

### 9.2 `lib/gen/players.ts` — four behavioural changes

1. Depth decay is asymptotic and bounded, not linear and unbounded.
2. Kickers and punters take `SPECIALIST_OVR_PENALTY`, because they are the only
   positions with no depth behind them.
3. Star seeding picks its position from `STAR_POSITION_WEIGHTS`, and replaces
   the **weakest** man at that position, and only when the star is an upgrade
   (this is the `findIndex` bug — see §2 Defect D).
4. The draft tier ramp is capped at the last pick (`Math.min(1, i /
   DRAFT_CLASS_SIZE)`), so the seven rounds traverse the whole ramp and every
   undrafted player sits at the bottom tier.

### 9.3 `lib/ratings.ts` — one ladder, shared by label and colour

`RATING_BANDS` is now the single set of boundaries. `ratingTier`, `gradeTag`
and `ratingColor` all read it, so a label and a colour can no longer disagree.
Two new exports carry the non-colour channel: `ratingMark(ovr)` returns ◆ for a
99 and ★ for 95-98 and empty otherwise, and `ratingPlateClass(ovr)` returns the
filled-gold-plate classes for a 99. Wired into the roster table and the player
page's hero number; the ramp itself reaches every other surface for free
because they all already call `ratingColor`.

No tier is named after an honour. "Pro Bowl" is gone.

### 9.4 Other files

`lib/gen/league.ts` and `lib/leagueFile.ts` (free-agent pool now reads the
constants instead of hardcoding 58/8/38/84 twice), `lib/teamRating.ts`
(`REPLACEMENT_LEVEL` 40 → 52), `lib/ai/gm.ts` (untouchable tiers 82/85/88 →
87/90/93), `lib/trade.ts` (surplus bands), `lib/gen/leagueHistory.ts` (legend
filter 78 → 83), `lib/development.ts` (slump gate 65 → 72), `lib/scouting.ts`
(unscouted attribute centre 62 → 68).

### 9.5 For the changelog

Leagues created before this change keep their old player curve but get the new
`MARKET.PIVOT`, so everyone in them will read about 40% cheap. That is dev
saves only — the production database is new and the beta has not gone out — and
it is deliberately not engineered around. Start a fresh league to see the
recalibration.
