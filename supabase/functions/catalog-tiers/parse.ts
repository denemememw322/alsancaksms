// Pure helpers (no runtime-specific APIs) so they can be unit-tested in the web test suite.
export interface Tier { cost: number; count: number }
export function parseTiers(raw: any, country: string, service: string): Tier[] {
  const node = raw?.[country]?.[service] ?? null;
  const acc = new Map<number, number>();
  const push = (v: any) => {
    const cost = Number(v?.cost ?? v?.price), n = Number(v?.count ?? v?.physicalCount ?? 0);
    if (Number.isFinite(cost) && cost > 0 && n > 0) acc.set(cost, (acc.get(cost) ?? 0) + n);
  };
  if (Array.isArray(node)) node.forEach(push);
  else if (node && typeof node === 'object') ('cost' in node || 'price' in node) ? push(node) : Object.values(node).forEach(push);
  return [...acc].map(([cost, count]) => ({ cost, count })).sort((a, b) => a.cost - b.cost);
}
