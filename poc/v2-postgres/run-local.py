#!/usr/bin/env python3
"""Disposable local PostgreSQL proof. No remote URL or Supabase token is used."""
import concurrent.futures
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parent
IMAGE = 'postgres@sha256:665dc7b37ac52a17e298511414c21d23ffa4e6a6ef6225b3e5d59c7afb35e994'
ENV = {k: v for k, v in os.environ.items() if k not in
       {'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'}}
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
NAME = 'wjb-v2-pg-' + uuid.uuid4().hex[:12]
OUT = Path(tempfile.mkdtemp(prefix='wjb-v2-postgres-'))
RESULTS = []


def docker(*args, input=None, check=True):
    return subprocess.run(DOCKER + list(args), input=input, text=True,
                          capture_output=True, env=ENV, timeout=45, check=check)


def sql(query, check=True):
    return docker('exec', '-i', NAME, 'psql', '-X', '-qAt', '-v',
                  'ON_ERROR_STOP=1', '-U', 'postgres', input=query, check=check)


def scalar(query):
    return sql(query).stdout.strip()


def uid(n):
    return str(uuid.UUID(int=n))


A, B, WA, WB, DA, DB, SA, SB = [uid(n) for n in range(1, 9)]


def client(query, user=A, session=SA, role='authenticated', app='wjb-test', commit=True):
    claims = json.dumps({'sub': user, 'session_id': session})
    return (f"BEGIN; SET LOCAL ROLE {role}; SET LOCAL application_name='{app}'; "
            "SET LOCAL statement_timeout='12s'; SET LOCAL lock_timeout='8s'; "
            f"SET LOCAL request.jwt.claims='{claims}'; {query}; "
            + ('COMMIT;' if commit else 'ROLLBACK;'))


def put(record, op, body='fictional', expected=0, workspace=WA, device=DA, generation=1):
    text = 'NULL' if body is None else "'" + body.replace("'", "''") + "'"
    return (f"SELECT wjb_v2.put_text('{workspace}',{generation},'{device}',"
            f"'{uid(op)}','{uid(record)}',{expected},{text})")


def success(query, **kw):
    return json.loads(scalar(client(query, **kw)))


def reject(query, code, **kw):
    r = sql(client(query, **kw), check=False)
    assert r.returncode != 0 and code in r.stderr, (code, r.stdout, r.stderr)


def count(table):
    return int(scalar(f'SELECT count(*) FROM wjb_v2.{table}'))


def state():
    return scalar("SELECT jsonb_build_array("
                  "(SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY id),'[]') FROM wjb_v2.workspace w),"
                  "(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY workspace_id,id),'[]') FROM wjb_v2.text_record r),"
                  "(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY workspace_id,cursor),'[]') FROM wjb_v2.change_log c),"
                  "(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY workspace_id,generation,device_id,op_id),'[]') FROM wjb_v2.applied_operation o))")


def test(name, fn):
    start = time.monotonic()
    try:
        fn()
    except Exception:
        RESULTS.append({'name': name, 'status': 'FAIL'})
        raise
    RESULTS.append({'name': name, 'status': 'PASS', 'ms': round((time.monotonic()-start)*1000)})
    print('PASS', name, flush=True)


def equal(actual, expected):
    assert actual == expected, (actual, expected)


def unchanged_reject(query, code, **kw):
    before = state()
    reject(query, code, **kw)
    equal(state(), before)


