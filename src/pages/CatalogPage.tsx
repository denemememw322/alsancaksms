import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nContext';
import { Link } from '@/context/RouterContext';
import type { Country, Category, CatalogServiceItem } from '@/types/database';
import { Search, Info, Package, ChevronRight, AlertCircle } from 'lucide-react';
import * as LucideIcons from 'lucide-react';

export function CatalogPage() {
  const { t, formatCurrency } = useI18n();
  const [countries, setCountries] = useState<Country[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<CatalogServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedCountry, setSelectedCountry] = useState<string>('all');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      const [catRes, countryRes, scaRes] = await Promise.all([
        supabase.from('categories').select('*').eq('is_active', true).order('sort_order'),
        supabase.from('countries').select('*').eq('is_active', true).order('sort_order'),
        supabase
          .from('service_country_availability')
          .select(`
            id,
            service_id,
            country_id,
            retail_price,
            currency,
            is_available,
            is_demo,
            service:services!inner(id, name, slug, description, icon, is_demo, category_id),
            country:countries!inner(id, name, iso_code, flag_emoji),
            category:services!inner(category_id)
          `)
          .eq('is_available', true)
          .order('retail_price', { ascending: true }),
      ]);

      if (catRes.error || countryRes.error || scaRes.error) {
        setError('Failed to load catalog data.');
        console.error({ catRes, countryRes, scaRes });
        setLoading(false);
        return;
      }

      setCategories(catRes.data as Category[]);
      setCountries(countryRes.data as Country[]);

      const mapped: CatalogServiceItem[] = (scaRes.data || []).map((row: any) => ({
        availability_id: row.id,
        service_id: row.service.id,
        service_name: row.service.name,
        service_slug: row.service.slug,
        service_description: row.service.description,
        service_icon: row.service.icon,
        service_is_demo: row.service.is_demo,
        category_id: row.service.category_id,
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

      // Attach category names
      const catMap = new Map((catRes.data as Category[]).map((c) => [c.id, c]));
      mapped.forEach((item) => {
        if (item.category_id) {
          const cat = catMap.get(item.category_id);
          if (cat) {
            item.category_name = cat.name;
            item.category_slug = cat.slug;
          }
        }
      });

      setItems(mapped);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    let result = items;

    if (selectedCategory !== 'all') {
      result = result.filter((i) => i.category_slug === selectedCategory);
    }

    if (selectedCountry !== 'all') {
      result = result.filter((i) => i.country_iso === selectedCountry);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) =>
          i.service_name.toLowerCase().includes(q) ||
          i.country_name.toLowerCase().includes(q) ||
          i.country_iso.toLowerCase().includes(q)
      );
    }

    return result;
  }, [items, selectedCategory, selectedCountry, search]);

  // Group by service for display
  const grouped = useMemo(() => {
    const map = new Map<string, { service: CatalogServiceItem; countries: CatalogServiceItem[] }>();
    filtered.forEach((item) => {
      const key = item.service_id;
      if (!map.has(key)) {
        map.set(key, { service: item, countries: [item] });
      } else {
        map.get(key)!.countries.push(item);
      }
    });
    return Array.from(map.values()).sort((a, b) =>
      Math.min(...a.countries.map((c) => c.retail_price)) -
      Math.min(...b.countries.map((c) => c.retail_price))
    );
  }, [filtered]);

  const hasDemo = items.some((i) => i.is_demo);

  function getIcon(name: string | null): React.ComponentType<{ className?: string }> {
    if (!name) return Package;
    const IconComp = (LucideIcons as any)[name];
    return IconComp || Package;
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="card flex items-center gap-3 p-6 text-error-700 dark:text-error-400">
          <AlertCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{t('catalog.title')}</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          {filtered.length} services available across {countries.length} countries
        </p>
      </div>

      {hasDemo && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 dark:border-warning-900/40 dark:bg-warning-950/30">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning-600 dark:text-warning-400" />
          <p className="text-sm text-warning-700 dark:text-warning-400">{t('catalog.demo_notice')}</p>
        </div>
      )}

      {/* Search + filters */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10"
            placeholder={t('catalog.search_placeholder')}
          />
        </div>
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="input sm:w-48"
        >
          <option value="all">{t('catalog.all_categories')}</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.slug}>{cat.name}</option>
          ))}
        </select>
        <select
          value={selectedCountry}
          onChange={(e) => setSelectedCountry(e.target.value)}
          className="input sm:w-48"
        >
          <option value="all">{t('catalog.all_countries')}</option>
          {countries.map((country) => (
            <option key={country.id} value={country.iso_code}>
              {country.flag_emoji} {country.name}
            </option>
          ))}
        </select>
      </div>

      {/* Results */}
      {grouped.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Search className="h-10 w-10 text-neutral-300 dark:text-neutral-700" />
          <p className="mt-4 text-lg font-medium text-neutral-900 dark:text-neutral-100">{t('catalog.no_results')}</p>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-500">{t('catalog.no_results_desc')}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {grouped.map(({ service, countries: serviceCountries }) => {
            const Icon = getIcon(service.service_icon);
            const minPrice = Math.min(...serviceCountries.map((c) => c.retail_price));
            const currency = serviceCountries[0]?.currency || 'USD';

            return (
              <Link
                key={service.service_id}
                to={`/services/${service.service_slug}`}
                className="card-hover group p-5"
              >
                <div className="flex items-start justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-400">
                    <Icon className="h-5 w-5" />
                  </div>
                  {service.service_is_demo && (
                    <span className="badge-warning">Demo</span>
                  )}
                </div>
                <h3 className="mt-3 text-lg font-semibold text-neutral-900 group-hover:text-primary-600 dark:text-neutral-100 dark:group-hover:text-primary-400">
                  {service.service_name}
                </h3>
                <p className="mt-1 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-400">
                  {service.service_description}
                </p>
                <div className="mt-4 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-neutral-500 dark:text-neutral-500">{t('catalog.price_from')}</span>
                    <div className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
                      {formatCurrency(minPrice, currency)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-sm text-neutral-500 dark:text-neutral-500">
                    <span>{serviceCountries.length}</span>
                    <span className="text-xs">{serviceCountries.length === 1 ? 'country' : 'countries'}</span>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-1 text-sm font-medium text-primary-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-primary-400">
                  {t('catalog.view_details')}
                  <ChevronRight className="h-4 w-4" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
