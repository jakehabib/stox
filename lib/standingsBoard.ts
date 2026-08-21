import { prisma } from './db';
import { LEAGUE } from './tuning';

/**
 * Everything the Standings screen needs, computed once.
 *
 * The point of this module is that the "playoff picture" a user reads during
 * the season has to be the SAME calculation the sim actually runs when it
 * seeds the bracket at the end of week 17 — otherwise the page is a plausible
 * lie. `seedConference` below is the client-side twin of `seedPlayoffs` in
 * lib/season.ts: division winners first (sorted among themselves), then the
 * best remaining records as wildcards. If one of those changes, both change.
 */

export interface StandingsRow {
  id: string;
  abbr: string;
  city: string;
  nickname: string;
  conference: string;
  division: string;
  isUser: boolean;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgnst: number;
  divWins: number;
  divLosses: number;
  confWins: number;
  confLosses: number;
  eliminated: boolean;
  /** Win percentage, ties counting a half. */
  pct: number;
  /** Point differential — the tiebreaker this sim actually uses. */
  diff: number;
  /** Projected (or final) conference seed, 1..PLAYOFF_TEAMS_PER_CONF, else null. */
  seed: number | null;
  /** True when this team currently holds its division. */
  divisionLeader: boolean;
  /** Games behind the conference's top seed. 0 for the leader. */
  gamesBack: number;
  /** e.g. "W3", "L2", or null before any game is played. */
  streak: string | null;
  /** Week-over-week movement inside the division; null when not meaningful. */
  delta: number | null;
}

export interface DivisionBlock { conference: string; division: string; teams: StandingsRow[] }
export interface ConferenceBlock {
  conference: string;
  divisions: DivisionBlock[];
  /** Seeded playoff field, best-to-worst. */
  inField: StandingsRow[];
  /** The next few teams below the cut line, best-first. */
  inHunt: StandingsRow[];
}

const DIVISION_ORDER = ['East', 'North', 'South', 'West'];

function divisionRank(d: string): number {
  const i = DIVISION_ORDER.indexOf(d);
  return i === -1 ? DIVISION_ORDER.length : i;
}

/** Same ordering the sim seeds with: win pct, then point differential. */
export function byStanding(a: StandingsRow, b: StandingsRow): number {
  if (b.pct !== a.pct) return b.pct - a.pct;
  return b.diff - a.diff;
}

/**
 * Mirror of seedPlayoffs(): every division winner is seeded above every
 * wildcard, regardless of record. That's the rule that makes a 9-8 division
 * champion host an 12-5 wildcard, and the page has to show it or the user
 * will mis-plan their week 17.
 */
function seedConference(confTeams: StandingsRow[]): StandingsRow[] {
  const divisions = Array.from(new Set(confTeams.map((t) => t.division)));
  const divWinners = divisions
    .map((div) => confTeams.filter((t) => t.division === div).sort(byStanding)[0])
    .filter(Boolean)
    .sort(byStanding);
  const others = confTeams.filter((t) => !divWinners.includes(t)).sort(byStanding);
  const wildcards = others.slice(0, Math.max(0, LEAGUE.PLAYOFF_TEAMS_PER_CONF - divWinners.length));
  return [...divWinners, ...wildcards].slice(0, LEAGUE.PLAYOFF_TEAMS_PER_CONF);
}

/**
 * Current win/loss streak per team, from played games. One pass over the
 * league's game log rather than a query per team — 32 teams × 17 weeks is
 * small enough that fetching the lot and bucketing in memory is cheaper than
 * 32 round trips.
 */
