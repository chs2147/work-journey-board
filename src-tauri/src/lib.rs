//! Work Journey Board 데스크톱 껍데기. 플러그인 등록·창 설정만 둔다 — 업무 로직은 웹 앱(src/) 쪽에(CLAUDE.md 4-5).
// Connected Preview 빌드는 Classic 일지 명령을 등록하지 않으므로 그 함수들이 쓰이지 않는다(profile.rs)
#![cfg_attr(feature = "connected-preview", allow(dead_code, unused_imports))]

mod backup_name;
mod cabinet;
mod db_batch;
mod files;
#[cfg(target_os = "macos")]
mod menu;
mod profile;
mod splash;
mod update;
mod update_policy;

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

pub fn run() {
    // 실행 프로필 검사(V2 6-B) — 빌드 프로필과 설정의 앱 ID가 다르면 플러그인·창·설정 파일보다 먼저 멈춘다
    let context = tauri::generate_context!();
    if let Err(e) = profile::check_identifier(&context.config().identifier) {
        panic!("{e}");
    }
    let builder = tauri::Builder::default();
    // 맥 메뉴 막대(macos-spec 3-1): 한국어 앱·편집·보기·윈도우·도움말, ⌘Q = 안전 종료
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(|app| menu::build(app))
        .on_menu_event(|app, e| menu::on_event(app, e.id().as_ref()));
    let builder = builder
        // 단일 인스턴스: 두 번째 실행은 기존 창을 앞으로 가져오고 끝낸다(DB 쓰기 주체 1개, data-spec 3-1).
        // 다른 플러그인보다 먼저 등록해야 한다.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            splash::bring_to_front(app);
        }))
        // 창 크기·위치만 기억한다. 보이기(VISIBLE)는 복원하지 않는다 — 메인 창은 스플래시가 끝날 때 보인다.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .with_denylist(&["splash"])
                .build(),
        );
    // 일지(SQLite)는 Local Classic만 연다 — Preview 빌드에는 플러그인 자체가 없다(등록 순서는 예전 그대로)
    #[cfg(not(feature = "connected-preview"))]
    let builder = builder.plugin(tauri_plugin_sql::Builder::default().build());
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        // 새 판 확인·설치(update.rs) — 확인한 판의 주소·해시를 들고 있는 곳
        .manage(update::UpdateState::default())
        // Cabinet(F5) — 등록한 폴더 목록(읽기·열기 허용 범위)
        .manage(cabinet::CabinetRoots::default())
        .manage(cabinet::DropBridges::default())
        // 창 배경색은 설정 파일 값이 라이트라서, 다크 테마면 여기서 바꿔 밝은 번쩍임을 막는다(docs/splash-spec.md).
        .setup(|app| {
            for (label, (r, g, b)) in [("splash", (0x23, 0x23, 0x22)), ("main", (0x1a, 0x1a, 0x19))]
            {
                if let Some(w) = app.get_webview_window(label) {
                    if matches!(w.theme(), Ok(tauri::Theme::Dark)) {
                        let _ = w.set_background_color(Some(tauri::window::Color(r, g, b, 0xff)));
                    }
                }
            }
            splash::arm_fallback(app.handle());
            // Cabinet 끌어 놓기 다리(A안, 윈도우 WebView2만) — 메인 창. Preview에는 Cabinet이 없다
            #[cfg(all(windows, not(feature = "connected-preview")))]
            if let Some(w) = app.get_webview_window("main") {
                if app.state::<cabinet::DropBridges>().claim("main") {
                    cabinet::install_drop_bridge(&w);
                }
            }
            Ok(())
        });
    // Local Classic 명령 목록 = 예전 그대로 + 프로필 묻기(읽기 전용)
    #[cfg(not(feature = "connected-preview"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
            db_batch::db_batch,
            splash::splash_finish,
            files::config_read,
            files::config_write,
            files::onedrive_roots,
            files::fs_stat,
            files::fs_list,
            files::fs_ensure_dir,
            files::fs_remove_backup,
            files::fs_rename_backup,
            files::fs_copy_new,
            files::restore_journal,
            files::export_write,
            files::open_folder,
            files::open_url,
            update::update_check,
            update::update_download,
            update::update_install,
            cabinet::cabinet_set_roots,
            cabinet::cabinet_list,
            cabinet::cabinet_open,
            cabinet::cabinet_reveal,
            cabinet::cabinet_drop_bridge,
            cabinet::cabinet_resolve_shortcut,
            cabinet::cabinet_drag_paths,
            profile::app_profile
        ]);
    // Connected Preview: 기존 일지를 열거나 쓰는 명령(SQLite 묶음·백업·복원·내보내기·Cabinet)과
    // 새 판 확인·설치 명령을 등록하지 않는다. 스플래시·자기 설정 파일·링크 넘기기·프로필 묻기만
    #[cfg(feature = "connected-preview")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        splash::splash_finish,
        files::config_read,
        files::config_write,
        files::open_url,
        profile::app_profile
    ]);
    builder.run(context).expect("Work Journey Board 실행 중 오류");
}
