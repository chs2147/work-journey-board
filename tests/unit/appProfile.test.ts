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
  const at = lib.indexOf(
    `#[cfg(${cfg})]\n    let builder = builder.invoke_handler(tauri::generate_handler![`,
  );
  expect(at).toBeGreaterThan(0);
  const body = lib.slice(lib.indexOf("[", at + cfg.length + 60) + 1, lib.indexOf("]);", at));
  return body
    .split(",")
    .map((s) => s.trim())
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

  it("Preview 덮어쓰기 = 앱 ID·이름·창 제목·권한 목록만 다르다", () => {
    expect(preview.identifier).toBe(tsv["connected-preview"].appId);
    expect(preview.productName).toBe(tsv["connected-preview"].productName);
    expect(Object.keys(preview).sort()).toEqual(["$schema", "app", "identifier", "productName"]);
    expect(Object.keys(preview.app).sort()).toEqual(["security", "windows"]);
    expect(Object.keys(preview.app.security)).toEqual(["capabilities"]);
    // 창 배열은 통째로 바뀌므로(merge patch) 제목 말고는 기본 설정과 같아야 한다
    const strip = (ws: { title: string }[]) => ws.map((w) => ({ ...w, title: "" }));
    expect(strip(preview.app.windows)).toEqual(strip(base.app.windows));
    for (const w of preview.app.windows) expect(w.title).toBe(preview.productName);
    expect(preview.app.security.capabilities.sort()).toEqual(["preview-main", "splash"]);
  });

  it("Preview 메인 창 권한: SQLite·파일 대화상자·창 만들기 없음, Classic 권한의 부분 집합(Classic에 새 권한 없음)", () => {
    const cap = json("src-tauri/capabilities/preview-main.json");
    const def = json("src-tauri/capabilities/default.json");
    expect(cap.windows).toEqual(["main"]);
    for (const p of cap.permissions as string[]) {
      expect(def.permissions).toContain(p);
      expect(p).not.toMatch(/^(sql|dialog|clipboard|opener|fs|http|shell)|create-webview/);
    }
  });
});

describe("Rust 명령 경계(lib.rs)", () => {
  const classic = handlers('not(feature = "connected-preview")');
  const prev = handlers('feature = "connected-preview"');

  it("Classic 명령 = 예전 목록 + 프로필 묻기", () => {
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
    ]);
  });

  it("Preview 명령: 일지·백업·복원·내보내기·Cabinet·업데이트 없음", () => {
    expect(prev).toEqual([
      "splash::splash_finish",
      "files::config_read",
      "files::config_write",
      "files::open_url",
      "profile::app_profile",
    ]);
    expect(lib).toMatch(
      /#\[cfg\(not\(feature = "connected-preview"\)\)\]\n\s+let builder = builder\.plugin\(tauri_plugin_sql/,
    );
  });
});
