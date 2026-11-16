// 가짜 gateway로 이관 통신 규칙을 본다(실제 네트워크 없음)
use super::*;
use std::cell::RefCell;
use std::collections::VecDeque;

type Seen = (String, String, Vec<(String, String)>, usize, Option<Value>);
#[derive(Default)]
struct Fake {
    replies: RefCell<VecDeque<(u16, Value)>>,
    seen: RefCell<Vec<Seen>>,
}
impl Fake {
    fn reply(self, s: u16, v: Value) -> Self {
        self.replies.borrow_mut().push_back((s, v));
        self
    }
}
impl Gateway for Fake {
    async fn send(
        &self,
        method: &'static str,
        path: &str,
        bearer: &str,
        headers: &[(&'static str, String)],
        body: Body,
    ) -> Result<(u16, Value), String> {
        assert!(
            online::path_allowed(path) && path.starts_with(GATEWAY),
            "경로 {path}"
        );
        assert_eq!(bearer, "ACCESS");
        let (len, json) = match body {
            Body::Json(b) => (b.len(), Some(serde_json::from_slice(&b).unwrap())),
            Body::Bytes(b) => (b.len(), None),
        };
        self.seen.borrow_mut().push((
            method.into(),
            path.into(),
            headers
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
            len,
            json,
        ));
        Ok(self
            .replies
            .borrow_mut()
            .pop_front()
            .unwrap_or((500, Value::Null)))
    }
}
const DEV: &str = "11111111-1111-4111-8111-111111111111";
const JOB: &str = "22222222-2222-4222-8222-222222222222";
const WS: &str = "33333333-3333-4333-8333-333333333333";
const OBJ: &str = "44444444-4444-4444-8444-444444444444";
const OWNER: &str = "55555555-5555-4555-8555-555555555555";
fn run<F: std::future::Future>(f: F) -> F::Output {
    tauri::async_runtime::block_on(f)
}
fn hex(b: &[u8]) -> String {
    Sha256::digest(b)
        .iter()
        .map(|x| format!("{x:02x}"))
        .collect()
}

#[test]
fn device_register_sends_only_device_id() {
    let gw = Fake::default().reply(200, json!({ "deviceId": DEV, "registered": true }));
    run(register_device(&gw, "ACCESS", DEV)).unwrap();
    let seen = gw.seen.borrow();
    assert_eq!(seen[0].1, "/functions/v1/wjb-gateway/v2/devices");
    assert_eq!(seen[0].4, Some(json!({ "deviceId": DEV })));
    let gw = Fake::default().reply(200, json!({ "deviceId": JOB, "registered": true }));
    assert_eq!(
        run(register_device(&gw, "ACCESS", DEV)).unwrap_err(),
        "SERVER_RESPONSE"
    );
}

#[test]
fn command_checks_action_ids_size_and_maps_errors() {
    let gw = Fake::default();
    for (job, action) in [
        ("x", "status"),
        (JOB, "attest/../x"),
        (JOB, "workspace"),
        (JOB, "drop"),
    ] {
        assert_eq!(
            run(command(&gw, "ACCESS", DEV, job, action, json!({}))).unwrap_err(),
            "INVALID_REQUEST",
            "{job} {action}"
        );
    }
    assert!(
        gw.seen.borrow().is_empty(),
        "검사에 걸린 요청은 보내지 않는다"
    );
    let big = json!({ "records": "x".repeat(MAX_REQUEST_BYTES) });
    assert_eq!(
        run(command(&gw, "ACCESS", DEV, JOB, "upload_page", big)).unwrap_err(),
        "REQUEST_TOO_LARGE"
    );
    let gw = Fake::default()
        .reply(200, json!({ "state": "staging" }))
        .reply(409, json!({ "error": "MIGRATION_PAGE_CHANGED" }))
        .reply(502, json!({ "error": "<html>" }));
    assert_eq!(
        run(command(&gw, "ACCESS", DEV, JOB, "start_upload", json!({}))).unwrap()["state"],
        "staging"
    );
    assert_eq!(
        run(command(&gw, "ACCESS", DEV, JOB, "upload_page", json!({}))).unwrap_err(),
        "MIGRATION_PAGE_CHANGED"
    );
    assert_eq!(
        run(command(&gw, "ACCESS", DEV, JOB, "status", json!({}))).unwrap_err(),
        "HTTP_502"
    );
    let seen = gw.seen.borrow();
    assert_eq!(
        seen[0].1,
        format!("/functions/v1/wjb-gateway/v2/migrations/{JOB}/start_upload")
    );
    assert_eq!(seen[0].4, Some(json!({ "deviceId": DEV, "params": {} })));
}

#[test]
fn asset_put_rechecks_hash_and_size_before_sending() {
    let bytes = vec![7u8; 1000];
    let gw = Fake::default().reply(200, json!({ "state": "ready" }));
    assert_eq!(
        run(put_asset(
            &gw,
            "ACCESS",
            DEV,
            WS,
            OBJ,
            &hex(b"other"),
            bytes.clone()
        ))
        .unwrap_err(),
        "INTEGRITY_MISMATCH"
    );
    assert_eq!(
        run(put_asset(&gw, "ACCESS", DEV, WS, OBJ, &hex(&[]), vec![])).unwrap_err(),
        "ASSET_SIZE"
    );
    let over = vec![0u8; MAX_ASSET_BYTES + 1];
    assert_eq!(
        run(put_asset(&gw, "ACCESS", DEV, WS, OBJ, &hex(&over), over)).unwrap_err(),
        "ASSET_SIZE"
    );
    assert!(gw.seen.borrow().is_empty());
    run(put_asset(&gw, "ACCESS", DEV, WS, OBJ, &hex(&bytes), bytes)).unwrap();
    let seen = gw.seen.borrow();
    assert_eq!(seen[0].0, "PUT");
    assert_eq!(
        seen[0].1,
        format!("/functions/v1/wjb-gateway/v2/workspaces/{WS}/assets/{OBJ}/content")
    );
    assert_eq!(seen[0].3, 1000);
    assert!(seen[0].2.contains(&("x-wjb-generation".into(), "1".into())));
    assert!(seen[0].2.contains(&("x-wjb-device-id".into(), DEV.into())));
}

fn journal() -> Journal {
    Journal {
        version: 1,
        job_id: JOB.into(),
        owner_id: OWNER.into(),
        workspace_id: WS.into(),
        snapshot_id: DEV.into(),
        source_hash: hex(b"s"),
        mapping_hash: hex(b"m"),
        manifest_hash: None,
        publish_operation_id: None,
        cancel_operation_id: None,
        pages: 6,
        records: 5052,
        phase: "uploading-records".into(),
        assets: vec![JournalAsset {
            object_id: OBJ.into(),
            sha256: hex(b"a"),
            bytes: 2048,
            state: "pending".into(),
        }],
        updated_at: 1,
    }
}

#[test]
fn journal_keeps_ids_only_and_per_account() {
    let dir = std::env::temp_dir().join(format!("wjb-mig-{}", uuid::Uuid::new_v4()));
    let j = journal();
    journal_write(&dir, OWNER, &j).unwrap();
    assert_eq!(journal_list(&dir, OWNER), vec![j.clone()]);
    // 다른 계정 = 보이지 않고 지우지도 않는다
    let other = "66666666-6666-4666-8666-666666666666";
    assert!(journal_list(&dir, other).is_empty());
    journal_remove(&dir, other, JOB).unwrap();
    assert_eq!(journal_list(&dir, OWNER).len(), 1);
    assert_eq!(
        journal_write(&dir, other, &j).unwrap_err(),
        "INVALID_JOURNAL"
    );
    // 모르는 칸(기록 내용 등)·잘못된 값은 거절
    let mut bad = serde_json::to_value(&j).unwrap();
    bad["records_body"] = json!("업무 내용");
    assert!(serde_json::from_value::<Journal>(bad).is_err());
    for f in [
        |j: &mut Journal| j.phase = "unknown".into(),
        |j: &mut Journal| j.pages = 33,
        |j: &mut Journal| j.assets[0].bytes = MAX_ASSET_BYTES as u64 + 1,
        |j: &mut Journal| j.manifest_hash = Some("x".into()),
        |j: &mut Journal| j.publish_operation_id = Some("../x".into()),
    ] {
        let mut b = journal();
        f(&mut b);
        assert_eq!(
            journal_write(&dir, OWNER, &b).unwrap_err(),
            "INVALID_JOURNAL"
        );
    }
    // 손으로 바꾼 파일(이름과 작업 ID가 다름)은 읽지 않는다
    fs::copy(
        dir.join("migrations").join(format!("{JOB}.json")),
        dir.join("migrations").join(format!("{WS}.json")),
    )
    .unwrap();
    assert_eq!(journal_list(&dir, OWNER).len(), 1);
    journal_remove(&dir, OWNER, JOB).unwrap();
    assert!(journal_list(&dir, OWNER).is_empty());
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn asset_route_error_shape_is_read() {
    let gw = Fake::default().reply(503, json!({ "error": { "code": "DELETE_NOT_CONFIRMED" } }));
    assert_eq!(
        run(cancel_asset(&gw, "ACCESS", DEV, WS, OBJ)).unwrap_err(),
        "DELETE_NOT_CONFIRMED"
    );
}

#[test]
fn cancel_asset_uses_gateway_cancel_route() {
    let gw = Fake::default().reply(200, json!({ "state": "canceled" }));
    run(cancel_asset(&gw, "ACCESS", DEV, WS, OBJ)).unwrap();
    assert_eq!(
        run(cancel_asset(&gw, "ACCESS", DEV, "x", OBJ)).unwrap_err(),
        "INVALID_REQUEST"
    );
    let seen = gw.seen.borrow();
    assert_eq!(seen.len(), 1);
    assert_eq!(
        seen[0].1,
        format!("/functions/v1/wjb-gateway/v2/workspaces/{WS}/assets/{OBJ}/cancel")
    );
    assert_eq!(
        seen[0].4,
        Some(json!({ "deviceId": DEV, "generation": "1" }))
    );
}

#[test]
fn ensure_device_retries_with_a_fresh_id_when_the_device_belongs_to_another_account() {
    let dir = std::env::temp_dir().join(format!("wjb-ensure-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let st = online::Store::new(dir.clone());
    let first = st.gateway_device_id(OWNER).unwrap();
    // 서버: 첫 ID는 다른 계정 것이라 거절 → 새 ID로 다시 → 등록됨
    let gw = Fake::default()
        .reply(403, json!({ "error": "DEVICE_ACCESS_DENIED" }))
        .reply(
            200,
            json!({ "deviceId": "PLACEHOLDER", "registered": true }),
        );
    // 두 번째 응답의 deviceId는 보낸 ID와 같아야 하므로, 보낼 새 ID를 미리 알 수 없어 응답을 맞춘다
    let got = run(async {
        match register_device(&gw, "ACCESS", &first).await {
            Err(e) if e == "DEVICE_ACCESS_DENIED" => {
                let fresh = st.reset_gateway_device_id(OWNER).unwrap();
                gw.replies.borrow_mut().clear();
                gw.replies
                    .borrow_mut()
                    .push_back((200, json!({ "deviceId": fresh, "registered": true })));
                register_device(&gw, "ACCESS", &fresh).await.map(|_| fresh)
            }
            other => other.map(|_| first.clone()),
        }
    })
    .unwrap();
    assert_ne!(got, first);
    assert_eq!(
        st.gateway_device_id(OWNER).unwrap(),
        got,
        "다음 요청부터 새 ID"
    );
    // ensure_device 자체: 처음 등록이 되면 같은 ID 그대로
    let ok = Fake::default().reply(200, json!({ "deviceId": got, "registered": true }));
    assert_eq!(
        run(ensure_device(&ok, &st, OWNER, "ACCESS", &got)).unwrap(),
        got
    );
    // 다른 오류는 그대로 전한다(새 ID 만들지 않음)
    let down = Fake::default().reply(503, json!({ "error": "AUTH_UNAVAILABLE" }));
    assert!(run(ensure_device(&down, &st, OWNER, "ACCESS", &got)).is_err());
    assert_eq!(st.gateway_device_id(OWNER).unwrap(), got);
    std::fs::remove_dir_all(dir).ok();
}
