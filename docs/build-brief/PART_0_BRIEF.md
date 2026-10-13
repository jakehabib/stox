# Dynasty GM Football — Build Brief

A complete specification for rebuilding **Dynasty GM Football**, a
single-player NFL front-office simulator, to **1:1 feature parity**.

The reference implementation is live at **dynastygm.gg**: Next.js 14,
TypeScript, Tailwind, Prisma + Postgres, deployed on Vercel. Roughly **58,000
lines of game logic** across 97 modules, **159 components**, **39 routes**, and
a **27-model** schema, built and tuned over a long run of measured iteration.

---

## 0. What "1:1" means here, and what it does not

**It means every feature, every rule and every number.** If the reference game
lets a GM convert base salary to signing bonus with a slider capped at the
league minimum, so does yours, with the same cap and the same arithmetic. If
its draft board ranks a prospect's athleticism within his own position group
rather than across the class, so does yours.

**It does not mean the same code.** This brief specifies *behaviour,
contracts, constants and invariants*. Write it in whatever stack you like. The
parts that follow give you the rules and — more valuable — **the reasons**,
because almost every number in this game is what it is after a measurement
proved the obvious value wrong.

**The single most valuable thing in this brief is the failure record.** Dozens
of real bugs are documented with their cause. Each one is a trap you can step
around for free that cost this project real time to find.

---

## 1. The game, in one page

You are the general manager of one NFL club, for as long as you can keep the
job. There is no on-field play-calling: you build the roster and the season
plays itself out.

**The loop.** Advance time, week by week or in jumps. Games simulate from your
depth chart. Players develop, age, get injured and retire. Between seasons you
re-sign your own expiring players, spend in free agency, scout and work out
draft prospects, run your draft, manage a salary cap across multiple future
years, and trade with 31 AI clubs that each have their own competitive window
and temperament.

**What makes it hold attention** — the design intent, in the owner's words,
is *"a universe the player can get lost in"*:

- **Consequence that outlives the season.** A restructure frees money now and
  makes every later year dearer; dead money follows a player you cut for
  years. The cap page shows four seasons at once because that is the real
  horizon.
- **Genuine uncertainty.** You do not know a prospect's ceiling. You know your
  own players' ceilings exactly, other clubs' within ±5, and a draft prospect's
  only as a band that narrows as you spend scouting on him.
- **A world with memory.** League news, franchise history, trade
  retrospectives that grade deals by how the return has held up, a ring of
  honour, award histories, and a GM career page that tells you what you are
  known for.
- **Explainable AI.** When a club refuses a trade it says why, in its own
  words, with the factors that drove it.

**What it is not.** Not multiplayer. Not a play-caller. Not a card-collecting
or monetised game. One save, one club, one career.

---

## 2. How to use this brief

| part | covers |
|---|---|
| **0** (this document) | framing, standards, verification, acceptance, build order |
| **1** | stack, deployment, the 27-model data model, accounts and ownership, league creation and settings |
| **2** | the phase machine, advancing time, the game simulation, statistics, standings and playoffs, awards, progression and aging, the soak test |
| **3** | the salary cap, contracts, dead money, every money mutation, free agency and negotiation, trades, the money invariant suite |
| **4** | player generation, positions and depth chart, roster management, scouting, the draft, the combine as a signal, the GM's own career, fantasy draft |
| **5** | all 39 routes specified, cross-cutting UI, the design system, the motion and legibility rules |
| **`RATING_SYSTEM_SPEC.md`** (repo root) | the rating layer in full — attributes, position weights, bands, the distribution, potential, the age curve, fog of war |

Read Part 0 and the rating spec first. They are the two documents that change
how you read everything else.

---

## 3. The standard this project holds

These are not style preferences. Each is a rule written after a failure.

### 3.1 A displayed number must be the number the system used

**The most expensive recurring bug class in this project — six shipped.** A
screen computes a figure a second way "just for display", the two derivations
drift, and the game tells the player something it is not doing.

The worst was not even cosmetic: a trade function reported what a contract
would cost the acquiring club, and *the same function backed the cap gate*. It
subtracted a flat proration past the window where proration applies, so a
$5.50M contract read as **freeing** $80K. A club with $4M of room could be
handed a $7.9M contract with nothing refusing it.

> **The rule: if two places need the same figure, extract one function.** Never
> two derivations of one number.

### 3.2 A stale comment is a bug

A comment describing a policy the code no longer follows is as wrong as a bad
number, and several real bugs here were found by reading a comment that
contradicted the code beside it. One file called `capChargeYear` correctly on
line 835 and passed the raw season year on line 1458.

When you change behaviour, change the comment in the same commit.

### 3.3 Never clamp a distribution

**A hard clamp makes the most extreme outcome the most *common* value at that
end.** Seven such walls were found and removed. The signature is a spike in the
histogram exactly at the bound.

Potential grade 99 was 6.49% of the pool — 6.80× the step below it. Replacing
the cap with a soft asymptotic curve took it to 0.388%, at 0.91× the step
below. Nothing is forbidden; extremes are just properly rare.

Use a soft bound (`softBound(v, mean, sd, lo, hi, core)` — untouched within
`core` standard deviations, then `tanh`-compressed toward the bound, never
reaching it). **Print the histogram around every threshold and look for a
spike.**

### 3.4 Never multiply a decline by a growth bonus

Shipped **four times** in different guises. Growth goes negative past a
player's peak; multiplying a negative by a 1.45 "elite development" bonus makes
the best players in the league fall apart fastest. Guard every multiplier that
can meet a negative.

### 3.5 Never sort a mixed-position pool by overall

