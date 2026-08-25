import { Rng, clamp } from '../rng';
import { AI, CAP, ROSTER_TARGETS, ROSTER_NEED_QUALITY_WEIGHT, MARKET, Position, POSITIONS, PICK_VALUE_CHART, LEAGUE, TRADE_VALUE, TRADE_VALUE_TIER } from '../tuning';
import { GmProfile } from '../types';
import { askingPrice, marketValue, remainingValue, capHit, proration, capSavingsOnCut, formatMoney, ContractLike } from '../cap';
import { startersAt } from '../lineup';
import { REPLACEMENT_LEVEL } from '../sim/units';
import { CapMode } from '../types';
import { readJson } from '../json';
import { assertNoProfitableConversion, relatedPositions, positionMove, attrsForPosition, computeOverall } from '../ratings';
import { carriesDepth, positionSaturation } from '../rosterConstruction';

/**
 * A POSITION CHANGE MAY NOT PAY FOR ITSELF.
 *
 * lib/ratings.ts offers a menu of position changes and they are reversible,
 * so if moving a man to a position the market pays more for makes him worth
 * more, the game is a money printer: buy the cheap label, convert, sell the
 * dear one. It was live and measured at 6.60x on the tier table this
 * recalibration replaced — the same 94-rated man priced 115 as a right tackle
 * and 759 as a left tackle, for a move that cost him nothing.
 *
 * THIS IS THE ONE MODULE THAT READS TRADE_VALUE_TIER, so this is where the
 * check belongs, and it is CALLED here rather than merely exported: an
 * assertion nothing runs is a comment that lies. It runs at import rather
 * than per-valuation because it is a statement about constant tables, and it
 * throws rather than warns for the same reason lib/lineup.ts throws on an
 * eleven-man sum that isn't eleven — a silent free arbitrage is worse than a
 * failed boot. (lib/ratings.ts cannot run it itself: lib/tuning.ts is
 * upstream of it and the cycle would break the build.)
 *
 * The assertion is OUTCOME-BASED, not a table comparison: lib/ratings.ts
 * charges a conversion in rating points for the parts of the new job nobody
 * has ever coached him in, so two connected positions may legitimately price
 * differently as long as the rating cost covers the gap. What this passes in
 * is the trade curve — `valueAt` is TRADE_VALUE.TIER_CURVE and nothing else,
 * so what gets checked is exactly the table below, and the synthetic player
 * is built the way lib/ratings.ts builds one so the two agree on what a
 * conversion costs.
 *
 * THE TABLE IS NO LONGER TRIVIALLY SAFE, so this is no longer a formality.
 * LB sits a tier below EDGE — off-ball linebacker pay is 0.73 against an edge
 * rusher's 1.47 and the trade table used to disagree with that — and the only
 * thing making that legal is that LB -> EDGE genuinely costs a linebacker the
 * rating, because `passRush` is 0.36 of an edge rusher's overall and he has
 * never been graded on it. Remove the fill-down in `convertedAttributes` and
 * this throws at 77 OVR. Price LB at MINIMAL instead and it throws at 88, the
 * fill having bottomed out (its seed floors at 20, it does not reach zero).
 * Both were checked; it is the live constraint on that split, not a comment.
 *
 * AND IT IS STILL NOT THE WHOLE CONSTRAINT, which is worth knowing before
 * trusting it too far. `valueAt` here is the raw tier curve, but the number
 * this file actually trades on is (base + upside) x age x contract x fit, and
 * `maxOvrAfterConversion` can only equalise the first term. Two things leak
 * past it, both measured on live rosters: the CEILING (fixed — lib/ratings.ts
 * now moves `potential` with the rating), and the CONTRACT, which re-prices a
 * man's existing deal against the destination's MARKET.POSITION_MULT with no
 * conversion cost able to touch it. The second is why relabelling a left
 * guard a left tackle — a move that costs almost no rating at all, the two
 * weighting the identical five attributes, and that passes this assertion
 * trivially since both are PREMIUM — is profitable for 5,329 of the 9,106
 * guards on this box, up to +1,039 points. That is the largest free
 * arbitrage in the game by an order of magnitude, it is driven by
 * MARKET.POSITION_MULT (LT 1.29 against LG 0.85) rather than by anything in
 * TRADE_VALUE_TIER, and it is not in this table. Do not read a pass here as
 * "conversions are safe".
 *
 * Every other connected pair still shares a tier, and for the ones with
 * identical attribute sets (LT/RT/LG/RG, EDGE/DT) it MUST — the engine has no
 * lever to charge a move it cannot see.
 */
const tierCurveOf = (pos: Position, ovr: number): number => {
  const c = TRADE_VALUE.TIER_CURVE[TRADE_VALUE_TIER[pos]];
  return Math.min(c.ceiling, (Math.exp(Math.max(0, ovr - c.replacementLevel) * c.steepness) - 1) * c.scale);
};
assertNoProfitableConversion(tierCurveOf, (from, to, ovr) => {
  const attrs: Record<string, number> = {};
  for (const key of attrsForPosition(from)) attrs[key] = ovr;
  return positionMove({ position: from, trueOvr: computeOverall(from, attrs), trueAttrs: attrs }, to).ovr;
});

/**
 * AND THE AGE MULTIPLIER IS PART OF A MAN'S PRICE, so it is bound by the same
 * rule. This one cannot go through the assertion above, which only sees trade
 * value at a rating: two positions can sit on the same tier and still age on
 * different curves, and a 33-year-old left tackle relabelled a guard would
 * then escape the receivers' decline and get more valuable for it. That was
 * measured at 1.10x mean and 2.49x at worst. Connected positions must share
 * an AGE_ARC, full stop, so that is checked directly.
 */
for (const from of POSITIONS) {
  for (const to of relatedPositions(from)) {
    if (TRADE_VALUE.AGE_ARC[from] !== TRADE_VALUE.AGE_ARC[to]) {
      throw new Error(
        `lib/tuning.ts: ${from} and ${to} can be converted between but age on different curves `
        + `(${TRADE_VALUE.AGE_ARC[from]} vs ${TRADE_VALUE.AGE_ARC[to]}) — the age multiplier is part of a `
        + `man's price, so that is a free arbitrage for anyone with an old player at the cheaper arc. `
        + `Put them on the same TRADE_VALUE.AGE_ARC, or remove the adjacency in lib/ratings.ts.`,
      );
    }
  }
}

/**
 * ===========================================================================
 * AI GENERAL MANAGER
 * ===========================================================================
 * One shared brain used by free agency, trades and the draft, so an AI team
 * behaves consistently across all three. Everything flows from two things:
 *
 *   NEED    — how thin is this roster at each position, right now
 *   PROFILE — this franchise's personality (win-now vs rebuilding, how much
 *             it loves picks, how aggressive it is)
 *
 * [TUNE] The AI is deliberately imperfect: valuations get a noise term and it
 * will occasionally reach in the draft. A perfectly rational AI is unbeatable
 * and boring.
 * ===========================================================================
 */

export interface RosterPlayer {
  id: string;
  position: string;
  trueOvr: number;
  age: number;
  potential: number;
  /** Optional — only trade-value pricing needs this. Free agents/rookie-pool players naturally have none. */
  contract?: ContractLike | null;
  /**
   * Weeks he has spent on the wire, for the men who are on it. Absent (or 0)
   * for anybody on a roster, which is the same thing as far as `maxOffer` is
   * concerned: a player under contract has no ask to discount. See
   * askingPrice in lib/cap.ts.
   */
  weeksUnsigned?: number;
}

/**
 * A club's front-office temperament.
 *
 * `strength` is the roster it is about to be handed, in rating points around
 * the league mean (roughly -6..+6). It is optional, and passing it is what
 * stops a club's DECLARED WINDOW being unrelated to the team it actually has:
 * before, `winNow` was an independent dice roll made before any player
 * existed, so the league routinely produced a 4-12 roster whose GM was
 * flagged WIN-NOW and a stacked contender that read REBUILDING. Every system
 * that reads `winNow` — trade pricing, free agency, draft lean — was being
 * told something about the club that its own roster contradicted.
 *
 * The tilt is deliberately noisy rather than a straight mapping. A bad team
 * with an impatient owner is a real thing and a good story; a league where
 * record dictates attitude exactly is neither.
 */
export function defaultGmProfile(rng: Rng, strength?: number): GmProfile {
  /*
   * THE OPENING WINDOW IS SQUASHED, NOT CLAMPED, and this is the clamp on this
   * number that actually bit. Measured over 400,000 draws at the spread the
   * generator produces, `clamp(tilt, 0.05, 0.95)` put 2.79% of clubs on
   * 0.05 exactly and 2.85% on 0.95, against neighbouring buckets holding
   * about 0.4% each — so on the day a league was created the two most extreme
   * postures in the game were also two of its most common. It now goes through
   * the same squash `recomputeWinNow` uses, because it is the same quantity
   * one season early and should not be shaped differently. The draw itself is
   * untouched, so nothing else the generator produces moves.
   *
   * The three fields around it are still clamped and that is a decision, not
   * an oversight: they answer a different question from the club's window, and
   * re-shaping them would move every trade tendency and pick preference in the
   * game. They pile too, at between 0.6% and 1.3% on each wall, which is worth somebody's afternoon and
   * is not what this change is about.
   */
  const tilt = strength === undefined
    ? rng.normal(0, 0.22)
    : strength / 14 + rng.normal(0, 0.1);
  return {
    aggression: clamp(rng.normal(0.5, 0.18), 0.05, 0.95),
    winNow: 0.5 + 0.5 * Math.tanh(tilt / AI.WINDOW.OPENING_SPAN),
    valuePicks: clamp(rng.normal(0.5, 0.2), 0.05, 0.95),
    bpaBias: clamp(rng.normal(0.55, 0.18), 0.05, 0.95),
  };
}

