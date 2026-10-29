DROP FUNCTION IF EXISTS public.public_enabled_gateways();
DROP FUNCTION IF EXISTS public.admin_save_gateway(text,boolean,text,text,numeric,numeric,numeric,jsonb,integer);
DROP FUNCTION IF EXISTS public.admin_credential_status(text,uuid);
DROP FUNCTION IF EXISTS public.admin_set_credential(text,uuid,text,text);
DROP FUNCTION IF EXISTS public.admin_save_provider(uuid,text,text,text,provider_auth_method,boolean,integer,integer);
DROP FUNCTION IF EXISTS public._valid_https_url(text);
DROP FUNCTION IF EXISTS public._admin_audit(text,text,uuid,jsonb);
-- tables kept on purpose (may hold data): DROP TABLE public.gateway_credentials, public.payment_gateways manually if empty.
