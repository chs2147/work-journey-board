/* global document, location, fetch, URL, URLSearchParams, Blob, crypto, addEventListener, BroadcastChannel, setInterval */
const journal = document.querySelector("#journal");
const id = journal.dataset.id;
const view = journal.dataset.view;
const base = "/api/spaces/" + id;
const pick = (name) => document.getElementById(name);
const status = pick("journal-status");
const content = pick("journal-content");
const tools = pick("journal-tools");
const dateInput = pick("journal-date");
const queryInput = pick("journal-search");
const editor = pick("record-editor");
const editorStatus = pick("record-status");
const textInput = pick("record-text");
const refresh = pick("journal-refresh");
const dayFormat = new Intl.DateTimeFormat("ko-KR", {
  weekday: "short",
  month: "numeric",
  day: "numeric",
  timeZone: "UTC",
});
const dateKey = (date) => date.toISOString().slice(0, 10);
const localToday = () => {
  const date = new Date();
  return dateKey(new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())));
};
const shift = (date, amount) => {
  const parsed = new Date(date + "T00:00:00Z");
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return dateKey(parsed);
};
const sessionEvents = typeof BroadcastChannel === "function" ? new BroadcastChannel("wj-web-session") : null;
const keys = new Map();
let active = null;
let cursor = "0";
let loading = false;
let draft = null;
let generation = 0;
let complete = false;
let dirty = false;
let moving = false;
if (dateInput) dateInput.value = localToday();

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function request(path, payload) {
  const response = await fetch(
    base + path,
    payload
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }
      : {},
  );
  const body = await response.json().catch(() => ({}));
  if (response.ok) return body;
  const error = new Error(body.error);
  error.status = response.status;
  throw error;
}

function reset() {
  generation++;
  keys.clear();
  active = null;
  complete = false;
  loading = false;
  dirty = false;
  moving = false;
  refresh.disabled = false;
  cursor = "0";
  draft = null;
  editor.hidden = true;
  textInput.value = "";
  if (queryInput) queryInput.value = "";
  content.replaceChildren();
  tools.hidden = true;
  pick("journal-name").textContent = "워크스페이스";
}

function recover(error) {
  if (error.status === 401) {
    reset();
    location.replace("/login");
  } else if (error.status === 404) {
    reset();
    location.replace("/spaces");
  } else {
    status.textContent =
      error.message === "UNSUPPORTED_SCHEMA"
        ? "이 온라인 공간을 열려면 최신 웹 버전이 필요합니다."
        : "기록을 불러오지 못했습니다. 새로고침으로 다시 시도해 주세요.";
  }
}

function apply(rows) {
  for (const row of rows) {
    const key = row.table + ":" + row.key;
    if (row.value === null) keys.delete(key);
    else keys.set(key, row);
  }
}

async function sync(steps) {
  let more;
  do {
    const page = await request("/changes?after=" + cursor);
    if (steps !== generation) return;
    apply(page.records);
    dirty ||= page.records.length > 0;
    cursor = page.next;
    more = page.more;
  } while (more);
}

async function load(full = false) {
  if (loading || draft || moving) return;
  loading = true;
  refresh.disabled = true;
  const started = ++generation;
  const fromBeginning = full || !complete;
  if (fromBeginning) status.textContent = "온라인 기록을 불러오는 중입니다.";
  else status.textContent = "";
  try {
    if (fromBeginning) {
      complete = false;
      const info = await request("/header");
      if (started !== generation) return;
      active = info;
      pick("journal-name").textContent = active.name;
      keys.clear();
      cursor = "0";
      let next;
      do {
        const params = new URLSearchParams({ manifest: active.manifest });
        if (next) {
          params.set("table", next[0]);
          params.set("key", next[1]);
        }
        const page = await request("/records?" + params);
        if (started !== generation) return;
        apply(page.records);
        next = page.next;
      } while (next);
    }
    await sync(started);
    if (started !== generation) return;
    complete = true;
    tools.hidden = false;
    if (fromBeginning || dirty) render();
    dirty = false;
    status.textContent = "";
  } catch (error) {
    if (started === generation) recover(error);
  } finally {
    if (started === generation) {
      loading = false;
      refresh.disabled = false;
    }
  }
}

