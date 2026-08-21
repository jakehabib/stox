import { prisma } from './db';
import { Rng } from './rng';
import { readJson } from './json';
import { mergeStats } from './stats';
import { SeasonStats } from './types';
import { RECORD_CATEGORIES, RecordCategory } from './records';
import { offensiveScore, defensiveScore, DEFENSIVE_POSITIONS } from './awards';
import { computeClinchStatus, clinchScenarioTag, StandingsTeam } from './clinchScenario';
import { computeRivalry, RIVALRY_NARRATIVE_THRESHOLD } from './rivalry';

/**
 * ===========================================================================
 * STORYLINE ENGINE
 * ===========================================================================
 * INTEGRATION POINT for whoever wires this into lib/season.ts or a page:
 *
 *   Call `generateStorylines(leagueId, teamId)`. It is read-only — no writes,
 *   nothing persisted, purely derived from Game/Player/Team/LeagueRecord rows
 *   that already exist — so it's cheap enough to call on every page load
 *   that wants it (same cost class as lib/standingsTrend.ts or
 *   lib/clinchScenario.ts, which already work this way) rather than needing
 *   a cron/season-step hook or new schema to cache it.
 *
 *   Two call sites make sense, and they're not mutually exclusive:
 *     1. A Dashboard / Front Office Brief page, called for the user's own
 *        team, rendered as a small "Storylines" card — matches this game's
 *        existing "auto-surfaced, no extra click required" pattern used for
 *        the clinch tag and news ticker.
 *     2. `advanceWeek`'s REGULAR/PLAYOFFS branches in lib/season.ts, to fold
 *        a headline or two into the weekly summary text already returned to
 *        the UI. IMPORTANT if wired here: the RIVALRY beat previews the
 *        upcoming matchup using the pre-game head-to-head state, so call it
 *        for a team's game BEFORE simulateAndSaveGame() runs for that game —
 *        same timing rule lib/rivalry.ts documents on rivalryRecapLine.
 *        Calling it after the week's games are simulated still works for
 *        every other beat (stakes/streak/record/milestone/arc), just not a
 *        meaningful "here's who you're about to play" framing.
 *
 *   Nothing here should be called for an AI team on every page load across
 *   32 teams at once — it's sized for "the team(s) currently on screen,"
 *   same assumption lib/gmCareer.ts's buildGmCareerSummary makes.
 * ===========================================================================
 *
 * Every beat is grounded in a concrete queried fact (`Storyline.fact`) —
 * nothing here invents a narrative that isn't backed by an actual number.
 * Prose is templated and rng.pick'd for variety, matching lib/sim/recap.ts's
 * "PLACEHOLDER copy, structure is what matters" approach, not hand-tuned
 * purple prose.
 */

export type StorylineCategory = 'STAKES' | 'RIVALRY' | 'STREAK' | 'RECORD_CHASE' | 'PLAYER_ARC' | 'MILESTONE';

export interface Storyline {
  category: StorylineCategory;
  headline: string;
  detail: string;
  teamId?: string;
  playerId?: string;
  /** The concrete number/fact this beat is derived from — what makes it a beat and not an invented line. */
  fact: { label: string; value: number | string };
}

// records.ts doesn't export its category->label map (it's a private const
// scoped to recordBreakHeadline), so it's duplicated here rather than
// editing a file this module doesn't own. Same precedent as
// lib/dynastyScore.ts's own comment about duplicating lib/gmCareer.ts's
// hitThreshold rather than sharing it.
const CATEGORY_LABEL: Record<RecordCategory, string> = {
  passYds: 'passing yards', passTd: 'passing touchdowns', rushYds: 'rushing yards',
  recYds: 'receiving yards', tackles: 'tackles', sacks: 'sacks', defInt: 'interceptions',
};

// ---------------------------------------------------------------------------
// Postseason stakes — thin wrapper around lib/clinchScenario.ts, which
// already does the actual math. Nothing reimplemented here.
// ---------------------------------------------------------------------------
async function stakesStoryline(leagueId: string, teamId: string): Promise<Storyline | null> {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  const confTeams: StandingsTeam[] = await prisma.team.findMany({
    where: { leagueId, conference: team.conference },
    select: { id: true, division: true, wins: true, losses: true, ties: true, pointsFor: true, pointsAgnst: true },
  });
  const tag = clinchScenarioTag(computeClinchStatus(teamId, confTeams));
  if (!tag) return null;

  const record = `${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ''}`;
  return {
    category: 'STAKES',
    headline: `${team.city} ${team.nickname}: ${tag.label}`,
    detail: `${record} so far — ${tag.tone === 'good' ? 'the picture is set' : 'the math is no longer in their favor'}.`,
    teamId,
    fact: { label: 'record', value: record },
  };
}

