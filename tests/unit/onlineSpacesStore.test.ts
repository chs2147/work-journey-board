// UX-3(docs/v2-design/95): 계정이 바뀌면 온라인 공간 목록을 바로 비우고 그 계정 것만 — 늦게 온 이전 계정 응답은 버린다
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { resolve: (v: unknown) => void }[] = [];
vi.mock("../../src/platform", async (orig) => ({
  ...(await orig<typeof import("../../src/platform")>()),
  loadPreviewSpaces: async () => ({
    list: () => new Promise((resolve) => calls.push({ resolve })),
  }),
}));

const { setAccount, useOnlineSpaces, resetOnlineSpaces, lastOpened, forgetLastOpened } =
  await import("../../src/ui/preview/onlineSpaceStore");
const row = (id: string) => ({
  workspaceId: id,
  manifestHash: "a".repeat(64),
  records: 1,
  assets: 0,
  createdAt: null,
  sourceSchema: 20,
  workspace: { name: "가상 공간", color: "c2", icon: "memo" },
});
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("온라인 공간 목록 — 계정 전환", () => {
  beforeEach(() => {
    calls.length = 0;
    resetOnlineSpaces();
  });

  it("다른 계정으로 바뀌면 목록을 즉시 비우고, 늦게 온 이전 계정 목록은 쓰지 않는다", async () => {
    setAccount("owner-a", "a@example.invalid");
    await tick();
    calls[0]!.resolve({ workspaces: [row("ws-a")] });
    await tick();
    expect(useOnlineSpaces.getState().list?.map((w) => w.workspaceId)).toEqual(["ws-a"]);

    // A의 두 번째 요청이 아직 안 끝난 사이 B로 바뀜
    setAccount("owner-a", "a@example.invalid"); // 같은 계정 = 다시 받지 않음
    expect(calls).toHaveLength(1);
    void import("../../src/ui/preview/onlineSpaceStore").then((m) => m.refreshSpaces());
    await tick();
    setAccount("owner-b", "b@example.invalid");
    expect(useOnlineSpaces.getState().list).toBeNull();
    expect(useOnlineSpaces.getState().email).toBe("b@example.invalid");
    await tick();
    calls[1]!.resolve({ workspaces: [row("ws-a-late")] }); // 이전 계정 응답
    calls[2]!.resolve({ workspaces: [row("ws-b")] });
    await tick();
    expect(useOnlineSpaces.getState().list?.map((w) => w.workspaceId)).toEqual(["ws-b"]);

    setAccount(null, null);
    expect(useOnlineSpaces.getState().list).toBeNull();
  });

  it("마지막으로 연 공간은 계정마다 따로, [목록으로]면 잊는다", () => {
    localStorage.setItem("wjb.preview.lastOnline.owner-a", "ws-a");
    expect(lastOpened("owner-a")).toBe("ws-a");
    expect(lastOpened("owner-b")).toBeNull();
    setAccount("owner-a", "a@example.invalid");
    forgetLastOpened();
    expect(lastOpened("owner-a")).toBeNull();
  });
});
