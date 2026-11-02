// Cabinet 폴더 창 내용(features-1102-spec F5, 시안 f5): 경로 이동(←·↑·하위 폴더 두 번 누르기·경로 띠), 목록(이름·수정한 날짜·크기·종류 아이콘, 정렬),
// [탐색기에서 열기] [경로 복사], 파일 두 번 누르기 = OS 기본 앱. 읽기·열기만 — 지우기·이름 바꾸기·옮기기 없음.
// 실앱은 별도 OS 창(FolderWindowApp), 브라우저 모드는 앱 안 떠 있는 창(FolderPanels)이 이 화면을 쓴다.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  fileKind,
  formatModified,
  formatSize,
  joinPath,
  parentWithin,
  relSegments,
  sortEntries,
  type EntrySortKey,
  type FsEntry,
} from "../../domain/cabinet";
import type { Platform } from "../../platform";
import { STR } from "../../shared/strings";
import { FileKindIcon, FolderIcon } from "./CabinetIcons";
import styles from "./Cabinet.module.css";

/** 열려 있는 폴더 창 자동 새로 고침 간격(improve-1102v7 K5) */
const REFRESH_MS = 3000;

/** 실행 파일 — 열기 전에 묻는다(탐색기처럼 바로 실행하지 않게) */
const RUNNABLE = /\.(exe|bat|cmd|com|msi|ps1|vbs|vbe|js|jse|wsf|scr|lnk|reg|hta)$/i;

export interface FolderViewProps {
  platform: Platform;
  root: string;
  sub: string;
  title: string;
  links: string[];
  onNav(sub: string): void;
  /** 알림(복사됨·오류) */
  notify(msg: string): void;
}

