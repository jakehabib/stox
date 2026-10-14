import { describe, expect, it } from 'vitest';
import {
  balanceSeries,
  calcDebtConsolidation,
  DEBT_CONSOLIDATION_DEFAULTS as D,
  debtPayoff,
  existingStatus,
  futureValueMonthly,
  monthsBetween,
  newDebt,
  summarizeDebts,
} from './debtConsolidation';

/*
 * BUILT TO SPEC — the live session never reached Debt Consolidation results (Debt 2 could
 * not be added), so these cases verify the standard model on the spec debts plus the demo
 * existing-home defaults, not live numbers.
 */
const asOf = new Date('2026-10-14T12:00:00');
const r = Math.round;

describe('spec debts', () => {
  it('Credit Card $8,000 @ 22% / $250 and Auto $15,000 @ 8% / $350 → $23,000, $600/mo', () => {
    const s = summarizeDebts(D.debts);
    expect(s.included.balance).toBe(23000);
    expect(s.included.payment).toBe(600);
    expect(s.included.count).toBe(2);
  });
  it('card pays off in 49 months ($4,158 interest), auto in 51 months ($2,724)', () => {
    const cc = debtPayoff(8000, 22, 250);
    const auto = debtPayoff(15000, 8, 350);
    expect(cc.months).toBe(49);
    expect(r(cc.interest)).toBe(4158);
    expect(auto.months).toBe(51);
    expect(r(auto.interest)).toBe(2724);
  });
  it('payment below interest never pays off (flagged, no infinite loop)', () => {
    expect(debtPayoff(10000, 24, 150).neverPaysOff).toBe(true);
    expect(debtPayoff(0, 10, 100).months).toBe(0);
  });
  it('Add new debt creates Debt N', () => {
    expect(newDebt(3).name).toBe('Debt 3');
    expect(newDebt(4).include).toBe(true);
  });
  it('excluded debts stay outside the consolidation', () => {
    const s = summarizeDebts(D.debts.map((d, i) => ({ ...d, include: i === 0 })));
    expect(s.included.balance).toBe(8000);
    expect(s.excluded.payment).toBe(350);
  });
});

describe('existing loan (demo defaults)', () => {
  it('months between purchase and as-of date', () => {
    expect(monthsBetween('2023-06-15', asOf)).toBe(39);
    expect(monthsBetween('2026-10-01', asOf)).toBe(0);
    expect(monthsBetween('bad', asOf)).toBe(0);
  });
  it('$368k @ 7.25% → P&I $2,510, balance $355,418 after 39 payments, equity $144,582', () => {
    const e = existingStatus(D.existing, asOf);
    expect(r(e.pi)).toBe(2510);
    expect(r(e.balance)).toBe(355418);
    expect(r(e.equity)).toBe(144582);
    expect(e.remainingMonths).toBe(321);
  });
});

describe('Refinance', () => {
  const a = calcDebtConsolidation(D, asOf);
  it('new loan = balance + $23k debts + $6k closing = $384,418 (76.9% LTV, within 80%)', () => {
    expect(r(a.newLoan.amount)).toBe(384418);
    expect(a.newLoan.ltvPct.toFixed(1)).toBe('76.9');
    expect(a.newLoan.exceedsMaxLtv).toBe(false);
    expect(a.warnings).toHaveLength(0);
  });
  it('monthly $3,960 → $3,280, saves $681/mo; DTI 31.7% → 26.2%', () => {
    expect(r(a.before.total)).toBe(3960);
    expect(r(a.after.total)).toBe(3280);
    expect(r(a.monthlySavings)).toBe(681);
    expect(a.before.dtiPct.toFixed(1)).toBe('31.7');
    expect(a.after.dtiPct.toFixed(1)).toBe('26.2');
  });
  it('honest long-run cost: new loan interest + closing exceeds keeping the old loan + debts by $38,998', () => {
    expect(r(a.interest.keepTotal)).toBe(457306);
    expect(r(a.interest.newTotalWithClosing)).toBe(496304);
    expect(r(a.interest.lifetimeDiff)).toBe(38998);
  });
  it('reinvesting the $681/mo savings into principal pays off in 205 months and saves $237,331 interest', () => {
    expect(a.reinvest.principal.payoffMonths).toBe(205);
    expect(r(a.reinvest.principal.interestSaved)).toBe(237331);
  });
  it('investing it at 6% for 10 years grows to $111,541', () => expect(r(a.reinvest.invest.futureValue)).toBe(111541));
  it('flags a consolidation above max LTV', () => {
    const big = calcDebtConsolidation({ ...D, debts: [...D.debts, { id: 'x', name: 'Debt 3', type: 'Other', balance: 60000, payment: 900, ratePct: 12, include: true }] }, asOf);
    expect(big.newLoan.exceedsMaxLtv).toBe(true);
    expect(big.warnings[0]).toMatch(/max cash-out LTV/);
  });
});

