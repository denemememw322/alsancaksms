// catalog-admin: admin only. Actions: platforms | add
//  platforms -> live list of every platform the provider offers
//  add       -> add platforms; every country that really has numbers is added automatically (or only the chosen countries)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { CORS, json, gcall, providerCtx, fetchServicePrices, parseTiers, parseServices } from './grizzly.ts';

const UUID = /^[0-9a-f-]{36}$/i;
const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: isAdmin } = await userClient.rpc('current_user_is_admin');
  if (isAdmin !== true) return json({ error: 'forbidden' }, 403);

  let b: { action?: string; provider_id?: string; services?: Array<{ code: string; name: string }>; country_ids?: string[] };
  try { b = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }
  if (!b.provider_id || !UUID.test(b.provider_id)) return json({ error: 'provider_id required' }, 400);

  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const p = await providerCtx(db, b.provider_id).catch(() => null);
  if (!p) return json({ error: 'This provider has no API URL or API key yet. Configure it under API Providers first.' }, 400);

  try {
    if (b.action === 'platforms') {
      const raw = await gcall(p.base, p.key, { action: 'getServicesList' }, p.timeout);
      const list = parseServices(raw).sort((x, y) => x.name.localeCompare(y.name));
      if (!list.length) return json({ error: 'The provider returned no platforms.' }, 502);
      const { data: maps } = await db.from('provider_service_mappings').select('provider_service_id').eq('provider_id', b.provider_id);
      const added = new Set((maps ?? []).map((m: { provider_service_id: string }) => m.provider_service_id));
      return json({ platforms: list.map((s) => ({ ...s, added: added.has(s.code) })) });
    }

    if (b.action === 'add') {
      const services = (b.services ?? []).filter((s) => s?.code && s?.name).slice(0, 6);
      const sel = b.country_ids?.length ? new Set(b.country_ids.filter((c) => UUID.test(c))) : null;
      if (!services.length) return json({ error: 'no services' }, 400);
      const { data: cm } = await db.from('provider_country_mappings').select('provider_country_id,country_id').eq('provider_id', b.provider_id);
      const toInternal = new Map((cm ?? []).map((m: { provider_country_id: string; country_id: string }) => [m.provider_country_id, m.country_id]));

      const results = [];
      for (const s of services) {
        const { data: sid, error: e1 } = await db.rpc('admin_ensure_service', { p_provider: b.provider_id, p_code: s.code, p_name: s.name, p_mode: sel ? 'selected' : 'all' });
        if (e1 || !sid) { results.push({ code: s.code, name: s.name, error: 'could not create service' }); continue; }
        const { ok, raw } = await fetchServicePrices(p, s.code);
        if (!ok) { results.push({ code: s.code, name: s.name, error: 'provider unreachable' }); continue; }
        const jobs: Array<{ country: string; tiers: ReturnType<typeof parseTiers> }> = [];
        let unmapped = 0;
        for (const cid of Object.keys(raw)) {
          if (!raw[cid] || typeof raw[cid] !== 'object') continue;
          const internal = toInternal.get(cid);
          if (!internal) { unmapped++; continue; }
          if (sel && !sel.has(internal)) continue;
          const tiers = parseTiers(raw, cid, s.code);
          if (tiers.length) jobs.push({ country: internal, tiers });   // only countries that really have numbers
        }
        let countries = 0, tiers = 0;
        for (const part of chunks(jobs, 10)) {
          const res = await Promise.all(part.map((j) => db.rpc('upsert_tiers', { p_provider: b.provider_id, p_service: sid, p_country: j.country, p_tiers: j.tiers, p_enable_new: true })));
          res.forEach((r) => { if (!r.error) { countries++; tiers += Number(r.data ?? 0); } });
        }
        await db.from('services').update({ last_price_sync_at: new Date().toISOString() }).eq('id', sid);
        results.push({ code: s.code, name: s.name, service_id: sid, countries, tiers, unmapped_countries: unmapped });
      }
      return json({ results });
    }
    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.replaceAll(p.key, '***').slice(0, 200) : 'failed' }, 502);
  }
});
