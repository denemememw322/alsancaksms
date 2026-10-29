-- Rollback for 20261029080000_009_harden_wallet_and_price_rpc.sql
-- Restores the original (insecure) state. Only use if the migration breaks the admin UI.
DROP FUNCTION IF EXISTS public.approve_deposit(uuid, uuid);
DROP FUNCTION IF EXISTS public.reject_deposit(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.admin_adjust_balance(uuid, numeric, text, uuid, text);
ALTER FUNCTION public._approve_deposit_impl(uuid, uuid) RENAME TO approve_deposit;
ALTER FUNCTION public._reject_deposit_impl(uuid, uuid, text) RENAME TO reject_deposit;
ALTER FUNCTION public._admin_adjust_balance_impl(uuid, numeric, text, uuid, text) RENAME TO admin_adjust_balance;
GRANT EXECUTE ON FUNCTION public.approve_deposit(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_deposit(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_balance(uuid, numeric, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_wallet(uuid, numeric, wallet_transaction_type, text, uuid, text, text, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.debit_wallet(uuid, numeric, text, uuid, text, text, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_price_update(uuid, numeric, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO PUBLIC, anon, authenticated;
ALTER FUNCTION public.touch_updated_at() RESET search_path;
ALTER FUNCTION public.compute_margin_pct(numeric, numeric) RESET search_path;
ALTER FUNCTION public.calculate_retail_price(numeric, pricing_method, numeric, numeric, numeric, numeric) RESET search_path;
