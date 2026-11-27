/* global document, FormData, HTMLElement */
const product = document.querySelector("#product");
const sheet = document.querySelector("#sheet");
const frame = document.querySelector("#frame");
const scene = document.querySelector("#scene");
const connection = document.querySelector("#connection");
const size = document.querySelector("#frame-size");
const demoEmail = "virtual@example.invalid";
const staticAssets = "../../../site/";
const weekday = ["월", "화", "수", "목", "금", "토", "일"];
const states = ["TODO", "검토 중", "DONE"];
// 업무명은 fixtures/sample-showcase.json의 가상 사례를 사용한다.
const work = {
  settle: "차세대 정산 시스템 구축",
  security: "협력사 보안 점검",
  dash: "사내 데이터 대시보드",
};
let records = [
  {
    id: 1,
    work: "settle",
    day: 4,
    text: "테스트 데이터 이관 스크립트 작성",
    status: "TODO",
    meta: "마감 D-2",
  },
  {
    id: 2,
    work: "settle",
    day: 4,
    text: "검토 의견 반영 및 예외 조건 확인",
    status: "검토 중",
    meta: "중요",
  },
  { id: 3, work: "security", day: 4, text: "점검 결과 보고서 초안 작성", status: "TODO", meta: "오늘 마감" },
  { id: 4, work: "dash", day: 4, text: "영업팀 요구사항 인터뷰", status: "DONE", meta: "완료" },
  { id: 5, work: "settle", day: 0, text: "현행 정산 규칙과 변경 범위 확인", status: "DONE", meta: "완료" },
  { id: 6, work: "security", day: 2, text: "현장 점검 결과 취합", status: "검토 중", meta: "" },
  { id: 7, work: "dash", day: 3, text: "주간 지표 정의 확인", status: "TODO", meta: "" },
];
const spaceRecords = new Map([
  ["프로젝트 운영", records],
  ["개인 업무", []],
]);

const state = {
  view: "entry",
  sent: false,
  email: demoEmail,
  agreed: false,
  activeSpace: "프로젝트 운영",
  spaces: ["프로젝트 운영", "개인 업무"],
  day: 4,
  kanban: "TODO",
  connected: "saved",
  message: "",
  focused: 1,
};

const safe = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[ch],
  );
const button = (label, action, kind = "", more = "") =>
  `<button type="button" data-action="${action}" class="${kind}" ${more}>${label}</button>`;
const brand = `<span class="brand"><img src="${staticAssets}icon.svg" alt="" /><img src="${staticAssets}wordmark.svg" alt="Work Journey Board" /></span>`;
const legalLinks = `${button("이용약관", "terms", "quiet")} ${button("개인정보 처리방침", "privacy", "quiet")}`;
const helpLinks = `<a href="https://chs2147.github.io/work-journey-board/guide/" target="_blank" rel="noopener">이용 가이드</a><a href="mailto:chs2147@gmail.com">운영 문의</a>`;
const statusLabel = () =>
  state.connected === "offline" ? "연결 끊김" : state.connected === "conflict" ? "충돌 1건" : "서버에 저장됨";
const titles = {
  day: "오늘",
  week: "주간 보드",
  kanban: "칸반 보드",
  summary: "주간 요약",
  settings: "계정",
  more: "더 보기",
  search: "통합 검색",
  notes: "주간 메모",
  cabinet: "Cabi.NET",
  universe: "Universe",
};

function go(view) {
  const oldView = state.view;
  state.view = view;
  state.message = "";
  render();
  if (oldView !== view) product.querySelector("h2")?.focus({ preventScroll: true });
}

function publicScreen(body, link) {
  return `<header class="public-header">${brand}<nav aria-label="공개 메뉴">${link}<a href="https://chs2147.github.io/work-journey-board/guide/" target="_blank" rel="noopener">이용 가이드</a></nav></header>
    <div class="public-content">${body}</div>
    <footer class="public-footer"><nav aria-label="정책과 지원">${legalLinks}${helpLinks}</nav><p>© 2026 sanbonjini</p></footer>`;
}

