// 링크 열기(improve-1026-spec 9-2) — http/https만, OS 기본 브라우저로. 앱은 주소에 접속하지 않는다(CLAUDE.md 4-1).
import { isOpenableUrl } from "../../domain/links";
import { STR } from "../../shared/strings";
import { reportError, toast } from "../board/boardStore";
import { useAppStore } from "./appStore";

export async function openLink(url: string) {
  if (!isOpenableUrl(url)) return toast(STR.links.notOpenable);
  try {
    await useAppStore.getState().platform?.openUrl(url);
  } catch (e) {
    reportError(e);
  }
}
