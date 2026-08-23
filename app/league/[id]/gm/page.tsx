import { getLeagueContext } from '@/lib/league-data';
import { buildGmCareerSummary, tradeInvolves, PLAYOFF_RESULT_LABEL as RESULT_LABEL } from '@/lib/gmCareer';
import { buildTradeRetrospectives, retroEdgeFor, retroOutcomeFor, type TradeRetrospective } from '@/lib/tradeRetro';
import { buildGmDraftRecord, buildGmHeadToHead, buildGmTenureMen, buildGmDeadMoneyLedger } from '@/lib/gmTenure';
import { buildDynastyState } from '@/lib/dynasty';
import { TeamLogo } from '@/components/TeamLogo';
import { TradeRetrospectives } from '@/components/TradeRetrospectives';
import { GmCard } from '@/components/ds/GmCard';
import { GmCardReveal } from '@/components/GmCardReveal';
import { GmCareerTabs } from '@/components/GmCareerTabs';
import { GmDraftRounds, GmDraftHighlights, GmDraftTable } from '@/components/gm/GmDraftBoard';
import { GmHeadToHeadPanel } from '@/components/gm/GmHeadToHead';
import { GmHonoursTimeline, GmTenureMenPanel, GmDeadMoneyPanel } from '@/components/gm/GmTenurePanels';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { Tooltip } from '@/components/Tooltip';
import { tip } from '@/lib/glossary';

/**
 * ===========================================================================
 * THE GM CAREER PAGE
 * ===========================================================================
 * Three tabs under one masthead. The frame, the tab names and the argument for
 * the landing tab all live in components/GmCareerTabs.tsx — read that comment
 * first; this file only decides what goes in each pane and reads the rows.
 *
 * THE MASTHEAD AND THE GM CARD STAND ABOVE THE TABS, on every pane. The card is
 * the only thing on this page that leaves the game and its entry point has
 * already had to be rescued once for being unfindable; putting it inside a pane
 * would be losing that argument again. It also means `GmCardReveal` mounts
 * exactly once and nothing here can double-fire it.
 * ===========================================================================
 */

/**
 * What a graded deal's return is called on the GM card — the first two assets
 * that actually came back, off the SAME row the Moves tab prints in full.
 */
function receivedSummary(r: TradeRetrospective, myAbbr: string): string {
  const mine = r.teamAAbbr === myAbbr ? r.bToA : r.aToB;
  const names = mine.map((o) => o.label);
  if (names.length === 0) return 'Cap relief';
  if (names.length <= 2) return names.join(' + ');
  return `${names.slice(0, 2).join(' + ')} +${names.length - 2} more`;
}

