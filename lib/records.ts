import { prisma } from './db';
import { SeasonStats } from './types';

/**
 * ===========================================================================
 * LEAGUE RECORDS
 * ===========================================================================
 * Single-season and career statistical highs, checked once per season during
 * the offseason stats rollover (lib/season.ts rollSeasonStatsIntoCareer) —
 * right when a season's final SeasonStats line and the freshly-updated
 * CareerStats total are both in hand for every player who recorded a stat.
 * One row per (scope, category) in LeagueRecord — the current holder, not
 * a full history of every prior record. Same category set as the league
 * leaderboards on the Stats page, for consistency.
 * ===========================================================================
 */
export const RECORD_CATEGORIES = ['passYds', 'passTd', 'rushYds', 'recYds', 'tackles', 'sacks', 'defInt'] as const;
export type RecordCategory = (typeof RECORD_CATEGORIES)[number];

export interface RecordBreak {
  scope: 'SEASON' | 'CAREER';
  category: RecordCategory;
  value: number;
  playerId: string;
  playerName: string;
  teamAbbr: string;
}

/**
 * Compares this season's final stat line and updated career total for every
 * player who recorded anything against the current record holders, updates
 * LeagueRecord for anything broken, and returns the list of breaks so the
 * caller can announce them (see recordBreakHeadline below).
 */
export async function checkAndUpdateRecords(
  leagueId: string,
  seasonYear: number,
  players: { id: string; firstName: string; lastName: string; teamAbbr: string; seasonFinal: SeasonStats; careerFinal: SeasonStats }[],
): Promise<RecordBreak[]> {
  const existing = await prisma.leagueRecord.findMany({ where: { leagueId } });
  const byKey = new Map(existing.map((r) => [`${r.scope}:${r.category}`, r]));

  const candidates: RecordBreak[] = [];
  for (const p of players) {
    for (const cat of RECORD_CATEGORIES) {
      const seasonVal = p.seasonFinal[cat] ?? 0;
      if (seasonVal > 0) {
        const cur = byKey.get(`SEASON:${cat}`);
        if (!cur || seasonVal > cur.value) {
          candidates.push({ scope: 'SEASON', category: cat, value: seasonVal, playerId: p.id, playerName: `${p.firstName} ${p.lastName}`, teamAbbr: p.teamAbbr });
        }
      }
      const careerVal = p.careerFinal[cat] ?? 0;
      if (careerVal > 0) {
        const cur = byKey.get(`CAREER:${cat}`);
        if (!cur || careerVal > cur.value) {
          candidates.push({ scope: 'CAREER', category: cat, value: careerVal, playerId: p.id, playerName: `${p.firstName} ${p.lastName}`, teamAbbr: p.teamAbbr });
        }
      }
    }
  }

  // Multiple players can beat the same still-unset record in the same
  // batch (year one, everyone's season total is technically a "record") —
  // keep only the best per (scope, category) before writing.
  const winners = new Map<string, RecordBreak>();
  for (const b of candidates) {
    const key = `${b.scope}:${b.category}`;
    const cur = winners.get(key);
    if (!cur || b.value > cur.value) winners.set(key, b);
  }

  // Only a genuine BREAK — an existing record actually surpassed — is
  // newsworthy. The very first time a category gets any value at all isn't
  // "breaking a record," it's just the first data point; announcing every
  // stat category as a record in the league's first season would flood the
  // news feed with noise. Still persist those first-time values (so future
  // seasons have something real to compare against), just don't announce them.
  const announced: RecordBreak[] = [];
  for (const [key, b] of winners) {
    if (byKey.has(key)) announced.push(b);
    await prisma.leagueRecord.upsert({
      where: { leagueId_scope_category: { leagueId, scope: b.scope, category: b.category } },
      create: { leagueId, scope: b.scope, category: b.category, value: b.value, playerId: b.playerId, playerName: b.playerName, teamAbbr: b.teamAbbr, seasonYear },
      update: { value: b.value, playerId: b.playerId, playerName: b.playerName, teamAbbr: b.teamAbbr, seasonYear },
    });
  }

  return announced;
}

const CATEGORY_LABEL: Record<RecordCategory, string> = {
  passYds: 'passing yards', passTd: 'passing touchdowns', rushYds: 'rushing yards',
  recYds: 'receiving yards', tackles: 'tackles', sacks: 'sacks', defInt: 'interceptions',
};

export function recordBreakHeadline(b: RecordBreak): string {
  const scopeLabel = b.scope === 'SEASON' ? 'single-season' : 'career';
  return `${b.playerName} (${b.teamAbbr}) sets the league ${scopeLabel} record for ${CATEGORY_LABEL[b.category]} — ${b.value.toLocaleString()}`;
}
