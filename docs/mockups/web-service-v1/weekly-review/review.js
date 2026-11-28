const $ = (id) => document.getElementById(id);
const day = 86400000;
const base = Date.UTC(2026, 10, 23);
const demoToday = new Date(base + 5 * day).toISOString().slice(0, 10);
const weekdays = ["월", "화", "수", "목", "금", "토", "일"];
const categories = [
  { id: "release", name: "제품 출시", color: "#2a78d6" },
  { id: "ops", name: "운영 점검", color: "#eb6834" },
  { id: "team", name: "팀 운영", color: "#1baf7a" },
  { id: "docs", name: "문서 정리", color: "#eda100" },
];
const rows = [
  {
    c: "release",
    d: 0,
    text: "출시 범위 확정",
    state: "done",
    detail: "웹 주간 보드 · 모바일 확인 포함",
  },
  {
    c: "release",
    d: 1,
    text: "개발 점검 회의",
    state: "done",
    detail: "오전 10:00 · 테스트 일정 공유",
  },
  { c: "release", d: 2, text: "동기화 시나리오 정리", state: "done" },
  {
    c: "release",
    d: 3,
    text: "주간 출시 보고서 작성",
    state: "star",
    detail: "변경 사항과 확인 결과 정리",
    due: "11/27 마감",
  },
  { c: "release", d: 4, text: "릴리스 검토", state: "todo" },
  { c: "ops", d: 0, text: "지난주 운영 지표 확인", state: "done" },
  { c: "ops", d: 2, text: "오류 알림 분류", state: "todo" },
  {
    c: "ops",
    d: 3,
    text: "온라인 공간 접근 점검",
    state: "todo",
    detail: "브라우저 · 데스크탑 왕복 확인",
  },
  { c: "ops", d: 4, text: "작업 이력 확인", state: "todo" },
  {
    c: "team",
    d: 1,
    text: "파트 주간 미팅",
    state: "done",
    detail: "오전 10:00",
  },
  { c: "team", d: 3, text: "다음 주 일정 공유", state: "done" },
  { c: "team", d: 5, text: "회의 노트 확인", state: "todo" },
  { c: "docs", d: 2, text: "이용 가이드 검토", state: "todo" },
  { c: "docs", d: 4, text: "주간 요약 반영", state: "todo" },
].map((row, id) => ({
  ...row,
  id,
  lane:
    row.state === "done" ? "DONE" : row.state === "star" ? "진행 중" : "TODO",
}));
const views = [
  {
    id: "day",
    label: "데일리",
    title: "데일리 보드",
    icon: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v5m8-5v5m-8 8h8"/>',
  },
  {
    id: "week",
    label: "주간",
    title: "주간 보드",
    icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11m6-11v11"/>',
  },
  {
    id: "kanban",
    label: "칸반",
    title: "칸반 보드",
    icon: '<rect x="3" y="4" width="4" height="11" rx="1"/><rect x="10" y="4" width="4" height="16" rx="1"/><rect x="17" y="4" width="4" height="8" rx="1"/>',
  },
];
const lanes = ["TODO", "진행 중", "DONE"];
const ui = {
  view: "week",
  week: 0,
  selectedDay: 3,
  selectedRecord: 3,
  lane: "TODO",
};
const sheet = $("sheet");
const clean = (value = "") =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const date = (index) => new Date(base + (ui.week * 7 + index) * day);
const shortDate = (date) => `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
const todayColumn = (index) =>
  date(index).toISOString().slice(0, 10) === demoToday;
const active = (index) => index === ui.selectedDay;
const category = (row) => categories.find((c) => c.id === row.c);
const rowOn = (i) => (ui.week === 0 ? rows.filter((row) => row.d === i) : []);
const markers = {
  star: ["★", "중요"],
  done: ["✓", "완료"],
  todo: ["•", "할 일"],
};

function nav() {
  return views
    .map(
      ({ id, label, icon }) =>
        `<button data-view="${id}" ${ui.view === id ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>${label}</button>`,
    )
    .join("");
}
function record(row, selected = false, note = "") {
  const [icon, label] = markers[row.state];
  return `<button class="record${selected ? " selected" : ""}" data-record="${row.id}" style="--cat:${category(row).color}">
  <span class="lead"><span class="state ${row.state}" aria-label="${label}">${icon}</span><span>${clean(row.text)}</span></span>
  ${note || row.detail ? `<span class="indent">${clean(note || row.detail)}</span>` : ""}
  ${row.due && row.state !== "done" ? `<span class="due">${row.due}</span>` : ""}</button>`;
}
function week() {
  const header = weekdays
    .map(
      (name, index) =>
        `<th scope="col" class="${active(index) ? "active-day" : ""} ${index >= 5 ? "weekend" : ""}"><button class="day-header" data-date="${index}">
    ${name} <time>${shortDate(date(index))}</time> ${todayColumn(index) ? "<small>오늘</small>" : ""}</button></th>`,
    )
    .join("");
  const grid = categories
    .map(
      (cat) =>
        `<tr><th scope="row" style="--cat:${cat.color}"><span class="category-label">${cat.name}</span></th>${weekdays
          .map(
            (_, index) =>
              `<td class="${active(index) ? "active-day" : ""} ${index >= 5 ? "weekend" : ""}">${rowOn(
                index,
              )
                .filter((row) => row.c === cat.id)
                .map((row) => record(row))
                .join("")}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  return `<table class="week-grid" aria-label="업무와 요일별 주간 기록"><thead><tr><th scope="col">업무</th>${header}</tr></thead><tbody>${grid}</tbody></table>
    <div class="compact-week">${days()}${dayContent()}</div>`;
}
function days() {
  return `<div class="days" role="group" aria-label="요일 선택">${weekdays
    .map(
      (name, index) =>
        `<button data-date="${index}" aria-pressed="${active(index)}" aria-label="${shortDate(date(index))} ${name}요일${todayColumn(index) ? " 오늘" : ""}">${name}<time>${shortDate(date(index))}</time></button>`,
    )
    .join("")}</div>`;
}
function dayContent() {
  const list = rowOn(ui.selectedDay);
  if (!list.length) return '<p class="empty">이 날의 기록이 없습니다.</p>';
  const selected = list.find((row) => row.id === ui.selectedRecord) || list[0];
  const groups = categories
    .map((cat) => {
      const records = list.filter((row) => row.c === cat.id);
      return records.length
        ? `<section class="work-group" style="--cat:${cat.color}"><h3>${cat.name}</h3>
      ${records.map((row) => record(row, row.id === selected.id)).join("")}</section>`
        : "";
    })
    .join("");
  const panel = `<section class="detail" aria-label="선택한 기록"><p class="meta">${category(selected).name} · ${shortDate(date(selected.d))} ${weekdays[selected.d]}요일</p>
    <h3>${clean(selected.text)}</h3>${selected.detail ? `<p>${clean(selected.detail)}</p>` : ""}
    <button class="choice-button" data-edit="${selected.id}">기록 편집</button></section>`;
  return `<div class="split"><div class="choices">${groups}</div>${panel}</div>`;
}
function kanban() {
  const tabs = `<div class="lane-tab" role="group" aria-label="칸반 상태 선택">${lanes
    .map(
      (lane) =>
        `<button class="choice-button" data-lane="${lane}" aria-pressed="${lane === ui.lane}">${lane}</button>`,
    )
    .join("")}</div>`;
  const columns = lanes
    .map((lane) => {
      const cards =
        ui.week === 0 ? rows.filter((row) => row.lane === lane) : [];
      return `<section class="lane" data-visible="${lane === ui.lane}"><h3>${lane} <span>${cards.length}</span></h3>
      ${cards.map((row) => record(row, false, category(row).name)).join("") || '<p class="subtle">카드가 없습니다.</p>'}</section>`;
    })
    .join("");
  return `<div class="kanban-screen">${tabs}<div class="kanban-lanes">${columns}</div></div>`;
}
function render() {
  const menu = nav();
  document.querySelector(".rail").innerHTML = menu;
  document.querySelector(".bottom").innerHTML = menu;
  $("screen-title").textContent = views.find(
    (view) => view.id === ui.view,
  ).title;
  const range = `${date(0).getUTCFullYear()}. ${shortDate(date(0))} – ${shortDate(date(6))}`;
  $("range").textContent =
    ui.view === "day"
      ? `${shortDate(date(ui.selectedDay))} (${weekdays[ui.selectedDay]})`
      : range;
  $("previous").setAttribute(
    "aria-label",
    ui.view === "day" ? "이전 날" : "이전 주",
  );
  $("next").setAttribute(
    "aria-label",
    ui.view === "day" ? "다음 날" : "다음 주",
  );
  $("screen").innerHTML =
    ui.view === "week"
      ? week()
      : ui.view === "kanban"
        ? kanban()
        : `<div class="day-screen">${days()}${dayContent()}</div>`;
}
function editor(row) {
  const move = ui.view === "kanban";
  sheet.innerHTML = `<form>
    <h3 class="sheet-title" id="sheet-title">기록 편집</h3>
    <p class="subtle">${category(row).name} · ${shortDate(date(row.d))} ${weekdays[row.d]}요일</p>
    <label>본문<textarea name="text" required>${clean(row.text)}</textarea></label>
    ${move ? `<label>칸반 상태<select name="lane">${lanes.map((lane) => `<option ${row.lane === lane ? "selected" : ""}>${lane}</option>`).join("")}</select></label>` : ""}
    <div class="sheet-actions"><button type="button" class="choice-button" data-close>닫기</button>
    <button type="submit" class="choice-button primary">저장</button></div></form>`;
  sheet.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = data.get("text").trim();
    if (!text) return;
    row.text = text;
    if (move) {
      row.lane = data.get("lane");
      row.state =
        row.lane === "DONE" ? "done" : row.state === "star" ? "star" : "todo";
      ui.lane = row.lane;
    }
    sheet.close();
    $("sync").textContent = "✓ 시안에서 저장됨";
    render();
  });
  sheet.showModal();
}
function summary() {
  const list = ui.week === 0 ? rows : [];
  sheet.innerHTML = `<div class="sheet-body"><h3 class="sheet-title" id="sheet-title">주간 요약</h3>
    <p class="subtle">${shortDate(date(0))} – ${shortDate(date(6))}</p>
    ${categories
      .map((cat) => {
        const done = list.filter(
          (row) => row.c === cat.id && row.state === "done",
        );
        return `<section><h4>${cat.name}</h4><p>${done.map((row) => clean(row.text)).join(" · ") || "완료 기록 없음"}</p></section>`;
      })
      .join(
        "",
      )}<div class="sheet-actions"><button class="choice-button" data-close>닫기</button></div></div>`;
  sheet.showModal();
}
function step(amount) {
  if (ui.view !== "day") ui.week += amount;
  else {
    const target = ui.selectedDay + amount;
    ui.week += Math.floor(target / 7);
    ui.selectedDay = (target + 7) % 7;
  }
  ui.selectedRecord = -1;
  render();
}
document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const {
    size,
    view,
    date: index,
    record: id,
    edit,
    lane,
    close,
  } = button.dataset;
  if (size) {
    $("frame").dataset.size = size;
    for (const item of document.querySelectorAll("[data-size][aria-pressed]"))
      item.setAttribute("aria-pressed", item === button);
  } else if (view) {
    ui.view = view;
    render();
  } else if (index !== undefined) {
    ui.selectedDay = Number(index);
    ui.selectedRecord = -1;
    render();
  } else if (id !== undefined || edit !== undefined) {
    const row = rows[Number(id ?? edit)];
    if (
      id !== undefined &&
      ui.view !== "kanban" &&
      $("frame").clientWidth >= 600 &&
      (ui.view === "day" || $("frame").clientWidth < 1024)
    ) {
      ui.selectedRecord = row.id;
      render();
    } else editor(row);
  } else if (lane) {
    ui.lane = lane;
    render();
  } else if (close !== undefined) sheet.close();
});
$("previous").addEventListener("click", () => step(-1));
$("next").addEventListener("click", () => step(1));
$("today").addEventListener("click", () => {
  Object.assign(ui, { week: 0, selectedDay: 5, selectedRecord: -1 });
  render();
});
$("summary").addEventListener("click", summary);
$("workspace").addEventListener("click", () => {
  sheet.innerHTML =
    '<div class="sheet-body"><h3 class="sheet-title" id="sheet-title">온라인 워크스페이스</h3><p>제품팀 <span class="subtle">· 현재 사용 중</span></p><div class="sheet-actions"><button class="choice-button" data-close>닫기</button></div></div>';
  sheet.showModal();
});
render();
