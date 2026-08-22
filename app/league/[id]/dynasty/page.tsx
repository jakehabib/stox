import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { readJson } from '@/lib/json';
import { buildScoutedView } from '@/lib/scouting';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { DynastySkillCard } from '@/components/DynastySkillCard';
import { FullScoutPanel } from '@/components/FullScoutPanel';
import { positionBadgeClass } from '@/components/ds/positionColor';
import {
import { Tooltip } from '@/components/Tooltip';
import { tip } from '@/lib/glossary';
  BRANCH_BLURB, BRANCH_LABEL, DYNASTY, DYNASTY_SKILLS, buildDynastyState,
  flagBreakouts, projectDevelopment, rankOf, readAging, scoutingModsFor,
  type DynastyBranch,
} from '@/lib/dynasty';

/**
 * THE DYNASTY SCREEN.
 *
 * Three columns, one row per upgrade. Not a branching RPG tree — there are no
 * prerequisites in this system, so there is nothing for connector lines to
 * describe. It uses the same furniture as every other front-office screen
 * (PageMasthead, .panel, .label-sm, .stat-value) precisely so it reads as
 * part of the same product rather than a bolted-on meta-game.
 *
 * The Front Office Intel block below the tree is where the DEVELOPMENT branch
 * actually pays out: those three skills are roster-wide reads rather than
 * per-player modifiers, so a list is their natural home.
 */
