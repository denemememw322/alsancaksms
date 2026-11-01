/*
  # 014 - Service manager (tiers), user admin, currency  (APPLIED to live DB as "service_manager_tiers_users_currency")
  - Backs up then removes ALL services (re-addable from the provider via Admin > Services > Add from API)
  - orders.service_id/country_id become nullable + ON DELETE SET NULL (order history survives catalog changes)
  - service_country_tiers: one row per provider price option per service+country, with enable tick, ratio and sell price
    sell = max(cost * ratio, cost): follows provider cost proportionally and never sells below cost
  - admin RPCs for services/tiers, users list, exchange rate; customer catalog RPCs now read tiers
  Rollback: supabase/rollbacks/014_rollback.sql
*/
-- 1) order history must survive catalog resets
ALTER TABLE public.orders ALTER COLUMN service_id DROP NOT NULL, ALTER COLUMN country_id DROP NOT NULL;
ALTER TABLE public.orders DROP CONSTRAINT orders_service_id_fkey, DROP CONSTRAINT orders_country_id_fkey;
ALTER TABLE public.orders ADD CONSTRAINT orders_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD CONSTRAINT orders_country_id_fkey FOREIGN KEY (country_id) REFERENCES public.countries(id) ON DELETE SET NULL;

-- 2) backup, then remove all services (cascades availability, mappings, service-scoped rules/history)
CREATE TABLE IF NOT EXISTS public._bak_services_20261031 AS SELECT * FROM public.services;
CREATE TABLE IF NOT EXISTS public._bak_availability_20261031 AS SELECT * FROM public.service_country_availability;
CREATE TABLE IF NOT EXISTS public._bak_service_maps_20261031 AS SELECT * FROM public.provider_service_mappings;
ALTER TABLE public._bak_services_20261031 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_availability_20261031 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_service_maps_20261031 ENABLE ROW LEVEL SECURITY;
DELETE FROM public.services;

-- 3) columns
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS country_mode text NOT NULL DEFAULT 'all' CHECK (country_mode IN ('all','selected'));
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS last_price_sync_at timestamptz;
ALTER TABLE public.service_country_availability ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.service_country_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  availability_id uuid NOT NULL REFERENCES public.service_country_availability(id) ON DELETE CASCADE,
  tier_key text NOT NULL,
  wholesale_cost numeric(12,6) NOT NULL CHECK (wholesale_cost > 0),
  quantity bigint NOT NULL DEFAULT 0,
  ratio numeric(14,6) NOT NULL DEFAULT 2 CHECK (ratio >= 1),
  retail_price numeric(12,4) NOT NULL CHECK (retail_price > 0),
  is_enabled boolean NOT NULL DEFAULT true,
  in_stock boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (availability_id, tier_key)
);
CREATE INDEX IF NOT EXISTS idx_tiers_avail ON public.service_country_tiers (availability_id);
ALTER TABLE public.service_country_tiers ENABLE ROW LEVEL SECURITY;  -- no policies: access only through RPCs
REVOKE ALL ON public.service_country_tiers FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  usd_try numeric(12,4) NOT NULL CHECK (usd_try > 0),
  source text NOT NULL,
  is_manual boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exchange_rates FROM anon, authenticated;

