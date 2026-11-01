// price-sync: keeps tiers, stock and prices in step with the provider (cron or admin).
// Prices follow the provider cost with the admin's ratio and never go below cost. Also refreshes USD/TRY from TCMB.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { CORS, json, providerCtx, fetchServicePrices, parseTiers, type ProviderCtx } from './grizzly.ts';

async function updateFx(db: ReturnType<typeof createClient>) {
  try {
    const { data: cur } = await db.from('exchange_rates').select('updated_at,is_manual').eq('id', 1).maybeSingle();
    if (cur?.is_manual) return;
    if (cur && Date.now() - new Date(cur.updated_at).getTime() < 6 * 3600_000) return;
    const res = await fetch('https://www.tcmb.gov.tr/kurlar/today.xml', { signal: AbortSignal.timeout(10_000) });
    const m = (await res.text()).match(/<Currency[^>]*Kod="USD"[^>]*>[\s\S]*?<ForexSelling>([\d.]+)<\/ForexSelling>/);
    if (m) await db.rpc('set_usd_try_auto', { p_rate: Number(m[1]), p_source: 'tcmb' });
  } catch { /* keep the previous rate */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const secret = req.headers.get('x-cron-secret');
  let allowed = false;
  if (secret) { const { data } = await db.rpc('check_cron_secret', { p: secret }); allowed = data === true; }
  if (!allowed) {
    const uc = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data } = await uc.rpc('current_user_is_admin');
    allowed = data === true;
  }
  if (!allowed) return json({ error: 'forbidden' }, 403);

  let limit = 25;
  try { const b = await req.json(); limit = Math.min(Math.max(Number(b?.limit) || 25, 1), 60); } catch { /* defaults */ }

  const { data: services } = await db.from('services').select('id,country_mode').eq('is_active', true)
    .order('last_price_sync_at', { ascending: true, nullsFirst: true }).limit(limit);
  const provCache = new Map<string, ProviderCtx | null>();
  const cmCache = new Map<string, Array<{ provider_country_id: string; country_id: string }>>();
  let synced = 0, failed = 0;

  for (const s of services ?? []) {
    try {
      const { data: m } = await db.from('provider_service_mappings').select('provider_id,provider_service_id').eq('service_id', s.id).limit(1).maybeSingle();
      if (!m) continue;
      if (!provCache.has(m.provider_id)) provCache.set(m.provider_id, await providerCtx(db, m.provider_id).catch(() => null));
      const p = provCache.get(m.provider_id);
      if (!p) { failed++; continue; }
      let cm = cmCache.get(m.provider_id);
      if (!cm) { const r = await db.from('provider_country_mappings').select('provider_country_id,country_id').eq('provider_id', m.provider_id); cm = r.data ?? []; cmCache.set(m.provider_id, cm); }
      const { ok, raw } = await fetchServicePrices(p, m.provider_service_id);
      if (!ok) { failed++; continue; }                       // unreachable: never zero out stock on an outage
      const { data: existing } = await db.from('service_country_availability').select('country_id').eq('service_id', s.id).eq('provider_id', m.provider_id);
      const targets = new Set((existing ?? []).map((e: { country_id: string }) => e.country_id));
      if (s.country_mode === 'all') for (const c of cm) if (raw?.[c.provider_country_id] && typeof raw[c.provider_country_id] === 'object') targets.add(c.country_id);
      const toProv = new Map(cm.map((c) => [c.country_id, c.provider_country_id]));
      const jobs = [...targets].map((cid) => ({ cid, tiers: toProv.get(cid) ? parseTiers(raw, toProv.get(cid)!, m.provider_service_id) : [] }));
      for (let i = 0; i < jobs.length; i += 10) {
        await Promise.all(jobs.slice(i, i + 10).map((j) => db.rpc('upsert_tiers', { p_provider: m.provider_id, p_service: s.id, p_country: j.cid, p_tiers: j.tiers, p_enable_new: true })));
      }
      await db.from('services').update({ last_price_sync_at: new Date().toISOString() }).eq('id', s.id);
      synced++;
    } catch { failed++; }
  }
  await updateFx(db);
  return json({ synced, failed });
});
