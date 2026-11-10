import { createWorkspaceSettingsController } from "/workspace-settings-controller.mjs";
import { workspacePresentation } from "/workspace-kind.mjs";
const $ = (id) => document.getElementById(id);
const icon = (name) => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(s.namespaceURI, "use");
  use.setAttribute("href", "#" + name);
  s.append(use);
  return s;
};
const badge = (kind) => {
  const b = document.createElement("span");
  b.className = "chip " + (kind === "online" ? "online" : "");
  b.append(
    icon(kind === "online" ? "cloud" : "disk"),
    document.createTextNode(kind === "online" ? "온라인" : "오프라인 전용"),
  );
  return b;
};
function projection(e) {
  const mode = $("connection").value;
  return workspacePresentation(e, {
    localSave: "saved",
    network: mode === "disconnected" ? "disconnected" : "connected",
    auth: mode === "expired" ? "expired" : "valid",
    pending: mode === "pending" ? 3 : 0,
    serverAck: false,
  });
}
const ui = createWorkspaceSettingsController(
  {
    async request(command, payload) {
      const r = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, payload }),
      });
      if (!r.ok) throw Error("BRIDGE_TRANSPORT_FAILED");
      return r.json();
    },
  },
  render,
);
function render(state) {
  $("list").replaceChildren();
  $("list").setAttribute("aria-busy", String(state.busy));
  $("empty").hidden = state.entries.length !== 0;
  for (const entry of state.entries) {
    const presentation = projection(entry),
      active = state.activeId === entry.entryId;
    const row = document.createElement("div");
    row.className = "workspace" + (active ? " active" : "");
    row.dataset.kind = entry.kind;
    row.dataset.entryId = entry.entryId;
    const mark = document.createElement("div");
    mark.className = "space-icon";
    mark.append(icon(presentation.icon));
    const text = document.createElement("div"),
      name = document.createElement("div");
    name.className = "name";
    name.append(document.createTextNode(entry.name), badge(entry.kind));
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = entry.kind === "offline_only" ? "이 기기에서만 저장 · 원본 유지" : presentation.remote;
    text.append(name, sub);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = active ? "사용 중" : "열기";
    button.disabled = state.busy || active || ["blocked", "unknown"].includes(state.phase);
    button.setAttribute("aria-label", entry.name + " " + (active ? "사용 중" : "열기"));
    button.append(icon("arrow"));
    button.addEventListener("click", () => ui.select(entry.entryId));
    row.append(mark, text, button);
    $("list").append(row);
  }
  const current = state.entries.find((e) => e.entryId === state.activeId);
  $("current").replaceChildren();
  if (current) $("current").append(document.createTextNode(current.name), badge(current.kind));
  else $("current").textContent = "워크스페이스 선택 전";
  $("error").hidden = !state.error;
  $("error").textContent = state.error ?? "";
  $("status").textContent = state.busy ? "공간 상태 확인 중…" : current ? projection(current).local : "";
  $("reload").disabled = state.busy;
  $("close").disabled = state.busy || !current || ["blocked", "unknown"].includes(state.phase);
}
$("theme").addEventListener("change", () => (document.body.dataset.theme = $("theme").value));
$("connection").addEventListener("change", () => render(ui.getState()));
$("scenario").addEventListener("change", async () => {
  const r = await fetch("/api/scenario", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario: $("scenario").value }),
  });
  if (!r.ok) {
    $("error").hidden = false;
    $("error").textContent = "검증 조건을 설정하지 못했습니다.";
  }
});
$("reload").addEventListener("click", () => ui.load());
$("close").addEventListener("click", () => ui.deactivate());
await ui.load();
