import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { translations } from './translations';
import { LANGUAGES, isRTL, type LanguageCode } from './languages';

interface I18nContextValue {
  language: LanguageCode;
  setLanguage: (code: LanguageCode) => void;
  t: (key: string) => string;
  rtl: boolean;
  formatCurrency: (amount: number, currency?: string) => string;
  displayCurrency: 'USD' | 'TRY';
  setDisplayCurrency: (c: 'USD' | 'TRY') => void;
  canUseTry: boolean;
  formatDate: (date: string | Date) => string;
  formatNumber: (num: number) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

const STORAGE_KEY = 'app-language';

function detectInitialLanguage(): LanguageCode {
  // 1. Explicit user selection in localStorage
  const stored = localStorage.getItem(STORAGE_KEY) as LanguageCode | null;
  if (stored && translations[stored]) return stored;

  // 2. Browser language preference
  const browserLang = navigator.language.split('-')[0] as LanguageCode;
  if (translations[browserLang]) return browserLang;

  // 3. Default
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(() => {
    if (typeof window === 'undefined') return 'en';
    return detectInitialLanguage();
  });

  const [displayCurrency, setDisplayCurrencyState] = useState<'USD' | 'TRY'>(() => (typeof window !== 'undefined' && localStorage.getItem('alsancak.currency') === 'TRY' ? 'TRY' : 'USD'));
  const [usdTry, setUsdTry] = useState<number | null>(null);
  const setDisplayCurrency = useCallback((c: 'USD' | 'TRY') => { setDisplayCurrencyState(c); localStorage.setItem('alsancak.currency', c); }, []);
  useEffect(() => {
    supabase.rpc('get_usd_try').then(({ data }) => { const n = Number(data); setUsdTry(Number.isFinite(n) && n > 0 ? n : null); });
  }, []);

  const setLanguage = useCallback((code: LanguageCode) => {
    setLanguageState(code);
    localStorage.setItem(STORAGE_KEY, code);
  }, []);

  // Sync language with authenticated user's profile preference
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user || !mounted) return;
      supabase
        .from('profiles')
        .select('language')
        .eq('id', session.user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.language && mounted && translations[data.language as LanguageCode]) {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) {
              setLanguageState(data.language as LanguageCode);
            }
          }
        });
    });
    return () => { mounted = false; };
  }, []);

  // Apply RTL/LTR direction
  useEffect(() => {
    document.documentElement.dir = isRTL(language) ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  const t = useCallback((key: string): string => {
    const dict = translations[language] || translations.en;
    return dict[key] ?? translations.en[key] ?? key;
  }, [language]);

  // All stored prices/balances are USD. Customers can view them in TRY (admin screens always stay USD).
  const formatCurrency = useCallback((amount: number, currency = 'USD'): string => {
    const inAdmin = typeof window !== 'undefined' && window.location.hash.startsWith('#/admin');
    let value = amount;
    let cur = currency;
    if (cur === 'USD' && displayCurrency === 'TRY' && usdTry && !inAdmin) { value = amount * usdTry; cur = 'TRY'; }
    try {
      return new Intl.NumberFormat(language, {
        style: 'currency',
        currency: cur,
        minimumFractionDigits: 2,
        maximumFractionDigits: Math.abs(value) < 1 ? 3 : 2,
      }).format(value);
    } catch {
      return `${cur} ${value.toFixed(2)}`;
    }
  }, [language, displayCurrency, usdTry]);

  const formatDate = useCallback((date: string | Date): string => {
    try {
      const d = typeof date === 'string' ? new Date(date) : date;
      return new Intl.DateTimeFormat(language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);
    } catch {
      return String(date);
    }
  }, [language]);

  const formatNumber = useCallback((num: number): string => {
    try {
      return new Intl.NumberFormat(language).format(num);
    } catch {
      return String(num);
    }
  }, [language]);

  const value: I18nContextValue = {
    language,
    setLanguage,
    t,
    rtl: isRTL(language),
    formatCurrency,
    displayCurrency,
    setDisplayCurrency,
    canUseTry: usdTry != null,
    formatDate,
    formatNumber,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

export { LANGUAGES };
