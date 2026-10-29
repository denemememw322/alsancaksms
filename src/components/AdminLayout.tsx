import { useAuth } from '@/context/AuthContext';
import { Link, useRouter } from '@/context/RouterContext';
import { useI18n } from '@/i18n/I18nContext';
import { Shield, LayoutGrid, Package, Globe, Layers, DollarSign, History, Server, ArrowLeft, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';

export function isAdmin(roles: string[]): boolean {
  return roles.includes('super_admin') || roles.includes('admin') || roles.includes('catalog_manager');
}

export function AdminLayout({ children, title }: { children: ReactNode; title: string }) {
  const { roles, profile } = useAuth();
  const { route, navigate } = useRouter();
  const { t } = useI18n();

  if (!isAdmin(roles)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:px-8">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-error-100 text-error-600 dark:bg-error-950/40 dark:text-error-400">
          <Shield className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Access denied</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          You don't have permission to access the admin area.
        </p>
        <Link to="/dashboard" className="btn-primary mt-6 inline-flex">Back to dashboard</Link>
      </div>
    );
  }

  const navItems = [
    { label: 'Overview', path: '/admin', icon: LayoutGrid },
    { label: t('admin.categories'), path: '/admin/categories', icon: Layers },
    { label: t('admin.countries'), path: '/admin/countries', icon: Globe },
    { label: t('admin.services'), path: '/admin/services', icon: Package },
    { label: t('admin.providers'), path: '/admin/providers', icon: Server },
    { label: t('admin.pricing_rules'), path: '/admin/pricing-rules', icon: DollarSign },
    { label: t('admin.price_history'), path: '/admin/price-history', icon: History },
    { label: 'Wallet & Deposits', path: '/admin/wallet', icon: Wallet },
  ];

  const isActive = (path: string) => route.path === path;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm">
        <Link to="/dashboard" className="flex items-center gap-1 text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
          <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
        </Link>
      </div>

      <div className="mb-6 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900">
          <Shield className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{t('admin.title')}</h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-500">Signed in as {profile?.email}</p>
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Sidebar nav */}
        <nav className="flex gap-1 overflow-x-auto lg:w-56 lg:flex-shrink-0 lg:flex-col lg:overflow-visible">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                isActive(item.path)
                  ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1">
          <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
          {children}
        </div>
      </div>
    </div>
  );
}
