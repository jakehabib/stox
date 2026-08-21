import { prisma } from './db';
import { resolveStartYear } from './leagueYear';
import { allStarTallyForTeam, GmAllStarTally } from './allStars';

/**
 * ===========================================================================
 * GM CAREER
 * ===========================================================================
 * A reputation profile for the human GM, derived entirely from decisions
 * already on the books for their team in this league — no separate
 * "personality" input like the AI's gmProfile (lib/ai/gm.ts philosophySummary).
 * Every badge below is backed by a concrete number so a GM can see exactly
 * why they're "Cap Wizard" or "Draft Struggles" and how to change it.
 *
 * Scope: one league at a time, same as the Ring of Honor page — there's no
 * cross-league "account" concept in this schema (League.userTeamId only
 * resolves within its own league), so "career" here means tenure with this
 * franchise, not a persistent identity spanning multiple leagues.
 * ===========================================================================
 */

export interface GmBadge {
  icon: string;
  title: string;
  blurb: string;
}

export interface GmAward {
  label: string;
  detail: string;
  year: number;
}

/**
 * A trade transaction carries no teamId — both sides live on one row, encoded
 * in the headline as "Trade: {abbrA} <-> {abbrB}". Anything counting a team's
 * trades has to match on that, and it has to be this function: the GM page
 * once filtered trades by teamId instead and reported zero on the same screen
 * where the summary tile said seven.
 */
export function tradeInvolves(headline: string, abbr: string): boolean {
  if (!headline.startsWith('Trade: ')) return false;
  return headline.slice('Trade: '.length).split(' <-> ').includes(abbr);
}

export interface GmCareerSummary {
  tenureYears: number;
  firstYear: number;
  wins: number;
  losses: number;
  ties: number;
  playoffAppearances: number;
  championships: number;
  runnerUps: number;
  bestSeason: { year: number; wins: number; losses: number; ties: number; result: string } | null;
  trades: number;
  draftPicksMade: number;
  draftHits: number;
  draftHitRate: number | null;
  avgDeadMoneyPerYear: number;
  tagsUsed: number;
  awards: GmAward[];
  /**
   * All-Stars produced during this tenure — the honour players EARNED from
   * their production while on his roster (lib/allStars.ts), not a count of
   * high ratings he happened to own.
   *
   * The headline figure is `players`, DISTINCT men, on the owner's call: a
   * five-time All-Star quarterback is one All-Star player. `selections` is
   * carried alongside because the two say different things — "seven All-Star
   * players" is a statement about how many stars a front office assembled or
   * developed, "fourteen selections" is a statement about how long it kept
   * them — and neither number is allowed to be printed under the other's
   * label.
   */
  allStars: GmAllStarTally;
  badges: GmBadge[];
}

const AWARD_LABEL: Record<string, string> = {
  AWARD_MVP: 'MVP',
  AWARD_OPOY: 'Offensive Player of the Year',
  AWARD_DPOY: 'Defensive Player of the Year',
  AWARD_ROTY: 'Rookie of the Year',
  AWARD_SBMVP: 'Championship MVP',
};

// Playoff results ranked best-to-worst so "best season" picks the deepest run.
const RESULT_RANK: Record<string, number> = {
  CHAMPION: 6, RUNNER_UP: 5, CONFERENCE: 4, DIVISIONAL: 3, WILDCARD: 2, MISSED: 1,
};

// Draft-pick "hit" bar scales down by round — a 68 OVR day-3 pick starting
// for you is a win; a 68 OVR first-rounder is a bust.
function hitThreshold(round: number): number {
  if (round === 1) return 78;
  if (round <= 3) return 73;
  if (round <= 5) return 68;
  return 64;
}

