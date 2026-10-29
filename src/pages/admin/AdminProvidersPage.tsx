import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminLayout } from '@/components/AdminLayout';
import { useI18n } from '@/i18n/I18nContext';
import type { Provider, ProviderSyncJob } from '@/types/database';
import { AlertCircle, Server, Activity } from 'lucide-react';

export function AdminProvidersPage() {
  const { formatDate } = useI18n();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [syncJobs, setSyncJobs] = useState<ProviderSyncJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
              {p.is_active
                ? <span className="badge-success">Connected</span>
                : <span className="badge-neutral">Not connected</span>}
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
