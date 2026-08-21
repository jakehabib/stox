/**
 * Display-only analytics for the Cap and Stats "Advanced" views.
 *
 * Nothing here feeds the simulation, the AI, or any stored value — these are
 * read-only derivations over data the game already produced, the same way a
 * real front office's analytics department works off the box score rather
 * than changing what happened on the field.
 */

export interface PythagoreanRow {
  teamId: string;
  name: string;
  abbr: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Win% the point differential "should" have produced. */
  expectedWinPct: number;
  /** Expected wins over the games actually played. */
  expectedWins: number;
  /** actual wins − expected wins. Positive = winning more than the scoring says. */
  luck: number;
  isUser: boolean;
}

/**
 * Pythagorean expectation — the classic sports-analytics estimate of the
 * win rate a team's scoring "deserves", independent of how the wins actually
 * fell. The exponent is the football-tuned 2.37 (Football Outsiders' fit for
 * the NFL), not baseball's 2.
 *
 * A team well above its expectation has been winning close games; one below
 * has been losing them. Neither is predictive on its own — that's the point
 * of showing it next to the real record.
 */
export function pythagorean(pointsFor: number, pointsAgainst: number): number {
  const EXP = 2.37;
  if (pointsFor <= 0 && pointsAgainst <= 0) return 0.5;
  const pf = Math.pow(Math.max(0, pointsFor), EXP);
  const pa = Math.pow(Math.max(0, pointsAgainst), EXP);
  if (pf + pa === 0) return 0.5;
  return pf / (pf + pa);
}

export function buildPythagoreanTable(
  teams: { id: string; city: string; nickname: string; abbr: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgnst: number }[],
  userTeamId?: string,
): PythagoreanRow[] {
  return teams
    .map((t) => {
      const played = t.wins + t.losses + t.ties;
      const expectedWinPct = pythagorean(t.pointsFor, t.pointsAgnst);
      const expectedWins = expectedWinPct * played;
      // Ties count as half a win on both sides of the comparison so the
      // luck figure stays honest in a league that allows them.
      const actualWins = t.wins + t.ties * 0.5;
      return {
        teamId: t.id,
        name: `${t.city} ${t.nickname}`,
        abbr: t.abbr,
        wins: t.wins,
        losses: t.losses,
        ties: t.ties,
        pointsFor: t.pointsFor,
        pointsAgainst: t.pointsAgnst,
        expectedWinPct,
        expectedWins,
        luck: actualWins - expectedWins,
        isUser: t.id === userTeamId,
      };
    })
    .filter((r) => r.wins + r.losses + r.ties > 0)
    .sort((a, b) => b.luck - a.luck);
}

/**
 * Strength of schedule — the combined win rate of every opponent a team has
 * actually played, weighted by how often they played them. Uses opponents'
 * full-season records (the standard "opponent win %" definition), so it
 * reflects who you played, not when.
 */
export function strengthOfSchedule(
  teamId: string,
  games: { homeTeamId: string; awayTeamId: string; played: boolean }[],
  recordById: Map<string, { wins: number; losses: number; ties: number }>,
): { sos: number; opponents: number } {
  let total = 0;
  let count = 0;
  for (const g of games) {
    if (!g.played) continue;
    const oppId = g.homeTeamId === teamId ? g.awayTeamId : g.homeTeamId === teamId || g.awayTeamId === teamId ? g.homeTeamId : null;
    if (!oppId) continue;
    const rec = recordById.get(oppId);
    if (!rec) continue;
    const gp = rec.wins + rec.losses + rec.ties;
    if (gp === 0) continue;
    total += (rec.wins + rec.ties * 0.5) / gp;
    count++;
  }
  return { sos: count > 0 ? total / count : 0, opponents: count };
}

export interface CapHealth {
  /** Share of committed cap held by the five largest cap hits. */
  topFiveShare: number;
  /** Roster age weighted by cap dollars — "how old is the money", not the roster. */
  capWeightedAge: number;
  /** Plain unweighted average age, for contrast with the above. */
  rosterAvgAge: number;
  /** Dead money as a share of the total cap. */
  deadShare: number;
  /** Cap dollars committed to next season as a share of NEXT season's cap. */
  nextYearCommittedShare: number;
  /** Players under contract beyond this season. */
  playersUnderContractNextYear: number;
}

