import Link from 'next/link';
import { FREE_AGENCY } from '@/lib/tuning';

/**
 * The offseason is a chain of distinct League.phase values (not one big
 * "OFFSEASON" blob) — this makes that chain visible, since the only other
 * signal was a single phase label in the header that didn't say what came
 * next or that a free agency / draft window existed at all.
 *
 * AND IT NOW SAYS HOW FAR THROUGH THE CURRENT STAGE YOU ARE. Two of these
 * stages take several clicks of Advance and the roadmap gave no sign of it,
 * so the same bar sat under the same label three Advances running and the
 * only honest read was "nothing happened". The app owner: *"lets also show
 * when we advance weeks in the offseason on the roadmap (free agent week #1
 * of 4) or week 2 of resign etc so players can keep track"*.
 *
 * The counts here are NOT decoration and must not drift from lib/season.ts:
 *   OFFSEASON runs OFFSEASON_STEPS, five of them, in TWO advances —
 *     PROGRESS + RESET_STANDINGS + AGE_CONTRACTS, then ADD_DRAFT_CLASS +
 *     RESIGN. See OFFSEASON_ADVANCES there for why they are grouped.
 *   FREE_AGENCY runs a bidding wave per week and opens the draft once the
 *     next week would exceed FREE_AGENCY.WEEKS, which is imported above rather
 *     than copied, because it is a plain number with no grouping in it.
 *   RESIGN, DRAFT and PRESEASON are single windows — RESIGN is one step that
 *     ends when you advance out of it, and the draft's own progress is picks
 *     rather than weeks. A "week 2 of re-sign" would be a number this game
 *     does not have, so the stage says what it actually is instead.
 *
 * LEAGUE.WEEK COUNTS STEPS, THIS BAR COUNTS PRESSES, and in the offseason
 * those are no longer the same number: one press carries a whole group, so the
 * week jumps 1 -> 4 and a bar drawn straight off it would read "step 4 of 2".
 * `advanceSteps` is how many steps each press takes, in order, which is the
 * only thing needed to turn a week back into a press — and it also means a
 * save left mid-offseason by the old one-step-per-press build (week 2, 3 or 5)
 * still lights the press it is actually inside.
 *
 * THE NAMES LOOK FORWARD, because League.week does. `runOffseasonStep` runs
 * the steps from `OFFSEASON_STEPS[week - 1]` onward and moves the week as part
 * of running them, so a league sitting at week 1 has NOT yet aged its rosters —
 * that is what the next Advance will do. Free agency works the same way: week
 * 1 of 3 means the first wave has yet to be bid. So each line here says what
 * the next click brings, phrased from the summaries those steps return, and
 * the roadmap cannot end up describing the same click in a different tense
 * from the advance message.
 */
const STAGES: {
  phase: string;
  label: string;
  desc: string;
  /**
   * Steps each Advance in this stage takes, in order. Length is the number of
   * presses the stage costs; the entries are how many League.week steps each
   * press moves. Absent means one window, not a countdown.
   */
  advanceSteps?: number[];
  /** What each advance in a multi-step stage does. Same order as advanceSteps. */
  stepNames?: string[];
  /** The word for one advance here — the offseason moves in steps, free agency in weeks. */
  unit?: 'step' | 'week';
  /**
   * THE SCREEN WHERE THIS STAGE IS ACTUALLY PLAYED, league-relative.
   *
   * The roadmap named five stages, described what each one was for, sat near
   * the top of the dashboard through every offseason phase — and contained no
   * link of any kind. "Re-sign Window — decide which of your own expiring
   * players to keep" is an instruction with no door under it.
   *
   * Housekeeping has none on purpose: there is no screen for it. It is what
   * pressing Advance does, and inventing a destination for it would be the
   * roadmap naming a button that is not on the screen it links to.
   */
  href?: string;
}[] = [
  {
    phase: 'OFFSEASON',
    label: 'Housekeeping',
    desc: 'Rosters age, standings reset, contracts advance a year.',
    advanceSteps: [3, 2],
    unit: 'step',
    stepNames: [
      'Next: the season is settled — rosters age, careers end, standings and contracts roll',
      'Next: the draft class comes on the board and the re-sign window opens',
    ],
  },
  { phase: 'RESIGN', label: 'Re-sign Window', desc: 'Decide which of your own expiring players to keep before they hit the market.', href: '/resign' },
  {
    phase: 'FREE_AGENCY',
    label: 'Free Agency',
    desc: 'Sign from the league-wide pool — AI teams are bidding too.',
    href: '/free-agency',
    advanceSteps: Array.from({ length: FREE_AGENCY.WEEKS }, () => 1),
    unit: 'week',
    stepNames: [
      'The market is open — the best names go first',
      'Second week of bidding — the market is thinning',
      'Last week before the draft goes on the clock',
    ],
  },
  { phase: 'DRAFT', label: 'Rookie Draft', desc: "Draft this year's incoming class.", href: '/draft' },
  // Not /roster. "Back to football" means the lineup the sim is about to read,
  // and the depth chart is the last thing that is still yours to set before a
  // game counts.
  { phase: 'PRESEASON', label: 'New Season', desc: 'Back to football.', href: '/depth-chart' },
];

