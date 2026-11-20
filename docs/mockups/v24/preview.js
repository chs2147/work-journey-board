"use strict";

const colors = { teal: "#3d7968", amber: "#ac733f", plum: "#805479" };
const choice = { color: "teal", icon: "↗" };

function updatePressed(selector, current) {
  document.querySelectorAll(selector).forEach((button) => {
    button.setAttribute("aria-pressed", String(button === current));
  });
}

document.querySelectorAll("[data-color]").forEach((button) => {
  button.addEventListener("click", () => {
    choice.color = button.dataset.color;
    updatePressed("[data-color]", button);
  });
});
document.querySelectorAll("[data-icon]").forEach((button) => {
  button.addEventListener("click", () => {
    choice.icon = button.dataset.icon;
    updatePressed("[data-icon]", button);
  });
});
document.querySelector("#publish-example").addEventListener("click", () => {
  document.querySelectorAll("[data-workspace-mark]").forEach((mark) => {
    mark.textContent = choice.icon;
    mark.style.setProperty("--workspace-color", colors[choice.color]);
  });
});
document.querySelectorAll("[data-cabinet]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector("#cabinet-result").textContent = button.dataset.cabinet;
  });
});

const board = document.querySelector("#board-template");
for (const preview of document.querySelectorAll(".board-preview")) {
  preview.append(board.content.cloneNode(true));
}
document.querySelector("#loading-action").addEventListener("change", (event) => {
  for (const target of document.querySelectorAll(".loading-copy")) {
    target.textContent = event.target.value;
  }
});
document.querySelector("#loading-theme").addEventListener("change", (event) => {
  document.querySelector(".loading-comparison").dataset.theme = event.target.value;
});

const sections = [
  { id: "todo", name: "TODO", icon: "▤" },
  { id: "monitoring", name: "모니터링", icon: "◉", period: "all" },
  { id: "parking", name: "파킹랏", icon: "◫", period: "inherit" },
  { id: "done", name: "DONE", icon: "✓" },
];
const cards = [
  {
    id: "t1",
    section: "todo",
    name: "질문지 초안 공유",
    day: "2026-11-19",
    due: "마감 D-2",
    severity: "soon",
  },
  {
    id: "t2",
    section: "todo",
    name: "리뷰 요청 정리",
    day: "2026-11-17",
    due: "오늘 마감",
    severity: "today",
  },
  { id: "t3", section: "todo", name: "이전 주 인터뷰 요청", day: "2026-11-11" },
  { id: "m1", section: "monitoring", name: "응답률 확인", day: "2026-11-20" },
  {
    id: "m2",
    section: "monitoring",
    name: "참여자 모집 추적",
    day: "2026-11-04",
    due: "마감 초과 2일",
    severity: "late",
  },
  { id: "m3", section: "monitoring", name: "설문 배포 상태 확인", day: "2026-10-28" },
  { id: "p1", section: "parking", name: "추가 인터뷰 주제", day: "2026-11-18" },
  { id: "p2", section: "parking", name: "리서치 범위 확장", day: "2026-11-05" },
  { id: "d1", section: "done", name: "기존 자료 검토", day: "2026-11-19" },
  { id: "d2", section: "done", name: "초기 인터뷰 완료", day: "2026-11-09" },
];
const topPeriod = document.querySelector("#board-period");
const columns = document.querySelector("#kanban-columns");
const periodDialog = document.querySelector("#section-period-dialog");
const orderDialog = document.querySelector("#section-order-dialog");
const periodSelect = document.querySelector("#section-period");
const rangeFrom = document.querySelector("#range-from");
const rangeTo = document.querySelector("#range-to");
let sectionEditing = null;
let draftOrder = [];
let openingAction = null;
const samplePeriods = {
  today: ["2026-11-20", "2026-11-20"],
  week: ["2026-11-16", "2026-11-22"],
  "2w": ["2026-11-09", "2026-11-22"],
  "4w": ["2026-10-26", "2026-11-22"],
  "12w": ["2026-08-31", "2026-11-22"],
  all: [],
};