export function parseGmProfile(raw: string | null | undefined, fallbackRng?: Rng): GmProfile {
  const parsed = readJson<Partial<GmProfile>>(raw, {});
  const base = fallbackRng ? defaultGmProfile(fallbackRng) : { aggression: 0.5, winNow: 0.5, valuePicks: 0.5, bpaBias: 0.55 };
  return { ...base, ...parsed };
}

/**
 * WHAT COUNTS AS AN ACCEPTABLE STARTER.
 *
 * This was one flat 72 for every position on the field, which is how a club
 * whose starting QUARTERBACK was a 72 came back scoring 0.00 — stacked. The
 * owner hit the consequence: a win-now club with $108M of room and a 68 at
 * quarterback turned down a legitimate starter, because as far as this
 * function was concerned it did not need one.
 *
 * MY FIRST FIX DERIVED THE BAR FROM MARKET.POSITION_MULT, and measuring it
 * showed that was the wrong quantity. A starter's rating tracks how many men
 * a club rosters at the position, not what the position is paid: measured over
 * 160 clubs, receivers (six deep) median 83 while interior linemen (paid less
 * but rostered thinner) median 80, and linebackers median 81 against guards'
 * 79. Pay and starter quality are simply different axes, so a bar derived from
 * one did not track the other — it left only 3-7% of clubs reading as needing
 * help at most positions, which is a need signal that is almost always zero.
 *
 * Anchored to the measured distribution instead. Across five generated
 * leagues the median starter at EVERY non-specialist position lands between
 * 79 and 83, and 53% of all starters are 80+. So 80 is what a starter is, and
 * the owner's read — "any position outside of specialist you'd ideally want at
 * least 80+" — is what the data already says.
 *
 * Three numbers, because the data supports three and not seventeen:
 *   QB          the one position that decides games on its own, and the one
 *               whose median starter is genuinely higher (86). A club with an
 *               80 at quarterback has a problem; a club with an 80 at right
 *               guard does not.
 *   SPECIALIST  kickers and punters sit ~8 points lower as a population
 *               (median 73), so holding them to 80 would mark every club in
 *               the league as needing one.
 *   everyone else at 80.
 * [TUNE]
 */
const ACCEPTABLE_STARTER = 80;
const ACCEPTABLE_STARTER_QB = 84;
const ACCEPTABLE_STARTER_SPECIALIST = 72;

/**
 * [TUNE] How far below the bar is "desperate". At 30 a quarterback had to be
 * thirty points under it — a 50 overall — before his club read as desperate,
 * which no front office would recognise. At 18, a 68 at a position that wants
 * 80 scores 0.67, which is what the owner means when he says a 68 back is bad.
 */
const STARTER_GAP_DIVISOR = 18;

export function acceptableStarter(pos: Position): number {
  if (pos === 'QB') return ACCEPTABLE_STARTER_QB;
  if (pos === 'K' || pos === 'P') return ACCEPTABLE_STARTER_SPECIALIST;
  return ACCEPTABLE_STARTER;
}

/**
 * Need score per position, 0 (stacked) .. 1 (desperate).
 * Combines "do we have enough bodies" with "is the starter any good" — and
 * then with "how many of him are we already carrying", which is the term that
 * was missing.
 *
 * ===========================================================================
 * WHY A THIRD TERM, AND WHY IT IS A MULTIPLIER
 * ===========================================================================
 * The first two terms only ever look DOWNWARD: below the roster minimum is an
 * emergency, and a poor starter is a hole. Neither can see a club that already
 * has too many. So a club carrying five quarterbacks behind a 78 still scored
 * `(84 - 78) / 18 * 0.75 = 0.25` at quarterback — over free agency's 0.15 bid
 * gate — and went shopping for a sixth. The same arithmetic is why the
 * OFFENSIVE LINE was the worst offender in the database after quarterback:
 * `acceptableStarter` is 80 there and interior linemen genuinely median 79-80
 * (measured, see the note on that constant), so a large share of clubs sit
 * permanently just under the bar at five separate positions, score a standing
 * quality need at each, and keep buying linemen. Measured across every club in
 * every league in the dev database, 1,595 clubs were over `max` at some line
 * spot and 1,160 of those were carrying more than ten offensive linemen in
 * total — bloat, not a reshuffle. One roster held twenty-five.
 *
 * A MULTIPLIER RATHER THAN A SUBTRACTED TERM because "we have plenty" does not
 * cancel out "our starter is bad" — it makes the whole reading irrelevant. A
 * club with eleven receivers does not half-want a receiver; it does not want
 * one, whatever the twelfth-best one on the roster grades. Multiplying also
 * keeps the output in its documented 0..1 range with no re-clamping, so every
 * existing consumer (free agency's 0.15 bid gate, `maxOffer`'s overpay term,
 * the draft board, the roster-needs widget) reads the same scale it always did.
 *
 * IT REACHES EVERY ACQUISITION PATH BY CONSTRUCTION, which is the point:
 * lib/freeagency.ts calls into this file through exactly two functions, this
 * one and `maxOffer`, so the wave's bid gate, the in-season signings, the
 * minimum-roster fill and the user's own "Fill Roster" button all inherit the
 * same notion of a full room without a line changing over there.
 * ===========================================================================
 */
/**
 * Takes the two fields it actually reads rather than a whole RosterPlayer, so
 * a caller that only needs this answer can select two columns instead of six.
 * Every existing caller still satisfies it — a RosterPlayer is one of these.
 */
export function teamNeeds(players: Pick<RosterPlayer, 'position' | 'trueOvr'>[]): Record<string, number> {
  const needs: Record<string, number> = {};
  for (const pos of POSITIONS) {
    const group = players
      .filter((p) => p.position === pos)
      .sort((a, b) => b.trueOvr - a.trueOvr);
    const target = ROSTER_TARGETS[pos];

    // Quantity need: below the minimum is an emergency.
    const countNeed = clamp((target.min - group.length) / Math.max(1, target.min), 0, 1);

    // Quality need: how far the starter is below a fine starter AT THIS
    // POSITION — see acceptableStarter above for why that is not one number.
    const starter = group[0]?.trueOvr ?? 40;
    const qualityWeight = ROSTER_NEED_QUALITY_WEIGHT[pos] ?? 1;
    const qualityNeed = clamp((acceptableStarter(pos) - starter) / STARTER_GAP_DIVISOR, 0, 1) * qualityWeight;

    // Depth need: second body matters more at high-snap positions. Positions
    // that only ever roster one player (K, P) never carry a "backup" — that's
    // not a hole, it's the position, so skip this term entirely for them.
    //
    // ASKED OFF `ONE_MAN_JOB`, NOT OFF `target.max > 1`, and that is not a
    // cosmetic swap. `max` is the roster CEILING and this is a question about
    // whether a bench plays; the two happened to agree only because K and P
    // are the one place the answers coincide, and reading one off the other
    // meant any change to the ceiling silently rewrote this. Behaviour is
    // identical today by construction — every other position has max >= 2 —
    // and scripts/_rc_probe.ts asserts that position by position.
    const backup = group[1]?.trueOvr ?? 40;
    const depthNeed = carriesDepth(pos) ? clamp((62 - backup) / 30, 0, 1) * 0.4 : 0;

    // How full the room already is. See the block above this function, and
    // lib/rosterConstruction.ts for the curve and the football argument.
    const saturation = positionSaturation(pos, group.length);

    needs[pos] = clamp(countNeed * 1.4 + qualityNeed * 0.75 + depthNeed, 0, 1) * saturation;
  }
  return needs;
}

/**
 * Human read on a need score for display — a bare "44%" answers a question
 * nobody asked ("44% of what?"); a GM wants "how urgent is this," not a
 * fraction. [TUNE] thresholds chosen against teamNeeds' own scale.
 */
// Display-only: the label and Tailwind class a need renders with. Never
// feeds an AI decision — the raw 0..1 score does that. Each tier gets its
// own color; two tiers sharing one made the distinction invisible.
export function needSeverity(score: number): { label: string; className: string } {
  if (score >= 0.6) return { label: 'Urgent', className: 'text-bad' };
  if (score >= 0.35) return { label: 'High', className: 'text-warn' };
  if (score >= 0.15) return { label: 'Moderate', className: 'text-accent2' };
  return { label: 'Notable', className: 'text-muted' };
}

