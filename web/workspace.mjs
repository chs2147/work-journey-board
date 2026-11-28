/* global Buffer */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { WebError } from "./upstream.mjs";
import { isLibraryView, libraryHas, noteImage, projectLibraryRecord } from "./materials.mjs";

const recordKey = /^[a-f0-9]{64}$/;
const sequence = /^(0|[1-9][0-9]{0,17})$/;
const tableName = /^[a-z_]{1,40}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const allowed = new Map([
  ["category", ["id", "name", "color", "sort_order"]],
  ["tag", ["id", "name"]],
  ["category_tag", ["category_id", "tag_id"]],
  ["kanban_section", ["id", "name", "color", "sort_order"]],
  ["day_memo", ["date", "text"]],
  ["weekly_summary", ["week_id", "edited_text", "ai_text"]],
  [
    "entry_item",
    [
      "id",
      "date",
      "category_id",
      "seq",
      "depth",
      "text",
      "flagged",
      "flag_done_at",
      "due_date",
      "start_time",
      "kanban_section_id",
    ],
  ],
]);

export const workspaceIdPattern = "[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}";
export const workspaceViews = "day|week|kanban|search|summary|notes|cabinet|more";
const invalid = () => new WebError("INVALID_REQUEST", 400);
const invalidUpstream = () => new WebError("WORKSPACE_UNAVAILABLE", 503);

