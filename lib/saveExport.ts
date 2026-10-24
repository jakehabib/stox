/**
 * ===========================================================================
 * A LEAGUE IN THE DATABASE -> A CHALLENGE FILE
 * ===========================================================================
 *
 * The read side. Pure in the sense that matters: it writes nothing, it changes
 * nothing about the save it is reading, and a publisher can export the same
 * league twice and get the same document.
 *
 * ONE PASS, ONE ID MAP. Every reference in the format is an index
 * (lib/saveFile.ts, REFERENCES ARE INDEXES), so this builds three maps —
 * team id -> index, player id -> index, pick id -> index — before it emits
 * anything that refers to a row. Anything that cannot be mapped is a row whose
 * target is not in the save, and each of those is handled explicitly below
 * rather than defaulting to index 0, which is how a foreign key silently
 * becomes the wrong club.
 *
 * WHAT IS LEFT OUT IS LEFT OUT HERE, VISIBLY:
 *
 *   ScoutingReport, ShortlistEntry  — the publisher's fog of war. Never read.
 *   DynastyProfile, DynastyRank     — the publisher's career. Never read.
 *   User, Session, AuthAttempt      — the account. Never read.
 *   DepthChartSlot                  — read, and COMPACTED to ordered indexes.
 *
 * ORDER IS STABLE AND EXPLICIT. Every query carries an `orderBy`, because the
 * indexes in the document are positional: without it, Postgres is free to
 * return rows in whatever order it likes and two exports of one unchanged
 * league would produce two different documents that happen to mean the same
 * thing. A stable document is what makes a byte-for-byte fidelity comparison
 * possible at all.
 * ===========================================================================
 */
import { prisma } from './db';
import { readJson } from './json';
import { resolveStartYear } from './leagueYear';
import {
  SAVE_FILE_KIND,
  SAVE_FORMAT_VERSION,
  SAVE_LIMITS,
  SaveAssetRef,
  SaveFile,
  SaveHistory,
  SaveTeam,
  SaveTradeSnapshot,
  STORED_ID_PATTERN,
  playerToken,
  teamToken,
} from './saveFile';

/** What the publisher chooses at publish time. */
export interface SaveExportOptions {
  /**
   * Carry the retrospective tables. Off means a smaller file that plays
   * identically and has nothing in the record books — see the header of
   * lib/saveFile.ts.
   */
  includeHistory: boolean;
  /** The framing. Trimmed and bounded here so the reader never has to. */
  title: string;
  brief: string;
}

/** Trim, collapse whitespace, bound. The card is a line of prose, not a blob. */
function tidy(raw: string, max: number): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Reads one league out as a challenge.
 *
 * THE CALLER PROVES OWNERSHIP, not this function — it takes a league id that a
 * route has already established belongs to the caller, exactly as
 * `exportLeagueFile` does. Nothing here reads a cookie.
 */
