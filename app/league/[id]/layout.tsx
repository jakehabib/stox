import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLeagueContext } from '@/lib/league-data';
import { AdvanceWeekButton } from '@/components/AdvanceWeekButton';
import { formatMoney } from '@/lib/cap';
import { TeamLogo } from '@/components/TeamLogo';
import { LeagueNav } from '@/components/LeagueNav';
import { LeagueWireTicker } from '@/components/ds/LeagueWireTicker';
import { isBreakingNews } from '@/lib/wireRank';
import { AWARD_TYPES } from '@/lib/awardTypes';
import { loadWorkoutSlots } from '@/lib/workouts';
import { CapAlertBanner } from '@/components/ds/CapAlertBanner';
import { LineupGapBanner } from '@/components/ds/LineupGapBanner';
import { SigningMomentProvider } from '@/components/SigningMoment';
import { lineupGaps } from '@/lib/lineup';
import { capComplianceDueNow } from '@/lib/season';
import { capComplianceReport } from '@/lib/capEnforcement';
import { transactionCategory } from '@/lib/newsCategory';
import { ensurePowerSnapshot, powerRankingWireItems } from '@/lib/powerRankings';
import { prisma } from '@/lib/db';
import { AccountBadge } from '@/components/auth/AccountBadge';
import { tip } from '@/lib/glossary';

export const dynamic = 'force-dynamic';

