/*
  # 010 - Admin provider management + payment gateway settings

  - payment_gateways: non-secret gateway settings (admin-readable only)
  - gateway_credentials: pointers to Supabase Vault secrets (no policies => client can never read)
  - admin_save_provider / admin_delete_provider
  - admin_set_credential / admin_credential_status: secrets go to Vault, never returned
  - admin_save_gateway
  - public_enabled_gateways(): safe list for the customer deposit page
  All admin functions verify auth.uid() + is_admin(); all write audit_logs without secrets.
  Gateways ship with adapter_ready=false: they can be configured but NOT enabled
  until a real, verified adapter + webhook handler exists.
*/

CREATE TABLE IF NOT EXISTS public.payment_gateways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT false,
  adapter_ready boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'sandbox' CHECK (mode IN ('sandbox','live')),
  currency text NOT NULL DEFAULT 'USD',
  min_amount numeric(12,2) NOT NULL DEFAULT 1 CHECK (min_amount >= 0),
  max_amount numeric(12,2) NOT NULL DEFAULT 1000 CHECK (max_amount >= min_amount),
  customer_fee_pct numeric(6,3) NOT NULL DEFAULT 0 CHECK (customer_fee_pct >= 0),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 100,
  verification_status text NOT NULL DEFAULT 'not_configured'
    CHECK (verification_status IN ('not_configured','configured','tested','live_verified','failed')),
  last_tested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_gateways ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_gateways_admin_select ON public.payment_gateways;
CREATE POLICY payment_gateways_admin_select ON public.payment_gateways
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.gateway_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_id uuid NOT NULL REFERENCES public.payment_gateways(id) ON DELETE CASCADE,
  key_name text NOT NULL,
  vault_secret_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gateway_id, key_name)
);
ALTER TABLE public.gateway_credentials ENABLE ROW LEVEL SECURITY; -- intentionally no policies

INSERT INTO public.payment_gateways (slug, name, sort_order) VALUES
  ('paytr','PayTR',10), ('paymos','Paymos',20), ('mercanpay','MercanPay',30),
  ('stripe','Stripe',40), ('paypal','PayPal',50)
ON CONFLICT (slug) DO NOTHING;

