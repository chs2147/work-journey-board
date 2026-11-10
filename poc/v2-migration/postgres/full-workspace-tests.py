"""Local PostgreSQL tests for generated full DB18/19 envelopes; no user data."""
import copy
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
        f={'job':str(uuid.uuid4()),'ws':m['workspaceId'],'hash':'f'*64}
        before=scalar('SELECT count(*) FROM wjb_migration.job;')
        # reject() adds a non-start manifestHash, so start directly through query().
        r=sql(g['query'](g['request']('start',f['job'],m)),check=False)
        assert r.returncode and code in r.stderr,(code,r.stdout,r.stderr)
        assert scalar('SELECT count(*) FROM wjb_migration.job;')==before
        assert scalar(f"SELECT count(*) FROM wjb_gateway.workspace WHERE id='{f['ws']}';")=='0'
    def extension_review():
        v=json.loads(scalar((ROOT/'005-workspace-verify.sql').read_text()))
        assert v['tables']==5 and v['rlsTables']==5 and v['serviceRPC']
        assert not any(v[k] for k in ['clientRPC','directTableAccess','privateExecute','unsafeSearchPaths'])
        before=scalar('SELECT count(*) FROM wjb_migration.job;')
        sql((ROOT/'006-workspace-rollback-empty.sql').read_text())
        assert scalar('SELECT count(*) FROM wjb_migration.job;')==before
        assert scalar("SELECT to_regclass('wjb_migration.workspace_record') IS NULL;")=='t'
        sql((ROOT/'004-workspace.sql').read_text())
    test('full extension ACL/RLS and empty rollback preserve historical document jobs',extension_review)
    for version in [18,19]:
        def roundtrip(version=version):
            m=emit(version);f=stage(m)
            fetched=call('workspace',f)
            assert fetched['envelope']==m and fetched['productActivationAllowed'] is False
            assert 'private-machine' not in json.dumps(fetched)
            assert len(m['tableStats'])==26 and all(s['mappedRows']>0 for s in m['tableStats'].values())
            assert scalar(f"SELECT count(*) FROM wjb_migration.workspace_record WHERE job_id='{f['job']}';")==str(len(m['records']))
            if version==19:
                assert sorted(r['value']['delete_locked'] for r in fetched['envelope']['records'] if r['table']=='cabi_note')==[0,1]
            replay=call('start',f,m);assert replay['manifestHash']==f['hash']
            publication=g['ticket'](f)
            g['reject']('publish',f,'MIGRATION_NOT_VERIFIED',publication)
            for asset in m['assets']:
                af={**f,'object':asset['objectId'],'sha':asset['sha256'],'bytes':asset['bytes']}
                g['ready'](af);g['attest'](af)
            receipt=g['publish'](f,publication)
            assert receipt['status']=='poc-verified' and receipt['profile']==m['profile']
            assert call('workspace',f)['envelope']==m
            assert g['cancel'](f)['state']=='connected'
        test(f'actual DB{version} envelope stages all tables, reads losslessly, replays and publishes only after attestation',roundtrip)
    mutations=[
      ('unknown profile',lambda m:m.update(profile='workspace-db20-map-poc-1'),'MIGRATION_INVALID_MANIFEST'),
      ('wrong contract fingerprint',lambda m:m.update(contractFingerprint='0'*64),'MIGRATION_WORKSPACE_SCHEMA'),
      ('unsupported schema',lambda m:m.update(sourceSchema=20),'MIGRATION_WORKSPACE_SCHEMA'),
      ('extra root binary field',lambda m:m.update(binary='AAAA'),'MIGRATION_WORKSPACE_FORMAT'),
      ('raw inline image',lambda m:m['records'][0]['value'].update(title='data:image/png;base64,AAAA'),'MIGRATION_INLINE_IMAGE'),
      ('escaped inline image in stringified rich JSON',lambda m:next(r for r in m['records'] if r['table']=='cabi_note')['value'].update(content='{"type":"doc","content":[{"type":"text","text":"data\\u003aimage/png;base64,AAAA"}]}'),'MIGRATION_INLINE_IMAGE'),
      ('unknown row column',lambda m:m['records'][0]['value'].update(unexpected='value'),'MIGRATION_ROW_COLUMNS'),
      ('changed record key',lambda m:m['records'][0].update(key='0'*64),'MIGRATION_RECORD_KEY'),
      ('duplicate record',lambda m:m['records'].append(copy.deepcopy(m['records'][0])),'MIGRATION_DUPLICATE_RECORD'),
      ('missing foreign record',lambda m:next(r for r in m['records'] if r['table']=='cabi_note')['value'].update(category_id='absent'),'MIGRATION_FOREIGN_KEY'),
      ('missing physical reference',lambda m:m.update(assets=[]),'MIGRATION_IMAGE_REFERENCE'),
      ('invalid delete lock',lambda m:next(r for r in m['records'] if r['table']=='cabi_note')['value'].update(delete_locked=2),'MIGRATION_DELETE_LOCK'),
      ('row count drift',lambda m:m['tableStats']['cabi_note'].update(mappedRows=77),'MIGRATION_ROW_COUNTS'),
      ('missing table accounting',lambda m:m['tableStats'].pop('tag'),'MIGRATION_WORKSPACE_FORMAT'),
      ('missing exclusion audit',lambda m:m.update(exclusions=[]),'MIGRATION_EXCLUSION'),
      ('forbidden original policy',lambda m:m['policies'].update(sourceModel='delete-original'),'MIGRATION_WORKSPACE_FORMAT'),
      ('oversize image',lambda m:m['assets'][0].update(bytes=65537),'MIGRATION_INVALID_ASSET'),
      ('local folder target',lambda m:next(r for r in m['records'] if r['table']=='cabinet_item' and r['value']['kind']=='folder')['value'].update(target='C:\\private-machine\\folder'),'MIGRATION_LOCAL_PATH'),
      ('device setting',lambda m:next(r for r in m['records'] if r['table']=='app_meta' and r['value']['key']=='settings')['value'].update(value='{"ui":{"path":"C:/private"}}'),'MIGRATION_SETTINGS'),
      ('nested device setting',lambda m:next(r for r in m['records'] if r['table']=='app_meta' and r['value']['key']=='settings')['value'].update(value='{"holiday":{"krEnabled":true,"off":[{"path":"C:/private"}],"company":[],"reasons":[]}}'),'MIGRATION_SETTINGS'),
      ('missing rich content',lambda m:next(r for r in m['records'] if r['table']=='week_note')['value'].update(doc='{"v":1,"boxes":[{"id":"no-content","kind":"text"}]}'),'MIGRATION_RICH_FORMAT'),
      ('string for integer',lambda m:next(r for r in m['records'] if r['table']=='cabi_note')['value'].update(revision='2'),'MIGRATION_ROW_TYPE'),
      ('null row accounting',lambda m:m['tableStats'].update(cabi_note=None),'MIGRATION_ROW_COUNTS'),
      ('unknown live widget',lambda m:next(r for r in m['records'] if r['table']=='cabi_board')['value'].update(doc='{"v":1,"boxes":[{"id":"widget","kind":"text","content":{"type":"doc"},"widget":{"type":"future"}}]}'),'MIGRATION_WIDGET_FORMAT'),
      ('dangling board edge',lambda m:next(r for r in m['records'] if r['table']=='cabi_board')['value'].update(doc='{"v":1,"boxes":[],"edges":[{"from":"missing","to":"also-missing"}]}'),'MIGRATION_BOARD_REFERENCE'),
      ('image reference owner mismatch',lambda m:next(r for r in m['records'] if r['table']=='cabi_note')['value'].update(content='{"type":"doc","content":[{"type":"image","attrs":{"asset":"ca"}}]}'),'MIGRATION_IMAGE_REFERENCE'),
      ('oversize metadata',lambda m:next(r for r in m['records'] if r['table']=='cabi_note')['value'].update(plain_text='a'*1048576),'MIGRATION_INVALID_REQUEST'),
      ('unknown document node',lambda m:next(r for r in m['records'] if r['table']=='cabi_note')['value'].update(content='{"type":"unknown"}'),'MIGRATION_RICH_FORMAT'),
    ]
    for label,mutate,code in mutations:
        def negative(mutate=mutate,code=code):
            m=emit(19);mutate(m);reject_manifest(m,code)
        test('full manifest rejects '+label+' atomically',negative)
    def acl():
        f=stage(emit(19))
        reject('workspace',f,'MIGRATION_ACCESS_DENIED',user=g['B'],session=g['SB'],device=g['DB'])
        for role in ['anon','authenticated']:
            reject('workspace',f,'permission denied',role=role)
        for table in ['workspace_header','workspace_record']:
            for role in ['anon','authenticated','service_role']:
                r=sql(f'SET ROLE {role}; SELECT * FROM wjb_migration.{table};',check=False)
                assert r.returncode and 'permission denied' in r.stderr
    test('full envelope retrieval enforces identity and server-only RPC with no direct table ACL',acl)
    def metadata_drift():
        f=stage(emit(19));t=g['ticket'](f)
        sql(f"UPDATE wjb_migration.workspace_record SET value=jsonb_set(value,'{{delete_locked}}','0') WHERE job_id='{f['job']}' AND table_name='cabi_note' AND value->>'delete_locked'='1';")
        reject('workspace',f,'MIGRATION_METADATA_CHANGED')
        reject('publish',f,'MIGRATION_METADATA_CHANGED',t)
    test('full metadata drift blocks readback and publication before image state checks',metadata_drift)
    def missing_header():
        f=stage(emit(19));t=g['ticket'](f)
        sql(f"DELETE FROM wjb_migration.workspace_header WHERE job_id='{f['job']}';")
        reject('workspace',f,'MIGRATION_METADATA_CHANGED')
        reject('publish',f,'MIGRATION_METADATA_CHANGED',t)
    test('missing full header fails closed instead of bypassing nullable digest comparison',missing_header)
    def cancel_roundtrip():
        f=stage(emit(19));g['cancel'](f)
        for asset in f['manifest']['assets']:
            g['absent']({**f,'object':asset['objectId']})
        assert call('finish_cancel',f)['state']=='canceled'
        reject('workspace',f,'MIGRATION_WORKSPACE_UNAVAILABLE')
        assert scalar(f"SELECT count(*) FROM wjb_migration.workspace_record WHERE job_id='{f['job']}';")==str(len(f['manifest']['records']))
    test('full cancel fences publication and retains metadata without exposing canceled workspace',cancel_roundtrip)
    def rollback_used():
        before=scalar('SELECT count(*) FROM wjb_migration.workspace_record;')
        r=sql((ROOT/'006-workspace-rollback-empty.sql').read_text(),check=False)
        assert r.returncode and 'MIGRATION_WORKSPACE_ROLLBACK_NOT_EMPTY' in r.stderr
        assert scalar('SELECT count(*) FROM wjb_migration.workspace_record;')==before
    test('used full extension cannot roll back or delete staged/canceled metadata',rollback_used)
    def document_compat():
        f=g['fixture']();g['ready'](f);g['attest'](f)
        assert g['publish'](f,g['ticket'](f))['profile']=='migration-document-poc-1'
    test('legacy minimal document profile still publishes through unchanged attestation rules',document_compat)

    def http_journal(scenario):
        import threading
        from http.server import HTTPServer, BaseHTTPRequestHandler
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                if self.path!='/rest/v1/rpc/wjb_v2_migration_command' or self.headers.get('Authorization')!='Bearer local-migration-fixture-key' or self.headers.get('apikey')!='local-migration-fixture-key':self.send_error(401);return
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=1048576:self.send_error(413);return
                try:
                    import re
                    req=json.loads(self.rfile.read(length));answer=sql(g['query'](req['p_request']),check=False)
                    if answer.returncode:
                        code=re.search(r'ERROR:\s+(MIGRATION_[A-Z_]+)',answer.stderr)
                        body={'code':'P0001','message':code.group(1) if code else 'SQL_UNAVAILABLE'};status=400
                    else:body=json.loads(answer.stdout.strip());status=200
                except Exception:body={'message':'LOCAL_FIXTURE_UNAVAILABLE'};status=503
                encoded=json.dumps(body,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(encoded)));self.end_headers();self.wfile.write(encoded)
        server=HTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            payload={'user':g['A'],'session':g['SA'],'device':g['DA'],'scenario':scenario}
            child=subprocess.run(['node',str(REPO/'poc/v2-migration/workspace-session-pg-client.mjs'),'--local-fixture-only',f'http://127.0.0.1:{server.server_port}'],input=json.dumps(payload),text=True,capture_output=True,env=ENV,timeout=30)
            assert child.returncode==0 and child.stdout.strip()=='WORKSPACE_SESSION_PG_PASS',(child.stdout,child.stderr)
        finally:server.shutdown();server.server_close();thread.join(timeout=5)
    for scenario in ['start','publish','cancel']:
        test('actual HTTP/PG plus persistent journal reconciles lost '+scenario+' with >64KiB metadata',lambda scenario=scenario:http_journal(scenario))
