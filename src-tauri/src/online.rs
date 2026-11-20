//! Connected Preview 온라인 계정(V2 B단계, docs/v2-design/79-preview-dev-connection.md). **Preview 빌드에만 있다.**
//! - 접속 대상은 이 판의 서버 한 곳(`server()` — 검증판 = 개발 프로젝트, G-3)의 인증(`/auth/v1/`)과 gateway(`/functions/v1/wjb-gateway/`)뿐.
//!   웹 화면은 네트워크를 쓰지 않는다(CSP 그대로) — 모든 요청은 여기 Rust에서.
//! - 갱신 토큰은 OS 보안 저장소(Windows Credential Manager·macOS Keychain)에만. 파일·화면으로 보내지 않는다.
//!   접근 토큰은 메모리에만. 화면에는 이메일·계정 ID·서버 확인 시각만 넘긴다.
//! - 앱에 넣는 키는 공개 키(publishable)뿐 — 서버 전용 열쇠·관리 토큰은 넣지 않는다.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use wjb_native_isolation::policy::{CloudEnv, CloudTarget, Profile, WorkspaceKind};
use wjb_native_isolation::vault::{AccountScope, Secret, SecureVault, SessionVault};
use wjb_native_isolation::Error as VaultError;

const GATEWAY_ME: &str = "/functions/v1/wjb-gateway/v2/me";

/// G-3(docs/v2-design/97): 접속 서버는 허용 목록(개발·운영) 중 하나이고, 판(프로필)마다 하나로 고정한다.
/// 프로젝트 ID는 격리 라이브러리의 `CloudTarget`(개발·운영 두 개만)과 같아야 하고, 주소는 그 ID에서만 만든다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Server {
    pub env: CloudEnv,
    pub project_ref: &'static str,
    pub origin: &'static str,
    /// 공개 키(publishable) — 비밀 아님. 없으면(운영 구축 G-2 전) 그 서버에는 접속하지 않는다
    pub publishable_key: Option<&'static str>,
}
pub const DEVELOPMENT: Server = Server {
    env: CloudEnv::Development,
    project_ref: "vsphftnmfzfoufasjttd",
    origin: "https://vsphftnmfzfoufasjttd.supabase.co",
    publishable_key: Some("sb_publishable_HgCrm5uiNX4v7Ppw0yowMQ_MREt7E5l"),
};
/// 운영(G-D2) — G-2 구축 완료(103, 2026-11-20) 뒤 공개 키를 넣었다. 정식판만 이 서버를 고른다
pub const PRODUCTION: Server = Server {
    env: CloudEnv::Production,
    project_ref: "hutqsfftioxtredcjhsy",
    origin: "https://hutqsfftioxtredcjhsy.supabase.co",
    publishable_key: Some("sb_publishable_OASPLXRLV8DZaCjrP-l9Qw_OUgR2WTp"),
};
impl Server {
    /// 표의 값이 서로 맞는지(ID = 허용 목록, 주소 = 그 ID, 공개 키 형식)
    pub fn check(&self) -> Result<CloudTarget, &'static str> {
        let t = CloudTarget::new(self.env, self.project_ref).map_err(|_| "SERVER_NOT_ALLOWED")?;
        if self.origin != format!("https://{}.supabase.co", self.project_ref) {
            return Err("SERVER_ORIGIN_MISMATCH");
        }
        match self.publishable_key {
            Some(k) if !k.starts_with("sb_publishable_") => Err("SERVER_KEY_INVALID"),
            None => Err("SERVER_NOT_READY"),
            _ => Ok(t),
        }
    }
}
/// 판 → 서버(하나). 검증판(Preview·DEV) = 개발, 정식판 = 운영(G-9) — 섞이지 않는다
pub fn server_for(profile: Profile) -> Result<Server, &'static str> {
    match profile {
        Profile::ConnectedPreview | Profile::LocalDev => Ok(DEVELOPMENT),
        Profile::Classic => Ok(PRODUCTION),
    }
}
/// 이 빌드의 서버 — 표가 맞지 않으면 접속하지 않는다(시작할 때가 아니라 요청마다 확인, 패닉 없음)
pub(crate) fn server() -> Result<(Server, CloudTarget), String> {
    let s = server_for(app_profile()).map_err(str::to_string)?;
    let t = s.check().map_err(str::to_string)?;
    Ok((s, t))
}

