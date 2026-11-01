// admin-users: admin only. Actions: ban | delete. Uses the Auth admin API, so it runs server-side only.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f-]{36}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const uc = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: me } = await uc.auth.getUser();
  const { data: isAdmin } = await uc.rpc('current_user_is_admin');
  if (!me?.user || isAdmin !== true) return json({ error: 'forbidden' }, 403);

  let b: { action?: string; user_id?: string; banned?: boolean };
  try { b = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }
  if (!b.user_id || !UUID.test(b.user_id)) return json({ error: 'user_id required' }, 400);
  if (b.user_id === me.user.id) return json({ error: 'You cannot do this to your own account.' }, 400);

  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: targetIsAdmin } = await db.rpc('is_admin', { check_uid: b.user_id });
  if (targetIsAdmin === true) return json({ error: 'Administrators cannot be banned or deleted here.' }, 403);
  const audit = (action: string, details: Record<string, unknown>) => db.from('audit_logs').insert({ actor_id: me.user.id, action, target_type: 'user', target_id: b.user_id, details });

  if (b.action === 'ban') {
    const banned = b.banned !== false;
    const { error } = await db.auth.admin.updateUserById(b.user_id, { ban_duration: banned ? '876000h' : 'none' });
    if (error) return json({ error: 'Could not update the account.' }, 500);
    await db.from('profiles').update({ status: banned ? 'suspended' : 'active' }).eq('id', b.user_id);
    await audit(banned ? 'user.ban' : 'user.unban', {});
    return json({ ok: true, banned });
  }
  if (b.action === 'delete') {
    const { count } = await db.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', b.user_id);
    if ((count ?? 0) > 0) return json({ error: 'This user has orders. Ban the account instead of deleting it so order and refund history is preserved.' }, 409);
    const { error } = await db.auth.admin.deleteUser(b.user_id);
    if (error) return json({ error: 'The account could not be deleted (it still has related records). Ban it instead.' }, 409);
    await audit('user.delete', {});
    return json({ ok: true });
  }
  return json({ error: 'unknown action' }, 400);
});