function entry() {
  return publicScreen(
    `<div class="intro">
    <div class="stack"><h2 tabindex="-1">기기를 바꿔도,<br /><em>같은 공간에서 이어서.</em></h2><p>등록된 이메일로 로그인해 Windows·Mac·스마트폰에서 같은 온라인 워크스페이스를 이용하세요.</p>
    <div class="row">${button("웹에서 열기 ↗", "login", "primary")}<a class="control" href="https://github.com/chs2147/work-journey-board/releases/latest" target="_blank" rel="noopener">데스크탑 앱 받기</a></div></div>
    <div class="panel stack"><span class="badge">온라인 워크스페이스</span><h3>프로젝트 운영</h3><p>업무 기록과 진행 상태를 기기 사이에서 이어 봅니다.</p><div class="record"><div class="record-open">점검 결과 보고서 초안 작성<small>협력사 보안 점검 · 오늘 마감</small></div></div></div></div>`,
    "",
  );
}

function login() {
  const body = state.sent
    ? `<p class="muted">등록된 주소라면 인증번호를 받을 수 있습니다.</p><p class="small">${safe(state.email)}</p>
       <label class="field">인증번호<input name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{8}" maxlength="8" placeholder="8자리 입력" required /></label>
       <button class="primary" type="submit">로그인</button><div class="row">${button("이메일 바꾸기", "email-back")}${button("다시 보내기", "resend")}</div>`
    : `<p class="muted">운영자가 등록한 이메일로 로그인하세요.</p>
       <label class="field">이메일<input name="email" type="email" value="${safe(state.email)}" autocomplete="email" required /></label>
       <div class="row">${legalLinks}</div><label class="consent"><input name="agree" type="checkbox" ${state.agreed ? "checked" : ""} required /> 온라인 기능 이용 안내에 동의합니다.</label>
       <button class="primary" type="submit">인증번호 받기</button>`;
  return publicScreen(
    `<form class="panel sign-in stack" data-form="${state.sent ? "otp" : "email"}"><h2 tabindex="-1">${state.sent ? "인증번호 확인" : "웹 로그인"}</h2>${body}<p class="small error" role="alert" id="login-message"></p></form>`,
    button("소개 사이트", "entry", "quiet"),
  );
}

function spaces() {
  return publicScreen(
    `<div class="stack sign-in"><h2 tabindex="-1">온라인 워크스페이스</h2><div class="row">${button("새 온라인 공간", "space-add", "primary")}</div>
    ${state.spaces.map((label, i) => button(`<span><b>${safe(label)}</b><small>온라인 공간</small></span><span aria-hidden="true">›</span>`, `space:${i}`, "space-card space-mark")).join("")}</div>`,
    button("로그아웃", "logout", "quiet"),
  );
}

function nav(which) {
  const links =
    which === "bottom"
      ? ["day", "week", "kanban", "more"]
      : ["day", "week", "kanban", "summary", "search", "more"];
  return `<nav class="${which}" aria-label="작업 화면">${links
    .map((key) =>
      button(
        key === "week" && which === "bottom"
          ? "주간"
          : key === "kanban" && which === "bottom"
            ? "칸반"
            : titles[key],
        key,
        "",
        state.view === key ? 'aria-current="page"' : "",
      ),
    )
    .join("")}</nav>`;
}

function workScreen(body) {
  return `<header class="app-header">${brand}<div class="app-actions">${button(`${safe(state.activeSpace)} ▾`, "spaces", "", 'aria-label="온라인 공간 선택"')}
    ${button(`● ${statusLabel()}`, "sync", "status", `data-state="${state.connected}"`)}${button("계정", "settings", "quiet")}</div></header>
    <div class="app-layout">${nav("side")}<div class="app-content">${body}</div>${nav("bottom")}</div>`;
}

function head(label, caption, action = "") {
  return `<div class="page-head"><div><p class="muted small">${caption}</p><h2 tabindex="-1">${label}</h2></div>${action}</div>
    ${state.connected === "offline" ? '<p class="message" role="status">연결이 끊겼습니다. 열어 둔 기록을 읽을 수 있습니다.</p>' : ""}
    ${state.message ? `<p class="small" role="status">${safe(state.message)}</p>` : ""}`;
}

function dates() {
  return `<div class="date-tabs" aria-label="요일 선택">${weekday.map((d, i) => button(`<span>${d}</span><b>${23 + i}</b>`, `day:${i}`, "", `aria-pressed="${i === state.day}" aria-label="${23 + i}일 ${d}요일"`)).join("")}</div>`;
}

function record(item, compact = false) {
  const meta = item.meta
    ? `<small><span class="badge ${item.meta.includes("마감") ? "due" : ""}">${safe(item.meta)}</span></small>`
    : "";
  return `<div class="record" data-category="${item.work}">
    ${button(`${safe(item.text)}${meta}`, `edit:${item.id}`, "record-open")}
    ${compact ? "" : button("⋯", `edit:${item.id}`, "quiet", `aria-label="${safe(item.text)} 편집 및 상태 변경"`)}</div>`;
}

