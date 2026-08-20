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

## Known simplifications (documented, not bugs)

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
