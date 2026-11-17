// 브라우저 모드(개발·E2E)용 가짜 계정 한도·관리자(docs/v2-design/96, 서버 SQL 028과 같은 규칙) — 네트워크 없음, 메모리.
// 지금 로그인한 가짜 계정 = 기본 한도(그림 100MB · 공간 3 · 기록 30MB). ?previewAdmin=1 이면 이 계정이 관리자(무제한·전체 사용량).
// 관리자 목록에는 가상 계정 하나(invited@example.invalid)가 함께 있다.
import { fakePublishedSpaces, fakeLiveSpaceCount } from "./browserPreviewMigration";
import type { AccountUsage, AdminAccount } from "./index";

const ME = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const OTHER = "7a2e3d4c-5b6f-4071-9b8c-0d1e2f3a4b5c";
const DEFAULT = { images: 104_857_600, spaces: 3, records: 31_457_280 };
interface Override {
  images?: number | null;
  spaces?: number | null;
  records?: number | null;
  unlimited?: boolean;
  suspended?: boolean;
}
const overrides = new Map<string, Override>();
const invited = new Map<string, string>([[OTHER, "invited@example.invalid"]]);
const isAdmin = (id: string) =>
  id === ME &&
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("previewAdmin") === "1";

function used(id: string) {
  if (id !== ME) return { images: 0, spaces: 0, records: 0 };
  const spaces = fakePublishedSpaces();
  return {
    images: spaces.reduce(
      (n, s) => n + (s.header.assets as { bytes?: number }[]).reduce((m, a) => m + (a.bytes ?? 0), 0),
      0,
    ),
    spaces: fakeLiveSpaceCount(),
    records: spaces.reduce((n, s) => n + JSON.stringify(s.records).length, 0),
  };
}
function usage(id: string): AccountUsage {
  const o = overrides.get(id) ?? {};
  const admin = isAdmin(id);
  const unlimited = admin || !!o.unlimited;
  return {
    limits: unlimited
      ? { images: null, spaces: null, records: null }
      : {
          images: o.images ?? DEFAULT.images,
          spaces: o.spaces ?? DEFAULT.spaces,
          records: o.records ?? DEFAULT.records,
        },
    used: used(id),
    unlimited,
    suspended: !admin && !!o.suspended,
    admin,
  };
}
/** 가짜 이관 서버: 새 공간을 만들 때(서버 trg_space_insert와 같은 판단) */
export function fakeSpaceGuard(): void {
  const u = usage(ME);
  if (u.suspended) throw new Error("ACCOUNT_SUSPENDED");
  if (u.limits.spaces !== null && u.used.spaces >= u.limits.spaces) throw new Error("QUOTA_ACCOUNT_SPACES");
}

export async function fakeAccount(action: string, params: Record<string, unknown>): Promise<unknown> {
  if (action === "usage")
    return {
      ...usage(ME),
      ...(isAdmin(ME)
        ? {
            project: {
              images: used(ME).images,
              imagesLimit: 838_860_800,
              db: 30_000_000,
              dbLimit: 419_430_400,
            },
          }
        : {}),
    };
  if (!isAdmin(ME)) throw new Error("ACCOUNT_NOT_ADMIN");
  if (action === "admin_list") {
    const list: AdminAccount[] = [
      {
        ...usage(ME),
        userId: ME,
        email: "virtual@example.invalid",
        createdAt: null,
        lastSignInAt: null,
        custom: false,
      },
      ...[...invited].map(([id, email]) => ({
        ...usage(id),
        userId: id,
        email,
        createdAt: null,
        lastSignInAt: null,
        custom: overrides.has(id),
      })),
    ];
    return { accounts: list };
  }
  if (action === "admin_set") {
    const id = String(params.userId);
    if (isAdmin(id)) throw new Error("ACCOUNT_ADMIN_FIXED");
    if (!invited.has(id)) throw new Error("ACCOUNT_NOT_FOUND");
    if (params.reset) overrides.delete(id);
    else {
      const rest: Override = {};
      for (const k of ["images", "spaces", "records", "unlimited", "suspended"] as const)
        if (k in params) Object.assign(rest, { [k]: params[k] });
      overrides.set(id, { ...overrides.get(id), ...rest });
    }
    return { ...usage(id), userId: id };
  }
  if (action === "admin_invite") {
    const email = String(params.email).trim().toLowerCase();
    const had = [...invited.values()].includes(email);
    if (!had) invited.set(crypto.randomUUID(), email);
    return { invited: true, created: !had };
  }
  throw new Error("ACCOUNT_INVALID_REQUEST");
}
