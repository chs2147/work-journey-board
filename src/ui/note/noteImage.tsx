// 메모 이미지 그리기(optimize-1031-plan O2). 예전에는 base64 원본을 data: 주소 <img>로 그려, 1년치 일지에서 주를 오갈수록
// 화면 프로세스 메모리가 쌓였다(측정: 왕복마다 35~50MB). 이제는
//   ① 지금 주의 표시용 사본(썸네일, 긴 변 800px)만 ImageBitmap으로 캐시하고, 주를 옮기면 모두 close()로 해제
//   ② <canvas>에 보이는 크기 × 화면 배율로만 그린다(원본 크기 캔버스를 만들지 않음)
//   ③ 그림 데이터(base64)는 스토어에 들고 있지 않는다 — 그릴 때 한 장씩 읽고 버린다
// 썸네일이 없는 예전 이미지는 처음 그릴 때 만들어 저장한다. CSP는 그대로(blob: 주소를 쓰지 않음).
import { useEffect, useRef, useState, type CanvasHTMLAttributes } from "react";
import type { JournalRepository } from "../../data/repository";
import { decodeImage } from "./imageProcess";
import { loadDisplayBitmap, peekBitmap } from "./imageCache";

/** 캔버스에 그림을 크기에 맞춰 그린다. cover = 가운데를 잘라 칸을 채움(링크 카드 썸네일) */
function paint(canvas: HTMLCanvasElement, bmp: ImageBitmap, w: number, h: number, cover = false) {
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, w, h);
  if (!cover) return ctx.drawImage(bmp, 0, 0, w, h);
  const k = Math.max(w / bmp.width, h / bmp.height);
  const sw = w / k;
  const sh = h / k;
  ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, w, h);
}

type CanvasProps = Omit<CanvasHTMLAttributes<HTMLCanvasElement>, "width" | "height">;

/**
 * 메모 판 이미지 1장. width·height = 원본 크기(비율용), shownWidth = 화면에 보이는 CSS 폭.
 * 그림 데이터가 오기 전에도 비율대로 자리를 차지한다.
 */
export function NoteImageCanvas({
  repo,
  assetId,
  width,
  height,
  shownWidth,
  label,
  cover = false,
  ...rest
}: CanvasProps & {
  repo: JournalRepository | null;
  assetId: string;
  width: number;
  height: number;
  shownWidth: number;
  label: string;
  /** 정사각 칸을 가운데 잘라 채움(링크 카드 썸네일) */
  cover?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<{ id: string; bmp: ImageBitmap } | null>(null);
  const bmp = (loaded?.id === assetId ? loaded.bmp : peekBitmap(assetId)) ?? null;
  useEffect(() => {
    let alive = true;
    if (!repo || peekBitmap(assetId)) return;
    void loadDisplayBitmap(repo, assetId)
      .then((b) => alive && b && setLoaded({ id: assetId, bmp: b }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [repo, assetId]);
  // 그릴 크기: 보이는 폭 × 화면 배율(최대 2배), 썸네일보다 크게는 키우지 않음
  const scale = Math.min(globalThis.devicePixelRatio || 1, 2);
  const drawW = bmp ? Math.max(1, Math.min(bmp.width, Math.round(shownWidth * scale))) : 0;
  const drawH = bmp ? (cover ? drawW : Math.max(1, Math.round((drawW * height) / Math.max(width, 1)))) : 0;
  useEffect(() => {
    const c = ref.current;
    // 캐시가 비워져(주 이동) 해제된 그림이면 그리지 않는다 — 다음 렌더에서 다시 읽는다
    if (!c || !bmp || peekBitmap(assetId) !== bmp) return;
    paint(c, bmp, drawW, drawH, cover);
  }, [bmp, drawW, drawH, assetId, cover]);
  useEffect(
    () => () => {
      // 상자가 사라지면 캔버스 메모리를 바로 돌려준다(그림은 캐시가 주 단위로 해제)
      const c = ref.current;
      if (c) {
        c.width = 0;
        c.height = 0;
      }
    },
    [],
  );
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      data-width={width}
      data-height={height}
      data-ready={bmp ? "true" : "false"}
      style={cover ? undefined : { aspectRatio: `${width} / ${height}` }}
      {...rest}
    />
  );
}

/** [크게 보기]: 원본 1장을 원본 크기로 — 닫으면 바로 해제(캐시하지 않음) */
export function FullImageCanvas({
  repo,
  assetId,
  width,
  height,
  label,
}: {
  repo: JournalRepository | null;
  assetId: string;
  width: number;
  height: number;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    const c = ref.current;
    if (!repo || !c) return;
    void (async () => {
      const full = await repo.getNoteAsset(assetId);
      if (!full || !alive) return;
      const bmp = await decodeImage(full.mime, full.data);
      if (alive) paint(c, bmp, bmp.width, bmp.height);
      bmp.close();
    })().catch(() => undefined);
    return () => {
      alive = false;
      c.width = 0;
      c.height = 0;
    };
  }, [repo, assetId]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      width={width}
      height={height}
      data-testid="note-image-full"
    />
  );
}
