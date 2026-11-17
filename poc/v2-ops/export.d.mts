import type { MappedAsset, MappedRecord } from "../v2-migration/workspace-map-core.mjs";
export function exportTarget(argv: string[], env: Record<string, string | undefined>): unknown;
export function buildSpace(input: {
  job: { workspace_id: string; manifest_hash: string; created_at?: string | null };
  header: unknown;
  records: MappedRecord[] | { table: string; key: string; value: Record<string, unknown> }[];
  assets: MappedAsset[];
}): {
  header: {
    workspaceId: string;
    manifestHash: string;
    createdAt: string | null;
    header: unknown;
    assets: MappedAsset[];
  };
  records: MappedRecord[];
};
