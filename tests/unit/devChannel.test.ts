// 정식판·DEV 검증판 운영 정책(docs/release-channel-spec.md) — 정식 일지 보호·DEV 설정·Tauri 설정
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DATA_FILE } from "../../src/data/backup";
import { openSqlJs } from "../../src/data/drivers/sqlJs";
import { openJournalAt } from "../../src/data/session";
import { browserDevJournal, DEV_MARKER } from "../../src/platform/browserDevJournal";
import { createFakeFs } from "../../src/platform/fakeFs";
import {
  CLASSIC_PROFILE,
  DEV_PROFILE,
  OfficialJournalError,
  parseAppProfile,
  parseConfig,
} from "../../src/platform/index";

const newFs = () => createFakeFs((bytes, label) => openSqlJs(undefined, bytes, label));
const now = () => new Date(2026, 10, 14, 9, 0, 0);
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));

async function officialJournal(fs: ReturnType<typeof newFs>, dir: string) {
  await fs.ensureDir(dir);
  const d = await openJournalAt(fs, dir, now); // 정식판처럼(검증판 검사 없음) 만든다
  await d.close();
}

describe("DEV 일지 보호(openJournalAt)", () => {
  it("정식 일지 폴더는 열기 전에 거절 — 파일 목록·내용 그대로(백업·표시·마이그레이션 없음)", async () => {
    const fs = newFs();
    await officialJournal(fs, "/off");
    const before = fs.listAll().filter((p) => p.startsWith("/off"));
    const bytes = await fs.stat(`/off/${DATA_FILE}`);
    const devFs = { ...fs, dev: browserDevJournal(fs) };
    await expect(openJournalAt(devFs, "/off", now)).rejects.toBeInstanceOf(OfficialJournalError);
    expect(fs.listAll().filter((p) => p.startsWith("/off"))).toEqual(before);
    expect((await fs.stat(`/off/${DATA_FILE}`)).size).toBe(bytes.size);
    expect((await fs.stat(`/off/${DEV_MARKER}`)).exists).toBe(false);
  });

  it("빈 폴더는 DEV 표시를 남기고 새 일지, 다시 열어도 통과", async () => {
    const fs = newFs();
    const dev = browserDevJournal(fs);
    const devFs = { ...fs, dev };
    await fs.ensureDir("/dev");
    (await openJournalAt(devFs, "/dev", now)).close();
    expect(await dev.folderStatus("/dev")).toBe("dev");
    (await openJournalAt(devFs, "/dev", now)).close();
  });

  it("정식 일지 복제: 원본은 읽기만, 복사본은 DEV 표시, 겹치는 위치·다시 복제 거절", async () => {
    const fs = newFs();
    await officialJournal(fs, "/off");
    const dev = browserDevJournal(fs);
    const before = fs.listAll().filter((p) => p.startsWith("/off"));
    await dev.copyOfficial("/off", "/devcopy");
    expect(await dev.folderStatus("/devcopy")).toBe("dev");
    expect(await dev.folderStatus("/off")).toBe("official");
    expect(fs.listAll().filter((p) => p.startsWith("/off"))).toEqual(before);
    (await openJournalAt({ ...fs, dev }, "/devcopy", now)).close();
    await expect(dev.copyOfficial("/off", "/devcopy")).rejects.toThrow("DEST_NOT_EMPTY");
    await expect(dev.copyOfficial("/off", "/off/inner")).rejects.toThrow("DEST_OVERLAPS_SOURCE");
    await expect(dev.copyOfficial("/devcopy", "/x")).rejects.toThrow("SOURCE_NOT_OFFICIAL");
  });
});

describe("DEV 프로필·설정", () => {
  it("Rust가 DEV라고 답할 때만 DEV, 정식판은 그대로", () => {
    expect(parseAppProfile({ key: "local-dev", appId: DEV_PROFILE.appId })).toBe(DEV_PROFILE);
    expect(parseAppProfile({ key: "local-dev", appId: CLASSIC_PROFILE.appId })).toBe(CLASSIC_PROFILE);
    expect(DEV_PROFILE.updates).toBe(false);
    expect(DEV_PROFILE.unofficial && !CLASSIC_PROFILE.unofficial).toBe(true);
  });
  it("설치 판 기억(devSetupVersion)은 설정 파일 왕복에서 유지", () => {
    expect(
      parseConfig(JSON.stringify({ dataDir: "/d", devSetupVersion: "1.41.0-rc.1" }))?.devSetupVersion,
    ).toBe("1.41.0-rc.1");
  });
  it("tauri.dev.conf.json: 앱 ID·이름·실행 파일 이름·창 제목만 다르고 권한·CSP는 정식판 그대로", () => {
    const base = json("src-tauri/tauri.conf.json");
    const dev = json("src-tauri/tauri.dev.conf.json");
    expect(dev.identifier).toBe(DEV_PROFILE.appId);
    expect(dev.productName).toBe(DEV_PROFILE.productName);
    expect(dev.mainBinaryName).toBe("work-journey-board-dev");
    expect(Object.keys(dev).sort()).toEqual([
      "$schema",
      "app",
      "identifier",
      "mainBinaryName",
      "productName",
    ]);
    expect(Object.keys(dev.app)).toEqual(["windows"]);
    const strip = (ws: { title: string }[]) => ws.map((w) => ({ ...w, title: "" }));
    expect(strip(dev.app.windows)).toEqual(strip(base.app.windows));
    for (const w of dev.app.windows) expect(w.title).toBe("Work Journey Board DEV");
  });
  it("Rust 일지 쓰기 명령은 모두 DEV 보호 검사를 먼저 지난다", () => {
    const files = readFileSync("src-tauri/src/files.rs", "utf8");
    for (const cmd of [
      "fs_ensure_dir",
      "fs_remove_backup",
      "fs_rename_backup",
      "fs_copy_new",
      "restore_journal",
      "export_write",
    ]) {
      const at = files.indexOf(`pub fn ${cmd}(`);
      expect(at, cmd).toBeGreaterThan(0);
      expect(files.slice(at, files.indexOf("\n}\n", at)), cmd).toContain("crate::dev_guard::write_allowed");
    }
    expect(readFileSync("src-tauri/src/db_batch.rs", "utf8")).toContain("crate::dev_guard::write_allowed");
  });
});
