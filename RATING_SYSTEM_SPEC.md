# Dynasty GM Football — The Rating System

A specification of the player-rating layer as it is actually implemented and
tuned in this repository. Every number here is real and measured, not
aspirational. Source files: `lib/ratings.ts`, `lib/gen/players.ts`,
`lib/progression.ts`, `lib/development.ts`, `lib/scouting.ts`, `lib/tuning.ts`.

---

## 0. The rule that everything else rests on

**A rating is derived, never stored as truth.**

The stored truth is the **attribute map**. Overall is a weighted average of
that map, computed on read.

This is not a style preference. It is what lets a position change honestly
recompute a man's grade, and what lets the scouting fog show a different
overall for the same player without a second code path. One source, read many
ways.

```ts
// lib/ratings.ts
export function computeOverall(pos: Position, attrs: AttrMap): number {
  const weights = POSITION_WEIGHTS[pos];
  let sum = 0, wTotal = 0;
  for (const [key, w] of Object.entries(weights)) {
    const v = attrs[key];
    if (v == null) continue;        // a position ignores what it does not weight
    sum += v * w;
    wTotal += w;
  }
  if (wTotal === 0) return 50;
  return Math.round(sum / wTotal);  // renormalised by the weights present
}
```

The renormalisation matters: you can add an attribute to one position's weights
without rescaling every other position.

---

## 1. The attribute catalogue

One **flat namespace** across all positions — a position simply ignores the
attributes it does not weight. Generation, scouting, progression and the sim
engine all read this one shape.

Every attribute carries a **`scoutDifficulty` from 0 to 1**. This is the spine
of the fog-of-war system: 0 is combine-measurable, 1 is pure film and
interview.

**Physical — a stopwatch measures these, so scouting error is small**

| key | label | difficulty |
|---|---|---|
| `speed` | Speed | 0.10 |
| `acceleration` | Acceleration | 0.15 |
| `strength` | Strength | 0.15 |
| `agility` | Agility | 0.20 |
| `stamina` | Stamina | 0.40 |
| `durability` | Durability | 0.70 |

**Mental — the fog of war lives here**

| key | label | difficulty |
|---|---|---|
| `football_iq` | Football IQ | 0.85 |
| `awareness` | Awareness | 0.90 |
| `workEthic` | Work Ethic | **0.95** |

**Quarterback**

| key | label | difficulty |
|---|---|---|
| `armStrength` | Arm Strength | 0.10 |
| `accuracy` | Short Accuracy | 0.35 |
| `deepAccuracy` | Deep Accuracy | 0.40 |
| `pocket` | Pocket Presence | 0.80 |
| `decision` | Decision Making | 0.85 |

**Ball carriers and receivers**

| key | label | difficulty |
|---|---|---|
| `elusiveness` | Elusiveness | 0.35 |
| `power` | Contact Balance | 0.35 |
| `catching` | Hands | 0.40 |
| `contested` | Contested Catch | 0.45 |
| `carrying` | Ball Security | 0.50 |
| `release` | Release | 0.55 |
| `route` | Route Running | 0.60 |
| `vision` | Vision | 0.75 |

**Blocking** — `runBlock` 0.45, `passBlock` 0.50, `footwork` 0.50

**Front seven** — `passRush` 0.40, `pursuit` 0.40, `tackling` 0.40,
`runStop` 0.45, `blockShed` 0.50

**Secondary** — `press` 0.50, `coverage` (man) 0.60, `ballHawk` 0.65,
`zone` 0.70

**Specialists** — `kickPower` 0.10, `kickAccuracy` 0.30

> **The deliberate asymmetry:** the attributes that decide careers are the
> hardest to scout. Work Ethic is 0.95 and Awareness 0.90 while Speed is 0.10.
> A stopwatch measures the things that matter least. That gap is the entire
> reason scouting is a skill rather than a formality.

---

## 2. Position weights

Weights sum to roughly 1.0 per position. These are the shipped values.

