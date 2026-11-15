// 가짜 동기화 서버(시험·브라우저 모드) — 서버 SQL 019(wjb_v2_workspace_sync)와 같은 규칙만 흉내 낸다. 네트워크 없음.
// 기록별 판·지움 표시·변경 순번, 기대 판이 하나라도 다르면 전부 미적용 + 충돌, 같은 요청 번호 = 같은 결과, 그림 본문 거절.
import { canonical, sha256Hex } from "../../poc/v2-sync/hash-core.mjs";
import type { MappedRecord } from "../../poc/v2-migration/workspace-map-core.mjs";
import type { SyncTransport } from "./spaceSync";

type Row = Record<string, unknown>;
interface Rec {
  value: Row | null;
  rev: number;
  seq: number;
}
interface Space {
  seq: number;
  records: Map<string, Rec>; // `${table}\0${key}`
  applied: Map<string, { hash: string; result: Row }>;
  assets: Map<string, { sha256: string; bytes: Uint8Array }>;
}

export function createFakeSyncServer(
  seed: (workspaceId: string) => { records: MappedRecord[]; assets: Map<string, Uint8Array> } | null,
) {
  const spaces = new Map<string, Space>();
  const space = (ws: string) => {
    let s = spaces.get(ws);
    if (!s) {
      const src = seed(ws);
      if (!src) throw Error("SYNC_NOT_FOUND");
      s = { seq: 0, records: new Map(), applied: new Map(), assets: new Map() };
      for (const r of src.records)
        s.records.set(`${r.table}\0${r.key}`, { value: structuredClone(r.value), rev: 0, seq: 0 });
      for (const [id, b] of src.assets) s.assets.set(id, { sha256: sha256Hex(b), bytes: b });
      spaces.set(ws, s);
    }
    return s;
  };
  let offline = false;
  const transport = (device = "fake-device"): SyncTransport => ({
    async call(action, p) {
      if (offline) throw Error("NETWORK");
      const ws = String(p.workspaceId);
      const s = space(ws);
      if (action === "pull") {
        const after = Number(p.after);
        if (after > s.seq) throw Error("SYNC_CURSOR_AHEAD");
        const list = [...s.records.entries()]
          .filter(([, r]) => r.seq > after)
          .sort((a, b) => a[1].seq - b[1].seq);
        const limit = Number(p.limit);
        const page = list.slice(0, limit);
        return {
          changes: page.map(([k, r]) => {
            const [table, key] = k.split("\0");
            return { table, key, value: structuredClone(r.value), rev: r.rev, seq: String(r.seq) };
          }),
          more: list.length > limit,
          next: String(page.at(-1)?.[1].seq ?? after),
          head: String(s.seq),
        };
      }
      const changes = p.changes as {
        table: string;
        key: string;
        baseRev: number | null;
        value: Row | null;
      }[];
      const op = String(p.opId);
      const h = canonical(p);
      const done = s.applied.get(op);
      if (done) {
        if (done.hash !== h) throw Error("SYNC_IDEMPOTENCY_MISMATCH");
        return { ...done.result, replayed: true };
      }
      for (const c of changes) {
        if (c.table === "kanban_ctx") throw Error("SYNC_INVALID_CHANGE");
        if (/data:[a-z]+\/[a-z0-9.+-]+;base64,/i.test(JSON.stringify(c.value)))
          throw Error("SYNC_INLINE_IMAGE");
        for (const f of ["dataRef", "thumbRef"]) {
          const ref = c.value?.[f] as { objectId: string; sha256: string } | null | undefined;
          if (ref && s.assets.get(ref.objectId)?.sha256 !== ref.sha256) throw Error("SYNC_ASSET_NOT_READY");
        }
      }
      const conflicts = changes.flatMap((c) => {
        const cur = s.records.get(`${c.table}\0${c.key}`);
        const ok = c.baseRev === null ? !cur : !!cur && cur.rev === c.baseRev;
        return ok
          ? []
          : [
              {
                table: c.table,
                key: c.key,
                baseRev: c.baseRev,
                rev: cur?.rev ?? null,
                exists: !!cur,
                value: structuredClone(cur?.value ?? null),
              },
            ];
      });
      if (conflicts.length) return { applied: false, conflicts, head: String(s.seq) };
      const records = changes.map((c) => {
        const k = `${c.table}\0${c.key}`;
        const cur = s.records.get(k);
        const rec = { value: structuredClone(c.value), rev: (cur?.rev ?? 0) + 1, seq: ++s.seq };
        s.records.set(k, rec);
        return { table: c.table, key: c.key, rev: rec.rev, seq: String(rec.seq) };
      });
      const result = { applied: true, records, head: String(s.seq), device };
      s.applied.set(op, { hash: h, result });
      return result;
    },
    async uploadAsset(ws, objectId, sha256, bytes) {
      if (offline) throw Error("NETWORK");
      if (sha256Hex(bytes) !== sha256) throw Error("INTEGRITY_MISMATCH");
      const s = space(ws);
      const had = s.assets.get(objectId);
      if (had && had.sha256 !== sha256) throw Error("SYNC_ASSET_CONFLICT");
      s.assets.set(objectId, { sha256, bytes: bytes.slice() });
    },
    async fetchAsset(ws, objectId, sha256, n) {
      const a = space(ws).assets.get(objectId);
      if (!a || a.sha256 !== sha256 || a.bytes.length !== n)
        throw Error(offline ? "NETWORK" : "ASSET_HTTP_404");
      return a.bytes.slice();
    },
  });
  return {
    transport,
    setOffline(v: boolean) {
      offline = v;
    },
    /** 시험 확인용 */
    record(ws: string, table: string, key: string) {
      return spaces.get(ws)?.records.get(`${table}\0${key}`) ?? null;
    },
    head: (ws: string) => spaces.get(ws)?.seq ?? 0,
  };
}
