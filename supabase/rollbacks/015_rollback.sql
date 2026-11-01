SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'price-sync-10min';
