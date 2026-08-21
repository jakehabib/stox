# Identity & World — research findings

**Lens:** making the league feel like a real world populated by real people.
**Scope note:** season moments/pacing and micro-interaction feedback are two
other researchers' lenses. Nothing here proposes a new animation, a new
transition, or a new "moment" — this is about *who* is on the screen and
*where they come from*.

Read with `README.md` §"Design principles (standing, not up for
re-litigation)" in hand. Everything below is additive. Nothing here removes an
avatar, a crest, a colour step, or a row of height.

---

## 0. What the app already has (baseline audit)

Before borrowing anything, here is what is genuinely already built — because
several of the obvious ideas turn out to be *already done but invisible*, and
"make the existing thing visible" is cheaper and safer than building a new one.

| Asset | Where | State |
|---|---|---|
| Procedural face | `lib/gen/avatar.ts` + `components/PlayerAvatar.tsx` | **Strong.** 11 hair styles, 5 facial-hair, 4 eye, 3 brow, 3 nose, 4 mouth, 3 face shapes, 8 skin tones, weighted (not uniform) toward a pro-football distribution, age-gated greying, real shading. Derived from `playerId`, stored nowhere. |
| Procedural crest | `lib/gen/teamLogo.ts` + `components/TeamLogo.tsx` | **Weak-ish.** 4 shapes x 5 patterns x 20 curated colour pairs = 400 combos, but the *centre of every crest is the three-letter abbreviation in a black box*. Structurally all 32 crests are the same object in different colours. |
| Seeded league past | `lib/gen/leagueHistory.ts` (1,271 lines) | **Very strong, under-shown.** 16-24 prior seasons, playoff brackets actually played out, franchise *eras* (dynasties decay, doormats get their decade), synthetic legends who hold the records, career stat lines for every veteran on every roster, and `assertHistoryConsistency` auditing all of it. |
| Ring of Honor | `app/league/[id]/history/page.tsx` | Exists. League-level: champions, records, awards, dynasty score leaderboard, per-team season log. |
| Rivalry | `lib/rivalry.ts` | Exists, derived from `Game` rows. Head-to-head, streaks, playoff meetings. Explicitly documents that it *cannot* model a remembered incident (no event log tying a `Transaction` to a `Game`). |
| Storylines | `lib/storyline.ts` | Exists, read-only, surfaced on the dashboard. |
| Draft lineage | `DraftPick.playerId` (unique) | Exists in schema. Surfaced only as a flat list on the GM Career page. |
| College | `Player.college` + `lib/gen/prospectProfile.ts` | Strong for draftees (full 13-game college season, combine, competition grade). Reduces to a single word once he's a pro. |

**What is NOT in the schema, and therefore costs money:** jersey number,
hometown, nickname, personality/temperament, handedness, a player's
team-by-team career history, and — the big one — **per-season player stats**.
`Player.careerStats` is a single merged JSON blob (`lib/season.ts:906-922`
folds `seasonStats` into it and clears it). There is no `PlayerSeason` table.
Any proposal that shows a year-by-year career arc, an all-time franchise
leaderboard, or "he was a Blaze from 2026 to 2033" needs new schema. I say so
explicitly in `proposals.md` wherever it applies.

**The headline finding of the audit:** the world's *past* is already
generated in enormous, internally-consistent detail, and the app shows almost
none of it below the league level. There is no per-franchise museum. A
veteran's page shows career totals but not that he was a 2019 first-round
pick of a different club, or that he has been here six years. The cheapest
"alive" wins in this codebase are visibility wins, not generation wins.

---

## 1. Football Manager — personality as a leaked hidden state

