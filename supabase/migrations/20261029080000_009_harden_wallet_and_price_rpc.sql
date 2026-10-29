/*
  # 009 - Harden wallet / pricing RPC authorization

  Problem (verified against live DB):
  - credit_wallet / debit_wallet / apply_price_update are SECURITY DEFINER and
    executable by any signed-in user via /rest/v1/rpc -> anyone could credit
    their own wallet or rewrite prices.
  - approve_deposit / reject_deposit / admin_adjust_balance trusted the
    caller-supplied p_admin_id instead of the real session (auth.uid()).

  Fix (no function bodies are modified, no data is touched):
  1. Internal money/price functions: EXECUTE only for service_role (and owner).
  2. Admin RPCs: original bodies renamed to _impl, EXECUTE removed from
     authenticated; thin public wrappers with the SAME signature verify
     p_admin_id = auth.uid() AND is_admin(auth.uid()) before delegating.
  3. handle_new_user (trigger fn) no longer callable via RPC.
  4. Fixed search_path on remaining mutable-path functions.

  Rollback: supabase/rollbacks/009_rollback.sql
*/

-- 1. Internal functions: service_role only
REVOKE EXECUTE ON FUNCTION public.credit_wallet(uuid, numeric, wallet_transaction_type, text, uuid, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.debit_wallet(uuid, numeric, text, uuid, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_price_update(uuid, numeric, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_wallet(uuid, numeric, wallet_transaction_type, text, uuid, text, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_wallet(uuid, numeric, text, uuid, text, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_price_update(uuid, numeric, text, uuid, uuid) TO service_role;

-- 2. Admin RPCs: rename implementations, add auth.uid()-verifying wrappers
ALTER FUNCTION public.approve_deposit(uuid, uuid) RENAME TO _approve_deposit_impl;
ALTER FUNCTION public.reject_deposit(uuid, uuid, text) RENAME TO _reject_deposit_impl;
ALTER FUNCTION public.admin_adjust_balance(uuid, numeric, text, uuid, text) RENAME TO _admin_adjust_balance_impl;

REVOKE EXECUTE ON FUNCTION public._approve_deposit_impl(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._reject_deposit_impl(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._admin_adjust_balance_impl(uuid, numeric, text, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.approve_deposit(p_deposit_id uuid, p_admin_id uuid)
RETURNS TABLE(status text, transaction_id uuid, new_balance numeric, message text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR p_admin_id IS DISTINCT FROM auth.uid() OR NOT public.is_admin(auth.uid()) THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::uuid, NULL::numeric, 'Only administrators can approve deposits'::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public._approve_deposit_impl(p_deposit_id, auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_deposit(p_deposit_id uuid, p_admin_id uuid, p_reason text)
RETURNS TABLE(status text, message text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR p_admin_id IS DISTINCT FROM auth.uid() OR NOT public.is_admin(auth.uid()) THEN
    RETURN QUERY SELECT 'unauthorized'::text, 'Only administrators can reject deposits'::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public._reject_deposit_impl(p_deposit_id, auth.uid(), p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_balance(p_user_id uuid, p_amount numeric, p_reason text, p_admin_id uuid, p_idempotency_key text)
RETURNS TABLE(status text, transaction_id uuid, new_balance numeric, message text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR p_admin_id IS DISTINCT FROM auth.uid() OR NOT public.is_admin(auth.uid()) THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::uuid, NULL::numeric, 'Only administrators can adjust balances'::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public._admin_adjust_balance_impl(p_user_id, p_amount, p_reason, auth.uid(), p_idempotency_key);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_deposit(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_deposit(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_balance(uuid, numeric, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_deposit(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_deposit(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_balance(uuid, numeric, text, uuid, text) TO authenticated, service_role;

-- 3. Trigger function must not be an RPC endpoint
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 4. Immutable search_path
ALTER FUNCTION public.touch_updated_at() SET search_path = public;
ALTER FUNCTION public.compute_margin_pct(numeric, numeric) SET search_path = public;
ALTER FUNCTION public.calculate_retail_price(numeric, pricing_method, numeric, numeric, numeric, numeric) SET search_path = public;
