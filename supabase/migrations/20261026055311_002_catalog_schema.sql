/*
# Catalog Schema — Phase 2

## Purpose
Creates the complete service catalog infrastructure: countries, categories,
services, providers, provider mappings, availability, pricing rules, price
history, and synchronization tracking. This is the data backbone for both the
customer catalog and the admin management interface.

## New Tables

### 1. countries
- `id` (uuid, PK)
- `iso_code` (text, UNIQUE) — ISO 3166-1 alpha-2 code (e.g. 'US', 'TR')
- `name` (text) — display name
- `flag_emoji` (text) — emoji flag for UI
- `calling_code` (text) — phone calling code (e.g. '+1')
- `is_active` (boolean) — whether shown in catalog
- `sort_order` (int) — display ordering
- `created_at`, `updated_at`

### 2. categories
- `id` (uuid, PK)
- `name` (text) — display name
- `slug` (text, UNIQUE) — URL-safe identifier
- `description` (text)
- `icon` (text) — lucide icon name
- `is_active` (boolean)
- `sort_order` (int)
- `created_at`, `updated_at`

### 3. providers
- `id` (uuid, PK)
- `name` (text) — provider display name
- `slug` (text, UNIQUE)
- `base_url` (text) — API base URL
- `auth_method` (enum: api_key, basic, bearer, query_param)
- `is_active` (boolean)
- `capabilities` (jsonb) — supported operations
- `rate_limit_per_min` (int) — requests per minute
- `request_timeout_ms` (int)
- `last_health_check` (timestamptz)
- `last_successful_sync` (timestamptz)
- `error_count` (int, default 0)
- `created_at`, `updated_at`

### 4. provider_credentials
- `id` (uuid, PK)
- `provider_id` (uuid, FK → providers)
- `key_name` (text) — e.g. 'api_key', 'username'
- `encrypted_value` (text) — server-side encrypted credential
- `is_active` (boolean)
- `created_at`, `updated_at`
- NOTE: Never exposed to frontend. No SELECT grant for anon/authenticated.

### 5. services
- `id` (uuid, PK)
- `name` (text) — display name
- `slug` (text, UNIQUE)
- `description` (text)
- `category_id` (uuid, FK → categories)
- `icon` (text) — lucide icon name
- `is_active` (boolean)
- `is_archived` (boolean)
- `is_demo` (boolean) — marks demonstration data
- `sort_order` (int)
- `created_at`, `updated_at`

### 6. provider_country_mappings
- `id` (uuid, PK)
- `provider_id` (uuid, FK → providers)
- `country_id` (uuid, FK → countries)
- `provider_country_id` (text) — provider's external country identifier
- UNIQUE(provider_id, provider_country_id) — one mapping per external ID
- UNIQUE(provider_id, country_id) — one mapping per internal country
- `created_at`

### 7. provider_service_mappings
- `id` (uuid, PK)
- `provider_id` (uuid, FK → providers)
- `service_id` (uuid, FK → services)
- `provider_service_id` (text) — provider's external service identifier
- UNIQUE(provider_id, provider_service_id) — one mapping per external ID
- UNIQUE(provider_id, service_id) — one mapping per internal service
- `created_at`

### 8. service_country_availability
- `id` (uuid, PK)
- `service_id` (uuid, FK → services)
- `country_id` (uuid, FK → countries)
- `provider_id` (uuid, FK → providers)
- `wholesale_cost` (numeric(12,4)) — cost from provider
- `retail_price` (numeric(12,4)) — selling price to customer
- `currency` (text, default 'USD')
- `is_available` (boolean) — current stock status (NULL = unknown)
- `pricing_method` (enum: percentage_markup, fixed_markup, target_margin, manual, min_profit_protection)
- `manual_price_override` (boolean) — if true, retail price is manually set
- `min_price` (numeric(12,4)) — minimum selling price floor
- `min_margin_pct` (numeric(5,2)) — minimum margin percentage
- `last_cost_update` (timestamptz) — when wholesale cost last changed
- `last_price_sync` (timestamptz) — when retail price was recalculated
- `last_availability_check` (timestamptz)
- `is_demo` (boolean) — marks demonstration data
- `created_at`, `updated_at`
- UNIQUE(service_id, country_id, provider_id)

### 9. pricing_rules
- `id` (uuid, PK)
- `scope` (enum: global, provider, category, country, service, service_country)
- `provider_id` (uuid, FK, nullable)
- `category_id` (uuid, FK, nullable)
- `country_id` (uuid, FK, nullable)
- `service_id` (uuid, FK, nullable)
- `pricing_method` (enum: percentage_markup, fixed_markup, target_margin, manual)
- `markup_percentage` (numeric(5,2))
- `fixed_markup` (numeric(12,4))
- `target_margin_percentage` (numeric(5,2))
- `min_price` (numeric(12,4))
- `min_margin_pct` (numeric(5,2))
- `round_to` (numeric(12,4)) — rounding increment (e.g. 0.01, 0.99)
- `is_active` (boolean)
- `created_at`, `updated_at`
- Precedence: service_country > service > country > category > provider > global

### 10. price_history
- `id` (uuid, PK)
- `service_country_availability_id` (uuid, FK → service_country_availability)
- `service_id` (uuid, FK → services)
- `country_id` (uuid, FK → countries)
- `provider_id` (uuid, FK → providers)
- `provider_service_id` (text) — snapshot of provider mapping
- `previous_wholesale_cost` (numeric(12,4))
- `new_wholesale_cost` (numeric(12,4))
- `previous_retail_price` (numeric(12,4))
- `new_retail_price` (numeric(12,4))
- `currency` (text)
- `applied_pricing_method` (enum)
- `applied_pricing_rule_id` (uuid, FK → pricing_rules, nullable)
- `previous_margin_pct` (numeric(5,2))
- `new_margin_pct` (numeric(5,2))
- `update_source` (text) — 'sync_job', 'manual_edit', 'admin_override'
- `sync_job_id` (uuid, nullable)
- `status` (enum: applied, skipped, flagged, error)
- `error_details` (text)
- `created_at`

### 11. provider_sync_jobs
- `id` (uuid, PK)
- `provider_id` (uuid, FK → providers)
- `job_type` (enum: full_catalog, prices_only, stock_only, selected_services, selected_countries)
- `status` (enum: pending, running, completed, failed, partially_completed)
- `started_at`, `completed_at` (timestamptz)
- `records_processed`, `records_created`, `records_updated`, `records_skipped`, `records_failed` (int)
- `error_message` (text)
- `triggered_by` (uuid, FK → profiles, nullable)
- `created_at`

### 12. provider_sync_logs
- `id` (uuid, PK)
- `sync_job_id` (uuid, FK → provider_sync_jobs, cascade delete)
- `level` (enum: info, warning, error)
- `message` (text)
- `details` (jsonb)
- `created_at`

## Security

### Customer-facing tables (read by anon + authenticated)
- countries: public SELECT for active rows
- categories: public SELECT for active rows
- services: public SELECT for active, non-archived rows
- service_country_availability: public SELECT for available rows (joins service+country)

### Admin-only tables
- providers: SELECT for admins only (credential-adjacent data)
- provider_credentials: NO grants to anon/authenticated — service_role only
- pricing_rules: SELECT for admins; customer SELECT on active rules that match their view
- price_history: SELECT for admins only
- provider_sync_jobs: SELECT for admins only
- provider_sync_logs: SELECT for admins only
- provider_country_mappings: SELECT for admins
- provider_service_mappings: SELECT for admins

### Write access
- All catalog writes go through admin edge functions (service_role bypasses RLS)
- Direct client writes denied by default (no INSERT/UPDATE/DELETE policies for authenticated on admin tables)
- The is_admin() function from Phase 1 guards admin policies

## Important Notes
1. All monetary columns use numeric(12,4) — never floating point for financial data.
2. The UNIQUE constraints on provider mappings ensure exact service matching:
   one provider_service_id maps to exactly one internal service.
3. service_country_availability has a composite unique key on (service_id, country_id, provider_id)
   to prevent duplicate availability rows.
4. price_history is append-only — no UPDATE or DELETE policies.
5. Demo data is flagged with is_demo = true so it can be clearly distinguished
   from real provider-sourced data.
6. pricing_rules precedence is enforced in application logic (calculate_retail_price function),
   not by database ordering — the function picks the most specific matching rule.
*/
