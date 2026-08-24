import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { Rng, clamp } from './rng';
import { Position, PROGRESSION, FREE_AGENCY } from './tuning';
import { AttrMap } from './ratings';
import { progressPlayer, bumpForMilestone, retirementChance, ceilingRevision } from './progression';
import { readJson, writeJson } from './json';
import { SeasonStats } from './types';
import { offensiveScore, defensiveScore, DEFENSIVE_POSITIONS } from './awards';
import { loadDevSpeedMult } from './dynasty';

/**
 * ===========================================================================
 * IN-SEASON PLAYER DEVELOPMENT
 * ===========================================================================
 * Growth used to land in one lump at the offseason PROGRESS step — realistic
 * for a career arc, but invisible week to week. Every few games (see
 * PROGRESSION.CHECKPOINT_INTERVAL in lib/tuning.ts) this instead:
 *   1. Applies a scaled-down version of the normal age-curve growth roll —
 *      spread across a season the total is the same as the old single roll.
 *   2. Nudges that roll up or down by how a player is actually performing
 *      against others at his own position this year.
 *   3. Hands a real, deliberate bump — to both current rating and the
 *      potential ceiling — to whoever is currently pacing the league in a
 *      marquee stat category, with a news item marking the moment.
 *   4. Slows the whole roll for a man who is not playing — see `roleIndex`
 *      below. A fourth receiver develops slower than a starter, which is the
 *      one thing "career backups develop slower" actually means, and it is
 *      the only thing playing time is allowed to do.
 *   5. ONCE A YEAR, at the last regular-season checkpoint, revises the
 *      POTENTIAL CEILING itself — up for a man producing past what he is
 *      rated, down for one producing under it. See the long note on
 *      ceilingRevision in lib/progression.ts; the summary is that a ceiling
 *      used to be write-once-upward and a player could therefore never bust.
 * Season awards (lib/awards.ts) apply the same kind of deliberate bump at a
 * larger size once the year is over — see recordSeasonAwards in lib/season.ts.
 * ===========================================================================
 */

const STAT_LEADER_CATEGORIES: { key: keyof SeasonStats; label: string }[] = [
  { key: 'passYds', label: 'passing yards' },
  { key: 'passTd', label: 'passing touchdowns' },
  { key: 'rushYds', label: 'rushing yards' },
  { key: 'recYds', label: 'receiving yards' },
  { key: 'tackles', label: 'tackles' },
  { key: 'sacks', label: 'sacks' },
  { key: 'defInt', label: 'interceptions' },
];

/**
 * ===========================================================================
 * PLAYING TIME — THE THING THIS CHECKPOINT COULD NOT SEE
 * ===========================================================================
 * `checkpointShare` below is a share of the SEASON, not a share of the snaps.
 * Until this existed nothing in the development path knew whether a man had
 * played a down: a fourth receiver and the league's leading one rolled the
 * same growth off the same age curve, and "career backups develop slower" was
 * simply not implemented anywhere.
 *
 * There are no snap counts in this simulation, so the honest proxy is the
 * VOLUME a position is credited with, per position, out of what his own club
 * spent there. Attempts, carries, targets, tackles, kicks — opportunity, not
 * production, so a man who plays badly and a man who plays well have the same
 * role and only the ceiling pass below can tell them apart.
 *
 * POSITIONS THE BOX SCORE DOES NOT NAME GET `null`, NOT ZERO. `allocateStats`
 * (lib/sim/engine.ts) writes a line for the quarterback, three backs, six
 * receivers, fourteen defenders and the two specialists — and for nobody on
 * the offensive line, ever. An offensive lineman's opportunity is therefore
 * unknown, and unknown has to read as unknown: scoring it 0 would tell the
 * model every starting left tackle in the league is a healthy scratch. `null`
 * means no growth penalty and no ceiling revision in either direction, which
 * is the correct answer for a position this sim records nothing about.
 */
const DEF_OPPORTUNITY = (s: SeasonStats): number =>
  (s.tackles ?? 0) + (s.pd ?? 0) + (s.sacks ?? 0) + (s.defInt ?? 0) + (s.ff ?? 0);

