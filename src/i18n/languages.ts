export type LanguageCode = 'en' | 'tr' | 'de' | 'fr' | 'es' | 'it' | 'pt' | 'ru' | 'ar' | 'fa' | 'hi' | 'zh' | 'ja' | 'ko' | 'id' | 'pl' | 'uk' | 'nl' | 'vi' | 'th';

export interface LanguageMeta {
  code: LanguageCode;
  label: string;
  nativeLabel: string;
  rtl: boolean;
}

export const LANGUAGES: LanguageMeta[] = [
  { code: 'en', label: 'English', nativeLabel: 'English', rtl: false },
  { code: 'tr', label: 'Turkish', nativeLabel: 'Türkçe', rtl: false },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch', rtl: false },
  { code: 'fr', label: 'French', nativeLabel: 'Français', rtl: false },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español', rtl: false },
  { code: 'it', label: 'Italian', nativeLabel: 'Italiano', rtl: false },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português', rtl: false },
  { code: 'ru', label: 'Russian', nativeLabel: 'Русский', rtl: false },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', rtl: true },
  { code: 'fa', label: 'Persian', nativeLabel: 'فارسی', rtl: true },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी', rtl: false },
  { code: 'zh', label: 'Chinese', nativeLabel: '中文', rtl: false },
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語', rtl: false },
  { code: 'ko', label: 'Korean', nativeLabel: '한국어', rtl: false },
  { code: 'id', label: 'Indonesian', nativeLabel: 'Indonesia', rtl: false },
  { code: 'pl', label: 'Polish', nativeLabel: 'Polski', rtl: false },
  { code: 'uk', label: 'Ukrainian', nativeLabel: 'Українська', rtl: false },
  { code: 'nl', label: 'Dutch', nativeLabel: 'Nederlands', rtl: false },
  { code: 'vi', label: 'Vietnamese', nativeLabel: 'Tiếng Việt', rtl: false },
  { code: 'th', label: 'Thai', nativeLabel: 'ไทย', rtl: false },
];

export function isRTL(code: string): boolean {
  return code === 'ar' || code === 'fa';
}

export function getLanguageMeta(code: string): LanguageMeta {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
}
