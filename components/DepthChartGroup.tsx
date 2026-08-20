'use client';

import { useEffect, useState, useTransition } from 'react';
import { setDepthChartAction } from '@/app/actions/roster';
import { ratingColor } from '@/lib/ratings';
import { PlayerAvatar } from './PlayerAvatar';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { positionBadgeClass } from './ds/positionColor';

interface P { id: string; name: string; ovr: number; age: number; injured: boolean }

export function DepthChartGroup({ teamId, position, players, order }: { teamId: string; position: string; players: P[]; order: string[] }) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const teamColor = generateTeamLogoParams(teamId).primary;
  const [localOrder, setLocalOrder] = useState(order);
  const [pending, startTransition] = useTransition();

  // useState(order) only seeds from the prop on first mount — React never
  // re-runs that initializer on later renders, so once mounted this never
  // noticed the server order actually changing underneath it (e.g. the
  // Auto-Sort button rewriting every rank server-side, then revalidating).
  // The button "worked" — the DB was correct — the mounted row list just
  // kept showing whatever it last displayed.
  useEffect(() => { setLocalOrder(order); }, [order]);

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...localOrder];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setLocalOrder(next);
    startTransition(() => setDepthChartAction(teamId, position, next));
  };

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className={`font-display font-bold text-sm uppercase tracking-wide ${positionBadgeClass(position)}`}>{position}</h3>
        {pending && <span className="text-xs text-muted">Saving…</span>}
      </div>
      <div className="space-y-1">
        {localOrder.map((id, idx) => {
          const p = byId.get(id);
          if (!p) return null;
          return (
            <div key={id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${idx === 0 ? 'bg-raised' : ''}`}>
              <span className="text-xs text-muted w-4">{idx + 1}</span>
              <PlayerAvatar seed={p.id} age={p.age} size={22} teamColor={teamColor} />
              <span className={`stat-value text-xs w-8 ${ratingColor(p.ovr)}`}>{p.ovr}</span>
              <span className="text-sm flex-1 truncate">{p.name}</span>
              {p.injured && <span className="text-[10px] text-bad">INJ</span>}
              <div className="flex flex-col">
                <button onClick={() => move(idx, -1)} disabled={idx === 0} className="text-muted hover:text-chalk disabled:opacity-20 leading-none text-xs px-1">▲</button>
                <button onClick={() => move(idx, 1)} disabled={idx === localOrder.length - 1} className="text-muted hover:text-chalk disabled:opacity-20 leading-none text-xs px-1">▼</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
