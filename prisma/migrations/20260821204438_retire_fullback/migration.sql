-- Retire the fullback as a position.
--
-- Eleven personnel (1 RB, 1 TE, 3 WR) is the base offence this game now models,
-- and a fullback is a situational blocker who never appears in it. The position
-- is gone from generation and from every position-keyed table in the codebase.
--
-- Existing players are CONVERTED, not deleted. A fullback is a running back in
-- every way this game models one -- same position group, same stat line, same
-- build -- so nobody loses a player, a contract, a depth-chart place or a career
-- stat line. Deleting the position from the code without this would leave those
-- rows carrying a position the type system says cannot exist, and every
-- Record<Position, ...> lookup keyed on it would return undefined and quietly
-- produce NaN. That is the failure mode that hid a twelve-man defence in this
-- same codebase.
--
-- Data-only: Player.position is a plain String column, so there is no schema
-- change to make.
UPDATE "Player" SET "position" = 'RB' WHERE "position" = 'FB';

-- Depth-chart slots are DELETED rather than converted. The table is uniquely
-- keyed on (teamId, position, rank), so rewriting an FB slot to RB collides
-- head-on with the running back who already holds that rank -- the first
-- attempt at this migration failed on exactly that constraint. The players
-- themselves are untouched and remain on their rosters; they simply lose a
-- pinned depth slot and fall to the end of the running-back order, which is
-- where a converted blocking back belongs anyway. The depth chart is
-- reorderable and auto-sortable, so nothing is lost that the user cannot
-- immediately fix.
DELETE FROM "DepthChartSlot" WHERE "position" = 'FB';
