-- CAP CHARGES BELONG TO A CLUB, AND NOW THE DATABASE KNOWS IT.
--
-- `CapCharge` carried a bare `teamId` with no foreign key to anything, so
-- deleting a league cascaded through Team, Player, Contract and every other
-- table and left the dead money behind, pointing at a team id that no longer
-- resolved. Nothing could read those rows again and nothing ever deleted them.
-- On the dev database that was 18,247 orphans out of 22,203 rows — five of
-- every six cap charges in it belonged to a league nobody could open.
--
-- THE ORPHANS HAVE TO GO FIRST, and this is not tidiness: ADD CONSTRAINT
-- validates every existing row, so with a single orphan present the statement
-- below it FAILS and this migration cannot apply at all. The delete is scoped
-- to exactly the rows the constraint would reject — a charge whose team does
-- not exist — and touches nothing reachable from a live save. Charges against
-- a team that still exists are untouched whatever their year: dead money is
-- meant to outlive the contract that created it, and expireStaleCapCharges
-- (lib/season.ts) remains the only thing entitled to decide one has been paid.
-- scripts/pruneOrphanCapCharges.ts is the same delete, re-runnable.
DELETE FROM "CapCharge" c WHERE NOT EXISTS (SELECT 1 FROM "Team" t WHERE t.id = c."teamId");

-- CASCADE FROM TEAM, not from Contract or Player. A club's dead money outlives
-- the deals and the men that created it; it dies only with the club, and
-- nothing in this game deletes a single team — only a whole league, which
-- cascades into Team already. So this fires on exactly one event: a save being
-- deleted, where these rows are unreachable by definition.
-- AddForeignKey
ALTER TABLE "CapCharge" ADD CONSTRAINT "CapCharge_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