```ts
QB:   { accuracy .20, decision .18, armStrength .14, pocket .12, awareness .12,
        deepAccuracy .11, football_iq .08, speed .05 }
RB:   { speed .18, elusiveness .16, vision .16, acceleration .14, power .14,
        carrying .10, catching .07, passBlock .05 }
WR:   { route .20, catching .20, speed .18, contested .13, release .12,
        acceleration .10, agility .07 }
TE:   { catching .22, route .17, runBlock .16, speed .12, contested .12,
        strength .11, passBlock .10 }
LT:   { passBlock .42, runBlock .22, footwork .18, strength .12, awareness .06 }
LG:   { runBlock .34, passBlock .30, strength .22, footwork .08, awareness .06 }
C:    { runBlock .26, passBlock .26, awareness .20, football_iq .14, strength .14 }
RG:   { runBlock .34, passBlock .30, strength .22, footwork .08, awareness .06 }
RT:   { passBlock .36, runBlock .26, strength .16, footwork .16, awareness .06 }
EDGE: { passRush .36, blockShed .16, speed .14, strength .12, runStop .12, pursuit .10 }
DT:   { runStop .28, strength .24, blockShed .22, passRush .18, pursuit .08 }
```
(LB, CB, S, K, P follow the same shape.)

**Two failures this table has actually produced:**

1. **A position carrying no grade for something it does will produce a lying
   recommendation.** LB carried no run-defence weight at all, so the
   position-change card reported that moving a linebacker to EDGE would
   *improve* his run defence — there was no LB run-defence term to compare
   against. Audit every position for a skill it obviously performs but does not
   weight.

2. **A position whose weights draw on attributes nothing else values sits low
   on any cross-position rating sort, by construction.** Kickers' overall comes
   from kicking attributes on a scale every other position outscores. In a
   1,956-man pool the best kicker ranked **141st** and never appeared on a
   fantasy draft board built as `orderBy: { trueOvr: 'desc' }, take: 60`.
   Clubs opened the season unable to field a lineup. **Never sort a mixed-
   position pool by overall** — sort per position. `SPECIALIST_OVR_PENALTY: 5`
   exists to keep specialists comparable, but no UI sort may depend on it.

---

## 3. The visible bands

One table, used for **both** the card label and the development multiplier, so
the tier the game calls a player is the tier that develops him. They cannot
drift apart because there is one source.

```ts
export const RATING_BANDS = {
  GENERATIONAL: 99,
  SUPERSTAR:    95,
  ELITE:        90,
  STAR:         85,
  QUALITY:      78,   // "Quality Starter"
  STARTER:      70,
  ROTATIONAL:   62,
} as const;            // below 62 = "Depth"
```

`ratingTier(ovr)` returns label, colour class and a mark. Only the top two
steps carry a glyph (◆ Generational, ★ Superstar) so they are legible without
colour vision — a glyph on every row would be noise.

---

## 4. The distribution being targeted

Measured per 224-pick draft class over 2,000 classes. Grade = **potential**,
not current rating.

| tier | grade | per class | ratio vs tier below |
|---|---|---|---|
| Generational | 99 | **1.49** | 0.22× |
| Franchise | 95–98 | 6.83 | 0.46× |
| All-Star | 90–94 | 14.76 | 0.63× |
| Star | 85–89 | 23.28 | 0.49× |
| Day-One | 78–84 | 47.70 | 0.78× |
| Rotational | 70–77 | **61.30** ← mode | — |
| Late-Round | 62–69 | 51.08 | — |
| Deep Sleeper | <62 | 17.56 | — |

**Generational per draft:** 0 in **28%** of classes, 1 in 32%, 1–3 in 63%,
five or more in 4%, ten in 0.1%.

Before tuning it produced **22.11** Generational per class, at least five in
*every* class and ten or more in 97% of them — which destroys the meaning of
the label. The mode must sit in the Rotational band.

An average active roster player lands in the **70–78** band. A randomly chosen
pro is a Starter; a good one is a Star; Elite is rare enough that the label
carries weight.

