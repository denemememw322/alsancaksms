SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'reap-searching-orders';
GRANT SELECT ON public.orders TO authenticated;   -- re-exposes provider_cost to order owners
DROP VIEW IF EXISTS public.admin_orders;
