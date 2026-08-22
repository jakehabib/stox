import { prisma } from './db';
// Imported, never re-listed here: this file and lib/dynasty.ts once held two
// separate copies of the same five strings, which is how a new trophy gets
// counted on the Dynasty screen and silently missed by this leaderboard.
// Retired types are in the list on purpose — an old award is still an award
// in the club's cabinet. See lib/awardTypes.ts.
import { AWARD_TYPES } from './awardTypes';

/**
 * ===========================================================================
 * DYNASTY SCORE — A FRANCHISE FIGURE, NOT A GM FIGURE
 * ===========================================================================
 * One aggregate number per FRANCHISE, rolling up everything the Ring of
 * Honor page otherwise shows piecemeal — championships, playoff depth,
 * win rate, draft success, cap discipline, awards, and league records
 * held — into a single ranked leaderboard across every team in the
 * league, not just the user's.
 *
 * THE SPAN IS THE CLUB'S ENTIRE BOOK. Every season in TeamSeasonRecord and
 * every award in the transaction feed counts, including the two decades of
 * invented backstory league creation seeds before the save begins
 * (lib/gen/leagueHistory.ts). That is deliberate and it is the correct answer
 * to the question this leaderboard asks: it ranks 32 clubs against each
 * other, 31 of which have never had a human GM at all, and a trophy in a
 * club's cabinet is the club's however long ago it was won.
 *
 * IT IS NOT A GRADE OF THE MAN IN THE CHAIR, and must never be printed as
 * one. His record is bounded to his hire year — resolveStartYear() in
 * lib/leagueYear.ts, the one definition of when he took the job, used by
 * lib/gmCareer.ts (buildGmCareerSummary) and by the Dynasty level in
 * lib/dynasty.ts (buildDynastyState). Those are the numbers that answer
 * "how good has THIS GM been"; this one answers "how good is this club".
 *
 * Confusing the two is not hypothetical: on a nine-season tenure that went
 * 34-119 without a single title, this score read 94 with "1 championship"
 * itemised beside it — a ring won in 2012, fourteen years before that GM was
 * hired, by a front office he never met. So every entry carries `firstSeason`
 * and `seasons`, and any surface that renders a row must say on screen what
 * span it is showing, especially the row it flags as the user's.
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

export interface DynastyScoreEntry {
  teamId: string;
  teamAbbr: string;
  teamName: string;
  /** True for the club the user runs. It does NOT make `score` his score — see the file header. */
  isUser: boolean;
  /** The franchise's score across every season below. */
  score: number;
  breakdown: { label: string; points: number }[];
  /** Completed seasons on the club's books, seeded backstory included. */
  seasons: number;
  /** Earliest season counted, so a screen can state the span it is showing. Null with no history at all. */
  firstSeason: number | null;
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
  // `seasonsOnRecord`, not "tenure" — these are the FRANCHISE's seasons, most
  // of them played before any user existed. Naming it tenure is how a club
  // number starts getting read as a GM number.
  wins: number; losses: number; seasonsOnRecord: number; firstSeason: number | null;
  championships: number; runnerUps: number; nonChampPlayoffs: number;
  draftHits: number; draftTotal: number;
  deadMoneyByYear: Map<number, number>;
  awards: number;
}

export async function buildDynastyLeaderboard(leagueId: string): Promise<DynastyScoreEntry[]> {
  const teams = await prisma.team.findMany({ where: { leagueId } });
  const teamIds = teams.map((t) => t.id);

  const [seasons, draftPicks, capCharges, awardTx, leagueRecords] = await Promise.all([
    prisma.teamSeasonRecord.findMany({ where: { leagueId }, select: { teamId: true, year: true, wins: true, losses: true, playoffResult: true } }),
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
      t = { wins: 0, losses: 0, seasonsOnRecord: 0, firstSeason: null, championships: 0, runnerUps: 0, nonChampPlayoffs: 0, draftHits: 0, draftTotal: 0, deadMoneyByYear: new Map(), awards: 0 };
      byTeam.set(id, t);
    }
    return t;
  };

  for (const s of seasons) {
    const t = agg(s.teamId);
    t.wins += s.wins; t.losses += s.losses; t.seasonsOnRecord += 1;
    if (t.firstSeason === null || s.year < t.firstSeason) t.firstSeason = s.year;
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
      // Averaged over the years the cap ledger actually covers, not over the
      // franchise's whole history. lib/season.ts's expireStaleCapCharges
      // deletes every charge dated before the current season, so CapCharge is
      // a live sheet a season or two deep — never a record of the 1990s.
      // Dividing that by thirty-odd seasons of backstory made the average
      // vanish and handed all 32 clubs a near-perfect cap mark, so a line the
      // page advertises as part of the ranking did no ranking at all. A club
      // with no charges on the books has a clean sheet and keeps the full ten.
      if (t.seasonsOnRecord > 0) {
        const deadYears = t.deadMoneyByYear.size;
        const avgDead = deadYears > 0
          ? [...t.deadMoneyByYear.values()].reduce((a, b) => a + b, 0) / deadYears
          : 0;
        add('Cap management', clamp(10 - avgDead / 1_500_000, 0, 10));
      }
      if (t.awards > 0) add(`${t.awards} major award${t.awards === 1 ? '' : 's'}`, t.awards * 3);
    }
    const recordsHeld = recordsByAbbr.get(team.abbr) ?? 0;
    if (recordsHeld > 0) add(`${recordsHeld} league record${recordsHeld === 1 ? '' : 's'} held`, recordsHeld * 5);

    breakdown.sort((a, b) => b.points - a.points);
    return {
      teamId: team.id, teamAbbr: team.abbr, teamName: `${team.city} ${team.nickname}`,
      isUser: team.isUser, score, breakdown,
      seasons: t?.seasonsOnRecord ?? 0, firstSeason: t?.firstSeason ?? null,
    };
  });

  return entries.sort((a, b) => b.score - a.score);
}
