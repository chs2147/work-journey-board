// 설정 › 업데이트·정보 › 진단 정보(optimize-1031-plan O1): 회사 PC에서 메모리·용량을 확인해 붙여 넣어 전달하기 위한 표.
// 네트워크 없음 — 값은 화면 안에서만 모으고 [복사]는 사용자가 누를 때만 클립보드로.
import { useState } from "react";
import { backupFolderStats, journalPath, lastBackupOf } from "../../data/session";
import { formatBytes, STR } from "../../shared/strings";
import { toast } from "../board/boardStore";
import { useAppStore } from "../common/appStore";
import styles from "./Settings.module.css";
import { Card } from "./SettingsCard";
import { OS } from "../../shared/os";

/** Chromium 계열(WebView2 포함)만 있는 비표준 값 */
function jsHeapMb(): number | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? Math.round((m.usedJSHeapSize / 1048576) * 10) / 10 : null;
}

export function DiagnosticsCard() {
  const platform = useAppStore((s) => s.platform)!;
  const journal = useAppStore((s) => s.journal);
  const [rows, setRows] = useState<[string, string][] | null>(null);
  if (journal.state !== "ready") return null;

  const collect = async () => {
    const D = STR.settings.diag;
    const [file, images, backups, last, oneDrive] = await Promise.all([
      platform.stat(journalPath(platform, journal.dataDir)),
      journal.repo.noteAssetStats(),
      backupFolderStats(platform, journal.dataDir),
      lastBackupOf(platform, journal.dataDir),
      platform.isOneDrivePath(journal.dataDir),
    ]);
    const heap = jsHeapMb();
    setRows([
      [D.version, `${__APP_VERSION__} · SQLite ${journal.sqliteVersion}`],
      // macos-spec 4-3: 어느 OS의 판인지(문제를 알릴 때 윈도우·맥 구분)
      [
        D.os,
        D.osValue(
          OS === "macos" ? "macOS" : "Windows",
          navigator.userAgent.replace(/^.*?\(([^)]*)\).*$/, "$1"),
        ),
      ],
      [D.memory, heap === null ? D.unknown : `${heap} MB`],
      [D.journal, file.size === null ? D.unknown : formatBytes(file.size)],
      [D.images, D.imageValue(images.count, formatBytes(images.bytes))],
      [D.backups, D.backupValue(backups.count, formatBytes(backups.bytes))],
      [D.lastBackup, last ? last.when : D.none],
      [D.oneDrive, oneDrive ? D.yes : D.no],
    ]);
  };

  return (
    <Card id="s-diag" title={STR.settings.diag.title} desc={STR.settings.diag.desc} testId="diagnostics">
      <details
        className={styles.diag}
        onToggle={(e) => {
          if ((e.currentTarget as HTMLDetailsElement).open) void collect();
        }}
      >
        <summary>{STR.settings.diag.show}</summary>
        {rows && (
          <>
            <dl className={styles.diagList} data-testid="diag-list">
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <div className={styles.diagActions}>
              <button type="button" onClick={() => void collect()}>
                {STR.settings.diag.refresh}
              </button>
              <button
                type="button"
                onClick={async () => {
                  await platform.writeClipboard(rows.map(([k, v]) => `${k}: ${v}`).join("\n"));
                  toast(STR.settings.diag.copied);
                }}
              >
                {STR.settings.diag.copy}
              </button>
            </div>
          </>
        )}
      </details>
    </Card>
  );
}
