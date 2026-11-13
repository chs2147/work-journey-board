// 칸반 보드 소개 모션(1.35): 카드 하나가 TODO → 검토 중 → DONE(축하) → DONE 줄로 접힘을 되풀이한다.
// 보일 때만 움직이고, 단계를 직접 고르면 그 장면에 머문다. 동작 줄이기·사이트 모션 끄기를 따른다.
(() => {
  const stage = document.querySelector(".kb-stage");
  if (!stage) return;
  const steps = [...document.querySelectorAll("[data-kb]")];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const root = document.documentElement;
  const cheer = stage.querySelector(".kb-cheer");
  const colors = ["#a45e43", "#2f9e5b", "#e8b628", "#3d7bd6", "#d96c4a", "#2f9e5b", "#e8b628"];
  for (let i = 0; i < 14; i++) {
    const a = Math.PI * (1.05 + (0.9 * i) / 13);
    const d = 46 + ((i * 37) % 28);
    const p = document.createElement("i");
    p.style.background = colors[i % colors.length];
    p.style.setProperty("--dx", `${Math.cos(a) * d * 1.6}px`);
    p.style.setProperty("--dy", `${Math.sin(a) * d}px`);
    p.style.setProperty("--r", `${(i * 53) % 360}deg`);
    p.style.animationDelay = `${0.9 + (i % 4) * 0.02}s`;
    cheer.appendChild(p);
  }
  const hold = [2600, 2600, 2400, 2600];
  let phase = 0,
    timer = 0,
    visible = false,
    manual = false;
  const moving = () => !reduced.matches && root.dataset.showcaseMotion !== "off";
  function set(n) {
    phase = n;
    stage.dataset.phase = String(n);
    steps.forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.kb === n)));
  }
  function run() {
    clearTimeout(timer);
    if (!visible || manual || document.hidden || !moving()) return;
    timer = setTimeout(() => {
      set((phase + 1) % 4);
      run();
    }, hold[phase]);
  }
  steps.forEach((b) =>
    b.addEventListener("click", () => {
      manual = true;
      clearTimeout(timer);
      // 같은 장면을 다시 눌러도 모션이 다시 보이게
      stage.dataset.phase = "";
      void stage.offsetWidth;
      set(+b.dataset.kb);
    }),
  );
  new IntersectionObserver(
    (e) => {
      visible = e[0].isIntersecting;
      run();
    },
    { threshold: 0.25 },
  ).observe(stage);
  document.addEventListener("visibilitychange", run);
  reduced.addEventListener("change", run);
  new MutationObserver(run).observe(root, { attributes: true, attributeFilter: ["data-showcase-motion"] });
  set(moving() ? 0 : 3);
})();
