/**
 * OPERATOR PASSWORD RESET — the entire account-recovery story.
 *
 * Sign-up asks for a username and a password and nothing else (see
 * docs/accounts.md for why an unverified email is not a recovery mechanism),
 * so there is no reset link and no self-service path. When a tester forgets
 * their password, this is what fixes it: the person running the deployment
 * sets a new one and tells them what it is.
 *
 * That is a deliberately small promise, and it is the honest one. The sign-up
 * form says so before anyone chooses a password.
 *
 *   npx tsx scripts/resetPassword.ts <username> <new-password>
 *   npx tsx scripts/resetPassword.ts --list
 *
 * Against production, set DATABASE_URL to the production connection string for
 * the one command:
 *
 *   DATABASE_URL="postgres://..." npx tsx scripts/resetPassword.ts habib 'a new long passphrase'
 *
 * NOTHING HERE PRINTS THE PASSWORD OR THE HASH. Not on success, not on error.
 * Shell history is the operator's problem to manage; this script's output is
 * not going to be the thing that leaks a credential into a log file.
 *
 * Every session for the user is destroyed as part of the reset — a password
 * change that leaves the old sessions live has not actually locked anyone out.
 */

import { prisma } from '../lib/db';
import { hashPassword, validatePassword } from '../lib/password';

function usage(): never {
  console.error('Usage: npx tsx scripts/resetPassword.ts <username> <new-password>');
  console.error('       npx tsx scripts/resetPassword.ts --list');
  process.exit(1);
}

async function list(): Promise<void> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      username: true,
      createdAt: true,
      _count: { select: { leagues: true, sessions: true } },
    },
  });
  if (users.length === 0) {
    console.log('No accounts yet.');
    return;
  }
  console.log(`${users.length} account(s):\n`);
  for (const u of users) {
    console.log(
      `  ${u.username.padEnd(22)} ${String(u._count.leagues).padStart(2)} save(s)  ` +
        `${String(u._count.sessions).padStart(2)} session(s)  created ${u.createdAt.toISOString().slice(0, 10)}`,
    );
  }
}

async function main(): Promise<void> {
  const [a, b] = process.argv.slice(2);
  if (!a) usage();
  if (a === '--list') {
    await list();
    return;
  }
  if (!b) usage();

  const problem = validatePassword(b);
  if (problem) {
    // The rule, not the value.
    console.error(`Refused: ${problem}`);
    process.exit(1);
  }

  const usernameKey = a.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { usernameKey },
    select: { id: true, username: true },
  });
  if (!user) {
    console.error(`No account named "${a}". Run with --list to see the accounts that exist.`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(b);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    // Signs every device out. A reset exists because control of the account is
    // in question; leaving the old sessions alive would defeat the point.
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);

  console.log(`Password reset for ${user.username}. All existing sessions were signed out.`);
  console.log('Tell them the new password out of band, and have them change it once they are in.');
}

main()
  .catch((err) => {
    // The message only — never the object, which on a Prisma error can carry
    // the parameters of the failing query.
    console.error('Reset failed:', err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
