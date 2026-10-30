import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminLayout } from '@/components/AdminLayout';
import { useI18n } from '@/i18n/I18nContext';
import type { Provider, ProviderSyncJob } from '@/types/database';
import { AlertCircle, Server, Activity, Plus, Pencil, X } from 'lucide-react';
import { CredentialFields, type CredentialDef } from '@/components/CredentialFields';
import { ProviderSyncPanel } from '@/components/ProviderSyncPanel';
import type { ProviderAuthMethod } from '@/types/database';

const CREDS: Record<ProviderAuthMethod, CredentialDef[]> = {
  api_key: [{ key: 'api_key', label: 'API key', help: 'Found in your SMS provider account under API / Profile settings.' }],
  query_param: [{ key: 'api_key', label: 'API key (sent as query parameter)', help: 'Found in your SMS provider account under API / Profile settings.' }],
  bearer: [{ key: 'token', label: 'Bearer token', help: 'API token issued by the provider.' }],
  basic: [
    { key: 'username', label: 'Username', help: 'Provider account username.' },
    { key: 'password', label: 'Password', help: 'Provider account password.' },
  ],
};

interface Draft { id: string | null; name: string; slug: string; base_url: string; auth_method: ProviderAuthMethod; is_active: boolean; timeout: number; rate: number; }
const EMPTY: Draft = { id: null, name: '', slug: '', base_url: '', auth_method: 'api_key', is_active: false, timeout: 15000, rate: 60 };

