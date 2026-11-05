// 백업 파일 하나에 생성 앱·실제 DB 구조를 함께 기록한다. 파일명은 표시 정보이며 복원 전 실제 DB를 검사한다.
import pkg from "../../package.json" with { type: "json" };
import { localDate } from "../domain/localTime";

export const BACKUP_APP_VERSION = pkg.version;
export type BackupKind =
  "daily" | "monthly" | "manual" | "pre-migration" | "pre-update" | "pre-import" | "before-restore";
export interface BackupIdentity {
  name: string;
  date: string;
  when: string;
  sortKey: string;
  kind: BackupKind;
  appVersion: string | null;
  schemaVersion: number | null;
  legacy: boolean;
}
const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export const validBackupAppVersion = (s: string) =>
  semver.test(s) &&
  (!s.includes("-") ||
    s
      .split("+")[0]!
      .split("-")
      .slice(1)
      .join("-")
      .split(".")
      .every((x) => !/^\d+$/.test(x) || x === "0" || !x.startsWith("0")));
export function validBackupDate(s: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number(s.slice(0, 4)) > 0 &&
    !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
    new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s
  );
}
export function parseBackupName(name: string): BackupIdentity | null {
  if (/[\r\n\\/\0]/.test(name)) return null;
  const n =
    /^work-journey_(\d{4}-\d{2}-\d{2})_(\d{9})_(daily|monthly|manual|pre-migration-to-v[1-9]\d*|pre-update|pre-import|before-restore)_app-v(.+)_db-v([1-9]\d*|unknown)(?:_c([1-9]\d*))?\.db$/.exec(
      name,
    );
  if (n) {
    const date = n[1]!,
      time = n[2]!,
      tag = n[3]!,
      app = n[4]!,
      schema = n[5]!;
    if (
      !validBackupDate(date) ||
      !validBackupAppVersion(app) ||
      +time.slice(0, 2) > 23 ||
      +time.slice(2, 4) > 59 ||
      +time.slice(4, 6) > 59 ||
      (schema === "unknown" && tag !== "before-restore") ||
      (schema !== "unknown" && !Number.isSafeInteger(+schema))
    )
      return null;
    return {
      name,
      date,
      when: `${date} ${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`,
      sortKey: `${date}_${time}_${name}`,
      kind: tag.startsWith("pre-migration") ? "pre-migration" : (tag as BackupKind),
      appVersion: app,
      schemaVersion: schema === "unknown" ? null : +schema,
      legacy: false,
    };
  }
  const old =
    /^work-journey_(\d{4}-\d{2})(?:-(\d{2}))?(?:_(\d{2})(\d{2}))?(?:_(monthly|manual|pre-migration-v\d+|before-restore|pre-import|pre-update))?\.db$/.exec(
      name,
    );
  if (!old) return null;
  const [, ym, d, hh, mm, tag] = old;
  const date = `${ym}-${d ?? "01"}`;
  if (!validBackupDate(date) || (hh && (+hh > 23 || +mm! > 59))) return null;
  return {
    name,
    date,
    when: `${ym}${d ? `-${d}` : ""}${hh ? ` ${hh}:${mm}` : ""}`,
    sortKey: `${ym}-${d ?? "00"}_${hh ?? "00"}${mm ?? "00"}00000_${name}`,
    kind: !tag ? "daily" : tag.startsWith("pre-migration") ? "pre-migration" : (tag as BackupKind),
    appVersion: null,
    schemaVersion: null,
    legacy: true,
  };
}
export function versionedBackupName(now: Date, kind: BackupKind, schema: number | null, to?: number): string {
  const time =
    [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, "0")).join("") +
    String(now.getMilliseconds()).padStart(3, "0");
  const tag = kind === "pre-migration" ? `pre-migration-to-v${to}` : kind;
  const name = `work-journey_${localDate(now)}_${time}_${tag}_app-v${BACKUP_APP_VERSION}_db-v${schema ?? "unknown"}.db`;
  if (!parseBackupName(name)) throw new Error("백업 버전 정보를 확인하지 못했습니다");
  return name;
}
export const protectedBackup = (kind: BackupKind) => kind !== "daily" && kind !== "monthly";
