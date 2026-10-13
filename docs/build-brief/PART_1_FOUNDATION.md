# PART 1 — Foundation: build the stack, the data model, accounts and league creation

Build a single-player American football front-office simulator called Dynasty GM
Football. This part tells you what to stand it up on, every table to create and
why each column exists, how to own and defend a save, how to create and configure
a league, and the rules for changing the schema once real saves exist.

Every number here was read out of a working implementation. Treat the numbers as
requirements, and treat the reasons attached to them as the thing that stops you
from "simplifying" a number that cost someone a measured failure to find. Where a
value is an unfinished placeholder, or where a stored setting has no consumer,
that is said in place and you are told what to do about it.

---

## 1. Stack and deployment

### 1.1 Use these versions

| Thing | Use | Why it is pinned this way |
|---|---|---|
| Framework | Next.js `14.2.35`, App Router | Server Components for reads, Server Actions for every mutation. Do not build a separate REST/GraphQL layer; the reference needs only three route handlers (league create / import / export). |
| React | `18.3.1` + `react-dom` `18.3.1` | Set `reactStrictMode: true`. |
| Language | TypeScript `^5`, `@types/node ^20` | |
| ORM | Prisma `5.22.0` — pin `prisma` and `@prisma/client` to the same exact version | |
| Database | PostgreSQL. Use Neon in production. | |
| Styling | Tailwind CSS `^3.4.15`, PostCSS `^8.4.49`, autoprefixer `^10.4.20` | Do not add a component library or CSS-in-JS. |
| Tooling | `tsx ^4.19.2` for maintenance and audit scripts | |
| Hosting | Vercel, Node.js serverless runtime | Make every page dynamic. Statically generate nothing. |

Keep the runtime dependency list to exactly four packages: `@prisma/client`,
`next`, `react`, `react-dom`. The login path, the simulation and the cap
arithmetic are all first-party code, which means there is no third-party surface
to pin, audit, or have break on a runtime upgrade. Do not reach for an auth
library, a password-hashing package, or a date library.

### 1.2 Configure the Prisma generator and datasource exactly like this

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "rhel-openssl-3.0.x"]
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")   // POOLED
  directUrl = env("DIRECT_URL")     // DIRECT, non-pooled
}
```

Include `rhel-openssl-3.0.x`. It matches Vercel's serverless runtime. Omit it and
local dev and the build both succeed while the **deployed** app fails at request
time with engine-not-found.

Keep two URLs, and keep them distinct:

- `DATABASE_URL` must be the **pooled** endpoint. Serverless opens a connection
  per invocation and an unpooled endpoint exhausts connections under very light
  concurrency.
- `DIRECT_URL` must be the **direct, non-pooled** endpoint, used only by
  migrations. `prisma migrate deploy` runs DDL in a session that a
  transaction-mode pooler (which is what Neon's `-pooler` host is) cannot hold
  open. It does not fail fast — it hangs and then times out with Prisma **P1002**,
  which Vercel surfaces only as `command "npm run build" exited with 1`. On Neon,
  the Vercel integration already exposes the direct URL as
  `DATABASE_URL_UNPOOLED`; copy that value in. Locally it may equal
  `DATABASE_URL`.

### 1.3 Define these scripts

```
dev                next dev -p 3001
build              prisma generate && prisma migrate deploy && next build
start              next start -p 3001
postinstall        prisma generate
db:push            prisma db push                  (local iteration ONLY)
db:reset           prisma db push --force-reset
db:migrate         prisma migrate dev
db:migrate:deploy  prisma migrate deploy
db:migrate:status  prisma migrate status
db:studio          prisma studio
```

Also add the verification scripts as you build the systems that need them: a sim
health check, a money-conservation check, a cap invariant suite, and
`audit:actions` (§3.5 — build that one, it is not optional).

Add an **`allowScripts`** block to `package.json` naming `prisma`,
`@prisma/client`, `@prisma/engines`, `esbuild`. npm 11.6 stopped running
dependencies' install scripts without project approval, and `@prisma/engines`'
postinstall is what downloads the query and schema engines. npm 10 ignores the
field entirely, so if you skip this the build passes on your machine and dies
seconds into install on Vercel, with the real reason appearing only as a warning
further up the log.

### 1.4 Read exactly these environment variables

| Variable | Required | Default | What to do with it |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Pooled Postgres connection string. |
| `DIRECT_URL` | yes | — | Same database, non-pooled. Migrations only. |
| `MAX_LEAGUES_PER_OWNER` | no | `8` | Saves one browser/account may hold. Treat as a UX limit, not a security control — a cookie can be cleared. |
| `MAX_LEAGUES_TOTAL` | no | `500` | Hard ceiling on leagues in the whole database. This is the one that protects your hosting quota, because a caller rotating cookies cannot walk around it. Budget ~2.6M rows for 500 leagues. |
| `NEXT_PUBLIC_SITE_URL` | no | `https://dynastygm.gg` (use your own origin) | Origin for `metadataBase`, the Open Graph card, `robots.txt`, the sitemap. Set it **only** on preview deployments; production takes the default. |

Ignore non-integer, zero, negative and empty values for the two league limits and
fall back to the default.

Do not read `NODE_ENV` for anything but the two places named in this document
(the unowned-save allowance in §3.2 and the `secure` cookie flag in §3.3), and
**never set `NODE_ENV=development` on a public deployment**. Ownership keys off
it: in production, leagues with a NULL owner key are hidden from every browser;
in development they are visible to everyone. Flip it on a shared deployment and
you expose every unowned save to every visitor.

### 1.5 Next config

Set `reactStrictMode: true` and `poweredByHeader: false` (drop the
`X-Powered-By: Next.js` header — it advertises the framework and version to
anyone scanning and nothing needs it). Do not configure trailing slashes or image
optimisation: every page is served from a serverless function, so there is
nothing to gain yet.

### 1.6 Load three fonts through `next/font`, and use these theme tokens

Load Oswald, IBM Plex Sans and IBM Plex Mono through `next/font` so each is
self-hosted, preloaded and size-adjusted against its fallback. Do not use a raw
`@import`: it costs a render-blocking third-party round trip and a visible reflow
on every navigation.

| Role | Face | Weights | CSS var |
|---|---|---|---|
| Display — headings, nav, buttons, every stat number | Oswald | 500, 600, 700 | `--font-display` |
| Body and data tables | IBM Plex Sans | 400, 500, 600, 700 | `--font-sans` |
| Money, ratings, aligned figures | IBM Plex Mono | 400, 500, 600, 700 | `--font-mono` |

Stop Oswald at 700. It is narrow enough that 800 closes its counters at the sizes
a fact tile uses. Move body copy off the system sans stack: body type is set at
13px in tables of twenty columns, and that is the one size at which "whatever the
OS ships" is not good enough. Keep the full system fallback on every family so a
blocked font request degrades rather than breaks.

Define this palette as Tailwind theme colours:

```
ink #070a0f   surface #0c111a   card #111925   raised #1b2634   line #2e3d51
muted #a3b4c8 chalk #eef4fb
accent #3ddc84  accent2 #63cbff  warn #ffc043  bad #ff8383  gold #ffd24a
onAccent2 #04202e  onGold #1a1200
viz1..viz9  #5fa8f5 #f0793f #37c48f #e3a92b #f078a4 #39b859 #a89cff #ff8f8f #b48ce0
vizGood #5fa8f5  vizBad #ff8f8f
```

Hold to these rules when you touch any of it:

- Keep the ramp this deep. A neutral graphite ramp was replaced because it read
  as "dark SaaS" and because a deeper near-black buys contrast headroom on every
  light-on-dark pair. `muted` on `card` measures **8.35:1** here against 5.52:1
  before, and that headroom is what pays for the denser type scale below.
- Keep `line` at this lightness. The skin is **flat** — there are no drop shadows
  separating one plate from the next — so a 1px border is doing that work alone
  and has to be visible by itself.
- Use `onAccent2` and `onGold` for the dark text that sits on those two bright
  chip fills. Do not write inline hexes for them: when they lived outside the
  token layer, a palette change moved the fill and not the ink on top of it.
- Treat `viz1..viz9` as a **categorical, fixed-order** scale. Pick the colour by
  series identity, never by value rank, and never cycle or reassign per chart. The
  ninth step exists for the one scale that needs nine (the cap page's nine
  position groups); before it existed that chart reached outside the palette for a
  raw hex.
- Override border radii to `md: 2px, lg: 2px, xl: 3px, 2xl: 4px`. Leave `full`
  alone — pills, crests and slider thumbs stay circular.
- Make `boxShadow.card` a 1px inset top highlight only. Reserve
  `boxShadow.elevated` (a deep, very dark drop plus the same inset) for genuinely
  floating surfaces — open menus and popovers, the "on the clock" draft state —
  and reach for `card` everywhere else. On a near-black page a soft grey shadow is
  invisible, which is why `elevated` is much darker than the plate.
- Widen `maxWidth.7xl` to `90rem` from Tailwind's 80rem. At 80rem a twenty-column
  roster or cap board stopped reading as a board on a 1440 screen.
- Set the body scale small and the stat scale separately large:
  `xs 11.5px`, `sm 12.5px`, `base 13.5px`, line-height 1.35–1.4;
  `stat-sm clamp(1.2rem, 4.4vw, 1.5rem)`,
  `stat-md clamp(1.5rem, 5.6vw, 2.15rem)`,
  `stat-lg 2.75rem`,
  `stat-xl clamp(2.9rem, 11vw, 4.6rem)`,
  `3xl clamp(1.6rem, 5.4vw, 2.35rem)`.
  **Use the clamps. They are a bug fix, not a flourish.** These figures land in
  tiles that sit two abreast at 390px — a track about 180px wide — and a figure
  fixed at 2.15rem does not fit one, cannot wrap, and pushes the whole document
  sideways instead. The cap page's four metric tiles were measurably the largest
  remaining source of horizontal scroll on a handset. The floors are the sizes
  that fit the track; the ceilings are the sizes the skin wants, and every
  viewport past ~615px gets them.
- Define one entrance animation (`fadeUp`: 6px rise plus opacity) and drive its
  duration and curve from CSS custom properties that collapse to 1ms/linear under
  `prefers-reduced-motion`. Set `animation-fill-mode: both` so a 1ms run still
  lands on its end state and nothing can be left invisible. Make it a rise and
  **not** a rise-plus-scale: half its consumers are `fixed inset-0` modal
  backdrops, and scaling one of those from .96 opens a bar of bare page along all
  four edges for the length of the animation.

In the root layout, set `metadataBase` from your site URL — without it Next
resolves the share image against localhost at build time and a pasted link renders
with no card at all. Use a title template (`'%s · Dynasty GM'`) with a default, so
a league page can name the club and still be identifiable in a wall of tabs. Set
`applicationName`, `alternates.canonical: '/'`, OpenGraph fields, and
`twitter: { card: 'summary_large_image' }` — testers share this link in chat apps,
which is the only place the game gets a first impression before someone clicks.
Set `viewport.themeColor` to the same value as `ink` (it is the colour a mobile
browser paints its own chrome with, so a stale value shows as a seam above the
page), plus `width: device-width` and `initialScale: 1`. Ship an `app/icon.svg`;
without one every page requests `/favicon.ico` and takes a 404 on each load.

### 1.7 Build auth yourself

Use first-party server-side sessions: a random 32-byte token in an httpOnly
cookie, the SHA-256 of that token stored in a `Session` row, scrypt password
hashes from Node's own `crypto`, and a Postgres rate-limit ledger. Do not add
NextAuth, do not issue JWTs, do not integrate a third-party identity provider.
Full specification in §3.

### 1.8 Raise the function duration on the two slow routes

Set `maxDuration = 60` on the new-league page and on the league-import route.
League creation runs roughly **236 database round trips**; on Vercel's default
10-second budget a slow cold start times out mid-generation, and because the
ownership stamp happens after generation a timeout leaves a league with null
`ownerKey` and null `userId` — invisible to the person who made it and deletable
by nobody.

---

## 2. Create these 27 Prisma models

Follow these conventions throughout:

- **Give every model a `cuid()` primary key.** Never use a sequential id. Then
  remember that **a cuid is not a secret** — it appears in URLs and in exported
  league files — so never treat "you would have to guess it" as an authorisation
  boundary (§3.5).
- **Store JSON in plain `String` columns, not Postgres `jsonb`.** Never query
  these by content. Write one pair of read/write helpers and route every access
  through them, so the stored shape matches exactly what the app produces. Every
  such column is listed below with its shape.
- **Use plain `String` columns for enum-ish values, not Prisma enums**
  (`Player.status`, `Game.kind`, `Transaction.type`, `League.phase`,
  `Contract.fifthYearOption`, …). This keeps migrations additive when a new value
  appears. The price is that you must validate in code, and you must — see §4.5.
