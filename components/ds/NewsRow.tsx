import Link from 'next/link';
import { TeamLogo } from '../TeamLogo';

export type NewsCategory = 'TRADE' | 'SIGNING' | 'INJURY' | 'RECORD' | 'AWARD' | 'DRAFT' | 'GAME' | 'LEAGUE';

export const CATEGORY_COLOR: Record<NewsCategory, string> = {
  TRADE: 'text-accent2', SIGNING: 'text-accent', INJURY: 'text-bad', GAME: 'text-chalk',
  RECORD: 'text-gold', AWARD: 'text-gold', DRAFT: 'text-accent2', LEAGUE: 'text-muted',
};

/**
 * A wire row reads as a dispatch, not a database log line — a colored
 * category kicker above the headline (the editorial signal that a real
 * sports desk uses), team mark, and a byline-style meta line. `featured`
 * gives the lead story in a list more visual weight than what follows it,
 * the way a real front page does.
 */
export function NewsRow({ teamId, abbr, category, headline, detail, meta, metric, featured, href }: {
  teamId?: string; abbr?: string; category: NewsCategory; headline: string; detail?: string; meta: string;
  /**
   * Where this dispatch leads. A game recap should open its box score — that
   * page existed for weeks and was linked from exactly one file in the whole
   * codebase, so playtesters variously called it "the best screen in the app"
   * and concluded it did not exist.
   */
  href?: string;
  /** The concrete number the story is actually about — "+81 rating", "24 sacks", "1 yr $5.1M" — so the row carries its own payoff instead of just a timestamp. */
  metric?: string;
  featured?: boolean;
}) {
  const body = (
    <div className={`flex items-start gap-3 ${featured ? 'py-4' : 'py-2.5'}${href ? ' -mx-2 px-2 rounded hover:bg-raised/40 transition-colors' : ''}`}>
      {/* A league-wide dispatch has no crest, and an empty grey disc in its
          place is decoration standing in for information it does not have.
          The row simply starts at the text instead. */}
      {teamId && abbr && (
        <div className={`${featured ? 'w-10' : 'w-8'} pt-0.5 shrink-0`}>
          <TeamLogo seed={teamId} abbr={abbr} size={featured ? 36 : 28} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className={`label-sm ${CATEGORY_COLOR[category]}`}>{category}</div>
        <div className={`font-display font-bold leading-snug mt-0.5 ${featured ? 'text-lg' : 'text-sm'}`}>{headline}</div>
        {detail && <div className={`text-muted mt-0.5 ${featured ? 'text-sm' : 'text-xs'}`}>{detail}</div>}
      </div>
      <div className="shrink-0 text-right">
        {metric && <div className="stat-value text-stat-sm">{metric}</div>}
        <div className="text-[11px] text-muted pt-0.5 tnum">{meta}</div>
      </div>
    </div>
  );

  return href ? <Link href={href} className="block">{body}</Link> : body;
}
