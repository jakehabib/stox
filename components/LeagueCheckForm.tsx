'use client';

import { useRef, useState } from 'react';

/**
 * THE VALIDATOR, FROM THE BROWSER SIDE.
 *
 * Nothing here decides anything. The whole point of the feature is that the
 * answer comes from `parseLeagueFile` on the server — the one validator the
 * import itself runs — so this component reads a file or a textarea, posts it,
 * and renders whatever comes back verbatim. There is no client-side check of a
 * bound anywhere in it, because a second, more lenient copy of the rules would
 * tell an author their file was fine and then let the import refuse it.
 *
 * THE ONE EXCEPTION IS SIZE, and it is a courtesy rather than a gate: a file
 * larger than the cap is refused here so nobody waits out an 8MB upload to be
 * told no at the far end. The server applies the same cap to the bytes that
 * actually arrive. The figure is PASSED IN from the server page, which reads
 * it from FILE_LIMITS — it is not written here, because a copy of a limit in a
 * client bundle is a copy that goes stale on the next change to it.
 */
interface Limits {
  maxBytes: number;
  teamCount: number;
}

interface Report {
  name: string;
  formatVersion: number;
  conferences: string[];
  divisions: string[];
  teams: number;
  rostered: number;
  emptyRosters: number;
  freeAgents?: number;
  classProspects?: number;
  classStrength?: number;
  playersWritten: number;
  teamsWritten: number;
  bytes: number;
  receivedBytes: number;
  maxBytes: number;
}

type Answer =
  | { kind: 'pass'; report: Report }
  | { kind: 'refused'; message: string }
  | { kind: 'failed'; message: string };

