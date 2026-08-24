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
 * the deliberate exception and is scored off the final's own box line.
 * `offensiveScore` is a fantasy-points-style blend and stays one: fed real
 * MVP and Offensive Player of the Year seasons it already reproduces the
 * ordering real voting has (quarterbacks clear, backs close behind,
 * receivers within reach of the backs). `defensiveScore` is NOT — see the
 * long note on it below for why an IDP blend cannot pick a Defensive Player
 * of the Year. Both are exported so lib/development.ts can score in-season
 * production with the same formula — one definition of "who's playing well,"
 * not two.
 * ===========================================================================
 */

export const DEFENSIVE_POSITIONS = new Set(['EDGE', 'DT', 'LB', 'CB', 'S']);

export function offensiveScore(s: SeasonStats): number {
  return (s.passYds ?? 0) * 0.04 + (s.passTd ?? 0) * 4 - (s.int ?? 0) * 2
    + (s.rushYds ?? 0) * 0.1 + (s.rushTd ?? 0) * 6
    + (s.recYds ?? 0) * 0.1 + (s.recTd ?? 0) * 6;
}

/**
 * ---------------------------------------------------------------------------
 * WHY A TACKLE IS WORTH LESS THAN A POINT AND A SACK IS WORTH EIGHT OF THEM
 * ---------------------------------------------------------------------------
 * These weights used to be 1 / 3 / 6 / 2 / 4 — an ordinary IDP fantasy-points
 * blend, which is a fine way to run a fantasy league and a bad way to hand out
 * Defensive Player of the Year. IDP scoring pays for VOLUME, and the volume
 * stat on defence is the tackle, which is recorded on a play the offence has
 * already gained on. The plays that decide games are the ones the defence took
 * away: the sack, the interception, the ball on the ground, the throw knocked
 * down.
 *
 * MEASURED, ON REAL FOOTBALL, NOT ON THIS SIM. Feed the old weights ten real
 * AP Defensive Player of the Year seasons — men who each beat every other
 * defender in the league that year, so a model that agrees with the voters
 * should rank them close together — and it spreads them over a 2.16x range,
 * putting Ray Lewis 2003 at 225 against Myles Garrett 2023 at 104. Averaged by
 * position it reads LB 216, CB 160, S 145, DT 142, EDGE 130: it ranks edge
 * rushers LAST among the men who won the award, and edge rushers are the
 * largest single group of winners it has (15 of 53 listed as defensive ends,
 * plus the edge-rushing outside linebackers — Taylor, Harrison, Suggs, T.J.
 * Watt — counted among the 17 linebackers). That is the model disagreeing with
 * real voting on real inputs, which is a defect in the model and not in
 * whatever feeds it.
 *
 * The same ten seasons under these weights sit inside 1.65x and read LB 224,
 * DT 222, CB 209, EDGE 203, S 182 — no position systematically excluded, and
 * the single highest score of the ten is T.J. Watt's 2021.
 *
 * HOW THESE FIVE NUMBERS WERE CHOSEN, AND WHY IT IS NOT HAND-TUNING THE AWARD.
 * Nine candidate weight vectors were run against a hundred simulated
 * league-years and against the ten real seasons at the same time, and the one
 * kept is the one whose DPOY mix lands closest to the AP award's own record —
 * 40% edge rushers, 21% off-ball linebackers, 19% interior, 11% corners, 9%
 * safeties over 53 winners.
 *
 * RE-MEASURED SINCE, over 120 replayed league-seasons on the engine as it now
 * stands, it produces EDGE 32.5%, S 25.0%, LB 22.5%, CB 20.0% — against
 * safety 97.5% / corner 2.5% / EDGE never, on the same rosters and the same
 * seeds through the old engine and the old weights. The edge rusher goes from
 * structurally unable to win it to winning it more often than anybody else,
 * a little short of the AP's 40%; safeties and corners still come out about
 * twice as often as the voters pick them, and an interior lineman still never
 * does. An earlier note here read "EDGE 52%, LB 20%, S 15%, CB 13%" — the same
 * shape on a smaller sample, taken before SACKS_PER_GAME went back to the 2.3
 * the NFL actually runs and before the probe behind it was fixed to serialize
 * `trueAttrs`, without which every club in it played to the same scheme fit.
 * (Scheme fit has since been deleted outright — see lib/sim/units.ts. The note
 * is kept because it explains where the older, smaller-sample figures came
 * from, not because the mechanism still exists.)
 *
 * That is a distribution target, not an outcome rule: this is still a pure
 * function of a stat line, a great safety season still beats a poor edge
 * season, and no branch anywhere knows what position it is looking at.
 *
 * WHAT IT STILL DOES NOT REACH: an interior lineman never wins it here, where
 * the AP has given it to one ten times in 53 years. Three of those ten are
 * Aaron Donald, whose 20-sack seasons are a kind of interior year this
 * simulation does not produce — its best defensive tackle gets 12, which is
 * what a normal interior leader gets. That is a gap in the sim's tail, not in
 * this function, and it is left rather than papered over.
 *
 * [TUNE] The shape is a disruption-weighted blend, roughly ordered by what a
 * play is worth in expected points: a sack costs an offence about 1.6, an
 * interception about 4, a forced fumble about 2 once you discount for who
 * recovers it, a broken-up pass under 1 — and a tackle is not a defensive win
 * at all, it is the end of a play the offence chose. It is not a literal
 * expected-points model. Interceptions are held to 10 rather than the ~16 that
 * ratio implies because at 16 the ball-hawking corner outscores everyone, and
 * corners are 6 of the 53 winners rather than the plurality; the sweep above
 * is where that shows up.
 *
 * THIS IS ONE SCORE, USED EVERYWHERE, AND THAT IS DELIBERATE. It would have
 * been possible to leave this function alone and layer an award-only valuation
 * over it. That was rejected: the defect above is visible without any trophy
 * in the room, the docstring at the top of this file promises "one definition
 * of who's playing well, not two", and a second opinion would make the trophy
 * disagree with the production numbers on the same screen. What the change
 * costs the other callers was measured rather than assumed — within a position
 * group, which is the only comparison lib/development.ts and lib/seasonReview.ts
 * ever make, the reordering is small, because every safety is scored on the
 * same mix as every other safety. Put a number on it: over the same replayed
 * seasons, swapping the weights and changing nothing else leaves Spearman's
 * rho between the old ranking and the new at 0.980 to 0.991 at every
 * defensive position, keeps 86-89% of each group's top-15% "breakout" tier
 * and 88-94% of its bottom-15% "slump" tier.
 *
 * lib/storyline.ts is the caller that does NOT rank within a position, and it
 * was checked separately. Its cross-position `contractCandidates` sort picks
 * the two most productive men on a club's expiring deals from offence and
 * defence together: 0 of 24 slots changed hands on the re-weighting, because
 * a quarterback scores 20 a game against a defender's 3 to 6 and nothing in
 * these five numbers closes a gap that size. Its `ARC_BREAKOUT_SCORE` bar of
 * 10 a game IS absolute and does move — from 92 players a league-season
 * clearing it to 97 — but three quarters of that shift is the simulation now
 * producing defensive seasons at all, not the weights: on unchanged weights
 * the same engine change alone took it from 77 to 92.
 */
