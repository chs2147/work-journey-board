# 개선 v25 상세 설계

2026-11-22 · `improve-v25` · 기준 `v1.51.0 Open Beta` (`d670439`) · 최신 main에서 새 작업 브랜치(CLAUDE.md 6절)

| 항목 | 내용 | 상태 |
|---|---|---|
| S1 의존성 보안 | `exceljs` 안의 `uuid@8.3.2` 알림(GHSA-w5hq-g745-h8pq, 보통) 정리 | 구현 |

## S1. `exceljs`의 `uuid`

- 알림: `uuid < 11.1.1`의 `v3`·`v5`·`v6`에 버퍼를 넘길 때 범위 검사가 빠진 문제. npm이 내놓는 해결은 `exceljs`를 3.4.0으로 **낮추는** 것이라 받지 않는다.
- 실제 영향: `exceljs`는 `uuid`의 `v4`만 쓴다(조건부 서식 확장 ID). 취약한 함수는 쓰이지 않아 앱 사용자에게 실제 위험은 없었다.
- 조치: `package.json` `overrides`로 `exceljs`의 `uuid`를 `^11.1.1`(CommonJS `require` 지원 판)로 지정. `npm ls uuid` = `exceljs@4.4.0 → uuid@11.1.1`, `npm audit --omit=dev` = 0건.
- 묶음 범위: 앱(브라우저)은 `exceljs`의 미리 묶인 빌드(`dist/exceljs.min.js`)를 쓰므로 그 안의 사본은 바뀌지 않는다 — `v4`만 쓰여 영향 없음. 이 조치는 의존성 목록·Dependabot 알림과 Node 쪽 사용(시험)에 적용된다.
- 런타임 네트워크 호출: 없음(`uuid`는 난수로 ID만 만든다, CLAUDE.md 4-1).
- 검증: 단위 634 통과, `npm run build` 통과, E2E 엑셀 내보내기·가져오기·CSP 아래 엑셀 14 통과.
