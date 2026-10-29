import { useEffect, useState, useCallback } from 'react';
import type { ThemePreference } from '@/types/database';

type Theme = 'light' | 'dark';

function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(pref: ThemePreference): Theme {
  if (pref === 'system') return getSystemTheme();
  return pref;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    if (typeof window === 'undefined') return 'system';
    return (localStorage.getItem('theme-pref') as ThemePreference) || 'system';
  });

  const [resolved, setResolved] = useState<Theme>(() => resolveTheme(preference));

  useEffect(() => {
    const theme = resolveTheme(preference);
    setResolved(theme);
    applyTheme(theme);
    localStorage.setItem('theme-pref', preference);
  }, [preference]);

  useEffect(() => {
    if (preference !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const theme = getSystemTheme();
      setResolved(theme);
      applyTheme(theme);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [preference]);

  const toggle = useCallback(() => {
    setPreference((prev) => {
      const current = resolveTheme(prev);
      return current === 'dark' ? 'light' : 'dark';
    });
  }, []);

  const set = useCallback((pref: ThemePreference) => {
    setPreference(pref);
  }, []);

  return { preference, resolved, toggle, set };
}
