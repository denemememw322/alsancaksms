import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Plug, DownloadCloud, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface SyncStatus {
  job: { status: string; started_at: string | null; completed_at: string | null; records_processed: number | null; records_created: number | null; error_message: string | null } | null;
  logs: Array<{ level: 'info' | 'warning' | 'error'; message: string; at: string }>;
}

/** Server-side connection test + full catalog import. Results come from real provider API calls. */
export function ProviderSyncPanel({ providerId }: { providerId: string }) {
  const [busy, setBusy] = useState<'test' | 'sync' | null>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const { data } = await supabase.rpc('admin_sync_status', { p_provider_id: providerId });
    if (data) setStatus(data as SyncStatus);
    return data as SyncStatus | null;
  }, [providerId]);

  useEffect(() => {
    refresh();
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [refresh]);

  function startPolling() {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(async () => {
      const s = await refresh();
      if (s?.job && s.job.status !== 'running' && s.job.status !== 'pending') {
        if (timer.current) window.clearInterval(timer.current);
        setBusy(null);
      }
    }, 3000);
  }

  async function run(action: 'test' | 'sync') {
    setBusy(action); setTest(null);
    const { data, error } = await supabase.functions.invoke('provider-sync', { body: { provider_id: providerId, action } });
    if (error) {
      let msg = error.message;
      try { const b = await (error as unknown as { context: Response }).context.json(); msg = b.error || msg; } catch { /* keep generic message */ }
      setTest({ ok: false, text: msg }); setBusy(null); return;
    }
    if (action === 'test') {
      setBusy(null);
      setTest(data.ok ? { ok: true, text: `Connected. Provider balance: ${data.balance}` } : { ok: false, text: `${data.status === 'auth_failed' ? 'Authentication failed' : 'API error'}: ${data.error}` });
    } else if (data.ok) {
      startPolling();
    } else { setBusy(null); setTest({ ok: false, text: data.error || 'Sync failed to start' }); }
  }

  const job = status?.job;
  return (
    <div className="mt-6 border-t border-neutral-200 pt-4 dark:border-neutral-800">
      <h4 className="mb-2 text-sm font-semibold">Connection &amp; catalog import</h4>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary btn-sm inline-flex items-center gap-1" disabled={!!busy} onClick={() => run('test')}>
          {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}Test connection
        </button>
        <button className="btn-primary btn-sm inline-flex items-center gap-1" disabled={!!busy} onClick={() => run('sync')}>
          {busy === 'sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadCloud className="h-4 w-4" />}Import all countries, services &amp; prices
        </button>
      </div>
      {test && (
        <p className={`mt-2 flex items-center gap-1 text-sm ${test.ok ? 'text-success-700' : 'text-error-700'}`}>
          {test.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{test.text}
        </p>
      )}
      {job && (
        <div className="mt-3 rounded-lg bg-neutral-50 p-3 text-xs dark:bg-neutral-900">
          <div className="mb-1 font-medium">
            Last import: {job.status}{job.records_created != null && job.status === 'completed' ? ` · ${job.records_created} price rows` : ''}
            {job.error_message && <span className="text-error-700"> · {job.error_message}</span>}
          </div>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto font-mono">
            {status!.logs.map((l, i) => (
              <li key={i} className={l.level === 'error' ? 'text-error-700' : l.level === 'warning' ? 'text-warning-700' : 'text-neutral-600 dark:text-neutral-400'}>
                {new Date(l.at).toLocaleTimeString()} {l.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-2 text-xs text-neutral-500">Demo data is removed. Prices are imported as provider cost; the retail price is calculated from your global pricing rule and manual price overrides are never overwritten.</p>
    </div>
  );
}
