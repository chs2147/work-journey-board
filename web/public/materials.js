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

function noteImage(card, src, caption) {
  const fallback = element("div", "", "note-image-state");
  const message = element("p", "첨부 정보를 찾을 수 없습니다.", "record-meta");
  message.setAttribute("role", "status");
  fallback.append(message);
  card.append(fallback);
  if (!src) return;

  const retry = element("button", "이미지 다시 불러오기", "quiet");
  retry.type = "button";
  fallback.append(retry);
  fallback.hidden = true;

  function load(retrying) {
    const img = element("img", "", "note-image");
    img.alt = caption || "주간 메모 첨부 이미지";
    if (!retrying) img.loading = "lazy";
    if (retrying) {
      retry.disabled = true;
      message.textContent = "이미지를 다시 불러오는 중입니다.";
    }
    img.addEventListener(
      "load",
      () => {
        fallback.hidden = true;
        if (retrying) card.querySelector("h2")?.focus();
      },
      { once: true },
    );
    img.addEventListener(
      "error",
      () => {
        img.remove();
        message.textContent = "이미지를 불러올 수 없습니다.";
        retry.disabled = false;
        fallback.hidden = false;
        if (retrying) retry.focus();
      },
      { once: true },
    );
    img.src = src;
    card.insertBefore(img, fallback);
  }

  retry.addEventListener("click", () => load(true));
  load(false);
}

export function renderNotes(weekId, note, memos, images) {
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
      const title = element("h2", "이미지");
      title.tabIndex = -1;
      card.append(title);
      noteImage(card, images.get(box.imageId), box.caption);
      if (box.caption) card.append(element("p", box.caption, "summary-text"));
    } else {
      if (box.body) card.append(element("p", box.body, "summary-text"));
      card.append(element("p", "이 메모 객체는 데스크탑 앱에서 볼 수 있습니다.", "record-meta"));
    }
    host.append(card);
  }
  return host;
}

const kinds = { note: "업무노트", folder: "폴더", link: "링크" };

export function cabinetEntries({ notes, materials, bindings, categories }) {
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
  return [...noteItems, ...resources];
}

export function renderCabinet(entries, key, select) {
  const list = element("div", "", "material-list");
  for (const [name, groupEntries] of [
    ["업무노트", entries.filter((item) => item.kind === "note")],
    ["폴더·링크", entries.filter((item) => item.kind !== "note")],
  ]) {
    if (!groupEntries.length) continue;
    const group = element("section", "", "material-group");
    group.append(element("h2", name));
    for (const item of groupEntries) {
      const category = item.categories[0];
      const button = element("button", "", "material-row work-stripe");
      button.type = "button";
      button.dataset.recordKey = item.key;
      if (category?.color) button.dataset.workColor = category.color;
      button.setAttribute("aria-pressed", String(item.key === key));
      button.append(element("span", item.value.title || kinds[item.kind]));
      const names = item.categories.map((category) => category.name).filter(Boolean);
      const label = [kinds[item.kind], ...names].join(" · ");
      button.append(element("small", label, "record-meta"));
      button.addEventListener("click", () => select(item.key));
      group.append(button);
    }
    list.append(group);
  }
  return list;
}

export function renderMaterial({ kind, value, categories }) {
  const detail = element("div", "", "material-detail");
  const context = [kinds[kind], ...categories.map(({ name }) => name)].filter(Boolean).join(" · ");
  detail.append(element("p", context, "record-meta"), element("h3", value.title || kinds[kind]));
  if (kind === "note") {
    const date = value.updated_at?.slice(0, 10);
    if (date) detail.append(element("p", "최근 수정 · " + date, "record-meta"));
    detail.append(element("p", value.text || "표시할 본문이 없습니다.", "summary-text"));
  } else if (kind === "folder") {
    detail.append(element("p", "연결된 폴더는 해당 데스크탑 앱에서 열 수 있습니다."));
  } else if (value.url) detail.append(externalLink(value.url));
  else detail.append(element("p", "웹에서 열 수 있는 주소가 없습니다."));
  return detail;
}
