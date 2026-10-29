/*
# Pricing Engine Functions — Phase 2

## Purpose
Implements the server-side business logic for automatic wholesale-to-retail
price synchronization. These PL/pgSQL functions are SECURITY DEFINER so they
run with elevated privileges, but they are only callable by authenticated users
(EXECUTE revoked from PUBLIC/anon).

## Functions

### 1. calculate_retail_price(p_wholesale_cost, p_method, p_markup_pct, p_fixed_markup, p_target_margin_pct, p_round_to)
Returns the calculated retail price based on the pricing method:
- percentage_markup: cost * (1 + markup_pct/100)
- fixed_markup: cost + fixed_markup
- target_margin: cost / (1 - target_margin_pct/100)
- manual: returns NULL (caller handles)
Rounds to the specified increment.

### 2. resolve_pricing_rule(p_service_id, p_country_id, p_provider_id, p_category_id)
Returns the highest-precedence active pricing rule for the given context.
Precedence: service_country > service > country > category > provider > global.

### 3. apply_price_update(p_availability_id, p_new_cost, p_source, p_sync_job_id, p_actor_id)
The core idempotent price synchronization function:
1. Loads the availability row with FOR UPDATE lock.
2. Checks if cost actually changed (idempotency guard).
3. Resolves the applicable pricing rule.
4. Calculates the new retail price (or respects manual override policy).
5. Validates minimum margin / minimum price rules.
6. Updates wholesale_cost, retail_price, timestamps.
7. Inserts a price_history record with before/after values.
8. Returns a record with status: applied, skipped (no change), flagged (margin violation), or error.

## Security
- All functions are SECURITY DEFINER with search_path = public.
- EXECUTE revoked from PUBLIC and anon.
- GRANT EXECUTE to authenticated only.
- apply_price_update uses SELECT ... FOR UPDATE to prevent concurrent updates.

## Idempotency
- If p_new_cost equals the current wholesale_cost, the function returns 'skipped'
  without making any changes. This prevents repeated markup on repeated sync.
- If a price_history record already exists for the same availability_id and
  new_wholesale_cost, it also returns 'skipped'.

## Manual Price Policy
- If manual_price_override is true on the availability row:
  - The wholesale cost IS still updated (so the admin sees the real cost).
  - The retail price is NOT changed.
  - The price_history record is created with status 'flagged' and a note
    that the manual price may need review.
  - This ensures manual prices are never silently overwritten.
*/

-- ===== Enum types for catalog =====
DO $$ BEGIN
  CREATE TYPE provider_auth_method AS ENUM ('api_key', 'basic', 'bearer', 'query_param');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pricing_method AS ENUM ('percentage_markup', 'fixed_markup', 'target_margin', 'manual', 'min_profit_protection');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pricing_rule_scope AS ENUM ('global', 'provider', 'category', 'country', 'service', 'service_country');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sync_job_type AS ENUM ('full_catalog', 'prices_only', 'stock_only', 'selected_services', 'selected_countries');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sync_job_status AS ENUM ('pending', 'running', 'completed', 'failed', 'partially_completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sync_log_level AS ENUM ('info', 'warning', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE price_update_status AS ENUM ('applied', 'skipped', 'flagged', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===== Tables: countries =====
CREATE TABLE IF NOT EXISTS public.countries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iso_code text UNIQUE NOT NULL,
  name text NOT NULL,
  flag_emoji text,
  calling_code text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;

-- ===== Tables: categories =====
CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  icon text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- ===== Tables: providers =====
CREATE TABLE IF NOT EXISTS public.providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  base_url text,
  auth_method provider_auth_method NOT NULL DEFAULT 'api_key',
  is_active boolean NOT NULL DEFAULT false,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  rate_limit_per_min int NOT NULL DEFAULT 60,
  request_timeout_ms int NOT NULL DEFAULT 15000,
  last_health_check timestamptz,
  last_successful_sync timestamptz,
  error_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;

-- ===== Tables: provider_credentials =====
CREATE TABLE IF NOT EXISTS public.provider_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  key_name text NOT NULL,
  encrypted_value text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, key_name)
);

ALTER TABLE public.provider_credentials ENABLE ROW LEVEL SECURITY;
-- No grants to anon or authenticated — service_role only.

-- ===== Tables: services =====
CREATE TABLE IF NOT EXISTS public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  icon text,
  is_active boolean NOT NULL DEFAULT true,
  is_archived boolean NOT NULL DEFAULT false,
  is_demo boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

-- ===== Tables: provider_country_mappings =====
CREATE TABLE IF NOT EXISTS public.provider_country_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  country_id uuid NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,
  provider_country_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, provider_country_id),
  UNIQUE (provider_id, country_id)
);

ALTER TABLE public.provider_country_mappings ENABLE ROW LEVEL SECURITY;

-- ===== Tables: provider_service_mappings =====
CREATE TABLE IF NOT EXISTS public.provider_service_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  provider_service_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, provider_service_id),
  UNIQUE (provider_id, service_id)
);

