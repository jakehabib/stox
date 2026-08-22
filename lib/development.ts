import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { Rng, clamp } from './rng';
import { Position, PROGRESSION, FREE_AGENCY } from './tuning';
import { AttrMap } from './ratings';
import { progressPlayer, bumpForMilestone, retirementChance } from './progression';
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

  const players = await prisma.player.findMany({ where: { leagueId, status: 'ACTIVE' } });
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

  const updates: { id: string; attrs: string; ovr: number; potential: number }[] = [];
  const leaders: { id: string; name: string; categories: string[] }[] = [];

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
    const { attrs: rolled, ovr: rolledOvr } = progressPlayer(rng, p.position as Position, attrs, p.age, p.potential, p.devTrait, speedForPlayer, share * perfMult * focusMult);

    const categories = leaderCategoriesById.get(p.id);
    if (categories) {
      const milestone = bumpForMilestone(p.position as Position, rolled, p.potential, PROGRESSION.STAT_LEADER_OVR_BUMP, PROGRESSION.STAT_LEADER_POTENTIAL_BUMP);
      updates.push({ id: p.id, attrs: writeJson(milestone.attrs), ovr: milestone.ovr, potential: milestone.potential });
      leaders.push({ id: p.id, name: `${p.firstName} ${p.lastName}`, categories });
    } else {
      updates.push({ id: p.id, attrs: writeJson(rolled), ovr: rolledOvr, potential: p.potential });
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
 *   - age a year and accrue a year of being unsigned,
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
      opts.progressionSpeed, FREE_AGENCY.UNSIGNED_PROGRESSION_SCALE,
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
