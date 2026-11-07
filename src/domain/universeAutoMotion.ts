export type AutoMotionStyle = "drift" | "orbit";
/** Angular increments preserve the current target and radius; caller advances time only while playing. */
export function autoMotionDelta(style: AutoMotionStyle, time: number, dt: number) {
  const step = Math.max(0, Math.min(dt, 0.05));
  const radians = Math.PI / 180;
  return style === "orbit"
    ? { theta: (step * Math.PI) / 90, phi: 0, time: time + step }
    : {
        theta: (Math.sin((time + step) / 20) - Math.sin(time / 20)) * 2.5 * radians,
        phi: (Math.sin((time + step) / 24) - Math.sin(time / 24)) * 0.6 * radians,
        time: time + step,
      };
}
