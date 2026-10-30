/* 012 - APPLIED to live DB (as "fix_import_bigint_and_sync_logs" + "fix_provider_country_codes")
   - stock counts from the provider exceed int4 -> import function uses bigint
   - provider_sync_logs.details nullable (error log rows were silently dropped)
   - real ISO codes for provider-misspelled countries; hide pseudo/duplicate entries
   - import no longer recreates countries whose provider id is already mapped */
DO $fix$
BEGIN
  EXECUTE replace(pg_get_functiondef('public.import_provider_catalog(uuid,jsonb,jsonb,jsonb)'::regprocedure), 'n integer', 'n bigint');
END
$fix$;
ALTER TABLE public.provider_sync_logs ALTER COLUMN details DROP NOT NULL;

UPDATE public.countries SET iso_code='SV', flag_emoji=E'\U0001F1F8\U0001F1FB', name='El Salvador'  WHERE iso_code='X101';
UPDATE public.countries SET iso_code='BN', flag_emoji=E'\U0001F1E7\U0001F1F3', name='Brunei'       WHERE iso_code='X121';
UPDATE public.countries SET iso_code='NA', flag_emoji=E'\U0001F1F3\U0001F1E6', name='Namibia'      WHERE iso_code='X138';
UPDATE public.countries SET iso_code='VC', flag_emoji=E'\U0001F1FB\U0001F1E8', name='Saint Vincent and the Grenadines' WHERE iso_code='X166';
UPDATE public.countries SET iso_code='LA', flag_emoji=E'\U0001F1F1\U0001F1E6', name='Laos'         WHERE iso_code='X25';
UPDATE public.countries SET iso_code='AR', flag_emoji=E'\U0001F1E6\U0001F1F7', name='Argentina'    WHERE iso_code='X39';
UPDATE public.countries SET iso_code='CZ', flag_emoji=E'\U0001F1E8\U0001F1FF', name='Czechia'      WHERE iso_code='X63';
UPDATE public.countries SET iso_code='PG', flag_emoji=E'\U0001F1F5\U0001F1EC', name='Papua New Guinea' WHERE iso_code='X79';
UPDATE public.countries SET is_active=false WHERE iso_code IN ('X999999','X12');

DO $fix$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.import_provider_catalog(uuid,jsonb,jsonb,jsonb)'::regprocedure);
  d := replace(d, E'WHERE coalesce(x.iso,'''') <> '''' AND coalesce(x.name,'''') <> ''''\n    ON CONFLICT (iso_code) DO NOTHING;',
    E'WHERE coalesce(x.iso,'''') <> '''' AND coalesce(x.name,'''') <> ''''\n      AND NOT EXISTS (SELECT 1 FROM public.provider_country_mappings m WHERE m.provider_id = p_provider_id AND m.provider_country_id = x.id)\n    ON CONFLICT (iso_code) DO NOTHING;');
  EXECUTE d;
END
$fix$;
