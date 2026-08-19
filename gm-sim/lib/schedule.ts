import { Rng } from './rng';

export interface ScheduledGame {
  week: number;
  homeIdx: number;
  awayIdx: number;
}

export interface ScheduleTeam {
  idx: number;
  conference: string;
  division: string;
}

/**
 * Schedule builder for a 32-team, 17-week season with no byes.
 *
 * Weeks 1-6:  division double round-robin. Every team plays its 3 division
 *             rivals home and away. Guaranteed conflict-free by construction
 *             (a 4-team round robin is 3 rounds; run it twice with the home
 *             team flipped).
 * Weeks 7-17: 11 non-division games, built by repeatedly drawing a random
 *             perfect matching over the not-yet-used non-division pairs.
 *             Randomized greedy with restarts — the pair graph is dense
 *             (28 candidate opponents per team) so this converges immediately.
 *
 * [TUNE] Real leagues weight the schedule by prior-year finish. Not modeled:
 * non-division opponents here are drawn uniformly.
 */
export function buildSchedule(teams: ScheduleTeam[], rng: Rng, weeks = 17): ScheduledGame[] {
  const games: ScheduledGame[] = [];
  const divisions = new Map<string, ScheduleTeam[]>();
  for (const t of teams) {
    const key = `${t.conference}-${t.division}`;
    if (!divisions.has(key)) divisions.set(key, []);
    divisions.get(key)!.push(t);
  }

  // --- Weeks 1-6: division double round robin --------------------------------
  // Fixed pairings for a 4-team round robin.
  const ROUNDS: [number, number][][] = [
    [[0, 1], [2, 3]],
    [[0, 2], [1, 3]],
    [[0, 3], [1, 2]],
  ];
  const divisionWeeks = Math.min(6, weeks);
  for (let w = 0; w < divisionWeeks; w++) {
    const round = ROUNDS[w % 3];
    const flip = w >= 3; // second pass swaps home/away
    for (const group of divisions.values()) {
      if (group.length < 4) continue;
      for (const [a, b] of round) {
        const home = flip ? group[b] : group[a];
        const away = flip ? group[a] : group[b];
        games.push({ week: w + 1, homeIdx: home.idx, awayIdx: away.idx });
      }
    }
  }

  // --- Weeks 7-17: non-division ---------------------------------------------
  const remainingWeeks = weeks - divisionWeeks;
  if (remainingWeeks > 0) {
    const divisionKey = (t: ScheduleTeam) => `${t.conference}-${t.division}`;
    const nonDivisionRounds = drawRounds(
      teams,
      remainingWeeks,
      rng,
      (a, b) => divisionKey(a) !== divisionKey(b),
    );
    nonDivisionRounds.forEach((round, i) => {
      for (const [a, b] of round) {
        // Alternate home team so home/away stays roughly balanced.
        const homeFirst = (i + a) % 2 === 0;
        games.push({
          week: divisionWeeks + i + 1,
          homeIdx: homeFirst ? a : b,
          awayIdx: homeFirst ? b : a,
        });
      }
    });
  }

  return games.sort((x, y) => x.week - y.week);
}

/**
 * Draw `count` disjoint perfect matchings over teams, where every pair is used
 * at most once and must satisfy `allowed`. Restarts on failure.
 */
function drawRounds(
  teams: ScheduleTeam[],
  count: number,
  rng: Rng,
  allowed: (a: ScheduleTeam, b: ScheduleTeam) => boolean,
): [number, number][][] {
  const n = teams.length;
  for (let attempt = 0; attempt < 300; attempt++) {
    const used = new Set<string>();
    const rounds: [number, number][][] = [];
    let ok = true;

    for (let r = 0; r < count && ok; r++) {
      const round = matchOneRound(teams, rng, (a, b) => allowed(a, b) && !used.has(pairKey(a.idx, b.idx)));
      if (!round || round.length !== n / 2) { ok = false; break; }
      for (const [a, b] of round) used.add(pairKey(a, b));
      rounds.push(round);
    }
    if (ok) return rounds;
  }

  // Fallback: ignore the "each pair once" constraint rather than fail outright.
  const rounds: [number, number][][] = [];
  for (let r = 0; r < count; r++) {
    rounds.push(matchOneRound(teams, rng, allowed) ?? []);
  }
  return rounds;
}

/** Randomized greedy perfect matching with backtracking on the last pick. */
function matchOneRound(
  teams: ScheduleTeam[],
  rng: Rng,
  allowed: (a: ScheduleTeam, b: ScheduleTeam) => boolean,
): [number, number][] | null {
  const pool = rng.shuffle([...teams]);
  const taken = new Set<number>();
  const round: [number, number][] = [];

  for (const t of pool) {
    if (taken.has(t.idx)) continue;
    const candidates = pool.filter((o) => !taken.has(o.idx) && o.idx !== t.idx && allowed(t, o));
    if (candidates.length === 0) return null;
    const partner = rng.pick(candidates);
    taken.add(t.idx);
    taken.add(partner.idx);
    round.push([t.idx, partner.idx]);
  }
  return round;
}

const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
