import { prisma } from './db';
import { Rng } from './rng';

/**
 * ===========================================================================
 * RIVALRY
 * ===========================================================================
 * Rivalry isn't stored anywhere in the schema — deliberately: it's derived
 * entirely from Game history plus Team.division/conference, the same
 * "compute it from what already happened" approach lib/clinchScenario.ts and
 * lib/standingsTrend.ts already take. No new schema means nothing here can
 * ever drift out of sync with the games that actually got played.
 *
 * What the schema can and can't actually support, so nothing below overclaims:
 *  - Head-to-head record, margins, and meeting frequency: fully queryable —
 *    Game rows are never pruned across seasons, so a league played for many
 *    years has a real multi-season head-to-head history to draw on.
 *  - Playoff meetings: fully queryable — Game.kind is one of REGULAR |
 *    WILDCARD | DIVISIONAL | CONFERENCE | FINAL, so "have these two ever met
 *    in the playoffs" is a plain `kind != REGULAR` filter, not a guess.
 *  - What it CANNOT support: anything from before this league existed (no
 *    real-world/prior-franchise history), or a human-authored "grudge" (a
 *    specific trade or incident that started a rivalry) — there's no event
 *    log tying a Transaction to a Game, so a rivalry here is always a
 *    statistical pattern, never a remembered incident.
 *
 * Playoff games are NOT chronologically sortable by (seasonYear, week) alone
 * — lib/season.ts resets `week` for the playoffs (WILDCARD=1, DIVISIONAL
 * and CONFERENCE both =2, FINAL=4), which collides with regular-season week
 * numbers 1-17 AND with each other. Meetings are ordered by seasonYear then
 * a round rank derived from `kind`, never raw `week`, to stay correct.
 * ===========================================================================
 */

export interface RivalryMeeting {
  gameId: string;
  seasonYear: number;
  week: number;
  kind: string; // REGULAR | WILDCARD | DIVISIONAL | CONFERENCE | FINAL
  winnerTeamId: string | null; // null on a tie
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
}

export interface RivalryStreak {
  teamId: string; // the team currently on the run
  count: number;
}

export interface RivalryProfile {
  teamAId: string;
  teamBId: string;
  sameDivision: boolean;
  // Chronological, oldest first, played games only. Short enough in practice
  // (a handful of meetings per real season) that callers can just slice the
  // tail themselves for "recent history" rather than this module picking an
  // arbitrary window size for them.
  meetings: RivalryMeeting[];
  record: { teamAWins: number; teamBWins: number; ties: number };
  playoffMeetings: number;
  avgMargin: number | null; // average |home-away| points across all meetings; null with no meetings
  streak: RivalryStreak | null; // current unbroken run within this head-to-head series; null if the last meeting tied or there's no history
  intensity: number; // 0-100
  breakdown: { label: string; points: number }[]; // transparent scoring, same shape as lib/dynastyScore.ts's breakdown
}

// [TUNE] Points behind the 0-100 intensity score, named so the breakdown
// array and the total can never silently drift apart.
const INTENSITY = {
  DIVISION_BASELINE: 30, // division opponents play twice a year by construction (lib/schedule.ts) — a guaranteed recurring series
  PER_MEETING: 4,
  MEETING_CAP: 25,
  PLAYOFF_PER_MEETING: 15, // a playoff game carries real stakes, not just another data point
  PLAYOFF_CAP: 30,
  CLOSENESS_CAP: 20, // tight games sting more than blowouts
  STREAK_PER_GAME: 2,
  STREAK_CAP: 10,
};

const ROUND_RANK: Record<string, number> = { WILDCARD: 1, DIVISIONAL: 2, CONFERENCE: 3, FINAL: 4 };
/** Sortable-within-a-season chronological key. Regular season keeps its real week; every playoff round sorts after ANY regular-season week, ordered by round rather than the (colliding) `week` column. */
function chronoKey(kind: string, week: number): number {
  return kind === 'REGULAR' ? week : 1000 + (ROUND_RANK[kind] ?? 5);
}

function toMeeting(g: { id: string; seasonYear: number; week: number; kind: string; homeTeamId: string; awayTeamId: string; homeScore: number; awayScore: number }): RivalryMeeting {
  return {
    gameId: g.id, seasonYear: g.seasonYear, week: g.week, kind: g.kind,
    homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId, homeScore: g.homeScore, awayScore: g.awayScore,
    winnerTeamId: g.homeScore === g.awayScore ? null : g.homeScore > g.awayScore ? g.homeTeamId : g.awayTeamId,
  };
}

function sortMeetings(meetings: RivalryMeeting[]): RivalryMeeting[] {
  return [...meetings].sort((a, b) => a.seasonYear - b.seasonYear || chronoKey(a.kind, a.week) - chronoKey(b.kind, b.week));
}

