import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminLayout } from '@/components/AdminLayout';
import { useI18n } from '@/i18n/I18nContext';
import { AlertCircle } from 'lucide-react';

interface Row { id: string; user_id: string; service_name: string; country_name: string; status: string; retail_price: number; provider_cost: number | null; currency: string; refunded_at: string | null; error_message: string | null; phone_number: string | null; created_at: string }
const STATUSES = ['all', 'pending', 'active', 'received', 'completed', 'cancelled', 'failed', 'needs_review'];

export function AdminOrdersPage() {
  const { formatCurrency, formatDate } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState('all');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let q = supabase.from('orders').select('id,user_id,service_name,country_name,status,retail_price,provider_cost,currency,refunded_at,error_message,phone_number,created_at').order('created_at', { ascending: false }).limit(200);
    if (status !== 'all') q = q.eq('status', status);
    q.then(({ data, error }) => { if (error) setErr(error.message); else { setErr(null); setRows((data ?? []) as Row[]); } });
  }, [status]);
  const revenue = rows.filter((r) => ['received', 'completed'].includes(r.status)).reduce((a, r) => a + r.retail_price, 0);
  const cost = rows.filter((r) => ['received', 'completed'].includes(r.status)).reduce((a, r) => a + (r.provider_cost ?? 0), 0);
  return (
    <AdminLayout title="Orders">
      {err && <p className="mb-3 flex items-center gap-2 text-sm text-error-700"><AlertCircle className="h-4 w-4" />{err}</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}</select>
        <span className="text-sm text-neutral-500">Delivered (shown): revenue {formatCurrency(revenue)} · provider cost ≤ {formatCurrency(cost)} · gross ≥ {formatCurrency(revenue - cost)}</span>
      </div>
      <div className="card overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500 dark:border-neutral-800"><th className="p-3">Date</th><th>User</th><th>Service</th><th>Price</th><th>Cost (max)</th><th>Status</th><th>Note</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className="border-b border-neutral-100 dark:border-neutral-900"><td className="p-3 whitespace-nowrap">{formatDate(r.created_at)}</td><td className="font-mono text-xs">{r.user_id.slice(0, 8)}</td>
            <td>{r.service_name} · {r.country_name}</td><td>{formatCurrency(r.retail_price, r.currency)}</td><td>{r.provider_cost != null ? formatCurrency(r.provider_cost) : '—'}</td>
            <td><span className={r.status === 'needs_review' ? 'badge-neutral font-semibold' : 'badge-neutral'}>{r.status}</span>{r.refunded_at && <span className="ml-1 text-xs text-neutral-500">refunded</span>}</td><td className="max-w-[16rem] truncate text-xs text-neutral-500">{r.error_message}</td></tr>
        ))}</tbody></table>{rows.length === 0 && <p className="p-6 text-center text-neutral-500">No orders.</p>}</div>
    </AdminLayout>
  );
}