/**
 * ===========================================================================
 * UPGRADE OVER THE INCUMBENT — "IS HE BETTER THAN WHAT I ALREADY HAVE?"
 * ===========================================================================
 * `teamNeeds` above answers exactly one question — DO I HAVE A HOLE? — and it
 * answers it well. What it cannot answer, and was never shaped to, is the
 * question a real front office actually asks about a good player: is he
 * better than the man I would put on the field instead of him?
 *
 * Those are not the same question, and treating them as one produced the bug
 * this exists to fix. `teamNeeds`' quality term is `(72 - starter) / 30`,
 * which is flat zero for any starter at 72 or better — so a club with a 72
 * right tackle and a club with a 90 right tackle were indistinguishable, and
 * because `TRADE_VALUE.NEED_MULT_MIN` is below 1, "no need" is not a shrug,
 * it is an active DISCOUNT — it was 0.72 when this was written, so an 88
 * offered to a club starting a 78 came back priced at 72% of his worth. The
 * club did not merely fail to want him; it marked him down. (The floor has
 * since been raised to 0.85 as part of the Jimmy Johnson recalibration; the
 * bug this block fixes is unchanged, only its severity.)
 *
 * The fix is a second, separate signal rather than a wider `teamNeeds`:
 *
 *   - `teamNeeds` stays single-purpose, so the position-flexibility work that
 *     also reads it (a club with three tackles and no guard) has a clean
 *     function to reason about, and so free agency and the draft board see
 *     exactly the numbers they see today.
 *   - This asks the OTHER question, off the same roster.
 *
 * They are blended at the point of use (see `playerValueDetailed`) by taking
 * the LARGER of the two, because they are two readings of one axis — "how
 * much does this man improve us" — and a club with nobody at a position both
 * has a hole and would be hugely upgraded. Taking the max cannot reach past
 * the bounded multiplier it feeds: this fix stops the AI DISCOUNTING obvious
 * upgrades, it does not hand it a new way to overpay.
 *
 * WHO THE INCUMBENT IS. Not "the best man at the position" — the man who
 * actually loses the job. `startersAt` (lib/lineup.ts) is the single
 * definition of how many play at each spot, and it is read, not re-derived:
 * three receivers start, so an 88 arriving at a club with 90/85/80/75 is not
 * measured against the 90 or the 85, he is measured against the 80, because
 * the 80 is who comes off the field. That is also why a fourth receiver is a
 * smaller gain than a starter — he displaces nobody who plays.
 *
 * AND IT WORKS IN BOTH DIRECTIONS, which is the property that keeps the AI
 * honest about what it gives up. A player already on this roster is removed
 * from the group before the comparison, so the same arithmetic that asks
 * "how much better is he than our starter" of an incoming player asks "how
 * far do we drop if he leaves" of an outgoing one. Without that, a club
 * valuing its OWN starting tackle would have found him sitting behind
 * himself, called him a backup, and sold him cheap.
 * ===========================================================================
 */

/**
 * [TUNE] Shape of the upgrade curve. Deliberately saturating: a roster fields
 * ONE man at a slot, so the second ten points of an upgrade cannot be worth
 * what the first ten were — +25 lands at roughly 1.6x the score of +10, not
 * 2.5x. And the sharpness keeps small gains near nothing, so a club with an
 * 85 does not get talked into paying up for an 86.
 */
const UPGRADE = {
  /** Snap-weighted rating points that score half of everything this term can give. */
  HALF_GAIN: 10,
  /** >1 flattens the bottom of the curve — +1 must not read as a tenth of +10. */
  SHARPNESS: 1.6,
  /**
   * Share of the snaps the men BEHIND the starters actually take, first man
   * off the bench then second. A backup is worth something — starters get
   * hurt — but an order of magnitude less than the job itself, which is the
   * whole of "acquiring a starter is worth more than acquiring a fourth
   * receiver of the same rating". Past the second man a player is roster
   * insurance rather than a contributor and is not counted at all.
   *
   * Sized against reality rather than to taste: a swing tackle or a backup
   * corner plays on the order of a tenth of a team's snaps. An earlier draft
   * of this used 0.3 for the first bench slot and it was visibly too generous
   * — it made an 88 offered to a club starting an 89 (who would bench him)
   * score HIGHER than the same 88 offered to a club starting an 84 (who would
   * play him), because the deep backup he'd leapfrog was so much worse than
   * either starter.
   */
  DEPTH_SNAP_WEIGHTS: [0.12, 0.02],
};

/**
 * [TUNE] How a club's own cap position colours what a contract is worth TO
 * IT. See the cap block in `playerValueDetailed`.
 *
 * Deliberately asymmetric. Acquiring reaches much further down than shedding
 * reaches up, because "we cannot fit this contract" is a hard fact about a
 * club's sheet while "we would quite like the relief" is only ever a
 * preference — and because the hard version of the first is already enforced
 * at execution by assertCapRoom, so an unbounded discount here would just be
 * the same refusal charged twice.
 */
const CAP_FIT = {
  /** Room above which a club has no cap-driven reason to shed salary at all. */
  COMFORT_SPACE: 25_000_000,
  /** A contract inside this share of a club's room costs it nothing to think about. */
  FREE_SHARE: 0.25,
  /** At this share (i.e. it does not fit) the acquiring discount is at full strength. */
  FULL_SHARE: 1.25,
  ACQUIRE_MULT_MIN: 0.6,
  SHED_MULT_MIN: 0.88,
};

export interface RosterFit {
  /** 0..1 — the curved, position-weighted read of `gain`. This is what moves value. */
  score: number;
  /**
   * Snap-weighted rating points he adds to the club's depth chart at his
   * position: the whole ladder after he arrives minus the whole ladder
   * before, with each slot weighted by how much it actually plays. A pure
   * starting upgrade of +10 comes out at 10; the same man arriving as a
   * fourth receiver comes out at a fraction of it.
   */
  gain: number;
  /** The man whose job he takes — the last starter, or the man he'd back up. REPLACEMENT_LEVEL when the slot is empty. */
  incumbent: number;
  /** Whether the slot he'd occupy is a starting slot, per lib/lineup.ts. */
  starts: boolean;
  /** True when he is ALREADY on this roster, i.e. the question is what we lose, not what we gain. */
  onRoster: boolean;
}

/**
 * How much a player improves (or, for one of your own, how much he is holding
 * up) a specific roster at his position. See the block above.
 *
 * THE MEASURE IS THE WHOLE DEPTH CHART, not one slot. Signing an 88 to a club
 * starting an 84 does not only upgrade the starter by four — it also drops
 * the 84 into the swing role ahead of whatever was there. Scoring only the
 * slot he lands in got that wrong in a way that showed: an 88 offered to a
 * club with an 89 (who would bench him behind a strong starter) out-scored
 * the same 88 offered to a club with an 84 (who would play him), purely
 * because the deep backup he leapfrogged was worse. Summing the ladder both
 * ways fixes it by construction and needs no special case.
 *
 * `roster` is the club's whole roster; the player is matched out of it by id,
 * so callers pass the same list either way and never have to say which side
 * of a trade they are asking about.
 */
export function rosterFit(p: RosterPlayer, roster: RosterPlayer[]): RosterFit {
  const onRoster = roster.some((r) => r.id === p.id);
  const group = roster
    .filter((r) => r.position === p.position && r.id !== p.id)
    .map((r) => r.trueOvr)
    .sort((a, b) => b - a);
  const starters = startersAt(p.position);

  // The slots that play, and how much. Every starting slot counts fully;
  // bench slots count for the share of snaps a backup really takes. Positions
  // that only ever roster one man (K, P) carry no bench slots at all — the
  // same rule, from the same place, that teamNeeds uses to skip its depth term
  // for them, because for those a second body is not depth, it is a spare.
  // `ONE_MAN_JOB` rather than `max > 1` for the reason recorded there: the
  // ceiling and "does the bench play" are two questions and were being read
  // off one number.
  const weights = [
    ...Array<number>(starters).fill(1),
    ...(carriesDepth(p.position) ? UPGRADE.DEPTH_SNAP_WEIGHTS : []),
  ];
  // An unfilled slot is scored at what the sim would actually field there
  // (lib/sim/units.ts REPLACEMENT_LEVEL), not at a second opinion about it.
  const ladder = (chart: number[]) =>
    weights.reduce((sum, w, i) => sum + w * (chart[i] ?? REPLACEMENT_LEVEL), 0);

  // Where he lands. Ties fall BEHIND the incumbent — a man who merely matches
  // what you already have does not take anybody's job.
  let slot = 0;
  while (slot < group.length && group[slot] >= p.trueOvr) slot++;
  const withHim = [...group.slice(0, slot), p.trueOvr, ...group.slice(slot)];
  const gain = ladder(withHim) - ladder(group);

  // Who the screen should name. If he cracks the lineup, the man who actually
  // comes off the field is the LAST starter, not the one immediately above
  // him — an 88 arriving as a club's WR2 pushes its WR3 to the bench, it does
  // not un-play its WR1.
  const starts = slot < starters;
  const incumbent = (starts ? group[starters - 1] : group[slot]) ?? REPLACEMENT_LEVEL;

  // Same table teamNeeds weights its quality term with, for the same reason:
  // ten points of kicker is not ten points of quarterback. The position's
  // TRADE economics are already in the tier curve this multiplies, so
  // weighting by those a second time would double-count them.
  const qualityWeight = ROSTER_NEED_QUALITY_WEIGHT[p.position as Position] ?? 1;
  const g = Math.max(0, gain);
  const curved = Math.pow(g, UPGRADE.SHARPNESS) / (Math.pow(g, UPGRADE.SHARPNESS) + Math.pow(UPGRADE.HALF_GAIN, UPGRADE.SHARPNESS));

  return { score: clamp(curved * qualityWeight, 0, 1), gain, incumbent, starts, onRoster };
}

/**
 * League-wide scarcity per position, 0 (plentiful good talent) .. 1
 * (barely any). Pure function over an already-fetched roster snapshot —
 * callers fetch the whole league's players ONCE per trade evaluation (not
 * per player, not per render) and reuse this across every asset in the
 * deal, per the "don't make this expensive" requirement. "Good" is a
 * simple, cheap threshold (75+ OVR); expected supply assumes roughly one
 * good player per team is normal, so scarcity only shows up when a
 * position is genuinely thin league-wide.
 */
export function leagueScarcity(allPlayers: { position: string; trueOvr: number }[]): Record<string, number> {
  const GOOD_THRESHOLD = 75;
  const counts: Record<string, number> = {};
  for (const p of allPlayers) {
    if (p.trueOvr < GOOD_THRESHOLD) continue;
    counts[p.position] = (counts[p.position] ?? 0) + 1;
  }
  const scarcity: Record<string, number> = {};
  for (const pos of POSITIONS) {
    const supply = counts[pos] ?? 0;
    scarcity[pos] = clamp(1 - supply / LEAGUE.TEAM_COUNT, 0, 1);
  }
  return scarcity;
}

