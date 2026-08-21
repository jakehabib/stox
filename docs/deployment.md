# Deploying Dynasty GM Football

Target: **Vercel** (Next.js 14 app router) + **Neon Postgres**.

If you read only one thing, read
[The one-time baseline](#3-the-one-time-baseline-existing-database-only) and
[Known risks at launch](#known-risks-at-launch).

---

## What changed, and why it mattered

The build script used to be:

```
"build": "prisma generate && prisma db push --accept-data-loss && next build"
```

Every production deploy ran `prisma db push --accept-data-loss` against the
live database. That command reshapes the database to match `schema.prisma`
with no migration history, no review step, and no record of what it did.
`--accept-data-loss` is the flag that tells it to go ahead even when matching
the schema means dropping a column or a table.

Concretely: rename a field in `schema.prisma`, deploy, and Postgres does not
see a rename. It sees one column that no longer exists and one that does not
yet. The old column is dropped with every player's data in it and the new one
is created empty. There is no prompt, no error, no backup, and nothing in the
deploy log that reads as destructive. The next deploy after that would look
completely normal.

It is now:

```
"build": "prisma generate && prisma migrate deploy && next build"
```

`migrate deploy` applies reviewed, committed SQL files in order and refuses to
do anything not written down in `prisma/migrations/`. It never drops anything
you did not write down yourself.

### Why `migrate deploy` is in `build` and not a separate step

Vercel has no first-class post-deploy hook on all plans, so a "separate deploy
step" here would mean a command run by hand after each push. A migration step
that depends on someone remembering it is a migration step that gets skipped,
and the failure mode of skipping it — new code against an old schema — is
worse and harder to diagnose than the failure modes of running it in the
build. In the build it is unskippable, it runs before `next build`, and if it
fails the deploy fails and the currently-live deployment keeps serving.

The tradeoffs you are accepting, stated plainly:

- **The build now requires a reachable database.** No `DATABASE_URL`, or a
  database that is down, means the build fails. This is intentional — it fails
  loudly at deploy time instead of quietly at request time — but it does mean
  a Neon outage blocks deploys.
- **Preview deployments run migrations too.** If a preview deployment is
  configured with the same `DATABASE_URL` as production, its build migrates
  the production database. See [Preview deployments](#preview-deployments).
- **Migration runs before the build succeeds.** If `next build` fails after
  `migrate deploy` succeeded, the database is migrated but the old code is
  still live. Keep migrations backward-compatible with the previous release
  (add columns, don't rename or drop in the same deploy as the code change)
  and this is harmless.

---

## The baseline migration

`prisma/migrations/20260821160357_init/migration.sql` — 503 lines, 19 tables,
28 indexes, 28 foreign keys. It was generated from the current schema with:

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

**It was verified, not assumed.** Applied to a scratch database, then diffed
against `schema.prisma` in both directions:

```bash
npx prisma migrate diff --from-url "$SCRATCH" --to-schema-datamodel prisma/schema.prisma --exit-code   # 0
npx prisma migrate diff --to-url "$SCRATCH" --from-schema-datamodel prisma/schema.prisma --exit-code   # 0
```

Both empty, both exit 0 — the migration reproduces the schema exactly. The
resulting database was then exercised by the app itself: a league was created
and three weeks simulated (32 games played, 195 transactions written) against
a database built only by this migration.

`prisma/migrations/migration_lock.toml` sits alongside it and records the
provider (`postgresql`). Hand-generated migrations do not get one
automatically; without it `prisma migrate dev` and `migrate diff
--from-migrations` fail with *"Could not determine the connector from the
migrations directory"*. **Commit both files.**

`schema.prisma` was deliberately not modified. The baseline describes the
schema as it is.

### Migrations after the baseline

The tree is no longer a single file. Migrations apply in directory-name order,
and `migrate deploy` applies whichever ones the target database has no record
of:

| Migration | What it does |
| --- | --- |
| `20260821160357_init` | The baseline. 19 tables. |
| `20260821165523_negotiation_patience` | Adds the `NegotiationTalks` table. |

`negotiation_patience` is **purely additive** — one `CREATE TABLE`, three
indexes, three foreign keys, and not a single statement that touches an
existing table. That is deliberate and it is the standing rule for anything
that ships here: `migrate deploy` runs against a database with live rows in
it, so a new column on an existing table must be nullable or defaulted, and a
new table is safer than either. Read the SQL before you commit one; if it
contains `DROP`, decide that on purpose.

The table it adds stores how much patience a GM has burned in a contract
negotiation (see the model's own comment in `schema.prisma`). It is game state,
not user data, and it is bounded: rows are written only when an offer is
actually refused, are deleted when the player signs, and are pruned when the
league year rolls over. Nothing else in the app reads it.

---

## 1. Prerequisites

- A Neon Postgres database. **Put it in the same region as your Vercel
  functions.** This matters more than it sounds like it should — see
  [Known risks](#1-league-creation-may-time-out-on-vercel-most-likely-thing-to-break).
- The repo pushed to a Git remote Vercel can see.

## 2. First deployment against a *brand new* database

Nothing special is required. In order:

1. Create the Vercel project, import the repo.
2. Add the Neon integration (or set `DATABASE_URL` manually — use the
   **pooled** connection string, the host containing `-pooler`).
3. Deploy.

The build runs `prisma migrate deploy` against the empty database, which
applies the baseline and creates the `_prisma_migrations` bookkeeping table.
Verified end to end against a fresh empty database: 20 tables afterwards
(19 models + `_prisma_migrations`), zero drift.

**Skip to step 4.** Step 3 is only for a database that already has tables.

## 3. The one-time baseline (existing database only)

> **Read this section fully before running anything.** It is the step where a
> mistake costs live data.

Your existing database already has these tables — `db push` created them — but
it has no `_prisma_migrations` table, because `db push` does not write one.
`migrate deploy` sees tables it has no record of creating and refuses:

```
Error: P3005
The database schema is not empty.
```

This is Prisma protecting you. It does **not** mean anything is broken.

The fix is to tell Prisma "the baseline migration is already applied here",
which writes a `_prisma_migrations` row and **executes no SQL against your
tables**:

```bash
DATABASE_URL="<your production connection string>" \
  npx prisma migrate resolve --applied 20260821160357_init
```

Run this **once**, from your machine, against the production database,
**before** the first deploy that uses the new build script.

Notes that matter:

- The migration name is `20260821160357_init` — the **directory name**, with
  the timestamp, not `init`, and not the path.
- `migrate resolve --applied` only inserts a bookkeeping row. It does not
  create, alter, or drop anything. This was tested: on a database seeded with
  a `League` row named "Precious Dynasty", `resolve` then `deploy` ran clean,
  reported "No pending migrations to apply", and the row was still there
  afterwards with zero schema drift.
- Do this while nothing is deploying, so a build cannot race you.
- **Before you run it**, confirm the database really does match the schema the
  baseline describes. If it drifted from that at some point, marking the
  baseline applied will make Prisma believe a schema you do not have. Check:

  ```bash
  npx prisma migrate diff \
    --from-url "$DATABASE_URL" \
    --to-schema-datamodel prisma/schema.prisma --script
  ```

  **This check changed once there was more than one migration.** It compares
  your database against the *current* schema, so it now legitimately prints the
  SQL of every migration after the baseline that has not been applied yet. What
  you are looking for is that it prints *nothing else*:

  - Empty (`-- This is an empty migration.`) — safe.
  - Exactly the statements of the migrations that have not run yet, matching
    their files statement for statement — safe. `migrate deploy` will apply
    them on the first build after you baseline. As of now that is **two**
    migrations, and nothing else may appear:

    1. `20260821165523_negotiation_patience` — the `CREATE TABLE
       "NegotiationTalks"` block with its indexes and foreign keys.
    2. `20260821172156_user_accounts` — `CREATE TABLE "User"`, `"Session"` and
       `"AuthAttempt"`, their indexes, one **nullable** `ALTER TABLE "League"
       ADD COLUMN "userId" TEXT`, and two `ADD CONSTRAINT ... FOREIGN KEY`
       (`League_userId_fkey` with `ON DELETE SET NULL`, `Session_userId_fkey`
       with `ON DELETE CASCADE`).

    The `ALTER TABLE "League"` in (2) is the one `ALTER` you *should* see. It
    adds a nullable column and rewrites no existing row; every league already
    in the database keeps working on its `ownerKey` exactly as before, and
    becomes account-owned only when someone signs in and claims it (see
    `docs/accounts.md`).
  - Anything else, and in particular **any `DROP`, or any `ALTER` other than
    that one nullable `ADD COLUMN`** — stop. That is real drift, and baselining
    over it will hide it. Resolve it before going further.

  Diff the printed SQL against the migration files rather than skimming it. The
  point of the check is that the only pending changes are ones written down in
  `prisma/migrations/`.

Then verify:

```bash
DATABASE_URL="<production>" npx prisma migrate status
# expect: the baseline recorded as applied, and every later migration listed as
# pending — currently "3 migrations found ... following migrations have not yet
# been applied: 20260821165523_negotiation_patience,
# 20260821172156_user_accounts". The first deploy applies them, in that order.
```

## 4. Verify after deploying

```bash
DATABASE_URL="<production>" npx prisma migrate status
```

Then load the site, create one league, and advance one week.

---

## Environment variables

| Variable | Required | Default | What it does |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | — | Postgres connection string. The only required variable. Use Neon's **pooled** URL (`-pooler` in the host); serverless functions open a connection per invocation and an unpooled endpoint exhausts connections under light concurrency. |
| `MAX_LEAGUES_PER_OWNER` | No | `8` | Saves one browser may hold. A UX limit, not a security control — the owner key is a cookie, so clearing cookies resets the count. |
| `MAX_LEAGUES_TOTAL` | No | `500` | Hard ceiling on leagues in the whole database. This is the one that actually protects your quota, because it is the only one a caller rotating cookies cannot walk around. ~500 leagues ≈ 2.6M rows. |
| `NODE_ENV` | Set for you | — | Do not set manually. See warning below. |

Non-integer, zero, negative, and empty values for the two limits are ignored
and the default is used (verified). Set them in Vercel under
**Settings → Environment Variables**. `.env` is for local development only and
is gitignored; `.env.example` is the committed template.

> **Never set `NODE_ENV=development` on the public deployment.** `lib/owner.ts`
> keys off it: in production, leagues with a `NULL` owner key are hidden from
> every browser. In development they are visible to everyone. Flipping this on
> a shared deployment exposes every unowned save to every visitor.

### Secrets audit

No secrets are committed. `.env` has never been tracked (checked across all
history — only `.env.example` has ever been committed, and it contains
placeholders). `.gitignore` now also covers `.env.*` with an explicit
`!.env.example` negation and `.vercel`. Verified with `git check-ignore`:
`.env` ignored, `.env.example` not ignored.

The app reads exactly two environment variables in application code
(`NODE_ENV`, plus the two optional limits) — `DATABASE_URL` is consumed by
Prisma via the schema. There is no API key, token, or third-party credential
anywhere in this codebase.

---

## Local development

Nothing about the local workflow changed. **Which command when:**

| Situation | Command |
|---|---|
| Iterating on `schema.prisma` locally, don't care about history | `npm run db:push` |
| You changed the schema and want it **committed and deployable** | `npm run db:migrate` |
| Wipe and rebuild your local database | `npm run db:reset` |
| Check what production thinks is applied | `npm run db:migrate:status` |
| Apply committed migrations (what the build runs) | `npm run db:migrate:deploy` |

`db:push` is fine for local iteration and stays. **It must never be pointed at
production.** The distinction: `db:push` mutates a database to match the
schema and writes no history; `db:migrate` writes a reviewable SQL file to
`prisma/migrations/` that gets committed and replayed identically everywhere.

### Making a schema change from now on

```bash
npm run db:migrate -- --name add_whatever_it_is    # writes prisma/migrations/<ts>_add_whatever_it_is/
git add prisma/migrations                          # the migration MUST be committed
```

Read the generated SQL before committing. If it contains `DROP COLUMN` or
`DROP TABLE`, that is exactly the data loss the old build script was doing
silently — decide deliberately, and if you need to preserve the data, edit the
migration to copy it across before the drop.

---

## Rollback

**Code** — Vercel dashboard → Deployments → an earlier deployment →
*Promote to Production*. Instant, no rebuild.

**Database** — there is no automatic down-migration; Prisma does not generate
them. Your options, in order of preference:

1. **Neon's point-in-time restore.** This is the real answer. Neon retains
   history (window depends on plan) and can branch or restore to a timestamp
   before the bad migration. Confirm your retention window *before* launch —
   restoring to a point you no longer retain is not a rollback.
2. **Forward fix.** Write a new migration that undoes the change and deploy it.
   Preferred for anything additive.
3. **`prisma migrate resolve --rolled-back <name>`** marks a *failed* migration
   as rolled back so `migrate deploy` will retry it. It changes bookkeeping
   only — it does not undo SQL that already ran. Use it only to clear a
   half-applied failed migration after you have manually fixed the schema.

Because code rollback is instant and database rollback is not, keep migrations
backward-compatible with the previous release wherever you can.

### Preview deployments

Every Vercel build runs `prisma migrate deploy`, previews included. Before
enabling previews, make sure preview environments get their **own** database —
Neon's Vercel integration can create a branch per preview, which is the right
setup. If previews share the production `DATABASE_URL`, an experimental branch
migrates production. Set `DATABASE_URL` per-environment in Vercel rather than
leaving one value applied to all three environments.

*Unverified in this environment:* I could not test Vercel's preview/branching
behaviour from here. Confirm it in the Vercel and Neon dashboards before you
turn previews on.

---

## Caching, `force-dynamic`, and serverless

`export const dynamic = 'force-dynamic'` appears in three places
(`app/page.tsx`, `app/league/[id]/layout.tsx`,
`app/league/[id]/scouting/page.tsx`). On Vercel it means those routes are
never prerendered or cached — every request runs a serverless function that
opens a database connection and re-queries.

**The important part: removing those declarations would change nothing.**
Every page in the app is already dynamic for a reason that overrides the
setting — `lib/owner.ts` calls `cookies()`, and any route that reads cookies
is dynamic by definition in the app router. `getLeagueContext` calls
`canViewLeague`, which calls `readOwnerKey`, which calls `cookies()`, and all
19 league pages go through `getLeagueContext`. The home page calls
`listOwnedLeagues`, same path. So `force-dynamic` here is documentation of a
fact, not the cause of it.

**Can anything be cached?** No page that shows a save can be. Every one of
them is per-browser (owner cookie) and reflects mutable state that a server
action changed a moment ago; a cached league page would show another
browser's data or a stale one. The only statically cacheable routes in the app
are `/design-system/*`, which touch neither the database nor cookies — those
are internal reference pages, and worth knowing will be publicly reachable on
the deployment for anyone who guesses the URL. Nothing sensitive is on them.

Practical consequence: **cost and latency scale with page views, not users.**
There is no cache layer anywhere. Every navigation is a function invocation
plus a round trip to Neon.

---

## Logging and observability

### What exists today

Almost nothing, and what does exist mostly does not reach you.

- Three `console.error` / `console.warn` calls in the whole app. Two of them
  are in `app/error.tsx` and `app/league/[id]/error.tsx` — and those are
  `'use client'` components, so their output goes to **the tester's browser
  console, not Vercel's logs**. You will not see them.
- The one that does reach Vercel is in `app/api/league/create/route.ts`.
- Prisma is configured to log at `['error']` in production (`lib/db.ts`),
  which does go to stdout and therefore to Vercel.
- An uncaught server error renders the error boundary and Vercel records the
  invocation, but the message is redacted to a digest.

So: if a tester says "it broke", today you can see *that* a function errored
and a digest, and correlate the digest to a stack trace in Vercel's logs — but
only within Vercel's log retention, which on Hobby is short (roughly an hour
of runtime logs; confirm on your plan).

### Minimal useful setup

1. **Turn on a log drain or use Vercel Observability.** Runtime logs on Hobby
   are ephemeral; a tester reporting a problem an hour later leaves you nothing
   to look at. This is the single highest-value change.
2. **Log the digest server-side.** The boundaries log it client-side where you
   cannot see it. Vercel already logs the underlying error with the same
   digest, so the correlation exists — just make sure you know to search for it.
3. **Add an error reporter** (Sentry's Next.js SDK is a ~15-minute install) if
   you want the message and stack rather than a digest, plus grouping and a
   notification when something new starts failing. For a tester round this is
   worth more than any amount of manual log reading.
4. **Watch Neon's dashboard** for connection count and storage. The failure
   modes most likely to hit you here are quota and connection exhaustion, and
   both show up there before they show up as user reports.

*Unverified in this environment:* Vercel log retention by plan and Observability
features — I could not check your dashboard. Confirm the numbers before launch.

---

## Runtime failure modes

Tested against a real Postgres:

| Situation | What actually happens |
|---|---|
| `DATABASE_URL` missing/empty | App **starts fine**, then throws `PrismaClientInitializationError: You must provide a nonempty URL` on the first query of every request. Deferred to request time — there is no startup validation. With `migrate deploy` now in the build, a missing URL fails the build instead, which is better. |
| `DATABASE_URL` malformed | `PrismaClientInitializationError: the URL must start with the protocol postgresql://`, same timing. |
| Database unreachable mid-request | `PrismaClientInitializationError: Can't reach database server at <host>`. Caught by the error boundaries → "This screen didn't load". |
| Database fails during a server action | The action throws, the boundary renders. Every mutation is a discrete server action that committed or didn't, so a failure does not leave a half-written league — **except league creation**, which is not transactional (see risks). |
| Uncaught rejection taking down a route | None found. Every DB call is `await`ed inside a request scope; there is no fire-and-forget promise, no background timer, no unawaited `.then()` on a hot path. Node would only exit on a truly unhandled rejection outside a request, and there is no such code. |

**Error boundary coverage.** `app/error.tsx`, `app/not-found.tsx` and
`app/league/[id]/error.tsx` cover what matters. Two gaps, both minor:

- No `app/global-error.tsx`. It would catch a throw in the **root layout**,
  which `app/error.tsx` cannot. The root layout is static markup plus a Google
  font, so this is close to unreachable — worth adding eventually, not a
  launch blocker.
- No `loading.tsx` anywhere. Every page is dynamic and some queries are heavy,
  so navigation blocks with no feedback until the server responds. This is a
  perceived-performance problem, not a correctness one, but on a slow
  connection it reads as "the app froze".

---

## Known risks at launch

Stated plainly. These are what is still fragile.

### 1. League creation may time out on Vercel (most likely thing to break)

`createLeague` writes **~5,300 rows over 236 sequential database round trips**
(measured, not estimated). Locally, against Postgres on the same machine, that
takes **1.16 seconds**. Almost all of it is round-trip latency, not database
work — actual query time totals 316ms.

That means the wall time is set almost entirely by network latency to Neon:

| Latency per round trip | Approx. total |
|---|---|
| 2 ms (same region) | ~1.6 s |
| 5 ms | ~2.3 s |
| 10 ms | ~3.5 s |
| 25 ms (cross-region) | **~7.1 s** |

Vercel's serverless function timeout on the Hobby plan is on the order of ten
seconds. At cross-region latency this lands close enough to that ceiling to
fail under any additional load, and Neon's autosuspend cold start (the first
request after idle) adds to it.

**And `createLeague` is not transactional.** It is ~20 separate write batches
with no `$transaction` wrapper. If it times out halfway, you get a `League`
row with teams but no players — a save that exists, appears on the home page,
and breaks when opened. Nothing cleans it up.

Mitigations, in order of value:

1. **Put the Neon database in the same region as your Vercel functions.** This
   is free and it is most of the fix.
2. Raise `maxDuration` on the route (`export const maxDuration = 60`) —
   see [Handoffs](#handoffs).
3. Batch the writes. 236 round trips for 5,300 rows means the chunk sizes are
   small; larger `createMany` chunks would cut this several-fold.
4. Wrap creation in `prisma.$transaction` so a timeout rolls back instead of
   leaving a broken save.

*Unverified:* I could not deploy to Vercel or measure real Neon latency from
here. The latency table is arithmetic on a measured round-trip count, not an
observed production timing. The 10-second Hobby limit is from Vercel's
documented defaults and should be confirmed against your plan.

### 2. Cookie-based save ownership is not authentication

This is worth being blunt about, because it will generate tester complaints
that look like bugs.

`lib/owner.ts` stamps each league with an opaque random id kept in an httpOnly
cookie. It is the correct boundary for a game with no accounts, and it fixed a
real problem (the home page used to list every league in the database, and
delete accepted any id). But it is **not** a login, and it has consequences a
tester will experience as data loss:

- **Clearing cookies loses every save.** Not hides — loses. The leagues stay
  in the database, but with no browser holding the key they become invisible
  and undeletable to everyone, forever. There is no recovery path and no
  "restore my saves" flow, because there is nothing to prove ownership with.
- **Saves do not follow a person across devices.** A dynasty started on a
  laptop does not exist on that person's phone. Same browser, same device,
  or nothing.
- **Private/incognito windows get a fresh identity** and lose it on close.
- **Anyone holding the cookie value is the owner.** It is httpOnly and
  `sameSite: 'lax'`, so it is not trivially readable by script, but it is a
  bearer token with a ten-year lifetime and no revocation.
- **Browsers may evict it.** Safari's ITP caps script-writable storage, and
  while an httpOnly cookie from a same-site response is more durable than
  `localStorage`, a ten-year `maxAge` is an intention, not a guarantee.

**Tell your testers this before they start**, in the app if you can: *saves
live in this browser, don't clear cookies, don't expect them on your phone.*
A tester who loses a twenty-season dynasty to a routine cache clear will
report it as the app deleting their data, and they will be right.

If saves need to survive that, it needs real accounts. Nothing short of an
identity the user can re-present fixes any of the above.

### 3. Creation limits are a speed bump, not a wall

`MAX_LEAGUES_PER_OWNER` (8) stops the honest case — someone clicking Create
repeatedly because the first attempt felt slow. It does not stop a deliberate
one: the identity is a cookie, and a script that discards cookies gets a fresh
allowance every request.

`MAX_LEAGUES_TOTAL` (500) is the real protection, because a caller rotating
cookies cannot get around a ceiling on the whole table. But note what it does
when reached: **it refuses creation for everybody, including legitimate
testers.** A determined abuser can deny new leagues to your testers by filling
the table. That is a deliberate trade — a full table you can clean up beats an
exhausted database quota — but know that is the behaviour.

There is **no rate limiting** on anything else. `advanceWeekAction` runs a
full week of simulation and can be called in a loop by anyone holding a valid
league id (their own, which is easy to have). If abuse becomes real, Vercel's
firewall or a small per-cookie throttle on the action is the next step.

### 4. Typecheck is clean, but several workstreams are mid-flight

`npx tsc --noEmit` currently passes with zero errors, verified on a clean
(non-incremental) run.

Two cautions, both learned the hard way during this audit:

- **`tsc --noEmit` here is incremental and its cache lies.** A stale
  `tsconfig.tsbuildinfo` reported success while a real error existed. Before
  trusting a green typecheck as a deploy gate, delete `tsconfig.tsbuildinfo`
  first. `next build` typechecks from scratch and will not be fooled, which
  means a build can fail on an error your local `tsc` just told you was not
  there.
- **`next build` has not been run in a long time**, and it surfaces a class of
  errors `tsc` cannot see at all: missing Suspense boundaries around
  `useSearchParams`, server/client component violations, and dynamic-route
  config problems. **I was unable to run it** — a dev server was live on port
  3001 for the whole session and `next build` shares the `.next` directory
  with it, which would have corrupted the running server. This is the single
  largest unverified area in this document. Run `npm run build` in a
  coordinated window before you trust a deploy, and expect it to find things.

### 5. Unbounded queries that grow with league age

The dashboard and league layout run on **every page view** and are not cached.
Two full-league player scans happen on every dashboard render:

- `lib/teamRating.ts` `buildLeagueRatings` — every active player in the league
  (~1,500 rows) to compute team ratings.
- `lib/frontOffice.ts` — every player on all 31 AI teams (~1,450 rows) to find
  a trade partner.

These scale with league *size*, which is fixed, so they are expensive but
bounded — roughly 3,000 rows read per dashboard view, forever.

These scale with league *age*, which is not bounded:

- `lib/gmCareer.ts` — `transaction.findMany({ where: { leagueId, type: 'TRADE' } })`
  with no `take` and no year floor. Every trade ever made, all seasons.
- `lib/storyline.ts` — `leagueRecord.findMany({ where: { leagueId } })`, no bound.

A twenty-season dynasty reads progressively more on every single page view
than a fresh one. Nothing breaks at ten seasons; this is a "gets slower the
more someone plays" problem, which is the worst kind to discover late because
it only appears in your most engaged testers.

The bounded ones are done correctly and are worth copying: the layout's ticker
query and the dashboard's wire query both use `take` **and** a
`seasonYear >= league.seasonYear - 1` floor.

The `Transaction` table has `@@index([leagueId, seasonYear, week])`, which
helps the bounded queries; the all-time `type: 'TRADE'` scan filters on a
column not in any index. `League` has no index on `ownerKey`, which the home
page and both creation limit checks filter on — small table today, worth an
index if it grows.

### 6. Other things worth knowing

- **The build needs network access to Google Fonts.** `app/layout.tsx` uses
  `next/font/google` (`Barlow_Condensed`), fetched at build time. Fine on
  Vercel; it will fail in a network-restricted build environment.
- **A database outage on a league page renders "not found", not an error.**
  `app/league/[id]/layout.tsx` does `getLeagueContext(...).catch(() => null)`
  then `notFound()`. Every failure — connection refused, timeout, genuinely
  missing league — becomes the same 404. A tester whose database hiccuped will
  be told their dynasty does not exist. See [Handoffs](#handoffs).
- **Server action error messages are redacted in production.** Next replaces
  them with a generic string plus a digest. The creation-limit message
  ("You already have 8 saved leagues…") reads correctly in development but a
  production user gets the generic error screen. The refusal still works and
  the database is still protected — only the wording is lost.
  *Unverified here:* I could not run a production build to observe this
  directly; it is documented Next.js behaviour.
- **No backups configured by you.** Neon has its own retention. Confirm the
  window before launch, and know that "restore to yesterday" also restores
  every tester's progress to yesterday.

---

## Handoffs

Changes worth making in files owned by other workstreams. Each is small.

**1. `app/league/[id]/layout.tsx` — stop masking outages as 404s.** Line ~20:

```ts
// currently:
const ctx = await getLeagueContext(params.id).catch(() => null);
if (!ctx || !ctx.userTeam) notFound();

// suggested: only "you can't see this" becomes 404; everything else
// propagates to app/league/[id]/error.tsx, which says the right thing.
const ctx = await getLeagueContext(params.id).catch((e) => {
  if (e instanceof Error && /belongs to another browser|not found|No League found/i.test(e.message)) return null;
  throw e;                       // DB down, timeout, bug -> real error boundary
});
if (!ctx || !ctx.userTeam) notFound();
```

**2. `app/page.tsx` — raise the timeout for league creation.** The create
server action runs on `/`, so the limit that applies is this page's:

```ts
export const maxDuration = 60;   // default is ~10s on Hobby
```

**3. `lib/gen/league.ts` — make creation transactional and chattier-cheaper.**
236 round trips is the root cause of the timeout risk. Larger `createMany`
chunks and a `prisma.$transaction` wrapper address both the latency and the
half-written-save problem in one change.

**4. `components/CreateLeagueForm.tsx` — surface the limit message.** Wrap the
action in `useActionState` so a `LeagueLimitError` renders inline instead of
throwing to the error boundary with a redacted message.

**5. `prisma/schema.prisma` — two indexes**, next time you write a migration:
`@@index([ownerKey])` on `League`, and `@@index([leagueId, type])` on
`Transaction`.

---

## Quick reference

```bash
# One-time, existing database only, BEFORE the first new-build-script deploy:
DATABASE_URL="<production>" npx prisma migrate resolve --applied 20260821160357_init

# Check state at any time:
DATABASE_URL="<production>" npx prisma migrate status

# Confirm the database matches the schema. Empty output = match; otherwise the
# output must be exactly the migrations in prisma/migrations/ that have not been
# applied yet, and nothing else:
DATABASE_URL="<production>" npx prisma migrate diff \
  --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script

# New schema change, locally:
npm run db:migrate -- --name describe_the_change
git add prisma/migrations
```
