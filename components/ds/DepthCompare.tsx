import { ratingColor } from '@/lib/ratings';
import { splitStarters, startersAt } from '@/lib/lineup';
import { PlayerAvatar } from '../PlayerAvatar';
import { positionBadgeClass } from './positionColor';

/** One of your own men, exactly as the depth chart has him. No fog: these ratings are true. */
export interface DepthCompareEntry {
  playerId: string;
  name: string;
  ovr: number;
  age: number;
  weightLb?: number;
  heightIn?: number;
}

/**
 * What your scouts will commit to about the free agent.
 *
 * `ovrLow === ovrHigh` for a man whose file is complete; otherwise this is the
 * band `buildScoutedView` returns and the ONLY thing this module is allowed to
 * reason from. His true rating is not passed in, deliberately — a component
 * that cannot see it cannot leak it.
 */
export interface CandidateRating {
  ovrLow: number;
  ovrHigh: number;
  /** True when the band is the real number rather than a guess. Copy only — the math uses the band. */
  revealed: boolean;
}

export interface Candidate {
  playerId: string;
  name: string;
  age: number;
  weightLb?: number;
  heightIn?: number;
  rating: CandidateRating;
}

export type SlotOutcome =
  /** A starting spot at this position is literally vacant — he fills it whatever he is. */
  | 'OPEN'
  /** He starts anywhere in his range, and somebody currently starting does not. */
  | 'STARTER'
  /** He starts at the top of his scouted range and doesn't at the bottom. */
  | 'BORDERLINE'
  /** Behind the starters even at his ceiling. */
  | 'DEPTH'
  /** Nobody starts at this position in the base lineup (a retired position in an old save). */
  | 'NONE';

export interface SlotVerdict {
  outcome: SlotOutcome;
  /** startersAt(position) — lib/lineup.ts, the app's one definition. */
  starterCount: number;
  /** How deep you are at the position right now. */
  depthCount: number;
  /** Depth-chart index he'd take if he came in at the TOP of his scouted range. */
  bestIndex: number;
  /** Depth-chart index he'd take at the BOTTOM of it. Equal to bestIndex when he's fully scouted. */
  worstIndex: number;
  /**
   * The rating he has to MATCH to crack the starting group. Null when a slot is
   * open (he needs nothing) or nobody starts here.
   */
  threshold: number | null;
  /** The man who drops out of the starting group if he slots in above the line. */
  displaces: DepthCompareEntry | null;
  /** ovrLow/ovrHigh minus `threshold`. Sign of `gapHigh` is the badge's verdict, by construction. */
  gapLow: number | null;
  gapHigh: number | null;
  /** His rating is still a band, so the verdict has to be stated as a band too. */
  fogged: boolean;
}

/**
 * WHERE A SIGNING ACTUALLY LANDS ON THE CHART.
 *
 * One past the last listed man who out-rates him. That is not a rule invented
 * here — it is `reconcileDepthChart`'s rule (lib/gen/league.ts), which is what
 * really runs the moment you sign him, and the same rule lib/sim/units.ts
 * applies to an unlisted player. Any other rule would put a number on this
 * screen that the signing then contradicts.
 *
 * It is NOT "count how many of your men out-rate him". Those two agree only
 * while the chart happens to be sorted by rating, and the chart is the user's
 * to order — a GM who benched a 90 for a rookie has a chart where they differ,
 * and the counting version would promise him a starting job the signing does
 * not give.
 */
function insertIndex(depth: DepthCompareEntry[], ovr: number): number {
  let at = 0;
  for (let i = 0; i < depth.length; i++) if (depth[i].ovr > ovr) at = i + 1;
  return at;
}

/**
 * THE SLOT-IN VERDICT. Shared by the panel and the table badge on purpose:
 * two renderings of "would he start" computed twice is how they end up
 * disagreeing on the same screen.
 *
 * @param depth Your men at the position, IN DEPTH-CHART ORDER (from
 *   DepthChartSlot). Not re-sorted here — the order is who plays.
 */
