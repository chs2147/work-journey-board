"""Disposable local PG17 proof. No URL, cloud credential or published port."""
import concurrent.futures
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import uuid
import argparse
import re
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
IMAGE = 'postgres@sha256:665dc7b37ac52a17e298511414c21d23ffa4e6a6ef6225b3e5d59c7afb35e994'
NAME = 'wjb-migration-pg-' + uuid.uuid4().hex[:12]
ENV = {k:v for k,v in os.environ.items() if not k.startswith(('WJB_SUPABASE_','SUPABASE_')) and k not in
       {'DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'}}
RESULTS = []
created = False
SQL_USER = 'postgres'
result = None
arguments=argparse.ArgumentParser()
arguments.add_argument('--evidence-stem',default='migration-postgres')
arguments.add_argument('--full-workspace',action='store_true')
arguments.add_argument('--workspace-only',action='store_true')
options=arguments.parse_args()
evidence_stem=options.evidence_stem
if not re.fullmatch(r'migration-[a-z0-9-]{1,80}',evidence_stem):raise SystemExit('Invalid local evidence filename')
EVIDENCE=REPO/'docs/v2-design/evidence'/f'{evidence_stem}-pass.json'


def docker(*args, data=None, check=True):
    result=subprocess.run(['docker','--host=unix:///var/run/docker.sock',*args],input=data,text=True,
                          capture_output=True,env=ENV,timeout=45)
    if check and result.returncode:raise RuntimeError('Local command failed: '+result.stderr[-3000:])
    return result


def sql(query, check=True):
    return docker('exec','-i',NAME,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U',SQL_USER,'-d','postgres',
                  data="SET statement_timeout='10s'; SET lock_timeout='5s';\n"+query,check=check)


def scalar(query): return sql(query).stdout.strip()
def uid(n): return str(uuid.UUID(int=n))
def literal(value): return "'"+json.dumps(value,ensure_ascii=False).replace("'","''")+"'::jsonb"
A,B,SA,SB,DA,DB = [uid(n) for n in range(1,7)]


def request(action, job, params, user=A, session=SA, device=DA):
    return {'action':action,'jobId':job,'params':params,'userId':user,'sessionId':session,'deviceId':device}


def query(r, role='service_role'):
    return f"BEGIN; SET LOCAL ROLE {role}; SELECT public.wjb_v2_migration_command({literal(r)}); COMMIT;"


def call(action, f, params=None, **who):
    p={} if params is None else params.copy()
    if action!='start': p={'manifestHash':f['hash'],**p}
    result=scalar(query(request(action,f['job'],p,**who)))
    return json.loads(result)


def reject(action,f,code,params=None,role='service_role',**who):
    p={'manifestHash':f['hash'],**(params or {})}
    result=sql(query(request(action,f['job'],p,**who),role),check=False)
    assert result.returncode and code in result.stderr,(code,result.stdout,result.stderr)


def c2(f,action,params,object_id=None):
    r={'action':action,'userId':A,'sessionId':SA,'scope':{'workspaceId':f['ws'],'assetId':object_id or f['object'],
       'deviceId':DA,'generation':'1'},'params':params}
    return json.loads(scalar(f"BEGIN;SET LOCAL ROLE service_role;SELECT public.wjb_v2_asset_command({literal(r)});COMMIT;"))


def fixture(images=True):
    # Fresh workspace/job each case; never reused or bound to an existing space.
    f={'job':str(uuid.uuid4()),'ws':str(uuid.uuid4()),'object':str(uuid.uuid4()),'doc':str(uuid.uuid4()),'sha':'a'*64,'bytes':32}
    manifest={'workspaceId':f['ws'],'sourceManifestHash':'f'*64,
      'assets':[{'objectId':f['object'],'sha256':f['sha'],'bytes':32}] if images else [],
      'documents':[{'id':f['doc'],'title':'가상 업무노트','blocks':[
        {'type':'paragraph','text':'원본 보존 / fictional migration'},
        *([{'type':'image','assetId':f['object'],'alt':'가상 그림'}] if images else [])]}]}
    # Test isolation quota: historical cases are local fixtures, not user jobs.
    sql("UPDATE wjb_migration.job SET state='canceled' WHERE state IN('staging','cancel_fenced');")
    start=call('start',f,manifest);f['hash']=start['manifestHash'];f['manifest']=manifest
    return f


