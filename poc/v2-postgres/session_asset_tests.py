"""Local-only device lifecycle and private-object test-double checks."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess


def run(c):
    sql, scalar, client, success, reject, test, equal, uid = [c[k] for k in
        ('sql','scalar','client','success','reject','test','equal','uid')]
    A, B, WA, WB, DA, DB, SA, SB = [c[k] for k in ('A','B','WA','WB','DA','DB','SA','SB')]
    extra, new_session = uid(600), uid(601)
    payload = b'fictional-private-object'
    digest = hashlib.sha256(payload).hexdigest()

    def reserve(asset, size=len(payload), sha=digest, workspace=WA, device=DA, generation=1):
        return f"SELECT wjb_v2.reserve_asset('{workspace}',{generation},'{device}','{uid(asset)}','{sha}',{size})"

    def finalize(asset, workspace=WA, device=DA, generation=1):
        return f"SELECT wjb_v2.finalize_asset('{workspace}',{generation},'{device}','{uid(asset)}')"

    def cancel(asset):
        return f"SELECT wjb_v2.cancel_asset('{WA}',1,'{DA}','{uid(asset)}')"

    def stage(asset, data=payload, workspace=WA):
        return f"SELECT wjb_v2.stage_asset_bytes('{workspace}','{uid(asset)}',decode('{data.hex()}','hex'))"

    def worker(query):
        return scalar('SET ROLE wjb_poc_owner; '+query)

    def asset_state():
        return scalar("SELECT jsonb_build_array("
            "(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY workspace_id,id),'[]') FROM wjb_v2.asset a),"
            "(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY workspace_id,id),'[]') FROM wjb_v2.asset_bytes b))")

    def denied(query, code, **kw):
        before = asset_state()
        reject(query,code,**kw)
        equal(asset_state(),before)

    def signed_registration():
        fixture = Path(__file__).resolve().parent.parent/'v2-auth'/'principal-fixture.mjs'
        p = subprocess.run(['node',str(fixture)],capture_output=True,text=True,check=True,timeout=15)
        principal = json.loads(p.stdout)
        equal(principal['userId'], A);equal(principal['sessionId'],SA)
        result = success(f"SELECT wjb_v2.register_device('{extra}')",user=principal['userId'],session=principal['sessionId'])
        equal(result,{'deviceId':extra,'registered':True})

    test('verified local signed principal registers own device',signed_registration)
    test('device registration retry idempotent',lambda:equal(success(f"SELECT wjb_v2.register_device('{extra}')")['deviceId'],extra))
    test('other user cannot claim device id',lambda:reject(f"SELECT wjb_v2.register_device('{extra}')",'ACCESS_REVOKED',user=B,session=SB))
    test('new session cannot silently rebind device',lambda:reject(f"SELECT wjb_v2.register_device('{extra}')",'ACCESS_REVOKED',session=new_session))
    test('registration requires session uuid',lambda:reject(f"SELECT wjb_v2.register_device('{uid(602)}')",'INVALID_SESSION',session='bad'))
    test('registration requires user',lambda:reject(f"SELECT wjb_v2.register_device('{uid(602)}')",'AUTH_REQUIRED',user=None))
    test('anonymous registration denied',lambda:reject(f"SELECT wjb_v2.register_device('{uid(602)}')",'permission denied',role='anon'))
    test('reserve object starts private',lambda:equal(success(reserve(700))['state'],'reserved'))
    test('reservation retry idempotent',lambda:equal(success(reserve(700))['state'],'reserved'))
    test('reservation payload substitution rejected',lambda:denied(reserve(700,sha='0'*64),'IDEMPOTENCY_KEY_REUSED'))
    test('pending metadata not visible even to owner',lambda:equal(scalar(client('SELECT count(*) FROM wjb_v2.asset')),'0'))
    test('missing uploaded bytes cannot finalize',lambda:denied(finalize(700),'UPLOAD_INCOMPLETE'))
    test('untrusted caller cannot stage object bytes',lambda:denied(stage(700),'permission denied'))
    test('worker uploads exact private bytes',lambda:worker(stage(700)))
    test('worker upload retry with same bytes succeeds',lambda:worker(stage(700)))
    test('pending bytes not visible even to owner',lambda:equal(scalar(client('SELECT count(*) FROM wjb_v2.asset_bytes')),'0'))
    # Worker calls need a separate role assertion, not authenticated credentials.
    def immutable_upload():
        before=asset_state();r=sql('SET ROLE wjb_poc_owner; '+stage(700,b'x'*len(payload)),check=False)
        assert r.returncode != 0 and 'OBJECT_IMMUTABLE' in r.stderr
        equal(asset_state(),before)
    test('stored upload cannot be overwritten',immutable_upload)
    test('other workspace cannot finalize upload',lambda:denied(finalize(700,workspace=WB),'ACCESS_REVOKED'))
    test('wrong device cannot finalize upload',lambda:denied(finalize(700,device=extra),'ACCESS_REVOKED'))
    test('valid bytes finalize ready',lambda:equal(success(finalize(700))['state'],'ready'))
    test('finalize retry returns ready',lambda:equal(success(finalize(700))['state'],'ready'))
    test('owner reads finalized bytes intact',lambda:equal(scalar(client('SELECT encode(payload,\'hex\') FROM wjb_v2.asset_bytes')),payload.hex()))
    test('other account sees no finalized bytes',lambda:equal(scalar(client('SELECT count(*) FROM wjb_v2.asset_bytes',user=B,session=SB)),'0'))
    test('other account sees no finalized metadata',lambda:equal(scalar(client('SELECT count(*) FROM wjb_v2.asset',user=B,session=SB)),'0'))
    test('ready object cannot be canceled',lambda:denied(cancel(700),'ASSET_ALREADY_READY'))
    test('direct asset state update denied',lambda:denied("UPDATE wjb_v2.asset SET state='ready'",'permission denied'))
    test('direct object insert denied',lambda:denied(f"INSERT INTO wjb_v2.asset_bytes VALUES('{WA}','{uid(777)}',decode('78','hex'))",'permission denied'))
    test('wrong generation cannot reserve',lambda:denied(reserve(701,generation=2),'GENERATION_CHANGED'))
    test('invalid hash cannot reserve',lambda:denied(reserve(701,sha='../bad'),'INVALID_ASSET'))
    test('oversized reservation denied',lambda:denied(reserve(701,size=65537),'INVALID_ASSET'))
    test('zero size reservation denied',lambda:denied(reserve(701,size=0),'INVALID_ASSET'))

    def mismatch(asset,size,data,code):
        success(reserve(asset,size=size));worker(stage(asset,data));denied(finalize(asset),code)
        equal(scalar(client(f"SELECT count(*) FROM wjb_v2.asset WHERE id='{uid(asset)}'")),'0')
    test('actual size mismatch remains private',lambda:mismatch(701,len(payload)+1,payload,'SIZE_MISMATCH'))
    test('actual hash mismatch remains private',lambda:mismatch(702,len(payload),b'x'*len(payload),'HASH_MISMATCH'))
    test('cancel pending removes staged bytes',lambda:(scalar(client(cancel(702))),equal(scalar(f"SELECT count(*) FROM wjb_v2.asset_bytes WHERE id='{uid(702)}'"),'0')))
    test('canceled asset id not silently reused',lambda:denied(reserve(702),'ASSET_CANCELED'))
    test('canceled asset cannot finalize',lambda:denied(finalize(702),'ASSET_CANCELED'))

    def expiry():
        success(reserve(703));worker(stage(703))
        sql(f"UPDATE wjb_v2.asset SET expires_at=now()-interval '1 second' WHERE id='{uid(703)}'")
        denied(finalize(703),'UPLOAD_EXPIRED')
    test('expired pending upload cannot finalize',expiry)
    test('expired reservation retry fails closed',lambda:denied(reserve(703),'UPLOAD_EXPIRED'))
    test('expired reservation can be explicitly canceled',lambda:scalar(client(cancel(703))))

    def generation():
        sql(f"UPDATE wjb_v2.workspace SET generation=2 WHERE id='{WA}'")
        try:
            denied(finalize(700,generation=2),'GENERATION_CHANGED')
            equal(scalar(client('SELECT count(*) FROM wjb_v2.asset_bytes')),'0')
        finally:sql(f"UPDATE wjb_v2.workspace SET generation=1 WHERE id='{WA}'")
    test('generation change hides old ready bytes and rejects ack',generation)

    def finalize_failure():
        success(reserve(704));worker(stage(704))
        sql("""CREATE FUNCTION wjb_v2.test_asset_failure() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'INJECTED_ASSET_FAILURE'; END $$;
            CREATE TRIGGER test_asset_failure AFTER UPDATE ON wjb_v2.asset FOR EACH ROW
            WHEN (NEW.state='ready') EXECUTE FUNCTION wjb_v2.test_asset_failure();""")
        try:denied(finalize(704),'INJECTED_ASSET_FAILURE')
        finally:sql('DROP TRIGGER test_asset_failure ON wjb_v2.asset; DROP FUNCTION wjb_v2.test_asset_failure()')
        equal(success(finalize(704))['state'],'ready')
    test('failed finalize never exposes bytes and can retry',finalize_failure)

    def registration_revoke_race():
        session, device = uid(605), uid(606)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            reg=pool.submit(sql,client(f"SELECT wjb_v2.register_device('{device}')",session=session),False)
            rev=pool.submit(sql,client('SELECT wjb_v2.revoke_current_session()',session=session),False)
            r1,r2=reg.result(),rev.result()
        equal(r2.returncode,0)
        assert r1.returncode==0 or 'ACCESS_REVOKED' in r1.stderr
        reject(f"SELECT wjb_v2.register_device('{device}')",'ACCESS_REVOKED',session=session)
        equal(scalar(f"SELECT count(*) FROM wjb_v2.device_session WHERE auth_session_id='{session}' AND NOT revoked"),'0')
    test('concurrent registration and revoke cannot resurrect session',registration_revoke_race)

    def full_quota():
        for n in range(800,815):success(reserve(n,size=65536))
        # Earlier small reservations are counted as well; one more 64KiB fails.
        denied(reserve(815,size=65536),'QUOTA_EXCEEDED')
        scalar(client(cancel(800)))
        equal(success(reserve(815,size=65536))['state'],'reserved')
    test('pending bytes reserve quota and cancel releases quota',full_quota)

    def quota_race():
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            jobs=[pool.submit(sql,client(reserve(n,size=40000)),False) for n in (900,901)]
            values=[p.result() for p in jobs]
        equal(sorted(r.returncode==0 for r in values),[False,True])
        assert any('QUOTA_EXCEEDED' in r.stderr for r in values)
        total=int(scalar("SELECT sum(expected_bytes) FROM wjb_v2.asset WHERE state<>'canceled'"))
        assert total<=1048576
    test('concurrent reservations cannot exceed quota',quota_race)

    def revoke():
        # Revokes every binding of this Auth session, including both DA and extra.
        scalar(client('SELECT wjb_v2.revoke_current_session()'))
        reject(f"SELECT wjb_v2.register_device('{uid(620)}')",'ACCESS_REVOKED')
        reject(f"SELECT wjb_v2.register_device('{extra}')",'ACCESS_REVOKED')
        denied(finalize(700),'ACCESS_REVOKED')
        equal(scalar(client('SELECT count(*) FROM wjb_v2.asset_bytes')),'0')
        equal(scalar(client('SELECT count(*) FROM wjb_v2.text_record')),'0')
    test('app session revoke blocks reregistration and private reads',revoke)
    test('session revocation retry is safe',lambda:scalar(client('SELECT wjb_v2.revoke_current_session()')))
    test('different account session remains active',lambda:equal(scalar(client('SELECT count(*) FROM wjb_v2.workspace',user=B,session=SB)),'1'))
    test('fresh auth session can register a new device',lambda:equal(success(f"SELECT wjb_v2.register_device('{uid(621)}')",session=new_session)['registered'],True))
    test('blocked session ledger cannot be read by client',lambda:reject('SELECT * FROM wjb_v2.blocked_session','permission denied'))