/// 이 빌드의 프로필 — 설정 폴더·보안 저장소 이름·서버가 판마다 따로(Preview·DEV·정식판이 겹치지 않음, 98)
fn app_profile() -> Profile {
    if cfg!(feature = "dev-channel") {
        Profile::LocalDev
    } else if cfg!(feature = "connected-preview") {
        Profile::ConnectedPreview
    } else {
        Profile::Classic
    }
}
fn target() -> Result<CloudTarget, String> {
    server().map(|(_, t)| t)
}
/// 접속 주소와 공개 키(요청마다)
pub(crate) fn endpoint() -> Result<(&'static str, &'static str), String> {
    let (s, _) = server()?;
    Ok((s.origin, s.publishable_key.unwrap_or_default()))
}
/// 요청 표시(이름만, 판·계정 정보 없음)
pub(crate) fn user_agent(version: &str) -> String {
    format!("WorkJourneyBoard/{version}")
}

/// 화면에 넘기는 상태(토큰 없음)
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// "signedOut" | "signedIn" | "vaultUnavailable"
    pub state: &'static str,
    pub email: Option<String>,
    pub account_id: Option<String>,
    /// gateway가 세션을 확인한 시각(유닉스 초) — 없으면 아직 확인 전
    pub server_checked_at: Option<u64>,
}
impl Status {
    fn signed_out() -> Self {
        Self {
            state: "signedOut",
            email: None,
            account_id: None,
            server_checked_at: None,
        }
    }
}

/// 요청 하나 — 주소는 ORIGIN 아래 허용 경로만
#[allow(async_fn_in_trait)]
pub trait Http {
    async fn send(
        &self,
        method: &'static str,
        path: &str,
        bearer: Option<&str>,
        body: Option<Value>,
    ) -> Result<(u16, Value), String>;
}

pub fn path_allowed(path: &str) -> bool {
    (path.starts_with("/auth/v1/") || path.starts_with("/functions/v1/wjb-gateway/"))
        && !path.contains("..")
        && !path.contains("//")
}

/// 실제 HTTP(reqwest) — 리디렉션 따라가지 않음, 시간 제한
pub struct Reqwest(reqwest::Client);
impl Reqwest {
    pub fn new(version: &str) -> Result<Self, String> {
        reqwest::Client::builder()
            .user_agent(user_agent(version))
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map(Self)
            .map_err(|_| "NETWORK".to_string())
    }
}
impl Http for Reqwest {
    async fn send(
        &self,
        method: &'static str,
        path: &str,
        bearer: Option<&str>,
        body: Option<Value>,
    ) -> Result<(u16, Value), String> {
        if !path_allowed(path) {
            return Err("DESTINATION_DENIED".into());
        }
        let (origin, key) = endpoint()?;
        let url = format!("{origin}{path}");
        let mut req = match method {
            "GET" => self.0.get(&url),
            _ => self.0.post(&url),
        }
        .header("apikey", key)
        .header("cache-control", "no-store");
        if let Some(b) = bearer {
            req = req.header("authorization", format!("Bearer {b}"));
        }
        if let Some(v) = body {
            req = req
                .header("content-type", "application/json")
                .body(v.to_string());
        }
        let res = req.send().await.map_err(|_| "NETWORK".to_string())?;
        let status = res.status().as_u16();
        let bytes = res.bytes().await.map_err(|_| "NETWORK".to_string())?;
        if bytes.len() > 65536 {
            return Err("RESPONSE_TOO_LARGE".into());
        }
        Ok((
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        ))
    }
}

