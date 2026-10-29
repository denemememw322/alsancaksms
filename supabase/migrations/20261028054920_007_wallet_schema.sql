/*
# Wallet and Billing Schema — Phase 3

## Purpose
Creates a secure, database-backed wallet system with an immutable transaction
ledger and deposit request infrastructure. This is the financial backbone for
all customer purchases, refunds, and administrative balance adjustments.

## New Tables

### 1. user_wallets
- `id` (uuid, PK)
- `user_id` (uuid, FK → profiles.id, cascade delete)
- `currency` (text, default 'USD') — wallet currency
- `balance` (numeric(14,4), default 0) — current available balance
- `reserved_balance` (numeric(14,4), default 0) — held for pending orders
- `created_at`, `updated_at`
- UNIQUE(user_id, currency) — one wallet per user per currency
- CHECK: balance >= 0 (no negative balances)
- CHECK: reserved_balance >= 0

### 2. wallet_transactions
Immutable transaction ledger — every balance movement has a row here.
- `id` (uuid, PK)
- `user_id` (uuid, FK → profiles.id)
- `wallet_id` (uuid, FK → user_wallets.id)
- `transaction_type` (enum: deposit, purchase, refund, admin_credit, admin_debit, reversal, reservation, reservation_release)
- `amount` (numeric(14,4)) — positive for credits, negative for debits
- `balance_before` (numeric(14,4)) — balance before this transaction
- `balance_after` (numeric(14,4)) — balance after this transaction
- `status` (enum: completed, pending, failed, reversed)
- `reference_type` (text) — e.g. 'deposit_request', 'order', 'admin_adjustment'
- `reference_id` (uuid) — id of the related entity
- `idempotency_key` (text, UNIQUE) — prevents duplicate processing
- `description` (text) — human-readable description
- `metadata` (jsonb) — additional structured context
- `created_at` (timestamptz)
- No UPDATE or DELETE policies — append-only ledger

### 3. deposit_requests
- `id` (uuid, PK)
- `user_id` (uuid, FK → profiles.id)
- `wallet_id` (uuid, FK → user_wallets.id)
- `amount` (numeric(14,4)) — deposit amount
- `currency` (text, default 'USD')
- `payment_method` (text) — e.g. 'mercanpay', 'paymos', 'paytr', 'manual'
- `status` (enum: pending, approved, rejected, cancelled, expired)
- `provider_reference` (text) — payment provider transaction reference
- `idempotency_key` (text, UNIQUE) — prevents duplicate deposit creation
- `rejection_reason` (text) — admin's reason if rejected
- `reviewed_at` (timestamptz) — when admin reviewed
- `reviewed_by` (uuid, FK → profiles.id) — which admin reviewed
- `wallet_transaction_id` (uuid, FK → wallet_transactions.id) — the ledger entry created on approval
- `created_at`, `updated_at`

## Security

### user_wallets
- Owner can SELECT their own wallet (auth.uid() = user_id)
- Admins can SELECT any wallet (is_admin check)
- No INSERT/UPDATE/DELETE policies for authenticated — wallet creation and
  balance changes go through SECURITY DEFINER functions only

### wallet_transactions
- Owner can SELECT their own transactions (auth.uid() = user_id)
- Admins can SELECT any transaction (is_admin check)
- No INSERT/UPDATE/DELETE from client — only SECURITY DEFINER functions insert

### deposit_requests
- Owner can SELECT and INSERT their own requests (auth.uid() = user_id)
- Admins can SELECT any request and UPDATE status (is_admin check)
- Owner cannot UPDATE or DELETE — prevents self-approval
- The approve_deposit function enforces admin check server-side

## Important Notes
1. A trigger auto-creates a USD wallet for every new profile.
2. All monetary columns use numeric(14,4) — never floating point.
3. The CHECK constraint balance >= 0 prevents negative balances at the DB level.
4. wallet_transactions is append-only — corrections use reversal transactions.
5. idempotency_key on wallet_transactions prevents duplicate credits.
6. deposit_requests has its own idempotency_key to prevent duplicate submissions.
7. A deposit in 'pending' status never touches the wallet balance.
8. The approve_deposit function is the ONLY path that credits a deposit.
*/

