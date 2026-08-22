import { ROSTER_TARGETS, canonicalPosition, Position } from '../tuning';
import { AttrMap, positionMove, relatedPositions } from '../ratings';
import { startersAt } from '../lineup';
import { REPLACEMENT_LEVEL } from '../sim/units';

/**
 * ===========================================================================
 * SLIDING A MAN OVER — THE AI'S HALF OF POSITION CHANGES
 * ===========================================================================
 * The user can now move a spare right tackle to left tackle from the player
 * card. If the CPU cannot, the user has an edge no club in the league can
 * answer and every AI roster reads wrong beside his — a team with three good
 * tackles and no guard, sitting there with a replacement-level body in the
 * lineup and no idea it owns the fix.
 *
 * WHAT THIS DELIBERATELY IS NOT: a cross-position awareness bolted into
 * `teamNeeds` (lib/ai/gm.ts). That was the tempting shape and it is a trap —
 * a `teamNeeds` that quietly discounts a guard hole because a tackle *could*
 * slide inside, on a club that never actually slides him, produces an AI that
 * stops signing guards AND still fields nobody at guard. Worse than doing
 * nothing. So `teamNeeds` is untouched and keeps reading `p.position`: the
 * club really makes the move, and afterwards it really has a guard, so every
 * downstream consumer — needs, free agency, the draft board, trade valuation,
 * the sim — is correct for free. That is the whole reason the app owner's
 * "just change the position" answer beats an adjacency model.
 *
 * THE DECISION RULE. One number: does the club's STARTING LINEUP get better?
 * For a candidate move, sum the ratings actually on the field at the position
 * he leaves and the position he joins, before and after. `startersAt` is
 * lib/lineup.ts's single definition of how many that is, and an unfilled slot
 * is scored at units.ts's own REPLACEMENT_LEVEL — the value the sim really
 * fields there — so the AI is optimising the team it will actually play.
 *
 * Losing a starter at the position he leaves is priced automatically: pull the
 * only left tackle off the line and the slot behind him is a 48, which no
 * plausible gain elsewhere covers.
 * ===========================================================================
 */

/** [TUNE] How much better the starting lineup must get before a club bothers. */
const CONVERSION_MIN_GAIN = 4;
/** [TUNE] Moves one club will make in a single sweep. A roster is not rebuilt in an afternoon. */
const CONVERSION_MAX_MOVES = 2;

export interface ConversionPlan {
  playerId: string;
  from: Position;
  to: Position;
  /** What he rates today, at `from`. */
  fromOvr: number;
  /** What he would rate at `to` — `positionMove`'s number, which is what the write uses. */
  toOvr: number;
  /** Rating points added to the club's starting lineup, summed across both positions. */
  gain: number;
}

export interface ConversionCandidate {
  id: string;
  position: string;
  trueOvr: number;
  trueAttrs: AttrMap;
}

/**
 * Sum of the ratings on the field at one position — the top `startersAt(pos)`
 * of the group, with any unfilled slot scored at replacement level.
 *
 * A SUM rather than a mean, on purpose: it makes the three receivers who start
 * count for three times what the one tight end does without a weight table
 * saying so, and it is the quantity that is actually comparable across the two
 * positions a move touches.
 */
function startingSum(ovrs: number[], position: string): number {
  const n = startersAt(position);
  if (n === 0) return 0;
  const top = [...ovrs].sort((a, b) => b - a).slice(0, n);
  while (top.length < n) top.push(REPLACEMENT_LEVEL);
  return top.reduce((s, v) => s + v, 0);
}

/**
 * Which men this club should move, best move first.
 *
 * Pure — no database, no RNG. AI valuation in lib/ai/gm.ts is deliberately
 * noisy (see playerValueDetailed), but this is not: a position change is
 * reversible at no cost and permanent in the record, so a club that flips a
 * lineman back and forth on a coin toss would fill the league wire with noise
 * and teach the user nothing. Clubs differ here through their ROSTERS, which
 * is the honest source of variety.
 */
export function planPositionConversions(
  players: ConversionCandidate[],
  opts: { minGain?: number; maxMoves?: number } = {},
): ConversionPlan[] {
  const minGain = opts.minGain ?? CONVERSION_MIN_GAIN;
  const maxMoves = opts.maxMoves ?? CONVERSION_MAX_MOVES;

  // Mutable working copy of the roster's shape: each accepted move updates it,
  // so a second move is evaluated against the club that made the first one.
  const byPos = new Map<string, number[]>();
  for (const p of players) {
    const pos = canonicalPosition(p.position);
    byPos.set(pos, [...(byPos.get(pos) ?? []), p.trueOvr]);
  }
  const moved = new Set<string>();
  const plans: ConversionPlan[] = [];

  for (let round = 0; round < maxMoves; round++) {
    let best: ConversionPlan | null = null;

    for (const p of players) {
      if (moved.has(p.id)) continue;
      const from = canonicalPosition(p.position);
      const fromGroup = byPos.get(from) ?? [];
      // Never strip a position below the bodies it is supposed to carry. The
      // gain arithmetic mostly enforces this on its own (an empty slot scores
      // 48), but ROSTER_TARGETS.min is what every other AI system means by
      // "enough men here", and a club that converts its way under it would
      // immediately go shopping to undo itself.
      if (fromGroup.length - 1 < ROSTER_TARGETS[from]?.min) continue;

      for (const to of relatedPositions(from)) {
        const mv = positionMove({ position: from, trueOvr: p.trueOvr, trueAttrs: p.trueAttrs }, to);
        const toGroup = byPos.get(to) ?? [];

        // Remove exactly one instance of his rating, not every equal one.
        const withoutHim = [...fromGroup];
        withoutHim.splice(withoutHim.indexOf(p.trueOvr), 1);

        const gain =
          (startingSum(withoutHim, from) + startingSum([...toGroup, mv.ovr], to)) -
          (startingSum(fromGroup, from) + startingSum(toGroup, to));

        if (gain < minGain) continue;
        // Strictly-better wins, so a tie keeps the candidate found FIRST and
        // the plan is identical on identical input — there is no RNG here to
        // break a tie with, and a plan that varied between two runs over the
        // same roster would make the league wire unreproducible.
        if (best && (gain < best.gain || (gain === best.gain && mv.ovr <= best.toOvr))) continue;
        best = { playerId: p.id, from, to, fromOvr: p.trueOvr, toOvr: mv.ovr, gain };
      }
    }

    if (!best) break;
    plans.push(best);
    moved.add(best.playerId);
    const src = [...(byPos.get(best.from) ?? [])];
    src.splice(src.indexOf(best.fromOvr), 1);
    byPos.set(best.from, src);
    byPos.set(best.to, [...(byPos.get(best.to) ?? []), best.toOvr]);
  }

  return plans;
}