-- 4) pricing helpers
CREATE OR REPLACE FUNCTION public.tier_retail(p_cost numeric, p_ratio numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT greatest(round(p_cost * greatest(p_ratio, 1), 4), p_cost);
$$;

CREATE OR REPLACE FUNCTION public.default_ratio()
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT greatest(coalesce((SELECT public.calculate_retail_price(1.0, r.pricing_method, r.markup_percentage, r.fixed_markup, r.target_margin_percentage, 0.0001)
                            FROM public.pricing_rules r WHERE r.scope = 'global' AND r.is_active ORDER BY r.updated_at DESC LIMIT 1), 2), 1);
$$;

CREATE OR REPLACE FUNCTION public._refresh_availability(p_avail uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.service_country_availability a SET
    wholesale_cost = coalesce((SELECT min(t.wholesale_cost) FROM public.service_country_tiers t WHERE t.availability_id = a.id AND t.in_stock), a.wholesale_cost),
    retail_price   = coalesce((SELECT min(t.retail_price) FROM public.service_country_tiers t WHERE t.availability_id = a.id AND t.in_stock AND t.is_enabled), a.retail_price),
    is_available   = EXISTS (SELECT 1 FROM public.service_country_tiers t WHERE t.availability_id = a.id AND t.in_stock),
    last_cost_update = now(), last_availability_check = now(), updated_at = now()
  WHERE a.id = p_avail;
$$;

-- 5) sync one service+country from provider tiers (service_role)
CREATE OR REPLACE FUNCTION public.upsert_tiers(p_provider uuid, p_service uuid, p_country uuid, p_tiers jsonb, p_enable_new boolean DEFAULT true)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a_id uuid; dr numeric := public.default_ratio(); n int := 0; m numeric; pm public.pricing_method;
BEGIN
  SELECT id INTO a_id FROM public.service_country_availability WHERE service_id = p_service AND country_id = p_country AND provider_id = p_provider;
  IF a_id IS NULL THEN
    SELECT min(x.cost) INTO m FROM jsonb_to_recordset(coalesce(p_tiers,'[]'::jsonb)) AS x(key text, cost numeric, count bigint) WHERE x.cost > 0 AND x.count > 0;
    IF m IS NULL THEN RETURN 0; END IF;   -- never create a country that has no numbers
    SELECT pricing_method INTO pm FROM public.pricing_rules WHERE scope = 'global' AND is_active LIMIT 1;
    INSERT INTO public.service_country_availability (service_id, country_id, provider_id, wholesale_cost, retail_price, currency, is_available, pricing_method, manual_price_override, is_demo, is_enabled)
    VALUES (p_service, p_country, p_provider, m, public.tier_retail(m, dr), 'USD', true, coalesce(pm, 'percentage_markup'), false, false, true)
    RETURNING id INTO a_id;
  END IF;
  INSERT INTO public.service_country_tiers (availability_id, tier_key, wholesale_cost, quantity, ratio, retail_price, is_enabled, in_stock)
  SELECT a_id, x.key, x.cost, x.count, dr, public.tier_retail(x.cost, dr), p_enable_new, true
  FROM jsonb_to_recordset(coalesce(p_tiers,'[]'::jsonb)) AS x(key text, cost numeric, count bigint) WHERE x.cost > 0 AND x.count > 0
  ON CONFLICT (availability_id, tier_key) DO UPDATE SET
    wholesale_cost = EXCLUDED.wholesale_cost, quantity = EXCLUDED.quantity, in_stock = true,
    retail_price = public.tier_retail(EXCLUDED.wholesale_cost, public.service_country_tiers.ratio), updated_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.service_country_tiers SET in_stock = false, quantity = 0, updated_at = now()
  WHERE availability_id = a_id AND in_stock
    AND tier_key NOT IN (SELECT x.key FROM jsonb_to_recordset(coalesce(p_tiers,'[]'::jsonb)) AS x(key text, cost numeric, count bigint) WHERE x.cost > 0 AND x.count > 0);
  PERFORM public._refresh_availability(a_id);
  RETURN n;
END $$;

-- create/find a service for a provider platform (service_role)
CREATE OR REPLACE FUNCTION public.admin_ensure_service(p_provider uuid, p_code text, p_name text, p_mode text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid; base text;
BEGIN
  SELECT service_id INTO sid FROM public.provider_service_mappings WHERE provider_id = p_provider AND provider_service_id = p_code;
  IF sid IS NOT NULL THEN
    IF p_mode = 'all' THEN UPDATE public.services SET country_mode = 'all', updated_at = now() WHERE id = sid; END IF;
    RETURN sid;
  END IF;
  base := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'));
  IF base = '' THEN base := lower(regexp_replace(p_code, '[^a-zA-Z0-9]', '', 'g')); END IF;
  IF EXISTS (SELECT 1 FROM public.services WHERE slug = base) THEN base := base || '-' || lower(regexp_replace(p_code, '[^a-zA-Z0-9]', '', 'g')); END IF;
  IF EXISTS (SELECT 1 FROM public.services WHERE slug = base) THEN base := base || '-' || substr(md5(p_code), 1, 4); END IF;
  INSERT INTO public.services (name, slug, category_id, is_active, is_archived, is_demo, sort_order, country_mode)
  VALUES (p_name, base, public._guess_category_id(p_name), true, false, false, 100, CASE WHEN p_mode = 'selected' THEN 'selected' ELSE 'all' END)
  RETURNING id INTO sid;
  INSERT INTO public.provider_service_mappings (provider_id, service_id, provider_service_id) VALUES (p_provider, sid, p_code);
  RETURN sid;
END $$;

-- 6) live quote for customers: only enabled tiers that still exist at the provider; price follows LIVE cost * ratio
CREATE OR REPLACE FUNCTION public.quote_tiers(p_service uuid, p_country uuid, p_live jsonb)
RETURNS TABLE(provider_id uuid, tier_key text, cost numeric, quantity bigint, retail numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.provider_id, t.tier_key, l.cost, l.count, public.tier_retail(l.cost, t.ratio)
  FROM public.service_country_availability a
  JOIN public.service_country_tiers t ON t.availability_id = a.id AND t.is_enabled
  JOIN jsonb_to_recordset(coalesce(p_live,'[]'::jsonb)) AS l(key text, cost numeric, count bigint) ON l.key = t.tier_key AND l.count > 0 AND l.cost > 0
  JOIN public.services s ON s.id = a.service_id AND s.is_active AND NOT s.is_archived
  JOIN public.countries c ON c.id = a.country_id AND c.is_active
  WHERE a.service_id = p_service AND a.country_id = p_country AND a.is_enabled
  ORDER BY l.cost;
$$;

-- 7) customer catalog now reads enabled in-stock tiers
CREATE OR REPLACE FUNCTION public.catalog_search_services(p_query text DEFAULT '', p_limit int DEFAULT 24, p_offset int DEFAULT 0)
RETURNS TABLE(service_id uuid, name text, slug text, icon text, countries bigint, min_price numeric, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH agg AS (
    SELECT a.service_id, count(DISTINCT a.country_id) AS countries, min(t.retail_price) AS min_price
    FROM public.service_country_availability a
    JOIN public.service_country_tiers t ON t.availability_id = a.id AND t.is_enabled AND t.in_stock
    JOIN public.countries c ON c.id = a.country_id AND c.is_active
    WHERE a.is_enabled GROUP BY a.service_id)
  SELECT s.id, s.name, s.slug, s.icon, agg.countries, agg.min_price, count(*) OVER ()
  FROM public.services s JOIN agg ON agg.service_id = s.id
  WHERE s.is_active AND NOT s.is_archived
    AND (coalesce(trim(p_query),'') = '' OR s.name ILIKE '%' || replace(replace(trim(p_query),'%','\%'),'_','\_') || '%')
  ORDER BY (CASE WHEN coalesce(trim(p_query),'') <> '' AND s.name ILIKE replace(replace(trim(p_query),'%','\%'),'_','\_') || '%' THEN 0 ELSE 1 END), agg.countries DESC, s.name
  LIMIT least(greatest(p_limit,1),100) OFFSET greatest(p_offset,0);
$$;

CREATE OR REPLACE FUNCTION public.catalog_service_countries(p_service_id uuid)
RETURNS TABLE(country_id uuid, name text, iso_code text, flag_emoji text, min_price numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.name, c.iso_code, c.flag_emoji, min(t.retail_price)
  FROM public.service_country_availability a
  JOIN public.service_country_tiers t ON t.availability_id = a.id AND t.is_enabled AND t.in_stock
  JOIN public.countries c ON c.id = a.country_id AND c.is_active
  JOIN public.services s ON s.id = a.service_id AND s.is_active AND NOT s.is_archived
  WHERE a.service_id = p_service_id AND a.is_enabled
  GROUP BY c.id ORDER BY min(t.retail_price), c.name;
$$;

-- 8) admin: services / tiers
CREATE OR REPLACE FUNCTION public.admin_list_services(p_q text DEFAULT '', p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS TABLE(service_id uuid, name text, slug text, is_active boolean, country_mode text, countries bigint, tiers bigint, min_cost numeric, total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.current_user_is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT s.id, s.name, s.slug, s.is_active, s.country_mode,
    (SELECT count(*) FROM public.service_country_availability a WHERE a.service_id = s.id AND a.is_enabled),
    (SELECT count(*) FROM public.service_country_tiers t JOIN public.service_country_availability a ON a.id = t.availability_id WHERE a.service_id = s.id AND t.is_enabled AND t.in_stock),
    (SELECT min(t.wholesale_cost) FROM public.service_country_tiers t JOIN public.service_country_availability a ON a.id = t.availability_id WHERE a.service_id = s.id AND t.in_stock),
    count(*) OVER ()
  FROM public.services s
  WHERE coalesce(trim(p_q),'') = '' OR s.name ILIKE '%' || replace(replace(trim(p_q),'%','\%'),'_','\_') || '%'
  ORDER BY s.name LIMIT least(greatest(p_limit,1),200) OFFSET greatest(p_offset,0);
END $$;

CREATE OR REPLACE FUNCTION public.admin_service_detail(p_service uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public.current_user_is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object(
    'service', jsonb_build_object('id', s.id, 'name', s.name, 'country_mode', s.country_mode, 'is_active', s.is_active),
    'mapping', (SELECT jsonb_build_object('provider_id', m.provider_id, 'code', m.provider_service_id) FROM public.provider_service_mappings m WHERE m.service_id = s.id LIMIT 1),
    'countries', coalesce((SELECT jsonb_agg(jsonb_build_object('availability_id', a.id, 'country_id', c.id, 'name', c.name, 'iso', c.iso_code, 'flag', c.flag_emoji, 'is_enabled', a.is_enabled,
        'tiers', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'key', t.tier_key, 'cost', t.wholesale_cost, 'quantity', t.quantity, 'ratio', t.ratio, 'retail', t.retail_price, 'is_enabled', t.is_enabled, 'in_stock', t.in_stock) ORDER BY t.wholesale_cost)
                           FROM public.service_country_tiers t WHERE t.availability_id = a.id), '[]'::jsonb)) ORDER BY c.name)
      FROM public.service_country_availability a JOIN public.countries c ON c.id = a.country_id WHERE a.service_id = s.id), '[]'::jsonb))
  INTO r FROM public.services s WHERE s.id = p_service;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_tier_price(p_tier uuid, p_price numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.service_country_tiers%ROWTYPE;
BEGIN
  IF NOT public.current_user_is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM public.service_country_tiers WHERE id = p_tier FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tier not found'; END IF;
  IF p_price IS NULL OR p_price < t.wholesale_cost THEN RAISE EXCEPTION 'Price cannot be below the provider cost (%)', t.wholesale_cost; END IF;
  UPDATE public.service_country_tiers SET ratio = round(p_price / t.wholesale_cost, 6), retail_price = round(p_price, 4), updated_at = now() WHERE id = p_tier;
  PERFORM public._refresh_availability(t.availability_id);
  PERFORM public._admin_audit('tier.price', 'service_country_tier', p_tier, jsonb_build_object('price', p_price));
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_tier_enabled(p_tier uuid, p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a uuid;
BEGIN
  IF NOT public.current_user_is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE public.service_country_tiers SET is_enabled = p_enabled, updated_at = now() WHERE id = p_tier RETURNING availability_id INTO a;
  IF a IS NULL THEN RAISE EXCEPTION 'tier not found'; END IF;
  PERFORM public._refresh_availability(a);
  PERFORM public._admin_audit('tier.enabled', 'service_country_tier', p_tier, jsonb_build_object('enabled', p_enabled));
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_country_enabled(p_avail uuid, p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.current_user_is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE public.service_country_availability SET is_enabled = p_enabled, updated_at = now() WHERE id = p_avail;
  PERFORM public._admin_audit('country.enabled', 'service_country_availability', p_avail, jsonb_build_object('enabled', p_enabled));
END $$;

CREATE OR REPLACE FUNCTION public.admin_bulk_set_ratio(p_service uuid, p_ratio numeric, p_only_enabled boolean DEFAULT true)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int; a uuid;
BEGIN
  IF NOT public.current_user_is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_ratio IS NULL OR p_ratio < 1 OR p_ratio > 1000 THEN RAISE EXCEPTION 'ratio must be between 1 and 1000'; END IF;
  UPDATE public.service_country_tiers t SET ratio = p_ratio, retail_price = public.tier_retail(t.wholesale_cost, p_ratio), updated_at = now()
  FROM public.service_country_availability av WHERE av.id = t.availability_id AND av.service_id = p_service AND (NOT p_only_enabled OR t.is_enabled);
  GET DIAGNOSTICS n = ROW_COUNT;
  FOR a IN SELECT id FROM public.service_country_availability WHERE service_id = p_service LOOP PERFORM public._refresh_availability(a); END LOOP;
  PERFORM public._admin_audit('service.bulk_ratio', 'service', p_service, jsonb_build_object('ratio', p_ratio, 'tiers', n));
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.admin_delete_service(p_service uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.current_user_is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.services WHERE id = p_service;
  PERFORM public._admin_audit('service.delete', 'service', p_service, '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.admin_provider_countries(p_provider uuid)
RETURNS TABLE(country_id uuid, name text, iso_code text, flag_emoji text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.current_user_is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT c.id, c.name, c.iso_code, c.flag_emoji FROM public.provider_country_mappings m JOIN public.countries c ON c.id = m.country_id WHERE m.provider_id = p_provider AND c.is_active ORDER BY c.name;
END $$;

-- 9) admin: users
CREATE OR REPLACE FUNCTION public.admin_list_users(p_q text DEFAULT '', p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS TABLE(user_id uuid, email text, display_name text, status text, balance numeric, orders bigint, created_at timestamptz, last_sign_in_at timestamptz, banned boolean, total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.current_user_is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT p.id, p.email, p.display_name, p.status::text, coalesce(w.balance, 0), (SELECT count(*) FROM public.orders o WHERE o.user_id = p.id),
         p.created_at, u.last_sign_in_at, (u.banned_until IS NOT NULL AND u.banned_until > now()), count(*) OVER ()
  FROM public.profiles p LEFT JOIN public.user_wallets w ON w.user_id = p.id AND w.currency = 'USD' LEFT JOIN auth.users u ON u.id = p.id
  WHERE coalesce(trim(p_q),'') = '' OR p.email ILIKE '%' || replace(replace(trim(p_q),'%','\%'),'_','\_') || '%' OR p.display_name ILIKE '%' || replace(replace(trim(p_q),'%','\%'),'_','\_') || '%'
  ORDER BY p.created_at DESC LIMIT least(greatest(p_limit,1),200) OFFSET greatest(p_offset,0);
END $$;

-- 10) exchange rate
CREATE OR REPLACE FUNCTION public.get_usd_try() RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT usd_try FROM public.exchange_rates WHERE id = 1; $$;
CREATE OR REPLACE FUNCTION public.admin_set_usd_try(p_rate numeric, p_manual boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.current_user_is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_manual AND (p_rate IS NULL OR p_rate <= 0 OR p_rate > 10000) THEN RAISE EXCEPTION 'invalid rate'; END IF;
  IF p_manual THEN
    INSERT INTO public.exchange_rates (id, usd_try, source, is_manual, updated_at) VALUES (1, p_rate, 'manual', true, now())
    ON CONFLICT (id) DO UPDATE SET usd_try = EXCLUDED.usd_try, source = 'manual', is_manual = true, updated_at = now();
  ELSE
    UPDATE public.exchange_rates SET is_manual = false WHERE id = 1;
  END IF;
  PERFORM public._admin_audit('fx.set', 'exchange_rate', NULL, jsonb_build_object('manual', p_manual, 'rate', p_rate));
END $$;
CREATE OR REPLACE FUNCTION public.admin_fx_status()
RETURNS TABLE(usd_try numeric, source text, is_manual boolean, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.current_user_is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT e.usd_try, e.source, e.is_manual, e.updated_at FROM public.exchange_rates e WHERE e.id = 1;
END $$;

CREATE OR REPLACE FUNCTION public.set_usd_try_auto(p_rate numeric, p_source text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_rate IS NULL OR p_rate <= 0 OR p_rate > 10000 THEN RAISE EXCEPTION 'invalid rate'; END IF;
  INSERT INTO public.exchange_rates (id, usd_try, source, is_manual, updated_at) VALUES (1, p_rate, p_source, false, now())
  ON CONFLICT (id) DO UPDATE SET usd_try = EXCLUDED.usd_try, source = EXCLUDED.source, updated_at = now() WHERE NOT public.exchange_rates.is_manual;
END $$;

-- scheduled sync authentication (secret lives in Vault, created with the cron job)
CREATE OR REPLACE FUNCTION public.check_cron_secret(p text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT p IS NOT NULL AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_secret' AND decrypted_secret = p);
$$;

-- 11) grants
REVOKE ALL ON FUNCTION public.tier_retail(numeric,numeric), public.default_ratio(), public._refresh_availability(uuid), public.upsert_tiers(uuid,uuid,uuid,jsonb,boolean),
  public.admin_ensure_service(uuid,text,text,text), public.quote_tiers(uuid,uuid,jsonb), public.set_usd_try_auto(numeric,text), public.check_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tier_retail(numeric,numeric), public.default_ratio(), public._refresh_availability(uuid), public.upsert_tiers(uuid,uuid,uuid,jsonb,boolean),
  public.admin_ensure_service(uuid,text,text,text), public.quote_tiers(uuid,uuid,jsonb), public.set_usd_try_auto(numeric,text), public.check_cron_secret(text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_list_services(text,int,int), public.admin_service_detail(uuid), public.admin_set_tier_price(uuid,numeric), public.admin_set_tier_enabled(uuid,boolean),
  public.admin_set_country_enabled(uuid,boolean), public.admin_bulk_set_ratio(uuid,numeric,boolean), public.admin_delete_service(uuid), public.admin_provider_countries(uuid),
  public.admin_list_users(text,int,int), public.admin_set_usd_try(numeric,boolean), public.admin_fx_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_services(text,int,int), public.admin_service_detail(uuid), public.admin_set_tier_price(uuid,numeric), public.admin_set_tier_enabled(uuid,boolean),
  public.admin_set_country_enabled(uuid,boolean), public.admin_bulk_set_ratio(uuid,numeric,boolean), public.admin_delete_service(uuid), public.admin_provider_countries(uuid),
  public.admin_list_users(text,int,int), public.admin_set_usd_try(numeric,boolean), public.admin_fx_status() TO authenticated;
REVOKE ALL ON FUNCTION public.get_usd_try() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_usd_try() TO anon, authenticated, service_role;
