'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { changePositionAction } from '@/app/actions/roster';
import { ratingColor } from '@/lib/ratings';
import { ActionButton } from './ds/ActionButton';
import { PlayerAvatar } from './PlayerAvatar';
import { positionBadgeClass } from './ds/positionColor';

/**
 * One destination, priced and placed. Everything here is computed on the
 * server by the player card — `positionMove` for the rating and `slotVerdict`
 * for where he lands — so this component does no football reasoning of its
 * own. That is deliberate: `slotVerdict` (components/ds/DepthCompare.tsx) is
 * the app's single answer to "would he start", the free-agency screen already
 * renders it, and a second implementation living here is exactly how this
 * codebase once ended up with three definitions of the starting lineup.
 */
export interface PositionOption {
  position: string;
  /** What he would rate there. The number the commit writes — same function. */
  ovr: number;
  /** ovr minus what he rates today. Signed. */
  delta: number;
  /** Human labels for traits this job asks for that nobody has coached him in. */
  learned: string[];
  /** How many start there (lib/lineup.ts). */
  starterCount: number;
  /** Would he be in the starting group at that rating? */
  starts: boolean;
  /** Nobody is in one of those starting slots today. */
  slotOpen: boolean;
  /** The man who loses his place if he slots in. Null when a slot is open. */
  displaces: { id: string; name: string; ovr: number; age: number } | null;
  /** What he has to match to crack the group there. Null when a slot is open. */
  threshold: number | null;
  /** Best man currently in that starting group, for the "no better than" read. */
  incumbentBest: { name: string; ovr: number } | null;
}

/**
 * ===========================================================================
 * MOVE HIM
 * ===========================================================================
 * The app owner: *"in the real NFL - often lineman can change positions with
 * each other. our game doesn't allow it so if someone has two solid RT and a
 * weak LT, they can't swap the spare RT over. we need to have that
 * functionality somehow being elegant"* — and, later, *"what if we just allow
 * you to change a player's position in the player card?"*
 *
 * So it is on the card, it is one screen, and it is not a modal. Every row
 * states the whole decision at once: what he would RATE there, what that
 * COSTS him against what he rates now, and — the part that makes it a
 * coaching call rather than a spreadsheet edit — WHO HE WOULD BE PLAYING
 * INSTEAD. "78 at LT, −1, and your left tackle is a 61" is a decision. "78"
 * is a number.
 *
 * NO LYING METRICS (principle 6). The rating on a row is the rating the
 * server writes and the sim then plays him at, because both come from the
 * same `positionMove` call. There is no separate "projected" number here and
 * no fog: these are your own men, whose ratings this app already shows
 * exactly (see buildScoutedView's established-professional branch).
 *
 * Rows are ordered by what he would rate, best first — a GM scanning this is
 * asking "where is this man worth most", so the answer is the top row.
 */
