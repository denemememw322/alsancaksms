import type { LanguageCode } from './languages';

// Type for the translation dictionary structure
type TranslationDict = Record<string, string>;

// English is the base/complete dictionary. All other languages fall back to English
// for missing keys. This is a sample — additional keys are added as needed.
const en: TranslationDict = {
  // Common
  'common.loading': 'Loading...',
  'common.error': 'An error occurred',
  'common.search': 'Search',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.create': 'Create',
  'common.back': 'Back',
  'common.confirm': 'Confirm',
  'common.close': 'Close',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.all': 'All',
  'common.none': 'None',
  'common.active': 'Active',
  'common.inactive': 'Inactive',
  'common.archived': 'Archived',

  // Navigation
  'nav.services': 'Services',
  'nav.countries': 'Countries',
  'nav.pricing': 'Pricing',
  'nav.api': 'API',
  'nav.faq': 'FAQ',
  'nav.dashboard': 'Dashboard',
  'nav.signin': 'Sign in',
  'nav.signup': 'Get started',
  'nav.signout': 'Sign out',
  'nav.admin': 'Admin',

  // Landing
  'landing.hero.title': 'SMS verification with virtual numbers worldwide',
  'landing.hero.subtitle': 'Receive SMS online with disposable virtual numbers. Verify accounts on 500+ platforms securely, privately, and instantly — without exposing your real phone number.',
  'landing.hero.cta': 'Get started free',
  'landing.hero.browse': 'Browse services',
  'landing.features.title': 'Everything you need to verify',
  'landing.howitworks.title': 'How it works',
  'landing.howitworks.step1': 'Choose a service & country',
  'landing.howitworks.step2': 'Get your virtual number',
  'landing.howitworks.step3': 'Receive your SMS',
  'landing.cta.title': 'Ready to start verifying?',

  // Auth
  'auth.login.title': 'Welcome back',
  'auth.login.subtitle': 'Sign in to your account to continue.',
  'auth.signup.title': 'Create your account',
  'auth.signup.subtitle': 'Start verifying with virtual numbers in minutes.',
  'auth.forgot.title': 'Reset your password',
  'auth.forgot.subtitle': 'Enter your email and we\'ll send you a secure reset link.',

  // Catalog
  'catalog.title': 'Service catalog',
  'catalog.search_placeholder': 'Search by service or country...',
  'catalog.all_categories': 'All categories',
  'catalog.all_countries': 'All countries',
  'catalog.no_results': 'No services found',
  'catalog.no_results_desc': 'Try adjusting your search or filters.',
  'catalog.demo_notice': 'Showing demonstration data. Live provider availability is not yet connected.',
  'catalog.price_from': 'from',
  'catalog.available': 'Available',
  'catalog.unavailable': 'Unavailable',
  'catalog.availability_unknown': 'Check availability',
  'catalog.view_details': 'View details',
  'catalog.select_country': 'Select country',

  // Dashboard
  'dashboard.welcome': 'Welcome back',
  'dashboard.balance': 'Available balance',
  'dashboard.deposits': 'Total deposits',
  'dashboard.spending': 'Total spending',
  'dashboard.active_orders': 'Active orders',
  'dashboard.completed': 'Completed',
  'dashboard.cancelled': 'Cancelled',
  'dashboard.refunded': 'Refunded',
  'dashboard.recent_orders': 'Recent orders',
  'dashboard.recent_transactions': 'Recent transactions',
  'dashboard.no_orders': 'No orders yet',
  'dashboard.no_transactions': 'No transactions yet',

  // Admin
  'admin.title': 'Administration',
  'admin.catalog': 'Catalog Management',
  'admin.categories': 'Categories',
  'admin.countries': 'Countries',
  'admin.services': 'Services',
  'admin.providers': 'Providers',
  'admin.pricing_rules': 'Pricing Rules',
  'admin.price_history': 'Price History',
  'admin.sync_logs': 'Sync Logs',
  'admin.overview': 'Overview',
};

