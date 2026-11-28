const teaser = "https://chs2147.github.io/work-journey-board/";
const repository = "https://github.com/chs2147/work-journey-board";

function layout(title, content, { script = false, workspace = false } = {}) {
  return `<!doctype html>
<html lang="ko"${workspace ? ' data-theme="signature"' : ""}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${title} · Work Journey Board</title>
  <link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/style.css">
  ${workspace ? '<link rel="stylesheet" href="/assets/workspace-theme.css"><link rel="stylesheet" href="/assets/workspace-palette.css"><link rel="stylesheet" href="/assets/workspace.css">' : ""}
  ${script ? '<script src="/assets/app.js" defer></script>' : ""}
</head>
<body>
  ${
    workspace
      ? ""
      : `<header class="site-header">
    <a class="brand" href="/">
      <img src="/assets/icon.svg" alt="" width="32" height="32">
      <img src="/assets/wordmark.svg" alt="Work Journey Board" width="143" height="30">
      <span class="channel">DEV</span>
    </a>
    <nav aria-label="안내">
      <a href="${teaser}">소개 사이트</a>
      <a href="${teaser}guide/">이용 가이드</a>
    </nav>
  </header>`
  }
  ${content}
  ${
    workspace
      ? ""
      : `<footer class="site-footer">
    <nav aria-label="서비스 정보">
      <a href="/terms">이용약관</a>
      <a href="/privacy">개인정보 처리방침</a>
      <a href="${teaser}guide/">이용 가이드</a>
      <a href="mailto:chs2147@gmail.com">운영 문의</a>
    </nav>
    <small>© 2026 sanbonjini</small>
  </footer>`
  }
</body>
</html>`;
}

const views = { day: "오늘", week: "주간", kanban: "칸반", search: "검색", summary: "요약", cabinet: "자료" };
const viewTitles = {
  day: "데일리 보드",
  week: "주간 보드",
  kanban: "칸반 보드",
  search: "기록 검색",
  summary: "주간 요약",
  notes: "주간 메모",
  cabinet: "Cabi.NET",
};
const viewIcons = {
  day: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v5m8-5v5m-8 8h8"/>',
  week: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11m6-11v11"/>',
  kanban:
    '<rect x="3" y="4" width="4" height="11"/><rect x="10" y="4" width="4" height="16"/><rect x="17" y="4" width="4" height="8"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/>',
  summary: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8m-8 4h5"/>',
  cabinet:
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 10h18"/>',
};