/// 이 기기·계정의 비밀 아닌 기록: 기기 ID, 마지막 로그인 계정(ID·이메일). Preview 설정 폴더 아래 개발 프로젝트 폴더에만
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Account {
    owner_id: String,
    email: String,
}
pub struct Store {
    root: PathBuf,
}
impl Store {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn write_atomic(&self, name: &str, value: &Value) -> Result<(), String> {
        fs::create_dir_all(&self.root).map_err(|_| "STORE".to_string())?;
        let path = self.root.join(name);
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, value.to_string()).map_err(|_| "STORE".to_string())?;
        fs::rename(&tmp, &path).map_err(|_| "STORE".to_string())
    }
    fn read(&self, name: &str) -> Option<Value> {
        serde_json::from_slice(&fs::read(self.root.join(name)).ok()?).ok()
    }
    pub fn device_id(&self) -> Result<String, String> {
        if let Some(id) = self
            .read("device.json")
            .and_then(|v| v["deviceId"].as_str().map(str::to_owned))
            .filter(|s| is_uuid(s))
        {
            return Ok(id);
        }
        let id = uuid::Uuid::new_v4().to_string();
        self.write_atomic("device.json", &json!({ "deviceId": id }))?;
        Ok(id)
    }
    /// 서버(gateway)에 등록하는 기기 ID — **계정마다 따로**(서버는 한 기기 ID를 한 계정에만 묶는다).
    /// 처음 쓰는 계정은 예전 PC 기기 ID(`device.json`)를 이어받고(다른 계정이 이미 쓰지 않을 때), 아니면 새로 만든다.
    /// 보안 저장소 범위는 예전처럼 PC 기기 ID(`device_id`)를 쓴다 — 바꾸면 저장된 로그인이 풀린다.
    /// (2026-11-16 실기: 같은 PC에서 두 번째 계정이 기기 등록을 거절당해 목록을 못 받던 문제)
    pub fn gateway_device_id(&self, owner: &str) -> Result<String, String> {
        if !is_uuid(owner) {
            return Err("INVALID_ACCOUNT".into());
        }
        let mut map = self
            .read("gateway-devices.json")
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        if let Some(id) = map
            .get(owner)
            .and_then(|v| v.as_str())
            .filter(|s| is_uuid(s))
        {
            return Ok(id.to_string());
        }
        let legacy = self.device_id()?;
        let taken = map.values().any(|v| v.as_str() == Some(legacy.as_str()));
        let id = if taken {
            uuid::Uuid::new_v4().to_string()
        } else {
            legacy
        };
        map.insert(owner.to_string(), json!(id));
        self.write_atomic("gateway-devices.json", &Value::Object(map))?;
        Ok(id)
    }
    /// 서버가 그 기기 ID를 다른 계정 것이라고 거절했을 때 — 이 계정용 새 ID
    pub fn reset_gateway_device_id(&self, owner: &str) -> Result<String, String> {
        if !is_uuid(owner) {
            return Err("INVALID_ACCOUNT".into());
        }
        let mut map = self
            .read("gateway-devices.json")
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        let id = uuid::Uuid::new_v4().to_string();
        map.insert(owner.to_string(), json!(id));
        self.write_atomic("gateway-devices.json", &Value::Object(map))?;
        Ok(id)
    }
    fn account(&self) -> Option<Account> {
        let a: Account = serde_json::from_value(self.read("account.json")?).ok()?;
        is_uuid(&a.owner_id).then_some(a)
    }
    fn set_account(&self, a: &Account) -> Result<(), String> {
        self.write_atomic(
            "account.json",
            &serde_json::to_value(a).map_err(|_| "STORE".to_string())?,
        )
    }
    fn clear_account(&self) {
        let _ = fs::remove_file(self.root.join("account.json"));
    }
    pub(crate) fn root(&self) -> &std::path::Path {
        &self.root
    }
    pub(crate) fn owner_id(&self) -> Option<String> {
        self.account().map(|a| a.owner_id)
    }
    #[cfg(test)]
    fn path(&self) -> &std::path::Path {
        &self.root
    }
}

