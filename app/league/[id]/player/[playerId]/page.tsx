import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { readJson } from '@/lib/json';
import { buildScoutedView } from '@/lib/scouting';
import { loadScoutMods } from '@/lib/dynasty';
import { ratingColor, playerLabel } from '@/lib/ratings';
import { rankProspectCombine, ordinal, CombineMeasurable } from '@/lib/combineRank';
import { formatMoney, capHit, remainingValue, marketValue, deadMoneyOnCut } from '@/lib/cap';
import { classifyContractValue } from '@/lib/analytics';
import { generateScoutingReport } from '@/lib/scoutingProse';
import { teamCapSummary } from '@/lib/cap-summary';
import { sortStatEntries, statLabel } from '@/lib/statLabels';
import { CutButton } from '@/components/CutButton';
import { ContractActions } from '@/components/ContractActions';
import { FullScoutButton } from '@/components/FullScoutButton';
import { ShortlistStar } from '@/components/ShortlistStar';
import { WorkoutButton } from '@/components/ds/WorkoutButton';
import { SignOfferForm } from '@/components/SignOfferForm';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { TeamLogo } from '@/components/TeamLogo';
import { ScoutingRange } from '@/components/ds/ScoutingRange';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { StatNumber } from '@/components/ds/StatNumber';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { loadWorkoutSlots } from '@/lib/workouts';
import {
  CollegeProfile, CombineTesting, aggregateCollegeGames, collegeWeeksElapsed,
  prospectBuzzNote, COLLEGE_WEEKS,
} from '@/lib/gen/prospectProfile';
import { CollegeStatLine } from '@/components/CollegeStatLine';
import { CareerHonors, HonorAward } from '@/components/ds/CareerHonors';
import { ringYearsFor } from '@/lib/gen/leagueHistory';

/** Transaction types lib/season.ts writes one of per award, per season. */
const AWARD_LABEL: Record<string, string> = {
  AWARD_MVP: 'MVP', AWARD_OPOY: 'Offensive Player of the Year', AWARD_DPOY: 'Defensive Player of the Year',
  AWARD_ROTY: 'Rookie of the Year', AWARD_SBMVP: 'Championship MVP',
};

/**
 * The two-to-four numbers that define a career at each position — the full
 * breakdown still lives in the Career Stats panel further down; this is the
 * line a broadcast graphic would show.
 */
const CAREER_HEADLINE: Record<string, [string, string][]> = {
  QB: [['passYds', 'Pass Yds'], ['passTd', 'Pass TD'], ['int', 'INT'], ['gp', 'Games']],
  RB: [['rushYds', 'Rush Yds'], ['rushTd', 'Rush TD'], ['rec', 'Receptions'], ['gp', 'Games']],
  WR: [['recYds', 'Rec Yds'], ['rec', 'Receptions'], ['recTd', 'Rec TD'], ['gp', 'Games']],
  TE: [['recYds', 'Rec Yds'], ['rec', 'Receptions'], ['recTd', 'Rec TD'], ['gp', 'Games']],
  EDGE: [['sacks', 'Sacks'], ['tackles', 'Tackles'], ['ff', 'Forced Fum'], ['gp', 'Games']],
  DT: [['sacks', 'Sacks'], ['tackles', 'Tackles'], ['ff', 'Forced Fum'], ['gp', 'Games']],
  LB: [['tackles', 'Tackles'], ['ff', 'Forced Fum'], ['gp', 'Games']],
  CB: [['defInt', 'INT'], ['pd', 'Pass Def'], ['tackles', 'Tackles'], ['gp', 'Games']],
  S: [['tackles', 'Tackles'], ['defInt', 'INT'], ['pd', 'Pass Def'], ['gp', 'Games']],
  K: [['fgm', 'FG Made'], ['fga', 'FG Att'], ['xpm', 'XP Made'], ['gp', 'Games']],
  P: [['punts', 'Punts'], ['puntYds', 'Punt Yds'], ['gp', 'Games']],
};

