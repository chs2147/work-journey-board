-- REVIEW ONLY; no cloud auto-apply. Development project only (docs/v2-design/96 G 운영 준비 Q-1).
-- Apply once after 019 (022/025 may be installed). Account limits + one fixed admin + project safety line for the
-- Supabase free plan. Existing functions are NOT replaced: limits are enforced by triggers on the rows they write.
--  * images  : wjb_gateway.workspace.used_bytes grows (asset reserve) -> account image limit + project image line
--  * spaces  : new wjb_gateway.workspace row (copy start)              -> account space limit + project lines
--  * records : wjb_migration.workspace_record / wjb_sync.record bytes  -> account record limit + project DB line
--    (only changes that grow and are not the initial copy rev 0 are refused: receiving and deleting always work)
-- Admin is unlimited per account but still under the project safety line (2026-11-17 user decision Q2).
-- The admin e-mail is never stored in this file: the apply tool resolves WJB_ADMIN_EMAIL to a user id.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF to_regnamespace('wjb_sync') IS NULL THEN RAISE EXCEPTION 'MIGRATION_019_REQUIRED'; END IF;
 IF to_regnamespace('wjb_ops') IS NOT NULL THEN RAISE EXCEPTION 'MIGRATION_028_ALREADY_APPLIED'; END IF;
END $$;
CREATE SCHEMA wjb_ops;
REVOKE ALL ON SCHEMA wjb_ops FROM PUBLIC;
-- 기본 한도·안전선(바이트, 공간 수) — 2026-11-17 Q1: 그림 100MB · 공간 3 · 기록 30MB, 안전선 그림 800MB · DB 400MB
CREATE TABLE wjb_ops.setting(
 key text PRIMARY KEY CHECK(key IN ('default_images','default_spaces','default_records','project_images','project_db')),
 value bigint NOT NULL CHECK(value>0));
INSERT INTO wjb_ops.setting VALUES('default_images',104857600),('default_spaces',3),('default_records',31457280),
 ('project_images',838860800),('project_db',419430400);
