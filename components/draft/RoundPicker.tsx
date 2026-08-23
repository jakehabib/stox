'use client';

import { useState } from 'react';

export interface PickerRound {
  round: number;
  body: React.ReactNode;
}

/**
 * "WHO WENT IN ROUND FOUR" IS A REAL QUESTION, AND THE ANSWER WAS A HUNT.
 *
 * Rounds two through seven are 192 selections. They used to be one capped
 * scroll box split into two lanes — rounds 2-4 down the left, 5-7 down the
 * right, both moving together under one scrollbar — with a sticky heading that
 * told you which round you had landed in only after you had landed in it.
 * Nothing was missing; finding one round inside it was the problem.
 *
 * So the rounds are tabs. One round at a time, all 32 of it on screen without
 * scrolling, and the panel is the same height whichever one is up — which is
 * the other half of the point, because this sits inside a recap that had grown
 * to five screens.
 *
 * HIDDEN, NOT UNMOUNTED, for the same reason DraftViewToggle hides its panes:
 * every round is already rendered by the server when the page paints, so
 * switching is instant and no round has to be re-laid-out under the reader.
 * The rows themselves stay server components — this component is handed
 * finished nodes and only decides which one is on show.
 */
export function RoundPicker({ rounds }: { rounds: PickerRound[] }) {
  const [round, setRound] = useState(rounds[0]?.round ?? 2);
  const shown = rounds.some((r) => r.round === round) ? round : rounds[0]?.round;

  return (
    <div>
      <div role="tablist" aria-label="Draft round" className="flex flex-wrap items-stretch border-b border-line/60 bg-ink/20">
        {rounds.map((r) => (
          <button
            key={r.round}
            type="button" role="tab" aria-selected={r.round === shown}
            onClick={() => setRound(r.round)}
            // One line, no per-round count: every round is the same 32 names
            // and the panel header above already says how many that is in
            // total. This is a sub-control inside a panel, not a page-level
            // view switch, and it earns none of the chrome one of those does.
            className={`relative px-4 py-1.5 transition-colors ${
              r.round === shown ? 'text-chalk bg-chalk/[0.05]' : 'text-muted hover:text-chalk hover:bg-raised/40'
            }`}
          >
            <span className="label-sm leading-none">Round {r.round}</span>
            <span
              aria-hidden="true"
              className={`absolute inset-x-0 bottom-0 h-[2px] ${r.round === shown ? 'bg-accent' : 'bg-transparent'}`}
            />
          </button>
        ))}
      </div>

      {rounds.map((r) => (
        <div key={r.round} role="tabpanel" aria-label={`Round ${r.round}`} hidden={r.round !== shown}>
          {r.body}
        </div>
      ))}
    </div>
  );
}
