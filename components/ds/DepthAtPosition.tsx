'use client';

import { formatMoney } from '@/lib/cap';
import { ratingColor } from '@/lib/ratings';
import { splitStarters, startersAt } from '@/lib/lineup';
import { PlayerAvatar } from '../PlayerAvatar';
import { positionBadgeClass } from './positionColor';

export interface DepthEntry {
  playerId: string;
  name: string;
  ovr: number;
  age: number;
  weightLb?: number;
  heightIn?: number;
  /** Cap hit this year, 0 when the cap is off. */
  capHit: number;
  /** Years left on his deal. 0 means his contract has expired too. */
  yearsRemaining: number;
  /** True when this row is the man being negotiated with. */
  isSubject: boolean;
}

/**
 * WHAT IS BEHIND HIM.
 *
 * "Do I pay this man" is not answerable on its own — the app owner's note:
 * *"the re-sign pages should also have a popout of the depth chart for that
 * position so you can see what's behind it"*. A 74-overall guard you can
 * replace with a 72 is a completely different decision from a 74-overall guard
 * whose backup is a 58, and the re-sign window was asking for the decision
 * without showing the half of it that decides.
 *
 * So this does not print a list, it answers the question: **who inherits the
 * job if he walks, and what would you be starting?** The list is the evidence
 * under that sentence.
 *
 * WHO COUNTS AS A STARTER IS NOT DECIDED HERE. `startersAt` and
 * `splitStarters` come from lib/lineup.ts, which is the single definition of
 * the starting eleven for the whole app — three parts of this codebase used to
 * each carry their own answer and one of them fielded twelve men on defence.
 * Three receivers start and one tight end does, so "what's behind him" means
 * the fourth receiver in one case and the second tight end in the other, and
 * this component is told which rather than guessing.
 *
 * The order is the depth chart's own order, passed in by the page from
 * `DepthChartSlot` — the same rows the Depth Chart screen renders — so the two
 * screens cannot disagree about who plays ahead of whom.
 *
 * Own roster, so there is no scouting fog here: these are your players and the
 * ratings are exact.
 */
export function DepthAtPosition({ position, depth, capOn }: {
  position: string;
  /** In depth-chart order. The subject is expected to be somewhere in it. */
  depth: DepthEntry[];
  capOn: boolean;
}) {
  const starterCount = startersAt(position);
  const { starters } = splitStarters(position, depth);
  const subjectStarts = starters.some((d) => d.isSubject);

  // The chart as it would be with him gone: same order, one man removed.
  const without = depth.filter((d) => !d.isSubject);
  const withoutStarters = splitStarters(position, without).starters;
  // The man who moves up into the starting group because he left. Only exists
  // if he was starting and there is somebody to promote.
  const promoted = subjectStarts ? withoutStarters[withoutStarters.length - 1] : null;
  const subject = depth.find((d) => d.isSubject);

  return (
    <div className="panel p-3 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="label-sm">
          Your depth at <span className={positionBadgeClass(position)}>{position}</span>
        </div>
        <div className="text-xs text-muted">
          {starterCount === 0
            ? 'nobody starts here in the base lineup'
            : `${starterCount} start${starterCount === 1 ? 's' : ''} at this position`}
        </div>
      </div>

      {/* The sentence the list exists to support. */}
      <p className="text-sm">
        {!subjectStarts ? (
          <>He is not in your starting {starterCount === 1 ? 'lineup' : 'group'} at {position} as it stands — losing him costs you depth, not a starter.</>
        ) : promoted ? (
          <>
            If he walks, <span className="font-semibold">{promoted.name}</span> inherits the job — you would be
            starting a <span className={`stat-value ${ratingColor(promoted.ovr)}`}>{promoted.ovr}</span>
            {subject ? <> in place of a <span className={`stat-value ${ratingColor(subject.ovr)}`}>{subject.ovr}</span></> : null}.
          </>
        ) : (
          <>
            If he walks you have <span className="text-bad font-semibold">nobody</span> to put in his place at{' '}
            {position} — the slot goes unmanned until you sign or draft one.
          </>
        )}
      </p>

      <div className="space-y-1">
        {depth.map((d, i) => {
          const starts = i < starterCount;
          return (
            <div key={d.playerId}>
              {/* Where the lineup ends. The ST/# labels alone made the reader
                  count, and at WR — three starters — counting is exactly what
                  they were getting wrong. */}
              {i === starterCount && starterCount > 0 && (
                <div className="flex items-center gap-2 pt-1.5 pb-1">
                  <span className="label-sm text-[10px]">Bench</span>
                  <span className="h-px flex-1 bg-line/70" />
                </div>
              )}
            <div
              className={`flex items-center gap-2.5 px-2 py-1.5 -mx-1 rounded-lg border-l-2 ${
                starts ? 'bg-chalk/[0.05] border-accent2/70' : 'border-transparent opacity-80'
              } ${d.isSubject ? 'ring-1 ring-accent/40 bg-accent/10' : ''}`}
            >
              <span className={`label-sm w-8 shrink-0 ${starts ? 'text-chalk' : ''}`}>{starts ? `ST${starterCount > 1 ? i + 1 : ''}` : `#${i + 1}`}</span>
              <PlayerAvatar seed={d.playerId} age={d.age} size={24} weightLb={d.weightLb} heightIn={d.heightIn} position={position} />
              <span className={`flex-1 truncate text-sm ${d.isSubject || starts ? 'font-semibold' : ''}`}>
                {d.name}{d.isSubject ? ' — this negotiation' : ''}
              </span>
              <span className="text-xs text-muted w-10 text-right">{d.age}yo</span>
              {capOn && <span className="text-xs text-muted w-16 text-right font-mono">{formatMoney(d.capHit)}</span>}
              <span className="text-xs w-16 text-right">
                {d.yearsRemaining <= 0
                  ? <span className="text-bad">expiring</span>
                  : <span className="text-muted">{d.yearsRemaining} yr{d.yearsRemaining === 1 ? '' : 's'}</span>}
              </span>
              <span className={`stat-value text-stat-sm w-8 text-right ${ratingColor(d.ovr)}`}>{d.ovr}</span>
            </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
