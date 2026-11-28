/* global document */
function element(tag, text = "", className = "") {
  const el = document.createElement(tag);
  el.textContent = text;
  el.className = className;
  return el;
}

function externalLink(url) {
  const link = element("a", "링크 열기", "journal-tool-link");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

export function renderNotes(weekId, note, memos) {
  const host = element("section", "", "note-cards");
  host.setAttribute("aria-label", weekId + " 주간 메모");
  if (note && note.boxes === null) {
    host.append(element("p", "이 형식의 메모는 데스크탑 앱에서 확인할 수 있습니다.", "week-empty"));
    return host;
  }
  const boxes = note?.boxes ?? memos.map(({ date, text }) => ({ kind: "text", title: date, body: text }));
  if (!boxes.length) host.append(element("p", "이번 주에 표시할 메모가 없습니다.", "week-empty"));
  for (const box of boxes) {
    const card = element("article", "", "note-card");
    if (box.background) card.dataset.noteBackground = box.background;
    if (box.kind === "text") {
      if (box.title) card.append(element("h2", box.title));
      card.append(element("p", box.body, "summary-text"));
    } else if (box.kind === "link") {
      card.append(element("h2", box.title || "링크"));
      if (box.body) card.append(element("p", box.body, "summary-text"));
      if (box.url) card.append(externalLink(box.url));
      else card.append(element("p", "웹에서 열 수 있는 주소가 없습니다.", "record-meta"));
    } else if (box.kind === "image") {
      card.append(element("h2", "이미지"));
      if (box.caption) card.append(element("p", box.caption, "summary-text"));
      card.append(element("p", "이미지는 데스크탑 앱에서 볼 수 있습니다.", "record-meta"));
    } else {
      if (box.body) card.append(element("p", box.body, "summary-text"));
      card.append(element("p", "이 메모 객체는 데스크탑 앱에서 볼 수 있습니다.", "record-meta"));
    }
    host.append(card);
  }
  return host;
}

const kinds = { note: "업무노트", folder: "폴더", link: "링크" };

export function renderCabinet({ notes, materials, bindings, categories, key, split, select }) {
  const noteItems = notes.map((row) => ({
    ...row,
    kind: "note",
    categories: [categories.get(row.value.category_id)].filter(Boolean),
  }));
  const linked = new Map();
  for (const { value } of bindings) {
    const category = categories.get(value.category_id);
    if (!category) continue;
    if (!linked.has(value.item_id)) linked.set(value.item_id, new Set());
    linked.get(value.item_id).add(category);
  }
  const resources = materials
    .filter(({ value }) => value.kind === "folder" || value.kind === "link")
    .map((row) => ({ ...row, kind: row.value.kind, categories: [...(linked.get(row.value.id) ?? [])] }));
  const all = [...noteItems, ...resources];
  const chosen = all.find((item) => item.key === key) ?? (split ? all[0] : undefined);
  const layout = element("div", "", "materials-layout");
  layout.dataset.detail = String(Boolean(chosen));
  const list = element("div", "", "material-list");
  for (const [name, entries] of [
    ["업무노트", noteItems],
    ["폴더·링크", resources],
  ]) {
    const group = element("section", "", "material-group");
    group.append(element("h2", name));
    if (!entries.length) group.append(element("p", "등록된 자료가 없습니다.", "record-meta"));
    for (const item of entries) {
      const category = item.categories[0];
      const button = element("button", "", "material-row work-stripe");
      button.type = "button";
      button.dataset.materialKey = item.key;
      if (category?.color) button.dataset.workColor = category.color;
      button.setAttribute("aria-pressed", String(item === chosen));
      button.append(element("span", item.value.title || kinds[item.kind]));
      const names = item.categories.map((category) => category.name).filter(Boolean);
      const label = [kinds[item.kind], ...names].join(" · ");
      button.append(element("small", label, "record-meta"));
      button.addEventListener("click", () => select(item.key));
      group.append(button);
    }
    list.append(group);
  }
  layout.append(list);
  if (chosen) {
    const detail = element("section", "", "material-detail");
    detail.setAttribute("aria-label", "선택한 자료");
    detail.tabIndex = -1;
    const back = element("button", "자료 목록", "quiet material-back");
    back.type = "button";
    back.addEventListener("click", () => select(null, chosen.key));
    detail.append(back, element("h2", chosen.value.title || kinds[chosen.kind]));
    if (chosen.kind === "note") {
      const date = chosen.value.updated_at?.slice(0, 10);
      if (date) detail.append(element("p", "최근 수정 · " + date, "record-meta"));
      detail.append(element("p", chosen.value.text || "표시할 본문이 없습니다.", "summary-text"));
    } else if (chosen.kind === "folder") {
      detail.append(element("p", "연결된 폴더는 해당 데스크탑 앱에서 열 수 있습니다."));
    } else if (chosen.value.url) detail.append(externalLink(chosen.value.url));
    else detail.append(element("p", "웹에서 열 수 있는 주소가 없습니다."));
    layout.append(detail);
  }
  return layout;
}
