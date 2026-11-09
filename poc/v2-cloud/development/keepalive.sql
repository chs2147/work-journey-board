-- Development only. Mirrors woori-bldg 0012: pg_cron, daily singleton heartbeat.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='keepalive_ping') THEN
  RAISE EXCEPTION 'KEEPALIVE_JOB_COLLISION'; END IF;
END$$;
CREATE TABLE public.keepalive_pings (
 id smallint PRIMARY KEY DEFAULT 1,
 pinged_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT keepalive_pings_singleton CHECK(id=1)
);
ALTER TABLE public.keepalive_pings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.keepalive_pings FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.keepalive_pings(id,pinged_at) VALUES(1,now());
SELECT cron.schedule('keepalive_ping','0 3 * * *',$job$
 INSERT INTO public.keepalive_pings(id,pinged_at) VALUES(1,now())
 ON CONFLICT(id) DO UPDATE SET pinged_at=excluded.pinged_at;
 DELETE FROM cron.job_run_details
 WHERE jobid IN(SELECT jobid FROM cron.job WHERE jobname='keepalive_ping' AND username=current_user)
 AND end_time < now()-interval '14 days';
$job$);
COMMIT;
