// 설정 > 태그(improve-1026-spec 4-1): 이름 바꾸기 · 순서 · 지우기(확인 후 — 모든 업무에서 떨어짐).
import { STR } from "../../shared/strings";
import { deleteTag, moveTag, renameTag, useBoard } from "../board/boardStore";
import styles from "./Settings.module.css";

export function TagSettings() {
  const tags = useBoard((s) => s.tags);
  const categoryTags = useBoard((s) => s.categoryTags);
  const usage = (id: string) => Object.values(categoryTags).filter((ids) => ids.includes(id)).length;

  return (
    <section className={styles.section} aria-labelledby="s-tags">
      <h3 id="s-tags">{STR.tags.settingsTitle}</h3>
      {tags.length === 0 ? (
        <p className={styles.note}>{STR.tags.settingsNone}</p>
      ) : (
        <ul className={styles.tagList} data-testid="tag-settings">
          {tags.map((t, i) => (
            <li key={t.id}>
              <span aria-hidden="true">#</span>
              <input
                // 이름이 바뀌면(실패해 되돌림 포함) 입력칸을 새로 그린다
                key={t.name}
                className={styles.repeatText}
                defaultValue={t.name}
                maxLength={21}
                aria-label={STR.tags.settingsName(t.name)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                onBlur={(e) => {
                  const input = e.currentTarget;
                  const name = input.value;
                  if (name.trim() && name !== t.name)
                    void renameTag(t.id, name).then((ok) => {
                      if (!ok) input.value = t.name;
                    });
                  else input.value = t.name;
                }}
              />
              <span className={styles.note}>{STR.tags.used(usage(t.id))}</span>
              <button
                type="button"
                aria-label={`${STR.tags.up}: #${t.name}`}
                title={STR.tags.up}
                disabled={i === 0}
                onClick={() => void moveTag(t.id, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`${STR.tags.down}: #${t.name}`}
                title={STR.tags.down}
                disabled={i === tags.length - 1}
                onClick={() => void moveTag(t.id, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(STR.tags.removeConfirm(t.name, usage(t.id)))) void deleteTag(t.id);
                }}
              >
                {STR.tags.remove}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