const OPPORTUNITY: Record<string, (s: SeasonStats) => number> = {
  QB: (s) => (s.passAtt ?? 0) + (s.rushAtt ?? 0),
  RB: (s) => (s.rushAtt ?? 0) + (s.targets ?? 0),
  WR: (s) => s.targets ?? 0,
  TE: (s) => s.targets ?? 0,
  EDGE: DEF_OPPORTUNITY,
  DT: DEF_OPPORTUNITY,
  LB: DEF_OPPORTUNITY,
  CB: DEF_OPPORTUNITY,
  S: DEF_OPPORTUNITY,
  K: (s) => (s.fga ?? 0) + (s.xpa ?? 0),
  P: (s) => s.punts ?? 0,
};

/** Volume that means "he was on the field", or null where this sim records none. */
export function positionOpportunity(position: string, s: SeasonStats): number | null {
  const of = OPPORTUNITY[position];
  return of ? of(s) : null;
}

/**
 * His share of his own club's work at his position, times the number of men
 * the club carries there — so 1.0 is an even split of the job whatever the
 * position's shape, a full-time starter is comfortably above it, and a healthy
 * scratch is 0. Normalising by the group size is what makes a quarterback (one
 * job, three men) and a receiver (four jobs, six men) readable on one scale.
 */
export function roleIndex(own: number, teamTotal: number, teammates: number): number | null {
  if (teamTotal <= 0 || teammates <= 0) return null;
  return (own / teamTotal) * teammates;
}

/**
 * How much of a normal growth roll a man with this much of a role gets.
 * Unknown role (offensive line) is exactly 1 — neutral, not penalised.
 *
 * THIS SLOWS GROWTH AND DOES NOTHING ELSE. It can never move a ceiling. Not
 * playing is not a failure to produce; it is an absence of evidence, and the
 * ceiling pass treats it as one.
 *
 * ---------------------------------------------------------------------------
 * A ROOKIE WHO SITS IS STILL LEARNING. A VETERAN WHO SITS IS NOT.
 * ---------------------------------------------------------------------------
 * `experience` is completed professional seasons, so 0 is his first year. In
 * that first year the floor under this is 70% of a full roll rather than 55%
 * — the app owner's own figures, for the case he named: *"idle players,
 * especially in their rookie year can still develop (like a backup QB sitting
 * behind a veteran)"*. A first-round quarterback who spends a season holding a
 * clipboard behind a starter is a real football path, and before this the game
 * charged him the same rate it charged a 29-year-old career backup.
 *
 * AND PLAYING STILL WINS, WHICH THE OWNER WAS EXPLICIT ABOUT: *"i still think
 * its fine to have a gap, play time shoudl equal faster results"*. The ladder
 * this produces, and it cannot invert:
 *
 *     full-time starter               1.00
 *     rookie who never plays          0.70
 *     second-year-plus who never      0.55
 *
 * Both figures are FLOORS under the same taper, and the taper only ever climbs
 * toward 1 as the role grows — so no rookie who sits can ever out-develop the
 * same rookie who plays. The rookie floor closes part of the gap; it can never
 * close it.
 */
export function playtimeGrowthMult(role: number | null, experience: number): number {
  if (role === null) return 1;
  // First professional season, whatever the round he came from or whether he
  // was drafted at all — an undrafted rookie learning behind a starter is the
  // same story as a first-rounder doing it.
  const penalty = experience <= 0
    ? PROGRESSION.PLAYTIME_GROWTH_PENALTY_ROOKIE
    : PROGRESSION.PLAYTIME_GROWTH_PENALTY;
  return 1 - penalty * Math.exp(-Math.max(0, role) / PROGRESSION.PLAYTIME_GROWTH_SCALE);
}

function ramp(v: number, lo: number, hi: number): number {
  if (hi <= lo) return v >= hi ? 1 : 0;
  return clamp((v - lo) / (hi - lo), 0, 1);
}

/**
 * How much of a real look the club got at him this year, 0..1. Both halves
 * matter and both are ramps rather than gates: a man in a thin role and a man
 * who missed eleven weeks have each shown you a fraction of a season, and a
 * fraction is what their season is worth against their projection.
 */
