'use client';

import { useEffect, useState, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fullScoutAction, fullScoutPanelAction, type FullScoutPanelData } from '@/app/actions/dynasty';

/**
 * The Full Scout console on the Dynasty screen: what you have left this
 * league year, and a search box to spend one.
 *
 * Search runs server-side (a draft class is several hundred players) and the
 * default, empty-query board is the incoming class, because that is where a
 * perfect evaluation is worth the most. Anyone already fully evaluated is
 * shown as such rather than being offered again — burning a charge on a file
 * you already own is the one mistake this widget should make impossible.
 */
export function FullScoutPanel({ leagueId, teamId }: { leagueId: string; teamId: string }) {
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<FullScoutPanelData | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const load = useCallback((q: string) => {
    fullScoutPanelAction(leagueId, teamId, q).then(setPanel).catch(() => setPanel(null));
  }, [leagueId, teamId]);

  useEffect(() => {
    const t = setTimeout(() => load(query), query ? 250 : 0);
    return () => clearTimeout(t);
  }, [query, load]);

  const spend = (playerId: string, name: string) => {
    if (!confirm(`Spend a Full Scout on ${name}? This cannot be undone and you only get a few a year.`)) return;
    startTransition(async () => {
      const r = await fullScoutAction(leagueId, teamId, playerId);
      setMsg(r.message);
      load(query);
      if (r.ok) router.refresh();
    });
  };

  const out = !!panel && panel.remaining <= 0;

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="label-sm">Full Scout</div>
          <p className="text-xs text-muted mt-1 max-w-xl">
            A complete, exact evaluation of one player — true ratings and true ceiling, permanently. Every GM gets a
            handful each league year; the Scouting Network upgrade buys more. Unused ones do not carry over.
          </p>
        </div>
        {panel && (
          <div className="text-right whitespace-nowrap">
            <div className="label-sm">Remaining</div>
            <div className={`stat-value text-stat-md mt-1 ${out ? 'text-bad' : 'text-chalk'}`}>
              {panel.remaining}<span className="text-muted text-base">/{panel.max}</span>
            </div>
            <div className="text-[11px] text-muted mt-0.5">{panel.seasonYear} season</div>
          </div>
        )}
      </div>

      <input
        className="input w-full"
        placeholder="Search a player by name — or leave blank for this year's draft class"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {msg && <div className="text-xs text-muted">{msg}</div>}

      {!panel ? (
        <div className="text-xs text-muted">Loading…</div>
      ) : panel.targets.length === 0 ? (
        <div className="text-xs text-muted">Nobody matches that.</div>
      ) : (
        <div className="max-h-72 overflow-y-auto -mx-1 px-1">
          <table className="w-full text-sm">
            <tbody>
              {panel.targets.map((t) => (
                <tr key={t.id} className="border-b border-line/40 last:border-0">
                  <td className="py-1.5 pr-2">
                    <span className="text-muted text-xs font-mono">{t.position}</span> {t.name}
                  </td>
                  <td className="py-1.5 text-xs text-muted whitespace-nowrap">{t.where} · {t.age}</td>
                  <td className="py-1.5 text-right">
                    {t.alreadyRevealed ? (
                      <span className="pill border-accent/40 text-accent">Fully evaluated</span>
                    ) : (
                      <button
                        className="btn-secondary text-xs"
                        disabled={pending || out}
                        onClick={() => spend(t.id, t.name)}
                        title={out ? 'No Full Scouts left this season.' : undefined}
                      >
                        Full Scout
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
