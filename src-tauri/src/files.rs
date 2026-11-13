//! 파일·설정용 얇은 명령. 업무 규칙은 웹 앱(src/data/backup.ts, src/data/session.ts)에 있고,
//! 여기는 그 규칙이 쓰는 파일 동작만 제공한다. 삭제·덮어쓰기는 여기서도 이름 패턴을 한 번 더 검사한다(이중 가드).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const CONFIG_FILE: &str = "config.json";

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// `%LOCALAPPDATA%\WorkJourneyBoard\config.json` (Roaming이 아닌 Local — data-spec 3-4).
/// 폴더 이름은 실행 프로필이 정한다(Classic = `WorkJourneyBoard` 그대로, Preview = 별도 폴더 — profile.rs)
fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .local_data_dir()
        .map_err(err)?
        .join(crate::profile::active().config_dir)
        .join(CONFIG_FILE))
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
    is_symlink: bool,
    modified: Option<u64>,
    size: Option<u64>,
}

fn modified_ms(m: &fs::Metadata) -> Option<u64> {
    m.modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}
fn safe_backup_path(path: &Path) -> bool {
    if !path.is_absolute() {
        return false;
    }
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return false;
    }
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(m) if m.file_type().is_symlink() => return false,
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return false,
            _ => {}
        }
    }
    true
}

#[tauri::command]
pub fn fs_stat(path: String) -> PathInfo {
    match fs::metadata(&path) {
        Ok(m) => PathInfo {
            exists: true,
            is_dir: m.is_dir(),
            is_symlink: !safe_backup_path(std::path::Path::new(&path)),
            modified: modified_ms(&m),
            size: m.is_file().then(|| m.len()),
        },
        Err(_) => PathInfo {
            exists: false,
            is_dir: false,
            is_symlink: false,
            modified: None,
            size: None,
        },
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
    Path::new(p)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn is_digits(s: &str, n: usize) -> bool {
    s.len() == n && s.bytes().all(|b| b.is_ascii_digit())
}

/// work-journey_YYYY-MM-DD.db
fn is_daily(name: &str) -> bool {
    if crate::backup_name::kind(name) == Some("daily") {
        return true;
    }
    name.strip_prefix("work-journey_")
        .and_then(|r| r.strip_suffix(".db"))
        .map(|d| {
            let p: Vec<&str> = d.split('-').collect();
            p.len() == 3 && crate::backup_name::date(d)
        })
        .unwrap_or(false)
}

/// work-journey_YYYY-MM_monthly.db
fn is_monthly(name: &str) -> bool {
    if crate::backup_name::kind(name) == Some("monthly") {
        return true;
    }
    name.strip_prefix("work-journey_")
        .and_then(|r| r.strip_suffix("_monthly.db"))
        .map(|d| {
            let p: Vec<&str> = d.split('-').collect();
            p.len() == 2 && crate::backup_name::date(&format!("{d}-01"))
        })
        .unwrap_or(false)
}

/// work-journey_<영숫자·_·->.db.tmp — 앱이 만든 임시 백업 사본
fn is_temp(name: &str) -> bool {
    if name
        .strip_suffix(".tmp")
        .is_some_and(|n| crate::backup_name::kind(n).is_some())
    {
        return true;
    }
    name.strip_prefix("work-journey_")
        .and_then(|r| r.strip_suffix(".db.tmp"))
        .map(|m| {
            !m.is_empty()
                && m.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        })
        .unwrap_or(false)
}

/// 앱이 지울 수 있는 파일인가(src/data/backup.ts isDeletableByApp과 같은 규칙)
fn is_deletable(name: &str) -> bool {
    is_daily(name) || is_monthly(name) || is_temp(name)
}

#[tauri::command]
pub fn fs_remove_backup(
    path: String,
    expected_size: Option<u64>,
    expected_modified: Option<u64>,
) -> Result<(), String> {
    let name = file_name(&path);
    if !is_deletable(&name) {
        return Err(format!("삭제 금지 파일: {name}"));
    }
    if !safe_backup_path(Path::new(&path)) {
        return Err("링크 또는 상대 경로는 정리할 수 없습니다".into());
    }
    let meta = fs::symlink_metadata(&path).map_err(err)?;
    if !meta.is_file()
        || expected_size.is_some_and(|s| s != meta.len())
        || expected_modified.is_some_and(|m| Some(m) != modified_ms(&meta))
    {
        return Err("정리 대상이 변경되었습니다".into());
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
    if !safe_backup_path(Path::new(&from))
        || !safe_backup_path(Path::new(&to))
        || Path::new(&from).parent() != Path::new(&to).parent()
    {
        return Err("허용되지 않은 백업 경로".into());
    }
    if crate::backup_name::kind(&t).is_some() && Path::new(&to).exists() {
        return Err("이미 있는 백업입니다".into());
    }
    fs::rename(&from, &to).map_err(err)
}

/// 새 파일로만 복사(대상이 있으면 실패 — 덮어쓰지 않는다). 저장 위치 옮기기에서 백업 폴더 복사용.
#[tauri::command]
pub fn fs_copy_new(from: String, to: String) -> Result<(), String> {
    let mut src = fs::File::open(&from).map_err(err)?;
    let mut dst = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&to)
        .map_err(err)?;
    std::io::copy(&mut src, &mut dst).map_err(err)?;
    dst.sync_all().map_err(err)
}

/// 복원할 수 있는 백업 이름(src/data/backup.ts isRestorableName과 같은 규칙):
/// work-journey_YYYY-MM[-DD][_HHMM][_monthly|_manual|_pre-migration-vN|_before-restore|_pre-import|_pre-update].db
fn is_restorable(name: &str) -> bool {
    if crate::backup_name::kind(name).is_some() {
        return true;
    }
    let Some(core) = name
        .strip_prefix("work-journey_")
        .and_then(|r| r.strip_suffix(".db"))
    else {
        return false;
    };
    let mut parts = core.split('_').peekable();
    let date: Vec<&str> = parts.next().unwrap_or("").split('-').collect();
    let date_ok = (date.len() == 2 || date.len() == 3)
        && is_digits(date[0], 4)
        && is_digits(date[1], 2)
        && (date.len() == 2 || is_digits(date[2], 2));
    if !date_ok
        || !crate::backup_name::date(&if date.len() == 2 {
            format!("{}-01", date.join("-"))
        } else {
            date.join("-")
        })
    {
        return false;
    }
    if parts.peek().is_some_and(|p| is_digits(p, 4)) {
        let t = parts.next().unwrap();
        if t[..2].parse::<u32>().unwrap() > 23 || t[2..].parse::<u32>().unwrap() > 59 {
            return false;
        }
    }
    if let Some(tag) = parts.next() {
        let tag_ok = matches!(
            tag,
            "monthly" | "manual" | "before-restore" | "pre-import" | "pre-update"
        ) || tag
            .strip_prefix("pre-migration-v")
            .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()));
        if !tag_ok {
            return false;
        }
    }
    parts.next().is_none()
}

