import type { LiveSnapshot, LiveWidgetConfig } from "../../domain/liveWidget";
import { calendarDays, localToday } from "../../domain/liveWidget";
import type { NoteDoc, TextBox } from "../../domain/note";
import { V17 } from "../../shared/v17Strings";
import { cabiClient } from "./cabiService";
export const widgetTitle = (w: LiveWidgetConfig) => V17[w.type];
export function widgetSince(w: LiveWidgetConfig, today: string) {
  if (w.type !== "timeline" || w.weeks === 0) return "0000-01-01";
  const [y, m, d] = today.split("-").map(Number),
    date = new Date(y!, m! - 1, d!);
  date.setDate(date.getDate() - (w.weeks ?? 8) * 7);
  return localToday(date);
}
export function widgetLines(w: LiveWidgetConfig, s: LiveSnapshot): string[] {
  if (w.type === "elapsed") {
    const from = w.basis === "recent" ? s.recent : s.start;
    return [
      widgetTitle(w),
      from
        ? w.basis === "recent"
          ? V17.afterRecord(calendarDays(from, s.today))
          : V17.days(calendarDays(from, s.today))
        : V17.missingDate,
      from ?? "",
      V17.asOf(s.today),
    ];
  }
  if (w.type === "important")
    return [
      widgetTitle(w),
      ...s.important.map((e) => "[ ] " + e.text + (e.dueDate ? " · " + e.dueDate : "")),
      V17.total(s.importantCount),
      V17.asOf(s.today),
    ];
  if (w.variant === "milestones")
    return [
      V17.milestones,
      ...[...s.selected].sort((a, b) => a.date.localeCompare(b.date)).map((e) => e.date + " · " + e.text),
      ...(w.milestoneEntryIds ?? [])
        .filter((id) => !s.selected.some((e) => e.id === id))
        .map(() => V17.missingSource),
      V17.equal,
      V17.asOf(s.today),
    ];
  if (w.variant === "weeks")
    return [
      V17.weeks,
      ...s.weeks.map((w) => w.weekId + " · " + V17.weekCount(w.count) + " · " + w.text),
      V17.asOf(s.today),
    ];
  return [
    widgetTitle(w),
    ...s.records.map((e) => e.date + " · " + e.text),
    V17.total(s.recordCount),
    V17.asOf(s.today),
  ];
}
export async function materializeWidgets(
  doc: NoteDoc,
  categoryId: string,
  today = localToday(),
): Promise<NoteDoc> {
  const boxes = await Promise.all(
    doc.boxes.map(async (b) => {
      if (b.kind !== "text" || !b.widget) return b;
      const w = b.widget,
        s = await cabiClient().widgetSnapshot(
          categoryId,
          today,
          widgetSince(w, today),
          0,
          w.milestoneEntryIds ?? [],
        );
      const { widget: _widget, ...plain } = b;
      void _widget;
      return {
        ...plain,
        content: {
          type: "doc",
          content: widgetLines(w, s)
            .filter(Boolean)
            .map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
        },
      } as TextBox;
    }),
  );
  return { ...doc, boxes };
}

export async function rasterizeWidgets(doc: NoteDoc, categoryId: string, today = localToday()) {
  const { liveWidgetImage } = await import("../../export/liveWidgetImage");
  const images: Record<string, { mime: string; data: string; width: number; height: number; bytes: number }> =
    {};
  const boxes = await Promise.all(
    doc.boxes.map(async (b) => {
      if (b.kind !== "text" || !b.widget) return b;
      const s = await cabiClient().widgetSnapshot(
        categoryId,
        today,
        widgetSince(b.widget, today),
        0,
        b.widget.milestoneEntryIds ?? [],
      );
      const asset = "widget-" + b.id;
      images[asset] = await liveWidgetImage(b.widget, s, b.w, b.h ?? 250);
      return {
        id: b.id,
        kind: "image" as const,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        z: b.z,
        asset,
        caption: "",
        refs: b.refs,
      };
    }),
  );
  return { doc: { ...doc, boxes }, images };
}
