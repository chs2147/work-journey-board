//! DEV 검증판의 정식 일지 보호(docs/release-channel-spec.md 3절). 정식판 빌드에서는 모든 검사가 그냥 통과한다.
//!
//! - DEV가 만들거나 복제한 일지 폴더에는 표시 파일 `.wjb-dev-journal`이 있다.
//! - DEV는 **표시 없는 일지(= 정식 일지)가 있는 폴더와 그 `backups`에는 쓰지 않는다** — 일지 쓰기(db_batch)·백업 사본·
//!   이름 바꾸기·지우기·복원·내보내기가 이 검사를 먼저 지난다. 화면 쪽 `openJournalAt` 검사와 이중 가드.
//! - 정식 일지 복제는 원본을 **읽기만** 해서 DEV 폴더에 새 파일로 만든다.

use std::fs;
use std::path::{Path, PathBuf};

pub const MARKER: &str = ".wjb-dev-journal";
const JOURNAL: &str = "work-journey.db";

fn has_marker(dir: &Path) -> bool {
    dir.join(MARKER).is_file()
}
fn has_journal(dir: &Path) -> bool {
    dir.join(JOURNAL).exists()
}

/// 정식 일지가 있는 폴더(일지 있음 + DEV 표시 없음)인가
pub fn is_official_folder(dir: &Path) -> bool {
    has_journal(dir) && !has_marker(dir)
}

/// `path`에 쓰거나 지우려 할 때: 그 파일의 폴더 또는 한 단계 위(backups 안의 사본)가 정식 일지 폴더면 거절.
/// 정식판 빌드(`dev` = false)는 늘 통과.
pub fn write_allowed_for(dev: bool, path: &Path) -> Result<(), String> {
    if !dev {
        return Ok(());
    }
    let parent = path.parent();
    for dir in [parent, parent.and_then(Path::parent)]
        .into_iter()
        .flatten()
    {
        if has_marker(dir) {
            return Ok(());
        }
        if is_official_folder(dir) {
            return Err("OFFICIAL_JOURNAL_PROTECTED".into());
        }
    }
    Ok(())
}

pub fn write_allowed(path: &Path) -> Result<(), String> {
    write_allowed_for(crate::profile::is_dev(), path)
}

fn write_marker(dir: &Path, how: &str) -> Result<(), String> {
    let body = format!(
        "{{\"channel\":\"dev\",\"createdBy\":\"{}\",\"how\":\"{how}\"}}\n",
        env!("CARGO_PKG_VERSION")
    );
    fs::write(dir.join(MARKER), body).map_err(|e| format!("DEV 표시를 쓰지 못했습니다: {e}"))
}

/// 폴더 상태: "dev"(DEV 일지·표시) · "official"(정식 일지) · "empty"(일지 없음) · "missing"
pub fn folder_status(dir: &Path) -> &'static str {
    if !dir.is_dir() {
        "missing"
    } else if has_marker(dir) {
        "dev"
    } else if has_journal(dir) {
        "official"
    } else {
        "empty"
    }
}

/// 일지를 열기 직전: DEV 표시가 있으면 통과, 일지가 없으면(새 일지) 표시를 남기고 통과, 정식 일지면 거절
pub fn prepare_folder(dir: &Path) -> Result<&'static str, String> {
    match folder_status(dir) {
        "dev" => Ok("dev"),
        "empty" => {
            write_marker(dir, "new")?;
            Ok("dev")
        }
        "official" => Err("OFFICIAL_JOURNAL".into()),
        _ => Err("FOLDER_MISSING".into()),
    }
}

fn canon(p: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(p).map_err(|_| "FOLDER_MISSING".to_string())
}

/// 정식 일지 복제: `src`(정식 일지 폴더)의 일지를 **읽기만** 해서 `dest`(일지 없는 폴더, 없으면 한 단계 만듦)에
/// 새 파일로 복사하고 DEV 표시를 남긴다. 정식판이 쓰는 중(`work-journey.db-journal` 있음)이면 거절.
pub fn copy_official(src: &Path, dest: &Path) -> Result<(), String> {
    if !src.is_absolute() || !dest.is_absolute() {
        return Err("ABSOLUTE_PATH_REQUIRED".into());
    }
    if folder_status(src) != "official" {
        return Err("SOURCE_NOT_OFFICIAL".into());
    }
    if src.join(format!("{JOURNAL}-journal")).exists() {
        return Err("SOURCE_IN_USE".into());
    }
    // 겹침 검사를 폴더를 만들기 전에(정식 폴더 안에 아무것도 만들지 않게)
    let s = canon(src)?;
    let d = if dest.exists() {
        canon(dest)?
    } else {
        let parent = dest.parent().ok_or_else(|| "FOLDER_MISSING".to_string())?;
        canon(parent)?.join(
            dest.file_name()
                .ok_or_else(|| "FOLDER_MISSING".to_string())?,
        )
    };
    if s == d || d.starts_with(&s) || s.starts_with(&d) {
        return Err("DEST_OVERLAPS_SOURCE".into());
    }
    if !dest.exists() {
        fs::create_dir(dest).map_err(|e| format!("DEV 폴더를 만들지 못했습니다: {e}"))?;
    }
    if folder_status(dest) != "empty" {
        return Err("DEST_NOT_EMPTY".into());
    }
    let tmp = dest.join(format!("{JOURNAL}.copying"));
    fs::copy(src.join(JOURNAL), &tmp)
        .map_err(|e| format!("정식 일지를 복사하지 못했습니다: {e}"))?;
    fs::rename(&tmp, dest.join(JOURNAL)).map_err(|e| format!("복사본을 놓지 못했습니다: {e}"))?;
    write_marker(dest, "copy-official")
}

