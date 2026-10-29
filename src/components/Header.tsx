import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Link, useRouter } from '@/context/RouterContext';
import { useTheme } from '@/hooks/useTheme';
import { useI18n, LANGUAGES } from '@/i18n/I18nContext';
import { isAdmin } from '@/components/AdminLayout';
import { MessageSquare, Menu, X, Sun, Moon, LogOut, LayoutDashboard, Globe, Shield } from 'lucide-react';

export function Header() {
  const { user, roles, signOut } = useAuth();
  const { resolved, toggle } = useTheme();
  const { language, setLanguage } = useI18n();
  const { navigate, route } = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const adminAccess = isAdmin(roles);

  const navLinks = [
    { label: 'Services', path: '/services' },
    { label: 'Countries', path: '/countries' },
    { label: 'Pricing', path: '/pricing' },
    { label: 'API', path: '/api-docs' },
    { label: 'FAQ', path: '/faq' },
  ];

  const isActive = (path: string) => route.path === path;

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200/80 bg-white/80 backdrop-blur-xl dark:border-neutral-800/80 dark:bg-neutral-950/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white shadow-sm">
              <MessageSquare className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold tracking-tight text-neutral-900 dark:text-neutral-100">AlsancakSMS</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive(link.path)
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300'
                    : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative hidden sm:block">
            <button
              onClick={() => setLangOpen(!langOpen)}
              className="btn-ghost btn-sm"
              aria-label="Select language"
            >
              <Globe className="h-4 w-4" />
              <span className="text-xs uppercase">{language}</span>
            </button>
            {langOpen && (
              <div className="absolute right-0 mt-2 w-56 max-h-72 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => { setLanguage(lang.code); setLangOpen(false); }}
                    className={`flex w-full items-center justify-between px-3 py-2 text-sm transition-colors ${language === lang.code ? 'font-semibold text-primary-600 dark:text-primary-400' : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'}`}
                  >
                    <span>{lang.nativeLabel}</span>
                    <span className="text-xs text-neutral-400">{lang.code.toUpperCase()}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={toggle} className="btn-ghost btn-sm" aria-label="Toggle theme">
            {resolved === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          {user ? (
            <div className="hidden items-center gap-2 sm:flex">
              {adminAccess && (
                <button onClick={() => navigate('/admin')} className="btn-ghost btn-sm" aria-label="Admin">
                  <Shield className="h-4 w-4" />
                  Admin
                </button>
              )}
              <button onClick={() => navigate('/dashboard')} className="btn-secondary btn-sm">
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </button>
              <button onClick={() => signOut()} className="btn-ghost btn-sm" aria-label="Sign out">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Link to="/login" className="btn-ghost btn-sm">Sign in</Link>
              <Link to="/signup" className="btn-primary btn-sm">Get started</Link>
            </div>
          )}

          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="btn-ghost btn-sm md:hidden"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-neutral-200 bg-white px-4 py-3 md:hidden dark:border-neutral-800 dark:bg-neutral-950">
          <nav className="flex flex-col gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                onClick={() => setMobileOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-2 border-t border-neutral-200 pt-2 dark:border-neutral-800">
              {user ? (
                <>
                  <Link to="/dashboard" onClick={() => setMobileOpen(false)} className="block rounded-lg px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800">
                    Dashboard
                  </Link>
                  {adminAccess && (
                    <Link to="/admin" onClick={() => setMobileOpen(false)} className="block rounded-lg px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800">
                      Admin
                    </Link>
                  )}
                  <button onClick={() => { signOut(); setMobileOpen(false); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800">
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <Link to="/login" onClick={() => setMobileOpen(false)} className="block rounded-lg px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800">
                    Sign in
                  </Link>
                  <Link to="/signup" onClick={() => setMobileOpen(false)} className="block rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white">
                    Get started
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