export default async function GmCareerPage({ params }: { params: { id: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;
  const s = await buildGmCareerSummary(league.id, team, league.seasonYear);

  // A first-season GM page was five sparse tiles and six hundred pixels of
  // empty page. Everything below fills it with the GM's actual body of work
  // rather than placeholders: the season log (including the season in progress,
  // which has no TeamSeasonRecord row yet), the ledger of moves he has made,
  // every pick he has ever called, and his record against the other 31 clubs.
  // NO 'DRAFT' HERE. Every selection this GM has ever made is a table on the
  // draft tab, with what the man became beside it; a one-line "Round 7, Pick
  // 27" row in the moves feed is the same pick printed a second time, under a
  // heading that does not even claim to be about the draft.
  const MOVE_TYPES = ['SIGN', 'RESIGN', 'CUT', 'TAG'];
  const [
    seasonRecords, ownMoves, moveCounts, tradeRows, retrospectives, dynasty, owner,
    draftRecord, headToHead, tenureMen, deadMoney,
  ] = await Promise.all([
    // Bounded on the hire year, exactly as lib/gmCareer.ts bounds the same
    // table. Unbounded, a first-year GM's "1 season" header sat above nine
    // rows of seeded franchise history he had nothing to do with.
    prisma.teamSeasonRecord.findMany({ where: { teamId: team.id, year: { gte: s.firstYear } }, orderBy: { year: 'desc' } }),
    prisma.transaction.findMany({
      where: { leagueId: league.id, teamId: team.id, type: { in: MOVE_TYPES } },
      orderBy: [{ seasonYear: 'desc' }, { createdAt: 'desc' }],
      take: 20,
    }),
    prisma.transaction.groupBy({
      by: ['type'],
      where: { leagueId: league.id, teamId: team.id, type: { in: MOVE_TYPES } },
      _count: true,
    }),
    // Trades carry no teamId — both sides are encoded in one headline — so
    // they need the shared matcher rather than a teamId filter. Filtering
    // these by teamId is exactly how this ledger first reported "Trades 0" on
    // the same page whose summary tile said seven.
    prisma.transaction.findMany({
      where: { leagueId: league.id, type: 'TRADE' },
      orderBy: [{ seasonYear: 'desc' }, { createdAt: 'desc' }],
    }),
    // THE FULL GRADED HISTORY NOW LIVES HERE AND ONLY HERE. It used to be
    // rendered on the trade screen as well, under the deal a GM was in the
    // middle of building — the app owner: *"It seems like a lot of noise to
    // have the trade retrospectives on the trade tab."* Building a trade and
    // reading the grades on the ones you already made are two different jobs,
    // and only one of them belongs on the screen with the deal sheet.
    buildTradeRetrospectives(league.id, team.id, settings.capMode, league.seasonYear),
    // The GM card's Dynasty level is the Dynasty screen's own figure, not a
    // second reading of the same history.
    buildDynastyState(league.id),
    league.userId
      ? prisma.user.findUnique({ where: { id: league.userId }, select: { username: true } })
      : Promise.resolve(null),
    buildGmDraftRecord(league.id, team.id),
    buildGmHeadToHead(league.id, team, s.firstYear),
    buildGmTenureMen(league.id, team.id, s.firstYear),
    buildGmDeadMoneyLedger(team.id, s.firstYear),
  ]);
  const myTrades = tradeRows.filter((t) => tradeInvolves(t.headline, team.abbr));
  const countOf = (t: string) => (t === 'TRADE' ? myTrades.length : moveCounts.find((m) => m.type === t)?._count ?? 0);
  // THE TRADES ARE NOT IN THIS FEED EITHER. Every one of them is graded in full
  // a few inches above it on the same tab, and a one-line "Trade: DEN <-> CHI"
  // row under that panel is the same deal printed twice — the exact duplication
  // the draft-complete cleanup went after. Signings, releases and tags have no
  // other rendering anywhere on this page, so they get one.
  const moves = ownMoves.slice(0, 14);

  // THE BEST AND WORST DEAL ARE TAGS ON THE FULL LIST, NOT A SECOND PANEL.
  // A career page used to carry a two-row "Deals That Defined You" panel and
  // link away to the trade screen for the rest; now that the whole graded
  // history is on this page, that panel would be two of these same rows
  // re-rendered directly above themselves. The ranking is `retroEdgeFor`, which
  // returns the very number each row's verdict sentence is written from
  // (lib/tradeRetro.ts), so the "Best of n" tag and the sentence beside it
  // cannot come apart. A deal with a pick still on the board has no grade at
  // all and is not rankable.
  const graded = retrospectives
    .map((r) => ({ r, edge: retroEdgeFor(r, team.abbr) }))
    .filter((x): x is { r: TradeRetrospective; edge: number } => x.edge !== null)
    .sort((a, b) => b.edge - a.edge);
  const dealLabels: Record<string, string> = graded.length >= 2
    ? { [graded[0].r.id]: `Best of ${graded.length}`, [graded[graded.length - 1].r.id]: `Worst of ${graded.length}` }
    : {};
  const tally = { won: 0, lost: 0, even: 0, pending: 0 };
  for (const r of retrospectives) {
    const o = retroOutcomeFor(r, team.abbr);
    if (o === 'WON') tally.won++;
    else if (o === 'LOST') tally.lost++;
    else if (o === 'EVEN') tally.even++;
    else tally.pending++;
  }

  // The card's best deal is the SAME row the panel tags "Best of n" — one
  // ranking, read twice, never computed twice. It is only CLAIMED when the
  // verdict itself calls that deal a win: a card boasting "Best Deal" over a
  // trade the panel below grades as fair is the same figure saying two
  // things. A GM whose best deal was merely fair gets his best season there
  // instead.
  const bestDeal = graded.length > 0 && retroOutcomeFor(graded[0].r, team.abbr) === 'WON'
    ? {
      year: graded[0].r.seasonYear,
      partnerAbbr: graded[0].r.teamAAbbr === team.abbr ? graded[0].r.teamBAbbr : graded[0].r.teamAAbbr,
      received: receivedSummary(graded[0].r, team.abbr),
      // BY HOW MUCH HE WON IT. `graded[0].edge` is retroEdgeFor's own number —
      // the difference between how his return has grown and how the other
      // club's has — which is the same quantity the panel's verdict sentence
      // is written from and the same one this list was ranked on. Read, never
      // recomputed: a percentage here that disagreed with the verdict below
      // would be one deal graded twice.
      edgePct: Math.round(graded[0].edge * 100),
    }
    : null;

  // The header beside the season log reads `s.tenureYears`, which is
  // seasons-on-file plus the one in progress. Row count has to match it.
  const currentSeasonLogged = seasonRecords.some((r) => r.year === league.seasonYear);

  const games = s.wins + s.losses + s.ties;
  const winPct = games > 0 ? s.wins / (s.wins + s.losses || 1) : 0;
  const postGames = headToHead.playoffs.wins + headToHead.playoffs.losses;
  const divGames = headToHead.division.wins + headToHead.division.losses + headToHead.division.ties;

  // ------------------------------------------------------------------ CAREER
  const careerPane = (
    <>
      <div className="grid sm:grid-cols-2 gap-3">
        {s.badges.map((b) => (
          <div key={b.title} className="panel p-4 flex items-start gap-3">
            <span className="text-2xl leading-none">{b.icon}</span>
            <div>
              <div className="font-semibold text-sm">{b.title}</div>
              <div className="text-xs text-muted mt-0.5">{b.blurb}</div>
            </div>
          </div>
        ))}
      </div>

      {/* THE DRAFT AND TRADE TILES ARE NOT HERE ANY MORE. Each one was a
          headline with its evidence three screens away; both now sit at the
          top of the tab that carries that evidence, where the number and the
          table under it are read together. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="stat-tile">
          <div className="label-sm">Record</div>
          <div className="text-lg font-mono font-semibold">{s.wins}-{s.losses}{s.ties ? `-${s.ties}` : ''}</div>
          <div className="text-xs text-muted">{games > 0 ? `${(winPct * 100).toFixed(0)}% win rate` : 'No games yet'}</div>
        </div>
        <div className="stat-tile">
          <div className="label-sm">Championships</div>
          <div className={`text-lg font-mono font-semibold ${s.championships > 0 ? 'text-gold' : ''}`}>{s.championships}</div>
          <div className="text-xs text-muted">{s.playoffAppearances} playoff trip{s.playoffAppearances === 1 ? '' : 's'}</div>
        </div>
        {/* January is its own record and is never folded into the autumn one —
            see buildGmHeadToHead, which keeps the two apart at the source. */}
        <div className="stat-tile">
          <div className="label-sm">In January</div>
          <div className="text-lg font-mono font-semibold">
            {postGames > 0 ? `${headToHead.playoffs.wins}-${headToHead.playoffs.losses}` : '—'}
          </div>
          <div className="text-xs text-muted">{postGames > 0 ? `${postGames} playoff game${postGames === 1 ? '' : 's'}` : 'No playoff games yet'}</div>
        </div>
        <div className="stat-tile">
          <div className="label-sm">In the Division</div>
          <div className="text-lg font-mono font-semibold">
            {divGames > 0 ? `${headToHead.division.wins}-${headToHead.division.losses}${headToHead.division.ties ? `-${headToHead.division.ties}` : ''}` : '—'}
          </div>
          <div className="text-xs text-muted">{divGames > 0 ? `${divGames} games against your rivals` : 'No divisional games yet'}</div>
        </div>
        {/* DISTINCT players, on the owner's call — a five-time All-Star
            quarterback is one All-Star player, not five. The selections count
            sits underneath rather than in the headline slot so the two can
            never be read as each other. Both are bounded to this GM's tenure
            (lib/allStars.ts allStarTallyForTeam). */}
        <div className="stat-tile">
          <div className="label-sm inline-flex items-center gap-1.5">
            All-Star Players
            <Tooltip text={tip('allStar')} />
          </div>
          <div className={`text-lg font-mono font-semibold ${s.allStars.players > 0 ? 'text-gold' : ''}`}>{s.allStars.players}</div>
          <div className="text-xs text-muted">
            {s.allStars.selections === 0
              ? 'None selected yet'
              : `${s.allStars.selections} selection${s.allStars.selections === 1 ? '' : 's'} since ${s.firstYear}`}
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h2 className="section-title">Season Log</h2>
          {/* THE BEST SEASON IS A ROW IN THIS TABLE, NOT A PANEL BESIDE IT.
              A half-width "Best Season" box printed one year, one record and
              one playoff result — all three of which are already in the row
              below it, verbatim. It is named on the header instead and the row
              itself is lit. */}
          <span className="label-sm">
            {s.tenureYears} season{s.tenureYears === 1 ? '' : 's'}
            {s.bestSeason && ` · best was ${s.bestSeason.year} (${RESULT_LABEL[s.bestSeason.result] ?? s.bestSeason.result})`}
          </span>
        </div>
        <div className="panel overflow-hidden">
          <table className="table-clean">
            <thead><tr><th>Year</th><th className="text-right">W</th><th className="text-right">L</th><th className="text-right">T</th><th className="text-right">PF</th><th className="text-right">PA</th><th>Result</th></tr></thead>
            <tbody>
              {/* The season in progress has no TeamSeasonRecord row until it
                  ends, so it's synthesised here — otherwise a first-year GM
                  sees an empty table while sitting on a 7-2 start. Once the
                  year does wrap it has a real row, and this must stand down
                  or the log shows the season twice and outruns the header
                  count beside it. */}
              {!currentSeasonLogged && (
              <tr className="bg-accent/[0.06]">
                <td className="font-mono">{league.seasonYear}</td>
                <td className="font-mono text-right">{team.wins}</td>
                <td className="font-mono text-right">{team.losses}</td>
                <td className="font-mono text-right">{team.ties}</td>
                <td className="font-mono text-muted text-right">{team.pointsFor}</td>
                <td className="font-mono text-muted text-right">{team.pointsAgnst}</td>
                <td className="text-accent text-xs">In progress</td>
              </tr>
              )}
              {seasonRecords.map((r) => (
                <tr
                  key={r.id}
                  className={r.playoffResult === 'CHAMPION' ? 'bg-gold/5' : s.bestSeason && r.year === s.bestSeason.year ? 'bg-chalk/[0.04]' : ''}
                >
                  <td className="font-mono">{r.year}</td>
                  <td className="font-mono text-right">{r.wins}</td>
                  <td className="font-mono text-right">{r.losses}</td>
                  <td className="font-mono text-right">{r.ties}</td>
                  <td className="font-mono text-muted text-right">{r.pointsFor}</td>
                  <td className="font-mono text-muted text-right">{r.pointsAgnst}</td>
                  <td className={`text-xs ${r.playoffResult === 'CHAMPION' ? 'text-gold font-semibold' : 'text-muted'}`}>
                    {r.playoffResult === 'CHAMPION' && '🏆 '}{RESULT_LABEL[r.playoffResult] ?? r.playoffResult}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <GmHeadToHeadPanel h2h={headToHead} />
      <GmTenureMenPanel leagueId={league.id} men={tenureMen} />
      <GmHonoursTimeline awards={s.awards} allStars={s.allStars} />
    </>
  );

  // ------------------------------------------------------------------- DRAFT
  const draftPane = (
    <>
      {/* Three tiles, not four: a "Best Pick" tile naming the same man the
          Best Selection panel names two inches below it was one fact printed
          twice on one screen. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="stat-tile">
          <div className="label-sm inline-flex items-center gap-1.5">
            Draft Hit Rate
            <Tooltip text={tip('draftHitRate')} />
          </div>
          <div className="text-lg font-mono font-semibold">{s.draftHitRate !== null ? `${Math.round(s.draftHitRate * 100)}%` : '—'}</div>
          <div className="text-xs text-muted">
            {/* Below five picks lib/gmCareer.ts withholds the rate rather than
                quoting a percentage off three men, and the tile has to say why
                instead of printing a dash with no explanation. */}
            {s.draftHitRate !== null ? `${s.draftHits}/${s.draftPicksMade} picks hit` : `${s.draftPicksMade} pick${s.draftPicksMade === 1 ? '' : 's'} so far — too few to rate`}
          </div>
        </div>
        <div className="stat-tile">
          <div className="label-sm">Picks Made</div>
          <div className="text-lg font-mono font-semibold">{draftRecord.made}</div>
          <div className="text-xs text-muted">{draftRecord.byRound.length} round{draftRecord.byRound.length === 1 ? '' : 's'} used</div>
        </div>
        <div className="stat-tile">
          <div className="label-sm">Still On Your Roster</div>
          <div className="text-lg font-mono font-semibold">{draftRecord.stillHere}</div>
          <div className="text-xs text-muted">of everyone you have drafted</div>
        </div>
      </div>

      <GmDraftHighlights leagueId={league.id} record={draftRecord} />
      <GmDraftRounds record={draftRecord} />
      <GmDraftTable leagueId={league.id} record={draftRecord} />
    </>
  );

  // ------------------------------------------------------------------- MOVES
  const movesPane = (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="stat-tile">
          <div className="label-sm">Trades Made</div>
          <div className="text-lg font-mono font-semibold">{s.trades}</div>
          <div className="text-xs text-muted">
            {/* The three-way call is retroOutcomeFor's, off the same growth gap
                every verdict below is written from — so this line can never
                disagree with the sentences it is summarising. */}
            {retrospectives.length === 0
              ? 'None graded yet'
              : `${tally.won} won · ${tally.lost} lost · ${tally.even} even${tally.pending > 0 ? ` · ${tally.pending} still playing out` : ''}`}
          </div>
        </div>
        <div className="stat-tile">
          <div className="label-sm">Signings</div>
          <div className="text-lg font-mono font-semibold">{countOf('SIGN')}</div>
          <div className="text-xs text-muted">free agents you brought in</div>
        </div>
        {/* THE RE-SIGNS ARE REAL AND WERE NEVER COUNTED. This ledger carried a
            comment saying nothing in the sim writes a RESIGN transaction, so a
            column for it could only read zero — and `extendContract` and
            `signExtension` (lib/freeagency.ts) have both been writing exactly
            that row, type and all, for every man kept off an expiring deal. On
            the save this was checked against it was 65 of them for one club,
            every one invisible on the page about that GM's decisions. Keeping
            your own players is a decision; it belongs here. */}
        <div className="stat-tile">
          <div className="label-sm">Re-signed</div>
          <div className="text-lg font-mono font-semibold">{countOf('RESIGN')}</div>
          <div className="text-xs text-muted">your own men, kept</div>
        </div>
        <div className="stat-tile">
          <div className="label-sm">Released</div>
          <div className="text-lg font-mono font-semibold">{countOf('CUT')}</div>
          <div className="text-xs text-muted">players you moved on from</div>
        </div>
        {/* No "Drafted" column: the draft tab counts the same picks off the
            pick table itself, and two counters for one number is how they end
            up disagreeing. */}
        <div className="stat-tile">
          <div className="label-sm">Franchise Tags</div>
          <div className="text-lg font-mono font-semibold">{s.tagsUsed}</div>
          <div className="text-xs text-muted">names you refused to let walk</div>
        </div>
      </div>

      <TradeRetrospectives
        myAbbr={team.abbr}
        retrospectives={retrospectives}
        title="Every Deal You Have Made"
        labels={dealLabels}
        action={
          <Link href={`/league/${league.id}/trade`} className="text-xs text-accent2 hover:underline shrink-0">
            Trade center →
          </Link>
        }
      />

      <GmDeadMoneyPanel ledger={deadMoney} avgPerYear={s.avgDeadMoneyPerYear} years={s.deadMoneyYears} />

      <div className="section">
        <div className="section-head">
          <h2 className="section-title">Your Latest Moves</h2>
          {/* The second clause is only true when there IS a graded panel above
              it; on a GM who has never traded, pointing at one is the page
              describing a layout it is not currently rendering. */}
          <span className="label-sm">
            Signings, re-signings, releases and tags{retrospectives.length > 0 && ' — the trades are graded above'}
          </span>
          <Link href={`/league/${league.id}/news`} className="text-xs text-accent2 hover:underline">League wire →</Link>
        </div>
        <div className="panel overflow-hidden divide-y divide-line/50">
          {moves.length === 0 && <div className="px-4 py-4 text-sm text-muted">No moves yet — the ledger starts with your first signing or release.</div>}
          {moves.map((m) => (
            <div key={m.id} className="px-4 py-2">
              <div className="flex items-baseline gap-2">
                <span className="label-sm text-[10px] shrink-0">{m.type}</span>
                <span className="text-sm truncate">{m.headline}</span>
              </div>
              {m.detail && <div className="text-[11px] text-muted mt-0.5 truncate">{m.detail}</div>}
            </div>
          ))}
        </div>
      </div>
    </>
  );

  return (
    <div className="space-y-5">
      <div
        className="relative overflow-hidden rounded-lg border-2 shadow-elevated"
        style={{
          ['--team-accent' as never]: generateTeamLogoParams(team.abbr).primary,
          borderColor: 'var(--team-accent)',
          background: 'radial-gradient(ellipse 120% 140% at 0% 0%, color-mix(in srgb, var(--team-accent) 16%, transparent), transparent 70%)',
        }}
      >
        <TeamLogo seed={team.id} abbr={team.abbr} size={220} className="watermark-logo opacity-[0.06] -right-14 -top-14" />
        <div className="relative flex flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-4 min-w-0">
            <TeamLogo seed={team.id} abbr={team.abbr} size={48} />
            <div>
              <div className="label-sm">GM Career</div>
              <div className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none mt-1 text-team">
                {team.city} {team.nickname}
              </div>
              <p className="text-muted text-sm mt-1.5">
                On the job since {s.firstYear} — {s.tenureYears} season{s.tenureYears === 1 ? '' : 's'} and counting.
              </p>
            </div>
          </div>
          {/* Everything the card prints is handed to it from this page's own
              summary — it is a second VIEW of these numbers, never a second
              source for them. */}
          <div className="shrink-0 text-right">
            {/* Says what the button makes, because "GM Card" alone does not.
                No instruction and no verb aimed at the reader — the sentence
                describes the artefact, and what he does with it is his. */}
            <p className="text-xs text-muted mb-2 max-w-[13rem] ml-auto leading-snug">
              {s.tenureYears} season{s.tenureYears === 1 ? '' : 's'} on one card, sized for a screenshot.
            </p>
            <GmCardReveal>
              <GmCard
                team={team}
                leagueName={league.name}
                seasonYear={league.seasonYear}
                gmName={owner?.username ?? null}
                summary={s}
                dynastyLevel={dynasty.level.level}
                bestDeal={bestDeal}
              />
            </GmCardReveal>
          </div>
        </div>
      </div>

      <GmCareerTabs
        initial="career"
        panes={[
          {
            id: 'career',
            label: 'Career',
            hint: `${s.tenureYears} season${s.tenureYears === 1 ? '' : 's'} · ${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}`,
            body: careerPane,
          },
          {
            id: 'draft',
            label: 'Draft',
            hint: draftRecord.made > 0
              ? `${draftRecord.made} pick${draftRecord.made === 1 ? '' : 's'} · ${draftRecord.hits} hit`
              : 'No picks called yet',
            body: draftPane,
          },
          {
            id: 'moves',
            label: 'Moves',
            hint: `${s.trades} trade${s.trades === 1 ? '' : 's'} · ${countOf('SIGN')} signing${countOf('SIGN') === 1 ? '' : 's'}`,
            body: movesPane,
          },
        ]}
      />
    </div>
  );
}
