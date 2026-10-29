import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminLayout } from '@/components/AdminLayout';
import type { Service, Category, Country, ServiceCountryAvailability } from '@/types/database';
import { Plus, Edit2, X, AlertCircle, Save, Globe } from 'lucide-react';

interface EditState {
  id?: string;
  name: string;
  slug: string;
  description: string;
  category_id: string;
  icon: string;
  is_active: boolean;
  is_archived: boolean;
  sort_order: number;
}

const empty: EditState = { name: '', slug: '', description: '', category_id: '', icon: '', is_active: true, is_archived: false, sort_order: 0 };

export function AdminServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [availability, setAvailability] = useState<ServiceCountryAvailability[]>([]);
  const [availService, setAvailService] = useState<Service | null>(null);
  const [countries, setCountries] = useState<Country[]>([]);

  async function load() {
    setLoading(true);
    const [svc, cat] = await Promise.all([
      supabase.from('services').select('*').order('sort_order'),
      supabase.from('categories').select('*').order('sort_order'),
    ]);
    if (svc.error) setError('Failed to load services.');
    else setServices(svc.data as Service[]);
    if (cat.data) setCategories(cat.data as Category[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function startCreate() { setEditing({ ...empty, category_id: categories[0]?.id || '' }); }
  function startEdit(s: Service) {
    setEditing({
      id: s.id, name: s.name, slug: s.slug, description: s.description || '',
      category_id: s.category_id || '', icon: s.icon || '', is_active: s.is_active,
      is_archived: s.is_archived, sort_order: s.sort_order,
    });
  }

  async function save() {
    if (!editing) return;
    if (!editing.name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError(null);

    const slug = editing.slug.trim() || editing.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const payload = {
      name: editing.name.trim(),
      slug,
      description: editing.description.trim() || null,
      category_id: editing.category_id || null,
      icon: editing.icon.trim() || null,
      is_active: editing.is_active,
      is_archived: editing.is_archived,
      sort_order: editing.sort_order,
    };

    if (editing.id) {
      const { error } = await supabase.from('services').update(payload).eq('id', editing.id);
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.from('services').insert(payload);
      if (error) setError(error.message);
    }

    setSaving(false);
    if (!error) { setEditing(null); await load(); }
  }

  async function loadAvailability(svc: Service) {
    setAvailService(svc);
    const [sca, ctr] = await Promise.all([
      supabase.from('service_country_availability').select('*').eq('service_id', svc.id).order('created_at'),
      supabase.from('countries').select('*').order('sort_order'),
    ]);
    if (sca.data) setAvailability(sca.data as ServiceCountryAvailability[]);
    if (ctr.data) setCountries(ctr.data as Country[]);
  }

  async function saveAvailability(sca: ServiceCountryAvailability) {
    const { error } = await supabase.from('service_country_availability')
      .update({ retail_price: sca.retail_price, wholesale_cost: sca.wholesale_cost, is_available: sca.is_available })
      .eq('id', sca.id);
    if (error) setError(error.message);
  }

  async function addAvailability(countryId: string, providerId: string) {
    if (!availService) return;
    const { error } = await supabase.from('service_country_availability').insert({
      service_id: availService.id,
      country_id: countryId,
      provider_id: providerId,
      wholesale_cost: 0.10,
      retail_price: 0.15,
      currency: 'USD',
      is_available: true,
      pricing_method: 'percentage_markup',
    });
    if (error) setError(error.message);
    else await loadAvailability(availService);
  }

  if (loading) return <AdminLayout title="Services"><div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" /></div></AdminLayout>;

  const catMap = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <AdminLayout title="Services">
      {error && <div className="mb-4 flex items-center gap-2 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-950/40 dark:text-error-400"><AlertCircle className="h-4 w-4" />{error}</div>}

      <button onClick={startCreate} className="btn-primary btn-sm mb-4"><Plus className="h-4 w-4" /> New service</button>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left text-xs uppercase text-neutral-500">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/50">
            {services.map((s) => (
              <tr key={s.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/30">
                <td className="px-4 py-3">
                  <div className="font-medium text-neutral-900 dark:text-neutral-100">{s.name}</div>
                  {s.is_demo && <span className="badge-warning mt-0.5">Demo</span>}
                </td>
                <td className="px-4 py-3 text-neutral-500">{s.category_id ? catMap.get(s.category_id) || '—' : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {s.is_active ? <span className="badge-success">Active</span> : <span className="badge-neutral">Inactive</span>}
                    {s.is_archived && <span className="badge-neutral">Archived</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => loadAvailability(s)} className="btn-ghost btn-sm" title="Manage availability"><Globe className="h-3.5 w-3.5" /></button>
                  <button onClick={() => startEdit(s)} className="btn-ghost btn-sm" title="Edit"><Edit2 className="h-3.5 w-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{editing.id ? 'Edit service' : 'New service'}</h3>
              <button onClick={() => setEditing(null)} className="btn-ghost btn-sm"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Name</label>
                <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div>
                <label className="label">Slug <span className="text-neutral-400">(auto from name if empty)</span></label>
                <input className="input font-mono text-sm" value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} placeholder="auto-generated" />
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="input" rows={2} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Category</label>
                  <select className="input" value={editing.category_id} onChange={(e) => setEditing({ ...editing, category_id: e.target.value })}>
                    <option value="">— None —</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Icon name</label>
                  <input className="input font-mono text-sm" value={editing.icon} onChange={(e) => setEditing({ ...editing, icon: e.target.value })} placeholder="MessageSquare" />
                </div>
              </div>
              <div>
                <label className="label">Sort order</label>
                <input type="number" className="input" value={editing.sort_order} onChange={(e) => setEditing({ ...editing, sort_order: parseInt(e.target.value) || 0 })} />
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} className="h-4 w-4 rounded border-neutral-300 text-primary-600" />
                  Active
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editing.is_archived} onChange={(e) => setEditing({ ...editing, is_archived: e.target.checked })} className="h-4 w-4 rounded border-neutral-300 text-primary-600" />
                  Archived
                </label>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="btn-secondary btn-sm">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary btn-sm"><Save className="h-3.5 w-3.5" />{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Availability modal */}
      {availService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAvailService(null)}>
          <div className="card w-full max-w-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Availability — {availService.name}</h3>
              <button onClick={() => setAvailService(null)} className="btn-ghost btn-sm"><X className="h-4 w-4" /></button>
            </div>

            {availability.length === 0 ? (
              <p className="py-8 text-center text-sm text-neutral-500">No availability rows yet.</p>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left text-xs uppercase text-neutral-500">
                      <th className="pb-2 font-medium">Country</th>
                      <th className="pb-2 font-medium">Cost</th>
                      <th className="pb-2 font-medium">Price</th>
                      <th className="pb-2 font-medium">Available</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/50">
                    {availability.map((sca) => {
                      const country = countries.find((c) => c.id === sca.country_id);
                      return (
                        <tr key={sca.id}>
                          <td className="py-2">{country?.flag_emoji} {country?.name || sca.country_id}</td>
                          <td className="py-2">
                            <input type="number" step="0.01" className="input py-1 text-xs w-20" defaultValue={sca.wholesale_cost}
                              onBlur={(e) => saveAvailability({ ...sca, wholesale_cost: parseFloat(e.target.value) || 0 })} />
                          </td>
                          <td className="py-2">
                            <input type="number" step="0.01" className="input py-1 text-xs w-20" defaultValue={sca.retail_price}
                              onBlur={(e) => saveAvailability({ ...sca, retail_price: parseFloat(e.target.value) || 0 })} />
                          </td>
                          <td className="py-2">
                            <input type="checkbox" defaultChecked={sca.is_available ?? false}
                              onChange={(e) => saveAvailability({ ...sca, is_available: e.target.checked })} className="h-4 w-4 rounded border-neutral-300 text-primary-600" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
              <label className="label">Add availability for a country</label>
              <div className="flex gap-2">
                <select id="new-country" className="input flex-1">
                  <option value="">Select country...</option>
                  {countries.filter((c) => !availability.some((a) => a.country_id === c.id)).map((c) => (
                    <option key={c.id} value={c.id}>{c.flag_emoji} {c.name}</option>
                  ))}
                </select>
                <button onClick={() => {
                  const sel = document.getElementById('new-country') as HTMLSelectElement;
                  const providerId = '00000000-0000-0000-0000-000000000001';
                  if (sel.value) addAvailability(sel.value, providerId);
                }} className="btn-primary btn-sm"><Plus className="h-3.5 w-3.5" /> Add</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