**Two tiers still miss target by more than 20%, and the cause is not the
ceiling curve:** the drafted `trueOvr` roll is itself clamped, piling ~6.7
prospects per class onto exactly `DRAFT_OVR_MAX` (88), and those men are most
of the Franchise tier. That is a rookie-ratings problem, not a ceiling problem.

---

## 5. Potential is an asymptote, never a cap

```
potBonus  = max(0, normal(BONUS_MEAN, BONUS_SD)) × ageDamp
ageDamp   = clamp((30 − age) / 8, 0, 1)
potential = clamp(round(softCeiling(trueOvr, potBonus)), trueOvr, 99)
```

```
potential = CEILING − (CEILING−KNEE) · exp(−(raw−KNEE) / (CEILING−KNEE))

POTENTIAL_SOFT_KNEE: 97.5
POTENTIAL_CEILING:   99
```

Everything below the knee is untouched; above it the excess is compressed
toward the ceiling. The span doubles as the decay scale, so the curve is
C1-continuous at the knee and each further point of roll buys strictly less
than the one before. The `clamp` to 99 is a guard that can no longer bind —
the curve's asymptote *is* 99. The lower bound stays, because a ceiling below
a man's current rating is not a ceiling.

**Why a curve and not a cap.** A hard cap makes the most extreme outcome the
*most common* value at that end:

| grade | before | after |
|---|---|---|
| 99 | **6.491%** (6.80× the step below) | **0.388%** (0.91×) |
| 98 | 0.954% | 0.425% |
| 97 | 1.060% | 0.369% |

A low knee does not fix a wall, it moves it: compressing everything over 91
dropped the pile from 99 onto 95–98 and left more Franchise prospects than
there had been Star prospects. **The knee is high and the roll above it is
small on purpose.**

Generation constants:

| | veteran pool | rookie intake |
|---|---|---|
| `POTENTIAL_BONUS_MEAN` | 8 | 12 |
| `POTENTIAL_BONUS_SD` | 7 | 3.5 |
| `ATTR_SD` | 7 | 7 |
| `ROOKIE_AGE_MEAN` | — | 22 |
| `AGE_MIN` / `AGE_MAX` | 21 / 36 | — |

> **The narrow rookie SD is the part to watch.** 12 ± 3.5 makes a ceiling
> highly predictable from current rating, which is upside the draft no longer
> sells. **Scouting error carries draft uncertainty instead** (§8), and the two
> are unrelated. Widening the SD requires re-checking the top of the tier table.

**Build potential on the finished rating, not the generation target.** The
rating a player carries is `computeOverall` of his attributes, which lands a
point or two clear of the target when the attribute nudge cannot close the gap
— rolling the ceiling off the target wrote men with ceilings *below* their own
current rating. Rare (2 in 120,000) and free to avoid by ordering the code
correctly.

Other generation constants: `ROSTER_OVR_FLOOR: 56`, `DEPTH_DECAY_MAX: 13`,
`DEPTH_DECAY_TAU: 2.0`, `DEPTH_DECAY_JITTER: 0.25`, `SPECIALIST_OVR_PENALTY: 5`.

---

## 6. The age curve

```ts
export const AGE_CURVE = [
  { maxAge: 23, growth:  3.2 },
  { maxAge: 25, growth:  2.0 },
  { maxAge: 27, growth:  0.9 },
  { maxAge: 29, growth:  0.0 },
  { maxAge: 31, growth: -1.6 },
  { maxAge: 33, growth: -3.0 },
  { maxAge: 99, growth: -5.0 },
];
```

Position-aware via `peakShift` (shifts where a player sits on the curve) and
`declineMult` (applied **only when growth is negative**):

```ts
RB: { peakShift: -2, declineMult: 1.35 }   // burns out early and fast
WR: { peakShift: -1, declineMult: 1.15 }
CB: { peakShift: -1, declineMult: 1.15 }
S:  { peakShift: -1, declineMult: 1.10 }
QB: { peakShift:  3, declineMult: 0.60 }   // peaks late, declines gently
OL: { peakShift:  2, declineMult: 0.75 }   // LT/LG/C/RG/RT
K:  { peakShift:  4, declineMult: 0.50 }
P:  { peakShift:  4, declineMult: 0.50 }
```

