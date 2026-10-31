// catalog-tiers: public (anon key ok). Live stock/price tiers for one service+country. Returns customer prices only.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { CORS, json, loadCtx, liveTiers } from './grizzly.ts';

const cache = new Map<string, { at: number; body: unknown }>();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  let b: { service_id?: string; country_id?: string };
  try { b = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!b.service_id || !b.country_id || !uuid.test(b.service_id) || !uuid.test(b.country_id)) return json({ error: 'service_id and country_id required' }, 400);

  const ck = `${b.service_id}:${b.country_id}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < 20_000) return json(hit.body);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  try {
    const ctx = await loadCtx(db, b.service_id, b.country_id);
    if (!ctx) return json({ tiers: [], reason: 'unavailable' });
    const tiers = await liveTiers(db, ctx, b.service_id, b.country_id);
    const body = { tiers: tiers.map((t) => ({ quantity: t.count, price: t.retail })), reason: tiers.length ? null : 'out_of_stock' };
    cache.set(ck, { at: Date.now(), body });
    if (cache.size > 500) cache.clear();
    return json(body);
  } catch {
    return json({ tiers: [], reason: 'provider_unreachable' });
  }
});