/// 복원 직전 보존 사본 이름: work-journey_YYYY-MM-DD_HHMM_before-restore.db
fn is_before_restore(name: &str) -> bool {
    if crate::backup_name::kind(name) == Some("before-restore") {
        return true;
    }
    name.strip_prefix("work-journey_")
        .and_then(|r| r.strip_suffix("_before-restore.db"))
        .map(|m| {
            let p: Vec<&str> = m.split('_').collect();
            p.len() == 2 && is_daily(&format!("work-journey_{}.db", p[0])) && is_digits(p[1], 4)
        })
        .unwrap_or(false)
}

/// 백업에서 복원(optimize-1031-plan O5, data-spec 7-3): ① 지금 일지(있으면)를 backups\<before_name>으로 옮겨 보존
/// ② backups\<backup_name>을 일지 이름으로 새 파일 복사(덮어쓰지 않음). ②가 실패하면 ①을 되돌린다. 일지는 닫혀 있어야 한다.
/// 이름은 파일 이름만(경로 불가), 백업·보존 이름은 위 패턴만 — 사용자가 넣은 다른 파일은 건드리지 않는다.
#[tauri::command]
pub fn restore_journal(
    data_dir: String,
    backup_name: String,
    before_name: String,
) -> Result<(), String> {
    if file_name(&backup_name) != backup_name
        || file_name(&before_name) != before_name
        || !is_restorable(&backup_name)
        || !is_before_restore(&before_name)
    {
        return Err(format!("허용되지 않은 복원: {backup_name} → {before_name}"));
    }
    let dir = Path::new(&data_dir);
    let journal = dir.join("work-journey.db");
    let backup = dir.join("backups").join(&backup_name);
    let before = dir.join("backups").join(&before_name);
    if !safe_backup_path(&backup) || !safe_backup_path(&before) || !safe_backup_path(&journal) {
        return Err("허용되지 않은 복원 경로".into());
    }
    if !backup.is_file() {
        return Err(format!("없는 백업: {backup_name}"));
    }
    if before.exists() {
        return Err(format!("이미 있는 파일: {before_name}"));
    }
    let moved = journal.exists();
    if moved {
        fs::rename(&journal, &before).map_err(err)?;
    }
    // 새로 만든 일지 파일만 실패 시 지운다(원래 있던 파일은 ①에서 옮겨 두었으니 되돌린다)
    let mut created = false;
    let copied = (|| -> std::io::Result<()> {
        let mut src = fs::File::open(&backup)?;
        let mut dst = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&journal)?;
        created = true;
        std::io::copy(&mut src, &mut dst)?;
        dst.sync_all()
    })();
    if let Err(e) = copied {
        if created {
            let _ = fs::remove_file(&journal);
        }
        if moved {
            let _ = fs::rename(&before, &journal);
        }
        return Err(err(e));
    }
    Ok(())
}

