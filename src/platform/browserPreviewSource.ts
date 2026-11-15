// 브라우저 모드(개발·E2E)용 가짜 원본 사본 — 가상 샘플 일지를 sql.js로 만들어 메모리에만 둔다(실제 업무 기록 아님)
import { SqlJsDriver } from "../data/drivers/sqlJs";
import { migrate } from "../data/migrate";
import { seedSample } from "../data/seed";
import type { PreviewSource, SourceSnapshot } from "./index";

const snapshots = new Map<string, Uint8Array>();
export const browserPreviewSource: PreviewSource = {
  async pickFolder() {
    return "C:\\Users\\가상 사용자\\Documents\\WorkJourney";
  },
  /** 가짜: ?copyParent=1 이면 고른 폴더 아래 두 공간(하위 폴더 고르기 화면 확인용) */
  async candidates(dir) {
    return new URLSearchParams(location.search).get("copyParent") ? [`${dir}\\회사`, `${dir}\\개인`] : [dir];
  },
  async snapshot(): Promise<SourceSnapshot> {
    // 실앱과 같은 sql.js 불러오기(wasm을 fetch하지 않음 — Preview CSP에서도 동작)
    const { loadSql } = await import("../preview/migrationSession");
    const driver = new SqlJsDriver(new (await loadSql()).Database());
    await migrate(driver);
    // ?sample=year-img — 가상 1년치(그림 포함): 큰 일지 진행 화면 확인용
    const which = new URLSearchParams(location.search).get("sample");
    const sample =
      which === "year" || which === "year-img"
        ? await (await import("./sampleYear")).makeYearSample(which === "year-img")
        : (await import("../../fixtures/sample-showcase.json")).default;
    await seedSample(driver, sample as never);
    // 가상 업무노트·업무 메모보드 하나씩(온라인 공간에서 별도 창 열기 확인용)
    const { JournalRepository } = await import("../data/repository");
    const { CabiRepository } = await import("../data/cabiRepository");
    const [cat] = await driver.select<{ id: string }>("SELECT id FROM category ORDER BY sort_order LIMIT 1");
    if (cat) {
      const cabi = new CabiRepository(
        driver,
        new JournalRepository(driver, () => new Date()),
        () => new Date(),
      );
      await cabi.createNote(cat.id, "가상 업무노트");
      await cabi.board(cat.id, true);
    }
    // 원본 판이 쓰는 journal_mode=DELETE 그대로(브라우저 sql.js 기본)
    const bytes = driver.exportBytes();
    const id = crypto.randomUUID();
    snapshots.set(id, bytes);
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    return { snapshotId: id, bytes: bytes.length, sha256: digest };
  },
  async read(id) {
    const b = snapshots.get(id);
    if (!b) throw new Error("SNAPSHOT_MISSING");
    return b;
  },
  async remove(id) {
    snapshots.delete(id);
  },
};
