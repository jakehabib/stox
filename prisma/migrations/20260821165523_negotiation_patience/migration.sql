-- CreateTable
CREATE TABLE "NegotiationTalks" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "seasonYear" INTEGER NOT NULL,
    "patienceSpent" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NegotiationTalks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NegotiationTalks_leagueId_seasonYear_idx" ON "NegotiationTalks"("leagueId", "seasonYear");

-- CreateIndex
CREATE INDEX "NegotiationTalks_playerId_idx" ON "NegotiationTalks"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "NegotiationTalks_teamId_playerId_seasonYear_key" ON "NegotiationTalks"("teamId", "playerId", "seasonYear");

-- AddForeignKey
ALTER TABLE "NegotiationTalks" ADD CONSTRAINT "NegotiationTalks_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationTalks" ADD CONSTRAINT "NegotiationTalks_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationTalks" ADD CONSTRAINT "NegotiationTalks_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
