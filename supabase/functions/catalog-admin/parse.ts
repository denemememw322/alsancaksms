// Pure helpers (no runtime-specific APIs) so they can be unit-tested in the web test suite.
export interface Tier { key: string; cost: number; count: number }

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Format-tolerant price tier parser. Every tier gets a stable key so admin settings survive price changes:
 *  - { cost|price, count|... }                   single tier                    -> key "default"
 *  - { "<providerId>": { price, count }, ... }   provider-keyed tiers           -> key "<providerId>"
 *  - { "1.49": 15229, "0.66": 2000 }             price -> count map (V2)        -> key "p:<price>"
 *  - { price, count, providers:{id:{price:[x],count}} }  (V3) grouped by price   -> key "p:<price>"
 *  - arrays of any of the above                                                 -> key "i<index>"
 *  optionally nested under { country: { service: ... } }
 */
export function parseTiers(raw: any, country: string, service: string): Tier[] {
  const acc = new Map<string, Tier>();
  const add = (key: string, cost: number | null, count: number | null) => {
    if (cost == null || count == null || cost <= 0 || cost >= 10000 || count <= 0) return;
    const e = acc.get(key);
    acc.set(key, e ? { key, cost: Math.min(e.cost, cost), count: e.count + count } : { key, cost, count });
  };
  const walk = (node: any, depth: number, hint: string) => {
    if (node == null || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) { node.forEach((n, i) => walk(n, depth + 1, `i${i}`)); return; }
    // getPricesV3: { price: <cheapest>, count: <total of all providers>, providers: { "<id>": { count, price: [x] } } }
    // The top-level price/count is only a summary; the real options are the providers' prices (grouped by price).
    if (node.providers && typeof node.providers === 'object' && !Array.isArray(node.providers)) {
      for (const p of Object.values(node.providers as Record<string, any>)) {
        const list: unknown[] = Array.isArray(p?.price) ? p.price : [p?.price];
        const prices: number[] = list.map(num).filter((x): x is number => x != null);
        const cnt = num(p?.count);
        if (cnt != null) prices.forEach((pr) => add(`p:${pr}`, pr, cnt / prices.length));
      }
      return;
    }
    const cost = num(node.cost ?? node.price);
    const count = num(node.count ?? node.physicalCount ?? node.quantity ?? node.amount ?? node.stock);
    if (cost != null && count != null) { add(String(node.provider_id ?? node.providerId ?? hint), cost, count); return; }
    for (const [k, v] of Object.entries(node)) {
      if (/^\d+(\.\d+)?$/.test(k) && typeof v !== 'object' && num(v) != null) add(`p:${k}`, Number(k), num(v));
      else walk(v, depth + 1, k);
    }
  };
  // only index into plain objects (indexing an array by a country id would silently pick one element)
  const pick = (o: any, k: string) => (o && typeof o === 'object' && !Array.isArray(o) ? o[k] : undefined);
  walk(pick(pick(raw, country), service) ?? pick(raw, country) ?? raw, 0, 'default');
  return [...acc.values()].sort((a, b) => a.cost - b.cost);
}

/** getServicesList: { status, services:[{code,name}] } or array/object variants */
export function parseServices(raw: any): Array<{ code: string; name: string }> {
  let list: any = raw;
  if (raw && !Array.isArray(raw) && typeof raw === 'object') {
    list = raw.services ?? raw.data ?? raw.list ??
      Object.entries(raw).filter(([k]) => k !== 'status').map(([k, v]) => (typeof v === 'string' ? { code: k, name: v } : { code: k, ...(v as object) }));
  }
  const out: Array<{ code: string; name: string }> = [];
  const seen = new Set<string>();
  for (const s of (Array.isArray(list) ? list : [])) {
    const code = String(s?.code ?? s?.id ?? '').trim();
    const name = String(s?.name ?? s?.title ?? '').trim();
    if (!code || !name || seen.has(code)) continue;
    seen.add(code); out.push({ code, name });
  }
  return out;
}

/** First source (in priority order) that yields tiers for this country+service, e.g. [getPricesV2, getPricesV3, getPrices]. */
export function pickCountryTiers(sources: any[], country: string, service: string): Tier[] {
  for (const s of sources) {
    const t = parseTiers(s, country, service);
    if (t.length) return t;
  }
  return [];
}