export function pageFor(path, version, workspace) {
  if (workspace) {
    const [, id, view] = workspace;
    return layout(
      viewTitles[view],
      `
      <main class="journal" id="journal" data-id="${id}" data-view="${view}">
        <header class="journal-header">
          <a class="brand" href="/spaces" aria-label="Work Journey Board 온라인 워크스페이스">
            <img src="/assets/icon.svg" alt="" width="29" height="29">
            <img class="journal-wordmark" src="/assets/wordmark.svg" alt="" width="148" height="30">
          </a>
          <a class="journal-space" href="/spaces" title="워크스페이스 목록"><span id="journal-name">워크스페이스</span><span aria-hidden="true">▾</span></a>
          <output class="journal-sync" id="journal-sync" aria-live="off">연결 중</output>
          <button type="button" class="quiet journal-refresh" id="journal-refresh" aria-label="새로고침" title="새로고침">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5m5 0a8 8 0 1 0-1.6 5"/></svg>
          </button>
        </header>
        <nav class="journal-nav" aria-label="워크스페이스 화면">${Object.entries(views)
          .map(
            ([key, name]) =>
              `<a href="/app/${id}/${key}"${key === view || (key === "cabinet" && view === "notes") ? ' aria-current="page"' : ""}><svg viewBox="0 0 24 24" aria-hidden="true">${viewIcons[key]}</svg><span>${name}</span></a>`,
          )
          .join("")}</nav>
        <section class="journal-body" aria-labelledby="journal-title">
        <div class="journal-toolbar">
          <div class="journal-title"><h1 id="journal-title">${viewTitles[view]}</h1>
            ${view === "week" ? `<a class="journal-tool-link" id="journal-summary" href="/app/${id}/summary">주간 요약</a>` : ""}
            ${view === "week" || view === "cabinet" ? `<a class="journal-tool-link" id="journal-notes" href="/app/${id}/notes">주간 메모</a>` : ""}
            ${view === "notes" ? `<a class="journal-tool-link" href="/app/${id}/cabinet">Cabi.NET</a>` : ""}
          </div>
          <div class="journal-tools" id="journal-tools" hidden>
          ${
            view === "cabinet"
              ? ""
              : view === "search"
                ? '<label class="visually-hidden" for="journal-search">기록 검색</label><input type="search" id="journal-search" maxlength="100" autocomplete="off" placeholder="본문, 업무 또는 태그">'
                : '<div class="journal-period"><button type="button" class="quiet period-step" id="period-prev" aria-label="이전 기간">‹</button><div class="period-picker"><span id="period-range" aria-hidden="true"></span><input type="date" id="journal-date" aria-label="기준일"></div><button type="button" class="quiet period-step" id="period-next" aria-label="다음 기간">›</button><button type="button" class="quiet" id="journal-today">오늘</button></div>'
          }
          ${view === "kanban" ? '<label for="board-period">표시 기간</label><select id="board-period"><option value="week">선택한 주</option><option value="all">전체 기간</option></select>' : ""}
          ${view === "summary" ? '<button type="button" class="quiet" id="journal-download">Markdown 다운로드</button>' : ""}
          </div>
        </div>
        <p class="status" id="journal-status" role="status">온라인 기록을 불러오는 중입니다.</p>
        <div id="journal-content"></div>
        <noscript>기록을 보려면 자바스크립트를 켜 주세요.</noscript>
        </section>
        <dialog id="record-dialog" class="record-dialog" aria-labelledby="record-label">
        <form id="record-editor" class="record-editor">
          <label for="record-text" id="record-label">기록 편집</label>
          <p id="record-context" class="record-context" hidden></p>
          <textarea id="record-text" rows="5" required></textarea>
          <p id="record-status" role="status"></p>
          <div class="actions">
            <button class="primary" type="submit">서버에 저장</button>
            <button class="quiet" type="button" id="record-cancel">닫기</button>
          </div>
        </form>
        </dialog>
      </main><script src="/assets/workspace.js" type="module"></script>`,
      { workspace: true },
    );
  }
  if (path === "/login")
    return layout(
      "웹 로그인",
      `
    <main class="auth card">
      <h1 id="login-title" tabindex="-1">웹 로그인</h1>
      <p id="login-description">등록된 이메일로 온라인 워크스페이스에 로그인하세요.</p>
      <form id="email-form" data-version="${version}">
        <label for="email">이메일</label>
        <input id="email" name="email" type="email" autocomplete="email" maxlength="254" required>
        <div class="consent">
          <input id="agree" name="agree" type="checkbox" required>
          <div>
            <label for="agree">이용약관 및 개인정보 처리방침에 동의합니다.</label>
            <div class="policy-links">
              <a href="/terms" target="_blank" rel="noopener">이용약관</a>
              <a href="/privacy" target="_blank" rel="noopener">개인정보 처리방침</a>
            </div>
          </div>
        </div>
        <button class="primary" type="submit">인증번호 받기</button>
      </form>
      <form id="code-form" hidden>
        <label for="code">인증번호</label>
        <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code"
          pattern="[0-9]{8}" minlength="8" maxlength="8" aria-describedby="login-description" required>
        <button class="primary" type="submit">로그인</button>
        <div class="actions">
          <button class="quiet" type="button" id="change-email">이메일 수정</button>
          <button class="quiet" type="button" id="resend-code">다시 보내기</button>
        </div>
      </form>
      <p id="login-status" class="status" role="status"></p>
      <noscript>로그인하려면 자바스크립트를 켜 주세요.</noscript>
    </main>`,
      { script: true },
    );

  if (path === "/spaces")
    return layout(
      "온라인 워크스페이스",
      `
    <main class="spaces card">
      <div class="space-heading">
        <div>
          <h1>온라인 워크스페이스</h1>
          <p id="account-email"></p>
        </div>
        <button id="logout" class="quiet" type="button">로그아웃</button>
      </div>
      <p id="space-status" class="status" role="status">공간을 불러오는 중입니다.</p>
      <ul id="space-list" class="space-list"></ul>
      <div id="empty-spaces" hidden>
        <h2>온라인 공간이 없습니다</h2>
        <p>같은 DEV 계정으로 데스크탑 앱에서 온라인 공간을 만든 뒤 이곳에서 확인할 수 있습니다.</p>
        <a href="${repository}/releases/latest">데스크탑 앱 받기</a>
      </div>
      <button id="reload-spaces" class="quiet" type="button" hidden>다시 불러오기</button>
      <noscript>공간을 확인하려면 자바스크립트를 켜 주세요.</noscript>
    </main>`,
      { script: true },
    );

  if (path === "/terms")
    return policyPage(
      "이용약관",
      version,
      `
    <h2>서비스와 이용 대상</h2>
    <p>sanbonjini는 Work Journey Board 웹 서비스에서 등록된 사용자가 같은 DEV 계정의 온라인 공간을 확인할 수 있도록 제공합니다. 운영자가 미리 등록한 이메일로 로그인할 수 있습니다.</p>
    <h2>계정과 이용 제한</h2>
    <p>인증번호는 본인만 사용하세요. 이용 권한이 중지되거나 회수되면 웹 접근도 제한될 수 있습니다. DEV 검증 중에는 운영 업무 자료를 입력하지 마세요.</p>
    <h2>계정 삭제와 문의</h2>
    <p>계정 삭제는 기존 데스크탑 설정 절차를 따릅니다. 검증과 계정 관련 문의는 운영자에게 전달해 주세요.</p>`,
    );

  if (path === "/privacy")
    return policyPage(
      "개인정보 처리방침",
      version,
      `
    <h2>처리 항목과 목적</h2>
    <p>등록 이메일과 계정 식별자는 로그인 및 접근 권한 확인에 사용됩니다. 약관 동의 판과 시각은 동의 내역 확인을 위해 계정에 연결됩니다. 공간 목록은 로그인한 사용자의 권한에 따라 요청합니다.</p>
    <h2>쿠키와 보유 기간</h2>
    <p>인증 요청 쿠키는 최대 60분, 로그인 쿠키는 최대 12시간 유지됩니다. 같은 브라우저 기기를 재사용하기 위한 식별 쿠키는 최대 365일 유지됩니다. 인증 토큰은 서버에서 암호화하여 보관합니다. DEV 동의 이력은 최대 365일 보관합니다.</p>
    <h2>서비스 제공과 이용자 권리</h2>
    <p>Supabase의 DEV 인증 및 게이트웨이를 사용합니다. 호스트와 세션 저장소 운영 정보는 확정 후 반영합니다. 계정과 개인정보 관련 문의는 운영자에게 전달해 주세요.</p>`,
    );

  return null;
}

function policyPage(title, version, content) {
  return layout(
    title,
    `
    <main class="policy card">
      <h1>${title}</h1>
      <p>DEV 검토 문안 · ${version}</p>
      ${content}
      <p><a href="/login">로그인으로 돌아가기</a></p>
    </main>`,
  );
}
