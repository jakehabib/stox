'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { setDepthChartAction } from '@/app/actions/roster';
import { ratingColor } from '@/lib/ratings';
import { startersAt, depthSlotLabel } from '@/lib/lineup';
import { capCommitted, formatMoney } from '@/lib/cap';
import { PlayerAvatar } from './PlayerAvatar';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { positionBadgeClass } from './ds/positionColor';

interface P {
  id: string;
  name: string;
  ovr: number;
  age: number;
  injured: boolean;
  weightLb?: number;
  heightIn?: number;
  /**
   * His cap hit this year, from `capHit()` — the page resolves it, so this is
   * the club's own figure and not a second opinion about it. Null when there is
   * no contract row at all, which is a different fact from a deal that charges
   * nothing and is drawn differently. Ignored entirely when `capOn` is false.
   */
  capHit: number | null;
}

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
 *
 * THE MONEY, AND WHY THESE ROWS ARE NOT `DepthList`'S ROWS.
 * The app owner asked for cap hits beside his depth, twice, and both times the
 * fix landed on a panel elsewhere — the screen actually called Depth Chart went
 * on showing a roster with no price on any of it. It shows one now.
 *
 * The row itself stays here rather than becoming another caller of `DepthList`
 * (components/ds/DepthAtPosition.tsx). That component draws a STATIC row: the
 * whole thing is one link, and its columns — age, cap hit, term, rating — are
 * sized for a half-page panel. This row is an EDITOR. It carries two reorder
 * buttons that must stay clickable, an injury flag, and a name that is a link
 * inside a row that is not one, and it lives in a multi-column card ~350px
 * wide. Merging them needs a "which caller am I" prop for every one of those
 * differences, which is the trade 4ee40eb weighed and refused on the panel
 * side; the honest shared thing is smaller than a component.
 *
 * So what IS shared is the part that could disagree: `formatMoney` and
 * `capCommitted` from lib/cap.ts, the em dash for a man with no contract, and
 * hiding the column outright when the cap is off — imported or copied verbatim
 * from DepthList, never restated in its own words. Same man, same number, same
 * shape, on both screens.
 */
