// Feature List 문서 도구. 앱 런타임에서는 불러오지 않는다. ExcelJS는 저장소의 기존 의존성.
// node scripts/features/generate.mjs build | check
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(ROOT, "docs/features");
const read = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
const catalog = read("catalog.json");
const profiles = read("profiles.json").profiles;
const version = catalog.catalogVersion;
const features = catalog.features;
const digest = createHash("sha256")
  .update(fs.readFileSync(path.join(DIR, "catalog.json")))
  .digest("hex");
const file = path.join(DIR, "exports", catalog.productId, `Work-Journey-Board-Feature-List-v${version}.xlsx`);
const states = {
  included: "포함",
  excluded: "제외",
  unavailable: "플랫폼 미지원",
  notYet: "도입 전",
  retired: "제거·대체",
  planned: "미제공·계획",
};
const eventNames = { added: "도입", changed: "개선", retired: "제거·대체" };
// 정식 판과 RC를 같은 순서에서 비교하되 build 메타데이터는 순서에 영향을 주지 않는다.
const releaseVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const compare = (a, b) => {
  const parse = (value) => {
    if (!releaseVersion.test(value)) throw Error(`버전 형식 오류: ${value}`);
    const clean = value.split("+")[0],
      dash = clean.indexOf("-");
    return {
      core: (dash < 0 ? clean : clean.slice(0, dash)).split(".").map(Number),
      pre: dash < 0 ? [] : clean.slice(dash + 1).split("."),
    };
  };
  const x = parse(a),
    y = parse(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (x.pre[i] === y.pre[i]) continue;
    if (x.pre[i] === undefined) return -1;
    if (y.pre[i] === undefined) return 1;
    const nx = /^\d+$/.test(x.pre[i]),
      ny = /^\d+$/.test(y.pre[i]);
    if (nx && ny) return Number(x.pre[i]) - Number(y.pre[i]);
    if (nx !== ny) return nx ? -1 : 1;
    return x.pre[i] < y.pre[i] ? -1 : 1;
  }
  return 0;
};
const firstAvailable = (f) =>
  f.preview && (!f.introduced || compare(f.preview, f.introduced) < 0) ? f.preview : f.introduced;
