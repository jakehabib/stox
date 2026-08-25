import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { buildScoutedView } from '@/lib/scouting';
import { loadScoutMods } from '@/lib/dynasty';
import { readJson } from '@/lib/json';
import { ratingColor } from '@/lib/ratings';
import { LEAGUE, SHORTLIST_ATTENTION } from '@/lib/tuning';
import {
  buildConsensusBoard, ownGradeFor, disagreementNote, bandCutoffs,
  CONSENSUS_BIASES, consensusBiasMeta, isConsensusBiasId,
  type ConsensusBias, type ConsensusBiasId, type ConsensusRead,
} from '@/lib/consensus';
import { loadAttentionPlan, unitsFor, confidenceAfterWeek } from '@/lib/shortlistAttention';
import { loadWorkoutSlots } from '@/lib/workouts';
import { imminentDraftYear, liveDraftClassYear } from '@/lib/draft';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { ScoutingRange } from '@/components/ds/ScoutingRange';
import { ScoutsRoom } from '@/components/ds/ScoutsRoom';
import { WorkoutButton } from '@/components/ds/WorkoutButton';
import { ConsensusBiasFilter, type BiasFacet, type ConsensusLens } from '@/components/ds/ConsensusBiasFilter';
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
 *      it is WRONG — so the board here is not a leaderboard, it is a lens on
 *      the room's own named error, and you can point it at one bias at a time.
 *
 *   2. YOUR SHORTLIST (free, ongoing, the only input). Star a prospect and
 *      your staff works him every week for the rest of the season, out of a
 *      fixed weekly pool. Star five and each gets a fifth of the department;
 *      star sixty and you learn a little about a lot. Choosing how many is
 *      the whole decision, so this section quotes the actual per-player
 *      share — the number lib/shortlistAttention.ts applies, from the same
 *      function it applies it with, never a second copy of the arithmetic.
 *
 *   3. PRIVATE WORKOUTS (five against each class, spendable from the day it
 *      lands on the board until its draft goes on the clock). The one scarce,
 *      deliberate commitment left in scouting.
 *
 * ---------------------------------------------------------------------------
 * THE REWORK, AND WHAT IT WAS FIXING  ("this is very confusing here")
 * ---------------------------------------------------------------------------
 * Every item below was measured before it was changed; the numbers are from
 * 163 generated classes / 78,335 prospects in the dev database.
 *
 *   PROSE WHERE A NUMBER BELONGS. The first thing on the page was a six-line
 *   paragraph in which the game explained its own scouting model, above any
 *   data. The house rule is that text is useful and informative but never an
 *   explainer, and this was the explainer case. It is now two sentences, and
 *   the model detail it was carrying lives in the section heading's glossary
 *   bubble, where the rest of the game keeps that kind of thing. NOTHING THE
 *   PREVIOUS HONESTY PASS ESTABLISHED WAS DROPPED: the board is wrong in ways
 *   that can be named and in ways that cannot, "every error is named below"
 *   is still not claimed anywhere, and the un-nameable half is still stated on
 *   the page (the glossary's own consensusBoard entry only covers the nameable
 *   half, so that half cannot be delegated to it).
 *
 *   A LEGEND POSING AS A CONTROL. Under the paragraph sat six tinted pills —
 *   "Small school 270 · Testing darling 192 · …" — styled exactly like the
 *   draft board's position filters and doing nothing. See
 *   components/ds/ConsensusBiasFilter.tsx for the three separate defects that
 *   carried and what replaced them. The counts were also taken against a
 *   different pool from the one the panel's own header quoted; here the count
 *   IS the length of the list clicking it produces.
 *
 *   A COLUMN THAT READ THE SAME ON EVERY ROW (README principle 5). The board
 *   rows carried a bias chip that, measured over 854 top-14 rows, said
 *   "▲ Big program" on 64% of them and nothing at all on another 24%. The top
 *   of a board is blue-blood-heavy by construction — a +4 program bump is
 *   most of what puts a man there — so as a column it was noise. It now
 *   carries the signed number of grade points the bias actually moved him,
 *   which varies row to row and is the number consensusGradeFor() added.
 *
 *   THE SAME FACT RENDERED TWICE. A flagged prospect's row printed "Medical
 *   flag" as its own pill and then again as his top bias: measured, that hit
 *   98% of flagged men and 11.6% of every row on the board. The standalone
 *   flag now renders only when the bias chip is not already saying it.
 *
 *   A PANEL THAT REPORTS NOTHING. Private workouts used to open in RESIGN and
 *   FREE_AGENCY only, so through the whole season — every state a GM spends
 *   most of his time in — the panel rendered a four-line explainer plus up to
 *   nine prospect cards whose only content was the words "Window closed", nine
 *   times. Closed is now one line. The window itself has since been fixed to
 *   run for the whole life of a class (lib/workouts.ts), which leaves shut as
 *   the rare state rather than the usual one; the one-line form stays, because
 *   an empty panel is worth no more space in a state a GM reaches rarely.
 *
 *   A NUMBER WITH NO UNIT. "Attention Each 10.7 units per starred man, per
 *   week" is unreadable — 10.7 of what, and is that a lot? The decision it
 *   exists to inform is "how many men can I afford to star", and the number
 *   that answers that is where a starred man's FILE LANDS BY THE DRAFT. That
 *   is now what the tile and the row column quote, projected by running the
 *   game's own confidenceAfterWeek() forward over the regular-season weeks
 *   that are actually left. The units are still on the row, one size down, as
 *   the input to it.
 *
 *   A THIRD RENDERING OF ROW ONE. The masthead's "Board Leader" tile named
 *   the same man the first board row named 200px below it. It is replaced by
 *   the count of starred men your own file actually disagrees with the room
 *   about, which is the one number that says whether this page is working.
 *
 *   A PAGE THAT IS ALL EMPTY STATES. A brand-new save has NO draft class:
 *   createLeague() does not seed one and lib/season.ts adds it on the
 *   PRESEASON step, so the first thing a new GM saw here was an essay about a
 *   board with nothing on it, over three empty panels. That state now renders
 *   as one panel that says what arrives and when.
 * ===========================================================================
 */

