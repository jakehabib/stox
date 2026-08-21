/**
 * Relevance ranking for the League Wire.
 *
 * The wire used to be "the six most recent transaction rows." The simulation
 * writes one injury row per game per week — sixteen a week — so six-most-recent
 * was, in practice, six injury reports about strangers. Every playtest lane
 * independently reported the same thing: advance a week, get one game recap
 * followed by eleven cards reading "N injury report(s) from LAX @ SDG", and
 * not one of the other fifteen scores. Signal to noise was roughly 1:11, and
 * inverted.
 *
 * Recency is a tiebreaker here, not the sort key. What a GM wants from a
 * league feed, in order: what happened to *my* team, then what happened that
 * changes the league, then everything else.
 */

export interface WireCandidate {
  id: string;
  type: string;
  headline: string;
  teamId: string | null;
  seasonYear: number;
  week: number;
  createdAt: Date;
}

/**
 * How much a story type is worth on its own merits, before we know whose it
 * is. A title, an award or a firing is the story of its week; an injury
 * report for a team you have no relationship with is a line item.
 */
const TYPE_WEIGHT: Record<string, number> = {
  CHAMPION: 100,
  AWARD_SBMVP: 90, AWARD_MVP: 90, AWARD_OPOY: 70, AWARD_DPOY: 70, AWARD_ROTY: 70,
  // The All-Star rosters coming out is the story of the week the regular
  // season ends — below a title and the individual trophies, above a firing.
  ALL_STAR_ROSTER: 65,
  FIRE: 60,
  TRADE: 55,
  DRAFT: 45,
  RESIGN: 35, TAG: 35,
  SIGN: 30,
  CUT: 25,
  NEWS: 20,
  // Deliberately quiet. Seventy-odd of these land in one week, and league-wide
  // they are a list, not news. The user-team bonus below (+60) is what makes
  // them matter: YOUR player being selected clears every other story on the
  // page, which is the whole excitement of the thing, while the other
  // seventy-odd stay out of the way.
  ALL_STAR: 18,
  DEV_MILESTONE: 10,
  INJURY: 5,
};

/** A league record break is a NEWS row; it deserves far more than one. */
function baseWeight(c: WireCandidate): number {
  if (c.headline.startsWith('League Record')) return 80;
  return TYPE_WEIGHT[c.type] ?? 15;
}

/**
 * Weeks in a league year for staleness purposes — the regular season plus the
 * postseason and the offseason phases. It only has to be roughly right: its
 * job is to make one year ago read as much older than one month ago.
 */
const WEEKS_PER_LEAGUE_YEAR = 25;

/** How far in the past an event is, in weeks of league time. */
function weeksAgo(c: WireCandidate, now: { seasonYear: number; week: number }): number {
  return (now.seasonYear - c.seasonYear) * WEEKS_PER_LEAGUE_YEAR + (now.week - c.week);
}

export function wireScore(c: WireCandidate, userTeamId: string | undefined, now: { seasonYear: number; week: number }): number {
  let score = baseWeight(c);

  // Your own club's news always outranks the same story happening elsewhere.
  // This is the single biggest correction: without it, a trade involving two
  // teams you've never played sits above your own player being ruled out.
  if (userTeamId && c.teamId === userTeamId) score += 60;

  // Staleness decay rather than a hard recency sort, so a championship from
  // three weeks ago can still outrank today's hamstring, but this week's
  // trade outranks last month's.
  //
  // This used to decay on `currentWeek - c.week` alone, which ignored the
  // year. League creation seeds two decades of backstory, so a title won in
  // 2014 — week 21 of its season, against a current week 5 — produced a
  // NEGATIVE difference and therefore zero decay, and sat at its full weight
  // of 100 forever. The dashboard wire showed nothing but ancient
  // championships. Age has to be measured in league time, not in week
  // numbers.
  score -= Math.max(0, weeksAgo(c, now)) * 4;

  return score;
}

