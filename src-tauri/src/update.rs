//! 새 판 확인·내려받기·설치(improve-1027v4-spec 1절 B안, 2026-10-27 사용자 확정).
//! 앱에서 인터넷으로 나가는 통신은 이 모듈뿐이다 — GitHub Releases(아래 저장소 하나)의 판 목록·설치 파일·SHA256SUMS만.
//! 웹 화면(CSP `connect-src`)은 그대로 외부 통신 0이고, 기록·메모 등 사용자 데이터는 어디에도 보내지 않는다.
//! 확인한 판의 주소·해시는 이 모듈이 들고 있고, 웹 화면은 "확인/내려받기/설치"만 부른다(주소를 넘기지 않음).

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// 판 목록(사전 릴리스 포함 — 이 앱은 사전 릴리스로 배포한다)
const RELEASES_API: &str =
    "https://api.github.com/repos/chs2147/work-journey-board/releases?per_page=10";
/// 내려받기는 GitHub 주소에서만(리디렉션 대상 objects.githubusercontent.com 등은 reqwest가 따라감)
const ALLOWED_PREFIXES: [&str; 2] = [
    "https://github.com/chs2147/work-journey-board/releases/download/",
    "https://api.github.com/repos/chs2147/work-journey-board/",
];
const SUMS_NAME: &str = "SHA256SUMS.txt";

#[derive(Default)]
pub struct UpdateState(Mutex<Option<Pending>>);

#[derive(Clone, Debug)]
struct Pending {
    version: String,
    exe_url: String,
    exe_name: String,
    sha256: Option<String>,
    path: Option<PathBuf>,
}

/// 웹 화면에 넘기는 새 판 정보(주소는 넘기지 않는다)
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    /// 릴리스 노트(본문 마크다운)
    pub notes: String,
    pub size: u64,
    /// SHA256SUMS.txt가 있어 무결성을 확인할 수 있는가
    pub has_hash: bool,
}

/// `x.y.z` → (x, y, z). 앞의 `v`는 뗀다. 숫자 세 개가 아니면 None
fn parse_version(s: &str) -> Option<(u64, u64, u64)> {
    let mut it = s.trim().trim_start_matches('v').split('.');
    let v = (
        it.next()?.parse().ok()?,
        it.next()?.parse().ok()?,
        it.next()?.parse().ok()?,
    );
    if it.next().is_some() {
        return None;
    }
    Some(v)
}

/// 설치 파일 이름(build-desktop.yml과 같은 규칙) — 윈도우 NSIS exe, 맥 유니버설 DMG(macos-spec 3-5)
fn installer_name_for(os: &str, version: &str) -> String {
    if os == "macos" {
        format!("WorkJourneyBoard_{version}_mac.dmg")
    } else {
        format!("WorkJourneyBoard_{version}_setup.exe")
    }
}

fn installer_name(version: &str) -> String {
    installer_name_for(std::env::consts::OS, version)
}

#[derive(Debug, PartialEq)]
struct Candidate {
    version: String,
    notes: String,
    exe_url: String,
    size: u64,
    sums_url: Option<String>,
}

/// 판 목록 JSON에서 지금보다 높은 판 중 가장 높은 것(초안 제외, 설치 파일이 있는 것만)
fn pick_release(json: &serde_json::Value, current: &str, os: &str) -> Option<Candidate> {
    let cur = parse_version(current)?;
    let mut best: Option<((u64, u64, u64), Candidate)> = None;
    for r in json.as_array()? {
        if r["draft"].as_bool().unwrap_or(true) {
            continue;
        }
        let Some(tag) = r["tag_name"].as_str() else {
            continue;
        };
        let Some(v) = parse_version(tag) else {
            continue;
        };
        if v <= cur || best.as_ref().is_some_and(|(b, _)| v <= *b) {
            continue;
        }
        let version = format!("{}.{}.{}", v.0, v.1, v.2);
        let assets = r["assets"].as_array().cloned().unwrap_or_default();
        let find = |name: &str| assets.iter().find(|a| a["name"].as_str() == Some(name));
        let Some(exe) = find(&installer_name_for(os, &version)) else {
            continue;
        };
        let Some(exe_url) = exe["browser_download_url"].as_str() else {
            continue;
        };
        best = Some((
            v,
            Candidate {
                version,
                notes: r["body"].as_str().unwrap_or("").to_owned(),
                exe_url: exe_url.to_owned(),
                size: exe["size"].as_u64().unwrap_or(0),
                sums_url: find(SUMS_NAME)
                    .and_then(|a| a["browser_download_url"].as_str())
                    .map(str::to_owned),
            },
        ));
    }
    best.map(|(_, c)| c)
}

