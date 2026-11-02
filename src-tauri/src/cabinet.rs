//! Cabinet(features-1102-spec F5): 등록한 작업 폴더를 **읽기·열기만** 한다. 지우기·이름 바꾸기·옮기기·복사 없음(CLAUDE.md 4-3).
//! - `cabinet_set_roots`: 메인 창이 등록한 폴더 목록을 알려 준다(일지 안 cabinet_item) — 이 목록과 그 하위만 허용.
//! - `cabinet_list`: 이름·종류·크기·수정 시각·숨김 여부만(파일 내용을 읽지 않음).
//! - `cabinet_open`/`cabinet_reveal`: OS 기본 앱으로 열기 / 탐색기에서 보기(opener 플러그인).
//! - 윈도우: 메인 창에 탐색기에서 끌어 놓은 파일·폴더의 경로를 WebView2 `postMessageWithAdditionalObjects`로 받는다(A안).

use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

/// 등록한 폴더(경로 글 그대로). 검사할 때마다 정규화한다 — 나중에 연결되는 네트워크 드라이브도 받도록
#[derive(Default)]
pub struct CabinetRoots(Mutex<Vec<String>>);

#[derive(Serialize)]
pub struct FsEntry {
    name: String,
    dir: bool,
    size: Option<u64>,
    /// 수정한 시각(밀리초)
    modified: Option<i64>,
    /// 숨김·시스템 파일(윈도우 속성) 또는 점으로 시작하는 이름
    hidden: bool,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// 경로가 등록 폴더(또는 그 하위)인가. `..` 조각·상대 경로는 정규화 전에 거부, 정규화(링크·대소문자 풀기) 뒤 접두어 비교.
fn within_roots(roots: &[String], path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path);
    if path.is_empty()
        || path.chars().any(|c| c.is_control())
        || !p.is_absolute()
        || p.components().any(|c| matches!(c, Component::ParentDir))
    {
        return Err("등록한 폴더 안의 경로만 열 수 있습니다".into());
    }
    let canon = fs::canonicalize(p).map_err(|_| "폴더나 파일을 찾을 수 없습니다".to_string())?;
    let ok = roots.iter().any(|r| {
        let rp = Path::new(r);
        rp.is_absolute()
            && !rp.components().any(|c| matches!(c, Component::ParentDir))
            && fs::canonicalize(rp)
                .map(|rc| canon.starts_with(&rc))
                .unwrap_or(false)
    });
    if ok {
        Ok(canon)
    } else {
        Err("등록한 폴더 안의 경로만 열 수 있습니다".into())
    }
}

#[cfg(windows)]
fn is_hidden(m: &fs::Metadata, name: &str) -> bool {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN: u32 = 0x2;
    const SYSTEM: u32 = 0x4;
    m.file_attributes() & (HIDDEN | SYSTEM) != 0 || name.starts_with('.')
}

#[cfg(not(windows))]
fn is_hidden(_m: &fs::Metadata, name: &str) -> bool {
    name.starts_with('.')
}

