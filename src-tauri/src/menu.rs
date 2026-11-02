//! 맥 메뉴 막대(macos-spec 3-1) — 한국어. 윈도우에는 메뉴를 달지 않는다(지금과 같음).
//! - 편집 메뉴는 OS 기본 항목: 입력란의 ⌘C·⌘V·⌘Z가 WKWebView에서 동작하려면 꼭 있어야 한다.
//! - 설정·보기·도움말은 웹 화면에 `menu-action` 이벤트만 보낸다 — 할 일은 웹 화면의 단축키 처리와 같은 함수가 한다(업무 로직 없음).
//! - 종료(⌘Q)는 바로 끝내지 않고 메인 창에 닫기 요청 → 웹 화면의 종료 처리(저장 마무리·종료 백업)를 거친다(R7).

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// 웹 화면이 받는 이벤트 이름(src/platform/tauri.ts와 같아야 한다)
pub const MENU_EVENT: &str = "menu-action";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let name = "Work Journey Board";
    let about = AboutMetadata {
        name: Some(name.into()),
        version: Some(app.package_info().version.to_string()),
        copyright: Some("sanbonjini".into()),
        ..Default::default()
    };
    let app_menu = Submenu::with_items(
        app,
        name,
        true,
        &[
            &PredefinedMenuItem::about(app, Some(&format!("{name} 정보")), Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", "설정…", true, Some("CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some("서비스"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some(&format!("{name} 가리기")))?,
            &PredefinedMenuItem::hide_others(app, Some("기타 가리기"))?,
            &PredefinedMenuItem::show_all(app, Some("모두 보기"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "quit",
                format!("{name} 종료"),
                true,
                Some("CmdOrCtrl+Q"),
            )?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "편집",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("실행 취소"))?,
            &PredefinedMenuItem::redo(app, Some("실행 복귀"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("오려두기"))?,
            &PredefinedMenuItem::copy(app, Some("복사하기"))?,
            &PredefinedMenuItem::paste(app, Some("붙여넣기"))?,
            &PredefinedMenuItem::select_all(app, Some("전체 선택"))?,
        ],
    )?;
    // 보기 항목에는 단축키를 달지 않는다 — ⌥1~4는 웹 화면이 그대로 받는다(메뉴가 키를 가로채지 않게). 이름에 키만 적는다
    let view = Submenu::with_items(
        app,
        "보기",
        true,
        &[
            &MenuItem::with_id(app, "board", "주간 보드  ⌥1", true, None::<&str>)?,
            &MenuItem::with_id(app, "important", "중요 업무  ⌥2", true, None::<&str>)?,
            &MenuItem::with_id(app, "insights", "인사이트  ⌥3", true, None::<&str>)?,
            &MenuItem::with_id(app, "cabinet", "Cabinet  ⌥4", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, Some("전체 화면"))?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "윈도우",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("최소화"))?,
            &PredefinedMenuItem::maximize(app, Some("확대/축소"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some("윈도우 닫기"))?,
        ],
    )?;
    let help = Submenu::with_items(
        app,
        "도움말",
        true,
        &[&MenuItem::with_id(
            app,
            "guide",
            "빠른 이용 가이드 ↗",
            true,
            None::<&str>,
        )?],
    )?;
    Menu::with_items(app, &[&app_menu, &edit, &view, &window, &help])
}

/// 메뉴 항목을 눌렀을 때
pub fn on_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "quit" => request_quit(app),
        "settings" | "board" | "important" | "insights" | "cabinet" | "guide" => {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_focus();
            }
            let _ = app.emit_to("main", MENU_EVENT, id);
        }
        _ => {}
    }
}

/// 안전 종료: 메인 창에 닫기 요청(웹 화면 onCloseRequested → 저장·종료 백업 → 창 없앰 → 앱 끝).
/// 메인 창이 없으면 바로 끝낸다. 웹 화면이 끝내 응답하지 않으면 15초 뒤 끝낸다
pub fn request_quit<R: Runtime>(app: &AppHandle<R>) {
    match app.get_webview_window("main") {
        Some(main) => {
            let _ = main.close();
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(15));
                app.exit(0);
            });
        }
        None => app.exit(0),
    }
}
