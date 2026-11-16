// gateway 기기 등록 거절 이유 전달(docs/v2-design/94): 다른 계정의 기기 ID면 앱이 새 ID로 다시 등록할 수 있게
import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseRest } from "./supabase-rest.mjs";

const U = "11111111-1111-4111-8111-111111111111",
  S = "22222222-2222-4222-8222-222222222222",
  D = "33333333-3333-4333-8333-333333333333";
const rest = (status, body) =>
  createSupabaseRest({
    projectRef: "vsphftnmfzfoufasjttd",
    serviceRoleKey: "eyJtest",
    fetchTransport: async () => new Response(JSON.stringify(body), { status }),
  });

test("device register refusal reasons pass through; anything else stays unavailable", async () => {
  for (const [msg, status] of [
    ["DEVICE_ACCESS_DENIED", 403],
    ["DEVICE_REVOKED", 403],
    ["DEVICE_LIMIT", 409],
  ])
    await assert.rejects(
      rest(400, { code: "P0001", message: msg }).callServerRpc("wjb_v2_device_register", {
        p_user: U,
        p_session: S,
        p_device: D,
      }),
      (e) => e.code === msg && e.status === status,
    );
  await assert.rejects(
    rest(500, { message: "secret detail" }).callServerRpc("wjb_v2_device_register", {
      p_user: U,
      p_session: S,
      p_device: D,
    }),
    (e) => e.code === "AUTH_UNAVAILABLE" && e.status === 503,
  );
});
