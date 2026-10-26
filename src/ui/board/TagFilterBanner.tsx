// 태그로 거른 보기 안내 띠(improve-1026-spec 6-1) — 주간 뷰·오늘 뷰가 함께 쓴다.
import { filterLabel } from "../../domain/tags";
import { STR } from "../../shared/strings";
import { setTagFilter, shownCategories, useBoard } from "./boardStore";
import styles from "./Board.module.css";

export function TagFilterBanner() {
  const view = useBoard((s) => s.view);
  const categoryTags = useBoard((s) => s.categoryTags);
  const tagFilter = useBoard((s) => s.tagFilter);
  const tags = useBoard((s) => s.tags);
  if (!view || tagFilter.length === 0) return null;
  const shown = shownCategories({ view, categoryTags, tagFilter }).length;
  const all = view.categories.length;
  return (
    <div className={styles.filterBanner} role="status" data-testid="tag-filter-banner">
      <span>
        {STR.tags.banner(filterLabel(tagFilter, tags, STR.tags.noTag), all - shown)}
        {shown === 0 && all > 0 && ` — ${STR.tags.allHidden}`}
      </span>
      <button type="button" onClick={() => setTagFilter([])}>
        {STR.tags.clear}
      </button>
    </div>
  );
}
