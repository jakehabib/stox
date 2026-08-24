import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { positionSortKey } from '@/lib/league-data';
import { teamCapSummary, capSheet } from '@/lib/cap-summary';
import { formatMoney, capHit, deadMoneyOnCut, capSavingsOnCut, capHitSchedule, capForYear, marketValue } from '@/lib/cap';
import { resolveStartYear } from '@/lib/leagueYear';
import { capGrowthRate } from '@/lib/settings';
import { Tooltip } from '@/components/Tooltip';
import { tip } from '@/lib/glossary';
import { POSITION_GROUPS, positionGroup } from '@/lib/positionGroups';
import { HorizontalBarChart } from '@/components/charts/HorizontalBarChart';
import { ScatterChart } from '@/components/charts/ScatterChart';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { MetricTiles } from '@/components/ds/MetricTiles';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { MultiYearOutlookPanel } from '@/components/cap/MultiYearOutlookPanel';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { DeadMoneyRunwayPanel } from '@/components/cap/DeadMoneyRunwayPanel';
import { buildCapHealth, rankContractValue, classifyContractValue, type CapHealth, type SurplusRow } from '@/lib/analytics';
import { capComplianceReport } from '@/lib/capEnforcement';
import { capComplianceDueNow } from '@/lib/season';

type SortKey = 'pos' | 'age' | 'ovr' | 'cap' | 'base' | 'years' | 'savings';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'pos', label: 'Pos' },
  { key: 'age', label: 'Age' },
  { key: 'ovr', label: 'OVR' },
  { key: 'cap', label: 'Cap Hit' },
  { key: 'base', label: 'Base' },
  { key: 'years', label: 'Yrs Left' },
  { key: 'savings', label: 'Cut: Net Saving / Dead' },
];

// Fixed group -> color assignment, in POSITION_GROUPS order — identity, not
// value-rank, drives the color per the dataviz skill's categorical rule.
const GROUP_COLOR: Record<string, string> = {
  QB: '#3987e5', RB: '#d95926', WR: '#199e70', TE: '#7d5bbe', OL: '#c98500',
  DL: '#d55181', LB: '#008300', DB: '#9085e9', ST: '#e66767',
};

