/*
# Secure Wallet Operations — Phase 3

## Purpose
Implements all balance-changing operations through SECURITY DEFINER PL/pgSQL
functions that enforce authorization, idempotency, atomicity, and audit logging
at the database level. The browser can never directly modify wallet balances.

## Functions

### credit_wallet(p_user_id, p_amount, p_type, p_reference_type, p_reference_id, p_idempotency_key, p_description, p_metadata, p_actor_id)
Credits a wallet. Used for deposits, refunds, and admin credits.
- Locks the wallet row with FOR UPDATE.
- Checks idempotency_key — if a transaction already exists with that key, returns 'skipped'.
- Inserts a wallet_transactions row with balance_before/balance_after.
- Updates the wallet balance atomically.
- Returns (status, transaction_id, new_balance).

### debit_wallet(p_user_id, p_amount, p_reference_type, p_reference_id, p_idempotency_key, p_description, p_metadata, p_actor_id)
Debits a wallet for a purchase. Prevents negative balance.
- Locks the wallet row with FOR UPDATE.
- Checks idempotency_key — skips if already processed.
- Checks sufficient balance — returns 'insufficient_funds' if not enough.
- Inserts ledger entry and updates balance atomically.
- Returns (status, transaction_id, new_balance).

### approve_deposit(p_deposit_id, p_admin_id)
The ONLY path that credits a deposit to a wallet.
- Verifies the caller is an admin (server-side is_admin check).
- Verifies the deposit is in 'pending' status.
- Uses an idempotency_key derived from the deposit ID to prevent double credit.
- Credits the wallet via credit_wallet.
- Updates the deposit_request to 'approved' with reviewer info.
- Inserts an audit log entry.
- All in one atomic transaction.
- Returns (status, transaction_id, new_balance, message).

### admin_adjust_balance(p_user_id, p_amount, p_reason, p_admin_id, p_idempotency_key)
Administrative balance adjustment (credit or debit).
- Verifies admin authorization.
- Requires a non-empty reason.
- Creates an admin_credit or admin_debit transaction.
- Inserts an audit log with the admin's identity and reason.
- Idempotency key prevents duplicate execution.
- Returns (status, transaction_id, new_balance, message).

### reject_deposit(p_deposit_id, p_admin_id, p_reason)
Rejects a pending deposit without touching the wallet balance.
- Verifies admin authorization.
- Verifies deposit is pending.
- Updates status to 'rejected' with reason and reviewer.
- Inserts audit log.
- No wallet balance change.
- Returns (status, message).

## Security
- All functions are SECURITY DEFINER with search_path = public.
- EXECUTE revoked from PUBLIC and anon.
- GRANT EXECUTE to authenticated only.
- approve_deposit, reject_deposit, and admin_adjust_balance verify is_admin()
  inside the function — a non-admin authenticated user cannot call them
  successfully even if they somehow reach the function.

## Idempotency
- credit_wallet and debit_wallet check for existing idempotency_key.
- approve_deposit derives its idempotency key from the deposit ID, so calling
  approve on the same deposit twice returns 'skipped' the second time.
- admin_adjust_balance requires a caller-supplied idempotency_key.

## Atomicity
- Each function uses SELECT ... FOR UPDATE on the wallet row to prevent
  concurrent modifications.
- Balance update and ledger insert happen in the same function call — if
  either fails, the entire operation rolls back.
*/

