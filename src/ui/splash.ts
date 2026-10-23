// 시작 스플래시(docs/splash-spec.md) — 메인 창 쪽. 실앱은 작은 스플래시 창을 먼저 띄우고 메인 창은 숨긴 채 준비한다.
// 준비가 빨라도 스플래시를 볼 수 있게 최소 시간을 채운 뒤, 보드 글꼴까지 받아 두고 메인 창으로 넘어간다.
import type { Platform } from "../platform";
import { STR } from "../shared/strings";

/** 스플래시 최소 표시 시간(앱 시작 기준). 준비가 이보다 오래 걸리면 준비되는 즉시 넘어간다. */
export const SPLASH_MIN_MS = 2500;
/** 글꼴 로딩이 실패·지연돼도 이 이상 붙잡지 않는다. */
const FONT_WAIT_MS = 1500;

let finishing: Promise<void> | null = null;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/** 시작 화면(보드·첫 실행·오류 등)이 정해지면 부른다. 여러 번 불러도 한 번만 동작한다. 스플래시가 없는 환경(브라우저 모드)은 바로 끝. */
export function finishSplash(platform: Platform | null): Promise<void> {
  finishing ??= (async () => {
    const splash = platform?.splash;
    if (!splash) return;
    splash.status(STR.splash.ready);
    await Promise.all([wait(SPLASH_MIN_MS - performance.now()), fontsReady()]);
    await splash.finish();
  })();
  return finishing;
}

/** 보드 글꼴을 미리 받아 둔다 — 메인 창이 보일 때 글꼴 교체·입력칸 재측정이 보이지 않게. */
function fontsReady(): Promise<void> {
  const fonts = document.fonts as FontFaceSet | undefined;
  if (!fonts?.load) return Promise.resolve();
  return Promise.race([
    fonts.load('14px "Pretendard Variable"').then(
      () => undefined,
      () => undefined,
    ),
    wait(FONT_WAIT_MS),
  ]);
}
