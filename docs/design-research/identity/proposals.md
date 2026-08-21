# Identity & World — proposals

Ten proposals, ranked. All additive. None removes an avatar, a crest, a colour
step, a badge, or a row of height — see `README.md` §"Design principles".

**How to read the ranking.** #1-#4 are the ones I would actually ship, in that
order. #5-#7 are good but each has a real caveat. #8-#10 are honest about
being expensive or speculative and I say so. Ranking is by
(attachment gained) / (work + risk), not by how much I like them.

**Cost key.** S = under a day. M = 1-3 days. L = 3+ days or new schema.
"Schema" means a `prisma db push` migration — note that this codebase's own
schema comments record that `db push` **cannot add a required column to a
table that already has rows**, so every new column must be nullable or
defaulted, and existing saves must degrade gracefully. Every proposal below
respects that.

---

## 1. Portraits that carry a body and an age  ·  **S-M, no schema**  ·  SHIP FIRST

**What it is.** `lib/gen/avatar.ts` currently takes `(seed, age)` and uses
`age` only to grey the hair and raise facial-hair odds. It ignores
`heightIn`, `weightLb` and `position` entirely — so a 330 lb nose tackle and
a 178 lb kicker get the same neck, the same shoulder span and the same jaw,
standing next to a line of text that says "6'6" · 330 lb". CK3's lesson is
that a portrait becomes a *person* the moment it agrees with the data
(findings §4).

Add three derived, silhouette-level parameters to `generateAvatarParams`:

- **`mass`** (0-1), from `weightLb` normalised against the position's own
  `BODY[position]` band, blended with an absolute weight term. Drives:
  shoulder-pad span, neck width, jaw width, cheek fullness, a second chin
  ridge at the top of the range. A 330 lb interior lineman should be *wide
  in the silhouette at 20px*, before a single facial feature resolves.
- **`age`** (already passed, currently barely used). Adds: hairline
  recession probability rising from 30 (independent of the existing `bald`
  style, so a 34-year-old with `short` hair gets a receded `short`),
  nasolabial and forehead lines above ~31, slightly heavier lower eyelid,
  and the existing greying kept exactly as-is.
- **`frame`** from `heightIn` — a small vertical stretch of the neck and a
  slightly narrower head relative to shoulders for tall players. Subtle;
  mass does most of the work.

Keep every existing feature. This is strictly more parameters, never fewer.

**Where it lives.** Everywhere `PlayerAvatar` already renders: roster rows,
player card, depth chart, draft board, free agency, trade builder, box
scores. No layout changes at all — the component signature gains two optional
props (`weightLb`, `heightIn`) and falls back to today's behaviour when they
are absent, so nothing breaks.

**Data.** `Player.heightIn`, `Player.weightLb`, `Player.age`,
`Player.position` — **all four already exist and are already fetched on every
screen that renders an avatar.** Zero schema. Zero migration. Works
retroactively on every existing save, exactly like the current avatar.

**Work.** S-M. One file of geometry (`avatar.ts` params + `PlayerAvatar.tsx`
paths), plus a pass over ~8 call sites to forward two props. The hard part is
art direction, not engineering: the mass parameter has to read at 20px
without making the 128px version cartoonish.

**Cost / risk.** The real risk is silhouette regression at small sizes — a
wider bust could smear into the row above. Mitigation: the frame is clipped
to a fixed 120x120 viewBox already, so mass scales *within* the frame; and
the existing `/design-system` route is the right place to eyeball the full
range before it ships. Second risk: over-tuning mass makes every lineman look
identical to every other lineman, trading one kind of sameness for another —
keep the mass term's effect smaller than the face-feature variance.

**Why it's #1.** It is the highest-payoff item in this document per hour
spent, it is exactly the thing the owner named as what makes this feel like a
game, it needs no database change, and it cannot break any game logic because
avatars are a pure render-time function of data that is already on screen.

---

## 2. Jersey numbers  ·  **S-M, one nullable column**  ·  SHIP SECOND

**What it is.** Every player gets a number, assigned by position convention
(QB 1-19; RB/FB 20-49; WR 1-19 & 80-89; TE 40-49 & 80-89; OL 50-79;
EDGE/DT 50-79 & 90-99; LB 40-59 & 90-99; CB/S 1-19 & 20-49; K/P 1-19),
unique within a roster, seeded from the player id.