/** Pure, no I/O — so topRival() can build many profiles off one games query instead of one round trip per candidate opponent. */
export function buildRivalryProfile(teamAId: string, teamBId: string, sameDivision: boolean, rawMeetings: RivalryMeeting[]): RivalryProfile {
  const meetings = sortMeetings(rawMeetings);

  let teamAWins = 0, teamBWins = 0, ties = 0, marginSum = 0, playoffMeetings = 0;
  for (const m of meetings) {
    if (m.kind !== 'REGULAR') playoffMeetings++;
    marginSum += Math.abs(m.homeScore - m.awayScore);
    if (m.winnerTeamId === null) ties++;
    else if (m.winnerTeamId === teamAId) teamAWins++;
    else teamBWins++;
  }
  const avgMargin = meetings.length > 0 ? marginSum / meetings.length : null;

  let streak: RivalryStreak | null = null;
  for (let i = meetings.length - 1; i >= 0; i--) {
    const w = meetings[i].winnerTeamId;
    if (w === null) break; // a tie breaks any streak, current or forming
    if (streak === null) { streak = { teamId: w, count: 1 }; continue; }
    if (w === streak.teamId) streak.count++;
    else break;
  }

  const breakdown: { label: string; points: number }[] = [];
  if (sameDivision) breakdown.push({ label: 'Division opponent', points: INTENSITY.DIVISION_BASELINE });
  if (meetings.length > 0) {
    breakdown.push({ label: `${meetings.length} meeting${meetings.length === 1 ? '' : 's'}`, points: Math.min(INTENSITY.MEETING_CAP, meetings.length * INTENSITY.PER_MEETING) });
  }
  if (playoffMeetings > 0) {
    breakdown.push({ label: `${playoffMeetings} playoff meeting${playoffMeetings === 1 ? '' : 's'}`, points: Math.min(INTENSITY.PLAYOFF_CAP, playoffMeetings * INTENSITY.PLAYOFF_PER_MEETING) });
  }
  if (avgMargin !== null) {
    const closeness = Math.max(0, Math.round(INTENSITY.CLOSENESS_CAP - avgMargin));
    if (closeness > 0) breakdown.push({ label: `Avg margin ${avgMargin.toFixed(1)}`, points: closeness });
  }
  // A 1-game "streak" is just the last result — only 2+ in a row reads as a real trend worth pointing at.
  if (streak && streak.count >= 2) {
    breakdown.push({ label: `${streak.count}-game streak`, points: Math.min(INTENSITY.STREAK_CAP, streak.count * INTENSITY.STREAK_PER_GAME) });
  }

  const intensity = Math.min(100, breakdown.reduce((sum, b) => sum + b.points, 0));

  return { teamAId, teamBId, sameDivision, meetings, record: { teamAWins, teamBWins, ties }, playoffMeetings, avgMargin, streak, intensity, breakdown };
}

export async function computeRivalry(leagueId: string, teamAId: string, teamBId: string): Promise<RivalryProfile> {
  const [teamA, teamB, games] = await Promise.all([
    prisma.team.findUniqueOrThrow({ where: { id: teamAId }, select: { division: true, conference: true } }),
    prisma.team.findUniqueOrThrow({ where: { id: teamBId }, select: { division: true, conference: true } }),
    prisma.game.findMany({
      where: { leagueId, played: true, OR: [{ homeTeamId: teamAId, awayTeamId: teamBId }, { homeTeamId: teamBId, awayTeamId: teamAId }] },
      select: { id: true, seasonYear: true, week: true, kind: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
    }),
  ]);
  const sameDivision = teamA.conference === teamB.conference && teamA.division === teamB.division;
  return buildRivalryProfile(teamAId, teamBId, sameDivision, games.map(toMeeting));
}

/** Highest-intensity opponent a team has ever played, or a current division mate if the league is too young to have any games yet (still the only guaranteed-recurring series at that point). */
export async function topRival(leagueId: string, teamId: string): Promise<RivalryProfile | null> {
  const [team, allTeams, games] = await Promise.all([
    prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { division: true, conference: true } }),
    prisma.team.findMany({ where: { leagueId }, select: { id: true, division: true, conference: true } }),
    prisma.game.findMany({
      where: { leagueId, played: true, OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] },
      select: { id: true, seasonYear: true, week: true, kind: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
    }),
  ]);

  const meetingsByOpponent = new Map<string, RivalryMeeting[]>();
  for (const g of games) {
    const oppId = g.homeTeamId === teamId ? g.awayTeamId : g.homeTeamId;
    if (!meetingsByOpponent.has(oppId)) meetingsByOpponent.set(oppId, []);
    meetingsByOpponent.get(oppId)!.push(toMeeting(g));
  }

  const candidateIds = new Set(meetingsByOpponent.keys());
  for (const t of allTeams) {
    if (t.id !== teamId && t.division === team.division && t.conference === team.conference) candidateIds.add(t.id);
  }

  let best: RivalryProfile | null = null;
  for (const oppId of candidateIds) {
    const opp = allTeams.find((t) => t.id === oppId);
    if (!opp) continue;
    const sameDivision = opp.conference === team.conference && opp.division === team.division;
    const profile = buildRivalryProfile(teamId, oppId, sameDivision, meetingsByOpponent.get(oppId) ?? []);
    if (!best || profile.intensity > best.intensity || (profile.intensity === best.intensity && profile.meetings.length > best.meetings.length)) {
      best = profile;
    }
  }
  return best;
}

