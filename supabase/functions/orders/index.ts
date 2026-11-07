// orders: signed-in users only. Actions: start | attempt | stop | change_price | refresh | cancel | complete.
//
// Buying mirrors the provider's own site: a "search" retries getNumber up to 600 times (one attempt per call, driven by
// the client so it can show "Attempt n of 600"). Funds are reserved when the search starts and returned in full when it
// ends without a number (the order is then stored as `no_number`, which customers never see; there is no "failed" order).
// If a number was obtained but no SMS arrives it becomes `cancelled`. Outcome-unknown provider errors => needs_review,
// never auto-refunded.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { CORS, json, loadCtx, liveTiers, gcall, deriveTimes } from './grizzly.ts';

const MAX_ATTEMPTS = 600;
const MIN_GAP_MS = 700;
const SAFE = 'id,service_name,country_name,status,retail_price,currency,phone_number,sms_code,sms_text,refunded_at,error_message,expires_at,cancel_available_at,search_attempts,created_at,completed_at';
const STOP_CODES = /^(NO_BALANCE|BAD_SERVICE|BAD_COUNTRY|WRONG_MAX_PRICE|WRONG_SERVICE|BANNED|The service is prohibited)/i;
const USER_MSG: Record<string, string> = {
  NO_BALANCE: 'This service is temporarily unavailable. Your balance was returned.',
  WRONG_MAX_PRICE: 'The price changed. Your balance was returned. Please try again.',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: u } = await userClient.auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return json({ error: 'Please sign in', code: 'auth' }, 401);

  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: prof } = await db.from('profiles').select('status').eq('id', uid).maybeSingle();
  if (prof && prof.status !== 'active') return json({ error: 'Your account is suspended.' }, 403);

  let b: Record<string, string | number | undefined>;
  try { b = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }

  const getOrder = async (id: string) => (await db.from('orders').select('*').eq('id', id).maybeSingle()).data;
  const pub = async (id: string) => (await db.from('orders').select(SAFE).eq('id', id).single()).data;
  const set = (id: string, to: string, note?: string) => db.rpc('order_set_status', { p_order: id, p_to: to, p_note: note ?? null });
  const refund = (id: string, why: string) => db.rpc('order_refund', { p_order: id, p_reason: why });
  const provider = async (o: { service_id: string | null; country_id: string | null }) => (o.service_id && o.country_id ? loadCtx(db, o.service_id, o.country_id) : null);
  const giveUp = async (id: string, note: string) => { await set(id, 'no_number', note); await refund(id, note); };
  const debit = (oid: string, amount: number, key: string, label: string) =>
    db.rpc('debit_wallet', { p_user_id: uid, p_amount: amount, p_reference_type: 'order', p_reference_id: oid, p_idempotency_key: key, p_description: label, p_metadata: {}, p_actor_id: null });
  const higher = (tiers: Array<{ retail: number; count: number }>, than: number) => tiers.filter((t) => t.retail > than).map((t) => ({ price: t.retail, quantity: t.count }));

  try {
    // ---------------- start a search (reserves the funds) ----------------
    if (b.action === 'start') {
      const { service_id, country_id, expected_price, idempotency_key } = b as Record<string, string>;
      if (!service_id || !country_id || !idempotency_key || !/^[\w-]{8,80}$/.test(idempotency_key) || !Number(expected_price)) return json({ error: 'invalid request' }, 400);

      const dup = await db.from('orders').select('id').eq('user_id', uid).eq('idempotency_key', idempotency_key).maybeSingle();
      if (dup.data) return json({ order: await pub(dup.data.id), max_attempts: MAX_ATTEMPTS, higher_options: [] });

      const { count: searching } = await db.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'searching');
      if ((searching ?? 0) >= 3) return json({ error: 'You already have searches running. Please wait for them to finish or cancel one.' }, 429);
      const since = new Date(Date.now() - 60_000).toISOString();
      const { count } = await db.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', uid).gte('created_at', since);
      if ((count ?? 0) >= 12) return json({ error: 'Too many requests. Please wait a minute.' }, 429);

      const ctx = await loadCtx(db, service_id, country_id);
      if (!ctx) return json({ error: 'This service is not available for the selected country.' }, 409);
      const tiers = await liveTiers(db, ctx, service_id, country_id);
      if (tiers === null) return json({ error: 'The provider is unreachable right now. Please try again.' }, 502);
      if (!tiers.length) return json({ error: 'Out of stock right now.' }, 409);
      const tier = tiers.find((t) => Math.abs(t.retail - Number(expected_price)) < 0.00005);
      if (!tier) return json({ error: 'The price changed. Please review the new prices.', code: 'price_changed' }, 409);

      const ins = await db.from('orders').insert({
        user_id: uid, service_id, country_id, provider_id: ctx.providerId, service_name: ctx.serviceName, country_name: ctx.countryName,
        idempotency_key, status: 'searching', retail_price: tier.retail, provider_cost: tier.cost, search_attempts: 0,
      }).select('id').single();
      if (ins.error) return json({ error: 'Could not start the search' }, 500);
      const oid = ins.data.id as string;

      const d = await debit(oid, tier.retail, `order:${oid}`, `${ctx.serviceName} / ${ctx.countryName}`);
      const ds = d.data?.[0]?.status;
      if (d.error || ds === 'error' || ds === 'insufficient_funds') {
        await db.from('orders').delete().eq('id', oid);          // nothing was charged: leave no record at all
        return ds === 'insufficient_funds'
          ? json({ error: 'Insufficient balance. Please add funds.', code: 'insufficient_funds' }, 402)
          : json({ error: 'Could not reserve your balance. Nothing was charged.' }, 500);
      }
      return json({ order: await pub(oid), max_attempts: MAX_ATTEMPTS, higher_options: higher(tiers, tier.retail) });
    }

    // ---------------- actions on an existing order ----------------
    const o = b.order_id ? await getOrder(String(b.order_id)) : null;
    if (!o) return json({ error: 'order not found' }, 404);
    if (o.user_id !== uid) {
      const { data: adm } = await userClient.rpc('current_user_is_admin');
      if (adm !== true) return json({ error: 'order not found' }, 404);
    }
    const open = ['pending', 'searching', 'active', 'received', 'needs_review'].includes(o.status);

    // ---------------- one attempt to get a number ----------------
    if (b.action === 'attempt') {
      if (o.status !== 'searching') return json({ state: o.status, attempts: o.search_attempts, order: await pub(o.id) });
      const gap = o.last_attempt_at ? Date.now() - new Date(o.last_attempt_at).getTime() : 1e9;
      if (gap < MIN_GAP_MS) return json({ state: 'searching', attempts: o.search_attempts, order: await pub(o.id) });
      const n = o.search_attempts + 1;
      const claim = await db.from('orders').update({ search_attempts: n, last_attempt_at: new Date().toISOString() })
        .eq('id', o.id).eq('search_attempts', o.search_attempts).eq('status', 'searching').select('id');
      if (!claim.data?.length) return json({ state: 'searching', attempts: o.search_attempts, order: await pub(o.id) });

      const ctx = await provider(o);
      if (!ctx) { await giveUp(o.id, 'service no longer available'); return json({ state: 'no_number', attempts: n, message: 'This service is no longer available. Your balance was returned.' }); }

      let res: unknown;
      try {
        res = await gcall(ctx.base, ctx.key, { action: 'getNumber', service: ctx.svcCode, country: ctx.ctyCode, maxPrice: String(o.provider_cost) }, ctx.timeout);
      } catch {
        await db.from('orders').update({ error_message: 'provider outcome unknown' }).eq('id', o.id);
        await set(o.id, 'needs_review', 'provider call failed; outcome unknown, not refunded');
        return json({ state: 'needs_review', attempts: n, order: await pub(o.id), message: 'We are confirming with the provider. Your balance is safe.' });
      }
      const text = typeof res === 'string' ? res : JSON.stringify(res);
      const m = text.match(/^ACCESS_NUMBER:(\d+):(\d+)$/);
      if (m) {
        const now = Date.now();
        const patch: Record<string, unknown> = {
          provider_activation_id: m[1], phone_number: `+${m[2]}`, last_checked_at: new Date(now).toISOString(),
          expires_at: new Date(now + 20 * 60_000).toISOString(), cancel_available_at: new Date(now + ctx.cancelDelay * 1000).toISOString(),
        };
        // best effort: read the activation's own times from the provider and keep the raw response for inspection
        try {
          const v2 = await gcall(ctx.base, ctx.key, { action: 'getStatusV2', id: m[1] }, 8000);
          if (v2 && typeof v2 === 'object') {
            patch.provider_meta = { status_v2: v2 };
            const t = deriveTimes(v2, now);
            if (t.expiresAt) patch.expires_at = t.expiresAt.toISOString();
            if (t.cancelAt) patch.cancel_available_at = t.cancelAt.toISOString();
          }
        } catch { /* keep defaults */ }
        await db.from('orders').update(patch).eq('id', o.id);
        await set(o.id, 'active', 'number allocated');
        return json({ state: 'active', attempts: n, order: await pub(o.id) });
      }
      if (text.startsWith('NO_NUMBERS')) {
        if (n >= MAX_ATTEMPTS) { await giveUp(o.id, `no number after ${MAX_ATTEMPTS} attempts`); return json({ state: 'no_number', attempts: n, message: 'No number became available. Your balance was returned.' }); }
        return json({ state: 'searching', attempts: n });
      }
      if (STOP_CODES.test(text)) {
        const code = text.split(/[:\s]/)[0];
        await giveUp(o.id, `provider refused: ${code}`);
        return json({ state: 'no_number', attempts: n, message: USER_MSG[code] ?? 'The number could not be allocated. Your balance was returned.' });
      }
      await db.from('orders').update({ error_message: 'unrecognised provider response' }).eq('id', o.id);
      await set(o.id, 'needs_review', `unrecognised provider response (${text.slice(0, 40)})`);
      return json({ state: 'needs_review', attempts: n, order: await pub(o.id), message: 'We are confirming with the provider. Your balance is safe.' });
    }

    // ---------------- user stops the search ----------------
    if (b.action === 'stop') {
      if (o.status !== 'searching') return json({ state: o.status, order: await pub(o.id) });
      await giveUp(o.id, 'search cancelled by user');
      return json({ state: 'no_number', message: 'Search cancelled. Your balance was returned.' });
    }

    // ---------------- "a long wait?": raise the price while searching ----------------
    if (b.action === 'change_price') {
      if (o.status !== 'searching') return json({ error: 'The search is no longer running.' }, 409);
      const ctx = await provider(o);
      if (!ctx) return json({ error: 'Provider unavailable' }, 502);
      const tiers = await liveTiers(db, ctx, o.service_id, o.country_id);
      if (!tiers) return json({ error: 'The provider is unreachable right now.' }, 502);
      const target = tiers.find((t) => Math.abs(t.retail - Number(b.expected_price)) < 0.00005 && t.retail > Number(o.retail_price));
      if (!target) return json({ error: 'That price is no longer available.', code: 'price_changed' }, 409);
      const diff = Math.round((target.retail - Number(o.retail_price)) * 10000) / 10000;
      const d = await debit(o.id, diff, `order:${o.id}:up:${Math.round(target.retail * 10000)}`, `${o.service_name} / ${o.country_name} (higher price)`);
      const ds = d.data?.[0]?.status;
      if (d.error || ds === 'error') return json({ error: 'Could not reserve the difference. Nothing changed.' }, 500);
      if (ds === 'insufficient_funds') return json({ error: 'Insufficient balance for this price.', code: 'insufficient_funds' }, 402);
      await db.from('orders').update({ retail_price: target.retail, provider_cost: target.cost }).eq('id', o.id);
      return json({ order: await pub(o.id), higher_options: higher(tiers, target.retail) });
    }

    if (b.action === 'refresh') {
      if (!open || o.status === 'searching') return json({ order: await pub(o.id) });
      const stale = !o.last_checked_at || Date.now() - new Date(o.last_checked_at).getTime() > 3000;
      if (!stale || !o.provider_activation_id) return json({ order: await pub(o.id) });
      const ctx = await provider(o);
      if (!ctx) return json({ order: await pub(o.id) });
      await db.from('orders').update({ last_checked_at: new Date().toISOString() }).eq('id', o.id);
      let st: string;
      try { st = String(await gcall(ctx.base, ctx.key, { action: 'getStatus', id: o.provider_activation_id }, ctx.timeout)); } catch { return json({ order: await pub(o.id) }); }
      if (st.startsWith('STATUS_OK:')) {
        const code = st.slice(10);
        await db.from('orders').update({ sms_code: code, sms_text: code }).eq('id', o.id);
        if (o.status !== 'received') await set(o.id, 'received', 'sms received');
      } else if (st.startsWith('STATUS_CANCEL')) {
        if (o.sms_code) await set(o.id, 'completed', 'provider closed activation after code');
        else { await set(o.id, 'cancelled', 'provider cancelled/expired'); await refund(o.id, 'activation cancelled by provider'); }
      } else if (st === 'STATUS_WAIT_CODE' && o.status === 'needs_review') {
        await set(o.id, 'active', 'reconciled with provider');
      } else if (o.expires_at && new Date(o.expires_at).getTime() < Date.now() && !o.sms_code && o.status === 'active') {
        const r = String(await gcall(ctx.base, ctx.key, { action: 'setStatus', id: o.provider_activation_id, status: '8' }, ctx.timeout).catch(() => ''));
        if (r.startsWith('ACCESS_CANCEL')) { await set(o.id, 'cancelled', 'expired without sms'); await refund(o.id, 'expired without sms'); }
      }
      return json({ order: await pub(o.id) });
    }

    if (b.action === 'cancel') {
      if (o.status !== 'active' || o.sms_code || !o.provider_activation_id) return json({ error: 'This order can no longer be cancelled.' }, 409);
      const wait = o.cancel_available_at ? new Date(o.cancel_available_at).getTime() - Date.now() : 0;
      if (wait > 0) return json({ error: `The provider allows cancelling in ${Math.ceil(wait / 1000)} seconds.`, code: 'too_early', retry_after: Math.ceil(wait / 1000) }, 409);
      const ctx = await provider(o);
      if (!ctx) return json({ error: 'Provider unavailable' }, 502);
      let r: string;
      try { r = String(await gcall(ctx.base, ctx.key, { action: 'setStatus', id: o.provider_activation_id, status: '8' }, ctx.timeout)); } catch { return json({ error: 'Could not reach the provider. Please try again.' }, 502); }
      if (r.startsWith('ACCESS_CANCEL')) { await set(o.id, 'cancelled', 'cancelled by user'); await refund(o.id, 'cancelled by user'); return json({ order: await pub(o.id) }); }
      if (/EARLY_CANCEL_DENIED/.test(r)) {
        // the provider says it is still too early: remember that and ask again in a few seconds
        await db.from('orders').update({ cancel_available_at: new Date(Date.now() + 15_000).toISOString() }).eq('id', o.id);
        return json({ error: 'The provider does not allow cancelling yet. The button will unlock shortly.', code: 'too_early', retry_after: 15 }, 409);
      }
      return json({ error: 'The provider did not confirm the cancellation.' }, 409);
    }

    if (b.action === 'complete') {
      if (o.status !== 'received' || !o.provider_activation_id) return json({ error: 'Nothing to complete yet.' }, 409);
      const ctx = await provider(o);
      if (ctx) await gcall(ctx.base, ctx.key, { action: 'setStatus', id: o.provider_activation_id, status: '6' }, ctx.timeout).catch(() => '');
      await set(o.id, 'completed', 'completed by user');
      return json({ order: await pub(o.id) });
    }
    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    console.error('orders error', e instanceof Error ? e.message : String(e));
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
