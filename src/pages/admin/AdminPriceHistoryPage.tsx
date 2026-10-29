import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminLayout } from '@/components/AdminLayout';
import { useI18n } from '@/i18n/I18nContext';
import type { PriceHistory, PriceUpdateStatus, Service, Country, Provider } from '@/types/database';
import { AlertCircle, Filter } from 'lucide-react';

export function AdminPriceHistoryPage() {
  const { formatCurrency, formatDate } = useI18n();
  const [history, setHistory] = useState<PriceHistory[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  async function load() {
    setLoading(true);
    const [ph, s, c, p] = await Promise.all([
      supabase.from('price_history').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('services').select('id, name').order('name'),
      supabase.from('countries').select('id, name, flag_emoji').order('name'),
      supabase.from('providers').select('id, name').order('name'),
    ]);
    if (ph.error) setError('Failed to load price history.');
    else setHistory(ph.data as PriceHistory[]);
    if (s.data) setServices(s.data as Service[]);
    if (c.data) setCountries(c.data as Country[]);
    if (p.data) setProviders(p.data as Provider[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = statusFilter === 'all' ? history : history.filter((h) => h.status === statusFilter);

  const svcMap = new Map(services.map((s) => [s.id, s.name]));
  const ctrMap = new Map(countries.map((c) => [c.id, c]));
  const provMap = new Map(providers.map((p) => [p.id, p.name]));

  const statusColors: Record<PriceUpdateStatus, string> = {
    applied: 'badge-success',
    skipped: 'badge-neutral',
    flagged: 'badge-warning',
    error: 'badge-error',
  };

  if (loading) return <AdminLayout title="Price History"><div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" /></div></AdminLayout>;

  return (
    <AdminLayout title="Price History">
      {error && <div className="mb-4 flex items-center gap-2 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-950/40 dark:text-error-400"><AlertCircle className="h-4 w-4" />{error}</div>}

      <div className="mb-4 flex items-center gap-2">
        <Filter className="h-4 w-4 text-neutral-400" />
        <select className="input w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="applied">Applied</option>
          <option value="skipped">Skipped</option>
          <option value="flagged">Flagged</option>
          <option value="error">Error</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8 text-center text-sm text-neutral-500">No price changes recorded yet.</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left text-xs uppercase text-neutral-500">
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Service</th>
                  <th className="px-4 py-3 font-medium">Country</th>
                  <th className="px-4 py-3 font-medium">Cost</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Margin</th>
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/50">
                {filtered.map((h) => (
                  <tr key={h.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/30">
                    <td className="px-4 py-3"><span className={statusColors[h.status]}>{h.status}</span></td>
                    <td className="px-4 py-3 text-neutral-900 dark:text-neutral-100">{svcMap.get(h.service_id) || h.service_id}</td>
                    <td className="px-4 py-3 text-neutral-500">{(() => { const c = ctrMap.get(h.country_id); return c ? `${c.flag_emoji} ${c.name}` : h.country_id; })()}</td>
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                      {h.previous_wholesale_cost !== null ? formatCurrency(h.previous_wholesale_cost, h.currency) : '—'}
                      {' → '}
                      {h.new_wholesale_cost !== null ? formatCurrency(h.new_wholesale_cost, h.currency) : '—'}
                    </td>
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                      {h.previous_retail_price !== null ? formatCurrency(h.previous_retail_price, h.currency) : '—'}
                      {' → '}
                      {h.new_retail_price !== null ? formatCurrency(h.new_retail_price, h.currency) : '—'}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">
                      {h.new_margin_pct !== null ? `${h.new_margin_pct}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-neutral-500 capitalize">{(h.applied_pricing_method || '—').replace('_', ' ')}</td>
                    <td className="px-4 py-3 text-neutral-500 text-xs">{h.update_source}</td>
                    <td className="px-4 py-3 text-neutral-500 text-xs whitespace-nowrap">{formatDate(h.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filtered.some((h) => h.error_details) && (
        <div className="mt-4 card p-4">
          <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Flagged/error details</h4>
          <ul className="mt-2 space-y-1 text-xs text-neutral-600 dark:text-neutral-400">
            {filtered.filter((h) => h.error_details).map((h) => (
              <li key={h.id} className="flex gap-2">
                <span className="font-medium text-neutral-900 dark:text-neutral-100">{svcMap.get(h.service_id)}:</span>
                <span>{h.error_details}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </AdminLayout>
  );
}
