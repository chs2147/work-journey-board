//! D단계 온라인 공간 읽기·이 기기 캐시(Connected Preview 빌드 전용, docs/v2-design/87 D-1·D-2).
//! - 서버: gateway `/v2/read/{list|header|records}`(016) + 그림 `GET …/assets/{id}/content`. 토큰은 Rust 안에서만.
//! - 캐시: Preview 폴더 `online-cache/<계정>/<공간>/` — `header.json`·`records.json`(그림 본문 없음, 참조만)·
//!   `assets/<sha256>.bin`(그림 파일, 해시 확인 후)·`complete.json`(마지막에 씀 = 완성 표시). 파일은 임시 이름 → 이름 바꾸기.
//! - 로컬 원본 일지는 읽지도 쓰지도 않는다(서버 → 캐시 방향만).
use crate::migration::{error_code, is_sha, Body, Download, Gateway, GATEWAY, MAX_ASSET_BYTES};
use crate::online::is_uuid;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

const PAGE: u32 = 1000;
/// 한 공간 기록 한도(서버 계약과 같음)
const MAX_RECORDS: usize = 20_000;

fn hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

async fn read_call<G: Gateway>(
    gw: &G,
    access: &str,
    device: &str,
    action: &str,
    params: Value,
) -> Result<Value, String> {
    let body = serde_json::to_vec(&json!({ "deviceId": device, "params": params }))
        .map_err(|_| "INVALID_REQUEST")?;
    match gw
        .send(
            "POST",
            &format!("{GATEWAY}/v2/read/{action}"),
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

pub async fn list<G: Gateway>(gw: &G, access: &str, device: &str) -> Result<Value, String> {
    let v = read_call(gw, access, device, "list", json!({})).await?;
    if !v["workspaces"].is_array() {
        return Err("SERVER_RESPONSE".into());
    }
    Ok(v)
}

/// 공간 폴더 = <root>/online-cache/<owner>/<workspace> (둘 다 UUID만)
pub fn space_dir(root: &Path, owner: &str, workspace: &str) -> Result<PathBuf, String> {
    if !is_uuid(owner) || !is_uuid(workspace) {
        return Err("INVALID_REQUEST".into());
    }
    Ok(root.join("online-cache").join(owner).join(workspace))
}
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or_else(|| "STORE".to_string())?;
    fs::create_dir_all(dir).map_err(|_| "STORE".to_string())?;
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|_| "STORE".to_string())?;
    fs::rename(&tmp, path).map_err(|_| "STORE".to_string())
}
fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}
fn asset_ok(dir: &Path, sha: &str, bytes: u64) -> bool {
    fs::read(dir.join("assets").join(format!("{sha}.bin")))
        .is_ok_and(|b| b.len() as u64 == bytes && hex(&b) == sha)
}
/// 완성된 캐시면 그 표시(complete.json) — 머리·기록 파일과 그림 파일이 모두 맞을 때만
pub fn complete(dir: &Path) -> Option<Value> {
    let c = read_json(&dir.join("complete.json"))?;
    let h = read_json(&dir.join("header.json"))?;
    if h["manifestHash"] != c["manifestHash"] || !dir.join("records.json").is_file() {
        return None;
    }
    let all = h["assets"].as_array()?.iter().all(|a| {
        a["sha256"].as_str().is_some_and(is_sha)
            && asset_ok(
                dir,
                a["sha256"].as_str().unwrap_or(""),
                a["bytes"].as_u64().unwrap_or(0),
            )
    });
    all.then_some(c)
}

