import { CLOUD_TARGETS } from "../v2-cloud/cloud-environment.mjs";
import { createSupabaseRest } from "./supabase-rest.mjs";
import { createSessionVerifier } from "../v2-auth/session-adapter.mjs";
import { createPostgresMetadata } from "./postgres-metadata.mjs";
import { createGateway } from "./gateway.mjs";
import { createRecoveryWorker } from "./recovery.mjs";

// Server-only composition. Does not read env, fetch JWKS, listen or deploy.
// Management PATs must never be substituted for this explicit runtime credential.
export function createDevelopmentGateway({ projectRef, serviceRoleKey, jwks, fetchTransport }) {
  if (projectRef !== CLOUD_TARGETS.development.projectRef)
    throw new TypeError("Development project required");
  if (typeof serviceRoleKey === "string" && serviceRoleKey.startsWith("sb_secret_"))
    throw new TypeError(
      "This adapter requires the legacy service_role JWT; modern secret-key transport is not verified",
    );
  if (typeof serviceRoleKey === "string" && serviceRoleKey.startsWith("sbp_"))
    throw new TypeError("Management PAT is not a gateway runtime credential");
  const rest = createSupabaseRest({ projectRef, serviceRoleKey, fetchTransport });
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