export async function buildGmCareerSummary(
  leagueId: string,
  team: { id: string; abbr: string; wins: number; losses: number; ties: number },
  currentSeasonYear: number,
): Promise<GmCareerSummary> {
  // Everything on this page is the GM's OWN record, and league creation now
  // seeds two decades of franchise history before the user existed. Without
  // this bound a brand-new save opened on "On the job since 2002 — 25 seasons
  // and counting" and handed out a Champion badge for a title won before the
  // player was hired. Franchise history is a real and separate thing — the
  // Ring of Honor and the dynasty leaderboard are correct to count all of it —
  // but a GM career is not the franchise's career.
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: leagueId },
    select: { id: true, seasonYear: true, startYear: true },
  });
  const hiredIn = await resolveStartYear(league);

  const [seasons, tradeTx, draftPicks, capCharges, tagCount, awardTx] = await Promise.all([
    prisma.teamSeasonRecord.findMany({ where: { teamId: team.id, year: { gte: hiredIn } }, orderBy: { year: 'asc' } }),
    prisma.transaction.findMany({ where: { leagueId, type: 'TRADE' }, select: { headline: true } }),
    prisma.draftPick.findMany({
      where: { leagueId, ownerTeamId: team.id, used: true, playerId: { not: null } },
      select: { round: true, player: { select: { trueOvr: true } } },
    }),
    prisma.capCharge.findMany({ where: { teamId: team.id, year: { gte: hiredIn } }, select: { year: true, amount: true } }),
    prisma.transaction.count({ where: { leagueId, type: 'TAG', teamId: team.id } }),
    prisma.transaction.findMany({
      where: { leagueId, type: { in: Object.keys(AWARD_LABEL) }, teamId: team.id, seasonYear: { gte: hiredIn } },
      orderBy: [{ seasonYear: 'desc' }],
    }),
  ]);

  // Bounded by `hiredIn` for the same reason every other number on this page
  // is: All-Stars this franchise produced before he was hired are the
  // franchise's, not his.
  const allStars = await allStarTallyForTeam(leagueId, team.id, hiredIn);

  // TeamSeasonRecord only gets a row once a season fully wraps (playoffs
  // done) — until then the games already played this year live only on
  // Team.wins/losses/ties, which resets to 0 at the next RESET_STANDINGS.
  // Fold that in so the career record isn't missing the season in progress.
  const currentSeasonLogged = seasons.some((r) => r.year === currentSeasonYear);
  const currentGamesPlayed = team.wins + team.losses + team.ties;
  const includeCurrent = !currentSeasonLogged && currentGamesPlayed > 0;

  // "Seasons on the job" counts the one in progress too — you're the GM
  // this year whether or not a game's been played yet.
  const tenureYears = seasons.length + (currentSeasonLogged ? 0 : 1);
  // The hire date, not the earliest season on file — a GM who has not
  // finished a season yet still started this year.
  const firstYear = hiredIn;
  const wins = seasons.reduce((s, r) => s + r.wins, 0) + (includeCurrent ? team.wins : 0);
  const losses = seasons.reduce((s, r) => s + r.losses, 0) + (includeCurrent ? team.losses : 0);
  const ties = seasons.reduce((s, r) => s + r.ties, 0) + (includeCurrent ? team.ties : 0);
  const playoffAppearances = seasons.filter((r) => r.playoffResult !== 'MISSED').length;
  const championships = seasons.filter((r) => r.playoffResult === 'CHAMPION').length;
  const runnerUps = seasons.filter((r) => r.playoffResult === 'RUNNER_UP').length;

  const best = [...seasons].sort(
    (a, b) => (RESULT_RANK[b.playoffResult] ?? 0) - (RESULT_RANK[a.playoffResult] ?? 0) || b.wins - a.wins,
  )[0];
  const bestSeason = best
    ? { year: best.year, wins: best.wins, losses: best.losses, ties: best.ties, result: best.playoffResult }
    : null;

  const trades = tradeTx.filter((t) => tradeInvolves(t.headline, team.abbr)).length;

  let draftHits = 0;
  for (const dp of draftPicks) {
    if (dp.player && dp.player.trueOvr >= hitThreshold(dp.round)) draftHits++;
  }
  const draftPicksMade = draftPicks.length;
  // Below 5 picks the hit rate is too noisy to badge off of either way.
  const draftHitRate = draftPicksMade >= 5 ? draftHits / draftPicksMade : null;

  const deadMoneyByYear = new Map<number, number>();
  for (const c of capCharges) deadMoneyByYear.set(c.year, (deadMoneyByYear.get(c.year) ?? 0) + c.amount);
  const avgDeadMoneyPerYear =
    tenureYears > 0 ? [...deadMoneyByYear.values()].reduce((a, b) => a + b, 0) / tenureYears : 0;

  const awards: GmAward[] = awardTx.map((t) => ({ label: AWARD_LABEL[t.type] ?? t.type, detail: t.headline, year: t.seasonYear }));

  const badges = computeBadges({
    tenureYears, wins, losses, championships, playoffAppearances, trades,
    draftHitRate, draftPicksMade, avgDeadMoneyPerYear, tagsUsed: tagCount, awardsCount: awards.length,
    allStarPlayers: allStars.players, allStarSelections: allStars.selections,
  });

  return {
    tenureYears, firstYear, wins, losses, ties, playoffAppearances, championships, runnerUps, bestSeason,
    trades, draftPicksMade, draftHits, draftHitRate, avgDeadMoneyPerYear, tagsUsed: tagCount, awards,
    allStars, badges,
  };
}

