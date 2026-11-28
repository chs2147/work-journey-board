/* global URL */
const libraryTables = {
  notes: new Set(["week_note", "day_memo"]),
  cabinet: new Set(["category", "cabi_note", "cabinet_item", "cabinet_link"]),
};
const backgrounds = new Set(["yellow", "blue", "green", "pink"]);
const blockNodes = new Set(["paragraph", "heading", "listItem", "taskItem", "tableRow"]);

export const isLibraryView = (value) => Object.hasOwn(libraryTables, value);
export const libraryHas = (view, table) => libraryTables[view]?.has(table) ?? false;

function webUrl(value) {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function json(value) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const text = (value) => (typeof value === "string" ? value : "");

function noteText(node, depth = 0) {
  if (!node || depth > 32) return "";
  if (node.type === "text") return text(node.text);
  if (node.type === "hardBreak") return "\n";
  if (!Array.isArray(node.content)) return "";
  const body = node.content.map((child) => noteText(child, depth + 1)).join("");
  return blockNodes.has(node.type) ? body + "\n" : body;
}

function weekBoxes(source) {
  const doc = json(source);
  if (doc?.v !== 1 || !Array.isArray(doc.boxes)) return null;
  return doc.boxes
    .filter((box) => box && typeof box === "object")
    .sort((a, b) =>
      Math.abs((a.y ?? 0) - (b.y ?? 0)) <= 16 ? (a.x ?? 0) - (b.x ?? 0) : (a.y ?? 0) - (b.y ?? 0),
    )
    .flatMap((box) => {
      if (box.kind === "image") return [{ kind: "image", caption: text(box.caption) }];
      if (box.kind === "link") {
        return [{ kind: "link", title: text(box.title), body: text(box.note), url: webUrl(box.url) }];
      }
      if (box.kind !== "text") return [{ kind: "desktop" }];
      const body = noteText(box.content).trim();
      if (box.widget || box.resource) return [{ kind: "desktop", body }];
      return body ? [{ kind: "text", body, background: backgrounds.has(box.bg) ? box.bg : null }] : [];
    });
}

export function projectLibraryRecord(table, value) {
  if (table === "week_note") return { week_id: value.week_id, boxes: weekBoxes(value.doc) };
  if (table === "cabi_note") {
    const content = json(value.content);
    return {
      id: value.id,
      category_id: value.category_id,
      title: text(value.title),
      text: text(value.plain_text) || noteText(content).trim(),
      updated_at: value.updated_at,
    };
  }
  if (table === "cabinet_item") {
    return {
      id: value.id,
      title: text(value.title),
      kind: value.kind,
      sort_order: value.sort_order,
      url: value.kind === "link" ? webUrl(value.target) : null,
    };
  }
  return { item_id: value.item_id, category_id: value.category_id };
}
