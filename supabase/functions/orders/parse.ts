// Pure helpers (no runtime-specific APIs) so they can be unit-tested in the web test suite.
export interface Tier { cost: number; count: number }

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Format-tolerant price tier parser. Understands:
 *  - { cost|price, count|physicalCount|quantity|amount|stock }            (single tier)
 *  - { "<providerId>": { price, count }, ... }                             (provider-keyed tiers)
 *  - { "1.49": 15229, "0.66": 2000 }                                       (price -> count map)
 *  - arrays of any of the above, optionally nested under { country: { service: ... } }
 */
export function parseTiers(raw: any, country: string, service: string): Tier[] {
  const acc = new Map<number, number>();
  const add = (cost: number | null, count: number | null) => {
    if (cost != null && count != null && cost > 0 && cost < 10000 && count > 0) acc.set(cost, (acc.get(cost) ?? 0) + count);
  };
  const walk = (node: any, depth: number) => {
    if (node == null || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, depth + 1)); return; }
    const cost = num(node.cost ?? node.price);
    const count = num(node.count ?? node.physicalCount ?? node.quantity ?? node.amount ?? node.stock);
    if (cost != null && count != null) { add(cost, count); return; }
    for (const [k, v] of Object.entries(node)) {
      if (/^\d+(\.\d+)?$/.test(k) && typeof v !== 'object' && num(v) != null) add(Number(k), num(v));
      else walk(v, depth + 1);
    }
  };
  // only index into plain objects (indexing an array by a country id would silently pick one element)
  const pick = (o: any, k: string) => (o && typeof o === 'object' && !Array.isArray(o) ? o[k] : undefined);
  walk(pick(pick(raw, country), service) ?? pick(raw, country) ?? raw, 0);
  return [...acc].map(([cost, count]) => ({ cost, count })).sort((a, b) => a.cost - b.cost);
}