function selectedDay() {
  const items = records.filter((item) => item.day === state.day);
  const focused = items.find((item) => item.id === state.focused) ?? items[0];
  return `<div class="work-area"><div class="records">
    ${
      Object.entries(work)
        .map(([key, label]) => {
          const entries = items.filter((item) => item.work === key);
          return entries.length
            ? `<section class="record-group"><h3>${label}</h3><div class="record-list">${entries.map((item) => record(item)).join("")}</div></section>`
            : "";
        })
        .join("") || '<p class="panel">이 날의 기록이 없습니다.</p>'
    }</div>
    <aside class="panel stack" aria-label="선택한 기록 상세"><h3>기록 상세</h3>${focused ? `<p>${safe(focused.text)}</p><span class="muted small">${work[focused.work]} · ${focused.status}</span>${button("기록 편집", `edit:${focused.id}`)}` : '<p class="muted small">기록을 선택하면 세부 정보를 볼 수 있습니다.</p>'}</aside></div>`;
}

function day() {
  return workScreen(
    head(
      state.day === 4 ? "오늘" : `${23 + state.day}일 ${weekday[state.day]}요일`,
      "2026년 11월 · W48",
      button("＋ 기록 추가", "record-add", "primary"),
    ) +
      dates() +
      selectedDay(),
  );
}

function week() {
  const board = `<div class="board-week wide-week" aria-label="요일과 업무별 주간 기록"><div class="board-line"><strong>업무</strong>${weekday.map((d, i) => `<b class="${i === state.day ? "active-day" : ""}">${d}<small>${23 + i}일</small></b>`).join("")}</div>
    ${Object.entries(work)
      .map(
        ([key, label]) =>
          `<div class="board-line"><strong>${label}</strong>${weekday
            .map(
              (_, i) =>
                `<div class="${i === state.day ? "active-day" : ""}">${records
                  .filter((r) => r.work === key && r.day === i)
                  .map((r) => button(safe(r.text), `edit:${r.id}`))
                  .join("")}</div>`,
            )
            .join("")}</div>`,
      )
      .join("")}</div>`;
  return workScreen(
    head(
      "주간 보드",
      "2026년 11월 23일~29일 · W48",
      `<div class="row">${button("내보내기", "export")}${button("＋ 기록 추가", "record-add", "primary")}</div>`,
    ) +
      board +
      `<div class="stack compact-week">${dates()}${selectedDay()}</div>`,
  );
}

function kanban() {
  return workScreen(
    head("칸반 보드", "이번 주 · 11월 23일~29일", button("＋ 카드 추가", "record-add", "primary")) +
      `<div class="state-tabs" aria-label="카드 상태 선택">${states.map((label, i) => button(label, `lane:${i}`, "", `aria-pressed="${state.kanban === label}"`)).join("")}</div>
     <div class="kanban">${states
       .map((label) => {
         const cards = records.filter((item) => item.status === label);
         return `<section class="panel" data-active="${state.kanban === label}"><h3>${label} <span class="badge">${cards.length}</span></h3>${cards.map((item) => record(item, true)).join("") || '<p class="muted">카드가 없습니다.</p>'}</section>`;
       })
       .join("")}</div>`,
  );
}

function summary() {
  return workScreen(
    head("주간 요약", "2026년 11월 23일~29일 · W48", button("내보내기", "export", "primary")) +
      `<section class="panel stack"><h3>업무별 자동 집계</h3>${Object.entries(work)
        .map(
          ([key, label]) =>
            `<div><b>${label}</b><p class="muted">${records
              .filter((item) => item.work === key)
              .map((item) => safe(item.text))
              .join(" · ")}</p></div>`,
        )
        .join("")}</section>`,
  );
}