/// 서버에서 공간을 받아 캐시를 채운다. 같은 manifest의 완성 캐시가 있으면 받지 않는다.
/// 서버에 닿지 못하면(네트워크·5xx) 완성 캐시가 있을 때 그것을 쓴다(`stale: true`).
pub async fn sync<G: Gateway + Download>(
    gw: &G,
    access: &str,
    device: &str,
    dir: &Path,
    workspace: &str,
    now: u64,
) -> Result<Value, String> {
    let header = match read_call(
        gw,
        access,
        device,
        "header",
        json!({ "workspaceId": workspace }),
    )
    .await
    {
        Ok(h) => h,
        Err(e)
            if ["NETWORK", "READ_UNAVAILABLE", "GATEWAY_UNAVAILABLE"].contains(&e.as_str())
                || e.starts_with("HTTP_5") =>
        {
            return match complete(dir) {
                Some(c) => Ok(
                    json!({ "workspaceId": workspace, "manifestHash": c["manifestHash"], "records": c["records"], "assets": c["assets"], "fromCache": true, "stale": true }),
                ),
                None => Err(e),
            };
        }
        Err(e) => return Err(e),
    };
    let mh = header["manifestHash"]
        .as_str()
        .filter(|s| is_sha(s))
        .ok_or("SERVER_RESPONSE")?
        .to_string();
    let total = header["records"].as_u64().ok_or("SERVER_RESPONSE")? as usize;
    let assets = header["assets"]
        .as_array()
        .ok_or("SERVER_RESPONSE")?
        .clone();
    if total > MAX_RECORDS || header["workspaceId"] != json!(workspace) {
        return Err("SERVER_RESPONSE".into());
    }
    if let Some(c) = complete(dir).filter(|c| c["manifestHash"] == json!(mh)) {
        return Ok(
            json!({ "workspaceId": workspace, "manifestHash": mh, "records": c["records"], "assets": c["assets"], "fromCache": true, "stale": false }),
        );
    }
    // 기록 페이지(키셋) — 받은 기록 수가 머리와 같아야 한다
    let mut records: Vec<Value> = Vec::with_capacity(total);
    let mut after = Value::Null;
    loop {
        let p = read_call(
            gw,
            access,
            device,
            "records",
            json!({ "workspaceId": workspace, "manifestHash": mh, "after": after, "limit": PAGE }),
        )
        .await?;
        let page = p["records"].as_array().ok_or("SERVER_RESPONSE")?;
        records.extend(page.iter().cloned());
        if records.len() > total {
            return Err("SERVER_RESPONSE".into());
        }
        if p["more"] != json!(true) {
            break;
        }
        if page.is_empty() || !p["next"].is_array() {
            return Err("SERVER_RESPONSE".into());
        }
        after = p["next"].clone();
    }
    if records.len() != total {
        return Err("RECORD_COUNT_MISMATCH".into());
    }
    // 그림: 이미 있는 파일은 해시 확인 후 건너뜀, 없으면 받아서 해시·크기 확인 후 파일로
    let mut downloaded = 0u32;
    for a in &assets {
        let (obj, sha, bytes) = (
            a["objectId"].as_str().unwrap_or(""),
            a["sha256"].as_str().unwrap_or(""),
            a["bytes"].as_u64().unwrap_or(0),
        );
        if !is_uuid(obj) || !is_sha(sha) || bytes == 0 || bytes > MAX_ASSET_BYTES as u64 {
            return Err("SERVER_RESPONSE".into());
        }
        if asset_ok(dir, sha, bytes) {
            continue;
        }
        let headers = [
            ("x-wjb-device-id", device.to_string()),
            ("x-wjb-generation", "1".to_string()),
        ];
        let (status, body) = gw
            .get_bytes(
                &format!("{GATEWAY}/v2/workspaces/{workspace}/assets/{obj}/content"),
                access,
                &headers,
                MAX_ASSET_BYTES,
            )
            .await?;
        if status != 200 {
            return Err(format!("ASSET_HTTP_{status}"));
        }
        if body.len() as u64 != bytes || hex(&body) != sha {
            return Err("INTEGRITY_MISMATCH".into());
        }
        write_atomic(&dir.join("assets").join(format!("{sha}.bin")), &body)?;
        downloaded += 1;
    }
    let head = json!({ "workspaceId": workspace, "manifestHash": mh, "createdAt": header["createdAt"], "header": header["header"], "assets": assets });
    write_atomic(
        &dir.join("header.json"),
        &serde_json::to_vec(&head).map_err(|_| "STORE")?,
    )?;
    write_atomic(
        &dir.join("records.json"),
        &serde_json::to_vec(&records).map_err(|_| "STORE")?,
    )?;
    let done =
        json!({ "manifestHash": mh, "records": total, "assets": assets.len(), "syncedAt": now });
    write_atomic(
        &dir.join("complete.json"),
        &serde_json::to_vec(&done).map_err(|_| "STORE")?,
    )?;
    Ok(
        json!({ "workspaceId": workspace, "manifestHash": mh, "records": total, "assets": assets.len(), "downloaded": downloaded, "fromCache": false, "stale": false }),
    )
}

