import {
  buildContract, buildExtension, capHitSchedule, type ContractLike,
} from '@/lib/cap';
import { contractShapeFor, type DealStructure, type NegotiationContext, type Offer, type OfferDecision } from '@/lib/negotiation';
import { CapMode } from '@/lib/types';

/**
 * ===========================================================================
 * THE CONTRACT THIS OFFER WOULD WRITE, YEAR BY YEAR
 * ===========================================================================
 * `decideOffer` already builds this contract — it has to, since the cap gate
 * and the ledger are drawn off it — and then returns only the summary: the
 * schedule of cap hits, the totals, the dead money. What it does not return is
 * the SPLIT: what he is paid in base salary each season and what of that
 * season's charge is last year's bonus catching up with you. A term sheet that
 * cannot show that is not a term sheet.
 *
 * So this rebuilds it, with the identical functions and the identical inputs —
 * `contractShapeFor`, then `buildExtension` when he is still under contract
 * and `buildContract` when he is not — and then CHECKS ITSELF. If the schedule
 * it produces is not the schedule the decision produced, to the dollar, the
 * caller is told so and shows the hits alone rather than a split that might
 * describe a different contract. Two constructions of the same deal is exactly
 * the drift this codebase keeps paying for; the check is what makes it safe to
 * do here at all, and the right fix is for `OfferDecision` to carry the priced
 * contract so nobody has to.
 * ===========================================================================
 */
export interface PricedYear {
  /** 1-based season of the contract. */
  index: number;
  /** True where this is a season he was already owed on his existing deal. */
  owed: boolean;
  baseSalary: number;
  /** Signing-bonus proration charged this season. */
  bonus: number;
  capHit: number;
}

export interface PricedDeal {
  years: PricedYear[];
  signingBonus: number;
  voidYears: number;
  /** False when the rebuild disagreed with the decision — show hits only. */
  trusted: boolean;
}

export function priceDeal(
  ctx: NegotiationContext,
  offer: Offer,
  structure: DealStructure,
  capMode: CapMode,
  decision: OfferDecision,
): PricedDeal {
  const shape = contractShapeFor(offer);
  const appending = ctx.currentContract !== null && ctx.controlYears > 0;
  const ext = appending
    ? buildExtension({
        current: ctx.currentContract as ContractLike,
        newMoneyApy: offer.apy,
        addYears: offer.years,
        signedYear: (ctx.currentContract as ContractLike).signedYear,
        escalation: structure.escalation,
        bonusPct: shape.bonusPct,
        guaranteedPct: shape.guaranteedPct,
        voidYears: structure.voidYears,
      })
    : null;
  const built = ext ?? buildContract({
        apy: offer.apy,
        years: offer.years,
        signedYear: 0,
        escalation: structure.escalation,
        bonusPct: shape.bonusPct,
        guaranteedPct: shape.guaranteedPct,
        voidYears: structure.voidYears,
      });

  // The builder's own answer for where the added years start, rather than
  // `controlYears` read a second time — an appended deal knows which of its
  // seasons it bought.
  const firstNew = ext ? ext.firstNewYearIndex : 0;
  const priced = { ...built, baseSalaries: JSON.stringify(built.baseSalaries) };
  const schedule = capHitSchedule(priced, capMode);

  const trusted = schedule.length === decision.capHitSchedule.length
    && schedule.every((h, i) => h === decision.capHitSchedule[i]);

  return {
    years: schedule.map((capHit, i) => ({
      index: i + 1,
      owed: appending && i < firstNew,
      baseSalary: built.baseSalaries[i] ?? 0,
      // NOT `proration()`. That is the per-year charge INSIDE the proration
      // window, and a deal longer than the window carries none of it in its
      // last seasons — printing it there put $9.56M of bonus against a year
      // whose cap hit was its base salary and nothing else. Read off the two
      // figures that are already true instead, so the column cannot disagree
      // with the row it is in.
      bonus: Math.max(0, capHit - (built.baseSalaries[i] ?? 0)),
      capHit,
    })),
    signingBonus: built.signingBonus,
    voidYears: built.voidYears,
    trusted,
  };
}
