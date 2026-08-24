-- Named offensive and defensive schemes are gone.
--
-- `Team.offScheme` and `Team.defScheme` held one of five strings picked by a
-- coin flip at league creation and never changed again. `Staff.scheme` held a
-- copy of the same string for the coordinator. Between them they drove exactly
-- two things: a pass/run play-call rate whose envelope was 1.54x the real NFL's
-- (no real team-season in six years reached the 0.68 the "Air Raid" value set),
-- and a scheme-fit rating bonus that paid four fifths of the league an
-- unconditional +1.2 rating points and the other fifth nothing.
--
-- Both are deleted. How often a club throws it is now derived in
-- lib/sim/tendency.ts from the club's own id plus the league year, so no column
-- is needed and every existing save picks it up with no data migration: a club
-- that already exists already has an id, and therefore already has a tendency.
--
-- Nothing reads these three columns any more, and a column nothing reads is a
-- comment describing a policy the code no longer follows, in schema form.
--
-- NOTHING IS RECOMPUTED. Past box scores (`Game.boxScore`) and past season stat
-- lines (`PlayerSeason`) are stored rows, written once when a game was played.
-- Dropping these columns cannot reach them, so every season already played
-- stays exactly as it was.
ALTER TABLE "Team" DROP COLUMN "offScheme";
ALTER TABLE "Team" DROP COLUMN "defScheme";
ALTER TABLE "Staff" DROP COLUMN "scheme";
