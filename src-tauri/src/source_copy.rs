//! C-2 원본 읽기(docs/v2-design/81·83, **Preview 빌드에만**). 사용자가 고른 로컬 일지를 **읽기만** 해서
//! Preview 자기 폴더(`…/WorkJourneyBoardConnectedPreview/development/<ref>/snapshots/<id>/`)에 임시 사본을 만든다.
//! - 원본 폴더에는 아무것도 만들거나 바꾸지 않는다(복사는 읽기만, 임시 파일은 Preview 폴더 안).
//! - 정식판·DEV가 쓰는 중(`work-journey.db-journal`·`-wal` 있음)이면 거절 — 그 앱에서 일지를 닫고 다시.
//! - 복사 전후 원본의 크기·수정 시각·SHA-256이 같아야 한다(복사 중 바뀌면 사본을 지우고 거절).
//! - 사본 지우기는 snapshots 아래 우리가 만든 ID 폴더만.

use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const JOURNAL: &str = "work-journey.db";
/// 원본 일지 상한(예전 이미지 base64 포함 실사용 일지 여유) — 넘으면 거절
pub const MAX_SOURCE_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub snapshot_id: String,
    pub bytes: u64,
    pub sha256: String,
}

fn hash_file(p: &Path) -> Result<(u64, String), String> {
    let mut f = fs::File::open(p).map_err(|_| "SOURCE_UNREADABLE".to_string())?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut n = 0u64;
    loop {
        let k = f
            .read(&mut buf)
            .map_err(|_| "SOURCE_UNREADABLE".to_string())?;
        if k == 0 {
            break;
        }
        n += k as u64;
        h.update(&buf[..k]);
    }
    Ok((n, format!("{:x}", h.finalize())))
}
fn modified(p: &Path) -> Option<std::time::SystemTime> {
    fs::metadata(p).ok()?.modified().ok()
}
fn is_id(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_digit() || (b'a'..=b'f').contains(&c)
            }
        })
}

/// 원본 폴더 검사 → 읽기만 복사 → 검증. `root` = Preview 프로젝트 폴더(snapshots를 둘 곳)
pub fn snapshot(root: &Path, source_dir: &Path, id: &str) -> Result<Snapshot, String> {
    if !source_dir.is_absolute() || !root.is_absolute() || !is_id(id) {
        return Err("INVALID_PATH".into());
    }
    let src_dir = fs::canonicalize(source_dir).map_err(|_| "SOURCE_MISSING".to_string())?;
    let src = src_dir.join(JOURNAL);
    let meta = fs::symlink_metadata(&src).map_err(|_| "SOURCE_NOT_JOURNAL".to_string())?;
    if !meta.is_file() {
        return Err("SOURCE_NOT_JOURNAL".into());
    }
    if meta.len() == 0 || meta.len() > MAX_SOURCE_BYTES {
        return Err("SOURCE_SIZE".into());
    }
    for side in ["-journal", "-wal"] {
        if src_dir.join(format!("{JOURNAL}{side}")).exists() {
            return Err("SOURCE_IN_USE".into());
        }
    }
    // 원본과 Preview 폴더가 겹치면 거절(원본 폴더 안에 사본을 만들지 않게)
    fs::create_dir_all(root).map_err(|_| "STORE".to_string())?;
    let root_c = fs::canonicalize(root).map_err(|_| "STORE".to_string())?;
    if root_c.starts_with(&src_dir) || src_dir.starts_with(&root_c) {
        return Err("SOURCE_OVERLAPS_PREVIEW".into());
    }
    let before_m = modified(&src);
    let (before_n, before_h) = hash_file(&src)?;
    let dir = root_c.join("snapshots").join(id);
    if dir.exists() {
        return Err("SNAPSHOT_EXISTS".into());
    }
    fs::create_dir_all(&dir).map_err(|_| "STORE".to_string())?;
    let tmp = dir.join(format!("{JOURNAL}.copying"));
    let done = (|| {
        fs::copy(&src, &tmp).map_err(|_| "SOURCE_UNREADABLE".to_string())?;
        let (n, h) = hash_file(&tmp)?;
        let after_m = modified(&src);
        let (after_n, after_h) = hash_file(&src)?;
        if before_m != after_m
            || before_n != after_n
            || before_h != after_h
            || n != before_n
            || h != before_h
        {
            return Err("SOURCE_CHANGED".to_string());
        }
        fs::rename(&tmp, dir.join(JOURNAL)).map_err(|_| "STORE".to_string())?;
        Ok(Snapshot {
            snapshot_id: id.to_owned(),
            bytes: n,
            sha256: h,
        })
    })();
    if done.is_err() {
        let _ = fs::remove_dir_all(&dir);
    }
    done
}

