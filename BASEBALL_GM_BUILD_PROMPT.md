# Dynasty GM Baseball — Complete Build Specification

**This document is the brief. You are the agent building the game.**

You have no memory of the conversation that produced this file and you do not
need one. Everything you need is here: the codebase you are merging into, the
standard it holds, the design of the game, the schema, the tuning constants,
the calibration targets, the screens, the copy, the verification harnesses, and
the order to build it in.

**Do not go exploring the football codebase to orient yourself.** Part I is
that orientation, written out. Where you genuinely need to open a football
file, this document names the file and says what to take from it. Every hour
spent re-deriving how this repo works is an hour of the owner's budget spent on
nothing.

**What you are building.** *Dynasty GM Baseball* — a single-player baseball
front-office simulator, a sibling to the football game that already lives in
this repository and ships at **dynastygm.gg**. Thirty fictional clubs, generated
players, no real MLB names or data anywhere. Same Next.js app, same database,
same account, same design system, same standard.

**The acceptance test.** A GM can create a league, run a 162-game season, lose
a wild card series, non-tender a reliever, win an arbitration hearing, promote
a shortstop and cost himself a year of control by doing it in April, trade two
prospects for a rental at the deadline, blow past the luxury tax line, draft a
high-schooler who reaches the majors five years later, and read every one of
those decisions back off a screen that told him the truth about it beforehand.

---

## 0. How to use this document

Read Part I and Part II in full before writing any code — they are short and
they are what stops you building something that does not fit. Then work Part V
(the execution phases) top to bottom, reaching back into Parts III and IV for
the specification of whatever you are currently building.

**Part V's phases each stop cleanly.** A run that ends at a phase boundary
leaves the repository in a state that builds, passes its checks, and ships. The
next run picks up from this document plus the repo and needs nothing else. If
you are resuming, find the last phase marked done in
`docs/baseball/BUILD_LOG.md` (Phase 0 creates it) and start at the next one.

**Where this document gives a number, it is a starting value with a real-world
anchor beside it, not a guess.** Where it gives a rule, it is a decision, and
re-litigating it costs the owner money. Section 34 is the short list of things
genuinely left for him.

---

## Contents

**Part I — The briefing** *(read in full; it replaces exploring the codebase)*
1. What exists, and how to run it · 2. The gotchas · 3. The verification recipe ·
4. **The standard this project holds** — the seven principles, no lying metrics,
canary discipline, measure don't guess, the text rule, the commit voice ·
5. The football architecture in one pass · 6. **Things you cannot infer from the code**

**Part II — The merge** *(do this first; it is the only irreversible part)*
7. The decisions and what was rejected · 8. The shared layer · 9. What a football
save experiences · 10. Migration order

**Part III — The baseball game**
11. The transfer table · 12. The calendar and the phase machine · 13. Positions
and ratings · 14. Player generation · 15. Progression, aging, injury, attrition ·
16. The roster system · 17. **Service time and arbitration** · 18. Money ·
19. Lineup, rotation and bullpen · 20. **The sim engine** · 21. Statistics, and
what you may not ship · 22. The draft and prospect scouting · 23. Trades ·
24. Awards, records, history · 25. The AI GM

**Part IV — The artefacts**
26. **The Prisma schema, written out** · 27. **`lib/baseball/tuning.ts`, written
out** · 28. **Calibration targets** · 29. Invariants and harnesses · 30. The
screens · 31. **Copy — the voice, written out** · 32. File manifest

**Part V — Execution**
33. Phases 0-11, each with its deliverable, verification and stop point

**Part VI — For the app owner**
34. The seven decisions left open

**Appendix**
35. `lib/baseball/types.ts` and `lib/baseball/settings.ts`

---
---

# PART I — THE BRIEFING

*What is already here, how it works, and what it learned. Read this instead of
the codebase.*

## 1. What exists, and how to run it

**Dynasty GM Football.** Next.js 14 (App Router, TypeScript), Tailwind, Prisma
5.22 + Postgres (Neon), deployed on Vercel at **dynastygm.gg**. Every league
route is `force-dynamic`; nothing renders at build time. React 18.3. No test
framework, no state library, no ORM beyond Prisma, four runtime dependencies
total (`@prisma/client`, `next`, `react`, `react-dom`). Keep it that way — the
absence of dependencies is deliberate and is why this app has never had a
supply-chain or version-drift incident.

```bash
service postgresql start            # a wall of 500s is almost always this
cd /home/user/stox
npm install                         # postinstall runs `prisma generate`
npx prisma migrate deploy
npm run dev                         # http://localhost:3001
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/   # expect 200
```

`.env` needs `DATABASE_URL` (pooled) and `DIRECT_URL` (unpooled — Prisma
migrations hold a session open and a transaction-mode pooler cannot, it times
out with P1002). Locally both may be the same string.

`npm run build` is `prisma generate && prisma migrate deploy && next build` —
exactly what Vercel runs.

Scale of the football tree, so you know what you are joining: `lib/` is 43,000
lines across 85 modules, `app/` has 38 routes, `components/ds/` has 70 shared
presentational components, `prisma/schema.prisma` is 1,163 lines and 24 models
across 15 migrations. `README.md` is 3,700 lines and is mostly a changelog.
`GAME_INVARIANTS.md` is 576 lines and holds 23 numbered rules.

## 2. The gotchas that have cost real time

These are not hypotheticals. Each one has burned somebody here.

1. **`npm run build` corrupts a running dev server.** They share `.next`. Stop
   the dev server first, or accept 500s everywhere until you restart it. This
   repo often has more than one agent working in it — **a page that 404s or
   500s for no reason is frequently compile contention on a shared `.next`, not
   a bug in your change.** Re-check before you go hunting.
2. **Every page 500s → check Postgres first.** `service postgresql status`.
   This has looked like a code disaster twice and was the database both times.
3. **A schema change does not reach a running dev server.** `lib/db.ts` caches
   the Prisma client on `globalThis` (so dev hot-reload does not open a pool per
   edit). After `prisma generate`, restart the server. The symptom is
   `Cannot read properties of undefined (reading 'findUnique')`.
4. **`tsc --noEmit` can report clean while a real error exists.** Delete
   `tsconfig.tsbuildinfo` first, every time, before trusting it as a gate.
5. **Never `pkill -f "next dev"`** — it matches the shell running the command
   and kills it. Get the pid from `ps -eo pid,args | grep "next dev"`. Relaunch
   detached: `setsid nohup npx next dev -p 3001 > /tmp/nextdev.log 2>&1 < /dev/null &`
6. **`tsx` does not read `.env`.** Any script you run with `npx tsx` needs the
   connection string exported first:
   `export $(grep -v '^#' .env | grep DATABASE_URL | xargs)`. Put that line in
   the usage comment of every script you write, as the existing ones do.
7. **`next build` type-checks `scripts/**`,** because `tsconfig.json` includes
   `**/*.ts`. A throwaway probe script with a type error fails the production
   build. Either keep probes clean or delete them before building.
8. **`tsc` cannot catch a client/server boundary violation.** Every export of a
   `'use client'` module reaches a Server Component as a *client reference*, not
   as a function. Importing a helper from a client module into a server page
   type-checks, builds, and throws `X is not a function` at request time in
   production. This shipped a 500 to dynastygm.gg. It is why `lib/cap.ts` (pure
   arithmetic, imported by client forms) and `lib/capEnforcement.ts` /
   `lib/leagueYear.ts` (database, server only) are separate modules. **Respect
   the same split in everything you write.**

## 3. The verification recipe

Run this before you call anything done. It is the standing recipe; do not
invent a lighter one.

```bash
# Snapshot into an isolated worktree at HEAD so a half-finished edit elsewhere
# in the tree cannot make your build look broken (or look fine).
git worktree add /tmp/verify HEAD && cd /tmp/verify && npm install

rm -f tsconfig.tsbuildinfo && npx tsc --noEmit     # 0 errors
npm run build                                       # dev server DOWN. exit 0
```

| What | Command | Expect |
|---|---|---|
| Types | `rm -f tsconfig.tsbuildinfo && npx tsc --noEmit` | 0 errors |
| Production build | `npm run build` *(dev server down)* | exit 0 |
| Football invariants | `npm run sim:health` | 0 errors; INV-19/INV-20 warnings are pre-existing |
| Football box score | `npx tsx scripts/checkBoxScore.ts` | exit 0 |
| Baseball invariants | `npm run bb:health` *(you build this — §29)* | 0 errors |
| Baseball box score | `npx tsx scripts/bb/checkBoxScore.ts` *(you build this)* | exit 0 |

**Every screen loads** is a separate check and it is done by looking, not by
reasoning. Chromium is preinstalled at `/opt/pw-browsers` — **do not run
`playwright install`.** Drive it with a throwaway node script, screenshot every
route at 1440x1100, and **read the images back.** Every visual defect this
project has caught was found by looking at a picture: a bolded wrong column, a
permanently-zero stat column, four rows sharing one sentence, a description
overflowing its panel by 83px. Reasoning about markup has never found one.

## 4. The standard this project holds

This is the part a fresh agent will not have and cannot infer. It is why the
football game is good.

### 4.1 The seven design principles (standing, not up for re-litigation)

These came from the app owner directly and they override any local design
argument — including a well-reasoned one. If a change conflicts with something
here, the principle wins and the change is wrong. Quoted from `README.md`:

> **0. THE POINT IS IMMERSION — a universe the player can get lost in.** In the
> owner's words: *"The design philosophy is trying to create a universe the
> player can get lost in. There are stories, careers, etc that need to feel
> like have happened so the player can reach the peak immersion."*
>
> This is the principle the rest of the list serves, so it comes first. It has
> a specific and demanding consequence: **the world must have a past, and the
> past must be legible.** A thirty-year-old on your roster had a career before
> you met him and the game should be able to show it, season by season, club by
> club — not collapse it into a summary row. A franchise has titles, droughts,
> records and rivalries. A season leaves stories behind it. None of that is
> decoration; it is the difference between managing a database and running a
> club.
>
> **And it is the differentiator, not a nice-to-have.** *"No other game has
> something for that armchair quarterback nerd to dive into like this. that's
> why i'm a stickler for the cap and stats to have such depth."* So when depth
> and tidiness conflict on the cap page, the stats page or a player card, depth
> wins — this is the audience the game is FOR.
>
> It also sets the bar for what "not enough data" means. Where the world's
> history is *generated*, generate it in full and **keep** it. The fix for a
> thin-feeling world is almost always to stop discarding what was already
> invented, never to invent a second time on top of a summary.
>
> **1. It must feel like a game, not a spreadsheet.** *"we dont want this to
> just feel like text — the avatars and graphics add SO much to the feel of the
> game."* and *"it needs to be and feel alive."* Information density is not the
> goal. A screen that is nothing but figures has failed, however efficiently it
> packs them.
>
> **2. Avatars, team logos and colour are identity, not ornament.** They are
> what make a name read as a *player* rather than a row key, and a three-letter
> abbreviation read as a *franchise*. Never remove them to save vertical space.
> If a row needs to be taller to carry an identity, the row gets taller.
>
> **3. Rating colour is meaningful above ~80.** *"i also love the rating
> colors. They should be meaningful after ~OVR 80 IMO."* Below that band, stay
> neutral — a 62 and a 74 are both "a guy" and painting them is noise. From ~80
> up, real distinguishable steps so an 81, an 88 and a 94 are apart at a
> glance, climbing toward elite.
>
> **4. Colour is never the only channel.** Every coloured rating step also
> carries a glyph, and adjacent steps must survive a colourblind-separation
> check (`scripts/validate_palette.js` from the `dataviz` skill) — run it,
> don't eyeball it.
>
> **5. A column with the same value on every row carries no information.** The
> "Active" pill on 27 of 28 roster rows and "Unevaluated" on 300 of 300 draft
> rows are noise; the avatar beside them is not. Cutting the former is not
> licence to cut the latter.
>
> **6. No lying metrics.** A number shown to the player must be the number the
> system actually used. This has been a recurring bug class here (a ledger
> reading "Trades 0" beside a tile reading "Trades Made 7"), so it is written
> down: if you display a rank, it must be the rank of the grade you displayed.
>
> The corollary, which principle 0 makes tempting to break: **immersion is
> never a licence to invent a number.** A metric borrowed from the real sport
> must be the real metric or it must not carry the name. EPA is the worked
> example — it is defined per play against down, distance and field position,
> `DriveResult` records none of those, so the game does not ship an "EPA"
> column. What it ships instead is the drive-efficiency family it *can* compute
> honestly. The owner's ruling: *"lets just do what we can reasonably do
> without reinventing the wheel."*
>
> **7. Every page gets decluttered, and length is not the same as clutter.**
> *"We still want it decluttered — as with EVERY page on our game."* What gets
> cut is **a second reading of a fact already on the screen**, **a panel that
> reports nothing** and **anything with no job on the page it is on**. What
> does NOT get cut is depth: *"I would rather have a lot of really cool data on
> GM career across 2 or 3 tabs rather than minimal on one tab to save room."*
> **Height is a signal, not a target** — ask whether a page is long because it
> is rich or long because it repeats itself, and only the second is a defect.
> Tabs are the tool that resolves the two, switched with client state and never
> a URL, because both panes are already server-rendered when the page paints.

**Principle 6 has a baseball-specific edge and you will hit it in week one.**
See §21: WAR, and why you may not ship it.

### 4.2 No lying metrics — the operational version

A comment describing a policy the code no longer follows is as wrong as a bad
number, and has cost this project as much. Four comments were found asserting
cleanups that never landed; one of them hid a twelve-man defence for months.

When you add any figure to any screen, ask: **what would have to be true for
this to be wrong?** The recurring shapes, all of which have shipped here:

- Two renderers of the same fact, only one of which got fixed.
- A displayed rank that is not the rank of the displayed grade.
- A number computed from a table the enforcing code does not read.
- `$0.0M` where the honest answer is "there is no contract" (use an em dash).
- A count that prompts you about men you have already set aside.
- A label describing a control's *old* behaviour.

### 4.3 Canary discipline

**Every probe script carries a canary**: an assertion fired at a knowingly
false claim, and a read of a deliberately misspelled field. Both must report
FAIL. If either stays quiet, the run fails.

The reason is not fussiness. `undefined === undefined` compares equal and
reports success while testing nothing. A full salary-cap audit here passed
clean against a misspelled field name and was worthless; the defect it was
written to catch was live the whole time.

```ts
// The canary. Every harness in scripts/ has one. Do not ship one without it.
let canaryFired = 0;
try { assertEqual(1, 2, 'canary: false claim'); } catch { canaryFired++; }
// @ts-expect-error deliberate misspelling
if (row.deadMoneyy === undefined) canaryFired++;
if (canaryFired !== 2) { console.error('CANARY DID NOT FIRE — this harness tests nothing'); process.exit(1); }
```

### 4.4 Measure, don't guess

"Feels wrong" is the start of an investigation, not a diff. Every balance
change in this repo's changelog carries before/after numbers from a real
league, and several of them overturned the diagnosis they started with.

Two worked examples, both of which are the reason §28's calibration table
exists:

- A linebacker's rating was **statistically uncorrelated with his tackle
  count** — r = 0.082 across 120 replayed league-seasons, and a top-quartile
  linebacker produced 1.02x what a bottom-quartile one did. Every linebacker
  decision in the game was hollow and nobody had noticed, because nothing had
  ever computed the correlation. After the fix: r = 0.659, 1.88x.
- A punter's rating against his gross average: r = **−0.027**. His whole season
  was one die roll.

Baseball gets this property for free if you build the engine the way §20 says.
That is the single strongest argument for that engine design, and you should
still measure it (§28.3, the correlation table) rather than assume it.

### 4.5 The text rule

> *"Any text should be useful and informative, but not immersion breaking to
> the player as an explainer."*

A tooltip explains the **baseball** concept. It never mentions the database, a
box score, a stat line, this save, the sim, or how a number is computed
internally. *"Salary you still owe a man you released — it stays on your
payroll whether he plays for you or not"* — not *"Contract.guaranteed minus
paid"*. Give a sense of scale wherever it can be supported honestly: what is
good, what is bad, what is normal. Every threshold quoted comes either from
this game's own tuning or from a real-sport fact, never from a number invented
to sound authoritative. §31 writes the voice out for the screens that carry it.

### 4.6 The commit-message convention

Read a dozen recent subjects and you have the voice:

```
The contract panel said the same number twice and the same refusal five times
The cap climbed 7% a year forever, and by season three you could afford the whole league
A linebacker's rating was statistically uncorrelated with his tackle count
Two presses of Advance ran two consecutive advances at once, and 5 of 6 cap charges were orphans
The draft was not frozen. It was 224 picks running inside one request with nothing on screen.
Every pick is paid its own slot's price. Six of them were never called at all.
Nobody sits out a season at his April price, and somebody is now shopping
```

**The subject is the defect, stated as a fact about the world, in the past
tense, with the number in it.** Not "fix cap bug", not "feat: add arbitration".
It is what was wrong, said the way you would say it out loud. Where a commit
adds something rather than fixing something, it is still a statement about the
world: *"A seventh design principle: declutter every page, and length is not
clutter"*.

**The body is the case.** What was counted first, on what data. What the
obvious fix was and why it was rejected. What was measured before and after.
What was found and deliberately *not* fixed, named so nobody mistakes the
commit for having fixed it. Prose, not bullets, in sentences. Capitalised
phrases mark the load-bearing sentence of a paragraph — `ONE FUNCTION DECIDES
WHAT NUMBER A PICK WEARS`, `THE DELETE IS THE CLAIM` — and are used sparingly.

Never end a message with attribution boilerplate unless asked. **Do not commit
or push unless the owner asks you to.**

### 4.7 Where documentation lives

- `README.md` — the football game. Its changelog is append-only and every entry
  carries the commit hash it shipped in, because its whole purpose is "go back
  to this commit". **You will add a `BASEBALL.md` (§32) rather than editing it,
  except for one line in "Where things live" pointing at the new game.**
- `GAME_INVARIANTS.md` — football's numbered rules. **You will add
  `BASEBALL_INVARIANTS.md` with the same structure (§29).**
- `docs/HANDOFF.md` — how a fresh session picks the football project up cold.
  **You will add `docs/baseball/BUILD_LOG.md` in Phase 0 and append to it at
  every phase boundary.**

## 5. The football architecture, in one pass

You are copying the *shape* of most of this and none of the rules. Read it for
the shape.

### 5.1 The phase machine (`lib/season.ts`, 2,713 lines)

One exported entry point moves league time: `advanceWeek(leagueId)`. Everything
else — every screen, every button, every script — calls it and nothing else.

```
PRESEASON → REGULAR (17 weeks) → PLAYOFFS (4 rounds) → OFFSEASON (5 steps,
3 presses) → RESIGN → FREE_AGENCY (3 weeks) → DRAFT → back to PRESEASON
```

Four mechanisms make it safe, and **all four transfer to baseball unchanged**:

**(a) The lease.** `advanceWeek` takes a lease on the league for the whole
advance — `League.advanceStartedAt`, a *timestamp*, compare-and-set against
`null OR older than 90s`. A press that finds it held is refused with a busy
signal. It is a timestamp and not a boolean because *the failure mode of a
mutex must never be worse than the race it prevents*: a flag left set by a
request killed mid-advance is a save nobody can ever advance again, with no
move inside the game that clears it. 90 seconds is longer than any advance that
can finish (serverless `maxDuration` is 60), so a lease is only ever stolen
from a request that is already dead.

Without it: two presses milliseconds apart both succeeded, because the first
press's claim wrote the *new* week and the second press matched the claim for
the *next* advance and ran it alongside. Measured on a cloned save: 115
retirements became 102, 663 transactions became 968, and the league landed two
steps past where one clean press leaves it.

**(b) Per-transition claims, underneath the lease.** Every transition
compare-and-sets before it does any work — the offseason advance sets
`League.week`, the way out of RESIGN sets `League.phase`, a playoff round takes
a round lock, a regular-season week claims the week *and* each of its games.
`updateMany` returning 0 rows is the answer ("somebody got here first"), not an
exception. The lease is a door; these are the lock.

**(c) THE DELETE IS THE CLAIM.** Inside a loop that releases expiring
contracts, the code deletes the contract row *first*, continues if it matched
nothing, and only the runner that actually took the row books the cap charge.
Deleting first turns the row into a token exactly one runner can hold. Making
the delete merely idempotent would have stopped the crash and left a silent
double-charge running forever. **This idiom is the single most transferable
thing in the file.**

**(d) A throw leaves the week on the step that failed.** The offseason claim
jumps `League.week` to the far side of the whole group, and the `catch` puts it
back to `start + stepsCompleted` — never to the beginning. Re-running PROGRESS
or RESET_STANDINGS is a silent permanent doubling of every career stat in the
league.

**The offseason collapse, and the lesson that governs your calendar design.**
The offseason was six presses, and four of them asked the user nothing —
rosters age, standings reset, contracts roll, the pick horizon extends. The
owner counted them: *"thats so many advances, we need to combine some of
these"*, then *"ideally i'd like post super bowl to free agency to be 3
advances. then free agency itself is only 3 advances from 4"*. So the steps
were **grouped, not deleted**: the same functions run in the same order with
the same arguments, and only how many of them one press carries changed. **The
group boundary is where the reading changes** — an advance that reports nothing
reads as broken.

`League.week` still counts STEPS, not presses, and that decision carries the
whole change: the year-roll step keeps its index, so dead money still files
against the same league year; a save stranded mid-offseason by the old build
resumes at exactly the step it stopped on; and a step that throws leaves the
week on the step that failed.

**The other half of the same commit, which you will hit too.** The
championship-and-awards panel was gated on the offseason phase and read
`league.seasonYear` — and the first press is what rolls that year, so a GM's
ring went from two presses on screen to one. It is keyed on the **step index**
now, not the year. And underneath it, the record line read `Team.wins`, which
the standings reset zeroes, so post-roll the panel would have printed *"0-0 —
Missed the playoffs"* directly beneath *"You won the championship!"*.

**`AdvanceResult`** is the return shape and it is worth copying exactly:

```ts
interface AdvanceResult {
  summary: string;                      // always; the fallback sentence
  blocked?: boolean;                    // time did NOT move
  report?: WeekReport | null;           // the structured "what changed"
  trophy?: TrophyMoment | null;         // tier 0: your season just ended
  capBlock?: { teamAbbr; shortfall; path: {playerId,name,position,frees,deadMoney}[] };
  block?: { title: string; href: string; linkLabel: string };  // a non-cap refusal
}
```

`block` exists because every refusal used to render under the cap panel's
hard-coded "Over the salary cap" heading, and cut-down day refusing for a
roster-limit reason then said something false. **A refusal carries its own
title and its own door.**

**Multi-advance.** The Advance control has a dropdown of targets, and it only
ever offers targets valid for the phase you are actually in — it disappears
entirely on a gated phase where there is nothing to multi-advance into. A
multi-week run collects every intermediate report and folds them into one span
strip, showing the panel for the last step only: *"a player who asked to skip
to the playoffs has explicitly asked not to be stopped."*

### 5.2 Money (`lib/cap.ts`, `lib/cap-summary.ts`, `lib/capEnforcement.ts`, `lib/leagueYear.ts`)

Four modules, and **the split between them is the architecture, not an
accident**:

- `lib/cap.ts` — pure arithmetic, no database. Imported by client forms, so it
  must never touch Prisma.
- `lib/cap-summary.ts` — `teamCapSummary(teamId, year, mode)`, the one ledger read.
- `lib/capEnforcement.ts` — `assertCapRoom()`, the single gate every acquisition
  path runs through. Needs the database, so it cannot live in `cap.ts`.
- `lib/leagueYear.ts` — `capForLeague(league, year?)`, **the single door to a
  league's ceiling**. It resolves the founding year and the growth rate
  together, because a ceiling is two facts about one league and they live in two
  places. Two separate bugs lived on the one line that used to fetch one fact
  and remember the other.

The rules the ledger encodes, every one of which was a shipped bug first:

- **Every exit from a roster answers for the bonus already paid.** Cut: books
  it. Trade: accelerates it onto the club giving him up. Tag: books it. Re-sign
  (replace branch): books it. The tag and the re-sign each spent time *not*
  doing so, which made **keeping a man strictly cheaper than losing him** —
  inverting the incentive the whole cap exists to create.
- **A charge is dated by one function**, `capChargeYear({phase, week, year})`,
  and every writer calls it rather than hard-coding a year. `executeTrade` did
  hard-code one, and trades made in the pre-roll offseason window filed against
  a year that was about to be deleted.
- **A dying league year cannot absorb a bill for free.** Dead money is a
  one-year charge swept at the roll, so a release made in-season booked into a
  year about to vanish: **$74.6M raised, $0 carried.** The fix carries the
  *overage* — whatever a club is still over the ceiling by when its season ends
  — into the new year, not the charge. Re-dating the charge would bill a club
  with $80M of space exactly as hard as one with none.
- **`CapCharge.teamId` is a real foreign key with `onDelete: Cascade`, hung off
  `Team`.** It used to be a bare string pointing at nothing: deleting a league
  orphaned every dead-money row it held — **18,247 of 22,380 rows on the dev
  database, five of every six charges in it.** The cascade hangs off `Team` and
  *not* off `Contract` or `Player`, and that is the whole decision: dead money
  is meant to outlive the deal that created it, so either of those would delete
  the bill along with the reason for it.

### 5.3 The starting lineup (`lib/lineup.ts`)

**One file defines who is on the field, and everything that says the word
"starter" reads it.** It used to be written down in three places and one of
them fielded twelve defenders on an eleven-man defence, because two copies of a
table is exactly how a wrong number survives — there was no single place where
somebody would ever add the column up.

It is keyed by **position**, not by position group, because the depth chart has
to say three receivers start and one tight end does. Group counts are derived
below it rather than typed a second time. **The sums are asserted at module
load and the module throws if a side of the ball does not add up to eleven.**

The other thing it holds is `lineupGaps()` — who is missing from the eleven,
counting only men who *can play*, using the same availability test the engine
applies (`injuryWeeks > 0`). Asking the question a second way would eventually
produce a screen that disagrees with the game it describes.

### 5.4 The simulation (`lib/sim/engine.ts`, `lib/sim/units.ts`)

Drive-based, not play-based. Ten possessions a side; each drive rolls an
outcome from probabilities derived from the matchup edge (this offence's unit
score against that defence's), then generates plays and yards consistent with
the outcome. RNG enters at three levels: game form (one roll per team per
game), drive noise, and event rolls.

Two things about it matter to you:

1. **Individual stat lines are ALLOCATED from team totals** rather than
   simulated. That is why `scripts/checkBoxScore.ts` exists, and why all six of
   its conservation clauses failed at once when it was first written: 30.6% of
   touchdown passes reached no player, receiving yards ran 8.5% ahead of
   passing yards, the team pass line was a hardcoded 60/40 split of total yards
   unrelated to anything the players did. **Baseball's engine does not
   allocate. It accumulates. That whole bug class disappears — see §20.**
2. **`REPLACEMENT_LEVEL = 48`** is exported from `units.ts` and read by the AI's
   valuation, because "what happens at right tackle if nobody is behind him" must
   have the same answer in the engine and in the AI. A second constant would let
   the AI price a league the engine does not play.

### 5.5 Acquisition: free agency, trades, the draft

**One evaluator, called by both sides.** `decideOffer` in `lib/negotiation.ts`
is called by the client interest meter on every keystroke *and* by the server
on submit, so the meter can never promise something the server refuses.
`scripts/checkNegotiationAgreement.ts` proves it across ~1,025,000 swept
comparisons and is described in `docs/HANDOFF.md` as *the most important check
in the repo*. There was, for a long time, a second four-line acceptance model
sitting in the server path while the full one went unimported.

The minigame: reservation price is hidden and never shown; you get qualitative
feedback and probe for it; **patience** is the loss condition and is persisted
server-side (`NegotiationTalks`, keyed on team + player + league year) because
a resource that resets on F5 is not a resource. Personalities (`MERCENARY`,
`LOYAL`, `WINNER`, `PROVE_IT`) shift the reservation price and the blurb — and
the blurb is a function of the *context*, not of the personality alone, because
"he wants to finish what he started here" over a free agent who never played
for you is a sentence about a relationship the save does not contain.

**Trade value** is `playerValueDetailed()` in `lib/ai/gm.ts`: surplus over
replacement level, position-tier curves, position-specific age arcs, contract
surplus, bounded need and scarcity multipliers, a hard per-tier ceiling. The
hardest thing it learned: **a bargain is a multiplier and an overpay is a
bill.** A 62-overall corner on $135.4M was accepted for nothing by 30 of 31
clubs, because value is surplus over replacement and replacement at that
position *is* 62 — so he scored a flat zero, and a negative multiplier times
zero is zero. The overpay had to become dollars subtracted, not a factor.

**The draft** resolves the pick on the clock from live `DraftPick` ownership
every time (`findFirst` on `(round, slot)`), never from a turn-order array
computed once — that array ignored every round-2+ trade and handed players away
for free. It runs in **chunks** (twelve picks, plus a 3,500ms deadline checked
between picks) because 224 picks in one server action is 69ms and 31.2 database
round trips *per pick*: free locally at 0.1ms RTT, and 29 to 190 seconds in
production depending on region. **That is the single most important performance
lesson in this repo and it applies directly to a 600-pick baseball draft.**

### 5.6 Scouting fog (`lib/scouting.ts`, `lib/consensus.ts`)

The user never sees a true attribute for a fogged player. He sees an *observed*
value (truth + noise, noise shrinking with confidence) and a *range* around it.
Attributes carry a `scoutDifficulty` — a 4.4 forty is measurable, "decision
making" is not — so physical attributes converge fast and mental ones stay
foggy.

Three findings you inherit:

- **Errors average; bands add.** The centre of a fogged overall averages twelve
  independent per-attribute observations so its noise cancels (rms 3.75 at zero
  scouting); the band assumes every attribute is wrong in the same direction at
  once so its noise sums (±12.5). That is why the displayed half-band is 4.2x
  the centre's median error and why the true value falls inside the range 99.7%
  of the time at *every* confidence level — a guarantee, not a confidence
  interval.
- **This game cannot produce a bust.** There is no bias term. 240 redraws of
  the same prospect leave a per-player mean error of 0.39 against the 0.23 pure
  noise predicts. A club is never *systematically* wrong about a man, only
  noisily wrong, and the noise cancels. **Baseball must fix this — see §22.**
- **Colour leaked the number the text was hiding.** The board printed a
  25-point range and painted the cell from the fogged *centre* of it: measured
  across 63,470 fogged views, the ink matched the true tier 80.2% of the time
  cold and 93.0% after a season of files. The leak got worse the more you
  scouted. The cell takes its colour from the *range* now, and only where both
  ends sit in one tier — otherwise grey.

**Fog applies to draft prospects only, and it defaults to false.** Fog is a
cost, paid in readability. It earns that cost only where "we didn't know" is a
real story. A free agent with five seasons on film is not a mystery.
**Baseball's version of this rule is different and §22 states it.**

`lib/consensus.ts` is the free, public, deliberately-wrong big board. Nobody
should pay to learn that the consensus #1 pick is the consensus #1 pick. The
GM's edge is not *having* information; it is knowing where the room is
**wrong** — so the board carries named, machine-readable biases each driven by
a public signal, and a scouting report can disagree with a reason instead of a
shrug.

### 5.7 The AI GM (`lib/ai/gm.ts`)

One brain used by free agency, trades and the draft, so a club's board is
internally consistent across every way of acquiring talent. `GmProfile` is four
0..1 knobs stored as JSON on `Team`: `aggression`, `winNow` (recomputed each
offseason from record and roster age), `valuePicks`, `bpaBias`.
`philosophySummary()` turns them into the sentence the trade screen shows.

AI clubs do **not** carry scouting rows — they evaluate veterans off true
ratings, because modelling fog for 31 clubs would 32x the data for no gameplay
benefit in a single-player game. **The rookie draft is the exception**: once
the consensus board became deliberately fallible, clubs picking off truth meant
the board the user is shown predicted nothing about the order men came off it.
AI clubs draft off the public board plus a private per-club lean.

### 5.8 History, records, careers

- `TeamSeasonRecord` — the only place a season's result survives the standings
  reset, captured the moment the championship completes.
- `PlayerSeason` — one row per (player, year, **club**), because a man traded
  mid-season gets one row per jersey and one averaged row answers "who did he
  produce for" wrongly while looking authoritative. The display recombines them
  into a "2TM" summary line above the pair, the way every real reference does.
- `LeagueRecord` — one row per (league, scope, category): the current holder.
- `lib/gen/leagueHistory.ts` — 16-24 seasons of invented backstory at league
  creation, with persistent franchise identities, a bracket actually played out
  round by round, historical players who win the awards and hold the records,
  and **season-by-season** career lines for every veteran on a roster. It used
  to compute the walk and throw it away, keeping only the merged blob — which
  left the player card able to say nothing about those years but "Before 2026".
- Dynasty XP and level are **never stored**. They are recomputed on every read
  as a pure function of history the database already holds, which makes them
  self-healing for old saves, impossible to farm, and free of any hook in the
  season code. `DynastyProfile` stores only what cannot be derived: which
  skills were bought, and year-stamped charge counters.
- **`resolveStartYear()` is the one definition of when the GM took the job**,
  and the GM career page and the dynasty level are bounded to it. The franchise
  Ring-of-Honor score deliberately is not, and the panel says so — it read 94
  with "1 championship" on a nine-season tenure that went 34-119 without a
  title.

### 5.9 The design system (`components/ds/`)

70 components. Reach for one before writing new styling. The load-bearing ones:

- `PageMasthead` — the standard header for a front-office screen: a team-tinted
  band with the page identity at display scale and a strip of *the numbers that
  page is about* along its base. **Every fact tile takes an optional `href` and
  becomes a door.** Sixty-two tiles named a problem — "Open Starting Slots 2 —
  LT, K" — and not one could be clicked, because the component had no `href`
  field and rendered a bare div by construction. Set it only when the
  destination is somewhere *else*: a tile that links to the page it sits on is
  worse than an inert one.
- `SectionHeading` — heading + divider, the default way to introduce a block.
  Reach for a card only when what follows is a genuinely distinct object.
- `RatingBadge` — the proprietary notched-corner chip with a tier-coloured
  corner flag, a plate and a glyph. Tiers at 88 / 78 / 68 / 58.
- `Tooltip` + `lib/glossary.ts` — `tip('deadMoney')`. **One definition of every
  term in the game**, keyed camelCase so a misspelling is a compile error
  rather than an empty bubble in production. Never hand-write a tooltip string.
- `StatNumber`, `DeltaChip`, `Timeline`, `PlayoffBracket`, `StandingsTable`,
  `NewsRow`, `MetricTiles`, `ActionButton`.

Tailwind tokens are in `tailwind.config.ts`: `ink surface card raised line muted
chalk accent accent2 warn bad gold`, a `viz1..viz8` categorical palette
validated for colour-vision deficiency, a `stat-sm/md/lg/xl` number scale, and
`--team-accent` for per-club tinting.

### 5.10 Ownership and accounts

A save is owned by an **account** once claimed and by a **browser** before that
(an opaque id in an httpOnly cookie). Both are live at once on purpose: a wall
in front of a single-player game costs every tester who was only going to click
once. `ownsLeague` is the only place ownership is decided, and it is enforced
in three places — the home list, every server action (`assertLeagueOwner`), and
every league page render (`getLeagueContext` throws, the layout turns it into a
404). Server actions are POST endpoints; a page-level check does nothing for
them.

## 6. Things you cannot infer from the code

The list a newcomer needs and the code will not tell him.

1. **`lib/lineup.ts` is the single definition of the starting eleven.**
   Anything that decides who plays reads it. Three modules once disagreed and
   one fielded twelve men.
2. **The salary cap has one door: `capForLeague(league)` in
   `lib/leagueYear.ts`.** It is in that module and not in `lib/cap.ts` because
   `cap.ts` is imported by client components and cannot touch Prisma. Six call
   sites still call the two-argument `capForYear()` and are therefore reading
   the *default* growth rung; they are named in that file's header. Do not add
   a seventh.
3. **`CapCharge` was keyed on a bare `teamId` string with no foreign key**, so
   deleting a league orphaned every dead-money row — 18,247 of 22,380. Fixed
   with a cascade **from `Team`**, deliberately not from `Contract` or `Player`.
4. **Several agents share one `.next`.** A page can 404 or 500 from compile
   contention rather than from a real bug. Check twice before debugging.
5. **`tsx` does not load `.env`.** Export `DATABASE_URL` first.
6. **`next build` type-checks `scripts/**`** because `tsconfig.json` includes
   `**/*.ts`. A dirty probe script fails the production build.
7. **`tsc` will not catch importing a function from a `'use client'` module
   into a Server Component.** Every export of a client module reaches a Server
   Component as a client reference. This shipped a 500 to production.
8. **`DynastyRank` already has a `sport` discriminator and a comment saying the
   owner wants football, baseball and basketball feeding one board.** `saveKey`
   is deliberately a plain string and not a foreign key to `League`, so a second
   game can insert its own rows without that schema knowing anything about its
   save table. **What the sports share is `User`.** This is the single most
   important pre-existing decision for your merge, and §7 does not re-litigate it.
9. **`League.startYear`, `League.contractsAgedYear`, `League.resignWarnedYear`
   and `League.advanceStartedAt` are all nullable for one reason**: `prisma db
   push` and `migrate deploy` run against a database with live rows, and a
   required column hard-fails against them even with `--accept-data-loss`. Every
   new column you add to a live table is nullable or defaulted, full stop.
10. **Nothing in this game deletes a single team** — only a whole league, which
    cascades into `Team`. Several cascade decisions rest on that.
11. **`Player.seasonStats` / `careerStats` are REGULAR SEASON ONLY**, with
    `playoffStats` / `careerPlayoffStats` as separate buckets. They shared one
    for a while, and a title run silently added four games of production to
    twelve clubs' season totals while twenty clubs got nothing — so league
    leaders ranked a 21-game season against a 17-game one.
12. **The free-agent pool never stops growing.** Undrafted prospects have
    `isDraftee` cleared and become ordinary free agents, and
    `progressAllPlayers` only ages `status: 'ACTIVE'`, so they never age, never
    retire, never leave. A nine-season run ends with ~2,500 free agents. Partly
    patched with an attrition roll; still the reason a late-dynasty free agent
    list is unreadable. **Do not reproduce this. §15 says how.**
13. **No AI club has ever used the franchise tag**, and `aiSharpness` is a
    declared difficulty knob with no consumer anywhere in the codebase. Both are
    written down under "Known simplifications" rather than quietly deleted,
    because a described feature that does not exist is a lying metric and a
    sentence is no different from a number.
14. **The Advance button's pending flag drops at the first `await` on React
    18.3**, so it re-enables while the advance is still running. The client
    guard is an optimisation; **the server claim is the guarantee.**

---
---

# PART II — THE MERGE

*Do this first. It is the only irreversible part, and a live database with real
saves in it is on the other side of every decision here.*

## 7. The decisions, and what was rejected

### 7.1 One Next.js app. Not two.

**Decision.** Baseball ships inside this repository, this app, this deployment,
this domain. New routes under `/baseball`, new modules under `lib/baseball/`,
new components under `components/bb/`.

**Why.** Auth, sessions, rate limiting, password hashing, the account page,
save ownership, the public leaderboard and the landing page are already
sport-agnostic and already written. A second app duplicates every one of them
and guarantees they drift. The leaderboard in particular *cannot* work across
two deployments — it has to `ORDER BY` across every save in the database at
once.

**Rejected: two apps behind one domain.** It buys independent deploys, which
this project does not need — one person ships it — and costs a shared session
cookie, a shared Prisma client, and one honest answer to "which of my saves am
I looking at".

### 7.2 One database, one Prisma schema, one Postgres schema.

**Decision.** `prisma/schema.prisma` gains the baseball models. Same file, same
database, same `migrate deploy`.

**Why.** `DynastyRank` already carries a `sport` discriminator with a written
comment stating that the owner wants football, baseball and basketball feeding
one board, that `saveKey` is deliberately not a foreign key so a second game
can insert rows without this schema knowing about its save table, and that what
the sports share is `User`. That decision is made and documented; you are
implementing it, not revisiting it.

**Rejected: two databases.** Two Neon projects, two connection strings, two
migration histories, and a leaderboard that cannot be written.

**Rejected: Prisma multi-schema (`@@schema`).** It is a preview feature on
Prisma 5.22, it complicates `migrate deploy` against Neon, and it buys only
namespacing that a model-name prefix already gives for free.

### 7.3 New models with a `Bb` prefix. NOT a `sport` column on `League`/`Player`.

**Decision.** `BbLeague`, `BbTeam`, `BbPlayer`, `BbContract`, `BbGame`, and so
on. Football's 24 models are **not touched**, with exactly two exceptions named
in §10. `User`, `Session`, `AuthAttempt` and `DynastyRank` are shared as-is.

**Why this is the load-bearing decision.** A shared `Player` with a `sport`
discriminator sounds tidy and is a trap:

- Every column becomes nullable-for-the-other-sport. `devTrait`, `heightIn`,
  `combineTesting`, `injuryWeeks` mean nothing or mean something different.
  `position` would be a string whose legal values depend on a sibling column,
  which no database can enforce and no reader can trust.
- Every query in 43,000 lines of football code would need a `sport` filter, and
  **forgetting one is a cross-sport data leak that type-checks**. There are
  hundreds of `prisma.player.findMany` calls. This is not a risk worth taking
  for zero benefit.
- The migration would rewrite live tables holding real dynasties on a
  production Neon database. Prefixed models mean the migration is `CREATE
  TABLE` only: **no football save can be damaged by any of your work, because
  none of your work touches a football table.** That single sentence is worth
  more than any elegance a discriminator buys.

**Rejected: sharing `Contract`.** A football contract prorates a signing bonus
across `min(years + void, 5)` and leaves dead money. A baseball contract is
fully guaranteed, may defer money for a decade, may carry an opt-out and a
no-trade clause, and has no proration concept at all. The two share the word
"contract" and nothing else.

**Rejected: sharing `Team`.** Football's `Team` carries `offScheme`,
`defScheme`, `divWins`, `confWins`, `playoffSeed` and four scouting-economy
columns. Baseball's carries a payroll budget, a tax-status history, four
affiliate levels and a 40-man count. The overlap is `city`, `nickname`, `abbr`
and `prestige`, which is not a model.

### 7.4 Routing

**Football routes do not move.** `/league/[id]/...` stays exactly where it is —
they are bookmarked, they are what the deployed domain serves, and moving them
buys symmetry and nothing else.

| Day one (after Phase 1) | At the end |
|---|---|
| `/` — landing, football saves only | `/` — landing, **both** sports' saves, sport-tabbed |
| `/new` — create football league | `/new` — create football league *(unchanged)* |
| — | `/baseball/new` — create baseball league |
| `/league/[id]/*` — football *(unchanged)* | `/league/[id]/*` — football *(unchanged)* |
| `/baseball/league/[id]` — stub | `/baseball/league/[id]/*` — the game (§30) |
| `/leaderboard` — football rows | `/leaderboard?sport=BASEBALL` — tabs derived from data |
| `/account` — shared | `/account` — shared, lists both sports' saves |
| `/sign-in`, `/sign-up` — shared | *(unchanged)* |

The landing page's two states are unchanged in shape (§5.10 of `app/page.tsx`:
no saves → the pitch; has saves → the franchises first). It gains a sport
segment above the save list, and the pitch gains a second card. **A viewer with
football saves and no baseball saves sees his football saves first and a
"Start a baseball dynasty" card below them** — never a chooser standing between
a returning player and his dynasty.

