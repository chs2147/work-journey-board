// V2 6-B 실행 프로필(docs/v2-design/78-preview-native-bootstrap.md) — Classic은 그대로, Preview는 격리
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLASSIC_PROFILE, PREVIEW_PROFILE, parseAppProfile } from "../../src/platform";

const read = (p: string) => readFileSync(p, "utf8");
const json = (p: string) => JSON.parse(read(p));
const tsv = Object.fromEntries(
  read("poc/v2-native/profiles.tsv")
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => {
      const [key, appId, productName, configDir, repo] = l.split("|");
      return [key, { appId, productName, configDir, repo }];
    }),
);
const base = json("src-tauri/tauri.conf.json");
const preview = json("src-tauri/tauri.preview.conf.json");
const lib = read("src-tauri/src/lib.rs");
const handlers = (cfg: string) => {
  const at = lib.indexOf(`#[cfg(${cfg})]\n    let builder = builder`);
  expect(at).toBeGreaterThan(0);
  const open = lib.indexOf("generate_handler![", at) + "generate_handler![".length;
  return lib
    .slice(open, lib.indexOf("]", open))
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
};

describe("프로필 값", () => {
  it("화면이 아는 값 = 공통 정본(profiles.tsv)", () => {
    expect(CLASSIC_PROFILE.appId).toBe(tsv["local-classic"].appId);
    expect(CLASSIC_PROFILE.productName).toBe(tsv["local-classic"].productName);
    expect(PREVIEW_PROFILE.appId).toBe(tsv["connected-preview"].appId);
    expect(PREVIEW_PROFILE.productName).toBe(tsv["connected-preview"].productName);
    expect(tsv["connected-preview"].repo).toBe("");
    expect(PREVIEW_PROFILE.updates || PREVIEW_PROFILE.localJournal).toBe(false);
  });

  it("Rust가 Preview라고 답할 때만 Preview, 그 밖은 Classic", () => {
    expect(parseAppProfile({ key: "connected-preview", appId: PREVIEW_PROFILE.appId })).toBe(PREVIEW_PROFILE);
    expect(parseAppProfile({ key: "connected-preview", appId: "x" })).toBe(CLASSIC_PROFILE);
    expect(parseAppProfile({ key: "local-classic", appId: CLASSIC_PROFILE.appId })).toBe(CLASSIC_PROFILE);
    expect(parseAppProfile(null)).toBe(CLASSIC_PROFILE);
  });
});

describe("Tauri 설정", () => {
  it("Classic 기본 설정은 그대로(앱 ID·이름·권한 목록 지정 없음 = 모든 권한 파일)", () => {
    expect(base.identifier).toBe(tsv["local-classic"].appId);
    expect(base.productName).toBe(tsv["local-classic"].productName);
    expect(base.app.security.capabilities).toBeUndefined();
    expect(base.plugins?.updater).toBeUndefined();
    expect(base.bundle.fileAssociations).toBeUndefined();
  });

  it("Preview 덮어쓰기 = 앱 ID·이름·실행 파일 이름·창 제목·권한 목록·CSP(wasm)·설치 아이콘만 다르다", () => {
    expect(preview.identifier).toBe(tsv["connected-preview"].appId);
    expect(preview.productName).toBe(tsv["connected-preview"].productName);
    expect(Object.keys(preview).sort()).toEqual([
      "$schema",
      "app",
      "bundle",
      "identifier",
      "mainBinaryName",
      "productName",
    ]);
    // 실행 파일 이름도 다르게 — 윈도우 설치 프로그램이 실행 중인 앱을 파일 이름으로 찾아 닫기 때문(Classic = 기본 work-journey-board)
    expect(base.mainBinaryName).toBeUndefined();
    expect(preview.mainBinaryName).toBe("work-journey-board-connected-preview");
    expect(Object.keys(preview.app).sort()).toEqual(["security", "windows"]);
    expect(Object.keys(preview.app.security)).toEqual(["csp", "capabilities"]);
    // 비공식 판 설치 아이콘 = DEV와 같은 icons-dev(release-channel-spec 6절)
    expect(preview.bundle).toEqual(json("src-tauri/tauri.dev.conf.json").bundle);
    // 창 배열은 통째로 바뀌므로(merge patch) 제목 말고는 기본 설정과 같아야 한다
    const strip = (ws: { title: string }[]) => ws.map((w) => ({ ...w, title: "" }));
    expect(strip(preview.app.windows)).toEqual(strip(base.app.windows));
    for (const w of preview.app.windows) expect(w.title).toBe(preview.productName);
    expect([...preview.app.security.capabilities].sort()).toEqual([
      "preview-cabi",
      "preview-cabinet",
      "preview-folder",
      "preview-main",
      "splash",
    ]);
  });

  it("Preview 메인 창 권한: SQLite·저장 대화상자·파일 없음, Classic 권한의 부분 집합(Classic에 새 권한 없음)", () => {
    const cap = json("src-tauri/capabilities/preview-main.json");
    const def = json("src-tauri/capabilities/default.json");
    expect(cap.windows).toEqual(["main"]);
    // 예외: 폴더 고르기(C-2 원본 읽기 전용 사본), 별도 창 만들기·클립보드 글(D단계 온라인 공간의 노트·메모보드·파일 목록 창)
    const allowed = new Set([
      "dialog:allow-open",
      "core:webview:allow-create-webview-window",
      "clipboard-manager:allow-write-text",
    ]);
    for (const p of cap.permissions as string[]) {
      expect(def.permissions).toContain(p);
      if (!allowed.has(p))
        expect(p).not.toMatch(/^(sql|dialog|clipboard|opener|fs|http|shell)|create-webview/);
    }
    expect(cap.permissions).not.toContain("dialog:allow-save");
    expect(cap.permissions.some((p: string) => p.startsWith("sql"))).toBe(false);
  });

  it("Preview 별도 창 권한(노트·메모보드·파일 목록·폴더) = 정식판 창 권한의 부분 집합, 저장 대화상자·SQLite 없음", () => {
    for (const [prev, classic] of [
      ["preview-cabi", "cabi"],
      ["preview-cabinet", "cabinet"],
      ["preview-folder", "folder"],
    ]) {
      const p = json(`src-tauri/capabilities/${prev}.json`);
      const c = json(`src-tauri/capabilities/${classic}.json`);
      expect(p.identifier).toBe(prev);
      expect(p.windows).toEqual(c.windows);
      for (const x of p.permissions as string[]) expect(c.permissions).toContain(x);
      expect(p.permissions).not.toContain("dialog:allow-save");
      expect(p.permissions.some((x: string) => x.startsWith("sql"))).toBe(false);
    }
    expect(preview.app.security.capabilities).toEqual([
      "preview-main",
      "splash",
      "preview-cabi",
      "preview-cabinet",
      "preview-folder",
    ]);
  });
});

