import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { readJson } from '@/lib/json';
import { SeasonStats } from '@/lib/types';
import { TeamLogo } from '@/components/TeamLogo';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { Tooltip } from '@/components/Tooltip';
import { HorizontalBarChart } from '@/components/charts/HorizontalBarChart';
import { ScatterChart } from '@/components/charts/ScatterChart';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { buildPythagoreanTable, type PythagoreanRow } from '@/lib/analytics';
import { StatScopeToggle, STAT_SCOPE_PARAM, parseStatScope } from '@/components/ds/StatScopeToggle';
// One definition of the passer rating formula, shared with the career table's
// Rate column. The two used to be separate copies that agreed only by luck.
import { passerRating, careerColumns, formatColumn, isDerived, statLabel, type StatColumn } from '@/lib/statLabels';
import { buildRankBook, columnValue, isRankableColumn } from '@/lib/statRanks';
import { StatsTabs } from '@/components/ds/StatsTabs';
import { RankChip } from '@/components/ds/RankChip';
import { PositionVerdictStrip, type PositionVerdictCard, type VerdictStatLine } from '@/components/ds/PositionVerdictStrip';
import { RosterStatTable, type RosterStatColumn, type RosterStatRow } from '@/components/ds/RosterStatTable';
import { POSITIONS, canonicalPosition } from '@/lib/tuning';
import { splitStarters, OFFENSE_POSITIONS, DEFENSE_POSITIONS, SPECIAL_POSITIONS } from '@/lib/lineup';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { tip, type GlossaryKey } from '@/lib/glossary';

/**
 * ===========================================================================
 * STATS — TWO TABS, TWO JOBS
 * ===========================================================================
 * LEAGUE is the leaderboard: who is out in front of everybody, and how the
 * thirty-two clubs compare. MY TEAM is a player-stats page for your roster:
 * who is producing, who is not, and where each man stands at his position.
 *
 * WHAT THE MY TEAM VIEW USED TO BE, AND WHY IT WAS INCOHERENT. It was the
 * league page with a filter bolted on, and it failed in four separate ways at
 * once. The app owner: *"the 'my team stats' are essentially a useless and
 * incoherent mess"*. Specifically:
 *
 *   1. IT SHOWED NO PRODUCTION. The "Full Roster Stat Line" table printed
 *      ONLY derived rates — a quarterback's row was Cmp %, Y/A, TD %, INT %
 *      and Rating, with no yards, no touchdowns and no attempts anywhere on
 *      it. The one question a stats page exists to answer, "who is producing",
 *      could not be answered from it at all, and a backup who went 3-for-4
 *      outranked the starter on every column he had.
 *   2. ITS COLUMNS WERE NOT COLUMNS. One header cell reading "Efficiency"
 *      spanned five columns, and each cell carried its own inline label, so
 *      column three was "Cmp %" on the passer's row, "YPC" on the back's and
 *      "Playmaker (INT+PD)" on the corner's. Nothing lined up, so nothing
 *      could be compared or sorted — and rows were ragged too, five cells for
 *      a quarterback against one for a punter.
 *   3. NO ORDER AND NO SORT. The query had no `orderBy` at all, so the roster
 *      came out in whatever order Postgres returned it — passers, punters and
 *      corners interleaved, with no way to reorder them.
 *   4. IT WAS MOSTLY ABOUT THE LEAGUE'S TEAMS. Under a masthead reading "My
 *      Team Stats", the Advanced view rendered a 32-row Pythagorean luck
 *      table and a 32-point offense/defense scatter.
 *
 * WHAT REPLACED IT: a strip of six fixed positions across the top
 * (PositionVerdictStrip), then one sortable table per position with the
 * columns CAREER_COLUMNS already says define it, every name a link to the
 * man's card, and a league standing beside each line.
 *
 * WHERE THE TEAM-LEVEL PANELS WENT. The Pythagorean tiles, the strength of
 * schedule tile and the weekly scoring-trend line chart are gone from this
 * page entirely — all three are single-club performance figures, and neither
 * of this page's two tabs is about a single club's performance. None of it was
 * unique: the Pythagorean/luck reading and strength of schedule both live on
 * the Analytics screen, and the schedule page carries strength of schedule
 * too. The luck TABLE and the offense/defense scatter stayed, on the League
 * tab, because they are readings of all thirty-two clubs and that is what the
 * League tab is.
 * ===========================================================================
 */

interface LeaderCol { key: keyof SeasonStats; label: string; format?: (n: number) => string }
interface LeaderCategory { title: string; primary: LeaderCol; extra: LeaderCol[] }

const CATEGORIES: LeaderCategory[] = [
  { title: 'Passing Yards', primary: { key: 'passYds', label: 'Yds' }, extra: [{ key: 'passTd', label: 'TD' }, { key: 'int', label: 'INT' }] },
  { title: 'Passing TDs', primary: { key: 'passTd', label: 'TD' }, extra: [{ key: 'passYds', label: 'Yds' }, { key: 'int', label: 'INT' }] },
  { title: 'Rushing Yards', primary: { key: 'rushYds', label: 'Yds' }, extra: [{ key: 'rushTd', label: 'TD' }, { key: 'rushAtt', label: 'Att' }] },
  { title: 'Receiving Yards', primary: { key: 'recYds', label: 'Yds' }, extra: [{ key: 'recTd', label: 'TD' }, { key: 'rec', label: 'Rec' }] },
  { title: 'Tackles', primary: { key: 'tackles', label: 'Tkl' }, extra: [{ key: 'sacks', label: 'Sacks' }, { key: 'defInt', label: 'INT' }] },
  { title: 'Sacks', primary: { key: 'sacks', label: 'Sacks' }, extra: [{ key: 'tackles', label: 'Tkl' }, { key: 'ff', label: 'FF' }] },
  { title: 'Interceptions', primary: { key: 'defInt', label: 'INT' }, extra: [{ key: 'pd', label: 'PD' }, { key: 'tackles', label: 'Tkl' }] },
];

