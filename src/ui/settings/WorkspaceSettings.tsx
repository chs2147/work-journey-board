// 설정 > 워크스페이스(multi-board-spec 5절): 목록·순서·이름·색·아이콘·폴더 열기·열기·목록에서 빼기·새로 만들기·기존 폴더 추가.
// 목록에서 빼기는 이 PC 목록에서만 — 폴더·파일은 지우지 않는다(CLAUDE.md 4-3, D10).
import { useState } from "react";
import { canRemove, sameDir, type WorkspaceEntry } from "../../domain/workspace";
import { today as todayOf, shortDateLabel } from "../../domain/week";
import { osText } from "../../shared/platformText";
import { STR } from "../../shared/strings";
import { toast } from "../board/boardStore";
import {
  addExistingWorkspace,
  removeWorkspace,
  reorderWorkspaces,
  switchWorkspace,
  updateWorkspaceMeta,
} from "../common/appController";
import { useAppStore } from "../common/appStore";
import { WorkspaceLook } from "../common/WorkspaceFields";
import { WorkspaceMark } from "../common/workspaceIcons";
import { Card } from "./SettingsCard";
import styles from "./Settings.module.css";

export function WorkspaceSettings() {
  const platform = useAppStore((s) => s.platform)!;
  const list = useAppStore((s) => s.workspaces);
  const dir = useAppStore((s) => (s.journal.state === "ready" ? s.journal.dataDir : null));
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const today = todayOf(platform.now());

  const addExisting = async () => {
    const p = await platform.pickFolder(STR.workspace.pickTitle);
    if (!p) return;
    const err = await addExistingWorkspace(p);
    setNotice(err);
  };

  return (
    <Card
      id="ws-list"
      title={STR.workspace.listTitle}
      desc={STR.workspace.listLead}
      testId="workspace-settings"
    >
      <ul className={styles.wsList} data-testid="workspace-list">
        {list.map((w, i) => {
          const current = !!dir && sameDir(w.dir, dir);
          return (
            <li key={w.dir} className={styles.wsRow} data-testid="workspace-row">
              <div className={styles.wsMain}>
                <span className={styles.wsOrder}>
                  <button
                    type="button"
                    className={styles.wsArrow}
                    aria-label={`${w.name} ${STR.workspace.moveUp}`}
                    title={STR.workspace.moveUp}
                    disabled={i === 0}
                    onClick={() => void reorderWorkspaces(i, i - 1)}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className={styles.wsArrow}
                    aria-label={`${w.name} ${STR.workspace.moveDown}`}
                    title={STR.workspace.moveDown}
                    disabled={i === list.length - 1}
                    onClick={() => void reorderWorkspaces(i, i + 1)}
                  >
                    ▼
                  </button>
                </span>
                <WorkspaceMark icon={w.icon} color={w.color} size={30} />
                <span className={styles.wsText}>
                  <span className={styles.wsName}>
                    {w.name}
                    {current && <span className={styles.wsTag}>{STR.workspace.current}</span>}
                  </span>
                  <code className={styles.wsDir} title={w.dir}>
                    {w.dir}
                  </code>
                </span>
                <span className={styles.wsMeta}>
                  {STR.workspace.colLast}{" "}
                  {w.lastOpened === today
                    ? STR.workspace.today
                    : w.lastOpened
                      ? shortDateLabel(w.lastOpened)
                      : STR.workspace.never}
                </span>
                <span className={styles.wsMeta}>{i < 9 ? osText(STR.workspace.shortcut(i + 1)) : ""}</span>
                <span className={styles.wsActions}>
                  <button
                    type="button"

                    data-testid="ws-edit"
                    onClick={() => setEditing(editing === w.dir ? null : w.dir)}
                  >
                    {STR.workspace.edit}
                  </button>
                  <button
                    type="button"

                    onClick={() => void platform.openFolder(w.dir).catch(() => undefined)}
                  >
                    {STR.workspace.openFolder}
                  </button>
                  {!current && (
                    <button
                      type="button"

                      data-testid="ws-open"
                      onClick={() => void switchWorkspace(w.dir)}
                    >
                      {STR.workspace.open}
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.danger}
                    data-testid="ws-remove"
                    disabled={!canRemove(list, w.dir, dir)}
                    title={current ? STR.workspace.removeCantCurrent : undefined}
                    onClick={() => setConfirm(w.dir)}
                  >
                    {STR.workspace.remove}
                  </button>
                </span>
              </div>
              {editing === w.dir && <EditRow entry={w} onDone={() => setEditing(null)} />}
              {confirm === w.dir && (
                <div
                  className={styles.wsConfirm}
                  role="alertdialog"
                  aria-label={STR.workspace.removeTitle(w.name)}
                >
                  <b>{STR.workspace.removeTitle(w.name)}</b>
                  <p>
                    {STR.workspace.removeBody} <code>{w.dir}</code>
                  </p>
                  <div className={styles.wsConfirmButtons}>
                    <button type="button" onClick={() => setConfirm(null)}>
                      {STR.workspace.cancel}
                    </button>
                    <button
                      type="button"
                      className={styles.danger}
                      data-testid="ws-remove-confirm"
                      onClick={() =>
                        void removeWorkspace(w.dir).then((ok) => {
                          setConfirm(null);
                          if (ok) toast(STR.workspace.removed(w.name));
                        })
                      }
                    >
                      {STR.workspace.remove}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className={styles.wsButtons}>
        <button
          type="button"
          className={styles.primary}
          data-testid="ws-settings-new"
          onClick={() => useAppStore.setState({ creatingWorkspace: true })}
        >
          {STR.workspace.create}
        </button>
        <button type="button" onClick={() => void addExisting()}>
          {STR.workspace.addExisting}
        </button>
      </div>
      {notice && <p className={styles.error}>{notice}</p>}
    </Card>
  );
}

function EditRow({ entry, onDone }: { entry: WorkspaceEntry; onDone: () => void }) {
  const [name, setName] = useState(entry.name);
  const [color, setColor] = useState(entry.color);
  const [icon, setIcon] = useState(entry.icon);
  return (
    <div className={styles.wsEdit} data-testid="ws-edit-row">
      <WorkspaceLook
        name={name}
        color={color}
        icon={icon}
        autoFocus
        onName={setName}
        onColor={setColor}
        onIcon={setIcon}
      />
      <div className={styles.wsConfirmButtons}>
        <button type="button" onClick={onDone}>
          {STR.workspace.cancel}
        </button>
        <button
          type="button"
          className={styles.primary}
          data-testid="ws-edit-save"
          disabled={!name.trim()}
          onClick={() => void updateWorkspaceMeta(entry.dir, { name, color, icon }).then(onDone)}
        >
          {STR.workspace.save}
        </button>
      </div>
    </div>
  );
}
