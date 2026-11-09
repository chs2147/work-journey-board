"""Local capability proof only: no roles or grants are changed in Supabase."""
import json
from pathlib import Path


def run(c):
    sql,scalar,test,equal=[c[k] for k in ('sql','scalar','test','equal')]
    root=Path(__file__).resolve().parent/'bundle'
    install=(root/'install.sql').read_text();verify=(root/'verify.sql').read_text();pause=(root/'pause.sql').read_text();resume=(root/'resume.sql').read_text();rollback=(root/'rollback.sql').read_text()
    expected=json.loads((root/'manifest.json').read_text())['expectedVerification']
    role='wjb_bundle_executor'
    def as_owner(text):return scalar('SET ROLE '+role+';'+text)
    def failed(text,code):
        r=sql('SET ROLE '+role+';'+text,check=False);assert r.returncode!=0 and code in r.stderr,(code,r.stderr)
    def proof():return json.loads(scalar(verify))
    def active():return scalar(f"SET ROLE service_role;SELECT public.wjb_v2_session_active('{c['A']}','{c['SA']}')")
    marker="SET wjb.confirm_bundle_rollback='hutqsfftioxtredcjhsy:traffic-stopped'; "
    resume_marker="SET wjb.confirm_bundle_resume='hutqsfftioxtredcjhsy:reviewed'; "
    sql(f"""CREATE ROLE {role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      GRANT CREATE ON DATABASE postgres TO {role};GRANT USAGE,CREATE ON SCHEMA public TO {role};
      GRANT USAGE ON SCHEMA auth TO {role};GRANT USAGE ON LANGUAGE plpgsql TO {role};
      GRANT SELECT(id,user_id,not_after)ON auth.sessions TO {role};
      GRANT SELECT(id,banned_until,deleted_at)ON auth.users TO {role};
      ALTER TABLE auth.users ADD COLUMN private_fixture text;
      ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;""")
    original=scalar("SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(u)ORDER BY id)FROM auth.users u),(SELECT jsonb_agg(to_jsonb(s)ORDER BY id)FROM auth.sessions s))")
    test('non-superuser can install with only declared creation/column capabilities',lambda:as_owner(install))
    test('without Auth bypass missing RLS permission fails closed',lambda:equal(active(),'f'))
    test('non-superuser can remove own empty bundle',lambda:as_owner(marker+rollback))
    # Local administrator models the already-existing provider postgres profile.
    # This ALTER ROLE is never part of the generated bundle or a remote request.
    sql('ALTER ROLE '+role+' BYPASSRLS; ALTER ROLE service_role BYPASSRLS')
    test('non-superuser bypass profile installs complete bundle',lambda:as_owner(install))
    test('definer owner is non-superuser and matches inspected bypass profile',lambda:(equal(proof()['owners'][0]['role'],role),equal(proof()['owners'][0]['superuser'],False),equal(proof()['owners'][0]['bypassRls'],True)))
    def exact_acl():
        p=proof()
        for name,value in expected.items():equal(p[name],value)
    test('scoped owner retains exact restricted ACL/RLS matrix',exact_acl)
    def bypass_service_denied():
        equal(scalar("SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role'"),'t')
        for table in json.loads((root/'manifest.json').read_text())['objects']['tables']:
            r=sql('SET ROLE service_role; SELECT * FROM '+table,check=False)
            assert r.returncode!=0 and 'permission denied' in r.stderr,(table,r.stderr)
    test('realistic bypass service role still cannot directly read any managed table',bypass_service_denied)
    test('guard reads required Auth columns through actual RLS profile',lambda:equal(active(),'t'))
    test('bypass does not grant unlisted Auth column read',lambda:failed('SELECT private_fixture FROM auth.users','permission denied'))
    test('bypass does not grant Auth data update',lambda:failed('UPDATE auth.users SET banned_until=now()','permission denied'))
    test('owner does not need role creation authority',lambda:failed('CREATE ROLE wjb_should_not_exist','permission denied'))
    test('scoped owner can pause and reviewed resume',lambda:(as_owner(pause),equal(proof()['servicePublicExecutableCount'],0),as_owner(resume_marker+resume),equal(proof()['servicePublicExecutableCount'],4)))
    test('scoped owner empty uninstall succeeds',lambda:as_owner(marker+rollback))
    test('Auth fixtures unchanged by scoped execution',lambda:equal(scalar("SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(u)ORDER BY id)FROM auth.users u),(SELECT jsonb_agg(to_jsonb(s)ORDER BY id)FROM auth.sessions s))"),original))
