// Loopback-only synthetic review harness, not a production HTTP/native backend.
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fixture18 } from "../v2-sync/fixture18.mjs";
import { openWorkspaceRegistry } from "./workspace-registry.mjs";
import { createWorkspaceSettingsBridge } from "./workspace-settings-bridge.mjs";
export async function startSettingsReview({ port = 14621 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error("INVALID_PORT");
  const root = mkdtempSync(join(tmpdir(), "wjb-settings-review-")),
    state = join(root, "registry");
  mkdirSync(state);
  writeFileSync(join(state, ".v2-poc-only"), "synthetic");
  const originals = [];
  for (const [dir, name] of [
    ["work", "회사 업무"],
    ["personal", "개인 기록"],
  ]) {
    const path = join(root, dir);
    mkdirSync(path);
    writeFileSync(join(path, ".v2-poc-only"), "synthetic");
    const file = join(path, "source.db");
    fixture18(file);
    const db = new DatabaseSync(file);
    db.exec(
      readFileSync(new URL("../../src/data/migrations/0019_note_delete_lock.sql", import.meta.url), "utf8"),
    );
    db.exec("UPDATE app_meta SET value='19' WHERE key='schema_version'");
    db.close();
    originals.push({ dir: path, name, color: "c1", icon: "briefcase", updatedAt: 1 });
  }
  const hash = () =>
    originals.map((e) =>
      createHash("sha256")
        .update(readFileSync(join(e.dir, "source.db")))
        .digest("hex"),
    );
  const before = hash(),
    registry = openWorkspaceRegistry(join(state, "registry.db"), {
      protectedLocalRoots: originals.map((e) => e.dir),
    });
  const imported = registry.importOffline(originals);
  registry.createOnlineFromOffline({
    name: "회사 업무 · 온라인",
    sourceEntryId: imported[0].entry_id,
    ownerId: "11111111-1111-4111-8111-111111111111",
    cloudWorkspaceId: randomUUID(),
  });
  let saveFailure = false;
  const bridge = createWorkspaceSettingsBridge({
    registry,
    getAccountContext: () => ({ ownerId: "11111111-1111-4111-8111-111111111111", revision: 1 }),
    adapters: {
      openOffline: async ({ originalDirectory }) => {
        const db = new DatabaseSync(join(originalDirectory, "source.db"), { readOnly: true });
        return { close: async () => db.close() };
      },
      verifyActivation: async () => ({ status: "poc-verified" }),
      openOnline: async () => {
        throw Error("PRODUCT_ACTIVATION_REQUIRED");
      },
    },
    lifecycle: {
      flushPending: async () => {
        if (saveFailure) throw Error("synthetic save failure");
      },
      finishNote: async () => {},
      backupBeforeClose: async () => {},
      detachAll: async () => {},
      attach: () => {},
    },
  });
  const routes = new Map([
    ["/", ["../../docs/v2-design/mockups/step6-settings/index.html", "text/html; charset=utf-8"]],
    [
      "/settings.css",
      ["../../docs/v2-design/mockups/step6-settings/settings.css", "text/css; charset=utf-8"],
    ],
    [
      "/settings-ui.mjs",
      ["../../docs/v2-design/mockups/step6-settings/settings-ui.mjs", "text/javascript; charset=utf-8"],
    ],
    [
      "/workspace-settings-controller.mjs",
      ["./workspace-settings-controller.mjs", "text/javascript; charset=utf-8"],
    ],
    ["/workspace-kind.mjs", ["./workspace-kind.mjs", "text/javascript; charset=utf-8"]],
  ]);
  let origin;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    const send = (status, body, type = "application/json") => {
      res.writeHead(status, { "Content-Type": type });
      res.end(body);
    };
    if (req.headers.host !== new URL(origin).host) return send(403, "{}");
    if (req.method === "GET" && routes.has(req.url)) {
      const [path, type] = routes.get(req.url);
      return send(200, readFileSync(new URL(path, import.meta.url)), type);
    }
    if (req.method !== "POST" || !["/api/workspace", "/api/scenario"].includes(req.url))
      return send(404, "{}");
    if (req.headers.origin !== origin || req.headers["content-type"] !== "application/json")
      return send(403, "{}");
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 4096) {
          send(413, "{}");
          return;
        }
      }
      const input = JSON.parse(body);
      if (req.url === "/api/scenario") {
        if (!input || Object.keys(input).length !== 1 || !["normal", "save-failure"].includes(input.scenario))
          return send(400, "{}");
        saveFailure = input.scenario === "save-failure";
        return send(200, JSON.stringify({ ok: true }));
      }
      if (!input || Object.keys(input).some((k) => !["command", "payload"].includes(k)))
        return send(400, "{}");
      return send(200, JSON.stringify(await bridge.request(input.command, input.payload)));
    } catch {
      return send(400, "{}");
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  } catch (e) {
    registry.close();
    rmSync(root, { recursive: true, force: true });
    throw e;
  }
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    url: origin,
    async close() {
      saveFailure = false;
      await new Promise((resolve) => server.close(resolve));
      await bridge.request("deactivate");
      const unchanged = JSON.stringify(before) === JSON.stringify(hash());
      registry.close();
      rmSync(root, { recursive: true, force: true });
      if (!unchanged) throw Error("SYNTHETIC_SOURCE_CHANGED");
      return { sourceUnchanged: true };
    },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const review = await startSettingsReview();
  process.stdout.write(review.url + "\n");
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await review.close();
      process.exit(0);
    });
}
