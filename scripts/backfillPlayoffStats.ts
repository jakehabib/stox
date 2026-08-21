/**
 * ===========================================================================
 * BACKFILL — SPLIT THE COMBINED STAT BUCKET
 * ===========================================================================
 * Regular-season and postseason production used to accumulate into one place:
 * `simulateAndSaveGame` gated only the STANDINGS on `kind === 'REGULAR'`, so
 * a Super Bowl run silently added up to four games of yardage AND four games
 * of `gp` to a season line. Every save written before that was fixed carries
 * combined totals, and "correct going forward" is not correct — a leaderboard
 * built from those rows still ranks a 21-game back against a 17-game one.
 *
 * WHY THIS IS RECOVERABLE AND NOT A GUESS
 * ---------------------------------------
 * `Game.kind` has been stored on every game since the beginning and nothing in
 * the codebase deletes a Game, so every playoff line ever written is still on
 * disk, filed under the club that played it. Everything below is a replay of
 * those box scores. Nothing is invented, and the one thing that genuinely
 * cannot be split — a career seeded at league creation, which has no box
 * scores at all — is deliberately left whole on the regular-season side (see
 * lib/playerSeasons.ts).
 *
 * WHAT IT TOUCHES, IN THREE PASSES
 * --------------------------------
 *   1. PlayerSeason — dropped and replayed for every year with played games,
 *      which is safe because syncPlayerSeasons is the table's only writer and
 *      every column in it is derived.
 *   2. Player.careerStats / careerPlayoffStats — the playoff share of the
 *      ROLLED-OVER years is subtracted out of careerStats and becomes
 *      careerPlayoffStats. Subtraction rather than a rebuild, so a seeded
 *      pre-league career (which no box score accounts for) survives untouched.
 *   3. Player.seasonStats / playoffStats — the same subtraction for a save
 *      sitting INSIDE its playoffs right now, where the live accumulator is
 *      already polluted.
 *
 * "Rolled over" is decided by one fact: the rollover bumps League.seasonYear
 * in the same step it folds season into career (RESET_STANDINGS in
 * lib/season.ts), so a year that still has played Games under the league's
 * CURRENT seasonYear is by definition the live, un-rolled one.
 *
 *   npx tsx scripts/backfillPlayoffStats.ts [--dry] [--league <id>]
 * ===========================================================================
 */
import { prisma } from '../lib/db';
import { readJson, writeJson } from '../lib/json';
import { mergeStats } from '../lib/stats';
import { syncPlayerSeasons, ageBasisYear } from '../lib/playerSeasons';
import type { BoxScore, SeasonStats } from '../lib/types';

const DRY = process.argv.includes('--dry');
const ONLY = process.argv.includes('--league') ? process.argv[process.argv.indexOf('--league') + 1] : null;

/** a minus b, per key, clamped at zero and with zeros dropped. See residualBeforeRow(). */
function subtract(a: SeasonStats, b: SeasonStats): SeasonStats {
  const out: SeasonStats = {};
  for (const key of Object.keys(a) as (keyof SeasonStats)[]) {
    const diff = (a[key] ?? 0) - (b[key] ?? 0);
    if (diff > 0) out[key] = diff;
  }
  return out;
}

function empty(s: SeasonStats): boolean {
  return Object.keys(s).length === 0;
}

