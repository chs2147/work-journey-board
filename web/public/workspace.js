/* global document, location, fetch, URL, URLSearchParams, Blob, crypto, addEventListener, BroadcastChannel, setInterval, matchMedia */
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
const dialog = pick("record-dialog");
const editorContext = pick("record-context");
const editorStatus = pick("record-status");
const textInput = pick("record-text");
const refresh = pick("journal-refresh");
const syncIndicator = pick("journal-sync");
const wideWeek = matchMedia("(min-width: 1024px)");
const splitWeek = matchMedia("(min-width: 600px)");
const dayFormat = new Intl.DateTimeFormat("ko-KR", {
  weekday: "short",
  month: "numeric",
  day: "numeric",
  timeZone: "UTC",
});
const weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"];
const shortDate = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
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
let weekSelection = null;
if (dateInput) {
  const date = new URLSearchParams(location.search).get("date");
  dateInput.value = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
  if (!dateInput.value) dateInput.value = localToday();
}

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
  closeEditor();
  weekSelection = null;
  if (queryInput) queryInput.value = "";
  content.replaceChildren();
  tools.hidden = true;
  pick("journal-name").textContent = "워크스페이스";
  setSyncState("연결 중");
}

function setSyncState(text, state = "") {
  syncIndicator.textContent = text;
  syncIndicator.dataset.state = state;
}