async function computeStreaks(leagueId: string): Promise<Map<string, string>> {
  const games = await prisma.game.findMany({
    where: { leagueId, played: true },
    orderBy: { week: 'asc' },
    select: { week: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
  });
  const resultsByTeam = new Map<string, ('W' | 'L' | 'T')[]>();
  const push = (teamId: string, r: 'W' | 'L' | 'T') => {
    const arr = resultsByTeam.get(teamId) ?? [];
    arr.push(r);
    resultsByTeam.set(teamId, arr);
  };
  for (const g of games) {
    if (g.homeScore === g.awayScore) { push(g.homeTeamId, 'T'); push(g.awayTeamId, 'T'); continue; }
    const homeWon = g.homeScore > g.awayScore;
    push(g.homeTeamId, homeWon ? 'W' : 'L');
    push(g.awayTeamId, homeWon ? 'L' : 'W');
  }

  const streaks = new Map<string, string>();
  for (const [teamId, results] of resultsByTeam) {
    const last = results[results.length - 1];
    if (!last) continue;
    let run = 0;
    for (let i = results.length - 1; i >= 0 && results[i] === last; i--) run++;
    streaks.set(teamId, `${last}${run}`);
  }
  return streaks;
}

export async function buildStandingsBoard(
  leagueId: string,
  opts: { withStreaks: boolean; deltas?: Map<string, number> } = { withStreaks: true },
): Promise<ConferenceBlock[]> {
  const teams = await prisma.team.findMany({
    where: { leagueId },
    // Deterministic order in, deterministic panels out. Without this the
    // division panels shuffle between renders because Postgres is free to
    // return rows in whatever order it likes.
    orderBy: [{ conference: 'asc' }, { division: 'asc' }, { abbr: 'asc' }],
  });
  const streaks = opts.withStreaks ? await computeStreaks(leagueId) : new Map<string, string>();

  const rows: StandingsRow[] = teams.map((t) => {
    const played = Math.max(1, t.wins + t.losses + t.ties);
    return {
      id: t.id, abbr: t.abbr, city: t.city, nickname: t.nickname,
      conference: t.conference, division: t.division, isUser: t.isUser,
      wins: t.wins, losses: t.losses, ties: t.ties,
      pointsFor: t.pointsFor, pointsAgnst: t.pointsAgnst,
      divWins: t.divWins, divLosses: t.divLosses,
      confWins: t.confWins, confLosses: t.confLosses,
      eliminated: t.eliminated,
      pct: (t.wins + t.ties * 0.5) / played,
      diff: t.pointsFor - t.pointsAgnst,
      seed: t.playoffSeed,
      divisionLeader: false,
      gamesBack: 0,
      streak: streaks.get(t.id) ?? null,
      delta: opts.deltas?.get(t.id) ?? null,
    };
  });

  const conferences = Array.from(new Set(rows.map((r) => r.conference))).sort();
  const blocks: ConferenceBlock[] = [];

  for (const conference of conferences) {
    const confTeams = rows.filter((r) => r.conference === conference);
    const seeded = seedConference(confTeams);

    // Once the sim has stamped real playoffSeed values, those win — they're
    // the bracket that actually exists. Before that, show the projection.
    const hasOfficialSeeds = confTeams.some((t) => t.seed !== null);
    if (!hasOfficialSeeds) seeded.forEach((t, i) => { t.seed = i + 1; });

    // Standard games-back: half a game for each win the leader has on you,
    // plus half a game for each extra loss. Not a win-percentage gap scaled
    // by season length — that reads plausible and is wrong by a game or more
    // whenever two teams have played a different number of games.
    const leader = seeded[0];
    for (const t of confTeams) {
      t.gamesBack = leader
        ? Math.max(0, ((leader.wins - t.wins) + (t.losses - leader.losses)) / 2)
        : 0;
    }

    const divisions = Array.from(new Set(confTeams.map((r) => r.division)))
      .sort((a, b) => divisionRank(a) - divisionRank(b) || a.localeCompare(b))
      .map((division) => {
        const list = confTeams.filter((r) => r.division === division).sort(byStanding);
        if (list[0]) list[0].divisionLeader = true;
        return { conference, division, teams: list };
      });

    const field = confTeams.filter((t) => t.seed !== null).sort((a, b) => (a.seed! - b.seed!));
    const hunt = confTeams
      .filter((t) => t.seed === null && !t.eliminated)
      .sort(byStanding)
      .slice(0, 4);

    blocks.push({ conference, divisions, inField: field, inHunt: hunt });
  }

  return blocks;
}
