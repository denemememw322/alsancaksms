import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminLayout } from '@/components/AdminLayout';
import { useI18n } from '@/i18n/I18nContext';
import { Loader2, RefreshCw } from 'lucide-react';

interface Fx { usd_try: number; source: string; is_manual: boolean; updated_at: string }

export function AdminSettingsPage() {
  const { formatDate } = useI18n();
  const [fx, setFx] = useState<Fx | null | undefined>(undefined);
  const [rate, setRate] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.rpc('admin_fx_status');
    const r = (data as Fx[] | null)?.[0] ?? null;
    setFx(r); if (r) setRate(String(r.usd_try));
  };
  useEffect(() => { load(); }, []);

  async function save(manual: boolean) {
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc('admin_set_usd_try', { p_rate: manual ? Number(rate) : null, p_manual: manual });
    if (!error && !manual) await supabase.functions.invoke('price-sync', { body: { limit: 1 } });
    setBusy(false);
    if (error) setMsg({ ok: false, text: error.message }); else { setMsg({ ok: true, text: manual ? 'Manual rate saved.' : 'Automatic rate (TCMB) enabled.' }); load(); }
  }

  return (
    <AdminLayout title="Settings">
      <div className="card max-w-xl p-5">
        <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">USD → TL exchange rate</h2>
        <p className="mb-4 text-sm text-neutral-500">Customers can switch the whole site between USD and TL. Prices are stored in USD and converted with this rate. The automatic rate is the Turkish Central Bank (TCMB) USD selling rate, refreshed every few hours.</p>
        {fx === undefined && <Loader2 className="h-5 w-5 animate-spin text-primary-600" />}
        {fx === null && <p className="mb-4 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">No rate yet, so the TL option is hidden from customers. Run a price sync or enter a manual rate below.</p>}
        {fx && <p className="mb-4 text-sm">Current: <b className="font-mono">1 USD = {Number(fx.usd_try).toFixed(4)} TL</b> · {fx.is_manual ? 'manual' : fx.source} · {formatDate(fx.updated_at)}</p>}
        <label className="label">Manual rate (TL per 1 USD)</label>
        <div className="flex gap-2"><input type="number" step="0.0001" className="input w-48" value={rate} onChange={(e) => setRate(e.target.value)} />
          <button className="btn-primary btn-sm" disabled={busy || !Number(rate)} onClick={() => save(true)}>Save manual rate</button>
          <button className="btn-secondary btn-sm inline-flex items-center gap-1" disabled={busy} onClick={() => save(false)}><RefreshCw className="h-4 w-4" />Use automatic (TCMB)</button></div>
        {msg && <p className={`mt-3 text-sm ${msg.ok ? 'text-success-700' : 'text-error-700'}`}>{msg.text}</p>}
      </div>
    </AdminLayout>
  );
}