export function LeagueCheckForm({ limits }: { limits: Limits }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLFormElement>(null);

  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);

  const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(2)}MB`;

  async function post(body: BodyInit, headers?: HeadersInit) {
    setBusy(true);
    setAnswer(null);
    try {
      const res = await fetch('/api/league/validate', { method: 'POST', body, headers });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok && data?.report) setAnswer({ kind: 'pass', report: data.report });
      else if (data?.error) setAnswer({ kind: 'refused', message: data.error });
      else setAnswer({ kind: 'failed', message: `The check did not complete (HTTP ${res.status}).` });
    } catch {
      setAnswer({ kind: 'failed', message: 'The upload did not reach the server. Check your connection and try again.' });
    }
    setBusy(false);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    if (file.size > limits.maxBytes) {
      setAnswer({
        kind: 'refused',
        message:
          `That file is ${mb(file.size)}. The limit is ${limits.maxBytes / 1_048_576}MB — a full ` +
          `${limits.teamCount}-team league with complete rosters and a draft class is under 1.5MB.`,
      });
      return;
    }
    let raw: string;
    try {
      raw = await file.text();
    } catch {
      setAnswer({ kind: 'failed', message: 'That file could not be read from disk. Try choosing it again.' });
      return;
    }
    setText(raw);
    await post(raw, { 'Content-Type': 'application/json' });
  }

  async function checkPasted() {
    if (text.trim().length === 0) return;
    await post(text, { 'Content-Type': 'application/json' });
  }

  async function checkCsvs(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = csvRef.current;
    if (!form) return;
    const data = new FormData(form);
    // A zero-byte file input is "nothing attached", which the server already
    // reads correctly — it is sent as-is rather than pruned here.
    await post(data);
  }

  return (
    <div className="space-y-5">
      <div className="panel p-5 space-y-4">
        <div>
          <div className="label-sm">A league file</div>
          <h3 className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none mt-1">
            Paste It Or Choose It
          </h3>
          <p className="text-muted text-sm mt-2">
            Up to {limits.maxBytes / 1_048_576}MB. Nothing is created, nothing is saved, and no league slot is
            spent — the file is read, checked and dropped.
          </p>
        </div>

        <textarea
          className="input w-full font-mono text-xs h-44 resize-y"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder={`{\n  "formatVersion": 2,\n  "kind": "dynastygm.league",\n  "name": "Sunday Night Beer League",\n  "teams": [ … ]\n}`}
          aria-label="League file JSON"
        />

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={checkPasted} disabled={busy || text.trim().length === 0} className="btn-primary">
            {busy ? 'Checking…' : 'Check this file'}
          </button>
          <label className="btn-secondary cursor-pointer">
            {fileName ? 'Choose a different file' : 'Choose a file'}
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          {fileName && <span className="text-sm text-muted truncate min-w-0">{fileName}</span>}
        </div>
      </div>

      <div className="panel p-5 space-y-4">
        <div>
          <div className="label-sm">Spreadsheets</div>
          <h3 className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none mt-1">
            Check The CSVs Instead
          </h3>
          <p className="text-muted text-sm mt-2">
            The same three files the converter takes. They go through the same conversion, so a refusal names
            the file, the row and the player, not a position in a document you never wrote.
          </p>
        </div>
        <form ref={csvRef} onSubmit={checkCsvs} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <CsvField name="teams" label="teams.csv" required />
            <CsvField name="players" label="players.csv" />
            <CsvField name="prospects" label="prospects.csv" />
          </div>
          <button type="submit" disabled={busy} className="btn-secondary">
            {busy ? 'Checking…' : 'Check these spreadsheets'}
          </button>
        </form>
      </div>

      {/* The refusal, verbatim. Written on the server to be read by the person
          who has to fix the file; nothing here rewords it. */}
      {answer?.kind === 'refused' && (
        <div className="rounded-md border border-bad/40 bg-bad/10 px-5 py-4">
          <div className="label-sm text-bad">Would be refused</div>
          <p className="text-sm text-chalk/90 mt-1 break-words">{answer.message}</p>
          <p className="text-xs text-muted mt-2">
            This is the sentence the import would have given you. Nothing was created.
          </p>
        </div>
      )}

      {answer?.kind === 'failed' && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-5 py-4 text-sm text-chalk/90">
          {answer.message}
        </div>
      )}

      {answer?.kind === 'pass' && <Passed report={answer.report} />}
    </div>
  );
}

/**
 * What the file would produce. Every figure comes off the server's own
 * `summariseLeagueFile`, which reads them from the parsed document and from
 * `estimateWriteCost` — the same function the import route logs its cost with.
 * Nothing is recomputed in the browser.
 */
function Passed({ report: r }: { report: Report }) {
  const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(2)}MB`;
  const pct = Math.min(100, Math.round((r.bytes / r.maxBytes) * 100));

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-accent/40 bg-accent/10 px-5 py-4">
        <div className="label-sm text-accent">Would be accepted</div>
        <p className="text-sm text-chalk/90 mt-1">
          {r.name} — {r.teams} franchises, format version {r.formatVersion}. Import it and this is the league
          you get. Nothing was created by this check.
        </p>
      </div>

      <div className="panel p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <Row k="Franchises" v={String(r.teams)} />
        <Row k="Conferences" v={r.conferences.join(', ')} />
        <Row k="Divisions" v={r.divisions.join(', ')} />
        <Row k="Players the file names" v={r.rostered > 0 ? String(r.rostered) : 'none — rosters are generated'} />
        <Row
          k="Teams with no roster"
          v={r.emptyRosters === 0 ? 'none — every team is authored' : `${r.emptyRosters}, each given a generated roster`}
        />
        <Row k="Free agents in the file" v={r.freeAgents === undefined ? 'none — a pool is generated' : String(r.freeAgents)} />
        <Row
          k="Prospects in the file"
          v={
            r.classProspects === undefined
              ? 'no class — one is generated at preseason'
              : `${r.classProspects}${r.classStrength === undefined ? '' : `, class strength ${r.classStrength > 0 ? '+' : ''}${r.classStrength}`}`
          }
        />
        <Row k="Players the import would write" v={`${r.playersWritten.toLocaleString('en-US')} across ${r.teamsWritten} teams`} />
        <Row k="As a league file" v={`${mb(r.bytes)} of ${r.maxBytes / 1_048_576}MB (${pct}%)`} />
        <Row k="What you sent" v={mb(r.receivedBytes)} />
      </div>

      <p className="text-muted text-xs">
        &ldquo;Players the import would write&rdquo; counts the men this file names plus everything generated
        around them — a position below its roster minimum, a free agent pool topped up to its floor, a draft
        class filled out to a full board. It is the figure the import logs for the same file.
      </p>
    </div>
  );
}

function CsvField({ name, label, required }: { name: string; label: string; required?: boolean }) {
  return (
    <label className="block space-y-1">
      <span className="label-sm">{label}{required ? '' : ' — optional'}</span>
      <input
        type="file"
        name={name}
        accept=".csv,text/csv"
        required={required}
        className="block w-full text-xs text-muted file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-line file:bg-raised file:text-chalk file:text-xs"
      />
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/40 pb-2 min-w-0">
      <span className="label-sm shrink-0">{k}</span>
      <span className="text-chalk/90 text-right min-w-0 break-words">{v}</span>
    </div>
  );
}