export function defensiveScore(s: SeasonStats): number {
  return (s.tackles ?? 0) * 0.8 + (s.sacks ?? 0) * 6.5 + (s.defInt ?? 0) * 10 + (s.pd ?? 0) * 3 + (s.ff ?? 0) * 8;
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

/**
 * ---------------------------------------------------------------------------
 * WHO CAN WIN TWO TROPHIES IN ONE YEAR
 * ---------------------------------------------------------------------------
 * [TUNE] How far clear of the next man on his own side of the ball the MVP
 * has to finish to keep that side's Player of the Year award as well. 0.20 =
 * he must outscore the runner-up by a fifth.
 *
 * This exists because for a long time it did not, and the awards panel printed
 * the same man twice. MVP was `max(off, def)` over the whole league and OPOY
 * was the best `off` among offensive players, which are the same row every
 * time the league's best season belongs to an offensive player. Replaying 158
 * live league-years out of 82 saves, that was 158 of 158: OPOY never once
 * named anyone the MVP box had not already named. It was not a trophy, it was
 * a second printing of one.
 *
 * The fix is NOT to redefine MVP as "best offensive player" — that would
 * quietly delete the defensive MVP this game still allows — and it is NOT a
 * flat "OPOY is the best offensive player who isn't the MVP". That flat
 * runner-up reading is a real convention, but it has a failure mode: in the
 * season where one man laps the field, it hands Offensive Player of the Year
 * to someone the numbers say was plainly second best, and the panel prints
 * both stat lines side by side where a user can see the smaller one.
 *
 * So the runner-up only inherits when the race was actually close, which is
 * exactly when he has a case. If the leader finished a fifth clear of the
 * field he keeps both, because real football does hand one man both — Terrell
 * Davis in 1998, Marshall Faulk in 2000, Tom Brady in 2007 and 2010, Peyton
 * Manning in 2013, Patrick Mahomes in 2018 — and a rule that makes it
 * impossible is its own small lie.
 *
 * WHY 20%, AND WHY NOT THE NUMBER THAT MATCHES REAL FOOTBALL'S RATE. Measured
 * over those same 158 league-years, the leader's margin over the next man on
 * his own side of the ball is 5% at the median, 9% at p75 and 17% at p90. At
 * 20% the sweep fires on 5.7% of seasons — call it once in a long dynasty.
 * Real voters double-honour roughly one year in five, and a threshold near
 * 11% would reproduce that rate, but their 1-in-5 comes from judgment we
 * cannot model and ours comes from raw margin. Tuned to the real RATE, the
 * duplicate starts landing in seasons where the two stat lines are close
 * enough that the repeat looks arbitrary to the man reading them. Tuned where
 * it is, every duplicate a GM ever sees is legible from the numbers already
 * on his screen. Rarity is the side effect; legibility is the target.
 *
 * The two Rookie of the Year awards are deliberately NOT subject to this, and
 * that is not an oversight: they answer a different question. MVP and OPOY
 * compete for the same title — best in the league, best on this side of it —
 * so naming one man both needs to be earned. "Best first-year man" is its own
 * question, and Lawrence Taylor won Defensive Rookie of the Year and
 * Defensive Player of the Year in the same 1981 season. A rule that forbade
 * that would delete one of the most famous years the sport has. Exclusion
 * applies between awards that argue over the same title, not between awards
 * that ask different things. Championship MVP sits outside it for the same
 * reason and one more: it is decided on ONE game's box line from ONE roster,
 * so a man holding it alongside the MVP is not a repeated verdict, it is two
 * different questions with the same answer — which is how Patrick Mahomes
 * came to hold both in 2022.
 *
 * THE CONFINEMENT THIS COMMENT USED TO DESCRIBE HAS BEEN CHASED DOWN. It said
 * the trophies inherited the scoring model's shape — MVP a back or a passer in
 * all 158 league-years, DPOY a safety in 96% of them, an edge rusher never —
 * and left it unfixed. Measuring it split the blame two ways, and neither half
 * was the rule below:
 *
 *   - THE OFFENCE WAS THE SIMULATION'S FAULT. `offensiveScore` fed real MVP
 *     and OPOY seasons ranks quarterbacks 407, backs 318, receivers 265 —
 *     which is real football's own ordering. The simulation was not producing
 *     those seasons. It split a team's yards pass/run on the rate it CALLED
 *     passes, as if a carry gained as much as a throw, so its leading rusher
 *     gained 2,208 yards against its leading receiver's 1,435 where the NFL
 *     has them level; and it handed the lead back every rushing touchdown his
 *     club scored, 28 a year against a real leader's 18. Both are fixed in
 *     lib/sim/engine.ts. `offensiveScore` is unchanged, because nothing was
 *     wrong with it.
 *
 *   - THE DEFENCE WAS BOTH. The simulation flattened tackles until the
 *     league's leading linebacker, safety and edge rusher all finished within
 *     four per cent of each other, and capped every man at one sack and one
 *     interception a game so no tail could form. AND `defensiveScore` was an
 *     IDP fantasy blend that, on real award-winning lines, ranked edge rushers
 *     last of the five positions that win the award. Both are fixed — the
 *     first in lib/sim/engine.ts, the second in `defensiveScore` above, where
 *     the reasoning and the measurement live.
 *
 * The rule below is untouched by any of it and still does only its own job.
 */
export const AWARD_SWEEP_MARGIN = 0.20;

/**
 * A season's worth of one man, already scored — everything the ranking needs
 * and nothing it doesn't. Exported so the pure ranking below can be replayed
 * against historical stat lines (and by lib/gen/leagueHistory.ts's seeded
 * past) without a database behind it.
 */
export interface AwardCandidate {
  playerId: string;
  name: string;
  position: string;
  teamId: string | null;
  teamAbbr: string;
  off: number;
  def: number;
  isDefensive: boolean;
  experience: number;
  statLine: string;
}

/**
 * True when `leader` has finished far enough clear of `runnerUp` on his own
 * side of the ball to hold the MVP and that side's Player of the Year at
 * once. Shared with the seeded backstory generator so a fictional 1998 and
 * the user's own 2031 obey one rule, not two. A runner-up who scored nothing
 * is no contest at all, so the leader keeps both.
 */
export function sweptTheField(leaderScore: number, runnerUpScore: number): boolean {
  if (runnerUpScore <= 0) return true;
  return leaderScore >= runnerUpScore * (1 + AWARD_SWEEP_MARGIN);
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

/**
 * The five season-long trophies, decided from an already-scored field. Pure —
 * no database, no clock — so it can be replayed over historical stat lines
 * and A/B'd against a change to the rule without simulating anything.
 *
 * ONE IDEA, FIVE AWARDS. Every trophy ranks its own field on that field's own
 * number: the whole league on `max(off, def)`, each side of the ball on that
 * side's score, each side's rookies on the same side's score again. Nothing
 * is ranked on a number from the other side of the ball. The only interaction
 * between awards is the sweep test above, and it applies only where two
 * trophies are arguing about the same title.
 */
export function pickSeasonAwards(field: AwardCandidate[]): Omit<SeasonAwards, 'sbmvp'> {
  const byOverall = [...field].sort((a, b) => Math.max(b.off, b.def) - Math.max(a.off, a.def));
  const byOff = field.filter((p) => !p.isDefensive).sort((a, b) => b.off - a.off);
  const byDef = field.filter((p) => p.isDefensive).sort((a, b) => b.def - a.def);
  // Rookies are split by the same `isDefensive` flag `byOff`/`byDef` use
  // above, and each side is then ranked on ITS OWN score rather than on
  // `Math.max(off, def)`. That matters: a rookie corner with a pick-six has a
  // non-zero offensive score, and ranking him on the better of his two
  // numbers would let a defender's receiving line decide an offensive
  // trophy. One partition, two awards, no crossover.
  const rookieOff = byOff.filter((p) => p.experience === 0);
  const rookieDef = byDef.filter((p) => p.experience === 0);

  const mvp = byOverall[0];

  /**
   * Player of the Year for one side of the ball. The best man on that side
   * wins it, unless he is already the MVP and did not finish clear enough of
   * the runner-up to deserve both — see AWARD_SWEEP_MARGIN. Written once and
   * used for both sides so a defensive MVP is handled by the same three lines
   * as an offensive one; the game allows one, and a branch that only ever ran
   * for offences would be a branch nobody ever checked.
   */
  const playerOfTheYear = (ranked: AwardCandidate[], score: (c: AwardCandidate) => number) => {
    const leader = ranked[0];
    if (!leader || !mvp || leader.playerId !== mvp.playerId) return leader;
    const runnerUp = ranked[1];
    // Nobody else played that side of the ball all year. He keeps it — there
    // is no second name to hand it to, and leaving the box empty would say
    // less than printing his.
    if (!runnerUp) return leader;
    return sweptTheField(score(leader), score(runnerUp)) ? leader : runnerUp;
  };

  const toWinner = (w: AwardCandidate | undefined): AwardWinner | null =>
    w ? { playerId: w.playerId, name: w.name, position: w.position, teamId: w.teamId, teamAbbr: w.teamAbbr, score: Math.round(Math.max(w.off, w.def)), statLine: w.statLine } : null;

  return {
    mvp: toWinner(mvp),
    opoy: toWinner(playerOfTheYear(byOff, (c) => c.off)),
    dpoy: toWinner(playerOfTheYear(byDef, (c) => c.def)),
    oroty: toWinner(rookieOff[0]),
    droty: toWinner(rookieDef[0]),
  };
}

export async function computeSeasonAwards(leagueId: string, seasonYear: number): Promise<SeasonAwards> {
  const players = await prisma.player.findMany({
    where: { leagueId, seasonStats: { not: '{}' } },
    include: { team: true },
  });

  const scored: AwardCandidate[] = players.map((p) => {
    const stats = readJson<SeasonStats>(p.seasonStats, {});
    const isDefensive = DEFENSIVE_POSITIONS.has(p.position);
    return {
      playerId: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position,
      teamId: p.teamId, teamAbbr: p.team?.abbr ?? 'FA',
      off: offensiveScore(stats), def: defensiveScore(stats),
      isDefensive, experience: p.experience,
      statLine: statLineFor(stats, isDefensive),
    };
  });

  return {
    ...pickSeasonAwards(scored),
    sbmvp: await computeSuperBowlMvp(leagueId, seasonYear),
  };
}
