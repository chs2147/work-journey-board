export const SUPPORTED_SCHEMAS: readonly number[];
export const COPY_FORMAT: string;
export function noInlineImages(value: unknown, knownPayloads?: string[]): void;
export interface ReadStatement {
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}
export interface ReadDb {
  prepare(sql: string): ReadStatement;
}
export type Rows = Record<string, Record<string, unknown>[]>;
export interface CopyRecord {
  table_name: string;
  ordinal: number;
  value: string;
}
export interface CopyBlob {
  id: string;
  bytes: number;
  object_id: string;
  object_key: string;
}
export interface ExtractedCopy {
  manifest: { sourceSchema: number; sourceRows: Record<string, number>; [k: string]: unknown };
  records: CopyRecord[];
  blobs: CopyBlob[];
  blobBytes: Map<string, Uint8Array>;
  knownPayloads: string[];
}
export interface CopyCore {
  captureRows(
    db: ReadDb,
    options: {
      expectedVersion?: number;
      expectedSchema(version: number): unknown;
      allowNoteImages?: boolean;
    },
  ): Rows;
  extractCopy(
    captured: { sourceHash: string; rows: Rows },
    ids: { workspaceId: string; sourceWorkspaceId: string },
  ): ExtractedCopy;
  schema(db: ReadDb): Record<string, unknown>[];
}
export function createCopyCore(deps: {
  hash(value: unknown): string;
  randomUUID(): string;
  base64ToBytes(text: string): Uint8Array;
  bytesToBase64(bytes: Uint8Array): string;
}): CopyCore;