// ---------------------------------------------------------------------------
// Win/loss streak — regular season only. Playoff week numbers collide with
// regular-season week numbers (see lib/rivalry.ts's header comment), and a
// single-elimination playoff loss ends the season rather than reading as
// "part of a streak," so mixing them in would misorder and misrepresent it.
// ---------------------------------------------------------------------------
function trailingStreak(games: { homeTeamId: string; awayTeamId: string; homeScore: number; awayScore: number }[], teamId: string): { result: 'W' | 'L'; count: number } | null {
  let result: 'W' | 'L' | null = null;
  let count = 0;
  for (let i = games.length - 1; i >= 0; i--) {
    const g = games[i];
    const isHome = g.homeTeamId === teamId;
    const mine = isHome ? g.homeScore : g.awayScore;
    const theirs = isHome ? g.awayScore : g.homeScore;
    if (mine === theirs) break; // a tie ends the streak
    const r: 'W' | 'L' = mine > theirs ? 'W' : 'L';
    if (result === null) { result = r; count = 1; continue; }
    if (r !== result) break;
    count++;
  }
  return result ? { result, count } : null;
}

const STREAK_MIN = 3; // [TUNE] a 2-game streak isn't a story yet

async function streakStoryline(leagueId: string, teamId: string, seasonYear: number, rng: Rng): Promise<Storyline | null> {
  const [team, games] = await Promise.all([
    prisma.team.findUniqueOrThrow({ where: { id: teamId } }),
    prisma.game.findMany({
      where: { leagueId, seasonYear, kind: 'REGULAR', played: true, OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] },
      orderBy: { week: 'asc' },
      select: { homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
    }),
  ]);
  const streak = trailingStreak(games, teamId);
  if (!streak || streak.count < STREAK_MIN) return null;

  const name = `${team.city} ${team.nickname}`;
  const headline = streak.result === 'W'
    ? rng.pick([`${name} have won ${streak.count} straight`, `${name} are riding a ${streak.count}-game winning streak`])
    : rng.pick([`${name} have dropped ${streak.count} straight`, `${name} are mired in a ${streak.count}-game losing streak`]);
  return {
    category: 'STREAK',
    headline,
    detail: `${streak.count} game${streak.count === 1 ? '' : 's'} and counting this season.`,
    teamId,
    fact: { label: `${streak.result === 'W' ? 'winning' : 'losing'} streak`, value: streak.count },
  };
}

// ---------------------------------------------------------------------------
// Rivalry / revenge-game framing for the next unplayed game on the schedule.
// Relies on lib/rivalry.ts entirely for the actual head-to-head computation.
// ---------------------------------------------------------------------------
async function rivalryStoryline(leagueId: string, teamId: string, rng: Rng): Promise<Storyline | null> {
  // REGULAR games for every remaining week already exist (played:false)
  // the moment a season's schedule is built, while a playoff round's games
  // aren't created until the prior round finishes — so "the next unplayed
  // game" is unambiguous even though playoff `week` values collide with
  // regular-season ones (the two kinds are never both pending at once).
  const next = await prisma.game.findFirst({
    where: { leagueId, played: false, OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] },
    orderBy: { week: 'asc' },
  });
  if (!next) return null;

  const opponentId = next.homeTeamId === teamId ? next.awayTeamId : next.homeTeamId;
  const profile = await computeRivalry(leagueId, teamId, opponentId);
  if (profile.intensity < RIVALRY_NARRATIVE_THRESHOLD) return null;

  const [team, opp] = await Promise.all([
    prisma.team.findUniqueOrThrow({ where: { id: teamId } }),
    prisma.team.findUniqueOrThrow({ where: { id: opponentId } }),
  ]);
  const name = `${team.city} ${team.nickname}`;
  const oppName = `${opp.city} ${opp.nickname}`;
  const atHome = next.homeTeamId === teamId;

  let detail: string;
  if (profile.streak && profile.streak.count >= 2) {
    detail = profile.streak.teamId === teamId
      ? `${name} have won ${profile.streak.count} straight in this series.`
      : `${name} have dropped ${profile.streak.count} straight to the ${oppName} — a revenge game if there ever was one.`;
  } else if (profile.meetings.length > 0) {
    const mine = teamId === profile.teamAId ? profile.record.teamAWins : profile.record.teamBWins;
    const theirs = teamId === profile.teamAId ? profile.record.teamBWins : profile.record.teamAWins;
    detail = `${name} lead the all-time series ${mine}-${theirs}.`;
  } else {
    detail = `First-ever meeting between these two.`;
  }

  return {
    category: 'RIVALRY',
    headline: rng.pick([
      `Rivalry ${atHome ? 'at home' : 'on the road'}: ${name} ${atHome ? 'host' : 'visit'} the ${oppName}`,
      `Circle it: ${name} vs ${oppName} this week`,
    ]),
    detail,
    teamId,
    fact: { label: 'head-to-head', value: `${profile.record.teamAWins}-${profile.record.teamBWins}${profile.record.ties ? `-${profile.record.ties}` : ''}` },
  };
}

