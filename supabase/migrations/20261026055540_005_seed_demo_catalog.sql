/*
# Seed Demonstration Catalog Data — Phase 2

## Purpose
Inserts clearly-marked demonstration data for UI development and testing.
All demo records are flagged with is_demo = true so they are never presented
as verified live provider inventory.

## What is seeded
- 10 countries (US, TR, GB, DE, FR, RU, IN, BR, ID, AE)
- 6 categories (Social Media, Messaging, Email, E-commerce, Gaming, Entertainment)
- 12 services across categories (WhatsApp, Telegram, Google, Instagram, etc.)
- 1 demo provider (not connected — is_active = false)
- Provider mappings (country + service)
- Service-country availability with demo prices
- 1 global pricing rule (50% markup)
- 1 category-specific pricing rule (Messaging: 40% target margin)

## What is NOT seeded
- No fake successful orders
- No fake payments
- No fake SMS messages
- No fake provider balances
- No active provider connections (is_active = false)

## Important Notes
1. The demo provider is marked is_active = false — it is not a real connection.
2. All availability rows have is_demo = true and is_available = true (so the
   customer catalog shows data for UI testing).
3. A notice on the customer catalog will explain this is demonstration data.
4. Admins can distinguish demo from real data via the is_demo flag.
5. The global pricing rule uses percentage_markup at 50% — this is the default
   that applies when no more specific rule matches.
*/

-- ===== Demo Provider =====
INSERT INTO public.providers (id, name, slug, base_url, auth_method, is_active, capabilities)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Demo Provider (Not Connected)',
  'demo-provider',
  NULL,
  'api_key',
  false,
  '{"demo": true, "note": "This is a demonstration provider. No real API connection."}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- ===== Countries =====
INSERT INTO public.countries (iso_code, name, flag_emoji, calling_code, is_active, sort_order) VALUES
  ('US', 'United States', '🇺🇸', '+1', true, 1),
  ('TR', 'Turkey', '🇹🇷', '+90', true, 2),
  ('GB', 'United Kingdom', '🇬🇧', '+44', true, 3),
  ('DE', 'Germany', '🇩🇪', '+49', true, 4),
  ('FR', 'France', '🇫🇷', '+33', true, 5),
  ('RU', 'Russia', '🇷🇺', '+7', true, 6),
  ('IN', 'India', '🇮🇳', '+91', true, 7),
  ('BR', 'Brazil', '🇧🇷', '+55', true, 8),
  ('ID', 'Indonesia', '🇮🇩', '+62', true, 9),
  ('AE', 'United Arab Emirates', '🇦🇪', '+971', true, 10)
ON CONFLICT (iso_code) DO NOTHING;

-- ===== Categories =====
INSERT INTO public.categories (name, slug, description, icon, is_active, sort_order) VALUES
  ('Social Media', 'social-media', 'Social networking platforms', 'Share2', true, 1),
  ('Messaging', 'messaging', 'Chat and messaging applications', 'MessageSquare', true, 2),
  ('Email & Communication', 'email', 'Email and communication services', 'Mail', true, 3),
  ('E-commerce', 'ecommerce', 'Online shopping and marketplace platforms', 'ShoppingCart', true, 4),
  ('Gaming', 'gaming', 'Gaming platforms and services', 'Gamepad2', true, 5),
  ('Entertainment & Streaming', 'entertainment', 'Streaming and entertainment services', 'Play', true, 6)
ON CONFLICT (slug) DO NOTHING;

-- ===== Services =====
-- Helper: get category IDs
DO $$
DECLARE
  v_social uuid; v_messaging uuid; v_email uuid; v_ecom uuid; v_gaming uuid; v_ent uuid;
  v_provider uuid := '00000000-0000-0000-0000-000000000001';
  v_country_us uuid; v_country_tr uuid; v_country_gb uuid; v_country_de uuid;
  v_country_fr uuid; v_country_ru uuid; v_country_in uuid; v_country_br uuid;
  v_country_id uuid; v_country_ae uuid;
  v_svc_whatsapp uuid; v_svc_telegram uuid; v_svc_google uuid; v_svc_instagram uuid;
  v_svc_facebook uuid; v_svc_twitter uuid; v_svc_tiktok uuid; v_svc_discord uuid;
  v_svc_amazon uuid; v_svc_steam uuid; v_svc_netflix uuid; v_svc_spotify uuid;