function records(table) {
  return [...keys.values()].filter((row) => row.table === table);
}
function selectedDate() {
  return dateInput?.value || localToday();
}
function days() {
  const date = selectedDate();
  const day = new Date(date + "T00:00:00Z").getUTCDay();
  const monday = shift(date, -((day + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => shift(monday, index));
}
function weekId() {
  const thursday = new Date(days()[3] + "T00:00:00Z");
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / 604800000) + 1;
  return year + "-W" + String(week).padStart(2, "0");
}
function itemSort(a, b) {
  return (
    a.value.date.localeCompare(b.value.date) ||
    String(a.value.category_id).localeCompare(String(b.value.category_id)) ||
    Number(a.value.seq) - Number(b.value.seq)
  );
}
function task(item, category, showDate = false, destinations) {
  const value = item.value;
  const li = element("li", "", value.depth > 0 ? "record sub-record" : "record");
  const detail = [showDate && value.date, category, value.start_time, value.flagged ? "중요" : null].filter(
    Boolean,
  );
  if (value.flag_done_at && !value.flagged) detail.push("완료");
  if (detail.length) li.append(element("small", detail.join(" · ")));
  li.append(element("p", String(value.text ?? "")));
  if (value.due_date) {
    const today = localToday();
    const due =
      value.flagged || !value.flag_done_at
        ? value.due_date < today
          ? "기한 초과"
          : value.due_date === today
            ? "오늘 마감"
            : value.due_date <= shift(today, 2)
              ? "마감 임박"
              : ""
        : "";
    li.append(
      element("small", [due, value.due_date].filter(Boolean).join(" · "), due ? "deadline-alert" : ""),
    );
  }
  if (active?.schema === 20 && item.edit) {
    const edit = element("button", "편집", "quiet record-edit");
    edit.type = "button";
    edit.setAttribute("aria-label", "기록 편집 " + String(value.text ?? "").slice(0, 40));
    edit.addEventListener("click", () => openEditor(item));
    li.append(edit);
    if (destinations?.length) li.append(moveControls(item, destinations));
  }
  return li;
}

function group(title, items, names, showDate = false, destinations) {
  const section = element("section", "", "journal-group");
  section.append(element("h2", title));
  if (!items.length) section.append(element("p", "표시할 기록이 없습니다."));
  else {
    const list = element("ul", "", "record-list");
    for (const item of items)
      list.append(task(item, names.get(item.value.category_id), showDate, destinations));
    section.append(list);
  }
  return section;
}

function render() {
  if (!complete || !active) return;
  const names = new Map(records("category").map(({ value }) => [value.id, value.name]));
  const items = records("entry_item")
    .filter(({ value }) => typeof value.date === "string")
    .sort(itemSort);
  const week = days();
  const start = week[0];
  const end = week[6];
  const inWeek = (date) => date >= start && date <= end;
  content.replaceChildren();
  content.className = "";
  if (view === "search") {
    const query = queryInput.value.trim().toLocaleLowerCase();
    if (!query) return;
    const tags = new Map(records("tag").map(({ value }) => [value.id, value.name]));
    const byCategory = new Map();
    for (const { value } of records("category_tag")) {
      const list = byCategory.get(value.category_id) ?? [];
      list.push(tags.get(value.tag_id));
      byCategory.set(value.category_id, list);
    }
    const matches = items.filter(({ value }) =>
      [value.text, names.get(value.category_id), ...(byCategory.get(value.category_id) ?? [])].some(
        (term) => typeof term === "string" && term.toLocaleLowerCase().includes(query),
      ),
    );
    content.append(group("검색 결과 " + matches.length + "건", matches.slice(0, 100), names, true));
    if (matches.length > 100) content.append(element("p", "검색어를 좁혀 추가 기록을 확인해 주세요."));
    return;
  }
  if (view === "summary") {
    const data = summary(items, names);
    content.append(element("h2", data.label), element("p", data.notes, "summary-text"));
    return;
  }
  if (view === "kanban") {
    const sections = records("kanban_section")
      .map(({ value }) => value)
      .sort((a, b) => a.sort_order - b.sort_order);
    const titles = new Map([
      ["todo", "TODO"],
      ...sections.map(({ id, name }) => [id, name]),
      ["done", "DONE"],
    ]);
    const saved = records("app_meta")[0]?.value.order ?? [];
    const order = [...new Set(saved.filter((key) => titles.has(key)))];
    if (!order.includes("todo")) order.unshift("todo");
    if (!order.includes("done")) order.push("done");
    order.splice(
      order.indexOf("done"),
      0,
      ...sections.map(({ id }) => id).filter((key) => !order.includes(key)),
    );
    const all = pick("board-period").value === "all";
    const cards = new Map(order.map((key) => [key, []]));
    for (const card of items.filter(({ value }) => Number(value.depth) === 0)) {
      const value = card.value;
      const done = Boolean(value.flag_done_at && !value.flagged);
      const completed = done ? new Date(value.flag_done_at) : null;
      const day =
        completed && Number.isFinite(completed.getTime())
          ? dateKey(new Date(Date.UTC(completed.getFullYear(), completed.getMonth(), completed.getDate())))
          : value.date;
      if (all || inWeek(day))
        (cards.get(done ? "done" : value.kanban_section_id) ?? cards.get("todo")).push(card);
    }
    content.className = "journal-columns";
    for (const key of order) {
      const destinations = order.filter((other) => other !== key).map((other) => [other, titles.get(other)]);
      content.append(group(titles.get(key), cards.get(key), names, true, destinations));
    }
    return;
  }
  content.className = view === "week" ? "journal-week" : "";
  const entries = view === "week" ? week : [selectedDate()];
  const memos = new Map(records("day_memo").map(({ value }) => [value.date, value.text]));
  for (const date of entries) {
    const section = group(
      dayFormat.format(new Date(date + "T00:00:00Z")),
      items.filter(({ value }) => value.date === date),
      names,
    );
    if (memos.get(date)) section.append(element("p", memos.get(date), "summary-text"));
    content.append(section);
  }
}

function summary(items, names) {
  const week = days();
  const label = weekId() + " 주간 요약";
  const saved = records("weekly_summary").find(({ value }) => value.week_id === weekId())?.value;
  const selected = items.filter(({ value }) => value.date >= week[0] && value.date <= week[6]);
  const source = selected
    .map(
      ({ value }) =>
        "- " + [value.date, names.get(value.category_id), value.text].filter(Boolean).join(" · "),
    )
    .join("\n");
  return {
    label,
    notes: saved?.edited_text || saved?.ai_text || source || "이번 주에 표시할 기록이 없습니다.",
  };
}

function moveControls(item, destinations) {
  const actions = element("div", "", "actions card-move");
  const select = element("select");
  const marker = element("option", "이동할 섹션");
  marker.value = "";
  select.append(marker);
  select.setAttribute("aria-label", "이동할 섹션 " + item.value.text.slice(0, 40));
  for (const [key, title] of destinations) {
    const option = element("option", title);
    option.value = key;
    select.append(option);
  }
  const button = element("button", "이동", "quiet");
  button.type = "button";
  button.disabled = true;
  select.addEventListener("change", () => {
    button.disabled = !select.value;
  });
  let attempt;
  button.addEventListener("click", async () => {
    if (!select.value || moving || draft || loading) return;
    if (attempt?.to !== select.value)
      attempt = { to: select.value, edit: item.edit, opId: crypto.randomUUID() };
    const started = generation;
    moving = true;
    select.disabled = button.disabled = true;
    status.textContent = "카드를 이동하는 중입니다.";
    try {
      await request("/move", attempt);
      if (started !== generation) return;
      moving = false;
      await load();
      if (!status.textContent) status.textContent = "카드를 이동했습니다.";
    } catch (error) {
      if (started !== generation) return;
      if (error.status === 401 || error.status === 404) return recover(error);
      status.textContent =
        error.message === "SPACE_LIMIT"
          ? "서버의 저장 한도에 도달해 카드를 이동할 수 없습니다."
          : error.message === "ENTRY_CONFLICT" || error.message === "SPACE_CHANGED"
            ? "카드나 섹션이 바뀌었습니다. 새로고침 후 다시 이동해 주세요."
            : error.message === "READ_ONLY"
              ? "지금은 카드를 읽기만 할 수 있습니다."
              : "카드를 이동하지 못했습니다. 다시 시도해 주세요.";
    } finally {
      if (started === generation) moving = false;
      select.disabled = button.disabled = false;
    }
  });
  actions.append(select, button);
  return actions;
}

function openEditor(item) {
  if (draft || moving) return;
  draft = { edit: item.edit, payload: null };
  textInput.value = item.value.text;
  editorStatus.textContent = "";
  editor.hidden = false;
  textInput.focus();
}
function closeEditor() {
  draft = null;
  textInput.value = "";
  editor.hidden = true;
  editorStatus.textContent = "";
}
editor.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!draft) return;
  const current = draft;
  const text = textInput.value.trim();
  if (!text || [...text].length > 2000) {
    editorStatus.textContent = "기록은 1~2000자로 입력해 주세요.";
    return;
  }
  if (current.payload?.text !== text)
    current.payload = {
      text,
      edit: current.edit,
      opId: crypto.randomUUID(),
      editedAt: new Date().toISOString(),
    };
  const controls = [...editor.querySelectorAll("button,textarea")];
  controls.forEach((control) => {
    control.disabled = true;
  });
  editorStatus.textContent = "서버에 저장하는 중입니다.";
  try {
    await request("/text", current.payload);
    if (draft !== current) return;
    closeEditor();
    await load();
    if (!status.textContent) status.textContent = "서버에 저장됐습니다.";
  } catch (error) {
    if (draft !== current) return;
    if (error.status === 401 || error.status === 404) return recover(error);
    editorStatus.textContent =
      error.message === "ENTRY_CONFLICT"
        ? "다른 기기에서 기록을 수정했습니다. 입력한 내용을 보관한 뒤 화면을 새로고침해 주세요."
        : error.message === "READ_ONLY"
          ? "지금은 이 기록을 읽기만 할 수 있습니다."
          : "저장을 확인하지 못했습니다. 입력한 내용으로 다시 시도할 수 있습니다.";
  } finally {
    controls.forEach((control) => {
      control.disabled = false;
    });
  }
});
pick("record-cancel").addEventListener("click", closeEditor);
refresh.addEventListener("click", () => load(!draft));
for (const direction of [
  ["period-prev", -1],
  ["period-next", 1],
]) {
  pick(direction[0])?.addEventListener("click", () => {
    dateInput.value = shift(selectedDate(), direction[1] * (view === "day" ? 1 : 7));
    render();
  });
}
dateInput?.addEventListener("change", render);
queryInput?.addEventListener("input", render);
pick("board-period")?.addEventListener("change", render);
pick("journal-download")?.addEventListener("click", () => {
  const names = new Map(records("category").map(({ value }) => [value.id, value.name]));
  const data = summary(
    records("entry_item")
      .filter(({ value }) => typeof value.date === "string")
      .sort(itemSort),
    names,
  );
  const url = URL.createObjectURL(
    new Blob(["# " + data.label + "\n\n" + data.notes + "\n"], { type: "text/markdown;charset=utf-8" }),
  );
  const link = element("a");
  link.href = url;
  link.download = weekId() + "-summary.md";
  link.click();
  URL.revokeObjectURL(url);
});
sessionEvents?.addEventListener("message", (event) => {
  if (event.data === "logout") {
    reset();
    location.replace("/login");
  }
});
addEventListener("pagehide", reset);
addEventListener("pageshow", (event) => {
  if (event.persisted) load(true);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) load();
});
setInterval(() => {
  if (!document.hidden && complete) load();
}, 30000);
load(true);