/// 설정 파일에 적힌 저장 폴더들 — 지금 연 공간(`dataDir`) + 워크스페이스 목록(`workspaces[].dir`, multi-board-spec 8절).
/// 없거나 읽지 못하면 빈 목록
fn configured_data_dirs(app: &AppHandle) -> Vec<String> {
    let Some(raw) = config_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
    else {
        return vec![];
    };
    data_dirs_of(&raw)
}

/// config.json 글 → 저장 폴더들(빈 값·같은 폴더는 한 번만)
fn data_dirs_of(raw: &str) -> Vec<String> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else {
        return vec![];
    };
    let mut out: Vec<String> = vec![];
    let mut push = |s: Option<&str>| {
        if let Some(s) = s.filter(|s| !s.is_empty()) {
            if !out.iter().any(|o| norm(o) == norm(s)) {
                out.push(s.to_string());
            }
        }
    };
    push(v.get("dataDir").and_then(|d| d.as_str()));
    if let Some(list) = v.get("workspaces").and_then(|w| w.as_array()) {
        for w in list {
            push(w.get("dir").and_then(|d| d.as_str()));
        }
    }
    out
}

/// 등록된 모든 공간 폴더에 대해 내보내기 규칙 검사(어느 공간의 `backups`에도 쓰지 않는다)
fn export_path_allowed_all(path: &str, dirs: &[String]) -> Result<(), String> {
    if dirs.is_empty() {
        return export_path_allowed(path, None);
    }
    for d in dirs {
        export_path_allowed(path, Some(d))?;
    }
    Ok(())
}