describe("Preview 온라인 모듈(online.rs) 접속 범위", () => {
  const online = read("src-tauri/src/online.rs");
  it("G-3: 서버 표 = 개발·운영 두 곳의 인증·gateway 경로만, 운영은 공개 키 없음(G-2 전), 서버 열쇠 없음", () => {
    const dev = "https://vsphftnmfzfoufasjttd.supabase.co";
    const prod = "https://hutqsfftioxtredcjhsy.supabase.co";
    expect(online.match(/https:\/\/[a-z0-9.-]+/g)?.every((u) => u === dev || u === prod)).toBe(true);
    // 개발 줄 = 공개 키 있음, 운영 줄 = 없음(어떤 판도 고를 수 없음)
    expect(online).toMatch(
      /pub const DEVELOPMENT: Server = Server \{[^}]*origin: "https:\/\/vsphftnmfzfoufasjttd\.supabase\.co",\s*publishable_key: Some\("sb_publishable_[A-Za-z0-9_-]+"\),/,
    );
    expect(online).toMatch(
      /pub const PRODUCTION: Server = Server \{[^}]*origin: "https:\/\/hutqsfftioxtredcjhsy\.supabase\.co",\s*publishable_key: None,/,
    );
    // 판 → 서버: 검증판은 개발만
    expect(online).toContain("Profile::ConnectedPreview | Profile::LocalDev => Ok(DEVELOPMENT),");
    expect(online).not.toMatch(/=> Ok\(PRODUCTION\)/);
    expect(online).not.toMatch(/sb_secret_|service_role|eyJ[A-Za-z0-9]{10}|sbp_/);
    expect(online).toContain("redirect(reqwest::redirect::Policy::none())");
  });
  it("웹 화면 CSP는 그대로(네트워크는 Rust에서만)", () => {
    expect(base.app.security.csp).toBe(
      "default-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self' data:; style-src 'self' 'unsafe-inline'",
    );
    // C-4: Preview만 원본 사본을 sql.js(WebAssembly)로 읽는다 — 스크립트 실행 허용만 더하고 접속 범위는 같다
    expect(preview.app.security.csp).toBe(
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src ipc: http://ipc.localhost; img-src 'self' data:; style-src 'self' 'unsafe-inline'",
    );
  });
  it("이관 통신(migration.rs)도 개발 프로젝트 gateway 경로만, 서버 열쇠 없음", () => {
    const m = read("src-tauri/src/migration.rs");
    expect(m.match(/https?:\/\/[a-z0-9.-]+/g) ?? []).toEqual([]);
    expect(m).toContain('const GATEWAY: &str = "/functions/v1/wjb-gateway";');
    expect(m).not.toMatch(/sb_secret_|service_role|eyJ[A-Za-z0-9]{10}|sbp_/);
    expect(m).toContain("redirect(reqwest::redirect::Policy::none())");
  });
});

