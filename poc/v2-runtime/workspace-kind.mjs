// Browser-safe workspace type/status projection. No imports, IO, credentials or network.
export function workspacePresentation(entry, state) {
  const local = { saved: "이 PC에 저장됨", saving: "저장 중", failed: "이 PC에 저장하지 못함" }[
    state.localSave
  ];
  if (!local) throw Error("LOCAL_SAVE_STATE_REQUIRED");
  if (entry.kind === "offline_only")
    return Object.freeze({
      kind: entry.kind,
      label: "오프라인 전용",
      icon: "disk",
      local,
      remote: null,
      detail: "이 기기에서만 저장",
    });
  if (entry.kind !== "online") throw Error("WORKSPACE_KIND_REQUIRED");
  if (
    !["connected", "disconnected"].includes(state.network) ||
    !["valid", "expired"].includes(state.auth) ||
    !Number.isSafeInteger(state.pending) ||
    state.pending < 0
  )
    throw Error("ONLINE_STATE_REQUIRED");
  let remote;
  if (state.auth === "expired") remote = "다시 로그인 필요";
  else if (state.network === "disconnected")
    remote = "연결 끊김" + (state.pending ? ` · ${state.pending}건 전송 대기` : "");
  else if (state.pending) remote = `${state.pending}건 전송 대기`;
  else if (state.localSave !== "saved") remote = "이 기기 저장 확인 필요";
  else remote = state.serverAck === true ? "온라인 반영됨" : "서버 확인 중";
  return Object.freeze({
    kind: entry.kind,
    label: "온라인",
    icon: "cloud",
    local,
    remote,
    detail: "같은 온라인 워크스페이스에 연결",
  });
}
