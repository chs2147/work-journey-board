//! 파일·설정용 얇은 명령. 업무 규칙은 웹 앱(src/data/backup.ts, src/data/session.ts)에 있고,
//! 여기는 그 규칙이 쓰는 파일 동작만 제공한다. 삭제·덮어쓰기는 여기서도 이름 패턴을 한 번 더 검사한다(이중 가드).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const CONFIG_DIR: &str = "WorkJourneyBoard";
const CONFIG_FILE: &str = "config.json";

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// `%LOCALAPPDATA%\WorkJourneyBoard\config.json` (Roaming이 아닌 Local — data-spec 3-4)
fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().local_data_dir().map_err(err)?.join(CONFIG_DIR).join(CONFIG_FILE))
}

#[tauri::command]
pub fn config_read(app: AppHandle) -> Result<Option<String>, String> {
    let p = config_path(&app)?;
    match fs::read_to_string(&p) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("설정 파일을 읽지 못했습니다({}): {e}", p.display())),
    }
}

/// 임시 파일에 쓴 뒤 바꿔치기(쓰는 도중 꺼져도 설정 파일이 깨지지 않게)
#[tauri::command]
pub fn config_write(app: AppHandle, json: String) -> Result<(), String> {
    let p = config_path(&app)?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    let tmp = p.with_extension("json.tmp");
    let mut f = fs::File::create(&tmp).map_err(err)?;
    f.write_all(json.as_bytes()).map_err(err)?;
    f.sync_all().map_err(err)?;
    fs::rename(&tmp, &p).map_err(err)
}

/// OneDrive 동기화 폴더 루트(환경 변수 OneDrive·OneDriveCommercial·OneDriveConsumer)
#[tauri::command]
pub fn onedrive_roots() -> Vec<String> {
    ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"]
        .iter()
        .filter_map(|k| std::env::var(k).ok())
        .filter(|v| !v.is_empty())
        .collect()
}

#[derive(Serialize)]
pub struct PathInfo {
    exists: bool,
    is_dir: bool,
    size: Option<u64>,
}

#[tauri::command]
pub fn fs_stat(path: String) -> PathInfo {
    match fs::metadata(&path) {
        Ok(m) => PathInfo { exists: true, is_dir: m.is_dir(), size: m.is_file().then(|| m.len()) },
        Err(_) => PathInfo { exists: false, is_dir: false, size: None },
    }
}

/// 폴더 안 파일 이름 목록(폴더가 없으면 빈 목록)
#[tauri::command]
pub fn fs_list(dir: String) -> Result<Vec<String>, String> {
    let rd = match fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(err(e)),
    };
    let mut names = vec![];
    for entry in rd.flatten() {
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            names.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    names.sort();
    Ok(names)
}

#[tauri::command]
pub fn fs_ensure_dir(dir: String) -> Result<(), String> {
    fs::create_dir_all(&dir).map_err(err)
}

fn file_name(p: &str) -> String {
    Path::new(p).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn is_digits(s: &str, n: usize) -> bool {
    s.len() == n && s.bytes().all(|b| b.is_ascii_digit())
}

/// work-journey_YYYY-MM-DD.db
fn is_daily(name: &str) -> bool {
    name.strip_prefix("work-journey_")
        .and_then(|r| r.strip_suffix(".db"))
        .map(|d| {
            let p: Vec<&str> = d.split('-').collect();
            p.len() == 3 && is_digits(p[0], 4) && is_digits(p[1], 2) && is_digits(p[2], 2)
        })
        .unwrap_or(false)
}

/// work-journey_YYYY-MM_monthly.db
fn is_monthly(name: &str) -> bool {
    name.strip_prefix("work-journey_")
        .and_then(|r| r.strip_suffix("_monthly.db"))
        .map(|d| {
            let p: Vec<&str> = d.split('-').collect();
            p.len() == 2 && is_digits(p[0], 4) && is_digits(p[1], 2)
        })
        .unwrap_or(false)
}

/// work-journey_<영숫자·_·->.db.tmp — 앱이 만든 임시 백업 사본
fn is_temp(name: &str) -> bool {
    name.strip_prefix("work-journey_")
        .and_then(|r| r.strip_suffix(".db.tmp"))
        .map(|m| !m.is_empty() && m.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))
        .unwrap_or(false)
}

/// 앱이 지울 수 있는 파일인가(src/data/backup.ts isDeletableByApp과 같은 규칙)
fn is_deletable(name: &str) -> bool {
    is_daily(name) || is_monthly(name) || is_temp(name)
}

#[tauri::command]
pub fn fs_remove_backup(path: String) -> Result<(), String> {
    let name = file_name(&path);
    if !is_deletable(&name) {
        return Err(format!("삭제 금지 파일: {name}"));
    }
    fs::remove_file(&path).map_err(err)
}

/// 백업 임시 사본(*.db.tmp)을 최종 백업 이름(work-journey_*.db)으로 바꾼다(같은 이름이면 덮어씀).
#[tauri::command]
pub fn fs_rename_backup(from: String, to: String) -> Result<(), String> {
    let (f, t) = (file_name(&from), file_name(&to));
    if !is_temp(&f) || !(t.starts_with("work-journey_") && t.ends_with(".db")) {
        return Err(format!("허용되지 않은 이름 바꾸기: {f} → {t}"));
    }
    fs::rename(&from, &to).map_err(err)
}