// ---------------------------------------------------------------------------
// Record chase — LeagueRecord already IS the "current holder" table
// (lib/records.ts); this only compares this roster's active players against it.
// ---------------------------------------------------------------------------
const RECORD_CHASE_WINDOW = 0.15; // [TUNE] within 15% of the record is "closing in," not just "on the leaderboard somewhere"

async function recordChaseStorylines(leagueId: string, teamId: string): Promise<Storyline[]> {
  const [records, players] = await Promise.all([
    prisma.leagueRecord.findMany({ where: { leagueId } }),
    prisma.player.findMany({ where: { leagueId, teamId, status: 'ACTIVE' }, select: { id: true, firstName: true, lastName: true, seasonStats: true, careerStats: true } }),
  ]);
  const recordByKey = new Map(records.map((r) => [`${r.scope}:${r.category}`, r]));

  // A whole position group can legitimately cluster near the same record
  // (several linebackers all a few tackles apart, say) — real, but repetitive
  // as a digest of distinct "beats." Only the single closest chaser per
  // (scope, category) is kept; a team that already owns the record via
  // `isHolder` always wins that slot over anyone else still chasing it.
  const bestByKey = new Map<string, { isHolder: boolean; gap: number; storyline: Storyline }>();
  for (const p of players) {
    const season = readJson<SeasonStats>(p.seasonStats, {});
    // careerStats only folds in this season's totals at the offseason
    // rollover (lib/season.ts rollSeasonStatsIntoCareer) — mid-season it's
    // last year's total. Add the in-progress season back on top so a chase
    // reads against the player's true current career total, not a stale one.
    const careerToDate = mergeStats(readJson<SeasonStats>(p.careerStats, {}), season);
    const name = `${p.firstName} ${p.lastName}`;

    for (const cat of RECORD_CATEGORIES) {
      for (const [scope, value] of [['SEASON', season[cat] ?? 0], ['CAREER', careerToDate[cat] ?? 0]] as const) {
        if (value <= 0) continue;
        const rec = recordByKey.get(`${scope}:${cat}`);
        if (!rec) continue; // nothing to chase yet — first-ever value in a young league, not a record
        const isHolder = rec.playerId === p.id;
        const gap = rec.value - value;
        if (!isHolder && (gap <= 0 || gap / rec.value > RECORD_CHASE_WINDOW)) continue;

        const key = `${scope}:${cat}`;
        const existing = bestByKey.get(key);
        if (existing && (existing.isHolder || existing.gap <= gap)) continue;

        bestByKey.set(key, {
          isHolder, gap,
          storyline: {
            category: 'RECORD_CHASE',
            headline: isHolder
              ? `${name} is padding his own ${scope.toLowerCase()} ${CATEGORY_LABEL[cat]} record`
              : `${name} is closing in on the ${scope.toLowerCase()} ${CATEGORY_LABEL[cat]} record`,
            detail: isHolder
              ? `Already the record holder at ${value.toLocaleString()} ${CATEGORY_LABEL[cat]}, extending it as the season goes.`
              : `${gap.toLocaleString()} ${CATEGORY_LABEL[cat]} behind ${rec.playerName}'s record of ${rec.value.toLocaleString()}.`,
            teamId, playerId: p.id,
            fact: { label: CATEGORY_LABEL[cat], value },
          },
        });
      }
    }
  }
  return Array.from(bestByKey.values()).map((v) => v.storyline);
}