export function AdminProvidersPage() {
  const { formatDate } = useI18n();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [syncJobs, setSyncJobs] = useState<ProviderSyncJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function saveProvider() {
    if (!draft) return;
    setSaving(true); setFormError(null);
    const { data, error } = await supabase.rpc('admin_save_provider', {
      p_id: draft.id, p_name: draft.name, p_slug: draft.slug, p_base_url: draft.base_url,
      p_auth_method: draft.auth_method, p_is_active: draft.is_active, p_timeout_ms: draft.timeout, p_rate_limit: draft.rate,
    });
    setSaving(false);
    if (error) { setFormError(error.message); return; }
    await load();
    // keep the form open on the saved record so credentials can be entered next
    setDraft({ ...draft, id: data as string });
  }

  async function load() {
    setLoading(true);
    const [p, j] = await Promise.all([
      supabase.from('providers').select('*').order('created_at'),
      supabase.from('provider_sync_jobs').select('*').order('created_at', { ascending: false }).limit(10),
    ]);
    if (p.error) setError('Failed to load providers.');
    else setProviders(p.data as Provider[]);
    if (j.data) setSyncJobs(j.data as ProviderSyncJob[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  if (loading) return <AdminLayout title="Providers"><div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" /></div></AdminLayout>;

  return (
    <AdminLayout title="Providers">
      {error && <div className="mb-4 flex items-center gap-2 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-950/40 dark:text-error-400"><AlertCircle className="h-4 w-4" />{error}</div>}

      <button className="btn-primary btn-sm mb-4 inline-flex items-center gap-1" onClick={() => { setDraft(EMPTY); setFormError(null); }}>
        <Plus className="h-4 w-4" />Add SMS provider
      </button>

      {draft && (
        <div className="card mb-6 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{draft.id ? 'Edit provider' : 'New SMS provider'}</h3>
            <button className="btn-ghost btn-sm" onClick={() => setDraft(null)} aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label">Display name</label><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
            <div><label className="label">Slug (unique id)</label><input className="input font-mono text-sm" placeholder="my-provider" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase() })} /></div>
            <div className="sm:col-span-2"><label className="label">API base URL (https only)</label><input className="input font-mono text-sm" placeholder="https://api.example.com" value={draft.base_url} onChange={(e) => setDraft({ ...draft, base_url: e.target.value })} /></div>
            <div><label className="label">Authentication method</label>
              <select className="input" value={draft.auth_method} onChange={(e) => setDraft({ ...draft, auth_method: e.target.value as ProviderAuthMethod })}>
                <option value="api_key">API key (header)</option><option value="query_param">API key (query parameter, e.g. api_key=…)</option><option value="bearer">Bearer token</option><option value="basic">Basic (username / password)</option>
              </select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Timeout (ms)</label><input type="number" className="input" value={draft.timeout} onChange={(e) => setDraft({ ...draft, timeout: Number(e.target.value) })} /></div>
              <div><label className="label">Requests / min</label><input type="number" className="input" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: Number(e.target.value) })} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />Active</label>
          </div>
          {formError && <p className="mt-3 text-sm text-error-700">{formError}</p>}
          <button className="btn-primary btn-sm mt-4" disabled={saving || !draft.name || !draft.slug} onClick={saveProvider}>{saving ? 'Saving…' : 'Save provider'}</button>

          <div className="mt-6 border-t border-neutral-200 pt-4 dark:border-neutral-800">
            <h4 className="mb-1 text-sm font-semibold">Credentials</h4>
            {draft.id
              ? <CredentialFields scope="provider" ownerId={draft.id} fields={CREDS[draft.auth_method]} />
              : <p className="text-sm text-neutral-500">Save the provider first, then enter its API key here. Keys are stored encrypted on the server and never shown again.</p>}
          </div>
          {draft.id && <ProviderSyncPanel providerId={draft.id} />}
          <p className="mt-4 text-xs text-neutral-500">Number purchase and SMS retrieval for orders are added with the order system; until then this provider is used for catalog and price import only.</p>
        </div>
      )}

      {/* Provider cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {providers.map((p) => (
          <div key={p.id} className="card p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                  <Server className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-neutral-900 dark:text-neutral-100">{p.name}</div>
                  <div className="text-xs font-mono text-neutral-500">{p.slug}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {p.is_active ? <span className="badge-success">Active</span> : <span className="badge-neutral">Inactive</span>}
                <button className="btn-ghost btn-sm" aria-label="Edit" onClick={() => { setFormError(null); setDraft({ id: p.id, name: p.name, slug: p.slug, base_url: p.base_url || '', auth_method: p.auth_method, is_active: p.is_active, timeout: p.request_timeout_ms, rate: p.rate_limit_per_min }); }}><Pencil className="h-4 w-4" /></button>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-neutral-500">Base URL</dt>
                <dd className="font-mono text-xs text-neutral-700 dark:text-neutral-300">{p.base_url || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">Auth method</dt>
                <dd className="text-neutral-700 dark:text-neutral-300">{p.auth_method}</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">Rate limit</dt>
                <dd className="text-neutral-700 dark:text-neutral-300">{p.rate_limit_per_min}/min</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">Errors</dt>
                <dd className="text-neutral-700 dark:text-neutral-300">{p.error_count}</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">Last sync</dt>
                <dd className="text-xs text-neutral-700 dark:text-neutral-300">{p.last_successful_sync ? formatDate(p.last_successful_sync) : 'Never'}</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">Health check</dt>
                <dd className="text-xs text-neutral-700 dark:text-neutral-300">{p.last_health_check ? formatDate(p.last_health_check) : 'Never'}</dd>
              </div>
            </dl>

            {Boolean(p.capabilities?.demo) && (
              <div className="mt-3 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-950/30 dark:text-warning-400">
                This is a demonstration provider. No real API connection exists. To connect a real SMS provider, configure its API credentials in the database (provider_credentials table) and set is_active to true.
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Sync jobs */}
      <div className="mt-6 card p-5">
        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Recent synchronization jobs</h3>
        {syncJobs.length === 0 ? (
          <div className="mt-4 flex flex-col items-center py-8 text-center">
            <Activity className="h-8 w-8 text-neutral-300 dark:text-neutral-700" />
            <p className="mt-3 text-sm text-neutral-500">No synchronization jobs have been run yet.</p>
            <p className="mt-1 text-xs text-neutral-400">Provider catalog synchronization will be available once a real provider adapter is implemented in Phase 4/5.</p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left text-xs uppercase text-neutral-500">
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Processed</th>
                  <th className="pb-2 font-medium">Created/Updated/Skipped/Failed</th>
                  <th className="pb-2 font-medium">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/50">
                {syncJobs.map((job) => (
                  <tr key={job.id}>
                    <td className="py-2 text-neutral-700 dark:text-neutral-300">{job.job_type.replace('_', ' ')}</td>
                    <td className="py-2">
                      <span className={`badge-${job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : job.status === 'partially_completed' ? 'warning' : 'neutral'}`}>
                        {job.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2 text-neutral-500">{job.records_processed}</td>
                    <td className="py-2 text-xs text-neutral-500">{job.records_created}/{job.records_updated}/{job.records_skipped}/{job.records_failed}</td>
                    <td className="py-2 text-xs text-neutral-500">{job.started_at ? formatDate(job.started_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
