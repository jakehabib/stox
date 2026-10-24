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
 *
 * IT COVERS BOTH TIERS. One code namespace holds league files and CHALLENGES
 * — whole saves published as situations, lib/savePublication.ts — and a
 * takedown is a property of a published thing rather than of what kind of
 * thing it is, so this takes either down with the same statement. The report
 * says which kind it found and, for a challenge, prints the title and brief
 * the publisher wrote, since that prose is the usual subject of a complaint.
 * ===========================================================================
 */
import { prisma } from '../lib/db';
import { takeDownPublication } from '../lib/publication';
import { formatShareCode, normalizeShareCode } from '../lib/shareCode';
import { describeSituation } from '../lib/saveFile';

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
      // `kind` and the nine columns under it exist because this table holds
      // two things: a league file and a CHALLENGE, which is a whole save
      // somebody published as a situation (lib/savePublication.ts). The
      // takedown itself is kind-agnostic — a code is a code, and marking one
      // works the same either way — but an operator about to burn a code has
      // to be able to see WHAT it is, including the title and brief the
      // publisher wrote, which is the part somebody might be complaining
      // about.
      kind: true,
      leagueName: true, teamCount: true, rosteredPlayers: true, freeAgents: true, hasDraftClass: true,
      saveSeasonYear: true, savePhase: true, saveWeek: true, saveTeamAbbr: true, saveTeamName: true,
      saveRecord: true, saveHistory: true, challengeTitle: true, challengeBrief: true,
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
  console.log(`  kind          ${row.kind === 'SAVE' ? 'CHALLENGE (a whole save)' : 'LEAGUE FILE (a starting point)'}`);
  console.log(`  league        ${row.leagueName}`);
  console.log(`  contents      ${row.teamCount} teams, ${row.rosteredPlayers} rostered, ${row.freeAgents} free agents, ${row.hasDraftClass ? 'a' : 'no'} draft class`);
  if (row.kind === 'SAVE') {
    // The same sentence the recipient's card shows, out of the same function,
    // so an operator and a complainant are looking at the same words.
    console.log(`  situation     ${describeSituation({
      teamAbbr: row.saveTeamAbbr, record: row.saveRecord,
      phase: row.savePhase ?? 'PRESEASON', week: row.saveWeek ?? 1, seasonYear: row.saveSeasonYear ?? 0,
    })}`);
    console.log(`  club          ${row.saveTeamName ?? '(none recorded)'}`);
    console.log(`  history       ${row.saveHistory ? 'carried' : 'not carried'}`);
    console.log(`  title         ${row.challengeTitle ?? '(none)'}`);
    console.log(`  brief         ${row.challengeBrief ?? '(none)'}`);
  }
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
