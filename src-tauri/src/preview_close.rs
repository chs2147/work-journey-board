//! Connected Preview 앱 닫기(Rust가 주도 — docs/v2-design/91 5-3). E-3 실기: 화면(JS)의 닫기 처리가 Windows에서
//! 기대대로 돌지 않아 안내 없이 안전장치 시간까지 기다렸다. 이제 순서를 Rust가 정한다.
//! 1) 메인 창 닫기 요청 → (열린 온라인 공간 일지가 없으면 바로 종료)
//! 2) 닫기를 막고 화면에 `preview-closing` 신호 → 화면은 즉시 "저장하고 종료하는 중…"을 덮고 저장한 뒤 `preview_exit`
//! 3) 화면 응답 또는 4초 → 열린 공간 일지 닫기(각 1.5초 제한) → 종료. 어떤 경우든 8초 안전장치
//! 단계별 시각은 Preview 폴더 `close-trace.log`(덮어씀, 기록 내용 없음 — 단계 이름과 경과 ms만)
use crate::space_db::SpaceDbState;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub const JS_LIMIT: Duration = Duration::from_secs(4);
pub const WATCHDOG: Duration = Duration::from_secs(8);
static CLOSING: AtomicBool = AtomicBool::new(false);
static JS_DONE: AtomicBool = AtomicBool::new(false);
static TRACE: Mutex<Vec<String>> = Mutex::new(Vec::new());
static START: Mutex<Option<Instant>> = Mutex::new(None);

fn mark(step: &str) {
    let ms = START
        .lock()
        .ok()
        .and_then(|s| s.map(|t| t.elapsed().as_millis()))
        .unwrap_or(0);
    if let Ok(mut t) = TRACE.lock() {
        t.push(format!("{ms:>6} ms  rust  {step}"));
    }
}
/// 화면이 보낸 단계 이름만 받는다(영문 소문자·숫자·밑줄, 짧게) — 기록 내용이 섞이지 않게
pub fn clean_step(s: &str) -> Option<String> {
    let ok = !s.is_empty()
        && s.len() <= 40
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    ok.then(|| s.to_string())
}
fn write_trace(app: &AppHandle) {
    let Ok(store) = crate::online::app_store(app) else {
        return;
    };
    let lines = TRACE.lock().map(|t| t.join("\n")).unwrap_or_default();
    let _ = std::fs::create_dir_all(store.root());
    let _ = std::fs::write(store.root().join("close-trace.log"), lines + "\n");
}

/// 메인 창 닫기 요청(lib.rs on_window_event에서)
pub fn on_close_requested(app: &AppHandle, api: &tauri::CloseRequestApi) {
    if CLOSING.swap(true, Ordering::SeqCst) {
        api.prevent_close(); // 이미 닫는 중 — 두 번째 X는 무시
        return;
    }
    *START.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
    mark("close_requested");
    // 어떤 경우든 끝나는 안전장치
    std::thread::spawn(|| {
        std::thread::sleep(WATCHDOG);
        mark("watchdog_exit");
        std::process::exit(0);
    });
    let state = app.state::<SpaceDbState>();
    if !state.any_open_now() {
        // 온라인 공간을 열지 않았으면 저장할 것이 없다 — 바로 종료(숨은 창이 남아도 프로세스는 끝)
        mark("no_space_exit");
        write_trace(app);
        app.exit(0);
        return;
    }
    api.prevent_close();
    let _ = app.emit_to("main", "preview-closing", ());
    mark("closing_emitted");
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let t0 = Instant::now();
        while !JS_DONE.load(Ordering::SeqCst) && t0.elapsed() < JS_LIMIT {
            let _ = tauri::async_runtime::spawn_blocking(|| {
                std::thread::sleep(Duration::from_millis(50))
            })
            .await;
        }
        mark(if JS_DONE.load(Ordering::SeqCst) {
            "js_done"
        } else {
            "js_timeout"
        });
        app.state::<SpaceDbState>().close_all().await;
        mark("journals_closed");
        write_trace(&app);
        app.exit(0);
    });
}

/// 화면 쪽 닫기 처리가 끝남(단계 이름·경과 ms를 함께 — 진단용). Rust가 이어서 일지를 닫고 종료한다
#[tauri::command]
pub fn preview_exit(steps: Vec<(String, u64)>) {
    if let Ok(mut t) = TRACE.lock() {
        for (s, ms) in steps.iter().take(20) {
            if let Some(s) = clean_step(s) {
                t.push(format!("{ms:>6} ms  js    {s}"));
            }
        }
    }
    JS_DONE.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn steps_are_names_only() {
        assert_eq!(
            clean_step("overlay_shown").as_deref(),
            Some("overlay_shown")
        );
        for bad in ["", "Overlay", "a b", "기록", "x/../y", &"a".repeat(41)] {
            assert!(clean_step(bad).is_none(), "{bad}");
        }
    }
}
