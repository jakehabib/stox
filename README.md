# Dynasty GM Football

A single-player American football front-office simulator. Built with **Next.js
14 (App Router, TypeScript)**, **Tailwind CSS**, and **Prisma + Postgres**.

You are the GM of one franchise in a 32-team league of fictional teams and
generated players (no real NFL data/names anywhere). Every core system from
the design doc is implemented end-to-end: player generation, scouting
fog-of-war, the sim engine, salary cap, free agency, trades, the draft, and
the full season/offseason cycle.

<p align="center">
  <img src="docs/screenshots/dashboard.png" width="49%" alt="Team Dashboard" />
  <img src="docs/screenshots/draft-hub.png" width="49%" alt="Draft Hub with Class Outlook and consensus big board" />
  <img src="docs/screenshots/player-card.png" width="49%" alt="Player card with College Profile" />
  <img src="docs/screenshots/cap-advanced.png" width="49%" alt="Cap page, Advanced view" />
</p>
<p align="center">
  <img src="docs/screenshots/stats-myteam.png" width="70%" alt="Stats page, My Team / Advanced view" />
</p>

> **Balance disclaimer:** Every number that the design doc marked "tunable" —
> position weights, RNG spreads, market-value curves, AI valuation formulas,
> the draft pick chart, etc. — is a first-pass placeholder. They're all
> centralized in **`lib/tuning.ts`** (plus a few adjacent files: `lib/cap.ts`
> for market value, `lib/ai/gm.ts` for AI valuation) and commented with
> `[TUNE]`, `[SAFE]`, or `[FRAGILE]` tags so they're easy to find and adjust
> once you've playtested.

## Play it now (no coding required)

This repository is private, so the one-click deploy button won't work here —
use Vercel's normal import flow instead:

