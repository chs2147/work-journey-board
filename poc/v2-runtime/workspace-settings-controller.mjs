// Browser-safe A-layout view model. The port owns storage, authentication and handles.
export function createWorkspaceSettingsController(port, render) {
  let request = 0,
    disposed = false;
  let model = Object.freeze({ entries: [], activeId: null, phase: "idle", busy: false, error: null });
  const publish = (patch) => {
    model = Object.freeze({ ...model, ...patch });
    if (!disposed) render(model);
  };
  const messages = {
    WORKSPACE_SAVE_FAILED: "현재 공간을 저장하지 못했습니다. 저장 상태를 확인한 후 다시 시도하세요.",
    WORKSPACE_OWNER_MISMATCH: "이 온라인 공간을 소유한 계정으로 로그인해 주세요.",
    PRODUCT_ACTIVATION_REQUIRED: "온라인 공간의 제품용 저장소 검증이 아직 완료되지 않았습니다.",
    WORKSPACE_CLOSE_FAILED: "현재 공간을 안전하게 닫지 못했습니다. 앱을 다시 시작해 주세요.",
    WORKSPACE_BRIDGE_BLOCKED: "저장소 상태를 확인하려면 앱을 다시 시작해 주세요.",
    WORKSPACE_ACTIVATION_FAILED: "화면 연결을 완료하지 못했습니다. 앱을 다시 시작해 주세요.",
  };
  async function run(command, payload = {}) {
    if (disposed || (command === "select" && model.phase === "unknown")) return;
    if (command === "list" && model.busy) return;
    const id = ++request;
    publish({ busy: true, error: null });
    try {
      const result = await port.request(command, payload);
      if (disposed || id !== request) return;
      if (!result || typeof result.ok !== "boolean" || !result.state || !Array.isArray(result.state.entries))
        throw Error("INVALID_BRIDGE_REPLY");
      // Copy only the public view fields, never path/credential/raw error properties.
      const entries = result.state.entries.map((e) => {
        if (
          !["offline_only", "online"].includes(e.kind) ||
          typeof e.entryId !== "string" ||
          typeof e.name !== "string"
        )
          throw Error("INVALID_BRIDGE_REPLY");
        return Object.freeze({ entryId: e.entryId, name: e.name, kind: e.kind });
      });
      publish({
        entries: Object.freeze(entries),
        activeId: result.state.activeId,
        phase: result.state.phase,
        busy: false,
        error: result.ok
          ? null
          : (messages[result.code] ?? "공간을 열지 못했습니다. 목록과 연결 상태를 확인해 주세요."),
      });
    } catch {
      if (!disposed && id === request)
        publish({
          activeId: null,
          phase: "unknown",
          busy: false,
          error: "공간 상태를 확인하지 못했습니다. 목록을 새로고침해 주세요.",
        });
    }
  }
  return Object.freeze({
    load: () => run("list"),
    select: (entryId) => run("select", { entryId }),
    deactivate: () => run("deactivate"),
    accountChanged: () => run("accountChanged"),
    getState: () => model,
    dispose: () => {
      disposed = true;
      request++;
    },
  });
}
