-- Restores demo catalog from backups (does not remove imported provider data).
INSERT INTO public.services SELECT * FROM public._bak_demo_services ON CONFLICT DO NOTHING;
INSERT INTO public.service_country_availability SELECT * FROM public._bak_demo_availability ON CONFLICT DO NOTHING;
INSERT INTO public.provider_service_mappings SELECT * FROM public._bak_demo_service_maps ON CONFLICT DO NOTHING;
UPDATE public.providers SET is_active = true WHERE slug = 'demo-provider';
DROP FUNCTION IF EXISTS public.admin_sync_status(uuid);
DROP FUNCTION IF EXISTS public.import_provider_catalog(uuid, jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS public._guess_category_id(text);
DROP FUNCTION IF EXISTS public.get_provider_secret(uuid, text);
DROP FUNCTION IF EXISTS public.current_user_is_admin();