/// SHA256SUMS.txt(`<해시>  <파일 이름>` 줄들)에서 그 파일의 해시(소문자 64자리)
fn parse_sums(text: &str, name: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let (hash, file) = line.trim().split_once(char::is_whitespace)?;
        let file = file.trim().trim_start_matches('*');
        (file == name && hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()))
            .then(|| hash.to_ascii_lowercase())
    })
}

fn url_allowed(url: &str) -> bool {
    ALLOWED_PREFIXES.iter().any(|p| url.starts_with(p))
}

fn client(app: &AppHandle) -> Result<reqwest::Client, String> {
    let ua = format!("WorkJourneyBoard/{}", app.package_info().version);
    reqwest::Client::builder()
        .user_agent(ua)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("업데이트 확인을 준비하지 못했습니다: {e}"))
}

fn net_err(e: reqwest::Error) -> String {
    format!("GitHub에 연결하지 못했습니다(회사망·프록시에서 막혔을 수 있습니다): {e}")
}

fn updates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("앱 자료 폴더를 찾지 못했습니다: {e}"))?
        .join("updates");
    fs::create_dir_all(&dir).map_err(|e| format!("내려받을 폴더를 만들지 못했습니다: {e}"))?;
    Ok(dir)
}

fn sha256_file(path: &PathBuf) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("설치 파일을 읽지 못했습니다: {e}"))?;
    Ok(format!("{:x}", Sha256::digest(&bytes)))
}

/// 새 판 확인 — 앱을 켤 때 1번과 설정의 [업데이트 확인]. 없으면 None
#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<Option<UpdateInfo>, String> {
    let http = client(&app)?;
    let res = http
        .get(RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(net_err)?;
    if !res.status().is_success() {
        return Err(format!("GitHub 응답이 올바르지 않습니다({})", res.status()));
    }
    let json: serde_json::Value = serde_json::from_slice(&res.bytes().await.map_err(net_err)?)
        .map_err(|e| format!("판 목록을 읽지 못했습니다: {e}"))?;
    let current = app.package_info().version.to_string();
    let Some(c) = pick_release(&json, &current, std::env::consts::OS) else {
        *state.0.lock().unwrap() = None;
        return Ok(None);
    };
    if !url_allowed(&c.exe_url) {
        return Err("설치 파일 주소가 이 앱의 GitHub 저장소가 아닙니다".into());
    }
    let exe_name = installer_name(&c.version);
    let mut sha256 = None;
    if let Some(sums_url) = c.sums_url.as_deref().filter(|u| url_allowed(u)) {
        if let Ok(r) = http
            .get(sums_url)
            .timeout(Duration::from_secs(15))
            .send()
            .await
        {
            if let Ok(text) = r.text().await {
                sha256 = parse_sums(&text, &exe_name);
            }
        }
    }
    let info = UpdateInfo {
        version: c.version.clone(),
        notes: c.notes.clone(),
        size: c.size,
        has_hash: sha256.is_some(),
    };
    *state.0.lock().unwrap() = Some(Pending {
        version: c.version,
        exe_url: c.exe_url,
        exe_name,
        sha256,
        path: None,
    });
    Ok(Some(info))
}

#[derive(Serialize, Clone)]
struct Progress {
    received: u64,
    total: u64,
}

