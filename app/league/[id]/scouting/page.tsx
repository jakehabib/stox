import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { buildScoutedView } from '@/lib/scouting';
import { loadScoutMods } from '@/lib/dynasty';
import { readJson } from '@/lib/json';
import { ratingColor } from '@/lib/ratings';
import { LEAGUE, SHORTLIST_ATTENTION } from '@/lib/tuning';
import {
  buildConsensusBoard, ownGradeFor, disagreementNote,
  type ConsensusBias,
} from '@/lib/consensus';
import { loadAttentionPlan, unitsFor, confidenceAfterWeek } from '@/lib/shortlistAttention';
import { loadWorkoutSlots } from '@/lib/workouts';
import { imminentDraftYear } from '@/lib/draft';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { ScoutingRange } from '@/components/ds/ScoutingRange';
import { ScoutsRoom } from '@/components/ds/ScoutsRoom';
import { WorkoutButton } from '@/components/ds/WorkoutButton';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { ShortlistStar } from '@/components/ShortlistStar';
import { Tooltip } from '@/components/Tooltip';
import { tip } from '@/lib/glossary';

export const dynamic = 'force-dynamic';

/**
 * ===========================================================================
 * THE SCOUTING DEPARTMENT
 * ===========================================================================
 * This page used to be a price list. Focus points were a currency you spent
 * per player per click, which meant the game charged you to find out what the
 * entire league already knew — and the clicking, not the football, was the
 * thing you were actually doing. Both are gone.
 *
 * What is here instead is three things, in the order they cost you anything:
 *
 *   1. THE BOARD (free, public, always). Every prospect carries a grade, a
 *      rank and a band from the day the class is generated, identical for
 *      every team. Your edge is not having this. Your edge is knowing where
 *      it is WRONG — and it is wrong in five named, publicly-signalled ways,
 *      which is why every row can say which one it is.
 *
 *   2. YOUR SHORTLIST (free, ongoing, the only input). Star a prospect and
 *      your staff works him every week for the rest of the season, out of a
 *      fixed weekly pool. Star five and each gets a fifth of the department;
 *      star sixty and you learn a little about a lot. Choosing how many is
 *      the whole decision, so this section quotes the actual per-player
 *      share — the number lib/shortlistAttention.ts applies, from the same
 *      function it applies it with, never a second copy of the arithmetic.
 *
 *   3. PRIVATE WORKOUTS (five a year, pre-draft only). The one scarce,
 *      deliberate commitment left in scouting.
 * ===========================================================================
 */

const BIAS_TONE: Record<string, string> = {
  TESTING_DARLING: 'border-accent/40 text-accent',
  TESTING_FADED: 'border-warn/40 text-warn',
  BLUE_BLOOD: 'border-accent/40 text-accent',
  SMALL_SCHOOL: 'border-accent2/40 text-accent2',
  DEVELOPMENTAL_DISCOUNT: 'border-accent2/40 text-accent2',
  MEDICAL_DISCOUNT: 'border-bad/40 text-bad',
};

const BAND_TONE: Record<string, string> = {
  BLUE_CHIP: 'text-gold',
  FIRST_ROUND: 'text-accent',
  DAY_TWO: 'text-accent2',
  DAY_THREE: 'text-chalk',
  LATE_FLIER: 'text-muted',
  PRIORITY_FA: 'text-muted',
};

