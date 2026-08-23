-- WHO WAS HOLDING THE TROPHY.
--
-- `ChampionRoster` holds one row per man on the champion's roster at the
-- moment the final ends — written by snapshotSeasonHistory (lib/season.ts),
-- which is the last instant that roster still exists before free agency,
-- retirements and the draft begin rewriting it. About 50 rows a league year.
--
-- It exists because PlayerSeason cannot answer the question. That table is
-- written from box-score lines, and a box score names the quarterback, three
-- backs, six receivers, fourteen defenders and two specialists. Measured on a
-- real champion's 49-man roster: 31 men had a row, 18 had none, and every
-- offensive lineman on the club — all ten — had none. A man with no counting
-- stat in the title year who has since left the club cannot be reached by any
-- inference at all: nothing places him on that roster and nothing contradicts
-- it either. resolveRingYears (lib/gen/leagueHistory.ts) prefers these rows
-- and keeps its inference only for titles won before this table existed.
--
-- PURELY ADDITIVE, and that is checked rather than assumed: `prisma migrate
-- diff` against the live database emitted exactly the statements below and
-- nothing else. One new table, two new indexes, three new foreign keys. No
-- existing table, column, constraint or row is read or altered, so there is no
-- row this can reject and nothing for it to lose — unlike the CapCharge
-- cascade (20260823124600), which had to clear orphans before its ADD
-- CONSTRAINT could validate. Existing saves come out with an empty table and
-- fall back to the inference path, which is unchanged.

-- CreateTable
CREATE TABLE "ChampionRoster" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonYear" INTEGER NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,

    CONSTRAINT "ChampionRoster_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChampionRoster_leagueId_seasonYear_idx" ON "ChampionRoster"("leagueId", "seasonYear");

-- A man is on one roster at a time, so he holds at most one trophy in a
-- season. This is the idempotency key the write relies on (`skipDuplicates`),
-- so a re-entered offseason step cannot double a roster.
-- CreateIndex
CREATE UNIQUE INDEX "ChampionRoster_playerId_seasonYear_key" ON "ChampionRoster"("playerId", "seasonYear");

-- Every key cascades: a championship roster is meaningless without the league,
-- the club or the man, and unlike a CapCharge (INV-23) there is no bill left
-- behind to answer for.
-- AddForeignKey
ALTER TABLE "ChampionRoster" ADD CONSTRAINT "ChampionRoster_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChampionRoster" ADD CONSTRAINT "ChampionRoster_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChampionRoster" ADD CONSTRAINT "ChampionRoster_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
