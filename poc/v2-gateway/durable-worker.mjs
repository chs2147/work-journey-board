// Local integration worker. Starts only when forked with explicit IPC configuration.
import process from "node:process";
import { createGateway } from "./gateway.mjs";
import { createPostgresMetadata } from "./postgres-metadata.mjs";
import { createSupabaseRest } from "./supabase-rest.mjs";
import { createNodeServer } from "./node-server.mjs";
import { createSessionVerifier } from "../v2-auth/session-adapter.mjs";
import { once } from "node:events";
import { URL } from "node:url";
import { createRecoveryWorker } from "./recovery.mjs";
let recovery;
let resume;
process.on("message", async (message) => {
  if (["recovery-preview", "recovery-apply"].includes(message.type)) {
    try {
      const method = message.type === "recovery-preview" ? "preview" : "apply";
      const result = await recovery[method](message.input);
      process.send({ type: "recovery-result", id: message.id, result });
    } catch (e) {
      process.send({
        type: "recovery-result",
        id: message.id,
        error: { code: e.code || "RECOVERY_UNAVAILABLE" },
      });
    }
    return;
  }
  if (message.type === "resume") {
    resume?.();
    resume = null;
    return;
  }
  if (message.type !== "start") return;
  const config = message.config;
  const local = new URL(config.providerURL);
  if (local.hostname !== "127.0.0.1" || local.protocol !== "http:") throw new Error("Local fixture required");
  const rest = createSupabaseRest({
    projectRef: "hutqsfftioxtredcjhsy",
    serviceRoleKey: config.key,
    fetchTransport: (url, options) => {
      if (url.origin !== "https://hutqsfftioxtredcjhsy.supabase.co") throw new Error("Unexpected target");
      return globalThis.fetch(local.origin + url.pathname, options);
    },
  });
  async function pause(phase) {
    if (config.pause !== phase) return;
    process.send({ type: "paused", phase });
    await new Promise((resolve) => {
      resume = resolve;
    });
  }
  const base = rest.storage;
  const storage = {
    ...base,
    async putIfAbsent(scope, bytes) {
      await pause("before-put");
      await base.putIfAbsent(scope, bytes);
      await pause("after-put");
    },
    async remove(scope) {
      await pause("before-delete");
      await base.remove(scope);
      await pause("after-delete");
    },
  };
  const metadata = createPostgresMetadata({ callServerRpc: rest.callServerRpc });
  recovery = createRecoveryWorker({
    metadata,
    storage,
    callServerRpc: rest.callServerRpc,
    verifyAccessToken: createSessionVerifier({
      projectRef: "hutqsfftioxtredcjhsy",
      jwks: config.jwks,
      callServerRpc: rest.callServerRpc,
    }),
  });
  const server = createNodeServer(
    createGateway({
      metadata,
      storage,
      verifyAccessToken: createSessionVerifier({
        projectRef: "hutqsfftioxtredcjhsy",
        jwks: config.jwks,
        callServerRpc: rest.callServerRpc,
      }),
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  process.send({ type: "ready", port: server.address().port });
});