def race_sql():
    return subprocess.Popen(DOCKER + ['exec', '-i', NAME, 'psql', '-X', '-qAt',
                                      '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, env=ENV)


def wait_activity(app, condition):
    end = time.monotonic()+6
    while time.monotonic() < end:
        if scalar(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{app}' AND {condition}") == '1':
            return
        time.sleep(.04)
    raise AssertionError('Race barrier not observed: '+app)


def ordered_commits():
    before = int(scalar(f"SELECT cursor FROM wjb_v2.workspace WHERE id='{WA}'"))
    first = race_sql()
    second = None
    try:
        first.stdin.write(client(put(200, 200)+"; SELECT pg_sleep(3)", app='wjb-race-first'))
        first.stdin.close(); first.stdin = None
        wait_activity('wjb-race-first', "wait_event='PgSleep'")
        equal(scalar(f"SELECT count(*) FROM wjb_v2.text_record WHERE id='{uid(200)}'"), '0')
        second = race_sql()
        second.stdin.write(client(put(201, 201), app='wjb-race-second'))
        second.stdin.close(); second.stdin = None
        wait_activity('wjb-race-second', "wait_event_type='Lock'")
        out1, err1 = first.communicate(timeout=15)
        out2, err2 = second.communicate(timeout=15)
        equal((first.returncode, second.returncode), (0, 0))
        equal(json.loads(out1.splitlines()[0])['cursor'], str(before+1))
        equal(json.loads(out2.strip())['cursor'], str(before+2))
        equal(scalar(f"SELECT string_agg(record_id::text,',' ORDER BY cursor) FROM wjb_v2.change_log WHERE workspace_id='{WA}' AND cursor>{before}"), uid(200)+','+uid(201))
    finally:
        for p in (first, second):
            if p is not None and p.poll() is None:
                p.kill(); p.wait(timeout=5)


def concurrent_same_op():
    before = count('change_log')
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        values = list(pool.map(lambda _: success(put(210, 210)), range(2)))
    equal(values[0], values[1]); equal(count('change_log'), before+1)


def concurrent_cas():
    before = count('change_log')
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [pool.submit(sql, client(put(100, n, body=str(n), expected=2)), False) for n in (220, 221)]
        results = [p.result() for p in jobs]
    equal(sorted(r.returncode == 0 for r in results), [False, True])
    assert any('CONFLICT' in r.stderr for r in results)
    equal(count('change_log'), before+1)


def rollback_failure():
    sql("""CREATE FUNCTION wjb_v2.test_fail_operation() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'INJECTED_FAILURE'; END $$;
        CREATE TRIGGER test_failure BEFORE INSERT ON wjb_v2.applied_operation
        FOR EACH ROW EXECUTE FUNCTION wjb_v2.test_fail_operation();""")
    try:
        unchanged_reject(put(230, 230), 'INJECTED_FAILURE')
    finally:
        sql('DROP TRIGGER test_failure ON wjb_v2.applied_operation; DROP FUNCTION wjb_v2.test_fail_operation()')
    success(put(230, 230))


def revoked():
    sql(f"UPDATE wjb_v2.device_session SET revoked=true WHERE id='{DA}'")
    try:
        unchanged_reject(put(100, 100), 'ACCESS_REVOKED')
        equal(scalar(client('SELECT count(*) FROM wjb_v2.text_record')), '0')
    finally:
        sql(f"UPDATE wjb_v2.device_session SET revoked=false WHERE id='{DA}'")


def explicit_rollback():
    before = state()
    scalar(client(put(240, 240), commit=False))
    equal(state(), before)
    success(put(240, 240))


created = False
try:
    docker('run', '-d', '--rm', '--name', NAME, '--network', 'none',
           '--label', 'wjb.poc=v2-postgres', '--memory', '512m', '--cpus', '1',
           '--pids-limit', '128', '--tmpfs', '/var/lib/postgresql/data:rw,size=256m',
           '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', IMAGE,
           '-c', 'listen_addresses=')
    created = True
    for attempt in range(100):
        if docker('exec', NAME, 'pg_isready', '-U', 'postgres', check=False).returncode == 0:
            # Entry point's temporary init server must finish before migrations.
            logs = docker('logs', NAME)
            status = logs.stdout + logs.stderr
            if 'PostgreSQL init process complete; ready for start up.' in status:
                break
        time.sleep(.1)
    else:
        raise RuntimeError('PostgreSQL did not become ready')
    sql((ROOT/'bootstrap-local.sql').read_text())
    sql((ROOT/'001-text-command.sql').read_text())
    sql(f"""SET ROLE wjb_poc_owner;
        INSERT INTO wjb_v2.workspace VALUES ('{WA}','{A}',1,0),('{WB}','{B}',1,0);
        INSERT INTO wjb_v2.device_session VALUES ('{DA}','{A}','{SA}',false),('{DB}','{B}','{SB}',false);""")
    version = scalar('SHOW server_version')
    test('create returns decimal string versions', lambda: equal(success(put(100, 100)), {'generation':'1','cursor':'1','revision':'1'}))
    test('owner sees own workspace only', lambda: equal(scalar(client('SELECT count(*) FROM wjb_v2.workspace')), '1'))
    test('other account cannot read record', lambda: equal(scalar(client('SELECT count(*) FROM wjb_v2.text_record',user=B,session=SB)), '0'))
    test('other account cannot read change log', lambda: equal(scalar(client('SELECT count(*) FROM wjb_v2.change_log',user=B,session=SB)), '0'))
    test('cross workspace command rejected without effects', lambda: unchanged_reject(put(101,101,workspace=WB),'ACCESS_REVOKED'))
    test('forged device rejected without effects', lambda: unchanged_reject(put(101,101,device=DB),'ACCESS_REVOKED'))
    test('wrong auth session rejected', lambda: unchanged_reject(put(101,101),'ACCESS_REVOKED',session=SB))
    test('missing auth session rejected', lambda: unchanged_reject(put(101,101),'ACCESS_REVOKED',session=None))
    test('unauthenticated subject rejected', lambda: unchanged_reject(put(101,101),'AUTH_REQUIRED',user=None))
    test('wrong generation rejected', lambda: unchanged_reject(put(101,101,generation=2),'GENERATION_CHANGED'))
    test('duplicate operation returns same result', lambda: equal(success(put(100,100)),{'generation':'1','cursor':'1','revision':'1'}))
    test('duplicate does not add log or operation', lambda: equal((count('change_log'),count('applied_operation')),(1,1)))
    test('same key changed body rejected', lambda: unchanged_reject(put(100,100,body='changed'),'IDEMPOTENCY_KEY_REUSED'))
    test('same key changed target rejected', lambda: unchanged_reject(put(101,100),'IDEMPOTENCY_KEY_REUSED'))
    test('same key changed base rejected', lambda: unchanged_reject(put(100,100,expected=1),'IDEMPOTENCY_KEY_REUSED'))
    test('stale revision rejected', lambda: unchanged_reject(put(100,102,expected=0),'CONFLICT'))
    test('new record requires revision zero', lambda: unchanged_reject(put(101,102,expected=1),'CONFLICT'))
    test('null body rejected', lambda: unchanged_reject(put(101,102,body=None),'INVALID_COMMAND'))
    test('oversized utf8 body rejected', lambda: unchanged_reject(put(101,102,body='가'*5462),'INVALID_COMMAND'))
    test('negative revision rejected', lambda: unchanged_reject(put(101,102,expected=-1),'INVALID_COMMAND'))
    test('direct table insert forbidden', lambda: reject(f"INSERT INTO wjb_v2.text_record VALUES('{WA}','{uid(101)}','x',1)",'permission denied'))
    test('direct table update forbidden', lambda: reject("UPDATE wjb_v2.text_record SET body='x'",'permission denied'))
    test('direct log delete forbidden', lambda: reject('DELETE FROM wjb_v2.change_log','permission denied'))
    test('operation ledger not visible', lambda: reject('SELECT * FROM wjb_v2.applied_operation','permission denied'))
    test('device sessions not visible', lambda: reject('SELECT * FROM wjb_v2.device_session','permission denied'))
    test('anonymous function denied', lambda: reject(put(101,102),'permission denied',role='anon'))
    test('unbound session sees no rows', lambda: equal(scalar(client('SELECT count(*) FROM wjb_v2.workspace',session=SB)),'0'))
    test('update accepted at correct revision', lambda: equal(success(put(100,103,body='updated',expected=1))['revision'],'2'))
    test('old ack replay after newer edit is unchanged', lambda: equal(success(put(100,100))['revision'],'1'))
    test('revocation blocks reads and cached retry', revoked)
    test('failure after record and log rolls back every write', rollback_failure)
    test('caller rollback preserves cursor and allows retry', explicit_rollback)
    test('concurrent duplicate applies once', concurrent_same_op)
    test('concurrent same-base edits have one winner', concurrent_cas)
    test('workspace lock enforces commit ordered cursors', ordered_commits)
    test('other owner writes isolated workspace', lambda: equal(success(put(100,300,workspace=WB,device=DB),user=B,session=SB)['cursor'],'1'))
    test('all accepted writes have one log and ledger row', lambda: equal(count('change_log'),count('applied_operation')))
    test('all tables enable RLS', lambda: equal(scalar("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='wjb_v2' AND c.relkind='r' AND c.relrowsecurity"),'5'))
    test('definer functions owned by non-superuser', lambda: equal(scalar("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='wjb_v2' AND p.prosecdef AND NOT r.rolsuper AND NOT r.rolbypassrls"),'2'))
    if '--extended' in sys.argv:
        sql((ROOT/'002-session-assets.sql').read_text())
        from session_asset_tests import run
        run(globals())
finally:
    evidence = {'observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'scope':'Local PostgreSQL SQL authorization/transaction slice; Auth gateway is a test stub; no cloud writes',
                'extended':'--extended' in sys.argv,
                'image':IMAGE,'postgres_version':locals().get('version'), 'tests':RESULTS,
                'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ROOT.iterdir()) if p.suffix in ('.py','.sql')}}
    if '--extended' in sys.argv:
        auth_root = ROOT.parent/'v2-auth'
        evidence['auth_files'] = {p.name:hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(auth_root.iterdir()) if p.suffix in ('.mjs','.json')}
    (OUT/'results.json').write_text(json.dumps(evidence,indent=2)+'\n')
    if created:
        docker('rm','-f','-v',NAME,check=False)
    print('Evidence:',OUT/'results.json',flush=True)
print(f'{len(RESULTS)} tests PASS',flush=True)
