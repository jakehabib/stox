import { prisma } from './db';
import { draftHitThreshold } from './gmCareer';
import { LEAGUE } from './tuning';

/**
 * ===========================================================================
 * GM TENURE — THE EVIDENCE UNDER THE HEADLINE NUMBERS
 * ===========================================================================
 * lib/gmCareer.ts answers "what is this GM's record". This file answers the
 * follow-up question every one of those numbers provokes: *which* picks, *which*
 * clubs, *which* men, and *what* is the dead money actually for. The career page
 * used to print a hit rate with nothing behind it and a dead-money average with
 * nothing behind it; the app owner asked for the career page to carry "a lot of
 * really cool data", and this is where that data is read.
 *
 * TWO RULES HOLD EVERYTHING HERE TOGETHER.
 *
 * 1. THE SAME ROWS AS THE SUMMARY, NEVER A SECOND SET. The draft table below is
 *    built from exactly the query `buildGmCareerSummary` counts its hit rate
 *    from — same `where`, same bound — and marks hit/miss with the SAME
 *    exported `draftHitThreshold`. A table that disagrees with the percentage
 *    printed above it is worse than no table.
 *
 * 2. NOTHING IS INVENTED WHERE THE SCHEMA DOES NOT KNOW. Two things a GM would
 *    reasonably want are deliberately absent and this is the record of why:
 *
 *    - A CAP-SPEND HISTORY ACROSS A TENURE. There isn't one. `expireStaleCapCharges`
 *      (lib/season.ts) deletes every CapCharge dated before the current season,
 *      and Contract carries only its live terms, so the cap tables are a sheet a
 *      year or two deep, never a career. What CAN be told honestly is what the
 *      charges still on the books are FOR, which is `deadMoneyLedger` below.
 *    - A RATING AT THE TIME OF THE PICK. Player.trueOvr is the man today; his
 *      rookie-year rating is not stored anywhere. So the draft table shows what
 *      he IS and what he can still become (`potential`), never a "grew from 62
 *      to 84" line the database cannot support.
 * ===========================================================================
 */

/** Where a man this GM drafted actually ended up. */
export type DraftedNow = 'ROSTER' | 'ELSEWHERE' | 'FREE_AGENT' | 'RETIRED';

export interface GmDraftSelection {
  playerId: string;
  name: string;
  position: string;
  /** The draft he was taken in, and where. */
  year: number;
  round: number;
  /**
   * His real overall selection number, read off Player.draftPickNo — which
   * `draftPlayer` stamps on him at the moment the card goes in. Derived from
   * the pick's slot only for saves old enough to predate that column, and null
   * when neither is knowable rather than guessed at.
   */
  overall: number | null;
  /** What he is now, and what he could still be. */
  ovr: number;
  potential: number;
  /** The bar for his round, and whether he cleared it. Same function as the hit rate. */
  threshold: number;
  hit: boolean;
  now: DraftedNow;
  /** The club holding him, when that is somebody else. */
  nowAbbr: string | null;
  /** Seasons he actually played for this club — PlayerSeason rows, not a guess. */
  seasonsHere: number;
}

export interface GmDraftRound {
  round: number;
  made: number;
  hits: number;
  threshold: number;
}

export interface GmDraftRecord {
  /** Every selection, newest draft first, then in the order they were called. */
  picks: GmDraftSelection[];
  byRound: GmDraftRound[];
  made: number;
  hits: number;
  /** The highest-rated man he has ever drafted. */
  best: GmDraftSelection | null;
  /**
   * The earliest selection that missed its round's bar — a first-rounder who
   * never got there, ahead of a seventh-rounder who didn't, because that is
   * the pick a GM actually regrets. Null when nothing has missed.
   */
  worst: GmDraftSelection | null;
  /** Men still on the roster out of everyone he has drafted. */
  stillHere: number;
}

/**
 * EXACTLY THE PICK SET THE HIT RATE IS COUNTED FROM (lib/gmCareer.ts) — used
 * picks this club owns, with a man attached. Deliberately NOT bounded by the
 * hire year: DraftPick rows only exist from league creation onwards (the seeded
 * franchise backstory writes TeamSeasonRecord and award Transactions, never
 * picks), so there is no pre-tenure draft to exclude, and adding a bound here
 * that the summary does not have is how the table and the percentage above it
 * come apart.
 */
