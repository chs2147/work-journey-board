import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { getAllWebviewWindows, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CabiBridge, CabiMessage } from "./cabiBridge";

export function tauriCabiBridge(): CabiBridge {
  const current = getCurrentWindow(),
    labels = new Set<string>();
  return {
    label: () => current.label,
    async open(s) {
      const label = `cabi-${s.kind}-${s.id}`;
      const old = await WebviewWindow.getByLabel(label);
      if (old) {
        await old.unminimize();
        await old.setFocus();
        return;
      }
      const query = new URLSearchParams({ win: "cabi", kind: s.kind, id: s.id, t: s.theme });
      const w = new WebviewWindow(label, {
        url: `index.html?${query}`,
        title: `${s.title} — Cabi.NET`,
        width: 1180,
        height: 820,
        minWidth: 640,
        minHeight: 480,
        dragDropEnabled: false,
        focus: true,
      });
      labels.add(label);
      await new Promise<void>((resolve, reject) => {
        void w.once("tauri://created", () => resolve());
        void w.once("tauri://error", (e) => reject(new Error(String(e.payload))));
      });
    },
    async opened() {
      return (await getAllWebviewWindows()).map((w) => w.label).filter((n) => n.startsWith("cabi-"));
    },
    async closeAll() {
      for (const label of labels) {
        const w = await WebviewWindow.getByLabel(label);
        await w?.destroy();
      }
      labels.clear();
    },
    async call(name, args) {
      const id = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        let off: (() => void) | undefined;
        const timer = setTimeout(() => {
          off?.();
          reject(new Error("메인 창이 응답하지 않습니다. 저장 내용을 내보내고 다시 열어 주세요."));
        }, 20_000);
        void listen<{ id: string; value?: unknown; error?: string }>("cabi-result", (e) => {
          if (e.payload.id !== id) return;
          clearTimeout(timer);
          off?.();
          if (e.payload.error) reject(new Error(e.payload.error));
          else resolve(e.payload.value);
        })
          .then((unlisten) => {
            off = unlisten;
            return emitTo("main", "cabi-rpc", { id, name, args, sender: current.label });
          })
          .catch((e) => {
            clearTimeout(timer);
            off?.();
            reject(e);
          });
      });
    },
    async serve(handler) {
      await listen<{ id: string; name: string; args: unknown[]; sender: string }>("cabi-rpc", async (e) => {
        const m = e.payload;
        if (
          !m ||
          typeof m.id !== "string" ||
          typeof m.sender !== "string" ||
          !Array.isArray(m.args) ||
          !/^(cabinet|cabi-(note|board)-[\w-]+)$/.test(m.sender)
        )
          return;
        try {
          const value = await handler(m.name, m.args, m.sender);
          await emitTo(m.sender, "cabi-result", { id: m.id, value: value ?? null });
        } catch (error) {
          await emitTo(m.sender, "cabi-result", {
            id: m.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    },
    async publish(message, target) {
      if (target) await emitTo(target, "cabi-message", message);
      else await emit("cabi-message", message);
    },
    async listen(handler) {
      return listen<CabiMessage>("cabi-message", (e) => handler(e.payload));
    },
    async onClose(handler) {
      return current.onCloseRequested(async (e) => {
        e.preventDefault();
        try {
          await handler();
          await current.destroy();
        } catch {
          /* Editor displays the save failure and retains its draft. */
        }
      });
    },
    async closeSelf() {
      await current.close();
    },
  };
}
