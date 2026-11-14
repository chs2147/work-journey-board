// 가짜 서버(요청 기록·정해 둔 응답)와 메모리 보안 저장소로 로그인 흐름을 본다. 실제 네트워크·OS 저장소 없음
use super::*;
use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::rc::Rc;
use wjb_native_isolation::vault::CredentialKey;

#[derive(Default, Clone)]
struct Mem(Rc<RefCell<(HashMap<CredentialKey, String>, bool)>>);
impl SecureVault for Mem {
    fn read(&mut self, k: &CredentialKey) -> wjb_native_isolation::Result<Option<Secret>> {
        let s = self.0.borrow();
        if s.1 {
            return Err(VaultError::UnsupportedPlatform);
        }
        Ok(s.0
            .get(k)
            .map(|v| Secret::new(v.as_bytes().to_vec()).unwrap()))
    }
    fn write(&mut self, k: &CredentialKey, t: &Secret) -> wjb_native_isolation::Result<()> {
        let mut s = self.0.borrow_mut();
        if s.1 {
            return Err(VaultError::UnsupportedPlatform);
        }
        s.0.insert(k.clone(), t.with_str(str::to_owned));
        Ok(())
    }
    fn delete(&mut self, k: &CredentialKey) -> wjb_native_isolation::Result<()> {
        let mut s = self.0.borrow_mut();
        if s.1 {
            return Err(VaultError::UnsupportedPlatform);
        }
        s.0.remove(k);
        Ok(())
    }
}
impl Mem {
    fn tokens(&self) -> Vec<String> {
        self.0.borrow().0.values().cloned().collect()
    }
    fn keys(&self) -> Vec<String> {
        self.0
            .borrow()
            .0
            .keys()
            .map(|k| format!("{}|{}", k.service(), k.account()))
            .collect()
    }
}

#[derive(Default)]
struct Fake {
    replies: RefCell<VecDeque<(u16, Value)>>,
    seen: RefCell<Vec<(String, String, Option<String>, Option<Value>)>>,
}
impl Fake {
    fn reply(self, s: u16, v: Value) -> Self {
        self.replies.borrow_mut().push_back((s, v));
        self
    }
    fn paths(&self) -> Vec<String> {
        self.seen
            .borrow()
            .iter()
            .map(|r| format!("{} {}", r.0, r.1))
            .collect()
    }
}
impl Http for Fake {
    async fn send(
        &self,
        method: &'static str,
        path: &str,
        bearer: Option<&str>,
        body: Option<Value>,
    ) -> Result<(u16, Value), String> {
        assert!(path_allowed(path), "허용되지 않은 경로 {path}");
        self.seen
            .borrow_mut()
            .push((method.into(), path.into(), bearer.map(str::to_owned), body));
        self.replies
            .borrow_mut()
            .pop_front()
            .ok_or_else(|| "NETWORK".to_string())
    }
}

