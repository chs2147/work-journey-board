// Cabinet(features-1102-spec F5): 경로·링크 정리, 끌어 놓기 제목(브라우저가 준 것만), 묶음·정렬, 저장소 등록·연결·해제·검색.
import { describe, expect, it } from "vitest";
import {
  ALL_GROUP,
  cabinetGroups,
  moveInOrder,
  parseUrlShortcut,
  urlShortcutTitle,
  fileKind,
  folderTitle,
  formatSize,
  groupCabinet,
  isFolderPathLike,
  joinPath,
  linkTitleFromUrl,
  normalizeFolderPath,
  parentWithin,
  parseLinkTransfer,
  relSegments,
  sortEntries,
  UNLINKED,
  type FsEntry,
} from "../../src/domain/cabinet";
import { ValidationError } from "../../src/data/repository";
import { freshRepo } from "./helpers";

describe("domain/cabinet — 경로", () => {
  it("탐색기 [경로로 복사] 따옴표·끝 구분자 정리, 드라이브 뿌리는 유지", () => {
    expect(normalizeFolderPath('"D:\\업무\\정산\\"')).toBe("D:\\업무\\정산");
    expect(normalizeFolderPath("C:")).toBe("C:\\");
    expect(normalizeFolderPath("C:/")).toBe("C:\\");
    expect(normalizeFolderPath("\\\\fileserver\\팀\\회의록\\")).toBe("\\\\fileserver\\팀\\회의록");
  });

  it("절대 경로만(드라이브·UNC·브라우저 모드 /), `..` 거부", () => {
    for (const ok of ["D:\\업무\\설계", "C:\\", "\\\\server\\share", "\\\\server\\share\\a", "/demo/업무"])
      expect(isFolderPathLike(ok), ok).toBe(true);
    for (const no of [
      "",
      "업무\\설계",
      "D",
      "\\\\server",
      "D:\\업무\\..\\Windows",
      "https://a.example/x",
      "a\nb",
    ])
      expect(isFolderPathLike(no), no).toBe(false);
  });

  it("기본 제목·잇기·상대 조각·한 단계 위(뿌리 밖으로 안 나감)", () => {
    expect(folderTitle("D:\\업무\\정산\\설계")).toBe("설계");
    expect(folderTitle("\\\\fileserver\\팀")).toBe("팀");
    expect(folderTitle("C:\\")).toBe("C:");
    expect(joinPath("D:\\업무", "테스트", "2026-10 이관")).toBe("D:\\업무\\테스트\\2026-10 이관");
    expect(joinPath("/demo/업무", "a")).toBe("/demo/업무/a");
    expect(relSegments("D:\\업무\\테스트", "D:\\업무\\테스트\\a\\b")).toEqual(["a", "b"]);
    expect(relSegments("D:\\업무\\테스트", "D:\\업무\\테스트2\\a")).toEqual([]);
    expect(parentWithin("D:\\업무\\테스트", "D:\\업무\\테스트\\a\\b")).toBe("D:\\업무\\테스트\\a");
    expect(parentWithin("D:\\업무\\테스트", "D:\\업무\\테스트")).toBe("D:\\업무\\테스트");
  });
});

describe("domain/cabinet — 링크(앱은 사이트에 접속하지 않음)", () => {
  it("주소로 만든 이름: 호스트 › 마지막 조각", () => {
    expect(linkTitleFromUrl("https://wiki.example.com/settlement/batch-ops")).toBe(
      "wiki.example.com › batch-ops",
    );
    expect(linkTitleFromUrl("https://www.example.com/")).toBe("example.com");
    expect(linkTitleFromUrl("http://intra.example.local/a/%EC%A0%95%EC%82%B0.html")).toBe(
      "intra.example.local › 정산",
    );
  });

  it("끌어 놓기: x-moz-url 제목 → HTML 링크 글자 → 없으면 주소 이름, http/https만", () => {
    expect(
      parseLinkTransfer({ mozUrl: "https://wiki.example.com/a\n정산 배치 운영 가이드 - 사내 위키" }),
    ).toEqual({
      url: "https://wiki.example.com/a",
      title: "정산 배치 운영 가이드 - 사내 위키",
      titleFromBrowser: true,
    });
    expect(
      parseLinkTransfer({
        uriList: "https://monitor.example.local/batch",
        html: '<meta charset="utf-8"><a href="https://monitor.example.local/batch">배치 모니터링 &amp; 대시보드</a>',
      }),
    ).toMatchObject({ title: "배치 모니터링 & 대시보드", titleFromBrowser: true });
    // 링크 글자가 주소 그대로면 제목 없음으로 본다
    expect(
      parseLinkTransfer({
        uriList: "https://wiki.example.com/settlement/batch-ops",
        html: '<a href="https://wiki.example.com/settlement/batch-ops">wiki.example.com/settlement/batch-ops</a>',
      }),
    ).toMatchObject({ title: "wiki.example.com › batch-ops", titleFromBrowser: false });
    expect(parseLinkTransfer({ plain: "https://a.example/x 다른 글" })).toMatchObject({
      url: "https://a.example/x",
    });
    expect(parseLinkTransfer({ uriList: "file:///C:/Windows", plain: "javascript:alert(1)" })).toBeNull();
    expect(parseLinkTransfer({ uriList: "# 주석\r\nhttps://a.example/y" })).toMatchObject({
      url: "https://a.example/y",
    });
  });
});

