import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { AdminLayout } from '@/components/AdminLayout';
import { useI18n } from '@/i18n/I18nContext';
import { Search, Loader2, AlertCircle, Ban, ShieldCheck, Trash2, Wallet } from 'lucide-react';

interface U { user_id: string; email: string; display_name: string | null; status: string; balance: number; orders: number; created_at: string; last_sign_in_at: string | null; banned: boolean; total: number }
const PAGE = 25;

export function AdminUsersPage() {
  const { user } = useAuth();
  const { formatDate } = useI18n();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<U[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [balanceFor, setBalanceFor] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_list_users', { p_q: q, p_limit: PAGE, p_offset: page * PAGE });
    setLoading(false);
    if (error) { setMsg({ ok: false, text: error.message }); return; }
    setRows((data ?? []) as U[]);
  }, [q, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function invoke(action: 'ban' | 'delete', u: U, banned?: boolean) {
    if (action === 'delete' && !confirm(`Permanently delete ${u.email}? This cannot be undone.`)) return;
    setBusy(u.user_id); setMsg(null);
    const { data, error } = await supabase.functions.invoke('admin-users', { body: { action, user_id: u.user_id, banned } });
    setBusy(null);
    if (error) {
      let m = 'Request failed.';
      try { m = (await (error as unknown as { context: Response }).context.json()).error ?? m; } catch { /* keep */ }
      setMsg({ ok: false, text: m }); return;
    }
    setMsg({ ok: true, text: action === 'delete' ? 'User deleted.' : data.banned ? 'User banned.' : 'User unbanned.' });
    load();
  }

  async function adjust(u: U) {
    const n = Number(amount);
    if (!user || !Number.isFinite(n) || n === 0 || reason.trim().length < 3) { setMsg({ ok: false, text: 'Enter a non-zero amount (negative to deduct) and a reason.' }); return; }
    setBusy(u.user_id); setMsg(null);
    const { data, error } = await supabase.rpc('admin_adjust_balance', { p_user_id: u.user_id, p_amount: n, p_reason: reason.trim(), p_admin_id: user.id, p_idempotency_key: crypto.randomUUID() });
    setBusy(null);
    const r = (data as Array<{ status: string; message: string; new_balance: number }> | null)?.[0];
    if (error || !r || r.status === 'error' || r.status === 'unauthorized' || r.status === 'insufficient_funds') { setMsg({ ok: false, text: error?.message ?? r?.message ?? r?.status ?? 'Failed' }); return; }
    setMsg({ ok: true, text: `Balance updated. New balance: $${Number(r.new_balance).toFixed(2)}` });
    setBalanceFor(null); setAmount(''); setReason(''); load();
  }

  const total = rows[0]?.total ?? 0;
  return (
    <AdminLayout title="Users">
      <div className="relative mb-4 max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input className="input pl-9" placeholder="Search by email or name" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} /></div>
      {msg && <p className={`mb-3 flex items-center gap-2 text-sm ${msg.ok ? 'text-success-700' : 'text-error-700'}`}>{!msg.ok && <AlertCircle className="h-4 w-4" />}{msg.text}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500 dark:border-neutral-800"><th className="p-3">User</th><th>Status</th><th>Balance (USD)</th><th>Orders</th><th>Last login</th><th className="pr-3 text-right">Actions</th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <>
                <tr key={u.user_id} className="border-b border-neutral-100 dark:border-neutral-900">
                  <td className="p-3"><div className="font-medium text-neutral-900 dark:text-neutral-100">{u.email}</div><div className="text-xs text-neutral-500">{u.display_name ?? '—'} · joined {formatDate(u.created_at)}</div></td>
                  <td><span className={u.banned || u.status !== 'active' ? 'badge-neutral font-semibold' : 'badge-success'}>{u.banned ? 'banned' : u.status}</span></td>
                  <td className="font-mono">${Number(u.balance).toFixed(2)}</td><td>{u.orders}</td><td className="text-xs">{u.last_sign_in_at ? formatDate(u.last_sign_in_at) : '—'}</td>
                  <td className="pr-3"><div className="flex justify-end gap-1">
                    <button className="btn-ghost btn-sm inline-flex items-center gap-1" disabled={busy === u.user_id} onClick={() => { setBalanceFor(balanceFor === u.user_id ? null : u.user_id); setMsg(null); }}><Wallet className="h-4 w-4" />Balance</button>
                    <button className="btn-ghost btn-sm inline-flex items-center gap-1" disabled={busy === u.user_id} onClick={() => invoke('ban', u, !u.banned)}>{u.banned ? <><ShieldCheck className="h-4 w-4" />Unban</> : <><Ban className="h-4 w-4" />Ban</>}</button>
                    <button className="btn-ghost btn-sm text-error-700" disabled={busy === u.user_id} onClick={() => invoke('delete', u)} aria-label="Delete user"><Trash2 className="h-4 w-4" /></button>
                  </div></td>
                </tr>
                {balanceFor === u.user_id && (
                  <tr key={u.user_id + 'b'} className="bg-neutral-50 dark:bg-neutral-900"><td colSpan={6} className="p-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <div><label className="label">Amount (USD, negative deducts)</label><input type="number" step="0.01" className="input w-40" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                      <div className="min-w-[14rem] flex-1"><label className="label">Reason (recorded in the audit log)</label><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
                      <button className="btn-primary btn-sm inline-flex items-center gap-1" disabled={busy === u.user_id} onClick={() => adjust(u)}>{busy === u.user_id && <Loader2 className="h-4 w-4 animate-spin" />}Apply</button>
                    </div></td></tr>
                )}
              </>
            ))}
          </tbody>
        </table>
        {loading && <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin text-primary-600" /></div>}
        {!loading && rows.length === 0 && <p className="p-6 text-center text-neutral-500">No users found.</p>}
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-neutral-500"><span>{total} users</span>
        <div className="flex gap-2"><button className="btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><button className="btn-secondary btn-sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</button></div></div>
    </AdminLayout>
  );
}