export function createWorkspaceAccess(upstream, secret) {
  const key = Buffer.from(hkdfSync("sha256", secret, "", "wj-web-entry-edit-v1", 32));
  const context = (session, id, purpose) => Buffer.from(session.accountId + "/" + id + purpose);

  function seal(session, id, value, purpose = "") {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(context(session, id, purpose));
    const bytes = Buffer.from(JSON.stringify(value));
    return Buffer.concat([iv, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]).toString(
      "base64url",
    );
  }

  function open(session, id, token, purpose = "") {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{50,20000}$/.test(token)) throw invalid();
    try {
      const bytes = Buffer.from(token, "base64url");
      const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decipher.setAAD(context(session, id, purpose));
      decipher.setAuthTag(bytes.subarray(-16));
      const opened = Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]);
      return JSON.parse(opened);
    } catch {
      throw invalid();
    }
  }

  function project(record, session, id, rev, view) {
    if (!record || !recordKey.test(record.key)) throw invalidUpstream();
    const fields = allowed.get(record.table);
    const settings = record.table === "app_meta";
    if (view ? !libraryHas(view, record.table) : !fields && !settings) return null;
    const result = { key: record.key, table: record.table, value: null };
    if (record.value === null) return result;
    if (!record.value || typeof record.value !== "object" || Array.isArray(record.value))
      throw invalidUpstream();
    if (record.table === "note_asset") {
      const image = noteImage(record.value);
      if (!image) return result;
      const { id: imageId, weekId, ...content } = image;
      result.value = { id: imageId, weekId, token: seal(session, id, content, "/note-image") };
      return result;
    }
    if (view && !fields) {
      result.value = projectLibraryRecord(record.table, record.value);
      return result;
    }
    if (settings) {
      if (record.value.key !== "settings") return null;
      let order;
      try {
        order = JSON.parse(record.value.value).ui?.kanbanColumns?.order;
      } catch {
        order = [];
      }
      result.value = {
        order: Array.isArray(order) ? order.filter((x) => typeof x === "string").slice(0, 20) : [],
      };
      return result;
    }
    result.value = Object.fromEntries(
      fields
        .filter((field) => Object.hasOwn(record.value, field))
        .map((field) => [field, record.value[field]]),
    );
    if (record.table === "entry_item" && Number.isSafeInteger(rev) && rev >= 0) {
      result.edit = seal(session, id, { key: record.key, value: record.value, rev });
    }
    return result;
  }

  async function header(session, id) {
    const info = await upstream.header(session, id);
    if (info.workspaceId !== id || !recordKey.test(info.manifestHash)) throw invalidUpstream();
    const schema = info.header?.sourceSchema;
    if (!Number.isInteger(schema) || schema < 1 || schema > 20) throw new WebError("UNSUPPORTED_SCHEMA", 409);
    return { schema, manifest: info.manifestHash };
  }

  return {
    async noteImage(session, id, token, signal) {
      let asset;
      try {
        asset = open(session, id, token, "/note-image");
      } catch {
        throw new WebError("ASSET_NOT_FOUND", 404);
      }
      const response = await upstream.readAsset(session, id, asset.objectId, signal);
      return { ...asset, response };
    },
    async open(session, id) {
      const info = await header(session, id);
      const spaces = await upstream.list(session);
      const space = spaces.find((s) => s.id === id);
      if (!space) throw new WebError("SPACE_NOT_FOUND", 404);
      return { ...info, name: space.name };
    },
    async records(session, id, query) {
      const view = query.get("view");
      const manifest = query.get("manifest");
      const table = query.get("table");
      const cursor = query.get("key");
      if (
        !recordKey.test(manifest) ||
        (view !== null && !isLibraryView(view)) ||
        ((table !== null || cursor !== null) &&
          (table === null || !tableName.test(table) || !recordKey.test(cursor)))
      )
        throw invalid();
      const page = await upstream.records(session, id, manifest, table ? [table, cursor] : null);
      if (
        !Array.isArray(page.records) ||
        typeof page.more !== "boolean" ||
        (page.more &&
          (!Array.isArray(page.next) ||
            !tableName.test(page.next[0]) ||
            !recordKey.test(page.next[1]) ||
            (page.next[0] === table && page.next[1] === cursor)))
      )
        throw invalidUpstream();
      return {
        records: page.records.map((row) => project(row, session, id, 0, view)).filter(Boolean),
        next: page.more ? page.next : null,
      };
    },
    async changes(session, id, query) {
      const view = query.get("view");
      const after = query.get("after");
      if (!sequence.test(after) || (view !== null && !isLibraryView(view))) throw invalid();
      const page = await upstream.pull(session, id, after);
      if (
        !Array.isArray(page.changes) ||
        typeof page.more !== "boolean" ||
        !sequence.test(page.next) ||
        BigInt(page.next) < BigInt(after) ||
        (page.more && page.next === after)
      )
        throw invalidUpstream();
      return {
        records: page.changes.map((row) => project(row, session, id, row.rev, view)).filter(Boolean),
        next: page.next,
        more: page.more,
      };
    },
    async moveCard(session, id, payload) {
      const { opId, to, edit } = payload;
      if (
        typeof opId !== "string" ||
        !uuid.test(opId) ||
        typeof to !== "string" ||
        !to ||
        [...to].length > 64
      )
        throw invalid();
      const base = open(session, id, edit);
      if (base.value?.depth !== 0) throw invalid();
      const result = await upstream.moveCard(session, id, opId, base.key, base.rev, to);
      if (result.applied === false) throw new WebError("ENTRY_CONFLICT", 409);
      if (result.applied !== true) throw invalidUpstream();
      return { saved: true };
    },
    async saveText(session, id, payload) {
      const { opId, text, edit, editedAt } = payload;
      const normalized = typeof text === "string" ? text.trim() : "";
      const at = typeof editedAt === "string" ? Date.parse(editedAt) : NaN;
      if (
        !uuid.test(opId) ||
        !normalized ||
        [...normalized].length > 2000 ||
        !Number.isFinite(at) ||
        new Date(at).toISOString() !== editedAt
      )
        throw invalid();
      const base = open(session, id, edit);
      if ((await header(session, id)).schema !== 20) throw new WebError("READ_ONLY", 403);
      const original = base.value?.text;
      if (typeof original !== "string") throw invalid();
      const updatedAt = new Date(Math.max(at, (Date.parse(base.value.updated_at) || 0) + 1)).toISOString();
      const result = await upstream.pushText(session, id, opId, base.key, base.rev, {
        ...base.value,
        text: normalized,
        updated_at: updatedAt,
      });
      if (result.applied === false) throw new WebError("ENTRY_CONFLICT", 409);
      if (result.applied !== true) throw invalidUpstream();
      return { saved: true };
    },
  };
}
