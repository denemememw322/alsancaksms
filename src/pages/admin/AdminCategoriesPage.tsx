import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminLayout } from '@/components/AdminLayout';
import type { Category } from '@/types/database';
import { Plus, Edit2, X, AlertCircle, Save } from 'lucide-react';

interface EditState {
  id?: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  is_active: boolean;
  sort_order: number;
}

const empty: EditState = { name: '', slug: '', description: '', icon: '', is_active: true, sort_order: 0 };

export function AdminCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from('categories').select('*').order('sort_order');
    if (error) setError('Failed to load categories.');
    else setCategories(data as Category[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function startCreate() { setEditing({ ...empty }); }
  function startEdit(cat: Category) {
    setEditing({
      id: cat.id, name: cat.name, slug: cat.slug, description: cat.description || '',
      icon: cat.icon || '', is_active: cat.is_active, sort_order: cat.sort_order,
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
      icon: editing.icon.trim() || null,
      is_active: editing.is_active,
      sort_order: editing.sort_order,
    };

    if (editing.id) {
      const { error } = await supabase.from('categories').update(payload).eq('id', editing.id);
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.from('categories').insert(payload);
      if (error) setError(error.message);
    }

    setSaving(false);
    if (!error) { setEditing(null); await load(); }
  }

  async function toggle(cat: Category) {
    const { error } = await supabase.from('categories').update({ is_active: !cat.is_active }).eq('id', cat.id);
    if (error) setError(error.message);
    else await load();
  }

  if (loading) return <AdminLayout title="Categories"><div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" /></div></AdminLayout>;

  return (
    <AdminLayout title="Categories">
      {error && <div className="mb-4 flex items-center gap-2 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-950/40 dark:text-error-400"><AlertCircle className="h-4 w-4" />{error}</div>}

      <button onClick={startCreate} className="btn-primary btn-sm mb-4"><Plus className="h-4 w-4" /> New category</button>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left text-xs uppercase text-neutral-500">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Slug</th>
              <th className="px-4 py-3 font-medium">Order</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/50">
            {categories.map((cat) => (
              <tr key={cat.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/30">
                <td className="px-4 py-3 font-medium text-neutral-900 dark:text-neutral-100">{cat.name}</td>
                <td className="px-4 py-3 text-neutral-500 font-mono text-xs">{cat.slug}</td>
                <td className="px-4 py-3 text-neutral-500">{cat.sort_order}</td>
                <td className="px-4 py-3">
                  <button onClick={() => toggle(cat)}>
                    <span className={cat.is_active ? 'badge-success' : 'badge-neutral'}>{cat.is_active ? 'Active' : 'Inactive'}</span>
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => startEdit(cat)} className="btn-ghost btn-sm"><Edit2 className="h-3.5 w-3.5" /></button>
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
              <h3 className="text-lg font-semibold">{editing.id ? 'Edit category' : 'New category'}</h3>
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
                  <label className="label">Icon name</label>
                  <input className="input font-mono text-sm" value={editing.icon} onChange={(e) => setEditing({ ...editing, icon: e.target.value })} placeholder="MessageSquare" />
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
