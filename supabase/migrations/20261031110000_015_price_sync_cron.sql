/* 015 - APPLIED to live DB as "price_sync_cron". Every 10 minutes the price-sync Edge Function refreshes
   stock, provider cost and sell prices (cost x admin ratio, never below cost) for the 25 least-recently
   synced services, and the USD/TRY rate from TCMB. Authentication: shared secret kept in Vault (never in code). */
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cron_secret', 'shared secret for the scheduled price-sync function');
  END IF;
END $$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'price-sync-10min';
SELECT cron.schedule(
  'price-sync-10min',
  '*/10 * * * *',
  $job$
    SELECT net.http_post(
      url := 'https://mvazvhlpwjgchvwbxsxt.supabase.co/functions/v1/price-sync',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')),
      body := '{"limit": 25}'::jsonb
    );
  $job$
);
