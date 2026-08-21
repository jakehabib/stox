# Moments and Motion — findings

**Lens:** the season as a sequence of moments. Not identity/world-building, not
micro-interaction feedback.

**Question:** a season here is currently a sequence of state transitions rendered
as updated tables. What would make it feel like a season that is *happening to
you*?

**Method:** read the 20 restored screenshots in `docs/design-directions/before/`,
then read the code paths that produce a week — `lib/season.ts`, `lib/sim/engine.ts`,
`lib/sim/recap.ts`, `lib/storyline.ts`, `lib/records.ts`, `lib/clinchScenario.ts`,
`lib/rivalry.ts`, `lib/wireRank.ts`, `components/AdvanceWeekButton.tsx` — then
research how other games solve the same problem.

Standing principles from `README.md` §"Design principles" are assumed and not
re-argued. Nothing below removes an avatar, a logo, a colour or a row height.
Everything below is additive.

---

## Part 1 — What this app already has that it is throwing away

This is the important half. The owner's note was *"it needs to be and feel
alive."* The striking thing about this codebase is how much life is already
computed and then discarded at the render boundary. Ten specific findings,
each verified against the source.

### 1.1 A week lands as a 7-second toast in the corner

`advanceWeek()` returns `AdvanceResult` (`lib/season.ts:109`), whose entire
narrative payload is one string:

```
return { summary: `Week ${week} complete: ${played} games played.` };   // season.ts:377
```

`AdvanceWeekButton` renders it in a `w-80` card, top-right, `setTimeout(… 7000)`
(`components/AdvanceWeekButton.tsx:186-190`). **Your own team's result is not in
that string.** Nor is the score, the opponent, the standings move, the injury to
your starter, or any of the other fifteen games. The single most repeated
interaction in the game — press Advance, wait, find out what happened — resolves
into "Week 8 complete: 16 games played," and then you go hunting.

This is the central finding. Everything else is a variation on it.

### 1.2 Winning the championship is the same toast

```
return { summary: 'The championship game is complete! Welcome to the offseason.' };
                                                                  // season.ts:659
```

Same `w-80` card, same corner, same seven seconds, same typeface as "Week 3
complete." Being *eliminated* is worse: `simulatePlayoffRound` returns
`'Wild card round complete. Divisional round is set.'` — a sentence that does
not mention your team at all, delivered on the week your season ended.

The whole season converges on one bit of information and the UI spends nothing
on it.

### 1.3 The box score persists the entire shape of every game, and nothing reads it

`BoxScore` (`lib/types.ts:32`) carries, and `simulateAndSaveGame` writes to
`Game.boxScore` (`season.ts:415-430`):

- `quarters: { home: number[]; away: number[] }` — a real four-quarter linescore.
- `drives: DriveResult[]` — **22 drives** (`SIM.DRIVES_PER_TEAM = 11`, plus OT),
  in strict chronological order, each with `{ team, result, points, plays, yards }`.

The drive order is deterministic and reconstructible: `engine.ts:101-106` runs
`away` then `home` for each drive index `d`, so `drives[2d]`/`drives[2d+1]` are
drive `d`, and the quarter is `floor(d / 11 * 4)` — the same expression the
engine itself uses on line 102.

From that array, with **zero new schema and zero new sim logic**, you can derive:
the running score after every possession, every lead change, the largest deficit
either team erased, whether the winner led wire-to-wire, whether the winning
points came in the fourth quarter or overtime, and how many times the game was
within one score after halftime.

`app/league/[id]/game/[gameId]/page.tsx` (103 lines) reads `box.lines` and
`box.teamStats`. It never touches `box.quarters` or `box.drives`. The game page
shows a 31-30 last-possession thriller with exactly the same layout, weight and
colour as a 45-3 walkover. The recap *text* knows the difference — it says "It
came down to the last possession" — and the surrounding design contradicts it.

### 1.4 Margin is invisible everywhere a result is listed

`docs/design-directions/before/schedule.png` is the proof. Reading down one
column:

```
WK 1  vs Charlotte    L   27-55
WK 2  vs New Orleans  W   45-33
WK 4  @  Charlotte    W   39-31
WK 6  @  Tampa        L   14-38
```

