"""Local full-bundle installation/ACL/pause/empty-only rollback tests."""
import json
from pathlib import Path


def run(c):
    sql,scalar,test,equal,uid=[c[k] for k in ('sql','scalar','test','equal','uid')]
    root=Path(__file__).resolve().parent/'bundle'
    install=(root/'install.sql').read_text(); rollback=(root/'rollback.sql').read_text()
    pause=(root/'pause.sql').read_text(); resume=(root/'resume.sql').read_text()
    verify=(root/'verify.sql').read_text(); inspect=(root/'preinstall.sql').read_text()
    manifest=json.loads((root/'manifest.json').read_text())
    marker="SET wjb.confirm_bundle_rollback='hutqsfftioxtredcjhsy:traffic-stopped'; "
    resume_marker="SET wjb.confirm_bundle_resume='hutqsfftioxtredcjhsy:reviewed'; "
    A,B,WA,DA,SA,SB=[c[k] for k in ('A','B','WA','DA','SA','SB')]
    def fail(text,code):
        r=sql(text,check=False);assert r.returncode!=0 and code in r.stderr,(code,r.stderr)
    def absent():
        equal(scalar("SELECT to_regnamespace('wjb_v2_cloud') IS NULL AND to_regnamespace('wjb_gateway') IS NULL"),'t')
    def verification():return json.loads(scalar(verify))
    def service():return scalar(f"SET ROLE service_role;SELECT public.wjb_v2_session_active('{A}','{SA}')")
    def auth_state():return scalar("SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(u) ORDER BY id)FROM auth.users u),(SELECT jsonb_agg(to_jsonb(s) ORDER BY id)FROM auth.sessions s))")
    def own_state():
        parts=[]
        for table in manifest['objects']['tables']:
            parts.append(f"(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM {table} t)")
        return scalar('SELECT jsonb_build_array('+','.join(parts)+')')
    sql("CREATE ROLE service_role NOLOGIN NOSUPERUSER NOBYPASSRLS;")
    test('full bundle rejects unsupported Auth without partial schemas',lambda:(fail(install,'AUTH_SCHEMA_NOT_SUPPORTED'),absent()))
    sql(f"""CREATE TABLE auth.users(id uuid PRIMARY KEY,banned_until timestamptz,deleted_at timestamptz);
        CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),not_after timestamptz);
        INSERT INTO auth.users(id)VALUES('{A}'),('{B}');INSERT INTO auth.sessions(id,user_id)VALUES('{SA}','{A}'),('{SB}','{B}');
        CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean,file_size_limit bigint);
        INSERT INTO storage.buckets VALUES('unrelated-bucket',false,65536);
        CREATE TABLE storage.objects(metadata jsonb);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
        CREATE TABLE public.bundle_keep_fixture(id text PRIMARY KEY);INSERT INTO public.bundle_keep_fixture VALUES('fictional keep');""")
    original_auth=auth_state()
    test('read-only preinstall reports no bundle collisions',lambda:equal(json.loads(scalar(inspect))['public_name_collisions'],[]))
    def early_collision():
        sql("CREATE SCHEMA wjb_gateway;CREATE TABLE wjb_gateway.keep_fixture(id int);INSERT INTO wjb_gateway.keep_fixture VALUES(7)")
        try:
            fail(install,'already exists')
            equal(scalar("SELECT to_regnamespace('wjb_v2_cloud') IS NULL"),'t')
            equal(scalar('SELECT id FROM wjb_gateway.keep_fixture'),'7')
        finally:sql('DROP TABLE wjb_gateway.keep_fixture;DROP SCHEMA wjb_gateway')
    test('early schema collision preserves original objects and rolls back guard',early_collision)
    def late_collision():
        sql("CREATE FUNCTION public.wjb_v2_recovery_catalog(jsonb)RETURNS jsonb LANGUAGE sql AS $$SELECT '{\"keep\":true}'::jsonb$$")
        try:
            fail(install,'already exists');absent()
            equal(json.loads(scalar("SELECT public.wjb_v2_recovery_catalog('{}')")),{'keep':True})
        finally:sql('DROP FUNCTION public.wjb_v2_recovery_catalog(jsonb)')
    test('late RPC collision rolls back all newly created modules',late_collision)
    test('full atomic installation succeeds',lambda:sql(install))
    for key,value in manifest['expectedVerification'].items():
        test('full-bundle verification '+key,lambda key=key,value=value:equal(verification()[key],value))
    test('preinstall now finds all four public RPC names',lambda:equal(len(json.loads(scalar(inspect))['public_name_collisions']),4))
    test('reapply refuses existing bundle without replacement',lambda:fail(install,'already exists'))
    test('service role can call guarded RPC',lambda:equal(service(),'t'))
    test('pause removes service RPC access without deleting objects',lambda:(sql(pause),equal(verification()['servicePublicExecutableCount'],0),equal(verification()['tableCount'],6)))
    test('paused service invocation is denied',lambda:fail(f"SET ROLE service_role;SELECT public.wjb_v2_session_active('{A}','{SA}')",'permission denied'))
    test('resume requires explicit review marker',lambda:fail(resume,'RESUME_CONFIRMATION_REQUIRED'))
    test('reviewed resume restores exact server RPC access',lambda:(sql(resume_marker+resume),equal(verification()['servicePublicExecutableCount'],4),equal(verification()['clientExecutableCount'],0)))
    test('uninstall requires explicit marker',lambda:fail(rollback,'ROLLBACK_CONFIRMATION_REQUIRED'))
    def revocation_gate():
        sql(f"INSERT INTO wjb_v2_cloud.blocked_session(session_id,user_id)VALUES('{SB}','{B}')")
        fail(marker+rollback,'BUNDLE_DATA_PRESENT')
        equal(scalar('SELECT count(*) FROM wjb_v2_cloud.blocked_session'),'1')
        sql('DELETE FROM wjb_v2_cloud.blocked_session')
    test('guard revocation data prevents uninstall',revocation_gate)
    def domain_data_gate():
        sql(f"""INSERT INTO wjb_gateway.workspace(id,owner_id,generation,used_bytes)VALUES('{WA}','{A}',1,4);
            INSERT INTO wjb_gateway.device VALUES('{DA}','{A}','{SA}',false);
            INSERT INTO wjb_gateway.asset(workspace_id,id,generation,device_id,sha256,bytes,state,expires_at)
             VALUES('{WA}','{uid(900)}',1,'{DA}',repeat('0',64),2,'cleanup',now()),('{WA}','{uid(901)}',1,'{DA}',repeat('0',64),2,'ready',now());
            INSERT INTO wjb_gateway.io_intent VALUES('{WA}','{uid(900)}','{uid(902)}','{uid(903)}',1,'{A}','{SA}',false);
            INSERT INTO wjb_gateway.recovery_audit(decision_id,workspace_id,asset_id,user_id,device_id,review_hash,action,io_version,result_state)
             VALUES('{uid(904)}','{WA}','{uid(901)}','{A}','{DA}',repeat('0',64),'RESTORE_READY',0,'ready');""")
        before=own_state();fail(marker+rollback,'BUNDLE_DATA_PRESENT');equal(own_state(),before)
        sql(pause);equal(own_state(),before);sql(resume_marker+resume);equal(own_state(),before)
    test('data/uncertain I/O/audit survive refused uninstall and pause/resume',domain_data_gate)
    # Local fixture cleanup ONLY, never present in generated rollback or sent remotely.
    sql('TRUNCATE wjb_gateway.recovery_audit,wjb_gateway.io_intent,wjb_gateway.asset,wjb_gateway.device,wjb_gateway.workspace')
    def extra_dependency():
        sql('CREATE TABLE wjb_gateway.unreviewed_dependency(id int)')
        try:
            fail(marker+rollback,'other objects depend');equal(verification()['functionCount'],7)
        finally:sql('DROP TABLE wjb_gateway.unreviewed_dependency')
    test('unexpected dependency aborts entire empty uninstall',extra_dependency)
    test('empty-only full uninstall succeeds',lambda:sql(marker+rollback))
    test('both bundle namespaces removed',absent)
    test('uninstall preserves original Auth fixtures',lambda:equal(auth_state(),original_auth))
    test('uninstall preserves original app data',lambda:equal(scalar('SELECT count(*) FROM wjb_v2.workspace'),'2'))
    test('uninstall preserves unrelated public data',lambda:equal(scalar('SELECT id FROM public.bundle_keep_fixture'),'fictional keep'))
    test('uninstall preserves unrelated Storage metadata',lambda:equal(scalar('SELECT id FROM storage.buckets'),'unrelated-bucket'))
    test('read-only inspection remains usable after uninstall',lambda:equal(json.loads(scalar(inspect))['metadata_schema_exists'],False))
    test('clean reinstall after empty uninstall succeeds',lambda:(sql(install),equal(verification()['clientExecutableCount'],0)))
    sql(marker+rollback)
