// Shared GrizzlySMS helpers (copied into each function bundle). API key never leaves the server.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

import { parseTiers, type Tier } from './parse.ts';
export { parseTiers };
export type { Tier };

export interface Ctx { base: URL; key: string; providerId: string; svcCode: string; ctyCode: string; timeout: number; serviceName: string; countryName: string }
export async function loadCtx(db: SupabaseClient, serviceId: string, countryId: string): Promise<Ctx | null> {
  const { data: a } = await db.from('service_country_availability').select('provider_id')
    .eq('service_id', serviceId).eq('country_id', countryId).eq('is_available', true).order('wholesale_cost').limit(1).maybeSingle();
  if (!a) return null;
  const [prov, sm, cm, svc, cty] = await Promise.all([
    db.from('providers').select('base_url,request_timeout_ms,is_active').eq('id', a.provider_id).maybeSingle(),
    db.from('provider_service_mappings').select('provider_service_id').eq('provider_id', a.provider_id).eq('service_id', serviceId).maybeSingle(),
    db.from('provider_country_mappings').select('provider_country_id').eq('provider_id', a.provider_id).eq('country_id', countryId).maybeSingle(),
    db.from('services').select('name').eq('id', serviceId).maybeSingle(),
    db.from('countries').select('name').eq('id', countryId).maybeSingle(),
  ]);
  if (!prov.data?.base_url || !sm.data || !cm.data) return null;
  const { data: key } = await db.rpc('get_provider_secret', { p_provider_id: a.provider_id, p_key: 'api_key' });
  if (!key) return null;
  return {
    base: await assertSafeUrl(prov.data.base_url), key, providerId: a.provider_id,
    svcCode: sm.data.provider_service_id, ctyCode: cm.data.provider_country_id,
    timeout: Math.min(Math.max(prov.data.request_timeout_ms ?? 15000, 3000), 30000),
    serviceName: svc.data?.name ?? '', countryName: cty.data?.name ?? '',
  };
}


// TEMPORARY diagnostics (admin-only log table): records the first few raw price responses that yield <2 tiers.
async function probe(db: SupabaseClient, action: string, ctx: Ctx, raw: unknown) {
  try {
    const { count } = await db.from('provider_sync_logs').select('id', { count: 'exact', head: true }).like('message', 'probe %');
    if ((count ?? 0) >= 12) return;
    const { data: job } = await db.from('provider_sync_jobs').select('id').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!job) return;
    await db.from('provider_sync_logs').insert({ sync_job_id: job.id, level: 'info', message: `probe ${action} svc=${ctx.svcCode} cty=${ctx.ctyCode}: ${JSON.stringify(raw).slice(0, 1500)}` });
  } catch { /* diagnostics must never break pricing */ }
}

/** Live provider tiers + server-side retail quote. Provider cost is never returned to callers of this helper's public output. */
export async function liveTiers(db: SupabaseClient, ctx: Ctx, serviceId: string, countryId: string) {
  // Try every price API version and keep the one that exposes the most tiers.
  let tiers: Tier[] = [];
  for (const action of ['getPricesV3', 'getPricesV2', 'getPrices']) {
    try {
      const raw = await gcall(ctx.base, ctx.key, { action, service: ctx.svcCode, country: ctx.ctyCode }, ctx.timeout);
      const t = parseTiers(raw, ctx.ctyCode, ctx.svcCode);
      if (t.length < 2) await probe(db, action, ctx, raw);
      if (t.length > tiers.length) tiers = t;
      if (tiers.length >= 2) break;
    } catch { /* try next action */ }
  }
  if (!tiers.length) return [];
  const { data } = await db.rpc('quote_retail', { p_service_id: serviceId, p_country_id: countryId, p_costs: tiers.map((t) => t.cost) });
  const retail: number[] = (data?.[0]?.retail ?? []).map(Number);
  return tiers.map((t, i) => ({ ...t, retail: retail[i] })).filter((t) => Number.isFinite(t.retail) && t.retail > 0);
}