**One domain: dynastygm.gg.** Not a subdomain. A subdomain splits the session
cookie unless you widen it to `.dynastygm.gg`, which is a security change made
for a cosmetic reason.

## 8. The shared layer: exactly what moves, what duplicates, what must never be shared

**The rule.** *Share what takes a data shape and returns a number. Duplicate
what encodes the rules of a sport.*

An abstraction that needs a `sport` parameter to decide what it does is two
functions wearing a trench coat, and this codebase has already paid for that
lesson in the shared-component pass: a depth-row component that needed four
"which caller am I" props was correctly refused in favour of two components,
and what *was* extracted was the part that could disagree — the formatter, the
total, the em dash, the hide-when-off rule.

### 8.1 Moves to a shared home — used by both, unchanged

| Module | New home | Note |
|---|---|---|
| `lib/db.ts` | stays | already shared |
| `lib/rng.ts` | `lib/shared/rng.ts` | seeded RNG, `normal`, `normalClamped`, `clamp`, `pick`, `int`, `float` |
| `lib/json.ts` | `lib/shared/json.ts` | `readJson`/`writeJson` for the JSON-string columns |
| `lib/auth.ts`, `lib/password.ts` | stay | sessions, scrypt, rate limiting |
| `lib/owner.ts` | stays, **extended** | gains `ownsBbLeague` + `canViewBbLeague` mirroring the football predicate clause for clause |
| `lib/leaderboard.ts` | stays, **extended** | already multi-sport; you add `refreshBaseballRanks()` beside `refreshFootballRanks()` and register `'BASEBALL'` in `SPORT_LABEL` |
| `lib/scouting.ts` | `lib/shared/fog.ts` | **genuinely sport-agnostic.** Takes an attribute map, per-attribute difficulties and a confidence, returns observed values and ranges. `observe`, `errorBand`, `observationSd`, `buildScoutedView`, `flatPotentialBand`, `scoutNote`. Football keeps importing from the new path. |
| `lib/gen/avatar.ts`, `lib/gen/teamLogo.ts` | `lib/shared/gen/` | crest and portrait generators keyed on a seed string |
| `lib/gen/names.ts` — `FIRST_NAMES`, `LAST_NAMES`, `NameRegistry`, `pickUniqueName` | `lib/shared/gen/names.ts` | the **pools and the uniqueness ledger** move; `TEAM_SEEDS` and `COLLEGES` are football's and stay |
| `components/ds/*` | stays | see 8.3 |

Moving a module means: create the new path, re-export from the old path for one
commit if that keeps the diff small, then update football's imports and delete
the shim. **Do not leave a permanent re-export shim** — two names for one module
is the same defect class as two definitions of a starter.

### 8.2 Duplicated deliberately — same *shape*, different rules

Each of these gets a baseball sibling that copies the football module's
structure, its comment discipline and its safety idioms, and shares no code.

| Football | Baseball | Why not shared |
|---|---|---|
| `lib/season.ts` | `lib/baseball/season.ts` | 2,713 lines of sport-specific bookkeeping. A shared `advanceWeek` with a strategy object would be the worst decision available here: the branches never converge and every bug becomes a two-sport bug. **Share the doctrine — lease, claims, delete-is-the-claim, step grouping, throw-leaves-the-step — and duplicate the code.** |
| `lib/cap.ts` + `capEnforcement.ts` | `lib/baseball/payroll.ts` + `payrollEnforcement.ts` | proration and dead money vs guarantees, deferrals and a tax. No shared arithmetic exists. |
| `lib/lineup.ts` | `lib/baseball/lineup.ts` + `lib/baseball/staff.ts` | one eleven vs a batting order, a defensive alignment, a rotation and a bullpen |
| `lib/sim/engine.ts` | `lib/baseball/sim/engine.ts` | drives vs plate appearances |
| `lib/ai/gm.ts` | `lib/baseball/ai/gm.ts` | `GmProfile`'s four knobs are copied by name; the valuation is rebuilt |
| `lib/tuning.ts` | `lib/baseball/tuning.ts` | §27 writes it out |
| `lib/glossary.ts` | `lib/baseball/glossary.ts` | the **mechanism** (`tip(key)`, camelCase keys, `definition` + optional `why`, compile-time key checking) is copied verbatim; the dictionary is baseball's |
| `lib/invariants.ts` | `lib/baseball/invariants.ts` | §29 |
| `lib/ratings.ts` | `lib/baseball/ratings.ts` | the attribute catalogue, `computeOverall`, the tier bands and `ratingColor` are re-implemented against baseball's attributes. **The tier thresholds (88/78/68/58) and the colour ramp are copied exactly**, because principle 3 is about the ramp, not about the sport. |
| `lib/negotiation.ts` | `lib/baseball/negotiation.ts` | see 8.4 — the closest call in the document |
| `lib/news.ts` | `lib/baseball/news.ts` | thresholds and phrasing are the sport's |
| `lib/gen/leagueHistory.ts` | `lib/baseball/gen/history.ts` | same architecture, different stat lines and trophies |

### 8.3 The design system: shared, with two sport folders

`components/ds/` stays shared. These are already sport-neutral and are used
as-is: `PageMasthead`, `SectionHeading`, `RatingBadge`, `StatNumber`,
`DeltaChip`, `RankChip`, `Tooltip`, `ActionButton`, `MetricTiles`, `NewsRow`,
`LeagueWireTicker`, `Timeline`, `SiteHeader`, `BottomNav`, `TeamHeader`,
`PlayerHero`, `PlayerAvatar`, `TeamLogo`, `CareerHonors`, `TrophyMoment`,
`GmCard`, `SeasonEndCard`, `StorylineFeed`, `InterestMeter`, `SigningConfirmation`.