/// 확인한 새 판 설치 파일 내려받기 → 앱 자료 폴더 `updates\` · SHA256 확인. 진행은 `update-progress` 이벤트
#[tauri::command]
pub async fn update_download(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    let pending = state
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or("먼저 업데이트를 확인하세요")?;
    if !url_allowed(&pending.exe_url) {
        return Err("설치 파일 주소가 이 앱의 GitHub 저장소가 아닙니다".into());
    }
    let dir = updates_dir(&app)?;
    // 지난 내려받기 찌꺼기(이 앱이 만든 설치 파일만) 정리 — 앱 자료 폴더 안, 사용자 폴더 아님
    if let Ok(list) = fs::read_dir(&dir) {
        for e in list.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with("WorkJourneyBoard_")
                && (name.ends_with("_setup.exe")
                    || name.ends_with("_mac.dmg")
                    || name.ends_with(".part"))
            {
                let _ = fs::remove_file(e.path());
            }
        }
    }
    let target = dir.join(&pending.exe_name);
    let part = dir.join(format!("{}.part", pending.exe_name));
    let mut res = client(&app)?
        .get(&pending.exe_url)
        .send()
        .await
        .map_err(net_err)?;
    if !res.status().is_success() {
        return Err(format!("설치 파일을 받지 못했습니다({})", res.status()));
    }
    let total = res.content_length().unwrap_or(0);
    let mut file =
        fs::File::create(&part).map_err(|e| format!("내려받을 파일을 만들지 못했습니다: {e}"))?;
    let mut hasher = Sha256::new();
    let (mut received, mut last) = (0u64, 0u64);
    while let Some(chunk) = res.chunk().await.map_err(net_err)? {
        file.write_all(&chunk)
            .map_err(|e| format!("설치 파일을 쓰지 못했습니다: {e}"))?;
        hasher.update(&chunk);
        received += chunk.len() as u64;
        if total == 0 || received - last >= total / 50 {
            last = received;
            let _ = app.emit("update-progress", Progress { received, total });
        }
    }
    file.sync_all()
        .map_err(|e| format!("설치 파일을 쓰지 못했습니다: {e}"))?;
    drop(file);
    let got = format!("{:x}", hasher.finalize());
    if let Some(want) = &pending.sha256 {
        if &got != want {
            let _ = fs::remove_file(&part);
            return Err("받은 설치 파일이 SHA256SUMS와 다릅니다 — 설치하지 않습니다".into());
        }
    }
    fs::rename(&part, &target).map_err(|e| format!("설치 파일을 옮기지 못했습니다: {e}"))?;
    let _ = app.emit(
        "update-progress",
        Progress {
            received,
            total: received,
        },
    );
    let mut st = state.0.lock().unwrap();
    if let Some(p) = st.as_mut().filter(|p| p.version == pending.version) {
        p.path = Some(target);
        if p.sha256.is_none() {
            p.sha256 = Some(got); // 무결성 파일이 없으면 받은 그대로를 기준으로(설치 직전 바뀌지 않았는지만 확인)
        }
    }
    Ok(())
}

/// 내려받은 설치 파일 실행(진행 막대만 보이는 설치, 끝나면 앱 다시 실행) 후 앱 종료.
/// 실행 직전 이름·위치·SHA256을 다시 확인한다. 일지 자동 백업은 웹 화면이 부르기 전에 끝낸다.
#[tauri::command]
pub fn update_install(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    let pending = state
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or("먼저 업데이트를 확인하세요")?;
    let path = pending
        .path
        .clone()
        .ok_or("먼저 설치 파일을 내려받으세요")?;
    let dir = updates_dir(&app)?;
    if path.parent() != Some(dir.as_path())
        || path.file_name().and_then(|n| n.to_str()) != Some(pending.exe_name.as_str())
    {
        return Err("설치 파일 위치가 올바르지 않습니다".into());
    }
    if Some(sha256_file(&path)?) != pending.sha256 {
        return Err("설치 파일이 내려받은 뒤 바뀌었습니다 — 설치하지 않습니다".into());
    }
    #[cfg(windows)]
    {
        std::process::Command::new(&path)
            .args(["/P", "/R"])
            .spawn()
            .map_err(|e| {
                format!(
                    "설치 파일을 실행하지 못했습니다(백신·SmartScreen이 막았을 수 있습니다): {e}"
                )
            })?;
        app.exit(0);
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        mac::install(&path, &pending.version)?;
        app.exit(0);
        Ok(())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = app;
        Err("윈도우·맥에서만 설치할 수 있습니다".into())
    }
}

