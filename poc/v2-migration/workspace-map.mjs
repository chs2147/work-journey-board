// DB18/19/20 -> online metadata envelope. Never reads/writes the original DB.
// Node 껍데기: 사본 폴더 검사(connected-copy) + 아이콘 목록 읽기 → 순수 핵심 workspace-map-core.mjs
import { readFileSync } from "node:fs";
import { inspectConnectedCopy } from "../v2-assets/connected-copy.mjs";
import { hash } from "../v2-sync/model.mjs";
import { createWorkspaceMapper } from "./workspace-map-core.mjs";
export { workspaceMapProfile, workspaceMapProfiles } from "./workspace-map-core.mjs";

// DB20 kanban: section icons are the product's generated Fluent set (read as code resource, not user data).
const sectionIconIds = new Set(
  [
    ...readFileSync(new URL("../../src/shared/sectionIcons.ts", import.meta.url), "utf8").matchAll(
      /"id": "([a-z0-9-]+)"/g,
    ),
  ].map((m) => m[1]),
);
const mapper = createWorkspaceMapper({ hash, sectionIconIds });
export function mapWorkspace(directory, workspaceId) {
  return mapper.mapCopy(inspectConnectedCopy(directory, workspaceId), workspaceId);
}
