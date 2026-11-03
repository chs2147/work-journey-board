import { describe, expect, it } from "vitest";
import {
  FIRST_WORKSPACE,
  PURPOSE_PRESET,
  WORKSPACE_ICONS,
  canRemove,
  cleanName,
  entryAt,
  folderSafe,
  moveEntry,
  nextWorkspaceColor,
  parseMeta,
  readEntries,
  reconcile,
  removeEntry,
  sameDir,
  suggestDir,
  upsertEntry,
  type WorkspaceEntry,
} from "../../src/domain/workspace";
import { mergeSettings, DEFAULT_SETTINGS } from "../../src/data/settings";
import { exportFileName, workspacePart } from "../../src/export/filename";

const W = (dir: string, extra: Partial<WorkspaceEntry> = {}): WorkspaceEntry => ({
  dir,
  name: "회사",
  color: "c1",
  icon: "briefcase",
  updatedAt: 0,
  ...extra,
});

describe("워크스페이스 목록(multi-board-spec 7절)", () => {
  it("목록이 없으면(예전 판 사용자) 지금 폴더 하나 = 회사·파랑·서류 가방", () => {
    expect(readEntries({ dataDir: "C:\\U\\WorkJourney" })).toEqual([
      { ...FIRST_WORKSPACE, updatedAt: 0, dir: "C:\\U\\WorkJourney" },
    ]);
  });

  it("같은 폴더(대소문자·구분자·끝 구분자 차이)는 한 번만, 못 쓰는 값은 버리고, 지금 폴더가 없으면 맨 앞에", () => {
    const list = readEntries({
      dataDir: "D:\\Main",
      workspaces: [
        { dir: "C:\\U\\A", name: "개인", color: "c3", icon: "notebook", updatedAt: 5 },
        { dir: "c:/u/a/", name: "중복" },
        { dir: "", name: "빈 경로" },
        "엉뚱한 값",
        { dir: "E:\\B", name: "  ", color: "zz", icon: "nope" },
      ],
    });
    expect(list.map((e) => e.dir)).toEqual(["D:\\Main", "C:\\U\\A", "E:\\B"]);
    expect(list[1]).toMatchObject({ name: "개인", color: "c3", icon: "notebook", updatedAt: 5 });
    expect(list[2]).toMatchObject({ name: "B", color: "c1", icon: "briefcase" });
  });

  it("sameDir: 윈도우 경로 비교", () => {
    expect(sameDir("C:\\Users\\Me\\WJ", "c:/users/me/wj/")).toBe(true);
    expect(sameDir("C:\\WJ", "C:\\WJ2")).toBe(false);
  });

  it("넣기·바꾸기·빼기·순서·n번째", () => {
    let list = [W("A"), W("B", { name: "개인" })];
    list = upsertEntry(list, W("b", { name: "개인2" }));
    expect(list.map((e) => e.name)).toEqual(["회사", "개인2"]);
    list = upsertEntry(list, W("C", { name: "공부" }));
    expect(list).toHaveLength(3);
    expect(moveEntry(list, 2, 0).map((e) => e.dir)).toEqual(["C", "A", "b"]);
    expect(moveEntry(list, 0, 9)).toBe(list);
    expect(entryAt(list, 3)?.name).toBe("공부");
    expect(entryAt(list, 0)).toBeNull();
    expect(entryAt(list, 10)).toBeNull();
    expect(removeEntry(list, "a").map((e) => e.dir)).toEqual(["b", "C"]);
  });

  it("목록에서 빼기(D10): 지금 연 공간·마지막 하나는 안 됨", () => {
    const list = [W("A"), W("B")];
    expect(canRemove(list, "B", "A")).toBe(true);
    expect(canRemove(list, "a", "A")).toBe(false);
    expect(canRemove([W("A")], "A", null)).toBe(false);
    expect(canRemove(list, "Z", "A")).toBe(false);
  });

  it("일지 정보 ↔ 이 PC 사본: 일지에 없으면 사본을 쓰고, 사본이 더 새것이면 사본이 이긴다", () => {
    const e = W("A", { name: "개인", updatedAt: 10 });
    expect(reconcile(null, e)).toEqual({
      meta: { name: "개인", color: "c1", icon: "briefcase", updatedAt: 10 },
      writeJournal: true,
    });
    const j = { name: "회사", color: "c2" as const, icon: "folder" as const, updatedAt: 20 };
    expect(reconcile(j, e)).toEqual({ meta: j, writeJournal: false });
    expect(reconcile({ ...j, updatedAt: 5 }, e).writeJournal).toBe(true);
  });

  it("새 공간 추천 폴더: 지금 공간 옆 `<이름>-<새 이름>`, 이미 쓰면 -2, 못 쓰는 글자는 뺀다", () => {
    expect(suggestDir("C:\\Users\\me\\WorkJourney", "개인", [])).toBe("C:\\Users\\me\\WorkJourney-개인");
    expect(suggestDir("/Users/me/WorkJourney-개인", "공부", [])).toBe("/Users/me/WorkJourney-공부");
    expect(suggestDir("C:\\W\\WorkJourney", "개인", ["c:\\w\\workjourney-개인"])).toBe(
      "C:\\W\\WorkJourney-개인-2",
    );
    expect(suggestDir("C:\\W\\WorkJourney", 'a/b:c*?"', [])).toBe("C:\\W\\WorkJourney-abc");
    expect(folderSafe("  끝 점.  ")).toBe("끝 점");
  });

  it("이름 다듬기·색 고르기·용도 기본값", () => {
    expect(cleanName("  개인   생활 ")).toBe("개인 생활");
    expect(cleanName("가".repeat(40))).toHaveLength(24);
    expect(nextWorkspaceColor([W("A"), W("B", { color: "c2" })])).toBe("c3");
    expect(PURPOSE_PRESET.life.categories).toContain("건강·운동");
    for (const p of Object.values(PURPOSE_PRESET)) expect(WORKSPACE_ICONS).toContain(p.icon);
  });

  it("parseMeta: 이름이 없으면 null, 모르는 색·아이콘은 기본값", () => {
    expect(parseMeta(null)).toBeNull();
    expect(parseMeta({ name: "" })).toBeNull();
    expect(parseMeta({ name: "개인", color: "c9", icon: "x" })).toEqual({
      name: "개인",
      color: "c1",
      icon: "briefcase",
      updatedAt: 0,
    });
  });
});