export default async function ScoutingPage({ params }: { params: { id: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  // The class is keyed by draftYear, not by "who is still available" — the
  // board has to rank drafted prospects too or a rank would move because
  // somebody else came off it.
  const classYearRow = await prisma.player.findFirst({
    where: { leagueId: league.id, isDraftee: true },
    orderBy: { draftYear: 'desc' },
    select: { draftYear: true },
  });
  const classYear = classYearRow?.draftYear ?? league.seasonYear;
  // Player.draftYear is stamped with the season the class was GENERATED in;
  // these men are selected in the offseason after it, so the two numbers
  // differ by one and only the pick year is the one to put on screen. The
  // draft page labels itself the same way for the same reason.
  const draftLabelYear = (await imminentDraftYear(league.id)) ?? classYear + 1;

  const [classPlayers, shortlistEntries, scoutMods, plan, slots] = await Promise.all([
    prisma.player.findMany({ where: { leagueId: league.id, draftYear: classYear } }),
    prisma.shortlistEntry.findMany({ where: { teamId: team.id }, select: { playerId: true } }),
    loadScoutMods(league.id),
    // The split a screen quotes and the split the weekly pass applies are the
    // same function on the same inputs. See lib/shortlistAttention.ts.
    loadAttentionPlan(league.id, team.id),
    loadWorkoutSlots(league.id),
  ]);

  const board = buildConsensusBoard(classPlayers, { teams: LEAGUE.TEAM_COUNT, rounds: settings.draftRounds });
  const playerById = new Map(classPlayers.map((p) => [p.id, p]));
  const shortlistIds = new Set(shortlistEntries.map((s) => s.playerId));

  const available = (id: string) => {
    const p = playerById.get(id);
    return !!p && p.teamId === null && p.isDraftee;
  };

  const shortlisted = board.filter((r) => shortlistIds.has(r.playerId) && available(r.playerId));
  const topBoard = board.filter((r) => available(r.playerId)).slice(0, 14);

  const shownIds = Array.from(new Set([...shortlisted, ...topBoard].map((r) => r.playerId)));
  const [reports, workedOut] = await Promise.all([
    prisma.scoutingReport.findMany({ where: { teamId: team.id, playerId: { in: shownIds } } }),
    prisma.scoutingReport.findMany({
      where: { teamId: team.id, workoutYear: slots.seasonYear },
      select: { playerId: true },
    }),
  ]);
  const reportMap = new Map(reports.map((r) => [r.playerId, r]));
  const workedOutIds = new Set(workedOut.map((w) => w.playerId));

  const viewFor = (playerId: string) => {
    const p = playerById.get(playerId)!;
    return buildScoutedView({
      // KEEPS ITS FOG, and is now the only room in the building that has any.
      // Fog was scoped to draft prospects (see the SCOPE block in
      // lib/scouting.ts); every player this page renders is one, by
      // construction — `classPlayers` is filtered on isDraftee — but the flag
      // is read off the record rather than hard-coded true, so the claim is
      // checkable instead of assumed.
      isProspect: p.isDraftee,
      position: p.position as any,
      trueAttrs: readJson(p.trueAttrs, {}),
      trueOvr: p.trueOvr,
      potential: p.potential,
      report: reportMap.get(p.id) ?? null,
      settings,
      isOwnRoster: false,
      isUserView: true,
      dynasty: scoutMods,
    });
  };

  // How often the room is wrong in each named way, across this whole class.
  // This is the legend for the entire system: the board's error is learnable,
  // so the frequencies are worth showing rather than hiding.
  const biasCounts = new Map<string, { label: string; count: number }>();
  for (const r of board) {
    for (const b of r.biases) {
      const cur = biasCounts.get(b.id) ?? { label: b.label, count: 0 };
      cur.count += 1;
      biasCounts.set(b.id, cur);
    }
  }
  const legend = Array.from(biasCounts.entries()).sort((a, b) => b[1].count - a[1].count);

  const classSize = board.filter((r) => available(r.playerId)).length;
  const unitsEach = plan.unitsEach;
  const leader = topBoard[0];
  const leaderPlayer = leader ? playerById.get(leader.playerId) : undefined;

  return (
    <div className="space-y-6">
      <PageMasthead
        teamId={team.id}
        teamAbbr={team.abbr}
        eyebrow="Front Office"
        title="Scouting Department"
        subtitle="The board is free and everybody has it. Your edge is knowing where it's wrong — and paying attention to the right handful of names for long enough to find out."
        facts={[
          { label: 'Class', value: String(classSize), detail: `${draftLabelYear} draft · all graded, no cost` },
          {
            label: 'Shortlisted',
            tip: tip('shortlist'),
            value: String(plan.shortlisted),
            detail: plan.shortlisted > 0 ? 'worked every week' : 'star anyone to start',
            color: plan.shortlisted > 0 ? 'text-gold' : 'text-warn',
          },
          {
            label: 'Attention Each',
            tip: tip('attentionUnits'),
            value: plan.shortlisted > 0 ? unitsEach.toFixed(1) : '—',
            detail: plan.shortlisted > 0 ? 'units per starred man, per week' : 'nothing starred',
          },
          {
            label: 'Workouts',
            tip: tip('privateWorkout'),
            value: `${slots.remaining}/${slots.max}`,
            detail: slots.open ? 'window open' : 'window closed',
            color: !slots.open ? 'text-muted' : slots.remaining === 0 ? 'text-bad' : undefined,
          },
          {
            label: 'Board Leader',
            tip: tip('boardGrade'),
            value: leaderPlayer ? `${leaderPlayer.lastName}` : '—',
            detail: leader ? `${leaderPlayer?.position} · board grade ${leader.grade}` : 'class not set',
          },
        ]}
      />

      {/* ---------------------------------------------------------------- */}
      {/* 1. THE BOARD                                                     */}
      {/* ---------------------------------------------------------------- */}
      <div className="section">
        <SectionHeading
          eyebrow="Free · public · identical for every team"
          title="The Consensus Board"
          tip={tip('consensusBoard')}
          action={
            <Link href={`/league/${league.id}/draft`} className="text-xs text-muted hover:text-chalk">
              Full class ({classSize}) →
            </Link>
          }
        />
        <div className="panel p-4">
          <p className="text-sm text-chalk/90 leading-relaxed max-w-3xl">
            Nobody pays to learn who the consensus number one is. Every front office in this league opens the year
            with the same grades, the same ranks and the same bands. What separates them is that the room is
            systematically <strong className="text-chalk">wrong</strong> — it over-trusts a stopwatch, it takes a big
            program at its word, it marks down anybody unfinished and anybody flagged. Those errors are public, they
            are named on every row below, and they are the entire game.
          </p>
          {legend.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {legend.map(([id, l]) => (
                <span key={id} className={`pill text-[11px] gap-1.5 ${BIAS_TONE[id] ?? 'border-line text-muted'}`}>
                  {l.label}<span className="font-mono opacity-70 ml-1">{l.count}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="panel divide-y divide-line/30">
          {topBoard.map((read) => {
            const p = playerById.get(read.playerId)!;
            const top: ConsensusBias | undefined = read.biases[0];
            return (
              <div key={read.playerId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" title={read.headline}>
                <div className="stat-value text-stat-sm text-muted w-8 text-right shrink-0">{read.rank}</div>
                <ShortlistStar
                  leagueId={league.id}
                  teamId={team.id}
                  playerId={p.id}
                  initial={shortlistIds.has(p.id)}
                />
                <PlayerAvatar
                  seed={p.id}
                  age={p.age}
                  size={36}
                  weightLb={p.weightLb}
                  heightIn={p.heightIn}
                  position={p.position}
                />
                <div className="min-w-0 flex-1">
                  <Link href={`/league/${league.id}/player/${p.id}`} className="text-sm font-medium hover:text-accent2">
                    {p.firstName} {p.lastName}
                  </Link>
                  <div className="text-[11px] mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span className={`font-semibold ${positionBadgeClass(p.position)}`}>{p.position}</span>
                    <span className="text-muted">{p.college}</span>
                    {read.medicalFlag && <span className="pill text-[10px] border-bad/40 text-bad">Medical flag</span>}
                    {top && (
                      <span className={`pill text-[10px] ${BIAS_TONE[top.id] ?? 'border-line text-muted'}`} title={top.because}>
                        {top.direction === 'UP' ? '▲' : '▼'} {top.label}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0 w-36">
                  <div className={`stat-value text-stat-sm ${ratingColor(read.grade)}`}>{read.grade}</div>
                  <div className={`text-[10px] leading-none mt-0.5 ${BAND_TONE[read.band] ?? 'text-muted'}`}>{read.bandLabel}</div>
                  {/* The rank above is the boardScore ordering, and boardScore
                      is this grade PLUS what the position is worth in April.
                      Without this term on the row, a 98 sitting above a 99
                      reads as a broken sort instead of as the most exploitable
                      thing on the board. */}
                  {Math.abs(read.positionPull) >= 1 && (
                    <div
                      className={`text-[10px] font-mono leading-none mt-1 ${read.positionPull > 0 ? 'text-accent' : 'text-warn'}`}
                      title={read.positionNote ?? undefined}
                    >
                      {read.positionPull > 0 ? '▲' : '▼'} {read.positionPull > 0 ? '+' : '−'}{Math.abs(read.positionPull).toFixed(1)} slot ({p.position})
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {topBoard.length === 0 && (
            <div className="px-4 py-6 text-sm text-muted">No draft class on the board yet. One is generated in week 1.</div>
          )}
        </div>
        {topBoard.length > 0 && (
          <p className="text-[11px] text-muted flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <span className="font-mono">▲ ▼ slot</span>
              — how far the position itself moves a man up or down the board
              <Tooltip text={tip('positionalValue')} />
            </span>
            <span className="inline-flex items-center gap-1">
              Board grade
              <Tooltip text={tip('boardGrade')} />
            </span>
            <span className="inline-flex items-center gap-1">
              Band
              <Tooltip text={tip('draftBand')} />
            </span>
          </p>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* 2. THE SHORTLIST                                                 */}
      {/* ---------------------------------------------------------------- */}
      <div className="section">
        <SectionHeading
          eyebrow="Free · every week · the only ongoing input"
          title="Who Your Staff Is Watching"
          tip={tip('shortlist')}
          action={
            plan.shortlisted > 0 ? (
              <span className="text-xs text-muted">
                <span className="stat-value text-stat-sm text-chalk">{unitsEach.toFixed(1)}</span> units each, per week
              </span>
            ) : undefined
          }
        />
        <p className="text-xs text-muted -mt-1 max-w-3xl leading-relaxed">
          There is nothing to spend here and nothing to click every week. Your department works whoever you star, and
          it splits one week&apos;s attention evenly between them —{' '}
          {plan.shortlisted > 0 ? (
            <>
              {plan.shortlisted} starred means <strong className="text-chalk">{unitsEach.toFixed(1)}</strong> units
              each. Star half as many and each of them gets twice this. Star sixty and you will know a little about
              sixty men and enough about none of them.
            </>
          ) : (
            <>star five and each gets a fifth of everything your staff can do; star sixty and you learn a little about a lot.</>
          )}
        </p>

        {shortlisted.length === 0 ? (
          <div className="panel p-5 text-sm text-muted">
            Nobody starred. Your staff is watching the class the way everybody else is — from the same public board.
            Star a prospect here or on the{' '}
            <Link href={`/league/${league.id}/draft`} className="text-accent2 hover:underline">draft board</Link>{' '}
            and they start working him this week, at no cost, for the rest of the season.
          </div>
        ) : (
          <div className="panel divide-y divide-line/30">
            {shortlisted.map((read) => {
              const p = playerById.get(read.playerId)!;
              const view = viewFor(p.id);
              const { units, specialtyCovered } = unitsFor(plan, p.position);
              const nextWeek = Math.round(confidenceAfterWeek(view.confidence, units));
              const atCeiling = view.confidence >= SHORTLIST_ATTENTION.CONFIDENCE_CEILING - 1;
              const note = disagreementNote(read, view);
              const gap = view.confidence >= 25 ? ownGradeFor(view) - read.grade : 0;
              return (
                <div key={p.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <ShortlistStar leagueId={league.id} teamId={team.id} playerId={p.id} initial />
                    <PlayerAvatar
                      seed={p.id}
                      age={p.age}
                      size={40}
                      weightLb={p.weightLb}
                      heightIn={p.heightIn}
                      position={p.position}
                    />
                    <div className="min-w-0 flex-1">
                      <Link href={`/league/${league.id}/player/${p.id}`} className="text-sm font-medium hover:text-accent2">
                        {p.firstName} {p.lastName}
                      </Link>
                      <div className="text-[11px] mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span className={`font-semibold ${positionBadgeClass(p.position)}`}>{p.position}</span>
                        <span className="text-muted">{p.college}</span>
                        <span className="text-muted">· board #{read.rank}</span>
                        <span className={BAND_TONE[read.band] ?? 'text-muted'}>{read.bandLabel}</span>
                      </div>
                    </div>

                    {/* Our grade against the room. This goes through
                        ownGradeFor() and nothing else: the board grade blends
                        current AND ceiling, a scouted OVR is current only, so
                        a raw subtraction would report us below the consensus
                        on every prospect in the class. */}
                    <div className="text-right shrink-0 w-24">
                      <div className="label-sm">Board</div>
                      <div className={`stat-value text-stat-sm ${ratingColor(read.grade)}`}>{read.grade}</div>
                      {view.confidence >= 25 && (
                        <div className={`text-[11px] font-mono mt-0.5 ${gap > 0 ? 'text-accent' : gap < 0 ? 'text-warn' : 'text-muted'}`}>
                          us {ownGradeFor(view)}
                        </div>
                      )}
                    </div>

                    <ScoutingRange
                      low={view.revealed ? view.scoutedOvr : view.ovrLow}
                      high={view.revealed ? view.scoutedOvr : view.ovrHigh}
                      confidence={view.confidence}
                      label="OVR"
                      className="w-28 shrink-0"
                    />
                    <ScoutingRange
                      low={view.potLow}
                      high={view.potHigh}
                      confidence={view.confidence}
                      label="Potential"
                      className="w-28 shrink-0"
                    />

                    <div className="text-right shrink-0 w-32">
                      <div className="label-sm">This week</div>
                      <div className="stat-value text-stat-sm text-chalk">{units.toFixed(1)}</div>
                      <div className="text-[10px] text-muted leading-tight mt-0.5">
                        {/* Past the ceiling the share is still spent on him and
                            still comes out of everybody else's — which is the
                            argument for taking the star off, so say it. */}
                        {atCeiling
                          ? <span className="text-warn">as far as watching gets</span>
                          : <>{Math.round(view.confidence)}% → {nextWeek}%</>}
                        {specialtyCovered && <span className="text-accent2"> · specialist</span>}
                      </div>
                    </div>
                  </div>
                  {note && <p className="text-[11px] text-muted mt-2 pl-[4.5rem] max-w-3xl leading-relaxed">{note}</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* 3. PRIVATE WORKOUTS                                              */}
      {/* ---------------------------------------------------------------- */}
      <div className="section">
        <SectionHeading
          eyebrow="Scarce · pre-draft only"
          title="Private Workouts"
          tip={tip('privateWorkout')}
          action={
            <span className="text-xs">
              <span className={`stat-value text-stat-sm ${slots.remaining === 0 ? 'text-bad' : 'text-chalk'}`}>{slots.remaining}</span>
              <span className="text-muted"> of {slots.max} left this year</span>
            </span>
          }
        />
        <div className={`panel p-4 border-l-2 ${slots.open ? 'border-l-gold' : 'border-l-line'}`}>
          <div className={`text-sm ${slots.open ? 'text-chalk' : 'text-muted'}`}>{slots.windowLabel}</div>
          <p className="text-xs text-muted mt-2 max-w-3xl leading-relaxed">
            A workout is the only thing in scouting you can run out of. He flies in, your people run their own
            testing, and every measurable comes back exact with the ceiling projection tightened to about as narrow
            as it gets. It will not tell you how he reads a defense — that is the read that busts picks, and one day
            in a facility cannot settle it.
          </p>
        </div>

        {shortlisted.length === 0 ? (
          <div className="panel p-4 text-sm text-muted">
            Star the men you are considering first. A workout is the last question you ask about a prospect, not the
            first.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {shortlisted.slice(0, 9).map((read) => {
              const p = playerById.get(read.playerId)!;
              const view = viewFor(p.id);
              const avatar = (
                <PlayerAvatar
                  seed={p.id}
                  age={p.age}
                  size={40}
                  weightLb={p.weightLb}
                  heightIn={p.heightIn}
                  position={p.position}
                />
              );
              return (
                <div key={p.id} className="panel p-4">
                  <div className="flex items-center gap-3">
                    {avatar}
                    <div className="min-w-0 flex-1">
                      <Link href={`/league/${league.id}/player/${p.id}`} className="text-sm font-medium hover:text-accent2 truncate block">
                        {p.firstName} {p.lastName}
                      </Link>
                      <div className="text-[11px] flex items-center gap-1.5">
                        <span className={`font-semibold ${positionBadgeClass(p.position)}`}>{p.position}</span>
                        <span className="text-muted">board #{read.rank}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-end justify-between gap-3 mt-3">
                    <div>
                      <div className="label-sm">Ceiling</div>
                      <div className="stat-value text-stat-sm text-chalk">{view.potLow}–{view.potHigh}</div>
                    </div>
                    <WorkoutButton
                      leagueId={league.id}
                      teamId={team.id}
                      playerId={p.id}
                      name={`${p.firstName} ${p.lastName}`}
                      meta={`${p.position} · ${p.college} · board #${read.rank}`}
                      avatar={avatar}
                      remaining={slots.remaining}
                      max={slots.max}
                      open={slots.open}
                      windowLabel={slots.windowLabel}
                      done={workedOutIds.has(p.id)}
                      potLow={view.potLow}
                      potHigh={view.potHigh}
                      confidence={view.confidence}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ScoutsRoom
        quote={
          plan.shortlisted === 0
            ? 'Everybody in this league is looking at the same board we are. If we want to be right about somebody the room is wrong about, you have to tell me which names to live on.'
            : plan.shortlisted > 25
              ? `We're on ${plan.shortlisted} men. I can tell you something about all of them and everything about none of them — that's the trade you made.`
              : `We're living on ${plan.shortlisted} names. That's tight enough that by spring I'll have a real file on every one of them.`
        }
        attribution="Director of College Scouting"
      />
    </div>
  );
}
