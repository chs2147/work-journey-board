"""Explicit DEV-only integration probe. Creates/deletes two fictional Auth users.

No email, bucket, blob, product DB or production access. Credentials/tokens stay
in memory. Run manually with --run-development-fixtures after readiness checks.
"""
import datetime
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import urllib.error
import urllib.request
import uuid

REF = "vsphftnmfzfoufasjttd"
ROOT = Path(__file__).resolve().parents[3]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def run():
    if sys.argv[1:] != ["--run-development-fixtures"]:
        raise SystemExit("Explicit --run-development-fixtures required")
    if os.environ.get("WJB_CLOUD_ENV") != "development" or os.environ.get(
        "WJB_SUPABASE_DEV_PROJECT_REF"
    ) != REF:
        raise SystemExit("Development environment required")
    key = os.environ["WJB_SUPABASE_DEV_SERVICE_ROLE_KEY"]
    management = os.environ["WJB_SUPABASE_DEV_MANAGEMENT_TOKEN"]
    opener = urllib.request.build_opener(NoRedirect)
    checks, users, sessions = [], [], []
    workspace, asset = str(uuid.uuid4()), str(uuid.uuid4())
    devices = [str(uuid.uuid4()), str(uuid.uuid4())]
    attempted_users = []
    report = {"target": REF, "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "checks": checks, "cleanup": {}, "mailSent": False, "blobWrites": False}

    def request(path, data=None, method="POST", access=None, admin=False):
        headers = {"apikey": key, "Content-Type": "application/json"}
        if admin or access:
            headers["Authorization"] = "Bearer " + (key if admin else access)
        req = urllib.request.Request("https://" + REF + ".supabase.co" + path,
            data=None if data is None else json.dumps(data).encode(), headers=headers, method=method)
        try:
            with opener.open(req, timeout=25) as response:
                raw = response.read()
                return response.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            try:
                body = json.loads(error.read())
            except (ValueError, UnicodeError):
                body = {}
            return error.code, body

    def expect(name, condition):
        checks.append({"name": name, "passed": bool(condition)})
        if not condition:
            raise RuntimeError(name)

    def sql(query):
        req = urllib.request.Request("https://api.supabase.com/v1/projects/" + REF + "/database/query",
            data=json.dumps({"query": query, "read_only": False}).encode(), method="POST",
            headers={"Authorization": "Bearer " + management, "Content-Type": "application/json"})
        with opener.open(req, timeout=30) as response:
            return json.loads(response.read())

    def rpc(name, data, access=None):
        return request("/rest/v1/rpc/" + name, data, access=access, admin=access is None)

    def active(user, session):
        return rpc("wjb_v2_session_active", {"p_user": user, "p_session": session})

    try:
        status, jwks = request("/auth/v1/.well-known/jwks.json", method="GET")
        expect("trusted_dev_jwks", status == 200 and bool(jwks.get("keys")))
        for index in range(2):
            user_id = str(uuid.uuid4())
            attempted_users.append(user_id)
            password = secrets.token_urlsafe(32)
            email = "wjb-v2-" + user_id + "@example.invalid"
            status, created = request("/auth/v1/admin/users", {
                "id": user_id, "email": email, "password": password, "email_confirm": True,
                "user_metadata": {"fixture": "wjb-v2-development-auth-probe"}}, admin=True)
            expect("create_confirmed_fixture_" + str(index), status in (200, 201) and created.get("id") == user_id)
            users.append(user_id)
            status, login = request("/auth/v1/token?grant_type=password", {"email": email, "password": password})
            expect("password_login_" + str(index), status == 200 and isinstance(login.get("access_token"), str))
            # The real product verifier verifies signature/issuer/audience/claims.
            # Only verified IDs leave the child; no access/refresh token is persisted.
            source = '''import {createVerifier} from './poc/v2-auth/verifier.mjs';
let raw='';for await(const c of process.stdin)raw+=c;
try {const x=JSON.parse(raw);const verify=createVerifier({projectRef:x.ref,jwks:x.jwks,sessionIsActive:async()=>true});
const p=await verify(x.token);process.stdout.write(JSON.stringify({userId:p.userId,sessionId:p.sessionId}));}
catch {process.exitCode=1;}'''
            verified = subprocess.run(["node", "--input-type=module", "-e", source], cwd=ROOT,
                input=json.dumps({"ref": REF, "jwks": jwks, "token": login["access_token"]}),
                text=True, capture_output=True, timeout=15)
            expect("real_es256_token_verifier_" + str(index), verified.returncode == 0)
            principal = json.loads(verified.stdout)
            expect("token_subject_" + str(index), principal["userId"] == user_id)
            sessions.append(principal["sessionId"])
            expect("live_session_" + str(index), active(user_id, sessions[-1]) == (200, True))
            status, _ = rpc("wjb_v2_session_active", {"p_user": user_id, "p_session": sessions[-1]}, access=login["access_token"])
            expect("authenticated_client_cannot_call_server_rpc_" + str(index), status in (401, 403, 404))
            login.clear()
        expect("cross_subject_session_denied", active(users[1], sessions[0]) == (200, False))
        sql("BEGIN; INSERT INTO wjb_gateway.workspace(id,owner_id,generation) VALUES ('" + workspace + "','" + users[0] + "',1);" +
            "".join("INSERT INTO wjb_gateway.device(id,user_id,session_id) VALUES ('" + d + "','" + u + "','" + s + "');" for d,u,s in zip(devices,users,sessions)) + "COMMIT;")
        def reserve(index):
            return rpc("wjb_v2_asset_command", {"p_request": {"action": "reserve", "userId": users[index],
                "sessionId": sessions[index], "scope": {"workspaceId": workspace, "assetId": asset,
                "deviceId": devices[index], "generation": "1"}, "params": {"bytes": 8, "sha256": "a" * 64}}})
        status, row = reserve(0)
        expect("owner_metadata_reserve", status == 200 and row.get("state") == "reserved" and row.get("created") is True)
        status, error = reserve(1)
        expect("other_owner_workspace_denied", status == 400 and error.get("message") == "ACCESS_DENIED")
        status, _ = rpc("wjb_v2_revoke_session", {"p_user": users[0], "p_session": sessions[0]})
        expect("server_session_revocation", status in (200, 204))
        expect("revoked_session_inactive", active(users[0], sessions[0]) == (200, False))
        expect("other_user_session_preserved", active(users[1], sessions[1]) == (200, True))
        status, error = reserve(0)
        expect("revoked_session_metadata_denied", status == 400 and error.get("message") == "ACCESS_REVOKED")
    except Exception as error:
        # Never log upstream bodies, tokens, passwords or exception messages.
        report["failureType"] = type(error).__name__
    finally:
        try:
            ids = ",".join("'" + uid + "'" for uid in attempted_users) or "NULL"
            sql("BEGIN; DELETE FROM wjb_gateway.asset WHERE workspace_id='" + workspace + "';" +
                "DELETE FROM wjb_gateway.workspace WHERE id='" + workspace + "';" +
                "DELETE FROM wjb_gateway.device WHERE id IN ('" + "','".join(devices) + "');" +
                "DELETE FROM wjb_v2_cloud.blocked_session WHERE user_id IN (" + ids + "); COMMIT;")
            rows = sql("SELECT (SELECT count(*) FROM wjb_gateway.workspace WHERE id='" + workspace + "') + " +
                "(SELECT count(*) FROM wjb_gateway.asset WHERE workspace_id='" + workspace + "') + " +
                "(SELECT count(*) FROM wjb_gateway.device WHERE id IN ('" + "','".join(devices) + "')) + " +
                "(SELECT count(*) FROM wjb_v2_cloud.blocked_session WHERE user_id IN (" + ids + ")) AS remaining;")
            report["cleanup"]["metadataEmpty"] = rows == [{"remaining": 0}]
        except Exception:
            report["cleanup"]["metadataEmpty"] = False
        absent = []
        for uid in attempted_users:
            try:
                request("/auth/v1/admin/users/" + uid, method="DELETE", admin=True)
                status, _ = request("/auth/v1/admin/users/" + uid, method="GET", admin=True)
                absent.append(status == 404)
            except Exception:
                absent.append(False)
        report["cleanup"]["authUsersAbsent"] = len(absent) == len(attempted_users) and all(absent)
        if not all(report["cleanup"].values()):
            report["cleanupIdentifiers"] = {"users": attempted_users, "workspace": workspace, "devices": devices}
        report["passed"] = "failureType" not in report and all(report["cleanup"].values())
        report["finishedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        path = ROOT / "docs/v2-design/evidence/development-auth-live-check.json"
        path.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(run())