const BAND_TONE: Record<string, string> = {
  BLUE_CHIP: 'text-gold',
  FIRST_ROUND: 'text-accent',
  DAY_TWO: 'text-accent2',
  DAY_THREE: 'text-chalk',
  LATE_FLIER: 'text-muted',
  PRIORITY_FA: 'text-muted',
};

/** How many board rows the lens shows at once. Enough to read, short of being the draft board. */
const ROWS_SHOWN = 14;

/**
 * Where a starred man's file lands by the time the draft is on the clock, if
 * the shortlist stays the size it is.
 *
 * Runs lib/shortlistAttention.ts's OWN confidenceAfterWeek once per week that
 * is actually left, rather than deriving a closed form — the weekly pass is a
 * fraction of a shrinking remainder against a ceiling, and a second expression
 * of that would be a different number wearing this one's label. A forecast,
 * and labelled as one wherever it is shown.
 */
function fileByDraft(confidence: number, units: number, weeks: number): number {
  let c = confidence;
  for (let i = 0; i < weeks; i++) c = confidenceAfterWeek(c, units);
  return Math.round(c);
}

/**
 * Regular-season weeks this class still gets worked. Attention runs on the
 * REGULAR week tick and nowhere else (lib/season.ts), so this is the real
 * remaining budget and not a guess: the whole season ahead in preseason, what
 * is left of it in-season, and nothing once the football stops.
 */
function scoutingWeeksLeft(phase: string, week: number, seasonLength: number): number {
  if (phase === 'PRESEASON') return seasonLength;
  if (phase === 'REGULAR') return Math.max(0, seasonLength - week + 1);
  return 0;
}

/** Grade points every named bias moved him, netted. The number the model added, summed. */
function namedBiasNet(read: ConsensusRead): number {
  return read.biases.reduce((a, b) => a + b.delta, 0);
}

