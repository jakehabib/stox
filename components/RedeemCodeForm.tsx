'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TeamPickerBoard } from './TeamPickerBoard';
import type { FranchiseSeed } from './ds/FranchiseWall';

/** Mirrors FILE_LIMITS.MAX_LEAGUE_NAME. The server is still the authority. */
const MAX_LEAGUE_NAME = 60;

/**
 * Start a league from a share code.
 *
 * Everything on this form is a REQUEST, not a decision. The name is re-cleaned
 * server-side by the same `sanitiseDisplayName` a file's own name goes
 * through, and the franchise is resolved against the published file's own
 * teams — an abbreviation this form never offered falls back to the first club
 * in the file rather than being honoured. Nothing here validates anything; it
 * is a browser, and a browser is just another thing that can lie.
 */
export function RedeemCodeForm({
  code,
  defaultName,
  seeds,
}: {
  code: string;
  defaultName: string;
  seeds: FranchiseSeed[];
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [team, setTeam] = useState(seeds[0]?.abbr ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/league/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, team, name: name.trim().slice(0, MAX_LEAGUE_NAME) }),
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
    <div className="space-y-5">
      <div className="panel overflow-hidden">
        <div className="px-5 py-4 border-b border-line/70">
          <div className="label-sm">Step 1 of 2</div>
          <h2 className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none mt-1">
            Choose Your Franchise
          </h2>
        </div>
        <div className="p-5">
          <TeamPickerBoard seeds={seeds} value={team} onChange={setTeam} />
        </div>
      </div>

      <div className="panel p-5 space-y-4">
        <div>
          <div className="label-sm">Step 2 of 2</div>
          <h2 className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none mt-1">
            Name Your Save
          </h2>
          <p className="text-muted text-sm mt-2">
            This is your copy. Rename it, play it however you like — nothing you do here reaches the league it
            was published from.
          </p>
        </div>
        <label className="block">
          <span className="label-sm">League name</span>
          <input
            className="input w-full mt-1"
            value={name}
            maxLength={MAX_LEAGUE_NAME}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        {error && (
          <div className="rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-chalk/90">{error}</div>
        )}

        <button type="button" onClick={submit} disabled={busy || !team} className="btn-primary">
          {busy ? 'Building the league…' : 'Take the Job'}
        </button>
        {busy && (
          <p className="text-xs text-muted">
            Thirty-two rosters, every contract and a draft board. This takes a few seconds.
          </p>
        )}
      </div>
    </div>
  );
}