def ready(f,settle=True):
    token=str(uuid.uuid4());intent=str(uuid.uuid4())
    row=c2(f,'acquire',{'token':token,'mode':'write'})
    params={'token':token,'fence':row['fence'],'intent':intent}
    c2(f,'begin_io',params)
    if settle:
        c2(f,'settle_io',params);c2(f,'mark_ready',params)
    c2(f,'release',{'token':token,'fence':row['fence']})
    return params


def observe(f): return call('observe',f,{'objectId':f['object']})
def attest(f):
    obs=observe(f)
    return call('attest',f,{'objectId':f['object'],'ioVersion':obs['ioVersion'],'sha256':f['sha'],'bytes':f['bytes']})
def ticket(f,op=None):
    op=op or str(uuid.uuid4())
    result=call('publication',f,{'operationId':op})
    assert result['state']=='absent' and result['operationSettled'] is True
    result=call('prepare_publish',f,{'operationId':op,'expectedFence':result['serverFence']})
    return result
def publish(f,t): return call('publish',f,t)
def cancel(f,op=None): return call('cancel',f,{'operationId':op or str(uuid.uuid4())})
def absent(f):
    obs=observe(f)
    return call('confirm_absent',f,{'objectId':f['object'],'ioVersion':obs['ioVersion']})
def test(name,fn):
    start=time.monotonic();fn();RESULTS.append({'name':name,'status':'PASS','ms':round((time.monotonic()-start)*1000)})
    print('PASS',name,flush=True)


