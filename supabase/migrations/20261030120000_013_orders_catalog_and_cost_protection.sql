/*
  # 013 - Order system, fast catalog RPCs, provider-cost protection  (APPLIED to live DB as "orders_catalog_and_cost_protection")
  - SECURITY FIX: anon/authenticated could read service_country_availability.wholesale_cost (provider cost).
    Column-level grants now expose only customer-safe columns; admins read all through view admin_service_availability.
  - orders + order_events with an enforced state machine (order_set_status) and idempotent refunds (order_refund)
  - catalog_search_services / catalog_service_countries / catalog_service_by_slug: paginated, safe-columns-only
  - quote_retail: server-side retail price for provider cost tiers (service_role only)
  Rollback: supabase/rollbacks/013_rollback.sql
*/

-- 1) protect provider cost
CREATE OR REPLACE VIEW public.admin_service_availability AS
  SELECT a.* FROM public.service_country_availability a WHERE public.current_user_is_admin();
REVOKE ALL ON public.admin_service_availability FROM PUBLIC, anon;
GRANT SELECT ON public.admin_service_availability TO authenticated;

REVOKE SELECT ON public.service_country_availability FROM anon, authenticated;
GRANT SELECT (id, service_id, country_id, retail_price, currency, is_available) ON public.service_country_availability TO anon, authenticated;
CREATE INDEX IF NOT EXISTS idx_sca_service_avail ON public.service_country_availability (service_id) WHERE is_available;

-- 2) orders
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  country_id uuid NOT NULL REFERENCES public.countries(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE RESTRICT,
  service_name text NOT NULL,
  country_name text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','received','completed','cancelled','failed','needs_review')),
  retail_price numeric(12,4) NOT NULL CHECK (retail_price > 0),
  provider_cost numeric(12,6),
  currency text NOT NULL DEFAULT 'USD',
  provider_activation_id text,
  phone_number text,
  sms_code text,
  sms_text text,
  refunded_at timestamptz,
  refund_txn_id uuid,
  error_message text,
  last_checked_at timestamptz,
  expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_provider_activation ON public.orders (provider_id, provider_activation_id) WHERE provider_activation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_user ON public.orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_open ON public.orders (status) WHERE status IN ('pending','active','received','needs_review');

CREATE TABLE IF NOT EXISTS public.order_events (
  id bigserial PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_select_own ON public.orders;
CREATE POLICY orders_select_own ON public.orders FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS order_events_select ON public.order_events;
CREATE POLICY order_events_select ON public.order_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND (o.user_id = auth.uid() OR public.is_admin(auth.uid()))));
REVOKE ALL ON public.orders, public.order_events FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.orders, public.order_events FROM authenticated;
GRANT SELECT ON public.orders, public.order_events TO authenticated;

