'use client';

import { useEffect, useState, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fullScoutAction, fullScoutPanelAction, type FullScoutPanelData, type FullScoutTarget } from '@/app/actions/dynasty';
import { CommitmentCard } from './ds/CommitmentCard';
import { DeltaChip, deltaTint, useDeltaWatch } from './ds/DeltaChip';

/**
 * The Full Scout console on the Dynasty screen: what you have left this
 * league year, and a search box to spend one.
 *
 * Search runs server-side (a draft class is several hundred players) and the
 * default, empty-query board is the incoming class, because that is where a
 * perfect evaluation is worth the most. Anyone already fully evaluated is
 * shown as such rather than being offered again — burning a charge on a file
 * you already own is the one mistake this widget should make impossible.
 *
 * THE CONFIRM. This used to be `window.confirm()`. The most irreversible
 * action in the game — you get a handful a year, they do not carry over, and
 * the knowledge is permanent — was gated by a native OS dialog: unstyled,
 * outside the app, unable to show the player, and unable to show the price. It
 * is replaced by a commitment card staged in the panel itself, which is one
 * FEWER context switch rather than one more. Same single confirm step, same
 * click count, and now the button's label says whose file you are buying and
 * what it leaves you with.
 *
 * The card has no portrait, and that is deliberate: `FullScoutTarget` carries
 * name, position, age and location but not build, and this app's portraits are
 * generated from build. A face drawn from defaults would be a different man's
 * face over this man's name. Better nothing than wrong.
 */
export function FullScoutPanel({ leagueId, teamId }: { leagueId: string; teamId: string }) {
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<FullScoutPanelData | null>(null);
  const [staged, setStaged] = useState<FullScoutTarget | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const load = useCallback((q: string) => {
    fullScoutPanelAction(leagueId, teamId, q).then(setPanel).catch(() => setPanel(null));
  }, [leagueId, teamId]);

  useEffect(() => {
    const t = setTimeout(() => load(query), query ? 250 : 0);
    return () => clearTimeout(t);
  }, [query, load]);

  // The charge counter is the number this action is spent against, so it is
  // the number that owes the user a statement of what changed.
  const charges = useDeltaWatch(panel?.remaining ?? 0);

  const commit = async (playerId: string) => {
    charges.arm();
    const r = await fullScoutAction(leagueId, teamId, playerId);
    setMsg(r.message);
    load(query);
    if (!r.ok) return false as const;
    setStaged(null);
    startTransition(() => router.refresh());
    return 'Evaluated';
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
            <div className="flex items-center justify-end gap-2">
              <span className="label-sm">Remaining</span>
              <DeltaChip delta={charges.delta} tone="info" />
            </div>
            <div className={`stat-value text-stat-md mt-1 ${out ? 'text-bad' : 'text-chalk'} ${deltaTint(charges.delta, 'info')}`}>
              {panel.remaining}<span className="text-muted text-base">/{panel.max}</span>
            </div>
            <div className="text-[11px] text-muted mt-0.5">{panel.seasonYear} season</div>
          </div>
        )}
      </div>

      {staged && panel ? (
        <CommitmentCard
          tone="gold"
          eyebrow="Full Scout · permanent, and it cannot be undone"
          name={staged.name}
          meta={<>{staged.position} · {staged.where} · age {staged.age}</>}
          ledger={[
            { label: 'Full Scouts left this season', value: `${panel.remaining} → ${panel.remaining - 1}` },
            { label: 'League year', value: String(panel.seasonYear) },
          ]}
          note={
            <>
              His true ratings and his true ceiling become permanently visible to your front office — no range, no
              confidence, the actual numbers. The charge is gone whether or not you like what you find, and unused
              ones do not carry into next season.
            </>
          }
          confirmLabel={`Spend a charge on ${staged.name.split(' ').slice(-1)[0]} — ${panel.remaining - 1} left`}
          workingLabel="Evaluating…"
          doneLabel="Evaluated"
          onConfirm={() => commit(staged.id)}
          onCancel={() => setStaged(null)}
        />
      ) : (
        <>
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
                            disabled={out}
                            onClick={() => { setMsg(null); setStaged(t); }}
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
        </>
      )}
    </div>
  );
}