export function FolderView({ platform, root, sub, title, links, onNav, notify }: FolderViewProps) {
  const [path, setPath] = useState(sub || root);
  const [history, setHistory] = useState<string[]>([]);
  const [entries, setEntries] = useState<FsEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: EntrySortKey; asc: boolean }>({ key: "name", asc: true });
  const [showHidden, setShowHidden] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableSectionElement>(null);

  // 새로 고침(improve-1102v7 K5): [새로 고침]·F5, 그리고 열려 있는 동안 3초마다·창으로 돌아올 때 자동.
  // 바뀐 게 있을 때만 다시 그린다(고른 줄 유지)
  const [tick, setTick] = useState(0);
  const sigRef = useRef("");
  useEffect(() => {
    let alive = true;
    platform.cabinetList(path).then(
      (list) => {
        if (!alive) return;
        const sig = JSON.stringify(list.map((e) => [e.name, e.dir, e.size, e.modified, e.hidden]).sort());
        if (sig === sigRef.current) return;
        sigRef.current = sig;
        setError(null);
        setEntries(list);
      },
      (e: unknown) => {
        if (!alive) return;
        const msg = String(e instanceof Error ? e.message : e);
        sigRef.current = `!${msg}`;
        setError(msg);
        setEntries([]);
      },
    );
    return () => {
      alive = false;
    };
  }, [path, platform, tick]);
  useEffect(() => {
    const again = () => setTick((n) => n + 1);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") again();
    }, REFRESH_MS);
    window.addEventListener("focus", again);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F5") {
        e.preventDefault();
        again();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", again);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const go = (p: string, push = true) => {
    if (p === path) return;
    if (push) setHistory((h) => [...h, path].slice(-50));
    setEntries(null);
    setError(null);
    sigRef.current = "";
    setPath(p);
    setSel(null);
    onNav(p);
  };
  const back = () => {
    const prev = history.at(-1);
    if (prev == null) return;
    setHistory((h) => h.slice(0, -1));
    go(prev, false);
  };
  const up = () => go(parentWithin(root, path));
  const segs = relSegments(root, path);

  const hiddenCount = (entries ?? []).filter((e) => e.hidden).length;
  const list = sortEntries(
    (entries ?? []).filter((e) => showHidden || !e.hidden),
    sort.key,
    sort.asc,
  );

  const activate = async (e: FsEntry) => {
    const full = joinPath(path, e.name);
    if (e.dir) return go(full);
    if (RUNNABLE.test(e.name) && !window.confirm(STR.cabinet.folder.runConfirm(e.name))) return;
    try {
      await platform.cabinetOpen(full);
    } catch (err) {
      notify(String(err instanceof Error ? err.message : err));
    }
  };

  const onRowKey = (ev: ReactKeyboardEvent<HTMLTableRowElement>, e: FsEntry, i: number) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void activate(e);
    } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const rows = tableRef.current?.querySelectorAll<HTMLTableRowElement>("tr");
      const next = rows?.[i + (ev.key === "ArrowDown" ? 1 : -1)];
      next?.focus();
    } else if (ev.key === "Backspace" || (ev.altKey && ev.key === "ArrowUp")) {
      ev.preventDefault();
      up();
    } else if (ev.altKey && ev.key === "ArrowLeft") {
      ev.preventDefault();
      back();
    }
  };

  const sortBtn = (key: EntrySortKey, label: string) => (
    <button
      type="button"
      aria-label={STR.cabinet.folder.sortAria(label)}
      onClick={() => setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: key === "name" }))}
    >
      {label}
      {sort.key === key ? (sort.asc ? " ▲" : " ▼") : ""}
    </button>
  );

  return (
    <div className={styles.folder} data-testid="folder-view" data-path={path}>
      <div className={styles.folderBar}>
        <button
          type="button"
          className={styles.navBtn}
          aria-label={STR.cabinet.folder.back}
          title={`${STR.cabinet.folder.back} (Alt+←)`}
          disabled={!history.length}
          data-testid="folder-back"
          onClick={back}
        >
          ←
        </button>
        <button
          type="button"
          className={styles.navBtn}
          aria-label={STR.cabinet.folder.up}
          title={`${STR.cabinet.folder.up} (Backspace)`}
          disabled={!segs.length}
          data-testid="folder-up"
          onClick={up}
        >
          ↑
        </button>
        <button
          type="button"
          className={styles.refreshBtn}
          aria-label={STR.cabinet.folder.refresh}
          title={`${STR.cabinet.folder.refresh} (F5)`}
          data-testid="folder-refresh"
          onClick={() => {
            sigRef.current = "";
            setTick((n) => n + 1);
          }}
        >
          ⟳
        </button>
        <nav className={styles.crumbs} aria-label={STR.cabinet.folder.root} data-testid="folder-crumbs">
          <button type="button" className={styles.crumb} title={root} onClick={() => go(root)}>
            {title}
          </button>
          {segs.map((s, i) => (
            <span key={`${i}-${s}`} style={{ display: "contents" }}>
              <span className={styles.crumbSep}>›</span>
              <button
                type="button"
                className={styles.crumb}
                onClick={() => go(joinPath(root, ...segs.slice(0, i + 1)))}
              >
                {s}
              </button>
            </span>
          ))}
        </nav>
        <button
          type="button"
          className={styles.button}
          data-testid="folder-reveal"
          onClick={() => {
            // 탐색기에서 열기(improve-1102-spec C6): 폴더는 그 안으로, 골라 둔 파일만 선택한 채
            const picked = sel ? (entries ?? []).find((x) => x.name === sel) : undefined;
            const run =
              picked && !picked.dir
                ? platform.cabinetReveal(joinPath(path, picked.name))
                : platform.cabinetOpen(picked ? joinPath(path, picked.name) : path);
            void run.catch((e: unknown) => notify(String(e instanceof Error ? e.message : e)));
          }}
        >
          {STR.cabinet.folder.reveal}
        </button>
        <button
          type="button"
          className={styles.button}
          data-testid="folder-copy"
          onClick={() =>
            void platform
              .writeClipboard(sel ? joinPath(path, sel) : path)
              .then(() => notify(STR.cabinet.copied))
          }
        >
          {STR.cabinet.folder.copyPath}
        </button>
      </div>
      {links.length > 0 && (
        <div className={styles.folderLinks}>
          {STR.cabinet.folder.linked}
          {links.map((l) => (
            <span key={l} className={styles.linkTag}>
              {l}
            </span>
          ))}
        </div>
      )}
      <div className={styles.table}>
        <table>
          <thead>
            <tr>
              <th>{sortBtn("name", STR.cabinet.folder.cols.name)}</th>
              <th style={{ width: 130 }}>{sortBtn("modified", STR.cabinet.folder.cols.modified)}</th>
              <th style={{ width: 90, textAlign: "right" }}>
                {sortBtn("size", STR.cabinet.folder.cols.size)}
              </th>
            </tr>
          </thead>
          <tbody ref={tableRef} data-testid="folder-rows">
            {list.map((e, i) => (
              <tr
                key={e.name}
                tabIndex={0}
                aria-selected={sel === e.name}
                data-testid="folder-row"
                data-name={e.name}
                onClick={() => setSel(e.name)}
                onFocus={() => setSel(e.name)}
                onDoubleClick={() => void activate(e)}
                onKeyDown={(ev) => onRowKey(ev, e, i)}
              >
                <td>
                  <span className={styles.nameCell}>
                    {e.dir ? <FolderIcon /> : <FileKindIcon kind={fileKind(e)} />}
                    {e.name}
                  </span>
                </td>
                <td className={styles.dateCol}>{formatModified(e.modified, platform.now())}</td>
                <td className={styles.numCol}>{e.dir ? "" : formatSize(e.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries && !list.length && !error && <p className={styles.empty}>{STR.cabinet.folder.empty}</p>}
        {error && (
          <p className={styles.empty} role="alert">
            {STR.cabinet.folder.error(error)}
          </p>
        )}
      </div>
      <div className={styles.folderFoot}>
        <span>{STR.cabinet.folder.hint}</span>
        {hiddenCount > 0 && (
          <button type="button" className={styles.linkBtn} onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? STR.cabinet.folder.hiddenHide : STR.cabinet.folder.hiddenToggle(hiddenCount)}
          </button>
        )}
      </div>
    </div>
  );
}
