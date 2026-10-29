/*
# Fix Catalog Grants and Add Admin Write Policies — Phase 2 Fix

## Purpose
Two issues identified during verification:

1. **provider_credentials over-granted**: Supabase's default grants give anon and
   authenticated all privileges on every new table. Although RLS blocks all rows
   (no SELECT policy exists), defense-in-depth requires revoking these grants so
   the table is unreachable from the client entirely.

2. **Admin write policies missing**: The admin UI pages perform INSERT/UPDATE/DELETE
   on catalog tables (categories, countries, services, pricing_rules,
   service_country_availability). RLS currently has no write policies, so these
   operations fail. Adding admin-scoped write policies enforces permission checks
   at the database level (server-side), not just by hiding frontend navigation.

## Changes

### Revoked grants on provider_credentials
- REVOKE ALL from anon and authenticated on provider_credentials.
- Only service_role retains access (for edge functions using service role key).

### Added admin write policies on catalog tables
For each of: categories, countries, services, service_country_availability, pricing_rules
- INSERT policy: WITH CHECK (is_admin(auth.uid()))
- UPDATE policy: USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()))
- DELETE policy: USING (is_admin(auth.uid()))

These policies enforce that only users with admin or super_admin roles can write.
The is_admin() function is SECURITY DEFINER, so the check runs with elevated
privileges and cannot be bypassed by the client.

### Restricted grants on admin-only tables
- price_history: REVOKE INSERT/UPDATE/DELETE from anon (keep authenticated SELECT)
- provider_sync_jobs: REVOKE all from anon (keep authenticated SELECT only)
- provider_sync_logs: REVOKE all from anon (keep authenticated SELECT only)
- providers: REVOKE all from anon (keep authenticated SELECT only)
- provider_country_mappings: REVOKE all from anon (keep authenticated SELECT only)
- provider_service_mappings: REVOKE all from anon (keep authenticated SELECT only)

## Security
- provider_credentials is now completely unreachable from the browser.
- All catalog writes require is_admin() to pass at the database level.
- Anon role can only SELECT active catalog rows (countries, categories, services, availability).
- Authenticated non-admin users get the same public read access plus their own profile data.
*/

-- ===== Revoke ALL on provider_credentials from client roles =====
REVOKE ALL ON public.provider_credentials FROM anon;
REVOKE ALL ON public.provider_credentials FROM authenticated;

-- ===== Revoke excess grants on admin-only tables from anon =====
REVOKE ALL ON public.price_history FROM anon;
REVOKE ALL ON public.provider_sync_jobs FROM anon;
REVOKE ALL ON public.provider_sync_logs FROM anon;
REVOKE ALL ON public.providers FROM anon;
REVOKE ALL ON public.provider_country_mappings FROM anon;
REVOKE ALL ON public.provider_service_mappings FROM anon;

-- Revoke write privileges from anon on public-read catalog tables
REVOKE INSERT, UPDATE, DELETE ON public.countries FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.categories FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.services FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.service_country_availability FROM anon;

-- ===== Admin write policies: categories =====
DROP POLICY IF EXISTS "insert_categories_admin" ON public.categories;
CREATE POLICY "insert_categories_admin"
  ON public.categories FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "update_categories_admin" ON public.categories;
CREATE POLICY "update_categories_admin"
  ON public.categories FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "delete_categories_admin" ON public.categories;
CREATE POLICY "delete_categories_admin"
  ON public.categories FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ===== Admin write policies: countries =====
DROP POLICY IF EXISTS "insert_countries_admin" ON public.countries;
CREATE POLICY "insert_countries_admin"
  ON public.countries FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "update_countries_admin" ON public.countries;
CREATE POLICY "update_countries_admin"
  ON public.countries FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "delete_countries_admin" ON public.countries;
CREATE POLICY "delete_countries_admin"
  ON public.countries FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ===== Admin write policies: services =====
DROP POLICY IF EXISTS "insert_services_admin" ON public.services;
CREATE POLICY "insert_services_admin"
  ON public.services FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "update_services_admin" ON public.services;
CREATE POLICY "update_services_admin"
  ON public.services FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "delete_services_admin" ON public.services;
CREATE POLICY "delete_services_admin"
  ON public.services FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ===== Admin write policies: service_country_availability =====
DROP POLICY IF EXISTS "insert_sca_admin" ON public.service_country_availability;
CREATE POLICY "insert_sca_admin"
  ON public.service_country_availability FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "update_sca_admin" ON public.service_country_availability;
CREATE POLICY "update_sca_admin"
  ON public.service_country_availability FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "delete_sca_admin" ON public.service_country_availability;
CREATE POLICY "delete_sca_admin"
  ON public.service_country_availability FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ===== Admin write policies: pricing_rules =====
DROP POLICY IF EXISTS "insert_pricing_rules_admin" ON public.pricing_rules;
CREATE POLICY "insert_pricing_rules_admin"
  ON public.pricing_rules FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "update_pricing_rules_admin" ON public.pricing_rules;
CREATE POLICY "update_pricing_rules_admin"
  ON public.pricing_rules FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "delete_pricing_rules_admin" ON public.pricing_rules;
CREATE POLICY "delete_pricing_rules_admin"
  ON public.pricing_rules FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));