/// 경로 비교용: 구분자를 `\\`로 맞추고 끝 구분자를 떼고 소문자로(윈도우는 대소문자를 가리지 않음)
fn norm(p: &str) -> String {
    p.replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

/// 내보내기 파일 쓰기 허용 규칙(CLAUDE.md 4-3 내보내기 예외): 확장자 `.xlsx`·`.png`·`.webp`만,
/// 저장 폴더의 일지 파일·`backups` 폴더 안은 거부. 웹 앱의 저장 대화상자와 별개로 한 번 더 검사한다.
/// 윈도우 경로를 어느 플랫폼에서든 같게 다루려고 문자열로 본다(`\\`·`/` 모두 구분자).
/// 내보낼 수 있는 확장자: 엑셀 + 메모 이미지 + 메모 보드 마크다운(CLAUDE.md 4-3 내보내기 예외, weekly-note-spec 11절 #3,
/// features-1102-spec F4)
const EXPORT_EXTS: [&str; 5] = [".xlsx", ".png", ".webp", ".md", ".pdf"];
/// 마크다운과 함께 쓰는 이미지 폴더(`<문서 이름>_images`) 안에서만 허용하는 원본 이미지 확장자
const MD_IMAGE_EXTS: [&str; 5] = [".png", ".webp", ".jpg", ".jpeg", ".gif"];
const MD_IMAGE_DIR_SUFFIX: &str = "_images";

fn has_ext(name: &str, exts: &[&str]) -> bool {
    exts.iter()
        .any(|ext| name.ends_with(ext) && name.len() > ext.len())
}

fn export_path_allowed(path: &str, data_dir: Option<&str>) -> Result<(), String> {
    let p = norm(path);
    let (parent, name) = p.rsplit_once('\\').unwrap_or(("", p.as_str()));
    let in_md_images = parent
        .rsplit_once('\\')
        .map(|(_, d)| d)
        .unwrap_or(parent)
        .ends_with(MD_IMAGE_DIR_SUFFIX);
    if !has_ext(name, &EXPORT_EXTS) && !(in_md_images && has_ext(name, &MD_IMAGE_EXTS)) {
        return Err(format!(
            "엑셀(.xlsx)·이미지(.png·.webp)·마크다운(.md)·PDF(.pdf) 파일로만 저장할 수 있습니다: {name}"
        ));
    }
    if let Some(dir) = data_dir {
        if parent == format!("{}\\backups", norm(dir)) {
            return Err("백업 폴더에는 내보낼 수 없습니다".into());
        }
    }
    Ok(())
}

/// 내보내기 파일 쓰기(엑셀·메모 이미지). 사용자가 저장 대화상자에서 고른 경로이며, 같은 이름이면 대화상자에서
/// 덮어쓰기를 확인한 것이다. 임시 파일에 다 쓴 뒤 바꿔치기(쓰는 도중 꺼져도 반쪽 파일이 남지 않게).
#[tauri::command]
pub fn export_write(app: AppHandle, path: String, bytes: Vec<u8>) -> Result<(), String> {
    export_path_allowed_all(&path, &configured_data_dirs(&app))?;
    let target = PathBuf::from(&path);
    // 마크다운 이미지 폴더(`…_images`)는 없으면 한 단계만 만든다(그 위 폴더는 사용자가 고른 곳이라 이미 있다)
    if let Some(dir) = target.parent() {
        let is_md_dir = dir
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.to_lowercase().ends_with(MD_IMAGE_DIR_SUFFIX));
        if is_md_dir && !dir.exists() {
            fs::create_dir(dir).map_err(|e| format!("이미지 폴더를 만들지 못했습니다: {e}"))?;
        }
    }
    let ext = target
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("out")
        .to_owned();
    let tmp = target.with_extension(format!("{ext}.tmp"));
    let write = || -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(&bytes)?;
        f.sync_all()?;
        fs::rename(&tmp, &target)
    };
    write().map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!(
            "파일을 저장하지 못했습니다(다른 프로그램에서 열려 있으면 닫고 다시 시도하세요): {e}"
        )
    })
}

#[tauri::command]
pub fn open_folder(app: AppHandle, path: String) -> Result<(), String> {
    app.opener().open_path(path, None::<&str>).map_err(err)
}

