/* global document, location, fetch, URL, URLSearchParams, Blob, crypto, addEventListener, BroadcastChannel, setInterval, matchMedia */
import { renderCabinet, renderNotes } from "/assets/materials.js";
const journal = document.querySelector("#journal");
const id = journal.dataset.id;
const view = journal.dataset.view;
const library = ["notes", "cabinet"].includes(view);
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
const splitView = matchMedia("(min-width: 600px)");
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
let selectedRecordKey = null;
let selectedKanbanSection = "todo";
let selectedMaterial = null;
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
  selectedRecordKey = null;
  selectedKanbanSection = "todo";
  selectedMaterial = null;
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
    const params = new URLSearchParams({ after: cursor });
    if (library) params.set("view", view);
    const page = await request("/changes?" + params);
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
        if (library) params.set("view", view);
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
  let state = "";
  if (value.flagged || !value.flag_done_at) {
    if (value.due_date < today) state = "late";
    else if (value.due_date === today) state = "today";
    else if (value.due_date <= shift(today, 2)) state = "soon";
  }
  const labels = { late: "기한 초과", today: "오늘 마감", soon: "마감 임박" };
  const badge = element("small", [labels[state], value.due_date].filter(Boolean).join(" · "));
  if (state) badge.dataset.due = state;
  return badge;
}
function kanbanCard(item, category, destinations) {
  const li = element("li", "", "kanban-card work-stripe");
  li.dataset.workColor = category.color;
  const date = `${category.name} · ${item.value.date}`;
  li.append(element("p", date, "record-meta"), formatRecord(item));
  if (editable(item)) {
    const actions = element("div", "", "kanban-card-actions");
    const edit = element("button", "편집", "quiet record-edit");
    edit.type = "button";
    edit.dataset.recordKey = item.key;
    edit.setAttribute("aria-label", "기록 편집 " + String(item.value.text ?? "").slice(0, 40));
    edit.addEventListener("click", () => openEditor(item, category.name));
    actions.append(edit, moveControls(item, destinations));
    li.append(actions);
  }
  return li;
}

