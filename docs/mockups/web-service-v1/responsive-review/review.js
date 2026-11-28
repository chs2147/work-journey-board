const $ = (id) => document.getElementById(id);
const frame = $("frame");
const content = $("content");
const detail = $("detail");
const sheet = $("sheet");
const demoToday = "2026-11-26";
const dayMs = 86400000;
const days = ["월", "화", "수", "목", "금", "토", "일"];
const lanes = { todo: "TODO", progress: "진행 중", parked: "파킹랏", done: "DONE" };
const spaces = {
  sample: { name: "서비스 기획팀", initial: "기", categories: ["product", "ops", "support"] },
  training: { name: "온보딩 실습", initial: "온", categories: ["guide"] },
};
const categories = {
  product: { name: "제품 개선", color: "#2a78d6" },
  ops: { name: "운영 점검", color: "#eb6834" },
  support: { name: "고객 지원", color: "#1baf7a" },
  guide: { name: "이용 가이드", color: "#6250d6" },
};
const records = [
  [
    "product",
    "2026-11-23",
    "설정 화면 문구 검토",
    "done",
    "",
    "계정과 사용량 화면의 버튼 명칭을 정리했습니다.",
  ],
  ["ops", "2026-11-24", "정기 운영 점검", "done", "", "동기화와 알림 발송 현황을 확인했습니다."],
  ["support", "2026-11-24", "자주 묻는 질문 분류", "done"],
  ["product", "2026-11-25", "모바일 기록 입력 검토", "progress", "2026-11-27"],
  ["ops", "2026-11-25", "저장 재시도 문구 확인", "todo", "2026-11-25"],
  [
    "product",
    demoToday,
    "주간 보고서 초안 작성",
    "todo",
    demoToday,
    "계정 계층과 이번 주 변경 사항을 정리합니다.\n검토용 캡처는 주간 메모에 첨부합니다.",
    true,
  ],
  [
    "product",
    demoToday,
    "워크스페이스 전환 시안 확인",
    "todo",
    "2026-11-28",
    "휴대폰과 펼친 폴드에서 공간을 전환해 봅니다.",
  ],
  [
    "ops",
    demoToday,
    "웹·데스크탑 동기화 확인",
    "progress",
    "2026-11-27",
    "같은 가상 공간에서 웹과 데스크탑의 기록을 대조합니다.",
  ],
  ["support", demoToday, "문의 답변 양식 공유", "done", "", "정리한 답변 양식을 팀에 공유했습니다."],
  ["product", "2026-11-27", "주간 검토 회의", "todo"],
  ["support", "2026-11-27", "이용 가이드 링크 확인", "todo"],
  ["ops", "2026-11-18", "주간 알림 설정 개선", "parked", "", "이전 주에 보류한 항목입니다."],
  ["guide", demoToday, "첫 기록 작성 가이드 읽기", "todo", "", "실습 공간에만 있는 예시입니다."],
].map(([category, date, title, lane, due, text, important], index) => ({
  id: "r" + (index + 1),
  category,
  date,
  title,
  lane,
  due,
  text: text ?? "",
  important,
}));
const screens = {
  day: [
    "오늘",
    "데일리 보드",
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4m8-4v4m-8 8h4"/>',
  ],
  week: [
    "주간",
    "주간 보드",
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18m-12 0v11m6-11v11"/>',
  ],
  kanban: [
    "칸반",
    "칸반 보드",
    '<rect x="3" y="4" width="4" height="11"/><rect x="10" y="4" width="4" height="16"/><rect x="17" y="4" width="4" height="13"/>',
  ],
  more: [
    "더 보기",
    "더 보기",
    '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  ],
  search: ["검색", "기록 검색", '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>'],
  notes: [
    "주간 메모",
    "주간 메모",
    '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8m-8 4h6"/>',
  ],
  summary: ["주간 요약", "주간 요약", '<path d="M5 4h14v16H5zm4 5h6m-6 4h6m-6 4h4"/>'],
};
const iconPaths = {
  prev: '<path d="m14 6-6 6 6 6"/>',
  next: '<path d="m10 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  filter: '<path d="M4 6h16M7 12h10m-7 6h4"/>',
  handle: '<path d="M8 6h1m6 0h1M8 12h1m6 0h1m-8 6h1m6 0h1"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};
const svg = (path) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + path + "</svg>";
const icon = (name) => svg(iconPaths[name]);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const shift = (date, amount) => new Date(Date.parse(date) + amount * dayMs).toISOString().slice(0, 10);
const weekDays = (date) => {
  const day = (new Date(date).getUTCDay() + 6) % 7;
  return days.map((_, i) => shift(date, i - day));
};
const short = (date) => date.split("-").slice(1).map(Number).join("/");
const route = { view: "week", date: demoToday, space: "sample", section: "todo", record: null };
let state = { ...route };
let draft = null;
let composing = false;
let modalOrigin = null;
let closingAction = null;
let nextRecord = records.length + 1;
let toast;
let drag = null;
let search = "";
const filters = new Map();
const orders = new Map();
const prefs = () => {
  if (!filters.has(state.space)) filters.set(state.space, { category: "", period: "week", parked: "all" });
  return filters.get(state.space);
};
const spaceRows = () => records.filter((row) => spaces[state.space].categories.includes(row.category));
const visibleRows = () => spaceRows().filter((row) => !prefs().category || row.category === prefs().category);
const byId = (id) => records.find((row) => row.id === id);
const selected = () => byId(state.record);
const openDraft = () => draft && (draft.id === null || draft.id === state.record);
const getOrderKey = (lane) => state.space + "/" + lane;

function announce(text) {
  const node = $("feedback");
  clearTimeout(toast);
  node.hidden = false;
  node.textContent = text;
  toast = setTimeout(() => {
    node.hidden = true;
  }, 3000);
}

function routeUrl() {
  const params = new URLSearchParams({ view: state.view, date: state.date, space: state.space });
  if (state.view === "kanban") params.set("section", state.section);
  if (state.record) params.set("record", state.record);
  return "#" + params;
}

function go(next, options = {}) {
  if (draft?.changed && !options.discard) {
    confirmDiscard(() => go(next, { ...options, discard: true }));
    return;
  }
  const previous = state.record;
  draft = null;
  state = { ...state, ...next };
  if ("view" in next && !("record" in next)) state.record = null;
  const index = history.state?.index ?? 0;
  if (options.replace) history.replaceState({ index }, "", routeUrl());
  else history.pushState({ index: index + 1 }, "", routeUrl());
  if ("space" in next || "view" in next || "date" in next || "section" in next) content.scrollTop = 0;
  render();
  if (state.record) detail.querySelector("h3")?.focus();
  else if (options.control) document.querySelector(options.control)?.focus();
  else if (previous || options.focus || "view" in next) restoreFocus(previous);
}

function readRoute() {
  const params = new URLSearchParams(location.hash.slice(1));
  const view = params.get("view");
  const date = params.get("date");
  const space = params.get("space");
  const section = params.get("section");
  const row = byId(params.get("record"));
  const spaceId = Object.hasOwn(spaces, space) ? space : route.space;
  return {
    view: Object.hasOwn(screens, view) ? view : route.view,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) ? date : route.date,
    space: spaceId,
    section: Object.hasOwn(lanes, section) ? section : route.section,
    record: row && spaces[spaceId].categories.includes(row.category) ? row.id : null,
  };
}

function restoreFocus(id) {
  ((id && content.querySelector('[data-record="' + id + '"]')) || $("view-title"))?.focus();
}

function syncLayout() {
  if (composing) return;
  const width = frame.clientWidth;
  const nav = width >= 1160 ? "full" : width >= 600 ? "rail" : "bottom";
  const available = width - (nav === "full" ? 212 : nav === "rail" ? 96 : 24);
  const layout = width >= 1024 && available >= 880 ? "wide" : available >= 616 ? "split" : "single";
  if (frame.dataset.nav === nav && frame.dataset.layout === layout) return;
  const focused = detail.contains(document.activeElement) ? document.activeElement.id : "";
  const selection = ["record-title", "record-body"].includes(focused)
    ? [document.activeElement.selectionStart, document.activeElement.selectionEnd]
    : null;
  frame.dataset.nav = nav;
  frame.dataset.layout = layout;
  render();
  if (focused) {
    const element = $(focused);
    element?.focus();
    if (selection) element?.setSelectionRange(...selection);
  }
}

function nav() {
  const primary = ["day", "week", "kanban"];
  const all =
    frame.dataset.nav === "full" ? [...primary, "search", "notes", "summary", "more"] : [...primary, "more"];
  $("nav").innerHTML = all
    .map((view) => {
      const [label, , path] = screens[view];
      const active = state.view === view || (view === "more" && !all.includes(state.view));
      return (
        '<button type="button" data-view="' +
        view +
        '" class="' +
        (view === "search" ? "secondary-start" : "") +
        '" ' +
        (active ? 'aria-current="page"' : "") +
        ">" +
        svg(path) +
        "<span>" +
        label +
        "</span></button>"
      );
    })
    .join("");
}

function action(label, name, iconName, className = "quiet") {
  return (
    '<button type="button" class="with-icon ' +
    className +
    '" data-action="' +
    name +
    '">' +
    (iconName ? icon(iconName) : "") +
    esc(label) +
    "</button>"
  );
}

function dayButton(date, index) {
  const style = (date === demoToday ? " day-today" : "") + (date === state.date ? " day-active" : "");
  return (
    '<button type="button" class="' +
    style +
    '" data-day="' +
    date +
    '" aria-pressed="' +
    (date === state.date) +
    '" aria-label="' +
    short(date) +
    " " +
    days[index] +
    "요일" +
    (date === demoToday ? " 오늘" : "") +
    '"><span class="day-name">' +
    days[index] +
    '</span><time datetime="' +
    date +
    '">' +
    short(date) +
    "</time></button>"
  );
}

function toolbar() {
  const { view } = state;
  const week = weekDays(state.date);
  let tools = "";
  const canDate = ["day", "week", "notes", "summary", "kanban"].includes(view);
  const day = view === "day";
  if (canDate) {
    const title = day
      ? short(state.date) + " (" + days[week.indexOf(state.date)] + ")"
      : short(week[0]) + " – " + short(week[6]);
    tools =
      '<div class="tool-row"><div class="date-tools"><button type="button" class="icon-button" data-action="previous" aria-label="' +
      (day ? "이전 날" : "이전 주") +
      '">' +
      icon("prev") +
      '</button><span class="range">' +
      title +
      '</span><button type="button" class="icon-button" data-action="next" aria-label="' +
      (day ? "다음 날" : "다음 주") +
      '">' +
      icon("next") +
      "</button>" +
      action("오늘", "today") +
      "</div>" +
      (["day", "week", "kanban"].includes(view)
        ? action(prefs().category || prefs().period === "all" ? "필터 적용됨" : "필터", "filters", "filter")
        : "") +
      "</div>";
  }
  if (view === "week") {
    tools +=
      '<div class="inline-actions week-links"><button type="button" data-view="notes" class="quiet">주간 메모</button><button type="button" data-view="summary" class="quiet">주간 요약</button></div>';
  }
  if (view === "day" || (view === "week" && frame.dataset.layout !== "wide")) {
    tools +=
      '<div class="day-strip" role="group" aria-label="요일 선택">' + week.map(dayButton).join("") + "</div>";
  }
  if (view === "kanban" && frame.dataset.layout !== "wide") {
    tools +=
      '<div class="lane-tools"><label for="active-lane">섹션</label><select id="active-lane">' +
      Object.keys(lanes)
        .map(
          (key) =>
            '<option value="' +
            key +
            '" ' +
            (key === state.section ? "selected" : "") +
            ">" +
            lanes[key] +
            " (" +
            laneRows(key).length +
            ")</option>",
        )
        .join("") +
      "</select></div>";
  }
  $("toolbar").innerHTML =
    '<div class="title-row"><h2 id="view-title" tabindex="-1">' +
    screens[view][1] +
    "</h2>" +
    (["day", "kanban"].includes(view) ? action("기록 추가", "add", "add", "primary") : "") +
    "</div>" +
    tools;
}

function chip(row) {
  if (!row.due || row.lane === "done") return "";
  const delta = Math.round((Date.parse(row.due) - Date.parse(demoToday)) / dayMs);
  if (delta > 2) return "";
  const label = delta < 0 ? "마감 초과 " + -delta + "일" : delta === 0 ? "오늘 마감" : "마감 D-" + delta;
  return (
    '<span class="due ' + (delta <= 0 ? (delta === 0 ? "today" : "late") : "") + '">' + label + "</span>"
  );
}

function recordButton(row, showWork = false) {
  const mark =
    row.lane === "done"
      ? '<span class="record-mark done" aria-label="완료">✓</span>'
      : row.important
        ? '<span class="record-mark" aria-label="중요">★</span>'
        : "";
  return (
    '<button type="button" class="record" data-record="' +
    row.id +
    '" aria-pressed="' +
    (state.record === row.id) +
    '"><span class="record-title">' +
    mark +
    "<span>" +
    esc(row.title) +
    "</span></span>" +
    chip(row) +
    (showWork ? '<span class="record-meta">' + categories[row.category].name + "</span>" : "") +
    "</button>"
  );
}

function dayList() {
  const onDate = visibleRows().filter((row) => row.date === state.date);
  if (!onDate.length)
    return (
      '<div class="empty"><p>선택한 날의 기록이 없습니다.</p>' + action("기록 추가", "add", "add") + "</div>"
    );
  return (
    '<div class="stack">' +
    spaces[state.space].categories
      .map((category) => {
        const rows = onDate.filter((row) => row.category === category);
        if (!rows.length) return "";
        return (
          '<section class="task-group stripe" style="--work-color:' +
          categories[category].color +
          '"><h3>' +
          categories[category].name +
          '<button type="button" class="icon-button" data-add="' +
          category +
          '" aria-label="' +
          categories[category].name +
          ' 기록 추가">' +
          icon("add") +
          "</button></h3>" +
          rows.map((row) => recordButton(row)).join("") +
          "</section>"
        );
      })
      .join("") +
    "</div>"
  );
}

function weeklyGrid() {
  const week = weekDays(state.date);
  const rows = visibleRows();
  const cats = spaces[state.space].categories.filter(
    (category) => !prefs().category || prefs().category === category,
  );
  const head = week
    .map(
      (date, i) =>
        '<th scope="col" class="' + (i >= 5 ? "weekend" : "") + '">' + dayButton(date, i) + "</th>",
    )
    .join("");
  const cells = cats
    .map((category) => {
      const work = categories[category];
      const columns = week
        .map(
          (date, i) =>
            '<td class="' +
            (i >= 5 ? "weekend" : "") +
            '" data-today="' +
            (date === demoToday) +
            '">' +
            (rows
              .filter((row) => row.category === category && row.date === date)
              .map((row) => recordButton(row))
              .join("") || '<span class="empty-cell"></span>') +
            "</td>",
        )
        .join("");
      return (
        '<tr><th scope="row" style="--work-color:' +
        work.color +
        '">' +
        work.name +
        "</th>" +
        columns +
        "</tr>"
      );
    })
    .join("");
  return (
    '<table class="week-grid" aria-label="업무와 요일별 주간 기록"><thead><tr><th scope="col">업무</th>' +
    head +
    "</tr></thead><tbody>" +
    cells +
    "</tbody></table>"
  );
}

function laneRows(lane, ignoreFilter = false) {
  const week = weekDays(state.date);
  const period = lane === "parked" && prefs().parked === "all" ? "all" : prefs().period;
  const candidates = (ignoreFilter ? spaceRows() : visibleRows()).filter(
    (row) => row.lane === lane && (ignoreFilter || period === "all" || week.includes(row.date)),
  );
  const order = orders.get(getOrderKey(lane)) ?? [];
  const rank = (row) =>
    order.includes(row.id) ? order.indexOf(row.id) : order.length + records.indexOf(row);
  return candidates.sort((a, b) => rank(a) - rank(b));
}

function kanban() {
  const columns = frame.dataset.layout === "wide" ? Object.keys(lanes) : [state.section];
  return (
    '<div class="lanes">' +
    columns
      .map((lane) => {
        const rows = laneRows(lane);
        const status = lane === "parked" && prefs().parked === "all" ? "<small>전체 기간</small>" : "";
        const cards = rows
          .map(
            (row) =>
              '<article class="kanban-card stripe" style="--work-color:' +
              categories[row.category].color +
              '" data-card="' +
              row.id +
              '">' +
              recordButton(row, true) +
              '<button type="button" class="handle" data-handle="' +
              row.id +
              '" aria-label="' +
              esc(row.title) +
              ' 순서 이동" aria-description="위아래 화살표로 같은 섹션에서 이동">' +
              icon("handle") +
              "</button></article>",
          )
          .join("");
        const reset = orders.has(getOrderKey(lane))
          ? '<button type="button" data-reset="' + lane + '">기본 정렬</button>'
          : "";
        return (
          '<section class="lane" data-lane="' +
          lane +
          '"><header class="lane-head"><h3>' +
          lanes[lane] +
          "</h3><small>" +
          rows.length +
          "건</small>" +
          status +
          reset +
          '</header><div class="lane-cards">' +
          (cards || '<p class="empty">표시할 카드가 없습니다.</p>') +
          "</div></section>"
        );
      })
      .join("") +
    "</div>"
  );
}

function related() {
  if (state.view === "more")
    return (
      '<div class="menu-list">' +
      ["search", "notes", "summary"]
        .map(
          (view) =>
            '<button type="button" class="with-icon" data-view="' +
            view +
            '">' +
            svg(screens[view][2]) +
            screens[view][0] +
            "</button>",
        )
        .join("") +
      "</div>"
    );
  if (state.view === "search") {
    const query = search.trim().toLowerCase();
    const matches = query
      ? spaceRows().filter((row) =>
          [row.title, row.text, categories[row.category].name].some((text) =>
            text.toLowerCase().includes(query),
          ),
        )
      : [];
    return (
      '<div class="stack"><form id="search-form" class="search-form"><input type="search" name="query" aria-label="검색어" value="' +
      esc(search) +
      '" placeholder="업무 또는 기록 검색"><button class="primary">검색</button></form>' +
      (query
        ? '<div class="task-group">' +
          (matches.map((row) => recordButton(row, true)).join("") ||
            '<p class="empty">검색 결과가 없습니다.</p>') +
          "</div>"
        : "") +
      "</div>"
    );
  }
  const week = weekDays(state.date);
  const backlink = '<button type="button" class="quiet" data-view="week">주간 보드</button>';
  if (state.view === "summary") {
    const rows = spaceRows().filter((row) => week.includes(row.date));
    return (
      '<div class="stack"><div class="memo"><h3>업무별 집계</h3>' +
      (rows.length
        ? spaces[state.space].categories
            .map(
              (category) =>
                "<p>" +
                categories[category].name +
                " · " +
                rows.filter((row) => row.category === category).length +
                "건</p>",
            )
            .join("")
        : "<p>이번 주 기록이 없습니다.</p>") +
      "</div><div>" +
      backlink +
      "</div></div>"
    );
  }
  const note =
    state.space === "sample" && week.includes(demoToday)
      ? "주간 검토에서 스마트폰과 펼친 폴드의 기록 입력 흐름을 확인합니다."
      : "이번 주 메모가 없습니다.";
  return (
    '<div class="stack"><article class="memo"><h3>검토 메모</h3><p>' +
    note +
    "</p></article><div>" +
    backlink +
    "</div></div>"
  );
}

function renderDetail() {
  const row = selected();
  const editing = openDraft();
  detail.hidden = !row && !editing;
  $("panels").classList.toggle("has-detail", !detail.hidden);
  detail.dataset.editing = String(Boolean(editing));
  const single = frame.dataset.layout === "single" && !detail.hidden;
  content.inert = single;
  $("toolbar").inert = single;
  if (detail.hidden) {
    detail.replaceChildren();
    return;
  }
  const head =
    '<header class="detail-header"><h3 id="detail-title" tabindex="-1">' +
    (editing ? (row ? "기록 편집" : "기록 추가") : "기록 상세") +
    '</h3><button type="button" class="icon-button" data-action="close" aria-label="목록으로 돌아가기">' +
    icon("close") +
    "</button></header>";
  if (editing) {
    const form =
      '<form id="record-form" class="detail-body">' +
      (!draft.id
        ? '<label for="record-category">업무</label><select id="record-category" name="category">' +
          spaces[state.space].categories
            .map(
              (category) =>
                '<option value="' +
                category +
                '" ' +
                (draft.category === category ? "selected" : "") +
                ">" +
                categories[category].name +
                "</option>",
            )
            .join("") +
          "</select>"
        : "") +
      '<label for="record-title">기록</label><textarea id="record-title" name="title" rows="2" maxlength="120" required>' +
      esc(draft.title) +
      '</textarea><label for="record-body">세부 내용</label><textarea id="record-body" name="body" rows="4" maxlength="500">' +
      esc(draft.text) +
      "</textarea><small>" +
      short(newRowDate()) +
      "</small></form>";
    detail.innerHTML =
      head +
      form +
      '<footer class="detail-footer"><button type="submit" form="record-form" class="primary">저장</button>' +
      action("편집 취소", "cancel-edit") +
      "</footer>";
  } else {
    const due = row.due ? "<small>마감 " + short(row.due) + "</small>" : "";
    detail.innerHTML =
      head +
      '<div class="detail-body"><div class="context-row"><small>' +
      categories[row.category].name +
      " · " +
      short(row.date) +
      "</small><small>" +
      lanes[row.lane] +
      "</small></div><h4>" +
      esc(row.title) +
      "</h4>" +
      chip(row) +
      (row.text ? "<p>" + esc(row.text) + "</p>" : "") +
      due +
      '</div><footer class="detail-footer">' +
      action("편집", "edit", "", "primary") +
      (state.view === "kanban" ? action("상태 이동", "move") : "") +
      "</footer>";
  }
}

function newRowDate() {
  return selected()?.date ?? state.date;
}

function render() {
  const space = spaces[state.space];
  $("space-picker").innerHTML =
    '<span class="monogram" aria-hidden="true">' +
    space.initial +
    '</span><span class="space-name">' +
    space.name +
    "</span>" +
    icon("down");
  $("space-picker").setAttribute("aria-label", "워크스페이스 전환 · " + space.name);
  nav();
  toolbar();
  const scroll = content.scrollTop;
  if (state.view === "day") content.innerHTML = dayList();
  else if (state.view === "week")
    content.innerHTML = frame.dataset.layout === "wide" ? weeklyGrid() : dayList();
  else if (state.view === "kanban") content.innerHTML = kanban();
  else content.innerHTML = related();
  content.scrollTop = scroll;
  renderDetail();
}

function displaySheet(title, body) {
  if (!sheet.open) modalOrigin = document.activeElement;
  sheet.innerHTML = '<div class="sheet-inner"><h2 id="sheet-title">' + title + "</h2>" + body + "</div>";
  if (!sheet.open) sheet.showModal();
  sheet.querySelector("button, select")?.focus();
}

function closeSheet() {
  if (sheet.open) sheet.close();
}

function confirmDiscard(next) {
  closingAction = next;
  displaySheet(
    "편집을 그만둘까요?",
    '<p>저장하지 않은 입력이 있습니다.</p><div class="inline-actions">' +
      action("계속 편집", "close-sheet", "", "primary") +
      action("변경 버리기", "discard") +
      "</div>",
  );
}

function startEdit(row, category) {
  if (draft?.changed) {
    confirmDiscard(() => {
      draft = null;
      startEdit(row, category);
    });
    return;
  }
  if (!row && state.record) go({ record: null }, { replace: true });
  draft = {
    id: row?.id ?? null,
    title: row?.title ?? "",
    text: row?.text ?? "",
    category: row?.category ?? category ?? (prefs().category || spaces[state.space].categories[0]),
    changed: false,
  };
  renderDetail();
  $("record-title")?.focus();
}

function leaveDetail() {
  if (state.record) go({ record: null }, { replace: true });
  else if (draft?.changed)
    confirmDiscard(() => {
      draft = null;
      renderDetail();
      restoreFocus(null);
    });
  else {
    draft = null;
    renderDetail();
    restoreFocus(null);
  }
}

function cancelEdit() {
  const cancel = () => {
    draft = null;
    renderDetail();
    if (state.record) $("detail-title")?.focus();
    else restoreFocus(null);
  };
  if (draft?.changed) confirmDiscard(cancel);
  else cancel();
}

function reorder(id, target, fromPointer = false) {
  const row = byId(id);
  if (!row) return;
  const visible = laneRows(row.lane);
  const from = visible.indexOf(row);
  const to = visible.findIndex((entry) => entry.id === target);
  if (from < 0 || to < 0 || from === to) return;
  const full = laneRows(row.lane, true);
  const sequence = visible.map((entry) => entry.id);
  sequence.splice(to, 0, sequence.splice(from, 1)[0]);
  const visibleIds = new Set(sequence);
  orders.set(
    getOrderKey(row.lane),
    full.map((entry) => (visibleIds.has(entry.id) ? sequence.shift() : entry.id)),
  );
  render();
  if (!fromPointer) content.querySelector('[data-handle="' + id + '"]')?.focus();
  announce("카드 순서를 변경했습니다.");
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const { action: command, size, day, view, record, add, space, move, reset } = button.dataset;
  if (size) {
    frame.dataset.size = size;
    document
      .querySelectorAll("[data-size][aria-pressed]")
      .forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    syncLayout();
  } else if (view) go({ view });
  else if (day) go({ date: day, record: null }, { control: '[data-day="' + day + '"]' });
  else if (record) go({ record });
  else if (add) startEdit(null, add);
  else if (space) {
    closeSheet();
    if (space !== state.space) go({ space, record: null }, { focus: true });
  } else if (move) {
    const row = selected();
    if (!row || row.lane === move) return;
    closeSheet();
    row.lane = move;
    go({ section: move, record: null }, { focus: true });
    announce(lanes[move] + " 섹션으로 옮겼습니다.");
  } else if (reset) {
    orders.delete(getOrderKey(reset));
    render();
    announce("기본 정렬을 적용했습니다.");
  } else if (command === "spaces") {
    displaySheet(
      "온라인 워크스페이스",
      '<div class="menu-list">' +
        Object.entries(spaces)
          .map(
            ([id, value]) =>
              '<button type="button" class="space-option" data-space="' +
              id +
              '"><span class="monogram" aria-hidden="true">' +
              value.initial +
              "</span>" +
              value.name +
              (state.space === id ? " ✓" : "") +
              "</button>",
          )
          .join("") +
        "</div>" +
        action("닫기", "close-sheet"),
    );
  } else if (["previous", "next", "today"].includes(command)) {
    const offset = (command === "previous" ? -1 : 1) * (state.view === "day" ? 1 : 7);
    go({ date: command === "today" ? demoToday : shift(state.date, offset), record: null });
  } else if (command === "close") leaveDetail();
  else if (command === "edit") startEdit(selected());
  else if (command === "add") startEdit(null);
  else if (command === "cancel-edit") cancelEdit();
  else if (command === "close-sheet") closeSheet();
  else if (command === "discard") {
    const action = closingAction;
    closeSheet();
    action?.();
  } else if (command === "move") {
    displaySheet(
      "이동할 섹션",
      '<div class="menu-list">' +
        Object.entries(lanes)
          .filter(([id]) => id !== selected()?.lane)
          .map(([id, label]) => '<button type="button" data-move="' + id + '">' + label + "</button>")
          .join("") +
        "</div>" +
        action("취소", "close-sheet"),
    );
  } else if (command === "filters") {
    const categoryOptions = spaces[state.space].categories
      .map(
        (category) =>
          '<option value="' +
          category +
          '" ' +
          (prefs().category === category ? "selected" : "") +
          ">" +
          categories[category].name +
          "</option>",
      )
      .join("");
    const periods =
      state.view === "kanban"
        ? '<label for="period-filter">상단 기간</label><select id="period-filter" name="period"><option value="week">선택한 주</option><option value="all" ' +
          (prefs().period === "all" ? "selected" : "") +
          '>전체 기간</option></select><label for="parked-filter">파킹랏 기간</label><select id="parked-filter" name="parked"><option value="week">상단 기간과 같음</option><option value="all" ' +
          (prefs().parked === "all" ? "selected" : "") +
          ">전체 기간</option></select>"
        : "";
    displaySheet(
      "필터",
      '<form id="filter-form" class="stack"><label for="category-filter">업무</label><select id="category-filter" name="category"><option value="">전체 업무</option>' +
        categoryOptions +
        "</select>" +
        periods +
        '<div class="inline-actions"><button class="primary">적용</button>' +
        action("닫기", "close-sheet") +
        "</div></form>",
    );
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "active-lane")
    go({ section: event.target.value, record: null }, { control: "#active-lane" });
});

