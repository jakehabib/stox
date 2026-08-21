import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { buildScoutedView } from '@/lib/scouting';
import { loadScoutMods } from '@/lib/dynasty';
import { syncScoutingBudget, scoutCost, periodKey, weeklyScoutingBudget } from '@/lib/scoutingEconomy';
import { SCOUT_TIERS, SCOUT_ECONOMY, LEAGUE, PROGRESSION, type ScoutTierKey } from '@/lib/tuning';
import { readJson } from '@/lib/json';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { ScoutingRange } from '@/components/ds/ScoutingRange';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { ScoutSpendRow, type SpendOption } from '@/components/ScoutSpendRow';

export const dynamic = 'force-dynamic';

const SHORT: Record<ScoutTierKey, string> = { LOOK: 'Look', EVAL: 'Eval', DEEP: 'Deep', DEVELOP: 'Focus' };
const SCOUT_TIER_KEYS: ScoutTierKey[] = ['LOOK', 'EVAL', 'DEEP'];

type ReportRow = {
  confidence: number; observed: string; notes: string; passes: number;
  periodPasses: number; lastWeek: number; potConfidence: number;
  attrsRevealed: string; devRevealed: boolean;
};

/**
 * The Scouting Department — the one screen where the focus economy is the
 * subject rather than a side effect. It exists because the interesting part
 * of a scarce budget is the ALLOCATION: the same pool feeds the draft class,
 * the free-agent board and your own roster's development, and this page puts
 * all three lanes next to each other with their prices showing.
 */
