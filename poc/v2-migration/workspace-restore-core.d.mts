import type { MappedRecord, WorkspaceEnvelope } from "./workspace-map-core.mjs";
export const UNBOUND_FOLDER: string;
export interface WriteDb {
  prepare(sql: string): { all(...p: unknown[]): Record<string, unknown>[]; run(...p: unknown[]): unknown };
  exec(sql: string): unknown;
}
export function createWorkspaceRestorer(deps: {
  hash(value: unknown): string;
  bytesToBase64(bytes: Uint8Array): string;
}): {
  toRows(
    envelope: { header: Omit<WorkspaceEnvelope, "records">; records: MappedRecord[] },
    getAsset: (objectId: string) => Uint8Array | undefined,
  ): Record<string, Record<string, unknown>[]>;
  writeInto(db: WriteDb, rows: Record<string, Record<string, unknown>[]>): void;
};
