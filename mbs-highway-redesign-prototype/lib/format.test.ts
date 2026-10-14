import { describe, expect, it } from 'vitest';
import { pct, usd, yearsMonths } from './format';

describe('format', () => {
  it('pct keeps integer zeros', () => {
    expect(pct(80, 0)).toBe('80%');
    expect(pct(100, 0)).toBe('100%');
    expect(pct(6.5, 3)).toBe('6.5%');
    expect(pct(2.48, 2, { sign: true })).toBe('+2.48%');
  });
  it('usd formats and never prints NaN', () => {
    expect(usd(2528.272, { cents: true })).toBe('$2,528.27');
    expect(usd(-45588)).toBe('-$45,588');
    expect(usd(NaN)).toBe('$0');
  });
  it('yearsMonths', () => expect(yearsMonths(109)).toBe('9y 1m'));
});
