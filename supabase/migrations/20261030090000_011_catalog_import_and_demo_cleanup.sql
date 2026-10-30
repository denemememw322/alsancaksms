/*
  # 011 - Catalog import from provider + demo data cleanup  (APPLIED to live DB via Supabase as "catalog_import_and_demo_cleanup")
  - Backs up demo catalog into RLS-locked _bak_demo_* tables, then deletes demo services/availability
  - Deactivates demo-provider (row kept)
  - Adds helpers: current_user_is_admin, get_provider_secret (service_role only), _guess_category_id
  - import_provider_catalog (service_role only): bulk upsert of countries/services/prices, respects manual price overrides
  - admin_sync_status: admin-only view of latest sync job + logs
*/
CREATE TABLE IF NOT EXISTS public._bak_demo_services AS SELECT * FROM public.services WHERE is_demo;
CREATE TABLE IF NOT EXISTS public._bak_demo_availability AS SELECT * FROM public.service_country_availability WHERE is_demo;
CREATE TABLE IF NOT EXISTS public._bak_demo_service_maps AS SELECT m.* FROM public.provider_service_mappings m JOIN public.services s ON s.id = m.service_id WHERE s.is_demo;
ALTER TABLE public._bak_demo_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_demo_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_demo_service_maps ENABLE ROW LEVEL SECURITY;

DELETE FROM public.service_country_availability WHERE is_demo;
DELETE FROM public.services WHERE is_demo;
UPDATE public.providers SET is_active = false, updated_at = now() WHERE slug = 'demo-provider';

INSERT INTO public.categories (name, slug, description, sort_order, is_active)
VALUES ('Other', 'other', 'Services not matched to another category', 99, true)
ON CONFLICT (slug) DO NOTHING;

CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND public.is_admin(auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION public.current_user_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_provider_secret(p_provider_id uuid, p_key text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT ds.decrypted_secret
  FROM public.provider_credentials c
  JOIN vault.decrypted_secrets ds ON ds.id = nullif(c.encrypted_value, '')::uuid
  WHERE c.provider_id = p_provider_id AND c.key_name = p_key AND c.is_active
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_provider_secret(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_provider_secret(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public._guess_category_id(p_name text)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT id FROM public.categories WHERE slug = (
    CASE
      WHEN lower(p_name) ~ '(whatsapp|telegram|viber|signal|wechat|messenger|kakao|imo\b|skype|line\b|zalo|botim|discord|icq|snapchat chat)' THEN 'messaging'
      WHEN lower(p_name) ~ '(facebook|instagram|twitter|x\.com|tiktok|snapchat|vk\b|vkontakte|linkedin|reddit|pinterest|tumblr|threads|badoo|tinder|bumble|likee|weibo|ok\.ru|odnoklassniki|clubhouse|social|dating|hinge)' THEN 'social-media'
      WHEN lower(p_name) ~ '(gmail|google|yahoo|outlook|hotmail|proton|mail\.ru|yandex|icloud|aol|zoho|e-?mail)' THEN 'email'
      WHEN lower(p_name) ~ '(amazon|ebay|aliexpress|alibaba|shopee|lazada|olx|walmart|temu|shein|etsy|taobao|flipkart|mercado|jd\.com|avito|paypal|payoneer|binance|coinbase|bank|wallet|shop|store)' THEN 'ecommerce'
      WHEN lower(p_name) ~ '(steam|epic|roblox|blizzard|battle\.net|riot|playstation|xbox|supercell|fortnite|genshin|garena|ubisoft|origin|wargaming|game|pubg|mobile legends|nintendo)' THEN 'gaming'
      WHEN lower(p_name) ~ '(netflix|spotify|youtube|twitch|disney|hbo|hulu|prime video|deezer|tv|music|video|stream|kinopoisk|ivi)' THEN 'entertainment'
      ELSE 'other'
    END
  ) LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.import_provider_catalog(p_provider_id uuid, p_countries jsonb, p_services jsonb, p_prices jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n_c int := 0; n_s int := 0; n_p int := 0;
  r public.pricing_rules%ROWTYPE;
  rec record; base text; sid uuid;
BEGIN
  IF p_countries IS NOT NULL AND jsonb_array_length(p_countries) > 0 THEN
    INSERT INTO public.countries (iso_code, name, flag_emoji, is_active, sort_order)
    SELECT DISTINCT ON (upper(x.iso)) upper(x.iso), x.name, x.flag, true, 100
    FROM jsonb_to_recordset(p_countries) AS x(id text, name text, iso text, flag text)
    WHERE coalesce(x.iso,'') <> '' AND coalesce(x.name,'') <> ''
    ON CONFLICT (iso_code) DO NOTHING;

    INSERT INTO public.provider_country_mappings (provider_id, country_id, provider_country_id)
    SELECT DISTINCT ON (upper(x.iso)) p_provider_id, c.id, x.id
    FROM jsonb_to_recordset(p_countries) AS x(id text, name text, iso text, flag text)
    JOIN public.countries c ON c.iso_code = upper(x.iso)
    WHERE coalesce(x.id,'') <> ''
    ON CONFLICT DO NOTHING;
    SELECT count(*) INTO n_c FROM public.provider_country_mappings WHERE provider_id = p_provider_id;
  END IF;

  IF p_services IS NOT NULL AND jsonb_array_length(p_services) > 0 THEN
    FOR rec IN
      SELECT DISTINCT ON (x.code) x.code, x.name
      FROM jsonb_to_recordset(p_services) AS x(code text, name text)
      WHERE coalesce(x.code,'') <> '' AND coalesce(x.name,'') <> ''
        AND NOT EXISTS (SELECT 1 FROM public.provider_service_mappings m WHERE m.provider_id = p_provider_id AND m.provider_service_id = x.code)
    LOOP
      base := trim(both '-' from regexp_replace(lower(rec.name), '[^a-z0-9]+', '-', 'g'));
      IF base = '' THEN base := lower(regexp_replace(rec.code, '[^a-zA-Z0-9]', '', 'g')); END IF;
      IF EXISTS (SELECT 1 FROM public.services WHERE slug = base) THEN
        base := base || '-' || lower(regexp_replace(rec.code, '[^a-zA-Z0-9]', '', 'g'));
      END IF;
      IF EXISTS (SELECT 1 FROM public.services WHERE slug = base) THEN
        base := base || '-' || substr(md5(rec.code), 1, 4);
      END IF;
      INSERT INTO public.services (name, slug, category_id, is_active, is_archived, is_demo, sort_order)
      VALUES (rec.name, base, public._guess_category_id(rec.name), true, false, false, 100)
      RETURNING id INTO sid;
      INSERT INTO public.provider_service_mappings (provider_id, service_id, provider_service_id)
      VALUES (p_provider_id, sid, rec.code) ON CONFLICT DO NOTHING;
    END LOOP;
    SELECT count(*) INTO n_s FROM public.provider_service_mappings WHERE provider_id = p_provider_id;
  END IF;

  IF p_prices IS NOT NULL AND jsonb_array_length(p_prices) > 0 THEN
    SELECT * INTO r FROM public.pricing_rules WHERE scope = 'global' AND is_active ORDER BY updated_at DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'No active global pricing rule configured'; END IF;
    INSERT INTO public.service_country_availability
      (service_id, country_id, provider_id, wholesale_cost, retail_price, currency, is_available, pricing_method,
       manual_price_override, last_cost_update, last_availability_check, is_demo)
    SELECT sm.service_id, cm.country_id, p_provider_id, x.cost,
           public.calculate_retail_price(x.cost, r.pricing_method, r.markup_percentage, r.fixed_markup, r.target_margin_percentage, r.round_to),
           'USD', x.n > 0, r.pricing_method, false, now(), now(), false
    FROM jsonb_to_recordset(p_prices) AS x(c text, s text, cost numeric, n integer)
    JOIN public.provider_service_mappings sm ON sm.provider_id = p_provider_id AND sm.provider_service_id = x.s
    JOIN public.provider_country_mappings cm ON cm.provider_id = p_provider_id AND cm.provider_country_id = x.c
    WHERE x.cost IS NOT NULL AND x.cost > 0
    ON CONFLICT (service_id, country_id, provider_id) DO UPDATE SET
      wholesale_cost = EXCLUDED.wholesale_cost,
      is_available = EXCLUDED.is_available,
      retail_price = CASE WHEN public.service_country_availability.manual_price_override
                          THEN public.service_country_availability.retail_price ELSE EXCLUDED.retail_price END,
      last_cost_update = now(), last_availability_check = now(), updated_at = now();
    GET DIAGNOSTICS n_p = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('country_mappings', n_c, 'service_mappings', n_s, 'price_rows_upserted', n_p);
END $$;
REVOKE ALL ON FUNCTION public.import_provider_catalog(uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_provider_catalog(uuid, jsonb, jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_sync_status(p_provider_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.provider_sync_jobs%ROWTYPE;
BEGIN
  IF NOT public.current_user_is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO j FROM public.provider_sync_jobs WHERE provider_id = p_provider_id ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('job', NULL, 'logs', '[]'::jsonb); END IF;
  RETURN jsonb_build_object(
    'job', to_jsonb(j),
    'logs', coalesce((SELECT jsonb_agg(jsonb_build_object('level', l.level, 'message', l.message, 'at', l.created_at) ORDER BY l.created_at DESC)
                      FROM (SELECT * FROM public.provider_sync_logs WHERE sync_job_id = j.id ORDER BY created_at DESC LIMIT 30) l), '[]'::jsonb));
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_sync_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_sync_status(uuid) TO authenticated;
