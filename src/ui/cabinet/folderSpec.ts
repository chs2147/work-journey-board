// 폴더 창 주소의 정보(index.html?win=folder&d=…) 읽기 — 모르는 값은 기본값으로
import type { FolderWindowSpec } from "../../platform";

export function parseFolderSpec(search: string): FolderWindowSpec | null {
  try {
    const d = new URLSearchParams(search).get("d");
    const v = d ? (JSON.parse(d) as Partial<FolderWindowSpec>) : null;
    if (!v || typeof v.id !== "string" || typeof v.root !== "string") return null;
    return {
      id: v.id,
      root: v.root,
      sub: typeof v.sub === "string" ? v.sub : v.root,
      title: typeof v.title === "string" ? v.title : v.root,
      links: Array.isArray(v.links) ? v.links.filter((x): x is string => typeof x === "string") : [],
      theme: typeof v.theme === "string" ? v.theme : "light",
    };
  } catch {
    return null;
  }
}
