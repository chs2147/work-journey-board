//! 실행 프로필(V2 6-B, docs/v2-design/78-preview-native-bootstrap.md).
//! 기본 빌드 = **Local Classic** — 앱 ID·설정 폴더·업데이트·명령 목록이 이 모듈이 생기기 전과 같다.
//! `connected-preview` 기능을 켠 빌드만 Connected Preview(별도 앱 ID·설정 폴더, 업데이트 꺼짐,
//! 기존 일지 열기·쓰기 명령 없음). 화면 코드는 OS가 아니라 이 프로필 값만 본다.

use serde::Serialize;

/// Local Classic 값 — 바꾸면 기존 설치의 설정 폴더·단일 인스턴스·창 상태가 갈라진다(바꾸지 않는다)
pub const CLASSIC_APP_ID: &str = "com.chs2147.workjourneyboard";
pub const CLASSIC_CONFIG_DIR: &str = "WorkJourneyBoard";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppProfile {
    /// "local-classic" | "connected-preview"
    pub key: &'static str,
    pub app_id: &'static str,
    pub product_name: &'static str,
    /// 로컬 데이터 폴더 아래 설정 폴더 이름(`config.json`이 들어감)
    #[serde(skip)]
    pub config_dir: &'static str,
    /// 새 판 확인·내려받기·설치(update.rs)를 쓸 수 있는가 — Preview는 늘 false
    pub updates: bool,
    /// 기존 로컬 일지를 열고 쓰는 명령(SQLite·백업·복원·내보내기·Cabinet)이 있는가 — Preview는 늘 false
    pub local_journal: bool,
}

#[cfg(not(feature = "connected-preview"))]
pub fn active() -> AppProfile {
    AppProfile {
        key: "local-classic",
        app_id: CLASSIC_APP_ID,
        product_name: "Work Journey Board",
        config_dir: CLASSIC_CONFIG_DIR,
        updates: true,
        local_journal: true,
    }
}

/// Preview 값은 공통 프로필 정본(`poc/v2-native/profiles.tsv`)에서만 읽는다 — 따로 복사하지 않는다
#[cfg(feature = "connected-preview")]
pub fn active() -> AppProfile {
    use wjb_native_isolation::policy::{identity, Profile};
    let id = identity(Profile::ConnectedPreview).expect("Connected Preview 프로필 정본을 읽지 못했습니다");
    AppProfile {
        key: id.profile.key(),
        app_id: id.app_id,
        product_name: id.product_name,
        config_dir: id.config_directory,
        updates: id.release_repository.is_some(),
        local_journal: false,
    }
}

/// 실행 전 검사: 빌드 프로필과 Tauri 설정의 앱 ID가 같아야 한다.
/// Classic 빌드를 Preview 설정으로, Preview 빌드를 Classic 설정으로 켜면 플러그인·창보다 먼저 멈춘다.
pub fn check_identifier(identifier: &str) -> Result<AppProfile, String> {
    let p = active();
    if identifier != p.app_id {
        return Err(format!(
            "실행 프로필({})과 앱 ID({identifier})가 맞지 않습니다",
            p.key
        ));
    }
    if p.updates && p.key != "local-classic" {
        return Err("Local Classic 외 프로필은 업데이트를 켤 수 없습니다".into());
    }
    Ok(p)
}

/// 업데이트 명령 첫 줄 — Preview에서는 네트워크에 나가기 전에 거절한다
pub fn require_updates() -> Result<(), String> {
    if active().updates {
        Ok(())
    } else {
        Err("UPDATES_DISABLED".into())
    }
}

/// 화면이 시작할 때 묻는 비민감 프로필 정보(토큰·경로 없음)
#[tauri::command]
pub fn app_profile() -> AppProfile {
    active()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 공통 정본의 Classic 줄 = 이 모듈의 Classic 상수 = tauri.conf.json(제품 기본 설정)
    #[test]
    fn classic_constants_match_shared_profiles_and_tauri_conf() {
        let tsv = include_str!("../../poc/v2-native/profiles.tsv");
        let row: Vec<&str> = tsv
            .lines()
            .find(|l| l.starts_with("local-classic|"))
            .expect("local-classic 줄")
            .split('|')
            .collect();
        assert_eq!(row[1], CLASSIC_APP_ID);
        assert_eq!(row[3], CLASSIC_CONFIG_DIR);
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], CLASSIC_APP_ID);
        let preview: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.preview.conf.json")).unwrap();
        let prow: Vec<&str> = tsv
            .lines()
            .find(|l| l.starts_with("connected-preview|"))
            .expect("connected-preview 줄")
            .split('|')
            .collect();
        assert_eq!(preview["identifier"], prow[1]);
        assert_eq!(preview["productName"], prow[2]);
        assert!(prow[4].is_empty(), "Preview는 업데이트 저장소가 없다");
    }

    #[cfg(not(feature = "connected-preview"))]
    #[test]
    fn classic_build_keeps_existing_behavior() {
        let p = active();
        assert_eq!(p.key, "local-classic");
        assert_eq!(p.config_dir, "WorkJourneyBoard");
        assert!(p.updates && p.local_journal);
        assert!(require_updates().is_ok());
        assert!(check_identifier(CLASSIC_APP_ID).is_ok());
        // Classic 빌드를 Preview 설정으로 켜면 거절
        assert!(check_identifier("com.chs2147.workjourneyboard.connected.preview").is_err());
    }

    #[cfg(feature = "connected-preview")]
    #[test]
    fn preview_build_is_isolated() {
        let p = active();
        assert_eq!(p.key, "connected-preview");
        assert_eq!(p.app_id, "com.chs2147.workjourneyboard.connected.preview");
        assert_eq!(p.config_dir, "WorkJourneyBoardConnectedPreview");
        assert_ne!(p.config_dir, CLASSIC_CONFIG_DIR);
        assert!(!p.updates && !p.local_journal);
        assert_eq!(require_updates(), Err("UPDATES_DISABLED".to_string()));
        assert!(check_identifier(p.app_id).is_ok());
        // Preview 빌드를 Classic 설정으로 켜면 거절
        assert!(check_identifier(CLASSIC_APP_ID).is_err());
        // 화면에 넘기는 값에 설정 폴더(경로)는 없다
        let json = serde_json::to_string(&p).unwrap();
        assert!(!json.contains("WorkJourneyBoardConnectedPreview"));
    }
}