/// 고른 폴더 바로 아래(한 단계) 하위 폴더 중 일지 파일이 있는 곳 — 이름순, 최대 20개.
/// 목록만 읽는다(파일 내용·더 깊은 폴더·바로 가기/심볼릭 링크는 보지 않음). 고른 폴더 자체에 일지가 있으면 그것 하나.
pub fn candidates(source_dir: &Path) -> Result<Vec<String>, String> {
    if !source_dir.is_absolute() {
        return Err("INVALID_PATH".into());
    }
    let dir = fs::canonicalize(source_dir).map_err(|_| "SOURCE_MISSING".to_string())?;
    let is_journal = |d: &Path| fs::symlink_metadata(d.join(JOURNAL)).is_ok_and(|m| m.is_file());
    if is_journal(&dir) {
        return Ok(vec![dir.to_string_lossy().into_owned()]);
    }
    let mut out: Vec<String> = fs::read_dir(&dir)
        .map_err(|_| "SOURCE_UNREADABLE".to_string())?
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| e.path())
        .filter(|p| is_journal(p))
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    out.sort();
    out.truncate(20);
    Ok(out)
}

fn snapshot_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !is_id(id) {
        return Err("INVALID_SNAPSHOT".into());
    }
    Ok(root.join("snapshots").join(id).join(JOURNAL))
}
pub fn read(root: &Path, id: &str) -> Result<Vec<u8>, String> {
    fs::read(snapshot_path(root, id)?).map_err(|_| "SNAPSHOT_MISSING".to_string())
}
pub fn remove(root: &Path, id: &str) -> Result<(), String> {
    let file = snapshot_path(root, id)?;
    let dir = file
        .parent()
        .ok_or_else(|| "INVALID_SNAPSHOT".to_string())?;
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|_| "STORE".to_string())?;
    }
    Ok(())
}

