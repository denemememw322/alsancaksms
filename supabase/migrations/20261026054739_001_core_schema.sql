/*
# Core Platform Schema — Phase 1

## Purpose
Establishes the foundational database tables for the SMS verification platform:
user profiles, role assignments, preferences, system settings, and audit logs.
All customer and admin functionality builds on these tables.

## New Tables

### 1. profiles
- `id` (uuid, PK) — matches auth.users.id, one row per user
- `email` (text, unique) — mirrored from auth for querying
- `display_name` (text) — user-chosen display name
- `avatar_url` (text) — optional profile image URL
- `status` (enum) — active, suspended, pending
- `language` (text) — preferred UI language code (default 'en')
- `currency` (text) — preferred display currency (default 'USD')
- `timezone` (text) — IANA timezone (default 'UTC')
- `created_at`, `updated_at` (timestamps)

### 2. user_roles
- `id` (uuid, PK)
- `user_id` (uuid, FK → profiles.id, cascade delete)
- `role` (enum) — super_admin, admin, finance_manager, support_agent, catalog_manager, analyst, customer
- `assigned_by` (uuid) — admin who granted the role (nullable)
- `assigned_at` (timestamp)
- UNIQUE(user_id, role) — a user can have multiple roles but no duplicates

### 3. user_preferences
- `id` (uuid, PK)
- `user_id` (uuid, FK → profiles.id, cascade delete, UNIQUE)
- `theme` (enum) — light, dark, system (default 'system')
- `email_notifications` (boolean, default true)
- `sms_notifications` (boolean, default true)
- `two_factor_enabled` (boolean, default false)
- `created_at`, `updated_at`

### 4. system_settings
- `id` (uuid, PK)
- `key` (text, UNIQUE) — e.g. 'site_name', 'default_language', 'maintenance_mode'
- `value` (jsonb) — flexible typed values
- `description` (text) — what this setting controls
- `is_public` (boolean) — whether the frontend can read it
- `updated_at`, `updated_by` (uuid)

### 5. audit_logs
- `id` (uuid, PK)
- `actor_id` (uuid) — user who performed the action (nullable for system events)
- `action` (text) — e.g. 'role_change', 'balance_adjustment', 'price_rule_update'
- `target_type` (text) — table/entity affected
- `target_id` (uuid) — id of affected entity (nullable)
- `details` (jsonb) — structured before/after and context
- `ip_address` (text) — source IP (nullable)
- `created_at` (timestamp)

## Security
- RLS enabled on ALL tables.
- profiles: owner can SELECT/UPDATE their own row; admins can SELECT any.
- user_roles: users can SELECT their own roles; writes are admin-only via edge functions.
- user_preferences: owner full CRUD on their own row.
- system_settings: public rows readable by anon+authenticated; admin-only writes via service_role.
- audit_logs: append-only for authenticated; SELECT restricted to admin or own logs.
- A SECURITY DEFINER function is_admin() lets policies check admin status safely.

## Important Notes
1. A trigger auto-creates a profile row + 'customer' role + default preferences
   when a new auth.users record is inserted (on sign-up).
2. Owner columns default to auth.uid() so client inserts that omit user_id
   satisfy RLS WITH CHECK.
3. Tables are created BEFORE the is_admin function to avoid forward-reference errors.
*/

-- ===== Enum types =====
DO $$ BEGIN
  CREATE TYPE profile_status AS ENUM ('active', 'suspended', 'pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
    'super_admin', 'admin', 'finance_manager', 'support_agent',
    'catalog_manager', 'analyst', 'customer'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE theme_preference AS ENUM ('light', 'dark', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===== profiles =====
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  display_name text,
  avatar_url text,
  status profile_status NOT NULL DEFAULT 'active',
  language text NOT NULL DEFAULT 'en',
  currency text NOT NULL DEFAULT 'USD',
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ===== user_roles =====
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ===== user_preferences =====
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  theme theme_preference NOT NULL DEFAULT 'system',
  email_notifications boolean NOT NULL DEFAULT true,
  sms_notifications boolean NOT NULL DEFAULT true,
  two_factor_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- ===== system_settings =====
CREATE TABLE IF NOT EXISTS public.system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  is_public boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- ===== audit_logs =====
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ===== Helper: is_admin (created AFTER user_roles exists) =====
CREATE OR REPLACE FUNCTION public.is_admin(check_uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = check_uid
    AND role IN ('super_admin', 'admin')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;

-- ===== Grants =====
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_preferences TO authenticated;
GRANT SELECT ON public.system_settings TO anon, authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;

-- ===== Policies: profiles =====
DROP POLICY IF EXISTS "select_own_or_admin_profiles" ON public.profiles;
CREATE POLICY "select_own_or_admin_profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "update_own_profile" ON public.profiles;
CREATE POLICY "update_own_profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ===== Policies: user_roles =====
DROP POLICY IF EXISTS "select_own_or_admin_roles" ON public.user_roles;
CREATE POLICY "select_own_or_admin_roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

-- ===== Policies: user_preferences =====
DROP POLICY IF EXISTS "select_own_preferences" ON public.user_preferences;
CREATE POLICY "select_own_preferences"
  ON public.user_preferences FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "insert_own_preferences" ON public.user_preferences;
CREATE POLICY "insert_own_preferences"
  ON public.user_preferences FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "update_own_preferences" ON public.user_preferences;
CREATE POLICY "update_own_preferences"
  ON public.user_preferences FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "delete_own_preferences" ON public.user_preferences;
CREATE POLICY "delete_own_preferences"
  ON public.user_preferences FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ===== Policies: system_settings =====
DROP POLICY IF EXISTS "select_public_settings" ON public.system_settings;
CREATE POLICY "select_public_settings"
  ON public.system_settings FOR SELECT
  TO anon, authenticated
  USING (is_public = true);

DROP POLICY IF EXISTS "select_admin_settings" ON public.system_settings;
CREATE POLICY "select_admin_settings"
  ON public.system_settings FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ===== Policies: audit_logs =====
DROP POLICY IF EXISTS "select_admin_audit_logs" ON public.audit_logs;
CREATE POLICY "select_admin_audit_logs"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()) OR actor_id = auth.uid());

DROP POLICY IF EXISTS "insert_audit_log" ON public.audit_logs;
CREATE POLICY "insert_audit_log"
  ON public.audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (actor_id = auth.uid());

-- ===== Triggers: auto-create profile + role + preferences on sign-up =====
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== updated_at maintenance =====
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_touch_updated_at ON public.profiles;
CREATE TRIGGER profiles_touch_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS user_preferences_touch_updated_at ON public.user_preferences;
CREATE TRIGGER user_preferences_touch_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS system_settings_touch_updated_at ON public.system_settings;
CREATE TRIGGER system_settings_touch_updated_at
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== Indexes =====
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_settings_public ON public.system_settings(is_public) WHERE is_public = true;

-- ===== Seed default settings =====
INSERT INTO public.system_settings (key, value, description, is_public) VALUES
  ('site_name', '"GrizzlySMS"', 'Public site name shown in header and browser tab', true),
  ('default_language', '"en"', 'Default UI language for new visitors', true),
  ('default_currency', '"USD"', 'Default display currency', true),
  ('maintenance_mode', 'false', 'When true, the site shows a maintenance page to non-admins', true),
  ('supported_languages', '["tr","en","de","fr","es","it","pt","ru","ar","fa","hi","zh","ja","ko","id","pl","uk","nl","vi","th"]', 'List of supported language codes', true)
ON CONFLICT (key) DO NOTHING;