function other(view) {
  if (view === "search")
    return workScreen(
      head("통합 검색", safe(state.activeSpace)) +
        `<label class="field">이 공간의 기록 검색<input id="query" type="search" placeholder="업무 기록 검색" /></label><div class="record-list" id="results">${records.map((item) => record(item)).join("")}</div>`,
    );
  if (view === "more")
    return workScreen(
      head("더 보기", safe(state.activeSpace)) +
        `<div class="panel stack">${["summary", "search", "notes", "cabinet", "universe", "settings"].map((key) => button(titles[key], key)).join("")}</div>`,
    );
  if (view === "settings")
    return workScreen(
      head("계정", "설정") +
        `<section class="panel stack"><h3>로그인</h3><p>${safe(state.email)}</p>${button("로그아웃", "logout")}</section><section class="panel stack"><h3>사용량</h3><p>그림 5.0 MB / 100.0 MB</p><p>온라인 공간 ${state.spaces.length} / 3개</p><p>기록 1.0 MB / 30.0 MB</p></section><section class="panel stack"><h3>서비스 정보</h3><p>Work Journey Board · 웹</p><div class="row">${legalLinks}${helpLinks}</div><p class="muted small">© 2026 sanbonjini</p></section>`,
    );
  return workScreen(
    head(titles[view], "원본 탐색") +
      `<section class="panel stack"><h3>${view === "notes" ? "이번 주 메모" : view === "cabinet" ? "정산 시스템 · 업무노트" : "정산 시스템 · 연결된 기록"}</h3><p>이관 범위와 점검 결과를 정리한 기록입니다.</p>${button("연결된 기록 열기", "edit:1")}</section>`,
  );
}

function render() {
  const screens = { entry, login, spaces, day, week, kanban, summary };
  product.innerHTML = screens[state.view]?.() ?? other(state.view);
  scene.value = [...scene.options].some((option) => option.value === state.view) ? state.view : "day";
}

let returnFocus;
function modal(title, body) {
  returnFocus = document.activeElement;
  sheet.className = "sheet";
  sheet.innerHTML = `<div class="stack"><h2 id="sheet-title">${title}</h2>${body}</div>`;
  sheet.showModal();
}

function editor(item) {
  if (!item && state.connected === "offline")
    return modal(
      "연결 끊김",
      `<p>연결이 돌아오면 새 기록을 추가할 수 있습니다.</p>${button("닫기", "close")}`,
    );
  modal(
    item ? "기록 상세" : "새 기록",
    `<form data-form="record:${item?.id ?? "new"}" class="stack">
    <label class="field">업무<select name="work">${Object.entries(work)
      .map(
        ([key, label]) => `<option value="${key}" ${key === item?.work ? "selected" : ""}>${label}</option>`,
      )
      .join("")}</select></label>
    <label class="field">기록 내용<textarea name="text" required ${state.connected === "offline" ? "readonly" : ""}>${safe(item?.text ?? "")}</textarea></label>
    <label class="field">상태<select name="status" aria-label="상태">${states.map((value) => `<option ${value === item?.status ? "selected" : ""}>${value}</option>`).join("")}</select></label>
    <p class="small muted">11월 ${23 + (item?.day ?? state.day)}일${item?.meta ? ` · ${safe(item.meta)}` : ""}</p>
    <div class="row">${button("닫기", "close")}<button class="primary" type="submit" ${state.connected === "offline" ? "disabled" : ""}>저장</button></div>
  </form>`,
  );
}

function action(value) {
  const [kind, id] = value.split(":");
  if (kind === "close") return sheet.close();
  if (kind === "edit") {
    const item = records.find((record) => record.id === Number(id));
    if (item) {
      state.focused = item.id;
      editor(item);
    }
  } else if (kind === "space") {
    state.activeSpace = state.spaces[Number(id)];
    records = spaceRecords.get(state.activeSpace);
    go("day");
  } else if (kind === "day" && id !== undefined) {
    state.day = Number(id);
    render();
    product.querySelector(`[data-action="day:${id}"]`)?.focus();
  } else if (kind === "lane") {
    state.kanban = states[Number(id)];
    render();
    product.querySelector(`[data-action="lane:${id}"]`)?.focus();
  } else if (kind === "record-add") editor();
  else if (kind === "space-add") {
    modal(
      "새 온라인 공간",
      `<form class="stack" data-form="space"><label class="field">공간 이름<input name="space" required maxlength="40" /></label><p role="alert" class="error" id="space-message"></p><div class="row">${button("취소", "close")}<button class="primary">만들기</button></div></form>`,
    );
  } else if (kind === "terms" || kind === "privacy") {
    modal(
      kind === "terms" ? "이용약관" : "개인정보 처리방침",
      `<p class="small muted">웹 서비스 검토용 요약</p><p>${kind === "terms" ? "등록된 계정으로 온라인 공간을 이용합니다. 이용 한도와 계정·공간 삭제는 온라인 기능 정책을 따릅니다." : "이메일, 인증 세션, 온라인 공간의 기록과 첨부가 서비스 운영에 사용됩니다. 브라우저 세션과 서버의 보관·삭제 방식은 웹 서비스 정책에 안내합니다."}</p>${button("닫기", "close")}`,
    );
  } else if (kind === "email-back" || kind === "logout") {
    state.sent = false;
    if (kind === "logout") state.agreed = false;
    go("login");
  } else if (kind === "resend") {
    document.querySelector("#login-message").textContent = "등록된 주소라면 새 인증번호를 받을 수 있습니다.";
  } else if (kind === "sync") {
    const detail =
      state.connected === "offline"
        ? "연결이 돌아오면 동기화를 다시 시도합니다."
        : state.connected === "conflict"
          ? "다른 기기에서 같은 기록을 수정했습니다."
          : "현재 기록이 서버에 저장된 상태입니다.";
    modal(
      statusLabel(),
      `<p>${detail}</p><div class="row">${state.connected === "conflict" ? button("서버 변경 보존", "resolve", "primary") : ""}${button("닫기", "close")}</div>`,
    );
  } else if (kind === "resolve") {
    state.connected = connection.value = "saved";
    sheet.close();
    state.message = "서버 변경을 표시했습니다.";
    render();
  } else if (kind === "export") {
    modal(
      "업무일지 내보내기",
      `<form class="stack" data-form="export"><label class="field">형식<select name="format" aria-label="형식"><option>엑셀</option><option>마크다운</option></select></label><label class="field">범위<select><option>이번 주</option><option>연도</option></select></label><label class="field">업무<select><option>전체 업무</option>${Object.values(
        work,
      )
        .map((label) => `<option>${label}</option>`)
        .join(
          "",
        )}</select></label><div class="row">${button("취소", "close")}<button class="primary" type="submit">다운로드</button></div></form>`,
    );
  } else if (kind in titles || ["entry", "login", "spaces"].includes(kind)) go(kind);
}