/// 링크 열기(improve-1026-spec 9-2): http/https 주소만, 공백·제어 문자 없이, 2048자까지.
/// 앱은 주소에 접속하지 않고 OS 기본 브라우저에 넘길 뿐이다(외부 통신 0, CLAUDE.md 4-1). TS `isOpenableUrl`과 같은 규칙.
fn url_openable(url: &str) -> bool {
    if url.is_empty()
        || url.len() > 2048
        || url.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return false;
    }
    let lower = url.to_ascii_lowercase();
    let rest = if let Some(r) = lower.strip_prefix("https://") {
        r
    } else if let Some(r) = lower.strip_prefix("http://") {
        r
    } else {
        return false;
    };
    // 호스트가 있어야 한다(`https:///x`·`http://?a` 거부), 사용자 정보(`a@b`)로 호스트를 숨기는 주소도 거부
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    !authority.is_empty() && !authority.contains('@') && !authority.starts_with(':')
}

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    if !url_openable(&url) {
        return Err("http·https 주소만 열 수 있습니다".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_url_only_http_https() {
        for ok in [
            "https://wiki.example.local/deploy/checklist",
            "http://intranet.example.local:8080/a?b=1#c",
            "HTTPS://Example.com",
        ] {
            assert!(url_openable(ok), "{ok}");
        }
        for no in [
            "",
            "file:///C:/Windows/system32/calc.exe",
            "javascript:alert(1)",
            "ftp://example.com/a",
            "https://",
            "https:///path",
            "https://user@evil.example/",
            "https://exa mple.com",
            "https://example.com/\nx",
            "ms-settings:display",
            "\\\\server\\share",
        ] {
            assert!(!url_openable(no), "{no}");
        }
        assert!(!url_openable(&format!(
            "https://a.example/{}",
            "x".repeat(2100)
        )));
    }

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
        // 메모 이미지 저장(.png·.webp)도 같은 규칙
        assert!(export_path_allowed("D:\\캡처\\메모이미지_2026-W43_1.webp", Some(dir)).is_ok());
        assert!(export_path_allowed("D:\\캡처\\a.PNG", Some(dir)).is_ok());
        for no in [
            "C:\\Users\\u\\WorkJourney\\backups\\a.png",
            "D:\\x\\a.jpg",
            "D:\\x\\a.svg",
            "D:\\x\\.webp",
            "D:\\x\\a.png.exe",
        ] {
            assert!(export_path_allowed(no, Some(dir)).is_err(), "{no}");
        }
        assert!(export_path_allowed("D:\\보고\\가상노트.pdf", Some(dir)).is_ok());
        assert!(
            export_path_allowed("C:\\Users\\u\\WorkJourney\\backups\\노트.pdf", Some(dir)).is_err()
        );
        // 메모 보드 마크다운(F4): .md + 같은 이름 _images 폴더 안 원본 이미지(jpg·gif 포함)
        assert!(export_path_allowed("D:\\보고\\메모보드_2026-W43.md", Some(dir)).is_ok());
        assert!(
            export_path_allowed("D:\\보고\\메모보드_2026-W43_images\\box-1.jpg", Some(dir)).is_ok()
        );
        assert!(
            export_path_allowed("D:\\보고\\메모보드_2026-W43_images\\box-2.GIF", Some(dir)).is_ok()
        );
        for no in [
            "D:\\보고\\a.jpg",
            "D:\\보고\\x_images\\a.exe",
            "D:\\보고\\x_images\\a.md.bat",
            "C:\\Users\\u\\WorkJourney\\backups\\a.md",
        ] {
            assert!(export_path_allowed(no, Some(dir)).is_err(), "{no}");
        }
        assert!(export_path_allowed(
            "/home/u/WorkJourney/backups/a.xlsx",
            Some("/home/u/WorkJourney")
        )
        .is_err());
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

    #[test]
    fn restorable_names_match_backup_ts() {
        for ok in [
            "work-journey_2026-10-23.db",
            "work-journey_2026-10_monthly.db",
            "work-journey_2026-10-23_0831_manual.db",
            "work-journey_2026-10-23_0831_pre-migration-v7.db",
            "work-journey_2026-10-23_0831_before-restore.db",
            "work-journey_2026-10-23_0831_pre-import.db",
            "work-journey_2026-10-23_0831_pre-update.db",
        ] {
            assert!(is_restorable(ok), "{ok}");
        }
        for no in [
            "work-journey.db",
            "work-journey_2026-10-23.db.tmp",
            "work-journey_2026-10-23_0831_other.db",
            "work-journey_2026-1-1.db",
            "work-journey_2026-10-23_0831_manual_x.db",
            "내 메모.txt",
            "../work-journey_2026-10-23.db",
        ] {
            assert!(!is_restorable(no), "{no}");
        }
        assert!(is_before_restore(
            "work-journey_2026-10-23_0831_before-restore.db"
        ));
        assert!(!is_before_restore(
            "work-journey_2026-10-23_before-restore.db"
        ));
        assert!(!is_before_restore("work-journey_2026-10-23_0831_manual.db"));
    }

    #[test]
    fn v13_shared_backup_name_cases() {
        for line in include_str!("../../fixtures/backup-name-cases.tsv")
            .lines()
            .filter(|s| !s.starts_with('#'))
        {
            let p: Vec<_> = line.split('\t').collect();
            assert_eq!(p.len(), 3);
            assert_eq!(is_restorable(p[0]), p[1] == "true", "{}", p[0]);
            assert_eq!(is_deletable(p[0]), p[2] == "true", "{}", p[0]);
        }
    }
    #[test]
    fn v13_cleanup_guard_checks_metadata_and_preserves_protected() {
        let dir = fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("wjb-v13-guard-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let auto = dir.join("work-journey_2026-11-05_143012123_daily_app-v1.17.0_db-v14.db");
        let manual = dir.join("work-journey_2026-11-05_143012123_manual_app-v1.17.0_db-v14.db");
        fs::write(&auto, b"keep").unwrap();
        fs::write(&manual, b"keep").unwrap();
        assert!(fs_remove_backup(auto.to_string_lossy().into(), Some(999), None).is_err());
        assert!(auto.exists());
        assert!(fs_remove_backup(manual.to_string_lossy().into(), None, None).is_err());
        assert!(manual.exists());
        assert!(fs_remove_backup(auto.to_string_lossy().into(), Some(4), Some(0)).is_err());
        fs_remove_backup(
            auto.to_string_lossy().into(),
            Some(4),
            modified_ms(&fs::metadata(&auto).unwrap()),
        )
        .unwrap();
        assert!(!auto.exists());
        fs::remove_dir_all(&dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn v13_backup_symlinks_rejected() {
        let dir = fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("wjb-v13-link-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("user.txt");
        let link = dir.join("work-journey_2026-11-05.db");
        fs::write(&target, b"keep").unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(fs_remove_backup(link.to_string_lossy().into(), None, None).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"keep");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn restore_keeps_current_and_copies_backup() {
        let dir = fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("wjb-restore-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("backups")).unwrap();
        fs::write(dir.join("work-journey.db"), b"broken").unwrap();
        fs::write(dir.join("backups/work-journey_2026-10-21.db"), b"good").unwrap();
        fs::write(dir.join("backups/note.txt"), b"keep").unwrap();
        let d = dir.to_string_lossy().into_owned();
        // 경로가 섞인 이름·패턴 밖 이름은 거부
        assert!(restore_journal(
            d.clone(),
            "../work-journey.db".into(),
            "work-journey_2026-10-23_0831_before-restore.db".into()
        )
        .is_err());
        assert!(restore_journal(
            d.clone(),
            "note.txt".into(),
            "work-journey_2026-10-23_0831_before-restore.db".into()
        )
        .is_err());
        restore_journal(
            d.clone(),
            "work-journey_2026-10-21.db".into(),
            "work-journey_2026-10-23_0831_before-restore.db".into(),
        )
        .unwrap();
        assert_eq!(fs::read(dir.join("work-journey.db")).unwrap(), b"good");
        assert_eq!(
            fs::read(dir.join("backups/work-journey_2026-10-23_0831_before-restore.db")).unwrap(),
            b"broken"
        );
        assert_eq!(
            fs::read(dir.join("backups/work-journey_2026-10-21.db")).unwrap(),
            b"good"
        );
        assert_eq!(fs::read(dir.join("backups/note.txt")).unwrap(), b"keep");
        // 같은 보존 이름이 이미 있으면 아무것도 바꾸지 않는다
        assert!(restore_journal(
            d,
            "work-journey_2026-10-21.db".into(),
            "work-journey_2026-10-23_0831_before-restore.db".into()
        )
        .is_err());
        assert_eq!(fs::read(dir.join("work-journey.db")).unwrap(), b"good");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn export_checks_every_workspace_backups() {
        let raw = r#"{"dataDir":"C:\\U\\WorkJourney","workspaces":[{"dir":"C:\\U\\WorkJourney"},{"dir":"D:\\개인\\WorkJourney-개인"},{"dir":""}]}"#;
        let dirs = data_dirs_of(raw);
        assert_eq!(dirs.len(), 2);
        assert!(
            export_path_allowed_all("D:\\개인\\WorkJourney-개인\\backups\\a.xlsx", &dirs).is_err()
        );
        assert!(export_path_allowed_all("C:\\U\\WorkJourney\\backups\\a.xlsx", &dirs).is_err());
        assert!(export_path_allowed_all("D:\\개인\\보고\\a.xlsx", &dirs).is_ok());
        assert!(data_dirs_of("깨진 글").is_empty());
        assert!(export_path_allowed_all("D:\\a.db", &[]).is_err());
    }
}
