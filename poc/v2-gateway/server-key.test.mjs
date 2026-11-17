// G-4(docs/v2-design/97): 서버 열쇠 종류·보내는 머리·Edge가 고르는 열쇠
import test from "node:test";
import assert from "node:assert/strict";
import { serverKeyHeaders, serverKeyKind } from "./io.mjs";
import { createSupabaseRest } from "./supabase-rest.mjs";
import { runtimeServerKey } from "./edge/wjb-gateway.mjs";

const SECRET = "sb_secret_" + "Ab1_-".repeat(8);
const LEGACY = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig";

test("server key kind: new secret, legacy JWT; management token, publishable, malformed secret, blanks refused", () => {
  assert.equal(serverKeyKind(SECRET), "secret");
  assert.equal(serverKeyKind(LEGACY), "legacy");
  for (const bad of ["", " ", "sbp_abc", "sb_publishable_abc", "sb_secret_short", `${SECRET}\n`, null, 1])
    assert.equal(serverKeyKind(bad), null, String(bad));
});

test("new secret key goes on apikey only (Authorization would be parsed as a JWT); legacy keeps both", () => {
  assert.deepEqual(serverKeyHeaders(SECRET), { apikey: SECRET });
  assert.deepEqual(serverKeyHeaders(LEGACY), { apikey: LEGACY, authorization: `Bearer ${LEGACY}` });
  assert.throws(() => serverKeyHeaders("sbp_x"));
});

test("storage/REST requests with the new key carry no Authorization header", async () => {
  const seen = [];
  const rest = createSupabaseRest({
    projectRef: "vsphftnmfzfoufasjttd",
    serviceRoleKey: SECRET,
    bucket: "wjb-v2-dev-assets",
    fetchTransport: async (url, init) => {
      seen.push(init.headers);
      return new Response(null, { status: 404 });
    },
  });
  await rest.storage
    .get({ workspaceId: crypto.randomUUID(), assetId: crypto.randomUUID() }, 10)
    .catch(() => {});
  assert.equal(seen.length, 1);
  assert.equal(seen[0].apikey, SECRET);
  assert.equal("authorization" in seen[0], false);
});

test("Edge uses only SUPABASE_SECRET_KEYS.wjb_gateway — legacy JWT, default key and anything else refused", () => {
  const env = (vars) => (name) => vars[name];
  assert.deepEqual(
    runtimeServerKey(
      env({
        SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_" + "z".repeat(20), wjb_gateway: SECRET }),
        WJB_GATEWAY_SERVICE_ROLE_JWT: LEGACY,
      }),
    ),
    { key: SECRET, kind: "secret" },
  );
  for (const vars of [
    { WJB_GATEWAY_SERVICE_ROLE_JWT: LEGACY },
    { SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }) },
    { SUPABASE_SECRET_KEYS: JSON.stringify({ wjb_gateway: LEGACY }) },
    { SUPABASE_SECRET_KEYS: "not json" },
    {},
  ])
    assert.throws(() => runtimeServerKey(env(vars)), /RUNTIME_KEY_UNAVAILABLE/);
});
