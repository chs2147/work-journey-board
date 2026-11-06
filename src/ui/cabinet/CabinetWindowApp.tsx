import { listenCabi } from "./cabiService";
// 실앱 Cabinet 별도 창(improve-1102-spec C1): 창 `cabinet`이 index.html?win=cabinet&t=<테마>&f=<처음 고를 업무·항목>으로 띄우는 화면.
// 일지는 열지 않는다 — 메인 창이 보내는 자료(cabinet-sync)로 그리고, 등록·고치기는 메인 창에 부탁한다(cabinetStore remote).
import { useEffect, useState } from "react";
import { loadPlatform, type CabinetFocus } from "../../platform";
import { STR } from "../../shared/strings";
import { useAppStore } from "../common/appStore";
import { Toasts } from "../common/Toasts";
import { CabinetPanel } from "./CabinetPanel";
import { applyFocus, applySnapshot, closeCabinet, loadCabinet, setCabinetRemote } from "./cabinetStore";

function initialFocus(): CabinetFocus {
  try {
    const v = JSON.parse(new URLSearchParams(location.search).get("f") ?? "{}") as CabinetFocus;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function CabinetWindowApp() {
  useEffect(() => {
    let active = true,
      off: (() => void) | undefined;
    void listenCabi().then((f) => {
      if (active) off = f;
      else f();
    });
    return () => {
      active = false;
      off?.();
    };
  }, []);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const theme = new URLSearchParams(location.search).get("t");
    if (theme) document.documentElement.dataset.theme = theme;
    document.title = `${STR.cabinet.title} — ${STR.cabinet.subtitle}`;
    void (async () => {
      const p = await loadPlatform();
      const bridge = p.cabinetWindow;
      if (!bridge) return setError("Cabinet 창은 실앱에서만 엽니다");
      useAppStore.setState({ platform: p });
      setCabinetRemote(bridge);
      void bridge.installDropBridge().catch(() => undefined);
      await bridge.onSync(applySnapshot);
      await bridge.onFocus(applyFocus);
      try {
        await loadCabinet();
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e));
      }
      applyFocus(initialFocus());
      setReady(true);
    })();
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === "Digit4") {
        e.preventDefault();
        closeCabinet();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (error) return <p style={{ padding: 24 }}>{error}</p>;
  if (!ready) return null;
  return (
    <>
      <CabinetPanel standalone />
      <Toasts />
    </>
  );
}