// ---------------------------------------------------------------------------
// Milestone season — round-number thresholds, distinct from the record book:
// "1,000 yards this season" is a story even for a player nowhere near the
// all-time record.
// ---------------------------------------------------------------------------
const MILESTONE_STEP: Record<RecordCategory, number> = {
  passYds: 1000, passTd: 10, rushYds: 500, recYds: 500, tackles: 50, sacks: 5, defInt: 3,
};
const MILESTONE_WINDOW: Record<RecordCategory, number> = {
  passYds: 150, passTd: 2, rushYds: 100, recYds: 100, tackles: 15, sacks: 1, defInt: 1,
};

async function milestoneStorylines(leagueId: string, teamId: string): Promise<Storyline[]> {
  const players = await prisma.player.findMany({
    where: { leagueId, teamId, status: 'ACTIVE' },
    select: { id: true, firstName: true, lastName: true, seasonStats: true },
  });

  const out: Storyline[] = [];
  for (const p of players) {
    const season = readJson<SeasonStats>(p.seasonStats, {});
    const name = `${p.firstName} ${p.lastName}`;
    for (const cat of RECORD_CATEGORIES) {
      const value = season[cat] ?? 0;
      if (value <= 0) continue;
      const step = MILESTONE_STEP[cat];
      const nextMilestone = Math.ceil((value + 1) / step) * step; // next round number strictly above the current total
      const gap = nextMilestone - value;
      if (gap > MILESTONE_WINDOW[cat]) continue;

      out.push({
        category: 'MILESTONE',
        headline: `${name} is ${gap.toLocaleString()} ${CATEGORY_LABEL[cat]} from ${nextMilestone.toLocaleString()} this season`,
        detail: `Sits at ${value.toLocaleString()} through this season's games.`,
        teamId, playerId: p.id,
        fact: { label: CATEGORY_LABEL[cat], value },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Player arcs — decline, breakout, contract year. Deliberately never reads
// Player.trueAttrs/trueOvr/devTrait: those are hidden ground truth the user
// doesn't see anywhere else in the app (schema comment: "never shown
// directly unless settings.revealTrueRatings"; devTrait has no UI reader at
// all, grep confirms). A storyline is user-facing prose, so "struggling
// star" is decided by comparing a player's own visible production against
// itself (this season vs his own career rate) rather than leaking a hidden
// rating the player was never supposed to see — the same "hide the number,
// show the read" idiom the genre research flags this game already uses for
// scouting ranges.
// ---------------------------------------------------------------------------
const ARC_MIN_SEASON_GP = 4; // [TUNE] enough games to not be noise
const ARC_MIN_CAREER_GP = 8;
const ARC_DECLINE_RATIO = 0.6; // [TUNE] this far below his own career rate reads as a real slump
const ARC_BREAKOUT_SCORE = 10; // [TUNE] per-game production bar for a late/undrafted rookie to read as a breakout
// [TUNE] A real 53-man roster routinely has a dozen-plus players in a
// walk year at once (verified against saved leagues — roughly 1 in 3 of an
// active roster) — "on an expiring deal" alone isn't a story for all of them
// simultaneously. Only the most productive few are worth calling out, the
// same editorial judgment a beat writer makes about which pending free
// agents actually matter to the season.
const CONTRACT_YEAR_SLOTS = 2;

async function playerArcStorylines(leagueId: string, teamId: string): Promise<Storyline[]> {
  const players = await prisma.player.findMany({
    where: { leagueId, teamId, status: 'ACTIVE' },
    select: {
      id: true, firstName: true, lastName: true, position: true, experience: true, draftRound: true,
      seasonStats: true, careerStats: true, contract: { select: { yearsRemaining: true } },
    },
  });

  const out: Storyline[] = [];
  const contractCandidates: { perGame: number; storyline: Storyline }[] = [];
  for (const p of players) {
    const season = readJson<SeasonStats>(p.seasonStats, {});
    const career = readJson<SeasonStats>(p.careerStats, {}); // prior seasons only — see comment above
    const isDefensive = DEFENSIVE_POSITIONS.has(p.position);
    const seasonGp = season.gp ?? 0;
    const name = `${p.firstName} ${p.lastName}`;

    if (seasonGp >= ARC_MIN_SEASON_GP) {
      const seasonPerGame = (isDefensive ? defensiveScore(season) : offensiveScore(season)) / seasonGp;
      const careerGp = career.gp ?? 0;

      if (p.experience >= 1 && careerGp >= ARC_MIN_CAREER_GP) {
        const careerPerGame = (isDefensive ? defensiveScore(career) : offensiveScore(career)) / careerGp;
        if (careerPerGame > 0 && seasonPerGame / careerPerGame <= ARC_DECLINE_RATIO) {
          out.push({
            category: 'PLAYER_ARC',
            headline: `${name} is off his career pace`,
            detail: `Producing ${seasonPerGame.toFixed(1)}/game this season against a ${careerPerGame.toFixed(1)}/game rate over his prior ${careerGp} games.`,
            teamId, playerId: p.id,
            fact: { label: 'season vs career pace', value: `${seasonPerGame.toFixed(1)} vs ${careerPerGame.toFixed(1)}` },
          });
        }
      }

      if (p.experience === 0 && (p.draftRound === null || p.draftRound >= 4) && seasonPerGame >= ARC_BREAKOUT_SCORE) {
        out.push({
          category: 'PLAYER_ARC',
          headline: `${name} is a breakout rookie`,
          detail: `${p.draftRound ? `A Round ${p.draftRound} pick` : 'Undrafted'}, producing ${seasonPerGame.toFixed(1)}/game through ${seasonGp} games.`,
          teamId, playerId: p.id,
          fact: { label: 'per-game production', value: Number(seasonPerGame.toFixed(1)) },
        });
      }

      if (p.contract && p.contract.yearsRemaining === 1) {
        contractCandidates.push({
          perGame: seasonPerGame,
          storyline: {
            category: 'PLAYER_ARC',
            headline: `${name} is playing on an expiring contract`,
            detail: `${seasonGp} games into a contract year, hitting free agency next offseason unless something changes.`,
            teamId, playerId: p.id,
            fact: { label: 'years remaining', value: p.contract.yearsRemaining },
          },
        });
      }
    }
  }

  contractCandidates.sort((a, b) => b.perGame - a.perGame);
  out.push(...contractCandidates.slice(0, CONTRACT_YEAR_SLOTS).map((c) => c.storyline));
  return out;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------
const CATEGORY_PRIORITY: StorylineCategory[] = ['STAKES', 'RIVALRY', 'STREAK', 'RECORD_CHASE', 'MILESTONE', 'PLAYER_ARC'];

export interface GenerateStorylinesOptions {
  limit?: number; // [TUNE] default keeps a Dashboard widget to a scroll, not a wall of text
}

export async function generateStorylines(leagueId: string, teamId: string, opts: GenerateStorylinesOptions = {}): Promise<Storyline[]> {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  // Seeded from stable ids + the current week, not Date.now()/Math.random —
  // so phrasing is stable if this gets called more than once for the same
  // week (e.g. a page re-render), matching lib/season.ts's own Rng seeding
  // convention for advanceWeek.
  const rng = new Rng(`${leagueId}-${teamId}-${league.seasonYear}-${league.week}-storyline`);

  const inSeason = league.phase === 'REGULAR' || league.phase === 'PLAYOFFS';
  const [stakes, streak, rivalry, records, milestones, arcs] = await Promise.all([
    league.phase === 'REGULAR' ? stakesStoryline(leagueId, teamId) : Promise.resolve(null),
    inSeason ? streakStoryline(leagueId, teamId, league.seasonYear, rng) : Promise.resolve(null),
    inSeason ? rivalryStoryline(leagueId, teamId, rng) : Promise.resolve(null),
    recordChaseStorylines(leagueId, teamId),
    milestoneStorylines(leagueId, teamId),
    playerArcStorylines(leagueId, teamId),
  ]);

  const all = [stakes, streak, rivalry, ...records, ...milestones, ...arcs].filter((s): s is Storyline => s !== null);
  all.sort((a, b) => CATEGORY_PRIORITY.indexOf(a.category) - CATEGORY_PRIORITY.indexOf(b.category));
  return all.slice(0, opts.limit ?? 8);
}
