import { describe, expect, it } from 'vitest';
import { RECORDINGS_SEED, RECORDING_FOLDERS } from '@/data/mock/recordings';
import { filterRecordings, folderCounts, formatDuration, moveRecording, renameRecording, totalDuration } from './recordings';

describe('folderCounts — live folder counts', () => {
  it('General 2, Buy vs Rent 1, Loan Comparison 2, Markets Overview 1, RERC 11', () => {
    expect(folderCounts(RECORDING_FOLDERS, RECORDINGS_SEED)).toEqual({ general: 2, 'buy-vs-rent': 1, 'loan-comparison': 2, 'markets-overview': 1, rerc: 11 });
    expect(RECORDINGS_SEED.length).toBe(17);
  });
  it('updates after a move', () => {
    const moved = moveRecording(RECORDINGS_SEED, 'rec-07', 'general');
    const c = folderCounts(RECORDING_FOLDERS, moved);
    expect(c.general).toBe(3);
    expect(c.rerc).toBe(10);
  });
});

describe('formatDuration', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(formatDuration(194)).toBe('3:14');
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
  it('guards bad input', () => {
    expect(formatDuration(NaN)).toBe('0:00');
    expect(formatDuration(-4)).toBe('0:00');
  });
});

describe('filterRecordings', () => {
  it('by folder', () => {
    expect(filterRecordings(RECORDINGS_SEED, 'rerc', '').length).toBe(11);
    expect(filterRecordings(RECORDINGS_SEED, 'all', '').length).toBe(17);
  });
  it('by query over title and client (case-insensitive)', () => {
    expect(filterRecordings(RECORDINGS_SEED, 'all', 'alex rivera').length).toBe(3);
    expect(filterRecordings(RECORDINGS_SEED, 'rerc', 'marlboro').length).toBe(2);
    expect(filterRecordings(RECORDINGS_SEED, 'all', 'zzz').length).toBe(0);
  });
  it('sorts', () => {
    expect(filterRecordings(RECORDINGS_SEED, 'all', '', 'newest')[0].id).toBe('rec-07');
    expect(filterRecordings(RECORDINGS_SEED, 'all', '', 'longest')[0].id).toBe('rec-04');
  });
});

describe('renameRecording', () => {
  it('renames, ignores blank', () => {
    expect(renameRecording(RECORDINGS_SEED, 'rec-01', '  New name ').find((r) => r.id === 'rec-01')?.title).toBe('New name');
    expect(renameRecording(RECORDINGS_SEED, 'rec-01', '   ')).toBe(RECORDINGS_SEED);
  });
});

describe('totalDuration', () => {
  it('sums', () => {
    expect(totalDuration(RECORDINGS_SEED.slice(0, 2))).toBe(2260);
    expect(totalDuration([])).toBe(0);
  });
});
