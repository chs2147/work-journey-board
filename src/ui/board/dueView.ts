// 마감일 꼬리표·배지 글과 색(improve-1104v10-spec 2-1) — 보드·중요 업무 패널이 같이 쓴다.
import { daysLeft, dueKind, type DueKind } from "../../domain/dueDate";
import { shortDateLabel, type DateStr } from "../../domain/week";
import { STR } from "../../shared/strings";

export function dueView(today: DateStr, due: DateStr): { kind: DueKind; chip: string; short: string } {
  const D = STR.dueDate;
  const md = shortDateLabel(due).replace(" ", "");
  const n = daysLeft(today, due);
  const kind = dueKind(today, due);
  if (kind === "late") return { kind, chip: D.chipLate(md.replace(/\(.*\)$/, ""), -n), short: D.late(-n) };
  if (kind === "today") return { kind, chip: D.chipToday, short: D.today };
  return { kind, chip: D.chip(md, D.left(n)), short: D.left(n) };
}