Measured over one full season of growth:

| age | WR | CB | QB | K |
|---|---|---|---|---|
| 26 | +1.12 | +1.13 | +3.90 | +4.01 |
| 30 | −1.14 | −1.12 | +1.10 | +1.15 |
| 34 | **−3.50** | **−3.40** | −0.56 | −0.42 |
| 36 | −3.30 | −3.56 | −1.10 | −0.85 |

A 34-year-old corner is a wasting asset; a 34-year-old quarterback mostly is
not. This one table produces that whole narrative.

---

## 7. What moves a rating

### 7a. Potential tier multiplier

```ts
POTENTIAL_TIER_GROWTH: {
  GENERATIONAL: 1.45,   // ceiling 99 — gets there quickest
  FRANCHISE:    1.30,   // 95–98
  ALL_STAR:     1.18,   // 90–94
  STAR:         1.08,   // 85–89
  BASE:         1.00,   // everyone else, unchanged
}
```

Keyed on the **same `RATING_BANDS` the card is labelled from**. A bonus, never
a tax: everybody below Star develops at exactly the rate they always did.

> **This must apply to growth only, never to decline.** `growthMean` goes
> negative past a player's peak, and multiplying a negative by 1.45 would make
> the best players in the league fall apart fastest. **This codebase has
> shipped that exact sign error four times in other guises.** `progressPlayer`
> guards it explicitly.
>
> A step at a band edge is safe here in a way a clamp never is: potential is a
> fixed property of one man, so this shifts individuals between ladders rather
> than piling a distribution against a wall.

### 7b. Development trait

```ts
DEV_TRAIT_WEIGHTS: { Slow: 0.25, Normal: 0.55, Star: 0.15, Superstar: 0.05 }
DEV_TRAIT_MULT:    { Slow: 0.60, Normal: 1.00, Star: 1.50, Superstar: 2.10 }
```

### 7c. The development arc — the hidden bust mechanic

```ts
export function developmentArc(playerId: string): number {
  const r = new Rng(`dev-arc-${playerId}`);          // its own seeded stream
  return r.float(0, 1) < DEV_ARC_BUST_ODDS
    ? r.normal(DEV_ARC_BUST_MEAN, DEV_ARC_BUST_SD)
    : r.normal(1, DEV_ARC_SD);
}

DEV_ARC_SD: 0.3   DEV_ARC_BUST_ODDS: 0.16
DEV_ARC_BUST_MEAN: -0.9   DEV_ARC_BUST_SD: 0.55
```

**16% of players draw a failing arc with mean −0.9 — they get *worse*, not
merely static.** A pure function of the player id: never stored, never shown,
never buyable, identical on every replay of a save and in every process that
opens it.

It has **its own seeded stream** so that adding another roll to that file later
cannot reshuffle the arcs already live in people's leagues. That is a real
migration hazard, not a theoretical one.

### 7d. In-season evidence

Growth lands at checkpoints through the season rather than one offseason lump —
spread across a season the total is the same as the old single roll. Each
checkpoint:

1. applies a scaled-down age-curve growth roll;
2. nudges it by how the player is performing **against others at his own
   position this year**;
3. hands a deliberate bump — to rating *and* ceiling — to whoever is pacing the
   league in a marquee stat category, with a news item marking it;
4. slows the roll for a man who is not playing (`roleIndex`,
   `PLAYTIME_GROWTH_SCALE: 0.55`). This is the only thing playing time is
   allowed to do;
5. **once a year**, at the last regular-season checkpoint, revises the
   **ceiling itself** — up for a man producing past his rating, down for one
   producing under it.

> Before (5) existed, a ceiling was write-once-upward and **a player could
> therefore never bust.** A ceiling must be a claim that gets tested, not a
> guarantee banked.

Season awards apply the same kind of bump at a larger size once the year ends.

---

## 8. Fog of war — three tiers, and the middle one is not fog