/**
 * Which Advance of this stage a League.week falls in, 1-based. Walks the group
 * sizes rather than dividing, since they differ (3 then 2 in the offseason),
 * and clamps at both ends the way lib/season.ts clamps its own step index — a
 * save that ran past the end of the list must not render "step 7 of 2".
 */
function advanceNumberFor(advanceSteps: number[], week: number): number {
  let seen = 0;
  for (let i = 0; i < advanceSteps.length; i++) {
    seen += advanceSteps[i];
    if (week <= seen) return i + 1;
  }
  return advanceSteps.length;
}

export function OffseasonRoadmap({ leagueId, currentPhase, week, seasonYear, startYear }: {
  leagueId: string;
  currentPhase: string;
  /** League.week — 1-based within the current phase. */
  week?: number;
  /**
   * The current league year and the one this save was founded in. Together
   * they are the only way to tell a GM's FIRST preseason from every later one.
   * Both optional so a caller that has neither still renders the roadmap it
   * always did.
   */
  seasonYear?: number;
  startYear?: number | null;
}) {
  const currentIdx = STAGES.findIndex((s) => s.phase === currentPhase);
  if (currentIdx === -1) return null;

  /*
   * A CHECKLIST OF AN OFFSEASON THAT HAPPENED BEFORE HE ARRIVED.
   *
   * On a brand-new save at Preseason Week 1 this is the largest thing above
   * the fold — five stages, all four of the earlier ones drawn as COMPLETE —
   * and not one of them happened. There was no re-sign window, no free agency
   * and no draft; the league was generated into its first preseason. Measured
   * at 1600x1000 it occupied y=180-310 and pushed the Front Office brief, the
   * only two live decisions on the screen, to y=605 with its second item under
   * the fold.
   *
   * Nothing here is reworded, because nothing here is wrong later. It just
   * must not be the first thing a new GM reads. From his second offseason on,
   * those ticks are his own history and the roadmap is worth its place.
   */
  const firstPreseasonOfNewSave = currentPhase === 'PRESEASON'
    && startYear != null
    && seasonYear === startYear;
  if (firstPreseasonOfNewSave) return null;

  const stage = STAGES[currentIdx];
  // Clamped rather than trusted, at both ends: League.week is a step index and
  // lib/season.ts clamps its own reading of it, so a save that ran past the end
  // of the list must not render "step 7 of 2".
  const stepCount = stage.advanceSteps?.length ?? null;
  const stepNow = stage.advanceSteps && week ? advanceNumberFor(stage.advanceSteps, Math.max(week, 1)) : null;
  const stepName = stepNow && stage.stepNames ? stage.stepNames[stepNow - 1] : null;

  return (
    <div className="card card-pad">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="font-semibold">Offseason Roadmap</h2>
        {stepNow !== null && (
          <span className="text-xs text-accent2 font-mono">
            {stage.unit === 'week' ? 'Week' : 'Step'} {stepNow} of {stepCount}
          </span>
        )}
      </div>
      <div className="flex items-stretch gap-1.5">
        {STAGES.map((s, i) => {
          const state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'upcoming';
          /*
           * ONLY THE CURRENT STAGE IS A DOOR, and that is the whole of it.
           *
           * A done stage's window is shut and an upcoming stage's has not
           * opened — /free-agency during RESIGN lists a pool the league has
           * not released yet, and /resign after the window is a page with
           * nothing on it to decide. Linking those would be this component
           * naming a button that is not on the screen it points at, which is
           * a defect this codebase has already had to fix once (see the
           * 'Re-sign him' note in lib/frontOffice.ts). The stage you are
           * standing in is the one with work in it.
           */
          const href = state === 'current' && s.href ? `/league/${leagueId}${s.href}` : null;
          const body = (
            <>
              {/* The current stage's bar is subdivided into its own advances,
                  so progress WITHIN a stage reads at a glance and three
                  Advances in a row stop looking identical. */}
              {state === 'current' && stepCount ? (
                <div className="flex gap-0.5 mb-2">
                  {Array.from({ length: stepCount }).map((_, k) => (
                    <div
                      key={k}
                      className={`h-1.5 flex-1 rounded-full ${k < (stepNow ?? 0) ? 'bg-accent2' : 'bg-accent2/25'}`}
                    />
                  ))}
                </div>
              ) : (
                <div
                  className={`h-1.5 rounded-full mb-2 ${
                    state === 'done' ? 'bg-accent' : state === 'current' ? 'bg-accent2' : 'bg-line'
                  }`}
                />
              )}
              <div className={`text-xs font-semibold truncate ${state === 'current' ? 'text-accent2' : state === 'done' ? 'text-chalk' : 'text-muted'}`}>
                {s.label}
              </div>
              {state === 'current' && (
                <div className="text-xs text-muted mt-0.5 leading-snug">
                  {/* What the next Advance brings, where the stage is a
                      sequence; the stage's standing description otherwise. */}
                  {stepName ?? s.desc}
                  {href && <span className="text-accent2"> →</span>}
                </div>
              )}
            </>
          );
          return href ? (
            <Link
              key={s.phase}
              href={href}
              className="flex-1 min-w-0 block rounded-md -mx-1 px-1 py-0.5 hover:bg-raised transition-colors"
            >
              {body}
            </Link>
          ) : (
            <div key={s.phase} className="flex-1 min-w-0">{body}</div>
          );
        })}
      </div>
    </div>
  );
}
