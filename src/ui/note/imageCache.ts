// 메모 판 그림 캐시(optimize-1031-plan O2): 지금 주의 표시용 사본(썸네일)만 ImageBitmap으로 들고, 주를 옮기면 모두 close()로 해제.
// 썸네일이 없는 예전 이미지는 처음 읽을 때 만들어 저장한다.
import type { JournalRepository } from "../../data/repository";
import { decodeImage, makeThumb } from "./imageProcess";

const cache = new Map<string, ImageBitmap>();
const pending = new Map<string, Promise<ImageBitmap | null>>();
let generation = 0;

/** 주를 옮길 때: 들고 있던 그림을 모두 해제 */
export function clearImageCache() {
  generation++;
  for (const b of cache.values()) b.close();
  cache.clear();
  pending.clear();
}

/** 이미 읽어 둔 그림(없으면 undefined) */
export const peekBitmap = (id: string) => cache.get(id);

/** 캐시에 든 그림 수(측정·테스트용) */
export const cachedImageCount = () => cache.size;

export function loadDisplayBitmap(repo: JournalRepository, id: string): Promise<ImageBitmap | null> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  const wait = pending.get(id);
  if (wait) return wait;
  const gen = generation;
  const job = (async () => {
    const view = await repo.getNoteAssetView(id);
    if (!view) return null;
    let bmp = await decodeImage(view.mime, view.data);
    if (!view.thumb) {
      // 예전 이미지: 썸네일을 만들어 저장하고(다음부터는 작은 것만 읽음) 작은 것으로 바꿔 든다
      const t = await makeThumb(bmp);
      if (t) {
        void repo.setNoteAssetThumb(id, t).catch(() => undefined);
        const small = await decodeImage(t.mime, t.data);
        bmp.close();
        bmp = small;
      }
    }
    if (gen !== generation) {
      bmp.close();
      return null;
    }
    cache.set(id, bmp);
    return bmp;
  })().finally(() => {
    if (pending.get(id) === job) pending.delete(id);
  });
  pending.set(id, job);
  return job;
}