/// 맥 앱 번들 교체 경로(macos-spec 3-5, 2026-11-02 사용자 승인 D7 — CLAUDE.md 4-3 앱 번들 예외).
/// 실행 파일(`…/X.app/Contents/MacOS/bin`) → (지금 번들, 새 판을 복사해 둘 `X.app.new`, 옛 판을 잠시 둘 `X.app.old`).
/// 앱 이동 보호(임시 위치)·디스크 이미지 안에서 실행 중이면 교체하지 않는다.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn bundle_paths(exe: &Path) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let bundle = exe
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .filter(|b| {
            exe.parent().and_then(Path::file_name) == Some("MacOS".as_ref())
                && b.extension() == Some("app".as_ref())
        })
        .ok_or("앱 위치를 확인하지 못했습니다")?
        .to_path_buf();
    let text = bundle.to_string_lossy();
    if text.contains("/AppTranslocation/") || text.starts_with("/Volumes/") {
        return Err(
            "앱을 응용 프로그램 폴더로 옮긴 뒤 다시 실행해야 업데이트할 수 있습니다(디스크 이미지·임시 위치에서 실행 중)"
                .into(),
        );
    }
    let name = bundle
        .file_name()
        .ok_or("앱 위치를 확인하지 못했습니다")?
        .to_string_lossy()
        .into_owned();
    let staged = bundle.with_file_name(format!("{name}.new"));
    let old = bundle.with_file_name(format!("{name}.old"));
    Ok((bundle, staged, old))
}