-- helper: audit without secrets
CREATE OR REPLACE FUNCTION public._admin_audit(p_action text, p_type text, p_target uuid, p_details jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.audit_logs(actor_id, action, target_type, target_id, details)
  VALUES (auth.uid(), p_action, p_type, p_target, coalesce(p_details,'{}'::jsonb));
$$;
REVOKE EXECUTE ON FUNCTION public._admin_audit(text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;

-- base URL validation (static part of SSRF defence; runtime check happens in the Edge Function)
CREATE OR REPLACE FUNCTION public._valid_https_url(p_url text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_url ~* '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{2,5})?(/[^\s]*)?$'
     AND p_url !~* '^https://(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|0\.|\[)'
     AND p_url !~* '^https://[^/]*@';
$$;

CREATE OR REPLACE FUNCTION public.admin_save_provider(
  p_id uuid, p_name text, p_slug text, p_base_url text,
  p_auth_method provider_auth_method, p_is_active boolean,
  p_timeout_ms integer, p_rate_limit integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF coalesce(trim(p_name),'')='' OR p_slug !~ '^[a-z0-9][a-z0-9_-]{1,40}$' THEN RAISE EXCEPTION 'invalid name or slug'; END IF;
  IF p_base_url IS NOT NULL AND p_base_url <> '' AND NOT public._valid_https_url(p_base_url) THEN
    RAISE EXCEPTION 'base_url must be a public https URL';
  END IF;
  IF p_timeout_ms NOT BETWEEN 1000 AND 60000 OR p_rate_limit NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'invalid timeout or rate limit'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.providers(name, slug, base_url, auth_method, is_active, capabilities, rate_limit_per_min, request_timeout_ms)
    VALUES (trim(p_name), p_slug, nullif(p_base_url,''), p_auth_method, p_is_active, '{}'::jsonb, p_rate_limit, p_timeout_ms)
    RETURNING id INTO v_id;
    PERFORM public._admin_audit('provider.create','provider',v_id,jsonb_build_object('slug',p_slug));
  ELSE
    UPDATE public.providers SET name=trim(p_name), slug=p_slug, base_url=nullif(p_base_url,''), auth_method=p_auth_method,
      is_active=p_is_active, rate_limit_per_min=p_rate_limit, request_timeout_ms=p_timeout_ms, updated_at=now()
    WHERE id=p_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'provider not found'; END IF;
    PERFORM public._admin_audit('provider.update','provider',v_id,jsonb_build_object('slug',p_slug,'is_active',p_is_active));
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_credential(p_scope text, p_owner_id uuid, p_key_name text, p_value text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE v_existing uuid; v_secret uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF p_key_name !~ '^[a-z0-9_]{2,40}$' OR coalesce(p_value,'')='' OR length(p_value)>4000 THEN RAISE EXCEPTION 'invalid credential'; END IF;
  IF p_scope = 'provider' THEN
    IF NOT EXISTS (SELECT 1 FROM public.providers WHERE id=p_owner_id) THEN RAISE EXCEPTION 'provider not found'; END IF;
    SELECT id, nullif(encrypted_value,'')::uuid INTO v_existing, v_secret FROM public.provider_credentials WHERE provider_id=p_owner_id AND key_name=p_key_name;
    IF v_existing IS NULL THEN
      v_secret := vault.create_secret(p_value, 'provider:'||p_owner_id||':'||p_key_name);
      INSERT INTO public.provider_credentials(provider_id,key_name,encrypted_value,is_active) VALUES (p_owner_id,p_key_name,v_secret::text,true);
    ELSE
      PERFORM vault.update_secret(v_secret, p_value);
      UPDATE public.provider_credentials SET updated_at=now(), is_active=true WHERE id=v_existing;
    END IF;
  ELSIF p_scope = 'gateway' THEN
    IF NOT EXISTS (SELECT 1 FROM public.payment_gateways WHERE id=p_owner_id) THEN RAISE EXCEPTION 'gateway not found'; END IF;
    SELECT id, vault_secret_id INTO v_existing, v_secret FROM public.gateway_credentials WHERE gateway_id=p_owner_id AND key_name=p_key_name;
    IF v_existing IS NULL THEN
      v_secret := vault.create_secret(p_value, 'gateway:'||p_owner_id||':'||p_key_name);
      INSERT INTO public.gateway_credentials(gateway_id,key_name,vault_secret_id) VALUES (p_owner_id,p_key_name,v_secret);
    ELSE
      PERFORM vault.update_secret(v_secret, p_value);
      UPDATE public.gateway_credentials SET updated_at=now() WHERE id=v_existing;
    END IF;
    UPDATE public.payment_gateways SET verification_status = CASE WHEN verification_status='not_configured' THEN 'configured' ELSE verification_status END, updated_at=now() WHERE id=p_owner_id;
  ELSE
    RAISE EXCEPTION 'invalid scope';
  END IF;
  PERFORM public._admin_audit('credential.set', p_scope, p_owner_id, jsonb_build_object('key_name',p_key_name)); -- value never logged
END $$;

CREATE OR REPLACE FUNCTION public.admin_credential_status(p_scope text, p_owner_id uuid)
RETURNS TABLE(key_name text, updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF p_scope='provider' THEN
    RETURN QUERY SELECT c.key_name, c.updated_at FROM public.provider_credentials c WHERE c.provider_id=p_owner_id AND c.is_active;
  ELSIF p_scope='gateway' THEN
    RETURN QUERY SELECT c.key_name, c.updated_at FROM public.gateway_credentials c WHERE c.gateway_id=p_owner_id;
  ELSE RAISE EXCEPTION 'invalid scope'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_save_gateway(
  p_slug text, p_enabled boolean, p_mode text, p_currency text,
  p_min numeric, p_max numeric, p_fee_pct numeric, p_config jsonb, p_sort integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_g public.payment_gateways%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_g FROM public.payment_gateways WHERE slug=p_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'gateway not found'; END IF;
  IF p_enabled AND NOT v_g.adapter_ready THEN
    RAISE EXCEPTION 'This gateway has no verified adapter/webhook handler yet and cannot be enabled';
  END IF;
  UPDATE public.payment_gateways SET is_enabled=p_enabled, mode=p_mode, currency=upper(p_currency),
    min_amount=p_min, max_amount=p_max, customer_fee_pct=p_fee_pct, config=coalesce(p_config,'{}'::jsonb),
    sort_order=p_sort, updated_at=now() WHERE id=v_g.id;
  PERFORM public._admin_audit('gateway.update','payment_gateway',v_g.id,jsonb_build_object('slug',p_slug,'enabled',p_enabled,'mode',p_mode));
END $$;

CREATE OR REPLACE FUNCTION public.public_enabled_gateways()
RETURNS TABLE(slug text, name text, currency text, min_amount numeric, max_amount numeric, customer_fee_pct numeric)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT slug, name, currency, min_amount, max_amount, customer_fee_pct
  FROM public.payment_gateways WHERE is_enabled AND adapter_ready ORDER BY sort_order;
$$;

-- grants: only signed-in users may call admin RPCs (they self-check admin); nothing for anon
REVOKE EXECUTE ON FUNCTION public.admin_save_provider(uuid,text,text,text,provider_auth_method,boolean,integer,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_credential(text,uuid,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_credential_status(text,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_save_gateway(text,boolean,text,text,numeric,numeric,numeric,jsonb,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.public_enabled_gateways() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_provider(uuid,text,text,text,provider_auth_method,boolean,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_credential(text,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_credential_status(text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_gateway(text,boolean,text,text,numeric,numeric,numeric,jsonb,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_enabled_gateways() TO authenticated;
