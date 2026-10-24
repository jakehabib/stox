'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export interface PublishedCode {
  code: string;
  display: string;
  openCount: number;
  /** ISO day, formatted on the server so the two never disagree over a zone. */
  publishedOn: string;
  expiresOn: string;
}

/**
 * ===========================================================================
 * PUBLISH THIS LEAGUE UNDER A CODE
 * ===========================================================================
 *
 * The second half of the export panel, and deliberately the second half: the
 * file above it needs nothing from this office and is the path that always
 * works. A code is the convenience, and the convenience is what costs
 * somebody storage, an account and a lifecycle.
 *
 * THE COPY HERE DOES NOT PROMISE PRIVACY, because it cannot deliver it. A code
 * ends up in a URL, which ends up in browser history, in the `Referer` header
 * of the next link the recipient clicks, and in whatever channel it was pasted
 * into. What it DOES promise is withdrawal, which is real: the delete below
 * removes the row, and the code stops resolving for everybody immediately.
 *
 * Every number shown — how many codes you may hold, how long one lives — is
 * rendered from what the server sent, never from a constant typed in here.
 */
export function PublishLeaguePanel({
  leagueId,
  signedIn,
  codes,
  accountCodeCount,
  retentionMonths,
  maxCodes,
}: {
  leagueId: string;
  signedIn: boolean;
  /** This league's live codes. */
  codes: PublishedCode[];
  /** Live codes across the whole account — which is what `maxCodes` caps. */
  accountCodeCount: number;
  retentionMonths: number;
  maxCodes: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/league/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.code) {
        setError(data?.error || `The league was not filed (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }
      // The server owns the list. Re-render from it rather than splicing a
      // row in here, so what is on screen is what is stored.
      router.refresh();
      setBusy(false);
    } catch {
      setError('That request did not reach the office. Check your connection and try again.');
      setBusy(false);
    }
  }

  async function withdraw(code: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/league/publish', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `The code was not withdrawn (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }
      router.refresh();
      setBusy(false);
    } catch {
      setError('That request did not reach the office. Check your connection and try again.');
      setBusy(false);
    }
  }

  async function copy(code: string) {
    const link = `${window.location.origin}/l/${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(code);
    } catch {
      // No clipboard permission, which is ordinary in some browsers. The link
      // is on screen either way, so this is not an error worth a panel.
      setCopied(null);
    }
  }

  return (
    <div className="space-y-3 pt-3 border-t border-line/70">
      <h3 className="label-sm">Or Publish a Share Code</h3>
      <p className="text-sm text-muted">
        A code holds a copy of the league file here, so the other person types ten characters instead of
        handling a file. Treat a code as public: it travels in links, browser history and chat logs, and anyone
        holding it can start the league. You can withdraw it at any time, and it lapses {retentionMonths} months
        after the last time anybody opens it.
      </p>

      {!signedIn ? (
        <div className="rounded-md border border-line bg-card/50 px-4 py-3 text-sm text-muted">
          Publishing needs an account — the office has to know whose file it is holding. The export above needs
          nothing.{' '}
          <Link href={`/sign-in?next=/league/${leagueId}/settings`} className="text-accent2">Sign in</Link>
          {' or '}
          <Link href={`/sign-up?next=/league/${leagueId}/settings`} className="text-accent2">create an account</Link>.
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={publish} disabled={busy} className="btn-secondary">
            {busy ? 'Filing…' : 'Publish a Share Code'}
          </button>
          {/* The cap is per ACCOUNT, so the figure beside it has to be the
              account's total — the list below is only this league's, and
              printing its length against an account limit would be a number
              that does not mean what it says. */}
          <span className="text-xs text-muted">
            {accountCodeCount} of {maxCodes} codes published on this account
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-chalk/90">{error}</div>
      )}

      {codes.length > 0 && (
        <ul className="space-y-2">
          {codes.map((c) => (
            <li key={c.code} className="rounded-md border border-line bg-raised/40 px-3 py-2.5 space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <code className="font-mono text-accent2 tabular-nums break-all">{c.display}</code>
                <button type="button" onClick={() => copy(c.code)} className="btn-ghost text-xs">
                  {copied === c.code ? 'Link copied' : 'Copy link'}
                </button>
                <button type="button" onClick={() => withdraw(c.code)} disabled={busy} className="btn-ghost text-xs text-warn">
                  Withdraw
                </button>
              </div>
              <p className="text-xs text-muted break-all">
                /l/{c.code} · published {c.publishedOn} · opened {c.openCount}{' '}
                {c.openCount === 1 ? 'time' : 'times'} · lapses {c.expiresOn}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