export default async function CapPage({ params, searchParams }: { params: { id: string }; searchParams: { sort?: string; dir?: string; view?: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;
  const advanced = searchParams.view === 'advanced';

  if (settings.capMode === 'OFF') {
    return (
      <div className="space-y-4">
        <h1 className="font-display font-extrabold text-3xl uppercase tracking-wide">Salary Cap</h1>
        <div className="panel p-4 text-muted text-sm">
          Cap mode is set to <strong>Off</strong> in league settings — spending has no limit and cuts leave no dead money.
          Change this in <Link href={`/league/${league.id}/settings`} className="text-accent2 hover:underline">Settings</Link>.
        </div>
      </div>
    );
  }

  const [summary, players, sheet, compliance] = await Promise.all([
    teamCapSummary(team.id, league.seasonYear, settings.capMode),
    prisma.player.findMany({ where: { teamId: team.id, status: 'ACTIVE' }, include: { contract: true } }),
    // The whole future cap in one call — ceilings, contracts and dead money.
    // It feeds BOTH Advanced-only panels: the outlook bars at the top of the
    // tab and the dead-money runway at the foot of it. That is the point of
    // fetching it once rather than twice — the top bar's dead segment and the
    // bottom panel's ledger are the same numbers, so the summary is the sum of
    // the detail and the two can no longer be dated off different calendars,
    // which is exactly what the two charts they replace were doing.
    //
    // Only fetched for the view that renders it. It reads the roster, the
    // ledger and every live contract's void years, so paying for it on a Basic
    // view that will not show it is three reads and a walk for nothing.
    advanced ? capSheet(team.id, league, settings.capMode) : Promise.resolve(null),
    capComplianceReport(team.id, league.seasonYear, settings.capMode),
  ]);

  const usedPct = Math.min(100, Math.round((summary.capUsed / summary.capTotal) * 100));

  const rows = players.map((p) => {
    const bases = p.contract ? (JSON.parse(p.contract.baseSalaries) as number[]) : [];
    const yearIdx = p.contract ? Math.max(0, p.contract.years - p.contract.yearsRemaining) : 0;
    return {
      p,
      hit: capHit(p.contract, settings.capMode),
      base: bases[yearIdx] ?? 0,
      dead: deadMoneyOnCut(p.contract, settings.capMode),
      savings: capSavingsOnCut(p.contract, settings.capMode),
    };
  });

  const sortKey: SortKey = (['pos', 'age', 'ovr', 'cap', 'base', 'years', 'savings'] as SortKey[]).includes(searchParams.sort as SortKey)
    ? (searchParams.sort as SortKey) : 'cap';
  const dir = searchParams.dir === 'asc' ? 1 : -1;

  const sorted = [...rows].sort((a, b) => {
    switch (sortKey) {
      case 'age': return (a.p.age - b.p.age) * dir;
      case 'ovr': return (a.p.trueOvr - b.p.trueOvr) * dir;
      case 'cap': return (a.hit - b.hit) * dir;
      case 'base': return (a.base - b.base) * dir;
      case 'years': return ((a.p.contract?.yearsRemaining ?? 0) - (b.p.contract?.yearsRemaining ?? 0)) * dir;
      case 'savings': return (a.savings - b.savings) * dir;
      default: return (positionSortKey(a.p.position) - positionSortKey(b.p.position)) * dir || b.p.trueOvr - a.p.trueOvr;
    }
  });

  /**
   * WHAT COMES OFF THESE BOOKS ON ITS OWN, and why this figure is on the page.
   *
   * The app owner, on a club that read -$60M at the offseason roll and got
   * better twice while its GM made no move: *"he changed nothing. What is
   * going on there?"* Part of that was arithmetic and is fixed at the source
   * (bookYearFor, lib/cap-summary.ts). The rest is real accounting with
   * nothing on screen to explain it: a man whose deal has run out is still
   * rostered and still charged his final year's number until the re-sign
   * window shuts, and then he is gone. On a measured club that was $11.3M
   * across four men — bigger than the whole arithmetic error — and the only
   * way to see it coming was to press Advance.
   *
   * `r.hit` is `capHit`, the same figure `teamCapSummary` sums into the
   * Committed tile above, so this is a slice of that number and not a second
   * opinion on it.
   */
  const expiring = rows.filter((r) => r.p.contract != null && r.p.contract.yearsRemaining === 0);
  const expiringCap = expiring.reduce((s, r) => s + r.hit, 0);

  const sortHref = (key: SortKey) => {
    const nextDir = sortKey === key && dir === -1 ? 'asc' : 'desc';
    return `/league/${league.id}/cap?sort=${key}&dir=${nextDir}${advanced ? '&view=advanced' : ''}`;
  };

  // --- Advanced-view data -----------------------------------------------
  let allocationBars: { label: string; value: number; displayValue: string; color: string }[] = [];
  let valuePoints: { id: string; x: number; y: number; label: string; color: string; detail?: string }[] = [];
  let vsLeagueBars: { label: string; value: number; displayValue: string; color: string }[] = [];
  let health: CapHealth | null = null;
  let contractValue: { bargains: SurplusRow[]; overpays: SurplusRow[] } = { bargains: [], overpays: [] };
  let leagueCapUsedRank = 0;

  if (advanced) {
    // League-average spend per position group, so "too much at one spot" has
    // a real baseline instead of just eyeballing the allocation chart alone.
    const [leagueTeams, leaguePlayers] = await Promise.all([
      prisma.team.count({ where: { leagueId: league.id } }),
      prisma.player.findMany({ where: { leagueId: league.id, status: 'ACTIVE' }, include: { contract: true } }),
    ]);
    const leagueByGroup = new Map<string, number>();
    for (const g of POSITION_GROUPS) leagueByGroup.set(g, 0);
    for (const p of leaguePlayers) {
      const hit = capHit(p.contract, settings.capMode);
      const g = positionGroup(p.position);
      leagueByGroup.set(g, (leagueByGroup.get(g) ?? 0) + hit);
    }
    const myByGroup = new Map<string, number>();
    for (const g of POSITION_GROUPS) myByGroup.set(g, 0);
    for (const { p, hit } of rows) myByGroup.set(positionGroup(p.position), (myByGroup.get(positionGroup(p.position)) ?? 0) + hit);

    vsLeagueBars = POSITION_GROUPS.map((g) => {
      const avg = (leagueByGroup.get(g) ?? 0) / Math.max(1, leagueTeams);
      const mine = myByGroup.get(g) ?? 0;
      const diff = mine - avg;
      return {
        label: g,
        value: Math.abs(diff),
        displayValue: `${diff >= 0 ? '+' : '-'}${formatMoney(Math.abs(diff))} vs avg`,
        color: diff >= 0 ? '#e66767' : '#3987e5',
      };
    }).sort((a, b) => b.value - a.value);
    const byGroup = new Map<string, number>();
    for (const g of POSITION_GROUPS) byGroup.set(g, 0);
    for (const { p, hit } of rows) byGroup.set(positionGroup(p.position), (byGroup.get(positionGroup(p.position)) ?? 0) + hit);
    allocationBars = POSITION_GROUPS
      .map((g) => ({ label: g, value: byGroup.get(g) ?? 0, displayValue: `${formatMoney(byGroup.get(g) ?? 0)} (${summary.capUsed > 0 ? Math.round(((byGroup.get(g) ?? 0) / summary.capUsed) * 100) : 0}%)`, color: GROUP_COLOR[g] }))
      .sort((a, b) => b.value - a.value);

    // THE MULTI-YEAR OUTLOOK CHART USED TO BE BUILT HERE and is gone, not
    // moved: `capSheet` above draws the same four years with the dead money
    // put back in and room — the number a GM actually plans against — as the
    // headline. What died with it is a second, subtly different derivation of
    // the ceiling curve on this same page.
    //
    // `startYear` stays, because buildCapHealth below still needs next year's
    // ceiling. The rate has to be passed with it: the two-argument form of
    // capForYear falls back to the tuning default, so a FLAT league would be
    // measured against a curve it is not being played on — $255.0M against
    // $265.3M two years in, on a league whose ceiling never moves.
    const startYear = await resolveStartYear(league);

    const surplusRows: SurplusRow[] = rows
      .filter(({ p }) => p.contract)
      .map(({ p, hit }) => {
        const expected = marketValue({ ovr: p.trueOvr, position: p.position as any, age: p.age, potential: p.potential });
        const surplus = expected - hit; // positive = paying under what the rating is worth
        return {
          playerId: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position,
          age: p.age, ovr: p.trueOvr, hit, marketValue: expected,
          surplus, tier: classifyContractValue(surplus, expected),
        };
      });
    contractValue = rankContractValue(surplusRows);
    valuePoints = surplusRows.map((r) => ({
      id: r.playerId, x: r.ovr, y: r.hit, label: r.name,
      // Muted gray for market-rate deals — only a material deviation earns blue/red.
      color: r.tier === 'bargain' ? '#3987e5' : r.tier === 'overpay' ? '#e66767' : '#93939c',
      detail: r.tier === 'market'
        ? 'within market range'
        : r.surplus >= 0 ? `${formatMoney(r.surplus)}/yr under market value` : `${formatMoney(-r.surplus)}/yr over market value`,
    }));

    health = buildCapHealth({
      rows: rows.map(({ p, hit }) => ({
        age: p.age,
        hit,
        yearsRemaining: p.contract?.yearsRemaining ?? 0,
        nextYearHit: p.contract ? (capHitSchedule(p.contract, settings.capMode)[1] ?? 0) : 0,
      })),
      capUsed: summary.capUsed,
      capTotal: summary.capTotal,
      // NEXT year is next relative to the year these hits are written in, not
      // next relative to the league clock. `nextYearHit` above is
      // capHitSchedule[1], i.e. the season after the contract ledger's current
      // one — so through OFFSEASON weeks 1-2, pairing it with seasonYear + 1
      // measured next year's salaries against THIS year's ceiling.
      nextYearCapTotal: capForYear(summary.capYear + 1, startYear, capGrowthRate(settings)),
      deadMoney: summary.deadMoney,
    });

    // Where this team's committed spend sits against the rest of the league —
    // a raw cap number means nothing without knowing if 32 other teams are
    // spending more or less.
    const spendByTeam = new Map<string, number>();
    for (const p of leaguePlayers) {
      if (!p.teamId) continue;
      spendByTeam.set(p.teamId, (spendByTeam.get(p.teamId) ?? 0) + capHit(p.contract, settings.capMode));
    }
    const spends = Array.from(spendByTeam.values()).sort((a, b) => b - a);
    leagueCapUsedRank = spends.findIndex((v) => v <= (spendByTeam.get(team.id) ?? 0)) + 1;
  }

  return (
    <div className="space-y-6">
      <PageMasthead
        teamId={team.id}
        teamAbbr={team.abbr}
        /* summary.capYear, NOT league.seasonYear. Through OFFSEASON weeks 1-2
           the contract ledger has already rolled onto the new league year and
           League.seasonYear has not, so every figure in this masthead is
           written in the year teamCapSummary resolved — see bookYearFor in
           lib/cap-summary.ts. Labelling them off the League row is how this
           page came to head next year's salaries with last year's date. */
        eyebrow={`${summary.capYear} Salary Cap`}
        title={`${team.city} ${team.nickname}`}
        action={
          <div className="flex gap-1.5">
            <Link href={`/league/${league.id}/cap`} className={`pill ${!advanced ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-chalk'}`}>Basic</Link>
            <Link href={`/league/${league.id}/cap?view=advanced`} className={`pill ${advanced ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-chalk'}`}>Advanced</Link>
          </div>
        }
        facts={[
          {
            label: 'Cap Space',
            value: formatMoney(summary.capSpace),
            detail: `${usedPct}% of the cap used`,
            tip: tip('capSpace'),
            color: summary.capSpace >= 0 ? 'text-accent' : 'text-bad',
          },
          { label: 'Cap Limit', value: formatMoney(summary.capTotal), detail: `${summary.capYear} league cap`, tip: tip('capLimit') },
          { label: 'Committed', value: formatMoney(summary.capUsed), detail: `${players.length} contracts`, tip: tip('committedCap') },
          {
            label: 'Dead Money',
            value: formatMoney(summary.deadMoney),
            detail: summary.deadMoney > 0 ? 'already spent, unrecoverable' : 'none on the books',
            tip: tip('deadMoney'),
            color: summary.deadMoney > 0 ? 'text-bad' : 'text-accent',
          },
          { label: 'Mode', value: settings.capMode === 'REALISTIC' ? 'Realistic' : 'Simplified', detail: 'set in league settings', tip: tip('capMode') },
        ]}
      />

      {!compliance.compliant && (
        <div className="panel p-4 border-bad/40 bg-bad/5 space-y-3">
          <div className="section-head !pb-1.5">
            <div>
              <div className="section-eyebrow text-bad">Non-compliant</div>
              <h2 className="section-title">Path back under the cap</h2>
            </div>
            <div className="stat-value text-stat-lg text-bad">{formatMoney(compliance.shortfall)}</div>
          </div>

          <p className="text-sm text-muted">
            {/* THE COPY HAS TO NAME THE PRICE. Both the offseason line and the
                unfixable line used to end at "the week advances anyway", which
                was true and was read — correctly — as "and nothing happens".
                A club that closes a league year over the ceiling now carries
                the overage into the next one as a real charge (see
                settleClosingYearCapOverage in lib/season.ts), so the sentence
                that tells a GM he is not stuck has to be the same sentence
                that tells him what it costs. */}
            {!capComplianceDueNow(league.phase)
              ? `Every team's books run heavy through the offseason roll — expiring contracts only come off when free agency opens, and the new league year starts whether or not you are under the ceiling.`
                + (expiring.length > 0
                  ? ` ${expiring.length} of the contracts above ${expiring.length === 1 ? 'has' : 'have'} run out: ${formatMoney(expiringCap)} of what is committed here comes off by itself the moment the re-sign window shuts, without you cutting anybody.`
                  : '')
                + ` Get back under it before this season closes: whatever you are still over by when it does is carried into the next league year as dead money.`
              : settings.capMode === 'REALISTIC' && compliance.fixable
                ? 'The week will not advance until you are back under the ceiling. Any combination of these clears it — cuts and restructures below, or a trade that sends salary out.'
                : compliance.fixable
                  ? 'Clear the shortfall before adding any more salary — signings, extensions, tags and trades are all blocked while you are over.'
                  : 'Cutting every player who frees cap space still would not clear this — most of your commitment is dead money that cannot be released. A trade that sends salary out is the only route, and the week is allowed to advance so you are never stuck standing still. That is a reprieve, not a pardon: whatever you are still over by when the season ends is carried into next year as dead money, and it will be there on this page under \u201cCap overage carried\u201d.'}
          </p>

          {compliance.path.length > 0 && (
            <div>
              <div className="label-sm mb-1.5">Fastest route — {compliance.path.length} release{compliance.path.length === 1 ? '' : 's'}</div>
              <div className="space-y-1">
                {compliance.path.map((c) => (
                  <Link
                    key={c.playerId}
                    // from=cap so the release lands back on this sheet: the
                    // panel above is a SEQUENCE of releases, and CutButton's
                    // hard-coded push to /roster made the GM navigate back
                    // here between every one of them.
                    href={`/league/${league.id}/player/${c.playerId}?view=contract&from=cap`}
                    className="flex items-center gap-3 px-3 py-1.5 rounded-md bg-raised hover:bg-line transition-colors text-sm"
                  >
                    <span className={`pill ${positionBadgeClass(c.position)}`}>{c.position}</span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-xs text-muted font-mono">{formatMoney(c.deadMoney)} dead</span>
                    <span className="font-mono text-accent font-semibold w-20 text-right">+{formatMoney(c.frees)}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {compliance.relief.some((r) => r.kind === 'RESTRUCTURE') && (
            <div>
              <div className="label-sm mb-1.5 inline-flex items-center gap-1.5">
                Or keep them — restructure candidates
                <Tooltip text={tip('restructure')} />
              </div>
              <div className="space-y-1">
                {compliance.relief.filter((r) => r.kind === 'RESTRUCTURE').map((r) => (
                  <Link
                    key={r.playerId}
                    href={`/league/${league.id}/player/${r.playerId}?view=contract&from=cap`}
                    className="flex items-center gap-3 px-3 py-1.5 rounded-md bg-raised hover:bg-line transition-colors text-sm"
                  >
                    <span className={`pill ${positionBadgeClass(r.position)}`}>{r.position}</span>
                    <span className="flex-1 truncate">{r.name}</span>
                    <span className="text-xs text-muted font-mono">{formatMoney(r.deadMoney)} dead if cut after</span>
                    <span className="font-mono text-accent font-semibold w-20 text-right">+{formatMoney(r.frees)}</span>
                  </Link>
                ))}
              </div>
              <p className="text-[11px] text-muted mt-1.5">
                A restructure buys room this year by pushing bonus into later ones — and raises the dead money you would
                owe if you cut him afterwards. Only restructure players you intend to keep.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="panel p-4">
        <div className="flex items-center justify-between mb-2 text-sm">
          <span className="label-sm">Cap Usage</span>
          <span className="text-muted">
            {formatMoney(summary.activeSalary)} active salary
            {summary.deadMoney > 0 && <span className="text-bad"> · {formatMoney(summary.deadMoney)} dead</span>}
          </span>
        </div>
        <div className="h-3 bg-raised rounded-full overflow-hidden">
          <div className={`h-full ${usedPct > 96 ? 'bg-bad' : usedPct > 85 ? 'bg-warn' : 'bg-accent'}`} style={{ width: `${usedPct}%` }} />
        </div>
      </div>

      {/* THE TOP OF THE ADVANCED TAB, which is where the app owner put it:
          *"multi year outlook as a bar graph to the top so its easy to look
          at"*. Above the tile row, above the contract-value lists, above the
          chart grid — the first thing on the tab and the only Advanced panel
          a reader meets before scrolling.
          It sits directly under the usage bar because it is that bar told
          forward in time: same three quantities, four years of them, with the
          room left over as the headline instead of the share used. */}
      {advanced && sheet && (
        <MultiYearOutlookPanel
          sheet={sheet}
          teamId={team.id}
          teamAbbr={team.abbr}
          // The club's own primary, resolved the way PageMasthead resolves it
          // (off the ABBREVIATION, not the id) so this panel and the masthead
          // above it are the same colour rather than two different greens.
          accent={generateTeamLogoParams(team.abbr).primary}
        />
      )}

      {advanced && health && (
        <MetricTiles
          metrics={[
            {
              label: 'Top-5 Concentration',
              value: `${Math.round(health.topFiveShare * 100)}%`,
              detail: 'of committed cap in 5 contracts',
              color: health.topFiveShare > 0.45 ? 'text-warn' : undefined,
              tip: tip('topFiveConcentration'),
            },
            {
              label: 'Cap-Weighted Age',
              value: health.capWeightedAge.toFixed(1),
              detail: `roster average is ${health.rosterAvgAge.toFixed(1)}`,
              color: health.capWeightedAge > health.rosterAvgAge + 2 ? 'text-warn' : undefined,
              tip: tip('capWeightedAge'),
            },
            {
              label: 'Committed Next Year',
              value: `${Math.round(health.nextYearCommittedShare * 100)}%`,
              detail: `${health.playersUnderContractNextYear} players signed beyond this season`,
              color: health.nextYearCommittedShare > 0.8 ? 'text-warn' : undefined,
              tip: "Cap dollars already owed next season as a share of NEXT year's cap (the ceiling rises every season), from contracts on the books today. High means next offseason is largely pre-spent before free agency even opens.",
            },
            {
              label: 'League Spend Rank',
              value: leagueCapUsedRank > 0 ? `#${leagueCapUsedRank}` : '—',
              detail: `${formatMoney(summary.capUsed)} committed · dead money ${Math.round(health.deadShare * 100)}% of cap`,
              tip: 'Where your committed spend ranks against all other teams — #1 is the biggest spender in the league. A raw cap number is meaningless without knowing what everyone else is doing.',
            },
          ]}
        />
      )}

      {advanced && (contractValue.bargains.length > 0 || contractValue.overpays.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-5">
          <ContractValueList
            title="Best Value Contracts"
            hint="Paying furthest under what the rating is worth."
            rows={contractValue.bargains}
            leagueId={league.id}
            positive
          />
          <ContractValueList
            title="Worst Value Contracts"
            hint="Paying furthest over. Not always a mistake — a young player's second deal often lands here."
            rows={contractValue.overpays}
            leagueId={league.id}
          />
        </div>
      )}

      {advanced && (
        <div className="grid lg:grid-cols-2 gap-5">
          <div className="panel p-4">
            <h2 className="font-semibold mb-1 inline-flex items-center gap-1.5">
              Cap Allocation by Position
              <Tooltip text="Share of your total cap spend going to each position group right now. Real front offices watch this to spot an unbalanced roster — e.g. too much of the cap tied up at one spot to build real depth elsewhere." />
            </h2>
            <p className="text-xs text-muted mb-3">Share of {formatMoney(summary.capUsed)} committed, by position group.</p>
            <HorizontalBarChart bars={allocationBars} />
          </div>

          <div className="panel p-4">
            <h2 className="font-semibold mb-1 inline-flex items-center gap-1.5">
              Spend vs. League Average
              <Tooltip text="How your cap allocation at each position group compares to the league-wide average team. Blue = spending less than average there; red = more. Neither is inherently good or bad on its own — a position running red might be a deliberate strength, or an overpay; running blue might be a bargain, or a real hole." />
            </h2>
            <p className="text-xs text-muted mb-3">Deviation from the average team's spend, by position group.</p>
            <HorizontalBarChart bars={vsLeagueBars} />
          </div>

          <div className="panel p-4 lg:col-span-2">
            <h2 className="font-semibold mb-1 inline-flex items-center gap-1.5">
              Cap Hit vs. Overall Rating
              <Tooltip text="Every player under contract, plotted by rating and cap hit. Blue = costing meaningfully less than his rating's market value (a bargain); red = costing meaningfully more (an overpay, fairly or not — a young player on a big second contract will often show red here even if the deal was reasonable when signed). Gray = within normal market range — small dollar swings around the going rate aren't worth flagging either way." />
            </h2>
            <p className="text-xs text-muted mb-3">Blue = under market value · Gray = at market · Red = over market value</p>
            <ScatterChart
              points={valuePoints}
              xLabel="Overall Rating" yLabel="Cap Hit"
              formatX="integer" formatY="money"
            />
          </div>
        </div>
      )}

      {/* THE FOOT OF THE ADVANCED TAB — *"lets move the dead money towards the
          bottom of the advanced cap tab"*. This is the panel that shipped in
          b5a91c1, restored unchanged and taking the same prop; what moved is
          where it sits and what it is now the DETAIL OF. The column chart at
          the top stacks this same money into every season and prints the
          season's total under its own column, at $0 as loudly as at $59.2M
          (both read one `capSheet`), so this is the itemisation of that
          segment rather than a second, rival account of the future — which is
          what it and the old line chart were when they sat side by side. It
          still renders nothing on a club with a clean ledger, which is why
          that X-axis line exists: there is no runway to draw, and the chart
          above says so rather than leaving a silence.
          Below the analytics grid and above the Contracts table rather than
          dead last: Contracts is the page's reference table, it closes the
          page on Basic too, and an Advanced panel after it would strand it. */}
      {advanced && sheet && (
        <DeadMoneyRunwayPanel runway={sheet.dead} leagueId={league.id} />
      )}

      <div className="panel overflow-hidden">
        <div className="px-4 py-3 border-b border-line font-semibold text-sm">Contracts</div>
        <div className="overflow-x-auto">
          <table className="table-clean">
            <thead>
              <tr>
                <th>Player</th>
                {COLUMNS.map((c) => (
                  <th key={c.key}>
                    <span className="inline-flex items-center gap-1">
                      <Link href={sortHref(c.key)} className="hover:text-chalk whitespace-nowrap">
                        {c.label}{sortKey === c.key && (dir === -1 ? ' ▾' : ' ▴')}
                      </Link>
                      {c.key === 'cap' && <Tooltip placement="bottom" text={tip('capHit')} />}
                      {c.key === 'savings' && (
                        <Tooltip placement="bottom" align="end" text={tip('capSavingsOnCut')} />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ p, hit, base, dead, savings }) => (
                <tr key={p.id}>
                  <td><Link href={`/league/${league.id}/player/${p.id}?view=contract`} className="hover:text-accent2 font-medium">{p.firstName} {p.lastName}</Link></td>
                  <td><span className={`font-semibold text-xs ${positionBadgeClass(p.position)}`}>{p.position}</span></td>
                  <td className="text-muted">{p.age}</td>
                  <td className="stat-value text-stat-sm text-muted">{p.trueOvr}</td>
                  <td className="font-mono">{formatMoney(hit)}</td>
                  <td className="font-mono text-muted">{formatMoney(base)}</td>
                  <td className="font-mono">{p.contract?.yearsRemaining ?? '—'}</td>
                  <td className="font-mono text-xs whitespace-nowrap">
                    <span className={savings >= 0 ? 'text-accent' : 'text-bad'}>{formatMoney(savings)}</span>
                    <span className="text-muted"> / </span>
                    <span className="text-bad">{formatMoney(dead)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

function ContractValueList({ title, hint, rows, leagueId, positive }: {
  title: string; hint: string; rows: SurplusRow[]; leagueId: string; positive?: boolean;
}) {
  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-line/70">
        <div className="label-sm inline-flex items-center gap-1.5">
          {title}
          {/* Panel header, so downward — nothing above it inside the card. */}
          <Tooltip placement="bottom" text={tip('marketValue')} />
        </div>
        <div className="text-xs text-muted mt-0.5">{hint}</div>
      </div>
      <div className="divide-y divide-line/60">
        {rows.map((r) => (
          <div key={r.playerId} className="px-4 py-2.5 flex items-center gap-3">
            <span className={`font-semibold text-xs w-10 shrink-0 ${positionBadgeClass(r.position)}`}>{r.position}</span>
            <Link href={`/league/${leagueId}/player/${r.playerId}?view=contract`} className="flex-1 min-w-0 hover:text-accent2">
              <div className="font-medium text-sm truncate">{r.name}</div>
              <div className="text-xs text-muted">{r.ovr} OVR · age {r.age} · {formatMoney(r.hit)} vs {formatMoney(r.marketValue)} market</div>
            </Link>
            <span className={`stat-value text-stat-sm shrink-0 ${positive ? 'text-accent' : 'text-bad'}`}>
              {positive ? '+' : '−'}{formatMoney(Math.abs(r.surplus))}
            </span>
          </div>
        ))}
        {rows.length === 0 && <div className="px-4 py-3 text-sm text-muted">Nothing qualifies yet.</div>}
      </div>
    </div>
  );
}
