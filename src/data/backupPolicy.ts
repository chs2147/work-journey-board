// 파일 작업 없는 보관 계획. 전체 폴더 용량을 기준으로 하되 보호/최신 일일 사본은 삭제하지 않는다.
import { parseBackupName } from "./backupIdentity";
import { localDate } from "../domain/localTime";
export interface BackupPolicy {
  dailyKeep: number;
  monthlyKeep: number;
  periodicHours: number;
  retentionMode: "count" | "days";
  retentionDays: number;
  maxBytes: number | null;
}
export const RECOMMENDED_BACKUP_POLICY: BackupPolicy = {
  dailyKeep: 14,
  monthlyKeep: 12,
  periodicHours: 2,
  retentionMode: "days",
  retentionDays: 30,
  maxBytes: null,
};
export function normalizeBackupPolicy(p: Partial<BackupPolicy> | undefined, legacy = true): BackupPolicy {
  const integer = (v: unknown, def: number, min: number, max: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : def;
  return {
    dailyKeep: integer(p?.dailyKeep, 14, 1, Number.MAX_SAFE_INTEGER),
    monthlyKeep: integer(p?.monthlyKeep, 12, 0, Number.MAX_SAFE_INTEGER),
    periodicHours:
      typeof p?.periodicHours === "number" &&
      Number.isFinite(p.periodicHours) &&
      p.periodicHours >= 0 &&
      p.periodicHours <= 24
        ? p.periodicHours
        : 2,
    retentionMode:
      p?.retentionMode === "days"
        ? "days"
        : p?.retentionMode === "count"
          ? "count"
          : legacy
            ? "count"
            : "days",
    retentionDays: integer(p?.retentionDays, 30, 1, 3650),
    maxBytes:
      typeof p?.maxBytes === "number" &&
      Number.isSafeInteger(p.maxBytes) &&
      p.maxBytes >= 256 * 1024 ** 2 &&
      p.maxBytes <= 100 * 1024 ** 3
        ? p.maxBytes
        : null,
  };
}
export interface BackupFile {
  name: string;
  size: number;
  modified: number | null;
  safe: boolean;
}
export interface CleanupCandidate extends BackupFile {
  reason: "period" | "count" | "monthly" | "capacity" | "slot";
}
export interface CleanupPlan {
  scope?: string;
  files: BackupFile[];
  candidates: CleanupCandidate[];
  bytes: number;
  freed: number;
  after: number;
  protectedCount: number;
  overBudget: boolean;
  fingerprint: string;
}
export function planBackupCleanup(files: BackupFile[], policy: BackupPolicy, now: Date): CleanupPlan {
  const p = normalizeBackupPolicy(policy);
  const sorted = files
    .map((f) => ({ f, b: parseBackupName(f.name) }))
    .filter((x) => x.b)
    .sort((a, b) => a.b!.sortKey.localeCompare(b.b!.sortKey));
  const daily = sorted.filter((x) => x.b!.kind === "daily" && x.f.safe && x.b!.date <= localDate(now)),
    monthly = sorted.filter((x) => x.b!.kind === "monthly" && x.f.safe && x.b!.date <= localDate(now));
  const newest = daily.at(-1)?.f.name;
  const picked = new Map<string, CleanupCandidate>();
  const add = (f: BackupFile, reason: CleanupCandidate["reason"]) => {
    if (f.safe && f.name !== newest && !picked.has(f.name)) picked.set(f.name, { ...f, reason });
  };
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  cutoff.setDate(cutoff.getDate() - p.retentionDays + 1);
  for (let i = 0; i < daily.length; i++) {
    const { f, b } = daily[i]!;
    if (b!.date > localDate(now)) continue;
    if (p.retentionMode === "days" ? b!.date < localDate(cutoff) : i < daily.length - p.dailyKeep)
      add(f, p.retentionMode === "days" ? "period" : "count");
  }
  for (let i = 0; i < monthly.length - p.monthlyKeep; i++)
    if (monthly[i]!.b!.date <= localDate(now)) add(monthly[i]!.f, "monthly");
  const bytes = files.reduce((n, f) => n + f.size, 0);
  let freed = [...picked.values()].reduce((n, f) => n + f.size, 0);
  if (p.maxBytes !== null)
    for (const { f, b } of sorted) {
      if (bytes - freed <= p.maxBytes) break;
      if (
        (b!.kind === "daily" || b!.kind === "monthly") &&
        b!.date <= localDate(now) &&
        !picked.has(f.name)
      ) {
        const count = picked.size;
        add(f, "capacity");
        if (picked.size > count) freed += f.size;
      }
    }
  const candidates = [...picked.values()];
  return {
    files,
    candidates,
    bytes,
    freed,
    after: bytes - freed,
    protectedCount: sorted.filter((x) => x.b!.kind !== "daily" && x.b!.kind !== "monthly").length,
    overBudget: p.maxBytes !== null && bytes - freed > p.maxBytes,
    fingerprint: JSON.stringify(
      files
        .map((f) => [f.name, f.size, f.modified, f.safe])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ),
  };
}
export const sameCleanupPlan = (a: CleanupPlan, b: CleanupPlan) =>
  a.scope === b.scope &&
  a.fingerprint === b.fingerprint &&
  JSON.stringify(a.candidates) === JSON.stringify(b.candidates);
export interface BackupControl {
  paused: boolean;
  pendingPolicy?: BackupPolicy;
  lastCleanup?: { at: string; deleted: number; failed: number; freed: number };
}
