# Gridiron GM

A single-player American football front-office simulator. Built with **Next.js
14 (App Router, TypeScript)**, **Tailwind CSS**, and **Prisma + Postgres**.

You are the GM of one franchise in a 32-team league of fictional teams and
generated players (no real NFL data/names anywhere). Every core system from
the design doc is implemented end-to-end: player generation, scouting
fog-of-war, the sim engine, salary cap, free agency, trades, the draft, and
the full season/offseason cycle.

> **Balance disclaimer:** Every number that the design doc marked "tunable" —
> position weights, RNG spreads, market-value curves, AI valuation formulas,
> the draft pick chart, etc. — is a first-pass placeholder. They're all
> centralized in **`lib/tuning.ts`** (plus a few adjacent files: `lib/cap.ts`
> for market value, `lib/ai/gm.ts` for AI valuation) and commented with
> `[TUNE]`, `[SAFE]`, or `[FRAGILE]` tags so they're easy to find and adjust
> once you've playtested.

## Play it now (no coding required)

Click this button. It opens Vercel (a free website-hosting service) with this
project pre-loaded:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/jakehabib/stox/tree/claude/football-gm-simulator-ixeatl/gm-sim&project-name=gridiron-gm&repository-name=gridiron-gm)

Then:

1. **Sign in with GitHub** if it asks (free, one click — use the same GitHub
   account this repo lives in).
2. Vercel will show an import screen with the project already configured.
   Click **Deploy**.
3. The first deploy will likely **fail** — that's expected, not a real error.
   It fails because the app needs a database and doesn't have one yet:
   - Open the new project in Vercel, go to the **Storage** tab.
   - Click **Create Database** (or **Browse Marketplace**) → choose **Neon**
     (Postgres) → pick the free plan → **Connect** it to this project.
     This automatically fills in the database connection the app needs — you
     don't have to copy/paste anything.
   - Go to the **Deployments** tab and click **Redeploy** on the latest one.
4. Once that build finishes (green checkmark), click **Visit** — that link is
   your game. Bookmark it; it stays live and keeps your save.

If the button ever stops working (e.g. the repo becomes private and Vercel
can't see it), the manual path is: on [vercel.com](https://vercel.com), **Add
New → Project → Import** this GitHub repo, set **Root Directory** to `gm-sim`,
then follow steps 2–4 above.

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
   position), recent results, and the league transaction wire.
3. **Roster** — every player on your team, with scouted rating **ranges**
   instead of hard numbers (unless you disable scouting in Settings). Click
   a name to open their **Player** page — attribute-by-attribute scouted
   ranges, contract details, a **Release** button, and a **Scout** button to
   spend weekly scouting points narrowing the range.
4. **Depth Chart** — reorder each position group with the ▲/▼ buttons; this
   is the exact order the sim engine snaps to on game day. "Auto-Sort by
   Rating" resets it to true-value order.
5. Hit **Advance ▸** in the top-right repeatedly to sim games. Click any
   final score to read the generated **recap** and box score.
6. **Free Agency** / **Trade** / **Draft** pages work whenever the league
   phase allows it (the top bar always shows the current phase — Regular
   Season, Free Agency, Draft, etc.). The season loop is: Regular Season →
   Playoffs → Offseason (progression, aging, new draft class) → Re-sign
   window → Free Agency (4 weeks) → Rookie Draft → back to Preseason.
7. **Settings** covers every option from the design doc's settings screen —
   cap mode, difficulty, scouting toggles, injury/progression rates, trade
   rules, sim variance, recap verbosity, and more.

## Where things live

- `prisma/schema.prisma` — full data model (teams, players with true vs.
  scouted values, contracts/cap, draft picks, scouts, coordinators, league
  state, settings blob)
- `lib/tuning.ts` — **every balance constant in the game**, grouped by system
- `lib/gen/` — player generation, name/team pools, league creation
- `lib/scouting.ts` — the fog-of-war system (section 6): observed values,
  error bands by attribute difficulty, confidence growth
- `lib/cap.ts`, `lib/cap-summary.ts` — salary cap in Realistic / Simplified /
  Off modes, market-value curve, rookie scale, franchise tag
- `lib/sim/` — unit ratings (`units.ts`), drive-based game resolution
  (`engine.ts`), recap text generation (`recap.ts`)
- `lib/ai/gm.ts` — the shared AI GM brain used by free agency, trades, and
  the draft (needs, player/pick valuation, personality profile)
- `lib/freeagency.ts`, `lib/trade.ts`, `lib/draft.ts` — the three acquisition
  systems, each with a user-facing path and an AI-vs-AI/AI-vs-user path
- `lib/season.ts` — the season/offseason phase machine and `advanceWeek`,
  the single entry point that moves league time forward
- `app/league/[id]/` — every screen (dashboard, roster, player, depth chart,
  free agency, trade, draft, cap sheet, standings, schedule, game recap,
  settings)
- `app/actions/` — server actions backing every mutation (sign, cut, trade,
  draft, scout, advance week, settings)

## Known simplifications (documented, not bugs)

- AI teams don't carry their own `ScoutingReport` rows — they evaluate free
  agents/trades/draft prospects off true ratings. Modeling AI fog-of-war
  would 32x the scouting data for no gameplay benefit in a single-player game.
- The re-sign window (`RESIGN` phase) doesn't yet give the original team an
  exclusive negotiating period before a player hits the open market — expiring
  contracts go straight to the free agent pool, which anyone (including you)
  can then sign from, including on your own roster.
- `showAdvancedStats` and `autoAdvanceWeeks` settings are stored and shown in
  the Settings screen but don't yet gate any behavior — flagged as
  "STORED-ONLY" right in the settings UI.
- Stat lines are allocated top-down from team drive totals (so the score and
  box score can never disagree) rather than simulated play-by-play.