function submit(form) {
  const fields = new FormData(form);
  const [kind, id] = form.dataset.form.split(":");
  if (kind === "email") {
    state.email = String(fields.get("email"));
    state.agreed = true;
    state.sent = true;
    render();
    product.querySelector('[name="otp"]').focus();
  } else if (kind === "otp") {
    if (fields.get("otp") === "12345678" && state.email.toLowerCase() === demoEmail) go("spaces");
    else
      document.querySelector("#login-message").textContent =
        "인증번호를 확인해 주세요. 이메일을 바꾸거나 새 인증번호를 받을 수 있습니다.";
  } else if (kind === "space") {
    const name = String(fields.get("space")).trim();
    if (!name) return;
    if (spaceRecords.has(name)) {
      sheet.querySelector("#space-message").textContent = "이미 사용 중인 이름입니다.";
      return;
    }
    state.spaces.push(name);
    spaceRecords.set(name, []);
    sheet.close();
    render();
  } else if (kind === "record") {
    if (state.connected === "offline") return;
    const text = String(fields.get("text")).trim();
    if (!text) return;
    const status = String(fields.get("status"));
    const patch = { work: String(fields.get("work")), text, status };
    const old = records.find((item) => item.id === Number(id));
    if (old) Object.assign(old, patch);
    else records.push({ id: (records.at(-1)?.id ?? 0) + 1, day: state.day, meta: "", ...patch });
    if (state.view === "kanban") state.kanban = status;
    sheet.close();
    state.message = "기록을 저장했습니다.";
    render();
  } else if (kind === "export") {
    sheet.close();
    state.message = `${fields.get("format")} 다운로드 흐름을 확인했습니다. 시안은 예시 기록을 사용합니다.`;
    render();
  }
}

frame.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (target) action(target.dataset.action);
});
frame.addEventListener("submit", (event) => {
  if (!event.target.matches("[data-form]")) return;
  event.preventDefault();
  submit(event.target);
});
frame.addEventListener("input", (event) => {
  if (event.target.matches('#product input[name="email"]')) state.email = event.target.value;
  if (event.target.matches('#product input[name="agree"]')) state.agreed = event.target.checked;
  if (event.target.id === "query") {
    const query = event.target.value.trim().toLowerCase();
    const matches = records.filter((item) => `${work[item.work]} ${item.text}`.toLowerCase().includes(query));
    document.querySelector("#results").innerHTML =
      matches.map((item) => record(item)).join("") || '<p role="status">일치하는 기록이 없습니다.</p>';
  }
});
sheet.addEventListener("close", () => {
  if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
});
scene.addEventListener("change", () => go(scene.value));
connection.addEventListener("change", () => {
  state.connected = connection.value;
  render();
});
size.addEventListener("change", () => {
  frame.style.width = size.value === "auto" ? "" : `${size.value}px`;
});
render();
