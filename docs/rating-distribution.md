# Rating distribution — research, diagnosis, and a proposed recalibration

> **Status: proposal only. Nothing in `lib/` has been changed.**
> The two files this needs to touch (`lib/tuning.ts`, `lib/gen/players.ts`) were
> held by other agents when this was written. Every number below was measured
> by running the real generator and the real market curve out-of-tree.

The app owner's ask, verbatim:

> *"also - the ratings. Can you research madden's rating system and apply a
> distribution accordingly that is similar? Players feel very low rated."*

---

## 0. What this document concludes, in four lines

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
replacing literals currently inline in `lib/gen/players.ts`; naming them keeps
the edit to `players.ts` down to a handful of lines, which matters because that
file is contended.

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

## 5. Full before/after (5 leagues, 160 rosters, 6,903 players)

| Band | BEFORE | AFTER | target |
|---|---|---|---|
| 95-99 | 3 (0.04%) | 102 (**1.5%**) | ~1% |
| 90-94 | 62 (0.9%) | 224 (**3.2%**) | ~4% |
| 85-89 | 240 (3.5%) | 467 (**6.8%**) | ~11% |
| 80-84 | 462 (6.7%) | 864 (**12.5%**) | ~14% |
| 75-79 | 681 (9.9%) | 1308 (**18.9%**) | ~16% |
| 70-74 | 1058 (15.4%) | 1582 (22.9%) | ~19% |
| 65-69 | 1243 (18.1%) | 1280 (18.5%) | ~19% |
| 60-64 | 1059 (15.4%) | 733 (10.6%) | ~12% |
| 55-59 | 836 (12.1%) | 343 (**5.0%**) | ~4% |
| 50-54 | 544 (7.9%) | **0** | 0 |
| <50 | 693 (10.1%) | **0** | 0 |

| | BEFORE | AFTER | target |
|---|---|---|---|
| mean | 65.2 | **73.5** | ~72 |
| median | 66 | 73 | — |
| sd | 11.5 | 8.8 | — |
| min | 40 | **56** | ~57 |
| max | 98 | **99** | 99 |
| ≥70 | 36.4% | **65.9%** | ~65% |
| ≥80 | 11.1% | 24.0% | ~30% |
| ≥85 | 4.4% | 11.5% | ~16.6% |
| ≥90 | 0.9% | **4.7%** | ~5.5% |
| players at 99 | 0.0 / league | **6.2 / league** | 4–7 |
| 90+ per team | 0.41 | **2.04** | ~2.9 |
| best player, worst team | 78 | 83 | — |
| team overall range | 60.7–82.4 (med 72.1) | 66.7–88.2 (med 77.9) | 75–93 |
| team overall spread | 21.6 | 21.5 | 18 |
| payroll, median | 92% of cap | **96%** (PIVOT 76) / **88%** (PIVOT 77) | ~92% |

The floor at 56 is a **clamp**, so it piles up: 2.1% of the league sits at
exactly 56 against ~0.8% at each of 57/58/59. Visible in a histogram, invisible
on a roster page. It could be softened with a soft-floor blend later; it is not
worth the complexity now.

---

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

7. **Existing saves are not migrated.** Every constant here affects generation
   and pricing going forward. A league already in progress keeps its old player
   curve but gets the new `MARKET.PIVOT`, which would make everyone in it
   ~40% cheaper overnight. Either gate the `PIVOT` change on league creation
   year, or accept a one-time market reset, or migrate. **This is not
   optional** and it is the risk most likely to be missed.

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