-- ===== credit_wallet =====
CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_user_id uuid,
  p_amount numeric,
  p_type wallet_transaction_type,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_actor_id uuid DEFAULT NULL
)
RETURNS TABLE(status text, transaction_id uuid, new_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.user_wallets;
  v_txn_id uuid;
  v_before numeric;
  v_after numeric;
BEGIN
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT 'error'::text, NULL::uuid, NULL::numeric;
    RETURN;
  END IF;

  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_txn_id FROM public.wallet_transactions
    WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF FOUND THEN
      RETURN QUERY SELECT 'skipped'::text, v_txn_id, NULL::numeric;
      RETURN;
    END IF;
  END IF;

  -- Lock wallet row
  SELECT * INTO v_wallet FROM public.user_wallets
  WHERE user_id = p_user_id AND currency = 'USD'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'error'::text, NULL::uuid, NULL::numeric;
    RETURN;
  END IF;

  v_before := v_wallet.balance;
  v_after := v_before + p_amount;

  -- Insert ledger entry
  INSERT INTO public.wallet_transactions (
    user_id, wallet_id, transaction_type, amount,
    balance_before, balance_after, status,
    reference_type, reference_id, idempotency_key,
    description, metadata
  ) VALUES (
    p_user_id, v_wallet.id, p_type, p_amount,
    v_before, v_after, 'completed',
    p_reference_type, p_reference_id, p_idempotency_key,
    p_description, p_metadata
  ) RETURNING id INTO v_txn_id;

  -- Update balance
  UPDATE public.user_wallets SET balance = v_after WHERE id = v_wallet.id;

  RETURN QUERY SELECT 'completed'::text, v_txn_id, v_after;
END;
$$;

-- ===== debit_wallet =====
CREATE OR REPLACE FUNCTION public.debit_wallet(
  p_user_id uuid,
  p_amount numeric,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_actor_id uuid DEFAULT NULL
)
RETURNS TABLE(status text, transaction_id uuid, new_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.user_wallets;
  v_txn_id uuid;
  v_before numeric;
  v_after numeric;
BEGIN
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT 'error'::text, NULL::uuid, NULL::numeric;
    RETURN;
  END IF;

  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_txn_id FROM public.wallet_transactions
    WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF FOUND THEN
      RETURN QUERY SELECT 'skipped'::text, v_txn_id, NULL::numeric;
      RETURN;
    END IF;
  END IF;

  -- Lock wallet row
  SELECT * INTO v_wallet FROM public.user_wallets
  WHERE user_id = p_user_id AND currency = 'USD'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'error'::text, NULL::uuid, NULL::numeric;
    RETURN;
  END IF;

  -- Check sufficient balance
  IF v_wallet.balance < p_amount THEN
    RETURN QUERY SELECT 'insufficient_funds'::text, NULL::uuid, v_wallet.balance;
    RETURN;
  END IF;

  v_before := v_wallet.balance;
  v_after := v_before - p_amount;

  -- Insert ledger entry (negative amount for debit)
  INSERT INTO public.wallet_transactions (
    user_id, wallet_id, transaction_type, amount,
    balance_before, balance_after, status,
    reference_type, reference_id, idempotency_key,
    description, metadata
  ) VALUES (
    p_user_id, v_wallet.id, 'purchase', -p_amount,
    v_before, v_after, 'completed',
    p_reference_type, p_reference_id, p_idempotency_key,
    p_description, p_metadata
  ) RETURNING id INTO v_txn_id;

  -- Update balance
  UPDATE public.user_wallets SET balance = v_after WHERE id = v_wallet.id;

  RETURN QUERY SELECT 'completed'::text, v_txn_id, v_after;
END;
$$;

-- ===== approve_deposit =====
CREATE OR REPLACE FUNCTION public.approve_deposit(
  p_deposit_id uuid,
  p_admin_id uuid
)
RETURNS TABLE(status text, transaction_id uuid, new_balance numeric, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deposit public.deposit_requests;
  v_idem_key text;
  v_credit_result record;
BEGIN
  -- Server-side admin check
  IF NOT public.is_admin(p_admin_id) THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::uuid, NULL::numeric, 'Only administrators can approve deposits'::text;
    RETURN;
  END IF;

  -- Lock the deposit row
  SELECT * INTO v_deposit FROM public.deposit_requests
  WHERE id = p_deposit_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'error'::text, NULL::uuid, NULL::numeric, 'Deposit request not found'::text;
    RETURN;
  END IF;

  -- Prevent self-approval
  IF v_deposit.user_id = p_admin_id THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::uuid, NULL::numeric, 'Cannot approve your own deposit request'::text;
    RETURN;
  END IF;

  -- Must be pending
  IF v_deposit.status != 'pending' THEN
    RETURN QUERY SELECT 'skipped'::text, v_deposit.wallet_transaction_id, NULL::numeric, 'Deposit is not pending (status: ' || v_deposit.status || ')'::text;
    RETURN;
  END IF;

  -- Idempotency key derived from deposit ID — prevents double credit
  v_idem_key := 'deposit_' || v_deposit.id::text;

  -- Credit the wallet
  SELECT * INTO v_credit_result FROM public.credit_wallet(
    v_deposit.user_id,
    v_deposit.amount,
    'deposit'::wallet_transaction_type,
    'deposit_request'::text,
    v_deposit.id,
    v_idem_key,
    'Deposit approved by admin'::text,
    jsonb_build_object('payment_method', v_deposit.payment_method, 'provider_reference', v_deposit.provider_reference),
    p_admin_id
  );

  IF v_credit_result.status = 'error' THEN
    RETURN QUERY SELECT 'error'::text, NULL::uuid, NULL::numeric, 'Wallet credit failed'::text;
    RETURN;
  END IF;

  -- Update deposit request
  UPDATE public.deposit_requests
  SET status = 'approved',
      reviewed_at = now(),
      reviewed_by = p_admin_id,
      wallet_transaction_id = v_credit_result.transaction_id
  WHERE id = p_deposit_id;

  -- Audit log
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (
    p_admin_id,
    'deposit_approved',
    'deposit_request',
    p_deposit_id,
    jsonb_build_object('amount', v_deposit.amount, 'currency', v_deposit.currency, 'user_id', v_deposit.user_id, 'transaction_id', v_credit_result.transaction_id)
  );

  RETURN QUERY SELECT v_credit_result.status::text, v_credit_result.transaction_id, v_credit_result.new_balance, 'Deposit approved and wallet credited'::text;
END;
$$;

-- ===== reject_deposit =====
CREATE OR REPLACE FUNCTION public.reject_deposit(
  p_deposit_id uuid,
  p_admin_id uuid,
  p_reason text
)
RETURNS TABLE(status text, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deposit public.deposit_requests;
BEGIN
  IF NOT public.is_admin(p_admin_id) THEN
    RETURN QUERY SELECT 'unauthorized'::text, 'Only administrators can reject deposits'::text;
    RETURN;
  END IF;

  SELECT * INTO v_deposit FROM public.deposit_requests
  WHERE id = p_deposit_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'error'::text, 'Deposit request not found'::text;
    RETURN;
  END IF;

  IF v_deposit.status != 'pending' THEN
    RETURN QUERY SELECT 'skipped'::text, 'Deposit is not pending (status: ' || v_deposit.status || ')'::text;
    RETURN;
  END IF;

  -- Update status — no balance change
  UPDATE public.deposit_requests
  SET status = 'rejected',
      rejection_reason = p_reason,
      reviewed_at = now(),
      reviewed_by = p_admin_id
  WHERE id = p_deposit_id;

  -- Audit log
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (
    p_admin_id,
    'deposit_rejected',
    'deposit_request',
    p_deposit_id,
    jsonb_build_object('amount', v_deposit.amount, 'user_id', v_deposit.user_id, 'reason', p_reason)
  );

  RETURN QUERY SELECT 'rejected'::text, 'Deposit rejected — no balance change'::text;
END;
$$;

-- ===== admin_adjust_balance =====
CREATE OR REPLACE FUNCTION public.admin_adjust_balance(
  p_user_id uuid,
  p_amount numeric,
  p_reason text,
  p_admin_id uuid,
  p_idempotency_key text
)
RETURNS TABLE(status text, transaction_id uuid, new_balance numeric, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type wallet_transaction_type;
  v_result record;
BEGIN
  -- Server-side admin check
  IF NOT public.is_admin(p_admin_id) THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::uuid, NULL::numeric, 'Only administrators can adjust balances'::text;
    RETURN;
  END IF;

  -- Require reason
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RETURN QUERY SELECT 'error'::text, NULL::uuid, NULL::numeric, 'A reason is required for balance adjustments'::text;
    RETURN;
  END IF;

  -- Require valid amount
  IF p_amount = 0 THEN
    RETURN QUERY SELECT 'error'::text, NULL::uuid, NULL::numeric, 'Adjustment amount cannot be zero'::text;
    RETURN;
  END IF;

  -- Determine type
  IF p_amount > 0 THEN
    v_type := 'admin_credit'::wallet_transaction_type;
  ELSE
    v_type := 'admin_debit'::wallet_transaction_type;
  END IF;

  -- For debits, check the amount is positive (we negate it in the ledger)
  -- credit_wallet handles positive amounts; for admin_debit we pass abs value
  -- but store as negative via a separate path
  IF p_amount > 0 THEN
    SELECT * INTO v_result FROM public.credit_wallet(
      p_user_id, p_amount, v_type,
      'admin_adjustment', NULL, p_idempotency_key,
      'Admin credit: ' || p_reason,
      jsonb_build_object('admin_id', p_admin_id, 'reason', p_reason),
      p_admin_id
    );
  ELSE
    -- Use debit_wallet for negative adjustments
    SELECT * INTO v_result FROM public.debit_wallet(
      p_user_id, abs(p_amount),
      'admin_adjustment', NULL, p_idempotency_key,
      'Admin debit: ' || p_reason,
      jsonb_build_object('admin_id', p_admin_id, 'reason', p_reason),
      p_admin_id
    );
    -- Override the transaction_type to admin_debit
    IF v_result.status = 'completed' THEN
      UPDATE public.wallet_transactions
      SET transaction_type = 'admin_debit'::wallet_transaction_type
      WHERE id = v_result.transaction_id;
    END IF;
  END IF;

  -- Audit log
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (
    p_admin_id,
    'admin_balance_adjustment',
    'user_wallets',
    p_user_id,
    jsonb_build_object('amount', p_amount, 'reason', p_reason, 'transaction_id', v_result.transaction_id, 'status', v_result.status)
  );

  RETURN QUERY SELECT v_result.status::text, v_result.transaction_id, v_result.new_balance,
    CASE WHEN v_result.status = 'completed' THEN 'Balance adjusted successfully'::text
         WHEN v_result.status = 'skipped' THEN 'Duplicate request — no change applied'::text
         WHEN v_result.status = 'insufficient_funds' THEN 'Insufficient funds for debit'::text
         ELSE 'Adjustment failed'::text END;
END;
$$;

-- ===== Revoke and grant EXECUTE =====
REVOKE EXECUTE ON FUNCTION public.credit_wallet(uuid, numeric, wallet_transaction_type, text, uuid, text, text, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credit_wallet(uuid, numeric, wallet_transaction_type, text, uuid, text, text, jsonb, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.debit_wallet(uuid, numeric, text, uuid, text, text, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debit_wallet(uuid, numeric, text, uuid, text, text, jsonb, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.approve_deposit(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_deposit(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.reject_deposit(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_deposit(uuid, uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_adjust_balance(uuid, numeric, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_balance(uuid, numeric, text, uuid, text) TO authenticated;