pub(crate) fn is_uuid(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_digit() || (b'a'..=b'f').contains(&c)
            }
        })
}
pub fn valid_email(e: &str) -> bool {
    let e = e.trim();
    e.len() <= 254
        && !e.chars().any(|c| c.is_whitespace() || c.is_control())
        && matches!(e.split_once('@'), Some((l, d)) if !l.is_empty() && d.contains('.') && !d.starts_with('.') && !d.ends_with('.') && !d.contains('@'))
}
pub fn valid_code(c: &str) -> bool {
    (6..=10).contains(&c.len()) && c.bytes().all(|b| b.is_ascii_digit())
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 메모리에만 있는 접근 토큰
struct Live {
    owner: String,
    email: String,
    access: String,
    access_exp: u64,
    checked_at: Option<u64>,
}
#[derive(Default)]
pub struct OnlineState(tauri::async_runtime::Mutex<Option<Live>>);

fn vault<B: SecureVault>(
    store: &Store,
    owner: &str,
    factory: impl FnOnce() -> wjb_native_isolation::Result<B>,
) -> Result<SessionVault<B>, String> {
    let device = store.device_id()?;
    let scope =
        AccountScope::new(target()?, owner, &device).map_err(|_| "INVALID_ACCOUNT".to_string())?;
    SessionVault::new(app_profile(), WorkspaceKind::Online, scope, factory).map_err(vault_err)
}
fn vault_err(e: VaultError) -> String {
    match e {
        VaultError::UnsupportedPlatform | VaultError::VaultUnavailable => {
            "VAULT_UNAVAILABLE".into()
        }
        _ => "VAULT".into(),
    }
}
fn secret(s: &str) -> Result<Secret, String> {
    Secret::new(s.as_bytes().to_vec()).map_err(|_| "INVALID_TOKEN".to_string())
}

/// 인증 서버 응답(verify·refresh)에서 필요한 것만
struct Tokens {
    access: String,
    refresh: String,
    exp: u64,
    user_id: String,
    email: String,
}
fn tokens(v: &Value) -> Option<Tokens> {
    let access = v["access_token"].as_str()?.to_owned();
    let refresh = v["refresh_token"].as_str()?.to_owned();
    let exp = v["expires_at"]
        .as_u64()
        .or_else(|| v["expires_in"].as_u64().map(|s| now() + s))?;
    let user_id = v["user"]["id"].as_str()?.to_lowercase();
    let email = v["user"]["email"].as_str().unwrap_or("").to_owned();
    (is_uuid(&user_id) && !access.is_empty() && !refresh.is_empty()).then_some(Tokens {
        access,
        refresh,
        exp,
        user_id,
        email,
    })
}

pub async fn status<B: SecureVault>(
    store: &Store,
    state: &OnlineState,
    factory: impl FnOnce() -> wjb_native_isolation::Result<B>,
) -> Status {
    if let Some(l) = state.0.lock().await.as_ref() {
        return Status {
            state: "signedIn",
            email: Some(l.email.clone()),
            account_id: Some(l.owner.clone()),
            server_checked_at: l.checked_at,
        };
    }
    let Some(a) = store.account() else {
        return Status::signed_out();
    };
    match vault(store, &a.owner_id, factory)
        .and_then(|mut v| v.read_refresh_token().map_err(vault_err))
    {
        Ok(Some(_)) => Status {
            state: "signedIn",
            email: Some(a.email),
            account_id: Some(a.owner_id),
            server_checked_at: None,
        },
        Ok(None) => Status::signed_out(),
        Err(e) if e == "VAULT_UNAVAILABLE" => Status {
            state: "vaultUnavailable",
            email: Some(a.email),
            account_id: None,
            server_checked_at: None,
        },
        Err(_) => Status::signed_out(),
    }
}

/// 가입을 막아 둔(초대 전용) 서버가 처음 보는 이메일을 거절한 응답인가 — 수파베이스 `signup_disabled`
/// (docs/v2-design/94: 초대한 사람만 — 관리 도구로 계정을 미리 만들고, 스위치로 아무나 가입 전환)
pub fn is_signup_disabled(status: u16, body: &Value) -> bool {
    if !(400..500).contains(&status) {
        return false;
    }
    let code = body["error_code"]
        .as_str()
        .or(body["code"].as_str())
        .unwrap_or("");
    let msg = body["msg"]
        .as_str()
        .or(body["message"].as_str())
        .unwrap_or("");
    code == "signup_disabled" || msg.to_ascii_lowercase().contains("signups not allowed")
}

/// 인증번호 메일 보내기 — 처음이면 계정을 만든다(메일 확인 = 인증번호). 초대 전용 서버면 초대받은(미리 만든) 계정만
pub async fn send_code<H: Http>(http: &H, email: &str) -> Result<(), String> {
    let email = email.trim();
    if !valid_email(email) {
        return Err("INVALID_EMAIL".into());
    }
    match http
        .send(
            "POST",
            "/auth/v1/otp",
            None,
            Some(json!({ "email": email, "create_user": true })),
        )
        .await?
    {
        (200, _) => Ok(()),
        (429, _) => Err("RATE_LIMITED".into()),
        (s, v) if is_signup_disabled(s, &v) => Err("SIGNUP_INVITE_ONLY".into()),
        (s, _) if s >= 500 => Err("SERVER_UNAVAILABLE".into()),
        _ => Err("SEND_FAILED".into()),
    }
}

/// 인증번호 확인 → 갱신 토큰을 보안 저장소에 → 서버(gateway)에서 세션 확인
pub async fn verify_code<H: Http, B: SecureVault>(
    http: &H,
    store: &Store,
    state: &OnlineState,
    email: &str,
    code: &str,
    factory: impl FnOnce() -> wjb_native_isolation::Result<B>,
) -> Result<Status, String> {
    let email = email.trim();
    if !valid_email(email) {
        return Err("INVALID_EMAIL".into());
    }
    if !valid_code(code) {
        return Err("INVALID_CODE".into());
    }
    let t = match http
        .send(
            "POST",
            "/auth/v1/verify",
            None,
            Some(json!({ "type": "email", "email": email, "token": code })),
        )
        .await?
    {
        (200, v) => tokens(&v).ok_or_else(|| "SERVER_RESPONSE".to_string())?,
        (429, _) => return Err("RATE_LIMITED".into()),
        (s, _) if s >= 500 => return Err("SERVER_UNAVAILABLE".into()),
        _ => return Err("CODE_REJECTED".into()),
    };
    // 보안 저장소에 못 넣으면 로그인하지 않는다 — 방금 만든 서버 세션은 닫는다(파일 등 다른 곳에 두지 않음)
    let saved = vault(store, &t.user_id, factory).and_then(|mut v| {
        v.write_refresh_token(&secret(&t.refresh)?)
            .map_err(vault_err)
    });
    if let Err(e) = saved {
        let _ = http
            .send("POST", "/auth/v1/logout?scope=local", Some(&t.access), None)
            .await;
        return Err(e);
    }
    let email = if t.email.is_empty() {
        email.to_owned()
    } else {
        t.email.clone()
    };
    store.set_account(&Account {
        owner_id: t.user_id.clone(),
        email: email.clone(),
    })?;
    *state.0.lock().await = Some(Live {
        owner: t.user_id,
        email,
        access: t.access,
        access_exp: t.exp,
        checked_at: None,
    });
    check_me(http, state).await
}

/// 접근 토큰이 없거나 곧 끝나면 갱신(갱신 토큰은 돌려받은 새 것으로 바꿔 저장)
async fn ensure_access<H: Http, B: SecureVault>(
    http: &H,
    store: &Store,
    state: &OnlineState,
    factory: impl FnOnce() -> wjb_native_isolation::Result<B>,
) -> Result<(), String> {
    if state
        .0
        .lock()
        .await
        .as_ref()
        .is_some_and(|l| l.access_exp > now() + 60)
    {
        return Ok(());
    }
    let a = store.account().ok_or_else(|| "SIGNED_OUT".to_string())?;
    let mut v = vault(store, &a.owner_id, factory)?;
    let Some(refresh) = v.read_refresh_token().map_err(vault_err)? else {
        store.clear_account();
        return Err("SIGNED_OUT".into());
    };
    let body = refresh.with_str(|r| json!({ "refresh_token": r }));
    drop(refresh);
    match http
        .send(
            "POST",
            "/auth/v1/token?grant_type=refresh_token",
            None,
            Some(body),
        )
        .await?
    {
        (200, val) => {
            let t = tokens(&val).ok_or_else(|| "SERVER_RESPONSE".to_string())?;
            if t.user_id != a.owner_id {
                return Err("ACCOUNT_MISMATCH".into());
            }
            v.write_refresh_token(&secret(&t.refresh)?)
                .map_err(vault_err)?;
            let checked_at = state.0.lock().await.as_ref().and_then(|l| l.checked_at);
            *state.0.lock().await = Some(Live {
                owner: t.user_id,
                email: a.email,
                access: t.access,
                access_exp: t.exp,
                checked_at,
            });
            Ok(())
        }
        (s, _) if s >= 500 || s == 429 => Err("SERVER_UNAVAILABLE".into()),
        _ => {
            // 갱신 토큰이 더는 유효하지 않음(다른 곳에서 로그아웃·만료) — 이 기기 로그인만 정리
            let _ = v.logout();
            store.clear_account();
            *state.0.lock().await = None;
            Err("SIGNED_OUT".into())
        }
    }
}

/// 이관 통신(migration.rs)용 — 접근 토큰(필요하면 갱신)과 계정 ID. 토큰은 Rust 안에서만 쓰고 화면에 돌려주지 않는다
pub(crate) async fn access_for<H: Http, B: SecureVault>(
    http: &H,
    store: &Store,
    state: &OnlineState,
    factory: impl FnOnce() -> wjb_native_isolation::Result<B>,
) -> Result<(String, String), String> {
    ensure_access(http, store, state, factory).await?;
    match state.0.lock().await.as_ref() {
        Some(l) => Ok((l.access.clone(), l.owner.clone())),
        None => Err("SIGNED_OUT".into()),
    }
}

/// gateway에 세션 확인(계정 ID가 같아야 함)
async fn check_me<H: Http>(http: &H, state: &OnlineState) -> Result<Status, String> {
    let (access, owner) = match state.0.lock().await.as_ref() {
        Some(l) => (l.access.clone(), l.owner.clone()),
        None => return Err("SIGNED_OUT".into()),
    };
    match http.send("GET", GATEWAY_ME, Some(&access), None).await? {
        (200, v)
            if v["accountId"].as_str() == Some(owner.as_str())
                && v["sessionActive"] == json!(true) =>
        {
            let mut g = state.0.lock().await;
            let l = g.as_mut().ok_or_else(|| "SIGNED_OUT".to_string())?;
            l.checked_at = Some(now());
            Ok(Status {
                state: "signedIn",
                email: Some(l.email.clone()),
                account_id: Some(l.owner.clone()),
                server_checked_at: l.checked_at,
            })
        }
        (200, _) => Err("ACCOUNT_MISMATCH".into()),
        (401, v) if v["error"] == json!("ACCESS_REVOKED") => Err("ACCESS_REVOKED".into()),
        (401, _) => Err("AUTH_REQUIRED".into()),
        _ => Err("SERVER_UNAVAILABLE".into()),
    }
}

/// 서버 확인(필요하면 토큰 갱신). 세션이 서버에서 끊겼으면 이 기기 로그인을 정리한다
pub async fn check<H: Http, B: SecureVault>(
    http: &H,
    store: &Store,
    state: &OnlineState,
    factory: impl Fn() -> wjb_native_isolation::Result<B>,
) -> Result<Status, String> {
    ensure_access(http, store, state, &factory).await?;
    match check_me(http, state).await {
        Err(e) if e == "ACCESS_REVOKED" => {
            if let Some(a) = store.account() {
                if let Ok(mut v) = vault(store, &a.owner_id, &factory) {
                    let _ = v.logout();
                }
            }
            store.clear_account();
            *state.0.lock().await = None;
            Err(e)
        }
        r => r,
    }
}

/// 로그아웃: 서버 세션 닫기(가능하면) → 이 계정·이 기기 갱신 토큰만 지움. 기기 ID·다른 계정은 그대로
pub async fn sign_out<H: Http, B: SecureVault>(
    http: &H,
    store: &Store,
    state: &OnlineState,
    factory: impl FnOnce() -> wjb_native_isolation::Result<B>,
) -> Result<Status, String> {
    let live = state.0.lock().await.take();
    if let Some(l) = &live {
        let _ = http
            .send("POST", "/auth/v1/logout?scope=local", Some(&l.access), None)
            .await;
    }
    if let Some(a) = store.account() {
        vault(store, &a.owner_id, factory)?
            .logout()
            .map_err(vault_err)?;
    }
    store.clear_account();
    Ok(Status::signed_out())
}

// ── Tauri 명령(Preview 빌드만) ──
use tauri::{AppHandle, Manager, State};
use wjb_native_isolation::system_vault::SystemVault;

/// Preview 개발 프로젝트 폴더(설정 폴더 아래 development/<ref>) — 기기·계정·원본 임시 사본을 둔다
pub fn project_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .local_data_dir()
        .map_err(|_| "STORE".to_string())?;
    let layout = wjb_native_isolation::policy::layout(app_profile(), &base, Some(target()?))
        .map_err(|_| "STORE".to_string())?;
    layout.project_root.ok_or_else(|| "STORE".to_string())
}

