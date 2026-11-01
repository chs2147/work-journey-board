// 메모 이미지 줄이기·바꾸기(weekly-note-spec 4-4): 화면의 canvas로 긴 변 1600px 안으로 줄이고 WebP(품질 0.82)로 저장.
// 라이브러리·네트워크 없음. 메모 판 표시는 <canvas>에 직접 그린다(optimize-1031-plan O2 — data: 주소 <img>는 주를 오갈수록
// 메모리가 쌓였다). 실앱 CSP `img-src 'self' data:`는 그대로(blob: 주소 안 씀).
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
  /** 메모 판 표시용 작은 사본(원본이 THUMB_EDGE보다 클 때만) */
  thumb?: EncodedImage | null;
}

export interface EncodedImage {
  mime: "image/webp" | "image/png";
  data: string;
}

/** 표시용 사본의 긴 변(px) — 메모 판 상자 폭(최대 약 800px)에 맞춤 */
export const THUMB_EDGE = 800;

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
    return {
      mime: blob.type as ImageMime,
      data: await blobToBase64(blob),
      ...size,
      bytes: blob.size,
      thumb: file.type === "image/gif" ? null : await makeThumb(bitmap),
    };
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

export const base64Bytes = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

/** 표시용 작은 사본 — 긴 변이 THUMB_EDGE 이하면 만들지 않는다(원본을 그대로 그림) */
export async function makeThumb(source: ImageBitmap): Promise<EncodedImage | null> {
  const long = Math.max(source.width, source.height);
  if (long <= THUMB_EDGE) return null;
  const k = THUMB_EDGE / long;
  const blob = await encode(drawn(source, Math.round(source.width * k), Math.round(source.height * k)));
  return { mime: blob.type === "image/webp" ? "image/webp" : "image/png", data: await blobToBase64(blob) };
}

/** base64 그림 → ImageBitmap(그린 뒤 close()로 바로 해제할 수 있다) */
export function decodeImage(mime: string, data: string): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([base64Bytes(data)], { type: mime }));
}