/**
 * ===========================================================================
 * THE CLUB'S WINDOW — WHAT KIND OF ASSET IS THIS, AND IS IT THE KIND WE WANT?
 * ===========================================================================
 * Separate from `rosterFit`, which asks whether a man improves the lineup.
 * This asks a question a depth chart cannot answer: does he arrive in time to
 * matter to THIS club? A 31-year-old starter is exactly as useful on the
 * field to a rebuilding club as to a contender, and worth much less to it,
 * because the seasons he has left land before the club is any good.
 *
 * Returns -1 (purely a future asset) through +1 (purely a win-now asset), off
 * AGE AND NOTHING ELSE. Years of control were in here and came back out: the
 * research is explicit that control must not be counted twice ("do not then
 * also apply a large years-remaining multiplier — that double counts
 * control"), and `contractMult` already prices it. Counting it here as well
 * also produced a wrong answer, not just a doubled one — three years left
 * made a 34-year-old read as a partly FUTURE asset, which is the opposite of
 * what those three years are.
 */
export function assetWindow(p: { age: number }): number {
  const S = TRADE_VALUE.SPREAD;
  return clamp((p.age - S.WINDOW_PIVOT_AGE) / S.WINDOW_AGE_SPAN, -1, 1);
}

/**
 * The multiplier a club's window puts on a player. `winNow` above 0.5 leans
 * win-now, below leans rebuild; the product with `assetWindow` is positive
 * when the two agree (a contender looking at a veteran, a rebuilder looking
 * at a 23-year-old) and negative when they do not.
 */
export function windowMultiplier(profile: GmProfile, p: { age: number }): number {
  const tilt = (profile.winNow - 0.5) * 2;
  return 1 + tilt * assetWindow(p) * TRADE_VALUE.SPREAD.WINDOW_SWING;
}

export interface ValueBreakdown {
  base: number;
  upside: number;
  ageMult: number;
  /**
   * Roster-fit multiplier — what this man does to THIS club's depth chart,
   * blended from `teamNeeds` (do we have a hole) and `rosterFit` (is he
   * better than who we'd play instead). Named `fitMult` rather than
   * `needMult` because "need" was only ever half of what it now answers.
   */
  fitMult: number;
  /** What the deal does to THIS club's books — see the cap block in playerValueDetailed. 1 when no cap space was supplied. */
  capMult: number;
  /** The club's competitive window against this man's age — see windowMultiplier. */
  windowMult: number;
  /**
   * The BARGAIN half of the contract read: 1.0 or above, never below. An
   * overpay is not a multiplier any more — see `contractBurden`.
   */
  contractMult: number;
  /**
   * The OVERPAY half, in value points, already SUBTRACTED from `total`. Zero
   * on any deal at or below market. Exposed because lib/trade.ts charges it a
   * second time as the price of the favour (SPREAD.BAD_CONTRACT_TAX) and must
   * not have to reconstruct it from a multiplier that no longer encodes it.
   */
  contractBurden: number;
  /**
   * The same fact in dollars: everything he is owed above what a man of his
   * level fetches, across every year still to run. Carried beside the points
   * rather than derived from them by a caller, because the conversion lives in
   * one place (CONTRACT_BURDEN_PER_CAP_YEAR) and a second copy of it in a
   * refusal message is how a screen ends up quoting a figure the engine is not
   * using. This is the number a GM can act on; the points are the number the
   * verdict is computed from.
   */
  contractOverMarket: number;
  scarcityMult: number;
  noiseMult: number;
  /** The depth-chart read behind `fitMult`, or null when no roster was supplied. */
  fit: RosterFit | null;
  total: number;
  /**
   * Human-readable notes explaining the number, strongest driver first — NOT
   * insertion order. A trade screen showing "we're deep at WR" as if that
   * were why a blockbuster offer got rejected, when really the real driver
   * was a plain talent/value gap, is actively misleading. Every reason
   * carries the actual value-point swing it represents so the caller (see
   * assetValues in lib/trade.ts) can sort truth by magnitude.
   */
  reasons: { text: string; weight: number }[];
}

/** Tier curve evaluated at a given overall — pulled out so upside can reuse the exact same position-shaped curve as base, instead of a separate flat formula. */
function tierCurveValue(ovr: number, curve: { replacementLevel: number; steepness: number; scale: number; ceiling: number }): number {
  const surplus = Math.max(0, ovr - curve.replacementLevel);
  return Math.min(curve.ceiling, (Math.exp(surplus * curve.steepness) - 1) * curve.scale);
}

/**
 * ===========================================================================
 * SHAPE, NEVER A HARD CAP — THE POSITIONAL BOUND
 * ===========================================================================
 * `playerValueDetailed` used to end its multiplier stack in
 * `Math.min(total, curve.ceiling)`, and a flat clamp is the one treatment of
 * outliers the app owner has ruled out. What it does to the top of the market
 * is not subtle. Measured on the shipped table, a club that needed a receiver
 * priced a young cheap one at:
 *
 *   OVR   90     92     94     96     98     99
 *        1298   1754   2100   2100   2100   2100
 *
 * Four different players, one number. The game could not tell the best
 * receiver alive from a merely excellent one, and a trade screen quoting the
 * same value for a 94 and a 99 is a lying metric in the plainest sense — it
 * is not the answer the football model produced, it is the answer the clamp
 * produced. Across a blind sweep of every rostered player in three leagues
 * against a randomly drawn club, 0.5% of valuations landed exactly ON the
 * ceiling, and every one of them was a top-of-the-league player whose rating
 * had stopped mattering.
 *
 * THE BOUND ITSELF IS NOT THE PROBLEM AND DOES NOT GO AWAY. Everything the
 * old comment claimed for it is still true here: a punter can never be worth
 * a first-round pick, no stack of favourable modifiers can carry a position
 * past what that position is worth, and the guarantee holds after age,
 * contract, fit, scarcity, cap and noise have all been multiplied in. What
 * changes is that the ceiling stops being the answer and becomes the KNEE of
 * a compression curve:
 *
 *   at or below the knee   the number is returned untouched — measured at
 *                          97.4% of the league on a blind sweep of 8,275
 *                          rostered players, so what moves is the top of the
 *                          market and nothing else
 *   above it               the excess is compressed, strictly monotonically,
 *                          onto the gap between the knee and a hard asymptote
 *
 * The curve is `knee + span x (1 - exp(-excess / span))`. It is continuous at
 * the knee AND has gradient exactly 1 there, so there is no visible corner in
 * the price; it is strictly increasing everywhere, so a 99 always out-prices
 * a 94 again; and it never reaches `LIMIT x ceiling`, so the bound is a real
 * bound rather than a promise.
 *
 * THE BOUND MOVES, AND lib/tuning.ts HAD TO BE TOLD. Every ceiling is now the
 * knee rather than the maximum, so the maximum is LIMIT times it, and two
 * sentences over there were written about the old number: MINIMAL's "no more
 * than a low fifth" (40 is pick 132; 48 is pick 124, a late fourth — the
 * chart is so flat through round four that ANY headroom at all crosses that
 * line, so the sentence had to be restated rather than the headroom shrunk to
 * fit it) and the ceilings paragraph generally. Both are corrected there. The
 * football claims that matter are untouched: a punter is still a Day 3 pick
 * at absolute most and cannot approach a first, and PREMIUM's hard bound of
 * 2520 still sits under the largest veteran non-quarterback trade there has
 * been (Tunsil, about 2400 chart points, plus a buyer's need premium).
 *
 * WHAT THIS DELIBERATELY DOES NOT TOUCH is `tierCurveValue` above, whose own
 * `Math.min` is part of the published tier table: lib/ratings.ts holds a
 * second reading of that table (see `tierValue` there, which
 * `convertedAttributes` uses to price a position change) and
 * assertNoProfitableConversion checks the table itself. Softening the base
 * curve here and not there would be two opinions about one curve, which is
 * the bug class this codebase has been bitten by most. So the base curve is
 * left exactly as the table states it and only the finished valuation is
 * shaped — with the consequence, stated rather than hidden, that ratings
 * above the point where the RAW curve tops out (97 for PREMIUM, 98 for QB and
 * LOW, 99 for MID) still share a base. Separating those needs the table
 * changed, not this function.
 * ===========================================================================
 */
/*
 * EXPORTED so nothing has to keep a second copy of the bound. The probe that
 * measured this change first hard-coded 1.25 beside the code, and when the
 * headroom was retuned to 1.20 the probe went on printing the old number and
 * the old football sentence with it — a lying metric produced by the very
 * measurement meant to catch one. A caller that wants to know the most a
 * position can ever be worth reads `ceiling x CEILING_SOFTENING.LIMIT`, here.
 *
 * AND THAT BOUND IS ON `total`, NOT ON THE PRICE A BUYER PAYS. lib/trade.ts
 * applies SPREAD.POACH_PREMIUM to the talent AFTER this function has run, so
 * the ask for a man at the bound is up to 18% above it on HARD. Measured, the
 * dearest receiver in a generated league asked 2614 against a stated bound of
 * 2520 while the knee sat at 1.0. A caller quoting this number as "the most
 * anyone will ever be charged" would be quoting the wrong one.
 */
