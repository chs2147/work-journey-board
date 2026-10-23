// 스플래시 창 진입점(docs/splash-spec.md). 메인 창이 숨은 채 준비하는 동안 시작 단계를 받아 보여 준다.
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SPLASH_STATUS_EVENT } from "../platform/splashEvents";
import { markToday, setStatus, todayFrom } from "./view";

markToday(todayFrom(location.search));
if (isTauri()) void listen<string>(SPLASH_STATUS_EVENT, (e) => setStatus(e.payload));
