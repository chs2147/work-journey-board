/* global document, location, fetch, URL, URLSearchParams, Blob, crypto, addEventListener, removeEventListener, BroadcastChannel, setInterval, matchMedia, history, confirm, ResizeObserver, navigator */
import { cabinetEntries, renderCabinet, renderMaterial, renderNotes } from "/assets/materials.js";
const journal = document.querySelector("#journal");
const id = journal.dataset.id;
const view = journal.dataset.view;
const core = ["day", "week", "kanban"].includes(view);
const hasRecordPanel = core || view === "search" || view === "cabinet";
const selectionParam = view === "cabinet" ? "material" : "record";
const library = ["notes", "cabinet"].includes(view);
const base = "/api/spaces/" + id;
const pick = (name) => document.getElementById(name);
const status = pick("journal-status");
const content = pick("journal-content");
const tools = pick("journal-tools");
const dateInput = pick("journal-date");
const queryInput = pick("journal-search");
const cabinetQuery = pick("cabinet-search");
const workFilter = pick("secondary-work");
const searchPeriod = pick("search-period");
const cabinetKind = pick("cabinet-kind");
const editor = pick("record-editor");
const dialog = pick("record-dialog");
const preview = pick("record-preview");
const heading = pick("record-heading");
const spacePicker = pick("space-picker");
const spacePickerList = pick("space-picker-list");
const spaceStatus = pick("space-picker-status");
const editorContext = pick("record-context");
const editorStatus = pick("record-status");
const textInput = pick("record-text");
const refresh = pick("journal-refresh");
const syncIndicator = pick("journal-sync");
const destinationsByRecord = new Map();
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
let keys = new Map();
let active = null;
let cursor = "0";
let loading = false;
let draft = null;
let generation = 0;
let complete = false;
let dirty = false;
let moving = false;
let selectedRecordKey = hasRecordPanel ? recordFromAddress() : null;
let selectedKanbanSection = "todo";
let spaceRequest = 0;
if (dateInput) dateInput.value = dateFromAddress();

function dateFromAddress() {
  const date = new URLSearchParams(location.search).get("date") ?? "";
  const parsed = Date.parse(date);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed) && dateKey(new Date(parsed)) === date
    ? date
    : localToday();
}

function recordFromAddress() {
  const key = new URLSearchParams(location.search).get(selectionParam) ?? "";
  return /^[a-f0-9]{64}$/.test(key) ? key : null;
}

function updateAddress(push = false) {
  const url = new URL(location.href);
  if (dateInput) url.searchParams.set("date", selectedDate());
  if (hasRecordPanel) {
    if (selectedRecordKey) url.searchParams.set(selectionParam, selectedRecordKey);
    else url.searchParams.delete(selectionParam);
  }
  if (push) history.pushState({ recordOpened: true }, "", url);
  else history.replaceState(history.state, "", url);
}

