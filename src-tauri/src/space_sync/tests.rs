// 가짜 gateway로 동기화 통신 규칙을 본다(실제 네트워크 없음)
use super::*;
use std::cell::RefCell;

const WS: &str = "33333333-3333-4333-8333-333333333333";
const OBJ: &str = "44444444-4444-4444-8444-444444444444";
const DEV: &str = "11111111-1111-4111-8111-111111111111";

#[derive(Default)]
struct Fake {
    calls: RefCell<Vec<String>>,
    already_ready: bool,
    image: Vec<u8>,
    corrupt: bool,
    fail: Option<(u16, Value)>,
}
impl Gateway for Fake {
    async fn send(
        &self,
        m: &'static str,
        path: &str,
        bearer: &str,
        _h: &[(&'static str, String)],
        body: Body,
    ) -> Result<(u16, Value), String> {
        assert_eq!(bearer, "ACCESS");
        assert!(crate::online::path_allowed(path));
        let last = path.rsplit('/').next().unwrap().to_string();
        self.calls.borrow_mut().push(format!("{m} {last}"));
        if let Some(f) = &self.fail {
            return Ok(f.clone());
        }
        match body {
            Body::Json(b) => {
                let v: Value = serde_json::from_slice(&b).unwrap();
                assert_eq!(v["deviceId"], json!(DEV));
                Ok(match last.as_str() {
                    "pull" => (
                        200,
                        json!({ "changes": [], "more": false, "next": "0", "head": "0" }),
                    ),
                    "push" => (200, json!({ "applied": true, "records": [], "head": "1" })),
                    "asset_declare" => (200, json!({ "declared": true })),
                    "reserve" => (
                        201,
                        json!({ "state": if self.already_ready { "ready" } else { "reserved" } }),
                    ),
                    _ => (404, json!({ "error": "NOT_FOUND" })),
                })
            }
            Body::Bytes(_) => Ok((200, json!({ "state": "ready" }))),
        }
    }
}
impl Download for Fake {
    async fn get_bytes(
        &self,
        path: &str,
        _b: &str,
        _h: &[(&'static str, String)],
        _max: usize,
    ) -> Result<(u16, Vec<u8>), String> {
        assert!(path.ends_with(&format!("/v2/workspaces/{WS}/assets/{OBJ}/content")));
        self.calls.borrow_mut().push("GET content".into());
        let mut b = self.image.clone();
        if self.corrupt {
            b[0] ^= 1;
        }
        Ok((200, b))
    }
}
fn run<F: std::future::Future>(f: F) -> F::Output {
    tauri::async_runtime::block_on(f)
}
fn tmp() -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("wjb-spacesync-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn call_only_known_actions_and_workspace() {
    let g = Fake::default();
    let ok = run(call(
        &g,
        "ACCESS",
        DEV,
        "pull",
        json!({ "workspaceId": WS, "after": "0", "limit": 10 }),
    ))
    .unwrap();
    assert_eq!(ok["head"], json!("0"));
    for (a, p) in [
        ("drop", json!({ "workspaceId": WS })),
        ("pull", json!({ "workspaceId": "x" })),
        ("pull", json!([1])),
    ] {
        assert_eq!(
            run(call(&g, "ACCESS", DEV, a, p)).unwrap_err(),
            "INVALID_REQUEST"
        );
    }
    let big = json!({ "workspaceId": WS, "opId": OBJ, "changes": [{ "value": { "t": "x".repeat(MAX_SYNC_BODY) } }] });
    assert_eq!(
        run(call(&g, "ACCESS", DEV, "push", big)).unwrap_err(),
        "SYNC_REQUEST_TOO_LARGE"
    );
    assert_eq!(g.calls.borrow().len(), 1);
    let bad = Fake {
        fail: Some((409, json!({ "error": "SYNC_ASSET_NOT_READY" }))),
        ..Default::default()
    };
    assert_eq!(
        run(call(
            &bad,
            "ACCESS",
            DEV,
            "push",
            json!({ "workspaceId": WS })
        ))
        .unwrap_err(),
        "SYNC_ASSET_NOT_READY"
    );
}

#[test]
fn upload_declares_reserves_puts_and_caches() {
    let d = tmp();
    let img = vec![7u8; 300];
    let sha = hex(&img);
    let g = Fake::default();
    let r = run(upload(&g, "ACCESS", DEV, &d, WS, OBJ, &sha, img.clone())).unwrap();
    assert_eq!(r["uploaded"], json!(true));
    assert_eq!(
        *g.calls.borrow(),
        vec!["POST asset_declare", "POST reserve", "PUT content"]
    );
    assert_eq!(
        fs::read(d.join("assets").join(format!("{sha}.bin"))).unwrap(),
        img
    );
    // 이미 ready면 다시 올리지 않는다
    let g2 = Fake {
        already_ready: true,
        ..Default::default()
    };
    let r = run(upload(&g2, "ACCESS", DEV, &d, WS, OBJ, &sha, img.clone())).unwrap();
    assert_eq!(r["uploaded"], json!(false));
    assert_eq!(
        *g2.calls.borrow(),
        vec!["POST asset_declare", "POST reserve"]
    );
    // 해시가 다르면 보내지 않는다
    let g3 = Fake::default();
    assert_eq!(
        run(upload(
            &g3,
            "ACCESS",
            DEV,
            &d,
            WS,
            OBJ,
            &"0".repeat(64),
            img
        ))
        .unwrap_err(),
        "INTEGRITY_MISMATCH"
    );
    assert!(g3.calls.borrow().is_empty());
    fs::remove_dir_all(d).ok();
}

#[test]
fn fetch_uses_cache_then_server_and_checks_hash() {
    let d = tmp();
    let img = vec![3u8; 200];
    let sha = hex(&img);
    let g = Fake {
        image: img.clone(),
        ..Default::default()
    };
    assert_eq!(
        run(fetch(&g, "ACCESS", DEV, &d, WS, OBJ, &sha, img.len())).unwrap(),
        img
    );
    assert_eq!(
        run(fetch(&g, "ACCESS", DEV, &d, WS, OBJ, &sha, img.len())).unwrap(),
        img
    );
    assert_eq!(g.calls.borrow().len(), 1, "두 번째는 캐시");
    let d2 = tmp();
    let bad = Fake {
        image: img.clone(),
        corrupt: true,
        ..Default::default()
    };
    assert_eq!(
        run(fetch(&bad, "ACCESS", DEV, &d2, WS, OBJ, &sha, img.len())).unwrap_err(),
        "INTEGRITY_MISMATCH"
    );
    assert!(!d2.join("assets").join(format!("{sha}.bin")).exists());
    fs::remove_dir_all(d).ok();
    fs::remove_dir_all(d2).ok();
}

#[test]
fn account_call_checks_action_and_device_before_sending() {
    struct Never;
    impl Gateway for Never {
        async fn send(
            &self,
            _m: &'static str,
            _p: &str,
            _b: &str,
            _h: &[(&'static str, String)],
            _body: Body,
        ) -> Result<(u16, Value), String> {
            panic!("must not send")
        }
    }
    let run = |a: &str, dev: &str, p: Value| {
        tauri::async_runtime::block_on(account_call(&Never, "ACCESS", dev, a, p)).unwrap_err()
    };
    assert_eq!(run("drop_all", DEV, json!({})), "INVALID_REQUEST");
    assert_eq!(run("usage", "x", json!({})), "INVALID_REQUEST");
    assert_eq!(run("usage", DEV, json!([])), "INVALID_REQUEST");
}
