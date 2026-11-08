import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AuthError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// PoC only: JWKS is supplied by trusted server configuration, never a token URL.
// The caller must implement live session checks. No network requests occur here.
export function createVerifier({ projectRef, jwks, sessionIsActive }) {
  if (!/^[a-z]{20}$/.test(projectRef) || typeof sessionIsActive !== "function") {
    throw new TypeError("Invalid trusted auth configuration");
  }
  const keys = globalThis.structuredClone(jwks?.keys);
  if (
    !Array.isArray(keys) ||
    keys.length === 0 ||
    keys.some(
      (key) =>
        key.kty !== "EC" ||
        key.crv !== "P-256" ||
        key.alg !== "ES256" ||
        typeof key.kid !== "string" ||
        !key.kid ||
        key.d !== undefined ||
        (key.use !== undefined && key.use !== "sig"),
    ) ||
    new Set(keys.map((key) => key.kid)).size !== keys.length
  ) {
    throw new TypeError("Invalid public ES256 key set");
  }
  const keySet = createLocalJWKSet({ keys });
  const issuer = `https://${projectRef}.supabase.co/auth/v1`;
  return async function verifyAccessToken(token, { now = new Date() } = {}) {
    let payload;
    try {
      if (typeof token !== "string" || token.length > 16384) throw new Error();
      const header = decodeProtectedHeader(token);
      if (
        header.alg !== "ES256" ||
        typeof header.kid !== "string" ||
        header.jku !== undefined ||
        header.jwk !== undefined ||
        header.x5u !== undefined
      ) {
        throw new Error();
      }
      ({ payload } = await jwtVerify(token, keySet, {
        algorithms: ["ES256"],
        issuer,
        audience: "authenticated",
        typ: "JWT",
        requiredClaims: ["sub", "session_id", "role", "iat", "exp"],
        maxTokenAge: "1h",
        clockTolerance: 0,
        currentDate: now,
      }));
      if (
        payload.role !== "authenticated" ||
        !uuid.test(payload.sub) ||
        typeof payload.session_id !== "string" ||
        !uuid.test(payload.session_id) ||
        payload.exp <= payload.iat ||
        payload.exp - payload.iat > 3600 ||
        payload.is_anonymous === true
      )
        throw new Error();
    } catch {
      throw new AuthError("AUTH_REQUIRED");
    }
    const principal = Object.freeze({
      userId: payload.sub.toLowerCase(),
      sessionId: payload.session_id.toLowerCase(),
      expiresAt: payload.exp,
      role: "authenticated",
    });
    let active;
    try {
      active = await sessionIsActive(principal);
    } catch {
      throw new AuthError("AUTH_UNAVAILABLE");
    }
    if (active !== true) throw new AuthError("ACCESS_REVOKED");
    return principal;
  };
}
