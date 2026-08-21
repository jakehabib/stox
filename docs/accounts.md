# User accounts

Until now a save belonged to a browser. `lib/owner.ts` minted an opaque random
id, put it in an httpOnly cookie (`dgm_owner`), and stamped it onto
`League.ownerKey`. That is a correct boundary — it stops one tester listing or
deleting another's franchises — but the cookie *is* the credential. Clear
cookies and a twenty-season dynasty is gone, and a save cannot follow a person
to a second device.

This document is the design of the accounts layer that fixes that, and the
schema delta it needs.

---

## 1. What ownership means now

A league has two owner fields and they mean different things:

| field | meaning |
|---|---|
| `ownerKey` | the browser that made it, while signed out. Retained forever. |
| `userId`   | the account that has **claimed** it. Once set, the cookie no longer grants access. |

The single predicate (`ownsLeague` in `lib/owner.ts`) is:

```
if (row.userId == null && row.ownerKey == null) -> legacy save: allowed in dev only
if (viewer.userId != null)                      -> row.userId === viewer.userId
if (row.userId != null)                         -> false   // claimed; sign in to reach it
                                                -> row.ownerKey === viewer.ownerKey
```

Read the middle two lines carefully, because they are the part that is
**tighter** than what shipped before:

- **A signed-in viewer is matched on the account and nothing else.** Holding the
  cookie that originally created a save no longer gets you in once the save
  belongs to an account.
- **A signed-out viewer cannot reach a claimed save at all**, even from the very
  browser that made it. This is what makes a shared browser safe: after Alice
  signs up on the family laptop, signing out does not leave her dynasty
  reachable by whoever sits down next.

`ownedLeagueWhere()` builds a Prisma `where` that mirrors this predicate
clause-for-clause, so the list on the home page and the guard on an action can
never disagree.

## 2. Why `passwordHash` is nullable (the OAuth door)

Ownership hangs off `User`, never off a credential. A password is one way to
prove you are a `User`; a Discord account will be another. Adding Discord later
is a new `Account` table (`provider`, `providerAccountId`, `userId`) plus a
callback that resolves to a `User` and calls the same `createSession()` — the
ownership model, the claim flow, and all three enforcement points are untouched.
`passwordHash` is nullable from day one so an OAuth-only user is representable
without a second migration of this table.

`email` is added nullable and unique for the same reason: an OAuth provider
hands one over, and having the column now means the OAuth change adds a table
rather than altering this one. **Nothing writes it today** — see §4.

---

## 3. Schema delta

Three new models, two new columns on `League`. Every column added to an existing
table is nullable, because `prisma migrate deploy` runs against a database with
live rows.

```prisma
// ---------------------------------------------------------------------------
// Accounts (see docs/accounts.md)
// ---------------------------------------------------------------------------

model User {
  id       String @id @default(cuid())
  // As typed, for display. Uniqueness is enforced on usernameKey, not here.
  username String @unique
  // username.toLowerCase() — the actual lookup key, so "Habib" and "habib"
  // cannot both exist. Postgres has no case-insensitive unique index without
  // citext or a functional index, and Prisma models neither portably; a second
  // column is the boring, migratable way to say the same thing.
  usernameKey String @unique

  // Nullable and NEVER collected by the sign-up form today. Present so adding
  // an OAuth provider (which supplies one) or an opt-in recovery address later
  // is a write, not a migration. An unverified address is not a recovery
  // mechanism, so collecting one now would be a promise we cannot keep.
  email String? @unique

  // scrypt, versioned string (see lib/password.ts). NULLABLE on purpose: an
  // OAuth-only account has no password, and forcing a dummy value for one
  // would put a hash-shaped string in a column where "no password set" is the
  // truthful answer.
  passwordHash String?

  createdAt DateTime @default(now())

  sessions Session[]
  leagues  League[]
}

// Server-side session records. The cookie carries a random token; this table
// stores only its SHA-256, so a database leak does not hand out live sessions.
// (SHA-256 is correct HERE and wrong for passwords: the token already has 256
// bits of entropy, so there is nothing to brute-force and no salt to add.)
model Session {
  id        String @id @default(cuid())
  tokenHash String @unique

  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  createdAt  DateTime @default(now())
  expiresAt  DateTime
  // Bumped at most once a day so a sliding expiry does not mean a write on
  // every request of every page load.
  lastSeenAt DateTime @default(now())

  // Diagnostics only — never used to authorize. A session is valid because the
  // token hashes to a live row, not because it came from a familiar place.
  userAgent String?

  @@index([userId])
  @@index([expiresAt])
}

// Rate-limit ledger for sign-in and sign-up. Postgres rather than Redis: this
// deployment has one database and adding a second stateful dependency for a
// counter that a COUNT(*) over an indexed window answers correctly is not a
// trade worth making at this size.
model AuthAttempt {
  id String @id @default(cuid())

  // Bucket being counted. "u:<usernameKey>" throttles attacks on one account;
  // "ip:<addr>" throttles one source spraying many accounts. Both are checked.
  scope   String
  kind    String   // SIGNIN | SIGNUP
  success Boolean  @default(false)
  at      DateTime @default(now())

  @@index([scope, kind, at])
  @@index([at])
}
```

