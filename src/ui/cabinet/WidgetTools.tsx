import { V18 } from "../../shared/v18Strings";
import { emptyContent, type TextBox } from "../../domain/note";
import { V17 } from "../../shared/v17Strings";
import { useNote, importBoardObjects } from "../note/noteStore";
import { IconClock, IconNote } from "../common/icons";
import styles from "../note/Note.module.css";
const IconFlag = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"
      stroke="currentColor"
      fill="none"
      strokeWidth="1.5"
    />
  </svg>
);
export function WidgetTools() {
  return (
    <div role="group" aria-label="Live Widget" className={styles.widgetGroup}>
      <div className={styles.widgetTools}>
        {(["elapsed", "timeline", "important"] as const).map((type) => (
          <button
            className={styles.iconButton}
            key={type}
            aria-label={V17[type]}
            title={V17[type] + " — " + V18.widgetHints[type]}
            onClick={() => {
              const doc = useNote.getState().doc;
              const box: TextBox = {
                id: crypto.randomUUID(),
                kind: "text",
                x: 24,
                y: Math.max(24, ...doc.boxes.map((b) => b.y + (b.h ?? 100) + 24)),
                w: type === "elapsed" ? 300 : 640,
                h: type === "elapsed" ? 200 : 340,
                z: doc.boxes.length + 1,
                bg: null,
                content: emptyContent(),
                widget: { type, basis: "start", variant: "records", weeks: 8, milestoneEntryIds: [] },
              };
              importBoardObjects({ v: 1, boxes: [box] });
            }}
          >
            {type === "elapsed" ? <IconClock /> : type === "timeline" ? <IconNote /> : <IconFlag />}
          </button>
        ))}
      </div>
    </div>
  );
}