function computeBadges(s: {
  tenureYears: number; wins: number; losses: number; championships: number; playoffAppearances: number;
  trades: number; draftHitRate: number | null; draftPicksMade: number; avgDeadMoneyPerYear: number;
  tagsUsed: number; awardsCount: number; allStarPlayers: number; allStarSelections: number;
}): GmBadge[] {
  const badges: GmBadge[] = [];
  const games = s.wins + s.losses;
  const winPct = games > 0 ? s.wins / games : 0;

  if (s.championships >= 2) {
    badges.push({ icon: '👑', title: 'Dynasty Builder', blurb: `${s.championships} championships in ${s.tenureYears} seasons at the helm.` });
  } else if (s.championships === 1) {
    badges.push({ icon: '🏆', title: 'Champion', blurb: `Won it all — a championship in ${s.tenureYears} season${s.tenureYears === 1 ? '' : 's'} on the job.` });
  } else if (s.tenureYears >= 3 && s.playoffAppearances / s.tenureYears >= 0.6) {
    badges.push({ icon: '📈', title: 'Perennial Contender', blurb: `${s.playoffAppearances} playoff trips in ${s.tenureYears} seasons — no ring yet, but you're always in the mix.` });
  } else if (s.tenureYears >= 2 && winPct < 0.4) {
    badges.push({ icon: '🔨', title: 'Rebuilder', blurb: `${s.wins}-${s.losses} for your tenure — the roster's still being built.` });
  }

  if (s.draftHitRate !== null) {
    if (s.draftHitRate >= 0.55) {
      badges.push({ icon: '🔍', title: 'Draft Whiz', blurb: `${Math.round(s.draftHitRate * 100)}% of your picks turned into legitimate contributors.` });
    } else if (s.draftHitRate <= 0.25) {
      badges.push({ icon: '🎯', title: 'Draft Struggles', blurb: `Only ${Math.round(s.draftHitRate * 100)}% of ${s.draftPicksMade} picks have hit — the board's worth a second look.` });
    }
  }

  if (s.tenureYears >= 2) {
    if (s.avgDeadMoneyPerYear < 3_000_000) {
      badges.push({ icon: '🧮', title: 'Cap Wizard', blurb: `Averaging under $3M in dead money a year — a clean cap sheet.` });
    } else if (s.avgDeadMoneyPerYear > 15_000_000) {
      badges.push({ icon: '💸', title: 'Cap Trainwreck', blurb: `Averaging ${Math.round(s.avgDeadMoneyPerYear / 1_000_000)}M in dead money a year — cuts and restructures are piling up.` });
    }
  }

  if (s.trades >= 8) {
    badges.push({ icon: '🦈', title: 'Trade Shark', blurb: `${s.trades} trades worked — the phone never stops ringing.` });
  } else if (s.tenureYears >= 2 && s.trades <= 1) {
    badges.push({ icon: '🤐', title: 'Quiet Front Office', blurb: `Just ${s.trades} trade${s.trades === 1 ? '' : 's'} in ${s.tenureYears} seasons — you draft and develop, not deal.` });
  }

  if (s.tagsUsed >= 3) {
    badges.push({ icon: '🏷️', title: 'Tag Happy', blurb: `Used the franchise tag ${s.tagsUsed} times rather than let a name walk.` });
  }

  if (s.awardsCount >= 3) {
    badges.push({ icon: '🏅', title: 'Trophy Case', blurb: `${s.awardsCount} major awards won by players on your roster.` });
  }

  // Distinct men, not selections — a badge that read "8 All-Stars" off one
  // quarterback's eight straight years would be the same player counted eight
  // times, which is the sort of number this project has a standing rule
  // against. The blurb prints both so the figure cannot be misread.
  if (s.allStarPlayers >= 4) {
    badges.push({
      icon: '⭐', title: 'Star Factory',
      blurb: `${s.allStarPlayers} different players have made an All-Star roster under you`
        + `${s.allStarSelections > s.allStarPlayers ? ` — ${s.allStarSelections} selections in all.` : '.'}`,
    });
  }

  if (badges.length === 0) {
    badges.push(
      s.tenureYears === 0
        ? { icon: '🆕', title: 'Rookie GM', blurb: `No completed seasons yet — your legacy starts now.` }
        : { icon: '📋', title: 'Building a Track Record', blurb: `${s.tenureYears} season${s.tenureYears === 1 ? '' : 's'} in — nothing's stood out yet, good or bad. Give it time.` },
    );
  }

  return badges.slice(0, 6);
}
