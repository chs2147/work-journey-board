// 주 전환 메모리·속도 측정(optimize-1031-plan O1·2절). 가상 1년치 일지에서 `Alt+←` W번 → `Alt+→` W번 = 1왕복.
// 왕복마다 가비지 컬렉션 후 JS 메모리(CDP)·화면 프로세스 메모리(리눅스 RSS)를 재고, 주 전환 시간·DB 호출 수를 낸다.
// 수락 기준(이미지 판): 첫 왕복 뒤로 화면 프로세스 증가 ≤ PERF_GROWTH_MB(기본 30MB) — 계속 늘면 실패.
// 환경 변수: PERF_ROUNDS(기본 4) · PERF_WEEKS(왕복당 이동 주 수, 기본 40) · PERF_GROWTH_MB
import { execSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 4);
const WEEKS = Number(process.env.PERF_WEEKS ?? 40);
const GROWTH_MB = Number(process.env.PERF_GROWTH_MB ?? 30);

/** 브라우저 프로세스 RSS 합계 MB — 화면(renderer)과 전체(브라우저·GPU 포함). 리눅스만, 아니면 null */
function processMb(): { rendererMb: number | null; totalMb: number | null } {
  if (process.platform !== "linux") return { rendererMb: null, totalMb: null };
  try {
    const out = execSync("ps -eo rss=,comm=,args=", { encoding: "utf8", maxBuffer: 1 << 24 });
    let renderer = 0;
    let total = 0;
    for (const line of out.split("\n")) {
      const [rss, comm] = line.trim().split(/\s+/);
      if (!/^(chrom|headless_shell)/i.test(comm ?? "")) continue;
      const kb = Number(rss) || 0;
      total += kb;
      if (/--type=renderer/.test(line)) renderer += kb;
    }
    return { rendererMb: Math.round(renderer / 1024), totalMb: Math.round(total / 1024) };
  } catch {
    return { rendererMb: null, totalMb: null };
  }
}

async function measure(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  await page.waitForTimeout(400);
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  await cdp.detach();
  return { heapMb: Math.round((usedSize / 1048576) * 10) / 10, ...processMb() };
}

async function step(page: Page, key: string) {
  const title = page.getByTestId("week-title");
  const before = await title.textContent();
  const q0 = await page.evaluate(() =>
    (globalThis as unknown as { __wjb: { queries(): number } }).__wjb.queries(),
  );
  const t0 = Date.now();
  await page.keyboard.press(key);
  await expect(title).not.toHaveText(before ?? "", { timeout: 15_000 });
  // 메모 판(이미지 포함)까지 다 불러온 뒤 — 저장 표시가 쉬는 상태
  await expect(page.locator('[data-testid="save-state"][data-idle="true"]')).toBeVisible({ timeout: 15_000 });
  const ms = Date.now() - t0;
  const q1 = await page.evaluate(() =>
    (globalThis as unknown as { __wjb: { queries(): number } }).__wjb.queries(),
  );
  return { ms, queries: q1 - q0 };
}

for (const sample of ["year", "year-img"] as const) {
  test(`주 전환 메모리 — ${sample}`, async ({ page }) => {
    await page.goto(`/?today=2026-10-29&sample=${sample}`);
    await expect(page.getByTestId("category-header").first()).toBeVisible({ timeout: 120_000 });
    await page.waitForTimeout(1500);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    const rows: { label: string; heapMb: number; rendererMb: number | null; totalMb: number | null }[] = [];
    rows.push({ label: "start", ...(await measure(page)) });
    const times: number[] = [];
    const queries: number[] = [];
    for (let r = 1; r <= ROUNDS; r++) {
      for (const key of ["Alt+ArrowLeft", "Alt+ArrowRight"])
        for (let i = 0; i < WEEKS; i++) {
          const s = await step(page, key);
          times.push(s.ms);
          queries.push(s.queries);
        }
      rows.push({ label: `round ${r}`, ...(await measure(page)) });
    }
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
    const summary = {
      sample,
      rounds: rows,
      switchMsMedian: median(times),
      queriesPerSwitchMedian: median(queries),
    };
    console.log(JSON.stringify(summary));
    await test.info().attach(`perf-${sample}.json`, {
      body: JSON.stringify(summary, null, 2),
      contentType: "application/json",
    });

    // 첫 왕복(캐시·지연 로딩이 차는 구간) 뒤로는 거의 늘지 않아야 한다
    const r1 = rows[1]!;
    const last = rows.at(-1)!;
    expect(last.heapMb - r1.heapMb, "JS 메모리 증가(MB)").toBeLessThanOrEqual(GROWTH_MB);
    if (r1.rendererMb !== null && last.rendererMb !== null)
      expect(last.rendererMb - r1.rendererMb, "화면 프로세스 증가(MB)").toBeLessThanOrEqual(GROWTH_MB);
    if (r1.totalMb !== null && last.totalMb !== null)
      expect(last.totalMb - r1.totalMb, "브라우저 전체 증가(MB)").toBeLessThanOrEqual(GROWTH_MB * 2);
    // 이미지가 실제로 그려졌는지(캔버스 준비)
    if (sample === "year-img")
      await expect(
        page.locator('[data-testid="note-image"] canvas[data-ready="true"]').first(),
      ).toBeVisible();
  });
}
