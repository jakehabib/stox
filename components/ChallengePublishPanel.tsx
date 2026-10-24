'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export interface PublishableSave {
  id: string;
  name: string;
  /** "CLE 0-9, week 10 of 2029" — composed on the server, shown as sent. */
  situation: string;
}

export interface PublishedChallenge {
  code: string;
  display: string;
  title: string;
  situation: string;
  carriesHistory: boolean;
  /** Megabytes, already formatted on the server from the stored byte count. */
  size: string;
  openCount: number;
  /** ISO days, formatted on the server so the two never disagree over a zone. */
  publishedOn: string;
  expiresOn: string;
}

/**
 * ===========================================================================
 * PUBLISH A CHALLENGE
 * ===========================================================================
 *
 * THE COPY DOES NOT PROMISE PRIVACY, because it cannot deliver it. A code ends
 * up in a URL, which ends up in browser history, in the `Referer` header of
 * the next link the recipient clicks, and in whatever channel it was pasted
 * into. What it DOES promise is withdrawal, which is real: the delete below
 * removes the row and the code stops resolving for everybody immediately.
 *
 * EVERY NUMBER ON THIS PANEL CAME FROM THE SERVER. How many challenges an
 * account may hold, how long a code lives, how big the stored file is, the
 * character limits on the two text fields: all props. Nothing is typed in
 * here, because a bound written twice is a bound that will eventually be
 * printed wrong — and on this panel the printed figure is the one a publisher
 * plans around.
 */
export function ChallengePublishPanel({
  saves,
  signedIn,
  challenges,
  retentionMonths,
  maxChallenges,
  maxTitle,
  maxBrief,
}: {
  saves: PublishableSave[];
  signedIn: boolean;
  challenges: PublishedChallenge[];
  retentionMonths: number;
  maxChallenges: number;
  maxTitle: number;
  maxBrief: number;
}) {
  const router = useRouter();
  const [leagueId, setLeagueId] = useState(saves[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [history, setHistory] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/save/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, title, brief, history }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.code) {
        setError(data?.error || `The challenge was not filed (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }
      // The server owns the list. Re-render from it rather than splicing a row
      // in here, so what is on screen is what is stored.
      setTitle('');
      setBrief('');
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
      const res = await fetch('/api/save/publish', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || `That code was not withdrawn (HTTP ${res.status}).`);
      } else {
        router.refresh();
      }
    } catch {
      setError('That request did not reach the office. Check your connection and try again.');
    }
    setBusy(false);
  }

  if (!signedIn) {
    return (
      <div className="panel p-5 space-y-3">
        <h2 className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none">
          Set a Challenge
        </h2>
        <p className="text-muted text-sm leading-relaxed">
          Publishing needs an account. The office has to know whose save it is holding and who to go to if it
          has to come down. Playing somebody else&apos;s challenge needs nothing at all.
        </p>
        <div className="flex gap-3">
          <Link href="/sign-up" className="btn-primary">Create an account</Link>
          <Link href="/sign-in" className="btn-ghost text-sm">Sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="panel p-5 space-y-4">
        <div>
          <h2 className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none">
            Set a Challenge
          </h2>
          <p className="text-muted text-sm mt-2 leading-relaxed">
            Pick a save, say what the situation is, and hand out the code. Whoever takes it gets your roster,
            your cap sheet, your picks and your standings — and starts their own career from nought.
          </p>
        </div>

        {saves.length === 0 ? (
          <p className="text-sm text-muted">
            You have no saves to publish yet. <Link href="/new" className="text-accent2 hover:underline">Start a dynasty</Link>,
            play it to somewhere interesting, and come back.
          </p>
        ) : (
          <>
            <label className="block">
              <span className="label-sm">The save</span>
              <select className="input w-full mt-1" value={leagueId} onChange={(e) => setLeagueId(e.target.value)}>
                {saves.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} — {s.situation}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="label-sm">The situation</span>
              <input
                className="input w-full mt-1"
                placeholder="2-9, no cap room, no first-rounder"
                value={title}
                maxLength={maxTitle}
                onChange={(e) => setTitle(e.target.value)}
              />
              <span className="text-xs text-muted mt-1 block">{title.length} of {maxTitle} characters.</span>
            </label>

            <label className="block">
              <span className="label-sm">The job</span>
              <textarea
                className="input w-full mt-1 min-h-[6rem]"
                placeholder="The quarterback is 34 and owed guaranteed money through 2032. The defence is young and cheap. Get this club back to the playoffs inside three seasons."
                value={brief}
                maxLength={maxBrief}
                onChange={(e) => setBrief(e.target.value)}
              />
              <span className="text-xs text-muted mt-1 block">{brief.length} of {maxBrief} characters.</span>
            </label>

            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={history}
                onChange={(e) => setHistory(e.target.checked)}
              />
              <span className="text-muted leading-relaxed">
                <span className="text-chalk">Carry the history.</span> Career stat lines, franchise records,
                championship rosters, trade retrospectives and the power-ranking chart. It is most of the file
                size. Without it the save plays identically and the record books start empty.
              </span>
            </label>

            {error && (
              <div className="rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-chalk/90 leading-relaxed">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={publish}
              disabled={busy || leagueId.length === 0 || title.trim().length === 0}
              className="btn-primary"
            >
              {busy ? 'Filing…' : 'Publish the challenge'}
            </button>
            {busy && (
              <p className="text-xs text-muted">
                Reading the whole save and compressing it. This takes a few seconds.
              </p>
            )}
          </>
        )}
      </div>

      <div className="panel p-5 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="label-sm">Your challenges</h2>
          <span className="text-xs text-muted">
            {challenges.length} of {maxChallenges} · a code lapses {retentionMonths} months after the last time
            anybody opened it
          </span>
        </div>

        {challenges.length === 0 ? (
          <p className="text-sm text-muted">Nothing published. A code appears here the moment one is issued.</p>
        ) : (
          <ul className="space-y-3">
            {challenges.map((c) => (
              <li key={c.code} className="rounded-md border border-line bg-raised/40 p-3 space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-chalk text-sm font-semibold">{c.title}</span>
                  <code className="font-mono text-accent2 tabular-nums break-all">{c.display}</code>
                </div>
                <div className="text-xs text-muted">
                  {c.situation} · {c.size} stored · history {c.carriesHistory ? 'carried' : 'dropped'} ·
                  opened {c.openCount} {c.openCount === 1 ? 'time' : 'times'} · published {c.publishedOn} ·
                  lapses {c.expiresOn}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/c/${c.code}`} className="btn-ghost text-xs">Open the card</Link>
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => {
                      void navigator.clipboard?.writeText(c.display).then(() => setCopied(c.code)).catch(() => {});
                    }}
                  >
                    {copied === c.code ? 'Copied' : 'Copy the code'}
                  </button>
                  <button type="button" disabled={busy} className="btn-ghost text-xs text-bad" onClick={() => withdraw(c.code)}>
                    Withdraw
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted leading-relaxed">
          A code is anyone with the link. It travels in URLs, browser history and whatever channel it was
          pasted into, so treat it as public rather than private. Withdrawing one stops it resolving for
          everybody immediately; saves people already took from it are their own and are unaffected.
        </p>
      </div>
    </div>
  );
}
