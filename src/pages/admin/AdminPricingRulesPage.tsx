import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminLayout } from '@/components/AdminLayout';
import { useI18n } from '@/i18n/I18nContext';
import type { PricingRule, PricingRuleScope, PricingMethod, Category, Country, Service, Provider } from '@/types/database';
import { Plus, Edit2, X, AlertCircle, Save, Trash2 } from 'lucide-react';

const SCOPES: { value: PricingRuleScope; label: string }[] = [
  { value: 'global', label: 'Global' },
  { value: 'provider', label: 'Provider' },
  { value: 'category', label: 'Category' },
  { value: 'country', label: 'Country' },
  { value: 'service', label: 'Service' },
  { value: 'service_country', label: 'Service + Country' },
];

const METHODS: { value: PricingMethod; label: string }[] = [
  { value: 'percentage_markup', label: 'Percentage markup on cost' },
  { value: 'fixed_markup', label: 'Fixed markup' },
  { value: 'target_margin', label: 'Target gross margin' },
  { value: 'manual', label: 'Manual price' },
];

const empty: Partial<PricingRule> = {
  scope: 'global', pricing_method: 'percentage_markup', markup_percentage: 50,
  fixed_markup: 0, target_margin_percentage: 40, round_to: 0.01, is_active: true,
};