document.addEventListener("input", (event) => {
  if (!draft || event.target.form?.id !== "record-form") return;
  if (event.target.name === "title") draft.title = event.target.value;
  if (event.target.name === "body") draft.text = event.target.value;
  if (event.target.name === "category") draft.category = event.target.value;
  draft.changed = true;
});

document.addEventListener("compositionstart", () => {
  composing = true;
});
document.addEventListener("compositionend", () => {
  composing = false;
  setTimeout(syncLayout, 0);
});
document.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.id === "record-form" && draft && !composing) {
    const title = draft.title.trim();
    if (!title) {
      $("record-title").focus();
      return;
    }
    let row = draft.id && byId(draft.id);
    if (!row) {
      row = {
        id: "r" + nextRecord++,
        category: draft.category,
        date: state.date,
        lane: state.view === "kanban" ? state.section : "todo",
      };
      records.push(row);
    }
    row.title = title;
    row.text = draft.text.trim();
    go({ record: row.id }, { discard: true, replace: true });
    announce("시안에 저장했습니다.");
  } else if (event.target.id === "search-form") {
    search = new FormData(event.target).get("query");
    render();
    $("search-form").elements.query.focus();
  } else if (event.target.id === "filter-form") {
    const data = new FormData(event.target);
    Object.assign(prefs(), Object.fromEntries(data));
    closeSheet();
    go({ record: null }, { focus: true, replace: true });
  }
});

