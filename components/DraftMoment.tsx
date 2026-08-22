'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
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
}

export interface SelectionMoment {
  team: { id: string; abbr: string; city: string; nickname: string };
  pick: { year: number; round: number; overall: number };
  player: SelectionPlayer;
}

const MomentContext = createContext<((moment: SelectionMoment) => void) | null>(null);

/**
 * THE ONE MOMENT THE OFFSEASON IS FOR — and the reason it is hoisted to the
 * top of the page rather than living inside the button that triggers it.
 *
 * draftPlayerAction revalidates the league layout, so the board re-renders the
 * instant the pick lands and the drafted man's row leaves it. A card owned by
 * that row unmounts with it and is never seen (measured: the overlay never
 * painted once, on a pick that had already been written to the database). The
 * provider sits at a fixed position in the page instead, so the refresh
 * happens underneath the card while it stays up.
 */
export function DraftMomentProvider({ children }: { children: React.ReactNode }) {
  const [moment, setMoment] = useState<SelectionMoment | null>(null);
  const show = useCallback((m: SelectionMoment) => setMoment(m), []);
  const dismiss = useCallback(() => setMoment(null), []);

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
    <MomentContext.Provider value={show}>
      {children}
      {moment && <SelectionCard moment={moment} onDismiss={dismiss} />}
    </MomentContext.Provider>
  );
}

/** null outside the provider, so a button can still function without the card. */
export function useDraftMoment() {
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
              <div className="text-[11px] text-muted mt-1">
                {player.boardRank === pick.overall
                  ? 'right where the board had him'
                  : player.boardRank > pick.overall
                  ? `${player.boardRank - pick.overall} spots ahead of the board`
                  : `slid ${pick.overall - player.boardRank} spots past the board`}
              </div>
            </div>
          )}
        </div>

        <div className="relative border-t border-line/60 px-6 py-3 flex items-center justify-between gap-3">
          <span className="text-[11px] text-muted">Esc</span>
          <button autoFocus className="btn-primary text-sm" onClick={onDismiss}>Back to the board</button>
        </div>
      </div>
    </div>
  );
}
