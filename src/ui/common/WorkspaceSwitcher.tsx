// 워크스페이스 전환(multi-board-spec 3절 A안): 레일 맨 위 공간 단추 → 목록 팝업(공간·단축키·새로 만들기·관리).
import { useEffect, useLayoutEffect, useRef } from "react";
import { MAX_SHORTCUT, sameDir } from "../../domain/workspace";
import { osText } from "../../shared/platformText";
import { STR } from "../../shared/strings";
import { openSettingsAt, switchWorkspace } from "./appController";
import { useAppStore } from "./appStore";
import { WorkspaceMark } from "./workspaceIcons";
import styles from "./WorkspaceSwitcher.module.css";

const setApp = useAppStore.setState;

/** 레일 맨 위 단추 — 지금 공간의 모노그램 */
export function WorkspaceRailButton() {
  const open = useAppStore((s) => s.switcherOpen);
  const list = useAppStore((s) => s.workspaces);
  const dir = useAppStore((s) => (s.journal.state === "ready" ? s.journal.dataDir : null));
  const cur = list.find((e) => dir && sameDir(e.dir, dir));
  if (!cur) return null;
  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={`${styles.railBtn} ${open ? styles.railOn : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={STR.workspace.rail(cur.name)}
        title={osText(STR.workspace.rail(cur.name))}
        data-testid="workspace-button"
        onClick={() => setApp({ switcherOpen: !open })}
      >
        <WorkspaceMark icon={cur.icon} color={cur.color} size={30} />
      </button>
      {open && <WorkspaceMenu />}
    </div>
  );
}

function WorkspaceMenu() {
  const list = useAppStore((s) => s.workspaces);
  const dir = useAppStore((s) => (s.journal.state === "ready" ? s.journal.dataDir : null));
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setApp({ switcherOpen: false });

  useLayoutEffect(() => {
    const el = ref.current;
    const cur =
      el?.querySelector<HTMLElement>("[data-current]") ?? el?.querySelector<HTMLElement>("[role=menuitem]");
    cur?.focus();
  }, []);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest("[data-testid=workspace-button]")) close();
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = items.length;
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + n) % n]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      document.querySelector<HTMLElement>("[data-testid=workspace-button]")?.focus();
    } else if (/^[1-9]$/.test(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const w = list[Number(e.key) - 1];
      if (w) {
        e.preventDefault();
        void switchWorkspace(w.dir);
      }
    }
  };

  return (
    <div
      ref={ref}
      className={styles.menu}
      role="menu"
      aria-label={STR.workspace.menuLabel}
      data-testid="workspace-menu"
      onKeyDown={onKey}
    >
      {list.map((w, i) => {
        const current = !!dir && sameDir(w.dir, dir);
        return (
          <button
            key={w.dir}
            type="button"
            role="menuitem"
            className={`${styles.item} ${current ? styles.current : ""}`}
            data-current={current || undefined}
            data-testid="workspace-item"
            aria-current={current || undefined}
            onClick={() => (current ? close() : void switchWorkspace(w.dir))}
          >
            <WorkspaceMark icon={w.icon} color={w.color} size={26} />
            <span className={styles.text}>
              <span className={styles.name}>
                {w.name}
                {current && <span className={styles.check}> ✓</span>}
              </span>
              <span className={styles.path} title={w.dir}>
                {w.dir}
              </span>
            </span>
            {i < MAX_SHORTCUT && <kbd className={styles.kbd}>{osText(STR.workspace.shortcut(i + 1))}</kbd>}
          </button>
        );
      })}
      <div className={styles.sep} />
      <button
        type="button"
        role="menuitem"
        className={`${styles.item} ${styles.action}`}
        data-testid="workspace-new"
        onClick={() => setApp({ switcherOpen: false, creatingWorkspace: true })}
      >
        {STR.workspace.create}
      </button>
      <button
        type="button"
        role="menuitem"
        className={styles.item}
        data-testid="workspace-manage"
        onClick={() => {
          close();
          void openSettingsAt("workspace");
        }}
      >
        {STR.workspace.manage}
      </button>
    </div>
  );
}
