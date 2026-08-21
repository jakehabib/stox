'use client';

import { useEffect, useState, useTransition } from 'react';
import { setDepthChartAction } from '@/app/actions/roster';
import { ratingColor } from '@/lib/ratings';
import { startersAt } from '@/lib/lineup';
import { PlayerAvatar } from './PlayerAvatar';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { positionBadgeClass } from './ds/positionColor';

interface P { id: string; name: string; ovr: number; age: number; injured: boolean; weightLb?: number; heightIn?: number }

/**
 * One position's depth chart, in the order the sim engine reads it.
 *
 * WHO IS STARTING IS THE WHOLE POINT OF THIS SCREEN, and it used to be
 * unanswerable: exactly one row — index 0 — got the team-coloured tint, at
 * every position. That is only correct at the nine positions where one man
 * starts. Three receivers start, three corners, two of each front-seven
 * position, so at WR the screen showed one highlighted man and six identical
 * rows beneath him and gave you no way to tell WR3 (a starter) from WR4 (not).
 * The app owner reported it twice.
 *
 * `startersAt` comes from lib/lineup.ts — THE single definition of the
 * starting eleven for this app, and the same one lib/sim/units.ts fields.
 * This component does not get to have its own opinion about who starts; three
 * places in this codebase used to, and one of them put twelve men on defence.
 *
 * Unfilled starting slots render as ghost rows rather than being omitted. A
 * group two deep at a three-starter position is not "fully manned with a
 * short bench", it is a hole in the lineup, and a list that simply stops
 * after two rows shows those two cases identically.
 */
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

  const starterCount = startersAt(position);
  const filledStarters = Math.min(starterCount, localOrder.length);
  const emptyStarterSlots = Math.max(0, starterCount - localOrder.length);

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className={`font-display font-bold text-sm uppercase tracking-wide ${positionBadgeClass(position)}`}>{position}</h3>
        <div className="flex items-center gap-2">
          {pending && <span className="text-xs text-muted">Saving…</span>}
          <span className="label-sm">
            {starterCount === 0
              ? 'no base starter'
              : `${starterCount} starter${starterCount === 1 ? '' : 's'}`}
          </span>
        </div>
      </div>
      <div className="space-y-1">
        {localOrder.map((id, idx) => {
          const p = byId.get(id);
          if (!p) return null;
          const starts = idx < starterCount;
          return (
            <div key={id}>
              {/* The line between the lineup and the bench, drawn once. Without
                  it the highlight alone has to carry the distinction, and a
                  tint is easy to read as "notable" rather than "on the field". */}
              {idx === filledStarters && emptyStarterSlots === 0 && starterCount > 0 && (
                <div className="flex items-center gap-2 pt-1.5 pb-1">
                  <span className="label-sm text-[10px]">Bench</span>
                  <span className="h-px flex-1 bg-line/70" />
                </div>
              )}
              <div
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 border-l-2 ${starts ? '' : 'opacity-80'}`}
                style={starts
                  ? { borderColor: teamColor, background: `${teamColor}14` }
                  : { borderColor: 'transparent' }}
              >
                <span className={`w-7 shrink-0 text-[10px] font-semibold tracking-wide ${starts ? 'text-chalk' : 'text-muted font-normal'}`}>
                  {starts ? (starterCount > 1 ? `ST${idx + 1}` : 'ST') : `#${idx + 1}`}
                </span>
                <PlayerAvatar seed={p.id} age={p.age} size={22} teamColor={teamColor} weightLb={p.weightLb} heightIn={p.heightIn} position={position} />
                <span className={`stat-value text-xs w-8 ${ratingColor(p.ovr)}`}>{p.ovr}</span>
                <span className={`text-sm flex-1 truncate ${starts ? 'font-semibold' : ''}`}>{p.name}</span>
                {p.injured && <span className="text-[10px] text-bad">INJ</span>}
                <div className="flex flex-col">
                  <button onClick={() => move(idx, -1)} disabled={idx === 0} className="text-muted hover:text-chalk disabled:opacity-20 leading-none text-xs px-1" aria-label={`Move ${p.name} up`}>▲</button>
                  <button onClick={() => move(idx, 1)} disabled={idx === localOrder.length - 1} className="text-muted hover:text-chalk disabled:opacity-20 leading-none text-xs px-1" aria-label={`Move ${p.name} down`}>▼</button>
                </div>
              </div>
            </div>
          );
        })}

        {/* A starting slot with nobody in it. The sim fields whoever it can and
            this position plays a man short of what the formation asks for. */}
        {Array.from({ length: emptyStarterSlots }, (_, i) => (
          <div
            key={`empty-${i}`}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 border-l-2 border-dashed border-bad/60 bg-bad/[0.06]"
          >
            <span className="w-7 shrink-0 text-[10px] font-semibold tracking-wide text-bad">
              {starterCount > 1 ? `ST${localOrder.length + i + 1}` : 'ST'}
            </span>
            <span className="text-xs text-bad flex-1">Unmanned — nobody to start here</span>
          </div>
        ))}
      </div>
    </div>
  );
}
