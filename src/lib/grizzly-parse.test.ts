import { describe, it, expect } from 'vitest';
import { parseTiers, parseServices } from '../../supabase/functions/catalog-tiers/parse';

const k = (t: { key: string; cost: number; count: number }[]) => t.map((x) => `${x.key}:${x.cost}:${x.count}`);

describe('parseTiers (provider price tiers, stable keys)', () => {
  it('keys provider-keyed tiers by provider id and sorts by cost', () => {
    const raw = { '187': { '0': { '11': { count: 20, price: 0.52 }, '12': { count: 78, price: 0.325 }, '13': { count: 5, price: 0.52 } } } };
    expect(k(parseTiers(raw, '187', '0'))).toEqual(['12:0.325:78', '11:0.52:20', '13:0.52:5']);
  });
  it('single tier gets the "default" key and keeps its key when the cost changes', () => {
    expect(k(parseTiers({ '43': { abk: { price: 0.21, count: 206400 } } }, '43', 'abk'))).toEqual(['default:0.21:206400']);
    expect(k(parseTiers({ '43': { abk: { price: 0.17, count: 100 } } }, '43', 'abk'))).toEqual(['default:0.17:100']);
  });
  it('parses the v1 shape (cost/count/retry)', () => {
    expect(k(parseTiers({ '50': { abk: { count: 112501, cost: 0.35, retry: 0 } } }, '50', 'abk'))).toEqual(['default:0.35:112501']);
  });
  it('drops out-of-stock, zero and invalid prices', () => {
    const raw = { '1': { wa: { a: { count: 0, price: 1 }, b: { count: 5, price: 0 }, c: { count: 5, price: 'x' }, d: { count: 3, price: 0.1 } } } };
    expect(k(parseTiers(raw, '1', 'wa'))).toEqual(['d:0.1:3']);
  });
  it('handles huge stock counts and missing/odd responses', () => {
    expect(parseTiers({ '1': { wa: { cost: 0.01, count: 2413105726 } } }, '1', 'wa')[0].count).toBe(2413105726);
    expect(parseTiers({}, '1', 'wa')).toEqual([]);
    expect(parseTiers('NO_NUMBERS', '1', 'wa')).toEqual([]);
    expect(parseTiers(null, '1', 'wa')).toEqual([]);
  });
  it('parses a price -> count map with price keys', () => {
    expect(parseTiers({ '187': { '0': { '1.49': 15229, '0.66': 2000 } } }, '187', '0'))
      .toEqual([{ key: 'p:0.66', cost: 0.66, count: 2000 }, { key: 'p:1.49', cost: 1.49, count: 15229 }]);
  });
  it('falls back to the whole response when country/service keys are absent', () => {
    expect(parseTiers({ '1.2': 5, '0.9': 7 }, '187', '0').map((t) => t.cost)).toEqual([0.9, 1.2]);
  });
  it('parses arrays of tiers and string numbers without indexing the array by country id', () => {
    expect(k(parseTiers([{ price: '0.5', count: '10' }, { price: '0.7', count: '3' }], '1', 'wa'))).toEqual(['i0:0.5:10', 'i1:0.7:3']);
  });
});

describe('parseServices', () => {
  it('parses {status, services:[{code,name}]} and de-duplicates', () => {
    expect(parseServices({ status: 'success', services: [{ code: 'wa', name: 'WhatsApp' }, { code: 'wa', name: 'dup' }, { code: 'tg', name: 'Telegram' }] }))
      .toEqual([{ code: 'wa', name: 'WhatsApp' }, { code: 'tg', name: 'Telegram' }]);
  });
  it('returns [] for junk', () => { expect(parseServices('BAD_KEY')).toEqual([]); expect(parseServices(null)).toEqual([]); });
});

import { pickCountryTiers } from '../../supabase/functions/catalog-tiers/parse';

describe('pickCountryTiers (V2 lists every option, V3 only the cheapest)', () => {
  const v2 = { '33': { wa: { '0.1650': 76005, '0.1900': 5995, '1.5000': 4427 } } };
  const v3 = { '33': { wa: { price: 0.165, count: 76005 } } };
  it('prefers the V2 multi-option list', () => {
    const t = pickCountryTiers([v2, v3], '33', 'wa');
    expect(t.map((x) => x.cost)).toEqual([0.165, 0.19, 1.5]);
    expect(t.map((x) => x.key)).toEqual(['p:0.1650', 'p:0.1900', 'p:1.5000']);
  });
  it('falls back to V3 when V2 is null (e.g. getPricesV2 returned null for abk)', () => {
    expect(pickCountryTiers([null, { '43': { abk: { price: 0.21, count: 206400 } } }], '43', 'abk')).toEqual([{ key: 'default', cost: 0.21, count: 206400 }]);
  });
  it('returns [] when nothing has stock', () => { expect(pickCountryTiers([null, {}, 'NO_NUMBERS'], '1', 'wa')).toEqual([]); });
});

describe('parseTiers: real GrizzlySMS responses (captured 2026-11)', () => {
  // getPricesV3 for service wa, country 62: providers grouped by price must equal the V2 option set
  const v3c62 = { '62': { wa: { price: 0.89, count: 12703, providers: {
    '11': { count: 20, price: [3], provider_id: 11 }, '161': { count: 84, price: [3], provider_id: 161 }, '196': { count: 5660, price: [0.89], provider_id: 196 },
    '202': { count: 100, price: [1.89], provider_id: 202 }, '222': { count: 129, price: [3], provider_id: 222 }, '4': { count: 259, price: [5], provider_id: 4 } } } } };
  const v2c62 = { '62': { wa: { '0.8900': 5660, '1.8900': 100, '3.0000': 84, '5.0000': 259 } } };
  it('V3 providers are grouped by price into the same options V2 reports', () => {
    expect(parseTiers(v3c62, '62', 'wa').map((t) => t.cost)).toEqual([0.89, 1.89, 3, 5]);
    expect(parseTiers(v2c62, '62', 'wa').map((t) => t.cost)).toEqual([0.89, 1.89, 3, 5]);
  });
  it('does not use the V3 top-level summary (cheapest price + total count) as a single option', () => {
    const t = parseTiers(v3c62, '62', 'wa');
    expect(t).toHaveLength(4);
    expect(t.find((x) => x.cost === 3)?.count).toBe(233);
    expect(t.some((x) => x.count === 12703)).toBe(false);
  });
  it('V2 returning null (no country given) yields nothing, so V3 is the fallback', () => {
    expect(pickCountryTiers([null, v3c62], '62', 'wa')).toHaveLength(4);
  });
});
