"""Bounded local Storage wire endpoint + actual PostgreSQL; no external storage."""
import json
import re
import subprocess
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler


def run(g):
    sql,scalar,test=[g[k] for k in ['sql','scalar','test']]
    REPO,ENV=g['REPO'],g['ENV']
    for scenario in ['happy','lost-ready','lost-settle','cancel','lost-delete','unknown-absence','late-put','lost-put','corrupt-get']:
        def case(scenario=scenario):
            objects={}
            class Handler(BaseHTTPRequestHandler):
                def log_message(self,*args):pass
                def respond(self,status,value):
                    encoded=json.dumps(value,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(encoded)));self.end_headers();self.wfile.write(encoded)
                def auth(self):
                    if self.headers.get('Authorization')!='Bearer local-migration-fixture-key' or self.headers.get('apikey')!='local-migration-fixture-key':self.respond(401,{});return False
                    return True
                def do_POST(self):
                    if not self.auth():return
                    n=int(self.headers.get('Content-Length','0'))
                    if not 0<n<=1048576:self.respond(413,{});return
                    data=self.rfile.read(n)
                    if self.path.startswith('/rest/v1/rpc/'):
                        name=self.path.removeprefix('/rest/v1/rpc/')
                        if name not in ['wjb_v2_migration_command','wjb_v2_asset_command']:self.respond(404,{});return
                        req=json.loads(data)
                        answer=sql(f"BEGIN;SET LOCAL ROLE service_role;SELECT public.{name}({g['literal'](req['p_request'])});COMMIT;",check=False)
                        if answer.returncode:
                            code=re.search(r'ERROR:\s+([A-Z_]+)',answer.stderr);self.respond(400,{'code':'P0001','message':code.group(1) if code else 'UNAVAILABLE'})
                        else:self.respond(200,json.loads(answer.stdout.strip()))
                    elif self.path.startswith('/storage/v1/object/wjb-v2-poc-private/'):
                        if self.headers.get('x-upsert')!='false' or len(data)>65536:self.respond(400,{});return
                        key=self.path.removeprefix('/storage/v1/object/wjb-v2-poc-private/')
                        if key in objects:self.respond(409,{'error':'Duplicate'});return
                        objects[key]=data;self.respond(200,{})
                    else:self.respond(404,{})
                def do_GET(self):
                    if not self.auth():return
                    key=self.path.removeprefix('/storage/v1/object/authenticated/wjb-v2-poc-private/')
                    if key not in objects:self.respond(400,{'statusCode':'404','error':'not_found','message':'Object not found'});return
                    data=objects[key];self.send_response(200);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
                def do_DELETE(self):
                    if not self.auth():return
                    if self.path!='/storage/v1/object/wjb-v2-poc-private':self.respond(404,{});return
                    n=int(self.headers.get('Content-Length','0'));req=json.loads(self.rfile.read(n))
                    for key in req['prefixes']:objects.pop(key,None)
                    self.respond(200,[])
            sql("UPDATE wjb_migration.job SET state='canceled' WHERE state IN('staging','cancel_fenced');")
            server=HTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                payload={'user':g['A'],'session':g['SA'],'device':g['DA'],'scenario':scenario}
                child=subprocess.run(['node',str(REPO/'poc/v2-migration/workspace-storage-pg-client.mjs'),'--local-fixture-only',f'http://127.0.0.1:{server.server_port}'],input=json.dumps(payload),capture_output=True,text=True,env=ENV,timeout=35)
                assert child.returncode==0,(child.stdout,child.stderr)
                result=json.loads(child.stdout);assert result['pass']
                ws=result['workspaceId'];job=result['jobId']
                row=json.loads(scalar(f"SELECT jsonb_build_object('used',used_bytes) FROM wjb_gateway.workspace WHERE id='{ws}';"))
                if scenario in ['cancel','lost-delete','unknown-absence','late-put','corrupt-get']:
                    assert not objects and row['used']==0
                    assert scalar(f"SELECT count(*) FROM wjb_gateway.asset WHERE workspace_id='{ws}' AND state<>'canceled';")=='0'
                elif scenario=='lost-put':
                    assert objects and row['used']>0
                    assert scalar(f"SELECT count(*) FROM wjb_gateway.io_intent WHERE workspace_id='{ws}' AND NOT settled;")=='1'
                    assert scalar(f"SELECT state FROM wjb_migration.job WHERE id='{job}';")=='cancel_fenced'
                else:
                    assert len(objects)==1 and row['used']>0
                    assert scalar(f"SELECT state FROM wjb_migration.job WHERE id='{job}';")=='connected'
                assert scalar(f"SELECT count(*) FROM wjb_migration.workspace_record WHERE job_id='{job}' AND table_name IN('note_asset','cabi_asset') AND (value ? 'data' OR value ? 'thumb');")=='0'
            finally:server.shutdown();server.server_close();thread.join(timeout=5)
        test('actual PG and Storage HTTP protocol: '+scenario,case)
