# Build Dynasty GM Football

You are building a single-player NFL front-office simulator to 1:1 feature
parity with an existing game. This prompt and the five parts beside it are your
specification. Work through them in the build order in §6.

The reference implementation is live at **dynastygm.gg**: Next.js 14,
TypeScript, Tailwind, Prisma + Postgres, on Vercel — roughly **58,000 lines of
game logic** across 97 modules, **159 components**, **39 routes**, a
**27-model** schema. It was built and tuned over a long run of measured
iteration, and most of the numbers you are given are what they are because a
measurement proved the obvious value wrong.

---

## 0. Build every feature, every rule and every number

Match the behaviour exactly. If the reference game lets a GM convert base
salary to signing bonus with a slider capped at the league minimum, build that
cap and that arithmetic. If its draft board ranks a prospect's athleticism
within his own position group rather than across the class, rank it that way.

**Do not match the code.** These parts specify behaviour, contracts, constants
and invariants. Use whatever stack you like.

**Read the reasons, not just the rules.** Where a part explains why a constant
is what it is, that explanation is load-bearing: it is what stops you from
rounding 1.18 to 1.2 because it looked arbitrary. Where a part documents a bug
and its cause, you are being handed a trap to step around for free that cost
this project real time to find. Those failure records are the most valuable
thing here.

---

## 1. What you are building

The player is the general manager of one NFL club, for as long as they can keep
the job. There is no on-field play-calling: they build the roster and the
season plays itself out.

**The loop.** The player advances time, week by week or in jumps. Games
simulate from the depth chart. Players develop, age, get injured and retire.
Between seasons the player re-signs their own expiring players, spends in free
agency, scouts and works out draft prospects, runs their draft, manages a
salary cap across multiple future years, and trades with 31 AI clubs that each
have their own competitive window and temperament.

**Hold the player's attention through four things.** The design intent, in the
owner's words, is *"a universe the player can get lost in"*. Build toward that:

- **Consequence that outlives the season.** A restructure frees money now and
  makes every later year dearer; dead money follows a player who was cut for
  years afterward. Show four seasons on the cap page at once, because that is
  the real horizon.
- **Genuine uncertainty.** The player must not know a prospect's ceiling. They
  know their own players' ceilings exactly, other clubs' within ±5, and a
  draft prospect's only as a band that narrows as they spend scouting on him.
- **A world with memory.** Build league news, franchise history, trade
  retrospectives that grade deals by how the return has held up, a ring of
  honour, award histories, and a GM career page that tells the player what they
  are known for.
- **Explainable AI.** When a club refuses a trade, have it say why, in its own
  words, naming the factors that drove the refusal.

**Do not build** multiplayer, play-calling, card collecting, or monetisation.
One save, one club, one career.

---

## 2. Your specification

| part | what to build from it |
|---|---|
| **0** (this file) | the standard to hold, how to verify, what counts as done, what order to build in |
| **1** | stack, deployment, the 27-model data model, accounts and ownership, league creation and settings |
| **2** | the phase machine, advancing time, the game simulation, statistics, standings and playoffs, awards, progression and aging, the soak test |
| **3** | the salary cap, contracts, dead money, every money mutation, free agency and negotiation, trades, the money invariant suite |
| **4** | player generation, positions and depth chart, roster management, scouting, the draft, the combine as a signal, the GM's own career, fantasy draft |
| **5** | all 39 routes, cross-cutting UI, the design system, the motion and legibility rules |
| **`RATING_SYSTEM_SPEC.md`** (repo root) | the rating layer in full — attributes, position weights, bands, the distribution, potential, the age curve, fog of war |

Read this file and the rating spec before the others. They change how you read
everything else.

---

## 3. Hold this standard

Each of these is a rule written after a specific failure. Follow them from the
first commit; every one of them is cheaper to obey than to retrofit.

### 3.1 Display the number the system actually used

**This is the most expensive recurring bug class in this project — six
shipped.** A screen computes a figure a second way "just for display", the two
derivations drift, and the game tells the player something it is not doing.

