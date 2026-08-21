# Genre Research: Making Dynasty GM Football the Best of Its Type

Research pass across football/baseball/soccer GM sims, player forums, and
sports-media UI patterns, cross-checked against what this codebase already
has (per `README.md` and direct inspection of `prisma/schema.prisma`,
`lib/season.ts`, `lib/sim/units.ts`, `lib/tuning.ts` as of 2026-08-21).
Research-only — no application code was touched, per instructions.

> **Method note on sourcing.** `WebSearch` worked normally throughout this
> task. `WebFetch` was blocked by this session's network egress proxy for
> **every** domain attempted (Wikipedia, Steam Community, gmgames.org,
> Operation Sports, three different Substacks, sgx.studio, lollypop.design —
> eight distinct hosts, zero successes), so nothing below is a direct-fetch
> quote pulled from a primary page myself. Every claim is a synthesis
> `WebSearch` produced from indexed snippets of the cited URL. I've tagged
> claims: **[Verified]** = the search result stated it directly/specifically
> enough that I'm confident it's accurate; **[Reported]** = it's the search
> tool's paraphrase of a source, plausible but could have lost nuance or be
> stale (game version uncertain); **[Inference]** = my own reasoning, not
> sourced. Where a fact came from reading this repo's own code, it's marked
> **[Codebase]** with the file.

---

## Executive summary — top 5, ranked

1. **Give coordinators a real, player-facing coaching-staff layer with scheme
   identity.** The codebase already has a hidden `coordinator.rating` number
   that feeds unit performance (`lib/sim/units.ts`) and a background routine
   that fires underperforming *AI* coordinators (`lib/season.ts`,
   `fireStrugglingCoordinators`) — but the player never sees, hires, fires,
   or picks a scheme for their own coordinators **[Codebase]**. This is the
   single most requested and most differentiating layer in the genre: Front
   Office Football's whole identity is "choose team gameplan vs. let
   coordinators call it vs. call every play yourself" **[Reported]**, and two
   *current* (2026) indie competitors — Gridiron GM and Gridiron Football GM
   — are built specifically around coordinator scheme-fit (Air Raid / Power
   Run / West Coast / Zone Blitz) as their core hook **[Reported]**. The
   plumbing already exists; only the player-facing management layer is
   missing.

2. **Add a narrative/storyline engine that threads events together, not just
   logs them.** Dynasty GM has a strong *facts* layer (news wire ticker,
   transactions, game recaps, franchise history, awards, dynasty score) but
   nothing connects those facts into an ongoing story — no rivalries, no
   "revenge game" framing, no multi-week narrative arcs. This is the exact
   feature OOTP Baseball's storyline engine and Football Manager's Dynamics
   system are singled out for — both are explicitly credited as *why* those
   games create long-term attachment to a save **[Reported]**. This is
   almost certainly the highest-leverage single addition for "why do I care
   about season 5."

