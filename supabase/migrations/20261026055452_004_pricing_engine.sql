/*
# Pricing Engine Functions — Phase 2

## Purpose
Server-side business logic for automatic wholesale-to-retail price
synchronization. These functions implement the mandatory pricing automation:
rule resolution by precedence, price calculation by method, idempotent updates,
manual price protection, and minimum margin enforcement.

## Functions

### calculate_retail_price
Pure function that computes a retail price from a wholesale cost using the
specified pricing method. Returns numeric. For 'manual' method returns NULL.
Rounds to the specified increment (default 0.01).

### resolve_pricing_rule
Returns the single highest-precedence active pricing rule for a given
service/country/provider/category context. Precedence (highest first):
1. service_country (requires service_id + country_id match)
2. service (requires service_id match)
3. country (requires country_id match)
4. category (requires category_id match)
5. provider (requires provider_id match)
6. global (no filters)

### apply_price_update
The core idempotent price sync function. Steps:
1. Lock the availability row with FOR UPDATE.
2. If new cost == current cost → return 'skipped' (idempotency guard).
3. Resolve applicable pricing rule.
4. If manual_price_override is true: update cost only, flag for review,
   do NOT change retail price.
5. Calculate new retail price from the resolved rule.
6. Validate minimum margin and minimum price. If violated, set status to
   'flagged' and do not publish the unsafe price.
7. Update wholesale_cost, retail_price, timestamps atomically.
8. Insert price_history record with full before/after snapshot.
9. Return a result record with status and details.

### compute_margin_pct
Helper: returns the gross margin percentage given cost and price.
margin_pct = (price - cost) / price * 100

## Security
- All functions SECURITY DEFINER, search_path = public.
- EXECUTE revoked from PUBLIC and anon.
- GRANT EXECUTE to authenticated.
- apply_price_update intended to be called from admin edge functions or
  admin-authenticated sessions. The function itself does not re-check is_admin
  (that is the caller's responsibility), but it is not reachable by anon.

## Idempotency Guarantees
- Equal cost → 'skipped', no history row.
- The function is safe to call repeatedly with the same new_cost.

## Manual Price Protection
- When manual_price_override = true:
  - wholesale_cost is updated (admin needs to see real cost).
  - retail_price is NOT changed.
  - price_history status = 'flagged', error_details explains the manual policy.
  - This is the spec requirement: "Do not silently overwrite manually
    configured retail prices."

## Minimum Margin Protection
- If the calculated retail price yields a margin below min_margin_pct (from
  the availability row or the resolved rule), the update is 'flagged' and
  the retail price is NOT published. The admin is notified via the flagged
  status in price_history.
- If min_price is set and the calculated price is below it, same treatment.
*/