The worst was not cosmetic. A trade function reported what a contract would
cost the acquiring club, and *the same function backed the cap gate*. It
subtracted a flat proration past the window where proration applies, so a
$5.50M contract read as **freeing** $80K — and a club with $4M of room could be
handed a $7.9M contract with nothing refusing it.

**So: when two places need the same figure, extract one function and call it
twice.** Never write a second derivation of a number that already exists.

### 3.2 Change the comment in the same commit as the behaviour

A comment describing a policy the code no longer follows is as wrong as a bad
number. Several real bugs here were found by reading a comment that contradicted
the code beside it — one file called `capChargeYear` correctly on line 835 and
passed the raw season year on line 1458.

### 3.3 Never clamp a distribution

**A hard clamp makes the most extreme outcome the most *common* value at that
end.** Seven such walls were found and removed from this project. The signature
is a spike in the histogram exactly at the bound.

Potential grade 99 was 6.49% of the pool — 6.80× the step below it. Replacing
the cap with a soft asymptotic curve took it to 0.388%, at 0.91× the step
below. Nothing became forbidden; extremes became properly rare.

Bound values softly instead: untouched within `core` standard deviations of the
mean, then `tanh`-compressed toward the bound, never reaching it. Implement it
once as a shared helper and use it everywhere you need a limit.

**Print the histogram around every threshold you introduce and look for a
spike.**

### 3.4 Guard every multiplier that can meet a negative

This shipped **four times** in different guises. Growth goes negative past a
player's peak, so multiplying it by a 1.45 "elite development" bonus makes the
best players in the league fall apart fastest.

### 3.5 Never sort a mixed-position pool by overall

A kicker's rating is computed from kicking attributes on a scale every other
position outscores, so **kickers sit at the bottom of any league-wide sort by
construction**. A draft board built as `orderBy: overall desc, take: 60` meant
that in a 1,956-man pool the best kicker ranked **141st** and never appeared —
and clubs opened the season unable to field a lineup. Sort within position.

### 3.6 Treat every mutation as a public POST endpoint

The UI is not the only thing that can call it. Checking that the *league*
belongs to the caller is not enough: **prove every id arriving beside it
belongs to that league.** Six actions in the reference implementation once let
one player read another player's roster, cap sheet and internal valuations —
and one of them *wrote* into the victim's save. A league id is not a secret; it
is in every URL.

Validate every enum against a whitelist rather than casting it. Clamp every
number server-side. Assume hostile input everywhere.

### 3.7 Write in front-office voice, never tutorial voice

*"Any text should be useful and informative, but not immersion breaking to the
player as an explainer."* No "click here", no "welcome to", no exclamation
marks. When something is refused, name what actually blocked it in the game's
own words — a raw database error reaching the player is a bug.

### 3.8 Remove duplication, not length

Do not shorten a page because it is long. Do remove a figure printed twice on
one screen, and a tooltip explaining a number that explains itself.

### 3.9 Seed every random stream separately

Key each roll's stream to the entity it concerns (`dev-arc-${playerId}`), so
that adding a new roll later cannot reshuffle outcomes already live in people's
saves. This is a real migration hazard, not a theoretical one.

### 3.10 Never let animation gate input or delay information

Render final values at frame one; move only decoration. **Build no count-ups
anywhere.** Under reduced motion, lose the movement and never the information.

---

## 4. Verify it this way

Build these four harnesses **before** the systems they check. In the reference
implementation every one of them found defects that code review did not.

| harness | what it must prove |
|---|---|
| `sim:health` | leagues across the settings matrix survive 10+ seasons with every invariant holding |
| `check:money` | money conservation — the reference suite runs 8,969 assertions across composed mutation sequences |
| `check:cap` | the whole contract-rules family, in order |
| `audit:actions` | every mutation refuses a foreign id and hostile input |

### 4.1 Put three canaries in every probe

This project has shipped probes that measured nothing. One read
`stats.receptions` where the field was `rec`, and cheerfully reported **28,534
samples of 0.0000**.

Every probe you write carries:

- **(A)** an assertion of a knowingly **false** claim — it must **fail**
- **(B)** a read of a deliberately **misspelled** field — it must come back
  `undefined`
- **(C)** a real read that **passes**

If (A) passes or (B) returns data, your probe is measuring nothing — fail the
whole run when a canary misbehaves.

**Never sample with `orderBy: { rating: 'desc' }, take: N`.** Sample blind.

### 4.2 Prove your change is the only change

Run a fixed seed before and after, and fingerprint the output. A kicker
progression change was verified this way: 400 fixed-seed games hashing to
`131909624` on both sides, proving the engine itself had not moved.

### 4.3 Make at least one test discover its own surface

Have the action audit read every exported mutation out of the source, and treat
one with no test case as a **failure, not a skip** — so the next unguarded
action fails on the day it is added. A test that only checks what you remembered
to list rots immediately.

### 4.4 Prove each test can fail before you trust it

Break something deliberately and confirm the test reports it. The contrast
sweep was validated by setting a colour token to a bad value and watching one
page go from 0 to 305 failures. An audit that has never failed is not evidence.

---

## 5. You are done when all eight hold

1. **Route inventory.** Every route in Part 5 exists, with the same panels and
   controls, and the same behaviour in every league phase.
2. **The settings matrix.** A league can be created with every combination in
   Part 1 and plays correctly — including fantasy draft, cap off, and ironman.
3. **The soak passes.** 10+ seasons across the matrix with every invariant in
   Part 2 holding.
4. **Money conserves.** Part 3's suite passes, including composed sequences.
5. **The distribution matches.** The tier table in the rating spec reproduces
   within tolerance, with no spike at any band edge.
6. **Authorization holds.** Every mutation refuses a foreign id and hostile
   input.
7. **Legibility.** No text below 4.5:1 against its true composited background,
   at desktop and at 390px, with no horizontal page scroll.
8. **The new-user path.** Sign up, create a league in every mode, and play the
   first season with no dead end, no 500, and no empty state that reads like an
   error rather than an answer.

---

## 6. Build in this order

These are dependencies, not preferences:

1. **Data model and auth** (Part 1). Everything reads from it.
2. **Ratings and generation** (rating spec, Part 4 §1). Every other system
   consumes ratings, and fixing the distribution late is expensive.
3. **The soak harness** (Part 2 §8) — before the engine, so it can watch the
   engine arrive.
4. **The phase machine and the game simulation** (Part 2).
5. **Money** (Part 3), with its invariant suite built alongside, not after.
6. **Roster, scouting and the draft** (Part 4).
7. **Screens** (Part 5), last, because they read everything above.
8. **The action audit** (§4.3), as soon as the second mutation exists.

The reference implementation built most of its harnesses late, and each one
immediately found defects that had been live for months. Build them early and
you will not pay that bill.

---

## 7. Decide these for yourself — they are still open here

These are unresolved in the reference implementation. Match them or fix them,
but decide deliberately rather than inheriting them by accident:

- **MVP has never been a receiver** and DPOY never an edge rusher. The award
  selection is structurally biased toward certain positions.
- **`observe()` has no bias term**, so scouting error is symmetric noise rather
  than some clubs being systematically optimistic. There is no "this scout
  always overrates" pattern for the player to learn.
- **Kickers and punters are priced identically** in trade value, despite a
  kicker being worth roughly 7× the punter on the field and 45% more in salary.
- **Trade retrospectives compare a pick's price *then* against a player's price
  *now*** — two different scales, mismatched about 3× at every slot, which
  structurally grades every pick trade against whoever acquired the pick.
- **Kicking has no stat-leader category**, so a kicker never receives that
  milestone bump.
- **The live draft has an intermittent race**: two concurrent AI pick runners
  can both read the current pick, and the loser throws. The weekly advance
  takes a lease to prevent exactly this; the draft runner does not. Take a
  lease in both.
- **Re-sign transactions are stamped with a week that never happened**, which
  mis-orders the league news feed.
- **The rookie scale** is right at both ends and wrong in the middle.
- **The fantasy draft pool** holds roughly a league and a half of talent.