A number is the cheapest identity primitive in all of sport. It is how fans
actually refer to players ("the 6", "he wears 88"), it is the second thing a
broadcast tells you after a name, and — the strategic reason to do it — **it
is the prerequisite for retired numbers**, which is the prerequisite for a
franchise museum that means anything (proposal #4).

**Where it lives.**
- On the portrait's chest at size >= 72 (player card, draft board hero) —
  this is the moment the avatar stops being a face and becomes a *player in a
  uniform*.
- In front of the name on roster, depth chart and box score rows: `#54  Soren
  Dalrymple`. Small, muted, tabular figures.
- On the player hero next to position/age.
- `components/ds/PlayerHero.tsx` **already accepts a `jersey?: number` prop
  and renders `#{jersey}`** — it is wired up in `/design-system` with a
  hardcoded 11 and passed nothing in production. Half of this is built.

**Data.** Needs `Player.jerseyNumber Int?` (nullable, per the `db push`
constraint above). Assignment logic runs at four points: league generation,
draft pick, free-agent signing, and trade — plus a lazy backfill for existing
saves (any player with a null number gets one assigned the first time his
team's roster is read). Free agents and undrafted prospects show no number,
which is correct — you get a number when you get a locker.

*Alternative with no schema at all:* derive the number as a pure function of
(player id, position, sorted team roster) with linear probing for collisions.
This works and is retroactive, but a number would silently change when a
teammate is added or cut, which defeats the whole point of a number being a
stable handle. **Recommend the column.** It is one nullable integer.

**Work.** M. Column + assignment helper + backfill + ~6 display sites.

**Cost / risk.** Low. Worst case a save has some nulls until backfill runs,
and the UI just shows no number — degrades to today's behaviour.

---

## 3. "Your guy" — draft lineage and tenure, on the player's own page  ·  **S, no schema**  ·  SHIP THIRD

**What it is.** The endowment/IKEA finding (findings §7) says attachment is
manufactured by *visible, persistent evidence of your own investment,
attached to the individual*. Today the GM Career page has a flat list
("DRAFT Round 7, Pick 11: Ibrahim Tillman (QB)") and Tillman's own page says
nothing about where he came from. The evidence exists and is in the wrong
place.

Add a **provenance line** to the player hero, one of:

- `YOUR PICK · Round 6, #188 overall, 2027` — gold-toned, and **the later
  the round the louder it reads**, because lateness is the entire story. A
  6th-rounder who became a starter is the trophy; a 1st-rounder who did is
  just Tuesday.
- `DRAFTED BY BUFFALO · Round 1, #4 overall, 2024` — for a player you
  acquired, with the other club's crest inline. This is what makes a trade
  target feel like he had a life before you.
- `UNDRAFTED, 2026` — its own kind of badge.
- `ACQUIRED BY TRADE · from Chicago, 2028` — from `TradeRecord`.
- `SIGNED AS A FREE AGENT · 2029` — from the `Transaction` feed.

Plus a **tenure counter**: `4th season with Atlanta`, escalating to a quiet
"LIFER" mark at 6+ (FM's Club Legend ladder, findings §1).

**Where it lives.** Player card hero (primary). A small gold dot on roster
rows for players you drafted, so scanning your own roster shows you at a
glance which of these men are yours.

**Data.** `DraftPick` has `playerId @unique`, `round`, `slot`,
`originalTeamId`, `ownerTeamId`, `year` — everything needed, already indexed.
`TradeRecord` and `Transaction` cover the other paths. **Tenure is the one
gap:** nothing stores when a player joined his current club. It is derivable
forward from `Transaction` rows (SIGN/TRADE/DRAFT with his name) for
anything that happened in-app, but is unknowable for the seeded rosters a new
league starts with. Honest options: (a) show tenure only when derivable and
omit it otherwise, or (b) add `Player.joinedTeamYear Int?`. I'd start with
(a) — it is free, and a seeded veteran with no tenure line is not a bug, it
is just a guy who was here when you got the job.

**Work.** S for provenance (one query, one line of JSX). S-M for tenure.

**Cost / risk.** Almost none. The only care needed is that the provenance
line is *quiet* for the common case and *loud* only for the late-round-hit
case, or it becomes wallpaper.

---

## 4. The Franchise Museum  ·  **M, no schema**  ·  SHIP FOURTH

**What it is.** `lib/gen/leagueHistory.ts` synthesises 16-24 years of
internally-consistent past for all 32 clubs — playoff brackets actually
played out, franchises with *eras* rather than fixed personalities, seeded
legends holding calibrated records. The league-level Ring of Honor page shows
some of it. **No individual franchise has a room of its own.**

Give each club a page (or a tab on the existing History page, which already
has a team selector) laid out as a museum rather than a table:

- **Banner wall.** Championship years as pennants in the club's own primary
  and accent, hung in a row with visible empty space to the right. 2K's
  rafters, flattened (findings §3). A club with one banner and a lot of empty
  wall is a *promise*; the same fact as a table row is not.
- **Era timeline.** A horizontal strip, one tick per season, height = wins,
  coloured by playoff result, with the eras the generator actually produced
  labelled ("THE LEAN YEARS · 2011-2016", "THE RUN · 2019-2023"). The
  generator already models era drift explicitly (`ERA_DRIFT_SD`,
  `ERA_DRIFT_PULL`); this makes the thing it modelled visible.
- **Records held by this club's players**, with the holder's portrait —
  `LeagueRecord` denormalises `playerName` and `teamAbbr` for exactly this.
- **The rivalry card.** `lib/rivalry.ts` is built and returns head-to-head,
  streaks and playoff meetings, and is (as far as I can tell) surfaced only
  through storylines. A permanent "your rivals" block — the two clubs you
  have played most and the record against each — is free.

**Where it lives.** `app/league/[id]/history` (team tab) or a new
`/league/[id]/franchise` route.

**Data.** `TeamSeasonRecord` (year, W/L/T, PF/PA, playoffResult) — exists and
is indexed by `[leagueId, year]`. `LeagueRecord` — exists. `Game` rows for
rivalry — exist and are never pruned. Award `Transaction` rows — exist.
**No schema.** What is *not* possible without schema: franchise all-time
statistical leaders (`careerStats` has no team attribution — see #10).

**Work.** M. Mostly a rendering job over queries that already exist elsewhere
in the codebase.

**Cost / risk.** Low mechanical risk. The main risk is building a room and
under-furnishing it — a museum with three facts in it is sadder than no
museum. Do not ship this before there is enough to hang on the wall, which
for a seeded league there is on day one.

---

## 5. Crests that are marks, not monograms  ·  **M, no schema**

**What it is.** Today every one of the 32 crests is the same object: a shape,
a pattern, and **the abbreviation in a black box in the middle**. The abbr is
doing 100% of the differentiating work, which is why the history page's team
list reads as a column of coloured tokens rather than a league of clubs.

Add an **emblem layer**: ~18-24 inline SVG marks (bolt, anchor, star, wing,
horns, pick-and-hammer, arrowhead, flame, gear, wave, spur, keystone, bell,
compass rose, rivet, prow…), picked from the team seed, drawn in the accent
colour over the primary. Then make the crest **size-responsive**:

- **<= 28px** (table rows, tickers): today's behaviour exactly — abbr
  dominant, because at 20px a mark is mud and the letters are the only thing
  that reads. Nothing regresses.
- **>= 40px** (headers, mastheads, museum, matchup cards): emblem dominant,
  abbr demoted to a small banner across the lower third.

**Where it lives.** Team header, dashboard hero, standings, history, matchup
cards — everywhere `TeamLogo` renders at 40px or larger.

**Data.** None. `generateTeamLogoParams(teamId)` gains an `emblem` field, same
derive-never-store pattern as today. Fully retroactive.

**Work.** M — and it is mostly *drawing*, not coding. 20 marks that read at
40px on four different crest shapes is a real illustration task and is the
main reason this is #5 and not #2.

**Cost / risk.** Getting this wrong is worse than not doing it: a bad mark is
more noticeable than no mark, and a mark that collides with the `stripe` /
`chevron` / `ring` pattern overlays looks broken. Needs the emblem drawn
inside a safe area that every pattern respects.

---

## 6. Personality archetypes  ·  **S to derive, M to wire honestly**

**What it is.** FM's lesson (findings §1): one non-numeric word implies a
whole interior life, and later becomes the *explanation* the user writes
themselves for how a career turned out. Derive one archetype per player from
`new Rng('persona-' + playerId)` — same free, retroactive, zero-schema trick
the avatar already uses — from a pool of roughly a dozen: *Gym Rat, Film
Junkie, Quiet Professional, Chip On His Shoulder, Late Bloomer, Locker Room
Lawyer, Coach's Son, Freelancer, Big-Game Guy, Slow Starter, Mercenary,
Homebody.*

**The rule that makes it worth doing, from RimWorld (findings §5): the tag
must be able to contradict the number.** An 88 OVR *Locker Room Lawyer* and a
71 OVR *Gym Rat* are characters. A tag that only ever agrees with the rating
is decoration.

**Where it lives.** Primarily **inside the prose** — `lib/scoutingProse.ts`
already writes the scouting report paragraph, and a personality clause there
("teams that have been in the building say he's the first one in it") reads
as observation, not as a stat. Secondarily as a quiet tag on the player hero.
Also the natural voice for the Re-sign screen ("he wants to be paid like a
starter" vs "he'd take a discount to stay").

**Data.** None to derive. **But** — and this is the whole risk — design
principle 6 says no lying metrics, and a personality label reads as a system.
Shipping it as pure flavour is defensible only if the UI never implies it does
anything. The honest version wires it to **exactly one** real thing:
`Player.morale` drift and/or the re-sign willingness in `lib/negotiation.ts`,
both of which the schema already flags as placeholder-weight. That is a small,
contained change — and once it is wired, the label is true.

**Work.** S for the generator + display. M including the one honest wiring and
the prose integration.

**Cost / risk.** Medium, and it is a *game-design* risk rather than a
rendering one: this is the first proposal here that touches simulation
behaviour. If the owner would rather not touch sim balance at all, ship the
derived tag with the prose integration and no mechanical effect, and label the
section "Character" rather than anything that sounds like a rating.

---

## 7. Hometown, and the homecoming  ·  **S, no schema**

**What it is.** A player currently comes from a college and nowhere else.
Derive a **hometown** (city + state) from the player seed against a new
~150-entry US city pool, weighted toward real football-producing regions.
Show it on the player card next to the college: `Macon, GA · Ozark Central`.

The mechanic that makes it more than a word: flag the cases where geography
means something — a player drafted or signed by the club nearest his hometown
(`HOMETOWN KID`), and a player facing the club nearest his hometown
(a "homecoming" note on the matchup). Broadcast tells you where a man is from
for a reason: it makes him from somewhere.

**Where it lives.** Player card identity line; a small note on the draft
board (a hometown kid in your draft class is a story before he is a player).

**Data.** None — derived from seed, retroactive, same pattern as avatars. Needs
one new const array in `lib/gen/names.ts` (which already holds `COLLEGES` and
`TEAM_SEEDS`, so it is the right home). The 32 `TEAM_SEEDS` cities are real US
cities, so "nearest club" is computable from a small hardcoded lat/long table
or, more cheaply, by tagging each hometown with the abbr of its nearest club
at authoring time.

**Work.** S.

**Cost / risk.** Very low. It is one line of text — its value is entirely in
the homecoming flag, so if that is cut, cut this too.

---

## 8. Earned nicknames  ·  **S-M, no schema (derived) — but conditional**

**What it is.** Blood Bowl players ask for nicknames unprompted (findings §6)
because a handle the game did not hand you is a handle you own. Make them
**earned, not given**: a nickname appears only when a player crosses a
queryable threshold — holds a league record, wins an award, leads the league
in a category, or reaches a career milestone — picked deterministically from a
pool keyed to *what he did* ("The Closer" for a sack leader, "Sundial" for a
long-tenured lineman, "Prime Time" for a championship MVP).

**Where it lives.** Player hero, in quotes between first and last name — the
sports convention. `Paxton "The Gate" Ramsey`. Roster rows keep the plain name.

**Data.** Derivable with no schema: the *condition* is a live query
(`LeagueRecord`, award `Transaction` rows, `careerStats` thresholds) and the
*choice* is seeded from the player id. That means a nickname appears the
moment he earns it and never changes — which is the correct behaviour and
costs nothing.

**Work.** S-M.

**Cost / risk.** Tone. Generated nicknames are the single easiest thing in
this document to make cringeworthy, and a bad one is worse than none. Keep the
pool small, dry, and mostly earned by *longevity or a specific feat* rather
than by being good. **Ranked here rather than higher because it is pure
upside-if-it-lands, zero-if-it-doesn't** — and because it depends on there
being award/record history to trigger on, which a brand-new league has (from
the seeded past) but a user's own tenure will not for several seasons.

---

## 9. Retired numbers and the club's Ring of Honor  ·  **M, depends on #2 and #4**

**What it is.** The payoff for jersey numbers. When a player who won an award,
held a record, or won a title with your club retires, his number goes up on
the franchise's wall and **no one on your roster can wear it again**. 2K's
rafters and OOTP's plaques, in a flat page (findings §2, §3).

Each retired number gets a plaque: portrait (frozen at his last age — the
avatar is a pure function of seed and age, so "him at 37" is free and
permanent), number, years, what he did.

**Where it lives.** The Franchise Museum (#4), plus a blocked-number rule in
the jersey assignment helper (#2).

**Data.** Needs a small persisted table — `RetiredNumber(teamId, number,
playerId, playerName, year, citation)` — because the induction is an *event*
and cannot be recomputed later (the player's team affiliation is gone once he
retires; `Player.teamId` is `SetNull`). Alternatively encode it as a
`Transaction` row with a new type, which needs no new model at all and fits
the existing "the ledger is the history" pattern this codebase already uses
for awards. **Prefer the Transaction row.**

**Work.** M, and it is *sequenced* — it is worth nothing before #2 and #4 exist.

**Cost / risk.** The induction rule needs care: too generous and every club
has 30 retired numbers in a decade; too strict and nobody ever gets one. Real
leagues retire on the order of one number per several years. Tune to roughly
"a title-winning starter, a major award winner, or a record holder, and only
at retirement."

---

## 10. Per-season career history  ·  **L, real schema — the expensive one**

**What it is.** The thing that would let a player page show *a life*: a
year-by-year table (season, team, games, the position-shaped stat line) and a
career-arc sparkline, the way OOTP's player pages do (findings §2). It is also
the unlock for franchise all-time leaders, "he was a Blaze from 2026-2033",
and any honest statement about what a player did *for you* as opposed to in
total.

**Data.** Requires a new model, roughly
`PlayerSeason(playerId, year, teamId, teamAbbr, stats JSON, gamesPlayed)`,
written once per player per season by the existing stats rollover in
`lib/season.ts` (which already loops every player at exactly that moment, so
the hook site is free). ~1,500 rows per season per league — trivial at this
scale.

The awkward part is the **past**: `lib/gen/leagueHistory.ts` already generates
season-by-season lines for its cast and then *merges them into `careerStats`*
before writing (`lib/gen/leagueHistory.ts:1201`). It would need to also emit
`PlayerSeason` rows — which is a small change to a file that is very carefully
consistency-audited, so it is not free but it is not a rewrite either.
Existing saves would simply have no per-season history before the season they
upgraded in, and the UI must show that honestly ("record begins 2031") rather
than implying the player did nothing.

**Work.** L. New model, migration, writer, backfill-from-history, plus the UI.

**Cost / risk.** This is the only proposal here that is a genuine
infrastructure project rather than a design pass. **I rank it last not because
it is the least valuable — it may be the most valuable over a long save — but
because it is the one with real risk and no partial version.** It should be a
decision made on its own, not smuggled in as part of a visual refresh.

---

## What I deliberately did NOT propose

- **Removing anything.** Not one item above takes something off the screen.
- **Relationship webs / locker-room chemistry sim.** New subsystem, 1,500
  players, out of proportion to a design pass (findings §5).
- **Madden-style in-game superstar abilities.** These are sim-balance changes
  wearing an identity costume, and they would invalidate the trade-value
  benchmark suite.
- **AI-team reputation or perception.** README documents that AI teams
  evaluate off true ratings with no fog of war; implying otherwise is a lying
  metric (principle 6).
- **User-typed nicknames / custom logos / uniform editors** (OOTP has these).
  Every other identity in this game is seeded; a text input in the middle of
  that is a different product decision, and it is the owner's to make, not
  mine.

---

## Recommended sequence

| # | Proposal | Cost | Schema | Ship? |
|---|---|---|---|---|
| 1 | Portraits carry body + age | S-M | none | **yes, first** |
| 2 | Jersey numbers | S-M | 1 nullable col | **yes** |
| 3 | "Your guy" provenance + tenure | S | none | **yes** |
| 4 | Franchise Museum | M | none | **yes** |
| 5 | Crest emblem layer | M | none | if there's art time |
| 6 | Personality archetypes | S-M | none | yes, if the one wiring is acceptable |
| 7 | Hometown + homecoming | S | none | cheap, ship with #3 |
| 8 | Earned nicknames | S-M | none | only if the tone lands |
| 9 | Retired numbers | M | Transaction type | after #2 + #4 |
| 10 | Per-season career history | L | new model | its own decision |

#1 through #4 together are, I think, roughly one week of work, need one
nullable database column between them, and change the answer to "who is this
guy" on every screen in the app.
