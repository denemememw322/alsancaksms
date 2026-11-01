import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { callFn } from '@/lib/functions';
import { AdminLayout } from '@/components/AdminLayout';
import { Plus, Search, Trash2, ChevronDown, ChevronRight, Loader2, ArrowLeft, AlertCircle, Square } from 'lucide-react';

interface Row { service_id: string; name: string; slug: string; is_active: boolean; country_mode: string; countries: number; tiers: number; min_cost: number | null; total: number }
interface Tier { id: string; key: string; cost: number; quantity: number; ratio: number; retail: number; is_enabled: boolean; in_stock: boolean }
interface Country { availability_id: string; country_id: string; name: string; iso: string; flag: string | null; is_enabled: boolean; tiers: Tier[] }
interface Detail { service: { id: string; name: string; country_mode: string }; mapping: { provider_id: string; code: string } | null; countries: Country[] }
interface Cty { country_id: string; name: string; iso_code: string; flag_emoji: string | null }
interface Platform { code: string; name: string; added: boolean }
type View = { mode: 'list' } | { mode: 'add' } | { mode: 'manage'; id: string };

const flip = (set: Set<string>, key: string) => { const n = new Set(set); if (n.has(key)) n.delete(key); else n.add(key); return n; };
const usd = (n: number) => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;

export function AdminServicesPage() {
  const [view, setView] = useState<View>({ mode: 'list' });
  return (
    <AdminLayout title="Services">
      {view.mode === 'list' && <ServiceList onAdd={() => setView({ mode: 'add' })} onOpen={(id) => setView({ mode: 'manage', id })} />}
      {view.mode === 'add' && <AddFromApi onBack={() => setView({ mode: 'list' })} />}
      {view.mode === 'manage' && <Manager id={view.id} onBack={() => setView({ mode: 'list' })} />}
    </AdminLayout>
  );
}

function ServiceList({ onAdd, onOpen }: { onAdd: () => void; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const PAGE = 50;

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_list_services', { p_q: q, p_limit: PAGE, p_offset: page * PAGE });
    setLoading(false);
    if (error) setErr(error.message); else { setErr(null); setRows((data ?? []) as Row[]); }
  }, [q, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function del(r: Row) {
    if (!confirm(`Delete “${r.name}” and all its countries and price options? Past orders are kept.`)) return;
    const { error } = await supabase.rpc('admin_delete_service', { p_service: r.service_id });
    if (error) setErr(error.message); else load();
  }
  const total = rows[0]?.total ?? 0;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input className="input pl-9" placeholder="Search services" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} /></div>
        <button className="btn-primary btn-sm inline-flex items-center gap-1" onClick={onAdd}><Plus className="h-4 w-4" />Add services from API</button>
      </div>
      {err && <p className="mb-3 flex items-center gap-2 text-sm text-error-700"><AlertCircle className="h-4 w-4" />{err}</p>}
      <div className="card overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500 dark:border-neutral-800"><th className="p-3">Service</th><th>Countries</th><th>Price options</th><th>Cheapest cost</th><th>Countries mode</th><th className="pr-3 text-right">Actions</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.service_id} className="border-b border-neutral-100 dark:border-neutral-900">
            <td className="p-3 font-medium text-neutral-900 dark:text-neutral-100">{r.name}</td><td>{r.countries}</td><td>{r.tiers}</td><td className="font-mono">{r.min_cost != null ? usd(Number(r.min_cost)) : '—'}</td>
            <td><span className="badge-neutral">{r.country_mode === 'all' ? 'all with stock' : 'selected only'}</span></td>
            <td className="pr-3"><div className="flex justify-end gap-1"><button className="btn-secondary btn-sm" onClick={() => onOpen(r.service_id)}>Manage</button>
              <button className="btn-ghost btn-sm text-error-700" onClick={() => del(r)} aria-label={`Delete ${r.name}`}><Trash2 className="h-4 w-4" /></button></div></td></tr>))}</tbody></table>
        {loading && <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin text-primary-600" /></div>}
        {!loading && rows.length === 0 && <p className="p-8 text-center text-neutral-500">{q ? 'No services match your search.' : 'No services yet. Click “Add services from API” to choose platforms from your provider.'}</p>}
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-neutral-500"><span>{total} services</span>
        <div className="flex gap-2"><button className="btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><button className="btn-secondary btn-sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</button></div></div>
    </>
  );
}