export function AdminPricingRulesPage() {
  const { formatCurrency } = useI18n();
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<PricingRule> | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [r, c, ctr, s, p] = await Promise.all([
      supabase.from('pricing_rules').select('*').order('scope, created_at'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('countries').select('*').order('name'),
      supabase.from('services').select('*').order('name'),
      supabase.from('providers').select('*').order('name'),
    ]);
    if (r.error) setError('Failed to load pricing rules.');
    else setRules(r.data as PricingRule[]);
    if (c.data) setCategories(c.data as Category[]);
    if (ctr.data) setCountries(ctr.data as Country[]);
    if (s.data) setServices(s.data as Service[]);
    if (p.data) setProviders(p.data as Provider[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function startCreate() { setEditing({ ...empty }); }
  function startEdit(r: PricingRule) { setEditing({ ...r }); }

  async function save() {
    if (!editing) return;
    setSaving(true);
    setError(null);

    const payload = {
      scope: editing.scope,
      provider_id: editing.scope === 'provider' || editing.scope === 'service_country' ? editing.provider_id : null,
      category_id: editing.scope === 'category' ? editing.category_id : null,
      country_id: editing.scope === 'country' || editing.scope === 'service_country' ? editing.country_id : null,
      service_id: editing.scope === 'service' || editing.scope === 'service_country' ? editing.service_id : null,
      pricing_method: editing.pricing_method,
      markup_percentage: editing.markup_percentage ?? null,
      fixed_markup: editing.fixed_markup ?? null,
      target_margin_percentage: editing.target_margin_percentage ?? null,
      min_price: editing.min_price ?? null,
      min_margin_pct: editing.min_margin_pct ?? null,
      round_to: editing.round_to ?? 0.01,
      is_active: editing.is_active ?? true,
    };

    if (editing.id) {
      const { error } = await supabase.from('pricing_rules').update(payload).eq('id', editing.id);
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.from('pricing_rules').insert(payload);
      if (error) setError(error.message);
    }

    setSaving(false);
    if (!error) { setEditing(null); await load(); }
  }

  async function remove(id: string) {
    const { error } = await supabase.from('pricing_rules').delete().eq('id', id);
    if (error) setError(error.message);
    else await load();
  }

  function scopeLabel(r: PricingRule): string {
    const parts: string[] = [];
    if (r.provider_id) parts.push(providers.find((p) => p.id === r.provider_id)?.name || r.provider_id);
    if (r.category_id) parts.push(categories.find((c) => c.id === r.category_id)?.name || r.category_id);
    if (r.country_id) parts.push(countries.find((c) => c.id === r.country_id)?.name || r.country_id);
    if (r.service_id) parts.push(services.find((s) => s.id === r.service_id)?.name || r.service_id);
    return parts.join(' · ') || '—';
  }

  function methodLabel(r: PricingRule): string {
    const m = METHODS.find((m) => m.value === r.pricing_method);
    if (!m) return r.pricing_method;
    let detail = '';
    if (r.pricing_method === 'percentage_markup' && r.markup_percentage) detail = ` (${r.markup_percentage}%)`;
    if (r.pricing_method === 'fixed_markup' && r.fixed_markup) detail = ` (+${formatCurrency(r.fixed_markup)})`;
    if (r.pricing_method === 'target_margin' && r.target_margin_percentage) detail = ` (${r.target_margin_percentage}% margin)`;
    return m.label + detail;
  }

  if (loading) return <AdminLayout title="Pricing Rules"><div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" /></div></AdminLayout>;

  return (
    <AdminLayout title="Pricing Rules">
      {error && <div className="mb-4 flex items-center gap-2 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-950/40 dark:text-error-400"><AlertCircle className="h-4 w-4" />{error}</div>}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-neutral-500">
          Precedence: service+country &gt; service &gt; country &gt; category &gt; provider &gt; global
        </p>
        <button onClick={startCreate} className="btn-primary btn-sm"><Plus className="h-4 w-4" /> New rule</button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left text-xs uppercase text-neutral-500">
              <th className="px-4 py-3 font-medium">Scope</th>
              <th className="px-4 py-3 font-medium">Applies to</th>
              <th className="px-4 py-3 font-medium">Method</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/50">
            {rules.map((r) => (
              <tr key={r.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/30">
                <td className="px-4 py-3"><span className="badge-primary capitalize">{r.scope.replace('_', ' ')}</span></td>
                <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{scopeLabel(r)}</td>
                <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{methodLabel(r)}</td>
                <td className="px-4 py-3">{r.is_active ? <span className="badge-success">Active</span> : <span className="badge-neutral">Inactive</span>}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => startEdit(r)} className="btn-ghost btn-sm"><Edit2 className="h-3.5 w-3.5" /></button>
                  <button onClick={() => remove(r.id)} className="btn-ghost btn-sm text-error-600"><Trash2 className="h-3.5 w-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{editing.id ? 'Edit rule' : 'New pricing rule'}</h3>
              <button onClick={() => setEditing(null)} className="btn-ghost btn-sm"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Scope</label>
                <select className="input" value={editing.scope} onChange={(e) => setEditing({ ...editing, scope: e.target.value as PricingRuleScope })}>
                  {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              {(editing.scope === 'provider' || editing.scope === 'service_country') && (
                <div>
                  <label className="label">Provider</label>
                  <select className="input" value={editing.provider_id || ''} onChange={(e) => setEditing({ ...editing, provider_id: e.target.value || null })}>
                    <option value="">— Any —</option>
                    {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              {editing.scope === 'category' && (
                <div>
                  <label className="label">Category</label>
                  <select className="input" value={editing.category_id || ''} onChange={(e) => setEditing({ ...editing, category_id: e.target.value || null })}>
                    <option value="">— Select —</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              {(editing.scope === 'country' || editing.scope === 'service_country') && (
                <div>
                  <label className="label">Country</label>
                  <select className="input" value={editing.country_id || ''} onChange={(e) => setEditing({ ...editing, country_id: e.target.value || null })}>
                    <option value="">— Select —</option>
                    {countries.map((c) => <option key={c.id} value={c.id}>{c.flag_emoji} {c.name}</option>)}
                  </select>
                </div>
              )}
              {(editing.scope === 'service' || editing.scope === 'service_country') && (
                <div>
                  <label className="label">Service</label>
                  <select className="input" value={editing.service_id || ''} onChange={(e) => setEditing({ ...editing, service_id: e.target.value || null })}>
                    <option value="">— Select —</option>
                    {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="label">Pricing method</label>
                <select className="input" value={editing.pricing_method} onChange={(e) => setEditing({ ...editing, pricing_method: e.target.value as PricingMethod })}>
                  {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Markup %</label>
                  <input type="number" step="0.01" className="input" value={editing.markup_percentage ?? ''} onChange={(e) => setEditing({ ...editing, markup_percentage: e.target.value ? parseFloat(e.target.value) : null })} />
                </div>
                <div>
                  <label className="label">Fixed markup</label>
                  <input type="number" step="0.01" className="input" value={editing.fixed_markup ?? ''} onChange={(e) => setEditing({ ...editing, fixed_markup: e.target.value ? parseFloat(e.target.value) : null })} />
                </div>
                <div>
                  <label className="label">Target margin %</label>
                  <input type="number" step="0.01" className="input" value={editing.target_margin_percentage ?? ''} onChange={(e) => setEditing({ ...editing, target_margin_percentage: e.target.value ? parseFloat(e.target.value) : null })} />
                </div>
                <div>
                  <label className="label">Round to</label>
                  <input type="number" step="0.01" className="input" value={editing.round_to ?? 0.01} onChange={(e) => setEditing({ ...editing, round_to: e.target.value ? parseFloat(e.target.value) : 0.01 })} />
                </div>
                <div>
                  <label className="label">Min price</label>
                  <input type="number" step="0.01" className="input" value={editing.min_price ?? ''} onChange={(e) => setEditing({ ...editing, min_price: e.target.value ? parseFloat(e.target.value) : null })} />
                </div>
                <div>
                  <label className="label">Min margin %</label>
                  <input type="number" step="0.01" className="input" value={editing.min_margin_pct ?? ''} onChange={(e) => setEditing({ ...editing, min_margin_pct: e.target.value ? parseFloat(e.target.value) : null })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.is_active ?? true} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} className="h-4 w-4 rounded border-neutral-300 text-primary-600" />
                Active
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="btn-secondary btn-sm">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary btn-sm"><Save className="h-3.5 w-3.5" />{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
