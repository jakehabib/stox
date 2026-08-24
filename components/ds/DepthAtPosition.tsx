'use client';

import Link from 'next/link';
import { capCommitted, formatMoney } from '@/lib/cap';
import { ratingColor } from '@/lib/ratings';
import { splitStarters, startersAt, depthSlotLabel } from '@/lib/lineup';
import { PlayerAvatar } from '../PlayerAvatar';
import { positionBadgeClass } from './positionColor';

export interface DepthEntry {
  playerId: string;
  name: string;
  ovr: number;
  age: number;
  weightLb?: number;
  heightIn?: number;
  /**
   * His cap hit this year, straight from `capHit()` — the page resolves it, so
   * this is the club's figure and not a second opinion about it. 0 when the cap
   * is off (the column is hidden then); null when there is no contract row at
   * all, which is a different fact and is drawn differently.
   */
  capHit: number | null;
  /** Years left on his deal. 0 means it has expired; null means there is no deal to expire. */
  yearsRemaining: number | null;
  /** True when this row is the man the surface is about. */
  isSubject: boolean;
  /** His card, where the surface can navigate to it. Omitted where a row is not a link. */
  href?: string;
}

/**
 * THE DEPTH ROWS. One renderer, because there used to be two.
 *
 * The player card carried its own copy of this list — rank, avatar, name,
 * rating — so when the app owner asked that *"where it says 'your depth at X
 * position' it should also show your current cap hits for those players"*,
 * only the copy in this file grew a money column. He asked again, still
 * looking at the card. The row is therefore in one place now and both surfaces
 * draw it; what genuinely differs between them — the heading, the sentence
 * over the list, whether a row navigates — is passed in or stays with the
 * caller.
 *
 * THE DEPTH CHART SCREEN IS NOT A CALLER, deliberately. Its rows
 * (components/DepthChartGroup.tsx) are an editor — two reorder buttons that
 * have to stay clickable, an injury flag, a name that is a link inside a row
 * that is not one — in cards half this panel's width. Taking it as a third
 * caller means a prop per difference, which is the same trade refused above.
 * What it takes instead is the part that could drift: `formatMoney` and
 * `capCommitted` out of lib/cap.ts, the em dash for a man with no contract, and
 * the hidden column when the cap is off. The rows are two components; the rules
 * are one.
 *
 * The order is the depth chart's own, passed in by the page from
 * `DepthChartSlot`, and `startersAt` (lib/lineup.ts) decides where the lineup
 * ends. Neither is re-derived here: the order IS who plays, and three parts of
 * this codebase once each carried their own answer about the eleven.
 *
 * Own roster, so no scouting fog: these are your players and the ratings are exact.
 */
