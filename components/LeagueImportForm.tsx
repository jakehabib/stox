'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TeamLogo } from './TeamLogo';

/** Mirrors FILE_LIMITS.MAX_BYTES — the server is still the authority. */
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_LEAGUE_NAME = 60;

interface PeekedTeam {
  abbr: string;
  city: string;
  nickname: string;
  conference: string;
  division: string;
  players: number;
}

interface Peek {
  name: string;
  teams: PeekedTeam[];
  totalPlayers: number;
}

/**
 * Upload a league file and play it.
 *
 * Two things happen when a file is chosen, and it matters which is which:
 *
 *   THE PEEK is cosmetic. The browser parses the file just far enough to show
 *   what is in it and to fill the franchise picker, because choosing your team
 *   out of a list of crests is the whole first act of this game and asking
 *   someone to type "BOS" from memory would be worse than not having it. It is
 *   wrapped in a try/catch and it decides NOTHING. A file that fails the peek
 *   still uploads; a file that passes it can still be refused.
 *
 *   THE SERVER decides. Every limit, every range, every structural rule lives
 *   in lib/leagueFile.ts and is re-applied to the bytes that actually arrive.
 *   Nothing here is a validation step — this is a browser, and a browser is
 *   just another thing that can lie.
 */
export function LeagueImportForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [peekWarning, setPeekWarning] = useState<string | null>(null);
  const [leagueName, setLeagueName] = useState('');
  const [team, setTeam] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setFileName(null); setText(null); setPeek(null); setPeekWarning(null);
    setLeagueName(''); setTeam(''); setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function onFile(file: File | undefined) {
    setError(null); setPeek(null); setPeekWarning(null); setText(null);
    if (!file) return;
    setFileName(file.name);

    // Refuse an obviously oversized file without reading it. The server does
    // this properly, on the bytes; this is just so nobody waits for a 50MB
    // upload to be told no at the far end.
    if (file.size > MAX_BYTES) {
      setError(
        `That file is ${(file.size / 1_048_576).toFixed(1)}MB. The limit is ${MAX_BYTES / 1_048_576}MB — ` +
          'a full 32-team league with complete rosters is under 1.5MB.',
      );
      return;
    }

    let raw: string;
    try {
      raw = await file.text();
    } catch {
      setError('That file could not be read from disk. Try choosing it again.');
      return;
    }
    setText(raw);

    try {
      const doc = JSON.parse(raw);
      const teams: PeekedTeam[] = (Array.isArray(doc?.teams) ? doc.teams : []).slice(0, 64).map((t: any) => ({
        abbr: String(t?.abbr ?? '').slice(0, 4).toUpperCase(),
        city: String(t?.city ?? '').slice(0, 24),
        nickname: String(t?.nickname ?? '').slice(0, 24),
        conference: String(t?.conference ?? '').slice(0, 8),
        division: String(t?.division ?? '').slice(0, 8),
        players: Array.isArray(t?.players) ? t.players.length : 0,
      }));
      const totalPlayers =
        teams.reduce((a, t) => a + t.players, 0) + (Array.isArray(doc?.freeAgents) ? doc.freeAgents.length : 0);
      const name = typeof doc?.name === 'string' ? doc.name.slice(0, MAX_LEAGUE_NAME) : '';

      if (teams.length === 0) {
        setPeekWarning('This file lists no teams that this preview could read. Upload it anyway and the server will say exactly what is wrong with it.');
      } else {
        setPeek({ name, teams, totalPlayers });
        setLeagueName(name || 'Imported League');
        setTeam(teams[0]?.abbr ?? '');
      }
    } catch {
      setPeekWarning('This file could not be previewed here. Upload it anyway — the server will say exactly what is wrong with it.');
    }
  }

  async function submit() {
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (leagueName.trim()) qs.set('name', leagueName.trim().slice(0, MAX_LEAGUE_NAME));
      if (team) qs.set('team', team);
      const res = await fetch(`/api/league/import?${qs.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.leagueId) {
        setError(data?.error || `The import was refused (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }
      router.push(`/league/${data.leagueId}`);
    } catch {
      setError('The upload did not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Step 1 — the file */}
      <div className="panel p-5 space-y-4">
        <div>
          <div className="label-sm">Step 1 of 2</div>
          <h3 className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none mt-1">
            Choose a League File
          </h3>
          <p className="text-muted text-sm mt-2">
            A <code className="text-chalk">.dgm.json</code> file exported from Dynasty GM, or one written by hand.
            Up to {MAX_BYTES / 1_048_576}MB.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="btn-secondary cursor-pointer">
            {fileName ? 'Choose a different file' : 'Choose file'}
            <input
              ref={inputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          {fileName && (
            <span className="text-sm text-muted truncate min-w-0">
              {fileName}
              <button type="button" onClick={reset} className="btn-ghost text-xs ml-2">Clear</button>
            </span>
          )}
        </div>

        {peek && (
          <div className="flex flex-wrap gap-3">
            <Fact label="Teams" value={String(peek.teams.length)} />
            <Fact label="Players in file" value={peek.totalPlayers > 0 ? String(peek.totalPlayers) : 'none — will be generated'} />
            <Fact label="League name" value={peek.name || 'unnamed'} />
          </div>
        )}

        {peekWarning && (
          <div className="rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-chalk/90">{peekWarning}</div>
        )}
      </div>

      {/* Step 2 — the franchise */}
      {peek && (
        <div className="grid lg:grid-cols-[1.3fr_1fr] gap-5 items-start">
          <div className="panel overflow-hidden">
            <div className="px-5 py-4 border-b border-line/70">
              <div className="label-sm">Step 2 of 2</div>
              <h3 className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none mt-1">
                Choose Your Franchise
              </h3>
            </div>
            <div className="max-h-[26rem] overflow-y-auto divide-y divide-line/50">
              {peek.teams.map((t, i) => {
                const active = t.abbr === team;
                return (
                  <button
                    key={`${t.abbr}-${i}`}
                    type="button"
                    onClick={() => setTeam(t.abbr)}
                    aria-pressed={active}
                    className={`w-full text-left flex items-center gap-3.5 px-5 py-3 border-l-2 transition-colors ${
                      active ? 'bg-raised/70 border-l-accent' : 'border-l-transparent hover:bg-raised/40'
                    }`}
                  >
                    <TeamLogo seed={`import-${t.abbr}`} abbr={t.abbr || '??'} nickname={t.nickname} size={38} className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="label-sm truncate">{t.city || '—'}</div>
                      <div className="font-display font-bold text-lg uppercase tracking-wide leading-none mt-0.5 truncate">
                        {t.nickname || '—'}
                      </div>
                    </div>
                    <span className="label-sm shrink-0">
                      {t.conference} {t.division}
                      {t.players > 0 && <span className="ml-2 text-muted">{t.players} players</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="panel p-5 space-y-5">
            <div>
              <label className="label-sm block mb-1.5">League name</label>
              <input
                className="input w-full"
                value={leagueName}
                maxLength={MAX_LEAGUE_NAME}
                onChange={(e) => setLeagueName(e.target.value)}
                placeholder="Imported League"
              />
              <p className="text-muted text-xs mt-1.5">Defaults to the name inside the file. Yours, not shared with anyone.</p>
            </div>

            <div className="text-sm text-muted space-y-2">
              <p>
                Teams with no players in the file get a full generated roster, so a file that is nothing but
                32 names still produces a league you can play.
              </p>
              <p>
                Imported leagues start in preseason with randomized rosters. Nothing about your existing saves changes.
              </p>
            </div>

            <button type="button" onClick={submit} disabled={busy || !team} className="btn-primary w-full">
              {busy ? 'Building league…' : 'Import and Play ▸'}
            </button>
            {busy && (
              <p className="text-muted text-xs text-center">
                Writing 32 teams and their rosters. This takes a few seconds — don&apos;t close the tab.
              </p>
            )}
          </div>
        </div>
      )}

      {/* The refusal. Deliberately loud and deliberately verbatim: the server
          writes these to be read by the person who has to fix the file. */}
      {error && (
        <div className="rounded-md border border-bad/40 bg-bad/10 px-5 py-4">
          <div className="label-sm text-bad">File refused</div>
          <p className="text-sm text-chalk/90 mt-1 break-words">{error}</p>
          <p className="text-xs text-muted mt-2">
            Nothing was saved. Fix the file and choose it again — the format is documented in{' '}
            <code className="text-chalk">docs/custom-leagues.md</code>.
          </p>
        </div>
      )}

      {/* Upload is still possible when the peek failed — the peek is not a gate. */}
      {!peek && text && (
        <button type="button" onClick={submit} disabled={busy} className="btn-secondary">
          {busy ? 'Building league…' : 'Upload anyway'}
        </button>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-tile">
      <div className="label-sm">{label}</div>
      <div className="text-sm font-semibold text-chalk mt-0.5">{value}</div>
    </div>
  );
}