-- 3) state machine
CREATE OR REPLACE FUNCTION public.order_set_status(p_order uuid, p_to text, p_note text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.orders%ROWTYPE; ok boolean;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF o.status = p_to THEN RETURN o.status; END IF;
  ok := CASE o.status
    WHEN 'pending'      THEN p_to IN ('active','failed','needs_review')
    WHEN 'active'       THEN p_to IN ('received','completed','cancelled','needs_review')
    WHEN 'received'     THEN p_to IN ('completed','active')
    WHEN 'needs_review' THEN p_to IN ('active','received','failed','cancelled')
    ELSE false END;
  IF NOT ok THEN RAISE EXCEPTION 'invalid order transition % -> %', o.status, p_to; END IF;
  UPDATE public.orders SET status = p_to, updated_at = now(),
         completed_at = CASE WHEN p_to IN ('completed','cancelled','failed') THEN now() ELSE completed_at END
   WHERE id = p_order;
  INSERT INTO public.order_events (order_id, from_status, to_status, note) VALUES (p_order, o.status, p_to, left(p_note, 500));
  RETURN p_to;
END $$;

-- 4) idempotent refund: charge is found through the ledger (never trusts a pointer that could be missing)
CREATE OR REPLACE FUNCTION public.order_refund(p_order uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.orders%ROWTYPE; v_charge uuid; r record;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF o.refunded_at IS NOT NULL THEN RETURN 'already_refunded'; END IF;
  IF o.status NOT IN ('cancelled','failed') THEN RAISE EXCEPTION 'order is not refundable in status %', o.status; END IF;
  SELECT id INTO v_charge FROM public.wallet_transactions WHERE idempotency_key = 'order:' || o.id::text LIMIT 1;
  IF v_charge IS NULL THEN RETURN 'nothing_to_refund'; END IF;
  SELECT * INTO r FROM public.credit_wallet(o.user_id, o.retail_price, 'refund', 'order', o.id, 'refund:' || o.id::text, left(p_reason, 200), '{}'::jsonb, NULL);
  IF r.status IN ('error','insufficient_funds') THEN RAISE EXCEPTION 'refund failed: %', r.status; END IF;
  UPDATE public.orders SET refunded_at = now(), refund_txn_id = r.transaction_id, updated_at = now() WHERE id = p_order;
  INSERT INTO public.order_events (order_id, from_status, to_status, note) VALUES (p_order, o.status, o.status, 'refunded: ' || left(p_reason, 200));
  RETURN 'refunded';
END $$;

-- 5) server-side price quote for provider cost tiers
CREATE OR REPLACE FUNCTION public.quote_retail(p_service_id uuid, p_country_id uuid, p_costs numeric[])
RETURNS TABLE(provider_id uuid, retail numeric[]) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.service_country_availability%ROWTYPE; r public.pricing_rules%ROWTYPE; cat uuid; c numeric; out numeric[] := '{}';
BEGIN
  SELECT * INTO a FROM public.service_country_availability WHERE service_id = p_service_id AND country_id = p_country_id AND is_available ORDER BY wholesale_cost LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT category_id INTO cat FROM public.services WHERE id = p_service_id;
  SELECT * INTO r FROM public.resolve_pricing_rule(p_service_id, p_country_id, a.provider_id, cat);
  FOREACH c IN ARRAY p_costs LOOP
    IF a.manual_price_override THEN
      out := out || round(a.retail_price * c / NULLIF(a.wholesale_cost, 0), 4);
    ELSE
      out := out || public.calculate_retail_price(c, r.pricing_method, r.markup_percentage, r.fixed_markup, r.target_margin_percentage, r.round_to);
    END IF;
  END LOOP;
  RETURN QUERY SELECT a.provider_id, out;
END $$;

-- 6) catalog RPCs (customer-safe columns only)
CREATE OR REPLACE FUNCTION public.catalog_search_services(p_query text DEFAULT '', p_limit int DEFAULT 24, p_offset int DEFAULT 0)
RETURNS TABLE(service_id uuid, name text, slug text, icon text, countries bigint, min_price numeric, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH agg AS (
    SELECT a.service_id, count(*) AS countries, min(a.retail_price) AS min_price
    FROM public.service_country_availability a
    JOIN public.countries c ON c.id = a.country_id AND c.is_active
    WHERE a.is_available GROUP BY a.service_id)
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
  SELECT c.id, c.name, c.iso_code, c.flag_emoji, min(a.retail_price)
  FROM public.service_country_availability a
  JOIN public.countries c ON c.id = a.country_id AND c.is_active
  JOIN public.services s ON s.id = a.service_id AND s.is_active AND NOT s.is_archived
  WHERE a.service_id = p_service_id AND a.is_available
  GROUP BY c.id ORDER BY min(a.retail_price), c.name;
$$;

CREATE OR REPLACE FUNCTION public.catalog_service_by_slug(p_slug text)
RETURNS TABLE(service_id uuid, name text, slug text, icon text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, name, slug, icon FROM public.services WHERE slug = p_slug AND is_active AND NOT is_archived LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.order_set_status(uuid,text,text), public.order_refund(uuid,text), public.quote_retail(uuid,uuid,numeric[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_set_status(uuid,text,text), public.order_refund(uuid,text), public.quote_retail(uuid,uuid,numeric[]) TO service_role;
REVOKE ALL ON FUNCTION public.catalog_search_services(text,int,int), public.catalog_service_countries(uuid), public.catalog_service_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalog_search_services(text,int,int), public.catalog_service_countries(uuid), public.catalog_service_by_slug(text) TO anon, authenticated, service_role;