function make(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(label, action) {
  const element = make("button", label);
  element.type = "button";
  element.addEventListener("click", action);
  return element;
}

function visibleCards(section) {
  const period = section.period && section.period !== "inherit" ? section.period : topPeriod.value;
  const [from, to] = period === "custom" ? [section.from, section.to] : samplePeriods[period];
  const visible = cards.filter(
    (card) => card.section === section.id && (!from || card.day >= from) && (!to || card.day <= to),
  );
  if (!section.order) return visible;
  const rank = new Map(section.order.map((id, index) => [id, index]));
  return visible.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}

function openPeriod(section) {
  sectionEditing = section;
  document.querySelector("#section-period-title").textContent = section.name + " · 기간 설정";
  periodSelect.value = section.period;
  rangeFrom.value = section.from ?? "";
  rangeTo.value = section.to ?? "";
  document.querySelector("#custom-range").hidden = periodSelect.value !== "custom";
  periodDialog.showModal();
}

function openOrder(section) {
  sectionEditing = section;
  document.querySelector("#section-order-title").textContent = section.name + " · 카드 목록·순서";
  draftOrder = visibleCards(section);
  drawOrder();
  orderDialog.showModal();
}

function actionButton(label, section, type, open) {
  const element = button(label, () => {
    openingAction = element.dataset.sectionAction;
    open(section);
  });
  element.dataset.sectionAction = section.id + "-" + type;
  return element;
}

function drawBoard() {
  columns.replaceChildren();
  for (const section of sections) {
    const column = make("section", "", "kanban-column");
    column.dataset.column = section.id;
    const visible = visibleCards(section);
    const head = make("header", "", "column-head");
    head.append(make("b", section.icon + " " + section.name), make("small", String(visible.length)));
    if (section.period && section.period !== "inherit") {
      const periodName = [...periodSelect.options].find((option) => option.value === section.period).text;
      head.append(make("span", periodName, "chip"));
    }
    if (section.order) head.append(make("span", "직접 순서", "chip"));
    const menu = make("details", "", "column-menu");
    const menuTrigger = make("summary", "⋯");
    menuTrigger.setAttribute("aria-label", section.name + " 메뉴");
    const actions = make("div", "", "column-tools");
    if (section.period) actions.append(actionButton("기간 설정…", section, "period", openPeriod));
    actions.append(actionButton("카드 목록·순서…", section, "order", openOrder));
    menu.append(menuTrigger, actions);
    head.append(menu);
    column.append(head);
    if (!visible.length) column.append(make("p", "이 기간의 카드가 없습니다.", "caption"));
    for (const card of visible) {
      const item = make("article", "", "kanban-card");
      item.dataset.card = card.id;
      const date = make("time", card.day.slice(5).replace("-", "."));
      date.dateTime = card.day;
      item.append(make("strong", card.name, "kanban-card-title"), date);
      if (card.due)
        item.append(document.createElement("br"), make("span", card.due, "due due-" + card.severity));
      column.append(item);
    }
    columns.append(column);
  }
}

function redrawAndClose(dialog) {
  dialog.close();
  drawBoard();
  const action = columns.querySelector('[data-section-action="' + openingAction + '"]');
  action?.closest("details")?.querySelector("summary")?.focus();
}

function drawOrder(focusId, direction) {
  const list = document.querySelector("#order-list");
  list.replaceChildren();
  if (!draftOrder.length) {
    list.append(make("li", "이 기간의 카드가 없습니다."));
    return;
  }
  draftOrder.forEach((card, index) => {
    const row = make("li");
    const contents = make("div");
    const controls = make("span");
    for (const [label, step] of [
      ["위로", -1],
      ["아래로", 1],
    ]) {
      const destination = index + step;
      const move = button(label, () => {
        [draftOrder[index], draftOrder[destination]] = [draftOrder[destination], draftOrder[index]];
        drawOrder(card.id, step);
      });
      move.disabled = destination < 0 || destination >= draftOrder.length;
      move.setAttribute("aria-label", card.name + " " + label);
      move.dataset.cardMove = card.id + ":" + step;
      controls.append(move);
    }
    contents.append(make("span", card.name), controls);
    row.append(contents);
    list.append(row);
  });
  if (focusId) {
    const peek = (step) => list.querySelector('[data-card-move="' + focusId + ":" + step + '"]:enabled');
    (peek(direction) ?? peek(-direction))?.focus();
  }
}

topPeriod.addEventListener("change", drawBoard);
periodSelect.addEventListener("change", () => {
  document.querySelector("#custom-range").hidden = periodSelect.value !== "custom";
});
periodDialog.querySelector("form").addEventListener("submit", (event) => {
  event.preventDefault();
  sectionEditing.period = periodSelect.value;
  const bounds = [rangeFrom.value, rangeTo.value];
  if (bounds.every(Boolean)) bounds.sort();
  [sectionEditing.from, sectionEditing.to] = bounds;
  redrawAndClose(periodDialog);
});
orderDialog.querySelector("form").addEventListener("submit", (event) => {
  event.preventDefault();
  const next = draftOrder.map((card) => card.id);
  const visible = new Set(next);
  const previous =
    sectionEditing.order ?? cards.filter((card) => card.section === sectionEditing.id).map((card) => card.id);
  const base = [...new Set([...previous, ...next])];
  let index = 0;
  sectionEditing.order = base.map((id) => (visible.has(id) ? next[index++] : id));
  redrawAndClose(orderDialog);
});
document.querySelector("#reset-order").addEventListener("click", () => {
  delete sectionEditing.order;
  redrawAndClose(orderDialog);
});
document.querySelectorAll("[data-close]").forEach((close) => {
  close.addEventListener("click", () => close.closest("dialog").close());
});
drawBoard();

const graph = document.querySelector("#graph");
const edges = document.querySelector("#graph-edges");
const expand = document.querySelector("#show-children");
const graphButtons = document.querySelectorAll("[data-graph]");
const graphNodes = {
  workspace: [24, 17],
  category: [49, 31],
  group: [51, 52],
  neighbor: [77, 68],
  note: [22, 73],
  "child-one": [49, 77],
  "child-two": [50, 90],
};
let focused = false;
let childrenShown = false;

function drawGraph() {
  const visible = ["category", "group", "neighbor"];
  if (!focused) visible.push("workspace");
  if (focused) visible.push("note");
  if (focused && childrenShown) visible.push("child-one", "child-two");
  for (const node of graph.querySelectorAll("[data-node]")) {
    const [x, y] = graphNodes[node.dataset.node];
    node.hidden = !visible.includes(node.dataset.node);
    node.style.left = x + "%";
    node.style.top = y + "%";
  }
  const links = [
    ["workspace", "category"],
    ["category", "group"],
    ["group", "neighbor"],
    ["group", "note"],
    ["group", "child-one"],
    ["group", "child-two"],
  ];
  edges.replaceChildren();
  for (const [source, target] of links) {
    if (!visible.includes(source) || !visible.includes(target)) continue;
    const [sx, sy] = graphNodes[source];
    const [tx, ty] = graphNodes[target];
    const dx = ((tx - sx) * graph.clientWidth) / 100;
    const dy = ((ty - sy) * graph.clientHeight) / 100;
    const line = make("span", "", "graph-edge");
    line.style.left = sx + "%";
    line.style.top = sy + "%";
    line.style.width = Math.hypot(dx, dy) + "px";
    line.style.transform = "rotate(" + Math.atan2(dy, dx) + "rad)";
    edges.append(line);
  }
  expand.textContent = focused && childrenShown ? "세부 접기" : "세부 펼치기";
  expand.setAttribute("aria-pressed", String(focused && childrenShown));
}

function graphMode(mode) {
  focused = mode === "focus";
  updatePressed("[data-graph]", document.querySelector('[data-graph="' + mode + '"]'));
  drawGraph();
}

graphButtons.forEach((item) => item.addEventListener("click", () => graphMode(item.dataset.graph)));
graph.querySelector("[data-node=group]").addEventListener("click", () => graphMode("focus"));
expand.addEventListener("click", () => {
  childrenShown = !focused || !childrenShown;
  graphMode("focus");
});
new ResizeObserver(drawGraph).observe(graph);
drawGraph();

const exportForm = document.querySelector("#export-choices");
const exportSubmit = exportForm.querySelector("button");
const exportResult = document.querySelector("#export-result");
const exportPeriod = exportForm.querySelector("select");
const olderWeek = document.querySelector(".table-wrap tbody tr");

function selectedSheets() {
  return [...exportForm.querySelectorAll("input:checked")].map((input) => input.value);
}

function updateExport() {
  exportSubmit.disabled = selectedSheets().length === 0;
  olderWeek.hidden = exportPeriod.selectedIndex === 0;
  exportResult.textContent = "";
}

exportForm.addEventListener("change", updateExport);
exportForm.addEventListener("submit", (event) => {
  event.preventDefault();
  exportResult.textContent = "포함할 시트 · " + selectedSheets().join(", ");
});
updateExport();
