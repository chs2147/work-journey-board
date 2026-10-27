//! Work Journey Board 데스크톱 껍데기. 플러그인 등록·창 설정만 둔다 — 업무 로직은 웹 앱(src/) 쪽에(CLAUDE.md 4-5).

mod db_batch;
mod files;
mod splash;
mod update;

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

pub fn run() {
    tauri::Builder::default()
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
        )
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        // 새 판 확인·설치(update.rs) — 확인한 판의 주소·해시를 들고 있는 곳
        .manage(update::UpdateState::default())
        // 창 배경색은 설정 파일 값이 라이트라서, 다크 테마면 여기서 바꿔 밝은 번쩍임을 막는다(docs/splash-spec.md).
        .setup(|app| {
            for (label, (r, g, b)) in [("splash", (0x23, 0x23, 0x22)), ("main", (0x1a, 0x1a, 0x19))] {
                if let Some(w) = app.get_webview_window(label) {
                    if matches!(w.theme(), Ok(tauri::Theme::Dark)) {
                        let _ = w.set_background_color(Some(tauri::window::Color(r, g, b, 0xff)));
                    }
                }
            }
            splash::arm_fallback(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
            files::export_write,
            files::open_folder,
            files::open_url,
            update::update_check,
            update::update_download,
            update::update_install
        ])
        .run(tauri::generate_context!())
        .expect("Work Journey Board 실행 중 오류");
}
