"""Local PostgreSQL tests for 019 workspace sync (E-2, docs/v2-design/90); synthetic data only."""
import concurrent.futures
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
