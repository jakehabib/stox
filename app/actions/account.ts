'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { changePassword, createSession, getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Account settings actions: the public-leaderboard toggle, and the
 * self-service password change.
 *
 * Both return `{ error }` / `{ ok }` rather than throwing, for the same reason
 * the auth actions do: Next redacts thrown Server Action messages in a
 * production build and replaces them with a digest, which would turn "wrong
 * current password" into "an error occurred" on the deployment where it
 * actually matters.
 *
 * Every action here re-reads the session itself. A Server Action is a public
 * POST endpoint; the fact that the page that rendered the form checked who was
 * signed in protects nothing.
 */

export interface AccountActionResult {
  ok?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Public leaderboard visibility
// ---------------------------------------------------------------------------

/**
 * Publish, or stop publishing, this account on the public board.
 *
 * OPTING OUT DELETES THE ROWS. It does not set a flag that the read path is
 * trusted to honour. "Take me off the board" should mean the public table no
 * longer contains me, not that one query remembers to filter me out — the
 * first is a fact, the second is a promise that a future `findMany` can break
 * by forgetting a `where`. The rows are a derived cache and cost nothing to
 * rebuild, so deleting them is free.
 *
 * Opting IN writes nothing here. The board's own refresh derives the row from
 * franchise history the next time anyone loads /leaderboard, which is the only
 * moment the number is guaranteed fresh.
 */
export async function setLeaderboardVisibilityAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  // Returns void, not a result object, because this is a PLAIN form with no
  // client component behind it — there is nothing to render an error into. A
  // caller with no session is sent to sign in, which is the only useful thing
  // that can happen next.
  if (!user) redirect('/sign-in?next=/account');

  // Explicitly 'on' or nothing. The button carries the value; see the comment
  // on the form in app/account/page.tsx for why it is not a checkbox.
  const listed = String(formData.get('listed') ?? '') === 'on';

  await prisma.user.update({ where: { id: user.id }, data: { leaderboardOptIn: listed } });

  if (!listed) {
    await prisma.dynastyRank.deleteMany({ where: { userId: user.id } });
  }

  // Both surfaces move: the account page's own state, and the board itself.
  revalidatePath('/account');
  revalidatePath('/leaderboard');
}

// ---------------------------------------------------------------------------
// Password change
// ---------------------------------------------------------------------------

/**
 * Change the signed-in account's password.
 *
 * The policy, the verification of the current password and the rate limit all
 * live in `changePassword` in lib/auth.ts, next to the rest of the credential
 * handling. What this layer owns is the two things that need the request: the
 * confirmation field, and re-issuing a session for the browser that just did
 * the work.
 *
 * SESSIONS AFTER A CHANGE. `changePassword` kills every session for the
 * account, this one included; the `createSession` below then issues a fresh
 * one to THIS browser. So every other signed-in device is logged out and the
 * person who made the change stays where they are. A change made *because*
 * somebody else has your password has to actually eject them, and a change
 * that logs you out of the tab you are standing in is a worse experience for
 * no extra safety.
 */
export async function changePasswordAction(formData: FormData): Promise<AccountActionResult> {
  const user = await getSessionUser();
  if (!user) return { error: 'Sign in first.' };

  const current = String(formData.get('current') ?? '');
  const next = String(formData.get('next') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  // Checked here rather than in lib/auth.ts because a confirmation field is a
  // property of this form, not of the credential model — and checked before
  // the expensive verify, because a typo should not cost 200ms of scrypt.
  if (next !== confirm) return { error: 'The two new passwords do not match.' };

  const result = await changePassword(user.id, current, next);
  if (!result.ok) return { error: result.error };

  // Re-admit this browser. Nothing between the sweep above and here can sign
  // anyone in, so there is no window in which the old cookie works.
  await createSession(user.id);

  revalidatePath('/account');
  return { ok: true };
}