export function evidenceSample(role: number | null, gp: number): number {
  if (role === null) return 0;
  return ramp(role, PROGRESSION.CEILING_ROLE_FLOOR, PROGRESSION.CEILING_ROLE_FULL)
    * ramp(gp, PROGRESSION.CEILING_GP_FLOOR, PROGRESSION.CEILING_GP_FULL);
}

/**
 * ---------------------------------------------------------------------------
 * WHAT DOES A MAN OF HIS RATING USUALLY PRODUCE?
 * ---------------------------------------------------------------------------
 * The expectation a season is judged against, fitted from the league itself
 * every year rather than written down as a constant, because the answer moves
 * with the rules, the sim and the position.
 *
 * Least squares in standardised units: with `r` the correlation between rating
 * and production-per-game at this position this season, a man rated `zx`
 * standard deviations above his position's mean is EXPECTED to produce `r * zx`
 * above it, and the residual is divided by the spread that is left,
 * sqrt(1 - r^2). That last step is the one that matters. Comparing raw
 * percentile ranks — or assuming r = 1 — makes the highest-rated player at
 * every position structurally incapable of beating expectation, so the best
 * men in the league would erode every year for being the best. Regressing on
 * rating is unbiased at every point of the rating range, which is the only
 * property this has to have.
 *
 * `r` is capped below 1 (CEILING_MAX_R): rating never predicts production
 * perfectly, and an uncapped correlation divides by a vanishing spread and
 * turns rounding into evidence. Below CEILING_MIN_R the fit says rating did
 * not predict production at this position this year, so no expectation is
 * credible and the position is skipped entirely — including kickers and
 * punters, whose production `offensiveScore` scores as a flat zero.
 */
