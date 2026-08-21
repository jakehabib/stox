'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  authenticate,
  claimLeaguesForUser,
  createSession,
  destroySession,
  registerUser,
} from '@/lib/auth';
import { readOwnerKey } from '@/lib/owner';

/**
 * Sign up, sign in, sign out. Three actions, and between them the only way a
 * session is ever created or destroyed.
 *
 * They return `{ error }` rather than throwing, because Next redacts thrown
 * Server Action messages in a production build and replaces them with a digest
 * — which would turn every "wrong username or password" into "an error
 * occurred" on the deployment where it actually matters. On success they
 * redirect, which is a throw Next understands and must not be caught.
 */

export interface AuthActionResult {
  error?: string;
}

/**
 * A `next` destination from the query string is attacker-controlled input.
 * Anything that isn't a plain same-site path is discarded: `//evil.example`
 * and `https://evil.example` are both valid values of `location` and both are
 * an open redirect, which is a phishing primitive handed out for free.
 */
function safeNext(next: string | null | undefined): string {
  if (!next) return '/';
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

/**
 * The destination after a successful sign-in or sign-up. `claimed` is how many
 * saves moved onto the account, so the home page can say so out loud — the
 * whole promise of signing up is "you won't lose these", and the moment to
 * prove it is the moment it happens.
 */
function destination(next: string, claimed: number): string {
  const base = safeNext(next);
  if (claimed <= 0) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}claimed=${claimed}`;
}

export async function signUpAction(formData: FormData): Promise<AuthActionResult> {
  const username = String(formData.get('username') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const next = String(formData.get('next') ?? '/');

  // Checked before the expensive hash, and checked server-side rather than
  // trusted from the form: a mistyped password nobody can recover is the exact
  // failure this account model has no answer for.
  if (password !== confirm) return { error: 'The two passwords do not match.' };

  const result = await registerUser(username, password);
  if (!result.ok) return { error: result.error };

  // Claim BEFORE the session exists, so there is no window in which the person
  // is signed in and looking at a home page that has lost their saves.
  const claimed = await claimLeaguesForUser(result.user.id, readOwnerKey());
  await createSession(result.user.id);

  revalidatePath('/', 'layout');
  redirect(destination(next, claimed));
}

export async function signInAction(formData: FormData): Promise<AuthActionResult> {
  const username = String(formData.get('username') ?? '');
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/');

  const result = await authenticate(username, password);
  if (!result.ok) return { error: result.error };

  // The claim runs on EVERY sign-in, not only the first. A player who created
  // a save signed out on a second device, then signed in, gets it attached —
  // which is the case the cookie model could never handle at all.
  const claimed = await claimLeaguesForUser(result.user.id, readOwnerKey());
  await createSession(result.user.id);

  revalidatePath('/', 'layout');
  redirect(destination(next, claimed));
}

/**
 * Deletes the session row and clears the cookie. `dgm_owner` is deliberately
 * left alone: rotating it would orphan any save that had not been claimed yet,
 * and it is harmless to keep, because a claimed save is unreachable by cookie
 * (see the predicate in lib/owner.ts).
 */
export async function signOutAction(): Promise<void> {
  await destroySession();
  revalidatePath('/', 'layout');
  redirect('/');
}