export default async function ScoutingPage({ params, searchParams }: {
  params: { id: string };
  searchParams: { lens?: string };
}) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  // The class is keyed by draftYear, not by "who is still available" — the
  // board has to rank drafted prospects too or a rank would move because
  // somebody else came off it.
  const classYear = await liveDraftClassYear(league.id, league.seasonYear);
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

  // ONE POOL, NAMED, FOR EVERY NUMBER IN THIS PANEL. The rank on a row is
  // still the rank against the whole class (a rank that moves because someone
  // else got picked is a lie), but every COUNT on this page — the class tile,
  // the filter tallies, the "n of m" under the rows — is taken against the men
  // a GM can still do something about. The old legend counted one pool and the
  // header quoted the other.
  const onBoard = board.filter((r) => available(r.playerId));
  const classSize = onBoard.length;
  const poolLabel = classSize === board.length ? 'in this class' : 'still on the board';

  /** Last board rank that gets picked at all, from the same cutoffs the bands use. */
  const draftableThrough = bandCutoffs({ teams: LEAGUE.TEAM_COUNT, rounds: settings.draftRounds }).DAY_THREE;

  const lens: ConsensusLens = isConsensusBiasId(searchParams.lens)
    ? searchParams.lens
    : searchParams.lens === 'board' ? 'board' : 'movers';
  const activeBias: ConsensusBiasId | null = isConsensusBiasId(lens) ? lens : null;

  // Every facet is computed off `onBoard`, so a tally and the list a click
  // produces are the same set by construction.
  const facets: BiasFacet[] = CONSENSUS_BIASES.map((meta) => {
    const hits = onBoard.flatMap((r) => r.biases.filter((b) => b.id === meta.id));
    return {
      id: meta.id,
      total: hits.length,
      meanDelta: hits.length ? hits.reduce((a, b) => a + b.delta, 0) / hits.length : 0,
    };
  });

  // THE THREE LENSES, all over the same pool.
  //   movers  the men the room's named biases moved furthest, either way. The
  //           default, and the one reading of this class that exists nowhere
  //           else in the game — see components/ds/ConsensusBiasFilter.tsx for
  //           why it is not the ranked board.
  //   board   the consensus order, for anyone who wants the leaderboard.
  //   <bias>  everyone carrying one named tag, in board order.
  const lensRows = activeBias
    ? onBoard.filter((r) => r.biases.some((b) => b.id === activeBias))
    : lens === 'board'
      ? onBoard
      : [...onBoard]
        // A thirteen-point markdown on the 350th-ranked man is not an
        // opportunity, it is a rounding error on somebody no club is drafting.
        // The pool is the men who will actually come off the board —
        // bandCutoffs()'s own DAY_THREE line, which IS teams x rounds, rather
        // than a second opinion here about how long a draft is.
        .filter((r) => r.rank <= draftableThrough && r.biases.length > 0)
        // Ties broken on board rank so the order is total and stable, never a
        // list that reshuffles between two renders of the same class.
        .sort((a, b) => Math.abs(namedBiasNet(b)) - Math.abs(namedBiasNet(a)) || a.rank - b.rank);
  const shownRows = lensRows.slice(0, ROWS_SHOWN);

  const shortlisted = onBoard.filter((r) => shortlistIds.has(r.playerId));

  const shownIds = Array.from(new Set([...shortlisted, ...shownRows].map((r) => r.playerId)));
  const [reports, workedOut] = await Promise.all([
    prisma.scoutingReport.findMany({ where: { teamId: team.id, playerId: { in: shownIds } } }),
    prisma.scoutingReport.findMany({
      where: { teamId: team.id, workoutYear: slots.classYear },
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

  const weeksLeft = scoutingWeeksLeft(league.phase, league.week, settings.seasonLength);
  const unitsEach = plan.unitsEach;

  /**
   * Every starred man, evaluated once. This used to be recomputed per section
   * — buildScoutedView ran twice for anyone who appeared both in the watch
   * list and in the workout grid — which is two chances for two sections to
   * quote different numbers for the same file.
   */
  const watching = shortlisted.map((read) => {
    const p = playerById.get(read.playerId)!;
    const view = viewFor(p.id);
    const { units, specialtyCovered } = unitsFor(plan, p.position);
    return {
      read,
      p,
      view,
      units,
      specialtyCovered,
      byDraft: fileByDraft(view.confidence, units, weeksLeft),
      atCeiling: view.confidence >= SHORTLIST_ATTENTION.CONFIDENCE_CEILING - 1,
      note: disagreementNote(read, view),
    };
  });

  // The one number that says whether this page is doing its job: how many of
  // your own files actually part company with the room. It is the count of
  // rows carrying a note, not a second rule about what counts as a
  // disagreement — disagreementNote owns that threshold.
  const disagreements = watching.filter((w) => w.note).length;
  const projections = watching.map((w) => w.byDraft).sort((a, b) => a - b);
  const medianByDraft = projections.length ? projections[Math.floor(projections.length / 2)] : 0;

  const lensHref = (l: ConsensusLens) =>
    l === 'movers' ? `/league/${league.id}/scouting` : `/league/${league.id}/scouting?lens=${l}`;

  const hasClass = classPlayers.length > 0;

  const masthead = (
    <PageMasthead
      teamId={team.id}
      teamAbbr={team.abbr}
      eyebrow="Front Office"
      title="Scouting Department"
      subtitle="The board is free and everybody has it. Your edge is knowing where it's wrong — and paying attention to the right handful of names for long enough to find out."
      // WITH NO CLASS IN, THREE OF THESE FIVE ARE AN EM DASH. A strip of
      // placeholders reads as a broken page rather than an early one, and a
      // tile that says the same thing as its neighbour says nothing (README
      // principle 5) — so before the class lands the strip is the two numbers
      // that are real.
      facts={(hasClass ? [
        {
          label: 'Class',
          value: String(classSize),
          detail: `${draftLabelYear} draft · graded free for every team`,
          href: `/league/${league.id}/draft`,
        },
        {
          label: 'Shortlisted',
          tip: tip('shortlist'),
          value: String(plan.shortlisted),
          detail: plan.shortlisted > 0 ? 'your staff works them every week' : 'star anyone to start',
          color: plan.shortlisted > 0 ? 'text-gold' : 'text-warn',
        },
        // WHAT THE WEEKLY SPLIT BUYS, rather than the split itself. See
        // fileByDraft: a projection, run through the game's own weekly
        // function. Once the football stops there are no weeks left to project
        // over, so rather than stand there reading "—" it drops out entirely —
        // an empty tile is a tile saying nothing (README principle 5).
        ...(weeksLeft > 0 ? [{
          label: 'File By Draft',
          tip: tip('attentionUnits'),
          value: plan.shortlisted > 0 ? `${medianByDraft}%` : '—',
          detail: plan.shortlisted === 0
            ? 'nothing starred'
            : `typical of your ${plan.shortlisted}, ${weeksLeft} week${weeksLeft === 1 ? '' : 's'} left`,
          color: plan.shortlisted > 0 && medianByDraft < 50 ? 'text-warn' : undefined,
        }] : []),
        {
          label: 'Workouts',
          tip: tip('privateWorkout'),
          value: `${slots.remaining}/${slots.max}`,
          // The same sentence the panel below quotes in full, cut to tile
          // width by the function that writes it — not a second reading of the
          // phase here, which is how a tile ends up promising a window the
          // panel says is shut.
          detail: slots.windowTag,
          color: !slots.open ? 'text-muted' : slots.remaining === 0 ? 'text-bad' : undefined,
        },
        {
          // Not "Board Leader" — that was row one of the table 200px below,
          // rendered a second time. This is the thing you came for.
          label: 'We Disagree',
          tip: tip('boardGrade'),
          value: plan.shortlisted > 0 ? String(disagreements) : '—',
          detail: plan.shortlisted === 0
            ? 'star somebody to form an opinion'
            : disagreements > 0
              ? `of ${watching.length} starred, our grade is well off the room's`
              : 'our files agree with the room so far',
          color: disagreements > 0 ? 'text-accent' : undefined,
        },
      ] : [
        {
          label: 'Class',
          value: '—',
          detail: `the ${draftLabelYear} class lands in week 1`,
        },
        {
          label: 'Workouts',
          tip: tip('privateWorkout'),
          value: `${slots.remaining}/${slots.max}`,
          detail: 'to spend once the season is over',
        },
      ])}
    />
  );

  // -------------------------------------------------------------------------
  // NO CLASS YET
  // -------------------------------------------------------------------------
  // A save created this minute has none: createLeague() writes rosters and a
  // free-agent pool but no draftees, and lib/season.ts adds the class on the
  // PRESEASON step. Rendering the three normal panels here produced a page
  // that was an essay above three "nothing here" boxes.
  if (!hasClass) {
    return (
      <div className="space-y-6">
        {masthead}
        <div className="section">
          <SectionHeading eyebrow="Nothing to scout yet" title="The Class Isn't In" tip={tip('consensusBoard')} />
          <div className="panel p-5 space-y-3">
            <p className="text-sm text-chalk/90 max-w-2xl leading-relaxed">
              Next spring&apos;s class lands the week the season kicks off, graded and ranked for every team at once.
              From that moment your department has the whole regular season to work it — and the only thing it needs
              from you is which names to live on.
            </p>
            <p className="text-xs text-muted max-w-2xl leading-relaxed">
              Advance into week 1 and this page fills up: the consensus board, the men the room has marked down, and
              your own file forming against it.
            </p>
          </div>
        </div>
        <ScoutsRoom
          quote="Nothing to look at yet. Get me to the season and I'll have names for you by the first bye."
          attribution="Director of College Scouting"
        />
      </div>
    );
  }

  const activeMeta = activeBias ? consensusBiasMeta(activeBias) : undefined;

  return (
    <div className="space-y-6">
      {masthead}

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
              Whole class, sortable →
            </Link>
          }
        />
        <div className="panel p-4 space-y-3.5">
          {/* WHAT SURVIVED THE CUT, AND WHY THESE TWO SENTENCES.
              The paragraph this replaces was six lines and it was right — a
              previous pass had already fixed it for honesty, after measuring
              that the consensus number one busts 12% of the time, so it no
              longer claimed every error was named on the rows below. That
              correction is load-bearing and is kept here in full: the board is
              wrong in ways that CAN be named and in ways that CANNOT, and the
              second half is stated on the page rather than delegated to
              glossary.consensusBoard, whose text covers only the first half.
              What went is the explanation of the mechanism — which biases
              exist, what each one does — because that is now readable off the
              filter bar directly underneath, where it is a control instead of
              a claim. */}
          <p className="text-sm text-chalk/90 leading-relaxed max-w-3xl">
            Every front office opens the year with these same grades. The room is
            <strong className="text-chalk"> wrong</strong> in six ways it will tell you about — pick one below and read
            the men it moved — and wrong again in ways nobody can name, which is why the first pick busts and the
            fifth-rounder plays a decade.
          </p>

          <ConsensusBiasFilter
            facets={facets}
            active={lens}
            hrefFor={lensHref}
            poolSize={classSize}
            poolLabel={poolLabel}
          />
        </div>

        <div className="panel divide-y divide-line/30">
          {shownRows.map((read) => (
            <BoardRow
              key={read.playerId}
              read={read}
              leagueId={league.id}
              teamId={team.id}
              starred={shortlistIds.has(read.playerId)}
              player={playerById.get(read.playerId)!}
              activeBias={activeBias}
            />
          ))}
          {shownRows.length === 0 && (
            <div className="px-4 py-8 text-sm text-muted text-center">
              {activeMeta ? (
                <>
                  No prospect {poolLabel} carries the <strong className="text-chalk">{activeMeta.label}</strong> tag
                  this year. <Link href={lensHref('movers')} className="text-accent2 hover:underline">Back to the board</Link>.
                </>
              ) : classSize === 0 ? (
                <>Nobody left on this board — the class has been picked clean.</>
              ) : (
                <>Nobody left on this board carries a named bias. Whatever the room has wrong about the men still here, it cannot tell you what it is.</>
              )}
            </div>
          )}
        </div>

        {shownRows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-muted">
            {/* WHAT THE ROWS ARE, SAID EXPLICITLY. A truncated list with no
                statement of what it was truncated from is the same defect the
                old counts had, one level up. */}
            <span>
              {activeMeta ? (
                <>
                  <span className={activeMeta.direction === 'UP' ? 'text-warn' : 'text-accent2'}>
                    {activeMeta.direction === 'UP' ? '▲' : '▼'} {activeMeta.label}
                  </span>
                  {' — '}
                  {shownRows.length < lensRows.length
                    ? <>the {shownRows.length} highest-graded of <strong className="text-chalk">{lensRows.length}</strong> {poolLabel}</>
                    : <>all <strong className="text-chalk">{lensRows.length}</strong> {poolLabel}</>}
                  {'. '}
                  {activeMeta.direction === 'DOWN' ? 'Where a steal is: the room took points off for something public.' : 'Where a bust is: the room added points for something public.'}
                </>
              ) : lens === 'board' ? (
                <>The top <strong className="text-chalk">{shownRows.length}</strong> of {classSize} {poolLabel}, in consensus order.</>
              ) : (
                <>
                  The <strong className="text-chalk">{shownRows.length}</strong> men the room&apos;s named biases moved
                  furthest, among the {Math.min(draftableThrough, classSize)} {poolLabel} who get drafted at all. Board
                  rank on the left — the biggest misreads are rarely at the top.
                </>
              )}
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1">
                <span className="font-mono">▲ ▼ slot</span>
                — the position&apos;s own pull
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
            </span>
          </div>
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
              weeksLeft > 0 ? (
                <span className="text-xs text-muted">
                  <span className="stat-value text-stat-sm text-chalk">{unitsEach.toFixed(1)}</span> units each ·{' '}
                  {weeksLeft} week{weeksLeft === 1 ? '' : 's'} left to watch
                </span>
              ) : (
                // A per-WEEK split, quoted when there are no weeks left, is a
                // rate for work that will not happen.
                <span className="text-xs text-muted">The watching is done for this class</span>
              )
            ) : undefined
          }
        />

        {watching.length === 0 ? (
          <div className="panel p-5 text-sm text-muted">
            Nobody starred. Your staff is watching the class the way everybody else is — from the same public board.
            Star a prospect on any row above, or on the{' '}
            <Link href={`/league/${league.id}/draft`} className="text-accent2 hover:underline">draft board</Link>, and
            they start working him this week, at no cost, for the rest of the season.
          </div>
        ) : (
          <>
            {/* ONE LINE, NOT THREE. The trade-off used to be a paragraph that
                restated the masthead tile beside it. The half a GM cannot get
                anywhere else is the counterfactual — what HALF this many
                would buy — so that is the half that stayed. */}
            <p className="text-xs text-muted -mt-1 max-w-3xl leading-relaxed">
              {weeksLeft > 0 ? (
                <>
                  One week&apos;s attention, split evenly. On {plan.shortlisted} names each file reaches about{' '}
                  <strong className="text-chalk">{medianByDraft}%</strong> by the draft; on half as many, each would
                  get twice the work.
                </>
              ) : (
                // Quoting a projection here once the weeks have run out would
                // be promising work that cannot happen. These are the files as
                // they finished.
                <>The season is over — these are the files your staff finished the year with. What is not in them now is not going in.</>
              )}
            </p>
            <div className="panel divide-y divide-line/30">
              {watching.map(({ read, p, view, units, specialtyCovered, byDraft, atCeiling, note }) => {
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

                      {/* WHERE HIS FILE ENDS UP, not how many abstract units
                          he is being paid this week. The units stay, under it,
                          because they are the input that produces this and
                          because they are what changes when you star somebody
                          else. */}
                      <div className="text-right shrink-0 w-36">
                        <div className="label-sm">{weeksLeft > 0 ? 'File by draft' : 'Our file'}</div>
                        {weeksLeft === 0 ? (
                          <div className="stat-value text-stat-sm text-chalk">{Math.round(view.confidence)}%</div>
                        ) : atCeiling ? (
                          <div className="stat-value text-stat-sm text-warn">Done</div>
                        ) : (
                          <div className="stat-value text-stat-sm text-chalk">{byDraft}%</div>
                        )}
                        <div className="text-[10px] text-muted leading-tight mt-0.5">
                          {/* Past the ceiling the share is still spent on him and
                              still comes out of everybody else's — which is the
                              argument for taking the star off, so say it.
                              With no weeks left this says nothing at all, and
                              the section heading already carries it once — so
                              it goes rather than repeat down five rows. */}
                          {weeksLeft === 0
                            ? null
                            : atCeiling
                              ? <span className="text-warn">as far as watching gets — the star is costing the others</span>
                              : <>now {Math.round(view.confidence)}% · {units.toFixed(1)} units/wk</>}
                          {specialtyCovered && weeksLeft > 0 && !atCeiling && <span className="text-accent2"> · specialist</span>}
                        </div>
                      </div>
                    </div>
                    {note && <p className="text-[11px] text-muted mt-2 pl-[4.5rem] max-w-3xl leading-relaxed">{note}</p>}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* 3. PRIVATE WORKOUTS                                              */}
      {/* ---------------------------------------------------------------- */}
      {/* CLOSED IS ONE LINE. The window now runs from the day the class is
          generated to the moment the draft goes on the clock, so shut is the
          rare state rather than the season-long one — but it is still a panel
          with nothing in it to work, and a four-line explainer over a grid of
          cards reading "Window closed" reports nothing (README principle 7).
          What a GM needs while it is shut is that his slots are intact and
          what closed them, which is one line. */}
      {!slots.open ? (
        <div className="section">
          <SectionHeading eyebrow="Scarce · one class" title="Private Workouts" tip={tip('privateWorkout')} />
          <div className="panel px-4 py-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-sm text-muted">{slots.windowLabel}</span>
            <span className="text-xs text-muted">
              <span className="stat-value text-stat-sm text-chalk">{slots.remaining}</span> of {slots.max} still in hand
            </span>
          </div>
        </div>
      ) : (
        <div className="section">
          <SectionHeading
            eyebrow="Scarce · one class"
            title="Private Workouts"
            tip={tip('privateWorkout')}
            action={
              <span className="text-xs">
                <span className={`stat-value text-stat-sm ${slots.remaining === 0 ? 'text-bad' : 'text-chalk'}`}>{slots.remaining}</span>
                <span className="text-muted"> of {slots.max} left on this class</span>
              </span>
            }
          />
          <div className="panel p-4 border-l-2 border-l-gold">
            <div className="text-sm text-chalk">{slots.windowLabel}</div>
            <p className="text-xs text-muted mt-2 max-w-3xl leading-relaxed">
              He flies in, your people run their own testing, and every measurable comes back exact with the ceiling
              projection about as tight as it gets. It will not tell you how he reads a defense — that is the read
              that busts picks, and one day in a facility cannot settle it.
            </p>
          </div>

          {watching.length === 0 ? (
            <div className="panel p-4 text-sm text-muted">
              Star the men you are considering first. A workout is the last question you ask about a prospect, not the
              first.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {watching.slice(0, 9).map(({ read, p, view }) => {
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
      )}

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

/**
 * One man on the lens.
 *
 * THE BIAS CHIP IS A MEASUREMENT, NOT A LABEL. It used to render the name of
 * his strongest bias and nothing else, which on the top of the board meant
 * "▲ Big program" on 64% of rows and a blank on another 24% — a column that
 * reads the same on every row (README principle 5). It now carries the signed
 * grade points that bias actually contributed, which is the number
 * consensusGradeFor() added and which differs man to man.
 *
 * AND IT SHOWS THE ONE YOU ASKED FOR. Under a filter the chip is the bias
 * being filtered on, not the strongest one — clicking "Medical flag" and being
 * shown a row chipped "Big program" is the control disowning its own result.
 */
function BoardRow({ read, player, leagueId, teamId, starred, activeBias }: {
  read: ConsensusRead;
  player: { id: string; firstName: string; lastName: string; position: string; college: string; age: number; weightLb: number; heightIn: number };
  leagueId: string;
  teamId: string;
  starred: boolean;
  activeBias: ConsensusBiasId | null;
}) {
  const shown: ConsensusBias | undefined =
    (activeBias ? read.biases.find((b) => b.id === activeBias) : undefined) ?? read.biases[0];
  const up = shown?.direction === 'UP';
  const net = namedBiasNet(read);
  // The flag is news on its own even before the grade moves — but printing it
  // beside a chip already reading "Medical flag" was one fact rendered twice
  // on 98% of flagged men.
  const flagSaidTwice = shown?.id === 'MEDICAL_DISCOUNT';

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" title={read.headline}>
      <div className="stat-value text-stat-sm text-muted w-8 text-right shrink-0">{read.rank}</div>
      <ShortlistStar leagueId={leagueId} teamId={teamId} playerId={player.id} initial={starred} />
      <PlayerAvatar
        seed={player.id}
        age={player.age}
        size={36}
        weightLb={player.weightLb}
        heightIn={player.heightIn}
        position={player.position}
      />
      <div className="min-w-0 flex-1">
        <Link href={`/league/${leagueId}/player/${player.id}`} className="text-sm font-medium hover:text-accent2">
          {player.firstName} {player.lastName}
        </Link>
        <div className="text-[11px] mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span className={`font-semibold ${positionBadgeClass(player.position)}`}>{player.position}</span>
          <span className="text-muted">{player.college}</span>
          {read.medicalFlag && !flagSaidTwice && (
            <span className="pill text-[10px] border-bad/40 text-bad" title="Flagged at the medical recheck.">✚ Medical flag</span>
          )}
          {shown ? (
            <span
              className={`pill text-[10px] gap-1 ${up ? 'border-warn/40 text-warn' : 'border-accent2/40 text-accent2'}`}
              title={shown.because}
            >
              {up ? '▲' : '▼'} {shown.label}
              <span className="font-mono opacity-80">{shown.delta > 0 ? '+' : '−'}{Math.abs(shown.delta).toFixed(1)}</span>
            </span>
          ) : (
            <span className="text-[10px] text-muted/70" title="No public signal moved this grade either way. The room's error on him, if any, is the unnameable kind.">nothing named</span>
          )}
          {/* A man carrying two or three tags is a different animal from one
              carrying the same tag alone — a small-school project with a
              medical is marked down fourteen points, not four — and the
              strongest chip alone cannot say so. `net` is the sum of the
              deltas the model actually added. */}
          {read.biases.length > 1 && (
            <span
              className={`text-[10px] font-mono ${net > 0 ? 'text-warn' : 'text-accent2'}`}
              title={`${read.biases.length} named biases on this grade: ${read.biases.map((b) => `${b.label} ${b.delta > 0 ? '+' : '−'}${Math.abs(b.delta).toFixed(1)}`).join(', ')}`}
            >
              net {net > 0 ? '+' : '−'}{Math.abs(net).toFixed(1)}
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
            {read.positionPull > 0 ? '▲' : '▼'} {read.positionPull > 0 ? '+' : '−'}{Math.abs(read.positionPull).toFixed(1)} slot ({player.position})
          </div>
        )}
      </div>
    </div>
  );
}
