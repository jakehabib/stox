'use client';

import { createContext, useCallback, useContext, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PlayerAvatar } from './PlayerAvatar';
import { TeamLogo } from './TeamLogo';
import { ScoutingRange } from './ds/ScoutingRange';
import { positionBadgeClass } from './ds/positionColor';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

export interface SelectionPlayer {
  id: string;
  firstName: string;
  lastName: string;
  position: string;
  age: number;
  college: string;
  heightIn: number;
  weightLb: number;
  /**
   * The club's own file on him, as the board showed it one second earlier — a
   * range while he is fogged. Drafting a player clears Player.isDraftee, which
   * is the scope gate buildScoutedView reads, so a view rebuilt after the pick
   * would print his true rating on the one screen that exists to celebrate not
   * knowing yet.
   */
  ovrLow: number;
  ovrHigh: number;
  ovrExact?: number;
  potLow: number;
  potHigh: number;
  potExact?: number;
  confidence: number;
  /** playerLabel()'s verdict and its colour — the same one his board row carried. */
  label: string;
  labelClass: string;
  /** The public consensus board's read. An opinion of the room, never a rating. */
  boardRank?: number;
  boardGrade?: number;
  bandLabel?: string;
  /**
   * One line in the club's own voice where its file differs from the room's,
   * and the room's own line where it does not — both straight out of
   * lib/consensus.ts, computed from public signals for the man on the card.
   */
  boardNote?: string;
}

export interface SelectionMoment {
  team: { id: string; abbr: string; city: string; nickname: string };
  pick: { year: number; round: number; overall: number };
  player: SelectionPlayer;
}

interface MomentApi {
  show: (moment: SelectionMoment) => void;
  /** True from the moment the card is dismissed until the new board is on screen. */
  refreshing: boolean;
}

const MomentContext = createContext<MomentApi | null>(null);

/**
 * THE ONE MOMENT THE OFFSEASON IS FOR — and the reason it is hoisted to the
 * top of the page rather than living inside the button that triggers it.
 *
 * The card used to be rendered by DraftSelectionButton, from inside the
 * drafted player's own board row. That row leaves the board the instant he is
 * drafted, so anything that refreshed the page took the card down with it, and
 * the app owner saw exactly that: *"the pick confirmation popup literally pops
 * up for a microsecond before disappearing."*
 *
 * Both halves of the fix have to hold together. The board refresh is deferred
 * to dismissal (see `dismiss` below, and the standing comment in
 * app/actions/draft.ts explaining why the server action does not revalidate),
 * AND the card is raised out of the row to a provider that sits above the
 * whole page — so a refresh from anywhere else on the screen cannot unmount
 * it either.
 */
