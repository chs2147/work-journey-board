"""Local PostgreSQL tests for 010 paged upload (C-1a, docs/v2-design/81); synthetic data only."""
import hashlib
import json
import subprocess
import time
import uuid


def run(g):
    sql,scalar,test=[g[k] for k in ['sql','scalar','test']]
    ROOT,REPO,ENV,A,B,SB,DB=g['ROOT'],g['REPO'],g['ENV'],g['A'],g['B'],g['SB'],g['DB']
    request,query=g['request'],g['query']
    def emit(version,extra=0):
        args=['node',str(REPO/'poc/v2-migration/emit-workspace-fixture.mjs'),str(version)]+(['--extra-items',str(extra)] if extra else [])
        child=subprocess.run(args,capture_output=True,text=True,env=ENV,timeout=120)
        assert child.returncode==0,child.stderr[-500:]
        return json.loads(child.stdout)
    def up(action,jid,params,**who):
        return json.loads(scalar(query(request(action,jid,params,**who))))
    def up_reject(action,jid,params,code,**who):
        r=sql(query(request(action,jid,params,**who)),check=False)
        assert r.returncode and code in r.stderr,(code,r.stdout[-300:],r.stderr[-500:])
    def clean():
        sql("UPDATE wjb_migration.job SET state='canceled' WHERE state IN('staging','cancel_fenced'); DELETE FROM wjb_migration.upload;")
    def pages_of(m,size=1000):
        recs=m['records'];return [recs[i:i+size] for i in range(0,len(recs),size)]
    def header(m):
        return {k:v for k,v in m.items() if k!='records'}
    def sha(x): return hashlib.sha256(json.dumps(x,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
    def send_all(jid,m,skip=()):
        ps=pages_of(m)
        b=up('upload_begin',jid,{'header':header(m),'pages':len(ps),'records':len(m['records'])})
        for i,pg in enumerate(ps):
            if i in skip: continue
            up('upload_page',jid,{'index':i,'sha256':sha(pg),'records':pg})
        return ps,b
    command_def="SELECT pg_get_functiondef('public.wjb_v2_migration_command(jsonb)'::regprocedure);"
    normalize_def="SELECT pg_get_functiondef('wjb_migration.normalize_workspace(jsonb)'::regprocedure);"
    base_command=scalar(command_def);base_normalize=scalar(normalize_def)

    def apply_once():
        sql((ROOT/'010-workspace-paged-upload.sql').read_text())
        r=sql((ROOT/'010-workspace-paged-upload.sql').read_text(),check=False)
        assert r.returncode and 'MIGRATION_010_ALREADY_APPLIED' in r.stderr
    test('010 applies once over used 004/007 and refuses a second run',apply_once)
    def verify_and_rollback():
        v=json.loads(scalar((ROOT/'012-workspace-paged-upload-verify.sql').read_text()))
        assert v['uploadTables']==2 and v['tables']==7 and v['rlsTables']==7 and v['pagedActions'] and v['core'] and v['recordLimit20000']
        assert v['serviceRPC'] and not v['clientRPC'] and not v['directTableAccess'] and not v['privateExecute'] and not v['unsafeSearchPaths']
        sql((ROOT/'011-workspace-paged-upload-rollback-empty.sql').read_text())
        assert scalar(command_def)==base_command and scalar(normalize_def)==base_normalize
        assert scalar("SELECT to_regclass('wjb_migration.upload') IS NULL AND to_regprocedure('wjb_migration.command_core(jsonb)') IS NULL;")=='t'
        sql((ROOT/'010-workspace-paged-upload.sql').read_text())
    test('012 review ACL/RLS; unused 011 restores the exact 004 command and 007 validation',verify_and_rollback)

    def legacy_start():
        clean();m=emit(20);f={'job':str(uuid.uuid4()),'ws':m['workspaceId']}
        r=g['call']('start',f,m);f['hash']=r['manifestHash']
        assert g['call']('workspace',f)['envelope']==m
    test('direct start (single request) still stages and reads back after 010',legacy_start)

    big={}
    def paged_5000():
        clean();m=emit(20,5000);big['m']=m;jid=str(uuid.uuid4())
        assert len(m['records'])>2048
        t0=time.time();ps,b=send_all(jid,m)
        assert b['received']==[] and len(ps)==6
        s=up('upload_status',jid,{})
        assert s['started'] is False and s['received']==list(range(6))
        t1=time.time();r=up('start_upload',jid,{});t2=time.time()
        big['seconds']={'pages':round(t1-t0,2),'startUpload':round(t2-t1,2)}
        assert r['state']=='staging' and r['profile']=='workspace-db20-map-poc-1'
        assert scalar(f"SELECT count(*) FROM wjb_migration.workspace_record WHERE job_id='{jid}';")==str(len(m['records']))
        assert scalar(f"SELECT count(*) FROM wjb_migration.upload WHERE id='{jid}';")=='0' and scalar(f"SELECT count(*) FROM wjb_migration.upload_page WHERE upload_id='{jid}';")=='0'
        f={'job':jid,'ws':m['workspaceId'],'hash':r['manifestHash']}
        t3=time.time();back=g['call']('workspace',f)['envelope'];big['seconds']['readBack']=round(time.time()-t3,2)
        assert back==m
        # 재호출은 같은 작업(idempotent), 시작 뒤 상태 조회는 작업 정보
        assert up('start_upload',jid,{})['manifestHash']==r['manifestHash']
        assert up('upload_status',jid,{})['started'] is True
        assert big['seconds']['startUpload']<20,big['seconds']
        print('PAGED_TIMING',json.dumps(big['seconds']))
    test('5,052-row DB20 envelope (over the old 2,048 limit) uploads in 6 pages, stages and reads back losslessly',paged_5000)

    def resume_and_conflicts():
        clean();m={**big['m'],'workspaceId':str(uuid.uuid4())};jid=str(uuid.uuid4())
        ps,_=send_all(jid,m,skip={2,4})
        assert up('upload_status',jid,{})['received']==[0,1,3,5]
        up_reject('start_upload',jid,{},'MIGRATION_UPLOAD_INCOMPLETE')
        # 같은 페이지 다시 보내기 = 그대로, 내용이 다르면 거절
        up('upload_page',jid,{'index':1,'sha256':sha(ps[1]),'records':ps[1]})
        changed=json.loads(json.dumps(ps[1]));changed[0]['value']['text']='다른 내용'
        up_reject('upload_page',jid,{'index':1,'sha256':sha(changed),'records':changed},'MIGRATION_PAGE_CHANGED')
        up_reject('upload_page',jid,{'index':6,'sha256':sha(ps[0]),'records':ps[0]},'MIGRATION_INVALID_PARAMS')
        # 같은 업로드 ID로 다른 머리 = 거절, 같은 머리 = 받은 페이지 목록
        up_reject('upload_begin',jid,{'header':header(m),'pages':6,'records':len(m['records'])-1},'MIGRATION_IDEMPOTENCY_MISMATCH')
        assert up('upload_begin',jid,{'header':header(m),'pages':6,'records':len(m['records'])})['received']==[0,1,3,5]
        for i in (2,4): up('upload_page',jid,{'index':i,'sha256':sha(ps[i]),'records':ps[i]})
        assert up('start_upload',jid,{})['state']=='staging'
    test('interrupted upload resumes with missing pages only; changed/out-of-range pages and changed header refused',resume_and_conflicts)

    def isolation():
        clean();m=emit(20);jid=str(uuid.uuid4());ps=pages_of(m)
        up('upload_begin',jid,{'header':header(m),'pages':len(ps),'records':len(m['records'])})
        who={'user':B,'session':SB,'device':DB}
        up_reject('upload_page',jid,{'index':0,'sha256':sha(ps[0]),'records':ps[0]},'MIGRATION_UPLOAD_NOT_FOUND',**who)
        up_reject('upload_status',jid,{},'MIGRATION_UPLOAD_NOT_FOUND',**who)
        up_reject('start_upload',jid,{},'MIGRATION_UPLOAD_NOT_FOUND',**who)
        up_reject('upload_begin',jid,{'header':header(m),'pages':len(ps),'records':len(m['records'])},'MIGRATION_ACCESS_DENIED',**who)
        r=sql(query(request('upload_status',jid,{}),'authenticated'),check=False)
        assert r.returncode and 'permission denied' in r.stderr
    test('other account cannot see, add to or start an upload; client roles cannot call the RPC',isolation)

    def limits_and_rules():
        clean();m=emit(20);jid=str(uuid.uuid4())
        up_reject('upload_begin',jid,{'header':header(m),'pages':21,'records':20001},'MIGRATION_INVALID_PARAMS')
        up_reject('upload_begin',jid,{'header':{**header(m),'records':[]},'pages':1,'records':1},'MIGRATION_INVALID_PARAMS')
        # 검증 규칙은 그대로: 없는 업무를 가리키는 기록은 페이지로 보내도 거절(작업·자료 생기지 않음)
        bad=json.loads(json.dumps(m))
        item=next(r for r in bad['records'] if r['table']=='entry_item')
        item['value']['category_id']='missing-category'
        before=scalar('SELECT count(*) FROM wjb_migration.job;')
        send_all(jid,bad)
        up_reject('start_upload',jid,{},'MIGRATION_FOREIGN_KEY')
        assert scalar('SELECT count(*) FROM wjb_migration.job;')==before
        assert scalar(f"SELECT count(*) FROM wjb_migration.upload_page WHERE upload_id='{jid}';")==str(len(pages_of(bad)))
    test('limits (20,000 rows, header without records) and unchanged validation (foreign key) on assembled pages',limits_and_rules)
