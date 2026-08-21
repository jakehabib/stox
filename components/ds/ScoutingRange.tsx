'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DeltaChip } from './DeltaChip';

function confidenceLabel(confidence: number): { text: string; color: string } {
  if (confidence >= 75) return { text: 'HIGH', color: 'text-accent' };
  if (confidence >= 40) return { text: 'MEDIUM', color: 'text-warn' };
  return { text: 'LOW', color: 'text-muted' };
}

/**
 * A scouted range reads as uncertainty communicated on purpose — a filled
 * track segment between low/high on a 40-99 scale, not a raw progress bar
 * or a "confidence: 62%" debug readout.
 *
 * THE REVEAL. This is the best anticipation object in the codebase and until
 * now it resolved as a re-render: you paid for a scouting pass and the bar
 * simply WAS narrower. Now its two edges sweep inward to the new low/high over
 * --dur-reveal, and the confidence gain is stated as a chip.
 *
 * The distinction that keeps this honest, and the whole ethical difference
 * between this and a loot box: the numeric label is the NEW range at frame
 * one, and stays legible for every millisecond of the sweep. We animate the
 * transition TO the answer, never the arrival OF it. No suspense pause, no
 * near-miss framing, no rarity ceremony, no shuffled order. Scouting here is a
 * resource decision against a printed price list, and dressing it as a pull
 * would reframe a budget choice as a gamble.
 *
 * WHEN IT MOVES, AND WHEN IT MUST NOT. The sweep fires only when the range
 * changes underneath a component that stayed mounted on the same route — which
 * is precisely the shape of "you just scouted him". It deliberately does not
 * fire on:
 *   - first render (a CSS transition has nothing to move from), so every list
 *     of these paints instantly and still;
 *   - navigation between two players' pages, where the same DOM node is reused
 *     for a different man — that would be a route transition, which this app
 *     does not have and is not getting;
 *   - sort, filter and search, which are keyed by player id, so a given row's
 *     own numbers never change and there is nothing to transition. Those
 *     surfaces stay dead still, as they must.
 */
export function ScoutingRange({ low, high, confidence, label = 'OVR', className = 'w-40' }: {
  low: number; high: number; confidence: number; label?: string;
  /** Width utility — narrower (e.g. "w-28") for dense rows like a draft board. */
  className?: string;
}) {
  const c = confidenceLabel(confidence);
  const SCALE_MIN = 40, SCALE_MAX = 99;
  const pct = (v: number) => ((v - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;

  const pathname = usePathname();
  const box = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const seenPath = useRef(pathname);
  const seenConf = useRef(confidence);

  // The confidence chip is shown only where there is genuinely room for it.
  // The dense variants (w-28 on the scouting lanes, w-32 in free agency) are
  // list rows, and a chip appearing beside "Confidence: MEDIUM" inside 112px
  // would either overflow into the next column or push the row taller for two
  // seconds. A list surface twitching is a bug, not a feature, so the narrow
  // instances get the sweep and the text and nothing that changes their box.
  const [roomy, setRoomy] = useState(false);
  useEffect(() => { setRoomy((box.current?.offsetWidth ?? 0) >= 160); }, []);

  // The transition is declared unconditionally, which already handles the
  // first paint: CSS has no previous computed value to move from, so a freshly
  // mounted list of these appears instantly and still.
  //
  // The one case left is navigation. Going from one player's page to the next
  // reuses this DOM node for a different man, and a bar gliding between two
  // unrelated players is a route transition — something this app does not have
  // and is not getting. Killing the transition inside a LAYOUT effect catches
  // it after React has written the new left/width but before the browser
  // paints, so the new range is simply there.
  useLayoutEffect(() => {
    if (seenPath.current === pathname) return;
    seenPath.current = pathname;
    // A different player's numbers are not a delta on this one's, so the
    // confidence baseline moves with the route and no chip is owed.
    seenConf.current = confidence;
    const el = fill.current;
    if (!el) return;
    el.style.transition = 'none';
    void el.offsetWidth;                                  // flush, cancelling it
    const r = requestAnimationFrame(() => { el.style.transition = ''; });
    return () => cancelAnimationFrame(r);
  }, [pathname, confidence]);

  // Confidence gained. A rise on a page the user has not navigated away from
  // is, by construction, a scouting pass they just paid for — the one event
  // here worth stating outright.
  const [gain, setGain] = useState<number | null>(null);
  useEffect(() => {
    const prev = seenConf.current;
    seenConf.current = confidence;
    if (confidence > prev) setGain(confidence - prev);
  }, [confidence]);

  useEffect(() => {
    if (gain === null) return;
    const t = setTimeout(() => setGain(null), 2500);
    return () => clearTimeout(t);
  }, [gain]);

  return (
    <div className={className} ref={box}>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="label-sm">{label}</span>
        <span className="stat-value text-stat-sm text-chalk">{low}–{high}</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-raised overflow-hidden">
        <div
          ref={fill}
          className="absolute inset-y-0 bg-accent2/70 rounded-full range-sweep"
          style={{ left: `${pct(low)}%`, width: `${Math.max(3, pct(high) - pct(low))}%` }}
        />
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        <span className={`text-[11px] font-medium ${c.color}`}>Confidence: {c.text}</span>
        {roomy && <DeltaChip delta={gain} tone="info" format={(n) => `${n}%`} />}
      </div>
    </div>
  );
}
