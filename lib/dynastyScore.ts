import { prisma } from './db';

/**
 * ===========================================================================
 * DYNASTY SCORE
 * ===========================================================================
 * One aggregate number per franchise, rolling up everything the Ring of
 * Honor page otherwise shows piecemeal — championships, playoff depth,
 * win rate, draft success, cap discipline, awards, and league records
 * held — into a single ranked leaderboard across every team in the
 * league, not just the user's.
 *
 * Bulk-queries the whole league in a handful of grouped queries rather
 * than reusing lib/gmCareer.ts's buildGmCareerSummary per team (which
 * issues its own set of queries per call) — with up to 32 teams, doing
 * that 32 times over would multiply the query count for no benefit here,
 * since a leaderboard only needs the same handful of source tables, once,
 * grouped by team.
 *
 * Point weights are a simple, transparent additive score — not calibrated
 * against any external benchmark — designed so every input is visible in
 * the breakdown a team can see exactly why its score is what it is.
 * ===========================================================================
 */

const AWARD_TYPES = ['AWARD_MVP', 'AWARD_OPOY', 'AWARD_DPOY', 'AWARD_ROTY', 'AWARD_SBMVP'];

export interface DynastyScoreEntry {
  teamId: string;
  teamAbbr: string;
  teamName: string;
  isUser: boolean;
  score: number;
  breakdown: { label: string; points: number }[];
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// Same round-scaled bar as lib/gmCareer.ts's draft-hit-rate badge — kept as
// a local copy rather than shared so each module's threshold can be tuned
// independently without cross-affecting the other's output.
function hitThreshold(round: number): number {
  if (round === 1) return 78;
  if (round <= 3) return 73;
  if (round <= 5) return 68;
  return 64;
}

interface TeamAgg {
  wins: number; losses: number; tenureYears: number;
  championships: number; runnerUps: number; nonChampPlayoffs: number;
  draftHits: number; draftTotal: number;
  deadMoneyByYear: Map<number, number>;
  awards: number;
}

export async function buildDynastyLeaderboard(leagueId: string): Promise<DynastyScoreEntry[]> {
  const teams = await prisma.team.findMany({ where: { leagueId } });
  const teamIds = teams.map((t) => t.id);

  const [seasons, draftPicks, capCharges, awardTx, leagueRecords] = await Promise.all([
    prisma.teamSeasonRecord.findMany({ where: { leagueId }, select: { teamId: true, wins: true, losses: true, playoffResult: true } }),
    prisma.draftPick.findMany({
      where: { leagueId, used: true, playerId: { not: null } },
      select: { round: true, ownerTeamId: true, player: { select: { trueOvr: true } } },
    }),
    prisma.capCharge.findMany({ where: { teamId: { in: teamIds } }, select: { teamId: true, year: true, amount: true } }),
    prisma.transaction.findMany({ where: { leagueId, type: { in: AWARD_TYPES } }, select: { teamId: true } }),
    prisma.leagueRecord.findMany({ where: { leagueId }, select: { teamAbbr: true } }),
  ]);

  const byTeam = new Map<string, TeamAgg>();
  const agg = (id: string): TeamAgg => {
    let t = byTeam.get(id);
    if (!t) {
      t = { wins: 0, losses: 0, tenureYears: 0, championships: 0, runnerUps: 0, nonChampPlayoffs: 0, draftHits: 0, draftTotal: 0, deadMoneyByYear: new Map(), awards: 0 };
      byTeam.set(id, t);
    }
    return t;
  };

  for (const s of seasons) {
    const t = agg(s.teamId);
    t.wins += s.wins; t.losses += s.losses; t.tenureYears += 1;
    if (s.playoffResult === 'CHAMPION') t.championships++;
    else if (s.playoffResult === 'RUNNER_UP') t.runnerUps++;
    else if (s.playoffResult !== 'MISSED') t.nonChampPlayoffs++;
  }
  for (const dp of draftPicks) {
    const t = agg(dp.ownerTeamId);
    t.draftTotal++;
    if (dp.player && dp.player.trueOvr >= hitThreshold(dp.round)) t.draftHits++;
  }
  for (const c of capCharges) {
    agg(c.teamId).deadMoneyByYear.set(c.year, (agg(c.teamId).deadMoneyByYear.get(c.year) ?? 0) + c.amount);
  }
  for (const a of awardTx) {
    if (a.teamId) agg(a.teamId).awards++;
  }
  const recordsByAbbr = new Map<string, number>();
  for (const r of leagueRecords) recordsByAbbr.set(r.teamAbbr, (recordsByAbbr.get(r.teamAbbr) ?? 0) + 1);

  const entries: DynastyScoreEntry[] = teams.map((team) => {
    const t = byTeam.get(team.id);
    const breakdown: { label: string; points: number }[] = [];
    let score = 0;
    const add = (label: string, points: number) => {
      const rounded = Math.round(points);
      if (rounded === 0) return;
      score += rounded;
      breakdown.push({ label, points: rounded });
    };

    if (t) {
      if (t.championships > 0) add(`${t.championships} championship${t.championships === 1 ? '' : 's'}`, t.championships * 25);
      if (t.runnerUps > 0) add(`${t.runnerUps} runner-up finish${t.runnerUps === 1 ? '' : 'es'}`, t.runnerUps * 10);
      if (t.nonChampPlayoffs > 0) add(`${t.nonChampPlayoffs} other playoff trip${t.nonChampPlayoffs === 1 ? '' : 's'}`, t.nonChampPlayoffs * 5);

      const games = t.wins + t.losses;
      if (games > 0) {
        const winPct = t.wins / games;
        add('Winning percentage', clamp((winPct - 0.5) * 40, -10, 20));
      }
      if (t.draftTotal >= 5) {
        add('Draft hit rate', (t.draftHits / t.draftTotal) * 20);
      }
      if (t.tenureYears > 0) {
        const avgDead = [...t.deadMoneyByYear.values()].reduce((a, b) => a + b, 0) / t.tenureYears;
        add('Cap management', clamp(10 - avgDead / 1_500_000, 0, 10));
      }
      if (t.awards > 0) add(`${t.awards} major award${t.awards === 1 ? '' : 's'}`, t.awards * 3);
    }
    const recordsHeld = recordsByAbbr.get(team.abbr) ?? 0;
    if (recordsHeld > 0) add(`${recordsHeld} league record${recordsHeld === 1 ? '' : 's'} held`, recordsHeld * 5);

    breakdown.sort((a, b) => b.points - a.points);
    return { teamId: team.id, teamAbbr: team.abbr, teamName: `${team.city} ${team.nickname}`, isUser: team.isUser, score, breakdown };
  });

  return entries.sort((a, b) => b.score - a.score);
}
