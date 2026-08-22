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
 * The step counts here are NOT decoration and must not drift from
 * lib/season.ts:
 *   OFFSEASON runs OFFSEASON_STEPS, five of them, indexed by League.week.
 *   FREE_AGENCY runs a bidding wave per week and opens the draft once
 *     `nextWeek > 4`, so four.
 *   RESIGN, DRAFT and PRESEASON are single windows — RESIGN is one step that
 *     ends when you advance out of it, and the draft's own progress is picks
 *     rather than weeks. A "week 2 of re-sign" would be a number this game
 *     does not have, so the stage says what it actually is instead.
 *
 * THE NAMES LOOK FORWARD, because League.week does. `runOffseasonStep` runs
 * `OFFSEASON_STEPS[week - 1]` and increments the week as part of running it,
 * so a league sitting at week 1 has NOT yet aged its rosters — that is what
 * the next Advance will do. Free agency works the same way: week 1 of 4 means
 * the first wave has yet to be bid. So each line here says what the next click
 * brings, phrased from the summaries those steps return, and the roadmap
 * cannot end up describing the same click in a different tense from the
 * advance message.
 */
const STAGES: {
  phase: string;
  label: string;
  desc: string;
  /** Advances this stage takes. Absent means one window, not a countdown. */
  steps?: number;
  /** What each advance in a multi-step stage does. Same order as League.week. */
  stepNames?: string[];
  /** The word for one advance here — the offseason moves in steps, free agency in weeks. */
  unit?: 'step' | 'week';
}[] = [
  {
    phase: 'OFFSEASON',
    label: 'Housekeeping',
    desc: 'Rosters age, standings reset, contracts advance a year.',
    steps: 5,
    unit: 'step',
    stepNames: [
      'Next: rosters age a year — some careers end here',
      'Next: standings reset for the new league year',
      'Next: contracts advance a year',
      'Next: the incoming draft class arrives',
      'Next: the re-sign window opens',
    ],
  },
  { phase: 'RESIGN', label: 'Re-sign Window', desc: 'Decide which of your own expiring players to keep before they hit the market.' },
  {
    phase: 'FREE_AGENCY',
    label: 'Free Agency',
    desc: 'Sign from the league-wide pool — AI teams are bidding too.',
    steps: 4,
    unit: 'week',
    stepNames: [
      'The market is open — the best names go first',
      'Second week of bidding',
      'Third week — the market is thinning',
      'Last week before the draft goes on the clock',
    ],
  },
  { phase: 'DRAFT', label: 'Rookie Draft', desc: "Draft this year's incoming class." },
  { phase: 'PRESEASON', label: 'New Season', desc: 'Back to football.' },
];

export function OffseasonRoadmap({ currentPhase, week }: {
  currentPhase: string;
  /** League.week — 1-based within the current phase. */
  week?: number;
}) {
  const currentIdx = STAGES.findIndex((s) => s.phase === currentPhase);
  if (currentIdx === -1) return null;

  const stage = STAGES[currentIdx];
  // Clamped rather than trusted: League.week is the offseason step index and
  // lib/season.ts itself clamps it (`Math.min(league.week - 1, ...)`), so a
  // save that ran past the end of the list must not render "step 7 of 5".
  const stepNow = stage.steps && week ? Math.min(Math.max(week, 1), stage.steps) : null;
  const stepName = stepNow && stage.stepNames ? stage.stepNames[stepNow - 1] : null;

  return (
    <div className="card card-pad">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="font-semibold">Offseason Roadmap</h2>
        {stepNow !== null && (
          <span className="text-xs text-accent2 font-mono">
            {stage.unit === 'week' ? 'Week' : 'Step'} {stepNow} of {stage.steps}
          </span>
        )}
      </div>
      <div className="flex items-stretch gap-1.5">
        {STAGES.map((s, i) => {
          const state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'upcoming';
          return (
            <div key={s.phase} className="flex-1 min-w-0">
              {/* The current stage's bar is subdivided into its own advances,
                  so progress WITHIN a stage reads at a glance and three
                  Advances in a row stop looking identical. */}
              {state === 'current' && stage.steps ? (
                <div className="flex gap-0.5 mb-2">
                  {Array.from({ length: stage.steps }).map((_, k) => (
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
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
