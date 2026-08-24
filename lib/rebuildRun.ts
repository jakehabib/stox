import { prisma } from './db';
import { readJson } from './json';
import { loadRebuildStanding, type RebuildStanding } from './rebuildState';
import type { TradeAssetSnapshot } from './tradeRetro';

/**
 * ===========================================================================
 * THE WHOLE CLIMB, ASSEMBLED — the record behind the championship page
 * ===========================================================================
 * The payoff screen for a finished rebuild wants to say a lot at once: where
 * he started, what he did, how each season went, and the night it ended. This
 * is the one read that gathers it.
 *
 * EVERY FIELD IS A STORED FACT AND NOTHING IS SUMMARISED INTO EXISTENCE.
 *
 *   WHERE HE STARTED  is the founding transaction's own text, quoted verbatim.
 *                     It was written by the generator with the club's REAL
 *                     opening cap space and dead money in it (see
 *                     rebuildHandoverNote), so the page cannot describe a
 *                     starting hand different from the one that was dealt —
 *                     it is not re-derived, it is the same sentence.
 *   THE CLIMB         is TeamSeasonRecord, one row per season, unedited.
 *   THE MEN HE FOUND  is DraftPick joined to Player: his own early picks, with
 *                     the rating each man carries today.
 *   THE DEALS         is TradeRecord, priced at the moment each was struck.
 *   THE NIGHT         is the FINAL Game row and its score.
 *
 * WHAT IS SELECTED AND BY WHAT RULE, stated because a curated list that does
 * not say it is curated is a quiet lie: the picks are rounds 1-2 only, and the
 * deals are every trade the club made. Nothing is ranked, filtered by outcome,
 * or chosen for how good it makes the GM look — a bad first-rounder appears
 * exactly like a good one.
 *
 * THE RUN ENDS AT THE FIRST TITLE. Seasons after it are a different story and
 * are not on this page, for the same reason the leaderboard number stops
 * there: this is a record of the climb, not of the franchise.
 * ===========================================================================
 */

export interface RebuildSeasonLine {
  year: number;
  /** 1-based season of the run — the same counting the board uses. */
  season: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgnst: number;
  playoffResult: string;
}

export interface RebuildPick {
  year: number;
  round: number;
  name: string;
  position: string;
  /** What he is rated TODAY, not what he was drafted at. */
  ovr: number;
}

export interface RebuildTrade {
  year: number;
  partnerAbbr: string;
  got: string[];
  gave: string[];
}

export interface RebuildRun {
  standing: RebuildStanding;
  leagueName: string;
  club: { id: string; abbr: string; city: string; nickname: string };
  /** The account's username, when the save has been claimed. Never invented. */
  gmName: string | null;
  /** The founding note, verbatim, or null on a save that predates it. */
  handover: string | null;
  seasons: RebuildSeasonLine[];
  picks: RebuildPick[];
  trades: RebuildTrade[];
  /** The championship game itself. */
  final: {
    year: number;
    opponentAbbr: string;
    opponentName: string;
    us: number;
    them: number;
  } | null;
  totals: { wins: number; losses: number; ties: number; seasons: number };
}

/**
 * Null unless this save is a REBUILD run that actually won it. The page is a
 * 404 in every other case rather than an empty celebration — there is nothing
 * honest for it to show a run that has not finished.
 */
