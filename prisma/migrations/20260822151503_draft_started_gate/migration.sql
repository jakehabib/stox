-- AlterTable
ALTER TABLE "DraftState" ADD COLUMN     "started" BOOLEAN NOT NULL DEFAULT false;

-- A draft that already exists was already running. `started` gates the ticker,
-- so taking the column default would strand every save currently on the clock:
-- the war-room panel only offers its button before the first selection, and a
-- league forty picks deep would show neither the button nor a moving board.
-- Backfill first, gate second — from here on only drafts created AFTER this
-- migration are born unstarted.
UPDATE "DraftState" SET "started" = true;