function CountryPicker({ countries, picked, setPicked }: { countries: Cty[]; picked: Set<string>; setPicked: (s: Set<string>) => void }) {
  const [s, setS] = useState('');
  const shown = countries.filter((c) => c.name.toLowerCase().includes(s.toLowerCase()));
  const toggle = (id: string) => setPicked(flip(picked, id));
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-2 flex items-center gap-2"><input className="input" placeholder="Search countries" value={s} onChange={(e) => setS(e.target.value)} />
        <button className="btn-secondary btn-sm whitespace-nowrap" onClick={() => setPicked(new Set())}>Clear</button></div>
      <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3">
        {shown.map((c) => (<label key={c.country_id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={picked.has(c.country_id)} onChange={() => toggle(c.country_id)} />{c.flag_emoji ?? ''} {c.name}</label>))}
      </div>
    </div>
  );
}

function AddFromApi({ onBack }: { onBack: () => void }) {
  const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([]);
  const [pid, setPid] = useState('');
  const [platforms, setPlatforms] = useState<Platform[] | null>(null);
  const [loadingP, setLoadingP] = useState(false);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [countries, setCountries] = useState<Cty[]>([]);
  const [cPicked, setCPicked] = useState<Set<string>>(new Set());
  const [showC, setShowC] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [prog, setProg] = useState<{ done: number; total: number; running: boolean; log: string[] } | null>(null);
  const stop = useRef(false);

  useEffect(() => {
    supabase.from('providers').select('id,name,slug,base_url').neq('slug', 'demo-provider').not('base_url', 'is', null).then(({ data }) => {
      const list = (data ?? []) as Array<{ id: string; name: string }>;
      setProviders(list); if (list[0]) setPid(list[0].id);
    });
  }, []);
  useEffect(() => {
    if (!pid) return;
    setPlatforms(null); setPicked(new Set()); setCPicked(new Set());
    supabase.rpc('admin_provider_countries', { p_provider: pid }).then(({ data }) => setCountries((data ?? []) as Cty[]));
  }, [pid]);

  async function loadPlatforms() {
    setLoadingP(true); setErr(null);
    const r = await callFn<{ platforms: Platform[] }>('catalog-admin', { action: 'platforms', provider_id: pid });
    setLoadingP(false);
    if (r.error) setErr(r.error); else setPlatforms(r.data!.platforms);
  }
  const shown = useMemo(() => (platforms ?? []).filter((p) => p.name.toLowerCase().includes(search.toLowerCase())), [platforms, search]);
  const allShownPicked = shown.length > 0 && shown.every((p) => picked.has(p.code));
  const toggleAll = () => { const n = new Set(picked); shown.forEach((p) => (allShownPicked ? n.delete(p.code) : n.add(p.code))); setPicked(n); };

  async function run() {
    const list = (platforms ?? []).filter((p) => picked.has(p.code));
    if (!list.length) return;
    stop.current = false;
    const log: string[] = [];
    setProg({ done: 0, total: list.length, running: true, log });
    const BATCH = 4;
    for (let i = 0; i < list.length && !stop.current; i += BATCH) {
      const batch = list.slice(i, i + BATCH);
      let r = await callFn<{ results: Array<{ name: string; countries?: number; tiers?: number; error?: string }> }>('catalog-admin', { action: 'add', provider_id: pid, services: batch.map(({ code, name }) => ({ code, name })), country_ids: [...cPicked] });
      if (r.error) r = await callFn('catalog-admin', { action: 'add', provider_id: pid, services: batch.map(({ code, name }) => ({ code, name })), country_ids: [...cPicked] });
      if (r.error) batch.forEach((b) => log.unshift(`✗ ${b.name}: ${r.error}`));
      else r.data!.results.forEach((x) => log.unshift(x.error ? `✗ ${x.name}: ${x.error}` : x.countries ? `✓ ${x.name}: ${x.countries} countries, ${x.tiers} price options` : `• ${x.name}: no numbers available right now (added without countries)`));
      setProg({ done: Math.min(i + BATCH, list.length), total: list.length, running: true, log: log.slice(0, 60) });
    }
    setProg((p) => (p ? { ...p, running: false } : p));
  }

  return (
    <>
      <button className="mb-3 inline-flex items-center gap-1 text-sm text-primary-600 hover:underline" onClick={onBack}><ArrowLeft className="h-4 w-4" />All services</button>
      <div className="card space-y-4 p-5">
        <div><h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Add services from API</h2>
          <p className="text-sm text-neutral-500">Pick platforms. For each one, every country that really has numbers is added automatically, with all of its price options. Countries without numbers are never added.</p></div>
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="label">Provider API</label><select className="input min-w-[12rem]" value={pid} onChange={(e) => setPid(e.target.value)}>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <button className="btn-primary btn-sm inline-flex items-center gap-1" disabled={!pid || loadingP} onClick={loadPlatforms}>{loadingP && <Loader2 className="h-4 w-4 animate-spin" />}Load platforms</button>
        </div>
        {providers.length === 0 && <p className="text-sm text-neutral-500">No provider with an API URL yet. Add one under API Providers.</p>}
        {err && <p className="flex items-center gap-2 text-sm text-error-700"><AlertCircle className="h-4 w-4" />{err}</p>}

        {platforms && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <input className="input max-w-xs" placeholder="Search platforms" value={search} onChange={(e) => setSearch(e.target.value)} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allShownPicked} onChange={toggleAll} />Select all {search ? 'matching' : ''} ({shown.length})</label>
              <span className="text-sm font-medium text-primary-600">{picked.size} selected</span>
            </div>
            <div className="grid max-h-80 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-neutral-200 p-2 sm:grid-cols-2 lg:grid-cols-3 dark:border-neutral-800">
              {shown.slice(0, 600).map((p) => (
                <label key={p.code} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900">
                  <input type="checkbox" checked={picked.has(p.code)} onChange={() => setPicked(flip(picked, p.code))} />
                  <span className="truncate">{p.name}</span>{p.added && <span className="badge-success ml-auto">added</span>}</label>))}
              {shown.length > 600 && <p className="col-span-full p-2 text-xs text-neutral-500">Showing the first 600 of {shown.length}. Use search to narrow down, or “Select all” to take every match.</p>}
            </div>
            <div>
              <button className="inline-flex items-center gap-1 text-sm font-medium text-primary-600" onClick={() => setShowC(!showC)}>{showC ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}Only specific countries? {cPicked.size > 0 ? `(${cPicked.size} chosen)` : '(optional, empty = all countries that have numbers)'}</button>
              {showC && <div className="mt-2"><CountryPicker countries={countries} picked={cPicked} setPicked={setCPicked} /></div>}
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-primary" disabled={!picked.size || !!prog?.running} onClick={run}>Add {picked.size || ''} selected</button>
              {prog?.running && <button className="btn-secondary inline-flex items-center gap-1" onClick={() => { stop.current = true; }}><Square className="h-4 w-4" />Stop</button>}
            </div>
          </>
        )}
        {prog && (
          <div>
            <div className="mb-1 h-2 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-primary-600 transition-all" style={{ width: `${(prog.done / prog.total) * 100}%` }} /></div>
            <p className="mb-2 text-xs text-neutral-500">{prog.done} / {prog.total} {prog.running ? 'processing…' : 'finished'}</p>
            <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded bg-neutral-50 p-2 font-mono text-xs dark:bg-neutral-900">{prog.log.map((l, i) => <li key={i} className={l.startsWith('✗') ? 'text-error-700' : ''}>{l}</li>)}</ul>
          </div>
        )}
      </div>
    </>
  );
}

