import type { LiveSnapshot, LiveWidgetConfig } from "../domain/liveWidget";
import { calendarDays } from "../domain/liveWidget";
import { SNAP_FONT, SNAP_THEME } from "./noteSnapshot";
import { V17 } from "../shared/v17Strings";
/** Frozen, local raster input for the existing board PNG renderer. No DOM capture/network/DB writes. */
export async function liveWidgetImage(w: LiveWidgetConfig, s: LiveSnapshot, width: number, height: number) {
  await document.fonts?.ready;
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("그림을 만들 수 없습니다.");
  ctx.scale(2, 2);
  ctx.fillStyle = SNAP_THEME.card;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = SNAP_THEME.line;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  const text = (value: string, x: number, y: number, size = 12, color: string = SNAP_THEME.text1) => {
    ctx.font = `${size}px ${SNAP_FONT}`;
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  };
  const line = (y: number) => {
    ctx.strokeStyle = SNAP_THEME.line;
    ctx.beginPath();
    ctx.moveTo(14, y);
    ctx.lineTo(width - 14, y);
    ctx.stroke();
  };
  text(V17[w.type], 14, 27, 13);
  text(V17.live, width - 43, 27, 10, SNAP_THEME.done);
  line(42);
  text(s.title, 14, 65, 11, SNAP_THEME.text3);
  ctx.save();
  ctx.beginPath();
  ctx.rect(10, 75, width - 20, Math.max(20, height - 108));
  ctx.clip();
  if (w.type === "elapsed") {
    const from = w.basis === "recent" ? s.recent : s.start;
    const label = from
      ? w.basis === "recent"
        ? V17.afterRecord(calendarDays(from, s.today))
        : V17.days(calendarDays(from, s.today))
      : V17.missingDate;
    text(label, 14, 109, 24);
    text(from ?? "", 14, 137, 12, SNAP_THEME.text3);
  } else if (w.type === "timeline" && w.variant !== "records") {
    const points =
      w.variant === "weeks"
        ? s.weeks.map((e) => ({ date: e.weekId, text: e.text, count: V17.weekCount(e.count) }))
        : [...s.selected]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((e) => ({ date: e.date, text: e.text, count: "" }));
    const step = Math.max(125, (width - 28) / Math.max(1, points.length));
    points.forEach((p, i) => {
      const x = 14 + step * (i + 0.5);
      if (i < points.length - 1) {
        ctx.strokeStyle = SNAP_THEME.lineStrong;
        ctx.beginPath();
        ctx.moveTo(x, 112);
        ctx.lineTo(x + step, 112);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, 112, 4, 0, Math.PI * 2);
      ctx.fillStyle = SNAP_THEME.done;
      ctx.fill();
      ctx.textAlign = "center";
      text(p.date, x, 90, 10, SNAP_THEME.text3);
      text(p.text.length > 13 ? p.text.slice(0, 13) + "…" : p.text, x, 139, 12);
      text(p.count, x, 159, 10, SNAP_THEME.text3);
      ctx.textAlign = "left";
    });
    if (!points.length)
      text(w.variant === "milestones" ? V17.noneChosen : V17.empty, 14, 105, 12, SNAP_THEME.text3);
  } else {
    let y = 88;
    const entries = w.type === "important" ? s.important : s.records;
    for (const e of entries) {
      if (y > height - 35) break;
      text(e.date, 14, y, 10, SNAP_THEME.text3);
      y += 19;
      let value = (w.type === "important" ? "○ " : "") + e.text;
      while (value && y < height - 34) {
        let n = Math.min(value.length, 45);
        while (n > 1 && ctx.measureText(value.slice(0, n)).width > width - 34) n--;
        text(value.slice(0, n), 14, y);
        value = value.slice(n);
        y += 19;
      }
      y += 12;
    }
    if (!entries.length)
      text(w.type === "important" ? V17.emptyImportant : V17.empty, 14, 100, 12, SNAP_THEME.text3);
  }
  ctx.restore();
  line(height - 28);
  text(V17.asOf(s.today), 14, height - 11, 9, SNAP_THEME.text3);
  const data = canvas.toDataURL("image/png").split(",")[1]!;
  return {
    mime: "image/png",
    data,
    width: canvas.width,
    height: canvas.height,
    bytes: Math.floor((data.length * 3) / 4),
  };
}
