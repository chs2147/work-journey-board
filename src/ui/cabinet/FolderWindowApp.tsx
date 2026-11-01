// 실앱 폴더 창(features-1102-spec F5): 별도 OS 창 `folder-<id>`가 index.html?win=folder&d=<정보>로 띄우는 화면.
// 일지(DB)는 열지 않는다 — 메인 창이 넘겨 준 뿌리·제목·연결 글과 Rust cabinet_* 명령(등록 폴더 안인지 재검사)만 쓴다.
import { useEffect, useState } from "react";
import { loadPlatform, type Platform } from "../../platform";
import { parseFolderSpec } from "./folderSpec";
import { FolderView } from "./FolderView";
import styles from "./Cabinet.module.css";

export function FolderWindowApp() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const spec = parseFolderSpec(location.search);
  useEffect(() => {
    if (spec) document.documentElement.dataset.theme = spec.theme;
    void loadPlatform().then(setPlatform);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 2500);
    return () => clearTimeout(t);
  }, [note]);
  if (!spec || !platform) return null;
  return (
    <div className={styles.osWin}>
      <FolderView
        platform={platform}
        root={spec.root}
        sub={spec.sub}
        title={spec.title}
        links={spec.links}
        onNav={(sub) => void platform.folderWindows?.notifyNav(spec.id, sub)}
        notify={setNote}
      />
      {note && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "6px 14px",
            borderRadius: 6,
            background: "var(--text-1)",
            color: "var(--surface-card)",
            fontSize: 13,
          }}
        >
          {note}
        </div>
      )}
    </div>
  );
}