async function main() {
  const leagues = await prisma.league.findMany({
    where: ONLY ? { id: ONLY } : {},
    select: { id: true, name: true, seasonYear: true, phase: true, week: true },
    orderBy: { createdAt: 'asc' },
  });

  let totalPlayerSeasonRows = 0;
  let totalCareerFixed = 0;
  let totalLiveFixed = 0;
  let leaguesTouched = 0;

  for (const league of leagues) {
    const games = await prisma.game.findMany({
      where: { leagueId: league.id, played: true },
      select: { seasonYear: true, kind: true, homeTeamId: true, awayTeamId: true, boxScore: true },
    });
    if (games.length === 0) continue;

    // The un-rolled year, if there is one — see the header.
    const liveYear = games.some((g) => g.seasonYear === league.seasonYear) ? league.seasonYear : null;

    // Playoff production per player, split into "already in careerStats" and
    // "still in the live seasonStats accumulator".
    const rolledPlayoff = new Map<string, SeasonStats>();
    const livePlayoff = new Map<string, SeasonStats>();
    const liveRegular = new Map<string, SeasonStats>();
    for (const g of games) {
      const box = readJson<BoxScore | null>(g.boxScore, null);
      if (!box?.lines) continue;
      const isPlayoff = g.kind !== 'REGULAR';
      const isLive = g.seasonYear === liveYear;
      const target = isLive ? (isPlayoff ? livePlayoff : liveRegular) : (isPlayoff ? rolledPlayoff : null);
      if (!target) continue;
      for (const side of ['home', 'away'] as const) {
        for (const line of box.lines[side] ?? []) {
          target.set(line.playerId, mergeStats(target.get(line.playerId) ?? {}, line.stats));
        }
      }
    }

    // --- Pass 1: PlayerSeason, replayed from the box scores ---------------
    // Strictly the COMPLETED years. The live year deliberately has no rows —
    // the player page reconstructs it from box scores so a mid-season trade
    // splits correctly — and writing rows for it here would also mark it
    // "done", so the real rollover would skip it and its final numbers would
    // never be persisted.
    const maxYear = Math.max(...games.map((g) => g.seasonYear));
    const throughYear = liveYear != null ? liveYear - 1 : maxYear;
    let rows = 0;
    if (!DRY && throughYear >= Math.min(...games.map((g) => g.seasonYear))) {
      const res = await syncPlayerSeasons(league.id, throughYear, ageBasisYear(league), { rebuild: true });
      rows = res.rows;
    } else if (DRY) {
      rows = await prisma.playerSeason.count({ where: { leagueId: league.id } });
    }
    totalPlayerSeasonRows += rows;

    // --- Passes 2 and 3: the Player accumulators --------------------------
    const ids = new Set([...rolledPlayoff.keys(), ...livePlayoff.keys()]);
    const players = await prisma.player.findMany({
      where: { leagueId: league.id, id: { in: [...ids] } },
      select: { id: true, seasonStats: true, careerStats: true, playoffStats: true, careerPlayoffStats: true },
    });

    let careerFixed = 0;
    let liveFixed = 0;
    for (const p of players) {
      const data: Record<string, string> = {};

      const rolled = rolledPlayoff.get(p.id);
      if (rolled && !empty(rolled)) {
        const career = readJson<SeasonStats>(p.careerStats, {});
        const split = subtract(career, rolled);
        // Only write when it actually moves something. A save that already
        // went through this script, or one written after the fix landed, has
        // nothing to subtract and must not have its career re-reduced.
        if (empty(readJson<SeasonStats>(p.careerPlayoffStats, {}))) {
          data.careerStats = writeJson(split);
          data.careerPlayoffStats = writeJson(rolled);
          careerFixed++;
        }
      }

      const live = livePlayoff.get(p.id);
      if (live && !empty(live)) {
        const season = readJson<SeasonStats>(p.seasonStats, {});
        if (empty(readJson<SeasonStats>(p.playoffStats, {})) && !empty(season)) {
          data.seasonStats = writeJson(subtract(season, live));
          data.playoffStats = writeJson(live);
          liveFixed++;
        }
      }

      if (Object.keys(data).length > 0 && !DRY) {
        await prisma.player.update({ where: { id: p.id }, data });
      }

      // The subtraction and a fresh replay of the same games are two
      // independent routes to the same number; if they disagree the
      // accumulator had drifted from its own box scores and this script is
      // not the place to paper over it. Report, don't silently "fix".
      if (data.seasonStats) {
        const replayed = liveRegular.get(p.id) ?? {};
        const derived = readJson<SeasonStats>(data.seasonStats, {});
        for (const k of new Set([...Object.keys(replayed), ...Object.keys(derived)]) as Set<keyof SeasonStats>) {
          if ((replayed[k] ?? 0) !== (derived[k] ?? 0)) {
            console.warn(`  ! ${p.id} ${k}: subtraction gives ${derived[k] ?? 0}, box scores give ${replayed[k] ?? 0}`);
          }
        }
      }
    }
    totalCareerFixed += careerFixed;
    totalLiveFixed += liveFixed;
    if (rows > 0 || careerFixed > 0 || liveFixed > 0) leaguesTouched++;

    console.log(
      `${league.name} (${league.id}) ${league.seasonYear} ${league.phase}`
      + ` — PlayerSeason rows ${rows}, careers split ${careerFixed}, live accumulators split ${liveFixed}`
      + (liveYear ? ` [live year ${liveYear}]` : ' [no un-rolled year]'),
    );
  }

  console.log('');
  console.log(`${DRY ? 'DRY RUN — ' : ''}leagues touched: ${leaguesTouched} of ${leagues.length}`);
  console.log(`PlayerSeason rows rebuilt: ${totalPlayerSeasonRows}`);
  console.log(`Player.careerStats/careerPlayoffStats split: ${totalCareerFixed}`);
  console.log(`Player.seasonStats/playoffStats split (saves inside their playoffs): ${totalLiveFixed}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