function TierRow({ t, index, onChange }: { t: Tier; index: number; onChange: (patch: Partial<Tier>) => void }) {
  const [price, setPrice] = useState(String(t.retail));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setPrice(String(t.retail)), [t.retail]);
  async function save() {
    const v = Number(price);
    if (!Number.isFinite(v) || v === Number(t.retail)) return;
    const { error } = await supabase.rpc('admin_set_tier_price', { p_tier: t.id, p_price: v });
    if (error) { setErr(error.message.replace(/^.*Price cannot/, 'Price cannot')); setPrice(String(t.retail)); } else { setErr(null); onChange({ retail: v, ratio: v / Number(t.cost) }); }
  }
  async function toggle() {
    const { error } = await supabase.rpc('admin_set_tier_enabled', { p_tier: t.id, p_enabled: !t.is_enabled });
    if (!error) onChange({ is_enabled: !t.is_enabled });
  }
  return (
    <tr className={`border-t border-neutral-100 dark:border-neutral-900 ${t.is_enabled ? '' : 'opacity-50'}`}>
      <td className="py-1.5 pl-3"><input type="checkbox" checked={t.is_enabled} onChange={toggle} aria-label={`Show option ${index + 1}`} /></td>
      <td>Option {index + 1}</td><td className="font-mono">{usd(Number(t.cost))}</td><td>{Number(t.quantity).toLocaleString()}</td><td className="font-mono">× {Number(t.ratio).toFixed(2)}</td>
      <td><div className="flex items-center gap-1">$<input type="number" step="0.001" className="input w-28 py-1" value={price} onChange={(e) => setPrice(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></div>{err && <span className="text-xs text-error-700">{err}</span>}</td>
      <td className="pr-3">{t.in_stock ? <span className="badge-success">in stock</span> : <span className="badge-neutral">out of stock</span>}</td>
    </tr>
  );
}

function Manager({ id, onBack }: { id: string; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [ratio, setRatio] = useState('2');
  const [onlyEnabled, setOnlyEnabled] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [all, setAll] = useState<Cty[]>([]);
  const [cPicked, setCPicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_service_detail', { p_service: id });
    if (error || !data) setErr(error?.message ?? 'Not found'); else setD(data as Detail);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const patchTier = (cid: string, tid: string, patch: Partial<Tier>) => setD((x) => x && ({ ...x, countries: x.countries.map((c) => (c.country_id === cid ? { ...c, tiers: c.tiers.map((t) => (t.id === tid ? { ...t, ...patch } : t)) } : c)) }));
  async function toggleCountry(c: Country) {
    const { error } = await supabase.rpc('admin_set_country_enabled', { p_avail: c.availability_id, p_enabled: !c.is_enabled });
    if (!error) setD((x) => x && ({ ...x, countries: x.countries.map((y) => (y.country_id === c.country_id ? { ...y, is_enabled: !c.is_enabled } : y)) }));
  }
  async function bulk() {
    const r = Number(ratio);
    setMsg(null);
    const { data, error } = await supabase.rpc('admin_bulk_set_ratio', { p_service: id, p_ratio: r, p_only_enabled: onlyEnabled });
    if (error) setMsg(error.message); else { setMsg(`Updated ${data} price options. Prices will keep following provider cost with this multiplier.`); load(); }
  }
  async function openMore() {
    setMore(!more);
    if (!all.length && d?.mapping) { const { data } = await supabase.rpc('admin_provider_countries', { p_provider: d.mapping.provider_id }); setAll((data ?? []) as Cty[]); }
  }
  async function addCountries() {
    if (!d?.mapping || !cPicked.size) return;
    setAdding(true); setMsg(null);
    const r = await callFn<{ results: Array<{ countries?: number; tiers?: number; error?: string }> }>('catalog-admin', { action: 'add', provider_id: d.mapping.provider_id, services: [{ code: d.mapping.code, name: d.service.name }], country_ids: [...cPicked] });
    setAdding(false);
    if (r.error) setMsg(r.error); else { const x = r.data!.results[0]; setMsg(x.error ?? (x.countries ? `Added ${x.countries} countries.` : 'None of the chosen countries has numbers right now, so nothing was added.')); setCPicked(new Set()); load(); }
  }

  if (err) return <p className="text-error-700">{err}</p>;
  if (!d) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div>;
  const existing = new Set(d.countries.map((c) => c.country_id));
  return (
    <>
      <button className="mb-3 inline-flex items-center gap-1 text-sm text-primary-600 hover:underline" onClick={onBack}><ArrowLeft className="h-4 w-4" />All services</button>
      <h2 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">{d.service.name}</h2>
      <p className="mb-4 text-sm text-neutral-500">{d.countries.length} countries · untick a country or a price option to hide it from customers. Sell prices follow provider cost automatically and never go below it.</p>

      <div className="card mb-4 space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="label">Sell price for all options = provider cost ×</label><input type="number" step="0.01" min="1" className="input w-32" value={ratio} onChange={(e) => setRatio(e.target.value)} /></div>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={onlyEnabled} onChange={(e) => setOnlyEnabled(e.target.checked)} />only ticked options</label>
          <button className="btn-primary btn-sm" disabled={!(Number(ratio) >= 1)} onClick={bulk}>Apply to all countries</button>
          <span className="pb-2 text-xs text-neutral-500">e.g. 2 = 100% markup. You can still set an exact price on any single option below.</span>
        </div>
        {d.mapping && <div><button className="inline-flex items-center gap-1 text-sm font-medium text-primary-600" onClick={openMore}>{more ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}Add more countries</button>
          {more && <div className="mt-2 space-y-2"><CountryPicker countries={all.filter((c) => !existing.has(c.country_id))} picked={cPicked} setPicked={setCPicked} />
            <button className="btn-primary btn-sm inline-flex items-center gap-1" disabled={!cPicked.size || adding} onClick={addCountries}>{adding && <Loader2 className="h-4 w-4 animate-spin" />}Add {cPicked.size || ''} countries</button></div>}</div>}
        {msg && <p className="text-sm text-neutral-700 dark:text-neutral-300">{msg}</p>}
      </div>

      <div className="space-y-2">
        {d.countries.map((c) => {
          const isOpen = open.has(c.country_id);
          const live = c.tiers.filter((t) => t.in_stock);
          return (
            <div key={c.country_id} className={`card overflow-hidden ${c.is_enabled ? '' : 'opacity-60'}`}>
              <div className="flex items-center gap-3 p-3">
                <input type="checkbox" checked={c.is_enabled} onChange={() => toggleCountry(c)} aria-label={`Show ${c.name}`} />
                <button className="flex flex-1 items-center justify-between text-left" onClick={() => setOpen(flip(open, c.country_id))}>
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">{c.flag ?? ''} {c.name}</span>
                  <span className="flex items-center gap-3 text-sm text-neutral-500">{live.length} option{live.length === 1 ? '' : 's'}{live.length ? ` · from ${usd(Math.min(...live.map((t) => Number(t.cost))))}` : ' · out of stock'}{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span></button>
              </div>
              {isOpen && (
                <table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-neutral-500"><th className="pl-3">Show</th><th>Option</th><th>Provider cost</th><th>Quantity</th><th>Multiplier</th><th>Your sell price</th><th className="pr-3">Stock</th></tr></thead>
                  <tbody>{c.tiers.map((t, i) => <TierRow key={t.id} t={t} index={i} onChange={(p) => patchTier(c.country_id, t.id, p)} />)}</tbody></table>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
