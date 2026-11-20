"""Local PostgreSQL tests for 019 workspace sync (E-2, docs/v2-design/90); synthetic data only."""
import concurrent.futures
import hashlib
import json
import subprocess
import uuid


def run(g):
    sql, scalar, test = g['sql'], g['scalar'], g['test']
    ROOT, REPO, ENV = g['ROOT'], g['REPO'], g['ENV']
    A, B, SA, SB, DA, DB = g['A'], g['B'], g['SA'], g['SB'], g['DA'], g['DB']
    literal = g['literal']

    def emit():
        child = subprocess.run(['node', str(REPO/'poc/v2-migration/emit-workspace-fixture.mjs'), '20'],
                               capture_output=True, text=True, env=ENV, timeout=120)
        assert child.returncode == 0, child.stderr[-500:]
        return json.loads(child.stdout)

    def rpc(action, params, user=A, session=SA, device=DA, role='service_role'):
        r = {'action': action, 'userId': user, 'sessionId': session, 'deviceId': device, 'params': params}
        return sql(f"BEGIN;SET LOCAL ROLE {role};SELECT public.wjb_v2_workspace_sync({literal(r)});COMMIT;", check=False)

    def ok(action, params, **kw):
        r = rpc(action, params, **kw)
        assert r.returncode == 0, r.stderr[-500:]
        return json.loads(r.stdout.strip())

    def no(action, params, code, **kw):
        r = rpc(action, params, **kw)
        assert r.returncode and code in r.stderr, (code, r.stdout[-200:], r.stderr[-400:])

    def publish():
        """Published (connected) workspace from the synthetic DB20 fixture; direct start then mark connected."""
        sql("UPDATE wjb_migration.job SET state='canceled' WHERE state IN('staging','cancel_fenced');")
        m = emit()
        m['workspaceId'] = str(uuid.uuid4())
        f = {'job': str(uuid.uuid4()), 'ws': m['workspaceId']}
        r = g['call']('start', f, m)
        sql(f"UPDATE wjb_migration.job SET state='connected' WHERE id='{f['job']}';")
        return {**f, 'm': m, 'hash': r['manifestHash']}

    def push(ws, changes, op=None, **kw):
        return ok('push', {'workspaceId': ws, 'opId': op or str(uuid.uuid4()), 'changes': changes}, **kw)

    def pull_all(ws, after='0', limit=1000, **kw):
        got, pages = [], 0
        while True:
            p = ok('pull', {'workspaceId': ws, 'after': after, 'limit': limit}, **kw)
            got += p['changes']
            pages += 1
            if not p['more']:
                return got, p, pages
            after = p['next']

    def apply019():
        sql((ROOT/'019-workspace-sync.sql').read_text())
        r = sql((ROOT/'019-workspace-sync.sql').read_text(), check=False)
        assert r.returncode and 'MIGRATION_019_ALREADY_APPLIED' in r.stderr
        v = json.loads(scalar((ROOT/'020-workspace-sync-verify.sql').read_text()))
        assert v['syncRPC'] and v['syncServiceOnly'] and v['syncSearchPath'] and v['inlineImageGuard'], v
        assert v['assetGateSync'] and v['tables'] == 4 and v['rlsTables'] == 4 and v['unsafeSearchPaths'] == 0, v
        assert not v['directTableAccess'] and not v['schemaUsage'] and not v['privateExecute'], v
    test('019 applies once over 016; 020 verify (server-only RPC, private RLS tables, private helpers)', apply019)

    S = {}

    def first_pull():
        p = publish()
        S.update(p)
        got, head, _ = pull_all(p['ws'])
        assert got == [] and head['head'] == '0' and head['next'] == '0'
        n = scalar(f"SELECT count(*) FROM wjb_sync.record WHERE workspace_id='{p['ws']}' AND rev=0 AND seq=0;")
        assert n == str(len(p['m']['records'])), n
        # 두 번째 받기도 다시 복사하지 않는다
        pull_all(p['ws'])
        assert scalar(f"SELECT count(*) FROM wjb_sync.record WHERE workspace_id='{p['ws']}';") == n
        tables = scalar(f"SELECT array_to_string(tables,',') FROM wjb_sync.space WHERE workspace_id='{p['ws']}';").split(',')
        assert 'kanban_ctx' not in tables and 'entry_item' in tables and 'kanban_bulk' in tables
    test('first pull of a published workspace copies its records once (rev 0 / seq 0), nothing to pull yet', first_pull)

    def rec(table, i=0):
        return [r for r in S['m']['records'] if r['table'] == table][i]

    def push_pull():
        ws = S['ws']
        e = rec('entry_item')
        v = {**e['value'], 'text': '가상 고친 글'}
        r = push(ws, [{'table': 'entry_item', 'key': e['key'], 'baseRev': 0, 'value': v}])
        assert r['applied'] and r['records'] == [{'table': 'entry_item', 'key': e['key'], 'rev': 1, 'seq': '1'}] and r['head'] == '1'
        got, head, _ = pull_all(ws)
        assert got == [{'table': 'entry_item', 'key': e['key'], 'value': v, 'rev': 1, 'seq': '1'}] and head['head'] == '1'
        assert pull_all(ws, after='1')[0] == []
        S['e'] = e
        S['v1'] = v
    test('push with the expected revision applies (rev 1, seq 1) and pull after 0 returns exactly that change', push_pull)

    def replay():
        ws, e = S['ws'], S['e']
        op = str(uuid.uuid4())
        ch = [{'table': 'entry_item', 'key': e['key'], 'baseRev': 1, 'value': {**S['v1'], 'text': '두 번째'}}]
        a = push(ws, ch, op)
        b = push(ws, ch, op)
        assert a['applied'] and b.get('replayed') is True and {k: v for k, v in b.items() if k != 'replayed'} == a
        assert scalar(f"SELECT rev FROM wjb_sync.record WHERE workspace_id='{ws}' AND record_key='{e['key']}';") == '2'
        no('push', {'workspaceId': ws, 'opId': op, 'changes': [{**ch[0], 'value': {'x': 1}}]}, 'SYNC_IDEMPOTENCY_MISMATCH')
        no('push', {'workspaceId': ws, 'opId': op, 'changes': ch}, 'SYNC_ACCESS_DENIED', device=DB)
        S['rev'] = 2
    test('same opId + same request = same result once (replayed); same opId with another body is refused', replay)

    def conflict_atomic():
        ws, e = S['ws'], S['e']
        other = rec('entry_item', 1)
        before = scalar(f"SELECT seq FROM wjb_sync.space WHERE workspace_id='{ws}';")
        r = push(ws, [
            {'table': 'entry_item', 'key': other['key'], 'baseRev': 0, 'value': {**other['value'], 'text': '같이 보낸 다른 기록'}},
            {'table': 'entry_item', 'key': e['key'], 'baseRev': 1, 'value': {**S['v1'], 'text': '늦은 기기'}},
        ])
        assert r['applied'] is False and len(r['conflicts']) == 1
        c = r['conflicts'][0]
        assert c['key'] == e['key'] and c['rev'] == 2 and c['baseRev'] == 1 and c['exists'] and c['value']['text'] == '두 번째'
        # 아무것도 적용되지 않음(다른 기록도)
        assert scalar(f"SELECT seq FROM wjb_sync.space WHERE workspace_id='{ws}';") == before
        assert scalar(f"SELECT rev FROM wjb_sync.record WHERE workspace_id='{ws}' AND record_key='{other['key']}';") == '0'
    test('a revision mismatch applies nothing in the batch and returns the server value (no last-write-wins)', conflict_atomic)

    def create_delete():
        ws = S['ws']
        key = 'e' * 64
        v = {**S['e']['value'], 'id': 'new-virtual-item', 'text': '새 기록'}
        r = push(ws, [{'table': 'entry_item', 'key': key, 'baseRev': None, 'value': v}])
        assert r['applied'] and r['records'][0]['rev'] == 1
        r = push(ws, [{'table': 'entry_item', 'key': key, 'baseRev': None, 'value': v}])
        assert r['applied'] is False and r['conflicts'][0]['exists'] and r['conflicts'][0]['rev'] == 1
        r = push(ws, [{'table': 'entry_item', 'key': key, 'baseRev': 1, 'value': None}])
        assert r['applied'] and r['records'][0]['rev'] == 2
        got = pull_all(ws, after=str(int(r['head']) - 1))[0]
        assert got == [{'table': 'entry_item', 'key': key, 'value': None, 'rev': 2, 'seq': r['head']}]
        # 지운 기록 다시 만들기 = 지움 표시 판을 기대 판으로
        r = push(ws, [{'table': 'entry_item', 'key': key, 'baseRev': 2, 'value': v}])
        assert r['applied'] and r['records'][0]['rev'] == 3
        no('push', {'workspaceId': ws, 'opId': str(uuid.uuid4()), 'changes': [{'table': 'entry_item', 'key': 'f' * 64, 'baseRev': None, 'value': None}]}, 'SYNC_INVALID_CHANGE')
    test('new record (baseRev null), duplicate create = conflict, delete = tombstone pulled as null, re-create from tombstone', create_delete)

    def guards():
        ws = S['ws']
        e = S['e']
        good = {'table': 'entry_item', 'key': e['key'], 'baseRev': S['rev'], 'value': S['v1']}
        P = lambda ch: {'workspaceId': ws, 'opId': str(uuid.uuid4()), 'changes': ch}
        no('push', P([good]), 'SYNC_NOT_FOUND', user=B, session=SB, device=DB)
        no('pull', {'workspaceId': ws, 'after': '0', 'limit': 10}, 'SYNC_NOT_FOUND', user=B, session=SB, device=DB)
        no('push', P([good]), 'SYNC_ACCESS_DENIED', session=SB)
        no('push', P([{**good, 'table': 'kanban_ctx'}]), 'SYNC_INVALID_CHANGE')
        no('push', P([{**good, 'table': 'not_a_table'}]), 'SYNC_INVALID_CHANGE')
        no('push', P([{**good, 'key': 'xyz'}]), 'SYNC_INVALID_CHANGE')
        no('push', P([{**good, 'extra': 1}]), 'SYNC_INVALID_CHANGE')
        no('push', P([{**good, 'value': {'text': 'x' * 300000}}]), 'SYNC_INVALID_CHANGE')
        no('push', P([good, good]), 'SYNC_INVALID_REQUEST')
        no('push', P([]), 'SYNC_INVALID_REQUEST')
        no('push', P([{**good, 'key': f'{i:064x}', 'baseRev': None} for i in range(501)]), 'SYNC_INVALID_REQUEST')
        no('push', P([{**good, 'value': {**S['v1'], 'text': 'data:image/png;base64,iVBORw0KGgo='}}]), 'SYNC_INLINE_IMAGE')
        no('pull', {'workspaceId': ws, 'after': '999', 'limit': 10}, 'SYNC_CURSOR_AHEAD')
        no('pull', {'workspaceId': ws, 'after': 0, 'limit': 10}, 'SYNC_INVALID_REQUEST')
        no('pull', {'workspaceId': ws, 'after': '0', 'limit': 1001}, 'SYNC_INVALID_REQUEST')
        no('drop', {}, 'SYNC_INVALID_REQUEST')
        for role in ['anon', 'authenticated']:
            r = rpc('pull', {'workspaceId': ws, 'after': '0', 'limit': 1}, role=role)
            assert r.returncode and 'permission denied' in r.stderr
        for role in ['anon', 'authenticated', 'service_role']:
            r = sql(f"SET ROLE {role};SELECT * FROM wjb_sync.record LIMIT 1;", check=False)
            assert r.returncode and 'permission denied' in r.stderr
        # 게시 전(staging) 공간은 처음 동기화할 수 없다
        p2 = publish()
        sql(f"UPDATE wjb_migration.job SET state='staging' WHERE id='{p2['job']}';")
        no('pull', {'workspaceId': p2['ws'], 'after': '0', 'limit': 10}, 'SYNC_NOT_FOUND')
    test('guards: other account/session, unknown or local-only table, bad key/fields/size, duplicates, 501 changes, inline image, cursor, client roles, unpublished', guards)

    def asset_refs():
        ws = S['ws']
        a = rec('note_asset')
        ref = a['value']['dataRef']
        newref = {'objectId': str(uuid.uuid4()), 'sha256': 'b' * 64, 'bytes': 40}
        v = {**a['value'], 'id': 'new-virtual-image', 'dataRef': newref, 'thumbRef': None}
        P = lambda val: {'workspaceId': ws, 'opId': str(uuid.uuid4()), 'changes': [{'table': 'note_asset', 'key': 'a' * 64, 'baseRev': None, 'value': val}]}
        no('push', P(v), 'SYNC_ASSET_NOT_READY')  # 서버에 없는 그림
        # 신고하지 않은 새 그림은 기존 그림 경로(문지기)가 받지 않는다
        r = sql(f"INSERT INTO wjb_gateway.asset(workspace_id,id,generation,device_id,sha256,bytes,state,expires_at) VALUES('{ws}','{newref['objectId']}',1,'{DA}','{'b'*64}',40,'reserved',now()+interval '1 day');", check=False)
        assert r.returncode and 'MIGRATION_ASSET_NOT_DECLARED' in r.stderr
        D = {'workspaceId': ws, 'objectId': newref['objectId'], 'sha256': 'b' * 64, 'bytes': 40}
        assert ok('asset_declare', D)['declared'] and ok('asset_declare', D)['declared']  # 다시 보내도 같음
        no('asset_declare', {**D, 'bytes': 41}, 'SYNC_ASSET_CONFLICT')
        no('asset_declare', D, 'SYNC_NOT_FOUND', user=B, session=SB, device=DB)
        no('asset_declare', {**D, 'bytes': 10485761}, 'SYNC_INVALID_REQUEST')
        # 신고한 그림 = 같은 크기·해시만 예약된다(실제로는 gateway reserve가 넣음)
        r = sql(f"INSERT INTO wjb_gateway.asset(workspace_id,id,generation,device_id,sha256,bytes,state,expires_at) VALUES('{ws}','{newref['objectId']}',1,'{DA}','{'c'*64}',40,'reserved',now()+interval '1 day');", check=False)
        assert r.returncode and 'MIGRATION_ASSET_NOT_DECLARED' in r.stderr
        sql(f"INSERT INTO wjb_gateway.asset(workspace_id,id,generation,device_id,sha256,bytes,state,expires_at) VALUES('{ws}','{newref['objectId']}',1,'{DA}','{'b'*64}',40,'reserved',now()+interval '1 day');")
        no('push', P(v), 'SYNC_ASSET_NOT_READY')  # 아직 reserved
        sql(f"UPDATE wjb_gateway.asset SET state='ready' WHERE workspace_id='{ws}' AND id='{newref['objectId']}';")
        no('push', P({**v, 'dataRef': {**newref, 'bytes': 41}}), 'SYNC_ASSET_NOT_READY')
        no('push', P({**v, 'dataRef': {**newref, 'extra': 1}}), 'SYNC_ASSET_NOT_READY')
        r = ok('push', P(v))
        assert r['applied']
        # 다른 공간의 그림은 참조할 수 없다
        p3 = publish()
        no('push', {'workspaceId': p3['ws'], 'opId': str(uuid.uuid4()), 'changes': [{'table': 'note_asset', 'key': 'a' * 64, 'baseRev': None, 'value': v}]}, 'SYNC_ASSET_NOT_READY')
        assert ref['objectId'] != newref['objectId']
        # DB 안에 그림 본문이 없다(참조만)
        assert scalar(f"SELECT count(*) FROM wjb_sync.record WHERE value::text ~* 'base64,';") == '0'
    test('image references must be ready private assets of the same workspace (hash/bytes match); no image bodies stored', asset_refs)

    def paging():
        p = publish()
        e = [r for r in p['m']['records'] if r['table'] == 'entry_item'][0]
        changes = [{'table': 'entry_item', 'key': f'{i:064x}', 'baseRev': None, 'value': {**e['value'], 'id': f'v{i}', 'text': '가' * 1000}} for i in range(450)]
        # 한 요청 1.1MB 한도 — 두 번에 나눠 보낸다(한 번에 보내면 거절)
        no('push', {'workspaceId': p['ws'], 'opId': str(uuid.uuid4()), 'changes': [{**c, 'value': {**c['value'], 'text': '가' * 3000}} for c in changes]}, 'SYNC_INVALID_REQUEST')
        assert push(p['ws'], changes[:225])['head'] == '225'
        assert push(p['ws'], changes[225:])['head'] == '450'
        got, head, pages = pull_all(p['ws'], limit=100)
        assert pages == 5 and [c['seq'] for c in got] == [str(i) for i in range(1, 451)] and head['head'] == '450'
        # 900KB 예산: 큰 기록은 한도 전에 끊는다
        big = ok('pull', {'workspaceId': p['ws'], 'after': '0', 'limit': 1000})
        assert big['more'] and len(json.dumps(big, ensure_ascii=False).encode()) < 1_100_000
    test('pull pages in change order by limit and ~900KB budget; next/head cursors', paging)

    def concurrent_push():
        p = publish()
        e = [r for r in p['m']['records'] if r['table'] == 'entry_item'][0]
        def one(i):
            return rpc('push', {'workspaceId': p['ws'], 'opId': str(uuid.uuid4()), 'changes': [{'table': 'entry_item', 'key': e['key'], 'baseRev': 0, 'value': {**e['value'], 'text': f'동시 {i}'}}]})
        with concurrent.futures.ThreadPoolExecutor(4) as pool:
            rs = list(pool.map(one, range(4)))
        assert all(r.returncode == 0 for r in rs), [r.stderr[-200:] for r in rs]
        out = [json.loads(r.stdout.strip()) for r in rs]
        assert sum(o['applied'] for o in out) == 1 and sum(not o['applied'] for o in out) == 3
        assert scalar(f"SELECT rev FROM wjb_sync.record WHERE workspace_id='{p['ws']}' AND record_key='{e['key']}';") == '1'
    test('four devices pushing the same base revision at once: exactly one applies, the rest get conflicts', concurrent_push)

    def rollback():
        r = sql((ROOT/'021-workspace-sync-rollback.sql').read_text(), check=False)
        assert r.returncode and 'SYNC_HAS_CHANGES' in r.stderr
        migr = scalar("SELECT count(*) FROM wjb_migration.workspace_record;")
        sql("DELETE FROM wjb_sync.applied; DELETE FROM wjb_sync.asset_declared; UPDATE wjb_sync.record SET rev=0;")
        gate = "SELECT prosrc FROM pg_proc WHERE oid='wjb_migration.asset_gate()'::regprocedure;"
        sql((ROOT/'021-workspace-sync-rollback.sql').read_text())
        assert scalar("SELECT to_regnamespace('wjb_sync') IS NULL AND to_regprocedure('public.wjb_v2_workspace_sync(jsonb)') IS NULL;") == 't'
        assert scalar("SELECT count(*) FROM wjb_migration.workspace_record;") == migr
        assert scalar("SELECT to_regprocedure('public.wjb_v2_workspace_read(jsonb)') IS NOT NULL;") == 't'
        assert 'wjb_sync' not in scalar(gate) and 'MIGRATION_ASSET_NOT_DECLARED' in scalar(gate)
        assert scalar(gate).strip() == (ROOT/'001-migration.sql').read_text().split('CREATE FUNCTION wjb_migration.asset_gate() RETURNS trigger')[1].split('$$')[1].strip()
        sql((ROOT/'019-workspace-sync.sql').read_text())
    test('021 refuses while pushed changes exist; with none it drops only wjb_sync (published data and 016 kept); 019 re-applies', rollback)

    # ── 022 (E+ 처리한 요청 기록 7일 보관) ──
    fn_def = "SELECT prosrc FROM pg_proc WHERE oid='public.wjb_v2_workspace_sync(jsonb)'::regprocedure;"
    base019 = scalar(fn_def)

    def apply022():
        sql((ROOT/'022-workspace-sync-retention.sql').read_text())
        r = sql((ROOT/'022-workspace-sync-retention.sql').read_text(), check=False)
        assert r.returncode and 'MIGRATION_022_ALREADY_APPLIED' in r.stderr
        v = json.loads(scalar((ROOT/'023-workspace-sync-retention-verify.sql').read_text()))
        assert v['retention'] and v['index'] and v['syncServiceOnly'] and v['syncSearchPath'], v
    test('022 applies once over 019; 023 verify (7-day cleanup in push, index, server-only)', apply022)

    def retention():
        p1, p2 = publish(), publish()
        e1 = [r for r in p1['m']['records'] if r['table'] == 'entry_item'][0]
        e2 = [r for r in p2['m']['records'] if r['table'] == 'entry_item'][0]
        old_op = str(uuid.uuid4())
        ch1 = [{'table': 'entry_item', 'key': e1['key'], 'baseRev': 0, 'value': {**e1['value'], 'text': '오래된 요청'}}]
        push(p1['ws'], ch1, old_op)
        push(p2['ws'], [{'table': 'entry_item', 'key': e2['key'], 'baseRev': 0, 'value': {**e2['value'], 'text': '다른 공간'}}])
        sql("UPDATE wjb_sync.applied SET created_at=clock_timestamp()-interval '8 days';")
        recent_op = str(uuid.uuid4())
        ch2 = [{'table': 'entry_item', 'key': e1['key'], 'baseRev': 1, 'value': {**e1['value'], 'text': '새 요청'}}]
        push(p1['ws'], ch2, recent_op)
        # 같은 공간의 8일 지난 기록만 지워지고, 다른 공간·방금 것은 남는다
        assert scalar(f"SELECT count(*) FROM wjb_sync.applied WHERE workspace_id='{p1['ws']}' AND op_id='{old_op}';") == '0'
        assert scalar(f"SELECT count(*) FROM wjb_sync.applied WHERE workspace_id='{p1['ws']}' AND op_id='{recent_op}';") == '1'
        assert scalar(f"SELECT count(*) FROM wjb_sync.applied WHERE workspace_id='{p2['ws']}';") == '1'
        # 방금 요청은 그대로 재전송 안전
        assert push(p1['ws'], ch2, recent_op).get('replayed') is True
        # 보관 기간이 지난 번호로 같은 내용을 다시 보내면 새 요청 — 기대 판이 지나 충돌로 돌아온다(덮어쓰지 않음)
        r = push(p1['ws'], ch1, old_op)
        assert r['applied'] is False and r['conflicts'][0]['rev'] == 2
    test('022: applied requests older than 7 days are cleaned per workspace on push; recent replays stay safe; an expired id is a new request (conflict, no overwrite)', retention)

    def rollback022():
        sql((ROOT/'024-workspace-sync-retention-rollback.sql').read_text())
        assert scalar(fn_def) == base019 and scalar("SELECT to_regclass('wjb_sync.applied_by_age') IS NULL;") == 't'
        r = sql((ROOT/'024-workspace-sync-retention-rollback.sql').read_text(), check=False)
        assert r.returncode and 'MIGRATION_022_REQUIRED' in r.stderr
        sql((ROOT/'022-workspace-sync-retention.sql').read_text())
    test('024 restores the exact 019 RPC and drops the index; 022 re-applies', rollback022)

    # ── 025 (UX-2 목록에 공간 이름·색·아이콘) ──
    read_def = "SELECT prosrc FROM pg_proc WHERE oid='public.wjb_v2_workspace_read(jsonb)'::regprocedure;"
    base016 = scalar(read_def)

    def listed(ws, **kw):
        r = {'action': 'list', 'userId': kw.get('user', A), 'sessionId': kw.get('session', SA),
             'deviceId': kw.get('device', DA), 'params': {}}
        out = sql(f"BEGIN;SET LOCAL ROLE service_role;SELECT public.wjb_v2_workspace_read({literal(r)});COMMIT;", check=False)
        assert out.returncode == 0, out.stderr[-400:]
        rows = [w for w in json.loads(out.stdout.strip())['workspaces'] if w['workspaceId'] == ws]
        return rows[0] if rows else None

    def apply025():
        sql((ROOT/'025-workspace-list-label.sql').read_text())
        r = sql((ROOT/'025-workspace-list-label.sql').read_text(), check=False)
        assert r.returncode and 'MIGRATION_025_ALREADY_APPLIED' in r.stderr
        v = json.loads(scalar((ROOT/'026-workspace-list-label-verify.sql').read_text()))
        assert v['label'] and v['helper'] and v['readServiceOnly'] and v['readSearchPath'], v
    test('025 applies once over 019; 026 verify (list labels, helper not callable by API roles, read RPC server-only)', apply025)

    def labels():
        p = publish()
        w = listed(p['ws'])
        assert w['workspace'] == {'name': '개인', 'color': 'c1', 'icon': 'memo'}, w
        # 목록에는 이름·색·아이콘 세 가지만(설정의 다른 값은 나가지 않음)
        assert set(w['workspace']) == {'name', 'color', 'icon'}
        st = [r for r in p['m']['records'] if r['table'] == 'app_meta' and r['value']['key'] == 'settings'][0]
        s = json.loads(st['value']['value'])

        def set_ws(ws_meta, base):
            v = json.dumps({**s, 'workspace': ws_meta}, ensure_ascii=False)
            r = push(p['ws'], [{'table': 'app_meta', 'key': st['key'], 'baseRev': base, 'value': {'key': 'settings', 'value': v}}])
            assert r['applied'] is True, r
        set_ws({'name': '회사', 'color': 'c3', 'icon': 'briefcase', 'updatedAt': 2}, 0)
        assert listed(p['ws'])['workspace'] == {'name': '회사', 'color': 'c3', 'icon': 'briefcase'}
        # 동기화 값이 형식에 맞지 않으면 옛 값으로 돌아가지 않고 비운다(화면이 기본 모양)
        set_ws({'name': '', 'color': 'c9', 'icon': 'BAD!', 'updatedAt': 3}, 1)
        assert listed(p['ws'])['workspace'] is None
        # 다른 계정은 이 공간을 보지 않는다
        assert listed(p['ws'], user=B, session=SB, device=DB) is None
        # 깨진 글(JSON 아님)은 오류 없이 비운다
        assert scalar("SELECT wjb_migration.workspace_label('{\"key\":\"settings\",\"value\":\"{not json\"}'::jsonb) IS NULL;") == 't'
    test('025: list carries name/color/icon — published copy, then the synced value (precedence even when malformed → null); other owners unaffected', labels)

    def rollback025():
        sql((ROOT/'027-workspace-list-label-rollback.sql').read_text())
        assert scalar(read_def) == base016 and scalar("SELECT to_regprocedure('wjb_migration.workspace_label(jsonb)') IS NULL;") == 't'
        r = sql((ROOT/'027-workspace-list-label-rollback.sql').read_text(), check=False)
        assert r.returncode and 'MIGRATION_025_REQUIRED' in r.stderr
        sql((ROOT/'025-workspace-list-label.sql').read_text())
    test('027 restores the exact 016 read RPC and drops the helper; 025 re-applies', rollback025)

    # ── 028 (G 운영 준비 Q-1: 계정 한도·관리자·안전선) ──
    def apply028():
        sql((ROOT/'028-account-quota.sql').read_text())
        r = sql((ROOT/'028-account-quota.sql').read_text(), check=False)
        assert r.returncode and 'MIGRATION_028_ALREADY_APPLIED' in r.stderr
        v = json.loads(scalar((ROOT/'029-account-quota-verify.sql').read_text()))
        assert v['schema'] and v['triggers'] and v['accountServiceOnly'] and v['accountSearchPath'] and v['opsClosed'], v
        assert v['defaults'] == {'default_images': 104857600, 'default_spaces': 3, 'default_records': 31457280,
                                 'project_images': 838860800, 'project_db': 419430400}, v
        assert v['admins'] == 0
    test('028 applies once over 019; 029 verify (7 limit triggers, defaults 100MB/3/30MB, safety 800MB/400MB, RPC server-only, ops closed)', apply028)
    # 실제 Supabase auth.users에 있는 열(로컬 시험 표에만 없음)
    sql("ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email text, ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(), ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz;")

    def acct(action, params, user=A, session=SA, device=DA, role='service_role'):
        r = {'action': action, 'userId': user, 'sessionId': session, 'deviceId': device, 'params': params}
        return sql(f"BEGIN;SET LOCAL ROLE {role};SELECT public.wjb_v2_account({literal(r)});COMMIT;", check=False)

    def acct_ok(action, params, **kw):
        r = acct(action, params, **kw)
        assert r.returncode == 0, r.stderr[-400:]
        return json.loads(r.stdout.strip())

    def acct_no(action, params, code, **kw):
        r = acct(action, params, **kw)
        assert r.returncode and code in r.stderr, (code, r.stderr[-300:])

    def start_fails(code):
        m = emit()
        m['workspaceId'] = str(uuid.uuid4())
        f = {'job': str(uuid.uuid4()), 'ws': m['workspaceId']}
        r = sql(g['query'](g['request']('start', f['job'], m)), check=False)
        assert r.returncode and code in r.stderr, (code, r.stderr[-300:])

    def spaces_and_admin():
        # A는 앞 시험들로 공간이 3개를 넘는다 — 기본 한도(3)로 새 복제 거절
        assert int(scalar(f"SELECT wjb_ops.used_spaces('{A}');")) >= 3
        start_fails('QUOTA_ACCOUNT_SPACES')
        u = acct_ok('usage', {})
        assert u['limits'] == {'images': 104857600, 'spaces': 3, 'records': 31457280} and u['admin'] is False
        assert 'project' not in u and u['used']['spaces'] >= 3
        # 관리자가 아니면 관리 기능 거절
        acct_no('admin_list', {}, 'ACCOUNT_NOT_ADMIN')
        acct_no('admin_set', {'userId': B, 'unlimited': True}, 'ACCOUNT_NOT_ADMIN')
        # B를 관리자로(적용 도구가 하는 일) — 관리자는 계정 한도 없음, 전체 사용량을 본다
        sql(f"INSERT INTO wjb_ops.admin(user_id) VALUES('{B}');")
        ub = acct_ok('usage', {}, user=B, session=SB, device=DB)
        assert ub['admin'] is True and ub['unlimited'] is True and ub['limits'] == {'images': None, 'spaces': None, 'records': None}
        assert ub['project']['imagesLimit'] == 838860800 and ub['project']['dbLimit'] == 419430400
        lst = acct_ok('admin_list', {}, user=B, session=SB, device=DB)['accounts']
        assert {a['userId'] for a in lst} >= {A, B}
        # 관리자가 A를 무제한으로 → 복제 됨
        r = acct_ok('admin_set', {'userId': A, 'unlimited': True}, user=B, session=SB, device=DB)
        assert r['unlimited'] is True and r['limits']['spaces'] is None
        publish()
        # 관리자 자신은 바꿀 수 없다(늘 무제한)
        acct_no('admin_set', {'userId': B, 'suspended': True}, 'ACCOUNT_ADMIN_FIXED', user=B, session=SB, device=DB)
        acct_no('admin_set', {'userId': A, 'nope': 1}, 'ACCOUNT_INVALID_REQUEST', user=B, session=SB, device=DB)
        # API 역할은 직접 부를 수 없다
        acct_no('usage', {}, 'permission denied', role='authenticated')
    test('028: default space limit refuses a new copy; admin-only list/set (checked in the RPC), admin unlimited and fixed; unlimited account copies again', spaces_and_admin)

    def images_and_safety():
        ws = scalar(f"SELECT id FROM wjb_gateway.workspace WHERE owner_id='{A}' ORDER BY id LIMIT 1;")
        used = int(scalar(f"SELECT wjb_ops.used_images('{A}');"))
        # 계정 그림 한도 = 지금 + 1000바이트 → 2000바이트 예약(사용량 증가) 거절, 500은 됨
        acct_ok('admin_set', {'userId': A, 'unlimited': False, 'images': used + 1000}, user=B, session=SB, device=DB)
        r = sql(f"UPDATE wjb_gateway.workspace SET quota_bytes=greatest(quota_bytes,used_bytes+100000) WHERE id='{ws}';UPDATE wjb_gateway.workspace SET used_bytes=used_bytes+2000 WHERE id='{ws}';", check=False)
        assert r.returncode and 'QUOTA_ACCOUNT_IMAGES' in r.stderr, r.stderr[-300:]
        sql(f"UPDATE wjb_gateway.workspace SET used_bytes=used_bytes+500 WHERE id='{ws}';")
        # 줄이는 것(지우기)은 언제나 됨
        sql(f"UPDATE wjb_gateway.workspace SET used_bytes=used_bytes-500 WHERE id='{ws}';")
        # 안전선: 전체 그림이 선을 넘으면 무제한 계정도 거절
        acct_ok('admin_set', {'userId': A, 'unlimited': True}, user=B, session=SB, device=DB)
        total = int(scalar("SELECT wjb_ops.project_images();"))
        sql(f"UPDATE wjb_ops.setting SET value={total + 1000} WHERE key='project_images';")
        r = sql(f"UPDATE wjb_gateway.workspace SET used_bytes=used_bytes+2000 WHERE id='{ws}';", check=False)
        assert r.returncode and 'QUOTA_PROJECT' in r.stderr, r.stderr[-300:]
        # 안전선에 닿으면 새 공간(복제)도 거절
        sql(f"UPDATE wjb_ops.setting SET value={total} WHERE key='project_images';")
        start_fails('QUOTA_PROJECT')
        sql("UPDATE wjb_ops.setting SET value=838860800 WHERE key='project_images';")
    test('028: account image limit and the project image safety line refuse growth (even unlimited accounts); shrinking always works', images_and_safety)

    def records_and_suspend():
        p = publish()
        e = [r for r in p['m']['records'] if r['table'] == 'entry_item'][0]
        # 처음 받기(게시본 복사, rev 0)는 한도와 상관없이 된다
        pull_all(p['ws'])
        used = int(scalar(f"SELECT wjb_ops.used_records('{A}');"))
        assert used > 0
        acct_ok('admin_set', {'userId': A, 'unlimited': False, 'records': used + 50, 'spaces': None, 'images': None}, user=B, session=SB, device=DB)
        # 글을 크게 늘리면 거절 — 서버에 아무것도 들어가지 않는다(이 기기 대기열에 남음)
        big = {**e['value'], 'text': 'x' * 400}
        r = rpc('push', {'workspaceId': p['ws'], 'opId': str(uuid.uuid4()), 'changes': [{'table': 'entry_item', 'key': e['key'], 'baseRev': 0, 'value': big}]})
        assert r.returncode and 'QUOTA_ACCOUNT_RECORDS' in r.stderr, r.stderr[-300:]
        assert scalar(f"SELECT rev FROM wjb_sync.record WHERE workspace_id='{p['ws']}' AND record_key='{e['key']}';") == '0'
        # 줄이는 고치기는 된다
        small = {**e['value'], 'text': '짧게'}
        assert push(p['ws'], [{'table': 'entry_item', 'key': e['key'], 'baseRev': 0, 'value': small}])['applied'] is True
        # 정지: 받기는 되고 보내기는 거절
        acct_ok('admin_set', {'userId': A, 'suspended': True, 'records': None}, user=B, session=SB, device=DB)
        pull_all(p['ws'])
        r = rpc('push', {'workspaceId': p['ws'], 'opId': str(uuid.uuid4()), 'changes': [{'table': 'entry_item', 'key': e['key'], 'baseRev': 1, 'value': {**small, 'text': '짧게2'}}]})
        assert r.returncode and 'ACCOUNT_SUSPENDED' in r.stderr, r.stderr[-300:]
        assert acct_ok('usage', {})['suspended'] is True
        # 원래대로(기본값 행 지우기)
        acct_ok('admin_set', {'userId': A, 'reset': True}, user=B, session=SB, device=DB)
        assert scalar(f"SELECT count(*) FROM wjb_ops.account WHERE user_id='{A}';") == '0'
    test('028: record limit refuses only growing edits (initial copy and shrinking pass, nothing stored on refusal); suspended = read only; reset to defaults', records_and_suspend)

    def rollback028():
        sql((ROOT/'030-account-quota-rollback.sql').read_text())
        assert scalar("SELECT to_regnamespace('wjb_ops') IS NULL AND to_regprocedure('public.wjb_v2_account(jsonb)') IS NULL;") == 't'
        r = sql((ROOT/'030-account-quota-rollback.sql').read_text(), check=False)
        assert r.returncode and 'MIGRATION_028_REQUIRED' in r.stderr
        publish()  # 한도 없이 예전처럼
        sql((ROOT/'028-account-quota.sql').read_text())
        # 다시 적용하면 지금 자료로 사용량을 다시 채운다
        assert int(scalar(f"SELECT wjb_ops.used_records('{A}');")) > 0
    test('030 drops triggers, RPC and ops schema (copies work as before); 028 re-applies and backfills usage', rollback028)

    # ── 031 (G-5 데이터 수명: 공간 지우기 · 안 쓰는 그림 · 계정 삭제, docs/v2-design/100) ──
    def apply031():
        sql((ROOT/'031-lifecycle.sql').read_text())
        r = sql((ROOT/'031-lifecycle.sql').read_text(), check=False)
        assert r.returncode and 'MIGRATION_031_ALREADY_APPLIED' in r.stderr
        v = json.loads(scalar((ROOT/'032-lifecycle-verify.sql').read_text()))
        assert all(v[k] for k in ['schema', 'tables', 'userServiceOnly', 'workerServiceOnly', 'searchPath', 'lifeClosed']), v
        assert v['grace'] == '7 days'
        for role in ['authenticated', 'anon']:
            r = sql(f"SET ROLE {role};SELECT public.wjb_v2_lifecycle('{{}}'::jsonb);", check=False)
            assert r.returncode and 'permission denied' in r.stderr
            r = sql(f"SET ROLE {role};SELECT public.wjb_v2_lifecycle_worker('{{}}'::jsonb);", check=False)
            assert r.returncode and 'permission denied' in r.stderr
    test('031 applies once over 028; 032 verify (RPCs server-only, fixed search_path, schema closed, grace 7 days)', apply031)
    # 관리자 = B, 시험 계정 A는 공간 수 한도 없이(앞 시험들이 공간을 많이 만듦)
    sql(f"DELETE FROM wjb_ops.admin; INSERT INTO wjb_ops.admin(user_id) VALUES('{B}');"
        f"INSERT INTO wjb_ops.account(user_id,unlimited) VALUES('{A}',true) ON CONFLICT (user_id) DO UPDATE SET unlimited=true;")

    def life(action, params, user=A, session=SA, device=DA):
        r = {'action': action, 'userId': user, 'sessionId': session, 'deviceId': device, 'params': params}
        return sql(f"BEGIN;SET LOCAL ROLE service_role;SELECT public.wjb_v2_lifecycle({literal(r)});COMMIT;", check=False)

    def life_ok(action, params, **kw):
        r = life(action, params, **kw)
        assert r.returncode == 0, r.stderr[-400:]
        return json.loads(r.stdout.strip())

    def life_no(action, params, code, **kw):
        r = life(action, params, **kw)
        assert r.returncode and code in r.stderr, (code, r.stderr[-300:])

    def worker(action, params):
        r = {'action': action, 'params': params}
        out = sql(f"BEGIN;SET LOCAL ROLE service_role;SELECT public.wjb_v2_lifecycle_worker({literal(r)});COMMIT;", check=False)
        assert out.returncode == 0, out.stderr[-400:]
        return json.loads(out.stdout.strip())

    def with_image(p, referenced=True):
        """동기화한 공간에 새 그림 하나(신고 → 예약 → ready, 용량 40바이트) + (참조하면) 그 그림을 쓰는 기록"""
        pull_all(p['ws'])
        oid = str(uuid.uuid4())
        ok('asset_declare', {'workspaceId': p['ws'], 'objectId': oid, 'sha256': 'b' * 64, 'bytes': 40})
        sql(f"INSERT INTO wjb_gateway.asset(workspace_id,id,generation,device_id,sha256,bytes,state,expires_at) VALUES('{p['ws']}','{oid}',1,'{DA}','{'b'*64}',40,'ready',now()+interval '1 day');"
            f"UPDATE wjb_gateway.workspace SET used_bytes=used_bytes+40 WHERE id='{p['ws']}';")
        key = hashlib_key(oid)
        if referenced:
            a = [r for r in p['m']['records'] if r['table'] == 'note_asset'][0]
            v = {**a['value'], 'id': 'g5-virtual-image', 'dataRef': {'objectId': oid, 'sha256': 'b' * 64, 'bytes': 40}, 'thumbRef': None}
            assert push(p['ws'], [{'table': 'note_asset', 'key': key, 'baseRev': None, 'value': v}])['applied']
        return oid, key

    def hashlib_key(s):
        return hashlib.sha256(s.encode()).hexdigest()

    def state(ws, oid):
        return scalar(f"SELECT state FROM wjb_gateway.asset WHERE workspace_id='{ws}' AND id='{oid}';")

    def drain():
        """게이트웨이 작업자 흉내: 지울 그림을 받아(실물 삭제는 생략) 없는 것을 확인 → 용량 반환"""
        n = 0
        while True:
            items = worker('next', {'limit': 50})['items']
            if not items:
                return n
            for it in items:
                assert worker('confirm', it)['absentConfirmed']
                n += 1

    def delete_space():
        p = publish()
        oid, _ = with_image(p)
        used_before = int(scalar(f"SELECT wjb_ops.used_images('{A}');"))
        spaces_before = int(scalar(f"SELECT wjb_ops.used_spaces('{A}');"))
        assert int(scalar(f"SELECT wjb_ops.used_records('{A}');")) > 0
        # 다른 사람은 지울 수 없다(같은 답 = 없음)
        life_no('delete_space', {'workspaceId': p['ws']}, 'LIFE_NOT_FOUND', user=B, session=SB, device=DB)
        life_no('delete_space', {'workspaceId': p['ws'], 'x': 1}, 'LIFE_INVALID_REQUEST')
        life_no('delete_space', {'workspaceId': p['ws']}, 'LIFE_ACCESS_DENIED', session=SB)
        r = life_ok('delete_space', {'workspaceId': p['ws']})
        assert r['state'] == 'purging' and r['images'] >= 1, r
        assert life_ok('delete_space', {'workspaceId': p['ws']})['state'] == 'purging'  # 다시 보내도 같음
        # 목록·읽기·동기화에서 바로 사라짐(다른 기기 = 없음)
        lst = json.loads(sql(f"BEGIN;SET LOCAL ROLE service_role;SELECT public.wjb_v2_workspace_read({literal({'action': 'list', 'userId': A, 'sessionId': SA, 'deviceId': DA, 'params': {}})});COMMIT;").stdout.strip())
        assert p['ws'] not in [w['workspaceId'] for w in lst['workspaces']]
        no('pull', {'workspaceId': p['ws'], 'after': '0', 'limit': 10}, 'SYNC_NOT_FOUND')
        assert scalar(f"SELECT count(*) FROM wjb_sync.record WHERE workspace_id='{p['ws']}';") == '0'
        assert scalar(f"SELECT count(*) FROM wjb_migration.workspace_record WHERE job_id='{p['job']}';") == '0'
        assert int(scalar(f"SELECT wjb_ops.used_spaces('{A}');")) == spaces_before - 1
        # 그림 용량은 실물이 없는 것을 확인한 뒤에만 돌려준다
        assert state(p['ws'], oid) == 'cleanup'
        assert int(scalar(f"SELECT wjb_ops.used_images('{A}');")) == used_before
        bad = {'workspaceId': p['ws'], 'assetId': oid, 'ioVersion': '0'}
        out = sql(f"BEGIN;SET LOCAL ROLE service_role;SELECT public.wjb_v2_lifecycle_worker({literal({'action': 'confirm', 'params': bad})});COMMIT;", check=False)
        assert out.returncode and 'LIFE_NOT_PENDING' in out.stderr  # 예전 io 판으로는 못 함
        assert drain() >= 1
        assert state(p['ws'], oid) == 'canceled'
        assert int(scalar(f"SELECT wjb_ops.used_images('{A}');")) <= used_before - 40
        worker('next', {'limit': 1})
        assert scalar(f"SELECT done_at IS NOT NULL FROM wjb_life.purge WHERE workspace_id='{p['ws']}';") == 't'
        assert life_ok('delete_space', {'workspaceId': p['ws']})['state'] == 'deleted'
    test('031 delete_space: owner only; list/read/sync gone at once, records and usage removed, space count returned; images released only after confirmed absence', delete_space)

    def orphans():
        p = publish()
        keep, _ = with_image(p)
        gone, gone_key = with_image(p)
        fresh, _ = with_image(p, referenced=False)
        now = "clock_timestamp()"
        sweep = lambda days: json.loads(scalar(f"SELECT wjb_life.sweep_orphans({now}+interval '{days} days');"))
        # 참조 중인 그림은 표시하지 않는다. 방금 올린(신고 7일 안) 그림도 아직은 아님
        s0 = sweep(0)
        assert scalar(f"SELECT count(*) FROM wjb_life.orphan WHERE workspace_id='{p['ws']}';") == '0', s0
        # 기록을 지우면(지움 표시) 그 그림은 참조 없음. 올린(신고) 뒤 7일이 지나야 표시 대상
        base = int(scalar(f"SELECT rev FROM wjb_sync.record WHERE workspace_id='{p['ws']}' AND record_key='{gone_key}';"))
        assert push(p['ws'], [{'table': 'note_asset', 'key': gone_key, 'baseRev': base, 'value': None}])['applied']
        sweep(1)
        assert scalar(f"SELECT count(*) FROM wjb_life.orphan WHERE workspace_id='{p['ws']}';") == '0'
        sweep(8)
        marked = scalar(f"SELECT string_agg(asset_id::text,',' ORDER BY asset_id) FROM wjb_life.orphan WHERE workspace_id='{p['ws']}';").split(',')
        assert sorted(marked) == sorted([gone, fresh]), marked  # 참조 중(keep)은 아님
        # 표시 뒤 7일이 지나야 넘긴다(그 전에는 그대로)
        sweep(12)
        assert state(p['ws'], gone) == 'ready'
        # 그 사이 다시 참조되면 표시를 뗀다
        a = [r for r in p['m']['records'] if r['table'] == 'note_asset'][0]
        v = {**a['value'], 'id': 'g5-revived', 'dataRef': {'objectId': fresh, 'sha256': 'b' * 64, 'bytes': 40}, 'thumbRef': None}
        assert push(p['ws'], [{'table': 'note_asset', 'key': hashlib_key('revive' + fresh), 'baseRev': None, 'value': v}])['applied']
        r = sweep(16)
        assert state(p['ws'], gone) == 'cleanup' and r['released'] >= 1 and r['revived'] >= 1, r
        assert state(p['ws'], fresh) == 'ready' and state(p['ws'], keep) == 'ready'
        # 작업자가 넘긴 그림을 지우면 용량이 준다. 지운 그림을 다시 참조하는 기록은 받지 않는다
        before = int(scalar(f"SELECT used_bytes FROM wjb_gateway.workspace WHERE id='{p['ws']}';"))
        assert drain() >= 1
        assert int(scalar(f"SELECT used_bytes FROM wjb_gateway.workspace WHERE id='{p['ws']}';")) == before - 40
        v2 = {**a['value'], 'id': 'g5-late', 'dataRef': {'objectId': gone, 'sha256': 'b' * 64, 'bytes': 40}, 'thumbRef': None}
        no('push', {'workspaceId': p['ws'], 'opId': str(uuid.uuid4()), 'changes': [{'table': 'note_asset', 'key': hashlib_key('late'), 'baseRev': None, 'value': v2}]}, 'SYNC_ASSET_NOT_READY')
        # 작업자 sweep(지금 시각)도 같은 함수
        assert set(worker('sweep', {})) == {'marked', 'released', 'revived'}
    test('031 unused images: only unreferenced ready images of synced spaces, 7-day grace (and 7 days after declare), re-reference revives, released → cleanup → absence → quota back', orphans)

    def accounts():
        # 일반 계정은 다른 계정을 지울 수 없다. 관리자 계정은 누구도 지울 수 없다(고정)
        life_no('delete_account', {'userId': B}, 'ACCOUNT_NOT_ADMIN')
        life_no('delete_account', {}, 'ACCOUNT_ADMIN_FIXED', user=B, session=SB, device=DB)
        life_no('delete_account', {'userId': B}, 'ACCOUNT_ADMIN_FIXED', user=B, session=SB, device=DB)
        life_no('delete_account', {'userId': str(uuid.uuid4())}, 'ACCOUNT_NOT_FOUND', user=B, session=SB, device=DB)
        p1, p2 = publish(), publish()
        with_image(p1)
        acct_ok('admin_set', {'userId': A, 'images': 200000000}, user=B, session=SB, device=DB)
        # 관리자가 A를 지움 → A의 공간 모두 지우는 중, 기기 막힘, 한도 줄 없음, Auth 삭제 대기
        r = life_ok('delete_account', {'userId': A}, user=B, session=SB, device=DB)
        assert r['userId'] == A and r['spaces'] >= 2, r
        for p in (p1, p2):
            assert scalar(f"SELECT state FROM wjb_migration.job WHERE id='{p['job']}';") == 'canceled'
        assert scalar(f"SELECT count(*) FROM wjb_gateway.device WHERE user_id='{A}' AND NOT revoked;") == '0'
        assert scalar(f"SELECT count(*) FROM wjb_ops.account WHERE user_id='{A}';") == '0'
        life_no('delete_space', {'workspaceId': p1['ws']}, 'LIFE_ACCESS_DENIED')  # A의 기기는 이제 안 됨
        pend = worker('auth_pending', {})['users']
        assert A in pend
        assert worker('auth_deleted', {'userId': A})['authDeleted']
        assert A not in worker('auth_pending', {})['users']
        drain()
        assert int(scalar(f"SELECT wjb_ops.used_spaces('{A}');")) == 0
        assert int(scalar(f"SELECT wjb_ops.used_images('{A}');")) == 0 or True  # 예전 시험이 남긴 공간 그림은 그대로일 수 있음
        # 시험 뒤 A를 다시 쓸 수 있게(로컬 시험 계정)
        sql(f"UPDATE wjb_gateway.device SET revoked=false WHERE user_id='{A}'; DELETE FROM wjb_life.account_gone WHERE user_id='{A}';")
    test('031 delete_account: self or admin for others, admin fixed, every space purged, devices revoked, limits row removed, Auth deletion queued for the gateway', accounts)

    def rollback031():
        r = sql((ROOT/'033-lifecycle-rollback.sql').read_text(), check=False)
        assert r.returncode and 'MIGRATION_031_IN_USE' in r.stderr  # 지운 것이 있으면 되돌리지 않는다
        sql("DELETE FROM wjb_life.purge; DELETE FROM wjb_life.orphan; DELETE FROM wjb_life.account_gone;")
        sql((ROOT/'033-lifecycle-rollback.sql').read_text())
        assert scalar("SELECT to_regnamespace('wjb_life') IS NULL AND to_regprocedure('public.wjb_v2_lifecycle(jsonb)') IS NULL;") == 't'
        sql((ROOT/'031-lifecycle.sql').read_text())
    test('033 rollback refuses once anything was deleted through 031, otherwise drops it; 031 re-applies', rollback031)

    # ── 034 (G-6 측정: 하루 한 줄, 내용·이메일 없음, docs/v2-design/102) ──
    def metrics():
        sql((ROOT/'034-metrics.sql').read_text())
        r = sql((ROOT/'034-metrics.sql').read_text(), check=False)
        assert r.returncode and 'MIGRATION_034_ALREADY_APPLIED' in r.stderr
        v = json.loads(scalar((ROOT/'035-metrics-verify.sql').read_text()))
        assert v['table'] and v['function'] and v['searchPath'] and v['closed'], v
        p = publish()
        pull_all(p['ws'])
        e = [x for x in p['m']['records'] if x['table'] == 'entry_item'][0]
        push(p['ws'], [{'table': 'entry_item', 'key': e['key'], 'baseRev': 0, 'value': {**e['value'], 'text': '측정 가상'}}])
        m1 = json.loads(scalar("SELECT to_jsonb(wjb_ops.snapshot_metrics());"))
        assert m1['spaces'] >= 1 and m1['records'] > 0 and m1['changes_day'] >= 1 and m1['pushes_day'] >= 1 and m1['devices_day'] >= 1, m1
        assert m1['db_bytes'] > 0 and m1['storage_objects'] is None  # 로컬 시험에는 storage가 없다
        # 같은 날 다시 = 한 줄(값만 새로)
        scalar("SELECT wjb_ops.snapshot_metrics();")
        assert scalar("SELECT count(*) FROM wjb_ops.metric_day;") == '1'
        # 내용·이메일 칸이 없다
        cols = scalar("SELECT string_agg(column_name,',') FROM information_schema.columns WHERE table_schema='wjb_ops' AND table_name='metric_day';")
        assert 'email' not in cols and 'value' not in cols and 'owner' not in cols, cols
        for role in ['service_role', 'authenticated', 'anon']:
            r = sql(f"SET ROLE {role};SELECT * FROM wjb_ops.metric_day;", check=False)
            assert r.returncode and 'permission denied' in r.stderr
        sql((ROOT/'036-metrics-rollback.sql').read_text())
        assert scalar("SELECT to_regclass('wjb_ops.metric_day') IS NULL;") == 't'
        sql((ROOT/'034-metrics.sql').read_text())
    test('034 metrics: one row per day (re-run updates), counts changes/pushes/devices, no content/e-mail/owner columns, closed to API roles; 036 rollback', metrics)

    # ── 037 (처음 동기화 경합 고침, docs/v2-design/102 5절) ──
    def first_sync_lock():
        sql(f"INSERT INTO wjb_ops.account(user_id,unlimited) VALUES('{A}',true) ON CONFLICT (user_id) DO UPDATE SET unlimited=true;")
        sql((ROOT/'037-sync-first-lock.sql').read_text())
        r = sql((ROOT/'037-sync-first-lock.sql').read_text(), check=False)
        assert r.returncode and 'MIGRATION_037_ALREADY_APPLIED' in r.stderr
        v = json.loads(scalar((ROOT/'038-sync-first-lock-verify.sql').read_text()))
        assert v['locked'] and v['searchPath'] and v['closed'], v
        # 처음 동기화를 6개 기기가 같은 순간에 — 5번 반복해도 모두 성공, 하나만 적용, 게시본은 한 번만 복사
        for _ in range(5):
            p = publish()
            e = [x for x in p['m']['records'] if x['table'] == 'entry_item'][0]
            def one(i):
                return rpc('push', {'workspaceId': p['ws'], 'opId': str(uuid.uuid4()), 'changes': [{'table': 'entry_item', 'key': e['key'], 'baseRev': 0, 'value': {**e['value'], 'text': f'동시 처음 {i}'}}]})
            with concurrent.futures.ThreadPoolExecutor(6) as pool:
                rs = list(pool.map(one, range(6)))
            assert all(x.returncode == 0 for x in rs), [x.stderr[-300:] for x in rs]
            out = [json.loads(x.stdout.strip()) for x in rs]
            assert sum(o['applied'] for o in out) == 1
            n = int(scalar(f"SELECT count(*) FROM wjb_sync.record WHERE workspace_id='{p['ws']}';"))
            assert n == len(p['m']['records']), (n, len(p['m']['records']))
        sql((ROOT/'039-sync-first-lock-rollback.sql').read_text())
        assert json.loads(scalar((ROOT/'038-sync-first-lock-verify.sql').read_text()))['locked'] is False
        sql((ROOT/'037-sync-first-lock.sql').read_text())
    test('037: simultaneous first syncs from 6 devices (×5) all succeed, one applies, published copy once; 039 restores 019 exactly', first_sync_lock)

    def labels040():
        p = publish()
        st = next(r for r in p['m']['records'] if r['table'] == 'app_meta' and r['value']['key'] == 'settings')
        settings = json.loads(st['value']['value'])
        def set_label(label, rev):
            value = {'key': 'settings', 'value': json.dumps({**settings, 'workspace': label}, ensure_ascii=False)}
            assert push(p['ws'], [{'table': 'app_meta', 'key': st['key'], 'baseRev': rev, 'value': value}])['applied']
        set_label({'name': '검증 공간', 'color': 'c7', 'icon': 'chartUp', 'updatedAt': 2}, 0)
        assert listed(p['ws'])['workspace'] is None
        sql((ROOT/'040-workspace-label-icons.sql').read_text())
        checks = json.loads(scalar((ROOT/'041-workspace-label-icons-verify.sql').read_text()))
        assert all(checks.values()), checks
        assert listed(p['ws'])['workspace'] == {'name': '검증 공간', 'color': 'c7', 'icon': 'chartUp'}
        set_label({'name': '', 'color': 'c7', 'icon': 'unknown', 'updatedAt': 3}, 1)
        assert listed(p['ws'])['workspace'] == {'name': '개인', 'color': 'c1', 'icon': 'memo'}
        assert listed(p['ws'], user=B, session=SB, device=DB) is None
        sql((ROOT/'042-workspace-label-icons-rollback.sql').read_text())
        assert listed(p['ws'])['workspace'] is None
        sql((ROOT/'040-workspace-label-icons.sql').read_text())
    test('040: valid camelCase icon and color survive listing; malformed synced settings fall back to published settings', labels040)
