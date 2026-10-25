// 메모 이미지 줄이기·바꾸기(weekly-note-spec 4-4): 화면의 canvas로 긴 변 1600px 안으로 줄이고 WebP(품질 0.82)로 저장.
// 라이브러리·네트워크 없음. 표시는 data: 주소만 쓴다(실앱 CSP `img-src 'self' data:` — blob: 주소는 막힘).
import { fitWithin, IMAGE_MAX_SOURCE_BYTES, type ImageMime } from "../../domain/note";
import { STR } from "../../shared/strings";

export const WEBP_QUALITY = 0.82;
/** 넣을 수 있는 원본 형식(BMP는 WebP로 바꿔 저장) */
export const ACCEPT_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"];

export class ImageInputError extends Error {}

export interface PreparedImage {
  mime: ImageMime;
  /** base64(머리말 없이) */
  data: string;
  width: number;
  height: number;
  bytes: number;
}

export const dataUrl = (mime: string, data: string) => `data:${mime};base64,${data}`;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function drawn(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageInputError(STR.note.imageBroken);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

/** WebP로 — 이 브라우저가 WebP로 못 쓰면(일부 WebKit) PNG로 */
async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await toBlob(canvas, "image/webp", WEBP_QUALITY);
  if (webp && webp.type === "image/webp") return webp;
  const png = await toBlob(canvas, "image/png");
  if (!png) throw new ImageInputError(STR.note.imageBroken);
  return png;
}

/** 붙여넣기·파일·끌어다 놓기로 받은 그림을 저장할 모양으로 */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  if (!ACCEPT_TYPES.includes(file.type)) throw new ImageInputError(STR.note.imageType);
  if (file.size > IMAGE_MAX_SOURCE_BYTES) throw new ImageInputError(STR.note.imageTooBig);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageInputError(STR.note.imageBroken);
  }
  try {
    const size = fitWithin(bitmap.width, bitmap.height);
    const resized = size.width !== bitmap.width;
    // 줄일 필요가 없는 GIF는 그대로(움직이는 그림 유지)
    if (!resized && file.type === "image/gif")
      return { mime: "image/gif", data: await blobToBase64(file), ...size, bytes: file.size };
    const out = await encode(drawn(bitmap, size.width, size.height));
    // 줄이지 않았고 원본이 더 작으면 원본 그대로(PNG·JPEG·WebP)
    const keep = !resized && file.type !== "image/bmp" && file.size <= out.size;
    const blob = keep ? file : out;
    return { mime: blob.type as ImageMime, data: await blobToBase64(blob), ...size, bytes: blob.size };
  } finally {
    bitmap.close();
  }
}

/** [이미지로 저장…]: 고른 확장자(.png/.webp)로 바꾼 바이트 */
export async function exportImageBytes(mime: string, data: string, as: "png" | "webp"): Promise<Uint8Array> {
  const want = `image/${as}`;
  if (mime === want) return base64Bytes(data);
  const bitmap = await createImageBitmap(new Blob([base64Bytes(data)], { type: mime }));
  try {
    const canvas = drawn(bitmap, bitmap.width, bitmap.height);
    const blob = await toBlob(canvas, want, as === "webp" ? WEBP_QUALITY : undefined);
    if (!blob || blob.type !== want) throw new ImageInputError(STR.note.imageSaveType);
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

const base64Bytes = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
