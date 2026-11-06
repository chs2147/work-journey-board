import { finishNote } from "../note/noteStore";
import { useEffect, useState } from "react";
import { loadPlatform } from "../../platform";
import { useAppStore } from "../common/appStore";
import { Toasts } from "../common/Toasts";
import { applyTheme } from "../../shared/theme";
import { CABI } from "../../shared/cabiStrings";
import { cabiContext, flushCabiDocument, listenCabi, useCabiChange } from "./cabiService";
import { TaskNoteWindow } from "./TaskNoteWindow";
import { TaskBoardWindow } from "./TaskBoardWindow";
import styles from "./Cabi.module.css";
export function CabiWindowApp() {
  const locked = useCabiChange((s) => s.locked);
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const q = new URLSearchParams(location.search),
    kind = q.get("kind"),
    id = q.get("id") ?? "";
  useEffect(() => {
    let active = true;
    const cleanups: (() => void)[] = [];
    void (async () => {
      const p = await loadPlatform();
      useAppStore.setState({ platform: p });
      const c = await cabiContext();
      applyTheme(c.theme);
      await p.setWindowTheme(c.theme);
      useAppStore.setState({ theme: c.theme });
      cleanups.push(await listenCabi());
      cleanups.push(
        await p.cabi.onClose(async () => {
          await flushCabiDocument();
          if (kind === "board") await finishNote();
        }),
      );
      if (active) setReady(true);
      else cleanups.forEach((f) => f());
    })().catch((e) => {
      if (active) setError(String(e));
    });
    return () => {
      active = false;
      cleanups.forEach((f) => f());
    };
  }, [kind]);
  if (error)
    return (
      <div className={styles.window}>
        <p className={`${styles.message} ${styles.error}`} role="alert">
          {error}
        </p>
      </div>
    );
  if (!ready) return <p className={styles.message}>{CABI.loading}</p>;
  return (
    <div
      onKeyDownCapture={(e) => {
        if (locked) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onPointerDownCapture={(e) => {
        if (locked) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {kind === "note" ? <TaskNoteWindow noteId={id} /> : <TaskBoardWindow categoryId={id} />}
      <Toasts />
    </div>
  );
}
