import { CABI } from "../../shared/cabiStrings";
import { useCabiChange } from "./cabiService";
import styles from "./Cabi.module.css";
export function CabiDropGhost({ at }: { at: { x: number; y: number } | null }) {
  const preview = useCabiChange((s) => s.dragPreview);
  if (!at || !preview) return null;
  return (
    <div
      className={styles.dragGhost}
      style={{ left: at.x, top: at.y }}
      role="status"
      data-testid="cabi-drop-preview"
    >
      <strong>{preview.resource ? CABI.dropResource : CABI.copyPreview(preview.count)}</strong>
      <p className={styles.muted}>{preview.resource ? CABI.referenceHelp : CABI.noAutoLinks}</p>
    </div>
  );
}
