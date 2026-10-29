import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nContext';
import { Link, useRouter } from '@/context/RouterContext';
import type { CatalogServiceItem, Category } from '@/types/database';
import { ArrowLeft, Package, Info, CheckCircle, AlertCircle, Users } from 'lucide-react';
import * as LucideIcons from 'lucide-react';

export function ServiceDetailPage() {
  const { t, formatCurrency } = useI18n();
  const { route, navigate } = useRouter();
  const slug = route.path.replace('/services/', '');

  const [items, setItems] = useState<CatalogServiceItem[]>([]);
  const [category, setCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      const { data: svc, error: svcErr } = await supabase
        .from('services')
        .select('id, name, slug, description, icon, is_demo, category_id')
        .eq('slug', slug)
        .eq('is_active', true)
        .eq('is_archived', false)
        .maybeSingle();

      if (svcErr || !svc) {
        setError('Service not found.');
        setLoading(false);
        return;
      }

      const { data: sca, error: scaErr } = await supabase
        .from('service_country_availability')
        .select(`
          id,
          retail_price,
          currency,
          is_available,
          is_demo,
          country:countries!inner(id, name, iso_code, flag_emoji)
        `)
        .eq('service_id', svc.id)
        .eq('is_available', true)
        .order('retail_price', { ascending: true });

      if (scaErr) {
        setError('Failed to load service details.');
        setLoading(false);
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase joined-row shape; TODO generate DB types
      const mapped: CatalogServiceItem[] = (sca || []).map((row: any) => ({
        availability_id: row.id,
        service_id: svc.id,
        service_name: svc.name,
        service_slug: svc.slug,
        service_description: svc.description,
        service_icon: svc.icon,
        service_is_demo: svc.is_demo,
        category_id: svc.category_id,
        category_name: null,
        category_slug: null,
        country_id: row.country.id,
        country_name: row.country.name,
        country_iso: row.country.iso_code,
        country_flag: row.country.flag_emoji,
        retail_price: row.retail_price,
        currency: row.currency,
        is_available: row.is_available,
        is_demo: row.is_demo,
      }));
      setItems(mapped);

      if (svc.category_id) {
        const { data: cat } = await supabase
          .from('categories')
          .select('*')
          .eq('id', svc.category_id)
          .maybeSingle();
        if (cat) setCategory(cat as Category);
      }

      setLoading(false);
    }
    load();
  }, [slug]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
        </div>
      </div>
    );
  }

  if (error || items.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Link to="/services" className="btn-ghost btn-sm mb-4 inline-flex">
          <ArrowLeft className="h-4 w-4" /> {t('common.back')}
        </Link>
        <div className="card flex items-center gap-3 p-6 text-neutral-700 dark:text-neutral-300">
          <AlertCircle className="h-5 w-5" />
          <span>{error || 'No availability for this service.'}</span>
        </div>
      </div>
    );
  }

  const service = items[0];
  const IconComp = service.service_icon
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase joined-row shape; TODO generate DB types
    ? ((LucideIcons as any)[service.service_icon] as React.ComponentType<{ className?: string }>) || Package
    : Package;
  const minPrice = Math.min(...items.map((i) => i.retail_price));
  const hasDemo = items.some((i) => i.is_demo);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <Link to="/services" className="btn-ghost btn-sm mb-6 inline-flex">
        <ArrowLeft className="h-4 w-4" /> {t('common.back')}
      </Link>

      {/* Service header */}
      <div className="card mb-6 p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-400">
            <IconComp className="h-7 w-7" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{service.service_name}</h1>
              {service.service_is_demo && <span className="badge-warning">Demo</span>}
            </div>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{service.service_description}</p>
            {category && (
              <Link
                to={`/services?category=${category.slug}`}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline dark:text-primary-400"
              >
                <Package className="h-3 w-3" /> {category.name}
              </Link>
            )}
          </div>
        </div>
      </div>

      {hasDemo && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 dark:border-warning-900/40 dark:bg-warning-950/30">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning-600 dark:text-warning-400" />
          <p className="text-sm text-warning-700 dark:text-warning-400">{t('catalog.demo_notice')}</p>
        </div>
      )}

      {/* Country availability */}
      <div className="card overflow-hidden">
        <div className="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {t('catalog.select_country')}
          </h2>
          <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-500">
            {items.length} countries available · {t('catalog.price_from')} {formatCurrency(minPrice, items[0].currency)}
          </p>
        </div>
        <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {items.map((item) => (
            <div
              key={item.availability_id}
              className="flex items-center justify-between px-6 py-3.5 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{item.country_flag}</span>
                <div>
                  <div className="font-medium text-neutral-900 dark:text-neutral-100">{item.country_name}</div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-500">{item.country_iso}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="font-bold text-neutral-900 dark:text-neutral-100">
                    {formatCurrency(item.retail_price, item.currency)}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-success-600 dark:text-success-400">
                    <CheckCircle className="h-3 w-3" /> {t('catalog.available')}
                  </div>
                </div>
                <button
                  onClick={() => navigate('/login')}
                  className="btn-primary btn-sm"
                >
                  Get number
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-500">
        <Users className="h-4 w-4" />
        <span>Sign in to purchase a virtual number and receive SMS.</span>
      </div>
    </div>
  );
}