export function slotVerdict(position: string, depth: DepthCompareEntry[], rating: CandidateRating): SlotVerdict {
  const starterCount = startersAt(position);
  const { starters } = splitStarters(position, depth);

  const bestIndex = insertIndex(depth, rating.ovrHigh);
  const worstIndex = insertIndex(depth, rating.ovrLow);
  const fogged = rating.ovrHigh > rating.ovrLow;

  /**
   * The rating he must match to land above the starter line. Falls out of the
   * insertion rule: `insertIndex < starterCount` iff no man from index
   * starterCount-1 downward out-rates him, i.e. iff he matches the best of
   * that tail. Derived rather than asserted so the badge's `gap >= 0` and the
   * panel's "he starts" can never say different things.
   */
  const threshold = depth.length >= starterCount && starterCount > 0
    ? Math.max(...depth.slice(starterCount - 1).map((d) => d.ovr))
    : null;

  // The man who comes off the field. Inserting anywhere above the line pushes
  // the last man in the starting group out of it — him, whoever he is rated.
  // `starters` is the group lib/lineup.ts says is on the field, not "the top
  // one": at WR it is three men and the one who loses his place is the third.
  const displaces = starters.length === starterCount && starterCount > 0 ? starters[starters.length - 1] : null;

  let outcome: SlotOutcome;
  if (starterCount === 0) outcome = 'NONE';
  else if (depth.length < starterCount) outcome = 'OPEN';
  else if (worstIndex < starterCount) outcome = 'STARTER';
  else if (bestIndex < starterCount) outcome = 'BORDERLINE';
  else outcome = 'DEPTH';

  return {
    outcome,
    starterCount,
    depthCount: depth.length,
    bestIndex,
    worstIndex,
    threshold: outcome === 'OPEN' || outcome === 'NONE' ? null : threshold,
    displaces: outcome === 'OPEN' || outcome === 'NONE' ? null : displaces,
    gapLow: threshold !== null && outcome !== 'OPEN' && outcome !== 'NONE' ? rating.ovrLow - threshold : null,
    gapHigh: threshold !== null && outcome !== 'OPEN' && outcome !== 'NONE' ? rating.ovrHigh - threshold : null,
    fogged,
  };
}

const BADGE: Record<SlotOutcome, { text: string; cls: string }> = {
  OPEN: { text: 'Starts', cls: 'border-accent/50 text-accent bg-accent/10' },
  STARTER: { text: 'Upgrade', cls: 'border-accent/50 text-accent bg-accent/10' },
  BORDERLINE: { text: 'Toss-up', cls: 'border-warn/50 text-warn bg-warn/10' },
  DEPTH: { text: 'Depth', cls: 'border-line text-muted' },
  NONE: { text: '—', cls: 'border-line text-muted' },
};

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** The label the depth chart puts on a slot — matches DepthAtPosition's vocabulary. */
function slotLabel(index: number, starterCount: number): string {
  if (index < starterCount) return `ST${starterCount > 1 ? index + 1 : ''}`;
  return `#${index + 1}`;
}

/**
 * The scannable version, for a table cell. Same `SlotVerdict` the panel renders,
 * so a column of these and the panel below them cannot contradict each other.
 *
 * The number beside it is his rating minus the rating he'd have to match to
 * start. It is signed the same way the verdict reads — non-negative means he
 * cracks the lineup — because that is the same comparison, not a second one.
 */