export const CEILING_SOFTENING = {
  /**
   * Where compression begins, as a share of the tier ceiling. [TUNE] 0.60,
   * down from 1.0 — the ceiling itself — because a knee that starts AT the
   * bound leaves the whole run-up to it uncompressed, and the run-up is where
   * the men who cost real draft capital live.
   *
   * MEASURED AGAINST THE TRADES THAT HAVE ACTUALLY HAPPENED, which is the
   * only bar that means anything here. The ask a buyer has to beat, against
   * the largest real deal of its kind (Ramsey 1640, Mack 1765 net, Tunsil
   * ~2350, three mid-firsts for a franchise quarterback):
   *
   *   KNEE   top of the market (92+ and QB)   everyone else
   *   1.00              1.18x                     0.99x
   *   0.80              1.13x                     0.98x
   *   0.70              1.11x                     0.98x
   *   0.60              1.07x                     0.97x
   *   0.50              1.04x                     0.96x
   *   0.40              1.00x                     0.96x
   *
   * 0.60 takes about 60% of the excess off the top and leaves the rest of the
   * league where it was: on a blind sweep of 8,275 rostered players, 97.4% of
   * valuations come back bit-for-bit identical, and nothing at or below a 92
   * moves by more than 0.3% (a 92 receiver 1350 -> 1346, a 90 and an 88
   * unchanged to the point). It is still a PREMIUM: 1.07x means the best men
   * in this game remain dearer than the dearest men in the real one, which is
   * the right side of the line to stop on.
   *
   * IT MAKES THE TOP LESS FLAT, NOT MORE, which is the opposite of what a
   * clamp does and is worth stating because the two get confused. Compressing
   * earlier spreads the same headroom over a wider range of raw inputs, so the
   * gap between a 96 receiver and a 99 one goes from 72 points to 114.
   *
   * The bound itself does NOT move — LIMIT is untouched, so the asymptote is
   * still ceiling x 1.20 and every football sentence written about it stands.
   * What changed is the approach to it, not where it is.
   */
  KNEE: 0.60,
  /**
   * The hard asymptote, as a share of the tier ceiling. [TUNE] 1.20, chosen
   * by measurement rather than taste. The pre-softening product runs to 1.82x
   * the ceiling on a 99 at a club with a hole at his position, so the whole
   * top of the market has to fit inside this headroom, and how much of the
   * rating survives the compression is what the number buys:
   *
   *   LIMIT   a 94 receiver .. a 99 receiver, after softening
   *   1.10    2293 .. 2310   — 17 points apart. Still flat; this is the clamp
   *                            again wearing a curve.
   *   1.20    2401 .. 2513   — 112 points, about a fourth-round pick between
   *                            an excellent receiver and the best one alive.
   *   1.25    2434 .. 2605   — 171 points, and PREMIUM's bound passes Tunsil.
   *
   * 1.20 is the smallest headroom at which the rating clearly still matters at
   * the top. It puts PREMIUM's hard bound at 2520 (under Tunsil's ~2400 plus a
   * buyer's premium), QB's at 6000 — the owner's "four or five first-round
   * pick equivalents", with the fifth one intact rather than clipped — and
   * MINIMAL's at 48, a late fourth, which is the one number in lib/tuning.ts
   * that had to be restated.
   */
  LIMIT: 1.20,
};

/**
 * The finished valuation, bounded by what the position can be worth without
 * flattening everyone who reaches it. See the block above.
 */
function softCeiling(total: number, ceiling: number): number {
  const knee = ceiling * CEILING_SOFTENING.KNEE;
  if (total <= knee) return total;
  const span = ceiling * (CEILING_SOFTENING.LIMIT - CEILING_SOFTENING.KNEE);
  return knee + span * (1 - Math.exp(-(total - knee) / span));
}

/**
 * What a player is worth to THIS team, in abstract "value points" comparable
 * to draft pick chart value (pickValue() below shares the same scale — a
 * mid/late Round 1 pick prices around 400-900). Used by trades and FA alike.
 * This is the detailed form — it returns WHY, not just a number, so the
 * trade screen can say something like "Chicago values your 31-year-old WR
 * less because they're rebuilding" instead of just accepting or rejecting
 * silently.
 *
 * Player QUALITY and TRADE-ASSET VALUE are not the same thing — a 99 OVR
 * punter is the best punter in football and still only a modest trade
 * asset, because the position itself has a low ceiling on how much a team
 * will pay for it. Position, age, and contract control interact with talent
 * rather than everything just multiplying one shared curve.
 */
