'use client';

import { useRef, useState } from 'react';

export interface ChangePasswordResult {
  ok?: boolean;
  error?: string;
}

/**
 * Self-service password change: current, new, confirm.
 *
 * Deliberately NOT `useFormState` — react-dom 18.3.1 as installed here does
 * not export it (the AuthForm comment records that this was checked, not
 * assumed), so pending and error state are held locally and the action is
 * called from the form action directly.
 *
 * The three `minLength`/`maxLength` attributes are a courtesy to someone
 * typing. Every rule that matters is enforced server-side in
 * `changePassword` (lib/auth.ts) via `validatePassword` (lib/password.ts),
 * because a Server Action is a public POST endpoint and this form is not the
 * only thing that can call it.
 */
export function ChangePasswordForm({
  action,
  minLength,
}: {
  action: (formData: FormData) => Promise<ChangePasswordResult>;
  /** Passed in from the server page. lib/password.ts imports node:crypto and
   *  must never be pulled into a client bundle just to read one number. */
  minLength: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(formData: FormData) {
    setError(null);
    setDone(false);
    try {
      const result = await action(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setDone(true);
        // Clearing the fields matters here in a way it does not on sign-in:
        // three password boxes left populated on a settings page are three
        // credentials sitting in the DOM of a tab that stays open.
        formRef.current?.reset();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} action={submit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="current" className="label-sm block">Current password</label>
        <input
          id="current"
          name="current"
          type="password"
          className="input w-full"
          autoComplete="current-password"
          required
          maxLength={256}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="next" className="label-sm block">New password</label>
        <input
          id="next"
          name="next"
          type="password"
          className="input w-full"
          autoComplete="new-password"
          required
          minLength={minLength}
          maxLength={256}
        />
        <p className="text-xs text-muted">At least {minLength} characters. Length beats symbols.</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="confirm" className="label-sm block">Confirm new password</label>
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

      {/* Said before the button, not after the fact. Changing a password here
          ends every other session on the account, which is the point of doing
          it — but it is also the thing that will surprise someone playing on a
          phone and a laptop at the same time. */}
      <div className="rounded-md border border-warn/40 bg-warn/10 px-4 py-3">
        <div className="label-sm text-warn">This signs out your other devices</div>
        <p className="text-sm text-chalk/90 mt-1.5 leading-relaxed">
          Every other session on this account ends immediately. This browser stays signed in. There is still no
          password reset — if you forget the new one, nobody can send you a link.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
          {error}
        </div>
      )}
      {done && (
        <div role="status" className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
          Password changed. Every other session on this account has been signed out.
        </div>
      )}

      {/* Pending is raised from the CLICK, not from inside `submit`. React as
          bundled by Next 14 runs a form action inside a transition and
          deprioritises state set there, so a `setPending(true)` at the top of
          the action never gets a commit — the same trap AuthForm and the
          league-create form already documented. And the button stays enabled,
          because disabling it from its own click handler can cancel the
          submission it was meant to start; a double submit is safe here, since
          the second one arrives with the old password already invalid and
          comes back as "Wrong current password." */}
      <button
        type="submit"
        className="btn-primary"
        aria-busy={pending}
        onClick={(e) => {
          if (e.currentTarget.form?.checkValidity() !== false) setPending(true);
        }}
      >
        {pending && <span className="spinner-ring" aria-hidden />}
        <span>{pending ? 'Changing…' : 'Change password'}</span>
      </button>
    </form>
  );
}
