'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * ===========================================================================
 * TAKE THE JOB
 * ===========================================================================
 *
 * THERE IS NO FRANCHISE PICKER HERE, and that is the difference between this
 * screen and the one at /l/[code]. A league file is a starting point, so the
 * first act is choosing a club out of a wall of crests. A challenge is a
 * SPECIFIC JOB — the club, the record, the cap sheet and the missing
 * first-rounder are the whole offer — so choosing a different club would be
 * declining the challenge rather than accepting it.
 *
 * Everything on this form is a REQUEST, not a decision. The name is
 * re-cleaned server-side by the same `sanitiseDisplayName` a file's own name
 * goes through. Nothing here validates anything; it is a browser, and a
 * browser is just another thing that can lie.
 *
 * THE REFUSAL IT HAS TO BE ABLE TO SHOW. Unlike every other create path in
 * this app, this one can be refused on the CONTENT of the file: the import
 * loads the save inside a transaction, runs the game's own invariant suite
 * against it, and rolls the whole thing back if the league would not be
 * playable. That refusal arrives as a 422 with a sentence naming the checks
 * that failed, and it is shown as written — the recipient cannot fix it, but
 * the publisher can, and the sentence is what they need.
 */
export function ChallengeTakeJob({
  code,
  defaultName,
  clubName,
  maxNameLength,
}: {
  code: string;
  defaultName: string;
  /** The club being handed over, for the button's own sentence. */
  clubName: string | null;
  /** SAVE_LIMITS.MAX_LEAGUE_NAME, from the server. Not typed in here. */
  maxNameLength: number;
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/save/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name: name.trim().slice(0, maxNameLength) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.leagueId) {
        setError(data?.error || `The code was refused (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }
      router.push(`/league/${data.leagueId}`);
    } catch {
      setError('That request did not reach the office. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <div className="panel p-5 space-y-4">
      <div>
        <h2 className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none">
          Take the Job
        </h2>
        <p className="text-muted text-sm mt-2 leading-relaxed">
          This is your copy of the situation. You inherit the roster, the cap sheet, the draft picks and the
          standings{clubName ? ` at ${clubName}` : ''} — and none of the previous GM&apos;s record. Your tenure
          starts this season, on nought and nought.
        </p>
      </div>

      <label className="block">
        <span className="label-sm">Save name</span>
        <input
          className="input w-full mt-1"
          value={name}
          maxLength={maxNameLength}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      {error && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-chalk/90 leading-relaxed">
          {error}
        </div>
      )}

      <button type="button" onClick={submit} disabled={busy} className="btn-primary">
        {busy ? 'Taking over…' : 'Take the job'}
      </button>
      {busy && (
        <p className="text-xs text-muted">
          Thirty-two rosters, every contract, every pick and the season to date, checked against the
          game&apos;s own rules before a single row is kept. This takes a few seconds.
        </p>
      )}
    </div>
  );
}