**The mechanic.** FM gives every player hidden attributes — Determination,
Ambition, Professionalism, Temperament, Loyalty, Pressure, Adaptability,
Controversy, Sportsmanship — and *never shows them as numbers*. They are
collapsed into one plain-English label on the profile: "Model Professional",
"Fairly Determined", "Temperamental". Temperament specifically "reflects how
well a player maintains self-control and composure when faced with setbacks,
adversity, or frustration"; Determination is "a commitment to succeed both on
and off the pitch"; and these personality attributes "have a major influence
on how well players develop."
([FM Scout](https://www.fmscout.com/a-guide-to-player-personalities-football-manager.html),
[Passion4FM](https://www.passion4fm.com/football-manager-player-attributes/),
[sortitoutsi FM24 guide](https://sortitoutsi.net/content/67996/fm24-guide-player-personalities))

Separately, **Player Traits / Preferred Moves** are behavioural sentences, not
ratings: "Plays With Back To Goal" is described as "the player will look to
hold up the ball in attacking areas… watching the movement of the ball rather
than thinking of spaces he should run into."
([Passion4FM traits guide](https://www.passion4fm.com/football-manager-player-traits/))

**Why it works psychologically.** Two distinct effects, and they are worth
separating because only one of them is expensive:

1. **The interiority illusion.** A single non-numeric word implies the
   existence of a whole hidden person underneath. A rating of 74 says "this
   object has a property"; "Model Professional" says "this person has a
   character, and I am only seeing a summary of it." The label is doing the
   work of a whole simulated inner life it does not actually have.
2. **Retro-causal explanation.** When the player later busts or overachieves,
   the label becomes the *reason*. The user narrates it themselves: "of course
   he stalled, he was Temperamental." FM does not need to write that story;
   it hands the user one word and the user writes it. This is the single
   highest-leverage sentence in this document.

Also relevant: FM's **club legend / "Favoured Personnel"** ladder, where 20
seasons at one club earns Club Legend status
([TrueAchievements](https://www.trueachievements.com/a344510/club-legend-achievement)).
Tenure itself is made into an object you can hold.

**Where it does NOT transfer here.** FM's personality attributes are wired
into a genuinely deep development and interaction sim (contract talks, squad
harmony, tutoring, media). This app has `Player.morale` (documented in the
schema as "PLACEHOLDER effect on re-sign odds") and no social sim at all.
Shipping a personality label that affects *nothing* would violate design
principle 6 ("no lying metrics") in spirit: a label that reads as a system is
a claim that a system exists. The honest port is either (a) label + wire it
to exactly one real thing, or (b) label it visibly as flavour. Option (a) is
cheap here and is what I propose.

---

## 2. Out of the Park Baseball — the record book as furniture

**The mechanic.** OOTP's Team History Index "gives a summary of the entire
history for the selected team, and from there you can access many screens
that give statistical information about the selected team"
([OOTP manual, Team History Index](https://manuals.ootpdevelopments.com/index.php?man=ootp16&page=team_history_index)).
OOTP 25 added a Hall of Fame partnership where "you'll be able to view every
Hall of Fame plaque, with the official text for each Hall of Famer," curated
into "exhibits"
([Sports Gamers Online](https://www.sportsgamersonline.com/games/out-of-the-park-baseball-25-announced-releases-march-15/)).
Its Team Editor exposes stadium, colours, logos and **jersey style**
(Standard, Single-lined, Double-lined, Stripes) as first-class franchise
properties
([OOTP manual, Team Colors/Logos/Uniforms](https://manuals.ootpdevelopments.com/index.php?man=ootp16&page=team_colors_logos)).
And the whole game is playable as a purely fictional universe — people run
multi-decade fictional leagues and write about them as histories
([SABR Gaming, IBF](https://sabrbaseballgaming.com/2024/07/09/using-ootpb-to-create-a-fictitious-baseball-universe-the-story-of-the-international-baseball-federation/)).

**Why it works psychologically.** A record book performs **reification**: it
converts an event that happened once into a *persistent object in the world*.
The moment a number goes on a wall it stops being a stat and becomes a thing
that can be *threatened*. That is what makes chasing it feel like anything —
you are not maximising a counter, you are taking something off somebody.
Corollary: **a record with a name and a face on it is worth several times a
record with only a number**, because the person you are displacing is what
makes it an act rather than an increment.

The plaque format matters too. A plaque is a *page about one person that is
not a stat sheet* — it is the game asserting that this individual is worth a
page. Nothing in a plaque is mechanically load-bearing. That is the point.

**What this app already has and should exploit.** `lib/gen/leagueHistory.ts`
already generates exactly the OOTP substrate: seeded legends, seeded records
calibrated against real sim output (`SEASON_RECORD_BAND`,
`CAREER_RECORD_BAND`), award winners, and franchise eras. `LeagueRecord` even
denormalises `playerName` and `teamAbbr` "so a retired/traded holder still
displays correctly." The furniture is built and is sitting in a warehouse.

**Where it does NOT transfer.** OOTP's per-season, per-team player stat
history is the thing that makes its team-history screens work, and this app
does not have it (see §0). An OOTP-style "franchise all-time leaders in
receiving yards" is **not** currently computable — `careerStats` is a career
total with no team attribution. Do not promise it without paying for a
`PlayerSeason` table.

---

## 3. NBA 2K MyNBA — banners, rafters, and long time horizons

**The mechanic.** In MyNBA you "watch banners rise from the hardwood and into
the rafters, where they'll hang beside retired franchise legends," with each
arena having a dedicated rafter section representing "years of history through
championships and decorated stars"
([NBA 2K26 MyNBA Courtside Report](https://nba.2k.com/2k26/courtside-report/mynba/)).
2K27 extended playable franchise length from 80 to 100 years
([NBA 2K27 MyNBA](https://nba.2k.com/2k27/features/mynba/)). The marketing
copy names the intended feeling directly: pride in "acknowledging your
development of an auto-generated rookie into a Hall of Famer."

**Why it works psychologically.** Two things:

1. **Accumulation made spatial.** A list of championship years is data; a wall
   with four banners on it and room for more is a *space with unfilled slots*.
   Unfilled slots generate wanting in a way a list never does. This is the
   Zeigarnik/collection instinct, and it is nearly free to implement — the
   data is identical, only the rendering changes.
2. **"Auto-generated rookie into a Hall of Famer" is the exact emotion this
   genre sells.** 2K says it out loud in its own feature copy. The pride is
   specifically that *the game did not hand you this person* — he was noise,
   and you turned him into a name. That is the target emotion for this app's
   lens, and it names the mechanism: the game must remember, and keep showing
   you, that *you* acquired him and what he was when you did.

**Where it does NOT transfer.** No 3D arena, no rafters, no ceremony
cutscene. The port is a flat "banner wall" strip — pennants in team colours
with years on them — which is fine, and arguably better in a front-office
game where you are looking at a document, not standing in a building.

---

## 4. Crusader Kings III — portraits as the primary interface to a person

**The mechanic.** CK3 stores appearance as **DNA**: "everything from mouth
shape to body height is stored in this DNA," with "more than 10 times the
amount of genes for every character" compared to CK2, and children inherit
visibly from parents
([PC Invasion on Dev Diary #34](https://www.pcinvasion.com/crusader-kings-iiis-latest-dev-diary-explains-schemes-portraits-dna-council-members-and-your-court/),
[CK3 Wiki, character modding](https://ck3.paradoxwikis.com/index.php?title=Characters_modding)).
Crucially the genes cover **body** as well as face — build, weight,
musculature, height — and portraits **age visibly** across a life.

**Why it works psychologically.** Faces are the highest-bandwidth identity
channel humans have; we are wired to individuate on them and we do it
pre-attentively. But the specific lesson from CK3 is not "more face" — it is
**the portrait carries information that is also in the data**. A CK3 glutton
is fat *in his portrait*. When the picture and the stat line agree, the
picture stops being decoration and becomes a second, faster read of the same
truth — and the character stops being a name with a picture attached and
becomes a body.

This is the single clearest actionable gap in this app. `Player.heightIn` and
`Player.weightLb` exist, are generated per-position with real spreads
(`BODY[position]` in `lib/gen/players.ts`), and are **displayed as text on the
player page** ("6'1\" · 202 lb") — and the portrait ignores both completely. A
330 lb nose tackle and a 175 lb kicker currently get the same neck, the same
shoulders and the same jaw. Age is only used for hair greying and facial-hair
probability; a 36-year-old and a 24-year-old have identical skin.

**Where it does NOT transfer.** CK3 has a 3D renderer and hundreds of gene
sliders. This app draws flat SVG that must survive being shrunk to a 20px
roster row — `PlayerAvatar.tsx`'s own header comment says detail is
"deliberately kept bold… silhouette has to survive when the fine strokes
vanish." So: **body mass and age must be expressed in the silhouette
(shoulder width, neck thickness, jaw mass, hairline), not in fine detail.**
Wrinkles are a >64px bonus, not the mechanism. Also, no inheritance — there is
no parentage in this game and there should not be.

---

## 5. RimWorld / Dwarf Fortress — attachment to a procedural nobody

**The mechanic.** Sylvester calls RimWorld a "story generator": fun comes not
from objectives but "from seeing non-scripted stories play out." Pawns carry
**traits and backstories** that create behavioural collisions — "a brilliant
doctor with a 'Pyromaniac' trait might save lives but also start fires during
a mental break"
([The Story Generator: A Game Design Analysis of RimWorld](https://substack.com/home/post/p-155708844)).
The comparative literature makes a sharper point: mood and relationship
changes "are made visible during crises or status changes… and because these
mechanics aren't directly on the UI, it gives the impression that changes are
internal to the characters." And DF settlers feel *less disposable* than
RimWorld's, partly because of history depth and scale
([Game Developer](https://www.gamedeveloper.com/design/dwarf-fortress-and-rimworld-tell-very-different-stories)).

**Why it works psychologically.** Three mechanisms, all portable:

1. **Trait collision, not trait possession.** A trait is inert on its own.
   "Pyromaniac" is only a character when it *contradicts* the useful thing
   about him. The attachment comes from the tension. For this app: a
   personality tag is worth having only if it can cut against the rating —
   the 88 OVR who is a locker-room problem, the 71 who outworks his ceiling.
2. **Leakage beats display.** Hidden state that shows itself only at moments
   (a mental break, a mood drop) reads as interiority; the same state printed
   permanently on the UI reads as a stat. Prefer *occasional surfacing* — a
   line in the scouting report, a note during re-sign — over a permanent
   badge, or do both with the badge quiet and the line loud.
3. **A death that is legible is worth more than a life that isn't.** DF's
   attachment is heavily downstream of engraved memorials and legends mode —
   the game remembers who died and writes it on a wall. The retirement of a
   player you drafted is this app's equivalent of a dwarf dying, and it
   currently passes with, at most, a transaction row.

**Where it does NOT transfer.** RimWorld's attachment is built on relationship
webs, mental breaks, and permadeath in a colony of 8-12 named individuals. This
app has ~1,500 players and no social simulation. Do not build a relationship
graph. The transferable part is the *cheap* part: give a handful of players a
tag that can contradict their number, and make retirement/departure legible.

---

## 6. Blood Bowl — persistence and the earned name

**The mechanic.** Players accrue Star Player Points for exceptional actions
only (a completed pass 1, a touchdown 3, interceptions, MVP), level up, and
carry permanent injuries; hired Star Players and Mercenaries pointedly do
**not** accrue SPP or level up
([Blood Bowl 2 wiki, Players](https://blood-bowl-2-video-game.fandom.com/wiki/Players),
[Star Players](https://blood-bowl-2-video-game.fandom.com/wiki/Star_Players)).
Community threads are full of people asking for a **rename/nickname** system —
"the name is fixed, but you can change their nickname as you like"
([Steam discussion](https://steamcommunity.com/app/236690/discussions/0/154644045360489863/)).

**Why it works psychologically.** The rented star who cannot accumulate is the
cleanest possible demonstration of what attachment is made of: **history that
only exists because you were there for it.** A free agent you sign is a
transaction; a player who has been on your roster for six years is a
relationship, and the only difference is a ledger. Also note that the
nickname request comes *from players, unprompted, about procedural
characters* — people want a handle for the guy that the game did not give
him, because a name you assign is a name you own (§7).

**Where it does NOT transfer.** No permadeath, no per-match injury
persistence at the individual level (this app has `injuryWeeks` /
`injuryType` which clear on recovery). And player-typed nicknames are an
input field and a schema column — cheap, but it is a *user-authored* feature,
which conflicts a little with everything else being seeded. Earned nicknames
(awarded by a rule) are the seeded-world version.

---

## 7. The ownership literature — why the 6th-round pick

The owner's brief names the target emotion precisely: "caring about a specific
player you drafted in round 6." The behavioural-economics account of this is
well established and worth stating plainly because it dictates *where* the
mechanisms have to go.

- **Endowment effect:** people value a thing more once it is theirs. Mere
  possession, no effort required.
- **IKEA effect:** effortful creation deepens it further — "people value
  things more when they invest their own labor in creating them," explained by
  need for competence, effort justification, and endowment
  ([The Decision Lab](https://thedecisionlab.com/biases/ikea-effect),
  [InsideBE](https://insidebe.com/articles/the-ikea-effect/)).
  In games: "any cuts you create persist on the character throughout the
  game, creating an 'Ikea effect'"
  ([InformIT](https://www.informit.com/articles/article.aspx?p=2931572&seqNum=6)).

**The operative consequence for this app:** attachment is manufactured by
*visible, persistent evidence of your own investment*, attached to the
individual, shown at the individual's location — not on a summary page.

Right now this app has the investment (you scouted him, you spent a 6th on
him, you developed him with focus charges, you kept him through three
contracts) and displays **almost none of it on his page**. The GM Career page
has a flat "DRAFT Round 7, Pick 11: Ibrahim Tillman (QB)" list; Tillman's own
page does not say you drafted him. That is the largest single miss in this
lens, and it is nearly free — `DraftPick.playerId` is a unique column.

Ranked strength of the available ownership hooks, strongest first:
1. **You drafted him** (and how late — lateness is the whole story).
2. **You kept him** — tenure, re-signings, contracts survived.
3. **You scouted him** — passes spent, workouts held, a Deep Dive bought.
4. **You developed him** — `devFocus` charges spent on him.
5. **You traded for him** — `TradeRecord` holds the snapshot.

All five are already in the database. None of the five is on the player page.

---

## 8. Synthesis — the five mechanisms worth stealing

1. **The portrait must agree with the data.** (CK3) Body mass and age belong
   in the silhouette. Free — `heightIn`, `weightLb`, `age`, `position` all
   exist and are already displayed as text next to a portrait that ignores
   them.
2. **A unique handle beyond the name.** (Blood Bowl, every real sport) A
   jersey number is the cheapest identity primitive in sports and this game
   has none. It is also the prerequisite for retired numbers, which is the
   prerequisite for a franchise museum that means anything.
3. **One word that implies a whole person.** (FM) A personality archetype,
   derived from seed, wired to exactly one real system so it is not a lie,
   and surfaced mostly through prose rather than a permanent badge.
4. **Evidence of your own investment, on his page.** (endowment/IKEA, 2K's
   "auto-generated rookie into a Hall of Famer") Draft lineage, tenure,
   scouting spend — persistent, at the individual, forever.
5. **The past as furniture, per franchise, with faces on it.** (OOTP, 2K)
   The league already generated 16-24 years of consistent history. Give each
   club a museum: banners, era timeline, retired numbers, records held. The
   generation is done; only the room is missing.

## 9. Explicit non-transfers (do not propose these)

- **CK3-depth gene systems.** Wasted at 20px; the app's own avatar file
  documents why.
- **Relationship graphs / social sim** (RimWorld, DF). New subsystem, not a
  design pass. 1,500 players.
- **Madden X-Factor in-game abilities.** These are balance changes to the sim
  engine dressed as identity. Out of scope, and they would break
  `scripts/benchmarkTradeValue.ts` assumptions.
- **Real photos, real logos, real colleges, CDN assets.** Hard constraint —
  everything is seeded SVG/CSS.
- **AI-team perception/reputation systems.** The README already documents
  that AI teams evaluate off true ratings with no fog of war. Anything
  implying a rival GM "rates him differently" would be a lying metric.
- **Any franchise all-time statistical leaderboard**, until a `PlayerSeason`
  table exists. `careerStats` has no team attribution.

---

## Sources

- [FM Scout — A Guide to Player Personalities](https://www.fmscout.com/a-guide-to-player-personalities-football-manager.html)
- [Passion4FM — Football Manager Player Attributes Explained](https://www.passion4fm.com/football-manager-player-attributes/)
- [Passion4FM — Football Manager Player Traits / Preferred Moves](https://www.passion4fm.com/football-manager-player-traits/)
- [sortitoutsi — FM24 Guide: Player Personalities](https://sortitoutsi.net/content/67996/fm24-guide-player-personalities)
- [TrueAchievements — FM22 "Club Legend" achievement](https://www.trueachievements.com/a344510/club-legend-achievement)
- [OOTP manual — Team History Index](https://manuals.ootpdevelopments.com/index.php?man=ootp16&page=team_history_index)
- [OOTP manual — Team Colors, Logos, and Uniforms](https://manuals.ootpdevelopments.com/index.php?man=ootp16&page=team_colors_logos)
- [Sports Gamers Online — OOTP 25 announcement (Hall of Fame plaques)](https://www.sportsgamersonline.com/games/out-of-the-park-baseball-25-announced-releases-march-15/)
- [SABR Gaming — Using OOTPB to Create a Fictitious Baseball Universe](https://sabrbaseballgaming.com/2024/07/09/using-ootpb-to-create-a-fictitious-baseball-universe-the-story-of-the-international-baseball-federation/)
- [NBA 2K26 — MyNBA & MyGM Courtside Report](https://nba.2k.com/2k26/courtside-report/mynba/)
- [NBA 2K27 — MyNBA features](https://nba.2k.com/2k27/features/mynba/)
- [PC Invasion — CK3 Dev Diary #34 (portraits, DNA, genes)](https://www.pcinvasion.com/crusader-kings-iiis-latest-dev-diary-explains-schemes-portraits-dna-council-members-and-your-court/)
- [CK3 Wiki — Characters modding (DNA/genes)](https://ck3.paradoxwikis.com/index.php?title=Characters_modding)
- [The Story Generator: A Game Design Analysis of RimWorld](https://substack.com/home/post/p-155708844)
- [Game Developer — How Dwarf Fortress and RimWorld tell radically different stories](https://www.gamedeveloper.com/design/dwarf-fortress-and-rimworld-tell-very-different-stories)
- [Blood Bowl 2 Wiki — Players (SPP, levelling, injuries)](https://blood-bowl-2-video-game.fandom.com/wiki/Players)
- [Blood Bowl 2 Wiki — Star Players](https://blood-bowl-2-video-game.fandom.com/wiki/Star_Players)
- [Steam — Blood Bowl 2, renaming a player after buying him](https://steamcommunity.com/app/236690/discussions/0/154644045360489863/)
- [The Decision Lab — IKEA effect](https://thedecisionlab.com/biases/ikea-effect)
- [InsideBE — The IKEA Effect](https://insidebe.com/articles/the-ikea-effect/)
- [InformIT — One Vision: Local Culture and Game Design (IKEA effect in character customisation)](https://www.informit.com/articles/article.aspx?p=2931572&seqNum=6)
