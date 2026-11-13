"""Local PostgreSQL tests for the DB20 kanban extension (007/008/009); synthetic data only."""
import copy
import hashlib
import json
import subprocess
import uuid


def run(g):
    sql,scalar,call,reject,test=[g[k] for k in ['sql','scalar','call','reject','test']]
    ROOT,REPO,ENV=g['ROOT'],g['REPO'],g['ENV']
    def emit(version):
        child=subprocess.run(['node',str(REPO/'poc/v2-migration/emit-workspace-fixture.mjs'),str(version)],capture_output=True,text=True,env=ENV,timeout=10)
        assert child.returncode==0,child.stderr
        return json.loads(child.stdout)
    def stage(v):
        sql("UPDATE wjb_migration.job SET state='canceled' WHERE state IN('staging','cancel_fenced');")
        f={'job':str(uuid.uuid4()),'ws':v['workspaceId'],'manifest':v}
        result=call('start',f,v);f['hash']=result['manifestHash']
        assert result['profile']==v['profile']
        return f
    def reject_manifest(m,code):
        f={'job':str(uuid.uuid4()),'ws':m['workspaceId']}
        before=scalar('SELECT count(*) FROM wjb_migration.job;')
        r=sql(g['query'](g['request']('start',f['job'],m)),check=False)
        assert r.returncode and code in r.stderr,(code,r.stdout,r.stderr[-400:])
        assert scalar('SELECT count(*) FROM wjb_migration.job;')==before
        assert scalar(f"SELECT count(*) FROM wjb_gateway.workspace WHERE id='{f['ws']}';")=='0'
    defs="SELECT string_agg(pg_get_functiondef(p.oid),E'\\n' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='wjb_migration' AND p.proname IN('normalize','normalize_workspace','workspace_contract');"
    base_defs=scalar(defs)
    base_check=scalar("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='wjb_migration.job'::regclass AND conname='job_profile_check';")
    sql((ROOT/'007-workspace-db20.sql').read_text())
    def apply_once():
        before=scalar(defs)
        r=sql((ROOT/'007-workspace-db20.sql').read_text(),check=False)
        assert r.returncode and 'MIGRATION_007_ALREADY_APPLIED' in r.stderr
        assert scalar(defs)==before
    test('007 applies over a used 004 once and refuses a second run without change',apply_once)
    def review_and_empty_rollback():
        v=json.loads(scalar((ROOT/'008-workspace-db20-verify.sql').read_text()))
        assert v['db20Contract'] and v['db20Tables']==30 and v['profileCheck'] and v['serviceRPC']
        assert v['tables']==5 and v['rlsTables']==5
        assert not any(v[k] for k in ['clientRPC','directTableAccess','privateExecute','unsafeSearchPaths'])
        jobs=scalar('SELECT count(*) FROM wjb_migration.job;');records=scalar('SELECT count(*) FROM wjb_migration.workspace_record;')
        sql((ROOT/'009-workspace-db20-rollback-empty.sql').read_text())
        assert scalar(defs)==base_defs  # exact 004 function text restored
        assert scalar("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='wjb_migration.job'::regclass AND conname='job_profile_check';")==base_check
        assert scalar('SELECT count(*) FROM wjb_migration.job;')==jobs and scalar('SELECT count(*) FROM wjb_migration.workspace_record;')==records
        sql((ROOT/'007-workspace-db20.sql').read_text())
    test('008 review ACL/RLS and unused 009 rollback restore exact 004 functions, keeping DB18/19 jobs',review_and_empty_rollback)
    def roundtrip20():
        m=emit(20);f=stage(m)
        fetched=call('workspace',f)
        assert fetched['envelope']==m and fetched['productActivationAllowed'] is False
        assert len(m['tableStats'])==30
        assert m['tableStats']['kanban_ctx']=={'sourceRows':1,'mappedRows':0,'excludedRows':1,'transformedRows':0}
        for t in ['kanban_section','item_status_log','kanban_bulk']: assert m['tableStats'][t]['mappedRows']>0,t
        settings=json.loads(next(r for r in m['records'] if r['table']=='app_meta' and r['value']['key']=='settings')['value']['value'])
        assert set(settings['ui'])=={'kanbanColumns'}
        assert scalar(f"SELECT count(*) FROM wjb_migration.workspace_record WHERE job_id='{f['job']}';")==str(len(m['records']))
        assert scalar(f"SELECT count(*) FROM wjb_migration.workspace_record WHERE job_id='{f['job']}' AND table_name='kanban_ctx';")=='0'
        assert 'private-machine' not in json.dumps(fetched) and '"rects"' not in json.dumps(fetched)
        assert call('start',f,m)['manifestHash']==f['hash']
        publication=g['ticket'](f)
        g['reject']('publish',f,'MIGRATION_NOT_VERIFIED',publication)
        for asset in m['assets']:
            af={**f,'object':asset['objectId'],'sha':asset['sha256'],'bytes':asset['bytes']}
            g['ready'](af);g['attest'](af)
        receipt=g['publish'](f,publication)
        assert receipt['status']=='poc-verified' and receipt['profile']=='workspace-db20-map-poc-1'
        assert call('workspace',f)['envelope']==m and g['cancel'](f)['state']=='connected'
    test('actual DB20 envelope stages 30 tables, excludes write context, reads losslessly and publishes only after attestation',roundtrip20)
    for version in [18,19]:
        def still(version=version):
            m=emit(version);f=stage(m)
            assert call('workspace',f)['envelope']==m and len(m['tableStats'])==26
        test(f'DB{version} envelopes still stage and read back unchanged after 007',still)
    settings=lambda m:next(r for r in m['records'] if r['table']=='app_meta' and r['value']['key']=='settings')['value']
    def set_ui(m,ui):
        s=settings(m);v=json.loads(s['value']);v['ui']=ui;s['value']=json.dumps(v,ensure_ascii=False)
    def kc(m):return json.loads(settings(m)['value'])['ui']['kanbanColumns']
    first=lambda m,t:next(r for r in m['records'] if r['table']==t)['value']
    mutations=[
      ('write-context record smuggled in',lambda m:m['records'].append({'table':'kanban_ctx','key':hashlib.sha256(b'["kanban_ctx",[1]]').hexdigest(),'value':{'id':1,'source':'board','batch_id':None,'at':None}}),'MIGRATION_KANBAN_CONTEXT'),
      ('missing write-context exclusion',lambda m:m.update(exclusions=[x for x in m['exclusions'] if x['table']!='kanban_ctx']),'MIGRATION_EXCLUSION'),
      ('write-context accounting drift',lambda m:m['tableStats']['kanban_ctx'].update(excludedRows=0,sourceRows=0),'MIGRATION_ROW_COUNTS'),
      ('overlong section name',lambda m:first(m,'kanban_section').update(name='가'*21),'MIGRATION_KANBAN_FORMAT'),
      ('unknown status source',lambda m:first(m,'item_status_log').update(source='sync'),'MIGRATION_KANBAN_FORMAT'),
      ('status line without change',lambda m:first(m,'item_status_log').update(to_key=first(m,'item_status_log')['from_key']),'MIGRATION_KANBAN_FORMAT'),
      ('non-ISO status time',lambda m:first(m,'item_status_log').update(changed_at='2026/11/12 09:00'),'MIGRATION_KANBAN_FORMAT'),
      ('malformed bulk undo items',lambda m:first(m,'kanban_bulk').update(items='[["x"]]'),'MIGRATION_KANBAN_FORMAT'),
      ('bulk count above items',lambda m:first(m,'kanban_bulk').update(count=9),'MIGRATION_KANBAN_FORMAT'),
      ('item in a missing section',lambda m:next(r for r in m['records'] if r['table']=='entry_item' and r['value']['kanban_section_id'])['value'].update(kanban_section_id='ks-absent'),'MIGRATION_FOREIGN_KEY'),
      ('column order naming a missing section',lambda m:set_ui(m,{'kanbanColumns':{**kc(m),'order':kc(m)['order']+['ks-absent']}}),'MIGRATION_KANBAN_REFERENCE'),
      ('duplicate column order key',lambda m:set_ui(m,{'kanbanColumns':{**kc(m),'order':kc(m)['order']+['todo']}}),'MIGRATION_KANBAN_REFERENCE'),
      ('unknown column icon',lambda m:set_ui(m,{'kanbanColumns':{**kc(m),'icons':{'todo':'not-an-icon'}}}),'MIGRATION_KANBAN_REFERENCE'),
      ('per-device kanban layout',lambda m:set_ui(m,{'kanbanColumns':kc(m),'kanbanLayout':{'mode':'free','rects':{}}}),'MIGRATION_SETTINGS'),
      ('kept marker on another exclusion',lambda m:next(x for x in m['exclusions'] if x['key']=='settings.ai').update(kept=['kanbanColumns']),'MIGRATION_EXCLUSION'),
      ('profile/schema mismatch',lambda m:m.update(sourceSchema=19),'MIGRATION_WORKSPACE_SCHEMA'),
      ('unknown DB21 schema',lambda m:m.update(sourceSchema=21,profile='workspace-db21-map-poc-1'),'MIGRATION_INVALID_MANIFEST'),
    ]
    for label,mutate,code in mutations:
        def negative(mutate=mutate,code=code):
            m=emit(20);mutate(m);reject_manifest(m,code)
        test('DB20 manifest rejects '+label+' atomically',negative)
    def ui_before_20():
        m=emit(19);set_ui(m,{'kanbanColumns':{'order':['todo','done'],'icons':{}}});reject_manifest(m,'MIGRATION_SETTINGS')
    test('DB19 envelope still refuses any ui settings after 007',ui_before_20)
    def acl():
        f=stage(emit(20))
        reject('workspace',f,'MIGRATION_ACCESS_DENIED',user=g['B'],session=g['SB'],device=g['DB'])
        for role in ['anon','authenticated']: reject('workspace',f,'permission denied',role=role)
    test('DB20 retrieval keeps identity checks and server-only RPC',acl)
    def rollback_used():
        defs_before=scalar(defs);records=scalar('SELECT count(*) FROM wjb_migration.workspace_record;')
        r=sql((ROOT/'009-workspace-db20-rollback-empty.sql').read_text(),check=False)
        assert r.returncode and 'MIGRATION_DB20_ROLLBACK_NOT_EMPTY' in r.stderr
        assert scalar(defs)==defs_before and scalar('SELECT count(*) FROM wjb_migration.workspace_record;')==records
    test('used DB20 extension cannot roll back or delete DB20 metadata',rollback_used)
