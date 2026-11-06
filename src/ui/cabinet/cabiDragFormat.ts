export const CABI_DRAG_PREFIX = "wjb-cabi-drag:";
export function cabiToken(dt: DataTransfer) {
  const text = dt.getData("text/plain");
  return text.startsWith(CABI_DRAG_PREFIX) ? text.slice(CABI_DRAG_PREFIX.length) : null;
}