describe("Rust 명령 경계(lib.rs)", () => {
  const classic = handlers('not(any(feature = "connected-preview", feature = "dev-channel"))');
  const dev = handlers('feature = "dev-channel"');
  const prev = handlers('feature = "connected-preview"');

  it("Classic 명령 = 예전 목록 + 프로필 묻기 + 닫기 안전장치 풀기(91문서 5-4)", () => {
    expect(classic).toEqual([
      "db_batch::db_batch",
      "splash::splash_finish",
      "files::config_read",
      "files::config_write",
      "files::onedrive_roots",
      "files::fs_stat",
      "files::fs_list",
      "files::fs_ensure_dir",
      "files::fs_remove_backup",
      "files::fs_rename_backup",
      "files::fs_copy_new",
      "files::restore_journal",
      "files::export_write",
      "files::open_folder",
      "files::open_url",
      "update::update_check",
      "update::update_download",
      "update::update_install",
      "cabinet::cabinet_set_roots",
      "cabinet::cabinet_list",
      "cabinet::cabinet_open",
      "cabinet::cabinet_reveal",
      "cabinet::cabinet_drop_bridge",
      "cabinet::cabinet_resolve_shortcut",
      "cabinet::cabinet_drag_paths",
      "profile::app_profile",
      "exit_guard::exit_guard_cancel",
    ]);
  });

  it("DEV 명령 = Classic 명령 + DEV 일지 폴더 확인·준비·정식 일지 복제 + 온라인 공간(G-1 통합 앱, 98 — Preview 닫기 주도만 뺌)", () => {
    const online = prev.filter(
      (c) =>
        ![
          "splash::splash_finish",
          "files::config_read",
          "files::config_write",
          "files::open_url",
          "profile::app_profile",
          "preview_close::preview_exit",
        ].includes(c),
    );
    expect(dev).toEqual([
      ...classic,
      "dev_guard::dev_folder_status",
      "dev_guard::dev_prepare_folder",
      "dev_guard::dev_copy_official",
      ...online,
    ]);
    expect(dev).not.toContain("preview_close::preview_exit");
  });

  it("Preview 명령: 일지·백업·복원·내보내기·Cabinet·업데이트 없음, 온라인 계정(B)·원본 사본(C-2)·이관 통신(C-3)·온라인 공간(D)·이 기기 공간 일지(E-1)만 더함", () => {
    expect(prev).toEqual([
      "splash::splash_finish",
      "files::config_read",
      "files::config_write",
      "files::open_url",
      "profile::app_profile",
      "online::online_status",
      "online::online_send_code",
      "online::online_verify_code",
      "online::online_check",
      "online::online_sign_out",
      "source_copy::source_snapshot",
      "source_copy::source_snapshot_read",
      "source_copy::source_candidates",
      "source_copy::source_snapshot_remove",
      "migration::migration_device",
      "migration::migration_command",
      "migration::migration_put_asset",
      "migration::migration_cancel_asset",
      "migration::migration_journal_list",
      "migration::migration_journal_write",
      "migration::migration_journal_remove",
      "online_space::space_list",
      "online_space::space_sync",
      "online_space::space_read",
      "online_space::space_remove",
      "space_db::space_db_exists",
      "space_db::space_db_create",
      "space_db::space_db_open",
      "space_db::space_db_close",
      "space_db::space_db_select",
      "space_db::space_db_execute",
      "space_db::space_db_batch",
      "space_db::space_db_export",
      "preview_close::preview_exit",
      "space_sync::space_sync_call",
      "space_sync::online_account_call",
      "space_sync::space_asset_upload",
      "space_sync::space_asset_fetch",
    ]);
    // 온라인 모듈은 온라인 기능 빌드(Preview·DEV 통합 앱)에만 — 정식판(기능 없음)에는 컴파일되지 않는다
    expect(lib).toMatch(/#\[cfg\(feature = "online"\)\]\nmod online;/);
    const cargo = read("src-tauri/Cargo.toml");
    expect(cargo).toMatch(/^connected-preview = \["online"\]$/m);
    expect(cargo).toMatch(/^dev-channel = \["online"\]$/m);
    expect(cargo).not.toMatch(/^default = .*online/m);
    expect(lib).toMatch(
      /#\[cfg\(not\(feature = "connected-preview"\)\)\]\n\s+let builder = builder\.plugin\(tauri_plugin_sql/,
    );
  });
});

describe("원본 사본 오류 문구(C-4)", () => {
  it("source_copy.rs가 돌려주는 오류 코드마다 한국어 문구가 있다", async () => {
    const { STR } = await import("../../src/shared/strings");
    const codes = new Set(
      [...read("src-tauri/src/source_copy.rs").matchAll(/"([A-Z][A-Z_]{3,})"/g)].map((m) => m[1]!),
    );
    expect(codes.size).toBeGreaterThan(5);
    for (const c of codes) expect(STR.previewCopy.errors[c], c).toBeTruthy();
  });
});
