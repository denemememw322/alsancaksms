import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nContext';
import { useRouter } from '@/context/RouterContext';
import { Copy, Loader2, AlertCircle, CheckCircle2, XCircle, Clock, Phone, ArrowLeft } from 'lucide-react';

interface Order {
  id: string; service_name: string; country_name: string; status: 'pending' | 'active' | 'received' | 'completed' | 'cancelled' | 'failed' | 'needs_review';
  retail_price: number; currency: string; phone_number: string | null; sms_code: string | null; refunded_at: string | null;
  error_message: string | null; expires_at: string | null; created_at: string;
}
const COLS = 'id,service_name,country_name,status,retail_price,currency,phone_number,sms_code,refunded_at,error_message,expires_at,created_at';
const LABEL: Record<Order['status'], { text: string; cls: string }> = {
  pending: { text: 'Processing', cls: 'badge-neutral' }, active: { text: 'Waiting for SMS', cls: 'badge-neutral' },
  received: { text: 'SMS received', cls: 'badge-success' }, completed: { text: 'Completed', cls: 'badge-success' },
  cancelled: { text: 'Cancelled', cls: 'badge-neutral' }, failed: { text: 'Failed', cls: 'badge-neutral' }, needs_review: { text: 'Being verified', cls: 'badge-neutral' },
};
const OPEN = ['pending', 'active', 'received', 'needs_review'];

export function OrdersPage() {
  const { route, navigate } = useRouter();
  const id = route.path.startsWith('/orders/') ? route.path.slice('/orders/'.length) : null;
  return <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">{id ? <OrderDetail id={id} back={() => navigate('/orders')} /> : <OrderList open={(i) => navigate(`/orders/${i}`)} />}</div>;
}

function OrderList({ open }: { open: (id: string) => void }) {
  const { formatCurrency, formatDate } = useI18n();
  const [rows, setRows] = useState<Order[] | null>(null);
  useEffect(() => {
    supabase.from('orders').select(COLS).order('created_at', { ascending: false }).limit(100).then(({ data }) => setRows((data ?? []) as Order[]));
  }, []);
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">My orders</h1>
      {!rows && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div>}
      {rows?.length === 0 && <p className="py-10 text-center text-neutral-500">You have no orders yet.</p>}
      <ul className="space-y-2">
        {rows?.map((o) => (
          <li key={o.id}><button className="card flex w-full items-center justify-between p-3 text-left hover:border-primary-500" onClick={() => open(o.id)}>
            <span><span className="block font-medium text-neutral-900 dark:text-neutral-100">{o.service_name} · {o.country_name}</span>
              <span className="text-xs text-neutral-500">{formatDate(o.created_at)}{o.phone_number ? ` · ${o.phone_number}` : ''}</span></span>
            <span className="text-right"><span className={LABEL[o.status].cls}>{LABEL[o.status].text}</span><span className="mt-1 block text-sm">{formatCurrency(o.retail_price, o.currency)}</span></span>
          </button></li>
        ))}
      </ul>
    </>
  );
}

