//! C-3 이관 통신·이어하기 기록(Connected Preview 빌드 전용, docs/v2-design/84).
//! - 웹 화면은 네트워크를 쓰지 않는다: 기기 등록·이관 명령·그림 올리기는 모두 여기서 개발 프로젝트 gateway로만.
//! - 사용자 토큰은 Rust 안에서만 쓴다(online.rs `access_for`). 화면·기록 파일에 남기지 않는다.
//! - 그림 바이트는 보내기 전에 SHA-256·크기를 다시 확인한다(화면이 준 값을 믿지 않음).
//! - 이어하기 기록 = ID·해시·크기·단계만(기록 내용·그림 없음). 모르는 칸이 있으면 거절한다.
use crate::online::{self, is_uuid, OnlineState, Store, ORIGIN, PUBLISHABLE_KEY};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) const GATEWAY: &str = "/functions/v1/wjb-gateway";
/// gateway 본문 한도(Edge `readLimited` 1,100,000바이트)와 그림 한도(io.mjs MAX_ASSET_BYTES)
pub const MAX_REQUEST_BYTES: usize = 1_100_000;
pub const MAX_ASSET_BYTES: usize = 10 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_JOURNAL_BYTES: usize = 1024 * 1024;
/// 앱이 부를 수 있는 이관 명령(Edge CLIENT_ACTIONS + 서버 확인 정산 2종)
pub const ACTIONS: &[&str] = &[
    "upload_begin",
    "upload_page",
    "upload_status",
    "start_upload",
    "status",
    "renew",
    "observe",
    "prepare_publish",
    "publish",
    "publication",
    "cancel",
    "finish_cancel",
    "attest",
    "confirm-absent",
];

pub enum Body {
    Json(Vec<u8>),
    Bytes(Vec<u8>),
}

