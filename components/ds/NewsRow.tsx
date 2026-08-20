import { TeamLogo } from '../TeamLogo';

export type NewsCategory = 'TRADE' | 'SIGNING' | 'INJURY' | 'RECORD' | 'AWARD' | 'DRAFT' | 'LEAGUE';

const CATEGORY_COLOR: Record<NewsCategory, string> = {
  TRADE: 'text-accent2', SIGNING: 'text-accent', INJURY: 'text-bad',
  RECORD: 'text-gold', AWARD: 'text-gold', DRAFT: 'text-accent2', LEAGUE: 'text-muted',
};

/**
 * A wire row reads as a dispatch, not a database log line — a colored
 * category kicker above the headline (the editorial signal that a real
 * sports desk uses), team mark, and a byline-style meta line. `featured`
 * gives the lead story in a list more visual weight than what follows it,
 * the way a real front page does.
 */
export function NewsRow({ teamId, abbr, category, headline, detail, meta, featured }: {
  teamId?: string; abbr?: string; category: NewsCategory; headline: string; detail?: string; meta: string;
  featured?: boolean;
}) {
  return (
    <div className={`flex items-start gap-3 ${featured ? 'py-4' : 'py-2.5'}`}>
      <div className={`${featured ? 'w-10' : 'w-8'} pt-0.5 shrink-0`}>
        {teamId && abbr ? <TeamLogo seed={teamId} abbr={abbr} size={featured ? 36 : 28} /> : <div className={`${featured ? 'w-9 h-9' : 'w-7 h-7'} rounded-full bg-raised`} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`label-sm ${CATEGORY_COLOR[category]}`}>{category}</div>
        <div className={`font-display font-bold leading-snug mt-0.5 ${featured ? 'text-lg' : 'text-sm'}`}>{headline}</div>
        {detail && <div className={`text-muted mt-0.5 ${featured ? 'text-sm' : 'text-xs'}`}>{detail}</div>}
      </div>
      <div className="text-[11px] text-muted shrink-0 pt-0.5 font-mono">{meta}</div>
    </div>
  );
}
