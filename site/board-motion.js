// 01 기록 — 히어로 주간 보드 목업이 직접 적히는 모션(improve-v23-spec 10절): 타이핑 → Enter·Tab → Alt+I ★·Alt+U 마감일 → 메모 연결.
// 보일 때만 되풀이, OS "동작 줄이기"·사이트 모션 끄기면 원래 그림 그대로.
(() => {
  const art = document.querySelector(".hero-art");
  const cell = art?.querySelector(".mock-cell.selected");
  const memo = art?.querySelector(".mock-memo-card");
  if (!art || !cell || !memo) return;
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const original = cell.innerHTML;
  const memoOriginal = memo.innerHTML;
  const key = document.createElement("div");
  key.className = "kbd-float";
  key.setAttribute("aria-hidden", "true");
  art.appendChild(key);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let run = 0;
  let visible = false;
  const moving = () => !reduced.matches && root.dataset.showcaseMotion !== "off";
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

  function render(s) {
    const star = s.star ? '<b class="mk-star">★</b> ' : "";
    const due = s.due ? ' <i class="mk-due">⏳ D-4</i>' : "";
    const sub = s.sub !== undefined ? `<br><span class="${s.indent ? "mk-sub" : ""}">${s.indent ? "◦ " : "• "}${esc(s.sub)}</span>` : "";
    const caret = s.caret ? '<span class="mk-caret"></span>' : "";
    const link = s.link ? '<i class="mock-chip mk-link">메모 1</i>' : "";
    cell.innerHTML = `<span>${star}${esc(s.main)}${s.sub === undefined ? caret : ""}${due}${sub}${s.sub !== undefined ? caret : ""}</span>${link}`;
  }
  function press(label) {
    key.textContent = label;
    key.classList.remove("on");
    void key.offsetWidth;
    key.classList.add("on");
  }

  async function loop(id) {
    const alive = () => id === run && visible && moving() && !document.hidden;
    while (alive()) {
      const st = { main: "", caret: true };
      cell.classList.add("mk-typing");
      memo.innerHTML = memoOriginal;
      memo.classList.remove("mk-linked");
      render(st);
      await sleep(500);
      press("가 나 다");
      for (const ch of "설계안 리뷰") {
        if (!alive()) return;
        st.main += ch;
        render(st);
        await sleep(110);
      }
      await sleep(350);
      press("Enter");
      st.sub = "";
      render(st);
      await sleep(350);
      for (const ch of "의견 5건 반영") {
        if (!alive()) return;
        st.sub += ch;
        render(st);
        await sleep(95);
      }
      await sleep(300);
      press("Tab");
      st.indent = true;
      render(st);
      await sleep(800);
      press("Alt + I");
      st.star = true;
      render(st);
      await sleep(800);
      press("Alt + U");
      st.due = true;
      render(st);
      await sleep(900);
      st.caret = false;
      st.link = true;
      render(st);
      memo.classList.add("mk-linked");
      memo.innerHTML = memoOriginal.replace("확인할 내용", "설계안 리뷰 — 확인할 내용");
      press("메모 연결");
      await sleep(2600);
      if (!alive()) return;
      cell.classList.remove("mk-typing");
      await sleep(600);
    }
  }
  function sync() {
    run++;
    if (visible && moving() && !document.hidden) void loop(run);
    else {
      cell.innerHTML = original;
      memo.innerHTML = memoOriginal;
      cell.classList.remove("mk-typing");
      memo.classList.remove("mk-linked");
      key.classList.remove("on");
    }
  }
  new IntersectionObserver(
    (e) => {
      const v = e[0].isIntersecting;
      if (v !== visible) {
        visible = v;
        sync();
      }
    },
    { threshold: 0.3 },
  ).observe(art);
  document.addEventListener("visibilitychange", sync);
  reduced.addEventListener("change", sync);
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-showcase-motion"] });
})();
