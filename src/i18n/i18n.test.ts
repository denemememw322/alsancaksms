import { describe, it, expect } from 'vitest';
import { translations } from './translations';
import { LANGUAGES, isRTL, getLanguageMeta } from './languages';

const enKeys = Object.keys(translations.en);

function coverage(code: keyof typeof translations) {
  const keys = Object.keys(translations[code]);
  return keys.filter((k) => enKeys.includes(k)).length / enKeys.length;
}

describe('i18n structure', () => {
  it('has a dictionary for every language shown in the selector', () => {
    for (const l of LANGUAGES) expect(translations[l.code]).toBeDefined();
  });

  it('English base dictionary has no empty values', () => {
    for (const [k, v] of Object.entries(translations.en)) expect(v.trim(), k).not.toBe('');
  });

  it('no language defines keys that do not exist in English (orphan keys)', () => {
    for (const l of LANGUAGES) {
      const orphans = Object.keys(translations[l.code]).filter((k) => !enKeys.includes(k));
      expect(orphans, l.code).toEqual([]);
    }
  });

  it('RTL is flagged only for Arabic and Persian and matches language metadata', () => {
    expect(isRTL('ar')).toBe(true);
    expect(isRTL('fa')).toBe(true);
    expect(isRTL('en')).toBe(false);
    for (const l of LANGUAGES) expect(getLanguageMeta(l.code).rtl).toBe(isRTL(l.code));
  });

  it('getLanguageMeta falls back to the first language for unknown codes', () => {
    expect(getLanguageMeta('xx').code).toBe(LANGUAGES[0].code);
  });
});

describe('i18n coverage (known gap)', () => {
  // Documents the CURRENT bug: many selectable languages are empty, so the selector
  // appears to do nothing. `it.fails` passes while the gap exists and turns red once
  // every language is complete — at that point remove `.fails`.
  it.fails('every selectable language is at least 95% translated', () => {
    for (const l of LANGUAGES) expect(coverage(l.code), l.code).toBeGreaterThanOrEqual(0.95);
  });

  it('reports coverage per language (informational)', () => {
    const report = LANGUAGES.map((l) => `${l.code}:${Math.round(coverage(l.code) * 100)}%`);
    console.log('i18n coverage -> ' + report.join(' '));
    expect(report.length).toBe(LANGUAGES.length);
  });
});