export async function buildGmDraftRecord(leagueId: string, teamId: string): Promise<GmDraftRecord> {
  const picks = await prisma.draftPick.findMany({
    where: { leagueId, ownerTeamId: teamId, used: true, playerId: { not: null } },
    select: {
      round: true, year: true, slot: true,
      player: {
        select: {
          id: true, firstName: true, lastName: true, position: true, trueOvr: true,
          potential: true, status: true, teamId: true, draftPickNo: true,
        },
      },
    },
    orderBy: [{ year: 'desc' }, { round: 'asc' }, { slot: 'asc' }],
  });
  const withMan = picks.filter((p): p is typeof p & { player: NonNullable<typeof p.player> } => p.player !== null);
  if (withMan.length === 0) {
    return { picks: [], byRound: [], made: 0, hits: 0, best: null, worst: null, stillHere: 0 };
  }

  const [teams, seasonRows] = await Promise.all([
    prisma.team.findMany({ where: { leagueId }, select: { id: true, abbr: true } }),
    // "How long did he actually wear your jersey" — one row per season he
    // produced for this club, which is the only place that fact is written
    // down. A man drafted and cut in August has none, and that is the honest
    // answer rather than a 1.
    prisma.playerSeason.groupBy({
      by: ['playerId'],
      where: { leagueId, teamId, playerId: { in: withMan.map((p) => p.player.id) } },
      _count: { _all: true },
    }),
  ]);
  const abbrOf = new Map(teams.map((t) => [t.id, t.abbr]));
  const seasonsOf = new Map(seasonRows.map((r) => [r.playerId, r._count._all]));

  const out: GmDraftSelection[] = withMan.map((p) => {
    const m = p.player;
    const threshold = draftHitThreshold(p.round);
    const now: DraftedNow = m.status === 'RETIRED' ? 'RETIRED'
      : m.teamId === teamId ? 'ROSTER'
        : m.teamId === null ? 'FREE_AGENT' : 'ELSEWHERE';
    return {
      playerId: m.id,
      name: `${m.firstName} ${m.lastName}`,
      position: m.position,
      year: p.year,
      round: p.round,
      overall: m.draftPickNo ?? (p.slot > 0 ? (p.round - 1) * LEAGUE.TEAM_COUNT + p.slot : null),
      ovr: m.trueOvr,
      potential: m.potential,
      threshold,
      hit: m.trueOvr >= threshold,
      now,
      nowAbbr: now === 'ELSEWHERE' && m.teamId ? abbrOf.get(m.teamId) ?? null : null,
      seasonsHere: seasonsOf.get(m.id) ?? 0,
    };
  });

  const byRound: GmDraftRound[] = [];
  for (const r of [...new Set(out.map((p) => p.round))].sort((a, b) => a - b)) {
    const inRound = out.filter((p) => p.round === r);
    byRound.push({ round: r, made: inRound.length, hits: inRound.filter((p) => p.hit).length, threshold: draftHitThreshold(r) });
  }

  // Ranked the same way lib/gmCareer.ts ranks its signature pick — rating, then
  // the later round, then the older draft — so the two screens name the same man.
  const best = [...out].sort((a, b) => b.ovr - a.ovr || b.round - a.round || a.year - b.year)[0] ?? null;
  // The regret is the EARLIEST swing that missed, not the worst player: a
  // seventh-rounder who never made it cost nothing, a first-rounder who never
  // made it cost the draft. Unknown overall sorts last rather than first.
  const misses = out.filter((p) => !p.hit);
  const worst = [...misses].sort(
    (a, b) => (a.overall ?? 9999) - (b.overall ?? 9999) || a.round - b.round || a.ovr - b.ovr,
  )[0] ?? null;

  return {
    picks: out,
    byRound,
    made: out.length,
    hits: out.filter((p) => p.hit).length,
    best,
    worst,
    stillHere: out.filter((p) => p.now === 'ROSTER').length,
  };
}

export interface GmOpponentRecord {
  teamId: string;
  abbr: string;
  name: string;
  /** Same division as the user's club — the six games a year that decide the title. */
  inDivision: boolean;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Postseason meetings only, carried separately because they are not the same thing. */
  playoffWins: number;
  playoffLosses: number;
}

export interface GmHeadToHead {
  opponents: GmOpponentRecord[];
  regular: { wins: number; losses: number; ties: number };
  playoffs: { wins: number; losses: number };
  division: { wins: number; losses: number; ties: number };
  /** Most-beaten and least-beaten club, out of those actually played more than once. */
  owned: GmOpponentRecord | null;
  nemesis: GmOpponentRecord | null;
}

/**
 * THE RECORD AGAINST EVERY CLUB IN THE LEAGUE, over this GM's tenure only.
 *
 * Bounded on the hire year for the same reason every figure on that page is,
 * and safe to bound: a Game row only exists for a season that was actually
 * scheduled and played, which is the one artefact the seeded backstory never
 * produces (see resolveStartYear in lib/leagueYear.ts).
 *
 * `kind` separates the postseason out rather than folding it in. A GM's 2-3 in
 * January is a different sentence from his 91-70 in the autumn, and a table
 * that adds them together can say neither.
 */