function workCategory(categories, id) {
  const category = categories.get(id);
  return {
    name: category?.name || "업무 미지정",
    color: category?.color ?? "",
    order: category?.sort_order ?? Infinity,
  };
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

function highlightedText(value, query) {
  const text = element("span", "", "week-entry-text");
  if (!query) {
    text.textContent = value;
    return text;
  }
  let end = 0;
  for (const match of value.matchAll(query)) {
    text.append(value.slice(end, match.index), element("mark", match[0]));
    end = match.index + match[0].length;
  }
  text.append(value.slice(end));
  return text;
}

function formatRecord(item, query) {
  const value = item.value;
  const line = element("span", "", "week-entry");
  const marker = value.flagged ? "★" : value.flag_done_at ? "✓" : Number(value.depth) > 0 ? "◦" : "•";
  const icon = element("span", marker, "week-entry-marker");
  icon.dataset.state = value.flagged ? "important" : value.flag_done_at ? "done" : "";
  icon.setAttribute("aria-hidden", "true");
  const text = element("span");
  if (value.start_time) text.append(element("small", value.start_time, "week-entry-time"));
  text.append(highlightedText(String(value.text ?? ""), query));
  const state = value.flagged ? "중요" : value.flag_done_at ? "완료" : "";
  if (state) text.append(element("span", state, "visually-hidden"));
  const due = deadline(value);
  if (due) text.append(due);
  line.append(icon, text);
  return line;
}

const editable = (item) => active?.schema === 20 && Boolean(item.edit);

function recordControl(item, category, { selected = false, selecting = false, query } = {}) {
  const enabled = selecting || editable(item);
  const entry = element(
    enabled ? "button" : "div",
    "",
    `week-entry-control${item.value.depth > 0 ? " sub-record" : ""}`,
  );
  if (enabled) {
    entry.type = "button";
    entry.dataset.recordKey = item.key;
    if (selecting) entry.setAttribute("aria-pressed", String(selected));
    entry.addEventListener("click", () => {
      if (!selecting) return openEditor(item, category.name);
      selectedRecordKey = item.key;
      render();
      focusRecord(item.key);
    });
  }
  entry.append(formatRecord(item, query));
  return entry;
}

function focusRecord(key) {
  (content.querySelector(`[data-record-key="${key}"]`) ?? queryInput)?.focus();
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
      for (const item of dates.get(date) ?? []) cell.append(recordControl(item, category));
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

function selectRecord(entries) {
  const selected = entries.find(({ item }) => item.key === selectedRecordKey) ?? entries[0];
  selectedRecordKey = selected?.item.key ?? null;
  return selected;
}

function recordDetail({ item, category }, { showDate = false, query } = {}) {
  const detail = element("section", "", "week-detail");
  detail.setAttribute("aria-label", "선택한 기록");
  detail.append(element("h2", category.name));
  if (showDate) detail.append(element("p", item.value.date, "record-meta"));
  detail.append(formatRecord(item, query));
  if (editable(item)) {
    const edit = element("button", "기록 편집", "quiet");
    edit.type = "button";
    edit.addEventListener("click", () => openEditor(item, category.name));
    detail.append(edit);
  }
  return detail;
}

function renderDayList(week, groups, memoText) {
  const date = selectedDate();
  const row = element("div", "", "week-days");
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "요일 선택");
  for (const [index, day] of week.entries()) row.append(weekDayButton(day, index));
  content.append(row);
  const list = element("div", "", "week-work-list");
  const split = splitView.matches;
  const entries = groups.flatMap(({ category, dates }) =>
    (dates.get(date) ?? []).map((item) => ({ item, category })),
  );
  const selected = selectRecord(entries);
  for (const { category, dates } of groups) {
    const items = dates.get(date);
    if (!items) continue;
    const section = element("section", "", "week-work-group work-stripe");
    section.dataset.workColor = category.color;
    section.append(element("h2", category.name));
    for (const item of items)
      section.append(
        recordControl(item, category, { selected: item.key === selectedRecordKey, selecting: split }),
      );
    list.append(section);
  }
  if (!entries.length) list.append(element("p", "이 날의 기록이 없습니다.", "week-empty"));
  if (memoText) {
    const memo = element("section", "", "week-memo");
    memo.append(element("h2", "데일리 메모"), element("p", memoText, "summary-text"));
    list.append(memo);
  }
  const layout = element("div", "", "week-compact-layout");
  layout.append(list);
  if (split && selected) layout.append(recordDetail(selected));
  content.append(layout);
}

function groupByWork(items, categories) {
  const grouped = new Map();
  for (const item of items) {
    const { category_id: id, date } = item.value;
    if (!grouped.has(id)) {
      grouped.set(id, { category: workCategory(categories, id), dates: new Map() });
    }
    const { dates } = grouped.get(id);
    if (!dates.has(date)) dates.set(date, []);
    dates.get(date).push(item);
  }
  return [...grouped.values()].sort(
    (a, b) => a.category.order - b.category.order || a.category.name.localeCompare(b.category.name, "ko"),
  );
}

function renderSearch(items, categories) {
  const query = queryInput.value.trim().toLocaleLowerCase();
  if (!query) return;
  const tags = new Map(records("tag").map(({ value }) => [value.id, value.name]));
  const byCategory = new Map();
  for (const { value } of records("category_tag")) {
    if (!byCategory.has(value.category_id)) byCategory.set(value.category_id, []);
    byCategory.get(value.category_id).push(tags.get(value.tag_id));
  }
  const matches = items.filter(({ value }) =>
    [value.text, categories.get(value.category_id)?.name, ...(byCategory.get(value.category_id) ?? [])].some(
      (term) => typeof term === "string" && term.toLocaleLowerCase().includes(query),
    ),
  );
  const count = element("p", `검색 결과 ${matches.length}건`, "record-meta");
  count.setAttribute("role", "status");
  content.append(count);
  if (!matches.length) return;
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const results = matches
    .slice(0, 100)
    .map((item) => ({ item, category: workCategory(categories, item.value.category_id) }));
  const selected = selectRecord(results);
  const split = splitView.matches;
  const layout = element("div", "", "result-layout");
  const list = element("ul", "", "record-list search-results");
  for (const { item, category } of results) {
    const result = element("li", "", "search-result work-stripe");
    result.dataset.workColor = category.color;
    result.append(
      element("p", `${category.name} · ${item.value.date}`, "record-meta"),
      recordControl(item, category, { selected: item === selected.item, selecting: split, query: pattern }),
    );
    list.append(result);
  }
  layout.append(list);
  if (split) layout.append(recordDetail(selected, { showDate: true, query: pattern }));
  content.append(layout);
  if (matches.length > 100) content.append(element("p", "검색어를 좁혀 추가 기록을 확인해 주세요."));
}

function renderKanban(items, categories, inWeek) {
  const sections = records("kanban_section")
    .map(({ value }) => value)
    .sort((a, b) => a.sort_order - b.sort_order);
  const titles = new Map([["todo", "TODO"], ...sections.map(({ id, name }) => [id, name]), ["done", "DONE"]]);
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
  for (const card of items) {
    const value = card.value;
    if (Number(value.depth) !== 0) continue;
    const done = Boolean(value.flag_done_at && !value.flagged);
    const completed = done ? new Date(value.flag_done_at) : null;
    const date =
      completed && Number.isFinite(completed.getTime())
        ? dateKey(new Date(Date.UTC(completed.getFullYear(), completed.getMonth(), completed.getDate())))
        : value.date;
    if (all || inWeek(date))
      (cards.get(done ? "done" : value.kanban_section_id) ?? cards.get("todo")).push(card);
  }
  if (!cards.has(selectedKanbanSection)) selectedKanbanSection = order[0];
  const tabs = element("div", "", "kanban-tabs");
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", "표시할 칸반 섹션");
  const board = element("div", "", "kanban-board");
  const lanes = new Map();
  const buttons = new Map();
  for (const key of order) {
    const items = cards.get(key);
    const title = titles.get(key);
    const tab = element("button", `${title} ${items.length}`, "quiet kanban-tab");
    tab.type = "button";
    const lane = element("section", "", "kanban-lane");
    lane.dataset.state = key === "done" ? "done" : "open";
    const head = element("header", "", "kanban-lane-head");
    head.append(element("h2", title), element("span", `${items.length}장`, "record-meta"));
    lane.append(head);
    if (items.length) {
      const list = element("ul", "", "record-list");
      const destinations = order.filter((other) => other !== key).map((other) => [other, titles.get(other)]);
      for (const item of items)
        list.append(kanbanCard(item, workCategory(categories, item.value.category_id), destinations));
      lane.append(list);
    } else lane.append(element("p", "카드가 없습니다.", "week-empty"));
    lanes.set(key, lane);
    buttons.set(key, tab);
    tab.addEventListener("click", () => {
      selectedKanbanSection = key;
      updateKanbanSelection(lanes, buttons);
    });
    tabs.append(tab);
    board.append(lane);
  }
  updateKanbanSelection(lanes, buttons);
  content.append(tabs, board);
}

function updateKanbanSelection(lanes, buttons) {
  for (const [key, lane] of lanes) {
    const selected = key === selectedKanbanSection;
    lane.dataset.selected = String(selected);
    buttons.get(key).setAttribute("aria-pressed", String(selected));
  }
}

function render() {
  if (!complete || !active) return;
  const categories = new Map(records("category").map(({ value }) => [value.id, value]));
  const items = records("entry_item")
    .filter(({ value }) => typeof value.date === "string")
    .sort(itemSort);
  content.replaceChildren();
  content.className = `journal-${view}`;
  if (view === "cabinet") {
    const notes = records("cabi_note").sort((a, b) =>
      String(b.value.updated_at).localeCompare(String(a.value.updated_at)),
    );
    const materials = records("cabinet_item").sort((a, b) => a.value.sort_order - b.value.sort_order);
    content.append(
      renderCabinet({
        notes,
        materials,
        bindings: records("cabinet_link"),
        categories,
        key: selectedMaterial,
        split: splitView.matches,
        select(key, previous) {
          selectedMaterial = key;
          render();
          const selector = previous
            ? `[data-material-key="${previous}"]`
            : splitView.matches
              ? `[data-material-key="${key}"]`
              : ".material-detail";
          content.querySelector(selector)?.focus();
        },
      }),
    );
    return;
  }
  if (view === "search") return renderSearch(items, categories);

  const week = days();
  const start = week[0];
  const end = week[6];
  const date = selectedDate();
  const inWeek = (day) => day >= start && day <= end;
  pick("period-range").textContent =
    view === "day"
      ? dayFormat.format(new Date(date + "T00:00:00Z"))
      : `${start.slice(0, 4)}. ${shortDate(start)} – ${shortDate(end)}`;
  if (view === "notes") {
    const id = weekId();
    const note = records("week_note").find(({ value }) => value.week_id === id)?.value;
    const oldMemos = records("day_memo")
      .map(({ value }) => value)
      .filter(({ date, text }) => inWeek(date) && text)
      .sort((a, b) => a.date.localeCompare(b.date));
    content.append(renderNotes(id, note, oldMemos));
    return;
  }
  if (view === "kanban") return renderKanban(items, categories, inWeek);

  const weekly = items.filter(({ value }) => inWeek(value.date));
  if (view === "summary") return renderSummary(weekly, categories);
  const memos = new Map(records("day_memo").map(({ value }) => [value.date, value.text]));
  if (view === "day") return renderDayList(week, groupByWork(weekly, categories), memos.get(date));

  pick("journal-summary").href = `/app/${id}/summary?date=${date}`;
  pick("journal-notes").href = `/app/${id}/notes?date=${date}`;
  const groups = groupByWork(weekly, categories);
  if (wideWeek.matches) renderWeekGrid(week, groups, memos);
  else renderDayList(week, groups, memos.get(date));
}

function summary(items, categories) {
  const id = weekId();
  const saved = records("weekly_summary").find(({ value }) => value.week_id === id)?.value;
  const original = saved?.edited_text || saved?.ai_text;
  const source = items
    .map(
      ({ value }) =>
        "- " + [value.date, categories.get(value.category_id)?.name, value.text].filter(Boolean).join(" · "),
    )
    .join("\n");
  return {
    label: id + " 주간 요약",
    original,
    kind: saved?.edited_text ? "수정본" : saved?.ai_text ? "AI 요약" : "기록에서 모은 요약",
    notes: original || source || "이번 주에 표시할 기록이 없습니다.",
  };
}

function renderSummary(items, categories) {
  const data = summary(items, categories);
  const sheet = element("article", "", "summary-sheet");
  sheet.setAttribute("aria-label", "주간 요약 본문");
  const heading = element("header", "", "summary-heading");
  heading.append(element("h2", data.label));
  if (data.original || items.length) heading.append(element("p", data.kind, "record-meta"));
  sheet.append(heading);
  if (data.original || !items.length) sheet.append(element("p", data.notes, "summary-text"));
  else {
    for (const { category, dates } of groupByWork(items, categories)) {
      const group = element("section", "", "summary-work work-stripe");
      group.dataset.workColor = category.color;
      group.append(element("h3", category.name));
      const list = element("ul", "", "record-list");
      for (const [date, records] of dates) {
        for (const item of records) {
          const entry = element("li", "", "summary-entry");
          if (item.value.depth > 0) entry.classList.add("sub-record");
          const time = element("time", shortDate(date), "record-meta");
          time.dateTime = date;
          entry.append(time, element("span", item.value.text ?? "", "summary-text"));
          list.append(entry);
        }
      }
      group.append(list);
      sheet.append(group);
    }
  }
  content.append(sheet);
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
      selectedKanbanSection = attempt.to;
      moving = false;
      await load();
      focusRecord(item.key);
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
    focusRecord(current.key);
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
if (view === "week") wideWeek.addEventListener("change", render);
if (["week", "day", "search", "cabinet"].includes(view)) splitView.addEventListener("change", render);
queryInput?.addEventListener("input", render);
pick("board-period")?.addEventListener("change", render);
pick("journal-download")?.addEventListener("click", () => {
  const categories = new Map(records("category").map(({ value }) => [value.id, value]));
  const week = days();
  const data = summary(
    records("entry_item")
      .filter(({ value }) => typeof value.date === "string" && value.date >= week[0] && value.date <= week[6])
      .sort(itemSort),
    categories,
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