export function playerValueDetailed(
  p: RosterPlayer,
  opts: {
    profile: GmProfile;
    needs?: Record<string, number>;
    /** 0..1 — 1 = full win-now, weights current rating over potential. */
    sharpness?: number;
    rng?: Rng;
    capMode?: CapMode;
    /** 0..1 per position — how thin the league-wide supply of good players there is. See leagueScarcity(). Omit to skip (defaults to neutral). */
    scarcity?: Record<string, number>;
    /**
     * The valuing club's whole roster, which turns on the depth-chart read:
     * where this man would actually line up and who he'd displace (or, if he
     * is already on it, who would replace him). Omit and the valuation falls
     * back to `needs` alone — which is exactly what the draft board and trade
     * retrospectives want, since neither is asking "what does he do to our
     * lineup", so neither is changed by this.
     */
    roster?: RosterPlayer[];
    /**
     * The valuing club's live cap space, in dollars. Omit to skip the cap
     * term entirely (capMult stays 1).
     */
    capSpace?: number;
  },
): ValueBreakdown {
  const { profile, needs } = opts;
  const sharpness = opts.sharpness ?? 1;
  const capMode = opts.capMode ?? 'REALISTIC';
  const reasons: { text: string; weight: number }[] = [];

  const tier = TRADE_VALUE_TIER[p.position as Position] ?? 'MID';
  const curve = TRADE_VALUE.TIER_CURVE[tier];
  const base = tierCurveValue(p.trueOvr, curve);

  if (tier === 'QB' && p.trueOvr >= 87) {
    reasons.push({ text: 'Quarterbacks at this level are extremely difficult to replace — that alone drives a huge price.', weight: base * 0.6 });
  } else if (tier === 'PREMIUM' && p.trueOvr >= 90) {
    reasons.push({ text: "He's a premium-position difference-maker — the market pays up for that.", weight: base * 0.4 });
  } else if (tier === 'MINIMAL' && p.trueOvr >= 93) {
    reasons.push({ text: `He grades as one of the best at his position, but that position carries limited trade-market value no matter how well he plays it.`, weight: base * 0.1 });
  } else if (tier === 'LOW' && p.trueOvr >= 90) {
    reasons.push({ text: `${p.position === 'RB' ? 'Running back' : 'This position'} has real value, but positional economics and the age curve cap how high it goes.`, weight: base * 0.15 });
  }

  // Potential weighting depends on whether the team is contending — reuses
  // the SAME tier curve as base (evaluated at the higher, upside-adjusted
  // overall) rather than a separate flat formula, so a QB's untapped
  // ceiling is worth far more than a kicker's in exactly the same way his
  // current level already is.
  /*
   * THE CLUB'S OWN ACCOUNT OF WHERE IT IS, taken from the same bands the
   * trade screen prints beside its name. The three sentences below used to
   * run off thresholds of their own — 0.4 here, 0.5 further down — so a club
   * whose card read Retooling could explain its own valuation by saying "we're
   * rebuilding". A reason is a displayed value like any other; it has to come
   * from the number the price came from.
   */
  const window = philosophySummary(profile).windowLabel;
  const potentialWeight =
    AI.REBUILD_POTENTIAL_WEIGHT * (1 - profile.winNow) + AI.CONTENDER_POTENTIAL_WEIGHT * profile.winNow;
  const effectiveCeiling = p.trueOvr + Math.max(0, p.potential - p.trueOvr) * potentialWeight;
  const upside = Math.max(0, tierCurveValue(effectiveCeiling, curve) - base);
  if (upside > base * 0.15) {
    reasons.push({
      text: window === 'Rebuilding'
        ? "We're rebuilding — his upside matters more to us than his current level."
        : window === 'Building'
          ? "We're building through the draft, so the ceiling is the part we're buying."
          : 'There\'s real untapped ceiling here.',
      weight: upside,
    });
  }

  // Age curve — position-specific arc (RB earliest/fastest decline, QB and
  // specialists longest). Keyed on the position's AGE_ARC, NOT on its trade
  // tier: how long a career lasts and what the position is worth are two
  // different questions, and tying them together meant re-tiering the
  // offensive line would have started ageing it like a wide receiver.
  const ageCurve = TRADE_VALUE.AGE_CURVE[TRADE_VALUE.AGE_ARC[p.position as Position] ?? 'STURDY'];
  let ageMult = 1;
  if (p.age > ageCurve.declineStart) ageMult -= (p.age - ageCurve.declineStart) * ageCurve.declinePerYear;
  else if (p.age < ageCurve.youthThreshold) ageMult += (ageCurve.youthThreshold - p.age) * ageCurve.youthPremiumPerYear;
  ageMult = clamp(ageMult, TRADE_VALUE.AGE_MULT_MIN, TRADE_VALUE.AGE_MULT_MAX);
  const ageSwing = base * Math.abs(ageMult - 1);
  if (ageMult < 0.85) {
    reasons.push({
      text: window === 'Rebuilding'
        ? `We're rebuilding, so a ${p.age}-year-old holds less value for us than the league average.`
        : window === 'Building'
          ? `We're building, and a ${p.age}-year-old's best seasons land before ours do.`
          : `At age ${p.age}, his future value is beginning to decline — we discount it.`,
      weight: ageSwing,
    });
  } else if (ageMult > 1.1) {
    reasons.push({ text: "He's young and still ascending — that's worth a premium to us.", weight: ageSwing });
  }

  /**
   * =========================================================================
   * A BARGAIN IS A MULTIPLIER. AN OVERPAY IS A BILL.
   * =========================================================================
   * These used to be the same number — one bounded multiplier that a good
   * deal pushed up to 1.30 and a bad one pushed down to a floor of 0.60. That
   * is fine going up and structurally incapable of going down far enough, and
   * the app owner's worst exploit lived in exactly that gap.
   *
   * WHY A MULTIPLIER CANNOT PRICE A BAD CONTRACT. `base` is surplus over
   * REPLACEMENT LEVEL, so a man at replacement is worth zero by construction —
   * MID's replacementLevel is 62 and a 62 corner scores a flat 0. Multiply
   * zero by anything, including a negative, and it is still zero. The measured
   * case: a 62 corner owed $135.4M over five years priced at 1.0 points, the
   * old `Math.max(1, total)` floor, and every club in the league took him for
   * nothing. No stack of multipliers could ever have said otherwise, because
   * there was nothing for them to multiply.
   *
   * SO THE DEFICIT IS SUBTRACTED, IN DOLLARS. What an overpay costs a club is
   * the cap it can no longer spend, and that is the same money whoever is
   * being overpaid — $60M above market on a franchise quarterback and $60M
   * above market on a special-teamer are the same $60M hole. It does not scale
   * with the man, so it is not a multiplier on him. The surplus side stays
   * multiplicative, because a cheap deal genuinely IS worth more on a better
   * player: a rookie contract on a star is the most valuable asset in the
   * sport and the same discount on a backup is worth nothing.
   *
   * The consequence is the point: `total` can now come out NEGATIVE, and a man
   * whose paper is worth far more than he is becomes something you have to be
   * PAID to take on. See CONTRACT_BURDEN_PER_CAP_YEAR for the exchange rate
   * and the football sentence it is anchored to.
   */
  let contractMult = 1;
  let contractBurden = 0;
  let contractOverMarket = 0;
  if (capMode !== 'OFF' && p.contract) {
    const expectedApy = marketValue({ ovr: p.trueOvr, position: p.position as Position, age: p.age, potential: p.potential });
    const yearsLeft = Math.max(1, p.contract.yearsRemaining);
    const actualAnnual = remainingValue(p.contract, capMode) / yearsLeft;
    const controlFactor = clamp(yearsLeft / TRADE_VALUE.CONTRACT_CONTROL_YEARS_FULL, 0.25, 1);

    // The bargain half, unchanged: below-market pay, scaled by how many years
    // of control it actually runs for, bounded at CONTRACT_MULT_MAX.
    const surplusFraction = clamp((expectedApy - actualAnnual) / Math.max(expectedApy, 1), 0, 1.5);
    contractMult = clamp(1 + surplusFraction * controlFactor * TRADE_VALUE.CONTRACT_SURPLUS_WEIGHT, 1, TRADE_VALUE.CONTRACT_MULT_MAX);
    if (contractMult > 1.12) {
      reasons.push({
        text: p.contract.isRookieDeal
          ? "His rookie contract creates significant surplus value."
          : 'This contract pays well below market for his level — real surplus value.',
        weight: base * (contractMult - 1),
      });
    }

    /*
     * The bill half. Every dollar he is owed above what a man of his level
     * fetches on the open market, for every year still to run — NOT scaled by
     * `controlFactor`, because years of control are what makes a bargain
     * compound and what makes an overpay WORSE, and dividing the bill by four
     * would have been the same "can't say no loudly enough" mistake in
     * miniature. A one-year rental at $10M over market costs $10M; a five-year
     * deal at $10M over costs $50M, and that is simply what it costs.
     *
     * The band comes off first — see CONTRACT_FAIR_BAND_PER_YEAR. `marketValue`
     * is an estimate wearing a [FRAGILE PLACEHOLDER] tag, and charging its
     * noise as dead money made an ordinary punter contract a liability.
     */
    contractOverMarket = Math.max(0, actualAnnual - expectedApy - TRADE_VALUE.CONTRACT_FAIR_BAND_PER_YEAR) * yearsLeft;
    contractBurden = (contractOverMarket / CAP.BASE_CAP) * TRADE_VALUE.CONTRACT_BURDEN_PER_CAP_YEAR;
    /*
     * Stated only once it is actually moving the number: 15 points is about a
     * sixth-round pick, and a reason worth less than that pushes a real driver
     * off the three the trade screen shows.
     *
     * "PAST A FAIR PRICE", not "more than he is worth", because the band has
     * already come off this figure — it is the excess beyond anything you
     * could defend, not the raw gap to a point estimate. A sentence has to be
     * true of the number it is quoting.
     */
    if (contractBurden > 15) {
      reasons.push({
        text: `His deal runs ${formatMoney(contractOverMarket)} past a fair price for a player at his level — taking that on is the real cost of this trade, not him.`,
        weight: contractBurden,
      });
    }
  }

  // Roster fit — bounded on both ends (real front offices actively discount a
  // redundant asset, not just withhold a bonus; and even desperate need never
  // overrides positional economics enough to make a punter cost a premium
  // pick). Two readings of one axis, blended by taking the larger: `needs`
  // sees holes, `rosterFit` sees upgrades, and a club with nobody at a spot
  // registers on both. The BOUNDS are untouched by this change — the fix is
  // that an obvious upgrade now reaches the top of the existing range instead
  // of being pinned to the bottom of it.
  const needVal = needs?.[p.position] ?? 0;
  const fit = opts.roster ? rosterFit(p, opts.roster) : null;
  const fitVal = Math.max(needVal, fit?.score ?? 0);
  const fitBase = needs || fit
    ? TRADE_VALUE.NEED_MULT_MIN + fitVal * (TRADE_VALUE.NEED_MULT_MAX - TRADE_VALUE.NEED_MULT_MIN)
    : 1;

  /**
   * The club's WINDOW, folded into the same bounded multiplier rather than
   * multiplied on beside it. Fit and window are different questions and
   * legitimately compose — a contender with a hole wants a ready starter
   * twice over — but their product is exactly where a "we apply the
   * preference twice" bug would live, so it is clamped here, once, against
   * TRADE_VALUE.SPREAD.FIT_WINDOW_*, and `fitMult` continues to be the only
   * roster-preference number in the formula.
   */
  const windowMult = windowMultiplier(profile, p);
  const fitMult = clamp(fitBase * windowMult, TRADE_VALUE.SPREAD.FIT_WINDOW_MIN, TRADE_VALUE.SPREAD.FIT_WINDOW_MAX);
  const fitSwing = base * Math.abs(fitMult - 1);

  // Legibility: a spread the user cannot see reads as the AI being arbitrary,
  // which is worse than no spread. Stated only when it is actually moving the
  // number, and in the club's own terms.
  if (Math.abs(windowMult - 1) > 0.04) {
    const wantsHim = windowMult > 1;
    reasons.push({
      text: profile.winNow < 0.5
        ? (wantsHim
          ? `${window === 'Rebuilding' ? "We're rebuilding" : "We're building"}, and at ${p.age} he's still around when we're good — that's worth more to us than to most.`
          : `${window === 'Rebuilding' ? "We're rebuilding" : "We're building"} — a ${p.age}-year-old's best seasons land before ours do, so he's worth less to us than to a contender.`)
        : (wantsHim
          ? `${window === 'All-In' ? "We're all in this year" : "We're going for it now"}, and he helps now — that's worth a premium to us.`
          : `${window === 'All-In' ? "We're all in this year" : "We're going for it now"} — at ${p.age} he's more future than we're shopping for.`),
      weight: base * Math.abs(windowMult - 1),
    });
  }

  // The explanation has to read correctly from BOTH sides of a deal: the same
  // number is the price of acquiring him and the price of prising him loose,
  // and a screen that says "he'd start for us" about a man who already does
  // is explaining someone else's roster.
  // Stated in rating points over the man he displaces, not in `fit.gain`'s
  // snap-weighted units — "10 points better than the man he'd replace" is a
  // sentence a GM can check against the depth chart in front of him, and
  // "15.2" is not.
  const overIncumbent = fit ? Math.round(p.trueOvr - fit.incumbent) : 0;
  if (fit?.onRoster) {
    if (fit.starts && overIncumbent >= 3) {
      reasons.push({ text: `He starts for us at ${p.position} — replacing him from inside the building drops us ${overIncumbent} points at the spot.`, weight: fitSwing });
    } else if (!fit.starts) {
      reasons.push({ text: `He's depth for us at ${p.position}, not someone we're counting on.`, weight: fitSwing });
    }
  } else if (needVal > 0.55) {
    reasons.push({ text: `This fills a real hole for us at ${p.position}.`, weight: fitSwing });
  } else if (fit && fit.starts && overIncumbent >= 3) {
    reasons.push({
      text: fit.incumbent <= REPLACEMENT_LEVEL
        ? `He'd walk into an empty ${p.position} slot for us — we're playing nobody there.`
        : `He'd start at ${p.position} for us — ${overIncumbent} points a snap better than the man he'd replace.`,
      weight: fitSwing,
    });
  } else if (fit && !fit.starts) {
    reasons.push({ text: `He'd sit behind what we already have at ${p.position} — that's depth, not a starter, and we price it that way.`, weight: fitSwing });
  } else if (fitVal < 0.15) {
    reasons.push({ text: `We're already strong at ${p.position}, so this doesn't move the needle much.`, weight: fitSwing });
  }

  /**
   * WHAT THE DEAL DOES TO OUR BOOKS. Distinct from `contractMult` above,
   * which asks whether the contract is good VALUE in the abstract (cheap
   * relative to market). This asks whether this particular club can live with
   * it, which is a different question with a different answer for every club:
   * a $20M salary is a bargain to a team with $60M of room and an
   * impossibility to a team with $3M, at identical market value.
   *
   * Only base salary travels in a trade — the signing bonus accelerates onto
   * the club giving him up (see executeTrade / tradeCapDeltas) — so the number
   * an acquiring club's sheet has to absorb is the hit minus proration, not
   * the hit. Using the raw hit would overstate the bill on every
   * bonus-heavy contract in the league.
   *
   * And it runs the other way too: for a man already on the roster, the cap
   * he frees is a REASON TO TRADE HIM, but only for a club that is actually
   * under pressure. A club with room has no reason to shed salary, so the
   * term is inert there rather than quietly marking down every expensive
   * player in the league.
   */
  let capMult = 1;
  if (capMode !== 'OFF' && p.contract && opts.capSpace !== undefined) {
    const room = Math.max(0, opts.capSpace);
    if (fit?.onRoster) {
      const freed = capSavingsOnCut(p.contract, capMode);
      const pressure = clamp(1 - room / CAP_FIT.COMFORT_SPACE, 0, 1);
      const relief = clamp(freed / CAP_FIT.COMFORT_SPACE, 0, 1);
      capMult = 1 - pressure * relief * (1 - CAP_FIT.SHED_MULT_MIN);
      if (capMult < 0.97) {
        reasons.push({ text: `Moving his ${formatMoney(freed)} off our books is worth something on its own — we're tight against the cap.`, weight: base * (1 - capMult) });
      }
    } else {
      const added = capHit(p.contract, capMode) - (capMode === 'REALISTIC' ? proration(p.contract) : 0);
      const load = added / Math.max(room, 1);
      const strain = clamp((load - CAP_FIT.FREE_SHARE) / (CAP_FIT.FULL_SHARE - CAP_FIT.FREE_SHARE), 0, 1);
      capMult = 1 - strain * (1 - CAP_FIT.ACQUIRE_MULT_MIN);
      // Only stated once it's actually material. Every reason carries its own
      // value swing and the trade screen shows the strongest three, so a 2%
      // nudge that announces itself pushes a real driver off the list — the
      // exact "explaining a factor that isn't the reason" failure the
      // breakdown's sort order exists to prevent.
      if (capMult < 0.94) {
        reasons.push({
          text: load >= 1
            ? `We don't have the room — his ${formatMoney(added)} salary is more cap space than we have.`
            : `His ${formatMoney(added)} salary would eat ${Math.round(load * 100)}% of our cap room, and that's a real cost to us.`,
          weight: base * (1 - capMult),
        });
      }
    }
  }

  // League scarcity — modest by design (see TRADE_VALUE.SCARCITY_MULT_*).
  const scarcityVal = opts.scarcity?.[p.position];
  const scarcityMult = scarcityVal !== undefined
    ? TRADE_VALUE.SCARCITY_MULT_MIN + scarcityVal * (TRADE_VALUE.SCARCITY_MULT_MAX - TRADE_VALUE.SCARCITY_MULT_MIN)
    : 1;

  let total = (base + upside) * ageMult * contractMult * fitMult * scarcityMult * capMult;


  // Imperfect evaluation. Lower sharpness (easier difficulty) = noisier AI.
  let noiseMult = 1;
  if (opts.rng) {
    noiseMult = 1 + opts.rng.normal(0, 0.09 * (2 - sharpness));
    total *= noiseMult;
  }

  // The positional bound, applied to the FINAL total, after every multiplier,
  // so no stack of favourable modifiers (young + cheap + needed + scarce) can
  // push an ordinary player at a low-value position past what that position
  // can ever be worth. This is what actually guarantees "a punter can never be
  // worth a first-round pick," not just the base curve — see softCeiling for
  // why it is now a shape rather than a wall.
  total = softCeiling(total, curve.ceiling);

  /*
   * THE BILL, LAST, AND OUTSIDE EVERYTHING ABOVE.
   *
   * After the CEILING, because the ceiling is a statement about how much a
   * position can be worth ON THE FIELD and has nothing to say about money
   * owed. Subtracted before it, a club's best quarterback pinned at the 5000
   * cap would have had his contract forgiven entirely by the clamp — the bill
   * would vanish into the rounding on precisely the biggest deals in the game.
   *
   * And outside the NOISE on purpose. Every other term here is a scouting
   * judgement and the noise is what makes clubs disagree about one; a contract
   * is a public document and there is nothing to disagree about. So thirty-two
   * front offices read the same player differently and the same bill
   * identically, which is also how it works.
   */
  total -= contractBurden;

  reasons.sort((a, b) => b.weight - a.weight);
  /*
   * NO FLOOR. `total` used to come back through `Math.max(1, total)`, which
   * meant no asset in this economy could ever be worth less than one point and
   * therefore no contract could ever be a liability. That floor, and the
   * matching one in lib/trade.ts's assetValues, are what made a 62 corner owed
   * $135.4M a positive asset that thirty of thirty-one clubs accepted for
   * nothing. A man can now be a cost, which is the only honest answer for a
   * man whose paper is worth more than he is.
   */
  return { base, upside, ageMult, fitMult, windowMult, capMult, contractMult, contractBurden, contractOverMarket, scarcityMult, noiseMult, fit, total, reasons };
}