#[allow(async_fn_in_trait)]
pub trait Gateway {
    /// path = ORIGIN 아래 gateway 경로. 응답 = (상태, JSON)
    async fn send(
        &self,
        method: &'static str,
        path: &str,
        bearer: &str,
        headers: &[(&'static str, String)],
        body: Body,
    ) -> Result<(u16, Value), String>;
}

/// 그림 내려받기(원시 바이트) — GET만, 크기 한도
#[allow(async_fn_in_trait)]
pub trait Download {
    async fn get_bytes(
        &self,
        path: &str,
        bearer: &str,
        headers: &[(&'static str, String)],
        max: usize,
    ) -> Result<(u16, Vec<u8>), String>;
}

pub struct GatewayClient(reqwest::Client);
impl GatewayClient {
    pub fn new(version: &str) -> Result<Self, String> {
        reqwest::Client::builder()
            .user_agent(format!("WorkJourneyBoardConnectedPreview/{version}"))
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(std::time::Duration::from_secs(10))
            // 10MB 그림을 느린 회선으로(gateway 본문 읽기 120초 + 여유)
            .timeout(std::time::Duration::from_secs(150))
            .build()
            .map(Self)
            .map_err(|_| "NETWORK".to_string())
    }
}
impl Gateway for GatewayClient {
    async fn send(
        &self,
        method: &'static str,
        path: &str,
        bearer: &str,
        headers: &[(&'static str, String)],
        body: Body,
    ) -> Result<(u16, Value), String> {
        if !online::path_allowed(path) || !path.starts_with(GATEWAY) {
            return Err("DESTINATION_DENIED".into());
        }
        let url = format!("{ORIGIN}{path}");
        let mut req = match method {
            "PUT" => self.0.put(&url),
            _ => self.0.post(&url),
        }
        .header("apikey", PUBLISHABLE_KEY)
        .header("authorization", format!("Bearer {bearer}"))
        .header("cache-control", "no-store");
        for (k, v) in headers {
            req = req.header(*k, v);
        }
        req = match body {
            Body::Json(b) => req.header("content-type", "application/json").body(b),
            Body::Bytes(b) => req
                .header("content-type", "application/octet-stream")
                .body(b),
        };
        let res = req.send().await.map_err(|_| "NETWORK".to_string())?;
        let status = res.status().as_u16();
        let bytes = res.bytes().await.map_err(|_| "NETWORK".to_string())?;
        if bytes.len() > MAX_RESPONSE_BYTES {
            return Err("RESPONSE_TOO_LARGE".into());
        }
        Ok((
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        ))
    }
}

impl Download for GatewayClient {
    async fn get_bytes(
        &self,
        path: &str,
        bearer: &str,
        headers: &[(&'static str, String)],
        max: usize,
    ) -> Result<(u16, Vec<u8>), String> {
        if !online::path_allowed(path) || !path.starts_with(GATEWAY) {
            return Err("DESTINATION_DENIED".into());
        }
        let mut req = self
            .0
            .get(format!("{ORIGIN}{path}"))
            .header("apikey", PUBLISHABLE_KEY)
            .header("authorization", format!("Bearer {bearer}"))
            .header("cache-control", "no-store");
        for (k, v) in headers {
            req = req.header(*k, v);
        }
        let res = req.send().await.map_err(|_| "NETWORK".to_string())?;
        let status = res.status().as_u16();
        if res.content_length().is_some_and(|n| n as usize > max) {
            return Err("RESPONSE_TOO_LARGE".into());
        }
        let bytes = res.bytes().await.map_err(|_| "NETWORK".to_string())?;
        if bytes.len() > max {
            return Err("RESPONSE_TOO_LARGE".into());
        }
        Ok((status, bytes.to_vec()))
    }
}

pub(crate) fn is_sha(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
/// 오류 응답 → 단계 코드(대문자·밑줄만, 그 밖은 HTTP_<상태>)
pub(crate) fn error_code(status: u16, v: &Value) -> String {
    // 이관 경로 = {"error":"CODE"}, 그림 경로(gateway.mjs) = {"error":{"code":"CODE"}}
    match v["error"].as_str().or_else(|| v["error"]["code"].as_str()) {
        Some(e) if e.len() <= 60 && e.bytes().all(|c| c.is_ascii_uppercase() || c == b'_') => {
            e.to_string()
        }
        _ => format!("HTTP_{status}"),
    }
}

pub async fn register_device<G: Gateway>(
    gw: &G,
    access: &str,
    device: &str,
) -> Result<Value, String> {
    if !is_uuid(device) {
        return Err("INVALID_REQUEST".into());
    }
    let body = serde_json::to_vec(&json!({ "deviceId": device })).map_err(|_| "INVALID_REQUEST")?;
    match gw
        .send(
            "POST",
            &format!("{GATEWAY}/v2/devices"),
            access,
            &[],
            Body::Json(body),
        )
        .await?
    {
        (200, v) if v["deviceId"] == json!(device) && v["registered"] == json!(true) => Ok(v),
        (200, _) => Err("SERVER_RESPONSE".into()),
        (s, v) => Err(error_code(s, &v)),
    }
}

pub async fn command<G: Gateway>(
    gw: &G,
    access: &str,
    device: &str,
    job: &str,
    action: &str,
    params: Value,
) -> Result<Value, String> {
    if !is_uuid(job) || !is_uuid(device) || !ACTIONS.contains(&action) || !params.is_object() {
        return Err("INVALID_REQUEST".into());
    }
    let body = serde_json::to_vec(&json!({ "deviceId": device, "params": params }))
        .map_err(|_| "INVALID_REQUEST")?;
    if body.len() > MAX_REQUEST_BYTES {
        return Err("REQUEST_TOO_LARGE".into());
    }
    match gw
        .send(
            "POST",
            &format!("{GATEWAY}/v2/migrations/{job}/{action}"),
            access,
            &[],
            Body::Json(body),
        )
        .await?
    {
        (200, v) if v.is_object() => Ok(v),
        (200, _) => Err("SERVER_RESPONSE".into()),
        (s, v) => Err(error_code(s, &v)),
    }
}

pub async fn put_asset<G: Gateway>(
    gw: &G,
    access: &str,
    device: &str,
    workspace: &str,
    object: &str,
    sha256: &str,
    bytes: Vec<u8>,
) -> Result<Value, String> {
    if !is_uuid(device) || !is_uuid(workspace) || !is_uuid(object) || !is_sha(sha256) {
        return Err("INVALID_REQUEST".into());
    }
    if bytes.is_empty() || bytes.len() > MAX_ASSET_BYTES {
        return Err("ASSET_SIZE".into());
    }
    let digest: String = Sha256::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if digest != sha256 {
        return Err("INTEGRITY_MISMATCH".into());
    }
    let headers = [
        ("x-wjb-device-id", device.to_string()),
        ("x-wjb-generation", "1".to_string()),
    ];
    match gw
        .send(
            "PUT",
            &format!("{GATEWAY}/v2/workspaces/{workspace}/assets/{object}/content"),
            access,
            &headers,
            Body::Bytes(bytes),
        )
        .await?
    {
        (200, v) if v["state"] == json!("ready") => Ok(v),
        (200, _) => Err("SERVER_RESPONSE".into()),
        (s, v) => Err(error_code(s, &v)),
    }
}

/// 취소한 작업의 그림 본문 지우기(gateway 자산 취소 경로 — 게시 전 것만, 서버가 ready·게시된 것은 거절)
pub async fn cancel_asset<G: Gateway>(
    gw: &G,
    access: &str,
    device: &str,
    workspace: &str,
    object: &str,
) -> Result<Value, String> {
    if !is_uuid(device) || !is_uuid(workspace) || !is_uuid(object) {
        return Err("INVALID_REQUEST".into());
    }
    let body = serde_json::to_vec(&json!({ "deviceId": device, "generation": "1" }))
        .map_err(|_| "INVALID_REQUEST")?;
    match gw
        .send(
            "POST",
            &format!("{GATEWAY}/v2/workspaces/{workspace}/assets/{object}/cancel"),
            access,
            &[],
            Body::Json(body),
        )
        .await?
    {
        (200, v) if v["state"] == json!("canceled") => Ok(v),
        (200, _) => Err("SERVER_RESPONSE".into()),
        (s, v) => Err(error_code(s, &v)),
    }
}

// ── 이어하기 기록(이 계정·이 기기, Preview 개발 프로젝트 폴더 migrations/) ──
const PHASES: &[&str] = &[
    "prepared",
    "uploading-records",
    "uploading-assets",
    "publishing",
    "published",
    "canceling",
    "canceled",
];
const ASSET_STATES: &[&str] = &["pending", "uploaded", "attested", "absent"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JournalAsset {
    pub object_id: String,
    pub sha256: String,
    pub bytes: u64,
    pub state: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Journal {
    pub version: u8,
    pub job_id: String,
    pub owner_id: String,
    pub workspace_id: String,
    pub snapshot_id: String,
    pub source_hash: String,
    pub mapping_hash: String,
    pub manifest_hash: Option<String>,
    /// 게시·취소 재시도는 같은 작업 번호로(서버가 다른 번호를 거절, 004 `MIGRATION_OPERATION_CHANGED`)
    pub publish_operation_id: Option<String>,
    pub cancel_operation_id: Option<String>,
    pub pages: u32,
    pub records: u32,
    pub phase: String,
    pub assets: Vec<JournalAsset>,
    pub updated_at: u64,
}
impl Journal {
    fn valid(&self, owner: &str) -> bool {
        self.version == 1
            && self.owner_id == owner
            && [
                &self.job_id,
                &self.owner_id,
                &self.workspace_id,
                &self.snapshot_id,
            ]
            .iter()
            .all(|s| is_uuid(s))
            && is_sha(&self.source_hash)
            && is_sha(&self.mapping_hash)
            && self.manifest_hash.as_deref().is_none_or(is_sha)
            && self.publish_operation_id.as_deref().is_none_or(is_uuid)
            && self.cancel_operation_id.as_deref().is_none_or(is_uuid)
            && (1..=32).contains(&self.pages)
            && self.records <= 20_000
            && PHASES.contains(&self.phase.as_str())
            && self.assets.len() <= 2000
            && self.assets.iter().all(|a| {
                is_uuid(&a.object_id)
                    && is_sha(&a.sha256)
                    && (1..=MAX_ASSET_BYTES as u64).contains(&a.bytes)
                    && ASSET_STATES.contains(&a.state.as_str())
            })
    }
}
fn journal_dir(root: &Path) -> PathBuf {
    root.join("migrations")
}
pub fn journal_list(root: &Path, owner: &str) -> Vec<Journal> {
    let Ok(dir) = fs::read_dir(journal_dir(root)) else {
        return vec![];
    };
    let mut out: Vec<Journal> = dir
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".json"))
        .filter_map(|e| {
            let bytes = fs::read(e.path()).ok()?;
            (bytes.len() <= MAX_JOURNAL_BYTES).then_some(())?;
            let j: Journal = serde_json::from_slice(&bytes).ok()?;
            (j.valid(owner) && e.file_name().to_string_lossy() == format!("{}.json", j.job_id))
                .then_some(j)
        })
        .collect();
    out.sort_by_key(|j| std::cmp::Reverse(j.updated_at));
    out
}
pub fn journal_write(root: &Path, owner: &str, j: &Journal) -> Result<(), String> {
    if !j.valid(owner) {
        return Err("INVALID_JOURNAL".into());
    }
    let bytes = serde_json::to_vec(j).map_err(|_| "INVALID_JOURNAL")?;
    if bytes.len() > MAX_JOURNAL_BYTES {
        return Err("INVALID_JOURNAL".into());
    }
    let dir = journal_dir(root);
    fs::create_dir_all(&dir).map_err(|_| "STORE".to_string())?;
    let path = dir.join(format!("{}.json", j.job_id));
    let tmp = dir.join(format!("{}.json.tmp", j.job_id));
    fs::write(&tmp, bytes).map_err(|_| "STORE".to_string())?;
    fs::rename(&tmp, &path).map_err(|_| "STORE".to_string())
}
pub fn journal_remove(root: &Path, owner: &str, job: &str) -> Result<(), String> {
    if !is_uuid(job) {
        return Err("INVALID_REQUEST".into());
    }
    // 이 계정의 기록만 지운다(다른 계정 기록은 그대로)
    if !journal_list(root, owner).iter().any(|j| j.job_id == job) {
        return Ok(());
    }
    fs::remove_file(journal_dir(root).join(format!("{job}.json"))).map_err(|_| "STORE".to_string())
}

// ── Tauri 명령(Preview 빌드만) ──
use tauri::{AppHandle, State};
use wjb_native_isolation::system_vault::SystemVault;

pub(crate) async fn session(
    app: &AppHandle,
    state: &OnlineState,
) -> Result<(Store, String, String), String> {
    let store = online::app_store(app)?;
    let (access, _owner) =
        online::access_for(&online::client(app)?, &store, state, SystemVault::new).await?;
    let device = store.device_id()?;
    Ok((store, access, device))
}
pub(crate) fn gateway(app: &AppHandle) -> Result<GatewayClient, String> {
    GatewayClient::new(&app.package_info().version.to_string())
}
pub(crate) fn owner(store: &Store) -> Result<String, String> {
    store.owner_id().ok_or_else(|| "SIGNED_OUT".to_string())
}

#[tauri::command]
pub async fn migration_device(
    app: AppHandle,
    state: State<'_, OnlineState>,
) -> Result<Value, String> {
    let (_, access, device) = session(&app, &state).await?;
    register_device(&gateway(&app)?, &access, &device).await
}
#[tauri::command]
pub async fn migration_command(
    app: AppHandle,
    state: State<'_, OnlineState>,
    job_id: String,
    action: String,
    params: Value,
) -> Result<Value, String> {
    let (_, access, device) = session(&app, &state).await?;
    command(&gateway(&app)?, &access, &device, &job_id, &action, params).await
}
/// 본문 = 그림 바이트 그대로(IPC raw), 머리 x-wjb-workspace·x-wjb-object·x-wjb-sha256
#[tauri::command]
pub async fn migration_put_asset(
    app: AppHandle,
    state: State<'_, OnlineState>,
    request: tauri::ipc::Request<'_>,
) -> Result<Value, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("INVALID_REQUEST".into());
    };
    let header = |k: &str| {
        request
            .headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string()
    };
    let (workspace, object, sha) = (
        header("x-wjb-workspace"),
        header("x-wjb-object"),
        header("x-wjb-sha256"),
    );
    let bytes = bytes.clone();
    let (_, access, device) = session(&app, &state).await?;
    put_asset(
        &gateway(&app)?,
        &access,
        &device,
        &workspace,
        &object,
        &sha,
        bytes,
    )
    .await
}
#[tauri::command]
pub async fn migration_cancel_asset(
    app: AppHandle,
    state: State<'_, OnlineState>,
    workspace_id: String,
    object_id: String,
) -> Result<Value, String> {
    let (_, access, device) = session(&app, &state).await?;
    cancel_asset(&gateway(&app)?, &access, &device, &workspace_id, &object_id).await
}
#[tauri::command]
pub fn migration_journal_list(app: AppHandle) -> Result<Vec<Journal>, String> {
    let store = online::app_store(&app)?;
    Ok(journal_list(store.root(), &owner(&store)?))
}
#[tauri::command]
pub fn migration_journal_write(app: AppHandle, journal: Journal) -> Result<(), String> {
    let store = online::app_store(&app)?;
    journal_write(store.root(), &owner(&store)?, &journal)
}
#[tauri::command]
pub fn migration_journal_remove(app: AppHandle, job_id: String) -> Result<(), String> {
    let store = online::app_store(&app)?;
    journal_remove(store.root(), &owner(&store)?, &job_id)
}

#[cfg(test)]
mod tests;
