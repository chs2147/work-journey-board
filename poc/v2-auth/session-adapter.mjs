import { createVerifier } from "./verifier.mjs";

// callServerRpc must be a trusted server-only transport, never supplied by a client.
// The target project and credential destination are fixed outside request bodies.
export function createSessionVerifier({ projectRef, jwks, callServerRpc }) {
  if (typeof callServerRpc !== "function") throw new TypeError("Server transport required");
  return createVerifier({
    projectRef,
    jwks,
    sessionIsActive: async (principal) => {
      const result = await callServerRpc("wjb_v2_session_active", {
        p_user: principal.userId,
        p_session: principal.sessionId,
      });
      // PostgREST scalar boolean only; false, unknown shapes and errors fail closed.
      return result === true;
    },
  });
}
