import { isAllowedProjectRef } from "../v2-cloud/cloud-environment.mjs";
import { createSupabaseRest } from "./supabase-rest.mjs";
import { createSessionVerifier } from "../v2-auth/session-adapter.mjs";
import { createPostgresMetadata } from "./postgres-metadata.mjs";
import { createGateway } from "./gateway.mjs";
import { createRecoveryWorker } from "./recovery.mjs";

// Server-only composition. Does not read env, fetch JWKS, listen or deploy.
// Management PATs must never be substituted for this explicit runtime credential.
export function createDevelopmentGateway({ projectRef, serviceRoleKey, jwks, fetchTransport, bucket }) {
  // G-3(97): 개발·운영 허용 목록 — 그 밖의 프로젝트는 거절
  if (!isAllowedProjectRef(projectRef)) throw new TypeError("Allowed project required");
  // G-4(97): 새 비밀 키(sb_secret_, apikey 머리만) 또는 바꾸는 동안의 예전 service_role JWT — 종류 판단은 io.mjs 한 곳
  if (typeof serviceRoleKey === "string" && serviceRoleKey.startsWith("sbp_"))
    throw new TypeError("Management PAT is not a gateway runtime credential");
  const rest = createSupabaseRest({ projectRef, serviceRoleKey, fetchTransport, bucket });
  const verifyAccessToken = createSessionVerifier({ projectRef, jwks, callServerRpc: rest.callServerRpc });
  const metadata = createPostgresMetadata({ callServerRpc: rest.callServerRpc });
  return Object.freeze({
    handler: createGateway({ verifyAccessToken, metadata, storage: rest.storage }),
    recovery: createRecoveryWorker({
      metadata,
      storage: rest.storage,
      callServerRpc: rest.callServerRpc,
      verifyAccessToken,
    }),
  });
}