export default async function PlayerPage({ params }: { params: { id: string; playerId: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const player = await prisma.player.findUnique({ where: { id: params.playerId }, include: { contract: true, team: true } });
  if (!player || player.leagueId !== league.id) notFound();

  const report = userTeam
    ? await prisma.scoutingReport.findUnique({ where: { playerId_teamId: { playerId: player.id, teamId: userTeam.id } } })
    : null;

  const isOwnRoster = player.teamId === userTeam?.id;
  // Scouting-branch skills narrow the bands this view reports. Without this the
  // GM buys a rank and sees no change on the one screen the rank is about.
  const scoutMods = await loadScoutMods(league.id);
  const view = buildScoutedView({
    position: player.position as any, trueAttrs: readJson(player.trueAttrs, {}), trueOvr: player.trueOvr, potential: player.potential,
    report, settings, isOwnRoster, isUserView: true, dynasty: scoutMods,
  });

  // Scouting a prospect is no longer something you buy per click. The two
  // affordances left are a star — which puts him in front of your staff every
  // week for nothing — and, in the pre-draft window, one of the year's handful
  // of private workouts.
  const prospectScouting = userTeam && player.isDraftee
    ? await Promise.all([
        loadWorkoutSlots(league.id),
        prisma.shortlistEntry.findUnique({ where: { playerId_teamId: { playerId: player.id, teamId: userTeam.id } } }),
      ])
    : null;
  const workoutSlots = prospectScouting?.[0] ?? null;
  const onShortlist = !!prospectScouting?.[1];
  const workedOutThisYear = !!workoutSlots && report?.workoutYear === workoutSlots.seasonYear;

  const seasonStats = readJson<Record<string, number>>(player.seasonStats, {});
  const careerStats = readJson<Record<string, number>>(player.careerStats, {});
  const hit = capHit(player.contract, settings.capMode);
  const remaining = player.contract ? remainingValue(player.contract, settings.capMode) : 0;
  const capSummary = userTeam && settings.capMode !== 'OFF'
    ? await teamCapSummary(userTeam.id, league.seasonYear, settings.capMode)
    : null;
  const capSpace = capSummary ? capSummary.capSpace : Number.MAX_SAFE_INTEGER;

  const jerseyColor = player.team ? generateTeamLogoParams(player.team.abbr).primary : undefined;
  const label = playerLabel({
    ovr: view.scoutedOvr,
    potential: view.revealed ? player.potential : (view.potLow + view.potHigh) / 2,
    isDraftee: player.isDraftee,
    experience: player.experience,
    confidence: view.confidence,
  });
  // Top few stat lines for the hero — the full breakdown still lives in the
  // Season/Career Stats sections below; this is a headline, not a replacement.
  const keyStats = sortStatEntries(seasonStats).slice(0, 3);

  // Older test data predates this feature — collegeStats/combineTesting
  // parse fine as "{}" (not a parse failure, so readJson's fallback never
  // kicks in) but with no real fields, so check for actual content.
  const collegeProfileRaw = player.isDraftee ? readJson<Partial<CollegeProfile>>(player.collegeStats, {}) : null;
  const collegeProfile = collegeProfileRaw?.games?.length ? (collegeProfileRaw as CollegeProfile) : null;
  const combineRaw = player.isDraftee ? readJson<Partial<CombineTesting>>(player.combineTesting, {}) : null;
  const combineTesting = combineRaw?.venue ? (combineRaw as CombineTesting) : null;
  // Testing numbers are PUBLIC — every team watches the same combine — so
  // this ranks against the whole position group in the class with no fog
  // gating, unlike the scouted attribute ranges above. draftYear scopes the
  // peer group to prospects generated in the same class, not every CB who's
  // ever passed through isDraftee:true.
  const combinePeers = combineTesting && player.draftYear != null
    ? await prisma.player.findMany({
        where: { leagueId: league.id, isDraftee: true, position: player.position, draftYear: player.draftYear },
        select: { combineTesting: true },
      })
    : [];
  const combineRanks = combineTesting
    ? rankProspectCombine(
        combineTesting,
        combinePeers
          .map((p) => readJson<Partial<CombineTesting>>(p.combineTesting, {}))
          .filter((c): c is CombineTesting => !!c.venue),
      )
    : {};
  const weeksElapsed = collegeWeeksElapsed(league.week);
  const collegeToDate = collegeProfile ? aggregateCollegeGames(collegeProfile.games, weeksElapsed) : null;
  const buzzNote = collegeProfile
    ? prospectBuzzNote(player.trueOvr, player.potential, view.scoutedOvr, view.confidence, collegeProfile.competitionGrade)
    : null;
  const GRADE_CLASS: Record<string, string> = { A: 'text-gold', B: 'text-accent', C: 'text-chalk', D: 'text-warn', F: 'text-bad' };

  // Your team's current depth at this player's position — the point is
  // answering "do I need a replacement here" without leaving the card,
  // whether you're looking at your own player, a free agent, or a trade
  // target on another roster.
  const depthChart = userTeam
    ? await prisma.depthChartSlot.findMany({
        where: { teamId: userTeam.id, position: player.position },
        orderBy: { rank: 'asc' },
        include: { player: true },
      })
    : [];

  // Contract facts get their own strip under the hero — the money questions
  // ("what does he cost, what's he worth, what would walking away cost")
  // answered together instead of scattered down the page. A draftee has no
  // contract yet, so his strip is his college production instead.
  // A draftee has no NFL season yet, so his headline numbers are college
  // production instead — the same "three numbers that matter" treatment,
  // sourced from the profile that's already revealed week by week.
  const COLLEGE_HEADLINE: Record<string, [keyof NonNullable<typeof collegeToDate>, string][]> = {
    QB: [['passYds', 'Pass Yds'], ['passTd', 'Pass TD'], ['passInt', 'INT']],
    RB: [['rushYds', 'Rush Yds'], ['rushTd', 'Rush TD'], ['rushAtt', 'Carries']],
    FB: [['rushYds', 'Rush Yds'], ['rushTd', 'Rush TD'], ['rec', 'Rec']],
    WR: [['recYds', 'Rec Yds'], ['rec', 'Rec'], ['recTd', 'Rec TD']],
    TE: [['recYds', 'Rec Yds'], ['rec', 'Rec'], ['recTd', 'Rec TD']],
    EDGE: [['sacks', 'Sacks'], ['tkl', 'Tackles'], ['tfl', 'TFL']],
    DT: [['sacks', 'Sacks'], ['tkl', 'Tackles'], ['tfl', 'TFL']],
    LB: [['tkl', 'Tackles'], ['sacks', 'Sacks'], ['tfl', 'TFL']],
    CB: [['ints', 'INT'], ['pd', 'Pass Def'], ['tkl', 'Tackles']],
    S: [['tkl', 'Tackles'], ['ints', 'INT'], ['pd', 'Pass Def']],
    LT: [['pancakes', 'Pancakes'], ['sacksAllowed', 'Sacks All.']],
    RT: [['pancakes', 'Pancakes'], ['sacksAllowed', 'Sacks All.']],
    LG: [['pancakes', 'Pancakes'], ['sacksAllowed', 'Sacks All.']],
    RG: [['pancakes', 'Pancakes'], ['sacksAllowed', 'Sacks All.']],
    C: [['pancakes', 'Pancakes'], ['sacksAllowed', 'Sacks All.']],
    K: [['fgMade', 'FG Made'], ['fgAtt', 'FG Att'], ['xpMade', 'XP Made']],
    P: [['punts', 'Punts'], ['puntYds', 'Punt Yds']],
  };
  const collegeHeadline = collegeToDate
    ? (COLLEGE_HEADLINE[player.position] ?? [])
        .map(([key, lbl]) => [lbl, collegeToDate[key] ?? 0] as const)
        .filter(([, v]) => v > 0)
    : [];

  // --- Career honors -------------------------------------------------------
  // Awards are matched by name because Transaction has no player relation —
  // safe here because lib/gen/names.ts's NameRegistry guarantees no two
  // players in a league ever share one. Rings can't be looked up at all:
  // nothing records which roster a generated veteran was on eight years ago,
  // so lib/gen/leagueHistory.ts derives them deterministically from his own
  // id, his club's actual title years, and his calibre. Both queries return
  // nothing for a save created before any of this existed, and the block
  // simply doesn't render.
  const careerStartYear = league.seasonYear - player.experience;
  const [awardTxs, titleSeasons] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        leagueId: league.id, type: { in: Object.keys(AWARD_LABEL) },
        headline: { startsWith: `${player.firstName} ${player.lastName} (` },
      },
      orderBy: { seasonYear: 'asc' },
    }),
    player.teamId
      ? prisma.teamSeasonRecord.findMany({
          where: { teamId: player.teamId, playoffResult: 'CHAMPION' },
          select: { year: true }, orderBy: { year: 'asc' },
        })
      : Promise.resolve([]),
  ]);
  const honorAwards: HonorAward[] = awardTxs.map((t) => ({
    year: t.seasonYear, label: AWARD_LABEL[t.type] ?? t.type, statLine: t.detail,
  }));
  const ringYears = player.isDraftee ? [] : ringYearsFor({
    playerId: player.id, trueOvr: player.trueOvr, careerStartYear,
    currentYear: league.seasonYear, titleYears: titleSeasons.map((s) => s.year),
  });
  const careerHighlights = (CAREER_HEADLINE[player.position] ?? [])
    .map(([key, lbl]) => ({ label: lbl, value: (careerStats[key] ?? 0).toLocaleString() }))
    .filter((h) => h.value !== '0');

  const market = marketValue({ ovr: view.scoutedOvr, position: player.position as any, age: player.age, potential: player.potential });
  const releaseCost = deadMoneyOnCut(player.contract, settings.capMode);
  const capTotal = capSummary?.capTotal ?? 0;
  const valueTier = player.contract ? classifyContractValue(market - hit, market) : 'market';

  const scoutingReport = generateScoutingReport({
    playerId: player.id,
    position: player.position as any,
    age: player.age,
    experience: player.experience,
    isDraftee: player.isDraftee,
    view,
  });

  const heroFacts: { label: string; value: string; detail?: string; color?: string }[] = player.isDraftee
    ? [
        { label: 'Draft Class', value: String(league.seasonYear), detail: player.college },
        { label: 'Projection', value: label.label, detail: 'role this profile suggests', color: label.className },
        ...(combineTesting ? [{ label: '40-Yard', value: `${combineTesting.fortyYard.toFixed(2)}s`, detail: combineTesting.venue === 'COMBINE' ? 'NFL Combine' : 'Pro Day' }] : []),
        ...(collegeProfile ? [{ label: 'Competition', value: `${collegeProfile.competitionGrade}-tier`, detail: 'strength of schedule faced', color: GRADE_CLASS[collegeProfile.competitionGrade] }] : []),
        { label: 'Measurables', value: `${Math.floor(player.heightIn / 12)}'${player.heightIn % 12}"`, detail: `${player.weightLb} lb` },
      ]
    : settings.capMode === 'OFF'
      ? [
          { label: 'Market Value', value: `${formatMoney(market)}/yr`, detail: 'what the rating is worth' },
          { label: 'Years Left', value: player.contract ? String(player.contract.yearsRemaining) : '—', detail: player.contract ? `expires after ${league.seasonYear + Math.max(0, player.contract.yearsRemaining - 1)}` : 'no contract' },
        ]
      : [
          {
            label: `Cap Hit ${league.seasonYear}`,
            value: formatMoney(hit),
            detail: capTotal > 0 ? `${((hit / capTotal) * 100).toFixed(1)}% of cap` : undefined,
          },
          {
            label: 'Market Value',
            value: `${formatMoney(market)}/yr`,
            detail: !player.contract
              ? 'what the rating is worth'
              : valueTier === 'market'
                ? 'paid at market rate'
                : `${valueTier === 'bargain' ? 'surplus +' : 'over by '}${formatMoney(Math.abs(market - hit))}`,
            // Market-rate stays the default ink — only a deviation big enough to matter earns green/red.
            color: valueTier === 'bargain' ? 'text-accent' : valueTier === 'overpay' ? 'text-bad' : undefined,
          },
          {
            label: 'Years Left',
            value: player.contract ? String(player.contract.yearsRemaining) : '—',
            detail: player.contract ? `expires after ${league.seasonYear + Math.max(0, player.contract.yearsRemaining - 1)}` : 'no contract',
          },
          { label: 'Guaranteed', value: player.contract ? formatMoney(player.contract.guaranteed) : '—' },
          {
            label: 'Release Cost',
            value: formatMoney(releaseCost),
            detail: releaseCost > 0 ? 'dead money if cut' : 'clean cut',
            color: releaseCost > 0 ? 'text-bad' : 'text-accent',
          },
        ];

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Hero — team-tinted card, revealed OVR or a scouted range, never both. */}
      <div
        className="relative overflow-hidden rounded-lg border border-line/70"
        style={{
          ['--team-accent' as never]: jerseyColor,
          background: jerseyColor ? `radial-gradient(ellipse 90% 130% at 0% 50%, color-mix(in srgb, ${jerseyColor} 20%, transparent), transparent 70%)` : undefined,
        }}
      >
        <div className="flex flex-wrap items-start gap-6 p-6">
          <div className="relative shrink-0 rounded-lg p-3" style={{ background: jerseyColor ? `color-mix(in srgb, ${jerseyColor} 14%, transparent)` : undefined }}>
            <PlayerAvatar seed={player.id} age={player.age} size={128} teamColor={jerseyColor} weightLb={player.weightLb} heightIn={player.heightIn} position={player.position} />
          </div>

          <div className="flex-1 min-w-[280px]">
            {/* Everything identifying him on one quiet meta line, so the name
                below it has the page to itself. */}
            <div className="label-sm flex items-center gap-2 flex-wrap">
              <span className={`font-semibold ${positionBadgeClass(player.position)}`}>{player.position}</span>
              <span>·</span><span>Age {player.age}</span>
              <span>·</span><span>{player.experience > 0 ? `Year ${player.experience}` : 'Rookie'}</span>
              <span>·</span>
              {player.team ? (
                <span className="flex items-center gap-1.5"><TeamLogo seed={player.team.id} abbr={player.team.abbr} size={14} />{player.team.city} {player.team.nickname}</span>
              ) : (
                <span>{player.status === 'FREE_AGENT' ? (player.isDraftee ? 'Draft Prospect' : 'Free Agent') : player.status}</span>
              )}
              <span className={`pill text-[10px] border-current ${label.className}`}>{label.label}</span>
            </div>

            {/* Split name — given name reads as a kicker over the surname, which
                is the part that carries on a jersey. */}
            <div className="mt-2">
              <div className="font-display font-bold text-xl uppercase tracking-[0.18em] text-muted leading-none">{player.firstName}</div>
              <div className="font-display font-extrabold text-5xl uppercase tracking-wide leading-[0.95] mt-1">{player.lastName}</div>
            </div>

            <div className="text-xs text-muted mt-2">
              {Math.floor(player.heightIn / 12)}'{player.heightIn % 12}" · {player.weightLb} lb · {player.college}
            </div>

            {collegeHeadline.length > 0 ? (
              <div className="mt-5 border-t border-line/50 pt-4">
                <div className="label-sm text-accent2 mb-2">College — through week {weeksElapsed} of {COLLEGE_WEEKS}</div>
                <div className="flex items-stretch gap-6 flex-wrap">
                  {collegeHeadline.map(([lbl, v]) => (
                    <div key={lbl} className="pr-6 border-r border-line/40 last:border-r-0 last:pr-0">
                      <div className="label-sm">{lbl}</div>
                      <div className="stat-value text-stat-md leading-none mt-1">{v.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : keyStats.length > 0 ? (
              <div className="flex items-stretch gap-6 mt-5 border-t border-line/50 pt-4 flex-wrap">
                {keyStats.map(([k, v]) => (
                  <div key={k} className="pr-6 border-r border-line/40 last:border-r-0 last:pr-0">
                    <div className="label-sm">{statLabel(k)}</div>
                    <div className="stat-value text-stat-md leading-none mt-1">{v}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col items-stretch gap-3 shrink-0 w-[200px]">
            {view.revealed ? (
              <div
                className="rounded-lg border-2 px-4 py-3 text-center"
                style={{ borderColor: 'var(--team-accent, #38bdf8)', background: jerseyColor ? `color-mix(in srgb, ${jerseyColor} 16%, transparent)` : undefined }}
              >
                <div className="label-sm">Overall</div>
                <div className={`stat-value text-stat-xl leading-none mt-1 ${ratingColor(view.scoutedOvr)}`}>{view.scoutedOvr}</div>
              </div>
            ) : (
              <div className="panel p-3">
                <ScoutingRange low={view.ovrLow} high={view.ovrHigh} confidence={view.confidence} label="Scouted OVR" className="w-full" />
              </div>
            )}
            <div className="panel p-3">
              <ScoutingRange low={view.potLow} high={view.potHigh} confidence={view.confidence} label="Potential" className="w-full" />
            </div>
          </div>
        </div>

        {/* Fact strip — contract money for a rostered player, scouting-relevant
            profile for a draftee who doesn't have a contract yet. */}
        {heroFacts.length > 0 && (
          <div className="relative border-t border-line/60 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-line/40 bg-ink/30">
            {heroFacts.map((f) => (
              <div key={f.label} className="px-4 py-3">
                <div className="label-sm">{f.label}</div>
                <div className={`stat-value text-stat-sm leading-none mt-1 ${f.color ?? ''}`}>{f.value}</div>
                {f.detail && <div className="text-[11px] text-muted mt-1">{f.detail}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {!player.isDraftee && (
        <CareerHonors
          position={player.position}
          ringYears={ringYears}
          awards={honorAwards}
          careerHighlights={careerHighlights}
          seasons={player.experience}
        />
      )}

      {!view.revealed && (
        <div className="panel border-l-2 border-l-accent2 p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-[16rem] flex-1">
            <div className="text-sm font-medium">Scouting confidence: {Math.round(view.confidence)}%</div>
            <p className="text-xs text-muted mt-1 max-w-lg">{view.notes}</p>
          </div>
          {userTeam && (
            <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
              {workoutSlots && (
                <>
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    <ShortlistStar leagueId={league.id} teamId={userTeam.id} playerId={player.id} initial={onShortlist} />
                    {onShortlist ? 'Worked every week' : 'Star to have him watched'}
                  </span>
                  <WorkoutButton
                    leagueId={league.id}
                    teamId={userTeam.id}
                    playerId={player.id}
                    name={`${player.firstName} ${player.lastName}`}
                    meta={`${player.position} · ${player.college}`}
                    avatar={<PlayerAvatar seed={player.id} age={player.age} size={40} weightLb={player.weightLb} heightIn={player.heightIn} position={player.position} />}
                    remaining={workoutSlots.remaining}
                    max={workoutSlots.max}
                    open={workoutSlots.open}
                    windowLabel={workoutSlots.windowLabel}
                    done={workedOutThisYear}
                    potLow={view.potLow}
                    potHigh={view.potHigh}
                    confidence={view.confidence}
                  />
                </>
              )}
              {/* The full-reveal charge belongs beside the free affordances, so
                  what it costs is compared against what nothing costs. */}
              <FullScoutButton leagueId={league.id} teamId={userTeam.id} playerId={player.id} compact />
            </div>
          )}
        </div>
      )}

      <div className="section">
        <SectionHeading title="Scouting Report" action={<span className="text-xs text-muted">{Math.round(view.confidence)}% confidence</span>} />
        {/* Hedging in this prose is driven by each attribute's own displayed
            band width, not one aggregate number — so it can never assert more
            precision than the fog above is already showing. */}
        <div className="panel p-5">
          <p className="text-sm leading-relaxed text-chalk/90">{scoutingReport}</p>
        </div>
      </div>

      <div className="section">
        <SectionHeading title="Attributes" action={!view.revealed ? <span className="text-xs text-muted">Scouted range shown — true values hidden</span> : undefined} />
        <div className="panel p-5 grid sm:grid-cols-2 gap-x-8 gap-y-3">
          {view.attrs.map((a) => (
            <div key={a.key} className="flex items-center gap-3">
              <span className="text-sm text-muted w-36 shrink-0">{a.label}</span>
              <div className="flex-1 h-2 bg-raised rounded-full overflow-hidden relative">
                <div
                  className="absolute h-full bg-line rounded-full"
                  style={{ left: `${a.low}%`, width: `${Math.max(2, a.high - a.low)}%` }}
                />
                <div className="absolute h-full w-0.5 bg-accent2" style={{ left: `${a.observed}%` }} />
              </div>
              <span className={`text-sm font-mono w-14 text-right ${ratingColor(a.observed)}`}>
                {view.revealed ? a.actual : `${a.low}-${a.high}`}
              </span>
            </div>
          ))}
        </div>
      </div>

      {collegeProfile && collegeToDate && combineTesting && (
        <div className="section">
          <SectionHeading
            title={`College Profile — ${player.college}`}
            action={<span className={`text-xs font-medium ${GRADE_CLASS[collegeProfile.competitionGrade]}`}>Competition: {collegeProfile.competitionGrade}-tier</span>}
          />
          <div className="panel overflow-hidden">
            {/* Testing gets its own full-width band of equal tiles — six
                measurements read as one workout, not a cramped 3x2 grid
                sharing a column with the season line. */}
            <div className="px-5 pt-4 pb-3 border-b border-line/60">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div className="label-sm">{combineTesting.venue === 'COMBINE' ? 'NFL Combine' : 'Pro Day'} Testing</div>
                <div className="text-xs text-muted">
                  {combineTesting.venue === 'COMBINE'
                    ? 'Measured under standard conditions at the league combine.'
                    : 'Self-hosted pro day — conditions favor the prospect, so times tend to run a touch fast.'}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-line/40 border-b border-line/60">
              {([
                { label: '40-Yard', value: `${combineTesting.fortyYard.toFixed(2)}s`, key: 'fortyYard' },
                { label: 'Vertical', value: `${combineTesting.vertical}"`, key: 'vertical' },
                { label: 'Broad', value: `${combineTesting.broadJump}"`, key: 'broadJump' },
                { label: '3-Cone', value: `${combineTesting.threeCone.toFixed(2)}s`, key: 'threeCone' },
                { label: 'Shuttle', value: `${combineTesting.shuttle.toFixed(2)}s`, key: 'shuttle' },
                { label: 'Bench', value: combineTesting.benchReps !== null ? `${combineTesting.benchReps}` : '—', key: 'benchReps' },
              ] as { label: string; value: string; key: CombineMeasurable }[]).map((m) => {
                const rank = combineRanks[m.key];
                return (
                  <div key={m.label} className="px-3 py-3 text-center">
                    <div className="label-sm">{m.label}</div>
                    <div className="stat-value text-stat-sm leading-none mt-1.5">{m.value}</div>
                    {/* Public combine data, same as the numbers above it — never fogged, so this
                        shows for every prospect regardless of scouting confidence. */}
                    <div className="text-[10px] text-muted mt-1">
                      {rank ? `${ordinal(rank.rank)} of ${rank.outOf}` : ' '}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-5">
              <div className="label-sm mb-2">College Season — through week {weeksElapsed} of {COLLEGE_WEEKS}</div>
              <CollegeStatLine position={player.position} stats={collegeToDate} />
            </div>

            {buzzNote && (
              <p className="text-xs text-accent2 italic px-5 pb-4 -mt-1">{buzzNote}</p>
            )}
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-6">
        {/* A draft prospect has no NFL production by definition — his College
            Profile above is the whole record, so two empty panels saying so
            are just noise on the card. */}
        {!player.isDraftee && (<>
        <div className="section">
          <SectionHeading title="Season Stats" />
          <div className="panel p-5">
            {Object.keys(seasonStats).length === 0 ? (
              <p className="text-sm text-muted">No stats recorded yet this season.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-sm">
                {sortStatEntries(seasonStats).map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-line/50 py-1">
                    <span className="text-muted">{statLabel(k)}</span><span className="font-mono font-semibold">{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="section">
          <SectionHeading title="Career Stats" />
          <div className="panel p-5">
            {Object.keys(careerStats).length === 0 ? (
              <p className="text-sm text-muted">No career stats on file yet — these accumulate as full seasons complete.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-sm">
                {sortStatEntries(careerStats).map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-line/50 py-1">
                    <span className="text-muted">{statLabel(k)}</span><span className="font-mono font-semibold">{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </>)}

        {userTeam && (
          <div className="section">
            <SectionHeading title={`Your Depth at ${player.position}`} />
            <div className="panel p-4">
              {depthChart.length === 0 ? (
                <p className="text-sm text-muted">Nobody rostered at {player.position} right now — a clear need.</p>
              ) : (
                <div className="space-y-1">
                  {depthChart.map((slot) => {
                    const isThisPlayer = slot.playerId === player.id;
                    return (
                      <Link
                        key={slot.id}
                        href={`/league/${league.id}/player/${slot.playerId}`}
                        className={`flex items-center gap-3 px-2 py-1.5 -mx-2 rounded-lg text-sm ${isThisPlayer ? 'bg-accent/10 border border-accent/30' : 'hover:bg-raised'}`}
                      >
                        <span className="label-sm w-5 shrink-0">{slot.rank === 0 ? '1' : slot.rank + 1}</span>
                        <PlayerAvatar seed={slot.playerId} age={slot.player.age} size={22} weightLb={slot.player.weightLb} heightIn={slot.player.heightIn} position={slot.player.position} />
                        <span className={`flex-1 truncate ${isThisPlayer ? 'font-semibold' : ''}`}>{slot.player.firstName} {slot.player.lastName}{isThisPlayer ? ' (this player)' : ''}</span>
                        <span className={`font-mono text-xs ${ratingColor(slot.player.trueOvr)}`}>{slot.player.trueOvr}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="section">
          <SectionHeading
            title="Contract"
            action={
              <div className="flex gap-1.5">
                {player.contract?.isRookieDeal && <span className="pill border-accent2/30 text-accent2 bg-accent2/10">Rookie Deal</span>}
                {player.contract?.isFranchiseTag && <span className="pill border-warn/30 text-warn bg-warn/10">Franchise Tag</span>}
              </div>
            }
          />
          <div className="panel p-5">
            {player.contract ? (
              <div className="space-y-4">
                <StatNumber value={formatMoney(hit)} label="Cap hit this year" size="lg" />

                <div>
                  <div className="flex gap-1">
                    {Array.from({ length: player.contract.years }, (_, i) => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 rounded-full ${i < player.contract!.years - player.contract!.yearsRemaining ? 'bg-line' : 'bg-accent'}`}
                      />
                    ))}
                  </div>
                  <div className="text-xs text-muted mt-1">
                    {player.contract.yearsRemaining} yr{player.contract.yearsRemaining === 1 ? '' : 's'} remaining of {player.contract.years}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm pt-3 border-t border-line/60">
                  <div>
                    <div className="label-sm mb-0.5">Remaining Value</div>
                    <div className="font-mono">{formatMoney(remaining)}</div>
                  </div>
                  <div>
                    <div className="label-sm mb-0.5">Guaranteed</div>
                    <div className="font-mono">{formatMoney(player.contract.guaranteed)}</div>
                  </div>
                  {player.contract.voidYears > 0 && (
                    <div>
                      <div className="label-sm mb-0.5">Void Years</div>
                      <div className="font-mono text-warn">+{player.contract.voidYears}</div>
                    </div>
                  )}
                </div>

                {isOwnRoster && userTeam && (
                  <div className="pt-3 space-y-3 border-t border-line/60">
                    <ContractActions
                      leagueId={league.id} playerId={player.id} ovr={view.scoutedOvr} position={player.position} age={player.age}
                      contract={{
                        years: player.contract.years, yearsRemaining: player.contract.yearsRemaining, signedYear: player.contract.signedYear,
                        baseSalaries: player.contract.baseSalaries, signingBonus: player.contract.signingBonus,
                        guaranteed: player.contract.guaranteed, voidYears: player.contract.voidYears,
                      }}
                      availableSpaceForExtension={capSpace + hit} capSpace={capSpace} capMode={settings.capMode}
                    />
                    <CutButton leagueId={league.id} playerId={player.id} />
                  </div>
                )}
              </div>
            ) : player.status === 'FREE_AGENT' && !player.isDraftee && userTeam ? (
              <SignOfferForm leagueId={league.id} teamId={userTeam.id} playerId={player.id} ovr={view.scoutedOvr} position={player.position} age={player.age} capSpace={capSpace} capMode={settings.capMode} />
            ) : player.isDraftee ? (
              <p className="text-sm text-muted">This prospect is in the draft pool — he can only be acquired through the rookie draft, not signed as a free agent.</p>
            ) : (
              <p className="text-sm text-muted">No contract on file.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
