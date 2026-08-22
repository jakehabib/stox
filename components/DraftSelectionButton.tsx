'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { draftPlayerAction } from '@/app/actions/draft';
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
   * The club's own file on him, as the board showed it one second earlier —
   * a range while he is fogged. Drafting a player clears Player.isDraftee,
   * which is what buildScoutedView's scope gate reads, so re-deriving this
   * after the pick would print his true rating on the card. It is the read
   * you made the pick on that belongs on it.
   */
  ovrLow: number;
  ovrHigh: number;
  ovrExact?: number;
  potLow: number;
  potHigh: number;
  potExact?: number;
  confidence: number;
  /** playerLabel()'s verdict and its colour, the same one his board row carried. */
  label: string;
  labelClass: string;
  /** The public consensus board's read — an opinion of the room, never a rating. */
  boardRank?: number;
  boardGrade?: number;
  bandLabel?: string;
}

/**
 * THE ONE MOMENT THE OFFSEASON IS FOR.
 *
 * Making a selection used to be a table-row button, after which the row
 * simply vanished. This keeps the button exactly as it was — including the
 * cap refusal, which is a real outcome of a rookie deal (see draftPlayer) —
 * and puts the pick itself on screen: the crest, the selection number, and
 * the handful of things actually known about the player at the moment his
 * name is called.
 *
 * The board refresh is deliberately held until the card is dismissed. The AI
 * picks that follow have already run inside the action by then, so nothing is
 * blocked by the card being up; refreshing underneath it would unmount this
 * component (its row leaves the board the instant he is drafted) and take the
 * card with it.
 */
export function DraftSelectionButton({ leagueId, teamId, team, pick, player }: {
  leagueId: string;
  teamId: string;
  team: { id: string; abbr: string; city: string; nickname: string };
  pick: { year: number; round: number; overall: number };
  player: SelectionPlayer;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState(false);
  const router = useRouter();

  const dismiss = () => {
    setMade(false);
    router.refresh();
  };

  useEffect(() => {
    if (!made) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [made]);

  const accent = generateTeamLogoParams(team.abbr).primary;
  const height = `${Math.floor(player.heightIn / 12)}'${player.heightIn % 12}"`;

  return (
    <div className="space-y-1">
      <button
        className="btn-primary text-xs px-2.5 py-1"
        disabled={pending}
        onClick={() => startTransition(async () => {
          const res = await draftPlayerAction(leagueId, player.id, teamId);
          if (!res.ok) { setError(res.message); return; }
          setError(null);
          setMade(true);
        })}
      >
        {pending ? 'Drafting…' : 'Draft'}
      </button>
      {error && <p className="text-[11px] text-bad max-w-[16rem] leading-snug">{error}</p>}

      {made && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/85 backdrop-blur-sm animate-fadeUp"
          onClick={dismiss}
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

            <div className="relative border-t border-line/60 bg-ink/40 px-6 py-4 flex flex-wrap items-end gap-x-8 gap-y-4">
              {player.ovrExact !== undefined ? (
                <div>
                  <div className="label-sm">OVR</div>
                  <div className="stat-value text-stat-md text-chalk mt-1">{player.ovrExact}</div>
                </div>
              ) : (
                <ScoutingRange low={player.ovrLow} high={player.ovrHigh} confidence={player.confidence} label="OVR" className="w-40" />
              )}
              {player.potExact !== undefined ? (
                <div>
                  <div className="label-sm">Potential</div>
                  <div className="stat-value text-stat-md text-chalk mt-1">{player.potExact}</div>
                </div>
              ) : (
                <ScoutingRange low={player.potLow} high={player.potHigh} confidence={player.confidence} label="Potential" className="w-40" />
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
              <button autoFocus className="btn-primary text-sm" onClick={dismiss}>Back to the board</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