def tests():
    def access():
        f=fixture()
        for role in ['anon','authenticated']: reject('status',f,'permission denied',role=role)
        for role in ['anon','authenticated','service_role']:
            r=sql(f"SET ROLE {role};SELECT * FROM wjb_migration.job;",check=False)
            assert r.returncode and 'permission denied' in r.stderr
    test('client RPC and direct table access denied, including bypass-RLS service role',access)

    def identity():
        f=fixture();reject('status',f,'MIGRATION_ACCESS_DENIED',user=B,session=SB,device=DB)
        reject('status',f,'MIGRATION_ACCESS_DENIED',session=SB)
        sql(f"UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='{A}';")
        reject('status',f,'MIGRATION_ACCESS_DENIED')
        sql(f"UPDATE auth.users SET banned_until=NULL WHERE id='{A}';")
    test('other owner, session mismatch and banned user denied',identity)

    def replay():
        f=fixture();again=call('start',f,f['manifest']);assert again['manifestHash']==f['hash']
        changed={**f['manifest'],'documents':[]}
        r=sql(query(request('start',f['job'],changed)),check=False)
        assert r.returncode and 'MIGRATION_IDEMPOTENCY_MISMATCH' in r.stderr
    test('start replay matches exact canonical manifest; changed payload rejected',replay)

    def invalid_manifest(change,code):
        f=fixture();m=json.loads(json.dumps(f['manifest']));m['workspaceId']=str(uuid.uuid4());change(m)
        before=int(scalar('SELECT count(*) FROM wjb_migration.job;'))
        r=sql(query(request('start',str(uuid.uuid4()),m)),check=False)
        assert r.returncode and code in r.stderr,(code,r.stderr)
        assert int(scalar('SELECT count(*) FROM wjb_migration.job;'))==before
    test('inline data URL rejected atomically',lambda:invalid_manifest(lambda m:m['documents'][0]['blocks'][0].update(text='data:image/png;base64,AAAA'),'MIGRATION_INLINE_IMAGE'))
    test('raw WebP base64 signature rejected in metadata text',lambda:invalid_manifest(lambda m:m['documents'][0]['blocks'][0].update(text='UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA'),'MIGRATION_INLINE_IMAGE'))
    test('image node cannot embed data or src',lambda:invalid_manifest(lambda m:m['documents'][0]['blocks'][1].update(data='AAAA'),'MIGRATION_DOCUMENT_FORMAT'))
    test('unknown image reference rejected',lambda:invalid_manifest(lambda m:m['documents'][0]['blocks'][1].update(assetId=str(uuid.uuid4())),'MIGRATION_IMAGE_REFERENCE'))
    test('duplicate asset IDs rejected',lambda:invalid_manifest(lambda m:m['assets'].append(m['assets'][0]),'MIGRATION_DUPLICATE_ASSET'))
    test('bytea/base64-style extra root field rejected',lambda:invalid_manifest(lambda m:m.update(data='AAAA'),'MIGRATION_INVALID_MANIFEST'))
    test('unsupported block format rejected',lambda:invalid_manifest(lambda m:m['documents'][0]['blocks'].append({'type':'table'}),'MIGRATION_DOCUMENT_FORMAT'))

    def undeclared():
        f=fixture();r={'action':'reserve','userId':A,'sessionId':SA,'scope':{'workspaceId':f['ws'],'assetId':str(uuid.uuid4()),'deviceId':DA,'generation':'1'},'params':{'bytes':32,'sha256':'b'*64}}
        out=sql(f"SET ROLE service_role;SELECT public.wjb_v2_asset_command({literal(r)});",check=False)
        assert out.returncode and 'MIGRATION_ASSET_NOT_DECLARED' in out.stderr
    test('old gateway cannot reserve unlisted assets in migration workspace',undeclared)

    def pending():
        f=fixture();t=ticket(f);reject('publish',f,'MIGRATION_NOT_VERIFIED',t)
    test('pending files cannot publish',pending)

    def no_attest():
        f=fixture();ready(f);t=ticket(f);reject('publish',f,'MIGRATION_NOT_VERIFIED',t)
        attest(f);result=publish(f,t)
        assert result['status']=='poc-verified' and result['profile']=='migration-document-poc-1'
        assert result['manifestHash']==f['hash']
    test('ready alone is insufficient; server attestation yields scoped PoC receipt',no_attest)

    def wrong_attest():
        f=fixture();ready(f);o=observe(f)
        reject('attest',f,'MIGRATION_ATTESTATION_REJECTED',{'objectId':f['object'],'ioVersion':o['ioVersion'],'sha256':'b'*64,'bytes':32})
        reject('attest',f,'MIGRATION_IO_UNSETTLED',{'objectId':f['object'],'ioVersion':'999','sha256':f['sha'],'bytes':32})
    test('attestation hash/size and IO version bound',wrong_attest)

    def stale():
        f=fixture();ready(f);attest(f)
        sql(f"UPDATE wjb_migration.asset SET verified_at=now()-interval '61 seconds' WHERE job_id='{f['job']}';")
        t=ticket(f);reject('publish',f,'MIGRATION_NOT_VERIFIED',t)
        attest(f);assert publish(f,t)['status']=='poc-verified'
    test('stale attestation blocks publish until readback re-attestation',stale)

    def changed_metadata():
        f=fixture();ready(f);attest(f)
        sql(f"UPDATE wjb_migration.document SET title='changed' WHERE job_id='{f['job']}';")
        reject('publish',f,'MIGRATION_METADATA_CHANGED',ticket(f))
    test('server metadata drift detected by canonical digest',changed_metadata)

    def outstanding():
        f=fixture();old=ready(f,False);ready(f)
        assert observe(f)['operationSettled'] is False
        reject('attest',f,'MIGRATION_IO_UNSETTLED',{'objectId':f['object'],'ioVersion':observe(f)['ioVersion'],'sha256':f['sha'],'bytes':32})
        c2(f,'settle_io',old);attest(f);assert publish(f,ticket(f))['status']=='poc-verified'
    test('ready asset with older unsettled IO remains blocked',outstanding)

    def cancel_pending():
        f=fixture();c=cancel(f);assert c['publishBlocked'] and c['epoch']=='2'
        reject('finish_cancel',f,'MIGRATION_CANCEL_INCOMPLETE');absent(f)
        assert call('finish_cancel',f)['state']=='canceled'
        assert scalar(f"SELECT used_bytes FROM wjb_gateway.workspace WHERE id='{f['ws']}';")=='0'
        absent(f);assert call('finish_cancel',f)['state']=='canceled'
        assert scalar(f"SELECT used_bytes FROM wjb_gateway.workspace WHERE id='{f['ws']}';")=='0'
    test('cancel requires absent confirmation and quota released only once',cancel_pending)

    def late_io():
        f=fixture();old=ready(f,False);cancel(f)
        assert observe(f)['operationSettled'] is False
        reject('confirm_absent',f,'MIGRATION_IO_UNSETTLED',{'objectId':f['object'],'ioVersion':observe(f)['ioVersion']})
        # Already-issued C2 bookkeeping may settle after cancellation.
        c2(f,'settle_io',old);absent(f);assert call('finish_cancel',f)['state']=='canceled'
        r=sql(f"SET ROLE service_role;SELECT public.wjb_v2_asset_command({literal({'action':'acquire','userId':A,'sessionId':SA,'scope':{'workspaceId':f['ws'],'assetId':f['object'],'deviceId':DA,'generation':'1'},'params':{'token':str(uuid.uuid4()),'mode':'write'}})});",check=False)
        # acquire alone cannot write: the HTTP handler/state and begin_io gate stop it.
        assert r.returncode==0
        assert scalar(f"SELECT state FROM wjb_gateway.asset WHERE workspace_id='{f['ws']}';")=='canceled'
    test('cancel waits for old IO settlement; no timeout shortcut',late_io)

    def late_begin():
        f=fixture();token=str(uuid.uuid4());row=c2(f,'acquire',{'token':token,'mode':'write'});cancel(f)
        r={'action':'begin_io','userId':A,'sessionId':SA,'scope':{'workspaceId':f['ws'],'assetId':f['object'],'deviceId':DA,'generation':'1'},'params':{'token':token,'fence':row['fence'],'intent':str(uuid.uuid4())}}
        out=sql(f"SET ROLE service_role;SELECT public.wjb_v2_asset_command({literal(r)});",check=False)
        assert out.returncode and 'ASSET_NOT_PENDING' in out.stderr
    test('old gateway write lease cannot start IO after cancel fence',late_begin)

    def publish_replay():
        f=fixture();ready(f);attest(f);t=ticket(f);r=publish(f,t)
        assert publish(f,t)['receipt']==r
        assert call('publication',f,{'operationId':t['operationId']})['receipt']==r
        assert cancel(f)['state']=='connected'
        assert scalar(f"SELECT state FROM wjb_gateway.asset WHERE workspace_id='{f['ws']}';")=='ready'
    test('lost publish response replays same receipt; connected space never canceled',publish_replay)

    def ticket_fencing():
        f=fixture();ready(f);attest(f);op=str(uuid.uuid4());t=ticket(f,op)
        assert call('publication',f,{'operationId':op})['operationSettled'] is False
        sql(f"UPDATE wjb_migration.job SET publish_expires=now()-interval '1 second' WHERE id='{f['job']}';")
        observed=call('publication',f,{'operationId':op});assert observed['operationSettled'] is True
        reject('publish',f,'MIGRATION_PUBLISH_FENCED',t)
        reject('prepare_publish',f,'MIGRATION_PUBLISH_FENCED',{'operationId':op,'expectedFence':'0'})
        t2=call('prepare_publish',f,{'operationId':op,'expectedFence':observed['serverFence']})
        assert publish(f,t2)['status']=='poc-verified'
    test('reconciliation fences expired publish and delayed prepare requests',ticket_fencing)

    def late_publish():
        f=fixture();ready(f);attest(f);t=ticket(f);cancel(f)
        reject('publish',f,'MIGRATION_CANCELED',t)
        absent(f);assert call('finish_cancel',f)['state']=='canceled'
    test('cancel invalidates previously issued publication ticket',late_publish)

    def empty():
        f=fixture(False);assert publish(f,ticket(f))['status']=='poc-verified'
    test('empty image inventory is valid without invented Blob',empty)

    def renew():
        f=fixture();sql(f"UPDATE wjb_gateway.asset SET expires_at=now()-interval '1 day' WHERE workspace_id='{f['ws']}';")
        assert call('renew',f,{'objectId':f['object']})['renewed'];ready(f);attest(f)
    test('expired reservation can renew only within active migration',renew)

    def unrelated():
        ws=str(uuid.uuid4());sql(f"INSERT INTO wjb_gateway.workspace(id,owner_id,generation) VALUES('{ws}','{A}',1);")
        f={'ws':ws,'object':str(uuid.uuid4())};r=c2(f,'reserve',{'sha256':'a'*64,'bytes':32});assert r['created']
    test('new trigger preserves non-migration gateway workspaces',unrelated)

    def race(first):
        f=fixture();ready(f);attest(f);t=ticket(f);op=str(uuid.uuid4())
        req1=request('publish' if first=='publish' else 'cancel',f['job'],{'manifestHash':f['hash'],**(t if first=='publish' else {'operationId':op})})
        req2=request('cancel' if first=='publish' else 'publish',f['job'],{'manifestHash':f['hash'],**({'operationId':op} if first=='publish' else t)})
        app='wjb-migration-race-'+uuid.uuid4().hex[:8]
        holder=f"BEGIN;SET LOCAL ROLE service_role;SET LOCAL application_name='{app}';SELECT public.wjb_v2_migration_command({literal(req1)});SELECT pg_sleep(0.35);COMMIT;"
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            one=pool.submit(sql,holder)
            deadline=time.monotonic()+5
            while time.monotonic()<deadline:
                if scalar(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{app}' AND wait_event='PgSleep';")=='1':break
                time.sleep(0.02)
            else:raise AssertionError('Race holder not observed')
            two=pool.submit(sql,query(req2),False);a,b=one.result(),two.result()
        assert a.returncode==0
        state=call('status',f)['state']
        if first=='publish': assert b.returncode==0 and 'connected' in b.stdout and state=='connected'
        else: assert b.returncode!=0 and 'MIGRATION_CANCELED' in b.stderr and state=='cancel_fenced'
    test('two PG connections: publish commits first, cancel retains connected assets',lambda:race('publish'))
    test('two PG connections: cancel commits first, late publish rejected',lambda:race('cancel'))

    def permissions():
        assert scalar("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='wjb_migration' AND c.relkind='r' AND c.relrowsecurity;")=='3'
        assert scalar("SELECT count(*) FROM information_schema.columns WHERE table_schema='wjb_migration' AND data_type='bytea';")=='0'
        assert scalar("SELECT rolsuper::text||'/'||rolbypassrls::text FROM pg_roles WHERE rolname='wjb_owner';")=='false/true'
    test('RLS and image-free schema with non-superuser migration owner',permissions)

    def canonical_ids():
        f=fixture();m=json.loads(json.dumps(f['manifest']));m['workspaceId']=m['workspaceId'].upper()
        for a in m['assets']:a['objectId']=a['objectId'].upper()
        for d in m['documents']:
            d['id']=d['id'].upper()
            for b in d['blocks']:
                if b['type']=='image':b['assetId']=b['assetId'].upper()
        assert call('start',f,m)['manifestHash']==f['hash']
    test('UUID normalization preserves semantic manifest replay',canonical_ids)

    def revoked():
        f=fixture();sql(f"SET ROLE service_role;SELECT public.wjb_v2_revoke_session('{A}','{SA}');")
        reject('status',f,'MIGRATION_ACCESS_DENIED')
        sql(f"DELETE FROM wjb_v2_cloud.blocked_session WHERE session_id='{SA}';")
    test('existing session revocation blocks migration RPC',revoked)

    def cancel_replay():
        f=fixture();op=str(uuid.uuid4());first=cancel(f,op);version=observe(f)['ioVersion']
        assert cancel(f,op)==first and observe(f)['ioVersion']==version
        reject('cancel',f,'MIGRATION_OPERATION_CHANGED',{'operationId':str(uuid.uuid4())})
    test('cancel replay does not increment fence or release quota twice',cancel_replay)

    def wrong_publication():
        f=fixture();ready(f);attest(f);t=ticket(f)
        reject('publish',f,'MIGRATION_OPERATION_CHANGED',{**t,'operationId':str(uuid.uuid4())})
    test('different publication operation cannot reuse a ticket',wrong_publication)

    def renew_io():
        f=fixture();old=ready(f,False)
        reject('renew',f,'MIGRATION_RENEW_BLOCKED',{'objectId':f['object']})
        c2(f,'settle_io',old);assert call('renew',f,{'objectId':f['object']})['renewed']
    test('reservation renewal refuses outstanding IO',renew_io)

    def not_product_receipt():
        f=fixture();ready(f);attest(f);r=publish(f,ticket(f))
        source="""import {openWorkspaceRuntime} from REPLACE;
let raw='';for await(const c of process.stdin)raw+=c;const r=JSON.parse(raw);
try{await openWorkspaceRuntime({profile:'connected-preview',mode:'connected',format:'connected-metadata',workspaceId:r.workspaceId,manifestHash:r.manifestHash,verifyMigration:async()=>r,createConnected:()=>true});process.exitCode=2;}
catch(e){process.stdout.write(e.message);} """.replace('REPLACE',json.dumps((REPO/'poc/v2-runtime/isolation.mjs').as_uri()))
        child=subprocess.run(['node','--input-type=module','-e',source],input=json.dumps(r),text=True,capture_output=True,env=ENV,timeout=10)
        assert child.returncode==0 and child.stdout=='MIGRATION_NOT_VERIFIED'
    test('actual SQL PoC receipt is rejected by product activation guard',not_product_receipt)

    def reinstall_collision():
        before=scalar('SELECT count(*) FROM wjb_migration.job;')
        r=sql((ROOT/'001-migration.sql').read_text(),check=False)
        assert r.returncode and 'already exists' in r.stderr
        assert scalar('SELECT count(*) FROM wjb_migration.job;')==before
    test('module reapplication fails atomically without changing jobs',reinstall_collision)

    def nonempty_rollback():
        before=scalar('SELECT count(*) FROM wjb_migration.job;')
        r=sql((ROOT/'003-rollback-empty.sql').read_text(),check=False)
        assert r.returncode and 'MIGRATION_ROLLBACK_NOT_EMPTY' in r.stderr
        assert scalar('SELECT count(*) FROM wjb_migration.job;')==before
    test('rollback refuses used module and retains all jobs',nonempty_rollback)

    def http_rpc():
        f=fixture()
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                if self.path!='/rest/v1/rpc/wjb_v2_migration_command' or self.headers.get('Authorization')!='Bearer local-migration-fixture-key' or self.headers.get('apikey')!='local-migration-fixture-key':
                    self.send_error(401);return
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=65536:self.send_error(413);return
                try:
                    req=json.loads(self.rfile.read(length))
                    answer=sql(query(req['p_request']),check=False)
                    if answer.returncode:
                        code=re.search(r'ERROR:\s+(MIGRATION_[A-Z_]+)',answer.stderr)
                        body={'code':'P0001','message':code.group(1) if code else 'SQL_UNAVAILABLE'};status=400
                    else:body=json.loads(answer.stdout.strip());status=200
                except Exception:body={'message':'LOCAL_FIXTURE_UNAVAILABLE'};status=503
                encoded=json.dumps(body).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(encoded)));self.end_headers();self.wfile.write(encoded)
        server=HTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            payload={**f,'user':A,'session':SA,'device':DA,'otherUser':B,'otherSession':SB,'otherDevice':DB}
            child=subprocess.run(['node',str(REPO/'poc/v2-migration/rpc-pg-client.mjs'),'--local-fixture-only',f'http://127.0.0.1:{server.server_port}'],input=json.dumps(payload),text=True,capture_output=True,env=ENV,timeout=25)
            assert child.returncode==0 and child.stdout.strip()=='RPC_PG_HTTP_PASS',(child.stdout,child.stderr)
        finally:server.shutdown();server.server_close();thread.join(timeout=5)
    test('trusted migration RPC adapter crosses loopback HTTP to actual PG with dual manifest binding',http_rpc)