-- 관리자 = 계정 하나(고정)
CREATE TABLE wjb_ops.admin(one boolean PRIMARY KEY DEFAULT true CHECK(one), user_id uuid NOT NULL UNIQUE);
-- 계정별 조정(없으면 기본). 값 NULL = 기본값, unlimited = 계정 한도 없음(안전선은 남음), suspended = 읽기만
CREATE TABLE wjb_ops.account(
 user_id uuid PRIMARY KEY,
 images bigint CHECK(images IS NULL OR images>=0),
 spaces integer CHECK(spaces IS NULL OR spaces>=0),
 records bigint CHECK(records IS NULL OR records>=0),
 unlimited boolean NOT NULL DEFAULT false,
 suspended boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
-- 공간별 기록 바이트(게시본 / 동기화 기록). 계정 사용량 = 동기화가 시작된 공간은 동기화 쪽, 아니면 게시본
CREATE TABLE wjb_ops.space_bytes(
 workspace_id uuid PRIMARY KEY, owner_id uuid NOT NULL,
 published bigint NOT NULL DEFAULT 0, synced bigint NOT NULL DEFAULT 0);
CREATE INDEX space_bytes_owner ON wjb_ops.space_bytes(owner_id);
-- DB 크기(60초 캐시 — 쓰기마다 크기를 재지 않게)
CREATE TABLE wjb_ops.db_size(one boolean PRIMARY KEY DEFAULT true CHECK(one), bytes bigint NOT NULL, at timestamptz NOT NULL);

CREATE FUNCTION wjb_ops.setting_of(k text) RETURNS bigint LANGUAGE sql STABLE SET search_path=pg_catalog AS
$$ SELECT value FROM wjb_ops.setting WHERE key=k $$;
CREATE FUNCTION wjb_ops.is_admin(u uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS
$$ SELECT EXISTS(SELECT 1 FROM wjb_ops.admin WHERE user_id=u) $$;
CREATE FUNCTION wjb_ops.suspended(u uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS
$$ SELECT NOT wjb_ops.is_admin(u) AND coalesce((SELECT suspended FROM wjb_ops.account WHERE user_id=u),false) $$;
-- 실제 적용 한도(NULL = 없음)
CREATE FUNCTION wjb_ops.limits(u uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE a wjb_ops.account;
BEGIN
 SELECT * INTO a FROM wjb_ops.account WHERE user_id=u;
 IF wjb_ops.is_admin(u) OR coalesce(a.unlimited,false) THEN
  RETURN jsonb_build_object('images',NULL,'spaces',NULL,'records',NULL);
 END IF;
 RETURN jsonb_build_object(
  'images',coalesce(a.images,wjb_ops.setting_of('default_images')),
  'spaces',coalesce(a.spaces,wjb_ops.setting_of('default_spaces')::integer),
  'records',coalesce(a.records,wjb_ops.setting_of('default_records')));
END $$;
CREATE FUNCTION wjb_ops.used_images(u uuid) RETURNS bigint LANGUAGE sql STABLE SET search_path=pg_catalog AS
$$ SELECT coalesce(sum(used_bytes),0)::bigint FROM wjb_gateway.workspace WHERE owner_id=u $$;
CREATE FUNCTION wjb_ops.used_spaces(u uuid) RETURNS integer LANGUAGE sql STABLE SET search_path=pg_catalog AS
$$ SELECT count(*)::integer FROM wjb_gateway.workspace w WHERE w.owner_id=u
    AND NOT EXISTS(SELECT 1 FROM wjb_migration.job j WHERE j.workspace_id=w.id AND j.state='canceled') $$;
CREATE FUNCTION wjb_ops.used_records(u uuid) RETURNS bigint LANGUAGE sql STABLE SET search_path=pg_catalog AS
$$ SELECT coalesce(sum(CASE WHEN synced>0 THEN synced ELSE published END),0)::bigint FROM wjb_ops.space_bytes WHERE owner_id=u $$;
CREATE FUNCTION wjb_ops.project_images() RETURNS bigint LANGUAGE sql STABLE SET search_path=pg_catalog AS
$$ SELECT coalesce(sum(used_bytes),0)::bigint FROM wjb_gateway.workspace $$;
CREATE FUNCTION wjb_ops.db_bytes() RETURNS bigint LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c wjb_ops.db_size;
BEGIN
 SELECT * INTO c FROM wjb_ops.db_size;
 IF FOUND AND c.at>clock_timestamp()-interval '60 seconds' THEN RETURN c.bytes; END IF;
 INSERT INTO wjb_ops.db_size VALUES(true,pg_database_size(current_database()),clock_timestamp())
  ON CONFLICT(one) DO UPDATE SET bytes=excluded.bytes,at=excluded.at;
 RETURN pg_database_size(current_database());
END $$;

-- ── 검사 ──
CREATE FUNCTION wjb_ops.guard_records(u uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE lim bigint:=(wjb_ops.limits(u)->>'records')::bigint;
BEGIN
 IF wjb_ops.suspended(u) THEN RAISE EXCEPTION 'ACCOUNT_SUSPENDED'; END IF;
 IF lim IS NOT NULL AND wjb_ops.used_records(u)>lim THEN RAISE EXCEPTION 'QUOTA_ACCOUNT_RECORDS'; END IF;
 IF wjb_ops.db_bytes()>wjb_ops.setting_of('project_db') THEN RAISE EXCEPTION 'QUOTA_PROJECT'; END IF;
END $$;
-- 새 공간(복제 시작)
CREATE FUNCTION wjb_ops.trg_space_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lim integer;
BEGIN
 IF wjb_ops.suspended(NEW.owner_id) THEN RAISE EXCEPTION 'ACCOUNT_SUSPENDED'; END IF;
 lim:=(wjb_ops.limits(NEW.owner_id)->>'spaces')::integer;
 IF lim IS NOT NULL AND wjb_ops.used_spaces(NEW.owner_id)>=lim THEN RAISE EXCEPTION 'QUOTA_ACCOUNT_SPACES'; END IF;
 IF wjb_ops.project_images()>=wjb_ops.setting_of('project_images') OR wjb_ops.db_bytes()>wjb_ops.setting_of('project_db')
  THEN RAISE EXCEPTION 'QUOTA_PROJECT'; END IF;
 RETURN NEW;
END $$;
-- 그림 예약(사용량이 늘 때만)
CREATE FUNCTION wjb_ops.trg_space_images() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lim bigint;add bigint:=NEW.used_bytes-OLD.used_bytes;
BEGIN
 IF wjb_ops.suspended(NEW.owner_id) THEN RAISE EXCEPTION 'ACCOUNT_SUSPENDED'; END IF;
 lim:=(wjb_ops.limits(NEW.owner_id)->>'images')::bigint;
 IF lim IS NOT NULL AND wjb_ops.used_images(NEW.owner_id)+add>lim THEN RAISE EXCEPTION 'QUOTA_ACCOUNT_IMAGES'; END IF;
 IF wjb_ops.project_images()+add>wjb_ops.setting_of('project_images') THEN RAISE EXCEPTION 'QUOTA_PROJECT'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wjb_ops_space_insert BEFORE INSERT ON wjb_gateway.workspace FOR EACH ROW EXECUTE FUNCTION wjb_ops.trg_space_insert();
CREATE TRIGGER wjb_ops_space_images BEFORE UPDATE OF used_bytes ON wjb_gateway.workspace FOR EACH ROW
 WHEN (NEW.used_bytes>OLD.used_bytes) EXECUTE FUNCTION wjb_ops.trg_space_images();

-- 기록 바이트(문장 단위, 바뀐 행 표로 공간별 합계)
CREATE FUNCTION wjb_ops.add_bytes(ws uuid, owner uuid, d_pub bigint, d_sync bigint, enforce boolean) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO wjb_ops.space_bytes AS s(workspace_id,owner_id,published,synced) VALUES(ws,owner,greatest(d_pub,0),greatest(d_sync,0))
  ON CONFLICT(workspace_id) DO UPDATE SET published=greatest(s.published+d_pub,0),synced=greatest(s.synced+d_sync,0);
 IF enforce THEN PERFORM wjb_ops.guard_records(owner); END IF;
END $$;
CREATE FUNCTION wjb_ops.trg_pub_ins() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r record;
BEGIN
 FOR r IN SELECT j.workspace_id ws,j.owner_id owner,sum(octet_length(n.value::text))::bigint d
  FROM nt n JOIN wjb_migration.job j ON j.id=n.job_id GROUP BY j.workspace_id,j.owner_id LOOP
  PERFORM wjb_ops.add_bytes(r.ws,r.owner,r.d,0,r.d>0);
 END LOOP;
 RETURN NULL;
END $$;
CREATE FUNCTION wjb_ops.trg_pub_del() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r record;
BEGIN
 FOR r IN SELECT j.workspace_id ws,j.owner_id owner,sum(octet_length(o.value::text))::bigint d
  FROM ot o JOIN wjb_migration.job j ON j.id=o.job_id GROUP BY j.workspace_id,j.owner_id LOOP
  PERFORM wjb_ops.add_bytes(r.ws,r.owner,-r.d,0,false);
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER wjb_ops_pub_ins AFTER INSERT ON wjb_migration.workspace_record REFERENCING NEW TABLE AS nt
 FOR EACH STATEMENT EXECUTE FUNCTION wjb_ops.trg_pub_ins();
CREATE TRIGGER wjb_ops_pub_del AFTER DELETE ON wjb_migration.workspace_record REFERENCING OLD TABLE AS ot
 FOR EACH STATEMENT EXECUTE FUNCTION wjb_ops.trg_pub_del();

-- 동기화 기록: 처음 복사(rev 0)는 검사하지 않음(받기는 늘 됨), 고친 것(rev>0)이 늘었을 때만 검사
CREATE FUNCTION wjb_ops.trg_sync_ins() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r record;
BEGIN
 FOR r IN SELECT n.workspace_id ws,s.owner_id owner,sum(coalesce(octet_length(n.value::text),0))::bigint d,bool_or(n.rev>0) edited
  FROM nt n JOIN wjb_sync.space s ON s.workspace_id=n.workspace_id GROUP BY n.workspace_id,s.owner_id LOOP
  PERFORM wjb_ops.add_bytes(r.ws,r.owner,0,r.d,r.edited AND r.d>0);
 END LOOP;
 RETURN NULL;
END $$;
CREATE FUNCTION wjb_ops.trg_sync_upd() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r record;
BEGIN
 FOR r IN SELECT n.workspace_id ws,s.owner_id owner,
   (sum(coalesce(octet_length(n.value::text),0))-sum(coalesce(octet_length(o.value::text),0)))::bigint d,bool_or(n.rev>0) edited
  FROM nt n JOIN ot o ON o.workspace_id=n.workspace_id AND o.table_name=n.table_name AND o.record_key=n.record_key
  JOIN wjb_sync.space s ON s.workspace_id=n.workspace_id GROUP BY n.workspace_id,s.owner_id LOOP
  PERFORM wjb_ops.add_bytes(r.ws,r.owner,0,r.d,r.edited AND r.d>0);
 END LOOP;
 RETURN NULL;
END $$;
CREATE FUNCTION wjb_ops.trg_sync_del() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r record;
BEGIN
 FOR r IN SELECT o.workspace_id ws,s.owner_id owner,sum(coalesce(octet_length(o.value::text),0))::bigint d
  FROM ot o JOIN wjb_sync.space s ON s.workspace_id=o.workspace_id GROUP BY o.workspace_id,s.owner_id LOOP
  PERFORM wjb_ops.add_bytes(r.ws,r.owner,0,-r.d,false);
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER wjb_ops_sync_ins AFTER INSERT ON wjb_sync.record REFERENCING NEW TABLE AS nt
 FOR EACH STATEMENT EXECUTE FUNCTION wjb_ops.trg_sync_ins();
CREATE TRIGGER wjb_ops_sync_upd AFTER UPDATE ON wjb_sync.record REFERENCING OLD TABLE AS ot NEW TABLE AS nt
 FOR EACH STATEMENT EXECUTE FUNCTION wjb_ops.trg_sync_upd();
CREATE TRIGGER wjb_ops_sync_del AFTER DELETE ON wjb_sync.record REFERENCING OLD TABLE AS ot
 FOR EACH STATEMENT EXECUTE FUNCTION wjb_ops.trg_sync_del();

-- 지금 있는 자료로 공간별 바이트 채우기
INSERT INTO wjb_ops.space_bytes(workspace_id,owner_id,published)
 SELECT j.workspace_id,j.owner_id,sum(octet_length(x.value::text))::bigint
 FROM wjb_migration.workspace_record x JOIN wjb_migration.job j ON j.id=x.job_id GROUP BY j.workspace_id,j.owner_id
 ON CONFLICT(workspace_id) DO NOTHING;
INSERT INTO wjb_ops.space_bytes AS b(workspace_id,owner_id,synced)
 SELECT r.workspace_id,s.owner_id,sum(coalesce(octet_length(r.value::text),0))::bigint
 FROM wjb_sync.record r JOIN wjb_sync.space s ON s.workspace_id=r.workspace_id GROUP BY r.workspace_id,s.owner_id
 ON CONFLICT(workspace_id) DO UPDATE SET synced=excluded.synced;

-- ── 서버 전용 RPC(gateway service role만): 내 사용량 · 관리자 목록·설정 ──
CREATE FUNCTION wjb_ops.usage_json(u uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('limits',wjb_ops.limits(u),
  'used',jsonb_build_object('images',wjb_ops.used_images(u),'spaces',wjb_ops.used_spaces(u),'records',wjb_ops.used_records(u)),
  'unlimited',wjb_ops.is_admin(u) OR coalesce((SELECT unlimited FROM wjb_ops.account WHERE user_id=u),false),
  'suspended',wjb_ops.suspended(u),'admin',wjb_ops.is_admin(u)) $$;
CREATE FUNCTION public.wjb_v2_account(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE action text:=p_request->>'action';u uuid;s uuid;dev uuid;p jsonb:=p_request->'params';t uuid;a wjb_ops.account;
BEGIN
 IF action IS NULL OR action NOT IN('usage','admin_list','admin_set') THEN RAISE EXCEPTION 'ACCOUNT_INVALID_REQUEST'; END IF;
 IF NOT wjb_migration.keys_exact(p_request,ARRAY['action','userId','sessionId','deviceId','params']) OR jsonb_typeof(p)<>'object'
    OR octet_length(p_request::text)>4096 THEN RAISE EXCEPTION 'ACCOUNT_INVALID_REQUEST'; END IF;
 u:=(p_request->>'userId')::uuid;s:=(p_request->>'sessionId')::uuid;dev:=(p_request->>'deviceId')::uuid;
 PERFORM 1 FROM wjb_gateway.device WHERE id=dev AND user_id=u AND session_id=s AND NOT revoked;
 IF NOT FOUND OR NOT public.wjb_v2_session_active(u,s) THEN RAISE EXCEPTION 'ACCOUNT_ACCESS_DENIED'; END IF;
 IF action='usage' THEN
  IF NOT wjb_migration.keys_exact(p,ARRAY[]::text[]) THEN RAISE EXCEPTION 'ACCOUNT_INVALID_REQUEST'; END IF;
  RETURN wjb_ops.usage_json(u)||CASE WHEN wjb_ops.is_admin(u) THEN jsonb_build_object('project',jsonb_build_object(
   'images',wjb_ops.project_images(),'imagesLimit',wjb_ops.setting_of('project_images'),
   'db',wjb_ops.db_bytes(),'dbLimit',wjb_ops.setting_of('project_db'))) ELSE '{}'::jsonb END;
 END IF;
 -- 관리자 전용 — 화면이 아니라 여기서 매번 확인
 IF NOT wjb_ops.is_admin(u) THEN RAISE EXCEPTION 'ACCOUNT_NOT_ADMIN'; END IF;
 IF action='admin_list' THEN
  IF NOT wjb_migration.keys_exact(p,ARRAY[]::text[]) THEN RAISE EXCEPTION 'ACCOUNT_INVALID_REQUEST'; END IF;
  RETURN jsonb_build_object('accounts',coalesce((SELECT jsonb_agg(wjb_ops.usage_json(x.id)||jsonb_build_object(
    'userId',x.id,'email',x.email,'createdAt',x.created_at,'lastSignInAt',x.last_sign_in_at,
    'custom',EXISTS(SELECT 1 FROM wjb_ops.account a2 WHERE a2.user_id=x.id)) ORDER BY x.created_at,x.id)
   FROM (SELECT id,email,created_at,last_sign_in_at FROM auth.users WHERE deleted_at IS NULL ORDER BY created_at LIMIT 500) x),'[]'));
 END IF;
 -- admin_set: userId + (images|spaces|records: 숫자 또는 null=기본) · unlimited · suspended · reset
 IF NOT (p ? 'userId') OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN('userId','images','spaces','records','unlimited','suspended','reset'))
  THEN RAISE EXCEPTION 'ACCOUNT_INVALID_REQUEST'; END IF;
 t:=(p->>'userId')::uuid;
 PERFORM 1 FROM auth.users WHERE id=t AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND'; END IF;
 IF wjb_ops.is_admin(t) THEN RAISE EXCEPTION 'ACCOUNT_ADMIN_FIXED'; END IF;
 IF coalesce((p->>'reset')::boolean,false) THEN
  DELETE FROM wjb_ops.account WHERE user_id=t;
  RETURN wjb_ops.usage_json(t)||jsonb_build_object('userId',t);
 END IF;
 IF (p ? 'images' AND jsonb_typeof(p->'images') NOT IN('number','null')) OR (p ? 'spaces' AND jsonb_typeof(p->'spaces') NOT IN('number','null'))
    OR (p ? 'records' AND jsonb_typeof(p->'records') NOT IN('number','null'))
    OR (p ? 'unlimited' AND jsonb_typeof(p->'unlimited')<>'boolean') OR (p ? 'suspended' AND jsonb_typeof(p->'suspended')<>'boolean')
  THEN RAISE EXCEPTION 'ACCOUNT_INVALID_REQUEST'; END IF;
 INSERT INTO wjb_ops.account(user_id) VALUES(t) ON CONFLICT DO NOTHING;
 SELECT * INTO a FROM wjb_ops.account WHERE user_id=t FOR UPDATE;
 UPDATE wjb_ops.account SET
  images=CASE WHEN p ? 'images' THEN (p->>'images')::bigint ELSE a.images END,
  spaces=CASE WHEN p ? 'spaces' THEN (p->>'spaces')::integer ELSE a.spaces END,
  records=CASE WHEN p ? 'records' THEN (p->>'records')::bigint ELSE a.records END,
  unlimited=CASE WHEN p ? 'unlimited' THEN (p->>'unlimited')::boolean ELSE a.unlimited END,
  suspended=CASE WHEN p ? 'suspended' THEN (p->>'suspended')::boolean ELSE a.suspended END,
  updated_at=clock_timestamp() WHERE user_id=t;
 RETURN wjb_ops.usage_json(t)||jsonb_build_object('userId',t);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN RAISE EXCEPTION 'ACCOUNT_INVALID_REQUEST';
END $$;
REVOKE ALL ON FUNCTION public.wjb_v2_account(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wjb_v2_account(jsonb) TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wjb_ops FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA wjb_ops FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
