-- WARNING: re-opens the provider-cost leak. Orders tables are kept.
GRANT SELECT ON public.service_country_availability TO anon, authenticated;
DROP VIEW IF EXISTS public.admin_service_availability;
DROP FUNCTION IF EXISTS public.catalog_service_by_slug(text), public.catalog_service_countries(uuid), public.catalog_search_services(text,int,int);
DROP FUNCTION IF EXISTS public.quote_retail(uuid,uuid,numeric[]), public.order_refund(uuid,text), public.order_set_status(uuid,text,text);