/** [TUNE] Minimum intensity for a rivalry to be worth surfacing in prose (recap sentence, news detail, or a storyline beat) rather than staying a silent number. */
export const RIVALRY_NARRATIVE_THRESHOLD = 45;

/**
 * One retrospective sentence for lib/sim/recap.ts. `profile` MUST be computed
 * from the state BEFORE this game was recorded (i.e. call computeRivalry()
 * before the Game row is marked played) — the streak/record referenced is
 * what was true walking in, and this game's already-known result is added
 * back on top of it explicitly below, rather than trusting a profile that
 * might already include the very game being described.
 */
export function rivalryRecapLine(
  profile: RivalryProfile,
  args: { winnerTeamId: string; winnerName: string; loserName: string },
  rng: Rng,
): string | null {
  const { winnerTeamId, winnerName, loserName } = args;

  // A division pairing's first-ever game is worth a line on its own, gated
  // separately from the general threshold below: with zero meetings the only
  // possible contributor to `intensity` is the division baseline (see
  // INTENSITY.DIVISION_BASELINE, capped at 30) — nothing with no history
  // could ever clear RIVALRY_NARRATIVE_THRESHOLD by itself, so gating this
  // on the same check as everything else would make it permanently
  // unreachable. Non-division opponents meeting for the first time is just
  // a random scheduling draw, not a rivalry opener, so it stays silent.
  if (profile.meetings.length === 0) {
    if (!profile.sameDivision) return null;
    return rng.pick([
      `First-ever meeting between these two, and it went to the ${winnerName}.`,
      `A new rivalry starts here — the ${winnerName} take the opener.`,
    ]);
  }

  if (profile.intensity < RIVALRY_NARRATIVE_THRESHOLD) return null;

  if (profile.streak && profile.streak.count >= 2) {
    if (profile.streak.teamId === winnerTeamId) {
      return rng.pick([
        `It's now ${profile.streak.count + 1} straight in this series for the ${winnerName}.`,
        `${loserName} still haven't solved them — the ${winnerName} have won ${profile.streak.count + 1} in a row here.`,
      ]);
    }
    return rng.pick([
      `The ${winnerName} finally broke through, snapping a ${profile.streak.count}-game run by the ${loserName} in this series.`,
      `That ends a ${profile.streak.count}-game skid for the ${winnerName} against the ${loserName}.`,
    ]);
  }

  const winnerWins = (winnerTeamId === profile.teamAId ? profile.record.teamAWins : profile.record.teamBWins) + 1;
  const loserWins = winnerTeamId === profile.teamAId ? profile.record.teamBWins : profile.record.teamAWins;
  return rng.pick([
    `The ${winnerName} lead the all-time series ${winnerWins}-${loserWins} after that one.`,
    `A rivalry that rarely disappoints — the ${winnerName} and ${loserName} keep trading blows.`,
  ]);
}

/** Short factual clause for lib/news.ts — no Rng, since a news detail line stays a plain statement rather than templated prose (matches this file's existing style, which never uses one). */
export function rivalryHeadlineFragment(
  profile: RivalryProfile,
  args: { winnerTeamId: string; winnerAbbr: string; loserAbbr: string },
): string | null {
  const { winnerTeamId, winnerAbbr, loserAbbr } = args;

  // Same reasoning as rivalryRecapLine's first-meeting branch: zero
  // meetings can never clear the general threshold on the division
  // baseline alone, so it needs its own gate.
  if (profile.meetings.length === 0) {
    return profile.sameDivision ? `First meeting: ${winnerAbbr} vs ${loserAbbr}.` : null;
  }

  if (profile.intensity < RIVALRY_NARRATIVE_THRESHOLD) return null;
  if (profile.streak && profile.streak.count >= 2 && profile.streak.teamId === winnerTeamId) {
    return `Rivalry: ${winnerAbbr} has now beaten ${loserAbbr} ${profile.streak.count + 1} straight.`;
  }
  return `Rivalry matchup: ${winnerAbbr} vs ${loserAbbr}.`;
}