sheet.addEventListener("close", () => {
  closingAction = null;
  if (modalOrigin?.isConnected) modalOrigin.focus();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !sheet.open && !detail.hidden && !event.isComposing) {
    event.preventDefault();
    leaveDetail();
    return;
  }
  const id = event.target.dataset.handle;
  if (!id || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const rows = laneRows(byId(id).lane);
  const index = rows.findIndex((row) => row.id === id);
  reorder(id, rows[index + (event.key === "ArrowUp" ? -1 : 1)]?.id);
});

document.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest("[data-handle]");
  if (!handle || event.button !== 0) return;
  drag = {
    pointer: event.pointerId,
    id: handle.dataset.handle,
    x: event.clientX,
    y: event.clientY,
    target: null,
  };
  handle.setPointerCapture?.(event.pointerId);
});

document.addEventListener("pointermove", (event) => {
  if (
    !drag ||
    event.pointerId !== drag.pointer ||
    (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5 && !drag.target)
  )
    return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-card]");
  const row = target && byId(target.dataset.card);
  document.querySelector("[data-drop]")?.removeAttribute("data-drop");
  drag.target = row && row.lane === byId(drag.id)?.lane && row.id !== drag.id ? target : null;
  if (drag.target) drag.target.dataset.drop = "true";
});

function endDrag(event, apply) {
  if (!drag || event.pointerId !== drag.pointer) return;
  const { id, target } = drag;
  drag = null;
  target?.removeAttribute("data-drop");
  if (apply && target) reorder(id, target.dataset.card, true);
}

document.addEventListener("pointerup", (event) => endDrag(event, true));
document.addEventListener("pointercancel", (event) => endDrag(event, false));

addEventListener("popstate", () => {
  const previous = state.record;
  const next = readRoute();
  const apply = () => {
    draft = null;
    state = next;
    render();
    if (state.record) $("detail-title")?.focus();
    else restoreFocus(previous);
  };
  if (draft?.changed) {
    const destination = location.hash;
    history.pushState(history.state, "", routeUrl());
    confirmDiscard(() => {
      history.replaceState(history.state, "", destination);
      apply();
    });
  } else apply();
});

state = readRoute();
history.replaceState({ index: 0 }, "", routeUrl());
syncLayout();
render();
new ResizeObserver(syncLayout).observe(frame);
