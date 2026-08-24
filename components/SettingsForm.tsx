'use client';

import { useState } from 'react';

/**
 * The League Settings form, wrapped so pressing Save says something.
 *
 * It said nothing at all before. `updateSettingsAction` writes the blob and
 * calls revalidatePath, which re-renders the page with the same values in the
 * same boxes — so a successful save and a save that never fired looked
 * identical from the chair, and the only way to find out which had happened
 * was to leave the screen and come back.
 *
 * Deliberately NOT `useFormStatus`: react-dom 18.3.1 as installed here does
 * not export it (checked, not assumed — same finding as AuthForm), so the
 * pending flag is held locally and the server action is awaited from the form
 * action directly.
 *
 * The confirmation clears the moment any control on the form changes. A green
 * "Saved" sitting beside three edits that are NOT saved is the same class of
 * bug as a wrong number: an indicator describing a state the app is no longer
 * in.
 *
 * `children` is the whole server-rendered field list, passed through
 * untouched — the fields stay on the server, only the button and its notice
 * are client-side.
 */
export function SettingsForm({
  action,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function submit(formData: FormData) {
    setStatus('saving');
    try {
      await action(formData);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  return (
    <form
      action={submit}
      onChange={() => setStatus((s) => (s === 'idle' ? s : 'idle'))}
      className="space-y-6"
    >
      {children}

      <div className="flex items-center gap-3 flex-wrap">
        <button type="submit" className="btn-primary" disabled={status === 'saving'}>
          {status === 'saving' ? 'Saving…' : 'Save Settings'}
        </button>
        {status === 'saved' && (
          <span className="text-sm text-accent" role="status">
            ✓ Saved. This league plays by these rules from your next advance.
          </span>
        )}
        {status === 'error' && (
          <span className="text-sm text-bad" role="status">
            Nothing was saved — the league is still on its old rules. Try again.
          </span>
        )}
      </div>
    </form>
  );
}
