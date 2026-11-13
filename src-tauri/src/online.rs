//! Connected Preview 온라인 계정(V2 B단계, docs/v2-design/79-preview-dev-connection.md). **Preview 빌드에만 있다.**
//! - 접속 대상은 개발 프로젝트 한 곳(`ORIGIN`)의 인증(`/auth/v1/`)과 gateway(`/functions/v1/wjb-gateway/`)뿐.
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

pub const PROJECT_REF: &str = "vsphftnmfzfoufasjttd";
const ORIGIN: &str = "https://vsphftnmfzfoufasjttd.supabase.co";
/// 공개 키(publishable) — 비밀 아님. 인증 서버가 어느 프로젝트의 요청인지 알아보는 용도
const PUBLISHABLE_KEY: &str = "sb_publishable_HgCrm5uiNX4v7Ppw0yowMQ_MREt7E5l";
const GATEWAY_ME: &str = "/functions/v1/wjb-gateway/v2/me";

fn target() -> CloudTarget {
    CloudTarget::new(CloudEnv::Development, PROJECT_REF).expect("개발 프로젝트 고정값")
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
            .user_agent(format!("WorkJourneyBoardConnectedPreview/{version}"))
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
        let url = format!("{ORIGIN}{path}");
        let mut req = match method {
            "GET" => self.0.get(&url),
            _ => self.0.post(&url),
        }
        .header("apikey", PUBLISHABLE_KEY)
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
    #[cfg(test)]
    fn path(&self) -> &std::path::Path {
        &self.root
    }
}

fn is_uuid(s: &str) -> bool {
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
        AccountScope::new(target(), owner, &device).map_err(|_| "INVALID_ACCOUNT".to_string())?;
    SessionVault::new(
        Profile::ConnectedPreview,
        WorkspaceKind::Online,
        scope,
        factory,
    )
    .map_err(vault_err)
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

/// 인증번호 메일 보내기 — 처음이면 계정을 만든다(메일 확인 = 인증번호)
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

fn app_store(app: &AppHandle) -> Result<Store, String> {
    let base = app
        .path()
        .local_data_dir()
        .map_err(|_| "STORE".to_string())?;
    let layout =
        wjb_native_isolation::policy::layout(Profile::ConnectedPreview, &base, Some(target()))
            .map_err(|_| "STORE".to_string())?;
    Ok(Store::new(
        layout.project_root.ok_or_else(|| "STORE".to_string())?,
    ))
}
fn client(app: &AppHandle) -> Result<Reqwest, String> {
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