export default async function ScoutingPage({ params }: { params: { id: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  const budget = await syncScoutingBudget(team.id, league, settings);
  // Scouting-branch skill ranks narrow every band this page renders.
  const scoutMods = await loadScoutMods(league.id);
  const period = periodKey(league);

  const [prospects, freeAgents, roster, scouts] = await Promise.all([
    prisma.player.findMany({
      where: { leagueId: league.id, teamId: null, status: 'FREE_AGENT', isDraftee: true },
      orderBy: { trueOvr: 'desc' }, take: 60,
    }),
    prisma.player.findMany({
      where: { leagueId: league.id, teamId: null, status: 'FREE_AGENT', isDraftee: false },
      orderBy: { trueOvr: 'desc' }, take: 12,
    }),
    prisma.player.findMany({
      where: { teamId: team.id, status: { in: ['ACTIVE', 'INJURED'] } },
      orderBy: { potential: 'desc' }, take: 40,
    }),
    prisma.scout.findMany({ where: { teamId: team.id } }),
  ]);

  const classSize = await prisma.player.count({
    where: { leagueId: league.id, teamId: null, status: 'FREE_AGENT', isDraftee: true },
  });

  const shown = [...prospects, ...freeAgents, ...roster];
  const reports = await prisma.scoutingReport.findMany({
    where: { teamId: team.id, playerId: { in: shown.map((p) => p.id) } },
  });
  const reportMap = new Map(reports.map((r) => [r.playerId, r as unknown as ReportRow]));

  /**
   * Depth of the deepest pass already run on this player, as a rank in the
   * LOOK < EVAL < DEEP ordering. Nothing on ScoutingReport records the tier
   * directly, but each tier writes fields the shallower ones never do:
   * only DEEP closes any of the potential gap or surfaces the dev trait,
   * and only EVAL and above lock attributes. That is enough to infer it
   * without a schema change (the schema is being edited elsewhere right now).
   */
  const depthAlreadyBought = (r: ReportRow | undefined): number => {
    if (!r) return 0;
    if (r.devRevealed || r.potConfidence > 0) return 3;      // DEEP
    if (readJson<string[]>(r.attrsRevealed, []).length >= 2) return 2; // EVAL
    return r.passes > 0 ? 1 : 0;                             // LOOK
  };
  const TIER_DEPTH: Record<ScoutTierKey, number> = { LOOK: 1, EVAL: 2, DEEP: 3, DEVELOP: 3 };

  const buildOptions = (playerId: string, tiers: ScoutTierKey[]): SpendOption[] => {
    const r = reportMap.get(playerId);
    const passes = r?.passes ?? 0;
    const periodPasses = r && r.lastWeek === period ? r.periodPasses : 0;
    const atCap = periodPasses >= SCOUT_ECONOMY.MAX_PASSES_PER_PERIOD;
    const bought = depthAlreadyBought(r);
    return tiers.map((tier) => {
      const cost = scoutCost(tier, passes);
      // A shallower pass after a deeper one buys nothing you do not already
      // have — a Deep Dive subsumes an Area Look — so offering it is inviting
      // the user to waste focus. Blocked one way only: after a cheap look you
      // can still upgrade, which is the whole point of starting cheap.
      const redundant = TIER_DEPTH[tier] <= bought;
      const blocked = redundant
        ? `Already covered by a deeper report — this would tell you nothing new.`
        : atCap
          ? `Staff has already worked him ${periodPasses}x this period.`
          : budget.points < cost ? `Costs ${cost} — ${budget.points} left this period.` : null;
      return { tier, label: SCOUT_TIERS[tier].label, short: SHORT[tier], cost, blocked };
    });
  };

  const viewFor = (p: (typeof shown)[number], isOwnRoster: boolean) => buildScoutedView({
    position: p.position as any,
    trueAttrs: readJson(p.trueAttrs, {}),
    trueOvr: p.trueOvr,
    potential: p.potential,
    report: reportMap.get(p.id) ?? null,
    settings,
    isOwnRoster,
    isUserView: true,
    dynasty: scoutMods,
  });

  // Triage view of the class: the prospects you know least about, biggest
  // first. A 400-deep class against a ~one-week-per-look budget means most of
  // this list will never be touched, which is the point.
  const prospectRows = prospects
    .map((p) => ({ p, view: viewFor(p, false), r: reportMap.get(p.id) }))
    .sort((a, b) => (a.view.confidence - b.view.confidence) || (b.p.trueOvr - a.p.trueOvr))
    .slice(0, 12);

  const faRows = freeAgents.map((p) => ({ p, view: viewFor(p, false), r: reportMap.get(p.id) })).slice(0, 8);

  // Development candidates: your own young high-ceiling players, the ones a
  // coaching-hours spend actually moves.
  const devRows = roster
    .filter((p) => p.age <= 26)
    .sort((a, b) => (b.potential - b.trueOvr) - (a.potential - a.trueOvr))
    .slice(0, 8)
    .map((p) => ({ p, view: viewFor(p, true), r: reportMap.get(p.id) }));

  const perWeek = weeklyScoutingBudget(scouts, settings);
  const preDraftGrant = Math.round(perWeek * (SCOUT_ECONOMY.PHASE_GRANT_MULT.DRAFT ?? 1));
  const seasonEstimate = perWeek * LEAGUE.REGULAR_SEASON_WEEKS + preDraftGrant;
  const fullClassDeepDive = classSize * SCOUT_TIERS.DEEP.cost;
  const usedPct = budget.grant > 0 ? Math.min(100, Math.round((budget.points / budget.grant) * 100)) : 0;

  return (
    <div className="space-y-6">
      <PageMasthead
        teamId={team.id}
        teamAbbr={team.abbr}
        eyebrow="Front Office"
        title="Scouting Department"
        subtitle="One pool of focus feeds the draft class, the free-agent board and your own players' development. Spend it where it changes a decision."
        facts={[
          { label: 'Focus Left', value: String(budget.points), detail: `of ${budget.grant} this period`, color: budget.points === 0 ? 'text-bad' : undefined },
          { label: 'Period', value: budget.periodLabel, detail: budget.replenishLabel },
          { label: 'Staff Output', value: `${perWeek}/wk`, detail: `${scouts.length} scout${scouts.length === 1 ? '' : 's'} on payroll` },
          { label: 'Spent This Year', value: String(budget.spentSeason), detail: `≈${seasonEstimate} available per league year` },
          { label: 'Class Size', value: String(classSize), detail: `${fullClassDeepDive.toLocaleString()} focus to deep-dive all of them` },
        ]}
      />

      <div className="panel p-5">
        <div className="flex items-baseline justify-between gap-4">
          <div className="label-sm">Focus remaining · {budget.periodLabel}</div>
          <div>
            <span className={`stat-value text-stat-lg ${budget.points === 0 ? 'text-bad' : 'text-chalk'}`}>{budget.points}</span>
            <span className="text-sm text-muted"> / {budget.grant}</span>
          </div>
        </div>
        <div className="h-2 rounded-full bg-raised overflow-hidden mt-2">
          <div className={`h-full rounded-full ${budget.points === 0 ? 'bg-bad/70' : 'bg-accent2/70'}`} style={{ width: `${usedPct}%` }} />
        </div>
        <p className="text-xs text-muted mt-3 max-w-3xl leading-relaxed">
          {budget.replenishLabel}. Up to <strong className="text-chalk">{budget.carryCap}</strong> unspent focus carries into the
          next period — anything above that is lost, so a hoarded balance is wasted focus. The pre-draft window pays one lump of
          roughly <strong className="text-chalk">{preDraftGrant}</strong> instead of a weekly stipend.
        </p>
      </div>

      <div className="section">
        <SectionHeading eyebrow="Price list" title="What a pass costs" action={<span className="text-xs text-muted">Repeat passes on one player cost +{Math.round(SCOUT_ECONOMY.REPEAT_COST_STEP * 100)}% each and reveal {Math.round((1 - SCOUT_ECONOMY.REPEAT_REVEAL_DECAY) * 100)}% less</span>} />
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-line/60">
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Cost</th>
                <th className="px-4 py-2 font-medium">What it buys</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(SCOUT_TIERS) as ScoutTierKey[]).map((t) => (
                <tr key={t} className="border-b border-line/30 last:border-0">
                  <td className="px-4 py-2.5 font-medium whitespace-nowrap">{SCOUT_TIERS[t].label}</td>
                  <td className="px-4 py-2.5 stat-value text-stat-sm whitespace-nowrap">{SCOUT_TIERS[t].cost}</td>
                  <td className="px-4 py-2.5 text-muted">{SCOUT_TIERS[t].blurb}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Lane
        eyebrow="Lane 1 · The class"
        title="Draft board triage"
        note={`${classSize} prospects, sorted by how little you know. One Area Look on every one of them would cost ${(classSize * SCOUT_TIERS.LOOK.cost).toLocaleString()} focus.`}
        leagueId={league.id}
        teamId={team.id}
        rows={prospectRows.map(({ p, view, r }) => ({
          id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position,
          meta: `${p.college} · age ${p.age}`, view, passes: r?.passes ?? 0,
          options: buildOptions(p.id, SCOUT_TIER_KEYS),
        }))}
      />

      <Lane
        eyebrow="Lane 2 · The market"
        title="Free agents on the board"
        note="Every point spent here is a point not spent on the class. Veterans start with tape on them, so they cost less to move."
        leagueId={league.id}
        teamId={team.id}
        rows={faRows.map(({ p, view, r }) => ({
          id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position,
          meta: `age ${p.age} · ${p.experience} yr${p.experience === 1 ? '' : 's'}`, view, passes: r?.passes ?? 0,
          options: buildOptions(p.id, SCOUT_TIER_KEYS),
        }))}
      />

      <Lane
        eyebrow="Lane 3 · Your building"
        title="Development focus"
        note={`Coaching hours on your own young players. A charge multiplies that player's next development checkpoint by ${PROGRESSION.DEV_FOCUS_GROWTH_MULT}x and reads his hidden growth curve.`}
        leagueId={league.id}
        teamId={team.id}
        emptyNote="No players 26 or under on the roster to develop."
        rows={devRows.map(({ p, view, r }) => ({
          id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position,
          meta: `age ${p.age} · ${p.devFocus > 0 ? `${p.devFocus} focus charge${p.devFocus === 1 ? '' : 's'} pending` : 'no charge pending'}`,
          view, passes: r?.passes ?? 0,
          options: buildOptions(p.id, ['DEVELOP']),
        }))}
      />
    </div>
  );
}

function Lane({ eyebrow, title, note, rows, leagueId, teamId, emptyNote }: {
  eyebrow: string; title: string; note: string; leagueId: string; teamId: string;
  emptyNote?: string;
  rows: {
    id: string; name: string; position: string; meta: string; passes: number;
    view: { ovrLow: number; ovrHigh: number; potLow: number; potHigh: number; confidence: number; revealed: boolean; scoutedOvr: number };
    options: SpendOption[];
  }[];
}) {
  return (
    <div className="section">
      <SectionHeading eyebrow={eyebrow} title={title} />
      <p className="text-xs text-muted -mt-1 mb-3 max-w-3xl">{note}</p>
      {rows.length === 0 ? (
        <div className="panel p-4 text-sm text-muted">{emptyNote ?? 'Nothing here right now.'}</div>
      ) : (
        <div className="panel divide-y divide-line/30">
          {rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <span className={`pill shrink-0 ${positionBadgeClass(row.position)}`}>{row.position}</span>
              <div className="min-w-0 flex-1">
                <Link href={`/league/${leagueId}/player/${row.id}`} className="text-sm font-medium hover:text-accent2">
                  {row.name}
                </Link>
                <div className="text-[11px] text-muted">
                  {row.meta}{row.passes > 0 && ` · ${row.passes} pass${row.passes === 1 ? '' : 'es'} on file`}
                </div>
              </div>
              <ScoutingRange
                low={row.view.revealed ? row.view.scoutedOvr : row.view.ovrLow}
                high={row.view.revealed ? row.view.scoutedOvr : row.view.ovrHigh}
                confidence={row.view.confidence}
                label="OVR"
                className="w-28 shrink-0"
              />
              <ScoutingRange
                low={row.view.potLow}
                high={row.view.potHigh}
                confidence={row.view.confidence}
                label="Potential"
                className="w-28 shrink-0"
              />
              <div className="shrink-0">
                <ScoutSpendRow leagueId={leagueId} teamId={teamId} playerId={row.id} options={row.options} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