A 28-point humiliation and an 8-point road win over the same team render in
identical type, identical size, identical weight. The only differentiator is a
one-character `W`/`L` in a small colour. `Game.homeScore` and `Game.awayScore`
are right there. The season currently reads as a list of binary outcomes when it
is actually a list of *experiences*, and the experience is entirely in the margin.

### 1.5 League records can only break in the offseason

`checkAndUpdateRecords` (`lib/records.ts:35`) is called exactly once per season,
from `rollSeasonStatsIntoCareer` during the offseason rollover — its own header
comment says so. So a single-season passing record actually surpassed in week 14
is not announced in week 14. It is announced months of game-time later, in a
batch, alongside six other records, as `Transaction` rows in a feed.

The most cinematic recurring event in a sports season — a record falling, live,
with the crowd on its feet — is architecturally incapable of happening at the
moment it happens.

### 1.6 The News page is a firehose, and the excellent ranker that fixes it is not applied to it

`docs/design-directions/before/news.png`: **2,815 stories**, 35 in week 8 alone,
and the first six rows on screen are:

```
DEVELOPMENT  Osiris Sheffield is pacing the league in passing yards
             Sustained production like that is starting to show up in his game.
DEVELOPMENT  Paxton Ramsey is pacing the league in tackles
             Sustained production like that is starting to show up in his game.
DEVELOPMENT  Ridge Strasburg is pacing the league in receiving yards
             Sustained production like that is starting to show up in his game.
…
```