export function buildCapHealth(input: {
  rows: { age: number; hit: number; yearsRemaining: number; nextYearHit: number }[];
  capUsed: number;
  capTotal: number;
  /**
   * Next season's ceiling. The cap grows every year (CAP.CAP_GROWTH_PER_YEAR),
   * so measuring next year's commitments against THIS year's ceiling
   * overstates the squeeze by the growth rate. Optional so a caller that
   * genuinely only has the current figure still gets the old behaviour.
   */
  nextYearCapTotal?: number;
  deadMoney: number;
}): CapHealth {
  const { rows, capUsed, capTotal, deadMoney } = input;
  const nextYearCap = input.nextYearCapTotal ?? capTotal;
  const hits = rows.map((r) => r.hit).sort((a, b) => b - a);
  const topFive = hits.slice(0, 5).reduce((s, v) => s + v, 0);
  const totalHit = hits.reduce((s, v) => s + v, 0);
  const dollarWeighted = totalHit > 0
    ? rows.reduce((s, r) => s + r.age * r.hit, 0) / totalHit
    : 0;
  const nextYear = rows.reduce((s, r) => s + (r.yearsRemaining > 1 ? r.nextYearHit : 0), 0);

  return {
    topFiveShare: capUsed > 0 ? topFive / capUsed : 0,
    capWeightedAge: dollarWeighted,
    rosterAvgAge: rows.length > 0 ? rows.reduce((s, r) => s + r.age, 0) / rows.length : 0,
    deadShare: capTotal > 0 ? deadMoney / capTotal : 0,
    nextYearCommittedShare: nextYearCap > 0 ? nextYear / nextYearCap : 0,
    playersUnderContractNextYear: rows.filter((r) => r.yearsRemaining > 1).length,
  };
}

/**
 * A deviation only counts as a real bargain/overpay once it clears BOTH a
 * percentage-of-value bar and a flat dollar floor. Percentage alone would
 * flag a $15K miss on a $30M QB deal as an "overpay" — noise in a league
 * with a $255M cap (see CAP.BASE_CAP). Dollar-floor alone would flag a
 * minimum-salary punter for being paid double his going rate, which still
 * isn't a number that moves a roster. Requiring both means the threshold
 * scales with the player's own value while staying anchored to what
 * actually matters on a real cap sheet.
 */
export const CONTRACT_VALUE_MATERIAL_PCT = 0.12;
export const CONTRACT_VALUE_MATERIAL_FLOOR = 1_000_000;

export type ContractValueTier = 'bargain' | 'market' | 'overpay';

/** market − cap hit, classified against the material-deviation band above. */
export function classifyContractValue(surplus: number, marketValue: number): ContractValueTier {
  const threshold = Math.max(marketValue * CONTRACT_VALUE_MATERIAL_PCT, CONTRACT_VALUE_MATERIAL_FLOOR);
  if (surplus >= threshold) return 'bargain';
  if (surplus <= -threshold) return 'overpay';
  return 'market';
}

export interface SurplusRow {
  playerId: string;
  name: string;
  position: string;
  age: number;
  ovr: number;
  hit: number;
  marketValue: number;
  /** market − cap hit. Positive = paying under what the rating is worth. */
  surplus: number;
  tier: ContractValueTier;
}

/** Ranked contract value — the bargains and the overpays, by absolute dollars. Market-rate deals are excluded from both lists. */
export function rankContractValue(rows: SurplusRow[]): { bargains: SurplusRow[]; overpays: SurplusRow[] } {
  const sorted = [...rows].sort((a, b) => b.surplus - a.surplus);
  return {
    bargains: sorted.filter((r) => r.tier === 'bargain').slice(0, 6),
    overpays: sorted.filter((r) => r.tier === 'overpay').slice(-6).reverse(),
  };
}
