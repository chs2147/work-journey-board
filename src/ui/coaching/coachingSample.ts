// 코칭 예시 일지 만들기(coaching-spec 4-5, D11) — 메모리(sql.js) 일지에 가상 샘플을 이번 주로 옮겨 넣는다. 파일·백업·설정 없음.
import type { SqlDriver } from "../../data/driver";
import type { JournalRepository } from "../../data/repository";
import { emptyContent, type NoteDoc, type PMNode } from "../../domain/note";
import { SqlJsDriver } from "../../data/drivers/sqlJs";
import { migrate } from "../../data/migrate";
import { seedSample, type SampleData } from "../../data/seed";
import { sampleWeekShift, shiftSampleDates } from "../../domain/coachingSample";
import { loadSql } from "../../preview/migrationSession";

export async function makeCoachingSample(now: Date): Promise<SqlDriver> {
  const [SQL, data] = await Promise.all([loadSql(), import("../../../fixtures/sample-showcase.json")]);
  const driver = new SqlJsDriver(new SQL.Database(), "코칭 예시 일지(메모리)");
  await migrate(driver, { now: () => now });
  await seedSample(driver, shiftSampleDates(data.default as SampleData, sampleWeekShift(now)), now);
  return driver;
}

// ── 업무노트·업무 메모보드 투어용 가상 문서(coaching-spec 13절) — 예시 일지(메모리)에만 만든다 ──
const t = (text: string): PMNode => ({ type: "text", text });
const p = (text: string): PMNode => ({ type: "paragraph", content: [t(text)] });
const h = (level: number, text: string): PMNode => ({
  type: "heading",
  attrs: { level },
  content: [t(text)],
});
const li = (text: string): PMNode => ({ type: "listItem", content: [p(text)] });
const task = (text: string, checked: boolean): PMNode => ({
  type: "taskItem",
  attrs: { checked },
  content: [p(text)],
});
const cell = (text: string, header = false): PMNode => ({
  type: header ? "tableHeader" : "tableCell",
  content: [p(text)],
});
const row = (cells: string[], header = false): PMNode => ({
  type: "tableRow",
  content: cells.map((c) => cell(c, header)),
});

/** 가상 검토 노트 — 문단·제목·목록·체크·표 */
const SAMPLE_NOTE: PMNode = {
  type: "doc",
  content: [
    p("가상 예시 업무의 검토 방향과 결정 사항을 정리한 노트입니다."),
    h(2, "결정 사항"),
    {
      type: "bulletList",
      content: [li("야간 배치는 02~04시에 실행"), li("재처리 조건은 다음 리뷰에서 확정")],
    },
    h(2, "할 일"),
    { type: "taskList", content: [task("설계서 v2 공유", true), task("테스트 데이터 이관 계획", false)] },
    h(2, "일정"),
    {
      type: "table",
      content: [
        row(["단계", "기간", "상태"], true),
        row(["설계 리뷰", "1주차", "완료"]),
        row(["개발·시험", "2~3주차", "진행"]),
      ],
    },
  ],
};

/**
 * 투어 창에 띄울 예시 문서를 만들고 창 id를 돌려준다 — 노트 = 노트 id, 업무 메모보드 = 업무 id.
 * 반드시 예시 일지 저장소에만 부른다(호출하는 쪽이 `journal.sample`을 확인).
 */
export async function prepareCoachDocument(repo: JournalRepository, kind: "note" | "board"): Promise<string> {
  const cats = (await repo.listCategories()).categories;
  const cat = cats[0];
  if (!cat) throw new Error("예시 업무가 없습니다");
  if (kind === "note") {
    const note = await repo.cabi.createNote(cat.id, "검토 방향과 결정 사항(가상 예시)", SAMPLE_NOTE);
    return note.id;
  }
  const board = await repo.cabi.board(cat.id, true);
  if (!board) throw new Error("예시 업무 보드를 만들지 못했습니다");
  if (!board.doc.boxes.length) {
    const doc: NoteDoc = {
      v: 1,
      boxes: [
        {
          id: crypto.randomUUID(),
          kind: "text",
          x: 24,
          y: 24,
          w: 300,
          h: 200,
          z: 1,
          bg: null,
          content: emptyContent(),
          widget: { type: "elapsed", basis: "start", variant: "records", weeks: 8, milestoneEntryIds: [] },
        },
        {
          id: crypto.randomUUID(),
          kind: "text",
          x: 360,
          y: 24,
          w: 320,
          z: 2,
          bg: "yellow",
          content: { type: "doc", content: [h(3, "이번 달 목표(가상 예시)"), p("정산 배치 v2 오픈 준비")] },
        },
      ],
    };
    await repo.cabi.saveBoard(cat.id, board.revision, doc);
  }
  return cat.id;
}