export async function buildGmHeadToHead(
  leagueId: string,
  team: { id: string; division: string; conference: string },
  sinceYear: number,
): Promise<GmHeadToHead> {
  const [games, teams] = await Promise.all([
    prisma.game.findMany({
      where: {
        leagueId, played: true, seasonYear: { gte: sinceYear },
        OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }],
      },
      select: { kind: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
    }),
    prisma.team.findMany({
      where: { leagueId, id: { not: team.id } },
      select: { id: true, abbr: true, city: true, nickname: true, division: true, conference: true },
      orderBy: [{ conference: 'asc' }, { division: 'asc' }, { abbr: 'asc' }],
    }),
  ]);

  const rows = new Map<string, GmOpponentRecord>(teams.map((t) => [t.id, {
    teamId: t.id, abbr: t.abbr, name: `${t.city} ${t.nickname}`,
    inDivision: t.conference === team.conference && t.division === team.division,
    wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, playoffWins: 0, playoffLosses: 0,
  }]));

  const regular = { wins: 0, losses: 0, ties: 0 };
  const playoffs = { wins: 0, losses: 0 };
  const division = { wins: 0, losses: 0, ties: 0 };

  for (const g of games) {
    const home = g.homeTeamId === team.id;
    const oppId = home ? g.awayTeamId : g.homeTeamId;
    const row = rows.get(oppId);
    if (!row) continue; // a club that has since left the save; nothing to attribute
    const mine = home ? g.homeScore : g.awayScore;
    const theirs = home ? g.awayScore : g.homeScore;
    row.pointsFor += mine;
    row.pointsAgainst += theirs;
    const won = mine > theirs, lost = mine < theirs;
    if (g.kind === 'REGULAR') {
      if (won) { row.wins++; regular.wins++; if (row.inDivision) division.wins++; }
      else if (lost) { row.losses++; regular.losses++; if (row.inDivision) division.losses++; }
      else { row.ties++; regular.ties++; if (row.inDivision) division.ties++; }
    } else {
      // A postseason meeting is not a regular-season one and is never added to
      // it — it lands only in the playoff columns, which is why the two totals
      // on screen do not sum to "games played".
      if (won) { row.playoffWins++; playoffs.wins++; }
      else if (lost) { row.playoffLosses++; playoffs.losses++; }
    }
  }

  const opponents = [...rows.values()];
  // "Who you own" needs enough meetings to mean anything — one lucky Sunday is
  // not a rivalry, so a club has to have been played at least three times.
  const rivals = opponents.filter((o) => o.wins + o.losses + o.ties >= 3);
  const rate = (o: GmOpponentRecord) => o.wins / (o.wins + o.losses + o.ties);
  const ranked = [...rivals].sort((a, b) => rate(b) - rate(a) || b.wins - a.wins);
  const owned = ranked[0] ?? null;
  const nemesis = ranked.length > 1 ? ranked[ranked.length - 1] : null;

  return { opponents, regular, playoffs, division, owned, nemesis };
}

export interface GmTenureMan {
  playerId: string;
  name: string;
  position: string;
  ovr: number;
  age: number;
  seasons: number;
  /** Still under contract to this club today. */
  stillHere: boolean;
  /** He was this GM's own selection, and where. */
  draftedBy: { year: number; round: number } | null;
  /**
   * The season a SIGN transaction put him on this roster, when one did. Null
   * for a man this GM drafted, and null for a man who was simply here — the
   * roster a GM inherits on day one was written by league generation and has no
   * transaction behind it, which is a real answer and not a missing one.
   */
  signedIn: number | null;
}

/**
 * THE MEN WHO ACTUALLY SERVED THE TENURE, longest first.
 *
 * Counted off PlayerSeason, whose whole reason for existing is "which club did
 * he produce for that year" (see the model comment in prisma/schema.prisma).
 * That makes it the only honest source for "six years in your uniform" — the
 * roster says who is here now and the transaction feed says who arrived, but
 * neither can say how long anybody stayed.
 */
