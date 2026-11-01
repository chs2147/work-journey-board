// 보드(주간·데일리 뷰) 업무 이름 옆 Cabinet 바로가기(improve-1102-spec C7) — 하나면 바로 열기, 여럿이면 Cabinet을 그 업무로.
import { useShallow } from "zustand/react/shallow";
import { STR } from "../../shared/strings";
import { CabinetRailIcon } from "./CabinetIcons";
import { categoryItems, openCabinet, openItem, useCabinet } from "./cabinetStore";
import styles from "./Cabinet.module.css";

export function CabinetCategoryBadge({ categoryId, name }: { categoryId: string; name: string }) {
  const ids = useCabinet(useShallow((s) => categoryItems(categoryId, s)));
  if (!ids.length) return null;
  const label = STR.cabinet.catBadge(name, ids.length);
  return (
    <button
      type="button"
      tabIndex={-1}
      className={styles.catBadge}
      aria-label={label}
      title={label}
      data-testid="cabinet-cat-badge"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        if (ids.length === 1) void openItem(ids[0]!);
        else void openCabinet({ categoryId });
      }}
    >
      <CabinetRailIcon />
      {ids.length > 1 && ids.length}
    </button>
  );
}
