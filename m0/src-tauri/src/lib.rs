//! Work Journey Board I-M0 설치 검증용 최소 앱.
//! 회사 PC에서 설치·실행·파일 쓰기/읽기·SQLite·OneDrive·WebView2를 점검하고 결과를 화면에 보여준다.
//! 외부 통신 없음: 네트워크를 쓰는 코드가 없다.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const RUN_LOG: &str = "m0-runs.txt";
const TEST_FILE: &str = "wjb-m0-test.txt";

#[derive(Serialize)]
struct EnvInfo {
    app_version: String,
    os: String,
    arch: String,
    os_version: String,
    webview2_version: Option<String>,
    webview2_error: Option<String>,
    exe_path: Option<String>,
    local_data_dir: Option<String>,
    documents_dir: Option<String>,
    home_dir: Option<String>,
    onedrive_env: Vec<(String, String)>,
    documents_in_onedrive: bool,
}

#[derive(Serialize)]
struct RunInfo {
    /// 이번 실행을 포함한 실행 시각(유닉스 초) 목록, 최근 20개.
    runs: Vec<u64>,
    log_path: String,
}

#[derive(Serialize)]
struct FileTest {
    path: String,
    written_bytes: usize,
    read_matches: bool,
    backup_dir_ok: bool,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn onedrive_env() -> Vec<(String, String)> {
    ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"]
        .iter()
        .filter_map(|k| std::env::var(k).ok().map(|v| (k.to_string(), v)))
        .filter(|(_, v)| !v.is_empty())
        .collect()
}

fn path_in_onedrive(path: &str, env: &[(String, String)]) -> bool {
    let p = path.to_lowercase();
    env.iter().any(|(_, v)| p.starts_with(&v.to_lowercase())) || p.contains("\\onedrive")
}

#[tauri::command]
fn env_info(app: tauri::AppHandle) -> EnvInfo {
    let paths = app.path();
    let (webview2_version, webview2_error) = match tauri::webview_version() {
        Ok(v) => (Some(v), None),
        Err(e) => (None, Some(e.to_string())),
    };
    let documents_dir = paths.document_dir().ok().map(|p| p.display().to_string());
    let env = onedrive_env();
    let documents_in_onedrive = documents_dir
        .as_deref()
        .map(|d| path_in_onedrive(d, &env))
        .unwrap_or(false);
    EnvInfo {
        app_version: app.package_info().version.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        os_version: std::env::var("OS").unwrap_or_default(),
        webview2_version,
        webview2_error,
        exe_path: std::env::current_exe().ok().map(|p| p.display().to_string()),
        local_data_dir: paths.app_local_data_dir().ok().map(|p| p.display().to_string()),
        documents_dir,
        home_dir: paths.home_dir().ok().map(|p| p.display().to_string()),
        onedrive_env: env,
        documents_in_onedrive,
    }
}

#[tauri::command]
fn is_onedrive_path(path: String) -> bool {
    path_in_onedrive(&path, &onedrive_env())
}

/// 실행 기록을 앱 로컬 데이터 폴더에 한 줄 추가하고 최근 기록을 돌려준다(재부팅 후 재실행 확인용).
#[tauri::command]
fn record_run(app: tauri::AppHandle) -> Result<RunInfo, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("폴더 생성 실패 {}: {e}", dir.display()))?;
    let log = dir.join(RUN_LOG);
    let mut runs: Vec<u64> = fs::read_to_string(&log)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.trim().parse().ok())
        .collect();
    runs.push(now_secs());
    let keep: Vec<u64> = runs.iter().rev().take(20).rev().copied().collect();
    let body: String = keep.iter().map(|r| format!("{r}\n")).collect();
    fs::write(&log, body).map_err(|e| format!("기록 쓰기 실패 {}: {e}", log.display()))?;
    Ok(RunInfo { runs: keep, log_path: log.display().to_string() })
}

/// 사용자가 고른 폴더에 테스트 파일을 쓰고 다시 읽어 비교한다. backups/ 하위 폴더 생성도 확인한다.
#[tauri::command]
fn file_roundtrip(dir: String) -> Result<FileTest, String> {
    let dir = PathBuf::from(dir);
    if !dir.is_dir() {
        return Err(format!("폴더가 아닙니다: {}", dir.display()));
    }
    let path = dir.join(TEST_FILE);
    let content = format!(
        "Work Journey Board M0 쓰기/읽기 테스트\n시각(유닉스 초): {}\n한글·공백 경로 확인용 파일입니다. 지워도 됩니다.\n",
        now_secs()
    );
    fs::write(&path, &content).map_err(|e| format!("쓰기 실패 {}: {e}", path.display()))?;
    let read = fs::read_to_string(&path).map_err(|e| format!("읽기 실패 {}: {e}", path.display()))?;
    let backup_dir_ok = fs::create_dir_all(dir.join("backups")).is_ok();
    Ok(FileTest {
        path: path.display().to_string(),
        written_bytes: content.len(),
        read_matches: read == content,
        backup_dir_ok,
    })
}

/// 파일 존재 여부와 크기(바이트). SQLite 백업 파일 확인용.
#[tauri::command]
fn file_size(path: String) -> Option<u64> {
    fs::metadata(Path::new(&path)).ok().map(|m| m.len())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            env_info,
            is_onedrive_path,
            record_run,
            file_roundtrip,
            file_size
        ])
        .run(tauri::generate_context!())
        .expect("앱 실행 중 오류");
}
