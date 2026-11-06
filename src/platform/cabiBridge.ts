/** Modeless document windows. Children never open a database. */
export interface CabiWindowSpec {
  kind: "note" | "board";
  id: string;
  title: string;
  theme: string;
}
export interface CabiMessage {
  type: string;
  [key: string]: unknown;
}
export interface CabiBridge {
  open(spec: CabiWindowSpec): Promise<void>;
  closeAll(): Promise<void>;
  opened(): Promise<string[]>;
  call(name: string, args: unknown[]): Promise<unknown>;
  serve(handler: (name: string, args: unknown[], sender: string) => Promise<unknown>): Promise<void>;
  publish(message: CabiMessage, target?: string): Promise<void>;
  listen(handler: (message: CabiMessage) => void): Promise<() => void>;
  onClose(handler: () => Promise<void>): Promise<() => void>;
  closeSelf(): Promise<void>;
  label(): string;
}

/** Browser preview uses real popup windows and a per-tab channel; no shared DB writers. */
export function browserCabiBridge(): CabiBridge {
  const params = new URLSearchParams(location.search);
  const child = params.get("win") === "cabi";
  const session = params.get("host") ?? sessionStorage.getItem("wjb-cabi-host") ?? crypto.randomUUID();
  if (!child) sessionStorage.setItem("wjb-cabi-host", session);
  const label = child ? `cabi-${params.get("kind")}-${params.get("id")}` : "main";
  const channel = new BroadcastChannel("wjb-cabi-" + session);
  const children = new Map<string, Window>();
  const requests = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  const listeners = new Set<(m: CabiMessage) => void>();
  let handler: ((n: string, a: unknown[], s: string) => Promise<unknown>) | null = null;
  let closer: (() => Promise<void>) | null = null;
  channel.onmessage = async ({ data: m }) => {
    if (!m || (m.target !== label && m.target !== "*")) return;
    if (m.rpc && handler) {
      try {
        channel.postMessage({
          target: m.sender,
          result: m.rpc,
          value: await handler(m.name, m.args, m.sender),
        });
      } catch (e) {
        channel.postMessage({
          target: m.sender,
          result: m.rpc,
          error: String(e instanceof Error ? e.message : e),
        });
      }
      return;
    }
    if (m.result) {
      const job = requests.get(m.result);
      if (job) {
        clearTimeout(job.timer);
        requests.delete(m.result);
        if (m.error) job.reject(new Error(m.error));
        else job.resolve(m.value);
      }
      return;
    }
    if (m.message) for (const fn of listeners) fn(m.message);
  };
  return {
    async open(s) {
      const key = `cabi-${s.kind}-${s.id}`,
        old = children.get(key);
      if (old && !old.closed) {
        old.focus();
        return;
      }
      const q = new URLSearchParams({ win: "cabi", host: session, kind: s.kind, id: s.id, t: s.theme });
      const w = window.open(`${location.pathname}?${q}`, key, "popup,width=1180,height=820");
      if (!w) throw new Error("별도 창이 차단되었습니다. 이 앱의 팝업을 허용해 주세요.");
      children.set(key, w);
    },
    async opened() {
      return [...children].filter(([, w]) => !w.closed).map(([k]) => k);
    },
    async closeAll() {
      for (const w of children.values()) w.close();
      children.clear();
    },
    async call(name, args) {
      if (label === "main") {
        if (!handler) throw new Error("저장 조정기가 준비되지 않았습니다.");
        return handler(name, args, label);
      }
      const rpc = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          requests.delete(rpc);
          reject(new Error("메인 창이 응답하지 않습니다. 저장 내용은 이 창에 유지됩니다."));
        }, 20_000);
        requests.set(rpc, { resolve, reject, timer });
        channel.postMessage({ target: "main", sender: label, rpc, name, args });
      });
    },
    async serve(fn) {
      handler = fn;
    },
    async publish(message, target = "*") {
      channel.postMessage({ target, message });
      if (target === label || target === "*") for (const fn of listeners) fn(message);
    },
    async listen(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async onClose(fn) {
      closer = fn;
      const guard = (e: BeforeUnloadEvent) => {
        if (closer && document.body.dataset.cabiDirty === "true") {
          e.preventDefault();
          e.returnValue = "";
        }
      };
      window.addEventListener("beforeunload", guard);
      return () => {
        closer = null;
        window.removeEventListener("beforeunload", guard);
      };
    },
    async closeSelf() {
      await closer?.();
      closer = null;
      window.close();
    },
    label: () => label,
  };
}