try:
    docker('info','--format','{{.ServerVersion}}')
    docker('image','inspect',IMAGE)
    docker('run','-d','--name',NAME,'--label','wjb.poc=migration-server','--network','none','--memory','512m','--cpus','1',
           '--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=256m','-e','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE,'-c','listen_addresses=')
    created=True
    for _ in range(80):
        if 'PostgreSQL init process complete' in docker('logs',NAME,check=False).stdout and docker('exec',NAME,'pg_isready','-U','postgres',check=False).returncode==0:break
        time.sleep(0.2)
    else:raise RuntimeError('Local PostgreSQL not ready')
    sql("CREATE ROLE service_role NOLOGIN NOSUPERUSER BYPASSRLS;CREATE ROLE authenticated NOLOGIN;CREATE ROLE anon NOLOGIN;CREATE ROLE wjb_owner LOGIN NOSUPERUSER BYPASSRLS;GRANT service_role,authenticated,anon TO wjb_owner;GRANT CREATE ON DATABASE postgres TO wjb_owner;GRANT USAGE,CREATE ON SCHEMA public TO wjb_owner;CREATE SCHEMA auth AUTHORIZATION wjb_owner;SET ROLE wjb_owner;CREATE TABLE auth.users(id uuid PRIMARY KEY,banned_until timestamptz,deleted_at timestamptz);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),not_after timestamptz);")
    SQL_USER = 'wjb_owner'
    for path in [REPO/'poc/v2-cloud/session-guard.sql',REPO/'poc/v2-gateway/postgres-metadata.sql',REPO/'poc/v2-gateway/recovery.sql']:
        sql(path.read_text())
    def preflight():
        r=json.loads(scalar((ROOT/'000-preflight.sql').read_text()))
        assert r['sessionGuard'] and r['assetCommand'] and not r['schemaCollision'] and not r['rpcCollision']
    test('preflight confirms separate unused module and existing prerequisites',preflight)
    sql((ROOT/'001-migration.sql').read_text())
    def empty_rollback():
        v=json.loads(scalar((ROOT/'002-verify.sql').read_text()))
        assert v['tables']==3 and v['rlsTables']==3 and v['functions']==6 and v['unsafeSearchPaths']==0
        assert v['binaryColumns']==0 and v['ownerSuperuser'] is False and not v['clientExecute']
        assert v['serviceExecute'] and not v['serviceTableAccess']
        base=scalar("SELECT pg_get_functiondef('public.wjb_v2_asset_command(jsonb)'::regprocedure);")
        sql((ROOT/'003-rollback-empty.sql').read_text())
        assert scalar("SELECT to_regnamespace('wjb_migration') IS NULL;")=='t'
        assert scalar("SELECT pg_get_functiondef('public.wjb_v2_asset_command(jsonb)'::regprocedure);")==base
        sql((ROOT/'001-migration.sql').read_text())
    test('unused rollback removes only new objects; existing gateway definition preserved',empty_rollback)
    sql(f"INSERT INTO auth.users(id) VALUES('{A}'),('{B}');INSERT INTO auth.sessions(id,user_id) VALUES('{SA}','{A}'),('{SB}','{B}');INSERT INTO wjb_gateway.device(id,user_id,session_id) VALUES('{DA}','{A}','{SA}'),('{DB}','{B}','{SB}');")
    if not options.workspace_only: tests()
    if options.full_workspace:
        import runpy
        sql((ROOT/'004-workspace.sql').read_text())
        runpy.run_path(str(ROOT/'full-workspace-tests.py'))['run'](globals())
    result={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'postgres':scalar('SHOW server_version;'),
      'image':IMAGE,'tests':RESULTS,'passed':len(RESULTS),'cloudApplied':False,'storageBytesReadbackTested':False,'fullWorkspaceProfileTested':options.full_workspace,'baselineSuiteExecuted':not options.workspace_only,
      'scope':'Actual PostgreSQL functions/RLS/locks, fixture Auth and trusted gateway attestations; no remote network',
      'sourceSha256':{str(p.relative_to(REPO)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [*sorted(ROOT.glob('*.sql')),ROOT/'run-local.py',ROOT/'build-workspace-sql.py',ROOT/'full-workspace-tests.py',ROOT/'templates/workspace-validation.sql',REPO/'poc/v2-migration/db18-contract.json',REPO/'poc/v2-migration/db19-contract.json',REPO/'poc/v2-migration/emit-workspace-fixture.mjs',REPO/'poc/v2-migration/fixture-full-workspace.mjs',REPO/'poc/v2-assets/connected-copy.mjs',REPO/'poc/v2-sync/db18.mjs',REPO/'poc/v2-migration/workspace-map.mjs',REPO/'poc/v2-migration/server-rpc.mjs',REPO/'poc/v2-migration/rpc-pg-client.mjs',REPO/'poc/v2-cloud/session-guard.sql',REPO/'poc/v2-gateway/postgres-metadata.sql',REPO/'poc/v2-gateway/recovery.sql']}}
    EVIDENCE.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'passed':len(RESULTS),'postgres':result['postgres'],'cloudApplied':False}))
finally:
    removed = not created or docker('rm','-f','-v',NAME,check=False).returncode==0
    if result is not None:
        result['localContainerRemoved']=removed
        EVIDENCE.write_text(json.dumps(result,indent=2)+'\n')
    if not removed:raise RuntimeError('Owned local test container cleanup failed')