- **Make almost every column you add to an existing table nullable or
  defaulted.** `prisma migrate deploy` runs against a database with live rows in
  it, and a required column cannot be added to a table that already has rows.
  Several columns below are nullable *only* for that reason, and each says so.
  Keep them nullable anyway in a fresh build, because the code that reads them
  branches on null and that branch is usually the honest answer ("nobody wrote
  this down") rather than dead code.
- **Make null mean "not known", never "zero".** This recurs:
  `Player.lastSeasonOvr`, `PlayerSeason.endOvr`, `PlayerSeason.age`,
  `DynastyRank.seasonsToTitle`, `Contract.fifthYearOption`. Render *no chip, no
  number, a dash* — never a confident zero. Do not backfill these with invented
  values.

### 2.1 League

The save file. One row per dynasty.

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `name` | String | — | Player-chosen. Cap it at 60 chars on write. |
| `createdAt` | DateTime | now | Order the home page by this, desc. |
| `ownerKey` | String? | — | Which **browser** owns this save: an opaque `randomUUID` from an httpOnly cookie. This is not authentication; it is the boundary that stops one tester listing or deleting another's franchises on a shared deployment. Allow null to mean "created before ownership existed" (§3.2). |
| `seasonYear` | Int | `2025` | Current league year. |
| `startYear` | Int? | — | The season the league was **founded** in — the base year the salary cap grows from. Nullable only so it can be added to an existing database. **Never read it directly**: write a resolver that derives and persists a value for any save created before the column existed, and read through that. |
| `week` | Int | `1` | 1..`settings.seasonLength` during the regular season. Reset it to 1 for the playoffs — which is why power-ranking snapshots need their own week mapping (§2.27). |
| `phase` | String | `"PRESEASON"` | `PRESEASON \| REGULAR \| PLAYOFFS \| OFFSEASON \| RESIGN \| FREE_AGENCY \| DRAFT \| FANTASY_DRAFT`. |
| `contractsAgedYear` | Int? | — | The league year the **contract ledger** has already been stepped onto. Age contracts the moment the season ends, not three offseason steps later, so dead money and cap hits always describe the same league year a cut booked right now is charged against. That mismatch is what made an early cut cost more than an identical late one. Null ⇒ let the offseason catch-up step run the aging. |
| `resignWarnedYear` | Int? | — | The league year you last warned the user that advancing out of RESIGN would drop the roster below the legal minimum. Block the advance **once per year**, then get out of the way: letting players walk is a legitimate choice, losing two thirds of a roster without being told is not. |
| `advanceStartedAt` | DateTime? | — | **The advance lease.** Hold the instant an advance started; null otherwise. Make it a **timestamp, not a boolean**: a boolean left set by a request killed mid-advance is a league nobody can ever advance again, with no way out from inside the game. A timestamp says both "held" and "since when", so a press arriving after the lease expires can take it. Enforce one press of Advance at a time, league-wide. |
| `userTeamId` | String? | — | Convenience pointer to the club the player runs. Resolve "my club" from `Team.isUser`, not from this. |
| `userId` | String? | — | The **account** that has claimed the save. Null = still cookie-owned. Use `onDelete: SetNull` — deleting a user must never delete their dynasties. The save falls back to being cookie-owned, which is recoverable; a cascade is not. |
| `settings` | String | — | The full `LeagueSettings` JSON blob (§4.1). |
| `rebuildAbandonedAt` | DateTime? | — | **The one-way door out of a Rebuild run.** Stamp it once, with the moment the GM chose to stop playing under the ironman rules. Keep it a separate fact from `settings.leagueStart`: that records how the save was *founded* and is never rewritten (so a normal save can never become a Rebuild), while this records what became of the run. Together they distinguish three outcomes one boolean cannot — founded REBUILD + null + no title = locked, in progress, unranked; founded REBUILD + stamped = unlocked, forfeit, unranked forever; founded REBUILD + null + title won = unlocked and **ranked**. Make the forfeit permanent: the leaderboard measures a title won under ironman rules, and a save that took them off has not done that. |

Give it these relations, all cascading from League except `user`: `teams`,
`players`, `games`, `picks`, `transactions`, `draftState` (optional 1:1),
`tradeOffers`, `seasonRecords`, `leagueRecords`, `playerSeasons`,
`powerSnapshots`, `tradeRecords`, `championRosters`, `dynasty` (optional 1:1),
`negotiations`.

Index `@@index([userId])` and `@@index([ownerKey])`. The home-page list filters on
one of those two every time, and the account claim is literally
`WHERE ownerKey = $1 AND userId IS NULL`.

### 2.2 DraftState

One row per league, written when a draft becomes imminent.

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `leagueId` | String | — | `@unique` + cascade. One draft state per save; the unique constraint is what prevents two concurrent drafts in one league. |
| `kind` | String | `"ROOKIE"` | `ROOKIE` (annual) or `FANTASY` (league-start blank-roster draft). |
| `round` | Int | `1` | |
| `pickIndex` | Int | `0` | 0-based index into the full serialized pick order. |
| `order` | String | `"[]"` | JSON `string[]` of teamIds in pick order. |
| `complete` | Boolean | `false` | |
| `runStartedAt` | DateTime? | — | **The draft-run lease: one run of the board at a time, per draft.** Hold the instant the chunk of AI selections currently running took the draft; null when none is. Take it with a compare-and-set that also matches a lease older than the expiry, and release it in a `finally` — exactly the mechanism `League.advanceStartedAt` uses. Refuse a call that finds it held instead of racing the holder: two chunk runners against one `DraftState` both read the same `pickIndex` and both take the same card. Make it a **lease, not a flag**, for the same reason as `advanceStartedAt` — a boolean left set by a request killed mid-chunk is a draft nobody can ever run again, and there is no move inside the game that clears it. |
| `started` | Boolean | `false` | **Has the GM actually opened this draft.** Write the row the moment free agency closes, but do not let the live ticker burn AI picks until the player presses begin. Without this gate the first round happens while the owner is still reading the phase summary. Gate **ROOKIE drafts only** — a fantasy draft is the thing the user asked for by creating the league, so there is nothing to gate. Put that rule in one helper (`draftIsStarted()`) and read the helper everywhere, not this column. When you add this column to an existing database, **backfill every row to `true`**: a save sitting on the clock mid-draft would otherwise take the `false` default and freeze with no button and no ticker. |

### 2.3 Team

Create thirty-two per league.

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | Also use it as the crest seed for the logo generator. |
| `leagueId` | String | — | Cascade. |
| `city`, `nickname`, `abbr` | String | — | Identity. |
| `conference` | String | — | `"AFC" \| "NFC"`. Generic names are fine. |
| `division` | String | — | `"East" \| "North" \| "South" \| "West"`. |
| `isUser` | Boolean | `false` | Exactly one true per league. **Make this the authoritative "my club" flag** and resolve the user's team by querying it; never trust a team id from the client. |
| `prestige` | Int | `50` | 0–100, drives free-agent attraction. Placeholder weight — retune it when you tune free agency. |
| `gmProfile` | String | `"{}"` | AI GM personality, JSON `{ aggression, winNow, valuePicks, bpaBias }`, each 0..1. `aggression` = likelihood of aggressive trades and FA splashes. `winNow` = 1 all-in, 0 full rebuild; recompute it each offseason. `valuePicks` = surcharge on draft picks. `bpaBias` = best-player-available vs. need. |
| `wins`, `losses`, `ties` | Int | `0` | **Reset every offseason.** Make `TeamSeasonRecord` the only durable record. |
| `pointsFor`, `pointsAgnst` | Int | `0` | |
| `divWins`, `divLosses`, `confWins`, `confLosses` | Int | `0` | Tiebreak inputs. |
| `playoffSeed` | Int? | — | 1..6 per conference when seeded, else null. |
| `eliminated` | Boolean | `false` | |
| `scoutPoints` | Int | `0` | Unspent scouting focus right now. |
| `scoutPeriod` | Int | `0` | Period key (year/phase/week) the current allowance was granted for. `0` = never replenished. |
| `scoutPeriodGrant` | Int | `0` | Size of the grant that opened this period, so the UI can show "x of y". |
| `scoutSpentSeason` | Int | `0` | Focus burned this league year, for the scouting department screen. |

Build the scouting economy so focus is a **finite per-period allowance, not a
growing pile**: when the league moves past `scoutPeriod`, top the balance up and
discard any unspent carry-over above a fixed fraction of the new grant.

Relations: `players`, `staff`, `scouts`, `homeGames`/`awayGames` (named relations
`HomeTeam`/`AwayTeam`), `ownedPicks`/`originalPicks` (named
`PickOwner`/`PickOrigin`), `reports`, `depthChart`, `tradeOffersFrom`,
`seasonRecords`, `playerSeasons`, `shortlist`, `negotiations`, `powerSnapshots`,
`capCharges`, `championRosters`. Index `@@index([leagueId])`.

Do **not** add `offScheme` or `defScheme` columns. They existed and were deleted
for measured reasons — see §5.4 #18.

### 2.4 Staff

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `teamId` | String | — | Cascade. |
| `role` | String | — | `"HC" \| "OC" \| "DC" \| "ST"`. |
| `name` | String | — | |
| `rating` | Int | `50` | 0–100 overall. Placeholder; keep the impact curves in your tuning module, not here. |
| `playCalling` | Int | `50` | In-game boost to unit score. |
| `development` | Int | `50` | Offseason progression boost. |
| `contractYears` | Int | `3` | |
| `salary` | Int | `3_000_000` | |

Index `@@index([teamId])`. Do not add a `scheme` column (§5.4 #18).

### 2.5 Scout

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `teamId` | String | — | Cascade. |
| `name` | String | — | |
| `accuracy` | Int | `50` | 0–100. Higher ⇒ narrower scouted ranges and faster confidence gain. |
| `speed` | Int | `50` | Scouting points generated per week. |
| `specialty` | String | `"ALL"` | `"OL" \| "SKILL" \| "FRONT7" \| "SECONDARY" \| "ALL"` — the position group this scout is best at. |
| `salary` | Int | `500_000` | |

Index `@@index([teamId])`.

### 2.6 Player

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `leagueId` | String | — | Cascade. |
| `teamId` | String? | — | `onDelete: SetNull`. Null = not on a roster (free agent, retired, or in a draft pool). |
| `firstName`, `lastName` | String | — | |
| `position` | String | — | One of `QB RB WR TE LT LG C RG RT EDGE DT LB CB S K P`. Do **not** model a fullback — see §5.4 #8. |
| `age` | Int | — | |
| `experience` | Int | `0` | Completed pro seasons. |
| `heightIn` | Int | `73` | |
| `weightLb` | Int | `220` | |
| `college` | String | `"State"` | |
| `trueAttrs` | String | — | **JSON** map `attributeKey -> 0..99`. The real ratings. Never show them directly unless `settings.revealTrueRatings`. Keys, with the scouting difficulty to attach to each (0 = a stopwatch measures it, 1 = pure projection): physical — `speed` .1, `acceleration` .15, `agility` .2, `strength` .15, `durability` .7, `stamina` .4; mental, where the fog of war lives — `awareness` .9, `workEthic` .95, `football_iq` .85; QB — `armStrength` .1, `accuracy` .35, `deepAccuracy` .4, `pocket` .8, `decision` .85; carriers and receivers — `carrying` .5, `elusiveness` .35, `power` .35, `vision` .75, `catching` .4, `route` .6, `release` .55, `contested` .45; blocking — `runBlock` .45, `passBlock` .5, `footwork` .5; plus the defensive and special-teams keys the rating spec in Part 2 defines. |
| `trueOvr` | Int | — | Cached overall computed from `trueAttrs` at the current position. Overwrite it at every development checkpoint. |
| `potential` | Int | — | 0..99 ceiling. |
| `devTrait` | String | `"Normal"` | `Slow \| Normal \| Star \| Superstar`. Keep it hidden until a Deep Dive reveals it. |
| `lastSeasonOvr` | Int? | — | **Where he finished last season.** Make it the only number the player card's year-over-year chip subtracts from `trueOvr`. Rules below — this column has a measured reason to exist. |
| `status` | String | `"ACTIVE"` | `ACTIVE \| INJURED \| FREE_AGENT \| RETIRED \| ROOKIE_POOL`. |
| `isDraftee` | Boolean | `false` | In the current rookie/fantasy pool. |
| `draftYear`, `draftRound`, `draftPickNo` | Int? | — | Draft provenance. Use `draftYear` as the **college class** key for the workout ledger. |
| `collegeStats` | String | `"{}"` | **JSON** `{ games: CollegeGameLine[] (one per college week), competitionGrade }`. Only meaningful while `isDraftee`. |
| `combineTesting` | String | `"{}"` | **JSON** `{ venue: 'COMBINE' \| 'PRO_DAY', fortyYard (s), vertical (in), broadJump (in), threeCone (s), shuttle (s), benchReps: number \| null }`. |
| `devFocus` | Int | `0` | Coaching/development charges bought with scouting focus. Each multiplies the next in-season development checkpoint roll and is consumed by it. |
| `yearsUnsigned` | Int | `0` | Consecutive offseasons spent unsigned. Drive the out-of-football attrition roll off this — without it the free-agent pool only ever grows, because nothing off a roster ages or retires. Reset to 0 on signing anywhere. |
| `weeksUnsigned` | Int | `0` | Consecutive **weeks** on the wire — every advance of the league clock while unsigned, in any phase. Price a free agent off this clock. |
| `injuryWeeks` | Int | `0` | |
| `injuryType` | String? | — | Human-readable, e.g. "Hamstring strain". Set on injury, clear on recovery. |
| `fatigue` | Int | `0` | 0–100, restores between weeks. |
| `morale` | Int | `70` | 0–100. Placeholder effect on re-sign odds. |
| `seasonStats` | String | `"{}"` | **JSON** `SeasonStats`. **Regular season only.** |
| `careerStats` | String | `"{}"` | **JSON** `SeasonStats`. Regular season only. |
| `playoffStats` | String | `"{}"` | **JSON** `SeasonStats`, postseason only. |
| `careerPlayoffStats` | String | `"{}"` | **JSON** `SeasonStats`, postseason only. |

Use this `SeasonStats` shape (every key optional, all integers): `gp`; passing
`passAtt passCmp passYds passTd int`; rushing `rushAtt rushYds rushTd fum`;
receiving `targets rec recYds recTd`; defence `tackles sacks defInt pd ff`;
kicking `fgm fga xpm xpa punts puntYds`.

**Keep four stat buckets, not two.** They shared one, and the simulator gates only
the *standings* on `kind === 'REGULAR'` — so a Super Bowl run silently added up to
four games of production, and four games of `gp`, to the season totals of the
twelve clubs that got there and none of the twenty that did not. League leaders
then ranked a 21-game back against a 17-game back on one list, which rewards
making the playoffs rather than playing well, and career totals inherited it. Keep
`seasonStats`/`careerStats` **regular season only**, because that is the convention
every real football reference uses when it says "career stats" and it is what every
ranking, award and record wants.

**Maintain `lastSeasonOvr` even though `PlayerSeason.endOvr` holds the same fact
per season.** `PlayerSeason` is written from box-score lines, and a box score names
about twenty-six men a club. Measured over a full league-season, 1,012 of 1,669
rostered men had a row — and **not one of 359 offensive linemen, at any of the five
positions, ever**. Backup quarterbacks were 42 of 102. A career-arc chip that is
structurally blank for 39% of every roster is, in the app owner's words, "a big
immersion killer". So stamp this column for every man still in football whether or
not anything he did showed up in a box score. Then:

- **Keep one source.** Have the chip read this column and never fall back to
  `PlayerSeason.endOvr` for men who happen to have a row. Two sources for one
  displayed number is how a card ends up disagreeing with itself. Have the season
  rollover copy this column *into* `endOvr` so the two cannot drift.
- **Stamp it the instant the final ends**, right after the award bumps and before
  any offseason step has touched anybody. That is the last moment `trueOvr` still
  means "what he finished the season at" — the very next step ages every roster
  and rolls development onto every unsigned player.
- **Render null as no chip at all** — not "+0", not a greyed box. Null is the
  state of every player in a save older than the column, of every draft prospect
  who has never played a professional down, and of every rookie until his first
  year is over.

Relations: `contract` (optional 1:1), `reports`, `depthSlots`, `draftPick`
(optional 1:1), `shortlistedBy`, `negotiations`, `seasons`, `championRosters`,
`transactions`. Index `@@index([leagueId])`, `@@index([teamId])`,
`@@index([position])`.

### 2.7 ScoutingReport — the fog of war

One row per (player, team) pair: one club's private opinion of one player.

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `playerId` | String | — | Cascade. |
| `teamId` | String | — | Cascade. |
| `confidence` | Int | `0` | 0..100. Drive how tight the displayed range is around the true value off this. |
| `observed` | String | `"{}"` | **JSON** `{ attrKey: observedValue }` — noisy observations. Display `observed ± error(confidence)`. **Resample and re-centre** observations as confidence rises. |
| `scoutedOvr` | Int | `0` | Cached scouted overall for list views. |
| `ovrLow` | Int | `0` | Cached range floor. |
| `ovrHigh` | Int | `99` | Cached range ceiling. |
| `notes` | String | `""` | Generated prose. |
| `lastWeek` | Int | `0` | Period key of the most recent pass. |
| `passes` | Int | `0` | Total passes ever run on this player by this team. Drive **both** cost escalation and reveal decay off it, so hammering one prospect gets steadily more expensive *and* steadily less informative. |
| `periodPasses` | Int | `0` | Passes inside the current period; reset when `lastWeek` moves. |
| `potConfidence` | Int | `0` | Give potential its own confidence track, and let only a Deep Dive push it above general confidence. That is what makes the deep tier worth its price. |
| `attrsRevealed` | String | `"[]"` | **JSON** array of attribute keys locked to their true value by an evaluation. |
| `devRevealed` | Boolean | `false` | True once a Deep Dive surfaced the hidden development trait. |
| `fullyRevealed` | Boolean | `false` | Write this from **only** the Dynasty "Full Scout" ability. When true, return true attributes and an exact potential: the one sanctioned hole in the fog of war, paid for with a per-season charge persisted on `DynastyProfile` so a page reload cannot restore it. Let nothing else in the codebase write it. |
| `revealedYear` | Int | `0` | League year the Full Scout reveal was bought. **Display only** ("Fully evaluated, 2027"). Never let it gate the reveal: a perfect evaluation you paid for does not expire. |
| `workoutYear` | Int? | — | The league **class** (`Player.draftYear`, *not* the league year) a private workout was held in. Two real jobs: stop a scarce workout slot being spent twice on the same prospect, and let the draft board mark a man already flown in. Key it on the class because the workout window spans the turn of the league year — stamp the league year instead and the same prospect can be worked out twice, once on each side of it. Do **not** let it gate the reveal; the reveal lives in `confidence`/`attrsRevealed` like every other one. |

Add `@@unique([playerId, teamId])` — one report per club per player. It prevents a
club accumulating several contradictory opinions of one man and it is the upsert
key for every scouting pass. Add `@@index([teamId])`.

### 2.8 ShortlistEntry

A club's personal draft board: prospects flagged to track through the season,
**independent of scouting confidence**. Fields: `id`, `playerId` (cascade),
`teamId` (cascade), `createdAt`. Add `@@unique([playerId, teamId])` so the same
prospect cannot be pinned twice, and `@@index([teamId])`.

### 2.9 Contract

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `playerId` | String | — | `@unique` + cascade. **Let the database enforce one contract per player.** |
| `teamId` | String? | — | See the instruction below this table. |
| `years` | Int | — | Total length as signed. |
| `yearsRemaining` | Int | — | |
| `signedYear` | Int | — | |
| `baseSalaries` | String | — | **JSON** `number[]`, per-year base salaries, index 0 = current year. |
| `signingBonus` | Int | `0` | Prorate it fully across `min(years + voidYears, 5)`. |
| `guaranteed` | Int | `0` | |
| `isRookieDeal` | Boolean | `false` | |
| `isFranchiseTag` | Boolean | `false` | |
| `fifthYearOption` | String? | — | `'EXERCISED' \| 'DECLINED' \| null`. |
| `voidYears` | Int | `0` | Cap-only trailing years tacked on (usually by a restructure) purely to spread signing-bonus proration further. The player is never on the roster for these. **Accelerate all remaining proration as dead money** the moment the real contract ends or the player is cut. |

**Treat `fifthYearOption` null as load-bearing in two directions**: it is the
state of a save written before the column existed *and* the state of a decision
still open, and those have to read the same way — an existing four-year rookie
deal must keep exactly the deal it has. Read it in exactly one place in the
arithmetic: proration. An exercised option adds a contract year that carries **no**
signing-bonus proration, because no new bonus is paid for it, so keep the divisor
on the four years the bonus was actually paid against. Bump `years` to 5 without
that and you re-spread a bonus three seasons have already been billed for — the
identical hole the franchise tag once had.

**Decide for yourself whether `Contract.teamId` gets a foreign key.** The
reference ships it as a bare string with no relation. That is a weakness, not a
pattern to copy: the identical omission on `CapCharge` produced 18,247 orphan rows
(§2.10). Contracts do cascade away with the player, so the orphan class is
narrower here. If you add the FK, keep the rule that **authoritative roster
membership is `Player.teamId`**, not this column.

### 2.10 CapCharge — dead money

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `teamId` | String | — | **Relation to Team, `onDelete: Cascade`.** |
| `year` | Int | — | League year the charge is billed in. |
| `amount` | Int | — | Dollars. |
| `label` | String | — | Human-readable origin, e.g. a cut's dead money. |

Add `@@index([teamId, year])` — the read is always "this club's charges for this
year".

**Do not ship this table without the foreign key.** It once carried a bare
`teamId` with no FK to anything. Deleting a league cascaded through Team, Player,
Contract and every other table and left the dead money behind, pointing at a team
id that no longer resolved. Nothing could read those rows again and nothing ever
deleted them, so they piled up: **18,247 orphans out of 22,203 rows** on the
development database — five of every six cap charges in it. Two separate agents had
to work around it and one deleted charges by hand before every teardown.

**Cascade from Team, and from nothing else.** Dead money is *meant* to outlive the
deal that created it — that is the entire point of it — so do not key it to
Contract or Player. A charge dies only when the club it is charged to dies, and a
club dies only when its league does (never delete a single team). So the cascade
fires on exactly one event: a save being deleted, where these rows are unreachable
by definition. Keep expiry separate: have a season-step sweep delete by **year**
once the bill has been settled, and make that sweep the only thing entitled to
decide a charge has been paid.

### 2.11 DraftPick

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `leagueId` | String | — | Cascade. |
| `year` | Int | — | |
| `round` | Int | — | |
| `slot` | Int | — | 1..32 within the round; assign it by reverse standings. |
| `originalTeamId` | String | — | Relation `PickOrigin`, cascade. Keep it so "Cleveland's 2029 second" is still sayable years after a trade. |
| `ownerTeamId` | String | — | Relation `PickOwner`, cascade. This is what a trade rewrites. |
| `used` | Boolean | `false` | |
| `playerId` | String? | — | `@unique`, `onDelete: SetNull`. The man selected with it. The unique constraint is what makes it impossible for two picks to claim the same player. |

Index `@@index([leagueId, year, round, slot])` — the draft board's read, and the
key that stops two picks sharing a slot — and `@@index([ownerTeamId])` for "my
picks".

### 2.12 DepthChartSlot

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `teamId` | String | — | Cascade. |
| `playerId` | String | — | Cascade. |
| `position` | String | — | A depth-chart **bucket**, not necessarily the player's listed position (`QB`, `RB`, `WR1`, …). |
| `rank` | Int | — | `0` = starter. |

Add `@@unique([teamId, position, rank])` so two men cannot hold one slot, and
`@@index([teamId])`. Remember this constraint when you write any data migration
that rewrites positions — it is why the fullback retirement had to **delete** FB
slots rather than convert them (§5.4 #8).

### 2.13 Game

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `leagueId` | String | — | Cascade. |
| `seasonYear` | Int | — | |
| `week` | Int | — | |
| `kind` | String | `"REGULAR"` | `REGULAR \| WILDCARD \| DIVISIONAL \| CONFERENCE \| FINAL`. Move the standings on `REGULAR` only. |
| `homeTeamId` | String | — | Relation `HomeTeam`, cascade. |
| `awayTeamId` | String | — | Relation `AwayTeam`, cascade. |
| `played` | Boolean | `false` | |
| `homeScore`, `awayScore` | Int | `0` | |
| `boxScore` | String | `"{}"` | **JSON**, shape below. |
| `recap` | String | `""` | Generated prose. |

Index `@@index([leagueId, seasonYear, week])`.

Write box scores in this shape:

```
{
  homeTeam / awayTeam : { id, abbr, name }
  quarters            : { home: number[], away: number[] }
  finalHome, finalAway: number
  teamStats           : { home: TeamGameStats, away: TeamGameStats }
  lines               : { home: BoxLine[], away: BoxLine[] }
  drives              : DriveResult[]
  units               : { home: { off, def }, away: { off, def } }
  injuries            : { playerId, name, teamId, weeks, type }[]
}

BoxLine       = { playerId, name, position, stats: SeasonStats }
DriveResult   = { team: 'home'|'away', result: 'TD'|'FG'|'PUNT'|'TURNOVER'|'DOWNS'|'END_HALF',
                  points, plays, yards }
TeamGameStats = { totalYards, passYards, rushYards, firstDowns, turnovers, sacks,
                  timeOfPossession (seconds), thirdDownConv (string), penalties,
                  penaltyYards }
```

Persist `units` — the unit ratings that actually fed the sim — so the recap can
explain itself rather than asserting a result.

**Treat stored box scores as immutable history.** Never recompute one. They are
the only place "which club did he play for that week" exists, which is what makes
`PlayerSeason` possible at all, and their immutability is why a tuning change or a
dropped column cannot reach back into a season already played.

### 2.14 Transaction — the league wire

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `leagueId` | String | — | Cascade. |
| `seasonYear`, `week` | Int | — | When. |
| `type` | String | — | `SIGN \| CUT \| TRADE \| DRAFT \| INJURY \| RESIGN \| TAG \| PROGRESS \| NEWS \| CHAMPION \| FIRE` (coordinator fired for a poor record) `\| OPTION` (a first-rounder's fifth-year option answered, either way). Write award rows with `AWARD_*`-shaped headlines, because the Dynasty XP derivation reads them back. |
| `teamId` | String? | — | Plain column, no relation. |
| `playerId` | String? | — | **The man the row is about, when it is about one.** `onDelete: SetNull`. |
| `headline` | String | — | |
| `detail` | String | `""` | |
| `createdAt` | DateTime | now | |

Index `@@index([leagueId, seasonYear, week])` for the wire and
`@@index([playerId])` for "everything that ever happened to this man" — his page
and the provenance panel behind it.

**Do not skip `playerId` and put the name in the headline.** That is what the
reference did, and the consequences were: the trophy screen had to match the
Championship MVP back to a box line **by name** to recover a portrait, and the
History page, the GM honours list and the league wire could name a player they
could not link to. A name is not an identity — two men can share one, and a rename
or a format change silently breaks every reader at once. Keep it nullable, because
plenty of rows are not about a player (CHAMPION, FIRE, NEWS, TRADE — which is about
two clubs and a package); let null mean "not known / not applicable", never "no
player". Use `SetNull`, not `Cascade`: a transaction is a historical record and
must survive the player being deleted. Losing the link is acceptable; losing the
fact that the signing happened is not.

### 2.15 TradeOffer

Unsolicited AI offers — the CPU approaching the user. **Persist them** rather than
generating fresh per page load, so an offer survives a refresh and the user can act
on it whenever they reach the Trade screen instead of only at the instant it was
generated.

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `leagueId` | String | — | Cascade. |
| `fromTeamId` | String | — | Relation, cascade. |
| `toTeamId` | String | — | Plain column. Always the user's team for now — do not surface AI-to-AI offers. |
| `give` | String | `"[]"` | **JSON** `TradeAsset[]` — what `fromTeam` is offering. |
| `request` | String | `"[]"` | **JSON** `TradeAsset[]` — what it wants back. |
| `blurb` | String | — | The front office's own words. |
| `status` | String | `"PENDING"` | `PENDING \| ACCEPTED \| DECLINED \| EXPIRED`. |
| `seasonYear`, `week` | Int | — | |
| `createdAt` | DateTime | now | |

Define `TradeAsset = { type: 'PLAYER' | 'PICK', id }` where `id` is a playerId or a
draftPickId. **It arrives as JSON from the browser**, so prove every id in it
belongs to the caller's league before you resolve any of them — §3.5.

Index `@@index([leagueId, toTeamId, status])` for "my pending offers".

### 2.16 TeamSeasonRecord

Franchise history. Because `Team.wins/losses/...` reset every offseason, **make
this the only place a season's result survives past the year it happened** — write
it the moment the championship game completes, right before that reset runs.

Fields: `id`, `leagueId` (cascade), `teamId` (cascade), `year`, `wins`, `losses`,
`ties`, `pointsFor`, `pointsAgnst`, `playoffResult` (default `"MISSED"`; one of
`MISSED | WILDCARD | DIVISIONAL | CONFERENCE | RUNNER_UP | CHAMPION`).

Add `@@unique([teamId, year])` — one record per club per season. Use it as the
**idempotency key** so a re-entered offseason step cannot write a second 2027 for
Cleveland. Add `@@index([leagueId, year])`.

### 2.17 PlayerSeason

One player's production in one season **for one club** — the row behind the
year-by-year stat table on the player page.

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `leagueId` | String | — | Cascade. |
| `playerId` | String | — | Cascade. |
| `seasonYear` | Int | — | |
| `teamId` | String? | — | `SetNull`. The club he played for **that year** — the entire point of the row. Nullable only so a deleted Team cannot take the row with it. |
| `teamAbbr` | String | — | Denormalise it alongside `teamId` so the crest and the label survive that deletion. |
| `age` | Int? | — | His age that season. **Treat null as a real answer, not a missing one**: render a dash where the arithmetic cannot be trusted. A fabricated 24 is worse than a dash. |
| `gp` | Int | `0` | Regular-season games played. |
| `firstSeen` | Int | `0` | Where his **first** game for this club fell in the season, as a sortable position (offset playoff weeks past the regular season, since they restart at 1). Only matters for a mid-year trade — without it the two rows of a split season come back in whatever order Postgres feels like and the table says he played for the new club first. Ordering by insertion or by id would have worked *by accident* of how cuids are generated; do it on purpose. Default it rather than making it nullable, so the sort key is never NULL. |
| `stats` | String | `"{}"` | **JSON** `SeasonStats`, same keys the box score wrote. **Regular season only.** |
| `playoffStats` | String | `"{}"` | **JSON** `SeasonStats`, postseason half of the same season. Leave it zero-valued for the twenty clubs a year that do not get one, and render that as "no postseason games" rather than a row of zeroes. |
| `playoffGp` | Int | `0` | Postseason games, counted separately — a column headed "G" next to regular-season yardage has to count the games those yards came from. |
| `endOvr` | Int? | — | His overall at the end of that season. **The only rating history there is.** |

**Key it on (player, year, team), not (player, year).** A player traded mid-season
gets one row per club, because "which club did he produce for" is the question a
year-by-year table exists to answer, and one row averaged across two jerseys
answers it wrongly while looking authoritative. Re-combine them in the display into
a "2TM" summary line above the pair, the way every real football reference does.

**Write this table from played box scores, not from `Player.seasonStats`.** The box
scores are the only place the club-he-played-for-that-year exists at all;
`Player.seasonStats`/`careerStats` are merged blobs with no season and no team on
them, which is why this table has to exist. Write it once a year.

**Do not backfill `endOvr`.** Null means *nobody wrote his rating down that year*,
and every reader must show no chip rather than a wrong one. There are three ways to
get a null and they are the same fact: (a) every row in a save older than the
column — that rating is genuinely gone, and a backfill would have to invent it,
because the only number on disk is what he is rated **today**, which is a different
year's answer wearing this year's label; (b) every season a catch-up sweep replays
out of old box scores — so have the sweep stamp the current rating **only** on the
season it is *closing*, never on the years it backfills underneath it; (c) a man
with no row for the year at all, because this table comes from box-score lines.
**`endOvr` is the one column here not derivable from box scores**, so if you ever
write a rebuild path that replays the games, make it *carry these values across*
rather than recompute them.

Add `@@unique([playerId, seasonYear, teamAbbr])`. It serves "every season for one
player, oldest first" as a prefix scan and it is the **idempotency key**: re-running
a rollover must not double a season. Add `@@index([leagueId, seasonYear])` for the
per-league sweep and the delete-and-rewrite of a single year.

### 2.18 ChampionRoster

Who was holding the trophy. Write one row per man on the champion's roster **the
moment the final ends** — that is the last instant that roster still exists, three
advances before free agency, retirements and the draft begin rewriting it. Make it
the only record of a championship roster, and treat it as such.

Fields: `id`, `leagueId` (cascade), `seasonYear`, `teamId` (cascade), `playerId`
(cascade).

**Do not try to serve this off `PlayerSeason`.** That table comes from box-score
lines, and a box score names the quarterback, three backs, six receivers, fourteen
defenders and two specialists. Measured on a real champion's 49-man roster: **31 men
had a row, 18 had none, and every offensive lineman on the club — all ten — had
none.** A man who recorded no counting stat in the title year *and* has since left
the club is unreachable by any inference: nothing places him on that roster and
nothing contradicts it either. Four of one champion's 49 were exactly that case a
league year on.

**Do not instead write zero-stat `PlayerSeason` rows for whole rosters.** That is
~1,700 rows a league year against ~50 here, and it breaks that table's stated
contract — "which club did he *produce* for" — which the GM tenure computation counts
off and which the player page renders one row per. Every offensive lineman in the
league would gain an empty stat line every season.

Cascade both relations: a champion roster is meaningless without the club or the
man, and unlike a `CapCharge` there is no bill left behind to answer for.

Add `@@unique([playerId, seasonYear])`. A man is on exactly one roster at a time, so
he can hold at most one trophy in a season, which makes this both the natural key
and the **idempotency key** — write with `skipDuplicates` so a re-entered offseason
step cannot double a roster. Do **not** add `teamId` to that key: it would be
strictly weaker (it would admit the same man on two champions in one year) and buys
nothing. Add `@@index([leagueId, seasonYear])`.

Have the reader prefer these rows and keep any `PlayerSeason`-plus-ledger inference
only for titles won before this table existed, so an existing save does not regress.

### 2.19 LeagueRecord

Single-season and career statistical highs, checked and updated once per season
during the offseason stats rollover. Store **one row per (league, scope, category)
— the current holder, not full history.**

Fields: `id`, `leagueId` (cascade), `scope` (`SEASON | CAREER`), `category`
(matching `SeasonStats` keys, e.g. `"passYds"`, `"sacks"`), `value`, `playerId`,
`playerName` (denormalised), `teamAbbr` (denormalised), `seasonYear` (the season it
was set in for SEASON, or last improved in for CAREER).

Denormalise those two strings so a retired or traded holder still displays
correctly.

Add `@@unique([leagueId, scope, category])` — it makes the per-season check an
upsert and makes it impossible for two concurrent rollovers to create two holders
of one record. Add `@@index([leagueId])`.

### 2.20 TradeRecord

Snapshot exactly what was traded and what it was worth at the time, one row per
trade, independent of the transaction feed. Do this because the plain `Transaction`
row for a trade only ever recorded asset **counts** ("sends 2 asset(s)"), never
identities — so there was nothing to grade retrospectively.

Fields: `id`, `leagueId` (cascade), `seasonYear`, `week`, `teamAId`, `teamBId`,
`teamAAbbr`, `teamBAbbr` (denormalised — a team can be renamed or relocated later;
not supported today, but cheap insurance), `aToB`, `bToA` (**JSON**
`TradeAssetSnapshot[]`), `createdAt`.

`TradeAssetSnapshot = { type: 'PLAYER'|'PICK', id, label, position?, ovr?, value }`.
Make `id` the **original** asset traded. Carry `ovr` — his rating the day he was
dealt — so the wire can say "91 OVR EDGE Marcus Lane" without re-reading a row that
has since moved, and so a retrospective years later shows what the club thought it
was buying rather than what he became. Keep `ovr` **optional**: every record written
before the field existed has no answer, and a career page must not print a confident
0 for a man nobody measured. Price both sides with the same neutral valuation (no
team need, no context) used everywhere else, at the moment of the trade.

Add `@@index([leagueId, createdAt])`.

### 2.21 DynastyProfile

Persist only this much of the Dynasty/GM progression system. **Do not store Dynasty
XP or level.** Recompute both on every read as a pure function of history the
database already holds (`TeamSeasonRecord`, CHAMPION and award `Transaction` rows,
`DraftPick -> Player`). That keeps XP self-healing for saves that predate the
feature, impossible to farm by repeating an action, and — the reason it is worth
doing this way — **requires no hook in the season machine at all.**

Store only what cannot be derived: which skills the GM chose to buy, and how many
per-season ability charges have been burned.

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `ownerKind` | String | `"LEAGUE"` | `"ACCOUNT"` would key on a user id instead. |
| `ownerKey` | String | — | `== leagueId` while `ownerKind` is `"LEAGUE"`. |
| `leagueId` | String? | `@unique`, cascade | A **convenience** relation. Make `(ownerKind, ownerKey)` the real key and read through one lookup helper, so a future account-wide mode can leave this null — that then becomes a resolver change, not a rewrite. |
| `skills` | String | `"{}"` | **JSON** map `skillId -> rank purchased`, e.g. `{"EVALUATIONS":2}`. Treat an absent key as rank 0. |
| `fullScoutYear` | Int | `0` | League year the Full Scout counter applies to. |
| `fullScoutUsed` | Int | `0` | Charges burned in that year. |
| `insiderYear` | Int | `0` | The same ledger for the Negotiation branch's Insider ability. Keep it separate so the two scarcities tune independently. |
| `insiderUsed` | Int | `0` | |
| `workoutYear` | Int | `0` | Private-workout slot ledger. Stamp it with the **college class** (`Player.draftYear`), not the league year — see below. |
| `workoutUsed` | Int | `0` | |
| `createdAt` | DateTime | now | |
| `updatedAt` | DateTime | `@updatedAt` | |

**Use the stamped-counter pattern for every per-period allowance.** Tag the counter
with *what it belongs to*, so it reads as zero the moment that thing moves and the
reset **needs no hook anywhere to be correct**: when `League.seasonYear` moves past
`fullScoutYear`, treat the counter as 0 and rewrite it on the next spend. Do **not**
store the allowance itself (a baseline entitlement plus any upgrade) — keep it in
tuning, so retuning applies to every save at once.

Stamp the workout ledger with the **class**, not the league year. Workouts are
budgeted against a class of prospects, and a class is generated in one league year
and drafted in the next; a per-year counter refilled itself halfway through the
class's life and paid out twice for the same four hundred men. Have the season
machine zero it where a new class is minted, purely so the count on screen turns
over with the new board instead of on the next spend.

Add `@@unique([ownerKind, ownerKey])`.

### 2.22 NegotiationTalks

Track how much patience a GM has burned in one negotiation, **server-side**.

Patience is the loss condition of the contract minigame: every offer he turns down
costs a pip, a genuine lowball costs two, and when they run out his agent stops
taking calls — on the open market he signs with whoever else is bidding and he is
gone for good. **That only means anything if it survives.** The first version passed
the count up from the browser, so pressing F5 reset it to zero and a GM could lowball
the same free agent forever — which is the "they accept everything" behaviour the
whole minigame was built to remove, wearing a slider. So keep the count here, let
the server be the only thing that ever writes it, and have the client send no count
at all: it renders whatever the server hands back.

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `leagueId` | String | — | Cascade. |
| `teamId` | String | — | Cascade. |
| `playerId` | String | — | Cascade. |
| `seasonYear` | Int | — | The league year these talks belong to. **Part of the key, not a stamp.** |
| `patienceSpent` | Int | `0` | Pips burned so far. Never decrease it within a league year. |
| `dismissedAt` | DateTime? | — | **Set aside** — "not now", on the re-sign list. Null = still on the list to be worked; a timestamp = parked, so a twenty-deep list can be triaged top to bottom. Do not make it "let him walk" (that is its own control, and it releases him) and do not charge patience for it — read this column from nothing in the negotiation logic, so parking a man cannot change what he will sign for. Name and count whoever is still set aside when the RESIGN phase ends, in the advance warning, before anybody is allowed to walk. |
| `updatedAt` | DateTime | `@updatedAt` | |

Add `@@unique([teamId, playerId, seasonYear])` — exactly the set of things that make
a negotiation *the same negotiation*. A new league year is a new negotiation (new
asking price, new market), so put the year in the key and prune prior-year rows;
delete his rows when he signs anywhere, so a player cut and returning to the market
starts fresh; and make reloading, navigating away or restarting the server change
nothing. Add `@@index([leagueId, seasonYear])` and `@@index([playerId])`.

**Do not write a row per opened panel.** Write one only when patience is actually
**spent**. A GM who opens talks with forty free agents and walks away from all forty
must write nothing at all — opening the panel is free, and it should be, because it
is free in the fiction too. With the prior-year prune on every write, the table stays
bounded by "negotiations you actually made an offer in, this league year".

**Do not add a "walked away" column.** Derive it as
`patienceSpent >= context.patience` from the live context every time. Storing it
would be a second source of truth for one fact, and the two would drift the first
time a player's patience moved — which it does, with rival interest.

### 2.23 User

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `username` | String | `@unique` | **As typed**, for display. |
| `usernameKey` | String | `@unique` | `username.toLowerCase()` — the actual lookup key, so "Habib" and "habib" cannot both exist. Do this with a second column rather than citext or a functional index: Postgres has no portable case-insensitive unique index and Prisma models neither, so a second column is the boring, migratable way to say the same thing. |
| `email` | String? | `@unique` | Add it nullable and unique, and **never collect it in the sign-up form**. It exists so adding a Discord login (which supplies one) or an opt-in recovery address later is a *write* rather than a migration. Do not ask for one now: an unverified address is not a recovery mechanism, so collecting it would be a promise the app cannot keep. |
| `passwordHash` | String? | — | scrypt, in a versioned self-describing format. **Keep it nullable**: an OAuth-only account has no password, and putting a hash-shaped placeholder in a column where "no password set" is the truthful answer is how a login path grows a bug. |
| `leaderboardOptIn` | Boolean | `false` | **Public leaderboard consent. Default false, and that default is the whole point**: a beta tester who signed up to keep their saves has not agreed to have their username and their franchise's record published on a page anyone can read. Make opting in one toggle, and make opting **out delete every `DynastyRank` row** this account has rather than merely hiding them. Default it rather than making it nullable, so the column is a boolean everywhere and can be added to a live table — an existing account lands on `false`, which is the answer nobody has to be asked for. |
| `createdAt` | DateTime | now | |

Relations: `sessions`, `leagues`, `ranks`.

Hang ownership off `User`, never off a credential. A password is one way to prove
you are a `User`; a Discord account will be another. Adding Discord later should be
a new `Account` table (`provider`, `providerAccountId`, `userId`) plus a callback
that resolves to a `User` and calls the same `createSession()` — with the ownership
model, the claim flow and all three enforcement points untouched. Build it so that
is true.

### 2.24 Session

Use server-side sessions. Put a random 32-byte token in the cookie and store **only
its SHA-256** here, so a database dump contains no usable session. SHA-256 is right
*here* and wrong for a password: the token already has 256 bits of entropy, so there
is no dictionary to run and no salt to add. Use a table rather than a JWT **because
sign-out has to actually invalidate**, which is the thing a JWT strategy cannot do.

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `tokenHash` | String | `@unique` | SHA-256 hex of the cookie token. |
| `userId` | String | — | Cascade. |
| `createdAt` | DateTime | now | |
| `expiresAt` | DateTime | — | Absolute expiry, slid forward on use. |
| `lastSeenAt` | DateTime | now | Bump it **at most once a day**, so a sliding expiry is not a write on every request of every page. |
| `userAgent` | String? | — | **Diagnostics only. Never consult it when deciding whether a session is valid** — a session is valid because its token hashes to a live row, not because the request looked familiar. Truncate to 255 chars. |

Index `@@index([userId])` and `@@index([expiresAt])`.

### 2.25 AuthAttempt

Keep the rate-limit ledger for sign-in, sign-up and password change in Postgres.
**Do not add Redis.** This deployment has one database, and a `COUNT` over an
indexed time window answers the question correctly. A second stateful dependency
that could be down — failing every login, or failing open — is worse than this.

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `scope` | String | — | The bucket being counted. Use `"u:<usernameKey>"` to throttle an attack on one account and `"ip:<addr>"` to throttle one source spraying many. **Check both on every sign-in, because they stop different attacks.** |
| `kind` | String | — | `SIGNIN \| SIGNUP` (plus `CHANGE` for password changes). |
| `success` | Boolean | `false` | Count failures only. |
| `at` | DateTime | now | |

Index `@@index([scope, kind, at])` for the count query and `@@index([at])` for the
retention sweep.

### 2.26 DynastyRank — the public leaderboard

One row per **franchise** eligible to appear on the public board.

Store a table here even though Dynasty XP is otherwise never stored, because a board
has to `ORDER BY` something across every save in the database at once, and
re-deriving XP per league is a handful of queries per league. Treat it as a
**materialisation, not a second source of truth**: rewrite every row from the XP
computation in the same request that renders the board, and **delete** any row whose
save has been deleted, unclaimed or opted out rather than leaving it to go stale.

**Do not add a `level` column.** A stored level is a number that can disagree with
the level-from-XP function, and this project has shipped exactly that bug more than
once. Compute the level from `xp` at render time with the same function the Dynasty
screen calls. Ordering by xp and ordering by level are the same ordering, because the
curve is monotonic, so nothing is lost.

**Do not key it on League.** Football, baseball and basketball are meant to feed one
board. Make `sport` the discriminator and make `saveKey` a plain `String` rather than
a foreign key to `League`, so a second game can insert its own rows without this
schema knowing anything about its save table. What the sports **share is `User`** —
identity lives on the account, so adding a sport is new rows, never a migration of the
identity model. Accept the cost: orphan cleanup becomes the refresh sweep's job rather
than the database's, so write that sweep and test it.

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `sport` | String | — | `"FOOTBALL"` today. **Never hardcode it in the board query** — derive the sport tabs from the sports actually present. |
| `saveKey` | String | — | The save's id in that sport's own id space. For FOOTBALL use `League.id`. |
| `userId` | String | — | **Cascade**: deleting an account must take its public rows with it, unlike `League.userId` which deliberately leaves the save behind. |
| `xp` | Int | `0` | The **only** ranking input. |
| `seasons` | Int | `0` | The denominator. Show it on every row: a level with no seasons beside it is a number without a unit. |
| `wins`, `losses`, `championships` | Int | `0` | |
| `seasonsToTitle` | Int? | — | How many seasons it took to win the first title on a save founded as a REBUILD that never took the handcuffs off. **Lower is better — the only column here where that is true.** Null is the common case and **is not a zero**: it means "this save has no ranked answer" — not a Rebuild run; a Rebuild run that has not won yet; a Rebuild run whose GM abandoned the ironman rules before winning. Never render a null as a number: show a run still going as in progress and do not rank it at all. **Derive it, like every other column here**: `firstChampionYear - tenureStartYear + 1`, recomputed from `TeamSeasonRecord` on every board load, in exactly one function. Do not stamp it at the moment of the win — a stamped number is a number that can drift from the history it claims to describe. |
| `teamName`, `teamAbbr`, `crestSeed` | String | — | Enough identity to render the franchise the way the rest of the app does. Set `crestSeed` to whatever that sport's logo generator takes (`Team.id` here). |
| `updatedAt` | DateTime | `@updatedAt` | |

Add `@@unique([sport, saveKey])` — one row per save, and the target of the refresh
upsert. Add `@@index([sport, xp])` for the board's read (everything for a sport, best
first) and `@@index([userId])`.

Define "seasons to first championship" in one place and use this rule: **the founding
season is season 1.** A GM who takes over a wreck and wins the title in the year he
arrives scores 1, not 0 — he played a season and won it. Count inclusively of the
season the title was won in and every season before it, and stop there: seasons played
after the first title are not part of the climb and must not count against it.

### 2.27 PowerRankingSnapshot

| Field | Type | Default | What it is for |
|---|---|---|---|
| `id` | String | cuid | |
| `leagueId` | String | — | Cascade. |
| `teamId` | String | — | Cascade. |
| `seasonYear` | Int | — | |
| `week` | Int | — | The week these rankings were published **for**, i.e. entering this week. |
| `rank` | Int | — | 1–32, the ordering that was actually displayed. |
| `powerIndex` | Float | — | The published index; league average 50. |
| `rating` | Int | — | The club's overall rating at the time. |
| `wins`, `losses`, `ties` | Int | — | Record at the time. |
| `netPerGame` | Float | — | |
| `createdAt` | DateTime | now | |

Build this table for one reason: **movement cannot be recomputed.** A team's rating
depends on the roster as it is right now, so a club that signed a free agent on
Tuesday would retroactively rewrite what it was ranked on Sunday. "Up 4 from last
week" is only honest if last week was written down last week.

Map the weeks like this: because the postseason resets `League.week` to 1 for four
rounds, map everything from the playoffs on to **one terminal week
(`seasonLength + 1`)** — the final regular-season ranking, which stops moving because
nothing behind it moves. **Never snapshot offseason phases**: they reuse week numbers
across five phases and every record is 0-0 anyway.

Add `@@unique([leagueId, seasonYear, week, teamId])` — one row per club per
league-week. Insert with `skipDuplicates`, so two concurrent renders cannot produce two
versions of the same week and a week already on record is never rewritten. **The whole
point of a snapshot is that it says what we thought then.** Add
`@@index([leagueId, seasonYear, week])`.

### 2.28 Verify every constraint does its job

Before you move on, confirm each of these exists and understand what it stops:

| Constraint | What it prevents |
|---|---|
| `DraftState.leagueId @unique` | Two concurrent drafts in one save. |
| `Contract.playerId @unique` | A player under two contracts. |
| `DraftPick.playerId @unique` | Two picks claiming the same player. |
| `ScoutingReport @@unique([playerId, teamId])` | A club holding contradictory opinions of one man; it is also the scouting upsert key. |
| `ShortlistEntry @@unique([playerId, teamId])` | The same prospect pinned twice. |
| `DepthChartSlot @@unique([teamId, position, rank])` | Two men in one depth slot. |
| `TeamSeasonRecord @@unique([teamId, year])` | A duplicate season of franchise history from a re-entered offseason step. |
| `PlayerSeason @@unique([playerId, seasonYear, teamAbbr])` | A doubled season on a re-run rollover; also the per-club split key. |
| `ChampionRoster @@unique([playerId, seasonYear])` | A doubled champion roster, and one man on two champions in a year. |
| `LeagueRecord @@unique([leagueId, scope, category])` | Two holders of one record. |
| `NegotiationTalks @@unique([teamId, playerId, seasonYear])` | A second patience counter for the same negotiation — i.e. a reset by reload. |
| `DynastyProfile @@unique([ownerKind, ownerKey])`, `leagueId @unique` | Two progression profiles for one owner. |
| `DynastyRank @@unique([sport, saveKey])` | A save appearing twice on the board. |
| `PowerRankingSnapshot @@unique([leagueId, seasonYear, week, teamId])` | A rewritten past week — the thing that would make "up 4" a lie. |
| `User.username`, `User.usernameKey`, `User.email` all `@unique` | Duplicate accounts, and case-variant impersonation. |
| `Session.tokenHash @unique` | Two sessions sharing a token. |
| `CapCharge.teamId → Team ON DELETE CASCADE` | Unreachable dead-money rows surviving a deleted save (18,247 of them, once). |
| `Transaction.playerId → Player ON DELETE SET NULL` | History being destroyed with the player. |
| `League.userId → User ON DELETE SET NULL` | A deleted account taking its dynasties with it. |
| `DynastyRank.userId → User ON DELETE CASCADE` | A deleted account's public rows outliving it. |

---

## 3. Accounts, sessions and ownership

### 3.1 Run both ownership mechanisms at once

Keep cookie ownership and account ownership live simultaneously. This is a
single-player game, and a wall in front of someone who wants to try it costs more
than it protects. Signed out, everything must work: mint an opaque `randomUUID` into
an httpOnly cookie named `dgm_owner` (path `/`, `sameSite: lax`, `maxAge` **ten
years**, because these are save files and an expiring cookie is a deleted dynasty)
and stamp it onto `League.ownerKey` at creation. Signing up turns that cookie-owned
save into an account-owned one, and from then on it survives a cleared cookie and
follows the person to a second device.

| Field | Meaning you must preserve |
|---|---|
| `League.ownerKey` | The browser that made it, while signed out. **Retain it forever.** |
| `League.userId` | The account that has **claimed** it. Once set, the cookie no longer grants access. |

Build the cookie boundary even though it is not authentication. Without it, the home
page lists **every** league in the database and the delete action deletes any id it is
handed — which is exactly what happened: two testers on one deployment saw each
other's franchises and either could destroy the other's twenty-season dynasty with one
click.

### 3.2 Implement the ownership predicate once

```
ownsLeague(league, viewer):
  1. league.userId == null && league.ownerKey == null  ->  NODE_ENV !== 'production'
  2. viewer.userId != null                             ->  league.userId === viewer.userId
  3. league.userId != null                             ->  false
  4. otherwise                                         ->  viewer.ownerKey != null
                                                            && league.ownerKey === viewer.ownerKey
```

Make this the **only** place ownership is decided, and route every enforcement point
either through it or through a Prisma `where` clause written to mirror it branch for
branch.

- **(1)** Treat rows with both columns null as legacy rows from before ownership
  existed. Show them in development so a developer's old saves do not vanish; make
  them invisible and undeletable in production, where an unowned save is precisely
  the thing nobody should be able to claim.
- **(2) Match a signed-in viewer on the account and nothing else.** Holding the
  cookie that originally created a save must not get you in once the save belongs to
  an account.
- **(3) Give a signed-out viewer no access to a claimed save at all**, even from the
  very browser that made it. This is what makes a shared browser safe: after Alice
  signs up on the family laptop, signing out must not leave her dynasty reachable by
  whoever sits down next, and Bob signing up must not be able to absorb it.

Rules 2 and 3 are strictly **tighter** than a cookie-only scheme. Do not loosen them
for convenience.

Build the list query to mirror it:

```
signed in  ->  { userId: me }                                  (+ fully-unowned rows in dev)
signed out ->  { userId: null, ownerKey: my cookie }            (+ ditto)
neither    ->  { id: '__no_owner__' }     // match NOTHING, explicitly
```

Include the `userId: null` on the cookie clause. Without it a signed-out browser
still lists a save it had already handed to an account — the shared-laptop leak.
And include the explicit match-nothing sentinel: `OR: []` is not "match all" in
Prisma today, but being explicit means a future edit cannot turn an empty clause list
into an unfiltered query by accident.

Write `assertLeagueOwner(leagueId)` and **do not let it adopt**. An earlier version
stamped an unowned league with the caller's key on first touch, on the theory that a
legacy save should become someone's. It made every unowned save claimable by whoever
loaded it first — and in development that is not a person, it is whichever headless
browser or test run hit the page. **Twenty-six leagues in the dev database were
silently claimed by throwaway Playwright sessions**, each with its own cookie, and
every one then returned 404 to every other client including the developer's own
browser. Put the deliberate version of that idea in the claim flow instead (§3.6),
where it runs once, on an action a person took, against exactly the leagues that
person's browser was already holding.

**Report a missing league exactly like one the caller does not own.** "No such
league" versus "not yours" tells a stranger which ids are real, and there is nothing
a caller can do differently either way.

Provide a separate read-only permission helper for Server Components that never
adopts and never mints a cookie — a Server Component may not write cookies and Next
throws if it tries. For the same reason, provide two cookie accessors: a read-only
one safe from a Server Component, and a mint-and-set one callable only from a Server
Action or Route Handler.

For actions addressed by team rather than league, write
`assertTeamOwner(teamId)` that resolves the team's league and defers to
`assertLeagueOwner`.

### 3.3 Build sessions to these parameters

| Parameter | Value | Why |
|---|---|---|
| Session cookie | `dgm_session`, httpOnly, `sameSite: lax`, path `/`, `secure` **in production only** | A secure cookie is never sent over plain HTTP, which would make sign-in silently impossible on a local `http://localhost` run. `lax` so following a shared link into the game keeps you signed in while a cross-site POST still cannot carry the session. |
| Session token | `randomBytes(32).toString('base64url')` | 256 bits from the CSPRNG. |
| Stored form | SHA-256 hex in `Session.tokenHash` | A leaked dump contains no usable session. |
| Session TTL | **60 days**, slid forward on use | Long because these are save files and being logged out mid-dynasty is a bad afternoon; not infinite, because a session that never expires is a credential that lives forever on a shared laptop. |
| Slide throttle | at most once per **24 h** | So a sliding expiry is not a write on every request. |
| Username rule | `/^[A-Za-z0-9_]{3,20}$/` after trimming; store `usernameKey` lowercased | |
| Password hash | **scrypt** from `node:crypto`, `N = 2^16`, `r = 8`, `p = 1`, keylen 32, salt 16 bytes, `maxmem = 128·N·r·2` (64 MiB) | ~200 ms and ~64 MB per verification on the measured hardware. Node's default `maxmem` is 32 MiB and would simply throw, so set the headroom deliberately. |
| Stored hash format | `scrypt$N$r$p$saltB64$hashB64` — exactly 6 `$`-separated fields | Versioned and self-describing, so raising `N` later invalidates nothing: old hashes keep verifying at the `N` they were made with and upgrade on next login. Add a `needsRehash` hook now so moving to argon2id later is a branch in `verify()`, not a migration and not a lockout. |
| Password length | min **10**, max **256**, enforced server-side in the one function every caller goes through | Ten rather than eight because this is an account whose only recovery path is "ask the operator", so a weak one costs more than usual, and nobody types it more than once a month. The max bounds the request body and the free CPU burn against a deliberately expensive function. **Make length the only rule** — composition rules push people toward `Passw0rd!` and are no longer recommended by anyone. |

Do not use `bcryptjs`, native `bcrypt`, or `@node-rs/argon2`. A cost-12 bcrypt in
pure JS is well over a second of *blocking* CPU on the single-threaded serverless
function that is also serving every other request, and dropping the cost to make it
tolerable defeats the point. The native bcrypt and argon2 packages are prebuilt
binaries that have to match Vercel's runtime, and this codebase has already been
bitten by exactly that class of problem (§1.2) — taking it again for a dependency in
the login path is the wrong trade. scrypt is memory-hard, in the standard library
(zero new runtime dependencies, nothing to build, nothing to pin), native C, and
listed by OWASP as acceptable.

Make verification a constant-time compare, and **return false rather than throwing on
a malformed record**: a corrupt row must read as "wrong password", not as a 500 that
tells a caller something interesting about the database. **Bounds-check the stored
`N`, `r`, `p`, do not merely parse them** — require `N` to be an integer in
`[1024, 2^20]`. Those numbers come out of the database and go straight into a memory
allocation, so a row claiming `N = 2^30` is a way to make one login attempt eat the
whole function. **Log nothing from the hashing path**: not the password, not the hash,
not the salt, not a truncated prefix of any of them.

Return **one message** for every sign-in failure — wrong username, wrong password, no
such account: `"Wrong username or password."` Anything more specific is a list of
which usernames exist, handed out for free.

On sign-out, **delete the server-side row first, then clear the cookie**. If the
response is lost in flight the session is already dead, rather than the reverse. Use
`deleteMany`, not `delete`, so an already-expired or already-deleted session signs the
user out cleanly instead of throwing "record not found" at someone trying to leave.

### 3.4 Rate limit with these numbers

| Limit | Window | Threshold |
|---|---|---|
| Sign-in failures against **one account** (`u:<usernameKey>`) | 15 min | 10 |
| Sign-in failures from **one address** (`ip:<addr>`) | 15 min | 40 |
| Sign-ups from **one address** | 60 min | 8 |
| Password changes per account | 15 min | 8 |
| Attempt-row retention | 24 h | prune opportunistically |

Check both sign-in buckets on every attempt. They stop different attacks: the
per-account limit stops a password spray at one known user, the per-IP limit stops one
source spraying many accounts. **Clear the per-account counter on a successful
login.**

Take the client address from the **first** entry of `x-forwarded-for` — on Vercel the
platform edge sets it and the first entry is the real client, while the rest is
whatever the client claimed — falling back to `x-real-ip`, truncated to 64 chars,
defaulting to `"unknown"`. Treat it as a best-effort throttling key, **not an
identity**: behind CGNAT many people share one and a determined attacker rotates
them, which is exactly why the per-account limit exists alongside it and is much
tighter.

**Do not add a cron job or a scheduled function to prune.** On roughly 2% of attempt
writes (`randomInt(50) === 0`), also delete rows older than the retention window. The
table stays small without anyone having to remember it exists. Wrap both the write and
the sweep in `.catch(() => {})` — a failure to record an attempt must not fail the
login.

### 3.5 THE SECURITY RULE: treat every Server Action as a public POST endpoint

Read this section before you write a single Server Action, and then enforce it
mechanically.

A Server Action is a public POST endpoint. The button that calls it, the page that
greys it out, and the TypeScript type on its signature are all **presentation**. The
only thing between one player's save and another's is what the function itself checks
on the way in.

`assertLeagueOwner(leagueId)` proves the caller may act on **this league**. It proves
**nothing** about the other ids they passed in the same request.

Here is what that cost. **Six contract actions stopped at the league check.** From a
save he legitimately owned, a caller could reach into another club — or another save —
and cut a rival club's best player, franchise-tag him, restructure his deal, or extend
him. Measured: a 99-overall receiver on Baltimore was extended, **his signing bonus
rewritten from $11.0M to $50.7M, and then he was released outright.** The codebase
already *stated* this standard — the "open extension talks" action checked
`player.teamId !== team.id`, and the extension module's header said a hidden button
protects nothing. It was simply only half kept: the open-talks side checked, the
submit-the-deal side did not.

Six **read-only** preview and panel actions had the weaker version of the same hole:
they looked their argument up by primary key alone and returned what came back.
Measured from a save the caller legitimately owned, the cut-impact action handed back
**a stranger's player by name, with his cap hit, his dead money and his club's
remaining cap space**, and the trade evaluator returned another save's front office
talking about its own right tackle ("He starts for us at RT — replacing him from
inside the building…") together with the number it valued him at. **A cuid is not a
secret** — it is on every URL and in every exported league file — so "you would have to
guess it" was never the boundary.

#### Follow this rule

> **Prove that every id arriving in a request belongs to the league the caller owns,
> in the same request, before you read or write anything with it.**

Build these guards and pick the right strength per action:

| Guard | What it proves | Use it for |
|---|---|---|
| `assertLeagueOwner(leagueId)` | the save is yours | every action, first, always |
| `assertTeamOwner(teamId)` | resolve team → league, then the above | actions addressed by team |
| `assertPlayerInLeague(leagueId, playerId)` | this row is part of the save you proved you own | **read-only** previews and panels |
| `assertTeamInLeague(leagueId, teamId)` | ditto for a club | read-only |
| `assertPlayerOnUserTeam(leagueId, playerId)` | he is on **your own roster** | every **write** against a player |
| `assertTradeAssetsInLeague(leagueId, assets)` | every asset in the proposal is in this save | every trade path |

Have `assertPlayerOnUserTeam` **return the user's team id**, so callers that need it
stop taking it from the client, and provide a `userTeamId(leagueId)` helper for actions
that were doing the same thing. Always answer "which club is mine" with a database read
of `Team.isUser`, never with a value the request carried.

Make `assertTradeAssetsInLeague` do input-shape work too, because the asset list
arrives as browser JSON:

- Refuse a non-array in the game's own words ("That proposal is not a list of assets")
  rather than letting it escape as `assets is not iterable`.
- Refuse an unrecognised `type` rather than letting it fall through to
  `draftPick.findUniqueOrThrow` and throw `No DraftPick found` at the client.
- Cap the list at **40 assets**. This is **not** arithmetic about roster sizes; it is a
  ceiling on how much work one unauthenticated-shaped request can ask the evaluator to
  do. A real proposal is a handful of assets.
- Compare counts against the **deduplicated** id sets, so naming the same man twice is
  caught here as "not in this save" rather than passing the check and failing inside
  the write.

**Make refusals indistinguishable** between "no such row" and "not in this save" — same
reason as §3.2. You may give a more specific, in-fiction refusal for a player on
another roster *inside the caller's own save* ("… plays for another club — that is not
your call to make"), because that case leaks nothing a player cannot already see.

#### Build the audit that enforces it

Write a script (`npm run audit:actions`) that walks **every exported async function in
`app/actions/**`** and proves three properties of each:

1. **Ownership** — called with another save's credential, it refuses *before* reading
   or writing anything.
2. **Membership** — called with the caller's **own** league id but an id belonging to
   another save (a player, a club, an offer, a trade asset), it refuses. This is the
   one that is easy to miss.
3. **Input** — handed a value outside its enum, a NaN, an Infinity, a negative, a
   colossal number, a wrong-shaped id or a 10 MB string, it answers in the game's own
   words rather than throwing a database error at the browser.

Build these four properties into it:

- **Discover the actions, do not list them.** Read every exported async function off
  the source, and make an action with no coverage entry a **failure, not a skip**. That
  is the whole point: the next action somebody adds without a guard fails the audit on
  the day it is added, without anyone remembering the audit exists.
- **Enumerate the actions with no league id to own, each named with the guard it
  actually has**, so the list can never quietly become "the ones we gave up on":
  sign-up and sign-in (the credential *is* the request; rate-limited in the auth
  module), sign-out (destroys only the session this cookie names), the
  leaderboard-visibility and password-change actions (re-read the session themselves
  and refuse a signed-out caller), and league creation (deliberately works signed out
  — that is the whole try-before-you-sign-up path; its guard is the creation ceilings,
  not ownership of anything).
- **Create your own leagues and delete them by id.** The database is shared and holds
  real saves, and the audit deliberately calls destructive actions, so never touch a
  league it did not make and clean up by collected ids rather than by matching on a
  name.
- **Print three canaries at the end.** A test that cannot fail is not evidence: (A) an
  assertion at a knowingly false claim, which must FAIL; (B) a read of a deliberately
  misspelled field, which must come back `undefined`; (C) a real read that passes. If A
  ever passes or B ever has a value, the harness is lying and nothing above it means
  anything.

### 3.6 Claim saves with one guarded UPDATE

Run
`UPDATE League SET userId = :me WHERE ownerKey = :cookie AND userId IS NULL`
as a single `updateMany`, on sign-up **and on every sign-in**. Accept these
consequences deliberately:

- *Signing in on a different browser that has its own unclaimed leagues*: **absorb
  them.** The cookie was the only credential those saves ever had, and the person
  signing in is the person holding it. The alternative — stranding a save that its
  creator is looking straight at — loses dynasties, which is the one thing this work
  exists to prevent.
- *A cookie whose leagues are already claimed by another account*: take nothing. Make
  `userId IS NULL` the whole guard and evaluate it **inside the single UPDATE**, so two
  simultaneous claims cannot both win a league.
- *Two accounts on one shared browser*: safe both ways. Alice's claimed saves are
  invisible to signed-out Bob (§3.2 rule 3) and untouchable by Bob's claim
  (`userId IS NULL` fails). Bob's own unclaimed saves stay his.
- **Do not clear `dgm_owner` on sign-out.** Rotating it would orphan any save not yet
  claimed. Leave it, and it stays harmless, because a claimed save is unreachable by
  cookie.

### 3.7 Ship this recovery story, and say so in the UI

- **Collect no email.** Ask for a username and a password and nothing else. An
  unverified email is not a recovery mechanism — anyone who can type an address they do
  not own can take over the account attached to it — and verifying one means a mail
  provider, a deliverability problem, and a blocked tester on the afternoon the beta
  ships. Keep the column; do not use it in the form.
- **Therefore ship no self-service password reset, and say so in the form, above the
  button** — not in a footnote. Provide an operator script that resets a password
  against the production database. That is the whole recovery story; write it down
  rather than implying it.
- **Do ship a self-service password change**, at `/account`. A reset is for somebody
  who cannot prove who they are; a change is for somebody who can — they type the
  current password. It exists because the operator reset above leaves a tester holding
  a credential somebody else chose, knows, and very likely typed into a chat window,
  with no way to replace it. In the change path: **verify the current password** (a live
  session cookie is *not* sufficient authority to replace the credential that outlives
  it); apply the same password policy sign-up uses; rate-limit on the same ledger; then
  **destroy every session on the account** — including the caller's, and immediately
  issue a fresh one for the browser that did the work. So a change made *because*
  somebody else has your password actually ejects them, and does not log the user out of
  the tab they are standing in.

### 3.8 Enforce creation ceilings

Write `assertCanCreateLeague(viewer)` to count two things and refuse with a typed
`LeagueLimitError` carrying a sentence the UI renders:

- **Mine** — `{ userId: me }` when signed in, else `{ userId: null, ownerKey: cookie }`,
  else the explicit match-nothing sentinel. Count the **account** when signed in:
  otherwise a player resets the counter by clearing a cookie they are no longer using
  for anything, and the cap means nothing to exactly the people it applies to. Include
  the sentinel fallback — both callers mint a key first, so a null `ownerKey` should be
  unreachable, but if one ever stops, `{ userId: null, ownerKey: null }` matches every
  legacy save in the database instead of none of them, and in a database holding more
  legacy rows than the per-owner cap that is not a loose limit, it is "nobody may create
  a league" with no obvious cause.
- **Everyone** — total `League` count against `MAX_LEAGUES_TOTAL`.

**Leave it advisory under concurrency, and document that.** Two simultaneous requests
from one browser can both pass and land one league over the cap. The overshoot is
bounded by concurrency and the cost of preventing it (serialising every creation) is
worse than the cost of being off by one.

Have the new-league page pre-check with **exactly the same `where` clause**, and
deliberately **not** off the visible owned-leagues list. The two differ: the visible
list also includes legacy fully-unowned saves in development, so counting rows on
screen puts the page behind a "slots full" wall while the action it guards would have
accepted the request happily. **A pre-check that disagrees with the real check is worse
than no pre-check.**

---

## 4. League creation and settings

### 4.1 Implement this settings surface

Persist every option as one JSON blob on `League.settings` and have the system that
owns each one read it. Where a setting is recorded but not consumed, mark it and make
the UI say so rather than pretend it does something.

| Key | Type | Default | Legal range | Editable after creation? | Effect |
|---|---|---|---|---|---|
| `capMode` | `'REALISTIC' \| 'SIMPLIFIED' \| 'OFF'` | `REALISTIC` | the three values | **yes** | Which cap system binds. Enable restructures and the proration machinery only under `REALISTIC`. |
| `difficulty` | `'EASY' \| 'NORMAL' \| 'HARD'` | `NORMAL` | the three values | **yes** | Scales AI sharpness and the user's scouting error; §4.3. |
| `leagueStart` | `'RANDOM_ROSTERS' \| 'FANTASY_DRAFT' \| 'REBUILD'` | `RANDOM_ROSTERS` | the three values | **NO — lock it forever** | How the league is dealt on day one. §4.4. |
| `seasonLength` | number | `17` | do not expose for edit | **no** | Regular-season weeks. Wire it up for real: schedule generation, in-season development checkpoints, the end-of-season trigger, the all-star cut-off. |
| `playoffTeamsPerConf` | number | `6` | not exposed | **no** | **Stored but unread in the reference.** See §6.1 and decide. |
| `rosterMax` | number | `53` | not exposed | **no** | Roster ceiling. Wire it to final cuts, free-agency headroom, the trade roster check, and the advance-blocking overflow warning. **Derive the floor from it** (§4.2). |
| `draftRounds` | number | `7` | not exposed | **no** | Rounds generated each draft, and the span of forfeited picks in a Rebuild hand. |
| `capGrowth` | `'FLAT' \| 'SLOW' \| 'FAST'` | `SLOW` | the three rungs | **yes** | How fast the ceiling climbs. Read §4.2 before touching this — it is the most consequential number in the game. |
| `scoutingEnabled` | boolean | `true` | — | **yes** | False ⇒ show true ratings everywhere. |
| `revealTrueRatings` | boolean | `false` | — | **yes** | Debug/casual toggle; it overrides scouting. |
| `fogOnOwnRoster` | boolean | `false` | — | **yes** | Whether the user fully knows his own players. |
| `scoutingBudgetPerWeek` | number | `100` | **0..10 000**, integer | **yes** | Intended as base scouting focus per week before scout speed. **Unread in the reference** — see §6.2. Allow `0`: it is a legal answer meaning "scouting runs on carry-over alone". |
| `progressionSpeed` | number | `1.0` | **0..5** | **yes** | Multiplier on in-season development rolls. 0 freezes development; 5 is already extreme. **Never allow negative** — a negative speed inverts every growth roll into decline. |
| `injuriesEnabled` | boolean | `true` | — | **yes** | |
| `injurySeverity` | number | `1.0` | **0..5** | **yes** | Multiplier on injury duration. |
| `retirementEnabled` | boolean | `true` | — | **yes** | |
| `tradesEnabled` | boolean | `true` | — | **yes** | |
| `aiTradeFrequency` | number | `0.35` | **0..1** | **yes** | How often AI clubs propose trades. It **is a probability**: a value outside 0..1 is not a rarer or commoner offer, it is a broken comparison. |
| `tradeDeadlineEnabled` | boolean | `true` | — | **yes** | On ⇒ no trades from `tradeDeadlineWeek + 1` through the rest of the league year. |
| `tradeDeadlineWeek` | number | `9` | **1..max(1, seasonLength)**, integer | **yes** | Last REGULAR week trades are allowed. 9 matches the real NFL's Tuesday-after-week-9 deadline. Map it onto the phase machine like this: closed for the rest of REGULAR once past the week, and closed for PLAYOFFS / OFFSEASON / RESIGN (still the same league year), reopening the moment FREE_AGENCY starts — this game's equivalent of the new league year beginning. |
| `franchiseTagEnabled` | boolean | `true` | — | **yes** | |
| `aiAcceptsLopsided` | boolean | `false` | — | **yes** | Off ⇒ the AI enforces a required value ratio of ~1.04; on ⇒ the bar drops to ~0.9. The club still gets a vote. |
| `forceTradeEnabled` | boolean | `false` | — | **yes** | The escape hatch. §4.7. |
| `simVariance` | number | `1.0` | **0..5** | **yes** | Multiplier on RNG spread. At 0 the better team wins. |
| `homeFieldAdvantage` | boolean | `true` | — | **yes** | |
| `simSeed` | string | `''` | not exposed | **no** | A fixed seed makes seasons reproducible. Fall back to the league id, so a save is deterministic per (seed-or-id, phase, week) even when blank. |
| `recapVerbosity` | `'SHORT' \| 'NORMAL' \| 'DETAILED'` | `NORMAL` | the three values | **yes** | |
| `showAdvancedStats` | boolean | `true` | — | keep off the form | Stored only; nothing reads it. |
| `autoAdvanceWeeks` | boolean | `false` | — | keep off the form | Stored only. |
| `confirmRiskyMoves` | boolean | `true` | — | keep off the form | Stored only in v1. |

Keep those last three out of the Settings screen rather than rendering controls that
do nothing, and preserve whatever an existing save stored by spreading the current
settings in your update.

### 4.2 Cap growth — use these rates and do not retune them casually

The cap used to rise **7% every year, unconditionally**, and the player who asked for
this change named the problem exactly: it got out of hand. Compounded over a dynasty
that is not a slow drift, it is a different game — `1.07^10 = 1.97`, so a league in its
eleventh season plays under nearly double the ceiling it opened with, while every price
in the cap module still answers in year-one dollars (the market-value and asking-price
functions take no season at all). **The squeeze the whole front office is built around
quietly stops binding.**

So make it a choice at the table, not a constant. Offer three rungs — not a raw
percentage box, which asks someone who has never played a season to have an opinion
about compounding, and because the interesting difference is not 2% versus 3% but
whether the ceiling moves **at all**.

| Rung | Rate | Label | Blurb to show |
|---|---|---|---|
| `FLAT` | `0` | Flat | A fixed ceiling. Nothing inflates away; a bad deal is bad forever. |
| `SLOW` | your `CAP_GROWTH_PER_YEAR` tuning constant — **1%** | Slow | **The default.** A drift you can feel across a decade and never lean on. |
| `FAST` | `0.07` | Fast | The old behaviour. Keep it so an existing dynasty plays as it did. |

**Alias the SLOW rung to the tuning constant itself**, not a second copy of it, so the
fallback curve your cap function uses when no league is passed and the rung a player
picks cannot drift apart.

These are the measurements the rates come from, over 20 league years against 32 real
generated clubs with every man priced through the market-value function (the median club
costs 88% of the base cap, against the ~92% the market scale is calibrated to). What
that club costs as a share of its own ceiling:

| Rung | year 1 | year 10 | year 20 | the squeeze is over in |
|---|---|---|---|---|
| FLAT | 87.9% | 87.9% | 87.9% | never |
| SLOW | 87.9% | 80.4% | 72.8% | year 14 |
| FAST | 87.9% | 47.8% | 24.3% | year 3 |

"The squeeze is over" means the first league year a club can carry that whole roster at
market **and** still sign the best quarterback in football (a 99 OVR at 27, at
$64.0M/yr) — the year keeping everyone good stops being a choice. At the old 7% that is
the **third** season of a dynasty.

**Default to SLOW at 1%.** A front-office game whose central tension expires on a timer
gets less interesting the longer you play it, which is exactly backwards for a dynasty,
so the default has to be a rate the roster can outrun for as long as anyone actually
plays. 1% is that: the squeeze survives to season 14 where 7% ended it in season 3. The
rate walked down **7% → 2% → 1.5% → 1%** across releases, each step for this reason and
each measured the same way. Do not default to FLAT: a ceiling that never moves is a real
answer but a strange default — no league in any sport has one, and a player who wants it
can pick it in one click.

**Do not rewrite an existing league's rate.** On read, pin a settings blob with **no
`capGrowth` key at all** to `FAST`, because that save *was* played at 7% and its clubs
signed every deal on those ceilings. Leave a save that already chose a rung on its rung.
Dropping a five-year dynasty from 7% to 1% takes roughly a third off its ceiling
overnight — clubs that were legal on the morning's cap sheet wake up over it, which is a
rule the player never broke and never agreed to — and **the season must not advance while
the user's own club is over the ceiling**, so an automatic downgrade could *freeze* a
save rather than rescue it. Offer the move on the Settings screen as the player's
decision, with that consequence stated on the control.

Format the rate as `Math.round(rate * 1000) / 10`, then `toFixed(0)` if the result is an
integer else `toFixed(1)`. A bare `toFixed(0)` was fine while every rung was a whole
percent and became a lying label the moment SLOW moved to 1.5%: it rendered "2% a year"
beside a ceiling growing at 1.5%. And `0.07 * 100` is `7.000000000000001` in binary
floating point, so an integer check on the raw product prints "7.0%". **Put no
percentage in the rung blurbs** — render the real rate beside them, so the sentence can
never come to disagree with the number the game actually uses.

**Derive the roster floor from the ceiling.** `ROSTER_MIN` (46) is calibrated against
`ROSTER_MAX` (53), so a league configured with a 40-man limit must not be told its
minimum is 46 — every keep-or-cut site would then read "short of the minimum"
permanently. Scale the same ratio and never exceed the ceiling:
`max(1, min(46, min(rosterMax, round(rosterMax * 46 / 53))))`.

Set these league constants: `TEAM_COUNT 32`, conferences `['AFC','NFC']`, divisions
`['East','North','South','West']`, `REGULAR_SEASON_WEEKS 17` (17 games, **no bye
weeks** — it keeps scheduling simple), `PLAYOFF_TEAMS_PER_CONF 6` (⇒ 2 byes per
conference), `DRAFT_ROUNDS 7`, `PRACTICE_SQUAD 0` (do not model it in v1), and
`ROOKIE_ROSTER_HIT_RATE 0.5` — the share of a draft class that actually sticks, used to
decide how many slots the AI free-agency wave holds back for rookies. **Do not raise that
last one to a full class.** Reserving 7 of 53 leaves an effective free-agency ceiling of
exactly 46, which *is* `ROSTER_MIN`, so every team at or above the legal minimum skipped
free agency entirely and the market shut down league-wide the moment roster sizes
recovered. Half a class is the realistic figure and leaves genuine headroom.

### 4.3 Difficulty — three rungs, these numbers

Offer **three** rungs, not four. The reference started with a four-rung ladder borrowed
from the console games (Rookie / Pro / All-Pro / Legend); four asked a new player to
place themselves on a scale before they had any idea what the middle felt like, and the
two hardest rungs were separated by less than the noise in a season.

| Rung | `aiUnitBonus` (points added to every AI unit score) | `aiSharpness` (how sharply AI GMs value players; 1 = perfect) | `userScoutPenalty` (extra scouting error for the user) |
|---|---|---|---|
| EASY | `-1.5` | `0.75` | `-3` |
| NORMAL | `0` | `0.9` | `0` |
| HARD | `2.25` | `1.05` | `3` |

Do not push HARD's unit bonus to 3.0. That was the old Legend value and it was a bigger
edge than the gap between a playoff team and a bad one, which read as **unfair rather
than hard**. 2.25 sits between the old All-Pro and Legend deliberately.

**Map legacy difficulty names on read**: `ROOKIE → EASY`, `PRO → NORMAL`,
`ALL_PRO → HARD`, `LEGEND → HARD`. Saves created under the old names carry them in their
settings JSON and nothing rewrites that blob on read, so without the mapping the old
value survives forever, indexes the difficulty table as `undefined`, and makes every
difficulty knob silently NaN.

### 4.4 Rebuild, and the ironman lock

Build `REBUILD` as a third `leagueStart` and **deliberately nothing more than that**: the
ordinary randomized-rosters league — same generator, same thirty-two clubs, same market —
dealt a different starting hand at one club, the user's. Do not build a second season
machine, a second sim, or a second set of rules for how football works. A mode that forks
the game is a mode that drifts away from it.

Change three facts about the club the user takes over and one rule about what he may
change afterwards: give him the bottom of the league, bad in a way he can fix; give him
ugly but legal books (very little room, a mountain of the last regime's dead money, a
handful of contracts he would not have signed, and draft picks the last man mortgaged);
and lock the rules while the run is live.

**Write the copy to the measurement, not the other way around.** Confirm by simulation
that the club shows **31st or 32nd of 32** on the rating the dashboard prints and wins
between **three and five games** off the roster as generated. Then say "the bottom of the
league" everywhere a player can read it — not "the worst roster in football", which is a
place it reaches about half the time and a claim it cannot keep.

**Never deal an over-cap hand.** The season refuses to advance while the user's own club
is over the ceiling, so a Rebuild save dealt an over-cap hand is frozen on turn one — not
hard, **broken**. So **draw the cap room** and solve everything else to fit behind it:
draw the room as a lognormal (an exponential of a normal, which cannot be zero or
negative at any input) bent at both ends toward a floor and a ceiling it never reaches,
then fill the club's books up to `ceiling - room` and never past it. Leave no subtraction
anywhere that can go negative and no clamp holding the line — make `used < ceiling`
arithmetic. Do not instead bound the two *spending* terms and argue their bounds sum to
0.98: that is safe too, but it can only promise a room somewhere under 2% of the ceiling,
not a room **between one and eight million**, which is what the mode needs. **Draw the
quantity you have to guarantee; solve for the ones you do not.** Shape everything else
randomised in that hand the same way: make extremes steadily less likely rather than
chopping them off and stacking them on a bound.

While a Rebuild run is live, override the settings the save is actually played under:

```
difficulty        NORMAL
forceTradeEnabled false
capGrowth         FLAT
capMode           REALISTIC
```

Write the pin function as a **no-op for every save that is not a live Rebuild run**, so
it is safe to wrap around any settings write.

**Put the lock in the action, not on the screen.** Render no controls for a locked run —
that is presentation — and enforce the rule server-side with a **database read** of the
run's standing as the only authority, never anything the request carried. **Refuse the
whole write, not the pinned fields**: the owner asked for an ironman mode with no
changeable settings rather than three locked ones, and a partial refusal would silently
save the rest, which is the worst of both answers. Use this refusal text:

> "This league is a Rebuild run. Its rules are fixed until you win a championship — or
> until you end the run yourself on the Settings screen."

On the create-league screen, render the three pinned controls as fixed, post the pinned
value, and read the pin table itself, so a rung renamed or retuned there cannot leave the
form showing a stale value.

**Never take `leagueStart` from form data on the settings path, on any path.** Carry it
only by spreading the current settings. That is what makes "a save that was not founded as
a Rebuild can never become one" a property of the code rather than a promise. Adding it to
that write opens a door the mode is designed not to have.

### 4.5 Create a league in this order, and validate inputs these ways

`createLeagueAction(formData)`:

1. **Mint the owner key first.** Do not read it after generation to stamp the finished
   league: that leaves no identity to count against until ~5,300 rows have already been
   written. The limit check needs the key before any of that work starts, and stamping
   with the same value afterwards keeps the count and the stamp in agreement. Mint the
   cookie **even when signed in** — it costs nothing and it keeps one invariant true
   everywhere: *every league has an `ownerKey`*, so signing out never leaves a save with
   no route back to its creator.
2. Call `assertCanCreateLeague(viewer)` (§3.8).
3. Read and sanitise inputs: trim `name`, default it to `"My League"`, and **slice it to
   60 characters** (league names appear in lists and page titles, so an unbounded one is a
   layout problem in every one of them and a free text column to fill); read
   `userTeamAbbr` (default `STL`); and run the four founding enums through the whitelist
   helper.
4. Generate the league — ~236 round trips: 32 clubs, full rosters, staff, scouts, picks,
   schedule-ready state.
5. **Stamp `ownerKey` and `userId` in one write, immediately**, so the save is never
   briefly visible to — or deletable by — anyone else. A league created by an account must
   be account-owned at once rather than waiting for the next claim.
6. `redirect('/start/<id>')` — a handover screen, **not** the dashboard. That page is the
   first moment a real team rating exists (it reads the league that was just written), so
   it is where the club is introduced with its actual overall, its actual league rank and
   its actual division rivals. Put the dashboard one click further on.

**Whitelist every enum server-side. Never cast.** These values arrive as raw `FormData`
and a Server Action is a public POST endpoint — the form is not the only thing that can
call it. Casting an arbitrary string straight into the settings JSON lets a crafted
request write a `difficulty` of `""` or a `capMode` nothing in the codebase handles, which
then fails much later, somewhere else, in a league that already exists. Use:

```
pick(raw, allowed, fallback) = allowed.includes(String(raw ?? '')) ? value : fallback
```

with `LEAGUE_STARTS = ['RANDOM_ROSTERS','FANTASY_DRAFT','REBUILD']`,
`CAP_MODES = ['REALISTIC','SIMPLIFIED','OFF']`,
`DIFFICULTIES = ['EASY','NORMAL','HARD']`,
`RECAP_VERBOSITIES = ['SHORT','NORMAL','DETAILED']`, and **`CAP_GROWTHS` read off the
rung table's own keys**, so a fourth rung cannot be added there and silently rejected
here.

Apply this to the settings **update** path too, not just creation. The reference stated
this rule and then cast `capMode`, `difficulty` and `recapVerbosity` for as long as the
update action existed — which is how a league came to be stored with
`capMode: "BANANA"`. It was accepted, it survived the settings parser (which healed
`difficulty` and `capGrowth` and never healed this one), and it left a save whose
restructure tool answered *"Restructuring only applies in Realistic cap mode"* on a league
the Settings screen no longer had a name for. **A comment describing a rule two of its
three fields do not follow is the same bug as a wrong number.**

**Clamp every numeric setting, and do not read it as `Number(form.get(k) || current[k])`.**
That has no floor, no ceiling and no test that the result is even a number, and the form's
inputs carried no `min`/`max` — so this was never only a crafted-request problem, it is
what a player got for typing into the box:

| typed | stored | consequence |
|---|---|---|
| `"abc"` | `NaN` → `JSON.stringify` writes **`null`** | |
| `Infinity` | → **`null`** | |
| `-40` for the trade deadline | stored | the deadline has **always** passed: trading is off for the rest of that save, with no setting on the screen that says so |
| `1e308` | stored | every rate built on it saturates |

**A `null` is worse than a wrong number**, because the settings parser spreads the stored
blob *over* the defaults and `null` is a **present key** — so the default does not come
back and the value arrives at the simulator as `null`.

Write the numeric helper exactly like this:

```
num(raw, current, min, max, { integer? }):
  text = String(raw ?? '').trim()
  if text === ''            -> current          // blank means "leave it as it was"
  n = Number(text)
  if !Number.isFinite(n)    -> current (or min if current is itself non-finite)
  clamped = min(max, max(min, n))
  return integer ? round(clamped) : clamped
```

**Clamp rather than refuse.** A settings save that throws away eleven correct fields
because the twelfth was typed wrong is friction on the common path to defend the rare one.
The range **is** the rule, and a value outside it lands on the nearest end of it. Keep
blank meaning "leave it as it was", which is the only behaviour the screen has ever had
for an emptied box.

**Fall back through the settings parser, never through the raw blob.** The raw
`JSON.parse` of what is stored is not trustworthy as a fallback source — a save already
carrying a `null` or an unrecognised enum would keep it forever. Make the healed version
what every fallback falls back *to*. `capGrowth` is the case that proves the rule: its
fallback must go through the parser precisely *because* on a save written before that
setting existed the key is simply absent, and only the parser knows that absence means
the 7% the league has been played at all along (§4.2).

### 4.6 Write the settings parser to self-heal, in this order

Make the read path defensive, because settings blobs will reach it from three places: the
parser itself, a raw `JSON.parse` in a server action, and an imported league file. In
order:

1. Spread stored over `DEFAULT_SETTINGS`.
2. **If `capGrowth` is absent, pin it to `FAST`** (§4.2). This is the opposite shape of
   problem from the difficulty mapping: the old blob does not carry a *wrong* value, it
   carries *none*, and the spread would hand it the new default.
3. Map legacy difficulty names.
4. If `difficulty` is still not a key of the difficulty table, fall back to the default. A
   blob hand-edited to something unrecognised should **play, not crash with NaN modifiers
   three screens later**.
5. If `capGrowth` is not a key of the rung table, fall back to the default. An
   unrecognised rung must play at the default, **not compound at NaN** and put every
   ceiling in the league at NaN with it.
6. If `capMode` is not one of the three values, fall back to the default. This is the one
   the reference parser forgot, which is how `"BANANA"` survived; this step is what repairs
   a save already carrying one.

Write `capGrowthRate(settings)` to return `CAP_GROWTH_MODES[rung]?.rate` with the default
rung's rate as the final fallback, for the same reason.

**Fix the gap the reference left here:** the capGrowth pin only reaches a ceiling computed
*through* `capGrowthRate()`. Several call sites still read the default curve, so until each
one passes the league's own rate, an old save's cap sheet is drawn on the default curve
whatever the setting says. Thread the league's rate through **every** ceiling computation
when you build it, rather than reproducing that patch.

### 4.7 Force trade — build it as a rule suspension, not a bigger number

`aiAcceptsLopsided` moves the bar the AI holds a deal to — from a required ratio of ~1.04
down to ~0.9 — but **the club still gets a vote and it still says no**. The save this was
written for could not be fixed by a lower bar at any value, because the problem was never
price: an AI club had drafted a sixth quarterback and nobody in the league wants a fifth,
so the deal that unbreaks the roster is one no club accepts at any ratio.

So when `forceTradeEnabled` is on, put a **Force Trade** button beside Propose that writes
the deal without asking anyone. **Suspend every rule that can refuse a trade** — the other
club's answer, the trade deadline, the salary cap and the roster limit — and make it read
as drastic, because it is.

**Suspend nothing that keeps the save coherent.** A club still cannot trade a player it
does not own, a retired man, a spent pick, or the same asset twice, and **book every dollar
the ordinary way**, so the cap sheet afterwards shows exactly how far over the deal left
the user. Suspending a rule leaves the league in a state the player chose and can see;
suspending an ownership claim leaves contracts pointing at nobody.

**State the cost on the control**: the season does not advance while the user's own club is
over the ceiling, so forcing salary **onto** a roster can stop the clock until it is
cleared.

Default it off, and give an existing save off. Unlike `capGrowth`, an absent key here
carries no history to preserve: no league was ever played with forcing on, so `false` is
not a silent change of rules — it is the rules the save already had.

### 4.8 Build the create-league screen like this

Route `/new`, `dynamic = 'force-dynamic'`, `maxDuration = 60` (§1.8).

- Accept a franchise chosen from a crest on the landing page as `?team=`, so the click
  that expressed the choice is the click that makes it. **Validate that query value
  against the real seed list before it reaches the client** — it is a URL, so it is
  whatever anyone types, and an unmatched value silently posts a `userTeamAbbr` the
  generator falls back out of.
- Make it its own route rather than a section of the home page: the landing page should be
  one confident screen and a 32-club board is not that.
- At the per-owner limit, render a "Save slots full" panel naming the count and the limit
  with a link back to the franchise list, instead of the form.
- Signed out, put the account invitation **in** the flow, not in front of it. Let a
  signed-out player complete the entire screen, and have the banner only say what happens
  to the save if they do not sign up ("this dynasty will live in this browser only").
- Post: `name`, a hidden `userTeamAbbr`, `leagueStart`, `capMode`, `capGrowth`,
  `difficulty`. When `leagueStart === 'REBUILD'`, render the three pinned controls as
  fixed, post the pinned value, and carry a note saying why.
- **Do offer the cap-growth control here**, and keep the action's whitelist as the
  authority. The reference's action comment says the control does not exist yet while its
  form renders one; make the screen and the action agree.

---

## 5. Migrations and schema evolution

### 5.1 Put `prisma migrate deploy` in the build, and never use `db push` against production

Do **not** write this build script:

```
"build": "prisma generate && prisma db push --accept-data-loss && next build"
```

That is what the reference shipped first, and every production deploy reshaped the live
database to match `schema.prisma` with **no migration history, no review step and no
record of what it did**, with a flag telling it to proceed even when matching the schema
meant dropping a column or a table. Concretely: rename a field, deploy, and Postgres does
not see a rename. It sees one column that no longer exists and one that does not yet. **The
old column is dropped with every player's data in it and the new one is created empty.** No
prompt, no error, no backup, and nothing in the deploy log that reads as destructive. The
next deploy looks completely normal.

Write this instead:

```
"build": "prisma generate && prisma migrate deploy && next build"
```

`migrate deploy` applies reviewed, committed SQL files in order and refuses to do anything
not written down in `prisma/migrations/`. It never drops anything you did not write down
yourself.

**Put it in `build`, not in a separate step.** Vercel has no first-class post-deploy hook
on all plans, so a "separate step" means a command run by hand after each push. A migration
step that depends on somebody remembering it is a migration step that gets skipped, and the
failure mode of skipping it — new code against an old schema — is worse and harder to
diagnose than the failure modes of running it in the build. In the build it is unskippable,
it runs **before** `next build`, and if it fails the deploy fails and the currently-live
deployment keeps serving.

Accept these tradeoffs knowingly:

- **The build now requires a reachable database.** No `DATABASE_URL`, or a database that is
  down, means the build fails. That is intentional — it fails loudly at deploy time instead
  of quietly at request time — but a database outage blocks deploys.
- **Preview deployments run migrations too.** Give previews their own database (a Neon
  branch per preview is the right setup). A preview pointed at the production
  `DATABASE_URL` migrates production on its own build.
- **The migration runs before the build succeeds.** If `next build` fails after
  `migrate deploy` succeeded, the database is migrated but the old code is still live. Keep
  migrations backward-compatible with the previous release — add columns, do not rename or
  drop in the same deploy as the code change — and this is harmless.

### 5.2 Generate the baseline migration, and verify it both ways

Generate it with:

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

Then **verify it rather than assuming it.** Apply it to a scratch database and diff that
database against the schema **in both directions** with `--exit-code`; both must come back
empty and exit 0, which proves the migration reproduces the schema exactly. Then exercise
the result with the app itself: create a league and simulate a few weeks against a database
built only by this migration. (The reference's baseline is 503 lines, 19 tables, 28 indexes,
28 foreign keys, and was validated this way with 32 games played and 195 transactions
written.)

Do **not** modify `schema.prisma` to suit the baseline. The baseline describes the schema as
it is.

**Commit `prisma/migrations/migration_lock.toml`** alongside it, recording the provider
(`postgresql`). Hand-generated migrations do not get one automatically, and without it
`prisma migrate dev` and `migrate diff --from-migrations` fail with *"Could not determine
the connector from the migrations directory"*.

### 5.3 Baseline an existing database once, with these checks

A database built by `db push` has the tables but **no `_prisma_migrations` table**, so
`migrate deploy` sees tables it has no record of creating and refuses with
`P3005: The database schema is not empty.` That is Prisma protecting you; nothing is broken.

```bash
DATABASE_URL="<production>" npx prisma migrate resolve --applied <baseline_dir_name>
```

Run it **once**, from a developer machine, against production, **before** the first deploy
using the new build script. Then:

- Pass the **directory name with the timestamp**, not `init` and not a path.
- Know that `resolve --applied` only inserts a bookkeeping row: it creates, alters and drops
  nothing. (Tested: on a database seeded with a league row, `resolve` then `deploy` ran
  clean, reported "No pending migrations to apply", and the row was still there afterwards
  with zero schema drift.)
- Do it while nothing is deploying, so a build cannot race you.
- **Before running it**, confirm the database really matches the schema the baseline
  describes:
  `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script`.
  Once the tree has more than one migration, that command legitimately prints the SQL of
  every migration not yet applied. **Check that it prints nothing else** — in particular **no
  `DROP`, and no `ALTER` other than the nullable `ADD COLUMN`s the pending migrations
  themselves contain.** Diff the printed SQL against the migration files statement by
  statement rather than skimming it. Anything else is real drift, and baselining over it
  hides it.

Then run `prisma migrate status` to confirm, deploy, load the site, create one league, and
advance one week.

### 5.4 Reproduce these 22 migrations, in this order

They apply in **directory-name order**, and `migrate deploy` applies whichever ones the
target database has no record of. Use them as the shape of what a migration in this project
looks like, and inherit the three sets of reasoning below them.

| # | Migration | What it does |
|---|---|---|
| 1 | `20260821160357_init` | The baseline. 19 tables, 28 indexes, 28 FKs. |
| 2 | `20260821165523_negotiation_patience` | `CREATE TABLE "NegotiationTalks"` + 3 indexes + 3 FKs. **Purely additive — not one statement touching an existing table.** |
| 3 | `20260821172156_user_accounts` | `User`, `Session`, `AuthAttempt`; their indexes; one **nullable** `ALTER TABLE "League" ADD COLUMN "userId" TEXT`; FKs `League_userId_fkey` (SET NULL) and `Session_userId_fkey` (CASCADE). |
| 4 | `20260821174724_leaderboard_and_opt_in` | `CREATE TABLE "DynastyRank"` + indexes; `ALTER TABLE "User" ADD COLUMN "leaderboardOptIn" BOOLEAN NOT NULL DEFAULT false`; `DynastyRank_userId_fkey` (CASCADE). |
| 5 | `20260821203436_power_ranking_snapshots` | `CREATE TABLE "PowerRankingSnapshot"` + unique + index. |
| 6 | `20260821203845_player_seasons` | `CREATE TABLE "PlayerSeason"` + unique + index. |
| 7 | `20260821204146_player_season_first_seen` | `ADD COLUMN "firstSeen" INTEGER NOT NULL DEFAULT 0` — defaulted, not nullable, so the sort key is never NULL. |
| 8 | `20260821204438_retire_fullback` | **Data-only.** `UPDATE "Player" SET position='RB' WHERE position='FB'`; `DELETE FROM "DepthChartSlot" WHERE position='FB'`. |
| 9 | `20260821213919_resign_set_aside` | `ALTER TABLE "NegotiationTalks" ADD COLUMN "dismissedAt" TIMESTAMP(3)` (nullable). |
| 10 | `20260821230000_playoff_stat_split` | Adds `Player.playoffStats`, `Player.careerPlayoffStats` (TEXT NOT NULL DEFAULT '{}'), `PlayerSeason.playoffStats`, `PlayerSeason.playoffGp` (INT NOT NULL DEFAULT 0). |
| 11 | `20260821234500_transaction_player_id` | `Transaction.playerId` (nullable) + index + FK **ON DELETE SET NULL**. |
| 12 | `20260822151503_draft_started_gate` | `DraftState.started BOOLEAN NOT NULL DEFAULT false`, then **`UPDATE "DraftState" SET "started" = true`**. |
| 13 | `20260822180000_unsigned_week_clock` | `Player.weeksUnsigned`, plus an `UPDATE` **seeding it from `yearsUnsigned`**. |
| 14 | `20260823124500_advance_in_progress_marker` | `League.advanceStartedAt TIMESTAMP(3)` (nullable — null is exactly right for every live row: nobody is mid-advance). |
| 15 | `20260823124600_cap_charge_team_cascade` | `DELETE` of orphan cap charges, **then** `ADD CONSTRAINT CapCharge_teamId_fkey ... ON DELETE CASCADE`. |
| 16 | `20260823140000_champion_roster` | `CREATE TABLE "ChampionRoster"` + unique + index. |
| 17 | `20260824120000_fifth_year_option` | `Contract.fifthYearOption TEXT` (nullable). |
| 18 | `20260824150000_drop_named_schemes` | **Destructive.** `DROP COLUMN Team.offScheme`, `Team.defScheme`, `Staff.scheme`. |
| 19 | `20260824170000_player_season_end_ovr` | `PlayerSeason.endOvr INTEGER` (nullable; deliberately **not** backfilled). |
| 20 | `20260824180000_player_last_season_ovr` | `Player.lastSeasonOvr INTEGER` (nullable; deliberately **not** backfilled). |
| 21 | `20260824193000_rebuild_mode` | `League.rebuildAbandonedAt TIMESTAMP(3)`, `DynastyRank.seasonsToTitle INTEGER` (both nullable). |
| 22 | `20260824200000_draft_run_lease` | `DraftState.runStartedAt TIMESTAMP(3)` (nullable; null is correct for every existing row — nobody is mid-chunk). In flight at the commit this brief was written from, so treat it as part of the schema rather than as a later addition. |

**#12 — backfill `started` to `true`.** The default would freeze a save sitting on the clock
mid-draft: no button on its screen, no ticker.

**#13 — seed `weeksUnsigned` from `yearsUnsigned`.** Otherwise a save written before the
column quotes a three-years-unsigned player his April number.

**#8 — retiring the fullback.** Model eleven personnel (1 RB, 1 TE, 3 WR) as the base
offence; a fullback is a situational blocker who never appears in it. **Convert existing
players, do not delete them** — a fullback is a running back in every way this game models
one, so nobody loses a player, a contract, a depth-chart place or a career stat line. If you
delete the position from the code *without* the data migration, rows carry a position the
type system says cannot exist and every `Record<Position, ...>` lookup keyed on it returns
`undefined` and quietly produces NaN — the same failure mode that once hid a twelve-man
defence in this codebase. **Delete the depth-chart slots rather than converting them**,
because of the `(teamId, position, rank)` unique constraint: rewriting an FB slot to RB
collides with the running back already at that rank, and the first attempt at this migration
failed on exactly that. The affected players stay on their rosters and fall to the end of the
running-back order, which is where a converted blocking back belongs anyway, and the depth
chart is reorderable so nothing is lost the user cannot immediately fix.

**#15 — order the orphan delete before the constraint.** This is **not** tidiness:
`ADD CONSTRAINT` validates every existing row, so with a single orphan present the constraint
statement fails and the whole migration cannot apply. Scope the delete to exactly the rows
the constraint would reject — a charge whose team does not exist — and touch nothing
reachable from a live save. Leave charges against a team that still exists untouched whatever
their year, because dead money is meant to outlive the contract that created it and the
season-step expiry sweep is the only thing entitled to decide a charge has been paid. Ship
the same delete as a re-runnable script too.

**#18 — do not build named schemes in the first place.** `Team.offScheme`/`defScheme` held
one of five strings picked by a coin flip at league creation and never changed again, and
`Staff.scheme` held a copy for the coordinator. Between them they drove exactly two things: a
pass/run play-call rate whose envelope was **1.54× the real NFL's** (no real team-season in
six years reached the 0.68 the "Air Raid" value set), and a scheme-fit rating bonus that paid
**four fifths of the league an unconditional +1.2 rating points and the other fifth nothing**.
Derive how often a club throws from the club's own id plus the league year instead: no column
is needed and **every existing save picks it up with no data migration**, because a club that
already exists already has an id and therefore already has a tendency. A column nothing reads
is a comment describing a policy the code no longer follows, in schema form. And note why the
drop was safe: past box scores and past season stat lines are stored rows written once when a
game was played, so dropping these columns cannot reach them and every season already played
stays exactly as it was.

### 5.5 Follow these rules for every new migration

1. **Assume `migrate deploy` runs against a database with live rows in it.** Make a new
   column on an existing table **nullable or defaulted**. A new table is safer than either,
   and a purely-additive `CREATE TABLE` is the preferred shape.
2. **Read the generated SQL before you commit it.** If it contains `DROP COLUMN` or
   `DROP TABLE`, that is exactly the data loss the old build script was doing silently. Decide
   it on purpose, and if the data must be preserved, edit the migration to copy it across
   **before** the drop.
3. **Check a destructive migration against the live code before you run it, and write the
   argument into the SQL file as a comment.** Both destructive migrations in this tree carry a
   written argument that nothing reads the thing being removed and that nothing already written
   down can be reached by the drop. A drop whose justification is not written down is not
   reviewable.
4. **Backfill when the default would be wrong; do not backfill when the honest answer is
   "unknown".** Compare #12 and #13 (backfilled, because the default would freeze a live draft
   or misprice a man) against #19 and #20 (left null, because a backfill would have to *invent*
   a past rating from a present one).
5. **Keep migrations backward-compatible with the previous release.** Code rollback is instant;
   database rollback is not.
6. Workflow: `npm run db:migrate -- --name <what_it_is>`, then `git add prisma/migrations` —
   **commit the migration**. Use `db:push` for local iteration and **never point it at
   production**: it mutates a database to match the schema and writes no history, where
   `db:migrate` writes a reviewable SQL file that is committed and replayed identically
   everywhere.

| Situation | Command |
|---|---|
| Iterating locally, history irrelevant | `npm run db:push` |
| Schema change that must be committed and deployable | `npm run db:migrate` |
| Wipe and rebuild the local database | `npm run db:reset` |
| Check what production thinks is applied | `npm run db:migrate:status` |
| Apply committed migrations (what the build runs) | `npm run db:migrate:deploy` |

### 5.6 Plan rollback before you need it

- **Code**: promote an earlier deployment. Instant, no rebuild.
- **Database**: expect no automatic down-migration; Prisma does not generate them. In order of
  preference:
  1. **Point-in-time restore** on the managed Postgres. This is the real answer. **Confirm the
     retention window before launch** — restoring to a point you no longer retain is not a
     rollback.
  2. **Forward fix** — a new migration that undoes the change. Prefer this for anything
     additive.
  3. `prisma migrate resolve --rolled-back <name>` marks a **failed** migration as rolled back
     so `deploy` will retry it. It changes **bookkeeping only** — it does not undo SQL that
     already ran. Use it only to clear a half-applied failed migration after manually fixing the
     schema.

Because code rollback is instant and database rollback is not, keep migrations
backward-compatible with the previous release wherever you can.

### 5.7 Expect these deploy failures

| Symptom | Cause | Fix |
|---|---|---|
| Deploy dies seconds after `npm install`, with allow-scripts warnings | npm 11.6 will not run dependency install scripts without project approval, and `@prisma/engines`' postinstall downloads the engines. Easy to miss locally because npm 10 ignores the field. | The `allowScripts` block (§1.3). A future dependency with an install script brings it back; `npx npm@11 approve-scripts <pkg>` appends to the block. |
| Build fails with Prisma **P1002**, surfaced only as `exited with 1` | (a) `DIRECT_URL` missing or pointing at the pooled host — `migrate deploy` holds a session open for DDL and a transaction-mode pooler cannot; it hangs then times out. (b) A suspended database whose cold start outruns the connect timeout. | (a) Point `DIRECT_URL` at the host **without** `-pooler`. (b) Wake the database and redeploy, or append `?connect_timeout=30`. |
| `migrate deploy` refuses with **P3005** | The database has tables but no `_prisma_migrations`. | §5.3, once. |
| Deployed app fails at request time with engine-not-found while local dev and build pass | Missing `rhel-openssl-3.0.x` binary target. | §1.2. |
| Every unowned save visible to every visitor | `NODE_ENV=development` on the public deployment. | Never set it by hand. §1.4. |

### 5.8 Keep the secrets posture

Commit no secrets. Never track `.env` — commit only a placeholder `.env.example`. Cover
`.env.*` in `.gitignore` with an explicit `!.env.example` negation, plus `.vercel`, and verify
with `git check-ignore`. Read exactly `NODE_ENV` plus the two optional league limits in
application code, and let Prisma consume `DATABASE_URL` and `DIRECT_URL` via the schema.
**Keep the property that there is no API key, token, or third-party credential anywhere in this
codebase.**

---

## 6. Decisions left to you

Each of these is unresolved in the reference. Decide it deliberately; do not inherit the
ambiguity.

1. **`playoffTeamsPerConf` is stored and never read.** Every consumer — seeding, clinch
   scenarios, the standings board, generated league history — reads the constant `6` instead, so
   changing the setting does nothing. **Either wire it through or remove it from the settings
   interface. Do not ship a control that lies.**
2. **`scoutingBudgetPerWeek` has no consumer either.** It is validated, clamped (0..10 000),
   persisted, and rendered on the Settings screen as "Scouting focus / week (base)", but nothing
   reads it: the scouting allowance comes from the economy module's grant computation and
   `Team.scoutPeriodGrant`. **Wire it or drop it**, same rule.
3. **`seasonLength`, `rosterMax`, `draftRounds` and `simSeed` are live but unreachable.** Their
   consumers exist and respect them, but no screen lets a player set them — league creation fixes
   them at the defaults. If you expose them, note that `tradeDeadlineWeek` is clamped against
   `seasonLength` and that `rosterMax` drives a derived roster floor (§4.2), so changing either
   mid-save has consequences a confirm dialog must state.
4. **`Contract.teamId` has no foreign key.** Decide whether to add one. The identical omission on
   `CapCharge` cost 18,247 orphan rows; the reason it is less dangerous here is that contracts
   cascade away with the player. If you add it, keep `Player.teamId` authoritative for roster
   membership.
5. **The cap-growth rung does not reach every ceiling in the reference.** Call sites that compute
   a ceiling without passing the league still use the default curve, so an old save's cap sheet
   can be drawn on a rate it is not played at. Thread the league's rate through every ceiling
   computation rather than reproducing the patch (§4.6).
6. **`DynastyProfile.ownerKind` is always `"LEAGUE"`.** The `(ownerKind, ownerKey)` key is
   designed for an account-wide progression mode that does not exist yet. Build the lookup helper
   so adding it later is a resolver change; do not build the mode now.
7. **`TradeOffer.toTeamId` is always the user's team**, and the column has no relation. If you
   ever surface AI-to-AI offers, that column needs a relation and the status index needs
   rethinking.