A kicker's rating is computed from kicking attributes on a scale every other
position outscores, so **kickers sit at the bottom of any league-wide sort by
construction**. A draft board built as `orderBy: overall desc, take: 60` meant
that in a 1,956-man pool the best kicker ranked **141st** and never appeared.
Clubs opened the season unable to field a lineup. Sort per position.

### 3.6 A Server Action is a public POST endpoint

The UI is not the only thing that can call it. Checking that the *league*
belongs to the caller is not enough: **every id arriving beside it must be
proven to belong to that league.** Six actions once let one player read another
player's roster, cap sheet and internal valuations — and one of them *wrote*
into the victim's save. A league id is not a secret; it is in every URL.

Validate every enum against a whitelist rather than casting. Clamp every
number server-side. Assume hostile input on every action.

### 3.7 Text is front-office voice, never tutorial voice

*"Any text should be useful and informative, but not immersion breaking to the
player as an explainer."* No "click here", no "welcome to", no exclamation
marks. A refusal names what actually blocked it, in the game's own words — a
raw database error reaching the player is a bug.

### 3.8 Length is not clutter; duplication is

Do not shorten a page because it is long. Do remove a figure printed twice on
one screen. A tooltip explaining a number that explains itself is clutter.

### 3.9 Seed every random stream separately

Each roll gets its own stream keyed by entity id (`dev-arc-${playerId}`), so
adding a new roll later cannot reshuffle outcomes already live in people's
saves. This is a real migration hazard.

### 3.10 Animation never gates input or delays information

Final values render at frame one; only decoration moves. **There are no
count-ups anywhere.** Reduced motion loses the movement, never the information.

---

## 4. The verification recipe

Build these **before** the systems they check, not after. In the reference
implementation every one of them found defects that code review did not.

| command | what it proves |
|---|---|
| `sim:health` | leagues across the settings matrix survive 10+ seasons with every invariant holding |
| `check:money` | money conservation — 8,969 assertions across composed mutation sequences |
| `check:cap` | the whole contract-rules family in order |
| `audit:actions` | every Server Action refuses a foreign id and hostile input |

### 4.1 Probe discipline — mandatory

This project has shipped probes that measured nothing. One read
`stats.receptions` where the field was `rec` and cheerfully reported **28,534
samples of 0.0000**.

**Every probe carries three canaries:**

- **(A)** an assertion of a knowingly **false** claim — it must **fail**
- **(B)** a read of a deliberately **misspelled** field — it must come back
  `undefined`
- **(C)** a real read that **passes**

If (A) passes or (B) returns data, your probe is measuring nothing. Fail the
whole run when a canary misbehaves.

**Never sample with `orderBy: { rating: 'desc' }, take: N`.** Sample blind.

### 4.2 Prove a change is the change

Re-run a fixed seed before and after and fingerprint the output. A kicker
progression change was verified this way: 400 fixed-seed games hashing to
`131909624` on both sides, proving the engine had not moved.

### 4.3 The discovery test

The action audit **discovers its own surface** — it reads every exported action
out of the source, and one with no test case is a **failure, not a skip**. So
the next unguarded action fails on the day it is added. Build at least one test
this way; a test that only checks what you remembered to list rots immediately.

### 4.4 Prove the test can fail

Before trusting any sweep, break something deliberately and confirm it reports
the failure. The contrast sweep was validated by setting a colour token to a
bad value and watching one page go from 0 to 305 failures. An audit that has
never failed is not evidence.

---

## 5. Acceptance criteria for 1:1

Parity is checkable. Work through it:

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
7. **Legibility.** Zero text below 4.5:1 against its true composited
   background, at desktop and at 390px, with no horizontal page scroll.
8. **The new-user path.** Sign up, create a league in every mode, and play the
   first season with no dead end, no 500, and no empty state that reads like an
   error rather than an answer.

---

## 6. Build order

Dependencies, not preference:

1. **Data model and auth** (Part 1). Everything reads from it.
2. **Ratings and generation** (rating spec, Part 4 §1). Every other system
   consumes ratings; getting the distribution wrong late is expensive.
3. **The soak harness** (Part 2 §8). Before the engine, so it can watch the
   engine arrive.
4. **The phase machine and the game simulation** (Part 2).
5. **Money** (Part 3) with its invariant suite built alongside, not after.
6. **Roster, scouting and the draft** (Part 4).
7. **Screens** (Part 5) — last, because they read everything above.
8. **The action audit** (§4.3) as soon as the second mutation exists.

A caution from experience: the reference implementation built most of its test
harnesses late, and each one immediately found defects that had been live for
months. Build them early and you will not pay that bill.

---

## 7. Known open issues in the reference implementation

Inherited honestly, so you can decide for yourself:

- **MVP has never been a receiver** and DPOY never an edge rusher — the award
  selection is structurally biased toward certain positions.
- **`observe()` has no bias term**, so scouting error is symmetric noise rather
  than some clubs being systematically optimistic. There is no "this scout
  always overrates" pattern to learn.
- **Kickers and punters are priced identically** in trade value despite a
  kicker being worth roughly 7× the punter on the field and 45% more in salary.
- **Trade retrospectives compare a pick's price *then* against a player's price
  *now*** — two different scales, mismatched about 3× at every slot, which
  structurally grades every pick trade against whoever acquired the pick.
- **Kicking has no stat-leader category**, so a kicker never receives that
  milestone bump.
- **An intermittent race in the live draft**: two concurrent AI pick runners can
  both read the current pick and the loser throws. The weekly advance takes a
  lease to prevent exactly this; the draft runner does not.
- **Re-sign transactions are stamped with a week that never happened**, which
  mis-orders the league news feed.
- **Rookie scale**: both ends are right and the middle is wrong.
- **Fantasy draft pool** is roughly a league and a half of talent.