export function DepthList({ position, depth, capOn, subjectNote }: {
  position: string;
  /** In depth-chart order. */
  depth: DepthEntry[];
  /** Cap off means the money is meaningless league-wide, so the column is not drawn at all. */
  capOn: boolean;
  /** What the highlighted man is on this surface — "this negotiation", "this player". */
  subjectNote?: string;
}) {
  const starterCount = startersAt(position);

  return (
    <div className="space-y-1">
      {depth.map((d, i) => {
        const starts = i < starterCount;
        const row = (
          <>
            {/* WR1, CB3, EDGE4 — the same rung names the Depth Chart screen
                prints, from the same `depthSlotLabel`. This panel used to say
                "ST2" for the row that screen called "ST2" and the engine calls
                the second receiver; two surfaces naming one rung two ways is
                how this codebase's numbers drift apart. Rows past the last
                weighted slot keep `#n`, because the engine reads nobody there
                and a name would assert a difference it does not make. */}
            <span className={`label-sm w-11 shrink-0 ${starts ? 'text-chalk' : ''}`}>{depthSlotLabel(position, i) ?? `#${i + 1}`}</span>
            <PlayerAvatar seed={d.playerId} age={d.age} size={24} weightLb={d.weightLb} heightIn={d.heightIn} position={position} />
            <span className={`flex-1 truncate text-sm ${d.isSubject || starts ? 'font-semibold' : ''}`}>
              {d.name}{d.isSubject && subjectNote ? ` — ${subjectNote}` : ''}
            </span>
            <span className="text-xs text-muted w-10 text-right">{d.age}yo</span>
            {/* No contract row at all — an undrafted man, or a save whose
                rosters were filled before contracts existed. A dash rather
                than $0.0M and "expiring": both of those are statements about a
                deal, and there is no deal here to make them about. */}
            {capOn && (
              <span className={`text-xs w-16 text-right font-mono ${d.capHit === null ? 'text-muted/50' : 'text-muted'}`}>
                {d.capHit === null ? '—' : formatMoney(d.capHit)}
              </span>
            )}
            <span className="text-xs w-16 text-right">
              {d.yearsRemaining === null
                ? <span className="text-muted/50">—</span>
                : d.yearsRemaining <= 0
                  ? <span className="text-bad">expiring</span>
                  : <span className="text-muted">{d.yearsRemaining} yr{d.yearsRemaining === 1 ? '' : 's'}</span>}
            </span>
            <span className={`stat-value text-stat-sm w-8 text-right ${ratingColor(d.ovr)}`}>{d.ovr}</span>
          </>
        );
        const rowClass = `flex items-center gap-2.5 px-2 py-1.5 -mx-1 rounded-lg border-l-2 ${
          starts ? 'bg-chalk/[0.05] border-accent2/70' : 'border-transparent opacity-80'
        } ${d.isSubject ? 'ring-1 ring-accent/40 bg-accent/10' : d.href ? 'hover:bg-raised' : ''}`;

        return (
          // px-1 compensates the row's -mx-1 bleed. Without it this wrapper's
          // scrollWidth exceeds its clientWidth by 4px and the panel scrolls
          // sideways inside the re-sign row.
          <div key={d.playerId} className="px-1">
            {/* Where the lineup ends. The rung labels alone made the reader
                count, and at WR — three starters named WR1..WR4 — counting is
                exactly what they were getting wrong. */}
            {i === starterCount && starterCount > 0 && (
              <div className="flex items-center gap-2 pt-1.5 pb-1">
                <span className="label-sm text-[10px]">Bench</span>
                <span className="h-px flex-1 bg-line/70" />
              </div>
            )}
            {d.href
              ? <Link href={d.href} className={rowClass}>{row}</Link>
              : <div className={rowClass}>{row}</div>}
          </div>
        );
      })}
    </div>
  );
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
 * job if he walks, and what would you be starting?** The rows underneath —
 * `DepthList`, shared with the player card — are the evidence.
 *
 * WHO COUNTS AS A STARTER IS NOT DECIDED HERE. `startersAt` and
 * `splitStarters` come from lib/lineup.ts, which is the single definition of
 * the starting eleven for the whole app — three parts of this codebase used to
 * each carry their own answer and one of them fielded twelve men on defence.
 * Three receivers start and one tight end does, so "what's behind him" means
 * the fourth receiver in one case and the second tight end in the other, and
 * this component is told which rather than guessing.
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
        <div className="text-xs text-muted flex items-center gap-2">
          {/* What the position already costs you. Re-signing him is a money
              decision as much as a depth one, and the total was a screen away. */}
          {capOn && depth.length > 0 && (
            <>
              <span className="font-mono text-chalk">{formatMoney(capCommitted(depth))}</span>
              <span>committed here</span>
              <span className="text-line">·</span>
            </>
          )}
          <span>
            {starterCount === 0
              ? 'nobody starts here in the base lineup'
              : `${starterCount} start${starterCount === 1 ? 's' : ''} at this position`}
          </span>
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

      <DepthList position={position} depth={depth} capOn={capOn} subjectNote="this negotiation" />
    </div>
  );
}
