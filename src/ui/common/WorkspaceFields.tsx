// 워크스페이스 색·아이콘 고르기(새로 만들기 1단계·설정 > 워크스페이스 [이름·색·아이콘]에서 같이 쓴다).
// 아이콘은 모노그램(생산성 도구 이모지를 선 그림으로), 색은 업무 색 8개와 같은 팔레트.
import { WORKSPACE_ICONS, type WorkspaceIcon } from "../../domain/workspace";
import { CATEGORY_COLOR_KEYS, CATEGORY_COLORS, type CategoryColorKey } from "../../shared/palette";
import { STR } from "../../shared/strings";
import { WorkspaceGlyph, WorkspaceMark } from "./workspaceIcons";
import styles from "./WorkspaceFields.module.css";

const iconLabel = (icon: WorkspaceIcon) => STR.workspace.icons[icon];

export function ColorChoices({
  value,
  onChange,
}: {
  value: CategoryColorKey;
  onChange: (c: CategoryColorKey) => void;
}) {
  return (
    <div className={styles.colors} role="radiogroup" aria-label={STR.workspace.color} data-testid="ws-colors">
      {CATEGORY_COLOR_KEYS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={CATEGORY_COLORS[c].name}
          title={CATEGORY_COLORS[c].name}
          className={`${styles.color} ${c === value ? styles.colorOn : ""}`}
          style={{ background: `var(--cat-${c})` }}
          data-color={c}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

export function IconChoices({
  value,
  color,
  onChange,
}: {
  value: WorkspaceIcon;
  color: CategoryColorKey;
  onChange: (i: WorkspaceIcon) => void;
}) {
  return (
    <div className={styles.icons} role="radiogroup" aria-label={STR.workspace.icon} data-testid="ws-icons">
      {WORKSPACE_ICONS.map((i) => {
        const on = i === value;
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={iconLabel(i)}
            title={iconLabel(i)}
            className={`${styles.icon} ${on ? styles.iconOn : ""}`}
            style={on ? { background: `var(--cat-${color})`, color: "#fff" } : undefined}
            data-icon={i}
            onClick={() => onChange(i)}
          >
            <WorkspaceGlyph icon={i} size={18} />
          </button>
        );
      })}
    </div>
  );
}

/** 미리 보기 + 이름 칸 + 색 + 아이콘 */
export function WorkspaceLook({
  name,
  color,
  icon,
  onName,
  onColor,
  onIcon,
  autoFocus,
}: {
  name: string;
  color: CategoryColorKey;
  icon: WorkspaceIcon;
  onName: (s: string) => void;
  onColor: (c: CategoryColorKey) => void;
  onIcon: (i: WorkspaceIcon) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className={styles.look}>
      <div className={styles.nameRow}>
        <WorkspaceMark icon={icon} color={color} size={40} />
        <label className={styles.field}>
          <span className={styles.label}>{STR.workspace.name}</span>
          <input
            className={styles.input}
            value={name}
            maxLength={24}
            placeholder={STR.workspace.namePlaceholder}
            autoFocus={autoFocus}
            data-testid="ws-name"
            onChange={(e) => onName(e.target.value)}
          />
        </label>
      </div>
      <span className={styles.label}>{STR.workspace.color}</span>
      <ColorChoices value={color} onChange={onColor} />
      <span className={styles.label}>{STR.workspace.icon}</span>
      <IconChoices value={icon} color={color} onChange={onIcon} />
    </div>
  );
}
