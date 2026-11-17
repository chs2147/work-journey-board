//! E-3·E-4 온라인 공간 동기화 통신(Connected Preview 빌드 전용, docs/v2-design/91).
//! - `space_sync_call`: gateway `/v2/sync/{push|pull|asset_declare}`(019) — 토큰·기기 ID는 Rust 안에서만.
//! - `space_asset_upload`: 새 그림 = 신고 → 예약 → 올리기(해시 확인) → 이 기기 캐시 `assets/<sha>.bin`.
//! - `space_asset_fetch`: 다른 기기가 붙인 그림 = 캐시에 있으면 그것(해시 확인), 없으면 받아서 해시 확인 후 캐시.
//! 로컬 원본 일지·정식판은 건드리지 않는다. 그림 본문은 서버 DB로 보내지 않는다(비공개 저장소 경로만).
use crate::migration::{
    error_code, is_sha, put_asset, Body, Download, Gateway, GATEWAY, MAX_ASSET_BYTES,
};
use crate::online::is_uuid;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

pub const SYNC_ACTIONS: [&str; 3] = ["push", "pull", "asset_declare"];
/// 한 요청 본문 한도(서버·gateway와 같음)
pub const MAX_SYNC_BODY: usize = 1_100_000;

fn hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub async fn call<G: Gateway>(
    gw: &G,
    access: &str,
    device: &str,
    action: &str,
    params: Value,
) -> Result<Value, String> {
    if !SYNC_ACTIONS.contains(&action) || !params.is_object() || !is_uuid(device) {
        return Err("INVALID_REQUEST".into());
    }
    if !params["workspaceId"].as_str().is_some_and(is_uuid) {
        return Err("INVALID_REQUEST".into());
    }
    let body = serde_json::to_vec(&json!({ "deviceId": device, "params": params }))
        .map_err(|_| "INVALID_REQUEST")?;
    if body.len() > MAX_SYNC_BODY {
        return Err("SYNC_REQUEST_TOO_LARGE".into());
    }
    match gw
        .send(
            "POST",
            &format!("{GATEWAY}/v2/sync/{action}"),
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

/// G 운영 준비(docs/v2-design/96): 계정 사용량·관리자 기능 — gateway `/v2/account/{action}`(서버 함수가 관리자 확인)
pub const ACCOUNT_ACTIONS: [&str; 4] = ["usage", "admin_list", "admin_set", "admin_invite"];
/// G-5(docs/v2-design/100): 공간 서버에서 지우기·계정 삭제 — 같은 계정 명령으로, gateway 경로만 /v2/lifecycle/
pub const LIFECYCLE_ACTIONS: [&str; 2] = ["delete_space", "delete_account"];
pub async fn account_call<G: Gateway>(
    gw: &G,
    access: &str,
    device: &str,
    action: &str,
    params: Value,
) -> Result<Value, String> {
    let life = LIFECYCLE_ACTIONS.contains(&action);
    if !(ACCOUNT_ACTIONS.contains(&action) || life) || !params.is_object() || !is_uuid(device) {
        return Err("INVALID_REQUEST".into());
    }
    let body = serde_json::to_vec(&json!({ "deviceId": device, "params": params }))
        .map_err(|_| "INVALID_REQUEST")?;
    if body.len() > if life { 2048 } else { 4096 } {
        return Err("INVALID_REQUEST".into());
    }
    let route = if life { "lifecycle" } else { "account" };
    match gw
        .send(
            "POST",
            &format!("{GATEWAY}/v2/{route}/{action}"),
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

fn cache_ok(dir: &Path, sha: &str, bytes: usize) -> Option<Vec<u8>> {
    let b = fs::read(dir.join("assets").join(format!("{sha}.bin"))).ok()?;
    (b.len() == bytes && hex(&b) == sha).then_some(b)
}
fn cache_put(dir: &Path, sha: &str, b: &[u8]) -> Result<(), String> {
    let d = dir.join("assets");
    fs::create_dir_all(&d).map_err(|_| "STORE".to_string())?;
    let tmp = d.join(format!("{sha}.tmp"));
    fs::write(&tmp, b).map_err(|_| "STORE".to_string())?;
    fs::rename(&tmp, d.join(format!("{sha}.bin"))).map_err(|_| "STORE".to_string())
}

/// 새 그림 올리기 — 같은 그림을 다시 올려도 안전(신고·예약은 같은 결과, 이미 ready면 그대로 성공)
pub async fn upload<G: Gateway>(
    gw: &G,
    access: &str,
    device: &str,
    dir: &Path,
    workspace: &str,
    object: &str,
    sha256: &str,
    bytes: Vec<u8>,
) -> Result<Value, String> {
    if !is_uuid(workspace) || !is_uuid(object) || !is_sha(sha256) {
        return Err("INVALID_REQUEST".into());
    }
    if bytes.is_empty() || bytes.len() > MAX_ASSET_BYTES {
        return Err("ASSET_SIZE".into());
    }
    if hex(&bytes) != sha256 {
        return Err("INTEGRITY_MISMATCH".into());
    }
    call(
        gw,
        access,
        device,
        "asset_declare",
        json!({ "workspaceId": workspace, "objectId": object, "sha256": sha256, "bytes": bytes.len() }),
    )
    .await?;
    let reserve = serde_json::to_vec(
        &json!({ "deviceId": device, "generation": "1", "bytes": bytes.len(), "sha256": sha256 }),
    )
    .map_err(|_| "INVALID_REQUEST")?;
    match gw
        .send(
            "POST",
            &format!("{GATEWAY}/v2/workspaces/{workspace}/assets/{object}/reserve"),
            access,
            &[],
            Body::Json(reserve),
        )
        .await?
    {
        (200 | 201, v) if v["state"] == json!("ready") => {
            cache_put(dir, sha256, &bytes)?;
            return Ok(json!({ "objectId": object, "state": "ready", "uploaded": false }));
        }
        (200 | 201, _) => {}
        (s, v) => return Err(error_code(s, &v)),
    }
    let r = put_asset(gw, access, device, workspace, object, sha256, bytes.clone()).await?;
    cache_put(dir, sha256, &bytes)?;
    Ok(json!({ "objectId": object, "state": r["state"], "uploaded": true }))
}

/// 그림 받기 — 캐시 먼저(해시 확인), 없으면 서버에서(해시·크기 확인 후 캐시)
pub async fn fetch<G: Download>(
    gw: &G,
    access: &str,
    device: &str,
    dir: &Path,
    workspace: &str,
    object: &str,
    sha256: &str,
    bytes: usize,
) -> Result<Vec<u8>, String> {
    if !is_uuid(workspace)
        || !is_uuid(object)
        || !is_sha(sha256)
        || bytes == 0
        || bytes > MAX_ASSET_BYTES
    {
        return Err("INVALID_REQUEST".into());
    }
    if let Some(b) = cache_ok(dir, sha256, bytes) {
        return Ok(b);
    }
    let headers = [
        ("x-wjb-device-id", device.to_string()),
        ("x-wjb-generation", "1".to_string()),
    ];
    let (status, body) = gw
        .get_bytes(
            &format!("{GATEWAY}/v2/workspaces/{workspace}/assets/{object}/content"),
            access,
            &headers,
            MAX_ASSET_BYTES,
        )
        .await?;
    if status != 200 {
        return Err(format!("ASSET_HTTP_{status}"));
    }
    if body.len() != bytes || hex(&body) != sha256 {
        return Err("INTEGRITY_MISMATCH".into());
    }
    cache_put(dir, sha256, &body)?;
    Ok(body)
}

// ── Tauri 명령(Preview 빌드만) ──
use crate::migration::{gateway, owner, session};
use crate::online::OnlineState;
use crate::online_space::space_dir;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn space_sync_call(
    app: AppHandle,
    state: State<'_, OnlineState>,
    action: String,
    params: Value,
) -> Result<Value, String> {
    let (_, access, device) = session(&app, &state).await?;
    call(&gateway(&app)?, &access, &device, &action, params).await
}
#[tauri::command]
pub async fn online_account_call(
    app: AppHandle,
    state: State<'_, OnlineState>,
    action: String,
    params: Value,
) -> Result<Value, String> {
    let (store, access, device) = session(&app, &state).await?;
    let gw = gateway(&app)?;
    // 이 계정 기기 ID가 서버에 없을 수 있다(첫 화면에서 바로 계정 화면) — 목록과 같이 먼저 맞춘다
    let device = crate::migration::ensure_device(&gw, &store, &owner(&store)?, &access, &device)
        .await
        .unwrap_or(device);
    account_call(&gw, &access, &device, &action, params).await
}
/// 본문 = 그림 바이트 그대로(IPC raw), 머리 x-wjb-workspace·x-wjb-object·x-wjb-sha256
#[tauri::command]
pub async fn space_asset_upload(
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
    let (ws, object, sha) = (
        header("x-wjb-workspace"),
        header("x-wjb-object"),
        header("x-wjb-sha256"),
    );
    let bytes = bytes.clone();
    let (store, access, device) = session(&app, &state).await?;
    let dir = space_dir(store.root(), &owner(&store)?, &ws)?;
    upload(
        &gateway(&app)?,
        &access,
        &device,
        &dir,
        &ws,
        &object,
        &sha,
        bytes,
    )
    .await
}
#[tauri::command]
pub async fn space_asset_fetch(
    app: AppHandle,
    state: State<'_, OnlineState>,
    workspace_id: String,
    object_id: String,
    sha256: String,
    bytes: usize,
) -> Result<tauri::ipc::Response, String> {
    // 캐시에 있으면 서버에 묻지 않는다(오프라인에서도)
    let store = crate::online::app_store(&app)?;
    let dir = space_dir(store.root(), &owner(&store)?, &workspace_id)?;
    if is_sha(&sha256) {
        if let Some(b) = cache_ok(&dir, &sha256, bytes) {
            return Ok(tauri::ipc::Response::new(b));
        }
    }
    let (_, access, device) = session(&app, &state).await?;
    let b = fetch(
        &gateway(&app)?,
        &access,
        &device,
        &dir,
        &workspace_id,
        &object_id,
        &sha256,
        bytes,
    )
    .await?;
    Ok(tauri::ipc::Response::new(b))
}

#[cfg(test)]
mod tests;