export async function exportSaveFile(leagueId: string, opts: SaveExportOptions): Promise<SaveFile> {
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: leagueId },
    select: {
      id: true, name: true, seasonYear: true, startYear: true, week: true, phase: true,
      contractsAgedYear: true, resignWarnedYear: true, settings: true, userTeamId: true,
    },
  });

  // Founded, not hired. `capForYear` measures the ceiling from this, so it is
  // the one year that must survive the trip intact; the GM's hire year is
  // stamped fresh by the importer. Resolved rather than read raw so a save
  // predating the column exports a real number instead of a null the reader
  // would refuse.
  const startYear = await resolveStartYear(league);

  const teams = await prisma.team.findMany({
    where: { leagueId },
    orderBy: { id: 'asc' },
    include: {
      staff: { orderBy: { id: 'asc' } },
      scouts: { orderBy: { id: 'asc' } },
      capCharges: { orderBy: [{ year: 'asc' }, { id: 'asc' }] },
      depthChart: { orderBy: [{ position: 'asc' }, { rank: 'asc' }] },
    },
  });
  if (teams.length !== SAVE_LIMITS.TEAM_COUNT) {
    throw new Error(`This save holds ${teams.length} clubs; a challenge is exactly ${SAVE_LIMITS.TEAM_COUNT}.`);
  }
  const teamIdx = new Map(teams.map((t, i) => [t.id, i]));

  const players = await prisma.player.findMany({
    where: { leagueId },
    orderBy: { id: 'asc' },
    include: { contract: true },
  });
  const playerIdx = new Map(players.map((p, i) => [p.id, i]));

  const picks = await prisma.draftPick.findMany({
    where: { leagueId },
    orderBy: [{ year: 'asc' }, { round: 'asc' }, { slot: 'asc' }, { id: 'asc' }],
  });
  const pickIdx = new Map(picks.map((p, i) => [p.id, i]));

  const [draftState, games, transactions, tradeOffers, negotiations, seasonRecords] = await Promise.all([
    prisma.draftState.findUnique({ where: { leagueId } }),
    prisma.game.findMany({ where: { leagueId }, orderBy: [{ seasonYear: 'asc' }, { week: 'asc' }, { id: 'asc' }] }),
    prisma.transaction.findMany({ where: { leagueId }, orderBy: [{ seasonYear: 'asc' }, { week: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] }),
    prisma.tradeOffer.findMany({ where: { leagueId }, orderBy: { id: 'asc' } }),
    prisma.negotiationTalks.findMany({ where: { leagueId }, orderBy: { id: 'asc' } }),
    prisma.teamSeasonRecord.findMany({ where: { leagueId }, orderBy: [{ year: 'asc' }, { teamId: 'asc' }] }),
  ]);

  /**
   * A stored `TradeAsset[]` -> indexes. Returns null if ANY asset in the list
   * fails to resolve, because half a trade proposal is not a proposal: the
   * caller drops the whole offer rather than handing the recipient an offer
   * that cannot be accepted.
   */
  const remapAssets = (raw: string): SaveAssetRef[] | null => {
    const assets = readJson<{ type?: unknown; id?: unknown }[]>(raw, []);
    if (!Array.isArray(assets)) return null;
    const out: SaveAssetRef[] = [];
    for (const a of assets) {
      if (a?.type !== 'PLAYER' && a?.type !== 'PICK') return null;
      if (typeof a.id !== 'string') return null;
      const idx = a.type === 'PLAYER' ? playerIdx.get(a.id) : pickIdx.get(a.id);
      if (idx == null) return null;
      out.push({ type: a.type, ref: idx });
    }
    return out;
  };

  /**
   * THE BOX-SCORE REWRITE. See THE ONE BLOB THAT HAS IDS INSIDE IT in
   * lib/saveFile.ts for why this exists and why it is exact-match: a cuid that
   * is not one of this league's own clubs or players is left alone.
   */
  const idToken = new Map<string, string>();
  teams.forEach((row, i) => idToken.set(row.id, teamToken(i)));
  players.forEach((row, i) => idToken.set(row.id, playerToken(i)));
  const tokenise = (text: string): string =>
    text.replace(STORED_ID_PATTERN, (m) => idToken.get(m) ?? m);

  const savedTeams: SaveTeam[] = teams.map((t) => {
    const depthChart: Record<string, number[]> = {};
    for (const slot of t.depthChart) {
      const idx = playerIdx.get(slot.playerId);
      // A depth slot naming a player this league does not hold is already
      // broken in the source save; dropping it is the only option that
      // produces a readable file, and the invariant suite on the way in is
      // what decides whether what remains is playable.
      if (idx == null) continue;
      (depthChart[slot.position] ??= []).push(idx);
    }
    return {
      city: t.city,
      nickname: t.nickname,
      abbr: t.abbr,
      conference: t.conference,
      division: t.division,
      isUser: t.isUser,
      prestige: t.prestige,
      gmProfile: t.gmProfile,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      pointsFor: t.pointsFor,
      pointsAgnst: t.pointsAgnst,
      divWins: t.divWins,
      divLosses: t.divLosses,
      confWins: t.confWins,
      confLosses: t.confLosses,
      playoffSeed: t.playoffSeed,
      eliminated: t.eliminated,
      scoutPoints: t.scoutPoints,
      scoutPeriod: t.scoutPeriod,
      scoutPeriodGrant: t.scoutPeriodGrant,
      scoutSpentSeason: t.scoutSpentSeason,
      staff: t.staff.map((s) => ({
        role: s.role, name: s.name, rating: s.rating, playCalling: s.playCalling,
        development: s.development, contractYears: s.contractYears, salary: s.salary,
      })),
      scouts: t.scouts.map((s) => ({
        name: s.name, accuracy: s.accuracy, speed: s.speed, specialty: s.specialty, salary: s.salary,
      })),
      capCharges: t.capCharges.map((c) => ({ year: c.year, amount: c.amount, label: c.label })),
      depthChart,
    };
  });

  const history: SaveHistory | null = opts.includeHistory
    ? await exportHistory(leagueId, teamIdx, playerIdx, pickIdx)
    : null;

  const file: SaveFile = {
    kind: SAVE_FILE_KIND,
    formatVersion: SAVE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    challenge: {
      title: tidy(opts.title, SAVE_LIMITS.MAX_CHALLENGE_TITLE),
      brief: tidy(opts.brief, SAVE_LIMITS.MAX_CHALLENGE_BRIEF),
    },
    league: {
      name: league.name.slice(0, SAVE_LIMITS.MAX_LEAGUE_NAME),
      seasonYear: league.seasonYear,
      startYear,
      week: league.week,
      phase: league.phase,
      contractsAgedYear: league.contractsAgedYear,
      resignWarnedYear: league.resignWarnedYear,
      settings: league.settings,
      // The club the challenge hands over. A headless league (no club flagged)
      // exports as null and the recipient picks one on the way in.
      userTeam: league.userTeamId != null ? teamIdx.get(league.userTeamId) ?? null : null,
    },
    teams: savedTeams,
    players: players.map((p) => ({
      team: p.teamId != null ? teamIdx.get(p.teamId) ?? null : null,
      firstName: p.firstName,
      lastName: p.lastName,
      position: p.position,
      age: p.age,
      experience: p.experience,
      heightIn: p.heightIn,
      weightLb: p.weightLb,
      college: p.college,
      trueAttrs: p.trueAttrs,
      trueOvr: p.trueOvr,
      potential: p.potential,
      devTrait: p.devTrait,
      lastSeasonOvr: p.lastSeasonOvr,
      status: p.status,
      isDraftee: p.isDraftee,
      draftYear: p.draftYear,
      draftRound: p.draftRound,
      draftPickNo: p.draftPickNo,
      collegeStats: p.collegeStats,
      combineTesting: p.combineTesting,
      devFocus: p.devFocus,
      yearsUnsigned: p.yearsUnsigned,
      weeksUnsigned: p.weeksUnsigned,
      injuryWeeks: p.injuryWeeks,
      injuryType: p.injuryType,
      fatigue: p.fatigue,
      morale: p.morale,
      seasonStats: p.seasonStats,
      careerStats: p.careerStats,
      playoffStats: p.playoffStats,
      careerPlayoffStats: p.careerPlayoffStats,
      contract: p.contract
        ? {
          years: p.contract.years,
          yearsRemaining: p.contract.yearsRemaining,
          signedYear: p.contract.signedYear,
          baseSalaries: p.contract.baseSalaries,
          signingBonus: p.contract.signingBonus,
          guaranteed: p.contract.guaranteed,
          isRookieDeal: p.contract.isRookieDeal,
          isFranchiseTag: p.contract.isFranchiseTag,
          fifthYearOption: p.contract.fifthYearOption,
          voidYears: p.contract.voidYears,
          team: p.contract.teamId != null ? teamIdx.get(p.contract.teamId) ?? null : null,
        }
        : null,
    })),
    picks: picks.map((p) => ({
      year: p.year,
      round: p.round,
      slot: p.slot,
      // A pick's two club columns are real foreign keys with a cascade, so
      // neither can dangle: a missing index here would be a league whose teams
      // query and picks query disagreed, which is a fault rather than a
      // tolerable gap.
      originalTeam: required(teamIdx.get(p.originalTeamId), `pick ${p.id} original club`),
      ownerTeam: required(teamIdx.get(p.ownerTeamId), `pick ${p.id} owning club`),
      used: p.used,
      player: p.playerId != null ? playerIdx.get(p.playerId) ?? null : null,
    })),
    draftState: draftState
      ? {
        kind: draftState.kind,
        round: draftState.round,
        pickIndex: draftState.pickIndex,
        // Pick ids -> indexes. An id in the order that is not a pick in this
        // league is dropped, which shortens the order; the invariant gate on
        // import is what decides whether the resulting draft can finish.
        order: readJson<string[]>(draftState.order, [])
          .map((id) => pickIdx.get(id))
          .filter((i): i is number => i != null),
        complete: draftState.complete,
        started: draftState.started,
      }
      : null,
    games: games.map((g) => ({
      seasonYear: g.seasonYear,
      week: g.week,
      kind: g.kind,
      homeTeam: required(teamIdx.get(g.homeTeamId), `game ${g.id} home club`),
      awayTeam: required(teamIdx.get(g.awayTeamId), `game ${g.id} away club`),
      played: g.played,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      boxScore: tokenise(g.boxScore),
      recap: g.recap,
    })),
    transactions: transactions.map((t) => ({
      seasonYear: t.seasonYear,
      week: t.week,
      type: t.type,
      // `Transaction.teamId` is a plain String with no foreign key — a club
      // that no longer exists leaves it dangling, and the headline carries the
      // abbreviation anyway, so an unresolvable one becomes null rather than
      // failing the export.
      team: t.teamId != null ? teamIdx.get(t.teamId) ?? null : null,
      player: t.playerId != null ? playerIdx.get(t.playerId) ?? null : null,
      headline: t.headline.slice(0, SAVE_LIMITS.MAX_HEADLINE),
      detail: t.detail.slice(0, SAVE_LIMITS.MAX_DETAIL),
    })),
    tradeOffers: tradeOffers.flatMap((o) => {
      const give = remapAssets(o.give);
      const request = remapAssets(o.request);
      const from = teamIdx.get(o.fromTeamId);
      const to = teamIdx.get(o.toTeamId);
      if (give == null || request == null || from == null || to == null) return [];
      return [{
        fromTeam: from,
        toTeam: to,
        give,
        request,
        blurb: o.blurb.slice(0, SAVE_LIMITS.MAX_BLURB),
        status: o.status,
        seasonYear: o.seasonYear,
        week: o.week,
      }];
    }),
    negotiations: negotiations.flatMap((n) => {
      const team = teamIdx.get(n.teamId);
      const player = playerIdx.get(n.playerId);
      if (team == null || player == null) return [];
      return [{
        team, player, seasonYear: n.seasonYear,
        patienceSpent: n.patienceSpent,
        dismissed: n.dismissedAt != null,
      }];
    }),
    seasonRecords: seasonRecords.flatMap((r) => {
      const team = teamIdx.get(r.teamId);
      if (team == null) return [];
      return [{
        team, year: r.year, wins: r.wins, losses: r.losses, ties: r.ties,
        pointsFor: r.pointsFor, pointsAgnst: r.pointsAgnst, playoffResult: r.playoffResult,
      }];
    }),
    history,
  };

  return file;
}

