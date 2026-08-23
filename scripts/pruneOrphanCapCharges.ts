/**
 * ===========================================================================
 * ORPHANED CAP CHARGES — THE SWEEP
 * ===========================================================================
 * `CapCharge` was keyed on `teamId` alone: no `leagueId`, and no foreign key
 * to anything. So deleting a league cascaded through Team, Player, Contract
 * and the rest and left every dead-money row behind, pointing at a team id
 * that no longer resolves. Nothing in the game could ever read them again and
 * nothing ever deleted them, so they accumulated for as long as leagues were
 * being created and thrown away — which, in a repo whose `scripts/` directory
 * builds a throwaway league per probe, is constantly. Measured on the dev
 * database before this script first ran: 18,247 orphans out of 22,203 rows.
 * Five of every six cap charges in it belonged to a league nobody could open.
 *
 * The schema no longer allows it (see the `team` relation on CapCharge —
 * `onDelete: Cascade`), so this cannot recur. This file is for the rows that
 * were already there when the constraint arrived, and it is tracked rather
 * than a scratch probe for two reasons: the migration that adds the foreign
 * key CANNOT APPLY while a single orphan exists, so any environment that has
 * been running this game needs it run first; and it is the honest way to
 * check, later, that the constraint is doing its job — a clean re-run
 * reporting zero is the assertion.
 *
 * WHAT COUNTS AS AN ORPHAN, and the definition is deliberately the narrowest
 * one that is safe: a row whose `teamId` matches no `Team`. NOT "a row whose
 * year is old" — dead money is meant to outlive the contract that created it,
 * and expireStaleCapCharges (lib/season.ts) is the only thing entitled to
 * decide a charge has been paid. NOT "a row belonging to a league I don't
 * recognise". If a Team row exists, the charge is reachable from a live save
 * and this script will not touch it.
 *
 * Usage:
 *   npx tsx scripts/pruneOrphanCapCharges.ts            # sweep
 *   npx tsx scripts/pruneOrphanCapCharges.ts --dry-run  # count only
 * ===========================================================================
 */
import { prisma } from '../lib/db';

const DRY_RUN = process.argv.includes('--dry-run');

async function counts() {
  const [{ total }] = await prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*)::bigint AS total FROM "CapCharge"`;
  const [{ orphans }] = await prisma.$queryRaw<{ orphans: bigint }[]>`
    SELECT count(*)::bigint AS orphans FROM "CapCharge" c
    WHERE NOT EXISTS (SELECT 1 FROM "Team" t WHERE t.id = c."teamId")`;
  return { total: Number(total), orphans: Number(orphans) };
}

async function main() {
  const before = await counts();
  console.log(`Before: ${before.total} cap charge(s), ${before.orphans} orphaned `
    + `(${before.total === 0 ? 0 : Math.round((before.orphans / before.total) * 100)}% of the table).`);

  if (DRY_RUN) {
    console.log('--dry-run: nothing deleted.');
  } else if (before.orphans === 0) {
    console.log('Nothing to sweep.');
  } else {
    // One statement, not a read-then-delete by id: a list of 18,000 ids is a
    // query plan nobody needs, and NOT EXISTS is the same predicate the count
    // above used, so what is deleted is exactly what was reported.
    const deleted = await prisma.$executeRaw`
      DELETE FROM "CapCharge" c
      WHERE NOT EXISTS (SELECT 1 FROM "Team" t WHERE t.id = c."teamId")`;
    console.log(`Deleted ${deleted} orphaned cap charge(s).`);
  }

  const after = await counts();
  console.log(`After:  ${after.total} cap charge(s), ${after.orphans} orphaned.`);
  if (!DRY_RUN && after.orphans !== 0) {
    console.error('Orphans remain after the sweep — something is writing them faster than this deletes them.');
    process.exit(1);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