Six rows, one byte-identical detail sentence. Meanwhile `lib/wireRank.ts` is a
genuinely good piece of work — type weighting, own-team boost, staleness decay,
a `PER_TYPE_CAP = 2` diversity cap, and injury collapsing — with a header comment
that diagnoses this exact failure ("signal to noise was roughly 1:11, and
inverted"). It is used by the dashboard wire and the ticker. It is **not** used
by `/news`, which is a raw newest-first firehose.

The fix already exists in the repo and has not been pointed at the page that
needs it most.

### 1.7 Clinch and elimination — real math — surface as one small pill

`lib/clinchScenario.ts` runs the actual seeding algorithm against an adversarial
projection of the remaining schedule. That is the real sports definition of
"clinched," not a heuristic, and the README is rightly proud of it. Its entire
UI surface is `clinchScenarioTag()` returning `{ label, tone }` — a coloured tag
in the dashboard hero.

The *transition* is the moment, not the state. The week you go from "in the
hunt" to "eliminated" is the week the season ended, and nothing marks the edge.

### 1.8 The storyline engine is excellent, produces six categories of grounded beats, and appears once

`lib/storyline.ts` (442 lines) generates STAKES, RIVALRY, STREAK, RECORD_CHASE,
MILESTONE and PLAYER_ARC beats, each carrying a `fact: { label, value }` so
nothing is invented. Its own integration comment names two call sites and says
they are not mutually exclusive: a dashboard widget, **and** `advanceWeek`'s
REGULAR/PLAYOFFS branches. Only the first was built (`app/league/[id]/page.tsx:377`,
`limit: 5`).

The second — folding a beat into the moment a week resolves — is the one that
turns state into narrative, and it is unbuilt. The author of that file already
knew.

### 1.9 Rivalry intensity is scored 0-100 and used only to decide whether to print a sentence

`lib/rivalry.ts` computes a transparent intensity score (division baseline,
meetings, playoff meetings, closeness, streak) with a `breakdown[]`. Its only
consumers are `rivalryRecapLine` (one sentence in the recap prose) and the
storyline gate at `intensity >= RIVALRY_NARRATIVE_THRESHOLD`.

On `schedule.png`, week 4 at Charlotte — a division rematch three weeks after
losing to them at home — is visually identical to week 12 at Miami. The game
knows one of those matters more. The schedule does not.

### 1.10 A game result generates no news item about the game

`gameHeadlines()` (`lib/news.ts:52`) emits at most two rows, both of them
*individual stat lines* ("Nash Thornbury (KCR) threw for 316"). There is no
`Transaction` row for a comeback, a shutout, a blowout, an overtime win, or a
divisional upset. The dashboard's wire compensates by merging `Game.recap` in
separately — a workaround that proves the gap.

---

## Part 2 — How other games solve this

Each entry: the mechanic, then what it does *psychologically*, then how it maps
to this codebase.

### 2.1 Football Manager — the inbox as the spine of time

**Mechanic.** FM's Inbox is where every out-of-match event surfaces, and content
is delivered by *named sources* — clubs, competitions, media outlets, individual
journalists, and supporters, with "supporter reactions adding a distinct layer of
colour to the feed to show how fans feel about news." Advancing time produces
mail; you read your way forward.

**Psychology — attribution.** A number you read off a table is data. The same
number told to you by a person is an *event*. Attribution converts information
into social experience, which is the channel humans are actually wired to care
about. It also gives the game a place to put opinion, which a table cannot hold.

**Maps to.** This app already has an editorial `NewsRow` with category kickers,
and `lib/scoutingProse.ts` proves the team is willing to write voiced prose. What
is missing is the *arrival* — mail that shows up because time moved, rather than
a page you visit.

### 2.2 Football Manager — the Dynamic Manager Timeline

**Mechanic.** FM23's season review renders your save as a chronological list of
milestones and achievements. SI describe it as including "subjective elements
that define the story to paint the picture of every save being unique."

**Psychology — retrospective coherence.** Attachment does not come from playing;
it comes from being able to *retell*. A timeline is a retellable object. A
standings table is not — it is a snapshot with no memory. This is why players
post FM timelines and never post FM league tables.

**Maps to.** `TeamSeasonRecord` already stores per-year `{ wins, losses, ties,
pointsFor, pointsAgnst, playoffResult }`, `LeagueRecord` stores holders with the
season they were set, and awards are written as typed `Transaction` rows
(`AWARD_MVP`, `AWARD_SBMVP`, `CHAMPION`). Every ingredient for a franchise
timeline is persisted. `components/ds/Timeline.tsx` even exists — and is used
only in a `/design-system` mockup.

### 2.3 Football Manager — Deadline Day

**Mechanic.** FM22 shipped a dedicated module for the transfer window's final
day: "Modelled on discussions with those involved in all aspects of the real-life
drama, it'll feel like you're watching events unfold on your television whilst
simultaneously positioning you in the middle of the action."

**Psychology — framing beats content.** Nothing about the underlying transfer
logic changed. The same signings, at the same values, on the same date, became an
*event* purely by being time-boxed, presented as live, and given a broadcast
frame. This is the cheapest drama in game design: it costs presentation, not
simulation.

**Maps to.** This app has three natural deadline-day analogues already gated in
`lib/season.ts`: the trade deadline (`isTradeDeadlinePassed`), the four-week free
agency window, and live draft day — which already got a broadcast treatment in
Stage 5 and is the one place the app *already proves* this works.

### 2.4 Football Manager — text commentary over 3D

**Mechanic.** FM ships a 3D match engine and a large contingent of players
deliberately turn it off in favour of text-only commentary, in order to "let the
imagination take hold."

**Psychology — productive under-specification.** A well-chosen sentence recruits
the reader's own imagination, which will always out-render your engine. A *bad*
animation actively destroys the image the player had already built. This is the
strongest argument in this document for the brief's own constraint: do not try to
animate a football game. Give the player a sentence and a shape, and get out of
the way.

**Maps to.** `lib/sim/recap.ts` already picks a FRAME from the margin, a CAUSE
from the stats and a STAR from the box score. The writing is flagged
`[PLACEHOLDER copy]` but the *structure* is correct and it is doing more work than
the layout around it.

### 2.5 Madden — the Scenario Engine and Weekly Recap 2.0

**Mechanic.** Madden 20's Scenario Engine generates week-to-week storylines "based
on how you're playing, who you are, your record, your stats, and the personalities
around you," some one-week and some branching. Madden 26 added a Weekly Recap;
Madden 27's Weekly Recap 2.0 "frames each week's results with more context and
storytelling," bundling **Player of the Week, injury reports, stat leaders, the
MVP race, the playoff hunt, and player transactions** into one post-week screen.

**Psychology — consequence-binding.** A result is not a number, it is a set of
changed relationships. Showing "you won 24-20" and showing "you won 24-20, which
moved you from 7th to 5th in the conference, cost you your left tackle for three
weeks, and put your rookie 84 yards from 1,000" are the same event with wildly
different emotional mass. The second one tells you *what it did to your world*.

**Maps to.** Every one of Weekly Recap 2.0's six sections has a working data
source here: `Game` rows, `Player.injuryWeeks`/`injuryType`, `lib/stats.ts`
leaders, `lib/awards.ts` scoring functions (`offensiveScore`/`defensiveScore` —
an MVP race is just those sorted mid-season), `lib/clinchScenario.ts`, and
`Transaction`. The recap screen is an assembly job, not a simulation job.

### 2.6 NBA 2K — MyNBA's era-shifting news delivery

**Mechanic.** In MyNBA, the *format* of league news changes with the era: it starts
as the "2K Times" newspaper, becomes a web-1.0 page, and ends as a social feed.
MyGM ships 30 team-specific storylines that begin at a fixed point in the calendar.

**Psychology — diegesis.** When the interface is an artifact from inside the
world, reading it is *being* in the world rather than querying it. It also
buys enormous narrative variety for near-zero simulation cost, because the frame
carries meaning the data doesn't have to.

**Maps to.** Less directly applicable — this league has no eras — but the
principle generalises: the app's Stage-8 League Wire ticker and Stage-9 editorial
News rows are already reaching for a diegetic frame. The under-used move is
*phase*-specific framing rather than era-specific: the wire during draft week
should not look like the wire in week 6.

### 2.7 XCOM — the promotion screen

**Mechanic.** XCOM stops the game between missions to promote a soldier: the
soldier is named, ranked up, given a class and a nickname, and you choose their
next ability. The Memorial Wall records the dead permanently.

**Psychology — named individuals, ceremony, and permanence.** Three things make a
unit a character: it has a name you gave it, it changes in ways you chose, and
its state is permanent. The promotion screen is a *ceremony* — a hard stop whose
only job is to say "this specific person is now different." Ceremony is how games
mark that something crossed a threshold.

*(Caveat: the widely-cited Game Developer analysis of XCOM attachment was not
reachable from this environment; the mechanic description above is from the
game's own documented behaviour and community sources, not from that article.)*

**Maps to.** The equivalent thresholds here are already computed and already
silent: a rookie's first start, a first 1,000-yard season, a player crossing into
the ≥80 rating band the owner specifically cares about, `lib/development.ts`
progression jumps, and `DEV_MILESTONE` transaction rows. Right now a rookie
breaking out is a row in a table with an unchanged avatar.

### 2.8 Crusader Kings III — the cautionary tale

**Mechanic.** CK3 pauses the game with full-screen event popups. Community
response is unambiguous: players report "massive pop-ups that pause your game,"
"a barrage of stupid notifications," and specifically "baby name notifications
for any baby born in the dynasty" and "EVERY trivial notification and EVERY baby
born to your 4th cousin" — with some saying it drove them to stop playing. The
most popular fix is a mod literally named **Less Event Spam**, whose pitch is
replacing "certain fullscreen events with less intrusive toast notifications."
Paradox have reportedly made "a pretty firm design choice not to include"
EU4-style per-category notification toggles.

**Psychology — interruption is a currency and it inflates.** The first full-screen
event is an event. The fiftieth is a keystroke. Once players learn that the modal
is usually noise, they dismiss *before reading*, which destroys the channel for
the events that genuinely mattered. CK3 is the exact failure mode available to
this app if "make it feel alive" is read as "celebrate more things."

**Maps to.** Directly constrains every proposal in the companion document. See
Part 3.

### 2.9 Motorsport Manager — tension without rendering

**Mechanic.** The race weekend is where "the pressure hits hardest": strategy
calls under changing conditions, real-time reaction, weather moving across the
circuit. There *is* a 3D race view, and community consensus is that it "feels
like polish but doesn't give gameplay advantage, so many players just fast
forward until key points."

**Psychology — tension is stakes × agency × uncertainty, not fidelity.** The
players who fast-forward the 3D view are not disengaged; they are skipping to the
decisions. Fidelity is not what produced the tension.

**Maps to.** This app's user has *no* in-game agency during a sim — the game is
resolved when you press Advance. So the tension has to live somewhere else:
before (stakes framing on the upcoming game) and after (the shape of what
happened). That is exactly where the two strongest proposals sit.

### 2.10 ESPN / the Game Excitement Index — the single most transferable idea

**Mechanic.** ESPN has shown a win-probability graph on NFL recap pages since
2016. From it comes the **Game Excitement Index**: sum the absolute change in win
probability across every play. As one analysis puts it, "you can think of the
Excitement Index as pulling the win probability graph's jagged path until it's a
tight horizontal line and then measuring its length." And the graph's own value:
"Without knowing anything else about the game, one could follow the twists and
turns on this chart to relive all the exciting moments."

**Psychology — a shape is a story readable in 200 milliseconds.** Humans parse
silhouettes pre-attentively. A flat line, a cliff, a see-saw, and a late spike are
four *different stories*, recognised before any number is read. It is the highest
information-per-pixel device in all of sports presentation, and it requires no
animation, no assets and no motion.

**Maps to.** This is the finding that pairs with §1.3. `box.drives` is a
chronological, deterministic list of scoring possessions. A score-differential
path across 22 drives is a pure function of data already in the database, and its
shape distinguishes wire-to-wire, comeback, see-saw, and collapse — the four
archetypes — without inventing a single number. The app already has a chart kit
at `components/charts/`.

### 2.11 FanGraphs — playoff odds graphs

**Mechanic.** FanGraphs simulates the remaining season 20,000 times and plots each
team's playoff probability *over time*, as a line for the whole season.

**Psychology — the season needs a plot, and a plot needs an axis.** "We are 5-3"
is a fact. "We were 12% three weeks ago and we are 61% now" is a *story with a
turning point*. The graph is the only artefact that shows a season as having
narrative shape rather than being a series of independent weeks.

**Maps to.** Full Monte Carlo is unnecessary and would violate the determinism
constraint's spirit. But a much cheaper version is exactly derivable: every
`Game` row for the season carries `week` and both scores, so week-by-week
standings for all 32 teams can be *replayed* (272 rows for a full season) and
`computeClinchStatus` — which already exists — re-run at each week. That gives a
real, deterministic, seedless season-arc line: division rank and
playoff-seed position over time, with the clinch/elimination boundary marked.

### 2.12 UI doctrine — the toast/modal line

**Mechanic.** The standard notification rule, stated the same way across design
systems: "Use a toast for feedback the user can safely ignore, and a modal for a
decision they cannot"; "A modal stops everything… a toast lets users keep
working"; toasts run 3-5 seconds.

**Psychology — the container is a claim about importance,** and the player learns
the claim faster than they learn the content.

**Maps to.** Right now this app uses a 7-second toast for *winning the
championship*, and a sticky, dismissible, action-bearing panel for a salary-cap
violation. The container hierarchy is exactly inverted at the top end: the
biggest event in the game is in the smallest box.

---

## Part 3 — The interruption budget

The brief asks me to be rigorous about pacing, and CK3 (§2.8) is the reason. An
interruption budget is a hard constraint, not a guideline. Mine:

**Tier 0 — full-screen, blocks until dismissed. Budget: at most once per season,
and in most seasons zero times.**

Only two events qualify:
- Winning the championship.
- Being eliminated from the playoffs *while playing in them* (losing your
  postseason game). Not missing the playoffs — that is Tier 1.

Rationale: an event qualifies for Tier 0 only if it (a) ends the season, (b)
cannot recur this season, and (c) is the outcome the entire season was pointed
at. A player who plays ten seasons sees ten Tier-0 screens. That is a rate at
which the screen keeps its meaning.

**Tier 1 — a real screen you land on, but you were going to land somewhere
anyway. Zero extra clicks. Budget: once per Advance, always.**

The Week Report (Proposal 1). This is not an interruption because pressing
Advance *is* a request to be told what happened. Replacing a toast you can't read
in time with a panel you can read at your own pace is a reduction in friction,
not an addition. It must be dismissible by doing literally anything else, and it
must never require a click to get past.

**Tier 2 — a marked, coloured, hard-to-miss element inside content you were
already looking at. Budget: unbounded, because it costs nothing.**

Clinch/elimination edges on the standings, margin weight on schedule rows,
game-shape sparklines, a record-broken banner on the game page, a "first career
start" flag on a player row. These are not interruptions at all; they are the
existing pixels carrying more meaning.

**Tier 3 — the feed. Budget: strictly rate-limited by `lib/wireRank.ts`.**

Everything else. The existing `PER_TYPE_CAP = 2` and injury collapsing are the
right instincts and should be extended to `/news`.

### What I would explicitly NOT interrupt for

Stated plainly, because the failure mode is real:

- **Any regular-season win or loss, including a blowout, an upset, or a
  last-second finish.** These get *weight* (Tier 2) and a place in the Week
  Report (Tier 1). A player advances ~17 times a season; a modal on a good win
  becomes a modal on every win within one season.
- **Clinching a playoff spot or the division.** It is the single loudest line in
  that week's report, and a permanent marker on the standings. It is not a
  full-screen moment, because you can clinch a spot, then the division, then a
  bye — three Tier-0s in four weeks would immediately debase the currency.
- **Any milestone: 1,000 yards, 4,000 yards, a franchise record, a league
  record.** A generous roster produces several of these a season and they cluster
  (`lib/storyline.ts` already found this and capped `MILESTONE_SLOTS = 4` for
  exactly this reason). One "game ball" per week, in the report.
- **Any signing, trade, cut, or draft pick — including your own.** You initiated
  it; you already know. Confirming an action you took with a celebration is the
  slot-machine failure.
- **Injuries.** Sixteen a week league-wide. Already correctly collapsed by
  `wireRank`. Your own starter going down is a loud line in the report, not a
  modal.
- **A rookie's first start, a breakout game, a development jump.** These belong in
  Tier 2 — a marker on the player's row and their card, where the player will
  meet it naturally and where it *persists*, rather than a popup that fires once
  and is gone.
- **Advancing multiple weeks at once.** The multi-advance loop
  (`runMultiple`, `MAX_ITERATIONS = 60`) must show **one** report at the end
  covering the whole span, never one per iteration. A player who asked to skip to
  the playoffs has explicitly asked not to be stopped.

### The one-sentence rule I would hold every proposal to

> If it fires on more than one Advance in three, it may not interrupt; it must
> earn its place inside something the player was already going to read.

---

## Part 4 — The shape of a season, stated as a design target

Pulling the above together, a season has five kinds of moment, and the app
currently renders all five as the same table update:

| Moment | Frequency | Currently | Should be |
|---|---|---|---|
| A result lands | 17-21×/season | 7s toast, no score | Tier 1 report + Tier 2 weight |
| The shape of one game | every game | flat header, unread `drives[]` | Tier 2 shape path |
| The race tightens/loosens | weekly | static standings | Tier 2 arc line + edge markers |
| A threshold is crossed (clinch, record, milestone, first start) | ~5-15×/season | a pill, or a batched offseason row | Tier 2 markers, one Tier 1 headline |
| The season ends | 1×/season | 7s toast | Tier 0, once |

The good news, and the reason I am reasonably confident about the proposals: of
the nine proposals in the companion document, **six require no new schema and no
change to the sim engine.** The drama is already in the database. It is being
rendered at the wrong volume.

---

## Sources

- [Where Storytelling Evolves: FM26's Match Day Experience — Football Manager](https://www.footballmanager.com/fm26/features/where-storytelling-evolves-fm26s-match-day-experience)
- [Inbox and News — Football Manager 2024 manual, Sports Interactive](https://community.sports-interactive.com/sigames-manual/football-manager-2024/inbox-and-news-r4956/)
- [Inbox and News — FMInside](https://fminside.net/guides/basic-guides/20-inbox-and-news)
- [FM23 Feature Drop: Data Hub, Manager Timeline, Pre Match Briefings — sortitoutsi](https://sortitoutsi.net/content/61099/fm23-feature-drop-oct-13th-data-hub-versus-mode-manager-creation-pre-match-briefings)
- [Football Manager 2023 New Features — FM Scout](https://www.fmscout.com/a-football-manager-2023-new-features.html)
- [Deadline Day — Football Manager 2022](https://www.footballmanager.com/features/deadline-day)
- [Can you have just text commentary like Championship Manager? — Steam Community, FM21](https://steamcommunity.com/app/1263850/discussions/0/3069747601658786868/)
- [Madden NFL 20 Makes A Recommitment To Franchise Mode — Game Informer](https://gameinformer.com/2019/04/25/madden-nfl-20-makes-a-recommitment-to-franchise-mode)
- [Madden 20 Deep Dive: Scenario Engine — Operation Sports forums](https://forums.operationsports.com/forums/madden-nfl-football/956571-madden-20-deep-dive-scenario-engine.html)
- [Madden NFL 27 Franchise Mode Details Revealed — Operation Sports](https://www.operationsports.com/madden-nfl-27-franchise-mode-details-revealed/)
- [Madden NFL 27: Here Are The 10 Best New Features Revealed — Forbes](https://www.forbes.com/sites/brianmazique/2026/06/05/madden-nfl-27-here-are-the-10-best-new-features-revealed/)
- [Endless Possibilities Await as MyNBA Levels Up in NBA 2K26 — 2K Newsroom](https://newsroom.2k.com/news/endless-possibilities-await-as-mynba-levels-up-in-nbar-2k26)
- [NBA 2K27 MyNBA: Back to Basics Franchise Overhaul — 2K Newsroom](https://newsroom.2k.com/news/nbar-2k27-mynba-answers-the-community-with-a-back-to-basics-franchise-overhaul-and-modern-cba-rules)
- [Why do we get so attached to our soldiers in XCOM? — Game Developer](https://www.gamedeveloper.com/design/why-do-we-get-so-attached-to-our-soldiers-in-xcom-) *(not reachable from this environment; cited for the question it names, not for its argument)*
- [CK3 needs an EU4-style UI checkbox to enable/disable pop-ups — Paradox forums](https://forum.paradoxplaza.com/forum/threads/ck3-needs-an-eu4-style-ui-checkbox-to-enable-disable-types-of-pop-ups-and-event-notifications.1576495/)
- [Less Event Spam — Steam Workshop, Crusader Kings III](https://steamcommunity.com/sharedfiles/filedetails/?id=2750102888)
- [Endless pop-ups — Steam Community, Crusader Kings III](https://steamcommunity.com/app/1158310/discussions/0/5250637387540263724/?l=english)
- [Motorsport Manager — Steam](https://store.steampowered.com/app/415200/Motorsport_Manager/)
- [Motorsport Manager review — Strat Packer's blog](https://stratpack.blog/2021/08/27/motorsport-manager-review)
- [Unraveling NFL Win Probability Graphs to Find the Best Games — Walker Harrison](https://www.walker-harrison.com/posts/2021-11-13-unraveling-nfl-win-probability-graphs-to-find-the-best-games/)
- [ESPN's Win Probability Graphic Wants To Give You Gambling Brain — Defector](https://defector.com/espns-win-probability-graphic-wants-to-give-you-gambling-brain)
- [Playoff Odds Explanation — FanGraphs](https://www.fangraphs.com/standings/playoff-odds/about)
- [Playoff Odds Graphs — FanGraphs](https://www.fangraphs.com/standings/playoff-odds-graphs)
- [Notification pattern — Carbon Design System](https://carbondesignsystem.com/patterns/notification-pattern/)
- [Toast notifications: best practices for UX — LogRocket](https://blog.logrocket.com/ux-design/toast-notifications/)
- [Manager Score — Out of the Park Baseball manual](https://manuals.ootpdevelopments.com/index.php?man=ootp21&page=manager_score)
- [Out of the Park Baseball 27 — Steam](https://store.steampowered.com/app/4045750/Out_of_the_Park_Baseball_27/)
