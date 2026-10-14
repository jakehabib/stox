/**
 * DEMO DATA — saved meeting recordings. Folder counts match the live session:
 * General 2, Buy vs Rent 1, Loan Comparison 2, Markets Overview 1, RERC 11.
 * Client names are synthetic.
 */
import type { Recording, RecordingFolder } from '@/lib/calculations/recordings';

export const RECORDING_FOLDERS: RecordingFolder[] = [
  { id: 'general', name: 'General' },
  { id: 'buy-vs-rent', name: 'Buy vs Rent' },
  { id: 'loan-comparison', name: 'Loan Comparison' },
  { id: 'markets-overview', name: 'Markets Overview' },
  { id: 'rerc', name: 'RERC' },
];

const r = (id: string, folderId: string, title: string, clientName: string, durationSec: number, recordedAt: string, toolLabel: string): Recording => ({
  id,
  folderId,
  title,
  clientName,
  durationSec,
  recordedAt: new Date(recordedAt).toISOString(),
  toolLabel,
});

export const RECORDINGS_SEED: Recording[] = [
  r('rec-01', 'general', 'Intro call — first-time buyer game plan', 'Alex Rivera', 1312, '2026-10-13T15:20:00Z', 'Highway Meeting'),
  r('rec-02', 'general', 'Pre-approval walkthrough', 'Jordan Nguyen', 948, '2026-09-29T18:05:00Z', 'Highway Meeting'),

  r('rec-03', 'buy-vs-rent', 'Buy vs Rent — $500k vs $2,800/mo', 'Alex Rivera', 1105, '2026-10-14T13:31:00Z', 'Buy vs Rent'),

  r('rec-04', 'loan-comparison', 'Loan Comparison — 30-yr fixed vs 7/1 ARM', 'Alex Rivera', 1486, '2026-10-14T13:40:00Z', 'Loan Comparison'),
  r('rec-05', 'loan-comparison', 'Points vs no points review', 'Taylor Patel', 1023, '2026-10-02T16:45:00Z', 'Loan Comparison'),

  r('rec-06', 'markets-overview', 'Why rates moved this week', 'Morgan Okafor', 612, '2026-10-09T14:10:00Z', 'Markets Overview'),

  r('rec-07', 'rerc', 'Marlboro, NJ 07746 — market report card', 'Casey Lindqvist', 734, '2026-10-14T13:52:00Z', 'Real Estate Report Card'),
  r('rec-08', 'rerc', 'Holmdel, NJ 07733 — inventory & pricing', 'Riley Moreno', 655, '2026-10-11T17:25:00Z', 'Real Estate Report Card'),
  r('rec-09', 'rerc', 'Freehold, NJ 07728 — days on market', 'Avery Kowalski', 802, '2026-10-08T15:00:00Z', 'Real Estate Report Card'),
  r('rec-10', 'rerc', 'Dallas, TX 75201 — price trends', 'Quinn Haddad', 921, '2026-10-06T19:40:00Z', 'Real Estate Report Card'),
  r('rec-11', 'rerc', 'Red Bank, NJ 07701 — seller’s market check', 'Jamie Brennan', 588, '2026-10-01T13:15:00Z', 'Real Estate Report Card'),
  r('rec-12', 'rerc', 'Manalapan, NJ 07726 — new listings', 'Reese Castillo', 697, '2026-09-26T16:30:00Z', 'Real Estate Report Card'),
  r('rec-13', 'rerc', 'Middletown, NJ 07748 — months of supply', 'Drew Tanaka', 743, '2026-09-22T14:50:00Z', 'Real Estate Report Card'),
  r('rec-14', 'rerc', 'Plano, TX 75024 — appreciation outlook', 'Parker Fischer', 866, '2026-09-18T18:20:00Z', 'Real Estate Report Card'),
  r('rec-15', 'rerc', 'Colts Neck, NJ 07722 — luxury segment', 'Rowan Adeyemi', 1012, '2026-09-15T15:35:00Z', 'Real Estate Report Card'),
  r('rec-16', 'rerc', 'Asbury Park, NJ 07712 — first-time buyers', 'Skyler Romano', 640, '2026-09-10T17:05:00Z', 'Real Estate Report Card'),
  r('rec-17', 'rerc', 'Marlboro, NJ 07746 — follow-up review', 'Casey Lindqvist', 529, '2026-09-04T14:00:00Z', 'Real Estate Report Card'),
];