/** Convenience wrapper for callers that only need the number. */
export function playerValue(p: RosterPlayer, opts: Parameters<typeof playerValueDetailed>[1]): number {
  return playerValueDetailed(p, opts).total;
}

/**
 * Value of a draft pick to this team, in the same units as playerValue — which
 * are now the Jimmy Johnson chart's own units, unscaled. See PICK_VALUE_CHART
 * in lib/tuning.ts: to a neutral GM valuing a pick in the next draft, this
 * function returns the chart number and nothing else, so "420" means "pick 48"
 * everywhere in the game, for players as much as for picks.
 *
 * The old form multiplied the chart by a bare 0.30 marked [FRAGILE
 * PLACEHOLDER], which is exactly what it was: a conversion factor between two
 * scales that nobody could state in football terms, sitting between the two
 * halves of every trade. It is gone.
 */
export function pickValue(
  round: number,
  slot: number,
  profile: GmProfile,
  year: number,
  currentYear: number,
  /**
   * The year of the next draft that has not happened yet, when the caller
   * knows it (lib/trade.ts does — see imminentDraftYear). Picks in THAT draft
   * are worth face value; the discount below counts from it, not from the
   * season. Optional because it changes an answer rather than enabling one:
   * omit it and the discount counts from `currentYear` as it always did,
   * which is what a retrospective grading a completed trade wants.
   *
   * It matters because DraftPick.year for the upcoming draft is pre-generated
   * as seasonYear + 1 and stays that way all season, so without this a pick in
   * the draft five months away was marked down 12% for being "a year out".
   */
  imminentYear?: number | null,
): number {
  const overall = (round - 1) * LEAGUE.TEAM_COUNT + slot;
  const chart = PICK_VALUE_CHART(overall);

  /**
   * Rebuilding teams (low winNow) and pick-lovers pay a premium, win-now
   * clubs discount. CENTRED ON 1.0: the old form was
   * `0.75 + valuePicks * 0.5 + (1 - winNow) * 0.35`, which handed a perfectly
   * neutral GM a 1.175x multiplier — harmless when the chart was being
   * rescaled by an arbitrary constant anyway, and a lie now that the chart's
   * numbers are the game's units. Same coefficients, same spread across the
   * league (roughly 0.62x .. 1.38x); only the middle moved, so a neutral club
   * prices pick 48 at 420 and the sentence "this player is worth a
   * mid-second" is checkable.
   */
  const bias = 1 + (profile.valuePicks - 0.5) * 0.5 + (0.5 - profile.winNow) * 0.35;

  /**
   * Future picks are discounted — a 2028 first is not a 2027 first, and no
   * chart encodes that. [TUNE] 15% per draft beyond the next one, up from 12%
   * per year counted from the season. Two changes in one place, both in the
   * same direction of honesty: the imminent draft is no longer discounted at
   * all (see `imminentYear`), and the rate is closer to how front offices
   * actually treat future capital, where "a future second for a current
   * third" is a routine trade. Note the slot is already handled elsewhere:
   * lib/trade.ts prices any pick past the next draft at the middle of its
   * round, so this multiplier carries time risk only, not slot uncertainty.
   */
  /*
   * ...and how hard he discounts it is his own business too. A club going for
   * it now marks a 2029 pick down sharply — paper does not help it win this
   * season — while a rebuilder barely discounts it at all, because that draft
   * is the whole plan. This is the other half of "a rebuilder will take 915
   * points of picks for a 1000-point player": the picks are not worth 915 to
   * him, they are worth more, and the deal clears without anybody inventing a
   * discount on the player.
   */
  const S = TRADE_VALUE.SPREAD;
  const perYear = clamp(S.FUTURE_DISCOUNT_BASE + (0.5 - profile.winNow) * S.FUTURE_DISCOUNT_SWING, 0.6, 0.98);
  const yearsOut = Math.max(0, year - (imminentYear ?? currentYear));
  const discount = Math.pow(perYear, yearsOut);

  return chart * bias * AI.PICK_VALUE_BIAS * discount;
}

