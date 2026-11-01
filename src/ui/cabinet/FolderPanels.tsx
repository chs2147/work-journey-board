// 브라우저 모드 폴더 창(features-1102-spec F5): 실앱은 별도 OS 창이지만, 개발·E2E(브라우저 모드)는 앱 안 떠 있는 창으로 같은 FolderView를 띄운다.
import { useShallow } from "zustand/react/shallow";
import { STR } from "../../shared/strings";
import { toast } from "../board/boardStore";
import { useAppStore } from "../common/appStore";
import { closeFolder, linkLabels, setFolderSub, useCabinet } from "./cabinetStore";
import { FolderIcon } from "./CabinetIcons";
import { useWindowDrag } from "./useWindowDrag";
import { FolderView } from "./FolderView";
import styles from "./Cabinet.module.css";

export function FolderPanels() {
  const platform = useAppStore((s) => s.platform);
  const folders = useCabinet((s) => s.folders);
  const items = useCabinet((s) => s.items);
  if (!platform || platform.folderWindows) return null;
  return (
    <>
      {folders.map((f, i) => {
        const it = items.find((x) => x.id === f.id);
        return it ? (
          <FolderPanel key={f.id} index={i} id={f.id} root={it.target} sub={f.sub} title={it.title} />
        ) : null;
      })}
    </>
  );
}

function FolderPanel({
  id,
  root,
  sub,
  title,
  index,
}: {
  id: string;
  root: string;
  sub: string;
  title: string;
  index: number;
}) {
  const platform = useAppStore((s) => s.platform)!;
  const links = useCabinet(useShallow((s) => linkLabels(id, s)));
  const { pos, onPointerDown, z, raise } = useWindowDrag({ x: 560 + index * 28, y: 210 + index * 28 });
  return (
    <div
      className={styles.win}
      style={{ left: pos.x, top: pos.y, width: 660, height: 440, zIndex: z }}
      onPointerDownCapture={raise}
      onFocusCapture={raise}
      role="dialog"
      aria-label={`${title} — Cabinet`}
      data-testid="folder-window"
      data-id={id}
    >
      <div className={styles.winHead} onPointerDown={onPointerDown}>
        <span className={styles.winTitle}>
          <FolderIcon size={14} />
          {title} <small>— Cabinet</small>
        </span>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label={STR.cabinet.folder.close}
          title={STR.cabinet.folder.close}
          data-testid="folder-close"
          onClick={() => void closeFolder(id)}
        >
          ✕
        </button>
      </div>
      <FolderView
        platform={platform}
        root={root}
        sub={sub}
        title={title}
        links={links}
        onNav={(p) => setFolderSub(id, p)}
        notify={(m) => toast(m)}
      />
    </div>
  );
}
