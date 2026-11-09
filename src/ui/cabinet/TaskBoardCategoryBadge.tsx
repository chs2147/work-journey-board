import { STR } from "../../shared/strings";
import { reportError } from "../board/boardStore";
import { IconMap } from "../common/icons";
import { openCabi } from "./cabiService";
import { useCabinet } from "./cabinetStore";
import styles from "./Cabinet.module.css";

/** 주간·데일리 업무 이름에서 이미 존재하는 업무 메모보드를 바로 연다. */
export function TaskBoardCategoryBadge({ categoryId, name }: { categoryId: string; name: string }) {
  const exists = useCabinet((s) => s.cabiBoardIds.includes(categoryId));
  if (!exists) return null;
  const label = STR.cabinet.taskBoardBadge(name);
  return (
    <button
      type="button"
      className={styles.catBadge}
      aria-label={label}
      title={label}
      data-testid="task-board-cat-badge"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        void openCabi("board", categoryId).catch(reportError);
      }}
    >
      <IconMap />
    </button>
  );
}
