import type { Storyline, StorylineCategory } from '@/lib/storyline';

const CATEGORY_COLOR: Record<StorylineCategory, string> = {
  STAKES: 'text-gold',
  RIVALRY: 'text-bad',
  STREAK: 'text-accent2',
  RECORD_CHASE: 'text-gold',
  MILESTONE: 'text-accent',
  PLAYER_ARC: 'text-muted',
};

const CATEGORY_LABEL: Record<StorylineCategory, string> = {
  STAKES: 'Stakes',
  RIVALRY: 'Rivalry',
  STREAK: 'Streak',
  RECORD_CHASE: 'Record Watch',
  MILESTONE: 'Milestone',
  PLAYER_ARC: 'Player',
};

/**
 * The season's ongoing threads, as opposed to the League Wire's record of
 * things that already happened. Every beat carries the number it was derived
 * from, so this reads as a beat writer's notes rather than generated filler —
 * that grounding is the whole point, and it's why the fact is shown rather
 * than kept internal.
 */
export function StorylineFeed({ leagueId, storylines }: { leagueId: string; storylines: Storyline[] }) {
  if (storylines.length === 0) return null;

  return (
    <div className="panel divide-y divide-line/60">
      {storylines.map((s, i) => {
        const body = (
          <>
            <div className={`label-sm ${CATEGORY_COLOR[s.category]}`}>{CATEGORY_LABEL[s.category]}</div>
            <div className="font-display font-bold text-sm leading-snug mt-0.5">{s.headline}</div>
            <div className="text-xs text-muted mt-0.5">{s.detail}</div>
          </>
        );
        return (
          <div key={`${s.category}-${i}`} className="px-4 py-3">
            {s.playerId ? (
              <a href={`/league/${leagueId}/player/${s.playerId}`} className="block hover:opacity-80 transition-opacity">
                {body}
              </a>
            ) : body}
          </div>
        );
      })}
    </div>
  );
}