function OrderDetail({ id, back }: { id: string; back: () => void }) {
  const { formatCurrency } = useI18n();
  const [o, setO] = useState<Order | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState('');
  const timer = useRef<number | null>(null);

  const call = useCallback(async (action: string) => {
    const { data, error } = await supabase.functions.invoke('orders', { body: { action, order_id: id } });
    if (error) {
      let m = 'Request failed. Please try again.';
      try { m = (await (error as unknown as { context: Response }).context.json()).error ?? m; } catch { /* keep */ }
      return { error: m };
    }
    return { order: data.order as Order };
  }, [id]);

  const refresh = useCallback(async () => {
    const { data } = await supabase.from('orders').select(COLS).eq('id', id).maybeSingle();
    if (!data) { setErr('Order not found.'); return; }
    setO(data as Order);
    if (OPEN.includes(data.status)) { const r = await call('refresh'); if (r.order) setO(r.order); }
  }, [id, call]);

  useEffect(() => { refresh(); timer.current = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 5000); return () => { if (timer.current) window.clearInterval(timer.current); }; }, [refresh]);
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!o?.expires_at || !['active'].includes(o.status)) { setLeft(''); return; }
      const s = Math.max(0, Math.floor((new Date(o.expires_at).getTime() - Date.now()) / 1000));
      setLeft(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    }, 1000);
    return () => window.clearInterval(t);
  }, [o]);

  async function act(action: 'cancel' | 'complete') {
    setBusy(true); setErr(null);
    const r = await call(action); setBusy(false);
    if (r.error) setErr(r.error); else if (r.order) setO(r.order);
  }

  if (err && !o) return <p className="py-10 text-center text-error-700">{err}</p>;
  if (!o) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div>;
  const st = LABEL[o.status];
  return (
    <>
      <button className="mb-3 inline-flex items-center gap-1 text-sm text-primary-600 hover:underline" onClick={back}><ArrowLeft className="h-4 w-4" />All orders</button>
      <div className="card p-5">
        <div className="mb-4 flex items-start justify-between"><div><h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{o.service_name}</h1><p className="text-sm text-neutral-500">{o.country_name} · {formatCurrency(o.retail_price, o.currency)}</p></div><span className={st.cls}>{st.text}</span></div>

        {o.phone_number && (
          <div className="mb-4 rounded-lg bg-neutral-50 p-4 dark:bg-neutral-900">
            <div className="mb-1 flex items-center gap-1 text-xs uppercase tracking-wide text-neutral-500"><Phone className="h-3.5 w-3.5" />Phone number</div>
            <div className="flex items-center justify-between"><span className="font-mono text-xl text-neutral-900 dark:text-neutral-100">{o.phone_number}</span>
              <button className="btn-secondary btn-sm inline-flex items-center gap-1" onClick={() => navigator.clipboard.writeText(o.phone_number!.replace('+', ''))}><Copy className="h-4 w-4" />Copy</button></div>
          </div>
        )}
        {o.status === 'active' && <p className="mb-4 flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400"><Loader2 className="h-4 w-4 animate-spin" />Waiting for the SMS… {left && <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" />{left}</span>}</p>}
        {o.sms_code && (
          <div className="mb-4 rounded-lg border border-success-300 bg-success-50 p-4 dark:bg-success-950/30"><div className="mb-1 flex items-center gap-1 text-xs uppercase tracking-wide text-success-700"><CheckCircle2 className="h-3.5 w-3.5" />SMS code</div>
            <div className="flex items-center justify-between"><span className="font-mono text-2xl font-bold">{o.sms_code}</span><button className="btn-secondary btn-sm inline-flex items-center gap-1" onClick={() => navigator.clipboard.writeText(o.sms_code!)}><Copy className="h-4 w-4" />Copy</button></div></div>
        )}
        {o.status === 'needs_review' && <p className="mb-4 flex items-start gap-2 text-sm text-neutral-600 dark:text-neutral-400"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />We are confirming this order with the provider. Your balance is safe; if no number was issued it will be refunded.</p>}
        {(o.status === 'cancelled' || o.status === 'failed') && <p className="mb-4 flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400"><XCircle className="h-4 w-4" />{o.refunded_at ? 'This order was refunded to your balance.' : 'This order was not charged.'}</p>}
        {err && <p className="mb-3 text-sm text-error-700">{err}</p>}
        <div className="flex gap-2">
          {o.status === 'active' && !o.sms_code && <button className="btn-secondary btn-sm" disabled={busy} onClick={() => act('cancel')}>Cancel &amp; refund</button>}
          {o.status === 'received' && <button className="btn-primary btn-sm" disabled={busy} onClick={() => act('complete')}>Mark as completed</button>}
        </div>
      </div>
    </>
  );
}