// ── Tauri 명령(Preview 빌드만) ──
use tauri::AppHandle;

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    crate::online::project_root(app)
}
#[tauri::command]
pub fn source_snapshot(app: AppHandle, dir: String) -> Result<Snapshot, String> {
    snapshot(
        &root(&app)?,
        Path::new(&dir),
        &uuid::Uuid::new_v4().to_string(),
    )
}
/// 사본 바이트(원시 바이트로 — JSON 배열로 바꾸지 않음)
#[tauri::command]
pub fn source_snapshot_read(
    app: AppHandle,
    snapshot_id: String,
) -> Result<tauri::ipc::Response, String> {
    Ok(tauri::ipc::Response::new(read(&root(&app)?, &snapshot_id)?))
}
#[tauri::command]
pub fn source_candidates(dir: String) -> Result<Vec<String>, String> {
    candidates(Path::new(&dir))
}
#[tauri::command]
pub fn source_snapshot_remove(app: AppHandle, snapshot_id: String) -> Result<(), String> {
    remove(&root(&app)?, &snapshot_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Tmp(PathBuf);
    impl Tmp {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!("wjb-src-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&p).unwrap();
            Self(fs::canonicalize(p).unwrap())
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn listing(d: &Path) -> Vec<(String, u64)> {
        let mut v: Vec<_> = fs::read_dir(d)
            .unwrap()
            .map(|e| {
                let e = e.unwrap();
                (
                    e.file_name().to_string_lossy().into_owned(),
                    e.metadata().unwrap().len(),
                )
            })
            .collect();
        v.sort();
        v
    }
    fn setup() -> (Tmp, PathBuf, PathBuf) {
        let t = Tmp::new();
        let src = t.0.join("journal");
        fs::create_dir_all(src.join("backups")).unwrap();
        fs::write(src.join(JOURNAL), b"SQLite format 3\0 synthetic journal").unwrap();
        fs::write(src.join("backups").join("work-journey_2026-11-01.db"), b"B").unwrap();
        let root = t.0.join("preview").join("development").join("ref");
        (t, src, root)
    }
    const ID: &str = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

    #[test]
    fn copies_by_reading_only_and_leaves_source_untouched() {
        let (_t, src, root) = setup();
        let before = listing(&src);
        let m = modified(&src.join(JOURNAL));
        let s = snapshot(&root, &src, ID).unwrap();
        assert_eq!(s.bytes, fs::metadata(src.join(JOURNAL)).unwrap().len());
        assert_eq!(
            read(&root, ID).unwrap(),
            fs::read(src.join(JOURNAL)).unwrap()
        );
        assert_eq!(listing(&src), before, "원본 폴더에 새 파일 없음");
        assert_eq!(modified(&src.join(JOURNAL)), m, "원본 수정 시각 그대로");
        assert_eq!(snapshot(&root, &src, ID), Err("SNAPSHOT_EXISTS".into()));
        remove(&root, ID).unwrap();
        assert_eq!(read(&root, ID), Err("SNAPSHOT_MISSING".into()));
        assert!(src.join(JOURNAL).exists());
    }

    #[test]
    fn candidates_find_journal_one_level_down_only() {
        let (t, src, _root) = setup();
        // 고른 폴더에 일지가 있으면 그것 하나
        assert_eq!(
            candidates(&src).unwrap(),
            vec![src.to_string_lossy().into_owned()]
        );
        // 상위 폴더: 한 단계 아래 일지 폴더만(더 깊은 곳·일지 없는 폴더·파일은 아님)
        let parent = t.0.clone();
        fs::create_dir_all(parent.join("empty-dir")).unwrap();
        fs::create_dir_all(parent.join("deep").join("inner")).unwrap();
        fs::write(parent.join("deep").join("inner").join(JOURNAL), b"x").unwrap();
        fs::write(parent.join("loose.txt"), b"x").unwrap();
        assert_eq!(
            candidates(&parent).unwrap(),
            vec![src.to_string_lossy().into_owned()]
        );
        assert_eq!(
            candidates(Path::new("relative")),
            Err("INVALID_PATH".into())
        );
        assert_eq!(
            candidates(&parent.join("nope")),
            Err("SOURCE_MISSING".into())
        );
    }

    #[test]
    fn refuses_in_use_missing_overlapping_and_bad_ids() {
        let (t, src, root) = setup();
        fs::write(src.join("work-journey.db-journal"), b"").unwrap();
        assert_eq!(snapshot(&root, &src, ID), Err("SOURCE_IN_USE".into()));
        fs::remove_file(src.join("work-journey.db-journal")).unwrap();
        assert_eq!(
            snapshot(&root, &t.0.join("nope"), ID),
            Err("SOURCE_MISSING".into())
        );
        let empty = t.0.join("empty");
        fs::create_dir_all(&empty).unwrap();
        assert_eq!(
            snapshot(&root, &empty, ID),
            Err("SOURCE_NOT_JOURNAL".into())
        );
        // Preview 폴더가 원본 안·원본이 Preview 폴더 안
        assert_eq!(
            snapshot(&src.join("inner"), &src, ID),
            Err("SOURCE_OVERLAPS_PREVIEW".into())
        );
        assert!(!src.join("inner").join("snapshots").exists());
        assert_eq!(
            snapshot(&root, Path::new("relative"), ID),
            Err("INVALID_PATH".into())
        );
        assert_eq!(snapshot(&root, &src, "../x"), Err("INVALID_PATH".into()));
        assert_eq!(read(&root, "../../etc"), Err("INVALID_SNAPSHOT".into()));
        assert_eq!(remove(&root, "x"), Err("INVALID_SNAPSHOT".into()));
    }
}
