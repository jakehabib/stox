/** DEMO DATA — dashboard seed content shared by the store and the dashboard. */
import type { SavedScenario } from '@/lib/store';

const t = (d: string) => new Date(d).toISOString();

/** "Recently Used Reports" — 11 entries, as observed on the live dashboard. */
export const RECENT_REPORTS_SEED: SavedScenario[] = [
  { id: 'r1', toolId: 'rerc', title: 'Marlboro, NJ 07746', savedAt: t('2026-10-14T13:52:00Z'), href: '/members/rerc' },
  { id: 'r2', toolId: 'loan-compare', title: '$500,000 · Dallas, TX', clientName: 'Alex Rivera', clientId: 'c-alex-rivera', savedAt: t('2026-10-14T13:40:00Z'), href: '/members/loan-compare' },
  { id: 'r3', toolId: 'buy-vs-rent', title: '$500,000 vs $2,800/mo rent', clientName: 'Alex Rivera', clientId: 'c-alex-rivera', savedAt: t('2026-10-14T13:31:00Z'), href: '/members/buy-vs-rent' },
  { id: 'r4', toolId: 'cost-of-waiting', title: 'Wait 12 months', clientName: 'Alex Rivera', clientId: 'c-alex-rivera', savedAt: t('2026-10-14T13:22:00Z'), href: '/members/cost-of-waiting' },
  { id: 'r5', toolId: 'purchase-analysis', title: '$500,000 · Dallas, TX', clientName: 'Alex Rivera', clientId: 'c-alex-rivera', savedAt: t('2026-10-14T13:10:00Z'), href: '/members/purchase-analysis' },
  { id: 'r6', toolId: 'appreciation', title: '$500,000 · Dallas, TX', clientName: 'Alex Rivera', clientId: 'c-alex-rivera', savedAt: t('2026-10-14T12:58:00Z'), href: '/members/appreciation' },
  { id: 'r7', toolId: 'equity-gained', title: '$500,000 · 6.5%', clientName: 'Alex Rivera', clientId: 'c-alex-rivera', savedAt: t('2026-10-14T12:47:00Z'), href: '/members/equity-gained' },
  { id: 'r8', toolId: 'arm-vs-fixed', title: '7/1 ARM vs 30-yr fixed', clientName: 'Alex Rivera', clientId: 'c-alex-rivera', savedAt: t('2026-10-14T12:35:00Z'), href: '/members/arm-vs-fixed' },
  { id: 'r9', toolId: 'reinvestment', title: '$100,000 + $269/mo', clientName: 'Alex Rivera', clientId: 'c-alex-rivera', savedAt: t('2026-10-14T12:20:00Z'), href: '/members/reinvestment' },
  { id: 'r10', toolId: 'bid-over-ask', title: '$25,000 over asking', clientName: 'Alex Rivera', clientId: 'c-alex-rivera', savedAt: t('2026-10-14T12:09:00Z'), href: '/members/bid-over-ask' },
  { id: 'r11', toolId: 'refi-cow-express', title: '7.5% → 6.5% refi', savedAt: t('2026-10-14T11:55:00Z'), href: '/members/refi-cow-express' },
];

/** Locked-in rates panel — industry locked-in averages, NOT a client's rate. */
export const LOCKED_IN_RATES = [
  { product: '30-Yr Fixed', rate: 7.25 },
  { product: '15-Yr Fixed', rate: 6.5 },
  { product: 'FHA', rate: 6.75 },
  { product: 'VA', rate: 6.5 },
  { product: 'Jumbo', rate: 7.75 },
];