/**
 * A reference that cannot legitimately be missing. Thrown rather than
 * defaulted, because index 0 is a real club and quietly writing it is how a
 * game between Buffalo and Miami becomes a game between Arizona and Arizona.
 */
function required(idx: number | undefined, what: string): number {
  if (idx == null) throw new Error(`This save cannot be exported: ${what} is not in the league.`);
  return idx;
}

async function exportHistory(
  leagueId: string,
  teamIdx: Map<string, number>,
  playerIdx: Map<string, number>,
  pickIdx: Map<string, number>,
): Promise<SaveHistory> {
  const [playerSeasons, championRosters, leagueRecords, tradeRecords, powerSnapshots] = await Promise.all([
    prisma.playerSeason.findMany({ where: { leagueId }, orderBy: [{ seasonYear: 'asc' }, { playerId: 'asc' }, { teamAbbr: 'asc' }] }),
    prisma.championRoster.findMany({ where: { leagueId }, orderBy: [{ seasonYear: 'asc' }, { playerId: 'asc' }] }),
    prisma.leagueRecord.findMany({ where: { leagueId }, orderBy: [{ scope: 'asc' }, { category: 'asc' }] }),
    prisma.tradeRecord.findMany({ where: { leagueId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    prisma.powerRankingSnapshot.findMany({ where: { leagueId }, orderBy: [{ seasonYear: 'asc' }, { week: 'asc' }, { rank: 'asc' }] }),
  ]);

  /** A stored `TradeAssetSnapshot[]` -> the format's own shape. */
  const snapshots = (raw: string): SaveTradeSnapshot[] => {
    const rows = readJson<Record<string, unknown>[]>(raw, []);
    if (!Array.isArray(rows)) return [];
    const out: SaveTradeSnapshot[] = [];
    for (const r of rows) {
      const type = r?.type === 'PICK' ? 'PICK' : 'PLAYER';
      const id = typeof r?.id === 'string' ? r.id : null;
      const idx = id == null ? null : (type === 'PLAYER' ? playerIdx.get(id) : pickIdx.get(id)) ?? null;
      out.push({
        type,
        // Null where the asset is no longer in the league. lib/tradeRetro.ts
        // looks these up with a nullable findUnique and falls back to the
        // label, so this degrades to the display an older record already gets.
        ref: idx,
        label: typeof r?.label === 'string' ? r.label.slice(0, SAVE_LIMITS.MAX_LABEL) : '',
        position: typeof r?.position === 'string' ? r.position.slice(0, 8) : null,
        ovr: typeof r?.ovr === 'number' && Number.isInteger(r.ovr) ? r.ovr : null,
        value: typeof r?.value === 'number' && Number.isFinite(r.value) ? Math.round(r.value) : 0,
      });
    }
    return out;
  };

  return {
    playerSeasons: playerSeasons.flatMap((r) => {
      const player = playerIdx.get(r.playerId);
      if (player == null) return [];
      return [{
        player,
        seasonYear: r.seasonYear,
        team: r.teamId != null ? teamIdx.get(r.teamId) ?? null : null,
        teamAbbr: r.teamAbbr,
        age: r.age,
        gp: r.gp,
        firstSeen: r.firstSeen,
        stats: r.stats,
        playoffStats: r.playoffStats,
        playoffGp: r.playoffGp,
        endOvr: r.endOvr,
      }];
    }),
    championRosters: championRosters.flatMap((r) => {
      const team = teamIdx.get(r.teamId);
      const player = playerIdx.get(r.playerId);
      if (team == null || player == null) return [];
      return [{ seasonYear: r.seasonYear, team, player }];
    }),
    leagueRecords: leagueRecords.map((r) => ({
      scope: r.scope,
      category: r.category,
      value: r.value,
      // `LeagueRecord.playerId` is a plain String and the row denormalises the
      // name and club precisely so a record outlives its holder. A holder this
      // file does not carry becomes null and the record still displays.
      player: playerIdx.get(r.playerId) ?? null,
      playerName: r.playerName,
      teamAbbr: r.teamAbbr,
      seasonYear: r.seasonYear,
    })),
    tradeRecords: tradeRecords.flatMap((r) => {
      const teamA = teamIdx.get(r.teamAId);
      const teamB = teamIdx.get(r.teamBId);
      if (teamA == null || teamB == null) return [];
      return [{
        seasonYear: r.seasonYear,
        week: r.week,
        teamA,
        teamB,
        teamAAbbr: r.teamAAbbr,
        teamBAbbr: r.teamBAbbr,
        aToB: snapshots(r.aToB),
        bToA: snapshots(r.bToA),
      }];
    }),
    powerSnapshots: powerSnapshots.flatMap((r) => {
      const team = teamIdx.get(r.teamId);
      if (team == null) return [];
      return [{
        team,
        seasonYear: r.seasonYear,
        week: r.week,
        rank: r.rank,
        powerIndex: r.powerIndex,
        rating: r.rating,
        wins: r.wins,
        losses: r.losses,
        ties: r.ties,
        netPerGame: r.netPerGame,
      }];
    }),
  };
}
