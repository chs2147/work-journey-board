//! Work Journey Board 데스크톱 껍데기. 플러그인 등록·창 설정만 둔다 — 업무 로직은 웹 앱(src/) 쪽에(CLAUDE.md 4-5).
// Connected Preview 빌드는 Classic 일지 명령을 등록하지 않으므로 그 함수들이 쓰이지 않는다(profile.rs)
#![cfg_attr(feature = "connected-preview", allow(dead_code, unused_imports))]

mod backup_name;
mod cabinet;
mod db_batch;
mod dev_guard;
#[cfg(not(feature = "connected-preview"))]
mod exit_guard;
mod files;
#[cfg(target_os = "macos")]
mod menu;
#[cfg(feature = "online")]
mod migration;
#[cfg(feature = "online")]
mod online;
#[cfg(feature = "online")]
mod online_space;
#[cfg(feature = "connected-preview")]
mod preview_close;
mod profile;
#[cfg(feature = "online")]
mod source_copy;
#[cfg(feature = "online")]
mod space_db;
#[cfg(feature = "online")]
mod space_sync;
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
    // 일지(SQLite)는 Local Classic·DEV만 연다 — Preview 빌드에는 플러그인 자체가 없다(등록 순서는 예전 그대로)
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
    // 정식판·DEV 닫기 안전장치(docs/v2-design/91 5-4): 메인 창 닫기 요청마다 60초 안전장치를 건다
    // (화면이 저장 실패로 창을 남기면 exit_guard_cancel로 푼다). Preview는 preview_close.rs
    #[cfg(not(feature = "connected-preview"))]
    let builder = builder.on_window_event(|w, e| {
        if w.label() == "main" {
            if let tauri::WindowEvent::CloseRequested { .. } = e {
                exit_guard::arm();
            }
        }
    });
    // Local Classic 명령 목록 = 예전 그대로 + 프로필 묻기(읽기 전용) + 닫기 안전장치 풀기
    // + G-9(2026-11-20): 온라인 공간 명령(DEV 통합 앱과 같음 — DEV 일지 표시 명령만 없음, 서버 = 운영)
    #[cfg(not(any(feature = "connected-preview", feature = "dev-channel")))]
    let builder = builder
        .manage(online::OnlineState::default())
        .manage(space_db::SpaceDbState::default());
    #[cfg(not(any(feature = "connected-preview", feature = "dev-channel")))]
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
        profile::app_profile,
        exit_guard::exit_guard_cancel,
        online::online_status,
        online::online_send_code,
        online::online_verify_code,
        online::online_check,
        online::online_sign_out,
        source_copy::source_snapshot,
        source_copy::source_snapshot_read,
        source_copy::source_candidates,
        source_copy::source_snapshot_remove,
        migration::migration_device,
        migration::migration_command,
        migration::migration_put_asset,
        migration::migration_cancel_asset,
        migration::migration_journal_list,
        migration::migration_journal_write,
        migration::migration_journal_remove,
        online_space::space_list,
        online_space::space_sync,
        online_space::space_read,
        online_space::space_remove,
        space_db::space_db_exists,
        space_db::space_db_create,
        space_db::space_db_open,
        space_db::space_db_close,
        space_db::space_db_select,
        space_db::space_db_execute,
        space_db::space_db_batch,
        space_db::space_db_export,
        space_sync::space_sync_call,
        space_sync::online_account_call,
        space_sync::space_asset_upload,
        space_sync::space_asset_fetch
    ]);
    // DEV 검증판 = Local Classic 명령 + 일지 폴더 DEV 표시 확인·준비·정식 일지 복제(docs/release-channel-spec.md)
    // G-1(98) DEV 통합 앱: 로컬 명령 + 온라인 공간 명령(Preview와 같음, 닫기 주도 preview_close만 제외 — DEV는 지금 닫기 흐름이 일지를 닫는다)
    #[cfg(feature = "dev-channel")]
    let builder = builder
        .manage(online::OnlineState::default())
        .manage(space_db::SpaceDbState::default());
    #[cfg(feature = "dev-channel")]
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
        profile::app_profile,
        exit_guard::exit_guard_cancel,
        dev_guard::dev_folder_status,
        dev_guard::dev_prepare_folder,
        dev_guard::dev_copy_official,
        online::online_status,
        online::online_send_code,
        online::online_verify_code,
        online::online_check,
        online::online_sign_out,
        source_copy::source_snapshot,
        source_copy::source_snapshot_read,
        source_copy::source_candidates,
        source_copy::source_snapshot_remove,
        migration::migration_device,
        migration::migration_command,
        migration::migration_put_asset,
        migration::migration_cancel_asset,
        migration::migration_journal_list,
        migration::migration_journal_write,
        migration::migration_journal_remove,
        online_space::space_list,
        online_space::space_sync,
        online_space::space_read,
        online_space::space_remove,
        space_db::space_db_exists,
        space_db::space_db_create,
        space_db::space_db_open,
        space_db::space_db_close,
        space_db::space_db_select,
        space_db::space_db_execute,
        space_db::space_db_batch,
        space_db::space_db_export,
        space_sync::space_sync_call,
        space_sync::online_account_call,
        space_sync::space_asset_upload,
        space_sync::space_asset_fetch
    ]);
    // Connected Preview: 기존 일지를 열거나 쓰는 명령(SQLite 묶음·백업·복원·내보내기·Cabinet)과
    // 새 판 확인·설치 명령을 등록하지 않는다. 스플래시·자기 설정 파일·링크 넘기기·프로필 묻기만
    #[cfg(feature = "connected-preview")]
    let builder = builder
        .manage(online::OnlineState::default())
        .manage(space_db::SpaceDbState::default())
        // 닫기는 Rust가 주도(preview_close.rs — E-3 실기: 화면 쪽 닫기 처리가 기대대로 돌지 않아 안내 없이 오래 기다림)
        .on_window_event(|w, e| {
            if w.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                    preview_close::on_close_requested(w.app_handle(), api);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            splash::splash_finish,
            files::config_read,
            files::config_write,
            files::open_url,
            profile::app_profile,
            online::online_status,
            online::online_send_code,
            online::online_verify_code,
            online::online_check,
            online::online_sign_out,
            source_copy::source_snapshot,
            source_copy::source_snapshot_read,
            source_copy::source_candidates,
            source_copy::source_snapshot_remove,
            migration::migration_device,
            migration::migration_command,
            migration::migration_put_asset,
            migration::migration_cancel_asset,
            migration::migration_journal_list,
            migration::migration_journal_write,
            migration::migration_journal_remove,
            online_space::space_list,
            online_space::space_sync,
            online_space::space_read,
            online_space::space_remove,
            space_db::space_db_exists,
            space_db::space_db_create,
            space_db::space_db_open,
            space_db::space_db_close,
            space_db::space_db_select,
            space_db::space_db_execute,
            space_db::space_db_batch,
            space_db::space_db_export,
            preview_close::preview_exit,
            space_sync::space_sync_call,
            space_sync::online_account_call,
            space_sync::space_asset_upload,
            space_sync::space_asset_fetch
        ]);
    builder
        .run(context)
        .expect("Work Journey Board 실행 중 오류");
}
