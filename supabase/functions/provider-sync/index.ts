// provider-sync: admin-only. Actions: "test" (getBalance) and "sync" (countries + services + prices).
// Adapter: GrizzlySMS / sms-activate compatible (single endpoint, ?action=..., api_key query param).
// The API key is read server-side from Supabase Vault via get_provider_secret (service_role only)
// and is never logged or returned.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ---------- SSRF guard ----------
const isPrivateIp = (ip: string) =>
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) ||
  ip === '::1' || /^f[cd]/i.test(ip) || /^fe80/i.test(ip);

async function assertSafeUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== 'https:') throw new Error('Provider URL must use https');
  if (u.username || u.password) throw new Error('Credentials in URL are not allowed');
  const host = u.hostname;
  if (host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) throw new Error('IP/localhost hosts are not allowed');
  for (const type of ['A', 'AAAA'] as const) {
    try {
      const ips = await Deno.resolveDns(host, type);
      if (ips.some(isPrivateIp)) throw new Error('Provider host resolves to a private address');
    } catch (e) { if (e instanceof Error && e.message.startsWith('Provider host')) throw e; }
  }
  return u;
}

// ---------- GrizzlySMS client ----------
async function call(base: URL, key: string, params: Record<string, string>, timeoutMs: number) {
  const url = new URL(base.toString());
  url.searchParams.set('api_key', key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  if (res.status >= 300 && res.status < 400) throw new Error('Provider returned a redirect (blocked)');
  const text = await res.text();
  if (!res.ok) throw new Error(`Provider HTTP ${res.status}: ${clean(text, key)}`);
  const t = text.trim();
  if (/^(BAD_KEY|NO_KEY|BANNED|ERROR_SQL|SERVICE_UNAVAILABLE_REGION|USERS_IP_IS_NOT_ALLOWED|WRONG_)/.test(t)) throw new Error(`Provider error: ${t.slice(0, 80)}`);
  try { return JSON.parse(t); } catch { return t; }
}
const clean = (s: string, key: string) => s.replaceAll(key, '***').slice(0, 300);

// ---------- parsers (tolerant: formats verified at first live call, see sync logs) ----------
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const NAME2ISO = new Map<string, string>();
for (const a of A) for (const b of A) {
  const code = a + b; const n = regionNames.of(code);
  if (n && n !== code) NAME2ISO.set(n.toLowerCase(), code);
}
const ALIAS: Record<string, string> = {
  usa: 'US', 'united states of america': 'US', uk: 'GB', 'united kingdom': 'GB', england: 'GB', russia: 'RU', 'russian federation': 'RU',
  'czech republic': 'CZ', 'ivory coast': 'CI', "cote d'ivoire": 'CI', 'south korea': 'KR', korea: 'KR', 'north korea': 'KP', 'hong kong': 'HK',
  macau: 'MO', macao: 'MO', vietnam: 'VN', 'viet nam': 'VN', laos: 'LA', moldova: 'MD', 'dr congo': 'CD', 'congo (dem. rep.)': 'CD',
  'dem. republic of the congo': 'CD', congo: 'CG', 'republic of the congo': 'CG', 'timor-leste': 'TL', 'east timor': 'TL', 'cape verde': 'CV',
  swaziland: 'SZ', 'macedonia': 'MK', 'north macedonia': 'MK', turkey: 'TR', turkiye: 'TR', 'türkiye': 'TR', palestine: 'PS', 'syria': 'SY',
  'bosnia and herzegovina': 'BA', 'bosnia': 'BA', 'trinidad and tobago': 'TT', 'saint kitts and nevis': 'KN', 'st. kitts and nevis': 'KN',
  'saint lucia': 'LC', 'st. lucia': 'LC', 'saint vincent and the grenadines': 'VC', 'antigua and barbuda': 'AG', 'brunei': 'BN', 'burma': 'MM',
  myanmar: 'MM', 'the netherlands': 'NL', holland: 'NL', iran: 'IR', 'sao tome and principe': 'ST', 'guinea-bissau': 'GW', kosovo: 'XK',
  'uae': 'AE', 'united arab emirates': 'AE', bolivia: 'BO', venezuela: 'VE', tanzania: 'TZ', 'puerto rico': 'PR', reunion: 'RE', 'réunion': 'RE',
};
const flag = (iso: string) => /^[A-Z]{2}$/.test(iso) ? String.fromCodePoint(...[...iso].map((c) => 127397 + c.charCodeAt(0))) : '🌐';

function parseCountries(raw: unknown) {
  const arr: any[] = Array.isArray(raw) ? raw : (raw && typeof raw === 'object')
    ? ((raw as any).countries ?? (raw as any).data ?? Object.entries(raw as object).map(([k, v]) => (typeof v === 'object' ? { id: k, ...(v as object) } : { id: k, name: v })))
    : [];
  const out: Array<{ id: string; name: string; iso: string; flag: string }> = [];
  const seen = new Set<string>();
  for (const c of (Array.isArray(arr) ? arr : [])) {
    const id = String(c?.id ?? c?.country ?? '').trim();
    const name = String(c?.eng ?? c?.name ?? c?.title ?? c?.en ?? '').trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const iso = (typeof c?.iso === 'string' && /^[A-Za-z]{2}$/.test(c.iso) ? c.iso.toUpperCase() : null)
      ?? ALIAS[name.toLowerCase()] ?? NAME2ISO.get(name.toLowerCase()) ?? `X${id}`;
    out.push({ id, name, iso, flag: flag(iso) });
  }
  return out;
}

function parseServices(raw: unknown) {
  let list: any = raw;
  if (raw && !Array.isArray(raw) && typeof raw === 'object') {
    const o = raw as any;
    list = o.services ?? o.data ?? o.list ?? Object.entries(o).filter(([k]) => k !== 'status').map(([k, v]) => (typeof v === 'string' ? { code: k, name: v } : { code: k, ...(v as object) }));
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

// getPrices: { "<country>": { "<service>": { cost, count } } }
function parsePrices(raw: unknown) {
  const out: Array<{ c: string; s: string; cost: number; n: number }> = [];
  if (!raw || typeof raw !== 'object') return out;
  for (const [c, svcs] of Object.entries(raw as Record<string, any>)) {
    if (!svcs || typeof svcs !== 'object') continue;
    for (const [s, v] of Object.entries(svcs as Record<string, any>)) {
      const cost = Number(v?.cost ?? v?.price);
      const n = Number(v?.count ?? v?.physicalCount ?? 0);
      if (Number.isFinite(cost) && cost > 0) out.push({ c, s, cost, n: Number.isFinite(n) ? n : 0 });
    }
  }
  return out;
}

const describe = (v: unknown) => typeof v === 'string' ? `text(${v.length})` : Array.isArray(v) ? `array(${v.length})` : v && typeof v === 'object' ? `object(${Object.keys(v).length} keys)` : typeof v;

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';

  // authorization: caller must be a real signed-in admin (checked in the DB with their own JWT)
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: isAdmin, error: adminErr } = await userClient.rpc('current_user_is_admin');
  if (adminErr || isAdmin !== true) return json({ error: 'forbidden' }, 403);

  let body: { provider_id?: string; action?: string };
  try { body = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const { provider_id, action } = body;
  if (!provider_id || !['test', 'sync'].includes(action ?? '')) return json({ error: 'provider_id and action (test|sync) required' }, 400);

  const db = createClient(url, svcKey, { auth: { persistSession: false } });
  const { data: prov } = await db.from('providers').select('id,slug,base_url,request_timeout_ms').eq('id', provider_id).maybeSingle();
  if (!prov) return json({ error: 'provider not found' }, 404);
  if (!prov.base_url) return json({ ok: false, error: 'Provider has no API base URL' }, 400);
  const { data: key } = await db.rpc('get_provider_secret', { p_provider_id: provider_id, p_key: 'api_key' });
  if (!key) return json({ ok: false, status: 'not_configured', error: 'No API key saved for this provider' }, 400);

  const timeout = Math.min(Math.max(prov.request_timeout_ms ?? 15000, 3000), 60000);

  try {
    const base = await assertSafeUrl(prov.base_url);

    if (action === 'test') {
      const raw = await call(base, key, { action: 'getBalance' }, timeout);
      const m = typeof raw === 'string' ? raw.match(/^ACCESS_BALANCE:(.+)$/) : null;
      if (!m) throw new Error(`Unexpected balance response (${describe(raw)})`);
      await db.from('providers').update({ last_health_check: new Date().toISOString(), error_count: 0 }).eq('id', provider_id);
      return json({ ok: true, status: 'connected', balance: Number(m[1]) });
    }

    // sync: run in background, report progress through provider_sync_jobs / provider_sync_logs
    const { data: job } = await db.from('provider_sync_jobs').insert({ provider_id, job_type: 'full_catalog', status: 'running', started_at: new Date().toISOString() }).select('id').single();
    const jobId = job!.id as string;
    const log = (level: 'info' | 'warning' | 'error', message: string, details?: unknown) =>
      db.from('provider_sync_logs').insert({ sync_job_id: jobId, level, message, details: details ?? null });

    const work = (async () => {
      try {
        const rawC = await call(base, key, { action: 'getCountries' }, timeout);
        const countries = parseCountries(rawC);
        await log('info', `getCountries -> ${describe(rawC)}; parsed ${countries.length}`);
        const rawS = await call(base, key, { action: 'getServicesList' }, timeout);
        const services = parseServices(rawS);
        await log('info', `getServicesList -> ${describe(rawS)}; parsed ${services.length}`);
        if (!countries.length || !services.length) throw new Error('Could not parse countries/services from the provider response (see log lines above)');
        const first = await db.rpc('import_provider_catalog', { p_provider_id: provider_id, p_countries: countries, p_services: services, p_prices: [] });
        if (first.error) throw new Error(`import failed: ${first.error.message}`);
        await log('info', 'Countries and services imported', first.data);

        const rawP = await call(base, key, { action: 'getPrices' }, Math.max(timeout, 45000));
        const prices = parsePrices(rawP);
        await log('info', `getPrices -> ${describe(rawP)}; parsed ${prices.length} rows`);
        let done = 0;
        for (let i = 0; i < prices.length; i += 2000) {
          const r = await db.rpc('import_provider_catalog', { p_provider_id: provider_id, p_countries: [], p_services: [], p_prices: prices.slice(i, i + 2000) });
          if (r.error) throw new Error(`price import failed at ${i}: ${r.error.message}`);
          done += r.data?.price_rows_upserted ?? 0;
        }
        await db.from('provider_sync_jobs').update({ status: 'completed', completed_at: new Date().toISOString(), records_processed: prices.length, records_created: done }).eq('id', jobId);
        await db.from('providers').update({ last_successful_sync: new Date().toISOString(), last_health_check: new Date().toISOString(), error_count: 0 }).eq('id', provider_id);
        await log('info', `Done: ${countries.length} countries, ${services.length} services, ${done} price rows`);
      } catch (e) {
        const msg = clean(e instanceof Error ? e.message : String(e), key);
        await db.from('provider_sync_jobs').update({ status: 'failed', completed_at: new Date().toISOString(), error_message: msg }).eq('id', jobId);
        await log('error', msg);
      }
    })();
    // @ts-ignore EdgeRuntime is provided by the Supabase runtime
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work); else await work;
    return json({ ok: true, started: true, job_id: jobId }, 202);
  } catch (e) {
    const msg = clean(e instanceof Error ? e.message : String(e), key);
    await db.from('providers').update({ last_health_check: new Date().toISOString() }).eq('id', provider_id);
    return json({ ok: false, status: /BAD_KEY|NO_KEY/.test(msg) ? 'auth_failed' : 'api_error', error: msg }, 200);
  }
});
