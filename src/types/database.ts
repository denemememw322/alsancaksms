export type ProfileStatus = 'active' | 'suspended' | 'pending';
export type UserRole = 'super_admin' | 'admin' | 'finance_manager' | 'support_agent' | 'catalog_manager' | 'analyst' | 'customer';
export type ThemePreference = 'light' | 'dark' | 'system';

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  status: ProfileStatus;
  language: string;
  currency: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface UserRoleAssignment {
  id: string;
  user_id: string;
  role: UserRole;
  assigned_by: string | null;
  assigned_at: string;
  created_at: string;
}

export interface UserPreferences {
  id: string;
  user_id: string;
  theme: ThemePreference;
  email_notifications: boolean;
  sms_notifications: boolean;
  two_factor_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface SystemSetting {
  id: string;
  key: string;
  value: unknown;
  description: string | null;
  is_public: boolean;
  updated_at: string;
  updated_by: string | null;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

// ===== Catalog Types =====

export type ProviderAuthMethod = 'api_key' | 'basic' | 'bearer' | 'query_param';
export type PricingMethod = 'percentage_markup' | 'fixed_markup' | 'target_margin' | 'manual' | 'min_profit_protection';
export type PricingRuleScope = 'global' | 'provider' | 'category' | 'country' | 'service' | 'service_country';
export type SyncJobType = 'full_catalog' | 'prices_only' | 'stock_only' | 'selected_services' | 'selected_countries';
export type SyncJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'partially_completed';
export type SyncLogLevel = 'info' | 'warning' | 'error';
export type PriceUpdateStatus = 'applied' | 'skipped' | 'flagged' | 'error';

export interface Country {
  id: string;
  iso_code: string;
  name: string;
  flag_emoji: string | null;
  calling_code: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Provider {
  id: string;
  name: string;
  slug: string;
  base_url: string | null;
  auth_method: ProviderAuthMethod;
  is_active: boolean;
  capabilities: Record<string, unknown>;
  rate_limit_per_min: number;
  request_timeout_ms: number;
  last_health_check: string | null;
  last_successful_sync: string | null;
  error_count: number;
  created_at: string;
  updated_at: string;
}

export interface Service {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category_id: string | null;
  icon: string | null;
  is_active: boolean;
  is_archived: boolean;
  is_demo: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ServiceCountryAvailability {
  id: string;
  service_id: string;
  country_id: string;
  provider_id: string;
  wholesale_cost: number;
  retail_price: number;
  currency: string;
  is_available: boolean | null;
  pricing_method: PricingMethod;
  manual_price_override: boolean;
  min_price: number | null;
  min_margin_pct: number | null;
  last_cost_update: string | null;
  last_price_sync: string | null;
  last_availability_check: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface PricingRule {
  id: string;
  scope: PricingRuleScope;
  provider_id: string | null;
  category_id: string | null;
  country_id: string | null;
  service_id: string | null;
  pricing_method: PricingMethod;
  markup_percentage: number | null;
  fixed_markup: number | null;
  target_margin_percentage: number | null;
  min_price: number | null;
  min_margin_pct: number | null;
  round_to: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PriceHistory {
  id: string;
  service_country_availability_id: string;
  service_id: string;
  country_id: string;
  provider_id: string;
  provider_service_id: string | null;
  previous_wholesale_cost: number | null;
  new_wholesale_cost: number | null;
  previous_retail_price: number | null;
  new_retail_price: number | null;
  currency: string;
  applied_pricing_method: PricingMethod | null;
  applied_pricing_rule_id: string | null;
  previous_margin_pct: number | null;
  new_margin_pct: number | null;
  update_source: string;
  sync_job_id: string | null;
  status: PriceUpdateStatus;
  error_details: string | null;
  created_at: string;
}

export interface ProviderSyncJob {
  id: string;
  provider_id: string;
  job_type: SyncJobType;
  status: SyncJobStatus;
  started_at: string | null;
  completed_at: string | null;
  records_processed: number;
  records_created: number;
  records_updated: number;
  records_skipped: number;
  records_failed: number;
  error_message: string | null;
  triggered_by: string | null;
  created_at: string;
}

export interface ProviderSyncLog {
  id: string;
  sync_job_id: string;
  level: SyncLogLevel;
  message: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface ProviderCountryMapping {
  id: string;
  provider_id: string;
  country_id: string;
  provider_country_id: string;
  created_at: string;
}

export interface ProviderServiceMapping {
  id: string;
  provider_id: string;
  service_id: string;
  provider_service_id: string;
  created_at: string;
}

// ===== Wallet Types =====

export type WalletTransactionType =
  | 'deposit' | 'purchase' | 'refund' | 'admin_credit' | 'admin_debit';
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'reversed';
export type DepositStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
export type DepositPaymentMethod = 'manual' | 'stripe' | 'crypto' | 'paypal' | 'bank_transfer';

export interface UserWallet {
  id: string;
  user_id: string;
  balance: number;
  currency: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WalletTransaction {
  id: string;
  user_id: string;
  wallet_id: string;
  transaction_type: WalletTransactionType;
  amount: number;
  balance_before: number;
  balance_after: number;
  status: TransactionStatus;
  reference_type: string | null;
  reference_id: string | null;
  idempotency_key: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface DepositRequest {
  id: string;
  user_id: string;
  wallet_id: string;
  amount: number;
  currency: string;
  payment_method: DepositPaymentMethod;
  provider_reference: string | null;
  status: DepositStatus;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  wallet_transaction_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface WalletRpcResult {
  status: 'completed' | 'skipped' | 'error' | 'insufficient_funds' | 'unauthorized';
  transaction_id: string | null;
  new_balance: number | null;
}

export interface DepositApprovalResult {
  status: string;
  transaction_id: string | null;
  new_balance: number | null;
  message: string;
}

export interface AdminAdjustResult {
  status: string;
  transaction_id: string | null;
  new_balance: number | null;
  message: string;
}

// Composite type for catalog browsing (join result)
export interface CatalogServiceItem {
  availability_id: string;
  service_id: string;
  service_name: string;
  service_slug: string;
  service_description: string | null;
  service_icon: string | null;
  service_is_demo: boolean;
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  country_id: string;
  country_name: string;
  country_iso: string;
  country_flag: string | null;
  retail_price: number;
  currency: string;
  is_available: boolean | null;
  is_demo: boolean;
}
