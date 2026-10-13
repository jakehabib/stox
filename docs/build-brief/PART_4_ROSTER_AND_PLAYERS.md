# PART 4 — Roster, Players, Scouting and the Draft

Build everything about a player except his ratings. Take the rating layer — the
attribute catalogue with its per-attribute `scoutDifficulty`, `POSITION_WEIGHTS`,
`computeOverall`, `RATING_BANDS`, the tier distribution, the potential soft ceiling,
the age curve, progression and the development arc — from `RATING_SYSTEM_SPEC.md`.
Do not re-derive those numbers here; where this part names one, it is naming the
same constant.

Take cap, contracts, dead money, trade valuation and free agency from Part 3. Where
this part builds a contract (a rookie deal, a fantasy pick's deal, a minimum camp
deal) it tells you which contract to build and leaves the arithmetic to Part 3.

---

## 0. Obey this one rule everywhere

**Never sort a mixed-position pool by overall.**

A kicker's overall is computed from kicking attributes on a scale every other
position outscores, so kickers and punters sit at the bottom of any league-wide
rating sort **by construction** — not by accident, and not fixable by tuning. Here
is what that cost, measured across twelve real free-agent pools:

| pool | best kicker's rank | best punter's rank |
|---|---|---|
| 1,956-man fantasy pool | **141st** | 66th |
| 560-man pool | 139th | 209th |
| 260-man pool | 102nd | 7th |

The fantasy-draft board was `orderBy: { trueOvr: 'desc' }, take: 60`. In seven of
those twelve pools at least one **whole position** was absent from the top sixty —
not always a specialist: one pool had no quarterback in it, another none of
TE/LT/LG/RG/EDGE/DT/CB. Thirty-two clubs built entire rosters off that board and
opened the season with nobody to kick.

So build every board, shortlist, "best available", top-N sample and suggestion list
that spans positions as **a column per position, the best N at each**. Never a single
blind top-N. Use `SPECIALIST_OVR_PENALTY = 5` (rating spec §5) to keep specialists
roughly comparable, but never let a UI sort or an AI decision depend on it. Do the
per-position slice in one statement —
`row_number() OVER (PARTITION BY position ORDER BY trueOvr DESC)`, depth 12 per
position — because sixteen round trips per pick is 27,000 queries in a fantasy draft.

Three further rules from the rating spec that this part leans on constantly. Hold to
them:

1. **Derive a rating, never store it as truth.** The attribute map is the truth;
   compute overall on read. This is what lets a position change honestly recompute a
   grade and lets the fog show a different overall for the same man with no second
   code path.
2. **Never clamp a distribution — soft-bound it.** A clamp makes the most extreme
   outcome the *most common* value at that end of the scale. Seven such walls were
   removed from this codebase; two of them are in this part (the draft rating roll,
   the combine drills).
3. **Give every random roll its own seeded stream, keyed by entity id**, so adding a
   roll later cannot reshuffle what is already live in a player's save.

---

## 1. Player generation

### 1.1 Create a league

Write, in this order: 32 franchises, staff and scouts, players (rosters or a fantasy
pool), contracts, a free-agent pool, four years of draft picks, a full schedule,
depth charts, seeded league history, and the user's opening scouting book.

**Franchises.** Generate 32 fictional clubs from a fixed seed table — city,
nickname, abbreviation, conference (AFC/NFC), division (East/North/South/West), four
clubs per division. Give each `prestige = rng.int(30, 80)` and a GM profile (§7.6).
Flag exactly one club `isUser`. If the requested abbreviation matches nothing,
**actually flag the fallback club** — otherwise anything that queries "the other 31
clubs" as `isUser: false` offers the user his own club as a trade partner.

**Staff.** Four per club: `HC`, `OC`, `DC`, `ST`. Roll
`rating = normalClamped(55, 12, 25, 95)`, then
`playCalling = normalClamped(rating, 8, 20, 99)` and
`development = normalClamped(rating, 10, 20, 99)` around it,
`contractYears = int(1, 5)`, `salary = float(1.5, 9) × $1M`. Give a coordinator **no
scheme string** — it was a copy of the club's own scheme, read only by a deleted
`schemeFit`, and rendered nowhere.

**Scouts.** Roll `rng.int(2, 3)` per club, each with `accuracy` and `speed` at
`normalClamped(55, 14, 20, 95)`, `specialty` picked from
`['ALL', 'OL', 'SKILL', 'FRONT7', 'SECONDARY']`, `salary = float(0.2, 1.2) × $1M`.
Consume accuracy and speed in shortlist attention (§4.4) and in `observe()`; match
specialty against the prospect's **position group**.

