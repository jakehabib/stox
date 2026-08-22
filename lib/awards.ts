import { prisma } from './db';
import { readJson } from './json';
import { SeasonStats, BoxScore } from './types';

/**
 * ===========================================================================
 * SEASON AWARDS
 * ===========================================================================
 * Computed once, right when the championship game finishes, from that
 * season's accumulated Player.seasonStats — before those numbers get rolled
 * into career stats and reset for the new year. seasonStats is REGULAR SEASON
 * ONLY (the postseason has its own bucket, Player.playoffStats), so MVP,
 * OPOY, DPOY and the two Rookie of the Year awards are decided on regular-
 * season production even though they are announced after the final — which is
 * both what the real awards do and what stops a run to the title from
 * outvoting a better year. Championship MVP is
 * the deliberate exception and is scored off the final's own box line. [TUNE] weights are a rough
 * fantasy-points-style blend, not a real award-voting model — good enough to
 * produce a plausible, explainable winner without needing real ballots.
 * Exported so lib/development.ts can score in-season production with the
 * same formula — one definition of "who's playing well," not two.
 * ===========================================================================
 */

export const DEFENSIVE_POSITIONS = new Set(['EDGE', 'DT', 'LB', 'CB', 'S']);

export function offensiveScore(s: SeasonStats): number {
  return (s.passYds ?? 0) * 0.04 + (s.passTd ?? 0) * 4 - (s.int ?? 0) * 2
    + (s.rushYds ?? 0) * 0.1 + (s.rushTd ?? 0) * 6
    + (s.recYds ?? 0) * 0.1 + (s.recTd ?? 0) * 6;
}

export function defensiveScore(s: SeasonStats): number {
  return (s.tackles ?? 0) * 1 + (s.sacks ?? 0) * 3 + (s.defInt ?? 0) * 6 + (s.pd ?? 0) * 2 + (s.ff ?? 0) * 4;
}

export interface AwardWinner {
  playerId: string;
  name: string;
  position: string;
  teamId: string | null;
  teamAbbr: string;
  score: number;
  statLine: string;
}

export interface SeasonAwards {
  mvp: AwardWinner | null;
  opoy: AwardWinner | null;
  dpoy: AwardWinner | null;
  /**
   * Rookie of the Year, one per side of the ball, as real football hands it
   * out. Both are picked from the SAME `isDefensive` partition that decides
   * OPOY and DPOY, so a rookie can never be judged on the wrong side of the
   * ball and the two rookie trophies always agree with the two veteran ones
   * about who is a defender.
   */
  oroty: AwardWinner | null;
  droty: AwardWinner | null;
  sbmvp: AwardWinner | null;
}

function statLineFor(s: SeasonStats, isDefensive: boolean): string {
  // Pluralised because this string is printed verbatim on the dashboard
  // announcement, the league wire and the GM honours list, where "1 sacks"
  // reads as a bug in a sentence the player is meant to enjoy.
  if (isDefensive) return `${s.tackles ?? 0} tkl, ${s.sacks ?? 0} sack${(s.sacks ?? 0) === 1 ? '' : 's'}, ${s.defInt ?? 0} INT`;
  if ((s.passAtt ?? 0) > 0) return `${s.passYds ?? 0} pass yds, ${s.passTd ?? 0} TD, ${s.int ?? 0} INT`;
  if ((s.rushAtt ?? 0) > (s.targets ?? 0)) return `${s.rushYds ?? 0} rush yds, ${s.rushTd ?? 0} TD`;
  return `${s.recYds ?? 0} rec yds, ${s.recTd ?? 0} TD`;
}

/**
 * Best individual performance on the winning side of that season's
 * championship game — real Super Bowl MVPs are drawn almost exclusively
 * from the winning roster, so unlike the season-long awards this doesn't
 * consider the losing team at all. Scored on that single game's box line,
 * not season totals: a big final can hand the trophy to someone who wasn't
 * otherwise having a huge year.
 */
export async function computeSuperBowlMvp(leagueId: string, seasonYear: number): Promise<AwardWinner | null> {
  const final = await prisma.game.findFirst({ where: { leagueId, seasonYear, kind: 'FINAL', played: true } });
  if (!final) return null;

  const box = readJson<BoxScore | null>(final.boxScore, null);
  if (!box?.lines) return null;

  const winnerTeamId = final.homeScore >= final.awayScore ? final.homeTeamId : final.awayTeamId;
  const winnerLines = winnerTeamId === final.homeTeamId ? box.lines.home : box.lines.away;
  if (winnerLines.length === 0) return null;

  const scored = winnerLines
    .map((l) => {
      const isDefensive = DEFENSIVE_POSITIONS.has(l.position);
      return { ...l, score: isDefensive ? defensiveScore(l.stats) : offensiveScore(l.stats), isDefensive };
    })
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score <= 0) return null;

  const team = await prisma.team.findUnique({ where: { id: winnerTeamId } });
  return {
    playerId: top.playerId, name: top.name, position: String(top.position),
    teamId: winnerTeamId, teamAbbr: team?.abbr ?? '',
    score: Math.round(top.score), statLine: statLineFor(top.stats, top.isDefensive),
  };
}

export async function computeSeasonAwards(leagueId: string, seasonYear: number): Promise<SeasonAwards> {
  const players = await prisma.player.findMany({
    where: { leagueId, seasonStats: { not: '{}' } },
    include: { team: true },
  });

  const scored = players.map((p) => {
    const stats = readJson<SeasonStats>(p.seasonStats, {});
    const isDefensive = DEFENSIVE_POSITIONS.has(p.position);
    const off = offensiveScore(stats);
    const def = defensiveScore(stats);
    const score = isDefensive ? def : off;
    return {
      playerId: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position,
      teamId: p.teamId, teamAbbr: p.team?.abbr ?? 'FA',
      score, off, def, isDefensive, experience: p.experience,
      statLine: statLineFor(stats, isDefensive),
    };
  });

  const byOverall = [...scored].sort((a, b) => Math.max(b.off, b.def) - Math.max(a.off, a.def));
  const byOff = [...scored].filter((p) => !p.isDefensive).sort((a, b) => b.off - a.off);
  const byDef = [...scored].filter((p) => p.isDefensive).sort((a, b) => b.def - a.def);
  // Rookies are split by the same `isDefensive` flag `byOff`/`byDef` use
  // above, and each side is then ranked on ITS OWN score rather than on
  // `Math.max(off, def)`. That matters: a rookie corner with a pick-six has a
  // non-zero offensive score, and ranking him on the better of his two
  // numbers would let a defender's receiving line decide an offensive
  // trophy. One partition, two awards, no crossover.
  const rookieOff = [...scored].filter((p) => p.experience === 0 && !p.isDefensive).sort((a, b) => b.off - a.off);
  const rookieDef = [...scored].filter((p) => p.experience === 0 && p.isDefensive).sort((a, b) => b.def - a.def);

  const toWinner = (w: (typeof scored)[number] | undefined): AwardWinner | null =>
    w ? { playerId: w.playerId, name: w.name, position: w.position, teamId: w.teamId, teamAbbr: w.teamAbbr, score: Math.round(Math.max(w.off, w.def)), statLine: w.statLine } : null;

  return {
    mvp: toWinner(byOverall[0]),
    opoy: toWinner(byOff[0]),
    dpoy: toWinner(byDef[0]),
    oroty: toWinner(rookieOff[0]),
    droty: toWinner(rookieDef[0]),
    sbmvp: await computeSuperBowlMvp(leagueId, seasonYear),
  };
}
