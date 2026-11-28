/* global AbortSignal, URL, fetch, process */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";

if (process.env.VERCEL_ENV === "production") {
  const { default: handler } = await import("./api/index.js");
  const origin = new URL(process.env.WJB_WEB_ORIGIN);
  assert.equal(origin.protocol, "https:");
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const app = `http://127.0.0.1:${server.address().port}`;
    const request = (path, options = {}) =>
      fetch(app + path, {
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
        ...options,
        headers: { host: origin.host, ...options.headers },
      });

    const root = await request("/");
    assert.equal(root.status, 303, "Production entry must lead to the product login");
    assert.equal(root.headers.get("location"), "/login");
    const login = await request("/login");
    assert.equal(login.status, 200);
    assert.match(await login.text(), /인증번호 받기/);
    const wrongOrigin = await request("/api/auth/code", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.invalid" },
      body: "{}",
    });
    assert.equal(wrongOrigin.status, 403);
    assert.deepEqual(await wrongOrigin.json(), { error: "ORIGIN_REQUIRED" });
    const sameOrigin = await request("/api/auth/code", {
      method: "POST",
      headers: { "content-type": "application/json", origin: origin.origin },
      body: JSON.stringify({ email: "production-check@example.invalid", agreed: false }),
    });
    assert.equal(sameOrigin.status, 400, "The configured origin must reach the consent validation");
    assert.deepEqual(await sameOrigin.json(), { error: "CONSENT_REQUIRED" });

    // An unknown session ID exercises the real pooler and the session table without writing data.
    const unknown = randomBytes(32).toString("base64url");
    const spaces = await request("/api/spaces", { headers: { cookie: `__Host-wjb_session=${unknown}` } });
    assert.equal(spaces.status, 401, "Production must reach the database and reject an unknown session");
    assert.deepEqual(await spaces.json(), { error: "SIGN_IN_REQUIRED" });
    process.stdout.write("Production login, origin policy and session database verified.\n");
  } finally {
    server.close();
  }
}
