"""C1 SQL candidate on LOCAL Auth table fixtures, not managed Supabase."""
import json
from pathlib import Path
import subprocess


def run(c):
    sql,scalar,test,equal,uid,client,reject=[c[k] for k in ('sql','scalar','test','equal','uid','client','reject')]
    root=Path(__file__).resolve().parent
    candidate=(root/'session-guard.sql').read_text()
    rollback=(root/'rollback-session-guard.sql').read_text()
    A,B,SA,SB=[c[k] for k in ('A','B','SA','SB')]
    marker="SET wjb.confirm_cloud_rollback='hutqsfftioxtredcjhsy:no-active-traffic'; "

    def fail_sql(text,code):
        r=sql(text,check=False)
        assert r.returncode!=0 and code in r.stderr,(code,r.stderr)

    def active(user=A,session=SA):
        user_arg='NULL' if user is None else "'"+user+"'"
        session_arg='NULL' if session is None else "'"+session+"'"
        return scalar(f'SET ROLE service_role; SELECT public.wjb_v2_session_active({user_arg},{session_arg})')

    def revoke(user=A,session=SA):
        return scalar(f"SET ROLE service_role; SELECT public.wjb_v2_revoke_session('{user}','{session}')")

    def auth_snapshot():
        return scalar("SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM auth.users u),"
                      "(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM auth.sessions s))")

    def integration(status):
        fixture=root.parent/'v2-auth'/'session-guard-fixture.mjs'
        r=subprocess.run(['node',str(fixture),c['NAME']],text=True,capture_output=True,timeout=20,check=True,env=c['ENV'])
        equal(json.loads(r.stdout)['status'],status)

    test('C1 refuses missing server role',lambda:fail_sql(candidate,'SERVICE_ROLE_MISSING'))
    sql('CREATE ROLE service_role NOLOGIN NOSUPERUSER NOBYPASSRLS')
    test('C1 refuses unsupported Auth schema before changes',lambda:fail_sql(candidate,'AUTH_SCHEMA_NOT_SUPPORTED'))
    test('schema failure leaves no package objects',lambda:equal(scalar("SELECT to_regnamespace('wjb_v2_cloud') IS NULL"),'t'))
    sql(f"""CREATE TABLE auth.users(id uuid PRIMARY KEY,banned_until timestamptz,deleted_at timestamptz);
        CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,not_after timestamptz);
        INSERT INTO auth.users(id) VALUES('{A}'),('{B}');
        INSERT INTO auth.sessions(id,user_id) VALUES('{SA}','{A}'),('{SB}','{B}');""")
    source_state=auth_snapshot()
    test('C1 candidate applies to supported local schema',lambda:sql(candidate))
    test('active bound user and session accepted',lambda:equal(active(),'t'))
    test('different user bound to same session rejected',lambda:equal(active(B,SA),'f'))
    test('missing provider session rejected',lambda:equal(active(A,uid(1001)),'f'))
    test('null identity rejected',lambda:equal(active(None,SA),'f'))
    test('null session rejected',lambda:equal(active(A,None),'f'))

    def changed_session(value,expected):
        sql(f"UPDATE auth.sessions SET not_after={value} WHERE id='{SA}'")
        try:equal(active(),expected)
        finally:sql(f"UPDATE auth.sessions SET not_after=NULL WHERE id='{SA}'")
    test('expired provider session rejected',lambda:changed_session("now()-interval '1 second'",'f'))
    test('future provider session accepted',lambda:changed_session("now()+interval '1 hour'",'t'))

    def changed_user(column,value,expected):
        sql(f"UPDATE auth.users SET {column}={value} WHERE id='{A}'")
        try:equal(active(),expected)
        finally:sql(f"UPDATE auth.users SET {column}=NULL WHERE id='{A}'")
    test('currently banned user rejected',lambda:changed_user('banned_until',"now()+interval '1 hour'",'f'))
    test('expired ban does not reject valid session',lambda:changed_user('banned_until',"now()-interval '1 hour'",'t'))
    test('soft deleted user rejected',lambda:changed_user('deleted_at','now()','f'))
    test('authenticated cannot call public guard',lambda:reject(f"SELECT public.wjb_v2_session_active('{A}','{SA}')",'permission denied'))
    test('anon cannot call public guard',lambda:reject(f"SELECT public.wjb_v2_session_active('{A}','{SA}')",'permission denied',role='anon'))
    test('authenticated cannot call private helper',lambda:reject(f"SELECT wjb_v2_cloud.session_active('{A}','{SA}')",'permission denied'))
    test('authenticated cannot call revoke',lambda:reject(f"SELECT public.wjb_v2_revoke_session('{A}','{SA}')",'permission denied'))
    test('service transport cannot read Auth tables directly',lambda:fail_sql('SET ROLE service_role; SELECT * FROM auth.sessions','permission denied'))
    test('service transport cannot read private revocation rows',lambda:fail_sql('SET ROLE service_role; SELECT * FROM wjb_v2_cloud.blocked_session','permission denied'))
    test('local signed token reaches actual local SQL guard',lambda:integration('ACCEPTED'))
    test('repeat apply refuses collisions without replacement',lambda:fail_sql(candidate,'already exists'))
    test('failed repeat apply preserves live guard',lambda:equal(active(),'t'))

    def logout():
        sql(f"DELETE FROM auth.sessions WHERE id='{SA}'")
        try:
            equal(active(),'f');integration('ACCESS_REVOKED')
        finally:sql(f"INSERT INTO auth.sessions(id,user_id) VALUES('{SA}','{A}')")
    test('provider logout deletion denies still-signed token',logout)
    test('server subject mismatch cannot revoke another user',lambda:fail_sql(f"SET ROLE service_role; SELECT public.wjb_v2_revoke_session('{B}','{SA}')",'SESSION_SUBJECT_MISMATCH'))
    test('app session revocation accepted',lambda:revoke())
    test('app revoked session rejected despite provider row',lambda:equal(active(),'f'))
    test('signed token blocked by app revocation ledger',lambda:integration('ACCESS_REVOKED'))
    test('repeat revoke idempotent',lambda:revoke())
    test('one revocation row retained',lambda:equal(scalar('SELECT count(*) FROM wjb_v2_cloud.blocked_session'),'1'))
    test('other user session still accepted',lambda:equal(active(B,SB),'t'))
    test('guard and revoke never mutate Auth rows',lambda:equal(auth_snapshot(),source_state))
    test('rollback requires explicit marker',lambda:fail_sql(rollback,'ROLLBACK_CONFIRMATION_REQUIRED'))
    test('refused rollback retains package',lambda:equal(scalar("SELECT to_regnamespace('wjb_v2_cloud') IS NOT NULL"),'t'))

    def rollback_dependency():
        sql('CREATE TABLE wjb_v2_cloud.unreviewed_dependency(id integer)')
        try:
            fail_sql(marker+rollback,'other objects depend')
            equal(active(B,SB),'t')
            equal(scalar('SELECT count(*) FROM wjb_v2_cloud.blocked_session'),'1')
        finally:sql('DROP TABLE wjb_v2_cloud.unreviewed_dependency')
    test('unexpected dependency aborts entire rollback',rollback_dependency)
    test('explicit local rollback removes candidate objects',lambda:sql(marker+rollback))
    test('rollback leaves no RPC or private schema',lambda:equal(scalar("SELECT to_regprocedure('public.wjb_v2_session_active(uuid,uuid)') IS NULL AND to_regnamespace('wjb_v2_cloud') IS NULL"),'t'))
    test('rollback preserves all Auth fixture rows',lambda:equal(auth_snapshot(),source_state))
    test('rollback preserves earlier workspace data',lambda:equal(scalar('SELECT count(*) FROM wjb_v2.workspace'),'2'))
