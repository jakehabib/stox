-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "careerPlayoffStats" TEXT NOT NULL DEFAULT '{}',
ADD COLUMN     "playoffStats" TEXT NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "PlayerSeason" ADD COLUMN     "playoffGp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "playoffStats" TEXT NOT NULL DEFAULT '{}';