3. **Give the player's own GM tenure real stakes (job security / owner
   expectations), with an opt-out toggle.** The codebase currently states
   outright: *"User teams are never auto-fired; coaching is the user's
   call"* **[Codebase, `lib/season.ts` line ~609]**. Every AI-run
   counterpart genre concept has some version of this pressure — Franchise
   Hockey Manager (OOTP's own hockey sibling) has a "self-preservation"
   rating and lets you talk your way off the hot seat, but deliberately
   makes the "Cannot be fired" toggle available in Sandbox mode only, not in
   its real career mode **[Reported]**; Madden only added a coordinator
   "Job Security" metric in its 2026 edition after years of the exact
   complaint this fixes **[Reported]**. Given this game's own settings
   philosophy (difficulty, injuries, scouting, sim variance are all
   toggleable), a job-security system with an off switch is a very natural
   fit, not a bolt-on.

4. **Wire the already-modeled `morale` field into actual outcomes.** The
   schema already has `Player.morale` — but it's commented `// PLACEHOLDER
   effect on re-sign odds` and a grep of every `lib/*.ts` file found **zero**
   real usages of it **[Codebase]**. This is the cheapest of the five: no
   new schema, no new UI concept, just wiring a dormant number into re-sign
   willingness and (optionally) a small performance modifier — the same
   move OOTP makes with mood/loyalty/greed player traits **[Reported]** and
   Football Manager makes with its Dynamics happiness tab **[Reported]**.
   Exposed to the player as a qualitative read (not a raw 0–100 number), it
   would also match the game's own established fog-of-war idiom perfectly.

5. **Harden AI trade/contract realism — the genre's single most consistent
   complaint.** Both direct competitors researched have the same complaint
   pattern: Front Office Football's trade AI reportedly rarely offers actual
   players, mostly picks, across entire saves **[Reported]**; Draft Day
   Sports: Pro Football has reported dead-money accounting that behaved
   inconsistently between the user and AI teams, and contract demands from
   mediocre/aging players that don't track realistic value **[Reported]**.
   Notably, this exact *class* of bug (asymmetric dead-money treatment) is
   one this codebase already found and fixed once itself, for void years
   (2026-08-21 changelog entry) and again for trade-side bonus acceleration
   the same day **[Codebase, README.md changelog]** — which is genuinely
   good evidence the team already has the right instincts here. The
   recommendation is to keep auditing for the *next* instance of this bug
   class (the README's own "Known simplifications" section already flags
   "no autonomous AI-vs-AI trading" as one such remaining gap) and to make
   AI-initiated trade offers to the user more frequent and player-centric,
   not just pick-for-pick.

---

## Competitive landscape

### Front Office Football (FOF7/8/9, Solecismic Software)
The "hardcore stats-heads" benchmark for depth of control.
- **Steal:** the three-tier coaching control model — full team gameplan,
  delegate to coordinators, or call every play live — lets one game serve
  both a casual "advance week" player and a football-obsessive one without
  forcing either into the other's playstyle **[Reported]**. Coaches/scouts
  give in-fiction opinions on your own and opposing rosters rather than just
  showing raw numbers **[Reported]**.
- **Avoid:** staff hiring reportedly uses a confusing "draft-style" pick
  order for assistants/coordinators that reviewers called unrealistic and
  frustrating **[Reported]**; trade AI is a recurring complaint — players
  report going full saves with the AI never offering a player, only picks
  **[Reported]**; FOF9 sits at "Mostly Positive," 79% of 165 Steam reviews
  **[Reported]**, with recurring gripes about poor information layout and a
  setting where AI coordinators can silently rewrite your depth chart before
  every game if left enabled **[Reported]**.
- Sources: [Front Office Football 8 Review – Operation Sports](https://www.operationsports.com/front-office-football-8-review-pc/), [FOF8 Review – gmgames.org](https://gmgames.org/front-office-football-8-fof8/review/), [Front Office Football Nine on Steam](https://store.steampowered.com/app/2633170/Front_Office_Football_Nine/), [FOF9 Steam discussions](https://steamcommunity.com/app/2633170/discussions/)

### Draft Day Sports: Pro Football (Wolverine Studios, annual releases through 2026)
The closest direct competitor in scope and ambition to this project.
- **Steal:** it's marketed as "the only pro football management sim
  constantly being expanded" **[Reported]** — i.e., its edge is treating the
  GM layer as the permanent product, not a mode bolted onto a bigger game.
  It ships with custom playbooks/play-calling as an optional deeper layer on
  top of the GM game, which some reviews say only really shines in
  multiplayer leagues **[Reported]** — suggesting the base single-player GM
  loop alone isn't always enough to sustain long-term engagement without a
  social/competitive layer, worth keeping in mind if Dynasty GM ever adds
  multiplayer.
- **Avoid:** dead-money handling reportedly doesn't apply the same way to
  the user as to AI teams (AI retains dead money correctly, user-facing
  behavior didn't in past versions) **[Reported]** — the exact bug class
  this codebase just fixed for itself (see item 5 above); reported
  frustration that average/aging players demand unrealistic, above-market
  contracts, making veteran roster management harder than it should be
  **[Reported]**; DDS:PFB 2025 sits at a mixed 46% positive on a small
  13-review Steam sample **[Reported]** (small-N, treat with caution).
- Sources: [DDS: Pro Football 2025 on Steam](https://store.steampowered.com/app/3323590/Draft_Day_Sports_Pro_Football_2025/), [DDS:PFB 2023 Review – Operation Sports](https://www.operationsports.com/draft-day-sports-pro-football-2023-review-another-winner/), [Where DDS:PFB really shines – Steam discussion](https://steamcommunity.com/app/3323590/discussions/0/595150188903958973/)

### Out of the Park Baseball (OOTP Developments) — the genre's gold standard
Explicitly cited as having beaten Football Manager for "Best Management
Sim" **[Reported]**. What it does that others reportedly don't:
- **Storyline engine** (since OOTP 11, 2010): generates contextual narrative
  based on a player's age, nationality, physical condition, and era —
  described by reviewers as feeling "almost too organic to be
  auto-generated" **[Reported]**. This is the single feature most repeatedly
  singled out as the thing that makes a save feel alive rather than a
  spreadsheet.
- **RPG-like player personality traits that affect on-field outcomes**:
  mood, loyalty, leadership, greed, and "desire to play for a winner" are
  tracked and surfaced on a dedicated Team Chemistry screen, and actually
  modulate performance/happiness, not just flavor text **[Reported]**.
- **A second, lighter mode for the same depth**: "Drive for the Pennant"
  (OOTP 25) lets a player run a team but only surface the pivotal decision
  moments, instead of every micromanagement screen — an explicit answer to
  "too many numbers" that doesn't remove the deep mode, just adds an
  alternate front door to it **[Reported]**.
- **Depth without losing accessibility**: multiple reviews independently
  describe it as "quite intuitive and easy to navigate" despite enormous
  depth — explicitly contrasted with complexity that exists for its own sake
  **[Reported]**.
- Sources: [Best Management Sim in 2020: OOTP 21 – Operation Sports](https://www.operationsports.com/best-management-sim-in-2020-out-of-the-park-baseball-21/), [OOTP 11's Storyline Engine – brian.carnell.com](https://brian.carnell.com/articles/2010/out-of-the-park-baseball-11s-storyline-engine/), [OOTP 25 Review – gamecritics.com](https://gamecritics.com/brad-bortone/out-of-the-park-baseball-25-review/), [OOTP 26 Review – Gamer Social Club](https://gamersocialclub.ca/2025/03/25/out-of-the-park-baseball-26-review/), [Review of OOTP 25 – Douglas Sun](https://douglassun.substack.com/p/review-out-of-the-park-baseball-25)

### Football Manager (Sports Interactive/SEGA) — soccer, but the UI/narrative benchmark
- **Steal — the Dynamics system** (since FM18): tracks squad happiness
  across five separate axes (Training, Treatment, Club, Management, Playing
  Time) visible to the manager, and was called by PC Gamer "a fantastic
  story generator" in its own right — locker-room politics becoming
  emergent narrative players write fan-fiction about **[Verified — this is
  the article's actual headline claim]**.
- **Steal — hidden personality attributes shown only as text, never as a raw
  number**: seven hidden 1–20 attributes (Ambition, Controversy, Loyalty,
  Pressure, Professionalism, Sportsmanship, Temperament) are inferred by the
  player only through descriptive text ("has an excellent professional
  attitude") and player interactions, never displayed as a number
  **[Reported]**. This is a directly reusable UI idiom for Dynasty GM's own
  fog-of-war design language.
- **Steal — delegable press conferences**: the manager can personally handle
  media to shape morale/narrative, or delegate to a staffer with high
  "Media Handling"/"People Management" ratings **[Reported]** — a good
  precedent for making a narrative system optional depth rather than a
  chore.
- Sources: [FM 2018's Dynamics system is a fantastic story generator – PC Gamer](https://www.pcgamer.com/football-manager-2018s-dynamics-system-is-a-fantastic-story-generator/), [FM 2018's Dynamics lets you win or lose the dressing room – PC Gamer](https://www.pcgamer.com/football-manager-2018s-dynamics-system-lets-you-win-or-lose-the-dressing-room/), [Guide to Player Personalities – FM Scout](https://www.fmscout.com/a-guide-to-player-personalities-football-manager.html), [Understanding Player Personalities in FM](https://www.footballmanagerblog.org/2024/05/understanding-player-personalities-football-manager.html)

### Franchise Hockey Manager (OOTP Developments' hockey sibling)
The single best precedent found for a job-security mechanic:
- A "self-preservation" rating represents the GM's ability to talk the
  owner out of firing them when the team is struggling and the owner is
  angry — i.e., job security is itself a stat the player can build, not a
  binary countdown **[Reported]**.
- Critically, the "Cannot be fired" option is available in **Sandbox mode
  only**; it's explicitly *not* offered in the game's "Path to Glory" career
  mode, where getting fired is part of the point **[Reported]**. This is a
  clean precedent for gating the stakes by mode/setting rather than by
  removing them for everyone.
- Sources: [Franchise Hockey Manager 3: Top new features – OOTP blog](https://blog.ootpdevelopments.com/franchise-hockey-manager-3-top-new-features-for-armchair-gms/), [FHM Job discussion – OOTP forums](https://forums.ootpdevelopments.com/showthread.php?t=239550)

### Madden NFL Franchise Mode (EA) — cautionary tale, but validates demand
- Long-running, multi-year fan complaint that franchise mode is neglected
  in favor of Ultimate Team monetization; described across several years
  (21, 24, 25) as "unplayable" or stagnant by fans and critics
  **[Reported]**.
- Madden NFL 26 (2025) finally shipped a "Job Security" metric for
  coordinators, a coaching carousel where CPU teams can poach a good
  coordinator away from you, and an Owner Mode with hire/fire and
  ticket/merch pricing control **[Reported]** — years after fans asked for
  it. This is useful mainly as market validation: even the market leader's
  own team has concluded coaching-staff stakes and job-security pressure
  are what a franchise mode needs to feel alive.
- Sources: ["NFL doesn't care" – Sportskeeda](https://www.sportskeeda.com/nfl/news-madden-24-s-franchise-mode-fans-calling-league-take-stern-action-ea), [Franchise Mode Getting Biggest Update in Ten Years – Hardcore Gamer](https://hardcoregamer.com/madden-nfl-26-franchise-mode/), [Madden NFL 26 Franchise Mode – ESPN](https://africa.espn.com/gaming/story/_/id/45708826/madden-nfl-26-franchise-mode)

### Gridiron GM (VaultSpark Studios) and Gridiron Football GM (Gridiron Games) — current indie competitors
Two separate, currently-active (2026) indie projects explicitly building
"the GM game that doesn't exist yet" — directly relevant as prior art
because they're solving the same problem this project is:
- **Gridiron GM**: coaching schemes (Air Raid, Power Run, West Coast, Zone
  Blitz) that mechanically shape sim outcomes through "scheme fit"; scouts
  with nine distinct specialties who can see three draft classes ahead
  (deeper time-horizon scouting than typical); a $300M cap across a 42-man
  roster; an animated broadcast-style "Live Sim" (SVG field, drive tracking,
  Player-of-the-Game reveal) as an alternative to instant-resolve
  **[Reported]**.
- **Gridiron Football GM** (solo Swiss developer, Steam Early Access 2026):
  a 30-season front-office arc; explicit "coach lifecycle" — hire/fire,
  coordinator trees, scheme fit, mid-season vacancies; scouting reports
  written in prose that reportedly "read like a real coaching staff wrote
  them" rather than as raw numbers; pre-snap play-calling with primary
  call/check-with-me/audibles so the box score is built from real
  positional-matchup plays rather than allocated top-down **[Reported]**.
  The developer's own stated motivation — waiting years for someone else to
  build "a game where you're really in the front office" before building it
  himself **[Reported]** — is itself a strong signal that this exact genre
  gap (a serious, non-monetized, GM-only football sim) is under-served
  enough that multiple independent developers are converging on it right
  now, in 2026.
- **Note for this game specifically:** Dynasty GM's box score is
  *allocated top-down from team drive totals* rather than built from
  simulated plays **[Codebase, README "Known simplifications"]** — this is
  the exact axis Gridiron Football GM is explicitly differentiating on. Not
  a quick fix, but worth knowing a direct competitor is pitching this as
  its headline feature.
- Sources: [Gridiron GM – VaultSpark Studios](https://vaultsparkstudios.com/games/gridiron-gm/), [Gridiron Football GM – Gridiron Games](https://gridirongames.net/games/gridiron-football-gm/), [Why I'm building Gridiron Football GM – devlog](https://gridirongames.net/devlog/why-im-building-gridiron-football-gm/), [Gridiron Football GM on Steam](https://store.steampowered.com/app/4757940/Gridiron_Football_GM/)

### ZenGM / Football GM ("FBGM," zengm.com)
Free, browser-based, shares an engine with Basketball GM/Hockey GM/Baseball
GM.
- **Steal:** "challenge modes" as accessibility/variant toggles — no draft
  picks, no free agents, no trades, no visible ratings — let the same
  engine serve very different playstyles without forking the game
  **[Verified]**. Also: retired jerseys, career-high tracking, and
  all-time/GOAT-style leaderboards are treated as a baked-in part of the
  franchise-history layer, not a late add-on **[Reported]**.
- Sources: [League creation options – ZenGM blog](https://zengm.com/blog/2020/06/league-creation-options/), [zengm-games/zengm – GitHub](https://github.com/zengm-games/zengm)

---

## What players want (recurring themes)

1. **"Spreadsheet" is the worst thing a management sim can be called.**
   Across every forum/review source searched, the recurring negative-pole
   description is some variant of "feels like a spreadsheet" / "feels like
   work" — the antidote in every positive-pole description is *narrative*:
   a storyline engine (OOTP), a story-generating Dynamics system (FM), or a
   coaching staff that gives you opinions in its own voice (FOF, Gridiron
   Football GM) **[Reported/Inference]**. The throughline: numbers alone
   don't create attachment; numbers **connected into an ongoing story**
   about people do.

2. **AI realism in trades and contracts is the most consistently reported
   complaint across every AI-opponent-driven game researched.** FOF (trade
   AI too passive/pick-only), DDS:PFB (dead-money asymmetry, unrealistic
   veteran contract demands) — both independently reported the same shape
   of problem: the AI's economic behavior doesn't match the user's, breaking
   immersion in the exact system (money/value) these games are supposedly
   about. This directly validates continued investment in `lib/ai/gm.ts`'s
   explainable-factor approach, which is already ahead of what's described
   for either competitor.

3. **Franchise mode neglect is a top-line complaint even in the
   best-funded, highest-budget game in the category (Madden).** This is
   less "what players want added" and more "what happens when a franchise
   mode is treated as secondary" — years of stagnation complaints, only
   resolved (partially) in 2026 by adding exactly the coaching-staff-stakes
   layer this report recommends. Useful as evidence that this genre
   rewards continuous, franchise-mode-first investment rather than treating
   it as one mode among several.

4. **Depth needs an accessible front door, not just a hardcore one.**
   OOTP's "Drive for the Pennant" mode and ZenGM's challenge-mode toggles
   are two independent solutions to the same tension: hardcore depth is a
   selling point, but it can also be the thing that keeps new players from
   ever getting attached to a save. Dynasty GM already partially solves
   this with its Basic/Advanced toggles on Cap and Stats — the genre
   evidence suggests that pattern is worth extending further, not
   abandoning for "more depth everywhere."

5. **Job security / owner pressure is wanted specifically as *optional*
   stakes, not a mandatory difficulty spike.** FHM's Sandbox-only "Cannot be
   fired" toggle is the clearest evidence: players want the *option* of
   real consequences for their own tenure, but not everyone wants it forced
   on. This maps cleanly onto Dynasty GM's existing settings-heavy design
   philosophy (injuries, scouting, sim variance are all togglable already).

---

## UI/UX patterns worth adopting

These are specific, actionable patterns, not general "add more polish"
advice.

- **The Bite / Snack / Meal density model.** A recurring framework in
  dashboard-design writeups: a "Bite" is a single at-a-glance insight card,
  a "Snack" is a small trend chart (e.g., a sparkline), and a "Meal" is the
  full drill-down page **[Reported]**. Dynasty GM already nails Bite (Front
  Office Brief, hero stat tiles) and Meal (Cap/Stats Advanced views with
  real charts) — the missing middle tier is Snack: a persistent, tiny trend
  indicator sitting *next to* a big single number, so a viewer doesn't have
  to jump all the way to the Advanced view just to see "is this trending up
  or down." Concretely: a small cap-space sparkline next to the hero cap
  number on the Cap page masthead; a tiny 5-game form trend next to the
  Dashboard's win-probability figure. Low implementation cost, reuses the
  existing `components/charts/` kit.

- **Hide the raw number, show the read — for any new "soft" stat.** Football
  Manager's hidden personality attributes are never shown as a number to
  the player, only as descriptive text inferred from player interactions
  **[Reported]**. Dynasty GM's own scouting system already does something
  structurally similar (ranges instead of hard numbers, confidence that
  narrows over time). If morale/personality/chemistry gets added (Exec
  Summary #4), it should follow this same idiom — a qualitative tag ("locker
  room leader," "keeps to himself," "wants out") rather than a raw slider —
  because that's already the game's established visual language, not a new
  one to learn.

- **Progressive disclosure is the correct answer to "too many numbers," and
  it's a general dashboard-design consensus, not a sports-specific one.**
  One meta-review cited in search results found information overload is the
  most common dashboard complaint across studies, affecting nearly half of
  users, driven specifically by excessive density and lack of contextual
  filtering **[Reported]**. Dynasty GM's Basic/Advanced toggle pattern
  (Cap, Stats) is exactly the right shape of fix — the actionable
  recommendation is to extend that same toggle affordance to any other page
  that's grown data-dense without one (the changelog's own description of
  Roster and Depth Chart as flat tables with position-color coding but no
  stated Advanced layer suggests they may be candidates once/if their
  data density grows further — flagged as worth revisiting, not a current
  urgent gap).

- **The broadcast/editorial aesthetic direction already underway is
  correct and matches the industry reference points.** ESPN's Emmy-winning
  2018 NFL Draft graphics package is specifically described as
  "fast-paced and editorial-centric," combining black-and-white with bold
  typography and thin outline accents **[Reported]** — which is directionally
  identical to what the README's redesign changelog describes already
  shipping (team-tinted hero panels, stadium-light texture, an editorial
  League Wire with colored category kickers, a broadcast-style "On The
  Clock" draft state). This isn't a gap; it's confirmation to keep pushing
  the same direction rather than second-guess it — in particular, leaning
  further into restrained motion (the ticker's `prefers-reduced-motion`
  handling already shows the right instinct) and high-contrast type over
  photographic reference, since that's the throughline in the ESPN
  material found.

- **A narrative/personality layer should be optional to engage with, not a
  new mandatory chore.** FM's delegable press conferences (hand off to a
  staffer with a good Media Handling rating, or do it yourself)
  **[Reported]** is the right shape for any storyline/press feature this
  game adds: default to auto-resolved, offer manual engagement as opt-in
  depth for players who want it, consistent with the "Let the AI Pick"
  pattern the re-sign window already uses **[Codebase]**.

---

## Prioritised recommendations

| Recommendation | Why it matters | Size | Foundations already in codebase? |
|---|---|---|---|
| **Coaching staff layer**: promote coordinators to a hired/fired, player-managed role with a scheme identity (e.g., run-heavy/pass-heavy/blitz-heavy) that modifies unit performance and creates scheme-fit tension with your roster | Best-precedented gap in the genre (FOF, Gridiron GM, Gridiron Football GM, Madden 26); closes the codebase's own stated gap that coordinators only matter to AI teams | **L** | **Partial** — `coordinator.rating` already feeds `lib/sim/units.ts`; `fireStrugglingCoordinators` in `lib/season.ts` already models AI-side firing; no player-facing hire/fire/scheme UI exists |
| **Narrative/storyline engine**: thread existing news/transaction/recap data into ongoing arcs — rivalries, revenge games, streaks, milestone chases, GM-legacy narrative beats | Single most-cited driver of "why I still care about my save" across OOTP and FM research; this game has strong raw facts but no connective narrative layer | **L** | **Partial** — News Wire, `Transaction` model, and templated recap text (`lib/sim/recap.ts`) are real raw material; nothing threads them together contextually today |
| **Job security / owner expectations** for the *player's own* team, with an explicit opt-out toggle | Directly closes a documented, deliberate gap (`lib/season.ts`: "User teams are never auto-fired"); best-precedented via FHM's self-preservation rating + Sandbox-only "Cannot be fired" toggle | **M** | **Weak/none** — GM Career page has tenure/history data to build the pressure narrative on top of; no firing/pressure logic exists for the user; settings system already supports this kind of toggle pattern |
| **Wire `Player.morale` into re-sign odds and (optionally) a small performance modifier**, exposed as a qualitative read rather than a raw number | Cheapest of the five; genre precedent (OOTP mood/loyalty/greed, FM Dynamics) directly ties personality to retention and performance, not just flavor | **S/M** | **Strong** — schema field already exists, explicitly commented as an unwired placeholder; just needs real usage plumbed into `freeagency.ts`/re-sign logic |
| **Harden AI trade/contract realism**: more frequent, more varied AI-initiated trade offers (not just pick-for-pick); continue the dead-money-parity audit into any remaining asymmetries; age/need-modulated contract demands from AI-side re-signs | Most consistent cross-genre complaint (FOF trade AI, DDS:PFB contract/dead-money AI); this codebase has already found and fixed one instance of exactly this bug class twice in one day (void years, then trade-side bonus acceleration) | **S/M** | **Strong** — `lib/ai/gm.ts`'s explainable-factor valuation is already more sophisticated than what's described for either competitor; this is hardening, not a new system |
| **Hall of Fame induction as a real event/moment**, not just a stats-page entry — a dedicated induction screen/ceremony triggered on retirement of a qualifying player | Franchise history/awards/dynasty score already exist as data; genre precedent (OOTP, FHM, Basketball GM) treats induction as a *moment*, which is what creates attachment, not the underlying stat table | **S/M** | **Strong** — `FranchiseHistory`, awards, dynasty score, and retirement logic (`lib/season.ts` age-based retirement) already exist; no induction *event* exists yet |
| **Rivalry tracking**: flag division/recurring opponents as rivals, let recap/news text reference rivalry context ("their 4th straight loss to the [rival]") | Directly supports the narrative-engine recommendation above; well-precedented as part of what makes FM's Dynamics system read as alive | **S/M** | **Partial** — schedule generation and recap text generation exist; no rivalry concept or head-to-head history framing exists yet |
| **Prose-voiced scouting reports** — extend the existing templated recap-text generator's approach to scouting, so a report reads like a coach's note ("undersized but plays faster than his 40 time") rather than only a numeric range | Directly named by Gridiron Football GM as its differentiator; cheap relative to payoff since the text-generation pattern already exists in this codebase | **S** | **Strong** — `lib/sim/recap.ts` already does templated procedural text generation; `lib/scouting.ts` already has the underlying fogged-attribute data to describe |
| **Autonomous AI-vs-AI trading** in the background (two AI teams making a deal without the user involved) | Explicitly flagged in this repo's own "Known simplifications" section as a deliberate current gap; would make the league feel alive independent of user action, a documented genre want | **M/L** | **None** — explicitly documented as not implemented; would need real background AI-vs-AI negotiation logic reusing `lib/ai/gm.ts` |
| **A "Snack"-tier trend indicator** next to key hero numbers (small sparkline next to cap space, 5-game form next to win probability) | Cheap UI/UX win with a named design-pattern precedent (Bite/Snack/Meal); closes the gap between single-number heroes and full Advanced charts | **S** | **Strong** — `components/charts/` kit and underlying `lib/analytics.ts`/`lib/cap-summary.ts` data already exist; purely a presentation addition |

---

## Sources

- [Front Office Football 8 Review (PC) – Operation Sports](https://www.operationsports.com/front-office-football-8-review-pc/)
- [FOF8 Review – gmgames.org](https://gmgames.org/front-office-football-8-fof8/review/)
- [Front Office Football Eight on Steam](https://store.steampowered.com/app/547900/Front_Office_Football_Eight/)
- [FOF8 Steam discussion – Is 7 Better?](https://steamcommunity.com/app/547900/discussions/0/143388344304075047/)
- [Front Office Football Nine on Steam](https://store.steampowered.com/app/2633170/Front_Office_Football_Nine/)
- [Front Office Football Nine – Steam discussions](https://steamcommunity.com/app/2633170/discussions/)
- [Draft Day Sports: Pro Football 2025 on Steam](https://store.steampowered.com/app/3323590/Draft_Day_Sports_Pro_Football_2025/)
- [DDS: Pro Football 2025 – New Features – gmgames.org](https://gmgames.org/2024/11/06/draft-day-sports-pro-football-2025-new-features-in-the-latest-release-windows-pc/)
- [DDS: Pro Football 2023 Review – Operation Sports](https://www.operationsports.com/draft-day-sports-pro-football-2023-review-another-winner/)
- [Where DDS:PFB really shines – Steam discussion](https://steamcommunity.com/app/3323590/discussions/0/595150188903958973/)
- [Best Management Sim in 2020: Out of the Park Baseball 21 – Operation Sports](https://www.operationsports.com/best-management-sim-in-2020-out-of-the-park-baseball-21/)
- [Out of the Park Baseball 11's Storyline Engine – brian.carnell.com](https://brian.carnell.com/articles/2010/out-of-the-park-baseball-11s-storyline-engine/)
- [Out of the Park Baseball 25 Review – gamecritics.com](https://gamecritics.com/brad-bortone/out-of-the-park-baseball-25-review/)
- [Out of the Park Baseball 26 Review – Gamer Social Club](https://gamersocialclub.ca/2025/03/25/out-of-the-park-baseball-26-review/)
- [Review of Out of the Park Baseball 25 – Douglas Sun (Substack)](https://douglassun.substack.com/p/review-out-of-the-park-baseball-25)
- [Out of the Park Baseball 26 Review – newbaseballmedia.com](https://newbaseballmedia.com/out-of-the-park-baseball-ootp-26-review/)
- [Football Manager 2018's Dynamics system is a fantastic story generator – PC Gamer](https://www.pcgamer.com/football-manager-2018s-dynamics-system-is-a-fantastic-story-generator/)
- [Football Manager 2018's Dynamics lets you win or lose the dressing room – PC Gamer](https://www.pcgamer.com/football-manager-2018s-dynamics-system-lets-you-win-or-lose-the-dressing-room/)
- [Guide to Player Personalities on Football Manager – FM Scout](https://www.fmscout.com/a-guide-to-player-personalities-football-manager.html)
- [Understanding Player Personalities in Football Manager – footballmanagerblog.org](https://www.footballmanagerblog.org/2024/05/understanding-player-personalities-football-manager.html)
- [How to Improve Player's Morale & Happiness in FM – Passion4FM](https://www.passion4fm.com/how-to-improve-players-morale-happiness-in-football-manager/)
- [Franchise Hockey Manager 3: Top new features for armchair GMs – OOTP blog](https://blog.ootpdevelopments.com/franchise-hockey-manager-3-top-new-features-for-armchair-gms/)
- [Franchise Hockey Manager Job – OOTP Developments Forums](https://forums.ootpdevelopments.com/showthread.php?t=239550)
- ["NFL doesn't care" – Madden 24 franchise mode bugs – Sportskeeda](https://www.sportskeeda.com/nfl/news-madden-24-s-franchise-mode-fans-calling-league-take-stern-action-ea)
- [Franchise Mode Getting Biggest Update in Ten Years for Madden NFL 26 – Hardcore Gamer](https://hardcoregamer.com/madden-nfl-26-franchise-mode/)
- [Madden NFL 26 franchise mode – ESPN](https://africa.espn.com/gaming/story/_/id/45708826/madden-nfl-26-franchise-mode)
- [Gridiron GM – VaultSpark Studios](https://vaultsparkstudios.com/games/gridiron-gm/)
- [Gridiron Football GM – Gridiron Games](https://gridirongames.net/games/gridiron-football-gm/)
- [Why I'm building Gridiron Football GM – devlog](https://gridirongames.net/devlog/why-im-building-gridiron-football-gm/)
- [Gridiron Football GM press kit](https://gridirongames.net/press/gridiron-football-gm/)
- [Gridiron Football GM on Steam](https://store.steampowered.com/app/4757940/Gridiron_Football_GM/)
- [League creation options: challenge modes – ZenGM blog](https://zengm.com/blog/2020/06/league-creation-options/)
- [zengm-games/zengm – GitHub](https://github.com/zengm-games/zengm)
- [More draft lottery types – ZenGM blog](https://zengm.com/blog/2020/05/more-draft-lottery-types/)
- [Sports Data UX Design – SGX Studio (referenced via search synthesis; direct fetch blocked)](https://sgx.studio/sports-data-ux-design-making-complex-stats-digestible/)
- [Dashboard Design in the Sports Industry – Lollypop Design (referenced via search synthesis; direct fetch blocked)](https://lollypop.design/blog/2019/november/dashboard-design-in-the-sports-industry/)
- [Information Hierarchy in Dashboards – Cluster](https://clusterdesign.io/information-hierarchy-in-dashboards/)
- [ESPN unites NFL programming under bold new look — NewscastStudio](https://www.newscaststudio.com/2019/09/04/espn-nfl-new-graphics/)
- [ESPN Creative Director Tim O'Shaughnessy reflects on live sports graphics design – SVG](https://www.sportsvideo.org/2025/02/24/espn-creative-director-tim-oshaughnessy-reflects-on-an-exciting-year-of-live-sports-graphics-design/)

---

### What I could not verify

- Exact current Steam review percentages/counts for FOF9 and DDS:PFB 2025
  are from search-tool paraphrase, not a direct read of the review page —
  treat the specific numbers as approximate, not exact at time of writing.
- I could not find any football-specific (not soccer) GM sim with a press
  conference/media-narrative system as developed as Football Manager's —
  several searches for this came back empty, so the recommendation to add
  one is based on cross-genre precedent (FM) plus this game's own existing
  News Wire as raw material, not on a football-specific example that's
  already proven it works.
- I could not independently confirm the specific Steam review percentage
  breakdowns or DDS:PFB dead-money bug details beyond what the search
  tool's snippets reported — no primary Steam review text was read
  directly (WebFetch blocked).
