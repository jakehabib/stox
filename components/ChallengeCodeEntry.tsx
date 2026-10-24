'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The door. Somebody was handed ten characters in a Discord message and this
 * is where they put them.
 *
 * IT DOES NOT VALIDATE AND IT DOES NOT LOOK ANYTHING UP. It navigates to
 * /c/<whatever was typed>, and that page is where the one refusal sentence
 * lives. A client-side check would be a second opinion about what a code looks
 * like, and the two would eventually disagree — the server's normaliser
 * already accepts the grouped form, lower case, a pasted URL and the three
 * Crockford confusions, and a browser that rejected any of those would be
 * refusing codes that work.
 *
 * The hyphens are left exactly as typed for the same reason: stripping them
 * here would mean this file knows the grouping, and the grouping is stated
 * once, in lib/shareCode.ts.
 */
export function ChallengeCodeEntry() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const go = () => {
    const typed = code.trim();
    if (typed.length === 0) return;
    setBusy(true);
    router.push(`/c/${encodeURIComponent(typed)}`);
  };

  return (
    <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
      <label className="block flex-1 min-w-0">
        <span className="label-sm">Challenge code</span>
        <input
          className="input w-full mt-1 font-mono tracking-widest uppercase"
          placeholder="7K2P-X9MT-4B"
          value={code}
          maxLength={64}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
        />
      </label>
      <button type="button" onClick={go} disabled={busy || code.trim().length === 0} className="btn-primary">
        {busy ? 'Opening…' : 'Open the file'}
      </button>
    </div>
  );
}
