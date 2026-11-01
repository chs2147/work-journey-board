// 성능 측정용 가상 1년치 일지(optimize-1031-plan O1) — 브라우저 모드 `?sample=year`(글만)·`?sample=year-img`(주마다 이미지 2장).
// 실제 업무 기록이 아니다(CLAUDE.md 4-2). 큰 fixture 파일 대신 실행할 때 같은 씨앗으로 똑같이 만든다(이미지는 canvas로 그림).
import type { SampleData } from "../data/seed";
import { weekIdOf } from "../domain/week";

const WORDS = [
  "요구사항 정리",
  "설계 검토",
  "회의 참석",
  "일정 확인",
  "자료 작성",
  "테스트 진행",
  "보고서 초안",
  "피드백 반영",
  "배포 준비",
  "점검 결과 공유",
];

/** 같은 씨앗이면 같은 수열(mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** 화면 캡처 비슷한 PNG(가로 800 × 세로 500) — base64 */
async function fakeShot(seed: number): Promise<{ data: string; bytes: number }> {
  const r = rng(seed);
  const c = document.createElement("canvas");
  c.width = 800;
  c.height = 500;
  const g = c.getContext("2d")!;
  g.fillStyle = `hsl(${Math.floor(r() * 360)} 30% 92%)`;
  g.fillRect(0, 0, 800, 500);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `hsl(${Math.floor(r() * 360)} ${30 + r() * 40}% ${40 + r() * 40}%)`;
    g.fillRect(r() * 760, r() * 470, 20 + r() * 220, 8 + r() * 40);
  }
  // 잡음 — 압축이 너무 잘 되지 않게(실제 캡처 크기와 비슷하게)
  const img = g.getImageData(0, 0, 800, 500);
  for (let i = 0; i < img.data.length; i += 4) if (r() < 0.08) img.data[i] = Math.floor(r() * 255);
  g.putImageData(img, 0, 0);
  const data = c.toDataURL("image/png").replace(/^data:[^,]*,/, "");
  return { data, bytes: Math.floor((data.length * 3) / 4) };
}

export async function makeYearSample(withImages: boolean, endDate = "2026-10-30"): Promise<SampleData> {
  const r = rng(7);
  const categories = Array.from({ length: 6 }, (_, i) => ({
    id: `cat-${i + 1}`,
    name: `가상 업무 ${i + 1}`,
    color: `c${i + 1}`,
    sortOrder: i + 1,
    startDate: "2025-11-03",
  }));
  const items: SampleData["items"] = [];
  const weekNotes: NonNullable<SampleData["weekNotes"]> = [];
  const assets: NonNullable<SampleData["assets"]> = [];
  const end = new Date(`${endDate}T00:00:00`);
  for (let d = new Date("2025-11-03T00:00:00"); d <= end; d.setDate(d.getDate() + 1)) {
    const day = iso(d);
    const wd = d.getDay();
    if (wd >= 1 && wd <= 5) {
      const picked = [...categories].sort(() => r() - 0.5).slice(0, 4);
      for (const c of picked) {
        let seq = 1;
        const n = 2 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
          items.push({
            date: day,
            categoryId: c.id,
            seq: seq++,
            depth: 0,
            text: `${WORDS[Math.floor(r() * WORDS.length)]} ${k + 1} — 가상 기록 https://example.com/${Math.floor(r() * 999)}`,
            flagged: r() < 0.02,
          });
          if (r() < 0.4)
            items.push({ date: day, categoryId: c.id, seq: seq++, depth: 1, text: "세부 사항 가상 메모" });
        }
      }
    }
    if (wd === 1) {
      const weekId = weekIdOf(day);
      const boxes: unknown[] = [0, 1, 2].map((j) => ({
        id: `t-${weekId}-${j}`,
        kind: "text",
        x: 24 + j * 340,
        y: 24,
        w: 320,
        z: j + 1,
        bg: null,
        content: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: `가상 주간 메모 ${j} `.repeat(8) }] },
          ],
        },
      }));
      if (withImages) {
        for (let j = 0; j < 2; j++) {
          const id = `a-${weekId}-${j}`;
          const shot = await fakeShot(assets.length + 1);
          assets.push({ id, weekId, mime: "image/png", ...shot, width: 800, height: 500 });
          boxes.push({
            id: `i-${id}`,
            kind: "image",
            x: 24 + j * 420,
            y: 200,
            w: 400,
            z: 10 + j,
            asset: id,
            caption: "",
          });
        }
      }
      weekNotes.push({ weekId, doc: { v: 1, boxes } });
    }
  }
  return { categories, items, memos: [], weekNotes, assets };
}
