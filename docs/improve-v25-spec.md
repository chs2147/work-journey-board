# 개선 v25 상세 설계

2026-11-22 · `improve-v25` · 기준 `v1.51.0 Open Beta` (`d670439`) · 최신 main에서 새 작업 브랜치(CLAUDE.md 6절)

| 항목 | 내용 | 상태 |
|---|---|---|
| S1 의존성 보안 | `exceljs` 안의 `uuid@8.3.2` 알림(GHSA-w5hq-g745-h8pq, 보통) 정리 | 구현 |
| S2 Dependabot 4건 | `minimatch`·`url` 올림, `libsqlite3-sys`·`rsa`는 판단 기록 | 구현·기록 |

## S1. `exceljs`의 `uuid`

- 알림: `uuid < 11.1.1`의 `v3`·`v5`·`v6`에 버퍼를 넘길 때 범위 검사가 빠진 문제. npm이 내놓는 해결은 `exceljs`를 3.4.0으로 **낮추는** 것이라 받지 않는다.
- 실제 영향: `exceljs`는 `uuid`의 `v4`만 쓴다(조건부 서식 확장 ID). 취약한 함수는 쓰이지 않아 앱 사용자에게 실제 위험은 없었다.
- 조치: `package.json` `overrides`로 `exceljs`의 `uuid`를 `^11.1.1`(CommonJS `require` 지원 판)로 지정. `npm ls uuid` = `exceljs@4.4.0 → uuid@11.1.1`, `npm audit --omit=dev` = 0건.
- 묶음 범위: 앱(브라우저)은 `exceljs`의 미리 묶인 빌드(`dist/exceljs.min.js`)를 쓰므로 그 안의 사본은 바뀌지 않는다 — `v4`만 쓰여 영향 없음. 이 조치는 의존성 목록·Dependabot 알림과 Node 쪽 사용(시험)에 적용된다.
- 런타임 네트워크 호출: 없음(`uuid`는 난수로 ID만 만든다, CLAUDE.md 4-1).
- 검증: 단위 634 통과, `npm run build` 통과, E2E 엑셀 내보내기·가져오기·CSP 아래 엑셀 14 통과.

## S2. Dependabot 알림 4건 (2026-11-23, 로컬 `npm audit`·`cargo audit`로 재현)

| 알림 | 경로 | 앱에 들어감 | 조치 |
|---|---|---|---|
| `uuid` < 11.1.1 (GHSA-w5hq-g745-h8pq, 보통) | `exceljs` | 미리 묶인 사본(영향 없음) | S1 — `overrides` 11.1.1 |
| `minimatch` 7~11.0.0 (GHSA-g3hv-75wg-m249, 보통 — 패턴 증폭 서비스 거부) | ESLint·typescript-eslint(개발 도구) | 아니오 | `eslint` ^10.15.0·`typescript-eslint` ^8.73.0(소판올림, `minimatch` 11.0.9) — lint 그대로 |
| `url` ≤ 2.5.8 (RUSTSEC-2026-0592 — 중첩 `blob:` 주소 `origin()` 스택 넘침) | Tauri 등 Rust 하위 | 예 | `Cargo.lock` `url` 2.5.9 |
| `libsqlite3-sys` 0.30.1 (RUSTSEC-2026-0459, SQLite < 3.54 — 쪽 크기가 다른 `-wal` 파일과 함께 열면 초기화 안 된 메모리) | `tauri-plugin-sql` → `sqlx` 0.8 | 예 | **지금은 올릴 수 없음**(고친 판 0.39는 `sqlx` 0.9 필요, `tauri-plugin-sql`이 아직 0.8). 영향 낮음: 로컬에서 조작된 일지·`-wal` 짝 파일을 열어야 하고, 앱은 `journal_mode=DELETE`라 `-wal`을 만들지 않음. `tauri-plugin-sql` 새 판이 나오면 올림 |
| (참고) `rsa` 0.9 (RUSTSEC-2023-0071) | `sqlx-mysql`(잠금 파일에만) | 아니오 — 컴파일되지 않음(`cargo tree -i rsa` 비어 있음) | Dependabot에 뜨면 "쓰지 않음"으로 닫기 |

- 검증: `npm audit`(개발 도구 포함) 0건, `cargo audit`은 위 두 건(`libsqlite3-sys`·`rsa`)만 남음. Rust 시험 72, 단위 634, 타입 검사 통과.
- `cargo audit` 경고(관리 중단·불안정·철회된 판 9건 — `chrono`·`glib`·`zbus` 계열 등)는 Tauri·GTK 하위 의존성이라 Tauri 판올림 때 함께 본다.
