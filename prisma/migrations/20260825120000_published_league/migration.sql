-- SHARE CODES: one table, and nothing else.
--
-- `PublishedLeague` holds a league file somebody chose to publish under a
-- 10-symbol Crockford base32 code (lib/shareCode.ts, lib/publication.ts). The
-- gzipped file lives in `payload`; the four preview facts beside it are
-- counted off that file at publish time so a recipient can be shown what they
-- are getting without a megabyte being decompressed to render a card.
--
-- ADDITIVE, AND DELIBERATELY NOTHING MORE. This migration runs against the
-- live database on the next deploy (`prisma migrate deploy` is in the build),
-- so it does exactly one thing: it creates a table that did not exist. No
-- existing table is altered, no column is dropped, renamed or retyped, and
-- nothing here can fail against live rows — there are no live rows in a table
-- being created. League in particular is untouched: a published file is a
-- snapshot, so `sourceLeagueId` is a plain column with no foreign key and
-- deleting the save a code was cut from leaves the code working (see the
-- model comment for why that is the behaviour we want).
--
-- The one foreign key is to User, ON DELETE CASCADE: publishing requires an
-- account, so deleting the account withdraws its codes.
-- CreateTable
CREATE TABLE "PublishedLeague" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "payload" BYTEA NOT NULL,
    "fileBytes" INTEGER NOT NULL,
    "formatVersion" INTEGER NOT NULL,
    "leagueName" TEXT NOT NULL,
    "teamCount" INTEGER NOT NULL,
    "rosteredPlayers" INTEGER NOT NULL,
    "freeAgents" INTEGER NOT NULL,
    "hasDraftClass" BOOLEAN NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceLeagueId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOpenedAt" TIMESTAMP(3),
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "takenDownAt" TIMESTAMP(3),
    "takedownReason" TEXT,

    CONSTRAINT "PublishedLeague_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublishedLeague_code_key" ON "PublishedLeague"("code");

-- CreateIndex
CREATE INDEX "PublishedLeague_userId_idx" ON "PublishedLeague"("userId");

-- CreateIndex
CREATE INDEX "PublishedLeague_createdAt_idx" ON "PublishedLeague"("createdAt");

-- CreateIndex
CREATE INDEX "PublishedLeague_lastOpenedAt_idx" ON "PublishedLeague"("lastOpenedAt");

-- AddForeignKey
ALTER TABLE "PublishedLeague" ADD CONSTRAINT "PublishedLeague_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