export default async function DynastyPage({ params }: { params: { id: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;
  const state = await buildDynastyState(league.id);
  const mods = scoutingModsFor(state.skills);

  const xpLabel = (n: number) => n.toLocaleString();
  const nextLevelXp = state.level.atMax ? null : state.level.xpForThisLevel - state.level.xpIntoLevel;

  // ---- Front Office Intel (the Development branch, in action) -------------
  const wantsIntel =
    rankOf(state.skills, 'DEV_INSIGHT') > 0 ||
    rankOf(state.skills, 'AGING_INSIGHT') > 0 ||
    rankOf(state.skills, 'BREAKOUT_WATCH') > 0;

  const roster = wantsIntel
    ? await prisma.player.findMany({
        where: { teamId: team.id, status: { in: ['ACTIVE', 'INJURED'] } },
        orderBy: { trueOvr: 'desc' },
      })
    : [];
  const reports = roster.length
    ? await prisma.scoutingReport.findMany({ where: { teamId: team.id, playerId: { in: roster.map((p) => p.id) } } })
    : [];
  const reportById = new Map(reports.map((r) => [r.playerId, r]));

  const scouted = roster.map((p) => {
    const report = reportById.get(p.id);
    const view = buildScoutedView({
      position: p.position as never,
      trueAttrs: readJson(p.trueAttrs, {}),
      trueOvr: p.trueOvr,
      potential: p.potential,
      report,
      settings,
      isOwnRoster: true,
      isUserView: true,
      dynasty: mods,
    });
    // The projection is fed the SCOUTED rating and only a REVEALED dev trait —
    // a Development skill must never launder the true numbers into view.
    const devTraitKnown = view.revealed || report?.devRevealed ? p.devTrait : null;
    return { p, view, devTraitKnown };
  });

  const breakouts = flagBreakouts({
    skills: state.skills,
    leagueId: league.id,
    seasonYear: league.seasonYear,
    roster: scouted.map((s) => ({
      id: s.p.id,
      name: `${s.p.firstName} ${s.p.lastName}`,
      position: s.p.position,
      age: s.p.age,
      scoutedOvr: s.view.scoutedOvr,
      potHigh: s.view.potHigh,
      devTraitRevealed: s.devTraitKnown,
    })),
  });

  const projections = rankOf(state.skills, 'DEV_INSIGHT') > 0
    ? scouted
        .filter((s) => s.p.age <= 27)
        .slice(0, 8)
        .map((s) => ({
          ...s,
          proj: projectDevelopment({
            skills: state.skills,
            seed: `${league.id}:${s.p.id}:${league.seasonYear}`,
            scoutedOvr: s.view.scoutedOvr,
            age: s.p.age,
            position: s.p.position,
            devTrait: s.devTraitKnown ?? 'Normal',
            potentialCeiling: s.view.potHigh,
          }),
        }))
        .filter((s) => s.proj)
    : [];

  const agingReads = rankOf(state.skills, 'AGING_INSIGHT') > 0
    ? scouted
        .filter((s) => s.p.age >= 26)
        .slice(0, 8)
        .map((s) => ({
          ...s,
          aging: readAging({
            skills: state.skills,
            seed: `${league.id}:${s.p.id}`,
            age: s.p.age,
            position: s.p.position,
            devTrait: s.devTraitKnown ?? 'Normal',
          }),
        }))
        .filter((s) => s.aging)
    : [];

  const branches: DynastyBranch[] = ['SCOUTING', 'NEGOTIATION', 'DEVELOPMENT'];

  return (
    <div className="space-y-5">
      <PageMasthead
        teamId={team.id}
        teamAbbr={team.abbr}
        eyebrow="GM Progression"
        title="Dynasty"
        subtitle={
          <>
            Your record as a general manager, turned into a career track. XP comes from what the franchise actually
            achieves — wins, playoff runs, titles, awards, picks that hit — never from repeating an action. Skill points
            buy information and tools; they never make your players better.
          </>
        }
        facts={[
          { label: 'Dynasty Level', tip: tip('gmLevel'), value: String(state.level.level), detail: state.level.atMax ? 'Maximum level' : `Level ${state.level.level + 1} at ${xpLabel(state.level.xpForThisLevel - state.level.xpIntoLevel)} more XP` },
          { label: 'Total XP', tip: tip('gmXp'), value: xpLabel(state.level.xp), detail: `Since ${state.tenureStartYear}` },
          { label: 'Skill Points', tip: tip('skillPoints'), value: String(state.pointsAvailable), detail: `${state.pointsSpent} spent · ${state.pointsEarned} earned`, color: state.pointsAvailable > 0 ? 'text-accent' : undefined },
          { label: 'Record', value: `${state.breakdown.wins}-${state.breakdown.losses}`, detail: `${state.breakdown.seasons} completed season${state.breakdown.seasons === 1 ? '' : 's'}` },
          { label: 'Next Point', value: state.nextPointAtLevel ? `Lv ${state.nextPointAtLevel}` : '—', detail: state.nextPointAtLevel ? `${state.nextPointAtLevel - state.level.level} level${state.nextPointAtLevel - state.level.level === 1 ? '' : 's'} away` : 'Ladder complete' },
        ]}
      />

      {/* XP progress ------------------------------------------------------ */}
      <div className="panel p-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="label-sm">Level {state.level.level} Progress</div>
          <div className="text-xs text-muted">
            {state.level.atMax
              ? 'Maximum Dynasty Level reached.'
              : <>
                  <span className="stat-value text-chalk">{xpLabel(state.level.xpIntoLevel)}</span>
                  {' '}/ {xpLabel(state.level.xpForThisLevel)} XP toward level {state.level.level + 1}
                  {nextLevelXp !== null && <> · {xpLabel(nextLevelXp)} to go</>}
                </>}
          </div>
        </div>
        <div className="h-2.5 rounded-full bg-raised overflow-hidden mt-2">
          <div className="h-full rounded-full bg-accent/80 transition-[width]" style={{ width: `${Math.round(state.level.progress * 100)}%` }} />
        </div>
        {state.pointsAvailable > 0 && (
          <div className="text-xs text-accent mt-2">
            You have {state.pointsAvailable} unspent skill point{state.pointsAvailable === 1 ? '' : 's'}.
          </div>
        )}
      </div>

      {/* The tree --------------------------------------------------------- */}
      <div className="grid lg:grid-cols-3 gap-5">
        {branches.map((branch) => (
          <div key={branch} className="section">
            <SectionHeading eyebrow="Branch" title={BRANCH_LABEL[branch]} tip={tip('skillTree')} />
            <p className="text-xs text-muted -mt-1">{BRANCH_BLURB[branch]}</p>
            <div className="space-y-2.5">
              {DYNASTY_SKILLS.filter((s) => s.branch === branch).map((def) => (
                <DynastySkillCard
                  key={def.id}
                  leagueId={league.id}
                  def={def}
                  rank={rankOf(state.skills, def.id)}
                  pointsAvailable={state.pointsAvailable}
                  limitedUse={
                    def.id === 'SCOUTING_NETWORK'
                      ? { max: state.fullScout.max, remaining: state.fullScout.remaining, label: 'Full Scouts', alwaysShow: true }
                      : def.id === 'INSIDER'
                        ? { max: state.insider.max, remaining: state.insider.remaining, label: 'Insider calls' }
                        : undefined
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Full Scout -------------------------------------------------------- */}
      <div className="section">
        <SectionHeading eyebrow="Baseline ability" title="Perfect Evaluations" />
        <FullScoutPanel leagueId={league.id} teamId={team.id} />
      </div>

      {/* Front Office Intel ----------------------------------------------- */}
      <div className="section">
        <SectionHeading eyebrow="Development branch" title="Front Office Intel" />
        {!wantsIntel ? (
          <div className="panel p-4 text-sm text-muted">
            Nothing to report. Buy an upgrade in the Development branch and your staff&apos;s forward-looking work on the
            roster shows up here.
          </div>
        ) : (
          <div className="grid md:grid-cols-3 gap-4">
            <div className="panel p-3.5">
              <div className="label-sm mb-2.5">Breakout Watch</div>
              {rankOf(state.skills, 'BREAKOUT_WATCH') === 0 ? (
                <div className="text-xs text-muted">Locked.</div>
              ) : breakouts.length === 0 ? (
                <div className="text-xs text-muted">Nobody young on the roster is standing out to the staff right now.</div>
              ) : (
                <ul className="space-y-2">
                  {breakouts.map((b) => (
                    <li key={b.playerId} className="flex items-start gap-2">
                      <span className={`pill shrink-0 ${positionBadgeClass(b.position)}`}>{b.position}</span>
                      <div className="min-w-0">
                        <Link href={`/league/${league.id}/player/${b.playerId}`} className="text-sm hover:text-accent2">{b.name}</Link>
                        <div className="text-[11px] text-muted">age {b.age} · {b.note}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="panel p-3.5">
              <div className="label-sm mb-2.5 inline-flex items-center gap-1.5">
                {DYNASTY.DEV_PROJECTION_YEARS}-Year Projections
                <Tooltip text={tip('devTrait')} />
              </div>
              {rankOf(state.skills, 'DEV_INSIGHT') === 0 ? (
                <div className="text-xs text-muted">Locked.</div>
              ) : projections.length === 0 ? (
                <div className="text-xs text-muted">No young players on the roster to project.</div>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {projections.map((s) => (
                      <tr key={s.p.id} className="border-b border-line/40 last:border-0">
                        <td className="py-1.5 pr-2">
                          <span className="text-muted text-xs font-mono">{s.p.position}</span>{' '}
                          <Link href={`/league/${league.id}/player/${s.p.id}`} className="hover:text-accent2">
                            {s.p.firstName} {s.p.lastName}
                          </Link>
                        </td>
                        <td className="py-1.5 text-right text-muted text-xs whitespace-nowrap">
                          {s.view.ovrLow}–{s.view.ovrHigh} now
                        </td>
                        <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                          <span className="stat-value text-stat-sm">{s.proj!.low}–{s.proj!.high}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="panel p-3.5">
              <div className="label-sm mb-2.5">Aging Curve Read</div>
              {rankOf(state.skills, 'AGING_INSIGHT') === 0 ? (
                <div className="text-xs text-muted">Locked.</div>
              ) : agingReads.length === 0 ? (
                <div className="text-xs text-muted">No veterans on the roster to read.</div>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {agingReads.map((s) => (
                      <tr key={s.p.id} className="border-b border-line/40 last:border-0">
                        <td className="py-1.5 pr-2">
                          <span className="text-muted text-xs font-mono">{s.p.position}</span>{' '}
                          <Link href={`/league/${league.id}/player/${s.p.id}`} className="hover:text-accent2">
                            {s.p.firstName} {s.p.lastName}
                          </Link>
                          <span className="text-xs text-muted"> · {s.p.age}</span>
                        </td>
                        <td className="py-1.5 text-right whitespace-nowrap">
                          <span className={`text-xs ${s.p.age >= s.aging!.centerAge ? 'text-warn' : 'text-muted'}`}>
                            {s.p.age >= s.aging!.highAge ? 'declining' : s.p.age >= s.aging!.lowAge ? 'at the edge' : `slides ~${s.aging!.lowAge}–${s.aging!.highAge}`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      {/* XP ledger --------------------------------------------------------- */}
      <div className="section">
        <SectionHeading eyebrow="Where it came from" title="XP Ledger" />
        <div className="panel overflow-hidden">
          {state.breakdown.lines.length === 0 ? (
            <div className="p-4 text-sm text-muted">
              No XP yet. You took the job in {state.tenureStartYear} — win some games and this fills up. Franchise
              history from before you were hired does not count toward your career.
            </div>
          ) : (
            <table className="table-clean">
              <thead>
                <tr><th>Source</th><th>Detail</th><th className="text-right">XP</th></tr>
              </thead>
              <tbody>
                {state.breakdown.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="font-medium">{l.label}</td>
                    <td className="text-muted text-xs">{l.detail}</td>
                    <td className="text-right stat-value">{xpLabel(l.xp)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="font-semibold" colSpan={2}>Total</td>
                  <td className="text-right stat-value text-stat-sm">{xpLabel(state.breakdown.total)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-muted">
          XP is recomputed from franchise history every time this page loads — there is no ledger to farm and nothing to
          lose. Only your spent skill points and your remaining limited-use charges are stored.
        </p>
      </div>
    </div>
  );
}