function updateLayout() {
  const width = content.closest(".journal-body").clientWidth;
  const next =
    core && width >= 912 && matchMedia("(min-width: 1024px)").matches
      ? "wide"
      : width >= 648
        ? "split"
        : "single";
  if (journal.dataset.layout === next) return;
  journal.dataset.layout = next;
  if (core) render();
  else if (dialog.open) showPanel();
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function fetchJson(path, payload) {
  const response = await fetch(
    path,
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

const request = (path, payload) => fetchJson(base + path, payload);

async function showSpaces() {
  if (spacePicker.open) return;
  const started = ++spaceRequest;
  spacePickerList.replaceChildren();
  spaceStatus.textContent = "공간을 불러오는 중입니다.";
  spacePicker.showModal();
  try {
    const { spaces } = await fetchJson("/api/spaces");
    if (started !== spaceRequest || !spacePicker.open) return;
    for (const space of spaces) {
      const row = element("li", "", "work-stripe");
      row.dataset.workColor = space.color;
      if (space.id === id) {
        const current = element("button", space.name + " · 현재 공간", "quiet");
        current.type = "button";
        current.addEventListener("click", () => spacePicker.close());
        row.append(current);
      } else {
        const link = element("a", space.name);
        link.href = `/app/${space.id}/day`;
        row.append(link);
      }
      spacePickerList.append(row);
    }
    spaceStatus.textContent = spaces.length ? "" : "온라인 공간이 없습니다.";
  } catch (error) {
    if (started !== spaceRequest || !spacePicker.open) return;
    if (error.status === 401) recover(error);
    else spaceStatus.textContent = "공간을 불러오지 못했습니다. 공간 목록에서 다시 시도해 주세요.";
  }
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
  closePanel();
  spaceRequest++;
  spacePickerList.replaceChildren();
  if (spacePicker.open) spacePicker.close();
  selectedRecordKey = null;
  selectedKanbanSection = "todo";
  if (queryInput) queryInput.value = "";
  if (cabinetQuery) cabinetQuery.value = "";
  if (workFilter) workFilter.value = "";
  if (searchPeriod) searchPeriod.value = "all";
  if (cabinetKind) cabinetKind.value = "";
  content.replaceChildren();
  content.setAttribute("aria-busy", "true");
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

function apply(snapshot, rows) {
  if (!rows.length) return;
  if (snapshot.records === keys) snapshot.records = new Map(keys);
  for (const row of rows) {
    const key = row.table + ":" + row.key;
    if (row.value === null) snapshot.records.delete(key);
    else snapshot.records.set(key, row);
  }
}

async function sync(steps, snapshot) {
  let more;
  do {
    const params = new URLSearchParams({ after: snapshot.cursor });
    if (library) params.set("view", view);
    const page = await request("/changes?" + params);
    if (steps !== generation) return;
    apply(snapshot, page.records);
    snapshot.cursor = page.next;
    more = page.more;
  } while (more);
}

async function load(full = false) {
  if (loading || draft || moving) return;
  loading = true;
  refresh.disabled = true;
  const started = ++generation;
  const fromBeginning = full || !complete;
  const snapshot = { records: fromBeginning ? new Map() : keys, cursor: fromBeginning ? "0" : cursor };
  let nextHeader = active;
  if (fromBeginning) {
    status.textContent = "서버와 동기화 중";
    setSyncState("동기화 중");
  } else status.textContent = "";
  try {
    if (fromBeginning) {
      nextHeader = await request("/header");
      if (started !== generation) return;
      let next;
      while (view !== "more") {
        const params = new URLSearchParams({ manifest: nextHeader.manifest });
        if (library) params.set("view", view);
        if (next) {
          params.set("table", next[0]);
          params.set("key", next[1]);
        }
        const page = await request("/records?" + params);
        if (started !== generation) return;
        apply(snapshot, page.records);
        next = page.next;
        if (!next) break;
      }
    }
    if (view !== "more") await sync(started, snapshot);
    if (started !== generation) return;
    const recordsChanged = keys !== snapshot.records;
    keys = snapshot.records;
    cursor = snapshot.cursor;
    active = nextHeader;
    pick("journal-name").textContent = active.name;
    complete = true;
    content.setAttribute("aria-busy", "false");
    tools.hidden = false;
    if (recordsChanged || dirty) render();
    dirty = false;
    status.textContent = "";
    setSyncState("동기화됨", "ready");
  } catch (error) {
    if (started === generation) {
      content.setAttribute("aria-busy", "false");
      recover(error);
    }
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
  return dateInput?.value || dateFromAddress();
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
  const difference = Math.round((Date.parse(value.due_date) - Date.parse(today)) / 86400000);
  const labels = { late: `마감 초과 ${-difference}일`, today: "오늘 마감", soon: `마감 D-${difference}` };
  const badge = element("small", [labels[state], value.due_date].filter(Boolean).join(" · "));
  if (state) badge.dataset.due = state;
  return badge;
}
function kanbanCard(item, category, destinations) {
  const li = element("li", "", "kanban-card work-stripe");
  li.dataset.workColor = category.color;
  const date = `${category.name} · ${item.value.date}`;
  destinationsByRecord.set(item.key, destinations);
  li.append(element("p", date, "record-meta"), recordControl(item));
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
    if (changeDate(date)) content.querySelector(`[data-week-date="${date}"]`)?.focus();
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

function recordControl(item, query) {
  const entry = element("button", "", `week-entry-control${item.value.depth > 0 ? " sub-record" : ""}`);
  entry.type = "button";
  entry.dataset.recordKey = item.key;
  entry.setAttribute("aria-pressed", String(item.key === selectedRecordKey));
  entry.addEventListener("click", () => viewRecord(item.key));
  entry.append(formatRecord(item, query));
  return entry;
}

function focusRecord(key) {
  (
    content.querySelector(`[data-record-key="${key}"]`) ??
    queryInput ??
    cabinetQuery ??
    pick("journal-title")
  )?.focus();
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
      for (const item of dates.get(date) ?? []) cell.append(recordControl(item));
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

function renderDayList(week, groups, memoText) {
  const date = selectedDate();
  const row = element("div", "", "week-days");
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "요일 선택");
  for (const [index, day] of week.entries()) row.append(weekDayButton(day, index));
  content.append(row);
  const list = element("div", "", "week-work-list");
  const entries = groups.flatMap(({ category, dates }) =>
    (dates.get(date) ?? []).map((item) => ({ item, category })),
  );
  for (const { category, dates } of groups) {
    const items = dates.get(date);
    if (!items) continue;
    const section = element("section", "", "week-work-group work-stripe");
    section.dataset.workColor = category.color;
    section.append(element("h2", category.name));
    for (const item of items) section.append(recordControl(item));
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
  const week = days();
  searchPeriod.options[1].textContent = `선택한 주 (${shortDate(week[0])}–${shortDate(week[6])})`;
  const query = queryInput.value.trim().toLocaleLowerCase();
  if (!query) {
    content.append(element("p", "검색어를 입력해 주세요.", "week-empty"));
    renderRecordPanel(categories);
    return;
  }
  const tags = new Map(records("tag").map(({ value }) => [value.id, value.name]));
  const byCategory = new Map();
  for (const { value } of records("category_tag")) {
    if (!byCategory.has(value.category_id)) byCategory.set(value.category_id, []);
    byCategory.get(value.category_id).push(tags.get(value.tag_id));
  }
  const matches = items.filter(
    ({ value }) =>
      (!workFilter.value || workFilter.value === value.category_id) &&
      (searchPeriod.value !== "week" || week.includes(value.date)) &&
      [
        value.text,
        categories.get(value.category_id)?.name,
        ...(byCategory.get(value.category_id) ?? []),
      ].some((term) => typeof term === "string" && term.toLocaleLowerCase().includes(query)),
  );
  const count = element("p", `검색 결과 ${matches.length}건`, "record-meta");
  count.setAttribute("role", "status");
  content.append(count);
  if (!matches.length) content.append(element("p", "검색어 또는 필터를 바꿔 보세요.", "week-empty"));
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const list = element("ul", "", "record-list search-results");
  for (const item of matches.slice(0, 100)) {
    const category = workCategory(categories, item.value.category_id);
    const result = element("li", "", "search-result work-stripe");
    result.dataset.workColor = category.color;
    const meta = element("p", `${category.name} · ${item.value.date}`, "record-meta");
    const matchedTag = byCategory
      .get(item.value.category_id)
      ?.find((tag) => tag?.toLocaleLowerCase().includes(query));
    if (matchedTag) meta.append(" · 태그 ", highlightedText(matchedTag, pattern));
    result.append(meta, recordControl(item, pattern));
    list.append(result);
  }
  if (matches.length) content.append(list);
  if (matches.length > 100) content.append(element("p", "검색어를 좁혀 추가 기록을 확인해 주세요."));
  renderRecordPanel(categories, pattern);
}

function updateWorkFilter(categories) {
  if (!workFilter) return;
  const selected = workFilter.value;
  const options = [...categories.values()].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ko"),
  );
  const all = element("option", "전체 업무");
  all.value = "";
  workFilter.replaceChildren(
    all,
    ...options.map(({ id, name }) => {
      const option = element("option", name);
      option.value = id;
      return option;
    }),
  );
  workFilter.value = categories.has(selected) ? selected : "";
}

function showCabinet(categories) {
  const entries = cabinetEntries({
    notes: records("cabi_note").sort((a, b) =>
      String(b.value.updated_at).localeCompare(String(a.value.updated_at)),
    ),
    materials: records("cabinet_item").sort((a, b) => a.value.sort_order - b.value.sort_order),
    bindings: records("cabinet_link"),
    categories,
  });
  const needle = cabinetQuery.value.trim().toLocaleLowerCase();
  const matches = entries.filter(
    ({ kind, value, categories }) =>
      (!cabinetKind.value || kind === cabinetKind.value) &&
      (!workFilter.value || categories.some(({ id }) => id === workFilter.value)) &&
      (!needle || [value.title, value.text].some((text) => text?.toLocaleLowerCase().includes(needle))),
  );
  if (matches.length) content.append(renderCabinet(matches, selectedRecordKey, viewRecord));
  else
    content.append(
      element(
        "p",
        entries.length ? "검색 조건에 맞는 자료가 없습니다." : "등록된 자료가 없습니다.",
        "week-empty",
      ),
    );

  const selected = entries.find(({ key }) => key === selectedRecordKey);
  if (!selected) return closePanel();
  const restoreFocus = preview.contains(document.activeElement);
  heading.textContent = "자료 상세";
  preview.replaceChildren(renderMaterial(selected));
  preview.hidden = false;
  showPanel();
  if (restoreFocus) heading.focus();
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
      if (!canLeaveRecord()) return;
      discardPanelSelection();
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
  for (const link of journal.querySelectorAll("[data-view-link]")) {
    const target = new URL(link.href);
    target.searchParams.set("date", selectedDate());
    link.href = target.pathname + target.search;
  }
  if (view === "more") return renderMore();
  updateWorkFilter(categories);
  if (view === "cabinet") return showCabinet(categories);
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
    const week = weekId();
    const note = records("week_note").find(({ value }) => value.week_id === week)?.value;
    const oldMemos = records("day_memo")
      .map(({ value }) => value)
      .filter(({ date, text }) => inWeek(date) && text)
      .sort((a, b) => a.date.localeCompare(b.date));
    const images = new Map(
      records("note_asset")
        .filter(({ value }) => value.weekId === week)
        .map(({ value }) => [value.id, `${base}/note-image/${value.token}`]),
    );
    content.append(renderNotes(week, note, oldMemos, images));
    return;
  }
  if (view === "kanban") {
    destinationsByRecord.clear();
    renderKanban(items, categories, inWeek);
    renderRecordPanel(categories);
    return;
  }

  const weekly = items.filter(({ value }) => inWeek(value.date));
  if (view === "summary") return renderSummary(weekly, categories);
  const memos = new Map(records("day_memo").map(({ value }) => [value.date, value.text]));
  const groups = groupByWork(weekly, categories);
  if (view === "week" && journal.dataset.layout === "wide") renderWeekGrid(week, groups, memos);
  else renderDayList(week, groups, memos.get(date));
  renderRecordPanel(categories);
}

function renderMore() {
  const list = element("ul", "", "journal-more-list");
  for (const [target, title] of [
    ["search", "검색"],
    ["summary", "주간 요약"],
    ["notes", "주간 메모"],
    ["cabinet", "Cabi.NET"],
    ["/spaces", "온라인 워크스페이스"],
    ["/terms", "이용약관"],
    ["/privacy", "개인정보 처리방침"],
  ]) {
    const item = element("li");
    const link = element("a", title);
    link.href = target.startsWith("/") ? target : `/app/${id}/${target}?date=${selectedDate()}`;
    item.append(link);
    list.append(item);
  }
  content.append(list);
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
      discardPanelSelection();
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
      pick("record-panel-status").textContent = status.textContent;
    } finally {
      if (started === generation) moving = false;
      select.disabled = button.disabled = false;
    }
  });
  actions.append(select, button);
  return actions;
}

function showPanel() {
  const modal = journal.dataset.layout === "single";
  if (dialog.open && dialog.matches(":modal") !== modal) {
    const focused = dialog.contains(document.activeElement) ? document.activeElement : null;
    dialog.close();
    if (modal) dialog.showModal();
    else dialog.show();
    focused?.focus();
  } else if (!dialog.open) {
    if (modal) dialog.showModal();
    else dialog.show();
  }
  dialog.closest(".journal-columns").classList.add("has-detail");
}

function closePanel() {
  if (dialog.open) dialog.close();
  dialog.closest(".journal-columns").classList.remove("has-detail");
  preview.replaceChildren();
  preview.hidden = true;
}

function renderRecordPanel(categories, query) {
  if (draft || moving) {
    showPanel();
    return;
  }
  const item = keys.get("entry_item:" + selectedRecordKey);
  if (!item) {
    closePanel();
    return;
  }
  const category = workCategory(categories, item.value.category_id);
  heading.textContent = "기록 상세";
  const meta = element("p", `${category.name} · ${item.value.date}`, "record-meta");
  const actions = element("div", "", "actions record-panel-actions");
  if (view === "search") {
    const source = element("a", "원래 날짜에서 열기", "journal-tool-link");
    const params = new URLSearchParams({ date: item.value.date, record: item.key });
    source.href = `/app/${id}/day?${params}`;
    actions.append(source);
  }
  if (editable(item)) {
    const edit = element("button", "기록 편집", "primary");
    edit.type = "button";
    edit.addEventListener("click", () => openEditor(item, category.name));
    actions.append(edit);
    const destinations = destinationsByRecord.get(item.key);
    if (destinations?.length) actions.append(moveControls(item, destinations));
  }
  const message = element("p", "", "status");
  message.id = "record-panel-status";
  message.setAttribute("role", "status");
  const restoreFocus = preview.contains(document.activeElement);
  preview.replaceChildren(meta, formatRecord(item, query), actions, message);
  preview.hidden = false;
  showPanel();
  if (restoreFocus) heading.focus();
}

function viewRecord(key) {
  if (selectedRecordKey === key && dialog.open) return heading.focus();
  if (!canLeaveRecord()) return;
  closeEditor();
  const first = !selectedRecordKey;
  selectedRecordKey = key;
  updateAddress(first);
  render();
  heading.focus();
}

function warnBeforeLeaving(event) {
  event.preventDefault();
  event.returnValue = "";
}

const changed = () => draft && textInput.value !== draft.original;

function canLeaveRecord() {
  return !moving && !textInput.disabled && (!changed() || confirm("저장하지 않은 편집을 버릴까요?"));
}

function discardPanelSelection() {
  const previous = selectedRecordKey;
  closeEditor();
  closePanel();
  selectedRecordKey = null;
  if (previous)
    content.querySelector(`[data-record-key="${previous}"]`)?.setAttribute("aria-pressed", "false");
  updateAddress();
}

function dismissRecord() {
  if (!canLeaveRecord()) return;
  const previous = draft?.key ?? selectedRecordKey;
  closeEditor();
  if (hasRecordPanel && selectedRecordKey && history.state?.recordOpened) {
    history.back();
    return;
  }
  discardPanelSelection();
  if (previous) focusRecord(previous);
}

function changeDate(date) {
  if (!date || !canLeaveRecord()) return false;
  dateInput.value = date;
  if (core) discardPanelSelection();
  else updateAddress();
  render();
  return true;
}

function openEditor(item, category) {
  if (draft || moving) return;
  draft = { edit: item.edit, key: item.key, original: item.value.text, payload: null };
  editorContext.textContent = category ? `${category} · ${item.value.date}` : "";
  editorContext.hidden = !category;
  textInput.value = item.value.text;
  editorStatus.textContent = "";
  heading.textContent = "기록 편집";
  preview.hidden = true;
  editor.hidden = false;
  if (view === "search") tools.inert = true;
  showPanel();
  textInput.focus();
}
function closeEditor() {
  draft = null;
  composing = false;
  textInput.value = "";
  editor.hidden = true;
  if (view === "search") tools.inert = false;
  removeEventListener("beforeunload", warnBeforeLeaving);
  editorStatus.textContent = "";
}
let composing = false;
textInput.addEventListener("compositionstart", () => {
  composing = true;
});
textInput.addEventListener("compositionend", () => {
  composing = false;
});
textInput.addEventListener("input", () => {
  if (changed()) addEventListener("beforeunload", warnBeforeLeaving);
  else removeEventListener("beforeunload", warnBeforeLeaving);
});
editor.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!draft || composing || textInput.disabled) return;
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
    dirty = true;
    await load();
    if (dialog.open) heading.focus();
    else focusRecord(current.key);
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
pick("record-close").addEventListener("click", dismissRecord);
pick("journal-spaces").addEventListener("click", (event) => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  showSpaces();
});
pick("space-picker-close").addEventListener("click", () => spacePicker.close());
spacePicker.addEventListener("close", () => {
  if (!spacePicker.open) spacePickerList.replaceChildren();
});
pick("record-cancel").addEventListener("click", () => {
  if (!canLeaveRecord()) return;
  closeEditor();
  render();
  heading.focus();
});
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  dismissRecord();
});
addEventListener("popstate", () => {
  if (!canLeaveRecord()) return updateAddress(true);
  const previous = selectedRecordKey;
  closeEditor();
  if (dateInput) dateInput.value = dateFromAddress();
  if (hasRecordPanel) selectedRecordKey = recordFromAddress();
  render();
  if (dialog.open) heading.focus();
  else if (previous) focusRecord(previous);
});
refresh.addEventListener("click", () => load(!draft));
for (const direction of [
  ["period-prev", -1],
  ["period-next", 1],
]) {
  pick(direction[0])?.addEventListener("click", () => {
    changeDate(shift(selectedDate(), direction[1] * (view === "day" ? 1 : 7)));
  });
}
dateInput?.addEventListener("change", () => {
  if (!changeDate(dateInput.value)) dateInput.value = dateFromAddress();
});
pick("journal-today")?.addEventListener("click", () => {
  changeDate(localToday());
});
if (hasRecordPanel) {
  updateLayout();
  new ResizeObserver(updateLayout).observe(content.closest(".journal-body"));
}
if (["search", "summary", "notes", "cabinet"].includes(view)) {
  const compactNav = matchMedia("(max-width: 1159px)");
  const more = journal.querySelector('.journal-nav [data-view-link="more"]');
  const updateCurrent = () => {
    if (compactNav.matches) more.setAttribute("aria-current", "location");
    else more.removeAttribute("aria-current");
  };
  compactNav.addEventListener("change", updateCurrent);
  updateCurrent();
}
function updateResults() {
  if (selectedRecordKey) discardPanelSelection();
  render();
}
queryInput?.addEventListener("input", updateResults);
cabinetQuery?.addEventListener("input", updateResults);
for (const filter of [workFilter, searchPeriod, cabinetKind])
  filter?.addEventListener("change", updateResults);
pick("board-period")?.addEventListener("change", (event) => {
  const input = event.target;
  if (!canLeaveRecord()) {
    input.value = input.dataset.current || "week";
    return;
  }
  input.dataset.current = input.value;
  discardPanelSelection();
  render();
});
function currentSummary() {
  const categories = new Map(records("category").map(({ value }) => [value.id, value]));
  const week = days();
  return summary(
    records("entry_item")
      .filter(({ value }) => typeof value.date === "string" && value.date >= week[0] && value.date <= week[6])
      .sort(itemSort),
    categories,
  );
}
pick("journal-copy")?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(currentSummary().notes);
    status.textContent = "요약을 복사했습니다.";
  } catch {
    status.textContent = "요약을 복사하지 못했습니다. 본문을 선택해 복사할 수 있습니다.";
  }
});
pick("journal-download")?.addEventListener("click", () => {
  const data = currentSummary();
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
  if (!event.persisted) return;
  if (hasRecordPanel) selectedRecordKey = recordFromAddress();
  if (dateInput) dateInput.value = dateFromAddress();
  load(true);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) load();
});
setInterval(() => {
  if (!document.hidden && complete) load();
}, 30000);
load(true);
