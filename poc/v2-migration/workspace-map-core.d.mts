export const KANBAN_CTX_REST: Readonly<Record<string, unknown>>;
export const workspaceMapProfile: string;
export const workspaceMapProfiles: Readonly<Record<number, string>>;
export interface MappedRecord {
  table: string;
  key: string;
  value: Record<string, unknown>;
}
export interface MappedAsset {
  objectId: string;
  sha256: string;
  bytes: number;
}
export interface WorkspaceEnvelope {
  profile: string;
  workspaceId: string;
  sourceSchema: number;
  contractFingerprint: string;
  sourceManifestHash: string;
  assets: MappedAsset[];
  records: MappedRecord[];
  tableStats: Record<string, unknown>;
  exclusions: unknown[];
  policies: Record<string, string>;
}
export function createWorkspaceMapper(deps: { hash(value: unknown): string; sectionIconIds: Set<string> }): {
  mapCopy(
    copy: { manifest: unknown; records: unknown[]; blobs: unknown[] },
    workspaceId: string,
  ): { envelope: WorkspaceEnvelope; mappingHash: string; productActivationAllowed: false };
};
