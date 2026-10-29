import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminLayout } from '@/components/AdminLayout';
import type { Country } from '@/types/database';
import { Plus, Edit2, X, AlertCircle, Save } from 'lucide-react';

interface EditState {
  id?: string;
  iso_code: string;
  name: string;
  flag_emoji: string;
  calling_code: string;
  is_active: boolean;
  sort_order: number;
}

const empty: EditState = { iso_code: '', name: '', flag_emoji: '', calling_code: '', is_active: true, sort_order: 0 };

export function AdminCountriesPage() {
  const [countries, setCountries] = useState<Country[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from('countries').select('*').order('sort_order');
    if (error) setError('Failed to load countries.');
    else setCountries(data as Country[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function startCreate() { setEditing({ ...empty }); }
  function startEdit(c: Country) {
    setEditing({
      id: c.id, iso_code: c.iso_code, name: c.name, flag_emoji: c.flag_emoji || '',
      calling_code: c.calling_code || '', is_active: c.is_active, sort_order: c.sort_order,
    });
  }

  async function save() {
    if (!editing) return;
    if (!editing.iso_code.trim() || !editing.name.trim()) { setError('ISO code and name are required.'); return; }
    setSaving(true);
    setError(null);

    const payload = {
      iso_code: editing.iso_code.trim().toUpperCase(),
      name: editing.name.trim(),
      flag_emoji: editing.flag_emoji.trim() || null,
      calling_code: editing.calling_code.trim() || null,
      is_active: editing.is_active,
      sort_order: editing.sort_order,
    };

    if (editing.id) {
      const { error } = await supabase.from('countries').update(payload).eq('id', editing.id);
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.from('countries').insert(payload);
      if (error) setError(error.message);
    }

    setSaving(false);
    if (!error) { setEditing(null); await load(); }
  }

  async function toggle(c: Country) {
    const { error } = await supabase.from('countries').update({ is_active: !c.is_active }).eq('id', c.id);
    if (error) setError(error.message);
    else await load();
  }

  if (loading) return <AdminLayout title="Countries"><div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" /></div></AdminLayout>;

  return (
    <AdminLayout title="Countries">
      {error && <div className="mb-4 flex items-center gap-2 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-950/40 dark:text-error-400"><AlertCircle className="h-4 w-4" />{error}</div>}

      <button onClick={startCreate} className="btn-primary btn-sm mb-4"><Plus className="h-4 w-4" /> New country</button>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left text-xs uppercase text-neutral-500">
              <th className="px-4 py-3 font-medium">Country</th>
              <th className="px-4 py-3 font-medium">ISO</th>
              <th className="px-4 py-3 font-medium">Calling code</th>
              <th className="px-4 py-3 font-medium">Order</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/50">
            {countries.map((c) => (
              <tr key={c.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/30">
                <td className="px-4 py-3 font-medium text-neutral-900 dark:text-neutral-100">
                  <span className="mr-2">{c.flag_emoji}</span>{c.name}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-neutral-500">{c.iso_code}</td>
                <td className="px-4 py-3 text-neutral-500">{c.calling_code || '—'}</td>
                <td className="px-4 py-3 text-neutral-500">{c.sort_order}</td>
                <td className="px-4 py-3">
                  <button onClick={() => toggle(c)}>
                    <span className={c.is_active ? 'badge-success' : 'badge-neutral'}>{c.is_active ? 'Active' : 'Inactive'}</span>
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => startEdit(c)} className="btn-ghost btn-sm"><Edit2 className="h-3.5 w-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{editing.id ? 'Edit country' : 'New country'}</h3>
              <button onClick={() => setEditing(null)} className="btn-ghost btn-sm"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">ISO code</label>
                  <input className="input font-mono text-sm uppercase" maxLength={2} value={editing.iso_code} onChange={(e) => setEditing({ ...editing, iso_code: e.target.value })} placeholder="US" />
                </div>
                <div>
                  <label className="label">Calling code</label>
                  <input className="input" value={editing.calling_code} onChange={(e) => setEditing({ ...editing, calling_code: e.target.value })} placeholder="+1" />
                </div>
              </div>
              <div>
                <label className="label">Name</label>
                <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Flag emoji</label>
                  <input className="input" value={editing.flag_emoji} onChange={(e) => setEditing({ ...editing, flag_emoji: e.target.value })} placeholder="🇺🇸" />
                </div>
                <div>
                  <label className="label">Sort order</label>
                  <input type="number" className="input" value={editing.sort_order} onChange={(e) => setEditing({ ...editing, sort_order: parseInt(e.target.value) || 0 })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} className="h-4 w-4 rounded border-neutral-300 text-primary-600" />
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