describe('Move-Up Purchase', () => {
  const m = calcDebtConsolidation({ ...D, tab: 'moveup' }, asOf);
  it('sell $500k − 6% − payoff → net proceeds $114,582', () => {
    expect(r(m.moveUp!.costToSell)).toBe(30000);
    expect(r(m.moveUp!.netProceeds)).toBe(114582);
  });
  it('buy $650k: closing $19,500, debts $23k paid → $72,082 down (11.09%), loan $577,918, MI 0.44%', () => {
    expect(r(m.moveUp!.down)).toBe(72082);
    expect(m.moveUp!.downPct.toFixed(2)).toBe('11.09');
    expect(r(m.newLoan.amount)).toBe(577918);
    expect(m.newLoan.miRatePct).toBe(0.44);
  });
  it('consolidating saves $446/mo vs moving up without it; DTI 43.6% → 40.1%', () => {
    expect(r(m.moveUp!.savingsVsAlt)).toBe(446);
    expect(m.moveUp!.alt.dtiPct.toFixed(1)).toBe('43.6');
    expect(m.after.dtiPct.toFixed(1)).toBe('40.1');
  });
  it('shortfall when proceeds cannot cover closing + debts', () => {
    const s = calcDebtConsolidation({ ...D, tab: 'moveup', existing: { ...D.existing, estValue: 380000 } }, asOf);
    expect(s.moveUp!.shortfall).toBeGreaterThan(0);
    expect(s.warnings.join(' ')).toMatch(/short/);
  });
});

describe('helpers & guards', () => {
  it('future value of $100/mo at 0% and 6%', () => {
    expect(futureValueMonthly(100, 0, 12)).toBe(1200);
    expect(r(futureValueMonthly(100, 6, 12))).toBe(1234);
  });
  it('balance series starts at the loan and ends at 0', () => {
    const s = balanceSeries(calcDebtConsolidation(D, asOf));
    expect(r(s[0].standard)).toBe(384418);
    expect(s[s.length - 1].standard).toBeLessThan(1);
    expect(s[20].accelerated).toBe(0);
  });
  it('no NaN with empty inputs', () => {
    const z = calcDebtConsolidation(
      { ...D, monthlyIncome: 0, debts: [], existing: { ...D.existing, loanAmount: 0, estValue: 0, termYears: 0, ratePct: NaN }, refi: { ...D.refi, appraisedValue: 0 } },
      asOf,
    );
    for (const v of [z.monthlySavings, z.before.dtiPct, z.after.total, z.newLoan.ltvPct, z.interest.lifetimeDiff, z.reinvest.invest.futureValue]) expect(Number.isFinite(v)).toBe(true);
    const zm = calcDebtConsolidation({ ...D, tab: 'moveup', moveUp: { ...D.moveUp, newPrice: 0 } }, asOf);
    for (const v of [zm.moveUp!.downPct, zm.after.total, zm.newLoan.ltvPct]) expect(Number.isFinite(v)).toBe(true);
  });
});
