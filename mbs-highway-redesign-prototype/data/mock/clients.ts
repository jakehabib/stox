/**
 * DEMO DATA — synthetic clients. No real borrower data.
 * Alex Rivera is the shared test scenario client used by every calculator.
 */
import { mulberry32 } from '@/lib/random';

export type FicoBand = '760+' | '740–759' | '720–739' | '700–719' | '680–699' | '660–679' | '640–659' | '620–639';
export const FICO_BANDS: FicoBand[] = ['760+', '740–759', '720–739', '700–719', '680–699', '660–679', '640–659', '620–639'];

export interface Client {
  id: string;
  name: string;
  primaryEmail: string;
  secondaryEmail?: string;
  phone?: string;
  fico: FicoBand;
  monthlyIncome?: number;
  dti?: number;
  updatedAt: string; // ISO
  lastSent?: string;
  lastActivity?: string;
  /** Last property/loan the client was run with — triggers the "use saved data" dialog. */
  saved?: { price: number; loanAmount: number; ratePct: number; locationId: string };
}

export const ALEX_RIVERA: Client = {
  id: 'c-alex-rivera',
  name: 'Alex Rivera',
  primaryEmail: 'alex.rivera.test@example.com',
  phone: '(555) 555-0142',
  fico: '720–739',
  monthlyIncome: 12500,
  dti: 36,
  updatedAt: '2026-10-14T14:05:00.000Z',
  lastSent: undefined,
  lastActivity: undefined,
  saved: { price: 500000, loanAmount: 400000, ratePct: 6.5, locationId: 'dallas-tx-75201' },
};

const FIRST = ['Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Avery', 'Quinn', 'Jamie', 'Reese', 'Drew', 'Parker', 'Rowan', 'Skyler', 'Emerson', 'Hayden', 'Kendall', 'Logan', 'Peyton', 'Sage', 'Blake', 'Cameron', 'Dakota', 'Elliot', 'Finley', 'Harper'];
const LAST = ['Nguyen', 'Patel', 'Okafor', 'Lindqvist', 'Moreno', 'Kowalski', 'Haddad', 'Brennan', 'Castillo', 'Tanaka', 'Fischer', 'Adeyemi', 'Romano', 'Sullivan', 'Delgado', 'Novak', 'Achebe', 'Larsen', 'Whitaker', 'Iqbal', 'Ferreira', 'Kim', 'Abernathy', 'Duarte', 'Mbeki'];

function iso(base: number, daysAgo: number, rand: () => number) {
  return new Date(base - daysAgo * 86400000 - Math.floor(rand() * 86400000)).toISOString();
}

export function buildDemoClients(): Client[] {
  const rand = mulberry32(42);
  const base = Date.parse('2026-10-14T16:00:00.000Z');
  const out: Client[] = [ALEX_RIVERA];
  const used = new Set(['Alex Rivera']);
  while (out.length < 101) {
    const name = `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`;
    if (used.has(name)) continue;
    used.add(name);
    const updatedDays = Math.floor(rand() * 220) + 1;
    const sent = rand() > 0.35;
    const active = sent && rand() > 0.4;
    const slug = name.toLowerCase().replace(/[^a-z]+/g, '.');
    out.push({
      id: `c-${out.length}-${slug.replace(/\./g, '-')}`,
      name,
      primaryEmail: `${slug}.demo@example.com`,
      fico: FICO_BANDS[Math.floor(rand() * FICO_BANDS.length)],
      monthlyIncome: Math.round((5000 + rand() * 20000) / 100) * 100,
      dti: Math.round(20 + rand() * 25),
      updatedAt: iso(base, updatedDays, rand),
      lastSent: sent ? iso(base, Math.max(0, updatedDays - Math.floor(rand() * 10)), rand) : undefined,
      lastActivity: active ? iso(base, Math.max(0, updatedDays - Math.floor(rand() * 20)), rand) : undefined,
    });
  }
  return out;
}
