-- CreateTable
CREATE TABLE "PowerRankingSnapshot" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "seasonYear" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "powerIndex" DOUBLE PRECISION NOT NULL,
    "rating" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "ties" INTEGER NOT NULL,
    "netPerGame" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PowerRankingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PowerRankingSnapshot_leagueId_seasonYear_week_idx" ON "PowerRankingSnapshot"("leagueId", "seasonYear", "week");

-- CreateIndex
CREATE UNIQUE INDEX "PowerRankingSnapshot_leagueId_seasonYear_week_teamId_key" ON "PowerRankingSnapshot"("leagueId", "seasonYear", "week", "teamId");

-- AddForeignKey
ALTER TABLE "PowerRankingSnapshot" ADD CONSTRAINT "PowerRankingSnapshot_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PowerRankingSnapshot" ADD CONSTRAINT "PowerRankingSnapshot_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