/// 캐시 파일 읽기 — 이름은 정해진 것만
pub fn read_file(dir: &Path, name: &str) -> Result<Vec<u8>, String> {
    let path = match name {
        "header.json" | "records.json" | "complete.json" => dir.join(name),
        _ if name.len() == 68 && name.ends_with(".bin") && is_sha(&name[..64]) => {
            dir.join("assets").join(name)
        }
        _ => return Err("INVALID_REQUEST".into()),
    };
    if complete(dir).is_none() {
        return Err("CACHE_INCOMPLETE".into());
    }
    fs::read(path).map_err(|_| "CACHE_MISSING".to_string())
}
/// 이 계정의 완성 캐시 목록(서버에 닿지 못할 때 목록 대신)
pub fn cached(root: &Path, owner: &str) -> Vec<Value> {
    if !is_uuid(owner) {
        return vec![];
    }
    let base = root.join("online-cache").join(owner);
    let Ok(rd) = fs::read_dir(base) else {
        return vec![];
    };
    let mut out: Vec<Value> = rd
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if !is_uuid(&name) {
                return None;
            }
            let c = complete(&e.path())?;
            let h = read_json(&e.path().join("header.json"))?;
            Some(json!({ "workspaceId": name, "manifestHash": c["manifestHash"], "records": c["records"], "assets": c["assets"], "createdAt": h["createdAt"], "sourceSchema": h["header"]["sourceSchema"], "syncedAt": c["syncedAt"] }))
        })
        .collect();
    out.sort_by(|a, b| b["syncedAt"].as_u64().cmp(&a["syncedAt"].as_u64()));
    out
}
pub fn remove(dir: &Path) -> Result<(), String> {
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|_| "STORE".to_string())?;
    }
    Ok(())
}

// ── Tauri 명령(Preview 빌드만) ──
use crate::migration::{gateway, owner, session};
use crate::online::OnlineState;
use tauri::{AppHandle, State};

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
#[tauri::command]
pub async fn space_list(app: AppHandle, state: State<'_, OnlineState>) -> Result<Value, String> {
    let (store, access, device) = session(&app, &state).await?;
    let gw = gateway(&app)?;
    crate::migration::register_device(&gw, &access, &device)
        .await
        .ok();
    match list(&gw, &access, &device).await {
        Ok(v) => Ok(v),
        // 서버에 닿지 못하면 이 기기에 받아 둔 공간만
        Err(e) if e == "NETWORK" || e.starts_with("HTTP_5") || e.ends_with("_UNAVAILABLE") => {
            Ok(json!({ "workspaces": cached(store.root(), &owner(&store)?), "offline": true }))
        }
        Err(e) => Err(e),
    }
}
#[tauri::command]
pub async fn space_sync(
    app: AppHandle,
    state: State<'_, OnlineState>,
    workspace_id: String,
) -> Result<Value, String> {
    let (store, access, device) = session(&app, &state).await?;
    let dir = space_dir(store.root(), &owner(&store)?, &workspace_id)?;
    let gw = gateway(&app)?;
    crate::migration::register_device(&gw, &access, &device)
        .await
        .ok();
    sync(&gw, &access, &device, &dir, &workspace_id, now()).await
}
#[tauri::command]
pub fn space_read(
    app: AppHandle,
    workspace_id: String,
    name: String,
) -> Result<tauri::ipc::Response, String> {
    let store = crate::online::app_store(&app)?;
    let dir = space_dir(store.root(), &owner(&store)?, &workspace_id)?;
    Ok(tauri::ipc::Response::new(read_file(&dir, &name)?))
}
#[tauri::command]
pub async fn space_remove(
    app: AppHandle,
    db: State<'_, crate::space_db::SpaceDbState>,
    workspace_id: String,
) -> Result<(), String> {
    let store = crate::online::app_store(&app)?;
    let dir = space_dir(store.root(), &owner(&store)?, &workspace_id)?;
    // 이 기기 일지가 열려 있으면 먼저 닫는다(E-1)
    db.close(&dir).await;
    remove(&dir)
}

#[cfg(test)]
mod tests;
