/**
 * ===========================================================================
 * TAKE A SHARE CODE DOWN
 * ===========================================================================
 *   npm run codes:takedown -- <code> "<reason>"
 *   npm run codes:takedown -- <code> --show
 *
 * The operator's half of the lifecycle. A publisher can withdraw their own
 * code from the league's settings screen; this is for the other case — the
 * owner gets a complaint about a published league and has to be able to make
 * it stop resolving without asking the person who published it.
 *
 * A SHELL SCRIPT RATHER THAN A SCREEN, because there is no administrator
 * account in this deployment to authenticate one. Running this needs the
 * database URL, which is the only credential that exists for the job. The day
 * there is an admin role, the check goes at a route rather than in here, and
 * `takeDownPublication` is already written to take the decision from its
 * caller.
 *
 * IT MARKS, IT DOES NOT DELETE (see lib/publication.ts). The row stays so the
 * code is spent rather than returned to the pool, and so there is a record of
 * what was taken down and why. A marked code resolves exactly as a code that
 * was never published does — no "withdrawn" message, because that would
 * confirm to a stranger that the code was real.
 *
 * `--show` prints what is filed under a code and changes nothing, so an
 * operator can see what they are about to act on. It prints the preview
 * columns and the publisher, never the stored file.
 * ===========================================================================
 */
import { prisma } from '../lib/db';
import { takeDownPublication } from '../lib/publication';
import { formatShareCode, normalizeShareCode } from '../lib/shareCode';

async function main() {
  const [rawCode, ...rest] = process.argv.slice(2);
  if (!rawCode) {
    console.error('Usage: npm run codes:takedown -- <code> "<reason>"   (or: <code> --show)');
    process.exitCode = 1;
    return;
  }

  const code = normalizeShareCode(rawCode);
  if (code == null) {
    console.error(`"${rawCode}" is not a share code. Ten Crockford base32 symbols, grouping optional.`);
    process.exitCode = 1;
    return;
  }

  const row = await prisma.publishedLeague.findUnique({
    where: { code },
    select: {
      leagueName: true, teamCount: true, rosteredPlayers: true, freeAgents: true, hasDraftClass: true,
      fileBytes: true, openCount: true, createdAt: true, lastOpenedAt: true,
      takenDownAt: true, takedownReason: true, sourceLeagueId: true,
      user: { select: { id: true, username: true } },
    },
  });

  if (!row) {
    console.log(`${formatShareCode(code)}: nothing is filed under that code.`);
    return;
  }

  console.log(`\n${formatShareCode(code)}`);
  console.log(`  league        ${row.leagueName}`);
  console.log(`  contents      ${row.teamCount} teams, ${row.rosteredPlayers} rostered, ${row.freeAgents} free agents, ${row.hasDraftClass ? 'a' : 'no'} draft class`);
  console.log(`  file          ${(row.fileBytes / 1_048_576).toFixed(2)}MB uncompressed`);
  console.log(`  publisher     ${row.user.username} (${row.user.id})`);
  console.log(`  source save   ${row.sourceLeagueId ?? '(none recorded)'}`);
  console.log(`  published     ${row.createdAt.toISOString()}`);
  console.log(`  last opened   ${row.lastOpenedAt?.toISOString() ?? 'never'} (${row.openCount} time(s))`);
  console.log(`  taken down    ${row.takenDownAt ? `${row.takenDownAt.toISOString()} — ${row.takedownReason ?? ''}` : 'no'}`);

  if (rest[0] === '--show') return;

  const reason = rest.join(' ').trim();
  if (reason.length === 0) {
    console.error('\nA reason is required. It is the record of why this was done.');
    process.exitCode = 1;
    return;
  }
  if (row.takenDownAt) {
    console.log('\nAlready taken down. Nothing changed.');
    return;
  }

  const done = await takeDownPublication(code, reason);
  console.log(done
    ? `\nTaken down. ${formatShareCode(code)} now resolves exactly as a code nobody published.`
    : '\nNothing changed.');
}

main().finally(() => prisma.$disconnect());
