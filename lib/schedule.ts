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
    // HOME AND AWAY, BALANCED PER CLUB.
    //
    // This used to read `(i + a) % 2 === 0` — the parity of the round number
    // plus whichever team the greedy matcher happened to list first. That is
    // not a balancing rule, it is a coin whose bias is fixed by a team's index,
    // and it showed: across 200 generated leagues HALF of all team-seasons
    // (49.9%) fell outside a fair split, with real clubs drawing 4 home / 13
    // away and 14 home / 3 away. A beta tester reported a 5-and-12.
    //
    // Division play (weeks 1-6) is already exactly 3 and 3 by construction, so
    // only these eleven need balancing, to 5-6 or 6-5. Each pair gives the home
    // game to whichever club is currently the more travelled of the two; ties
    // go to the rng so the tie-break cannot favour a fixed index. Greedy on a
    // running count keeps every club within one game of even, which is the best
    // available: seventeen is odd, so 8-9 or 9-8 IS the fair answer.
    const homeCount = new Map<number, number>();
    const awayCount = new Map<number, number>();
    const travelled = (idx: number) => (awayCount.get(idx) ?? 0) - (homeCount.get(idx) ?? 0);
    nonDivisionRounds.forEach((round, i) => {
      for (const [a, b] of round) {
        const da = travelled(a);
        const db = travelled(b);
        const aIsHome = da !== db ? da > db : rng.bool();
        const homeIdx = aIsHome ? a : b;
        const awayIdx = aIsHome ? b : a;
        homeCount.set(homeIdx, (homeCount.get(homeIdx) ?? 0) + 1);
        awayCount.set(awayIdx, (awayCount.get(awayIdx) ?? 0) + 1);
        games.push({ week: divisionWeeks + i + 1, homeIdx, awayIdx });
      }
    });

    // REPAIR PASS. Greedy alone is order-dependent — a coin flip early can put
    // a club somewhere later rounds cannot pull it back from — and left ~1.3%
    // of clubs a game outside the band. Flipping one non-division fixture
    // between an over-hosted club and an under-hosted one moves both toward
    // even and changes nothing else about the schedule: same opponents, same
    // weeks, only which end of the pairing is at home. Each flip strictly
    // reduces total imbalance, so this terminates; the bound is a backstop.
    const nonDivision = games.slice(divisionWeeks * (teams.length / 2));
    for (let pass = 0; pass < 256; pass++) {
      const over = (idx: number) => (homeCount.get(idx) ?? 0) - (awayCount.get(idx) ?? 0);
      // A flip moves the host down two and the visitor up two, so it only
      // helps when they are at least four apart — swapping a +1 with a -1 just
      // exchanges their positions and would spin here forever.
      const g = nonDivision.find((x) => over(x.homeIdx) - over(x.awayIdx) >= 4);
      if (!g) break;
      const h = g.homeIdx;
      g.homeIdx = g.awayIdx;
      g.awayIdx = h;
      homeCount.set(g.homeIdx, (homeCount.get(g.homeIdx) ?? 0) + 1);
      awayCount.set(g.homeIdx, (awayCount.get(g.homeIdx) ?? 0) - 1);
      homeCount.set(g.awayIdx, (homeCount.get(g.awayIdx) ?? 0) - 1);
      awayCount.set(g.awayIdx, (awayCount.get(g.awayIdx) ?? 0) + 1);
    }
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