export function DraftMomentProvider({ children }: { children: React.ReactNode }) {
  const [moment, setMoment] = useState<SelectionMoment | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const router = useRouter();
  const show = useCallback((m: SelectionMoment) => setMoment(m), []);
  /*
   * THE REFRESH IS DEFERRED TO HERE, AND IT IS NOT OPTIONAL.
   *
   * draftPlayerAction deliberately does not revalidate (see the comment in
   * app/actions/draft.ts), so the board on screen behind this card is the
   * board as it was BEFORE the pick — the drafted man is still sitting in it.
   * Something has to ask for the new one, and dismissal is the only moment at
   * which doing so cannot take the card with it.
   *
   * IT IS ALSO WHAT RESTARTS THE DRAFT. The pick advanced DraftState by one
   * selection and the next club is on the clock, but LiveDraftTicker only
   * learns that from a fresh server render — its clock is keyed on the
   * `isUserOnClock` prop. No refresh, no next pick, and the draft sits there
   * waiting on a GM who is done. So this is not only a redraw.
   */
  const dismiss = useCallback(() => {
    setMoment(null);
    /*
     * IN A TRANSITION, so the board can be locked while it is out of date.
     * This page's server render is a heavy one (the whole class, graded), and
     * for the second or two it takes, every row on screen still belongs to the
     * board as it was BEFORE the pick — and the ticker is already running the
     * next club's clock behind it. A Draft button on one of those rows is a
     * live control pointed at a stale target, and draftPlayer() does not
     * re-check that its man is still free (see lib/draft.ts). `refreshing` is
     * what the buttons disable on until the new board arrives.
     */
    startRefresh(() => router.refresh());
  }, [router]);

  useEffect(() => {
    if (!moment) return;
    // Any key gets you out. A GM makes seven of these in a row and the card
    // must never become something to fight through.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moment, dismiss]);

  return (
    <MomentContext.Provider value={{ show, refreshing }}>
      {children}
      {moment && <SelectionCard moment={moment} onDismiss={dismiss} />}
    </MomentContext.Provider>
  );
}

/** null outside the provider, so a button can still function without the card. */
export function useDraftMoment(): MomentApi | null {
  return useContext(MomentContext);
}

function SelectionCard({ moment, onDismiss }: { moment: SelectionMoment; onDismiss: () => void }) {
  const { team, pick, player } = moment;
  const accent = generateTeamLogoParams(team.abbr).primary;
  const height = `${Math.floor(player.heightIn / 12)}'${player.heightIn % 12}"`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/85 backdrop-blur-sm animate-fadeUp"
      onClick={onDismiss}
      role="dialog"
      aria-label={`${team.city} select ${player.firstName} ${player.lastName}`}
    >
      <div
        className="relative w-full max-w-2xl overflow-hidden rounded-lg border-2 shadow-elevated bg-card text-left"
        onClick={(e) => e.stopPropagation()}
        style={{
          ['--team-accent' as never]: accent,
          borderColor: 'var(--team-accent)',
          background: 'radial-gradient(ellipse 120% 140% at 0% 0%, color-mix(in srgb, var(--team-accent) 22%, transparent), transparent 70%)',
        }}
      >
        <div
          className="absolute inset-0 opacity-[0.06] pointer-events-none"
          style={{ backgroundImage: 'repeating-linear-gradient(115deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 14px)', color: 'var(--team-accent)' }}
        />
        <TeamLogo seed={team.id} abbr={team.abbr} size={260} className="watermark-logo opacity-[0.07] -right-16 -top-20" />

        <div className="relative px-6 pt-5 pb-4">
          <div className="flex items-center gap-3">
            <TeamLogo seed={team.id} abbr={team.abbr} size={44} />
            <div>
              <div className="label-sm">{pick.year} Draft · Round {pick.round} · Pick {pick.overall} overall</div>
              <div className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none mt-1 text-team">
                {team.city} {team.nickname} Select
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-5">
            <PlayerAvatar seed={player.id} age={player.age} size={76} weightLb={player.weightLb} heightIn={player.heightIn} position={player.position} />
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <span className={`font-semibold text-sm ${positionBadgeClass(player.position)}`}>{player.position}</span>
                <span className={`text-xs font-medium ${player.labelClass}`}>{player.label}</span>
              </div>
              <h2 className="font-display font-extrabold text-3xl uppercase tracking-wide leading-none mt-1 text-chalk truncate">
                {player.firstName} {player.lastName}
              </h2>
              <div className="text-sm text-muted mt-1.5">
                {player.college} · Age {player.age} · {height} · {player.weightLb} lb
              </div>
            </div>
          </div>
        </div>

        <div className="relative border-t border-line/60 bg-ink/40 px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 items-start">
          {player.ovrExact !== undefined ? (
            <div>
              <div className="label-sm">OVR</div>
              <div className="stat-value text-stat-md text-chalk mt-1">{player.ovrExact}</div>
            </div>
          ) : (
            <ScoutingRange low={player.ovrLow} high={player.ovrHigh} confidence={player.confidence} label="OVR" className="w-full" />
          )}
          {player.potExact !== undefined ? (
            <div>
              <div className="label-sm">Potential</div>
              <div className="stat-value text-stat-md text-chalk mt-1">{player.potExact}</div>
            </div>
          ) : (
            <ScoutingRange low={player.potLow} high={player.potHigh} confidence={player.confidence} label="Potential" className="w-full" />
          )}
          {player.boardGrade !== undefined && (
            <div>
              <div className="label-sm">Board Grade</div>
              <div className="stat-value text-stat-md text-chalk mt-1">{player.boardGrade}</div>
              {player.bandLabel && <div className="text-[11px] text-muted mt-1">{player.bandLabel}</div>}
            </div>
          )}
          {player.boardRank !== undefined && (
            <div>
              <div className="label-sm">Board Rank</div>
              <div className="stat-value text-stat-md text-chalk mt-1">#{player.boardRank}</div>
              {/* Where he went against where the room had him — the one
                  comparison anybody can actually make tonight, and the same
                  one the recap's board column makes later. */}
              <div className="text-[11px] text-muted mt-1">
                {player.boardRank === pick.overall
                  ? 'right where the board had him'
                  : player.boardRank > pick.overall
                  ? `${player.boardRank - pick.overall} picks earlier than the board`
                  : `${pick.overall - player.boardRank} picks later than the board`}
              </div>
            </div>
          )}
        </div>

        {player.boardNote && (
          <div className="relative border-t border-line/60 px-6 py-3">
            <p className="text-sm text-chalk/85 leading-snug">{player.boardNote}</p>
          </div>
        )}

        <div className="relative border-t border-line/60 px-6 py-3 flex items-center justify-between gap-3">
          <span className="text-[11px] text-muted">Esc</span>
          {/* Not "back to the board" any more: dismissing this card refreshes
              the page, and the page you land on is draft day as it stands —
              which, now that your selection is in and the wait has started
              again, is the broadcast rather than the board (see the draft
              page's THE TWO VIEWS). Naming a view you may not land in is a
              button that lies about where it goes. */}
          <button autoFocus className="btn-primary text-sm" onClick={onDismiss}>Back to draft day</button>
        </div>
      </div>
    </div>
  );
}
