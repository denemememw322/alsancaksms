-- Restores the catalog from backups. Tiers/exchange tables are kept.
INSERT INTO public.services (id,name,slug,description,category_id,icon,is_active,is_archived,is_demo,sort_order,created_at,updated_at)
  SELECT id,name,slug,description,category_id,icon,is_active,is_archived,is_demo,sort_order,created_at,updated_at FROM public._bak_services_20261031 ON CONFLICT DO NOTHING;
INSERT INTO public.provider_service_mappings SELECT * FROM public._bak_service_maps_20261031 ON CONFLICT DO NOTHING;
INSERT INTO public.service_country_availability (id,service_id,country_id,provider_id,wholesale_cost,retail_price,currency,is_available,pricing_method,manual_price_override,min_price,min_margin_pct,last_cost_update,last_price_sync,last_availability_check,is_demo,created_at,updated_at)
  SELECT id,service_id,country_id,provider_id,wholesale_cost,retail_price,currency,is_available,pricing_method,manual_price_override,min_price,min_margin_pct,last_cost_update,last_price_sync,last_availability_check,is_demo,created_at,updated_at FROM public._bak_availability_20261031 ON CONFLICT DO NOTHING;