And on `League`:

```prisma
  // The ACCOUNT that owns this save, once claimed. Null means "still owned by
  // a browser cookie alone" — see ownerKey above and docs/accounts.md.
  // SetNull, not Cascade: deleting a user must never delete dynasties. The
  // save falls back to being cookie-owned rather than being destroyed.
  userId String?
  user   User?   @relation(fields: [userId], references: [id], onDelete: SetNull)

  // The claim query is `WHERE ownerKey = $1 AND userId IS NULL`, and the home
  // page lists by userId. Both want this.
  @@index([userId])
  @@index([ownerKey])
```

### Migration

`prisma/migrations/<ts>_user_accounts/migration.sql`. Additive only — three
`CREATE TABLE`s, two nullable `ADD COLUMN`s, indexes, one FK with
`ON DELETE SET NULL`. No existing row is rewritten, no column becomes
`NOT NULL`, so `migrate deploy` against the live Neon database is safe and
every existing cookie-owned save keeps working untouched.

---

## 4. Decisions, stated plainly

**No email is collected.** The sign-up form asks for a username and a password
and nothing else. An unverified email is not a recovery mechanism — anyone who
can type an address they do not own can take over the account it is attached to
— and verifying one means a mail provider, a deliverability problem and a
blocked tester on the afternoon the beta goes out. The column exists; the form
does not use it.

**Therefore there is no self-service password RESET**, and the sign-up form says
so, in the form, above the button — not in a footnote. If a tester forgets their
password, the operator resets it with `npx tsx scripts/resetPassword.ts` against
the production database. That is the whole recovery story today and it is
written down rather than implied.

**There is, however, a self-service password CHANGE**, at `/account`. The two
are different problems and only one of them needs an email: a reset is for
somebody who cannot prove who they are, a change is for somebody who can — they
type the current password. It exists because the operator reset above leaves a
tester holding a credential that somebody else chose, knows, and very likely
typed into a chat window, with no way to replace it. `changePassword()` in
`lib/auth.ts` verifies the current password (a live session cookie is *not*
sufficient authority to replace the credential that outlives it), applies the
same `validatePassword` policy sign-up uses, rate-limits on the same
`AuthAttempt` ledger, and then destroys **every** session on the account —
including the caller's, which `app/actions/account.ts` immediately replaces with
a fresh one for the browser that did the work. So a change made *because*
somebody else has your password actually ejects them, and does not log you out
of the tab you are standing in.

**Signing out does not clear `dgm_owner`.** Rotating it would orphan any save
that had not been claimed yet. It stays, and it stays harmless, because a
claimed save is unreachable by cookie.

**Claiming is `ownerKey = <this cookie> AND userId IS NULL`, in one
`updateMany`.** It runs on sign-up and on every sign-in. Consequences:

- *Signing in on a different browser that has its own unclaimed leagues*: yes,
  they are absorbed. The cookie was the only credential those saves ever had, and
  the person signing in is the person holding it. The alternative — stranding a
  save that its creator is looking straight at — loses dynasties, which is the
  one thing this work exists to prevent.
- *A cookie whose leagues are already claimed by another account*: nothing is
  taken. `userId IS NULL` is the whole guard, and it is evaluated inside the
  single UPDATE, so two simultaneous claims cannot both win a league.
- *Two accounts on one shared browser*: safe in both directions. Alice's claimed
  saves are invisible to signed-out Bob (predicate above) and untouchable by
  Bob's claim (`userId IS NULL` fails). Bob's own unclaimed saves are still his.