describe("domain/cabinet — 묶음·정렬·표시", () => {
  it("업무별 묶음(보드 순서, 항목 연결은 그 항목의 업무) + 연결 없음, 여러 업무면 각 묶음에", () => {
    const items = [
      { id: "a", kind: "folder" as const, title: "A", target: "/a", sortOrder: 2 },
      { id: "b", kind: "link" as const, title: "B", target: "https://b.example", sortOrder: 1 },
      { id: "c", kind: "folder" as const, title: "C", target: "/c", sortOrder: 3 },
    ];
    const links = [
      { id: "1", itemId: "a", categoryId: "x", entryId: null },
      {
        id: "2",
        itemId: "a",
        categoryId: null,
        entryId: "e",
        entry: { date: "2026-10-21", text: "t", categoryId: "y" },
      },
      { id: "3", itemId: "b", categoryId: "y", entryId: null },
    ];
    expect(groupCabinet(items, links, ["y", "x"])).toEqual([
      { key: "y", itemIds: ["b", "a"] },
      { key: "x", itemIds: ["a"] },
      { key: UNLINKED, itemIds: ["c"] },
    ]);
  });

  it("폴더 창 정렬: 폴더 먼저, 이름은 숫자 자연 순서, 기준 바꾸기", () => {
    const e = (name: string, dir = false, size: number | null = 1, modified = 0): FsEntry => ({
      name,
      dir,
      size,
      modified,
      hidden: false,
    });
    const list = [e("v10.sql", false, 30, 3), e("샘플 데이터", true, null, 1), e("v2.sql", false, 10, 5)];
    expect(sortEntries(list, "name", true).map((x) => x.name)).toEqual(["샘플 데이터", "v2.sql", "v10.sql"]);
    expect(sortEntries(list, "modified", false).map((x) => x.name)).toEqual([
      "샘플 데이터",
      "v2.sql",
      "v10.sql",
    ]);
    expect(sortEntries(list, "size", false).map((x) => x.name)).toEqual(["샘플 데이터", "v10.sql", "v2.sql"]);
    expect(fileKind({ name: "검증표.xlsx", dir: false })).toBe("sheet");
    expect(fileKind({ name: "이관 절차.docx", dir: false })).toBe("doc");
    expect(fileKind({ name: "x", dir: true })).toBe("folder");
    expect(formatSize(18 * 1024 - 5)).toBe("18 KB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("JournalRepository — Cabinet", () => {
  it("등록(같은 대상은 연결만 더함)·제목 고치기·연결 바꾸기·해제·되돌리기·검색", async () => {
    const { repo } = await freshRepo();
    const cat = await repo.createCategory("차세대 정산 시스템 구축", "2026-W43");
    const [item] = await repo.saveCell("2026-10-21", cat.id, [
      { id: "e1", depth: 0, text: "설계안 팀 리뷰" },
    ]);
    const r = await repo.addCabinetItems([
      {
        kind: "folder",
        title: "설계 문서",
        target: '"D:\\업무\\정산\\설계\\"',
        links: [{ categoryId: cat.id }],
      },
      {
        kind: "link",
        title: "정산 배치 설계서 v2 (사내 위키)",
        target: "https://wiki.example.com/settlement/batch-design",
        links: [{ entryId: item!.id }],
      },
    ]);
    expect(r.map((x) => x.created)).toEqual([true, true]);
    // 같은 폴더(대소문자 무시)를 다시 놓으면 새로 만들지 않고 연결만
    const again = await repo.addCabinetItems([
      { kind: "folder", title: "x", target: "d:\\업무\\정산\\설계", links: [{ entryId: item!.id }] },
    ]);
    expect(again).toEqual([{ id: r[0]!.id, created: false }]);
    let { items, links } = await repo.listCabinet();
    expect(items.map((i) => [i.kind, i.title, i.target])).toEqual([
      ["folder", "설계 문서", "D:\\업무\\정산\\설계"],
      ["link", "정산 배치 설계서 v2 (사내 위키)", "https://wiki.example.com/settlement/batch-design"],
    ]);
    expect(links.filter((l) => l.itemId === r[0]!.id)).toHaveLength(2);
    expect(links.find((l) => l.entryId)?.entry).toEqual({
      date: "2026-10-21",
      text: "설계안 팀 리뷰",
      categoryId: cat.id,
    });

    await expect(
      repo.addCabinetItems([{ kind: "link", title: "a", target: "file:///C:/x" }]),
    ).rejects.toThrow(ValidationError);
    await expect(
      repo.addCabinetItems([{ kind: "folder", title: "a", target: "상대\\경로" }]),
    ).rejects.toThrow(ValidationError);

    await repo.updateCabinetItem(r[1]!.id, { title: "  배치 설계서\n최신  " });
    await repo.setCabinetLinks(r[1]!.id, [{ categoryId: cat.id }, { categoryId: cat.id }]);
    ({ items, links } = await repo.listCabinet());
    expect(items[1]!.title).toBe("배치 설계서 최신");
    expect(links.filter((l) => l.itemId === r[1]!.id).map((l) => l.categoryId)).toEqual([cat.id]);

    expect((await repo.searchCabinet("설계 wiki")).map((h) => h.title)).toEqual(["배치 설계서 최신"]);
    expect((await repo.searchCabinet("설계")).map((h) => h.kind)).toEqual(["folder", "link"]);

    const undo = await repo.removeCabinetItem(r[0]!.id);
    expect((await repo.listCabinet()).items).toHaveLength(1);
    await repo.restoreCabinetItem(undo!);
    ({ items, links } = await repo.listCabinet());
    expect(items.map((i) => i.title)).toEqual(["설계 문서", "배치 설계서 최신"]);
    expect(links.filter((l) => l.itemId === r[0]!.id)).toHaveLength(2);

    // 항목을 지우면 그 항목 연결만 사라진다(폴더 등록은 그대로)
    await repo.saveCell("2026-10-21", cat.id, []);
    ({ links } = await repo.listCabinet());
    expect(links.filter((l) => l.itemId === r[0]!.id).map((l) => l.categoryId)).toEqual([cat.id]);
  });
});

describe("domain/cabinet — 2026-11-02 개선", () => {
  const items = [
    { id: "a", kind: "folder" as const, title: "A", target: "/a", sortOrder: 2 },
    { id: "b", kind: "link" as const, title: "B", target: "https://b.example", sortOrder: 1 },
    { id: "c", kind: "folder" as const, title: "C", target: "/c", sortOrder: 3 },
  ];
  const links = [
    { id: "1", itemId: "a", categoryId: "x", entryId: null },
    { id: "2", itemId: "b", categoryId: "old", entryId: null },
  ];

  it("업무별: 맨 위 전체 → 진행 중 업무 전부(0개도) → 종료 업무는 연결 있을 때만 → 연결 없음", () => {
    expect(cabinetGroups(items, links, ["y", "x", "old", "gone"], ["x", "y"])).toEqual([
      { key: ALL_GROUP, itemIds: ["b", "a", "c"] },
      { key: "y", itemIds: [] },
      { key: "x", itemIds: ["a"] },
      { key: "old", itemIds: ["b"], ended: true },
      { key: "__none__", itemIds: ["c"] },
    ]);
    expect(cabinetGroups([], [], ["x"], ["x"])).toEqual([
      { key: ALL_GROUP, itemIds: [] },
      { key: "x", itemIds: [] },
    ]);
  });

  it("순서 바꾸기: 앞에·뒤에·끝으로, 없는 대상이면 끝", () => {
    expect(moveInOrder(["a", "b", "c", "d"], "d", { beforeId: "b" })).toEqual(["a", "d", "b", "c"]);
    expect(moveInOrder(["a", "b", "c", "d"], "a", { afterId: "c" })).toEqual(["b", "c", "a", "d"]);
    expect(moveInOrder(["a", "b", "c"], "a", { beforeId: "zz" })).toEqual(["b", "c", "a"]);
    expect(moveInOrder(["a", "b"], "x", { beforeId: "a" })).toEqual(["a", "b"]);
  });

  it("인터넷 바로 가기(.url): URL= 줄의 http/https 주소, 파일 이름 = 제목", () => {
    expect(parseUrlShortcut("[InternetShortcut]\r\nURL=https://wiki.example.com/a?b=1\r\n")).toBe(
      "https://wiki.example.com/a?b=1",
    );
    expect(parseUrlShortcut("[InternetShortcut]\nURL=file:///C:/Windows")).toBeNull();
    expect(parseUrlShortcut("아무 글")).toBeNull();
    expect(urlShortcutTitle("정산 배치 운영 가이드 - 사내 위키.url")).toBe(
      "정산 배치 운영 가이드 - 사내 위키",
    );
  });
});
