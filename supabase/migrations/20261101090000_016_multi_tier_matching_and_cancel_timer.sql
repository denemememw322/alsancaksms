/*
  # 016 - Multi-tier matching + cancel timer  (APPLIED to live DB as "multi_tier_matching_and_cancel_timer")
  - upsert_tiers: price-keyed provider tiers (getPricesV2 {"0.165": 76005, ...}) keep their admin settings when the
    provider changes a price: exact cost match first, then rank pairing when the number of tiers is unchanged.
    Tiers that vanish are marked out of stock (never deleted), new ones are added.
  - quote_tiers(service, country): customer view reads the (just refreshed) DB tiers, so keys can never mismatch
    again (that mismatch is what showed "out of stock" while stock existed).
  - orders.cancel_available_at + providers.cancel_delay_seconds (default 120 = common provider rule; change per provider)
*/
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancel_available_at timestamptz;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS cancel_delay_seconds integer NOT NULL DEFAULT 120 CHECK (cancel_delay_seconds BETWEEN 0 AND 3600);

CREATE OR REPLACE FUNCTION public.upsert_tiers(p_provider uuid, p_service uuid, p_country uuid, p_tiers jsonb, p_enable_new boolean DEFAULT true)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a_id uuid; dr numeric := public.default_ratio(); pm public.pricing_method; m numeric;
  live jsonb; l jsonb; unmatched jsonb := '[]'::jsonb; keep uuid[] := '{}'; left_ids uuid[];
  tid uuid; k text; c numeric; q bigint; nk text; i int;
BEGIN
  live := coalesce((SELECT jsonb_agg(jsonb_build_object('key', x.key, 'cost', x.cost, 'cnt', x.count) ORDER BY x.cost)
                    FROM jsonb_to_recordset(coalesce(p_tiers, '[]'::jsonb)) AS x(key text, cost numeric, count bigint)
                    WHERE x.cost > 0 AND x.count > 0), '[]'::jsonb);

  SELECT id INTO a_id FROM public.service_country_availability WHERE service_id = p_service AND country_id = p_country AND provider_id = p_provider;
  IF a_id IS NULL THEN
    IF jsonb_array_length(live) = 0 THEN RETURN 0; END IF;     -- never create a country that has no numbers
    m := (live -> 0 ->> 'cost')::numeric;
    SELECT pricing_method INTO pm FROM public.pricing_rules WHERE scope = 'global' AND is_active LIMIT 1;
    INSERT INTO public.service_country_availability (service_id, country_id, provider_id, wholesale_cost, retail_price, currency, is_available, pricing_method, manual_price_override, is_demo, is_enabled)
    VALUES (p_service, p_country, p_provider, m, public.tier_retail(m, dr), 'USD', true, coalesce(pm, 'percentage_markup'), false, false, true)
    RETURNING id INTO a_id;
  END IF;

  -- 1) match by key (provider-id / default tiers) or by exact cost (price-keyed tiers)
  FOR l IN SELECT value FROM jsonb_array_elements(live) LOOP
    k := l ->> 'key'; c := (l ->> 'cost')::numeric; q := (l ->> 'cnt')::bigint; tid := NULL;
    IF k LIKE 'p:%' THEN
      SELECT t.id INTO tid FROM public.service_country_tiers t
      WHERE t.availability_id = a_id AND round(t.wholesale_cost, 4) = round(c, 4) AND NOT (t.id = ANY (keep)) ORDER BY t.in_stock DESC LIMIT 1;
    ELSE
      SELECT t.id INTO tid FROM public.service_country_tiers t WHERE t.availability_id = a_id AND t.tier_key = k AND NOT (t.id = ANY (keep));
    END IF;
    IF tid IS NOT NULL THEN
      UPDATE public.service_country_tiers SET wholesale_cost = c, quantity = q, in_stock = true, retail_price = public.tier_retail(c, ratio), updated_at = now() WHERE id = tid;
      keep := keep || tid;
    ELSE
      unmatched := unmatched || jsonb_build_array(l);
    END IF;
  END LOOP;

  -- 2) the provider moved prices: if the number of leftover tiers is identical, pair them by price rank so ratios/ticks survive
  IF jsonb_array_length(unmatched) > 0 THEN
    SELECT array_agg(t.id ORDER BY t.wholesale_cost) INTO left_ids FROM public.service_country_tiers t
    WHERE t.availability_id = a_id AND t.in_stock AND NOT (t.id = ANY (keep));
    IF coalesce(array_length(left_ids, 1), 0) = jsonb_array_length(unmatched)
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(unmatched) e WHERE (e.value ->> 'key') NOT LIKE 'p:%') THEN
      FOR i IN 1 .. array_length(left_ids, 1) LOOP
        l := unmatched -> (i - 1);
        UPDATE public.service_country_tiers SET wholesale_cost = (l ->> 'cost')::numeric, quantity = (l ->> 'cnt')::bigint, in_stock = true,
               retail_price = public.tier_retail((l ->> 'cost')::numeric, ratio), updated_at = now() WHERE id = left_ids[i];
        keep := keep || left_ids[i];
      END LOOP;
      unmatched := '[]'::jsonb;
    END IF;
  END IF;

  -- 3) genuinely new tiers
  FOR l IN SELECT value FROM jsonb_array_elements(unmatched) LOOP
    nk := l ->> 'key'; c := (l ->> 'cost')::numeric; q := (l ->> 'cnt')::bigint;
    IF EXISTS (SELECT 1 FROM public.service_country_tiers WHERE availability_id = a_id AND tier_key = nk) THEN
      nk := nk || '#' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    END IF;
    INSERT INTO public.service_country_tiers (availability_id, tier_key, wholesale_cost, quantity, ratio, retail_price, is_enabled, in_stock)
    VALUES (a_id, nk, c, q, dr, public.tier_retail(c, dr), p_enable_new, true) RETURNING id INTO tid;
    keep := keep || tid;
  END LOOP;

  -- 4) everything the provider no longer lists is out of stock (kept, not deleted)
  UPDATE public.service_country_tiers SET in_stock = false, quantity = 0, updated_at = now()
  WHERE availability_id = a_id AND in_stock AND NOT (id = ANY (keep));

  PERFORM public._refresh_availability(a_id);
  RETURN jsonb_array_length(live);
END $$;

CREATE OR REPLACE FUNCTION public.quote_tiers(p_service uuid, p_country uuid)
RETURNS TABLE(provider_id uuid, tier_key text, cost numeric, quantity bigint, retail numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.provider_id, t.tier_key, t.wholesale_cost, t.quantity, t.retail_price
  FROM public.service_country_availability a
  JOIN public.service_country_tiers t ON t.availability_id = a.id AND t.is_enabled AND t.in_stock AND t.quantity > 0
  JOIN public.services s ON s.id = a.service_id AND s.is_active AND NOT s.is_archived
  JOIN public.countries c ON c.id = a.country_id AND c.is_active
  WHERE a.service_id = p_service AND a.country_id = p_country AND a.is_enabled
  ORDER BY t.retail_price;
$$;

REVOKE ALL ON FUNCTION public.upsert_tiers(uuid,uuid,uuid,jsonb,boolean), public.quote_tiers(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_tiers(uuid,uuid,uuid,jsonb,boolean), public.quote_tiers(uuid,uuid) TO service_role;
