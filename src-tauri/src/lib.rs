//! Work Journey Board 데스크톱 껍데기. 플러그인 등록·창 설정만 둔다 — 업무 로직은 웹 앱(src/) 쪽에(CLAUDE.md 4-5).

mod db_batch;
mod files;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        // 단일 인스턴스: 두 번째 실행은 기존 창을 앞으로 가져오고 끝낸다(DB 쓰기 주체 1개, data-spec 3-1).
        // 다른 플러그인보다 먼저 등록해야 한다.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            db_batch::db_batch,
            files::config_read,
            files::config_write,
            files::onedrive_roots,
            files::fs_stat,
            files::fs_list,
            files::fs_ensure_dir,
            files::fs_remove_backup,
            files::fs_rename_backup,
            files::fs_copy_new,
            files::open_folder
        ])
        .run(tauri::generate_context!())
        .expect("Work Journey Board 실행 중 오류");
}
