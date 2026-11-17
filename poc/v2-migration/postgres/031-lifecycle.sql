-- REVIEW ONLY; no cloud auto-apply. Development project only (docs/v2-design/100 G-5 데이터 수명, 결정 G-D4).
-- Apply once after 028. Existing functions/tables are NOT replaced. Adds:
--  * delete a space from the server (owner) — records, sync rows and usage go at once; the space disappears from the
--    list, sync/read answer *_NOT_FOUND on other devices; its images move to 'cleanup' and the gateway worker deletes
--    the private objects, then confirms absence here (quota returned only after absence is observed).
--  * delete an account (self, or the admin for another account — never the admin itself) — every space of it as above,
--    devices revoked, account limits row removed, and a row for the gateway to delete the Auth user.
--  * unused images: a ready image of a synced space that no current record references (dataRef/thumbRef) for 7 days
--    moves to 'cleanup' and goes the same way. Newly declared images get the same 7 days before they can be counted.
-- Two server-only RPCs: public.wjb_v2_lifecycle (user, checks the session) and public.wjb_v2_lifecycle_worker (gateway
-- worker only, no user). Local device copies are never touched by the server.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF to_regnamespace('wjb_ops') IS NULL THEN RAISE EXCEPTION 'MIGRATION_028_REQUIRED'; END IF;
 IF to_regnamespace('wjb_life') IS NOT NULL THEN RAISE EXCEPTION 'MIGRATION_031_ALREADY_APPLIED'; END IF;
END $$;
CREATE SCHEMA wjb_life;
REVOKE ALL ON SCHEMA wjb_life FROM PUBLIC;
-- 서버에서 지우는 중·지운 공간(공간 지우기·계정 삭제). done_at = 그림 실물까지 다 지움
CREATE TABLE wjb_life.purge(
 workspace_id uuid PRIMARY KEY REFERENCES wjb_gateway.workspace(id),
 owner_id uuid NOT NULL,
 reason text NOT NULL CHECK(reason IN('space','account')),
 requested_by uuid NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 done_at timestamptz);
-- 참조 없는 그림(공간이 살아 있는 동안). since부터 grace가 지나면 released=true(=cleanup으로 넘김)
CREATE TABLE wjb_life.orphan(
 workspace_id uuid NOT NULL,
 asset_id uuid NOT NULL,
 since timestamptz NOT NULL,
 released boolean NOT NULL DEFAULT false,
 PRIMARY KEY(workspace_id,asset_id),
 FOREIGN KEY(workspace_id,asset_id) REFERENCES wjb_gateway.asset(workspace_id,id));
-- 지운 계정(게이트웨이가 Auth 사용자를 지운 뒤 auth_deleted_at)
CREATE TABLE wjb_life.account_gone(
 user_id uuid PRIMARY KEY,
 requested_by uuid NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 auth_deleted_at timestamptz);
ALTER TABLE wjb_life.purge ENABLE ROW LEVEL SECURITY;
ALTER TABLE wjb_life.orphan ENABLE ROW LEVEL SECURITY;
ALTER TABLE wjb_life.account_gone ENABLE ROW LEVEL SECURITY;

-- 보관 기간(그림을 참조에서 뺀 뒤 서버에서 지우기까지) — 2026-11-17 G-D4: 7일
CREATE FUNCTION wjb_life.grace() RETURNS interval LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT interval '7 days' $$;