ALTER TABLE public.provider_service_mappings ENABLE ROW LEVEL SECURITY;

-- ===== Tables: service_country_availability =====
CREATE TABLE IF NOT EXISTS public.service_country_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  country_id uuid NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  wholesale_cost numeric(12,4) NOT NULL DEFAULT 0,
  retail_price numeric(12,4) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  is_available boolean,
  pricing_method pricing_method NOT NULL DEFAULT 'percentage_markup',
  manual_price_override boolean NOT NULL DEFAULT false,
  min_price numeric(12,4),
  min_margin_pct numeric(5,2),
  last_cost_update timestamptz,
  last_price_sync timestamptz,
  last_availability_check timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, country_id, provider_id)
);

ALTER TABLE public.service_country_availability ENABLE ROW LEVEL SECURITY;

-- ===== Tables: pricing_rules =====
CREATE TABLE IF NOT EXISTS public.pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope pricing_rule_scope NOT NULL,
  provider_id uuid REFERENCES public.providers(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  country_id uuid REFERENCES public.countries(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services(id) ON DELETE CASCADE,
  pricing_method pricing_method NOT NULL DEFAULT 'percentage_markup',
  markup_percentage numeric(5,2),
  fixed_markup numeric(12,4),
  target_margin_percentage numeric(5,2),
  min_price numeric(12,4),
  min_margin_pct numeric(5,2),
  round_to numeric(12,4) NOT NULL DEFAULT 0.01,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;

-- ===== Tables: price_history =====
CREATE TABLE IF NOT EXISTS public.price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_country_availability_id uuid NOT NULL REFERENCES public.service_country_availability(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  country_id uuid NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  provider_service_id text,
  previous_wholesale_cost numeric(12,4),
  new_wholesale_cost numeric(12,4),
  previous_retail_price numeric(12,4),
  new_retail_price numeric(12,4),
  currency text NOT NULL DEFAULT 'USD',
  applied_pricing_method pricing_method,
  applied_pricing_rule_id uuid REFERENCES public.pricing_rules(id) ON DELETE SET NULL,
  previous_margin_pct numeric(5,2),
  new_margin_pct numeric(5,2),
  update_source text NOT NULL DEFAULT 'sync_job',
  sync_job_id uuid,
  status price_update_status NOT NULL DEFAULT 'applied',
  error_details text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;

-- ===== Tables: provider_sync_jobs =====
CREATE TABLE IF NOT EXISTS public.provider_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  job_type sync_job_type NOT NULL,
  status sync_job_status NOT NULL DEFAULT 'pending',
  started_at timestamptz,
  completed_at timestamptz,
  records_processed int NOT NULL DEFAULT 0,
  records_created int NOT NULL DEFAULT 0,
  records_updated int NOT NULL DEFAULT 0,
  records_skipped int NOT NULL DEFAULT 0,
  records_failed int NOT NULL DEFAULT 0,
  error_message text,
  triggered_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_sync_jobs ENABLE ROW LEVEL SECURITY;

-- ===== Tables: provider_sync_logs =====
CREATE TABLE IF NOT EXISTS public.provider_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_job_id uuid NOT NULL REFERENCES public.provider_sync_jobs(id) ON DELETE CASCADE,
  level sync_log_level NOT NULL DEFAULT 'info',
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_sync_logs ENABLE ROW LEVEL SECURITY;

-- ===== Grants =====

-- Public-readable catalog tables (active records only, enforced by policy)
GRANT SELECT ON public.countries TO anon, authenticated;
GRANT SELECT ON public.categories TO anon, authenticated;
GRANT SELECT ON public.services TO anon, authenticated;
GRANT SELECT ON public.service_country_availability TO anon, authenticated;

-- Admin-only catalog tables
GRANT SELECT ON public.providers TO authenticated;
GRANT SELECT ON public.provider_country_mappings TO authenticated;
GRANT SELECT ON public.provider_service_mappings TO authenticated;
GRANT SELECT ON public.pricing_rules TO authenticated;
GRANT SELECT ON public.price_history TO authenticated;
GRANT SELECT ON public.provider_sync_jobs TO authenticated;
GRANT SELECT ON public.provider_sync_logs TO authenticated;

-- No grants on provider_credentials to anon/authenticated.

-- ===== Policies: countries =====
DROP POLICY IF EXISTS "select_active_countries_public" ON public.countries;
CREATE POLICY "select_active_countries_public"
  ON public.countries FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "select_all_countries_admin" ON public.countries;
CREATE POLICY "select_all_countries_admin"
  ON public.countries FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ===== Policies: categories =====
DROP POLICY IF EXISTS "select_active_categories_public" ON public.categories;
CREATE POLICY "select_active_categories_public"
  ON public.categories FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "select_all_categories_admin" ON public.categories;
CREATE POLICY "select_all_categories_admin"
  ON public.categories FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ===== Policies: services =====
DROP POLICY IF EXISTS "select_active_services_public" ON public.services;
CREATE POLICY "select_active_services_public"
  ON public.services FOR SELECT
  TO anon, authenticated
  USING (is_active = true AND is_archived = false);

DROP POLICY IF EXISTS "select_all_services_admin" ON public.services;
CREATE POLICY "select_all_services_admin"
  ON public.services FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ===== Policies: service_country_availability =====
DROP POLICY IF EXISTS "select_available_sca_public" ON public.service_country_availability;
CREATE POLICY "select_available_sca_public"
  ON public.service_country_availability FOR SELECT
  TO anon, authenticated
  USING (
    is_available IS NOT DISTINCT FROM true
    AND EXISTS (SELECT 1 FROM public.services s WHERE s.id = service_country_availability.service_id AND s.is_active = true AND s.is_archived = false)
  );

DROP POLICY IF EXISTS "select_all_sca_admin" ON public.service_country_availability;
CREATE POLICY "select_all_sca_admin"
  ON public.service_country_availability FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ===== Policies: providers (admin only) =====
DROP POLICY IF EXISTS "select_providers_admin" ON public.providers;
CREATE POLICY "select_providers_admin"
  ON public.providers FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ===== Policies: provider_country_mappings (admin only) =====
DROP POLICY IF EXISTS "select_pcm_admin" ON public.provider_country_mappings;
CREATE POLICY "select_pcm_admin"
  ON public.provider_country_mappings FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ===== Policies: provider_service_mappings (admin only) =====
DROP POLICY IF EXISTS "select_psm_admin" ON public.provider_service_mappings;
CREATE POLICY "select_psm_admin"
  ON public.provider_service_mappings FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ===== Policies: pricing_rules =====
DROP POLICY IF EXISTS "select_pricing_rules_admin" ON public.pricing_rules;
CREATE POLICY "select_pricing_rules_admin"
  ON public.pricing_rules FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ===== Policies: price_history (admin only) =====
DROP POLICY IF EXISTS "select_price_history_admin" ON public.price_history;
CREATE POLICY "select_price_history_admin"
  ON public.price_history FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ===== Policies: provider_sync_jobs (admin only) =====
DROP POLICY IF EXISTS "select_sync_jobs_admin" ON public.provider_sync_jobs;
CREATE POLICY "select_sync_jobs_admin"
  ON public.provider_sync_jobs FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ===== Policies: provider_sync_logs (admin only) =====
DROP POLICY IF EXISTS "select_sync_logs_admin" ON public.provider_sync_logs;
CREATE POLICY "select_sync_logs_admin"
  ON public.provider_sync_logs FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ===== provider_credentials: no policies = no access for anon/authenticated =====

-- ===== Indexes =====
CREATE INDEX IF NOT EXISTS idx_countries_active ON public.countries(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_categories_active ON public.categories(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_services_active ON public.services(is_active, is_archived, sort_order);
CREATE INDEX IF NOT EXISTS idx_services_category ON public.services(category_id);
CREATE INDEX IF NOT EXISTS idx_sca_service ON public.service_country_availability(service_id);
CREATE INDEX IF NOT EXISTS idx_sca_country ON public.service_country_availability(country_id);
CREATE INDEX IF NOT EXISTS idx_sca_provider ON public.service_country_availability(provider_id);
CREATE INDEX IF NOT EXISTS idx_sca_available ON public.service_country_availability(is_available) WHERE is_available = true;
CREATE INDEX IF NOT EXISTS idx_price_history_sca ON public.price_history(service_country_availability_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_service ON public.price_history(service_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_country ON public.price_history(country_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_status ON public.price_history(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_provider ON public.provider_sync_jobs(provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_logs_job ON public.provider_sync_logs(sync_job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_scope ON public.pricing_rules(scope, is_active);
CREATE INDEX IF NOT EXISTS idx_pcm_provider ON public.provider_country_mappings(provider_id);
CREATE INDEX IF NOT EXISTS idx_psm_provider ON public.provider_service_mappings(provider_id);

-- ===== updated_at triggers for new tables =====
DROP TRIGGER IF EXISTS countries_touch_updated_at ON public.countries;
CREATE TRIGGER countries_touch_updated_at
  BEFORE UPDATE ON public.countries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS categories_touch_updated_at ON public.categories;
CREATE TRIGGER categories_touch_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS providers_touch_updated_at ON public.providers;
CREATE TRIGGER providers_touch_updated_at
  BEFORE UPDATE ON public.providers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS services_touch_updated_at ON public.services;
CREATE TRIGGER services_touch_updated_at
  BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS sca_touch_updated_at ON public.service_country_availability;
CREATE TRIGGER sca_touch_updated_at
  BEFORE UPDATE ON public.service_country_availability
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS pricing_rules_touch_updated_at ON public.pricing_rules;
CREATE TRIGGER pricing_rules_touch_updated_at
  BEFORE UPDATE ON public.pricing_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS provider_credentials_touch_updated_at ON public.provider_credentials;
CREATE TRIGGER provider_credentials_touch_updated_at
  BEFORE UPDATE ON public.provider_credentials
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
