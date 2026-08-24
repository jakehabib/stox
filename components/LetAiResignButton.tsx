'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { letAiResignAction } from '@/app/actions/resign';
import { formatMoney } from '@/lib/cap';
import type { ResignDecision } from '@/lib/season';

type Result = { kept: number; released: number; decisions: ResignDecision[] };

/**
 * WHAT CAME BACK HAS TO ACCOUNT FOR EVERYONE.
 *
 * This used to print "kept N, let M walk" and stop, and those two numbers only
 * ever counted signings and expired men let go — so on a live save it answered
 * "kept 4, let 0 walk" over a list of 11 and never mentioned the seven
 * walk-year players it had weighed and deliberately left alone. A GM handing
 * the list to his staff and getting four names back reasonably concludes the
 * staff stopped after four. Now every man on the list comes back with what was
 * decided about him, grouped by the reason, which is what a front office would
 * actually hand across the desk.
 */
const GROUPS: { outcome: ResignDecision['outcome']; heading: string; foot?: string }[] = [
  { outcome: 'RESIGNED', heading: 'Re-signed' },
  { outcome: 'EXTENDED', heading: 'Extended early' },
  // Unreachable from this button as it stands — the delegate never spends the
  // user's tag, and says why in resignDecisionsForTeam. It is here because the
  // outcome exists in the type this panel claims to account for in full, and a
  // group the list does not render is a man who silently vanishes off it.
  {
    outcome: 'TAGGED',
    heading: 'Franchise-tagged',
    foot: 'One fully guaranteed season at the top of the position\u2019s market. No agreement was reached — he simply cannot leave.',
  },
  {
    outcome: 'WALKING',
    heading: 'Letting them walk',
    // Why they are still on the list underneath. Nobody is released the moment
    // this runs — the window has to shut first (lib/season.ts) — and a GM who
    // reads "let go" and then sees the same names below deserves the sentence
    // that explains it rather than a screen that looks broken.
    foot: 'Still on the roster until the window shuts. After that, anyone can sign them.',
  },
  { outcome: 'HELD', heading: 'Staying put', foot: 'Nothing changes for them — they play out the deals they are on.' },
];

const who = (d: ResignDecision) => `${d.name} (${d.position})`;
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function LetAiResignButton({ leagueId }: { leagueId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result | null>(null);
  const router = useRouter();

  const run = () => {
    startTransition(async () => {
      const r = await letAiResignAction(leagueId);
      setResult(r);
      setConfirming(false);
      router.refresh();
    });
  };

  if (result) {
    const decisions = result.decisions ?? [];
    const total = decisions.length;
    const walking = decisions.filter((d) => d.outcome === 'WALKING').length;
    const held = decisions.filter((d) => d.outcome === 'HELD').length;
    const parts = [
      result.kept > 0 ? `${result.kept} signed` : null,
      walking > 0 ? `${walking} let go` : null,
      held > 0 ? `${held} left alone` : null,
    ].filter(Boolean);

    return (
      <div className="panel p-3 space-y-2 text-sm w-[min(26rem,calc(100vw-5rem))]">
        <div className="text-chalk">
          {total === 0
            ? 'Nothing was pending — no decisions to make.'
            : `${total} ${total === 1 ? 'decision' : 'decisions'}, all of them made — ${parts.join(', ')}.`}
        </div>
        {GROUPS.map(({ outcome, heading, foot }) => {
          const men = decisions.filter((d) => d.outcome === outcome);
          if (men.length === 0) return null;
          // Signings carry their terms; the rest are grouped under the reason
          // they share, so a twelve-man list reads as a memo and not a wall.
          const byNote = new Map<string, ResignDecision[]>();
          for (const d of men) {
            const key = d.note ?? '';
            byNote.set(key, [...(byNote.get(key) ?? []), d]);
          }
          return (
            <div key={outcome} className="space-y-1">
              <div className="label-sm">{heading} · {men.length}</div>
              {Array.from(byNote.entries()).map(([note, list]) => (
                <div key={note} className="text-xs text-muted">
                  {note ? `${sentence(note)}: ` : ''}
                  {list
                    .map((d) =>
                      d.years != null && d.apy != null
                        ? `${who(d)} — ${d.years} ${d.years === 1 ? 'yr' : 'yrs'}, ${formatMoney(d.apy)}/yr`
                        : who(d),
                    )
                    .join(' · ')}
                </div>
              ))}
              {foot && <div className="text-[11px] text-muted/80">{foot}</div>}
            </div>
          );
        })}
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted flex-1">Let the AI decide every pending re-sign on your roster?</span>
        <button disabled={pending} onClick={run} className="btn-primary text-xs px-3 py-1.5">
          {pending ? 'Deciding…' : 'Confirm'}
        </button>
        <button onClick={() => setConfirming(false)} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirming(true)} className="btn-secondary text-sm">
      Let the AI Pick
    </button>
  );
}
