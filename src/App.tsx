import { AuthProvider, useAuth } from '@/context/AuthContext';
import { RouterProvider, useRouter, Link } from '@/context/RouterContext';
import { I18nProvider } from '@/i18n/I18nContext';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { LandingPage } from '@/pages/LandingPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { CatalogPage } from '@/pages/CatalogPage';
import { ServiceDetailPage } from '@/pages/ServiceDetailPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { SignUpPage } from '@/pages/auth/SignUpPage';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { AdminOverviewPage } from '@/pages/admin/AdminOverviewPage';
import { AdminCategoriesPage } from '@/pages/admin/AdminCategoriesPage';
import { AdminCountriesPage } from '@/pages/admin/AdminCountriesPage';
import { AdminServicesPage } from '@/pages/admin/AdminServicesPage';
import { AdminProvidersPage } from '@/pages/admin/AdminProvidersPage';
import { AdminPricingRulesPage } from '@/pages/admin/AdminPricingRulesPage';
import { AdminPriceHistoryPage } from '@/pages/admin/AdminPriceHistoryPage';
import { AdminWalletPage } from '@/pages/admin/AdminWalletPage';
import { WalletPage } from '@/pages/WalletPage';
import { isAdmin } from '@/components/AdminLayout';
import { MessageSquare } from 'lucide-react';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { navigate } = useRouter();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    navigate('/login');
    return null;
  }

  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <PublicLayout>{children}</PublicLayout>
    </ProtectedRoute>
  );
}

function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 dark:bg-neutral-950">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}

function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <PublicLayout>
      <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:px-8">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-400">
          <MessageSquare className="h-7 w-7" />
        </div>
        <h1 className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">{title}</h1>
        <p className="mx-auto mt-4 max-w-lg text-neutral-600 dark:text-neutral-400">{description}</p>
        <Link to="/" className="btn-secondary mt-8 inline-flex">Back to home</Link>
      </div>
    </PublicLayout>
  );
}

function AppRoutes() {
  const { route, navigate } = useRouter();
  const { roles } = useAuth();
  const path = route.path;

  // Auth pages (no layout)
  if (path === '/login') return <LoginPage />;
  if (path === '/signup') return <SignUpPage />;
  if (path === '/forgot-password') return <ForgotPasswordPage />;

  // Public pages
  if (path === '/') return <PublicLayout><LandingPage /></PublicLayout>;
  if (path === '/services') return <PublicLayout><CatalogPage /></PublicLayout>;
  if (path.startsWith('/services/')) return <PublicLayout><ServiceDetailPage /></PublicLayout>;

  // Protected pages
  if (path === '/dashboard')
    return <ProtectedRoute><PublicLayout><DashboardPage /></PublicLayout></ProtectedRoute>;
  if (path === '/wallet')
    return <ProtectedRoute><PublicLayout><WalletPage /></PublicLayout></ProtectedRoute>;

  // Admin pages
  if (path.startsWith('/admin')) {
    if (!isAdmin(roles)) {
      return <ProtectedRoute><PublicLayout><div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Access denied</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">You need admin privileges to access this area.</p>
        <Link to="/dashboard" className="btn-primary mt-6 inline-flex">Back to dashboard</Link>
      </div></PublicLayout></ProtectedRoute>;
    }
    if (path === '/admin') return <AdminRoute><AdminOverviewPage /></AdminRoute>;
    if (path === '/admin/categories') return <AdminRoute><AdminCategoriesPage /></AdminRoute>;
    if (path === '/admin/countries') return <AdminRoute><AdminCountriesPage /></AdminRoute>;
    if (path === '/admin/services') return <AdminRoute><AdminServicesPage /></AdminRoute>;
    if (path === '/admin/providers') return <AdminRoute><AdminProvidersPage /></AdminRoute>;
    if (path === '/admin/pricing-rules') return <AdminRoute><AdminPricingRulesPage /></AdminRoute>;
    if (path === '/admin/price-history') return <AdminRoute><AdminPriceHistoryPage /></AdminRoute>;
    if (path === '/admin/wallet') return <AdminRoute><AdminWalletPage /></AdminRoute>;
  }

  const placeholders: Record<string, { title: string; description: string }> = {
    '/countries': { title: 'Countries', description: 'Browse the full country catalog from the Services page, where you can filter by country.' },
    '/pricing': { title: 'Pricing', description: 'Pricing is visible on each service in the catalog. Configure pricing rules in the admin area.' },
    '/api-docs': { title: 'Developer API', description: 'API documentation and keys will be available in Phase 8.' },
    '/faq': { title: 'Frequently asked questions', description: 'The FAQ will be populated with real content soon.' },
    '/terms': { title: 'Terms of Service', description: 'Legal pages will be finalized before production launch.' },
    '/privacy': { title: 'Privacy Policy', description: 'Legal pages will be finalized before production launch.' },
    '/refunds': { title: 'Refund Policy', description: 'Legal pages will be finalized before production launch.' },
  };

  const placeholder = placeholders[path];
  if (placeholder) return <PlaceholderPage {...placeholder} />;

  return (
    <PublicLayout>
      <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">Page not found</h1>
        <p className="mt-4 text-neutral-600 dark:text-neutral-400">The page you're looking for doesn't exist.</p>
        <Link to="/" className="btn-primary mt-8 inline-flex">Back to home</Link>
      </div>
    </PublicLayout>
  );
}

function App() {
  return (
    <AuthProvider>
      <I18nProvider>
        <RouterProvider>
          <AppRoutes />
        </RouterProvider>
      </I18nProvider>
    </AuthProvider>
  );
}

export default App;