fn list_dir(dir: &Path) -> Result<Vec<FsEntry>, String> {
    let mut out = vec![];
    for entry in fs::read_dir(dir).map_err(err)?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        // 링크(바로 가기 폴더)는 따라가서 폴더인지 본다 — 들어갈 때 다시 등록 폴더 안인지 검사
        let Ok(meta) = fs::metadata(entry.path()).or_else(|_| entry.metadata()) else {
            continue;
        };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64);
        out.push(FsEntry {
            hidden: is_hidden(&meta, &name),
            dir: meta.is_dir(),
            size: meta.is_file().then(|| meta.len()),
            modified,
            name,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn cabinet_set_roots(state: State<CabinetRoots>, roots: Vec<String>) {
    *state.0.lock().unwrap() = roots.into_iter().take(2000).collect();
}

#[tauri::command]
pub fn cabinet_list(state: State<CabinetRoots>, path: String) -> Result<Vec<FsEntry>, String> {
    let roots = state.0.lock().unwrap().clone();
    let dir = within_roots(&roots, &path)?;
    if !dir.is_dir() {
        return Err("폴더가 아닙니다".into());
    }
    list_dir(&dir)
}

#[tauri::command]
pub fn cabinet_open(
    app: AppHandle,
    state: State<CabinetRoots>,
    path: String,
) -> Result<(), String> {
    let roots = state.0.lock().unwrap().clone();
    within_roots(&roots, &path)?;
    // 검사를 통과한 원래 경로 글을 넘긴다(정규화한 \\?\ 경로는 일부 앱이 못 연다)
    app.opener().open_path(path, None::<&str>).map_err(err)
}

#[tauri::command]
pub fn cabinet_reveal(
    app: AppHandle,
    state: State<CabinetRoots>,
    path: String,
) -> Result<(), String> {
    let roots = state.0.lock().unwrap().clone();
    within_roots(&roots, &path)?;
    app.opener().reveal_item_in_dir(path).map_err(err)
}

/// 끌어 놓기 다리를 단 창(창마다 한 번만 — 처리기가 겹치면 같은 경로가 두 번 온다)
#[derive(Default)]
pub struct DropBridges(Mutex<std::collections::HashSet<String>>);

impl DropBridges {
    /// 처음 다는 창이면 true
    pub fn claim(&self, label: &str) -> bool {
        self.0.lock().unwrap().insert(label.to_string())
    }
}

/// Cabinet 창(improve-1102-spec C1)이 켜질 때 부른다 — 그 창에 끌어 놓기 다리(A안)를 단다(윈도우만, 창마다 한 번)
#[tauri::command]
pub fn cabinet_drop_bridge(window: tauri::WebviewWindow, state: State<DropBridges>) {
    if !state.claim(window.label()) {
        return;
    }
    #[cfg(windows)]
    install_drop_bridge(&window);
    #[cfg(not(windows))]
    let _ = window;
}

/// 끌어 놓은 윈도우 바로 가기(`.lnk`)가 가리키는 경로(improve-1102v7 K2) — 바로 가기의 대상 경로만 읽는다.
/// 등록할지는 웹 화면이 그 경로가 폴더인지 확인해 정한다. 윈도우가 아니거나 읽지 못하면 None
#[tauri::command]
pub fn cabinet_resolve_shortcut(path: String) -> Option<String> {
    if !path.to_ascii_lowercase().ends_with(".lnk") {
        return None;
    }
    resolve_lnk(&path)
}

#[cfg(windows)]
fn resolve_lnk(path: &str) -> Option<String> {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
        STGM_READ,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
    unsafe {
        // 이미 초기화된 스레드면 실패해도 그대로 쓴다
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let file: IPersistFile = link.cast().ok()?;
        file.Load(&HSTRING::from(path), STGM_READ).ok()?;
        let mut buf = [0u16; 2048];
        link.GetPath(&mut buf, std::ptr::null_mut(), 0).ok()?;
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        let s = String::from_utf16_lossy(&buf[..end]);
        (!s.is_empty()).then_some(s)
    }
}

#[cfg(not(windows))]
fn resolve_lnk(_path: &str) -> Option<String> {
    None
}

/// 웹 화면이 끌어 놓은 파일을 넘길 때 쓰는 약속 글(src/platform/tauri.ts와 같아야 한다)
pub const DROP_MESSAGE: &str = "wjb-cabinet-drop";
/// 받은 경로를 웹 화면에 돌려주는 이벤트
pub const DROP_EVENT: &str = "cabinet-drop";

/// 메인 창 WebView2에 끌어 놓기 다리를 단다(A안, 윈도우만). 웹 화면은 끌어 놓기 그대로(dragDropEnabled false)이고,
/// 놓은 File 객체를 `chrome.webview.postMessageWithAdditionalObjects(DROP_MESSAGE, files)`로 넘기면 여기서 경로를 꺼내
/// `DROP_EVENT`로 돌려준다. 파일 내용은 읽지 않는다. 다른 메시지는 건드리지 않는다(Tauri IPC는 자기 처리기가 따로 받음).
#[cfg(windows)]
pub fn install_drop_bridge(window: &tauri::WebviewWindow) {
    use tauri::Emitter;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs2,
    };
    use webview2_com::{take_pwstr, WebMessageReceivedEventHandler};
    use windows::core::{Interface, PWSTR};

    let target = window.clone();
    let _ = window.with_webview(move |wv| unsafe {
        let Ok(core) = wv.controller().CoreWebView2() else {
            return;
        };
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut msg = PWSTR::null();
            if args.TryGetWebMessageAsString(&mut msg).is_err() {
                return Ok(());
            }
            if take_pwstr(msg) != DROP_MESSAGE {
                return Ok(());
            }
            let mut paths: Vec<String> = vec![];
            if let Ok(args2) = args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>() {
                if let Ok(objs) = args2.AdditionalObjects() {
                    let mut count = 0u32;
                    let _ = objs.Count(&mut count);
                    for i in 0..count.min(200) {
                        let Ok(obj) = objs.GetValueAtIndex(i) else {
                            continue;
                        };
                        let Ok(file) = obj.cast::<ICoreWebView2File>() else {
                            continue;
                        };
                        let mut p = PWSTR::null();
                        if file.Path(&mut p).is_ok() {
                            let s = take_pwstr(p);
                            if !s.is_empty() {
                                paths.push(s);
                            }
                        }
                    }
                }
            }
            let _ = target.emit_to(target.label(), DROP_EVENT, paths);
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_WebMessageReceived(&handler, &mut token);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("wjb-cabinet-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("a").join("b")).unwrap();
        fs::write(d.join("a").join("note.txt"), b"x").unwrap();
        d
    }

    #[test]
    fn shortcut_only_lnk() {
        assert_eq!(cabinet_resolve_shortcut("/tmp/a.txt".into()), None);
        assert_eq!(cabinet_resolve_shortcut("/tmp/없음.lnk".into()), None);
    }

    #[test]
    fn only_registered_roots_and_below() {
        let base = tmp("roots");
        let root = base.join("a");
        let roots = vec![root.to_string_lossy().into_owned()];
        assert!(within_roots(&roots, &root.to_string_lossy()).is_ok());
        assert!(within_roots(&roots, &root.join("b").to_string_lossy()).is_ok());
        assert!(within_roots(&roots, &root.join("note.txt").to_string_lossy()).is_ok());
        // 뿌리 밖·상대·.. 조각·없는 경로·빈 목록
        assert!(within_roots(&roots, &base.to_string_lossy()).is_err());
        assert!(within_roots(&roots, "a/b").is_err());
        let up = format!(
            "{}{}..{}a",
            root.join("b").to_string_lossy(),
            std::path::MAIN_SEPARATOR,
            std::path::MAIN_SEPARATOR
        );
        assert!(within_roots(&roots, &up).is_err());
        assert!(within_roots(&roots, &root.join("없음").to_string_lossy()).is_err());
        assert!(within_roots(&[], &root.to_string_lossy()).is_err());
        // 이름이 같은 접두어 폴더(a2)는 하위가 아니다
        fs::create_dir_all(base.join("a2")).unwrap();
        assert!(within_roots(&roots, &base.join("a2").to_string_lossy()).is_err());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn list_reads_names_only() {
        let base = tmp("list");
        fs::write(base.join("a").join(".hidden"), b"y").unwrap();
        let mut list = list_dir(&base.join("a")).unwrap();
        list.sort_by(|x, y| x.name.cmp(&y.name));
        let v: Vec<(String, bool, Option<u64>, bool)> = list
            .iter()
            .map(|e| (e.name.clone(), e.dir, e.size, e.hidden))
            .collect();
        assert_eq!(
            v,
            vec![
                (".hidden".into(), false, Some(1), true),
                ("b".into(), true, None, false),
                ("note.txt".into(), false, Some(1), false),
            ]
        );
        assert!(list.iter().all(|e| e.modified.is_some()));
        let _ = fs::remove_dir_all(&base);
    }
}