export async function buildGmTenureMen(
  leagueId: string,
  teamId: string,
  sinceYear: number,
  limit = 10,
): Promise<GmTenureMan[]> {
  const rows = await prisma.playerSeason.groupBy({
    by: ['playerId'],
    where: { leagueId, teamId, seasonYear: { gte: sinceYear } },
    _count: { _all: true },
    orderBy: { _count: { playerId: 'desc' } },
    take: limit,
  });
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.playerId);
  const [men, ownPicks, signings] = await Promise.all([
    prisma.player.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, position: true, trueOvr: true, age: true, teamId: true },
    }),
    prisma.draftPick.findMany({
      where: { leagueId, ownerTeamId: teamId, used: true, playerId: { in: ids } },
      select: { playerId: true, year: true, round: true },
    }),
    // HOW HE ARRIVED, ASKED OF THE LEDGER RATHER THAN GUESSED. Transaction
    // carries the man himself (`playerId`) precisely so a screen does not have
    // to match him back by name. Oldest first, so a player signed, released and
    // signed again reads from the stint that started his service here.
    prisma.transaction.findMany({
      where: { leagueId, teamId, type: 'SIGN', playerId: { in: ids } },
      select: { playerId: true, seasonYear: true },
      orderBy: { seasonYear: 'asc' },
    }),
  ]);
  const byId = new Map(men.map((m) => [m.id, m]));
  const pickOf = new Map(ownPicks.map((p) => [p.playerId!, p]));
  const signedOf = new Map<string, number>();
  for (const t of signings) if (t.playerId && !signedOf.has(t.playerId)) signedOf.set(t.playerId, t.seasonYear);

  return rows.flatMap((r) => {
    const m = byId.get(r.playerId);
    if (!m) return [];
    const pick = pickOf.get(r.playerId);
    return [{
      playerId: m.id,
      name: `${m.firstName} ${m.lastName}`,
      position: m.position,
      ovr: m.trueOvr,
      age: m.age,
      seasons: r._count._all,
      stillHere: m.teamId === teamId,
      draftedBy: pick ? { year: pick.year, round: pick.round } : null,
      signedIn: pick ? null : signedOf.get(r.playerId) ?? null,
    }];
  });
}

export interface DeadMoneyItem {
  label: string;
  year: number;
  amount: number;
  /** Which decision put it there, read off the label the writer stamped on it. */
  cause: 'RELEASE' | 'TRADE' | 'RESIGN' | 'TAG' | 'OTHER';
}

export interface GmDeadMoneyLedger {
  items: DeadMoneyItem[];
  total: number;
  byCause: { cause: DeadMoneyItem['cause']; label: string; amount: number; count: number }[];
}

/**
 * WHAT THE MOVES ARE STILL COSTING, ITEM BY ITEM.
 *
 * The career page carried a "Cap Management" panel whose entire content, for
 * almost every GM in this database, was the words "None on the books" — a full
 * panel reporting nothing. The figure behind it is worth keeping; the panel was
 * not. This is the same money, named: which release, which trade, which
 * re-signing, and for how much.
 *
 * THIS IS A LIVE SHEET, NOT A HISTORY, and the caller has to say so on screen.
 * `expireStaleCapCharges` (lib/season.ts) deletes every charge dated before the
 * current season the moment the bill is settled, so what comes back here is
 * what is still owed — never a career total. There is no career total to be
 * had; see the header of this file.
 *
 * The cause is read off the label the WRITER stamped on the row rather than
 * re-derived: `cutPlayer` writes "Dead money — {name}", `executeTrade` writes
 * "Traded away — {name}", the re-sign path writes "Re-signed {name} — old
 * deal's bonus" and the tag path "Franchise tag — {name}'s old deal". Anything
 * unrecognised is OTHER and is still shown, because money on the books that
 * this function cannot classify is exactly the money a GM most wants to see.
 */
export async function buildGmDeadMoneyLedger(teamId: string, sinceYear: number): Promise<GmDeadMoneyLedger> {
  const charges = await prisma.capCharge.findMany({
    where: { teamId, year: { gte: sinceYear } },
    select: { label: true, year: true, amount: true },
    orderBy: [{ year: 'asc' }, { amount: 'desc' }],
  });

  const causeOf = (label: string): DeadMoneyItem['cause'] =>
    label.startsWith('Dead money — ') ? 'RELEASE'
      : label.startsWith('Traded away — ') ? 'TRADE'
        : label.startsWith('Re-signed ') ? 'RESIGN'
          : label.startsWith('Franchise tag — ') ? 'TAG' : 'OTHER';

  const items: DeadMoneyItem[] = charges.map((c) => ({
    label: c.label, year: c.year, amount: c.amount, cause: causeOf(c.label),
  }));

  const CAUSE_LABEL: Record<DeadMoneyItem['cause'], string> = {
    RELEASE: 'Players you released',
    TRADE: 'Players you traded away',
    RESIGN: 'Bonus from deals you tore up to re-sign',
    TAG: 'Bonus from deals you tagged over',
    OTHER: 'Other charges',
  };
  const byCause = (['RELEASE', 'TRADE', 'RESIGN', 'TAG', 'OTHER'] as const)
    .map((cause) => {
      const mine = items.filter((i) => i.cause === cause);
      return { cause, label: CAUSE_LABEL[cause], amount: mine.reduce((s, i) => s + i.amount, 0), count: mine.length };
    })
    .filter((g) => g.count > 0);

  return { items, total: items.reduce((s, i) => s + i.amount, 0), byCause };
}
