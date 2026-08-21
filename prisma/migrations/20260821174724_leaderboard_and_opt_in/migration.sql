-- AlterTable
ALTER TABLE "User" ADD COLUMN     "leaderboardOptIn" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DynastyRank" (
    "id" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "saveKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "seasons" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "championships" INTEGER NOT NULL DEFAULT 0,
    "teamName" TEXT NOT NULL,
    "teamAbbr" TEXT NOT NULL,
    "crestSeed" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DynastyRank_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DynastyRank_sport_xp_idx" ON "DynastyRank"("sport", "xp");

-- CreateIndex
CREATE INDEX "DynastyRank_userId_idx" ON "DynastyRank"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DynastyRank_sport_saveKey_key" ON "DynastyRank"("sport", "saveKey");

-- AddForeignKey
ALTER TABLE "DynastyRank" ADD CONSTRAINT "DynastyRank_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
