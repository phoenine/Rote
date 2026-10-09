-- One-time repair for rote.phoenine.top. Run against its database after backup.
-- Repairs only this bucket's known malformed prefixes. Re-running changes no rows.
-- Restart the API afterward to refresh cached storage settings.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.repair_rote_cos_url(value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  host text := 'rote-1258175280.cos.ap-nanjing.myqcloud.com';
  old_prefix text;
BEGIN
  FOREACH old_prefix IN ARRAY ARRAY[host,
    'https://rote.phoenine.top/' || host,
    'http://rote.phoenine.top/' || host]
  LOOP
    IF value = old_prefix OR value = old_prefix || '/' THEN
      RETURN 'https://' || host;
    ELSIF starts_with(value, old_prefix || '/') THEN
      RETURN 'https://' || host || substring(value FROM length(old_prefix) + 1);
    END IF;
  END LOOP;
  RETURN value;
END;
$$;

UPDATE settings SET
  config = jsonb_set(config, '{urlPrefix}', to_jsonb(pg_temp.repair_rote_cos_url(config->>'urlPrefix'))),
  "updatedAt" = now()
WHERE "group" = 'storage'
  AND config->>'urlPrefix' IS DISTINCT FROM pg_temp.repair_rote_cos_url(config->>'urlPrefix');

UPDATE users SET
  avatar = pg_temp.repair_rote_cos_url(avatar),
  cover = pg_temp.repair_rote_cos_url(cover),
  "updatedAt" = now()
WHERE avatar IS DISTINCT FROM pg_temp.repair_rote_cos_url(avatar)
   OR cover IS DISTINCT FROM pg_temp.repair_rote_cos_url(cover);

UPDATE attachments SET
  url = pg_temp.repair_rote_cos_url(url),
  "compressUrl" = pg_temp.repair_rote_cos_url("compressUrl"),
  "posterUrl" = pg_temp.repair_rote_cos_url("posterUrl"),
  details = CASE WHEN details ? 'pairedVideoUrl' THEN
    jsonb_set(details, '{pairedVideoUrl}', coalesce(to_jsonb(pg_temp.repair_rote_cos_url(details->>'pairedVideoUrl')), 'null'::jsonb))
    ELSE details END,
  "updatedAt" = now()
WHERE url IS DISTINCT FROM pg_temp.repair_rote_cos_url(url)
   OR "compressUrl" IS DISTINCT FROM pg_temp.repair_rote_cos_url("compressUrl")
   OR "posterUrl" IS DISTINCT FROM pg_temp.repair_rote_cos_url("posterUrl")
   OR details->>'pairedVideoUrl' IS DISTINCT FROM pg_temp.repair_rote_cos_url(details->>'pairedVideoUrl');

COMMIT;