pub(crate) fn app_store(app: &AppHandle) -> Result<Store, String> {
    Ok(Store::new(project_root(app)?))
}
pub(crate) fn client(app: &AppHandle) -> Result<Reqwest, String> {
    Reqwest::new(&app.package_info().version.to_string())
}

#[tauri::command]
pub async fn online_status(
    app: AppHandle,
    state: State<'_, OnlineState>,
) -> Result<Status, String> {
    Ok(status(&app_store(&app)?, &state, SystemVault::new).await)
}
#[tauri::command]
pub async fn online_send_code(app: AppHandle, email: String) -> Result<(), String> {
    send_code(&client(&app)?, &email).await
}
#[tauri::command]
pub async fn online_verify_code(
    app: AppHandle,
    state: State<'_, OnlineState>,
    email: String,
    code: String,
) -> Result<Status, String> {
    verify_code(
        &client(&app)?,
        &app_store(&app)?,
        &state,
        &email,
        &code,
        SystemVault::new,
    )
    .await
}
#[tauri::command]
pub async fn online_check(app: AppHandle, state: State<'_, OnlineState>) -> Result<Status, String> {
    check(&client(&app)?, &app_store(&app)?, &state, SystemVault::new).await
}
#[tauri::command]
pub async fn online_sign_out(
    app: AppHandle,
    state: State<'_, OnlineState>,
) -> Result<Status, String> {
    sign_out(&client(&app)?, &app_store(&app)?, &state, SystemVault::new).await
}

#[cfg(test)]
mod tests;
