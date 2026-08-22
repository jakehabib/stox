import { NewsCategory } from '@/components/ds/NewsRow';
import { isAwardType } from './awardTypes';

/**
 * Maps a real Transaction.type (see prisma/schema.prisma's comment on the
 * Transaction model) to the NewsRow category vocabulary. One TRADE/SIGNING/
 * etc. type can cover several underlying transaction types that all read
 * the same way in a news feed.
 */
export function transactionCategory(type: string, headline: string): NewsCategory {
  if (headline.startsWith('League Record')) return 'RECORD';
  switch (type) {
    case 'TRADE': return 'TRADE';
    case 'SIGN': case 'RESIGN': case 'TAG': return 'SIGNING';
    // Its own kicker, NOT folded in with the signings above: a club that moves
    // a lineman inside did not sign anybody, and the coarse vocabulary this
    // file maps into was missing the concept entirely until position changes
    // existed. See the NewsCategory docstring.
    case 'POSITION': return 'POSITION CHANGE';
    case 'INJURY': return 'INJURY';
    case 'DRAFT': return 'DRAFT';
    case 'CHAMPION':
    // An All-Star selection and the roster announcement are honours, not
    // league admin — see lib/allStars.ts. Both read as AWARD in a feed.
    case 'ALL_STAR': case 'ALL_STAR_ROSTER':
      return 'AWARD';
    default:
      // Every season trophy, current and retired, off one shared list rather
      // than a case arm per type — an arm that nobody remembers to add is how
      // a brand-new award ends up filed under 'LEAGUE' in the wire.
      return isAwardType(type) ? 'AWARD' : 'LEAGUE';
  }
}
