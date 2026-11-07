/*
  # 017 - Search attempts, no "failed" orders, customer-safe order columns
  - orders.search_attempts / last_attempt_at / provider_meta; new statuses `searching` and `no_number`
    (a search that never produced a number is stored as no_number and is never shown to customers)
  - state machine + refund updated; reap_searching_orders() returns the funds of abandoned searches (cron, every minute)
  - SECURITY: customers can no longer read provider_cost / provider ids on orders (column grants); admins use admin_orders
  - catalog_service_countries now also returns total_qty
  Rollback: supabase/rollbacks/017_rollback.sql
*/
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS search_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS provider_meta jsonb;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending','searching','active','received','completed','cancelled','failed','needs_review','no_number'));
UPDATE public.orders SET status = 'no_number' WHERE status = 'failed';

CREATE OR REPLACE FUNCTION public.order_set_status(p_order uuid, p_to text, p_note text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.orders%ROWTYPE; ok boolean;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF o.status = p_to THEN RETURN o.status; END IF;
  ok := CASE o.status
    WHEN 'pending'      THEN p_to IN ('searching','active','no_number','needs_review')
    WHEN 'searching'    THEN p_to IN ('active','no_number','needs_review')
    WHEN 'active'       THEN p_to IN ('received','completed','cancelled','needs_review')
    WHEN 'received'     THEN p_to IN ('completed','active')
    WHEN 'needs_review' THEN p_to IN ('active','received','no_number','cancelled')
    ELSE false END;
  IF NOT ok THEN RAISE EXCEPTION 'invalid order transition % -> %', o.status, p_to; END IF;
  UPDATE public.orders SET status = p_to, updated_at = now(),
         completed_at = CASE WHEN p_to IN ('completed','cancelled','no_number','failed') THEN now() ELSE completed_at END
   WHERE id = p_order;
  INSERT INTO public.order_events (order_id, from_status, to_status, note) VALUES (p_order, o.status, p_to, left(p_note, 500));
  RETURN p_to;
END $$;

CREATE OR REPLACE FUNCTION public.order_refund(p_order uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.orders%ROWTYPE; v_charge uuid; r record;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF o.refunded_at IS NOT NULL THEN RETURN 'already_refunded'; END IF;
  IF o.status NOT IN ('cancelled','failed','no_number') THEN RAISE EXCEPTION 'order is not refundable in status %', o.status; END IF;
  SELECT id INTO v_charge FROM public.wallet_transactions WHERE idempotency_key = 'order:' || o.id::text LIMIT 1;
  IF v_charge IS NULL THEN RETURN 'nothing_to_refund'; END IF;
  SELECT * INTO r FROM public.credit_wallet(o.user_id, o.retail_price, 'refund', 'order', o.id, 'refund:' || o.id::text, left(p_reason, 200), '{}'::jsonb, NULL);
  IF r.status IN ('error','insufficient_funds') THEN RAISE EXCEPTION 'refund failed: %', r.status; END IF;
  UPDATE public.orders SET refunded_at = now(), refund_txn_id = r.transaction_id, updated_at = now() WHERE id = p_order;
  INSERT INTO public.order_events (order_id, from_status, to_status, note) VALUES (p_order, o.status, o.status, 'refunded: ' || left(p_reason, 200));
  RETURN 'refunded';
END $$;

CREATE OR REPLACE FUNCTION public.reap_searching_orders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT id FROM public.orders WHERE status IN ('searching','pending') AND coalesce(last_attempt_at, created_at) < now() - interval '90 seconds' LOOP
    BEGIN
      PERFORM public.order_set_status(r.id, 'no_number', 'search abandoned');
      PERFORM public.order_refund(r.id, 'search abandoned');
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN CONTINUE;
    END;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.reap_searching_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_searching_orders() TO service_role;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'reap-searching-orders';
SELECT cron.schedule('reap-searching-orders', '* * * * *', 'SELECT public.reap_searching_orders();');

REVOKE SELECT ON public.orders FROM authenticated;
GRANT SELECT (id, user_id, service_id, country_id, service_name, country_name, status, retail_price, currency, phone_number, sms_code, sms_text, refunded_at, error_message, expires_at, cancel_available_at, search_attempts, created_at, updated_at, completed_at) ON public.orders TO authenticated;
CREATE OR REPLACE VIEW public.admin_orders AS SELECT o.* FROM public.orders o WHERE public.current_user_is_admin();
REVOKE ALL ON public.admin_orders FROM PUBLIC, anon;
GRANT SELECT ON public.admin_orders TO authenticated;

DROP FUNCTION IF EXISTS public.catalog_service_countries(uuid);
CREATE FUNCTION public.catalog_service_countries(p_service_id uuid)
RETURNS TABLE(country_id uuid, name text, iso_code text, flag_emoji text, min_price numeric, total_qty bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.name, c.iso_code, c.flag_emoji, min(t.retail_price), sum(t.quantity)::bigint
  FROM public.service_country_availability a
  JOIN public.service_country_tiers t ON t.availability_id = a.id AND t.is_enabled AND t.in_stock
  JOIN public.countries c ON c.id = a.country_id AND c.is_active
  JOIN public.services s ON s.id = a.service_id AND s.is_active AND NOT s.is_archived
  WHERE a.service_id = p_service_id AND a.is_enabled
  GROUP BY c.id ORDER BY min(t.retail_price), c.name;
$$;
REVOKE ALL ON FUNCTION public.catalog_service_countries(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalog_service_countries(uuid) TO anon, authenticated, service_role;
