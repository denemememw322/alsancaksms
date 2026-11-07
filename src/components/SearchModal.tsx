import { useCallback, useEffect, useRef, useState } from 'react';
import { callFn } from '@/lib/functions';
import { useI18n } from '@/i18n/I18nContext';
import { useRouter } from '@/context/RouterContext';
import { X, Loader2, AlertCircle } from 'lucide-react';

interface Props {
  service: { service_id: string; name: string };
  country: { country_id: string; name: string; flag_emoji: string | null };
  price: number;
  onClose: (message?: string) => void;
}
interface Order { id: string; search_attempts: number }
interface Higher { price: number; quantity: number }

const MAX = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mirrors the provider's own purchase panel: keeps trying for a number and shows "Attempt n of 600". */
export function SearchModal({ service, country, price: startPrice, onClose }: Props) {
  const { formatCurrency } = useI18n();
  const { navigate } = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [price, setPrice] = useState(startPrice);
  const [higher, setHigher] = useState<Higher[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const orderId = useRef<string | null>(null);
  const stopped = useRef(false);
  const started = useRef(false);
  // keep the latest props/callbacks in refs so a parent re-render can never restart or stop a running search
  const live = useRef({ service, country, startPrice, navigate, onClose });
  live.current = { service, country, startPrice, navigate, onClose };

  const run = useCallback(async () => {
    const { service: svc, country: cty, startPrice: p0 } = live.current;
    const s = await callFn<{ order: Order; higher_options: Higher[] }>('orders', {
      action: 'start', service_id: svc.service_id, country_id: cty.country_id,
      expected_price: p0, idempotency_key: crypto.randomUUID(),   // a fresh key per click: a new attempt never reopens an old order
    });
    if (s.error) { setError(s.error); return; }
    orderId.current = s.data!.order.id;
    setHigher(s.data!.higher_options ?? []);
    setReady(true);

    let failures = 0;
    while (!stopped.current) {
      const a = await callFn<{ state: string; attempts?: number; message?: string }>('orders', { action: 'attempt', order_id: orderId.current });
      if (stopped.current) return;
      if (a.error) { if (++failures >= 4) { setError(a.error); return; } await sleep(1500); continue; }
      failures = 0;
      const d = a.data!;
      if (d.attempts != null) setAttempt(d.attempts);
      if (d.state === 'active' || d.state === 'received' || d.state === 'needs_review') { live.current.navigate(`/orders/${orderId.current}`); live.current.onClose(); return; }
      if (d.state === 'no_number' || d.state === 'completed' || d.state === 'cancelled') { live.current.onClose(d.message ?? 'No number became available. Your balance was returned.'); return; }
      await sleep(900);
    }
  }, []);

  useEffect(() => {
    stopped.current = false;
    if (!started.current) { started.current = true; run(); }
    return () => { stopped.current = true; };   // a closed tab is cleaned up server-side within ~90 s (funds returned)
  }, [run]);

  async function cancel() {
    stopped.current = true;
    if (orderId.current) await callFn('orders', { action: 'stop', order_id: orderId.current });
    live.current.onClose('Search cancelled. Your balance was returned.');
  }

  async function raise(p: number) {
    if (!orderId.current) return;
    setBusy(true); setError(null);
    const r = await callFn<{ order: unknown; higher_options: Higher[] }>('orders', { action: 'change_price', order_id: orderId.current, expected_price: p });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setPrice(p); setHigher(r.data!.higher_options ?? []);
  }

  const failedToStart = error && !ready;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Searching for a number">
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900">
        <button className="absolute right-3 top-3 btn-ghost btn-sm" onClick={failedToStart ? () => live.current.onClose() : cancel} aria-label="Close"><X className="h-4 w-4" /></button>
        <div className="mb-4 flex items-center justify-center gap-4 text-center">
          <div><div className="text-4xl">{country.flag_emoji ?? '🌐'}</div><div className="mt-1 font-semibold text-neutral-900 dark:text-neutral-100">{country.name}</div></div>
          <span className="text-2xl text-neutral-400">+</span>
          <div><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary-600 text-lg font-bold text-white">{service.name.charAt(0).toUpperCase()}</div><div className="mt-1 font-semibold text-neutral-900 dark:text-neutral-100">{service.name}</div></div>
        </div>

        {failedToStart ? (
          <div className="space-y-3 text-center">
            <p className="flex items-center justify-center gap-2 text-sm text-error-700"><AlertCircle className="h-4 w-4" />{error}</p>
            <button className="btn-secondary btn-sm" onClick={() => live.current.onClose()}>Close</button>
          </div>
        ) : (
          <>
            <div className="mb-2 h-3 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"><div className="h-full rounded-full bg-primary-600 transition-all" style={{ width: `${Math.max(2, (attempt / MAX) * 100)}%` }} /></div>
            <div className="mb-4 flex items-center justify-between gap-3 text-sm text-neutral-700 dark:text-neutral-300">
              <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{ready ? `Attempt ${attempt} of ${MAX}` : 'Starting…'} (price: {formatCurrency(price)})</span>
              <button className="btn-secondary btn-sm" onClick={cancel}>Cancel</button>
            </div>
            {error && <p className="mb-3 flex items-center gap-2 text-sm text-error-700"><AlertCircle className="h-4 w-4" />{error}</p>}
            <div className="border-t border-neutral-200 pt-4 text-center dark:border-neutral-800">
              <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">A long wait?</h3>
              <p className="mt-1 text-xs text-neutral-500">Your balance is only reserved while we look and is returned in full if no number is found. A higher price finds a number faster.</p>
              {higher.length > 0 && (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {higher.slice().sort((a, b) => a.price - b.price).map((h) => (
                    <button key={h.price} className="btn-secondary btn-sm" disabled={busy} onClick={() => raise(h.price)}>{formatCurrency(h.price)}</button>
                  ))}
                </div>
              )}
              {higher.length === 0 && ready && <p className="mt-3 text-xs text-neutral-500">You are already searching at the highest available price.</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