| | current rating | ceiling |
|---|---|---|
| **Your own roster** | exact | **exact** |
| **Other clubs' pros** | exact | **±5, flat and permanent** |
| **Draft prospects** | fogged | fogged, narrows with scouting |

The middle row never moves — not with confidence, not with a scouting report,
not with a Dynasty rank, not with the calendar. It is not a confidence
interval; it is the statement that *you know your own players' ceilings because
you coach them every day, and you do not know another club's because you do
not.* Threading confidence into it would reintroduce exactly the machinery that
was removed.

### Scouting error

Two components that shrink together:

```ts
SCOUT_FOG = {
  BIAS_SD_MAX: 6.0,   // correlated per-player read error at 0 confidence
  BIAS_SD_MIN: 0.3,   // at 100 confidence — never 0; a complete file is still a human's
  BIAS_CURVE:  0.7,   // convergence exponent, matched to observationSd's
};
```

**The band must be honest.** An early version printed a ±12.73 band around a
centre that was off by only sd 3.90 — covering the truth 99.8% of the time.
That is not a confidence interval, it is a guarantee, and it makes scouting
worthless. After tuning, over the same 150 classes: cold error sd **6.27**,
band/error **2.02**, coverage **96.6%**, and the scouting tree buys **0.18** of
rank correlation instead of 0.08. The band did not widen — the error narrowed.

**Measure the band against the error. Coverage above ~97% means the band is too
wide and the scouting system is decorative.**

Known gap: `observe()` has no bias term, so scouting error is symmetric noise
rather than some clubs being systematically optimistic. There is no "this scout
always overrates" pattern to learn yet.

---

## 9. The invariants, and the bugs they prevent

Each is a real bug that shipped here.

1. **A displayed number must be the number the system used.** Six separate
   "lying metric" bugs, including a trade cap gate that *enforced* one figure
   while four screens quoted another. If two places need the same value,
   extract one function.
2. **A comment describing a policy the code no longer follows is as much a bug
   as a wrong number.** Several of the above were found by reading a comment
   that contradicted the code beside it.
3. **Never clamp a distribution** — use a soft bound. Seven walls removed.
4. **Never multiply a decline by a growth bonus.** Four occurrences.
5. **Never sort a mixed-position pool by overall.** Lost an entire position
   from every fantasy draft board.
6. **A ceiling must be revisable downward**, or nobody can bust.
7. **Give each random roll its own seeded stream**, keyed by entity id, so new
   rolls cannot reshuffle existing saves.
8. **Build derived values on the finished value, not the target.**
9. **One table for the label and the behaviour** — the tier a card shows is the
   tier that develops the player.

---

## 10. Verification

`npm run sim:health` plus the per-system invariant suites
(`check:money`, `check:cap`, `audit:actions`). Build the soak harness first,
not last — it found defects no amount of code reading did.

Generate many leagues across the settings matrix, simulate 10+ seasons each,
and assert after every phase transition:

- the **tier distribution** still matches §4 — this is the one that drifts;
- no NaN, no Infinity, no rating outside its band, no negative age;
- **no pile-up at any band edge** — print the histogram around every threshold
  and look for a spike, the signature of a clamp nobody knew was there;
- no ceiling below its own player's current rating;
- mean and sd of starter rating by season, to catch league-wide inflation or
  collapse over a decade;
- awards go to plausible positions — MVP had **never** been a receiver, and
  nobody noticed until it was measured.

**Probe discipline, mandatory.** Every probe carries three canaries:
**(A)** an assertion of a knowingly FALSE claim, which must fail;
**(B)** a read of a deliberately MISSPELLED field, which must come back
undefined; **(C)** a real read that passes. If (A) passes or (B) returns data,
the probe is measuring nothing. A probe here once read `stats.receptions` when
the field was `rec` and reported 28,534 samples of 0.0000.

Never sample with `orderBy: { trueOvr: 'desc' }, take: N`. Sample blind.

**Prove an engine change is the change it claims:** re-sim a fixed seed before
and after and fingerprint the output. A kicker-progression change was verified
this way — 400 fixed-seed games hashing to `131909624` on both sides, proving
the engine had not moved.