-- 공간 하나를 서버에서 지운다(한 묶음). 이미 지우는 중이면 그대로 돌려준다
CREATE FUNCTION wjb_life.purge_space(ws uuid,owner uuid,why text,who uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j wjb_migration.job;pr wjb_life.purge;n integer;
BEGIN
 SELECT * INTO pr FROM wjb_life.purge WHERE workspace_id=ws;
 IF FOUND THEN
  IF pr.owner_id<>owner THEN RAISE EXCEPTION 'LIFE_NOT_FOUND'; END IF;
  RETURN jsonb_build_object('workspaceId',ws,'state',CASE WHEN pr.done_at IS NULL THEN 'purging' ELSE 'deleted' END);
 END IF;
 SELECT * INTO j FROM wjb_migration.job WHERE workspace_id=ws AND owner_id=owner AND state<>'canceled' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LIFE_NOT_FOUND'; END IF;
 -- 목록·읽기·동기화에서 바로 사라지게(connected가 아니면 다른 기기는 *_NOT_FOUND)
 UPDATE wjb_migration.job SET state='canceled',epoch=epoch+1,publish_fence=publish_fence+1,publish_token=NULL,publish_expires=NULL WHERE id=j.id;
 -- 기록(트리거가 사용량 캐시를 줄임) → 동기화 표 → 사용량 캐시 줄
 DELETE FROM wjb_sync.record WHERE workspace_id=ws;
 DELETE FROM wjb_sync.applied WHERE workspace_id=ws;
 DELETE FROM wjb_sync.asset_declared WHERE workspace_id=ws;
 DELETE FROM wjb_sync.space WHERE workspace_id=ws;
 DELETE FROM wjb_migration.workspace_record WHERE job_id=j.id;
 DELETE FROM wjb_migration.workspace_header WHERE job_id=j.id;
 DELETE FROM wjb_ops.space_bytes WHERE workspace_id=ws;
 DELETE FROM wjb_life.orphan WHERE workspace_id=ws;
 -- 그림: 실물은 게이트웨이 작업자가 지우고 여기서 없는 것을 확인한 뒤 용량을 돌려준다
 UPDATE wjb_gateway.asset SET state='cleanup',io_version=io_version+1 WHERE workspace_id=ws AND state<>'canceled';
 GET DIAGNOSTICS n=ROW_COUNT;
 INSERT INTO wjb_life.purge(workspace_id,owner_id,reason,requested_by) VALUES(ws,owner,why,who);
 RETURN jsonb_build_object('workspaceId',ws,'state','purging','images',n);
END $$;

-- 그 그림을 지금 기록이 참조하는가(지움 표시 = value NULL은 참조 아님)
CREATE FUNCTION wjb_life.referenced(ws uuid,aid uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM wjb_sync.record r WHERE r.workspace_id=ws AND r.value IS NOT NULL
  AND (r.value->'dataRef'->>'objectId'=aid::text OR r.value->'thumbRef'->>'objectId'=aid::text)) $$;

-- 참조 없는 그림 표시·해제. p_now = 기준 시각(작업자·예약 실행은 clock_timestamp())
CREATE FUNCTION wjb_life.sweep_orphans(p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE marked integer;released integer;revived integer;
BEGIN
 -- 다시 참조되면 표시를 뗀다(아직 넘기지 않은 것만)
 DELETE FROM wjb_life.orphan o WHERE NOT o.released AND wjb_life.referenced(o.workspace_id,o.asset_id);
 GET DIAGNOSTICS revived=ROW_COUNT;
 -- 동기화한 적 있고 지우는 중이 아닌 공간의 ready 그림 중 참조 없는 것(새로 올린 것은 보관 기간이 지난 뒤부터)
 INSERT INTO wjb_life.orphan(workspace_id,asset_id,since)
  SELECT a.workspace_id,a.id,p_now FROM wjb_gateway.asset a JOIN wjb_sync.space s ON s.workspace_id=a.workspace_id
   WHERE a.state='ready'
    AND NOT EXISTS(SELECT 1 FROM wjb_life.purge p WHERE p.workspace_id=a.workspace_id)
    AND NOT EXISTS(SELECT 1 FROM wjb_sync.asset_declared d WHERE d.workspace_id=a.workspace_id AND d.object_id=a.id AND d.created_at>p_now-wjb_life.grace())
    AND NOT wjb_life.referenced(a.workspace_id,a.id)
  ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS marked=ROW_COUNT;
 -- 보관 기간이 지나도 여전히 참조 없는 것만 넘긴다
 WITH due AS (
  UPDATE wjb_life.orphan o SET released=true
   WHERE NOT o.released AND o.since<=p_now-wjb_life.grace()
    AND NOT wjb_life.referenced(o.workspace_id,o.asset_id)
    AND EXISTS(SELECT 1 FROM wjb_gateway.asset a WHERE a.workspace_id=o.workspace_id AND a.id=o.asset_id AND a.state='ready')
   RETURNING o.workspace_id,o.asset_id)
 UPDATE wjb_gateway.asset a SET state='cleanup',io_version=a.io_version+1 FROM due
  WHERE a.workspace_id=due.workspace_id AND a.id=due.asset_id AND a.state='ready';
 GET DIAGNOSTICS released=ROW_COUNT;
 RETURN jsonb_build_object('marked',marked,'released',released,'revived',revived);
END $$;

-- 사용자 요청(세션 확인): delete_space · delete_account · pending(내 지우는 중 공간 수)
CREATE FUNCTION public.wjb_v2_lifecycle(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE action text:=p_request->>'action';u uuid;s uuid;dev uuid;p jsonb:=p_request->'params';t uuid;ws uuid;r jsonb;n integer:=0;
BEGIN
 IF action IS NULL OR action NOT IN('delete_space','delete_account') THEN RAISE EXCEPTION 'LIFE_INVALID_REQUEST'; END IF;
 IF NOT wjb_migration.keys_exact(p_request,ARRAY['action','userId','sessionId','deviceId','params']) OR jsonb_typeof(p)<>'object'
    OR octet_length(p_request::text)>2048 THEN RAISE EXCEPTION 'LIFE_INVALID_REQUEST'; END IF;
 u:=(p_request->>'userId')::uuid;s:=(p_request->>'sessionId')::uuid;dev:=(p_request->>'deviceId')::uuid;
 PERFORM 1 FROM wjb_gateway.device WHERE id=dev AND user_id=u AND session_id=s AND NOT revoked;
 IF NOT FOUND OR NOT public.wjb_v2_session_active(u,s) THEN RAISE EXCEPTION 'LIFE_ACCESS_DENIED'; END IF;
 IF action='delete_space' THEN
  IF NOT wjb_migration.keys_exact(p,ARRAY['workspaceId']) THEN RAISE EXCEPTION 'LIFE_INVALID_REQUEST'; END IF;
  ws:=(p->>'workspaceId')::uuid;
  RETURN wjb_life.purge_space(ws,u,'space',u);
 END IF;
 -- delete_account: {} = 나, {userId} = 관리자가 다른 계정. 관리자 계정은 지우지 않는다(고정)
 IF wjb_migration.keys_exact(p,ARRAY[]::text[]) THEN t:=u;
 ELSIF wjb_migration.keys_exact(p,ARRAY['userId']) THEN
  t:=(p->>'userId')::uuid;
  IF t<>u AND NOT wjb_ops.is_admin(u) THEN RAISE EXCEPTION 'ACCOUNT_NOT_ADMIN'; END IF;
 ELSE RAISE EXCEPTION 'LIFE_INVALID_REQUEST'; END IF;
 IF wjb_ops.is_admin(t) THEN RAISE EXCEPTION 'ACCOUNT_ADMIN_FIXED'; END IF;
 PERFORM 1 FROM auth.users WHERE id=t AND deleted_at IS NULL;
 IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM wjb_life.account_gone WHERE user_id=t) THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND'; END IF;
 FOR ws IN SELECT j.workspace_id FROM wjb_migration.job j WHERE j.owner_id=t AND j.state<>'canceled' ORDER BY j.workspace_id LOOP
  PERFORM wjb_life.purge_space(ws,t,'account',u);
  n:=n+1;
 END LOOP;
 UPDATE wjb_gateway.device SET revoked=true WHERE user_id=t AND NOT revoked;
 DELETE FROM wjb_ops.account WHERE user_id=t;
 INSERT INTO wjb_life.account_gone(user_id,requested_by) VALUES(t,u) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('userId',t,'spaces',n,'state','purging');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'LIFE_INVALID_REQUEST';
END $$;

-- 게이트웨이 작업자 전용(사용자 없음): next · confirm · sweep · auth_pending · auth_deleted
CREATE FUNCTION public.wjb_v2_lifecycle_worker(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE action text:=p_request->>'action';p jsonb:=p_request->'params';lim integer;ws uuid;aid uuid;ver bigint;a wjb_gateway.asset;
BEGIN
 IF action IS NULL OR action NOT IN('next','confirm','sweep','auth_pending','auth_deleted') THEN RAISE EXCEPTION 'LIFE_INVALID_REQUEST'; END IF;
 IF NOT wjb_migration.keys_exact(p_request,ARRAY['action','params']) OR jsonb_typeof(p)<>'object' THEN RAISE EXCEPTION 'LIFE_INVALID_REQUEST'; END IF;
 IF action='sweep' THEN
  IF NOT wjb_migration.keys_exact(p,ARRAY[]::text[]) THEN RAISE EXCEPTION 'LIFE_INVALID_REQUEST'; END IF;
  RETURN wjb_life.sweep_orphans(clock_timestamp());
 END IF;
 IF action='next' THEN
  IF NOT wjb_migration.keys_exact(p,ARRAY['limit']) OR jsonb_typeof(p->'limit')<>'number' THEN RAISE EXCEPTION 'LIFE_INVALID_REQUEST'; END IF;
  lim:=(p->>'limit')::integer;
  IF lim<1 OR lim>50 THEN RAISE EXCEPTION 'LIFE_INVALID_REQUEST'; END IF;
  -- 그림을 다 지운 공간은 끝 표시
  UPDATE wjb_life.purge pr SET done_at=clock_timestamp() WHERE pr.done_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM wjb_gateway.asset x WHERE x.workspace_id=pr.workspace_id AND x.state<>'canceled');
  RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(jsonb_build_object('workspaceId',q.workspace_id,'assetId',q.id,'ioVersion',q.io_version::text))
   FROM (SELECT x.workspace_id,x.id,x.io_version FROM wjb_gateway.asset x
    WHERE x.state='cleanup'
     AND (EXISTS(SELECT 1 FROM wjb_life.purge pr WHERE pr.workspace_id=x.workspace_id)
      OR EXISTS(SELECT 1 FROM wjb_life.orphan o WHERE o.workspace_id=x.workspace_id AND o.asset_id=x.id AND o.released))
     AND (x.lease_expires IS NULL OR x.lease_expires<=clock_timestamp())
     AND NOT EXISTS(SELECT 1 FROM wjb_gateway.io_intent i WHERE i.workspace_id=x.workspace_id AND i.asset_id=x.id AND NOT i.settled)
    ORDER BY x.workspace_id,x.id LIMIT lim) q),'[]'::jsonb),
   'pendingSpaces',(SELECT count(*) FROM wjb_life.purge WHERE done_at IS NULL));
 END IF;
 IF action='confirm' THEN
  -- 게이트웨이가 실물을 지우고 없는 것을 확인한 뒤에만
  IF NOT wjb_migration.keys_exact(p,ARRAY['workspaceId','assetId','ioVersion']) THEN RAISE EXCEPTION 'LIFE_INVALID_REQUEST'; END IF;
  ws:=(p->>'workspaceId')::uuid;aid:=(p->>'assetId')::uuid;ver:=(p->>'ioVersion')::bigint;
  SELECT * INTO a FROM wjb_gateway.asset WHERE workspace_id=ws AND id=aid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LIFE_NOT_FOUND'; END IF;
  IF a.state='canceled' THEN RETURN jsonb_build_object('absentConfirmed',true); END IF;
  IF a.state<>'cleanup' OR a.io_version<>ver
     OR NOT (EXISTS(SELECT 1 FROM wjb_life.purge pr WHERE pr.workspace_id=ws)
      OR EXISTS(SELECT 1 FROM wjb_life.orphan o WHERE o.workspace_id=ws AND o.asset_id=aid AND o.released))
     OR (a.lease_expires IS NOT NULL AND a.lease_expires>clock_timestamp())
     OR EXISTS(SELECT 1 FROM wjb_gateway.io_intent i WHERE i.workspace_id=ws AND i.asset_id=aid AND NOT i.settled)
   THEN RAISE EXCEPTION 'LIFE_NOT_PENDING'; END IF;
  UPDATE wjb_gateway.asset SET state='canceled' WHERE workspace_id=ws AND id=aid;
  -- 예약 때 더한 만큼 돌려준다(0 아래로는 내려가지 않게)
  UPDATE wjb_gateway.workspace SET used_bytes=greatest(used_bytes-a.bytes,0) WHERE id=ws;
  RETURN jsonb_build_object('absentConfirmed',true);
 END IF;
 IF action='auth_pending' THEN
  IF NOT wjb_migration.keys_exact(p,ARRAY[]::text[]) THEN RAISE EXCEPTION 'LIFE_INVALID_REQUEST'; END IF;
  RETURN jsonb_build_object('users',coalesce((SELECT jsonb_agg(g.user_id ORDER BY g.requested_at) FROM
   (SELECT user_id,requested_at FROM wjb_life.account_gone WHERE auth_deleted_at IS NULL ORDER BY requested_at LIMIT 20) g),'[]'::jsonb));
 END IF;
 -- auth_deleted: 게이트웨이가 Auth 사용자를 지운 뒤(없으면 지운 것으로 봄)
 IF NOT wjb_migration.keys_exact(p,ARRAY['userId']) THEN RAISE EXCEPTION 'LIFE_INVALID_REQUEST'; END IF;
 UPDATE wjb_life.account_gone SET auth_deleted_at=coalesce(auth_deleted_at,clock_timestamp()) WHERE user_id=(p->>'userId')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'LIFE_NOT_FOUND'; END IF;
 RETURN jsonb_build_object('authDeleted',true);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'LIFE_INVALID_REQUEST';
END $$;
REVOKE ALL ON FUNCTION public.wjb_v2_lifecycle(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.wjb_v2_lifecycle_worker(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wjb_v2_lifecycle(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.wjb_v2_lifecycle_worker(jsonb) TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wjb_life FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA wjb_life FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
