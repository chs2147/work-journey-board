// Universe UV3 지식 카드(universe-spec 5-2·8-1): 검증·지문·근거 상태 · 저장소(만들기·고치기·상태·다시 확인·지우기·임시본) · 마이그레이션 v11 → v12
import { describe, expect, it, vi } from "vitest";
import { openSqlJsMemory } from "../../src/data/drivers/sqlJs";
import { MIGRATIONS, migrate, quickCheck } from "../../src/data/migrate";
import { CardError } from "../../src/data/repository";
import {
  cardProblem,
  fingerprint,
  sourceKey,
  sourceState,
  worstState,
  type CardDraft,
} from "../../src/domain/knowledgeCard";
import { buildGraph } from "../../src/domain/universe";
import { freshRepo } from "./helpers";

const draft = (over: Partial<CardDraft> = {}): CardDraft => ({
  type: "solution",
  title: "재시도 해결법",
  summary: "",
  conditions: "",
  body: "",
  status: "draft",
  categoryIds: [],
  sources: [{ kind: "entry", sourceId: "e1" }],
  ...over,
});

describe("cardProblem — 길이·유형·출처 수", () => {
  it("제목 1~120자, 요약 300·적용 조건 1,000·본문 10,000자, 출처 1~50(중복 금지)", () => {
    expect(cardProblem(draft())).toBe(null);
    expect(cardProblem(draft({ title: "  " }))).toBe("title");
    expect(cardProblem(draft({ title: "가".repeat(121) }))).toBe("title");
    expect(cardProblem(draft({ summary: "가".repeat(301) }))).toBe("summary");
    expect(cardProblem(draft({ conditions: "가".repeat(1001) }))).toBe("conditions");
    expect(cardProblem(draft({ body: "가".repeat(10001) }))).toBe("body");
    expect(cardProblem(draft({ sources: [] }))).toBe("sources");
    expect(
      cardProblem(
        draft({
          sources: Array.from({ length: 51 }, (_, i) => ({ kind: "entry" as const, sourceId: `e${i}` })),
        }),
      ),
    ).toBe("sources");
    expect(
      cardProblem(
        draft({
          sources: [
            { kind: "entry", sourceId: "e1" },
            { kind: "entry", sourceId: "e1" },
          ],
        }),
      ),
    ).toBe("sources");
    expect(cardProblem(draft({ type: "x" as never }))).toBe("type");
  });
  it("메모 상자 출처는 주까지 같아야 같은 출처", () => {
    expect(sourceKey({ kind: "note", sourceId: "b", week: "2026-W43" })).not.toBe(
      sourceKey({ kind: "note", sourceId: "b", week: "2026-W44" }),
    );
  });
});