const USER: &str = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
fn session(access: &str, refresh: &str) -> Value {
    json!({ "access_token": access, "refresh_token": refresh, "expires_in": 3600, "user": { "id": USER, "email": "virtual@example.invalid" } })
}
fn me() -> Value {
    json!({ "accountId": USER, "sessionActive": true, "project": "development" })
}
fn store() -> (Store, tempdir::Dir) {
    let d = tempdir::Dir::new();
    (Store::new(d.0.join("development").join(PROJECT_REF)), d)
}
mod tempdir {
    pub struct Dir(pub std::path::PathBuf);
    impl Dir {
        pub fn new() -> Self {
            let p = std::env::temp_dir().join(format!("wjb-online-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
fn run<F: std::future::Future>(f: F) -> F::Output {
    tauri::async_runtime::block_on(f)
}

#[test]
fn input_checks_happen_before_any_request() {
    let http = Fake::default();
    let (st, _d) = store();
    let state = OnlineState::default();
    assert_eq!(
        run(send_code(&http, "not-an-email")),
        Err("INVALID_EMAIL".into())
    );
    assert_eq!(
        run(verify_code(&http, &st, &state, "a@b.co", "12ab56", || Ok(
            Mem::default()
        ))),
        Err("INVALID_CODE".into())
    );
    assert!(http.paths().is_empty());
    assert!(valid_code("12345678") && !valid_code("12345") && !valid_email("a b@c.d"));
    assert!(
        !path_allowed("/rest/v1/anything")
            && !path_allowed("/functions/v1/other")
            && !path_allowed("/auth/v1/../rest")
    );
}

#[test]
fn sign_in_keeps_refresh_token_only_in_vault_and_checks_gateway() {
    let http = Fake::default()
        .reply(200, json!({}))
        .reply(200, session("A1", "R1"))
        .reply(200, me());
    let (st, _d) = store();
    let state = OnlineState::default();
    let vault = Mem::default();
    run(send_code(&http, " virtual@example.invalid ")).unwrap();
    let s = run(verify_code(
        &http,
        &st,
        &state,
        "virtual@example.invalid",
        "12345678",
        || Ok(vault.clone()),
    ))
    .unwrap();
    assert_eq!(s.state, "signedIn");
    assert_eq!(s.account_id.as_deref(), Some(USER));
    assert!(s.server_checked_at.is_some());
    assert_eq!(
        http.paths(),
        [
            "POST /auth/v1/otp",
            "POST /auth/v1/verify",
            "GET /functions/v1/wjb-gateway/v2/me"
        ]
    );
    let seen = http.seen.borrow();
    assert_eq!(
        seen[0].3,
        Some(json!({ "email": "virtual@example.invalid", "create_user": true }))
    );
    assert_eq!(
        seen[1].3,
        Some(json!({ "type": "email", "email": "virtual@example.invalid", "token": "12345678" }))
    );
    assert_eq!(seen[2].2.as_deref(), Some("A1"));
    // 갱신 토큰은 보안 저장소에만, 열쇠 = Preview 서비스 + 개발 프로젝트·계정·기기
    assert_eq!(vault.tokens(), ["R1"]);
    let key = &vault.keys()[0];
    assert!(key.starts_with(
        "com.chs2147.workjourneyboard.connected.preview.auth.v1|development:vsphftnmfzfoufasjttd:"
    ));
    assert!(key.contains(USER));
    // 파일에는 토큰이 없다
    for name in ["account.json", "device.json"] {
        let text = std::fs::read_to_string(st.path().join(name)).unwrap();
        assert!(!text.contains("R1") && !text.contains("A1"), "{name}");
    }
    // 화면에 넘기는 값에도 없다
    let json = serde_json::to_string(&s).unwrap();
    assert!(!json.contains("A1") && !json.contains("R1"));
}

#[test]
fn restart_refreshes_with_vault_token_and_stores_the_rotated_one() {
    let (st, _d) = store();
    let vault = Mem::default();
    let http = Fake::default()
        .reply(200, session("A1", "R1"))
        .reply(200, me());
    run(verify_code(
        &http,
        &st,
        &OnlineState::default(),
        "virtual@example.invalid",
        "12345678",
        || Ok(vault.clone()),
    ))
    .unwrap();
    // 앱을 다시 켬 = 메모리 상태 없음
    let state = OnlineState::default();
    let s = run(status(&st, &state, || Ok(vault.clone())));
    assert_eq!((s.state, s.server_checked_at), ("signedIn", None));
    let http = Fake::default()
        .reply(200, session("A2", "R2"))
        .reply(200, me());
    let s = run(check(&http, &st, &state, || Ok(vault.clone()))).unwrap();
    assert!(s.server_checked_at.is_some());
    assert_eq!(
        http.paths(),
        [
            "POST /auth/v1/token?grant_type=refresh_token",
            "GET /functions/v1/wjb-gateway/v2/me"
        ]
    );
    assert_eq!(
        http.seen.borrow()[0].3,
        Some(json!({ "refresh_token": "R1" }))
    );
    assert_eq!(vault.tokens(), ["R2"]);
}

#[test]
fn server_revoked_session_signs_out_this_device_only() {
    let (st, _d) = store();
    let vault = Mem::default();
    let state = OnlineState::default();
    let http = Fake::default()
        .reply(200, session("A1", "R1"))
        .reply(200, me());
    run(verify_code(
        &http,
        &st,
        &state,
        "virtual@example.invalid",
        "12345678",
        || Ok(vault.clone()),
    ))
    .unwrap();
    let device = st.device_id().unwrap();
    // 다른 계정의 토큰(같은 저장소)은 건드리지 않는다
    let other = "0a0b0c0d-0e0f-4a1b-8c2d-3e4f5a6b7c8d";
    let mut ov = super::vault(&st, other, || Ok(vault.clone())).unwrap();
    ov.write_refresh_token(&secret("OTHER").unwrap()).unwrap();
    let http = Fake::default().reply(401, json!({ "error": "ACCESS_REVOKED" }));
    assert_eq!(
        run(check(&http, &st, &state, || Ok(vault.clone()))),
        Err("ACCESS_REVOKED".into())
    );
    assert_eq!(vault.tokens(), ["OTHER"]);
    assert_eq!(
        run(status(&st, &state, || Ok(vault.clone()))).state,
        "signedOut"
    );
    assert_eq!(st.device_id().unwrap(), device, "기기 ID는 유지");
}

#[test]
fn expired_refresh_token_signs_out_and_network_errors_keep_login() {
    let (st, _d) = store();
    let vault = Mem::default();
    let http = Fake::default()
        .reply(200, session("A1", "R1"))
        .reply(200, me());
    run(verify_code(
        &http,
        &st,
        &OnlineState::default(),
        "virtual@example.invalid",
        "12345678",
        || Ok(vault.clone()),
    ))
    .unwrap();
    // 서버 응답 없음(네트워크) → 로그인 유지
    let state = OnlineState::default();
    assert_eq!(
        run(check(&Fake::default(), &st, &state, || Ok(vault.clone()))),
        Err("NETWORK".into())
    );
    assert_eq!(vault.tokens(), ["R1"]);
    // 503 → 유지
    let http = Fake::default().reply(503, json!({}));
    assert_eq!(
        run(check(&http, &st, &state, || Ok(vault.clone()))),
        Err("SERVER_UNAVAILABLE".into())
    );
    assert_eq!(vault.tokens(), ["R1"]);
    // 갱신 토큰 거절 → 이 기기 로그아웃
    let http = Fake::default().reply(400, json!({ "error_code": "refresh_token_not_found" }));
    assert_eq!(
        run(check(&http, &st, &state, || Ok(vault.clone()))),
        Err("SIGNED_OUT".into())
    );
    assert!(vault.tokens().is_empty());
    assert_eq!(
        run(status(&st, &state, || Ok(vault.clone()))).state,
        "signedOut"
    );
}

#[test]
fn without_os_vault_login_is_refused_and_server_session_closed() {
    let (st, _d) = store();
    let state = OnlineState::default();
    let vault = Mem::default();
    vault.0.borrow_mut().1 = true; // Linux 등 = 보안 저장소 없음
    let http = Fake::default()
        .reply(200, session("A1", "R1"))
        .reply(204, Value::Null);
    let r = run(verify_code(
        &http,
        &st,
        &state,
        "virtual@example.invalid",
        "12345678",
        || Ok(vault.clone()),
    ));
    assert_eq!(r, Err("VAULT_UNAVAILABLE".into()));
    assert_eq!(
        http.paths(),
        ["POST /auth/v1/verify", "POST /auth/v1/logout?scope=local"]
    );
    assert_eq!(http.seen.borrow()[1].2.as_deref(), Some("A1"));
    assert!(!st.path().join("account.json").exists());
    assert_eq!(
        run(status(&st, &state, || Ok(vault.clone()))).state,
        "signedOut"
    );
}

#[test]
fn sign_out_closes_server_session_and_removes_only_this_token() {
    let (st, _d) = store();
    let vault = Mem::default();
    let state = OnlineState::default();
    let http = Fake::default()
        .reply(200, session("A1", "R1"))
        .reply(200, me());
    run(verify_code(
        &http,
        &st,
        &state,
        "virtual@example.invalid",
        "12345678",
        || Ok(vault.clone()),
    ))
    .unwrap();
    let http = Fake::default().reply(204, Value::Null);
    assert_eq!(
        run(sign_out(&http, &st, &state, || Ok(vault.clone())))
            .unwrap()
            .state,
        "signedOut"
    );
    assert_eq!(http.paths(), ["POST /auth/v1/logout?scope=local"]);
    assert!(vault.tokens().is_empty());
    assert!(st.path().join("device.json").exists());
    assert!(!st.path().join("account.json").exists());
}

#[test]
fn gateway_answer_for_another_account_is_rejected() {
    let (st, _d) = store();
    let http = Fake::default().reply(200, session("A1", "R1")).reply(
        200,
        json!({ "accountId": "0a0b0c0d-0e0f-4a1b-8c2d-3e4f5a6b7c8d", "sessionActive": true }),
    );
    let r = run(verify_code(
        &http,
        &st,
        &OnlineState::default(),
        "virtual@example.invalid",
        "12345678",
        || Ok(Mem::default()),
    ));
    assert_eq!(r, Err("ACCOUNT_MISMATCH".into()));
}

/// 실서버 왕복(개발 프로젝트) — 평소에는 건너뛴다. `poc/v2-gateway/edge/live-preview-auth.mjs`가
/// 가상 시험 계정과 인증번호(관리 API, 메일 없음)를 만들어 이 시험만 돌리고, 끝나면 계정을 지운다.
/// 보안 저장소만 메모리 가짜(Linux), HTTP·인증 서버·gateway·세션 확인 RPC는 실제.
#[test]
#[ignore]
fn live_development_round_trip() {
    let email = std::env::var("WJB_LIVE_EMAIL").expect("WJB_LIVE_EMAIL");
    let code = std::env::var("WJB_LIVE_OTP").expect("WJB_LIVE_OTP");
    let http = Reqwest::new("live-test").unwrap();
    let (st, _d) = store();
    let state = OnlineState::default();
    let vault = Mem::default();
    let mut out = Vec::<(String, bool)>::new();
    let mut ok = |name: &str, pass: bool| {
        println!("LIVE_CHECK {name} {pass}");
        out.push((name.into(), pass));
    };
    // 1) 인증번호 로그인 → gateway 세션 확인
    let s = run(verify_code(&http, &st, &state, &email, &code, || {
        Ok(vault.clone())
    }));
    ok(
        "verify_signed_in",
        matches!(&s, Ok(s) if s.state == "signedIn"),
    );
    ok(
        "gateway_me_checked",
        matches!(&s, Ok(s) if s.server_checked_at.is_some()),
    );
    ok(
        "refresh_token_in_vault_only",
        vault.tokens().len() == 1
            && !std::fs::read_to_string(st.path().join("account.json"))
                .unwrap_or_default()
                .contains(&vault.tokens()[0]),
    );
    let r1 = vault.tokens()[0].clone();
    // 2) 접근 토큰 만료로 두고 다시 확인 → 실제 갱신·회전
    run(async { state.0.lock().await.as_mut().unwrap().access_exp = 0 });
    let s = run(check(&http, &st, &state, || Ok(vault.clone())));
    ok(
        "refresh_then_me",
        matches!(&s, Ok(s) if s.server_checked_at.is_some()),
    );
    ok(
        "refresh_token_rotated",
        vault.tokens().len() == 1 && vault.tokens()[0] != r1,
    );
    let a2 = run(async { state.0.lock().await.as_ref().unwrap().access.clone() });
    // 3) 로그아웃 → 같은 접근 토큰으로 gateway = 세션 끊김(ACCESS_REVOKED)
    let s = run(sign_out(&http, &st, &state, || Ok(vault.clone())));
    ok(
        "sign_out",
        matches!(&s, Ok(s) if s.state == "signedOut") && vault.tokens().is_empty(),
    );
    let after = run(http.send("GET", GATEWAY_ME, Some(&a2), None));
    ok(
        "revoked_after_sign_out",
        matches!(&after, Ok((401, v)) if v["error"] == json!("ACCESS_REVOKED")),
    );
    // 4) 틀린 인증번호 거절
    let bad = run(verify_code(
        &http,
        &st,
        &OnlineState::default(),
        &email,
        "00000000",
        || Ok(Mem::default()),
    ));
    ok("wrong_code_rejected", bad == Err("CODE_REJECTED".into()));
    assert!(out.iter().all(|(_, p)| *p), "{out:?}");
}
