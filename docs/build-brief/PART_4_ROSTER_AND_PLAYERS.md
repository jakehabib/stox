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
