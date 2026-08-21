'use client';

import Link from 'next/link';
import { useState } from 'react';

export interface AuthFormResult {
  error?: string;
}

/**
 * The sign-in and sign-up form. One component for both, because they differ by
 * a field, a heading and a warning — not by behaviour — and two near-identical
 * forms is how the two drift apart.
 *
 * Deliberately NOT `useFormState`: react-dom 18.3.1 as installed here does not
 * export it (checked, not assumed), so the pending and error states are held
 * locally and the server action is called from the form action directly. On
 * success the action redirects, which throws through this handler on purpose —
 * React's form handling knows what to do with a redirect and nothing after the
 * await should run.
 */
export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: 'signin' | 'signup';
  action: (formData: FormData) => Promise<AuthFormResult>;
  next: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const signup = mode === 'signup';

  async function submit(formData: FormData) {
    setError(null);
    setPending(true);
    try {
      const result = await action(formData);
      if (result?.error) setError(result.error);
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={submit} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <div className="space-y-1.5">
        <label htmlFor="username" className="label-sm block">Username</label>
        <input
          id="username"
          name="username"
          className="input w-full"
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          required
          maxLength={20}
          placeholder="coach_belichick"
        />
        {signup && (
          <p className="text-xs text-muted">3–20 characters. Letters, numbers and underscores.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="label-sm block">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          className="input w-full"
          autoComplete={signup ? 'new-password' : 'current-password'}
          required
          // A courtesy to someone typing. The real check is server-side in
          // lib/password.ts — this attribute is trivially removed and a server
          // action is a public POST endpoint.
          minLength={signup ? 10 : undefined}
          maxLength={256}
        />
        {signup && <p className="text-xs text-muted">At least 10 characters. Length beats symbols.</p>}
      </div>

      {signup && (
        <div className="space-y-1.5">
          <label htmlFor="confirm" className="label-sm block">Confirm password</label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            className="input w-full"
            autoComplete="new-password"
            required
            maxLength={256}
          />
        </div>
      )}

      {/* THE WARNING. Above the button, in the flow, in plain words — not a
          tooltip and not a line in a doc. There is no email on file and no
          reset link, so a forgotten password is a lost account, and someone
          choosing one deserves to know that before they choose it rather than
          after. */}
      {signup && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-4 py-3">
          <div className="label-sm text-warn">Before you continue</div>
          <p className="text-sm text-chalk/90 mt-1.5 leading-relaxed">
            We don&apos;t ask for your email, so <strong className="font-semibold">there is no password reset</strong>.
            If you forget this password, nobody can send you a link and your saves stay locked to the account.
            Write it down or use a password manager.
          </p>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad"
        >
          {error}
        </div>
      )}

      {/* Pending is raised from the click, not from inside `submit`. React as
          bundled by Next 14 runs a form action inside a transition and
          deprioritises state set there — verified on the league-create form,
          where the working state never got a commit at all. Same shape here,
          same fix. The button stays enabled because disabling it from its own
          click handler can cancel the submission it was meant to start; the
          duplicate-submit risk is covered server-side, where a taken username
          comes back as an error rather than a second account. */}
      <button
        type="submit"
        className="btn-primary w-full"
        aria-busy={pending}
        onClick={(e) => {
          if (e.currentTarget.form?.checkValidity() !== false) setPending(true);
        }}
      >
        {pending && <span className="spinner-ring" aria-hidden />}
        <span>{pending ? (signup ? 'Creating account…' : 'Signing in…') : signup ? 'Create account' : 'Sign in'}</span>
      </button>

      <p className="text-sm text-muted text-center">
        {signup ? (
          <>Already have an account? <Link href="/sign-in" className="text-accent2 hover:underline">Sign in</Link></>
        ) : (
          <>No account yet? <Link href="/sign-up" className="text-accent2 hover:underline">Create one</Link></>
        )}
      </p>
    </form>
  );
}
