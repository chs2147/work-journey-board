// 가짜 gateway로 온라인 공간 캐시 규칙을 본다(실제 네트워크 없음)
use super::*;
use std::cell::RefCell;
use std::collections::HashMap;

const WS: &str = "33333333-3333-4333-8333-333333333333";
const OBJ: &str = "44444444-4444-4444-8444-444444444444";
const DEV: &str = "11111111-1111-4111-8111-111111111111";
const OWNER: &str = "55555555-5555-4555-8555-555555555555";

struct Fake {
    records: Vec<Value>,
    image: Vec<u8>,
    mh: String,
    down: RefCell<bool>,
    calls: RefCell<Vec<String>>,
    corrupt: bool,
}
impl Fake {
    fn new(n: usize) -> Self {
        let image = vec![9u8; 500];
        Self {
            records: (0..n).map(|i| json!({ "table": "entry_item", "key": format!("{i:064x}"), "value": { "id": i } })).collect(),
            image,
            mh: "a".repeat(64),
            down: RefCell::new(false),
            calls: RefCell::new(vec![]),
            corrupt: false,
        }
    }
}
impl Gateway for Fake {
    async fn send(
        &self,
        _m: &'static str,
        path: &str,
        bearer: &str,
        _h: &[(&'static str, String)],
        body: Body,
    ) -> Result<(u16, Value), String> {
        assert_eq!(bearer, "ACCESS");
        assert!(crate::online::path_allowed(path));
        self.calls
            .borrow_mut()
            .push(path.rsplit('/').next().unwrap().to_string());
        if *self.down.borrow() {
            return Err("NETWORK".into());
        }
        let Body::Json(b) = body else { panic!() };
        let req: Value = serde_json::from_slice(&b).unwrap();
        assert_eq!(req["deviceId"], json!(DEV));
        let p = &req["params"];
        Ok(match path.rsplit('/').next().unwrap() {
            "list" => (200, json!({ "workspaces": [{ "workspaceId": WS }] })),
            "header" => (
                200,
                json!({ "workspaceId": WS, "manifestHash": self.mh, "records": self.records.len(), "createdAt": "2026-11-15T00:00:00Z",
                "header": { "sourceSchema": 20 }, "assets": [{ "objectId": OBJ, "sha256": hex(&self.image), "bytes": self.image.len() }] }),
            ),
            "records" => {
                assert_eq!(p["manifestHash"], json!(self.mh));
                let start = match p["after"].as_array() {
                    None => 0,
                    Some(a) => self.records.iter().position(|r| r["key"] == a[1]).unwrap() + 1,
                };
                let lim = p["limit"].as_u64().unwrap() as usize;
                let end = (start + lim).min(self.records.len());
                let more = end < self.records.len();
                let next = if more {
                    json!(["entry_item", self.records[end - 1]["key"]])
                } else {
                    Value::Null
                };
                (
                    200,
                    json!({ "records": self.records[start..end], "more": more, "next": next }),
                )
            }
            _ => (404, json!({ "error": "NOT_FOUND" })),
        })
    }
}
impl Download for Fake {
    async fn get_bytes(
        &self,
        path: &str,
        _b: &str,
        h: &[(&'static str, String)],
        _max: usize,
    ) -> Result<(u16, Vec<u8>), String> {
        assert!(path.ends_with(&format!("/v2/workspaces/{WS}/assets/{OBJ}/content")));
        assert!(h.contains(&("x-wjb-device-id", DEV.to_string())));
        self.calls.borrow_mut().push("asset".into());
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
fn tmp() -> PathBuf {
    std::env::temp_dir().join(format!("wjb-space-{}", uuid::Uuid::new_v4()))
}

#[test]
fn sync_pages_records_downloads_assets_and_marks_complete_last() {
    let root = tmp();
    let dir = space_dir(&root, OWNER, WS).unwrap();
    let gw = Fake::new(2_345);
    let r = run(sync(&gw, "ACCESS", DEV, &dir, WS, 7)).unwrap();
    assert_eq!(r["records"], json!(2_345));
    assert_eq!(r["downloaded"], json!(1));
    assert_eq!(
        gw.calls.borrow().iter().filter(|c| *c == "records").count(),
        3
    );
    let recs: Vec<Value> =
        serde_json::from_slice(&read_file(&dir, "records.json").unwrap()).unwrap();
    assert_eq!(recs, gw.records);
    // 캐시 JSON에는 그림 본문이 없다(파일로만)
    assert!(!String::from_utf8(read_file(&dir, "records.json").unwrap())
        .unwrap()
        .contains("CQkJ"));
    assert_eq!(
        read_file(&dir, &format!("{}.bin", hex(&gw.image))).unwrap(),
        gw.image
    );
    // 같은 manifest면 다시 받지 않는다
    gw.calls.borrow_mut().clear();
    let r2 = run(sync(&gw, "ACCESS", DEV, &dir, WS, 8)).unwrap();
    assert_eq!(r2["fromCache"], json!(true));
    assert_eq!(*gw.calls.borrow(), vec!["header".to_string()]);
    // 서버에 닿지 못하면 완성 캐시(stale)
    *gw.down.borrow_mut() = true;
    let r3 = run(sync(&gw, "ACCESS", DEV, &dir, WS, 9)).unwrap();
    assert_eq!(r3["stale"], json!(true));
    assert_eq!(cached(&root, OWNER).len(), 1);
    assert!(cached(&root, "66666666-6666-4666-8666-666666666666").is_empty());
    remove(&dir).unwrap();
    assert!(cached(&root, OWNER).is_empty());
    fs::remove_dir_all(&root).ok();
}

#[test]
fn corrupt_image_or_missing_cache_is_refused() {
    let root = tmp();
    let dir = space_dir(&root, OWNER, WS).unwrap();
    let mut gw = Fake::new(10);
    gw.corrupt = true;
    assert_eq!(
        run(sync(&gw, "ACCESS", DEV, &dir, WS, 1)).unwrap_err(),
        "INTEGRITY_MISMATCH"
    );
    // 완성 표시 없음 → 읽기 거절, 오프라인 대체도 없음
    assert_eq!(
        read_file(&dir, "records.json").unwrap_err(),
        "CACHE_INCOMPLETE"
    );
    *gw.down.borrow_mut() = true;
    assert_eq!(
        run(sync(&gw, "ACCESS", DEV, &dir, WS, 1)).unwrap_err(),
        "NETWORK"
    );
    // 이름·ID 검사
    assert_eq!(read_file(&dir, "../x").unwrap_err(), "INVALID_REQUEST");
    assert!(space_dir(&root, OWNER, "../x").is_err());
    fs::remove_dir_all(&root).ok();
}