describe("근거 상태 — 지문으로 일치·내용 변경·위치 변경·원문 없음", () => {
  const src = { contentFp: fingerprint("0|이관|"), locationFp: fingerprint("2026-10-22|c1") };
  it("같으면 일치, 글이 바뀌면 내용 변경, 날짜·업무만 바뀌면 위치 변경, 없으면 원문 없음", () => {
    expect(
      sourceState(src, { text: "이관", content: "0|이관|", location: "2026-10-22|c1", locator: "" }),
    ).toBe("ok");
    expect(
      sourceState(src, { text: "이관!", content: "0|이관!|", location: "2026-10-22|c1", locator: "" }),
    ).toBe("changed");
    expect(
      sourceState(src, { text: "이관", content: "0|이관|", location: "2026-10-23|c1", locator: "" }),
    ).toBe("moved");
    expect(sourceState(src, null)).toBe("missing");
    expect(worstState(["ok", "moved", "changed"])).toBe("changed");
    expect(worstState(["ok", "missing", "changed"])).toBe("missing");
  });
  it("지문은 결정적이고 짧은 16자리", () => {
    expect(fingerprint("가나다")).toBe(fingerprint("가나다"));
    expect(fingerprint("가나다")).not.toBe(fingerprint("가나라"));
    expect(fingerprint("x")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("저장소 — 지식 카드", () => {
  async function setup() {
    const { repo, db, clock } = await freshRepo();
    const c = await repo.createCategory("정산", "2026-W43");
    const [a, b] = await repo.saveCell("2026-10-22", c.id, [
      { id: "ea", depth: 0, text: "이관 스크립트" },
      { id: "eb", depth: 1, text: "재시도 3회" },
    ]);
    return { repo, db, clock, c, a: a!, b: b! };
  }
  const src = (id: string) => ({ kind: "entry" as const, sourceId: id });

  it("만들기: 당시 발췌·위치를 남기고, 스냅샷에 카드 노드·출처 선, 보드 ◆ 표시", async () => {
    const { repo, a, b, c } = await setup();
    const card = await repo.createCard(
      draft({ title: "  재시도 해결법 ", categoryIds: [c.id, "없는-업무"], sources: [src(a.id), src(b.id)] }),
    );
    expect(card.title).toBe("재시도 해결법");
    expect(card.categoryIds).toEqual([c.id]);
    expect(card.sources.map((x) => x.excerpt)).toEqual(["이관 스크립트", "재시도 3회"]);
    expect(card.sources[0]!.locator).toBe("정산 · 2026-10-22");
    const s = await repo.getUniverseSnapshot({ key: "W", name: "회사", color: "c1" });
    const g = buildGraph(s);
    expect(g.nodes.filter((n) => n.kind === "card")).toHaveLength(1);
    expect(g.edges.filter((e) => e.source === "card-source")).toHaveLength(2);
    expect(await repo.cardSourceEntries()).toEqual({ [a.id]: [card.id], [b.id]: [card.id] });
  });
  it("원문이 없으면 만들지 않음 · 길이 넘침은 CardError", async () => {
    const { repo } = await setup();
    await expect(repo.createCard(draft({ sources: [src("없음")] }))).rejects.toMatchObject({
      problem: "missing",
    });
    await expect(repo.createCard(draft({ title: "" }))).rejects.toBeInstanceOf(CardError);
  });
  it("원문을 고치면 내용 변경, 세부의 부모 글이 바뀌어도 내용 변경, [다시 확인]하면 일치", async () => {
    const { repo, a, b, c } = await setup();
    const card = await repo.createCard(draft({ sources: [src(a.id), src(b.id)] }));
    await repo.saveCell("2026-10-22", c.id, [
      { id: a.id, depth: 0, text: "이관 스크립트(고침)" },
      { id: b.id, depth: 1, text: "재시도 3회" },
    ]);
    const now = await repo.sourcesNow(card.sources);
    const states = card.sources.map((x) => sourceState(x, now.get(sourceKey(x)) ?? null));
    expect(states).toEqual(["changed", "changed"]);
    await repo.recheckCardSource(card.id, card.sources[0]!.id);
    const after = (await repo.getCard(card.id))!;
    expect(after.sources[0]!.excerpt).toBe("이관 스크립트(고침)");
    const now2 = await repo.sourcesNow(after.sources);
    expect(sourceState(after.sources[0]!, now2.get(sourceKey(after.sources[0]!)) ?? null)).toBe("ok");
    expect(after.revision).toBe(card.revision + 1);
  });
  it("다른 날로 옮기면 위치 변경, 지우면 원문 없음(출처 행은 남음)", async () => {
    const { repo, a, c } = await setup();
    const card = await repo.createCard(draft({ sources: [src(a.id)] }));
    await repo.saveCell("2026-10-22", c.id, []);
    await repo.saveCell("2026-10-23", c.id, [{ id: a.id, depth: 0, text: "이관 스크립트" }]);
    let now = await repo.sourcesNow(card.sources);
    expect(sourceState(card.sources[0]!, now.get(sourceKey(card.sources[0]!)) ?? null)).toBe("moved");
    await repo.saveCell("2026-10-23", c.id, []);
    now = await repo.sourcesNow(card.sources);
    expect(now.size).toBe(0);
    expect((await repo.getCard(card.id))!.sources).toHaveLength(1);
  });
  it("고치기: 남은 출처의 당시 발췌는 그대로·새 출처만 지금 원문, revision이 다르면 거부", async () => {
    const { repo, a, b, c } = await setup();
    const card = await repo.createCard(draft({ sources: [src(a.id)] }));
    await repo.saveCell("2026-10-22", c.id, [
      { id: a.id, depth: 0, text: "바뀐 글" },
      { id: b.id, depth: 1, text: "재시도 3회" },
    ]);
    const before = await repo.updateCard(
      card.id,
      draft({ title: "고친 제목", sources: [src(a.id), src(b.id)] }),
      card.revision,
    );
    expect(before.title).toBe("재시도 해결법");
    const after = (await repo.getCard(card.id))!;
    expect(after.sources.map((x) => x.excerpt)).toEqual(["이관 스크립트", "재시도 3회"]);
    await expect(repo.updateCard(card.id, draft(), card.revision)).rejects.toMatchObject({
      problem: "stale",
    });
  });
  it("상태: 검토함이면 reviewed_at, 초안으로 되돌리면 비움 · 지우기는 소프트(되살리기)", async () => {
    const { repo, a, db } = await setup();
    const card = await repo.createCard(draft({ sources: [src(a.id)] }));
    expect(await repo.setCardStatus(card.id, "reviewed")).toBe("draft");
    expect((await repo.getCard(card.id))!.reviewedAt).not.toBe(null);
    await repo.setCardStatus(card.id, "draft");
    expect((await repo.getCard(card.id))!.reviewedAt).toBe(null);
    await repo.deleteCard(card.id);
    expect(await repo.listCards()).toEqual([]);
    expect(await repo.cardSourceEntries()).toEqual({});
    expect(await db.select("SELECT id FROM knowledge_card")).toEqual([{ id: card.id }]);
    await repo.restoreCard(card.id);
    expect(await repo.listCards()).toHaveLength(1);
  });
  it("임시본: 이 일지 app_meta에 보관·복구·지우기, 검색은 제목·요약·본문", async () => {
    const { repo, a } = await setup();
    expect(await repo.getCardDraft()).toBe(null);
    await repo.saveCardDraft(draft({ title: "작성 중" }));
    expect((await repo.getCardDraft())!.title).toBe("작성 중");
    await repo.saveCardDraft(null);
    expect(await repo.getCardDraft()).toBe(null);
    await repo.createCard(draft({ title: "야간 배치 대응", body: "재시도 후 알림", sources: [src(a.id)] }));
    expect((await repo.searchCards("재시도 알림")).map((h) => h.title)).toEqual(["야간 배치 대응"]);
    expect(await repo.searchCards("없는말")).toEqual([]);
  });
});

describe("마이그레이션 v11 → v12(knowledge_card)", () => {
  it("직전 백업, 기존 자료 그대로, 길이·종류 CHECK, 같은 출처 중복 금지, 카드 지우면 출처·업무 연결도", async () => {
    const db = await openSqlJsMemory();
    await migrate(db, { migrations: MIGRATIONS.slice(0, 11) });
    await db.execute(
      "INSERT INTO category (id, name, color, sort_order, created_at, updated_at) VALUES ('c1', '업무', 'c1', 1, 't', 't')",
    );
    const before = vi.fn().mockResolvedValue(undefined);
    expect(await migrate(db, { beforeMigrate: before })).toBe(12);
    expect(before).toHaveBeenCalledWith(11, 12);
    await db.execute(
      "INSERT INTO knowledge_card (id, card_type, title, created_at, updated_at) VALUES ('k1', 'solution', '제목', 't', 't')",
    );
    await expect(
      db.execute(
        "INSERT INTO knowledge_card (id, card_type, title, created_at, updated_at) VALUES ('k2', 'memo', '제목', 't', 't')",
      ),
    ).rejects.toThrow();
    await expect(
      db.execute(
        "INSERT INTO knowledge_card (id, card_type, title, created_at, updated_at) VALUES ('k3', 'guide', '', 't', 't')",
      ),
    ).rejects.toThrow();
    await db.execute("INSERT INTO knowledge_card_category (card_id, category_id) VALUES ('k1', 'c1')");
    const ins = (id: string) =>
      db.execute(
        `INSERT INTO knowledge_card_source (id, card_id, source_kind, source_id, source_week, content_fp, location_fp, sort_order, captured_at) VALUES ('${id}', 'k1', 'note', 'b1', '2026-W43', 'a', 'b', 0, 't')`,
      );
    await ins("s1");
    await expect(ins("s2")).rejects.toThrow();
    await db.execute("DELETE FROM knowledge_card WHERE id = 'k1'");
    expect(await db.select("SELECT * FROM knowledge_card_source")).toEqual([]);
    expect(await db.select("SELECT * FROM knowledge_card_category")).toEqual([]);
    expect(await quickCheck(db)).toBe(true);
  });
});