BEGIN
  SELECT id INTO v_social FROM public.categories WHERE slug = 'social-media';
  SELECT id INTO v_messaging FROM public.categories WHERE slug = 'messaging';
  SELECT id INTO v_email FROM public.categories WHERE slug = 'email';
  SELECT id INTO v_ecom FROM public.categories WHERE slug = 'ecommerce';
  SELECT id INTO v_gaming FROM public.categories WHERE slug = 'gaming';
  SELECT id INTO v_ent FROM public.categories WHERE slug = 'entertainment';

  SELECT id INTO v_country_us FROM public.countries WHERE iso_code = 'US';
  SELECT id INTO v_country_tr FROM public.countries WHERE iso_code = 'TR';
  SELECT id INTO v_country_gb FROM public.countries WHERE iso_code = 'GB';
  SELECT id INTO v_country_de FROM public.countries WHERE iso_code = 'DE';
  SELECT id INTO v_country_fr FROM public.countries WHERE iso_code = 'FR';
  SELECT id INTO v_country_ru FROM public.countries WHERE iso_code = 'RU';
  SELECT id INTO v_country_in FROM public.countries WHERE iso_code = 'IN';
  SELECT id INTO v_country_br FROM public.countries WHERE iso_code = 'BR';
  SELECT id INTO v_country_id FROM public.countries WHERE iso_code = 'ID';
  SELECT id INTO v_country_ae FROM public.countries WHERE iso_code = 'AE';

  -- Insert services
  INSERT INTO public.services (name, slug, description, category_id, icon, is_active, is_demo, sort_order) VALUES
    ('WhatsApp', 'whatsapp', 'Verify WhatsApp accounts with virtual numbers', v_messaging, 'MessageCircle', true, true, 1),
    ('Telegram', 'telegram', 'Receive Telegram verification codes', v_messaging, 'Send', true, true, 2),
    ('Discord', 'discord', 'Verify Discord account registration', v_messaging, 'MessageSquare', true, true, 3),
    ('Google', 'google', 'Google account verification (Gmail, YouTube, etc.)', v_email, 'Mail', true, true, 4),
    ('Instagram', 'instagram', 'Instagram account verification', v_social, 'Camera', true, true, 5),
    ('Facebook', 'facebook', 'Facebook registration and verification', v_social, 'Facebook', true, true, 6),
    ('X (Twitter)', 'twitter', 'X/Twitter account verification', v_social, 'Twitter', true, true, 7),
    ('TikTok', 'tiktok', 'TikTok account verification', v_social, 'Music', true, true, 8),
    ('Amazon', 'amazon', 'Amazon marketplace verification', v_ecom, 'ShoppingCart', true, true, 9),
    ('Steam', 'steam', 'Steam gaming platform verification', v_gaming, 'Gamepad2', true, true, 10),
    ('Netflix', 'netflix', 'Netflix streaming verification', v_ent, 'Play', true, true, 11),
    ('Spotify', 'spotify', 'Spotify music streaming verification', v_ent, 'Music', true, true, 12)
  ON CONFLICT (slug) DO NOTHING;

  -- Get service IDs
  SELECT id INTO v_svc_whatsapp FROM public.services WHERE slug = 'whatsapp';
  SELECT id INTO v_svc_telegram FROM public.services WHERE slug = 'telegram';
  SELECT id INTO v_svc_google FROM public.services WHERE slug = 'google';
  SELECT id INTO v_svc_instagram FROM public.services WHERE slug = 'instagram';
  SELECT id INTO v_svc_facebook FROM public.services WHERE slug = 'facebook';
  SELECT id INTO v_svc_twitter FROM public.services WHERE slug = 'twitter';
  SELECT id INTO v_svc_tiktok FROM public.services WHERE slug = 'tiktok';
  SELECT id INTO v_svc_discord FROM public.services WHERE slug = 'discord';
  SELECT id INTO v_svc_amazon FROM public.services WHERE slug = 'amazon';
  SELECT id INTO v_svc_steam FROM public.services WHERE slug = 'steam';
  SELECT id INTO v_svc_netflix FROM public.services WHERE slug = 'netflix';
  SELECT id INTO v_svc_spotify FROM public.services WHERE slug = 'spotify';

  -- Provider country mappings
  INSERT INTO public.provider_country_mappings (provider_id, country_id, provider_country_id) VALUES
    (v_provider, v_country_us, '0'), (v_provider, v_country_tr, '1'),
    (v_provider, v_country_gb, '2'), (v_provider, v_country_de, '3'),
    (v_provider, v_country_fr, '4'), (v_provider, v_country_ru, '5'),
    (v_provider, v_country_in, '6'), (v_provider, v_country_br, '7'),
    (v_provider, v_country_id, '8'), (v_provider, v_country_ae, '9')
  ON CONFLICT (provider_id, provider_country_id) DO NOTHING;

  -- Provider service mappings
  INSERT INTO public.provider_service_mappings (provider_id, service_id, provider_service_id) VALUES
    (v_provider, v_svc_whatsapp, 'wa'), (v_provider, v_svc_telegram, 'tg'),
    (v_provider, v_svc_discord, 'dc'), (v_provider, v_svc_google, 'gg'),
    (v_provider, v_svc_instagram, 'ig'), (v_provider, v_svc_facebook, 'fb'),
    (v_provider, v_svc_twitter, 'tw'), (v_provider, v_svc_tiktok, 'tt'),
    (v_provider, v_svc_amazon, 'amz'), (v_provider, v_svc_steam, 'stm'),
    (v_provider, v_svc_netflix, 'nfx'), (v_provider, v_svc_spotify, 'spt')
  ON CONFLICT (provider_id, provider_service_id) DO NOTHING;

  -- Service-country availability with demo prices
  -- Each service available in multiple countries with varying costs
  INSERT INTO public.service_country_availability (service_id, country_id, provider_id, wholesale_cost, retail_price, currency, is_available, pricing_method, is_demo) VALUES
    -- WhatsApp (wholesale 0.10, 50% markup → 0.15)
    (v_svc_whatsapp, v_country_us, v_provider, 0.10, 0.15, 'USD', true, 'percentage_markup', true),
    (v_svc_whatsapp, v_country_tr, v_provider, 0.08, 0.12, 'USD', true, 'percentage_markup', true),
    (v_svc_whatsapp, v_country_gb, v_provider, 0.12, 0.18, 'USD', true, 'percentage_markup', true),
    (v_svc_whatsapp, v_country_de, v_provider, 0.12, 0.18, 'USD', true, 'percentage_markup', true),
    (v_svc_whatsapp, v_country_in, v_provider, 0.05, 0.08, 'USD', true, 'percentage_markup', true),
    (v_svc_whatsapp, v_country_ru, v_provider, 0.07, 0.11, 'USD', true, 'percentage_markup', true),
    -- Telegram
    (v_svc_telegram, v_country_us, v_provider, 0.10, 0.15, 'USD', true, 'percentage_markup', true),
    (v_svc_telegram, v_country_tr, v_provider, 0.06, 0.09, 'USD', true, 'percentage_markup', true),
    (v_svc_telegram, v_country_gb, v_provider, 0.11, 0.17, 'USD', true, 'percentage_markup', true),
    (v_svc_telegram, v_country_de, v_provider, 0.11, 0.17, 'USD', true, 'percentage_markup', true),
    (v_svc_telegram, v_country_in, v_provider, 0.04, 0.06, 'USD', true, 'percentage_markup', true),
    (v_svc_telegram, v_country_ae, v_provider, 0.09, 0.14, 'USD', true, 'percentage_markup', true),
    -- Discord
    (v_svc_discord, v_country_us, v_provider, 0.15, 0.23, 'USD', true, 'percentage_markup', true),
    (v_svc_discord, v_country_gb, v_provider, 0.17, 0.26, 'USD', true, 'percentage_markup', true),
    (v_svc_discord, v_country_de, v_provider, 0.17, 0.26, 'USD', true, 'percentage_markup', true),
    (v_svc_discord, v_country_br, v_provider, 0.10, 0.15, 'USD', true, 'percentage_markup', true),
    (v_svc_discord, v_country_id, v_provider, 0.08, 0.12, 'USD', true, 'percentage_markup', true),
    -- Google
    (v_svc_google, v_country_us, v_provider, 0.20, 0.30, 'USD', true, 'percentage_markup', true),
    (v_svc_google, v_country_tr, v_provider, 0.12, 0.18, 'USD', true, 'percentage_markup', true),
    (v_svc_google, v_country_gb, v_provider, 0.22, 0.33, 'USD', true, 'percentage_markup', true),
    (v_svc_google, v_country_in, v_provider, 0.08, 0.12, 'USD', true, 'percentage_markup', true),
    -- Instagram
    (v_svc_instagram, v_country_us, v_provider, 0.15, 0.23, 'USD', true, 'percentage_markup', true),
    (v_svc_instagram, v_country_tr, v_provider, 0.10, 0.15, 'USD', true, 'percentage_markup', true),
    (v_svc_instagram, v_country_fr, v_provider, 0.16, 0.24, 'USD', true, 'percentage_markup', true),
    (v_svc_instagram, v_country_br, v_provider, 0.09, 0.14, 'USD', true, 'percentage_markup', true),
    (v_svc_instagram, v_country_in, v_provider, 0.07, 0.11, 'USD', true, 'percentage_markup', true),
    -- Facebook
    (v_svc_facebook, v_country_us, v_provider, 0.18, 0.27, 'USD', true, 'percentage_markup', true),
    (v_svc_facebook, v_country_tr, v_provider, 0.11, 0.17, 'USD', true, 'percentage_markup', true),
    (v_svc_facebook, v_country_de, v_provider, 0.20, 0.30, 'USD', true, 'percentage_markup', true),
    -- Twitter/X
    (v_svc_twitter, v_country_us, v_provider, 0.25, 0.38, 'USD', true, 'percentage_markup', true),
    (v_svc_twitter, v_country_gb, v_provider, 0.27, 0.41, 'USD', true, 'percentage_markup', true),
    (v_svc_twitter, v_country_tr, v_provider, 0.15, 0.23, 'USD', true, 'percentage_markup', true),
    -- TikTok
    (v_svc_tiktok, v_country_us, v_provider, 0.20, 0.30, 'USD', true, 'percentage_markup', true),
    (v_svc_tiktok, v_country_in, v_provider, 0.08, 0.12, 'USD', true, 'percentage_markup', true),
    (v_svc_tiktok, v_country_id, v_provider, 0.07, 0.11, 'USD', true, 'percentage_markup', true),
    (v_svc_tiktok, v_country_br, v_provider, 0.09, 0.14, 'USD', true, 'percentage_markup', true),
    -- Amazon
    (v_svc_amazon, v_country_us, v_provider, 0.30, 0.45, 'USD', true, 'percentage_markup', true),
    (v_svc_amazon, v_country_gb, v_provider, 0.32, 0.48, 'USD', true, 'percentage_markup', true),
    (v_svc_amazon, v_country_de, v_provider, 0.32, 0.48, 'USD', true, 'percentage_markup', true),
    -- Steam
    (v_svc_steam, v_country_us, v_provider, 0.22, 0.33, 'USD', true, 'percentage_markup', true),
    (v_svc_steam, v_country_tr, v_provider, 0.12, 0.18, 'USD', true, 'percentage_markup', true),
    (v_svc_steam, v_country_ru, v_provider, 0.10, 0.15, 'USD', true, 'percentage_markup', true),
    -- Netflix
    (v_svc_netflix, v_country_us, v_provider, 0.35, 0.53, 'USD', true, 'percentage_markup', true),
    (v_svc_netflix, v_country_gb, v_provider, 0.37, 0.56, 'USD', true, 'percentage_markup', true),
    (v_svc_netflix, v_country_de, v_provider, 0.37, 0.56, 'USD', true, 'percentage_markup', true),
    -- Spotify
    (v_svc_spotify, v_country_us, v_provider, 0.25, 0.38, 'USD', true, 'percentage_markup', true),
    (v_svc_spotify, v_country_tr, v_provider, 0.12, 0.18, 'USD', true, 'percentage_markup', true),
    (v_svc_spotify, v_country_in, v_provider, 0.06, 0.09, 'USD', true, 'percentage_markup', true),
    (v_svc_spotify, v_country_br, v_provider, 0.10, 0.15, 'USD', true, 'percentage_markup', true)
  ON CONFLICT (service_id, country_id, provider_id) DO NOTHING;

  -- Pricing rules
  -- Global default: 50% markup
  INSERT INTO public.pricing_rules (scope, pricing_method, markup_percentage, round_to, is_active)
  VALUES ('global', 'percentage_markup', 50.00, 0.01, true)
  ON CONFLICT DO NOTHING;

  -- Category-specific: Messaging uses 40% target margin
  INSERT INTO public.pricing_rules (scope, category_id, pricing_method, target_margin_percentage, round_to, is_active)
  VALUES ('category', v_messaging, 'target_margin', 40.00, 0.01, true)
  ON CONFLICT DO NOTHING;
END $$;