`PlayoffBracket` and `StandingsTable` are shared but must be **parameterised**
rather than forked: the bracket takes round labels and a series length per
round (baseball rounds are best-of-3/5/7/7, football's are single games), and
the standings table takes its column set. Both changes are additive and must
leave football's rendering byte-identical.

Sport-specific and split into folders:

- `components/ds/positionColor.ts` → `components/ds/football/positionColor.ts`
  and a new `components/ds/baseball/positionColor.ts`.
- `components/ds/teamMarks.tsx` → football's crest marks stay; baseball gets its
  own in `components/ds/baseball/`.
- Everything under `components/draft/`, `components/cap/`, `components/negotiate/`
  is football's. Baseball's equivalents live under `components/bb/`.

### 8.4 The one genuinely hard call: the negotiation minigame

`lib/negotiation.ts` is 2,265 lines and is the best piece of design in the
football game. Its core — a hidden reservation price, an interest meter that
re-runs the *same* evaluator the server decides with, personalities, a
persisted patience budget, a rival bidder, qualitative verdicts
(`ACCEPT / CLOSE / CONSIDERING / COLD / MAYBE / OUTBID / INSULTED`) — is a
**front-office minigame, not a football mechanic.** Baseball needs it three
times over: free agency, extensions, and arbitration.

**Decision: extract the frame, duplicate the pricing.**

- `lib/shared/negotiation/frame.ts` gains: the `Verdict` union, the interest
  thresholds and `INTEREST_TICKS`, `signBandFor`, `maybeChance`, patience
  accounting, `sessionFingerprint`, and the `evaluateOffer(ctx, offer) →
  {interest, verdict, ...}` signature. It is pure, takes a context object it
  does not construct, and touches no sport's contract type.
- `lib/baseball/negotiation.ts` owns `buildNegotiationContext` (what the man
  will sign for, given baseball's market, his service class and his personality)
  and `decideOffer` (the one evaluator both the meter and the server call).

**Why not share more.** The reservation price is a function of market value,
term, guarantee share, age curve and positional pay — every one of which is a
sport rule. **Why not share less.** The frame is where the *"the meter cannot
promise what the server refuses"* guarantee lives, and that guarantee is the
thing worth carrying across.

**Whatever you do, ship the agreement harness.** `scripts/bb/checkNegotiationAgreement.ts`,
sweeping the offer space and asserting the client-side evaluation and the
server-side decision agree on every point. Football's version runs ~1,025,000
comparisons and `docs/HANDOFF.md` calls it the most important check in the repo.

### 8.5 What must NEVER be shared, and why

- **The two phase machines.** Stated above; it is the one place a "clever"
  abstraction would cost the most.
- **The two tuning files.** A shared constants module would let a football
  retune silently move baseball's balance. `lib/tuning.ts` and
  `lib/baseball/tuning.ts` may not import each other.
- **The two glossaries.** "Dead money" and "deferred money" are different
  concepts. One `tip('deadMoney')` returning different text by sport is exactly
  the "a word cannot come to mean two things on two screens" failure the
  glossary exists to prevent.
- **The two invariant rule sets.** They are numbered and traceable to their own
  markdown file. Merging them makes both untraceable.
- **The two sim engines.** Obvious, and worth stating because a "shared game
  result" type would drag them together.
- **`Player`, `Team`, `League`, `Contract`.** §7.3.

## 9. What an existing football save experiences

**Nothing.** That is the requirement and it is checkable.

Phase 1's migration is `CREATE TABLE` and `CREATE INDEX` statements only, plus
one `ALTER TABLE ... ADD COLUMN ... NULL` on nothing football reads. No football
table is altered, no football row is written, no football query changes. After
Phase 1, run football's `npm run sim:health` and `npx tsx scripts/checkBoxScore.ts`
and diff the output against the baseline recorded in Phase 0. If they differ,
you broke something and the migration is wrong.

The two football-facing changes in the whole build, both additive:

1. `app/page.tsx` gains a sport segment. Football's save list renders
   identically inside it. **Screenshot before and after and compare.**
2. `lib/leaderboard.ts` gains `refreshBaseballRanks()` and a `'BASEBALL'` label.
   The read path already takes a sport; the football refresh is untouched.

## 10. Migration order

One migration per phase, never a `db push` against anything that has ever been
deployed. Names follow the existing convention `YYYYMMDDHHMMSS_snake_case`.

1. `..._baseball_core` (Phase 1) — `BbLeague`, `BbTeam`, `BbPlayer`,
   `BbContract`, `BbPayrollCharge`, `BbDraftPick`, `BbDraftState`, `BbGame`,
   `BbTransaction`, `BbTeamSeasonRecord`, `BbPlayerSeason`, `BbLeagueRecord`,
   `BbScoutingReport`, `BbShortlistEntry`, `BbTradeOffer`, `BbTradeRecord`,
   `BbNegotiationTalks`, `BbDynastyProfile`, `BbPowerRankingSnapshot`,
   `BbLineupCard`, `BbPitchingStaff`, `BbArbitrationCase`, `BbAffiliate`.
   All of it at once — a half-built schema is not a stop point.
2. No further schema migration is planned. **If you find you need one, add a
   nullable column and say in its schema comment why null is the right value
   for every existing row.**

Write the schema into `prisma/schema.prisma` in one block, below football's
models and above `User`, with a banner comment matching the file's existing
style. Then `npx prisma migrate dev --name baseball_core` locally, and verify
`npx prisma migrate status` is clean before anything else.

---
---

# PART III — THE BASEBALL GAME

## 11. The transfer table

Baseball is not football with different nouns. Here is every system, with its
verdict.

| System | Verdict | The one sentence |
|---|---|---|
| Phase machine *shape* | **Reuse as-is** | Lease, per-transition compare-and-set, delete-is-the-claim, throw-leaves-the-step, grouped steps. All of it. |
| Phase machine *contents* | **Rebuild** | A 54-series season with a mid-season draft is not a 17-week season with an offseason draft. |
| Salary cap | **Does not exist in baseball** | Replaced by an owner-set payroll budget (a gate) plus a luxury tax (a price). §18. |
| Signing-bonus proration / dead money | **Does not exist** | Baseball contracts are fully guaranteed. Releasing a man costs you every remaining dollar, immediately and permanently. Simpler, and harsher. |
| Franchise tag | **Does not exist** | The nearest thing is the qualifying offer, which is a different mechanic with a different purpose. §17.6. |
| Service time & arbitration | **Exists in baseball, not in football** | A clock per player, independent of his contract. The single biggest structural addition. §17. |
| Minor-league system, 40-man, options, Rule 5 | **Exists in baseball, not in football** | The binding constraint on a baseball roster is *roster spots and option years*, not money. §16. |
| Depth chart | **Rebuild as three things** | A lineup card (two of them, vs RHP and vs LHP), a rotation, and a bullpen with availability. §19. |
| Pitcher rest / availability | **Exists in baseball, not in football** | A starter's availability is a function of when he last pitched; a reliever's of how many days running. Genuinely new. §19.3. |
| Handedness & platoons | **Exists in baseball, not in football** | Cheap to model, enormously legible, and it makes bench construction a real decision. §19.2. |
| Sim engine | **Rebuild, and it gets better** | Plate appearances accumulate; they are not allocated. The whole INV-22 bug class vanishes and ratings predict production by construction. §20. |
| Injuries | **Adapt** | The IL replaces `injuryWeeks`, and the 60-day IL is a roster lever, not just a health state. §15.4. |
| Draft | **Adapt heavily** | 20 rounds of teenagers who arrive in five years. The rookie-cap war-room panel becomes the bonus-pool panel, same shape. §22. |
| Scouting fog | **Reuse the machinery, widen the scope** | Same `observe`/`errorBand`/`buildScoutedView`. But fog must persist for years after the draft, and it must be able to produce a genuine bust. §22.3. |
| Consensus board | **Reuse as-is** | Free, public, wrong in learnable ways. Baseball's draft room is even more publicly wrong than football's. |
| Trades | **Adapt, and it inverts** | Prospects, not picks, are the currency — and prospects are the *fogged* assets, so baseball trading is a scouting game where football's is arithmetic. Plus cash and a hard deadline. §23. |
| Trade-value pick chart | **Mostly does not exist** | MLB draft picks are barely tradeable. Delete the pick chart from the trade economy; keep competitive-balance picks as the one exception. §23.2. |
| AI GM philosophy | **Reuse as-is** | Same four knobs, same `philosophySummary`, rebuilt valuation. |
| News / wire generation | **Reuse the pattern** | `BbTransaction` is the ledger; thresholds are baseball's. |
| GM career page | **Reuse as-is** | Career / Draft / Moves, three tabs, bounded to the hire year. |
| Dynasty score, XP, skill tree | **Reuse as-is** | Derived, never stored. Skill branches change name, not shape. |
| Awards | **Adapt** | Two leagues each award their own. Do **not** port the MVP/OPOY exclusion rule — §24.1. |
| Records & seeded history | **Reuse as-is** | Baseball's record book is the sport's crown jewel. Generate 16-24 seasons of it. |
| Design system | **Reuse as-is** | §8.3. |
| Invariant harness | **Reuse the pattern** | Numbered rules, a state checker, standalone arithmetic harnesses, canaries. §29. |
| Ownership / auth / leaderboard | **Reuse as-is** | §8.1. |
| Negotiation minigame | **Extract the frame, rebuild the pricing** | §8.4. And it gets a third caller baseball invented: the arbitration hearing. §17.5. |
| Position conversion | **Adapt, and it changes meaning** | In football it is a career change. In baseball, position flexibility is a *roster-construction* feature: a man who can cover three spots lets you carry a thirteenth pitcher. §13.4. |
| Park factors | **Exists in baseball, not in football** | Cheap, beloved, and it makes the stat page real. §20.6. |

## 12. The calendar and the phase machine

### 12.1 The unit of advance

**Decision: one press of Advance plays one scheduled block, and a block is
three games — a series.** 54 series, 162 games.

**Why not a day.** 186 presses, most of them asking nothing. That is the
offseason-collapse defect multiplied by sixty.

**Why not a week.** A week straddles series boundaries, which breaks the one
decision the unit exists to carry — who starts game one against these people —
and makes the standings movement per press incoherent (you played four
opponents).

**Why a series is the right unit.** It is the natural granularity of a baseball
front office: you set a rotation for a series, you decide a call-up before a
series, you read a result as "took two of three". It gives 54 presses against
football's 17 — but football's Advance also covers playoffs, offseason and free
agency, so the honest comparison is **65 presses a baseball year against 28
football ones.** That is more, and it is correct for a sport whose whole texture
is the grind, *provided the multi-advance dropdown carries the people who do not
want it.* It does: §12.5.

**The block size is one constant.** `BB_LEAGUE.SERIES_LENGTH = 3`. The schedule
generator is the only thing that reads it. Setting it to 6 produces 27 presses a
season — a homestand cadence that exactly matches football's. Ship at 3;
changing it is a one-line experiment the owner can be shown.

### 12.2 The shape of a season

30 clubs. Two leagues (`AMERICAN` / `NATIONAL`), three divisions each
(`East` / `Central` / `West`), five clubs per division.

**Schedule construction — 54 series, all 30 clubs in lockstep, 15 matchups per
series slot:**

| Opponent set | Series each | Series total | Games |
|---|---|---|---|
| 4 division rivals | 5 | 20 | 60 |
| 10 other same-league clubs | 2 | 20 | 60 |
| 14 other-league clubs | 1 | 14 | 42 |
| | | **54** | **162** |

Real MLB under the balanced schedule is 52 / 64 / 46. This is 60 / 60 / 42 —
close, and it is the only assignment that divides evenly into whole 3-game
series with every club playing every slot. Home/away splits 27/27.

Build it the way `lib/schedule.ts` builds football's: fixed round-robin rounds
for the structured part, then a randomised greedy perfect matching with
restarts for the rest. The pair graph is dense; it converges immediately.
**Assert before returning**: every club has exactly 54 series, exactly 27 home,
and every required pairing count is met. Football's builder has no such
assertion and it is why a season once played no football at all.

### 12.3 The phases

```
SPRING          1 press   — camp: NRIs, the last cuts, the Opening Day roster
REGULAR         54 presses (series 1..54), interrupted twice:
   ├── at series 30 → DRAFT      (the amateur draft; returns to REGULAR)
   └── at series 36 → the trade deadline passes (no phase change; a flag)
POSTSEASON      up to 4 presses — WC (Bo3), DS (Bo5), CS (Bo7), WS (Bo7)
OFFSEASON       3 presses over 5 steps
   ├── press 1: PROGRESS · ROLL_STATS · ACCRUE_SERVICE
   └── press 2: ADD_DRAFT_CLASS · OPEN_ROSTER_CRUNCH  → phase ROSTER_CRUNCH
ROSTER_CRUNCH   1 press out — the 40-man window: tender/non-tender, Rule 5
                protection, qualifying offers, arbitration filing
FREE_AGENCY     3 presses (weeks 1..3)  → back to SPRING
```

**Nine presses between the last out of the World Series and Opening Day**, of
which six ask a question. That satisfies the owner's standing 3-presses-to-free
-agency rule (`OFFSEASON` is 3, exactly as football's is) and adds the three
free-agency weeks football also has.

**The draft sits inside the season, and that is deliberate.** MLB drafts in
July. Moving it to the offseason would be a lie about the sport and would also
lose the best thing about its real placement: **the draft and the deadline land
six presses apart, which is exactly the pressure a real baseball GM feels — you
decide who you are in June and you act on it in July.** The phase machine
expresses it with one branch: on the way out of `DRAFT`, if
`seriesNo < TOTAL_SERIES` return to `REGULAR`, else to `POSTSEASON`. That branch
is legible and it is the only irregularity in the cycle.

`BbLeague.phase` values, exactly:
`SPRING | REGULAR | DRAFT | POSTSEASON | OFFSEASON | ROSTER_CRUNCH | FREE_AGENCY`

There is no fantasy-draft start mode in v1. Football's `FANTASY_DRAFT` has a
known-suspect completion condition documented as an open defect; do not inherit
the problem before the game exists.

### 12.4 Every step, what it does, and what it claims

`advanceSeries(leagueId)` is the single entry point. It takes the lease
(`BbLeague.advanceStartedAt`, 90s, timestamp) exactly as football does, then
switches on phase.

**SPRING** — one press.
- Claims: `phase: 'SPRING'` → `phase: 'REGULAR', seriesNo: 1` in one
  `updateMany`, *after* the work, because everything it does is idempotent.
- Work: build this year's schedule if absent (idempotent, keyed on
  `(leagueId, seasonYear)`); mint next year's draft class so it can be scouted
  all season (guarded on a count, as football's PRESEASON is); reset option
  usage for the new season; run `fillTeamsToRosterMinimum` for AI clubs;
  reconcile every club's lineup card, rotation and bullpen; zero
  `springInvitesUsed`.
- **Blocks** if the user's active roster is not exactly 26 or his 40-man exceeds
  40. Carries `block: { title: 'Set your Opening Day roster', href: 'roster', linkLabel: 'Open Roster' }`.
- Asks: the Opening Day roster. A real decision, and the first one of the year.

**REGULAR** — 54 presses, one series each.
- Claims: `seriesNo` compare-and-set at the top (`where: {seriesNo: n}, data: {seriesNo: n+1}`),
  then each of the 45 games claims itself (`where: {id, played: false}`), the
  way football's week does.
- Work per press: sim 45 games (15 matchups × 3); accrue one service day per
  active-roster player **per game day** (3 days); advance pitcher rest state;
  roll injuries and IL activations; run the development checkpoint every 6
  series; snapshot power rankings; generate wire items; roll a possible AI trade
  offer; recover fatigue.
- At `seriesNo === DRAFT_SERIES` (30) *after* the series plays: set
  `phase: 'DRAFT'` and open the draft. At `seriesNo === DEADLINE_SERIES` (36):
  nothing changes phase; `isTradeDeadlinePassed()` starts returning true.
- At `seriesNo > 54`: set `phase: 'POSTSEASON'`, seed the bracket, snapshot
  `BbTeamSeasonRecord`.
- Asks: lineup changes, call-ups, IL moves, waiver claims — none of them
  *required*, which is right. The press is the game.

**DRAFT** — a gated phase, no multi-advance offered.
- Runs in **chunks**, exactly as football's does: 12 picks per request with a
  3,500ms deadline checked between picks. 600 picks (20 rounds × 30) makes this
  mandatory, not optional. §22.4.
- On the way out: undrafted prospects leave the pool; shortlist rows for this
  draft are deleted; `phase` returns to `REGULAR`.

**POSTSEASON** — one press per *round*, not per game.
- Claims: `withRoundLock(leagueId, kind, seasonYear)` — a unique row per
  (league, year, round) inserted before the round is built, so two presses
  cannot build two brackets. Football shipped exactly that bug.
- Work: play the whole series (Bo3/Bo5/Bo7) inside the press, game by game,
  respecting rest — a 5-man rotation shortens to 4 in October, which is a real
  and legible difference and the reason a rotation's top is worth paying for.
- On the World Series completing: write `BbTeamSeasonRecord.playoffResult` for
  all 30 clubs, compute and record the season's awards, check the record book,
  and return `trophy` if the user's club won or was eliminated.

**OFFSEASON** — 3 presses over 5 steps, `BbLeague.week` a 1-based index into
`OFFSEASON_STEPS`, grouped exactly as football's.

```ts
const OFFSEASON_ADVANCES = [
  ['PROGRESS', 'ROLL_STATS', 'ACCRUE_SERVICE'],
  ['ADD_DRAFT_CLASS', 'OPEN_ROSTER_CRUNCH'],
] as const;
```

- `PROGRESS` — age every player one year, run the development/decline roll,
  retirement rolls, minor-league attrition, and **release-or-keep for unsigned
  players** (§15.5). Non-idempotent; the group claim is the only guard.
- `ROLL_STATS` — roll `seasonStats` into `careerStats` and `playoffStats` into
  `careerPlayoffStats`, write `BbPlayerSeason` rows from the played box scores,
  snapshot `BbTeamSeasonRecord`, bump `seasonYear`, reset standings, reseed the
  next draft order from the season actually played. **This is the step that
  moves the year**, so anything keyed on `seasonYear` must be read on the right
  side of it; the season-end announcement is keyed on the **step index**.
- `ACCRUE_SERVICE` — credit accumulated service days into whole years, compute
  each player's new service class, mark the newly arbitration-eligible and the
  newly free.
- `ADD_DRAFT_CLASS` — next year's class onto the board; extend the pick horizon
  three years out.
- `OPEN_ROSTER_CRUNCH` — set `phase: 'ROSTER_CRUNCH'`; compute every club's
  tender list, Rule 5 exposure list and qualifying-offer candidates; run the AI
  clubs' decisions immediately so the user's window is against a settled league.

**ROSTER_CRUNCH** — the gated window. One press out.
- Claims: `phase: 'ROSTER_CRUNCH'` → `'FREE_AGENCY'` **before** any work, rolled
  back to the exact prior state if the work throws. This is the transition
  football got wrong: the way out of `RESIGN` was the last one in the machine
  with no claim, and two concurrent presses each released the same men and each
  booked the same charge — a **double charge that idempotency alone would have
  concealed**.
- Work on the way out, in order: resolve every unsettled arbitration case
  (§17.5); non-tendered players become free agents (**the delete of the contract
  row is the claim**); Rule 5-exposed players are drafted by clubs with 40-man
  room; unaccepted qualifying offers convert to compensation entitlements; open
  free agency.
- **Blocks once per league year** if the user's 40-man is over 40 or if he has
  left more than N arbitration cases unaddressed, exactly as football's
  `resignWarnedYear` blocks once and then gets out of the way. Letting men walk
  is a legitimate decision; being ambushed by it is not. Column:
  `BbLeague.crunchWarnedYear`.

**FREE_AGENCY** — 3 presses, `week` 1..3.
- Claims: `week` compare-and-set.
- Work per press: run the AI signing wave; age every unsigned player's
  `weeksUnsigned` (which is what his asking price falls on); top up the fringe
  pool.
- On week 3 → `phase: 'SPRING'`, `seasonYear` already rolled, `week: 1`.

### 12.5 Multi-advance

Same component contract as football's (`components/AdvanceWeekButton.tsx` is
the model — read it for the pending/report/trophy plumbing). Targets offered,
and only where valid for the current phase:

| Target | Valid in | Stops at |
|---|---|---|
| Next series | REGULAR | +1 |
| Next 10 series (~a month) | REGULAR | +10 or the draft |
| To the draft | REGULAR, seriesNo < 30 | series 30 |
| To the deadline | REGULAR, 30 ≤ seriesNo < 36 | series 36 |
| To the end of the season | REGULAR | series 54 |
| Through the postseason | POSTSEASON | elimination or the title |
| To free agency | OFFSEASON | phase FREE_AGENCY |
| To Opening Day | FREE_AGENCY | phase REGULAR, series 1 |

No multi-advance on `DRAFT` or `ROSTER_CRUNCH` — gated phases, nothing valid to
skip into, and the control disappears rather than greying.

**One report per press-batch, never a stack.** Collect every intermediate
`SeriesReport`, fold them into a span strip (real per-series results, the record
at both ends), and render the panel for the *last* one. A GM who asked to skip
to the deadline has explicitly asked not to be stopped.

**The report panel must not sit on top of the Advance button.** Football
measured this by asking the browser what element sits at the button's
coordinates with the report open, and got the backdrop — 21 forced extra
dismissals a league year. The action row is pinned *inside* the panel; the
backdrop deliberately does not click through.

## 13. Positions, ratings and the attribute catalogue

### 13.1 Positions

```ts
export const BB_POSITIONS = [
  'C','1B','2B','3B','SS','LF','CF','RF','DH',   // hitters
  'SP','RP','CL',                                 // pitchers
] as const;
```

`DH` is a *lineup slot*, not a player's position — a player's stored
`position` is his primary defensive home, and `DH` is stored only for a man who
plays nowhere (an aging bat). `CL` likewise is a *role*, and closers are stored
as `RP` with a role on the pitching staff. **Store `SP` and `RP`; derive
closer.** A second stored value for a role that the bullpen chart already
decides is the two-sources-of-truth defect.

**Universal DH.** No pitcher batting. This is current MLB rules, it removes an
entire branch from the lineup engine, and it removes the double-switch, which
is a manager decision this game does not model.

### 13.2 The attribute catalogue

One flat namespace across all positions, exactly as `lib/ratings.ts` does it —
a position ignores what it does not weight. Each carries a `scoutDifficulty`
(0 = a radar gun or a stopwatch measures it, 1 = pure projection).

```ts
export const BB_ATTRIBUTES: AttributeDef[] = [
  // Hitting
  { key: 'contact',    label: 'Contact',        scoutDifficulty: 0.45 },
  { key: 'power',      label: 'Raw Power',      scoutDifficulty: 0.25 },
  { key: 'gamePower',  label: 'Game Power',     scoutDifficulty: 0.60 },
  { key: 'eye',        label: 'Plate Discipline', scoutDifficulty: 0.65 },
  { key: 'avoidK',     label: 'Bat-to-Ball',    scoutDifficulty: 0.50 },
  { key: 'vsLhp',      label: 'vs LHP',         scoutDifficulty: 0.70 },
  { key: 'vsRhp',      label: 'vs RHP',         scoutDifficulty: 0.70 },
  // Athletic
  { key: 'speed',      label: 'Speed',          scoutDifficulty: 0.10 },
  { key: 'baserunning',label: 'Baserunning',    scoutDifficulty: 0.55 },
  { key: 'stealing',   label: 'Basestealing',   scoutDifficulty: 0.40 },
  // Defence
  { key: 'glove',      label: 'Fielding',       scoutDifficulty: 0.55 },
  { key: 'range',      label: 'Range',          scoutDifficulty: 0.35 },
  { key: 'arm',        label: 'Arm Strength',   scoutDifficulty: 0.15 },
  { key: 'armAccuracy',label: 'Arm Accuracy',   scoutDifficulty: 0.50 },
  { key: 'framing',    label: 'Framing',        scoutDifficulty: 0.80 },  // C only
  { key: 'blocking',   label: 'Blocking',       scoutDifficulty: 0.55 },  // C only
  // Pitching
  { key: 'velocity',   label: 'Velocity',       scoutDifficulty: 0.05 },
  { key: 'control',    label: 'Control',        scoutDifficulty: 0.45 },
  { key: 'command',    label: 'Command',        scoutDifficulty: 0.75 },
  { key: 'movement',   label: 'Movement',       scoutDifficulty: 0.55 },
  { key: 'breaking',   label: 'Breaking Ball',  scoutDifficulty: 0.50 },
  { key: 'offspeed',   label: 'Changeup',       scoutDifficulty: 0.55 },
  { key: 'groundBall', label: 'Ground-Ball Tilt', scoutDifficulty: 0.60 },
  { key: 'stamina',    label: 'Stamina',        scoutDifficulty: 0.40 },
  // Shared / intangible
  { key: 'durability', label: 'Durability',     scoutDifficulty: 0.85 },
  { key: 'makeup',     label: 'Makeup',         scoutDifficulty: 0.95 },
  { key: 'baseballIq', label: 'Instincts',      scoutDifficulty: 0.80 },
];
```

`vsLhp` / `vsRhp` are the platoon split and are **deliberately a pair of
attributes rather than one signed number**, so a man can be good against both
(a true everyday player), good against one (a platoon bat), or bad against both.
One signed number cannot express the first and the last.

`power` vs `gamePower` is the sport's real distinction and one of the best fog
mechanics available: raw power is measurable in batting practice
(`scoutDifficulty: 0.25`) and game power is a projection (`0.60`). A prospect
with 70 raw and 40 game is a *specific, recognisable* kind of bust, and the fog
model can produce him honestly.

### 13.3 Overall, and how it is displayed

`computeOverall(position, attrs)` is a weighted mean of that position's
weighted attributes, exactly as football's is, producing **0..99**.

`BB_POSITION_WEIGHTS` — the weights, which must sum to 1 per position:

| Pos | contact | gamePower | eye | avoidK | speed | glove | range | arm | framing | baseballIq |
|---|---|---|---|---|---|---|---|---|---|---|
| C | .17 | .15 | .10 | .06 | — | .12 | .04 | .08 | .18 | .10 |
| 1B | .22 | .30 | .16 | .08 | .02 | .10 | .04 | .02 | — | .06 |
| 2B | .20 | .16 | .13 | .07 | .06 | .16 | .12 | .04 | — | .06 |
| 3B | .19 | .24 | .13 | .07 | .02 | .14 | .08 | .09 | — | .04 |
| SS | .18 | .14 | .12 | .07 | .07 | .16 | .16 | .06 | — | .04 |
| LF | .22 | .27 | .15 | .08 | .05 | .10 | .08 | .02 | — | .03 |
| CF | .20 | .17 | .13 | .07 | .12 | .11 | .16 | .01 | — | .03 |
| RF | .21 | .27 | .14 | .08 | .04 | .10 | .07 | .06 | — | .03 |
| DH | .28 | .38 | .20 | .10 | — | — | — | — | — | .04 |

| Pos | velocity | control | command | movement | breaking | offspeed | stamina | durability |
|---|---|---|---|---|---|---|---|---|
| SP | .16 | .16 | .20 | .14 | .12 | .08 | .10 | .04 |
| RP | .22 | .16 | .18 | .16 | .18 | .04 | .02 | .04 |

**The tier bands and the colour ramp are copied from football exactly** — 88
gold, 78 accent, 68 accent2, 58 chalk, below that muted, each with its glyph.
Principle 3 is about the ramp, not about the sport, and a GM who plays both
games must read a gold 91 the same way in each.

**The 20-80 scale is a display spelling of the same number, never a second
number.** Baseball's scouting language is the 20-80 scale and immersion demands
it, but a second stored rating is the lying-metric defect by construction. So:

```ts
/** 0..99 → the 20-80 scouting grade. One number, two spellings. */
export function grade2080(v: number): number {
  return Math.max(20, Math.min(80, Math.round((v - 50) * 0.6 + 50) / 5) * 5);
}
```

Attribute *rows* on a player card are spelled in 20-80 (`Raw Power 65`). The
**overall chip stays 0..99**, because the whole design system, every roster
sort, every trade table and every rating tier speaks it, and because the
Madden-facing audience reads it instantly. Say so in the glossary once:
`tip('grade2080')`.

### 13.4 Position flexibility

`BB_RELATED_POSITIONS` follows the defensive spectrum:

```
SS → 2B, 3B, CF        2B → SS, 3B, LF/RF     3B → 1B, LF/RF
CF → LF, RF, 2B        LF ↔ RF → 1B, DH        C  → 1B, DH (one way)
1B → DH                RP ← SP (one way, and it is an upgrade in stuff)
```

**This is not football's career change.** A baseball player carries a *set* of
positions he can cover, and the value of that set is that a bench of three can
cover eight spots, which lets a club carry a thirteenth pitcher. So:

- `BbPlayer.position` is his primary.
- `BbPlayer.secondaryPositions` is a JSON string array of positions he can play,
  each with a defensive penalty (0..1 multiplier on `glove`/`range` at that
  spot). Generated at creation; a spot may be **added** during a career by
  playing there (25 starts at a new position adds it at 0.85).
- Moving a man's *primary* is a real change, costs rating exactly as football's
  conversion does (`CONVERSION_ATTR_FRACTION` on the attributes the new job
  weights and the old one did not), and **the ceiling moves with the floor** —
  his `potential` travels with his rating, which is a bug football fixed and you
  should not re-introduce.
- **Assert no profitable conversion at module load**, the way `lib/ai/gm.ts`
  does: if relabelling a shortstop a first baseman makes him worth more on the
  trade curve, the game is a money printer. Football's assertion is
  outcome-based (build a synthetic player, convert him, compare trade value) and
  yours must be too. Baseball's live constraint is the reverse of football's:
  moving *down* the spectrum (SS→1B) must always lose value, because the bat
  bar at first base is far higher.

## 14. Player generation

`lib/baseball/gen/players.ts`, modelled on `lib/gen/players.ts`.

### 14.1 The organisational shape

Each club is generated with **26 major leaguers + 14 more on the 40-man + a
farm system of 96**, for 136 players per club, 4,080 in the league, plus a free
agent pool of ~180 and a draft class of 900.

| Level | Per club | Age band | OVR mean/sd | Note |
|---|---|---|---|---|
| MLB active | 26 | 22-38 | 72 / 8 | 13 hitters, 13 pitchers (§16.1) |
| 40-man, in the minors | 14 | 21-27 | 62 / 7 | the option-year population |
| AAA | 24 | 22-29 | 55 / 8 | includes org filler |
| AA | 24 | 20-25 | 50 / 8 | the real prospect layer |
| A+ | 24 | 19-23 | 45 / 8 | |
| A | 24 | 18-22 | 41 / 8 | |

`BB_GENERATION` constants (§27) mirror football's: `ATTR_SD` 7,
`POTENTIAL_BONUS_MEAN` 8 / sd 7 for pros, `PROSPECT_POTENTIAL_BONUS_MEAN` 20 /
sd 12 for teenagers (much wider than football's 14 — an 18-year-old's ceiling is
genuinely less knowable than a 22-year-old's), `ROSTER_OVR_FLOOR` 52 on a
major-league roster.

**Position distribution on a 26-man roster** — this is fixed, not sampled,
because a roster with two catchers is not a stylistic choice:

```
C 2 · 1B 1 · 2B 1 · 3B 1 · SS 1 · LF 1 · CF 1 · RF 1 · DH 1 · bench 3
SP 5 · RP 8
```
The three bench players are drawn from `{C-capable IF, utility IF, 4th OF}` and
must between them cover every defensive spot not covered by a starter.
**Assert it at generation**: every position in `{C,1B,2B,3B,SS,LF,CF,RF}` has at
least one man on the active roster who can play it. Football's twelve-man
defence shipped because nobody ever added a column up.

### 14.2 Handedness

`bats: 'L' | 'R' | 'S'`, `throws: 'L' | 'R'`. Real distribution:

| | L | R | S |
|---|---|---|---|
| Bats (hitters) | 31% | 60% | 9% |
| Throws (hitters) | 11% | 89% | — |
| Throws (pitchers) | 27% | 73% | — |

Constraints the generator must honour, because they are facts about the sport
and a violation reads as broken: **a catcher, second baseman, third baseman or
shortstop always throws right.** A first baseman may throw either. A left
fielder or right fielder may throw either; a centre fielder usually throws
right. A player who bats left throws left 55% of the time; a switch-hitter's
throwing hand is unconstrained.

### 14.3 Attribute generation

Identical two-pass method to football's: roll a target overall, sample each
attribute around a value that would produce it (heavier noise on unweighted
attributes), then nudge the weighted ones until `computeOverall` lands on
target. Baseball adds three shaping rules on top:

1. **Power and speed are negatively correlated.** After the first pass, apply
   `speed -= (gamePower - 50) * 0.25` clamped. A 75-power 75-speed player should
   be rare and should feel like a superstar, which is what the *star tier* is
   for.
2. **Velocity drives strikeouts, command drives walks, and they trade off.**
   `control -= (velocity - 50) * 0.15`. The 100-mph reliever who cannot find the
   plate is a real archetype and it should fall out of generation, not be
   special-cased.
3. **The platoon pair.** Draw `vsRhp` around the overall and set
   `vsLhp = vsRhp + platoonShift`, where `platoonShift ~ normal(+6, 9)` for a
   left-handed batter (they hit righties better) and `normal(-4, 7)` for a
   right-handed one, and `normal(0, 4)` for a switch-hitter. That reproduces the
   real asymmetry: platoon splits are much larger for lefties.

### 14.4 The star tier

Copied from football and it matters as much: an unweighted normal roll makes 99
structurally unreachable and the league never generates one.
`STAR_OVR_MEAN 89, SD 5.5, MIN 82`, 2-4 stars per club, and **the positions
stars land at are weighted, not uniform.** Baseball's weighting:

```
SP 3.0 · SS 1.4 · CF 1.3 · C 1.0 · RF 1.0 · 3B 1.0 · 2B 0.9 · LF 0.9 · 1B 0.8 · RP 0.7 · DH 0.3
```

Starting pitching is weighted heaviest because there are five per club and an
ace is the most valuable single asset in the sport. `DH` is weighted lowest
because a star bat is generated at a defensive position and *becomes* a DH.

## 15. Progression, aging, injury and attrition

### 15.1 The aging curves — and they differ by kind of player

Football has one `AGE_CURVE` with per-position peak shifts. Baseball needs
**three**, because a hitter, a starter and a reliever age differently enough
that one curve would be visibly wrong.

`BB_AGE_CURVE.HITTER` — peak 27, and it is a plateau, not a point:

| Age | Δ OVR/yr |
|---|---|
| ≤21 | +4.5 |
| 22-24 | +3.0 |
| 25-26 | +1.2 |
| 27-29 | +0.2 |
| 30-31 | −1.0 |
| 32-33 | −2.0 |
| 34-35 | −3.0 |
| 36+ | −4.5 |

`BB_AGE_CURVE.STARTER` — peak 26-28, and it declines *later but faster*, because
velocity loss is a cliff:

| Age | Δ |
|---|---|
| ≤22 | +4.0 |
| 23-25 | +2.5 |
| 26-28 | +0.3 |
| 29-31 | −1.2 |
| 32-34 | −2.5 |
| 35+ | −4.0 |

`BB_AGE_CURVE.RELIEVER` — peaks earliest and is the most volatile. Same table as
STARTER shifted one year earlier, with the year-to-year noise doubled
(`RELIEVER_VOLATILITY: 2.0` multiplying the RNG spread). **Reliever volatility
is a feature, not a defect**: the real sport's bullpens turn over violently, and
it is what makes a closer a bad long-term contract and a good trade chip.

Attribute-level, not just overall: `speed` and `range` decline from 27 and
decline fastest; `power` and `eye` hold to 32; `velocity` declines from 29;
`command` improves until 31. **Progression must move attributes and recompute
the overall**, never move the overall and back-fill the attributes, or the
player card will disagree with itself.

### 15.2 Minor-league development

The core loop of the sport and the thing football has no analogue for at all.

Each offseason, every minor leaguer rolls development toward his `potential`,
scaled by:
- his age relative to his level (a 21-year-old in AA develops faster than a
  25-year-old in AA),
- his `makeup` attribute,
- his performance that season relative to the level,
- the club's `playerDevelopment` staff rating (§26, `BbTeam.devRating`),
- his `devTrait` (`Slow / Normal / Star / Superstar`, copied from football).

`BB_PROGRESSION.LEVEL_TARGET_AGE = { A: 20, 'A+': 21, AA: 23, AAA: 25 }`. A
player more than 2 years above his level's target age develops at 0.4x — this
is what turns a stalled prospect into org filler, honestly and visibly.

**Promotion is automatic for AI clubs and manual for the user**, with a
recommendation. A player is promotion-ready when his OVR clears the next
level's median by 6 and he has 40+ games at his level. The front-office brief
names them.

### 15.3 In-season development

Copy `lib/development.ts`'s checkpoint model: every `CHECKPOINT_INTERVAL` = 6
series, apply a scaled share of a year's growth nudged by performance rank at
the player's own position. **Order the query** (`orderBy: { id: 'asc' }`) — the
RNG is consumed in loop order, so without an explicit order Postgres can hand
back rows in a different sequence and the "deterministic" checkpoint produces
different baseball. Football found this by running the same seed twice and
getting two answers.

The stat-leader bump: whoever is pacing the league in HR, AVG, RBI, SB, ERA,
strikeouts or saves gets a real bump to rating **and potential**, with a wire
item marking the moment.

### 15.4 Injuries and the IL

Football's `injuryWeeks` becomes **an IL stint with a designation**, because in
baseball the roster consequence *is* the mechanic.

```
BbPlayer.ilDesignation : null | 'IL10' | 'IL15' | 'IL60'
BbPlayer.ilDaysLeft    : Int
BbPlayer.injuryType    : String?   -- "Left oblique strain"
```

- A position player goes on the **10-day IL**, a pitcher on the **15-day**.
- The **60-day IL** is the lever: a player on it **does not occupy a 40-man
  spot**. It is available only after Opening Day and only for an injury of 60+
  days. A GM short a 40-man spot in July will go looking for someone to move to
  the 60-day, and that is a real, slightly grubby, entirely authentic decision.
- Service time **accrues on the IL**. This matters: it is why a club that wants
  to manipulate service time has to option a man to the minors, not injure him.

Rates, per player per season (real MLB: ~60% of players hit the IL at least
once; pitchers far more than hitters):

| | P(any IL stint) | mean days | note |
|---|---|---|---|
| Hitter | 0.42 | 28 | scaled by `durability` and age |
| Starter | 0.55 | 46 | |
| Reliever | 0.48 | 32 | |

Severity buckets and their flavour text (`INJURY_TYPES_SHORT/MEDIUM/LONG`
pattern from football): short (10-20d) — *"Left hamstring tightness", "Lower
back spasms", "Jammed thumb"*; medium (21-70d) — *"Left oblique strain", "High
ankle sprain", "Fractured hamate"*; long (71d+) — *"UCL sprain", "Torn
labrum", "Achilles rupture"*. **A pitcher's long bucket must include UCL/Tommy
John**, because a 14-month elbow is the injury that defines pitcher risk and its
absence would read as false.

**Fix football's bug while you are here.** The offseason progression step zeroed
a man's injury clock and left the injury *label* attached, so a torn hamstring
carried into a new season with nothing counting down — invisible, because every
reader gated on the clock. Clear `ilDesignation`, `ilDaysLeft` **and**
`injuryType` in the same statement, and assert it in INV-B09.

### 15.5 Attrition — do not inherit football's leak

Football's free-agent pool only ever grew: undrafted prospects became ordinary
free agents, and `progressAllPlayers` only touched `status: 'ACTIVE'`, so they
never aged, never retired and never left. A nine-season run ended with ~2,500
free agents and an unreadable market.

**Baseball's rules, applied at `PROGRESS`:**

- Every player in the league ages, whatever his status. One query, no status
  filter.
- **Minor-league attrition:** a player at A or A+ who is more than 3 years past
  his level's target age and below 45 OVR is **released out of professional
  baseball** (deleted from the league, with a `BbTransaction` row so his history
  survives) at 55%/yr. This is the real shape of a farm system: most of it
  washes out.
- **Free agents:** the same `yearsUnsigned`-driven attrition roll football
  eventually added, tuned so a pool that starts at ~180 stays between 120 and
  260 forever. Measure it over a 15-season headless run and put the number in
  the build log. **This is a calibration target (§28) and not a "looks fine".**
- Retirement: age- and rating-driven, with the "one more year" case — a player
  who is 36+ and unsigned through free agency retires at 70%.

## 16. The roster system

**State this to yourself before you build anything else: in football the
binding constraint is money. In baseball it is roster spots and option years.**
A club with $80M of payroll room and a full 40-man cannot sign anybody. That
inversion is the single most important thing to get right, and it is what makes
baseball's front office feel different from the ground up.

### 16.1 The three rosters

| Roster | Size | What it is |
|---|---|---|
| **Active (26-man)** | exactly 26 | Who can play today. Max 13 pitchers. |
| **40-man** | max 40 | Everyone the club controls at the major-league level. Includes the 26. |
| **The system** | unbounded | Everyone else under contract, at A / A+ / AA / AAA. |

Expands to **28** from series 50 (September) to the end of the regular season,
max 14 pitchers. Reverts to 26 for the postseason.

`BbPlayer.rosterLevel` is the one column that says where a man is:

```
'ACTIVE'   on the 26 (or 28)
'IL'       on the 26-man club but shelved; still on the 40-man unless IL60
'IL60'     shelved and OFF the 40-man
'OPTIONED' on the 40-man, playing in the minors
'MINORS'   under contract, not on the 40-man
'FA' | 'RETIRED' | 'DRAFTEE'
```

`BbPlayer.level` says which affiliate: `'MLB' | 'AAA' | 'AA' | 'A+' | 'A'`.
The two are separate on purpose — an `OPTIONED` player has a `level` of AAA and
a 40-man spot, a `MINORS` player has a level and no spot, and conflating them is
how a 40-man count comes to disagree with itself.

**One function answers "is this roster legal", and everything reads it.** This
is `lib/lineup.ts`'s lesson applied: `rosterLegality(teamId)` in
`lib/baseball/roster.ts` returns `{ active, activeMax, pitchers, pitcherMax,
fortyMan, fortyMax, uncoveredPositions, violations[] }`, and the Advance gate,
the roster page banner, the front-office brief and the nav badge all read it.
Three modules asking the question three ways produces a screen that disagrees
with the game.

### 16.2 Options

`BbPlayer.optionYearsUsed` (0..3) and `BbPlayer.optionedThisSeason` (bool).

- A player on the 40-man may be **optioned** to the minors freely. The first
  time he is optioned in a given season burns one option year; further moves
  that season are free.
- A player with **3 option years used is "out of options"**. Sending him down
  requires exposing him to waivers, where any club may claim him for nothing.
- A player optioned must stay down **15 days** before recall, unless replacing
  an IL move. `BbPlayer.optionedOnDay`.
- A 4th option exists for a player with fewer than 5 professional seasons.
  Model it: `optionYearsUsed < (proSeasons < 5 ? 4 : 3)`.

**Out of options is one of the best decisions in the sport** and the roster page
must name it in red on the row: a 26-year-old reliever out of options is either
on your team all year or somebody else's. The front-office brief item reads:

> **Out of options — 3 men.** Rojas, Hyun-Jin Park and Cavaletti cannot be sent
> down again without clearing waivers. Whoever you leave off the Opening Day
> roster, you will probably lose.

### 16.3 DFA, waivers, outright

Designated for assignment is how a 40-man spot is cleared:

1. **DFA.** The man comes off the 40-man immediately. The club has 7 days.
2. **Waivers.** Every other club sees him in reverse standings order and may
   claim him. A claim transfers him and his whole contract. Football has no
   analogue for a mechanism where *losing an asset for nothing* is a routine
   cost of doing business, and it is one of the sharpest feelings in the sport.
3. **Outright.** If he clears, a player with <3 years service and no prior
   outright goes to AAA and off the 40-man. A player with 3+ years or a prior
   outright may **elect free agency** and keep his salary — which means a
   veteran you DFA is simply gone.
4. **Release.** You owe him every guaranteed dollar. §18.4.

AI claim behaviour: a club claims when the player's value clears its own
40-man's worst man by a margin *and* the club has payroll room *and* has a need.
`BB_WAIVERS.CLAIM_MARGIN` = 1.15.

### 16.4 The minor-league system

Four full-season affiliates per club: AAA, AA, A+, A. `BbAffiliate` holds the
identity (city, nickname, abbr) so the farm reads as places rather than as
labels — principle 2, and a AAA club with a name and a crest is worth the row.

**Minor-league games are not simulated.** A minor leaguer gets a generated
season line from his talent, his level's run environment and a noise term, at
`ROLL_STATS`. This is the correct call and here is the honest accounting of it:
simulating four affiliate levels would multiply the league's game count by 4x
(2,430 → 12,150 games a season) and its box-score storage with it (§20.7),
for production nobody reads a box score of. What the player *does* get is a
per-season stat line by level, persisted as `BbPlayerSeason` rows exactly like a
major-league season, so a prospect's card shows his whole climb: 2029 A+ .291
14 HR, 2030 AA .276 22 HR, 2031 AAA .303 9 HR, 2031 MLB .244 4 HR. **The
generated line must be consistent with his ratings** so that a scout reading his
stats and a scout reading his tools reach the same conclusion — §22.3 makes this
load-bearing.

Level run environments (real MiLB, approximate):

| Level | AVG | OBP | SLG | K% | BB% | HR/game | ERA |
|---|---|---|---|---|---|---|---|
| AAA | .258 | .341 | .428 | 23.5% | 10.3% | 1.20 | 4.75 |
| AA | .245 | .326 | .383 | 23.0% | 9.8% | 0.90 | 4.10 |
| A+ | .243 | .330 | .376 | 24.5% | 10.5% | 0.80 | 4.15 |
| A | .240 | .330 | .360 | 25.0% | 11.0% | 0.65 | 4.05 |

### 16.5 Rule 5

Every offseason, inside `ROSTER_CRUNCH`:

- A player is **eligible** if he signed at 18 or younger and 5 minor-league
  seasons have elapsed, or signed at 19+ and 4 have — and he is not on the
  40-man.
- Protecting him means adding him to the 40-man, which costs a spot.
- Whoever is left exposed may be **drafted for $100,000** by any club with 40-man
  room, in reverse standings order.
- A Rule 5 pick **must stay on the drafting club's active roster (or IL) all
  season** or be offered back to his original club for $50,000.

This is a small mechanic that generates an outsized number of stories, and it is
the kind of thing principle 0 is about. Ship it.

### 16.6 The Opening Day roster gate

`SPRING` blocks the advance if the active roster is not exactly 26, the pitcher
count exceeds 13, the 40-man exceeds 40, or a defensive position is uncovered.
It carries a `block` with the roster page as its door and names the specific
violation. **It blocks every year, not once**, unlike the roster-crunch warning
— because an illegal Opening Day roster is not a decision a GM is allowed to
make, where letting men walk is.

## 17. Service time, arbitration and control

The single biggest structural addition. Football has nothing like it: a
football contract is the whole relationship, and here **a clock runs beside the
contract and outlives it.**

### 17.1 The clock

`BbPlayer.serviceDays: Int` — cumulative. **172 days is one full year of
service** and a season is 186 days, so a player who spends the whole year on the
active roster or the IL banks a year with 14 days to spare. Displayed as
`YYY.DDD` — `3.147` means three years and 147 days — because that is how the
sport spells it and a decimal year would be a different number wearing its name.

Accrual: **one day per game day on the active roster or any IL**, so a series
press credits 3 days to each of the 26 (or 28). A player who is optioned accrues
nothing. That is the whole mechanic, and everything below falls out of it.

`BbPlayer.serviceYears` and the remainder are **derived**, never stored:

```ts
export const SERVICE_DAYS_PER_YEAR = 172;
export const SEASON_DAYS = 186;
export function serviceLabel(days: number): string {
  return `${Math.floor(days / 172)}.${String(days % 172).padStart(3, '0')}`;
}
```

### 17.2 The three classes

| Class | Service | What it means |
|---|---|---|
| `PRE_ARB` | < 3.000 (or < Super Two) | Club sets the salary. Near the minimum. |
| `ARB` | 3.000–5.171, or Super Two | Salary decided by agreement or a hearing, once a year. |
| `FREE` | ≥ 6.000 | Free agent when his contract expires. |

**Super Two**: the top 22% of players with between 2.000 and 2.999 years, by
service time, become arbitration-eligible a year early. The cutoff moves each
year with the population; compute it, do not hardcode it. Recent real cutoffs
have been 2.115–2.146. It is the mechanic that makes a September call-up
expensive four years later, and a GM should be told about it before it bites:
the player card's contract tab shows `Super Two watch — he projects to clear the
cutoff` when a man is between 2.000 and 2.130 heading into an offseason.

**A player is under club control until 6.000 regardless of contract.** A
pre-arb player has no leverage at all and signs whatever he is given. That is
the sport, it is why teams are built through the farm, and it is what makes a
cost-controlled star the most valuable asset in the game (§23.1).

### 17.3 Salaries by class — the real anchors

| Class | Salary rule | Real anchor |
|---|---|---|
| Pre-arb | League minimum + a small merit bump | MLB minimum **$780,000** (2025). Pre-arb median ~$800k. |
| Arb 1 | ~35% of open-market value for his production | typical first-time arb $2M–$5M |
| Arb 2 | ~55% | |
| Arb 3 | ~75% | |
| Arb 4 (Super Two) | four bites: ~25 / 40 / 60 / 80% | |
| Free agent | 100% of market | league average salary ~**$4.9M**, median ~**$1.5M** |

`BB_ARB.SHARE_BY_YEAR = [0.35, 0.55, 0.75]` and
`SUPER_TWO_SHARE_BY_YEAR = [0.25, 0.40, 0.60, 0.80]`. A raise is **never
downward**: arbitration salary is floored at 80% of the prior year's, which is
the real rule and stops a bad season erasing a man's earnings.

### 17.4 Tender / non-tender

At `ROSTER_CRUNCH`, every arbitration-eligible player must be **tendered** a
contract or **non-tendered** (he becomes a free agent immediately, for nothing).

This is the sharpest annual decision in a baseball front office and it must be
one screen: every arb-eligible man, his projected arb salary, his production
last season, what a replacement costs, and one button each. The AI runs it on a
simple rule — non-tender when the projected salary exceeds his surplus value —
and the AI wave runs **before** the user's window opens so his decisions are
made against a settled league.

### 17.5 The arbitration hearing — the minigame, re-framed

For every tendered arb player, club and player **exchange figures**. Then:

- **Settle** anywhere between the two numbers, by agreement. Most cases settle;
  the real rate is roughly 90%.
- **Go to a hearing.** A three-person panel picks **one of the two filed
  numbers outright. It may not split the difference.**

**That last rule is what makes this a genuinely different minigame from free
agency, and it is the best thing in this specification.** In free agency you
are closing a gap. Here you are betting on credibility: an aggressive club
number wins you a lot if the panel buys your case and loses you everything if it
does not. The decision is not "how much" — it is "how far can I push before the
panel stops believing me".

The mechanics, reusing `lib/shared/negotiation/frame.ts`:

```
caseStrength = f(his production vs the arb comparables at his position and
                 service class, his counting stats, his awards, his platform
                 season vs his track record)
```

- `caseStrength` is a hidden number in [0,1], **never displayed**. What the GM
  sees is his agent's read in words, and his own analyst's — two opinions, which
  may disagree, and neither is a percentage.
- `P(club wins) = clamp(0.5 + (midpoint − filedGap) · k · caseStrength, .05, .95)`
  where the further the club's number sits below the honest midpoint, the worse
  its odds.
- Winning a hearing costs **player morale** (`BbPlayer.morale −8`) and shows up
  in his extension willingness for two years. Real clubs weigh exactly this.
- Settling costs nothing and lands at a value between the two filings weighted
  by `caseStrength`.

**The panel's verdict must be explicable after the fact.** The hearing result
screen prints the three or four comparables the panel weighed, with their
service class and their salary. A GM who loses must be able to see *why*, or the
mechanic is a coin flip with a costume on.

### 17.6 The qualifying offer

A club may make a departing free agent a **one-year qualifying offer** at the
mean of the top 125 salaries in the league (real 2025 value: **$21.05M**;
compute yours from your own league). He has the window to accept.

- Accept: he is yours for one year at that price.
- Decline and sign elsewhere: you receive a **compensation draft pick** after
  the first round, and the signing club **forfeits its second-highest pick**.
- A player may only ever receive one QO in his career, and only a player who
  spent the whole prior season with the club is eligible.

This is baseball's closest thing to the franchise tag and it is deliberately
*not* the same mechanic: the tag keeps a man, the QO mostly does not — it
converts him into a draft pick and makes him marginally harder to sign
elsewhere. Do not describe it as a tag in any copy.

### 17.7 Service-time manipulation — the decision, made legible

A player promoted after roughly **day 15 of the season** cannot reach 172 days
that year, so his six-year clock effectively starts a year later and the club
gets a seventh year of control.

**Ship it as a visible, priced decision, not as a hidden exploit.** When the
user calls up a prospect in the first three series of a season, the confirm
panel says, in the game's own voice:

> **Bringing Salazar up now costs you a year.**
> He needs 172 days of service to bank a full year, and 168 remain. Promote him
> now and he reaches free agency after the 2035 season. Hold him until the third
> series and he is yours through 2036 instead — one more year of a shortstop who
> profiles as an everyday man, at a price you set.
>
> He is also, right now, the best shortstop in your organisation.
>
> [ Promote him ] [ Leave him at Toledo ]

And it has a real cost on the other side, which is what stops it being a
free lunch:

- The club plays worse without him — priced by the sim, not by a rule.
- **The prospect promotion incentive:** a club that carries a top-100 prospect
  on its Opening Day roster and sees him finish top 2 in Rookie of the Year
  voting receives an **extra draft pick** after the first round. That is the real
  rule, and it exists precisely to price this decision. It makes the choice a
  genuine trade rather than an obvious one.
- Morale: the player and his agent notice. `morale −5`, and it shows in his
  extension willingness.

### 17.8 Extensions

A pre-arb or arb player may be offered a multi-year extension buying out his
remaining control years plus free-agent years. **This is where a smart GM makes
his money and it must be modelled properly:**

- Willingness is a function of service class (a pre-arb player takes a large
  discount for security; a 5.100 player takes almost none), age, and the
  proximity of free agency — `extensionLeverage(controlYears)` in football's
  negotiation module is exactly the right shape and the numbers change.
- The discount for buying out control years is real and large:
  `BB_EXTENSION.CONTROL_YEAR_DISCOUNT = 0.55` — a pre-arb star will sign away
  arb years at roughly 55% of their projected arb cost in exchange for
  guaranteed money now. Free-agent years attached to the same deal price at
  90-100% of market.
- Opt-outs and club options are the sweeteners. §18.3.

## 18. Money

There is no salary cap. The entire `assertCapRoom` / `capComplianceBlock` /
over-cap-blocks-advancement architecture is built on a hard league ceiling that
baseball does not have. **What replaces it is two different things that must not
be confused with each other: a gate and a price.**

### 18.1 The gate: the owner's payroll budget

Every club has an owner who authorises a payroll. That is the constraint a real
baseball GM actually operates under, it is fiction-honest, and — critically —
**it preserves the football architecture's single-door gate exactly.**

`BbTeam.payrollBudget` — set at league creation from the club's market size,
grown each year by revenue and by winning.

`assertPayrollRoom()` in `lib/baseball/payrollEnforcement.ts` is the one gate
every acquisition path runs through: signing, extension, arbitration award,
trade, waiver claim, Rule 5 pick, draft bonus. Same signature shape as
football's `assertCapRoom`, same `CapViolationError`-style class carrying relief
options, same reason for living in a database-touching module separate from the
pure arithmetic in `lib/baseball/payroll.ts`.

**Market tiers**, set at generation from a `marketSize` (1..10) per club:

| Market | Clubs | Opening budget | Real anchor |
|---|---|---|---|
| Large (9-10) | 6 | $230M–$300M | Dodgers, Mets, Yankees, Phillies |
| Mid (5-8) | 16 | $140M–$210M | the middle of the league |
| Small (1-4) | 8 | $75M–$130M | Athletics, Marlins, Pirates, Rays |

League median payroll ~$150M against a $241M tax line. That spread is the
sport's defining inequality and it must be visible: a small-market GM building
a contender on $95M is the best story this game can tell.

**The budget moves.** Each offseason:
```
newBudget = oldBudget × (1 + BASE_REVENUE_GROWTH)          // 0.035, real
          + WIN_BONUS      × (wins − 81)                    // $900k per win over .500
          + PLAYOFF_BONUS  × roundsReached                  // $6M per round
          + TITLE_BONUS                                     // $18M
          − TAX_PAID_LAST_YEAR                              // tax comes out of the budget
```
clamped to ±25% year over year, floored at the market tier's minimum. **The
owner's letter** (§31) delivers the new number at `ROSTER_CRUNCH` in his own
voice, and that letter is one of the best immersion beats available.

**Going over the budget is refused at the transaction, not at the advance.**
There is no compliance block on time. A club may sit over its budget — through
an arbitration award it lost, or a trade that backfired — and the consequence is
that it cannot add anybody until it sheds salary. Delete
`capComplianceBlock` entirely; **do not port it.** Nothing about being over
budget is illegal, so halting the clock would be a rule the sport does not have.

### 18.2 The price: the luxury tax

The Competitive Balance Tax. **This is a price, never a gate.** A club may cross
it freely; it simply costs money, and the money comes out of next year's budget.

Thresholds (real 2025 values; make them league constants that grow with the
budget curve):

| Tier | Threshold | Surcharge |
|---|---|---|
| Base | $241,000,000 | — |
| Tier 1 | $261,000,000 | +12% |
| Tier 2 | $281,000,000 | +45% |
| Tier 3 | $301,000,000 | +60%, **and the club's highest draft pick drops 10 slots** |

Base rate by consecutive years over the line: **20% / 30% / 50%**. Reset to 20%
by finishing a season under it. `BbTeam.taxYearsConsecutive` tracks it.

The taxable payroll is the **average annual value** of every contract on the
40-man plus benefits (~$17.5M per club, a flat constant), **not** actual salary.
That distinction is real and it matters: it is why a back-loaded contract does
not dodge the tax, and it is the reason `payrollCommitted` (cash this year) and
`taxPayroll` (AAV) are **two different numbers on the payroll page** and both
must be shown. Showing one and labelling it the other is the lying-metric
defect.

The tax bill is computed at `ROLL_STATS`, written as a `BbPayrollCharge` against
the **new** league year (dated by `payrollChargeYear()`, the one function, the
same discipline as football's `capChargeYear`), and subtracted from next year's
budget. **A GM must be told the bill before he incurs it**: every transaction
panel that would push a club over a threshold prints the marginal tax cost of
that specific move, in dollars, on the button.

> Signing Mora at $28.0M takes you $12.4M past the tax line.
> At your rate (second straight year, 30%) that is **$3.7M in tax**, and it
> comes out of next year's budget.

### 18.3 Contract shapes

A `BbContract` is:

```
years, yearsRemaining, signedYear
salaries      JSON number[]   -- actual cash by year, index 0 = current
aav           Int             -- total value / years; the tax number
guaranteed    Int             -- almost always the full value
deferred      JSON            -- [{ year, amount }] money paid after the deal ends
optOutAfter   JSON number[]   -- years after which the PLAYER may opt out
clubOptions   JSON            -- [{ year, salary, buyout }]
noTrade       'NONE'|'PARTIAL'|'FULL'
signingBonus  Int             -- paid up front; counts toward AAV, NOT prorated for the cap
```

**Baseball contracts are fully guaranteed.** There is no proration, no dead
money concept, no post-June-1 split, no void years. Releasing a man means you
owe him every remaining dollar and it lands on your payroll in the years it was
always going to land in. **This is simpler than football and much harsher**, and
the copy must say so plainly, because a GM arriving from the football game will
assume a cut saves him something:

> `tip('release')`: *Releasing a man does not save you a dollar. Every year of
> his deal is guaranteed, and you pay it whether he plays for you or for
> somebody else. What a release buys is the roster spot.*

**Deferrals** are the one baseball-specific trick and they are worth shipping:
money moved past the end of the deal reduces the AAV for tax purposes by a
present-value discount (real rule: discounted at the federal mid-term rate;
use `BB_CONTRACT.DEFERRAL_DISCOUNT = 0.045`/yr). A GM who defers is buying tax
relief today against a bill that arrives when he may not be here. That is a
genuine, legible, slightly dangerous lever and it is the closest analogue to
football's restructure — with the crucial difference that it **cannot be used to
escape a bad deal**, only to reshape one.

**INV-B31 (the conservation rule) applies here exactly as INV-21 does in
football**: rewriting a contract moves money, it never creates or destroys any.
Deferral, extension, option exercise and buyout must each conserve total dollars
committed, and each gets a standalone arithmetic harness with a canary. §29.

### 18.4 The payroll page

`payrollSummary(teamId, year)` returns, and the page shows, both numbers and
never one wearing the other's label:

```ts
interface PayrollSummary {
  budget: number;            // what the owner authorised
  cashPayroll: number;       // salaries actually paid this year
  taxPayroll: number;        // AAV of the 40-man + benefits
  budgetRoom: number;        // budget − cashPayroll
  taxLine: number;           // this year's base threshold
  overTaxBy: number;         // 0 if under
  taxRate: number;           // by consecutive years and tier
  projectedTaxBill: number;
  deadSalary: number;        // owed to men no longer on the roster
  commitments: number[];     // the next 6 years of guaranteed money
  arbProjections: number;    // next year's arbitration class, projected
}
```

`deadSalary` is the release ledger and it is the one place football's
`CapCharge` model transfers directly: `BbPayrollCharge` rows, keyed on
`(teamId, year)`, **with a real foreign key to `BbTeam` and `onDelete:
Cascade`**, hung off the team and not off the contract, for exactly the reason
football's is (§5.2). Do not repeat the 18,247-orphan bug in a new table.

The **six-year commitment ladder** is the panel a baseball GM lives on and
football has no equivalent of at this depth: guaranteed money, arbitration
projections and open room, year by year, six years out. It is exactly the kind
of depth principle 0 calls the differentiator, and it goes on the page rather
than behind an Advanced toggle.

## 19. The lineup card, the rotation and the bullpen

Football's depth chart is one ordered list per position. Baseball needs three
different objects with three different rules, and — following `lib/lineup.ts`'s
lesson — **each of them is defined in exactly one place and everything that
decides who plays reads it.**

### 19.1 The lineup card

**Two cards: one against right-handed starters, one against left-handed.** The
sim picks the card from the opposing starter's throwing hand. This is the single
best value-for-effort mechanic in the whole design: it is cheap to model, it
makes the bench a real construction problem, and it is a decision a GM makes
once that the game honours 162 times.

`BbLineupCard` rows: `(teamId, vsHand: 'L'|'R', battingOrder: 1..9, playerId,
fieldPosition)`. Nine slots, nine distinct players, every defensive position
`{C,1B,2B,3B,SS,LF,CF,RF}` filled exactly once plus one `DH`.

`lib/baseball/lineup.ts` owns:
- `LINEUP_SLOTS = 9` and the defensive position set, **asserted at module load**
  the way football asserts eleven — if the set of positions on a card is not
  exactly the eight fielders plus DH, throw at import.
- `autoLineup(roster, vsHand)` — the auto-sort, ordering by a real batting-order
  heuristic rather than by rating: **best OBP leads off, best overall bats
  second, best power third, next power fourth**, then descending. That is the
  modern convention and it is what a knowledgeable player expects to see when he
  presses Auto.
- `lineupGaps(roster)` — the same shape as football's: which defensive positions
  have nobody **available** for them (not merely nobody rostered), using the
  same availability test the engine uses.
- `effectiveHitter(player, vsHand)` — the platoon-adjusted rating the sim reads,
  blending `vsLhp`/`vsRhp` into the overall. **One function, read by the sim,
  the lineup screen and the AI.**

**Availability filtering happens before the card is read**, exactly as football
filters unavailable players before depth order. A GM must never be asked to
reorder around an injured man; his backup plays on his own. Football shipped the
opposite instruction on a tile for months — *"Injured Starters 3 — reorder
before kickoff"* — which was false, cost twenty-five presses a year, and left
GMs having permanently demoted a man who healed in a fortnight.

Rest days: a position player sits roughly **1 game in 12** (a regular plays
~148 of 162). The engine picks the rest day itself, choosing the man whose
`fatigue` is highest, and substituting the best bench player who covers his
position. The GM is told in the series report; he is not asked.

### 19.2 The rotation

`BbPitchingStaff` holds an ordered array of 5 starter ids plus the bullpen chart.

- The rotation turns over game by game: game *n* of the season is started by
  rotation slot `n % 5`. 162 games gives each slot **32-33 starts**, against a
  real ~32 for a healthy front-line starter.
- A starter is available on **4 days' rest**. With 3-game series and no modelled
  off days, slot *k* starts games k, k+5, k+10 …, so the rule is satisfied by
  construction in the regular season.
- **In the postseason the rotation shortens to 4** (3 in a best-of-3), and
  starting on 3 days' rest costs `SHORT_REST_PENALTY = 6` rating points and
  triples the injury roll. This is the whole reason a top-of-rotation arm is
  worth what it is worth, and it should be visible: the postseason series screen
  names who is starting each game and on how much rest.
- A starter who is unavailable (IL, or a rest violation) is replaced by the
  club's designated **long man** from the bullpen, at a penalty. If none, the
  best available AAA starter is called up automatically for AI clubs and offered
  to the user.

### 19.3 The bullpen — genuinely new, and the one mechanic with no football analogue at all

Roles, in the order the engine reaches for them:

| Role | Count | When |
|---|---|---|
| `CLOSER` | 1 | 9th inning, lead of 1-3 runs |
| `SETUP` | 2 | 8th inning, or a high-leverage 7th |
| `MIDDLE` | 3 | 6th-7th, or any inning once the starter is out |
| `LONG` | 2 | the starter exits before the 5th; multi-inning |

**Availability is the mechanic.** `BbPlayer.restState` is a JSON array of the
last 4 game-indices in which he pitched, plus pitch counts:

```ts
interface RestState { games: { gameIndex: number; pitches: number }[] }
```

Rules, tuned to real usage (a reliever appears in ~65 of 162 games, ~15% of
appearances on zero days' rest, essentially never three days running):

```ts
export function relieverAvailable(rs: RestState, gameIndex: number): 'FULL'|'LIMITED'|'NO' {
  const back1 = rs.games.some(g => g.gameIndex === gameIndex - 1);
  const back2 = rs.games.some(g => g.gameIndex === gameIndex - 2);
  const last3 = rs.games.filter(g => g.gameIndex >= gameIndex - 3).length;
  const heavy  = rs.games.find(g => g.gameIndex === gameIndex - 1 && g.pitches >= 30);
  if (back1 && back2) return 'NO';        // three in a row: never
  if (heavy) return 'NO';                 // 30+ pitches yesterday
  if (last3 >= 3) return 'NO';
  if (back1) return 'LIMITED';            // available, but for one inning only
  return 'FULL';
}
```

A starter's version is simpler and reads the same way: available if
`gameIndex − lastStart >= 5`, `LIMITED` at 4, `NO` below.

**The bullpen screen shows availability for the next three games as a grid**,
because the decision a GM actually makes is "who do I have for this series", and
a single available/unavailable pill on today cannot answer it. Green / amber /
grey per man per game, with the reason on hover: *"Threw 34 pitches Tuesday."*

**A club that runs its bullpen into the ground pays for it and must be told.**
A reliever used at above `BB_BULLPEN.WORKLOAD_WARN = 70` appearances pace or
`1100` pitches pace carries a rising injury multiplier and a rating decay
through September. The front-office brief names him:

> **Ferreira has thrown in 9 of the last 14.** He is your best arm and he is
> pitching like a man who has thrown in 9 of the last 14. The bullpen has two
> other men with a full night's rest.

### 19.4 What the GM sets, and what the engine decides

**The GM sets:** two lineup cards, the rotation order, the bullpen role chart,
and who is on the 26. **The engine decides:** who rests today, which reliever
enters and when, pinch-hitters, and when a starter is pulled.

That split is the same contract football's depth chart offers — set it once, the
sim honours it — and it is the right level. A GM who wanted to manage the eighth
inning would be playing a different game, and 162 of them is not a game anybody
finishes.

## 20. The simulation engine, specified to implementation

`lib/baseball/sim/engine.ts`. **The unit is the plate appearance.**

### 20.1 Why this engine is better than football's, and what that buys you

Football's engine simulates drives and then **allocates** individual stat lines
from team totals by depth weight. That allocation is the source of an entire bug
family: `scripts/checkBoxScore.ts` was written with six conservation clauses and
**all six failed** — 30.6% of touchdown passes reached no player, receiving
yards ran 8.5% ahead of passing yards, a quarterback's rushing yards were
conjured out of nothing at eleven thousand phantom yards a league-season. It is
also why a linebacker's rating was uncorrelated with his tackles (r = 0.082):
production came from a depth-chart share, not from the player.

**A plate-appearance engine accumulates. It does not allocate.** Every hit in
the box score was hit by the man the sim said hit it, off the man the sim said
threw it. The conservation clauses become *true by construction* rather than
things you have to hunt for, and **ratings predict production by construction**,
because a batter's outcome probabilities *are* his ratings.

You must still measure both (§28, §29). "True by construction" has been wrong
here before.

### 20.2 The outcome model

For each plate appearance, roll one outcome from:

```
K · BB · HBP · HR · 3B · 2B · 1B · ROE · OUT_GB · OUT_FB · OUT_LD · SF
```

Combine batter talent, pitcher talent and the league baseline with the
**odds-ratio (log5) method**, which is the standard analytic tool for exactly
this problem, is one line, and is honest:

```ts
/** Batter rate b against pitcher rate p in a league where the rate is lg. */
export function log5(b: number, p: number, lg: number): number {
  const num = (b * p) / lg;
  const den = num + ((1 - b) * (1 - p)) / (1 - lg);
  return den <= 0 ? lg : num / den;
}
```

Applied in this order, each stage conditioned on the previous — this ordering is
the whole model and it must not be rearranged:

1. **P(K)** — `log5(bK, pK, LG.K)`, then modified by count-independent
   adjustments (§20.3).
2. **P(BB | not K)** — `log5(bBB, pBB, LG.BB)`.
3. **P(HBP | not K, not BB)** — near-constant; `LG.HBP` scaled slightly by
   pitcher `control`.
4. **P(HR | ball in play)** — `log5(bHR, pHR, LG.HR_PER_BIP)`, then multiplied
   by the park's HR factor and the handedness adjustment.
5. **BABIP** — `log5(bBABIP, pBABIP, LG.BABIP)`, further modified by the
   fielding quality of the defence behind the pitcher (§20.5). A hit on a ball in
   play is then split into 1B / 2B / 3B by the batter's `power` and `speed`
   against the park's doubles/triples factors.
6. **Outs in play** split into GB / FB / LD by the pitcher's `groundBall` tilt.
   A GB with a man on first and fewer than two out rolls a **double play**.
   An FB with a man on third and fewer than two out rolls a **sacrifice fly**.
7. **Reached on error** — `LG.ROE` scaled by the fielding quality of the
   position the ball was hit to.

**Deriving a player's true rates from his ratings.** Each rate is a logistic
map of the driving attribute(s), centred so that a 50-rated player produces
exactly the league rate:

```ts
const rate = (leagueRate: number, z: number, spread: number) =>
  1 / (1 + Math.exp(-(Math.log(leagueRate / (1 - leagueRate)) + z * spread)));

// Batter
bK     = rate(LG.K,          −(avoidK   − 50) / 50, K_SPREAD);      // 1.10
bBB    = rate(LG.BB,          (eye      − 50) / 50, BB_SPREAD);     // 1.05
bHR    = rate(LG.HR_PER_BIP,  (gamePower− 50) / 50, HR_SPREAD);     // 1.50
bBABIP = rate(LG.BABIP,      ((contact  − 50) * 0.7 + (speed − 50) * 0.3) / 50, BABIP_SPREAD); // 0.40

// Pitcher
pK     = rate(LG.K,          ((velocity − 50) * 0.6 + (breaking − 50) * 0.4) / 50, K_SPREAD);
pBB    = rate(LG.BB,         −((control − 50) * 0.7 + (command − 50) * 0.3) / 50, BB_SPREAD);
pHR    = rate(LG.HR_PER_BIP, −((movement − 50) * 0.5 + (command − 50) * 0.5) / 50, HR_SPREAD);
pBABIP = rate(LG.BABIP,      −((movement − 50) * 0.4 + (command − 50) * 0.2) / 50, BABIP_SPREAD * 0.5);
```

The `BABIP_SPREAD` on pitchers is deliberately **half** the batter's, and it is
the one number in this model with a real analytic finding behind it: pitchers
have far less control over balls in play than hitters do (this is why FIP
exists). Getting that asymmetry right is what makes a strikeout pitcher more
valuable than a contact pitcher with the same ERA, which is a thing a
knowledgeable player will check.

`HR_SPREAD` is the largest at 1.50 because home-run rate is the most
player-driven outcome in baseball; `BABIP_SPREAD` is the smallest at 0.40
because it is the least.

### 20.3 The modifiers, in the order they apply

**Handedness.** The batter's effective rating is `effectiveHitter(player,
pitcherThrows)`, blending `vsLhp`/`vsRhp` (§19.1). A **switch-hitter always bats
from the advantaged side**, which is exactly why he is worth carrying.

**Park.** `BbTeam.parkFactors` is a JSON blob of five multipliers applied to
the *home park* for both clubs: `{ hr, doubles, triples, babip, runs }`. Real
spread: HR factors run 0.80 (Oakland-ish) to 1.35 (Cincinnati-ish); BABIP 0.96
to 1.04. Generate each club's park at league creation from its market and a
seed, name it, and **put the factors on the club page** — park identity is one
of the cheapest and most beloved pieces of texture in the sport.

**Fatigue.** A pitcher's effective rating degrades within a start: the third
time through the order costs `TIMES_THROUGH_PENALTY = 4` rating points, the
fourth costs 9. This is the real "times through the order penalty" and it is
what makes the decision to pull a starter legible. A reliever on `LIMITED`
availability (§19.3) pitches at −5.

**Difficulty.** `DIFFICULTY_MODS[difficulty].aiUnitBonus` tilts every AI club's
hitters and pitchers and never the user's, exactly as football does. Baseball's
values: `EASY −1.5 / NORMAL 0 / HARD +2.25` rating points.

**Variance.** `settings.simVariance` scales two things and only two: a per-game
`gameForm` roll per club (`normal(0, GAME_FORM_SD × variance)`, SD 2.5 rating
points, applied to every player on that club that day) and the RNG spread on the
BABIP draw. At 0 the better club wins nearly every time; at 2 the league is
chaos.

### 20.4 Assembling a game

```
for inning in 1..9 (or until the home club leads after the top of the 9th):
  for each half-inning:
    outs = 0; bases = [null, null, null]
    while outs < 3:
      batter  = lineup[order++ % 9]
      pitcher = currentPitcher(club)
      outcome = rollPA(batter, pitcher, context)
      advanceBases(outcome, bases, batter, outs) -> runs scored
      creditStats(batter, pitcher, outcome, runs)
      maybeStealAttempt(bases, outs)
      maybePullPitcher(club, inning, score, pitcherState)
  if tied after 9: extra innings, runner on second to start each half (current rules)
```

**Base advancement** is a small deterministic table plus one roll, and it must be
written out rather than approximated, because runs are the output everything is
calibrated against:

| Outcome | Batter to | Runners advance | Extra |
|---|---|---|---|
| HR | home | all score | — |
| 3B | 3rd | all score | — |
| 2B | 2nd | 2nd/3rd score; 1st scores 45% else to 3rd | — |
| 1B | 1st | 3rd scores; 2nd scores 32% (55% with 2 out, +speed) else to 3rd; 1st to 2nd, to 3rd 28% | — |
| BB/HBP | 1st | forced only | — |
| SF | out | 3rd scores | +1 out |
| GIDP | out | lead runner out | +2 outs |
| OUT_GB/FB/LD | out | none | +1 out |
| ROE | 1st | as a single | +0 outs |

**Stolen bases.** A runner on first with second empty attempts at
`P = f(stealing, speed, catcher arm+framing)`, tuned so the league runs **0.72
SB attempts per team-game at a 79% success rate** (real 2024, post-rule-change).
Success is `log5(runnerSteal, catcherHold, LG.SB_SUCCESS)`.

**Pulling the starter.** Pull when any of: pitch count > `stamina`-derived limit
(mean 95, ±15 by `stamina`), 4+ runs allowed and past the 4th, times-through-the
-order ≥ 3 and a runner on with the tying run at the plate, or the 7th inning
with a lead of ≤ 3 (hand it to setup). **The GM does not press a button for
this**; he set the bullpen chart and the engine executes it.

### 20.5 Defence

Defence enters in exactly two places, and this is deliberate — a full
fielding model would be a second engine:

1. **`pBABIP` is adjusted by the defence's aggregate range.** Compute a club
   `defenceIndex` = weighted mean of the eight fielders' `range`/`glove` at
   their positions (CF, SS and C weighted highest), and shift the BABIP odds by
   `(defenceIndex − 50) / 50 × DEFENCE_BABIP_SPREAD` (0.35). A club with a
   great defence turns hits into outs, which is exactly what a great defence
   does, and it means a glove-first shortstop is worth signing.
2. **Errors** are rolled per ball in play against the fielder at the position it
   was hit to, driven by `glove` and `armAccuracy`. Real: **0.55 errors per
   team-game**, ~0.62 unearned runs per team-game.

Individual fielding stats recorded: `putouts`, `assists`, `errors`,
`defensiveGames` by position. That is enough to award a Gold Glove honestly and
not enough to pretend to a defensive-runs-saved metric the engine cannot
support. Principle 6.

### 20.6 Catcher framing

`framing` is in the attribute list because catcher defence is the largest
non-obvious edge in the sport and it makes the position matter. It enters as a
small shift on the pitcher's `pK` and `pBB` for every PA that catcher catches:
`± (framing − 50) / 50 × FRAMING_SPREAD` (0.10). Real framing spread is worth
roughly ±15 runs a season between the best and worst catchers, which this
reproduces. It is invisible in the box score and visible in the standings, which
is exactly right and is worth one glossary entry so a GM can find out why his
pitching staff got better when he signed a catcher who cannot hit.

### 20.7 Compute and storage — the real numbers

**Compute is a non-issue.** Measured shape:

| | Football | Baseball |
|---|---|---|
| Games per season | 272 | 2,430 |
| Units per game | ~20 drives | ~76 plate appearances |
| Units per season | 5,440 | **184,680** |
| Games per Advance press | 16 | **45** |
| Units per press | 320 | **3,420** |

At a realistic 1-2µs per PA (a dozen arithmetic operations and 3-5 RNG draws in
V8), a press costs **3-7ms of simulation** and a whole season **0.2-0.4s**.
Football's heaviest single advance is measured at ~1.9s and is dominated by
database work, not by simulation. Baseball's will be too.

**The bill is I/O, and it is a real constraint. Design for it on day one.**

Football's draft measured **31.2 database round trips per pick**: free locally
at 0.1ms RTT, 29-190 seconds in production. That lesson applies twice here:

- **One transaction per series press, with bulk writes.** 45 games must not be
  45 transactions. Follow `lib/season.ts`'s `bulkSetInt` / `bulkSetText` /
  `bulkIncrementInt` helpers — a single `UPDATE ... FROM (VALUES ...)` per column
  across every affected player. Target: **≤ 60 round trips per series press.**
- **The 600-pick draft runs in chunks**, 12 picks with a 3,500ms deadline
  checked between picks, exactly as football's does. §22.4.

**Storage is the constraint nobody expects and it must be solved before Phase 3
ships.**

| | Per game | Per season | 20 seasons |
|---|---|---|---|
| Football box scores | ~4KB | ~1.1MB | ~22MB |
| Baseball, naive JSON | ~3.5KB | **~8.5MB** | **~170MB** |
| Baseball, compact (below) | ~1.1KB | **~2.7MB** | **~54MB** |

Neon's free tier is 0.5GB across all saves. Naive encoding puts three
twenty-season dynasties over it.

**The compact box score, and it is not optional:**

```ts
interface BbBoxScore {
  h: { id: string; abbr: string }; a: { id: string; abbr: string };
  line: { h: number[]; a: number[] };          // runs by inning
  rhe: [number, number, number, number, number, number];  // hR,hH,hE,aR,aH,aE
  /** Per-game roster index → playerId. Every stat line below indexes into this. */
  ids: string[];
  /** Batters: [idx, ab, r, h, 2b, 3b, hr, rbi, bb, k, sb, cs, po, a, e] */
  bat: number[][];
  /** Pitchers: [idx, outs, h, r, er, bb, k, hr, pitches, dec] dec: 0 none 1 W 2 L 3 S 4 H */
  pit: number[][];
  /** Scoring plays, for the recap: [inning, half, idx, outcomeCode, rbi] */
  sco: number[][];
}
```

Arrays of numbers rather than objects of named keys, and one interned id table
per game. Nothing is lost — every named field is recoverable by position, and
the positions are documented in `lib/baseball/types.ts` next to the interface.

**And the pruning policy, which is a real departure from football and must be
stated rather than done quietly.** Football's `PlayerSeason` model exists
because box scores are *never deleted* and can always be replayed. Baseball
cannot hold that promise at 2,430 games a year. So:

- `BbPlayerSeason` rows are written at `ROLL_STATS` from the played box scores,
  **before** anything is pruned, and they are the permanent record.
- Box scores older than **3 completed seasons** are compacted to
  `{ line, rhe, sco }` — the line score, the totals and the scoring plays. The
  game page for an old game still shows a real line score and a real recap; it
  loses the individual box lines, which nobody has ever opened for a game eleven
  seasons ago.
- **Postseason games are never pruned**, ever. A World Series box score is
  history and principle 0 governs.
- Pruning runs inside `ROLL_STATS`, after the `BbPlayerSeason` write, in the
  same transaction, and it is the only thing entitled to delete a box score.

Put that whole policy in `BASEBALL.md` under "Known simplifications", in the
same voice football's are written in, because it is a deliberate shipped
limitation and a GM might notice it.

## 21. Statistics, and the two things you may not ship

Principle 0 says depth is the differentiator — *"i'm a stickler for the cap and
stats to have such depth"*. Principle 6 says a metric borrowed from the real
sport must be the real metric or must not carry the name. Baseball is where
those two pull hardest.

### 21.1 What the engine records

**Batting:** `g pa ab r h 2b 3b hr rbi bb ibb hbp so sb cs sf sh gidp`
**Pitching:** `g gs outs w l sv hld bs h r er bb hbp so hr bf pitches`
**Fielding:** `gPos po a e dp` per position

Everything below is derived from those, at read time, by
`lib/baseball/stats.ts`. **Nothing derived is ever stored**, for the same reason
football never stores dynasty level: a stored derived number is a number that
can disagree with its own formula, and this project has shipped that bug more
than once.

### 21.2 What you ship, and it is a lot

**Rate:** AVG, OBP, SLG, OPS, ISO, BABIP, BB%, K%, SB%.
**Counting:** everything above, plus TB and XBH.
**Pitching:** ERA, WHIP, K/9, BB/9, HR/9, K/BB, H/9, opponent AVG, IP as the
sport spells it (`184.2` = 184⅔), quality starts, saves, blown saves, holds.
**Contextual, and all four are honestly computable from league totals this
game holds:**

- **FIP** = `(13·HR + 3·(BB+HBP) − 2·K) / IP + C`, where the constant `C` is
  computed each season as `leagueERA − ((13·HR + 3·(BB+HBP) − 2·K)/IP)` across
  the whole league. This is the exact real formula, it needs nothing the engine
  does not record, and it is the single most useful pitching stat a GM can have.
  **Ship it, and compute `C` per season rather than hardcoding 3.10.**
- **OPS+** = `100 × (OBP/lgOBP + SLG/lgSLG − 1)`, park-adjusted by the club's
  own park factor. Exact formula, exact inputs.
- **wRC+** — computable, since the engine records every event wOBA needs. Use
  the real linear weights, recomputed per season from the league's own run
  environment rather than borrowed from a real season: this league's run values
  are not MLB's and using MLB's would be a lying metric by a hair.
- **ERA+** = `100 × lgERA / ERA`, park-adjusted.

### 21.3 What you may NOT ship: WAR

**WAR is the EPA of this game.** It requires positional adjustments, a
replacement-level baseline calibrated to a real league's total wins, park
factors applied per-component, and a defensive-runs-saved input this engine
cannot produce (§20.5 records putouts, assists and errors — not range-based
run values). A "simplified WAR" is a different fiction wearing the most
recognisable name in baseball analytics, and shipping it would be exactly the
defect principle 6 was written down to stop.

**What you ship instead** is the honest family above plus **one clearly-named
in-house composite** for the places that genuinely need a single number (the
trade screen, the roster sort, the AI's valuation):

> **Club Value** — this league's own measure of what a player is worth to a
> roster, in runs above what a Triple-A call-up would give you at the same
> position. It is not WAR and does not try to be: it is built from what this
> league records, and it is the number the front office actually trades on.

Name it `clubValue`, define it once in `lib/baseball/value.ts`, show the same
number everywhere, and say in the glossary what it is and what it is not. That
is exactly how football handled EPA — refuse the borrowed name, ship the honest
family, and say so out loud.

### 21.4 What you may NOT ship: exit velocity, spin rate, sprint speed

Same rule, smaller stakes. The engine has no batted-ball physics and no
pitch-tracking. A number labelled "average exit velocity" would be a rating
rendered in mph, which is a lying metric with a decimal point. If a physical
readout is wanted for flavour, it goes on the **scouting** side where it is
explicitly a scout's estimate — a radar-gun velocity for a pitcher is legitimate
(it *is* the `velocity` attribute in its native unit, and §13.3's 20-80 mapping
is the same idea), an exit velocity for a hitter is not, because nothing in this
engine ever computes one.

### 21.5 The stats page

Follows football's shape: a **League / My Team** toggle and a **Basic /
Advanced** toggle, with the same rule that Advanced adds real charts rather than
more columns. League view: the leaderboards, one per category, in the sport's
own order (AVG, HR, RBI, R, SB, OPS for hitters; W, ERA, K, WHIP, SV, FIP for
pitchers) with the qualification rules stated (**3.1 PA per team game** = 502 PA
for a batting title; **1 IP per team game** = 162 IP for an ERA title) because a
leaderboard without a qualifier is a list of men who went 2-for-3 in April.

My Team view: one full-roster table of rate stats for every man who has
recorded a plate appearance or an out, hitters and pitchers in separate tables
with position-shaped columns.

## 22. The draft, the bonus pool and prospect scouting

### 22.1 The shape

**20 rounds, 30 clubs, 600 picks, held at series 30.** The draftees are 18-22
years old and **none of them plays in the majors this year.** That single fact
deletes a whole football feature and creates a better one in its place.

**What disappears:** the rookie salary scale, the rookie cap hit, the
"can I afford my own first-round pick" war-room warning, and the entire
`autoClearCapRoom` path where an AI club releases veterans to fit its draft
class. None of it has an analogue; a baseball draftee costs a signing bonus and
occupies no roster spot.

**What replaces it, and it is the same panel with a different rule:** the
**bonus pool**.

### 22.2 The bonus pool — reuse the war-room panel wholesale

Each club's pool is the sum of the **slot values** of its picks in rounds 1-10.
Real 2025 anchors: slot 1.1 is **$11.08M**, slot 1.30 about **$2.7M**, the last
pick of round 10 about **$160k**. Club pools ranged from **$5.6M to $18.2M**.

```ts
/** Slot value for an overall pick number, rounds 1-10. Calibrated to the real curve. */
export function slotValue(overallPick: number, poolBase: number): number {
  return Math.round(poolBase * Math.pow(overallPick, -0.62));
}
```
Tune `poolBase` so pick 1 lands at ~$11M and pick 300 at ~$160k, then assert
the league-wide pool total against `BB_DRAFT.LEAGUE_POOL_TARGET` at generation.

**Overage penalties, exactly as the sport has them** — and they are what make
this a decision rather than a budget:

| Over pool by | Tax | Pick penalty |
|---|---|---|
| 0–5% | 75% of the overage | — |
| 5–10% | 75% | next year's 1st-round pick |
| 10–15% | 100% | next two 1st-round picks |
| 15%+ | 100% | next two 1st-round picks |

Rounds 11-20: anything above **$150,000** counts against the pool. A club may
also **save** pool money by signing an early pick under slot — which is the
real strategy, and it is what lets a club take a high-school shortstop who slid
because he had a college commitment.

**And a drafted player may go unsigned.** If the club and the player do not
agree on a bonus, he does not sign, he returns to the pool next year, and the
club receives a **compensation pick one slot later next year**. That is the real
rule and it is what gives the bonus negotiation teeth.

The war-room panel from football's draft page is reused **structurally
unchanged** — it walks the picks in selection order, names the exact pick the
money runs out at, gives two numbers (what it costs to get past that pick and
what it costs to sign the class), and lists the real relief available. Football
proved that panel on a league engineered to $250K of room: the block threw
"adds $6.65M", the panel had quoted $6.65M, and the written contract's cap hit
was $6.65M. **The same number in all three places.** Hold your version to the
same standard: the pool the warning quotes must be the pool the gate enforces,
computed by one function that both call.

### 22.3 Prospect scouting — where football's fog model must change

Football's rule is *fog applies to draft prospects only*, and it is right for
football: a free agent with five seasons on film is not a mystery. **Baseball's
rule is different and the difference is the whole point of a farm system.**

**Fog applies to any player who has not accumulated MLB service time.** A
19-year-old in A-ball is a mystery for four more years. That is not a
limitation; it is the sport, and it is what makes a trade for a prospect a
genuine gamble.

The three tiers, restated for baseball:

```
YOUR OWN MAJOR LEAGUERS      current: exact    potential: exact
OTHER CLUBS' MAJOR LEAGUERS  current: exact    potential: ±5, flat and permanent
ANY MINOR LEAGUER OR DRAFTEE current: fogged   potential: fogged, narrows with work
```

The middle tier is the app owner's own ruling in football, verbatim — *"Exact
for your current team members, +/- 5 point ranges for other pros not on your
team and we just leave it at that"* — and it transfers.

**Two changes to the fog machinery itself, both of which fix a known football
defect rather than porting it:**

**(a) There must be a bias term, or the game cannot produce a bust.**
Football's `observe()` draws each attribute independently around its true value
and `computeOverall` averages a dozen draws, so the noise cancels: 240 redraws
of the same prospect move the mean read by nothing measurable. A club there is
never *systematically* wrong about a man, only noisily wrong. The header comment
promised a bias term for a year and there was none.

Baseball needs one and it is one line: draw a **per-club, per-player** bias once,
seeded on `(teamId, playerId)`, and add it to every observation of that player
by that club:

```ts
const bias = new Rng(`${teamId}:${playerId}:bias`).normal(0, BIAS_SD);  // BIAS_SD 4.5
observed[key] = clamp(truth[key] + bias + rng.normal(0, observationSd(conf, diff)), 20, 99);
```

Because the bias is drawn once and applied to every attribute, it **does not
cancel under averaging** — which is exactly the property that makes a bust
possible. Your club can be wrong about a man for years, and another club can be
right about him, and that asymmetry is what a trade for a prospect is. It also
narrows with confidence: scale `bias` by `(1 − confidence/100) ^ 0.7`, so real
work genuinely fixes a bad read.

**(b) The fog resolves through performance, not only through scouting.** A
prospect's minor-league stat line (§16.4) is generated from his true ratings, so
a GM watching a AA hitter run a .290/.380/.510 line is receiving real
information about a man his scouting report reads as a 45. **Make that the
primary way fog lifts**: `confidence` gains from games played at a level under
your organisation, faster than it gains from spending scouting focus. That is
how a farm system actually works — you find out by playing him — and it makes
the *trade* market for prospects hinge on how much of a man's professional
record each side has seen.

**(c) Colour takes its cue from the range, never from the centre.** Football
measured a 25-point fogged range painted from its own centre matching the true
tier 80.2% of the time cold and **93.0% after a season of files** — the leak got
worse the more you scouted. Colour only when both ends of the range sit in one
tier; otherwise grey, with a legend saying why. Expect the column to be mostly
grey on a fresh class and treat that as the honest rendering.

### 22.4 Running the draft

- **Chunked, mandatory.** 600 picks. Twelve picks per request with a 3,500ms
  deadline checked between picks, `Stop` ending the run at the next chunk
  boundary and leaving the board **stopped** rather than back on a clock. All of
  this is football's `1c626c3` and you should read
  `components/draft/LiveDraftTicker.tsx` for the pending/unmount/strict-mode
  plumbing — React strict mode mounts effects twice in development and
  football's unmount guard latched false on the first teardown, freezing a board
  at "0 selections in" with a dead Stop button.
- **Two buttons, decided from real state, never both**: picks still ahead of the
  clock gets **Fast Forward To My Pick** and names where it stops; no picks left
  gets **Run Out The Draft**. Football's fast-forward broke on a condition that
  could never become true for a GM who had traded every pick, and silently ran
  his whole draft under a label that promised otherwise.
- **The pick on the clock is resolved from live `BbDraftPick` ownership every
  time** (`findFirst` on `(year, round, slot)`), never from a turn-order array
  computed at draft start.
- **20 rounds is long and most of it is not a decision.** After round 10, offer
  **Auto-pick the rest**, with the club's own board and needs — the pool money
  is gone by then and rounds 11-20 are org filler. A GM who wants to take a
  flier in the 14th can still stop it.

### 22.5 The board

The draft screen is a year-round scouting hub exactly as football's is: the
class exists from the first series of the season and is fully browsable,
sortable, filterable and shortlist-able all year. It carries:

- A **Class Outlook** banner — *"Deep in college arms, thin up the middle"* —
  from a real per-class position-strength bias generated with the class.
- The **consensus board** (§5.6), free and public and wrong in learnable ways,
  with named biases each driven by a public signal: a big fastball, a famous
  programme, a good showcase line, a helium riser.
- **Two views** — THE BOARD (the men, the filters, the server-side name search,
  your picks) and THE ROOM (the broadcast) — with the clock standing above both
  always. Default: board while the draft runs, room once it is over. Read
  `components/draft/DraftViewToggle.tsx`.
- Baseball-specific columns the football board has no equivalent for and which
  are the whole texture of an amateur draft: **age** (a 17-year-old and a
  22-year-old at the same grade are wildly different bets), **level** (HS /
  College / JuCo), **signability** (a HS player with a college commitment may
  not sign at slot), and **ETA** (projected years to the majors).

### 22.6 The pipeline: draft to debut

The thing football has no concept of. A drafted player enters at a level by age
and grade, and climbs:

| Drafted from | Entry level | Median years to MLB | P(ever reaches MLB) |
|---|---|---|---|
| College, round 1 | A+ | 2.5 | 0.70 |
| College, rounds 2-5 | A+ | 3.5 | 0.35 |
| College, rounds 6-20 | A | 4.5 | 0.10 |
| High school, round 1 | A | 4.5 | 0.60 |
| High school, rounds 2-5 | A | 5.5 | 0.25 |
| High school, rounds 6-20 | A | 6.0 | 0.05 |

Overall, roughly **17-20% of drafted players ever reach the majors** and about
**66% of first-rounders do**. Those two figures are the calibration targets
(§28); the table above is the mechanism that should produce them, and if it does
not, the mechanism is wrong, not the target.

## 23. Trades

### 23.1 The currency inverts

Football's trade economy is denominated in **draft picks**, valued off a Jimmy
Johnson-style chart, and the pick's value is knowable. Baseball's is denominated
in **prospects**, and a prospect's value is exactly the thing nobody knows.

**That inversion is the whole design.** A baseball trade is a scouting argument:
you are selling your read of a 21-year-old against another club's read of the
same man, and both reads are fogged, and the fog is now *biased* (§22.3(a)) so
the two clubs genuinely disagree rather than agreeing with noise. Football's
trade screen is an arithmetic problem with an acceptance meter. Baseball's is
the same screen asking a harder question.

**The AI must price a read, not a truth.** Football's AI evaluates veterans off
true ratings, deliberately, and only the draft is excepted. Baseball extends the
exception: **an AI club values a minor leaguer off its own biased read**, using
the same `clubReadOf(teamId, player)` machinery football's draft AI uses. A
major leaguer is still valued off truth — he has a professional record, and
modelling fog for 29 clubs on 780 major leaguers would 30x the data for nothing.

### 23.2 What is tradeable

| Asset | Tradeable | Note |
|---|---|---|
| Major leaguer | yes | subject to no-trade clauses |
| Minor leaguer on the 40-man | yes | |
| Minor leaguer not on the 40-man | yes | this is most of the market |
| **Cash** | yes | up to `BB_TRADE.MAX_CASH = $2,000,000` per deal, and salary offsets |
| **Draft picks** | **almost never** | see below |
| Competitive-balance picks | yes | the one exception, and it is real |
| A player signed this league year | not until series 20 | the real June 15 rule |

**Deleting picks from the trade economy is a decision, and here is why it is the
right one.** MLB clubs may not trade ordinary draft picks. Only competitive
balance round picks — awarded to the ten smallest-market and ten
lowest-revenue clubs — may be dealt. So: generate 12 competitive-balance picks a
year (6 after round 1, 6 after round 2, to the small-market clubs), make those
tradeable, and make everything else not.

The consequence is that **a rebuilding club's only way to acquire future value
is to trade major leaguers for prospects**, which is precisely the dynamic the
sport runs on and is far more interesting than a pick chart. It also means the
football `PICK_VALUE_CHART` and its whole tier apparatus do not port.

### 23.3 Salary offsets

Baseball trades routinely move money, and it is a real lever football does not
have: a club may include **cash** to make a deal work, and a rebuilding club
will happily take an overpaid veteran off a contender's hands **in exchange for
a better prospect**. That is "eating salary to improve the return", and it is
one of the sharpest front-office moves in the sport.

So `evaluateTrade` must price a contract as a **positive or negative asset in
dollars**, exactly the way football eventually had to (§5.5): a bargain is a
multiplier on the player's value, an overpay is a **bill in dollars,
subtracted**. Football learned this on a 62-overall corner at $135.4M who was
accepted for nothing by 30 of 31 clubs because replacement level at his
position *was* 62, so he scored a flat zero and a negative multiplier times zero
is zero. Do not rediscover it.

Three supporting pieces are needed to make a negative behave, all of which
football found the hard way and all of which apply here:
- the bid-ask spread applies only to the **positive** part (marking a debt down
  is a club giving itself a discount on money it owes);
- package-concentration weighting applies to **assets only** (buried behind four
  prospects, an albatross would have 45% of its bill weighted away);
- the AI's own offer generator returns **nothing** on a non-positive ask, or it
  will go hunting for the cheapest prospect worth 0.8× a negative number and put
  an albatross on the user's desk.

### 23.4 The deadline

One hard date: **after series 36**, no trades until free agency opens. Same
shape as football's `isTradeDeadlinePassed`, one function, read by the trade
screen, the AI wave and the server action.

**The deadline is the best single moment this game has** and it should be built
as a moment, not as a date that passes. From series 33 the dashboard carries a
countdown; the trade screen's masthead names the number of series remaining; the
AI's offer frequency triples in the last two series; and the wire runs a
deadline-day roundup. A club that is 4 games out with two months left is a
**deadline decision** — buy or sell — and the front-office brief should say so
in as many words:

> **You are 4.5 back with 18 series to play.** Two clubs above you have already
> sold. Villanueva is a free agent in November and three contenders have called.

### 23.5 No-trade clauses

`BbContract.noTrade`. `FULL` means the player must consent; `PARTIAL` means he
has a list of clubs he will not go to. Model the consent as a real refusal the
GM can see coming — the player card's contract tab says *"Full no-trade"* — and
resolve it with a single willingness roll driven by the destination's record and
his own personality. It is a small mechanic that produces a memorable failure,
which is what principle 0 is about.

## 24. Awards, records, history and the wire

### 24.1 Awards

Two leagues, each awarding its own. `BB_AWARD_TYPES`:

```
AWARD_MVP_AL   AWARD_MVP_NL
AWARD_CY_AL    AWARD_CY_NL
AWARD_ROY_AL   AWARD_ROY_NL
AWARD_MGR_AL   AWARD_MGR_NL      -- Manager of the Year
AWARD_EXEC                        -- Executive of the Year (the GM's own trophy)
AWARD_GG        (× 9 positions × 2 leagues)   -- Gold Glove
AWARD_SS        (× 9 positions × 2 leagues)   -- Silver Slugger
AWARD_WS_MVP
AWARD_CS_MVP_AL AWARD_CS_MVP_NL
```

**Live in `lib/baseball/awardTypes.ts`, a leaf module that imports nothing**,
for exactly football's reason: nine surfaces have to agree on the vocabulary,
and they used to agree by copy-paste — two `AWARD_TYPES` arrays and four
`AWARD_LABEL` maps — which is how a new trophy gets counted on one screen and
is invisible on the next.

**Do NOT port football's MVP/OPOY exclusion rule.** Football needed it because
MVP and Offensive Player of the Year ranked on the same score by construction
and named the same man in **158 seasons out of 158**. Baseball's MVP and Cy
Young answer genuinely different questions — Cy Young is pitchers only — and a
pitcher winning both is a real and celebrated event (it has happened). A rule
forbidding it would be its own lie, which is exactly the reasoning football used
to *exempt* the rookie awards from its own exclusion rule.

**But check for the same failure in your own scoring**, because the shape of the
bug is universal: football's DPOY was a safety 96% of the time and an edge
rusher had never won it once, and the confinement was the simulation's, not the
award's. Measure your award distribution across 100+ generated league-seasons
before you call it done, and put the distribution in §28's table. If Gold Glove
at shortstop always goes to the highest-`range` man in the league regardless of
his club or his playing time, that is the same defect.

`AWARD_EXEC` is worth calling out: **it is the GM's own trophy**, awarded for
the best front-office season, and it is a thing football does not have. It goes
on the GM career page and in the dynasty XP model.

### 24.2 Records

`BbLeagueRecord`, one row per `(league, scope, category)`, the current holder,
denormalised name and club abbreviation so a retired holder still renders.
Categories: season and career, for `hr rbi h avg obp slg ops sb r` (batting) and
`w sv k era whip ip` (pitching), plus the single-game ones baseball cares about
that football has no analogue for — **most strikeouts in a game, hits in a
game, a no-hitter, a perfect game**.

**A no-hitter must be detected and celebrated.** It is the single most
screenshot-worthy thing that can come out of a baseball sim, it costs one
condition check at the end of a game, and it produces a wire item, a
`BbTransaction` row, a trophy moment for the user's club, and a permanent record
entry. Real rate: about **3 a season across the league**, which your engine
should produce naturally — measure it (§28).

### 24.3 Seeded history

Port `lib/gen/leagueHistory.ts`'s architecture directly. 16-24 prior seasons at
league creation:

- `BbTeamSeasonRecord` for all 30 clubs, with win totals that sum exactly
  against a 162-game schedule and a postseason bracket actually played out round
  by round, so exactly one champion and one runner-up per year and the labels
  below them match a real bracket.
- Persistent franchise identities — a league where all 30 clubs have exactly one
  title in twenty years is as fake as a league with none.
- A cast of historical players, part synthetic legends and part the actual old
  veterans on today's rosters, who accumulate **season-by-season** lines, win the
  trophies and hold the records.
- **The seasons ARE the history; the career total is their sum.** Football
  computed the walk and threw it away, keeping only the merged blob, which left
  the player card able to say nothing about those years but "Before 2026". Write
  every one as a `BbPlayerSeason` row.

Baseball is the sport where this matters most. A 34-year-old first baseman with
a fourteen-year record, four clubs, an MVP in 2029 and a 41-homer season nobody
remembers is *the entire point of principle 0*, and baseball's stat vocabulary
makes that record more legible than football's ever was.

### 24.4 The wire

`BbTransaction`, same ledger shape, same `playerId` foreign key with
`onDelete: SetNull` (a transaction is a historical record and must survive the
player being deleted; losing the link is acceptable, losing the fact that the
signing happened is not).

Types: `SIGN CUT TRADE DRAFT IL RETURN CALLUP SENDDOWN DFA CLAIM WAIVE RULE5
ARB_FILE ARB_SETTLE ARB_HEARING TENDER NONTENDER QO EXTEND OPTION_EXERCISE
NEWS CHAMPION AWARD_* NO_HITTER RECORD MILESTONE`.

**Two things football learned about the wire, and both bite harder here:**
- Exclude `IL` from the ticker. The sim writes one injury row per club per
  stint; including them spent the whole ticker window on other clubs' training
  rooms and left mid-season leagues with no ticker-eligible news at all.
  Baseball generates *more* roster churn than football, not less — call-ups and
  send-downs are constant — so the ticker must filter to `SIGN TRADE DRAFT
  CHAMPION AWARD_* NO_HITTER RECORD` and the roster moves live on the
  transactions page.
- Floor every wire read on `seasonYear`. League creation seeds two decades of
  backstory, all written at creation time, so `orderBy createdAt desc` puts
  every one of them ahead of anything that has happened in the save. Ordering
  cannot fix it: `createdAt` is honest about when the row was written and lying
  about when the event happened.

**Milestones are baseball's own and they are worth building**: 3,000 hits, 500
home runs, 300 wins, 3,000 strikeouts. Each fires once, produces a wire lead, a
trophy moment for the user's club, and a permanent entry on the player card.
Football has no equivalent because football has no counting stat with that kind
of cultural weight.

## 25. The AI GM

`lib/baseball/ai/gm.ts`, modelled on `lib/ai/gm.ts`, sharing its four-knob
`GmProfile` by name so the philosophy summary and the difficulty plumbing
transfer:

```ts
interface GmProfile {
  aggression: number;   // 0..1 big trades and big free agents
  winNow: number;       // 0..1 recomputed each offseason from record + roster age
  valuePicks: number;   // 0..1 here: how much extra it charges for PROSPECTS
  bpaBias: number;      // 0..1 best-available vs need, in the draft
}
```

`recomputeWinNow(wins, losses, avgAge, farmStrength)` gains a fourth input,
because in baseball a club with a strong farm and a bad record is a *different
animal* from one with a bad farm and a bad record — the first is two years from
contending and the second is five. That distinction is what makes an AI trade
market interesting: **sellers and buyers must be genuinely different clubs.**

`clubValue(player, context)` is the valuation (§21.3). Components:

- **Runs above replacement at his position**, from his rates against the league
  baseline. Replacement level is per-position and is the AAA median at that
  position — computed from the actual league, not a constant, so the AI prices
  the league it is playing in.
- **Control years.** This is the single largest term in baseball and it does not
  exist in football at all. A 25-year-old with five years of control at
  pre-arb prices is worth **multiples** of an identical 31-year-old with two
  years left at market. `controlMultiplier(serviceDays, contract)`, and it is
  what makes a deadline rental cheap and a cost-controlled ace almost untradeable.
- **Contract surplus, signed.** Positive as a multiplier, negative as a bill in
  dollars (§23.3).
- **Age arc**, per kind: hitter / starter / reliever (§15.1).
- **Need and scarcity**, bounded, exactly as football bounds them.
- **Prospect risk**, for a minor leaguer: value is discounted by distance from
  the majors and by the width of his own fogged band. A 45-with-a-70-ceiling in
  A-ball is a lottery ticket and must be priced as one.

**Ship `scripts/bb/benchmarkClubValue.ts`** — a permanent, framework-free
scenario suite in the mould of `scripts/benchmarkTradeValue.ts`, with 20+ named
scenarios and a pass/fail each: *a cost-controlled 26-year-old ace is worth more
than a 33-year-old ace on a market deal*, *a rental reliever is worth less than
a top-100 prospect*, *an albatross contract is worth less than nothing*, *gifting
a star for nothing is accepted*, *pick-for-pick with no contracts involved is
symmetric*. Football's version is the reason its trade AI is trustworthy.

---
---

# PART IV — THE ARTEFACTS

## 26. The Prisma schema

Append this block to `prisma/schema.prisma`, below football's models and above
`model User`. It uses the same conventions the file already holds: JSON is
stored as a plain `String` (not `jsonb`) so the shape matches exactly what
`lib/shared/json.ts` reads and writes, every relation names its `onDelete`, and
every column added to a table that could ever exist already is nullable or
defaulted.

```prisma
// ===========================================================================
// DYNASTY GM BASEBALL — data model
//
// A sibling game in the same database. Football's models above are untouched;
// these share only `User` (identity) and `DynastyRank` (the public board,
// which already carries a `sport` discriminator and an opaque `saveKey`).
//
// Every model here is prefixed `Bb`. That is not cosmetic: a shared Player
// with a `sport` column would put a filter this schema cannot enforce in front
// of several hundred existing football queries, and one missed filter is a
// cross-sport leak that type-checks. Prefixed models mean the migration that
// creates them is CREATE TABLE only, and no football save can be damaged by
// any work in this game.
// ===========================================================================

model BbLeague {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())

  /// Browser ownership before an account claims the save. Same mechanism and
  /// same nullability reasoning as League.ownerKey.
  ownerKey String?
  /// The account that owns it once claimed. SetNull, never Cascade: deleting a
  /// user must not delete their dynasties.
  userId String?
  user   User?   @relation("BbLeagues", fields: [userId], references: [id], onDelete: SetNull)

  seasonYear Int  @default(2026)
  /// Founding season — the base the payroll budget curve grows from. Nullable
  /// only so a column can be added to a live table; read it through
  /// resolveBbStartYear(), never directly.
  startYear  Int?

  /// SPRING | REGULAR | DRAFT | POSTSEASON | OFFSEASON | ROSTER_CRUNCH | FREE_AGENCY
  phase    String @default("SPRING")
  /// 1..54 during REGULAR. The series on the clock.
  seriesNo Int    @default(1)
  /// 1-based index into OFFSEASON_STEPS during OFFSEASON, 1..3 during FREE_AGENCY.
  week     Int    @default(1)
  /// Postseason round: WC | DS | CS | WS. Null outside POSTSEASON.
  psRound  String?

  /// The league year the arbitration/tender window last blocked an advance.
  /// Blocks ONCE per year and then gets out of the way — letting men walk is a
  /// decision a GM may make, being ambushed by it is not.
  crunchWarnedYear Int?
  /// The league year service days were last credited into whole years, so the
  /// ACCRUE_SERVICE step is idempotent.
  serviceAccruedYear Int?

  /// ONE PRESS OF ADVANCE AT A TIME. A TIMESTAMP, NOT A BOOLEAN: a flag left
  /// set by a request killed mid-advance is a save nobody can ever advance
  /// again, with no move inside the game that clears it. See lib/season.ts's
  /// long comment in the football game — the reasoning is identical.
  advanceStartedAt DateTime?

  userTeamId String?
  /// Full settings blob — see lib/baseball/settings.ts BbLeagueSettings.
  settings   String

  teams          BbTeam[]
  players        BbPlayer[]
  games          BbGame[]
  picks          BbDraftPick[]
  transactions   BbTransaction[]
  draftState     BbDraftState?
  tradeOffers    BbTradeOffer[]
  seasonRecords  BbTeamSeasonRecord[]
  leagueRecords  BbLeagueRecord[]
  playerSeasons  BbPlayerSeason[]
  powerSnapshots BbPowerRankingSnapshot[]
  tradeRecords   BbTradeRecord[]
  dynasty        BbDynastyProfile?
  negotiations   BbNegotiationTalks[]
  arbCases       BbArbitrationCase[]

  /// The home-page list filters on exactly one of these two, every time.
  @@index([userId])
  @@index([ownerKey])
}

model BbTeam {
  id       String   @id @default(cuid())
  leagueId String
  league   BbLeague @relation(fields: [leagueId], references: [id], onDelete: Cascade)

  city     String
  nickname String
  abbr     String
  /// "AMERICAN" | "NATIONAL"
  bbLeague String
  /// "East" | "Central" | "West"
  division String
  isUser   Boolean @default(false)

  /// 0-100. Drives free-agent attraction alongside record and payroll.
  prestige   Int @default(50)
  /// 1-10. Sets the opening payroll budget band and the park's character.
  marketSize Int @default(5)

  // Identity ------------------------------------------------------------------
  parkName String @default("Ballpark")
  /// JSON: { hr, doubles, triples, babip, runs } multipliers on the HOME park.
  /// Applied to both clubs — a park is a park, not an advantage.
  parkFactors String @default("{}")

  // AI personality ------------------------------------------------------------
  /// JSON GmProfile: { aggression, winNow, valuePicks, bpaBias }
  gmProfile String @default("{}")
  /// 0-100. Multiplies minor-league development rolls for this organisation.
  devRating Int @default(50)

  // Money ---------------------------------------------------------------------
  /// What the owner authorised for cash payroll this season. THE gate.
  payrollBudget Int @default(150000000)
  /// Consecutive seasons finished over the base luxury-tax threshold. Resets to
  /// 0 by finishing a season under it; drives the 20/30/50% rate.
  taxYearsConsecutive Int @default(0)

  // Season record -------------------------------------------------------------
  wins       Int     @default(0)
  losses     Int     @default(0)
  runsFor    Int     @default(0)
  runsAgnst  Int     @default(0)
  divWins    Int     @default(0)
  divLosses  Int     @default(0)
  playoffSeed Int?
  eliminated Boolean @default(false)
  clinched   String? // "DIV" | "WC" | null

  // Draft bonus pool ----------------------------------------------------------
  /// Dollars of this year's pool already committed to signed picks.
  poolSpent Int @default(0)

  players        BbPlayer[]
  affiliates     BbAffiliate[]
  homeGames      BbGame[] @relation("BbHomeTeam")
  awayGames      BbGame[] @relation("BbAwayTeam")
  ownedPicks     BbDraftPick[] @relation("BbPickOwner")
  originalPicks  BbDraftPick[] @relation("BbPickOrigin")
  reports        BbScoutingReport[]
  lineupCards    BbLineupCard[]
  staff          BbPitchingStaff?
  tradeOffersFrom BbTradeOffer[]
  seasonRecords  BbTeamSeasonRecord[]
  playerSeasons  BbPlayerSeason[]
  shortlist      BbShortlistEntry[]
  negotiations   BbNegotiationTalks[]
  powerSnapshots BbPowerRankingSnapshot[]
  charges        BbPayrollCharge[]
  arbCases       BbArbitrationCase[]

  @@index([leagueId])
}

/// A club's minor-league affiliates. They exist so the farm system reads as
/// PLACES rather than as labels — principle 2. One row per (team, level).
model BbAffiliate {
  id     String @id @default(cuid())
  teamId String
  team   BbTeam @relation(fields: [teamId], references: [id], onDelete: Cascade)

  /// "AAA" | "AA" | "A+" | "A"
  level    String
  city     String
  nickname String
  abbr     String

  @@unique([teamId, level])
}

model BbPlayer {
  id       String   @id @default(cuid())
  leagueId String
  league   BbLeague @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  teamId   String?
  team     BbTeam?  @relation(fields: [teamId], references: [id], onDelete: SetNull)

  firstName String
  lastName  String
  /// Primary position: C 1B 2B 3B SS LF CF RF DH SP RP
  position  String
  /// JSON array of { pos, penalty } — every other spot he can cover, and what
  /// it costs him defensively there. A bench of three covering eight spots is
  /// what lets a club carry a thirteenth pitcher; this is that mechanic.
  secondaryPositions String @default("[]")

  age        Int
  /// Completed professional seasons, majors and minors together. Drives the
  /// 4th-option rule and Rule 5 eligibility.
  proSeasons Int @default(0)
  heightIn   Int @default(72)
  weightLb   Int @default(200)
  /// 'L' | 'R' | 'S'
  bats       String @default("R")
  /// 'L' | 'R'
  throws     String @default("R")
  /// Where he came from — a college, a high school, or a country for an
  /// international signing. Display only.
  origin     String @default("State")

  // TRUE ratings — never shown for a fogged player -----------------------------
  /// JSON map attributeKey -> 0..99. See lib/baseball/ratings.ts BB_ATTRIBUTES.
  trueAttrs String
  trueOvr   Int
  potential Int
  /// Slow | Normal | Star | Superstar
  devTrait  String @default("Normal")

  // Where he is ---------------------------------------------------------------
  /// ACTIVE | IL | IL60 | OPTIONED | MINORS | FA | RETIRED | DRAFTEE
  rosterLevel String @default("MINORS")
  /// MLB | AAA | AA | A+ | A. Separate from rosterLevel on purpose: an
  /// OPTIONED man has a level AND a 40-man spot, a MINORS man has a level and
  /// no spot, and conflating them is how a 40-man count disagrees with itself.
  level       String @default("A")
  /// True while he occupies one of the club's 40 spots. Derived at write time
  /// from rosterLevel and stored, because the 40-man count is read on nearly
  /// every screen and a COUNT with a four-value IN clause is the query this
  /// column removes.
  on40Man     Boolean @default(false)

  // THE CLOCK — service time. See §17. -----------------------------------------
  /// Cumulative days of major-league service. 172 = one full year; a season is
  /// 186 days. Accrues one per game day on the active roster or ANY IL.
  /// Everything about arbitration, free agency and control is derived from
  /// this one integer — serviceYears is never stored.
  serviceDays Int @default(0)
  /// True once he has been credited Super Two status for the current cycle.
  /// Recomputed each offseason from the league-wide 22% cutoff; stored only so
  /// a screen mid-offseason and the arbitration wave cannot disagree.
  superTwo    Boolean @default(false)

  // Options -------------------------------------------------------------------
  optionYearsUsed    Int     @default(0)
  optionedThisSeason Boolean @default(false)
  /// The league day he was last optioned. He must stay down 15 days.
  optionedOnDay      Int?
  /// True once he has been outrighted off a 40-man. A second outright, or any
  /// outright with 3+ years of service, lets him elect free agency.
  outrightedBefore   Boolean @default(false)

  // Draft ---------------------------------------------------------------------
  isDraftee   Boolean @default(false)
  draftYear   Int?
  draftRound  Int?
  draftPickNo Int?
  /// JSON amateur profile — the college/HS line, the showcase numbers, the
  /// competition grade and the signability read. Only meaningful while
  /// isDraftee. See lib/baseball/gen/amateurProfile.ts.
  amateurProfile String @default("{}")

  // Health --------------------------------------------------------------------
  /// null | IL10 | IL15 | IL60
  ilDesignation String?
  ilDaysLeft    Int     @default(0)
  /// Human-readable, e.g. "Left oblique strain". CLEARED in the same statement
  /// that clears ilDaysLeft — football shipped the opposite and carried a torn
  /// hamstring into a new season with nothing counting down.
  injuryType    String?

  fatigue Int @default(0)
  morale  Int @default(70)

  /// Pitchers only. JSON RestState: { games: [{ gameIndex, pitches }] }, last
  /// four appearances. This is the whole bullpen-availability mechanic and it
  /// is a blob rather than a table because the box score is already the
  /// permanent appearance record — this is only the rolling window.
  restState String @default("{}")
  /// Pitchers only. The game index of his last start.
  lastStart Int @default(-99)

  /// Consecutive offseasons unsigned — drives out-of-baseball attrition.
  yearsUnsigned Int @default(0)
  /// Consecutive league days on the market — this is the clock his asking
  /// price falls on. Separate from yearsUnsigned because the yearly counter
  /// moves in one lump at PROGRESS and has nothing to do with when he actually
  /// hit the market.
  daysUnsigned  Int @default(0)

  // Stats — JSON BbSeasonStats. REGULAR SEASON ONLY in the first pair. --------
  seasonStats        String @default("{}")
  careerStats        String @default("{}")
  playoffStats       String @default("{}")
  careerPlayoffStats String @default("{}")

  contract      BbContract?
  reports       BbScoutingReport[]
  draftPick     BbDraftPick?
  shortlistedBy BbShortlistEntry[]
  negotiations  BbNegotiationTalks[]
  seasons       BbPlayerSeason[]
  lineupSlots   BbLineupCard[]
  arbCases      BbArbitrationCase[]
  transactions  BbTransaction[]

  @@index([leagueId])
  @@index([teamId])
  @@index([position])
  /// The roster page, the 40-man count and the call-up list are all this read.
  @@index([teamId, rosterLevel])
  /// The free-agent market and the draft board.
  @@index([leagueId, rosterLevel])
}

model BbContract {
  id       String   @id @default(cuid())
  playerId String   @unique
  player   BbPlayer @relation(fields: [playerId], references: [id], onDelete: Cascade)
  teamId   String?

  years          Int
  yearsRemaining Int
  signedYear     Int

  /// JSON number[] — actual cash by year, index 0 = the current league year.
  salaries String
  /// Total value / years. THE luxury-tax number, and it is deliberately stored
  /// rather than derived: deferrals discount it (see `deferred`), so recomputing
  /// it from `salaries` alone would give a different answer than the tax uses.
  aav      Int
  /// Almost always the full remaining value — baseball contracts are
  /// guaranteed. Stored anyway because minor-league and split deals are not.
  guaranteed   Int @default(0)
  signingBonus Int @default(0)

  /// JSON [{ year, amount }] — money paid after the deal ends. Reduces `aav`
  /// by a present-value discount, which is the one legitimate tax lever in the
  /// sport and the closest analogue to football's restructure. It reshapes a
  /// deal; it can never escape one.
  deferred String @default("[]")
  /// JSON number[] — years after which the PLAYER may opt out.
  optOutAfter String @default("[]")
  /// JSON [{ year, salary, buyout }] — club options.
  clubOptions String @default("[]")
  /// NONE | PARTIAL | FULL
  noTrade String @default("NONE")

  /// True for a pre-arb or arbitration deal, which is not negotiated on the
  /// open market and must never be priced as though it were.
  isControlDeal Boolean @default(false)
  /// True for a one-year qualifying offer that was accepted.
  isQualifyingOffer Boolean @default(false)
  /// Minor-league contract: no 40-man spot, no guarantee, releasable free.
  isMinorLeague Boolean @default(false)

  @@index([teamId])
}

/// Salary owed to men no longer on the roster, plus the luxury-tax bill.
/// Per team-year, exactly like football's CapCharge — INCLUDING the lesson
/// that cost 18,247 orphaned rows: this is a REAL foreign key with a cascade,
/// and it hangs off the TEAM, not off the contract or the player. Money owed
/// to a released man is MEANT to outlive the deal that created it, so a
/// cascade from either of those would delete the bill along with the reason
/// for it. Nothing in this game deletes a single team; only a whole league,
/// which cascades into BbTeam already.
model BbPayrollCharge {
  id     String @id @default(cuid())
  teamId String
  team   BbTeam @relation(fields: [teamId], references: [id], onDelete: Cascade)

  year   Int
  amount Int
  /// RELEASE | TAX | BUYOUT | RULE5_RETURN | DRAFT_OVERAGE
  kind   String @default("RELEASE")
  label  String

  @@index([teamId, year])
}

model BbDraftPick {
  id       String   @id @default(cuid())
  leagueId String
  league   BbLeague @relation(fields: [leagueId], references: [id], onDelete: Cascade)

  year  Int
  round Int
  /// 1..30 within the round, assigned by reverse standings.
  slot  Int
  /// STANDARD | COMP_BALANCE | QO_COMP | PROMOTION_INCENTIVE | UNSIGNED_COMP
  /// Only COMP_BALANCE picks may be traded — see §23.2.
  kind  String @default("STANDARD")

  originalTeamId String
  originalTeam   BbTeam @relation("BbPickOrigin", fields: [originalTeamId], references: [id], onDelete: Cascade)
  ownerTeamId    String
  ownerTeam      BbTeam @relation("BbPickOwner", fields: [ownerTeamId], references: [id], onDelete: Cascade)

  used     Boolean @default(false)
  playerId String? @unique
  player   BbPlayer? @relation(fields: [playerId], references: [id], onDelete: SetNull)
  /// Bonus actually paid. Counts against the club's pool. Null until signed —
  /// and a drafted player who never signs keeps `used: true` with a null bonus,
  /// which is what triggers next year's compensation pick.
  bonusPaid Int?
  signed    Boolean @default(false)

  /// NO TWO PICKS MAY SHARE A SELECTION. This key deliberately does NOT carry
  /// originalTeamId: football's did, which made the rule strictly weaker than
  /// it read — two picks on the same slot with different origins satisfied it,
  /// and of two picks sharing slot 26 one came up and was paid slot 26's price
  /// while the other was never called at all. Measured across 220 football
  /// leagues, the old key found zero violations and the corrected key found six,
  /// all real.
  @@unique([leagueId, year, round, slot])
  @@index([ownerTeamId])
}

model BbDraftState {
  id       String   @id @default(cuid())
  leagueId String   @unique
  league   BbLeague @relation(fields: [leagueId], references: [id], onDelete: Cascade)

  round     Int     @default(1)
  pickIndex Int     @default(0)
  /// JSON string[] of teamIds in pick order.
  order     String  @default("[]")
  complete  Boolean @default(false)
  /// Has the GM opened this draft? The board is written the moment the season
  /// reaches series 30; the clock does not run until he says so.
  started   Boolean @default(false)
}

model BbGame {
  id       String   @id @default(cuid())
  leagueId String
  league   BbLeague @relation(fields: [leagueId], references: [id], onDelete: Cascade)

  seasonYear Int
  /// 1..54 for a regular-season game; the postseason round index otherwise.
  seriesNo   Int
  /// 1..3 within a series; 1..7 within a postseason series.
  gameInSeries Int @default(1)
  /// Absolute game index within the season, 1..162. This is the clock pitcher
  /// rest is measured on and it must be stored rather than derived: the
  /// postseason continues the count and a derived index would restart it.
  gameIndex  Int @default(0)
  /// REGULAR | WC | DS | CS | WS
  kind       String @default("REGULAR")

  homeTeamId String
  homeTeam   BbTeam @relation("BbHomeTeam", fields: [homeTeamId], references: [id], onDelete: Cascade)
  awayTeamId String
  awayTeam   BbTeam @relation("BbAwayTeam", fields: [awayTeamId], references: [id], onDelete: Cascade)

  played    Boolean @default(false)
  homeScore Int     @default(0)
  awayScore Int     @default(0)
  innings   Int     @default(9)

  /// JSON BbBoxScore — the COMPACT encoding in §20.7. Arrays of numbers with
  /// one interned id table per game, because the naive shape puts three
  /// twenty-season dynasties over Neon's free tier.
  boxScore String @default("{}")
  recap    String @default("")
  /// Set the moment a no-hitter or perfect game is detected, so the wire, the
  /// record book and the player card all read one flag rather than three
  /// re-derivations of the same condition.
  feat     String?

  @@index([leagueId, seasonYear, seriesNo])
  @@index([leagueId, seasonYear, gameIndex])
}

model BbTransaction {
  id       String   @id @default(cuid())
  leagueId String
  league   BbLeague @relation(fields: [leagueId], references: [id], onDelete: Cascade)

  seasonYear Int
  /// The series (or offseason step) it happened in.
  seriesNo   Int
  type       String
  teamId     String?

  /// The man this row is ABOUT, when it is about one. A name is not an
  /// identity: two men can share one, and a rename breaks every reader at once.
  /// SetNull rather than Cascade — a transaction is a historical record and
  /// must survive the player being deleted. Losing the link is acceptable;
  /// losing the fact that the signing happened is not.
  playerId String?
  player   BbPlayer? @relation(fields: [playerId], references: [id], onDelete: SetNull)

  headline  String
  detail    String   @default("")
  createdAt DateTime @default(now())

  @@index([leagueId, seasonYear, seriesNo])
  /// "Everything that ever happened to this man" — his card, and the
  /// provenance panel behind it.
  @@index([playerId])
  /// The transactions page filters by type; roster churn is high in this sport.
  @@index([leagueId, type])
}

model BbTeamSeasonRecord {
  id       String   @id @default(cuid())
  leagueId String
  league   BbLeague @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  teamId   String
  team     BbTeam   @relation(fields: [teamId], references: [id], onDelete: Cascade)

  year      Int
  wins      Int
  losses    Int
  runsFor   Int
  runsAgnst Int
  /// MISSED | WILDCARD | DIVISION | CHAMPIONSHIP | PENNANT | CHAMPION
  playoffResult String @default("MISSED")
  /// Cash payroll that season — the only place a club's spend survives the
  /// year, which is what makes a tenure-long payroll history possible at all.
  /// Football cannot show this because its cap charges are deleted at the roll.
  payroll   Int @default(0)

  @@unique([teamId, year])
  @@index([leagueId, year])
}

/// One player's production in one season at ONE level for ONE club. Keyed that
/// way on purpose: a man who plays AA, AAA and MLB in one year gets three rows,
/// because "where did he produce" is the question a year-by-year table exists
/// to answer, and one averaged row answers it wrongly while looking
/// authoritative. The display recombines same-level rows into a "2TM" line.
///
/// Written at ROLL_STATS from played box scores, BEFORE any box-score pruning
/// (§20.7). These rows are the permanent record; the box scores are not.
model BbPlayerSeason {
  id       String   @id @default(cuid())
  leagueId String
  league   BbLeague @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  playerId String
  player   BbPlayer @relation(fields: [playerId], references: [id], onDelete: Cascade)

  seasonYear Int
  /// MLB | AAA | AA | A+ | A
  level      String @default("MLB")

  teamId   String?
  team     BbTeam? @relation(fields: [teamId], references: [id], onDelete: SetNull)
  /// Denormalised so the crest and the label survive a deleted club.
  teamAbbr String

  /// His age that season. Nullable, and null is a real answer rather than a
  /// missing one — a dash is honest where the arithmetic cannot be trusted.
  age Int?
  /// Where his first game for this club fell, as a sortable position. Only
  /// matters for a man who moved mid-year; without it the two rows of a split
  /// season come back in whatever order Postgres feels like.
  firstSeen Int @default(0)

  /// JSON BbSeasonStats — same shape and same keys the box score wrote.
  stats        String @default("{}")
  playoffStats String @default("{}")

  @@unique([playerId, seasonYear, level, teamAbbr])
  @@index([leagueId, seasonYear])
}

model BbLeagueRecord {
  id       String   @id @default(cuid())
  leagueId String
  league   BbLeague @relation(fields: [leagueId], references: [id], onDelete: Cascade)

  /// SEASON | CAREER | GAME
  scope      String
  /// Matches a BbSeasonStats key, or a derived key like "avg" / "era".
  category   String
  /// Stored as an integer in the stat's own smallest unit — a rate is stored
  /// x1000 (a .347 average is 347) so one column serves both and no reader has
  /// to know which kind it got.
  value      Int
  playerId   String
  playerName String
  teamAbbr   String
  seasonYear Int

  @@unique([leagueId, scope, category])
  @@index([leagueId])
}

model BbScoutingReport {
  id       String   @id @default(cuid())
  playerId String
  player   BbPlayer @relation(fields: [playerId], references: [id], onDelete: Cascade)
  teamId   String
  team     BbTeam   @relation(fields: [teamId], references: [id], onDelete: Cascade)

  confidence Int    @default(0)
  /// JSON map attrKey -> observed value. Observations are resampled and
  /// re-centred as confidence rises.
  observed   String @default("{}")
  scoutedOvr Int    @default(0)
  ovrLow     Int    @default(0)
  ovrHigh    Int    @default(99)
  potConfidence Int @default(0)
  /// JSON string[] of attribute keys locked to truth by an evaluation.
  attrsRevealed String @default("[]")
  devRevealed   Boolean @default(false)
  notes         String  @default("")

  /// Games this club has watched him play in its own system. THE primary way
  /// fog lifts in baseball — you find out by playing him — and it is why this
  /// column exists rather than confidence being scouting-spend alone.
  gamesObserved Int @default(0)
  /// League year a private workout / showcase was held. Display only; the
  /// reveal itself lives in confidence and attrsRevealed like everything else.
  workoutYear   Int?

  @@unique([playerId, teamId])
  @@index([teamId])
}

model BbShortlistEntry {
  id       String   @id @default(cuid())
  playerId String
  player   BbPlayer @relation(fields: [playerId], references: [id], onDelete: Cascade)
  teamId   String
  team     BbTeam   @relation(fields: [teamId], references: [id], onDelete: Cascade)
  /// The draft year this star belongs to. Football's shortlist carried a player
  /// and a team and NOTHING ELSE, so an unfiltered read returned every man the
  /// club had ever starred in every draft it had ever held, and a GM opening
  /// his second draft was told he was watching four men who were already on his
  /// roster.
  draftYear Int
  createdAt DateTime @default(now())

  @@unique([playerId, teamId])
  @@index([teamId, draftYear])
}

model BbTradeOffer {
  id       String   @id @default(cuid())
  leagueId String
  league   BbLeague @relation(fields: [leagueId], references: [id], onDelete: Cascade)

  fromTeamId String
  fromTeam   BbTeam @relation(fields: [fromTeamId], references: [id], onDelete: Cascade)
  toTeamId   String

  /// JSON BbTradeAsset[] — { type: 'PLAYER'|'PICK'|'CASH', id?, amount? }
  give    String @default("[]")
  request String @default("[]")
  blurb   String

  status     String   @default("PENDING")
  seasonYear Int
  seriesNo   Int
  createdAt  DateTime @default(now())

  @@index([leagueId, toTeamId, status])
}

model BbTradeRecord {
  id       String   @id @default(cuid())
  leagueId String
  league   BbLeague @relation(fields: [leagueId], references: [id], onDelete: Cascade)

  seasonYear Int
  seriesNo   Int
  teamAId    String
  teamBId    String
  teamAAbbr  String
  teamBAbbr  String
  /// JSON asset snapshots, each priced with the same neutral valuation used
  /// everywhere else, AT THE MOMENT OF THE TRADE. A plain transaction row only
  /// records counts, so there would be nothing to grade retrospectively.
  aToB String
  bToA String

  createdAt DateTime @default(now())

  @@index([leagueId, createdAt])
}

/// The lineup card. Two per club — one against right-handed starters, one
/// against left — because the platoon decision is made once and honoured 162
/// times, which is the right ratio for a front-office game.
model BbLineupCard {
  id     String @id @default(cuid())
  teamId String
  team   BbTeam @relation(fields: [teamId], references: [id], onDelete: Cascade)
  /// 'L' | 'R' — the hand of the opposing STARTER this card answers.
  vsHand String

  playerId String
  player   BbPlayer @relation(fields: [playerId], references: [id], onDelete: Cascade)
  /// 1..9
  battingOrder  Int
  /// C 1B 2B 3B SS LF CF RF DH — exactly once each across the nine rows.
  fieldPosition String

  @@unique([teamId, vsHand, battingOrder])
  @@unique([teamId, vsHand, fieldPosition])
  @@index([teamId])
}

/// The pitching staff: an ordered rotation and a bullpen role chart. One row
/// per club; the arrays are JSON because they are read and written whole and
/// never queried into.
model BbPitchingStaff {
  id     String @id @default(cuid())
  teamId String @unique
  team   BbTeam @relation(fields: [teamId], references: [id], onDelete: Cascade)

  /// JSON string[5] of playerIds, in turn order. Game n is started by slot n%5.
  rotation String @default("[]")
  /// JSON { closer: id|null, setup: id[], middle: id[], long: id[] }
  bullpen  String @default("{}")
  /// Postseason rotation, 4 (or 3 in a best-of-3). Set when the club clinches;
  /// null means "use the top of the regular rotation".
  psRotation String?
}

/// One arbitration case, for one player, in one offseason. It is a row rather
/// than a blob because it has a lifecycle a screen has to render: filed,
/// settled, heard, won, lost.
model BbArbitrationCase {
  id       String   @id @default(cuid())
  leagueId String
  league   BbLeague @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  teamId   String
  team     BbTeam   @relation(fields: [teamId], references: [id], onDelete: Cascade)
  playerId String
  player   BbPlayer @relation(fields: [playerId], references: [id], onDelete: Cascade)

  seasonYear Int
  /// The salary the player's side filed at.
  playerFiled Int
  /// The salary the club filed at.
  clubFiled   Int
  /// PENDING | SETTLED | HEARD_CLUB | HEARD_PLAYER
  status      String @default("PENDING")
  /// The number that ended up on the contract. Null until resolved.
  settledAt   Int?
  /// The hidden case strength the panel weighed, 0..1. STORED so the result
  /// screen can explain the verdict after the fact rather than re-rolling a
  /// different number — a hearing a GM cannot understand is a coin flip with a
  /// costume on.
  caseStrength Float @default(0.5)
  /// JSON [{ name, service, salary, note }] — the comparables the panel used.
  comparables  String @default("[]")

  @@unique([playerId, seasonYear])
  @@index([leagueId, seasonYear])
  @@index([teamId, seasonYear])
}

/// Server-authoritative negotiation patience. Keyed on (team, player, league
/// year), which is exactly the set of things that make a negotiation the same
/// negotiation. The count NEVER comes up from the browser: the first version
/// of football's passed it up, so pressing F5 reset it to zero and a GM could
/// lowball the same free agent forever.
model BbNegotiationTalks {
  id String @id @default(cuid())

  leagueId String
  league   BbLeague @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  teamId   String
  team     BbTeam   @relation(fields: [teamId], references: [id], onDelete: Cascade)
  playerId String
  player   BbPlayer @relation(fields: [playerId], references: [id], onDelete: Cascade)

  seasonYear    Int
  /// Pips burned. Never decreases within a league year.
  patienceSpent Int @default(0)
  /// "Not now" on the tender/arb list. NOT "let him walk" — that is its own
  /// control and it releases him — and it costs no patience, so parking a man
  /// cannot change what he will sign for.
  dismissedAt   DateTime?

  updatedAt DateTime @updatedAt

  @@unique([teamId, playerId, seasonYear])
  @@index([leagueId, seasonYear])
  @@index([playerId])
}

/// The only PERSISTED half of the Dynasty system. XP and level are NOT stored:
/// they are recomputed on every read from history the database already holds,
/// which keeps them self-healing for old saves, impossible to farm, and free
/// of any hook in the season code.
model BbDynastyProfile {
  id String @id @default(cuid())

  ownerKind String @default("LEAGUE")
  ownerKey  String

  leagueId String?  @unique
  league   BbLeague? @relation(fields: [leagueId], references: [id], onDelete: Cascade)

  /// JSON map skillId -> rank purchased.
  skills String @default("{}")
  /// Year-stamped charge ledgers. A counter tagged with the league year it
  /// belongs to reads as zero the moment the year moves, so "resets every
  /// season" needs no hook to be CORRECT.
  showcaseYear Int @default(0)
  showcaseUsed Int @default(0)
  insiderYear  Int @default(0)
  insiderUsed  Int @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([ownerKind, ownerKey])
}

/// Movement cannot be recomputed: a club that signed a free agent on Tuesday
/// would retroactively rewrite what it was ranked on Sunday. "Up 4" is only
/// honest if last week was written down last week.
model BbPowerRankingSnapshot {
  id       String   @id @default(cuid())
  leagueId String
  league   BbLeague @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  teamId   String
  team     BbTeam   @relation(fields: [teamId], references: [id], onDelete: Cascade)

  seasonYear Int
  /// The series these rankings were published FOR. The postseason maps to one
  /// terminal value (TOTAL_SERIES + 1); offseason phases are never snapshotted.
  seriesNo   Int
  rank       Int
  powerIndex Float
  rating     Int
  wins       Int
  losses     Int
  runDiff    Int

  createdAt DateTime @default(now())

  /// One row per club per league-series, which is what makes the write
  /// idempotent under createMany({ skipDuplicates: true }). The whole point of
  /// a snapshot is that it says what we thought THEN.
  @@unique([leagueId, seasonYear, seriesNo, teamId])
  @@index([leagueId, seasonYear, seriesNo])
}
```

**One change to an existing model**, and it is the only football-side schema
edit in the whole build — add the back-relation `User` needs:

```prisma
model User {
  // ... unchanged ...
  leagues   League[]
  bbLeagues BbLeague[] @relation("BbLeagues")   // <-- ADD THIS LINE
  ranks     DynastyRank[]
}
```

Prisma requires the back-relation; it produces no column and no data change.
`DynastyRank` needs nothing: `sport` and `saveKey` already carry baseball.

## 27. `lib/baseball/tuning.ts`

**Every balance constant in the game, in one file, with a real-world anchor
beside anything that has one.** Tag each block `[TUNE]`, `[SAFE]` or
`[FRAGILE]` the way football's does. This file may not import
`lib/tuning.ts` and `lib/tuning.ts` may not import this one.

```ts
// ===========================================================================
// DYNASTY GM BASEBALL — every tunable number
//
// Anchors are real MLB figures, cited so a future pass can tell a deliberate
// departure from a drifted one. Where this game deliberately differs from the
// real sport, the number says so and says why.
// ===========================================================================

export const BB_LEAGUE = {
  TEAM_COUNT: 30,
  LEAGUES: ['AMERICAN', 'NATIONAL'] as const,
  DIVISIONS: ['East', 'Central', 'West'] as const,
  /** 5 clubs per division x 3 divisions x 2 leagues. */
  TEAMS_PER_DIVISION: 5,

  /** [TUNE] The unit of Advance. 3 -> 54 presses a season; 6 -> 27.
   *  The schedule generator is the ONLY reader. Ship at 3. */
  SERIES_LENGTH: 3,
  TOTAL_SERIES: 54,
  GAMES: 162,

  /** Series composition — 20 + 20 + 14 = 54. Real MLB is 52/64/46 games. */
  DIV_SERIES_PER_RIVAL: 5,      // 4 rivals -> 20 series, 60 games
  LEAGUE_SERIES_PER_CLUB: 2,    // 10 clubs -> 20 series, 60 games
  INTERLEAGUE_SERIES_PER_CLUB: 1, // 14 clubs -> 14 series, 42 games

  /** The amateur draft interrupts the season here. Real MLB drafts in July. */
  DRAFT_SERIES: 30,
  /** Trades freeze after this series. Real deadline is ~game 108. */
  DEADLINE_SERIES: 36,
  /** Active rosters expand from this series to the end of the regular season. */
  SEPTEMBER_SERIES: 50,

  ACTIVE_ROSTER: 26,
  ACTIVE_ROSTER_SEPTEMBER: 28,
  PITCHER_LIMIT: 13,
  PITCHER_LIMIT_SEPTEMBER: 14,
  FORTY_MAN: 40,

  /** 6 per league: 3 division winners + 3 wild cards. Top 2 seeds get a bye. */
  PLAYOFF_TEAMS_PER_LEAGUE: 6,
  /** Best-of, by round. WC DS CS WS. */
  SERIES_LENGTHS: { WC: 3, DS: 5, CS: 7, WS: 7 },

  DRAFT_ROUNDS: 20,
  /** Rounds whose slot values make up the bonus pool. */
  POOL_ROUNDS: 10,
};

/**
 * ---------------------------------------------------------------------------
 * THE LEAGUE RUN ENVIRONMENT — the baseline every log5 call is centred on.
 * ---------------------------------------------------------------------------
 * These are 2024 MLB, and they are internally consistent: derive AVG, OBP and
 * SLG from the outcome shares below and you land on .243 / .312 / .399 exactly.
 * That consistency is the whole point — a set of rates that does not reproduce
 * the slash line it claims is a lying metric before a single game is played.
 *
 * Per plate appearance:            Derived checks:
 *   K      .226                      BIP  = 1 - K - BB - HBP - HR = .650
 *   BB     .082                      BABIP= (1B+2B+3B)/BIP        = .289
 *   HBP    .012                      AB   = PA - BB - HBP - SF    = .900
 *   HR     .030                      AVG  = H/AB                  = .242
 *   1B     .141                      SLG  = TB/AB                 = .399
 *   2B     .043                      OBP  = (H+BB+HBP)/PA         = .312
 *   3B     .004
 *   ROE    .010
 *   outs   .452  (incl. SF .006, GIDP .019)
 */
export const BB_LG = {
  K: 0.226,
  BB: 0.082,
  HBP: 0.012,
  /** HR per BALL IN PLAY (not per PA): .030 / .650. */
  HR_PER_BIP: 0.0462,
  BABIP: 0.289,
  ROE: 0.010,
  /** Of hits on balls in play: 1B / 2B / 3B shares. */
  HIT_SPLIT: { single: 0.750, double: 0.229, triple: 0.021 },
  /** Of outs in play. Drives GIDP and SF opportunity. */
  OUT_SPLIT: { ground: 0.44, fly: 0.36, line: 0.20 },

  RUNS_PER_TEAM_GAME: 4.39,
  PA_PER_TEAM_GAME: 37.8,
  ERA: 4.08,
  WHIP: 1.27,
  ERRORS_PER_TEAM_GAME: 0.55,
  UNEARNED_SHARE: 0.078,        // of runs
  SB_ATTEMPTS_PER_TEAM_GAME: 0.72,
  SB_SUCCESS: 0.79,
  GIDP_PER_TEAM_GAME: 0.70,
  SF_PER_TEAM_GAME: 0.24,
  PITCHES_PER_PA: 3.90,
  IP_PER_START: 5.20,
  RELIEF_IP_PER_GAME: 3.80,
  SAVES_PER_TEAM_SEASON: 40,
  NO_HITTERS_PER_LEAGUE_SEASON: 3,
};

/** [FRAGILE] How far a rating moves a rate. See §20.2 — these four numbers
 *  set the entire spread of the league, and the asymmetry between the batter
 *  and pitcher BABIP spreads is the model's one real analytic claim. */
export const BB_SPREAD = {
  K: 1.10,
  BB: 1.05,
  HR: 1.50,        // largest: HR rate is the most player-driven outcome
  BABIP: 0.40,     // smallest: the least
  /** Pitchers control balls in play far less than hitters do. This is why FIP
   *  exists, and getting it wrong makes a contact pitcher as valuable as a
   *  strikeout pitcher with the same ERA. */
  PITCHER_BABIP_MULT: 0.5,
  DEFENCE_BABIP: 0.35,
  FRAMING: 0.10,   // worth roughly +/-15 runs a season, best to worst catcher
};

export const BB_SIM = {
  /** One roll per club per game, applied to every player on it that day. */
  GAME_FORM_SD: 2.5,
  HOME_FIELD_EDGE: 1.2,        // real home win pct ~.535
  /** Rating points lost the 3rd and 4th time through the order. Real TTO
   *  penalty is roughly .20 and .35 points of OPS-against. */
  TIMES_THROUGH_PENALTY: [0, 0, 4, 9],
  /** Pitch limit for a starter, mean and sd, before stamina scaling. */
  STARTER_PITCH_LIMIT_MEAN: 95,
  STARTER_PITCH_LIMIT_SD: 15,
  /** A reliever pitching on zero days' rest. */
  LIMITED_REST_PENALTY: 5,
  /** A starter on 3 days' rest — postseason only. */
  SHORT_REST_PENALTY: 6,
  SHORT_REST_INJURY_MULT: 3.0,
  EXTRA_INNINGS_RUNNER_ON_SECOND: true,
};

/** [TUNE] Player generation. Mirrors GENERATION in lib/tuning.ts. */
export const BB_GENERATION = {
  MLB_OVR_MEAN: 72, MLB_OVR_SD: 8,
  AAA_OVR_MEAN: 55, AA_OVR_MEAN: 50, APLUS_OVR_MEAN: 45, A_OVR_MEAN: 41,
  MINORS_OVR_SD: 8,
  ROSTER_OVR_FLOOR: 52,          // nobody on a 26-man is worse than this
  ATTR_SD: 7,

  POTENTIAL_BONUS_MEAN: 8, POTENTIAL_BONUS_SD: 7,
  /** A teenager's ceiling is genuinely less knowable than a 22-year-old's.
   *  Football uses 14/9 for a 22-year-old rookie; an 18-year-old is wider. */
  PROSPECT_POTENTIAL_BONUS_MEAN: 20, PROSPECT_POTENTIAL_BONUS_SD: 12,

  DEV_TRAIT_WEIGHTS: { Slow: 0.25, Normal: 0.55, Star: 0.15, Superstar: 0.05 },

  /** Real MLB handedness. */
  BATS: { L: 0.31, R: 0.60, S: 0.09 },
  THROWS_HITTER: { L: 0.11, R: 0.89 },
  THROWS_PITCHER: { L: 0.27, R: 0.73 },

  /** Shaping rules — see §14.3. */
  POWER_SPEED_TRADEOFF: 0.25,
  VELO_CONTROL_TRADEOFF: 0.15,
  PLATOON_SHIFT_L: { mean: 6, sd: 9 },
  PLATOON_SHIFT_R: { mean: -4, sd: 7 },
  PLATOON_SHIFT_S: { mean: 0, sd: 4 },

  /** The star tier. An unweighted roll makes 99 structurally unreachable. */
  STAR_OVR_MEAN: 89, STAR_OVR_SD: 5.5, STAR_OVR_MIN: 82,
  STAR_COUNT_MIN: 2, STAR_COUNT_MAX: 4,
  STAR_POSITION_WEIGHTS: {
    SP: 3.0, SS: 1.4, CF: 1.3, C: 1.0, RF: 1.0, '3B': 1.0,
    '2B': 0.9, LF: 0.9, '1B': 0.8, RP: 0.7, DH: 0.3,
  },

  /** Fixed, not sampled: a roster with two catchers is not a style choice. */
  ACTIVE_SHAPE: { C: 2, '1B': 1, '2B': 1, '3B': 1, SS: 1, LF: 1, CF: 1, RF: 1, DH: 1, BENCH: 3, SP: 5, RP: 8 },
  SYSTEM_SIZE: { AAA: 24, AA: 24, 'A+': 24, A: 24 },
  FORTY_MAN_MINORS: 14,
  DRAFT_CLASS_SIZE: 900,
  FREE_AGENT_POOL_TARGET: 180,
};

/** [TUNE] Aging. Three curves, because a hitter, a starter and a reliever age
 *  differently enough that one curve would be visibly wrong. See §15.1. */
export const BB_AGE_CURVE = {
  HITTER:   [{ maxAge: 21, d: 4.5 }, { maxAge: 24, d: 3.0 }, { maxAge: 26, d: 1.2 },
             { maxAge: 29, d: 0.2 }, { maxAge: 31, d: -1.0 }, { maxAge: 33, d: -2.0 },
             { maxAge: 35, d: -3.0 }, { maxAge: 99, d: -4.5 }],
  STARTER:  [{ maxAge: 22, d: 4.0 }, { maxAge: 25, d: 2.5 }, { maxAge: 28, d: 0.3 },
             { maxAge: 31, d: -1.2 }, { maxAge: 34, d: -2.5 }, { maxAge: 99, d: -4.0 }],
  RELIEVER: [{ maxAge: 21, d: 4.0 }, { maxAge: 24, d: 2.5 }, { maxAge: 27, d: 0.3 },
             { maxAge: 30, d: -1.2 }, { maxAge: 33, d: -2.5 }, { maxAge: 99, d: -4.0 }],
  /** Bullpens turn over violently in the real sport, and it is what makes a
   *  closer a bad long-term contract and a good trade chip. Feature, not bug. */
  RELIEVER_VOLATILITY: 2.0,
  /** Attributes decline on their own schedules, not on the overall's. */
  ATTR_DECLINE_START: { speed: 27, range: 27, velocity: 29, power: 32, eye: 34, command: 99 },
};

export const BB_PROGRESSION = {
  CHECKPOINT_SERIES: 6,
  CHECKPOINT_GROWTH_SHARE: 0.55,
  LEVEL_TARGET_AGE: { A: 20, 'A+': 21, AA: 23, AAA: 25 },
  /** More than 2 years above your level's target age and you stall. This is
   *  what honestly turns a stalled prospect into org filler. */
  OVER_AGE_DEV_MULT: 0.4,
  PROMOTION_MARGIN: 6,          // OVR clear of the next level's median
  PROMOTION_MIN_GAMES: 40,
  DEV_TRAIT_MULT: { Slow: 0.7, Normal: 1.0, Star: 1.3, Superstar: 1.6 },
};

/** [TUNE] Injuries. Real: ~60% of players hit the IL at least once a season;
 *  pitchers far more than hitters, and a UCL is a 14-month absence. */
export const BB_INJURY = {
  SEASON_RATE: { HITTER: 0.42, STARTER: 0.55, RELIEVER: 0.48 },
  MEAN_DAYS:   { HITTER: 28,   STARTER: 46,   RELIEVER: 32 },
  IL_MIN_DAYS: { HITTER: 10,   PITCHER: 15 },
  IL60_MIN_DAYS: 60,
  /** Durability shifts the rate; age compounds it past 32. */
  DURABILITY_SPREAD: 0.6,
  AGE_MULT_PER_YEAR_OVER_32: 0.06,
  /** A reliever above this appearance pace carries a rising injury multiplier
   *  and a rating decay through September. */
  WORKLOAD_WARN_APPEARANCES: 70,
  WORKLOAD_WARN_PITCHES: 1100,
};

/** [TUNE] Money. Real 2025 figures. */
export const BB_MONEY = {
  MIN_SALARY: 780_000,
  LEAGUE_AVG_SALARY: 4_900_000,
  LEAGUE_MEDIAN_SALARY: 1_500_000,

  /** Opening payroll budget bands by market size 1-10. */
  BUDGET_BY_MARKET: {
    10: [270_000_000, 300_000_000], 9: [230_000_000, 270_000_000],
    8:  [195_000_000, 230_000_000], 7: [175_000_000, 200_000_000],
    6:  [160_000_000, 185_000_000], 5: [145_000_000, 170_000_000],
    4:  [120_000_000, 145_000_000], 3: [100_000_000, 130_000_000],
    2:  [ 85_000_000, 110_000_000], 1: [ 75_000_000,  95_000_000],
  },
  MEDIAN_PAYROLL_TARGET: 150_000_000,

  BASE_REVENUE_GROWTH: 0.035,
  WIN_BONUS_PER_WIN_OVER_81: 900_000,
  PLAYOFF_BONUS_PER_ROUND: 6_000_000,
  TITLE_BONUS: 18_000_000,
  BUDGET_MAX_YOY_CHANGE: 0.25,

  /** The Competitive Balance Tax. A PRICE, never a gate. */
  TAX_THRESHOLD: 241_000_000,
  TAX_TIERS: [
    { over: 0,           surcharge: 0.00 },
    { over:  20_000_000, surcharge: 0.12 },
    { over:  40_000_000, surcharge: 0.45 },
    { over:  60_000_000, surcharge: 0.60, pickPenaltySlots: 10 },
  ],
  TAX_RATE_BY_CONSECUTIVE_YEAR: [0.20, 0.30, 0.50],
  /** Benefits, added to every club's taxable payroll. Flat and real. */
  TAX_BENEFITS: 17_500_000,
  TAX_THRESHOLD_GROWTH: 0.025,

  DEFERRAL_DISCOUNT: 0.045,
};

/** [TUNE] Service time and arbitration. */
export const BB_SERVICE = {
  DAYS_PER_YEAR: 172,
  SEASON_DAYS: 186,
  FREE_AGENCY_YEARS: 6,
  ARB_YEARS: 3,
  /** Top 22% of players between 2.000 and 2.999. Compute the cutoff from the
   *  live population each year — recent real cutoffs are 2.115-2.146. */
  SUPER_TWO_SHARE: 0.22,
  /** Share of open-market value, by arbitration year. */
  ARB_SHARE_BY_YEAR: [0.35, 0.55, 0.75],
  SUPER_TWO_SHARE_BY_YEAR: [0.25, 0.40, 0.60, 0.80],
  /** Arbitration salary is floored here relative to last year's — the real
   *  rule, and it stops one bad season erasing a man's earnings. */
  ARB_CUT_FLOOR: 0.80,
  /** Real settlement rate is roughly 90%. */
  AI_SETTLE_RATE: 0.90,
  HEARING_MORALE_COST: 8,
  /** Qualifying offer = mean of the top 125 salaries in the league.
   *  Real 2025: $21.05M. Compute it; do not hardcode it. */
  QO_TOP_N: 125,
  MIN_DAYS_TO_LOSE_A_YEAR: 172,
  /** A promotion after roughly this league day cannot reach 172 that season. */
  SERVICE_MANIPULATION_DAY: 15,
  PROMOTION_INCENTIVE_ROY_TOP: 2,
};

export const BB_EXTENSION = {
  /** A pre-arb star signs away arb years at roughly this share of their
   *  projected cost in exchange for guaranteed money now. This is the single
   *  most valuable move available to a smart GM and it should feel like it. */
  CONTROL_YEAR_DISCOUNT: 0.55,
  FREE_YEAR_SHARE: 0.95,
  /** Willingness by service class — a 5.100 player takes almost no discount. */
  WILLINGNESS_BY_SERVICE: { PRE_ARB: 1.0, ARB1: 0.8, ARB2: 0.6, ARB3: 0.35, FREE: 0.1 },
};

export const BB_ROSTER = {
  OPTIONS_STANDARD: 3,
  OPTIONS_WITH_FOURTH: 4,
  FOURTH_OPTION_MAX_PRO_SEASONS: 5,
  MIN_DAYS_OPTIONED: 15,
  DFA_WINDOW_DAYS: 7,
  WAIVER_CLAIM_MARGIN: 1.15,
  OUTRIGHT_ELECT_FA_SERVICE_YEARS: 3,
  RULE5_ELIGIBLE_AFTER: { signedAt18OrYounger: 5, signedAt19OrOlder: 4 },
  RULE5_PRICE: 100_000,
  RULE5_RETURN_PRICE: 50_000,
};

export const BB_DRAFT = {
  /** Slot 1.1 real 2025: $11.08M. Slot 1.30: ~$2.7M. Last of round 10: ~$160k. */
  SLOT_BASE: 11_080_000,
  SLOT_EXPONENT: -0.62,
  ROUNDS_11_20_FREE_ALLOWANCE: 150_000,
  LEAGUE_POOL_TARGET: 350_000_000,
  OVERAGE_TIERS: [
    { over: 0.00, tax: 0.75, picksLost: 0 },
    { over: 0.05, tax: 0.75, picksLost: 1 },
    { over: 0.10, tax: 1.00, picksLost: 2 },
    { over: 0.15, tax: 1.00, picksLost: 2 },
  ],
  COMP_BALANCE_PICKS_PER_ROUND: 6,
  /** §22.6. These produce the calibration targets, not the other way round. */
  ETA_YEARS: { COLLEGE_R1: 2.5, COLLEGE_R2_5: 3.5, COLLEGE_R6_20: 4.5,
               HS_R1: 4.5, HS_R2_5: 5.5, HS_R6_20: 6.0 },
  REACH_MLB_P: { COLLEGE_R1: 0.70, COLLEGE_R2_5: 0.35, COLLEGE_R6_20: 0.10,
                 HS_R1: 0.60, HS_R2_5: 0.25, HS_R6_20: 0.05 },
  HS_SHARE_OF_CLASS: 0.42,
  /** Chunked execution. 600 picks in one request is 30-190 seconds. */
  CHUNK_PICKS: 12,
  CHUNK_DEADLINE_MS: 3500,
  AUTO_PICK_FROM_ROUND: 11,
};

export const BB_SCOUTING = {
  /** THE BIAS TERM football never had. Drawn once per (club, player), added to
   *  every observation, so it does NOT cancel under averaging — which is
   *  exactly what makes a bust possible. */
  BIAS_SD: 4.5,
  BIAS_CONFIDENCE_EXPONENT: 0.7,
  /** Fog applies to anyone without major-league service. */
  FOG_REQUIRES_SERVICE_DAYS: 1,
  POT_FLAT_HALF_BAND: 5,        // other clubs' major leaguers, permanent
  /** Confidence gained per game watched in your own system. THE primary way
   *  fog lifts in baseball — you find out by playing him. */
  CONFIDENCE_PER_GAME_OBSERVED: 0.55,
  CONFIDENCE_PER_SCOUT_PASS: 8,
  SHOWCASE_CONFIDENCE: 25,
};

export const BB_TRADE = {
  MAX_CASH: 2_000_000,
  /** Only competitive-balance picks may be traded. */
  TRADEABLE_PICK_KINDS: ['COMP_BALANCE'],
  /** A man signed this league year cannot be dealt until here. Real: June 15. */
  SIGNED_PLAYER_TRADE_SERIES: 20,
  DEADLINE_OFFER_FREQUENCY_MULT: 3.0,
  /** Bounded, exactly as football bounds its equivalents. */
  NEED_MULT_MAX: 1.45,
  SCARCITY_MULT_MAX: 1.30,
  FAIR_BAND: 0.06,
  BID_ASK_SPREAD: 0.08,
};

export const BB_BULLPEN = {
  ROLES: { CLOSER: 1, SETUP: 2, MIDDLE: 3, LONG: 2 },
  HEAVY_OUTING_PITCHES: 30,
  MAX_CONSECUTIVE_DAYS: 2,
  MAX_IN_LAST_3: 2,
  WORKLOAD_WARN: 70,
};

/** Position eligibility and what a move costs. See §13.4. */
export const BB_RELATED_POSITIONS: Partial<Record<string, string[]>> = {
  SS: ['2B', '3B', 'CF'],
  '2B': ['SS', '3B', 'LF', 'RF'],
  '3B': ['1B', 'LF', 'RF'],
  CF: ['LF', 'RF', '2B'],
  LF: ['RF', '1B', 'DH'],
  RF: ['LF', '1B', 'DH'],
  C: ['1B', 'DH'],
  '1B': ['DH'],
  SP: ['RP'],
};
/** 25 starts at a new spot adds it to a man's secondary list at this penalty. */
export const BB_SECONDARY_EARN_GAMES = 25;
export const BB_SECONDARY_EARN_PENALTY = 0.85;
```

## 28. Calibration targets

**This table is the definition of done for the simulation.** Every figure has a
measurement procedure and a real-world anchor. Do not eyeball any of them; write
`scripts/bb/calibrate.ts`, run 100 league-seasons headless, and print this table
with the measured column filled in. Put the output in `docs/baseball/BUILD_LOG.md`
at the end of Phase 3 and again at the end of Phase 9.

### 28.1 League offence and pitching (per team-game unless stated)

| Measure | Real | Accept |
|---|---|---|
| Runs | 4.39 | 4.15–4.65 |
| Batting average | .243 | .238–.248 |
| On-base | .312 | .306–.318 |
| Slugging | .399 | .388–.410 |
| OPS | .711 | .698–.724 |
| Home runs | 1.12 | 1.02–1.22 |
| Strikeouts | 8.55 | 8.0–9.1 |
| Walks | 3.10 | 2.85–3.35 |
| BABIP | .291 | .284–.298 |
| Hits | 8.20 | 7.9–8.5 |
| Doubles | 1.60 | 1.45–1.75 |
| Triples | 0.15 | 0.10–0.22 |
| ERA | 4.08 | 3.85–4.35 |
| WHIP | 1.27 | 1.21–1.33 |
| Errors | 0.55 | 0.45–0.68 |
| Unearned run share | 7.8% | 6–10% |
| SB attempts | 0.72 | 0.60–0.88 |
| SB success | 79% | 74–84% |
| GIDP | 0.70 | 0.58–0.84 |
| Plate appearances | 37.8 | 37.0–38.6 |
| Innings per start | 5.20 | 4.9–5.5 |
| Pitches per PA | 3.90 | 3.7–4.1 |

### 28.2 Season leaders — the tail, which is where football's engine broke

Football's engine put **six quarterbacks a year past the all-time record** and
the fix was one drive per game. The tail is the first thing to go wrong and the
last thing anybody checks. Real single-season records in brackets.

| Leader | Real typical | Real record | Accept | Records past the record |
|---|---|---|---|---|
| Home runs | 47 | (73) | 41–55 | < 0.15/yr |
| Batting average | .340 | (.426, modern .394) | .325–.360 | < 0.10/yr |
| RBI | 130 | (191) | 118–145 | < 0.10/yr |
| Hits | 205 | (262) | 190–222 | < 0.10/yr |
| Stolen bases | 55 | (130) | 42–70 | < 0.05/yr |
| Wins | 19 | (modern 31) | 17–22 | < 0.05/yr |
| ERA (qualified) | 2.10 | (1.12) | 1.85–2.45 | < 0.10/yr |
| Strikeouts | 250 | (383) | 225–285 | < 0.10/yr |
| Saves | 42 | (62) | 37–50 | < 0.10/yr |

**The rule football arrived at, and it is the right target:** *"in terms of
setting hard caps, maybe let's just make it less likely that those really crazy
outliers occur, and they get increasingly less and less likely as they go on"*.
**There are no caps.** Nothing is clamped. If your leaders run hot, the centre
of the distribution is wrong, not the tail — football's 5,909-yard passer was
fixed by removing one drive per game, not by damping anything, and the tail
thinned 11.4x while the coefficient of variation went *up*.

### 28.3 Ratings must predict production

Measured across 120 league-seasons on identical rosters and seeds. **Football
shipped r = 0.082 on linebacker tackles for months and nobody noticed, because
nobody computed it.**

| Correlation | Target | Fail below |
|---|---|---|
| `gamePower` vs HR | 0.75 | 0.55 |
| `contact` vs AVG | 0.60 | 0.40 |
| `eye` vs BB% | 0.75 | 0.55 |
| `avoidK` vs K% | −0.75 | −0.55 |
| `speed` vs SB | 0.65 | 0.45 |
| pitcher `velocity`+`breaking` vs K/9 | 0.75 | 0.55 |
| pitcher `control`+`command` vs BB/9 | −0.75 | −0.55 |
| pitcher OVR vs FIP | −0.70 | −0.50 |
| club `defenceIndex` vs opponent BABIP | −0.45 | −0.25 |
| team OVR vs wins | 0.72 | 0.55 |

Also report **quartile spreads**: a top-quartile power hitter must out-homer a
bottom-quartile one by at least 2.2x. Football's linebacker managed 1.02x.

### 28.4 League shape

| Measure | Real | Accept |
|---|---|---|
| Best record | 100-62 | 96–106 wins |
| Worst record | 55-107 | 50–62 wins |
| SD of team wins | 11.3 | 9.5–13.0 |
| Home win % | .535 | .520–.550 |
| Extra-inning games | 8.6% | 7–11% |
| Shutouts per team-season | 8 | 5–12 |
| No-hitters per league-season | 3 | 1–6 |
| Games decided by 1 run | 27% | 24–31% |

### 28.5 The front office

| Measure | Target | Why |
|---|---|---|
| Median club payroll | $145M–$160M | against a $241M tax line |
| Clubs over the tax line | 2–6 of 30 | real is typically 6-9; fewer is fine, zero is a broken tax |
| Payroll spread (max/min) | 2.5x–4.0x | the sport's defining inequality must be visible |
| Free agents signed in the 3 FA presses | ≥ 85% of the top 40 | football measured this and it is the test of a working market |
| Free agent pool size, seasons 1-15 | 120–260 | football's grew 140 → 4,740 and became unreadable |
| Non-tenders per offseason | 25–50 league-wide | |
| Arbitration cases reaching a hearing | 8–14% | real is ~10% |
| Rule 5 picks per year | 8–18 | |
| Trades per season | 45–90 | real is ~120 including minor deals |
| Deadline share of trades | 35–50% | the deadline must be the event |
| Draftees who ever reach MLB | 17–20% | §22.6 |
| First-rounders who reach MLB | 60–72% | |
| Median years from draft to debut | 3.5–4.5 | |
| Active roster illegal at any check | **0** | INV-B03 |

### 28.6 Awards must not be confined

Football's DPOY was a safety **96%** of the time and an edge rusher never won
it once — the confinement was the simulation's, not the award's, and it was only
found because somebody replayed 158 seasons and counted.

Across 100 generated league-seasons, report the winner's **position
distribution** for MVP, Cy Young, Rookie of the Year and each Gold Glove, and
the share of MVPs that are pitchers.

| Award | Accept |
|---|---|
| MVP by position | no position above 30%; DH below 15% |
| MVP that is a pitcher | 2–8% |
| Cy Young by club rank | not more than 50% from top-5 clubs |
| Gold Glove at a position | no single club above 25% across seasons |
| MVP and Cy Young to the same club | 5–15% |

If any of these is confined, **say so in the build log and name it as a known
simplification rather than papering over it with a tiebreak rule.** Football
named its award confinement out loud in the same commit that fixed a different
award bug, precisely so nobody would mistake it for having been fixed.

## 29. Invariants and harnesses

Ship `BASEBALL_INVARIANTS.md` with the structure `GAME_INVARIANTS.md` has:
numbered rules, what each protects, a "Known violations → Fixed / Still open"
section, and a note that a rule which is a property of the *arithmetic* rather
than of stored state cannot be read off a snapshot and carries its own harness.

Rules live in `lib/baseball/invariants.ts` and report by ID. **A check added
there without a rule in the doc is undocumented; a rule in the doc without a
check is unverified.**

### 29.1 The numbered rules

**Player status and roster membership**

- **INV-B01** — `rosterLevel` is always one of the eight declared values.
- **INV-B02** — `rosterLevel` in `{ACTIVE, IL, IL60, OPTIONED, MINORS}` implies
  `teamId != null`; `FA` / `RETIRED` / `DRAFTEE` implies `teamId == null`.
- **INV-B03** — Outside `OFFSEASON` / `ROSTER_CRUNCH` / `FREE_AGENCY`, every
  club's active roster is **exactly** `ACTIVE_ROSTER` (26, or 28 from
  `SEPTEMBER_SERIES`), with no more than `PITCHER_LIMIT` pitchers. *Error, not
  warning* — an illegal Opening Day roster is not a decision a GM may make.
- **INV-B04** — No club's `on40Man` count exceeds 40. A player on the 60-day IL
  has `on40Man === false`.
- **INV-B05** — `on40Man` agrees with `rosterLevel` for every player: true for
  `ACTIVE / IL / OPTIONED`, false for `IL60 / MINORS / FA / RETIRED / DRAFTEE`.
  *(This is the denormalised column checking itself. Football's twelve-man
  defence existed because nobody ever added a column up.)*
- **INV-B06** — Every club's active roster covers all eight defensive positions
  with at least one available man who can play each.
- **INV-B07** — `rosterLevel === 'MINORS' | 'OPTIONED'` implies
  `level != 'MLB'`; `ACTIVE | IL` implies `level === 'MLB'`.
- **INV-B08** — `isDraftee === true` implies `teamId == null` and
  `rosterLevel === 'DRAFTEE'`. No draftee is more than one game-year behind
  `seasonYear` — a class is minted a full game-year before its own draft runs,
  so `draftYear === seasonYear` is normal and anything older is a prospect
  nothing ever drafted, sitting in limbo.
- **INV-B09** — `ilDaysLeft === 0` implies `ilDesignation == null` **and**
  `injuryType == null`. *(Football carried a torn hamstring into a new season
  with nothing counting down, invisible because every reader gated on the
  clock.)*
- **INV-B10** — `optionYearsUsed <= 4`, and `<= 3` for a player with
  `proSeasons >= 5`.

**Contracts and money**

- **INV-B11** — `rosterLevel` in `{ACTIVE, IL, IL60, OPTIONED, MINORS}` implies
  exactly one `BbContract` row exists, and its `teamId === player.teamId`.
- **INV-B12** — `rosterLevel` in `{FA, RETIRED, DRAFTEE}` implies no contract.
- **INV-B13** — `0 <= yearsRemaining <= years`, and `salaries` parses to an
  array of length `years`.
- **INV-B14** — Every salary is `>= BB_MONEY.MIN_SALARY` for a major-league
  contract, under every settings mode.
- **INV-B15** — `aav` equals the present-value-adjusted total over `years`,
  within $1 of `computeAav(contract)`. *(The tax number and the contract must
  never disagree — this is the tax's whole basis.)*
- **INV-B16** *(warning)* — No club's cash payroll exceeds its
  `payrollBudget`. Warning, not error: an arbitration award the club lost, or a
  trade that backfired, can legally leave it over, and the consequence is that
  it may not add anybody until it sheds salary. There is no advance block.
- **INV-B17** — Every `BbPayrollCharge` belongs to a club that still exists.
  Structural: the foreign key with `onDelete: Cascade` guarantees it. *(Football
  learned this at 18,247 orphaned rows.)*

**Draft**

- **INV-B18** — `used === true` implies `playerId != null` **or**
  `signed === false` (a pick spent on a man who never signed). `used === false`
  implies `playerId == null`.
- **INV-B19** — No two `BbDraftPick` rows share `(leagueId, year, round, slot)`.
  **The key does not carry `originalTeamId`** — see the schema comment.
- **INV-B20** — Any pick from a year strictly before `seasonYear` is `used`.
- **INV-B21** — Every club's `poolSpent` equals the sum of `bonusPaid` across
  its signed picks in rounds 1..`POOL_ROUNDS` plus the over-$150k excess in
  rounds 11-20.

**Season flow**

- **INV-B22** — `phase` is one of the seven declared values.
- **INV-B23** — During `REGULAR`, `1 <= seriesNo <= TOTAL_SERIES`.
- **INV-B24** — If `BbDraftState.complete`, `phase != 'DRAFT'`.
- **INV-B25** — Every club has played the same number of games, ±3. *(A
  schedule that drifts is invisible until the standings are wrong.)*

**Service time**

- **INV-B26** — `serviceDays >= 0`, and no player's `serviceDays` decreases
  across any advance.
- **INV-B27** — A player with `serviceDays >= 6 × 172` and no contract is
  `FA`, never `MINORS`. *(Six years of service is freedom, and a club may not
  bury a free man in the minors.)*
- **INV-B28** — Every `BbArbitrationCase` for a past season has
  `status != 'PENDING'`.

**Lineups**

- **INV-B29** — Every club has exactly two `BbLineupCard` sets of exactly nine
  rows, covering the eight defensive positions plus DH exactly once each, with
  nine distinct players, all on the active roster.
- **INV-B30** — Every club's `BbPitchingStaff.rotation` has exactly 5 distinct
  playerIds, all `SP`, all on the active roster.

**Transitions (checked across a step, not from a snapshot)**

- **INV-BT1** — At `ROLL_STATS`, the league-wide sum of every counting stat
  moves entirely from `seasonStats` into `careerStats` — nothing lost, nothing
  doubled.
- **INV-BT2** — At `ACCRUE_SERVICE`, every active player's `serviceDays`
  increased by exactly the number of game days he was on a roster.
- **INV-BT3** — Every `draftPlayer()` call consumes exactly one `BbDraftPick`
  owned by the club on the clock, for the round on the clock.

### 29.2 Arithmetic rules with their own harnesses

These cannot be read off a snapshot, so they are **not** in
`lib/baseball/invariants.ts`. Each is a standalone script that exits non-zero,
**each carries a canary (§4.3)**, and each must be proved to be a real gate by
reverting the fix it protects and counting the failures — football's harnesses
all report that number in their header, and it is what distinguishes a gate from
a comment.

- **INV-B31 — rewriting a contract moves money, it never creates or destroys
  any.** `scripts/bb/checkContractMath.ts`, pure arithmetic, no database. Sweeps
  contract lengths 1-12, deferral shapes 0-5 years, opt-outs, club options with
  and without buyouts, and every year already played. Four clauses:
  - **A zero-dollar deferral is a no-op.** Defer nothing and every year's cash,
    the AAV and the money owed on a release are all unchanged.
  - **Total cash paid equals total value.** However many times a deal is
    reshaped.
  - **AAV never exceeds total value over years**, and a deferral only ever
    lowers it — a deferral that raised the tax number would be the opposite of
    the mechanic.
  - **A release owes the full remaining guarantee**, to the dollar, in the years
    it was already scheduled in.
- **INV-B32 — the ledger the database holds is the ledger the function
  computed.** `scripts/bb/checkPayrollWrite.ts`, against a real throwaway
  league. Sweeps 300+ contract shapes through the real write path and compares
  the row read back **field for field** against the pure function, then against
  `payrollSummary`. *Field for field on purpose: a check aimed at the one field
  that was dropped would pass the next drop.* Football's restructure library
  silently never wrote the guaranteed figure its own function computed, storing
  $45.0M against a computed $28.7M.
- **INV-B33 — a box score is an accounting document and it balances.**
  `scripts/bb/checkBoxScore.ts`, no database, sweeps 4,000+ games. **Nine
  clauses, every one an identity rather than a tuning target:**
  1. Runs in the line score sum to the final.
  2. A club's runs equal the runs credited to its batters as scored.
  3. RBI ≤ runs scored league-wide, and every run has a scorer.
  4. Every hit by a batter was allowed by a pitcher: league batter hits equal
     league pitcher hits-allowed, exactly.
  5. The same for walks, strikeouts, home runs and hit batsmen.
  6. Outs recorded by pitchers = 3 × innings pitched, per game, per side.
  7. At-bats + walks + HBP + sacrifices = plate appearances, per player.
  8. Earned runs ≤ runs, per pitcher, per game.
  9. Every plate appearance produced exactly one outcome — the outcome counts
     sum to the PA count.

  **Zero tolerance on all nine.** Unlike football's, none of these is a
  rounding case: a PA engine accumulates rather than allocates, so there is no
  slice to round. If a clause needs a tolerance, the engine is wrong.
- **INV-B34 — the meter cannot promise what the server refuses.**
  `scripts/bb/checkNegotiationAgreement.ts`. Sweeps the offer space — salary ×
  years × guarantee share × opt-outs × service class × personality — and asserts
  the client-side `evaluateOffer` and the server-side `decideOffer` agree on
  interest, verdict and acceptance at every point. Report the comparison count.
  Football's runs ~1,025,000 and is the most important check in that repo.
- **INV-B35 — no position change may pay for itself.**
  `scripts/bb/checkPositionValue.ts`, run **at module import** of
  `lib/baseball/ai/gm.ts`, not merely exported — *an assertion nothing runs is a
  comment that lies.* Outcome-based, not a table comparison: build a synthetic
  player the way `lib/baseball/ratings.ts` builds one, convert him, and compare
  `clubValue` before and after. Baseball's live constraint is the reverse of
  football's: **moving down the defensive spectrum must always lose value**,
  because the offensive bar at first base is far higher than at shortstop.

### 29.3 The health harness

`scripts/bb/simHealth.ts`, wired as `npm run bb:health`.

```
npm run bb:health -- [leagues] [seasons]     # default 5 5
```

Generates N leagues, drives each M seasons deep through the **real**
`advanceSeries`, and runs the full invariant check **after every phase
transition**. Exits non-zero on any error-severity violation or any league that
fails to finish.

Three things football's harness learned and yours must start with:

1. **Nobody owns a club in a harness league.** All 30 clubs are run by the AI,
   the user's included — otherwise every gate that refuses to act on a human's
   behalf stalls the run forever. Football's stalled for exactly this reason: a
   club at the roster ceiling coming out of the draft, and cut-down day
   refusing to cut for a human.
2. **State plainly what a headless league does not exercise.** Football's does
   not reach the cut-down block, the cap-compliance block, the re-sign warning,
   AI trade offers to the user, or the coached-development bonus. Write your
   equivalent list in the harness header, because a harness whose coverage is
   unstated reads as covering everything.
3. **`sim:health` structurally cannot catch a box-score bug.** It reads league
   *state*, and a box score that does not add up is perfectly valid state. That
   is why INV-B33 is a separate harness and why the README must say so.

Additionally: **`npm run bb:health` must be run before any commit that touches
the season flow, the draft, trades, free agency, contracts or the roster
system**, and `npx tsx scripts/bb/checkBoxScore.ts` before any commit that
touches the engine. Put both sentences at the top of `BASEBALL_INVARIANTS.md`.

## 30. The screens

38 football routes exist. Baseball needs 27. Every one is listed; the six that
carry the game are laid out in full.

### 30.1 The route inventory

| Route | Answers | Football analogue |
|---|---|---|
| `/baseball/new` | Which club, which settings | `/new` |
| `/baseball/start/[id]` | Pick your club from a wall of crests | `/start/[id]` |
| `/baseball/league/[id]` | **Dashboard** — what needs me today | `/league/[id]` |
| `/baseball/league/[id]/roster` | **The 26, the 40, and everyone else** | `/roster` |
| `/baseball/league/[id]/lineup` | Who bats where, against each hand | `/depth-chart` |
| `/baseball/league/[id]/staff` | Rotation and bullpen, with availability | *new* |
| `/baseball/league/[id]/farm` | **The system, level by level** | *new* |
| `/baseball/league/[id]/player/[playerId]` | Who is this man | `/player/[playerId]` |
| `/baseball/league/[id]/payroll` | **What am I committed to** | `/cap` |
| `/baseball/league/[id]/arbitration` | Tender, file, settle, hear | `/resign` |
| `/baseball/league/[id]/free-agency` | Who can I sign | `/free-agency` |
| `/baseball/league/[id]/trade` | **The trade centre** | `/trade` |
| `/baseball/league/[id]/draft` | **The board, all year; the room in June** | `/draft` |
| `/baseball/league/[id]/scouting` | Where my eyes are | `/scouting` |
| `/baseball/league/[id]/standings` | The races and the wild card | `/standings` |
| `/baseball/league/[id]/schedule` | What is coming | `/schedule` |
| `/baseball/league/[id]/game/[gameId]` | What happened in that game | `/game/[gameId]` |
| `/baseball/league/[id]/stats` | League leaders, my club's lines | `/stats` |
| `/baseball/league/[id]/power-rankings` | Who is actually good | `/power-rankings` |
| `/baseball/league/[id]/analytics` | Why my club is what it is | `/analytics` |
| `/baseball/league/[id]/news` | The wire | `/news` |
| `/baseball/league/[id]/transactions` | Every roster move, filterable | *new* |
| `/baseball/league/[id]/history` | The franchise's whole book | `/history` |
| `/baseball/league/[id]/records` | The record book | *(part of `/history`)* |
| `/baseball/league/[id]/gm` | My tenure | `/gm` |
| `/baseball/league/[id]/dynasty` | Levels and the skill tree | `/dynasty` |
| `/baseball/league/[id]/team/[teamId]` | A rival's roster and books | `/team/[teamId]` |
| `/baseball/league/[id]/settings` | The knobs | `/settings` |

**Deleted, with the reason:** football's `/design-system/*` mock routes are
shared and need no baseball copies; football's `/draft/broadcast` was merged
into `/draft` and baseball starts there.

**New, and each earns its place:** `/staff` because a rotation and a bullpen are
not a depth chart; `/farm` because a system is not a bench; `/transactions`
because baseball generates five times football's roster churn and burying it in
the wire would drown the news; `/records` as its own page because baseball's
record book is a destination and not a panel.

### 30.2 The dashboard — `/baseball/league/[id]`

Answers *what needs me today*. Everything else is one click.

```
┌ PageMasthead ─────────────────────────────────────────────────────────┐
│  TIGERS · Detroit          [crest, team-tinted band]                  │
│  74-58 · 2nd AL Central, 3.5 GB · Wild card: +2.0                     │
│  Facts: Payroll $168.4M/$180.0M | Tax room $72.6M | 40-man 38/40      │
│         Series 47 of 54 | Games back 3.5                              │
│  (every fact tile is a door — payroll → /payroll, 40-man → /roster)   │
└───────────────────────────────────────────────────────────────────────┘

┌ FRONT OFFICE ──────────────────┐  ┌ THE SERIES ───────────────────────┐
│ Ordered by urgency, not by     │  │ Next: at Cleveland (78-54)        │
│ source order. Each item has a  │  │ Fri Casas (11-6, 3.12) v Ortega   │
│ headline, a detail and a DOOR. │  │ Sat Whitfield v Bevins            │
│                                │  │ Sun Nakamura v Ruiz               │
│ • Ferreira has thrown in 9 of  │  │ Season series 4-5                 │
│   the last 14 →  /staff        │  └───────────────────────────────────┘
│ • 3 men out of options →/roster│  ┌ CLUB LEADERS ─────────────────────┐
│ • Deadline in 4 series → /trade│  │ AVG .318 Beltrán  HR 31 Okafor    │
│ • Salazar is hitting .312 at   │  │ ERA 2.94 Casas    SV 28 Whitmore  │
│   Toledo, 40-man ready →/farm  │  └───────────────────────────────────┘
└────────────────────────────────┘
┌ LAST SERIES ───────────────────┐  ┌ AL CENTRAL ───────────────────────┐
│ W 6-4 · L 2-5 · W 7-1          │  │ StandingsTable, division + WC     │
│ Okafor 2 HR Sunday             │  │ with GB and the wild card line    │
└────────────────────────────────┘  └───────────────────────────────────┘
┌ THE WIRE ────────────────────────────────────────────────────────────┐
│ Ranked, not most-recent. Category kickers. IL rows excluded.          │
└──────────────────────────────────────────────────────────────────────┘
┌ TRAINING ROOM ─────────────────┐  ┌ STORYLINES ───────────────────────┐
│ 4 on the IL, with return dates │  │ Generated season narrative        │
└────────────────────────────────┘  └───────────────────────────────────┘
```

In the offseason the masthead's facts swap to *Payroll committed / Arb class /
40-man / Free agents*, and an **Offseason Roadmap** widget appears showing the
five stages with the current one highlighted and how far through it you are.
The current stage is a link; the finished and upcoming ones deliberately are
not. **Suppress it on a brand-new save's first spring** — football's was the
largest thing above the fold on a fresh league and drew four stages as complete
that never happened.

### 30.3 The roster — `/baseball/league/[id]/roster`

Three tabs, client state, never a URL: **Active (26) · 40-Man · Depth**.

Every row: avatar, name, position, age, bats/throws, OVR chip, **service time**
(`3.147`), **options left** (`2` / **`OUT`** in red), salary, contract years
left. The service and options columns are the two football has no analogue for
and they are the two a baseball GM reads first.

Row actions by context: **Option to AAA** (greyed with the reason when he is
out of options or was optioned inside 15 days), **Recall**, **Place on IL**,
**Activate**, **Designate for Assignment**, **Release**.

The masthead's fact strip: `Active 26/26 · Pitchers 13/13 · 40-Man 38/40 ·
Out of options 3 · On the IL 4`. Each is a door.

A **legality banner** above the table when `rosterLegality()` reports a
violation, naming the specific one and the fix. Never a generic "roster
invalid".

### 30.4 The lineup — `/baseball/league/[id]/lineup`

Two cards side by side at ≥1024px, tabbed below it: **vs RHP** and **vs LHP**.
Nine rows each: order number, avatar, name, the defensive position as a select,
his platoon-adjusted rating **for that card**, his line against that hand this
season, and ▲/▼ to reorder.

Under them: the **bench**, with what each man covers, and a **coverage strip**
showing all eight defensive positions with a tick or a gap.

**Auto-Sort** uses the real batting-order heuristic (§19.1), not rating order,
and says so on the button: *"Auto — OBP leads off"*.

The gap banner reads exactly as football's does — dismissible, scoped to the
hole dismissed — and it must say *"backups start automatically"* rather than
asking for a reorder, because the engine filters availability before it reads
the card. Football shipped the opposite instruction and cost GMs twenty-five
presses a year that did nothing.

### 30.5 The staff — `/baseball/league/[id]/staff`

The screen with no football analogue at all.

**Rotation**: five ordered slots, each with the pitcher, his record and ERA,
his next scheduled start (*"Game 2 of the Cleveland series"*), and ▲/▼.

**Bullpen**: the role chart — closer, two setup, three middle, two long — as
drop targets, and beneath it **the availability grid**, which is the point of
the page:

```
                     Fri   Sat   Sun     Last outing
Whitmore   CL        ●     ●     ●       Sun, 12 pitches
Ferreira   SU        ○     ●     ●       Wed, 34 pitches  ← 9 of the last 14
Ruiz       SU        ●     ●     ●       Mon, 18
Okonkwo    MID       ●     ●     ●       —
Baptiste   MID       ✕     ○     ●       Thu + Wed
...
● full   ○ one inning only   ✕ unavailable
```

Three days ahead, because the decision a GM makes is *who do I have for this
series* and a single pill on today cannot answer it. Hover gives the reason in
words: *"Threw 34 pitches Wednesday."*

**Workload**: appearance and pitch pace against the season, with anyone past
`WORKLOAD_WARN` flagged and named in the front-office brief.

### 30.6 Payroll — `/baseball/league/[id]/payroll`

Basic / Advanced toggle, as football's cap page has.

**Basic** — two numbers side by side, never one wearing the other's label:

```
CASH PAYROLL                     LUXURY TAX PAYROLL
$168.4M                          $184.9M
of a $180.0M budget              of a $241.0M threshold
$11.6M of room                   $56.1M under the line
                                 2nd straight year over would cost 30%
```

Below: the full roster sorted by salary, every man with his cash, his AAV, his
service class and his years remaining; then **money owed to men who are gone**
(`BbPayrollCharge`), itemised by cause.

**Advanced** adds the four charts, and the first is the one a baseball GM lives
on and football cannot draw at all:

1. **The six-year commitment ladder** — guaranteed money, projected arbitration
   and open room, stacked by year, six years out.
2. Payroll by position group.
3. Salary against `clubValue` — the over/underpaid scatter, the
   `vizGood`/`vizBad` diverging pair.
4. Your payroll against the league, with the tax line drawn.

### 30.7 The trade centre — `/baseball/league/[id]/trade`

Football's screen, re-pointed. Partner selector, both clubs' payroll and 40-man
count in the masthead, two asset columns with **players, prospects and cash**,
a live acceptance meter, and the AI's explanation of what it liked and did not.

Baseball-specific and load-bearing:
- **The prospect column shows the fogged read**, not the truth — your read, with
  its range — and the partner's counter-argument names *their* read when it
  differs. That disagreement is the whole trade.
- **Control years are a column.** A 26-year-old with four years left is a
  different asset from the same player with one, and the table must say so
  without the GM opening a card.
- **Cash** is a slider, capped at `MAX_CASH`, with the marginal tax effect of
  including it printed live.
- **A deadline countdown in the masthead** from series 33.
- Retrospectives on this screen are limited to deals made **with the club
  currently selected** — 1-3 rows, moving with the partner selector, nothing at
  all with no shared history, and a link to the full graded list on the GM page.

### 30.8 The draft — `/baseball/league/[id]/draft`

Two views with the clock standing above both always: **THE BOARD** (the men,
the filters, the server-side name search, your picks, the bonus-pool panel) and
**THE ROOM** (the broadcast). Default: board while the draft runs, room once it
is over. After the last pick the panes become **THE CLASS** and **WHAT'S LEFT**.

The bonus-pool panel sits **above** the Start button, not inside its
confirmation, and it walks the picks in selection order: *"Your pool is $9.42M.
The money runs out at Round 3, pick 12. $410K gets you past it; $2.1M signs the
class."*

Baseball columns the football board has no equivalent for: **age**, **level**
(HS / College / JuCo), **signability**, **ETA**.

### 30.9 Everything else, in one line each

- **Player card** — tabs: **Stats** (default) / **Contract** / **Scouting**.
  Stats by default because *"that way players aren't like 'why am i looking at
  stats now?'"*, and every link that arrives asking a money question opens the
  contract face. Hero carries the crest, the avatar, OVR, potential, bats/
  throws, age and **service time**. Year-by-year table with a row per season per
  level per club, "2TM" recombination, the whole minor-league climb visible.
- **Farm** — four level panels, each with its affiliate's name and crest, every
  prospect with his fogged grade, his line at that level, his ETA and his
  40-man/Rule 5 status. Sorted by organisational rank. The **top 30** are
  numbered, because a farm system ranking is how the sport talks about a farm.
- **Arbitration** — the offseason's biggest screen. Every arb-eligible man, his
  projected salary, his platform season, the comparables, and Tender /
  Non-tender / Settle / File. See §31 for the hearing copy.
- **Standings** — division tables plus the wild-card standings as their own
  block with the cut line drawn, because the wild card is where most clubs
  actually live.
- **Records** — season, career and single-game, with the holder's crest and the
  year. No-hitters get their own list.
- **Analytics** — run environment, park effects, the platoon splits, the
  bullpen's leverage record, the rotation's innings load.

## 31. Copy — the voice, written out

The rule is §4.5: *useful and informative, never an explainer that breaks
immersion.* A fresh agent will not have the ear for it, so here is the ear.

**What the voice does:** states the fact, gives the scale, names the
consequence, and stops. It talks about baseball. It never mentions the sim, the
database, a rating, a probability, a stat line as a stat line, or this save.
It uses the club's and the player's names. It is written the way a scout or a
capable assistant GM would say it out loud, and it is never chirpy.

**What the voice never does:** exclaim, congratulate, explain the game's
systems to the player, say "you can now", or use a percentage where a sentence
will do. Football cut an entire pass of copy for exactly this — *"Stop the game
explaining itself to the player"*.

### 31.1 The arbitration hearing

Before filing:

> **Okafor filed at $8.4M. You filed at $6.1M.**
>
> There is no splitting the difference. The panel hears both sides and picks
> one of the two numbers, whole. Settle now and you can land anywhere between
> them; go to the room and one of you gets everything.
>
> Your case: he played 138 games and drove in 91, and two of the four men his
> agent will point at drove in more on better clubs. His case: 31 home runs is
> 31 home runs, and the last three second-year men to hit 30 all cleared $8M.
>
> [ Settle at $7.2M ] [ Go to the hearing ]

The verdict, club wins:

> **The panel took your number.** Okafor is signed for one year at $6.1M.
>
> They weighed him against Ruiz ($6.4M, 3.041), Bellamy ($5.9M, 3.112) and
> Kanté ($6.6M, 3.088) and did not find enough daylight. His agent did not
> take it well, and neither did he.

The verdict, player wins:

> **The panel took his number.** Okafor is signed for one year at $8.4M —
> $2.3M more than you budgeted, and it comes out of this year's payroll.
>
> Vasquez ($8.1M) and Bright ($8.9M) both got there off a similar season, and
> the room decided he belonged with them rather than a tier down. Nothing about
> him changed today; the price did.

### 31.2 The call-up, and the year it costs

Covered in §17.7; the exact text is there and it is the single most important
piece of copy in the game because it is where the sport's signature decision
becomes legible.

The ordinary call-up, no service consequence:

> **Bringing Salazar up.**
>
> He is hitting .312 at Toledo with 40 games behind him, and the shortstop in
> front of him is hitting .208. This is his first option year; you can send him
> back twice more.
>
> Somebody has to come off the 26 to make room.
>
> [ Promote him ] [ Not yet ]

### 31.3 Designating a man for assignment

> **Designating Wexler for assignment.**
>
> He comes off the 40-man now. You have seven days to trade him. If nobody
> claims him he can be sent to Toledo — but he has five years in and a prior
> outright, so he does not have to go: he can walk and keep every dollar of the
> $4.2M you still owe him either way.
>
> This is how the roster spot gets made. It is not how it gets made cheaply.
>
> [ Designate Wexler ] [ Keep him ]

### 31.4 The trade deadline

Three series out, on the dashboard:

> **Three series to the deadline.** You are 4.5 back with eighteen to play, and
> the two clubs above you have both bought. Villanueva is a free agent in
> November; three contenders have called about him this week.

Deadline day, on the wire:

> **The deadline passed at 6pm.** Nineteen deals in the last two days, four of
> them in the last hour. Kansas City sold everything that was not nailed down;
> Seattle bought a bullpen. Nobody may trade again until November.

### 31.5 September expansion

> **The rosters are 28 now.** Two more men until the last day of the season —
> a fourteenth arm if you want one, or a bat off the bench. Whoever you bring
> up starts his service clock; whoever you bring up and leave up is on the
> postseason roster.

### 31.6 The owner's letter (at ROSTER_CRUNCH)

The single best immersion beat available. It comes from the owner, in his own
register, and it is different every year because it is built from the season
that just happened.

> **From the owner's office.**
>
> Ninety-one wins and a division series is a good year in this town and I told
> the room as much. It was also our third straight season inside the top five
> in payroll and our third straight without a pennant, and I would like those
> two facts to stop sitting next to each other.
>
> You have **$186 million** for next year. That is up four from this year and
> it is up because we drew well in September, so thank you for September.
>
> I am not going to tell you how to spend it. I am going to tell you that the
> tax line is $241 million and that I have never once enjoyed writing that
> cheque.

And on a bad year, small market:

> **From the owner's office.**
>
> Sixty-eight wins. I know what the room looks like and I know whose fault
> most of it isn't.
>
> You have **$88 million**. It is down nine, and it is down because nobody
> came in August. I want you to spend it on men who will still be here when
> this is good again, and I would rather be told the truth about how long that
> is than be told what I want to hear.

### 31.7 The draft, on the clock

> **You are on the clock. Round 1, pick 14.**
>
> Two of your top four are still there. Beaumont is a nineteen-year-old
> shortstop out of a Georgia high school with a college commitment and a price
> to match — signing him at slot is not the likeliest outcome. Villalobos has
> been in a college rotation for three years and would be in Double-A by
> August.
>
> Your pool is $9.42M and pick 14 slots at $4.86M.

### 31.8 Glossary entries — the pattern, with five real ones

Each is `{ definition, why? }` and `tip(key)` glues them. Keyed camelCase.

```ts
serviceTime: {
  definition: 'How long a man has been in the majors, counted in days. A hundred '
    + 'and seventy-two days is a full year, and a season is a hundred and eighty-six.',
  why: 'It is the clock that decides everything. Three years and he can argue about '
    + 'his salary. Six and he can leave. Until then he plays for what you decide '
    + 'to pay him.',
},
options: {
  definition: 'The right to send a man to the minors and back without losing him. '
    + 'A club has three of them, one per season, and they belong to the player, not '
    + 'to the trip.',
  why: 'When they are gone, sending him down means putting him on waivers, where '
    + 'any of the other twenty-nine may take him for nothing. A man out of options '
    + 'is on your team all year or on somebody else\'s.',
},
luxuryTax: {
  definition: 'A charge on every dollar of payroll above the league threshold. '
    + 'Twenty per cent the first year, thirty the second, fifty from the third — '
    + 'and it climbs again the further past you go.',
  why: 'It is a price, not a rule. Nothing stops you crossing it. The bill arrives '
    + 'in the winter and comes straight out of next year\'s budget, which is the '
    + 'part that hurts.',
},
release: {
  definition: 'Letting a man go before his contract is up.',
  why: 'It does not save you a dollar. Every year of a major-league deal is '
    + 'guaranteed, and you pay it whether he plays for you or for somebody else. '
    + 'What a release buys is the roster spot.',
},
qualifyingOffer: {
  definition: 'A one-year offer at the average of the league\'s top hundred and '
    + 'twenty-five salaries, made to a man about to reach free agency. He may take '
    + 'it or turn it down.',
  why: 'Turn it down and sign elsewhere, and you get a draft pick after the first '
    + 'round while the club that signed him gives one up. A man can only ever be '
    + 'offered it once, and only if he spent the whole season with you.',
},
```

### 31.9 A no-hitter

> **Casas did not allow a hit.**
>
> Nine innings, two walks, eleven strikeouts, 118 pitches. Nobody reached
> second after the fourth. The last man to do this in a Detroit uniform was
> Whitlock in 2019.

## 32. File manifest, in dependency order

Create, modify, leave alone. Ordered so nothing is imported before it exists.

### Phase 1 — schema and merge
```
MODIFY  prisma/schema.prisma                      §26 block + User back-relation
CREATE  prisma/migrations/<ts>_baseball_core/     migrate dev
CREATE  lib/shared/rng.ts                         moved from lib/rng.ts
CREATE  lib/shared/json.ts                        moved from lib/json.ts
CREATE  lib/shared/fog.ts                         moved from lib/scouting.ts
CREATE  lib/shared/gen/names.ts                   pools + NameRegistry
CREATE  lib/shared/gen/avatar.ts, teamLogo.ts     moved
MODIFY  (football imports of the five modules above)
MODIFY  lib/owner.ts                              + ownsBbLeague, canViewBbLeague
MODIFY  lib/leaderboard.ts                        + BASEBALL label, refreshBaseballRanks stub
CREATE  app/baseball/layout.tsx, page.tsx         stub landing
MODIFY  app/page.tsx                              sport segment
CREATE  docs/baseball/BUILD_LOG.md
CREATE  BASEBALL.md                               skeleton
MODIFY  README.md                                 ONE line under "Where things live"
```

### Phase 2 — generation
```
CREATE  lib/baseball/tuning.ts                    §27, whole
CREATE  lib/baseball/types.ts                     BbSeasonStats, BbBoxScore, BbTradeAsset
CREATE  lib/baseball/settings.ts                  BbLeagueSettings + parse/serialize
CREATE  lib/baseball/ratings.ts                   attributes, weights, computeOverall, tiers, grade2080
CREATE  lib/baseball/positions.ts                 BB_POSITIONS, groups, sort order
CREATE  lib/baseball/db.ts                        thin re-export of prisma (parity with football)
CREATE  lib/baseball/gen/names.ts                 club seeds, park names, origins
CREATE  lib/baseball/gen/players.ts               generatePlayer, generateRoster, generateSystem
CREATE  lib/baseball/gen/amateurProfile.ts        the draft class's public record
CREATE  lib/baseball/gen/parks.ts                 park factors + names
CREATE  lib/baseball/schedule.ts                  54-series builder + assertions
CREATE  lib/baseball/gen/league.ts                createBaseballLeague
CREATE  lib/baseball/leagueYear.ts                resolveBbStartYear, budgetForTeam
CREATE  lib/baseball/league-data.ts               getBbLeagueContext
CREATE  app/baseball/new/page.tsx, start/[id]/page.tsx
CREATE  app/baseball/league/[id]/layout.tsx, page.tsx, roster/page.tsx
CREATE  app/actions/bb/league.ts                  create, delete
CREATE  components/ds/baseball/positionColor.ts
```

### Phase 3 — the engine and the season
```
CREATE  lib/baseball/sim/rates.ts                 log5, rate(), the per-player rate derivation
CREATE  lib/baseball/sim/engine.ts                simulateGame — the PA loop
CREATE  lib/baseball/sim/box.ts                   compact encode/decode
CREATE  lib/baseball/sim/recap.ts                 game recap prose
CREATE  lib/baseball/lineup.ts                    lineup card, autoLineup, gaps, effectiveHitter
CREATE  lib/baseball/staff.ts                     rotation, bullpen, availability
CREATE  lib/baseball/season.ts                    advanceSeries — the phase machine
CREATE  lib/baseball/standings.ts                 order, GB, wild card, clinch
CREATE  lib/baseball/stats.ts                     every derived stat (§21)
CREATE  lib/baseball/playerSeasons.ts             BbPlayerSeason sync + pruning
CREATE  lib/baseball/invariants.ts                §29.1
CREATE  scripts/bb/simHealth.ts                   npm run bb:health
CREATE  scripts/bb/checkBoxScore.ts               INV-B33, nine clauses, canary
CREATE  scripts/bb/calibrate.ts                   §28 table
CREATE  BASEBALL_INVARIANTS.md
CREATE  app/baseball/league/[id]/{lineup,staff,standings,schedule,game/[gameId],stats}/page.tsx
CREATE  components/bb/AdvanceSeriesButton.tsx
CREATE  app/actions/bb/season.ts
MODIFY  package.json                              + bb:health script
```

### Phase 4 — roster mechanics
```
CREATE  lib/baseball/roster.ts                    rosterLegality, option/recall/DFA/waivers/IL
CREATE  lib/baseball/farm.ts                      levels, promotion readiness, org rank
CREATE  app/baseball/league/[id]/farm/page.tsx
CREATE  app/actions/bb/roster.ts
CREATE  components/bb/RosterTabs.tsx, OptionButton.tsx, DfaButton.tsx, IlPanel.tsx
CREATE  components/bb/AvailabilityGrid.tsx
```

### Phase 5 — money
```
CREATE  lib/baseball/payroll.ts                   PURE. contract maths, aav, deferrals, release cost
CREATE  lib/baseball/payroll-summary.ts           payrollSummary
CREATE  lib/baseball/payrollEnforcement.ts        assertPayrollRoom, relief options
CREATE  lib/baseball/tax.ts                       thresholds, tiers, the bill
CREATE  app/baseball/league/[id]/payroll/page.tsx
CREATE  components/bb/CommitmentLadder.tsx, PayrollHeader.tsx
CREATE  scripts/bb/checkContractMath.ts           INV-B31, canary
CREATE  scripts/bb/checkPayrollWrite.ts           INV-B32, canary
```

### Phase 6 — service time, arbitration, the offseason
```
CREATE  lib/baseball/service.ts                   accrual, classes, Super Two cutoff, labels
CREATE  lib/baseball/arbitration.ts               projections, filing, comparables, the hearing
CREATE  lib/shared/negotiation/frame.ts           extracted (§8.4)
CREATE  lib/baseball/negotiation.ts               context + decideOffer
CREATE  lib/baseball/freeagency.ts                sign, extend, release, AI wave, fill-to-minimum
CREATE  lib/baseball/qualifyingOffer.ts
CREATE  app/baseball/league/[id]/{arbitration,free-agency}/page.tsx
CREATE  app/actions/bb/{arbitration,freeagency}.ts
CREATE  components/bb/{TenderRow,HearingPanel,NegotiationPanel,OwnerLetter}.tsx
CREATE  scripts/bb/checkNegotiationAgreement.ts   INV-B34, canary
MODIFY  lib/baseball/season.ts                    ROSTER_CRUNCH + FREE_AGENCY steps
```

### Phase 7 — draft, scouting, prospects
```
CREATE  lib/baseball/scouting.ts                  wraps lib/shared/fog.ts + the BIAS term
CREATE  lib/baseball/consensus.ts                 the public board and its named biases
CREATE  lib/baseball/draft.ts                     currentPick, draftPlayer, chunked runner, pool
CREATE  lib/baseball/bonusPool.ts                 slot values, overage, the warning panel's source
CREATE  app/baseball/league/[id]/{draft,scouting}/page.tsx
CREATE  app/actions/bb/draft.ts
CREATE  components/bb/draft/{BoardTable,Room,PoolPanel,LiveTicker,ViewToggle,ProspectSearch}.tsx
MODIFY  lib/baseball/season.ts                    DRAFT phase interrupt
```

### Phase 8 — trades
```
CREATE  lib/baseball/ai/gm.ts                     GmProfile, clubValue, needs, scarcity, controlMultiplier
CREATE  lib/baseball/trade.ts                     evaluateTrade, executeTrade, deadline, AI offers
CREATE  lib/baseball/tradeRetro.ts                snapshots and verdicts
CREATE  app/baseball/league/[id]/trade/page.tsx
CREATE  app/actions/bb/trade.ts
CREATE  components/bb/trade/{Builder,AssetColumn,Meter,Verdict}.tsx
CREATE  scripts/bb/benchmarkClubValue.ts          canary
CREATE  scripts/bb/checkPositionValue.ts          INV-B35, canary
```

### Phase 9 — the world
```
CREATE  lib/baseball/awardTypes.ts                LEAF — imports nothing
CREATE  lib/baseball/awards.ts                    who wins them
CREATE  lib/baseball/records.ts                   the book, incl. no-hitters and milestones
CREATE  lib/baseball/gen/history.ts               16-24 seeded seasons
CREATE  lib/baseball/news.ts, newsCategory.ts, wireRank.ts
CREATE  lib/baseball/{powerRankings,teamRating,storyline,seriesReport,frontOffice}.ts
CREATE  lib/baseball/{gmCareer,dynasty,dynastyScore,glossary,analytics}.ts
CREATE  app/baseball/league/[id]/{news,transactions,history,records,gm,dynasty,power-rankings,analytics,team/[teamId],settings,player/[playerId]}/page.tsx
MODIFY  lib/leaderboard.ts                        refreshBaseballRanks, real
```

### Phase 10 — polish
```
MODIFY  every page                                the declutter pass, measured
CREATE  docs/baseball/screenshots/*
MODIFY  BASEBALL.md                               the full document
MODIFY  docs/baseball/BUILD_LOG.md                final calibration table
```

**Leave alone, entirely:** `lib/season.ts`, `lib/cap*.ts`, `lib/sim/*`,
`lib/freeagency.ts`, `lib/negotiation.ts`, `lib/trade.ts`, `lib/draft.ts`,
`lib/ai/*`, `lib/tuning.ts`, `lib/gen/league.ts`, `lib/gen/leagueHistory.ts`,
`lib/invariants.ts`, every `app/league/**` route, every `app/actions/*.ts` that
is not under `bb/`, `GAME_INVARIANTS.md`, and every football migration.

---
---

# PART V — EXECUTION

## 33. The phases

**Every phase ends at a clean stop.** At each boundary the repository builds,
football is unharmed, the baseball game is coherent at whatever depth it has
reached, and the next run can pick up from this document plus the repo.

**At the end of every phase, before you stop:**

1. Run the full verification recipe (§3). Types clean, build green, football's
   `sim:health` and `checkBoxScore` unchanged from the Phase 0 baseline.
2. Run every baseball harness that exists yet.
3. Append to `docs/baseball/BUILD_LOG.md`: the phase, what landed, every number
   you measured, every thing you found and deliberately did not fix (named, so
   nobody mistakes it for fixed), and any decision you made that this document
   did not make for you.
4. **Do not commit or push unless the owner asks.** If he does, one commit per
   phase, subject and body in the voice of §4.6.

---

### Phase 0 — Baseline and guard rails

**Do:** Get the app running (§1). Record the baseline: `npm run sim:health`
output, `npx tsx scripts/checkBoxScore.ts` output, `npx tsc --noEmit` clean,
`npm run build` green, and a screenshot of `/` and of one league dashboard.
Create `docs/baseball/BUILD_LOG.md` with all of it.

**Verify:** every command above exits 0. The two football harness outputs are
saved verbatim — they are what Phase 1 diffs against.

**Done when:** the build log exists and holds the baseline. **No product change.**

---

### Phase 1 — Schema and merge *(the only irreversible phase)*

**Do:** §26's schema block. The `User` back-relation. One migration,
`baseball_core`. The five module moves in §32 with football's imports updated
and no permanent shims. `ownsBbLeague` / `canViewBbLeague`. The leaderboard's
`BASEBALL` label and a stub `refreshBaseballRanks` that returns zero rows. The
sport segment on `/`. A stub `/baseball` route that says the game is being
built. `BASEBALL.md` skeleton. One line in `README.md` under "Where things
live" pointing at it.

**Verify:**
- `npx prisma migrate status` clean; the migration SQL contains **no `ALTER
  TABLE` on any football table** except `User` (which gets none — a
  back-relation is Prisma-side only). Read the generated SQL and confirm this
  by eye.
- Football's `sim:health` and `checkBoxScore` outputs are **identical to the
  Phase 0 baseline**.
- `/` screenshots before and after: football's save list renders the same.
- Types clean, build green.

**Done when:** a shipped no-op. Football is untouched, baseball has a home, and
the database can hold it.

---

### Phase 2 — Generation

**Do:** §27's tuning file whole. Ratings, positions, settings, types. Player
and roster generation (§14) including the fixed 26-man shape, handedness
constraints and the star tier. The four-affiliate system. Parks. The 54-series
schedule with its assertions. `createBaseballLeague`. `/baseball/new`,
`/baseball/start/[id]`, a league layout, a dashboard stub and a **read-only
roster page**.

**Verify:**
- Create ten leagues. For each, assert: 30 clubs, 4,080+ players, every active
  roster exactly 26 with ≤13 pitchers, every 40-man exactly 40, every defensive
  position covered on every club, every club 54 series and 27 home, handedness
  distribution within tolerance of §27's table, and the OVR distribution
  matching `BB_GENERATION`.
- Write these as `scripts/bb/checkGeneration.ts` with a canary. They are
  permanent, not a one-off.
- Open the roster page for six clubs and **look at it**.

**Done when:** you can create a baseball league, open it, and read a roster that
looks like a baseball roster. No time moves yet.

---

### Phase 3 — The engine and the season *(the heaviest phase)*

**Do:** The PA engine (§20). The compact box score. The lineup card, rotation
and bullpen with availability (§19). `advanceSeries` — the whole phase machine
(§12.4) with the lease, the per-transition claims, the delete-is-the-claim
idiom and the throw-leaves-the-step rule. Standings, GB, wild card, clinch.
Every derived stat (§21). `BbPlayerSeason` and the pruning policy. The
invariants module. `bb:health`, `checkBoxScore`, `calibrate`. The lineup, staff,
standings, schedule, game and stats pages. The Advance control.

**Verify:**
- `npx tsx scripts/bb/checkBoxScore.ts` — **nine clauses, zero tolerance, exit
  0**, and the canary fires.
- `npm run bb:health -- 5 5` — 0 errors.
- `npx tsx scripts/bb/calibrate.ts 100` — print §28.1, §28.2, §28.3, §28.4 with
  the measured column filled in. **Every row must be inside its accept band.**
  If a row is out, fix the *centre* of the distribution, never clamp the tail.
- Time a series press against a database with realistic latency and count the
  round trips. **≤ 60 per press.** If you cannot get there, batch harder before
  moving on — this is the one performance decision that gets exponentially more
  expensive to fix later.
- Play one league through a full season and a postseason by hand and read the
  screens.

**Done when:** a baseball league plays 162 games and a World Series, the box
scores balance, and the calibration table is green. **This is the largest single
stop point in the build and it is worth ending a run on.**

---

### Phase 4 — Roster mechanics

**Do:** `rosterLegality` and everything that reads it. Options with the 15-day
rule and the fourth option. IL10/IL15/IL60 with the 40-man consequence. DFA,
waivers, outright, elect-free-agency. Call-ups and send-downs. September
expansion. The farm page and organisational ranking. The Opening Day gate.

**Verify:** INV-B03 through INV-B10 pass across a 5-league 5-season
`bb:health` run. Drive every roster move through the real server action and read
the ledger back. Confirm a 60-day IL placement frees a 40-man spot and that
recalling that man requires a spot. Confirm a man out of options who is sent
down goes to waivers and can be claimed.

**Done when:** a GM can run his roster through a whole season, and the game
refuses illegal states with a sentence that names the fix.

---

### Phase 5 — Money

**Do:** The pure payroll maths. `payrollSummary` with cash and tax as two
distinct numbers. `assertPayrollRoom` as the one gate on every acquisition path.
The tax with tiers, consecutive-year rates and the pick penalty. Deferrals.
Release cost. `BbPayrollCharge`. The payroll page with the six-year commitment
ladder.

**Verify:** `checkContractMath` (INV-B31, four clauses) and `checkPayrollWrite`
(INV-B32, field for field) both exit 0 with their canaries firing. **Prove each
is a real gate** by reverting the code it protects and counting the failures;
put both numbers in the harness headers, as football's do. INV-B15 (aav agrees)
holds across a 5×5 health run.

**Done when:** money is real, the two payroll numbers never wear each other's
label, and no acquisition path bypasses the gate.

---

### Phase 6 — Service time, arbitration, the offseason

**Do:** Service accrual and the derived classes. The Super Two cutoff, computed
from the live population. Tender / non-tender. Filing, settling and the hearing
minigame with its comparables and its stored `caseStrength`. The qualifying
offer. Extensions. The negotiation frame extraction and baseball's context and
`decideOffer`. The AI free-agency wave. `ROSTER_CRUNCH` and `FREE_AGENCY` in the
phase machine. The owner's letter. Rule 5.

**Verify:** `checkNegotiationAgreement` (INV-B34) — report the comparison count,
**0 disagreements**. INV-B26 through INV-B28 across a 5×5 run. Drive ten
offseasons headless and report: non-tenders, hearings, settlements, Rule 5
picks, free agents signed as a share of the top 40, and the free-agent pool size
at seasons 1, 5, 10 and 15. All against §28.5.

**Done when:** the offseason cycle closes, year two opens, and a player who
debuted in year one is arbitration-eligible in year four and free in year seven —
checked, not assumed.

---

### Phase 7 — Draft, scouting, prospects

**Do:** The fog wrapper **with the bias term**. The consensus board and its
named biases. The draft class, the amateur profile, the class-strength
personality. `currentPick` resolved from live ownership. The chunked runner with
its two buttons. The bonus pool, slot values, overage and the pre-Start warning
panel. Auto-pick from round 11. Minor-league development and the promotion
pipeline. Confidence from games observed. The draft and scouting pages.

**Verify:** Run 20 drafts. Assert: 600 picks, every one consumed, no duplicate
`(year, round, slot)`, every club's `poolSpent` reconciling (INV-B21), and the
warning's quoted pool equalling the gate's enforced pool **to the dollar** on a
league engineered to be short. Then run 15 seasons and measure §28's pipeline
targets: share of draftees reaching MLB, share of first-rounders, median years
to debut. **And measure the bias term does what it is for**: redraw the same
prospect 240 times for one club and confirm the per-player mean error is
materially above pure noise — football's was 0.39 against a predicted 0.23,
i.e. nothing, and that is the number you must beat.

**Done when:** the farm system is real, a draft can be run in production without
timing out, and a club can be genuinely and lastingly wrong about a prospect.

---

### Phase 8 — Trades

**Do:** The AI GM, `clubValue` with its control-years term, needs, scarcity,
prospect risk. `evaluateTrade` with a bargain as a multiplier and an overpay as
a bill. Cash. Competitive-balance picks as the only tradeable pick. The
deadline and its build-up. No-trade clauses. Retrospectives. The trade centre.

**Verify:** `benchmarkClubValue` — 20+ named scenarios, report the pass count
the way football's reports 18/20. `checkPositionValue` (INV-B35) runs at import
and throws on a profitable conversion. Then measure acceptance rates across 11
runs of each: a good player for a fair package, a comparable man for a
comparable man, and prospect-for-prospect as the control (which must be
symmetric and stable). Confirm an albatross contract is worth less than nothing
and that thirty clubs refuse it **on value**, naming the contract and the
dollars — not "we're about 12% short", which sends a GM off to add another
prospect.

**Done when:** the trade market is trustworthy and the deadline is an event.

---

### Phase 9 — The world

**Do:** Awards (the leaf types module first). Records, milestones, no-hitters.
16-24 seeded seasons of history with season-by-season lines for every veteran.
News, the wire and its ranking. Power rankings. Storylines. The series report.
The front-office brief, ordered by urgency. GM career across three tabs.
Dynasty XP, level and the skill tree. The dynasty score. The glossary. Analytics.
The remaining pages. `refreshBaseballRanks` for real.

**Verify:** Award distribution across 100 league-seasons against §28.6 — and if
any award is confined, **name it in the build log and in `BASEBALL.md`'s known
simplifications rather than papering over it.** Confirm every seeded veteran has
per-season rows and that no player card anywhere shows a "Before YYYY" residual
row. Confirm the leaderboard shows both sports and that football's rows are
unchanged.

**Done when:** a new league has a past, a season leaves stories behind it, and
the GM's own record is on a page worth screenshotting.

---

### Phase 10 — The declutter pass and the documents

**Do:** Screenshot every route at 1440×1100 and 768×1100 and **read the images
back**. Apply principle 7: cut a second reading of a fact already on the screen,
a panel that reports nothing, and anything with no job on the page it is on.
**Measure page heights before and after** and put both in the build log —
football's draft-complete pass went 4,971px to 2,771px and the measurement is
what made the argument. Cut nothing for depth. Run the colourblind separation
check on the rating ramp. Write `BASEBALL.md` in full: what it is, how to run
it, where things live, the design principles (quoted from football's — they are
the same principles), known simplifications (the box-score pruning policy, the
unsimulated minor-league games, no international free agency, whatever the award
distribution measurement found), and a changelog.

**Verify:** every route 200s with no console error at both viewports. Types
clean, build green, both health harnesses clean, calibration table green.

**Done when:** it is a game you would show somebody.

---

### Phase 11 — Optional depth, only if there is budget left

In priority order, each independently shippable:

1. **International free agency** — a January signing period with its own bonus
   pool, 16-year-olds, and a five-year wait. It is where a third of the sport's
   stars come from and its absence is the biggest honest gap.
2. **A manager and a coaching staff** — hitting coach, pitching coach, and a
   manager whose bullpen tendencies actually shift the engine's reliever choices.
3. **Two-way players.** Rare, expensive to model (a man needs both attribute
   sets and both roster treatments) and enormously memorable.
4. **Contract opt-outs surfaced as an event** — a star opting out in November is
   a story; make it one rather than a field on a contract.
5. **A fantasy-draft start mode.** Deliberately last: football's has a known
   suspect completion condition and is documented as an open defect.

---
---

# PART VI — FOR THE APP OWNER

## 34. Open questions

These are the decisions this document could not make on his behalf. Everything
else is decided.

1. **Sixty-five presses a year.** A 3-game series gives 54 regular-season
   presses; with the postseason, the offseason and free agency it is ~65
   against football's ~28. The recommendation is to ship at 3 because the grind
   *is* baseball, and the multi-advance dropdown carries anyone who disagrees.
   `BB_LEAGUE.SERIES_LENGTH = 6` gives 27 presses and exactly football's
   cadence, and it is a one-line change with no other consequence. **Worth
   playing both before launch.**

2. **The 20-80 scale.** The specification ships 0-99 as the stored and displayed
   overall (so the design system, the rating ramp and the Madden-facing instinct
   all transfer) with 20-80 as a display spelling on **attribute rows only**. A
   purist would want 20-80 everywhere, including the overall. That is a
   defensible different game and it is his call, not this document's.

3. **Does the GM get fired?** Baseball has no cap gate, so the owner's budget
   and his patience are the only pressure on a bad GM. There is currently no
   failure state in either game. A "you have been let go" ending is a real
   design decision with consequences for the leaderboard, the dynasty score and
   the save's whole shape, and it should be his.

4. **City reuse across the two sports.** Baseball needs 30 fictional clubs.
   Should they share cities with the football league (one fictional world with
   two sports in it, which is a genuinely lovely idea and costs nothing) or have
   their own? The specification assumes its own pool; sharing is a better story
   and a half-hour of work.

5. **Box-score pruning.** §20.7 compacts box scores older than three seasons to
   a line score, totals and scoring plays, because 2,430 games a year at full
   fidelity puts three long dynasties over Neon's free tier. That is a real
   departure from football's standing rule that box scores are never deleted.
   The alternative is a paid database tier. He should know the trade exists.

6. **How much rules depth.** The specification ships service time, arbitration,
   options, waivers, Rule 5, the qualifying offer, the luxury tax and the draft
   bonus pool. It does **not** ship international free agency, the pre-arbitration
   bonus pool, revenue sharing, or the competitive-balance lottery. Each is a
   real thing a real GM deals with and each is a day of work. Phase 11 lists
   them in priority order.

7. **Where the game lives.** The recommendation is `dynastygm.gg/baseball`, one
   domain, one account, one leaderboard. If he would rather baseball had its own
   front door for marketing reasons, that is a routing and DNS decision to make
   **before Phase 1**, not after.

---
---

# APPENDIX

## 35. The two core type files, written out

These are small, they are imported by nearly everything, and getting them wrong
costs a refactor in every phase. Write them in Phase 2 before anything else.

### `lib/baseball/types.ts`

```ts
/**
 * ===========================================================================
 * BASEBALL — the shapes that cross module boundaries
 * ===========================================================================
 * Everything here is what the box score writes and what every reader reads.
 * REGULAR SEASON AND POSTSEASON ARE SEPARATE BUCKETS, deliberately: football
 * shared one for a while, and a title run silently added four games of
 * production to the season totals of the twelve clubs that got there and none
 * of the twenty that did not, so league leaders ranked a 21-game season
 * against a 17-game one.
 * ===========================================================================
 */

/** Every counting stat the engine records. Nothing derived is ever stored. */
export interface BbSeasonStats {
  // Batting
  g?: number; pa?: number; ab?: number; r?: number; h?: number;
  d2?: number; d3?: number; hr?: number; rbi?: number;
  bb?: number; ibb?: number; hbp?: number; so?: number;
  sb?: number; cs?: number; sf?: number; sh?: number; gidp?: number;
  // Pitching
  gp?: number; gs?: number; outs?: number;
  w?: number; l?: number; sv?: number; hld?: number; bs?: number;
  pH?: number; pR?: number; pER?: number; pBB?: number; pHBP?: number;
  pSO?: number; pHR?: number; bf?: number; pitches?: number;
  cg?: number; sho?: number; qs?: number;
  // Fielding, summed across positions
  po?: number; a?: number; e?: number; dp?: number;
  /** JSON-ish per-position games, e.g. { SS: 118, '2B': 14 }. Drives Gold Glove
   *  eligibility, which needs games AT a position, not games. */
  gPos?: Record<string, number>;
}

/** Innings pitched, spelled the way the sport spells it: 184.2 is 184 2/3. */
export function ipFromOuts(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

/**
 * The COMPACT box score. Arrays of numbers with one interned id table per game
 * — see §20.7 for why. Field order is documented here and nowhere else, so a
 * reader that gets an index wrong is a reader that did not read this comment.
 */
export interface BbBoxScore {
  h: { id: string; abbr: string; name: string };
  a: { id: string; abbr: string; name: string };
  /** Runs by inning. Length is the innings played; the home half may be short. */
  line: { h: number[]; a: number[] };
  /** [homeR, homeH, homeE, awayR, awayH, awayE] */
  rhe: [number, number, number, number, number, number];
  /** Per-game roster index -> playerId. Every line below indexes into this. */
  ids: string[];
  /** [idx, ab, r, h, 2b, 3b, hr, rbi, bb, so, sb, cs, po, a, e, order, posCode] */
  bat: number[][];
  /** [idx, outs, h, r, er, bb, so, hr, pitches, dec]  dec: 0 none 1 W 2 L 3 S 4 H */
  pit: number[][];
  /** [inning, half (0 top 1 bottom), idx, outcomeCode, rbi] */
  sco: number[][];
  /** The starters' ids, for the schedule page's probable-pitchers line. */
  starters: { h: string; a: string };
  /** null | 'NO_HITTER' | 'PERFECT_GAME' | 'SHUTOUT' */
  feat: string | null;
  injuries: { playerId: string; name: string; teamId: string; days: number; type: string }[];
}

export const OUTCOME_CODES = [
  'K','BB','HBP','HR','3B','2B','1B','ROE','GB','FB','LD','SF','GIDP',
] as const;
export type BbOutcome = (typeof OUTCOME_CODES)[number];

export interface BbTradeAsset {
  type: 'PLAYER' | 'PICK' | 'CASH';
  /** playerId or draftPickId. Absent for CASH. */
  id?: string;
  /** Dollars. CASH only. */
  amount?: number;
}

/** Four 0..1 knobs, stored as JSON on BbTeam. Same names as football's, on
 *  purpose: the philosophy summary and the difficulty plumbing transfer. */
export interface GmProfile {
  aggression: number;
  winNow: number;
  /** Here this is how much extra a club charges for PROSPECTS, not picks. */
  valuePicks: number;
  bpaBias: number;
}

export type ServiceClass = 'PRE_ARB' | 'ARB' | 'FREE';
export type RosterLevel =
  'ACTIVE' | 'IL' | 'IL60' | 'OPTIONED' | 'MINORS' | 'FA' | 'RETIRED' | 'DRAFTEE';
export type FarmLevel = 'MLB' | 'AAA' | 'AA' | 'A+' | 'A';
export type Hand = 'L' | 'R';
export type Bats = 'L' | 'R' | 'S';
export type Difficulty = 'EASY' | 'NORMAL' | 'HARD';
```

### `lib/baseball/settings.ts`

```ts
import { BB_LEAGUE, BB_MONEY } from './tuning';
import type { Difficulty } from './types';

/**
 * The settings blob, stored as JSON on BbLeague.settings.
 *
 * EVERY OPTION HERE GATES SOMETHING. Football stored three that gated nothing
 * and eventually had to name them under Known simplifications, because a
 * control that does nothing is worse than an absent one, and a described
 * feature that does not exist is a lying metric wearing a sentence. If you add
 * a knob, wire it in the same commit or do not add it.
 */
export interface BbLeagueSettings {
  // Structure
  difficulty: Difficulty;
  seriesLength: number;          // 3 -> 54 presses; 6 -> 27
  totalSeries: number;
  playoffTeamsPerLeague: number;
  activeRoster: number;
  fortyMan: number;
  draftRounds: number;

  // Money
  /** REALISTIC = budget gate + luxury tax. SOFT = budget advisory only, tax
   *  still charged. OFF = no budget, no tax, and every money screen says so. */
  moneyMode: 'REALISTIC' | 'SOFT' | 'OFF';
  taxEnabled: boolean;
  /** How fast the payroll budget and the tax line climb. */
  revenueGrowth: 'FLAT' | 'SLOW' | 'FAST';

  // Control
  serviceTimeEnabled: boolean;   // off => everyone is a free agent at contract end
  arbitrationEnabled: boolean;
  optionsEnabled: boolean;
  rule5Enabled: boolean;
  qualifyingOfferEnabled: boolean;

  // Scouting
  scoutingEnabled: boolean;      // false => true ratings everywhere
  revealTrueRatings: boolean;
  scoutingBiasEnabled: boolean;  // the term that makes a bust possible

  // Simulation
  simVariance: number;
  homeFieldAdvantage: boolean;
  parkFactorsEnabled: boolean;
  platoonSplitsEnabled: boolean;
  injuriesEnabled: boolean;
  injurySeverity: number;
  progressionSpeed: number;
  retirementEnabled: boolean;
  simSeed: string;

  // Trades
  tradesEnabled: boolean;
  aiTradeFrequency: number;
  tradeDeadlineEnabled: boolean;
  tradeDeadlineSeries: number;

  // Presentation
  recapVerbosity: 'SHORT' | 'NORMAL' | 'DETAILED';
}

export const BB_DEFAULT_SETTINGS: BbLeagueSettings = {
  difficulty: 'NORMAL',
  seriesLength: BB_LEAGUE.SERIES_LENGTH,
  totalSeries: BB_LEAGUE.TOTAL_SERIES,
  playoffTeamsPerLeague: BB_LEAGUE.PLAYOFF_TEAMS_PER_LEAGUE,
  activeRoster: BB_LEAGUE.ACTIVE_ROSTER,
  fortyMan: BB_LEAGUE.FORTY_MAN,
  draftRounds: BB_LEAGUE.DRAFT_ROUNDS,

  moneyMode: 'REALISTIC',
  taxEnabled: true,
  revenueGrowth: 'SLOW',

  serviceTimeEnabled: true,
  arbitrationEnabled: true,
  optionsEnabled: true,
  rule5Enabled: true,
  qualifyingOfferEnabled: true,

  scoutingEnabled: true,
  revealTrueRatings: false,
  scoutingBiasEnabled: true,

  simVariance: 1.0,
  homeFieldAdvantage: true,
  parkFactorsEnabled: true,
  platoonSplitsEnabled: true,
  injuriesEnabled: true,
  injurySeverity: 1.0,
  progressionSpeed: 1.0,
  retirementEnabled: true,
  simSeed: '',

  tradesEnabled: true,
  aiTradeFrequency: 0.35,
  tradeDeadlineEnabled: true,
  tradeDeadlineSeries: BB_LEAGUE.DEADLINE_SERIES,

  recapVerbosity: 'NORMAL',
};

/** Difficulty moves TWO knobs and declares two. Football declared three and
 *  moved two, and the third had no consumer anywhere in the codebase — which
 *  it then had to write down under Known simplifications rather than quietly
 *  delete. Declare what you move. */
export const BB_DIFFICULTY_MODS: Record<Difficulty, { aiRatingBonus: number; userScoutPenalty: number }> = {
  EASY:   { aiRatingBonus: -1.5,  userScoutPenalty: 0.85 },
  NORMAL: { aiRatingBonus:  0,    userScoutPenalty: 1.00 },
  HARD:   { aiRatingBonus:  2.25, userScoutPenalty: 1.20 },
};
```

**Two notes on the settings above that are decisions, not defaults.**

`moneyMode: 'SOFT'` exists because football learned that a hard gate the player
did not ask for is the fastest way to make somebody put a game down, and `OFF`
exists because *nothing may enforce past the user's own setting*. In `OFF`
mode, every money figure is **not rendered at all** rather than rendered as
`$0.0M` — football's `capSpace` returns `+Infinity` in that mode precisely so
the AI's offer sizing still works, and any screen that printed it directly said
`$InfinityM`. Branch on the mode, never on the number.

`serviceTimeEnabled: false` is a real mode and it is the one that makes this
game legible to somebody arriving from the football game: contracts expire, men
become free agents, and the whole control apparatus is off. It costs one branch
in `service.ts` and it is worth having.