-- ===== compute_margin_pct =====
CREATE OR REPLACE FUNCTION public.compute_margin_pct(p_cost numeric, p_price numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_price IS NULL OR p_price = 0 THEN NULL
    ELSE round(((p_price - p_cost) / p_price * 100)::numeric, 2)
  END;
$$;

-- ===== calculate_retail_price =====
CREATE OR REPLACE FUNCTION public.calculate_retail_price(
  p_wholesale_cost numeric,
  p_method pricing_method,
  p_markup_pct numeric DEFAULT 50,
  p_fixed_markup numeric DEFAULT 0,
  p_target_margin_pct numeric DEFAULT 40,
  p_round_to numeric DEFAULT 0.01
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_price numeric;
BEGIN
  IF p_wholesale_cost IS NULL OR p_wholesale_cost < 0 THEN
    RETURN NULL;
  END IF;

  CASE p_method
    WHEN 'percentage_markup' THEN
      v_price := p_wholesale_cost * (1 + COALESCE(p_markup_pct, 0) / 100.0);
    WHEN 'fixed_markup' THEN
      v_price := p_wholesale_cost + COALESCE(p_fixed_markup, 0);
    WHEN 'target_margin' THEN
      IF COALESCE(p_target_margin_pct, 0) >= 100 OR COALESCE(p_target_margin_pct, 0) <= 0 THEN
        RETURN NULL;
      END IF;
      v_price := p_wholesale_cost / (1 - COALESCE(p_target_margin_pct, 0) / 100.0);
    WHEN 'manual' THEN
      RETURN NULL;
    WHEN 'min_profit_protection' THEN
      v_price := p_wholesale_cost * (1 + COALESCE(p_markup_pct, 0) / 100.0);
    ELSE
      RETURN NULL;
  END CASE;

  IF p_round_to IS NOT NULL AND p_round_to > 0 THEN
    v_price := ceil(v_price / p_round_to) * p_round_to;
  END IF;

  RETURN round(v_price, 4);
END;
$$;

-- ===== resolve_pricing_rule =====
CREATE OR REPLACE FUNCTION public.resolve_pricing_rule(
  p_service_id uuid,
  p_country_id uuid,
  p_provider_id uuid,
  p_category_id uuid
)
RETURNS public.pricing_rules
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule public.pricing_rules;
BEGIN
  -- Try scopes from most specific to least specific
  -- 1. service_country
  SELECT * INTO v_rule FROM public.pricing_rules
  WHERE scope = 'service_country' AND is_active = true
    AND service_id = p_service_id AND country_id = p_country_id
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN v_rule; END IF;

  -- 2. service
  SELECT * INTO v_rule FROM public.pricing_rules
  WHERE scope = 'service' AND is_active = true
    AND service_id = p_service_id
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN v_rule; END IF;

  -- 3. country
  SELECT * INTO v_rule FROM public.pricing_rules
  WHERE scope = 'country' AND is_active = true
    AND country_id = p_country_id
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN v_rule; END IF;

  -- 4. category
  SELECT * INTO v_rule FROM public.pricing_rules
  WHERE scope = 'category' AND is_active = true
    AND category_id = p_category_id
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN v_rule; END IF;

  -- 5. provider
  SELECT * INTO v_rule FROM public.pricing_rules
  WHERE scope = 'provider' AND is_active = true
    AND provider_id = p_provider_id
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN v_rule; END IF;

  -- 6. global
  SELECT * INTO v_rule FROM public.pricing_rules
  WHERE scope = 'global' AND is_active = true
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN v_rule; END IF;

  RETURN NULL;
END;
$$;

-- ===== apply_price_update =====
CREATE OR REPLACE FUNCTION public.apply_price_update(
  p_availability_id uuid,
  p_new_cost numeric,
  p_source text DEFAULT 'sync_job',
  p_sync_job_id uuid DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL
)
RETURNS TABLE(
  status text,
  previous_cost numeric,
  new_cost numeric,
  previous_price numeric,
  new_price numeric,
  applied_method pricing_method,
  applied_rule_id uuid,
  margin_pct numeric,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sca public.service_country_availability;
  v_rule public.pricing_rules;
  v_service public.services;
  v_new_price numeric;
  v_prev_margin numeric;
  v_new_margin numeric;
  v_final_status price_update_status := 'applied';
  v_msg text := '';
  v_effective_method pricing_method;
  v_rule_id uuid;
BEGIN
  -- Lock the row to prevent concurrent updates
  SELECT * INTO v_sca FROM public.service_country_availability
  WHERE id = p_availability_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'error'::text, NULL::numeric, NULL::numeric,
      NULL::numeric, NULL::numeric, NULL::pricing_method, NULL::uuid,
      NULL::numeric, 'Availability record not found';
    RETURN;
  END IF;

  -- Idempotency: if cost hasn't changed, skip
  IF v_sca.wholesale_cost = p_new_cost THEN
    RETURN QUERY SELECT 'skipped'::text, v_sca.wholesale_cost, p_new_cost,
      v_sca.retail_price, v_sca.retail_price, v_sca.pricing_method, NULL::uuid,
      public.compute_margin_pct(v_sca.wholesale_cost, v_sca.retail_price),
      'Cost unchanged — no update applied (idempotency guard)';
    RETURN;
  END IF;

  -- Validate new cost
  IF p_new_cost IS NULL OR p_new_cost < 0 THEN
    RETURN QUERY SELECT 'error'::text, v_sca.wholesale_cost, p_new_cost,
      v_sca.retail_price, NULL::numeric, NULL::pricing_method, NULL::uuid,
      NULL::numeric, 'Invalid cost: cannot be null or negative';
    RETURN;
  END IF;

  -- Load service for category_id
  SELECT * INTO v_service FROM public.services WHERE id = v_sca.service_id;

  -- Resolve pricing rule
  SELECT * INTO v_rule FROM public.resolve_pricing_rule(
    v_sca.service_id, v_sca.country_id, v_sca.provider_id, v_service.category_id
  );

  v_prev_margin := public.compute_margin_pct(v_sca.wholesale_cost, v_sca.retail_price);

  -- Handle manual price override
  IF v_sca.manual_price_override = true THEN
    -- Update cost only, do NOT change retail price
    UPDATE public.service_country_availability
    SET wholesale_cost = p_new_cost,
        last_cost_update = now()
    WHERE id = p_availability_id;

    INSERT INTO public.price_history (
      service_country_availability_id, service_id, country_id, provider_id,
      previous_wholesale_cost, new_wholesale_cost,
      previous_retail_price, new_retail_price, currency,
      applied_pricing_method, applied_pricing_rule_id,
      previous_margin_pct, new_margin_pct,
      update_source, sync_job_id, status, error_details
    ) VALUES (
      p_availability_id, v_sca.service_id, v_sca.country_id, v_sca.provider_id,
      v_sca.wholesale_cost, p_new_cost,
      v_sca.retail_price, v_sca.retail_price, v_sca.currency,
      'manual', NULL,
      v_prev_margin, public.compute_margin_pct(p_new_cost, v_sca.retail_price),
      p_source, p_sync_job_id, 'flagged',
      'Manual price override active — retail price not changed. Cost updated for admin review.'
    );

    RETURN QUERY SELECT 'flagged'::text, v_sca.wholesale_cost, p_new_cost,
      v_sca.retail_price, v_sca.retail_price, 'manual'::pricing_method, NULL::uuid,
      public.compute_margin_pct(p_new_cost, v_sca.retail_price),
      'Manual price override: cost updated, retail price preserved for review';
    RETURN;
  END IF;

  -- Determine effective method and calculate price
  IF v_rule IS NOT NULL THEN
    v_effective_method := v_rule.pricing_method;
    v_rule_id := v_rule.id;
    v_new_price := public.calculate_retail_price(
      p_new_cost,
      v_rule.pricing_method,
      v_rule.markup_percentage,
      v_rule.fixed_markup,
      v_rule.target_margin_percentage,
      v_rule.round_to
    );
  ELSE
    -- Fall back to the availability row's own pricing method
    v_effective_method := v_sca.pricing_method;
    v_rule_id := NULL;
    v_new_price := public.calculate_retail_price(
      p_new_cost,
      v_sca.pricing_method,
      50, -- default 50% markup if no rule
      0,
      40,
      0.01
    );
  END IF;

  IF v_new_price IS NULL THEN
    -- Could not calculate (e.g. manual method without override flag)
    INSERT INTO public.price_history (
      service_country_availability_id, service_id, country_id, provider_id,
      previous_wholesale_cost, new_wholesale_cost,
      previous_retail_price, new_retail_price, currency,
      applied_pricing_method, applied_pricing_rule_id,
      previous_margin_pct, new_margin_pct,
      update_source, sync_job_id, status, error_details
    ) VALUES (
      p_availability_id, v_sca.service_id, v_sca.country_id, v_sca.provider_id,
      v_sca.wholesale_cost, p_new_cost,
      v_sca.retail_price, NULL, v_sca.currency,
      v_effective_method, v_rule_id,
      v_prev_margin, NULL,
      p_source, p_sync_job_id, 'error',
      'Could not calculate retail price from resolved pricing method'
    );

    RETURN QUERY SELECT 'error'::text, v_sca.wholesale_cost, p_new_cost,
      v_sca.retail_price, NULL::numeric, v_effective_method, v_rule_id,
      NULL::numeric, 'Price calculation returned null';
    RETURN;
  END IF;

  v_new_margin := public.compute_margin_pct(p_new_cost, v_new_price);

  -- Minimum margin protection
  DECLARE
    v_min_margin numeric := COALESCE(v_sca.min_margin_pct, v_rule.min_margin_pct);
    v_min_price numeric := COALESCE(v_sca.min_price, v_rule.min_price);
  BEGIN
    IF v_min_margin IS NOT NULL AND v_new_margin IS NOT NULL AND v_new_margin < v_min_margin THEN
      v_final_status := 'flagged';
      v_msg := 'Calculated margin ' || v_new_margin || '% is below minimum ' || v_min_margin || '%';
    ELSIF v_min_price IS NOT NULL AND v_new_price < v_min_price THEN
      v_final_status := 'flagged';
      v_msg := 'Calculated price ' || v_new_price || ' is below minimum ' || v_min_price;
    END IF;
  END;

  -- Apply the update if not flagged
  IF v_final_status = 'applied' THEN
    UPDATE public.service_country_availability
    SET wholesale_cost = p_new_cost,
        retail_price = v_new_price,
        pricing_method = v_effective_method,
        last_cost_update = now(),
        last_price_sync = now()
    WHERE id = p_availability_id;

    v_msg := 'Price updated successfully';
  ELSE
    -- Still update the cost so admin sees the real cost, but don't publish the unsafe price
    UPDATE public.service_country_availability
    SET wholesale_cost = p_new_cost,
        last_cost_update = now()
    WHERE id = p_availability_id;
  END IF;

  -- Record price history
  INSERT INTO public.price_history (
    service_country_availability_id, service_id, country_id, provider_id,
    previous_wholesale_cost, new_wholesale_cost,
    previous_retail_price, new_retail_price, currency,
    applied_pricing_method, applied_pricing_rule_id,
    previous_margin_pct, new_margin_pct,
    update_source, sync_job_id, status, error_details
  ) VALUES (
    p_availability_id, v_sca.service_id, v_sca.country_id, v_sca.provider_id,
    v_sca.wholesale_cost, p_new_cost,
    v_sca.retail_price,
    CASE WHEN v_final_status = 'applied' THEN v_new_price ELSE v_sca.retail_price END,
    v_sca.currency,
    v_effective_method, v_rule_id,
    v_prev_margin, v_new_margin,
    p_source, p_sync_job_id, v_final_status, v_msg
  );

  RETURN QUERY SELECT v_final_status::text, v_sca.wholesale_cost, p_new_cost,
    v_sca.retail_price,
    CASE WHEN v_final_status = 'applied' THEN v_new_price ELSE v_sca.retail_price END,
    v_effective_method, v_rule_id, v_new_margin, v_msg;
  RETURN;
END;
$$;

-- Revoke and grant EXECUTE
REVOKE EXECUTE ON FUNCTION public.calculate_retail_price(numeric, pricing_method, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_retail_price(numeric, pricing_method, numeric, numeric, numeric, numeric) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.resolve_pricing_rule(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_pricing_rule(uuid, uuid, uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.apply_price_update(uuid, numeric, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_price_update(uuid, numeric, text, uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.compute_margin_pct(numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_margin_pct(numeric, numeric) TO authenticated;