/**
 * ===========================================================================
 * THE COLUMNS THAT NAME THEMSELVES, AND THE ONE TOOLTIP LEFT ON THE PAGE
 * ===========================================================================
 * The app owner, on the Advanced view of the running backs' table:
 *
 *   *"ON the tooltip for avg - the text is waaay too long. it should title
 *   'yards/carry' and be self explanatory. Same for WRs and TEs, just
 *   'yards/rec'"*
 *
 * lib/statLabels.ts is the one definition of WHICH columns a position has, and
 * its `short` is sized for the career table on a player's card, where the
 * position is the whole context. On a page that stacks nine positions it is
 * not enough: `Avg` is the header at RB, WR, TE, QB and P and means five
 * different things — the same "one label, four meanings" defect that made the
 * old single roster table incoherent, surviving in the header row. So this
 * page renames those columns where it prints them. It does NOT rename them in
 * statLabels: the career table on a player's own card has his position at the
 * top of it and `Avg` is right there.
 *
 * AND THE TOOLTIPS CAME OFF WITH THE RENAME. `glossary.yardsPerCarry` is
 * "Rushing yards divided by carries" plus a sentence of interpretation — a
 * paragraph explaining a phrase that explains itself, hung off forty header
 * cells. Two further reasons it had to go rather than merely shrink:
 *
 *   1. EVERY `?` INSIDE A TABLE WAS A SCROLLBAR. Measured: the bubble is
 *      absolutely positioned inside the table's scroll container and Chrome
 *      counts it into scrollWidth whatever its size, so two of them added
 *      530px of empty scroll to a table that fit. See RosterStatTable.
 *   2. IT WAS WRONG. Measured across a full 17-game save, the median qualified
 *      back runs 4.35 yards a carry; the glossary says "around 5.4 is the
 *      middle of the pack ... under 5 and the run is costing you more than it
 *      gains", which files most of the league under failing. (Same shape at
 *      the other two: yards/rec claims 8.5 against a measured 10.11, yards per
 *      attempt claims 5.4 against 6.26.) lib/glossary.ts is not this page's to
 *      edit and other screens still read those entries, so the fix here is to
 *      stop repeating the claim; the entry itself is reported upstream.
 */
const PLAIN_LABEL: Record<string, string> = {
  passYpa: 'yards/att',
  cmpPct: 'comp %',
  passerRating: 'rating',
  rushYpc: 'yards/carry',
  catchPct: 'catch %',
  recYpr: 'yards/rec',
  tklPerG: 'tackles/g',
  puntAvg: 'yards/punt',
  // Not rates, but the same test: 'PD' and 'FF' are initials, and initials are
  // what a tooltip was there to expand. Spelt out, they need no bubble — which
  // is what gets them out of the scroll container.
  pd: 'pass def',
  ff: 'forced fum',
};

/** The column header this page prints, which is not always statLabels' `short`. */
const labelFor = (c: StatColumn): string => PLAIN_LABEL[c.key] ?? c.short;

/**
 * The same column named inside a SENTENCE rather than at the top of a column.
 * "league standing on Yds" reads like a header that wandered into prose, so a
 * stored column takes its long STAT_LABELS name ("pass yds") and a rate keeps
 * its already-plain one ("yards/carry").
 */
const standingLabel = (c: StatColumn): string => (PLAIN_LABEL[c.key] ?? statLabel(c.key)).toLowerCase();

/**
 * THE ONE SURVIVING TOOLTIP, and it is on a card, not in a table.
 *
 * Passer rating is the only number on this page whose header cannot say what
 * it is: "rating" names it, but nothing in the label tells a reader that 158.3
 * is the ceiling and 100 is a good year. Every other rate here is a division
 * the header now spells out. It hangs on the hero card, where it is outside
 * every scroll container — the same tip is also on the League tab's Passer
 * Rating panel, and that is the whole of the page's glossary now, down from
 * nine.
 */
const CARD_TIP: Record<string, GlossaryKey> = {
  passerRating: 'passerRating',
};

/**
 * THE SIX CARDS, AND THE THREE NUMBERS ON EACH.
 *
 * The positions are the app owner's call and are not sorted, filtered or
 * re-ranked: *"It should be the most important positions, not your best
 * player. It should be QB, RB, WR, TE, EDGE, CB if there's room"*.
 *
 * WHICH THREE NUMBERS. His correction, after using the page: *"For QB's, the
 * stats are fine but for RB it should say yards/carry....for WR, and TE
 * instead of avg it should show touchdowns."* So:
 *
 *   * QB is untouched — yards, touchdowns, rating.
 *   * RB keeps yards per carry and finally SAYS "yards/carry" (see
 *     PLAIN_LABEL); the number never changed, the header lied by abbreviation.
 *   * WR and TE trade the rate for the touchdown. A receiving line reads
 *     yards / catches / touchdowns on every stat page there has ever been,
 *     and yards-per-catch is still one column away in the table below.
 *
 * The two defensive cards were audited against the same test and left alone:
 * EDGE reads Sk / Tkl / FF and CB reads Int / PD / Tkl, and not one of those
 * five initials means a second thing anywhere on this page. PD and FF are
 * spelt out in the tables (PLAIN_LABEL) where they sit beside eight other
 * columns; on a card, under a position badge, three stats to a frame, they are
 * already unambiguous.
 *
 * NOTHING HERE IS RANKED THAT THE ENGINE DEALS AS DICE — see lib/statRanks.ts,
 * which keeps that list (the punter, opportunity columns, interceptions
 * thrown) in one place.
 *
 * THERE IS NO VERDICT KEY ANY MORE. Each spec used to name the column its
 * card's graded word was computed from; the word is gone (see
 * PositionVerdictStrip) and the per-stat ranks it was collapsing are the whole
 * answer now.
 */
const CARD_SPEC: { position: string; stats: string[] }[] = [
  { position: 'QB', stats: ['passYds', 'passTd', 'passerRating'] },
  { position: 'RB', stats: ['rushYds', 'rushTd', 'rushYpc'] },
  { position: 'WR', stats: ['recYds', 'rec', 'recTd'] },
  { position: 'TE', stats: ['recYds', 'rec', 'recTd'] },
  { position: 'EDGE', stats: ['sacks', 'tackles', 'ff'] },
  // The corner leads on the interception because that is the number a corner
  // is known by, and passes defensed rides second because picks run 0-6 across
  // a whole league of corners — half the position ties on the same number, so
  // the pick alone cannot separate a cover corner from a liability. Both are
  // printed with their own standing rather than one being folded into a grade.
  { position: 'CB', stats: ['defInt', 'pd', 'tackles'] },
];