export async function loadRebuildRun(leagueId: string): Promise<RebuildRun | null> {
  const standing = await loadRebuildStanding(leagueId);
  if (standing.state !== 'WON' || standing.seasonsToTitle === null || standing.firstTitleYear === null) {
    return null;
  }

  const league = await prisma.league.findUniqueOrThrow({
    where: { id: leagueId },
    select: { id: true, name: true, userTeamId: true, user: { select: { username: true } } },
  });
  if (!league.userTeamId) return null;
  const teamId = league.userTeamId;

  const from = standing.tenureStartYear;
  const to = standing.firstTitleYear;

  const [club, records, founding, draftPicks, tradeRows, finalGame] = await Promise.all([
    prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { id: true, abbr: true, city: true, nickname: true },
    }),
    prisma.teamSeasonRecord.findMany({
      where: { teamId, year: { gte: from, lte: to } },
      orderBy: { year: 'asc' },
      select: { year: true, wins: true, losses: true, ties: true, pointsFor: true, pointsAgnst: true, playoffResult: true },
    }),
    // The handover note the generator wrote on day one. `week: 0` is the
    // founding row and there is exactly one.
    prisma.transaction.findFirst({
      where: { leagueId, week: 0, seasonYear: from },
      select: { detail: true },
    }),
    prisma.draftPick.findMany({
      where: { ownerTeamId: teamId, used: true, round: { lte: 2 }, year: { gte: from, lte: to }, playerId: { not: null } },
      orderBy: [{ year: 'asc' }, { round: 'asc' }],
      select: {
        year: true, round: true,
        player: { select: { firstName: true, lastName: true, position: true, trueOvr: true } },
      },
    }),
    prisma.tradeRecord.findMany({
      where: {
        leagueId,
        seasonYear: { gte: from, lte: to },
        OR: [{ teamAId: teamId }, { teamBId: teamId }],
      },
      orderBy: [{ seasonYear: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.game.findFirst({
      where: { leagueId, seasonYear: to, kind: 'FINAL', played: true },
      select: { homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
    }),
  ]);

  let final: RebuildRun['final'] = null;
  if (finalGame) {
    const home = finalGame.homeTeamId === teamId;
    const oppId = home ? finalGame.awayTeamId : finalGame.homeTeamId;
    const opp = await prisma.team.findUnique({
      where: { id: oppId },
      select: { abbr: true, city: true, nickname: true },
    });
    final = {
      year: to,
      opponentAbbr: opp?.abbr ?? '???',
      opponentName: opp ? `${opp.city} ${opp.nickname}` : 'the other club',
      us: home ? finalGame.homeScore : finalGame.awayScore,
      them: home ? finalGame.awayScore : finalGame.homeScore,
    };
  }

  const seasons: RebuildSeasonLine[] = records.map((r) => ({
    year: r.year,
    season: r.year - from + 1,
    wins: r.wins,
    losses: r.losses,
    ties: r.ties,
    pointsFor: r.pointsFor,
    pointsAgnst: r.pointsAgnst,
    playoffResult: r.playoffResult,
  }));

  return {
    standing,
    leagueName: league.name,
    club,
    gmName: league.user?.username ?? null,
    handover: founding?.detail || null,
    seasons,
    picks: draftPicks
      .filter((p) => p.player)
      .map((p) => ({
        year: p.year,
        round: p.round,
        name: `${p.player!.firstName} ${p.player!.lastName}`,
        position: p.player!.position,
        ovr: p.player!.trueOvr,
      })),
    trades: tradeRows.map((t) => {
      const mine = t.teamAId === teamId;
      return {
        year: t.seasonYear,
        partnerAbbr: mine ? t.teamBAbbr : t.teamAAbbr,
        got: assetLabels(mine ? t.bToA : t.aToB),
        gave: assetLabels(mine ? t.aToB : t.bToA),
      };
    }),
    final,
    totals: {
      wins: seasons.reduce((a, s) => a + s.wins, 0),
      losses: seasons.reduce((a, s) => a + s.losses, 0),
      ties: seasons.reduce((a, s) => a + s.ties, 0),
      seasons: seasons.length,
    },
  };
}

/**
 * Asset snapshots to short labels. Reads the same JSON lib/tradeRetro.ts wrote
 * rather than re-pricing anything — this page reports what was traded, and the
 * grading of whether it was a good idea lives on the retro panel that owns it.
 */
function assetLabels(json: string): string[] {
  return readJson<TradeAssetSnapshot[]>(json, []).map((a) => a.label);
}