/// 새 파일로만 복사(대상이 있으면 실패 — 덮어쓰지 않는다). 저장 위치 옮기기에서 백업 폴더 복사용.
#[tauri::command]
pub fn fs_copy_new(from: String, to: String) -> Result<(), String> {
    let mut src = fs::File::open(&from).map_err(err)?;
    let mut dst = fs::OpenOptions::new().write(true).create_new(true).open(&to).map_err(err)?;
    std::io::copy(&mut src, &mut dst).map_err(err)?;
    dst.sync_all().map_err(err)
}

/// 설정 파일에 적힌 저장 폴더(없거나 읽지 못하면 None)
fn configured_data_dir(app: &AppHandle) -> Option<String> {
    let raw = fs::read_to_string(config_path(app).ok()?).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("dataDir")?.as_str().filter(|s| !s.is_empty()).map(str::to_string)
}

/// 경로 비교용: 구분자를 `\\`로 맞추고 끝 구분자를 떼고 소문자로(윈도우는 대소문자를 가리지 않음)
fn norm(p: &str) -> String {
    p.replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

/// 내보내기 파일 쓰기 허용 규칙(CLAUDE.md 4-3 내보내기 예외): 확장자 `.xlsx`만,
/// 저장 폴더의 일지 파일·`backups` 폴더 안은 거부. 웹 앱의 저장 대화상자와 별개로 한 번 더 검사한다.
/// 윈도우 경로를 어느 플랫폼에서든 같게 다루려고 문자열로 본다(`\\`·`/` 모두 구분자).
fn export_path_allowed(path: &str, data_dir: Option<&str>) -> Result<(), String> {
    let p = norm(path);
    let (parent, name) = p.rsplit_once('\\').unwrap_or(("", p.as_str()));
    let stem_len = name.len().saturating_sub(".xlsx".len());
    if !name.ends_with(".xlsx") || stem_len == 0 {
        return Err(format!("엑셀 파일(.xlsx)로만 저장할 수 있습니다: {name}"));
    }
    if let Some(dir) = data_dir {
        if parent == format!("{}\\backups", norm(dir)) {
            return Err("백업 폴더에는 내보낼 수 없습니다".into());
        }
    }
    Ok(())
}

/// 엑셀 내보내기 파일 쓰기. 사용자가 저장 대화상자에서 고른 경로이며, 같은 이름이면 대화상자에서
/// 덮어쓰기를 확인한 것이다. 임시 파일에 다 쓴 뒤 바꿔치기(쓰는 도중 꺼져도 반쪽 파일이 남지 않게).
#[tauri::command]
pub fn export_write(app: AppHandle, path: String, bytes: Vec<u8>) -> Result<(), String> {
    export_path_allowed(&path, configured_data_dir(&app).as_deref())?;
    let target = PathBuf::from(&path);
    let tmp = target.with_extension("xlsx.tmp");
    let write = || -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(&bytes)?;
        f.sync_all()?;
        fs::rename(&tmp, &target)
    };
    write().map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("파일을 저장하지 못했습니다(엑셀에서 열려 있으면 닫고 다시 시도하세요): {e}")
    })
}

#[tauri::command]
pub fn open_folder(app: AppHandle, path: String) -> Result<(), String> {
    app.opener().open_path(path, None::<&str>).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_only_xlsx_and_not_into_backups() {
        let dir = "C:\\Users\\u\\WorkJourney";
        for ok in [
            "C:\\Users\\u\\WorkJourney\\exports\\업무일지_2026-W43.xlsx",
            "D:\\보고\\업무일지_2026-W40~W43.XLSX",
            "C:\\Users\\u\\WorkJourney\\업무일지.xlsx",
        ] {
            assert!(export_path_allowed(ok, Some(dir)).is_ok(), "{ok}");
        }
        for no in [
            "C:\\Users\\u\\WorkJourney\\work-journey.db",
            "C:\\Users\\u\\WorkJourney\\backups\\업무일지.xlsx",
            "c:\\users\\U\\workjourney\\BACKUPS\\a.xlsx",
            "C:\\x\\a.xlsx.exe",
            "C:\\x\\.xlsx",
            "C:\\x\\noext",
        ] {
            assert!(export_path_allowed(no, Some(dir)).is_err(), "{no}");
        }
        // 설정을 못 읽어도 확장자 검사는 한다
        assert!(export_path_allowed("C:\\x\\a.db", None).is_err());
        assert!(export_path_allowed("/home/u/WorkJourney/backups/a.xlsx", Some("/home/u/WorkJourney")).is_err());
    }

    #[test]
    fn deletable_names_match_backup_ts() {
        for ok in [
            "work-journey_2026-10-23.db",
            "work-journey_2026-10_monthly.db",
            "work-journey_2026-10-23_0831_manual.db.tmp",
            "work-journey_2026-10-23.db.tmp",
        ] {
            assert!(is_deletable(ok), "{ok}");
        }
        for no in [
            "work-journey.db",
            "work-journey_2026-10-23_0831_manual.db",
            "work-journey_2026-10-23_0831_pre-migration-v2.db",
            "work-journey_2026-1-1.db",
            "work-journey_2026-10-01.db.bak",
            "내 메모.txt",
            "work-journey_.db.tmp",
            "work-journey_../x.db.tmp",
        ] {
            assert!(!is_deletable(no), "{no}");
        }
    }
}