/** The unit headings the roster tables sit under, in lineup-card order. */
const UNIT_SECTIONS: { title: string; blurb: string; positions: readonly string[] }[] = [
  { title: 'Offense', blurb: 'Passing, running and receiving production.', positions: OFFENSE_POSITIONS },
  { title: 'Defense', blurb: 'Front seven and secondary production.', positions: DEFENSE_POSITIONS },
  { title: 'Special Teams', blurb: 'Kicking and punting.', positions: SPECIAL_POSITIONS },
];

export default async function StatsPage({ params, searchParams }: { params: { id: string }; searchParams: { view?: string; scope?: string; split?: string } }) {
  const { league, userTeam } = await getLeagueContext(params.id);
  const statScope = parseStatScope(searchParams[STAT_SCOPE_PARAM]);
  const playoffs = statScope === 'PLAYOFFS';
  const myTeam = searchParams.scope === 'myteam' && !!userTeam;
  // ADVANCED MEANS TWO DIFFERENT THINGS ON THE TWO TABS, AND ONLY ONE OF THEM
  // IS A REGULAR-SEASON CONSTRUCT.
  //
  // On the League tab it adds the Pythagorean luck table and the offense /
  // defense scatter, both built out of Team.wins/pointsFor — the standings the
  // sim keeps, which by design only ever count regular-season games
  // (simulateAndSaveGame). There is no honest postseason version of either, so
  // that tab does not offer the switch in the Playoffs split rather than
  // showing regular-season analytics under a Playoffs heading.
  //
  // On the My Team tab it adds the efficiency columns to the roster tables and
  // moves the rank column onto the rate. Every one of those reads a player's
  // postseason stat blob, which exists and is honest, so the toggle stays live
  // in the postseason there.
  const advancedAvailable = !playoffs || myTeam;
  const advanced = searchParams.view === 'advanced' && advancedAvailable;

  /** Every link on this page rebuilds the whole query string, so no control can drop another's state. */
  const href = (next: { view?: boolean; myTeam?: boolean; playoffs?: boolean }) => {
    const wantPlayoffs = next.playoffs ?? playoffs;
    const wantMine = next.myTeam ?? myTeam;
    const q = new URLSearchParams();
    if ((next.view ?? advanced) && (!wantPlayoffs || wantMine)) q.set('view', 'advanced');
    if (wantMine) q.set('scope', 'myteam');
    // Regular season is the default by absence — see StatScopeToggle.
    if (wantPlayoffs) q.set(STAT_SCOPE_PARAM, 'playoffs');
    const s = q.toString();
    return `/league/${league.id}/stats${s ? `?${s}` : ''}`;
  };

  const [players, teams] = await Promise.all([
    prisma.player.findMany({
      where: { leagueId: league.id, ...(playoffs ? { playoffStats: { not: '{}' } } : { seasonStats: { not: '{}' } }) },
      include: { team: true },
    }),
    prisma.team.findMany({ where: { leagueId: league.id } }),
  ]);

  const withStats = players.map((p) => ({ p, stats: readJson<SeasonStats>(playoffs ? p.playoffStats : p.seasonStats, {}) }));

  const teamOffYards = new Map<string, number>();
  for (const { p, stats } of withStats) {
    if (!p.teamId) continue;
    const yards = (stats.passYds ?? 0) + (stats.rushYds ?? 0);
    teamOffYards.set(p.teamId, (teamOffYards.get(p.teamId) ?? 0) + yards);
  }

  // ---- The one rank book every standing on this page reads -----------------
  // Built from `withStats`, which is also what the League tab's leader boards
  // are sorted from. Same array, same competition-ranking rule (lib/statRanks),
  // so a man 3rd in passing touchdowns on the board is 3rd on his card.
  //
  // The longest stat line in the league stands in for "how many games has a
  // club played" — it is the same number and it needs no second query.
  const maxGp = withStats.reduce((n, { stats }) => Math.max(n, stats.gp ?? 0), 0);
  // A rate needs a season behind it. Half a club's games is the same shape of
  // bar a real stat page draws before it will print a leader, and it is what
  // keeps a third-stringer's four-attempt 12.0 yards-per-attempt from pushing
  // every starter in the league down a place. The postseason is one to four
  // games by construction, so there the bar is simply having played.
  const minGamesForRate = playoffs ? 1 : Math.max(1, Math.ceil(maxGp / 2));
  // FOUR GAMES BEFORE ANYBODY IS RANKED. "1st in touchdowns" after week two is
  // true and reads as a verdict on a season, which is the same lie by another
  // route. The numbers still print; the rosettes wait.
  const ranksOpen = playoffs ? maxGp >= 1 : maxGp >= 4;
  const rankBook = buildRankBook(
    withStats.map(({ p, stats }) => ({ position: p.position, stats })),
    { minGamesForRate, ranksOpen },
  );

  // Team.wins/losses/pointsFor are regular-season standings and nothing else,
  // so the postseason table cannot read them. A club's playoff record IS
  // derivable — the games are right there with kind != 'REGULAR' — so it is
  // derived rather than omitted or, worse, borrowed from the standings.
  const playoffGames = playoffs
    ? await prisma.game.findMany({
        where: { leagueId: league.id, seasonYear: league.seasonYear, played: true, kind: { not: 'REGULAR' } },
        select: { homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
      })
    : [];
  const playoffRecord = new Map<string, { w: number; l: number; pf: number; pa: number }>();
  for (const g of playoffGames) {
    for (const [me, them, myScore, theirScore] of [
      [g.homeTeamId, g.awayTeamId, g.homeScore, g.awayScore],
      [g.awayTeamId, g.homeTeamId, g.awayScore, g.homeScore],
    ] as const) {
      void them;
      const r = playoffRecord.get(me) ?? { w: 0, l: 0, pf: 0, pa: 0 };
      if (myScore >= theirScore) r.w++; else r.l++;
      r.pf += myScore; r.pa += theirScore;
      playoffRecord.set(me, r);
    }
  }

  const teamRows = teams
    .map((t) => {
      const po = playoffRecord.get(t.id);
      const wins = playoffs ? (po?.w ?? 0) : t.wins;
      const losses = playoffs ? (po?.l ?? 0) : t.losses;
      const ties = playoffs ? 0 : t.ties;
      const pf = playoffs ? (po?.pf ?? 0) : t.pointsFor;
      const pa = playoffs ? (po?.pa ?? 0) : t.pointsAgnst;
      return { t, wins, losses, ties, pf, pa, offYards: teamOffYards.get(t.id) ?? 0, diff: pf - pa };
    })
    // In the postseason view the twenty clubs that never played a game are
    // not zero-win teams, they are absent — so they are dropped rather than
    // padding the table with rows that read as an 0-0 season.
    .filter((r) => !playoffs || playoffRecord.has(r.t.id))
    .sort((a, b) => b.wins - a.wins || b.diff - a.diff);

  // --- League-tab advanced data --------------------------------------------
  let ratingBars: { label: string; value: number; displayValue: string; color: string }[] = [];
  let quadrantPoints: { id: string; x: number; y: number; label: string; color: string; detail?: string }[] = [];
  let quadrantAvgs: { x?: number; y?: number } = {};
  let pythagorean: PythagoreanRow[] = [];

  if (advanced && !myTeam) {
    ratingBars = withStats
      .map(({ p, stats }) => ({ p, rating: passerRating(stats) }))
      .filter((x): x is { p: typeof withStats[number]['p']; rating: number } => x.rating !== null)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 8)
      .map(({ p, rating }) => ({ label: `${p.firstName[0]}.${p.lastName}`, value: rating, displayValue: rating.toFixed(1), color: '#3987e5' }));

    const withGames = teams.map((t) => {
      const gp = t.wins + t.losses + t.ties;
      return { t, gp, ppg: gp > 0 ? t.pointsFor / gp : 0, papg: gp > 0 ? t.pointsAgnst / gp : 0 };
    }).filter((x) => x.gp > 0);
    const avgPpg = withGames.reduce((s, x) => s + x.ppg, 0) / Math.max(1, withGames.length);
    const avgPapg = withGames.reduce((s, x) => s + x.papg, 0) / Math.max(1, withGames.length);
    quadrantAvgs = { x: avgPapg, y: avgPpg };
    quadrantPoints = withGames.map(({ t, ppg, papg }) => ({
      id: t.id, x: papg, y: ppg, label: `${t.city} ${t.nickname}`,
      color: t.id === userTeam?.id ? '#3987e5' : '#5a5a63',
      detail: t.id === userTeam?.id ? 'Your team' : undefined,
    }));

    pythagorean = buildPythagoreanTable(teams, userTeam?.id);
  }

  // --- My Team data ---------------------------------------------------------
  const myStatsById = new Map(
    withStats.filter(({ p }) => p.teamId === userTeam?.id).map(({ p, stats }) => [p.id, stats]),
  );

  // The whole roster, not only the men with a stat line: a starting slot with
  // nobody in it and a starter who has not taken a snap are both answers the
  // position strip has to be able to give.
  const roster = myTeam && userTeam
    ? await prisma.player.findMany({
        where: { teamId: userTeam.id },
        orderBy: { trueOvr: 'desc' },
        select: { id: true, firstName: true, lastName: true, position: true, age: true, trueOvr: true, weightLb: true, heightIn: true, injuryWeeks: true },
      })
    : [];
  const depthSlots = myTeam && userTeam
    ? await prisma.depthChartSlot.findMany({ where: { teamId: userTeam.id }, orderBy: { rank: 'asc' } })
    : [];

  type RosterMan = (typeof roster)[number];
  const rosterById = new Map(roster.map((p) => [p.id, p]));
  const rosterByPosition = new Map<string, RosterMan[]>();
  for (const p of roster) {
    const arr = rosterByPosition.get(p.position);
    if (arr) arr.push(p); else rosterByPosition.set(p.position, [p]);
  }

  /**
   * THE ORDER THE DEPTH CHART ITSELF USES — the saved slots first, in their
   * saved rank, then anybody unslotted by rating. Copied in shape from the
   * depth-chart page precisely so the two agree: a card naming a different
   * starter from the screen where you set your starters would be this app
   * disagreeing with itself about who is on the field, which is the failure
   * lib/lineup.ts exists to prevent.
   */
  const depthOrder = (position: string): RosterMan[] => {
    const here = rosterByPosition.get(position) ?? [];
    const ranked = depthSlots.filter((s) => s.position === position).map((s) => s.playerId);
    const rest = here.filter((p) => !ranked.includes(p.id)).map((p) => p.id);
    return [...ranked, ...rest].map((id) => rosterById.get(id)).filter((p): p is RosterMan => !!p);
  };
  const starterIds = new Set<string>();
  if (myTeam) for (const pos of POSITIONS) for (const m of splitStarters(pos, depthOrder(pos)).starters) starterIds.add(m.id);

  /** The column object for a stat key at a position, so a card and a table read the same definition. */
  const columnFor = (position: string, key: string): StatColumn | undefined =>
    careerColumns(canonicalPosition(position)).find((c) => c.key === key);

  const myClubPlayedPostseason = !!userTeam && playoffRecord.has(userTeam.id);

  /**
   * ONE CARD BUILDER, TWO TABS. A card is a man, a club and three stat lines
   * with their standings; who the man is differs (your starter / the league's
   * leader) and nothing else does, so the two tabs differ by which player they
   * hand this function and nothing else.
   */
  const buildCard = (
    spec: (typeof CARD_SPEC)[number],
    man: { id: string; firstName: string; lastName: string; age: number; trueOvr: number; weightLb: number | null; heightIn: number | null } | null,
    stats: SeasonStats | undefined,
    club: { id: string; abbr: string } | null,
    clubLabel: string | undefined,
    slotLabel: string,
    emptyNote: string,
  ): PositionVerdictCard => {
    const lines: VerdictStatLine[] = spec.stats.map((key) => {
      const col = columnFor(spec.position, key);
      if (!col || !stats) return { label: col ? labelFor(col) : key, value: '—', rank: null };
      return {
        label: labelFor(col),
        value: formatColumn(col, stats) ?? '—',
        rank: isRankableColumn(spec.position, col) ? rankBook.rank(spec.position, col, stats) : null,
        tip: CARD_TIP[col.key] ? tip(CARD_TIP[col.key]) : undefined,
      };
    });

    // WHY A CARD HAS NO ROSETTES, in the card's own words. The note used to be
    // computed off the verdict's rank; with the verdict gone it answers for
    // the chips that are actually on the card — and the last case is a RATE
    // that has not qualified while the counting stats beside it are ranked.
    const rateUnranked = !!stats && ranksOpen && spec.stats.some((key) => {
      const col = columnFor(spec.position, key);
      return !!col && isDerived(col) && isRankableColumn(spec.position, col) && !rankBook.rank(spec.position, col, stats);
    });
    let note: string | null = null;
    if (!man) note = emptyNote;
    else if (!stats) note = playoffs ? 'no postseason snaps' : 'no production recorded yet';
    else if (!ranksOpen) note = 'ranks open after four games';
    else if (rateUnranked) note = 'rate not yet qualified';

    return {
      position: spec.position,
      slotLabel,
      player: man ? { id: man.id, firstName: man.firstName, lastName: man.lastName, age: man.age, ovr: man.trueOvr, weightLb: man.weightLb, heightIn: man.heightIn } : null,
      href: man ? `/league/${league.id}/player/${man.id}` : null,
      games: stats?.gp ?? 0,
      stats: lines,
      note,
      club,
      clubLabel,
      accent: club ? generateTeamLogoParams(club.abbr).primary : '#38bdf8',
    };
  };

  // ---- My Team: the six men your depth chart has on the field --------------
  const myClub = userTeam ? { id: userTeam.id, abbr: userTeam.abbr } : null;
  const myTeamCards: PositionVerdictCard[] = !myTeam ? [] : CARD_SPEC.map((spec) => {
    const ordered = depthOrder(spec.position);
    const { starters } = splitStarters(spec.position, ordered);
    // WR1, EDGE1, CB1 — the first slot on the depth chart, never "whoever has
    // the most yards". A card that silently changed man in week nine would
    // stop being comparable to last week's, which is the whole reason the row
    // is a fixed six in the first place.
    const man = starters[0] ?? null;
    const label = starters.length > 1 || (spec.position === 'WR' || spec.position === 'CB' || spec.position === 'EDGE')
      ? `${spec.position}1`
      : spec.position;
    return buildCard(spec, man, man ? myStatsById.get(man.id) : undefined, myClub, undefined, label, 'nobody to start here');
  });

  /**
   * ---- League: the six men leading those positions -------------------------
   *
   * The owner: *"we could also add hero cards for the 'league' too showing the
   * leaders"*.
   *
   * THE DUPLICATION QUESTION, MEASURED RATHER THAN ARGUED. This tab already
   * carries seven leader boards, and six more panels that reprint six names
   * off the top of them would be the exact defect the My Team rework removed.
   * The boards cut the league BY STAT (passing touchdowns, sacks); these cards
   * cut it BY POSITION (the best tight end), and those are different questions
   * — but only if the answers differ. Counted on a finished 17-game save: 3 of
   * the 6 cards name a man who is also row 1 of a board (the passing-yards,
   * rushing-yards and receiving-yards leaders), and 3 do not. The tight end
   * leads no board at all, because the receiving board is every position at
   * once; the edge rusher and the corner lead none because the sack board's
   * row 1 was a tie broken the other way and the interception board's row 1 is
   * a safety. And what the three overlapping cards duplicate is the NAME: the
   * board gives that man one number, the card gives three with a standing on
   * each, his age, his overall and his club.
   *
   * WHO GETS THE CARD, AND THE TIE. The lead stat of the position, then the
   * card's second stat, then its third, then the player id so a reload cannot
   * reorder a tie. Sacks really do tie at the top — two edge rushers on 19 in
   * the save above — and the board and the card break that tie differently,
   * which is why both print "T-1st" rather than either claiming sole
   * possession of it.
   *
   * THE COLOUR RULE STILL MEANS SOMETHING HERE, and this is the part that had
   * to be thought about: every one of these men is 1st at his lead stat by
   * construction, so the top chip on all six cards is gold and starred. That
   * is not the colour going quiet — it is the card's reason for existing,
   * stated in the same language the rest of the page uses. The information is
   * in the other two chips, which are NOT rank 1 for most of them: a receiver
   * who leads the league in yards can be 14th in catches, and that is the sort
   * of thing this row is for. Suppressing the lead chip because it is
   * predictable was the alternative, and it was rejected — a blank where every
   * other card on the site prints a standing reads as missing data.
   */
  const leagueCards: PositionVerdictCard[] = myTeam || withStats.length === 0 ? [] : CARD_SPEC.map((spec) => {
    const cols = spec.stats.map((k) => columnFor(spec.position, k)).filter((c): c is StatColumn => !!c);
    const pool = withStats.filter(({ p }) => p.position === spec.position);
    const best = [...pool].sort((a, b) => {
      for (const c of cols) {
        const av = columnValue(c, a.stats) ?? -1;
        const bv = columnValue(c, b.stats) ?? -1;
        if (av !== bv) return bv - av;
      }
      return a.p.id < b.p.id ? -1 : 1;
    })[0];
    const club = best?.p.team ? { id: best.p.team.id, abbr: best.p.team.abbr } : null;
    const man = best ? { ...best.p, trueOvr: best.p.trueOvr } : null;
    return buildCard(spec, man, best?.stats, club, club?.abbr, spec.position, 'nobody at this position has a stat line yet');
  });

  // ---- One sortable table per position ------------------------------------
  const rosterTables = !myTeam ? [] : UNIT_SECTIONS.map((section) => {
    const tables = section.positions.map((position) => {
      const all = careerColumns(canonicalPosition(position));
      if (all.length === 0) return null; // the line records no box line — see below
      const men = (rosterByPosition.get(position) ?? []).filter((p) => myStatsById.has(p.id));
      if (men.length === 0) return null;

      // BASIC IS THE COUNTING LINE, ADVANCED ADDS THE RATES. Both are honest
      // readings of the same stat blob; the difference is whether you are
      // asking how much a man did or how well he did it.
      const cols = all.filter((c) => advanced || !isDerived(c));
      const leadCol = all.find((c) => c.lead === 1) ?? all[0];
      // THE LAST derived column, not the first. CAREER_COLUMNS orders a
      // position volume-then-rate-then-result and puts the summarising rate
      // last on purpose — its own note: *"rating last, because it is the
      // summary of everything left of it"*. Taking the first one ranked a
      // quarterback's season on completion percentage, which is the least
      // interesting rate on his row.
      const rateCol = [...all].reverse().find((c) => isDerived(c) && isRankableColumn(position, c));
      // WHICH COLUMN CARRIES THE STANDING, and it follows the view: the volume
      // in Basic, the efficiency in Advanced. It used to be a column of its own
      // at the end of every row, headed "Lg Rank · Avg", which is where the
      // ambiguity had to be spelt out. The paint now rides on the figure
      // itself (RosterStatTable), so the subject of the rank is the number it
      // is painted on and cannot be misread.
      const rankCol = (advanced ? rateCol ?? leadCol : leadCol);
      const rankable = isRankableColumn(position, rankCol);

      const columns: RosterStatColumn[] = cols.map((c) => ({
        key: c.key,
        short: labelFor(c),
        lead: c.key === leadCol.key,
      }));

      const rows: RosterStatRow[] = men.map((p) => {
        const stats = myStatsById.get(p.id)!;
        return {
          id: p.id,
          starter: starterIds.has(p.id),
          identity: (
            // THE NAME IS A DOOR (DepthChartGroup.tsx). Every man on this page
            // opens his own card.
            <Link href={`/league/${league.id}/player/${p.id}`} className="hover:text-accent2 flex items-center gap-2">
              <PlayerAvatar seed={p.id} age={p.age} size={24} weightLb={p.weightLb} heightIn={p.heightIn} position={p.position} />
              <span className="font-medium truncate">{p.firstName} {p.lastName}</span>
              {starterIds.has(p.id) && <span className="label-sm text-[9px] shrink-0">ST</span>}
            </Link>
          ),
          cells: cols.map((c) => {
            const text = formatColumn(c, stats);
            const v = c.derive ? c.derive(stats) : (stats as Record<string, number | undefined>)[c.key] ?? 0;
            return {
              text: text ?? '—',
              num: v == null || !Number.isFinite(v) ? null : v,
              rank: c.key === rankCol.key && isRankableColumn(position, c) ? rankBook.rank(position, c, stats) : null,
            };
          }),
        };
      });

      return { position, columns, rows, rankable, rankedLabel: rankable ? standingLabel(rankCol) : null, defaultSortKey: leadCol.key };
    }).filter((t): t is NonNullable<typeof t> => !!t);

    return { ...section, tables };
  }).filter((s) => s.tables.length > 0);

  /**
   * ===========================================================================
   * THE LINE UNDER THE CARDS — HIS SENTENCE, WITH THE NUMBER TAKEN FROM THE GATE
   * ===========================================================================
   * The owner wrote the replacement copy himself: *"The text below the hero
   * cards can be truncated."* → *"Every stat is against other men at the same
   * position. Minimum 9 games played to qualify."* Two paragraphs of pool
   * mechanics went; his two sentences stayed.
   *
   * BUT THE 9 WAS NOT A CONSTANT, AND WAS NOT ALWAYS 9. `minGamesForRate` is
   * `ceil(maxGp / 2)` — half the longest season on the books — so it is 9 only
   * at the end of a finished 17-game year, which is where he read it. At week
   * 17 it is 8; at week 9 it is 4; and the postseason gates at 1, because the
   * bracket is one to four games and a nine-game bar over it would be a rule
   * no man in the league could clear. He asked for that too: *"for playoffs, we
   * can adjust the text accordingly below the hero cards."* So the sentence
   * interpolates the SAME binding the rank book was built with. It cannot
   * drift, because there is nothing to drift from.
   *
   * Measured in every state this text can reach: regular season week 18 → 9;
   * week 17 → 8; week 5 → 2; weeks 1-4 → ranks are not open at all and the
   * sentence says so instead; postseason → 1. A club with no games played
   * never reaches this line — the tab shows "no stats recorded yet" above it.
   */
  const qualifierLine = !ranksOpen
    ? 'Ranks open once a club has four games on the books.'
    : minGamesForRate <= 1
      // One game is not a bar, and printing "minimum 1 game played to qualify"
      // reads as a rule where there is none. The postseason gets the fact that
      // makes it true instead.
      ? 'Every man who has played in the bracket qualifies.'
      : `Minimum ${minGamesForRate} games played to qualify.`;
  const cardFootnote = <>Every stat is against other men at the same position. {qualifierLine}</>;

  const myLineCount = myStatsById.size;

  return (
    <div className="space-y-5">
      <PageMasthead
        teamId={myTeam ? userTeam?.id : undefined}
        teamAbbr={myTeam ? userTeam?.abbr : undefined}
        eyebrow={`${league.seasonYear} · Week ${league.week}`}
        title="Stats"
        subtitle={
          myTeam
            ? (playoffs
              ? 'Your roster in the postseason — these games are counted nowhere else.'
              : 'Your roster, by position, with each man measured against the rest of the league.')
            : (playoffs
              ? 'League leaders and team production in the postseason only.'
              : 'League leaders and team production, season-to-date.')
        }
        action={
          <div className="flex flex-col items-end gap-1.5">
            <StatScopeToggle scope={statScope} regularHref={href({ playoffs: false })} playoffHref={href({ playoffs: true })} />
            {/* No Basic/Advanced on the League tab in the postseason — its
                advanced blocks are regular-season constructs. See the
                `advancedAvailable` binding. */}
            {advancedAvailable && (
              <div className="flex gap-1.5">
                <Link href={href({ view: false })} scroll={false} className={`pill ${!advanced ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-chalk'}`}>Basic</Link>
                <Link href={href({ view: true })} scroll={false} className={`pill ${advanced ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-chalk'}`}>Advanced</Link>
              </div>
            )}
          </div>
        }
        facts={
          myTeam
            ? [
              { label: 'Stat Lines', value: `${myLineCount} of ${roster.length}`, detail: 'men with production' },
              { label: 'Games Played', value: String(maxGp), detail: playoffs ? 'deepest postseason run' : 'longest season on the books' },
              { label: 'Ranked Against', value: withStats.length.toLocaleString(), detail: 'players league-wide' },
            ]
            : [
              { label: 'Players Ranked', value: withStats.length.toLocaleString(), detail: playoffs ? 'with postseason stats' : 'with recorded stats' },
              { label: 'Clubs', value: String(teams.length), detail: playoffs ? `${teamRows.length} in the bracket` : 'all reporting' },
              { label: 'Games Played', value: String(maxGp), detail: playoffs ? 'deepest postseason run' : 'longest season on the books' },
            ]
        }
      />

      <StatsTabs
        tabs={[
          { id: 'league', label: 'League', href: href({ myTeam: false }), active: !myTeam, hint: `${teams.length} clubs` },
          ...(userTeam ? [{ id: 'mine', label: 'My Team', href: href({ myTeam: true }), active: myTeam, hint: userTeam.abbr }] : []),
        ]}
      />

      {playoffs && (
        <p className="text-xs text-muted px-1">
          Postseason production only, kept in its own column since the day it was first recorded — a club&apos;s
          run adds games to these numbers and to nothing on the Regular Season side.
        </p>
      )}

      {myTeam ? (
        /* ================= MY TEAM ================= */
        playoffs && !myClubPlayedPostseason ? (
          <div className="panel p-5 text-sm text-muted">
            {userTeam?.city} {userTeam?.nickname} did not play a postseason game in {league.seasonYear}, so there is
            nothing to show here rather than a table of zeroes. The Regular Season split has the full year.
          </div>
        ) : myLineCount === 0 ? (
          <div className="panel p-5 text-sm text-muted">
            No stats recorded for this roster yet{playoffs ? ' in the postseason' : ` in ${league.seasonYear}`} — this
            fills in as the games are played.
          </div>
        ) : (
          <>
            <PositionVerdictStrip cards={myTeamCards} footnote={cardFootnote} />

            {rosterTables.map((section) => (
              <section key={section.title} className="space-y-3">
                <div className="section-head">
                  <div>
                    <h2 className="section-title">{section.title}</h2>
                    <p className="text-xs text-muted mt-0.5">{section.blurb}</p>
                  </div>
                  <span className="label-sm text-[10px]">{advanced ? 'Volume + efficiency' : 'Volume'}</span>
                </div>
                {/* ONE TABLE PER ROW. Two-up fitted the short defensive
                    tables and clipped everything else: a quarterback's
                    Advanced line is eleven columns and simply does not go into
                    half a screen. Full width, and the widest table in the app
                    fits its container exactly — measured at 1,230px of table
                    in a 1,230px box at both 1600 and 1280. */}
                <div className="grid gap-4">
                  {section.tables.map((t) => (
                    <div key={t.position} className="panel overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-line/70 flex items-center justify-between gap-2">
                        <span className={`font-display font-bold text-sm uppercase tracking-wide ${positionBadgeClass(t.position)}`}>
                          {t.position}
                        </span>
                        {/* WHICH NUMBER IS PAINTED, said once per table rather
                            than in a column header on every row. This is the
                            job the deleted "Lg Rank · Avg" column was doing —
                            naming the subject of the standing — at one
                            fifteenth of the ink. */}
                        <span className="font-mono text-[10px] text-muted">
                          {t.rows.length} {t.rows.length === 1 ? 'man' : 'men'}
                          {t.rankable ? ` · league standing on ${t.rankedLabel}` : ' · not ranked, this game deals the numbers'}
                        </span>
                      </div>
                      <RosterStatTable columns={t.columns} rows={t.rows} defaultSortKey={t.defaultSortKey} />
                    </div>
                  ))}
                </div>
              </section>
            ))}

            <p className="text-xs text-muted px-1">
              No table for the offensive line: the box score records no individual line for a lineman, so there is no
              honest stat row to draw for one. Click a lineman&apos;s name anywhere on the roster for his contract and
              ratings instead.
            </p>
          </>
        )
      ) : (
        /* ================= LEAGUE ================= */
        <>
          {withStats.length === 0 ? (
            <div className="panel p-4 text-sm text-muted">
              {playoffs
                ? `No postseason games have been played in ${league.seasonYear} yet — this fills in once the bracket starts.`
                : 'No stats recorded yet this season — check back after Week 1.'}
            </div>
          ) : (
            <>
              {/* THE LEADERS, BY POSITION — the same six cards the My Team tab
                  opens with, so the two tabs can be read against each other.
                  See `leagueCards` for what was measured before adding six
                  panels to a tab that already has seven boards. */}
              <PositionVerdictStrip cards={leagueCards} footnote={cardFootnote} />

              {advanced && pythagorean.length > 0 && (
                <div className="panel overflow-hidden">
                  <div className="px-4 py-3 border-b border-line/70">
                    <div className="label-sm inline-flex items-center gap-1.5">
                      Luck Table — Actual vs. Expected
                      <Tooltip placement="bottom" text={tip('pythagoreanWins')} />
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      Every team sorted by how far their record sits above or below what their scoring earned. Top of the list has been winning
                      close games; the bottom has been losing them.
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="table-clean">
                      <thead>
                        <tr><th>Team</th><th>Actual</th><th>Expected</th><th>Luck</th><th>PF</th><th>PA</th><th>Diff</th></tr>
                      </thead>
                      <tbody>
                        {pythagorean.map((r) => {
                          const diff = r.pointsFor - r.pointsAgainst;
                          return (
                            <tr key={r.teamId} className={r.isUser ? 'bg-raised/60' : ''}>
                              <td>
                                <span className="flex items-center gap-2">
                                  <TeamLogo seed={r.teamId} abbr={r.abbr} size={20} className="shrink-0" />
                                  <span className={`whitespace-nowrap ${r.isUser ? 'font-semibold' : ''}`}>{r.name}</span>
                                </span>
                              </td>
                              <td className="stat-value text-stat-sm">{r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''}</td>
                              <td className="font-mono text-muted">{r.expectedWins.toFixed(1)}-{(r.wins + r.losses + r.ties - r.expectedWins).toFixed(1)}</td>
                              <td className={`stat-value text-stat-sm ${r.luck >= 0 ? 'text-warn' : 'text-accent2'}`}>{r.luck >= 0 ? '+' : ''}{r.luck.toFixed(1)}</td>
                              <td className="font-mono text-muted">{r.pointsFor}</td>
                              <td className="font-mono text-muted">{r.pointsAgainst}</td>
                              <td className={`font-mono ${diff >= 0 ? 'text-accent' : 'text-bad'}`}>{diff >= 0 ? '+' : ''}{diff}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {advanced && (
                <div className="grid lg:grid-cols-2 gap-5">
                  <div className="panel p-4">
                    <h2 className="font-semibold mb-1 inline-flex items-center gap-1.5">
                      Passer Rating
                      <Tooltip text={tip('passerRating')} />
                    </h2>
                    <p className="text-xs text-muted mb-3">Top qualifying passers, season-to-date.</p>
                    {ratingBars.length > 0 ? <HorizontalBarChart bars={ratingBars} maxValue={158.3} /> : <p className="text-sm text-muted">No qualifying passers yet.</p>}
                  </div>

                  <div className="panel p-4">
                    <h2 className="font-semibold mb-1 inline-flex items-center gap-1.5">
                      Offense vs. Defense
                      <Tooltip text="Every team by points scored per game (up) and points allowed per game (right, so lower/left is better defense). Dashed lines mark the league average on each axis — top-left is the most complete quadrant: score a lot, allow little." />
                    </h2>
                    <p className="text-xs text-muted mb-3">Points/game — your team highlighted, dashed lines are league average.</p>
                    <ScatterChart
                      points={quadrantPoints}
                      xLabel="Points Allowed / Game" yLabel="Points Scored / Game"
                      formatX="decimal1" formatY="decimal1"
                      quadrantLines={quadrantAvgs}
                    />
                  </div>
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-5">
                {CATEGORIES.map((cat) => {
                  const leaders = [...withStats]
                    .filter(({ stats }) => (stats[cat.primary.key] ?? 0) > 0)
                    .sort((a, b) => (b.stats[cat.primary.key] ?? 0) - (a.stats[cat.primary.key] ?? 0))
                    .slice(0, 10);
                  return (
                    <div key={cat.title} className="panel overflow-hidden">
                      <div className="px-4 py-3 border-b border-line/70 label-sm">
                        {cat.title}
                        <span className="ml-1.5 font-normal normal-case tracking-normal text-muted">{playoffs ? '· Playoffs' : '· Regular Season'}</span>
                      </div>
                      <table className="table-clean">
                        <thead>
                          <tr>
                            <th>Player</th>
                            <th className="text-right">{cat.primary.label}</th>
                            {cat.extra.map((c) => <th key={c.key} className="text-right">{c.label}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {leaders.map(({ p, stats }, i) => {
                            // COMPETITION RANKING, not the array index — the same
                            // rule lib/statRanks.ts applies everywhere else on this
                            // page, so two men on 27 touchdowns are both 3rd here
                            // AND on the position card. Printing i+1 gave one of
                            // them 4th purely from where the sort dropped him,
                            // which is how a card and a board come to disagree
                            // about the same player.
                            const v = stats[cat.primary.key] ?? 0;
                            const place = leaders.findIndex(({ stats: s }) => (s[cat.primary.key] ?? 0) === v) + 1;
                            const tied = leaders.filter(({ stats: s }) => (s[cat.primary.key] ?? 0) === v).length > 1;
                            void i;
                            return (
                              <tr key={p.id}>
                                <td>
                                  <Link href={`/league/${league.id}/player/${p.id}`} className="hover:text-accent2 flex items-center gap-2">
                                    <span className={`text-xs w-6 shrink-0 font-mono ${place === 1 ? 'text-gold' : 'text-muted'}`}>{tied ? 'T' : ''}{place}</span>
                                    <PlayerAvatar seed={p.id} age={p.age} size={22} weightLb={p.weightLb} heightIn={p.heightIn} position={p.position} />
                                    <span className="font-medium truncate">{p.firstName} {p.lastName}</span>
                                    <span className={`text-xs font-semibold shrink-0 ${positionBadgeClass(p.position)}`}>{p.position}</span>
                                  </Link>
                                </td>
                                <td className="stat-value text-stat-sm text-right">{v}</td>
                                {cat.extra.map((c) => <td key={c.key} className="font-mono text-muted text-right">{stats[c.key] ?? 0}</td>)}
                              </tr>
                            );
                          })}
                          {leaders.length === 0 && (
                            <tr><td colSpan={2 + cat.extra.length} className="text-sm text-muted">No qualifying players yet.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div className="panel overflow-hidden">
            <div className="px-4 py-3 border-b border-line/70 label-sm">{playoffs ? 'Team Stats — Postseason' : 'Team Stats'}</div>
            <table className="table-clean">
              <thead><tr><th>Team</th><th>Record</th><th className="text-right">PF</th><th className="text-right">PA</th><th className="text-right">Diff</th><th className="text-right">Off. Yards</th></tr></thead>
              <tbody>
                {teamRows.length === 0 && (
                  <tr><td colSpan={6} className="text-sm text-muted">No postseason games played yet.</td></tr>
                )}
                {teamRows.map(({ t, wins, losses, ties, pf, pa, offYards, diff }) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={t.id === userTeam?.id ? `/league/${league.id}/roster` : `/league/${league.id}/team/${t.id}`} className="hover:text-accent2 flex items-center gap-2 font-medium">
                        <TeamLogo seed={t.id} abbr={t.abbr} size={22} /> {t.city} {t.nickname}
                      </Link>
                    </td>
                    <td className="font-mono text-muted">{wins}-{losses}{ties ? `-${ties}` : ''}</td>
                    <td className="font-mono text-right">{pf}</td>
                    <td className="font-mono text-muted text-right">{pa}</td>
                    <td className={`stat-value text-stat-sm text-right ${diff >= 0 ? 'text-accent' : 'text-bad'}`}>{diff >= 0 ? '+' : ''}{diff}</td>
                    <td className="font-mono text-muted text-right">{offYards.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
