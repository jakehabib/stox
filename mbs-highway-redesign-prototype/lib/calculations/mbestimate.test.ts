import { describe, expect, it } from 'vitest';
import { estimateValue, getValue, marketFor, UNABLE_MESSAGE, validateAddress, valuationCsv } from './mbestimate';

describe('address validation', () => {
  it('town-level "Marlboro, NJ 07746" → unable to provide a valuation', () => {
    const r = getValue('Marlboro, NJ 07746');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("We're unable to provide a valuation for this location. Enter a full street address.");
    expect(UNABLE_MESSAGE).toContain('unable to provide a valuation');
  });
  it.each(['07746', 'Marlboro', 'NJ', '123', '07746 Marlboro', '07746 NJ', '12 NJ', 'Dallas, TX 75201', '   '])('rejects "%s"', (s) => {
    expect(validateAddress(s).ok).toBe(false);
  });
  it.each(['18 Pine Brook Rd, Marlboro, NJ 07746', '1418 Elm Hollow Dr, Dallas, TX 75201', '7 Main Street', '221B Baker St', '12-14 Ocean Ave, Long Branch, NJ'])('accepts "%s"', (s) => {
    expect(validateAddress(s).ok).toBe(true);
  });
  it('parses number / street / zip', () => {
    const v = validateAddress(' 18  Pine Brook Rd,  Marlboro, NJ 07746 ');
    expect(v.ok && v.address.number).toBe('18');
    expect(v.ok && v.address.street).toBe('Pine Brook Rd');
    expect(v.ok && v.address.zip).toBe('07746');
  });
  it('empty input asks for an address', () => {
    const r = getValue('');
    expect(!r.ok && r.message).toBe('Enter an address to get a value.');
  });
});

describe('mock AVM', () => {
  const a = (s: string) => {
    const v = validateAddress(s);
    if (!v.ok) throw new Error('bad');
    return v.address;
  };
  it('is deterministic per address (and ignores spacing/case)', () => {
    const x = estimateValue(a('18 Pine Brook Rd, Marlboro, NJ 07746'));
    const y = estimateValue(a('18  pine brook rd, marlboro, nj 07746'));
    expect(y.estimate).toBe(x.estimate);
    expect(y.comps).toEqual(x.comps);
  });
  it('different addresses give different values', () => {
    expect(estimateValue(a('18 Pine Brook Rd, Marlboro, NJ 07746')).estimate).not.toBe(estimateValue(a('20 Pine Brook Rd, Marlboro, NJ 07746')).estimate);
  });
  it('matches the market by ZIP, then city, else national model', () => {
    expect(marketFor(a('18 Pine Brook Rd, Marlboro, NJ 07746')).label).toBe('Marlboro, NJ 07746');
    expect(marketFor(a('5 Elm St, Dallas, TX')).label).toBe('Dallas, TX 75201');
    expect(marketFor(a('5 Elm St, Boise, ID 83702')).locationId).toBeNull();
  });
  it('estimate sits inside low/high; Marlboro values near its market; Dallas lower', () => {
    const m = estimateValue(a('18 Pine Brook Rd, Marlboro, NJ 07746'));
    const d = estimateValue(a('1418 Elm Hollow Dr, Dallas, TX 75201'));
    for (const v of [m, d]) {
      expect(v.low).toBeLessThan(v.estimate);
      expect(v.high).toBeGreaterThan(v.estimate);
      expect(v.confidence).toBeGreaterThanOrEqual(74);
      expect(v.confidence).toBeLessThanOrEqual(96);
      expect(v.comps).toHaveLength(5);
      expect(v.trend).toHaveLength(25);
      expect(v.trend[24].value).toBe(v.estimate);
      expect(v.estimate % 1000).toBe(0);
    }
    expect(m.estimate).toBeGreaterThan(500000);
    expect(d.estimate).toBeLessThan(m.estimate);
  });
  it('comps are sorted by distance and have consistent $/sq ft', () => {
    const v = estimateValue(a('18 Pine Brook Rd, Marlboro, NJ 07746'));
    for (let i = 1; i < v.comps.length; i++) expect(v.comps[i].distanceMi).toBeGreaterThanOrEqual(v.comps[i - 1].distanceMi);
    for (const c of v.comps) expect(c.pricePerSqft).toBe(Math.round(c.price / c.sqft));
  });
  it('CSV export includes value and comps', () => {
    const v = estimateValue(a('18 Pine Brook Rd, Marlboro, NJ 07746'));
    const rows = valuationCsv(v, 'Dana Whitfield');
    expect(rows.find((r) => r[0] === 'Estimated value')?.[1]).toBe(v.estimate);
    expect(rows.find((r) => r[0] === 'Co-branded agent')?.[1]).toBe('Dana Whitfield');
  });
});