export function DepthChartGroup({ leagueId, teamId, position, players, order, capOn }: { leagueId: string; teamId: string; position: string; players: P[]; order: string[]; capOn: boolean }) {
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

  /** One write, one order. Everything that reorders this group goes through here. */
  const commit = (next: string[]) => {
    setLocalOrder(next);
    startTransition(() => setDepthChartAction(teamId, position, next));
  };

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...localOrder];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    commit(next);
  };

  const starterCount = startersAt(position);
  /**
   * WHAT TO CALL EACH ROW. `depthSlotLabel` names every rung the engine pays a
   * UNIT_DEPTH_WEIGHTS entry to and nothing past it, so this card cannot
   * invent a "WR5" the simulation has no opinion about. It is a different
   * count from `starterCount` on purpose — see lib/lineup.ts.
   */
  const slotLabel = (idx: number) => depthSlotLabel(position, idx);

  const ovrOf = (id: string) => byId.get(id)?.ovr ?? 0;

  /**
   * ===========================================================================
   * SORT THIS GROUP — AND ONLY THIS GROUP
   * ===========================================================================
   * Auto-Sort at the top of the page is `autoDepthChart`, which does
   * `deleteMany({ where: { teamId } })` and rebuilds all sixteen groups by
   * `trueOvr`. One click, one write, correct result — and unusable for the only
   * people who need it. A GM who has deliberately started a developing rookie
   * ANYWHERE can never press it again without losing that decision EVERYWHERE,
   * and the population that wants a bulk sort is exactly the population that has
   * customised something. So the bulk button stays (it is still the right tool
   * on a fresh roster) and the same sort is offered at the scope where the
   * damage is bounded: this card, this position, undoable by two arrows.
   *
   * `setDepthChartAction` already takes one position's order, so this needs no
   * new server route and cannot touch a group it is not drawn inside of.
   *
   * Hidden when the group is already in rating order, because a control that
   * does nothing is worse than no control — and this is a card that repeats
   * sixteen times down the page.
   */
  const alreadySorted = localOrder.every((id, i) => i === 0 || ovrOf(localOrder[i - 1]) >= ovrOf(id));
  const sortByRating = () => commit([...localOrder].sort((a, b) => ovrOf(b) - ovrOf(a)));

  /**
   * FOURTH TO FIRST IS THREE PRESSES AND THREE SERVER WRITES with the arrows —
   * `move` posts on every press — and there is no drag-to-reorder on this page
   * to do it in one gesture. The move a GM actually wants from a bench row is
   * almost never "up one"; it is "he starts". So that is one press, and the man
   * he displaces drops to first off the bench rather than to the bottom.
   *
   * He lands in the LAST starting slot, not the first: at WR that makes him WR3
   * and leaves WR1 and WR2 where the GM put them, which is the smallest change
   * that answers the request. At the nine positions where one man starts the two
   * readings coincide.
   */
  const promote = (idx: number) => {
    const to = Math.min(starterCount - 1, idx);
    if (to < 0 || to >= idx) return;
    const next = [...localOrder];
    const [man] = next.splice(idx, 1);
    next.splice(to, 0, man);
    commit(next);
  };

  const filledStarters = Math.min(starterCount, localOrder.length);
  const emptyStarterSlots = Math.max(0, starterCount - localOrder.length);
  /** Is there anybody here a one-press promotion could actually move? */
  const hasBench = starterCount > 0 && localOrder.length > starterCount;

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <h3 className={`font-display font-bold text-sm uppercase tracking-wide ${positionBadgeClass(position)}`}>{position}</h3>
        <div className="flex items-center gap-2 text-xs text-muted">
          {pending && <span>Saving…</span>}
          {/* What the group costs, in the same words and the same order as the
              re-sign panel and free agency: "$X committed here". A per-row
              column answers "is he worth his money"; only the total answers
              "what is this position costing me", which is the question you ask
              standing in front of the whole group. No starters/bench split on
              top of it — the tint and the bench rule already sort the rows into
              those two piles, and a second figure per card across sixteen cards
              buys a reading nobody was missing. */}
          {capOn && players.length > 0 && (
            <>
              <span className="font-mono text-chalk">{formatMoney(capCommitted(players))}</span>
              <span>committed here</span>
              <span>·</span>
            </>
          )}
          <span className="label-sm">
            {starterCount === 0
              ? 'no base starter'
              : `${starterCount} starter${starterCount === 1 ? '' : 's'}`}
          </span>
          {localOrder.length > 1 && !alreadySorted && (
            <button
              type="button"
              onClick={sortByRating}
              className="btn-ghost text-[10px] px-1.5 py-0.5"
              aria-label={`Sort ${position} by rating`}
            >
              Sort by rating
            </button>
          )}
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
                {/* WR1, WR2, CB3 — the rung, in the words a football team
                    uses, for every slot the engine actually reads. See
                    `depthSlotLabel` in lib/lineup.ts for why the count comes
                    off UNIT_DEPTH_WEIGHTS and why rows past it stay `#n`. */}
                <span className={`w-11 shrink-0 text-[10px] font-semibold tracking-wide ${starts ? 'text-chalk' : slotLabel(idx) ? 'text-muted' : 'text-muted font-normal'}`}>
                  {slotLabel(idx) ?? `#${idx + 1}`}
                </span>
                <PlayerAvatar seed={p.id} age={p.age} size={22} teamColor={teamColor} weightLb={p.weightLb} heightIn={p.heightIn} position={position} />
                <span className={`stat-value text-xs w-8 ${ratingColor(p.ovr)}`}>{p.ovr}</span>
                {/* THE NAME IS A DOOR. Every other screen in the game opens a
                    player card from his name; this one rendered plain text, so
                    the depth chart was the one place you could see a man and
                    not be able to look at him. The arrows keep their own click
                    because they sit outside the link. */}
                <Link
                  href={`/league/${leagueId}/player/${p.id}`}
                  className={`text-sm flex-1 truncate hover:text-accent hover:underline underline-offset-2 ${starts ? 'font-semibold' : ''}`}
                >
                  {p.name}
                </Link>
                {p.injured && <span className="text-[10px] text-bad">INJ</span>}
                {/* Cap off means every one of these is 0 league-wide, so the
                    column is not drawn at all rather than filled with $0.0M.
                    No contract row — an undrafted man, or a fantasy roster
                    filled before contracts exist — gets a dash: "$0.0M" is a
                    claim about a deal and there is no deal here to claim it
                    about, and capHit(null) returns 0, which is exactly the
                    collision the dash avoids. Same rules, same formatter, as
                    the rows in DepthList — w-14 rather than its w-16 only
                    because these cards are half its width; the widest string
                    formatMoney can hand back here is "$100.0M" at 50px, so the
                    column still never clips what it is given. */}
                {capOn && (
                  <span className={`text-xs w-14 text-right font-mono shrink-0 ${p.capHit === null ? 'text-muted' : 'text-muted'}`}>
                    {p.capHit === null ? '—' : formatMoney(p.capHit)}
                  </span>
                )}
                {/* PROMOTE IN ONE PRESS. Drawn only where it does something —
                    on a bench row, at a position that actually fields a
                    starter — and the slot is reserved for the whole group when
                    any row can use it, so the names above and below it do not
                    jump width as the list is worked. See `promote`. */}
                {hasBench && (
                  <span className="w-9 shrink-0 text-right">
                    {!starts && (
                      <button
                        onClick={() => promote(idx)}
                        className="text-[10px] text-muted hover:text-chalk leading-none"
                        aria-label={`Make ${p.name} a starting ${position}`}
                      >
                        Start
                      </button>
                    )}
                  </span>
                )}
                <div className="flex flex-col">
                  <button onClick={() => move(idx, -1)} disabled={idx === 0} className="text-muted hover:text-chalk disabled:opacity-20 leading-none text-xs px-1" aria-label={`Move ${p.name} up`}>▲</button>
                  <button onClick={() => move(idx, 1)} disabled={idx === localOrder.length - 1} className="text-muted hover:text-chalk disabled:opacity-20 leading-none text-xs px-1" aria-label={`Move ${p.name} down`}>▼</button>
                </div>
              </div>
            </div>
          );
        })}

        {/* A starting slot with nobody in it. The sim fields whoever it can and
            this position plays a man short of what the formation asks for.
            AND IT IS A DOOR TOO. This row is the most explicit statement of a
            problem anywhere in the product — it knows the position and it knows
            nobody plays there — and it was the only thing on this screen you
            could not click. Reordering cannot fix an empty slot, so it does not
            link back to this page; it opens the market already filtered to the
            position that is empty, which is the single move that ends it. */}
        {Array.from({ length: emptyStarterSlots }, (_, i) => (
          <Link
            key={`empty-${i}`}
            href={`/league/${leagueId}/free-agency?pos=${position}`}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 border-l-2 border-dashed border-bad/60 bg-bad/[0.06] hover:bg-bad/[0.12] transition-colors"
          >
            <span className="w-11 shrink-0 text-[10px] font-semibold tracking-wide text-bad">
              {slotLabel(localOrder.length + i) ?? `#${localOrder.length + i + 1}`}
            </span>
            <span className="text-xs text-bad flex-1">Unmanned — nobody to start here</span>
            <span className="text-[10px] text-bad/80 shrink-0">Sign a {position} →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