**Names.** Keep one name registry for the whole league — a case-insensitive set of
taken full names — so no two players anywhere in it share a name, not across rosters
and not between a roster and the free-agent pool. Have `pickUniqueName` re-roll up
to 40 times for a fresh first/last combination; if the space is genuinely exhausted,
append a generational suffix from `['Jr.', 'II', 'III', 'IV']` ("Marcus Whitfield
Jr." reads as a football name in a way "Marcus Whitfield 2" never would); only if
every suffix is taken may it return a duplicate rather than loop forever. Thread the
registry through every generator, and **seed a draft class's registry from every name
already in the league** so a rookie cannot be handed a sitting starter's name. Draw
colleges from a fixed list of ~150 fictional programmes. Let nothing in the name,
college or team pools map to a real person or club.

### 1.2 Generate one player

`generatePlayer(rng, opts)` returns name, position, age, experience, height, weight,
college, attribute map, overall, potential, development trait. Roll them in this
order:

- **Position** — `opts.position`, else a weighted draw from `POSITION_FREQUENCY`
  (§1.3).
- **Overall target** — `opts.ovrTarget`, else `normalClamped(mean, sd, 38, 99)` with
  `VETERAN_OVR_MEAN/SD = 77 / 7` or `ROOKIE_OVR_MEAN/SD = 68 / 7.5`. Every real
  caller passes an explicit target; the rookie fallback is unreachable today (§9).
- **Age** — rookie `normalClamped(22, 1.0, 20, 25)`; veteran
  `normalClamped(26.5, 3.2, 21, 36)` (`AGE_MIN 21`, `AGE_MAX 36`).
- **Experience** — 0 for a rookie, else `clamp(age − 22, 0, 15)`.
- **Body** — height `normalClamped(h, hSd, 64, 82)` inches, weight
  `normalClamped(w, wSd, 160, 360)` lb, from §1.3.
- **Attributes** — §1.4.
- **Overall** — `computeOverall(position, attrs)`, off the **finished attributes**,
  never the target.
- **Potential** — `clamp(round(softCeiling(trueOvr, potBonus)), trueOvr, 99)` with
  `potBonus = max(0, normal(bonusMean, bonusSd)) × clamp((30 − age) / 8, 0, 1)`.
  Curve, knee (97.5), asymptote (99) and histograms: rating spec §5.
  **Build it on the finished rating, not the target.** Rolling the ceiling off
  `ovrTarget` wrote men with ceilings below their own current rating (2 in 120,000
  measured), because the attribute nudge lands `computeOverall` a point or two clear
  of the target. Ordering the code attributes → overall → ceiling is the whole fix,
  and it is free: the potential roll is unchanged and in the same place, so the same
  seed still generates the same men.
- **Dev trait** — weighted draw from
  `{ Slow .25, Normal .55, Star .15, Superstar .05 }` (rating spec §7b).

### 1.3 Bodies and positional frequency

Use these mean heights (inches) and weights (lb) with their standard deviations.
They are realistic-ish, not fitted to combine data; the combine's reference weights
mirror this table, so if you move one move the other.

| pos | h | hSd | w | wSd | | pos | h | hSd | w | wSd |
|---|---|---|---|---|---|---|---|---|---|---|
| QB | 75 | 1.6 | 220 | 12 | | EDGE | 76 | 1.5 | 262 | 15 |
| RB | 70 | 1.6 | 214 | 14 | | DT | 75 | 1.5 | 305 | 18 |
| WR | 73 | 2.1 | 200 | 15 | | LB | 74 | 1.4 | 238 | 12 |
| TE | 77 | 1.4 | 250 | 13 | | CB | 71 | 1.7 | 192 | 11 |
| LT | 78 | 1.3 | 313 | 14 | | S | 73 | 1.4 | 205 | 11 |
| LG | 77 | 1.3 | 315 | 14 | | K | 72 | 1.8 | 195 | 14 |
| C | 76 | 1.2 | 305 | 13 | | P | 74 | 1.8 | 205 | 14 |
| RG | 77 | 1.3 | 315 | 14 | | | | | | |
| RT | 78 | 1.3 | 315 | 14 | | | | | | |

Draw a random position from these relative frequencies (they sum to 103.5):

```
QB 5    RB 7     WR 14.5  TE 6
LT 4    LG 4     C 4      RG 4    RT 4
EDGE 9  DT 9     LB 10    CB 11   S 8
K 2     P 2
```

Give the retired fullback's share to **receiver**, not back to the pool: a roster
built for eleven personnel starts three wideouts and needs enough of them to field
three plus depth. Carrying a blocking back it can never start was the old shape.

### 1.4 Generate attributes in two passes

1. For each attribute the position touches, draw `normalClamped(mean, sd, 25, 99)`.
   For a **weighted** attribute use `mean = targetOvr`, `sd = ATTR_SD` (7). For an
   **unweighted** one use `mean = targetOvr × 0.85 + float(−6, 6)`,
   `sd = ATTR_SD × 2.2` — a corner's strength can be anything without changing his
   rating.
2. Iterate up to 12 times: compute the overall, take `delta = target − current`, and
   nudge **every weighted attribute** by `round(delta × 0.8)`, clamped to 25..99.
   Without this, averaging a dozen draws pulls everyone toward the middle.

Treat `ATTR_SD` as the knob for how spiky players are — higher means more men elite
at one thing and poor at another. The shipped residual spread is sd 6.0–7.4 on
weighted attributes and 14.6–16.5 on unweighted. **Have the combine generator read
that shape back from these constants** (`RESID_SD_MULT_WEIGHTED 0.94`,
`RESID_SD_MULT_UNWEIGHTED 2.17`, `UNWEIGHTED_ATTR_LEVEL 0.85`) rather than restating
it, so a combine z-score cannot go stale the next time attribute generation is
retuned.

### 1.5 Generate one roster

`generateRoster(rng, teamStrength)`, where `teamStrength` is the club's offset from
the league mean in rating points, roughly −6..+6.

For each of the 16 positions draw `rng.int(min, ideal)` bodies from these targets
(mins sum to 35, ideals to 51):

| pos | min | ideal | max | | pos | min | ideal | max |
|---|---|---|---|---|---|---|---|---|
| QB | 2 | 3 | 3 | | EDGE | 3 | 4 | 5 |
| RB | 3 | 4 | 5 | | DT | 3 | 4 | 5 |
| WR | 5 | 7 | 8 | | LB | 3 | 5 | 6 |
| TE | 2 | 3 | 4 | | CB | 4 | 5 | 6 |
| LT | 1 | 2 | 2 | | S | 3 | 4 | 5 |
| LG | 1 | 2 | 2 | | K | 1 | 1 | 1 |
| C | 1 | 2 | 2 | | P | 1 | 1 | 1 |
| RG | 1 | 2 | 2 | | | | | |
| RT | 1 | 2 | 2 | | | | | |

Rate the man at depth slot `i` as:

```
depthPenalty = DEPTH_DECAY_MAX × (1 − exp(−i / DEPTH_DECAY_TAU)) × float(1−J, 1+J)
specialist   = (pos is K or P) ? SPECIALIST_OVR_PENALTY : 0
ovrTarget    = clamp(round(normal(VETERAN_OVR_MEAN + teamStrength
                                  − depthPenalty − specialist,
                                  VETERAN_OVR_SD × 0.8)),
                     ROSTER_OVR_FLOOR, 99)
```

`DEPTH_DECAY_MAX 13`, `DEPTH_DECAY_TAU 2.0`, `DEPTH_DECAY_JITTER 0.25`,
`SPECIALIST_OVR_PENALTY 5`, `ROSTER_OVR_FLOOR 56` (Madden's floor is ~57).

**Make the decay asymptotic, not linear.** It was `i × float(4, 8)` — linear and
unbounded. With seven receivers that put WR7 **36 points** below his club's mean,
and it was where the whole sub-50 population came from. Worse, it made a *position's*
mean rating a function of how many of them a roster carries: receivers averaged 58
and left tackles 74, purely because a roster holds seven of one and two of the other.
Asymptotic decay is front-loaded like a real depth chart — slot 1 −5.1, slot 2 −8.2,
slot 4 −11.2, slot 6 −12.4 — and can never drag anyone more than 13 below his club's
mean.

**Apply the specialist offset.** K and P are the only positions with exactly one
roster slot, so they never take a depth penalty and would sit at the raw club mean
while every other position is dragged down by its backups. Without the offset the
league's best player was a **99 punter**, with punters holding three of the top
twenty-five slots.

Then seed `rng.int(2, 4)` genuine stars per club so no roster is uniformly grey:

- Pick the position from these weights:
  `QB 1.5, WR 1.8, EDGE 1.6, CB 1.3, DT 1.1, LB 0.9, LT 0.7, S 0.7, RB 0.6,
  RT 0.5, TE 0.45, LG 0.35, RG 0.35, C 0.35`.
  Do **not** use an unweighted pick: over ten positions it handed a 79-man tight-end
  pool as many stars as a 193-man receiver pool — tight ends took five of the
  league's top twenty-five and left tackles were the highest-rated position in the
  game. Keep QB at 1.5 and not 2.2: 2.2 reads correctly off a top-100 (21
  quarterbacks in a top hundred is plausible) and wrongly off a *league*, because
  there is one starting quarterback per club against three receivers, so 21 of them
  meant two thirds of the league was set at the position — and a club that is set has
  no reason to trade for one. On identical seeds, 2.2 → 1.5 took clubs holding an 88+
  passer from 10.3 to 8.0 per league and 85+ from 14.7 to 12.3, against a
  real-football feel of about 7–8 and 10–12. **Include the interior line and right
  tackle.** They were missing entirely, and an absent key is weight zero — so no
  generated league had ever contained an elite guard, centre or right tackle, at any
  rating, ever. That is not a defensible reading of football (the highest-paid
  lineman in the real game plays right tackle) and it is half of why the biggest cap
  hits in a new league were always the same four or five positions.
- Pick an era from `{ RISING .28, PRIME .46, VETERAN .26 }` → age `int(23,25)` /
  `int(26,29)` / `int(30,34)`. Do not cap a star at 29: that left a brand-new league
  with **no elite veterans at all** — nobody old enough to have a decade of
  production, an MVP and a couple of rings behind him, which is exactly the kind of
  player a league needs for its past to feel inherited rather than invented.
- Rate him `clamp(round(normal(STAR_OVR_MEAN + teamStrength × 0.3, STAR_OVR_SD)),
  STAR_OVR_MIN, 99)` with mean **89**, sd **5.5**, min **82**. The old roll —
  `normal(85, 4)` clamped to 78..99 — put 99 at +3.5 sd, structurally unreachable:
  the league had never generated one. That was never a limitation of
  `computeOverall`.
- **Decide who he displaces by how many men the position plays.** At a rotating
  position (WR, CB, EDGE) he joins the rotation and costs the roster spot of the
  **weakest** man there. Do not use `findIndex` — because the roster is built
  depth-slot-0 first, that returns the club's **best** player at the position: over
  660 star seeds, 8% overwrote someone already as good or better, and the mean net
  gain was +12.5 rather than the ~+20 it should have been. At a **one-job** position
  — and this generator's own list is `['QB', 'K', 'P']` — he displaces the
  **incumbent**, because there is nothing else for him to do: a franchise quarterback
  does not hold a clipboard. Seeding him against the weakest arm was how **27% of
  clubs** came out of generation with a second quarterback grading 80 or better, and
  it is where a $32M backup came from — the displaced starter stayed on the roster
  and kept his starter's price. If the incumbent is already the better man, spend the
  seed and change nothing.

Keep **three separate one-man-job lists** and do not collapse them, because they
answer three different questions: `ROSTER_TARGETS.max === 1` is a roster ceiling;
`ONE_MAN_JOB = {K, P}` answers "does a backup here take snaps" and is what
`carriesDepth()` reads; the star seeder's `{QB, K, P}` answers "is a *second good
one* a luxury".

### 1.6 Top a generated roster up to legal size

`rng.int(min, ideal)` per position sums to a **mean of 43** against a 46-man legal
minimum, so **31 of 32 brand-new clubs were born illegal**. Nothing noticed until
the first offseason, when the roster-filling pass bought ~90 bodies to fix it and
emptied the free-agent pool doing it. Both symptoms are that one shortfall.

Top each club up before writing it, to

```
target   = max(rosterMinFor(rosterMax), rng.int(lo, hi))
headroom = ROSTER_MAX − INITIAL_ROSTER_MAX
hi       = min(INITIAL_ROSTER_MAX, rosterMax − headroom)
lo       = min(INITIAL_ROSTER_MIN, hi)
```

with `INITIAL_ROSTER_MIN 47`, `INITIAL_ROSTER_MAX 48`, `ROSTER_MAX 53`. A default
league draws `int(47, 48)` exactly as before. **Scale the band, do not clamp it:**
preserve the five slots of **headroom** at any ceiling. Clamping instead puts every
club exactly at its limit with no open slots, which is the failure the 47..48 band
exists to avoid — a club's free-agency budget is
`rosterMax − roster.length − rookieReserve` with
`rookieReserve = ceil(7 × ROOKIE_ROSTER_HIT_RATE) = 4`, so a club born at 49 has
**zero** slots and is shut out of its own first free agency.

In the top-up loop, repeatedly pick the position with the largest `ideal − held`
deficit, skip any already at `max`, break ties by position order so it is
deterministic, and append the **next man down that position's chart** — so he takes
the decay for the slot he is actually filling and lands as ordinary depth rather
than a surprise starter.

> Know that this loop, not `max`, is why a club carries exactly one kicker: a club
> holding its one kicker scores a deficit of 0 and is never chosen again, whatever
> `max` says. Replayed over 400 generated clubs with `max` at 1 and then at 2, the
> composition is identical to two decimal places — K per club `{"1": 400}` both
> times. **The binding number is `ideal`.** If you want a backup-kicker market, move
> `ideal`.

### 1.7 Generate the fringe free-agent population

Real football always has hundreds of unsigned players in it. This league minted 140
at creation and nothing replenished them, so once the first offseason's
roster-filling had eaten the pool the free-agency screen was **blank for four
straight weeks** (measured: pool 15, best available 57 OVR, in a league whose
rostered mean is 77).

Top the market up to `FREE_AGENCY.POOL_FLOOR = 260`, **and only if short**, so from
the second offseason on this mints nobody. Draw two populations, not one bell curve
— the wire is undrafted 23-year-olds and 31-year-old special-teamers and almost
nobody in between, because a man in his prime who can play is on a roster:

- `FRINGE_YOUNG_SHARE 0.55` → age `int(22, 25)`, else `int(28, 36)`.
- overall `normalClamped(FRINGE_OVR_MEAN 59, SD 4, MIN 50, MAX 66)`.
- cap potential at `trueOvr + 6` (young) or `trueOvr + 2` (old). The generic roll
  gives a 22-year-old up to +15, which is right for a draft pick and wrong for a man
  nobody drafted.
- draw the dev trait from `{ Slow .55, Normal .45 }` only, so none of them is a
  hidden Superstar waiting for a coaching staff.

Make these men **deliberately not talent**. They exist to make the market a market,
and they are self-clearing: sitting far below the league's mean active rating puts
them under the unsigned-attrition floor, so ~42% of any that go unsigned are out of
football a year later and the pool tops up rather than accumulating.

Generate the ordinary unsigned pool at league creation from
`FREE_AGENT_OVR_MEAN 64`, `SD 8`, min 52, max 88 — about 7 points under the rostered
mean. Keep that in **one** constant: it was hardcoded in two places, so raising the
roster curve without raising this would have left free agents 13 points below the
rostered mean instead of 7.

### 1.8 Write draft picks at creation

Write **four** years of picks — `settings.draftRounds` rounds × 32 clubs × 4 years —
because the first of them is the draft that is about to run. Three years leaves the
trade hub with only two years of capital the moment that first draft ends; the
offseason's own pick-adding step keeps it at three from there on.

Give every pick a **placeholder slot** (the club's index in the generation loop) and
keep it until the order is reseeded from a finished season (§5.5). **Refuse to price
a draft whose slots are still placeholders.** Priced off a placeholder, a club
created first (slot 1) that actually finished best (real slot 32) is quoted $28.5M
for a seven-pick class that will really charge it $21.1M — 35% wrong, and wrong in
the direction that fires a warning at a club with room to spare. Return null, not a
number. Do not take the seeded year as an argument so the caller asserts it: the
caller passing the wrong year is the bug, so it cannot also be the check.

### 1.9 Generate a draft class

Mint a class at the **PRESEASON** step of the season before its draft, so it is on
the board for the whole season a GM spends looking at it. Make it
`DRAFT_CLASS_SIZE (224 = 7 × 32) + DRAFT_CLASS_EXTRA_UDFA (176)` = **400** men. The
extra 176 are what make a real share of the class go undrafted into UDFA free agency
instead of every prospect getting picked. Write each as
`status: 'FREE_AGENT', isDraftee: true, draftYear: <generating season>`.

**Give the class a personality.** Draw `round(normal(0, 6))` per position **group**
(OL / SKILL / FRONT7 / SECONDARY / SPEC) and apply it as an offset to every
prospect's target overall at his own group. That is the difference between "every
class is a flat random sample" and a class being loaded at one spot and thin at
another. Publish a plain-language summary as a league news item the week the class
lands — loaded is ≥ +5, thin is ≤ −5, e.g. "Loaded at SKILL, FRONT7 — thin at OL."

**Roll each prospect's rating:**

```
pct      = min(1, i / DRAFT_CLASS_SIZE)
tierMean = ROOKIE_OVR_MEAN + (1 − pct) × DRAFT_TIER_SPREAD
           − DRAFT_TIER_OFFSET + classStrength[group(position)]
roll     = normal(tierMean, DRAFT_OVR_SD)
rating   = bendToFloor(bendToCeiling(roll, SOFT_KNEE_HI, DRAFT_OVR_MAX),
                       SOFT_KNEE_LO, DRAFT_OVR_MIN)
```

`ROOKIE_OVR_MEAN 68`, `DRAFT_TIER_SPREAD 16`, `DRAFT_TIER_OFFSET 11`,
`DRAFT_OVR_SD 6`, `DRAFT_OVR_SOFT_KNEE_LO 52`, `DRAFT_OVR_MIN 42`,
`DRAFT_OVR_SOFT_KNEE_HI 80`, `DRAFT_OVR_MAX 88`. The ramp therefore runs from a mean
of **73** at the top of round one to **57** at the last pick and everything past it,
and `DRAFT_OVR_SD` is how far one man sits from his own slot.

**Cap `pct` at the last pick.** The class is longer than the draft; uncapped, the
ramp traverses only 56% of its range across all seven rounds while the undrafted eat
the rest — which is why a seventh-rounder used to grade the same as a first-rounder.

**Use sd 6, not 7.5.** The target tier ladder (rating spec §4) is, fitted, a rating
distribution of about N(69.9, 9.3) — a variance budget of 87. Three independent
things spend it: the per-group class-strength bias (N(0,6)) costs 36, the tier ramp
costs `SPREAD²/12`, and the roll costs its own square. At 7.5 the roll alone costs
56, so bias plus roll came to 92 before the ramp bought a single point of
top-vs-bottom gradient — the ladder was arithmetically out of reach at any spread,
offset or ceiling. At 6 the three come to 36 + 21 + 36 = 93 against a measured
target of 87, and the soft bends spend the rest.

Expect the tighter roll to **buy** the late rounds their steals, not cost them.
Prospects grading Star or better per round, over 60 classes ranked by the shipped
consensus board:

| round | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| sd 7.5 | 19.68 | 12.93 | 8.42 | 4.72 | 2.88 | 1.57 | 1.10 |
| sd 6 | 18.95 | 12.90 | 8.82 | **5.98** | **3.92** | **2.23** | **1.55** |

Every round from the fourth on is richer, the seventh by half again, and a
Generational prospect turns up in rounds six and seven **at all** now (0.02 a draft
each; over the same 60 classes before, neither round produced one). What the roll
gave up was noise the class-strength bias was piling on top of the ramp, not the
ramp's own signal: the gap between the first and last third of a class holds at
10.1 → 10.3 rating points.

**Bend both bounds; clamp neither.** They used to be the arguments of a clamp and
both ends of a class piled onto them: over 300 classes (120,000 prospects), 1.89% of
the pool sat on exactly 88 against 0.44% on 87, and **20.2% sat on exactly 54 against
2.7% on 55** — a 7.4× wall and the single largest defect in the generator. The bottom
was the larger by a distance, because the class runs 176 men past the last pick and
all of them roll around a mean only a few points clear of the floor.

Implement

```
bendToCeiling(raw, knee, ceiling) = raw                              if raw ≤ knee
                                  = ceiling − (ceiling−knee)
                                    × exp(−(raw−knee)/(ceiling−knee))  otherwise
bendToFloor(raw, knee, floor)     = raw                              if raw ≥ knee
                                  = floor + (knee−floor)
                                    × exp(−(knee−raw)/(knee−floor))    otherwise
```

Let the span double as the decay scale, so the curve leaves the knee with slope
exactly 1 — no kink — and approaches the bound without ever reaching it. The two
bends are disjoint by construction (52 is far below 80), so the middle of the class
is untouched and the order of the two calls cannot matter. **Use the same curve
`softCeiling` uses for potential**, called twice on purpose: a second mechanism
would leave two ceilings in one file free to drift apart the first time either was
retuned.

**Keep the asymptotes wide.** A tight asymptote does not remove a pile, it moves it —
the same lesson the potential knee had to learn. Bending toward 54 from a knee at 60
crams a fifth of the pool into six points and leaves a 1.53× spike at 55; bending
the top toward 88 from a knee at 82 leaves 1.23× at 86. At the shipped spread the
worst neighbour ratio anywhere in the distribution is **1.07×** — flat — against the
1.13× residual the potential curve leaves at 98. Neither bound is reached by the
curve; rounding can still land on one, which over 120,000 prospects was three men at
exactly the ceiling and one at exactly the floor. That is the honest meaning of
"asymptote" on an integer scale.

**If you move entry ratings, move six constants together.** Below the potential knee
`potential === trueOvr + potBonus` exactly, so the only way to lower what a rookie
*arrives* at without dragging the ceiling ladder down with him is to lower the rating
by X and raise `ROOKIE_POTENTIAL_BONUS_MEAN` by the same X. **Doing it with the
offset alone fails quietly:** inside a bend the finished rating falls by less than X
while the bonus rises by exactly X, so the shortfall lands on the ceiling, at
precisely the two ends of the ladder. Measured over 300 classes, the rating's
transfer per unit X and the worst tier-table row:

| | transfer | worst row |
|---|---|---|
| centre moved alone, bends left where they were | 0.945 | **46.0%** |
| bends disabled (diagnostic only) | 1.000 | 5.2% |
| bends translated with the class (shipped) | 1.000 | 5.9% |

At 46% the ladder is wrecked (Generational +46%, Deep Sleeper −20%) while every band
in the middle sits within 2% — the signature of a bend leaking. So translate the
**whole** geometry: the centre, both knees and both asymptotes, by the same amount.
Do not claim it is exact: the residual 5.9% is systematic, not sampling noise,
because two things do not translate — the per-group class-strength bias (added after
the ramp) and the attribute nudge, which lands `computeOverall` a point or two clear
of its target. 5.9% is inside the ±8% band the ladder already ran at, and that is the
claim.

**Guarantee every draft a headline name.** The ceiling roll is a roll, so 30% of
classes came out with nobody at 99 — no prospect the board could call generational,
in a year the user only gets one of. After rolling the class, look at the men the
**draft reaches** (the first `DRAFT_CLASS_SIZE`), find the best by potential then
rating, and if his potential is below 99 raise it to 99.

Make this a **floor on the count, never a cap**: it can only ever add the one man a
class was short, and only to the man already at the top of it, so nothing above one
is touched. Over 300 classes it takes the mean from 1.59 to 1.89 a draft and the
share of drafts with none from 29.7% to zero, while the share holding four or more
is 10.0% either way and the biggest class in the sample holds eight. It costs **a
step at 99 and nothing else** — guaranteeing a value puts probability on that value,
so 99 sits at 1.32× the height of 98 in the potential histogram with this and 1.00×
without, and nothing else in either histogram moves. Scope it to the draftable men:
a generational prospect nobody may pick is not a headline. Treat a class shorter than
`DRAFT_CLASS_SIZE` as all draftees.

Then generate a **college profile** per prospect (§1.10). Generate **combine testing
as a separate pass over the finished class** (§1.11) — it needs each prospect's
rating percentile within his own position group, and a prospect generated in
isolation has no peers yet to rank against.

### 1.10 Generate the college profile

Do not simulate a college season. Generate `COLLEGE_WEEKS = 13` procedural
college-style box-score lines per prospect plus a competition grade, once at class
creation, and reveal them progressively as the pro season plays out.

Drive every stat mean from one 0..1 quality dial:

```
prospectQuality(trueOvr) = clamp((trueOvr − DRAFT_OVR_MIN)
                                 / (DRAFT_OVR_MAX − DRAFT_OVR_MIN), 0, 1)
```

**Read the constants; do not inline the endpoints.** This was `(trueOvr − 40) / 55`,
matching an old class range. When the range moved the literals did not follow, so
the dial only traversed 0.25..0.87 and every college stat line compressed toward the
middle — over 1,200 prospects the dial's 1st-to-99th-percentile span fell from 0.96
to 0.62 and receiving production spread narrowed 15%.

Generate per game, with `q = prospectQuality` and
`normGame(mean, sd) = max(0, round(normal(mean, sd)))`:

- **QB** — `att = normGame(30, 5)`; completion %
  `clamp(0.55 + q×0.15 + float(−.05,.05), 0.45, 0.78)`; yards/attempt
  `clamp(6.8 + q×3.2 + float(−.8,.8), 4.5, 12)`; TD `normGame(1.3 + q×1.4, 1.1)`;
  INT `normGame(max(0.15, 1.1 − q×0.8), 0.7)`; rush yards
  `normGame(10 + speed/4, 15, min −10)`; rush TD at `0.15 + q×0.1`.
- **RB** — `att = normGame(14, 5)`; ypc `clamp(4.4 + q×2.0 ± .6, 2.5, 8)`; rush TD
  `normGame(0.4 + q×0.6, 0.6)`; targets `normGame(2 + q×2, 1.5)`; catches ~70% of
  targets at `clamp(7 + q×3, 5, 13)` yards each.
- **WR** — targets `normGame(5 + q×4, 2.5)`; catch rate `0.55 + q×0.1`; yards per
  catch `clamp(11 + q×6, 8, 20)`; TD at `0.12 + q×0.18`.
- **TE** — targets `normGame(3 + q×2.5, 2)`; catch rate 0.6; ypc
  `clamp(9 + q×4, 6, 15)`; TD at `0.1 + q×0.12`.
- **OL** — sack allowed at `clamp(0.18 − q×0.13, 0.01, 0.2)`; pancakes
  `normGame(1.5 + q×2.5, 1.3)`.
- **EDGE/DT** — tackles `normGame(2.5 + q×2, 1.3)`; sacks
  `max(0, normal(0.2 + q×0.5, 0.35))` to one decimal; TFL
  `normGame(0.6 + q×0.8, 0.6)`; forced fumble at `0.04 + q×0.05`.
- **LB** — tackles `normGame(4 + q×3, 1.8)`; sacks `normal(0.1 + q×0.2, 0.2)`; TFL
  `normGame(0.5 + q×0.6, 0.5)`; INT at `0.03 + q×0.05`.
- **CB/S** — tackles `normGame(3 + q×1.5, 1.3)`; INT at `0.06 + q×0.08`; passes
  defended `normGame(0.4 + q×0.7, 0.6)`; FF at `0.02 + q×0.03`.
- **K** — attempts `normGame(1.3, 0.9)`; make rate `clamp(0.65 + q×0.3 ± .1, 0.4, 1)`;
  XP `normGame(3, 1.2)`.
- **P** — punts `normGame(4.5, 1.5)`; average `clamp(38 + q×8 ± 3, 32, 52)`.

**Tune college to college norms, not pro ones**: 13 games, the real NCAA passer
efficiency formula `max(0, (8.4·yds + 330·td + 100·cmp − 200·int) / att)` (very
different weighting from the pro formula), and the one axis where college genuinely
runs hotter — yards per attempt, off the explosive plays spread/RPO systems give up.
Measured over 1,550 generated college quarterbacks against 3,591 simulated pro
seasons of 100+ attempts: completion % 60.5 college vs 64.1 pro; attempts/game 30.1
vs 43.0; yards/attempt **7.99 vs 5.48**. A college passer completing fewer at lower
volume than a pro is exactly right — real FBS runs about 61–62% on 31–33 throws — so
keep those numbers and do not "fix" them upward.

**Grade the competition** as `gradeRoll = clamp(q + float(−0.45, 0.45), 0, 1)`, then
index `['A','B','C','D','F']` by `clamp(floor((1 − gradeRoll) × 5), 0, 4)`. The ±0.45
overlap is the point: a chunk of A-tier talent tests against F-tier competition
(small-school hidden gems) and vice versa (system products at big programmes whose
stats do not hold up). Have the public board over-react to the grade in both
directions (§5.2).

**Gate how much of the file is visible on the phase, not the week:**

- `REGULAR` → `clamp(round(week × 13 / 17), 1, 13)`
- `PRESEASON` → 1 (the class has just landed; a screen with no line at all reads as
  missing data, and one game is the truthful floor)
- everything else — playoffs and every offseason phase including **DRAFT** → 13.

Do not compute this off the week alone. The league week is only a regular-season
week number in one phase; during DRAFT it is 1, so `round(13/17) = 1` and at the
moment a GM is on the clock he can see **one college game out of thirteen**. Once
the last whistle has gone, college football is over too and the file is closed.

### 1.11 Generate the combine

Generate six drills once at class creation. Make them **always public** — every club
watched the same stopwatch — and therefore never fogged. Set venue to `COMBINE` with
probability `clamp(0.22 + prospectQuality(trueOvr) × 0.63, 0.15, 0.92)`, else
`PRO_DAY`, so higher-rated prospects get invited more consistently. Express it
through `prospectQuality` for the same reason the college dial is: the old literal
spanned 0.22..0.85 across the old class range and 0.39..0.77 across the new one, so
the invitation had quietly stopped discriminating.

| drill | unit | direction | measures |
|---|---|---|---|
| forty | seconds | lower better | speed .65, acceleration .35 |
| vertical | inches | higher better | speed .40, strength .30, acceleration .30 |
| broad jump | inches | higher better | speed .45, strength .25, acceleration .30 |
| three-cone | seconds | lower better | agility .60, acceleration .20, speed .20 |
| shuttle | seconds | lower better | agility .60, acceleration .25, speed .15 |
| bench | reps | higher better | strength 1.00 |

**Skip the bench for `QB, WR, CB, S, K, P`.** Return `null` reps and have every
consumer renormalise its weights over the drills a man actually ran, rather than
scoring him against a battery he was never going to run. Flag anyone who ran fewer
drills than his own position group's **modal** battery as `thin`, so the reader is
told his average rests on less. (That flag fires on nobody today — the generator
gives every man his group's full battery — so build it as a guard on data that does
not exist yet, not as a thing the board shows.)

Anchor each drill per position, mean ± sd in the drill's own units. These **are**
fitted to published per-position NFL combine data, unusually for this codebase; move
them only against the same source.

| pos | forty | vertical | broad | cone | shuttle | bench |
|---|---|---|---|---|---|---|
| QB | 4.80 ±.11 | 31.0 ±3.2 | 111 ±5.5 | 7.05 ±.20 | 4.30 ±.14 | — |
| RB | 4.52 ±.09 | 34.5 ±3.3 | 119 ±5.5 | 7.02 ±.20 | 4.28 ±.14 | 20 ±4.5 |
| WR | 4.48 ±.09 | 35.5 ±3.3 | 121 ±5.5 | 6.95 ±.20 | 4.22 ±.13 | — |
| TE | 4.70 ±.10 | 33.0 ±3.2 | 114 ±5.5 | 7.10 ±.21 | 4.35 ±.15 | 19 ±4.5 |
| LT | 5.20 ±.13 | 27.5 ±2.9 | 103 ±5.0 | 7.85 ±.28 | 4.75 ±.19 | 25 ±4.5 |
| LG | 5.25 ±.13 | 27.0 ±2.9 | 102 ±5.0 | 7.90 ±.28 | 4.80 ±.19 | 26 ±4.5 |
| C | 5.22 ±.13 | 27.5 ±2.9 | 102 ±5.0 | 7.80 ±.27 | 4.72 ±.18 | 26 ±4.5 |
| RG | 5.25 ±.13 | 27.0 ±2.9 | 102 ±5.0 | 7.90 ±.28 | 4.80 ±.19 | 26 ±4.5 |
| RT | 5.20 ±.13 | 27.5 ±2.9 | 103 ±5.0 | 7.85 ±.28 | 4.75 ±.19 | 25 ±4.5 |
| EDGE | 4.75 ±.10 | 33.0 ±3.2 | 116 ±5.5 | 7.25 ±.22 | 4.40 ±.15 | 22 ±4.5 |
| DT | 5.06 ±.12 | 29.0 ±3.0 | 105 ±5.2 | 7.70 ±.26 | 4.65 ±.18 | 27 ±4.7 |
| LB | 4.65 ±.09 | 33.5 ±3.2 | 117 ±5.5 | 7.08 ±.20 | 4.32 ±.14 | 21 ±4.5 |
| CB | 4.47 ±.08 | 35.5 ±3.3 | 122 ±5.5 | 6.90 ±.19 | 4.18 ±.13 | — |
| S | 4.54 ±.09 | 34.5 ±3.3 | 120 ±5.5 | 6.95 ±.19 | 4.22 ±.13 | — |
| K | 4.95 ±.13 | 28.0 ±3.4 | 105 ±6.0 | 7.30 ±.24 | 4.50 ±.17 | — |
| P | 4.95 ±.13 | 28.0 ±3.4 | 105 ±6.0 | 7.30 ±.24 | 4.50 ±.17 | — |

**Do not make all six drills one scalar wearing different units, and do not anchor
only the forty.** That was the old generator and it measured out like this: forty vs
trueOvr −0.543, vertical +0.548, bench +0.527 — three identical magnitudes because
there was one variable — and forty vs **weight −0.005**. Unanchored, every position's
vertical came out 30.7–31.7in (real: CB 35.5, LG 27.0), broad 103.7–105.1 (CB 122,
LG 102), three-cone 6.82–6.87s (CB 6.90, LG 7.90), shuttle 4.17–4.22s (CB 4.18,
LG 4.80), bench 16.4–17.3 (DT 27, TE 19). A guard who runs a 6.30 three-cone and a
3.80 shuttle is not a guard — and those were not rare: **29.4% of all prospects
tested at exactly the 3.80 shuttle floor** (44.7× the count one hundredth above it)
and 17.3% at the 6.30 cone floor (24.5×). That is the clamp-pile defect again, in a
place nobody had measured.

**Compute one drill's z-score** for a `NORMAL` tester as

```
z = abilityWeight × abilityZ + attrWeight × attrBlend + NOISE_WEIGHT × noise
```

- `abilityZ = probit(clamp(truePercentile, ABILITY_PCT_CLAMP, 1 − ABILITY_PCT_CLAMP))`
  with `ABILITY_PCT_CLAMP = 0.03`. `truePercentile` is his rating rank **inside his
  own position group in this class**, 0 = worst, 1 = best, supplied by the class
  generator. A rank is uniform by construction so its probit is standard normal: no
  calibration constant to go stale. **The clamp is load-bearing** — the class builds
  the percentile as `idx/(n−1)`, so the best and worst man at every position come in
  at exactly 1 and 0, whose probits are the tails of the normal; that alone pushed a
  tackle's printed forty spread from the table's 0.13 to 0.19 because two men in
  fifteen were handed a ±4.75 z. Pinched to 0.03, the best of a fifteen-man group
  sits at about 1.9 sd, which is what being the best of fifteen is worth. Leave every
  interior rank untouched.
- `attrBlend` applies the drill's attribute weights to **how far above or below his
  own grade** he carries each one, in sd — "for a left tackle rated 78, is he a fast
  one?", the only version of the question a combine number can honestly answer here.
  Per attribute use `(value − expected) / sd` with `expected = trueOvr` (weighted) or
  `trueOvr × UNWEIGHTED_ATTR_LEVEL` (unweighted) and `sd = ATTR_SD × 0.94` or
  `× 2.17`. Return **0** for an attribute the position does not carry — neutral,
  never a fabricated read. Divide the blend by `sqrt(Σw²)` over the attributes the
  position **has**, so it stays unit-variance whether a position carries two of them
  or four.
- `attrWeight = sqrt(max(0, WEIGHT_SUM_SQ − abilityWeight² − NOISE_WEIGHT²))` —
  **derive it; do not give it its own constant.** That way a drill that reads less of
  a man's grade reads **more** of his profile and never less signal in total, and
  every drill's printed spread stays the anchor's sd instead of drifting with the
  weights. Set `WEIGHT_SUM_SQ = 0.994`, which is what 0.60/0.72/0.34 squared to;
  holding it there keeps existing spreads exactly where they were. Measured over 12
  classes before and after the weights moved, every position's printed spread is
  unchanged to the third decimal (LT forty 0.146 → 0.144).
- `NOISE_WEIGHT = 0.34` — a ninth of a drill's variance. Size it on real test-retest:
  the same athlete's combine and pro-day forty typically differ by 0.04–0.05s against
  a within-position sd near 0.10. Keep day-of noise real and **not large**: workout
  warriors and "he plays faster than he times" men both exist, and that gap is the
  content the scouting layer trades on, but supply it from the archetypes below, not
  by making every man's stopwatch a coin flip.
- Take `abilityWeight` **per position per drill** — §6.

Then pass `z` through `softTail(z, SOFT_KNEE_Z 2.5, SOFT_LIMIT_Z 4.5)`: identity
below the knee in `|z|`, compressed toward the limit above it, sign preserved, never
reaching it. It guards both tails of a symmetric distribution at once, which is why
it is its own function rather than a second caller of `bendToCeiling`.

Finally compute `value = anchor.mean ± anchor.sd × z` — minus for timed drills, plus
for jumps and the bench — and round forty/cone/shuttle to two decimals and
vertical/broad/bench to integers. **The bench cannot go negative and `Math.max(0, …)`
would be the very pile this removed.** Instead pull `softTail`'s limit in to
`min(SOFT_LIMIT_Z, (benchMean − 1) / benchSd)` so the asymptote itself sits above
zero: make the floor unreachable rather than crowded.

Price **playing weight** at `WEIGHT_PULL = 0.30` sd per sd of weight, against a
per-position reference weight mirroring §1.3 with `REF_WEIGHT_SD = 14`, negative on
everything that moves the body and positive on the bench. It is **inert at ship**
because the class generator hands over attributes and not a body; passing
`{heightIn, weightLb}` at that one call site is the whole fix, so write the function
to accept it.

**Roll three outlier archetypes that override the ability term outright**, because
testing alone cannot tell a workout warrior from a real one and only the tape can:

- bottom third (`truePercentile < OUTLIER_TIER = 1/3`): `WARRIOR` at
  `OUTLIER_RATE = 0.12` — great testing, bad football player. The trap.
- top third (`≥ 1 − OUTLIER_TIER`): `SLEEPER` at 0.12 (great testing, genuinely good
  — the man testing plus tape finds); failing that, a **second independent** 0.12
  roll off the same pool for `BAD_TESTER` (poor testing, genuinely good — the man
  testing alone would bury).
- middle third: never an outlier. The whole design point is that both traps are
  draft-capital-relevant misses, not "anyone can randomly test weird".

Give an outlier
`z = ±OUTLIER_Z (1.9) + OUTLIER_ATTR_WEIGHT (0.25) × attrBlend
+ OUTLIER_NOISE_WEIGHT (0.35) × noise`, so his six numbers are not identical. About
one prospect in nine is an outlier, which is why the realised spread runs ~1.1× the
anchor table (WR forty 0.10 against 0.09; LT forty 0.15 against 0.13; DT bench 5.1
against 4.7) — and that lands **on** the real per-position spread rather than under
it, because published combine sds include their own workout warriors too. Do not
"correct" it.

---

## 2. Positions and the depth chart

### 2.1 Use this position list

```
QB RB WR TE LT LG C RG RT EDGE DT LB CB S K P
```

Group them two ways. The coarse group — used by scout specialties and class strength
— is `OL | SKILL | FRONT7 | SECONDARY | SPEC`:

```
SKILL      QB RB WR TE
OL         LT LG C RG RT
FRONT7     EDGE DT LB
SECONDARY  CB S
SPEC       K P
```

Derive the lineup group (QB, RB, WR, TE, OL, DL, LB, DB, ST) from the starter table
in §2.2 rather than typing it out.

**Handle retired positions.** `FB` existed and no longer does; map it to `RB` — same
group, same stat line, same build. Retiring a position from the *type* does not
retire it from the *database*: `Player.position` is a plain string column, and every
save written before the change still holds fullbacks on rosters, under contract, in
depth charts and in draft history. Migrate the ones you know about and keep a
`canonicalPosition(raw)` alias for the ones you do not — an imported league file, a
restored backup, a save that was mid-write. **This matters more than it looks:**
every per-position table is indexed by a position string that ultimately came from
the database, and indexing one with a retired position returns `undefined`, which
does not throw — it silently becomes `NaN` inside an average or a multiply, and a NaN
rating looks like a rendering bug rather than a data bug. Fall unknown values back to
the string itself so a genuinely bad value still fails visibly at the lookup instead
of being silently mapped onto a real position.

### 2.2 Define the starting lineup once, keyed by position

```
Offense — 11 personnel:  QB 1, RB 1, WR 3, TE 1, LT 1, LG 1, C 1, RG 1, RT 1
Defense — nickel:        EDGE 2, DT 2, LB 2, CB 3, S 2
Specialists:             K 1, P 1   (on the field, not part of either eleven)
```

**Assert both sums at module load** and fail the import loudly if either side of the
ball is not eleven. Write that guard because this table used to live in three places
and one of them was wrong: two files each carried an identical private table keyed by
position *group* — `DL 4, LB 3, DB 5` — which is **twelve men on defence**, while the
depth chart used a third rule entirely (the top player at each of seventeen
positions), so its "Starter OVR" averaged seventeen players and its "Injured
Starters" counted across seventeen slots. Three definitions, none of them eleven.
Two copies of a table is exactly how a wrong number survives: there was no single
place where anybody would ever add the column up.

Key it by **position, not group**, because the depth chart has to say *three*
receivers start and *one* tight end does, and a group table cannot tell it that.
Derive group counts from this table rather than typing them again; they come out as
QB 1, RB 1, WR 3, TE 1, OL 5 (offense 11) and DL 4, LB 2, DB 5 (defense 11), ST 2.
Assert separately that every position is assigned to exactly one unit, or the sums
lie.

**Use nickel, not a 4-3 base**, for three reasons that agree: (1) it is the honest
answer to your own offense — if eleven personnel is the base then the defence that
answers it has a fifth defensive back, and defining the offense as 3 WR and the
defence as 2 CB would be the two halves of one file disagreeing with each other;
(2) nickel is roughly 60–70% of real defensive snaps, well clear of any other
grouping; (3) the rest of the codebase already assumes it — the team-rating unit
weights put DB at 0.17 against LB at 0.09, nearly two to one, a ratio only defensible
with five defensive backs and two linebackers, and `ROSTER_TARGETS` says the same
thing with 5 CB + 4 S ideal. Against the old broken group table, nickel also leaves
DL at 4 and DB at 5 exactly as they were and moves LB from 3 to 2 — the twelfth man
comes off and nothing else about the defence is relitigated.

Have `startersAt(position)` take a plain string and return **0** for anything it does
not recognise. Positions arrive here from the database, and a save written before a
position was retired must read as "starts nobody" rather than crash or index to
`undefined` and quietly produce NaN in an average.

### 2.3 Answer "is this slot filled" two different ways

Build both. Do not conflate them.

**For "how good is this unit"** — `slotsInOrder(orderedOvrsByPosition, group,
replacement)`: walk the positions in the group, take the top
`STARTERS_AT_POSITION[pos]` ratings **in the order the club actually plays them**,
and pad an unfilled slot with `replacement` when the caller supplies one. Do it
per-**position**: taking the best five of ten offensive linemen rates a club with
five good guards and no left tackle as though it had a line, and it means the eleven
the depth chart names and the eleven the rating averages are two different sets of
men — the same class of bug as the twelve-man defence. Pass a replacement level from
team ratings (a club two linemen short really is worse than one with exactly five)
and pass nothing from roster shape (which reports what a group *is*, and a group with
nobody in it should read as absent, not as bad).

Also provide `starterSlots`, which fills the same slots **best-first**, for the two
callers that genuinely want "what could this roster field" rather than "what does
this club field" — notably league generation, where the players are not in the
database yet and no chart has ever been written. Make it the **same slice and the
same padding**, a sort in front of `slotsInOrder` rather than a second rule behind it.

**For "who is actually on the field"** — `fieldedByPosition(players, depthOrder)`.
Delegate to the sim's own predicates; do not restate the policy. In this order:

1. **Drop the unavailable first** (`status !== 'RETIRED' && injuryWeeks <= 0`), so an
   injured starter is simply not in the list and the next healthy man is at index 0
   for as long as he is out — and the chart, never rewritten, puts him back the week
   he is fit.
2. Apply the club's named order, slotting a man the chart does not mention in **on
   merit** rather than dumping him last.
3. With no chart at a position, fall back to best-first by effective rating.

Hold explicit intent above rating on purpose, and accept the consequence: a man the
chart named can be out-rated by a man it did not, so when that named man is hurt the
better unnamed player moves up and the club reads **better** for the injury. That is
right — the chart was costing them and the injury undid it — and across 9,888 clubs
it happens 63 times, against 2,420 where an injury correctly costs the club. Do not
"fix" it.

> Write this function because the league-wide ratings builder used to average the
> best men at each position and call that the team, which was harmless only while the
> engine did the same. It stopped: the sim now fields the man the GM named. Over all
> 9,536 clubs in the database at the moment this landed, the two disagreed for
> **44.5%** of them, by up to **9.618 rating points** — a number disagreeing with the
> simulation it claims to describe, created by fixing the engine.

Define a narrow `Fieldable` shape — `id, position, trueOvr, status, injuryWeeks,
fatigue` and nothing else — and add a compile-time proof that the sim's own player
type is a superset of it. The availability and merge rules read six fields; the sim
type also carries names and a per-player **attribute JSON blob**, and loading that
for every one of ~1,700 men on every dashboard, roster, analytics, standings and
power-rankings render, to decide a sort order that never looks at it, is a cost with
nothing on the other side of it.

### 2.4 Name the depth-chart rungs off the engine

Store `DepthChartSlot` as `(teamId, position, rank)` unique, `rank 0` = starter,
pointing at a player. Read rows `orderBy: rank` and treat rank as **relative** — gaps
are fine, and renumbering is a write per surviving row to change nothing anybody can
observe.

Label rungs `WR1, WR2, CB3, EDGE4`. **Read how many rungs get a name off the
engine** — the length of that position's unit depth-weight array, i.e. the slots the
sim actually pays out against:

```
QB  [1.0]                        RB [0.62, 0.28, 0.10]
WR  [0.42, 0.31, 0.19, 0.08]     TE [0.70, 0.30]
EDGE[0.38, 0.32, 0.18, 0.12]     DT [0.40, 0.33, 0.17, 0.10]
LB  [0.45, 0.33, 0.22]           CB [0.40, 0.32, 0.19, 0.09]
S   [0.55, 0.35, 0.10]           LT/LG/C/RG/RT/K/P [1.0]
```

So four receivers get a name and the fifth does not; three backs and not the fourth.
**Invent no label beyond the weighted slots.** The engine reads nobody past the end of
that array, so a fifth receiver and a sixth are worth precisely the same to it, and
"WR5" would be a label asserting a difference the system does not make. Give those
rows a bare `#n`, which claims only a position in a list. Give an unrecognised
position no named rungs at all — the honest answer rather than a crash.

Do **not** reconcile this list with the starter table by picking one number. They
answer different questions: the starter table is who lines up in the base formation
(three receivers) and decides the tint and the bench line on the chart; this one is
how far down the engine counts. WR4 is therefore a real name on a bench row — he is
not on the field on first down, and he is still worth 0.08 of what the receiver unit
is rated at. Picking one number would make one of those two true things unsayable.

Provide `splitStarters(position, ordered)`, splitting an ordered list at
`startersAt(position)`. Preserve the order within a position exactly; this only says
where the line falls.

### 2.5 Build three distinct chart operations, and do not substitute one for another

**Auto-sort** (`autoDepthChart(teamId)`) — delete the club's whole chart and rebuild
it by rating, best first, within each position. Expose it as a **user-initiated
button** on the depth-chart page and use it as the league-creation default. **Never
run it implicitly on the user's club:** a GM who benched a 78-overall veteran for a
74-overall rookie he is developing would find that undone by a waiver claim at
another position.

**Reconcile** (`reconcileDepthChart(teamId)`) — run this after **every**
single-player roster move: trade, signing, cut, draft pick, position change. Every
roster player gets a slot; every slot names a roster player; **re-sort nothing.**
Specifically:

- keep listed men who are still on the roster in the order the chart already has;
- drop a slot naming somebody traded, cut or retired, or it holds a rank forever
  against a man who is gone;
- **trust the roster's position, not the slot's** — a slot written before a position
  change would otherwise file him under the old one;
- insert a man the chart does not mention **one past the last listed man who
  out-rates him**, which is the same rule the sim applies to an unlisted player. The
  chart the sim would have improvised is the chart that gets written down, so
  repairing the data never changes who plays; and the acquisition is placed on merit
  (a 90 does not land behind a 60) while never leapfrogging a man the GM deliberately
  ranked above better talent. Sort several simultaneous arrivals best-first relative
  to each other;
- make it idempotent with a cheap no-op path, so callers can run it after any move
  without checking whether anything changed;
- write **delete-then-insert wholesale**, because the `(teamId, position, rank)`
  unique constraint makes an in-place shuffle a minefield of transient collisions.

> Nothing wrote a chart when a player **arrived**, and an unlisted man ranks behind
> every listed one — so a 97-overall receiver acquired at the deadline sat behind a
> 57 and recorded nothing at all for his new club. No error, no warning: the trade
> silently did nothing. Measured on a fresh league one offseason deep, **229 roster
> players were missing from their own depth chart and 31 of them out-rated every man
> listed at their position.** Do not reach for auto-sort instead: it deletes the whole
> chart and rebuilds by rating, so using it on every arrival wipes the user's
> hand-set order.

**Orphan sweep** (`dropOrphanDepthChartSlots(leagueId)`) — one DELETE statement, for
the paths that move a hundred players at once (retirement, contracts expiring into
free agency, cut-down day) and set `teamId = null` in bulk, leaving the slot behind.
Measured: 533 of 8,836 chart rows in nine-season saves (6.0%) and 2,118 of 96,774 at
one season old name a man his club no longer employs, and **608 orphan rows sit
inside a starting slot, on 333 clubs**. It is not cosmetic — the depth-chart page
takes the first `startersAt(pos)` ids and filters out the ones it cannot resolve, so
an orphan at rank 0 does not shuffle the man behind him up; it reports the club a
starter **short** at that position with a real receiver two rows down. The sim is
unaffected, which is exactly why this survived: the game played on correctly while
the screen describing it was wrong. Make it **delete-only** so it is safe on the
user's club as well as the AI's — it removes rows and reorders nothing, so his order
stands exactly as he set it, minus the men who are gone.

**AI auto-sort** (`autoDepthChartAiClubs`) — re-sort every club **except the user's**
at the PRESEASON step, after the draft, and at in-season progression checkpoints,
because a chart goes stale when the ratings under it move and progression is a bulk
update that touches no chart. Diff before writing and only rewrite clubs that
actually changed. **Break ties on player id:** Postgres hands rows back in no
guaranteed order, so two equal ratings would otherwise swap places between runs and
mark a club "changed" forever — a write every week that alters nothing.

### 2.6 Warn on lineup gaps

```
lineupGaps(players) → [{ position, missing, none }]
```

For each position with starting slots, count men who are `status !== 'RETIRED' &&
injuryWeeks <= 0` and report `missing = max(0, needed − healthy)` and
`none = healthy === 0`. Sort worst first: a position with nobody at all outranks one
that is a man short, and more missing slots outrank fewer.

**Count healthy bodies, not bodies.** The depth-chart page already reported empty
starting slots, but a club with one quarterback read as covered even when that
quarterback was hurt — while the sim fields whoever is available and fills what is
left at replacement level (48), which wrecks the unit. A GM could walk into a week
having lost his only passer and be told nothing at all. Use `injuryWeeks > 0`, the
**same test the engine applies**; asking the question a second way here will
eventually produce a screen that disagrees with the game it describes.

### 2.7 Offer position changes as a menu, and price them from the weights

Offer exactly these moves:

```
LT ↔ RT ↔ LG ↔ RG ↔ C   (all five interchangeable)
EDGE ↔ DT     EDGE ↔ LB
CB ↔ S
K ↔ P
QB, RB, WR, TE — no relatives at all
```

Put **no numbers in this table.** It is a menu, not a cost model; the numbers come
from the position weights and nowhere else.

**Assert the list is symmetric at import.** A move you can make and not unmake is a
trap, and the whole point of the emergent-cost model is that going back restores
exactly what you had. A hand-maintained adjacency list is precisely the sort of table
that drifts silently.

Keep it **adjacent only** — offensive line to offensive line, linebackers only to
edge, safeties and corners. Leave out `LB ↔ S`, `WR ↔ TE` and `WR ↔ RB`: they are
defensible on football grounds (the big-nickel box safety and the big slot are real
jobs) but a menu that offers every plausible cross-training turns a depth chart into
a set of interchangeable parts, and the point of positions is that they are not.
Leave out `DT ↔ LB` even though EDGE bridges them: a 320-lb nose tackle is not a
linebacker, the weight vectors overlap enough that the engine would charge him only
about nine points for it, and this game does not model body type in a rating.
**Where the engine cannot see the objection, make the menu make it.** Likewise a
quarterback has no `kickPower` at all, so converting him to kicker would materialise
one at 0.85 of his overall and hand a 99 passer an 84 kicker — the engine cannot
price a move between positions that share no attributes, so do not offer those moves.
Do not instead offer all sixteen: that is worse in both directions, because a list
with `P` on a quarterback's card is noise, not freedom.

**Charge the move through the uncoached-attribute fill, and nowhere else.** In
`convertedAttributes(attrs, to, trueOvr, from)`:

- Remove nothing and change nothing existing. Fill in only the keys the new job
  weights **and he has never had**, at `CONVERSION_ATTR_FRACTION = 0.85` of his
  overall (seeded, clamped 20..99). Keeping the old position's attributes is what
  makes the move reversible at no cost, and they are not dead weight —
  `computeOverall` simply stops weighting them, and if he moves back they are still
  exactly where he left them.
- Use the **same 0.85** the generator uses for an attribute a position does not
  weight. It is not a free parameter: changing one without the other makes a
  converted player and a generated one two different kinds of object.
- Set the new rating to `computeOverall(to, filledAttrs)`. **Bolt no penalty onto the
  result.** Computing a rating from the attributes and then quietly subtracting from
  it leaves the card's rating disagreeing with the card's attributes, which is this
  codebase's defining bug class.

The charge therefore bites only where the destination weights something the origin
has never been graded on, and the lever varies enormously across the menu. Know where
it is strong before you price positions against each other:

| move | what is learned | share of the new job | measured cost |
|---|---|---|---|
| LB → EDGE | `passRush` | 0.36 | **−5.9** |
| EDGE → LB | tackling, coverage, football IQ | 0.46 of 1.18 | — |
| C → LT/RT | `footwork` | 0.18 / 0.16 | small |
| anything → C | `football_iq` | 0.14 | small |
| S → CB | `press` | 0.14 | −1.7 |
| LT↔RT↔LG↔RG, EDGE↔DT | nothing | 0 | **0.31 mean** |

Those last pairs weight **identical attribute sets**, so at equal attributes the
engine cannot tell the two jobs apart and has no lever whatsoever. Price them
identically in the trade market; there is no conversion cost available to cover a gap.

**Make the move reversible.** A version of this decayed the grades the old job valued
and the new one ignores, so a round trip cost about four points and compounded. It
worked, and it was the wrong call: the cost of playing a man out of position is
already real and already felt — he is eight points worse the whole time he is there —
and a permanent tax on top of that only punishes finding out. Convert a man twenty
times and bring him home and he must be exactly the player he was. That is also what
lets you **skip any cooldown or once-per-season gate**: there is nothing to ratchet.

**Guarantee no conversion pays for itself.** Because moves are reversible, if moving
a man to a position the market pays more for makes him worth more, the game is a
money printer: buy the cheap label, convert, sell the dear one. **That was live and
measured at 5.5×** — the same 84-rated man priced 46 as a right tackle and 251 as a
left tackle, for a move costing nothing. Close it with two mechanisms:

1. `maxOvrAfterConversion(from, to, ovr)` — derive the ceiling from the trade-value
   tier curves, not from a hand-written matrix of penalties. A matrix is a *second
   opinion* about the same thing and drifts the moment anybody retunes a curve.
   Return `Infinity` when moving *down* in positional value: the move already costs
   him value and nobody arbitrages a loss. Where a ceiling exists, turn the uncoached
   fill **down** in steps of 0.05 from 0.85 until the converted overall is at or
   under it. Use that lever rather than a subtraction, because it is the same lever
   the honest charge already uses: the attributes he has never been graded on are
   exactly the ones the new job needs, so "he is worse at this than at his old job"
   and "he is not worth more for having switched" are the same statement about the
   same man. Seed a floor of 20; the fill does not reach zero, that limit is real,
   and it is reached (LB priced at the lowest tier throws).
2. An **import-time assertion** that sweeps every offered move at **every rating from
   60 to 99** and fails the build if the converted man is worth more than
   `before + 0.5`. Sweep, do not sample: the old four-rating sample
   (`[72, 80, 88, 94]`) reports a clean bill on a configuration that is in fact
   profitable at 73 (S → CB, 28 points → 29). Where two positions' attribute sets are
   identical the requirement collapses back to "equal tiers" — say so in the failure
   message, so nobody has to rediscover why.

**Move the ceiling with the rating, by the same signed delta.** `potential` used to
be deliberately untouched, on the reading that it is "a ceiling on the man, not on
the job". Measured, that reading refunded most of the conversion, twice over:

- The trade market does not price the rating. It prices
  `trueOvr + (potential − trueOvr) × w`, with `w` between 0.18 and 0.55 depending on
  the club's window. Charge the rating and leave the ceiling and the gap **widens by
  exactly the charge**, so only `(1 − w)` of it reaches the number anybody trades on
  — **63% refunded** at a neutral club. Over 22,600 rostered linebackers, that alone
  took LB → EDGE from 227 profitable conversions to **6,055**, with 201 clearing
  +100 points — a third-round pick of free money, for a move that also drops his
  rating seven points. Moving the ceiling brings it to 763, of which 7 clear +100.
- Progression refunded the rest: it uses `potential` as a per-attribute attractor
  over the **new** position's attributes, so an untouched ceiling meant a converted
  man simply grew back to it in the new job within a couple of seasons. The cost was
  a loan, not a price.

Two properties keep that safe rather than a second penalty: **preserve the runway
exactly** (`potential − trueOvr` is unchanged, so a 24-year-old with seven points of
growth left still has seven — what changed is where those seven points start from,
which the rating change already said), and **keep it reversible** (moving back
restores the attribute map exactly, hence the overall exactly, hence a delta that is
exactly the negative of the first; the one exception is a ceiling clipped at 99 on a
move that raises a rating, which does not come all the way back).

**Route the preview, every AI decision and the commit through one function.**
`positionMove(player, to)` returns the new position, the new overall, the signed
`delta`, the newly `learned` attribute keys, the full attribute map ready to persist,
and the new ceiling with its delta — so the number on the card is by construction the
number written to the database. Make `potential` optional on the input, because two
callers genuinely have no business with it (the import-time arbitrage guard builds a
synthetic man who has none; the AI's depth-chart planner is only asking "would he
rate higher over there"), and have everything that **writes** pass it. Have
`positionMoves` return every offered move **ordered by what he would rate**: a GM
scanning the list is asking "where is this man worth most", and the answer should be
the top row.

**Re-check everything in the commit.** A server action is a POST endpoint and a menu
is a rendering decision, not a security boundary. Require the player to be on the
user's own club; **refuse a draft prospect** ("prospects keep the position they were
scouted at" — moving one would be editing a scouting report, not making a coaching
decision); require the move to be on the menu and name the legal destinations in the
refusal; then write position, attributes, overall and potential, reconcile the depth
chart **in the same transaction**, and file a `POSITION` transaction naming both
ratings, the ceiling change and the count of untested traits.

### 2.8 Protect a club's last kicker and last punter

Keep the automated cut ordering blind to position **except** for `ONE_MAN_JOB =
{K, P}`. For fourteen of sixteen positions blindness is right — a club that sheds its
fifth receiver still has four and the depth chart absorbs it. These two are the pair
where there is no second man to absorb anything: a club that releases its kicker
fields nobody, and the sim hands the empty slot replacement level for the rest of the
season.

**It was happening, at a size worth fixing.** Counted across every club in the
development database: **213 clubs carry no kicker at all and 218 no punter, and 113
of the kicker-less ones are carrying fifty or more men** — a full roster with nobody
to kick, which is not a club that ran short of bodies. Replaying the shipped cut
ordering over 6,373 real rosters, an overflow of five men takes a club's only kicker
on **3.67%** of them and its only punter on **4.14%**; the median club's kicker sits
26th in the cut queue, but the 5th-percentile club's sits **6th**. Nothing puts him
back either: roster-filling only signs for a club **under** the minimum, and cut-down
day is the last roster event before week 1.

What it costs is measured, not asserted: swapping one club's kicker across the rating
range on identical rosters and identical seeds moves that club's scoring by **0.666
points a season per rating point**, so the drop from a median 73 kicker to an empty
slot's 48 is about **sixteen points a season** — a fifth of the gap between a good
offence and a bad one, paid by a club that never decided to pay it.

**Protect the order, not the decision.** Have `lastAtOneManJob(roster)` return the
ids of men who are the *only* one at a one-man-job position, sort those ids **behind
every unprotected man**, and still release a protected man if the club has more
overflow than it has other bodies. Protect only the **last** one — a club carrying
two kickers may cut one, which is what keeps this from freezing a specialist onto a
roster forever.

---

## 3. Roster management

### 3.1 Set the limits

- `ROSTER_MAX = 53`, a league setting the user may configure.
- `ROSTER_MIN = 46`, calibrated **against** 53 — so scale it, never inherit it:
  `rosterMinFor(rosterMax) = max(1, min(46, min(rosterMax, round(rosterMax × 46 /
  53))))`. A league with a 40-man limit told its minimum is 46 reads "short of the
  minimum" permanently on every keep-or-cut screen.
- `DRAFT_ROUNDS = 7`. No practice squad in v1.
- `ROOKIE_ROSTER_HIT_RATE = 0.5` — the share of a draft class that actually sticks,
  used to decide how many slots the AI free-agency wave holds back for rookies. This
  is not cosmetic: reserve the **full** class (7 of 53) and the effective free-agency
  ceiling is exactly 46, which **is** the minimum, so every club at or above the
  legal floor skips free agency entirely and **the market shuts down league-wide** the
  moment roster sizes recover.

### 3.2 Make cutting a two-step, fully-priced action

Price it without writing (`cutImpactAction`), then write it (`cutPlayerAction`).

A cut is the one move whose real cost is invisible at the point of decision: in
realistic cap mode **two separate bills land on this year's cap the moment he is
gone** — every remaining dollar of prorated signing bonus (void years included)
accelerates, and any base salary the club guaranteed him still has to be paid for
seasons he will not play. Either one alone can make a contract cost more to release
than to keep. So return both **under their own names** — `deadBonus` and
`deadGuaranteedSalary`, each read back from the same function the charge is built
from and never re-derived — alongside `currentHit`, total `deadMoney`, `savings`
(which **can be negative**), cap space before and after, and two explicit verdict
flags: `leavesOverCap` and `costsMoreThanKeeping`. Say which bill is doing the damage
rather than blaming the bonus for a bill the guarantee ran up. Show no dollar figures
at all with the cap off. Defer the arithmetic itself to Part 3.

**Check ownership twice.** Owning the save proves the save is yours and says nothing
about the player id that followed. Without a player-in-league check the panel looked
a player up by primary key alone and answered for anybody in the database —
measured, **a stranger's save came back by name with his cap hit, his dead money and
his club's remaining cap space.**

**Answer a refusal in the game's own words.** Two clicks on Release raced each other
and the loser came back holding a raw ORM stack — `Record to delete does not exist` —
rendered verbatim in the confirmation the GM reads. Have the second click say "He is
not on the roster any more — that release has already gone through. Reload the page."

To commit: book dead money as a cap charge, delete the contract, set
`teamId = null, status = 'FREE_AGENT'`, zero `weeksUnsigned` (so it always means
"weeks since he last hit the wire" rather than "weeks he has ever spent unsigned"),
write a wire entry, and reconcile the depth chart.

### 3.3 Use one release ranking everywhere

Cut-down day, an AI club making room in a trade, and an AI club paying down a cap
shortfall must all use this one ordering. **Who goes has to have the same answer
everywhere, or a club sheds one man in a trade and a different one in September.**

```
protected = lastAtOneManJob(roster)              // §2.8
score(p)  = p.trueOvr + deadMoneyOnCut(p) / CUT_DEAD_MONEY_PER_OVR
sort by: isProtected asc, then score asc, then trueOvr asc, then id asc
```

Set `CUT_DEAD_MONEY_PER_OVR = $1,500,000`: a player costing this much to release is
as hard to cut as a man one rating point better. **Convert dead money into rating
points rather than comparing them directly** — the two are not otherwise
commensurable, and a ratio would need its own scale anyway.

**Put money in the ranking.** It used to cut strictly by lowest rating, so a club
would eat a large guaranteed hit to waive a 61 while a 63 on a minimum deal — free to
release — sat next to him. No front office does that; the whole point of cut-down day
is that money is part of the decision. It survived because AI clubs used to draft on
true ratings, so their own picks were never the worst men on the roster and the
expensive-to-cut players were never in the firing line. Once clubs started drafting
off a fallible board (§5.4), late picks could genuinely be bad — and measured, clubs
began **waiving men they had drafted days earlier**, writing the rookie bonus off as
dead money and going over the cap on cut-down day. The over-cap invariant rose from 6
hits to 28–50, and nothing re-checks AI compliance between the draft and week 1, so a
club that went over **stayed over for all seventeen weeks**.

### 3.4 Run cut-down day once, at the end of the draft

Run `trimRostersToLimit` on the advance out of DRAFT into PRESEASON — the last roster
event before week 1. Free agency and the draft both add bodies and neither reads the
roster limit, so without this a club rolls into the season carrying 57 players.

For each **AI** club: compute `overflow = activeRoster − limit`; if positive, release
the first `overflow` men in the release ranking (§3.3). On each release, book dead
money as a cap charge, delete the contract, and send the man to free agency. Write
**one transaction per club, not one per player**: 100+ individual CUT wire rows a
year would bury the news feed.

**Never trim the user's club — block the advance instead.** This used to query the
whole league with no user filter, sort the human's roster by rating ascending and
waive the overflow: releasing players the user chose, booking dead money against him,
and picking the victims by a rating the fog-of-war settings mean he cannot even see.
Deciding who to cut is the single most characteristic decision in the genre; the game
does not get to make it. Have the block name the club, the roster size, the limit and
how many to release, point at the roster page, and say that every other roster in the
league has already made its final cuts.

**Then keep the club under the ceiling.** After trimming, have an AI club in
realistic mode pay down any shortfall through the shared cap-relief path — the one
that picks by what the club loses in **football** rather than by the biggest cap
number, and stops honestly when no combination of releases can cover the bill (at
which point the standing over-cap machinery carries it, exactly as it does for a user
whose remaining moves all cost money). Do not write a second selection rule next
door. The trim itself **books** dead money, so it can spend a club's last room rather
than free room: measured across 6 leagues × 2 seasons, counting only over-cap
readings outside the offseason's tolerated window, **44** team-readings before dead
money became bonus-plus-guarantees, **110** after, **0** after with this block.

### 3.5 Fill to the minimum by two different paths

**The user's "Fill Roster" button, in two steps.** Have the preview decide and price
without writing, and have the commit **re-decide** and write. Deliberately do not
accept the plan you showed: a server action is a POST endpoint whether or not a
confirm sheet stands in front of it, so a list of player ids and prices arriving from
the client is a request, not a decision. Re-deriving costs one read and makes the
sheet unforgeable. (It was one step, and both the playtest audit and the pre-launch
review filed the same complaint: *"one curiosity click deletes 80% of a new player's
cap in 3 seconds with no undo"*.)

Sign **at most one man per position that still shows a notable need** per pass
(`teamNeeds ≥ 0.15`, the same floor the Roster Needs widget uses), most severe first:

- Gate eligibility on price: `askingPrice(man) ≤ CAP.MIN_SALARY ×
  FILL_MAX_MARKET_MULT (1.5)`. Price it off `trueOvr`, **not** off this club's
  scouting report — the eligibility test and the offer are one number and that number
  has to be the man's real one, because pricing him through a fogged view turns a bad
  scouting department into a way to sign a 90-overall for the minimum.
- Price the **whole** unsigned pool once, and leave it unbounded. The eligible tier is
  the *bottom* of the board by definition, so a per-position `orderBy trueOvr desc,
  take: 10` hands back ten men who are all too expensive and calls the position empty;
  ordering the other way and taking N is also a guess, because `askingPrice` carries
  position and age multipliers and is not monotonic in rating. A few hundred narrow
  rows once per click is the honest read.
- Build the deal as **1 year, zero bonus, zero guaranteed**, stated explicitly rather
  than inherited from the contract builder's defaults (0.28 bonus / 0.45 guaranteed).
  Those two defaults are what turned a bench signing into a contract the owner could
  not release: the bonus accelerates on a cut and the guaranteed base is owed for a
  season he will not play. **A camp body has to be free to cut the day after camp —
  that is what the deal is for.** Read `deadMoneyIfCut` back off the built contract
  rather than asserting zero, so a future change says so instead of printing a
  promise the deal no longer keeps.
- Hold back a **$3M reserve**: a button may not spend the last of a GM's room, and
  there has to be something left for the in-season moves he still has to make — an
  injury replacement, a claim. Make it inert in cap-off mode.
- Report every signing (name, position, age, APY, years, cap hit, dead money if cut),
  every position you **passed** on with the reason ("nobody at TE will play for the
  minimum"), totals, cap space before and after, and a single `stoppedBy` sentence
  when you run out of room or roster slots.

**The AI path** (`fillTeamsToRosterMinimum`) signs minimum one-year deals for clubs
**under** the legal minimum. It is the one signing path in the game that never asks
whether the man would accept, which is exactly why it needs the same price ceiling:
without it a short-handed club could buy the best free agent in football for the
league minimum, and did — one market went **91 players to 15 in a single step, top
man 85 OVR to 57**, before the user ever saw the screen.

Fire a **front-office brief item** (§7.5) when the user's own club is under the
minimum, and stay silent through OFFSEASON and RESIGN, where essentially every club
in the league is briefly under the line by design (expiring deals have come off and
free agency has not opened). State the cost, because it is already charged on the
field and was simply never said: on identical seeds, schedules and opponents, the
same club stripped to its best 24 men went offense 83.7 → 79.7, defense 83.9 → 77.6,
a 12-5 season into 7-10, and +114 point differential into −55 — **about five wins**.
A cost a GM cannot see is a cost he cannot decide against. Do not solve this with a
button that refuses to advance; the game already charges it correctly.

### 3.6 Injuries

**Roll them** per available player, per game, when injuries are enabled:

```
durability = attrs.durability ?? 60
rate       = INJURY_RATE_PER_GAME × (1 + (60 − durability) / 200)
if roll(rate):
    weeks = max(1, round(normal(INJURY_WEEKS_MEAN, 1.8) × settings.injurySeverity))
    type  = pick(typesForSeverity(weeks))
```

`INJURY_RATE_PER_GAME = 0.032`, `INJURY_WEEKS_MEAN = 2.6`. Use `durability` — a real
attribute at `scoutDifficulty 0.70` (rating spec §1) — so a brittle player really does
get hurt more, and a prospect's medical flag correlates with it without being
determined by it (§5.2).

**Bucket the flavour text by how long the injury actually keeps him out**, so the name
and the duration can never contradict each other:

| weeks | bucket | examples |
|---|---|---|
| ≤ 2 | short | Bruised ribs, Ankle sprain, Concussion protocol, Shoulder stinger, Deep bruise |
| 3–5 | medium | Hamstring strain, Groin strain, High ankle sprain, Fractured hand, MCL sprain |
| ≥ 6 | long | Torn ACL, Achilles rupture, Fractured fibula, Torn labrum, Broken collarbone |

Store `injuryWeeks` (int) and `injuryType` (nullable string). **Treat them as one
fact and clear them together.**

**Recover in one bulk statement per week, league-wide:**

```sql
UPDATE Player
   SET fatigue     = GREATEST(fatigue - FATIGUE_RECOVERY, 0),
       injuryWeeks = GREATEST(injuryWeeks - 1, 0),
       injuryType  = CASE WHEN GREATEST(injuryWeeks - 1, 0) = 0
                          THEN NULL ELSE injuryType END
 WHERE leagueId = ? AND status = 'ACTIVE' AND (fatigue > 0 OR injuryWeeks > 0)
```

(`FATIGUE_PER_GAME 18`, `FATIGUE_RECOVERY 22`.) Do not write it as a findMany plus
one awaited update per active player — that is ~1,700 round trips a week for a
32-club league.

**Keep recovery running through the playoffs.** It was called from exactly one place,
the regular-season week simulation, so **an injury clock stopped dead the moment the
regular season ended**. The owner, twice: *"i just had an injury occur at week 17, i
simmed 2 weeks while on that player's card and the injury remained until round 2 of
playoffs"*, and then *"simmed again, still 2 weeks"*. He was reading it correctly:
the number never moved, so a man hurt in December was out for the whole run however
short his injury was, and **the postseason was the one part of the game where injury
length meant nothing at all**. Fatigue was the quieter half of the same omission —
four rounds of football with no recovery, accumulating hardest on the club that keeps
winning.

So run the same week between postseason rounds, **inside the exactly-once-per-round
lock that builds the next bracket** — the only such guarantee the postseason has. The
recovery pass is league-wide, unguarded and unwitnessed (nothing on any screen would
show it having run twice), so ride inside the lock and let the round-builder's own
"bracket already exists" test be the answer: whichever advance actually builds the
next round is the one that ran the week, and a second click heals nobody.

Run it **after the round's games, not before** — where the regular season puts it, and
the football answer as well as the mechanical one: a man carried off in the wild-card
round has the following week to get right, exactly as he would in November, and a
one-week injury sustained in January costs him one January game rather than the
season. Do **not** run it after the final: there is no next round to be fit for, and
the offseason progression step a click later zeroes fatigue and injury clocks outright
for everyone who comes back next year. Write `injuryType: null` alongside that zeroing,
because the two are one fact and were being cleared separately — a stale injury name
sat on a healthy player's row, rendered by nothing because every reader gates on
`injuryWeeks > 0`.

**Decide for yourself whether injury rows carry a `playerId`.** The reference
implementation's do not — 82,440 of them in the development database and not one
attributable — so the career record cannot say "missed three — hamstring", and it
deliberately says nothing rather than inventing a cause (the games-played column
already tells the reader he was short a year). If you attribute them, the career
record can carry injury lines; if you do not, hold that same line.

---

## 4. Scouting

### 4.1 Scope the fog to draft prospects, and nothing else

Build the three tiers exactly as the rating spec §8 states them:

| | current rating | ceiling |
|---|---|---|
| your own roster | exact | **exact** |
| other clubs' pros | exact | **±5, flat and permanent** |
| draft prospects | fogged | fogged, narrows with scouting |

Gate the whole system on one boolean, `isProspect`, and **default it to false** — a
call site that says nothing gets true ratings. Have the draft-facing call sites pass
`isProspect: player.isDraftee`.

**Fog is a cost**, paid on every screen it touches, in readability: a column of
"71-79" is harder to read, sort and trust than a column of numbers. It only earns
that cost where "we didn't know" is a real football story, and that is the draft and
only the draft. A free agent with five seasons of production behind him is not a
mystery; you can watch the tape. Your own left tackle is not a mystery to you at all.
Uncertainty about men who have never played a professional down **is** the drama;
uncertainty about men whose careers are on film is just a worse spreadsheet. **Do not
"fix" a screen that stopped showing ranges by flipping this on for it.**

Keep the middle row dead still. `POT_FLAT_HALF_BAND = 5` must not move with
confidence, with a scouting report, with a GM skill rank or with the calendar. It is
not a confidence interval; it is the statement that you know your own players'
ceilings because you coach them every day and you do not know another club's because
you do not. Threading confidence into it reintroduces exactly the machinery that was
removed.

### 4.2 Compute the error in two parts that shrink together

```
errorBand(confidence, difficulty, extraPenalty):
    t   = clamp(confidence / 100, 0, 1)
    max = MAX_ERROR × (0.55 + difficulty)      # MAX_ERROR 16
    min = MIN_ERROR × (0.5  + difficulty)      # MIN_ERROR 2
    return Math.max(0.5, max − (max − min) × t^0.65 + extraPenalty)

observationSd(confidence, difficulty):         # the INDEPENDENT half
    max = OBSERVE_SD_MAX × (0.5 + difficulty)  # OBSERVE_SD_MAX 11
    min = OBSERVE_SD_MIN × (0.5 + difficulty)  # OBSERVE_SD_MIN 1.5
    return max − (max − min) × t^0.7

observationBiasSd(confidence):                 # the CORRELATED half
    return BIAS_SD_MAX − (BIAS_SD_MAX − BIAS_SD_MIN) × t^BIAS_CURVE
    # BIAS_SD_MAX 6.0, BIAS_SD_MIN 0.3, BIAS_CURVE 0.7
```

The `^0.65` and `^0.7` exponents make convergence quadratic-ish, so the first 30
confidence buys the most clarity.

**Draw ONE correlated bias per player per observation, before the attribute loop, and
add it to every attribute.** This is the single most important thing in the scouting
layer and it was missing for a long time while the file header claimed it existed.
Without it every attribute is drawn independently around its true value and
`computeOverall` averages a dozen of them, so the noise **cancels**: measured over
150 blind classes of 400, an unscouted club's centre was out by sd **3.90** while the
range it printed was **±12.73** — a band 3.26× wider than the error it was quoted
around, holding the truth **99.8%** of the time. That is not a confidence interval,
it is a guarantee, and it made the board a solved puzzle: rho **0.917** against the
truth for free, rising only to 0.996 with every scouting point in the game spent — the
whole tree bought 0.08 of rank correlation. Re-scouting the same man 240 times moved
his mean read by nothing measurable. "You think he's a 78; he's a 71" **cannot
happen** through independent per-attribute noise on twelve attributes.

Size the bias at 6.0 — swept against 0/3/4/5/5.5/6/6.5/7 on pre-registered bands. At
6.0 the cold error is sd **6.27**, band/error **2.02**, coverage **96.6%**, the cold
board drops to rho **0.816**, and a full file still reaches rho **0.994** with an
error of 1.01 — so the tree now buys **0.18** of rank correlation instead of 0.08.
**The band did not widen; the error narrowed.** Measure the band against the error,
and treat coverage above ~97% as proof the band is too wide and scouting is
decorative.

Give the correlated term **no difficulty factor**. Difficulty says how hard one
*trait* is to measure; this says how wrong the building is about the *man*, and a
room that has him a tier too high is a tier too high on his stopwatch and his
instincts alike. Keep difficulty on the independent half, which is where "a 4.4 forty
converges faster than decision making" belongs.

**Do not apply the bias to potential.** That is measured, not an oversight: potential
is a **single** observation, so its error never averaged down in the first place —
sd 13.55 cold against a ±19.25 band, ratio 1.42. Biasing it would widen a number that
was already honest.

Store potential's observed centre under a synthetic key (`_POTENTIAL`) in the same
observation map, drawn at `observationSd(effective, POTENTIAL_DIFFICULTY = 0.95)` and
clamped 40..99. **Every caller of `observe()` must pass the true potential** — omit it
and the key is never written, and `buildScoutedView`'s fallback collapses every
unscouted player's ceiling to the same flat `POTENTIAL_DEFAULT_CENTER = 80`, which is
how every prospect in a class once read as the same tier.

Let a better scout effectively raise confidence for observation purposes:
`effective = clamp(confidence + (scoutAccuracy − 50) × 0.25 + specialtyBonus × 100,
0, 100)`, with `SPECIALTY_BONUS = 0.25`.

Expect these figures, re-measured over a 400-man class observed four times at each
level, and treat them as the acceptance test:

| confidence | displayed band | centre error (rms) | truth inside band |
|---|---|---|---|
| 8 | 25.5 (±12.7) | 6.25 | 97.3% |
| 25 | 20.1 (±10.0) | 4.87 | 97.4% |
| 40 | 16.0 (±8.0) | 3.88 | 97.4% |
| 60 | 11.6 (±5.8) | 2.72 | 98.0% |
| 82 | 6.9 (±3.4) | 1.58 | 98.6% |
| 95 | 4.5 (±2.3) | 1.00 | 99.6% |

**Errors average; bands add**, and that is why the two numbers on a draft board's OVR
cell say different things about the same man. Compute the **centre** as
`computeOverall` of the per-attribute observations — the independent noise in them
cancels down to about 0.38 of one attribute's error for a quarterback and 0.53 for a
left tackle, and what stops the centre being nearly right is the correlated term,
which passes straight through the average at close to full size. Compute the **band**
as `computeOverall(every attribute at its low) .. computeOverall(every attribute at
its high)` — every attribute wrong in the same direction at once, which sums instead
of cancelling and keeps the full half-width.

**Slide a band onto the scale; never cut it off at the ends.** A cut band is narrower
than an uncut one, and width is a tell: measured over 4,800 fogged prospects at the
confidence a new class actually arrives with, **36.9%** showed a potential band
ending on exactly 99 and the displayed widths ran from 20 to 40 points — so a
four-point "95-99" cell sitting beside a forty-point one announced the elite ceiling
the band exists to conceal. Implement one `slideBand(center, half, lo, hi)` that
holds the width constant at `min(2 × half, hi − lo)` and shifts the window, and share
it between the veteran's flat band and the prospect's scouted one. Near the ends
several different ceilings then map to the same band (a 94 and a 99 both read 89-99),
which is strictly **more** ambiguity than the middle of the scale, never less.

**Floor a revealed player's potential band at his own current rating.** Shown a
94-rated free agent quoted "POTENTIAL 89-99", the owner asked: *"see how the potential
is lower than his current overall, is that intentional?"* It was not — the band was
centred on his true ceiling and clamped only to the rating scale, so a man whose
ceiling **is** 94 was shown a range opening five points below the 94 printed directly
above it. Two numbers on one card, one of them impossible. Flooring is the honest
read, not a cosmetic tidy-up: this branch only runs for a player whose overall is
fully known, so whatever you do not know about his ceiling is entirely on the upside.
Let the band **narrow** rather than shift up. Keep the floor optional so the one
prospect-side caller — where the overall is itself a fogged range and cannot floor
anything — is unaffected.

### 4.3 Build exactly one function that decides what the user may see

`buildScoutedView(args)` returns `{ scoutedOvr, ovrLow, ovrHigh, potLow, potHigh,
confidence, attrs[], revealed, potentialRevealed, notes }`.

Return a **full reveal** when any of: the report is `fullyRevealed`; **not** a
prospect (check this first — it is the cheapest and the most common answer, because
almost everybody this function is asked about is an established pro); the league
reveals true ratings; scouting is disabled; or he is on the viewing roster and fog on
own roster is off.

Inside a full reveal, **still withhold another club's exact ceiling.** Return
`potential..potential` only for own roster, a Full Scout, or fog switched off
league-wide; otherwise return the flat ±5 band. Return a **range in the degenerate
case too** rather than a second return shape: the invariant every caller relies on is
that `potLow`/`potHigh` always exist, and it has been broken twice by code paths that
returned something else.

Expose **two** flags, not one, and branch every potential-rendering site on the
stricter one. `revealed` means the attributes and overall shown are true; it says
nothing about potential. `potentialRevealed` means `potLow === potHigh === his real
ceiling`. Using `revealed` where you mean `potentialRevealed` is what prints another
club's exact ceiling.

Inside a fogged view:

- Default confidence to `ROOKIE_BASE_CONFIDENCE = 8` when there is no report.
- Render an attribute an evaluation **locked** as a point, not a band — you sent
  people to measure it and now you know. Keep the locked keys in a JSON array on the
  report, and make the stored observation agree with the pinned value or the two
  disagree about the same number.
- Fall an attribute with no observation yet back to a blurred league-average read
  (68), never to the true value.
- Apply skill-tree multipliers to the **half-width after** `errorBand` has done its
  confidence/difficulty work, then floor it, so a range can never collapse to a point
  however many ranks are bought. §7.1 has the multipliers.
- Give potential its own confidence track: `max(confidence, report.potConfidence)`.
  Only a deep evaluation pushes it above the general read, which is what makes the
  deep tier worth its price.
- Add the difficulty-based user penalty from the league's difficulty setting to the
  band for the user's own view only.

Write confidence-tiered prose for the report note: ≥85 "complete book, very little
left to learn"; ≥65 "solid file, the ceiling is still an open question"; ≥40 "partial
evaluation, flashes on tape but the sample is thin"; ≥20 "early look only, treat
these numbers as a rough sketch"; below that "essentially unscouted, anything we say
right now is a guess".

**Allow exactly one hole in the fog**, `ScoutingReport.fullyRevealed`, written only by
the Full Scout ability (§4.5). For every other fogged player, at every confidence
level and every skill rank, return potential as a genuine range — the
`MIN_BAND_HALF_WIDTH` floor is what guarantees it.

### 4.4 Make the shortlist the only ongoing scouting input

Build no button and nothing to spend. Have the staff work the players the GM has
starred, every week, for free, forever. **Make the single decision "how many players
to star."**

Split a fixed weekly pool across the shortlist. Star five prospects and each gets a
fifth of everything the department can do; star sixty and learn a little about a lot.
Nothing is deducted, nothing runs out, and advancing a week without opening a screen
must never cost the GM anything — which is exactly what the focus-point economy this
replaces got wrong.

```
throughput = staffThroughput(scouts) × staffQuality(scouts) × dynastyThroughput(mods)
unitsEach  = shortlisted > 0 ? (WEEKLY_POOL / shortlisted) × throughput : 0
units(p)   = unitsEach × (specialtyCovers(p.position) ? SPECIALTY_BONUS : 1)
close      = clamp(units × CLOSE_PER_UNIT, 0, MAX_WEEKLY_CLOSE)
after      = before + (CONFIDENCE_CEILING − before) × close          # if below ceiling
potAfter   = potBefore + (POT_CONFIDENCE_CEILING − potBefore) × close × POT_CLOSE_SHARE
```

`WEEKLY_POOL 80`, `CLOSE_PER_UNIT 0.011`, `MAX_WEEKLY_CLOSE 0.25`,
`CONFIDENCE_CEILING 82`, `POT_CONFIDENCE_CEILING 62`, `POT_CLOSE_SHARE 0.55`,
`SPECIALTY_BONUS 1.12`.

Compute staff throughput as the scouts' `speed/100` sorted descending and summed with
a geometric discount `STAFF_HEADCOUNT_DECAY = 0.72` per additional scout — a fifth
area scout is real coverage but not a fifth of a department's worth — floored at
`STAFF_MIN = 0.55` for a club with no scouts at all, because the GM still watches
tape himself. Compute staff quality as a linear map of the **best** accuracy in the
building onto `STAFF_QUALITY_RANGE = [0.72, 1.32]`, and read 40 for an empty
department — the GM watches tape himself and is not very good at it.

Set `WEEKLY_POOL` so a **median** department lands on an effective pool of ~100,
which is what the table below is measured at. Across every club in the development
database the staff multiplier runs 0.57 to 2.28 (median 1.26), so a well-staffed
front office covers roughly four times the ground a poor one does — which is most of
what scout accuracy and speed are for now that the focus economy they used to feed is
gone.

Size `CLOSE_PER_UNIT` against a 17-week season, which is all the time there is: the
class lands at PRESEASON of the year before its draft and this only runs on
regular-season weeks. Confidence after 17 weeks from a cold 8, for a median
department:

| players starred | confidence reached |
|---|---|
| 5 | **81** — a near-complete file on all five |
| 10 | 72 — solid on everyone, ceilings still open |
| 20 | 54 — partial evaluations across the board |
| 40 | 36 — names and shapes |
| 60 | 28 — an early look, nothing more |

**That spread is the decision the system asks for.** Raising `CLOSE_PER_UNIT`
collapses it: at double, sixty players is as good as five and there is no longer a
reason to choose.

Keep two kinds of diminishing returns, both deliberate: (1) each pass closes a
**fraction of what is still unknown**, so week two on the same prospect teaches less
than week one did with no separate decay term — there is simply less left; (2) a hard
ceiling **below 100**, so a prospect starred from week one all season converges toward
82 and stops. He never becomes a certainty, because certainty is what a workout and
the Full Scout charge are for, and those are scarce on purpose. Cap potential's
ceiling lower still at 62: watching a player play does not tell you what he becomes
— that read is what a workout buys.

Cap any single week at `MAX_WEEKLY_CLOSE = 0.25` of the remaining gap whatever the
shortlist size. A one-week jump from unscouted to a real file reads as a bug.

**Compute the split once and apply it verbatim.** Build one `attentionPlan(scouts,
mods, shortlisted)` and have both the weekly pass and any screen quoting a per-player
share call it. Two implementations of the same division is the lying-metric shape this
codebase keeps having to fix. Quote `AttentionShare.units` — the even split times that
man's own specialty bonus — next to a player, never the raw split, because that is
the number that produced the confidence move on the same row. Quote `unitsEach`
where you are expressing the trade-off ("star more, learn less each").

Run the weekly pass **for the user's team only**. AI front offices draft off a read of
the public board (§5.4) and never consult a scouting report, so giving them reports
would cost a query per club per week and change nothing about a single pick they make.

Filter the shortlist to **draft prospects in this league** on both the write path and
the divisor. A star left on a player drafted last spring is a stale row, and letting
it hold a slice of the pool quietly taxes the user for never tidying his board.

Skip a report that is already `fullyRevealed`: a finished file cannot be improved and
a Full Scout must never be walked back by a passive tick.

**Re-sample the observation through the same `observe()` every other reveal path
uses**, seeded `shortlist-{seed}-{teamId}-{playerId}-{seasonYear}-{week}`, so the
centre drifts toward truth as the range tightens instead of a stale low-confidence
observation sitting under a high-confidence band. Skip the write entirely when
nothing rounded upward — a shortlist deep enough to round to zero still teaches
something eventually, but not this week. Make the pass idempotent enough to be safe
on a replayed week: closing a fraction of a gap that has already shrunk is worth less
than running it once, never more, and it can never push past the ceiling.

At the ceiling, **say what would move it**, because the generic tiered prose tops out
at "very little left to learn" and that would be a lie for a player attention alone
can never finish: "Our people have watched him all year. This is as much as tape and
phone calls can tell us — a private workout or a full evaluation is the only thing
left that would move it."

Toggle a star through one action that derives the club from the save and **ignores
any `teamId` on the wire**. It took a `teamId` and a `playerId` off the wire and
wrote the row, checking neither against the league the caller had just proved they
owned — so from a save he legitimately held a caller could shortlist a prospect for a
club in **somebody else's league**, measured, and that is not an inert row:
shortlisted men are worked every week for free, so it quietly rewrites another GM's
scouting book. Also require the player to be in this league (an id of the wrong shape
used to escape as a raw foreign-key throw), and make the pair idempotent with
`deleteMany` plus a `createMany ... skipDuplicates` — two clicks on a star both read
"not shortlisted" and both inserted, and the loser came back as an unhandled
unique-constraint rejection with an ORM stack in it. An `upsert` does **not** close
that: it is a read followed by an insert and both halves of a double click get past
the read.

### 4.5 Private workouts — the one scarce choice

Give the GM `WORKOUTS.BASE_SLOTS = 5` slots **per college class**, plus
`SLOTS_PER_NETWORK_RANK = 1` per rank of the Scouting Network skill. Treat
`BASE_SLOTS` as the single most dangerous number in the scouting design: at a dozen,
the draft stops being a bet. Five against a class of hundreds is enough to cover the
top of a board and nowhere near enough to cover a position group, so the question is
never "should I work somebody out" — it is "which four".

Budget the ledger **per class (`Player.draftYear`), not per league year.** A class is
generated in one league year and drafted in the next, so a per-year budget pays out
twice for the same four hundred men: five slots during the season and five **more**
after the turn of the year, which quietly ends the "which four" question the mechanic
exists to ask. Store `(workoutYear, workoutUsed)` and treat a counter stamped with
any other class as zero — that makes the ledger self-healing for saves that predate
it, with no reset hook required for correctness. Zero it where a class is minted (the
PRESEASON step) purely so the number on screen turns over with the new board instead
of on the first spend; make that idempotent.

**Gate the window on whether the draft has started, never on a phase whitelist.**

```
workoutsOpen(league, draft):
    if league.phase == 'FANTASY_DRAFT' -> false
    if league.phase != 'DRAFT'         -> true
    return !draft || !draftIsStarted(draft)
```

A class goes on the board in week one and is not selected until the following spring,
so the window is the **whole stretch the class is on the board**. The reference
implementation carried a whitelist of `['RESIGN', 'FREE_AGENCY']` on that line and it
was wrong in a way no number could fix: it shut the window for the entire regular
season and playoffs — the months the class is actually in front of the GM — and it
shut it in the war room, where the Start button was simultaneously telling the GM
there was "still time to fly somebody in". Bound it on the one event that really ends
it, the draft going on the clock, read off the draft's own state. Nothing about this
belongs in a constant. Exclude `FANTASY_DRAFT` because that pool is the league's own
veterans wearing `isDraftee` for the length of the draft — there is no class behind
it, and a private workout is for prospects.

Enforce every advertised rule in the action and re-derive it from the database, so a
client that lies about its remaining slots gets the same answer as one that does not:
the player must be in this league, the team must be in this league, he must be
`isDraftee` ("Private workouts are for draft prospects. Players already in the league
have tape."), the window must be open, a slot must remain, the file must not already
be `fullyRevealed` ("a workout would tell you nothing new"), and he must not already
have been worked out **this class** ("You already worked him out.").

What a workout buys:

```
floored      = max(before, CONFIDENCE_FLOOR 74)
confidence   = round(clamp(floored + (100 − floored) × CONFIDENCE_CLOSE 0.6,
                           0, CONFIDENCE_CAP 90))
potConfidence = max(existing, POT_CONFIDENCE 88)
```

Pick the attributes a facility can actually measure: those at or below
`MEASURABLE_DIFFICULTY = 0.25` — the stopwatch, the tape measure, the bar. Sort them
**easiest to measure first** so the cap trims the marginal ones rather than whichever
happened to be declared last. Cap the total locked share of a position's attributes
at `MAX_LOCKED_FRACTION = 0.6` counting anything already locked: if every attribute
locks, the displayed overall stops being a range. Set each measured attribute's
stored observation to the **exact** true value as well as locking it — that is the
whole promise of flying him in, and the renderer reads the locked list, so the two
must agree.

Set `devRevealed = true`: a day in the building is how a front office forms an
opinion on how hard somebody works, which is exactly what the dev trait is.

Set `POT_CONFIDENCE = 88` so the ceiling projection visibly collapses — at
`POTENTIAL_DIFFICULTY 0.95` the displayed half-width goes from ±24 cold, and ±8.5 on
a man starred all season, to ±4.6 here. **Never 100:** the band floor keeps potential
a range at any confidence and that is the contract.

Keep the two reveals distinct, and do not let them become two names for one button:

| | Full Scout | Private workout |
|---|---|---|
| what it is | omniscience — every attribute exact, potential exact, fog gone | a real event with real limits |
| who | anybody in the league: a veteran on another roster, a free agent, a prospect | prospects only |
| when | any phase | pre-draft only, while the class is on the board |
| how many | 2 a season (+1 per Scouting Network rank) | 5 a class (+1 per rank) |
| mental traits | exact | **still ranges** — a workout cannot settle instincts, decision making or awareness, and those are the traits that bust a pick |
| ceiling | exact | narrow, never a point |
| `fullyRevealed` | sets it | **never** sets it |

So Full Scout answers "what is he" and a workout answers "how high is the ceiling and
what is he like".

Seed the workout deterministically per `(league, team, player, classYear)` — not the
league year — so a man worked out in November and in March would draw the same
numbers. The window spans that boundary, and a seed that did not would make the date
of the visit worth something.

**Claim the slot before writing the report**, with a compare-and-set on the ledger
pair you read (`updateMany ... where { workoutYear: read, workoutUsed: read }`). Two
workouts requested at the same moment both read the same `used`, both decided a slot
was free, and both wrote the **same** number: measured against a five-slot allowance,
two prospects were flown in and `workoutUsed` came back **1**. Insert the ledger row
first with `createMany ... skipDuplicates` (one `INSERT ... ON CONFLICT DO NOTHING`)
so a save that has never opened the skills screen has a row to match against — and
**not** an upsert, twice over: its UPDATE branch would write the pair you *read* back
over the row, undoing a claim another request had just won, and its read-then-insert
shape can collide with a concurrent create instead of yielding to it. Tell the loser
plainly: "That slot was already being spent on somebody else. Reload the board to see
who went."

Apply the same claim pattern to the Full Scout and Insider charges. Without it, two
concurrent calls revealed two players on one charge.

### 4.6 Seed the opening scouting book

At league creation, and again every time a class is minted, write the user's club a
baseline report on every player. Without it every prospect's fogged view falls back
to the same flat "no observation yet" centre, which makes the draft board's overall
and potential sorts a **no-op** until someone is individually scouted.

Set the opening confidence by relationship:

| who | confidence |
|---|---|
| on the user's own roster | `OWN_ROSTER_CONFIDENCE 92` |
| a draft prospect | `ROOKIE_BASE_CONFIDENCE 8` |
| another club's veteran (experience > 0) | `clamp(normal(LEAGUE_VETERAN_CONFIDENCE 74, 8), 30, 95)` |
| anybody else | `ROOKIE_BASE_CONFIDENCE 8` |

Write **no rows for AI clubs.** They evaluate off a read of the public board, which
is a deliberate simplification rather than storing 60k+ report rows.

Set `DECAY_PER_SEASON = 0` — confidence does not decay on players you stop watching.
A ceiling below 100 on the attention path is what bounds a file, not decay.

### 4.7 Make re-scouting the same player cost something

**A reveal path must never be free to repeat.** Enforce it in three places and do not
rely on any one of them:

1. The workout ledger is stamped with the class and the report carries `workoutYear`,
   so a scarce slot cannot be spent twice on the same prospect — including across the
   turn of the league year, which is precisely why the stamp is the class and not the
   year.
2. Full Scout refuses a file that is already `fullyRevealed` ("Your file on him is
   already complete — that would waste a use") rather than silently burning a charge.
3. Shortlist attention closes a **fraction of the remaining gap** and converges to a
   ceiling below 100, so the second week on the same man is worth strictly less than
   the first, with no separate decay term, and the hundredth week is worth nothing.

The `ScoutingReport` schema also carries `passes` and `periodPasses` columns from an
earlier cost-escalation economy, intended to make hammering one prospect steadily
more expensive and steadily less informative. **That economy no longer exists** —
confidence now moves from exactly two places, shortlist attention and workouts — and
`SCOUTING.BASE_POINTS_PER_WEEK (100)` and `CONFIDENCE_PER_POINT (0.45)` are vestigial
with it. See §9: either drop the columns and the constants, or rebuild the escalation
on top of them, but do not ship them inert as the reference implementation does.

### 4.8 Store the report like this

One row per `(playerId, teamId)`:

| column | meaning |
|---|---|
| `confidence` | 0..100, general read |
| `observed` | JSON `{ attrKey: observedValue }`, plus the synthetic `_POTENTIAL` key |
| `scoutedOvr`, `ovrLow`, `ovrHigh` | cached for list views |
| `notes` | the scout's plain-language read |
| `potConfidence` | potential's own track; only a deep evaluation pushes it above `confidence` |
| `attrsRevealed` | JSON array of attribute keys locked to truth |
| `devRevealed` | true once a day in the building surfaced the hidden dev trait |
| `fullyRevealed` | **only** the Full Scout ability writes this |
| `revealedYear` | display only ("Fully evaluated, 2027"); never gates the reveal — a perfect evaluation you paid for does not expire |
| `workoutYear` | nullable; the **class** a workout was held in |
| `lastWeek`, `passes`, `periodPasses` | vestigial; see §4.7 and §9 |

Make `workoutYear` nullable: it is genuinely absent for every report predating
workouts, and a schema push cannot add a required column to a table that already has
rows. It does two real jobs — stopping a scarce slot being spent twice, and putting a
✓ beside a man already flown in — and it **does not** gate the reveal, which lives in
the confidence and `attrsRevealed` columns like every other one.

### 4.9 Label a player off the scouted view, gated on confidence

Build `playerLabel({ ovr, potential, isDraftee, experience, confidence })` on top of
the rating bands, and treat anyone who is a draftee or has zero experience as
**unproven**.

Grade an unproven man on **potential** — a rookie's present-day number means almost
nothing yet and the projected ceiling is the actual story — and a proven man on his
current overall, **except at the generational band**, where grade him on
`max(ovr, potential)` too. `grade = unproven ? potential : ovr` flat was jarring
exactly where it mattered most: a 99-potential man taken first overall read
"Generational" on draft night and then, the moment he had one season of experience,
read "Quality Starter" because he is 77 today. Nothing about him changed; the question
being asked did. Every other band stays exactly as it was, so a 90-potential man still
becomes what he actually is once he plays. And because potential is a live number that
**can fall**, a man who never delivers on a 99 loses the ceiling and loses the tag
with it, honestly and gradually, rather than keeping a title he has disproved — which
is why this rides on the ceiling and not on a flag.

Rename each band for an unproven player: Generational / **Franchise Prospect** /
**All-Star Prospect** / **Star Prospect** / **Day-One Starter** / **Rotational
Prospect** / **Late-Round Prospect** / **Deep Sleeper**, against Generational /
Superstar / Elite / Star / Quality Starter / Starter / Rotational / Depth for a proven
one. Use the **same boundaries** as the rating tier, so a tag and a colour can never
disagree.

**Gate the tag on confidence**, at the same HIGH/MEDIUM/LOW split the range readout
beside it uses, so a "Franchise Prospect" tag and a "Confidence: HIGH" readout never
disagree about how sure the read is:

- below `LABEL_CONFIDENCE_MEDIUM = 40` → **"Unevaluated"**. This label is
  potential-and-overall distilled into the single most legible signal in the game;
  handing it out free on an unscouted prospect makes the entire scouting system
  pointless, and below MEDIUM there simply is no book on the player yet.
- 40 to `LABEL_CONFIDENCE_HIGH = 75` → the tag with a trailing `?`, muted and
  italic. The read exists but has not converged.
- 75 and above → the tag plainly. A revealed view already reports confidence 100, so
  it clears HIGH automatically and needs no separate "revealed" flag here.

---

## 5. The draft

### 5.1 Give every prospect a free public grade

Charge nothing for the consensus board. Nobody should have to spend anything to learn
that the consensus number one pick is the consensus number one pick — that
information is free in every real front office (it is on television), and charging
for it only ever taxed the player for finding out what the room already knew. Give
every prospect a public grade and a public rank from the day the class is generated,
at no cost, **identical for every club**.

**Make the GM's edge knowing where the room is wrong, not having information.** That
only works if the room is wrong in **named, learnable** ways, so build the grade as

```
grade = CURRENT_WEIGHT × what the room thinks he IS
      + POTENTIAL_WEIGHT × what the room thinks he BECOMES
      + a set of NAMED BIASES, each driven by something public
      + a small amount of honest disagreement
```

with `CURRENT_WEIGHT 0.62`, `POTENTIAL_WEIGHT 0.38`. Boards are forward-looking but
not entirely: a polished 78 goes ahead of a raw 64 with the same ceiling, every year.

Export every bias as machine-readable data — `id`, `label`, `direction`, the signed
`delta` **actually added**, the public signal `because` it fired, and the `counter` a
disagreeing report would give — so a screen can say "the board is high on him because
he tested well" and a scouting report can disagree **with a reason** instead of a
shrug.

Set `NOISE_SD = 2.4`, and keep it **small relative to the bias magnitudes**. The whole
design rests on the board's error being learnable rather than random: if noise ever
grows past the biases, finding a steal becomes a coin flip instead of a read.

This module may read true ratings — an opinion has to be an opinion *about* something
— but it must **never return them and never narrow anybody's scouted range**. Keep
`buildScoutedView` the only thing that decides what the user may see, keep potential
coming back from there as a range, and write no `ScoutingReport` row from here. The
consensus is talk. It is allowed to be badly wrong, and on the prospects that matter
most it usually is.

Seed every draw **off the player id alone, never `Math.random`**, so the same prospect
grades identically on every render, in every process, for the whole life of the save.
Give each draw its **own named stream** (`consensus-regime-{id}`,
`consensus-medical-{id}`, `consensus-noise-{id}`) so adding a fifth bias later cannot
reshuffle the four already in players' saves.

### 5.2 Grade a READ, not a player

Do **not** compute the grade from `trueOvr` and `potential` directly. That is what the
reference implementation did first, and it made the board very nearly a lookup table
for the answer. Measured over 200 generated classes — 80,000 prospects, career peaks
rolled through the game's own progression:

| | |
|---|---|
| Spearman(board rank, career peak) | **−0.815** |
| consensus 1.01 who never became a starter | **0 of 200** |
| worst 1.01 in 200 classes | peaked at 83 |
| a top-5 prospect peaking below a day-three one | 0.7% of pairs |
| a Superstar (peak 95+) found in round four | once every 100 drafts |

A fog you can beat by sorting one column is not a fog. Since scouting is confined to
draft prospects, this board is the **only** place left in the game where the user does
not know what he is looking at, so "the board is sometimes wrong" has to be
load-bearing rather than decorative. *"We took a flyer in the fifth and he became the
best player on the team"* is one of the best stories this genre has, and it could not
happen, because the fifth-rounder was fifth for a reason the game had already checked.

So derive two private numbers from the truth, neither equal to it:

```
NOW      what the tape says he is today. Wrong by a few points, either way.
CEILING  what the room projects. Wrong by much more, and wrong in a direction:
         a room with no crystal ball projects off the player it can see plus a
         standard allowance for being 22.
```

**Feed the error in at the inputs, not as a bigger noise term on the finished grade.**
Noise on the output moves everyone a little and models nothing. The real failure is
that evaluating a college player and projecting a 22-year-old are two different hard
problems that fail **independently** — a man can be read right and projected wrong,
which is the most common way a first-round pick goes bad. Feeding it in at the inputs
also fixes something quietly wrong: the biases then apply to the number the room
**believes**. "Called a project" is measured against the gap the room thinks it sees,
and the stopwatch bias against the ability the room thinks he has. Before, both read
the truth — and a room that already knows the answer and marks it down is not biased,
it is discounting.

**Model three regimes, not one bell curve.** A single Gaussian spreads the board
evenly and still cannot produce the two events this mechanic exists for: the
fifth-rounder who is genuinely a star, and the first pick who cannot play. Both live
in the tail, so model the tail rather than leaving it to a wide sd that would also
blur every ordinary prospect into mush.

| regime | odds | error multiplier | the story |
|---|---|---|---|
| READ | the rest | ×1 (`EVAL_SD 7`, `CEILING_SD 7`) | the room is a few points off |
| MISFILED | `MISFILE_ODDS 0.16` | `MISFILE_MULT 3.0` (sd 21) | the room has him wrong — the man playing behind an All-American, the scheme that hid him, the two bad games everybody happened to watch |
| BLIND | `BLINDSPOT_ODDS 0.05` | `BLINDSPOT_MULT 4.0` (sd 28) | nobody got a real look — one tape, a small school, an injury year. The room is guessing and does not know it is guessing |

Scale **both** errors by the regime together, so a misfiled prospect is misfiled as
one story rather than as two independent dice. Bound the blind multiplier at 4.0: sd
28 is about the full width of the range a prospect is generated across, which is the
honest meaning of "the room's opinion of him is worth no more than a name pulled out
of the class at random". An earlier pass ran it at 5.5 and produced reads thirty-six
points off, which is not "nobody scouted him", it is a random number generator wearing
a scouting report.

Keep `EVAL_SD` **tight** in the ordinary case on purpose, because the variance that
makes this work belongs in the two named tails rather than smeared over everybody: a
flat wide sd blurs the whole board equally, leaves it uninformative in the middle, and
still will not produce the fifth-rounder who is genuinely a star, because that event
lives four sd out. Pooled over all three regimes and after exposure scales it, the
room's read lands within 10 points on **83%** of a class and within 20 on **95%**,
with a median miss of **4.2** — and the **3%** it misses by more than 25 is the whole
mechanic. On men rated 86 and better the median miss is 3.2, which is exposure doing
its job and not a second constant.

Project the ceiling as

```
CEILING_ANCHOR = GENERATION.ROOKIE_POTENTIAL_BONUS_MEAN      # read it, do not copy it
trust          = lerp(CEILING_TRUST 0.35, CEILING_TRUST_WATCHED 0.95, exposure)
room.ceiling   = bend(room.now + CEILING_ANCHOR + trust × (real headroom) + error,
                      CEILING_READ_KNEE 93, 99)
```

**Read the anchor off the generator's own constant; do not copy the number.** It was a
literal 14 with a comment saying it was deliberately equal to the generator's figure;
the generator's figure then moved twice and this did not, so the room spent two
changes adding **nine points of headroom no rookie in the game had** to every prospect
on the board, while the comment describing the policy was the only place the policy
still existed.

Make ceiling trust a **range, not a flat number**. 0.35 flat was measured as a weak
lever and it was one — sweeping it across its entire range moved Spearman(board rank,
career peak) by **0.025** — precisely *because* it was flat: a number applied equally
to four hundred names cannot separate any of them.

Bend the perceived ceiling at `CEILING_READ_KNEE = 93` rather than chopping it at 99.
**37%** of the men rated 88 and better used to come back with a perceived ceiling of
exactly 99 — the one term in the grade that is supposed to separate the top of a class,
not separating precisely there.

### 5.3 Scale the read by exposure, then by scrutiny

**Exposure — the room has not watched everybody the same amount.**

```
exposure = 1 / (1 + exp(−(trueOvr − EXPOSURE_MID) / EXPOSURE_WIDTH))
# EXPOSURE_MID 84, EXPOSURE_WIDTH 5
```

Applying one error to every name in the class is the one part of "the room is wrong"
that is not football. A room is wrong about the redshirt sophomore at a directional
school; it is not wrong in the same way about the man who has started thirty-nine
games on national television, tested in front of every club, and been argued about on
a set every Saturday for three years. Applied flat, the MISFILED and BLIND tails —
"nobody got a real look" — landed on the consensus best player in the country **one
time in five**.

Make it a **logistic in his real ability**, because that is what gets a player
watched: the good ones play at the programmes that are on television, in the all-star
games, at the top of every position board. Smooth, reaching neither end — the most
scouted prospect alive still carries error and the most obscure one is still
occasionally seen clearly. No wall, a curve.

Have exposure do two things, which are the same thing: read a watched man more tightly
(`EXPOSURE_ERROR_RELIEF 0.45` of the ordinary error, `EXPOSURE_TAIL_RELIEF 0.85` of
the two tails' odds) and understand his upside better (trust rises toward 0.95). You
cannot miss on a player you have seen a hundred times, in either direction.

Keep the relief factors **fractions, not switches** — a blue chip can still be
misfiled, just at the rate a blue chip actually is. And know what exposure
deliberately does *not* do: it is 0.01 on a 62-overall, 0.07 on a 71, 0.31 on an 80
and 0.77 on a 90, so it is near nothing over most of a class and the fog across the
middle and back of the board barely moves.

**Damp the UPWARD half of the error on men nobody watched**
(`UNSEEN_UPSIDE = 0.6`), and leave the downward half exactly as wide. Both named tails
are stories about a man being **undersold** — the one playing behind an All-American,
the scheme that hid him, the small school, the injury year. Run symmetrically they
also say the opposite: that a room which never watched a man can be certain he is the
best player in the country. Measured over 150 classes, that is not a rare accident but
the ordinary case — **47% of consensus number ones were MISFILED or BLIND reads**
against a 21% class-wide rate, and the median board #1 was an **80 overall in classes
whose best men rate 88**. The extreme of a fat-tailed error over four hundred names is
the fat tail, every single time. Keep the downside untouched: that half is where the
late-round steal comes from.

What exposure costs, measured, because it is not free. Over 250 classes it takes a
Generational prospect's median board rank from 24 to 15, his share of top-five slots
from 14.8% to 22.7%, his share of first rounds from 60.4% to 75.7%, and the share of
drafts whose consensus #1 is Generational from 5.6% to 10.4%. Over 40 classes rolled
through progression it takes Spearman(board rank, career peak) from −0.670 to −0.722,
and it thins the seventh round's Star-or-better count from 1.55 a draft to 1.12. The
board is a better board and the late rounds are a little quieter for it; that trade is
why the relief factors are fractions and not 1, and it is the number to watch if
anyone pushes them further.

**Scrutiny — what happens to a man BECAUSE the room has an opinion.**

```
provisional = gradeOnce(prospect, scrutiny = 0)
scrutiny    = 1 / (1 + exp(−(provisional.footballGrade − SCRUTINY_KNEE) / SCRUTINY_WIDTH))
final       = scrutiny < 1e-3 ? provisional : gradeOnce(prospect, scrutiny)
# SCRUTINY_KNEE 88, SCRUTINY_WIDTH 4, SCRUTINY_RELIEF 0.95
```

The consensus number one is the most scrutinised player in football: every club sends
its area scout, then its coordinator, then its general manager; he is dissected on
television for four months; a workout warrior with nothing behind him gets found out
well before draft day, because the whole industry goes looking. That is not true of
the man the board has 140th, and it is exactly why a sleeper misjudged in the fifth
round is football and a nobody crowned first overall is not. Measured over 600 classes
on the shipped board **before** this: the board's number one carried a sub-Star ceiling
in **24.2%** of drafts, and the worst one seen was a **57 overall with a 58 ceiling,
graded 94**. The centre of the board was healthy — median #1 was an 83 overall with a
90 ceiling — so this is a tail, and the tail is the part a user actually looks at.

**Grade twice, because scrutiny follows the board and the board follows the grade.**
It is two evaluations of a pure function, not a fixed point: the second pass never
feeds a third, so there is nothing to converge and nothing to oscillate. Skip the
second pass entirely below the knee, which is most of any class.

**Narrow only the room's MISS — the width of its error about what a man is today — and
nothing else.** Do not touch `CEILING_SD` and do not touch ceiling trust, so nobody's
crystal ball gets better for being looked at: the room can still be certain what a
prospect *is* and badly wrong about what he *becomes*, which is the ordinary way a
first pick goes bad and the reason the 1.01 still busts. Do not touch the bias stack
either — a blue chip still slides on a medical flag, which happens every real April.

What scrutiny bought, over 600 classes for the board numbers and 40 rolled through
progression for the rest:

| | before | after |
|---|---|---|
| board #1 with a sub-Star ceiling | 24.2% | **2.8%** |
| board #1 with a sub-Day-One ceiling | 7.5% | 0.3% |
| worst board #1 seen | 57 ovr / 58 pot | 72 ovr / 77 pot |
| board #1 rated below his class mean | 2.7% | 0.0% |
| board #1 rating, median / min | 83 / 53 | 87 / 69 |
| board #1 ceiling, median / min | 90 / 58 | 95 / 77 |
| ceiling gap, class best minus #1 | mean 9.7 / max 41 | mean 4.9 / max 22 |
| a Generational prospect goes #1 | 5.6% | **22.0%** |
| ... in the top five | 14.8% | 34.5% |
| ... in the first round | 60.4% | 81.7% |

It costs a better ordering at the very top of the board, which is a real cost against
a fog this exists to protect, so **aim it as narrowly as you can**: put the knee above
the 98th percentile of the grade distribution so the middle and back of the board —
where the fifth-round steal lives — do not move at all. The rails held:
Spearman(board rank, career peak) −0.692 → −0.688 against the −0.815 lookup-table
state, and somebody outside the top 96 still out-peaks the consensus 1.01 in 45% of
drafts.

**Land this only after busts have a home in development.** Before the development arc
existed, every bust in the game *was* this defect — the 1.01 "busted" 10% of the time
purely because the board sometimes crowned a man who could not play — so cleaning the
top of the board deleted busts along with the frauds. Development must fail players on
its own (rating spec §7c) so the first pick can be wrong for a football reason.

### 5.4 The five named biases, and what the board over- and under-values

Add each to the grade, and name it to the user once its pull clears
`BIAS_REPORT_THRESHOLD = 2` (below that it is rounding).

**1. The stopwatch.** `delta = TESTING_PULL × (roomStopwatchRead − perceivedAbility)`,
with `TESTING_PULL = 6` and `perceivedAbility = clamp((room.now − 40) / 55, 0, 1)`.
Push `TESTING_DARLING` when positive, `TESTING_FADED` when negative — their direction
is structural, from the branch they are pushed in, so they need no sign check.

Make the pull the **gap** between how a prospect tested and how good the room thinks
he is, not his raw testing. That is precisely what makes the workout-warrior and
bad-tester archetypes matter: the warrior's numbers are public and genuinely lift him
even though the tape never saw it coming, and the good player who ran a 4.8 gets
marked down by a room that never watched him play.

It was 9, and at 9 **the board had already spent the stopwatch** — the pull is added
straight onto the grade, so whatever testing knows about a man the board knows too,
and a GM reading the Athletic column was reading a column the Board column two places
away had already told him. Measured over 20 classes inside a position group, the
athletic rank added rho **−0.21** on top of board rank at 9 and **−0.36** at 6. Bring
it down rather than to zero, because the room's over-reaction to testing **is** the
workout-warrior trap: `TESTING_DARLING` still fires on **29.5%** of a class and
`TESTING_FADED` on **8.0%** (38.7% / 10.6% at 9), so the man who ran a 4.38 and cannot
play still gets pushed up a board somebody has to be disciplined enough not to follow.

**Read testing two different ways, and keep them different.** The public Athletic
column weights the whole workout by what each drill is worth at that position (§6).
What moves a **grade** is the room's forty-first skim of it:

```
roomStopwatchRead(position, testing) = testingAthleticism(position, testing, {
    fortyYard: FORTY_FIXATION,                    # 0.75
    vertical:  (1 − FORTY_FIXATION) / 5,          # the other five split the rest
    broadJump: ..., threeCone: ..., shuttle: ..., benchReps: ...
})
```

**Keep `FORTY_FIXATION` global — not per position — and that is the whole mechanic.**
A bias that adjusted itself sensibly by position would not be one. Every room in the
league quotes the forty for everybody, including the positions where it means nothing.
The gap between the two reads is the point: a room grades the number it quotes, and
what it quotes is the forty — which, on average across positions, is the drill
carrying the **least** of a man's actual ability. So the drills that do carry ability
go **unpriced by the board**, and a front office that reads the whole workout is
looking at something the consensus never charged for. It is also simply what draft
rooms do: the forty is read out on television and the three-cone is read by the
position coach.

Where it goes furthest wrong is where the bargain is. Because the room pays for the
forty everywhere and the forty only predicts anything at some positions, the men the
board underpays hardest are those who ran slow at a position where speed is nearly
irrelevant and tested superbly in the drills that position actually needs — the 290lb
tackle who ran 5.29 and finished first in his group in both the three-cone and the
shuttle. Under a flat composite that man read as an average tester, because his worst
drill counted like his best.

**2. Where he played.** `PROGRAM_PULL = { A: +4, B: +1.2, C: 0, D: −1.2, F: −4 }` →
`BLUE_BLOOD` or `SMALL_SCHOOL`. Take production against A-tier competition at face
value and discount the same production against F-tier **past the point of fairness**,
which is where small-school steals come from. Only the two extremes move the grade
enough to be worth naming: B and D are where most of a class plays and the room has
no strong feeling about either.

**3. Ready now over ready later.** When the **perceived** gap
`room.ceiling − room.now` exceeds `DEVELOPMENTAL_GAP_MIN = 16`, apply
`delta = −DEVELOPMENTAL_PULL × clamp((gap − 16) / 20, 0, 1)` with
`DEVELOPMENTAL_PULL = 6` → `DEVELOPMENTAL_DISCOUNT`. A board is a ranking of players
teams have to justify to an owner in April, and a raw prospect with a huge ceiling is
the hardest thing to defend in that room, so he slides even when the ceiling is real.
Set the gap threshold **above the class median gap** on purpose: nearly every prospect
has *some* room to grow, and a tag that lands on half the board tells the user
nothing. Measure the gap against what the **room** sees — "he is unfinished" is a
statement about what the room sees, and the room does not see a real ceiling.

**4. The medical.** Flag him when `injuryWeeks > 0`, or on a seeded roll at

```
flagOdds = clamp(MEDICAL_BASE_ODDS + (70 − durability) / 300,
                 MEDICAL_MIN_ODDS, MEDICAL_MAX_ODDS)
# 0.06, 0.03, 0.30
```

Then subtract a **flat** `MEDICAL_PULL = 6.5` → `MEDICAL_DISCOUNT`. Apply the same
flat markdown to every flagged player whatever the actual prognosis — that is what a
board does — and correlate the flag with true durability **without** tying it tightly,
because the exploitable case is the flagged prospect whose shoulder is genuinely fine
and it has to come up often enough to be worth scouting for. Surface the flag itself
separately from the grade: the flag is news even before the grade moves.

**5. What the position is worth.** Compute
`positionPull = POSITION_PULL × (DRAFT_POSITION_VALUE[position] − 1)` with
`POSITION_PULL = 8` and

```
QB 1.5  EDGE 1.25  LT 1.2   WR 1.15  CB 1.15
DT 1.05 S 1.0      LB 1.0   TE 1.0   RB 0.9
RT 0.9  RG 0.85    LG 0.85  C 0.8    K 0.35  P 0.3
```

**Keep it out of the grade.** The room's grade is a football opinion; where a player
comes off the board is that opinion **plus** what the position is worth in April, and
a front office keeps two different columns for those. Splitting them is what lets a
page say "same grade as the quarterback, twenty picks later" — the most exploitable
thing on the whole board. It is the room's fifth bias and its most exploitable one:
nothing stops a GM taking the guard.

**Classify each bias UP or DOWN and check the four constant-driven directions against
their constants at module load.** To a GM those are not one list: a **discount** is
where a steal comes from — the room has taken points off a man for something public,
and if the tape disagrees you can have him later than he should go — while a
**premium** is where a bust comes from, because the grade in front of you is inflated
and you are being asked to pay for a stopwatch. Order the exported list reading-order:
discounts first, heaviest-handed first, so a filter bar built off it puts the biggest
markdown at the left. Fail the import if a declared direction and its constant's sign
disagree, so flipping a sign cannot leave a screen filing "Medical flag" under the men
the room reaches for.

Have screens **read that exported list** rather than keeping a second copy of which
bias is which. A second copy is exactly how a markdown ends up filed under a premium.

**Bend the finished grade at both ends; do not clamp it.**
`bendToFloor(bendToCeiling(base + delta + noise, GRADE_SOFT_KNEE_HI 96, 99),
GRADE_SOFT_KNEE_LO 28, 20)`. `clamp(..., 20, 99)` used to close this file and it was
the most expensive wall of the lot, because everything this board is **for** happens
at the top of it: measured over 120 classes, **639 prospects came back graded exactly
99 against 248 at 98** — five and a third men a class tied at the very top of the
board, separated by nothing but positional value, in a draft whose whole question is
who goes first. The bottom did the same on a smaller scale, 90 men on exactly 20
against 26 on 21. Keep the knee **high**: the bend squeezes everything above it into
the points that are left, so a low knee buys a flat histogram by flattening the very
discrimination this protects.

### 5.5 Rank the board, and decay positional reach down a position group

Rank by `boardScore = unrounded grade + positionPull`, and **return `boardScore` on
every row**: nothing may sort by a number the caller cannot see. Two prospects showing
the same rounded grade can sit a dozen slots apart, so put the reason on the row
itself ("The board pushes him up regardless of grade — QB is a position teams reach
for"). Break an exact tie on player id, purely so the order is stable across
processes; float ties are vanishingly rare and this is determinism insurance, not a
ranking rule.

Make grades **set-independent** — passing a filtered list (one position, the
shortlist) still returns each prospect's real grade — but make the **rank** a rank
within the list you were handed. So **pass the whole class, drafted prospects
included**, whenever the number has to read as "the consensus #4 prospect". A rank
that changes because somebody else came off the board is a lie.

**Turn positional value into scarcity, not a per-position bonus.** The pure function
gives every player at a position the same pull because it sees one player at a time.
Applied flat, a +4.0 quarterback bonus put **six quarterbacks in the top ten** of a
measured class and **eight in the top thirty-two** — a first round with eight
quarterbacks in it, every single year, forever. That is not how a board works:
positional value is about scarcity at the top, and teams reach for the best
quarterback in a class, not for the fifth one.

So, in a second pass over the graded class:

- Group by position and rank **within** the position on the football grade alone — the
  pull is what you are about to compute, so it cannot be an input to itself.
- Decay a **positive** pull by `decay = 1 / (1 + i / SCARCITY_HALF_LIFE)` with
  `SCARCITY_HALF_LIFE = 2`: QB1 keeps the full reach, QB3 half of it, QB7 a quarter.
- Do **not** decay a negative pull. A punter is not a high pick however good the
  punter is, which is the whole point of the number being negative; a measured class
  had a punter at board #49.
- **Amplify** a negative pull by `CHEAP_POSITION_MULT = 2.6`. The plain penalty left a
  **99-grade kicker at board #28** — a first-round kicker, which no room has ever
  produced, and specialist positions are exactly where a flat points-per-grade board
  goes wrong.
- Scale each position's reach by a per-class **mood**,
  `1 + normal(0, CLASS_MOOD_SD 0.45)`, seeded off the class so it is stable for a
  given save. Real drafts differ: some years three quarterbacks go in the first ten
  picks and some years none are worth taking, and the GM has to read which one he is
  in.

Label bands by **pick number**, derived from the league's actual draft shape
(`teams × rounds`) rather than hard-coded, so a league running four rounds does not
label a hundred players Day 3:

| band | runs through pick | blurb |
|---|---|---|
| `BLUE_CHIP` | `max(3, round(teams × 0.16))` | Top of the board. The room does not expect him to get past the first handful of picks. |
| `FIRST_ROUND` | `teams` | A consensus first rounder. |
| `DAY_TWO` | `min(draftSize, teams × 3)` | Second or third round on most boards. |
| `DAY_THREE` | `draftSize` | A rotational bet in the middle rounds. |
| `LATE_FLIER` | `round(draftSize × 1.35)` | Last-day name. Special teams and a roster spot to win. |
| `PRIORITY_FA` | beyond | Expected to go undrafted. Somebody signs him after the phones stop. |

Write one plain-language headline per row off the band and the strongest bias ("Day 2
grade. The board is down on him: he tested badly for the position and the board moved
him down for it.").

### 5.6 Let the club's own board disagree, with a reason

Express the user's own read on the **consensus's scale** before subtracting anything:

```
ownGrade = round(CURRENT_WEIGHT × view.scoutedOvr
                 + POTENTIAL_WEIGHT × (view.potLow + view.potHigh) / 2)
```

This matters more than it looks. A consensus grade blends current and ceiling; a
scouted overall is current only, and every prospect's ceiling is above his current
rating — so comparing the two raw reports the user as "below the consensus" on
**literally every player in the class**, a difference that is an artefact of the two
numbers measuring different things. Use the midpoint of his own **scouted** potential
range, never a true potential.

Say nothing when his confidence is under 25: under a near-empty file there is nothing
to disagree *with*, and quoting a gap off one would be inventing an opinion the staff
does not have. Say nothing when the gap is under 4 points. Otherwise lead with the
gap and attach the **counter** of the strongest bias pulling the opposite way: "Our
file has him 6 points above the consensus. Nobody he lined up against is the reason he
wins. The traits travel."

Also write a confidence-gated buzz note that teases the gap between the truth and the
scouted number without ever stating a rating — only above confidence 25, and keyed on
both the gap and the competition grade:

| condition | note |
|---|---|
| gap ≥ +10 and grade A/B | "Produced against real competition — some evaluators think this grade is light." |
| gap ≥ +10 | "A few scouts are quietly higher on him than the consensus grade suggests." |
| gap ≤ −10 and grade D/F | "Gaudy numbers, soft competition — buyer beware translating this to Sundays." |
| gap ≤ −10 | "Tape doesn't match the box score for some evaluators." |
| potential ≥ 92 and confidence < 55 | "Ceiling nobody has fully seen yet." |

### 5.7 Seed the draft order on playoff finish first, record second

Order the board from the bottom with **one function**, used both to reseed the order
for real and to project it:

```
sort by: playoffExitRank asc,            # MISSED < WILDCARD < DIVISIONAL
                                         # < CONFERENCE < RUNNER_UP < CHAMPION
         then win pct asc,
         then point differential asc
```

Record alone used to be the whole rule and it produced exactly the complaint it
deserved: *"i was knocked out in the first round yet got pick #32. it shouldn't
operate that way."* He was right. **Pick 32 belongs to the club that won the title**,
and the 15-2 side that lost its wild-card game belongs at the top of the playoff
block, not at the bottom of the board. A club's record decides where it sits *inside*
its group and nothing more, which is why the best record in football can pick 19th and
why the 8-9 club that snuck in cannot pick 3rd.

**Hard-code no group size.** The standard bracket happens to hand out 6/4/2/1/1, but
league size and playoff format are settings, so let the groups be whatever the stored
playoff results actually say. Keep it a **single sort over a single array**: a sort of
N clubs is N clubs, so ranking by position in the result gives 1..N with every slot
used exactly once and none used twice, whatever the groups look like. Read an unknown
or missing result as `MISSED` — the column's own default, and the only honest reading
of "nothing on file says this club played a playoff game".

**Read the standings from the season record table, not from the live team row.** The
offseason zeroes `Team.wins/losses/pointsFor/pointsAgainst` several advances *before*
the order is seeded (this runs at the end of free agency, on the way to the draft), so
by then every club was 0-0-0 with a zero differential, every comparison returned 0,
and the sort left the clubs in whatever order the database handed back — effectively
creation order. Measured on five saves before the fix, **pick #1 went to the worst
club in none of them**; the owner, handed the top selection, put it plainly: *"im not
sure how i got #1 overall."* He got it because his row came back first. The season
record is written before the wipe and still says what actually happened. Note the
year offset: the draft for year N follows the season played in year N−1, because the
season-year bump lives in the same offseason step as the wipe.

**Require every club to have a record, or fall back wholesale.** A league's very first
draft can precede any completed season and a fantasy-start league may have no record
at all; with nothing on file, hand in the live team rows, which carry no playoff
result — every club then reads `MISSED`, the sort collapses to worst-record-first, and
a first draft still comes out a complete 1..N with nothing shared and nothing missing.
Do not mix: comparing a real record against a wiped row is the same bug wearing a
smaller hat.

**Write all slots in one transaction, and abort the whole year if any club cannot be
ranked.** A half-finished reseed is the one state in which a pick can be charged
another pick's salary. It was a bare loop of 224 awaited updates, so any interruption
partway — a restart, a request abort, a step further up the advance throwing —
committed the rows it had reached and left the rest on their generation-time
placeholders. The two sets then **collide**, because a placeholder and a standings rank
are both drawn from 1..32. Found in the development database: one save sitting in
exactly that state, **25 of its 32 round-one picks reseeded, 7 still on placeholders,
six slots held by two picks each and six slots held by none.** What that costs is the
whole point: the clock resolves a pick with `findFirst` on `(round, slot)`, so of two
picks sharing slot 26 one comes up and is paid the slot-26 price and the other never
comes up at all — six clubs never make a selection, six rookie contracts are never
written, and the draft ends six men short with nothing on any screen saying why. Use
the **array** form of the transaction, not the interactive one: one batched round trip
with no interactive timeout to run out of on 224 rows, and `(leagueId, year, round,
slot)` is an index rather than a unique constraint so intermediate states inside the
batch cannot trip anything. And **throw** rather than skipping an unrankable pick:
there is no useful half-order, leaving the year entirely on placeholders is honest
(every pick then wears a consistent placeholder and the collision cannot happen), and
the advance that called it should say so rather than handing the draft a board it
cannot run.

Expose the same rule as a **pure** function (`draftSlotAmong(teamId, teams)`) for the
week report's "what it changed" band, which is already holding the standings from both
sides of the week it is describing and wants the delta. A live projection can only
answer for "now", and a second database read cannot recover a snapshot the caller
already has in hand.

**Say where a projected number came from.** Return the season the ranking was taken
from and whether that season is still being played, and never present a projected
selection number as a real one. A projection must be built off the season that will
actually seed that draft.

### 5.8 Pick slots, pick values, and trading picks

Store a pick as `(leagueId, year, round, slot, originalTeamId, ownerTeamId, used,
playerId?)`. Keep `originalTeamId` pointing at the club whose pick it was: that is
what makes a traded-away pick read as **your** forfeited first-rounder on the screen
rather than an anonymous extra pick of somebody else's, and it is what the pick's
projected slot is computed from.

`overallPickNumber = (round − 1) × TEAM_COUNT + slot`.

**Value picks off the real Jimmy Johnson chart, transcribed as a literal table, not
approximated by a curve.** It is the chart front offices have actually traded off
since the early nineties and it runs to exactly 224 picks — which is exactly this
league (32 × 7) — so the pick axis maps one-to-one with no rescaling at all. Its
numbers **are** this game's value units: everything a trade weighs, players and picks
alike, is quoted in chart points, so every valuation in the game becomes a sentence a
football person can check — "this man is worth 420" means "this man is worth pick 48".
Round one runs 3000, 2600, 2200, 1800, 1700, 1600, 1500, 1400, 1350, 1300, 1250, 1200,
1150, 1100, 1050, 1000, 950, 900, 875, 850, 800, 780, 760, 740, 720, 700, 680, 660,
640, 620, 600, 590; round two 580 down to 270; round three 265 down; and so on to the
last pick.

Bend only the climb of round one onto the player curve:

```
PICK_VALUE_CHART(overallPick):
    raw = JIMMY_JOHNSON[clamp(round(overallPick), 1, 224)]
    if raw <= PICK_SCALE.KNEE (600): return raw
    span = TRADE_VALUE.TIER_CURVE.PREMIUM.ceiling − KNEE
    return KNEE + span × (1 − exp(−(raw − KNEE) / span))
```

Put the knee at **600 chart points, which is the 31st pick** — the highest knee at
which the measured player-to-pick ratio is still flat (picks 28–32 read 0.98–1.04), so
you are not inventing a defect to fix in a region that is already calibrated. Read the
asymptote **off the tier table** so the two cannot drift apart, and approach it rather
than stacking on it. The table itself stays untouched; what you are stating is that
above pick 31 it stops being the price a *man* costs, because the table's steepest
stretch is a pick-for-pick auction price and no player trade has ever validated it.

Generate **three tradeable future years** after each draft consumes one (four at
league creation, §1.8). Let picks trade like any other asset through Part 3's trade
machinery, and keep the live `(round, slot)` ownership query as the **only** source of
who is on the clock — see §5.9.

### 5.9 Resolve the clock from live pick ownership, every pick

```
round = floor(pickIndex / TEAM_COUNT) + 1
slot  = (pickIndex % TEAM_COUNT) + 1
pick  = DraftPick.findFirst({ leagueId, year: league.seasonYear, round, slot })
onClock = pick.ownerTeamId
```

**Do not precompute a turn-order array at draft start.** That array was always built
from round one's pick ownership and then reused verbatim for every later round, so it
silently ignored any trade involving a round-2+ pick: the club that traded that pick
away still got a turn — and, owning no unused pick that round, **drafted the player
for free, no contract, no pick consumed** — while the club that acquired it never got
an extra turn to use it. Querying the actual row for this exact `(round, slot)` is both
simpler and correct for every round, since every round's slots are reseeded from
standings, not just round one's.

For a fantasy draft there are no pick rows: read the team on the clock out of the
stored snake order at `pickIndex % order.length`.

Gate the clock on an explicit start flag, and read it through **one** predicate:

```
draftIsStarted(state) = state.kind !== 'ROOKIE' || state.started
```

Create the rookie draft state with `started: false` the moment the last week of free
agency is advanced past — that sets the board, not the clock. The rookie draft arrives
as a **side effect of advancing a week**: free agency closes, the phase flips, and the
board was already burning picks by the time the owner opened the page. *"It autostarted
without me knowing."* So let the clock move only when the GM presses the button. Make a
**fantasy draft always live**: it exists because the user ticked the box one screen
earlier, it is the only thing that happens in its phase, and there is no season around
it to be surprised by — asking him to confirm the thing he just asked for is a door
with nothing behind it.

Enforce the gate **where every pick in the game passes through**, not only in the UI
that hides the button: one line in `draftPlayer` covers both the user's selection and
the AI's.

### 5.10 Make AI clubs draft off a read, not the truth

Do **not** pull the top prospects `orderBy: { trueOvr: 'desc' }` and value them with a
function that reads `trueOvr`/`potential` off the row. That is thirty-one omniscient
front offices. It was survivable while the public board was near-perfect and stopped
being survivable the day the board became a fallible read on purpose — two
individually sound changes, jointly incoherent: the user was shown a board that
predicted nothing about the order players actually came off it. From one real draft,
round one: **board #242 at pick 3, #195 at 7, #85 at 10, #70 at 12 — and board #1
lasting until pick 9.** A consensus board that predicts nothing is not a board.

Build three parts, and know the first is most of the fix:

**The window.** Draw the candidate set as the top `DRAFT_BOARD_WINDOW = 64` names
still on the **public board**, sorted by `boardScore`, before this club has an
opinion. A perfectly fogged valuation applied to a truth-sorted shortlist still drafts
the truth, because the shortlist already did the cheating.

Treat the window as the single number that decides how unrealistic the draft can get:
it is a hard ceiling on a reach, so nobody can be taken more than this many names
below the best man left. Two rounds' worth is what a front office actually has "in
play". Swept, 40 classes each, reading round-one `|board rank − pick|` as
median/p90/max, the deepest board rank round one took, and names sliding 50+ places
per draft:

| window | R1 median/p90/max | deepest R1 | 50+ slides |
|---|---|---|---|
| 24 | 8/20/26 | #55 | 2.9 — the board as a script |
| 32 | 9/24/31 | #62 | 4.2 |
| **64** | 9/30/63 | **#91** | **7.4** |
| 96 | 9/31/91 | #118 | 8.2 |
| 128 | 9/31/91 | #118 | 8.4 — saturated |

It saturates above ~96 because the valuation stops reaching that far on its own, so
the real choice is "tight" versus "loose". 64 keeps round one honest (10–30 place
reaches routine, worst case around #90) while leaving a genuine sleeper reachable: the
deepest name taken runs #91 in round one out to #285 in round seven, so the
fifth-round steal the board exists to create can still actually be taken.

**The read.** Give each club its own file on each prospect — the public football grade
plus a private lean — seeded per `(club, player)` so a club that likes a man likes him
identically at pick 3 and pick 103, in every process:

```
opinion = publicGrade + normal(0, DRAFT_READ_LEAN_SD 4)      # stream draft-read-{team}-{player}
gap     = max(0, CEILING_ANCHOR + normal(0, DRAFT_READ_GAP_SD 3))  # stream draft-gap-{team}-{player}
now     = clamp(opinion − POTENTIAL_WEIGHT × gap, 20, 99)
ceiling = clamp(now + gap, now, 99)
```

Make the pair **coherent**, because the valuation reads it as a rating *and* a ceiling
and weights them differently: blended back on the board's own weights it must return
exactly this club's opinion of him
(`CURRENT_WEIGHT × now + POTENTIAL_WEIGHT × ceiling === publicGrade + lean`), so where
a club ranks a prospect is what it thinks of him rather than an artefact of how his
grade got split into a present and a future.

`DRAFT_READ_LEAN_SD` is **the lever** that sets how loosely the draft tracks the board
— reach for it before the window. Swept over 40 classes:

| lean sd | Spearman(board rank, pick order) | R1 median/p90 | consensus #1 goes at | 50+ slides |
|---|---|---|---|---|
| 2 | 0.940 | 7/22 | pick 2 | 3.9 |
| **4** | **0.923** | **9/30** | **pick 3** | **7.4** |
| 7 | 0.884 | 12/43 | pick 4 | 15.4 |
| 10 | 0.842 | 17/53 | pick 6 | 21.9 |

By 7 the consensus #1 is a top-five pick only 60% of the time and fifteen names a
draft slide half a round or more, which is a board nobody would publish. Keep 4
deliberately **far smaller than the room's own error** (`EVAL_SD 7`, before the
misfile and blindspot multipliers): clubs mostly agree with the consensus, which is
why it *is* the consensus, and the prospect who is genuinely misread is misread by
everybody — that error already lives in the grade this leans off.

Treat `DRAFT_READ_GAP_SD` as a **weak lever and do not tune around it.** Swept
0 → 3 → 8 over 40 classes it moves Spearman by 0.001 and not one distribution number
outside noise, because it only reaches the valuation's upside term, which a contender
weights at 0.18. If you want clubs to disagree more, move the lean.

**The value.** Leave the player-valuation function untouched and hand it a **shadow**
carrying the club's read in the `trueOvr` and `potential` fields. Then the age curve,
the tier curve, team needs, positional value and the reach all keep working, on top of
the opinion instead of the answer:

```
shadow     = { id, position, age, trueOvr: read.now, potential: read.ceiling }
base       = playerValue(shadow, { profile, needs, rng: perClubStream })
             × (1 − profile.bpaBias × 0.15)
             + read.now × profile.bpaBias × 0.6
value      = base × DRAFT_POSITION_VALUE[position] × positionSaturation(position, held)
```

Seed the valuation's own noise term per `(club, prospect)` rather than off the shared
draft stream: on the shared stream a club's valuation of the same man changed by ~9%
every time it came back on the clock, which is not an opinion.

Measured, same 100 generated classes, 224 picks each, same clubs, rosters, GM profiles
and pick order — old omniscient engine versus the shipped one:

| | before | after |
|---|---|---|
| Spearman(board rank, pick order) | 0.595 | **0.924** |
| round one, median board rank taken | 34 | 19 |
| round one, worst board rank taken | 254 (max 398) | 67 (max 91) |
| consensus #1 goes at pick, median | 12 | 3 |
| `|board rank − pick|` median/p90/max | 46/140/391 | 18/48/100 |
| ... round one only | 20/98/391 | 8/27/63 |
| picks spent on board #150+, per draft | 91.7 | 77.2 |
| ... earliest such pick | pick 1 | pick 90 |
| the actual 1.01's mean board rank | 29.7 | 9.3 |
| the actual 1.01: hit (85+) / bust (<78) | 100% / 0% | **59% / 15%** |

That last line is the whole point: a 1.01 could not miss while the club picking it
could see the answer, so the board's busts were a story the user could read and never
actually live through.

**Do not let it become a script either**, which is the failure mode on the other side.
Half of round one still moves 8+ places from where the board put it, one pick in ten
moves 27+, and 7.6 names a draft slide 50 places or more. What stopped is board #242
going third overall.

Know what it cost the user's edge: a board-order drafter against a
perfect-information drafter at slot 16, career peak, **+14.6 before and +10.3 after**
(72.1 → 86.7 becomes 80.0 → 90.3). The edge narrows because rivals stopped cheating,
not because scouting stopped paying — the man who follows the board went from 72.1 to
80.0, and perfect information is still worth ten points of peak and 6.3
Star-or-better players a draft against 2.6.

**Reach occasionally.** With probability `DRAFT_REACH_CHANCE = 0.18`, take
`rng.int(1, min(DRAFT_REACH_DEPTH 6, board.length − 1))` instead of the top of the
club's own list. Now that the list is anchored to the public board this is legible as
what it is — a reach **against the board**, the thing a room gets second-guessed for —
instead of noise on a ranking nobody could see.

**Draft a roster, not a list.** Multiply each candidate's value by a saturation factor
for how many of that position the club already holds:

```
positionSaturation(pos, held):
    1 while held < ideal
    × PAST_IDEAL_DECAY (0.90) per body past ideal, while at or under max
    × PAST_MAX_DECAY  (0.35) per body past max, compounding on top
```

For a quarterback that is 0.315 for a fourth, 0.031 for a sixth, 0.0098 for a seventh.
**It never reaches zero**, deliberately, and that is the house rule on outliers: make
the crazy ones increasingly less and less likely as they go on, never forbid them.

The report that forced this: *"we just had our save run 6 QBs in a row off the board
all to teams who already had stacked QB rooms"* — one club holding six quarterbacks at
94/93/92/88/83/76, about **$129M of a $255M cap on one position**, and the 88 was the
man it had just drafted. Everything below the club's own board was working; what was
missing is that **nothing in the pick asked how many of him the club already had.**
Team needs comes closest and it saturates at zero — a club with three good
quarterbacks and a club with eleven are the same club to it — and zero need is only a
15% discount, against a QB tier curve and a 1.5 positional multiplier pulling the
other way. Fifteen percent never beat that. Measured over 200 replayed drafts off
twenty blind-sampled real leagues, **33.2% of all 224 picks** were spent at a position
the drafting club was already at or over `max` in.

Apply the saturation to the **whole** value, best-player-available term included,
because that term is the one that was winning: a club whose GM leans BPA was the club
most likely to take a fourth quarterback, since that bias deliberately routes around
the need multiplier.

Measured, same 200 drafts, before → after: picks at a full room **33.2% → 4.8%**;
picks inside a run of three-plus consecutive same-position selections by clubs already
full there **2.52 a draft → 0.14**; the longest such run anywhere **9 → 6**; and the
deepest quarterback room any club **ended** a draft with **13 → 11**, which is the
room it walked in with. Board fidelity is unharmed and slightly better —
Spearman(board rank, pick order) 0.910 → 0.921 — because a club knocked off a stacked
position takes the next name on the board rather than reaching past it.

Why 0.35 and not 0.45 on the past-max term: **nothing in the game ever unwinds an
over-max room.** Cut-down day knows about position only far enough to keep a club's
last kicker and punter, so a sixth quarterback survives it whenever he outranks
somebody at a position the club is thin at. Over-max is a one-way ratchet — brand-new
leagues sit at 0.4% of club-positions over max and by their fifth season **44.8% of
clubs are over max at quarterback** — so the draft's own contribution has to be near
zero rather than merely smaller. And why not 0.20, which is better on every column:
because at 0.35 a club still spends 4.8% of its picks on a full room and **37% of
those are at a position where its existing starter grades 85+** — that is the falling
elite prospect a real front office takes anyway, and an AI without it is "unbeatable
and boring". By 0.20 the required value gap is 5× at a fourth quarterback and that
behaviour is gone rather than rare.

Make the roster argument **optional** and fall back to a board pick rather than
crashing: a measurement harness calls this without one, and a caller that cannot see a
roster should get a board pick rather than a saturation charge computed from nothing.

Keep the pick function **pure** — no database, no truth — so the draft it produces can
be measured over hundreds of classes offline against exactly the code that ships.

Memoise the class board for the length of the draft, keyed by league and **validated
by membership**: check that every prospect on the clock is on the board you are about
to hand out. Next year's class shares no ids with this one, so a stale entry can never
satisfy that, while a board that has simply had players drafted out of it still does —
which is the case worth being fast. Grade the **whole class, drafted men included**,
because positional scarcity decays down the position group: grade a shrinking pool and
every remaining quarterback is silently re-ranked each time one comes off the board,
so the AI drafts off a different board from the one on screen. A 400-row read with
three JSON columns on each of ~224 picks is why this is memoised at all.

Select off the **rookie path only when the draft kind is ROOKIE**, and deliberately do
not select `trueOvr` or `potential` in that query — so there is no way for the truth to
reach a pick, rather than a convention that it must not be read. Gate on the kind and
not on "are there any `isDraftee` players", because the fantasy pool is written
`isDraftee` too. A draftee who is not on this class's board is a leftover from an older
class that never re-entered free agency; skip him on the rookie path and let the
veteran fallback reach him, so nobody becomes permanently un-draftable.

### 5.11 Run the draft live

**Put one AI pick on a clock of `TICK_SECONDS = 5`.** Three was too fast to read: the
name of the man taken, the club that took him and where the board had him all landed
and were gone before you could look up. Five is long enough to watch a round go by and
short enough that seven rounds is still one sitting.

Make the ticker the **only** thing that runs an AI selection during a normal draft.
The selection action used to batch every intervening pick the instant the user chose,
so the board leapt straight to his next turn and he watched none of it. Keep skipping
ahead as a **run button** — a thing a GM presses, not a thing that happens to him.

Run nothing at all until the GM has opened the draft: no clock, no request, no
rendering. Put the war room in the ticker's place instead.

**Hold exactly one idea of whether the board is moving.** There are three ways it can
be — the clock is running (a card every 5s), the board is being **run down** in
chunks as fast as the database will go, or it is **stopped** — and they are states of
one thing, not three features. Exactly one is true at a time:

- A run **suspends** the clock rather than racing it. Hold the same in-flight guard for
  the whole run and refuse to even count down while running. Two writers taking picks
  against one draft state is the bug reported as *"the timer ran out but i saw no
  players taken"*; a batch runner is a second writer, so put it **behind** the same
  gate rather than beside it.
- **Stop** ends the run at the next chunk boundary and leaves the board **stopped** —
  not back on a five-second clock. A GM who presses Stop means stop, and handing him
  back a board that keeps drafting every five seconds answers a different question.
  Put Resume right there.
- Anything that ends a run resets the clock to the top of `TICK_SECONDS`. It used to be
  possible to leave it at zero with a blocked tick behind it: a stopped draft that says
  "Next pick in 0s".
- A confirm prompt holds the board too — the panel is telling him how many cards are
  left and asking whether to run them out, and a clock ticking cards off underneath
  that question makes the number in it wrong while he is reading it.

**Bound each run chunk twice, and you need both bounds.** `CHUNK_PICKS = 12` is the
"even when it is fast, let him watch it" cap — about a second and a half at
same-region latency, which reads as a board moving rather than a spinner.
`CHUNK_MS = 3500` is the "when it is slow, do less" deadline, checked **between**
selections, and it is what keeps the request off the serverless function ceiling: at
25 ms latency a chunk gives up after four or five picks instead of twelve, worst case
3.5s plus the one pick that crossed the deadline ≈ 4.4s against a 10s ceiling, with
the rest left for a cold start. A count alone is a guess about latency; a deadline
alone would run two hundred picks in one request on a fast day and show him none of
them. Measured, a full 224-pick run is ~85s at 10ms latency and ~190s cross-region —
every row of that is over the default function budget, and a request that trips the
ceiling never resolves the client's await, which is the dead 'Picking…' button.

Check the deadline **before** the pick and only after at least one has landed, so a
chunk always makes forward progress: a client loop that can receive `picksMade: 0`
forever is the frozen button again, wearing a progress counter.

Return a reason the chunk stopped (`USER_ON_CLOCK`, `DRAFT_COMPLETE`, `BOARD_EMPTY`,
`CHUNK_FULL`) and let only `CHUNK_FULL` mean "call me again". Loop **on the client**,
because that is where the progress is.

**Refresh the board itself on the same cadence as the clock** (`TICK_SECONDS × 1000`).
The chunk action deliberately does not revalidate per chunk, so without this the
broadcast band sits on the club that was on the clock when the run started while the
ticker inside it counts past round three — a screen disagreeing with itself. Refreshing
after every chunk is the other extreme: a full server render of the heaviest page in
the app twenty times in one run. On the shared cadence, a refreshing run is not new
load — it is the same load, with more selections behind each one. **Yield ~200ms** so
the refresh actually goes out: it is queued against the same channel the chunk requests
use, and a loop that fires the next chunk the instant the last one lands never gives it
a turn — measured, with no pause the band sat on "Round 1 · Pick 1" while the ticker
counted **96 selections** past it; at 200ms it tracked the run to within a few cards.

**Earn the run button's label** by reading the GM's actual unused pick rows rather
than assuming, and re-read it when the situation changes — he goes on or off the
clock, the draft opens, a run ends. Do not poll: nothing else can change his pick
count while the board is running, and the ticker already has one clock.

**Allow one pick in flight at a time, and clean up on the way out.** A branch that
returned with no cleanup function while a pick was pending left the in-flight request
unowned whenever anything re-ran the effect before it resolved — and the action's own
revalidation re-renders the page, which flips the on-clock prop — so a second pick was
scheduled on top of the first. That is what *"the timer ran out but i saw no players
taken"* looked like. Use a ref, not state: it has to be read and set synchronously
inside the same tick, and a state update does not land before the second run checks it.
Set the "still mounted" flag **on the way in as well as clearing it on the way out** —
Strict Mode mounts every effect twice in development, so a cleanup-only version latches
false on the first teardown and never comes back: a run then made exactly one chunk,
discarded the result, and left the in-flight guard held forever, freezing the board on
"0 selections in" with a Stop button that did nothing.

**Draw the draft as a broadcast**, in one page: a hero band naming the club on the
clock and the round, a live selection feed, the run-watch panel, the war room, and both
best-available boards. Keep the war-room gate's Start button in the same place. (The
reference implementation prototyped the broadcast as a separate route and then folded
it into the draft page, leaving the old route as a redirect so saved links still land
somewhere real.)

### 5.12 Price the rookie deal, and warn before the podium

Build one function for the slot price and have **every** caller use it:

```
rookieDealForPick(pick, seasonYear) = buildContract({
    apy:        rookieScaleApy(overallPickNumber(pick), TEAM_COUNT × ROOKIE_SCALE_ROUNDS),
    years:      CAP.ROOKIE_DEAL_YEARS,     # 4 — the league's constant, not a literal
    signedYear: seasonYear,
    isRookieDeal: true,
    bonusPct:   0.4,                        # a real rookie deal is bonus-heavy
})

rookieScaleApy(overallPick, totalPicks):
    t = clamp((overallPick − 1) / max(1, totalPicks − 1), 0, 1)
    apy = R1_PICK1 × (R7_LAST / R1_PICK1) ^ (t ^ SHAPE)
    return max(MIN_SALARY, round(apy / 50_000) × 50_000)
# R1_PICK1 $9,500,000   R7_LAST $1,050,000   SHAPE 0.40   MIN_SALARY $1,000,000
```

**Steepen the exponential with `SHAPE`.** A flat exponential gets both ends right and
the middle badly wrong — pick #32 paid **74% of #1** where the real scale pays about
**32%**, and one club's seven-man class cost **9.6% of its cap against a real ~4.5%**.
Both anchors are fixed points of the exponent, so pick 1.01 and the last pick are
unmoved by construction.

**Stretch the scale across seven rounds (`ROOKIE_SCALE_ROUNDS = 7`), not across the
league's configured round count.** That denominator is what makes pick 100 cost the
same money in a five-round league as in a seven-round one; feeding it the league's own
round count re-prices the whole board every time that setting moves, so a club's last
pick is always dead-last money whatever round it falls in.

Take the **term** from the league's rookie-deal constant and not a literal 4: the
league generator already puts every young player on that constant, so a literal
governs one of the two ways a man can arrive on a rookie contract and the constant
governs the other. They agree today; what matters is that they cannot stop agreeing.
Keep `bonusPct` a literal and **not** shared with the generator's 0.15 — that number
is low because those contracts are dropped into a random mid-deal year rather than
signed fresh.

Write the price in **one** place. It was written out twice inside the draft action, ten
lines apart, and that stopped being survivable when the war room started quoting the
same figure to a GM **before** he opens the draft: a warning that prices his class off
a second formula is worse than no warning, because he will trust it and be blocked at
the podium anyway.

**Block the user at the podium; let an AI club clear its own room.** A rookie deal is
real cap money and this path used to hand it out with no cap check at all. It is also
the one transaction a club cannot decline, so handle the two sides differently without
giving either an exemption: throw the same cap-violation error every other move throws
for the user, and have an AI club release the least valuable veterans that **cover the
bill** rather than stalling the draft for everyone. Pay by **dollars covered, not by
count** — "fewest" was the old principle, and paid by count a club settled a $990k
bill by waiving its 24-year-old 95, which is where the elite men in the post-draft free
agent pool were coming from.

The asymmetry is not "the user is treated worse", it is "the user has to be **told
first**", and the only place that can happen is the war room before he sends the first
card. So compute a rookie-pool outlook there:

- Return **null** when the cap is off, or when the year's slots are still placeholders
  (§1.8), or when he holds no unused picks. There is no price for a draft whose order
  does not exist yet, and null is the honest answer.
- Read his unused pick rows directly, in selection order, and price each at the slot it
  will actually be made from. Read pick **ownership as the draft will read it**, not a
  projection built for a different panel.
- **Walk the picks and decrement, rather than only totalling.** The draft charges one
  pick at a time against the room left at that moment, so the honest question is not
  "does the class fit" but "which card is the one that stops". Return the first pick
  the books cannot cover — the exact selection the draft would throw on — and the
  dollars short at it. Seven picks of dead-last money is still ~$7M, and the gate
  fires on the last of them as readily as the first.
- Report whether cuts alone could still cover that shortfall, and **block only while
  they can**: a club with no way out at all is let through rather than deadlocked on
  the clock, because a warning that promised a block there would describe a rule the
  code does not follow.
- Offer the cuts and restructures that would cover it, best first, and only scan for
  them once the warning is actually going to be shown — a compliant club with room to
  spare has nothing to suggest and that is a whole-roster read.
- Say nothing at all (return nothing — there is no `warn: false` outlook for a caller
  to render by accident) unless a card stops **or** the class leaves him thinner than
  `ROOKIE_POOL_WARN_CUSHION = CAP.MIN_SALARY`. A warning that fires every year is
  furniture and a GM stops reading furniture, so the loud case is the walk finding a
  card he cannot pay for, which is a fact and needs no threshold. One league-minimum
  contract is the quiet case's threshold because below that he cannot add a single body
  after the draft — an undrafted free agent, a week-two replacement — without cutting
  somebody. Measured across every save in the development database, of the 42 user
  clubs sitting in or approaching a draft with picks and the cap on, **one** trips it:
  a club $23.9M over the ceiling on $56.0M of dead money, stopped at its own first
  pick. The next tightest club finishes its draft with $26.9M still standing — so
  every cushion between $0 and $26.9M gives the identical answer on real data, and
  the smallest value with a meaning in the game is the honest choice.
- Label every figure "as the roster stands" and make none of it a verdict. He may cut,
  restructure or trade before the podium, and an AI club may hand him a deal. It also
  cannot see the rookies it has not signed yet becoming cuttable themselves, which is
  the one direction this errs pessimistic in, and the smaller error of the two.

### 5.13 Close the books when the draft ends

On the advance out of DRAFT, in this order:

1. **Refuse to advance until the draft is complete** ("Draft is in progress — make
   your picks, then advance").
2. **Convert every remaining `isDraftee` to an ordinary free agent**, with **no year
   filter.** The draft is over and the draft state says so, so anybody still carrying
   the flag went undrafted. A stale prospect left flagged is permanently excluded from
   normal free agency (which filters `isDraftee` out), never aged (progression only
   touches active players), and resurfaces in every future year's draft pool mixed in
   with the real new class. `draftYear: { lt: seasonYear }` is a year late and breaks
   two things invisibly: **unsignable** — this year's undrafted class stays flagged
   until next year's draft completes, which is after next year's free agency has
   closed, so an undrafted rookie first reaches an open market two offseasons after
   his draft, where in the real sport he signs within days; and **unclearable** —
   free-agent attrition selects `isDraftee: false`, so the very cohort its churn curve
   was written for (most of the ~400 men entering the pool a year are 22-year-old
   undrafted rookies) was excluded from it. They neither signed nor left. Dropping the
   filter is also what frees fantasy-draft leftovers, which are written with a null
   draft year and could never match a `lt` comparison at all.
3. **Delete every shortlist entry in the league.** A shortlist row has a player and a
   team and nothing else — no year, no league, no draft — and nothing had ever deleted
   one, so a star placed in 2027 was still on the books in 2029, quietly holding a
   slice of the attention pool. What is on the board when the board closes is what
   closed with it.
4. **Run cut-down day** (§3.4), blocking the advance if the user is over the limit.
5. Flip the phase to PRESEASON, week 1, and summarise: how many undrafted prospects
   entered free agency, how many men were released in final cuts, "on to the new league
   year".
6. **Run the AI position-conversion sweep** when the board empties (§2.7). This is the
   moment a club reshapes its line — the board is empty, every roster has just taken
   on a class, and it is the point in the year a real front office looks at three
   tackles and one guard and slides somebody inside. **Exempt the user's club:** his
   roster is his to shape, and a CPU moving his left tackle inside overnight would be
   the most infuriating thing this game could do; offer him the same sweep one player
   at a time on the player card, which is where the decision belongs. Make it safe to
   reach more than once — each accepted move strictly increases the club's
   starting-lineup sum, so a second sweep over an optimised roster finds nothing and
   writes nothing.

### 5.14 End the draft with a recap, not a verdict

Show the club's own class, every other name called, and the handful of things that
were true on the night. The draft used to end with the board simply emptying out.

For **your own** picks show the numbers you now actually have: overall pick, round,
name, position, college, height/weight, the exact rating and exact ceiling, the role
your staff projects him into (drawn from the ceiling, not from what he is today), the
public board's rank, grade and band as they stood **over the whole class**, your own
grade on the board's scale where you can see him exactly, and the one-line
disagreement note his row carried on the night. Mark a pick that originally belonged
to another club with that club.

For **everyone else's** picks show the public grade and board rank, and your own
scouted **range** only where your department wrote a real file on him. Everybody else
carries the public grade and nothing more, which is the honest answer: you never saw
him. Flag a man who was starred on your board and called by somebody else.

**Gate every rating on the flag the scouted view returned, never on anything read off
the record.** The men in your class are yours now — they signed, they are in the
building — and their ratings are exact for the same reason they are exact on the roster
page. Everybody else's rookie stays behind your scouts. A true overall on another
club's pick would be the worst number this page could print. A man you drafted and have
since traded or cut comes back with neither flag and renders as the ranges he really is
to you.

Add room for notes that are **facts about how the room went, never verdicts on whether
a pick worked**. Grade nothing against a career that has not been played yet, because
in April nobody knows. The closest this comes is setting your own grade beside the
room's, which is a disagreement, not a result. The game already has a place where the
result gets told: the years these men are about to have.

Draw the age for the avatar but **do not print it** — the avatar is generated from
build and age so a man's face stays the one every other screen gives him, and a recap
of a draft two phases ago would be quoting a number that has since ticked over.

---

## 6. The combine as a signal — the exploitable gap

### 6.1 Derive what a drill is worth at a position; do not hand-type sixteen columns

The brief this implements: *"athletic testing matters differently across position. 40
time matters more for a CB than it does a LT."* Until this existed the athletic
composite was a flat six-way average for everybody, so a 330lb left tackle's forty
counted for exactly as much of his rank as a corner's did.

Compute the chain at module load:

```
POSITION_WEIGHTS        what a position's PLAY is made of in THIS engine. trueOvr is
  (from the rating spec) computed from it and the sim runs on trueOvr, so it is the
                         game's own statement of what a job needs.
  × PHYSICAL_BASIS       which raw physical qualities each of those skills rests on.
                         ← THE ONLY JUDGEMENT IN THE CHAIN.
  = a per-position demand over speed / acceleration / agility / strength
  × DRILL_ATTRS          what each drill measures (§1.11), a table you already have.
  = how much each drill is worth at each position
```

Then, per position:

```
demand[axis] = Σ over attributes: (weight / Σweights) × PHYSICAL_BASIS[attr][axis]
raw[drill]   = Σ over axes: DRILL_ATTRS[drill][axis] × demand[axis]
weight[drill]= DRILL_FLAT_SHARE/6 + (1 − DRILL_FLAT_SHARE) × raw[drill] / Σraw
```

**Renormalise `POSITION_WEIGHTS` first.** They do not sum to 1 (LB's deliberately sums
to 1.18), so a position that carries more named skills would otherwise read as
physically hungrier for it. The resulting demand does **not** sum to 1 either, and
should not: the missing remainder is everything a stopwatch cannot reach, which at
quarterback is most of the job.

**`PHYSICAL_BASIS` — the judgement table.** A row that does not sum to 1 is
deliberate: the remainder is technique, instinct or hands, which no stopwatch reaches,
and the gap is why zone coverage (mental) carries less physical demand than man
coverage (a footrace) and why ball skills carry almost none. An attribute absent from
this table contributes **no** physical demand at all — awareness, football IQ, decision
making, vision, ball security, hands, short and deep accuracy, kick accuracy and work
ethic are not things a combine can time.

```
speed        { speed 1 }          acceleration { acceleration 1 }
agility      { agility 1 }        strength     { strength 1 }

passBlock    { strength .45, agility .30, acceleration .15 }
runBlock     { strength .65, acceleration .20 }
footwork     { agility .70, acceleration .25 }

passRush     { acceleration .40, agility .25, strength .20, speed .10 }
runStop      { strength .55, acceleration .15 }
blockShed    { strength .70, agility .10 }
pursuit      { speed .55, acceleration .30, agility .10 }
tackling     { strength .35, acceleration .15 }

coverage     { speed .40, agility .35, acceleration .20 }
zone         { speed .20, agility .20, acceleration .15 }
press        { strength .40, agility .25, acceleration .15 }
ballHawk     { agility .15, speed .10 }

elusiveness  { agility .55, acceleration .30 }
power        { strength .60, acceleration .15 }
route        { agility .35, acceleration .30, speed .10 }
release      { acceleration .30, agility .20, strength .20 }
contested    { strength .35, acceleration .15 }

armStrength  { strength .35 }     pocket    { agility .20 }
kickPower    { strength .35, acceleration .20 }
```

Nothing in the codebase says what a three-cone is measuring, or how much of "pass
blocking" is anchor strength and how much is a kick slide. **These rows are a read and
nothing more; they are the place to argue, and every number downstream moves when they
do.** The point of deriving the rest from them is that the weights are a statement
about **this simulation** rather than about the real NFL, and they follow the engine if
the engine is retuned: move a guard's run-block weight and his bench re-prices itself
with no second table to remember.

**Keep `DRILL_FLAT_SHARE = 0.25`, and do not take it to zero.** Derived alone, a left
tackle's forty comes out at **5%** of his athletic rank, which is not "matters less"
but "does not count" — and a tackle who runs 5.6 really is a problem, whatever the
engine's weight vector says. The floor is also what stops a position the engine is
physically silent about from degenerating: a kicker is graded on kick power and kick
accuracy, so without it his rank would rest on two drills. A quarter flat and three
quarters derived still leaves a corner's forty worth roughly **two and a half times**
a tackle's, which is the effect asked for; going lower buys a sharper table at the
cost of drills that no longer count at all.

Publish the table with every row summing to 1 over the six drills, and have **every**
caller renormalise over the drills a man actually ran. The six positions that skip the
bench simply have that column dropped and the remaining five rescaled, rather than
being scored against a battery they were never going to run.

The effect to expect: a corner's rank leans on the forty, the shuttle and the
three-cone; a tackle's on the bench, the three-cone and the broad; an edge rusher sits
between them. Concretely, **the forty is worth 0.07 of an offensive lineman's rank
against 0.21 of a corner's.**

### 6.2 Derive how much of a man's real grade each drill carries — separately

This is a **different question** from §6.1 and must not be conflated with it. That one
is what the composite a GM reads **weighs**. This one is what actually **predicts
ability** at the position. The two only look alike because the same fact drives both: a
fast tackle is not a better pass protector, and a strong corner is not better in
coverage.

```
cap          = ABILITY_CAP_FRACTION × sqrt(WEIGHT_SUM_SQ − NOISE_WEIGHT²)
meanWeight[d]= mean of POSITION_DRILL_WEIGHTS[p][d] over the positions that RUN d
base         = (d == forty) ? FORTY_ABILITY_WEIGHT : ABILITY_WEIGHT
relevance    = POSITION_DRILL_WEIGHTS[p][d] / meanWeight[d]
raw          = base × relevance ^ ABILITY_RELEVANCE
weight       = softBound(raw, base, (cap − base)/3, 0, cap, 2)
```

`ABILITY_WEIGHT 0.78`, `FORTY_ABILITY_WEIGHT 0.30`, `ABILITY_RELEVANCE 0.6`,
`ABILITY_CAP_FRACTION 0.99`.

**Anchor on the two league-wide means and hold them.** `ABILITY_WEIGHT` and
`FORTY_ABILITY_WEIGHT` are the league-wide mean for their drill, not a flat value for
every position. Holding the mean is what stops this quietly changing how much a workout
reveals league-wide, which is the fog figure the whole scouting layer is tuned against.
That is also exactly what keeps the room's fixation mispriced by the same amount **on
average** while making it wildly wrong at some positions and roughly right at others —
and **that variance is the gem.**

**Use `ABILITY_RELEVANCE = 0.6`, not 1.0.** A better tackle really is stronger, because
strength is over half of what the engine says his job is made of, so his bench should
read his grade; a better tackle is not meaningfully faster, so his forty should read
his card and the day he had. But the relevance shares are themselves derived through
two tables of judgement, and a square-law response to them would put more confidence in
the chain than it has earned.

**Soft-bound the cap; never `Math.min` it.** The drill z-score spends a unit-variance
budget — the attribute weight is `sqrt(WEIGHT_SUM_SQ − ability² − noise²)` — so an
ability weight past `sqrt(WEIGHT_SUM_SQ − NOISE_WEIGHT²)` takes the budget imaginary
and the printed spread stops matching the anchor table. A `Math.min` there would pile
every strongly-relevant drill onto exactly the cap, which is this codebase's most
repeated defect. Approach it and never reach it; set the soft sd to a third of the
headroom so the asymptote sits strictly above the two-sd knee (at exactly half, the
soft bound's own headroom collapses to zero and it degenerates into the clamp you are
avoiding).

**Verify the spreads did not move.** Measured over 12 classes before and after the
ability weight was split per position, every position's printed forty / vertical /
three-cone / bench spread is unchanged to the third decimal (LT forty 0.146 → 0.144,
DT bench 5.07 → 5.11, CB three-cone 0.215 → 0.210). That is the acceptance test for
this whole section: a drill that reads less of a man's grade reads **more** of his
profile, so the total signal and the printed spread are both conserved.

### 6.3 Rank testing within the position group

Compute the public athletic rank like this:

1. Rank every drill a man ran against the men at **his own position** in this class.
   Share a rank on a tie (standard competition ranking: two men tied for best are both
   rank 1 and the next man is rank 3).
2. Take a **weighted** mean of those finishes, weighted by what each drill is worth at
   his position (§6.1), renormalising over the drills he actually ran. A position with
   no weights at all falls back to 1 apiece, which is the old flat mean.
3. Order his **position group** on that mean.

**Use full-precision finishes in the average, not the rounded percentile.** A rounded
percentile is right on a card tile and wrong as an input to an average: a group of
twenty-five offers only twenty-five finishes, so six rounded percentiles land on a
coarse lattice and men collide who are not level. Measured over 158 classes, averaging
the rounded figure left **39.8%** of every class sharing a rank. Use
`100 × (outOf − rank) / (outOf − 1)` with the rounding left off.

**Break ties with the continuous read.** Even at full precision, six finishes out of a
twenty-five-man group average onto a lattice: on the average alone **22.4%** of a class
shared a rank and the worst pile-up put **nine men** on one, which reads as a broken
column rather than a dead heat. Separate level men by `testingAthleticism(position,
testing)` — the same public stopwatch against the same position anchors, converted to
z against each anchor, weighted, and pushed through a normal CDF — so it reveals
nothing the average did not and only ever orders men the average could not tell apart.
With the tiebreak it is **0.4%**, and never more than three. Two men alike on both did
test the same, and should share a rank.

**Rank within the position group, not against the class.** Each drill was already
placed inside the position group — a 330-pound tackle is never going to run a 4.4, so
ranking the raw stopwatch across a class turns the column into a proxy for "is he a
skill player", which tells a front office nothing it could not read off the position
badge — but the headline that came out of it read "67th of 400 in the class", and a
tackle is not chosen out of four hundred men. *"It should also be ranked against same
position players, not the general class."* So order the average inside the group too,
and print "Athletic 4 of 16" — the fourth-best tester among the sixteen left tackles in
this class.

Do the ordering in **one** function so the draft board and the player card cannot
disagree about the same man.

**Average over missing events; never score them as failures.** Rank a man on the drills
he actually ran — a corner who was never going to bench is not pushed down his group
for it, because the battery that group runs is **measured from the group** (the modal
event count) rather than assumed. Flag anyone below his group's usual battery as
`thin`: his average rests on less, and the reader is told rather than sold a number
that looks as solid as the rest.

**Keep the public-perception read flat, and only that one.** The single aggregate that
feeds public buzz — the plain mean of a man's percentiles — stays unweighted, because
it feeds the public and the public does not weight a workout by position. That is the
same decision as keeping the room's forty fixation global (§5.4): a bias that adjusted
itself sensibly by position would not be one.

Keep the big-board buzz score modest, so a strong workout nudges the board and does not
rewrite the grade:

```
bigBoardScore = scoutedOvr × posValue
              + float(−3, 3)                      # seeded per player, reseeded every 2 weeks
              + ((testingPercentile − 50) / 50) × 8 × posValue
```

Reseed the wobble every couple of weeks rather than every render, so the board has
risers and fallers across the season without touching anyone's true rating.

### 6.4 Hit these acceptance numbers

Cap the athletic rank's marginal signal **on purpose**. Inside a position group it runs
rho **−0.56** against a man's true overall, against rho **−0.69** for the consensus
board rank sitting two columns away on the same table — which is equally free to every
club — and once that board rank is held fixed, the athletic rank adds rho **−0.35** of
its own. (On stored classes in real saves the same partial reads −0.32 to −0.40.)

That partial was **−0.20**, which was too little for testing to be worth acting on at
all; it is not −0.7, because **a public column that reliably beat the board would end
scouting.** What the move bought, over 40 classes with career peaks rolled through
progression:

| | before | after |
|---|---|---|
| rounds 4–7 top-quartile tester → 70+ starter | 68.5% | **73.9%** |
| ... base rate for rounds 4–7 | 66.1% | **65.9%** |
| rounds 1–2 top-quartile tester → bust (<78) | 17.7% | 15.9% |
| ... base rate for rounds 1–2 | 22.1% | 22.3% |
| "best tester of the 8 left" beats "best board rank" | 34.8% | 41.6% |
| ... and loses to it | 38.9% | 39.4% |

**The headline acceptance number: in rounds 4–7 a top-quartile tester becomes a
genuine 70+ starter 73.9% of the time against a 65.9% base rate.** Before the change,
tilting late picks toward the stopwatch **lost money** — 73.2 mean career peak against
the board's 74.1. It now runs 74.3 against 74.7 and lands more quality starters (37.2%
at 78-plus against the board's 34.0%), which is an edge worth taking without being a
free one.

**And it must stay an edge, not a solved draft.** Following the stopwatch **alone** —
best tester anywhere on the board — still yields only ~**63%** (62.8% → 63.3% across
the position-weighting change) against the board alone at ~**69%** (68.8% → 68.9%). So
the stopwatch on its own is **six points of starter rate worse than simply following
the board**, and scouting still has to happen. Following testing with no board at all
is a disaster: 38.6% starters against the board's 71.8%. Treat those two rows as
guard rails and re-measure them after any change to this section.

What the **position weighting** then bought, and it is the interaction rather than
either half. Because the room's forty fixation stays global while the forty only
predicts anything at some positions, the board now pays for a drill that is often
worthless — and the men it underpays hardest are exactly the slow-forty, top-quartile
tester at a position where speed is nearly irrelevant. Measured over 30 freshly
generated classes (11,796 tested prospects), among picks in rounds 4–7:

| cohort | n | mean board rank | career peak | 70+ starter |
|---|---|---|---|---|
| every pick in rounds 4–7 | 3798 | 160 | 70.7 | 55.7% |
| slow forty + top-quartile, flat composite | 102 | 150 | 78.0 | 90.2% |
| slow forty + top-quartile, position-weighted | 122 | 153 | 77.5 | 86.1% |

The cohort was always good; the weighted composite finds **a fifth more of them at the
same quality** — 105 starters against 92 — and on the offensive line, where the forty
is worth 0.07 of a man's rank against a corner's 0.21, it finds **49 against 36**.

The fog did not move with it: board+athletic recovering an unscouted true rating ran
0.715 → 0.719, and the class-wide acceptance rows moved 62.2% → 63.7% against a
55.5% → 55.6% base.

**Expect the board half of any retune to reach classes already in a save and the
generator half not to.** Testing is rolled once, at class creation, and nothing is
backfilled — so a class already in a save keeps the numbers it was born with. Measured
on four real saves, that is most of the way there anyway: the athletic rank's partial
against true overall inside a position group moves from −0.25/−0.33 to −0.32/−0.40 on
stored classes purely off the board-side constants. The generator half arrives with the
next class the league mints, which is one season away at worst. Nothing a player
already owns changes value; a board grade re-computes, as it always does on every
render.
