import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminLayout } from '@/components/AdminLayout';
import { useI18n } from '@/i18n/I18nContext';
import { Package, Globe, Layers, Server, DollarSign, TrendingUp, AlertCircle } from 'lucide-react';

interface AdminStats {
  services: number;
  activeServices: number;
  countries: number;
  categories: number;
  providers: number;
  activeProviders: number;
  pricingRules: number;
  priceChanges: number;
  flaggedChanges: number;
}

export function AdminOverviewPage() {
  const { formatDate } = useI18n();
  const [stats, setStats] = useState<AdminStats | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase joined-row shape; TODO generate DB types
  const [recentChanges, setRecentChanges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [svc, ctr, cat, prov, rules, ph] = await Promise.all([
        supabase.from('services').select('id, is_active, is_archived'),
        supabase.from('countries').select('id, is_active'),
        supabase.from('categories').select('id, is_active'),
        supabase.from('providers').select('id, is_active'),
        supabase.from('pricing_rules').select('id, is_active'),
        supabase.from('price_history').select('status, previous_wholesale_cost, new_wholesale_cost, previous_retail_price, new_retail_price, created_at, service_id').order('created_at', { ascending: false }).limit(10),
      ]);

      if (svc.error || ctr.error || cat.error || prov.error || rules.error || ph.error) {
        setError('Failed to load admin statistics.');
        setLoading(false);
        return;
      }

      setStats({
        services: (svc.data || []).length,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase joined-row shape; TODO generate DB types
        activeServices: (svc.data || []).filter((s: any) => s.is_active && !s.is_archived).length,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase joined-row shape; TODO generate DB types
        countries: (ctr.data || []).filter((c: any) => c.is_active).length,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase joined-row shape; TODO generate DB types
        categories: (cat.data || []).filter((c: any) => c.is_active).length,
        providers: (prov.data || []).length,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase joined-row shape; TODO generate DB types
        activeProviders: (prov.data || []).filter((p: any) => p.is_active).length,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase joined-row shape; TODO generate DB types
        pricingRules: (rules.data || []).filter((r: any) => r.is_active).length,
        priceChanges: (ph.data || []).length,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase joined-row shape; TODO generate DB types
        flaggedChanges: (ph.data || []).filter((r: any) => r.status === 'flagged' || r.status === 'error').length,
      });
      setRecentChanges(ph.data || []);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <AdminLayout title="Overview"><div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" /></div></AdminLayout>;
  if (error) return <AdminLayout title="Overview"><div className="card flex items-center gap-3 p-4 text-error-700 dark:text-error-400"><AlertCircle className="h-5 w-5" />{error}</div></AdminLayout>;

  const cards = [
    { label: 'Active services', value: stats!.activeServices, total: stats!.services, icon: Package, color: 'primary' as const },
    { label: 'Active countries', value: stats!.countries, icon: Globe, color: 'accent' as const },
    { label: 'Active categories', value: stats!.categories, icon: Layers, color: 'success' as const },
    { label: 'Providers', value: stats!.activeProviders, total: stats!.providers, icon: Server, color: 'neutral' as const },
    { label: 'Active pricing rules', value: stats!.pricingRules, icon: DollarSign, color: 'warning' as const },
    { label: 'Flagged changes', value: stats!.flaggedChanges, icon: TrendingUp, color: 'error' as const },
  ];

  const colorMap: Record<string, string> = {
    primary: 'bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-400',
    accent: 'bg-accent-50 text-accent-600 dark:bg-accent-950/40 dark:text-accent-400',
    success: 'bg-success-50 text-success-600 dark:bg-success-950/40 dark:text-success-400',
    neutral: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
    warning: 'bg-warning-50 text-warning-600 dark:bg-warning-950/40 dark:text-warning-400',
    error: 'bg-error-50 text-error-600 dark:bg-error-950/40 dark:text-error-400',
  };

  return (
    <AdminLayout title="Overview">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="card p-5">
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${colorMap[card.color]}`}>
                <card.icon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
                  {card.value}{card.total !== undefined && <span className="text-sm font-normal text-neutral-400"> / {card.total}</span>}
                </div>
                <div className="text-sm text-neutral-500 dark:text-neutral-500">{card.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {stats!.activeProviders === 0 && (
        <div className="mt-6 flex items-start gap-3 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 dark:border-warning-900/40 dark:bg-warning-950/30">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning-600 dark:text-warning-400" />
          <div>
            <p className="text-sm font-medium text-warning-700 dark:text-warning-400">No active providers connected</p>
            <p className="mt-0.5 text-xs text-warning-600 dark:text-warning-500">
              The catalog is using demonstration data. Connect a real SMS provider in the Providers section to enable live availability and pricing.
            </p>
          </div>
        </div>
      )}

      <div className="mt-6 card p-5">
        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Recent price changes</h3>
        {recentChanges.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-500">No price changes recorded yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left text-xs uppercase text-neutral-500">
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Cost change</th>
                  <th className="pb-2 pr-4 font-medium">Price change</th>
                  <th className="pb-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/50">
                {recentChanges.map((change) => (
                  <tr key={change.id || Math.random()}>
                    <td className="py-2 pr-4">
                      <span className={`badge-${change.status === 'applied' ? 'success' : change.status === 'flagged' ? 'warning' : change.status === 'error' ? 'error' : 'neutral'}`}>
                        {change.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-neutral-600 dark:text-neutral-400">
                      {change.previous_wholesale_cost ?? '—'} → {change.new_wholesale_cost ?? '—'}
                    </td>
                    <td className="py-2 pr-4 text-neutral-600 dark:text-neutral-400">
                      {change.previous_retail_price ?? '—'} → {change.new_retail_price ?? '—'}
                    </td>
                    <td className="py-2 text-neutral-500">{formatDate(change.created_at)}</td>
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