/**
 * ===========================================================================
 * THE COMPETITIVE WINDOW — ONE NUMBER, RE-READ EVERY OFFSEASON
 * ===========================================================================
 * `winNow` is the club's whole organisational posture, and it is deliberately
 * ONE CONTINUOUS NUMBER rather than a mode with gears in it. Everything
 * downstream is a reading of this number and nothing branches on a label:
 * what a pick is worth to this club and how hard it marks a future one down
 * (`pickValue`), how it weighs a 23-year-old against a 30-year-old
 * (`windowMultiplier`), how much of the ceiling it carries (`rosterCapTarget`
 * in lib/gen/league.ts), how it leans in the draft, how heavily it weights
 * potential over rating (`playerValueDetailed`), and how keen the AI-vs-AI
 * market is to have it on each side of a deal (lib/aiMarket.ts). That is the
 * only reason the label a screen prints and the price the club actually
 * quotes cannot come apart — see `philosophySummary`, which only names bands
 * of this number and is read by nothing that decides anything.
 *
 * NOTHING CALLED THIS FUNCTION UNTIL NOW, and the header it replaced said it
 * ran every offseason. `gmProfile` was written once, at league generation,
 * and never again: a club that went 3-14 four years running kept the window
 * it was born with, a dynasty kept the one it started with, and every system
 * in the list above was pricing against the roster the club was handed on day
 * one. It now runs at the RESET_STANDINGS step of the offseason advance
 * (`recomputeCompetitiveWindows` in lib/season.ts), which is the last moment
 * the season just played is still on the standings.
 *
 * THREE PIECES OF EVIDENCE, WEIGHED AND THEN SQUASHED ONCE.
 *
 * RECORD is measured from .500, not from .400. The old form was
 * `clamp((winPct - 0.4) / 0.4, 0, 1)`, which reads exactly zero for every
 * club at or below 6.8 wins. Measured over 186 club-seasons of real play,
 * that pinned 31.7% of the league at the bottom of its own term before
 * anything else had been counted, and left the median club at 0.33 once the
 * weights were applied — which under the old three-label bands would have
 * read 53.8% of all club-seasons as Rebuilding. That is not a league with a
 * window, it is a league of rebuilders, and it drags the money with it:
 * `rosterCapTarget` reads off this same number, so the median club's payroll
 * target would have sat at 76.6% of the cap instead of 80.6%. A .500 club
 * now sits in the middle of the scale, which is what .500 means.
 *
 * AGE is measured from the league's own mean starter age — 27.98, sd 0.73
 * across the same club-seasons — not from 25, which no starting lineup in
 * this game is anywhere near. The old pivot did not PIN this term; no
 * club-season at all reached its floor. What it did was put the whole league
 * on one side of its own scale, and a term every club agrees on is a constant
 * rather than evidence. AGE_SPAN is wide against the spread on purpose: a
 * starting lineup's average age moves by about half a year from club to club,
 * so it should move the window by about that much, and the club this term
 * exists for is the one genuinely ageing out.
 *
 * CAP POSITION is the new term and it is a CAPACITY, not a plan. Money is
 * permission to act: a club with nothing under the ceiling cannot go all in
 * however good it is, and one sitting on a fortune has the option. It is
 * ASYMMETRIC on purpose — an empty sheet pulls away from win-now harder than
 * a full one pushes toward it, because room is an opportunity and not a
 * mandate. It deliberately does NOT try to say "young roster plus money means
 * building"; that sentence belongs to the age term, and saying it twice is
 * how two halves of one model start disagreeing with each other.
 *
 * AND THERE IS NO CLAMP AT THE END, BECAUSE THERE IS NOTHING LEFT TO CLAMP.
 * The evidence is weighed FIRST and squashed ONCE, so the result is inside
 * (0, 1) by construction, approaches both ends and reaches neither.
 *
 * THE OLD FORM CLAMPED THREE TIMES — each term to [0, 1] and then the total
 * to [0.05, 0.95] — and it is the INTERIOR floors that did the damage rather
 * than the famous outer one. Measured over the same club-seasons, the outer
 * clamp caught nobody at all, while the record term's own floor held 31.7% of
 * the league. A floor inside a sum is still a pile; it just does not look
 * like one from outside, because the number it produces is not the number
 * anybody plots.
 *
 * THE OUTER CLAMP DID BITE IN ONE PLACE, on the same quantity one season
 * earlier: the opening window at league generation, where 2.79% of clubs
 * landed on 0.05 exactly and 2.85% on 0.95, against neighbouring buckets
 * holding about 0.4% each. See `defaultGmProfile`.
 *
 * `softBound` IS THE USUAL FIX AND IT IS THE WRONG ONE HERE, which is worth
 * writing down so the next reader does not "correct" this back. That helper
 * bends whatever lies past `core * sd` into the headroom left before the
 * bound, and it needs the bound to be comfortably further out than the
 * distribution is wide. This one is not: at a spread of about 0.27 against a
 * half-range of 0.45, the Gaussian tail loses to the taper's own expansion at
 * every split of that headroom — it needs edge x room > 2 sd^2, i.e. more
 * than 0.146 out of a budget that peaks at 0.051 — so the pile does not go
 * away, it comes back as a rising density one step inside the wall.
 * Measured on 400,000 draws at the generator's own spread, `softBound` with a
 * 0.25 core returned buckets of 0.880%, 0.904%, 0.977%, 1.056% and 1.113%
 * across 0.90 to 0.94: no spike, but climbing toward the bound rather than
 * away from it. And at the helper's default core the untouched region reaches
 * past the bound itself, at which point the taper runs the wrong way and the
 * "bound" is exceeded outright — measured, 1.125. Weighing before squashing
 * removes the wall instead of decorating it.
 */
export function recomputeWinNow(
  wins: number,
  losses: number,
  avgStarterAge: number,
  /**
   * Share of the ceiling this club still has free going into the league year
   * it is about to play — `capSpace / capTotal`. Omit it, or pass a non-finite
   * number, and the cap term is dropped rather than guessed: that is what a
   * league with the cap switched OFF hands in, where `capSpace` is
   * deliberately Infinity.
   */
  capRoomShare?: number,
): number {
  const W = AI.WINDOW;
  const winPct = wins / Math.max(1, wins + losses);
  const fromRecord = (winPct - 0.5) / W.RECORD_SPAN;
  const fromAge = (avgStarterAge - W.AGE_PIVOT) / W.AGE_SPAN;
  // Bounded to (-1, 1) before it is weighed, so a club $200M under the
  // ceiling in a rebuilt league cannot swamp the two terms that are actually
  // about football.
  const lean = capRoomShare === undefined || !Number.isFinite(capRoomShare)
    ? 0
    : Math.tanh((capRoomShare - W.CAP_PIVOT) / W.CAP_SPAN);
  const fromCap = lean * (lean < 0 ? W.CAP_DOWN : W.CAP_UP);
  return 0.5 + 0.5 * Math.tanh(fromRecord + fromAge + fromCap);
}

export interface PhilosophySummary {
  windowLabel: 'Rebuilding' | 'Building' | 'Competitive' | 'All-In';
  tradeTendency: 'Conservative' | 'Measured' | 'Aggressive';
  pickPreference: 'Hoards picks' | 'Balanced on picks' | 'Trades picks for now';
}

/**
 * Human-readable team identity derived from the same gmProfile numbers that
 * drive every valuation. Surfaced in the trade UI so AI teams read as
 * distinct front offices instead of an invisible math function — per the
 * brief's complaint that "eventually every CPU franchise feels identical."
 *
 * FOUR WINDOWS, NOT THREE. `Retooling` was doing the work of two genuinely
 * different postures — a young club accumulating and a real team that is not
 * betting anything — and there was no top gear at all: `Win-Now Contender`
 * covered a solid eleven-win club and a club that has decided this is the
 * year, and those two do not price a 2029 second the same way. Measured on
 * the shipped curve with everything else held neutral, a club in the middle
 * of the All-In band marks a pick two drafts out 17.4% cheaper than one in the
 * middle of Competitive, and wants 21.8% more draft capital for the same
 * 29-year-old starter. That gap was always in the arithmetic; what was
 * missing was a name for it and a market that could see it.
 *
 * THE BANDS ARE READINGS, NOT SWITCHES. Nothing in the game branches on the
 * string this returns. The AI-vs-AI market used to, and its buyer and seller
 * appetite now read `winNow` directly (lib/aiMarket.ts), so there is no
 * threshold left anywhere that could put a club's card and a club's price on
 * opposite sides of a line.
 */
export function philosophySummary(profile: GmProfile): PhilosophySummary {
  const B = AI.WINDOW.BANDS;
  const windowLabel = profile.winNow >= B.ALL_IN ? 'All-In'
    : profile.winNow >= B.COMPETITIVE ? 'Competitive'
      : profile.winNow > B.REBUILDING ? 'Building' : 'Rebuilding';
  const tradeTendency = profile.aggression >= 0.62 ? 'Aggressive' : profile.aggression <= 0.38 ? 'Conservative' : 'Measured';
  const pickPreference = profile.valuePicks >= 0.62 ? 'Hoards picks' : profile.valuePicks <= 0.38 ? 'Trades picks for now' : 'Balanced on picks';
  return { windowLabel, tradeTendency, pickPreference };
}

/**
 * Max APY the AI will offer a free agent.
 *
 * Priced off `askingPrice` rather than `marketValue`, which are the same
 * number until somebody has been sitting unsigned: a club negotiating in
 * November is negotiating against what the man will take in November. Bidding
 * his April price would have the AI volunteer money nobody is asking for, and
 * would put the number the free-agency board shows the user out of step with
 * the number the AI actually pays.
 *
 * This is a BUDGET, not an acceptance test. What the man will actually take is
 * `aiDealFor` in lib/freeagency.ts, which asks the same model the user's
 * negotiation panel runs; this says only how far this front office is willing
 * to go. The two used to be tangled — the wave compared a bid against its own
 * `market * 0.85` — and untangling them is why a club can now bid its whole
 * budget on a man and still be told he would not sign it.
 */
export function maxOffer(
  p: RosterPlayer,
  opts: { profile: GmProfile; needs: Record<string, number>; capSpace: number; rng: Rng },
): number {
  const market = askingPrice({
    ovr: p.trueOvr, position: p.position as Position, age: p.age,
    potential: p.potential, weeksUnsigned: p.weeksUnsigned ?? 0,
  });
  const need = opts.needs[p.position] ?? 0;

  // Aggression + need drive how far above market the AI will go.
  const overpay = 1 + (AI.FA_MAX_OVERPAY - 1) * (opts.profile.aggression * 0.6 + need * 0.4);
  const noise = 1 + opts.rng.normal(0, 0.08);
  const offer = market * overpay * noise;

  const usable = Math.max(0, opts.capSpace - AI.CAP_RESERVE);
  return Math.min(offer, usable);
}