export function PositionChangeCard({ leagueId, playerId, playerName, currentPosition, currentOvr, options }: {
  leagueId: string;
  playerId: string;
  playerName: string;
  currentPosition: string;
  currentOvr: number;
  options: PositionOption[];
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (options.length === 0) {
    return (
      <div className="panel p-4">
        <div className="label-sm mb-1.5">Position</div>
        <p className="text-sm text-muted">
          There is nowhere to move a <span className={positionBadgeClass(currentPosition)}>{currentPosition}</span>. The
          job shares no part of its craft with another position on the field, so nothing this roster carries could take
          it and he could not take anything else.
        </p>
      </div>
    );
  }

  const chosen = options.find((o) => o.position === picked) ?? null;

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="label-sm">Change Position</div>
        <div className="text-xs text-muted">
          plays <span className={`font-semibold ${positionBadgeClass(currentPosition)}`}>{currentPosition}</span> at{' '}
          <span className={`stat-value ${ratingColor(currentOvr)}`}>{currentOvr}</span>
        </div>
      </div>

      {/* The mechanic, in one sentence, in a coach's voice rather than a
          designer's. It has to be said once: a GM who does not know the
          rating moves will read the first negative number as a bug. */}
      <p className="text-xs text-muted">
        A rating is what a position asks of a man, so moving him re-grades him against the new job. He is the same
        player either way — what changes is which of his qualities get counted, and nothing about it is permanent.
      </p>

      <div className="space-y-1">
        {options.map((o) => {
          const isPicked = o.position === picked;
          const worse = o.delta < 0;
          return (
            <div key={o.position}>
              <button
                type="button"
                onClick={() => { setPicked(isPicked ? null : o.position); setError(null); }}
                aria-expanded={isPicked}
                className={`w-full text-left flex items-center gap-2.5 rounded-lg px-2 py-2 border-l-2 transition-colors ${
                  isPicked ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-raised/50'
                }`}
              >
                <span className={`w-11 shrink-0 font-display font-bold text-sm ${positionBadgeClass(o.position)}`}>{o.position}</span>
                <span className={`stat-value text-stat-sm w-10 ${ratingColor(o.ovr)}`}>{o.ovr}</span>
                {/* The cost, always signed and always present — a move that
                    costs nothing is itself the finding, and a blank would
                    read as missing data rather than as zero. */}
                <span className={`text-xs font-mono w-9 ${worse ? 'text-bad' : o.delta > 0 ? 'text-accent' : 'text-muted'}`}>
                  {o.delta > 0 ? '+' : o.delta < 0 ? '−' : '±'}{Math.abs(o.delta)}
                </span>
                <span className="text-xs flex-1 min-w-0 truncate text-muted">
                  {o.starterCount === 0 ? (
                    'nobody starts there'
                  ) : o.slotOpen ? (
                    <span className="text-accent">starting spot is open</span>
                  ) : o.starts ? (
                    <>
                      <span className="text-accent">starts</span>
                      {o.displaces ? <> over {o.displaces.name} ({o.displaces.ovr})</> : null}
                    </>
                  ) : (
                    <>behind {o.incumbentBest ? `${o.incumbentBest.name} (${o.incumbentBest.ovr})` : 'your starters'}</>
                  )}
                </span>
                <span className="text-muted text-xs shrink-0">{isPicked ? '▾' : '▸'}</span>
              </button>

              {/* The confirm, inline, under the row it is about. Not a modal:
                  the comparison that justifies the move is the list above it
                  and a dialog would cover the evidence with the question. */}
              {isPicked && chosen && (
                <div className="mt-1 mb-2 ml-3 pl-3 border-l-2 border-accent space-y-2.5">
                  <p className="text-sm">
                    <span className="font-semibold">{playerName}</span> moves to{' '}
                    <span className={`font-semibold ${positionBadgeClass(chosen.position)}`}>{chosen.position}</span> and
                    is a <span className={`stat-value ${ratingColor(chosen.ovr)}`}>{chosen.ovr}</span> there
                    {chosen.delta === 0 ? (
                      <> — the same player, doing a job that asks the same things of him.</>
                    ) : chosen.delta > 0 ? (
                      <> — <span className="text-accent">{chosen.delta} better</span> than at {currentPosition}, because {chosen.position} weights what he is best at.</>
                    ) : (
                      <> — <span className="text-bad">{Math.abs(chosen.delta)} worse</span> than at {currentPosition}.</>
                    )}
                  </p>

                  {/* This used to read "{position} asks for {traits}, which nobody
                      has ever coached him in" — and it named run defence at a
                      linebacker, which is most of his job. The model was the
                      thing that was wrong (LB carried no runStop weight at
                      all; see POSITION_WEIGHTS in lib/ratings.ts), and it is
                      fixed there. The copy no longer claims to know what he
                      has and has not been taught: it names the drop, and says
                      it is not a one-way door. */}
                  {chosen.delta < 0 && (
                    <p className="text-xs text-muted">
                      Playing out of position costs him — he grades{' '}
                      <span className="text-bad">{Math.abs(chosen.delta)}</span> lower at {chosen.position} than at{' '}
                      {currentPosition}
                      {chosen.learned.length > 0
                        ? <>, most of it in {chosen.learned.join(' and ').toLowerCase()}, which {currentPosition} never asked of him</>
                        : null}
                      . Move him back whenever you like and he is the {currentPosition} he was.
                    </p>
                  )}

                  {/* Who comes off the field. The consequence a GM must see
                      before the click, in the same words the depth chart and
                      the free-agency comparison use. */}
                  {chosen.slotOpen ? (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="pill border-accent/50 text-accent bg-accent/10 text-[10px] px-1.5 py-0.5">Fills a hole</span>
                      <span className="text-muted">You have a starting {chosen.position} spot with nobody in it.</span>
                    </div>
                  ) : chosen.starts && chosen.displaces ? (
                    <div className="flex items-center gap-2 text-sm">
                      <PlayerAvatar seed={chosen.displaces.id} age={chosen.displaces.age} size={22} position={chosen.position} />
                      <span className="text-muted">
                        <span className="text-chalk">{chosen.displaces.name}</span>{' '}
                        (<span className={`stat-value ${ratingColor(chosen.displaces.ovr)}`}>{chosen.displaces.ovr}</span>)
                        {' '}loses the job.
                      </span>
                    </div>
                  ) : chosen.starterCount > 0 ? (
                    <p className="text-sm text-warn">
                      He does not crack your starting {chosen.starterCount === 1 ? 'spot' : chosen.starterCount} at{' '}
                      {chosen.position}
                      {chosen.threshold !== null ? <> — he would need {chosen.threshold} to get on the field</> : null}. This
                      makes him depth there and takes him out of your {currentPosition} group.
                    </p>
                  ) : null}

                  {error && <p className="text-xs text-bad">{error}</p>}

                  <div className="flex gap-2 pt-0.5">
                    <ActionButton
                      className="btn-primary"
                      idleLabel={`Move to ${chosen.position} — ${chosen.ovr} OVR`}
                      workingLabel="Moving…"
                      doneLabel={`Now a ${chosen.position}`}
                      onAction={async () => {
                        const res = await changePositionAction(leagueId, playerId, chosen.position);
                        if (!res.ok) { setError(res.message); return false; }
                        setPicked(null);
                        // The card is now about a different position — his
                        // ratings, his depth group and this very list all
                        // change — so the page is re-rendered from the server
                        // rather than patched here.
                        router.refresh();
                        return res.message;
                      }}
                    />
                    <button type="button" onClick={() => setPicked(null)} className="btn-ghost">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
