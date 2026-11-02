// Shared GrizzlySMS helpers (copied into each function bundle). The API key never leaves the server.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { parseTiers, parseServices, pickCountryTiers, type Tier } from './parse.ts';
export { parseTiers, parseServices, pickCountryTiers };
export type { Tier };

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const isPrivateIp = (ip: string) =>
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) ||
  ip === '::1' || /^f[cd]/i.test(ip) || /^fe80/i.test(ip);

export async function assertSafeUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== 'https:') throw new Error('Provider URL must use https');
  if (u.username || u.password) throw new Error('Credentials in URL are not allowed');
  const h = u.hostname;
  if (h === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) throw new Error('IP/localhost hosts are not allowed');
  for (const t of ['A', 'AAAA'] as const) {
    try { if ((await Deno.resolveDns(h, t)).some(isPrivateIp)) throw new Error('Provider host resolves to a private address'); }
    catch (e) { if (e instanceof Error && e.message.startsWith('Provider host')) throw e; }
  }
  return u;
}

/** Returns parsed JSON or trimmed text. Throws only on transport problems / HTTP errors (=> outcome unknown). */
export async function gcall(base: URL, key: string, params: Record<string, string>, timeoutMs: number): Promise<any> {
  const url = new URL(base.toString());
  url.searchParams.set('api_key', key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  if (res.status >= 300 && res.status < 400) throw new Error('Provider returned a redirect (blocked)');
  const text = (await res.text()).trim();
  if (!res.ok) throw new Error(`Provider HTTP ${res.status}`);
  try { return JSON.parse(text); } catch { return text; }
}

export interface ProviderCtx { base: URL; key: string; timeout: number; providerId: string; cancelDelay: number }
export async function providerCtx(db: SupabaseClient, providerId: string): Promise<ProviderCtx | null> {
  const { data: prov } = await db.from('providers').select('base_url,request_timeout_ms,cancel_delay_seconds').eq('id', providerId).maybeSingle();
  if (!prov?.base_url) return null;
  const { data: key } = await db.rpc('get_provider_secret', { p_provider_id: providerId, p_key: 'api_key' });
  if (!key) return null;
  return { base: await assertSafeUrl(prov.base_url), key, providerId, cancelDelay: Number(prov.cancel_delay_seconds ?? 120), timeout: Math.min(Math.max(prov.request_timeout_ms ?? 15000, 3000), 60000) };
}

/**
 * Every country that currently has numbers for one platform, with ALL its price options.
 * getPricesV2 lists every option ({"0.165": 76005, ...}); getPricesV3 only the cheapest. V2 wins, V3/v1 are fallbacks.
 * ok=false means the provider could not be reached (never treat that as "no stock").
 */
export async function fetchServiceTiers(p: ProviderCtx, code: string): Promise<{ ok: boolean; byCountry: Map<string, Tier[]> }> {
  const call = async (action: string) => {
    try {
      const raw = await gcall(p.base, p.key, { action, service: code }, Math.max(p.timeout, 30000));
      return { ok: true, raw: raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {} };
    } catch { return { ok: false, raw: {} as Record<string, unknown> }; }
  };
  const [v2, v3] = await Promise.all([call('getPricesV2'), call('getPricesV3')]);
  const v1 = !Object.keys(v2.raw).length && !Object.keys(v3.raw).length ? await call('getPrices') : { ok: false, raw: {} as Record<string, unknown> };
  const byCountry = new Map<string, Tier[]>();
  for (const cid of new Set([...Object.keys(v2.raw), ...Object.keys(v3.raw), ...Object.keys(v1.raw)])) {
    const t = pickCountryTiers([v2.raw, v3.raw, v1.raw], cid, code);
    if (t.length) byCountry.set(cid, t);
  }
  return { ok: v2.ok || v3.ok || v1.ok, byCountry };
}

export interface Ctx { base: URL; key: string; providerId: string; svcCode: string; ctyCode: string; timeout: number; cancelDelay: number; serviceName: string; countryName: string }
export async function loadCtx(db: SupabaseClient, serviceId: string, countryId: string): Promise<Ctx | null> {
  const { data: a } = await db.from('service_country_availability').select('provider_id')
    .eq('service_id', serviceId).eq('country_id', countryId).eq('is_enabled', true).limit(1).maybeSingle();
  if (!a) return null;
  const [p, sm, cm, svc, cty] = await Promise.all([
    providerCtx(db, a.provider_id),
    db.from('provider_service_mappings').select('provider_service_id').eq('provider_id', a.provider_id).eq('service_id', serviceId).maybeSingle(),
    db.from('provider_country_mappings').select('provider_country_id').eq('provider_id', a.provider_id).eq('country_id', countryId).maybeSingle(),
    db.from('services').select('name').eq('id', serviceId).maybeSingle(),
    db.from('countries').select('name').eq('id', countryId).maybeSingle(),
  ]);
  if (!p || !sm.data || !cm.data) return null;
  return {
    base: p.base, key: p.key, providerId: a.provider_id, timeout: Math.min(p.timeout, 30000), cancelDelay: p.cancelDelay,
    svcCode: sm.data.provider_service_id, ctyCode: cm.data.provider_country_id,
    serviceName: svc.data?.name ?? '', countryName: cty.data?.name ?? '',
  };
}

/**
 * Customer view of one service+country. The provider's live options are first written to the database
 * (so cost, stock and the admin's ratio/ticks are always in step), then the enabled, in-stock options are read back.
 * Sell price = provider cost x admin ratio, never below cost. Equal sell prices are merged.
 * Returns null when the provider cannot be reached (callers must not treat that as "out of stock").
 */
export async function liveTiers(db: SupabaseClient, ctx: Ctx, serviceId: string, countryId: string) {
  const call = async (action: string) => {
    try { return { ok: true, raw: await gcall(ctx.base, ctx.key, { action, service: ctx.svcCode, country: ctx.ctyCode }, ctx.timeout) }; }
    catch { return { ok: false, raw: null as unknown }; }
  };
  const [v2, v3] = await Promise.all([call('getPricesV2'), call('getPricesV3')]);
  let reached = v2.ok || v3.ok;
  let tiers = pickCountryTiers([v2.raw, v3.raw], ctx.ctyCode, ctx.svcCode);
  if (!tiers.length) { const v1 = await call('getPrices'); reached = reached || v1.ok; tiers = pickCountryTiers([v1.raw], ctx.ctyCode, ctx.svcCode); }
  if (!reached) return null;
  await db.rpc('upsert_tiers', { p_provider: ctx.providerId, p_service: serviceId, p_country: countryId, p_tiers: tiers, p_enable_new: true });
  const { data } = await db.rpc('quote_tiers', { p_service: serviceId, p_country: countryId });
  const groups = new Map<number, { retail: number; cost: number; count: number }>();
  for (const r of (data ?? []) as Array<{ cost: string | number; quantity: string | number; retail: string | number }>) {
    const retail = Number(r.retail), cost = Number(r.cost), qty = Number(r.quantity);
    if (!(retail > 0) || !(cost > 0) || !(qty > 0)) continue;
    const g = groups.get(retail);
    groups.set(retail, g ? { retail, cost: Math.max(g.cost, cost), count: g.count + qty } : { retail, cost, count: qty });
  }
  return [...groups.values()].sort((a, b) => a.retail - b.retail);
}