/**
 * Picks the wire, collapsing the injury flood into a single row.
 *
 * Injuries are not suppressed — a GM does want to know the league is banged
 * up — but sixteen near-identical rows is a data dump, not news. They get one
 * slot, with the count, and the roster-level detail lives on the Injury
 * Report widget and the player pages where it is actionable.
 */
export function rankWire<T extends WireCandidate>(
  candidates: T[],
  opts: { userTeamId?: string; currentSeasonYear: number; currentWeek: number; limit: number },
): { items: T[]; collapsedInjuries: { count: number; representative: T } | null } {
  const mine = (c: WireCandidate) => opts.userTeamId && c.teamId === opts.userTeamId;

  // An injury involving your own team is never collapsed — that one is yours.
  const strangersInjuries = candidates.filter((c) => c.type === 'INJURY' && !mine(c));
  const rest = candidates.filter((c) => !(c.type === 'INJURY' && !mine(c)));

  const now = { seasonYear: opts.currentSeasonYear, week: opts.currentWeek };
  const ranked = [...rest].sort(
    (a, b) =>
      wireScore(b, opts.userTeamId, now) - wireScore(a, opts.userTeamId, now) ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );

  // Diversity cap. Ranking alone traded six identical injury rows for five
  // identical "X is pacing the league in Y" rows, which is the same failure
  // wearing a better hat — and it is the audit's other complaint, where one
  // sentence appeared 28 times in a single league's news table. At most two
  // stories of any one type make the wire; the rest wait for a week when
  // something else is happening. Your own team's news is exempt, because two
  // things happening to you is not repetition, it's a busy week.
  const PER_TYPE_CAP = 2;
  const perBucket = new Map<string, number>();
  const diverse: T[] = [];
  const overflow: T[] = [];
  for (const c of ranked) {
    // Bucketed by type AND by whose it is, so your own trade and someone
    // else's can both make the wire, but four consecutive "Released X" rows
    // from your own front office cannot. Exempting your own news entirely
    // was the first attempt and it just moved the repetition rather than
    // removing it.
    const bucket = `${mine(c) ? 'own' : 'lg'}:${c.type}`;
    const n = perBucket.get(bucket) ?? 0;
    if (n < PER_TYPE_CAP) { perBucket.set(bucket, n + 1); diverse.push(c); }
    else overflow.push(c);
  }
  // Overflow still beats an empty wire in a quiet week, so it backfills last.
  const ordered = [...diverse, ...overflow];

  const collapsedInjuries =
    strangersInjuries.length > 0
      ? {
          count: strangersInjuries.length,
          representative: [...strangersInjuries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0],
        }
      : null;

  // The collapsed row costs one slot when it exists, so the limit still means
  // what it says.
  const room = collapsedInjuries ? Math.max(0, opts.limit - 1) : opts.limit;
  return { items: ordered.slice(0, room), collapsedInjuries };
}

/**
 * Whether a story belongs in the always-on ticker.
 *
 * The ticker is ambient furniture on every page, and the standing rule for it
 * is that it carries breaking news and never anything the player actually
 * needs to act on — that lives in the static UI (the Front Office brief,
 * roster alerts, the cap banner), where it can't scroll away unread. So this
 * is deliberately strict: transactions and results, never injury reports for
 * strangers and never "player X is pacing the league in Y", which is exactly
 * the filler that turned the ticker into a wall of identical lines. If it
 * scrolled past unread, nothing was missed.
 */
export function isBreakingNews(type: string, headline: string): boolean {
  if (headline.startsWith('League Record')) return true;
  // Threshold sits at CUT, not SIGN. A wave of releases is genuinely the
  // story of its week — one test league had 22 of them and nothing else, and
  // a stricter cut-off emptied its ticker completely. What stays out is
  // NEWS, DEV_MILESTONE and INJURY: per-game filler and other clubs' training
  // room, none of which a GM needs to catch as it scrolls past.
  return baseWeight({ type, headline } as WireCandidate) >= TYPE_WEIGHT.CUT;
}