const introducedLabel = (f) => f.introduced ?? (f.status === "active" && f.preview ? "RC 제공만" : "미제공");
const concrete = profiles.filter((p) => !p.abstract);
function at(f, v) {
  const first = firstAvailable(f);
  if (!first) return "planned";
  if (compare(first, v) > 0) return "notYet";
  if (f.retired && compare(f.retired, v) <= 0) return "retired";
  return "included";
}
function resolve(f, id, v = version, seen = new Set()) {
  if (seen.has(id)) throw Error(`파생 프로필 순환: ${id}`);
  seen.add(id);
  const p = profiles.find((p) => p.id === id);
  if (!p) throw Error(`프로필 없음: ${id}`);
  const state = at(f, v);
  if (state !== "included") return state;
  const inherited = p.parent ? resolve(f, p.parent, v, seen) : "included";
  const own = p.overrides.find((o) => o.featureId === f.id);
  const value = own?.state ?? inherited;
  if (p.platform && (!f.platforms.includes(p.platform) || compare(f.platformSince[p.platform], v) > 0))
    return "unavailable";
  return value;
}
function validate() {
  const product = read(`products/${catalog.productId}.json`);
  if (product.currentVersion !== version || product.productId !== catalog.productId)
    throw Error("제품 정의 버전/ID 불일치");
  if (product.profiles.some((id) => !profiles.some((p) => p.id === id && !p.abstract)))
    throw Error("제품 정의의 배포 프로필 오류");
  if (catalog.schemaVersion !== 1) throw Error("카탈로그 schemaVersion 불일치");
  if (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"))).version !== version)
    throw Error("앱 버전과 카탈로그 버전 불일치. 기준 버전·스냅샷·엑셀을 함께 갱신하세요.");
  if (new Set(features.map((f) => f.id)).size !== features.length) throw Error("중복 Feature ID");
  const semver = /^\d+\.\d+\.\d+$/;
  if (!releaseVersion.test(version)) throw Error("카탈로그 버전 형식 오류");
  for (const f of features) {
    if (!/^WJB-[A-Z]+-\d{3}$/.test(f.id) || !f.name || !f.description || !f.sources.length)
      throw Error(`필수 필드: ${f.id}`);
    if (!["active", "retired", "planned"].includes(f.status)) throw Error(`기능 상태 오류: ${f.id}`);
    if (f.introduced && !semver.test(f.introduced)) throw Error(`비RC 도입 버전 형식 오류: ${f.id}`);
    if (f.preview && !releaseVersion.test(f.preview)) throw Error(`RC 버전 형식 오류: ${f.id}`);
    if (f.status !== "planned" && (!firstAvailable(f) || !f.implementation.length))
      throw Error(`도입 버전/구현 근거 없음: ${f.id}`);
    for (const e of f.history) {
      if (
        !releaseVersion.test(e.version) ||
        compare(e.version, version) > 0 ||
        compare(e.version, firstAvailable(f)) < 0
      )
        throw Error(`변경 버전 오류: ${f.id}`);
      if (!Object.hasOwn(eventNames, e.type) || !fs.existsSync(path.join(ROOT, e.source)))
        throw Error(`이력 근거 없음: ${f.id}`);
    }
    if (f.history.some((e, i) => i && compare(e.version, f.history[i - 1].version) < 0))
      throw Error(`이력 순서 오류: ${f.id}`);
    if (f.status === "active" && at(f, version) !== "included") throw Error(`현재 상태 불일치: ${f.id}`);
    if (f.status === "retired" && (!f.retired || compare(f.retired, version) > 0))
      throw Error(`제거 버전 오류: ${f.id}`);
    for (const p of [...f.sources, ...f.implementation])
      if (!fs.existsSync(path.join(ROOT, p))) throw Error(`근거 경로 없음: ${f.id} ${p}`);
  }
  if (new Set(profiles.map((p) => p.id)).size !== profiles.length) throw Error("중복 프로필 ID");
  for (const p of profiles) {
    if (new Set(p.overrides.map((o) => o.featureId)).size !== p.overrides.length)
      throw Error(`중복 재정의: ${p.id}`);
    for (const o of p.overrides)
      if (
        !features.some((f) => f.id === o.featureId) ||
        !["included", "excluded"].includes(o.state) ||
        !o.reason
      )
        throw Error(`재정의 오류: ${p.id}`);
    for (const f of features) resolve(f, p.id);
  }
}
function snapshot(v, reconstructed) {
  return {
    schemaVersion: 1,
    productId: catalog.productId,
    product: catalog.product,
    appVersion: v,
    appSchemaVersion: v === "1.18.0" ? 14 : catalog.appSchemaVersion,
    sourceRef: `v${v}`,
    asOfDate: catalog.asOfDate,
    reconstructed,
    baselineCommit: v === "1.18.0" ? "febc327" : catalog.sourceCommit,
    catalogDigestAtCapture: digest,
    artifactProfiles: ["windows-standard", "macos-universal"],
    captureNote: reconstructed
      ? "v1.18.0 출시 이력과 현행 카탈로그로 소급 정리한 최초 기준선. 당시 작성된 원본 목록은 아님."
      : "현재 버전 문서 스냅샷. 배포 파일 생성 성공 여부는 GitHub Actions/Release에서 별도 확인.",
    features: features.map((f) => {
      const history = f.history.filter((e) => compare(e.version, v) <= 0);
      return {
        ...f,
        history,
        lastChanged: history.at(-1)?.version ?? null,
        availability: at(f, v),
        profiles: Object.fromEntries(concrete.map((p) => [p.id, resolve(f, p.id, v)])),
      };
    }),
    profileDefinitions: profiles,
  };
}
const text = (v) => (v == null ? "" : String(v));
const url = (p) =>
  `https://github.com/chs2147/work-journey-board/${fs.statSync(path.join(ROOT, p)).isDirectory() ? "tree" : "blob"}/v${version}/${p}`;
function markdown() {
  const active = features.filter((f) => f.status === "active");
  const lines = [
    `# 현재 Feature List — v${version}`,
    "",
    `기준일 ${catalog.asOfDate} · DB 구조 v${catalog.appSchemaVersion} · 활성 ${active.length}개 · 제거/대체 ${features.filter((f) => f.status === "retired").length}개 · 미제공/계획 ${features.filter((f) => f.status === "planned").length}개`,
    "",
    "원본은 [catalog.json](catalog.json), 운영 규칙은 [README.md](README.md)입니다. 최초 제공 버전은 0.x 개발판을 포함한 비RC 출시 이력 기준이며 RC는 별도 필드입니다.",
    "",
    `[검토용 Excel](exports/${catalog.productId}/${path.basename(file)}) · [현재 스냅샷](releases/${catalog.productId}/v${version}.json)`,
    "",
  ];
  for (const area of new Set(active.map((f) => f.area))) {
    lines.push(
      `## ${area}`,
      "",
      "| Feature ID | 기능 | 최초 제공 | 최근 개선 | 현재 제공 범위 |",
      "|---|---|---|---|---|",
    );
    for (const f of active.filter((f) => f.area === area))
      lines.push(
        `| ${f.id} | ${f.name} — ${f.description} | ${introducedLabel(f)} | ${f.lastChanged} | ${f.platforms.join(" / ")} |`,
      );
    lines.push("");
  }
  lines.push("## 현재 미제공", "", "| Feature ID | 상태 | 항목 | 사유/전환 |", "|---|---|---|---|");
  for (const f of features.filter((f) => f.status !== "active"))
    lines.push(
      `| ${f.id} | ${f.status === "retired" ? "제거·대체" : "미제공·계획"} | ${f.name} | ${f.description} |`,
    );
  return lines.join("\n") + "\n";
}
function releases() {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  return [...readme.matchAll(/^### v([\d.]+(?:-rc\.\d+)?) \(([^)]+)\) — (.+)$/gm)].map((m) => ({
    version: m[1],
    date: m[2],
    name: m[3],
    rc: m[1].includes("-rc."),
    added: features.filter((f) => f.introduced === m[1]).length,
    changed: features.filter((f) => f.history.some((e) => e.version === m[1] && e.type === "changed")).length,
    retired: features.filter((f) => f.retired === m[1]).length,
  }));
}
function cellValue(v) {
  return typeof v === "object" && v !== null ? text(v.text ?? v.result) : text(v);
}
async function workbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Work Journey Board";
  wb.lastModifiedBy = "Work Journey Board";
  wb.created = new Date(`${catalog.asOfDate}T00:00:00Z`);
  wb.modified = wb.created;
  wb.title = `Feature List v${version}`;
  wb.subject = `catalog-sha256:${digest}`;
  wb.description = "버전별 기능 포함 여부·도입 근거·파생판 차이를 검토하는 문서. 앱에서 읽지 않음.";
  const sheets = new Map();
  function table(name, headers, rows, widths, frozen = 2) {
    const ws = wb.addWorksheet(name, {
      views: [{ state: "frozen", xSplit: frozen, ySplit: 4, showGridLines: false }],
      properties: { defaultRowHeight: 32, tabColor: { argb: "42645D" } },
    });
    ws.columns = widths.map((width) => ({ width }));
    ws.mergeCells(1, 1, 1, headers.length);
    ws.getCell(1, 1).value = `${name.replace(/^\d+_/, "")} · Work Journey Board v${version}`;
    ws.getRow(1).height = 34;
    ws.getCell(1, 1).font = { name: "맑은 고딕", size: 17, bold: true, color: { argb: "FFFFFF" } };
    ws.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "263F3B" } };
    ws.mergeCells(2, 1, 2, headers.length);
    ws.getCell(2, 1).value =
      `기준일 ${catalog.asOfDate} · DB v${catalog.appSchemaVersion} · ID로 이력 연결 · 필터/고정 머리 제공 · 검토 의견은 별도 사본에 작성`;
    ws.getCell(2, 1).font = { name: "맑은 고딕", size: 10, color: { argb: "5D6D68" } };
    ws.getRow(2).height = 24;
    ws.addTable({
      name: `FeatureTable${sheets.size}`,
      ref: "A4",
      headerRow: true,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: headers.map((name) => ({ name, filterButton: true })),
      rows: rows.length ? rows : [headers.map(() => "")],
    });
    ws.getRow(4).height = 32;
    for (let r = 5; r <= ws.rowCount; r++) {
      ws.getRow(r).height = name === "01_기능목록" ? 82 : name === "04_변경이력" ? 52 : 42;
      ws.getRow(r).eachCell((c) => {
        c.font = { name: "맑은 고딕", size: 10, color: { argb: "263F3B" } };
        c.alignment = { vertical: "middle", wrapText: true };
      });
    }
    ws.pageSetup = {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "1:4",
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.2 },
    };
    ws.headerFooter.oddFooter = "&LWork Journey Board · Feature List&C&P / &N&Rv" + version;
    sheets.set(name, { headers, rows, ws });
    return ws;
  }
  const active = features.filter((f) => f.status === "active");
  const overview = [
    ["문서 목적", "현재 기능을 도입 버전·근거·파생판별로 검토하는 문서. 앱의 새 기능 화면이 아닙니다."],
    ["기준 버전", version],
    ["기준일 / DB 구조", `${catalog.asOfDate} / v${catalog.appSchemaVersion}`],
    ["출시 직전 기준 커밋", catalog.sourceCommit],
    ["활성 기능", active.length],
    ["제거·대체", features.filter((f) => f.status === "retired").length],
    ["계획·현재 미제공", features.filter((f) => f.status === "planned").length],
    [
      "기능 유형",
      `제품 기능 ${active.filter((f) => f.kind === "제품 기능").length} / 배포·플랫폼 및 개발 운영 ${active.filter((f) => f.kind !== "제품 기능").length}`,
    ],
    ["최초 제공 버전", catalog.versionDefinition],
    ["검증 범위", catalog.verificationScope],
    [
      "파생판의 의미",
      "현재 3개 배포 프로필입니다. Windows 오프라인판은 같은 앱 기능에 런타임을 포함하는 패키징 차이이며 요청 때만 빌드합니다.",
    ],
    [
      "현재 릴리스 산출물",
      "Windows 기본 설치판 + macOS 유니버설 DMG. 오프라인판은 기본 배포에 포함하지 않습니다.",
    ],
    ["엑셀 검토 방법", "01 기능목록의 필터 → 02 버전별포함 → 03 파생판비교 → 09 검토입력 순으로 확인하세요."],
    [
      "검토 의견 보존",
      "이 파일을 다른 이름으로 저장한 사본의 09 검토입력에 작성하세요. 원본 재생성은 검토 사본을 읽거나 덮어쓰지 않습니다.",
    ],
    ["정본 / 운영 규칙", "docs/features/catalog.json / docs/features/README.md"],
    ["카탈로그 SHA256", digest],
  ];
  const home = table("00_읽어주세요", ["항목", "내용"], overview, [30, 115], 0);
  home.getColumn(2).alignment = { wrapText: true, vertical: "middle" };
  for (let r = 5; r <= home.rowCount; r++) home.getRow(r).height = 48;
  const mainRows = active.map((f) => [
    f.id,
    f.area,
    f.section,
    f.name,
    f.description,
    introducedLabel(f),
    f.preview ?? "—",
    f.lastChanged,
    ...concrete.map((p) => states[resolve(f, p.id)]),
    f.kind,
    f.schemaRequirement,
    f.sources.join("\n"),
    f.implementation.join("\n"),
    f.verification,
  ]);
  const main = table(
    "01_기능목록",
    [
      "Feature ID",
      "영역",
      "세부 영역",
      "기능명",
      "현재 동작 상세",
      "최초 제공",
      "초기 RC",
      "최근 개선",
      "Windows 기본",
      "macOS",
      "Windows 오프라인",
      "유형",
      "DB 기준",
      "근거 문서",
      "현재 구현 위치",
      "확인 수준",
    ],
    mainRows,
    [25, 24, 18, 36, 78, 14, 18, 14, 18, 18, 22, 18, 30, 48, 40, 30],
    4,
  );
  active.forEach((f, i) => {
    main.getCell(i + 5, 14).value = {
      text: f.sources.join("\n"),
      hyperlink: url(f.sources[0]),
      tooltip: "주요 명세 열기; 다른 근거는 06_근거문서에서 확인",
    };
    main.getCell(i + 5, 15).value = {
      text: f.implementation.join("\n"),
      hyperlink: url(f.implementation[0]),
    };
    for (const c of [6, 8])
      main.getCell(i + 5, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E4EFEC" } };
  });
  const milestones = [
    "0.1.0",
    "1.0.0",
    "1.6.0",
    "1.12.0",
    "1.14.0",
    "1.15.0",
    "1.16.0",
    "1.17.0",
    "1.18.0",
    version,
  ];
  table(
    "02_버전별포함",
    ["Feature ID", "영역", "기능명", "최초 제공", ...milestones],
    features.map((f) => [
      f.id,
      f.area,
      f.name,
      introducedLabel(f),
      ...milestones.map((v) => states[at(f, v)]),
    ]),
    [25, 24, 44, 15, ...milestones.map(() => 17)],
    3,
  );
  table(
    "03_파생판비교",
    ["Feature ID", "기능명", ...concrete.map((p) => p.name), "상속 기준", "재정의 사유"],
    active.map((f) => [
      f.id,
      f.name,
      ...concrete.map((p) => states[resolve(f, p.id)]),
      "공통 → 플랫폼/배포 프로필",
      concrete
        .flatMap((p) => p.overrides.filter((o) => o.featureId === f.id).map((o) => `${p.name}: ${o.reason}`))
        .join("\n"),
    ]),
    [25, 45, 25, 25, 30, 36, 90],
    2,
  );
  const eventRows = features
    .flatMap((f) =>
      f.history.map((e) => [e.version, f.id, f.area, f.name, eventNames[e.type], e.description, e.source]),
    )
    .sort((a, b) => compare(b[0], a[0]));
  table(
    "04_변경이력",
    ["버전", "Feature ID", "영역", "기능명", "유형", "변경 내용", "근거"],
    eventRows,
    [14, 25, 25, 40, 16, 90, 50],
    2,
  );
  table(
    "05_버전목록",
    [
      "버전",
      "출시 기록 날짜",
      "구분",
      "출시 제목",
      "목록상 도입 수",
      "목록상 개선 수",
      "목록상 제거 수",
      "주의",
    ],
    releases().map((r) => [
      r.version,
      r.date,
      r.rc ? "검증 RC" : r.version.startsWith("0.") ? "개발판" : "정식판",
      r.name,
      r.added,
      r.changed,
      r.retired,
      "기능 목록의 분해 단위로 센 수; 릴리스 노트의 변경 건수와 같지 않음",
    ]),
    [19, 20, 18, 72, 20, 20, 20, 74],
    1,
  );
  const sources = [
    ...new Set(
      features.flatMap((f) => [...f.sources, ...f.implementation, ...f.history.map((e) => e.source)]),
    ),
  ].sort();
  const sourceRows = sources.map((p) => [
    p,
    p.startsWith("src/")
      ? "현행 구현 위치"
      : p.startsWith("docs/release-notes/")
        ? "출시 노트"
        : p === "README.md"
          ? "전 버전 도입 이력"
          : "상세 명세",
    features
      .filter((f) => [...f.sources, ...f.implementation, ...f.history.map((e) => e.source)].includes(p))
      .map((f) => f.id)
      .join(", "),
    url(p),
  ]);
  const sourcesSheet = table(
    "06_근거문서",
    ["저장소 경로", "용도", "연결 Feature ID", "근거 링크"],
    sourceRows,
    [62, 26, 100, 100],
    1,
  );
  sources.forEach((p, i) => {
    sourcesSheet.getCell(i + 5, 4).value = { text: url(p), hyperlink: url(p) };
  });
  table(
    "07_현재미제공",
    ["Feature ID", "영역", "항목", "현재 상태", "최초 제공", "제거 버전", "사유·대체", "근거"],
    features
      .filter((f) => f.status !== "active")
      .map((f) => [
        f.id,
        f.area,
        f.name,
        f.status === "retired" ? "제거·대체" : "미제공·계획",
        introducedLabel(f),
        f.retired ?? "—",
        f.description,
        f.sources.join("\n"),
      ]),
    [26, 26, 42, 24, 16, 16, 100, 55],
    2,
  );
  table(
    "08_운영규칙",
    ["주제", "규칙"],
    [
      [
        "Feature ID",
        "WJB-영역-일련번호는 최초 부여 후 바꾸거나 재사용하지 않습니다. 이름 변경은 같은 ID의 변경 이력입니다.",
      ],
      [
        "버전 구분",
        "앱 semver, 문서 schemaVersion, DB 구조 번호는 다른 축입니다. RC는 최초 비RC 제공 버전과 분리합니다.",
      ],
      [
        "파생판",
        "부모 프로필 상속 후 포함/제외를 명시합니다. 부모 ID·재정의 기능 ID·사유를 검증하고 순환을 금지합니다.",
      ],
      [
        "계획",
        "미구현·계획은 현재 제공 수에 포함하지 않습니다. 외부 AI 직접 API 요약과 후속 차트가 여기에 해당합니다.",
      ],
      [
        "버전 스냅샷",
        "배포할 때 전체 목록과 해석된 프로필을 캡처합니다. 과거 스냅샷은 덮어쓰지 않고 정정 시 새 revision을 기록합니다.",
      ],
      [
        "최초 기준선",
        "1.18.0 스냅샷은 출시 후 소급 정리입니다. 당시 생성된 명세 원본이라고 해석하지 않습니다.",
      ],
      [
        "수정 순서",
        "catalog.json / profiles.json 수정 → build → check → 엑셀 검토 → 변경과 스냅샷·엑셀 함께 커밋합니다.",
      ],
      [
        "검토 입력",
        "09_검토입력의 노란 셀만 검토용입니다. 검토 사본을 별도 이름으로 보관하고 승인 내용을 정본에 수동 반영합니다.",
      ],
      [
        "배포 상태",
        "기능 포함/지원과 실제 설치 파일 게시 여부는 다릅니다. Release/Actions의 성공과 파일을 별도로 확인합니다.",
      ],
    ],
    [28, 135],
    0,
  );
  const review = table(
    "09_검토입력",
    ["Feature ID", "영역", "기능명", "도입 버전", "검토 상태", "검토자", "검토 의견", "처리 버전/근거"],
    features.map((f) => [f.id, f.area, f.name, introducedLabel(f), "미검토", "", "", ""]),
    [26, 26, 44, 18, 22, 24, 95, 55],
    3,
  );
  for (let r = 5; r <= review.rowCount; r++) {
    review.getCell(r, 5).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: ['"미검토,확인,수정 요청,보류"'],
      showErrorMessage: true,
      errorTitle: "검토 상태",
      error: "목록의 상태를 선택하세요.",
    };
    for (let c = 5; c <= 8; c++)
      review.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1C9" } };
  }
  for (const name of ["02_버전별포함", "03_파생판비교"]) {
    const ws = sheets.get(name).ws;
    ws.addConditionalFormatting({
      ref: `${name === "02_버전별포함" ? "E5:N" : "C5:E"}${ws.rowCount}`,
      rules: [
        {
          type: "containsText",
          operator: "containsText",
          text: "포함",
          priority: 1,
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "E4EFEC" } } },
        },
      ],
    });
  }
  return { wb, sheets };
}
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.mkdirSync(path.join(DIR, "releases", catalog.productId), { recursive: true });
validate();
const command = process.argv[2] ?? "check";
if (command === "build") {
  fs.writeFileSync(path.join(DIR, "CURRENT.md"), markdown());
  const baseline = path.join(DIR, "releases", catalog.productId, "v1.18.0.json");
  if (!fs.existsSync(baseline))
    fs.writeFileSync(baseline, JSON.stringify(snapshot("1.18.0", true), null, 2) + "\n");
  fs.writeFileSync(
    path.join(DIR, "releases", catalog.productId, `v${version}.json`),
    JSON.stringify(snapshot(version, false), null, 2) + "\n",
  );
  const { wb } = await workbook();
  await wb.xlsx.writeFile(file);
  console.log(
    `Feature List v${version}: ${features.filter((f) => f.status === "active").length} 활성, ${features.length} 전체 → ${path.relative(ROOT, file)}`,
  );
} else if (command === "check") {
  if (fs.readFileSync(path.join(DIR, "CURRENT.md"), "utf8") !== markdown())
    throw Error("CURRENT.md 재생성 필요");
  const captured = read(`releases/${catalog.productId}/v${version}.json`);
  if (JSON.stringify(captured) !== JSON.stringify(snapshot(version, false)))
    throw Error("현재 스냅샷 재생성 필요");
  const { sheets } = await workbook();
  const actual = new ExcelJS.Workbook();
  await actual.xlsx.readFile(file);
  if (actual.subject !== `catalog-sha256:${digest}` || actual.worksheets.length !== sheets.size)
    throw Error("Excel 메타데이터/시트 불일치");
  for (const [name, spec] of sheets) {
    const ws = actual.getWorksheet(name);
    if (!ws || ws.rowCount !== spec.rows.length + 4) throw Error(`Excel 행 수 불일치: ${name}`);
    const rows = [spec.headers, ...spec.rows];
    rows.forEach((row, i) =>
      row.forEach((value, j) => {
        if (cellValue(ws.getCell(i + 4, j + 1).value) !== text(value))
          throw Error(`Excel 원본 불일치: ${name} ${i + 4},${j + 1}`);
      }),
    );
    if (ws.views[0]?.state !== "frozen" || Object.keys(ws.tables).length === 0)
      throw Error(`Excel 머리/필터 없음: ${name}`);
  }
  console.log(
    `✓ Feature List v${version}: ID·버전·근거·프로필·현재 스냅샷·Excel ${features.length}개 항목 일치`,
  );
} else throw Error("사용법: node scripts/features/generate.mjs build | check");
