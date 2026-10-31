import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/i18n/I18nContext';
import { useRouter } from '@/context/RouterContext';
import { Search, ChevronDown, Loader2, AlertCircle, ShoppingCart, ArrowLeft } from 'lucide-react';

interface Svc { service_id: string; name: string; slug: string; countries: number; min_price: number; total: number }
interface Cty { country_id: string; name: string; iso_code: string; flag_emoji: string | null; min_price: number }
interface Tier { quantity: number; price: number }

const PAGE = 24;
const hue = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: `hsl(${hue(name)} 55% 45%)` }}>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function ServicesPage() {
  const { formatCurrency } = useI18n();
  const { route, navigate } = useRouter();
  const slug = route.path.startsWith('/services/') ? decodeURIComponent(route.path.slice('/services/'.length)) : null;

  const [query, setQuery] = useState('');
  const q = useDebounced(query, 250);
  const [services, setServices] = useState<Svc[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ service_id: string; name: string; slug: string } | null>(null);

  const load = useCallback(async (offset: number, replace: boolean) => {
    setLoading(true);
    const { data, error: e } = await supabase.rpc('catalog_search_services', { p_query: q, p_limit: PAGE, p_offset: offset });
    setLoading(false);
    if (e) { setError('Could not load services. Please try again.'); return; }
    setError(null);
    const rows = (data ?? []) as Svc[];
    setServices((prev) => (replace ? rows : [...prev, ...rows]));
    setTotal(rows[0]?.total ?? 0);
  }, [q]);

  useEffect(() => { load(0, true); }, [load]);

  useEffect(() => {
    if (!slug) { setSelected(null); return; }
    supabase.rpc('catalog_service_by_slug', { p_slug: slug }).then(({ data }) => {
      const r = (data as Array<{ service_id: string; name: string; slug: string }> | null)?.[0];
      setSelected(r ?? null);
    });
  }, [slug]);

  const pick = (s: { service_id: string; name: string; slug: string }) => { setSelected(s); navigate(`/services/${s.slug}`); };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {!selected && (
        <section>
          <h1 className="mb-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Service selection</h1>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input className="input pl-9 pr-28" placeholder="Search services (WhatsApp, Telegram, Google…)" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search services" />
            {!loading && <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded bg-primary-600 px-2 py-0.5 text-xs font-medium text-white">{total.toLocaleString()} found</span>}
          </div>
          {!q && <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-neutral-500">Popular services</h2>}
          {error && <p className="mt-4 flex items-center gap-2 text-sm text-error-700"><AlertCircle className="h-4 w-4" />{error}</p>}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {services.map((s) => (
              <button key={s.service_id} onClick={() => pick(s)} className="card flex items-center gap-3 p-3 text-left transition hover:border-primary-500">
                <Avatar name={s.name} />
                <span className="min-w-0"><span className="block truncate font-medium text-neutral-900 dark:text-neutral-100">{s.name}</span>
                  <span className="block text-xs text-neutral-500">{s.countries} countries · from {formatCurrency(s.min_price)}</span></span>
              </button>
            ))}
          </div>
          {!loading && services.length === 0 && !error && <p className="mt-8 text-center text-neutral-500">No services match “{q}”.</p>}
          {loading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div>}
          {!loading && services.length < total && <div className="mt-6 text-center"><button className="btn-secondary" onClick={() => load(services.length, false)}>Show more</button></div>}
        </section>
      )}
      {selected && <CountryPicker service={selected} onBack={() => { setSelected(null); navigate('/services'); }} />}
    </div>
  );
}

function CountryPicker({ service, onBack }: { service: { service_id: string; name: string; slug: string }; onBack: () => void }) {
  const { formatCurrency } = useI18n();
  const [countries, setCountries] = useState<Cty[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, number>>({});

  useEffect(() => {
    setLoading(true);
    supabase.rpc('catalog_service_countries', { p_service_id: service.service_id }).then(({ data }) => { setCountries((data ?? []) as Cty[]); setLoading(false); });
  }, [service.service_id]);

  const shown = useMemo(() => countries.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase())), [countries, search]);

  return (
    <section>
      <button className="mb-3 inline-flex items-center gap-1 text-sm text-primary-600 hover:underline" onClick={onBack}><ArrowLeft className="h-4 w-4" />All services</button>
      <h1 className="mb-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Country selection for <span className="text-primary-600">{service.name}</span></h1>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input className="input pl-9" placeholder="Search by country" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search by country" />
      </div>
      {loading && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div>}
      {!loading && countries.length === 0 && <p className="mt-8 text-center text-neutral-500">This service is currently out of stock in every country.</p>}
      <ul className="mt-4 space-y-2">
        {shown.map((c) => (
          <li key={c.country_id} className="card overflow-hidden">
            <button className="flex w-full items-center justify-between gap-3 p-3 text-left" onClick={() => setOpen(open === c.country_id ? null : c.country_id)} aria-expanded={open === c.country_id}>
              <span className="flex items-center gap-3"><span className="text-2xl">{c.flag_emoji ?? '🌐'}</span><span className="font-medium text-neutral-900 dark:text-neutral-100">{c.name}</span></span>
              <span className="flex items-center gap-3"><span className="text-sm text-neutral-500">from <b className="text-neutral-900 dark:text-neutral-100">{formatCurrency(live[c.country_id] ?? c.min_price)}</b></span>
                <ChevronDown className={`h-4 w-4 transition ${open === c.country_id ? 'rotate-180' : ''}`} /></span>
            </button>
            {open === c.country_id && <Tiers service={service} country={c} onLive={(p) => setLive((m) => ({ ...m, [c.country_id]: p }))} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tiers({ service, country, onLive }: { service: { service_id: string; name: string; slug: string }; country: Cty; onLive: (minPrice: number) => void }) {
  const { formatCurrency } = useI18n();
  const { user } = useAuth();
  const { navigate } = useRouter();
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [buying, setBuying] = useState<number | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const key = useRef<Record<number, string>>({});
  const onLiveRef = useRef(onLive);
  onLiveRef.current = onLive;

  const fetchTiers = useCallback(async () => {
    const { data } = await supabase.functions.invoke('catalog-tiers', { body: { service_id: service.service_id, country_id: country.country_id } });
    const list = (data?.tiers ?? []) as Tier[];
    setTiers(list);
    if (list.length) onLiveRef.current(Math.min(...list.map((t) => t.price)));
    setNote(data?.reason === 'provider_unreachable' ? 'Live stock could not be loaded. Please try again.' : data?.reason ? 'Out of stock right now.' : null);
  }, [service.service_id, country.country_id]);
  useEffect(() => { fetchTiers(); }, [fetchTiers]);
  useEffect(() => {
    if (!user) { setBalance(null); return; }
    supabase.from('user_wallets').select('balance').maybeSingle().then(({ data }) => setBalance(data ? Number(data.balance) : 0));
  }, [user]);

  async function buy(t: Tier) {
    if (!user) { sessionStorage.setItem('postLoginPath', `/services/${service.slug}`); navigate('/login'); return; }
    if (balance !== null && balance < t.price) { setMsg('Insufficient balance. Add funds in your wallet.'); return; }
    setBuying(t.price); setMsg(null);
    key.current[t.price] ??= crypto.randomUUID();
    const { data, error } = await supabase.functions.invoke('orders', { body: { action: 'purchase', service_id: service.service_id, country_id: country.country_id, expected_price: t.price, idempotency_key: key.current[t.price] } });
    setBuying(null);
    if (error) {
      let b: { error?: string; code?: string } = {};
      try { b = await (error as unknown as { context: Response }).context.json(); } catch { /* generic */ }
      setMsg(b.error ?? 'Purchase failed. You were not charged.');
      if (b.code === 'price_changed') { delete key.current[t.price]; fetchTiers(); }
      if (b.code === 'insufficient_funds') setMsg('Insufficient balance. Add funds in your wallet and try again.');
      return;
    }
    if (data?.order?.id) navigate(`/orders/${data.order.id}`);
  }

  if (!tiers) return <div className="flex justify-center border-t border-neutral-200 p-4 dark:border-neutral-800"><Loader2 className="h-5 w-5 animate-spin text-primary-600" /></div>;
  return (
    <div className="space-y-2 border-t border-neutral-200 p-3 dark:border-neutral-800">
      {tiers.length === 0 && <p className="text-sm text-neutral-500">{note ?? 'Out of stock right now.'}</p>}
      {tiers.map((t) => (
        <div key={t.price} className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-900">
          <span className="text-sm text-neutral-700 dark:text-neutral-300">Available {t.quantity.toLocaleString()} qty</span>
          {user && balance !== null && balance < t.price
            ? <button className="btn-secondary btn-sm" onClick={() => navigate('/wallet')} title={`Your balance: ${formatCurrency(balance)}`}>Add funds · {formatCurrency(t.price)}</button>
            : <button className="btn-primary btn-sm inline-flex items-center gap-1" disabled={buying !== null} onClick={() => buy(t)}>
                {buying === t.price ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}{formatCurrency(t.price)}
              </button>}
        </div>
      ))}
      {msg && <p className="flex items-center gap-2 text-sm text-error-700"><AlertCircle className="h-4 w-4" />{msg}</p>}
    </div>
  );
}