describe("일지 설정 settings.workspace", () => {
  it("기본값 null · 저장값은 검사해서 합친다", () => {
    expect(mergeSettings(structuredClone(DEFAULT_SETTINGS), {}).workspace).toBeNull();
    const s = mergeSettings(structuredClone(DEFAULT_SETTINGS), {
      workspace: { name: "개인", color: "c3", icon: "notebook", updatedAt: 3 },
    });
    expect(s.workspace).toEqual({ name: "개인", color: "c3", icon: "notebook", updatedAt: 3 });
    expect(mergeSettings(structuredClone(DEFAULT_SETTINGS), { workspace: "엉뚱" }).workspace).toBeNull();
  });
});

describe("내보내기 파일 이름(D8)", () => {
  it("공간 이름이 있으면 앞에, 못 쓰는 글자는 뺀다", () => {
    expect(exportFileName("2026-W43", "2026-W43")).toBe("업무일지_2026-W43.xlsx");
    expect(exportFileName("2026-W43", "2026-W43", false, "개인")).toBe("업무일지_개인_2026-W43.xlsx");
    expect(exportFileName("2026-W40", "2026-W43", true, "개인")).toBe("업무일지_개인_전체_2026-W40~W43.xlsx");
    expect(workspacePart('a/b"')).toBe("ab_");
    expect(workspacePart(undefined)).toBe("");
  });
});

describe("1.8.0-rc.1 버그: 다시 켜면 워크스페이스 목록이 사라짐", () => {
  it("parseConfig(실앱이 config.json을 읽는 길)가 workspaces·cabinetBy를 버리지 않는다", async () => {
    const { parseConfig, mergeConfigJson } = await import("../../src/platform");
    const raw = mergeConfigJson(null, {
      dataDir: "C:\\U\\WorkJourney-개인",
      workspaces: [W("C:\\U\\WorkJourney"), W("C:\\U\\WorkJourney-개인", { name: "개인", color: "c3" })],
      cabinetBy: { "C:\\U\\WorkJourney": { open: true, windows: [{ id: "a", sub: "C:\\x" }] } },
    });
    const cfg = parseConfig(raw)!;
    // 다시 켠 뒤 목록 = 두 공간 그대로(지금 연 공간 하나로 줄지 않음)
    expect(readEntries(cfg).map((e) => e.name)).toEqual(["회사", "개인"]);
    expect(cfg.cabinetBy?.["C:\\U\\WorkJourney"]?.open).toBe(true);
  });

  it("설정 저장을 하나씩 차례로 — 동시에 저장해도 먼저 쓴 값(목록)이 지워지지 않는다", async () => {
    const { serialize, mergeConfigJson } = await import("../../src/platform");
    let file: string | null = '{"dataDir":"A"}';
    const tick = () => new Promise((r) => setTimeout(r, 5));
    const save = serialize(async (patch: Record<string, unknown>) => {
      const raw = file;
      await tick(); // 읽기와 쓰기 사이에 다른 저장이 끼어들 틈
      file = mergeConfigJson(raw, patch);
    });
    await Promise.all([
      save({ workspaces: [W("A"), W("B")] }),
      save({ cabinet: { open: false, windows: [] } }),
    ]);
    const out = JSON.parse(file!);
    expect(out.workspaces).toHaveLength(2);
    expect(out.cabinet).toEqual({ open: false, windows: [] });
    // 앞 일이 실패해도 다음 저장은 한다
    const bad = serialize(async (x: number) => {
      if (x === 1) throw new Error("x");
      return x;
    });
    await expect(bad(1)).rejects.toThrow();
    await expect(bad(2)).resolves.toBe(2);
  });
});
