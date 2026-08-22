'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export interface LineupGapItem {
  position: string;
  missing: number;
  none: boolean;
}

/**
 * A starting spot with nobody healthy for it.
 *
 * Sits beside CapAlertBanner in the league header for the same reason that one
 * does: it is a standing condition, it costs you every week it goes unfixed,
 * and it is invisible on most screens. The sim fills an empty slot at
 * replacement level — a man off the street — so losing your only quarterback
 * is worth roughly forty rating points at the position that decides games,
 * and until now the only place that showed was the depth chart, which counts
 * bodies rather than healthy ones.
 *
 * Deliberately NOT a block. Real clubs play short-handed all the time; the
 * game's job is to tell you, not to refuse to run the week.
 *
 * AND IT CAN BE DISMISSED, because sometimes there is nothing to be done and
 * the GM knows it — there may be no kicker on the wire worth signing, or he
 * may have decided to ride it out. The app owner: *"I think the fix for that
 * banner saying you have no available players is to just give us a dismiss
 * button."*
 *
 * THE DISMISSAL IS SCOPED TO THE HOLE HE ACTUALLY SAW, and that is the whole
 * design. It is keyed on the exact set of positions and counts in front of
 * him, so waving away "no healthy K" cannot also hide "no healthy QB" next
 * week — a new hole has a different key and comes back loud. Losing a second
 * kicker changes the count, so that returns too. He is silencing one known
 * fact, not turning the warning off.
 *
 * Client-side and per-browser on purpose: this is a preference about being
 * told something, not a fact about the league, and it has no business in the
 * save file where an export would carry it to somebody else.
 */
export function LineupGapBanner({ leagueId, gaps }: { leagueId: string; gaps: LineupGapItem[] }) {
  // The hole itself, as a string. Position and count both matter — see above.
  const signature = gaps.map((g) => `${g.position}:${g.missing}${g.none ? '!' : ''}`).join(',');
  const storageKey = `dgm:lineup-gap-dismissed:${leagueId}`;

  // Starts hidden and is revealed once we have read the browser's answer.
  // The other order flashes the banner on every page load for a GM who
  // already dismissed it, which is a worse thing to do than appear a frame
  // late.
  const [checked, setChecked] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(storageKey) === signature);
    } catch {
      // Private browsing, blocked storage — the warning simply always shows,
      // which is the safe way for this particular control to fail.
      setDismissed(false);
    }
    setChecked(true);
  }, [storageKey, signature]);

  const dismiss = () => {
    setDismissed(true);
    try { window.localStorage.setItem(storageKey, signature); } catch { /* see above */ }
  };

  if (gaps.length === 0 || !checked || dismissed) return null;

  const worst = gaps[0];
  const empty = gaps.filter((g) => g.none);
  // "No healthy QB or TE or K" reads like a list a machine made. Two names and
  // a count is how a person says it.
  const names = (list: LineupGapItem[]) => {
    const p = list.map((g) => g.position);
    if (p.length === 1) return p[0];
    if (p.length === 2) return `${p[0]} and ${p[1]}`;
    return `${p[0]}, ${p[1]} and ${p.length - 2} more`;
  };
  const headline = empty.length > 0 ? `No healthy ${names(empty)}` : `Short at ${names(gaps)}`;

  return (
    <div className="border-t border-warn/30 bg-warn/[0.07]">
      <div className="max-w-7xl mx-auto px-6 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="label-sm text-warn shrink-0">{headline}</span>
        <p className="text-xs text-chalk/85 min-w-0">
          {worst.none ? (
            <>
              Nobody on the roster can line up at <b className="text-chalk">{worst.position}</b> this week. Whoever the
              coaches put there plays like a man signed off the street, and it will show in the result.
            </>
          ) : (
            <>
              You are {gaps.reduce((n, g) => n + g.missing, 0)} short of a full lineup
              {gaps.length === 1 ? '' : ' across those spots'}. The empty slots get filled by whoever is left.
            </>
          )}
        </p>
        <div className="flex items-center gap-2 ml-auto shrink-0">
          <Link href={`/league/${leagueId}/free-agency`} className="btn-secondary text-xs py-1">Sign someone</Link>
          <Link href={`/league/${leagueId}/depth-chart`} className="btn-ghost text-xs py-1">Depth chart</Link>
          <button
            type="button"
            onClick={dismiss}
            title="Stops showing this particular hole. A different one still gets your attention."
            className="text-muted hover:text-chalk text-lg leading-none px-1.5 -mr-1"
            aria-label="Dismiss this warning"
          >
            &times;
          </button>
        </div>
      </div>
    </div>
  );
}
