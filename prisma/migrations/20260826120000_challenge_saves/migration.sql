-- CHALLENGE SAVES: two additive column groups, no second table.
--
-- This migration runs against the LIVE database on the next deploy
-- (`prisma migrate deploy` is in the build script), so it does exactly one
-- kind of thing: it adds columns. Nothing is dropped, nothing is renamed,
-- nothing is retyped, no constraint is added to an existing column, and every
-- added column is either nullable or has a DEFAULT — so every row already in
-- these two tables is valid the instant the statements land, and the deploy
-- cannot fail on data it has never seen.
--
-- 1. League.gmHiredYear — the season this save's GM was hired, which is NOT
--    the season the league was founded. They are the same for every league
--    founded in the ordinary way, and that is exactly why this is NULL rather
--    than backfilled: null means "same as the founding year". They come apart
--    only for a redeemed challenge, which carries the publisher's standings,
--    picks and cap sheet and must carry none of their career. It could not be
--    done by moving `League.startYear` because the salary cap's ceiling is
--    grown from that year (capForYear, lib/leagueYear.ts), so re-stamping it
--    would reset every club's cap space. The founding year stays; the TENURE
--    bound moves. See resolveTenureStartYear in lib/leagueYear.ts.
--
-- 2. PublishedLeague.kind and the nine save-only summary columns — one table
--    holds both a published league file and a published challenge.
--    `kind` carries DEFAULT 'LEAGUE' precisely so the rows already there are
--    correctly classified with no UPDATE: everything published before this
--    deploy is a league file. The nine `save*`/`challenge*` columns are NULL
--    for those rows, which is what they mean. The argument for one table
--    rather than two is in the model comment in prisma/schema.prisma: `code`
--    is unique, and that is what makes "a code resolves to exactly one thing"
--    structurally true instead of something two resolvers have to agree on.

-- AlterTable
ALTER TABLE "League" ADD COLUMN     "gmHiredYear" INTEGER;

-- AlterTable
ALTER TABLE "PublishedLeague" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'LEAGUE',
ADD COLUMN     "saveSeasonYear" INTEGER,
ADD COLUMN     "savePhase" TEXT,
ADD COLUMN     "saveWeek" INTEGER,
ADD COLUMN     "saveTeamAbbr" TEXT,
ADD COLUMN     "saveTeamName" TEXT,
ADD COLUMN     "saveRecord" TEXT,
ADD COLUMN     "saveHistory" BOOLEAN,
ADD COLUMN     "challengeTitle" TEXT,
ADD COLUMN     "challengeBrief" TEXT;

-- CreateIndex
CREATE INDEX "PublishedLeague_userId_kind_idx" ON "PublishedLeague"("userId", "kind");