// ── Tauri 명령(DEV 빌드에만 등록) ──
#[cfg_attr(not(feature = "dev-channel"), allow(dead_code))]
#[tauri::command]
pub fn dev_folder_status(dir: String) -> &'static str {
    folder_status(Path::new(&dir))
}
#[cfg_attr(not(feature = "dev-channel"), allow(dead_code))]
#[tauri::command]
pub fn dev_prepare_folder(dir: String) -> Result<&'static str, String> {
    prepare_folder(Path::new(&dir))
}
#[cfg_attr(not(feature = "dev-channel"), allow(dead_code))]
#[tauri::command]
pub fn dev_copy_official(src: String, dest: String) -> Result<(), String> {
    copy_official(Path::new(&src), Path::new(&dest))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!(
                "wjb-dev-guard-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn official(t: &Tmp) -> PathBuf {
        let d = t.0.join("official");
        fs::create_dir_all(d.join("backups")).unwrap();
        fs::write(d.join(JOURNAL), b"OFFICIAL").unwrap();
        fs::write(d.join("backups").join("work-journey_2026-11-01.db"), b"B").unwrap();
        d
    }

    #[test]
    fn official_folder_and_its_backups_are_never_writable_in_dev() {
        let t = Tmp::new("w");
        let off = official(&t);
        for p in [
            off.join(JOURNAL),
            off.join("work-journey_x.db.tmp"),
            off.join("backups").join("work-journey_2026-11-02.db"),
        ] {
            assert_eq!(
                write_allowed_for(true, &p),
                Err("OFFICIAL_JOURNAL_PROTECTED".into()),
                "{p:?}"
            );
            assert!(write_allowed_for(false, &p).is_ok(), "정식판 빌드는 그대로");
        }
        // 일지 없는 폴더(보조 백업 위치·내보내기)는 통과
        let other = t.0.join("exports");
        fs::create_dir_all(&other).unwrap();
        assert!(write_allowed_for(true, &other.join("a.xlsx")).is_ok());
    }

    #[test]
    fn prepare_claims_only_empty_folders_and_refuses_official() {
        let t = Tmp::new("p");
        let off = official(&t);
        assert_eq!(prepare_folder(&off), Err("OFFICIAL_JOURNAL".into()));
        assert!(!off.join(MARKER).exists(), "정식 폴더에 표시를 남기지 않음");
        let dev = t.0.join("dev");
        fs::create_dir_all(&dev).unwrap();
        assert_eq!(folder_status(&dev), "empty");
        assert_eq!(prepare_folder(&dev), Ok("dev"));
        assert_eq!(folder_status(&dev), "dev");
        fs::write(dev.join(JOURNAL), b"DEV").unwrap();
        assert_eq!(prepare_folder(&dev), Ok("dev"));
        assert!(write_allowed_for(true, &dev.join(JOURNAL)).is_ok());
        assert!(write_allowed_for(
            true,
            &dev.join("backups").join("work-journey_2026-11-02.db")
        )
        .is_ok());
        assert_eq!(
            prepare_folder(&t.0.join("none")),
            Err("FOLDER_MISSING".into())
        );
    }

    #[test]
    fn copy_official_reads_original_only_and_marks_the_copy() {
        let t = Tmp::new("c");
        let off = official(&t);
        let before: Vec<_> = fs::read_dir(&off)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        let dest = t.0.join("dev-copy");
        copy_official(&off, &dest).unwrap();
        assert_eq!(fs::read(dest.join(JOURNAL)).unwrap(), b"OFFICIAL");
        assert_eq!(folder_status(&dest), "dev");
        // 원본 폴더 그대로(파일 목록·내용, 표시 없음)
        let after: Vec<_> = fs::read_dir(&off)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(before, after);
        assert_eq!(fs::read(off.join(JOURNAL)).unwrap(), b"OFFICIAL");
        // 다시 복제(대상에 일지 있음)·겹치는 위치·원본이 DEV·쓰는 중 거절
        assert_eq!(copy_official(&off, &dest), Err("DEST_NOT_EMPTY".into()));
        assert_eq!(
            copy_official(&off, &off.join("inner")),
            Err("DEST_OVERLAPS_SOURCE".into())
        );
        assert!(
            !off.join("inner").exists(),
            "정식 폴더 안에 폴더를 만들지 않음"
        );
        assert_eq!(
            copy_official(&dest, &t.0.join("x")),
            Err("SOURCE_NOT_OFFICIAL".into())
        );
        fs::write(off.join("work-journey.db-journal"), b"").unwrap();
        assert_eq!(
            copy_official(&off, &t.0.join("y")),
            Err("SOURCE_IN_USE".into())
        );
        assert!(copy_official(Path::new("rel"), &dest).is_err());
    }
}