export function deliveryZScores(rows: { id: string; ovr: number; perGame: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  const n = rows.length;
  if (n < PROGRESSION.CEILING_MIN_GROUP) return out;

  let mx = 0, my = 0;
  for (const r of rows) { mx += r.ovr; my += r.perGame; }
  mx /= n; my /= n;

  let vx = 0, vy = 0, cov = 0;
  for (const r of rows) {
    const dx = r.ovr - mx, dy = r.perGame - my;
    vx += dx * dx; vy += dy * dy; cov += dx * dy;
  }
  const sx = Math.sqrt(vx / n), sy = Math.sqrt(vy / n);
  if (sx <= 0 || sy <= 0) return out;

  const corr = cov / (n * sx * sy);
  if (corr < PROGRESSION.CEILING_MIN_R) return out;
  const rr = Math.min(corr, PROGRESSION.CEILING_MAX_R);
  const spread = Math.sqrt(1 - rr * rr);

  for (const r of rows) {
    out.set(r.id, (((r.perGame - my) / sy) - rr * ((r.ovr - mx) / sx)) / spread);
  }
  return out;
}

/**
 * A float revision, applied to a column that holds whole points, WITHOUT
 * throwing away the fraction. Rounding a -0.4 season to zero every year would
 * make a slow slide impossible and leave only the cliffs; always rounding away
 * from zero would make one ordinary year cost a whole point.
 *
 * So the fraction is spent as the probability of the extra point, which makes
 * this an UNBIASED quantiser: the expected value of what lands in the column is
 * exactly the float the evidence produced. It is not a dice roll about whether
 * a player busts — the size and the sign are decided entirely by his
 * production, his role, his age and how much of his projection is unproven.
 * The only thing left to chance is which side of a whole point a fractional
 * answer falls on, and over a career those average out to the number itself.
 */
export function quantizeRevision(rng: Rng, delta: number): number {
  const whole = Math.floor(delta);
  const frac = delta - whole;
  return frac > 0 && rng.float(0, 1) < frac ? whole + 1 : whole;
}

function lastCheckpointBefore(week: number, interval: number): number {
  return Math.floor((week - 1) / interval) * interval;
}

/**
 * Share of a full year's growth to apply after this week's games — 0 if
 * `week` isn't a checkpoint. Fires every CHECKPOINT_INTERVAL weeks, plus the
 * final regular-season week itself (however many weeks that leftover window
 * covers) so no games go uncredited just because the season length isn't a
 * clean multiple of the interval.
 */
export function checkpointShare(week: number, seasonLength: number): number {
  const interval = PROGRESSION.CHECKPOINT_INTERVAL;
  const isCheckpoint = week % interval === 0 || week === seasonLength;
  if (!isCheckpoint) return 0;
  const weeksInWindow = week - lastCheckpointBefore(week, interval);
  if (weeksInWindow <= 0) return 0;
  return (weeksInWindow / interval) * PROGRESSION.CHECKPOINT_GROWTH_SHARE;
}

export async function applyInSeasonProgression(
  leagueId: string,
  seasonYear: number,
  week: number,
  seasonLength: number,
  rng: Rng,
  speed: number,
): Promise<void> {
  const share = checkpointShare(week, seasonLength);
  if (share <= 0) return;

  // ORDERED, and it has to be. The single `rng` below is consumed player by
  // player in this loop's order, so the order IS part of the seed: without an
  // ORDER BY, Postgres may hand back the same rows in a different sequence on
  // two runs and the "deterministic" checkpoint produces different football.
  // Found by running the same seed twice and getting two answers.
  const players = await prisma.player.findMany({ where: { leagueId, status: 'ACTIVE' }, orderBy: { id: 'asc' } });
  if (players.length === 0) return;

  // COACHING STAFF (Dynasty, DEVELOPMENT branch). The GM's own coaches, so it
  // applies to the GM's own roster and to nobody else's — a skill that sped up
  // all 32 clubs would be a no-op dressed as an upgrade. 1.0 with no ranks, so
  // a save that has never opened the Dynasty screen rolls exactly what it
  // rolled before this shipped.
  //
  // Fetched once per checkpoint, not per player: one indexed read.
  const [coachingMult, league] = await Promise.all([
    loadDevSpeedMult(leagueId),
    prisma.league.findUnique({ where: { id: leagueId }, select: { userTeamId: true } }),
  ]);
  const coachedTeamId = league?.userTeamId ?? null;

  // Regular season only — seasonStats is the regular-season bucket now (see
  // Player.seasonStats in the schema). Every checkpoint this function runs at
  // falls inside the regular season anyway, so the two were never going to
  // disagree; reading the regular bucket keeps it that way if a checkpoint is
  // ever moved.
  const statsById = new Map(players.map((p) => [p.id, readJson<SeasonStats>(p.seasonStats, {})]));

  // --- Performance tier: rank each player against others at his own
  // position by production-per-week so far. Positions with no tracked
  // individual production (offensive line) never get a nonzero rate, so
  // they fall out of ranking entirely and just get the base age-curve roll.
  const byPosition = new Map<string, typeof players>();
  for (const p of players) (byPosition.get(p.position) ?? byPosition.set(p.position, []).get(p.position)!).push(p);

  const tierById = new Map<string, 'breakout' | 'slump'>();
  for (const group of byPosition.values()) {
    const isDefensive = DEFENSIVE_POSITIONS.has(group[0].position);
    const rated = group
      .map((p) => ({
        id: p.id,
        trueOvr: p.trueOvr,
        rate: (isDefensive ? defensiveScore(statsById.get(p.id)!) : offensiveScore(statsById.get(p.id)!)) / week,
      }))
      .filter((p) => p.rate !== 0)
      .sort((a, b) => b.rate - a.rate);
    const n = rated.length;
    if (n < 4) continue; // sample too small at this position for rank to mean anything
    rated.forEach((p, i) => {
      const pct = i / n;
      if (pct < 0.15) tierById.set(p.id, 'breakout');
      else if (pct > 0.85 && p.trueOvr >= 72) tierById.set(p.id, 'slump');
    });
  }

  // --- Stat-leader milestone: whoever tops the league in a marquee category
  // right now gets flagged, once per player even if he leads several.
  const leaderCategoriesById = new Map<string, string[]>();
  for (const cat of STAT_LEADER_CATEGORIES) {
    let best: (typeof players)[number] | null = null;
    let bestVal = 0;
    for (const p of players) {
      const v = statsById.get(p.id)![cat.key] ?? 0;
      if (v > bestVal) { bestVal = v; best = p; }
    }
    if (best) {
      const list = leaderCategoriesById.get(best.id) ?? [];
      list.push(cat.label);
      leaderCategoriesById.set(best.id, list);
    }
  }

  // --- Role: what share of his own club's work at his position he took. See
  // the note above positionOpportunity. Computed every checkpoint (it feeds
  // the growth roll), and again at the last one where it also decides how much
  // a season is worth as evidence.
  const teamPosOpp = new Map<string, { total: number; men: number }>();
  const oppById = new Map<string, number | null>();
  for (const p of players) {
    const opp = positionOpportunity(p.position, statsById.get(p.id)!);
    oppById.set(p.id, opp);
    if (opp === null) continue;
    const key = `${p.teamId ?? '-'}|${p.position}`;
    const e = teamPosOpp.get(key) ?? { total: 0, men: 0 };
    e.total += opp;
    e.men += 1;
    teamPosOpp.set(key, e);
  }
  const roleById = new Map<string, number | null>();
  for (const p of players) {
    const opp = oppById.get(p.id) ?? null;
    if (opp === null) { roleById.set(p.id, null); continue; }
    const e = teamPosOpp.get(`${p.teamId ?? '-'}|${p.position}`)!;
    roleById.set(p.id, roleIndex(opp, e.total, e.men));
  }

  /*
   * ===========================================================================
   * ONCE A YEAR, THE FRONT OFFICE REVISES ITS PROJECTION
   * ===========================================================================
   * The last regular-season checkpoint is the only one that moves a ceiling,
   * and it is the right one: `seasonStats` is a completed season by the time
   * this runs (the week's games are simulated and saved before the checkpoint
   * fires — see advanceWeek in lib/season.ts), so the evidence is a full year
   * of football rather than a four-game snapshot. Running it at every
   * checkpoint would let one hot September move a career.
   *
   * A SEASON IS WORTH A FRACTION OF A POINT, DELIBERATELY. One bad year is
   * noise and barely moves anything. The pass runs every year of a career, so a
   * PATTERN moves it steadily — and because the revision is proportional to
   * what is left unproven, it decays as the ceiling comes down to meet the
   * player instead of running away from him. See ceilingRevision in
   * lib/progression.ts for the shape and for why the yardstick is his current
   * rating rather than his ceiling.
   */
  const seasonEnd = week === seasonLength;
  const revisionById = new Map<string, number>();
  const sampleById = new Map<string, number>();
  if (seasonEnd) {
    for (const p of players) {
      sampleById.set(p.id, evidenceSample(roleById.get(p.id) ?? null, statsById.get(p.id)!.gp ?? 0));
    }
    for (const group of byPosition.values()) {
      const isDefensive = DEFENSIVE_POSITIONS.has(group[0].position);
      // The expectation is fitted over the men who actually had a job. A
      // league-wide fit that included every healthy scratch would describe the
      // production of not playing, and every starter would beat it.
      const rows: { id: string; ovr: number; perGame: number }[] = [];
      for (const p of group) {
        const stats = statsById.get(p.id)!;
        const gp = stats.gp ?? 0;
        if (gp <= 0 || (sampleById.get(p.id) ?? 0) <= 0) continue;
        rows.push({
          id: p.id,
          ovr: p.trueOvr,
          perGame: (isDefensive ? defensiveScore(stats) : offensiveScore(stats)) / gp,
        });
      }
      const zs = deliveryZScores(rows);
      for (const p of group) {
        const z = zs.get(p.id);
        if (z === undefined) continue;
        const delta = ceilingRevision({
          deliveryZ: z,
          age: p.age,
          position: p.position as Position,
          potential: p.potential,
          ovr: p.trueOvr,
          sample: sampleById.get(p.id) ?? 0,
        });
        if (delta !== 0) revisionById.set(p.id, delta);
      }
    }
  }

  const updates: { id: string; attrs: string; ovr: number; potential: number }[] = [];
  const leaders: { id: string; name: string; categories: string[] }[] = [];
  const projections: { id: string; name: string; age: number; from: number; to: number }[] = [];

  for (const p of players) {
    const attrs = readJson<AttrMap>(p.trueAttrs, {});
    const tier = tierById.get(p.id);
    const perfMult = tier === 'breakout' ? PROGRESSION.BREAKOUT_GROWTH_MULT : tier === 'slump' ? PROGRESSION.SLUMP_GROWTH_MULT : 1;
    // DEAD CODE, KEPT DELIBERATELY AND DOCUMENTED HONESTLY.
    //
    // Player.devFocus was a per-player growth charge bought with "scouting
    // focus points". That currency was removed when the scouting economy was
    // cut, and nothing in this codebase has granted a charge since: there is
    // no increment, no assignment, no seed anywhere. devFocus is therefore 0
    // for every player in every save, focusMult is always exactly 1, and the
    // updateMany that decrements it below matches zero rows every checkpoint.
    //
    // The app owner has asked twice what devFocus does. The honest answer is
    // NOTHING, and it has done nothing since focus points were removed. It is
    // left in place rather than deleted because he asked for the answer before
    // deciding, and because dropping a column is the one change that cannot be
    // undone. Do not build on it without granting charges somewhere first.
    const focusMult = p.devFocus > 0 ? PROGRESSION.DEV_FOCUS_GROWTH_MULT : 1;
    // The GM's coaching staff multiplies the growth MEAN, which is what
    // progressPlayer's `speedMult` parameter already is — no second system,
    // and no invented "XP", because this game has no XP quantity to gain.
    const speedForPlayer = speed * (coachedTeamId && p.teamId === coachedTeamId ? coachingMult : 1);
    // Playing time slows the roll and nothing else — see playtimeGrowthMult.
    // `experience` rides through because a rookie who sits is still learning
    // and a fifth-year backup is not; the floor is 70% for him and 55% for the
    // rest, and a starter is whole either way.
    const playtimeMult = playtimeGrowthMult(roleById.get(p.id) ?? null, p.experience);

    // THE CEILING MOVES BEFORE THE ROLL DOES, so the same checkpoint that
    // revises a projection also grows him toward the revised one rather than
    // spending a year chasing a number the club has already given up on.
    const revision = revisionById.get(p.id) ?? 0;
    const applied = revision === 0 ? 0 : quantizeRevision(rng, revision);
    // 1..99 is the column's own documented range (Player.potential), not a
    // policy floor: erosion is proportional to `potential - trueOvr` and so
    // approaches a player's current rating without ever reaching it, which is
    // what keeps a man who reached 88 of a 99 projection an 88 player. Nothing
    // accumulates at either end of this clamp.
    const potential = applied === 0 ? p.potential : clamp(p.potential + applied, 1, 99);
    if (Math.abs(applied) >= PROGRESSION.CEILING_NEWS_MIN) {
      projections.push({ id: p.id, name: `${p.firstName} ${p.lastName}`, age: p.age, from: p.potential, to: potential });
    }

    const { attrs: rolled, ovr: rolledOvr } = progressPlayer(rng, p.position as Position, attrs, p.age, potential, p.devTrait, speedForPlayer, share * perfMult * focusMult * playtimeMult, p.id);

    const categories = leaderCategoriesById.get(p.id);
    if (categories) {
      const milestone = bumpForMilestone(p.position as Position, rolled, potential, PROGRESSION.STAT_LEADER_OVR_BUMP, PROGRESSION.STAT_LEADER_POTENTIAL_BUMP);
      updates.push({ id: p.id, attrs: writeJson(milestone.attrs), ovr: milestone.ovr, potential: milestone.potential });
      leaders.push({ id: p.id, name: `${p.firstName} ${p.lastName}`, categories });
    } else {
      updates.push({ id: p.id, attrs: writeJson(rolled), ovr: rolledOvr, potential });
    }
  }

  // One bulk UPDATE...FROM(VALUES...) instead of one round trip per rostered
  // player — the same pattern lib/season.ts uses for weekly game writes,
  // needed here too since this can touch 1,500+ players in a full league.
  const values = Prisma.join(updates.map((u) => Prisma.sql`(${u.id}::text, ${u.attrs}::text, ${u.ovr}::int, ${u.potential}::int)`));
  await prisma.$executeRaw`
    UPDATE "Player" AS p SET "trueAttrs" = v.attrs, "trueOvr" = v.ovr, "potential" = v.potential
    FROM (VALUES ${values}) AS v(id, attrs, ovr, potential)
    WHERE p.id = v.id
  `;

  // Burn one Development Focus charge per player who carried one into this
  // checkpoint. Matches zero rows today — see the devFocus note above — and is
  // kept only so the column's semantics stay whole if it is ever wired up.
  await prisma.player.updateMany({
    where: { leagueId, status: 'ACTIVE', devFocus: { gt: 0 } },
    data: { devFocus: { decrement: 1 } },
  });

  if (leaders.length > 0) {
    await prisma.transaction.createMany({
      data: leaders.map((l) => ({
        leagueId, seasonYear, week, type: 'DEV_MILESTONE',
        playerId: l.id,
        headline: `${l.name} is pacing the league in ${l.categories.join(' and ')}`,
        detail: 'Sustained production like that is starting to show up in his game.',
      })),
    });
  }

  /*
   * A CEILING THAT MOVES WITHOUT ANYONE SAYING SO IS THE THING TO AVOID. The
   * number is on his player page and in his season review; a GM who watches it
   * fall and finds nothing that explains it has been handed a random decrement.
   *
   * Its own transaction type rather than DEV_MILESTONE, deliberately.
   * lib/seasonReview.ts reads every DEV_MILESTONE row for a player and renders
   * it as "he led the league in <category>", recovering the category off the
   * headline with a regex whose fallback is "a marquee category". Filing a
   * ceiling DROP under that type would make the season review congratulate a
   * man on leading the league in nothing, which is exactly the class of defect
   * — a rendered sentence that is not the thing the system did — that this
   * project keeps having to fix.
   *
   * Rated ratings stay out of the copy. `trueOvr` is hidden unless the league
   * has revealTrueRatings on, and a wire item is read by a GM about all 32
   * clubs' players, so the text says what happened and never the numbers.
   */
  if (projections.length > 0) {
    await prisma.transaction.createMany({
      data: projections.map((r) => ({
        leagueId, seasonYear, week, type: 'DEV_PROJECTION',
        playerId: r.id,
        headline: r.to < r.from
          ? `${r.name}: the board lowers its projection`
          : `${r.name}: the board raises its projection`,
        detail: r.to < r.from
          ? `A full year of work that came in under what he is already rated for. At ${r.age} the club is no longer projecting him as high as it once did.`
          : `A full year of work that came in past what he is rated for. At ${r.age} there is time enough for that to become who he is.`,
      })),
    });
  }
}


// ---------------------------------------------------------------------------
// UNSIGNED PLAYERS
// ---------------------------------------------------------------------------

/**
 * Odds an unsigned player is simply out of football after another year on the
 * street. Constants live in FREE_AGENCY (lib/tuning.ts).
 *
 * Ordinary retirement can't be the only way off the free-agent list: it does
 * not start until 32, and most of the ~400 players who enter the pool every
 * year are 22-year-old undrafted rookies who would otherwise sit there for a
 * decade. Quality shields a player almost completely — somebody always calls
 * a genuinely good player, and with upgrade-and-displace in the AI wave
 * somebody now actually does.
 */
export function unsignedAttritionChance(yearsUnsigned: number, trueOvr: number, leagueMeanOvr: number): number {
  const years = Math.max(1, yearsUnsigned);
  const base = FREE_AGENCY.UNSIGNED_ATTRITION_BASE + (years - 1) * FREE_AGENCY.UNSIGNED_ATTRITION_PER_YEAR;
  const shield = leagueMeanOvr + FREE_AGENCY.UNSIGNED_ATTRITION_SHIELD_ABOVE_MEAN;
  const floor = leagueMeanOvr - FREE_AGENCY.UNSIGNED_ATTRITION_FLOOR_BELOW_MEAN;
  const exposure = clamp((shield - trueOvr) / Math.max(1, shield - floor), 0, 1);
  return clamp(base * exposure, 0, FREE_AGENCY.UNSIGNED_ATTRITION_MAX);
}

/**
 * The offseason roll for players NOBODY has signed — the other half of the
 * yearly PROGRESS step (see progressAllPlayers in lib/season.ts, which owns
 * the rostered side).
 *
 * Until now this did not exist at all: progression, aging and retirement all
 * filtered on `status: 'ACTIVE'`, so a free agent was frozen in time forever.
 * That is the mechanical reason the pool could only grow — measured 140 ->
 * 4,411 unsigned players over 13 simulated seasons, holding 593 players rated
 * 80+ — and a large part of why mean ACTIVE rating climbed without bound: the
 * only players who ever left the active pool were the ones who declined, and
 * nothing ever came back.
 *
 * Unsigned players now:
 *   - age a year and accrue a year of being unsigned (Player.yearsUnsigned,
 *     which is this roll's own clock and NOT the one his asking price falls
 *     on — that is Player.weeksUnsigned, ticked every advance in
 *     lib/season.ts and deliberately untouched here. A yearly counter moving
 *     in one lump would drop the price of a man released in the playoffs off
 *     a cliff four weeks later, for a reason that is nothing to do with him),
 *   - roll the ordinary age/rating retirement AND the out-of-football
 *     attrition above, whichever is worse,
 *   - develop at FREE_AGENCY.UNSIGNED_PROGRESSION_SCALE of a full year. A
 *     rostered player earns his growth in weekly in-season checkpoints with a
 *     coaching staff and real snaps; a man training on his own gets less, but
 *     a 22-year-old on the street should not be frozen at 22-year-old ratings
 *     either.
 *
 * Draftees are deliberately excluded — `isDraftee` players are the class
 * waiting for a draft that hasn't happened yet, not free agents, and aging
 * them here would hand every rookie an extra year before he was ever picked.
 *
 * "Good enough that somebody calls" is measured against the league's own mean
 * ROSTERED rating, read once per call, rather than a fixed number — see
 * FREE_AGENCY.UNSIGNED_ATTRITION_SHIELD_ABOVE_MEAN.
 */
export async function progressFreeAgents(
  leagueId: string,
  rng: Rng,
  opts: { retirementEnabled: boolean; progressionSpeed: number },
): Promise<{ retired: number; developed: number }> {
  const players = await prisma.player.findMany({
    where: { leagueId, status: 'FREE_AGENT', isDraftee: false },
    select: { id: true, age: true, trueOvr: true, position: true, potential: true, devTrait: true, trueAttrs: true, yearsUnsigned: true },
  });
  if (players.length === 0) return { retired: 0, developed: 0 };

  const rostered = await prisma.player.aggregate({
    where: { leagueId, status: 'ACTIVE' },
    _avg: { trueOvr: true },
  });
  const leagueMeanOvr = rostered._avg.trueOvr ?? 70;

  const retiringIds: string[] = [];
  const updates: { id: string; attrs: string; ovr: number }[] = [];

  for (const p of players) {
    const unsignedYears = p.yearsUnsigned + 1;
    const odds = Math.max(
      retirementChance(p.age, p.trueOvr, p.position as Position),
      unsignedAttritionChance(unsignedYears, p.trueOvr, leagueMeanOvr),
    );
    if (opts.retirementEnabled && rng.bool(odds)) {
      retiringIds.push(p.id);
      continue;
    }
    const attrs = readJson<AttrMap>(p.trueAttrs, {});
    const { attrs: rolled, ovr } = progressPlayer(
      rng, p.position as Position, attrs, p.age, p.potential, p.devTrait,
      opts.progressionSpeed, FREE_AGENCY.UNSIGNED_PROGRESSION_SCALE, p.id,
    );
    updates.push({ id: p.id, attrs: writeJson(rolled), ovr });
  }

  if (retiringIds.length > 0) {
    // A free agent has no contract by construction, but retirement is the one
    // status change that historically left rows behind — clear defensively.
    await prisma.contract.deleteMany({ where: { playerId: { in: retiringIds } } });
    await prisma.player.updateMany({ where: { id: { in: retiringIds } }, data: { status: 'RETIRED', teamId: null } });
  }

  if (updates.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const slice = updates.slice(i, i + CHUNK);
      const values = Prisma.join(slice.map((u) => Prisma.sql`(${u.id}::text, ${u.attrs}::text, ${u.ovr}::int)`));
      await prisma.$executeRaw`
        UPDATE "Player" AS p
        SET "trueAttrs" = v.attrs, "trueOvr" = v.ovr, age = p.age + 1, "yearsUnsigned" = p."yearsUnsigned" + 1
        FROM (VALUES ${values}) AS v(id, attrs, ovr)
        WHERE p.id = v.id
      `;
    }
  }

  return { retired: retiringIds.length, developed: updates.length };
}
