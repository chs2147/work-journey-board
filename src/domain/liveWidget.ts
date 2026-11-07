export type TimelineVariant = "records" | "milestones" | "weeks";
export interface LiveWidgetConfig {
  type: "elapsed" | "timeline" | "important";
  basis?: "start" | "recent";
  variant?: TimelineVariant;
  weeks?: 0 | 4 | 8 | 12;
  milestoneEntryIds?: string[];
}
export interface LiveEntry {
  id: string;
  date: string;
  text: string;
  dueDate: string | null;
  doneAt: string | null;
}
export interface LiveSnapshot {
  categoryId: string;
  title: string;
  today: string;
  start: string | null;
  recent: string | null;
  records: LiveEntry[];
  selected: LiveEntry[];
  important: LiveEntry[];
  recordCount: number;
  importantCount: number;
  weeks: { weekId: string; count: number; date: string; text: string; entryId: string }[];
}
export function parseWidget(value: unknown): LiveWidgetConfig | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  if (!["elapsed", "timeline", "important"].includes(String(v.type))) return;
  const ids = Array.isArray(v.milestoneEntryIds)
    ? [
        ...new Set(
          v.milestoneEntryIds.filter(
            (id): id is string => typeof id === "string" && id.length > 0 && id.length <= 64,
          ),
        ),
      ].slice(0, 200)
    : [];
  return {
    type: v.type as LiveWidgetConfig["type"],
    basis: v.basis === "recent" ? "recent" : "start",
    variant: ["milestones", "weeks"].includes(String(v.variant)) ? (v.variant as TimelineVariant) : "records",
    weeks: [0, 4, 8, 12].includes(Number(v.weeks)) ? (Number(v.weeks) as LiveWidgetConfig["weeks"]) : 8,
    milestoneEntryIds: ids,
  };
}
export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function calendarDays(from: string, to: string) {
  const ordinal = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!) / 86400000;
  };
  return ordinal(to) - ordinal(from);
}
