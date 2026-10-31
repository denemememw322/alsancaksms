import { describe, it, expect } from 'vitest';
import { parseTiers } from '../../supabase/functions/catalog-tiers/grizzly';

describe('parseTiers (provider price tiers)', () => {
  it('parses provider-keyed tiers, merges equal costs and sorts ascending', () => {
    const raw = { '187': { '0': { '11': { count: 20, price: 0.52 }, '12': { count: 78, price: 0.325 }, '13': { count: 5, price: 0.52 } } } };
    expect(parseTiers(raw, '187', '0')).toEqual([{ cost: 0.325, count: 78 }, { cost: 0.52, count: 25 }]);
  });
  it('parses the single-tier shape', () => {
    expect(parseTiers({ '1': { wa: { cost: 0.07, count: 40978 } } }, '1', 'wa')).toEqual([{ cost: 0.07, count: 40978 }]);
  });
  it('drops out-of-stock, zero and invalid prices', () => {
    const raw = { '1': { wa: { a: { count: 0, price: 1 }, b: { count: 5, price: 0 }, c: { count: 5, price: 'x' }, d: { count: 3, price: 0.1 } } } };
    expect(parseTiers(raw, '1', 'wa')).toEqual([{ cost: 0.1, count: 3 }]);
  });
  it('handles huge stock counts without overflow and missing nodes', () => {
    expect(parseTiers({ '1': { wa: { cost: 0.01, count: 2413105726 } } }, '1', 'wa')[0].count).toBe(2413105726);
    expect(parseTiers({}, '1', 'wa')).toEqual([]);
    expect(parseTiers('NO_NUMBERS', '1', 'wa')).toEqual([]);
  });
});
