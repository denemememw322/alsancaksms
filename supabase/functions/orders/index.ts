// orders: signed-in users only. Actions: purchase | refresh | cancel | complete.
// Money rules: debit first (idempotent per order), refund only on a provider-confirmed non-delivery/cancel,
// outcome-unknown (timeouts) => needs_review, never auto-refunded.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { CORS, json, loadCtx, liveTiers, gcall } from './grizzly.ts';

const SAFE = 'id,service_name,country_name,status,retail_price,currency,phone_number,sms_code,sms_text,refunded_at,error_message,expires_at,created_at,completed_at';
const PROVIDER_REFUSALS = /^(NO_NUMBERS|NO_BALANCE|BAD_SERVICE|BAD_COUNTRY|WRONG_MAX_PRICE|WRONG_SERVICE|BANNED|The service is prohibited)/i;
const USER_MSG: Record<string, string> = {
  NO_NUMBERS: 'No numbers are available right now. You were not charged.',
  NO_BALANCE: 'This service is temporarily unavailable. You were not charged.',
  WRONG_MAX_PRICE: 'The price changed. Please refresh and try again. You were not charged.',
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
  const provider = async (o: { service_id: string; country_id: string }) => loadCtx(db, o.service_id, o.country_id);

  try {
    // ---------------- purchase ----------------
    if (b.action === 'purchase') {
      const { service_id, country_id, expected_price, idempotency_key } = b as Record<string, string>;
      if (!service_id || !country_id || !idempotency_key || !/^[\w-]{8,80}$/.test(idempotency_key) || !Number(expected_price)) return json({ error: 'invalid request' }, 400);

      const dup = await db.from('orders').select('id').eq('user_id', uid).eq('idempotency_key', idempotency_key).maybeSingle();
      if (dup.data) return json({ order: await pub(dup.data.id) });

      const since = new Date(Date.now() - 60_000).toISOString();
      const { count } = await db.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', uid).gte('created_at', since);
      if ((count ?? 0) >= 8) return json({ error: 'Too many requests. Please wait a minute.' }, 429);

      const ctx = await loadCtx(db, service_id, country_id);
      if (!ctx) return json({ error: 'This service is not available for the selected country.' }, 409);
      const tiers = await liveTiers(db, ctx, service_id, country_id);
      if (!tiers.length) return json({ error: 'Out of stock. You were not charged.' }, 409);
      const tier = tiers.find((t) => Math.abs(t.retail - Number(expected_price)) < 0.00005);
      if (!tier) return json({ error: 'The price changed. Please review the new prices.', code: 'price_changed' }, 409);

      const ins = await db.from('orders').insert({
        user_id: uid, service_id, country_id, provider_id: ctx.providerId, service_name: ctx.serviceName, country_name: ctx.countryName,
        idempotency_key, status: 'pending', retail_price: tier.retail, provider_cost: tier.cost,
        expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
      }).select('id').single();
      if (ins.error) {
        const again = await db.from('orders').select('id').eq('user_id', uid).eq('idempotency_key', idempotency_key).maybeSingle();
        if (again.data) return json({ order: await pub(again.data.id) });
        return json({ error: 'Could not create the order' }, 500);
      }
      const oid = ins.data.id as string;

      const debit = await db.rpc('debit_wallet', { p_user_id: uid, p_amount: tier.retail, p_reference_type: 'order', p_reference_id: oid, p_idempotency_key: `order:${oid}`, p_description: `${ctx.serviceName} / ${ctx.countryName}`, p_metadata: {}, p_actor_id: null });
      const ds = debit.data?.[0]?.status;
      if (debit.error || ds === 'error') { await db.from('orders').update({ error_message: 'wallet error' }).eq('id', oid); await set(oid, 'failed', 'wallet error'); return json({ error: 'Could not process your balance. You were not charged.' }, 500); }
      if (ds === 'insufficient_funds') { await db.from('orders').update({ error_message: 'insufficient funds' }).eq('id', oid); await set(oid, 'failed', 'insufficient funds'); return json({ error: 'Insufficient balance. Please add funds.', code: 'insufficient_funds' }, 402); }

      let res: any;
      try {
        res = await gcall(ctx.base, ctx.key, { action: 'getNumber', service: ctx.svcCode, country: ctx.ctyCode, maxPrice: String(tier.cost) }, ctx.timeout);
      } catch {
        await db.from('orders').update({ error_message: 'provider outcome unknown' }).eq('id', oid);
        await set(oid, 'needs_review', 'provider call failed; outcome unknown, not refunded');
        return json({ order: await pub(oid), notice: 'We are confirming your number with the provider. Your balance is safe; this will resolve automatically or be refunded.' }, 202);
      }
      const text = typeof res === 'string' ? res : JSON.stringify(res);
      const m = text.match(/^ACCESS_NUMBER:(\d+):(\d+)$/);
      if (m) {
        await db.from('orders').update({ provider_activation_id: m[1], phone_number: `+${m[2]}`, last_checked_at: new Date().toISOString() }).eq('id', oid);
        await set(oid, 'active', 'number allocated');
        return json({ order: await pub(oid) });
      }
      if (PROVIDER_REFUSALS.test(text)) {
        const code = text.split(/[:\s]/)[0];
        await db.from('orders').update({ error_message: code }).eq('id', oid);
        await set(oid, 'failed', `provider refused: ${code}`);
        await refund(oid, `provider refused: ${code}`);
        return json({ error: USER_MSG[code] ?? 'The number could not be allocated. You were not charged.', order: await pub(oid) }, 409);
      }
      await db.from('orders').update({ error_message: 'unrecognised provider response' }).eq('id', oid);
      await set(oid, 'needs_review', `unrecognised provider response (${text.slice(0, 40)})`);
      return json({ order: await pub(oid), notice: 'We are confirming your number with the provider. Your balance is safe.' }, 202);
    }

    // ---------------- actions on an existing order ----------------
    const o = b.order_id ? await getOrder(String(b.order_id)) : null;
    if (!o) return json({ error: 'order not found' }, 404);
    if (o.user_id !== uid) {
      const { data: adm } = await userClient.rpc('current_user_is_admin');
      if (adm !== true) return json({ error: 'order not found' }, 404);
    }
    const open = ['pending', 'active', 'received', 'needs_review'].includes(o.status);

    if (b.action === 'refresh') {
      if (!open) return json({ order: await pub(o.id) });
      const stale = !o.last_checked_at || Date.now() - new Date(o.last_checked_at).getTime() > 3000;
      if (o.status === 'pending' && Date.now() - new Date(o.created_at).getTime() > 120_000) { await set(o.id, 'needs_review', 'stuck in pending'); return json({ order: await pub(o.id) }); }
      if (!stale || !o.provider_activation_id || !o.service_id || !o.country_id) return json({ order: await pub(o.id) });
      const ctx = await provider(o);
      if (!ctx) return json({ order: await pub(o.id) });
      await db.from('orders').update({ last_checked_at: new Date().toISOString() }).eq('id', o.id);
      let st: any;
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
      if (o.status !== 'active' || o.sms_code || !o.provider_activation_id || !o.service_id || !o.country_id) return json({ error: 'This order can no longer be cancelled.' }, 409);
      const ctx = await provider(o);
      if (!ctx) return json({ error: 'Provider unavailable' }, 502);
      let r: string;
      try { r = String(await gcall(ctx.base, ctx.key, { action: 'setStatus', id: o.provider_activation_id, status: '8' }, ctx.timeout)); } catch { return json({ error: 'Could not reach the provider. Please try again.' }, 502); }
      if (r.startsWith('ACCESS_CANCEL')) { await set(o.id, 'cancelled', 'cancelled by user'); await refund(o.id, 'cancelled by user'); return json({ order: await pub(o.id) }); }
      if (/EARLY_CANCEL_DENIED/.test(r)) return json({ error: 'The provider only allows cancelling after about 2 minutes. Please try again shortly.' }, 409);
      return json({ error: 'The provider did not confirm the cancellation.' }, 409);
    }

    if (b.action === 'complete') {
      if (o.status !== 'received' || !o.provider_activation_id) return json({ error: 'Nothing to complete yet.' }, 409);
      const ctx = o.service_id && o.country_id ? await provider(o) : null;
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
