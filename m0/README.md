# m0 — I-M0 설치 검증용 최소 앱 (WJB M0 Probe)

회사 윈도우 PC에서 Tauri 앱이 **설치·실행·파일 저장**되는지 판정(◆G1)하기 위한 일회성 진단 앱. 실제 앱 코드와 분리해 두며, G1 판정 후에는 참고용으로만 남긴다.

- 화면: 자동 점검(설치 위치·WebView2·OneDrive·실행 기록) → 저장 폴더 테스트(파일 쓰기/읽기·SQLite 절대 경로·journal_mode·VACUUM INTO) → 수동 확인 → 결과 보고서 복사
- 외부 통신 없음(CSP로 외부 연결 차단), 업무 데이터 없음
- 빌드: `.github/workflows/m0-windows-build.yml` (windows-latest, NSIS `currentUser`, WebView2 설치 모드 `skip`)
- 검증 절차: [../docs/m0-install-check.md](../docs/m0-install-check.md)

```bash
npm ci
npm run build          # 프런트엔드 타입 검사 + 번들
npm run tauri dev      # 로컬 실행(리눅스는 webkit2gtk-4.1 필요)
```