function recover(error) {
  if (error.status === 401) {
    reset();
    location.replace("/login");
  } else if (error.status === 404) {
    reset();
    location.replace("/spaces");
  } else {
    setSyncState("연결 확인", "error");
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
  if (fromBeginning) {
    status.textContent = "온라인 기록을 불러오는 중입니다.";
    setSyncState("동기화 중");
  } else status.textContent = "";
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
    setSyncState("동기화됨", "ready");
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
function deadline(value) {
  if (!value.due_date) return null;
  const today = localToday();
  let label = "";
  if (value.flagged || !value.flag_done_at) {
    if (value.due_date < today) label = "기한 초과";
    else if (value.due_date === today) label = "오늘 마감";
    else if (value.due_date <= shift(today, 2)) label = "마감 임박";
  }
  return element("small", [label, value.due_date].filter(Boolean).join(" · "), label ? "deadline-alert" : "");
}
function task(item, category, showDate = false, destinations) {
  const value = item.value;
  const li = element("li", "", value.depth > 0 ? "record sub-record" : "record");
  if (destinations) li.dataset.workColor = category?.color ?? "";
  const detail = [
    showDate && value.date,
    category?.name,
    value.start_time,
    value.flagged ? "중요" : null,
  ].filter(Boolean);
  if (value.flag_done_at && !value.flagged) detail.push("완료");
  if (detail.length) li.append(element("small", detail.join(" · ")));
  li.append(element("p", String(value.text ?? "")));
  const due = deadline(value);
  if (due) li.append(due);
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

function group(title, items, categories, showDate = false, destinations) {
  const section = element("section", "", "journal-group");
  section.append(element("h2", title));
  if (!items.length) section.append(element("p", "표시할 기록이 없습니다."));
  else {
    const list = element("ul", "", "record-list");
    for (const item of items)
      list.append(task(item, categories.get(item.value.category_id), showDate, destinations));
    section.append(list);
  }
  return section;
}

function weekDayButton(date, index) {
  const button = element("button", "", "week-day " + weekDayClass(date, index));
  button.type = "button";
  button.dataset.weekDate = date;
  button.setAttribute(
    "aria-label",
    `${shortDate(date)} ${weekdayLabels[index]}요일${date === localToday() ? " 오늘" : ""}`,
  );
  button.setAttribute("aria-pressed", String(date === selectedDate()));
  const time = element("time", shortDate(date));
  time.dateTime = date;
  button.append(element("span", weekdayLabels[index]), time);
  if (date === localToday()) button.append(element("small", "오늘", "week-today"));
  button.addEventListener("click", () => {
    dateInput.value = date;
    render();
    content.querySelector(`[data-week-date="${date}"]`)?.focus();
  });
  return button;
}

function formatWeekRecord(item, className = "week-entry") {
  const value = item.value;
  const line = element("span", "", className);
  const marker = value.flagged ? "★" : value.flag_done_at ? "✓" : Number(value.depth) > 0 ? "◦" : "•";
  const icon = element("span", marker, "week-entry-marker");
  icon.dataset.state = value.flagged ? "important" : value.flag_done_at ? "done" : "";
  icon.setAttribute("aria-hidden", "true");
  const text = element("span");
  if (value.start_time) text.append(element("small", value.start_time, "week-entry-time"));
  text.append(element("span", value.text ?? "", "week-entry-text"));
  const state = value.flagged ? "중요" : value.flag_done_at ? "완료" : "";
  if (state) text.append(element("span", state, "visually-hidden"));
  const due = deadline(value);
  if (due) text.append(due);
  line.append(icon, text);
  return line;
}

const editable = (item) => active?.schema === 20 && Boolean(item.edit);

function weekRecord(item, category, selected, selecting) {
  const enabled = selecting || editable(item);
  const entry = element(
    enabled ? "button" : "div",
    "",
    `week-entry-control${item.value.depth > 0 ? " sub-record" : ""}`,
  );
  if (enabled) {
    entry.type = "button";
    entry.dataset.weekRecord = item.key;
    if (selecting) entry.setAttribute("aria-pressed", String(selected));
    entry.addEventListener("click", () => {
      if (!selecting) return openEditor(item, category.name);
      weekSelection = item.key;
      render();
      content.querySelector(`[data-week-record="${item.key}"]`)?.focus();
    });
  }
  entry.append(formatWeekRecord(item));
  return entry;
}

function renderWeekGrid(week, groups, memos) {
  const table = element("table", "", "week-grid");
  table.setAttribute("aria-label", "업무와 요일별 주간 기록");
  const head = table.createTHead().insertRow();
  const corner = element("th", "업무");
  corner.scope = "col";
  head.append(corner);
  for (const [index, date] of week.entries()) {
    const cell = element("th");
    cell.scope = "col";
    cell.className = weekDayClass(date, index);
    cell.append(weekDayButton(date, index));
    head.append(cell);
  }
  const body = table.createTBody();
  for (const { category, dates } of groups) {
    const row = body.insertRow();
    const label = element("th", "", "week-category work-stripe");
    label.scope = "row";
    label.dataset.workColor = category.color;
    label.append(element("span", category.name, "week-category-label"));
    row.append(label);
    for (const [index, date] of week.entries()) {
      const cell = row.insertCell();
      cell.className = weekDayClass(date, index);
      for (const item of dates.get(date) ?? []) cell.append(weekRecord(item, category, false, false));
    }
  }
  if (week.some((date) => memos.get(date))) {
    const row = body.insertRow();
    const label = element("th", "데일리 메모", "week-category");
    label.scope = "row";
    row.append(label);
    for (const [index, date] of week.entries()) {
      const cell = row.insertCell();
      cell.className = weekDayClass(date, index);
      if (memos.get(date)) cell.append(element("p", memos.get(date), "summary-text"));
    }
  }
  content.append(table);
  if (!body.rows.length) content.append(element("p", "이번 주에 표시할 기록이 없습니다.", "week-empty"));
}

function weekDayClass(date, index) {
  if (date === localToday()) return "week-is-today";
  if (date === selectedDate()) return "week-is-selected";
  return index >= 5 ? "week-is-weekend" : "";
}

function renderCompactWeek(week, groups, memos) {
  const date = selectedDate();
  const row = element("div", "", "week-days");
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "요일 선택");
  for (const [index, day] of week.entries()) row.append(weekDayButton(day, index));
  content.append(row);
  const list = element("div", "", "week-work-list");
  const split = splitWeek.matches;
  const entries = groups.flatMap(({ category, dates }) =>
    (dates.get(date) ?? []).map((item) => ({ item, category })),
  );
  const selected = entries.find(({ item }) => item.key === weekSelection) ?? entries[0];
  weekSelection = selected?.item.key ?? null;
  for (const { category, dates } of groups) {
    const items = dates.get(date);
    if (!items) continue;
    const section = element("section", "", "week-work-group work-stripe");
    section.dataset.workColor = category.color;
    section.append(element("h2", category.name));
    for (const item of items)
      section.append(weekRecord(item, category, split && item.key === weekSelection, split));
    list.append(section);
  }
  if (!entries.length) list.append(element("p", "이 날의 기록이 없습니다.", "week-empty"));
  if (memos.get(date)) {
    const memo = element("section", "", "week-memo");
    memo.append(element("h2", "데일리 메모"), element("p", memos.get(date), "summary-text"));
    list.append(memo);
  }
  const layout = element("div", "", "week-compact-layout");
  layout.append(list);
  if (split && selected) {
    const { item, category } = selected;
    const detail = element("section", "", "week-detail");
    detail.setAttribute("aria-label", "선택한 기록");
    detail.append(element("h2", category.name), formatWeekRecord(item, "week-entry"));
    if (editable(item)) {
      const edit = element("button", "기록 편집", "quiet");
      edit.type = "button";
      edit.addEventListener("click", () => openEditor(item, category.name));
      detail.append(edit);
    }
    layout.append(detail);
  }
  content.append(layout);
}

function renderWeek(week, items, categories, memos) {
  const grouped = new Map();
  for (const item of items) {
    const { category_id: id, date } = item.value;
    if (!grouped.has(id)) {
      const category = categories.get(id);
      grouped.set(id, {
        category: {
          name: category?.name || "업무 미지정",
          color: category?.color ?? "",
          order: category?.sort_order ?? Infinity,
        },
        dates: new Map(),
      });
    }
    const { dates } = grouped.get(id);
    if (!dates.has(date)) dates.set(date, []);
    dates.get(date).push(item);
  }
  const groups = [...grouped.values()].sort(
    (a, b) => a.category.order - b.category.order || a.category.name.localeCompare(b.category.name, "ko"),
  );
  content.className = "journal-week";
  if (wideWeek.matches) renderWeekGrid(week, groups, memos);
  else renderCompactWeek(week, groups, memos);
}

function render() {
  if (!complete || !active) return;
  const categories = new Map(records("category").map(({ value }) => [value.id, value]));
  const names = new Map([...categories].map(([key, value]) => [key, value.name]));
  const items = records("entry_item")
    .filter(({ value }) => typeof value.date === "string")
    .sort(itemSort);
  const week = days();
  const start = week[0];
  const end = week[6];
  const inWeek = (date) => date >= start && date <= end;
  if (dateInput) {
    const period =
      view === "day"
        ? dayFormat.format(new Date(selectedDate() + "T00:00:00Z"))
        : `${start.slice(0, 4)}. ${shortDate(start)} – ${shortDate(end)}`;
    pick("period-range").textContent = period;
  }
  if (view === "week") pick("journal-summary").href = `/app/${id}/summary?date=${selectedDate()}`;
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
    content.append(group("검색 결과 " + matches.length + "건", matches.slice(0, 100), categories, true));
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
      content.append(group(titles.get(key), cards.get(key), categories, true, destinations));
    }
    return;
  }
  const memos = new Map(records("day_memo").map(({ value }) => [value.date, value.text]));
  if (view === "week")
    return renderWeek(
      week,
      items.filter(({ value }) => inWeek(value.date)),
      categories,
      memos,
    );
  const date = selectedDate();
  const section = group(
    dayFormat.format(new Date(date + "T00:00:00Z")),
    items.filter(({ value }) => value.date === date),
    categories,
  );
  if (memos.get(date)) section.append(element("p", memos.get(date), "summary-text"));
  content.append(section);
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

function openEditor(item, category) {
  if (draft || moving) return;
  draft = { edit: item.edit, key: item.key, payload: null };
  editorContext.textContent = category ? `${category} · ${item.value.date}` : "";
  editorContext.hidden = !category;
  textInput.value = item.value.text;
  editorStatus.textContent = "";
  dialog.showModal();
  textInput.focus();
}
function closeEditor() {
  draft = null;
  textInput.value = "";
  if (dialog.open) dialog.close();
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
    if (view === "week") content.querySelector(`[data-week-record="${current.key}"]`)?.focus();
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
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  if (!textInput.disabled) closeEditor();
});
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
pick("journal-today")?.addEventListener("click", () => {
  dateInput.value = localToday();
  render();
});
if (view === "week") {
  wideWeek.addEventListener("change", render);
  splitWeek.addEventListener("change", render);
}
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