-- ===== Enum types =====
DO $$ BEGIN
  CREATE TYPE wallet_transaction_type AS ENUM (
    'deposit', 'purchase', 'refund', 'admin_credit', 'admin_debit',
    'reversal', 'reservation', 'reservation_release'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE wallet_transaction_status AS ENUM ('completed', 'pending', 'failed', 'reversed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE deposit_request_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===== user_wallets =====
CREATE TABLE IF NOT EXISTS public.user_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'USD',
  balance numeric(14,4) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  reserved_balance numeric(14,4) NOT NULL DEFAULT 0 CHECK (reserved_balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, currency)
);

ALTER TABLE public.user_wallets ENABLE ROW LEVEL SECURITY;

-- ===== wallet_transactions =====
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES public.user_wallets(id) ON DELETE CASCADE,
  transaction_type wallet_transaction_type NOT NULL,
  amount numeric(14,4) NOT NULL,
  balance_before numeric(14,4) NOT NULL,
  balance_after numeric(14,4) NOT NULL,
  status wallet_transaction_status NOT NULL DEFAULT 'completed',
  reference_type text,
  reference_id uuid,
  idempotency_key text UNIQUE,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

-- ===== deposit_requests =====
CREATE TABLE IF NOT EXISTS public.deposit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES public.user_wallets(id) ON DELETE CASCADE,
  amount numeric(14,4) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'USD',
  payment_method text NOT NULL DEFAULT 'manual',
  status deposit_request_status NOT NULL DEFAULT 'pending',
  provider_reference text,
  idempotency_key text UNIQUE,
  rejection_reason text,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  wallet_transaction_id uuid REFERENCES public.wallet_transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deposit_requests ENABLE ROW LEVEL SECURITY;

-- ===== Grants =====
GRANT SELECT ON public.user_wallets TO authenticated;
GRANT SELECT ON public.wallet_transactions TO authenticated;
GRANT SELECT, INSERT ON public.deposit_requests TO authenticated;

-- ===== Policies: user_wallets =====
DROP POLICY IF EXISTS "select_own_wallet" ON public.user_wallets;
CREATE POLICY "select_own_wallet"
  ON public.user_wallets FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "select_all_wallets_admin" ON public.user_wallets;
CREATE POLICY "select_all_wallets_admin"
  ON public.user_wallets FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ===== Policies: wallet_transactions =====
DROP POLICY IF EXISTS "select_own_transactions" ON public.wallet_transactions;
CREATE POLICY "select_own_transactions"
  ON public.wallet_transactions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "select_all_transactions_admin" ON public.wallet_transactions;
CREATE POLICY "select_all_transactions_admin"
  ON public.wallet_transactions FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ===== Policies: deposit_requests =====
DROP POLICY IF EXISTS "select_own_deposits" ON public.deposit_requests;
CREATE POLICY "select_own_deposits"
  ON public.deposit_requests FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "select_all_deposits_admin" ON public.deposit_requests;
CREATE POLICY "select_all_deposits_admin"
  ON public.deposit_requests FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "insert_own_deposits" ON public.deposit_requests;
CREATE POLICY "insert_own_deposits"
  ON public.deposit_requests FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending');

DROP POLICY IF EXISTS "update_deposits_admin" ON public.deposit_requests;
CREATE POLICY "update_deposits_admin"
  ON public.deposit_requests FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ===== Indexes =====
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON public.user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON public.wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet_id ON public.wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_reference ON public.wallet_transactions(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_type ON public.wallet_transactions(transaction_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposit_requests_user_id ON public.deposit_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposit_requests_status ON public.deposit_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposit_requests_reviewed_by ON public.deposit_requests(reviewed_by);

-- ===== updated_at triggers =====
DROP TRIGGER IF EXISTS user_wallets_touch_updated_at ON public.user_wallets;
CREATE TRIGGER user_wallets_touch_updated_at
  BEFORE UPDATE ON public.user_wallets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS deposit_requests_touch_updated_at ON public.deposit_requests;
CREATE TRIGGER deposit_requests_touch_updated_at
  BEFORE UPDATE ON public.deposit_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== Auto-create wallet on new profile =====
-- Extends the existing handle_new_user trigger to also create a USD wallet.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, status)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)), 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.user_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_wallets (user_id, currency)
  VALUES (NEW.id, 'USD')
  ON CONFLICT (user_id, currency) DO NOTHING;

  RETURN NEW;
END;
$$;
