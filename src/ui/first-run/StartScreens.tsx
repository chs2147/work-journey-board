// 시작할 때 일지를 열 수 없는 경우의 화면: 저장 폴더 없음 / 데이터 파일 이상(data-spec 7-3).
import { classifyFolder } from "../../data/session";
import { BACKUP_DIR } from "../../data/backup";
import { STR } from "../../shared/strings";
import { goFirstRun, openAt, openFolderAsJournal, switchWorkspace } from "../common/appController";
import { sameDir } from "../../domain/workspace";
import { WorkspaceMark } from "../common/workspaceIcons";
import { RestorePanel } from "../common/RestorePanel";
import { useAppStore } from "../common/appStore";
import { useEffect } from "react";
import { LATEST_SCHEMA_VERSION } from "../../data/migrate";
import { checkNow, checkOnStart, openReleasesPage, openUpdateDialog, useUpdate } from "../update/updateStore";
import styles from "./FirstRun.module.css";

export function MissingFolder({ dataDir }: { dataDir: string }) {
  const platform = useAppStore((s) => s.platform)!;
  // 다른 워크스페이스가 있으면 그쪽을 바로 열 수 있게(multi-board-spec R2)
  const others = useAppStore((s) => s.workspaces).filter((e) => !sameDir(e.dir, dataDir));
  return (
    <div className={styles.wrap}>
      <section className={styles.card} role="alert">
        <h1 className={styles.title}>{STR.missing.title}</h1>
        <p className={styles.lead}>{STR.missing.body(dataDir)}</p>
        <div className={styles.stack}>
          <button type="button" className={styles.primary} onClick={() => void openAt(dataDir)} autoFocus>
            {STR.missing.retry}
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={async () => {
              const p = await platform.pickFolder(STR.firstRun.pickTitle);
              if (p && (await classifyFolder(platform, null, p)) === "has-journal")
                await openFolderAsJournal(p);
            }}
          >
            {STR.missing.openOther}
          </button>
          {others.map((w) => (
            <button
              key={w.dir}
              type="button"
              className={styles.secondary}
              data-testid="missing-open-workspace"
              onClick={() => void switchWorkspace(w.dir)}
            >
              <WorkspaceMark icon={w.icon} color={w.color} size={20} /> {STR.missing.openWorkspace(w.name)}
            </button>
          ))}
          <button type="button" className={styles.link} onClick={goFirstRun}>
            {STR.missing.startNew}
          </button>
        </div>
      </section>
    </div>
  );
}

export function IntegrityProblem({ dataDir, path }: { dataDir: string; path: string }) {
  const platform = useAppStore((s) => s.platform)!;
  return (
    <div className={styles.wrap}>
      <section className={styles.card} role="alert">
        <h1 className={styles.title}>{STR.integrity.title}</h1>
        <p className={styles.lead}>{STR.integrity.body(path)}</p>
        <p className={styles.small}>{STR.integrity.guide}</p>
        <RestorePanel dataDir={dataDir} />
        <div className={styles.row}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void platform.openFolder(platform.join(dataDir, BACKUP_DIR))}
          >
            {STR.integrity.openBackups}
          </button>
          <button type="button" className={styles.primary} onClick={() => void openAt(dataDir)}>
            {STR.integrity.retry}
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * 앱과 호환되지 않는 일지(improve-v22-spec 2-2): 일지를 열지 않은 채 업데이트를 안내한다.
 * [업데이트] = 일지 없이도 최신 버전 확인·설치(설치 전 백업은 파일 복사) · 다른 워크스페이스·폴더로 바꾸기.
 */
export function UpdateRequired({ dataDir, fileVersion }: { dataDir: string; fileVersion: number }) {
  const platform = useAppStore((s) => s.platform)!;
  const workspaces = useAppStore((s) => s.workspaces);
  const here = workspaces.find((e) => sameDir(e.dir, dataDir));
  const others = workspaces.filter((e) => !sameDir(e.dir, dataDir));
  const phase = useUpdate((s) => s.phase);
  const info = useUpdate((s) => s.info);
  const error = useUpdate((s) => s.error);
  const I = STR.incompatible;
  useEffect(() => {
    void checkOnStart();
  }, []);
  const onUpdate = async () => {
    if (useUpdate.getState().phase !== "available") await checkNow();
    if (useUpdate.getState().phase === "available") openUpdateDialog();
  };
  return (
    <div className={styles.wrap}>
      <section className={`${styles.card} ${styles.incompatible}`} role="alert" data-testid="update-required">
        <h1 className={styles.title}>⚠ {I.title}</h1>
        <p className={styles.lead}>{I.body}</p>
        <p className={styles.lead}>{I.body2}</p>
        <dl className={styles.facts}>
          {here && (
            <>
              <dt>{I.workspace}</dt>
              <dd>{here.name}</dd>
            </>
          )}
          <dt>{I.folder}</dt>
          <dd>{dataDir}</dd>
          <dt>{I.dataVersion}</dt>
          <dd className={styles.bad} data-testid="update-required-version">
            {I.dataVersionValue(fileVersion, LATEST_SCHEMA_VERSION)}
          </dd>
          <dt>{I.appVersion}</dt>
          <dd>{__APP_VERSION__}</dd>
        </dl>
        <div className={styles.row}>
          <button
            type="button"
            className={styles.primary}
            autoFocus
            disabled={phase === "checking" || phase === "downloading" || phase === "installing"}
            data-testid="update-required-update"
            onClick={() => void onUpdate()}
          >
            {phase === "checking"
              ? I.checking
              : phase === "available" && info
                ? I.updateTo(info.version)
                : I.checkUpdate}
          </button>
          <button type="button" className={styles.secondary} onClick={() => void openReleasesPage()}>
            {I.releases}
          </button>
        </div>
        {phase === "none" && <p className={styles.small}>{I.latest}</p>}
        {phase === "failed" && error && <p className={styles.small}>{I.failed(error)}</p>}
        <div className={styles.stack}>
          {others.map((w) => (
            <button
              key={w.dir}
              type="button"
              className={styles.secondary}
              data-testid="update-required-workspace"
              onClick={() => void switchWorkspace(w.dir)}
            >
              <WorkspaceMark icon={w.icon} color={w.color} size={20} /> {I.otherWorkspace(w.name)}
            </button>
          ))}
          <button
            type="button"
            className={styles.link}
            onClick={async () => {
              const p = await platform.pickFolder(STR.firstRun.pickTitle);
              if (p && (await classifyFolder(platform, null, p)) === "has-journal")
                await openFolderAsJournal(p);
            }}
          >
            {I.otherFolder}
          </button>
        </div>
        <p className={styles.small}>{I.note}</p>
      </section>
    </div>
  );
}