// Turkish translations (partial — falls back to English for missing keys)
const tr: TranslationDict = {
  'common.loading': 'Yükleniyor...',
  'common.search': 'Ara',
  'common.save': 'Kaydet',
  'common.cancel': 'İptal',
  'common.delete': 'Sil',
  'common.edit': 'Düzenle',
  'common.create': 'Oluştur',
  'common.back': 'Geri',
  'common.active': 'Aktif',
  'common.inactive': 'Pasif',
  'nav.services': 'Hizmetler',
  'nav.countries': 'Ülkeler',
  'nav.pricing': 'Fiyatlandırma',
  'nav.signin': 'Giriş yap',
  'nav.signup': 'Başla',
  'nav.signout': 'Çıkış yap',
  'nav.dashboard': 'Panel',
  'landing.hero.title': 'Dünya çapında sanal numaralarla SMS doğrulama',
  'landing.hero.cta': 'Ücretsiz başla',
  'landing.hero.browse': 'Hizmetlere göz at',
  'auth.login.title': 'Tekrar hoş geldiniz',
  'auth.login.subtitle': 'Devam etmek için hesabınıza giriş yapın.',
  'auth.signup.title': 'Hesabınızı oluşturun',
  'auth.signup.subtitle': 'Dakikalar içinde sanal numaralarla doğrulamaya başlayın.',
  'catalog.title': 'Hizmet kataloğu',
  'catalog.search_placeholder': 'Hizmet veya ülke ara...',
  'catalog.all_categories': 'Tüm kategoriler',
  'catalog.all_countries': 'Tüm ülkeler',
  'catalog.no_results': 'Hizmet bulunamadı',
  'catalog.demo_notice': 'Demonstrasyon verileri gösteriliyor. Canlı sağlayıcı kullanılabilirliği henüz bağlı değil.',
  'catalog.available': 'Mevcut',
  'catalog.unavailable': 'Mevcut değil',
  'dashboard.welcome': 'Tekrar hoş geldiniz',
  'dashboard.balance': 'Kullanılabilir bakiye',
  'admin.title': 'Yönetim',
  'admin.catalog': 'Katalog Yönetimi',
  'admin.categories': 'Kategoriler',
  'admin.countries': 'Ülkeler',
  'admin.services': 'Hizmetler',
};

// German (partial)
const de: TranslationDict = {
  'common.loading': 'Wird geladen...',
  'common.search': 'Suchen',
  'nav.services': 'Dienste',
  'nav.signin': 'Anmelden',
  'nav.signup': 'Loslegen',
  'landing.hero.title': 'SMS-Verifizierung mit virtuellen Nummern weltweit',
  'auth.login.title': 'Willkommen zurück',
  'auth.signup.title': 'Konto erstellen',
  'catalog.title': 'Dienstkatalog',
  'catalog.search_placeholder': 'Nach Dienst oder Land suchen...',
  'dashboard.welcome': 'Willkommen zurück',
  'admin.title': 'Verwaltung',
};

// French (partial)
const fr: TranslationDict = {
  'common.loading': 'Chargement...',
  'common.search': 'Rechercher',
  'nav.services': 'Services',
  'nav.signin': 'Se connecter',
  'nav.signup': 'Commencer',
  'landing.hero.title': 'Vérification SMS avec des numéros virtuels dans le monde entier',
  'auth.login.title': 'Bon retour',
  'auth.signup.title': 'Créer votre compte',
  'catalog.title': 'Catalogue de services',
  'dashboard.welcome': 'Bon retour',
};

// Spanish (partial)
const es: TranslationDict = {
  'common.loading': 'Cargando...',
  'common.search': 'Buscar',
  'nav.services': 'Servicios',
  'nav.signin': 'Iniciar sesión',
  'nav.signup': 'Empezar',
  'landing.hero.title': 'Verificación SMS con números virtuales en todo el mundo',
  'auth.login.title': 'Bienvenido de nuevo',
  'auth.signup.title': 'Crear su cuenta',
  'catalog.title': 'Catálogo de servicios',
  'dashboard.welcome': 'Bienvenido de nuevo',
};

// Russian (partial)
const ru: TranslationDict = {
  'common.loading': 'Загрузка...',
  'common.search': 'Поиск',
  'nav.services': 'Услуги',
  'nav.signin': 'Войти',
  'nav.signup': 'Начать',
  'landing.hero.title': 'SMS-верификация с виртуальными номерами по всему миру',
  'auth.login.title': 'С возвращением',
  'auth.signup.title': 'Создать аккаунт',
  'catalog.title': 'Каталог услуг',
  'dashboard.welcome': 'С возвращением',
};

// Arabic (partial — RTL)
const ar: TranslationDict = {
  'common.loading': 'جار التحميل...',
  'common.search': 'بحث',
  'nav.services': 'الخدمات',
  'nav.signin': 'تسجيل الدخول',
  'nav.signup': 'ابدأ',
  'landing.hero.title': 'التحقق عبر الرسائل القصيرة بأرقام افتراضية حول العالم',
  'auth.login.title': 'مرحبا بعودتك',
  'auth.signup.title': 'إنشاء حسابك',
  'catalog.title': 'كتالوج الخدمات',
  'dashboard.welcome': 'مرحبا بعودتك',
};

export const translations: Record<LanguageCode, TranslationDict> = {
  en, tr, de, fr, es,
  it: {}, pt: {}, ru, ar: ar,
  fa: {}, hi: {}, zh: {}, ja: {}, ko: {}, id: {},
  pl: {}, uk: {}, nl: {}, vi: {}, th: {},
};
