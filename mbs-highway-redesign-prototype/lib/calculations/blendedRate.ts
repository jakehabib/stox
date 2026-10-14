/**
 * Blended Rate: balance-weighted average rate across up to 3 debts.
 * Monthly payment is an optional input and is only summed (never computed), as on the live site.
 */

export interface BlendedDebt {
  name: string;
  balance: number;
  ratePct: number;
  /** Optional, entered by the user. */
  payment: number;
}

export interface BlendedContribution {
  name: string;
  balance: number;
  ratePct: number;
  annualInterest: number;
  balanceShare: number;
  interestShare: number;
}

export interface BlendedResult {
  totalBalance: number;
  totalPayment: number;
  blendedRatePct: number;
  annualInterest: number;
  contributions: BlendedContribution[];
  /** Blended rate after the first k debts (k = 1..n). */
  running: number[];
}

export const MAX_DEBTS = 3;

const fin = (n: number) => (Number.isFinite(n) ? n : 0);

export function blendedRate(debts: BlendedDebt[]): BlendedResult {
  const list = debts.slice(0, MAX_DEBTS).map((d) => ({
    name: d.name,
    balance: Math.max(0, fin(d.balance)),
    ratePct: Math.max(0, fin(d.ratePct)),
    payment: Math.max(0, fin(d.payment)),
  }));
  let bal = 0;
  let weighted = 0;
  const running: number[] = [];
  for (const d of list) {
    bal += d.balance;
    weighted += d.balance * d.ratePct;
    running.push(bal > 0 ? weighted / bal : 0);
  }
  const annualInterest = list.reduce((s, d) => s + (d.balance * d.ratePct) / 100, 0);
  return {
    totalBalance: bal,
    totalPayment: list.reduce((s, d) => s + d.payment, 0),
    blendedRatePct: bal > 0 ? weighted / bal : 0,
    annualInterest,
    contributions: list.map((d) => {
      const ai = (d.balance * d.ratePct) / 100;
      return {
        name: d.name,
        balance: d.balance,
        ratePct: d.ratePct,
        annualInterest: ai,
        balanceShare: bal > 0 ? d.balance / bal : 0,
        interestShare: annualInterest > 0 ? ai / annualInterest : 0,
      };
    }),
    running,
  };
}