/// 지울 수 있는 것은 지금 번들 바로 옆의 `X.app.new`·`X.app.old` 둘뿐(이중 가드 — 경로 계산과 따로 다시 본다)
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn removable_leftover(bundle: &Path, target: &Path) -> bool {
    let (Some(dir), Some(name)) = (bundle.parent(), bundle.file_name()) else {
        return false;
    };
    let name = name.to_string_lossy();
    name.ends_with(".app")
        && target.parent() == Some(dir)
        && [format!("{name}.new"), format!("{name}.old")]
            .iter()
            .any(|n| target.file_name() == Some(n.as_ref()))
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{bundle_paths, removable_leftover};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    fn run(cmd: &mut Command, what: &str) -> Result<String, String> {
        let out = cmd.output().map_err(|e| format!("{what} 실행 실패: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "{what} 실패: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    fn remove_leftover(bundle: &Path, target: &Path) {
        if target.exists() && removable_leftover(bundle, target) {
            let _ = fs::remove_dir_all(target);
        }
    }

    /// 받은 DMG를 열어(읽기 전용, Finder에 안 보이게) 앱을 꺼내 지금 번들과 바꾼다. 끝나면 앱이 꺼진 뒤 새 판을 연다.
    /// 응용 프로그램 폴더에 쓸 권한이 없으면 DMG를 Finder로 열어 주고 직접 바꾸도록 안내한다(D7 B 길).
    pub fn install(dmg: &PathBuf, version: &str) -> Result<(), String> {
        let exe =
            std::env::current_exe().map_err(|e| format!("앱 위치를 확인하지 못했습니다: {e}"))?;
        let (bundle, staged, old) = bundle_paths(&exe)?;
        let mount = dmg.with_extension("mnt");
        let _ = Command::new("hdiutil")
            .args(["detach", "-force"])
            .arg(&mount)
            .output();
        let _ = fs::create_dir_all(&mount);
        run(
            Command::new("hdiutil")
                .args([
                    "attach",
                    "-nobrowse",
                    "-readonly",
                    "-noautoopen",
                    "-mountpoint",
                ])
                .arg(&mount)
                .arg(dmg),
            "디스크 이미지 열기",
        )?;
        let result = (|| -> Result<(), String> {
            let src = fs::read_dir(&mount)
                .map_err(|e| format!("디스크 이미지를 읽지 못했습니다: {e}"))?
                .flatten()
                .map(|e| e.path())
                .find(|p| p.extension() == Some("app".as_ref()))
                .ok_or("디스크 이미지에 앱이 없습니다")?;
            let plist = src.join("Contents/Info.plist");
            let got = run(
                Command::new("/usr/libexec/PlistBuddy")
                    .args(["-c", "Print :CFBundleShortVersionString"])
                    .arg(&plist),
                "판 번호 확인",
            )?;
            if got.trim() != version {
                return Err(format!(
                    "디스크 이미지의 판({})이 받은 판({version})과 다릅니다",
                    got.trim()
                ));
            }
            remove_leftover(&bundle, &staged);
            if let Err(e) = run(Command::new("ditto").arg(&src).arg(&staged), "새 판 복사") {
                remove_leftover(&bundle, &staged);
                // 권한이 없으면 사용자가 직접 끌어 놓아 바꾸도록 DMG를 Finder로 연다
                let _ = Command::new("open").arg(dmg).spawn();
                return Err(format!(
                    "응용 프로그램 폴더에 쓸 수 없어 설치 파일을 열었습니다 — 앱을 끝낸 뒤 새 판을 응용 프로그램 폴더로 끌어 놓아 바꿔 주세요 ({e})"
                ));
            }
            Ok(())
        })();
        let _ = Command::new("hdiutil")
            .args(["detach", "-force"])
            .arg(&mount)
            .output();
        let _ = fs::remove_dir(&mount);
        result?;
        // 바꿔치기: 지금 → .old, .new → 지금. 둘째가 실패하면 되돌린다
        remove_leftover(&bundle, &old);
        fs::rename(&bundle, &old).map_err(|e| {
            remove_leftover(&bundle, &staged);
            format!("지금 앱을 옮기지 못했습니다: {e}")
        })?;
        if let Err(e) = fs::rename(&staged, &bundle) {
            let _ = fs::rename(&old, &bundle);
            remove_leftover(&bundle, &staged);
            return Err(format!("새 판으로 바꾸지 못했습니다: {e}"));
        }
        remove_leftover(&bundle, &old);
        // 이 앱이 끝난 뒤 새 판을 연다(지금 열면 단일 실행 규칙에 걸려 바로 꺼진다)
        Command::new("/bin/sh")
            .args([
                "-c",
                "while kill -0 \"$1\" 2>/dev/null; do sleep 0.2; done; open \"$2\"",
                "sh",
            ])
            .arg(std::process::id().to_string())
            .arg(&bundle)
            .spawn()
            .map_err(|e| format!("새 판을 다시 열지 못했습니다(직접 열어 주세요): {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn release(tag: &str, draft: bool, assets: &[&str]) -> serde_json::Value {
        json!({
            "tag_name": tag,
            "draft": draft,
            "prerelease": true,
            "body": format!("{tag} 노트"),
            "assets": assets.iter().map(|n| json!({
                "name": n,
                "size": 1000,
                "browser_download_url": format!("https://github.com/chs2147/work-journey-board/releases/download/{tag}/{n}"),
            })).collect::<Vec<_>>(),
        })
    }

    #[test]
    fn versions() {
        assert_eq!(parse_version("v0.2.19"), Some((0, 2, 19)));
        assert_eq!(parse_version("0.10.0"), Some((0, 10, 0)));
        assert_eq!(parse_version("v0.2"), None);
        assert_eq!(parse_version("v0.2.1.4"), None);
        assert_eq!(parse_version("v0.2.x"), None);
        assert!(parse_version("0.10.0") > parse_version("0.9.9"));
    }

    #[test]
    fn picks_highest_newer_release_with_installer() {
        let list = json!([
            release("v0.2.21", true, &["WorkJourneyBoard_0.2.21_setup.exe"]), // 초안
            release("v0.2.20", false, &["SHA256SUMS.txt"]),                   // 설치 파일 없음
            release(
                "v0.2.19",
                false,
                &["WorkJourneyBoard_0.2.19_setup.exe", "SHA256SUMS.txt"]
            ),
            release("v0.2.18", false, &["WorkJourneyBoard_0.2.18_setup.exe"]),
            release("v0.2.10", false, &["WorkJourneyBoard_0.2.10_setup.exe"]),
        ]);
        let c = pick_release(&list, "0.2.18", "windows").unwrap();
        assert_eq!(c.version, "0.2.19");
        assert!(c
            .exe_url
            .ends_with("/v0.2.19/WorkJourneyBoard_0.2.19_setup.exe"));
        assert!(c.sums_url.unwrap().ends_with("/SHA256SUMS.txt"));
        assert_eq!(c.notes, "v0.2.19 노트");
        assert_eq!(pick_release(&list, "0.2.19", "windows"), None);
        assert_eq!(
            pick_release(&json!({"message": "rate limit"}), "0.2.18", "windows"),
            None
        );
    }

    /// 맥 번들 교체 경로·가드(macos-spec 3-5): 지울 수 있는 것은 번들 옆 .new·.old뿐, 임시 위치·DMG 안 실행은 거부
    #[test]
    fn mac_bundle_swap_guard() {
        let exe =
            Path::new("/Applications/Work Journey Board.app/Contents/MacOS/work-journey-board");
        let (bundle, staged, old) = bundle_paths(exe).unwrap();
        assert_eq!(bundle, Path::new("/Applications/Work Journey Board.app"));
        assert_eq!(
            staged,
            Path::new("/Applications/Work Journey Board.app.new")
        );
        assert_eq!(old, Path::new("/Applications/Work Journey Board.app.old"));
        assert!(removable_leftover(&bundle, &staged));
        assert!(removable_leftover(&bundle, &old));
        for bad in [
            "/Applications/Work Journey Board.app",
            "/Applications",
            "/Applications/Other.app.old",
            "/Users/me/Work Journey Board.app.old",
            "/Applications/Work Journey Board.app.old/Contents",
            "/Applications/Work Journey Board.app.bak",
        ] {
            assert!(!removable_leftover(&bundle, Path::new(bad)), "{bad}");
        }
        // 사용자 홈의 응용 프로그램 폴더도 된다
        assert!(bundle_paths(Path::new(
            "/Users/me/Applications/Work Journey Board.app/Contents/MacOS/x"
        ))
        .is_ok());
        for bad in [
            "/private/var/folders/x/T/AppTranslocation/ABC/d/Work Journey Board.app/Contents/MacOS/x",
            "/Volumes/Work Journey Board/Work Journey Board.app/Contents/MacOS/x",
            "/usr/local/bin/work-journey-board",
            "/Applications/Work Journey Board/Contents/MacOS/x",
        ] {
            assert!(bundle_paths(Path::new(bad)).is_err(), "{bad}");
        }
    }

    /// 한 릴리스에 윈도우·맥 설치 파일이 함께 있다(macos-spec 4-1) — 각자 자기 파일만 고른다.
    /// 1.5.0 이하 윈도우 판은 맥 파일이 더해져도 그대로 exe를 찾는다
    #[test]
    fn picks_installer_for_each_os() {
        let list = json!([release(
            "v1.6.0",
            false,
            &[
                "WorkJourneyBoard_1.6.0_setup.exe",
                "WorkJourneyBoard_1.6.0_mac.dmg",
                "SHA256SUMS.txt"
            ]
        )]);
        let win = pick_release(&list, "1.5.0", "windows").unwrap();
        assert!(win.exe_url.ends_with("/WorkJourneyBoard_1.6.0_setup.exe"));
        let mac = pick_release(&list, "1.5.0", "macos").unwrap();
        assert!(mac.exe_url.ends_with("/WorkJourneyBoard_1.6.0_mac.dmg"));
        // 맥 파일이 없는 옛 릴리스(1.5.0)는 맥에 새 판으로 보이지 않는다
        let old = json!([release(
            "v1.5.0",
            false,
            &["WorkJourneyBoard_1.5.0_setup.exe"]
        )]);
        assert_eq!(pick_release(&old, "1.4.0", "macos"), None);
        // 두 파일이 든 SHA256SUMS.txt에서 각자 해시를 찾는다
        let (a, b) = ("a".repeat(64), "b".repeat(64));
        let sums =
            format!("{a}  WorkJourneyBoard_1.6.0_setup.exe\n{b}  WorkJourneyBoard_1.6.0_mac.dmg\n");
        assert_eq!(
            parse_sums(&sums, &installer_name_for("macos", "1.6.0")),
            Some(b.clone())
        );
        assert_eq!(
            parse_sums(&sums, &installer_name_for("windows", "1.6.0")),
            Some(a)
        );
    }

    #[test]
    fn sums_lookup() {
        let h = "a".repeat(64);
        let text = format!(
            "{h}  WorkJourneyBoard_0.2.19_setup.exe\r\n{}  other.exe\n",
            "b".repeat(64)
        );
        assert_eq!(
            parse_sums(&text, "WorkJourneyBoard_0.2.19_setup.exe"),
            Some(h)
        );
        assert_eq!(parse_sums(&text, "WorkJourneyBoard_0.2.18_setup.exe"), None);
        assert_eq!(
            parse_sums(
                "xyz  WorkJourneyBoard_0.2.19_setup.exe",
                "WorkJourneyBoard_0.2.19_setup.exe"
            ),
            None
        );
    }

    #[test]
    fn only_this_repo_urls() {
        assert!(url_allowed(
            "https://github.com/chs2147/work-journey-board/releases/download/v0.2.19/WorkJourneyBoard_0.2.19_setup.exe"
        ));
        assert!(!url_allowed(
            "https://github.com/someone/else/releases/download/v1/x.exe"
        ));
        assert!(!url_allowed(
            "http://github.com/chs2147/work-journey-board/releases/download/v1/x.exe"
        ));
        assert!(!url_allowed(
            "https://evil.example/chs2147/work-journey-board/"
        ));
    }
}
