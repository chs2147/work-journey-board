//! 시작 스플래시 창(docs/splash-spec.md). "splash" 창이 먼저 뜨고 "main" 창은 숨긴 채 웹 앱을 준비한다.
//! 웹 앱이 준비되면 `splash_finish`로 넘어간다. 웹 앱이 끝내 부르지 못해도(시작 중 오류 등) 안전 시간 뒤에 넘어간다.

use std::{thread, time::Duration};
use tauri::{AppHandle, Manager, Runtime};

/// 메인 창이 끝내 안 보이는 일을 막는 안전 시간.
const FALLBACK: Duration = Duration::from_secs(15);

/// 메인 창을 보이고 스플래시 창을 닫는다. 여러 번 불려도 안전하다.
pub fn finish<R: Runtime>(app: &AppHandle<R>) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.destroy();
    }
}

#[tauri::command]
pub fn splash_finish(app: AppHandle) {
    finish(&app);
}

/// 시작 시 1회: 안전 시간이 지나도 스플래시가 남아 있으면 넘어간다.
pub fn arm_fallback<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(FALLBACK);
        if app.get_webview_window("splash").is_some() {
            finish(&app);
        }
    });
}

/// 두 번째 실행 시 앞으로 가져올 창: 시작 중이면 스플래시, 아니면 메인.
pub fn bring_to_front<R: Runtime>(app: &AppHandle<R>) {
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.set_focus();
    } else if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}