export default async function LeagueLayout({ children, params }: { children: React.ReactNode; params: { id: string } }) {
  const ctx = await getLeagueContext(params.id).catch(() => null);
  if (!ctx || !ctx.userTeam) notFound();
  const { league, userTeam, phaseLabel } = ctx;

  // Ticker carries breaking news only — real events that happened around the
  // league. Deliberately excludes NEWS/DEV_MILESTONE stat-leader trivia:
  // it isn't breaking, and the Dashboard's League Wire already shows it, so
  // including it made the two read as duplicates of each other.
  // capMode OFF means there is no ceiling to be under, so neither the header
  // figure nor the compliance banner has anything true to say — both are
  // skipped rather than rendering a number the rest of the UI disowns.
  // (teamCapSummary's capSpace is +Infinity in that mode; see its doc.)
  // One report covers both the header figure and the compliance banner —
  // capComplianceReport wraps teamCapSummary and short-circuits the extra
  // roster scan when the team is compliant, so this is no more work than
  // the plain summary this used to call, and never two of them.
  const [compliance, workouts, tickerTx, powerItems, wireTeamRows, lineupRoster, pendingOfferCount, walkYearCount] = await Promise.all([
    ctx.settings.capMode === 'OFF' ? Promise.resolve(null) : capComplianceReport(userTeam.id, league.seasonYear, ctx.settings.capMode),
    // Private workouts are the ONLY scarce thing left in scouting — the
    // consensus board is free and the shortlist costs nothing to work — which
    // is exactly why the slot count is the one scouting number worth a
    // permanent slot next to cap space. (The focus-point balance that used to
    // sit here was a currency the GM was charged to learn what the whole
    // league already knew; it is gone, along with its tile.)
    ctx.settings.scoutingEnabled === false
      ? Promise.resolve(null)
      : loadWorkoutSlots(league.id).catch(() => null),
    prisma.transaction.findMany({
      // 'INJURY' is deliberately absent. The sim writes one injury row per game
      // per week — sixteen a week — so including the type here spent the whole
      // window on other clubs' training rooms and left mid-season leagues with
      // no ticker-eligible news at all within reach.
      //
      // The seasonYear floor is not an optimisation. League creation seeds two
      // decades of fictional backstory — a CHAMPION row and five award rows for
      // every year back to ~2004 — and every one of those is written at
      // creation time, so `orderBy createdAt desc` put ALL of them ahead of
      // anything that has actually happened in the save. A league in its fifth
      // season showed a wire of nothing but "The Minneapolis Norsemen are your
      // 2008 champions!". Ordering cannot fix this, because createdAt is
      // honest about when the row was written and lying about when the event
      // happened; only the league year the event belongs to can.
      where: {
        leagueId: league.id,
        // 'ALL_STAR' (one row per selection, ~76 of them in the week the
        // regular season ends) is deliberately absent for the same reason
        // 'INJURY' is: it would spend the whole window on other clubs' honour
        // rolls. The single 'ALL_STAR_ROSTER' announcement is the
        // ticker-worthy half; the individual selections are the record, and
        // they are read where they belong — the player's card and the GM's
        // career page.
        // ...AWARD_TYPES rather than the trophies spelled out again: the
        // ticker is where a new award is least likely to be missed by a
        // reader and most likely to be missed by a maintainer.
        type: { in: ['TRADE', 'SIGN', 'RESIGN', 'CUT', 'TAG', 'POSITION', 'DRAFT', 'FIRE', 'CHAMPION', 'ALL_STAR_ROSTER', ...AWARD_TYPES] },
        seasonYear: { gte: league.seasonYear - 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: 120,
    }),
    // The week's power-ranking movers, from the stored weekly snapshots only
    // (lib/powerRankings.ts). It reads no ranking and computes none — two
    // indexed queries on a layout that renders on every league page — and it
    // obeys the same three rules as everything else on this strip: current
    // league year only (both snapshots are filtered to league.seasonYear, so
    // an old season cannot scroll past the way the seeded championships used
    // to), never padded (a quiet week returns nothing and the strip is
    // shorter), and capped at two so a ranking update cannot crowd out a
    // trade or a firing. A failure here must not 500 every league page, so it
    // degrades to no items.
    powerRankingWireItems(params.id, league).catch(() => []),
    // Id -> abbr for the wire strip. 32 rows of two columns, on a layout that
    // already runs four queries; the crest is what turns a name into news.
    prisma.team.findMany({ where: { leagueId: league.id }, select: { id: true, abbr: true } }),
    // Only the three columns lineupGaps needs. A starting spot with nobody
    // healthy for it costs a week, and the only screen that hinted at it was
    // the depth chart — which counts bodies, not men who can actually play.
    prisma.player.findMany({
      where: { teamId: userTeam.id, status: { not: 'RETIRED' } },
      select: { position: true, injuryWeeks: true, status: true },
    }),
    /*
     * ===================================================================
     * THE TWO COUNTS THE NAV WEARS. See LeagueNav's BADGES note for why
     * these two and not others.
     * ===================================================================
     * Trade offers: the SAME query lib/frontOffice.ts counts the brief item
     * from — pending, inbound, this league. A nav badge reading 3 above a
     * trade page listing 2 would be this codebase's signature defect in a
     * new place, so there is one definition and both read it.
     */
    prisma.tradeOffer.count({ where: { leagueId: league.id, toTeamId: userTeam.id, status: 'PENDING' } }),
    /*
     * Re-sign: men who walk at the END OF THIS LEAGUE YEAR, and only while
     * the window is open. This is the phase-pinned cohort from the re-sign
     * page itself — during OFFSEASON and RESIGN, contracts have already been
     * aged, so `yearsRemaining: 0` is exactly the list that page renders and
     * exactly the list `releaseUnresignedExpiringContracts` will take.
     *
     * Deliberately zero in every other phase, badge and all. In-season the
     * same idea would count every walk-year man on the roster — non-zero
     * essentially always, on a decision with a twelve-month clock — and a
     * badge that is always on is furniture. The one that only lights when
     * men are actually about to leave is the one a GM will still read in his
     * fifth season.
     */
    league.phase === 'OFFSEASON' || league.phase === 'RESIGN'
      ? prisma.player.count({
        where: { teamId: userTeam.id, status: 'ACTIVE', contract: { yearsRemaining: 0 } },
      })
      : Promise.resolve(0),
  ]);

  // Write this week's ranking down once, the first time any league page is
  // opened in a new week. Movement CANNOT be recomputed later — a team rating
  // moves with the roster, so a club that signed a free agent on Tuesday would
  // retroactively rewrite what it was ranked on Sunday — which is why it has
  // to be captured as the week is being lived. The ideal home for this is the
  // week tick in lib/season.ts; this is the version that does not need to own
  // that file, and it is idempotent either way (see ensurePowerSnapshot).
  await ensurePowerSnapshot(league.id, { league }).catch(() => {});
  // Last season's title and awards stay wire-worthy through the first few
  // weeks of the new league year — that is still "what just happened" to a GM
  // reporting for a new season — and go quiet after that. Everything older is
  // history, and history has its own page.
  const wireEligible = tickerTx.filter(
    (t) => t.seasonYear === league.seasonYear || (t.seasonYear === league.seasonYear - 1 && league.week <= 4),
  );

  // Injuries outnumber every other event type by an order of magnitude, so a
  // straight "most recent 14" is a wall of identical injury lines. Round-robin
  // across categories instead — recency still orders within each category.
  // WHOSE NEWS IT IS. The strip read "SIGNING Signed Stellan Millsap /
  // LEAGUE Released Cassius Sinclair" — a name and a verb, with no club
  // anywhere, which the app owner called out: "these aren't really useful.
  // they aren't showing the teams even". Every one of these rows has carried
  // a teamId all along; only the render dropped it. The crest is identity
  // (README design principle 2), so it goes in rather than more text.
  const wireTeams = new Map(wireTeamRows.map((t) => [t.id, t.abbr]));
  const byCategory = new Map<string, { category: ReturnType<typeof transactionCategory>; headline: string; teamAbbr?: string }[]>();
  // Breaking news only. Round-robin alone still admitted injury reports and
  // "pacing the league" filler, which is what made the ticker read as a wall
  // of identical lines late in a season — one lane counted fourteen items in
  // week 17, every one of them an injury report for a team the player had no
  // relationship with.
  for (const t of wireEligible.filter((x) => isBreakingNews(x.type, x.headline))) {
    const cat = transactionCategory(t.type, t.headline);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push({ category: cat, headline: t.headline, teamAbbr: t.teamId ? wireTeams.get(t.teamId) : undefined });
  }
  // Capped, never padded. If four things have happened this season, the wire
  // carries four; if nothing has, it does not render at all (the component
  // returns null on an empty list). A strip that is always full is a strip
  // that is reaching for filler, and filler is what put two-decade-old
  // championships on it in the first place.
  // Four per category, so a free-agency week cannot fill the whole strip with
  // eight consecutive "Signed <name>" lines. Round-robin already interleaves
  // categories when several are active; the cap is what handles the weeks
  // where only one is.
  const PER_CATEGORY_CAP = 4;
  // Power-ranking movement enters the round-robin as its own category rather
  // than being prepended, so it takes at most one slot per round like every
  // other kind of news and is bound by the same cap. It is genuinely weekly,
  // genuinely breaking and genuinely about the league, which is why it is here
  // at all — but it does not get to be special.
  // Bucketed separately from LEAGUE so it competes with itself for slots
  // rather than with a coordinator being fired; filed under the LEAGUE kicker
  // because that is what it is when it is read out.
  if (powerItems.length > 0) {
    byCategory.set('POWER', powerItems.map((p) => ({ category: p.category, headline: p.headline })));
  }
  const tickerItems: { category: ReturnType<typeof transactionCategory>; headline: string; teamAbbr?: string }[] = [];
  for (let round = 0; round < PER_CATEGORY_CAP && tickerItems.length < 14; round++) {
    let added = false;
    for (const [, rows] of byCategory) {
      if (round >= rows.length || tickerItems.length >= 14) continue;
      tickerItems.push(rows[round]);
      added = true;
    }
    if (!added) break;
  }

  // Only while games are being played. An empty slot in the offseason is a
  // roster still being built, not a hole you are about to lose a game to.
  //
  // A playtest asked for this to extend through OFFSEASON, RESIGN,
  // FREE_AGENCY and DRAFT — "the entire period a GM is building his roster".
  // DELIBERATELY NOT DOING THAT, and the reason is the same one that makes
  // the banner worth having in-season: it has to differ by outcome or it is
  // wallpaper. `releaseUnresignedExpiringContracts` empties every walk-year
  // deal in the league the moment free agency opens, so on the first screen
  // of the building period a normal club is missing several starters BY
  // DESIGN. A standing red alarm that is on from the offseason roll until the
  // roster is rebuilt is on for almost the whole period, and a GM learns to
  // read past it — including in PRESEASON, where it is still here and where a
  // gap genuinely does cost the next game.
  //
  // The building phases got doors instead of an alarm, which is what the
  // playtest was actually short of: DepthChartGroup's Unmanned row now opens
  // /free-agency?pos= for the position it names, and the depth chart's "Open
  // Starting Slots" and "No Backup" masthead tiles do the same. Those state
  // the hole where the GM is already looking at it, without claiming a
  // deadline that has not arrived.
  const gaps = ['REGULAR', 'PLAYOFFS', 'PRESEASON'].includes(league.phase)
    ? lineupGaps(lineupRoster)
    : [];

  return (
    <div className="min-h-screen">
      <LeagueWireTicker items={tickerItems} />
      <header className="border-b border-line bg-surface/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <Link href="/" className="flex items-center gap-2 shrink-0">
              <div className="w-7 h-7 rounded-md bg-accent/15 border border-accent/30 flex items-center justify-center text-accent font-display font-bold text-sm">D</div>
              <span className="font-display font-bold text-base tracking-wide uppercase hidden sm:inline">Dynasty GM</span>
            </Link>
            {/* Compact: this header already carries a crest, a cap figure, a
                workout count and a phase tile. Signed out it is the nudge, in
                the place a player actually spends their time — signed in it is
                the indicator and the way out. */}
            <div className="hidden md:block"><AccountBadge compact /></div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <TeamLogo seed={userTeam.id} abbr={userTeam.abbr} size={32} className="hidden sm:block" />
              <div className="text-right hidden md:block">
                <div className="text-sm font-semibold leading-tight">{userTeam.city} {userTeam.nickname}</div>
                <div className="text-xs text-muted leading-tight">{userTeam.wins}-{userTeam.losses}{userTeam.ties ? `-${userTeam.ties}` : ''} · {userTeam.conference} {userTeam.division}</div>
              </div>
            </div>
            {/* THE ONE PLACE CAP SPACE IS ALWAYS ON SCREEN was the one place
                it was never defined. `capSpace` is in the glossary and is
                tipped on the roster, cap, re-sign, free-agency and trade
                screens; the header — where a first-timer meets the number
                before he has opened any of them — carried neither a Tooltip
                nor a title. A native title rather than a <Tooltip>, because
                this strip is dense and a bubble here would open over the
                Advance button. It is a link for the same reason Workouts
                beside it is one: the number names a budget, and /cap is where
                that budget is spent. */}
            {compliance && (
              <Link
                href={`/league/${league.id}/cap`}
                className="stat-tile hidden lg:block text-right hover:border-accent/50 transition-colors"
                title={tip('capSpace')}
              >
                <div className="label-sm">Cap Space</div>
                <div className={`text-sm font-mono font-semibold ${compliance.capSpace >= 0 ? 'text-accent' : 'text-bad'}`}>{formatMoney(compliance.capSpace)}</div>
              </Link>
            )}
            {workouts && (
              <Link
                href={`/league/${league.id}/scouting`}
                className="stat-tile hidden lg:block text-right hover:border-accent2/50 transition-colors"
                // The window label alone says WHEN, never WHAT. `privateWorkout`
                // is written in the glossary and reached nothing; a GM who has
                // not yet opened the scouting page had no way to learn what a
                // workout is from the tile that counts them down.
                title={`${workouts.windowLabel} — ${tip('privateWorkout')}`}
              >
                <div className="label-sm">Workouts</div>
                <div className={`text-sm font-mono font-semibold ${
                  !workouts.open ? 'text-muted' : workouts.remaining === 0 ? 'text-bad' : 'text-accent2'
                }`}>
                  {workouts.remaining}<span className="text-muted">/{workouts.max}</span>
                </div>
              </Link>
            )}
            <div className="stat-tile text-right">
              <div className="label-sm">{phaseLabel}</div>
              <div className="text-sm font-mono font-semibold">{league.seasonYear} · Wk {league.week}</div>
            </div>
            <AdvanceWeekButton leagueId={league.id} currentPhase={league.phase} />
          </div>
        </div>
        {/* Keyed by the nav item's own href so the nav never has to know what
            any of these numbers mean. Zero and absent are the same thing to it
            — no badge — so a phase where a count is deliberately not collected
            needs no special case here. `gaps` is reused rather than recounted:
            it is `lineupGaps` from lib/lineup.ts, the same definition the sim
            fields and the depth chart draws, and the same one the banner below
            reads, so the badge and the banner can never disagree. */}
        <LeagueNav
          leagueId={league.id}
          counts={{ '/trade': pendingOfferCount, '/resign': walkYearCount, '/depth-chart': gaps.length }}
        />
        {gaps.length > 0 && <LineupGapBanner leagueId={league.id} gaps={gaps} />}
        {compliance && !compliance.compliant && (
          <CapAlertBanner
            leagueId={league.id}
            shortfall={compliance.shortfall}
            capUsed={compliance.capUsed}
            capTotal={compliance.capTotal}
            deadMoney={compliance.deadMoney}
            complianceDue={capComplianceDueNow(league.phase)}
            blocksAdvance={ctx.settings.capMode === 'REALISTIC' && compliance.fixable && capComplianceDueNow(league.phase)}
            moves={compliance.relief.slice(0, 2).map((r) => ({
              playerId: r.playerId, name: r.name, position: r.position, frees: r.frees, kind: r.kind,
            }))}
          />
        )}
      </header>
      {/* THE SIGNING CARD IS RAISED TO THE LAYOUT, not left in the panel that
          signed the player. It is the only level at which it survives what a
          signing does to the page underneath it — and hoisting it is what lets
          a signing revalidate this layout at all, which is what keeps the two
          banners above honest without waiting on the user to dismiss anything.
          The whole argument is written in SigningMomentProvider. */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <SigningMomentProvider>{children}</SigningMomentProvider>
      </main>
    </div>
  );
}