1. Go to [vercel.com/new](https://vercel.com/new) and **sign in with GitHub**
   if it asks (free, one click — use the same GitHub account this repo lives
   in).
2. If `stox` isn't in the repo list, click **Adjust GitHub App Permissions**
   and grant Vercel access to it (all repos, or just this one).
3. Click **Import** next to `stox`. The app lives at the repo root, so you
   don't need to change anything on the configuration screen — just click
   **Deploy**.
4. The first deploy will likely **fail** — that's expected, not a real error.
   It fails because the app needs a database and doesn't have one yet:
   - Open the new project in Vercel, go to the **Storage** tab.
   - Click **Create Database** (or **Browse Marketplace**) → choose **Neon**
     (Postgres) → pick the free plan → **Connect** it to this project.
     This automatically fills in the database connection the app needs — you
     don't have to copy/paste anything.
   - Go to the **Deployments** tab and click **Redeploy** on the latest one.
5. Once that build finishes (green checkmark), click **Visit** — that link is
   your game. Bookmark it; it stays live and keeps your save, and every
   future push to this branch redeploys it automatically.

## Running it locally (for developers)

This needs a Postgres database reachable from your machine — a free one from
[neon.com](https://neon.com) works, or a local Postgres install. Put its
connection string in `.env` as `DATABASE_URL`, then:

```bash
npm install          # also runs `prisma generate` via postinstall
npm run db:push       # creates all tables from the schema
npm run dev            # http://localhost:3001
```

Other useful scripts:

```bash
npm run db:studio    # Prisma Studio — browse/edit the raw database
npm run build         # production build (generates the client, syncs the
                       # schema, and runs `next build` — this is exactly
                       # what Vercel runs on every deploy)
```

## First things to click through

1. **Home page** — click **Create League**. Pick a team, a start type
   (randomized 32 rosters, or a blank-roster **Fantasy Draft**), a cap mode,
   and a difficulty. League generation takes about a second (32 teams,
   ~1,500 players, contracts, a full schedule, and your starting scouting
   book all get created at once).
2. **Team Dashboard** — your record, cap space, roster needs (bar chart by
   position), recent results, the league transaction wire, and — whenever
   the league is somewhere in the offseason — an **Offseason Roadmap**
   widget showing all five stages (Housekeeping → Re-sign → Free Agency →
   Draft → New Season) with the current one highlighted, so it's never
   ambiguous whether a free agency window or draft period is open.
3. **Roster** — every player on your team, with scouted rating **ranges**
   instead of hard numbers (unless you disable scouting in Settings), plus
   a **Fill Roster** action that auto-signs free agents for understaffed
   positions through the same cap-enforcing signing path as everywhere
   else. Click a name to open their **Player** page — attribute-by-attribute
   scouted ranges, a role/potential **label** (Prospect → Star → Franchise →
   Generational, reading off the same fogged data so it can be wrong until
   scouting narrows in), contract details, a **Release** button, and a
   **Scout** button to spend weekly scouting points narrowing the range. A
   draft prospect's card also shows a **College Profile**: a full college
   season box score (revealed progressively across the NFL season) plus
   combine/pro-day testing and a competition-strength grade.
4. **Depth Chart** — reorder each position group with the ▲/▼ buttons; this
   is the exact order the sim engine snaps to on game day. "Auto-Sort by
   Rating" resets it to true-value order.
5. Hit **Advance ▸** in the top-right repeatedly to sim games — the dropdown
   only ever offers targets that make sense for the phase you're actually
   in (no more "Advance to Midseason" once you're already in the
   offseason), and disappears entirely on a gated phase (Re-sign, Draft)
   where there's nothing valid to multi-advance into. Click any final score
   to read the generated **recap** and box score.
6. **Free Agency** / **Trade** / **Draft** pages work whenever the league
   phase allows it (the top bar always shows the current phase — Regular
   Season, Free Agency, Draft, etc.). The season loop is: Regular Season →
   Playoffs → Offseason (progression, aging, new draft class) → Re-sign
   window → Free Agency (4 weeks) → Rookie Draft → back to Preseason.
   - **Re-sign** shows your own expiring contracts starting the week their
     final contract year begins — not just once the offseason RESIGN phase
     opens — with a **Not Re-sign** action (confirm, then release) and a
     **Let the AI Pick** button that delegates every pending decision to
     the same logic AI teams use for their own players.
   - **Draft** is a year-round scouting hub, not just a DRAFT-phase screen —
     the incoming class exists from week 1 and is fully browsable
     (sortable, filterable, ★ shortlist-able) all season. It carries a
     **Class Outlook** banner ("Loaded at LB, DB — thin at QB") since each
     year's class now has real position-strength personality instead of
     being an identical flat random sample, and a position-weighted
     **consensus big board** (#1 / Top 5 / Top 10 / Top 32 badges, round 1
     only) alongside per-player Prospect/Star/Franchise/Generational tags.
     Live draft day paces one AI pick at a time (pausable) instead of
     silently batch-skipping.
   - **Trade** value is driven by real positional economics, not raw
     rating — see `lib/ai/gm.ts` below.
7. **Cap** and **Stats** pages each have a **Basic / Advanced** toggle. Advanced
   adds real charts (cap allocation by position, multi-year cap outlook,
   cap hit vs. market value, your spend vs. the league average; passer
   rating leaderboard, an offense-vs-defense quadrant, your team's scoring
   trend). Stats also has a **League / My Team** toggle — My Team swaps the
   league leaderboards for one full-roster table of position-shaped
   efficiency stats (completion %, Y/A, YPC, catch %, tackle+sack "impact,"
   INT+PD "playmaker" score, etc.) for every player you have that's
   recorded a stat.
8. **Settings** covers every option from the design doc's settings screen —
   cap mode, difficulty, scouting toggles, injury/progression rates, trade
   rules, sim variance, recap verbosity, and more.

## Where things live

- `prisma/schema.prisma` — full data model (teams, players with true vs.
  scouted values plus college/combine profile JSON, contracts/cap, draft
  picks, scouts, coordinators, league state, settings blob)
- `lib/tuning.ts` — **every balance constant in the game**, grouped by
  system — including `TRADE_VALUE`/`TRADE_VALUE_TIER` (positional trade
  economics) and `AI.DRAFT_POSITION_VALUE` (draft-specific position
  premium, a deliberately separate curve from trade value)
- `lib/gen/` — player generation, name/team pools, league creation;
  `lib/gen/prospectProfile.ts` generates each rookie's college season,
  combine/pro-day testing, competition grade, and each class's
  position-strength bias
- `lib/scouting.ts` — the fog-of-war system (section 6): observed values,
  error bands by attribute difficulty, confidence growth
- `lib/cap.ts`, `lib/cap-summary.ts` — salary cap in Realistic / Simplified /
  Off modes, market-value curve, rookie scale, franchise tag
- `lib/sim/` — unit ratings (`units.ts`), drive-based game resolution
  (`engine.ts`), recap text generation (`recap.ts`)
- `lib/ai/gm.ts` — the shared AI GM brain used by free agency, trades, and
  the draft: needs, league scarcity, personality profile, and
  `playerValueDetailed()` — trade/asset value from position-tier
  replacement-level curves, position-specific age arcs, contract surplus,
  bounded team-need and scarcity multipliers, and a hard per-tier ceiling
  (see `scripts/benchmarkTradeValue.ts` for the full scenario coverage)
- `lib/freeagency.ts`, `lib/trade.ts`, `lib/draft.ts` — the three acquisition
  systems, each with a user-facing path and an AI-vs-AI/AI-vs-user path
- `lib/season.ts` — the season/offseason phase machine and `advanceWeek`,
  the single entry point that moves league time forward
- `app/league/[id]/` — every screen (dashboard, roster, player, depth chart,
  free agency, trade, draft, cap sheet, stats, standings, schedule, game
  recap, settings)
- `app/actions/` — server actions backing every mutation (sign, cut, trade,
  draft, scout, advance week, settings)
- `components/charts/` — the small shared chart kit (bar/line/scatter) used
  by the Cap and Stats Advanced views
- `scripts/benchmarkTradeValue.ts` — permanent, framework-free benchmark
  suite for trade valuation (`npx tsx scripts/benchmarkTradeValue.ts`);
  `scripts/simHealth.ts` — the invariant-checking harness (see
  `GAME_INVARIANTS.md`)

## Design principles (standing, not up for re-litigation)

These came from the app owner directly and they override any local design
argument — including a well-reasoned one. If a change conflicts with
something here, the principle wins and the change is wrong.

1. **It must feel like a game, not a spreadsheet.** *"we dont want this to
   just feel like text — the avatars and graphics add SO much to the feel of
   the game."* and *"it needs to be and feel alive."* Information density is
   not the goal. A screen that is nothing but figures has failed, however
   efficiently it packs them.

2. **Avatars, team logos and colour are identity, not ornament.** They are
   what make a name read as a *player* rather than a row key, and a
   three-letter abbreviation read as a *franchise*. Never remove them to save
   vertical space. If a row needs to be taller to carry an identity, the row
   gets taller.

3. **Rating colour is meaningful above ~80.** *"i also love the rating
   colors. They should be meaningful after ~OVR 80 IMO."* Below that band,
   stay neutral — a 62 and a 74 are both "a guy" and painting them is noise.
   From ~80 up, real distinguishable steps so an 81, an 88 and a 94 are
   apart at a glance, climbing toward elite.

4. **Colour is never the only channel.** Every coloured rating step also
   carries a glyph, and adjacent steps must survive a colourblind-separation
   check (`scripts/validate_palette.js` from the `dataviz` skill) — run it,
   don't eyeball it. This one does *not* bend to preference: it is the reason
   the earlier rainbow ramp was replaced rather than merely restyled.

5. **A column with the same value on every row carries no information.** This
   is the one part of the density argument that was right. The "Active" pill
   on 27 of 28 roster rows and "Unevaluated" on 300 of 300 draft rows are
   noise; the avatar beside them is not. Cutting the former is not licence to
   cut the latter.

6. **No lying metrics.** A number shown to the player must be the number the
   system actually used. This has been a recurring bug class here (a ledger
   reading "Trades 0" beside a tile reading "Trades Made 7"), so it is
   written down: if you display a rank, it must be the rank of the grade you
   displayed.

## Known simplifications (documented, not bugs)

- Negotiation PATIENCE is per-session, not stored. Each offer a player turns
  down costs a pip (two for a lowball), decided and charged server-side — but
  the counter itself lives in the panel's React state, so reloading the page
  reopens talks with a full meter. Persisting it would need a new column
  (a patience counter per player *per negotiating team*), and it would buy
  less than it looks: the reservation price is seeded off the matchup and the
  league year, so a reload hands you back the same man wanting the same money,
  not a fresh roll. The consequence that DOES persist is the one that matters
  — run out of patience on a contested free agent and he signs with the team
  that was bidding against you, which is a real transaction and permanent.
- AI teams don't carry their own `ScoutingReport` rows — they evaluate free
  agents/trades/draft prospects off true ratings. Modeling AI fog-of-war
  would 32x the scouting data for no gameplay benefit in a single-player game.
- The re-sign window doesn't give the original team an *exclusive*
  negotiating period before a player hits the open market — expiring
  contracts go straight to the free agent pool, which anyone (including
  you) can then sign from. (Visibility is earlier than the real deadline,
  per above — it's specifically the exclusivity that isn't modeled.)
- There's no autonomous AI-vs-AI trading — AI teams only trade with the
  user (via the trade screen, or an unsolicited offer the AI proposes).
  Two AI teams never make a deal with each other in the background.
- College stats/combine testing are procedurally generated at class
  creation, not the output of an actually-simulated college season — see
  the header comment in `lib/gen/prospectProfile.ts` for exactly what's
  tuned to real NCAA norms (13-game season, the real NCAA passer
  efficiency formula) versus placeholder.
- `showAdvancedStats` and `autoAdvanceWeeks` settings are stored and shown in
  the Settings screen but don't yet gate any behavior — flagged as
  "STORED-ONLY" right in the settings UI.
- Stat lines are allocated top-down from team drive totals (so the score and
  box score can never disagree) rather than simulated play-by-play.

## Changelog

Every notable change lands here with the commit it shipped in, so there's
always a plain-English trail back to "what did this look like before." To
undo anything, ask to revert to a commit below (or the app owner can do it
directly: `git revert <hash>`, or check out an earlier commit — nothing is
ever force-pushed over, so every state below still exists in git history).

- **2026-08-20 — Visual redesign kickoff.** Starting a staged visual
  redesign (design tokens → dashboard → player page → rest of the app) to
  move away from the generic dark-dashboard look. Game logic, simulation,
  and database behavior are explicitly out of scope for this effort.
  Checkpoint commit — the last one *before* any redesign changes —
  is `529cdff` ("Fix GM Career page missing the current season's games").
  If a redesign stage doesn't land well, this is the commit to come back to.
- **2026-08-20 — Redesign Stage 1: design tokens.** New token layer
  (color roles, a big-number type scale, section/panel layout primitives,
  a `--team-accent` variable) plus 14 reusable presentational components
  under `components/ds/`, all reviewable at `/design-system` — a
  developer-only route with no nav link, not real game data. Nothing in
  production pages changed yet. Commit `6b79705`.
- **2026-08-20 — Redesign Stage 1 refinement: distinctiveness pass.**
  Follow-up to the token pass, aimed specifically at not reading as
  generic: a proprietary notched-corner "rating chip" shape for OVR/
  potential instead of a plain rounded tile; stronger team-color
  presence (a two-tone header ribbon, team-colored record numbers,
  per-team-colored matchup names); a more dramatic Draft Day "On The
  Clock" state (broadcast-style status tag, scoreboard-style clock
  digits); an editorial League Wire treatment (colored category kickers,
  a bigger lead story); and a real hand-drawn line-icon set
  (`components/ds/icons.tsx`) replacing every emoji/text-glyph icon.
  Still on `/design-system` only.
- **2026-08-20 — Redesign: Dashboard, Player Page, and Live Draft mockups.**
  Full-page compositions assembled from the components above, still mock
  data only, at `/design-system/dashboard`, `/design-system/player`, and
  `/design-system/draft` — a preview of what those real pages could look
  like before any production page is touched. Added four more reusable
  components along the way: `FrontOfficeBrief` (the game's core
  differentiator gets its own visual treatment, not a plain gray list),
  `RosterNeeds`, `StandingsTable`, and `RecentPicksFeed`. Caught and fixed
  two real layout bugs in review: `MatchupCard` overflowed/clipped a
  team's logo when squeezed into a two-column layout with a score shown,
  and `RecentPicksFeed`'s round/pick label wrapped to two lines in a
  narrow sidebar. Also removed a duplicated OVR/Potential display on the
  player mockup — the hero already shows it, so a second panel just
  repeating it added nothing.
- **2026-08-20 — Redesign rework: richer heroes, real actions, fixed a
  systemic contrast bug.** Reworked all three mockups after side-by-side
  reference screenshots showed the first pass was too passive. Changes:
  `TeamHeader` now embeds the next matchup + win probability and a
  tenure/scenario line instead of a separate matchup card; `PlayerHero`
  got a bigger "trading card" treatment (photo-tinted panel, position-
  specific key stats, a bolder filled rating chip) with attributes moved
  to their own section (was duplicated with the page's Ratings section);
  `OnTheClock` became a horizontal control-panel layout with real Make
  Selection/Pause buttons and a stadium-light texture; `FrontOfficeBrief`
  and the new `PickTradeOffer` got real per-item actions (Sign a CB,
  Accept/Counter/Decline) instead of a chevron implying "go elsewhere";
  `NewsRow` gained a metric slot so a story carries its own payoff, not
  just a timestamp; `StandingsTable` gained rank-change deltas and a
  colored "last five" form guide; added position-group color coding
  (`positionColor.ts`, reusing the already-CVD-validated viz palette) and
  a `ScoutsRoom` advisor-quote component. Fixed two real bugs caught in
  review: a win-probability pill that read as clipped by the corner
  watermark (wasn't actually clipped — DOM measurement confirmed — but
  was unreadable against it, fixed by giving that row a solid backing);
  and, more importantly, a **systemic contrast bug** — several curated
  team colors (see `lib/gen/teamLogo.ts`) are deliberately dark for use as
  fills/borders, but multiple components were using that same dark color
  as small TEXT on the near-black background. Fixed with a new
  `--team-text` CSS token (a lightened `color-mix()` of `--team-accent`)
  used everywhere team color renders as text, defined once in
  `globals.css` so every current and future component gets it by
  switching one variable. Also fixed a real prospect-row layout
  regression the Draft rework introduced (names truncating mid-word once
  a Draft button was added) by giving the name its own line instead of
  sharing it with status pills.
- **2026-08-20 — Redesign Stage 2: the real Dashboard.** First production
  page — `app/league/[id]/page.tsx` now uses the redesigned components
  instead of the mockup. Checkpoint before this change: `e002cb2`. Real
  data wiring, not just a visual swap:
  - `TeamHeader` shows real division rank, tenure (reusing
    `buildGmCareerSummary` from the GM Career page), and the actual next
    opponent with a new **display-only** win-probability estimate
    (`lib/winProbability.ts` — never touches the sim engine, which plays
    every game out on its own regardless of this number).
  - `lib/frontOffice.ts`'s `BriefItem` now carries a real headline/detail/
    action/href instead of one sentence, so the brief's buttons actually
    navigate (Browse Free Agents, Open Extension, Explore Trade, Open
    Cap, Review Offers) — every underlying threshold/decision is
    unchanged, only how the text is composed.
  - League Wire merges real `Transaction` rows with real game recaps
    (reusing the `Game.recap` text already generated at sim time) into
    one feed, sorted by recency with the actual result outranking
    same-week trivia news — no new schema.
  - Division standings' "last five" form guide is real `Game` history,
    not synthetic.
  - Deliberately **not** implemented (would require real new logic, not
    presentation): playoff clinch-scenario math, and week-over-week
    standings rank deltas (no historical snapshot exists to diff
    against) — `StandingsTable` just shows "—" for those today.
  - Caught two real bugs in review before shipping: transaction team
    logos were only resolved against the 4-team division (any other
    team's news showed a blank placeholder) — fixed by querying exactly
    the teams referenced in that batch of transactions; and the real
    game recap was getting crowded out of the League Wire's top 6 by
    generic stat-leader trivia on a same-week tie — fixed by giving game
    results sort priority over news on ties, and marking the top story
    `featured`.
  - Verified against three real leagues in different phases (mid-season,
    playoff push, post-draft/offseason with no next game scheduled) via
    Playwright, watching the browser console for client errors on each.
- **2026-08-20 — Wired up the two deliberately-skipped Dashboard features.**
  Both genuinely needed new logic, not just presentation — built and
  verified them properly rather than faking the data:
  - `lib/clinchScenario.ts` — real mathematical division/playoff
    clinch and elimination detection. Runs the *exact same* seeding
    algorithm `lib/season.ts`'s `seedPlayoffs()` uses (a deliberate,
    documented duplicate of its private `byStanding` comparator — keep
    them in sync) against a worst-case-for-this-team /
    best-case-for-everyone-else projection of the remaining schedule.
    That's the standard definition of "clinched" in real sports, not a
    heuristic. Verified against synthetic edge cases (a 17-0 team, a
    0-17 team, week 1) and against every real saved league with a
    won-or-lost scenario — output matched hand-checked math in every
    case. Known simplification: future games project win/loss counts
    only, not point differential, matching the tiebreaker simplification
    `byStanding` already accepts.
  - `lib/standingsTrend.ts` — real week-over-week rank deltas, computed
    from existing `Game` history (no snapshot table) by finding each
    division team's most recent played game and subtracting its result
    back out to reconstruct last week's order. Verified the deltas are
    zero-sum within a division (a rank permutation can't gain or lose
    positions net) across every real league with a live race, and
    visually confirmed the ▲/▼ arrows on a league with actual movement.
  - Both surface on the real Dashboard hero/standings now — `TeamHeader`
    got a `tone: 'good' | 'bad'` scenario tag instead of always-gold.
- **2026-08-20 — Redesign Stage 3: the real Player Page.** Restyled the
  container/hero around every existing interactive piece — contract
  extension/restructure/cut, the sign-offer form, the scout button, the
  fog-of-war reveal logic — without touching any of their behavior. The
  hero shows a filled `RatingBadge` when the OVR is revealed, or a
  `ScoutingRange` when it isn't, exactly mirroring the real
  `view.revealed` branch (same pattern the draft-prospect mockup already
  established) — potential is always a range regardless, per
  `ScoutedPlayerView`'s own contract. Added a small "key stats" line in
  the hero (top 3 season stat entries) — additive, doesn't remove the
  full Season/Career Stats sections below. Verified against a revealed
  own-roster player and an unrevealed opposing-roster player in the same
  real league, confirming both branches render correctly and every
  button (extension, restructure, release, sign offer, scout/focus
  report) still works.
- **2026-08-20 — Redesign Stage 4: Roster + Depth Chart.** Checkpoint
  before this change: `4b0837a`. Smaller, presentation-only pass on two
  pages: the Roster table's position column now uses
  `positionBadgeClass` (the same categorical position-group colors as
  everywhere else) instead of a plain gray monospace label, and its OVR
  column uses the `.stat-value` display-number treatment. The Depth
  Chart's per-position group card switched from `.card` to the denser
  `.panel` styling and its position header is now colorized the same
  way. No data-fetching, sorting, or drag/reorder logic touched —
  `DepthChartGroup`'s `move()` reorder function and
  `setDepthChartAction` call are byte-for-byte unchanged. Verified via
  Playwright screenshots of both pages against real roster data (39
  players across every position group) and by exercising the depth
  chart's actual up/down reorder buttons end-to-end (swap persisted,
  then reverted), confirming zero console errors throughout.
- **2026-08-20 — Redesign Stage 5: Draft Hub + Draft Day.** Checkpoint
  before this change: `cad04f6`. One page serves two very different
  moments — the year-round scouting hub (browsing the ~300-deep class
  before the draft opens) and the live draft event — so it got two
  treatments:
  - **Live draft**: replaced the plain "On the clock" pill with a
    team-tinted hero panel (radial gradient, watermark team logo,
    stadium-light texture — the same "event" language as the
    `/design-system` Draft Day mockup), showing round/pick/team and
    embedding the real `LiveDraftTicker` unchanged (pause, fast-forward,
    last-pick readout, the actual AI-pick-tick timer). Deliberately did
    *not* reuse the mockup `OnTheClock` component as-is — it assumed a
    countdown clock the real page has no equivalent state for, so
    building a fake mm:ss timer would have shown information that isn't
    real. Kept the functional ticker instead of inventing one.
  - **Big Board table** (used in both states): position column now uses
    `positionBadgeClass`, OVR/rank columns use `.stat-value`, the table
    wrapper switched from `.card` to `.panel`, and the position-filter
    pills moved into a `SectionHeading` action slot instead of a bare
    row. Upcoming Picks strip and Recent Picks list switched to `.panel`
    for the denser data-block look, matching Roster/Depth Chart.
  - No changes to sorting, filtering, shortlist, big-board consensus
    ranking, or the pick/draft server actions — every `SortKey`,
    `sortHref`/`posHref`/`shortlistHref` builder, and the `DraftPickButton`/
    `ShortlistStar`/`LiveDraftTicker` prop wiring is untouched.
  - Verified against a real league mid-live-draft (round 1, pick 21,
    user on the clock) and a real league still in-season with the
    scouting hub showing a full 300-player class, both via Playwright
    with zero console errors.
- **2026-08-20 — Redesign Stage 6: Trade Center + Free Agency.**
  Checkpoint before this change: `69570f8`. Both pages are dense
  data-browsing surfaces, so this was the same treatment as
  Roster/Draft: `positionBadgeClass` on every position label,
  `.stat-value` on every OVR figure and the trade builder's live
  cap-space-after readout, and `.card` → `.panel` on every data block
  (the two `TeamPanel` roster/picks columns in the trade builder, the
  deadline-passed banner, the "best trade partners" callout, the trade
  summary bar, the trade-evaluation result panel, pending AI offers,
  trade retrospectives, and the free agent table). No changes to any
  trade math, evaluation logic, server actions, sort/filter behavior,
  or the pending-offer accept/decline/review flow — every prop and
  handler in `TradeBuilder`, `PendingTradeOffers`, and
  `TradeRetrospectives` is untouched, only className/JSX structure.
  Verified against a real league with a pending AI trade offer, an
  expired trade deadline banner, and a 100-player free agent board, via
  Playwright with zero console errors.
- **2026-08-20 — Redesign Stage 7: Cap.** Checkpoint before this change:
  `382c893`. Started with the same restrained Roster/Trade treatment
  (`.card`→`.panel`, `positionBadgeClass`, `.stat-value` on the OVR
  column) but a user review of the first pass correctly flagged that,
  next to the hero-panel pages, it read as barely changed — the Cap
  page's summary block genuinely deserved a real focal moment the way
  Dashboard/Player/Draft got one, not just quieter borders. Reworked
  the top cap-usage block into a team-tinted hero (radial gradient,
  watermark team logo, stadium-light texture — the same device as
  Draft Day's "On The Clock") with cap space as a single large
  `stat-value` figure in `--team-text`, the usage bar and Active
  Salary/Dead Money/Mode detail underneath. The four Advanced-view
  chart panels, the Contracts table, and the Dead Money list kept the
  quieter `.panel` treatment — they're data blocks, not the page's one
  focal number. No changes to any cap math, sort logic, or the
  Basic/Advanced toggle. Verified against a real league's Basic and
  Advanced views via Playwright with zero console errors.
- **2026-08-20 — Redesign Stage 8: consolidated nav shell, League Wire
  ticker, Standings/Schedule, and a Free Agency/Depth Chart depth
  pass.** Checkpoint before this change: `973abab`. A user review of
  the Cap/Free Agency/Depth Chart pages, plus reference screenshots
  from another design (explicitly given as inspiration, not a spec to
  copy 1:1), triggered a broader pass than a single-page stage:
  - **Consolidated top nav** (`components/LeagueNav.tsx`) — the old
    15-item flat tab bar is now six categories (Home, Team, Market,
    Draft, League, GM Career, System) with a second-tier sub-nav for
    whichever category is active. Every real destination from the old
    bar still exists at the same URL; nothing was removed or renamed,
    only regrouped. GM Career got promoted to its own top-level
    category rather than nesting under Team, per a direct ask mid-work.
  - **League Wire ticker** (`components/ds/LeagueWireTicker.tsx`) — a
    continuously-scrolling strip of the league's most recent
    transactions, above the header on every league page. Deliberately
    passive/ambient only, per explicit instruction: it shows real
    `Transaction` headlines (already-happened facts — trades, signings,
    injuries, stat-leader trivia), colored by the same category
    vocabulary as the News page, and never anything the player needs
    to reliably see or act on (cap space, alerts, and roster needs stay
    in the static header/Front Office Brief, not the ticker). Pauses on
    hover so a headline can be read; holds still under
    `prefers-reduced-motion`.
  - **Free Agency** got a real hero: a team-tinted cap-space strip plus
    a "Top Available" spotlight (the single best free agent on the
    market by rating, independent of whatever position filter is
    active) with its own scouted-OVR badge and a Negotiate action —
    not just a recolored table.
  - **Depth Chart** got a team-tinted masthead (team name, group count,
    and a real "N positions with no backup" callout computed from
    actual roster depth — not a fabricated stat) and the starter row in
    each position group now gets a team-accent left border instead of
    a generic gray highlight.
  - **Standings** now wires up real week-over-week rank deltas for
    every division (reusing `computeRankDeltas`, previously only used
    on the Dashboard's own division), switched to `.panel`, and
    colorized W/L.
  - **Schedule** now renders each matchup with the `MatchupCard`
    component instead of a plain one-line row — team records, real
    per-side scores, split team-color identity bar. Dropped from a
    3-column to a 2-column grid after review showed longer city names
    (San Francisco, Kansas City) truncating awkwardly at 3 columns.
  - **Every remaining page title** switched from the plain
    `text-2xl font-semibold` to the same big condensed display
    treatment already used in every hero panel this stage
    (`font-display font-extrabold text-3xl uppercase tracking-wide`),
    so page identity reads with real weight everywhere, not just on
    hero-panel pages.
  - No changes to trade/cap/scouting math, sort/filter logic, or any
    server action. Verified every touched route (Dashboard, Team
    sub-nav, Market sub-nav, League sub-nav, GM Career, Trade, Free
    Agency, Depth Chart, Schedule) via Playwright, including confirming
    the ticker's marquee animation itself (not just its static layout)
    causes zero console errors and pauses correctly under
    `prefers-reduced-motion`.
- **2026-08-21 — Redesign Stage 9: Stats, News, History, GM Career,
  Settings.** Checkpoint before this change: `1053772`. The last of the
  league pages, brought to the same bar as the rest:
  - **Stats** — leader tables switched to `.panel`, every leader's
    headline number now uses `.stat-value`, position labels use
    `positionBadgeClass` (both in the league-leader lists and the My
    Team roster stat line), and point-differential in Team Stats reads
    as a real signed display number. The Advanced-view chart panels
    moved to `.panel` too.
  - **News** — rebuilt each row into an editorial dispatch: a colored
    category kicker above the headline (reusing the existing per-type
    color map rather than a new one), the headline in the display face,
    detail beneath, and the year/week as a quiet monospace byline —
    instead of a plain line of text with a pill floating on the right.
  - **History** — the selected franchise's block became a team-tinted
    hero (watermark logo, team name in `--team-text`); Dynasty Score,
    the record tables, and Award Winners moved to `.panel`, and
    "Franchise History" picked up the display-face heading.
  - **GM Career** — the plain logo+title row became a team-tinted hero
    panel naming the franchise, with tenure underneath; badges, cap
    management, best season, and the awards table moved to `.panel`,
    and average dead money reads as a `.stat-value` figure.
  - **Settings** — form sections moved to `.panel` with `label-sm`
    section headers.
  - No changes to any stat math (passer rating, dynasty score, GM
    career aggregation all untouched), the news type filter, the
    history team selector, or the settings form action. Verified all
    five routes plus the Stats Advanced view via Playwright with zero
    console errors.
- **2026-08-21 — Design review fixes + real analytics in the Advanced
  views.** Checkpoint before this change: `5d9fdb2`. A full read-through
  of the app as a player would see it turned up several real problems,
  and the Advanced views were asked to become "a nerd's paradise":
  - **Fixed: two need tiers rendered the same color.** `needSeverity()`
    in `lib/ai/gm.ts` returned `text-warn` for *both* "High" and
    "Moderate", so the Dashboard's Roster Needs bars showed two
    genuinely different severities as visually identical. Moderate now
    gets its own color. This function is display-only — it returns a
    label and a Tailwind class and never feeds an AI decision (the raw
    0..1 score does that), so no game behavior changed; a comment on it
    now says so.
  - **Fixed: Re-sign page.** Every row repeated the same full sentence
    ("final year, expires after this season") — replaced with a compact
    Walk Year / Expired pill, so the row carries the same information
    without the wall of duplicated text. Positions colorized, OVR uses
    `.stat-value`, rows moved to `.panel`, and the cap-space strip now
    shows cap space as a real figure plus how many contracts are
    actually awaiting a decision.
  - **Fixed: long city names wrapped to two lines** in the Dashboard
    standings table ("New Orleans" broke mid-name).
  - **Fixed: the ticker duplicated the Dashboard's League Wire.** Both
    were showing the same stat-leader trivia. The ticker now carries
    only real breaking events (trades, signings, injuries, draft picks,
    firings, awards, championships) and excludes the NEWS/DEV_MILESTONE
    trivia the Wire already covers. Injuries outnumber every other
    event type by an order of magnitude, so a plain "most recent 14"
    was a wall of identical injury lines — it now round-robins across
    categories so the strip reads like a real wire.
  - **New: `lib/analytics.ts`** — display-only derivations, documented
    as never feeding the sim or the AI:
    - **Pythagorean expectation** with the football-tuned 2.37 exponent
      (not baseball's 2), plus a **luck** figure (actual wins minus
      expected). Verified: equal points-for/against returns exactly
      .500, dominant/terrible cases are symmetric, and across a real
      32-team league the luck column sums to −0.6 (≈0, as it must) with
      total expected wins landing on the correct 256 for a 16-game
      slate.
    - **Strength of schedule** — opponents' combined win rate. Verified
      the league mean is exactly .500 (mathematically required, since
      every game contributes to both sides) with a realistic .424–.584
      spread.
    - **Cap health** — top-5 concentration, cap-*weighted* age (how old
      the money is, versus the plain roster average), share committed
      to next season, dead-money share.
    - **Contract value ranking** — surplus (market value minus cap hit)
      as ranked bargain/overpay lists.
  - **Stats → Advanced** now opens with Pythagorean W-L, luck, point
    differential, and SOS with league rank, followed by a full league
    luck table sorted by who's been winning the close ones. Every tile
    carries a tooltip explaining how to read it.
  - **Cap → Advanced** now opens with cap-health tiles (each flagging
    amber past a meaningful threshold) and best/worst contract-value
    lists linking straight to the player, above the existing charts.
    League spend rank verified against a direct positional computation
    on real data (28th of 32, $172.8M–$227.8M spread — exact match).
- **2026-08-21 — Redesign Stage 10: the landing / league-creation page.**
  Checkpoint before this change: `7944fe8`. The last page still on the
  old look. It now opens with a real masthead — the game's own name at
  full display scale over a yard-line texture, a tagline, and a Create
  League call to action — instead of a plain "Your leagues" heading.
  Saved franchises moved from cramped three-across cards to full-width
  rows carrying a team-colored left edge, the franchise name at display
  weight, and season/week/phase/record on one line. The league name
  leads each row as an eyebrow above the franchise: with several saves
  it's the only thing that tells them apart (the same franchise can be
  picked more than once), and it was previously buried at the end of
  the meta line in the smallest text on the row. The create-league form
  itself is unchanged in fields, order, defaults, or its server action
  — only its container styling and an anchor target from the hero CTA.
- **2026-08-21 — Fixed: void years were free cap space.** Checkpoint
  before this change: `3867d4e`. **This is a game-balance change, not a
  visual one** — it makes the void-years slider a real tradeoff, and it
  affects existing saves. Void years widen the signing-bonus proration
  divisor, which lowers the cap hit during the real contract years and
  strands the rest of the bonus past the deal's end. In real football
  that stranded proration accelerates onto the cap the moment the deal
  expires — void years are borrowing against the future. The game never
  charged it: `releaseUnresignedExpiringContracts` deleted the contract
  outright, and the *only* `capCharge.create` in the codebase was in
  `cutPlayer`. So maxing the slider and letting the deal run to term
  cost nothing, and the only way to ever pay was cutting the player
  early — backwards. Expiry now raises a "Void years — <player>" cap
  charge for the uncharged remainder. The math itself was already
  correct and is unchanged (proration divides by `years + voidYears`,
  capped at the real-world 5-year maximum; a 4-year deal with +3 void
  years correctly prorates over 5, not 7). Verified across five
  contract shapes that the stranded figure is exact and that
  charged-during-deal + stranded equals the full signing bonus to the
  dollar in every case. Known remaining gap, deliberately left alone
  for now: a **trade** still doesn't accelerate bonus onto the team
  giving the player up (`lib/trade.ts` just reassigns `contract.teamId`),
  so dumping a bonus-heavy contract is still a way to escape it.
- **2026-08-21 — Player card rebuild, richer free-agent negotiation, and
  better portraits.** Checkpoint before this change: `7b3727a`.
  - **Player card** reworked toward a broadcast-style layout: one quiet
    meta line carries position/age/year/team/role, the name splits into
    a given-name kicker over a large surname, and the headline stats sit
    in a divided row beneath. A new **fact strip** across the bottom of
    the hero answers the money questions together — cap hit (with % of
    cap), market value (with surplus or overpay), years left, guaranteed,
    and release cost — instead of leaving them scattered down the page.
  - **Draftees get their own variant of both.** The strip becomes draft
    class / projection / 40-yard / competition tier / measurables, since
    a prospect has no contract, and the headline stats become
    position-appropriate **college production** (passing yards for a QB,
    pancakes and sacks allowed for a lineman, and so on) drawn from the
    profile that already reveals week by week. The empty NFL Season and
    Career Stats panels are now hidden for draftees — the College
    Profile is their whole record, so two panels saying "nothing yet"
    were pure noise.
  - **Combine/pro-day testing** moved out of a cramped 3×2 grid sharing
    a column into a full-width band of six equal tiles reading as one
    workout, with a note on whether the numbers came from the combine or
    a self-hosted pro day (where times tend to run fast).
  - **Free-agency negotiation now matches the extension form's depth.**
    Signing an outside free agent is the same cap decision as extending
    your own player, so it now has the same tools: front/back-load
    structuring, void years, and a full per-year cap schedule with the
    void-year dead money called out — on top of the live competing-bid
    read that's unique to the open market. `signFreeAgent` gained
    `escalation`/`voidYears` (it already stored neither), and the cap
    check now builds off the same contract shape that gets saved.
    Deliberately unchanged: the player still judges an offer on money
    and length only — structure and void years are cap accounting on
    your side of the table, not something he weighs.
  - **Player portraits** rebuilt from flat cartoon faces into actual
    portraits: a team-tinted backdrop and vignette, shoulder pads
    instead of a thin jersey V, life-proportioned heads rather than
    bobbleheads, jaw and cheek shading, and almond eyes with a real
    upper lid in place of white circles with dots. Hair styles gained
    highlight passes. Detail is kept deliberately bold — these render at
    20px in roster tables as often as 128px on a card — and verified at
    both. Still a pure function of (seed, age) with nothing stored, so
    every existing player's face changed appearance but kept its
    identity; no schema or data migration.
- **2026-08-21 — Trade bonus acceleration + one shared page masthead.**
  Checkpoint before this change: `0dfebcb`. Commit: `a13c406`.
  - **Closed the trade half of the void-year hole** (the gap the previous
    entry flagged as deliberately left open). Trading a player now
    accelerates his remaining signing-bonus proration onto the cap of
    the team giving him up, and the contract that travels carries base
    salary only — his bonus does not follow him. Dumping a bonus-heavy
    deal is no longer a way to escape it. **This is a game-balance
    change and affects existing saves.** Concretely, on a 4-year deal
    with a $20M bonus and 3 years left, trading the player away now
    *costs* $7M of cap room instead of freeing $8M, while the acquiring
    team picks him up for base salary alone — which is exactly why
    rebuilding teams absorb contracts in real football.
  - The trade builder's live "cap space after" readout was silently
    wrong under that rule: it assumed sending a player out frees his
    full cap hit. It now models the two sides asymmetrically
    (`freedIfSent` vs `addedIfAcquired`) and shows the dead money you'd
    eat as its own figure, since a single net number hides it.
  - Verified end-to-end against real saved data, not just in theory: an
    executed trade put a charge of exactly the expected amount on the
    correct team and stripped the bonus from the moved contract.
  - **New `components/ds/PageMasthead`**, applied to Roster, Depth
    Chart, Re-sign, Cap, Free Agency, Trade and the Draft hub. Seven
    pages previously introduced themselves seven different ways — some
    with a hand-rolled team-tinted hero, some with a bare `<h1>`. They
    now share one band plus a strip of that page's own real metrics.
    The hero pattern already existed and had been copy-pasted three
    times; this is that pattern pulled into one place.
  - Building those metric strips surfaced three stats that were wrong or
    meaningless, all now fixed: the draft hub's "Your Picks" queried the
    *current season* rather than the upcoming draft year (it showed 0
    while you held 7), "Scouted" counted `confidence > 0` which is true
    for every prospect in the class (so it always read 300 of 300, and
    now means high-confidence), and the class was labelled a year
    earlier than the picks you'd actually spend on it.
- **2026-08-21 — Landing / league-creation screen rebuilt.** The first
  screen anyone sees was a hero followed by a stack of four dropdowns,
  one of which was a 32-item `<select>` for the single most
  consequential choice on the page. Replaced with a two-step layout
  (`components/CreateLeagueForm.tsx`): a browsable franchise picker
  with crests, city/nickname and division — filterable by conference —
  beside a settings panel using segmented controls so every option is
  visible and comparable without opening anything. Deliberately **not**
  shown: a projected team strength. Rosters don't exist until the league
  is generated, so before that every franchise is statistically
  identical and any strength number here would be invented. Doing it
  honestly means running real generation against a seed and passing that
  same seed to `createLeague` (which already accepts one) so the preview
  and the league match — tracked as follow-up rather than faked.
- **2026-08-21 — Trade screen made properly usable.** Checkpoint before
  this change: `1decbc3`. Commit: `8f235dd`. The two roster panels were
  flat, unsorted lists of ~50 players each showing only position, OVR,
  name, age, cap hit and years — no sorting, no filtering, and no way to
  tell whether a player was actually producing without leaving the page.
  Each panel now has its own independent sort state (clickable headers,
  the same idiom the Roster page uses), a name search plus a position
  filter with a live match count and a real empty state, a compact
  season-production line per player, and a link through to the full
  player card. The row had to stop being a `<button>` — a `<Link>`
  nested inside a button is invalid HTML — so it became a
  `div[role=button]` with `tabIndex`, Enter/Space handling and
  `aria-pressed` for the selection state, and the card link stops
  propagation so opening a player doesn't also toss him into the deal.
  The asymmetric cap model (`freedIfSent` vs `addedIfAcquired`) and the
  dead-money readout are untouched. Verified functionally rather than by
  eye: sort headers reorder, row click selects, the card link navigates
  *without* toggling selection, the position filter narrows 37 rows to
  2, and a non-matching search shows the empty state.
- **2026-08-21 — Genre research (`docs/genre-research.md`).** A research
  pass across football/baseball/soccer GM sims, player forums and
  sports-media UI patterns, cross-checked against what this codebase
  actually has. Findings are tagged **[Verified] / [Reported] /
  [Inference] / [Codebase]** and the doc has an explicit "what I could
  not verify" section — `WebFetch` was blocked by the network proxy for
  all eight domains attempted, so every external claim is a search-index
  synthesis rather than a direct read. Treat it accordingly.
  Three findings about *this* codebase are worth calling out because
  they were confirmed by reading the source, not inferred:
  - Coordinators already carry a hidden `rating` that feeds unit
    performance in `lib/sim/units.ts`, and `fireStrugglingCoordinators`
    in `lib/season.ts` already fires underperforming **AI** ones — but
    the player can never see, hire, fire, or scheme their own. The sim
    plumbing exists; only the management layer is missing.
  - `Player.morale` exists in the schema, is explicitly commented as an
    unwired placeholder, and has zero real usages anywhere in `lib/`.
  - `lib/season.ts` states outright that user teams are never auto-fired,
    so there is no job-security or owner-pressure mechanic at all.
  Ranked recommendations, with rough sizing and whether foundations
  already exist, are in the doc's prioritised table.
- **2026-08-21 — Portraits, roster regroup, contract-value tolerance, CPU
  re-sign fix.** Checkpoint before this batch: `c2e5974`.
  - **Portraits read male now.** The previous pass leaned on facial hair
    to signal it, so every clean-shaven seed still read feminine. Fixed
    at the source instead: jaws widened so the chin stays near
    cheekbone width (~38 of the 58-unit skull) rather than tapering to a
    point, a jaw-break line, a brow ridge, smaller/lower-set eyes, a
    thicker neck and broader pads. The stubborn case was long hair —
    it was being painted *over* the cheeks because `LongHairBack`
    rendered after the head, which framed the face unmistakably
    feminine no matter how heavy the jaw beneath it was. It now draws
    behind the skull and stops above the jawline, and long/ponytail
    styles force facial hair (which is how the look actually appears on
    a roster). **Honest status: 3 of 4 sampled faces read clearly male;
    a light-haired clean-featured seed is still borderline.** Reordering
    the RNG draw changed every existing player's face — faces aren't
    stored, so no migration, but they will look different in old saves.
  - **Roster grouped into a squad**, not a flat 39-row list: offence /
    defence / special-teams banners over position-group sections, each
    header carrying headcount, average OVR and total cap, plus a "thin"
    flag that triggers on real lack of backup depth rather than a flat
    threshold (so a normal 2-QB room or the lone kicker isn't falsely
    flagged). Starters get a team-colour accent and a tag, derived from
    the Depth Chart's own rank-0 convention so the two pages agree.
    Sorting still works and reorders *within* groups; the Pos header
    specifically flips which end of the squad leads, so it still does
    something visible.
  - **Contract value got a tolerance band.** $15K over market on a $30M
    deal was being flagged red as an overpay, which is noise. A
    deviation now has to clear **both** 12% of the player's own market
    value **and** a $1M floor before it counts as material — percentage
    alone would flag a $1M punter for being 100% over, and a flat floor
    alone would flag a rounding error on a $30M quarterback. Three-way
    bargain / market / overpay replaces the binary everywhere, with
    market-rate shown in neutral ink rather than forced green or red.
  - **CPU re-sign: found the real bug.** AI teams re-signing their own
    players already worked (verified by driving a saved league through a
    full offseason — 93 extensions across 29 teams). The actual defect
    was that `resignDecisionsForTeam` only looked at contracts already
    at zero years, while the Re-sign page and its own button copy
    promise to handle everything listed, which includes walk-year
    players. Broadened to `<= 1` and fixed the kept/released accounting
    so an un-extended walk-year player isn't miscounted as released.
  - **New `lib/scoutingProse.ts`** — prose-voiced scouting reports whose
    hedging is driven by the *displayed band width* per attribute rather
    than one aggregate confidence number, so it can never state more
    precision than the fog actually allows. Not yet wired into the
    player card.
- **2026-08-21 — Narrative layer: rivalries, storylines, prose scouting
  reports — and wired into the UI.** Checkpoint before this batch:
  `211026d`. The genre research named a storyline engine as the single
  highest-leverage addition: this game had a strong *facts* layer (news
  wire, transactions, recaps, history, awards) but nothing threading
  those facts into an ongoing *story*, which is what OOTP and Football
  Manager are credited for when players explain why they stay attached
  to a save.
  - **`lib/rivalry.ts`** computes rivalry purely from existing `Game`
    rows plus division membership — no schema. Head-to-head record,
    average margin, streaks and a derived intensity.
  - **`lib/storyline.ts`** generates beats in six categories (stakes,
    rivalry, streak, record chase, milestone, player arc). Every beat
    carries the concrete number it was derived from, so nothing is
    invented. It wraps `clinchScenario.ts` and `records.ts` rather than
    reimplementing their maths.
  - **`lib/scoutingProse.ts`** writes a scout's note instead of a bare
    numeric range. Crucially its hedging is driven by each attribute's
    *displayed band width* rather than one aggregate confidence number,
    so it can never assert more precision than the fog is already
    showing — a low-confidence player reads genuinely uncertain.
  - **Wired in** (these were dead code until now): storylines render on
    the Dashboard via a new `components/ds/StorylineFeed`, and the
    scouting report leads the player card above the Attributes grid.
  - Two bugs caught in review rather than shipped: an unreachable
    "first-ever meeting" rivalry branch (with no prior meetings the
    intensity can never clear the narrative threshold, so the sentence
    was dead code), and beats reading "1 **sacks** from 5" — the
    category labels are stored plural, so a gap of exactly one needed
    singularising.
  - Verified against real saved leagues rather than trusting the
    generator: a claimed 3-game losing streak was checked game-by-game
    against raw `Game` rows (wk14/15/16 losses, wk13 a win — correct),
    and a record-chase gap was checked against raw `careerStats`.
  - Known soft spot: the tuning constants (rivalry narrative threshold,
    streak minimum, decline ratios) are all marked `[TUNE]` and are
    defensible but unvalidated against a full season of real play.
  - Note: agent verification advanced the shared demo league
    (`cmt1vj55h...`) through a full season and offseason, so its state
    differs from earlier screenshots in this changelog.

- **2026-08-21 — Standings rebuilt around the playoff picture (`4611465`).**
  Three defects and one missing feature, all on the same screen.
  - **The 32 team links were wrong.** Every row linked to
    `/roster`, which only ever renders *your* team — so 31 of 32 links
    quietly showed you your own roster no matter whose name you clicked.
    Rivals now deep-link into their franchise history; your own row still
    goes to your roster. The Stats page team table had the identical
    defect (every team linked back to `/standings`) and the identical fix.
  - **Division panels shuffled between renders.** The team query had no
    `orderBy`, so Postgres was free to return rows in any order and the
    eight division panels reordered themselves at random. Now ordered by
    conference, division, abbreviation.
  - **The League Wire ticker painted over its own label.** The marquee is
    a later DOM sibling than the "League Wire" chip, so scrolling
    headlines slid straight over the top of it. Fixed with an explicit
    stacking context.
  - **New: a live playoff picture.** `lib/standingsBoard.ts` computes the
    conference field the same way `seedPlayoffs()` in `lib/season.ts`
    will actually seed it at the end of week 17 — every division winner
    above every wild card. This is the point: a projection based on raw
    record would tell you you're 5th when the sim is going to seed you
    4th. The test save demonstrates the rule live — a 3-2 division leader
    seeded #4 above a 4-1 wild card at #5. Bye line and cut line are
    drawn in, with the four teams still in the hunt and their games-back.
  - Also added: current W/L streaks computed from the game log in a
    single pass, point differential (the sim's actual tiebreaker) as a
    column, and week-over-week rank movement.
  - Verified by script against a real save: every division leader seeded,
    no wild card above a division winner, top seed at 0.0 GB, and the
    games-back formula checked against a hand calculation. Screenshotted
    and read back — which is how the ticker overlap and a team-name
    column truncating to "Jackso..." were caught.
- **2026-08-21 — Player names are now unique league-wide (`ee68fd9`).**
  A 53-man roster in the test save fielded two men both called Reggie
  Hollis, four different Northcutts, three Ibarras and four players named
  Priest. Sixty first names and sixty surnames were serving ~1,700
  rostered players plus a 400-deep draft class every year. Simulated
  against the shipped pools: **280 of 1,523 players — 18% of the league —
  shared a full name with somebody else**, and each surname was worn by
  25 players on average.
  - Pools widened to 200 first names / 240 surnames / 76 colleges (from
    60 / 60 / 21). That's the *variety* fix — average surname drops from
    25 players league-wide to 6.
  - Pool size alone does not fix duplicates, though: 48,000 combinations
    still collides ~18 times across 1,523 independent draws. So
    generation now carries a `NameRegistry`. League creation threads one
    ledger through every roster and the free agent pool; each annual
    draft class seeds its ledger from everyone already in the league, so
    a rookie can never be handed a sitting starter's name. Collisions
    re-roll, and if the space were ever exhausted it falls back to a
    generational suffix ("Marcus Whitfield Jr.") rather than a number.
  - Verified end to end by generating a real league: 1,524 players, 1,524
    distinct names, zero duplicates, all 76 colleges used, no suffix
    fallback needed. Simulated on to 3,509 players across five draft
    classes — still zero. Same seed still yields the same names.
  - Note: this only affects newly generated players. Existing saves keep
    the duplicate names they already have.
- **2026-08-21 — Scouting focus is now a real economy (`54a316f`).**
  Focus points were effectively infinite, so no scouting decision cost
  anything and triage — the actual skill of the job — never happened.
  - **Finite grants.** Focus arrives per period (a week in season, or
    the whole pre-draft window as one lump at roughly 6× a weekly
    stipend), sized off your scout staff — 92–122/week for a typical
    team. **Carryover caps at half the incoming grant**, so banking a
    week to afford a Deep Dive is a real play but hoarding is
    impossible: the balance plateaus at 1.5× grant, and a 780-point
    pre-draft balance collapses to 156 at the new league year.
  - **Four tiered actions** replace the single Scout button, each
    closing a *fraction of remaining* uncertainty rather than adding
    flat confidence — Area Look (5), Full Evaluation (18, locks two
    attributes), Deep Dive (45, tightens potential on its own track,
    can surface the dev trait), Development Focus (30, on your own
    player). Repeat passes cost +60% and reveal 18% less each time: the
    sixth Deep Dive on one man costs 180 and buys 1 point of confidence.
  - **The scarcity was measured, not asserted.** One Area Look on all
    400 prospects costs 59% of an entire league year. A full-class Deep
    Dive costs 5.3× everything you will ever earn. A realistic pre-draft
    cycle (deep dive the top 5, evaluate the next 15, look at the rest)
    runs out after 45 of 400 prospects, with exactly one at high
    confidence.
  - **The fog invariant holds** — potential is still always a range.
    That required an explicit ceiling on how much of a player can ever
    be locked; without it, enough Deep Dives collapsed the displayed OVR
    to a single certain number.
  - **New Scouting Department page** puts one pool against three
    competing lanes: the draft class, the free-agent market, and your
    own players' development. Every cost and the remaining balance are
    visible before the click.
  - Existing saves are safe: new columns are additive with defaults, and
    a league that has never seen the system opens with a full allowance
    rather than zero.
  - **Alongside it, two layout fixes.** The dashboard's right rail
    carried two short widgets against a left column three times its
    height — the League Wire moves full-width below, and the rail gains
    an Injury Report (the header said "54 (3 inj)" and named nobody) and
    Season Leaders. The depth chart was stretching its two-deep QB card
    to match the seven-deep WR card beside it and running half empty;
    column flow packs them, the "Unmanned"/"No Backup" tiles now name
    the positions instead of just counting them, and a new "Out Of
    Order" tile catches an 83 sitting behind two 69s (which happens on
    its own, because a new signing appends to the bottom of his group).
  - **Scope warning for rollback:** this is a whole-tree checkpoint, not
    a single-topic commit. Two workstreams were mid-flight and their
    partial work is included — salary-cap enforcement and combine
    percentile ranking. Both are functional but unfinished; their own
    entries follow. It was committed whole deliberately so the hash is a
    checkpoint that actually builds (tsc clean, all 16 league routes
    200). Reverting past it loses the scouting economy too.
- **2026-08-21 — Combine ranks, gated potential tags, and testing that
  correlates with ability (`54a316f`, `f35cc52`).** Three related
  prospect-evaluation changes.
  - **Every combine number is now ranked against positional peers in the
    same class.** A raw 4.62s means nothing on its own — elite for a
    tackle, slow for a corner. Each measurable shows "6th of 47" under
    it. Direction is decided in exactly one table: 40-yard, 3-cone and
    shuttle are lower-is-better; vertical, broad and bench are
    higher-is-better. Getting that backwards would have been a silent,
    plausible-looking bug, so it was proved both ways against a real
    class (fastest 40 → 1st of 52, slowest → 52nd; highest vertical →
    1st, lowest → 49th with a correct four-way tie).
  - **Potential-derived tags are now gated behind scouting.** "Franchise
    Prospect" and friends gave away the thing you're supposed to pay to
    learn. Below 40% confidence the tag reads "Unevaluated"; between 40
    and 75 it's hedged with a question mark; only above 75 does it
    commit. It uses the *same* confidence bands the range readout
    already uses, so the tag and the number beside it can never
    disagree. **Consensus rank badges (Top 5, Top 10, #1) stay
    ungated** — that's public board talk, not private evaluation.
  - **Combine results now correlate with real ability, imperfectly.**
    Previously testing was near-independent of how good a player
    actually is, which made the combine decorative. Rank correlation
    between true rating and 40 time now sits at about **-0.55 to -0.72**
    across positions — strong enough that top prospects mostly test
    well, loose enough that testing is evidence rather than an answer
    key. Three deliberate archetypes are seeded off the RNG: **workout
    warriors** (bottom-third ability, elite testing — the trap),
    **sleepers** (genuinely good players who test great but sit low on
    the public board), and **bad testers** (good players with poor
    numbers). Independently re-measured on my own seeds: warriors 7.6%,
    bad testers 5.4%, mean correlation -0.554, and **zero** physical
    implausibilities across 2,400 prospects (fastest DT 4.70s vs
    fastest WR 4.22s — no overlap).
  - The consensus draft board now reacts to testing as well as scouted
    rating, which is what makes those archetypes exploitable rather than
    cosmetic: a workout warrior actually rises on the public board, and
    a good player who tested badly actually falls into range.
- **2026-08-21 — Schedule rebuilt (`5194e41`).** The page rendered all
  272 games of the season in one flat column — **15,869 pixels** tall.
  Now: your own season as one row per game (week, home/away, opponent
  and their record, result or the opponent's point differential), with
  the next game highlighted and only played games linking to a box
  score; then the league's slate for one selected week, with tabs
  defaulting to the week actually being played. Masthead adds remaining
  strength of schedule. **2,119 pixels.**
- **2026-08-21 — Roster construction panel (`f35cc52`).** The roster
  page was a 53-row table and nothing else, so it could not answer "what
  kind of team is this." Eight unit tiles now sit above the list, each
  showing the starter rating at that unit and its delta against the
  league's average starter there, plus average age and expiring deals. A
  headline names the strongest and weakest units and how many players
  are 30+ (and how many of those start). Two decisions worth recording:
  the rating averages only the men who actually play, because a group
  mean punishes a team for carrying a seventh receiver; and the league
  baseline is the mean of each team's *starter* average, not a flat mean
  over every rostered player — a flat mean sits below everyone's
  starters and would have shown every unit on every team as a strength.
- **2026-08-21 — News, GM Career, and the last two mastheads (`bf6e348`,
  `7f9a1f5`, `63fe094`).**
  - **News** dumped 80 transactions into one flat column — no sense of
    when anything happened, no way to reach anything older, and (because
    the wire is dominated by per-game injury and performance rows) about
    seven thousand pixels of near-identical entries. Stories now group
    under a week heading, headlines are weighted by type (a
    championship, a firing or a trade gets a heavier row; an injury
    report stays a line item — previously they rendered identically),
    and it pages 60 at a time. Ordering moved from row-creation time to
    season/week, which the grouping needs to be contiguous.
  - **GM Career** in a first season was five sparse tiles and six
    hundred pixels of nothing. It now carries a season log — including
    the season *in progress*, which has no `TeamSeasonRecord` row until
    it ends, so a 7-2 first-year GM was staring at an empty table — and
    a ledger of every move made, counted by type.
  - **A self-contradicting count, caught before shipping.** The new
    ledger first filtered trades by `teamId` and reported "Trades 0" on
    the same screen whose summary tile read "Trades Made 7". Trade rows
    carry no `teamId` at all — both sides live in one headline as
    "Trade: BOS <-> LAX" — and the career summary already knew that. The
    matching rule is now one exported function used by both. This is the
    fifth instance this project has produced of a metric that looks
    right and silently isn't; they now get a shared helper rather than a
    second implementation.
  - Also dropped a "Re-signs" column *before* shipping it: nothing
    anywhere in the sim writes a `RESIGN` transaction, so it could only
    ever have read zero.
  - **Stats and History** were the last two screens still opening with a
    bare `h1` while every other page introduces itself through
    `PageMasthead`. Both now carry the same band and metric strip.
- **2026-08-21 — AI re-sign wave measured and found broken (`f5dd6d7`).**
  No fix yet — the measurement is recorded in `docs/resign-audit.md` so
  the correction can be aimed rather than guessed at. Against a real save
  that had already run the wave: **1,046 of 1,318 AI-rostered players are
  on expiring deals**, 564 of them clear the AI's own "worth keeping"
  floor, and **44 contracts were actually signed — 7.8% of the eligible
  pool**. That leaves every AI team shedding roughly ten starters and
  thirty-four players in one offseason, which would flood free agency
  with other teams' starters and hand the user a trivially exploitable
  league. Two independent causes: `suggestedYears()` gives two-year deals
  to anyone under 66 overall (most of a roster), so half the league
  expires on the same cycle; and the wave rolls a willingness coin flip
  *before* any value check, then iterates in roster order, so a team can
  spend its cap room on depth and fail the affordability test for its own
  stars.
- **2026-08-21 — Salary cap enforcement (`8a9ed2f`).** Before this, the
  cap was close to a suggestion: only free-agent signings, extensions and
  franchise tags checked whether a team had room. Restructures, trades,
  rookie deals and week advancement did not.
  - **One shared gate.** `assertCapRoom()` in the new
    `lib/capEnforcement.ts` now guards signings, extensions, tags,
    restructures, both sides of a trade, and rookie deals. It lives in
    its own module rather than `lib/cap.ts` for a concrete reason:
    `lib/cap.ts` is imported by four client components, and the check
    needs Prisma — putting it there would drag the Prisma client into the
    browser bundle. `lib/cap.ts` keeps the pure maths.
  - **Trades check both sides.** A trade can be legal for one team and
    illegal for the other. The existing rule still holds: the signing
    bonus stays with the team giving the player up, and the receiving
    team inherits base salary only.
  - **The week will not advance while you are over**, in Realistic mode,
    for your own team only — and only while a way out actually exists.
    If dead money alone exceeds the ceiling, the week advances with the
    warning standing rather than soft-locking the save. The block names
    the shortfall and the fastest route out; a sticky panel and a
    standing banner carry one-click relief links.
  - **The block is scoped off `OFFSEASON`/`RESIGN` deliberately**, and
    that was only found by tracing four seasons. Contracts age onto their
    next escalating year at the season roll, but expiring deals don't
    come off the books until re-signing ends — so teams go negative in a
    predictable window and recover on their own (6 teams over in 2028, 18
    in 2029). Blocking there would have fired on most users every single
    offseason for a condition that clears one step later. Compliance is
    due from `FREE_AGENCY` onward.
  - **Cuts are deliberately NOT blocked.** A release whose dead money
    exceeds its cap hit *increases* spend, but blocking cuts is exactly
    how you strand someone whose remaining moves all cost money. Instead
    the confirm dialog now says it plainly: "This release costs you $X of
    cap space rather than freeing any."
  - **AI teams obey the same rules**, with one deliberate exception: a
    draft pick is the one transaction a team cannot decline, so an AI
    team clears its own room by releasing the fewest players that fit the
    deal rather than stalling the draft. It pays a real roster cost; it
    doesn't get an exemption.
  - Two things I got wrong and am recording rather than quietly
    dropping. I reported that only one code path checked the cap — it was
    three. And I reported a live bug where the header showed a cap figure
    in a league with the cap turned off; I had the raw
    `{"capMode":"OFF"}` and a roster page rendering "—" in every Cap Hit
    cell (which the code only does in OFF mode), but by the time it was
    investigated every league in the database read `REALISTIC`, and a
    purpose-built OFF league renders "Cap Space / Off" correctly on every
    page. Something changed the setting mid-session. There is no live bug.
  - **Found, verified, and NOT yet fixed: the salary cap never grows.**
    `capForYear(seasonYear, leagueStartYear)` is correct, but its only
    substantive caller passes the current season year for *both*
    arguments, so elapsed is always 0 and the ceiling is pinned at
    $255.0M forever while base salaries escalate every year. That
    compounding is what produces the offseason drift above. It needs a
    `League.startYear` column. Being repaired now, together with the
    contract-length and AI re-sign problems, since all three are the same
    economy.
- **2026-08-21 — The game now plays football after season one (`8f7b779`).**
  This was the worst defect in the project and it had been there the
  whole time.
  - `buildSchedule()` was called from exactly one place —
    `createLeague()` — and the offseason pipeline had **no schedule step
    at all**. A league was born with 272 games in the table and never
    got another one. Verified across every save in the dev database
    before the fix: one sat in **2028 regular season week 4 with zero
    2028 games**; another in 2029 had games only for 2026 plus four
    playoff fixtures a year.
  - Nothing told the user. Weeks still advanced, the toast read *"Week 1
    complete: 0 games played,"* the Advance button stayed green, and the
    only tell was the dashboard's next-opponent strip quietly failing to
    render.
  - This deleted the premise of the game. Every long-arc feature already
    built — GM Career, Ring of Honor, league records, transaction
    retrospectives, dynasty score — was pointed at an empty room. Worth
    noting for the backlog: the playtest reported this as four separate
    findings ("franchise history is a graveyard", "awards become jokes",
    "nothing accumulates", "career stats stop growing"). They are one bug.
  - New `lib/scheduleSeason.ts` owns the single path both callers use,
    and the preseason step invokes it. Preseason is the right gate: it is
    the last phase before `REGULAR` on every route into a new league
    year, and the function is idempotent, so running it on a
    freshly-created league that already has a schedule is a no-op rather
    than a duplicate season.
  - Verified by advancing a real stuck save: 2027 preseason reported
    *"The 2027 schedule is out — 272 games across 17 weeks,"* then played
    16 games a week for three straight weeks. Games by year went from
    `2026:283` alone to `2026:283, 2027:272`. Screenshotted a 2027 week-4
    schedule page showing three played results and fourteen to come.
- **2026-08-21 — Playoff wins no longer contaminate regular-season
  records (`8f7b779`).** `updateStandings` ran for every game with no
  phase guard, so a champion's four postseason wins were incremented
  straight into `team.wins` — and `TeamSeasonRecord` is built from
  `team.wins`. That is where **"2026 Champions (19-1)" on a 17-game
  season** came from, along with 20-game division tables and a title
  winner displayed third in its own division. Standings now update only
  for `kind === 'REGULAR'`; the postseason is already carried by the
  Game rows and by `TeamSeasonRecord.playoffResult`. Verified by running
  a league from week 17 through the final: the champion finished
  **17-0 rather than 21-0**, the largest record in the league was 17
  games, and every season record row written totals exactly 17.

- **2026-08-21 — Dynasty page reachable; scouting ranks actually narrow
  the bands (`ad98a74`).** The GM progression system (Dynasty levels, XP,
  the three-branch skill tree, and the two per-season Full Scout charges)
  shipped with three gaps that all had the same effect — a skill point
  spent changed nothing the player could see:
  - `/dynasty` had **no nav entry**, so it was reachable only by typing
    the URL. It now sits under **GM Career** in the league nav.
  - The **player page** and the **Scouting Dept page** built their
    scouted views without passing `dynasty`, so Scouting-branch ranks
    were ignored on the two screens those ranks exist for. Both now call
    `loadScoutMods(league.id)` and pass it to `buildScoutedView`.
  - **Full Scout** had no button on the player card. It now sits beside
    the ordinary Scout button, showing its remaining charges, so the
    price of a perfect evaluation is compared against an incremental
    look at the moment the choice is made.
  Also lands `app/actions/dynasty.ts`, whose profile upsert keys on
  `leagueId` rather than `id` — `loadDynastyProfile` can return an
  in-memory default with no id, and keying on `id` would have inserted a
  fresh row on every Dynasty action instead of updating the one.
  Verified: `tsc --noEmit` clean; `/dynasty`, `/scouting`, `/gm` and both
  a drafted and a rostered player page return 200.
- **2026-08-21 — Saves are now scoped to the browser that created them
  (`0c79c45`).** The pre-launch blocker. The home page ran an unfiltered
  `prisma.league.findMany()`, `deleteLeagueAction` deleted any id it was
  handed, and none of the 33 server actions checked whose league they were
  operating on. On one machine that is invisible; the moment this is served
  to two testers, each sees the other's franchises and can delete a
  twenty-season dynasty with one click.
  New `lib/owner.ts` mints an opaque random id into an **httpOnly cookie**
  and stamps it on `League.ownerKey` at creation. This is **not
  authentication** — whoever holds the cookie is the owner, and clearing
  cookies loses the saves — but it is the correct boundary for a
  single-player game with no accounts, and it had to exist before a public
  test deploy. Three enforcement points: `listOwnedLeagues()` (home page),
  `assertLeagueOwner` / `assertTeamOwner` (every server action — a
  page-level check does nothing for POST endpoints), and `canViewLeague()`
  inside `getLeagueContext` (every league page render).
  **Legacy saves** (`ownerKey IS NULL`, created before the column) stay
  visible in development and are adopted by the first browser that opens
  them, so existing local saves don't disappear; in production they are
  invisible and undeletable, because on a shared deployment an unowned save
  is precisely the thing nobody should be able to claim.
  Verified live: with the test league stamped to a foreign owner key its
  page returned **404** and it vanished from the home list; restored to
  unowned, all 17 league routes returned 200.
  *Still open before a real public deploy:* the cookie is the only
  credential, so it cannot survive a cleared browser or move between
  devices. If saves need to follow a person rather than a browser, that is
  a real sign-in and a separate change.
- **2026-08-21 — Reversed the density pass; avatars and graphics restored
  (`044cc45`, more to follow).** The visual refinement pass read "refine" as
  *densify* — strip ornament until only figures remain — and stripped player
  avatars or team logos from **thirteen files**, including halving the player
  page's hero avatar from 128px to 64px and replacing a team crest in the
  news feed with a blank grey disc. The app owner's reaction, and the reason
  this is now a standing principle above: *"we dont want this to just feel
  like text. the avatars and graphics add SO much to the feel of the game"*
  and *"it needs to be and feel alive."*
  What was kept from that pass, because it was correctness rather than
  taste: the single monotonic rating ramp replacing the old rainbow (colour
  had been carrying meaning alone, and the rainbow implied an ordering it
  did not have), tabular figures so digits align in columns, and the removal
  of two constant columns. What was reversed: everything else. Avatars are
  back at their original sizes; the ~30px row target is abandoned; the
  player page and `PlayerHero` are treated as near-final and take the ramp
  fix and tabular figures only.
  The pass then flips from subtracting to adding — team crests and team
  colour on screens that currently show only an abbreviation, real trophy
  and ring marks instead of text labels for championships and awards, and
  small inline shapes (five-game form, cap allocation, positional depth)
  where a bare number is doing a picture's job. All built from what is
  already in the repo (`TeamLogo`, `PlayerAvatar`, `generateTeamLogoParams`,
  `positionBadgeClass`, `--team-accent`, `ds/icons.tsx`), seeded and
  deterministic, no external assets.
  Rating colour is being re-tuned in the same pass: neutral below ~80, three
  distinguishable steps above it, glyphs retained, and the steps validated
  against a colourblind-separation check rather than eyeballed.
- **2026-08-21 — Two latent layout bugs fixed (`30d7102`).** Surfaced by the
  reverted visual pass but not part of it — both predate it and would still
  be broken without it. `.table-clean th` set `text-left` at specificity
  (0,1,1), so every `text-right` header utility (0,1,0) in the app silently
  lost to it: the standings table, the GM season log and the Dynasty XP
  ledger were all rendering left-aligned headers over right-aligned figures.
  And `PageMasthead` hardcoded a five-column fact strip, stranding the Depth
  Chart's sixth fact alone on a second row. Verified in a browser, not by
  reading the CSS.
- **2026-08-21 — League Wire was showing seeded backstory instead of news
  (`b987a5e`).** Reported as *"the league wire is just naming all the past
  champions."* On a 2029 save the wire's 120-row window held 22 CHAMPION rows
  and 97 award rows dated 2004-2023, and exactly one event from the save's
  own history. Two causes, both fixed. **(1)** League creation seeds ~24
  years of fictional franchise backstory and writes every row at creation
  time, so `orderBy createdAt desc` ranked all of it above anything that had
  actually happened — `createdAt` is honest about when a row was *written*
  and silent about when the event *happened*. Both wire queries now floor on
  `seasonYear >= current - 1`. **(2)** `wireScore` decayed staleness on
  `currentWeek - c.week` with no reference to the year, so a title won in
  week 21 of 2014 against a current week 5 produced a *negative* difference
  and therefore zero decay — it held its full weight of 100 forever. Age is
  now measured in league time. Also, per *"it doesnt always need to be
  filled"*, the ticker no longer pads to fourteen items: it takes at most
  four per category and renders nothing when nothing is breaking. Reaching
  for filler is what put 2008 championships on a 2029 strip.
  In the same pass: **Dynasty promoted to its own top-level nav category.**
  It was a sub-tab under GM Career, so the level/XP/skill-tree system was
  invisible to anyone who had not already clicked into that category, and it
  was reported as missing entirely.
- **2026-08-21 — Contract negotiation became a minigame (`1885f1c`).** The
  ask was *"the contract negotiations for re-sign and free agency need to be
  more of a minigame instead of them accepting everything. A live updating
  interest meter might work"* and *"the salary should just be a slider too"*.
  A model and panel were built to that spec and **never connected to
  anything** — `NegotiationPanel`, `InterestMeter` and `lib/negotiation.ts`
  had zero call sites, while the live path was `apy >= 0.9 * market`: four
  lines, no personality, no term, no guarantee, no patience, no rival. That
  *was* the "they accept everything" bug.
  Both screens are now real — sliders, live meter, server-authoritative
  patience, and a loss condition. **One evaluator survived**
  (`lib/negotiation.ts`); `lib/freeagency.ts`'s is deleted, and both the
  client meter and the server acceptance call the same `decideOffer`,
  because a meter that says "he'll sign" while the server refuses is exactly
  the lying-metric bug this project keeps shipping.
  Proven rather than asserted: **234,801 offer comparisons, zero
  disagreements**, six runs, comparing the session the client holds against
  one the server re-resolves — every field, not just `accepted`. The check
  caught two real bugs on the way: an offer charging one patience pip while
  the button promised two, and a nonsense minimum-price quote for prove-it
  players. Consolidating also made his reservation price depend on **true**
  ratings while the estimate you see stays **scouted**, so scouting quality
  now matters at the negotiating table.
- **2026-08-21 — The production build was run, and passes.** `next build`
  had not been run against this tree in a long time, and `tsc` cannot see
  Suspense boundaries, server/client component violations or route config
  problems. All 27 routes compile, exit 0. Every league route is dynamic
  (`cookies()` in the ownership check makes them so); only `/design-system/*`
  is static — and publicly reachable, which is worth knowing.