export function SlotVerdictBadge({ verdict }: { verdict: SlotVerdict }) {
  const badge = BADGE[verdict.outcome];
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <span className={`pill ${badge.cls} text-[10px] px-1.5 py-0.5`}>{badge.text}</span>
      {verdict.outcome === 'OPEN' ? (
        <span className="text-[11px] text-muted">slot open</span>
      ) : verdict.gapHigh !== null && verdict.gapLow !== null ? (
        <span
          className="text-[11px] font-mono text-muted"
          title={`Has to match ${verdict.threshold} to start ahead of your current ${verdict.starterCount === 1 ? 'starter' : `${verdict.starterCount} starters`}`}
        >
          {verdict.fogged ? `${signed(verdict.gapLow)}…${signed(verdict.gapHigh)}` : signed(verdict.gapHigh)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * ===========================================================================
 * WHAT AM I STARTING THERE NOW, AND WHERE WOULD THIS MAN SLOT IN?
 * ===========================================================================
 * The app owner's note about free agency: *"It needs to show that and
 * highlight it when you're looking at a free agent and comparing that to
 * whatever your current position is."* The Free Agency page asked you to
 * decide on a receiver while showing you nothing whatsoever about the
 * receivers you already have.
 *
 * WHO STARTS IS NOT DECIDED HERE. `startersAt` / `splitStarters` come from
 * lib/lineup.ts, the app's single definition of the eleven. THREE receivers
 * start and ONE tight end does, so this highlights three rows at WR and one at
 * TE. The "first man is the starter" shortcut is the exact bug this exists to
 * avoid — it is invisible at QB, where one starts and both rules agree, which
 * is how it survived elsewhere.
 *
 * ORDER IS THE DEPTH CHART'S, passed in by the page from `DepthChartSlot` —
 * the same rows the Depth Chart screen renders and the same order the sim
 * plays — so no two screens can disagree about who is ahead of whom.
 *
 * FOG. Your men are yours and their ratings are exact. His may be a band, and
 * this must not resolve it into a single confident number. So the verdict is
 * computed at BOTH ends of the band: if it comes out the same at each end the
 * answer is certain and stated flatly, and if it does not, that is reported as
 * the answer — he starts at the top of his range and doesn't at the bottom,
 * with the rating he has to match named so the reader can judge it.
 *
 * AS OF THE DRAFT-ONLY FOG SCOPE (see lib/scouting.ts), THE ONLY CALLER —
 * Free Agency — PASSES AN UNFOGGED RATING, so `fogged` is false there and
 * every band-shaped branch below is currently unreachable:
 *
 *   - the badge renders one signed number, `+12`, never `+12…+12`. A range
 *     was the thing that made the column unreadable: "+3…+30" spans marginal
 *     to transformative and tells a GM nothing he can act on, whereas "+12"
 *     IS the decision. That collapse falls out of `fogged` on its own; there
 *     is no special case for it and there must not be one.
 *   - BORDERLINE / "Toss-up" cannot occur. It exists only because a band can
 *     straddle the starter line, and a point cannot straddle anything.
 *   - the scout-voice sentence ("your scouts have him between 79 and 87") is
 *     unreachable with it, which is the point: there is no scout's opinion to
 *     quote about a man with five years of tape.
 *
 * The band branches are KEPT rather than deleted, deliberately. They are the
 * correct rendering for a prospect, and "would this rookie start for us?" is a
 * panel the draft board has an obvious use for; wiring one up would need this
 * file to already know how to say "depends where he really is". Unreachable
 * from today's one call site is not the same as wrong.
 */
export function DepthCompare({ position, depth, candidate }: {
  position: string;
  /** In depth-chart order. */
  depth: DepthCompareEntry[];
  candidate: Candidate;
}) {
  const { rating } = candidate;
  const v = slotVerdict(position, depth, rating);
  const label = (i: number) => slotLabel(i, v.starterCount);
  const ratingText = v.fogged ? `${rating.ovrLow}-${rating.ovrHigh}` : String(rating.ovrHigh);
  // Colour a band by its floor: the honest reading of "at least this good".
  const ratingCls = ratingColor(rating.ovrLow);
  const him = <span className="font-semibold">{candidate.name}</span>;
  const his = <span className={`stat-value ${ratingCls}`}>{ratingText}</span>;

  return (
    <div className="panel p-3 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="label-sm">
          Your depth at <span className={positionBadgeClass(position)}>{position}</span> vs. {candidate.name}
        </div>
        <div className="text-xs text-muted">
          {v.starterCount === 0
            ? 'nobody starts here in the base lineup'
            : `${v.starterCount} start${v.starterCount === 1 ? 's' : ''} at this position`}
        </div>
      </div>

      {/* The sentence the list is evidence for. */}
      <p className="text-sm">
        {v.outcome === 'NONE' ? (
          <>Nobody starts at {position} in the base lineup, so signing {him} changes nothing about who is on the field.</>
        ) : v.outcome === 'OPEN' ? (
          v.depthCount === 0 ? (
            <>You have <span className="text-bad font-semibold">nobody</span> at {position} and the base lineup needs {v.starterCount}. {him} starts by default the week he signs, whatever he turns out to be.</>
          ) : (
            <>You are short at {position} — {v.depthCount} on the roster for {v.starterCount} starting spot{v.starterCount === 1 ? '' : 's'}. {him} fills a <span className="text-accent font-semibold">vacant</span> one and displaces nobody.</>
          )
        ) : v.outcome === 'STARTER' ? (
          <>
            {him} at {his} slots in at <span className="font-semibold">{label(v.bestIndex)}</span>
            {v.fogged && v.worstIndex !== v.bestIndex ? <> to <span className="font-semibold">{label(v.worstIndex)}</span> — he starts wherever in that range he lands</> : <> and <span className="text-accent font-semibold">starts</span></>}
            .{' '}
            {v.displaces ? (
              <><span className="font-semibold">{v.displaces.name}</span> (<span className={`stat-value ${ratingColor(v.displaces.ovr)}`}>{v.displaces.ovr}</span>) drops out of your starting {v.starterCount === 1 ? 'spot' : v.starterCount}.</>
            ) : null}
          </>
        ) : v.outcome === 'BORDERLINE' ? (
          <>
            <span className="text-warn font-semibold">Depends where he really is.</span> Your scouts have {him} between{' '}
            <span className={`stat-value ${ratingColor(rating.ovrLow)}`}>{rating.ovrLow}</span> and{' '}
            <span className={`stat-value ${ratingColor(rating.ovrHigh)}`}>{rating.ovrHigh}</span>, and he has to match{' '}
            <span className="stat-value">{v.threshold}</span> to crack your starting {v.starterCount === 1 ? 'spot' : v.starterCount}. At the top of that range he comes in at{' '}
            <span className="font-semibold">{label(v.bestIndex)}</span>
            {v.displaces ? <> and <span className="font-semibold">{v.displaces.name}</span> loses the job</> : null}; at the bottom he is your{' '}
            <span className="font-semibold">{label(v.worstIndex)}</span> and starts nothing.
          </>
        ) : (
          <>
            {him} at {his} does <span className="font-semibold">not</span> crack your starting {v.starterCount === 1 ? 'spot' : v.starterCount}
            {v.fogged ? <> — not even at the top of his range</> : null}. He slots in at{' '}
            <span className="font-semibold">{label(v.bestIndex)}</span>
            {v.fogged && v.worstIndex !== v.bestIndex ? <> to <span className="font-semibold">{label(v.worstIndex)}</span></> : null}
            , behind {v.starterCount === 1 ? 'your starter' : v.starterCount === 2 ? 'both of your starters' : `all ${v.starterCount} of your starters`}
            {v.threshold !== null ? <>; he would need <span className="stat-value">{v.threshold}</span> to get on the field</> : null}. Depth, not a starter.
          </>
        )}
      </p>

      <div className="space-y-1">
        {Array.from({ length: depth.length + 1 }).map((_, i) => {
          const d = i < depth.length ? depth[i] : null;
          const starts = i < v.starterCount;
          const showBench = i === v.starterCount && v.starterCount > 0 && i < depth.length;
          // He is drawn where he would land at his ceiling; the range on his
          // rank tells the reader how far that could slide.
          const showCandidate = i === Math.min(v.bestIndex, depth.length);
          // The men his scouted band straddles — his own place among them is
          // exactly what is not known yet.
          const inHisRange = d !== null && v.fogged && i >= v.bestIndex && i < v.worstIndex;

          return (
            /* px-1 pays back the rows' own -mx-1 bleed. Without it this
               wrapper's box is 8px narrower than the row inside it and the
               panel reports a sideways overflow — the shape of bug the app
               owner has caught on this app before. */
            <div key={d ? d.playerId : '__fa_tail'} className="px-1">
              {/* Where the lineup ends — the same marker the depth chart's own
                  position card draws. At WR, three rows sit above it. */}
              {showBench && (
                <div className="flex items-center gap-2 pt-1.5 pb-1">
                  <span className="label-sm text-[10px]">Bench</span>
                  <span className="h-px flex-1 bg-line/70" />
                </div>
              )}

              {showCandidate && (
                <div className="flex items-center gap-2.5 px-2 py-1.5 -mx-1 rounded-lg border-l-2 border-dashed border-accent bg-accent/10 ring-1 ring-accent/30">
                  {/* The arrow marks this as a WOULD-BE slot. Without it his
                      "#4" sits directly above an incumbent's real "#4" and the
                      two read as a contradiction — the incumbents keep the
                      labels they hold today, because a fogged man's arrival
                      does not tell you where they end up. */}
                  <span className="label-sm w-16 shrink-0 text-accent">
                    →{' '}
                    {v.outcome === 'NONE'
                      ? '—'
                      : v.bestIndex === v.worstIndex
                        ? label(v.bestIndex)
                        : `${label(v.bestIndex)}–${label(v.worstIndex)}`}
                  </span>
                  <PlayerAvatar seed={candidate.playerId} age={candidate.age} size={24} weightLb={candidate.weightLb} heightIn={candidate.heightIn} position={position} />
                  <span className="flex-1 truncate text-sm font-semibold">
                    {candidate.name} <span className="text-muted font-normal">— free agent</span>
                  </span>
                  <span className="text-xs text-muted w-10 text-right">{candidate.age}yo</span>
                  <span className={`stat-value text-stat-sm w-14 text-right ${ratingCls}`}>{ratingText}</span>
                </div>
              )}

              {d && (
                <div
                  className={`flex items-center gap-2.5 px-2 py-1.5 -mx-1 rounded-lg border-l-2 ${
                    starts ? 'bg-chalk/[0.05] border-accent2/70' : 'border-transparent opacity-80'
                  } ${inHisRange ? 'ring-1 ring-warn/25' : ''}`}
                >
                  <span className={`label-sm w-16 shrink-0 ${starts ? 'text-chalk' : ''}`}>{label(i)}</span>
                  <PlayerAvatar seed={d.playerId} age={d.age} size={24} weightLb={d.weightLb} heightIn={d.heightIn} position={position} />
                  <span className={`flex-1 truncate text-sm ${starts ? 'font-semibold' : ''}`}>
                    {d.name}
                    {v.displaces?.playerId === d.playerId && (v.outcome === 'STARTER' || v.outcome === 'BORDERLINE') ? (
                      <span className={`ml-1.5 text-xs ${v.outcome === 'STARTER' ? 'text-bad' : 'text-warn'}`}>
                        {v.outcome === 'STARTER' ? '— loses the job' : '— job at risk'}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted w-10 text-right">{d.age}yo</span>
                  <span className={`stat-value text-stat-sm w-14 text-right ${ratingColor(d.ovr)}`}>{d.ovr}</span>
                </div>
              )}
            </div>
          );
        })}

        {depth.length === 0 && (
          <div className="text-sm text-muted px-2 py-1.5">Nobody on the roster at {position}.</div>
        )}
      </div>
    </div>
  );
}
