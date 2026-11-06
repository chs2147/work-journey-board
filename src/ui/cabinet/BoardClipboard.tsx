import { copyBoardObjects, pasteBoardObjects } from "./boardTransfer";
import { CABI } from "../../shared/cabiStrings";
import { IconCopyItem, IconPlus } from "../common/icons";
import { reportError } from "../board/boardStore";
import styles from "../note/Note.module.css";
export function BoardClipboard() {
  return (
    <>
      <button
        type="button"
        className={styles.iconButton}
        title={CABI.copyObjects}
        aria-label={CABI.copyObjects}
        onClick={() => void copyBoardObjects().catch(reportError)}
      >
        <IconCopyItem />
      </button>
      <button
        type="button"
        className={styles.iconButton}
        title={CABI.pasteObjects}
        aria-label={CABI.pasteObjects}
        onClick={() => void pasteBoardObjects().catch(reportError)}
      >
        <IconPlus />
      </button>
    </>
  );
}
